---
title: 'Windows Processes vs Programs — An Attacker’s Mental Model'
description: "Most people who run Mimikatz don't know what they're actually targeting. It's not a file. It's not a password database. It's a process — and understanding exactly what that means is what separates tool runners from actual red teamers."
pubDate: 2026-04-12
order: 2
tags: ['windows-internals', 'processes', 'red-team', 'mimikatz']
---

*Most people who run Mimikatz don't know what they're actually targeting. It's not a file. It's not a password database. It's a process — and understanding exactly what that means is what separates tool runners from actual red teamers.*

## A Program is Dead. A Process is Alive.

A program is just a file sitting on disk. `.exe`. Inert. Harmless.

The moment Windows runs it, something new is born — a process. And a process is not just “the program running.” It’s a container the OS builds around that program, with five things inside it:

*   Its own isolated memory (virtual address space)
*   Its own identity (access token)
*   Its own resource list (handle table)
*   Its own trust level (integrity level)
*   Its own user-mode metadata block (PEB)

You don’t inject into programs. You inject into processes. You don’t steal passwords directly. You steal tokens from processes. Every attack technique you’ll ever learn targets one or more of these five things.

## The Five Things Inside Every Process

### 1. Virtual Address Space — The Isolation Bubble

Every process lives in its own memory bubble. On 64-bit Windows, each process gets the user-mode range `0x0000000000000000 → 0x00007FFFFFFFFFFF` — all to itself. The kernel occupies the upper half (`0xFFFF800000000000` and above) and is mapped into every process's space — but only accessible from ring 0. Process A cannot read Process B's memory.

Unless it asks the OS with the right handle and sufficient access rights.

That’s what `OpenProcess` + `ReadProcessMemory` does — it asks the kernel to broker cross-process memory access by opening a handle with `PROCESS_VM_READ` rights. And that's exactly why `SeDebugPrivilege` is so powerful. It bypasses the DACL check on the process object entirely, letting you open a handle to *any* non-Protected Process. Including lsass. Usually.

### 2. The Access Token — The Identity Card

Every process carries a token. Think of it as an ID badge the OS checks before letting the process do *anything*.

That token contains:
*   User SID → who you are (`S-1-5-21-...-1001`)
*   Group SIDs → what groups you belong to
*   Privileges → special capabilities (SeDebugPrivilege, SeImpersonatePrivilege, etc.)
*   Integrity Level → how much the OS trusts this process

In EPROCESS, the token isn’t stored as a raw pointer — it’s stored as an `EX_FAST_REF`, a pointer with the lower 4 bits used as a reference count. Tools like Mimikatz that do token manipulation in kernel must mask off those bits before dereferencing.

When attackers talk about “token theft,” this is the object they mean. You duplicate the token from a privileged process using `DuplicateTokenEx`, then either call `CreateProcessWithTokenW` to spawn a new process under that identity, or `SetThreadToken` to impersonate within the current thread. You're not cracking a password. You're copying an ID badge.

### 3. The Handle Table — The Resource List

Every time a process opens a file, registry key, mutex, or another process — the OS gives it a handle. A number that references the underlying kernel object.

Each process has its own private handle table. You can see it in Process Hacker → right-click any process → Properties → Handles tab.

Why attackers care:
*   `SeDebugPrivilege` lets you call `OpenProcess` with `PROCESS_ALL_ACCESS` on anything — including lsass
*   `DuplicateHandle` lets you copy a handle from one process to another — without touching the target process's memory at all, making it invisible to many injection-focused EDR detections
*   This is why Mimikatz runs `privilege::debug` before touching lsass. It needs that handle.

### 4. Integrity Level — The Trust Tier

Windows assigns every process one of four trust tiers:

| Level | Value | Who runs here |
|---|---|---|
| Low | 0x1000 | Sandboxed apps, browsers |
| Medium | 0x2000 | Everything you normally open |
| High | 0x3000 | Elevated / admin processes |
| System | 0x4000 | SYSTEM account processes |

The rule is simple: a Medium process cannot write to a High process’s objects. Files, registry keys, memory — all blocked by the No-Write-Up policy enforced by the Security Reference Monitor.

This one rule is why UAC exists. And bypassing UAC means one thing: getting a process from Medium to High without a prompt.

One level above System sits PPL — Protected Process Light. lsass.exe on modern Windows runs as PPL. This is why SeDebugPrivilege alone is no longer enough to dump lsass — PPL blocks even SYSTEM-level processes from opening a handle to it. Bypassing PPL requires a kernel driver. This is exactly why tools like Mimikatz now ship with a driver component (`mimidrv.sys`).

### 5. The PEB — The Process’s Self-Description

The Process Environment Block is a user-mode structure every process has at a known offset in its own memory. On x64, the PEB is pointed to by the `GS` segment register at offset `0x60` (`GS:[0x60]`). It contains:

*   List of loaded DLLs (`InMemoryOrderModuleList`)
*   Image base address
*   `BeingDebugged` flag (the anti-debug check malware uses)
*   Command line and environment variables

Every shellcode loader and reflective DLL starts by walking the PEB to resolve `kernel32.dll` and `ntdll.dll` — without calling `GetModuleHandle` or `LoadLibrary`. The reason is simple: those WinAPI calls go through `ntdll.dll`, which is exactly where EDRs plant their hooks. If your shellcode calls `GetModuleHandle`, the EDR sees it. If it walks the PEB's `InMemoryOrderModuleList` directly and parses the export table manually, there is no API call to hook. This is the foundation of every modern shellcode loader and why PEB walking appears in virtually every offensive implant.

## What the Kernel Actually Sees — EPROCESS

All five of those things are described by a kernel structure called `_EPROCESS`. This is the kernel's version of "what is a process."

The fields that matter to an attacker:

| Field | What it is | Why attackers care |
|---|---|---|
| `Token` | EX_FAST_REF to the access token | Token theft targets this field — lower 4 bits must be masked |
| `ActiveProcessLinks` | Doubly-linked list of all processes | DKOM unlinks this to hide a process from Task Manager |
| `ImageFileName` | The process name | Can be spoofed |
| `UniqueProcessId` | The PID | Parent-child relationships tracked here |

You can dump this live in WinDbg with `dt nt!_EPROCESS` then `dt nt!_TOKEN` at the token address (after masking the low bits). Every injection technique, every token theft, every process-hiding technique you study is ultimately reading or writing one of these fields.

## Real Attack Flow — From Foothold to Credential Dump

Here’s what this looks like end-to-end on a real engagement:

Every step in this chain maps directly to a concept in this blog. This is not a theoretical exercise — this is a real engagement flow.

## Process Structure — The Full Picture

```text
Process (user-mode view)
├── Virtual Address Space [0x0000... → 0x7FFF...]
│ └── Kernel mapped at top (ring 0 only)
├── Access Token (EX_FAST_REF)
│ ├── User SID
│ ├── Group SIDs
│ ├── Privileges
│ └── Integrity Level ──→ enforced by SRM
├── Handle Table
│ └── Per-process kernel object references
├── PEB (GS:[0x60] on x64)
│ ├── InMemoryOrderModuleList ──→ PEB walk target
│ ├── ImageBaseAddress
│ └── BeingDebugged flag
│
↓ kernel view
│
_EPROCESS
├── Token (EX_FAST_REF — mask low 4 bits)
├── ActiveProcessLinks (DKOM target)
├── ImageFileName
└── UniqueProcessId
 ↓
 _TOKEN
 ├── UserAndGroups
 ├── Privileges
 └── IntegrityLevel
```

## Lab — See It Yourself in 5 Minutes

Step 1 — Open Process Hacker as Administrator

Run these four processes:
*   `notepad.exe` — double click, normal
*   `cmd.exe` — normal
*   `cmd.exe` — right-click, Run as Administrator

In Process Hacker, right-click any column header → enable Integrity. Now look:

| Process | Integrity |
|---|---|
| notepad.exe | Medium |
| cmd.exe (normal) | Medium |
| cmd.exe (elevated) | High |

One column. The entire story of UAC visible in three rows.

Step 2 — Open Process Explorer as Administrator

Right-click your normal cmd.exe → Properties → Security tab.
You’ll see a privilege list. Most entries say Disabled. This is your Medium token — alive but declawed.

Now do the same on your elevated cmd.exe. Look what appears:

| Privilege | Normal CMD | Elevated CMD |
|---|---|---|
| SeDebugPrivilege | ✕ | ✅ Enabled |
| SeImpersonatePrivilege | ✕ | ✅ Enabled |
| SeTakeOwnershipPrivilege | ✕ | ✅ Enabled |
| SeBackupPrivilege | ✕ | ✅ Enabled |
| SeLoadDriverPrivilege | ✕ | ✅ Enabled |

These aren’t cosmetic differences. Each one is a weapon:
*   SeDebugPrivilege → grants `PROCESS_ALL_ACCESS` on any non-PPL process by bypassing the object DACL check. This is the Mimikatz prerequisite.
*   SeImpersonatePrivilege → impersonate any user connecting to your named pipe. This is the entire Potato family.
*   SeBackupPrivilege → opens any file with `FILE_FLAG_BACKUP_SEMANTICS`, bypassing DACL enforcement entirely. Copy the SAM hive. Extract hashes offline.
*   SeLoadDriverPrivilege → load a kernel driver. BYOVD and PPL bypass start here.

## Tying It Together — The Attacker’s Mental Model

Two screenshots. Two columns. One complete picture:

> *Integrity level tells you what objects you can touch. Privilege list tells you what special actions you can take.*

Every privilege escalation technique in Windows is finding a path from a weak token to a strong one.

Process hollowing? Abusing the address space and PEB — see [Process Hollowing from First Principles](/windows-internals/process-hollowing/). Token theft? Copying the `EX_FAST_REF` token field from EPROCESS. PPID spoofing? Lying about `UniqueProcessId` of the parent at creation time. DKOM rootkit? Unlinking `ActiveProcessLinks` so the process disappears from every tool that walks that list. PPL bypass? Stripping the protection level field in EPROCESS — which requires ring-0 access, hence the driver (see [BYOVD Explained](/windows-internals/byovd-explained/)).

You now have the mental model. Every attack in this series builds on exactly this foundation.

## What’s Next

[Why Attackers Love LSASS.exe](/windows-internals/lsass-deep-dive/)

lsass.exe is a process. You now know what a process is. Next: inside lsass specifically — which DLLs it loads, what each stores, and why PPL, Credential Guard, and RunAsPPL change the attack surface entirely.

*Published as part of my Windows Internals Red Team series — building toward Mandiant operator level from first principles.*
