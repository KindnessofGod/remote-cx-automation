# UC-06 Business Case — Contract Amendment / Payroll Cutoff

Template for the "Business Case" section every deep use case in this project
should carry from here on: hypothesized problem, what's actually confirmed
vs. assumed, the specific internal metric that would confirm or kill the
case, and what ships regardless of that data vs. what's gated on it. Same
evidence-tag discipline as the API verification docs
(`docs/verification/uc02-expense-endpoints.md`,
`docs/verification/uc04-workation-authorization.md`), applied to business
value instead of API shape.

**This is not a claim that UC-06 is Remote's biggest support-ticket
category.** No public source makes that determinable, and this document
does not pretend otherwise.

---

## 1. Hypothesized problem and cost mechanism

**[PROPOSED — reasoned hypothesis, not sourced fact]**

Two distinct failure modes, with two distinct cost mechanisms:

1. **Payroll-cutoff timing confusion.** Remote's own support content
   [CONFIRMED] states contract amendment requests must be received by the
   5th of the month to be processed in that month's payroll run. A customer
   admin or employee who submits after that date, or doesn't know the
   deadline exists, gets a delayed change with no obvious explanation —
   generating a support contact and, more importantly for an EOR
   specifically, eroding trust in "will my employee get paid correctly and
   on time," which is the core thing Remote sells. **Cost mechanism:**
   avoidable support contact + disproportionate trust/reputation cost per
   incident, because payroll errors read as a platform-integrity issue, not
   a minor UX papercut.
2. **Not knowing whether a request needs review.** Remote's own
   `automatable` pre-check endpoint [CONFIRMED real, see
   `docs/verification/` API findings for #7] exists because Remote's product
   team already decided some amendments are safe to self-serve and others
   aren't. Customers who don't use that self-service path — don't know it
   exists, hit a case it flags for review, or simply prefer a human — land
   in support asking "did this go through," "why is it pending," "will this
   make payroll." **Cost mechanism:** support-hours spent answering
   questions the system already has the answer to internally.

## 2. Confirmed vs. assumed

| Claim | Status |
|---|---|
| 5th-of-month payroll cutoff exists and is customer-facing | [CONFIRMED] — Remote's own support content |
| `automatable` pre-check endpoint exists and is real | [CONFIRMED] — live-verified against `developer.remote.com` |
| Remote already invested product engineering in self-service amendment automation | [CONFIRMED] — the existence of the `automatable` endpoint is itself the evidence |
| This generates a *meaningful volume* of support tickets | **[UNCONFIRMED]** — no public ticket-volume, CSAT, or team-size data exists for Remote's support org. Not determinable from outside. |
| This is a top-N support bottleneck relative to other categories (expenses, PTO, verification letters) | **[UNCONFIRMED]** — no basis to rank it; plausible it's lower-frequency but higher-stakes-per-incident than higher-volume categories |
| Missed cutoffs measurably affect churn/CSAT | **[UNCONFIRMED]** — plausible given EOR trust dynamics, not evidenced |

## 3. The data that would actually confirm or kill this

If given access to Remote's internal systems, the specific asks, in priority
order:

1. Ticket volume tagged to contract-amendment / payroll-cutoff topics
   (absolute count and % of total CX volume).
2. Average handle time on those tickets vs. the CX org's overall average.
3. What fraction of amendments already route through `automatable`
   self-service vs. get escalated to a human — this directly measures how
   much of the problem Remote's product team has already solved, and how
   much residual surface is left for a support-automation layer.
4. Any existing CSAT or churn signal specifically tagged to payroll-timing
   complaints.

**If (1) turns out to be small**, the informational cutoff-lookup piece
(§4 below) is still justified on cost-to-build grounds alone — it's cheap
enough that it doesn't need a large number to clear the bar. **If (3) shows
`automatable` already handles the bulk of eligible cases**, that's evidence
the dual-control piece's value is concentrated in a narrow, already-flagged-
as-hard tail — which changes its framing from "handles most amendments" to
"handles the ones Remote's own compliance engine said need a human," a
smaller but arguably higher-value claim.

## 4. What ships regardless vs. what's gated on real data

**Ship regardless of confirmed volume** — justified on cost-to-build and
risk grounds alone, not on a volume assumption:
- Cutoff-deadline status lookup (🟢, read-only, `GET /contract-amendments/{id}`
  + the known cutoff date). Cannot cause harm even if used rarely; cost to
  build is low; every use of it prevents a specific, well-documented failure
  mode.
- The `automatable` pre-check gating the zero-touch path — this isn't
  inventing new judgment, it's deferring to a decision Remote's own API
  already makes, so its cost is close to zero regardless of how often it
  fires.

**Gate on confirmed data before treating as a priority investment:**
- The dual-control approval workflow itself — genuinely useful and
  well-motivated on risk-mitigation grounds (§1), but whether it's worth
  building out further (Slack alerts, richer UI, SLA tracking) should wait
  for real volume/escalation-rate numbers, not be assumed from outside.

---

## Recommendation

Keep UC-06. Reframe its pitch away from "solves Remote's biggest CX
bottleneck" (unverifiable, and the wrong claim to make) toward "targets a
specific, evidenced failure mode (cutoff timing) with a near-zero-cost fix,
amplifies a self-service capability Remote already built rather than
duplicating it, and stages the higher-risk piece behind a stated data
checkpoint rather than an assumption." That's the version of this that
survives a follow-up question in an interview.
