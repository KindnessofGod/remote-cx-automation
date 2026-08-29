# Product design standard — every operational interface in this project

| | |
|---|---|
| **Status** | Proposed constitution. Written 2026-08-20 during the requirements reconciliation pass. **Nothing was changed in `src/`, `zaf-app/` or `workflows/` to produce it.** |
| **Applies to** | `src/portal/` · `zaf-app/` · the Zendesk ticket body raised by the portal · `src/remoteui/` · `src/approvalqueue/` · `src/auditview/` (Live Feed) · the portal's "My requests" view · `src/metrics/` |
| **Does not apply to** | `src/playground/`, `src/chatdemo/`, `src/livedemo/`, `src/dashboard/` — the only four surfaces in this repository whose reader is *us*. Say so on them; do not let their habits leak. |
| **Built on** | [`docs/UI-AUDIENCES.md`](../docs/UI-AUDIENCES.md) (who reads what), [`docs/WHY-THIS-SHAPE.md`](../docs/WHY-THIS-SHAPE.md) (why the system is shaped this way), [`docs/SIDEBAR-APPROVAL-ROLES.md`](../docs/SIDEBAR-APPROVAL-ROLES.md) (who is being asked to act) |

---

## 0. The two principles everything else is downstream of

> **1. Complexity may exist in the system. It should not automatically be
> exposed to the operator.**

This system genuinely is complicated: nine use cases, three risk tiers, two
execution paths, twelve-to-twenty-five ordered gates per use case, a two-level
audit model, a cross-use-case router. All of that is real and none of it is the
reader's problem. The gate ladder exists so a *specialist* can audit a refusal;
it is not the answer to "what happened to my letter?".

> **2. Every visible element must justify itself by helping the user
> understand, decide, act, or recover.**

Four verbs. If a row does none of them **for the reader of that screen**, it does
not belong on that screen. A fact being true, sourced, and correct is not the
qualification — this project has removed three separate passages that were all
three and still wrong to show ([`UI-AUDIENCES.md`](../docs/UI-AUDIENCES.md) §4).

**And the instruction that follows from both, aimed at whoever reviews this next:
look for things to REMOVE.** Every review pass in this repository's history has
added rows. A design review that ends with a longer screen has not been done.
Come back with a deletion list, run each item past §3's routing test first, and
be prepared to defend the ones you kept rather than the ones you cut.

---

## 1. Information hierarchy

Each operational surface answers, in this order, top to bottom:

1. **What happened** — one sentence, in the reader's own vocabulary.
2. **What needs you** — the action, or the explicit statement that there is none.
3. **What it was decided on** — the figures compared, not the rules consulted.
4. **What was not checked** — limits and absences (see §5; never compressible).
5. **Everything else** — behind a disclosure.

The ordering rule that follows from this and is violated most often: **an answer
is not "context" and must never sit below the fold.** UC-03 §21 measured this at
two viewport sizes and found the answer below the fold on every result the portal
produced; the fix was a dialog carrying the answer, not a bigger heading.

**One heading, then the content.** A heading followed by a paragraph restating
the heading is the single most common defect in this codebase's surfaces, and the
project owner has corrected it by name: *"remove this part — only the heading is
needed. Same for every use case."*

---

## 2. Progressive disclosure

| Tier | What lives there | Rule |
|---|---|---|
| **Always visible** | Outcome · owner · next action · any limit or absence that changes what the reader should do | Must fit one screen at 340×740 |
| **One click** | The deciding gate's plain-words meaning, the decision facts, the artifact | A reader deciding *this* case may need it; a reader who is not, does not |
| **Two clicks / operator block** | The full gate ladder, trace attempts, correlation refs, rule ids, finding ids | Never on the first screen of a requester-facing surface |
| **Never on a human surface** | Table names, column names, workflow ids, node names, execution ids, model names, prompt text | Belongs in `audit_trace` and the audit viewer |

The audit viewer and the approval queue are the two exceptions, and only because
their reader's own questions are about internal state. Even there, the *lead* is
an outcome and the ids are the detail.

---

## 3. Minimal visible information — the two tests

**Run the routing test first. It is what stops the deletion test doing damage.**

- **Routing test.** Is this useless to *this* reader, or to everyone? Almost
  always the former. Then it is **moved**, not deleted — to the operator block,
  to the ticket note, to the audit row.
- **Deletion test.** Would this reader do anything differently if this row were
  not here? If no, remove it.

**The structural trap, verified and still live.** `src/portal/`'s `details` array
is rendered **twice, to two different readers** — an open table on the employee's
result page and inside the Zendesk ticket a specialist opens. The only routing is
by label string (`OPS_ONLY_DETAILS`, `LEAD_DETAIL`). There is no requester-only
destination at all, so applying this rule for one reader silently changes the
other's screen with no compile error either way. **Check both renderings before
changing a label.**

---

## 4. Plain operational language

Translate every internal token before it reaches a person.

| Never printed to a human | Printed instead |
|---|---|
| `over_scope_request`, `cutoff_lock_passed`, `high_risk_pair` | the gate's `means` sentence |
| `UC-04`, `route_to_uc04` | "work-authorisation review" |
| `review_queue`, `audit_log`, `workflow_claims` | "waiting with", "the record of this decision" |
| `pending_review`, `prepared_for_signoff` | "a specialist is checking this" |
| `gpt-4o-mini`, `source: "llm"`, `confidence: 0.72` | on a *specialist* screen: "read by the model, confidence 0.72 against a 0.85 threshold". On a *requester* screen: nothing |
| a bare UUID under "Employee" | the person's name, status and country |

**The slug is kept beside the prose on specialist and operator surfaces only**,
because it is the exact string in `audit_log`, in the metrics exception ranking
and in the n8n node — it is what somebody searches by. It is never the whole
message, and it never appears alone on a requester surface.

**We implement Remote's product; we do not explain it back to Remote.** Copy that
narrates how Remote's own flows work, or instructs a Remote employee in Remote's
own procedure, is out of scope on every surface — a correction the owner has
given explicitly.

**Use Remote's word where Remote has one.** `decline` (not `deny`) because
Remote's `DeclineExpenseParams` says decline; `approved`/`pending`/`reimbursed`
because that is the status enum. Where Remote has no word, this project picks one
and uses it everywhere: `approve`, not `release`.

---

## 5. What may never be stripped in the name of tidiness

Four classes are **exempt from the deletion test**. On a 🔴 dossier or a payment
screen, a specialist acting on false completeness is the failure the entire
system exists to prevent.

1. **Statements of a limit or an absence.** "Not looked up" is not a blank.
   "Unknown" is not "no". `employeeSubject.js`'s five states and
   `decisionFacts.js`'s `unknownFact` exist for exactly this. An empty list and
   an unanswered question must never render identically.
2. **The mandatory disclaimers** (`src/shared/disclaimer.js`) — UC-03, UC-07,
   UC-08. Coverage is an integrity invariant at 100%, not a rate.
3. **The named team a case was routed to**, and whether assignment succeeded.
   "ASSIGNMENT SKIPPED — the group does not exist" is a required sentence, not
   noise.
4. **Anything the reader would point at afterwards to defend the decision** —
   the source of a statutory finding, the reference, the threshold compared.

The allowed compression is to move the *evidence* into the comment beside the
code and keep the *claim* on the page.

---

## 6. Typography, spacing, density

- **One type scale**, shared by all surfaces. Outcome > section heading > body >
  metadata. Four levels, no more.
- **Line length capped** around 70–80 characters. The current portal result
  panels exceed this in prose blocks.
- **Density follows the reader.** A specialist working a queue all day wants a
  compact table; a requester reading one result wants air. Do not give the
  requester the specialist's density or the specialist the requester's.
- **Numbers align.** Money, day counts and dates render right-aligned and in one
  format per surface. Money always carries its currency; a bare integer cap is
  meaningless until you say what currency it is in (UC-02 §7 paid for this).
- **No wall of text.** If understanding the next action needs several paragraphs,
  that is a defect unless the content is a statutory finding or a disclaimer.

---

## 7. Status design

Every state renders as **a word first**, colour third.

| State | Meaning | Tone token |
|---|---|---|
| Settled | Nothing is waiting; the request is finished | `--r-dot-settled` |
| Waiting | Waiting on a named party | `--r-dot-waiting` |
| Stopped | Refused, blocked, or escalated with no automated continuation | `--r-dot-stopped` |
| Not confirmed | We acted, and the downstream system has not confirmed | `--r-dot-waiting` + explicit words |

Two rules the codebase already enforces and this standard adopts:

- **A held or partially-approved item is never terminal** while its buttons are
  still on screen.
- **"A human approved it" is not "Remote accepted the write."** UC-02's
  `APPROVED — NOT CONFIRMED AT REMOTE` is the pattern; copy it wherever a write
  can fail after an approval.

Colour never carries meaning alone. Use the state scale, never the chart series
palette (`--r-series-*`), for status.

---

## 8. Primary vs. secondary actions

- **One primary action per screen**, and it is the thing the reader came to do.
- If the reader has **nothing to do, render no controls at all** — do not render
  a disabled button as a hint. UC-01's rule generalises: an escalation is visible
  and has no buttons, because a one-click close would turn the safe path into a
  dismiss button.
- **The control's absence must be explained in one sentence**, and the sentence
  must distinguish the two absences (§9 of the approval-queue design):
  - *nothing may approve this, ever* (🔴 by construction), versus
  - *something must approve this and nothing can* (a defect).
  Both render as "no approve button". Collapsing them hides the only thing worth
  surfacing.
- **Secondary actions are text-weight**, never a second filled button.

---

## 9. Destructive and consequential actions

"Destructive" here means *outward-facing and hard to reverse*: money moving, a
letter reaching a bank, a contract amendment posted, a ticket created.

- **State the consequence before execution, in the button's own vicinity** — what
  changes, where, and who sees it. Not in a tooltip.
- **Name the counterparty.** "Posts the letter to the customer's ticket and
  resolves it" beats "Approve".
- **A reason is required** wherever the decision is attributable — and it is
  required *in the browser*, before the round trip, not by a 400.
- **Never offer a second chance that isn't one.** A decided case refuses a second
  decision; the UI must not render the control as if it would work.
- **Never present a download the sandbox cannot deliver** or an action whose
  precondition the screen has not checked.

---

## 10. Approvals

- **Say which role the reader is being asked to act as**, by name, and say when
  they are not entitled — before they type, not after they submit.
- **Show what the gate compared**, not the gate's name. The figures the decision
  turned on are the evidence; the rule id is provenance, and provenance lives one
  disclosure down.
- **Dual control renders as two independent blocks**, each with its own state.
  A filled slot shows who filled it and when. The second slot must state that the
  same person cannot fill it.
- **Show the freshness re-check.** An approval days after a decision re-reads the
  record; if that read changed anything, that is the most important thing on the
  screen.
- **After approval, show what actually happened downstream**, including "not yet
  confirmed".

---

## 11. Evidence presentation

- **Facts, not narration.** "Asked for: salary. The standard letter may state:
  name, start date, contract type, probation, status, legal entity." — not "the
  classifier detected an over-scope request."
- **Every statutory or policy finding carries its source** where a specialist can
  reach it, and the source is a citation a person could look up, never our own
  summary of it.
- **Never show a value the gate exists to protect.** UC-01's over-scope panel
  names the *field* asked for and never reads the compensation figure off the
  record. This generalises: the exception surface and the artifact are different
  documents, and only one of them is safe to enrich.
- **A confidence number is always shown with its threshold.** "Not confident
  enough" is a comparison with one side missing.
- **Two citation registers currently share the `C-N` numbering**
  (`docs/knowledge/layer-1-statutory/CONTRADICTIONS.md` and
  `docs/CORRECTIONS-LOG.md`) and code cites both. Until one is re-prefixed, every
  citation rendered to a human must name its register.

---

## 12. Errors

- **Name the layer.** This project has lost hours three times to an error whose
  own words pointed at the wrong layer (a proxy 403 reading as a permissions
  403; a `403 invalid role` that was an endpoint problem). Operator-facing errors
  say what was attempted, against what, and what answered.
- **Distinguish "we got an answer about the record" from "the request was never
  evaluated."** `upstream_record_not_found` (404) and `upstream_unavailable`
  (403/5xx/transport) are different sentences for a human, not one.
- **A failed side-effect never erases a decision.** If the decision is durable
  and the notification failed, say both: "Decided and recorded. The ticket update
  failed — nobody has been told yet."
- **Never a raw stack, status code, or slug alone** on a requester surface.

---

## 13. Empty states

- **An empty list states its scope**: "No requests filed under this persona"
  beats "Nothing here."
- **Distinguish empty from unread from unreachable.** Zero rows, "we did not
  look", and "we looked and could not reach it" are three states, and this
  repository has shipped bugs by rendering all three as a blank.
- **An empty stuck-list is a result**, and should say so — it is what a queue
  that has done its job looks like.

---

## 14. Loading states

- **Anything that reaches a live service says so while it runs**, naming the
  service in the reader's terms ("checking the employment record").
- **No spinner without a subject.**
- **A live read that fails degrades the block it belongs to and never the case.**
  The employee block reporting `unavailable` must not blank the decision.
- **Never render a partial result as a complete one.** If three of four dimensions
  have returned, the screen says so.

---

## 15. Success states

- **Say what is now true in the world**, not that an operation succeeded.
  "The letter has been posted to the ticket and the ticket is resolved" — not
  "Success."
- **Name what is still outstanding**, if anything, and who holds it.
- **Give the artifact a way out.** If a document was produced, the reader can
  fetch it from the success state.
- **Never claim success the underlying execution did not achieve.** This is an
  invariant, not a preference: the UI may not report an approval as executed
  before the write returns.

---

## 16. Accessibility

- **Colour is never the only cue.** Every status renders a word.
- **Contrast** meets WCAG AA against both themes; both themes are defined —
  `:root` for light, redefined under `prefers-color-scheme: dark` and again under
  an explicit `data-theme`, so a toggle wins in both directions.
- **Every control is reachable and labelled** — real `<button>` elements, real
  labels, `aria-pressed` on toggles, focus visible.
- **Announce state changes** that happen without a navigation (a decision
  landing, a slot filling).
- **Text scales**: relative units, no fixed-height text containers.
- **Wide content scrolls inside its own container**; the page body never scrolls
  horizontally.
- `test/uiAccessibility.test.js` and `test/uiPalette.test.js` already enforce part
  of this. Extend them rather than eyeballing.

---

## 17. Consistency across surfaces

**The hard rule: no two surfaces may disagree about the state of the same
request.** The portal, the Zendesk ticket, the ZAF sidebar, the Live Feed, the
approval queue and "My requests" are six windows on one record.

Enforce it structurally, not by discipline:

- **One vocabulary, one source.** Team names come from
  `src/shared/escalationRouting.js`; approval verbs and locations from
  `src/approvalqueue/approvalRoutes.js` via `handoffDirections.js`; outcome words
  from the use case's own policy module. Prose that names a team, a verb or a
  screen must be *built from* those, never retyped — this is exactly how UC-05's
  panel came to say "Local HR Legal" while the ticket went to HR Ops.
- **The server decides, the page renders.** Browser assets may not re-derive a
  policy, branch on a decision string, or compute an outcome. This is already
  asserted by test for `zaf-app/` and the portal; hold the line.
- **Where a surface cannot know a fact, it says so** rather than computing a
  rival answer.

---

## 18. Real-world practicality

Judge every flow as a busy operator handling many cases a day. Look for:

- **Repeated data entry.** If the reader already told us, or we already know, the
  field is prefilled — and the prefill states where it came from and whether it
  is a guess.
- **A form the reader cannot complete.** If a screen demands inputs no available
  source can supply, that is a design defect, not a validation.
- **Unnecessary navigation.** The evidence needed for *this* decision is on the
  decision screen. If the specialist must open Remote and the ticket to decide,
  the panel has failed.
- **Unclear ownership.** Every waiting item names its owner and the screen where
  it is actioned.
- **Recovery.** Every refusal states what would change the answer, or says
  plainly that nothing the requester can supply will.
- **Clicks to the primary action.** Count them. On the specialist path it should
  be one after reading.

---

## 19. How to review against this standard

1. Name the reader. If you cannot, stop — that is the finding.
2. List that reader's questions (`UI-AUDIENCES.md` §2).
3. Map every visible element to one question. Unmapped elements go on the
   deletion list.
4. Run the routing test on the deletion list; move what belongs elsewhere.
5. Check §5's four exempt classes are all still present.
6. Check the same request's state on every other surface that shows it.
7. Report what you removed. **A review that only adds has not been done.**
