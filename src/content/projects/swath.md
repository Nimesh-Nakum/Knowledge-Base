---
title: "SWATH: AI-Powered Red Team Reconnaissance & Bug Hunting Framework"
description: "A 31-tool containerized reconnaissance orchestrator featuring 7-phase tag-driven execution, autonomous WAF evasion, Metasploit-style console, and OpenRouter AI methodology generation."
pubDate: 2026-05-15
status: "active"
github: "https://github.com/SWATH-Project/SWATH---AI-Powered-Bug-Hunter"
technologies:
  - "Python"
  - "Docker"
  - "Go"
  - "AI"
  - "OpenRouter"
  - "Security Automation"
  - "Reconnaissance"
tags:
  - "red-team"
  - "reconnaissance"
  - "bug-bounty"
  - "automation"
  - "docker"
  - "ai"
  - "waf-evasion"
---

Reconnaissance in modern offensive security is broken. Most automated recon frameworks are bloated museum exhibits of 50+ unmaintained tools that spit out gigabytes of raw logs, trigger WAF rate limits in seconds, and freeze host machines with unthrottled thread pools.

**SWATH (Surgical Web Asset Tracking & Hunting)** was built to solve this noise problem. It is a strict, containerized reconnaissance orchestrator designed around four operational pillars: **surgical precision**, **autonomous WAF evasion**, **tag-driven conditional execution**, and **resource-aware thread scheduling**.

Instead of firing every tool sequentially, SWATH executes a 7-phase pipeline governed by real-time intelligence tags. Tools run only when prerequisite conditions are met, downstream flags adapt dynamically based on detected defenses, and an interactive Metasploit-style console gives operators full control over the engagement.

---

## Architectural Principles

```text
 ┌─────────────────────────────────────────────────────────────────────────┐
 │                       SWATH System Architecture                         │
 ├─────────────────────────────────────────────────────────────────────────┤
 │                                                                         │
 │  Phase 1 · Passive Recon ────── Subfinder + Crtsh (0% SOC visibility)   │
 │  Phase 2 · Secrets & OSINT ──── Gitleaks + Trufflehog (local execution)  │
 │  Phase 3 · Live Asset Probe ─── Httpx + Naabu + WAF Fingerprinting      │
 │  Phase 4 · Surface Intel ────── WhatWeb + Wappalyzer (tech tagging)    │
 │  Phase 5 · Enumeration ──────── Katana + GAU + ParamSpider + Arjun     │
 │  Phase 6 · Content Discovery ── FFUF + WPScan (heavy fuzzing)           │
 │  Phase 7 · Vuln Scanning ────── Nuclei + Subjack + Dalfox (GATED y/N)  │
 │                                                                         │
 │  Engine Core: TagManager | BudgetTracker | ScopeEnforcer | DiffEngine   │
 └─────────────────────────────────────────────────────────────────────────┘
```

### 1. Tag-Driven Conditional Execution

Traditional scanners follow a linear script: run Tool A, run Tool B, run Tool C. SWATH replaces linear execution with a **Tag Manager Graph**. Every tool emits standardized intelligence tags with confidence tiers (`low`, `medium`, `high`).

For example:
- `httpx` discovers an active HTTP endpoint → emits `has_live_web`.
- `httpx` parses Cloudflare headers → emits `has_waf` (confidence: `high`).
- `wappalyzer` detects WordPress → emits `has_wordpress`.

Downstream tools use YAML-defined `if_tag` gates. `wpscan` only executes if `has_wordpress` is present. `arjun` only fires if `has_api` is detected. `dalfox` only launches if `params_found` exists. If Phase 1 yields zero subdomains, the entire pipeline aborts cleanly.

### 2. Autonomous WAF Evasion Engine

When Phase 3 detects a WAF with high confidence, SWATH doesn't crash into a 429 block. The core execution handler (`base_module._run_subprocess()`) dynamically injects evasion flags into all downstream tool invocations:
- Auto-injects rate-limiting delays (`-rate-limit 15` or `-p 0.2`).
- Rotates User-Agent headers across legitimate browser signatures.
- Adjusts concurrency based on selected stealth profiles (`ghost`, `ninja`, `blitz`).

---

## The 7-Phase Execution Pipeline

| Phase | Category | Curated Tools | Key Emitted Tags | Human Gate |
|---|---|---|---|:---:|
| **Phase 1** | Passive Recon | `subfinder`, `crtsh` | `has_subdomains` | No |
| **Phase 2** | Secrets & OSINT | `gitleaks`, `trufflehog` | `leaked_credentials` | No |
| **Phase 3** | Live Asset Discovery | `httpx`, `naabu`, `dnsx`, `tlsx` | `has_live_web`, `has_waf`, `has_open_ports` | No |
| **Phase 4** | Surface Intelligence | `whatweb`, `wappalyzer` | `has_wordpress`, `has_api`, `has_graphql` | No |
| **Phase 5** | Parameter Enumeration | `katana`, `gau`, `paramspider`, `arjun` | `params_found`, `hidden_params_found` | No |
| **Phase 6** | Content Discovery | `ffuf`, `wpscan` | `admin_panel_found`, `backup_files_found` | No |
| **Phase 7** | Vulnerability Scanning | `nuclei`, `subjack`, `dalfox`, `sqlmap` | `xss_found`, `sqli_found`, `critical_vulns` | **Yes (y/N)** |

> **The Phase 7 Human Gate**: Before initiating aggressive vulnerability scanning (Phase 7), SWATH pauses execution and presents a structured recon summary (subdomain count, live web hosts, technology stack, WAF presence, and open ports). The operator must explicitly confirm (`y/N`) before active exploit probes fire against production infrastructure.

---

## Operator Features

### Metasploit-Style Interactive Console

Operators can launch an interactive REPL console to control scans, inspect historical database records, and tune settings dynamically:

```bash
python3 swath.py interactive
```

```text
  ██╗  ██╗██╗   ██╗██████╗ ███╗   ██╗███████╗
  ██║  ██║██║   ██║██╔══██╗████╗  ██║██╔════╝
  ███████║██║   ██║██████╔╝██╔██╗ ██║█████╗  
  swath (v2.1.0-console) > use target.com
  [+] Active target set to: target.com
  swath (target.com) > set profile ninja
  [+] Profile set to: ninja (Stealth: High, Concurrency: 4)
  swath (target.com) > scan quick
  swath (target.com) > show findings --severity critical
```

### Continuous Monitoring & Diff Engine

SWATH integrates a persistent SQLite database (`~/.swath/history.db`). Running `swath monitor target.com` on a cron schedule compares historical asset snapshots using the `DiffEngine`:
- Alerts on newly discovered subdomains.
- Highlights newly opened ports or changed SSL certificates.
- Pushes instant async notifications to Discord, Slack, or Telegram webhooks.

### AI Methodology Generator & Executive Reporting

Powered by OpenRouter (`gemini-2.5-flash`), SWATH includes two AI-driven capabilities:
1. **Natural Language Methodology Generator**: Operators specify an objective in plain English (e.g., *"Perform stealthy API parameter discovery without triggering Cloudflare"*). The AI generates a validated YAML pipeline with correct tool names and conditional gates.
2. **AI Executive Report Synthesizer**: Converts raw tool outputs, tag graphs, and CVSS 3.1 severity scores into client-ready Markdown reports.

---

## Installation & Quick Start

SWATH runs inside a hardened Kali Docker container with pre-configured Go tools, Python dependencies, and resource limits (4GB RAM cap).

```bash
# Clone the repository
git clone https://github.com/SWATH-Project/SWATH---AI-Powered-Bug-Hunter.git
cd SWATH---AI-Powered-Bug-Hunter

# Build hardened container
docker build -t swath-kali -f Dockerfile.kali .

# Launch interactive CLI scan
python3 swath.py scan -d target.com --profile ninja
```

---

## Key Takeaways for Red Teamers

1. **Signal Over Noise**: Firing 31 tools conditionally based on real-time tags yields vastly cleaner data than running uncoordinated scripts.
2. **Deterministic WAF Adaptation**: Parsing WAF signatures early in the pipeline prevents IP burns during later enumeration phases.
3. **Containerized Portability**: Docker encapsulation guarantees identical tool dependencies and execution behavior across security infrastructure.

*Project source code and documentation are available on [GitHub](https://github.com/SWATH-Project/SWATH---AI-Powered-Bug-Hunter).*
