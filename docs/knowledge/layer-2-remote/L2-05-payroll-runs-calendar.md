# L2-05 · `GET /v1/payroll-runs` — the payroll calendar and its cutoff instants

| | |
|---|---|
| **Catalogue id** | L2-05 (`docs/KNOWLEDGE-SOURCES.md` §5) |
| **Source name** | "List Company Payroll Runs" — Remote API reference |
| **Publisher / authority** | Remote, **carrying per-company payroll configuration** — so the *data* is Layer 3 confidential even though the *schema* is Layer 2 public. |
| **Exact URL** | <https://developer.remote.com/reference/get_v1_payroll-runs.md> |
| **Retrieved** | **2026-08-19**, by `curl`. HTTP 200, 55,871 bytes. |
| **SHA-256 of the retrieved bytes** | `8956cc4a48a1d0b6308a270d342d8dd5be41da764302ba4a2b4542ec2d498df3` |
| **Source `updatedAt`** | `2026-05-27T21:28:48.000Z` |
| **Licence / basis for inclusion** | Schema facts and short attributed quotations only. **No customer payroll data of any kind appears in this file**, and none may — the catalogue classes the payload as Layer 3 confidential. |
| **Evidence tag** | `[CONFIRMED — schema, fetched 2026-08-19]` |

## The `MinimalPayrollRun` object — every property, with Remote's own description

> A lightweight representation of a payroll run used in list responses. Contains
> summary information and the total cost, but not the per-employee breakdown or
> cost category totals.

| Property | Type | Note |
|---|---|---|
| `id` | string | The unique identifier of the payroll run. |
| `status` | string | enum — see below |
| `type` | string | enum — see below |
| `period_start` | `Date` | |
| `period_end` | `Date` | |
| **`cutoff_date`** | **`NullableDate`** | **nullable — see the warning below** |
| `approval_date` | `NullableDate` | |
| `expected_payout_date` | `NullableDate` | |
| `currency_code` | `CurrencyCode` | |
| `country` | `Country` | the full country object (L2-02) |
| `total_payroll_cost` | integer | **Amount in cents.** |

**Required:** `id`, `status`, `period_start`, `period_end`, `approval_date`,
`expected_payout_date`, `currency_code`, `country`, `total_payroll_cost`, `type`.

Note that **`cutoff_date` is not in the required list** while the three other
date fields are.

### `status` — Remote's own enum descriptions, verbatim

```
preparing                     The payroll run is being assembled. Costs are estimates.
processing                    Submitted for processing. Costs are still estimates.
completed                     Processing is complete. Costs are final.
finalized                     Payments have been or will be disbursed.
waiting_for_customer_approval Requires company approval before proceeding.
rejected                      Rejected during approval and needs revision.
```

### `type` — Remote's own enum descriptions, verbatim

```
main           Regular recurring payroll.
one_off        Ad-hoc off-cycle payment.
pro_forma      Simulated run for cost estimation.
tax_documents  Tax document generation only.
expenses       Dedicated expense reimbursement run.
parallel       Supplementary run alongside the main payroll.
```

`one_off` is UC-09's off-cycle path by name. `expenses` is UC-02's.

## Two warnings this page earns

**1. `cutoff_date` is nullable, and a null cutoff is not "no cutoff".**
UC-06's entire risk lives in one question — *can this amendment still make the
cycle?* — and the field that answers it is optional and nullable in Remote's own
schema. A gate that reads `run.cutoff_date` and compares it to an effective date
will, on a `null`, either throw or silently compare against `undefined`. Neither
is "the cutoff has not passed". **Unknown cutoff must escalate, not pass.**

**2. `/v1/company-payroll-runs` does not exist.** `CLAUDE.md` §4 records the
defect: UC-06's payroll gate called that URL because *"the doc **title** had been
read as the path"* — the operation is titled "List **Company** Payroll Runs" and
lives at `/v1/payroll-runs`. It was dead on both execution paths while looking
cautious. The `llms.txt` inventory retrieved today lists
`get_v1_payroll-runs.md` and no `company-payroll-runs` operation of any kind.

## The staleness lesson — the best one in the catalogue

`CLAUDE.md` §6 records that the Sandbox payroll calendar simply **stopped**: the
last `period_end` is 2026-06-30 for SG/FR/CA/US and 2026-07-31 for NL. So
`evaluateCutoff()` finds no cycle covering any future effective date, and UC-06
escalates `noMatchingCycle` for **every** amendment anyone will ever submit —
the gate working correctly, on a table that has run out.

> **A calendar table needs a "does it cover the date I am asking about?" check,
> not just a "did the fetch succeed?" check.**

A successful fetch of an exhausted calendar is the exact shape of a silent
failure the catalogue's Test B exists for, and it is the same shape as the
holiday-calendar year boundary in `L2-03-public-holidays.md`.
