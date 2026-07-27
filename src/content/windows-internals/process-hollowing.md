---
title: 'Process Hollowing from First Principles — No Tools, Just Windows API'
description: 'A step-by-step breakdown of how malware creates a legitimate process in a suspended state, hollows out its memory, and injects a malicious payload.'
pubDate: 2026-04-04
order: 5
tags: ['windows-internals', 'process-injection', 'malware', 'api']
---

Press enter or click to view image in full size

_How attackers gut a legitimate process before it runs a single instruction — and what that leaves behind_

If you describe process hollowing as “injecting code into a legitimate process,” you’ve already misunderstood it. That framing is wrong in a way that matters operationally.

You’re not injecting into a running process. You’re creating a new process in a suspended state, destroying the file-backed mapping of its legitimate image before any user-mode instruction has executed, replacing that memory with your payload, and then releasing the thread. The OS never learned that anything changed. The process name, PID ancestry, and integrity token all belong to the legitimate binary. The code executing is entirely yours.

Windows does not enforce consistency between identity, memory, and execution — and hollowing lives entirely in that gap.

That’s the philosophical core of the technique, and it’s exactly why it has persisted as an offensive primitive for over a decade despite widespread defender awareness.

## Prerequisites: What You Need to Internalize First

For Better understnading of the flow , I recommand to read the previous blogs first.

## The PEB and ImageBaseAddress

Every Windows process carries a Process Environment Block (PEB) — a user-mode structure maintained by `ntdll` that tracks the image base, loaded module list, loader state, and process parameters. On x64, `ImageBaseAddress` lives at offset `0x10` into the PEB.

This is what the attacker reads to locate the legitimate image in the target’s address space, and what they patch after writing the payload to maintain surface-level consistency.

The PEB’s `Ldr` field — a pointer to `PEB_LDR_DATA` — is equally important and frequently overlooked. It contains three doubly-linked lists (`InLoadOrderModuleList`, `InMemoryOrderModuleList`, `InInitializationOrderModuleList`) that track every loaded module.

At the point where hollowing executes — immediately after `CreateProcess` returns — `Ldr` is initialized but the loader lists are not yet populated with the main image's `LDR_DATA_TABLE_ENTRY`. The loader hasn't run. The PEB already reflects an inconsistent state before the attacker touches anything: `ImageBaseAddress` points to the mapped image, but no corresponding loader list entry exists for it.

After hollowing, this compounds further. The image at `ImageBaseAddress` no longer exists. A tool that walks the loader lists and resolves `ImageBaseAddress` finds anonymous private memory with no file backing.

## The VAD Tree: MEM\_IMAGE vs MEM\_PRIVATE

The kernel manages each process’s virtual address space through the Virtual Address Descriptor (VAD) tree — a red-black tree in `EPROCESS` where each node describes a virtual memory region. The VAD node's type field is the critical distinction:

*   `VadImageMap` → file-backed image mappings → `MEM_IMAGE`
*   `VadNone` / private committed → anonymous allocations → `MEM_PRIVATE`

Legitimate PE loading always produces `MEM_IMAGE` regions. The kernel tracks the file reference through a `CONTROL_AREA` structure linked to the VAD node's `Subsection` — this is what allows `GetMappedFileName` to return a file path and what allows scanners to compare the in-memory image against the on-disk version.

When you call `NtUnmapViewOfSection` and then `VirtualAllocEx`, you destroy that file-backed region and replace it with anonymous private memory. The VAD tree shows a committed private region at the executable's former base — no file path, no `CONTROL_AREA`, no disk backing. This is the primary forensic artifact hollowing leaves behind, and it's structural.

## The PE Structure and the Section Mapping Problem

The PE file on disk is not a direct memory image. Data is packed using file-alignment (typically 512 bytes), referenced by `PointerToRawData`. In memory, sections are mapped to their `VirtualAddress` relative to the image base, aligned to the allocation granularity (typically 4096 bytes). These are different numbers.

Writing payload sections at file offsets rather than virtual offsets is the single most common failure mode in beginner hollowing implementations. The result is an immediate access violation at thread resume. Every section must be written at `ImageBase + SectionHeader.VirtualAddress`, not `ImageBase + SectionHeader.PointerToRawData`.

## Hollowing vs. Classic Process Injection

Press enter or click to view image in full size

## The Seven Steps: Mechanism and Internals

## Step 1 — CreateProcess with CREATE\_SUSPENDED

The attacker calls `CreateProcessW` targeting a legitimate, signed system binary — `svchost.exe`, `RuntimeBroker.exe`, `notepad.exe`. The target choice isn't cosmetic. The goal is to inherit the binary's reputation, token, and module load visibility.

Internally, `CreateProcessW` transitions to `NtCreateUserProcess`. The kernel executes in precise order:

Object creation: `EPROCESS` and `ETHREAD` (main thread) are allocated. Handle table initialized.

Section creation: `MmCreateSection` is called on the executable file, producing a section object backed by the file. The section references a `CONTROL_AREA`, which references the file object.

Address space setup: `MmMapViewOfSection` maps the image into the new process. The resulting VAD node is `VadImageMap`. Any address within this range returns `MEM_IMAGE`. The `ControlArea` field in the node links back to the original file — this is what makes the image path resolvable.

PEB initialization: `MmCreatePeb` sets `ImageBaseAddress`, `ProcessParameters`, and the `Ldr` pointer. The loader lists are initialized but not populated.

Thread setup: The initial thread’s trap frame is prepared. On x64, the thread begins at `RtlUserThreadStart` in `ntdll` — not at `AddressOfEntryPoint`. This distinction matters critically in Step 5.

Thread state: Suspend count = 1. The thread waits.

At this point: valid `EPROCESS`, valid PEB, legitimate `MEM_IMAGE` covering the executable, a thread that has never executed a single instruction in user mode. No TLS callbacks. No `DllMain`. No EDR hooks initialized in this process yet.

This is the cleanest interception window in the Windows process lifecycle.

## Step 2 — Reading the PEB to Find ImageBaseAddress

The attacker calls `NtQueryInformationProcess` with `ProcessBasicInformation`, returning a `PROCESS_BASIC_INFORMATION` structure containing `PebBaseAddress` — the PEB address in the _target's_ virtual address space.

`ReadProcessMemory` pulls the PEB from the target. At offset `0x10` on x64 (confirmed against the `_PEB` symbol in the public PDB) lies `ImageBaseAddress` — the base of the `MEM_IMAGE` region that's about to be destroyed.

Guessing the base using the PE’s preferred `ImageBase` is an option only for non-ASLR binaries. For everything else, the PEB read is the only reliable path.

## Step 3 — NtUnmapViewOfSection: The Actual Hollowing

`NtUnmapViewOfSection(processHandle, ImageBaseAddress)` removes the section mapping for the legitimate executable from the target's address space.

The kernel walks the target’s VAD tree, finds the `VadImageMap` node at `ImageBaseAddress`, and removes it. The `CONTROL_AREA` reference count decrements. Physical pages are dereferenced. The address range becomes `MEM_FREE`.

The forensic transition is precise:

*   Before the call: `MEM_IMAGE`, file-backed, path-resolvable
*   After the call: `MEM_FREE`
*   After Step 4’s `VirtualAllocEx`: `MEM_PRIVATE` — anonymous, no `CONTROL_AREA`, no path

This is where hollowing becomes visible to any scanner that checks the VAD.

_Failure mode:_ `NtUnmapViewOfSection` returns `STATUS_INVALID_PARAMETER` if the handle lacks `PROCESS_VM_OPERATION` access, or if the region was mapped with incompatible sharing flags (rare for a freshly suspended process, but possible in constrained environments).

## Step 4 — VirtualAllocEx and WriteProcessMemory

`VirtualAllocEx` at the payload's preferred `ImageBase` with `MEM_COMMIT | MEM_RESERVE` and `PAGE_EXECUTE_READWRITE`. A new `VadNone` node is inserted — anonymous private memory. `VirtualQuery` on this range now returns `MEM_PRIVATE`. The transformation is complete.

`WriteProcessMemory` loads the payload in two passes:

Headers first. Write the DOS header, NT headers, and section headers at the base. Some payloads reference their own headers at runtime — skipping this breaks them.

Sections at virtual offsets. For each section: write raw data to `AllocatedBase + SectionHeader.VirtualAddress`. Sections smaller than `VirtualSize` leave zeroed padding — expected behavior. Sections that exceed `SizeOfRawData` boundaries require boundary checking to avoid clobbering adjacent sections.

Relocation handling is where most implementations fail silently. If `VirtualAllocEx` returns a different address than the payload's preferred `ImageBase` — because that range is unavailable — every absolute address in the payload is wrong by `ActualBase - PreferredBase`. The `.reloc` section exists precisely for this: walk the Base Relocation Table, compute the delta, patch each referenced address before resuming.

If the payload was compiled with `/FIXED` or had its relocation table stripped by the packer, and the base differs, the process crashes on the first absolute reference. This is not an edge case — it's one of the most common failure modes in real-world hollowing.

## Step 5 — SetThreadContext: Redirecting Execution

The suspended thread’s instruction pointer still targets `RtlUserThreadStart` in ntdll. The legitimate entry point it was about to call no longer exists.

`GetThreadContext` with `CONTEXT_FULL` retrieves the complete register snapshot from the thread's `TrapFrame` and `KTHREAD->KernelStack`.

Here’s the nuance most write-ups get wrong. On x64, the initial `Rip` is `RtlUserThreadStart`, not `AddressOfEntryPoint`. Its signature: `VOID RtlUserThreadStart(PUSER_THREAD_START_ROUTINE Function, PVOID Parameter)`. The entry point is passed in `RCX`, the parameter in `RDX`. The attacker patches RCX to `PayloadBase + AddressOfEntryPoint` — not `Rip` directly.

Setting `Rip` to the entry point bypasses `RtlUserThreadStart` entirely. No SEH frame setup. No stack alignment initialization. The payload crashes inside the CRT before running a single line of its own code.

`SetThreadContext` applies the modified context. The kernel updates the thread's trap frame. When the thread resumes, `RtlUserThreadStart` runs normally — calling the payload's entry point instead of the original binary's.

## Step 6 — Patching PEB->ImageBaseAddress

The PEB still holds the `ImageBaseAddress` of the original binary — a region that no longer exists. Any tool reading that field and calling `VirtualQuery` on it finds `MEM_FREE`. An obvious anomaly.

`WriteProcessMemory` overwrites the 8 bytes at `PebBaseAddress + 0x10` with the payload's actual load address. The process is now internally consistent at the PEB level.

What this step does _not_ fix: the loader list inconsistency. No `LDR_DATA_TABLE_ENTRY` for the payload is ever inserted. The loader never ran. Module enumeration via the PEB lists returns an empty list — the payload executes in a process whose own loader structures don't acknowledge it exists.

## Step 7 — ResumeThread

`ResumeThread` decrements the suspend count to zero. The scheduler picks up the thread. It resumes at `RtlUserThreadStart`, which calls the patched `RCX` — the payload's entry point. The payload runs inside a process that, from the OS's perspective, is entirely legitimate.

The sequence is complete. The process has the right name, the right token, and the wrong code.

Press enter or click to view image in full size

visualize the flow

## Broken Invariants: The Real Story

Hollowing is best understood not as code injection, but as desynchronization between a process’s identity, its memory, and its execution. Three invariants Windows implicitly assumes are violated simultaneously.

## Memory Invariant — MEM\_IMAGE Must Have a Backing File

When the kernel creates a `MEM_IMAGE` region, it does so through a section object tied to a file. The `CONTROL_AREA` in the VAD node maintains that reference — enabling `VirtualQuery` to return `MEM_IMAGE`, `GetMappedFileName` to return a path, and scanners to compare the live image against disk.

After hollowing: the region at the executable’s base is `MEM_PRIVATE`. No `CONTROL_AREA`. No file reference. No resolvable path. This is the invariant module stomping specifically addresses by reusing an already-mapped DLL's `MEM_IMAGE` region — keeping the file backing while replacing the content.

## Loader Invariant — The LDR Lists Must Reflect Loaded Modules

`PEB->Ldr` maintains three circular doubly-linked lists that are the authoritative source for `EnumProcessModules`, `GetModuleHandle`, and every debugger. Under normal operation, the main executable has a corresponding `LDR_DATA_TABLE_ENTRY` linking it to the file on disk, its image base, and its name.

After hollowing: no `LDR_DATA_TABLE_ENTRY` for the payload exists. The loader never ran to create one. The payload's code executes in a process whose own loader structures don't acknowledge it.

## Execution Invariant — Code Must Execute From a Named Module

On a healthy Windows system, every return address on every thread’s call stack resolves to a named module with a resolvable path. Frames in anonymous private memory are a high-confidence anomaly signal.

After hollowing: the thread executes entirely within `MEM_PRIVATE`. Every frame in the call stack is an orphaned frame — no module name, no file path, no loader entry.

These three violations — memory type mismatch, absent loader entry, execution in untracked memory — are the structural fingerprint of hollowing. Patching `PEB->ImageBaseAddress` in Step 6 fixes none of them. It's cosmetic. The invariant violations persist underneath.

## What EDR Actually Sees

Knowing what’s visible is operationally relevant — because it determines exactly what evasion is necessary.

## The Behavioral Sequence, Not Individual APIs

No single API in the hollowing chain is inherently malicious. `CreateProcess`, `NtQueryInformationProcess`, `ReadProcessMemory`, `NtUnmapViewOfSection`, `VirtualAllocEx`, `WriteProcessMemory`, `SetThreadContext`, `ResumeThread` — each has legitimate uses in isolation.

What behavioral engines watch is the sequence and temporal proximity: a process creates a suspended child, immediately queries its PEB, reads from its address space, unmaps a region at the address extracted from that PEB, allocates at the same address, writes a PE-sized payload, modifies the thread’s `RCX` register, and resumes.

This sequence is the signature. Everything else is optional.

That behavioral chain, against a single target handle within a narrow time window, is near-unambiguous — even without a single malicious API call in isolation.

## Memory State Transitions

ETW providers `Microsoft-Windows-Kernel-Memory` and `Microsoft-Windows-Kernel-Process` emit events for virtual memory operations. An EDR consuming these watches a specific VAD mutation sequence: `MEM_IMAGE` at the image base disappears, immediately replaced by `MEM_PRIVATE` at the same address, followed by cross-process writes from the parent into that range.

`MEM_IMAGE → MEM_FREE → MEM_PRIVATE` at a freshly created process's image base has no legitimate explanation.

## VAD Anomalies

Kernel-mode sensors with direct `EPROCESS` access query the VAD tree directly — bypassing all user-mode evasion. They check the VAD node at `PEB->ImageBaseAddress`: `VadImageMap` or `VadNone`? If it's private, and the thread's `RIP` falls within that range, the process is hollowed. This check is entirely kernel-side, invisible to the attacker's user-mode code.

## Thread Anomalies

Some EDRs snapshot the expected `RCX` value — derived from `AddressOfEntryPoint + ImageBase` via `NtQueryInformationProcess` — at process creation and compare it against the actual thread context at `ResumeThread`. A mismatch pointing into a `MEM_PRIVATE` range is flagged immediately.

Once the thread is running, periodic kernel-side stack sampling finds frames in `MEM_PRIVATE` with no resolvable module. Every such frame is a strong behavioral indicator independent of the creation-time signals.

## The Sysmon Telemetry Gap

Default Sysmon configurations don’t generate events for `NtUnmapViewOfSection` or `NtWriteVirtualMemory`. Not an oversight — these are high-volume operations. This gap is part of why hollowing remains viable against Sysmon-only detection stacks. The artifacts exist in kernel ETW and memory scanners, but log-based SIEM detections built on Sysmon alone miss the core VAD mutation entirely.

## Evasion Variants

## RW → VirtualProtect → RX Instead of RWX

Allocate `PAGE_READWRITE`. Write all sections. Call `VirtualProtectEx` to transition executable sections to `PAGE_EXECUTE_READ`. This removes the `PAGE_EXECUTE_READWRITE` region that most EDR behavioral rules aggressively target. The `MEM_PRIVATE` anomaly remains — this doesn't address the core forensic artifact — but it eliminates the most over-signatured permission combination. One extra API call. Worth it.

## Module Stomping

The direct evolutionary response to `MEM_PRIVATE` detection. Force a legitimate DLL to load into the target process via a remote `LoadLibraryA` or queued APC. This creates a real `MEM_IMAGE` region with genuine file backing. Then overwrite that region with your payload via `WriteProcessMemory`.

The VAD node stays `VadImageMap`. `VirtualQuery` returns `MEM_IMAGE`. `GetMappedFileName` returns the DLL's path. The code in that memory is yours. This defeats the primary forensic indicator — at the cost of a new one: the in-memory image no longer matches the file on disk, detectable by scanners that hash-compare live image regions against disk.

## Early Bird APC Injection

Queue an APC to the suspended main thread before `ResumeThread` instead of modifying the thread context. The APC executes when the thread first becomes alertable — before any EDR's `DLL_PROCESS_ATTACH` hooks initialize in the new process. Execution occurs entirely outside user-mode hook coverage. The memory-type artifacts remain, but the execution timeline shifts in a way that defeats hook-based behavioral engines.

## Failure Modes in Practice

Relocation failures. If `VirtualAllocEx` returns a different address than the payload's preferred `ImageBase`, every absolute address is wrong by `ActualBase - PreferredBase`. Without a relocation table — common with packed or stripped payloads — the process crashes on the first absolute reference. Fix: force the same base, or implement relocation table parsing.

TLS callbacks. Host binaries with Thread Local Storage callbacks expect those to run during loader initialization. They won’t. In most scenarios, targeting binaries without TLS (the majority of simple system binaries) avoids this entirely.

Import resolution. At the point `ResumeThread` fires, only `ntdll.dll` is guaranteed to be mapped in the new process — the kernel loads it first for every process. `kernel32.dll` and `kernelbase.dll` are not yet present. Payloads that assume a populated IAT crash immediately. Payloads that resolve their own imports (standard in staged loaders and shellcode) do not.

ASLR and preferred bases. The host binary’s actual load address may differ from its `ImageBase` in the NT headers. Reading the actual base from the PEB handles this. Computing the payload entry point from the preferred `ImageBase` instead of the actual allocated address produces a wrong entry point and a clean crash.

## The Core Artifact and What Comes Next

`NtUnmapViewOfSection` followed by `VirtualAllocEx` at the same address is structurally self-revealing. It destroys a `MEM_IMAGE` region backed by a legitimate file and replaces it with anonymous private memory. Every memory scanner, every kernel-side VAD query, every `GetMappedFileName` call on the base address surfaces the inconsistency.

The attack is powerful against detection stacks that don’t perform this cross-reference. Against those that do, the artifact is definitional — built into the technique’s core mechanism.

The next logical question: what if you never called `NtUnmapViewOfSection` at all? What if you hijacked memory that's already a legitimate `MEM_IMAGE` region — one with a real file path that passes every scanner check, a real `CONTROL_AREA`, a real disk backing? That's module stomping, one rung up the same ladder.

Hollowing isn’t stealth. It’s inconsistency. And inconsistency is exactly what defenders learn to hunt.

Below that rung is DLL Hijacking — exploiting the loader’s own search-order behavior to make Windows load your code as a legitimate library, without touching an existing process at all. A design decision baked into the Windows loader since the early 1990s that still can’t be fully patched without breaking legacy application compatibility.

That’s next.

_The proof-of-concept implementation is available in the_ [_windows-kernel-internals-lab_](https://github.com/Nimesh-Nakum/windows-kernel-internals-lab/tree/main/Process_hollowing) _repository._