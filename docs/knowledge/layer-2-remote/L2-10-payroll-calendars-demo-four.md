# L2-10 · `GET /v1/payroll-runs` — the demo-four calendars, and Portugal's absence

| | |
|---|---|
| **Catalogue id** | L2-10 — a **demo-scoped extension of L2-05** (`docs/KNOWLEDGE-SOURCES.md` §5). L2-05 records the `status`/`type` enums and the `cutoff_date` nullability *claim*; this file tests that claim against live rows and records the four demo countries' actual cycles. |
| **Source name** | "List Company Payroll Runs" — Remote API, live Sandbox |
| **Publisher / authority** | Remote Europe Holding, B.V.; the underlying calendar is customer/entity data served through Remote |
| **Exact URL** | `https://gateway.remote-sandbox.com/v1/payroll-runs?page_size=100` |
| **Retrieved** | **2026-08-19**, Node `fetch` via `NODE_USE_ENV_PROXY=1`, bearer `REMOTE_API_TOKEN`. HTTP 200, **16,762 bytes**. |
| **SHA-256 of the retrieved bytes** | `6c69ad7c244785abf384982a937234d5fc173b448b79877d281ac1d6e3d2b4e9` |
| **Companion reference page** | <https://developer.remote.com/reference/get_v1_payroll-runs.md> — HTTP 200, **55,871 bytes**, SHA-256 `8956cc4a48a1d0b6308a270d342d8dd5be41da764302ba4a2b4542ec2d498df3`, `updatedAt: 2026-05-27T21:28:48.000Z` |
| **Source `updatedAt`** | None on the live JSON; the reference page's is above. |
| **Licence / basis for inclusion** | 🔒 This is **customer payroll data served through Remote**, in a Sandbox tenant this project owns. Only cycle *dates*, *statuses* and *types* are recorded — the fields UC-06's cutoff gate reads. `total_payroll_cost` figures are quoted once, for the units question, and are Sandbox seed values, not any real company's payroll. |
| **Evidence tag** | `[CONFIRMED — live, 2026-08-19]`; schema claims `[CONFIRMED — schema, fetched 2026-08-19]` |

---

## 1. Portugal has no payroll calendar at all — and that is the finding

The live response covers **exactly five countries**: `CAN`, `FRA`, `NLD`,
`SGP`, `USA`. **`PRT` appears zero times.** Not an empty cycle, not a stale
one — no row.

So for a Portuguese amendment, `RemoteClient.listPayrollRuns({countryCode:"PT"})`
returns `{payroll_runs: []}` — an **empty array, not `null`**, because the
fetch succeeded and the filter matched nothing. `evaluateCutoff()` then finds
no covering cycle and returns `noMatchingCycle: true`, which
`src/uc06/policyEngine.js` escalates.

**That is correct behaviour and it is also a use case that can only ever be
demonstrated refusing.** Portugal cannot be the UC-06 approval demo. It can be
a good *refusal* demo — but only if the narration says the cause is an absent
calendar rather than a policy judgement, because those two produce the same
outcome and `CLAUDE.md` §4's standing lesson is that they are indistinguishable
from outside.

This is not a workaround target. `src/remotebridge/payrollProjection.js`
projects future periods for a country that *has* an observed cadence; Portugal
has none to continue, so there is nothing to project from.

## 2. The four demo countries' live cycles

Deduplicated by `id` (see §4). Dates are `YYYY-MM-DD`; `—` is a literal `null`.

**NLD — 5 distinct cycles, currency EUR**

| period_start | period_end | cutoff_date | expected_payout_date | approval_date | status | type |
|---|---|---|---|---|---|---|
| 2026-04-01 | 2026-04-30 | 2026-04-20 | 2026-04-30 | 2026-04-25 | `completed` | `main` |
| 2026-05-01 | 2026-05-31 | 2026-05-21 | 2026-05-31 | 2026-05-26 | `completed` | `main` |
| 2026-06-01 | 2026-06-30 | 2026-06-20 | 2026-06-30 | 2026-06-25 | `processing` | `main` |
| 2026-06-01 | 2026-06-30 | **2026-06-10** | 2026-06-25 | — | `completed` | `one_off` |
| 2026-07-01 | 2026-07-31 | 2026-07-10 | 2026-07-25 | — | `preparing` | `one_off` |

**CAN — 3 distinct cycles, currency CAD**

| period_start | period_end | cutoff_date | expected_payout_date | approval_date | status | type |
|---|---|---|---|---|---|---|
| 2026-05-01 | 2026-05-17 | 2026-05-07 | 2026-05-17 | 2026-05-12 | `completed` | `main` |
| 2026-05-15 | 2026-05-31 | 2026-05-21 | 2026-05-31 | 2026-05-26 | `completed` | `main` |
| 2026-06-15 | 2026-06-30 | 2026-06-20 | 2026-06-30 | 2026-06-25 | `processing` | `main` |

**USA — 3 distinct cycles, currency USD**

| period_start | period_end | cutoff_date | expected_payout_date | approval_date | status | type |
|---|---|---|---|---|---|---|
| 2026-04-01 | 2026-04-30 | 2026-04-20 | 2026-04-30 | 2026-04-25 | `completed` | `main` |
| 2026-05-01 | 2026-05-31 | 2026-05-21 | 2026-05-31 | 2026-05-26 | `completed` | `main` |
| 2026-06-01 | 2026-06-30 | 2026-06-20 | 2026-06-30 | 2026-06-25 | `processing` | `main` |

**PRT — no rows.**

**Every cutoff above is in the past** relative to the retrieval date
(2026-08-19). The latest lock anywhere in the demo set is NLD's
`one_off` at 2026-07-10; the latest `main` lock is 2026-06-20. So on live
gateway data, **every** amendment for **every** demo country refuses today —
NLD/CAN/USA with `cutoffAlreadyPassed` or `noMatchingCycle` depending on the
requested effective date, PRT always with `noMatchingCycle`. That is the exact
condition `CLAUDE.md` §6 records for UC-06 and the reason the read-only
stand-in projects periods forward. Nothing here contradicts that; it extends it
to the US, which had not been checked.

**CAN's cadence is semi-monthly and irregular**: `05-01→05-17`, `05-15→05-31`,
`06-15→06-30`. The first two **overlap** (15–17 May sits in both), and the
`06-01→06-14` half is simply missing. A projection that assumed a clean
semi-monthly rhythm from these three rows would invent a cycle Remote never
listed.

## 3. `cutoff_date` nullability — the claim, and what the data actually shows

**Schema `[CONFIRMED]`, from the reference page's own OpenAPI:**

```
"cutoff_date":          { "$ref": "#/components/schemas/NullableDate" }
"approval_date":        { "$ref": "#/components/schemas/NullableDate" }
"period_start":         { "$ref": "#/components/schemas/Date" }
"period_end":           { "$ref": "#/components/schemas/Date" }
"expected_payout_date": { "$ref": "#/components/schemas/Date" }

"NullableDate": { "type":"string", "format":"date", "nullable": true, … }

"required": ["id","status","period_start","period_end","approval_date",
             "expected_payout_date","currency_code","country",
             "total_payroll_cost","type"]
```

So the prior finding is **confirmed and sharpened**:

- `cutoff_date` is `nullable: true` **and is the only one of the five date
  fields absent from `required`.** It can therefore be `null` *or missing
  entirely.*
- `approval_date` is equally nullable but **is** required — so it is always
  present, sometimes `null`.
- `period_start`, `period_end`, `expected_payout_date` are non-nullable and
  required.

**Live, in this Sandbox: `cutoff_date` was non-null on 34 of 34 rows —
including all 9 USA rows.** `approval_date` was `null` on 5 rows, every one of
them a `one_off` (both NLD one-offs among them). So the nullable path is real
in the contract and unexercised in the data: **an unreadable-cutoff demo cannot
be staged from live Sandbox rows.**

**What UC-06 does when it is null** — `src/uc06/cutoffEngine.js`, finding F-26b,
verified by reading the code:

```
cutoffMs = parseUtcInstant(cycle.cutoff_date)      // null -> NaN
if (Number.isNaN(cutoffMs) || Number.isNaN(nowMs))
    return { cutoffUnknown: true, cutoffAlreadyPassed: false,
             urgentWithin48h: false, hoursUntilCutoff: null }
```

`policyEngine.js` escalates on `cutoffUnknown`. The comment records why: an
earlier version let NaN fall through, and *every* comparison against NaN is
false, so both `cutoffAlreadyPassed` and `urgentWithin48h` read false and the
amendment sailed through as "comfortably before the cutoff" — a positive claim
derived from no information. **The handling is correct as it stands.**

`distinctCutoffCount()` puts an unreadable cutoff in its own bucket, so "one
readable, one unreadable" counts as a disagreement rather than silently
agreeing. Also correct.

## 4. Two live shape facts a consumer has to know

**(a) The list returns duplicate rows, and the duplication factor is
irregular.** `total_count: 17`, `total_pages: 1` — and the `payroll_runs`
array holds **34 elements with 17 distinct `id`s**. Per country: NLD 11 rows /
5 ids, USA 9 / 3, CAN 6 / 3, SGP 5 / 3, FRA 3 / 3. So the ratio is neither 1
nor a constant 2. `total_count` matches the **distinct** count, not the array
length.

`RemoteClient.listPayrollRuns()` already dedupes into a `Map` keyed
`id:${run.id}` before filtering, so the Node path is unaffected. Anything that
iterates the raw array — an n8n Code node, a report, a `.length` — double-counts.

**(b) `total_payroll_cost` is documented as `integer` and returned as a
`string`.** Reference: `"total_payroll_cost": {"description": "The total cost
of this payroll run across all employees. Amount in cents.", "type":
"integer"}`. Live: `"total_payroll_cost": "12382524"` — a quoted string, on
every row. The units claim ("cents", i.e. ×100) is confirmed and consistent
with `src/shared/money.js`. The *type* is not. Nothing in `src/` reads this
field today, so no live consumer is affected; recorded because
`src/uc09/` is the money path and a numeric string that arrives as a string is
exactly the coercion `money.js` refuses on purpose.

## 5. Enum coverage — contract vs. data

| Enum | Reference declares | Live in this Sandbox |
|---|---|---|
| `status` | `preparing`, `processing`, `completed`, `finalized`, `waiting_for_customer_approval`, `rejected` | `completed`, `waiting_for_customer_approval`, `processing`, `preparing` — **`finalized` and `rejected` never seen** |
| `type` | `main`, `one_off`, `pro_forma`, `tax_documents`, `expenses`, `parallel` | `main`, `one_off` only |

Any gate written against the observed subset is written against 4 of 6 and 2 of
6. Neither `finalized` nor `rejected` is handled anywhere in `src/`, and
`rejected` in particular is a status a cutoff gate would want an opinion about.

## 6. The overlapping-cycle ambiguity is live in the demo set

NLD carries **two cycles covering the same June period with different cutoffs**
— `main` locking 2026-06-20 and `one_off` locking 2026-06-10. Country filtering
cannot separate them; both are NL. Ten days of difference in a payroll lock is
the difference between an amendment landing and not landing.

`src/uc06/cutoffEngine.js` documents this exact pair and **reports rather than
resolves it**: `cyclesCovering()` returns both, `distinctCutoffCount()` sees
two, and `policyEngine.js` escalates with both candidates recorded and no cycle
chosen. Choosing would need a rule over `status`/`type` that Remote's reference
does not state. That handling is correct and this capture re-confirms the pair
still exists.

CAN's overlapping 05-01→05-17 / 05-15→05-31 pair is a **second** instance of
the same shape, previously unrecorded: an effective date of 15, 16 or 17 May
2026 is covered by two Canadian cycles with cutoffs 2026-05-07 and 2026-05-21.

## Mismatches against `src/` — reported, not fixed

1. **`total_payroll_cost` type disagreement** (§4b) — schema `integer`, live
   `string`. No current consumer; a latent coercion hazard on the money path.
2. **`status: "finalized"` and `status: "rejected"` are unmodelled** (§5).
   `rejected` is a state in which a cutoff has meaningfully *not* been met.
3. **Raw-array consumers double-count** (§4a). The REST client is safe; the
   n8n graphs read the HTTP body directly and were not audited here.
