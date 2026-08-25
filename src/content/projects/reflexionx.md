---
title: "ReflexionX: Autonomous Context-Aware XSS Discovery Pipeline"
description: "A 10-phase context-aware XSS discovery framework featuring reflection classification, Playwright headless browser execution validation, CSP-aware payload generation, and AI agent integration."
pubDate: 2026-05-20
status: "active"
github: "https://github.com/Nimesh-Nakum/ReflexionX"
technologies:
  - "Python"
  - "Playwright"
  - "Go"
  - "AI"
  - "Dalfox"
  - "Katana"
  - "Chromium"
tags:
  - "xss"
  - "bug-bounty"
  - "web-security"
  - "playwright"
  - "browser-automation"
  - "ai-agent"
  - "dalfox"
---

Most Cross-Site Scripting (XSS) scanners stop at *"parameter value is reflected in the HTTP response."* That isn't a confirmed vulnerability — that is merely a candidate reflection point.

**ReflexionX** was designed to eliminate the gap between raw reflection discovery and confirmed execution. It is an autonomous 10-phase XSS hunting pipeline that classifies reflection contexts, parses Content Security Policy (CSP) headers, generates context-tailored payload mutations, and uses a headless Playwright browser to confirm true JavaScript execution before reporting.

---

## The Execution Pipeline

```text
 ┌─────────────────────────────────────────────────────────────────────────┐
 │                     ReflexionX v1.0.0 Pipeline                          │
 ├─────────────────────────────────────────────────────────────────────────┤
 │                                                                         │
 │  Phase 1 · URL Harvesting ──── gau + waybackurls + katana               │
 │  Phase 2 · Pre-Filtering ───── context_manager.py (dedup & strip)       │
 │  Phase 3 · Live Probing ────── httpx probe + WAF fallback               │
 │  Phase 4 · Reflection Check ── curl canary + xss_validator.py           │
 │  Phase 5 · DOM & Cross-Page ── dom_analyzer + cross_page_tracker        │
 │  Phase 6 · Scoring ─────────── score_url() → final_targets.txt          │
 │  Phase 7 · Scanning ────────── dalfox + XSStrike + nuclei + param mine  │
 │  Phase 8 · AI Mutation Agent ─ reflexion_agent.py (via ai_core.py)     │
 │  Phase 9 · Browser Triage ──── Playwright + DOM execution confirmation  │
 │  Phase 10 · Reporting ──────── report.py + CVSS 3.1 generator           │
 └─────────────────────────────────────────────────────────────────────────┘
```

---

## Core Operational Mechanics

### 1. Context-Aware Reflection Classification

Inserting `<script>` tags everywhere is noisy and ineffective against modern web frameworks. ReflexionX inspects where the input canary reflects in the DOM and assigns one of four context types:

- **HTML Body**: Injection lands inside plain HTML (`<div>CANARY</div>`). Break out using HTML tags (`<svg onload=...>`, `<img onerror=...>`).
- **HTML Attribute**: Injection lands inside an attribute (`<input value="CANARY">`). Break out using quotes (`" onfocus=...`) or event handlers (`" autofocus onfocus=...`).
- **JavaScript Block**: Injection lands inside a `<script>` tag (`var data = "CANARY";`). Break out using string terminators (`'; alert(1); //`) or template literals (`${alert(1)}`).
- **JSON Object / REST Endpoint**: Injection lands inside structured JSON (`{"search": "CANARY"}`). Craft valid JSON strings or unicode escapes (`\u003cscript\u003e`).

### 2. CSP-Aware Payload Synthesis

Before generating payloads, ReflexionX parses the target's `Content-Security-Policy` header.
- If `script-src 'self'` blocks inline scripts, ReflexionX skips `<script>` tags and synthesizes inline event handlers (`<img src=x onerror=...>`) or HTML5 media events (`<video src=1 onerror=...>`).
- If nonce or hash enforcement is detected, it evaluates DOM-based XSS vectors and script gadget injection points.

### 3. Playwright Headless Browser Execution Confirmation

A payload reflecting in response HTML is useless if the browser sterilizes it or if CSP blocks execution. ReflexionX launches an automated Chromium instance via **Playwright**:
- Listens for native `dialog` events (`alert`, `confirm`, `prompt`).
- Monitors DOM mutation events for injected node creation.
- Verifies execution in real browser runtime context, eliminating false positives completely.

---

## Features & Arsenal Integration

| Feature | Mechanism | Security Value |
|---|---|---|
| **Multi-Scanner Orchestration** | Integrates `dalfox`, `XSStrike`, `nuclei`, and `arjun` | Combines template scanning with heuristic fuzzing |
| **Hidden Parameter Mining** | Arjun-style brute force (500+ common params) | Uncovers unlinked internal parameter endpoints |
| **Stored XSS Chain Tracker** | Form auto-detection + POST target submission | Tests multi-page stored XSS flows automatically |
| **URL Fragment Injection** | Hashes URL fragments (`#`) for DOM XSS | Identifies client-side sink vulnerabilities |
| **AI Bypass Agent** | Multi-provider LLM integration (OpenRouter/OpenAI/Gemini) | Synthesizes custom bypass payloads when standard rules fail |

---

## Quick Start & Usage

ReflexionX is written in Python 3.8+ and Bash, leveraging Playwright for Chromium automation and Go security binaries for harvesting.

```bash
# Clone repository and install dependencies
git clone https://github.com/Nimesh-Nakum/ReflexionX.git
cd ReflexionX
chmod +x setup.sh reflexionx.sh
./setup.sh

# Run comprehensive scan with browser validation and AI reasoning
./reflexionx.sh -d target.com -V -D -F --ai

# Run stealth mode scan with rate-limiting
./reflexionx.sh -d target.com -V -S
```

---

## Summary for Security Researchers

ReflexionX bridges the gap between passive recon and active browser exploitation. By combining automated parameter harvesting, context classification, AI payload mutation, and Playwright execution verification, researchers can focus exclusively on verified vulnerabilities.

*Source code and installation instructions are published on [GitHub](https://github.com/Nimesh-Nakum/ReflexionX).*
