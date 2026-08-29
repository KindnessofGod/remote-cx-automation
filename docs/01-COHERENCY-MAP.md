# Remote CX AI Automation — Coherency Map

**Purpose:** Resolve the 27 source documents into one coherent, non-contradictory build set. This is the map you read *first*. It tells you, for each use case, which document is the source of truth, what to ignore, and what still needs a decision before Claude Code builds.

> **Superseded by a live reconciliation pass.** §2 and §3 below were this
> project's *first* pass at resolving the 27 raw docs — a recency-based
> "latest verified doc wins" heuristic, done without live-checking claims
> against Remote's real API. A follow-up pass re-resolved every conflict
> ticket-by-ticket, live-verifying claims rather than trusting a doc's own
> confidence label — and found the recency heuristic picked the wrong
> canonical doc more than once (UC-05: the "ignore v1" call was wrong, all
> three docs' scope agreement mattered; UC-08: the recency pick, V2, turned
> out thin on tax logic against v1's stronger engineering; UC-09: DRAFT 1's
> approval-tier table has a real defect, not just a version to prefer).
> **`00-FOUNDATION.md` and `docs/use-cases/UC-0X.md` are the current
> authority; if this file disagrees with them, they win.** Kept here for
> the historical record, not as a build instruction.

---

## 1. The one architecture everything anchors to

All 9 use cases are variations on **one** system, not 9 separate systems. That is the single most important coherency fact. Every use case is:

> A Zendesk ticket → normalized by **n8n** → identity/risk checked → enriched via **Remote MCP (reads)** + **RAG (policy/legal)** → routed by **risk tier** → resolved either **zero-touch**, **human-in-the-loop (HITL)** via a **Zendesk ZAF sidebar**, or **safe-escalated** → any state change executed **deterministically** against the **Remote REST API** → everything **audit-logged**.

The shared layer is specified once in **`00-FOUNDATION.md`**. Each UC spec only describes what is *different* about that use case. This eliminates the biggest source of incoherence in your current docs: the same architecture re-explained (and subtly re-invented) in every file.

Two documents define this shared layer and are both **CANONICAL**, promoted into the foundation:

| Source document | Role |
|---|---|
| `Verifying 9 Use Cases Remote CX AI Architecture Plan.docx` | Master risk-tiering framework + per-UC stress tests |
| `Remote API Integration Capability Analysis — Part 1.docx` | API surface, MCP tiering, technical constraints |

---

## 2. The 9 canonical use cases

| UC | Name | Risk tier | Automation boundary |
|----|------|-----------|---------------------|
| **UC-01** | Employment Verification Letter | 🟢 Low | 100% zero-touch (active employees, standard template) |
| **UC-02** | Expense Category & Receipt Validation | 🟢 Low | Zero-touch pre-validation + HITL for exceptions |
| **UC-03** | Travel Support Letter / Workation Inquiry | 🟢 Low | Zero-touch informational + HITL if formal letter issued |
| **UC-04** | Remote Work Authorization / Workation (<30d) | 🟡 Medium | HITL execution (AI gathers facts + risk-scores; specialist 1-clicks) |
| **UC-05** | Offboarding & Notice Period Calculation | 🟡 Medium | HITL prepared workflow (AI calculates; specialist submits) |
| **UC-06** | Contract Amendment / Payroll Cutoff | 🟡 Medium | HITL gated, dual control (Admin + Payroll specialist) |
| **UC-07** | Global Mobility / Permanent Relocation | 🔴 High | Safe escalation — AI research/dossier only, zero autonomous execution |
| **UC-08** | Cross-Border Tax & Social Security Review | 🔴 High | Safe escalation — AI compiles context; human authors guidance |
| **UC-09** | Off-Cycle Payroll / Adjustment | 🔴 High | Dual human approval gate (Admin + Payroll specialist) |

This tiering is the spine. Low-risk UCs prove *zero-touch resolution*. Medium-risk UCs prove *judgment about when to gate a human*. High-risk UCs prove *knowing when NOT to automate* — which is the hardest of the three to get right.

---

## 3. Version reconciliation — which file wins

You have multiple versions per UC (ChatGPT v1/v2, "verified against Gemini", deep-dive research). Rule applied: **the latest verified build document is canonical; earlier versions are superseded; deep-dive research docs are supporting evidence, not build instructions.**

| UC | ✅ CANONICAL (build from this) | 📎 Supporting (evidence only) | 🗑️ Superseded (ignore) |
|----|------|------|------|
| UC-01 | `UC-01 BUILD CASE ChatGpt — EMPLOYMENT VERIFICATION` | `Remote UC-01 … Deep-Dive Research` | — |
| UC-02 | `UC-02 ChatGpt Verified Against Gemini` | `Remote UC-02 … Deep-Dive Technical Blueprint`; `UC-02 — BUild Case … Receipt Validation Engine` | — |
| UC-03 | `UC-03 — ChaGot Verified against Gemini` (pdf) | `Remote UC-03 … Research Blueprint`; `UC-03 Chatgpt BUILD CASE _ PACK` (pdf) | — |
| UC-04 | `UC-04 BUILDPACK v2.0` | `UC-04 — ChatGPT verified against Gemini`; `Remote UC-04 … Deep-Dive Research Specification` | — |
| UC-05 | `UC-05 CHATGOT … Build Specification & Implementation Pack` | `Remote UC-05 V2 … Research Specification` | `Remote UC-05 v1 … Research Plan` |
| UC-06 | `UC-06 Chatgpt v2. BUILD PACK` | `Remote UC-06 … Research Plan` | `UC-06 ChatGpt v1 Build Specification` |
| UC-07 | `UC-07 Build Pack By Chatgpt` | `Remote UC-07 … Research Plan` | `UC-07 ChatGPT v1` |
| UC-08 | `UC-08 ChatGpt V2 BUILD CASE (Zendesk and n8n)` | `UC-08_ GEMINI … Comprehensive Research` (deepest evidence, 9.2k words) | `UC-08 ChatGpt v1 BUILD PACK v1` |
| UC-09 | `UC-09 Chatgpt BUILD CASE` | `UC-09 _ DRAFT 1 … Architecture Research` | — |

**Action:** Only the CANONICAL column feeds the unified UC specs. Supporting docs are cited for *evidence level* (see foundation §evidence hierarchy). Superseded docs should be moved to an `/archive` folder so they never confuse Claude Code.

---

## 4. Conflicts & gaps to resolve BEFORE build

These are the real blockers. Each needs a one-line decision from you (defaults proposed):

1. **UC-04 has two build-quality docs** (`BUILDPACK v2.0` and `verified against Gemini`). They largely agree, but v2.0 is more recent and detailed. → *Default: v2.0 canonical, Gemini doc used only to cross-check the country risk-matrix.*

2. **Endpoint schemas are asserted, not verified.** Your API capability doc honestly flags many endpoints as "confirmed by title, schema needs verification." Before building writes (UC-02, UC-05, UC-06, UC-09), the exact request/response schema must be pulled from `developer.remote.com/llms.txt` (OpenAPI). → *Default: Claude Code fetches the live OpenAPI spec at build time and validates every payload against it.*

3. **Real Remote API access.** You almost certainly cannot get a production Remote tenant for a portfolio. → *Default: build against the Remote **Sandbox** (the capability doc confirms sandbox endpoints exist) + a local **mock server** that mirrors the OpenAPI schema, so the whole thing runs end-to-end without a real customer account. This becomes your "Remote CX Automation Test Harness" — itself a strong portfolio artifact.*

4. **Zendesk instance.** ZAF sidebar apps need a Zendesk instance. → *Default: free Zendesk developer/trial account; the ZAF app is real code you can demo.*

5. **RAG content.** UC-03/04/07/08 depend on policy/legal RAG stores. You don't have Remote's internal policies. → *Default: build the RAG pipeline for real, seed it with Remote's **public** policy/handbook content + clearly-labeled synthetic policy docs, so retrieval is demonstrably real even if the corpus is illustrative.*

6. **Money & schema invariants** (integer ×100 scaling; per-country dynamic JSON schema) are mentioned inconsistently across UC docs. → *Resolved in foundation: enforced once as shared middleware, every UC inherits it.*

---

## 5. Recommended build sequence

Build in risk order — it compounds. Each tier reuses the previous tier's shared components.

1. **Foundation first** (`00-FOUNDATION.md`): repo scaffold, n8n, mock Remote server + sandbox client, MCP read client, identity/risk engine, audit logger, ZAF app shell, RAG pipeline. *Nothing else can be built until this exists.*
2. **UC-01** (pure zero-touch) — proves the end-to-end spine with the least risk. **This is your flagship demo.**
3. **UC-02, UC-03** — add OCR/vision (02) and RAG retrieval (03) on the same spine.
4. **UC-04, UC-05, UC-06** — add the HITL ZAF approval pattern and deterministic calculators.
5. **UC-07, UC-08, UC-09** — add safe-escalation + dossier generation + dual-approval.

---

## 6. What "done" looks like for the hand-off

The specification set lives in `docs/`: this map, `00-FOUNDATION.md`, `UC-01.md` … `UC-09.md` (one unified template each), and a `CLAUDE.md` build-instruction file. You point Claude Code at `docs/` and it builds tier by tier. No source `.docx` reading required by Claude Code — everything it needs is distilled into these specs.
