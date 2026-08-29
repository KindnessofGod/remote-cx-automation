# L3-04 · `GET /v1/leave-policies/*` — PTO policy and balances, per employment

> Carrier only. **🔒 No balance, entitlement or leave record of any customer
> appears in this file, and none may be vendored anywhere.**

| | |
|---|---|
| **Catalogue id** | L3-04 (`docs/KNOWLEDGE-SOURCES.md` §6) |
| **Source name** | "List Leave Policies Summary" / "List Leave Policies Details" — Remote API reference |
| **Publisher / authority** | Remote (carrier). **Authority for the policy is the customer.** |
| **Exact URLs** | <https://developer.remote.com/reference/get_v1_leave-policies_summary_employment_id.md><br><https://developer.remote.com/reference/get_v1_leave-policies_details_employment_id.md><br><https://developer.remote.com/reference/get_v1_timeoff-balances_employment_id.md> (deprecated) |
| **Retrieved** | **2026-08-19**, by `curl`. HTTP 200: 51,965 / 40,100 / 54,281 bytes. |
| **SHA-256 of the retrieved bytes** | `9c9c44ffd477ed229314a8bc4457e35af92c3e7f0ffe7fabb1f20b5d4b1b06aa`<br>`067eb99bdd43f53a22dbc7796481f9996dc65706ffb1a3decb515aa249395215`<br>`de888d52c361954566a065681dfaab88756b4b66c26cfbe8f02b5c3cdf8542e8` |
| **Source `updatedAt`** | `2026-05-27T21:29:57.000Z` (all three) |
| **Licence / basis for inclusion** | Schema facts and short attributed quotations only. |
| **Evidence tag** | `[CONFIRMED — schema, fetched 2026-08-19]` |

## Deprecation, confirmed in Remote's own words

`GET /v1/timeoff-balances/{employment_id}` carries this notice on its page:

> **Deprecated since February 2025** in favour of **List Leave Policies Summary**
> endpoint.

Anything new must target `/v1/leave-policies/summary/{employment_id}`.

## The `LeavePolicySummary` object — every property, with Remote's own description

| Property | Type | Remote's description |
|---|---|---|
| `leave_policy` | `EmployeeLeavePolicy` | `{name, description, leave_type, unit}` |
| `annual_entitlement` | days-and-hours | The annual entitlement represents what an employee is entitled to in the current entitlement period. It does not account for any accrued value. |
| `current_entitlement` | days-and-hours | The current entitlement is the **accrued** time entitled for the employee plus any other extra entitlements (such as carryover). |
| `taken` | days-and-hours | Includes all time off (past and future, pending or approved). |
| `used` | days-and-hours | Includes only **approved** time off **in the past**. |
| `balance` | days-and-hours | The balance is the entitlement minus the taken timeoff (i.e 10 entitlement - 3 taken = 7 balance) |
| `annual_balance` | days-and-hours | …the balance for the current entitlement period. Unlike the regular balance, it does not account for accrued value. |
| `booked` | days-and-hours | Includes all upcoming requested time off. |
| `pending_approval` | days-and-hours | Includes requested timeoffs (not approved) in the past or in the future. |
| `upcoming_approved` | days-and-hours | Includes all upcoming approved time off. |
| `upcoming_requested` | days-and-hours | Includes all upcoming requested time off. |
| `working_hours_per_day` | integer | — |

Every "days-and-hours" field is one of two shapes:

```json
{ "type": "limited",   "days": 1, "hours": 3 }
{ "type": "unlimited" }
```

`TimeoffType` enum, verbatim: `time_off`, `sick_leave`, `public_holiday`,
`unpaid_leave`, `extended_leave`, `in_lieu_time`, `maternity_leave`,
`paternity_leave`, `parental_leave`, `bereavement`, `military_leave`, `other`,
`paid_time_off`, `custom_company_leave`, `rtt`, `casual_leave`, `rol`,
`ex_festivita`.

## The mapping UC-05 needs, and the two traps in it

`src/uc05/ptoPayout.js` consumes `{timeOffType, daysAccrued, daysUsed,
hoursPerDay}` per balance line and refuses any line where a required number is
absent, non-finite or negative. Against the schema above the mapping is:

| `ptoPayout.js` expects | Remote's field |
|---|---|
| `timeOffType` | `leave_policy.leave_type` |
| `daysAccrued` | **`current_entitlement.days`** — the field whose description says "accrued" |
| `daysUsed` | `taken.days` (the wider of the two; `used` excludes future approved leave) |
| `hoursPerDay` | `working_hours_per_day` |
| the reported remaining balance the discrepancy check compares against | `balance.days` |

**Trap 1 — `type: "unlimited"` has no `days` property at all.** An unlimited PTO
policy is not "zero days accrued". Reading `.days` off it yields `undefined`, and
any function that coerces that to `0` produces a **confident 0.00 payout on a
real policy**. `ptoPayout.js` already refuses absent numbers rather than
defaulting them, which is exactly the behaviour that makes this safe — the
mapping must not undo it by substituting a zero on the way in.

**Trap 2 — `taken` and `used` are different questions.** `taken` includes future
and pending leave; `used` counts only approved past leave. On a resignation the
distinction is the whole answer, and the two fields differ by exactly the leave
that has been booked but not yet taken.

## The finding this closes half of

`CLAUDE.md` records finding **F-28**: n8n execution 4975 delivered a
plausible-looking balance carrying **none of the four fields the payout function
multiplies**. The fix hardened the function; it did not bind the source. The
schema above is the source, and `KNOWLEDGE-SOURCES.md` names reading it as the
UC-05 change with the highest value per unit of effort. **This pass does not wire
it** — no `src/` file is touched — it supplies the mapping so that whoever does
is not guessing.

## Staleness

Not a poll — customer configuration, changing when the customer changes it. The
balances are per-employment and must be read at decision time, never cached: a
balance is a moving number by construction.
