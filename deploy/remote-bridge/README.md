# Remote Sandbox stand-in

Proxies **reads** to the real Remote Sandbox and completes the two things that
account leaves incomplete. Point n8n's Remote base URL here instead of
`gateway.remote-sandbox.com`.

- **No credentials are stored.** The caller's `Authorization` header is
  forwarded upstream untouched, so n8n keeps using its own Remote credential.
- **Writes return 405.** A stand-in must never fake a state change.
- **An unreachable upstream returns 502**, never an invented record.
- **Everything synthesized is named** in a response header and a `_standin`
  block. A real value is never overwritten.

Source of truth is `src/remotebridge/` in the main repo; `lib/` here holds byte
copies, held together by `test/remoteBridgeDeployParity.test.js`.

## What it completes, and the one rule both halves obey

The rule is the same in both cases, rotated one dimension: **fill only what the
Sandbox left empty.**

| | Empty thing | Rule | Marker |
|---|---|---|---|
| `enrichment.js` | a **field** (`start_date`, `custom_fields`, `address_details`) | fill only a null field, never overwrite | `X-Standin-Enriched` |
| `payrollProjection.js` | a **period** — the calendar stops mid-2026 | append only after a country's last real `period_end` | `X-Standin-Projected-Cycles`, ids prefixed `standin-` |

Fields serve UC-04 (`workation_permission`) and UC-05 (`start_date`), which
would otherwise block or escalate every request. Periods serve **UC-06**: live,
the last cycle ends 2026-06-30 (2026-07-31 for NL), so every future amendment
date reaches `noMatchingCycle` and the use case can only ever be demonstrated
refusing.

Projections are **measured, not invented** — each continues its own country's
last real cycle (period length, cutoff offset, payout anchor), and
`total_payroll_cost` / `approval_date` stay `null` because a cycle that has not
run has no cost and no approval.

## Turning projection off

`STANDIN_PAYROLL_HORIZON_MONTHS=0` makes this a pure pass-through, which is how
the "refuses because it cannot know" path is demonstrated through **this same
URL** rather than only against the raw gateway. Default is 12.

## Deploying

There is no git link on this Vercel project — it is deployed by pushing the
file tree directly (`deploy_to_vercel`, target `production`, project name
`your-sandbox-standin`).

**The deployment drifted from this directory once, and nothing caught it.** On
2026-08-18 the live `/__bridge/health` returned a `forwardedQuery` field that
**no commit in this repo has ever contained**, so the running bridge was built
from source that was never committed. The handler now emits `forwardedQuery`
*and* `rawUrl` so redeploying from the repo is a pure addition and cannot
silently remove a diagnostic the live version had. If you change this
directory, redeploy it; if you change the deployment, commit it.

Verify after every deploy — `READY` means the build succeeded, not that
anything works:

```bash
curl -s https://your-sandbox-standin.vercel.app/__bridge/health
# expect ok:true and projectionHorizonMonths

curl -s -X POST https://your-sandbox-standin.vercel.app/v1/employments/x
# expect 405 — the write refusal is the load-bearing one

curl -s -H "Authorization: Bearer $REMOTE_API_TOKEN" \
  "https://your-sandbox-standin.vercel.app/v1/payroll-runs?page=1&page_size=100" \
  | head -c 400
# expect `_standin.projectedCycleIds` and rows whose id starts `standin-`
```
