# What Remote's own employment-verification form actually asks for

**Every fact in this document was fetched from Remote's own Help Center on
2026-08-28** and is tagged `[CONFIRMED]` on that basis — not from a search
summary, not from a screenshot, not from memory. The retrieval is reproducible
in one line, and the method is worth keeping because it is not obvious:
`support.remote.com` is itself a Zendesk Help Center, so every article has a
JSON representation.

```sh
curl -s "https://support.remote.com/api/v2/help_center/en-us/articles/<id>.json"
```

This supersedes `docs/INTAKE-RESEARCH.md` §6.5, which reached the same headline
conclusion — *the standard letter is instant and self-service; only the
non-standard tail produces work* — but reached it from **search-result
summaries** and marked itself `[INFERRED]` for exactly that reason. §6.5's
judgement was right. What it could not do was enumerate a field, and the fields
are what this document is for.

## 1. The articles

| Id | Title | Updated |
|---|---|---|
| `4422684040461` | How to generate a standard employment verification letter on Remote | 2026-08-25 |
| `8429086541325` | How to request a customized employment letter | 2026-08-27 |
| `8429306915085` | What does the standard employment letter template contain? | 2026-08-18 |
| `19201215338509` | How to get employment verification via 3rd party | 2026-06-14 |
| `17537524163853` | Why is the employment verification letter request not available on my Remote profile? | 2026-05-04 |
| `15715553531917` | Can Remote fill out or sign a form to verify my employment? | 2025-03-05 |
| `4410454087309` | Can Remote provide a proof of employment letter? | 2026-07-01 |

## 2. The standard letter — one field

> "Go to the Requests tab. Click on **New request** and from the request type
> dropdown, choose **Employment letter**. Click on **Continue to request**. We
> have employment letter templates in about 11 languages. **Choose the language
> you want** and click on **Create and download**."
> — `4422684040461`

**The entire intake is a language and a button.** No name box, no date box, no
reason box, no addressee.

This is not minimalism, it is the consequence of something structural, and it is
the single most useful sentence in this document for anyone designing a request
form:

> **The platform already holds every fact the letter prints, so there is nothing
> to ask.** A form asks for what the system does not know. When the answer is
> "nothing", the correct form is a button.

Which is also why UC-01's self-service path takes no identity input: the
requester is signed in, and asking them to type an employment id would be
converting a known fact into a claim.

## 3. What the letter contains — and how ours compares

Article `8429306915085` enumerates the template's contents. Set against
`STANDARD_LETTER_FIELDS` in `src/uc01/policyEngine.js`:

| Remote's template accounts for | Ours | |
|---|---|---|
| Employee's full name | `full_name` | ✅ |
| Employee's start date | `start_date` | ✅ |
| Fixed-term or indefinite contract | `contract_type` | ✅ |
| That the employee is not on probation (if applicable) | `probation` | ✅ |
| Whether on notice / being terminated (if applicable) | `status` | ✅ |
| The local Remote entity name **and address** | `legal_entity` | ⚠️ name only |
| In some languages, full time or part time | — | ❌ |
| If terminated, the termination date | — | ❌ |
| Who to contact for more information | — | ❌ |

**The finding that matters is what is on neither list: money.** Remote's own
template does not print salary. UC-01's over-scope refusal — the one that
declines to state compensation and issues the letter anyway — has been argued in
this repository from first principles about disclosure. It turns out to also be
**what Remote's real template does**, which is a stronger position than the one
we thought we were in: the refusal is not this system being conservative, it is
this system matching the product.

The four gaps are recorded as gaps, not as work orders. Three are cosmetic
(contact line, full/part time, entity address); the fourth — termination date —
is only reachable in a state UC-01 refuses to write about at all, so it is
absent for the same reason the gate exists.

## 4. The customized letter — the same form, one dropdown value apart

> "From the **Templates** dropdown list, choose **None of these templates fits my
> needs**. You will be prompted to fill out a form with all the necessary
> details. **If you need Remote to fill out a form, please upload the form to
> this request.**"
> — `8429086541325`

Three things follow, and each one lands somewhere in this repo:

1. **Standard and customized are one intake with one branch.** Identical entry,
   identical first three clicks; one resolves in seconds, the other in days.
   That is the cleanest available demonstration that **a form collects and does
   not fulfil** — the dropdown supplies a type, and the thing that decides the
   outcome is free text whose defining property is that no template covers it.
2. **There is a file upload**, for the case where a third party sent a form that
   Remote must complete (`15715553531917` confirms Remote does this). Our portal
   has no upload on the UC-01 card. Recorded as a known gap; the ticket channel
   accepts attachments, which is where these arrive in practice.
3. **The requester is told to expect an email**, not an instant download —
   Remote's own words: *"You will receive an email notification when we have
   uploaded the letter to your profile."*

## 5. Third-party verification — a mailbox, and consent is the gate

> "You can verify your employment with Remote via a third party in three ways"
> — download the standard letter yourself; **email** `lifecycle-support@remote.com`,
> where Remote will respond *"after receiving permission from you (the
> employee)"*; or **telephone**, which is the same mailbox plus *"arranging a
> callback to the provided telephone number."*
> — `19201215338509`

**This is G-3's entire premise, in Remote's own words.** The third party has no
Remote account, no session and no tenant — it can only ever make a claim — so
**the employee's recorded consent is the only authenticated signal that channel
will ever have.** `consent_records`, the `awaiting_employee_consent` pending
state, and VC-06's rule that an unanswered third party is *pending* and never
*refused*, all follow from a structure Remote describes here rather than from a
design this project invented.

Two details we did not have before:

- **It is a mailbox, not a form**, which is why `src/thirdparty/`'s door is
  unauthenticated by design rather than by omission.
- **Telephone verification exists** and is answered by a **callback to a number
  the requester supplied** — a call-back-to-a-known-number pattern, which is
  itself an identity control. We do not implement it. Worth knowing that the
  real system's phone channel is not "answer the phone and talk".

## 6. Eligibility — Remote's article and our gate, written independently

> "If you do not see the employment verification letter option available from the
> Request tab, it may be because: you are **not employed through a Remote
> entity** (**Direct Employees and Contractors are not eligible**); your Remote
> **onboarding has not been finalized** yet; you are currently going through an
> **offboarding** process."
> — `17537524163853`

`src/uc01/engagementEligibility.js` was written from DRIFT-074 in August 2026,
before anyone here had read this article, and refuses the same four classes:

| Remote's reason | Our reason code | Portal chip |
|---|---|---|
| Not through a Remote entity — Contractors | `engagement_not_eor_contractor` | Carlos Silva |
| Not through a Remote entity — Direct Employees | `engagement_not_eor_direct` | Amanda J Walker |
| Offboarding in progress | `employee_not_active` | Thomas Weber |
| Onboarding not finalised | `engagement_onboarding_incomplete` | **none** — see below |

**Two documents, written independently, refusing the same people for the same
reasons.** That is the strongest confirmation of G-1 available, and it arrived
after the gate shipped rather than before.

**The fourth row has no chip**, and the reason is the cast rather than the code:
no persona in `src/portal/personas.js` carries an onboarding status, so the
class is reachable in the gate and unreachable from the page.
`test/portalUc01Intake.test.js` asserts the chip's *absence*, so adding such a
persona fails a test that tells whoever added it to give the fourth reason its
chip. A gap that announces itself beats a gap in a list.

## 7. The language count — Remote contradicts itself four ways

| Article | Says |
|---|---|
| `4422684040461` (standard letter) | "about **11** languages" |
| `19201215338509` (third party) | "**15+** different languages" |
| `4410454087309` (proof of employment) | "**24** different languages" |
| `8429188287885` | "**20** different languages" — but this one is the **offer** letter, a different document, and it is the only article that ENUMERATES them |

Recorded rather than resolved. It matters for one practical reason: **the
verification letter's language list is not published anywhere**, so the picker
on `/portal` cannot be Remote's list and must not look like it. Its twenty
options are taken from the offer-letter enumeration — a **ladder rung-3
substitution**, labelled as one in the field's own comment in
`src/portal/assets/index.html`, exactly as the ladder requires.

And only English renders: `src/uc01/letter.js` has one template. A picker
offering twenty languages and quietly answering all of them in English would be
a **fake control**, which this repository has already paid for once (n8n's
"Response Data" dropdown, which asks a different question under a different
response mode — `CLAUDE.md` §6). So a non-English choice is recorded as a
`letter_language_request` document and stated back to the requester on the
result, on both audiences, per `specialistDetail()`'s rule that a statement of a
**limit** never goes specialist-only.

## 8. What this changed

- `src/portal/assets/index.html` — UC-01 gains the language field, with its
  limit stated **before** the click.
- `src/portal/assets/app.js` — UC-01 gains five quick-fills, four of them
  Remote's own eligibility reasons. Its card had rendered a "Quick-fill a
  scenario" heading above an **empty row** since the day it shipped.
- `src/portal/server.js` — the adapter carries the language the way it already
  carried the note: recorded, never consulted by a gate.
- `src/livedemo/assets/` — four example requests, one per outcome the ticket
  channel can reach, written from these articles.
- `test/portalUc01Intake.test.js` — new; pins the invariance property (the
  language cannot change an answer for anyone, in either direction) and drives
  every chip against the real handler, so a button promising a refusal cannot
  quietly start issuing a letter.
- `test/portalCopy.test.js`, `test/portalResultDialog.test.js` — two guards that
  compared against the literal `7` now compare against `REQUEST_TYPES`. Both
  failed when UC-01's coverage went **up**, and a count cannot tell that from
  coverage going down. UC-01's empty scenario row survived precisely because the
  number said 7 and meant it.

---

## 9. The engagement taxonomy — and does a contractor get a letter at all?

Asked on 2026-08-28 while looking at the portal: *"I thought Carlos Silva was a
contractor, why is he showing as an employee? Is it as if everybody there is an
employee? And does Remote issue a verification letter to contractors at all?"*

The first half was a **defect on our side** (§10). The second half is answered
by Remote, and the answer is stronger than "not eligible".

### 9.1 Remote's two enums

Both live on the employment object.
Source: `https://developer.remote.com/reference/get_v1_employments_employment_id.md`,
fetched 2026-08-28. `[CONFIRMED]`

| Field | Values |
|---|---|
| `type` | `employee` · `contractor` · `direct_employee` · `global_payroll_employee` |
| `employment_model` (nullable) | `eor` · `global_payroll` · `peo` |
| `contractor_type` (contractors only) | `standard` · `cor` · `plus` |

`POST /v1/employments` also accepts `type: "hris"`, which **reads back as
`direct_employee`** — a create-side spelling of the same thing.

### 9.2 Why a contractor cannot have this letter

Not a policy preference. Remote is **not a party to the contract**, in its own
words:

> "the contractual relationship is strictly between the Contractors and the
> Client (**Not Remote**)" — art. `4410706624909`
>
> "The contract is between your company and the contractor. **Remote is not a
> party to that agreement.**" — art. `4410700925709`
>
> "Contractor — A person hired by your company… **They do not have a contract
> with Remote.**" — glossary, art. `4413985214221`

And the letter attests employment **with a Remote legal entity** (§3 — the
template carries "the local Remote entity name and address", and no client
company name). So issuing one for a contractor would not be a formatting problem
or an over-disclosure. It would be **a false statement about a third party's
legal relationship**, sent to a bank or an immigration officer. Which is exactly
the sentence `src/uc01/engagementEligibility.js` has carried in its header since
it was written — arrived at independently, and now confirmed from the vendor.

Two supporting confirmations: Remote's proof-of-employment article
(`4410454087309`) frames the whole thing *"As an employee…"*, and the sibling
letter types say so even more bluntly — Travel Support Letters (`37802056865933`)
and Invitation Letters (`41037940738445`) both open *"This is applicable to **EOR
customers only**."*

**What contractors get instead:** invoice records (`16162754154509`), and
explicitly **no payslip** (`4413625460749`). Neither is framed as proof of
engagement.

### 9.3 Is `global_payroll_employee` an employee we may attest to? No.

This was the specific follow-up, and it is the one where the intuition points
the wrong way — the value contains the word "employee".

> "Global Payroll… **requires that the company have its own entity**… an
> outsourced payroll provider." — art. `4413629551501` `[CONFIRMED]`

The company employs them through its **own** entity; Remote runs the payroll.
Remote is not the legal employer, so `engagement_not_eor_direct` is correct.
Same for `direct_employee`: *"employees hired through **your own entity**… we
refer to as direct employees"* (art. `19643520599309`).

### 9.4 Verdict on each value we classify

| Value | Real? | Our class | Correct? |
|---|---|---|---|
| `eor` | ✅ `employment_model` | EOR | ✅ |
| `employee` | ✅ `type` | EOR | ✅ — but see below |
| `eor_employee` | ❌ **zero occurrences** in Remote's docs | EOR | Harmless; now flagged in the JSDoc |
| `full_time` · `part_time` | ❌ ours (mock shape) | EOR | Already labelled as a substitution |
| `contractor` | ✅ `type` | non-EOR | ✅ |
| `global_payroll` · `global_payroll_employee` | ✅ | non-EOR | ✅ (§9.3) |
| `direct_employee` | ✅ `type` | non-EOR | ✅ |
| `hris` | ✅ create-side | non-EOR | **added 2026-08-28**, both copies of the gate |
| `independent_contractor` · `direct` · `hris_employee` | ❌ not found | non-EOR | Harmless aliases |
| **`peo`** | ✅ `employment_model` | **absent from both lists** | ❌ **open — see §9.5** |

`employee` is right but not self-evidently so: `type: "employee"` does not by
itself mean EOR. It holds because `normalizeEmployment()` prefers
`employment_model`, and the two non-EOR employee shapes carry their own `type`
values — so an EOR record is the only thing that reaches the gate saying
"employee". If that preference order ever changes, that entry stops being true.
Now stated in the constant's own JSDoc rather than only here.

### 9.5 Two things NOT changed, because they are judgement calls

Both are recorded here rather than fixed, because each needs a decision about
what Remote's product means, not a patch.

**1. `peo` is in neither list.** It falls through to `eor_status_unknown` — which
**fails closed, so nothing unsafe is shipping** — but refuses for the wrong
reason: "we could not read this engagement" when in fact we read it fine and
have no rule for it. Under PEO Remote **co-employs** (arts. `38461899032973`,
`4413985214221`): it is *a* legal employer but not *the* employer of record. So
the honest outcome is probably an escalate with its own name, not a block and
not an auto-issue. It stays refusing until someone decides.

**2. `contractor_type: "cor"` makes our deflection copy factually wrong.** Under
Contractor of Record the contractor *does* sign an agreement **with Remote**:

> "**Contractor of Record (COR): Yes.** The contractor signs a Contractor
> Services Agreement (CSA) **with Remote** or a Remote-designated
> subcontractor." — art. `4410700925709`
>
> "**Remote is the one engaging with international contractors.**" — art.
> `32649249056269`

So for a COR contractor, "your contract is with the client, not Remote" — the
sentence §9.2 rests on — **is not true**. A letter attesting *engagement* (not
employment) would not be a false attestation. **No published article offering
such a letter was found**, so this is a gap in Remote's documentation rather
than evidence they refuse. The safe shape is a fifth reason that escalates
rather than blocks. Not built.

## 10. The picker that called everyone an employee

`persona.kind` answers *who is at the keyboard* and has two values, `employee`
and `company_admin`. `contract_type` answers *what the legal relationship is*.
Both spell one of their values "employee", and the dropdown was rendering the
first — so **eleven different relationships were captioned identically**, and
Carlos Silva read as "employee" on the very card that was about to refuse him
as a contractor.

Strictly true, and read as a claim about something it was never about. The
screen contradicted its own answer.

Fixed by **deriving the caption from the field the gate branches on** rather
than restating it beside the gate. It would have been half a line to add
`engagement: "contractor"` to each persona; that is the version that drifts —
a second hand-maintained copy of a fact the record already holds, free to
disagree the moment either changes, which is the failure that had just
happened one level up. `test/portalUc01Intake.test.js` now drives every persona
and asserts the caption and the refusal are the same fact.
