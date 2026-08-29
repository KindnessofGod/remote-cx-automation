# Load test results

**What this is:** real `autocannon` numbers against every use case's HTTP
API, produced by `scripts/loadtest.mjs` (light mode by default via
`npm run loadtest`; full sweep via `node scripts/loadtest.mjs --full`).
Captured 2026-08-09.

**What this is NOT:** proof this system handles 10K+ requests against real
infrastructure. Read "What was and wasn't validated" below before quoting
any number from this file.

## What was measured

Every server (`review-api` for UC-01's HITL queue, `uc02-api` … `uc09-api`)
was started **in this one process**, seeded exactly the way its own
`npm run ucNN-api` seeds it — same seed data, same in-memory stores, same
local mock Remote server. No real network call is made anywhere in this
script: OpenAI, Zendesk, the real Remote Sandbox, and real Postgres are
never touched (this container's egress is blocked to those hosts regardless,
and hitting them under synthetic load is explicitly out of scope — see
`docs/HANDOFF-2026-08-09.md` §4 item BA-3).

This measures **one Node process, one OS thread, one unbounded in-memory
array as the store, on this container's hardware.** It is a real, honest
number for exactly that path. It is not a proxy for what a Supabase-backed
production deployment would do under the same load — `src/shared/db.js`'s
`pg.Pool({max: 10})` is never exercised here (no `SUPABASE_DB_URL` is set,
so every store runs the same in-memory fallback `caseStore.js` already uses
when unconfigured).

## Why most use cases only get a read-route number

Only UC-02's `POST /api/expenses` is safely repeatable at high concurrency —
a genuine "create a new record" intake route with no per-record decision
limit. Every other use case's only write route (UC-01's approve/deny,
UC-04/05/06/09's approve/deny/signoff) is a **single-decision gate** on a
small, fixed set of seeded ids: the first concurrent request to reach the
gate decides it, and every request after that legitimately 409s
(`already_decided` / `not_awaiting_review`). None of these APIs has an
intake route that mints a fresh decidable case per request, so hammering the
gate at 1000 connections would mostly measure how fast the store says
"no, already decided" — a real number, but not a comparable write benchmark,
and not worth the false impression that all nine use cases got one.
UC-03/07/08 define no write route in the file at all, by design (UC-03's
formal sign-off is out of scope for this build; UC-07/UC-08 are the two
🔴-tier use cases with **no execution path**, structurally, not just
behaviorally).

| Use case | Excluded write route | Why |
|---|---|---|
| UC-01 (review) | `POST /api/review/ticket/:id/approve\|deny` | Single-decision gate on the one seeded `human_review` ticket (2001); no intake route to mint a fresh one. |
| UC-03 | — | No POST/PATCH route exists in the file at all. |
| UC-04 | `POST /api/authorizations/:id/approve\|deny` | Single-specialist, single-decision gate on a fixed seeded id. |
| UC-05 | `POST /api/resignations/:id/signoff\|deny` | Single HR-Ops sign-off gate on a fixed seeded id; UC-05 has no Remote write endpoint at all. |
| UC-06 | `POST /api/amendments/:id/approve\|deny` | Needs both dual-approval role slots filled once on a fixed seeded id. |
| UC-07 | — | No POST route exists, by design — no-execution-path use case. |
| UC-08 | — | No POST route exists, by design — no-execution-path use case. |
| UC-09 | `POST /api/adjustments/:id/approve\|deny` | Needs 2–3 multi-approval role slots filled once on a fixed seeded id (real-money path). |

## Results — full sweep (10 s per phase, 10 → 100 → 1000 connections)

| Use case | Route | Kind | Conn | Requests | Errors | p50 ms | p90 ms | p97.5 ms | p99 ms | req/s (avg) |
|---|---|---|---|---|---|---|---|---|---|---|
| UC-01 review | `/api/review/ticket/2004` | read | 10 | 153,685 | 0 | 0 | 0 | 1 | 2 | 13,971 |
| UC-01 review | `/api/review/ticket/2004` | read | 100 | 117,650 | 0 | 7 | 13 | 16 | 18 | 11,766 |
| UC-01 review | `/api/review/ticket/2004` | read | 1000 | 123,903 | 298 | 38 | 54 | 66 | 81 | 12,391 |
| UC-02 | `/api/expenses` | read | 10 | 170,820 | 0 | 0 | 0 | 1 | 1 | 15,529 |
| UC-02 | `/api/expenses` | write | 10 | 9,435 | 0 | 8 | 15 | 23 | 27 | 944 |
| UC-02 | `/api/expenses` | read | 100 | 258 | 56 | 1,267 | 2,225 | 7,580 | 9,363 | 29 |
| UC-02 | `/api/expenses` | write | 100 | 5,408 | 0 | 129 | 221 | 327 | 2,096 | 541 |
| UC-02 | `/api/expenses` | read | 1000 | 143 | 770 | 1,711 | 4,539 | 8,668 | 9,550 | 16 |
| UC-02 | `/api/expenses` | write | 1000 | 0 | 1,000 | — | — | — | — | 0 |
| UC-03 | `/api/cases/by-ticket/9001` | read | 10 | 108,965 | 0 | 0 | 1 | 2 | 4 | 10,896 |
| UC-03 | `/api/cases/by-ticket/9001` | read | 100 | 99,350 | 0 | 9 | 13 | 16 | 19 | 9,935 |
| UC-03 | `/api/cases/by-ticket/9001` | read | 1000 | 99,539 | 371 | 39 | 58 | 69 | 85 | 9,955 |
| UC-04 | `/api/authorizations/by-ticket/4001` | read | 10 | 107,360 | 0 | 0 | 1 | 4 | 5 | 10,736 |
| UC-04 | `/api/authorizations/by-ticket/4001` | read | 100 | 134,200 | 0 | 6 | 9 | 11 | 13 | 13,422 |
| UC-04 | `/api/authorizations/by-ticket/4001` | read | 1000 | 120,056 | 312 | 38 | 61 | 68 | 86 | 12,006 |
| UC-05 | `/api/resignations/by-ticket/5001` | read | 10 | 123,035 | 0 | 0 | 0 | 2 | 4 | 12,303 |
| UC-05 | `/api/resignations/by-ticket/5001` | read | 100 | 133,700 | 0 | 6 | 9 | 12 | 14 | 13,371 |
| UC-05 | `/api/resignations/by-ticket/5001` | read | 1000 | 124,608 | 296 | 40 | 51 | 55 | 67 | 12,462 |
| UC-06 | `/api/amendments/by-ticket/3001` | read | 10 | 163,645 | 0 | 0 | 0 | 1 | 1 | 14,877 |
| UC-06 | `/api/amendments/by-ticket/3001` | read | 100 | 144,550 | 0 | 6 | 8 | 9 | 9 | 14,457 |
| UC-06 | `/api/amendments/by-ticket/3001` | read | 1000 | 96,721 | 379 | 38 | 55 | 82 | 111 | 9,673 |
| UC-07 | `/api/dossiers/by-ticket/9001` | read | 10 | 109,200 | 0 | 0 | 1 | 1 | 2 | 9,928 |
| UC-07 | `/api/dossiers/by-ticket/9001` | read | 100 | 99,300 | 0 | 9 | 11 | 12 | 16 | 9,930 |
| UC-07 | `/api/dossiers/by-ticket/9001` | read | 1000 | 84,680 | 420 | 44 | 79 | 98 | 125 | 8,469 |
| UC-08 | `/api/dossiers/by-ticket/8001` | read | 10 | 142,030 | 0 | 0 | 0 | 1 | 2 | 12,912 |
| UC-08 | `/api/dossiers/by-ticket/8001` | read | 100 | 124,950 | 0 | 7 | 9 | 10 | 10 | 12,496 |
| UC-08 | `/api/dossiers/by-ticket/8001` | read | 1000 | 109,228 | 342 | 45 | 57 | 72 | 84 | 10,923 |
| UC-09 | `/api/adjustments/by-ticket/9001` | read | 10 | 146,805 | 0 | 0 | 0 | 1 | 1 | 14,680 |
| UC-09 | `/api/adjustments/by-ticket/9001` | read | 100 | 139,850 | 0 | 6 | 8 | 9 | 10 | 13,986 |
| UC-09 | `/api/adjustments/by-ticket/9001` | read | 1000 | 119,025 | 311 | 40 | 57 | 61 | 67 | 11,903 |

## Two real findings, not just numbers

**1. A single-process ceiling exists around 1000 concurrent connections.**
Every by-id/by-ticket read route stays clean (0 errors) at 10 and 100
connections, then shows a consistent few-hundred connection-level errors at
1000 (298–420 across the board). This is one Node event loop on one thread
saturating — not a code defect, and not evidence about how a
horizontally-scaled or clustered deployment would behave. It is the honest
ceiling of *this* configuration.

**2. UC-02's `GET /api/expenses` list route degrades severely once the
write-phase load has run.** Its read throughput craters from 170,820
requests at 10 connections (before any writes) to 258 requests at 100
connections and 143 at 1000 — both *after* a write-load phase had already
added ~15,000 records to the same in-memory array. `GET /api/expenses`
returns the *entire* unbounded list on every call (no pagination), so once
the store has grown from write-load, every subsequent read request pays an
increasing serialization cost, compounding under concurrent write traffic on
the same single-threaded process. The write route itself also collapsed
completely at 1000 connections (0 successful requests, 1,000 errors) for the
same underlying reason — one process, one thread, one growing array, no
pagination, no backpressure. **This is a real, load-test-only finding: it is
the one route in the whole sweep that shows a genuine scalability gap in the
current implementation** (unbounded list response + no pagination), not
merely a single-process ceiling like finding #1. It would be the first place
to add pagination if this store size or request volume were expected in
production.

## What was and wasn't validated

**Validated:** the pure request-routing and in-memory-store logic path,
under real concurrent HTTP load, for all 9 use cases' primary read route
plus UC-02's write route — with real, captured p50/p90/p97.5/p99 latencies
and throughput, not estimates.

**NOT validated:**
- Any Supabase-backed persistence path (`SUPABASE_DB_URL` unset throughout —
  every store ran its in-memory fallback). `src/shared/db.js`'s
  `pg.Pool({max: 10})` is untuned and, once real Postgres writes are in the
  path, is the most likely actual bottleneck — smaller by roughly two orders
  of magnitude than anything measured here. This has not been tested.
- Real OpenAI/Remote Sandbox/Zendesk latency or failure modes under load —
  every seeded call in this script uses the rule-based/mock fallback path.
- Multi-process/clustered deployment behavior.
- Any claim that this system "handles 10K+" requests in production. Nothing
  in this file proves that, and nothing in this file should be read as
  implying it.

## Reproduce

```bash
npm run loadtest              # light mode: 10/50 connections, fast, safe to run casually
node scripts/loadtest.mjs --full   # the full 10 → 100 → 1000 sweep behind this file's numbers — heavy, several minutes
node scripts/loadtest.mjs --full --out=results.json   # also write raw JSON
```
