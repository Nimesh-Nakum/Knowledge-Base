---
title: 'Win32 API vs Native API: What’s the Difference and Why Attackers Care'
description: 'This post explains how Windows API calls actually reach the kernel — and why attackers bypass certain layers to evade detection.'
pubDate: 2026-04-06
order: 1
tags: ['windows-internals', 'api', 'edr-evasion', 'malware']
---

This post explains how Windows API calls actually reach the kernel — and why attackers bypass certain layers to evade detection.

When you call `CreateProcess()`, you are not talking to the Windows kernel.

You are talking to a layer — a well-documented, officially supported, heavily monitored layer — that every EDR on the market watches like a hawk.

So what happens when an attacker simply steps around that layer?

That’s the question this post answers. And to answer it properly, we need to trace exactly how an API call travels from your payload all the way down to the kernel — because every layer in that journey is a potential detection point, and every skip is a potential bypass.

## The Core Idea

Windows enforces a strict separation between user space and kernel space. Your process cannot touch hardware. It cannot read or write kernel memory. It cannot create threads in another process by reaching in and flipping bits directly.

Everything has to go through a request chain — a structured sequence of layers that progressively hand the request downward until it reaches the kernel, which does the actual work.

Think of it like a chain of command in a large organization. You don’t walk up to the CEO directly. You go through your manager, who goes through their director, who escalates to the VP. Each layer adds its own checks, logs, and approvals.

EDRs are the security auditors sitting at specific desks in that chain. If they only audit layer two, and you walk straight to the CEO’s office, they’ll never see you.

This is called the Windows API stack, and understanding it is the foundation of modern offensive tradecraft.

## The Four Layers, Top to Bottom

### Layer 1 — The Win32 API (The Public Face)

Key DLLs: `Kernel32.dll`, `Advapi32.dll`, `User32.dll`, `Gdi32.dll`

This is the layer every Windows developer learns first. It’s fully documented, officially supported, and stable across Windows versions. Functions like `CreateProcess()`, `OpenProcess()`, `VirtualAllocEx()`, `WriteProcessMemory()`, and `CreateRemoteThread()` all live here.

But here’s the thing: these functions don’t actually do the work. They validate parameters, perform bookkeeping, and then immediately pass the request down to the next layer.

Win32 is the public face — polished and friendly. It is also the first place EDRs sink their hooks.

### Layer 2 — The Native API (The Real Interface)

Key DLL: `Ntdll.dll`

Below Win32 sits the Native API — a largely undocumented set of functions that represent the true interface between user mode and the kernel. Every Win32 call eventually resolves to one of these.

- `OpenProcess()` — get a handle to another process
- `VirtualAllocEx()` — allocate memory in another process
- `WriteProcessMemory()` — write into another process's memory
- `CreateRemoteThread()` — create a thread in another process
- `ReadFile()` — read from a file
- `RegOpenKey()` — open a registry key

`Ntdll.dll` is loaded into every single Windows process without exception — SYSTEM processes, Session Manager, everything. There is no Windows process that runs without it.

This makes `Ntdll.dll` a critical target for EDRs, and simultaneously, a critical target for attackers trying to bypass them.

### Layer 3 — The System Call (Crossing the Boundary)

Mechanism: The `SYSCALL` instruction inside `Ntdll.dll`

This is where user mode ends and kernel mode begins.

The Native API functions in `Ntdll.dll` are thin stubs — tiny pieces of assembly that load a number into the `EAX` register and execute the `SYSCALL` instruction. Here's what that looks like from a real Windows 10 binary:

```nasm
NtReadFile: 
  MOV R10, RCX     ; preserve first argument 
  MOV EAX, 0x06    ; System Service Number for NtReadFile 
  SYSCALL          ; CPU switches to Ring 0 — kernel mode begins 
  RET              ; when kernel returns, back to user mode
```

That number in `EAX` is called the System Service Number (SSN). It's an index into a kernel-side lookup table called the SSDT (System Service Descriptor Table), which maps SSNs to their actual kernel function implementations.

One critical detail: the SSN for a given function is not constant. It changes between Windows versions and builds. This is exactly why offensive tools like SysWhispers must dynamically resolve the correct SSN at runtime rather than hardcoding it.

### Layer 4 — The Kernel Executive (Where Work Actually Happens)

Key Binary: `Ntoskrnl.exe`

After `SYSCALL` fires, the CPU drops into Ring 0 — full kernel mode. The kernel's system service dispatcher reads `EAX`, finds the corresponding function in the SSDT, and calls the real implementation. At this layer, the kernel:

*   Validates the caller’s access rights against the target object’s DACL
*   Allocates or modifies kernel structures
*   Interacts with hardware through drivers
*   Fires registered kernel callbacks — this is where EDR kernel-level detection triggers

The kernel callback registration (`PsSetCreateThreadNotifyRoutine`, `PsSetCreateProcessNotifyRoutine`, etc.) is why EDRs with kernel drivers can still see operations even after their user-mode hooks are bypassed. The kernel always knows.

## The Full Call Path — A Complete Example

Tracing `CreateRemoteThread()` from a payload all the way through:

```text
Your Payload 
 └─ Kernel32.dll!CreateRemoteThread()      [EDR Hook #1 — Win32 layer] 
     └── Ntdll.dll!NtCreateThreadEx()      [EDR Hook #2 — Native API layer] 
          └── MOV EAX, 0xBD (SSN) 
              SYSCALL ──────────────────── Ring 3 ends 
               └── Ntoskrnl.exe!NtCreateThreadEx()   [Kernel Callback fires] 
                   └── Thread created      Ring 3 resumes
```

Notice how there are two user-mode hook points before execution even reaches the kernel — and then a third detection point inside the kernel itself via callbacks.

## The Execution Flow (At a Glance)

```text
Your Program 
     ↓ 
Win32 API (kernel32.dll) 
     ↓ 
Native API (ntdll.dll) 
     ↓ 
SYSCALL 
     ↓ 
Kernel (ntoskrnl.exe)
```

## How EDR Hooking Actually Works

When an EDR loads, it injects its own DLL into every process and patches the first few bytes of sensitive functions in `Ntdll.dll`. Instead of executing the real stub, the function now jumps to the EDR's inspection code first.

```nasm
; Normal Ntdll.dll — NtCreateThreadEx:
MOV R10, RCX     ; real first instruction
MOV EAX, 0xBD
SYSCALL

; Hooked Ntdll.dll — NtCreateThreadEx:
JMP 0x7FF...     ; EDR overwrote the first 5 bytes
MOV EAX, 0xBD    ; only reached if EDR decides to allow it
SYSCALL
```

The EDR inspects the arguments, checks behavioral heuristics, and either blocks the call, logs it, or passes it through. The hook is inserted at the entrance to the function — before any kernel transition happens.

This means if you never call the hooked function in the hooked copy of `Ntdll.dll`, the EDR's user-mode inspection never runs.

## The Three Bypass Strategies

### Strategy 1 — Direct Syscall

Skip `Ntdll.dll` entirely. Embed the SSN lookup and `SYSCALL` instruction directly in your payload. Since you never call through the hooked library, the hook is never triggered.

```nasm
; Your payload — no Ntdll.dll involved at all:
MOV R10, RCX
MOV EAX, 0xBD ; NtCreateThreadEx SSN
SYSCALL
```

The challenge here is resolving the correct SSN dynamically, since it varies by Windows build. Tools like SysWhispers2, SysWhispers3, HellsGate, RecycledGate, and Tartarus Gate handle this problem in different ways.

Detection note: Direct syscalls originating from non-`Ntdll.dll` memory regions are increasingly flagged by modern EDRs.

### Strategy 2 — Unhook Ntdll.dll

Leave `Ntdll.dll` intact in memory, but overwrite the EDR's patches with the original, clean bytes read directly from disk.

The process:
1. Open `C:\Windows\System32\ntdll.dll` from disk
2. Map the file into memory
3. Locate the `.text` section (where executable code lives)
4. Copy it over the `.text` section of the already-loaded `Ntdll.dll`
5. EDR hooks are overwritten — the stubs are clean again

This approach is effective but detectable. Reading `ntdll.dll` from disk, mapping it privately, and then performing a large memory write into an existing DLL's code section is itself a behavioral signal that EDRs can watch for.

### Strategy 3 — Load a Fresh Copy of Ntdll.dll

Rather than overwriting the hooked copy, load a second, separate instance of `Ntdll.dll` into your process. The EDR only hooked the first one that was loaded at process creation. The second copy is clean.

All calls routed through the second copy bypass the hooks entirely and land directly on `SYSCALL`.

This is elegant, but similarly detectable — having two copies of `Ntdll.dll` mapped into the same process is an unusual memory artifact.

## Bonus: Zw vs. Nt — Why the Prefix Matters

You’ll often see Native API functions with two prefixes: `Nt` and `Zw`. From user mode, `NtCreateFile` and `ZwCreateFile` resolve to the same address in Ntdll.dll — they're functionally identical at that level.

The difference appears inside the kernel:

| Prefix | Called From | Parameter Validation |
|---|---|---|
| `Nt` | User mode | Full validation — kernel doesn't trust caller |
| `Zw` | Kernel mode (drivers) | Skipped — caller is already trusted |

When a kernel driver calls `ZwCreateFile`, it bypasses the parameter validation checks that protect against malformed or malicious input from user-mode callers. This distinction has real security implications — particularly for driver-based attacks where trusted callers can skip checks that would otherwise block operations.

## Conclusion: Thinking Like an Attacker

The Windows API stack is not just an implementation detail — it is a map of the battlefield.
Every layer is a detection surface.
And every bypass is simply a decision to move around the layer being watched.
The more you understand this stack, the better you understand both attack and defense.

Next, we’ll go deeper — into [what a process actually is internally](/windows-internals/processes-vs-programs/), and why it becomes the primary target for injection and manipulation.
