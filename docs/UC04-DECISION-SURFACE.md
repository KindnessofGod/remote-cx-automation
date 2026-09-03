# UC-04 — the specialist decision surface: scoped work

**Written 2026-08-31.** Scopes five units of work on UC-04, derived from a
seven-strand research pass (`docs/UC04-RESEARCH-FINDINGS.md`) that asked what a
global mobility specialist actually needs in front of them to authorize a work
authorization. **Nothing here is built yet.** Each item states what changes,
which files, what test proves it, and — as importantly — what it deliberately
does NOT do.

## 0. The framing, because it decides the scope

The research answered a bigger question than UC-04 asks. A Big-4 mobility
platform assesses seven regimes (immigration, income tax, sub-national tax,
social security, corporate tax/PE, payroll withholding, posted workers) against
seven non-aligning clocks. **UC-04 is not that and must not become it.** It is
the 🟡 tier: *AI prepares and risk-scores → a human approves*. It triages, it
refuses the immigration-hard cases, and it hands a prepared case to the
customer's manager and then to Remote's Mobility Team.

Three findings vindicate the existing design and are the reason this is five
scoped items rather than a redesign:

- **The blocking/notifying split is already correct.** Every rung that returns
  `blocked` is an immigration or data-quality block (sanctions, same-country,
  visitor-visa-forbids-work, Schengen exceeded, US/CA work permit, unreadable
  history, malformed dates). The tax items — `tax_residency_watch`,
  `non_treaty_pair`, `a1_certificate_recommended` — are soft flags that move the
  risk LEVEL and never refuse. The research names conflating these as the
  standard failure; we do not.
- **`schengenPeakDays()` is better than the commercial tools.** It runs the
  per-day-of-stay scan art. 6(1) requires. Published vendor material describes
  per-trip counts.
- **`hasContractSigningAuthority` matches Remote's own
  `will_negotiate_or_sign_contracts`**, the one field Remote's schema flags as
  changing the class of authorization required.

What is wrong is the **input layer** (five of seven gate inputs are unverified
claims, and we discard a field Remote hands us) and the **output layer** (the
panel argues its own epistemology instead of showing a record).

---

## W-1 — Keep `travel_document_number` — **DONE 2026-09-01, by reading rather than keeping**

> **The scope below asks for two columns and a migration. It ships as a LIVE
> READ, and that is better on every axis that matters here.**
>
> `uc04_authorizations` already durably holds `work_authorization_id`. What was
> never kept is what that request SAID — so `src/uc04/linkedRequest.js` fetches
> it at the moment the panel opens, exactly as the employee card already fetches
> the employment record. Reasons, in order of weight:
> - **A snapshot cannot answer "what does Remote say now."** The employer may
>   have edited, withdrawn or had the request decided since. The employee card
>   two inches above is a live read for that reason and says so on the screen;
>   two adjacent blocks with opposite freshness semantics teach a reader to
>   trust neither.
> - **No migration.** `uc04_authorizations` is provisioned by hand and Supabase
>   is unreachable over raw TCP from a coding session. A column the deployment
>   does not have is a field the store silently drops — the half-done shape
>   `workflow.js` already refused for `remote_request` and `reason_text`.
> - **It brings six fields, not two.** `travel_document_number`,
>   `work_location`, `will_negotiate_or_sign_contracts`, `reason`,
>   `additional_information`, `submitted_at`, plus the request's live `status`.
>
> **Two guarantees are pinned structurally, not argued.** It can never clear the
> immigration dimension — a travel document number is the document the traveller
> will travel ON, and `UC-04.md` §5/§9 forbid inferring the immigration
> document, so the test sweeps every shape the read can produce against a
> `cleared` that must be unreachable. And no gate, matrix, approval policy or
> workflow may import it, asserted by reading those five files: a view fact that
> could reach a gate is a different thing needing a different argument.
>
> **Four absences, four sentences.** "No linked request" (the portal's ordinary
> case), "Remote says it is gone", "we could not ask", "this deployment never
> asks" — only one of those is about the traveller, and a bare "none" would
> merge them.
>
> `test/uc04LinkedRequest.test.js` (11 tests). `npm test`: 5,407 tests, 0 fail.

## W-1 — Keep `travel_document_number` (original scope)

**The defect.** `resolveWorkAuthorizationRequest()` fetches the Remote
`WorkAuthorizationRequest`, which carries `travel_document_number` as a
**required** field (Remote's own OpenAPI: *"The employee's travel document
(passport) number"*). `authorizationStore.js`'s `SELECT_COLUMNS` has no column
for it, so it is read and dropped. `decisionFacts.js:866` then spends a
paragraph explaining that no document is on file — while naming the field it
just threw away, and calling it *"already an open item on this use case"*.

**What changes.**
- Migration: add `travel_document_number text` and `work_location text` to
  `uc04_authorizations`. Additive, nullable, no backfill.
- `src/uc04/authorizationStore.js` — add both to `SELECT_COLUMNS` and the
  insert.
- `src/uc04/workflow.js` — persist them from `link.request` when
  `state === LINK_LINKED`.
- `src/uc04/decisionFacts.js` — `documentDimension()` reads the stored value.
  **Its STATE does not change**: a passport number is identity, not destination
  entitlement, so there is still no branch returning `cleared`. What changes is
  that the dimension can say *which travel document the trip is on* instead of
  *nothing is on file*.

**Test.** `test/uc04TravelDocument.test.js` — a linked request persists both
fields; an unlinked one persists null for both; the dimension renders the
document reference when present and does not claim clearance either way.
Negative-control the last assertion against the pre-fix file.

**Cost.** One migration + ~40 lines. **Blocked on:** a production DB write, so
it needs the same go-ahead as any migration.

**Does NOT do.** It does not make the dimension `cleared`, it does not verify
the document, and it does not store a passport image. Storing the *number*
Remote already holds is not new personal data in this system's possession —
storing a scan would be, and is out of scope.

---

## W-2 — Collect what Remote's own intake form collects — **DONE 2026-09-01**

> **Landed as FOUR FREE-TEXT FIELDS, not six yes/no questions**, and the change
> is because the scope below was written before Remote's own Help Center article
> was read. Article `37802834593805` (retrieved 2026-08-18) lists what the
> employee must supply on the RWA form, verbatim: *"Activities to be performed"*,
> *"Institutions or organizations visiting"*, *"Special worksites (e.g.,
> laboratories, manufacturing sites, etc.)"*. That is ladder rung 1, and it is
> not overridden by this project's opinion about what a workation form should
> ask. The fourth field is `work_location`, which is on Remote's own request
> object — so the panel reads it back off a linked request when one exists (W-1)
> and asks for it when one does not.
>
> A fixed list of six would have been this project's invention printed beside
> Remote's own fields, and it would force a requester to pick the nearest wrong
> answer — which `intakeExtractor.js` already refuses by name for `jobDuties`.
>
> **NOTHING SCORES ANY OF IT, and that is enforced twice.** Structurally:
> `policyEngine.js`, `riskMatrix.js`, `approvalPolicy.js`, `requestParser.js` and
> `intakeExtractor.js` are read by test and must not mention the module.
> Behaviourally: the same request decides identically with an empty profile and
> with one reading *"negotiating and signing a distribution contract in a
> biosafety level 3 laboratory"*. Two reasons, and the second is the one that
> matters — a rule keyed on the word "laboratory" is one anybody can pass by
> rephrasing and an honest requester can fail by being specific; and a system
> that scored these fields would start rewarding the phrasing that scores well,
> destroying the only thing they are for.
>
> **On `factors`, so no migration.** `factors` is already a jsonb column and
> `factorValidationIssues()` reads named fields only, so an unknown key cannot
> make a request malformed.
>
> **Asked-and-blank is not never-asked.** All four blank normalises to `null`,
> which the panel renders as *"this surface does not ask the question"* — a
> different sentence from *"not stated on the request"*, because only one of them
> is about the traveller.
>
> `test/uc04ActivityProfile.test.js` (11 tests). `npm test`: 5,419 tests, 0 fail.
>
> **Still open from the addendum below: the Z = Y entity check.** It is a
> different kind of question — computable rather than asked — and is not in this
> change.

## W-2 — Collect what Remote's own intake form collects (original scope)

**The evidence.** Ladder rung 1. Remote's help article `37802834593805`
(updated 2026-08-18) publishes the RWA form's required fields verbatim:

> - Travel/work location
> - Dates of travel
> - Purpose of the trip
> - **Type of visa or travel document**
> - **Activities to be performed**
> - **Institutions or organizations visiting**
> - **Special worksites (e.g., laboratories, manufacturing sites, etc.)**

We collect the first four. The last three we do not collect at all. And
*"nature of the duties"* is independently required by HMRC PAYE82000 (STBV
report), by Posted Workers Directive 2014/67 art. 9(1)(a) (*"the nature of the
services justifying the posting"*), and is EY's "activity questionnaire" — four
independent sources converging on one field we render as a seven-option
dropdown.

**Why the dropdown is the wrong shape.** Both the immigration test and the tax
test are ACTIVITY tests. Canada legislates it (IRPR s.187: a business visitor
engages in business *"without directly entering the Canadian labour market"*);
the UK Immigration Rules enumerate permitted activities surgically — promotion
at a trade fair is permitted *"provided the Visitor is not directly selling"*.
`engineering` cannot answer that question. Fragomen states the underlying
problem: *"certain activities considered by employees as 'business activities'
are deemed as productive work by receiving country regulations"* — so the
traveller's own category label is exactly the thing that cannot be trusted.

**What changes.**
- `src/uc04/activityProfile.js` (new) — six booleans, each mapping to a
  published blocker, phrased as the regulator phrases them:
  1. hands-on or productive work (not meetings, negotiation or training)
  2. delivering services to a host-country client
  3. income from a host-country source
  4. managing or supervising host-country staff
  5. establishing or operating local business presence
  6. working from a host entity's office or a client site
  Exported as `ACTIVITY_QUESTIONS`, in the same shape and for the same reason as
  `VALID_VISA_TYPES` — so the form is checked AGAINST it rather than agreeing
  with it by hand (`policyEngine.js:60`'s own header records what that
  mismatch cost last time).
- Three new fields: `workLocation` (address at destination — PWD art. 9(1)(a)
  requires *"the address(es) of the workplace"*, and Remote has a
  `work_location` field), `institutionsVisited`, `specialWorksite`.
- `src/portal/assets/index.html` — the UC-04 card gains them. `jobDuties` stays
  (the PE matrix reads it) but is demoted from "the activity answer" to "the
  role category".
- `src/uc04/riskMatrix.js` — the activity profile feeds `pe_risk_dape` and a new
  `host_client_service` flag. **Additive only: no existing block changes, and no
  activity answer may CLEAR a rung the matrix already refuses.**

**Test.** `test/uc04ActivityProfile.test.js` — every question maps to a named
published source; the form's inputs equal `ACTIVITY_QUESTIONS` (read out of the
HTML, as `test/uc04Portal.test.js` already does for the enums); an
all-false profile changes no decision that was previously refused.

**Cost.** ~200 lines + form + tests. The largest of the five.

**Does NOT do.** It does not decide immigration status from the answers — it
routes. Six "no"s do not produce a clearance; they remove escalation reasons.
The Fragomen finding that training is genuinely ambiguous (direction and
audience decide it, and it varies by country) means training is deliberately
**not** one of the six: it is a refer-to-human, not a rule.

---

### W-2 addendum — the entity question — **DONE 2026-09-01**

> **Landed as a COMPUTED check, not an asked one.** The addendum below proposed
> asking the requester "does the company have an entity in the destination
> country?". It does not need asking: `GET /v1/companies/{id}/legal-entities`
> lists the customer's entities with their countries, and the destination is
> already on the request. Two country codes, no register, no judgement.
> `src/uc04/employerPresence.js`, read live on the sidebar route.
>
> **Three guarantees, each pinned by test.**
> - **It fails to UNKNOWN, never to "no".** A failed read rendering as "the
>   customer has no entity there" is the reassuring answer from a comparison
>   that never ran — finding F-27's exact shape one endpoint over. Five states,
>   five sentences, and the failure says *"NOT a finding that they have no
>   company at the destination"* in its own words.
> - **It decides nothing.** No flag, no level change, and no gate file may
>   import it. Every tax finding in UC-04 is a work order, never a refusal.
> - **It is not a claim about who employs the person.** These are the CLIENT's
>   entities; the panel heading says *"Where the customer has companies"*, and a
>   test refuses the vocabulary that produced K16.
>
> **It found a live trap while being built.** `normalizeCountryCode("NLD")`
> returns `"NLD"` — it upper-cases and trims but does not reject alpha-3. Remote
> returns `CompanyLegalEntity.country_code` in alpha-3. So the obvious
> implementation compares "NLD" against "NL", matches nothing, and reports "no
> entity there" forever. The comparison now shape-checks for alpha-2 and counts
> unplaceable rows as unreadable rather than absent.
>
> `test/uc04EmployerPresence.test.js` (8 tests). `npm test`: 5,427, 0 fail.

### W-2 addendum — the entity question (original scope, added 2026-09-01)

The art. 15(2)(b) research completed after this document was written adds one
question to W-2's intake, and it is the highest-value tax check available to
this use case: **does the company have a legal entity in the destination
country?**

Article 15(2) exempts the employment income only if all three limbs hold, and
(b) is *the employer is not a resident of the destination state*. Where the
destination IS the client's own country of incorporation, (b) fails on day one
and the treaty exemption is gone regardless of the day count — which is the
limb this system has never represented, and the one the caveat under the
183-day measurement already says it cannot answer.

It is a yes/no the requester can answer, it is ordinary in a workation request,
and unlike the rest of the treaty apparatus it needs no register: the comparison
is between two country codes this system already holds. Evidence and the three
jurisdictions it was checked against: `docs/UC04-RESEARCH-FINDINGS.md` §9–§12.

## W-3 — A lead-time gate — **DONE 2026-09-01**

> **Landed, and it is a MEASUREMENT rather than a gate.** The scope below says
> "<14 days → escalate". It ships as a soft flag that moves the risk level to
> `medium` and never changes the decision, for three reasons found while
> building it: UC-04's blocking set is deliberately immigration and data quality
> only (`UC04-RESEARCH-FINDINGS.md` §5); no surveyed mobility product refuses a
> trip on its own authority (§3); and `escalate` in UC-04 routes to the Tier-2
> legal queue that `UC-04.md` reserves for unconfirmed jurisdictions, which is
> the mis-routing §7 item 7 already records once. A short-notice trip is a
> reason to look, not a reason to refuse.
>
> It renders in "The counts this decision turns on" rather than as a fifth
> dimension, because `UC-04.md` §7 fixes the four dimensions and lead time is
> not a fifth independent judgement — it is a measured value against a stated
> line, which is what that section is.
>
> **Three things the implementation settled.**
> - **A floor is not a ceiling, and both renderers assumed a ceiling.** Every
>   other measurement here is one, so they print "67 of 90 days · 23 days left".
>   Applied to a minimum that inverts: "91 of 14 days · 77 days left" reads as
>   the worst row on the page when it is the safest. Rows now carry
>   `comparison: "floor"`; absent still means ceiling, so nothing else moved.
> - **The state word already existed.** `urgent` — *"checked, and the time left
>   to act on it is short"* — was written before this row and describes it
>   exactly. `breached` would have rendered "OVER THE LIMIT" in the tone
>   reserved for things an approval cannot override.
> - **`[PROPOSED]`, and the provenance heading had to change to say it.** The
>   only other row carrying a `basis` is the Schengen suppression, so the block
>   was headed *"The basis for excusing it"* — right for a waived limit, wrong
>   for one that was applied. The heading is now chosen by the row's state.
>
> `test/uc04LeadTime.test.js` (11 tests) pins all of it, including the n8n port
> agreeing on the number, the flag and the level across four start dates.
>
> **NOT YET DEPLOYED.** `workflows/nodes-uc04/workationGates.js` is ahead of the
> live graph `WORKFLOW_UC04_ID`, which it already was before this change.

## W-3 — A lead-time gate (original scope)

**The evidence.** Remote publishes its own notice requirement and gates on it:
*"Submit your request at least 3–8 weeks before your intended departure… Should
your travel plans fall sooner than 2 weeks from submission, please contact us
via live messaging."* Travel letters: *"at least two weeks before"* the embassy
appointment or trip start. Every published university travel policy found in
the research does the same, with lead time escalating faster than approver
seniority (40–60 days at the top tier).

We check `start_in_past` and nothing else. The reason it matters is not
politeness: **some filings cannot be made retroactively.** A PWD declaration is
due *"at the latest at the commencement of the service provision"* (Dir.
2014/67 art. 9). An A1 obtained after departure may be unobtainable.

**What changes.**
- `src/uc04/policyEngine.js` — a new rung immediately after `start_in_past`,
  reading `factors.now` against `factors.startDate`. Two bands:
  `insufficient_lead_time` (< 14 days → `escalate`, naming Remote's own live-
  messaging route) and `short_lead_time` (14–21 days → a soft flag, no
  refusal).
- `workflows/nodes-uc04/workationGates.js` — the same rung. The parity test
  will catch it if only one moves; edit both (§6).

**Test.** `test/uc04LeadTime.test.js` — boundary cases at 13/14/21/22 days;
the flag does not change the level; the escalation quotes Remote's published
figure rather than one we invented. `test/n8nParity.test.js` covers the port.

**Cost.** ~60 lines across two files. Cheapest of the five.

**Does NOT do.** It never BLOCKS. Short notice is a routing fact, not a
compliance failure, and a hard refusal here would decline trips Remote itself
handles by live chat.

---

## W-4 — The approver adds the activity statement

**The evidence.** Remote's admin-side article `20094378700557`:
*"click on **Approve** then fill out the necessary details… Please use the
**additional information section to provide specific details about the
activities the employee is expected to perform** during the travel."*

So Remote captures the decisive field TWICE — once as the employee's claim, once
as the employer's authoritative statement. This is not ceremony: the employee
does not know what "productive work" means in the destination's law, and the
manager does know what the employee will actually do. **An approval modelled as
a binary loses the field the decision turns on.**

Corroborated by the API: a travel-letter approve REQUIRES all three
`responsible_for_*` cost allocations, null until then. Remote's approve step is
a data-entry step, not a rubber stamp.

**What changes.**
- `src/remoteui/` — the employer approval gains a required
  `employerActivityStatement` free-text field on approve (not on decline, which
  already requires a `reason`).
- `src/uc04/authorizationStore.js` + migration — one nullable
  `employer_activity_statement text`.
- Stage 3 (`submitMobilityReview`) renders it as the employer's own words,
  beside the employee's claimed activity profile, and marks a DIVERGENCE between
  the two as a finding for the specialist.

**Test.** `test/uc04EmployerStatement.test.js` — approve without it refuses by
its own code (`employer_activity_statement_required`, not a generic validation
error); decline is unaffected; the statement reaches the panel; a divergence
between claim and statement surfaces.

**Cost.** ~80 lines + migration.

**Does NOT do.** It does not parse or classify the statement. No LLM reads it to
produce a gate input — prime directive 1. It is shown to a human, verbatim,
next to the claim it may contradict.

---

## W-5 — The decision surface itself

**This is the one that makes the other four demonstrable**, and it is the one
the project owner raised directly: the panel currently renders design rationale
written for a reviewer of the system, not a record written for the specialist
operating it. The worked example was `documentDimension()`'s 470-character,
84-word paragraph — one of **20** `finding:` blocks in the same register in
`src/uc04/decisionFacts.js`.

**The reframe that decides the design.** Two English cases settle what this
screen is for. In *Dusek v StormHarbour* [2015] EWHC 37 the employer was liable
having *"did nothing to investigate"*; in *Cassley v GMP Securities* [2016] EWCA
Civ 711 the duty was breached but the claim failed on causation, and the court
held the employer *"ought to have consulted the Foreign and Commonwealth Office
website"*. **In both, the breach was the ABSENCE OF ENQUIRY, not a wrong
decision.** The panel is therefore an evidential artifact as well as an
operational one — and the evidence is *"this was checked, on this date, and here
is what it said"*, never a paragraph arguing why an absence is honest.

### W-5a. Provenance becomes a MARK, not a paragraph

Every fact on the panel carries one of three marks, rendered as a chip:

| mark | meaning |
|---|---|
| **Remote record** | read from the Remote API this run, with the read time |
| **Stated** | the requester's claim, unverified by anything |
| **Computed** | derived here, from named inputs |

This is the single highest-value change on the panel and it is almost free: the
distinction already exists in the data (`documentEvidence()`, the
`FROM_TEXT`/`FROM_ANSWER`/`FROM_RECORD`/`NOT_SOURCED` markers in
`intakeExtractor.js`), it is simply being explained in prose instead of shown.
**A specialist reads a chip in 200ms and a paragraph in 20 seconds, and the
chip is the more trustworthy of the two** because it cannot be written to sound
better than it is.

### W-5b. Findings get rewritten to the operational register — **DONE 2026-09-01**

> **Landed.** 20 findings rewritten across `treatyDimension()`,
> `roleDimension()`, `presenceDimension()`, `documentEvidence()`,
> `documentDimension()` and `describeRequester()`; 45 insertions against 59
> deletions in `src/uc04/decisionFacts.js`, so the register got shorter as well
> as plainer. Guarded by `test/uc04FindingRegister.test.js` (10 tests, driving
> the real describer over six routes and all five document states). 13 existing
> assertions were re-pointed at the new wording — each one kept the property it
> pinned; none was deleted. `npm test`: **5,385 tests, 0 fail**.
>
> **Three things the implementation settled that the scope above did not.**
> - **The sentence cap is the rule and the character cap is the backstop, and
>   NEITHER alone is enough.** The string the owner objected to is exactly three
>   sentences. It failed on length and on vocabulary, not on structure — so a
>   register that only counted sentences would have passed it.
> - **`whatItWouldTake` is deliberately NOT covered by the test.** The scope
>   above asks for "every non-cleared dimension has a non-empty
>   `whatItWouldTake`". The ZAF panel stopped rendering that field on
>   2026-08-19 on purpose (it is engineering backlog, not something an approver
>   reads — see `renderDimension`'s header in `zaf-app/assets/main.js`), so
>   pinning it in a *readability* test would guard the wrong surface. It stays
>   long, server-side, on the audit record.
> - **"Never inferred from the destination" is now pinned STRUCTURALLY.** It
>   used to be asserted by matching a 96-character closing clause. The clause is
>   gone; the guarantee is stronger stated as *no value of `identityDocuments`
>   and no destination reaches a `cleared` state on this dimension*, which is
>   what `UC-04.md` §9 forbids by name.

Rule for all 20: **state the fact, state what it blocks, state what would clear
it.** The rationale stays in the comment above the string, where in every case
it already appears in full. Worked example — `documentDimension()`'s
`unavailable` branch becomes, in its entirety:

> No document permitting work in the Netherlands is on file. The trip is stated
> as Schengen short stay. **Would clear it:** an immigration authorization for
> the destination. *(A passport or identity document establishes right to work
> in the country of employment, not at the destination.)*

Same information, ~55 words down from 84, and the one sentence of reasoning that
a specialist actually needs is the parenthetical — because that one IS
operationally load-bearing (it stops them accepting the wrong document).

**Test.** `test/uc04FindingRegister.test.js` — no `finding` string exceeds 300
characters; none contains the design-rationale vocabulary (`must never`, `which
is why`, `rather than assumed`, `by construction`); every non-cleared dimension
has a non-empty `whatItWouldTake`. Negative-controlled against the current file,
where it must fail.

### W-5c. The record of enquiry

A new panel block, above the controls, listing every check that RAN with its
timestamp and result — including checks that found nothing. This is the
*Cassley* artifact. It is also the honest home for the sentences currently
embedded in findings: *"Remote's employment record was read and holds no
identity document"* is a perfect enquiry-log line and a poor finding.

### W-5d. Conditional clearance

Stage 3 gains conditions. *"Cleared subject to: A1 obtained before departure;
PWD declaration filed"* is a different artifact from *"cleared"*, and the
research names the absence of it as a governance gap. Implementation: a
checklist on the mobility-review control, persisted in the audit row's
`details.conditions[]`, rendered on the panel afterwards. **No condition is
auto-generated from a gate** — the specialist selects them, because a
system-generated condition is a system-made decision wearing a human's name.

**Cost.** W-5b is the bulk (20 strings, mechanical). W-5a/c/d are ~250 lines
across `decisionFacts.js`, `zaf-app/assets/main.js` and `panels.js`.

**Does NOT do.** No new gate, no new refusal, no policy re-derivation in the
browser (`test/zafApp.test.js` already forbids it and must keep passing).

---

## Sequencing

W-3 → W-1 → W-5a/b → W-2 → W-4 → W-5c/d.

W-3 first because it is self-contained and proves the parity discipline still
holds. W-1 before the panel work because it changes what dimension 4 can say.
W-5a/b before W-2 so the new fields land on a panel that already reads well.
W-5c/d last because conditional clearance is most useful once the activity
statement exists to condition on.

## Explicitly out of scope

Posted Worker declarations · shadow payroll · export control (EAR §740.9 /
Country Group E:1) · GDPR Chapter V transfer mechanisms · insurance territorial
limits · medical evacuation · travel advisories as a gate. Every one is a real
obligation named in the research, and every one belongs to a mobility
compliance platform rather than an EOR CX triage layer. Note what the research
found about all of them: **no vendor publishes refusal criteria for any of
them — they route to a human.** UC-04 already routes to a human.

## One thing to verify, because it may simplify the hardest part

OECD Model art. 15(2) has three cumulative conditions and the research's
sharpest finding is that everyone measures the first (183 days) and nobody
captures the second (*remuneration paid by an employer not resident in the host
state*) or third (*not borne by a host PE*).

**In an EOR, condition (b) may be satisfied by construction**: Remote's local
entity is the legal employer and is resident in the country of employment, not
the destination. If that holds — and it needs checking against a real
multi-entity case, not assumed — then one of the two conditions no commercial
tool can answer falls out of the architecture for free, and UC-04 can state it
rather than flag it. That is a research task, not a build task, and it is worth
doing before W-2.
