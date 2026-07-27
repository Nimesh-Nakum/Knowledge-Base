---
title: 'Why Attackers Love LSASS.exe: A Deep Dive into the Windows Credential Store'
description: 'After getting SYSTEM, one process stands between you and every credential on the machine. Here''s what lives inside it - and what modern Windows does to stop you.'
pubDate: 2026-04-06
order: 3
tags: ['windows-internals', 'credential-dumping', 'lsass', 'mimikatz']
---

After getting SYSTEM, one process stands between you and every credential on the machine. Here’s what lives inside it — and what modern Windows does to stop you.

You’ve just popped a shell. You have SYSTEM. The next question is always the same — _what credentials can I pull?_

The answer lives in one process: `lsass.exe`. Not because it's a vulnerability. Because it is literally the Windows credential store, by design. Understanding what lives inside it — and what modern defenses do to protect it — is what separates someone who runs Mimikatz from someone who understands why it sometimes fails.

## What is lsass.exe

`lsass.exe` — Local Security Authority Subsystem Service — is the single process responsible for enforcing Windows security policy. Every login, every token creation, every credential cache on the machine flows through it.

It runs as `NT AUTHORITY\SYSTEM` (`S-1-5-18`) and starts during boot under Session 0. It is not optional. If lsass dies, Windows immediately reboots — the OS cannot function without its security authority.

> _Why attackers care: lsass is the only process authorized to hold NTLM hashes, Kerberos tickets, and sometimes cleartext passwords in memory simultaneously. One successful memory read = credentials for the entire domain._

## How LSASS Gets Spawned

lsass doesn’t start from `services.exe` or `explorer.exe`. It has a very specific parent — and that parent matters for detection.  
LSASS starts very early in the Windows boot sequence as part of the Session 0 initialization.

it’s birth follows:

Press enter or click to view image in full size

Windows Process Tree

*   SMSS.exe (Session Manager Subsystem) starts at boot and creates the first system session (Session 0).
*   SMSS launches Wininit.exe (Windows Initialization Process).
*   Wininit.exe is the direct parent of LSASS. It spawns `lsass.exe`, along with `services.exe` (Service Control Manager) and `lsaiso.exe` (if Credential Guard is on).
*   Once started, LSASS runs indefinitely. If it is terminated or crashes, Windows will immediately trigger a system reboot because the OS cannot function without its security authority.

## Privileges and Capabilities it Has

LSASS runs under the NT AUTHORITY\\SYSTEM account (the highest possible privilege on a local machine) and possesses near-total control over security-related operations.  
Its key “superpowers” includes:

*   Security Token Generation: It creates the access tokens that determine exactly what files, folders, and network resources a user can access.
*   Credential Handling: It is the only process authorized to handle and cache sensitive material like NTLM hashes, Kerberos tickets (TGTs), and sometimes plaintext passwords for Single Sign-On (SSO).
*   Security Policy Enforcement: It enforces password complexity, account lockouts, and user rights (e.g., who can shut down the system or back up files).
*   Writing to Security Logs: LSASS is responsible for generating and writing events to the Windows Security Log, such as successful and failed login attempts.
*   Memory Isolation (RunAsPPL): On modern Windows, it has the capability to run as a Protected Process Light (PPL). This prevents even other Administrator-level processes from reading its memory or injecting code into it, unless they are also specifically signed and trusted by Microsoft.

## Lsass Internal Architecture and Componants

LSASS is not a single tool but a host process for several critical security services and “Security Support Providers” (SSPs) .

These components work together to handle different types of login:

*   Security Support Providers (SSPs): These are DLLs loaded into the LSASS process that implement specific authentication protocols:

— Kerberos (`kerberos.dll`): The primary protocol for Active Directory domain environments.

— MSV1\_0 (`msv1_0.dll`): Handles local interactive logons by checking credentials against the Security Account Manager (SAM) database.

— WDigest: A legacy protocol that can store passwords in plaintext if enabled, making it a favorite target for attackers.

— Schannel: Manages SSL/TLS for secure web and network communication.

*   NetLogon Service: Maintains the “secure channel” between a local machine and a Domain Controller (DC) to verify domain credentials.
*   SAM Service (`SamSs`): Manages local user and group information stored in the SAM registry hive.

As an attacker, you don’t care about all of them. You care about three:

Press enter or click to view image in full size

The wdigest story matters.

wdigest was designed for HTTP Digest authentication — a protocol that mathematically requires the plaintext password to function. So Windows stored it. In memory. In lsass. Microsoft disabled wdigest by default in Windows 8.1+ but the registry key still exists:

text

HKLM\\SYSTEM\\CurrentControlSet\\Control\\SecurityProviders\\WDigest  
UseLogonCredential = 1  ← re-enables cleartext storage

Attackers with admin access can flip this key, wait for a user to re-authenticate, and then pull cleartext from lsass memory.

## LSASS As Attacker’s Perspective

After Getting the Shell on victim’s Machine , Always the Same Question — What can i do next ?

Password Dumping ? . Let’s Run Mimikatz .

## How Mimikatz Actually Works — The Internals

Mimikatz does not “hack” anything — it reads lsass memory.  
The key insight: Credential structures are not encrypted on the heap by default (before Credential Guard). They sit in plaintext inside lsass memory — Mimikatz just knows where to look.

Press enter or click to view image in full size

Mimikatz Internals with Complete Attack plan.

*   Flow: `privilege::debug` → SeDebugPrivilege → `OpenProcess(lsass)` with `PROCESS_VM_READ` → `ReadProcessMemory` → parse the in-memory structures of each auth DLL → extract credentials.
*   Why `privilege::debug` is needed: lsass DACL blocks normal user access — SeDebugPrivilege bypasses the DACL check entirely.
*   The credential structures are not encrypted on the heap — they sit in plaintext in lsass memory (before Credential Guard).

## Why Mimikatz Fails In Modern Systems

Two defenses break the standard Mimikatz flow. They operate at completely different layers.

Press enter or click to view image in full size

### 1\. PPL

PL is not a firewall rule. It is a protection level field inside `_EPROCESS` — the kernel's process object. When lsass runs as PPL, the kernel refuses to grant `PROCESS_VM_READ` access to any process that isn't also PPL-signed by Microsoft.

OpenProcess(lsass) with SeDebugPrivilege  
        ↓  
Kernel checks \_EPROCESS.Protection field  
        ↓  
lsass = PsProtectedSignerLsa-Light  
        ↓  
Access Denied — even from SYSTEM

How to check:

Process Hacker → lsass.exe → right-click → Properties  
Look for: Protection: PsProtectedSignerLsa-Light

Bypass: `mimidrv.sys` — Mimikatz's own kernel driver. It directly zeroes the `Protection` field in `_EPROCESS` at the kernel level. Once stripped, lsass is no longer protected and the standard dump flow works again.

This is exactly why BYOVD exists as an attack class. PPL cannot be defeated from userland — you need ring 0.

### 2\. Credential Guard — The Hard Wall

Credential Guard doesn’t just protect lsass — it moves the credentials out of lsass entirely.

Introduced in Windows 10 with VBS (Virtualization-Based Security), it adds a new process: `lsaiso.exe` (Isolated LSA). This process runs in VTL1 — a separate trust zone enforced by the hypervisor, completely invisible to ring 0.

VTL0 (normal world)          VTL1 (secure world)  
┌─────────────────┐          ┌─────────────────┐  
│  lsass.exe      │  ←ALPC→  │  lsaiso.exe     │  
│  (your target)  │          │  (holds secrets) │  
│                 │          │                  │  
│  Gets encrypted │          │  Holds plaintext │  
│  blobs only     │          │  Kerberos keys   │  
│                 │          │  NTLM hashes     │  
└─────────────────┘          └─────────────────┘  
    Ring 0 can reach              Ring 0 cannot reach

Even with a kernel driver and ring-0 access, you cannot read VTL1 memory. The hypervisor enforces the boundary.

What you get when Credential Guard is active: encrypted blobs inside lsass — useless without the keys that live in VTL1.

The four scenarios where Credential Guard can still be bypassed:

1.  Physical access / offline attack — boot from external media, extract credentials from offline hive
2.  Downgrade attack — disable Credential Guard via Group Policy if you have domain admin
3.  NTLM relay — you don’t need the hash, just relay the authentication challenge
4.  Cached credentials — domain cached credentials (DCC2) stored in the registry, not protected by CG .

## Attack Surface Map — What You Can Still Get

Press enter or click to view image in full size

## Other Places Credentials Live

lsass isn’t the only store. When CG blocks you, pivot here:

*   SAM hive — local account NTLM hashes. Readable via `SeBackupPrivilege` or VSS shadow copy
*   DPAPI — browser saved passwords, Wi-Fi keys, certificate private keys
*   LSA secrets — service account passwords, cached domain credentials stored in registry

> _Note: Each of these deserves its own blog. They’re listed here so you know where to pivot — not as a dead end._

## Lab — See It Yourself

What you need: Process Hacker, Mimikatz, a Windows lab VM without Credential Guard

Lab 1 — Identify lsass protection status

Process Hacker → find lsass.exe → right-click → Properties → General tab

Look for the Protection field. Two possible states:

Protection: None                    ← PPL disabled, standard dump works  
Protection: PsProtectedSignerLsa-Light  ← PPL enabled, need driver

Also check the Modules tab — confirm these are loaded:

msv1\_0.dll    ← NTLM credential store  
kerberos.dll  ← Kerberos ticket store  
wdigest.dll   ← cleartext store (if enabled)

What this proves: You can identify exactly what defenses are active before attempting a dump.

Lab 2 — Check if Credential Guard is running

powershell

Get-ComputerInfo | select \*guard\*

Or via GUI:

msinfo32 → System Summary → Virtualization-based security

If Credential Guard is active, you will see `lsaiso.exe` running in Process Hacker. Its presence alone confirms VTL1 is active.

What this proves: You know before touching lsass whether you’ll get usable credentials or encrypted blobs.

Lab 3 — Run Mimikatz (lab VM, no Credential Guard)

```bash
privilege::debug  
sekurlsa::logonpasswords  
sekurlsa::tickets
```

Read the output carefully. Each credential block tells you which DLL sourced it:

```text
Authentication Id : 0 ; 123456  
Package          : NTLM         msv1\_0.dll  
Username         : Administrator  
NTLM             : aad3b435b51404eeaad3b435b51404ee

Package          : Kerberos     kerberos.dll  
[Ticket info here]
```

What this proves: You can see exactly which SSP stored which credential — and understand why disabling wdigest breaks the cleartext output.

## What’s Next
Next → Blog 4: BYOVD Explained — How Attackers Use Signed Drivers to Kill EDRs PPL bypass requires a kernel driver. Blog 4 explains exactly how attackers load one — and why a _signed_ vulnerable driver is more dangerous than unsigned malware.