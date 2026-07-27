---
title: 'BYOVD Explained: How Attackers Use Signed Drivers to Kill EDRs'
description: 'EDRs operate from the kernel. To kill them, you need kernel access. Here is how attackers use legitimate, signed drivers to tear down defenses from the inside.'
pubDate: 2026-04-05
order: 4
tags: ['windows-internals', 'byovd', 'kernel', 'edr-evasion']
---

Your EDR sees everything. Process launches, thread injections, DLL loads, filesystem writes. It has eyes inside the kernel — little hooks that fire before anything consequential happens, passing information up to the agent, letting it decide whether to block or alert.

Now imagine something reaches into that kernel and quietly removes the hooks. No crash. No blue screen. No alert. The EDR process is still running, the dashboard still shows healthy, but the inputs it depends on are just gone.

This is part of windows internals I’ve been exploring — understanding how systems actually behave under the hood, not just how tools interact with them.

That’s not a Windows bug. That’s a trust problem.

BYOVD doesn’t exploit Windows — it exploits trust.

## Ring 0 vs Ring 3 — The Boundary That Matters

Windows splits execution into privilege levels. Your applications, your malware, your EDR agent — they all run in Ring 3, user mode. The kernel runs in Ring 0.

In my previous posts, I focused on how processes and execution work from an attacker’s perspective. This goes one layer deeper — into the kernel where those assumptions start to break.

This isn’t just organizational. The CPU enforces it. Ring 3 code cannot directly read kernel memory. It cannot call kernel functions. Every interaction goes through a controlled interface — syscalls — and the kernel decides whether to honor each request.

This is why typical malware stays loud. It has to use syscalls. Syscalls can be intercepted and monitored.

At Ring 0, security tools are just data structures.

Get code running in the kernel and those data structures become writable. The callback tables EDRs rely on, the hook registrations, the minifilter stack — all of it is reachable, readable, modifiable.

## Drivers and the IOCTL Bridge

To load code at Ring 0, Windows requires a signed kernel driver. The signature has to come from a trusted certificate authority, and on 64-bit Windows, Driver Signature Enforcement makes this non-negotiable — no valid signature, no kernel access.

So attacker-written code can’t just walk in. But legitimate drivers can. And some of those legitimate drivers have problems.

Drivers expose functionality to user-mode applications through an interface called IOCTL — Input/Output Control. It’s the communication channel between user land and a running driver. You send a request, the driver processes it, you get a result.

If a driver’s IOCTL handling is careless — if it lets caller-supplied data determine what memory gets read or written — then an attacker with that driver loaded has a working channel into kernel memory. No exploitation of Windows itself required.

A vulnerable driver doesn’t exploit the kernel — it exposes it.

## What an EDR Actually Does Inside the Kernel

It helps to understand what’s actually being attacked.

Process creation callbacks fire whenever a new process spawns. EDRs register here to inspect launches, verify signatures, inject their monitoring components before the process has a chance to do anything.

Thread creation callbacks catch remote thread injection — when one process tries to spawn a thread inside another. Classic injection technique, and this is where it gets caught.

Image load callbacks fire when a DLL or executable is mapped into memory. Unsigned modules, suspicious paths, known-bad hashes — all detectable here.

Minifilters sit on the filesystem stack and intercept reads and writes before they complete. This is how EDRs scan files on access, block malicious writes, and log filesystem activity.

All of these mechanisms share the same underlying model: the EDR registers a function with the kernel, and the kernel calls that function at the right moment. The EDR’s entire value proposition is built on those callbacks firing reliably.

Remove the callbacks, remove the EDR.

## The BYOVD Concept

BYOVD — Bring Your Own Vulnerable Driver .

Three steps, conceptually.

One — load a legitimate, signed, vulnerable driver. Windows sees a valid signature and accepts it without complaint. No alerts, no prompts. The driver is in the kernel.

Two — communicate with the driver from user mode via IOCTL. Because the driver is vulnerable, it accepts requests that give the caller access to kernel memory reads or writes. The attacker uses this to navigate kernel structures — find what they’re looking for.

Three — modify the structures that matter. Specifically, the callback registrations that make EDRs work. Clear the entries. Overwrite the function pointers. Surgically. The system keeps running, the EDR process stays alive, but its kernel-level visibility is gone.

The driver is a tool. A signed, vendor-approved crowbar.

## Where It Actually Breaks the EDR

Kernel callbacks are implemented as arrays of function pointers. When the kernel fires a “process created” event, it walks the array and calls each registered function in order. Security tools register their detection routines into this array.

The array lives in kernel memory. It’s data is Writable , if you have access.

Remove an entry from the array and that function never gets called. The EDR never sees the process launch. No alert, no block, no log entry.

> _If the callback never runs, the detection never exists._

Think of it like a security camera system. The monitors are on, the control room is staffed, operators are watching. But someone has quietly cut the feed from the cameras covering the area that matters. Nothing looks wrong from the inside — screens still show footage, systems still report healthy. The operators just happen to be blind to exactly the right corner of the building.

That’s what a successfully tampered EDR looks like from the attacker’s perspective. Not broken. Just aimed at nothing.

## The High-Level Flow

User-mode process initiates. A signed, known-vulnerable driver binary is written to disk and loaded through standard Windows driver loading mechanisms. It passes signature validation. It enters the kernel.

From user mode, the attacker’s code opens a handle to the driver and begins sending IOCTL requests. The driver, due to its vulnerability, processes these requests in ways that expose kernel memory access.

Through that channel, the attacker locates kernel structures holding EDR callback registrations, with the help of base address and specific offsets. This targeting is deliberate — specific structures, specific offsets, specific security products.

Those structures are modified. Callback entries are cleared or overwritten. The EDR continues running in user mode, completely unaware that its kernel hooks no longer fire.

From that point on, the attacker operates in a space the EDR can’t see.

## Want to See This in Action (Safely)

If you want to understand how these pieces actually fit together — drivers, IOCTL communication, and kernel callbacks — I built a safe, hands-on lab that walks through each component step by step.

It doesn’t replicate the attack directly, but it shows the exact mechanisms BYOVD relies on.

GitHub: \[[github repo link](https://github.com/Nimesh-Nakum/windows-kernel-internals-lab)\]

## Real-World: Lazarus and the Driver Playbook

Lazarus Group has been documented using BYOVD in real intrusions. They’re not unique in this — several advanced groups have adopted the technique — but they’re one of the more extensively documented cases.

What’s notable isn’t that they found sophisticated zero-days or developed novel exploitation chains. They went looking through public records of known-vulnerable drivers, found ones still carrying valid signatures, and used them.

> _Advanced attackers don’t need new vulnerabilities — they need old trust._

A driver signed five years ago by a legitimate hardware vendor is still signed. If it has a memory access vulnerability and isn’t on a blocklist, it’s still usable on modern Windows. The attack surface here is time — the lag between a vulnerability being known, documented, and then actually blocked across the install base.

That lag can be years.

## Why This Works: The Trust Model

Windows kernel trust is binary. Code is either signed and admitted or it isn’t. Once admitted, there’s no secondary behavioral analysis running on kernel-mode code in real time. The kernel doesn’t second-guess things that are already running inside it.

> _Once code enters Ring 0, it becomes part of the system._

Signed drivers are trusted not because of what they do, but because of what they are. The gate is the signature, not the behavior. A driver that exposes arbitrary memory access is still trusted as long as the certificate is valid and not revoked.

And revocation is slow. Getting a driver onto Microsoft’s blocklist requires coordination, testing, and update delivery. Vendors don’t always respond quickly. Microsoft’s list has gaps. And not every Windows installation gets updates promptly.

The math works out in the attacker’s favor.

## Defensive Reality

Driver blocklists exist. Microsoft maintains a Vulnerable Driver Blocklist that Windows will enforce. It’s updated through Defender and Windows Update. It helps, It doesn’t cover everything, and new vulnerable drivers surface faster than the list grows.

HVCI (Hypervisor-Protected Code Integrity) is more meaningful. It uses virtualization — VBS like VTL1 , to protect kernel memory from modification and enforces that only validly signed code can execute in Ring 0. It raises the bar significantly — many BYOVD techniques don’t work cleanly against it. The catch is compatibility; older drivers can break, and deployment isn’t universal.

Monitoring driver loads is practical right now. Logging when drivers are loaded, checking them against known-vulnerable lists, alerting on unexpected driver load events — this is achievable with most modern security stacks. It’s detective, not preventive, but catching a vulnerable driver being loaded is an actionable signal.

The honest reality: detection often happens _after_ trust has already been granted. The IOCTL communication that modifies callback arrays can complete in milliseconds. By the time a driver load alert surfaces in a SIEM, the damage may already be done. Speed of detection and response matters here more than it does for most techniques.

Know your driver baseline. Know what normally loads in your environment. Anomalies are easier to catch when you know what normal looks like.

## A Quick Personal Note on Why This Boundary Matters

Early on when I was messing around with kernel concepts, I tried doing something simple from user mode — reading a memory address that I knew belonged to a kernel structure. The kind of thing that would be trivially readable if you were in Ring 0.

The access violation came back immediately. Not a permission dialog, not a warning — just a hard stop from the CPU. You don’t get to negotiate.

That failure stuck with me. The wall between Ring 3 and Ring 0 isn’t a software check you can route around with the right API. It’s enforced at the hardware level. And that’s exactly why getting something _trusted_ to carry you across that boundary is so valuable to an attacker. You don’t climb the wall — you find someone with a key.

## Closing

BYOVD is uncomfortable to think about because it plays by the rules. No memory corruption in Windows itself. No kernel vulnerability. No zero-day.

It finds a signed piece of code that was trusted by the system and uses that trust as a stepping stone into the kernel. Then it modifies the data structures that make EDR visibility possible, from a place the EDR can’t reach or monitor.

The attack is a mirror held up to a specific assumption — that a signed driver is a safe driver, that trust extended is trust correctly placed, that the signature verification model is sufficient.

BYOVD doesn’t break Windows security — it reveals its boundaries.

The more you look at these systems from the inside, the more you realize that most “security” is really about visibility — and once that visibility is gone, everything else becomes optional.

_Understanding this technique matters because it reframes what EDR coverage actually means. It’s conditional. Conditional on the kernel callbacks firing. Conditional on the driver blocklist being current. Conditional on trust decisions made years ago by vendors who may have shipped and forgotten about a product long since deprecated. That conditionality is worth building your detection strategy around._