# What a mobility specialist needs to authorize a work authorization

**Research pass, 2026-08-31.** Seven parallel strands: Remote's own published
surface, this repository's UC-04 inventory, mobility-tech vendors, real-world
practice, Big-4 doctrine, EOR vendor guidance, and duty of care / GDPR /
payroll. Every claim below carries its source. **Nothing under `src/`,
`test/` or `workflows/` was changed to produce it.** The work it scopes is
`docs/UC04-DECISION-SURFACE.md`.

Evidence tags: **[LAW]** statute/regulation/treaty/judgment · **[OFFICIAL]**
public body that is not the determining authority · **[VENDOR]** a company's
published position · **[UNVERIFIED]** flagged inline.

---

## 1. Remote's own answer — ladder rung 1

Remote publishes what its Mobility Team assesses. Article `37802834593805`,
updated 2026-08-18, verbatim:

> - Immigration eligibility
> - **Historical travel and absence data**
> - Visa/work permit restrictions
> - **Nature of intended activities**
> - Any additional compliance requirements

And what the employee must supply on the RWA form, verbatim:

> - Travel/work location
> - Dates of travel
> - Purpose of the trip
> - Type of visa or travel document
> - **Activities to be performed**
> - **Institutions or organizations visiting**
> - **Special worksites (e.g., laboratories, manufacturing sites, etc.)**

Plus a notice rule: *"at least 3–8 weeks before your intended departure"*, with
under two weeks requiring live messaging. Travel letters: *"at least two weeks
before"*.

**The approve step is a data-entry step.** Article `20094378700557`: the admin
must *"use the additional information section to provide specific details about
the activities the employee is expected to perform during the travel."* So the
decisive field is captured twice — employee claim, then employer statement.

**The product boundary, stated by Remote.** A business travel letter *"does not
include any risk assessment or mandatory reporting required by destination
country authorities."* A router treating a travel letter as compliance
clearance contradicts Remote's own product definition.

### 1a. API facts [CONFIRMED against developer.remote.com + live Sandbox]

- **No `POST` exists** on `/v1/work-authorization-requests` or
  `/v1/travel-letter-requests`. Absent from Remote's own `llms.txt` index; live
  Sandbox probe returns 404. The record is created inside Remote's product by
  the employee. **This makes an intake stand-in structurally necessary, not
  merely convenient.**
- **The only writable transition is the manager's.** `UpdateWorkAuthorization
  RequestParams` is a `oneOf` of two shapes whose `status` enums contain
  exactly one value each: `approved_by_manager` and `declined_by_manager`.
  `approved_by_remote` is a status Remote sets and no client can.
- **A decline requires a `reason`; an approve does not.** A travel-letter
  approve additionally REQUIRES all three `responsible_for_*` cost allocations,
  null until then.
- `travel_document_number` is **required and always present** — *"The
  employee's travel document (passport) number."*
- `will_negotiate_or_sign_contracts` — *"This may affect the type of work
  authorization required."* The nearest published analogue to a PE signal.
- `work_location`, `additional_information`, `employer_special_instructions`
  all exist; we collect none of them.
- Webhook payloads are **stateless** — four ids and an event type. Any listener
  must GET the request back to learn anything. `page_size` caps at 100.
- Approver permissions, article `4413862365837`: *"Approve mobility request
  (remote work authorization, travel letter)"* — Company Owner ✅ · Super Admin
  ✅ · People Manager (direct + indirect) ✅ · Hiring Manager ❌ · Onboarding
  Manager ❌ · Company Viewer ❌.

### 1b. Right to work exists as a product surface with no API

Article `28495005990413` describes an *Employment eligibility* onboarding task
with a status drop-down and a stored **Right-to-work check section** on the
profile. **None of it is in the published API.** Article `31135018284813`:
Remote runs *"an automated database system designed to meticulously track and
manage critical compliance dates"* — permit expiries exist inside Remote and
are unreadable from outside.

The nearest reachable artifact is `GET /v1/employments/{id}/files?type=mobility`
— filename and timestamp, no permit class, no expiry, no verdict. `type` and
`sub_type` are free strings, not enums.

**Also confirmed at schema level:** there is no nationality, visa-type,
work-permit, residency-status or right-to-work field on the published
`Employment` object, nor in any country JSON schema (checked exhaustively for
PRT/NLD/USA/CAN). `custom_fields.workation_permission`, which UC-04's gate 4
reads, is **not a Remote-published field** — it exists because the stand-in
fills it.

---

## 2. The five findings that reframe the question

**2.1 The decisive field is activities, not days or purpose.** Both the
immigration test and the tax test are activity tests. IRPR s.187 [LAW]: a
business visitor engages in business *"without directly entering the Canadian
labour market."* UK Immigration Rules enumerate permitted activities surgically
— trade-fair promotion is permitted *"provided the Visitor is not directly
selling"* [LAW]. Fragomen [VENDOR]: *"certain activities considered by employees
as 'business activities' are deemed as productive work by receiving country
regulations."* The traveller's own label cannot be trusted.

**2.2 "Under 183 days" is one of three conditions and produces confident false
clears.** OECD Model art. 15(2), verbatim from the US–UK convention in force
[LAW] — all three must hold: (a) ≤183 days in any twelve-month period; **(b)
remuneration paid by or on behalf of an employer not resident in the host
state; (c) remuneration not borne by a permanent establishment in the host
state.** Measured on our four demo countries [KPMG country papers, Mar 2026]:

| | real trigger |
|---|---|
| **NL** | *"Dutch personal income tax can be triggered from the first working day."* Economic employer adopted |
| **PT** | *"There is no minimum threshold/number of days"* |
| **CA** | *"every employer, whether or not a Canadian resident, has a Canadian payroll reporting and tax withholding obligation"* — even where the treaty exempts |
| **US** | IRC §861(a)(3): $3,000 **and** ≤90 days, never indexed since 1954. *"If compensation is more than $3,000, the entire amount is… taxable"* — no proration. FICA has no de minimis |

Conditions (b) and (c) are "who pays" and "who bears the cost." **No vendor
advertises capturing either.**

**2.3 Blocking checks and notifying checks are different things.** Passport,
visa, sanctions, A1 and PWD notification are pre-departure hard stops. Income
tax, PE and transfer pricing are obligations to record. Conflating them either
blocks trips that should proceed or clears trips that should not. **UC-04
already gets this right** — see §5.

**2.4 A single-trip form is structurally insufficient.** Remote assesses
*"historical travel and absence data"*; every threshold is a rolling window;
Dir. 2014/67 art. 4(3)(g) makes *prior postings to the same post* a legal
factor; some jurisdictions aggregate days across all employees on a project.

**2.5 Nobody publishes refusal criteria.** Deel publishes prohibited
activities; Remote publishes what it will not issue for personal travel. No
vendor publishes *"these inputs mean decline."* That space is unoccupied.

---

## 3. The industry consensus is seven domains

Topia, Equus, Vialto, KPMG and EY all assess the same set. Topia, verbatim:
*"immigration and work authorization, income tax, corporate tax, social
security, and Posted Worker Directive exposure."*

**No vendor's product refuses a trip on its own authority.** The universal
pattern is auto-clear the low-risk, route the rest to a named human:

> **Topia:** *"Low-risk trips clear automatically. The ones that need review
> route to the right reviewer."*
> **Equus:** *"automatically approving it based on your unique business
> policies. Travel that needs further review can be instantly routed to
> managers."*
> **Vialto:** the words *approve, deny, block, refuse, reject* appear nowhere
> across both product PDFs.

Where a gate is real, the blocking rule is explicitly the customer's. And
"pre-trip" is often post-booking: Vialto and KPMG both trigger **on booking**,
so the assessment is *"you have booked; here is what you must now obtain."*

**Who approves is not industry practice.** Three incompatible models: Remote
(client HR → EOR Mobility), Deel (client manager approves, Deel's immigration
team assesses), Oyster (client HR + legal/finance, EOR absent). AIRINC and
SIRVA/BGRS have **no** pre-trip assessment product at all — a comparison table
listing them beside Topia/Equus/Vialto is wrong.

---

## 4. Statutory field lists — where the real schemas are

Vendors publish no field-level schema. Statute does, free:

**HMRC PAYE82000, STBV Appendix 4** [LAW] — full name · last known UK and
overseas addresses · **nature of duties undertaken** · date commenced · date
ceased · country of worldwide tax return · plus employer confirmation it does
not *"ultimately bear the cost of the employee's remuneration"*. Bands: 1–30 ·
31–59 · 60–90 · 91–150 (+ overseas residence certificate) · 151–183 (named
individual application to HMRC). All due 31 May following the tax year.

**Dir. 2014/67 art. 9(1)(a), PWD declaration** [LAW] — identity of the service
provider · anticipated number of clearly identifiable posted workers · contact
and liaison persons · anticipated duration, envisaged beginning and end date ·
**the address(es) of the workplace** · **the nature of the services justifying
the posting**. Due *"at the latest at the commencement of the service
provision."*

**Reg. 883/2004** [LAW] — art. 11(3)(a) default *lex loci laboris*; art. 12
posting, ≤24 months and not replacing another posted person; art. 13 multi-state,
with Reg. 987/2009 art. 14(8) supplying **25%** as a NEGATIVE indicator (*"a
share of less than 25%"* indicates substantial activity is NOT performed there).

**Reg. 2016/399 art. 6** [LAW] — 90 days in any 180-day period, *"which entails
considering the 180-day period preceding each day of stay"*; entry day is the
first day of stay, exit day the last. Passport validity must *"extend at least
three months after the intended date of departure"*.

---

## 5. What UC-04 has today

**Read from a real source:** employment status · `custom_fields.
workation_permission` · `company_id`/employment id · `files[]` type `id`
(presence only) · linked request `status` + `destination_country` · Zendesk
requester email (n8n path). Display-only: name, job title, contract type,
country of employment, start date, work email.

**Claimed by the requester, unverified:** home country · nationality ·
destination · dates · **visa type** · **job duties** · signing authority ·
**prior stays** (two optional rows — the entire history the day counters run
on) · reason text.

**Computed:** 18 rungs across 8 gates · `tripDurationDays` (inclusive) ·
`computeCumulativeDays` (distinct-day union) · `schengenPeakDays` (per-day-of-
stay, art. 6(1)) · four dimensions · two measurement rows.

**Sourced but discarded:** `travel_document_number`, resolved at decision time
and dropped — `authorizationStore.js` has no column.

**The blocking/notifying split is correct.** Every `blocked` rung is
immigration or data quality: sanctions · same-country · visitor-visa-forbids-
work · Schengen exceeded · US/CA work permit · unreadable history · malformed
dates. `tax_residency_watch`, `non_treaty_pair` and `a1_certificate_recommended`
are soft flags that move the level and never refuse.

`docs/INTAKE-RESEARCH.md:603` already concedes five of seven gate inputs are
facts Remote's own request does not collect — now confirmed at schema level
rather than inferred.

---

## 6. Duty of care — the case law, and what it makes the panel

**Dusek v StormHarbour Securities [2015] EWHC 37 (QB)** [LAW] — employee killed
in a helicopter crash on a business trip. Liable: the employer *"did nothing to
investigate into the safety of the proposed helicopter flight"* and owed a duty
*"to make at least some form of inquiry into the safety of the trip and carry
out some form of risk assessment."* Permission to appeal **refused**.

**Cassley v GMP Securities [2016] EWCA Civ 711** [LAW] — near-identical facts,
opposite outcome. Duty owed and breached, claim failed on causation. The
operative holding: GMP *"ought to have consulted the Foreign and Commonwealth
Office website"* — which would have shown the carrier on the EU banned list.
**Judicial authority that checking government travel advice is part of the
employer's reasonable pre-travel enquiry.**

**In both, the breach was the absence of enquiry, not a wrong decision.** An
approval record showing enquiry was made is the defence. This is why
`docs/UC04-DECISION-SURFACE.md` W-5c exists.

**ISO 31030:2021 requires nothing.** Type-B guidance; *"cannot be used for
certification purposes."* Nobody is "ISO 31030 certified" and a gate demanding
compliance is unenforceable. Its one decision-relevant free-text line:
*"the organization's overall appetite and acceptance of risk should not take
precedence, or be used exclusively, in deciding whether travel is appropriate
for security, safety or health reasons."*

---

## 7. Cross-domain collisions

**7.1 A1 applies to business trips; the PWD does not.** European Commission,
*Practical Guide on Posting* [LAW], both on one page: *"for every cross-border
work-related activity (including 'business trips') the employer… is under the
obligation to notify the competent (home) Member State, whenever possible in
advance, and obtain a portable document A1… That obligation covers any economic
activity, even if only of short duration. These Regulations do not provide for
any exceptions for business trips either."* And: workers on business trips
*"are not posted workers… not covered by the Posting of Workers Directives."*
**The lighter-sounding obligation is the one that still applies.**

**7.2 The EU telework Framework Agreement does not rescue a workation.** It
covers telework **in the employee's state of residence**, 25–<50%, employer
established elsewhere. A workation is work in a country that is neither. It
does not help.

**7.3 Doing what the safety standard says puts you in GDPR art. 9.** ISO 31030
cl. 4.3 requires attention to *"race… nationality, cultural identity, gender,
sexual orientation, religion, age… disability or medical history"* against the
destination. Four are special category data; ICO's inference rule pulls
nationality in when used to act on an ethnic-origin inference.

**7.4 Consent cannot carry a workation.** WP29 Opinion 2/2017 [LAW]: *"the
consent is not valid since it is not and cannot be freely given"* where refusal
carries adverse consequence. Refusing to supply the data means the trip is not
approved. A consent checkbox is not a lawful basis.

**7.5 Remote access from abroad is not a Chapter V transfer — but sharing is.**
EDPB Guidelines 05/2021, Example 8 [LAW]: an employee accessing employer data
abroad *"does not qualify as a transfer… since George is not another
controller, but an employee, and thus an integral part of the controller."* But
*"in case George… would send or make data available to another controller or
processor in the third country, the data flow in question would amount to a
transfer."* **Intra-group is not exempt.**

**7.6 The recharge decision is made by finance and destroys treaty relief.**
Transfer pricing wants the cost recharged to the benefiting entity; employment
tax wants it not borne by the host entity. HMRC DT1923's default runs against
the taxpayer. You usually cannot have both.

**7.7 Seven clocks, none aligned.** US tax home **1 year** (on expectation) ·
UK temporary workplace **24 months** + 40% working-time test · EU posting
**24 months** · UK–EU TCA detached worker **2 years** · travel insurance
**31/90/180/365 days** · HMRC STBV **30/60/90/150/183** · US states
**0/14/20/23/30**. A single `duration` field cannot serve these.

---

## 8. What could not be verified — do not encode

1. **A reported April/July 2026 revision of Reg. 883/2004**, possibly
   introducing a three-consecutive-working-day A1 exemption for business trips.
   Not found in EUR-Lex or the OJ. If real it is the first EU-level de minimis
   for short trips and changes gate design.
2. **ISO 31030 clause TEXT** — paywalled. Clause numbers and titles are
   confirmed from ISO's own contents page; the content is not.
3. **OECD Model art. 15 verbatim and Commentary ¶8.13/8.14 content** — verified
   by proxy (a treaty in force, HMRC's citation of the 8–8.28 range), not read
   in the OECD text.
4. **A1 penalty amounts** (~€3,269 France, up to €10,000 Austria) — vendor
   claims. The existence of an inspection-and-fine regime is well attested.
5. **Topia Compass documentation** — 404/410, `web.archive.org` blocked here.
   The widely-quoted "pass/fail result" line is not verifiable at source.
6. **"Tax protection" and "shadow payroll" have no primary-source definition**
   from any tax authority. The IRS has no shadow-payroll concept at all.
7. **US state thresholds other than IL, NY and WA.** Georgia's reported
   23-day/$5,000 rule appears in vendor material only.
8. Duty of care is the thinnest dimension of the seven strands.

---

## 9. Art. 15(2)(b) in an EOR — CHECKED 2026-08-31, half the hypothesis is dead

**The hypothesis was:** in an EOR, art. 15(2)(b) (*remuneration paid by an
employer not resident in the host state*) is satisfied by construction, because
Remote's employing entity is resident in the country of employment; and the
system could READ that entity's country off the API and say so.

**The data leg is dead.** `engaged_by_legal_entity_id` — which
`normalizeEmployment()` maps to `legal_entity_id` — is **the CUSTOMER's legal
entity, not Remote's**. Rung 1: Remote's `POST /v1/employments` reference
documents the field only under **Global Payroll**, *"the specific legal entity
that the employee will be engaged by and billed to"*, and the endpoint that
resolves it *"lists all active legal entities for the authorized company"*.
Rung 2, measured across 40 employments on one company (6 entities): entity
country equals employment country **18 of 18** for `global_payroll`, **1 of 12**
for `contractor`, **0 of 1** for `direct`, and 3 of 5 for `eor` — all three
being US employees. Where the customer has an entity in that country the field
points at it; where it has none (the definition of EOR) it falls back to the
customer's HQ entity.

**Remote's own employing entity is not exposed by the published API at all** —
no field on `Employment`, and every legal-entity endpoint is scoped to the
authorized company. No better field exists to read.

**What survives.** Condition (b) may still hold structurally, but it must be
DERIVED rather than read: `employment_model === "eor"` plus `country.code`
means the employing entity is in the country of employment **by definition of
EOR**, and a workation to a third country is therefore to a state where the
employer is not resident. That is a claim about the arrangement, not a lookup
— weaker evidence, and it must be labelled as such if UC-04 states it. The
legal half (does the economic-employer doctrine displace the formal employer
here, and does it apply at all when nobody in the host state receives
services?) was researched separately; see §10 when it lands.

**It also found a defect one use case over.** UC-01's letter prints that same
customer entity as the **Employer of Record**, so for every non-US EOR employee
it makes a false statement about a legal relationship — the exact thing
`policyEngine.js:399` refuses a contractor letter for. Invisible until now
because the only EOR employee the demo drives is a US one, where the customer's
HQ entity and the country of employment coincide. Recorded as **K16** in
`qa/HUMAN-DECISIONS-REQUIRED.md` with three options; not actioned, because it
changes what a shipped customer-facing document says.

---

## 10. Sweden — the hardest test of §9's surviving half, and it holds

Sweden adopted an economic-employer approach on 1 Jan 2021 and is one of the
most aggressive jurisdictions on this axis, so it is the right place to try to
break the claim that art. 15(2)(b) and (c) hold structurally on a third-country
workation. **It holds, on two independent grounds, both stated in primary law.**

Fact pattern tested: EOR in X employs the person; client in Y; person spends a
few weeks physically in **Sweden** doing their normal job. No Swedish entity, no
Swedish client, no services to anyone in Sweden, no recharge to Sweden.

**Sweden does have a prima facie claim** — SINK 5 § första stycket 2 charges
income *"i den utsträckning inkomsten förvärvats genom verksamhet i Sverige"*
(to the extent earned through activity in Sweden), and working from a laptop in
Sweden is `verksamhet i Sverige`. Anyone who says Sweden has no claim at all is
wrong at step one. The question is which exemption applies.

**Ground 1 — the economic-employer carve-out needs a Swedish counterparty, and
there is none.** SINK 6 a § andra stycket disapplies the 183-day rule only for
`uthyrning av arbetskraft`, and only *"om uppdragsgivaren är"* one of three
Swedish-nexus categories. Prop. 2019/20:190 addresses the foreign-to-foreign
case by name:

> *"Om en arbetstagare är anställd av ett utländskt företag som saknar fast
> driftställe i Sverige och hyrs ut till ett annat utländskt företag som också
> saknar fast driftställe här, finns det ingen uppdragsgivare som är
> skattskyldig för inkomst av näringsverksamhet i Sverige. Därmed kan
> uthyrningsregeln inte bli gällande."*

So even on the **worst** characterisation — that Y's client is the economic
employer — Y's client is not a Swedish taxpayer and has no Swedish PE, so it
cannot be an `uppdragsgivare`. **The X–Y recharacterisation is simply not a
question Swedish law poses**, because no answer to it could change the outcome.

**Ground 2 — working for your own employer is not hiring-out at all.**
Skatteverket, Rättslig vägledning: *"Uthyrning föreligger däremot inte när
arbetstagaren utför arbete i Sverige för den egna arbetsgivaren i utlandet."*
And prop. 2019/20:190 under its own heading: *"Uthyrning av arbetskraft ska inte
anses föreligga när arbetstagaren utför arbetet direkt för sin egen
arbetsgivare."* The rule presupposes three parties; a workation has two.

**So the ordinary 183-day rule survives**, and its three conditions are SINK
6 a § första stycket — presence ≤183 days in any twelve-month period, paid by an
employer not resident in Sweden, not borne by a Swedish PE. Those are art. 15(2)
(a)/(b)/(c) transposed into domestic law, and (b) and (c) hold **however the
employer question is resolved**, because neither X nor Y is Swedish.

### 10a. THE TRAP — do not build a policy on Sweden's 15/45 rule

SINK 6 b § provides that work of *"högst 15 dagar i följd"*, up to *"45 dagar
under ett kalenderår"*, is not `uthyrning`. This is widely quoted in secondary
material as if it were Sweden's day threshold for a workation. **It is not.** It
is a carve-out from the DEFINITION of labour hire, inside a rule that never
engages here. On these facts there is no `uthyrning` for it to switch off.

The practical consequence is counter-intuitive and worth stating plainly: a
four-week workation with 20 consecutive working days **exceeds** the 15-day
limb and this is **harmless**, because 6 b § was never the reason the income is
exempt. The ceiling that matters is 183 days of physical presence in a rolling
twelve months. Treat *"we are under 45 days so we are fine"* as a **red flag,
not a conclusion** — and note the two counters are not even the same: 6 b §
counts **working days**, the 183-day rule counts **all days of presence,
including arrival and departure days**.

### 10b. Withholding is the real exposure, and it is presence-driven

Since 2021 a foreign payer with no Swedish PE must withhold **30 %** from
remuneration for work performed in Sweden (SFL 10 kap. 6 § första stycket) —
triggered by physical presence, not by taxability. It is switched off here by
**SFL 10 kap. 5 § första stycket 5**: *"Skatteavdrag ska inte göras från …
ersättning som är undantagen från skatteplikt enligt 6 a § lagen (1991:586)."*

**Two asymmetries worth carrying, because neither is obvious:**

- **A treaty-only exemption does NOT switch off withholding.** 10 kap. 5 § p.5
  cross-refers to SINK **6 a §** and not to **6 §** (which is where treaty
  exemption lives, at p.5 *"inkomst som är undantagen från beskattning på grund
  av bestämmelse i skatteavtal"*). Relying on the treaty rather than on the
  domestic 183-day rule leaves the withholding duty live and needs a
  Skatteverket decision.
- **Registering or over-withholding "to be safe" is not free.** Registration
  creates a monthly `arbetsgivardeklaration` duty (SFL 26 kap. 3 § andra
  stycket), and SFL 26 kap. 2 § limb 1 catches anyone *"som har gjort ett
  skatteavdrag utan att vara skyldig att göra det"*. Taking F-skatt or starting
  to withhold also triggers an annual `särskilda uppgifter` filing (SFL 33 kap.
  6 a §) describing what activity the company carried on in Sweden and for how
  long — which is the fact pattern Skatteverket uses to assess PE.

The one-line rule: **in Sweden withholding is presence-driven and everything
else is withholding-driven.** Break the withholding link and registration, AGI
and särskilda uppgifter all fall away with it.

### 10c. The axis a workation policy should actually be governed on

Not day counts. Two things:

- **`stadigvarande vistelse`** (IL 3 kap. 3 §) makes the person *unlimitedly*
  liable, at which point SINK 6 a § is unavailable **by its own terms**.
  Normally read as six months or more.
- **Whether the employee's presence creates a Swedish PE for the employer.** If
  it does and the remuneration is borne by it, 6 a § första stycket p.3 fails
  and the whole withholding chain in §10b turns on. Skatteverket's position
  reportedly turns on whether the employer **requires** the Swedish work rather
  than merely permits it — a workation requested by the employee is the weakest
  possible PE case.

### 10d. Not verified

- **Skatteverket publishes NO position on "Employer of Record."** Searched
  explicitly; the term returns zero pages. Any claim that Skatteverket accepts
  or challenges EOR structures is **[VENDOR]**, not authority.
- Skatteverket's live Rättslig vägledning is behind bot protection; all RV
  quotations above came from **Wayback snapshots** (editions 2024.6 / 2025.1)
  against a current live edition of 2025.3+. The underlying statute is
  unamended on these points since 2020/21, so drift is unlikely but unverified.
- The home-office PE ställningstagande could not be retrieved, and a
  **replacement dated 17 March 2026** is reported but unverified.
- No HFD or Skatterättsnämnden case law was searched.
- The **Nordic** treaty contains its own `uthyrning` protocol provision — it was
  the model for SINK 6 a § — so if X is DK/FI/NO/IS, check it specifically.

---

## 11. Germany and the Netherlands — the claim survives but must be stated more narrowly

Sweden (§10) tested whether a host state's economic-employer rule can reach a
third-country workation. Germany and the Netherlands test something different
and more dangerous: **whether the EOR is the treaty employer at all.**

### 11a. Neither country has a published tax position on "Employer of Record"

Measured, not assumed:

- **BFH decision database**, full-text `"Employer of Record"` → *"Es wurden keine
  Ergebnisse gefunden."*
- **BMF-Schreiben 12.12.2023** (GZ IV B 2 - S 1300/21/10024 :005, 427 Rn.), the
  governing German administrative document for DBA art. 15 — **zero**
  occurrences of "Employer of Record", "AÜG", "Arbeitnehmerüberlassungsgesetz"
  or "Erlaubnis". The 19.12.2025 amendment does not touch this.
- **Belastingdienst kennisgroepen**: `employer of record` → 0, `payrolling` → 0,
  against working controls (`inhoudingsplichtige` → 107).
- **All Dutch official publications** via the overheid.nl SRU API:
  `"employer of record"` → **0**, against `payrolling` → **760**.

So no tax authority in either country has blessed *or* challenged the structure.
**Any claim otherwise is vendor material.** (Same result as Sweden, §10d.)

### 11b. But both publish a position on the ARRANGEMENT, and it points one way

**Germany, BMF-Schreiben 12.12.2023 Rn. 189** — on cross-border hiring-out of
labour, which is what Rn. 150 routes an EOR to:

> *"Bei einer grenzüberschreitenden Arbeitnehmerüberlassung nimmt grundsätzlich
> **der Entleiher die wesentlichen Arbeitgeberfunktionen** wahr… Dementsprechend
> ist (**abweichend von** Tz. 4.3.3.3.1, Rn. 158) **bereits mit Aufnahme der
> Tätigkeit** des Leiharbeitnehmers beim Entleiher i. d. R. dieser als
> **Arbeitgeber i. S. des DBA** anzusehen."*

The hirer is the treaty employer **from the first day**, expressly by derogation
from the normal rule. Rn. 210–211 extends the same result to **unrelated**
companies, which is exactly the EOR↔client relationship. The escape in Rn. 192
is narrow: it needs remuneration determined independently of hours worked **and**
short duration — the cited BFH order says **two and a half weeks**.

**Netherlands**: the governing published position is Besluit 15.12.2023,
nr. 2023-24021 (Stcrt. 2023, 31181), which for treaties signed from 22 July 2010
applies OECD Commentary 8.1–8.28. Its **superseded** 2010 predecessor carried a
worked hiring-agency example whose reasoning maps almost exactly onto an EOR —
*"Materieel bezien worden door het Duitse uitzendbureau niet of nauwelijks
werkgeversfuncties uitgeoefend… de Nederlandse inlener [is] in deze situatie
verdragswerkgever"* — and concluded the **client** was the treaty employer. The
example is not reproduced in the 2023 besluit, so treat it as indicative of
administrative thinking rather than current published policy.

Dutch labour law goes further and has a **statutory analogue**: art. 7:692 BW's
`payrollovereenkomst`, whose two limbs (the client sourced the worker itself; the
provider cannot redeploy them without consent) both fit a typical EOR.

### 11c. What this does to the claim

It does **not** break the workation result. Germany's Rn. 189 makes the
**Entleiher** the treaty employer; on a workation the Entleiher is the client in
Y, who is not resident in the destination Z either. So art. 15(2)(b) — *an
employer not resident in the host state* — still holds. Sweden reached the same
place by a different route.

**What it breaks is the REASON.** §9 justified (b) by saying the employer is
Remote's entity in the country of employment. Germany and the Netherlands both
say that in a hiring-out arrangement **the client is the employer**, from day
one. The conclusion survives; the premise does not.

**So the honest statement is not "the EOR is not resident in the destination".
It is: NEITHER CANDIDATE EMPLOYER IS RESIDENT IN THE DESTINATION.** And that is a
checkable claim with a **named residual case where it fails**:

> **(b) fails where the client company — or a group company that bears the
> cost — is resident in the destination.**

That is not exotic. A company with an entity in Portugal, whose employee is
employed through an EOR in the Netherlands, takes a workation to Portugal. The
Portuguese entity is a candidate treaty employer resident in the destination,
and on the German and Dutch reasoning it is the more likely one. §7.6's recharge
finding is the same hazard from the other side.

**Consequence for UC-04.** The system cannot assert (b) from the employment
record alone, because the record does not name the client's entities. It can
assert it from **two** facts: `employment_model === "eor"` (so the employing
entity is in the country of employment) **and** a negative answer to *"does the
company have an entity in the destination country?"* — which is one question,
answerable by the requester, and already adjacent to W-2's activity profile.
Without the second fact the honest output is *not established*, not *satisfied*.

### 11d. AÜG licensing is not a tax fact — do not let it leak

Germany's Bundesagentur für Arbeit reversed itself on whether remote EOR needs an
`Arbeitnehmerüberlassung` licence (position of 15.10.2024 reversed by Weisung
202509010, effective 01.10.2025, for the *fully remote, never-enters-Germany*
case only). It is loudly discussed in commentary and it is **irrelevant here**,
which is worth recording so nobody wires it in:

> **FW AÜG 1.2 Abs. 3:** *"Ob eine deutsche Verleiherlaubnis erforderlich ist…
> ist eine dem öffentlichen Recht zuzuordnende Frage des **Gewerberechts**. Die
> sozialversicherungsrechtliche, **steuerrechtliche** oder arbeitsrechtliche
> Beurteilung ist **nicht ausschlaggebend**."*

And the § 10 deemed-employment fiction applies to all fields of law *"**mit
Ausnahme des Steuerrechts**"*. The two regimes are decoupled from both sides:
an unlicensed EOR does not become tax-transparent, and a licensed one gets no
protection from Rn. 189. Note also the residual trap commentary flags — a
business trip into Germany can itself create the `Inlandsbezug` the remote
carve-out relies on being absent.

### 11e. Not verified

- The Fachliche Weisungen **never use the words "Employer of Record"** — grepped
  across both the current and superseded official PDFs, zero hits in either. At
  least one commentary summary asserts they do. The BA regulated a
  constellation; the market named it.
- No Bundestag Drucksache found, but this is a **weak** negative — the DIP API
  needs a key and the site is JavaScript-rendered.
- Dutch case law was not full-text searchable from this container, so the "no
  Dutch court has used the term" claim is weaker than the Kennisgroepen and
  official-publications negatives, which are strong.
- `gesetze-im-internet.de` was unreachable; AÜG text came from dejure.org, a
  reliable mirror but not the official Bundesamt für Justiz text.

---

## 12. The consolidated art. 15(2) answer — (b) and (c) hold; the hypothesis breaks on question 4

**OECD material below is PARAPHRASED with paragraph citations, never quoted.**
`docs/knowledge/layer-1-statutory/L1-01-L1-11-oecd-citation-register.md`:
*"Paraphrase plus precise citation. Never the text."* National manuals and
bilateral treaties are not under that restriction and are quoted directly.

### 12a. (b) and (c) hold — and for a better reason than §9 gave

Not merely *"the EOR is resident in X."* The economic-employer apparatus is
**textually conditioned on a recipient enterprise existing in the source
state**, and a third-country workation deliberately contains none.

Commentary on art. 15: **para. 8** frames the (b)/(c) exception as aimed at
services rendered to an enterprise whose profits are taxed in that State;
**para. 8.7** grounds recharacterisation in services being rendered to a
resident of the state where they are performed; **para. 8.13** states the
integral-part analysis is relevant only where services are rendered directly to
an enterprise; **para. 8.14**'s factors presuppose two parties, the formal
employer and the enterprise receiving the services — with no such enterprise in
Z the second column cannot be populated; **para. 6.2** gives the purpose as
avoiding source taxation where the remuneration is not deductible in the source
state because the employer is neither resident nor has a PE there. **Example 6
(paras. 8.26–8.27)** is the closest positive analogue and concludes the para. 2
exception applies. The 2025 Update did **not** amend 8–8.28.

Every national implementation checked is drafted the same way, in its own words:

- **Germany**, BMF 12.12.2023 Rn. 151 — the treaty employer is the person who
  economically bears the remuneration for work *"die die Vergütung für die **ihr
  geleistete** unselbständige Tätigkeit wirtschaftlich trägt"*. Rn. 193's worked
  example decides it our way where the foreign enterprise *"nimmt… **keinerlei
  Arbeitgeberfunktionen** wahr"* and is neither resident nor has a PE.
- **Netherlands**, HR 1.12.2006 (ECLI:NL:HR:2006:AT3928) r.o. 3.4.3 requires the
  cost to be *"geïndividualiseerd aan de werkgever **in de werkstaat**"*
  recharged. Handboek Loonheffingen 2026 §19.1.1 states all three conditions
  against *"de opdrachtgever **in het werkland**"*.
- **Denmark**, KSL §2(1)(3) requires being *"stillet til rådighed for at udføre
  arbejde for **en virksomhed her i landet**"*. Skattestyrelsen disapplies the
  rules *"if you are hired out to a foreign business which is not liable to pay
  tax in Denmark."*
- **Sweden**, SINK 6 a § — see §10.

**And the recharacterisation question is arithmetic, not judgement.** Condition
(b) is a *residence* test. Recharacterising swaps an employer resident in X for
one resident in Y. **Neither is Z.** It redistributes taxing rights between X
and Y and creates no nexus in Z. This is why §11's finding — that DE and NL make
the client the employer — changes the reason and not the answer.

**One primary source directly on triangulation:** CRA technical interpretation
**2012-0457671I7** (20 July 2015) — employee resident in X, employer resident in
a third country B, work in Canada. CRA applied the **Canada–X** treaty, *"even
though the employer resides in a third country,"* and held art. 15(2)(c)
satisfied. The instrument is the **Z↔employee-residence** treaty, not
Z↔employer.

### 12b. WHERE THE HYPOTHESIS BREAKS — (a) is the only live TREATY condition, and that is not the same as the only live condition

Treaty exemption extinguishes **liability to tax**. It does not extinguish
**withholding** or **reporting**, and art. 15(2) does not touch them. In three of
the four demo countries the relief from withholding is a **fail-closed
documentary procedure with a deadline that must complete before payment**.

| | liability | withholding | reporting |
|---|---|---|---|
| **Canada** | extinguished | **survives** — relief only via R102-R waiver or RC473, *"until you receive an approval letter, you must continue to withhold and remit tax"*, and a waiver applies only to payments made **after** it issues | **survives** — T4 due *"whether or not a waiver was received"* |
| **Portugal** | extinguished | **survives conditionally** — relief only if Modelo 21-RFI + residence certificate reaches **the payer** by the 20th of the following month (CIRS art. 101.º-C, 98.º n.º 3); otherwise the substitute must hand over the whole tax | **survives unconditionally** — Modelo 30 due at 0% |
| **United States** | extinguished | **survives** — Form 8233 must be filed *and accepted*; Treas. Reg. §1.1441-4(b)(2)(iii) requires withholding where eligibility *"cannot be readily determined"* | **survives** — 1042/1042-S due *"even if no amount is deducted"* |
| **UK / DE / NL / DK / SE** | extinguished | **does not arise** — no domestic hook without local presence. HMRC: *"There is a territorial limit to PAYE"* | — |

The Commentary concedes rather than solves this: **para. 6.2** offers freedom
from source deduction as a *rationale* for the exemption, not as something it
delivers, and **para. 8.28** accepts double withholding can occur. The OECD's
own November 2025 *Global Mobility of Individuals* consultation still lists it
as unsolved (para. 15).

**So the correct model is not "withholding always survives" and not "treaty
exempt means nothing to do."** It is a **per-jurisdiction fact with no default**,
splitting on whether the state asserts an extraterritorial withholding duty.
Sweden shows the cascade when it does not: SFL 10:5 p.5 disapplies withholding,
and 33:6 a § gates the annual disclosure on the withholding duty, so exemption
flows all the way through — and switches back on together if 183 days is crossed
or a Swedish client appears.

**The day count is also harsher than it looks.** Commentary para. 5 uses
**physical presence** days — part-days, arrival, departure, and holidays before,
during and after the activity. Germany's BMF Rn. 108 says it for adjacent
holidays; the Dutch Handboek: *"Een dagdeel telt u als een volledige dag"*;
Denmark counts *"både hele og brudte døgn"* and applies the source right
**retroactively to day one** on breach. **A two-week workation with a three-week
holiday attached is thirty-five days, not ten.**

### 12c. The highest-value single check: Z = Y

**If the destination is the client's own country, it is not a third-country
workation.** Recharacterisation then puts the employer in Z, (b) fails, and
Germany, the Netherlands and Denmark all tax **from day one** — Denmark's
arbejdsudleje limb is not even subject to its own 183-day carve-out. An employee
employed via an EOR visiting the client's HQ is **completely ordinary**, and this
is computable: compare the destination against the client company's country.
Build this before anything else in the treaty dimension.

### 12d. PE in Z — cleared by duration, not by structure

The 2025 Update inserted art. 5 Commentary paras 44.1–44.21 on cross-border
working from a home *or other relevant place*, expressly including a holiday
rental (44.1). **Para. 44.8** gives a safe harbour below **50% of total working
time over any twelve-month period**, and **Example A** — three consecutive
months in a rented place following a holiday stay — concludes the place is not
fixed. Germany has legislated the same threshold: BMF 18.06.2026 Rn. 145, and
its final version extends the 50% harbour to **leadership functions**, which the
February 2026 draft did not.

But it is cleared by **duration and purpose**, not by structure. Repeat
workations to the same flat aggregate, and above 50% paras. 44.11–44.12's
commercial-reason test can find a PE with no client in Z at all.

HMRC **DT1923** also cuts the opposite way from how §9 read it: the adverse
default has two cumulative predicates — UK operations carried on *through a PE*
**and** an employee *seconded to that PE* — neither of which holds here. HMRC
says to consider (c) *"carefully in all cases where the employee has **not**
apparently been assigned to work in the United Kingdom for a United
Kingdom-resident company"* — **more** scrutiny for our case, not less; we simply
pass it. And *"a subsidiary company in the United Kingdom is not generally a
permanent establishment of its overseas parent"*, which disposes of the "Remote
has an entity in Z" worry on its own.

### 12e. What the tool may say

✅ *"The employing legal entity on this record is registered in the Netherlands;
the destination is Portugal. On that record the employer is not **registered** in
the destination. Condition (b) also requires the employer not to be **resident**
there for treaty purposes, and that no part of the remuneration is paid by or on
behalf of anyone resident there — neither of which this system can verify.
Condition (b) is **not refuted**; it is **not established**."*

❌ *"Condition (b) is satisfied."*

`src/uc04/authorizationRecord.js:110` already renders *"registered in"*, which is
the correct hedge: OECD art. 4(1) defines residence by domicile, residence,
**place of management** or similar — incorporation is not named.

**The decision rule collapses to one question asked of Z, and it is not a day
count:**

> Is there any person resident in Z, or any PE in Z, that (i) directs the work,
> (ii) bears its benefit and risk, or (iii) receives any recharge of the
> employee's cost?

### 12f. What would make this wrong — ordered by likelihood

1. **Z = Y** (§12c). Ordinary, foreseeable, computable.
2. **Any recharge or locally-borne benefit in Z** — accommodation, a car, a
   per-diem from a group entity there. HMRC DT1922's BENEFITS paragraph fails
   (b) for those items specifically even where salary passes. Under the
   post-22-July-2010 framework a recharge is not even necessary: the factors
   ceased to be cumulative.
3. **No treaty between the employee's residence state and Z** — all three limbs
   become irrelevant and the domestic charge runs at full rate (PT 25%).
4. **Withholding and reporting** (§12b) — this is what makes *"(a) is the only
   live condition"* wrong.
5. **Longer, recurring or leadership-shaped trips** (§12d).
6. **Day counting** — presence days, adjacent holidays, Denmark's retroactivity.
   Portugal's CIRS art. 16.º n.º 1 b) needs **no day count at all**: a lease
   suggesting intention to keep a home can trip residence, back-dated by n.º 3
   to the first day of the stay.
7. **The API answer is about the wrong entity, or absent** — see §12g.
8. **Treaty deviations.** US–Canada art. XV(2) is **disjunctive** and re-worded
   (*"borne by an employer who is a resident"*), so a three-cumulative-condition
   model misreads it. Germany has ~25 treaties with Leiharbeit clauses letting
   the activity state tax *"unabhängig davon, wie lange"* — no 183-day
   protection at all. The Netherlands is not among them.
9. **Social security is not in art. 15 at all.** Reg. 883/2004 art. 11(3)(a)
   makes the state of activity competent from day one unless art. 12 applies —
   and art. 12 requires being **posted** *"to perform work on that employer's
   behalf"*. A self-chosen workation is arguably not a posting. This is very
   often the binding constraint.
10. **Six jurisdictions verified, ~190 not.** Norway holds a standing
    reservation to insert hiring-out language into art. 15(2) itself.

### 12g. Two findings about this repository

**`src/remote/restClient.js:1919`** —
`legal_entity_id: raw.engaged_by_legal_entity_id ?? raw.bill_to_legal_entity_id ?? null`.
The **engaging** entity and the **billing** entity are different companies, and
in the fallback branch the field silently names the wrong one. Any claim about
condition (b) built on it would be a claim about a different company. The
`?? null` branch is live too. This **compounds K16** (§9): the letter already
names the customer's entity as the Employer of Record, and on some records it
names the customer's *billing* entity.

**`CONTRADICTIONS.md` C-11 is wrong as written for this fact pattern.** It
asserts *"For an Employer-of-Record arrangement, limbs (b) and (c) are the ones
that decide the case."* That is right for **Z = Y** and wrong for a genuine
third-country workation, where (b) and (c) hold structurally and (a) is the live
treaty limb. C-11's core point — that a day count answers one limb of three and
a dossier rendering it as *the* answer is a Test B failure — **survives intact**.
Corrected in place with a dated note rather than rewritten.

### 12h. Corrections to earlier statements in this project

- **Two different CAD 10,000 figures do different jobs.** Reg. 200(1.1)(b) is a
  **T4-filing** threshold; Canada–US art. XV(2)(a) is a **treaty exemption**
  threshold. The qualifying-non-resident-employer *withholding* test (ITA
  s.153(6)) is **45 working days in the calendar year / 90 days of presence in
  any 12 months** and carries **no dollar figure at all**.
- **Portugal's reporting form is Modelo 30, not the DMR** — the DMR's own
  instructions exclude non-residents. AT ruling PIV 25800 (2024-02-12) confirms
  Modelo 30 is due on a fully treaty-exempt payment.
- **US state tax is not "treaties never help at state level."** The reason is the
  treaty's **scope** clause (2016 US Model art. 2(3)(b) covers federal income
  taxes), not supremacy — so states reaching exemption by conformity to federal
  AGI *do* get there (Wisconsin DOR Pub. 122 says so expressly) and states that
  decouple do not. **Genuinely 50-state; worse than a flat rule for automation.**
  Also art. 1(4)'s saving clause, with art. 14 absent from the art. 1(5)
  carve-outs, means a US citizen or green-card holder gets no relief at all.

### 12i. Not verified — read before relying on any of this

- **No on-point authority anywhere for the workation fact pattern itself.** Every
  national conclusion is derived from the *elements* of the rules, not from a
  ruling on these facts. Denmark's carve-out is the closest express statement.
- **Portuguese binding ruling PIV 5942/2021** — literally this fact pattern,
  reported to hold a nexus-less foreign employer need not withhold; **full text
  unobtainable**. Its counterpart **PIV 461/2018** reportedly holds the opposite,
  also unobtainable. The single highest-value outstanding document.
- **The Dutch art. 6 lid 3 sub c "tussenkomst" tension** — the Belastingdienst's
  web page states the rule more broadly than the statute, and no reconciling
  source was found. Largest open risk in the Dutch analysis for an EOR.
- German statutory text was taken from dejure.org (`gesetze-im-internet.de`
  unreachable), cross-checked against the BMF letter's own application.
- Whether CRA's or Portugal's stated obligations are actually **collected**
  against a foreign employer with no local presence: not researched.
- **US state employer registration / UI / nexus** consequences: not researched,
  and likely material.
- "Not found" is not "does not exist" for the EOR-position negatives.
