# SPEC_DRIFT index — every finding, in one place

**Produced 2026-08-20 by the requirements reconciliation pass. Nothing in
`src/`, `test/`, `docs/`, `workflows/` or `zaf-app/` was changed to produce it.**

> **Second pass, 2026-08-20 — four findings added, `DRIFT-074`…`DRIFT-077`, all
> UC-01.** They came from establishing **how Remote actually collects each of the
> three verification channels** (Requests-tab form · the same form's free-text
> branch · a mailbox), which the first pass had not looked at. One of them,
> DRIFT-074, is a **live compliance defect** rather than a documentation gap: the
> letter asserts an Employer-of-Record relationship for engagement types where it
> does not exist, and it shipped that way on the only end-to-end-proven path. The
> lesson for the remaining eight contracts is transferable — **the first pass read
> the specs and the code, and not the product the code is about.**
>
> **One instance of that lesson is already visible and is NOT yet fixed.** Four
> contracts are subtitled *"Zendesk-native"*, which the brief defines as *"the
> ticket **is** the request"*. Checked against `docs/INTAKE-RESEARCH.md` §2, only
> **UC-08** earns it — a cross-border tax question has no Remote request object at
> all, so the conversation genuinely is the request. The other three do not:
> **UC-01** starts at the Requests tab or a third party's mailbox (now corrected
> in its own §4); **UC-03**'s travel support letter starts in the **Request Hub**,
> and Remote even emits `travel_letter.requested` plus four more events for it, so
> calling it Zendesk-native is wrong in the most consequential direction — there is
> a subscribable event and we are not subscribed; **UC-07**'s relocation starts at
> *Employee profile → Country Transfer Service*, with no API behind it, which is
> UC-01's shape exactly.
>
> **UC-03's subtitle is now corrected** (third pass, below). **UC-07 is not**,
> because re-auditing a contract against Remote's real intake is a pass of its own
> and guessing at it would repeat the error being described.

---

> ## Third pass, 2026-08-20 — the decision session. UC-03 is now DECIDED
>
> The first two passes **found** drift. This one **resolved** it, for UC-03 only.
> Six open findings were decided, six new ones were opened by the decisions
> themselves (`DRIFT-078`…`DRIFT-083`), and every one of the twelve now carries a
> **DISPOSITION** block in `contracts/UC-03-acceptance.md` §17/§17b.
>
> **The rule this pass establishes, and it is the reason the register is worth
> keeping at all.** A resolved finding is **never deleted and never quietly
> edited away**. It says `DECIDED`, says what was decided, says on what evidence,
> and says whether the code has caught up. `CLAUDE.md` §6 records this repository
> paying for the alternative in both directions **on the same day** — an issue open
> in one status file and closed in another — and §5 records a "known gap" that was
> fixed and stayed listed long enough to be re-investigated by every fresh session.
> A register that loses its own history teaches its readers to re-litigate.
>
> **Three states, and they are not the same claim:**
>
> | State | Means |
> |---|---|
> | `DECIDED · BUILT` | Chosen, code matches. Nothing outstanding |
> | `DECIDED · NOT YET BUILT` | Chosen, code still does the old thing. **The drift is still real.** A decision does not close a finding |
> | `OPEN` | Nobody has chosen |
>
> **This pass changed no code.** So every UC-03 finding is `DECIDED · NOT YET BUILT`
> except the two that were documentation-only (DRIFT-079, DRIFT-083) and the one
> that changes nothing (DRIFT-015). Marking any of the others `BUILT` would be the
> overstatement `CLAUDE.md` §1 says discounts everything else.
>
> ### Three of the twelve change gate behaviour
>
> Called out separately because the standing rule is that a behaviour change needs
> an explicit human go-ahead. It was given on 2026-08-20, and the write-ups were
> asked for by name.
>
> | | Change | Finding |
> |---|---|---|
> | **G-A** | UC-04 accepts an employee filing for themselves, or an admin whose company matches | DRIFT-078 |
> | **G-B** | The 30-day duration cap is removed; duration is carried into UC-04 | DRIFT-013 |
> | **G-C** | Two named escalation reasons: `tax_residency_question`, `permanent_relocation_question` | DRIFT-011 |
>
> All three exist **twice** — `workflows/nodes-uc03/travelRouterGates.js` is the n8n
> port, held in parity by `test/n8nUc03Parity.test.js`. A half-done change fails
> that test; a done one still needs the graph republished (`UC-03.md` §23.9 already
> records a redeploy owed from the previous change).

---

> ## Fourth pass, 2026-08-20 — the decision session. UC-01 is now decided
>
> Eight open UC-01 findings were dispositioned by the owner
> (`DRIFT-001`…`DRIFT-005`, `DRIFT-074`, `DRIFT-075`, `DRIFT-076`), one new finding
> was opened by the session itself (`DRIFT-085`), and every one carries a
> **DISPOSITION** — or an explicit *still open* — in
> `contracts/UC-01-acceptance.md` §17/§17b. Same rule as the third pass: nothing
> is deleted, and *decided* is not *built*.
>
> **One finding is `DECIDED · BUILT`.** DRIFT-001's entire fix is deleting a
> paragraph in `docs/use-cases/UC-01.md` §10 that announces a "known gap … not yet
> fixed" which was closed months ago — `workflow.js:247` audits durably at STEP 7,
> before the render and before Zendesk, and `classifier.js:226` traces every LLM
> attempt. That deletion was made by this pass. Writing *"DECIDED: delete it"*
> while leaving it in place is the failure this register exists to prevent.
>
> ### UC-01's four gate-behaviour changes — numbered, not lettered
>
> UC-03's are `G-A`…`G-C`; UC-01's are `G-1`…`G-4`. **They do not correspond.**
> The split is deliberate: this repository already has two registers both numbering
> findings `C-N` with code citing both, which `CLAUDE.md` §7 item 20 records as a
> live hazard. One collision of that kind is enough.
>
> | # | Change | Source |
> |---|---|---|
> | **G-1** | An engagement-eligibility gate in first position — contractor, direct/HRIS, onboarding-incomplete and offboarding are refused by name, and **no `documents` row is written** | DRIFT-074 |
> | **G-2** | An eligible EOR employee asking for the plain standard letter is **deflected** to Remote's own flow. Auto-issue stays, as the fallback for everyone that flow refuses | DRIFT-076 |
> | **G-3** | Consent is **read from `consent_records` as an artifact**, granted by the named employee through a surface they authenticate to. New pending state `awaiting_employee_consent` | DRIFT-075 |
> | **G-4** | The classifier returns the request's language; one we hold no reviewed template for goes to a human. **The letter is never machine-translated** *(recommended, not chosen)* | DRIFT-004 |
>
> **G-1 and G-2 are one piece of work.** *"Is this person eligible for a letter?"*
> and *"could they have served themselves?"* read the same engagement, status and
> onboarding facts. G-2 alone would deflect the very people who cannot self-serve
> back into the flow that refused them.
>
> All four exist **twice** — `workflows/nodes/gates.js` is the n8n port, held by
> `test/n8nParity.test.js` — and each needs graph `WORKFLOW_UC01_ID` republished
> afterwards. **That republish could not be done or verified in this session:** the
> n8n MCP required authorisation and its tools were unavailable, so
> `verify-deployed` and `verify-live-uc01` did not run. DRIFT-002's disposition
> makes reporting that a standing rule rather than a footnote.

---

> ## Fifth pass, 2026-08-21 — the decision session. UC-02 is now decided
>
> All five UC-02 findings (`DRIFT-006`…`DRIFT-010`) carried a disposition from the
> owner. **Two new findings were opened by the decisions themselves** —
> `DRIFT-087` and `DRIFT-088` — and the way they were found is the point of this
> box: **neither came from reading more code.** One came from taking the owner's
> worry seriously enough to trace what the fix would actually do; the other came
> from reading **Remote's own documentation** in order to honour a disposition.
>
> **The strongest result of this pass is that a literal reading of the owner's own
> standard produced a better answer than the finding's recommendation.** The
> instruction on DRIFT-008 was *"anything we are doing here must be 1000% true to
> remote own doucmentation."* The obvious reading is *read the cap from Remote
> instead of inventing it.* Checked both directions — Remote's `llms.txt` endpoint
> index, and `working-with-expenses.md` fetched live — **Remote has no expense
> policy, cap, limit or threshold concept anywhere.** So the honest conclusion is
> the opposite of importing: Remote is an **Employer of Record**, expense policy
> belongs to the **employer**, and being true to Remote's documentation means
> **never presenting our cap as Remote's**. That is `E-2`, and it is a stronger
> position than "show the provenance", which is what the finding asked for.
>
> ### UC-02's changes are prefixed `E-`
>
> `E-1`…`E-3`. UC-01's are numbered `G-1`…`G-4`, UC-03's lettered `G-A`…`G-C`.
> Three schemes, no overlap — same reason as the fourth pass gave.
>
> | # | Change | Source |
> |---|---|---|
> | **E-1** | **The receipt is read, not merely counted.** The bytes are fetched from Remote and a vision pass **corroborates** figures Remote already holds. It can only refuse; no number it produces reaches the write — `approverEntitlement.js`'s three properties, applied to a model | DRIFT-007 |
> | **E-2** | **The cap names its author** — the **employer's** policy, never Remote's, stated wherever a cap refuses a human, including in the `reason` written back to Remote | DRIFT-008 |
> | **E-3** | **An inferred duplicate is a review; an evidenced duplicate is a block.** A submitter-supplied hash is evidence about a file; a derived fingerprint is an inference from six fields | DRIFT-087 |
>
> **`E-3` must land before or with DRIFT-010's migration, not after it.**
> Provisioning `derived_receipt_hash` is safe in itself and makes the SQL path
> match the in-memory one — which is **strictly more blocking**, and a `blocked`
> verdict has no appeal route anywhere in this system. The remedy for one gap
> widens another, and the window between the two changes is exactly when a real
> employee gets refused their own money.
>
> **Two findings closed as `nothing to build`, and that state is new.** UC-01's
> one closed finding was closed *by* that pass. UC-02's two were closed months ago
> by the commits that fixed them — and both were **verified against the tree in
> this pass rather than accepted from the finding**, because a stale "already
> fixed" is exactly what DRIFT-001 turned out to be.
>
> ### `UC-02-acceptance.md` §18 — the register's first BUILD QUEUE
>
> **This is the pattern for the other eight contracts.** Seven ordered steps,
> each naming its files, its tests and its done-criterion; a *what must NOT
> change* list for the things a builder would reasonably take for tidy-ups; and
> one open question it deliberately does **not** answer for itself — how the
> vision pass is ported to an n8n Code node, which cannot fetch bytes and call a
> model the way the Node path can. Three options, their consequences, and a
> recommendation; the option named as the one to refuse is *"graph skips
> extraction, Node path does it"*, because that is DRIFT-085's defect on UC-01 in
> a use case that moves money.
>
> **The ordering is load-bearing in two places** — `E-3` before DRIFT-010's
> migration, and the vision **cost harness** before the vision model.
>
> That contract's §4–§16 now describe the **decided target**, with every
> not-yet-true sentence tagged `[E-1]`/`[E-2]`/`[E-3]` so a reader can tell a
> description from a promise. `docs/use-cases/UC-02.md` is annotated the same way
> but its **status rows were deliberately not flipped** — the vision row moves to
> *Built* only when Step 6 lands. Written up in `docs/BUILD-LOG.md` §3.81, which
> is also the first mention this register has ever had in that log.

---

> ## Sixth pass, 2026-08-21 — the decision session. UC-04 is now decided
>
> All five UC-04 findings (`DRIFT-017`…`DRIFT-021`) carry a disposition. **Five
> new findings were opened** — `DRIFT-089`…`DRIFT-093` — and **not one came from
> reading more code.** Three came from fetching **Remote's own OpenAPI** in order
> to honour DRIFT-017; two came from following a disposition far enough to see
> what it did not cover. That is the same pattern the fifth pass recorded, now
> twice in a row: **the productive move is to check the disposition against the
> product, not against the source tree.**
>
> ### Remote's schema corrected this register in both directions
>
> `get_v1_work-authorization-requests_id.md` and its `patch_…` sibling, fetched
> live. Four results, and the balance is the point:
>
> 1. **A factor was VINDICATED.** `will_negotiate_or_sign_contracts` is Remote's
>    own field, with Remote's own note — *"This may affect the type of work
>    authorization required."* One of the seven factors is literally theirs,
>    independently justified. Recorded because a register that only ever reports
>    faults teaches its reader to distrust everything equally.
> 2. **A finding was UNDERSTATED.** DRIFT-017 said the document check was
>    *"replaced by a declared `visaType`"*. There is **no visa field and no permit
>    field on the object at all** — what Remote carries is `travel_document_number`,
>    a **passport** number. `visaType` replaced nothing; it is ours entirely.
> 3. **A section was WRONG.** §15 promised an authorisation the API cannot
>    produce: **neither object carries a file, URL or document field**, not even
>    the travel letter. The terminal state is a **status**. Corrected in this
>    revision, and opened as DRIFT-093 so the correction is not later mistaken for
>    something always understood.
> 4. **A control was CONFIRMED CORRECT.** `DeclinedWorkAuthozation` requires
>    `["status", "reason"]` — Remote's API stating that a refusal must carry one —
>    and `src/uc04/workflow.js` already honours it, with a fallback that invents no
>    rationale.
>
> ### UC-04's changes are prefixed `W-`
>
> `W-1`…`W-10`. UC-01's are numbered `G-1…4`, UC-03's lettered `G-A…C`, UC-02's
> prefixed `E-1…3`. **Four schemes, no overlap** — same reason the fourth pass
> gave, and the hazard is real (`CLAUDE.md` §7 item 20: two registers both
> numbering findings `C-N`, with code citing both).
>
> | # | Change | Source |
> |---|---|---|
> | **W-1** | **A `business_visa` to the US stops blocking outright** and escalates. The B-1 *is* the business visa; USCIS lists permitted activities *"including, but not limited to"*, and the real prohibition is *"local 'employment' or 'labor for hire'"* — activity and payer, not visa status. **A live false refusal today** | C-26 |
> | **W-2** | **An approval re-checks the dates** and refuses by its own name | DRIFT-020 |
> | **W-3** | **`travel_document_number` captured, read by no gate** | DRIFT-092 |
> | **W-4** | **A new employee-facing surface** — the Request Hub stand-in | DRIFT-018, -089 |
> | **W-5** | The admin form **relabelled as the employer's assessment** | DRIFT-018 |
> | **W-6** · **W-7** · **W-8** | Three statements of limit: visa **self-declared**; the treaty screen is a **known-gap list**; travel history is **supplied, not retrieved** | DRIFT-017, -090 |
> | **W-9** | An escalation **names** the UC-07/UC-08 finding. No route built | DRIFT-021 |
> | **W-10** | **One spelling** of the escalation team, sourced not retyped | §12/§14 |
>
> **`W-1` is the only change in either build queue so far that LOOSENS a control**,
> and §18 requires its **positive test to lead**. Three defects in this
> repository's history were invisible because a gate that cannot fire and a gate
> being careful are indistinguishable from outside; a negative-only suite passes
> whether `W-1` lands correctly, lands inverted, or does not land at all.
>
> ### The employee UI is the owner's call, and it has a constraint
>
> *"for demo sake, let there be employee ui, and separate employee or admin ui."*
> The obstacle is that `src/remote/mockServer.js:3720` **refuses**
> `POST /v1/work-authorization-requests` — a fabricated create was removed from
> there, and the fixtures had been written to agree with it. The resolution is a
> distinction Remote's own product makes: **the Request Hub genuinely does create
> these; the partner API does not.** So the stand-in seeds **in-process**, and the
> wire route keeps answering Remote's bare `"Not Found"`, asserted **structurally**.
> A stand-in that blurred those two would be the fabricated `POST` in a demo's
> clothes.
>
> **It also depends on a decision already taken** — `G-A` (DRIFT-078, third pass)
> accepts an employee filing for themselves. Without it the new surface would file
> and then be refused by our own identity gate.
>
> ### `UC-04-acceptance.md` §18 — the second build queue
>
> Nine steps plus a Step 0 of **three measurements taken before any code**, two of
> which can change the plan: whether the live Sandbox holds **any** `pending`
> work-authorization requests (if not, the one-click path cannot be shown against
> the real Sandbox at all), and how many US business-visa cases were **already
> wrongly blocked**. It carries a *what must NOT change* list of eight, and one
> **open question it deliberately does not answer** — DRIFT-089's remaining three
> rows, where the option named to refuse is writing `cancelled`, because
> attributing our refusal to the employee is worse than the silence it replaces.
>
> ## Seventh pass, 2026-08-21 — the decision session. UC-05 is now decided
>
> All nine UC-05 findings — `DRIFT-022`…`DRIFT-026` and the overflow block
> `DRIFT-063`…`DRIFT-066` — carry a disposition. **Four new findings were
> opened**, `DRIFT-094`…`DRIFT-097`, and **not one came from reading more code**:
> three came from fetching Remote's own OpenAPI for the offboarding/resignation
> family, and the fourth came from a schema *shape* prompting a read of a function
> nobody had reason to open. Same pattern as the fifth and sixth passes.
>
> ### This pass falsified the use case's business case, not just its details
>
> DRIFT-063 already recorded that `/v1/resignations` exists after two documents
> said it did not. It rated its fourth claim — that §0's business case might be
> aimed at a gap Remote partly fills — at MEDIUM, wanting a live value to settle
> it. **The value was not needed; the field description settles it.**
> `days_of_notice` is *"the number of calendar days of notice required based on
> the contract terms and local labor laws"*, and `proposed_last_day` is
> *"calculated based on the notice period and local labor laws."* §0's *"Remote's
> own platform performs no computation of what the legally correct notice period
> should be — that gap is the actual value-add"* is **false**.
>
> **What replaces it is a better use case, and the owner took it.** `days_of_notice`
> blends **contract** and **statute**, and Remote does not say which prevails. A
> contract can name 30 days where the statute requires 60. So UC-05 computes an
> independent statute-derived figure, holds it against Remote's blended one, and
> the **disagreement** is the product — surfaced before anyone answers
> `accepts_proposed_notice`. `[N-5]`, and the absence of that step is DRIFT-095.
>
> ### Two owner questions, and the answers are both negatives worth keeping
>
> **"Do we have a contract for the demo? Who creates one?"** — nobody, and none is
> fetched. There is a contract-document *create* for **contractors only** and no
> read route for an EOR employment agreement; whether `contract_details` carries a
> notice-period property is `[UNKNOWN]` and was **dropped as a measurement** when
> the owner chose to read `days_of_notice` instead. The line that must hold: **a
> contract document must never be manufactured and presented as Remote data** —
> for a US resignation the contract *is* the operative source, so a fabricated one
> fabricates the answer rather than the fixture.
>
> **"How do we get the labour law for the US?"** — **there is nothing further to
> retrieve, and that is the finding.** No federal statute imposes notice on a
> resigning employee; WARN runs the other way; state mini-WARN statutes are
> employer-side too. `[INFERRED — argument from scope]` is therefore the *correct*
> tag, not a weak one: a negative cannot be upgraded to `[CONFIRMED]` by fetching
> one more document. The decision is to **bound the claim** — federal only, state
> law not surveyed, the contract governs — and change no behaviour. **The US keeps
> refusing to compute.**
>
> ### Canada is the sharpest live defect this register has found on UC-05
>
> Three of the four demo countries hold retrieved statute (NL, PT, and the US as a
> **sourced absence**). Canada does not — `basis: "customary"`, brackets of
> `0 / 7 / 14` days, no `evidence` tag, and it is **the only one of the four that
> reaches a signature**. D-04 puts Canadian notice entirely on the *employer*,
> exactly as WARN does, so Canada and the US are the same fact on the employee
> side and now get the same treatment `[N-7]`.
>
> **C-30's stated reason for deferring it has expired**, which is why this is now
> affordable: it deferred partly because changing a live demo country would break
> scenarios being built in parallel. NL joined the table on 2026-08-20 and reaches
> `prepared_for_signoff`, so NL and PT carry the positive path and the demo set
> loses nothing when Canada stops computing.
>
> ### `UC-05-acceptance.md` §18 — the third build queue
>
> **Eighteen changes prefixed `N-1`…`N-18`, in nine steps, behind a Step 0 of two
> measurements.** `M-1` distinguishes a scope `403` from an absent route — the
> exact conflation that produced DRIFT-063 — and `M-2` asks whether the Sandbox
> holds any resignation at all; if it holds none, the stand-in surfaces become
> load-bearing and `[N-3]`'s done-criterion drops from *proven live* to *proven
> against the mock and honestly labelled*.
>
> **The queue was seventeen items when it was agreed and is eighteen now.**
> `N-18` was opened by writing the contract: Remote models a resignation *before*
> the start date as a separate variant with no notice arithmetic at all, which
> prompted a read of `tenureMonthsBetween()` — it ends `Math.max(0, months)`, so a
> future start date **clamps to zero and selects the shortest statutory bracket**
> rather than refusing. Recorded as growth rather than folded in silently.
>
> **Five schemes now, none corresponding** — `G-1…4` (UC-01), `G-A…C` (UC-03),
> `E-1…3` (UC-02), `W-1…10` (UC-04), `N-1…18` (UC-05). Same reason the fourth pass
> gave, and §7 item 20 of `CLAUDE.md` is the evidence for it.
>
> **No cross-pass dependency this time**, unlike UC-04's `W-4` needing UC-03's
> `G-A`. Nothing in UC-05's queue waits on another use case's decision.

> ## Ninth pass, 2026-08-21 — the decision session. UC-07 is now decided
>
> All eight UC-07 findings — `DRIFT-032`…`DRIFT-035` and the overflow set
> `DRIFT-070`…`DRIFT-073` — carry a disposition. **Four new findings were
> opened**, `DRIFT-102`…`DRIFT-105`, and three of the four came from **the owner's
> own questions**, as did three of the eighth pass's. **UC-09 is now the only use
> case with no decision pass at all.**
>
> **This was the first pass to begin on a checked foundation.** UC-06's `[A-15]`
> (**DRIFT-099**) required that it not start until `00-FOUNDATION.md`'s
> three-endpoint sentence was re-probed for UC-07's third of it — two of the three
> had already turned out to exist, and **UC-05's entire §0 business case had been
> falsified** because its pass inherited that sentence instead of checking it.
> Probed against Remote's own `llms.txt`: **UC-07's third holds**, zero matches on
> all six terms. Recorded as a **confirmation**, deliberately — a register that
> only ever reports faults teaches its reader to distrust everything equally.
>
> **One word had to be added even so, and it is the pass's sharpest small
> finding.** `docs/INTAKE-RESEARCH.md` §75 records that Remote's *product* has a
> **Country Transfer Service** — a structured, **employer-driven** relocation form
> — while its API publishes nothing. So the true claim is *"no atomic
> country-transfer **API**"*. Dropping the word **API** overstates in Remote's
> disfavour, which is the identical over-reach that made the other two-thirds of
> that sentence wrong. That single row then decided two things **on evidence
> rather than on preference**: that the portal is UC-07's primary intake
> (DRIFT-034), and that the admin, not the employee, is the default filer.
>
> **The finding the owner's question exposed — DRIFT-073 and Q2 together.**
> Asked *"when the specialist reaches a conclusion, what will they now do?
> Nothing? Should the demo not include an aftermath instead of saying no button at
> all, because the employee who filed is expecting feedback"*, the pass found two
> rules being kept by one mechanism:
>
> > **"Nothing may be approved here" and "nobody may ever be told what happened"
> > are two different rules. Only the first is the 🔴 invariant.**
>
> `src/approvalqueue/stuck.js:43-48` is the **only** place in the repository that
> already states the distinction. Everywhere else they are welded together, which
> is why closing the second *reads* like weakening the first. The resolution keeps
> `none_by_design` untouched, adds no approve route, and puts the specialist's
> outcome verbs **on the ticket** rather than on the dossier store — because that
> store's *one write method, zero mutations* property **is** the structural proof,
> and `markReviewed()` would delete the proof in order to record that it worked.
>
> **DRIFT-104 came from a different place and is worth the separate note.** The
> pass set out to decide whether UC-07 may hold a Remote client and read
> `scripts/capture-sandbox.mjs` to see what already existed. The script is real,
> GET-only by construction, and already captures the endpoints needed — and writes
> them to a **gitignored** directory. So the repository's single stated cure for
> its own most expensive defect class has never produced a durable artifact, and
> there is no fallback if the Sandbox expires mid-demo. **Checking a remedy's
> tooling is a source of findings distinct from reading the code the remedy would
> fix.**
>
> **Two ordering constraints in `UC-07-acceptance.md` §18 are easy to get wrong
> and expensive.** `R-1` (the read-only façade) must precede `R-6` (the conflict
> gate) — building the gate against the full `RemoteClient` "for now" re-opens the
> parameter the 🔴 guarantee is argued from, **and nothing fails when it does**,
> because the structural test greps for write-method *names*. And `R-16` (extend
> the no-execution assertions) must precede `R-14` (the paperwork generator), for
> the same reason one layer over: the assertion that would catch a payload-shaped
> object has to exist before the thing that could be one.
>
> **`M-3` is the measurement that decides whether the conflict gate can be shown
> to work at all.** If no Sandbox employment carries an in-flight amendment or
> offboarding, a marked rung-3/4 fixture becomes load-bearing and its **positive
> test must lead** — `[A-10]`'s rule, restated: *a gate that cannot fire and a
> gate being careful are indistinguishable from outside.* This repository has paid
> for that shape three times, and every one of them passed the full suite.
>
> **Sixth scheme, none corresponding** — `R-1…27` joins `G-1…4` (UC-01),
> `G-A…C` (UC-03), `E-1…3` (UC-02), `W-1…10` (UC-04), `N-1…18` (UC-05) and
> `A-1…32` (UC-06). Seven in total. §7 item 20 of `CLAUDE.md` is the evidence.
>
> **One cross-pass boundary, stated so it is not crossed:** DRIFT-034's reframing
> was **deliberately not generalised to UC-08**, which is the same tier with the
> same absent Remote surface and to which the same argument appears to apply.
> Deciding it here would be deciding UC-08's pass without running it — the exact
> error that put three endpoints in one sentence and got two of them wrong. It is
> `G4` in `qa/HUMAN-DECISIONS-REQUIRED.md`.

> ## Eighth pass, 2026-08-21 — the decision session. UC-06 is now decided
>
> All seven UC-06 findings — `DRIFT-027`…`DRIFT-031` and the overflow pair
> `DRIFT-061`/`DRIFT-062` — carry a disposition. **Four new findings were
> opened**, `DRIFT-098`…`DRIFT-101`, and three of the four came from **the owner's
> own questions** rather than from reading more code — which is a source no
> previous pass has had.
>
> **This pass produced a project-wide rule, not just decisions.** Asked how to stop
> fixture questions being re-argued one at a time, the owner stated the doctrine
> this repository had been following in practice for weeks without writing down:
> *"remote's documentation is our source of truth, and whatever their sandbox does
> not allow us to do, we replicate with our own Remote UI sandboxish. We try to get
> relevant data from the sandbox to help us out, if no relevant data is available
> we fabricate."* It is now **the substitution ladder** — four rungs, two
> non-negotiable constraints (a substituted fact is always self-identifying; money
> is never fabricated) and one honesty rule (a real value always wins). Written in
> `contracts/UC-06-acceptance.md` §18a and **repeated verbatim** in `CLAUDE.md` §3,
> `docs/00-FOUNDATION.md` §2a and `docs/WHY-THIS-SHAPE.md` §14 — repeated rather
> than cross-referenced, because a rule that lives in one file is a rule the next
> session does not find.
>
> **The finding the owner found, which no pass had:** *"How can the customer admin
> both request and approve? Is that not wrong?"* — **DRIFT-098**. `requester` is
> captured and persisted and never compared to either approver, so the person who
> typed the salary change can sign the box confirming they typed it. The exemption
> is deliberate and is argued in `dualApprovalPolicy.js:13-29` — **a code comment,
> in the file that implements the control, and nowhere in the ADR that exists to
> argue exactly this.** UC-01 has `self_approval`; UC-09 has requester ≠ approver ≠
> payment_releaser. UC-06 is the only one of the three that exempts itself.
> Decided: slot 1 becomes the **employer's signature**, Remote's own vocabulary
> (`awaiting_employer_signature`), and the requester is refused by name.
>
> **A word that had confused two documents.** "Customer admin" is **employer-side**
> — "customer" means *Remote's* customer. `UC-06.md:53` gives it away by contrast:
> *"Customer Admin + **Remote** Payroll specialist"*, where only the second is
> qualified. So dual control here is cross-organisational either way; what the
> reframe changes is whether the employer side is represented by the requester or
> by an independent signatory.
>
> **DRIFT-027 was decided (a) — wire the `automatable` pre-check — and the
> disposition is longer than the finding, because taking (a) literally ships a
> branch that cannot fire.** The one live capture answers `false` and
> `mockServer.js:3222` hard-codes `false`. That is the shape this repository has
> paid for three times (UC-03's alpha-3 comparison, UC-03's unnameable sanctions
> codes, UC-04's employer permission), and each time the dead gate looked like
> caution. So the fabricated `true` fixture and its **positive-test-first** rule are
> part of the same unit of work, not a follow-up — and the fabrication is
> authorised by rung 4 of the ladder rather than by exception.
>
> **DRIFT-028's tail is the most transferable thing in the pass.**
> `00-FOUNDATION.md` names three endpoints as not existing, in one sentence, twice.
> **Two of the three now demonstrably exist** — UC-06's (probed 2026-08-18) and
> UC-05's (proven 2026-08-21, corrected by that pass's `N-1`). The third, UC-07's
> atomic country-transfer endpoint, **has never been re-checked**, and UC-07 has no
> decision pass yet. UC-05's §0 business case was *false* precisely because a pass
> inherited an unchecked absence, so **DRIFT-099 exists to stop that happening
> twice** and `[A-15]` puts the re-probe before UC-07's pass rather than during it.
>
> **DRIFT-030 gained a fact that was recorded nowhere**, from the owner: *"i
> remember telling claude to fabricate or draw from old cycles, so that at least we
> would have something to demo."* That instruction now has a date and an owner,
> which converts `src/remotebridge/payrollProjection.js` from something a reviewer
> could read as a fudge into a decision. The build came out stronger than the
> instruction — cadence continued, one-offs never continued, every row marked, and
> `total_payroll_cost` left null because inventing money is forbidden outright.
>
> **DRIFT-061 is the sharpest of the seven and the least visible.** UC-06 holds a
> strong opinion about the payroll lock at *decision* time and none at the moment
> the write happens. The deadline is already computed, already stored on the row,
> already surfaced to the specialist, already used by the priority engine — and is
> the one piece of state the freshness re-check does not consult. Decided: re-run
> the cutoff against a re-read calendar, refuse with a **distinct** code
> (`cutoff_lock_passed_since_decision` — *you asked too late* and *we took too
> long* are different conversations), release the claim, and never silently
> re-draft against the next cycle.
>
> **Six schemes now, none corresponding** — `G-1…4` (UC-01), `G-A…C` (UC-03),
> `E-1…3` (UC-02), `W-1…10` (UC-04), `N-1…18` (UC-05), **`A-1…32` (UC-06)**.
> §7 item 20 of `CLAUDE.md` is the evidence for why.
>
> **One cross-pass dependency:** `[A-15]` must land before UC-07's decision pass.
> And one internal ordering that is easy to get wrong — `[A-1]` (the control) must
> precede `[A-2]` (the rename), because migrating a name inside a control change
> leaves the control down for the duration.

---

Findings numbered `DRIFT-001`…`DRIFT-039`, `DRIFT-049`…`DRIFT-054`, the
overflow block `DRIFT-061`…`DRIFT-066`, the second-pass block
`DRIFT-074`…`DRIFT-077`, the third-pass block `DRIFT-078`…`DRIFT-083`, the
fourth-pass findings `DRIFT-085`/`DRIFT-086`, the fifth-pass findings
`DRIFT-087`/`DRIFT-088`, the sixth-pass block `DRIFT-089`…`DRIFT-093` and the
eleventh-pass block `DRIFT-110`…`DRIFT-117` live in
full in the nine acceptance contracts, under each contract's §17 (and §17b, where
a decision session opened new ones). This file is the index, plus the
**cross-cutting findings** (`DRIFT-040`…`DRIFT-048`) that belong to no single use
case and are therefore written out in full here.

**One block is the exception, and looking for it in a contract will fail.** The
registration block `DRIFT-118`…`DRIFT-121` lives in
**`handoffs/UC-01/0001-builder-to-validator.md` §10**, not in
`contracts/UC-01-acceptance.md` §17 — that contract is **frozen** for the duration
of the UC-01 negotiation, and the four findings were opened *by* the negotiation.
Three came from the Builder pass and one from the Validator's second pass; each is
pinned to a new verification criterion (**VC-28**…**VC-31**) in the same document.

**On the overflow block.** Contracts were written in parallel, each with an
allocated range. Four use cases needed more findings than their range held and
took numbers above 060 under the brief's overflow rule — and, unable to see each
other's files, three of them collided. Resolved by arrival order: **UC-06 kept
061–062**, **UC-05 moved to 064–066**, **UC-08 took 067–069**, **UC-07 moved to
070–073**. Each reassignment is recorded inside the contract it happened to,
rather than applied silently — a numbering scheme that quietly reassigns is the
hazard DRIFT-044 describes one level up. **063 was briefly reserved as unused and
is now UC-05's**, claimed on a second pass after the collision had been resolved —
and it turned out to be the single most consequential finding of the whole
reconciliation, which is a reason to check a "deliberately empty" slot rather than
trust it.

**The overflow itself is a finding about this pass, not a clerical note.** All
five parallel contracts needed more than their five allocated numbers.
The allocation was set by the lead from four use cases written by hand, and it
was too small for the medium- and high-tier ones — which is itself evidence that
drift concentrates where the stakes do.

> ## Tenth pass, 2026-08-21 — the decision session. UC-08 is now decided
>
> All seven UC-08 findings — `DRIFT-036`…`DRIFT-039` and the overflow set
> `DRIFT-067`…`DRIFT-069` — carry a disposition. **Four new findings were
> opened**, `DRIFT-106`…`DRIFT-109`, and two long-standing cross-UC findings were
> **resolved** rather than deferred (`DRIFT-011`, `DRIFT-021`). **UC-09 remains
> the only use case with no decision pass at all.**
>
> **The four new findings came from a source this register had not used: checking
> the SOURCES a specification names, rather than the code that consumes them.**
> Every previous pass compared the contract to `src/`. This one asked what
> Remote's API actually publishes for the facts UC-08's spec assumes, and the two
> answers were opposite and both wrong in the file:
>
> - **DRIFT-106** — the source §5 names *cannot work*. `Timeoff` has **no country
>   and no location property of any kind** (`timezone` is an IANA identifier whose
>   own example is `Etc/UTC`), a workation is someone *working* so it produces no
>   time-off record, and custom fields are `{custom_field_id, name, type, value}`
>   with **no dates**. §13 task 4 has therefore been a standing work order to
>   build something impossible.
> - **DRIFT-107** — a source that *does* work exists and is better than the one
>   specified. `GET /v1/travel-letter-requests` and
>   `GET /v1/work-authorization-requests`, both filterable by `employment_id`,
>   both carrying `destination_country`, `travel_date_start`, `travel_date_end`
>   and `status`: **dated, located, employer-approved.** `restClient.js:1597`
>   already implements one of them and the mock already serves both. Only UC-08
>   calls neither.
>
> **DRIFT-039 is the finding that both of these correct.** It was right that the
> count is self-declared and right that provenance is missing — and it deferred to
> a source that cannot produce the figure. **A finding can be correct about a gap
> and wrong about the remedy**, and only checking the remedy's source finds it.
>
> **The cross-routing question was answered the same way UC-07's was, arrived at
> independently.** No edge from UC-03, UC-04 or UC-07 into UC-08; UC-08 **reads
> the records they cause**. An edge lets a 🟢 keyword classifier open a 🔴 tax
> case on a phrase; a read is Remote's own system of record and reaches trips that
> went through no use case at all. **v1's Track F gate is refused on merit** and is
> now invariant 24: a 🔴 use case may hand another a *fact*, never a *verdict*.
>
> **DRIFT-109 is the second consecutive pass to find "two rules kept by one
> mechanism".** *Nothing may be approved here* and *nobody may ever be told* were
> both satisfied by the same absence, and only the first is the 🔴 invariant.
> UC-07's pass found the same shape one week earlier
> (`docs/WHY-THIS-SHAPE.md` §16), and **both use cases are blocked on the same
> single change** — `TICKETABLE_TYPES`. UC-08's `T-13` and UC-07's `R-24`
> prerequisite are one piece of work; building it twice would give one hand-off
> two vocabularies.
>
> **The owner's questions produced the sharpest disposition again, third pass
> running.** *"I thought it was the specialist that gets tax advice, not the
> customer — when an employee makes a request, what do they get as an output after
> the specialist has finished?"* The answer is **two artifacts for two readers**,
> and the object built to be the employee's — `customerFacingAcknowledgement` — is
> composed, disclaimed, tested and **referenced by no surface anywhere**, so §11's
> *"disclaimer coverage 100%"* is satisfied **vacuously**.
>
> **The build queue is `T-1`…`T-28`, the sixth.** **Eight schemes now, none
> corresponding** — `G-1…4` (UC-01), `G-A…C` (UC-03), `E-1…3` (UC-02), `W-1…10`
> (UC-04), `N-1…18` (UC-05), `A-1…32` (UC-06), `R-1…27` (UC-07), `T-1…28` (UC-08).
> §7 item 20 of `CLAUDE.md` is the evidence.
>
> **Step 0 is three measurements, and two of them can change the plan.** `M-1`:
> do the two collections hold **any** rows? Both were **`200` with
> `total_count: 0`** at capture, so the read can ship correct, honest and
> returning nothing — *a gate that cannot fire and a gate being careful are
> indistinguishable from outside*, third instance after UC-03's dead gates and
> UC-06's `A-10`. `M-2`: what does `GET /v1/timeoff` actually return? `M-3`: does
> any Sandbox employment carry travel dates at all?
>
> **One cross-pass dependency, and one prerequisite inversion.** `T-13` is UC-07's
> `R-24` prerequisite — build once. And `T-23`/`T-24` (identity marked, owner
> reads scoped) come **before** `T-2` (the Remote read): reading another person's
> travel history on an unverified id is a different exposure from labelling a
> dossier with one.

---

> ## Eleventh pass, 2026-08-21 — the decision session. UC-09 is now decided, and every use case has now had one
>
> All six UC-09 findings (`DRIFT-049`…`DRIFT-054`) carry a disposition. **Eight
> new findings were opened**, `DRIFT-110`…`DRIFT-117` — the largest single-pass
> block in this register. **Nine of nine use cases are now decided; nine build
> queues exist.**
>
> **This pass asked UC-08's question of a use case that moves real money, and
> three answers came back INVERTED rather than merely corrected.** The endpoints
> the spec was unsure about all exist — five `incentive.*` webhooks plus full
> CRUD — but the state machine it assumed they implement does not: Remote's
> `pending` means *"not yet associated to a payroll cycle"*, so **a created
> incentive is already going to be paid** and there is no approval state to
> transition out of. The control DRIFT-049 declared absent exists, at a path the
> spec does **not** name. And the control the spec asks us to build,
> gross-to-net, is one Remote's own `AmountTaxType` says we must not: *"Remote
> will gross this up."*
>
> **The sharpest of the eight is about this register's own method.**
> `DRIFT-110`: ADR 0005 gained a segregation clause during the **eighth** pass
> (UC-06) that asserts *"UC-09 holds it in its strongest form"* and cites the
> file — and UC-09 does not hold it, which is DRIFT-050, open since the first
> pass. The UC-06 pass verified the use case it was dispositioning and took the
> others on trust because UC-09 was the stricter-looking case. **A correction can
> propagate a false claim**, and this is the first time this register has caught
> one of its own passes doing it. `docs/WHY-THIS-SHAPE.md` §18.
>
> **`DRIFT-111` is the fourth `[CONFIRMED]` endpoint that does not exist as
> written** — after UC-05's resignation endpoint, UC-06's `automatable`
> pre-check and UC-07's country transfer. The first three were declared **absent**
> and existed; this one was declared **confirmed** and does not. Both directions
> of the decay rule are now represented in the evidence.
>
> **Two findings came from reading `src/uc09/` for what the other six implied
> should be there**, and neither is subtle once looked for: **nothing in
> `src/uc09/` writes to Zendesk at all** (`DRIFT-115`), so every outcome on the
> money path — approved, denied, executed, in doubt — is silent to the person who
> asked; and **`expected_payout_date`, which Remote answers on the write we
> already make, is read nowhere** (`DRIFT-116`).
>
> **The decision the owner took overturns a document.** DRIFT-050 reading (A):
> the filer may sign the `requester` slot and **no other**. Floor of two
> signatures unchanged. ADR 0005's literal wording — and UC-06's `[A-2]` reading
> of it — would have made the minimum three humans; (A) was chosen and the ADR is
> corrected in the same unit of work.
>
> **Nine schemes now, none corresponding** — `G-1…4` (UC-01), `G-A…C` (UC-03),
> `E-1…3` (UC-02), `W-1…10` (UC-04), `N-1…18` (UC-05), `A-1…32` (UC-06),
> `R-1…27` (UC-07), `T-1…28` (UC-08), **`P-1…34` (UC-09)**.
>
> **Step 0 is three measurements and one of them can invalidate a sentence this
> repository already prints.** `M-1`: does the Sandbox populate
> `expected_payout_date`? `M-2`: does `GET /v1/company-managers` hold **any**
> rows — because `P-16` built against an empty collection is the dead-gate shape
> for the fourth time. `M-3`: two identical `POST`s under one `Idempotency-Key`
> — one incentive or two? **Remote documents that header nowhere** (`DRIFT-113`),
> and the no-double-payment claim rests on it.
>
> **Two orderings that are expensive to get wrong.** `P-24` before `P-23`:
> `findIntegrityBreaches()`'s premise is *"high-tier must have no execution
> path"*, which is **false for the one 🔴 that has one**, so routing UC-09 rows
> into metrics naively manufactures breaches on correct payments. And `P-9`
> before `P-15`: the reconciliation read has nothing to search on until the
> adjustment id is in Remote's `note`.
>
> **One item outranks its own queue.** `P-2`'s ADR correction lands even if `P-1`
> slips — a gap is one thing, a gap plus a written assurance that there is no gap
> is another, and that sentence is being read now.

---

> ## Backlog session, 2026-08-21 — the cross-cutting findings, and the routing decision
>
> Not a use-case pass. After UC-09 closed the last of the nine, the owner
> dispositioned the **cross-cutting** backlog: **DRIFT-003, 040, 041, 044, 045,
> 046, 047, 048 and 077**, plus §F's routing question and nineteen entries in
> `HUMAN-DECISIONS-REQUIRED.md` (thirty answered → forty-seven).
>
> **These nine survived nine use-case passes because they belong to no use case.**
> Each pass read one contract and dispositioned that contract's findings; a
> finding filed under *cross-cutting* had no pass that owned it. That is the exact
> failure mode a cross-cutting register exists to catch, and it took a session
> whose subject was *nothing in particular* to catch it.
>
> **§F's routing decision is the largest single answer in this register, and it
> refuses all five routes.** Remote relates its request objects **by
> `employment_id` and by nothing else** — no endpoint turns one request into
> another, no workflow edge, no state machine spans two resources. So use cases
> **connect by reading, never by invoking**, which dissolves all three hazards this
> register had listed for any future route rather than mitigating them, and keeps a
> 🟢 keyword classifier from ever opening a 🔴 case. It also draws the distinction
> that had made §F read as five missing features: **intake classification is not
> runtime routing** — *"this request is actually a work-authorization request"* is
> a decision at the door and stays; *"this decided case should cause another
> case"* is origination and is refused.
>
> **DRIFT-041's answer was changed by Remote's docs, not confirmed by them.** The
> instruction was *"add a clock to everything."* Remote's entire documentation
> index yields **two matches for `expired` and two for `reminder`**, one of them a
> real construct — `employment.probation.period_ending_reminder_sent`, which
> **fires ahead of a boundary and changes no state.** Remote models **no approval
> expiry at all.** So: **age and warn everywhere, lapse nowhere**, and nothing may
> become approved **or denied** because time passed — on the money path an
> auto-denial is as much an unowned decision as an auto-approval.
>
> **And DRIFT-047 gained the sentence it most needed from the use case that moves
> money:** *an event existing is not a reason to subscribe it as a trigger.*
> UC-09's five `incentive.*` events are real, and subscribing them as an intake
> would produce two payments, because `pending` means *already scheduled to be
> paid*. They are a bypass detector instead.
>
> **Still open and correctly so: `F3`** — a second employer-side identity is a
> provisioning act only the owner can perform, because a fabricated approver
> identity is the one kind of fabrication the substitution ladder does not cover.

---

> ## Registration pass, 2026-08-21 — four findings from the UC-01 negotiation, `DRIFT-118`…`DRIFT-121`
>
> **Not a decision pass. Nothing here is dispositioned, and nothing in `src/`,
> `test/`, `workflows/` or `zaf-app/` was changed to produce it.** All four are
> `OPEN`. Three were opened by the **UC-01 Builder** pass (commit `2888f13`) and
> the fourth by the **UC-01 Validator** second pass (commit `1ffb7e9`), and none
> of them was written into this register at the time — deliberately. A Builder or
> Validator mid-negotiation editing the shared drift register would be one party
> to a live disagreement writing the minutes, so both passes recorded their
> findings in the handoff and asked the mayor to route the registration as its own
> unit of work. **That restraint is the reason this box exists**, and it is the
> convention to copy: a negotiating role opens findings into its handoff; a
> separate pass registers them.
>
> ### They live somewhere new, and the navigation sentence below now says so
>
> Every previous block lives in an acceptance contract's §17. These four live in
> **`handoffs/UC-01/0001-builder-to-validator.md` §10**, because UC-01's contract
> is **frozen** for the duration of the negotiation and three of the four bear on
> what it says. A reader following a `DRIFT-11x` id into `UC-01-acceptance.md`
> will not find it.
>
> ### Every claim was re-verified against the code, and three were wrong in detail
>
> The registering pass was told not to copy the handoff on trust. It did not, and
> the check paid for itself three times — none of the three changes a finding's
> substance, and all three would have sent a reader to the wrong line:
>
> | Handoff said | Actually |
> |---|---|
> | `src/zendesk/normalizeTicket.js:56` sets `session: null` | **`:53`**. `:56` is the `consentOnRecord: false` hard-code — the neighbouring defect (DRIFT-075), one line down |
> | `identity.js:52` branches on `requesterType` | **`src/shared/identity.js:51`**. There is no `src/uc01/identity.js`; the function is shared by UC-01, UC-02, UC-03 and UC-05 |
> | `audit.js:132` gates persistence on `parentId` | **Correct, exactly.** Recorded because a register that only reports faults teaches its reader to distrust everything equally |
>
> ### One finding got stronger, and it got stronger by measurement
>
> **DRIFT-120 was conditional and is now settled.** The Builder could not read the
> live table and wrote the honest conditional — *"if the live table matches the
> insert, G-3 needs a migration, not a lookup"* (`M-3`). **Read live 2026-08-21:
> `consent_records` holds exactly the seven columns `caseStore.js` inserts and no
> others.** So the condition is met and the consequent is now a fact: **G-3 needs
> a migration.** A pending measurement that nobody takes silently becomes a
> permanent hedge; this one cost one query.
>
> ### And one reproduced harder than it was filed
>
> DRIFT-118 was filed as *the two normalizers derive different identities*. Driven
> through both paths on **one** Zendesk ticket and **one** employment record, they
> do not merely differ — they reach **opposite terminal decisions**: the Node path
> `escalate / identity_not_verified`, the live path `auto_resolve /
> all_gates_passed`. The divergence is settled at **gate 1**, the first gate
> `evaluate()` runs, so no later gate can mask it and no negative test can see it.
> That is this repository's most expensive failure shape — *a path that cannot
> succeed is indistinguishable from a path being careful* — appearing for at least
> the fourth time, and the first time on the **reference** implementation rather
> than on a port of it.
>
> ### The one thing this pass deliberately did not establish
>
> DRIFT-121's mechanism is in **`src/shared/audit.js`**, which all nine use cases
> call, and **all thirteen `logTraceStep()` call sites in `src/` are parentless** —
> so every one of them depends on an `audit_log` row arriving later to bind it.
> Whether any use case **other than UC-01** has an early return between its trace
> and its audit write **was not established here**, and a survey is owed before
> anyone calls the fix UC-01's. Registration is not diagnosis, and an unchecked
> "probably only UC-01" is the kind of inherited absence that falsified UC-05's
> entire §0 business case (DRIFT-063).

---

Recommendation codes: **KEEP_CURRENT** · **RESTORE_ORIGINAL** · **RECONCILE** ·
**HUMAN_DECISION_REQUIRED** (collected as questions in
[`HUMAN-DECISIONS-REQUIRED.md`](https://github.com/KindnessofGod/remote-cx-automation) <!-- decision register kept private -->).

A row reading **✅ DECIDED** carries its disposition in the same cell, and the
argument behind it in the contract's own §17. **Read the trailing clause, not the
tick:** *not yet built* means the drift is still live in the code and a fresh
session will still meet it. Only *done* / *nothing to build* means the register and
the repository agree.

**Count: 116 findings. 95 decided, 8 of them fully closed, 87 decided and awaiting
implementation. 21 open.** One row added since the previous count — `DRIFT-122`
(bead `rca-jsv`, 2026-08-22), recording a decision (F-6/`rca-1rx`) that was
already ruled and built, so it lands `✅ DECIDED · BUILT · VERIFIED` and moves
straight to the fully-closed column; nothing else in the table changed. Every
other figure here is carried forward from the 2026-08-22 recount below, not
re-derived — the previous recount (`grep` for rows carrying the ✅/⏳ markers, per
the same methodology as the 2026-08-21 count below) still applies to the other
115 rows, and rca-uim closed DRIFT-086, moving it from open to fully closed and
nothing else.

> **Recounted, not incremented, when the registration block landed.** The four
> `DRIFT-118`…`DRIFT-121` rows are all `OPEN`, so the arithmetic happens to agree
> with adding four — **and it was still recounted from the table**, because the
> headline immediately below records what happens when a count is maintained by
> addition instead. The decided figure is unchanged at 93: a registration pass
> disposes of nothing.

> **This headline had drifted from its own table, and the correction is kept
> visible rather than quietly applied.** Immediately before the backlog session it
> read *"68 decided, 43 open"* while **84 rows already carried a disposition** — an
> understatement of sixteen. The cause is mechanical and worth knowing: each pass
> incremented the headline by the number of findings **it** dispositioned, and
> never by the rows other passes had marked — including the findings a pass
> *opened* and dispositioned in the same sitting, which are recorded as
> `DECIDED · NOT YET BUILT` in the table and were being counted as open in the
> headline.
>
> **It drifted in the safe direction, which is why nobody caught it**: a register
> that understates how much has been decided invites the reading *"so almost
> nothing has been settled"*, which is wrong but harmless. The same mechanism
> pointing the other way would have been a status file claiming decisions it did
> not hold. **A count that is carried forward rather than measured is not a count**
> — the same lesson `CLAUDE.md` §4 records for the test count, which moved twice
> while one sync was being written. Recount from the table; do not add to the
> previous headline.

The last movement was the **backlog session of 2026-08-21**, which followed
UC-09's pass and dispositioned nine long-standing **cross-cutting** findings in one
sitting — DRIFT-003, 040, 041, 044, 045, 046, 047, 048 and 077 — plus §F's routing
decision and nineteen entries in `HUMAN-DECISIONS-REQUIRED.md`. Those nine had
survived every use-case pass precisely **because** they belong to no single use
case, which is the failure mode a cross-cutting register exists to catch and had
not been catching.

**The twenty-two that remain open** are DRIFT-004, 042, 043, 084…097, 099 and the
registration block **118…121** — almost all of them opened by the decision
sessions themselves, or by the UC-01 negotiation, and deliberately left open with
their reasoning attached.
They were opened by the decision
sessions themselves rather than by the original reconciliation, which is why the
open set skews so heavily to the high numbers.

**All nine use cases are now decided, and as of 2026-08-21 all nine have a build
queue.** The eleventh pass (UC-09) was the last decision pass; UC-01's and UC-03's
§18 were written afterwards, on 2026-08-21, and were the last two missing. Their
gate changes keep their existing names — `G-1`…`G-4` and `G-A`…`G-C` — because
those are cited from three files each and renaming them would break every citation
for no gain; **their build items are prefixed `V-` and `L-`**, a tenth and
eleventh scheme corresponding to none of the other nine.

**Writing those two queues produced findings, which is the argument for writing
them at all rather than leaving the dispositions to be read in prose:**

- **UC-01's Step 3 breaks the only end-to-end demo this repository has ever run
  in production.** Tickets #3–#6 all used Alexandre Tremblay —
  `contract_type: contractor_of_record` — so once `G-1` lands that request
  correctly **refuses**, and once `G-2` lands the other listed demo employee
  (Alex Morgan, EOR/USA) asking for the plain standard letter is correctly
  **deflected**. The auto-issue demo needs a third shape, and the queue requires
  it in the same unit of work as `G-2` rather than after.
- **DRIFT-014's line numbers are stale, and re-deriving them changed the plan.**
  The disposition names *"four strings in `policyEngine.js` (444, 468, 667,
  735)"*; grepped 2026-08-21 the real set is **six** (`:21`, `:390`, `:630`,
  `:654`, `:954`, `:1027`) plus one in `workflow.js:22` — and **three of the six
  are deleted by `G-B`**, not rewritten. A builder working from the stale list
  hunts four line numbers that point at nothing and may conclude the fix is
  already done. `CLAUDE.md` §6's stale-status-file gotcha, inside this register's
  own prose.
- **`G-A` is a change to `src/uc04/`, dispositioned inside UC-03's contract**,
  and UC-04's `[W-4]` does not work without it. The dependency was recorded in
  `CLAUDE.md` §7 and in neither contract's own §18 until now.
- **Both G-C destinations resolve** — `Tax Operations` `6168394287519` and
  `Mobility Legal (Tier-3)` `6168424846751` are both in
  `src/shared/escalationGroupIds.js`. No group needs creating, which is not true
  of every routing change in this repository.

**Nothing in `src/`, `test/` or `workflows/` was changed to produce either
queue.**

**Two long-standing cross-UC findings were RESOLVED rather than decided by the
tenth pass** — **DRIFT-011** (UC-03 → UC-08 route) and **DRIFT-021** (UC-04 has no
outbound route). Both asked for a routing edge; both are answered by UC-08
**reading the Remote records its neighbours cause**, which needs no edge, cannot
be got out of sync, and works for trips that went through neither use case.

**The open count has now fallen four times, and none of the falls is
convergence.** The tenth pass decided seven and opened four — and the four came
from a source the register had not used before (below), not from re-reading code
already read.

**It then ROSE by four, on a pass that decided nothing** — the registration of
`DRIFT-118`…`DRIFT-121`. That is not the trend reversing; it is a fifth source
arriving. The nine decision passes each read one contract, the backlog session
read the cross-cutting set, and this one read a **negotiation** — two roles
disagreeing in writing about a frozen contract, which is the only source so far
that has produced findings *about the register's own criteria* (DRIFT-121 was
found inside the criterion written to close DRIFT-120's blind spot). Reading the
rise as regression would be reading a working instrument as a fault.

 The ninth pass decided eight and opened four; the eighth decided
seven and opened four; the seventh decided nine and opened four. All three are the
register working. **Three of the ninth pass's four new findings came from the
owner asking a question**, as did three of the eighth's — a source that does not
run out and is not correlated with how much code has been read. DRIFT-102 came
from *"when you say escalate, to who? e.g. in case of duplicate request"*;
DRIFT-105 from *"I don't think we need to route 03 to 07"*; and DRIFT-103 from
following the first of those one step further than it was asked.

**DRIFT-104 is the exception, and it came from checking a remedy's tooling rather
than the code it would fix.** The ninth pass set out to decide whether UC-07 may
hold a Remote client, read `scripts/capture-sandbox.mjs` to see what already
existed — and found the repository's single stated cure for its own most expensive
defect class writes to a **gitignored** directory. Cross-cutting, not UC-07's.

**The seventh pass's fall, for context — by five, on a pass that decided
nine.** The four preceding sessions each opened roughly as many findings as they
closed, and that was the register working. This one decided nine and opened four,
which is the same mechanism producing a different number: UC-05 had the largest
untouched block (nine, including the overflow set), and its four new findings all
came from **one** source — Remote's OpenAPI for the offboarding family — rather
than from nine separate re-readings. **Do not read the fall as the register
converging.** Four use cases still have no decision pass, and the two biggest
single findings in the whole index (DRIFT-063 and DRIFT-095) are both UC-05's and
both `not yet built`.

**DRIFT-086 is the one worth reading first**, because of how it was found. The
fourth pass reported that it could not reach n8n instead of absorbing the gap; the
owner reconnected the server; `verify-deployed` then ran clean (**39 nodes · 0
drifted**), and reading the deployed graph's node list showed the live UC-01 path
posts its letter to a customer and writes **no `documents` row at all**. No
hermetic test could have found it, and no amount of reading `src/` would have
either.

**Decided by use case:** UC-03 twelve (third pass), UC-01 seven (fourth pass),
UC-02 five (fifth pass), UC-04 five (sixth pass), UC-05 nine (seventh pass),
UC-06 seven (eighth pass), **UC-07 eight (ninth pass)**.
**One use case has had no decision pass at all** — **UC-09**.
**Five build queues now exist** — `UC-02-acceptance.md` §18,
`UC-04-acceptance.md` §18, `UC-05-acceptance.md` §18,
`UC-06-acceptance.md` §18 and **`UC-07-acceptance.md` §18**. Read the relevant one
before starting build work on that use case.

**The ninth pass was the first to begin on a checked foundation rather than an
inherited one.** UC-06's `[A-15]` — registered as **DRIFT-099** — required that
UC-07's pass not start until `00-FOUNDATION.md`'s three-endpoint sentence was
re-probed for UC-07's third of it, because two of the three had already turned out
to exist and UC-05's entire §0 business case had been falsified on the strength of
one of them. **Probed 2026-08-21 against Remote's own `llms.txt`: UC-07's third
holds** — zero matches for `relocat`, `country transfer`, `country-transfer`,
`entity transfer`, `internal transfer` or `mobilit`. It is recorded as a
**confirmation**, for the same reason `CONTRADICTIONS.md` keeps its four `K-`
entries: a register that only ever reports faults teaches its reader to distrust
everything equally.

**One word had to be added even so.** `docs/INTAKE-RESEARCH.md` §75 records that
Remote's *product* has a **Country Transfer Service**; the gap is in the **API**,
not the platform. "No country-transfer endpoint exists" without the word **API**
overstates in Remote's disfavour — the identical over-reach that made the other
two-thirds of that sentence wrong.
**`UC-06-acceptance.md` §18a holds the substitution ladder** — the project-wide
rule for where a fact is allowed to come from. It is repeated in `CLAUDE.md` §3,
`docs/00-FOUNDATION.md` §2a and `docs/WHY-THIS-SHAPE.md` §14; if those four ever
disagree, the ladder in §18a is the one that was written first and reviewed with
the owner.
**Three UC-01 findings stay open on purpose** — DRIFT-003 and DRIFT-004 carry an
explanation and a recommendation but no choice, and DRIFT-077 was not in the
owner's disposition list and is recorded as open rather than inferred from its
neighbours.

**Five findings land on UC-03 and are not UC-03's to decide** — DRIFT-084, -043,
-040, -041, -042. Each carries a stated recommendation in
`contracts/UC-03-acceptance.md` §17c, so the next session starts from a position
rather than from scratch. Three are cross-cutting: settling them from inside UC-03
would set policy for UC-06's amendments and UC-09's payments.

---

## Index

| # | Use case | Finding | Recommendation | Confidence |
|---|---|---|---|---|
| DRIFT-001 | UC-01 | Audit-timing "known gap" is stale and contradicted four screens later in its own spec | ✅ **DECIDED** · stale paragraph deleted from `UC-01.md` §10 · **done** | HIGH |
| DRIFT-002 | UC-01 | The n8n half of the live chain is UNKNOWN, and the spec reads as if proven | ✅ **DECIDED** · standing rule: **missing n8n access is reported at the top of the reply, never buried**. It recurred, was reported, n8n was reconnected, and `verify-deployed` then ran clean — **39 nodes · 0 drifted** · *`verify-live-uc01` and one real ticket still outstanding* | HIGH / LOW |
| DRIFT-003 | UC-01 | `out_of_scope` is unobservable by design — a whole class of wrong refusals leaves no trace | ⏳ **OPEN · EXPLAINED** at the owner's request; recommendation stated (trace the refusal, still create no case) → ✅ **DECIDED** — write a **trace-only** `logTraceStep({call:"uc01.out_of_scope"})` with confidence and a text excerpt; still **no** `cases`, `review_queue` or `documents` row. *A `case` says somebody owns this; an `audit_trace` row says this happened.* **Built on both paths** (rca-1bk, 2026-08-22). Node: `src/uc01/workflow.js:260` `logStandaloneTraceStep({call:"uc01.out_of_scope"})`, covered by `test/uc01OutOfScopeTrace.test.js`. n8n graph `WORKFLOW_UC01_ID`: an `Out of Scope?` branch immediately after `Identity + Policy Gates` (ahead of `Claim Ticket`/`Persist Case`/`Append Audit Log`, closing the VC-11 violation the same bead found) → `Write Out-of-Scope Trace` (Supabase insert, `parent_id` NULL) → `Reply Out of Scope` (public reply, no tag) — republished and proven on a real unpinned production execution (ticket #71, execution `6674`): zero `workflow_claims`/`cases`/`audit_log` rows, exactly one `audit_trace` row → **REVERSED 2026-08-22 by `rca-qdc`'s F-3 fix (commit `93884e7`)**: the unbounded reply loop returned — a real customer received 21 replies in 39 seconds, stopped only by Zendesk's own 429 — because the branch's placement and tag-free reply gave nothing for a loop guard to key on. The fix moved the `Out of Scope?` branch **downstream** of `Claim Ticket`, and `Reply Out of Scope` now applies tag `uc01_out_of_scope_replied` and leaves **one** `workflow_claims` row: live Zendesk trigger `9990000000004`'s `not_includes` list names that tag as its loop guard, and the claim row is what makes the branch idempotent. This **reverses**, not merely revises, the placement and the "no tag" wording recorded immediately above → **RATIFIED by the owner, 2026-08-22 (bead `rca-jsv`)**: the loop guard stays as built. **The contract moves, not the code.** `qa/contracts/UC-01-acceptance.md` §6 and VC-11 (`qa/handoffs/UC-01/0001-builder-to-validator.md`) are amended to permit the `uc01_out_of_scope_replied` tag and the one `workflow_claims` row on `out_of_scope`. Do NOT revert `93884e7`; do NOT build a different guard. The original decision recorded above (public reply, no tag, branch immediately after Identity + Policy Gates) is left readable on purpose — it was correct when built, and was superseded by a later, reviewed and owner-ratified change, not silently contradicted | HIGH |
| DRIFT-004 | UC-01 | The "non-English request" scenario has no distinct mechanism | ⏳ **OPEN · ANSWERED** · recommendation **G-4**: detect and route, **never machine-translate a legal attestation** | MEDIUM |
| DRIFT-005 | UC-01 | PDF is specified; HTML is built | ✅ **DECIDED** *(amended same day)* · **HTML is the artifact of record; the PDF is a rendering produced at download.** Both paths can emit HTML, it is byte-deterministic, `documents.content` already holds it · *not yet built* | HIGH |
| **DRIFT-074** | UC-01 | **No EOR-engagement gate — the letter asserts an employment relationship that does not exist, for contractors and direct/HRIS workers, and shipped live** | ✅ **DECIDED** · *"behaviour sticks to Remote's documentation"* — build the gate **(G-1)** · *not yet built* | HIGH |
| **DRIFT-075** | UC-01 | The third-party consent path cannot succeed: `consent_records` is write-only and **both** normalizers hard-code `consentOnRecord: false` | ✅ **DECIDED** · a consent surface the **named employee** authenticates to, and consent read back as an artifact **(G-3)** · *not yet built* | HIGH |
| **DRIFT-076** | UC-01 | UC-01 auto-issues the standard letter, duplicating a flow Remote automated years ago and which its own spec puts out of scope | ✅ **DECIDED** · option (b) — deflect the self-servable, **keep** auto-issue as the fallback **(G-2)** · *not yet built* | HIGH |
| **DRIFT-077** | UC-01 | No Remote-side intake surface and no third-party surface, so the flow cannot be demonstrated from where it starts | ⏳ **OPEN** · no disposition given; **G-3 forces half of it**, the Requests-tab branch and the mailbox stand-in stay undecided → ✅ **DECIDED** — build both intake surfaces, with a **free-text compose box** for the third-party channel rather than a form: the real channel is a mailbox, and a form quietly flatters reality by handing the classifier structured input it never gets. **Gated on `G1`** — without a consent lookup there is nothing for the surface to succeed at. **Not yet built** (`G3`) | HIGH |
| **DRIFT-085** | UC-01 | **The two execution paths issue materially different letters** — 7 rows and an "employed by" attestation on the Node path, 4 rows and neither on the live path — and `n8nParity` compares gates, not documents | ⏳ **OPEN** · **confirmed against the live graph** · 3-step recommendation: parity test first, then the `documents` write, then converge content — **content last, after G-1** | HIGH |
| **DRIFT-086** | UC-01 | **The live path posted the letter to a customer and stored no copy of it** — no node wrote a `documents` row, so invariant 12's "no `documents` row on a refusal" passed for the wrong reason (there was never a `documents` row on ANY path). **Evidence criterion corrected (rca-uim):** the original criterion — "the word `documents` appears zero times in the deployed workflow JSON" — was satisfied by four occurrences INSIDE JS COMMENTS on unrelated nodes while the defect was fully present, so it could not distinguish "fixed" from "still broken" and must never be re-used. The real test is **structural**: a Supabase node named `Persist Document`, `type: n8n-nodes-base.supabase`, `tableId: "documents"`, sitting strictly between `Render Letter` and `Reply + Solve Ticket` in the live graph's `connections` — checked by `persistDocumentParamIssues()`/`structuralNodeIssues()` (`workflows/nodes/persistDocumentSpec.js`, `scripts/lib/structuralNodeChecks.mjs`), not by grepping the raw JSON | ✅ **DECIDED · BUILT · DEPLOYED** — `Render Letter → Prepare Document (hashes the letter) → Persist Document (writes case_id/type/content/content_hash) → Reply + Solve Ticket`, before the outward action, mirroring `src/uc01/workflow.js` STEP 7b. Deployed live to `WORKFLOW_UC01_ID` via `scripts/deploy-uc01-persist-document.mjs`; `npm run verify-deployed` clean (46 nodes · 0 drifted · 0 unpublished); hermetic coverage in `test/n8nPersistDocumentParity.test.js` (Code-node parity + sha256 vs `node:crypto` + structural drift induced and caught, including the exact bypass shape this finding named) | HIGH |
| **DRIFT-118** | UC-01 | **The two normalizers derive OPPOSITE identities from the same Zendesk ticket, and therefore opposite decisions.** `src/zendesk/normalizeTicket.js:53` sets `session: null` unconditionally; `workflows/nodes/normalizeTicket.js:38-46` derives it from the Zendesk-authenticated requester. Driven on one ticket and one employment record: Node `escalate / identity_not_verified`, live `auto_resolve / all_gates_passed` — **settled at gate 1**, so no later gate masks it and no negative test sees it. `CLAUDE.md` §6 records the n8n derivation as the **fix** for a real defect; it was never back-ported, so **invariant 11 holds on the Node path only VACUOUSLY** — nothing is taken from a claim because nothing is taken from anywhere | ⏳ **OPEN** · opened by the UC-01 Builder pass (`2888f13`), pinned as **VC-28** · recommendation `L-11`, inside the G-3 work, which is already in that file for the `consentOnRecord` hard-code. Full text: `handoffs/UC-01/0001-builder-to-validator.md` §10 | HIGH |
| **DRIFT-119** | UC-01 | **The LLM decides `requesterType`, and §9 does not permit it.** §9's permitted list omits the field; §9's prohibition names *"whether consent exists, **who granted it**, or whether a disclosure is permitted"*; §10's deterministic list names the **third-party gate** and **consent verification against a stored artifact**. `classifier.js:69` asks the model for it, `policyEngine.js:80` branches on it, `shared/identity.js:51` branches again to decide whether consent is required — so under G-3 **the model decides whether a consent artifact is required at all**. The deterministic signal is computed and discarded (`gates.js:68` compares the authenticated email to the record's) | ⏳ **OPEN** · opened by the UC-01 Builder pass (`2888f13`), pinned as **VC-29** · recommendation `L-10`: derive it deterministically; the model's answer is retained only as a signal that may move `self → third_party`, never the reverse. **Must land before `L-12` opens the third-party door** | HIGH once G-3 lands; **dormant today** — both normalizers hard-code `consentOnRecord: false`, so the consented branch is unreachable (DRIFT-075) |
| **DRIFT-120** | UC-01 | **`consent_records` cannot hold the artifact invariant 13 requires, and VC-07 is therefore not satisfiable without a migration.** `src/shared/caseStore.js:220-233` writes `id, created_at, case_id, consent_type, status, source, evidence_reference`. Of invariant 13's four facts, *when* is `created_at` and *to what* is approximated by a category; **who granted it and to whom have no column at all** — `case_id` links to a case, not to an authenticated grantor, and `source` is the channel. DRIFT-075's disposition says the lookup returns who consented and to whom; **the lookup can only return what the row holds** | ⏳ **OPEN** · opened by the UC-01 Builder pass (`2888f13`), pinned as **VC-30** · recommendation `L-7`, **before `L-8`**: make the four facts columns, keep the existing seven. Concatenating them into `evidence_reference` would pass a naive read of VC-07 while defeating §7's re-check, which must query by party and purpose | HIGH · **the conditional is now settled**: the live table was read 2026-08-21 and holds exactly those seven columns, so the migration is required, not merely possible |
| **DRIFT-121** | UC-01 (mechanism in `src/shared/`) | **VC-31 cannot pass: the trace row it requires reaches no table.** `src/shared/audit.js:132` persists a trace only when `parentId` is set; parentless it goes to `pendingTraces`, whose **only** drain is `#bindPendingTracesTo()` off the `audit_log` write path — and `src/uc01/workflow.js:126-142` returns for `out_of_scope` **before any audit row exists**. So the entry lives in the in-memory `entries` array and dies at process exit, **and a test asserting `AuditLogger.entries` goes green over it** — fixtures agreeing with code, inside the criterion written to remove a blind spot. **Not a schema problem**: `audit_trace.parent_id` is nullable with an FK to `audit_log.id`, read live | ⏳ **OPEN** · opened by the UC-01 Validator second pass (`1ffb7e9`), and it is why **VC-31 is amended** · recommendation: `L-18`'s file list gains `src/shared/audit.js`. **No migration.** V-5's deflection-rate denominator is unevidenced until it lands. Same defect class as DRIFT-120, one table over — **and it was found inside the criterion added by the pass that discovered the first instance** | HIGH for the criterion; low for today's product — nothing writes this trace yet |
| **DRIFT-122** | UC-01 | **`auto_resolve` applied only `uc01_auto_resolved`, never `queue_hr_ops`, and the ticket sat in the default `Support` group with no `ASSIGNMENT SKIPPED` note** — §16 item 2 requires the exact tag set plus the assignment, and F-6 (bead `rca-1rx`) found both halves unmet on ticket #93 | ✅ **DECIDED · BUILT · VERIFIED** — the owner ruled the graph moves (bead `rca-jsv`, 2026-08-22): `Reply + Solve Ticket` now applies `uc01_auto_resolved` **and** `queue_hr_ops`, and the ticket is assigned to the `HR Ops` group (`6168404929823`). Fixed on the live n8n graph and confirmed on a **fresh** production ticket (#97, evaluation #3): tags `[uc01_auto_resolved, queue_hr_ops]`, group `6168404929823` confirmed **by name** as "HR Ops". §16 item 2 now **PASSES**. The evaluator's own caveat — that tagging a ticket nobody will work might be the wrong behaviour — was put to the owner, who chose the tag; the contract was not amended because the graph was already correct against it. **This entry records a decision that was already ruled and built** (F-6/rca-1rx), not a new decision — recorded here per bead rca-jsv's closing condition, and because an earlier note on that bead mis-attributed the ruling to a coordinating session's mail relay rather than the owner directly; that provenance is corrected in `qa/handoffs/UC-01/0001-builder-to-validator.md` and is not repeated here | HIGH |
| DRIFT-006 | UC-02 | The spec's core deterministic check named fields Remote does not have | ✅ **DECIDED** · `KEEP_CURRENT`; spec and code already agree (verified) · **nothing to build**. Kept as the archetype — *a gate that cannot fail is worse than no gate* — and the archetype **recurred in this pass** as DRIFT-088 | HIGH |
| **DRIFT-007** | UC-02 | **Vision/OCR is the use case's headline capability and is not built** — the control is "a receipt row exists", not "the receipt supports the claim" | ✅ **DECIDED** · *"go with the documented behaviour"* — build it **(E-1)**, with the extraction **corroborating** figures Remote already holds and never sourcing one. Plus the token workaround: injectable seam + **byte-hash cache** + fixture corpus + a test that the suite cannot reach vision at all · *not yet built* | HIGH |
| **DRIFT-008** | UC-02 | **The policy-cap corpus is invented data presented inside a real refusal** | ✅ **DECIDED** · `RECONCILE` against Remote's documentation **(E-2)** — and being *literally* true to it inverts the obvious fix: **Remote's API and expenses doc contain no policy, cap or limit concept at all**, so the cap is the **employer's**, never Remote's, and must name its author wherever it refuses somebody. RAG framing comes out of the spec · *not yet built* | HIGH |
| DRIFT-009 | UC-02 | §15 denied a review queue §6 had always specified; no control could resolve a flagged claim | ✅ **DECIDED** · `KEEP_CURRENT` — **explained at the owner's request** and verified against the tree (`server.js:468` is a real verdict; `UC-02.md:181` is corrected) · **nothing to build**. Kept because of what it cost: two sections of one document maintained independently, and the code believed the wrong one | HIGH |
| **DRIFT-010** | UC-02 | Two duplicate hashes are computed; the table stores one | ✅ **DECIDED** · `RECONCILE` — provision `derived_receipt_hash` + index. **The owner's worry is well-founded and the risk is not the column**: the migration makes a rare in-process **false block** permanent, and a block has no appeal route. Ship **E-3** before or with it · *not yet built* | HIGH |
| **DRIFT-087** | UC-02 | **A duplicate found by inference and one found by evidence get the same irreversible verdict** — `blocked`, a hard stop with no appeal anywhere in the system | ⏳ **OPEN** · opened by DRIFT-010's disposition · recommendation **E-3**: evidenced duplicate stays blocked, **inferred** duplicate becomes `human_review` / `possible_duplicate` | HIGH / MEDIUM |
| **DRIFT-088** | UC-02 | **Remote requires a receipt to create an expense, so the receipt-evidence gate may be unfailable on the documented trigger path** — DRIFT-006's archetype, in the gate that replaced DRIFT-006's gate | ⏳ **OPEN** · opened by DRIFT-007's research · **measure first**: every empty `receipts: []` in this repo is one this repo constructed. Do **not** delete the gate — it still guards the portal path | HIGH / MEDIUM |
| DRIFT-011 | UC-03 | **Three of the four documented outbound routes do not exist** | ✅ **DECIDED** · narrow, do not route; two named escalations instead **(G-C)** · *not yet built* | HIGH / LOW **RESOLVED 2026-08-21 by UC-08's pass: no route — UC-08 reads the `TravelLetterRequest` records UC-03 causes.** A 🟢 keyword classifier must not open a 🔴 tax case on a phrase. |
| DRIFT-012 | UC-03 | The second zero-touch letter type (personal no-objection) does not exist | ✅ **DECIDED** · build it · *not yet built* | HIGH |
| DRIFT-013 | UC-03 | A 30-day duration cap contradicts UC-04's own sourced finding | ✅ **DECIDED** · remove the cap, carry duration into UC-04 **(G-B)** · *not yet built* · **M-1 MEASURED 2026-08-22: `0` rows.** `select count(*) from cases where reason='duration_over_cap'` against production `your-project-ref` returns **0**. Verified non-vacuous — `reason` is populated across **145** rows spanning **18** distinct values, so this is a real zero and not a wrong-column artefact. **Nobody was ever refused on the invented threshold, so there is no backlog to name**: UC-03 §18 Step 0's *"if the count is non-zero those cases need naming"* does not fire. G-B is forward-only. | HIGH |
| DRIFT-014 | UC-03 | The reader is told "Global Mobility"; the ticket goes to Travel & Mobility Support | ✅ **DECIDED** · remove it; build the prose from the routing row · *not yet built* | HIGH |
| DRIFT-015 | UC-03 | The destination-jurisdiction gate entered in code, not in the spec | ✅ **DECIDED** · KEEP_CURRENT · **nothing to build** | HIGH |
| DRIFT-016 | UC-03 | No letter has ever been issued in production | ✅ **DECIDED** · reconcile + move the letter to PDF · *not yet built* · **M-2 MEASURED 2026-08-22 — THE PREMISE IN THIS ROW'S TITLE IS NOW FALSE.** Production `documents` holds **9 `travel_support_letter` rows** (created 2026-08-20 09:55:42Z → 17:00:06Z) and **10 `travel_informational_response`** (2026-08-18 22:10Z → 2026-08-20 16:59Z). **§16's centrepiece HAS run.** The recorded *"as of 2026-08-20 … zero letters"* was true when it was taken and went stale within hours **of the same day** — the first letter landed 09:55Z on 2026-08-20. **"Blocked, not pending" is RESOLVED, and the blocker was a caller, not the account**: the contract said `pg` cannot reach Supabase through an HTTP CONNECT proxy, which is true and is about *that client*; measured here through the Supabase MCP server, a different authorised caller, without the owner's machine. | HIGH |
| **DRIFT-078** | UC-03 → UC-04 | **UC-04 cannot be filed by the employee, so the hand-off changes who is signed in** — found by driving the demo, not by a test | ✅ **DECIDED** · option (a), two accepted session shapes **(G-A)** · *not yet built* | HIGH |
| **DRIFT-079** | UC-03 | The contract described a signature the routine letter no longer needs (`letterAutoIssue = true`) | ✅ **DECIDED** · reconciled **in this revision** · *documentation only, done* | HIGH |
| **DRIFT-080** | UC-03 | A decline's reason is mandatory, recorded, and never reaches a portal requester | ✅ **DECIDED** · build it, with the reason-class taxonomy · *not yet built* | HIGH |
| **DRIFT-081** | UC-03 | No `decisionSources.js`, where UC-04/05/07/08 each have one | ✅ **DECIDED** · build it as part of the draft-assist · *not yet built* | HIGH |
| **DRIFT-082** | UC-03 | Five quick-fills for roughly fifteen outcomes — the awkward cases must be typed live | ✅ **DECIDED** · a quick-fill per outcome, then sweep the other eight · *not yet built* | HIGH |
| **DRIFT-083** | UC-03 | "A specialist *writes* a letter" reads as a system action | ✅ **DECIDED** · reworded **in this revision** · *documentation only, done* | HIGH |
| **DRIFT-084** | UC-03 | **Remote publishes a travel-letter API and five webhook events; we subscribe to none and read none** — and its own approval chain puts the document *after* two approvals, where UC-03 issues it first | ⏳ **OPEN** · RECORD NOW · build nothing · **do not decide under deadline** | HIGH |
| **DRIFT-017** | UC-04 | **The specified four dimensions are not the implemented seven factors**; immigration document-presence became a self-declared visa type | ✅ **DECIDED** · `RECONCILE` in three parts, and **Remote's own schema made the finding worse, not better**: there is no visa or permit field anywhere on the object, so `visaType` did not *replace* a Remote field — there was none to replace. **(a)** no coverage table is built; dimension 1 becomes a **known-gap screen** that says so **(W-7)**. **(b)** `visaType` labelled self-declared, unverified, everywhere **(W-6)**. **(c)** capture Remote's `travel_document_number` instead, displayed as identity evidence and **read by no gate** **(W-3)**. *Also recorded: `will_negotiate_or_sign_contracts` is Remote's own field with Remote's own rationale — one factor of seven is literally theirs* · *not yet built* | HIGH |
| **DRIFT-018** | UC-04 | An employee cannot file the request this use case is named after | ✅ **DECIDED** · option (b), the owner's call — **build the employee path (W-4)**, and **relabel the admin form first (W-5)**: it is titled *"Request permission to work from another country"*, the employee's own sentence, on a form that refuses employees. The stand-in stands in for Remote's **product** (which does create these) and **not** the partner API (which does not) — it seeds in-process and the wire `POST` keeps answering `Not Found`. Depends on **G-A** · *not yet built* | HIGH |
| **DRIFT-019** | UC-04 | "No duration threshold, anywhere" versus a live Schengen block | ✅ **DECIDED** · `RECONCILE` — narrowed **in this revision** to *"no **invented administrative** cap; a statutory limit with a named source is a gate"*. The absolute form would have someone delete a correct Reg. (EU) 2016/399 art. 6(1) control, and **DRIFT-013 cites it in its own defence** · *`UC-04.md` §7 annotated; the sentence's dependents not yet re-checked* | HIGH |
| **DRIFT-020** | UC-04 | An approval never expires and a trip start date never lapses | ✅ **DECIDED** · re-check the dates at approval time **(W-2)**, refuse-only and additive. The argument is internal consistency, not new policy: the decision gate already refuses `start_in_past`, so the system **already holds the opinion** — it just held none at the only moment that produces a `PATCH` · *not yet built* | HIGH |
| **DRIFT-021** | UC-04 | UC-04 computes UC-07's and UC-08's findings and has nowhere to send either | ✅ **DECIDED · SPLIT** · the **routing stays HUMAN_DECISION_REQUIRED**, to be settled with DRIFT-011 as one decision — deciding it from inside UC-04 sets cross-UC policy from the wrong end. **The cheap half ships (W-9):** the escalation **names the finding and the team that would own it**, and creates no cross-UC record · *not yet built* | MEDIUM **RESOLVED 2026-08-21 by UC-08's pass: no route — UC-08 reads the `WorkAuthorizationRequest` records UC-04 causes**, so UC-04 never has to decide that a tax case exists. |
| **DRIFT-089** | UC-04 | **The employee is told nothing in three of four outcomes** — `blocked` and `escalate` write nothing to Remote, so their request stays `pending` there forever | ⏳ **OPEN** · opened by DRIFT-018's disposition · **W-4 makes the two transmitted outcomes visible and does not close this.** The obstacle is stated: **Remote has no transition meaning "we refused this before asking you"** — `cancelled` is *"Cancelled by the employee"*. Three options in §18; **the one to refuse is using `cancelled`** | HIGH / MEDIUM |
| **DRIFT-090** | UC-04 | **Every travel history in this system was typed by somebody, and no screen says so** — Remote holds no travel-history field on either object | ⏳ **OPEN** · recommendation **W-8**: state it, do **not** attempt to source it. A Schengen block is a hard stop resting entirely on self-reported input | HIGH |
| **DRIFT-091** | UC-04 | **An escalation has no lifecycle** — tagged, assigned, and that is the end of this system's involvement. No SLA, no re-entry, no return path, and the accept-rate metric structurally cannot see the outcome | ⏳ **OPEN** · **cross-cutting, not UC-04's to settle** — the same absence is on UC-03, UC-05, UC-07 and UC-08. Decide once, with DRIFT-021 and DRIFT-011 | HIGH |
| **DRIFT-092** | UC-04 | **`travel_document_number` is in Remote's `required` array and is collected nowhere** — the closest thing to dimension 4 that exists on the wire | ⏳ **OPEN** · recommendation **W-3**: capture and display as identity evidence, **never** permission evidence, read by no gate. A passport proves who somebody is and nothing about what they may do | HIGH |
| **DRIFT-093** | UC-04 | **§15 promised an outcome Remote's API cannot produce** — neither object carries a file, URL or document field, not even the one that is a letter by name | ⏳ **OPEN** · **corrected in §15 in this revision** and kept as a finding so the correction is not later mistaken for something always understood. Useful contrast: **UC-03's letter IS a document we produce**, because a letter stating facts we hold is a different object from a permission we are not granting | HIGH |
| **DRIFT-094** | UC-05 | **Two intake surfaces create a record Remote forbids creating, and neither is labelled a stand-in** — `CreateOffboardingParams.type` is `enum: ["termination"]`; a resignation can only be created by the employee inside Remote's product | ⏳ **OPEN** · recommendation `[N-3]`: label both, and add the structural create-refusal the mock **already carries for UC-04**. This is **CREATE-BY-EMPLOYEE, DECIDE-BY-API, second instance** | HIGH |
| **DRIFT-095** | UC-05 | **There is no reconciliation step, and reconciliation is what the use case becomes once Remote's own figure is read** — `days_of_notice` appears nowhere in `src/` | ⏳ **OPEN** · recommendation `[N-5]` `[N-6]`: four verdicts, both figures, both provenances. The comparison performed today is *statute vs. what the employee asked for*; the one that carries the risk is *statute vs. what the employer is about to accept* | HIGH |
| **DRIFT-096** | UC-05 | **Remote publishes the letter, the PTO breakdown and the probation verdict on the resignation record, and UC-05 reconstructs all three from caller input** — including an LLM seam that parses prose Remote would hand over as a document | ⏳ **OPEN** · recommendation `[N-2]`: read all three; keep the extractor for stand-in traffic. **Note:** `contract_proabtion_period_passed` is misspelled in Remote's own `required` list and must be reproduced exactly | HIGH |
| **DRIFT-097** | UC-05 | **A resignation dated before the start date clamps tenure to zero and computes the shortest statutory bracket** — `tenureMonthsBetween()` ends `Math.max(0, months)`. Remote models this as a separate variant whose validate form is one boolean, with no notice arithmetic at all | ⏳ **OPEN** · recommendation `[N-18]`: refuse by name, with its own rung. **Do not add a zero-tenure bracket** — the answer is not *zero days of notice*, it is *notice does not apply to this yet*. Same clamp-hides-the-anomaly shape as the negative-accrual findings in §7 | HIGH |
| **DRIFT-098** | UC-06 | **The requester may sign the employer-side approval slot.** `requester` is captured and persisted and never compared to either approver, so the person who typed the salary change can sign the box confirming they typed it. The exemption is argued in `dualApprovalPolicy.js:13-29` — **a code comment, and nowhere in the ADR that exists to argue exactly this**. UC-01 has `self_approval`; UC-09 has requester ≠ approver ≠ payment_releaser; UC-06 is the only one of the three that exempts itself | ✅ **DECIDED 2026-08-21 by the owner** · slot 1 becomes the **employer's signature** (Remote's own `awaiting_employer_signature`), requester refused by name · `[A-1]` `[A-2]` `[A-3]`, `[A-4]` open · **not yet built**. `[A-1]` **before** `[A-2]` — migrating a name inside a control change leaves the control down | HIGH |
| **DRIFT-099** | UC-06 → **UC-07** | **UC-07's atomic country-transfer endpoint has never been re-checked**, and it sits in the same `00-FOUNDATION.md` sentence as two absences that turned out false — UC-06's `automatable` (probed 2026-08-18) and UC-05's resignation endpoint (proven 2026-08-21). A 2-of-3 error rate, still carried as fact in the document a UC spec never overrides | ⏳ **OPEN** · recommendation `[A-15]`: re-probe **before** UC-07's decision pass, not during it. UC-05's §0 business case was *false* because a pass inherited an unchecked absence — this exists to stop that happening twice | HIGH on the gap; the endpoint's status is **UNKNOWN**, which is the point |
| **DRIFT-100** | UC-06 | **The Slack alert is presented as a business outcome while unprovisioned.** Built, correct, injected, and a true no-op — `SLACK_WEBHOOK_URL` is unset in `.env.example` and on the deployment. The same built-vs-provisioned gap `APPROVER_ROLES` sat in for two days | ✅ **DECIDED 2026-08-21** · label it *built, unprovisioned*; **do not connect Slack** — the role's posting names n8n/Zendesk+ZAF/REST/webhooks/MCP, and `RCX OPS · Error Alerts` already demonstrates durable alerting better (row first, push second, continue-on-error) · `[A-7]`, `[A-8]` open · **not yet built** | HIGH |
| **DRIFT-101** | UC-06 | **UC-06's positive path exists on two of the four demo countries, and no acceptance criterion says which.** Live: NL 200, PT 200, CA 200, **USA 500 both models**, every contractor 404 — and of the three with a form, only NL and CA reach `dual_approval_required`; every PT record answers `schema_invalid`. `UC06-US-3` was *predicted* approvable and observed `country_schema_unavailable` | ✅ **DECIDED 2026-08-21** · state **NL and CA**; keep the US as a *labelled refusal* rather than dropping it; document PT rather than seeding around it · `[A-5]` `[A-6]` · **not yet built**. `M-2` re-measures the US 500 first. The observation has been a ⚠️ DIFF row in `DEMO-COUNTRIES.md` since 2026-08-19 — the matrix working; it had simply never been promoted into the register | HIGH |
| **DRIFT-102** | UC-07 | **A duplicate delivery returns `decision: "escalate"` to a caller nobody escalated anything for.** `workflow.js:238-240` returns the same decision string a successful compile returns, with `dossierId: null`, **no audit row** (the claim check sits above `audit.log()`) and no ticket. A portal requester who submits twice gets a success-shaped response with nothing behind it | ✅ **DECIDED 2026-08-21** · its own caller-visible outcome; **not an error** — the quiet stop is correct and is why the claim node exists · `R-25` · **not yet built** | HIGH |
| **DRIFT-103** | UC-07 | **A second relocation request for the same employment is not detected at all.** `claimExternalRef()` keys on `(use_case, external_ref)`, and two genuine submissions always differ. Two dossiers, two verdicts, possibly contradictory, both waiting forever. `dossierStore.listByOwner({employmentId})` **exists at `dossierStore.js:161` and no caller uses it for this** | ✅ **DECIDED 2026-08-21** · detect on compile and name the prior dossier; surface the pair through the **ticket**, since the store is immutable · the cheapest half of DRIFT-032, needing no Remote call · `R-26` · **not yet built** | HIGH |
| **DRIFT-104** | **cross-cutting** | **The Sandbox capture writes to a gitignored directory**, so the repository's one stated cure for its own most expensive defect class — *"fixtures written to agree with the code and code written to agree with the fixtures"* — produces nothing durable. `scripts/capture-sandbox.mjs:36` → `.sandbox-cap`; `.gitignore:44` ignores it. **And there is no fallback at all** if the Sandbox expires mid-demo | ✅ **DECIDED 2026-08-21 by the owner** · committed captures with provenance, **loud** replay (`X-Sandbox-Replay`, `_replay`, the date on the page), **live always wins**, GET-only both legs, `sandbox_live`/`sandbox_replay` on the trace · an unmarked fallback makes the API claim unfalsifiable · `R-27` · staleness horizon → `G2` · **not yet built** | HIGH |
| **DRIFT-105** | UC-07 | **UC-07's spec names an inbound route from UC-03 that has never existed in code.** `UC-07.md:91` opens *"Ticket (routed from UC-03, or direct)"*; `src/uc03/policyEngine.js:183`'s union is `auto_resolve\|human_review\|escalate\|route_to_uc04` and "relocat" appears nowhere in `src/uc03/` outside a comment. Distinct from **DRIFT-011**, which is the misroute that DOES happen | ✅ **DECIDED 2026-08-21 by the owner** · *"I don't think we need to route 03 to 07"* · **struck on merit**: a routing edge would let a 🟢 classifier open a 🔴 case on a keyword. The precedence already exists in the right place — `relocationParser.js` ranks workation phrasings first · documentation only · **DRIFT-011 stays open and belongs to UC-03/UC-04** | HIGH |
| **DRIFT-106** | UC-08 | **The data source §5 names for the presence count cannot produce a dated, located count** — `Timeoff` has no country or location property, a workation generates no time-off record, and custom fields have no dates | RECONCILE → ✅ **DECIDED** — correct §5/§3/§13 task 4, original wording kept visible, and point them at DRIFT-107's source. **Not yet built** (`T-6`) | HIGH |
| **DRIFT-107** | UC-08 | **Remote publishes a dated, located, employer-approved travel history and UC-08 does not read it** — `GET /v1/travel-letter-requests` and `GET /v1/work-authorization-requests`, both by `employment_id`, both carrying `destination_country` + `travel_date_start`/`_end` | RECONCILE → ✅ **DECIDED** — read behind a read-only façade, with provenance and a marked capture fallback. Both collections were **`200` with `total_count: 0`** at capture, so `M-1` re-measures and a **positive test leads**. **Not yet built** (`T-1`…`T-4`) | HIGH |
| **DRIFT-108** | UC-08 | **`/v1/federal_taxes` has no read endpoint** — only `PUT …/federal-taxes` (W-4 submission, US Global Payroll). §13 task 8 has carried it as a pending verification for months | RECONCILE → ✅ **DECIDED** — mark the row and the task **resolved negative**, naming the three real paths. A negative is a result. **Not yet built** (`T-7`) | HIGH |
| **DRIFT-109** | cross-cutting (UC-07 · UC-08) | **No ticket exists on the portal path for either 🔴 use case, and three separately-decided things all need one** — the aftermath, the outside-the-record metric, and *"the receiving human must not be left unaware"* | RECONCILE → ✅ **DECIDED** — raise the ticket; **the id travels record → ticket only**, so the store keeps one write method and zero mutations. **Build once for both use cases.** **Not yet built** (`T-13` = UC-07's `R-24` prerequisite) | HIGH |
| **DRIFT-110** | UC-09 | **ADR 0005 states that UC-09 enforces the segregation clause and names the file; UC-09 does not enforce it** — the clause was added by the *eighth* pass to fix UC-06 and asserted UC-09's state from memory | RECONCILE → ✅ **DECIDED** — correct the ADR, and **land that correction ahead of the build**: a gap plus a written assurance that there is no gap is worse than the gap. *A correction can propagate a false claim* — first time this register has caught one of its own passes doing it. **Not yet built** (`P-2`, ahead of `P-1`) | HIGH |
| **DRIFT-111** | UC-09 | **`GET /v1/companies/{id}/managers` is tagged `[CONFIRMED]` in §3 and is not a path Remote publishes** — the real surface is `GET /v1/company-managers?company_id=` | RECONCILE → ✅ **DECIDED** — correct §3 and re-tag from the index. **The fourth `[CONFIRMED]` endpoint that does not exist as written**, and the first in the *declared-confirmed-but-absent* direction. **Not yet built** (`P-16`) | HIGH |
| **DRIFT-112** | UC-09 | **Remote publishes `type_label` for the incentive type and the sidebar prints our own rearranged slug beside it** | RECONCILE → ✅ **DECIDED** — carry `type_label` from the create response and prefer it; keep `words()` as the fallback for older rows. *We implement Remote's product; we do not restate it in our own vocabulary where they publish theirs.* **Not yet built** (`P-31`) | HIGH |
| **DRIFT-113** | UC-09 | **The no-double-payment claim rests on an `Idempotency-Key` header Remote documents nowhere**, and `#writeHeaders()` defaults it to a fresh `randomUUID()` — idempotency in shape only | RECONCILE → ✅ **DECIDED** — measure it (`M-3`), put the adjustment id in Remote's own documented `note` mechanism regardless (`P-9`), correct §10's wording to whatever the measurement shows, and stop defaulting to a random key. **Not yet built** | HIGH on the absence and the default; **UNKNOWN** on whether Remote honours it |
| **DRIFT-114** | UC-09 | **Remote publishes two status vocabularies for one object** — `pending/preparing/processing/paid/deleted` in the guide, `pending/scheduled/paid/cancelled` in the reference — and `status` has **no enum** | RECONCILE → ✅ **DECIDED** — resolve by constraint, not by choosing: treat `status` as an opaque string in `P-15`/`P-28`, test only what Remote states normatively in prose, **never enumerate it**. **Not yet built** | HIGH |
| **DRIFT-115** | UC-09 | **Nothing in `src/uc09/` writes to Zendesk at all**, so every outcome on the money path is silent — approved, denied, executed and in-doubt alike — to the person who asked for the payment | RECONCILE → ✅ **DECIDED** — a Zendesk seam on approve/deny/execute/in-doubt, after the durable audit row, injected and no-op when absent. DRIFT-053 reported this for one state; it is true of all four. **Not yet built** (`P-7`…`P-11`) | HIGH |
| **DRIFT-116** | UC-09 | **Remote answers `expected_payout_date` on the write we already make and nothing reads it** — the one question the person being paid has. `period_start`/`period_end` likewise | RECONCILE → ✅ **DECIDED** — carry it onto the executed row and into the requester's comment; null renders as *"Remote has not set a payout date yet"*, never a blank. The cheapest item in the queue — the value is already in a variable. **Not yet built** (`P-8`, gated on `M-1`) | HIGH |
| **DRIFT-117** | cross-cutting (UC-09 · research) | **`docs/INTAKE-RESEARCH.md` records that Remote publishes no incentive webhooks; it publishes five** — and DRIFT-051 cited that sentence when rating its own confidence MEDIUM | RECONCILE → ✅ **DECIDED** — correct the sentence and record the five `incentive.*` events. A false negative about a third party's API, written into our own research and propagated into a finding's confidence rating. **Not yet built** (`P-32`) | HIGH |
| DRIFT-022 | UC-05 | **UC-05 never reads a resignation record** — the trigger, the type filter and the documented poll fallback are all absent | ✅ **DECIDED** (7th pass) — **build the read**; the confirmation §3 asked for was done 2026-08-21 and the webhook **does** split by type. Both intakes survive, the portal and Zendesk doors relabelled **stand-ins**; `proposedEndDate` labelled **stated** vs `[CONFIRMED]` by origin. `[N-2]` `[N-3]` `[N-4]` · **not yet built** | HIGH / MEDIUM |
| DRIFT-023 | UC-05 | Canada's notice figure is invented, and it can reach a signature | ✅ **DECIDED** (7th pass) — **option (a): Canada gets the US treatment.** C-30's stated reason for deferring has expired (NL now carries the positive path). US claim **bounded**, behaviour unchanged. The table is reframed as a **sourced cross-check**, not a notice engine — three sourced rows of eleven is the measurement that says so. `[N-7]` `[N-8]` `[N-9]` · **not yet built** | HIGH |
| DRIFT-024 | UC-05 | Tenure is measured from a *provisional* start date in preference to the seniority date | ✅ **DECIDED** (7th pass) — prefer `seniority_date`, record **which field answered**. Belongs to `normalizeEmployment()`'s owning pass (shared with UC-06/UC-09), and needs a test driving both fields set differently — none does today. `[N-10]` · **not yet built** | HIGH / MEDIUM |
| DRIFT-025 | UC-05 | "HR acting with the employee's consent" is offered on three screens and can never happen | ✅ **DECIDED** (7th pass) — **delete the clause.** Remote's schema settles it three ways: *"initiated by the employee"*, `requested_by` = *"the employee who submitted the resignation"*, and no create at all. Only the employee files; the employer validates. `[N-11]` · **not yet built** | HIGH |
| DRIFT-026 | UC-05 | The n8n copy accepts a date the Node copy exists to refuse; `unparseable_date` has no rung and no test | ✅ **DECIDED** (7th pass) — port the round-trip check and the slice, guard **in the node**, give `unparseable_date` a rung. **The two parity scenarios land first and must fail** — written after the fix they prove nothing. `[N-12]` `[N-13]` · **not yet built** | HIGH |
| DRIFT-027 | UC-06 | **The `automatable` pre-check gates nothing**, so the zero-touch path the spec branches on does not exist | ✅ **DECIDED 2026-08-21 — remedy (a), wire it** · `[A-9]`…`[A-13]` · **not yet built**. The trap is inseparable from the remedy: one live capture answers `false` and `mockServer.js:3222` hard-codes `false`, so `[A-10]`'s fabricated `true` fixture with the **positive test leading** is part of the same unit of work. `M-1` measures first | HIGH / MEDIUM |
| DRIFT-028 | UC-06 | Two of this project's own documents disagree about whether the `automatable` endpoint exists | ✅ **DECIDED 2026-08-21 — RECONCILE** · `[A-14]` `[A-15]` · **not yet built**. Of the three absences that sentence names, **two are now known false** (UC-06's, UC-05's) and UC-07's has never been re-checked → DRIFT-099 | HIGH |
| DRIFT-029 | UC-06 | §15 names a write the code retired two days before that row was last edited | ✅ **DECIDED 2026-08-21 — RECONCILE** · `[A-16]` `[A-17]` `[A-18]` · **not yet built**. Retired write kept struck through, not deleted; `patchEmploymentBasicInformation()` stays (other use cases' tests use it) | HIGH |
| DRIFT-030 | UC-06 | The success outcome is reachable only through a projected payroll cycle, and has never occurred in production | ✅ **DECIDED 2026-08-21 — KEEP_CURRENT (projection) + RECONCILE (docs)** · `[A-19]`…`[A-22]` · **not yet built**. The owner's original instruction is now on the record and dated. And the docs' implication is corrected: production is stopped by the **roster**, not the calendar — 9 of 26 refusals `schema_invalid`, only 1 `no_matching_payroll_cycle` | HIGH |
| DRIFT-031 | UC-06 | The stand-in's stated reason for existing has been retired; the specified webhook is now buildable | ✅ **DECIDED 2026-08-21 — RECONCILE** · `[A-23]` `[A-24]` · **not yet built**. Reframed as a credential-free demonstration of the human's entry point. **Subscribing `contract_amendment.submitted` stays `OPEN`** — decide it together with `[A-30]` | HIGH |
| DRIFT-032 | UC-07 | **UC-07 makes no Remote API call at all**, so every gate input is a claim — and neither half of the specified conflict check exists | ✅ **DECIDED 2026-08-21 by the owner** · *"if there is a way to leverage Remote Sandbox and get the info we need, let's do that… also a fallback so the demo won't fail live"* · a **read-only façade** of exactly six methods (not the full client used with discipline — the structural test greps for write-method *names*, and a client that merely COULD write names nothing) + the conflict check at the **published** paths · `R-1`…`R-7`, `R-27` · **`R-1` before `R-6`** · **not yet built** | HIGH |
| DRIFT-033 | UC-07 | Identity is never verified on either path, and a retired employment id is accepted as the actor | ✅ **DECIDED 2026-08-21 by the owner** · *"I think it is best if identity is verified"* · three paths, failing closed on `null` — asserted against a record that genuinely cannot be read, because `null === null` passing is the defect UC-06/UC-09 shipped · buildable **only because DRIFT-032 was decided the same day** · `R-8`…`R-10` · **not yet built** | HIGH |
| DRIFT-034 | UC-07 | **Every Zendesk-originated dossier is BLOCK, from an empty plan** — verified on all seven production rows | ✅ **DECIDED 2026-08-21 by the owner** · *"how exactly are customers supposed to access Zendesk? That is why we use our own UI"* · **the portal becomes primary intake**; a Zendesk-originated request yields `NOT_ASSESSABLE`, never a verdict · **(b) then (a), both** · evidenced by `INTAKE-RESEARCH.md` §75 — Remote's own Country Transfer Service is a structured, **employer-driven** form · `R-11`…`R-13` · **not yet built** · **NOT generalised to UC-08** → `G4` | HIGH |
| DRIFT-035 | UC-07 | The drafted, never-submitted paperwork — one of the two things this use case ships — does not exist | ✅ **DECIDED 2026-08-21 by the owner** · *"Build it, we can't claim to have something and not ship"* · **rendered documents, never serialised payloads**, and `R-16` (extend the no-execution assertions) lands **before** `R-14` (the generator) · the invariant is satisfied **vacuously** today · `R-14`…`R-16` · **not yet built** | HIGH |
| DRIFT-036 | UC-08 | Embedding retrieval is **unreachable from every production entry point**, not merely unseeded | HUMAN_DECISION_REQUIRED → ✅ **DECIDED** — do **not** seed; correct the status rows to *"keyword, embedding path built and not wired"*; replace the three hand-written passages with a **country-filtered lexical index** over the 106 real passages, as one decision with UC-07. **Not yet built** (`T-26`/`T-27`) | HIGH |
| DRIFT-037 | UC-08 | **The specialist-facing dossier is computed on every read and dropped by the only client that renders it** — the sidebar prints `null day(s) across 0 period(s)` beside a 183-day citation | RECONCILE → ✅ **DECIDED** — pass the whole view through `loadUc08()`; render `presence.statement`, `openQuestions`, `citationCoverage.scope`. The `null day(s)` render is fixed **first and separately**. One test must read the API response, because a test of the producer cannot fail on a defect in the consumer. **Not yet built** (`T-8`…`T-10`) | HIGH |
| DRIFT-038 | UC-08 | The mandatory disclaimer is attached to a message no surface sends, and its 100% coverage invariant is a hardcoded literal | RECONCILE → ✅ **DECIDED** — two artifacts for two readers: the specialist gets the dossier, the **employee gets the outcome**. Derive `disclaimerApplied`; render the acknowledgement; build the aftermath in UC-07's `R-24` shape. **Blocked on DRIFT-109. Not yet built** (`T-11`…`T-15`) | HIGH |
| DRIFT-039 | UC-08 | The presence-day count is arithmetic over self-declared records in a caller-chosen window, where the spec specifies Remote's own data | RECONCILE → ✅ **DECIDED** — and the finding is right about the gap while deferring to a source that cannot work (**DRIFT-106**). Real reads exist (**DRIFT-107**) behind a read-only façade; provenance in the same sentence as the count; the instrument's own window printed beside the window used. **Not yet built** (`T-1`…`T-5`) | HIGH |
| **DRIFT-040** | **cross-cutting** | **The measurement layer measures two of nine use cases** | HUMAN_DECISION_REQUIRED → ✅ **DECIDED** — build the reading-side adapter for **all nine**, reading the multi-slot stores as second sources rather than forcing them into `review_queue`; plus a decision-string map per tier. **Guard `findIntegrityBreaches()` first** — its premise is false for UC-09. Closes issue #20. **Not yet built** (`B1`, `[P-23]`…`[P-27]`) | HIGH |
| **DRIFT-041** | **cross-cutting** | No approval anywhere has an expiry, a reminder, or a no-response policy | HUMAN_DECISION_REQUIRED → ✅ **DECIDED** — **age and warn everywhere, lapse nowhere.** Remote publishes exactly one deadline construct (`employment.probation.period_ending_reminder_sent`) and it warns ahead of a boundary and changes no state; Remote models no approval expiry at all. Nothing may become approved **or denied** because time passed. UC-06's clock is Remote's (rung 2, payroll calendar); every other clock is ours (rung 4, labelled). **Not yet built** (`A5`) | HIGH |
| **DRIFT-042** | **cross-cutting** | Three of nine views still name a UUID where a person belongs; two status claims about it are themselves stale | RECONCILE | HIGH |
| **DRIFT-043** | **cross-cutting** | UC-03 → UC-01 routing is implied by the letter classification and does not exist | ⚠️ **MIS-FRAMED — downgrade to RECONCILE.** The two letters are different documents (UC-03's contains UC-01's, plus a journey, cited to Schengen Visa Code Annex A(1)(e)); the boundary is a missing sentence, not a decision. See `contracts/UC-03-acceptance.md` §17c | MEDIUM |
| **DRIFT-044** | **cross-cutting** | Two citation registers share the `C-N` numbering and code cites both | RECONCILE → ✅ **DECIDED** — prefix the **statutory** register `S-N`; one mechanical commit with nothing else in it, and a redirect line left behind because commit messages and code comments already cite the old form. **Not yet built** (`D8`) | HIGH |
| **DRIFT-045** | **cross-cutting** | The shared schema validator checks presence only; five use cases rely on it | HUMAN_DECISION_REQUIRED → ✅ **DECIDED** — lift `effectiveSchema()` into `src/shared/` **for the two write paths only** (UC-06, UC-09) and correct invariant 2 either way; five use cases keep the presence-only validator deliberately, because resolving a conditional wrongly makes us **stricter than Remote**. Own commit, own tests, **positive test leads**. **Not yet built** (`A4`) | HIGH |
| **DRIFT-046** | **cross-cutting** | Both pgvector tables have held zero rows since provisioning — **superseded in strength by DRIFT-036 and DRIFT-071**, which find the embedding path *unreachable*, not merely unseeded | RECONCILE → ✅ **DECIDED** — **correct the claims, do NOT seed.** `npm run seed-vectors` stays unrun; the 106-passage measurement is the argument, and a country-filtered lexical index replaces the hand-written corpus. Consistent with `E15` and `I3`. **Not yet built** (`D9`) | HIGH **2026-08-21: decided-by-recommendation, NOT closed** — the tables stay empty on purpose (`docs/RETRIEVAL.md`, 106 passages, BM25 3/6 vs embeddings 2/6). `npm run seed-vectors` must not be run. |
| **DRIFT-047** | **cross-cutting** | The intake model is documented as two doors; the portal is a third | RECONCILE → ✅ **DECIDED** — document all **three** identity models in §2 (the portal's persona key is the weakest and must be named as such), and build the doors: subscribe Remote's real events, finish the portal's coverage, keep `src/remoteui/` re-described. **An event existing is not a reason to subscribe it as a trigger** — UC-09's `incentive.*` events are a bypass detector, never an intake. **Not yet built** (`D10`) | HIGH |
| **DRIFT-048** | **cross-cutting** | "Built" and "deployed" are two claims, and the repo has been wrong in both directions | HUMAN_DECISION_REQUIRED → ✅ **DECIDED** — every row that can differ between repo and deployment gets **two** columns, *built* and *verified running, with a date*, populated by the four `verify-*` scripts (which exit 2, never 0, when they cannot reach what they check). Plus close the provisioning gaps. **A stale green is worse than a blank.** **Not yet built** (`B2`) | HIGH |
| DRIFT-049 | UC-09 | **Three of the four specified deterministic controls on the money path do not exist anywhere** | HUMAN_DECISION_REQUIRED → ✅ **DECIDED** — **build all four, three different answers**: manager auth at `GET /v1/company-managers` (**not** the `[CONFIRMED]` path §3 names — DRIFT-111); the off-cycle ceiling as **ours**, rung 4, and it **blocks**; gross-to-net **never computed** — Remote grosses it up, so the control is disclosure. `HUMAN_DECISION_REQUIRED` discharged. **Not yet built** (`P-16`…`P-22`, gated on `M-2`) | HIGH / LOW |
| DRIFT-050 | UC-09 | "Requester ≠ approver" is asserted on the approval screen and not enforced against the requester | RECONCILE → ✅ **DECIDED** — **enforce, reading (A)**: the filer may fill the `requester` slot and **no other**; floor of two signatures unchanged; own refusal code, not `same_person_cannot_fill_multiple_roles`. ADR 0005 corrected in the same unit of work (DRIFT-110). **Not yet built** (`P-1`, `P-2`) | HIGH |
| DRIFT-051 | UC-09 | The trigger model describes reacting to a drafted incentive; the implementation reads no draft and creates one | RECONCILE → ✅ **DECIDED** — **remedy (a)**, and the MEDIUM half is now settled **against the spec**: the five `incentive.*` webhooks exist, but Remote's `pending` is *"not yet in a payroll cycle"*, so a created incentive is **already going to be paid** and there is no approval state to transition out of. Creation is the authorisation. The webhooks become a **bypass detector** instead. **Not yet built** (`P-31`, `P-34`, `P-28`…`P-30`) | HIGH / MEDIUM |
| DRIFT-052 | UC-09 | **The LLM is the source of the payment figure** on the only intake that works | RECONCILE → ✅ **DECIDED** — correct §5 to match §6 and the code, **and add the control that could actually catch a wrong figure**: echo it back to the requester **before any signature is collected**. The portal gains an amount field by naming the ×100 units apart, not by withholding it. **Not yet built** (`P-3`…`P-6`) | HIGH |
| DRIFT-053 | UC-09 | The in-doubt payment is preserved for a human, nobody is told, and the queue calls it settled | RECONCILE → ✅ **DECIDED**, and **wider than written** — every UC-09 outcome is silent, not only the in-doubt one (DRIFT-115). All three changes taken, plus a fourth that changes the state's character: the adjustment id goes in Remote's own `note`, so `GET /v1/incentives` answers *did it happen?*. **Not yet built** (`P-7`…`P-15`; `P-9` before `P-15`) | HIGH |
| DRIFT-054 | UC-09 | UC-09 is absent from the metrics layer entirely, including its own integrity invariant | RECONCILE → ✅ **DECIDED** — `uc09_adjustments` as a **second source**; accept rate `executed/(executed+denied)`; the integrity invariant as a query reading zero; closes issue **#20**. **`P-24` first** — `findIntegrityBreaches()`'s premise is false for the one 🔴 with an execution path. **Not yet built** (`P-23`…`P-30`) | HIGH |
| DRIFT-061 | UC-06 | The payroll lock is computed once, at request time, and never re-checked at the moment it expires | ✅ **DECIDED 2026-08-21 — RECONCILE** · `[A-25]`…`[A-29]` · **not yet built**. Distinct code `cutoff_lock_passed_since_decision` — *you asked too late* and *we took too long* are different conversations. Sub-decision answered: re-alert on the refusal, not on a timer | HIGH |
| DRIFT-062 | UC-06 | Every UC-06 ticket that exists was created without the routing tag or group its own row names | ✅ **DECIDED 2026-08-21 — RECONCILE** · `[A-30]` `[A-31]` `[A-32]` · **not yet built**. Copy `src/portal/server.js:1417+`, never re-derive. `Payroll Ops` = `6168442797343` exists, so this is wiring not provisioning — and it fixes the **next** hand-off, never the backlog | HIGH |
| **DRIFT-063** | **UC-05** | **The resignation endpoints this repo and `00-FOUNDATION.md` both say do not exist are documented, live, and include a write shaped like UC-05's own sign-off form** | ✅ **DECIDED** (7th pass) — correct the record first `[N-1]`, probe and write the probe down `[N-2]`, then **read; the write is deferred on its own decision**. **Claim 4 upgraded MEDIUM → HIGH: §0's business case is false, not merely unsafe** — `days_of_notice` exists and Remote computes the notice period. `[N-5]` · **not yet built** | HIGH |
| DRIFT-064 | UC-05 | Sign-off is defined by a communication no surface performs — and the unconfirmed figures reach the employee first | ✅ **DECIDED** (7th pass) — owner's ruling: **the employee sees nothing until sign-off.** Acknowledgement at submission; figures released on sign-off to the portal and the ticket. **No email, no new channel.** Produces a *testable* invariant §5/§8/§9 have asserted since the contract was written and nothing has ever enforced. `[N-14]` `[N-15]` · **not yet built** | HIGH |
| DRIFT-065 | UC-05 | None of §11's four metrics is computed, and UC-05 writes no row the dashboard reads | ✅ **DECIDED** (7th pass) — a **second metrics source over `audit_log`'s decision actions**, not seven stores writing thin `cases` rows: the audit log covers both execution paths, is append-only, and adding writes to seven stores adds failure modes on the durable-write path. **Cross-cutting — its own pass.** Interim: §11 says *not computed* for all four. `[N-16]` · **not yet built** | HIGH |
| DRIFT-066 | UC-05 | Reader-facing sentences still describe a system that changed underneath them | ✅ **DECIDED** (7th pass) — derive the count, fix the two header paragraphs, branch the empty-balance sentence on `ptoSource`, **and add a guard test** banning hard-coded country counts in `src/uc05/` — this is the second occurrence, one file over from where the rule was written down. `[N-17]` · **not yet built** | HIGH |
| DRIFT-067 | UC-08 | The headline success metric cannot be computed, by the same guarantee that is the headline artifact | HUMAN_DECISION_REQUIRED → ✅ **DECIDED** — measure **outside the record**: outcome verbs, reopen rate, escalation→first-comment; plus `openQuestions` completeness, free today. **A status column must not be added to make a metric computable.** **Not yet built** (`T-16`/`T-17`/`T-28`) | HIGH |
| DRIFT-068 | UC-08 | Five of six evaluation tracks, the work-authorization gate and MONITORING do not exist — and the spec's own header calls that architecture the backbone | RECONCILE → ✅ **DECIDED** — restate the header **now**; then MONITORING as a read-time staleness statement; then tracks A/C/D, then B. **Track E stays unbuilt** (licence: OECD/BEPS paraphrase-only) and **Track F is never built** (a 🔴 verdict must not gate another use case). **Not yet built** (`T-18`…`T-22`) | HIGH |
| DRIFT-069 | UC-08 | UC-08 verifies no identity, and the n8n normaliser derives one and discards it | RECONCILE → ✅ **DECIDED** — **no gate** (refusing a tax question for want of identity is the wrong failure), but mark the id `verified`/`claimed`, wire the n8n normaliser's discarded session, and scope `listByOwner()` reads to a verified subject. **Prerequisite of the Remote read.** **Not yet built** (`T-23`…`T-25`) | HIGH |
| DRIFT-070 | UC-07 | The management fee is presented as CALCULATED on a rate this repository invented | ✅ **DECIDED 2026-08-21 by the owner** · *"let's stick with Remote's documentation"* — **stricter than the recommendation**: no third status, the **12% default is deleted** and the fee becomes `QUOTE_REQUIRED` like its two siblings · F-37's pinned term totals change, and that is the fix working · `R-17`…`R-19` · **not yet built** | HIGH |
| DRIFT-071 | UC-07 | Embedding retrieval runs on its keyword leg in every environment, and its table would take zero rows even from a full seed | ✅ **DECIDED 2026-08-21** · KEEP_CURRENT on the mechanism, RECONCILE every description · **the table is dropped**, not annotated — it would take zero rows even from a full seed, and one that can never hold a row invites someone to fill it · nothing is lost: the seed script and `docs/RETRIEVAL.md` remain the evidence that the pipeline was built, measured at 106 passages, and deliberately not run · `R-20` | HIGH |
| DRIFT-072 | UC-07 | The read-time derivation returns nothing for every dossier that exists | ✅ **DECIDED 2026-08-21** · both parts; **(a) is not optional** — the n8n node can be rolled back independently of `src/`, so the old shape can reappear with no commit · an unrecognised shape becomes a **stated** unknown, never `?? {}` · `R-21`, `R-22` · **not yet built** | HIGH |
| DRIFT-073 | UC-07 | A portal-submitted dossier reaches nobody, and nothing anywhere can record that it was read | ✅ **DECIDED 2026-08-21 by the owner** · *"should the demo not include an aftermath instead of saying no button at all, because the employee who filed is expecting feedback"* · ticket **raised without being linked** (id travels record → ticket only) + outcome verbs **on the ticket**, never on the store · **`none_by_design` unchanged; no approve route added** · `R-23`, `R-24` · **not yet built** · **does not close DRIFT-041** | HIGH |

---

## Cross-cutting findings, in full

---

### SPEC_DRIFT · DRIFT-040 · The measurement layer measures two of the nine use cases

**Original/documented behaviour:** The measurement layer is the portfolio's
stated differentiator. `docs/METRICS.md` and every UC spec's §11 define
per-use-case metrics: auto-resolution rate and decision mix per use case and per
tier, ranked exception reasons, specialist accept rate, integrity breaches that
must read zero, and a "stop automating" verdict.

**Current implementation:** `src/metrics/compute.js` derives `byUseCase` from the
`cases` table and joins `review_queue` to it for the accept rate:

```js
const useCaseIds = [...new Set(cases.map((c) => c.useCase))].sort();
```

**Only `src/uc01/workflow.js` and `src/uc03/workflow.js` call
`caseStore.createCase()`.** The other seven use cases each own a separate table —
`uc02_expenses`, `uc04_authorizations`, `uc05_resignations`, `uc06_amendments`,
`uc07_dossiers`, `uc08_dossiers`, `uc09_adjustments` — and write no `cases` row.
So seven of nine use cases produce **no rows in `byUseCase` at all**: not a zero
auto-rate, not an `insufficient_data` verdict — simply absent.

Compounding it, the decision buckets recognise three strings:

```js
auto_resolve: …, human_review: …, escalate: …
```

The real decision vocabulary across the nine also includes `auto_approve`,
`blocked`, `out_of_scope`, `ready_for_approval`, `prepared_for_signoff` and
`dual_approval_required`. Even for a use case that *did* write a `cases` row,
those decisions fall into none of the three buckets while still counting toward
`total`, so `autoRate = counts.auto_resolve / total` would understate.

**Current tests assume:** `test/metrics.test.js` exercises the computation over
`cases`/`review_queue` rows it constructs itself. It does not assert coverage of
the nine, so nothing goes red.

**Difference:** the dashboard the role is graded on reports on UC-01 and UC-03.
Seven use cases — including every one that moves money or changes a contract —
are invisible to it.

**Evidence:** `src/metrics/compute.js:571–598`; `src/uc01/workflow.js` and
`src/uc03/workflow.js` are the only `createCase()` callers;
`grep -rl "caseStore" src/uc0{2,4,5,6,7,8,9}/` returns only each use case's own
store, referencing `caseStore.js` as a pattern in comments.

**Likely reason:** establishable in outline. UC-06 and UC-08's stores were built
deliberately separate from `review_queue` — `src/uc06/amendmentStore.js`'s header
argues it, correctly, because `review_queue` has one status slot and dual control
needs two. The other five followed that precedent. What appears never to have
happened is the corresponding change at the reading end: no adapter was written
to let `compute.js` see the seven per-use-case tables.

**Risk if left as-is:** the "stop automating" verdict, the integrity-breach count
that must read zero, and the exception ranking that decides what to fix next all
silently exclude the medium and high tiers. A 🔴 integrity violation in UC-09
would not appear in the invariant count. And the honest-gaps list's own numbers
(*"UC-06 has never once recorded `dual_approval_required`"*) were obtained by
querying `audit_log` by hand, not from this dashboard — which is itself evidence
the dashboard could not answer it.

**Recommendation:** HUMAN_DECISION_REQUIRED — the fix is a reading-side adapter
(a per-use-case row provider) plus a decision-string mapping, and it is a
day of work, not a patch. It should be decided before the demo, because the
measurement layer is the thing being demonstrated.

**Confidence:** HIGH

---

### SPEC_DRIFT · DRIFT-041 · No approval anywhere in the system has an expiry, a reminder, or a no-response policy

**Original/documented behaviour:** No UC spec addresses it. `00-FOUNDATION.md`
§5 defines the tiers by *who approves*, never by *what happens if nobody does*.

**Current implementation:** none of the seven approval surfaces implements a
timeout, a reminder, a re-notification, an auto-escalation, or a lapse. A drafted
UC-03 letter, a `ready_for_approval` UC-04 case, a half-approved UC-06 amendment
and a half-approved UC-09 disbursement all wait indefinitely.

**Current tests assume:** no time dimension exists.

**Difference:** the specs treat "a human approves" as a step that completes. In
production it is a step that may never complete, and nothing notices.

**Evidence:** `src/uc04/approvalPolicy.js`, `src/uc05/signoffPolicy.js`,
`src/uc06/dualApprovalPolicy.js`, `src/uc09/multiApprovalPolicy.js`,
`src/uc03/signoffPolicy.js`, `src/review/reviewPolicy.js`,
`src/uc02/reviewPolicy.js` — none carries a clock. The approval queue reports
"waiting" without an age threshold that changes anything.

**Likely reason:** never specified.

**Risk if left as-is:** it has already happened. 43 records are waiting on a
person; 36 of them have nowhere to be approved; 15 tagged tickets sit in the
account default group; ticket #51's record was approved somewhere other than its
ticket and nothing closed the ticket. UC-06 in particular has a **hard clock** —
the payroll cutoff — and an amendment that misses it becomes a retroactive
payroll error, which is the exact failure §9 of its spec names.

**Recommendation:** HUMAN_DECISION_REQUIRED. At minimum a per-use-case
"waiting longer than X" verdict on the approval queue; for UC-06 specifically, an
expiry tied to the cutoff rather than to an elapsed duration.

**Confidence:** HIGH

---

### SPEC_DRIFT · DRIFT-042 · Three of the nine views still name a UUID where a person belongs — and two status claims about this are themselves stale

**Original/documented behaviour:** the project owner, reading the live sidebar:
*"In that Zendesk bar I never even saw any relevant info of the employee — not
even name. That is bad."* Each spec's §17/§18 records the fix.

**Current implementation:** `src/shared/employeeSubject.js` publishes a shared
five-state shape (`available`, `not_found`, `unavailable`, `not_looked_up`,
`no_employment_id`) and `zaf-app/assets/main.js` has a real `renderEmployee()`
that prints the name as the card heading and renders an absence as a **row, never
a blank**. Read live from the source on 2026-08-20, the module is imported by
**six** of the nine use-case servers — `uc02`, `uc03`, `uc04`, `uc05`, `uc06`,
`uc09`. It is imported by **none** of `src/review/server.js` (which serves UC-01),
`src/uc07/server.js` or `src/uc08/server.js`.

**Current tests assume:** `test/employeeSubjectAcrossUseCases.test.js` asserts
**four** views — its own lead test is titled *"all four views publish `employee`
and `requester` with identical keys"* and drives UC-02, UC-05, UC-06 and UC-09.
So two of the six adopters (UC-03, UC-04) are unasserted by it, and the three
non-adopters cannot fail a test that never looks at them. **Nothing anywhere
fails when a view omits the person.**

**Difference:** three views — UC-01, UC-07, UC-08 — still answer the specialist's
first question with an identifier. Two of those three are the 🔴 dossiers, where
the reader is a legal or tax specialist acting on a document about a named person.

**Two stale status claims found while checking this, and both were in the
direction of understating the work done:**
- `CLAUDE.md`'s pending list says *"all nine ZAF panels print a bare UUID under
  Employee (only UC-09 fixed)"*. Six publish it.
- `zaf-app/assets/main.js:583`'s own comment says *"seven of the nine publish no
  `employee` today"*. Three do not.

**Evidence:** `grep -ln employeeSubject src/uc0*/server.js src/review/server.js`
→ six matches, 2026-08-20; `zaf-app/assets/main.js:578–600`;
`src/shared/employeeSubject.js`.

**Likely reason:** the shared mechanism was built and rolled out one server at a
time; the rollout reached six and the status notes were written at two different
earlier points in that rollout.

**Risk if left as-is:** a specialist reading a 🔴 relocation or tax dossier
cannot see who it concerns without leaving the screen. Separately, the two stale
claims are a live example of DRIFT-048's understatement direction — a reader
believing "only UC-09 is fixed" would redo six panels' worth of finished work.

**Recommendation:** RECONCILE — add `employeeSubject` to the three remaining
views, widen the cross-use-case test from four to nine so a future omission goes
red, and correct both stale claims in the same unit of work.

**Confidence:** HIGH on the six/three split and on the four-view test coverage
(both read from the source). MEDIUM on whether each of the six also *renders*
correctly end to end, which this pass did not drive.

---

### SPEC_DRIFT · DRIFT-043 · UC-03 → UC-01 routing is implied by the letter classification and does not exist

**Original/documented behaviour:** neither spec claims it.

**Current implementation:** UC-03 classifies letter requests and owns a travel
support letter. UC-01 owns the employment verification letter. A requester asking
for "a letter proving I work here, for my visa appointment" can land in either,
and there is no route between them in either direction.

**Current tests assume:** nothing.

**Difference:** a boundary neither spec draws. `test/uc03LetterScope.test.js`
explicitly tests that "my visa appointment at the consulate" must **scan clean**
in UC-03 — so the phrase is known to be ambiguous and the handling is "do not
over-trigger", not "route to the use case that owns it".

**Evidence:** `src/uc03/classifier.js:42`; `docs/use-cases/UC-03.md` §12.16;
`src/uc01/policyEngine.js` gate 6 (`non_standard_request`).

**Likely reason:** cannot be established from the repository. The two use cases
were built in different passes and no document draws the boundary between their
letter types.

**Risk if left as-is:** a requester is refused by one use case for being
out of scope and never reaches the one that owns their request. UC-01's
`out_of_scope` path records nothing (DRIFT-003), so this would be invisible.

**Recommendation:** HUMAN_DECISION_REQUIRED — decide the boundary between the two
letter families and write it into both specs, before deciding whether a route is
needed.

**Confidence:** MEDIUM

---

### SPEC_DRIFT · DRIFT-044 · Two citation registers share the `C-N` numbering, and code cites both

**Original/documented behaviour:** each register is internally consistent.

**Current implementation:** `docs/knowledge/layer-1-statutory/CONTRADICTIONS.md`
numbers its findings `C-1`…`C-30` (statute versus code).
`docs/CORRECTIONS-LOG.md` numbers its own `C-1`…`C-31` (user-reported
corrections). Both are cited from code: `src/uc05/decisionSources.js` cites `C-18`
meaning the first; `src/shared/decisionFacts.js` cites `C-31` meaning the second.

**Current tests assume:** nothing — no test distinguishes the registers.

**Difference:** a reader following a citation can land on a confident, specific,
entirely unrelated finding.

**Evidence:** `grep -cE '^### (C|K)-' docs/knowledge/layer-1-statutory/CONTRADICTIONS.md`
→ 34; `docs/CORRECTIONS-LOG.md`; the two citing modules.

**Likely reason:** the two registers were created in different passes and neither
knew about the other.

**Risk if left as-is:** low probability, high consequence — a statutory citation
is exactly the thing a specialist would follow to defend a decision, and this is
the one class of fact §5 of the design standard says may never be stripped or
weakened.

**Recommendation:** RECONCILE — prefix one register (`S-N` for statutory, or
`UX-N` for corrections). Renaming a citation scheme touches files across the
repo, which is why the earlier pass declined to do it in flight.

**Confidence:** HIGH

---

### SPEC_DRIFT · DRIFT-045 · The shared schema validator checks presence only, and five use cases rely on it

**Original/documented behaviour:** `00-FOUNDATION.md` §4 invariant 2 —
*"Before any write, query the active country schema and validate the payload
against it. Never assume static fields."* Presented as a complete control.

**Current implementation:** `src/shared/schemaValidator.js` is a **presence**
validator, and its own header says so: *"It does not check types, formats or
bounds."* It reads `required`, and consults a field's `type` for exactly one
purpose — deciding whether `null` satisfies a required field. It reads no
conditional `allOf` rules (**81 on the live USA `contract_details` form, 72 on
Canada's**), no `minimum` (including 34 US per-state hourly floors), and no
`properties: {x: false}` prohibition. `src/uc06/policyEngine.js`'s
`effectiveSchema()` **does** resolve `if`/`then`/`else`; the other use cases
reach for the shallow shared one.

**Current tests assume:** presence checking.

**Difference:** invariant 2 reads as "the payload is valid for this country". What
is enforced is "every required field is present".

**Evidence:** `src/shared/schemaValidator.js` header;
`src/uc06/policyEngine.js`'s `effectiveSchema()`; `CLAUDE.md` §7 honest-gaps
item 5.

**Likely reason:** deliberate, and the reasoning is sound: resolving a branch
wrongly makes validation **stricter than Remote** and starts refusing valid
payloads — a new failure rather than a fix.

**Risk if left as-is:** a payload passing every required field but violating a
conditional rule is written to Remote and refused there, or accepted and wrong.
The risk is concentrated in UC-06 and UC-09 — the two write paths that touch
contracts and money.

**Recommendation:** HUMAN_DECISION_REQUIRED — lift `effectiveSchema()` into
`src/shared/` for the two write paths only, or state the limit explicitly in
invariant 2 so nobody reads it as more than it is. Doing neither is the only
wrong answer.

**Confidence:** HIGH

---

### SPEC_DRIFT · DRIFT-046 · Both pgvector tables have held zero rows since the day they were provisioned

**Original/documented behaviour:** `UC-08.md` §3 tags treaty retrieval
**[BUILT — issue #29]**, *"embedding-similarity search"*, keyword matching only
*"when unconfigured"*. UC-07's mobility retriever is described the same way.

**Current implementation:** the code is real. The data is not:
`uc07_mobility_citation_vectors` and `uc08_treaty_citation_vectors` are both
`count(*) = 0`, queried live against project `your-project-ref` on
2026-08-20. Both retrievers therefore run **permanently on their keyword leg**.

**Current tests assume:** both legs, with fakes. Nothing asserts the table is
populated, and nothing could — a hermetic test must not reach a database.

**Difference:** every status row in `CLAUDE.md`, `README.md`,
`docs/BUILD-LOG.md`, `UC-07.md` and `UC-08.md` describing this as embedding
similarity is **true of the code and false of the running system**. It is the
same built-versus-deployed gap as DRIFT-048, wearing different clothes.

**Evidence:** live `count(*)` on both tables, 2026-08-20; `docs/RETRIEVAL.md`
(commit `2aef4da`), which reaches the same conclusion from the other direction.

**Likely reason:** establishable. `npm run seed-vectors` exists and
`docs/RETRIEVAL.md` **recommends not running it**, arguing from a measured corpus
of **106 passages** — at which size a vector index buys nothing over keyword
matching. So the tables are empty on purpose.

**Risk if left as-is:** none technically. The risk is entirely one of honesty:
the repository claims a capability it is deliberately not using, in the two use
cases whose output is legal research a specialist relies on.

**Recommendation:** RECONCILE — change the status rows to say what runs, cite
`docs/RETRIEVAL.md`'s measurement as the reason, and keep the code. **Do not run
`npm run seed-vectors` without explicit approval** — it costs money and the
project's own measurement says not to.

**Superseded in strength, and by two independent agents.** This finding says the
tables are empty. Both use-case passes found something stronger and found it
separately: **DRIFT-036** establishes that `configureTreatyRetriever()` is called
from no file in `src/` or `scripts/`, so every production caller leaves the
retriever null and the embedding leg is **unreachable, not merely unseeded** —
either fact alone forces keyword matching. **DRIFT-071** reports the same for
UC-07 and adds that its table would take zero rows *even from a full seed*.
Read those two as the finding; this one as the symptom that led to them.

**Confidence:** HIGH

---

### SPEC_DRIFT · DRIFT-047 · The intake model is documented as two doors; the portal is a third

**Original/documented behaviour:** `00-FOUNDATION.md` §2 — *"Two entry paths, not
one"*: a Remote-native webhook (02, 04, 05, 06, 09) or a Zendesk ticket
(01, 03, 07, 08). The diagram shows exactly these two.

**Current implementation:** `src/portal/` is a real, deployed, key-gated intake
for **seven** use cases — 02, 03, 04, 05, 07, 08, 09 — spanning both documented
categories. Its Remote reads are the **mock fixtures dispatched in-process**, on
purpose, while its stores are the real pooled ones, so submissions land in real
Supabase. `src/remoteui/` is a fourth door for UC-06.

**Current tests assume:** the portal exists and is tested extensively
(`test/portal*.test.js`, 20+ files).

**Difference:** §2 is the document a new engineer reads to learn how a request
enters this system, and it describes two of the four ways.

**Evidence:** `src/portal/requestTypes.js` (seven types); `src/portal/server.js`
`createInProcessFetch()`; `docs/00-FOUNDATION.md` §2.

**Likely reason:** the portal was built after §2, to make the E2E test plan
runnable without a clone; §2 was never revisited.

**Risk if left as-is:** moderate and specific. A reader reasoning about identity
from §2 concludes every intake carries either a Remote-authenticated webhook or a
Zendesk-authenticated requester. The portal carries **neither** — it is gated by a
shared `PORTAL_ACCESS_KEY` and identifies its user by a persona **key** resolved
server-side. That is a deliberate and defensible third identity model, and it is
undocumented in the file that defines identity.

**Recommendation:** RECONCILE — add the portal (and `src/remoteui/`) to §2 as
what they are, and state their identity model beside the other two.

**Confidence:** HIGH

---

### SPEC_DRIFT · DRIFT-048 · "Built" and "deployed" are two claims, and this repository has been wrong in both directions

**Original/documented behaviour:** every spec's §15 is a build-status table, and
`CLAUDE.md` §7 prime directive 7 makes honest status load-bearing:
*"a reviewer who catches one overstatement discounts everything else."*

**Current implementation:** the gap between the two claims is systemic, not
incidental. Instances found or re-confirmed by this pass:
- The **ZAF app is a static upload**. Editing `zaf-app/assets/` changes nothing in
  Zendesk until `zcli apps:update` runs, and the account will serve an hours-old
  bundle while the repo, the tests and every reviewer agree on the new behaviour.
- The **n8n graphs** ran superseded bodies for a day with nothing recording it,
  including a routing table that sent routine UC-04 approvals to the Tier-2 legal
  queue — the exact defect the current file's header describes as fixed.
- `APPROVER_ROLES` was **built and unprovisioned** for two days, so every approve
  on the public deployment refused by its own name.
- The **pgvector tables** (DRIFT-046) are provisioned and empty.
- The **duplicate-hash column** (DRIFT-010) is a provisioning step, not a code
  change — **but not a free one.** The fifth pass found that provisioning it
  makes the SQL duplicate check as strict as the in-memory one, which turns a
  rare **false block** into a permanent one, on a verdict with no appeal route.
  `E-3` (DRIFT-087) has to land before or with it.

And in the other direction — understatement, which this pass found repeatedly:
`UC-02.md` §15 denied a review queue that existed (DRIFT-009);
`CLAUDE.md` §7 listed three closed `src/remote/` issues as open for two days;
UC-06's §15 write-target row appears to describe a call the code no longer makes.

**Current tests assume:** nothing about deployment. The suite is hermetic **by
design**, which is correct and is precisely why it cannot catch any of this.

**Difference:** the status tables answer "is it in the repository?" and are read
as answering "is it running?".

**Evidence:** `CLAUDE.md` §4 and §6; `docs/ESCALATION-DESTINATIONS.md` §0;
`npm run verify-deployed`, `verify-claims`, `verify-traces`, `verify-live-uc01` —
all four of which **exit 2, never 0, when they cannot reach what they check**, so
a skipped check can never be misread as a passing one.

**Likely reason:** structural. Hermetic tests and a live deployment are two
different questions, and only one of them has a checker that runs on every commit.

**Risk if left as-is:** the highest-consequence risk in this pass, because it
undermines every other artifact. A contract in `qa/` describing intended behaviour
is worth nothing if a reader cannot tell whether the running system implements it.

**Recommendation:** HUMAN_DECISION_REQUIRED — every status row that can differ
between repo and deployment should carry **two** columns, *built* and *verified
running, with a date*, and the four `verify-*` scripts should populate the second.
The E2E pass this reconciliation precedes is the natural place to establish the
first set of dates.

**Confidence:** HIGH
