# WALKTHROUGH — all 9 use cases, over real HTTP, zero credentials

`npm run walkthrough` (`scripts/walkthrough.mjs`) is the one command that
proves every use case's HTTP API actually works, end to end, against its own
seeded data — not `npm test`'s internal function calls, real `fetch()`
requests against a real server on a real port, exactly like the `curl`
commands below. It starts each use case's server one at a time (identical to
`npm run ucNN-api`, forced into `--seeded` mode so it never needs
credentials), waits for `/healthz`, runs the calls, prints a labeled summary,
then shuts that server down cleanly before starting the next one — so this
file's ports never collide with each other.

`npm test` covers correctness (1105 tests, hermetic, no network). This script
and this file cover "does it actually run" — the same distinction the
project's own gotchas section (`CLAUDE.md` §6) draws for n8n: a green test is
not evidence an integration works end to end.

**Read-only vs. has a real write/approval endpoint — stated once, honestly,
so nothing below overclaims:**

| Use case | Tier | Approval / write surface |
|---|---|---|
| UC-01 Employment Verification | 🟡 | Single-specialist HITL via the **review API** (`/api/review/ticket/:id/approve\|deny`) — writes `audit_log`, issues a letter on approval |
| UC-02 Expense & Receipt Validation | 🟢 | Auto-executes internally (`PATCH /v1/expenses/:id`) on submission — no human approval endpoint; exceptions route to Finance Ops outside this API |
| UC-03 Travel Support Letter router | 🟢 | Has three sign-off write routes; only UC-07 and UC-08 have no POST route — a thin router, deliberately no compliance logic or sign-off of its own (see `docs/use-cases/UC-03.md`) |
| UC-04 Work Authorization / Workation | 🟡 | Single mobility-specialist approval (`/api/authorizations/:id/approve\|deny`) |
| UC-05 Resignation Notice Calculation | 🟡 | Single HR Ops sign-off (`/api/resignations/:id/signoff` or `/deny`) — no Remote write endpoint exists (spec-confirmed); the signed-off report is the durable artifact |
| UC-06 Contract Amendment / Payroll Cutoff | 🟡 | **Dual** approval, two named roles (`/api/amendments/:id/approve\|deny`, `role: customer_admin \| payroll_specialist`) — executes a real `PATCH` only once both slots are filled |
| UC-07 Global Mobility / Permanent Relocation | 🔴 | **Read-only, deliberately.** No POST route exists anywhere in `src/uc07/server.js` — this is the point: a 🔴 use case with no execution path, not merely one that refuses at runtime |
| UC-08 Cross-Border Tax & Social Security | 🔴 | **Read-only, deliberately.** Same guarantee as UC-07 — no POST route exists in `src/uc08/server.js` |
| UC-09 Off-Cycle Payroll / Adjustment | 🔴-framed, **has execution** | Multi-role approval, floor of 2 (`/api/adjustments/:id/approve\|deny`, `role: requester \| approver \| payment_releaser`) — 2 slots for standard cases, 3 for high-risk; `Math.max(2, ...)` never lets risk drop the floor below 2 |

Every `GET .../by-ticket/:externalRef` route below is the one the walkthrough
script itself calls. `POST`/approval bodies shown are the exact shapes
`submit*Approval()` expects — see each `src/ucNN/server.js` for the literal
route table.

---

## UC-01 — Employment Verification (🟡, review API)

```bash
npm run review-api -- --seeded --port 4020
# seeds tickets 2001 (human_review), 2002 (human_review), 2003 (escalate), 2004 (auto_resolve)

curl -s http://localhost:4020/api/review/ticket/2001

curl -s -X POST http://localhost:4020/api/review/ticket/2001/approve \
  -H 'Content-Type: application/json' -H 'X-ZAF-Approver: demo.specialist@example.com' \
  -d '{"note":"Verified via curl."}'
# -> 200 human_approved, letterIssued: true

# a decided case refuses a second decision (409 not_awaiting_review)
curl -s -X POST http://localhost:4020/api/review/ticket/2001/approve \
  -H 'Content-Type: application/json' -H 'X-ZAF-Approver: demo.specialist@example.com' \
  -d '{"note":"second attempt"}'

# an escalation has no approve button (403 no_review_path)
curl -s -X POST http://localhost:4020/api/review/ticket/2003/approve \
  -H 'Content-Type: application/json' -H 'X-ZAF-Approver: demo.specialist@example.com' \
  -d '{"note":"should be refused"}'
```

## UC-02 — Expense & Receipt Validation (🟢, auto-execute)

```bash
npm run uc02-api -- --port 4050
# seeds ticket-2001 (auto_approve), ticket-2002 (human_review, over policy cap),
# ticket-2003 (blocked, duplicate)

curl -s http://localhost:4050/api/expenses/by-ticket/ticket-2001

# the intake route a real claim submission hits — auto-executes internally,
# there is no separate human-approval endpoint to call afterward
curl -s -X POST http://localhost:4050/api/expenses \
  -H 'Content-Type: application/json' \
  -d '{"expenseId":"exp_auto_101","employmentId":"emp_active_001"}'
```

## UC-03 — Travel Support Letter router (🟢)

```bash
npm run uc03-api -- --seeded --port 4051
# seeds 9001 (auto_resolve), 9002 (route_to_uc04), 9003 (human_review)

curl -s http://localhost:4051/api/cases/by-ticket/9001

# there is no POST route — confirms the 404, not a runtime refusal
curl -s -X POST http://localhost:4051/api/cases -d '{}'
```

## UC-04 — Work Authorization / Workation (🟡, single specialist)

```bash
npm run uc04-api -- --seeded --port 4052
# seeds 4001 (ready_for_approval), 4002 (blocked), 4003 (escalate)

curl -s http://localhost:4052/api/authorizations/by-ticket/4001

curl -s -X POST http://localhost:4052/api/authorizations/<id>/approve \
  -H 'Content-Type: application/json' \
  -d '{"approver":"demo.specialist@example.com","note":"Approved via curl."}'
# -> 200 executed

# a blocked authorization is never open to approval (403 not_awaiting_approval)
curl -s -X POST http://localhost:4052/api/authorizations/<id>/approve \
  -H 'Content-Type: application/json' -d '{"approver":"demo.specialist@example.com"}'
```

## UC-05 — Resignation Notice Calculation (🟡, single HR Ops sign-off)

```bash
npm run uc05-api -- --seeded --port 4053
# seeds 5001/5002 (prepared_for_signoff), 5003 (escalate — statutory discrepancy)

curl -s http://localhost:4053/api/resignations/by-ticket/5001

curl -s -X POST http://localhost:4053/api/resignations/<id>/signoff \
  -H 'Content-Type: application/json' \
  -d '{"approver":"hrops@example.com","note":"Signed off via curl."}'
# -> 200 signed_off — no Remote write route exists (UC-05.md §3); the signed
# report itself is the durable artifact, there is nothing further to execute
```

## UC-06 — Contract Amendment / Payroll Cutoff (🟡, DUAL approval)

```bash
npm run uc06-api -- --seeded --port 4021
# seeds 3001 (dual_approval_required), 3002 (escalate — cutoff passed),
# 3003 (dual_approval_required, urgent_cutoff)

curl -s http://localhost:4021/api/amendments/by-ticket/3001

curl -s -X POST http://localhost:4021/api/amendments/<id>/approve \
  -H 'Content-Type: application/json' \
  -d '{"role":"customer_admin","approver":"admin@example.com","note":"1/2"}'
# -> 200 approved_awaiting_second

curl -s -X POST http://localhost:4021/api/amendments/<id>/approve \
  -H 'Content-Type: application/json' \
  -d '{"role":"payroll_specialist","approver":"payroll@example.com","note":"2/2"}'
# -> 200 executed — the real PATCH fires only now, both slots filled
```

## UC-07 — Global Mobility / Permanent Relocation (🔴, NO execution path)

```bash
npm run uc07-api -- --seeded --port 4054
# seeds 9001 (verdict PROCEED), 9002 (verdict BLOCK), 9003 (verdict REVIEW)
# every row's decision is "escalate" — always, by design; only the dossier's
# own feasibility verdict varies

curl -s http://localhost:4054/api/dossiers/by-ticket/9001

# there is no POST route anywhere in src/uc07/server.js — confirms the 404
curl -s -X POST http://localhost:4054/api/dossiers -d '{}'
```

## UC-08 — Cross-Border Tax & Social Security (🔴, NO execution path)

```bash
npm run uc08-api -- --seeded --port 4023
# seeds 8001 (dual_residency), 8002 (withholding), 8003 (totalization)
# every row's decision is "escalate" — always, by design

curl -s http://localhost:4023/api/dossiers/by-ticket/8001

# there is no POST route anywhere in src/uc08/server.js — confirms the 404
curl -s -X POST http://localhost:4023/api/dossiers -d '{}'
```

## UC-09 — Off-Cycle Payroll / Adjustment (🔴-framed, WITH execution)

```bash
npm run uc09-api -- --seeded --port 4055
# seeds 9001 (dual_approval_required, 2 slots), 9002/9003 (triple_approval_required, 3 slots)

curl -s http://localhost:4055/api/adjustments/by-ticket/9001

# 2-of-2 flow (ticket 9001)
curl -s -X POST http://localhost:4055/api/adjustments/<id>/approve \
  -H 'Content-Type: application/json' -d '{"role":"requester","approver":"requester@example.com","note":"1/2"}'
curl -s -X POST http://localhost:4055/api/adjustments/<id>/approve \
  -H 'Content-Type: application/json' -d '{"role":"approver","approver":"approver@example.com","note":"2/2"}'
# -> 200 executed on the second call — real incentive write fires against the mock Remote

# 3-of-3 flow (ticket 9002) — requester, approver, THEN payment_releaser;
# the floor never drops to 2 for a high-risk case even after 2 approvals land
curl -s -X POST http://localhost:4055/api/adjustments/<id>/approve \
  -H 'Content-Type: application/json' -d '{"role":"payment_releaser","approver":"releaser@example.com","note":"3/3"}'
```

---

## Running it

```bash
npm run walkthrough
```

Zero credentials required — every server above is forced into its offline
`--seeded` mode, seeding an in-memory store against the local mock Remote (or,
for UC-07/UC-08, no Remote dependency at all). Nothing is persisted between
runs. Expect ~10–20 seconds total: nine server boots plus one review-API boot,
each with a `/healthz` poll before any request is sent.

The script exits non-zero if any check hits an unexpected HTTP status — the
expected refusals (403/404/409 above) are asserted as *expected*, not treated
as failures. A clean run ends with:

```
==============================================================================
Summary
==============================================================================
49/49 checks completed without an unexpected error.
All nine use cases walked end to end over real HTTP against their seeded data.
```

**Shared-environment note:** every port above (4020–4055) is fixed, matching
`npm run ucNN-api`'s own documented port. If another process on the same
machine is already bound to one of them — including, in a container shared
with other concurrent sessions, a *different* worktree's server left running
— the affected use case's `withServer()` block reports the failure and the
script moves on to the next use case rather than hanging. Free the port (or
wait for the other process to exit) and re-run.
