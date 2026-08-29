# UC-03 — Canonical Acceptance Contract

> **Travel Support Letter / Workation Inquiry Router · 🟢 Low tier · Remote-native request, reaching us through the portal and Zendesk**
>
> Reconciled 2026-08-20 from `docs/use-cases/UC-03.md` (§1–§23),
> `src/uc03/{policyEngine,workflow,classifier,letterScope,letter,letterOffer,letterDelivery,signoffPolicy,statedTrip,uc04Intake,caseAttachments}.js`,
> `src/portal/uc03Continuation.js`, `workflows/nodes-uc03/*.js`,
> `docs/ESCALATION-DESTINATIONS.md` §2.1, `test/uc03*.test.js`,
> `test/portalUc03*.test.js`.
>
> **Intended business truth.** §17 records where the implementation and the
> documented intent differ. Nothing was changed to produce this.

---

> ## Decisions taken 2026-08-20 — read this before anything below it
>
> This contract was reconciled once (first pass) and then **decided**. Every
> `SPEC_DRIFT` finding in §17 that was open now carries a **DISPOSITION** block
> recording what was chosen, by whom, and on what evidence. Six new findings were
> opened by the decision session itself (`DRIFT-078`…`DRIFT-083`).
>
> **Why the dispositions are written into the finding rather than replacing it.**
> A resolved finding that is deleted comes back — a later reader re-derives the
> same disagreement, re-argues it, and often decides it the other way. `CLAUDE.md`
> §6 records this repository paying for it in both directions on the same day: a
> closed issue open in one status file and closed in another. So nothing here is
> removed. A decided finding says **DECIDED**, says what was decided, and says
> whether the code has caught up yet.
>
> **The three states a finding can be in, and they are not the same claim:**
>
> | State | Means |
> |---|---|
> | `DECIDED · BUILT` | Chosen, and the code matches. Nothing outstanding |
> | `DECIDED · NOT YET BUILT` | Chosen, and the code still does the old thing. **The drift is still real** — the decision does not close it |
> | `OPEN` | Nobody has chosen |
>
> Every UC-03 finding below is `DECIDED · NOT YET BUILT` unless it says otherwise.
> That is deliberate: this pass changed **no** code, so a contract claiming the
> decided behaviour as current would be the exact overstatement `CLAUDE.md` §1
> says discounts everything else.
>
> ### The three gate-behaviour changes, named separately
>
> Three decisions change what the system **decides**, not merely what it says.
> They are called out here because the standing rule is that a behaviour change
> needs an explicit human go-ahead, and it was given on 2026-08-20.
>
> | | Change | Was |
> |---|---|---|
> | **G-A** | UC-04 accepts an employee session filing for themselves, or an admin whose company matches | Admin-only — an employee could never file |
> | **G-B** | The 30-day duration cap is removed as a gate; duration is carried into UC-04 | `duration_over_cap` escalated at 31 days on no authority |
> | **G-C** | Two named escalation reasons added: `tax_residency_question`, `permanent_relocation_question` | Both fell to the two built intents and reached a travel team |
>
> Each has a full write-up under its finding: **G-A** → DRIFT-078, **G-B** →
> DRIFT-013, **G-C** → DRIFT-011.
>
> ### What was decided, in one table
>
> | Finding | Decision |
> |---|---|
> | DRIFT-011 | **Narrow, do not route.** Two intents stay; two named escalations added (G-C) |
> | DRIFT-012 | **Build** the personal no-objection letter |
> | DRIFT-013 | **Remove the cap** (G-B); duration carried into UC-04 |
> | DRIFT-014 | **Remove "Global Mobility."** Prose built *from* the routing row |
> | DRIFT-015 | **Keep current.** No change |
> | DRIFT-016 | **Reconcile, and move the letter to PDF**; one real production run recorded |
> | DRIFT-078 | **Option (a)** — two accepted session shapes (G-A) |
> | DRIFT-079 | **Reconcile** the stale signature claims |
> | DRIFT-080 | **Build** — the decline reason reaches the requester |
> | DRIFT-081 | **Build** `src/uc03/decisionSources.js` |
> | DRIFT-082 | **Build** — a quick-fill for every outcome |
> | DRIFT-083 | **Reword** — say "outside this system" plainly |
>
> And one capability that is not a drift finding because nothing ever specified
> it: **the bespoke-letter draft-assist** (facts pack + labelled LLM suggestion +
> the sources module), specified in §9.1 below.
>
> ### What is still OPEN against UC-03 — five, and none is a UC-03 decision
>
> Deciding these from inside UC-03 would set policy for use cases that move money
> and change contracts. They live in **§17c**, with a stated recommendation each so
> the next session starts from a position rather than from scratch.
>
> | Finding | Recommendation |
> |---|---|
> | **DRIFT-084** *(opened here)* | Remote publishes a travel-letter API and five webhook events; we subscribe to none. **Record now, build nothing, do not decide under deadline** — see §17b |
> | DRIFT-043 | **Mis-framed. Downgrade** `HUMAN_DECISION_REQUIRED` → `RECONCILE`: the two letters are different documents and the boundary is a missing sentence, not a decision |
> | DRIFT-040 | **No UC-03 action.** UC-03 is one of the two use cases that *is* measured |
> | DRIFT-041 | **State the non-goal** (no approval expires, and why). Do not build a clock |
> | DRIFT-042 | **Extend the existing structural test** to UC-03 and UC-04. The cheapest real fix in the set |

---

## 1. Business purpose

"I'm travelling", "can I work from Spain for three weeks", "I need a letter for
my visa appointment" all look identical in their first sentence and belong to at
least three different processes: simple documentation, a formal work
authorisation, or a tax/immigration exposure question.

UC-03 tells them apart. It answers the simple documentation case itself, and
hands the compliance-heavy case to the process that owns it **with the reasoning
attached**, so the receiving human does not start from raw ticket text. It is a
**router**. It deliberately does not answer the compliance question underneath
the request.

## 2. Primary operator persona

**Role:** the **employee** is the requester. Two operators: a **Travel & Mobility
Support specialist** (signs the formal letter) and, on escalations, the same team.
**Experience/knowledge:** knows what a travel support letter says and does not
say, and what a consulate expects to see.
**Typical working context:** a Zendesk ticket with the sidebar, or the portal's
own result view for the requester.
**They understand:** destinations, trip dates, "this needs a letter" vs. "this
needs permission to work there", signing a document.
**They DO NOT know:** `route_to_uc04`, the country registry, letter-scope marker
codes, or the difference between an alpha-2 and an alpha-3 country code.

## 3. Job to be done

*Employee:* "Tell me what I need for this trip, and give me the document if a
document is what I need."
*Specialist:* "Sign the letters that are genuinely standard, and write the ones
that are not — without re-reading the whole ticket to find out which."

## 4. Starting preconditions

- The employment record exists and is `active`.
- The requester's identity is authenticated and is the traveller.
- Remote's country registry (`GET /v1/countries`) is readable — 224 rows, with
  both `alpha_2_code` and the alpha-3 `code`. **An empty or unreadable registry
  confirms nothing and must escalate.**
- The request text is present and non-blank.

## 5. Main successful journey

1. An employee describes their trip in their own words.
2. The system reads the request: is this about documentation, or about permission
   to work somewhere?
3. It confirms who is asking and that they are still employed.
4. It confirms it understood the request confidently enough to act.
5. It confirms the destination is not sanctioned, and is a jurisdiction Remote's
   own registry knows.
6. **Documentation case, standard ask.** The employee gets a plain answer
   immediately, and the letter their ask qualifies for is **written and issued
   there and then, with nobody in the path** — the routine outcome this path
   exists for. Two templates qualify: the business-travel letter and the personal
   **no-objection** letter *(the second is DECIDED, NOT YET BUILT — DRIFT-012)*.
   The document is a **PDF**, rendered once, hashed once, and stored as the
   artifact *(DECIDED, NOT YET BUILT — DRIFT-016)*.
7. The traveller collects it under their own authenticated session. **The bytes
   delivered are the bytes signed** — or, on the zero-touch path, the bytes
   issued. Identity is checked before the artifact's existence, because "no
   letter on that case" is itself a fact about somebody else's request.
8. **Documentation case, non-standard ask.** Where the ask needs something no
   template can express — a named addressee, a passport number, a required
   sentence — **nothing is written**, and a named Travel & Mobility Support
   specialist composes the letter. This is the **only** signature UC-03 has.
   The specialist is not left with a blank page: see §9.1.
9. **Work-authorisation case:** the employee is told plainly that this needs a
   work-authorisation review, what has been carried forward, and what is still
   needed — and is given a way to continue into that request **as themselves**,
   without retyping what they already said and without the signed-in person
   changing under them *(G-A, DECIDED, NOT YET BUILT — DRIFT-078)*.
10. **Neither case:** where the request is really about tax residency or a
    permanent move, it escalates under **its own name** to the team that owns it
    — not to the travel team by default *(G-C, DECIDED, NOT YET BUILT —
    DRIFT-011)*.

> **Step 6 is the one that changed, and the contract was wrong about it for a
> week.** Until `docs/use-cases/UC-03.md` §23 ("The signature moved to where the
> risk is") the routine letter waited for a signature. It does not:
> `src/uc03/policyEngine.js` sets `letterAutoIssue = true` and the standard ask
> resolves `auto_resolve / standard_letter_issued`. The signature survives only on
> the ask no template can express. This contract described the old shape until
> 2026-08-20 — recorded as DRIFT-079 rather than quietly corrected, because a
> contract that silently re-writes itself teaches nobody what it got wrong.

## 6. Valid variations

| Input / condition | Expected behaviour | Expected business outcome |
|---|---|---|
| Business-travel documentation ask, registry-listed destination, confident read, standard scope | `auto_resolve` / `standard_letter_issued` | The letter is **written and issued immediately**, as a PDF, with the mandatory disclaimer and no signature. This is the routine outcome |
| Personal **no-objection** ask, same conditions | `auto_resolve` / `standard_letter_issued`, second template | Same zero-touch path, different document. **DECIDED, NOT YET BUILT — DRIFT-012.** Today it is classified as business travel and produces the wrong document, or falls to scope-exceeded |
| Traveller collects the issued letter | PDF returned under the traveller's own session | The delivered document's sha256 equals the stored artifact's. **The PDF is rendered once, before hashing** — render-on-demand breaks this silently and every test still passes (DRIFT-016) |
| Ask needs a qualified letter (see the row below) | `human_review` / `formal_letter_requested` | Waits for the one signature UC-03 has. Nothing is issued until it lands |
| Specialist signs off | Letter issued | The bytes delivered are the bytes signed |
| Specialist declines | No document | **The requester is told why, on the surface they submitted from.** A reason is mandatory (`signoffPolicy.js` refuses a reason-less decline, 400) and is now classified as *checkable* or *judgement* — see §15.1. **DECIDED, NOT YET BUILT — DRIFT-080:** today the reason reaches the Zendesk ticket only, and most traffic never touches Zendesk |
| Ask needs something the template cannot express (an addressee, a passport number, a required sentence) | `escalate` / `letter_scope_exceeded`, **no document written** | A specialist *writes* a letter rather than signing a bad one. Refusing to issue a bad document still leaves the bad document written |
| "Can I work from Spain for three weeks?" | `escalate` (router outcome) / `work_authorization_requested` | Handed toward a work-authorisation review, with what was extracted attached and what is missing stated |
| Registry-listed, non-EOR destination (e.g. Montenegro) | `auto_resolve` | **Must pass.** The gate tests registry membership, never `eor_onboarding` — that flag answers "can Remote *employ* here" and would block Martinique for a French employee |
| Sanctioned/restricted destination | `escalate` / `sanctioned_region` | Refused by the sanctions override, checked **before and independently of** registry membership |
| Destination not in Remote's registry | `escalate` / `destination_jurisdiction_excluded` | Not answered here |
| Destination not resolvable from the text | `escalate` / `destination_unknown` | A specialist looks the country up. **This is a different instruction to a human than `sanctioned_region`** |
| Trip dates unreadable | `escalate` / `duration_unknown` | |
| Trip longer than 30 days | **No UC-03 outcome.** Duration is carried into UC-04, which evaluates it against Schengen art. 6(1) per day of stay (`schengenPeakDays()`, D-07) | **G-B, DECIDED, NOT YET BUILT — DRIFT-013.** Today `escalate / duration_over_cap` fires at 31 days on an invented number, in the one use case whose own §1 forbids it from computing thresholds |
| Request is really about tax residency | `escalate` / `tax_residency_question`, named to **Tax Operations** | **G-C, DECIDED, NOT YET BUILT — DRIFT-011.** Today it falls to whichever of two intents the classifier picks and reaches the travel team, and UC-08's mandatory tax disclaimer is never applied |
| Request is really about a permanent move | `escalate` / `permanent_relocation_question`, named to **Mobility Legal (Tier-3)** | Same. Named escalation, **not** a route — see §12 |
| Confidence below `0.6`, or absent | `human_review` / `low_confidence` \| `confidence_unknown` | A re-reading of the request, **not** a sign-off. The sign-off route refuses it by its own name (`classification_unconfirmed`) |
| Employment not active | `escalate` / `employee_not_active` | |

## 7. Edge cases and failure conditions

| Case | Expected behaviour |
|---|---|
| **Duplicate webhook** | One claim, one case, one letter. Two simultaneous accepts of the letter offer produce **one** letter |
| **Country registry read succeeds but yields an unusable list** | Rows are placed on the alpha-2 axis with an asserted `/^[A-Z]{2}$/` shape check — never an `??` fallback chain that can smuggle in the alpha-3 code. An unplaceable row is dropped, not guessed. The audit row records the set **as the gate saw it**, so an empty list is visible instead of looking like a policy outcome |
| **Registry unreadable entirely** | Escalate. Fails closed |
| **A sanctioned country's name appears in the text but its code is unresolvable** | Historically produced `escalate / destination_unknown` — right outcome, **false reason**, and the reason is the only thing that selects between two human behaviours. The dictionary is now derived *from* the sanctions set, so a code with no name **throws at module load** |
| **Model returns an unusable letter-scope finding list** | That is itself a finding. `standard` is the **absence** of findings; there is no input meaning "this is standard", so a model can route a request into the human path and never out of it |
| **Blank or absent request text** | Never assessed standard |
| **Letterhead unreadable** | Drafts nothing rather than a blank letterhead |
| **Accepting the offer twice** | One letter |
| **Fetching the issued letter** | Must be reachable by the traveller's own authenticated session. The letter existed and nobody could fetch it — a real, fixed defect (UC-03.md §22) |
| **Remote read 403/5xx vs. 404** | Distinguished: `upstream_unavailable` vs. an answer about the record |
| **The requester continues into a work-authorisation request** | The traveller, the destination, the home country and any stated dates carry forward; the persona moves to the company admin because that request is admin-filed; the link to this case survives; a mismatch between the carried subject and the submitted one is refused `continuation_subject_mismatch` |

## 8. Invariants — must never happen

1. **UC-03 never determines tax residency, never adjudicates immigration
   legality, and never approves a work authorisation.** It routes.
2. **No letter is ever auto-issued.** Every letter stops at one signature.
3. **A non-standard request is never drafted** — refusing to *issue* a bad
   document still leaves the bad document written.
4. **A model can never talk a request out of the human path** — `standard` is the
   absence of findings, structurally.
5. **The sanctions override is checked before, and independently of, registry
   membership**, so the two refusals are never confused.
6. **The destination gate is registry membership only** — never `eor_onboarding`.
7. **The mandatory disclaimer appears on every issued letter and every
   informational answer.**
8. **The delivered document is byte-identical to the signed document.**
9. **A low-confidence case has no letter offer on either guard.**
10. **UC-03 never creates a UC-04 record**, and never creates the object of a
    human approval with no human in it.
11. **An unreadable registry never reads as an empty policy outcome.**

## 9. AI responsibilities

**The LLM may:** classify the request as documentation vs. work-authorisation;
extract the destination, the stated trip dates and the reason; supply a **list of
problems** with the requested letter's scope; draft the plain-language letter body
from already-fetched employment fields; state its confidence.

**The LLM must never be the source of truth for:** tax residency, Schengen or
183-day arithmetic, immigration legality, whether a route should be approved,
whether a letter is standard (it can only ever *add* a finding), or the country
registry.

### 9.1 Draft-assist for the bespoke letter — DECIDED, NOT YET BUILT

**Not a `SPEC_DRIFT` finding**, because nothing ever specified it. It is a new
capability agreed on 2026-08-20, and it exists because of the shape of §5 step 8:
where no template can express the ask, this system writes nothing and a specialist
composes the letter from a blank page, having been handed a decision slug.

Prime directive #1 permits it in as many words — *"an LLM may classify, extract
and **draft**"* — and the precedent is `draftSummary()` (UC-06) and
`draftNarrative()` (UC-08), both LLM-authored prose carrying the
narrative-faithfulness judge as informational and never a gate.

**Three pieces, one unit of work:**

1. **The facts pack.** `letterScope.js`'s finding list (the specific things the
   ask needs that no template holds), the employment record, the request text, and
   the standard letter as a baseline. All of it is already in scope at that point.
2. **The suggestion.** LLM-drafted, judged, labelled as a suggestion.
3. **`src/uc03/decisionSources.js`.** UC-04, UC-05, UC-07 and UC-08 each have one;
   UC-03 does not, so its specialist gets our reasoning and no source. The corpus
   that feeds it already covers all four demo countries — D-07 (Schengen Borders
   Code), D-09 (visa annexes 2018/1806), D-10/D-11 (the Portuguese D8), D-14/D-15
   (US ESTA and B-1), D-16 (Canada IRPR 186). **DRIFT-081.**

**The constraint that makes this safe, and it is structural rather than a check.**
§6's own rule is *"refusing to issue a bad document still leaves the bad document
written."* A suggestion drafted into the case **is** that bad document. So:

- It is stored under a **different document type**. `letterDelivery.js` looks up
  `travel_support_letter` and only that, so the traveller's collection route
  cannot return the suggestion — not because it refuses, but because it never
  names it. Same discipline as UC-08's store having one write method and zero
  mutations.
- **No sha256 is computed over it.** Only the issued artifact is hashed, so
  *"the bytes delivered are the bytes signed"* is untouched.
- The specialist's signature applies to what **they** produce, never to what was
  suggested.
- Pinned by a structural test: assert the delivery lookup names only the issued
  type, and that no traveller-session route returns the suggestion.

**Why it is stored at all rather than rendered and forgotten.** Because §15.1
makes it measurable. A suggestion specialists rewrite from scratch every time is
worthless and should be removed; one they sign near-verbatim is evidence the
template should absorb the pattern, and the bespoke case becomes a standard one.
That is the same iterate/stop signal turned on ourselves.

## 10. Deterministic responsibilities

Identity · employment status · confidence threshold (`0.6`, and the reason it is
not UC-01's `0.85` is that UC-03's fallback scores 0.6 for "read the intent, not
the whole itinerary") · the sanctions override · registry membership on the
alpha-2 axis · duration arithmetic (**carried, not capped** — G-B) · the
letter-scope marker scan (unioned
with the model's list) · the routing table from classified type to target · the
disclaimer · the signature gate · the delivered-bytes hash.

The gates exist twice; `test/n8nUc03Parity.test.js` compares against the real
functions, and `test/uc03LetterScope.test.js` compares the **two copies of the
marker table directly**, code for code and pattern for pattern.

**On the alpha axis, settled 2026-08-20 and worth stating because it keeps being
re-opened.** Remote does not use one form. Every country-bearing object carries
both — `country: {code: "NLD", name: "Netherlands", alpha_2_code: "NL"}` — the
field literally named `code` is alpha-**3**, query parameters take alpha-**3**
(`?country_code=NLD`; alpha-2 returns `422`), and the travel-letter object carries
neither, referencing a whole `Country`.

**Alpha-2 stays the internal axis, because the gates read statutes more than they
read Remote.** D-07, D-09 and the sanctions registers are EU and UN instruments
and are alpha-2 native. Moving the axis to alpha-3 would convert ~299 country
literals, `SCHENGEN`, `DNV_COUNTRIES` and the sanctions set across 19 files — and
then convert *back* on every statutory comparison, putting the conversion on the
side where being wrong is a compliance error rather than a `422`.

The conversion therefore lives at **Remote's boundary**, built from Remote's own
registry response (`restClient.js` `#countryIndex()`) rather than from a 249-entry
table this repo invented, with a row missing either code dropped rather than
guessed. **Agreed change: make that boundary explicit and named**, so it stops
reading as incidental. Nothing about the axis moves.

## 11. Human approval / escalation

| | |
|---|---|
| **When** | Exactly one outcome carries a signature: `human_review` / `formal_letter_requested` |
| **Who** | `uc03:travel_support_specialist`, a named entitled role. Team: **Travel & Mobility Support** (`queue_travel_support`, group exists) |
| **Evidence needed** | Who the letter is about, the trip it describes, the rows the letter will state, and that nothing outside the template was asked for — **plus** the facts pack, the labelled draft suggestion and the statutory sources behind each finding (§9.1) |
| **After sign-off** | The letter is issued as a PDF and the traveller can collect it |
| **After decline** | No document. A reason is **mandatory** and is classified *checkable* or *judgement* (§15.1). **The requester is told, on the surface they submitted from** — DRIFT-080 |
| **Deliberately no control at all** | `auto_resolve`, `work_authorization_requested`, `letter_scope_exceeded`, `sanctioned_region` and the low-confidence outcomes. An approve button on `work_authorization_requested` would be a 🟢 router minting a 🟡 work authorisation by click |
| **Expiry** | **None — and that is a position, not an oversight.** See §17c, DRIFT-041: an expiry that auto-approves manufactures the consent this gate exists to obtain, and one that auto-refuses punishes the requester for the specialist's queue depth. Both turn a visible delay into an invisible outcome |
| **If nobody responds** | The drafted letter waits, and is visible in `src/approvalqueue/` for as long as it does. What is genuinely owed is a **reminder and an age-ranked queue** — which changes who looks and when, without changing any verdict. Unbuilt |

**Why one signature and not zero, decided 2026-08-20.** The question was put
directly — could the last signature be automated too? The answer on the evidence
is that it *could*, and should not yet:

- **Legally it carries little.** A travel support letter is a statement of fact by
  the employer about facts the employer already holds. It is not an undertaking,
  not a guarantee, not a visa, and it binds Remote to nothing it has not already
  recorded. A signature adds no weight the letterhead and the audit hash do not
  already carry. The exposure is **the facts being wrong**, and the facts come
  from the employment record either way.
- **Financially there is no direct exposure to Remote.** The realistic bad outcome
  is a consulate rejecting the letter and an employee losing a trip — severe for
  that person, reputational for Remote, not a liability Remote pays.
- **The reason to keep it is competence, not law.** The one thing the gates
  structurally cannot see is whether the drafted document suits *the authority
  that will read it*, and `docs/knowledge/` holds no source on what any consulate
  accepts. That is knowledge a specialist has and this system does not.

**So: keep one gate, shrink what reaches it, and remove it later on measured
evidence rather than on instinct.** DRIFT-012's second template and DRIFT-016's
PDF both move cases out of the human path. If the remaining volume trends toward
zero, §15.1's counts are the argument for removing the gate — and a removal argued
from a count is a far better artifact than a removal argued from a hunch. Removing
it today would leave UC-03 with **no** human gate at all, which is harder to
defend than a rare one.

## 12. CROSS_UC_ROUTING

> **This is the routing section the whole reconciliation was asked for. Read
> DRIFT-011 and DRIFT-012 with it — the documented routing set and the built one
> are not the same set.**

**May receive from**
- Nothing. UC-03 is an entry point (Zendesk ticket, or the portal's travel form).

**May route to**
- **UC-04 — Work Authorization.** The only cross-UC route that exists, and — as
  of the 2026-08-20 decision — **the only one that ever will.**

**DECIDED 2026-08-20: narrow the routing set, do not grow it (DRIFT-011).** §5 and
§12 of `docs/use-cases/UC-03.md` specify four outbound routes; three of them
(UC-06, UC-07, UC-08) were never built. Both options were live — build them to
UC-04's standard, or narrow the spec — and narrowing was chosen for a reason worth
recording:

> **A shallow hand-off is worse than an honest escalation.** UC-04's route is
> built as a hand-off *contract*: `uc04Intake.js` carries named fields with an
> `authority` column separating what came off the record from what came off a
> reading, states what is **missing**, and refuses to manufacture the 🟡 record.
> Copying that three more times demonstrates the same judgement three more times
> while tripling the surface that can drift. Building three thin ones would
> demonstrate the opposite of the judgement the 🟢/🟡/🔴 split exists to show.

**What closes the actual harm instead (G-C).** DRIFT-011's risk was never the
missing route as such — it was that a tax question reaches a team with no mandate
**and UC-08's mandatory tax disclaimer is never applied**. So two named escalation
reasons are added, `tax_residency_question` → **Tax Operations** and
`permanent_relocation_question` → **Mobility Legal (Tier-3)**. A named escalation
tells the receiving human what they are holding; a route would create a record
nobody asked for. `docs/use-cases/UC-03.md` §5 and §12 narrow to the two intents
that exist.

**Routing conditions — UC-03 → UC-04**
The request is classified `work_authorization` (asking to *work* from another
country, not merely to travel there or to obtain documentation), **and** identity,
employment status and confidence have already passed. Sanctions, registry
membership and duration are evaluated first: a sanctioned or unlisted destination
escalates and is never routed onward.

**Context that MUST transfer**

| | Carried today | Notes |
|---|---|---|
| Customer/user identity | ✅ | The traveller's employment id, carried and **verified on submission** — a mismatch is refused `continuation_subject_mismatch` |
| Employment/entity identifier | ✅ | |
| Zendesk ticket / reference | ✅ | The UC-03 case reference is carried and the continuation is linked to it |
| Trace / correlation id | ✅ | Via the case reference; both decisions resolve under one reference |
| Evidence already gathered | ⚠️ **Partial** | Home country and destination carry. Stated trip dates carry **when the requester stated them** — the canonical UC-03 workation scenario states none, so they usually do not |
| Decision / risk information | ✅ | The UC-03 decision and its reason travel with the hand-off |
| Approvals already obtained | n/a | UC-03 obtains none before routing |
| Relevant conversation/context | ✅ | The original request text is retained on the case |
| **Other required state** | ❌ **Four of UC-04's seven required inputs have no source in UC-03 at all** — nationality, visa type, job duties, contract-signing authority. `src/uc03/uc04Intake.js` states this per run rather than leaving the reader to discover it |

**The transfer is deliberately a HAND-OFF, not a DISPATCH, and all three reasons
are load-bearing:**

1. **There is nothing to dispatch into.** `POST /v1/work-authorization-requests`
   does not exist. A `WorkAuthorizationRequest` is *"submitted by an employee"*;
   the contract is create-by-employee, decide-by-API.
2. **It would be a tier escalation performed by automation.** UC-03 is 🟢; UC-04
   is 🟡. A 🟢 workflow that manufactures a 🟡 record has created the *object of a
   human approval with no human anywhere in it*, and UC-04's `ready_for_approval`
   is a one-click approve — so the manufactured record would arrive already
   pointed at a real decision.
3. **The data does not exist.** A dispatched record would land
   `blocked / factors_invalid` immediately, producing a refusal that *describes
   our own incomplete forwarding* while reading as a finding about the employee's
   trip.

**Must NOT happen during handoff**
- ❌ The customer must not repeat what they already said. *Currently satisfied:*
  the continuation pre-fills the carried fields, and two worked completions fill
  the remaining ones so a requester can reach both a success and a refusal.
- ❌ Duplicate work must not be created. *Satisfied:* no UC-04 record is created
  by UC-03.
- ❌ Audit continuity must not be lost. *Satisfied:* both decisions resolve under
  one case reference.
- ❌ Approval state must not be lost. *n/a — none exists at hand-off.*
- ❌ Ownership must not become ambiguous. ⚠️ **At risk — DECIDED, NOT YET BUILT
  (DRIFT-014).** UC-03's own prose tells the reader *"Global Mobility owns it"* in
  six places while the ticket goes to **Travel & Mobility Support**. **Neither
  name is Remote's** — *Travel & Mobility Support* is this project's own Zendesk
  group (`6168404930335`, exists, receives tickets) and *Global Mobility* exists
  nowhere at all. Decided: remove "Global Mobility", and build the prose **from
  the routing row** so the two cannot drift again — UC-05's fix as the model,
  because `docs/ESCALATION-DESTINATIONS.md` §2.1 shows naive substitution makes
  some of those sentences contradict themselves.
- ❌ Two UCs must not execute conflicting actions. *Satisfied structurally* —
  UC-03 has one signature and no execution path into UC-04.
- ❌ Duplicate Zendesk tickets must not be created without a business reason.
  ⚠️ **Unverified.** Whether a continued request raises a second ticket or
  re-uses the first is not asserted by any test found in this pass.

## 13. Surface coverage

| Surface | What the reader should observe |
|---|---|
| **Portal (requester)** | The **answer first**, in a dialog — measured, because it was below the fold on every result at both 1180×900 and 340×740. Then, only where there is one, the offer. A refusal is never a modal |
| **Portal — continuation** | When routed onward: what has been carried, what is still needed, and two worked completions that reach a success and a refusal without changing the traveller |
| **Zendesk ticket** | Tagged `uc03`, `queue_travel_support`, plus `escalation_travel_support` on escalations. The note names who it is about, what happened, the owning team, and where to sign |
| **ZAF sidebar** | For `formal_letter_requested`: who the letter is about (added late — the signer was not shown who they were signing about), what it will say, and one sign-off control. For every other outcome: no controls, and the reason why |
| **Live Feed** | The decision and its attempts; the registry set **as the gate saw it** |
| **Requests ("My requests")** | The traveller's own state, and a way to collect an issued letter |
| **Backend/API** | `POST /uc03/api/cases/:id/request-letter` (traveller's own session) · `POST /uc03/api/cases/:id/signoff\|decline` (entitled specialist) · letter fetch |
| **Database** | `cases` · `review_queue` · `documents` (`travel_support_letter` on issue; `travel_informational_response` on the plain answer) · `audit_log` · `audit_trace` · `workflow_claims` |
| **Remote Sandbox** | **Unchanged** — reads only |

## 14. UX_ACCEPTANCE

- **Hierarchy.** The answer is the first thing. This is settled and measured, not
  a preference.
- **A result earns a modal when it offers a next action** the reader would
  otherwise have to scroll to find. An offer interrupts; a hand-off says so in
  place; **a refusal is never a modal**. A modal carrying nothing actionable
  teaches people to dismiss without reading, and the next thing dismissed
  unread is a disclaimer.
- **Minimal information.** The routing narration in `policyEngine.js` explaining
  Remote's own process to a traveller is out of scope — we implement Remote's
  product, we do not explain it back.
- **No internal language.** `route_to_uc04` reached a requester as a bare slug
  once. Never again.
- **Action clarity.** One offer, one signature, and where there is neither, one
  sentence saying so.
- **Practicality — the continuation is the test case.** After the hand-off the
  requester must be able to complete the next form without retyping, and without
  needing to know what a valid answer looks like.
- **Consistency.** ⚠️ Currently failing: the panel says Global Mobility, the
  ticket says Travel & Mobility Support.

## 15. Successful business outcome

> **The employee knows what their trip needs and has it** — either an answer and
> a signed letter that a consulate accepts, or a clear statement that this needs
> permission to work abroad, with everything they already told us carried forward
> and a way to continue that takes minutes rather than starting again.
>
> And: no letter silently omitted what was asked for; no compliance question was
> answered here; no work authorisation was manufactured; the person who started
> the request is still the person finishing it; and the receiving human never
> started from raw ticket text.

*(The clause "no letter was issued without a signature" stood here until
2026-08-20 and was false — the standard letter auto-issues by design since
`UC-03.md` §23. DRIFT-079.)*

### 15.1 Declines, and how we decide which ones survive — DECIDED, NOT YET BUILT

The question put on 2026-08-20: *"are we improving declines, such that anything we
could have checked ahead of time is done instantly, and only the ones that truly
require specialist eyes stay? how do we determine that?"*

**Most of the pre-emptive telling already exists.** Everything the gates can check
is checked before anything is drafted — employment active, destination in the
registry, not sanctioned, dates readable, scope within the template. A requester
failing any of those is told immediately and no document is written.

**What is left can only be judged after the fact**, because it is the one thing
the gates structurally cannot see: whether the drafted document suits the
authority that will read it. We cannot warn in advance about a fact we do not
hold.

**So the rule is: measure, don't guess.** A decline today carries a mandatory
free-text reason, and free text is unreadable at scale. The specialist picks a
**structured reason class** alongside the note, split by one question — *could
this system have known?*

| Class | Means | What happens to it |
|---|---|---|
| **Checkable** | Wrong dates, wrong entity, employee not active, scope a template could express | **A gate we failed to build.** Ranked by volume in `src/metrics/compute.js`; the top row is literally the next thing to engineer |
| **Judgement** | "This consulate wants the addressee named", "this authority will not accept an unsigned letter" | Not derivable from any data we hold. **These stay** |

A decline reason that keeps recurring is a work order, not a statistic. This is
the JD's *"define success metrics, track them, and use them to decide what to
iterate on and what to stop"* made mechanical — and it is the same counter that
§11 says should eventually argue for removing the last signature, and §9.1 says
should argue for keeping or removing the draft-assist.

**And the requester is told.** A decline the requester never sees is
*correct, durable, audited and reaching nobody* — the failure `letterDelivery.js`
was written to fix for the letter and which nobody fixed for the decline.
DRIFT-080.

## 16. Required evidence for E2E verification

1. **Browser** — the answer visible **without scrolling** at 1180×900 and
   340×740; the offer present only where one exists; no modal on a refusal.
2. **Both chains, driven.** (a) The zero-touch chain — answer → the letter is
   written and issued → the traveller collects a **PDF**, with the delivered
   bytes' sha256 asserted equal to the stored artifact's, **and the PDF hashed at
   render time rather than at collection time** (DRIFT-016). (b) The qualified
   chain — a scope-exceeded ask → the specialist gets the facts pack, the labelled
   suggestion and the sources (§9.1) → signs → the traveller collects.
2b. **A decline, driven** — reason class recorded, and the reason **visible to the
   requester on the portal**, not only on the ticket (DRIFT-080).
3. **A positive routing test** — a registry-listed **non-EOR** destination must
   reach `auto_resolve`. This is the test that fails if the gate is ever
   tightened to `eor_onboarding`.
4. **A sanctions test with the code deliberately present in the registry list**,
   which is what isolates the override from the membership test.
5. **Every letter-scope marker reachable from a real sentence** — the guard
   against the dead-gate failure this use case has already suffered.
6. **Over-triggering checked explicitly** — "my visa appointment at the
   consulate" asks for nothing and must scan clean.
7. **Continuation, end to end, as one person** — carried fields pre-filled; the
   traveller unchanged through submission; **the signed-in persona unchanged**,
   which is the thing that fails today (DRIFT-078); both worked completions
   reaching their stated outcomes through the **real** UC-04 gates; a subject
   mismatch refused.
7b. **A quick-fill for every outcome in §6**, so no case has to be reached by
    typing (DRIFT-082).
8. **Database** — a `documents` row of type `travel_support_letter` exists. As of
   2026-08-20 production held **three informational responses and zero issued
   letters**: nobody has yet got a letter out of this system.
9. **Zendesk** — tags, group, and the note's owning-team line.
10. **Idempotency** — one delivery, one case; two simultaneous accepts, one
    letter.

## 17. Known SPEC_DRIFT

---

### SPEC_DRIFT · DRIFT-011 · Three of the four documented outbound routes do not exist

**Original/documented behaviour:** §5 specifies a deterministic router with five
destinations: auto-issue, **UC-04** (temporary work authorisation), **UC-08**
(tax), **UC-07** (permanent relocation), **UC-06** (payroll/contract-change), plus
human review on ambiguity. §12 scenarios 4 and 5 test the UC-08 and UC-07 routes
explicitly.
**Current implementation:** `src/uc03/classifier.js` defines
`VALID_INTENTS = new Set(["business_travel", "work_authorization"])` — **two**
intents. The only cross-UC route in the code is to UC-04. No string in
`policyEngine.js`, `workflow.js` or `classifier.js` routes to UC-06, UC-07 or
UC-08.
**Current tests assume:** the two built intents. §12's scenarios 4 and 5 are not
implemented as routing tests.
**Difference:** an explicit tax-residency question and permanent-move language
both fall to whichever of the two intents the classifier picks, then through the
ordinary gates — most likely `escalate` to **Travel & Mobility Support**, not to
Tax Operations or Mobility Legal (Tier-3).
**Evidence:** `src/uc03/classifier.js:42`; `docs/use-cases/UC-03.md` §5, §12.4,
§12.5; and from the receiving side, `UC-07.md` §5 opens *"Ticket (routed from
UC-03, or direct)"* and `UC-08` expects the same.
**Likely reason:** cannot be established from the repository. UC-04's route was
built and documented in depth (§16, §17, `uc04Intake.js`); the other three appear
never to have been started. No commit, issue or ADR found in this pass explains
the narrowing.
**Risk if left as-is:** a cross-border tax question lands with a travel-letter
team that has no mandate to answer it, and the mandatory tax disclaimer UC-08
guarantees is never applied. This is the single largest cross-UC gap found.
**Recommendation:** HUMAN_DECISION_REQUIRED — either build the three routes to the
same hand-off standard as UC-04, or narrow §5 and §12 to the two intents and say
plainly that a tax or relocation question is handled by a specialist reading the
ticket.
**Confidence:** HIGH on the finding; LOW on why.
**DISPOSITION — DECIDED 2026-08-20 · NOT YET BUILT · narrow, do not route.**
The two built intents stay. `docs/use-cases/UC-03.md` §5 and §12 narrow to them.
The harm this finding actually names — a tax question reaching a team with no
mandate, without UC-08's mandatory disclaimer — is closed by **G-C**: two named
escalation reasons, `tax_residency_question` → Tax Operations and
`permanent_relocation_question` → Mobility Legal (Tier-3). A named escalation
tells the receiving human what they hold; a route would create a record nobody
asked for. Reasoning in §12. **This is a gate-behaviour change**: two new
outcomes, and the n8n port (`workflows/nodes-uc03/travelRouterGates.js`) must
move with it under `test/n8nUc03Parity.test.js`, then be republished.

---

### SPEC_DRIFT · DRIFT-012 · The second zero-touch letter type does not exist

**Original/documented behaviour:** §5 and §12.2 name **two** auto-issue types:
the business-travel letter and the **personal no-objection letter**.
**Current implementation:** one letter type. `business_travel` is the only
documentation intent, and `letterScope.js`/`letter.js` know one template.
**Current tests assume:** one template.
**Difference:** a no-objection letter request is classified as business travel and
produces the wrong document, or falls to `letter_scope_exceeded`.
**Evidence:** `src/uc03/classifier.js:42`; `src/uc03/letter.js`.
**Likely reason:** not established.
**Risk if left as-is:** a requester receives a document that does not say what
they needed it to say — and the letter-scope gate is the only thing standing
between that and a signature.
**Recommendation:** HUMAN_DECISION_REQUIRED — build the second template, or
remove it from §5/§12 and let it escalate as scope-exceeded (which is the current,
safe, behaviour).
**Confidence:** HIGH
**DISPOSITION — DECIDED 2026-08-20 · NOT YET BUILT · build it.**
A third intent in `classifier.js`, a second template, `letterScope.js` extended to
know which markers belong to which template. It shrinks the `letter_scope_exceeded`
set, which is the §11 argument for eventually retiring the last signature — so
this finding and DRIFT-016 both pull in the same direction. Not a gate-behaviour
change in the risky sense: it adds a way to *succeed*, and the failure mode it
replaces (a no-objection ask answered with a business-travel letter) is a wrong
document today.

---

### SPEC_DRIFT · DRIFT-013 · A 30-day duration cap contradicts UC-04's own sourced finding

**Original/documented behaviour:** UC-03 §1 — *"**Never** … calculates
Schengen/183-day thresholds"*. UC-04 §7, first line — *"**No duration threshold,
anywhere.** Confirmed wrong by every primary source checked: Remote's own process
has no stay-duration cap … only one competitor publishes a hard number, and frames
it explicitly as an internal administrative cap, not a legal safe harbour."*
**Current implementation:** `src/uc03/policyEngine.js:113`
`DEFAULT_DURATION_CAP_DAYS = 30`, escalating `duration_over_cap`. Its own comment
calls it *"Illustrative default — Remote's real travel policy would define this"*
and it is configurable per call.
**Current tests assume:** the 30-day cap.
**Difference:** an invented number decides a real routing outcome, in the one use
case whose spec says it computes no thresholds, and it is the exact class of
number the sibling use case's research rejected.
**Evidence:** `src/uc03/policyEngine.js:105–113`; `UC-04.md` §7.
**Likely reason:** the coherency map titles UC-04 *"Remote Work Authorization /
Workation (**<30d**)"*, so 30 is almost certainly inherited from that title — which
is a scoping label, not a policy.
**Risk if left as-is:** a 31-day trip is escalated and a 30-day trip is not, on no
authority, and the requester is not told the threshold is illustrative. It is
defensible as a *risk signal that escalates rather than refuses* — which is what
the code does — but it is undocumented in §7's deterministic list.
**Recommendation:** HUMAN_DECISION_REQUIRED — keep it and document it in §7 as an
explicitly illustrative operational cap that escalates (never refuses), and say so
on the screen; or remove it and let the work-authorisation route carry duration.
**Confidence:** HIGH
**DISPOSITION — DECIDED 2026-08-20 · NOT YET BUILT · remove the cap. This is
G-B, a gate-behaviour change.**
The instruction was *"the original documentation should win, but verify it against
Remote's public docs."* Verified: UC-04 §7's sourced finding stands — *"No duration
threshold, anywhere. Confirmed wrong by every primary source checked: Remote's own
process has no stay-duration cap."* Remote publishes none.

The sharpest form of the finding, and the reason removal beats documenting it:
**the number in the code has no authority, while two numbers with real authority
sit unused.** Schengen 90/180 (D-07 art. 6(1), evaluated per day of stay) and the
US substantial-presence 183 (D-35) are both in `docs/knowledge/`. UC-03's own §1
forbids it from computing either.

So `DEFAULT_DURATION_CAP_DAYS` and the `duration_over_cap` outcome go, and duration
becomes a **carried field** into UC-04, where `schengenPeakDays()` already
evaluates it against the instrument. Nothing is lost — the risk signal moves to the
use case that can actually weigh it. Legally this is strictly safer: an invented
threshold presented to a requester as authoritative is the exposure, not the
absence of one. Both copies of the gate move; `test/n8nUc03Parity.test.js` will
catch a half-done change, and the graph needs republishing.

---

### SPEC_DRIFT · DRIFT-014 · The reader is told "Global Mobility"; the ticket goes to Travel & Mobility Support

**Original/documented behaviour:** `UC-03.md` names neither team.
**Current implementation:** four human-facing strings in
`src/uc03/policyEngine.js` (lines 444, 468, 667, 735) and one in `workflow.js`
tell the reader *"Global Mobility owns it"* / *"Global Mobility weighs it"*.
`src/shared/escalationRouting.js` routes to **Travel & Mobility Support**
(`queue_travel_support`, group `6168404930335`, exists). **No team named Global
Mobility exists in the routing table, in the Zendesk account, or in the spec.**
**Current tests assume:** neither — no test compares the prose to the routing.
**Difference:** these strings reach the ticket. `src/portal/server.js` puts the
deciding gate's `means` on the note as the *"What happened"* lead, and
`buildTicketNote()` prints the owning team four lines below it — so one note names
two different teams.
**Evidence:** `docs/ESCALATION-DESTINATIONS.md` §2.1, reproduced in-process.
**Likely reason:** the prose was written before the routing table existed.
**Risk if left as-is:** ownership becomes ambiguous on exactly the hand-offs that
need it least ambiguous. This is the same defect UC-05 shipped and closed.
**Recommendation:** RECONCILE — but note `ESCALATION-DESTINATIONS.md` argues that
simply substituting the routed team's name makes the sentence contradict itself,
so this is a routing decision rather than a find-and-replace. UC-05's fix is the
model: build the prose *from* the routing row so the two cannot drift.
**Confidence:** HIGH
**DISPOSITION — DECIDED 2026-08-20 · NOT YET BUILT · remove "Global Mobility",
build the prose from the routing row.**
The instruction was *"use the official Remote name, and append the other name for
understanding."* **Checked, and the premise does not hold: Remote publishes no
team names, and neither of these is Remote's.** *Travel & Mobility Support* is this
project's own Zendesk group (`6168404930335`, exists, receives tickets); *Global
Mobility* names an industry **function** and exists in no routing table, no Zendesk
account and no spec.

Applying the rule to what is actually there: the routed group name wins, because it
is the only one that can receive a ticket, and "global mobility" may appear
lowercase as the function where it aids a reader. Following UC-05's fix rather than
find-and-replace, per this finding's own recommendation. Four strings in
`policyEngine.js` (444, 468, 667, 735) and one in `workflow.js`.

---

### SPEC_DRIFT · DRIFT-015 · The destination-jurisdiction gate entered in code, not in the spec

**Original/documented behaviour:** §7/§9/§12 originally specified a **sanctions
block list only**.
**Current implementation:** a second gate refusing any destination absent from
`GET /v1/countries`.
**Current tests assume:** the gate, including a positive non-EOR test.
**Difference:** now none — §7.1 was written specifically to repair this, and says
so.
**Evidence:** `docs/use-cases/UC-03.md` §7.1.
**Likely reason:** the gate entered during the build.
**Risk if left as-is:** none. Recorded because the *class* matters: **a gate that
exists in code and not in the spec is a documentation defect regardless of whether
the gate is right, because nobody can review a control they cannot find.**
**Recommendation:** KEEP_CURRENT.
**Confidence:** HIGH
**DISPOSITION — DECIDED 2026-08-20 · NO CHANGE · keep current.**
Confirmed, and the endpoint's semantics are written down here so the question is
not re-opened. Remote's own words for `GET /v1/countries`: ***"The countries
present in the list are the ones where creating a company is allowed."***

- **224 rows** of 249 ISO codes (live, 2026-08-17, two captures on two days
  agreeing exactly). **26 ISO countries are absent** and are refused
  `destination_jurisdiction_excluded`.
- It is **not** "countries Remote does EOR in". That is a separate boolean on the
  same row, `eor_onboarding`, true for **91 of 224**.
- UC-03 gates on **membership** and deliberately never on the flag. Gating on the
  flag would refuse Montenegro for ordinary travel, and Martinique for a French
  employee, which would be plainly wrong. `test/uc03.test.js` pins the Montenegro
  case positively — the one test that fails if the gate is ever tightened.
- Row fields include `alpha_2_code`, `code` (alpha-3), `name`, `eor_onboarding`.

The finding stays recorded even though nothing changes, because its *class* is the
point: **a gate that exists in code and not in the spec is a documentation defect
regardless of whether the gate is right, because nobody can review a control they
cannot find.**

---

### SPEC_DRIFT · DRIFT-016 · No letter has ever been issued in production

**Original/documented behaviour:** §5/§8 — the formal letter is the use case's
principal artifact.
**Current implementation:** built and tested end to end, including the byte-hash
equality assertion.
**Current tests assume:** the full chain works — and it does, hermetically.
**Difference:** production `documents` held **3 `travel_informational_response`
rows and 0 `travel_support_letter` rows** as of 2026-08-20, and the five UC-03
rows actually waiting are all `work_authorization_requested` — which the signature
route deliberately refuses. **The one control UC-03 has is on the outcome nothing
in production reaches.**
**Evidence:** `CLAUDE.md` §7 honest-gaps item 10.
**Likely reason:** the signature was built after the traffic; the traffic is all
routing, not letters.
**Risk if left as-is:** an untested-in-production path is the demo's centrepiece.
**Recommendation:** RECONCILE — drive the full chain in production once and record
it, before treating §15.3 as proven.
**Confidence:** HIGH
**DISPOSITION — DECIDED 2026-08-20 · NOT YET BUILT · reconcile, and the letter
becomes a PDF.**
Two halves.

**The PDF.** `src/pdf/` already renders via Playwright/Chromium for UC-01, so this
is reuse rather than new infrastructure. **One trap, and it is silent:** Chromium's
PDF output is not byte-deterministic — `/CreationDate` and `/ID` differ per render.
UC-03's guarantee is *"the bytes delivered are the bytes signed."* So the PDF must
be rendered **once, before hashing, and stored as the artifact**. Rendering on
demand at collection time breaks the one guarantee this use case is built on, and
**every test would still pass**, because they hash the HTML. This is the same shape
as the dead-gate failures §5 of `docs/WHY-THIS-SHAPE.md` collects: correct-looking
from outside, wrong underneath.

**The production run.** Unchanged and still owed: production `documents` held three
`travel_informational_response` rows and **zero** `travel_support_letter` rows as of
2026-08-20. The demo's centrepiece has never run in production. **Blocked from a
coding container** — `pg` cannot reach Supabase through an HTTP CONNECT proxy and
the n8n MCP is unauthorised — so this needs the project owner's machine or an
authorised session. Recorded as blocked rather than pending, because the two are
different claims.

---

## 17b. Findings opened by the decision session, 2026-08-20

Six findings that the first reconciliation pass did not have. They exist because
this pass did something the first one did not: it **ran the journeys and asked
what Remote actually does**, rather than reading the specs and the code against
each other. Three of the six were found by the project owner driving the system,
not by any test — which is the standing lesson of `docs/WHY-THIS-SHAPE.md` §7 and
of every dead gate this repository has shipped.

---

### SPEC_DRIFT · DRIFT-078 · UC-04 cannot be filed by the employee, so the UC-03 hand-off changes who is signed in

**Original/documented behaviour:** `src/portal/uc03Continuation.js`'s own header —
*"the employee, on the surface that stands in for Remote's Requests section,
deciding to take their travel question further… the click **IS** the employee
raising it."* And from Remote's side, `docs/research/CROSS-BORDER-FLOW.md` §5:
`WorkAuthorizationRequest` is *"submitted by an employee"* **[CONFIRMED — schema]**,
with *"the employer's role begins at stage 1 approval."*
**Current implementation:** `src/uc04/workflow.js:146` —
`identityVerified = Boolean(session && employment && session.companyId === employment.company_id)`.
An employee session carries `{authenticatedEmploymentId}` and no `companyId`, so
the comparison is `undefined === "co_amend_01"` and can only ever be false. **An
employee can never file a UC-04 request for themselves.**
To keep the form submittable at all, `src/portal/assets/app.js` (~4809) silently
moves the persona picker to the first `company_admin` persona on continuation, with
a comment stating the intent: *"THE SESSION MOVES, BECAUSE THE ACTOR DOES."*
**Current tests assume:** the flip. `test/portalUc03Continuation.test.js` and
`test/portalScenarioSession.test.js` both encode it.
**Difference:** Remote's flow is **employee submits → manager approves → Remote
approves or declines**. UC-04 demands the *approver's* session at the *submission*
stage. The two files inside our own hand-off contradict each other about who the
actor is, and Remote's schema sides against the one that currently wins.
**Evidence:** reported by the project owner driving the demo — *"when transferred
from UC-03 to UC-04, the personnel signed in changes from employee to company
admin… it makes me unable to complete the process."* Then confirmed in the code at
the three sites above.
**Likely reason:** UC-04 was built admin-first (it shares a session shape with
UC-09, which genuinely is an admin action), and the continuation was built later
against a surface that could not accept its own actor. The flip was a workaround
for the modelling error rather than a question about it.
**Risk if left as-is:** the demo cannot be completed by one person, which is how it
was found. Underneath that: a gate that can only ever refuse is indistinguishable
from a gate being careful — the failure shape this repository has now paid for four
times — and here it failed so early that a workaround was built instead of the gate
being questioned.
**Recommendation:** HUMAN_DECISION_REQUIRED — three options were put:
**(a)** accept two session shapes, employee-for-self or admin-with-company-match;
**(b)** keep UC-04 admin-only and delete the continuation; **(c)** keep the flip
and label it.
**DISPOSITION — DECIDED 2026-08-20 · NOT YET BUILT · option (a). This is G-A, a
gate-behaviour change.** It is the only option under which the system matches the
source we hold `[CONFIRMED]`. (b) contradicts Remote's schema and deletes the
demo's best "knowing when not to automate" moment; (c) fixes nothing. The company
match still binds the admin path — the change adds an accepted shape, it does not
relax the existing one. Removing the flip also removes the reason
`carriedSubjectName()` exists to explain *"who is this request about"* after the
picker moved under the reader; that explanation can stay, harmlessly.
**Confidence:** HIGH

---

### SPEC_DRIFT · DRIFT-079 · The contract still describes a signature the routine letter no longer needs

**Original/documented behaviour:** this contract's own §5 step 7 — *"A named Travel
& Mobility Support specialist signs it"* — its §6 row *"Traveller accepts the offer
→ waits for one signature. Nothing is issued"*, and its §15 clause *"no letter was
issued without a signature."*
**Current implementation:** `src/uc03/policyEngine.js:233` sets
`letterAutoIssue = true`; the standard ask resolves `auto_resolve /
standard_letter_issued`, described in the engine's own prose as *"written and issued
to them straight away, with nobody in the path."* `docs/use-cases/UC-03.md` §23 is
titled *"The signature moved to where the risk is."*
**Current tests assume:** the code. `test/uc03AutoIssue.test.js` exists and passes.
**Difference:** the contract described a human gate on the common path that had
already been removed by design. A reader auditing UC-03's controls from this
document would have counted one that is not there — and, worse, would have been
reassured by it.
**Evidence:** `policyEngine.js:233`, `:495–499`, `:1099–1109`; `UC-03.md` §23.
**Likely reason:** §23 landed on 2026-08-20 and the contract was reconciled from
§1–§23 the same day; the change was newer than the read.
**Risk if left as-is:** a control that exists only in the contract is worse than a
missing control, because it stops anyone looking for the real one.
**DISPOSITION — DECIDED 2026-08-20 · BUILT (documentation only) · reconcile.**
§5, §6 and §15 corrected in this revision, with the correction stated rather than
made silently. No code changes.
**Confidence:** HIGH

---

### SPEC_DRIFT · DRIFT-080 · A decline's reason is mandatory, recorded, and never reaches a portal requester

**Original/documented behaviour:** `src/uc03/signoffPolicy.js:145` states the
intent in its own words — *"A declined travel letter must carry a reason — the
employee is told why, and the reason is recorded."* Line 262 enforces it: a
reason-less decline is refused 400.
**Current implementation:** the reason is captured and enforced, then
`submitTravelLetterSignoff()` posts it **to the Zendesk ticket**. The portal — the
surface most UC-03 traffic arrives on — has no route that returns it.
**Current tests assume:** that the reason is required and recorded. No test asserts
it is *delivered*.
**Difference:** *"the employee is told why"* is true of the Zendesk path and false
of the portal path, and the code reads as though it is true of both.
**Evidence:** `signoffPolicy.js:145`, `:262`; the absence of any decline-reason
route in `src/portal/`.
**Likely reason:** the same one `src/uc03/letterDelivery.js`'s header records for
the letter itself — *"the signed path had one… a request that never went through
Zendesk had nothing."* That was fixed for the document and not for the refusal.
**Risk if left as-is:** this is the *"correct, durable, audited and reaching
nobody"* failure `CLAUDE.md` §7 lists four times, in its most frustrating form: the
requester is refused and is not told why, while the system's own comment says they
were.
**DISPOSITION — DECIDED 2026-08-20 · NOT YET BUILT · build it**, together with the
reason-class taxonomy in §15.1 — the classes are what make declines countable, and
the delivery is what makes them fair.
**Confidence:** HIGH

---

### SPEC_DRIFT · DRIFT-081 · UC-03 has no `decisionSources.js`; four of its siblings do

**Original/documented behaviour:** `docs/use-cases/UC-03.md` §23.7 sets the
standard — the specialist should get *"a recommendation, not only a compiled
case"*, carrying its own cautions, because *"a recommendation listing only reasons
to agree is an argument, not advice."*
**Current implementation:** `recommendLetterAction()` delivers the recommendation.
But `src/uc04/decisionSources.js`, `src/uc05/decisionSources.js`,
`src/uc07/decisionSources.js` and `src/uc08/decisionSources.js` all exist and
UC-03's does not — so a UC-03 specialist sees this system's reasoning with no
statutory source beside any finding, where a UC-04 reviewer sees the instrument.
**Current tests assume:** nothing; the module's absence is not asserted either way.
**Difference:** the 🟢 use case that issues a document a consulate will read is the
one whose reviewer gets no citations.
**Evidence:** `ls src/*/decisionSources.js`; `UC-03.md` §23.7.
**Likely reason:** `decisionSources.js` spread from UC-04 outward through the 🟡/🔴
tiers, and UC-03 is 🟢, so it was never in that sweep.
**Risk if left as-is:** modest today — UC-03's letter asserts only what the
employment record holds, so it makes no statutory claim needing a citation. It
becomes real with §9.1's draft-assist, where a specialist composing a bespoke
letter genuinely needs the destination's rules to hand.
**DISPOSITION — DECIDED 2026-08-20 · NOT YET BUILT · build it**, as the third
piece of §9.1. The corpus already covers all four demo countries: D-07, D-09,
D-10/D-11, D-14/D-15, D-16.
**Confidence:** HIGH

---

### SPEC_DRIFT · DRIFT-082 · Five quick-fills for roughly fifteen outcomes

**Original/documented behaviour:** none — the portal's quick-fills are a demo
affordance, never specified.
**Current implementation:** `src/portal/assets/app.js` holds five UC-03 scenarios
(`uc03-trip`, `uc03-workation`, `uc03-letter`, `uc03-letter-no-entity`,
`uc03-terminated`) against the ~15 outcomes in §6.
**Current tests assume:** the five that exist.
**Difference:** no quick-fill reaches a sanctioned destination, a destination
outside the registry, an unresolvable destination, unreadable dates, low
confidence, the non-EOR destination that **must pass**, letter-scope-exceeded, or a
specialist decline. Every one of those has to be reached by typing.
**Evidence:** the project owner, on the demo — *"all the fields for all the
different cases should be prefilled, I don't want to manually fill anything during
demo… the prefilling should cover all possible cases and must be intuitive to
know."*
**Likely reason:** scenarios were added when a specific case needed demonstrating,
never swept against the outcome list.
**Risk if left as-is:** the cases that must be typed live are exactly the awkward
ones, where a typo produces a refusal indistinguishable from a defect — on camera.
And a demo that cannot reach an outcome is a demo that cannot show a control.
**DISPOSITION — DECIDED 2026-08-20 · NOT YET BUILT · build a quick-fill for every
§6 outcome**, then run the same audit across the other eight use cases.
Browser-asset scenario objects only; no gate is touched. *(One outcome disappears
first: `duration_over_cap`, per DRIFT-013.)*
**Confidence:** HIGH

---

### SPEC_DRIFT · DRIFT-083 · "A specialist *writes* a letter" reads as a system action

**Original/documented behaviour:** n/a — this contract's own §6 wording.
**Current implementation:** the row read *"A specialist writes a letter rather than
signing a bad one."* Everything this system produces is digital; "writes" here
means **composes, outside this product**, because on `letter_scope_exceeded`
nothing is drafted at all.
**Difference:** a reader — including the project owner — reasonably read it as
somebody writing by hand, or as a system-generated draft. Neither happens.
**Evidence:** asked directly on 2026-08-20: *"I thought letters are digitally
written, how come I am seeing writing by hand?"*
**Risk if left as-is:** low individually. Recorded because of its class, which is
`docs/UI-AUDIENCES.md`'s: **the sentence was accurate and still misinformed its
reader**, and accuracy was never the property being violated.
**DISPOSITION — DECIDED 2026-08-20 · BUILT (documentation only) · reword** to say
plainly that the specialist composes it outside this system. Note that §9.1's
draft-assist changes what is true here: the specialist will no longer start from a
blank page, though the document still originates with them.
**Confidence:** HIGH

---

### SPEC_DRIFT · DRIFT-084 · Remote publishes a travel-letter API and five webhook events; we subscribe to none and read none

**Original/documented behaviour:** `00-FOUNDATION.md` §2's two-door intake model —
a Remote-native event, or a Zendesk ticket. UC-03's contract was subtitled
*"Zendesk-native"* until 2026-08-20.
**Current implementation:** neither door. `grep -rn "travel_letter\." src/
workflows/ zaf-app/` returns **nothing**. `/v1/travel-letter-requests` appears in
`src/uc03/` only as a **citation inside comments** — the schema was read in order
to write the letter, and the endpoint has never been called. The mock serves it;
no client asks.
**What Remote actually publishes** [CONFIRMED — `docs/REMOTE-API-INDEX.txt`, from
Remote's own `llms.txt`]:

```
travel_letter.requested             travel_letter.approved_by_manager
travel_letter.approved_by_remote    travel_letter.declined_by_manager
travel_letter.declined_by_remote
GET /v1/travel-letter-requests  ·  GET …/{id}  ·  PATCH ×2
```

**Current tests assume:** nothing. No test looks for a subscription, so its
absence cannot fail.
**Difference — and this is the half that matters.** DRIFT-077 records that UC-01
has no Remote-side intake **because Remote publishes no API for it**. UC-03's
situation is the opposite: **the door exists and we are not standing at it.** Those
are different findings that look identical in a status table.

**And the finding is larger than the subscription.** `travel_letter.requested`
fires when a travel letter is requested **inside Remote's own product**, which has
its own approval chain — `approved_by_manager` → `approved_by_remote`.
`docs/research/CROSS-BORDER-FLOW.md` already carries this as 🔴 **D-2**: *"UC-03
issues a different artifact than Remote's Travel Support Letter, outside Remote's
approval chain"*, and states the ordering plainly — ***"approvals precede the
document; the document is the output of the state machine."***

UC-03 runs that in reverse. It **issues the letter first**, with nobody in the
path (`letterAutoIssue = true`, and that is the design, not an accident). So
subscribing today would mean receiving an event announcing the *start* of a
two-approval chain and answering it by handing the requester the finished artifact
that chain exists to produce. Not a smaller version of Remote's flow — **a
contradiction of it.**

**Evidence:** `docs/REMOTE-API-INDEX.txt:331–339`; the empty greps above;
`docs/research/CROSS-BORDER-FLOW.md` §D-2; `src/uc03/policyEngine.js:233`.
**Likely reason:** UC-03 was built from the router framing, where the interesting
problem is telling three request types apart. Remote's travel-letter *object* was
read for its schema and never as a *lifecycle*. The same reading that produced
DRIFT-011's four documented routes.
**Risk if left as-is:** low operationally — nothing breaks. High **reputationally
and analytically**: a reviewer who finds this themselves reads it as not having
looked at the product, and it is the one finding in UC-03's set that questions
whether the use case has the right shape at all.

**Recommendation: RECORD NOW · BUILD NOTHING · DO NOT DECIDE UNDER DEADLINE.**
Three steps, in this order, and the order is the recommendation:

1. **Record it** — done here. A known gap living only in a prose paragraph is the
   failure this register exists to prevent, and this one lived in the index's
   header note for a day before it was numbered.
2. **Answer the question it opens**, which is DRIFT-076's question one use case
   over: *does UC-03 duplicate a flow Remote already runs?* The honest answer may
   be that UC-03's right role is **assisting** that chain — preparing the case for
   the manager's approval, flagging the risk, attaching the reasoning — rather
   than replacing it. That is a materially different use case from the one built,
   not an extra intake path bolted onto it.
3. **Then, and only then, decide what gets built.** Building the subscription
   before step 2 is work on a shape that may not survive the answer.

**Explicitly not to be answered before submission.** An open finding carrying its
own reasoning reads as judgement; a redesign rushed in the last week reads as
neither. *"Remote publishes this; here is why subscribing would force us to
re-examine the premise; here is why we did not do that in a week"* is the stronger
artifact, and it is the criterion this role is scarce on.
**Confidence:** HIGH on the finding. HIGH on the ordering. The redesign in step 2
is **not** a recommendation — it is the option that must be weighed.

---

## 17c. Findings that land on UC-03 but are not UC-03's to decide

Four findings touch this use case and are **deliberately left open here**. Three
are cross-cutting: settling them from inside UC-03 would set policy for UC-06's
amendments and UC-09's payments, which is exactly the decision UC-03 is not
entitled to make. The fourth is jointly UC-01's. Recommendations are stated so the
next session starts from a position rather than from scratch.

### DRIFT-043 · The UC-01 / UC-03 letter boundary — **downgrade to RECONCILE**

The finding says the boundary is *"drawn nowhere."* **That is mis-framed, and the
correction came from the project owner: the two documents are not the same thing
at all.**

| | UC-01 — employment verification | UC-03 — travel support |
|---|---|---|
| Says | *"…is employed by Y in the capacity detailed below"* | *"…the employment of X with Y, **and the professional nature of their business travel to Z (dates)**"* |
| About | **Status.** Names no trip | **A journey.** Carries a Travel dates row |
| Built against | The employment record | **Schengen Visa Code Annex A(1)(e)** — *"documents proving the purpose of the journey"* (`src/uc03/letter.js:161–164`) |
| Audience | A bank, a landlord, an employer | A consulate |
| Also says | — | *"It is not a work authorisation"* |

So UC-03's letter is UC-01's letter **plus a journey, cited to the Visa Code**. A
consulate cannot use UC-01's for a Schengen application — it does not prove the
purpose of the journey. A bank has no use for UC-03's.

**The boundary is therefore perfectly drawable and was simply never written down.**
It is not a decision; it is a missing sentence:

> A request naming a **trip** is UC-03's. A request about **employment status** is
> UC-01's. A request naming **both** is UC-03's, **because its letter contains
> UC-01's.**

That last clause is the useful half: the containment relationship means UC-03 is
always the safe answer when both are present, and **there is no case where UC-01's
letter satisfies a traveller**.

**Residual risk is low and worth stating rather than implying.** UC-01's gate 6
escalates `non_standard_request` on visa phrasing; UC-03 deliberately scans
*"my visa appointment at the consulate"* clean (`test/uc03LetterScope.test.js`).
**Neither issues the wrong document.** The cost is a routing inefficiency, not a
wrong artifact — which is why this was never urgent and is now cheap.

**Recommendation:** `HUMAN_DECISION_REQUIRED` → **RECONCILE**. Write the rule into
both specs. Note it grows slightly with DRIFT-012 — a second UC-03 letter means
three letter types across two use cases — so write it before that lands, not after.

### DRIFT-040 · The metrics layer measures two of nine — **no UC-03 action**

UC-03 is one of the **two that IS measured**: `src/uc01/workflow.js` and
`src/uc03/workflow.js` are the only `caseStore.createCase()` callers, so §15.1's
decline-class counting has a real foundation precisely here. Nothing is owed on
UC-03's side. **Recommendation: leave open as cross-cutting.** The gap is the other
seven, and closing it means giving seven use cases a shared case row — a
foundational change, not a UC-03 one.

### DRIFT-041 · No approval has an expiry — **state the non-goal, do not build a clock**

§11 currently reads *"Expiry — **None defined**"* and *"the drafted letter waits
indefinitely."* Written that way it reads as an oversight. It is not, and the
reason is worth having:

> **No approval in this system expires, and that is a decision.** An expiry that
> auto-**approves** is worse than a wait — it manufactures the consent the gate
> exists to obtain. An expiry that auto-**refuses** punishes the requester for the
> specialist's queue depth. Both convert a visible delay into an invisible
> outcome. What is genuinely owed is a **reminder and an age-ranked queue**, which
> changes who looks and when without changing any verdict.

**Recommendation: RECONCILE the framing now** (one paragraph, converting the
weakest row in §11 into a stated position); **leave the reminder unbuilt.** A
scheduler across five approval surfaces is not pre-submission work, and
`src/approvalqueue/` already reports what is waiting — it simply has no age
threshold that changes anything.

### DRIFT-042 · Views name a UUID where a person belongs — **extend the test**

UC-03 already **adopts** the shared person-naming module; it is one of six
adopters. The gap is only that the structural test asserts UC-02/05/06/09 and skips
**UC-03 and UC-04**. So *"nothing fails when a view omits the person"* is true of
UC-03 by **omission from an assertion**, not by design.

**Recommendation: RECONCILE — add UC-03 and UC-04 to the existing assertion.** The
cheapest real fix in this set: no product decision, no new module, and it closes a
hole in the use case whose specialist is being asked to sign a document about a
named human being.

---

## 18. Build queue

**Everything decided in §17, §17b and §17c, in the order it should be built, with
the files, the tests and the done-criterion for each.** §1–§16 describe the
target; this section is how you get there. **Nothing here is built.**

**Why this section exists, written 2026-08-21.** UC-01 and UC-03 were the last
two decided use cases without a build queue. Their changes were numbered inside
their §17 dispositions — `G-A`…`G-C` here, `G-1`…`G-4` there — which is enough to
know *what* was decided and not enough to know *in what order*. In this use case
the ordering carries a cross-pass dependency that is invisible from inside UC-03:
**`G-A` is a change to `src/uc04/`, and UC-04's own `[W-4]` does not work without
it.** Build `W-4` first and the new employee surface files a request our own gate
then refuses.

### Numbering

The gate changes keep their existing names `G-A`, `G-B`, `G-C` — they are cited
from `docs/use-cases/UC-03.md`, `qa/SPEC-DRIFT-INDEX.md` and this contract's own
§5, §6 and §12, and renaming them would break every one of those citations for no
gain. **The build items are prefixed `L-`**, and where an `L-` item *is* a gate
change it names the `G-` it carries. `L-` is an eleventh scheme and corresponds to
none of the other ten, for the reason `CLAUDE.md` §7 item 20 gives.

> **Standing rules that apply to every step below**, so they are not repeated in
> each one:
>
> - **The gates exist twice.** `src/uc03/policyEngine.js` and
>   `workflows/nodes-uc03/travelRouterGates.js` — which is a **full port**, not a
>   thin one: it carries its own `DEFAULT_DURATION_CAP_DAYS` at `:596` and its
>   own `duration_over_cap` return at `:862`. `test/n8nUc03Parity.test.js` is
>   what catches a half-done change.
> - **Every gate change ends in a republish** of graph `WORKFLOW_UC03_ID`, and
>   the only thing that answers *"is this live?"* is `versionId ===
>   activeVersionId`. `npm run verify-deployed` afterwards.
> - **A green n8n execution proves nothing** if a node was pinned. Check the
>   destination table, never the run status.
> - **Positive tests, not only negative ones.** UC-03 is where this repository
>   learned the rule: its alpha-3 comparison and its unnameable sanctions codes
>   were **two structurally dead gates in one use case**, both invisible through
>   a green suite, both found by running a real scenario and reading what came
>   back.
> - **UC-03 may not compute a threshold.** §1 forbids it, and `G-B` exists
>   because it did anyway.

---

### Step 0 · Two measurements, before any code

Both are read-only. Both need credentials this container does not hold — `pg`
cannot reach Supabase through an HTTP CONNECT proxy, and `/queue` on the
deployment needs `PORTAL_ACCESS_KEY`.

| # | Question | How | What it decides |
|---|---|---|---|
| **M-1** | How many decided `cases` rows carry `reason: 'duration_over_cap'`? | `select count(*) from cases where reason = 'duration_over_cap'` | How many requesters were refused on **an invented number with no authority**. `G-B` removes the outcome going forward; it does not repair the backlog, and the two are different claims. If the count is non-zero those cases need naming, the same way the fifteen mis-grouped escalations are named rather than quietly left |
| **M-2** | Does production `documents` still hold **zero** `travel_support_letter` rows? | `select type, count(*) from documents group by type` | Whether §16's centrepiece has ever run. As of 2026-08-20: three `travel_informational_response` rows, **zero** letters. **Recorded as blocked, not pending** — the two are different claims, and this one needs the owner's machine or an authorised session |

**Done when:** both numbers are written into DRIFT-013 and DRIFT-016 with the
date they were measured.

---

### Step 1 · `L-1` — the two cheapest fixes, and one of them is a prerequisite

Neither touches a gate. Both are worth doing first because one unblocks Step 5
and the other is the cheapest real fix in the whole UC-03 set.

#### `L-1a` · DRIFT-042 — add UC-03 and UC-04 to the person-naming assertion

| | |
|---|---|
| **Behaviour** | None. UC-03 already **adopts** the shared person-naming module; the structural test asserts UC-02/05/06/09 and skips UC-03 and UC-04. So *"nothing fails when a view omits the person"* is true of UC-03 by **omission from an assertion**, not by design |
| **Files** | the structural test only |
| **Done when** | The assertion covers six adopters instead of four, and it closes a hole in the use case whose specialist is being asked to sign a document about a named human being |

#### `L-1b` · DRIFT-043 — write the UC-01/UC-03 letter boundary into both specs

**Before `L-5`, not after.** DRIFT-043's own recommendation says so: a second
UC-03 letter means three letter types across two use cases, and the rule is
harder to state once there are three.

| | |
|---|---|
| **The sentence** | *A request naming a **trip** is UC-03's. A request about **employment status** is UC-01's. A request naming **both** is UC-03's, **because its letter contains UC-01's.*** |
| **Why it is not a decision** | The two documents were never the same thing. UC-03's letter is UC-01's **plus a journey, cited to Schengen Visa Code Annex A(1)(e)** (`src/uc03/letter.js:161–164`). A consulate cannot use UC-01's — it does not prove the purpose of the journey. A bank has no use for UC-03's |
| **Files** | `docs/use-cases/UC-01.md` and `docs/use-cases/UC-03.md`. **Documentation only** |
| **Done when** | Both specs carry the rule, including the containment clause — which is the useful half, because it means UC-03 is always the safe answer when both are present |

---

### Step 2 · `L-2` — `G-B`, remove the duration cap

**Before `L-8`.** One outcome disappears here, and building a quick-fill for an
outcome about to be deleted is wasted work that reads as a contradiction.

| | |
|---|---|
| **Behaviour** | `DEFAULT_DURATION_CAP_DAYS` and the `duration_over_cap` outcome are **removed**. Duration becomes a **carried field** into UC-04, where `schengenPeakDays()` already evaluates it against art. 6(1) per day of stay |
| **Why removal beats documenting it** | **The number in the code has no authority, while two numbers with real authority sit unused.** Schengen 90/180 (D-07) and US substantial-presence 183 (D-35) are both in `docs/knowledge/`, and UC-03's own §1 forbids it from computing either. An invented threshold presented to a requester as authoritative **is** the exposure; the absence of one is not |
| **Files** | `src/uc03/policyEngine.js` (`:113` the constant, `:181`/`:194` the parameter, `:393–394` the gate, `:650` the reason row, `:740` the C-27 comment, `:786` the second parameter, `:1009` the plain-language case) · `workflows/nodes-uc03/travelRouterGates.js` (`:596`, `:749`, `:752`, `:862–863`) · `src/uc03/uc04Intake.js` (duration is now **carried**, so it must actually arrive) · `src/uc03/workflow.js:320` |
| **Tests** | `test/uc03*.test.js` — a **positive** test that a 45-day trip now routes to UC-04 rather than escalating, and that the duration **reaches** UC-04's intake payload · `test/n8nUc03Parity.test.js` green · a test that no UC-03 surface prints a day threshold |
| **Done when** | Nothing in UC-03 names a number of days as a limit, the risk signal has moved to the use case that can weigh it, parity is green, and graph `WORKFLOW_UC03_ID` is republished and verified |

**Nothing is lost.** The signal moves; it does not disappear. Say that in the
commit message, because "we removed the safety cap" is how this reads to someone
who stops at the diff.

---

### Step 3 · `L-3` — `G-C`, two named escalation reasons

**DRIFT-011's actual harm, closed without building a route.** A tax question
reaching a team with no mandate, without UC-08's mandatory disclaimer, is the
risk; the fix is a **named** escalation, not a route. A named escalation tells
the receiving human what they hold. A route would create a record nobody asked
for.

| | |
|---|---|
| **Behaviour** | Two new outcomes: `tax_residency_question` → **Tax Operations**, `permanent_relocation_question` → **Mobility Legal (Tier-3)**. Both stay `escalate`; neither originates a case in another use case |
| **Destinations verified** | Both groups exist and resolve to real ids in `src/shared/escalationGroupIds.js` — `Tax Operations` `6168394287519`, `Mobility Legal (Tier-3)` `6168424846751`. **No group needs creating**, which is not true of every routing change in this repository |
| **The two built intents stay** | `docs/use-cases/UC-03.md` §5 and §12 **narrow** to them. This is the *"use cases connect by reading, never by invoking"* rule applied at the door: classifying what a request **is** stays; deciding that a decided case should **cause** another case is origination and is refused |
| **Files** | `src/uc03/policyEngine.js` (two reasons, gate-ladder entries, plain-language strings, routing rows) · `workflows/nodes-uc03/travelRouterGates.js` · `docs/ESCALATION-DESTINATIONS.md` · `docs/use-cases/UC-03.md` §5 and §12 |
| **Tests** | One positive test per reason, asserting the **named team** and not just the decision · parity green · a test that neither outcome writes anything into UC-04's or UC-08's stores |
| **Done when** | A tax-residency question reaches Tax Operations under its own name, a relocation question reaches Mobility Legal (Tier-3), parity is green, and the graph is republished |

---

### Step 4 · `L-4` — `G-A`, and it is a change to UC-04

**Read this before starting UC-04's queue.** `G-A` is dispositioned here and
lives in `src/uc04/`. `CLAUDE.md` §7 names the dependency in the other direction:
**UC-04's `[W-4]` — the employee surface — does not work without `G-A`.** Build
`W-4` first and the new surface files a request our own gate then refuses.

| | |
|---|---|
| **Behaviour** | UC-04's identity gate accepts **two** session shapes: an employee filing for themselves, or an admin whose company matches. Option (a) of DRIFT-078 — the only option under which the system matches the source we hold `[CONFIRMED]` |
| **Additive, not a relaxation** | The company match still binds the admin path. The change **adds** an accepted shape; it does not loosen the existing one. Anyone reviewing this as "we weakened the identity gate" has read it backwards, so say so in the commit |
| **Files** | `src/uc04/` identity gate · `workflows/nodes-uc04/workationGates.js` · `test/n8nUc04Parity.test.js` |
| **Tests** | A positive test that an employee session filing for themselves is **accepted**; a positive test that an employee filing for **someone else** is still refused; the existing admin-path tests unchanged and green |
| **Done when** | Both accepted shapes work, the crossing is still refused, parity is green, and graph `WORKFLOW_UC04_ID` is republished |

`carriedSubjectName()` may stay — removing the session flip removes the reason it
exists to explain *"who is this request about"*, but the explanation is harmless
and costs nothing.

---

### Step 5 · `L-5` — DRIFT-012, the second letter type

**After `L-1b`.** The boundary sentence has to exist before there are three
letter types across two use cases.

| | |
|---|---|
| **Behaviour** | A **third intent** in `src/uc03/classifier.js` and a **second template** — the personal no-objection letter, which §5 and §12.2 have named all along. `letterScope.js` learns which markers belong to which template |
| **Not a risky gate change** | It adds a way to **succeed**. The failure mode it replaces is live and worse: a no-objection request is classified as business travel today and produces **the wrong document**, or falls to `letter_scope_exceeded` |
| **Files** | `src/uc03/classifier.js:42` · `src/uc03/letter.js` · `src/uc03/letterScope.js` · `workflows/nodes-uc03/travelRouterGates.js` if the intent set is ported there |
| **Tests** | A positive test per template that the **right** document is produced, and a test that markers belonging to one template do not satisfy the other |
| **Done when** | A no-objection request produces a no-objection letter, and the `letter_scope_exceeded` set has measurably shrunk — which is §11's argument for eventually retiring the last signature, so this and `L-6` pull the same way |

---

### Step 6 · `L-6` — DRIFT-016, the letter becomes a PDF, and the production run

Two halves, and the second is blocked rather than pending.

#### `L-6a` · PDF as the artifact of record — **the opposite of UC-01, and the same rule**

| | |
|---|---|
| **Behaviour** | The travel support letter is rendered to PDF **once, before hashing, and stored as the artifact.** `src/pdf/render.js` already renders via Playwright/Chromium, so this is reuse, not new infrastructure |
| **The silent trap** | Chromium's PDF output is **not** byte-deterministic — `/CreationDate` and `/ID` differ per render. UC-03's guarantee is *"the bytes delivered are the bytes signed."* **Rendering on demand at collection time breaks that guarantee and every test still passes**, because the tests hash the HTML |
| **Why UC-03 gets PDF and UC-01 does not** | One rule, two branches: *the artifact of record is whatever a human signed; where nobody signed, it is whatever both execution paths can produce identically.* UC-03's letter carries a **specialist's signature**, so the delivered file must be the signed file. UC-01's is auto-issued and unsigned |
| **Files** | `src/uc03/letter.js` · `src/uc03/letterDelivery.js` · `src/pdf/render.js` (its header note calling UC-03 *"a thin router with no letter of its own"* is **stale**) · `src/shared/caseStore.js`'s `documents` write |
| **Done when** | A signed letter's stored bytes and delivered bytes are the same bytes, proven by hash, and nothing re-renders at collection |

#### `L-6b` · The production run — **blocked, not pending**

Production `documents` held **zero** `travel_support_letter` rows as of
2026-08-20. **The demo's centrepiece has never run in production.** This needs
the owner's machine or an authorised session; it cannot be done from a coding
container. `M-2` is the measurement, and this is the act.

---

### Step 7 · `L-7` — three things a decided case owes a human

None is a gate change. All three are the difference between a correct decision
and a decision somebody can act on.

| | Item | What gets built |
|---|---|---|
| **`L-7a`** | DRIFT-080 — a decline's reason reaches the portal requester | The reason is mandatory and recorded today and **reaches nobody**. Build it together with the **reason-class taxonomy in §15.1**: the classes are what make declines countable, and the delivery is what makes them fair |
| **`L-7b`** | DRIFT-081 — UC-03 has no `decisionSources.js`; four siblings do | The third piece of §9.1. The corpus already covers all four demo countries: D-07, D-09, D-10/D-11, D-14/D-15, D-16 — so this is citation wiring, not research |
| **`L-7c`** | DRIFT-014 — the reader is told "Global Mobility"; the ticket goes to Travel & Mobility Support | **Remote publishes no team names and neither of these is Remote's.** *Travel & Mobility Support* is this project's own Zendesk group (`6168404930335`, exists, receives tickets); *Global Mobility* names an industry **function** and exists in no routing table, no Zendesk account and no spec. The routed group name wins, because it is the only one that can receive a ticket. **Follow UC-05's fix, not find-and-replace.** See the line-number note below — the disposition's four are stale and the real figure is seven, three of which `L-2` deletes for free |

**The disposition's line numbers are stale, and re-deriving them changed the
plan.** DRIFT-014 names *"four strings in `policyEngine.js` (444, 468, 667, 735)
and one in `workflow.js`."* Grepped 2026-08-21, the file has grown and the real
set is **six in `src/uc03/policyEngine.js` — `:21`, `:390`, `:630`, `:654`,
`:954`, `:1027` — and one in `src/uc03/workflow.js:22`.**

**Three of the six belong to the over-cap path** (`:390`, `:654`, `:1027`) and
are **deleted by `L-2`**, not rewritten. So doing `L-2` first turns a seven-string
edit into a four-string one, and a builder who works from the disposition's stale
list will hunt four line numbers that no longer point at anything and may
conclude the fix is already done.

That is `CLAUDE.md` §6's stale-status-file gotcha inside this register's own
prose: **check the code before believing a line number, this queue included.**

---

### Step 8 · `L-8` — DRIFT-082, a quick-fill for every §6 outcome

**Last among the build steps, because the outcome set changes twice before it.**
`L-2` deletes `duration_over_cap`; `L-3` adds two; `L-5` adds a letter type.
Five quick-fills serve roughly fifteen outcomes today.

| | |
|---|---|
| **Files** | Browser-asset scenario objects only. **No gate is touched** |
| **Then** | Run the same audit across the other eight use cases — the finding's own second half |
| **Done when** | Every §6 outcome can be reached from the surface in one click, against the outcome set as it stands **after** Steps 2, 3 and 5 |

---

### Step 9 · DRIFT-084 — deferred on purpose, and the deferral is the deliverable

**RECORD NOW · BUILD NOTHING · DO NOT DECIDE UNDER DEADLINE.** Remote publishes
`GET /v1/travel-letter-requests` and five `travel_letter.*` webhook events, and
we subscribe to none and read none.

**The door exists and we are not standing at it** — which is the *opposite* of
UC-01's DRIFT-077, where Remote publishes no intake API at all. The two look
identical in a status table and are different findings.

**Subscribing today would contradict Remote's flow rather than join it.**
`travel_letter.requested` fires at the **start** of a two-approval chain
(`approved_by_manager` → `approved_by_remote`). UC-03 issues the letter **first**,
with nobody in the path — `letterAutoIssue = true`, and that is the design.
`docs/research/CROSS-BORDER-FLOW.md` §D-2 states the ordering plainly:
***"approvals precede the document; the document is the output of the state
machine."***

So the question this opens is DRIFT-076's question one use case over: **does
UC-03 duplicate a flow Remote already runs?** The honest answer may be that
UC-03's right role is **assisting** that chain — preparing the case, flagging the
risk, attaching the reasoning — rather than replacing it. That is a materially
different use case from the one built.

**Do not answer it before submission.** *"Remote publishes this; here is why
subscribing would force us to re-examine the premise; here is why we did not do
that in a week"* is the stronger artifact, and it is the criterion this role is
scarce on.

---

### Step 10 · Sync the status, last

Only after each step lands, and **in the same unit of work as the step**:

- §17's dispositions here gain a `BUILT` line, dated, naming the commit.
- `qa/SPEC-DRIFT-INDEX.md` rows move from *not yet built* to *done*, and the
  count line is **re-measured, not incremented**.
- `docs/use-cases/UC-03.md` §5, §6, §11, §12 and §15 move with the behaviour.
- `docs/BUILD-LOG.md` gains a §3.x write-up, and `CLAUDE.md` §4/§5/§7 are synced
  in the **same** unit of work.

---

### What must NOT change, and why a builder might reasonably think otherwise

1. **Do not add a duration threshold back** in another form, or in UC-04's
   intake, or as a warning string. `G-B`'s whole content is that **this use case
   has no authority to name a number of days.**
2. **Do not build the two extra routes** DRIFT-011 originally described. Two
   intents stay; two **named escalations** are the fix. A route would create a
   record nobody asked for, and it would let a 🟢 keyword classifier originate a
   🔴 case.
3. **Do not keep the destination-jurisdiction gate out of the spec** — DRIFT-015
   was decided **NO CHANGE / keep current**, meaning the gate stays and the spec
   catches up. It is the one finding in this set where the code was right and the
   document was behind.
4. **Do not render the PDF at collection time**, however much cheaper it looks.
   That breaks *"the bytes delivered are the bytes signed"* silently, while every
   test passes.
5. **Do not build an expiry clock as part of `L-7`.** DRIFT-041 is decided:
   **age and warn everywhere, lapse nowhere.** An expiry that auto-approves
   manufactures the consent the gate exists to obtain; one that auto-refuses
   punishes the requester for the specialist's queue depth. A reminder and an
   age-ranked queue are owed; a verdict that changes itself is not. *(The backlog
   session's A5 answer — "add a clock to everything" — is the same position: the
   clock ages and warns, and changes no verdict. §17c's "leave the reminder
   unbuilt" was a **pre-submission timing** call, not a contradiction of it.)*
6. **Do not subscribe to `travel_letter.*` to close DRIFT-084.** Step 9 is the
   decision, and the decision is to hold.
