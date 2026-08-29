# L3-07 · Leave policies and balances — all 63 NLD · PRT · CAN · USA employments

| | |
|---|---|
| **Catalogue id** | L3-07 — a **demo-scoped extension of L3-04** (`docs/KNOWLEDGE-SOURCES.md` §6). L3-04 records the schema and the `type: "unlimited"` trap; this file is the census that tests whether the trap is reachable in the demo, and what it found instead. |
| **Source name** | "List Leave Policies Summary" / "List Leave Policies Details" / "Show Time Off Balance" — Remote API, live Sandbox |
| **Publisher / authority** | The customer, carried by Remote |
| **Exact URLs** | `https://gateway.remote-sandbox.com/v1/leave-policies/summary/{employment_id}` · `…/v1/leave-policies/details/{employment_id}` · `…/v1/timeoff-balances/{employment_id}` |
| **Retrieved** | **2026-08-19**, Node `fetch` via `NODE_USE_ENV_PROXY=1`, bearer `REMOTE_API_TOKEN`. **63 summary calls, 63 × HTTP 200, zero failures** — every NLD/PRT/CAN/USA employment in the account regardless of status. Plus 7 `details` and 7 `timeoff-balances` on representatives. |
| **SHA-256** | Per-employment payloads are small and near-identical; representative checksums are in the manifest below. The whole sweep, as one derived JSON, is **not** vendored — see the licence line. |
| **Companion reference page** | <https://developer.remote.com/reference/get_v1_leave-policies_summary_employment_id.md> — HTTP 200, **51,965 bytes**, SHA-256 `9c9c44ffd477ed229314a8bc4457e35af92c3e7f0ffe7fabb1f20b5d4b1b06aa`, `updatedAt: 2026-05-27T21:29:57.000Z` |
| **Source `updatedAt`** | None on the live JSON; the reference page's is above. |
| **Licence / basis for inclusion** | 🔒 **Per-tenant customer data.** Only **aggregate distributions, field shapes and nullability** are recorded, plus nine employment UUIDs where the record itself is the finding. **No name, no email, no address, no bank detail, no personal identifier of any Sandbox individual appears here — all such fields were read and are deliberately not transcribed.** `KNOWLEDGE-SOURCES.md` §2 is explicit that tenant data never enters a shared store; a UUID with a day count attached is the minimum needed to make a money finding checkable. |
| **Evidence tag** | `[CONFIRMED — live, 2026-08-19]` |

## Representative manifest

| URL | HTTP | Bytes | SHA-256 |
|---|---|---|---|
| `/v1/leave-policies/summary/673a1884-…` (NLD eor) | 200 | 678 | `f6432dc2cd32e373794cb833e71ab676af230d2ddf30bde9ffc0eef1b70860e6` |
| `/v1/leave-policies/summary/378eee6b-…` (PRT eor) | 200 | 678 | `a142780b69f96ad256965bf15d52c94c41e7301faa90a9342c07f7e374b2a30e` |
| `/v1/leave-policies/summary/20b1346b-…` (CAN gpe) | 200 | 678 | `59076560a3f57137e902de2521851b801c0d3bd3dceb29dbfbe8aaac9715881b` |
| `/v1/leave-policies/summary/e1898674-…` (PRT contractor) | 200 | 664 | `4f6c4d72d67c92989d4689ab443f5be3611820b94e5543d6d0a2bee6edc6600c` |
| `/v1/leave-policies/details/673a1884-…` | 200 | 1,369 | `e6a85b88c364cb1c7df67210c11e336c97e54fd36efe1c2317299a1223959d2b` |
| `/v1/timeoff-balances/673a1884-…` | 200 | 593 | `021b9a71347b3ee235f32253aa71d5799183bba3e18cdbdd233ec59bbc1ba2d4` |

---

## 1. The `{unlimited}` money defect — the answer is NO, and here is the sweep

**Question asked:** does any NL/PT/CA/US employment carry a balance of
`type: "unlimited"` with no `days` key, such that a coerced zero would produce a
confident $0.00 payout on a genuinely unlimited policy?

**Answer, from all 63 employments:**

- `"unlimited"` appears **zero times** in any leave payload.
- Every quantity object read `{"type":"limited","hours":N,"days":N}`.
- **Every balance carried a `days` key** — 0 objects lacked one.

The string `unlimited` *does* occur in this Sandbox — but in the
`contract_details` **schemas**, as a member of the required
`available_pto_type ∈ {"unlimited","fixed"}` enum, for all four countries
(L2-08 §4). So the shape is representable in every demo country and instantiated
in none of them.

**What that means for the demo, said plainly.** The unlimited-PTO defect
**cannot be demonstrated from live Sandbox data without fabricating a record**,
and fabricating one would be exactly the fixture-agrees-with-the-code move
`CLAUDE.md` §4 names as the mechanism behind every defect it lists. The honest
options are to demonstrate it against the mock and *say* it is the mock, or to
leave it out. It should not be presented as a live finding.

## 2. What the sweep found instead — and it is a money defect

**Nine of the 22 active USA employments (41%) carry a NEGATIVE paid-time-off
balance.** No NLD, PRT or CAN employment does.

| employment | `balance.days` | `annual_entitlement.days` | `used.days` |
|---|---|---|---|
| `892dcf0e-7640-4c45-895f-ea8b648a5a1f` | **−20** | 0 | 20 |
| `49307d13-7869-4dce-a0d0-03b7a22d78f0` | **−19** | 0 | 19 |
| `99596ef8-8fad-4b3c-abd0-c22ae933b111` | **−6** | 0 | 6 |
| `e3d8f86a-2780-4073-b6c8-4596db5dc877` | **−6** | 0 | 6 |
| `46644589-64a4-4628-9266-bed09a8d9dba` | **−3** | 0 | 3 |
| `9ac2c03c-ae44-402a-9d3b-04cbe786bd47` | **−3** | 0 | 3 |
| `ab16a1a6-8ba1-4c4d-a9bc-e44c313f1beb` | **−3** | 0 | 3 |
| `e818418e-1db7-431d-a663-9f477addb8bd` | **−2** | 0 | 2 |
| `1af77540-5e00-4f10-8747-b43bb9743ff3` | **−1** | 0 | 1 |

All nine are `global_payroll_employee`, all active. The arithmetic is
consistent: `balance = annual_entitlement − used`, and the entitlement is 0.

**`src/uc05/ptoPayout.js` already handles this correctly — finding F-33.**
`unusableFields()` refuses a negative day count outright rather than clamping
it, and its header records precisely why: `Math.max(0, -8 - 0)` turned a stated
−8 into a computable **0.00 payout** with `computable: true`, no flag, and
`prepared_for_signoff`. So the guard is right and the data that would have
exercised it is genuinely present.

**But the guard is on a field nothing populates from Remote — see §4.**

## 3. Live shapes, field by field

`GET /v1/leave-policies/summary/{id}` → `data` is a **bare array**, one entry
per policy the employment has a balance for. Every entry:

```json
{"used":{...},"balance":{...},"taken":{...},
 "leave_policy":{"name":"Paid time off","unit":"days",
                 "description":null,"leave_type":"paid_time_off"},
 "upcoming_requested":{...},"upcoming_approved":{...},
 "pending_approval":{...},"current_entitlement":{...},
 "booked":{...},"annual_entitlement":{...},"annual_balance":{...},
 "working_hours_per_day":8}
```

Nine of those keys are the same quantity object:
`{"type":"limited"|"unlimited", "hours":N, "days":N}`.
`leave_policy.description` was `null` on every entry.
`working_hours_per_day` was `8` on every one of the 63.

Distinct `leave_policy` values across the four countries: `Paid time off` /
`leave_type: paid_time_off` (employees), and `Time off` /
`leave_type: time_off` (contractors). Only **one** policy entry per employment
in this Sandbox — no employment returned two.

`GET /v1/leave-policies/details/{id}` → a **different shape entirely**: the
catalogue of policy *variants* available, with no balances. Twelve rows for an
employee (`paid_time_off`, `sick_leave`, `public_holiday`, `parental_leave`,
`paternity_leave`, `maternity_leave`, `unpaid_leave`, `extended_leave`,
`bereavement`, `in_lieu_time`, `military_leave`, `other`), each
`{name, custom, leave_policy_variant_id, uses_accrual_as_balance}`. `custom` was
`false` and `uses_accrual_as_balance` `false` on every row. Contractors get a
shorter list. **`details` is the menu; `summary` is the balance.** They are not
two views of the same thing.

`GET /v1/timeoff-balances/{id}` — **documented as deprecated since February
2025 in favour of the summary endpoint**, and still answering 200. Envelope
`data.timeoff_balance`, carrying `contractual_entitled`, `total_entitled_days`,
`contractual_leave_entitlement_type` (`"fixed"`), and a
`timeoff_entitlements[]` array whose rows add `expiry_date` (`"2026-12-31"`)
and `can_expire` (`true`) — **two fields the non-deprecated summary endpoint
does not carry.** Anyone needing accrual expiry has to read a deprecated
endpoint to get it.

## 4. Mismatches against `src/` — reported, not fixed

Ranked by whether a wrong number could reach a human.

1. **Nothing in `src/` reads any of these endpoints.** `grep -rn
   "leave-policies\|timeoff-balances" src/` returns no consumer, and
   `src/remote/mockServer.js` does not serve the routes either.
   `docs/use-cases/UC-05.md` §7 calls for *"accrued PTO payout reconciliation
   from Time Off API"*; the API is real, reachable, and unwired. UC-05's
   balances arrive as caller-supplied input (portal or ticket), which means the
   PTO figure on a resignation report is **whatever the requester typed**, with
   no Remote read to contradict it.
2. **The shapes do not line up, and the mapping is where a wrong number would
   be born.** `ptoPayout.js` wants
   `{timeOffType, daysAccrued, daysUsed, hourlyRateInRemoteInteger}`. Remote
   supplies `{leave_policy:{leave_type}, annual_entitlement:{days},
   used:{days}, working_hours_per_day}` — **and no rate of any kind.** The
   plausible-looking mapping is the wrong one: `balance.days` is the *derived
   remainder*, not the accrual, so mapping it to `daysAccrued` would feed −20
   into a function whose F-33 guard then refuses the line. The correct mapping
   is `annual_entitlement.days → daysAccrued`, `used.days → daysUsed`. Neither
   mapping exists in `src/` yet, so neither is wrong yet; both are one commit
   away.
3. **The hourly rate has no source here at all.** It must come from
   `contract_details.annual_gross_salary` ÷ (`work_hours_per_week` ×
   weeks) — and PRT/NLD EOR `employee` records carry no `work_hours_per_week`
   (L2-09), so for those employments the divisor does not exist. A payout
   computed with an assumed 40-hour week would be a silently wrong money figure
   on a document an employee signs.
4. **`working_hours_per_day: 8` is a real field and `ptoPayout.js` defaults
   `hoursPerDay` to 8 independently.** They agree on all 63 records today. A
   part-time employee would break the agreement, and the default would win
   silently because nothing reads the API field.
