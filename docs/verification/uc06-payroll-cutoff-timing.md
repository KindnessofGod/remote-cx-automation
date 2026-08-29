# UC-06 Research — Why Payroll Cutoffs Exist (Industry-Wide, Not Just Remote)

UC-06 is built around one specific fact: Remote's own support content states that a
contract amendment (e.g. a salary change) must reach Remote by the 5th of the month
to be processed in that month's payroll run. Remote's docs assert this deadline;
they never explain why it exists. This document investigates the "why" against
primary sources across the broader payroll/PEO/EOR industry, government wage and
tax authorities, and payroll-operations mechanics — not just Remote.

**This is not a claim that Remote's specific "5th" and "11th" dates are
industry-mandated numbers.** No regulator sets "the 5th" as a universal deadline,
and this document does not pretend otherwise. What it evaluates is the narrower,
answerable question: is a pre-pay-date cutoff *of some kind* — with real
operational and legal weight behind it — standard practice across the industry, or
is Remote's specific implementation an arbitrary internal buffer with no external
grounding? Same evidence-tag discipline as `uc06-business-case.md` and
`uc02-expense-endpoints.md`.

---

## 1. Is a pre-pay-date cutoff standard across payroll/EOR/PEO providers, or Remote-specific?

**Method:** fetched each company's own published help-center/docs content directly
(via `developer`/`support`/`help` subdomains, using a text-extraction proxy where a
provider's help site blocked direct fetches — see Sources). Recorded exactly what
each one publishes, and explicitly recorded when nothing specific is published
rather than guessing.

| Provider | What is actually published | Evidence tag |
|---|---|---|
| **Remote** | Contract-amendment cutoff: "For a contract amendment request to be processed in the same month's payroll, we need to receive the details by the 5th of the month. If this is submitted after the 5th, the changes will reflect in the following month's payroll." Separately, a *general* payroll cutoff of "the 11th of each month (11:59 PM UTC)" for most regions, with country-specific exceptions and semi-monthly schedules (US, Canada, Mexico, Panama, Brazil, Ukraine, Philippines each get their own cutoff/payout dates). Items (commissions, expenses) submitted after the general cutoff are stated flatly as unprocessable that month, with late items "reject[ed]" under the off-cycle-payment criteria. | [CONFIRMED] — Remote's own support articles |
| **Deel** | Publishes cutoff times down to the minute for different item types ("Payroll cut off time for expenses: 11:59 AM Pacific Time"; "bonuses and other adjustments: 11:59 PM Pacific Time"), a standard cycle cutoff around the 20th of the month for many countries, **and separate, different cutoff dates for at least three named local processing partners**: "Capital Ges: 7th of the month," "GoGlobal: 5th of the month," "Le Monde Apress: 1st of the month" (all "for that same month"). | [CONFIRMED] — Deel's own help center |
| **ADP** | Does not publish a universal cutoff date (ADP serves many clients on different custom schedules), but publishes concrete same-day-processing cutoff *times*: payroll accepted by 5:30pm ET auto-debits the next banking day; direct deposit funds land within 24 hours if processed by 7:00pm ET, or same-day if processed by 2:00pm ET. Explicitly states changes made after the deadline "will go into effect for the next payroll, not the current one." | [CONFIRMED] — ADP's own published guidance (via Roll by ADP FAQ and ADP resource pages) |
| **Gusto** | Publishes a per-run "run-by date": submit by 4pm PT on the run-by date for the intended check date; late submission pushes processing to the next business day. Does not publish a single fixed calendar-day-of-month cutoff (Gusto payroll is per-schedule, not a fixed monthly cycle for most plans). | [CONFIRMED] — Gusto's own help center |
| **Multiplier** | Confirmed to maintain a dedicated cutoff-dates help article ("Payroll cut-off dates at Multiplier") and a glossary entry defining a cutoff date as "the deadline for submitting data to ensure timely global payroll processing," stating cutoffs are "critical... to ensure salaries, deductions, and statutory filings are calculated accurately and paid on time." The specific per-country date table on that help article could not be retrieved (the page returned an authentication wall to this research pass) — **the existence and general framing is confirmed, the specific dates are [UNCONFIRMED]**. | [CONFIRMED] existence/framing; [UNCONFIRMED] specific dates |
| **Velocity Global / Pebl** | Maintains a "Payroll and Expense Dates" help page and a glossary entry for "cut-off date," confirming the concept is formalized in their operations, but the actual date table could not be retrieved (page required a login/CAPTCHA wall). **Not publicly documented in a form this research could access.** | [UNCONFIRMED] specific dates; existence of the concept is evidenced by the page/glossary entry existing |
| **Oyster HR** | One secondary source (a comparison/review site aggregating provider data, not Oyster's own docs) states cutoffs on "the 6th and 10th of the month for payments to be processed on the same and next month respectively," and that Oyster pushes cutoff reminders via a native Slack integration. Oyster's own help-center article search did not surface a directly fetchable primary page in this pass. **Treated as [UNCONFIRMED] because it is not sourced from Oyster's own docs**, flagged here rather than presented as confirmed. |
| **Papaya Global** | No specific cutoff date or time is published in any material this research reached. Secondary/marketing material states employers must "review and approve employee compensation, bonuses, and timesheets before the payroll cutoff date," that Papaya "generates country-specific processing calendars and sends automated alerts before each cutoff," and that the platform flags "anomalies, gross-to-net mismatches and missing inputs before the cycle runs." This confirms the *existence* of per-country cutoffs as a product feature, but **no actual date/time is published anywhere found — not publicly documented.** | [UNCONFIRMED] specific dates; [CONFIRMED] the concept exists as a stated product feature |
| **Globalization Partners (G-P) / Multiplier comparison material** | No G-P-published cutoff date found. A competitor comparison page (Multiplier's own marketing) claims G-P "routes operations through multiple partners and intermediaries," which if true would predict *variable*, partner-dependent cutoffs analogous to Deel's — but this is a competitor's characterization of G-P, not G-P's own statement, so it is **not treated as confirmed for G-P specifically.** | [UNCONFIRMED] |

**Conclusion for Q1:** the *existence* of a pre-pay-date cutoff — some deadline
before which changes must be submitted to land in the current run — is
[CONFIRMED] as standard across every provider that publishes anything on the
subject at all (Remote, Deel, ADP, Gusto, and, at the level of "the concept is
formalized enough to have its own glossary/help page," Multiplier, Pebl, and
Papaya). **The specific calendar-day number is not standardized anywhere** — it
is set per-provider, and for the hybrid/partner-dependent providers (Deel is the
clearest documented case), it further varies **per local processing partner within
the same provider**, which is itself direct evidence for Q4 below. No provider
in this survey publishes a rationale for its specific date; every one simply
states the rule and the consequence of missing it, matching exactly what Remote's
own docs do. Remote's practice of having a cutoff is [CONFIRMED] industry-standard;
Remote's specific "5th" is [CONFIRMED] real but not shown to be based on any
published external standard — because no such standard exists to be based on.

---

## 2. What actually takes time between "amendment approved" and "employee paid on new terms"?

Investigated the concrete mechanical steps, sourced to industry-operations
material and the payment-rail authority (NACHA) rather than guessing at internals.

| Step | What has to happen | Evidence tag |
|---|---|---|
| **Gross-to-net recalculation** | Once a new salary (or other comp change) is locked in, the payroll engine must recompute gross pay, then reapply every deduction layer — federal/state/local tax withholding, FICA-equivalent statutory contributions, benefits and retirement deductions — for the affected employee before a net figure exists to pay out. Multiple industry sources describe this as a defined multi-day window (commonly described as 2–5 business days) that only starts once the input data is locked, which is precisely what a cutoff enforces: a fixed point where inputs stop changing so this calculation can run once, correctly, rather than being re-run against a moving target. | [CONFIRMED — described consistently across payroll-operations trade sources]; the specific "2-5 day" figure is a **generalization from secondary industry sources** (Patriot Software, Homebase, Talenta, and similar payroll-education sites), not a single authoritative number — treated as [INFERRED]/directionally confirmed, not as a precise universal constant |
| **Statutory withholding recomputation** | In the US specifically, federal income tax withholding is computed from IRS Publication 15 (Circular E) tables against actual wages paid; a mid-cycle salary change changes the withholding computation for that pay period, which has to be finalized before the pay run, not after. | [CONFIRMED] — IRS Publication 15 (2026), irs.gov |
| **Federal tax deposit timing is itself schedule-bound, not instant** | Employers deposit withheld federal income tax and Social Security/Medicare tax on either a monthly schedule (due the 15th of the following month) or a semiweekly schedule (generally due the following Wednesday or Friday depending on payday), determined by a lookback-period liability test; a same-day "$100,000 next-day deposit rule" exists as the fastest-possible exception, not the default. This means payroll processing has to plug into a tax-deposit calendar that itself runs on fixed dates the processor does not choose per-transaction. | [CONFIRMED] — IRS Publication 15 (2026), irs.gov |
| **Banking/ACH transfer lead time** | NACHA's own material confirms standard ACH credit transfers (the mechanism behind most US direct deposit) can take up to two business days to settle unless "Same Day ACH" is used, which itself has fixed submission windows (10:30am ET and 2:45pm ET) and settlement times (1:00pm / 5:00pm ET) — i.e., even the fastest same-day rail has a hard origination cutoff *on the day itself*, and standard (non-same-day) ACH requires the file to be originated in advance of that. This is a real, externally-imposed lead time a payroll processor cannot shrink below the rail's own settlement mechanics. | [CONFIRMED] — Nacha.org (the ACH network's own rulemaking body) |
| **UK Real Time Information (RTI) reporting** | UK employers must submit a Full Payment Submission (FPS) to HMRC **on or before** each payday reporting that pay run's figures — meaning the payroll figures (including any mid-cycle change) must be finalized before the submission deadline, which is tied to payday itself, not after it. | [CONFIRMED] — GOV.UK official guidance |
| **In-country legal-entity / local-processor dependency (EOR-specific)** | An EOR that routes payroll through in-country partners (rather than owning the local legal entity itself) is, by structure, also bound by that partner's own internal cutoff — which is exactly what Deel's own docs demonstrate directly: its named partners (Capital Ges, GoGlobal, Le Monde Apress) each have a *different* cutoff date from Deel's own standard cycle and from each other. This is the clearest primary evidence in this research that a cutoff can be driven by a dependency the platform itself does not fully control. | [CONFIRMED] — Deel's own help center names the partners and dates directly |
| **Works-council / employee-representation consultation (some jurisdictions)** | In Germany, pay-structure changes fall under the works council's co-determination rights ("genuine veto power on 'social matters' such as pay structures" per the Works Constitution Act (Betriebsverfassungsgesetz)); in France, the CSE must be consulted on compensation-related changes, and the general statutory consultation period under Code du travail Art. L2312-15 is **one month** from when the required information is communicated (longer — two or three months — if an expert is engaged). Neither of these applies to every amendment (routine individual raises are not the same as collective pay-structure changes), but where they do apply, the lead time is legally mandated and measured in weeks, not days. | [CONFIRMED] — the statutory consultation-period figures for France; [CONFIRMED] the co-determination principle for Germany, though the specific notice-period-in-days for an individual (non-collective) salary change was not found and is [UNCONFIRMED] |

**Conclusion for Q2:** there is a real, non-trivial, multi-actor sequence between
"amendment approved" and "money moves on new terms" — recalculation, statutory
deposit-schedule alignment, and payment-rail settlement all take documented,
externally-anchored time. This is [CONFIRMED] as a genuine operational chain, not
[PROPOSED] speculation about why payroll "feels slow." What is **not** confirmed
is that this chain specifically requires *exactly* a "5th of the month" cutoff for
Remote's payroll run in particular — the chain justifies *some* buffer of *some*
length, not that specific number.

---

## 3. Does government legislation mandate or influence cutoff timing?

| Jurisdiction | What the law actually requires | Evidence tag |
|---|---|---|
| **US federal — deposit deadlines** | Publication 15 (Circular E) sets a monthly depositor schedule (deposit by the 15th of the following month) or semiweekly schedule (Wednesday/Friday, by liability lookback), plus a next-business-day rule once accumulated liability hits $100,000. This is a real, binding federal deadline structure that payroll must plan around — but it governs *depositing withheld tax*, not the employer's internal cutoff for accepting an amendment request. It constrains the *back end* of the payroll timeline, not the front end. | [CONFIRMED] — IRS Publication 15, irs.gov |
| **US state — wage-change notice laws** | New York's Wage Theft Prevention Act requires written notice to new hires of pay rate at hiring; for a rate *change*, the requirement in practice (per NY DOL guidance material) is notice **within 7 days if the change isn't reflected on the employee's next wage statement**, with a stricter rule for **decreases** (written notice required *before* the reduction takes effect) — this specific "within 7 days / decreases need advance notice" framing comes from a secondary legal-guidance source summarizing NY DOL positions, not from language found verbatim on the primary NY DOL page fetched directly, so it is tagged **[CONFIRMED, secondary legal-summary source]** rather than primary-verbatim. California Labor Code §2810.5, fetched directly from the state's own legislative database, requires employers to **notify employees in writing of changes to specified wage/employment terms within seven calendar days after the change**, unless the change is reflected on a timely wage statement or another legally required writing within that window. | [CONFIRMED] — Cal. Labor Code §2810.5, leginfo.legislature.ca.gov (direct statute text); NY rule [CONFIRMED via secondary legal-summary source, not verified verbatim against NY DOL's own page in this pass] |
| **UK — RTI (PAYE reporting)** | Employers must submit a Full Payment Submission (FPS) to HMRC **on or before** each payday; late submissions carry escalating penalties (£100–£400 depending on employer size). This is a binding, dated, government-facing deadline tied directly to payday — a change that isn't finalized by the FPS deadline is a compliance problem, not just an internal scheduling inconvenience. | [CONFIRMED] — GOV.UK official guidance |
| **Germany — works council co-determination** | Under the Betriebsverfassungsgesetz (Works Constitution Act), the works council has genuine co-determination rights over "social matters" including pay structures — meaning some categories of pay change legally cannot proceed unilaterally on the employer's preferred timeline at all, independent of any payroll-system cutoff. | [CONFIRMED] — principle confirmed via multiple legal-guidance sources describing the Act; the exact statutory section number/day-count for an individual salary amendment specifically (as opposed to collective pay-structure changes) was not confirmed and is [UNCONFIRMED] |
| **France — CSE consultation** | Code du travail Art. L2312-15 sets a **statutory default consultation period of one month** (extendable to two or three months if an expert is retained) for matters requiring CSE consultation, which includes compensation evolution. Non-compliance can render the employer's decision void and constitutes a criminal offense ("délit d'entrave"). | [CONFIRMED] — French Ministry of Labour's own guidance (travail-emploi.gouv.fr) and Code du travail numérique (code.travail.gouv.fr), both official government sources |

**Conclusion for Q3:** real, binding legislation exists in multiple major
jurisdictions that constrains payroll-change timing — but it constrains
**different points in the chain** than Remote's specific "5th of the month" figure:
US federal law binds *tax deposit* timing after payday, UK law binds *reporting*
timing at-or-before payday, US state law binds *employee notice* after a change,
and German/French law can bind *whether a category of change can proceed at all*
without a separate consultation process measured in weeks. None of these
statutes specifies "requests must arrive by the 5th of the month" as a number —
that is [CONFIRMED] not a legislated figure anywhere this research found. What is
[CONFIRMED] is that the general *category* of "changes need a locked-in cutoff
before the pay run, with real consequences for missing it" has multiple
independent legal anchors, not just internal preference.

---

## 4. How much of the cutoff is third-party dependency vs. an arbitrary internal buffer?

Weighing §2 and §3 together, three distinct kinds of "third party" appear, and
they matter differently:

1. **Payment rails (banks/ACH-equivalent networks).** [CONFIRMED] real and
   external to any payroll company: NACHA's own settlement windows and same-day
   cutoff times are not something ADP, Gusto, Deel, or Remote can negotiate away —
   they are the network's rules. This applies to *every* provider processing
   US-dollar payroll through ACH, regardless of ownership model.
2. **Government tax/reporting systems.** [CONFIRMED] real and external: IRS
   deposit-schedule rules and UK RTI's on-or-before FPS requirement are statutory,
   not vendor policy. Every payroll operation touching US or UK payroll inherits
   these regardless of internal architecture.
3. **In-country payroll partners/local entities (EOR-specific).** This is where
   ownership model matters most, and the evidence diverges sharply between
   providers: **Deel's own docs show real, different, partner-specific cutoff
   dates** (Capital Ges 7th, GoGlobal 5th, Le Monde Apress 1st) — direct proof
   that for a partner-dependent EOR, cutoff timing is genuinely constrained by
   entities the platform doesn't fully control. **Remote's own public positioning
   is the opposite**: Remote's marketing states it operates wholly owned legal
   entities in every country it covers, with "zero" third-party partners in its
   EOR compliance chain, in contrast to hybrid/partner-dependent competitors.
   If that claim is accurate, Remote's specific cutoff is **less** attributable
   to "we're waiting on an outside partner's schedule" than Deel's demonstrably
   is, and **more** attributable to Remote's own owned-entity payroll engine's
   internal batch-processing needs across ~100 countries simultaneously — still
   a real constraint (recalculating and routing payroll for that many
   jurisdictions in one internal system is not instantaneous), but a different
   *kind* of constraint than "outsourced to a partner we don't control."
   **This Remote-ownership claim is [CONFIRMED] as Remote's own published
   marketing position, not independently audited by this research** — it should
   be read as Remote's stated claim, not verified fact.

**Conclusion for Q4:** the cutoff is **not** purely arbitrary — real external
dependencies (payment rails, tax authorities) bind *every* provider regardless of
ownership model, which supports genuine operational grounding. But the *degree*
to which a specific provider's cutoff is "third-party-constrained" vs. "our own
internal batch-processing buffer" is provider-specific and, per Remote's own
claims about itself, probably tilts toward the latter for Remote specifically
(an internal-engine buffer across many countries) rather than the former
(waiting on an external partner's calendar) — while still not being "arbitrary"
in the sense of having no real work behind it.

---

## 5. Synthesis — is Remote's ~5th-of-month cutoff (a), (b), or (c)?

Restating the three candidate explanations from the brief:
(a) industry-standard practice with real operational/legal grounding,
(b) a Remote-specific choice reflecting the complexity of routing payroll through
many countries' owned local entities, or
(c) an arbitrary buffer with no strong external justification.

**Best-supported answer: a blend of (a) and (b), not (c), with (b) doing more
of the work than (a) for the *specific date* — though (a) fully explains why
*some* cutoff must exist at all.**

- **(a) is [CONFIRMED] for the *existence* of a cutoff, not for the *specific
  date*.** Every provider surveyed that publishes anything on the subject
  enforces some pre-pay-date deadline, and multiple independent real-world
  constraints (ACH settlement mechanics, IRS deposit scheduling, UK RTI's
  on-or-before rule) make "changes must be locked in before processing starts"
  a genuine, externally-anchored necessity industry-wide. No source anywhere —
  Remote's or any competitor's — publishes a rationale tying a specific
  calendar day to a specific external rule, because (per this research) no such
  externally-mandated day exists to point to.
- **(b) is [INFERRED], reasonably, from two confirmed facts held together:**
  Remote's own claim of owning entities in ~100 countries (no partner
  intermediary layer, per Remote's own marketing) plus the general operational
  reality (§2) that gross-to-net recalculation, statutory-schedule alignment,
  and payment-rail lead time all take real, non-zero, multi-day time *per
  jurisdiction*. Doing that for one country is a bounded problem; doing it as
  one coordinated monthly batch across ~100 countries' worth of statutory
  regimes, each with its own tax-withholding rules and banking rails, is a much
  larger one — which plausibly explains why Remote needs a buffer measured in
  days-before-month-end rather than hours. This is a reasoned inference, **not**
  a fact Remote states about its own reasoning anywhere found in this research.
- **(c) is not well supported.** An arbitrary buffer would predict no
  correlation between the cutoff and any real downstream process — but the
  UK/US/French legal deadlines this research found line up temporally with
  exactly the kind of processing a pre-pay-date cutoff exists to protect
  (finalize-then-deposit, finalize-then-report, finalize-then-consult). The
  cutoff correlates with real downstream obligations closely enough that
  "arbitrary, no justification" is the least-supported of the three options.

**Explicitly flagged as inconclusive:** this research **cannot** determine
whether Remote's specific choice of "the 5th" (rather than the 3rd, or the 7th)
reflects a load-bearing internal SLA calculation or a rounder, less rigorously
derived number — Remote does not publish that reasoning, and no outside source
audits it. That specific gap is **[UNCONFIRMED]** and stays that way; this
document does not manufacture a number to fill it.

---

### What this means for UC-06

**No, this research does not change the 48-hour urgent-cutoff-escalation logic
already built into UC-06.** If anything it strengthens the premise that logic
was built on: the cutoff is a real constraint with genuine operational and (in
several jurisdictions) legal weight behind it, not a soft internal preference
Remote could waive on request. A ticket arriving inside 48 hours of a real
cutoff is a genuinely time-critical event — recalculation, statutory-schedule
alignment, and payment-rail lead time do not compress on request, so escalating
those tickets for expedited human attention (rather than silently queuing them
behind slower AI-only handling) matches what actually happens downstream, not
just what looks urgent to a customer.

**What this changes is *how the automation should talk about the cutoff to
customers* — concretely, in the copy the ZAF sidebar / any customer-facing
message uses:**

- **Frame it as "this is a hard constraint with real mechanics behind it," not
  "Remote's internal buffer that might be negotiable."** The evidence in §2–§4
  supports this framing: gross-to-net recalculation, statutory tax-deposit
  scheduling, and ACH/payment-rail settlement windows are real, external,
  non-negotiable steps that happen after a cutoff, and — per Remote's own
  no-partner-intermediary claim — Remote's specific buffer most plausibly exists
  because it is running that whole chain across roughly 100 countries as one
  coordinated internal batch, not because a single country's processing is slow.
  Telling a customer "this reflects the time payroll systems, banks, and tax
  authorities genuinely need to process a change correctly" is **[CONFIRMED]
  supportable** by the evidence in this document — it is not overselling.
- **Do not claim a specific external law dictates "the 5th."** No statute
  found in this research names that date. The honest version of the message is
  "there's a real deadline because of how payroll processing genuinely works,"
  not "the law requires this exact date" — the latter would be fabricating a
  citation this research explicitly did not find.
- **Where this stays [PROPOSED]/[UNCONFIRMED]:** exactly *why* the 5th rather
  than some other nearby date, and exactly how much of Remote's buffer is
  third-party-driven (banks, tax authorities) vs. Remote's own internal
  batch-processing need across its owned-entity footprint, are not
  independently verifiable from outside Remote. UC-06's customer-facing
  language should stay in the register this document supports — "this is a
  real operational deadline, here's generally why deadlines like this exist in
  payroll" — and should not manufacture a false precision (a specific law, a
  specific day-count justification) that isn't actually sourced.

---

## Sources

Fetched or searched directly during this research pass (2026-08-03). Where a
provider's help site blocked direct fetching, a text-extraction proxy
(`r.jina.ai`) was used to read the same live page content, not a cached or
secondary summary.

**Remote (primary, own docs):**
- https://support.remote.com/hc/en-us/articles/4410446893965-What-is-the-payroll-cutoff
- https://support.remote.com/hc/en-us/articles/4421460474637-Request-amendment-to-employee-agreement
- https://support.remote.com/hc/en-us/articles/4411723871885-Can-commissions-or-expenses-be-processed-after-the-global-payroll-cutoff-date
- https://support.remote.com/hc/en-us/articles/360054809171-What-happens-if-my-salary-or-job-title-changes
- https://support.remote.com/hc/en-us/articles/28159438111117-Contract-amendments-for-employees-hired-through-your-entity
- https://support.remote.com/hc/en-us/articles/10337470598797-How-incentives-reimbursements-and-salary-adjustments-work-with-semi-monthly-payroll
- https://remote.com/blog/eor-peo/owned-entity-partner-dependent-global-employment (Remote's own marketing claim of owned-entity, zero-partner model)

**Other providers (primary, own docs):**
- https://help.letsdeel.com/hc/en-gb/articles/4419648055185-What-Are-the-Payroll-Cut-off-Dates-and-Times (Deel; includes named partner-specific cutoff dates)
- https://www.rollbyadp.com/faqs (ADP/Roll by ADP)
- https://www.adp.com/resources/articles-and-insights/articles/a/ach-payroll.aspx (ADP)
- https://support.gusto.com/article/999754831000000/Run-a-regular-payroll-for-admins (Gusto)
- https://support.gusto.com/article/999752211000000/direct-deposit-payment-speeds-in-gusto (Gusto)
- https://www.usemultiplier.com/glossary/cut-off-date (Multiplier)
- https://help.usemultiplier.com/hr/global-payroll/payroll-cut-off-dates-at-multiplier (Multiplier; page existence confirmed, per-country date table not retrievable in this pass)
- https://help.hellopebl.com/ and https://help.velocityglobal.com/payroll-dates (Velocity Global/Pebl; page existence confirmed via search, content not retrievable — access-walled)

**Secondary sources used, explicitly flagged as such:**
- Oyster cutoff dates ("6th and 10th") — from a third-party review/comparison
  aggregator, not Oyster's own docs; flagged [UNCONFIRMED] accordingly.
- Papaya Global cutoff-alert product description — from marketing/review
  material, not a fetched Papaya help-center page with a specific date.
- NY Wage Theft Prevention Act "within 7 days" change-notice framing — from
  legal-guidance secondary sources summarizing NY DOL's position; the NY DOL's
  own page fetched directly in this pass covers new-hire notice, not the
  change-notice timing specifically.

**Government/regulatory (primary):**
- https://www.irs.gov/publications/p15 — IRS Publication 15 (Circular E), 2026,
  deposit-schedule rules
- https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?sectionNum=2810.5.&lawCode=LAB — California Labor Code §2810.5, direct statute text
- https://www.gov.uk/guidance/what-payroll-information-to-report-to-hmrc — UK
  government guidance, FPS on-or-before requirement
- https://travail-emploi.gouv.fr/linformation-et-la-consultation-du-cse — French
  Ministry of Labour, CSE consultation
- https://code.travail.gouv.fr/fiche-ministere-travail/cse-information-et-consultation — French Code du travail numérique, official government legal-code portal

**Industry/payment-rail body (primary):**
- https://www.nacha.org/content/ach-payments-fact-sheet — NACHA (the ACH
  network's own rulemaking body), settlement timing and same-day cutoff windows

**Secondary trade-press/education material used only for the general
gross-to-net-recalculation-timeline claim in §2 (explicitly not treated as an
authoritative universal figure):**
- Patriot Software, Homebase, Talenta, and similar payroll-education blog
  content aggregating a commonly cited "2–5 business day" processing window —
  cited as directional corroboration only, not as a sourced regulatory number.

**Dead ends / access-walled, noted for the record rather than silently
omitted:** dol.ny.gov/notice-pay-rate (covers new-hire notice, not the
change-notice timing question directly); the NY DOL wage-theft FAQ PDF (fetched
but returned unreadable binary/font-stream content, not usable as a verbatim
source in this pass); help.usemultiplier.com's cutoff-dates article (401
Unauthorized on both direct fetch and proxy fetch); help.hellopebl.com
(CAPTCHA-walled); nacha.org/rules/same-day-ach-moving-payments-faster-phase-1
and nacha.org/content/how-ach-payments-work (403 on direct fetch; the fact
sheet URL above was used as a working substitute covering the same figures).
