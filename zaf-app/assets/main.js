/* ---------------------------------------------------------------------------
 * main.js  —  The shared sidebar shell
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS
 * This is the 🟡 human-in-the-loop gate, as a thing an agent can actually click.
 * It reads the current ticket's case from the review API, shows what the
 * automation decided and why, and — only when the API says the case is
 * actionable — offers approve/decline.
 *
 * THREE RULES THIS FILE FOLLOWS, ALL FOR THE SAME REASON
 *
 * 1. It holds no credentials. A ZAF bundle is downloadable by anyone with an
 *    agent seat, so every secret stays in src/review/server.js.
 * 2. It decides nothing. `actionable` comes from the API. The UI never
 *    re-derives from `decision`/`status` whether a button belongs on screen —
 *    that rule lives in exactly one place (src/review/reviewPolicy.js).
 * 3. It writes every dynamic value with textContent, never innerHTML. The
 *    content on this screen originated in a support ticket, which is untrusted
 *    text.
 *
 * All three collapse into: the sidebar is a view and a pair of buttons. The
 * moment it starts knowing things, there are two copies of the rules.
 *
 * Plain ES5-flavoured browser JS with no build step, matching the repo's
 * "clone and run in one command" convention.
 * ------------------------------------------------------------------------- */

(function () {
  "use strict";

  var client = window.ZAFClient ? window.ZAFClient.init() : null;
  var root = document.getElementById("root");

  /* TWO FACTS, TWO TABLES, AND THE REASON THEY ARE NOT ONE.
     ---------------------------------------------------------------------
     THE BUG THIS SHAPE EXISTS TO MAKE IMPOSSIBLE. This file used to hold one
     table keyed by a field called `tier`, whose `high` row read "no execution
     path exists — this can only be escalated". The APIs send the ESCALATED
     CASE RISK under that key (classifyRisk() raises any flagged case), so a
     Schengen-to-Schengen workation (DE→PT) that was `ready_for_approval`,
     `actionable`, and carried one advisory flag rendered that 🔴 architectural
     guarantee in a red rail at the top of the panel — directly above its own
     working Approve button. UC-04 is a 🟡 use case; a named human approving in
     ZAF IS its execution path. One screen, two contradictory claims, and the loud one was
     false.

     So the sentence that makes a promise about what MAY happen is no longer
     derived from a risk level at all. It is keyed to `view.executionModel`, a
     separate field that describes the USE CASE and never a request, computed
     server-side by describeRiskPosture() (src/shared/riskEngine.js). Only
     `none` prints the 🔴 guarantee, and only UC-07 and UC-08 send `none`.

     BOTH TABLES ARE PRESENTATION ONLY. Neither decides anything: a key with no
     row simply renders no sentence, which is the safe direction — an unknown
     execution model must never fall through to a claim about execution. And
     `view.actionable` remains the ONE question that gates a control; nothing
     here is consulted for that. */

  /* The use case's own tier — architectural, fixed, and never escalated by
     anything a request does. UC-01–03 🟢, UC-04–06 🟡, UC-07–09 🔴. */
  var USE_CASE_TIERS = {
    low: { glyph: "🟢", name: "Low-risk use case" },
    medium: { glyph: "🟡", name: "Medium-risk use case" },
    high: { glyph: "🔴", name: "High-risk use case" },
  };

  /* What the use case is allowed to do with a decision — the operative half of
     the rail, and the only place the 🔴 guarantee is spelled. "Medium risk"
     alone tells an agent nothing they can act on; "a named human must approve
     before anything is written" does. */
  /* Full sentences, capitalised, since 2026-08-19. They used to be clauses
     because they were printed as the tail of "Medium-risk use case — …". The
     tier headline is gone (see renderTierRail) and a clause starting lowercase
     with no stem in front of it reads as a fragment. */
  /* THE SUBJECT OF EVERY ONE OF THESE SENTENCES IS THE USE CASE, and it is
     named (2026-08-19). They used to read "A named human must approve before
     anything is written", which is true of the use case and was read as a
     promise about the request — including on an ESCALATED case where nobody can
     approve anything, three lines above the server saying so. Naming the
     subject costs three words and makes the misreading unavailable. */
  var EXECUTION_MODELS = {
    automatic: "This use case resolves on its own; a human is involved only by exception.",
    single_approval: "Nothing in this use case is written until a named human approves it.",
    dual_approval: "Nothing in this use case is written until two named humans in different roles both approve.",
    multi_role_approval: "No money moves in this use case until at least two named humans in separate roles approve.",
    none: "In this use case no execution path exists at all — a case can only be escalated.",
  };

  /* This request's own risk, which is a different sentence about a different
     thing. Kept beside the rail rather than inside it, and worded so it can
     never be read as a statement about what the system may do: it says what
     was found, not what is permitted. "classified", never "scored" — UC-04.md
     §7 forbids collapsing these dimensions into a score, and the panel must not
     imply one exists. */
  var CASE_RISK_WORDS = { low: "low", medium: "medium", high: "high" };

  /* Decision string -> the words an agent reads. PRESENTATION ONLY: it renames
     nothing and decides nothing — an entry missing here falls through to the
     server's raw string, which is still correct, just uglier.

     It covers all nine use cases on purpose. It used to list four, which meant
     the same sidebar said "Auto-resolved" on a UC-01 case and `prepared_for_
     signoff` on a UC-05 one — one surface speaking two vocabularies, which
     reads as unfinished rather than as deliberate transparency. Every string
     below is one a src/uc0N/policyEngine.js actually returns. */
  var DECISION_LABELS = {
    auto_resolve: "Auto-resolved",
    auto_approve: "Auto-approved",
    human_review: "Awaiting review",
    route_to_uc04: "Routed to work authorization",
    ready_for_approval: "Awaiting specialist approval",
    prepared_for_signoff: "Awaiting sign-off",
    dual_approval_required: "Awaiting dual approval",
    triple_approval_required: "Awaiting triple approval",
    off_cycle_adjustment_required: "Awaiting multi-role approval",
    escalate: "Escalated",
    blocked: "Blocked",
  };

  /* N-1 (rca-il7, 2026-08-22): the badge above used to read straight off
     `c.decision`, which never changes once the automation runs — it is what
     the AUTOMATION decided (`human_review`, correctly, forever), not what
     happened to the case afterwards. A specialist opened ticket #80 minutes
     after approving it and the badge still said "Awaiting review", one
     scroll above the SAME panel saying "A specialist has already decided
     this case." and "Recorded as approved by …". Two true sentences on one
     screen contradicting each other.

     `c.decision` is still correct and is NOT changed by this fix — it is the
     historical record of the automation's own verdict (acceptance §14 needs
     that preserved). What was wrong is reading it as "current state" once a
     human review has actually settled the case. `view.review.status` is the
     field that tracks settlement (`pending` / `approved` / `rejected`,
     src/review/reviewPolicy.js), so the badge now prefers it the moment it
     stops being `pending`, and only then. */
  var REVIEW_STATUS_LABELS = {
    approved: "Approved",
    rejected: "Declined",
  };

  /* THE COUNTRY NAMER, OR A PASS-THROUGH IF IT DID NOT LOAD.
     country.js is what turns `PT` into `Portugal` at the point of rendering,
     and iframe.html loads it first (asserted in test/zafApp.test.js). This
     fallback exists for the one case that assertion cannot cover — an asset
     that failed to fetch in a live browser — and it degrades to EXACTLY what
     the sidebar printed before any of this existed: the code. A missing name
     map must cost a reader some decoding; it must never cost them the page. */
  var COUNTRY = window.CXCountry || {
    text: function (value, absent) {
      if (value === null || value === undefined || String(value) === "") return absent === undefined ? "not stated" : absent;
      return String(value);
    },
    nameAndCode: function (value, absent) {
      return this.text(value, absent);
    },
    row: function (label, value) {
      return value;
    },
  };

  // -- tiny DOM helpers -------------------------------------------------------
  // textContent everywhere, deliberately — see rule 3 in the header.

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  /* =========================================================================
     SAY EACH SENTENCE ONCE, WHEREVER IT WOULD OTHERWISE REPEAT
     =========================================================================
     THE MEASUREMENT THAT FORCED THIS. On a real escalated UC-05 case — a
     Brazilian resignation refused at gate 4 because no statutory notice rule is
     held for that country — the project owner counted the SAME PARAGRAPH four
     times on one screen. It is not four near-misses either; it is one string,
     byte for byte, computed once server-side and reached by four different
     fields:

       · `decidedBy.means`      — the panel's opening sentence
       · `basis.notice.why`     — inside the notice block
       · `basis.unknowns[0].why`— inside "what is not known"
       · `actionableReason`     — inside the refusal, wrapped in a prefix and a
                                  suffix that ARE new information

     Every one of those fields is right to carry it: each is a complete answer
     to its own question, and a server that stripped the sentence from three of
     them would be publishing three answers that depend on reading a fourth.
     The repetition is a PROPERTY OF THE PAGE, so the page is where it is fixed.

     BY VALUE IDENTITY ONLY, and never the first occurrence. A sentence that
     differs by so much as a word still prints in full — this can remove a
     repetition and it can never remove information. The technique is already in
     this file twice (a field sentence equal to its block's, a role headline
     equal to the block it points at); this is the same rule with one register
     instead of two ad-hoc comparisons.

     ORDER IS THEREFORE LOAD-BEARING. The first render of a sentence wins, so
     the lead — the sentence a specialist reads first — is the copy that
     survives, and the collapsed detail below is what goes quiet. Reversing the
     render order would silently move the paragraph to the bottom of the page.

     `said` is reset at the top of every render(), so a re-read after an approval
     starts from nothing and cannot suppress a sentence because the previous
     view happened to contain it. */
  var said = {};

  function resetSaid() {
    said = {};
  }

  /** True if this exact text has already been printed in this render. */
  function alreadySaid(text) {
    if (!text || typeof text !== "string") return false;
    var key = text.trim();
    if (!key) return false;
    if (said[key]) return true;
    said[key] = true;
    return false;
  }

  /** el(), unless the text is a repeat — then nothing at all. */
  function elOnce(tag, className, text) {
    if (alreadySaid(text)) return null;
    return el(tag, className, text);
  }

  function appendOnce(parent, node) {
    if (node) parent.appendChild(node);
    return node;
  }

  /* A form control with a REAL <label for>, not a placeholder standing in for
     one. Every input in this sidebar used to be labelled by its placeholder
     alone — which is not an accessible name in several screen readers, and
     disappears the moment the agent starts typing, taking the only description
     of the field with it. This is the approve/decline surface for payroll changes;
     an approver who cannot tell which box is "your name" and which is "note" is
     the failure mode that matters most here.

     Returns {wrap, control} so a caller can still reach the control it needs.
     `id` must be unique per render — uid() below guarantees that even when four
     role blocks each render a "note". */
  var uidCounter = 0;
  function uid(prefix) {
    uidCounter += 1;
    return prefix + "-" + uidCounter;
  }

  function labelledField(tag, className, labelText, opts) {
    var options = opts || {};
    var wrap = el("div", "field");
    var id = uid(className || tag);
    var label = el("label", "field-label", labelText);
    label.setAttribute("for", id);
    var control = el(tag, className);
    control.id = id;
    if (options.type) control.type = options.type;
    if (options.rows) control.setAttribute("rows", String(options.rows));
    // A placeholder is still useful as an EXAMPLE, but it is now additional to
    // the label rather than a substitute for it.
    if (options.placeholder) control.setAttribute("placeholder", options.placeholder);
    if (options.required) control.setAttribute("aria-required", "true");
    wrap.appendChild(label);
    wrap.appendChild(control);
    return { wrap: wrap, control: control };
  }

  /* How many of the required approval slots are filled, as a picture.

     This RE-DERIVES NOTHING. Both numbers are read straight off the view the
     API returned, and the meter is never consulted about whether the case may
     proceed — main.js's `view.actionable` gate has already answered that before
     any of this renders. It exists because "Admin approval: Pending / Payroll
     approval: Pending" buried in a definition list is not a legible answer to
     "how far along is this dual-control gate?", which is the single most
     consequential question this sidebar is asked. */
  function renderApprovalMeter(filled, required) {
    var wrap = el("div", "r-approval-meter");
    var slots = el("div", "r-approval-slots");
    slots.setAttribute("aria-hidden", "true"); // the sentence below says it in words
    for (var i = 0; i < required; i += 1) {
      slots.appendChild(el("span", "r-approval-slot" + (i < filled ? " filled" : "")));
    }
    wrap.appendChild(slots);
    wrap.appendChild(
      el("span", null, filled + " of " + required + " approval" + (required === 1 ? "" : "s") + " recorded")
    );
    return wrap;
  }

  function resize() {
    if (!client) return;
    // Grow the iframe to fit. Zendesk gives an app a fixed height otherwise,
    // which would cut off the flags on a heavily-flagged case.
    client.invoke("resize", { width: "100%", height: document.body.scrollHeight + 24 + "px" });
  }

  // -- rendering --------------------------------------------------------------

  /* Every non-case state the sidebar can be in, rendered as a designed block
     rather than a bare sentence.

     WHY THIS IS NOT COSMETIC. This whole system argues that a swallowed failure
     is worse than a loud one — that is what the audit ordering, the claim node
     and the upstream-failure attribution all exist for. A sidebar that answers
     "the review API is unreachable" with one grey line of prose and no way to
     retry contradicts its own architecture on the one screen a human actually
     looks at. So an error names WHICH service, says what it means for the work
     in front of the agent, and offers the retry.

     `kind` picks the tone; `detail` is the machine's own words (kept verbatim,
     never paraphrased); `onRetry`, when given, renders a real button. */
  function renderState(opts) {
    clear(root);
    var block = el("div", "state-block state-" + (opts.kind || "muted"));
    block.appendChild(el("p", "state-title", opts.title));
    if (opts.body) block.appendChild(el("p", "state-body", opts.body));
    if (opts.detail) block.appendChild(el("p", "state-detail", opts.detail));
    if (opts.onRetry) {
      var retry = el("button", "btn decline state-retry", "Try again");
      retry.type = "button";
      retry.addEventListener("click", opts.onRetry);
      block.appendChild(retry);
    }
    root.appendChild(block);
    resize();
  }

  /* Announced to assistive tech. The sidebar swaps its whole contents in place
     with no focus change and no page load, so without a live region a screen
     reader user is told nothing at all when a case finishes loading or an API
     turns out to be down. `polite` because none of these interrupt a decision
     the agent is in the middle of making. */
  root.setAttribute("role", "region");
  root.setAttribute("aria-label", "Gatehouse CX automation — case review");
  root.setAttribute("aria-live", "polite");

  function renderLoading() {
    clear(root);
    root.setAttribute("aria-busy", "true");
    var block = el("div", "state-block state-loading");
    block.appendChild(el("span", "spinner"));
    block.appendChild(el("p", "state-title", "Loading this ticket's case…"));
    root.appendChild(block);
    resize();
  }

  function renderRows(rows) {
    var dl = el("dl", "rows");
    rows.forEach(function (row) {
      dl.appendChild(el("dt", null, row.label));
      dl.appendChild(el("dd", null, row.value));
    });
    return dl;
  }

  /* The tier rail. Rendered FIRST and full width, above the title, because in
     this architecture the use case's tier is what decides whether the controls
     further down may exist at all — so it should be the first thing read, not a
     chip an agent has to go looking for. Colour is a redundant third cue behind
     the glyph and the words.

     THE SENTENCE IS OPTIONAL AND THE GLYPH IS NOT. An API that has not yet been
     taught to send `executionModel` renders the tier and stops, rather than
     falling back to a guess — the guess is the whole defect. Silence about what
     may be executed is always safe here; the buttons are gated by
     `view.actionable`, server-side, and by nothing on this rail.

     ONE RISK SENTENCE, NOT THREE (2026-08-19). This rail printed "Medium-risk
     use case" as a headline; renderCaseRisk printed "This request: high risk"
     directly beneath it; the panel's own rows printed "Risk level: medium"; and
     the basis card printed "Risk rollup: medium". Four statements, four
     different subjects, three different values, all using the word "risk" — the
     project owner read them as the page contradicting itself, which is a fair
     reading of what was on screen.

     Each was correct in its own terms and none of them was wrong to compute.
     What was wrong was giving four of them the same visual weight and letting a
     reader work out which was about WHAT. So:

       · THE REQUEST'S OWN RISK is the only verdict the rail states, because it
         is the only one about the thing in front of the specialist. It names
         the use case's baseline INSIDE its own sentence, so the baseline is
         still legible without a rival headline claiming it.
       · WHAT THE TIER PERMITS stays, in the imperative, under a divider. That
         is not a risk statement at all — it says what the specialist's
         signature does, which is the operative fact on an approval screen.
       · THE TIER'S NAME and the routing rollup move into "The case record"
         below the controls. Both are still on the page and neither competes
         for the reading.

     The tier name is the fallback when no case risk arrived: something has to
     name the scale the glyph belongs to, and an API that sends no `caseRisk`
     has nothing else that will. */
  function renderTierRail(useCaseTier, executionModel, riskLine) {
    var t = USE_CASE_TIERS[useCaseTier];
    var rail = el("div", "r-tier-rail tier-" + useCaseTier);
    var glyph = el("span", "r-tier-glyph", t ? t.glyph : "•");
    glyph.setAttribute("aria-hidden", "true"); // "green circle" tells a screen reader nothing
    rail.appendChild(glyph);
    var body = el("div", "r-tier-body");
    if (riskLine) body.appendChild(riskLine);
    else body.appendChild(el("p", "r-tier-name", t ? t.name : useCaseTier));
    var means = EXECUTION_MODELS[executionModel];
    if (means) body.appendChild(el("p", "r-tier-means", means));
    rail.appendChild(body);
    return rail;
  }

  /* THIS REQUEST'S RISK — and, since 2026-08-19, the ONE risk verdict the top
     of the panel states. It goes inside the rail rather than under it, so the
     glyph, the verdict and what may be executed read as one block instead of
     as two claims stacked on each other.

     THE BASELINE IS NAMED IN EVERY BRANCH, including the unescalated one. It
     used to say only "the use case's own baseline", which meant the level the
     glyph stands for was legible on an escalated case and invisible on a quiet
     one — and it was the rail's separate "Medium-risk use case" headline that
     filled the gap, at the cost of reading as a rival verdict. Naming it inside
     this sentence is what lets that headline go.

     Escalated or not is stated explicitly. An unescalated case saying only
     "medium" would leave a reader unsure whether that is the baseline or a
     verdict, and this repo has already paid for one field carrying two
     meanings. */
  function renderCaseRisk(view) {
    var word = CASE_RISK_WORDS[view.caseRisk];
    if (!word) return null;
    var line = el("p", "r-case-risk");
    /* THE SUBJECT IS THE USE CASE WHEN NOTHING WAS RAISED, and saying "this
       request" there is what made two honest numbers look like a disagreement
       (2026-08-31). With no escalating flag, `caseRisk` is the STATIC baseline
       out of riskEngine.js's USE_CASE_TIERS — a property of UC-04, not of this
       trip. The only per-request assessment on the page is `basis.riskLevel`,
       printed at the very bottom as "Risk rollup: low" under a note telling the
       reader to read the dimensions instead. So the loudest line called the
       request medium, the quietest called it low, and nothing said they were
       different quantities. Reworded rather than removed: both facts are worth
       having, and the fix is that each names its own subject. */
    line.appendChild(
      el("strong", null, (view.caseRiskEscalated ? "This request: " : "This use case: ") + word + " risk")
    );
    var baseline = USE_CASE_TIERS[view.useCaseTier] ? CASE_RISK_WORDS[view.useCaseTier] : null;
    var count = typeof view.escalatingFlagCount === "number" ? view.escalatingFlagCount : null;
    var flags = count === null ? "flags" : count + (count === 1 ? " flag" : " flags");
    var detail;
    if (!view.caseRiskEscalated) {
      detail =
        " — its own " + (baseline || "baseline") +
        " baseline, and no flags were raised on this request, so it stays there. This is a property of the use case, not an assessment of this request; what was assessed is in the findings below. It does not change what may be executed.";
    } else if (baseline && baseline !== view.caseRisk) {
      detail =
        " — raised above this use case's " + baseline + " baseline by " + flags +
        " raised on this request. It does not change what may be executed.";
    } else {
      // A 🔴 use case is already at the top of the scale, so its flags raise
      // nothing. Saying "raised above the high baseline" there would be a
      // sentence that cannot be true, and this panel has just finished paying
      // for one of those.
      detail =
        " — " + flags + " raised on this request, and this use case's " +
        (baseline || "own") + " baseline is already the top of the scale, so the level cannot rise further. " +
        "It does not change what may be executed.";
    }
    line.appendChild(el("span", null, detail));
    return line;
  }

  /* WHAT AM I DECIDING, AND FOR WHOM — one line, and the first line.
     The employee and the requester were rows six lines into a Case card that
     came after the tier rail, the risk sentence, the badge, the title and the
     card's own heading. They are the subject of the decision, so they belong in
     the same glance as its title. Read off the row the API returned; a panel
     whose row carries neither renders no line rather than an empty one. */
  function renderSubject(c, employee) {
    var employment = c.employmentId ? String(c.employmentId) : "";
    var requester = c.requester ? String(c.requester) : "";
    var parts = [];
    /* A NAME WHERE THERE IS ONE, AND THE ID ONLY WHEN THERE IS NOT.
       The project owner, on a live ticket: "I never even saw any relevant info
       of the employee — not even name. That is bad." They were right, and the
       note that used to close this function said the panel could not fix it
       from here: no by-ticket view published a name. Some now do
       (src/shared/employeeSubject.js), so this line reads the one the SERVER
       resolved and never looks a person up itself — a lookup here would be a
       second Remote client in a browser holding no credentials.

       THE ID IS NOT PRINTED BESIDE THE NAME. Thirty-six hexadecimal characters
       next to "Carlos Silva" is the decoding this whole pass exists to remove,
       and the id is still on the page: "The case record" carries it verbatim,
       which is where somebody quoting it into Remote goes. */
    var named = employee && employee.displayName ? String(employee.displayName) : "";
    if (named) parts.push(named);
    else if (employment) parts.push(employment);
    /* THE SAME UUID TWICE IS NOT TWO FACTS. A self-filed UC-05 resignation
       records the employment id in `requester` as well, so this line read
       "c2cd77da-… · filed by c2cd77da-…" — the same 36 characters, side by
       side, in front of an HR person. The panel does not INFER what that means
       (nothing here knows that an equal id implies the employee filed it); it
       declines to print one string twice, and the case record below still
       carries both rows verbatim, so nothing is hidden.

       The comparison stays against the EMPLOYMENT ID rather than the display
       name: the two ids are what the row actually holds, and a name is never
       what makes two records the same record. */
    if (requester && requester !== employment) parts.push("filed by " + requester);
    if (!parts.length) return null;
    return el("p", "r-subject", parts.join(" · "));
  }

  function renderHeader(view) {
    var c = view.case;
    var header = el("header", "head");

    header.appendChild(el("h1", "title", window.CXPanelFor(c.useCase).title));
    var subject = renderSubject(c, view.employee);
    if (subject) header.appendChild(subject);

    var badges = el("div", "badges");
    // A settled review status wins over the automation's own decision word —
    // see the REVIEW_STATUS_LABELS comment above for why. `pending` is not a
    // settlement, so it falls through to the decision badge unchanged.
    var review = view.review;
    var badgeKey = c.decision;
    var badgeLabel = DECISION_LABELS[c.decision] || c.decision;
    if (review && review.status && review.status !== "pending" && REVIEW_STATUS_LABELS[review.status]) {
      badgeKey = review.status;
      badgeLabel = REVIEW_STATUS_LABELS[review.status];
    }
    /* THE SETTLEMENT THAT NEVER REACHES `review_queue`, and the reason the fix
       above did not cover it (2026-09-01, rca reported by the project owner
       driving UC-03 -> UC-04 -> approve -> Zendesk).

       `view.review` is the SHARED review queue. UC-04's settlement is not in
       it: the customer's manager approves in Remote's own product and the
       verdict lands on `uc04_authorizations` itself. So the branch above never
       fired, `c.decision` stayed `ready_for_approval` forever, and a trip
       approved by admin_jane at 17:02 was still headed "Awaiting specialist
       approval" — above a settled block on the SAME panel naming the approver
       and the minute. Two true sentences on one screen contradicting each
       other, which is word for word what rca-il7 was about.

       THE WORDS ARE THE SERVER'S. `settled.badge` is composed in
       src/uc04/approvalPolicy.js's settledFacts(); this file derives no status
       word from `headline` or from any other prose, exactly as it derives none
       anywhere else. A server that sends no `badge` changes nothing here.

       LAST, so it wins over the review-queue branch on any use case that
       somehow had both — a settlement on the record itself is the later and
       more specific fact. */
    if (view.settled && view.settled.badge) {
      badgeKey = view.settled.state || badgeKey;
      badgeLabel = view.settled.badge;
    }
    badges.appendChild(el("span", "badge decision-" + badgeKey, badgeLabel));
    header.appendChild(badges);

    // `useCaseTier`, NOT `tier`. See the two tables at the top of this file:
    // `tier` is the API's legacy name for the escalated case risk, and reading
    // it here is what put a 🔴 guarantee above a 🟡 use case's Approve button.
    // The risk line goes INSIDE the rail — see renderTierRail's header for why
    // there is now one risk sentence at the top of this panel and not three.
    if (view.useCaseTier) header.appendChild(renderTierRail(view.useCaseTier, view.executionModel, renderCaseRisk(view)));
    return header;
  }

  /* =========================================================================
     WHO THIS IS ABOUT — the person, and who filed the request about them
     =========================================================================
     THE COMPLAINT THIS ANSWERS, from the project owner on a live ticket:
     *"In that Zendesk bar I never even saw any relevant info of the employee —
     not even name. That is bad."* Every panel opened with a 36-character UUID
     where a human being belongs, and the specialist's first act on every case
     was to go and look the person up somewhere else.

     TWO SERVER FIELDS, DRAWN AS ONE CARD, because they are one question.
     `view.employee` (src/shared/employeeSubject.js) is the person the decision
     is ABOUT, re-read from Remote when the panel opened. `basis.requester`
     (src/uc04/decisionFacts.js) is who FILED it and whether they were acting
     for that person — published since the basis landed and never rendered,
     because it carries no `sentence` and the generic prose pass skipped it.
     Splitting them into two cards would put "Carlos Silva, Netherlands" and
     "filed by admin_jane, not the employee" in different parts of the page,
     when the only reason either matters is the relationship between them.

     NOTHING HERE IS LOOKED UP, DERIVED OR DECIDED. Every value is a string the
     server resolved, including the country names, which `employeeSubject.js`
     renders through the shared `countryNameAndCode()` before it sends them.
     The one presentation choice this file makes is ACTING_FOR_WORDS below,
     which renames three server states the way DECISION_LABELS renames a
     decision — presentation only, and the server's own sentence is printed
     underneath every one of them.

     AN ABSENCE IS A ROW, NEVER A BLANK. `employeeSubject.js` publishes five
     states and a per-field `absence` sentence precisely so that "the record
     carries no job title" and "nobody thought to show it" cannot look the same,
     and a specialist who is shown nothing assumes there was nothing to show.

     WHAT IS DELIBERATELY NOT DRAWN, and each is reported rather than hidden:
       · `requester.subject.employmentRecord` — "the record read at decision
         time is not kept on this row". True, and `employee.finding` two rows
         above already says this card is a LIVE read and not a decision-time
         snapshot, so printing both says one thing twice.
       · `requester.intake` — which channel the request arrived on. It changes
         nothing a specialist does, and the external reference is on the case
         record verbatim.
       · every `whatItWouldTake` — a column to add to a table, which is
         engineering backlog above a decision (the cut 0f71708 made page-wide).
     ========================================================================= */

  /* Three server states, in the words a reader uses. The server's own sentence
     is printed under each, so this never becomes the only account of it. */
  var ACTING_FOR_WORDS = {
    the_subject_themselves: "The employee themselves",
    on_behalf_of_the_subject: "Someone else, for the employee",
    unknown: "Not established",
  };

  /* WHY THE FIVE NON-AVAILABLE STATES ARE NOT ONE "could not load".
     `employeeSubject.js` splits them for the same reason
     `src/shared/upstreamFailure.js` splits its three: "Remote says there is no
     such record" is an answer ABOUT the record and "we could not ask Remote" is
     not an answer at all, and they send a specialist to two different places.
     The server writes the sentence; this only picks the heading it sits under. */
  var SUBJECT_STATE_HEADS = {
    not_found: "No such employment record",
    unavailable: "The employee record could not be read",
    not_looked_up: "The employee record was not looked up",
    no_employment_id: "This case names no employee",
  };

  /** One labelled line with the server's own sentence beneath it. */
  function subjectRow(parent, label, value, note, valueClass) {
    var row = el("div", "r-fact" + (value ? "" : " is-unknown"));
    var head = el("p", "r-fact-head");
    head.appendChild(el("span", "r-fact-label", label));
    /* AN IDENTIFIER IS DRAWN AS ONE. Every other value in this card is a fact
       about a person in words — "Data Scientist", "active", "Chris Lee" — so a
       raw session id set in the same face reads as another one of those, which
       is how "Filed by admin_jane" came to look like a name the system had
       resolved. See renderEmployee's filedBy block. */
    head.appendChild(el("span", valueClass ? "r-fact-value " + valueClass : "r-fact-value", value || "Not stated"));
    row.appendChild(head);
    if (note) appendOnce(row, el("p", "muted r-small", note));
    parent.appendChild(row);
  }

  /**
   * The person, and the party who filed about them. Null when the API sends
   * neither field — seven of the nine publish no `employee` today, and a panel
   * that drew an empty card for them would be claiming the read failed.
   */
  /**
   * The linked Remote work-authorization request — the one the employee raised,
   * read live at the moment this panel opened (src/uc04/linkedRequest.js).
   *
   * ITS OWN CARD, NOT ROWS ON THE SUBJECT CARD, because its provenance is
   * different: the subject card is the EMPLOYMENT record, this is the REQUEST,
   * and they can disagree. Two provenances under one heading is how a reader
   * stops being able to say where a fact came from.
   *
   * EVERY STATE RENDERS, INCLUDING THE ABSENCES. "There is no linked request"
   * (the ordinary case for anything filed through this system's own portal),
   * "Remote says it no longer exists" and "we could not ask" are three
   * different facts, and the server sends a sentence for each. A card that
   * appeared only when there was something to show would leave a specialist
   * unable to tell the first from a panel that simply does not have the field.
   */
  function renderRemoteRequest(view) {
    var request = view.remoteRequest;
    if (!request || !request.finding) return null;

    var box = el("section", "card r-subject-card");
    box.appendChild(el("h3", "h3", "The request the employee raised in Remote"));

    var fields = request.fields || null;
    if (fields) {
      // NAMED ONE BY ONE, never spread. A field Remote adds later must not
      // appear on an approval screen with no label and nobody's decision
      // behind it.
      // `subjectRow`'s fourth argument is a NOTE, and it renders whether or not
      // the value is present — so the absence sentence is passed ONLY when
      // there is an absence. The same shape renderEmployee uses for its own
      // fields; getting it wrong prints "not stated on the request" underneath
      // a stated value.
      var stated = function (label, value, absence) {
        subjectRow(box, label, value, value ? null : absence);
      };
      stated("Travel document number", fields.travelDocumentNumber, "Remote holds no number for this request.");
      stated("Work location", fields.workLocation, "Remote holds no work location for this request.");
      stated(
        "Will negotiate or sign contracts",
        // TRISTATE. `false` is an answer and must render as "No"; absent is not
        // an answer and must not render as one. A falsy check here would report
        // an unanswered question as a confident no — the same defect the server
        // side is written to avoid.
        fields.willNegotiateOrSignContracts === true
          ? "Yes"
          : fields.willNegotiateOrSignContracts === false
            ? "No"
            : null,
        "Unanswered on the request — not the same as no."
      );
      // A DATE, NOT A TIMESTAMP. `submitted_at` arrives as
      // "2026-08-28T10:00:00Z"; a specialist reading when the employee filed
      // this needs the day, and the machine-readable form printed in a row of
      // plain-language facts reads as something nobody looked at.
      stated(
        "Submitted",
        fields.submittedAt ? String(fields.submittedAt).slice(0, 10) : null,
        "No submission time on the request."
      );
      stated("Status in Remote", fields.status, "No status on the request.");
      stated("Reason given", fields.reason, "The employee gave no reason on the request.");
      stated("Additional information", fields.additionalInformation, "Nothing added.");
    }

    // The provenance sentence is the server's, verbatim — including which of
    // the four absences this is. Nothing here paraphrases it.
    appendOnce(box, elOnce("p", "muted r-small", request.finding));
    return box;
  }

  /**
   * The three questions Remote's own RWA form asks, plus the work location.
   *
   * NO STATE MARK, NO TONE, NO VERDICT — and that is the design, not an
   * omission. The server publishes no state for this block because nothing
   * judged it: `src/uc04/activityProfile.js` normalises, bounds and describes,
   * and the gate files are asserted not to import it at all. Drawing a chip
   * here would be this bundle inventing an assessment, which is the one thing
   * every renderer in this file is forbidden from doing.
   *
   * RENDERED WHEN IT WAS NOT ASKED, TOO. "This surface does not ask the
   * question" and "asked, and left blank" are different facts about a request,
   * and a card that appeared only when there was text would render them
   * identically — as nothing.
   */
  function renderActivityProfile(view) {
    var profile = view.basis && view.basis.activityProfile;
    if (!profile || !profile.fields) return null;

    var box = el("section", "card r-subject-card");
    box.appendChild(el("h3", "h3", "What they will be doing there"));
    profile.fields.forEach(function (field) {
      subjectRow(box, field.label, field.value, field.value ? null : field.absence);
    });
    appendOnce(box, elOnce("p", "muted r-small", profile.finding));
    return box;
  }

  /**
   * Where the CUSTOMER has legal entities, and whether one of them is at the
   * destination — the art. 15(2)(b) question.
   *
   * THESE ARE THE CLIENT'S ENTITIES AND THE HEADING SAYS SO. Remote's own
   * employing entity is exposed by no endpoint this project has found, and
   * printing one of these under a word like "Employer" is the defect recorded
   * as K16. The label here is deliberately about the CUSTOMER.
   *
   * FIVE STATES, ALL RENDERED. "We could not ask" must never look like "they
   * have none there": that is the reassuring answer from a comparison that
   * never ran, and it is the exact shape of finding F-27 one endpoint over.
   * The server sends a sentence for each and this paraphrases none of them.
   */
  function renderEmployerPresence(view) {
    var presence = view.employerPresence;
    if (!presence || !presence.finding) return null;

    var box = el("section", "card r-subject-card");
    box.appendChild(el("h3", "h3", "Where the customer has companies"));

    var matched = presence.matched || [];
    var countries = presence.entityCountries || [];
    subjectRow(
      box,
      "An entity at the destination",
      presence.state === "in_destination"
        ? // NAMES ONLY. Falling back to `entity.id` here would print a raw UUID
          // in a row of plain-language facts — the bare-UUID defect this panel
          // already fixed once, and the one the linked-request sentence was
          // caught making a few lines above.
          matched
            .map(function (entity) {
              return entity.name;
            })
            .filter(Boolean)
            .join(", ") || "Yes"
        : presence.state === "elsewhere"
          ? "No"
          : null,
      // The absence is the STATE's own sentence, not a word this file chose:
      // "unknown" and "no" are the two answers that must never be confused.
      presence.state === "in_destination" || presence.state === "elsewhere" ? null : "Unknown — see below."
    );
    if (countries.length) {
      subjectRow(box, "Countries Remote lists entities in", countries.join(", "), null);
    }

    appendOnce(box, elOnce("p", "muted r-small", presence.finding));
    return box;
  }

  function renderEmployee(view) {
    var employee = view.employee || null;
    var requester = view.basis && view.basis.requester ? view.basis.requester : null;
    if (!employee && !requester) return null;

    var box = el("section", "card r-subject-card");
    /* THE NAME IS THE HEADING. It is already the first line of the header, so
       a "Name: Carlos Silva" row here would be the restatement 86f4dd9 swept
       off every other card. A record carrying no name gets the generic heading
       and keeps its own `absence` row, so the gap is stated rather than
       papered over with the id. */
    var named = employee && employee.displayName ? String(employee.displayName) : "";
    box.appendChild(el("h2", "h2", "Who this is about"));

    if (employee) {
      if (employee.state === "available") {
        (employee.fields || []).forEach(function (field) {
          // The name is the heading and the header's own subject line; the
          // row is dropped only when there IS a name to have been shown.
          if (field.key === "full_name" && named) return;
          subjectRow(box, field.label, field.value, field.value ? null : field.absence);
        });
      } else {
        var head = SUBJECT_STATE_HEADS[employee.state];
        if (head) box.appendChild(el("p", "r-detail-head", head));
      }
      /* THE SERVER'S SENTENCE, NOT A REWORDING OF IT. On `available` it says
         the read is live rather than a decision-time snapshot — which is what
         lets an approver trust a name on a screen whose button re-reads the
         same record. On the four failure states it says which failure, and a
         wrong guess there sends somebody to fix the wrong thing. */
      if (employee.finding) appendOnce(box, el("p", "muted r-small", employee.finding));
    }

    if (requester) {
      box.appendChild(el("p", "r-detail-head", "Who filed it"));

      /* THE VALUES DECIDE; THE SENTENCES SAY WHAT THEY DO NOT ESTABLISH.
         `basis.requester` publishes six facts and a paragraph about each, and
         every one of those paragraphs earns its place — five of them state an
         ABSENCE ("nothing on this row says whether the subject consented",
         "a wrong country here is not caught anywhere", "no document was read to
         confirm it"), which is the one class of prose this page must never
         fold away lightly. Rendered flat they are ~1,500 characters standing
         between a specialist and the Approve button.

         So the split is 499ad53's, applied to a new block rather than invented
         for it: what a specialist needs TO DECIDE stays open — who filed it,
         for whom, whether identity was proved, and the two countries they can
         now compare against the record above. What each of those does NOT
         establish goes behind ONE disclosure that counts them, so its presence
         is a fact on the open page even when its text is not. Thresholds are
         the same two constants the statutory blocks use (LONGFORM_FIELDS_MIN /
         LONGFORM_FIELDS_CHARS), because a second set of numbers meaning the
         same thing is how the page came to have eight type sizes. */
      var notes = [];
      function requesterRow(label, value, note, valueClass) {
        subjectRow(box, label, value, null, valueClass);
        if (note) notes.push({ label: label, note: note });
      }

      /* A NAME WHERE A NAME EXISTS, and the precedent is 190 lines up in this
         same file: renderSubject already refuses to print "filed by <uuid>"
         when the requester IS the employment — "the same UUID twice is not two
         facts". Then this function printed it anyway, on the same page, for the
         same id, six inches under a card resolving it to "Chris Lee".

         SUBSTITUTED ONLY WHEN THE TWO IDS ARE THE SAME VALUE, so the name is
         never asserted of a filer this page has not read a record for: a
         company admin filing on someone else's behalf still shows their own
         raw id, because nothing here knows who they are. The id is not lost —
         "The case record" carries it verbatim, which is where somebody quoting
         it into Remote goes. */
      var filedBy = requester.filedBy || {};
      var subjectOfRecord = view.employee || {};
      var filedByIsSubject =
        filedBy.id && subjectOfRecord.employmentId && String(filedBy.id) === String(subjectOfRecord.employmentId);
      var filedByValue = filedByIsSubject && subjectOfRecord.displayName
        ? String(subjectOfRecord.displayName)
        : filedBy.id
          ? String(filedBy.id)
          : null;
      /* WHEN IT IS NOT A NAME, IT MUST NOT LOOK LIKE ONE. The substitution
         above resolves the filer only when the two ids are the same value; a
         company admin filing on someone else's behalf shows a raw session id,
         because nothing here has read a record for them and this file must not
         invent one. What it CAN do is stop the id being drawn like a name —
         the owner read "Filed by admin_jane" straight after the bare-UUID
         defect this substitution was built to fix, and the two look identical
         at a glance while being opposite problems: that one had a name and
         did not use it, this one has no name at all. The explanatory note
         under "What each of these does not establish" already says what the
         value is; this makes the row agree with it at a glance. */
      requesterRow("Filed by", filedByValue, filedBy.finding, filedByIsSubject ? null : "r-fact-id");

      var actingFor = requester.actingFor || {};
      requesterRow("Acting for", ACTING_FOR_WORDS[actingFor.state] || null, actingFor.finding);

      var identity = requester.identity || {};
      if (identity.state) {
        requesterRow("Identity check", identity.state === "verified" ? "Verified" : "Not verified", identity.finding);
      }

      /* THE TWO COUNTRIES A SPECIALIST CAN NOW COMPARE, and could not before.
         `statedHomeCountry`'s own sentence says it is taken off the request and
         never compared to the employment record — "so a wrong country here is
         not caught anywhere". That sentence was unusable as a warning while the
         record's country was nowhere on the page; with "Country of employment"
         three rows above it, the READER is the comparison, which is exactly
         what the server says has to happen. */
      var subject = requester.subject || {};
      ["statedHomeCountry", "statedNationality"].forEach(function (key) {
        var stated = subject[key];
        if (!stated) return;
        requesterRow(
          key === "statedHomeCountry" ? "Home country, as stated on the request" : "Nationality, as stated on the request",
          stated.value ? COUNTRY.text(stated.value, "") : null,
          stated.finding
        );
      });

      /* AN ABSENCE A READER WOULD OTHERWISE ASSUME AWAY. An escalated case with
         no explanation on it reads as a requester who explained nothing; the
         truth is that the words exist and this table has no column for them.
         `whatItWouldTake` — the column to add — is not printed: it is a work
         item for whoever owns the store, not for the person deciding. */
      /* "NOT STATED" WAS A FALSE CLAIM, AND THE CORRECTION WAS BEHIND A CLICK
         (2026-08-31). Passing null fell through to subjectRow's default, so the
         row asserted the requester said nothing — while the note directly
         attached to it, which the disclosure below collapses, says the opposite:
         the words exist, in the audit record, and this table has no column for
         them. The comment above predicted exactly this misreading and the code
         under it produced it. An absence has to name WHICH absence it is. */
      var statedReason = requester.statedReason || null;
      if (statedReason && statedReason.finding) {
        requesterRow("The requester's own words", "Not kept with this decision", statedReason.finding);
      }

      var noteChars = 0;
      notes.forEach(function (entry) {
        noteChars += String(entry.note).length;
      });
      if (notes.length) {
        var container = box;
        if (notes.length >= LONGFORM_FIELDS_MIN && noteChars > LONGFORM_FIELDS_CHARS) {
          var disclosure = el("details", "r-longform");
          disclosure.appendChild(
            el("summary", null, "What each of these does not establish — " + notes.length + " note" + (notes.length === 1 ? "" : "s"))
          );
          box.appendChild(disclosure);
          container = disclosure;
        }
        notes.forEach(function (entry) {
          var line = el("p", "r-sub-sentence");
          line.appendChild(el("span", "r-fact-label", entry.label + " — "));
          line.appendChild(el("span", null, entry.note));
          appendOnce(container, line);
        });
      }
    }

    return box;
  }

  /* =========================================================================
     THE ACCOUNT OF WHY — the gate ladder and the decision facts
     =========================================================================
     WHAT WAS BROKEN. Six of the nine APIs compute a full structured account of
     why they decided — `gateLadder` (every rung of the real evaluation order,
     each marked passed / decided / not_reached) and, under `basis` or
     `decisionFacts`, the figures the gate actually compared — and ship it over
     HTTP on the same response this sidebar was already parsing. The sidebar
     threw all of it away and printed one slug. That is this repo's own P8
     pattern, "a capability fully built and reachable by nobody", sitting on the
     one screen a human uses to make the decision the whole 🟡 tier exists to
     route to them.

     THE DISTINCTIONS ARE THE ENTIRE POINT, AND THEY ARE WHY THIS IS NOT A LIST
     OF GREEN TICKS.

       · `not_reached` is NOT `passed`. A gate that never ran approved of
         nothing (docs/GATES.md rule 2 — "the single most common misreading of
         a decision panel").
       · `cleared` is the ONLY dimension state that means fine. `unknown` (we
         hold no register that could confirm this), `unavailable` (the check
         does not exist yet), `not_assessed` (an earlier gate decided first) and
         `suppressed` (a limit was EXCUSED, which is a different fact from being
         within it) are each an absence of a verdict, and they are absences of
         different things.
       · A `suppressed` limit carries the provenance of whatever suppressed it.
         When a Portugal workation skips the Schengen 90/180 check, the
         specialist must read that the limit was excused AND that the basis is a
         five-entry hand-written list marked "[PROPOSED] — illustrative, no
         authority" (DNV_COUNTRIES_PROVENANCE, src/uc04/riskMatrix.js). An
         excused check that looks like a passed one is a control removed in
         silence.

     WHERE IT LIVES AND WHY. In the shell, not in nine panels. These fields are
     PRESENTATIONAL — every word, every state and every number in them was
     computed server-side by a pure describer that decides nothing
     (src/shared/gateLadder.js, src/shared/decisionFacts.js, and each use case's
     own decisionFacts.js). One renderer here means all nine benefit the moment
     their API sends the field, and it means this file still never learns a gate
     order, a threshold or a policy of its own: it maps a state string to a word
     and a tone, and prints sentences it was handed.

     NOTHING BELOW RENDERS A CONTROL. No button, no listener, no form. 🔴 UC-07
     and UC-08 get a richer dossier and remain exactly as unactionable as they
     were — `view.actionable` is still the only question that gates controls,
     and it is still asked in exactly one place (renderActions).
     ====================================================================== */

  /* A rung's standing in THIS run. "not reached" is deliberately its own word:
     folding it in with "passed" is the misreading docs/GATES.md rule 2 exists
     to prevent. */
  var GATE_RUNG_WORDS = {
    passed: "passed",
    decided: "decided this",
    not_reached: "not reached",
    /* A rung ABOVE the deciding one whose check could not run. UC-05's gate 9
       compares the statute's notice with Remote's own days_of_notice, and when
       Remote's figure was not read the ladder used to mark it "passed" —
       directly beneath prose saying the comparison "has NOT been checked".
       Position says the rung was reached; only the server knows whether it
       evaluated anything, and it says so with this status. */
    not_evaluated: "not evaluated",
  };

  /* State -> the word an agent reads, and the tone that word is drawn in.
     PRESENTATION ONLY: the state itself is the server's, and an entry missing
     here falls through to the raw string in the OPEN tone — never a pass.

     `tone: "settled"` is the visual claim "nothing is owed here", so it is
     spent on exactly the states that mean a check RAN and found nothing
     against the case. Every other state is either a finding (waiting/stopped)
     or an absence of one (open). The open tone is drawn as a hollow ring
     rather than a filled dot precisely so that "no verdict was reached" cannot
     be skim-read as a verdict.

     `means` says what the state IS, for the states a reader can plausibly
     misread. It is rendered under the finding for every non-settled state,
     which is where the cost of the misreading falls. */
  var FACT_STATES = {
    // -- the only four that mean "fine" ------------------------------------
    cleared: { word: "Cleared", tone: "settled", means: null },
    within_limit: { word: "Within the limit", tone: "settled", means: null },
    valid: { word: "Valid", tone: "settled", means: null },
    clear: { word: "Clear", tone: "settled", means: null },

    // -- a finding a person has to weigh -----------------------------------
    attention: {
      word: "Needs weighing",
      tone: "waiting",
      means: "Checked, and something was found that a person has to weigh.",
    },
    urgent: {
      word: "Urgent",
      tone: "waiting",
      means: "Checked, and the time left to act on it is short.",
    },
    ambiguous: {
      word: "Ambiguous",
      tone: "waiting",
      means: "More than one answer fits, and none of them was picked for you.",
    },

    // -- a finding no approval can override --------------------------------
    blocking: {
      word: "Blocking",
      tone: "stopped",
      means: "Checked, and what was found cannot be overridden by approving it.",
    },
    breached: {
      word: "Over the limit",
      tone: "stopped",
      means: "Measured against the limit and past it.",
    },
    locked: {
      word: "Locked",
      tone: "stopped",
      means: "The cut-off for that payroll cycle has already passed.",
    },
    invalid: {
      word: "Invalid",
      tone: "stopped",
      means: "Checked against the country's own form and refused by it.",
    },
    not_expressible: {
      word: "Not expressible",
      tone: "stopped",
      means: "The country's form has no field this change could be written to.",
    },
    value_missing: {
      word: "Value missing",
      tone: "stopped",
      means: "A value this change needs was never stated, so nothing could be validated.",
    },

    // -- NOT A PASS. Each of these is the absence of a verdict, and they are
    //    absences of DIFFERENT things. Collapsing any of them into "cleared" is
    //    the defect this whole section exists to prevent.
    unknown: {
      word: "Unknown",
      tone: "open",
      means: "The check ran and the data it needed was absent, so its answer is not evidence in either direction.",
    },
    unavailable: {
      word: "Not held",
      tone: "open",
      // "THE CHECK DOES NOT EXIST YET — NOTHING WAS EVER CONSULTED" was this
      // sentence until 2026-08-31, and it was wrong for BOTH of its two users.
      // UC-09's `pending_approval` branch consults the record at assessment
      // time and again at the final signature, and holds no confirmation only
      // BETWEEN them. UC-04's immigration dimension now reads the employment's
      // `files[]` and reports what Remote holds — it stays `unavailable`
      // because an identity document proves right to work in the country of
      // employment and this dimension asks about the destination, which is a
      // bound on what the evidence MEANS, not an admission that nothing was
      // looked at. A shared state word must not assert how any one dimension
      // reached it; the finding beside it says what was consulted.
      means: "Nothing held here confirms or denies this. Read the finding for what was consulted and what it does not settle.",
    },
    not_assessed: {
      word: "Not assessed",
      tone: "open",
      means: "This check never ran, because an earlier gate decided first. It has approved of nothing.",
    },
    suppressed: {
      word: "Excused, not measured",
      tone: "open",
      means:
        "A limit that DID govern this case was skipped rather than met. Nothing was measured, so nothing here says the case is within it — read the basis below before treating this as a pass.",
    },
    no_cycle: {
      word: "No cycle found",
      tone: "open",
      means: "No payroll cycle covering that date was found, so nothing was measured against one.",
    },
    lock_unreadable: {
      word: "Lock unreadable",
      tone: "open",
      means: "The cycle exists and its cut-off could not be read, so the time left to act is not stated.",
    },
    form_unavailable: {
      word: "Form unavailable",
      tone: "open",
      means: "The country's own form could not be read, so nothing was validated against it.",
    },
  };

  /* A basis block's heading. The KEY is the server's; this only says it in
     words. An unmapped key still renders, under its own name — a block nobody
     labelled is still a block the specialist should see. */
  var BASIS_BLOCK_LABELS = {
    change: "The change requested",
    schema: "The country's own form",
    payroll: "The payroll cycle",
    notice: "Statutory notice",
    discrepancy: "Proposed against statutory",
    payout: "Accrued time-off payout",
  };

  /* Keys of `basis` this renderer handles by shape rather than as prose, so the
     generic pass below does not render them twice. Anything NOT in here that
     carries a `sentence` is rendered as a narrative block, which is what lets a
     use case add one and have it appear with no change to this file. */
  var BASIS_STRUCTURAL_KEYS = {
    decider: true,
    deciders: true,
    roles: true,
    deciding: true,
    dimensions: true,
    measurements: true,
    unknowns: true,
    riskLevel: true,
    trip: true,
    // Both carry no `sentence`, so the prose pass already skipped them — but by
    // accident rather than on purpose, which is a distinction the next person
    // to add a `sentence` server-side would discover the hard way. `sources` is
    // rendered per finding by renderSources, never as a bibliography, and
    // `requester` by renderEmployee, at the top of the page beside the person
    // it is about. Listing both here is what stops the generic prose pass from
    // drawing either of them a SECOND time, further down, as an unlabelled
    // block — which is the whole reason this table exists.
    sources: true,
    requester: true,
  };

  function humaniseKey(key) {
    var words = String(key).replace(/_/g, " ");
    return words.charAt(0).toUpperCase() + words.slice(1);
  }

  function factState(state) {
    return FACT_STATES[state] || { word: String(state), tone: "open", means: null };
  }

  /** The state, as a word first and a colour second. Never colour alone. */
  function renderStateMark(state) {
    var meta = factState(state);
    var chip = el("span", "r-fact-state tone-" + meta.tone, meta.word);
    return chip;
  }

  /* WHAT A STATE IS, PRINTED ONLY WHERE THE MISREADING WOULD COST.
     Every non-settled state used to print its gloss, so a page with four
     findings carried four definitional sentences under findings that had
     already said the same thing in their own words: "Over the limit" sat above
     "210 days against a 183-day watch line — over by 27" and then, under that,
     "Measured against the limit and past it."

     THE OPEN TONE IS THE ONE THAT PAYS FOR IT. `unknown`, `unavailable`,
     `not_assessed` and `suppressed` are absences of a verdict, and they are
     absences of DIFFERENT things — an excused limit and a met one look
     identical unless something says so. Their glosses are the sentence that
     stops a reader skimming an absence as a pass, so they always print.

     A `waiting` or `stopped` finding is a verdict that arrived. Its own
     sentence carries it, and the gloss is a restatement — which is exactly what
     trains a reader to skim, which is what puts a skimming approver in front of
     a payroll change. */
  function appendStateMeaning(node, state) {
    var meta = FACT_STATES[state];
    if (meta && meta.means && meta.tone === "open") node.appendChild(el("p", "r-state-means", meta.means));
  }

  /**
   * The whole gate ladder — the list itself. Its disclosure is one level up,
   * in renderDecidedBy, so that "which rung decided", "what that rung checks",
   * the audit slug, the flag codes and all 17 rungs sit behind ONE summary line
   * below the controls rather than four blocks above them.
   *
   * COLLAPSED because the deciding rung is already stated in full at the top of
   * the panel, and that is the answer for someone reading one case. The ladder
   * answers the different question "what else was there", which is asked once
   * and then rarely. Same treatment the request portal already gives it.
   *
   * THIS FILE DOES NOT KNOW THE ORDER. Every rung, its wording and its status
   * come from describeGateLadder() reading the same GATE_SEQUENCE the gates
   * themselves are numbered by. If the gates change, this renders the change;
   * it cannot come to disagree with them.
   */
  /**
   * rca-iih7 / D-31. `describeGateLadder()` returns ONE ROW PER REASON —
   * correct as data (GATE_SEQUENCE's own header explains why: a single gate
   * can refuse several distinct ways, and each way needs its own `means`
   * sentence) — but UC-01 alone has 20 such rows describing 13 actual gates,
   * because G-1 and G-2 each gave one gate several reasons. Rendering one
   * list item per ROW put five items numbered "1", three numbered "2" and two
   * numbered "13" under a heading claiming "ALL 20 GATES, IN THE ORDER THEY
   * RUN" — a specialist reading it top to bottom cannot tell "20" and "1…13
   * with repeats" agree, because they don't: the row count and the gate count
   * are two different numbers this rendering never distinguished. Sibling
   * rows at the same position also carry byte-identical `checks` text (they
   * describe the SAME gate), so grouping loses no information this panel
   * displays — `rung.reason` was never rendered per-row in the first place.
   *
   * A group's status is "decided" if any row in it is — the one variant that
   * actually fired, which is a fact about THAT reason, not about whether the
   * gate ran at all. Every other row sharing a position always carries the
   * SAME status as every other in practice (see gateLadder.js's
   * describeGateLadder: position alone decides `passed` vs `not_reached`), so
   * this rule only ever resolves the deciding gate's own group, where the
   * decided reason and its siblings genuinely differ.
   */
  function groupRungsByGate(rungs) {
    var order = [];
    var byPosition = {};
    rungs.forEach(function (rung) {
      var existing = byPosition[rung.position];
      if (!existing) {
        byPosition[rung.position] = { position: rung.position, gate: rung.gate, checks: rung.checks, status: rung.status };
        order.push(rung.position);
      } else if (rung.status === "decided") {
        existing.status = "decided";
      }
    });
    return order.map(function (p) {
      return byPosition[p];
    });
  }

  function renderGateLadder(rungs) {
    var box = el("div", "gate-ladder");
    box.appendChild(
      el(
        "p",
        "muted r-small",
        "They run top to bottom and the first refusal wins. So every gate above the one that decided passed — or, where marked, was reached but could not evaluate anything — and every gate below it never ran, and has said nothing about this case in either direction."
      )
    );

    var list = el("ol", "gate-ladder-list");
    groupRungsByGate(rungs).forEach(function (rung) {
      var item = el("li", "gate-rung is-" + rung.status);
      var head = el("p", "gate-rung-head");
      head.appendChild(el("span", "gate-rung-no", String(rung.position)));
      head.appendChild(el("span", "gate-rung-name", rung.gate));
      head.appendChild(el("span", "gate-rung-status", GATE_RUNG_WORDS[rung.status] || rung.status));
      item.appendChild(head);
      if (rung.checks) item.appendChild(el("p", "muted r-small", "Checks: " + rung.checks));
      // THE DECIDING RUNG'S `means` IS NOT REPEATED HERE (2026-08-19). It is the
      // sentence the panel opens with, word for word, and printing it again at
      // the foot of a 17-rung list was the single longest repetition on the
      // screen: the project owner found the same paragraph twice and read the
      // page as two reports pasted together. The rung is still marked "decided
      // this", which is what the ladder is for.
      list.appendChild(item);
    });
    box.appendChild(list);
    return box;
  }

  /**
   * HOW THIS WAS DECIDED — one collapsed block, below the controls, holding
   * every part of the account that is provenance rather than a finding.
   *
   * WHAT MOVED IN HERE AND WHY. Four separate blocks used to sit between the
   * decision sentence and the controls: "Decided by check 17 of 17 — outcome",
   * "That gate checks: …", the reason slug, the flag chips, and a disclosure
   * holding the ladder. Not one of them is something a specialist weighs. They
   * are how the decision is TRACED — the slug is the exact string in
   * `audit_log`, in the metrics exception ranking and in the n8n ports, and the
   * flag codes are the routing vocabulary — so they are the answer to "where
   * did this come from", asked after the decision or during an incident, not
   * before an approval.
   *
   * NOTHING WAS DROPPED. Every string that used to be visible is inside this
   * disclosure, one click away, in the order a person tracing a case reads
   * them.
   *
   * `flags` is passed in rather than read off the view so this function keeps
   * to one job: the caller decides whether the flags are findings the panel
   * must lead with (a use case that publishes no basis) or codes for findings
   * already stated in words (one that does). See renderWhy.
   */
  function renderDecidedBy(view, flags) {
    var decidedBy = view.decidedBy;
    var ladder = view.gateLadder || [];
    var codes = flags || [];
    if ((!decidedBy || !decidedBy.gate) && !codes.length) return null;

    var box = el("details", "gate-note");
    // "gate 4" alone cites a position in an order nobody can see. The total is
    // the server's on both shapes (`total` on the shared ladder,
    // `ladderLength` on UC-02's) and is never counted here.
    var total = decidedBy && (decidedBy.total || decidedBy.ladderLength || null);
    var headline = !decidedBy || !decidedBy.gate
      ? "How this was decided"
      : decidedBy.position === null || decidedBy.position === undefined
        ? "Decided by: " + decidedBy.gate
        // "check N of M", not "gate N of M": the position is one CHECK, and the
        // gate it belongs to is the word after the dash. See the ladder heading.
        : "Decided by check " + decidedBy.position + (total ? " of " + total : "") + " — " + decidedBy.gate;
    box.appendChild(el("summary", null, headline));

    if (decidedBy && decidedBy.checks) box.appendChild(el("p", "muted r-small", "That gate checks: " + decidedBy.checks));
    if (decidedBy && decidedBy.note) box.appendChild(el("p", "muted r-small", decidedBy.note));

    /* THE REASON SLUG IS NO LONGER PRINTED (2026-08-31). `all_gates_passed` is
       the audit string, and the two lines directly above it already say the
       same thing in words a customer can read ("Decided by check 18 of 18 —
       outcome", "That gate checks: every gate above passed…"). The old comment
       here defended it as "the string somebody searches by" — true of a
       specialist with database access, and this panel is shown to people who
       have none. Nothing is lost from the audit trail: the slug is on the
       `audit_log` row, which is where a searchable identifier belongs. */
    if (codes.length) {
      var list = el("ul", "flags");
      codes.forEach(function (flag) {
        list.appendChild(el("li", "flag", flag));
      });
      box.appendChild(list);
    }

    if (ladder.length) {
      /* THE NUMBER IS RIGHT AND THE NOUN WAS WRONG (2026-08-31).
         `groupRungsByGate` dedupes on POSITION, so this counts the rows that
         will actually render — which is what rca-iih7 / D-31 required, and it
         still holds: `ladder.length` is 20 for UC-01 while the rendered rungs
         and this heading agree at 13. What it is NOT is a count of distinct
         gates. UC-04 has 18 positions across 8 gate names — `risk_matrix`
         appears ten times — so "All 18 gates" was a row count wearing the wrong
         word, over ten consecutive rows all captioned `risk_matrix`.
         "Checks" is what a position is; `gate` is the stage it belongs to, and
         both are printed on every row so a reader can see the grouping. */
      var stepCount = groupRungsByGate(ladder).length;
      var gateNames = {};
      var distinctGates = 0;
      ladder.forEach(function (rung) {
        if (rung.gate && !gateNames[rung.gate]) {
          gateNames[rung.gate] = true;
          distinctGates += 1;
        }
      });
      box.appendChild(
        el(
          "p",
          "r-detail-head",
          "All " + stepCount + " checks, in the order they run" +
            (distinctGates && distinctGates !== stepCount
              ? " — grouped into " + distinctGates + " gates, named on each row"
              : "")
        )
      );
      box.appendChild(renderGateLadder(ladder));
    }
    return box;
  }

  /** {label, value} evidence, as the same definition list the Case card uses.
   *
   * COUNTRY CODES ARE NAMED HERE, AND ONLY WHERE THE LABEL SAYS SO. Both the
   * label and the value come from the server, so nothing in this function can
   * tell a country apart from a status word by looking at it — and guessing
   * from the shape is not available: UC-04's own evidence carries
   * `{label: "Contract-signing authority", value: "no"}`, and "no" is two
   * letters and IS Norway's code. So the decision is made by country.js's
   * COUNTRY_VALUED_LABELS, a short list of labels this repo's servers actually
   * emit, and a row not on it renders exactly as it always has. */
  /* EVIDENCE ROWS THE DECISION CARD ALREADY DRAWS, AND DRAWS BETTER.
     UC-09's `approval_floor` dimension publishes a six-row table of the
     signature state — "Signatures required 3", "Distinct people recorded 0 of
     3", "Already signed nobody yet", "Still outstanding Requester, Approver,
     Payment releaser" — and every one of those four is restated a few inches
     below by something that says more about it: the approval meter draws
     "0 of 3 approvals recorded" as a picture, and the capacity card names each
     role, what it decides, whether its slot is RECORDED or OUTSTANDING and who
     filled it. Counting to three four times is what the project owner read as
     the panel repeating itself.

     THE DIMENSION ITSELF STAYS, and that is the whole point of suppressing
     ROWS rather than the block: its finding carries the two sentences nothing
     else on the page says — that the floor is two and that risk can only ever
     raise it, and that nothing in this system can produce a payment signed by
     one person. "Floor", "Why this number" and "May not sign again" stay for
     the same reason: no other line states them.

     Same precedent, same reasoning as 0f71708 dropping `basis.deciders`: where
     two parts of one page hold the same fact, the richer one survives. A label
     not on this list renders exactly as it always has. */
  var SAID_BY_THE_DECISION_CARD = {
    "Signatures required": true,
    "Distinct people recorded": true,
    "Already signed": true,
    "Still outstanding": true,
  };

  function renderEvidence(entries) {
    return renderRows(
      entries
        .filter(function (e) {
          return !SAID_BY_THE_DECISION_CARD[String(e.label)];
        })
        .map(function (e) {
          var value = COUNTRY.row(e.label, e.value);
          return { label: e.label, value: value === null || value === undefined ? "not stated" : String(value) };
        })
    );
  }

  /* =========================================================================
     THE RULE BEHIND A FINDING, REACHABLE FROM THE FINDING
     =========================================================================
     Each dimension and measurement carries `sources` — hand-curated citations
     to the statute or guidance the check was written from, with the
     contradictions the corpus itself records against them
     (src/uc04/decisionSources.js). Nothing rendered any of it, so a specialist
     who wanted to know WHY 183 days is the line had nowhere to go from the
     screen that asked them to weigh it.

     BESIDE THE FINDING, NOT AS A FOOTER. A citation list at the bottom of the
     panel is a bibliography: it tells you documents exist and leaves you to
     work out which finding each belongs to. Attached to the finding, one click
     down, it answers the question the finding just raised.

     COLLAPSED, because it is long and it is read rarely. Open, three findings'
     worth of citations would be most of the page, and the page's job is the
     decision.

     THE HONESTY OF THE METHOD TRAVELS WITH IT. `method` says in plain words
     that this is a hand-curated map with no search, no ranking and no
     similarity score — printed ONCE per disclosure rather than once per group,
     because the server sends the identical sentence on every entry. A caveat
     is drawn as a caveat and never as a citation: a contradicted finding is a
     finding whose basis you now know the limits of, not evidence for the
     opposite conclusion.
     ====================================================================== */
  /* -------------------------------------------------------------------------
     A FINDING WITH NO SOURCE, SAID RATHER THAN LEFT BLANK
     -------------------------------------------------------------------------
     WHY THIS EXISTS (2026-08-30). Five use cases compute an `uncited` list —
     the findings this repository deliberately records as resting on NO
     citation, each with the reason — and until today not one of them reached a
     screen. src/uc04/decisionFacts.js even said so in a comment: "`uncited` is
     the same statement in the other direction, AND IT IS RENDERED TOO: a
     citation block that only ever appears where a citation exists teaches a
     reader that everything unmarked is fine." That sentence described a
     renderer that did not exist. It is the §3.98 defect class again — a data
     layer moved, the view layer did not, and nothing failed because the output
     is prose no test reads.

     WHY IT BELONGS INSIDE THE SAME DISCLOSURE AS THE CITATIONS, not in a
     section of its own. The question an absence answers is the one the
     citation box has just raised: the reader has opened "the rule this is
     based on" and needs to know that for THIS finding there is no rule to
     open. A separate panel further down would be a bibliography of silences —
     true, and read by nobody at the moment it mattered.

     IT IS NOT A CAVEAT AND MUST NOT BE DRAWN AS ONE. A caveat is a
     contradiction the corpus records AGAINST a source it holds; this is the
     absence of any source at all. `.r-caveat` carries the warning colour, and
     borrowing it would say the corpus found something wrong here when what it
     found was nothing.
     ---------------------------------------------------------------------- */
  function renderUncitedEntry(absence) {
    var item = el("div", "r-uncited");
    /* The SCOPE in the heading, because two absences of the same finding are
       otherwise identical lines. UC-08 emits one `residence_test` absence per
       jurisdiction in play, so a US/PT dossier holding neither test would print
       "No source — Domestic residence test" twice with nothing to tell them
       apart. The pair KEY form ("CA|NL") is how decisionSources.js indexes a
       pair and is not how anybody reads one. */
    var scope = absence.scope || absence.country || null;
    var scopeWords = scope ? COUNTRY.text(String(scope).replace(/\|/g, " – "), "") : "";
    item.appendChild(
      el("p", "r-uncited-head", "No source — " + (absence.label || absence.finding) + (scopeWords ? " · " + scopeWords : ""))
    );
    if (absence.why) item.appendChild(el("p", "r-small", absence.why));
    return item;
  }

  function renderSources(sources, uncited) {
    var groups = (sources || []).filter(function (group) {
      /* CONFIRMATIONS COUNT AS CONTENT. Until they were rendered, a group whose
         only entries were confirmations was dropped here and its whole
         contribution vanished — which is the failure mode the confirmations
         exist to prevent, arriving through the filter that decides whether they
         are drawn at all. */
      return (
        group &&
        ((group.citations || []).length || (group.caveats || []).length || (group.confirmations || []).length)
      );
    });
    /* An absence with neither a label nor a reason states nothing, and an empty
       "No source" line is worse than no line: it reads as a rendering fault. */
    var absences = (uncited || []).filter(function (a) {
      return a && (a.label || a.finding) && a.why;
    });
    if (!groups.length && !absences.length) return null;

    var count = 0;
    var caveatCount = 0;
    groups.forEach(function (group) {
      count += (group.citations || []).length;
      caveatCount += (group.caveats || []).length;
    });

    var box = el("details", "r-sources");
    /* "0 documents" IS NOT A COUNT, IT IS A STATE (2026-08-30, §3.100). Since
       UC-04 began filtering a finding's citations by the jurisdictions the trip
       involves, a group can legitimately arrive with no document and still be
       worth opening — its caveats are the warnings a specialist needs MOST on a
       pair nothing on the shelf governs. Rendering that as "The rules this is
       based on — 0 documents" invites the reader to close it, and reads as a
       bug rather than as the finding it is. */
    /* THE SUMMARY COUNTS BOTH POPULATIONS, because a disclosure that counts
       only the documents makes the absences invisible until it is opened —
       and the whole reason for stating an absence is that a reader who never
       opens the box would otherwise take silence for a clean bill.

       THE "BOTH" LIMB IS CURRENTLY UNREACHABLE AND IS KEPT ON PURPOSE, said
       here rather than left for someone to discover as dead code. Only one
       finding group in the repository can raise a cited and an uncited finding
       at once — UC-04's `immigration_document` — and its two populations are
       mutually exclusive today: `immigration_document_on_file` is emitted only
       when the dimension's state is `unavailable`, and the work-permit
       citations only when it is not (src/uc04/decisionFacts.js's
       findingKeysForDimension / uncitedKeysForDimension). UC-05's readingList()
       already takes an ARRAY of keys, so one added key makes it reachable with
       no change here; dropping the limb would mean that group then names one
       population and hides the other. No fixture exercises it, because a
       fixture written to reach it would have to be written to agree with this
       panel, which is the failure this repo pays for most often. */
    var docWords = count === 1 ? "1 document" : count + " documents";
    var gapWords = absences.length === 1 ? "1 finding with none" : absences.length + " findings with none";
    /* CAVEATS ARE COUNTED TOO, ADDED 2026-08-31. A caveat is the corpus
       contradicting code this repo SHIPS — more decision-relevant than the
       citation it hangs under — and it was invisible until the box was opened.
       Measured on a real US → PT case: the summary advertised "1 document" over
       one citation and THREE recorded contradictions, including C-9, which says
       the pair the finding calls unknown is in fact covered. The comment above
       already claims this box counts both populations; it counted citations and
       absences, and caveats were the third. */
    var caveatWords = caveatCount === 1 ? "1 caveat" : caveatCount + " caveats";
    box.appendChild(
      el(
        "summary",
        null,
        count && absences.length
          ? "The rules this is based on — " + docWords + (caveatCount ? ", " + caveatWords : "") + ", and " + gapWords
          : count
            ? "The rule" + (count === 1 ? "" : "s") + " this is based on — " + docWords +
              (caveatCount ? ", " + caveatWords : "")
            : absences.length
              ? (absences.length === 1 ? "This finding rests on no source" : "These " + absences.length + " findings rest on no source") +
                " — the reason for each"
              : "No document here governs this route — why, and what still applies",
      )
    );
    // Every group carries the same `method` sentence; say it once. Guarded on
    // `groups[0]` because a box can now be built out of absences alone, and
    // there is no method to describe when nothing was retrieved.
    var method = groups.length ? groups[0].method : null;
    if (method) box.appendChild(el("p", "muted r-small", method));

    groups.forEach(function (group) {
      var groupBox = el("div", "r-source-group");
      if (group.label) groupBox.appendChild(el("p", "r-source-finding", group.label));
      /* WHY THIS FINDING SHOWS NO DOCUMENT (2026-08-30, §3.100). UC-04 now
         filters a finding's citations by the jurisdictions the trip actually
         involves, so a Portugal → Netherlands workation no longer cites the
         U.S. Social Security Administration. When that filter removes every
         document, the group still renders — its caveats are the warnings a
         specialist needs MOST on an unsourced pair — and without this line the
         reader would see caveats under a heading with no sources and no way to
         tell "nothing governs this route" from "nobody mapped this finding". */
      if (group.noCitationForRoute) {
        groupBox.appendChild(el("p", "muted r-small", group.noCitationForRoute));
      }
      (group.citations || []).forEach(function (citation) {
        var item = el("div", "r-citation");
        item.appendChild(el("p", "r-citation-title", citation.title));
        if (citation.instrument) item.appendChild(el("p", "muted r-small", citation.instrument));
        if (citation.locator) item.appendChild(el("p", "muted r-small", citation.locator));
        if (citation.citedFor) item.appendChild(el("p", "r-small", "Cited for " + citation.citedFor));
        if (citation.evidence) item.appendChild(el("p", "muted r-small r-citation-standing", citation.evidence));
        /* `citation.path` IS DELIBERATELY NOT RENDERED (2026-08-31). It is a
           path inside this repository — `docs/knowledge/layer-1-statutory/
           D-07-….md` — and it tells a reader where OUR COPY lives, which is not
           a fact about the law and is not something anyone outside this project
           can open. What makes the citation checkable is above it and all still
           renders: the instrument, the article locator, the publisher and the
           retrieval standing. The API still publishes `path` for a reviewer who
           has the repository; a screen is not that reviewer. */
        groupBox.appendChild(item);
      });
      /* .filter(Boolean): a caveat the server could not resolve arrived as
         `null` on every UK and Polish case (C-31/C-32/C-33 referenced, never
         defined) and `caveat.weight` below threw — which ended rendering with
         the identity box and took the Sign off button with it. The server no
         longer publishes a null; the browser no longer dies on one. */
      (group.caveats || []).filter(Boolean).forEach(function (caveat) {
        var item = el("div", "r-caveat");
        /* THE HEADLINE, NEVER THE REGISTER ID. `caveat.id` is "C-8" — an entry
           number in an internal findings register, meaningless off this
           project, and it used to be BOTH the fallback here and half of the
           path line below ("CONTRADICTIONS.md C-8"). The weight word is the
           honest fallback: it still says whether the finding is disputed or
           incomplete, which is the part that changes how the reader treats it. */
        item.appendChild(
          el("p", "r-caveat-head", (caveat.weight ? caveat.weight + " — " : "") + (caveat.headline || caveat.weight || "Recorded limitation"))
        );
        if (caveat.detail) item.appendChild(el("p", "r-small", caveat.detail));
        groupBox.appendChild(item);
      });
      /* AFTER THE CAVEATS, AND THE ORDER IS THE CORPUS'S OWN (2026-08-30).
         K-2's detail ends "How they are applied is THE CAVEAT ABOVE" — the
         confirmation is written as a bound on the dispute that precedes it, so
         printing confirmations first would leave that sentence pointing at
         nothing. It is also the safer order on its own merits: a reader
         scanning a finding meets what changes their action before what does
         not.

         A CONFIRMATION IS NOT AN APPROVAL AND THE MARKER SAYS SO. "Checked and
         matched" names what was done — one number, one list, one date, tested
         against the authority it was taken from. The bounding sentence is
         CONFIRMATION_FRAMING, published by the server and rendered once for the
         page by renderSourceFramings(); nothing about the claim is composed
         here. */
      (group.confirmations || []).forEach(function (confirmation) {
        var item = el("div", "r-confirmation");
        item.appendChild(
          el("p", "r-confirmation-head", "Checked and matched — " + (confirmation.headline || "a source was checked and agreed"))
        );
        if (confirmation.detail) item.appendChild(el("p", "r-small", confirmation.detail));
        /* Same as the caveat above: the register id and the repo path are
           internal, the sentence is not. */
        groupBox.appendChild(item);
      });
      box.appendChild(groupBox);
    });

    /* AFTER the sourced findings, never interleaved. A reader scanning for the
       instrument that governs their case should reach every document this
       system holds before reaching the list of what it does not. */
    absences.forEach(function (absence) {
      box.appendChild(renderUncitedEntry(absence));
    });
    return box;
  }

  /**
   * One independent dimension — UC-04's four, which UC-04.md §7 forbids
   * collapsing into a single score. Each carries its own state, its finding,
   * the evidence behind it, and the rule it was written from.
   *
   * `whatItWouldTake` IS NO LONGER RENDERED (2026-08-19), and the distinction
   * is deliberate. The GAP — "coverage unconfirmed; the absence of a recorded
   * gap is not a record of coverage" — is decision-relevant and is in
   * `finding`, where it stays: a specialist has to know the system does not
   * know. The REMEDIATION PLAN — which table to build, which source file
   * resolves it, which column `uc04_authorizations` is missing — is engineering
   * backlog, and the approval screen is not where backlog is read. There were
   * four of these blocks on one UC-04 case, each several lines long, above the
   * controls. The strings are unchanged server-side (src/uc04/decisionFacts.js
   * still computes them and the audit record still carries them); this panel
   * simply stops printing them at the person deciding.
   */
  function renderDimension(dimension, isDeciding, ordinal) {
    // The tone in the class, so the row's rail can BE the state. See the
    // "THE RAIL IS THE STATE" note in style.css: it is the one place on this
    // page a state colour is spent, and the chip beside the label still
    // carries the word, so nothing depends on the colour.
    var item = el("li", "r-dimension tone-" + factState(dimension.state).tone + (isDeciding ? " is-deciding" : ""));
    var head = el("p", "r-dimension-head");
    head.appendChild(
      /* NUMBERED BY WHERE IT RENDERS, NOT BY THE SERVER'S FIXED POSITION
         (2026-08-31). `dimension.position` is a constant on each of UC-04's
         four dimensions, and a CLEARED dimension is filed into the collapsed
         "Every check that cleared" section below the controls — taking its
         number with it. So a specialist read "1. … 3. … 4." and went looking
         for a missing finding 2 that was one click away in a different section,
         under its own "2.". The server's number is not a citation anybody
         quotes; the sequence a reader is counting is the one in front of them. */
      el("span", "r-dimension-label", (ordinal ? ordinal + ". " : "") + dimension.label)
    );
    head.appendChild(renderStateMark(dimension.state));
    item.appendChild(head);
    // THE FINDING THAT SETTLED IT, MARKED IN PLACE. It used to be lifted into a
    // block of its own above the list AND rendered again as this dimension —
    // the same label and the same sentence, twice, six inches apart. Marking
    // the row says the same thing and says it once. See renderDecisionBasis.
    if (isDeciding) item.appendChild(el("p", "r-deciding-mark", "This is the finding that settled it"));
    if (dimension.question) item.appendChild(el("p", "muted r-small", dimension.question));
    appendOnce(item, elOnce("p", "r-finding", dimension.finding));
    appendStateMeaning(item, dimension.state);
    if (dimension.evidence && dimension.evidence.length) item.appendChild(renderEvidence(dimension.evidence));
    // `uncited` beside `sources`, per dimension — see renderUncitedEntry.
    var sources = renderSources(dimension.sources, dimension.uncited);
    if (sources) item.appendChild(sources);
    return item;
  }

  /**
   * WHERE A TABLE CAME FROM, printed beside what it did.
   *
   * A suppression whose basis a reader cannot see is a control that has been
   * removed silently. The nulls here are deliberate upstream — a null authority
   * and a null review date are the honest state of an uncited list — so they
   * are rendered as "none named" and "never", not omitted. An omitted row reads
   * as a row nobody thought to include; a stated absence reads as the finding
   * it is.
   */
  /**
   * "3 days", "1 day" — a count with its unit, singularised. Only the floor
   * rows reach this: "1 days short" is the sort of thing a specialist reads as
   * evidence nobody looked at the screen.
   */
  function amount(n, unit) {
    if (!unit) return String(n);
    var word = n === 1 && unit.slice(-1) === "s" ? unit.slice(0, -1) : unit;
    return n + " " + word;
  }

  /**
   * @param {object} provenance
   * @param {string} [heading] — "The basis for excusing it" is right for a
   *   limit that was WAIVED and wrong for one that was merely proposed, and
   *   both kinds of row carry a `basis`. The caller says which it has.
   */
  function renderProvenance(provenance, heading) {
    var box = el("div", "r-provenance");
    box.appendChild(
      el("p", "r-provenance-head", (heading || "The basis for excusing it") + ": " + (provenance.table || "an unnamed table"))
    );
    box.appendChild(
      renderEvidence([
        { label: "Standing", value: provenance.status || "not stated" },
        { label: "Authority", value: provenance.authority || "none named" },
        { label: "Version", value: provenance.version || "none" },
        { label: "Last reviewed", value: provenance.reviewedOn || "never" },
      ])
    );
    if (provenance.detail) box.appendChild(el("p", "muted r-small", provenance.detail));
    if (provenance.reference) box.appendChild(el("p", "muted r-small", "See " + provenance.reference));
    return box;
  }

  /**
   * A numeric threshold, with the measured value beside it OR an explicit
   * statement of which side is missing.
   *
   * A limit on its own tells a specialist a rule exists, which they knew. The
   * measured figure is printed only when the server actually holds one —
   * `measured: null` renders as words, never as a 0 that would read as a
   * measurement.
   */
  function renderMeasurement(measurement) {
    var item = el("li", "r-measurement tone-" + factState(measurement.state).tone);
    var head = el("p", "r-dimension-head");
    head.appendChild(el("span", "r-dimension-label", measurement.label));
    head.appendChild(renderStateMark(measurement.state));
    item.appendChild(head);

    var unit = measurement.unit ? " " + measurement.unit : "";
    // See the note in renderNumbers: a floor borrowing a ceiling's vocabulary
    // reads as its own opposite.
    var isFloor = measurement.comparison === "floor";
    var rows = [
      {
        label: isFloor ? "Minimum" : "Limit",
        value: measurement.limit === null || measurement.limit === undefined ? "not stated" : measurement.limit + unit,
      },
    ];
    rows.push({
      label: "Measured",
      value:
        measurement.measured === null || measurement.measured === undefined
          ? "no figure was taken on this run"
          : measurement.measured + unit,
    });
    if (measurement.headroom !== null && measurement.headroom !== undefined) {
      rows.push(
        isFloor
          ? {
              label: measurement.headroom < 0 ? "Short by" : "Margin",
              value: amount(Math.abs(measurement.headroom), measurement.unit),
            }
          : { label: "Headroom", value: measurement.headroom + unit }
      );
    }
    if (measurement.window) {
      rows.push({
        label: "Window",
        value: measurement.window.from + " to " + measurement.window.to + " (trailing " + measurement.window.spanDays + " days)",
      });
    }
    item.appendChild(renderEvidence(rows));

    appendOnce(item, elOnce("p", "r-finding", measurement.note));
    appendStateMeaning(item, measurement.state);
    if (measurement.basis) {
      item.appendChild(
        renderProvenance(
          measurement.basis,
          measurement.state === "suppressed" ? "The basis for excusing it" : "Where this line comes from"
        )
      );
    }
    var sources = renderSources(measurement.sources, measurement.uncited);
    if (sources) item.appendChild(sources);
    return item;
  }

  /* =========================================================================
     REFERENCE PROSE IS COLLAPSED; A DECISION IS NOT
     =========================================================================
     THE COMPLAINT THIS ANSWERS, in the project owner's words, looking at an
     escalated UC-05 case in the live sidebar: "this mountainous text should be
     collapsed. not just displayed there." What they were reading was the
     shortfall-handling block — a framing sentence and seven entries, each a
     full paragraph of statutory prose with its article citation, 3.4k
     characters of it, open, one after another, under the decision. The
     citation disclosure one inch above it ("The rule this is based on — 1
     document") was already correct, and reads correctly; these were not.

     THE LINE IS NOT A WORD COUNT, IT IS A QUESTION: does a specialist need
     this to DECIDE, or once they have decided how to proceed? The verdict, the
     figures, the gap, the deciding gate and what was not established are the
     first kind and stay open — they are the page. A menu of handlings, each
     explaining what a statute says about one option, is the second: it is
     consulted after the reader knows they must choose, never to discover that
     they must.

     THE THRESHOLDS ARE PRESENTATION, NOT POLICY. A renderer cannot see the
     question above, only the shape: how many entries, and how much prose. So
     it collapses a field group that is BOTH a list (three or more entries — a
     framing sentence and at least two things being framed) and longer than a
     screenful in a 320px column. Nothing is dropped, nothing is re-decided,
     and no field of the record is read that was not read before.

     THE FIRST FIELD STAYS OPEN, AND THAT IS THE LOAD-BEARING PART. On UC-05 it
     is HANDLING_FRAMING (src/uc05/decisionSources.js), which says the handlings
     "are listed in no order of preference: nothing here recommends one, ranks
     them, or scores them, and this system computes no figure for any of them."
     That is the honesty guarantee of the whole block, not decoration — losing
     it into a collapsed body would let a reader open the list and take the
     order for a ranking. So it renders above the disclosure, and the count of
     what is inside renders in the summary, which together are the two
     decision-relevant facts: you must choose, and there are seven things to
     choose among.

     THAT THE FIRST FIELD IS THE GROUP'S FRAMING IS A CONVENTION, NOT A FLAG,
     AND IT IS WHY THE THRESHOLDS ARE WHERE THEY ARE. Nothing in `fields[]`
     marks the introduction; the server simply writes it first. That is safe on
     a menu of eight and it is NOT safe on a short group — UC-08's `treaty`
     block publishes three fields which are limbs (a), (b) and (c) of ONE
     cumulative test, and there is no introduction among them. Treating limb (a)
     as framing would have hidden two of the three conditions behind a summary
     named after the first, which invites reading limb (a) as the whole test.
     That is a worse defect than the one being fixed, and it is the reason a
     three-entry group is left open however dense it reads: three paragraphs are
     scrolled past, eight are a wall, and only at the wall is "the first line
     introduces the list" a shape worth relying on. The server change that would
     retire the guess altogether — marking the introduction instead of writing
     it first — is recorded in this commit's message.
     ====================================================================== */

  /* A MENU, NOT A PARAGRAPH: five or more entries running past twelve hundred
     characters. Both halves are needed. The count is what makes "the first one
     introduces the rest" a safe reading; the character floor is what keeps a
     list of five short lines — UC-06's amendment fields, UC-08's two-line
     social-security coverage — from being hidden to save nothing. */
  var LONGFORM_FIELDS_CHARS = 1200;
  var LONGFORM_FIELDS_MIN = 5;

  /** One field, as the sub-sentence line the block has always printed. */
  function fieldSentence(field) {
    return el("p", "r-small r-sub-sentence", (field.label ? field.label + " — " : "") + field.sentence);
  }

  /**
   * A block of the basis that speaks in prose — UC-05's notice / discrepancy /
   * payout, UC-06's change / schema / payroll.
   *
   * A BLOCK IS RENDERED BY ITS SENTENCES. The server's describers rank rather
   * than dump, and re-deriving a layout from their raw fields here would undo
   * that: it would put `formRead: true` on a payroll screen. So this prints the
   * block's own sentence, any nested entry that carries one, and nothing else
   * of the record.
   */
  function renderNarrativeBlock(key, block) {
    // A block with no state is CONTEXT, not a verdict, so it takes the neutral
    // rail rather than a tone — see partitionBasis.
    var item = el("li", "r-basis-block" + (block.state ? " tone-" + factState(block.state).tone : ""));
    var head = el("p", "r-dimension-head");
    head.appendChild(el("span", "r-dimension-label", BASIS_BLOCK_LABELS[key] || humaniseKey(key)));
    if (block.state) head.appendChild(renderStateMark(block.state));
    item.appendChild(head);
    appendOnce(item, elOnce("p", "r-finding", block.sentence));
    /* `why` — the gap in our own knowledge — but ONLY on a block carrying a
       state. A stateless block is context and renders in the lead, directly
       under the panel's opening sentence, and on the UC-05 escalation that
       sentence and this `why` are the same fact in two wordings. Two wordings
       of one fact, one inch apart, is the repetition this page is being taken
       apart for; the gap itself still prints, once, in "What is not known",
       which is the section whose whole job is to state it. */
    if (block.state && block.why) appendOnce(item, elOnce("p", "muted r-small", block.why));
    appendStateMeaning(item, block.state);
    // DROPPED BY VALUE IDENTITY ONLY, never by label. A one-field change's own
    // sentence IS the block's sentence (UC-06 salary amendments), and printing
    // it twice reads as a page fault; a two-field change still prints both,
    // because neither equals the summary.
    var fields = (block.fields || []).filter(function (field) {
      return field && field.sentence && field.sentence !== block.sentence;
    });
    var fieldChars = 0;
    fields.forEach(function (field) {
      fieldChars += field.sentence.length;
    });

    if (fields.length >= LONGFORM_FIELDS_MIN && fieldChars > LONGFORM_FIELDS_CHARS) {
      // The framing sentence, open. Its LABEL is not repeated here — the
      // summary directly below carries it, and printing it twice one line
      // apart is the repetition this page was taken apart for.
      var lead = fields[0];
      var entries = fields.slice(1);
      item.appendChild(el("p", "r-small r-sub-sentence", lead.sentence));

      /* SAYS WHAT IS INSIDE AND HOW MUCH OF IT, the same shape as
         renderSources' "The rule this is based on — 1 document". "Show more"
         would tell a reader nothing about whether it is worth opening, which
         on a page whose whole job is a decision is the difference between a
         disclosure and a hidden section. "Entries" and not "options": four of
         UC-05's seven are handlings, one is a statutory exemption and two are
         boundaries on the minimum, and nothing in the data tells them apart —
         so counting them as options would be a claim this panel cannot back. */
      var box = el("details", "r-longform");
      box.appendChild(
        el(
          "summary",
          null,
          (lead.label || BASIS_BLOCK_LABELS[key] || humaniseKey(key)) +
            (entries.length === 1 ? " — 1 entry" : " — " + entries.length + " entries")
        )
      );
      entries.forEach(function (field) {
        box.appendChild(fieldSentence(field));
      });
      item.appendChild(box);
    } else {
      fields.forEach(function (field) {
        item.appendChild(fieldSentence(field));
      });
    }
    // UC-05's blocks publish `{sources, uncited}` as one reading list (see
    // readingList() in src/uc05/decisionFacts.js), so the absence travels with
    // the block it belongs to and needs no separate wiring here.
    var sources = renderSources(block.sources, block.uncited);
    if (sources) item.appendChild(sources);
    return item;
  }

  /**
   * What is NOT known, collected rather than left to be noticed by its absence.
   * An unknown a person has to deduce from a blank field is the same defect as
   * a fact withheld: they act on what they can see.
   */
  function renderUnknowns(unknowns) {
    var box = el("div", "r-unknowns");
    box.appendChild(el("h3", "h3", "What is not known"));
    unknowns.forEach(function (unknown) {
      var item = el("div", "r-unknown");
      item.appendChild(el("p", "r-unknown-what", unknown.what));
      // `why` stays — it is the gap. `whatItWouldTake` does not — it is the
      // engineering plan for closing the gap. See renderDimension's header.
      if (unknown.why) appendOnce(item, elOnce("p", "muted r-small", unknown.why));
      box.appendChild(item);
    });
    return box;
  }

  /* =========================================================================
     HOW TO READ THE SOURCES ON THIS PAGE — the three framing sentences
     =========================================================================
     WHY THESE ARE NOT DECORATION, in their own authors' words: SOURCE_FRAMING
     and CAVEAT_FRAMING are each commented "Rendered once above the citation
     block. Not decoration — see rule 2." Neither had ever been rendered
     anywhere. They are published on `basis.sources` by UC-04, UC-05, UC-07 and
     UC-08, and until today the page drew citations with no statement that a
     citation decides nothing, and caveats with no statement that a contradicted
     finding is not evidence for the opposite conclusion.

     ONCE FOR THE PAGE, NOT ONCE PER DISCLOSURE. "Rendered once above the
     citation block" was written when a citation block was a single list; they
     are now a collapsed disclosure per finding, and a UC-04 case has five. Three
     framing sentences repeated five times would be most of the panel, and
     repetition is the specific complaint this page's design answers. So they sit
     once, above the findings, where they govern every disclosure below.

     COLLAPSED, because they are read once by a specialist and never again, and
     the page's job is the decision. The summary says what is inside rather than
     "Show more", the same rule renderSources follows.

     COMPOSED BY THE SERVER, EVERY WORD. This function chooses placement and
     nothing else; a panel that wrote its own version of "nothing here is a
     recommendation" would be a second copy of a safety sentence, which is how
     the first one goes stale.
     ====================================================================== */
  function renderSourceFramings(basis) {
    var framings = (basis && basis.sources) || {};
    var sentences = [framings.framing, framings.caveatFraming, framings.confirmationFraming].filter(function (t) {
      return typeof t === "string" && t.trim();
    });
    if (!sentences.length) return null;

    var box = el("details", "r-sources r-framings");
    box.appendChild(el("summary", null, "How to read the sources under each finding"));
    sentences.forEach(function (sentence) {
      box.appendChild(el("p", "r-small", sentence));
    });
    return box;
  }

  /* =========================================================================
     WHAT STILL HAS TO BE ESTABLISHED — `openQuestions`
     =========================================================================
     WHO SENDS IT. UC-07 and UC-08 only, at the top level of the dossier view
     (src/uc07/dossierView.js, src/uc08/dossierView.js). They are the two use
     cases with NO execution path, so nothing on their page is a decision and
     everything on it is research handed to a specialist — which makes "what
     this dossier could not settle" the most decision-relevant thing it holds,
     and it reached the screen nowhere at all. Computed on every read since the
     views were written, serialised, sent over the wire, dropped by the loader.

     ABOVE THE RECORD, BELOW THE FINDINGS. A priority-1 question qualifies
     every figure underneath it — "a day count is present and this system holds
     no residence test for any jurisdiction it concerns" is precisely the
     sentence a reader needs BEFORE they read the count, not after. That is the
     same argument the mandatory framing statement wins on, one rung down.

     PRIORITY IS AN ORDER, NOT A SEVERITY WORD. The server publishes 1 and 2
     and no vocabulary for them, so this sorts by it and says nothing else: a
     panel inventing "critical"/"minor" from a bare integer would be a claim
     the server never made. A stable sort keeps each priority band in the order
     the view raised it, which is the order the dossier reasoned in.
     ====================================================================== */
  function renderOpenQuestions(view) {
    var questions = (view.openQuestions || []).filter(function (q) {
      return q && q.question;
    });
    if (!questions.length) return null;

    // Stable: Array.prototype.sort is not guaranteed stable in every engine a
    // ZAF iframe may run in, so the original index is the tiebreak rather than
    // a trusted property of the sort.
    var ordered = questions
      .map(function (q, i) {
        return { q: q, i: i };
      })
      .sort(function (a, b) {
        var pa = typeof a.q.priority === "number" ? a.q.priority : 99;
        var pb = typeof b.q.priority === "number" ? b.q.priority : 99;
        return pa === pb ? a.i - b.i : pa - pb;
      })
      .map(function (entry) {
        return entry.q;
      });

    var section = el("section", "card r-questions");
    section.appendChild(el("h2", "h2", "What still has to be established"));
    section.appendChild(
      el(
        "p",
        "muted r-small",
        ordered.length === 1
          ? "One question this dossier could not answer. It is not a finding against the request — it is work that has not been done."
          : ordered.length +
            " questions this dossier could not answer, most consequential first. None of them is a finding against the request — they are work that has not been done."
      )
    );
    function questionItem(q) {
      var item = el("li", "r-question");
      item.appendChild(el("p", "r-finding", q.question));
      /* THE CODE, QUIETLY. A specialist quotes it back when they escalate or
         when they ask why the dossier stopped where it did, and it is the only
         stable handle on a question whose wording may change. Rendered under
         the sentence and in the muted register so it never competes with it. */
      if (q.code) item.appendChild(el("p", "muted r-small r-question-code", q.code));
      return item;
    }

    /* THE TOP BAND IS OPEN AND THE REST IS COUNTED, and the split is the
       SERVER'S OWN ORDERING rather than a judgement this panel makes. A real
       UC-07 relocation raises eight of these, 1,780 characters, and rendering
       all eight open puts a fifth of the page above the record they qualify —
       which is the "multiple reports in one" complaint that produced this
       page's design. Collapsing all of them would be worse: a section that is
       only a summary line states nothing at the moment it is read.

       "THE HIGHEST BAND PRESENT", not "priority 1". A view that emits no
       priority-1 question would otherwise collapse entirely, and there is
       nothing in the contract promising band 1 is ever populated. Whatever the
       most consequential band on THIS dossier is, it is open. */
    var topBand = ordered.length ? (typeof ordered[0].priority === "number" ? ordered[0].priority : 99) : null;
    var lead = ordered.filter(function (q) {
      return (typeof q.priority === "number" ? q.priority : 99) === topBand;
    });
    var rest = ordered.slice(lead.length);

    var list = el("ul", "r-basis-list");
    lead.forEach(function (q) {
      list.appendChild(questionItem(q));
    });
    section.appendChild(list);

    if (rest.length) {
      var box = el("details", "r-cleared");
      box.appendChild(
        el("summary", null, rest.length === 1 ? "1 further question" : rest.length + " further questions")
      );
      var restList = el("ul", "r-basis-list");
      rest.forEach(function (q) {
        restList.appendChild(questionItem(q));
      });
      box.appendChild(restList);
      section.appendChild(box);
    }
    return section;
  }

  /* =========================================================================
     THE FINDINGS THAT REST ON NO SOURCE — the view-level `uncited` list
     =========================================================================
     WHY A SECTION AND NOT A DISCLOSURE BESIDE A FINDING. UC-04's and UC-05's
     absences are attached to the dimension or block they belong to, and
     renderSources draws them there (see renderUncitedEntry). UC-07 and UC-08
     publish a FLAT list instead, because most of their absences belong to no
     block at all: three of UC-08's are stated unconditionally on every dossier
     — citizenship-based taxation, the treaty residence tie-breaker, permanent
     -establishment exposure — and there is no finding on the page for them to
     sit under. They are silences that read as absences of a problem unless
     something says otherwise, which is the whole reason the server states them.

     `basis.sources.uncited` IS DELIBERATELY NOT READ HERE. UC-04 publishes the
     same absences twice: once per dimension, and once deduped under `sources`
     for an API reader. Rendering both would print every one of them a second
     time under a heading of its own — the bibliography-of-silences this file
     already refuses one function up.
     ====================================================================== */
  function renderUncitedFindings(view) {
    var absences = (view.uncited || []).filter(function (a) {
      return a && (a.label || a.finding) && a.why;
    });
    if (!absences.length) return null;

    var section = el("section", "card");
    var box = el("details", "r-sources");
    box.appendChild(
      el(
        "summary",
        null,
        absences.length === 1
          ? "One finding here rests on no source — the reason"
          : absences.length + " findings here rest on no source — the reason for each"
      )
    );
    box.appendChild(
      el(
        "p",
        "muted r-small",
        "None of these is a finding that no rule exists. Each is a statement that this repository has never looked, so nothing below may be read as a clearance."
      )
    );
    absences.forEach(function (absence) {
      box.appendChild(renderUncitedEntry(absence));
    });
    section.appendChild(box);
    return section;
  }

  /**
   * The figures a decision was MADE FROM (`decisionFacts`, the shared bundle
   * shape). `known: false` is rendered as a stated absence with its reason —
   * never as a blank, and never as a 0 that would read as a measurement.
   */
  function renderFactBundle(bundle) {
    var box = el("div", "r-facts");
    if (bundle.sentence) box.appendChild(el("p", "r-finding", bundle.sentence));
    (bundle.facts || []).forEach(function (item) {
      var row = el("div", "r-fact" + (item.known ? "" : " is-unknown"));
      var head = el("p", "r-fact-head");
      head.appendChild(el("span", "r-fact-label", item.label));
      // The same country-by-label rule renderEvidence follows, and for the same
      // reason — see its header. A fact bundle is where UC-03 prints "the
      // country code the classifier extracted", which is precisely a figure a
      // specialist should not have to decode.
      var value = COUNTRY.row(item.label, item.value);
      head.appendChild(el("span", "r-fact-value", item.known ? value : "Not available"));
      row.appendChild(head);
      if (item.note) row.appendChild(el("p", "muted r-small", item.note));
      box.appendChild(row);
    });
    return box;
  }

  /* WHO DECIDES THIS IS SAID ONCE, IN THE DECISION CARD (2026-08-19).
     `renderDeciders` used to print `basis.roles` / `basis.deciders` here, above
     the findings — the same role labels and the same "decides …" sentences that
     renderApprovalRoles prints beside the controls, where it also says which
     slots are filled and by whom. Two lists of the same people, one of them
     unable to say anything about their signatures. The richer one, next to the
     buttons, is the one that survives. `basis.roles` and `basis.deciders` stay
     in BASIS_STRUCTURAL_KEYS so the generic prose pass does not print them
     either. */

  /**
   * The trip a mobility decision is about — the SUBJECT of the decision, so it
   * belongs with the request and not among the findings.
   *
   * ONE LINE, NOT SIX ROWS. Route, nationality, dates, length and the stated
   * travel document were five label/value rows in a 320px column, and the two
   * facts a reader actually orients by — where, and for how long — were spread
   * across three of them. The document type stays on its own line because it is
   * a CLAIM the requester typed, which the immigration dimension below goes on
   * to say was never confirmed; running it into the summary would let it read
   * as established.
   */
  function renderTrip(trip) {
    var box = el("div", "r-trip");
    /* NAMES, NOT CODES — this is the line a mobility specialist orients by, and
       "DE → ES" asks them to decode two countries before they have read a
       single finding. The row's own values are untouched: `trip.destination` is
       still the alpha-2 code every gate above compared, and country.js's
       transform happens here, at the textContent, and nowhere else. */
    var route = COUNTRY.text(trip.homeCountry, "not stated") + " → " + COUNTRY.text(trip.destination, "not stated");
    // NEVER 0. A trip whose length was never derived is not a trip of zero
    // days, and the server sends the sentence saying so.
    var length =
      trip.tripDays === null || trip.tripDays === undefined
        ? trip.tripDaysNote || "length not derived"
        : trip.tripDays + " days";
    var dates = trip.startDate || trip.endDate ? (trip.startDate || "not stated") + " to " + (trip.endDate || "not stated") : null;
    box.appendChild(el("p", "r-trip-route", route + " · " + length));
    var line = [];
    if (dates) line.push(dates);
    if (trip.nationality) line.push(COUNTRY.text(trip.nationality) + " national");
    if (line.length) box.appendChild(el("p", "muted r-small", line.join(" · ")));
    // `visaTypeLabel` FIRST, the code only as a fallback. The requester picked
    // "Schengen short stay" from a list; the specialist deciding their case was
    // reading `schengen_short_stay` one screen over. decisionFacts.js publishes
    // the label precisely so this line does not have to hold a second copy of
    // the mapping.
    var visa = trip.visaTypeLabel || trip.visaType;
    if (visa) box.appendChild(el("p", "muted r-small", "Travel document stated on the request: " + visa));
    return box;
  }

  /* =========================================================================
     THREE GROUPS, DERIVED FROM THE STATE THE SERVER SENT AND NOTHING ELSE
     =========================================================================
     THE COMPLAINT THIS ANSWERS, in the project owner's words: "there is just
     too much info on there… even the important ones are just not really well
     placed." On the UC-04 case they were looking at, the two findings that
     actually needed a person — an unconfirmed treaty pair and a rolling window
     27 days past its watch line — sat below a cleared PE check, a cleared
     Schengen measurement, a 17-row gate table and four blocks of engineering
     backlog. The page held the right facts in the wrong order.

     A finding falls into exactly one group, by shape:

       · NO `state` at all -> CONTEXT. It is the subject of the decision, not a
         verdict on it: UC-06's `change` block IS the amendment. Context is
         rendered with the request, above the findings.
       · a state whose TONE IS `settled` -> CLEARED. Checked, nothing found.
         Collapsed below the controls, still countable, still readable.
       · anything else -> NEEDS WEIGHING. Rendered first and in full.

     THE UNKNOWN STATE FALLS IN THE SAFE DIRECTION. factState() answers `open`
     for a state this file has never heard of, and `open` is not `settled`, so a
     state added server-side tomorrow arrives in front of the specialist rather
     than inside a collapsed "everything is fine" list. Getting this backwards
     is the failure the five-state vocabulary exists to prevent, and it would be
     invisible: a new state hidden as cleared looks exactly like a page with
     nothing to report.

     NOTHING HERE IS A POLICY. `FACT_STATES[state].tone` is the same
     presentation table that already picks the word and the colour, pinned by
     test/zafApp.test.js. This groups by it; it does not decide with it.
     ====================================================================== */

  function isSettledState(state) {
    return factState(state).tone === "settled";
  }

  /* THE PARTITION IS BUILT ONCE PER BASIS, and it has to be: it BUILDS the
     nodes, and building a node registers its sentences with alreadySaid(). Three
     callers each calling it fresh would find every sentence already said by the
     first call and render three empty groups. Keyed on the basis object's own
     identity, and reset with `said` at the top of render(). */
  var partitionCache = { basis: null, groups: null };

  /** {context, weigh, open, cleared} — every renderable item in `basis`. */
  function partitionBasis(basis) {
    if (partitionCache.basis === basis) return partitionCache.groups;
    var groups = { context: [], weigh: [], open: [], cleared: [] };
    /* WHICH LIST AN ITEM LANDS IN, ANSWERED BEFORE IT IS DRAWN. It used to be
       answered only after, because `place()` took a finished node — which is
       why a dimension could not know its own position in the list a reader
       counts. See renderDimension's ordinal. */
    function bucketFor(item) {
      var tone = item.state ? factState(item.state).tone : null;
      if (!item.state) return "context";
      if (tone === "settled") return "cleared";
      return tone === "open" ? "open" : "weigh";
    }
    var counts = { context: 0, weigh: 0, open: 0, cleared: 0 };
    function place(item, node) {
      var tone = item.state ? factState(item.state).tone : null;
      if (!item.state) groups.context.push(node);
      else if (tone === "settled") groups.cleared.push(node);
      // NOT ESTABLISHED IS NOT THE SAME AS NEEDS WEIGHING, and putting them in
      // one list is what produced "an empty section pretending to be content":
      // an escalated UC-05 case whose only two entries said "no notice end date
      // was produced" and "no payout was reconciled" appeared under a heading
      // promising findings to weigh. Nothing was weighed; the run stopped at
      // gate 4. An absence of a verdict is worth stating and worth stating
      // SEPARATELY — it is what the specialist has to go and establish, not
      // what they have to judge.
      else if (tone === "open") groups.open.push(node);
      else groups.weigh.push(node);
    }

    var decidingKey = basis.deciding ? basis.deciding.key : null;
    var decidingMatched = false;

    (basis.dimensions || []).forEach(function (dimension) {
      var isDeciding = Boolean(decidingKey) && dimension.key === decidingKey;
      if (isDeciding) decidingMatched = true;
      // Numbered within the list it will appear in, so a reader counting the
      // rows in front of them never finds a gap where a cleared dimension was
      // filed into a different section.
      var bucket = bucketFor(dimension);
      counts[bucket] += 1;
      place(dimension, renderDimension(dimension, isDeciding, counts[bucket]));
    });
    (basis.measurements || []).forEach(function (measurement) {
      place(measurement, renderMeasurement(measurement));
    });
    // Everything else the server sent that speaks in prose. Shape-driven on
    // purpose: a use case that adds a block carrying a `sentence` gets it
    // rendered without this file being edited, and one that does not is never
    // given an empty heading.
    Object.keys(basis).forEach(function (key) {
      if (BASIS_STRUCTURAL_KEYS[key]) return;
      var block = basis[key];
      if (!block || typeof block !== "object" || typeof block.sentence !== "string") return;
      place(block, renderNarrativeBlock(key, block));
    });

    groups.decidingMatched = decidingMatched;
    partitionCache = { basis: basis, groups: groups };
    return groups;
  }

  /* =========================================================================
     DOES THIS PANEL PUBLISH AN ACCOUNT THAT LEADS THE PAGE?
     =========================================================================
     Three places ask this, and they all used to ask it as `view.basis ||
     view.decisionFacts` — "did the server send the field". That reading was
     correct for as long as the two 🔴 dossiers sent no `basis` at all, and it
     stopped being correct the day they did (commit 553c4a9 gave UC-07 and
     UC-08 hand-curated citation maps, and this file now passes them through).

     The consequence was precise and backwards. UC-08 has no dimensions, no
     measurements and no verdicts of any kind — its basis is a citation map,
     which partitionBasis files as CONTEXT. But the field existed, so
     renderDetails read "something else leads this page" and swept the dossier
     rows — the verdict, every flag with its message, transition safety, the
     cost estimate, the narrative — into "The case record", leaving a 🔴 panel
     whose entire output was one click down, under the reference material it
     was written from. Measured on the seeded UC-08 dossier: 1,884 of 1,970
     characters visible before, 1,139 of 2,430 after.

     THE PREDICATE THAT WAS TRIED FIRST AND IS WRONG: "is there a VERDICT in
     the basis" — does any block carry a state. It separates UC-08 from UC-04
     and it also separates UC-05's escalations, whose `notice`/`discrepancy`/
     `payout` blocks are stateless too and ARE that page's account. It would
     have pushed UC-05's record rows back above the controls and undone part of
     what commit 0f71708 measured. The two cases are indistinguishable by shape,
     because the difference is not in the payload: it is that UC-07 and UC-08
     have no execution path, so their record is their output. A fact about the
     use case belongs on the use case's panel, which is where it now is.
     ====================================================================== */
  function hasDecisionAccount(view) {
    if (view.decisionFacts) return true;
    if (!view.basis) return false;
    /* …UNLESS THE PANEL SAYS ITS RECORD IS THE ANALYSIS. The two 🔴 dossiers
       declare that (panels.js), and it is a fact about the use case rather than
       about the payload: UC-07 and UC-08 have no execution path, so the dossier
       rows ARE what the escalation produced, and a citation map arriving beside
       them does not make them reference material. Declared on the panel, in
       data, and read here — main.js still owns the decision, the same division
       renderActions already keeps for controls. */
    var panel = window.CXPanelFor(view.case && view.case.useCase);
    return !(panel && panel.recordIsTheAnalysis);
  }

  /* =========================================================================
     WHAT THIS DOCUMENT IS NOT — the mandatory framing statement
     =========================================================================
     WHAT WAS BROKEN. `dossier.framing` is the sentence UC-08.md §6 forbids the
     use case to skip — "RESEARCH SUPPORT ONLY — not a residency, withholding,
     or coverage determination" — and UC-07 publishes its own ("not a
     relocation decision or a legal, immigration, or tax determination"). Both
     are written by dossierBuilder.buildDossier() on every dossier ever
     compiled, unconditionally, so that no caller can forget one. It reached
     this screen twice, badly: on UC-08 not at all, and on UC-07 as row 34 of
     the case record, labelled "Standing", under the drafted narrative it is
     supposed to qualify.

     WHY IT IS THE WORST FIELD TO LOSE. UC-07 and UC-08 are the two use cases
     with NO execution path, and their entire safety argument is that they
     CONCLUDE NOTHING: a dossier of statutory quotations, presence-day counts
     and treaty limbs, handed to a specialist with no statement of what it is
     not, reads as an answer. Everything else on this page is a finding that
     can be checked against its source. This is the one sentence that says what
     the whole page is FOR, and a reader who never sees it has been given the
     research and not the warning.

     WHERE IT RENDERS AND WHY THERE. Directly under the header, above the
     decision sentence, the findings and the record — the same position on
     every panel that publishes one, so it is read before the analysis rather
     than found after it. NEVER inside a <details>: a warning behind a click is
     a warning the reader chose not to see, and this one is not theirs to
     choose. test/zafLongformDisclosure.test.js pins both properties.

     THE WORDING IS THE USE CASE'S, NOT THE PANEL'S. Not one word of it is
     written here — this renders `view.framing` verbatim and renders NOTHING
     when the server sent none. A sidebar that composed its own disclaimer
     would be a rendering layer making a legal claim on behalf of a use case
     whose spec it cannot read, which is a worse defect than the missing one.
     Silence is the safe direction for a panel; it is not the safe direction
     for a server, and a 🔴 view that publishes no framing is a server bug to
     report, not a gap to paper over here. */
  function renderFraming(view) {
    var framing = view.framing;
    if (!framing || typeof framing !== "string" || !framing.trim()) return null;
    var box = el("aside", "r-framing");
    // A <details> is the one thing this must never be; a landmark note is what
    // it is. `role="note"` announces it as a parenthetical to the page rather
    // than as one more paragraph of the analysis.
    box.setAttribute("role", "note");
    box.appendChild(el("p", "r-framing-text", framing));
    /* REGISTERED AS SAID, deliberately, and only after it has been printed
       here. A panel that also carries this sentence among its record rows
       would otherwise print it twice on one screen — which is the repetition
       this file was taken apart for, and worse than usual here because the
       second copy trains a reader to skim the first. The prominent copy is
       rendered first, so it is the one that survives. See alreadySaid(). */
    alreadySaid(framing);
    return box;
  }

  /**
   * THE SUBJECT OF THE DECISION — the trip, the change, whatever the request is
   * ABOUT. Rendered with the request rather than among the findings, because
   * "DE → ES, 14 days" is not a verdict and reading it as one costs a specialist
   * the moment they spend working out that it isn't.
   */
  function renderCaseContext(view) {
    var basis = view.basis || null;
    if (!basis) return null;
    var groups = partitionBasis(basis);
    /* A STATELESS BLOCK IS CONTEXT ONLY WHILE SOMETHING ELSE IS A VERDICT.
       UC-06's `change` block is the amendment itself, sitting beside a schema
       check and a payroll check that both carry states — so it is what the
       verdicts are ABOUT, and it belongs with the request. UC-05's escalated
       `notice` and `payout` blocks are stateless too, and they are the whole
       account: nothing was checked, because the run stopped at gate 4. Printing
       those under the decision sentence as if they were the subject reads as a
       report on a calculation that never happened.

       So: context needs a verdict to be context for. When the entire basis is
       stateless, these blocks ARE the account and renderDecisionBasis prints
       them under a heading that says what they are. */
    var hasVerdict = groups.weigh.length || groups.open.length || groups.cleared.length;
    if (!basis.trip && (!groups.context.length || !hasVerdict)) return null;

    var box = el("div", "r-context");
    if (basis.trip) box.appendChild(renderTrip(basis.trip));
    // Directly under the trip it is about, and before anything that qualifies
    // it — see renderMeasurementStrip's header for why it is here at all.
    var numbers = renderMeasurementStrip(basis);
    if (numbers) box.appendChild(numbers);
    if (groups.context.length && hasVerdict) {
      var list = el("ul", "r-basis-list");
      groups.context.forEach(function (node) {
        list.appendChild(node);
      });
      box.appendChild(list);
    }
    return box;
  }

  /**
   * THE NUMBERS THE DECISION TURNS ON — open, always, above everything else.
   *
   * WHY THIS EXISTS (2026-08-31). A mobility specialist opened this panel to
   * decide a work authorization and asked what the automation was FOR: the page
   * led with who filed it, then a long list of what was NOT established, and
   * put every measurement the system had actually computed behind a collapsed
   * "Every check that cleared (N)" toggle — 3,613 characters of it on a real
   * case. So the days already spent in the destination, the Schengen allowance
   * and the tax-residency watch line — the figures a person weighs before
   * approving or declining — were the one thing the reader had to go looking
   * for, while the caveats were unmissable.
   *
   * That is the wrong way round for a screen whose whole purpose is a decision.
   * A panel that leads with its own limitations reads as though it has nothing
   * to say; the work HAD been done and was one click from invisible.
   *
   * WHAT THIS IS NOT. It adds no figure, recomputes nothing and reorders no
   * finding — every number here is `basis.measurements`, rendered by the same
   * data the collapsed block renders in full. The detail, the window, the
   * citations and the caveats all stay exactly where they are, because a
   * headline number without its caveat is the failure this repository is most
   * careful about. This is a pointer INTO that material, not a replacement for
   * it: each line ends in the state word the full finding carries, so a
   * measurement that is NOT within its limit says so here first.
   */
  function renderMeasurementStrip(basis) {
    var measurements = (basis && basis.measurements) || [];
    if (!measurements.length) return null;

    var box = el("div", "r-numbers");
    box.appendChild(el("p", "r-numbers-head", "The counts this decision turns on"));
    var list = el("ul", "r-numbers-list");
    measurements.forEach(function (m) {
      var unit = m.unit ? " " + m.unit : "";
      var row = el("li", "r-numbers-row tone-" + factState(m.state).tone);
      row.appendChild(el("span", "r-numbers-label", m.label));
      // "67 of 90 days" — the shape a person says out loud. A missing figure is
      // stated as missing rather than rendered as a zero, which would be a
      // measurement claim nobody made.
      // A FLOOR IS NOT A CEILING AND MUST NOT BORROW ITS WORDS. "67 of 90 days
      // / 23 days left" is the shape a person says out loud about an allowance
      // being spent. Said about a minimum it inverts: "91 of 14 days, 77 days
      // left" reads as the worst row on the page when it is the safest. Rows
      // carrying `comparison: "floor"` say the measured value first and the
      // minimum second, and their margin is stated as a shortfall or a spare.
      var floor = m.comparison === "floor";
      var measured =
        m.measured === null || m.measured === undefined
          ? "not measured on this run"
          : m.limit === null || m.limit === undefined
            ? m.measured + unit
            : floor
              ? m.measured + unit + " · " + m.limit + unit + " minimum"
              : m.measured + " of " + m.limit + unit;
      row.appendChild(el("span", "r-numbers-value", measured));
      if (m.headroom !== null && m.headroom !== undefined) {
        row.appendChild(
          el(
            "span",
            "r-numbers-headroom",
            floor
              ? m.headroom < 0
                ? amount(Math.abs(m.headroom), m.unit) + " short"
                : amount(m.headroom, m.unit) + " spare"
              : m.headroom + unit + " left"
          )
        );
      }
      row.appendChild(renderStateMark(m.state));
      list.appendChild(row);
    });
    box.appendChild(list);
    box.appendChild(
      el(
        "p",
        "muted r-small",
        "Each figure is repeated in full below, with the window it was measured over and what the source says about it."
      )
    );
    return box;
  }

  /**
   * WHAT NEEDS WEIGHING — the entire point of the panel, and until now the part
   * a specialist reached last. Returns null when the API sent neither field, so
   * a use case that publishes no account renders no empty box claiming there is
   * one.
   */
  function renderDecisionBasis(view) {
    var basis = view.basis || null;
    var bundle = view.decisionFacts || null;
    if (!basis && !bundle) return null;

    var groups = basis ? partitionBasis(basis) : { weigh: [], open: [], cleared: [] };
    var section = el("section", "card r-basis");
    // THE HEADING IS THE TRUTH ABOUT THE GROUP UNDER IT. A case whose whole
    // account is absences — an escalation that stopped at gate 4 — gets a
    // heading that says so, rather than "What needs weighing" over two
    // sentences reporting that nothing was computed.
    section.appendChild(
      el(
        "h2",
        "h2",
        groups.weigh.length || bundle
          ? "What needs weighing"
          : groups.open.length
            ? "What was not established"
            : "What this run found"
      )
    );

    if (bundle) section.appendChild(renderFactBundle(bundle));

    if (basis) {
      if (groups.weigh.length) {
        var list = el("ul", "r-basis-list");
        groups.weigh.forEach(function (node) {
          list.appendChild(node);
        });
        section.appendChild(list);
      }

      if (groups.open.length) {
        // Under its own label whenever something above it was a finding, so the
        // two are never read as one list.
        if (groups.weigh.length || bundle) section.appendChild(el("p", "r-detail-head", "What was not established"));
        var openList = el("ul", "r-basis-list");
        groups.open.forEach(function (node) {
          openList.appendChild(node);
        });
        section.appendChild(openList);
      }

      // The stateless account, when it is the ONLY account. See
      // renderCaseContext for why these are not always shown here.
      var contextIsTheAccount =
        groups.context.length && !groups.weigh.length && !groups.open.length && !groups.cleared.length;
      if (contextIsTheAccount) {
        var contextList = el("ul", "r-basis-list");
        groups.context.forEach(function (node) {
          contextList.appendChild(node);
        });
        section.appendChild(contextList);
      }

      if (!contextIsTheAccount && !groups.weigh.length && !groups.open.length && !bundle) {
        /* SAID, NOT OMITTED. A findings section that simply disappears is
           indistinguishable from one that failed to render, and the reader is
           left to infer which.

           THE TWO SENTENCES ARE NOT INTERCHANGEABLE. "Every check cleared" is a
           claim that checks RAN, and it was false on the first case this
           section was tried against: an escalated UC-05 resignation stopped at
           gate 4 of 8, so most checks never ran and cleared nothing. Claiming
           they had would be the exact `not_reached`-read-as-`passed` error the
           gate ladder exists to prevent, one section over. */
        section.appendChild(
          el(
            "p",
            "r-finding",
            groups.cleared.length
              ? "Nothing was found that needs weighing — the " + groups.cleared.length + " check" +
                (groups.cleared.length === 1 ? "" : "s") + " that ran cleared, and " +
                (groups.cleared.length === 1 ? "it is" : "they are") + " listed below the controls. What is left is the signature."
              : "This run produced no findings to weigh. The gate order below the controls shows which gates ran and which never did — a gate that never ran has said nothing about this case in either direction."
          )
        );
      }

      /* HOW TO READ THE CITATIONS UNDER EVERY FINDING ABOVE — and it sits HERE,
         after the lists, because yesterday it sat directly under the section's
         own H2 and retitled it. On a case with nothing to weigh that H2 reads
         "What was not established", the sub-label that would have re-headed the
         findings list is suppressed when nothing preceded it, and the note
         landed between a heading and the content it names. The findings are
         what the section is for; this is how to read what hangs off them, and a
         reader reaches it in the same scroll either way. Null on a panel whose
         API publishes no framing, so nothing renders an empty promise. */
      var framings = renderSourceFramings(basis);
      if (framings) section.appendChild(framings);

      // THE FACT THAT SETTLED IT. Normally it is MARKED on its own row rather
      // than restated (see renderDimension) — the server lifts the same finding
      // it already publishes as a dimension, and printing both put one label
      // and one sentence on screen twice. This block is the fallback for a
      // `deciding` that names no dimension of its own, where dropping it would
      // lose the finding rather than deduplicate it.
      if (basis.deciding && !groups.decidingMatched) {
        var deciding = el("div", "r-deciding");
        deciding.appendChild(el("p", "r-deciding-label", "The finding that settled it: " + basis.deciding.label));
        if (basis.deciding.finding) deciding.appendChild(el("p", "r-finding", basis.deciding.finding));
        section.appendChild(deciding);
      }

      if (basis.unknowns && basis.unknowns.length) section.appendChild(renderUnknowns(basis.unknowns));
    }

    return section;
  }

  /**
   * EVERY CHECK THAT CLEARED — the same renderers, below the controls, behind a
   * summary that counts them.
   *
   * COUNTED RATHER THAN HIDDEN. "Every check that cleared (2)" is a claim a
   * reader can audit in one click, and it is the sentence that makes the group
   * above meaningful: without it, a short findings list could mean either a
   * clean case or a page that stopped rendering.
   */
  function renderClearedChecks(view) {
    var basis = view.basis || null;
    if (!basis) return null;
    var groups = partitionBasis(basis);
    if (!groups.cleared.length) return null;

    var box = el("details", "r-cleared");
    box.appendChild(el("summary", null, "Every check that cleared (" + groups.cleared.length + ")"));
    box.appendChild(
      el("p", "muted r-small", "Each of these ran and found nothing against the request. None of them is a gate that never ran — those are in the gate order below.")
    );
    var list = el("ul", "r-basis-list");
    groups.cleared.forEach(function (node) {
      list.appendChild(node);
    });
    box.appendChild(list);
    return box;
  }

  /**
   * WHAT THE TRAVELLER MAY STILL ASK FOR — read-only, deliberately, and this
   * function is where that line is drawn in the browser.
   *
   * UC-03's auto-resolved answer carries an OFFER: the trip it just cleared can
   * be certified in a formal travel letter without the employee describing it
   * again (src/uc03/letterOffer.js). The offer is a real, working mechanism and
   * for a while no surface rendered it at all, which is this repository's most
   * persistent defect — work that is complete, correct and reachable by nobody.
   * So it is on this screen.
   *
   * AND IT IS NOT A BUTTON HERE. The reader of this sidebar is a specialist;
   * the offer belongs to the traveller. Accepting requires the traveller's own
   * authenticated session — `POST /api/cases/:id/request-letter` refuses
   * without one (`session_required`), and refuses a session belonging to anyone
   * else (`not_the_traveller`), because prime directive #3 is that identity
   * comes from an authenticated signal and never from a claim. A ZAF token is
   * minted by Zendesk for the AGENT, so a control offered here could not work
   * for the person looking at it — and a control that cannot work is worse than
   * no control, because it reads as a thing the specialist has failed to use.
   *
   * What a specialist gets from it instead is the answer to "has this person
   * already been told they can have the letter, and have they asked?" — which
   * they otherwise have to guess at from a second case appearing later.
   *
   * `offered: false` renders nothing. The API sends a REASON on that shape too
   * (this case is escalated, this case IS the letter request, and so on) and it
   * is deliberately not printed: on every one of those the panel is already
   * saying what the case is, and a second paragraph explaining why a control
   * nobody was offered is absent would be noise on eight panels out of nine.
   */
  function renderLetterOffer(view) {
    var offer = view.letterOffer;
    if (!offer || offer.offered !== true) return null;

    var box = el("section", "card r-letter-offer");
    box.appendChild(el("h2", "h2", "Offered to the employee"));
    box.appendChild(el("p", null, offer.reason));
    if (offer.produces) box.appendChild(el("p", "muted r-small", offer.produces));

    var carries = offer.carries || {};
    /* NAME AND CODE on the destination, unlike every other country on this
       screen. This block is not a finding a specialist weighs — it is the trip
       a formal letter would certify, read by somebody who may have to repeat it
       to a consulate or into a visa appointment form. That is the one line
       countryNameAndCode() exists for. */
    var rows = [
      { label: "Destination", value: carries.destinationCountry ? COUNTRY.nameAndCode(carries.destinationCountry) : null },
      { label: "First day", value: carries.startDate },
      { label: "Last day", value: carries.endDate },
    ].filter(function (row) {
      return row.value;
    });
    if (rows.length) {
      box.appendChild(el("p", "muted r-small", "The trip the letter would certify:"));
      box.appendChild(renderRows(rows));
    }

    /* SAID OUT LOUD, because "there is no button" is indistinguishable from
       "the button has not loaded". The two sentences are different claims and
       both matter: the first says this screen cannot do it, the second says
       who can and that nothing is stuck. */
    /* WHOSE THIS IS, ONCE (2026-08-20). The sentence opened "This is the
       employee's to accept, not yours" — which is the heading two lines above
       it, negated. What the heading cannot say is the part that matters: there
       is no control here, and that is by design rather than a control that has
       not loaded. That claim stays, with the mechanism that makes it true. */
    box.appendChild(
      el(
        "p",
        "muted r-small",
        "A travel letter is requested by the person it is about, from their own authenticated session, " +
          "so there is no control for it on this screen."
      )
    );
    box.appendChild(
      el(
        "p",
        "muted r-small",
        "If they accept, a second case is filed with the letter drafted, and signing it off is the decision above."
      )
    );
    return box;
  }

  /**
   * THE ROUTING ROLLUP — kept, and moved to where a rollup belongs.
   *
   * It is what the policy engine routes on, so hiding it would make the
   * recorded decision unexplainable, and it travels with the server's own
   * sentence saying it must not be read as the assessment. But it prints the
   * word "risk" and a level, three inches under a rail printing the word "risk"
   * and a DIFFERENT level, and that is the contradiction the owner read off
   * this page. It is provenance; it sits with the provenance.
   */
  function renderRiskRollup(view) {
    var basis = view.basis || null;
    if (!basis || !basis.riskLevel) return null;
    var rollup = el("div", "r-rollup");
    rollup.appendChild(el("p", "r-rollup-value", "Risk rollup: " + (basis.riskLevel.value || "not stated")));
    if (basis.riskLevel.note) rollup.appendChild(el("p", "muted r-small", basis.riskLevel.note));
    return rollup;
  }

  /* THE REASON, IN WORDS FIRST AND THE SLUG SECOND.
     This card printed `over_policy_cap` and then, underneath, the identical
     string again as a flag chip — a heading, a restatement, and no sentence
     anywhere saying that the claim is above its category's spend cap. The
     system knew: `view.decidedBy.means` is written per REASON beside the gates
     themselves (describeDecidingGate, src/uc02/policyEngine.js).

     The slug is kept beside the prose rather than replaced. It is the exact
     string in `audit_log`, in the metrics exception ranking and in the n8n
     ports, so it is what somebody searches by; prose that replaced it would
     make this card readable and the system harder to trace. Use cases with no
     gate map fall through to the slug alone, which is what they showed before. */
  function renderWhy(view) {
    var c = view.case;
    var section = el("section", "card r-lead");
    var means = view.decidedBy && view.decidedBy.means;
    // NO "WHY" HEADING. The sentence is the answer to the question the heading
    // asked, it is the first thing under the request, and a heading above it
    // was one more line to read past on a panel the owner already found dense.
    //
    // AND NO SLUG ON THE TWO 🔴 DOSSIERS (2026-08-20). The slug is kept beside
    // the prose everywhere else because it is the exact string in `audit_log`,
    // in the metrics exception ranking and in the n8n ports — what somebody
    // searches by. UC-07's `global_mobility_review` and UC-08's
    // `cross_border_tax_inquiry` are neither: they are written in THIS FILE by
    // loadUc07/loadUc08, because those views publish no decision of their own,
    // and no audit row anywhere contains either string. So a Tier-3 lawyer was
    // reading a word invented by a browser, in the most prominent position on
    // the page, directly under the research disclaimer — vocabulary that is
    // not even the builder's, and traceable to nothing. Where a use case
    // declares its record IS its analysis and publishes no `means`, the line
    // stands down; the flags block below it and the rows are the account.
    var ownPanel = window.CXPanelFor(c.useCase);
    var slugIsSynthesised = Boolean(ownPanel && ownPanel.recordIsTheAnalysis) && !means;
    if (!slugIsSynthesised) section.appendChild(el("p", "reason", means || c.reason || "—"));

    /* THE FLAG CODES GO WHERE THEY ARE THE FINDING, AND NOWHERE ELSE.
       `a1_certificate_recommended` appeared three times on one UC-04 case: a
       row in the Case card, a chip here, and the dimension that explains it in
       words. A code that names a finding the page states in a sentence is a
       label for something already said — it belongs with the audit strings, in
       the collapsed provenance block, which is where a person tracing the case
       goes looking for it.

       BUT A USE CASE THAT PUBLISHES NO BASIS HAS NOTHING ELSE. UC-01, UC-07 and
       UC-08 send no dimensions and no measurements, so their flags ARE the
       findings list, and hiding them would leave a 🔴 dossier claiming nothing
       was raised. So the codes lead here exactly when nothing else will state
       them.

       …EXCEPT WHERE THE PANEL ITSELF STATES THEM BETTER (2026-08-20). UC-07's
       record renders one row PER FLAG carrying its severity, its code AND the
       sentence saying what to do about it. This block was then printing the
       same nine codes a second time, bare — `HIGH · UC07_RIGHT_TO_WORK_MISSING`
       with no message — directly under the mandatory research disclaimer, on
       the page where the first thing a Tier-3 lawyer reads matters most. Two
       lists, one of them unreadable. The panel declares `statesItsOwnFlags`
       and this block stands down for it, exactly as it stands down for a use
       case with a findings section; UC-01 and UC-08 declare nothing and keep
       it, because for them it is the only statement — including the negative
       one, which is why the else-branch is not gated on the flags existing. */
    var flags = c.flags || [];
    var hasFindings = hasDecisionAccount(view);
    if (!hasFindings && !(ownPanel && ownPanel.statesItsOwnFlags)) {
      if (flags.length) {
        var list = el("ul", "flags");
        flags.forEach(function (flag) {
          list.appendChild(el("li", "flag", flag));
        });
        section.appendChild(list);
      } else {
        section.appendChild(el("p", "muted r-small", "No escalation flags were raised."));
      }
    }

    // THE SUBJECT OF THE DECISION — the trip, the change. Under the sentence
    // that says what is being asked, above the findings that weigh it.
    var context = renderCaseContext(view);
    if (context) section.appendChild(context);
    // A CARD WITH NOTHING IN IT IS NOT A CARD. UC-07 publishes no `means`, no
    // context block, and states its own flags in its rows — so with the
    // synthesised slug gone this section can legitimately be empty, and an
    // empty bordered band reads as a block that failed to render.
    return section.childNodes.length ? section : null;
  }

  /**
   * EVERYTHING ELSE, BELOW THE CONTROLS AND COLLAPSED.
   *
   * WHAT THIS IS FOR. Four kinds of thing were competing with the findings for
   * the top of the panel and none of them is read to make a decision: the
   * cleared checks (a verdict of "nothing here"), the gate order and audit
   * strings (provenance), the panel's own record rows (reference), and the
   * routing rollup (a number the policy engine used, which the server itself
   * says not to read as the assessment). Each is genuinely wanted, sometimes,
   * by someone tracing a case afterwards. None of them is wanted by the person
   * deciding, before.
   *
   * THE RECORD ROWS COLLAPSE ONLY WHEN SOMETHING ELSE LEADS. A panel that
   * publishes no basis and no fact bundle — UC-07 and UC-08's dossiers, UC-01's
   * review — has nothing else on the page: its rows ARE the page, and they stay
   * open. The rule is the same one the flags follow, for the same reason.
   */
  function renderDetails(view) {
    var c = view.case;
    var hasFindings = hasDecisionAccount(view);
    var section = el("section", "card r-details");

    var cleared = renderClearedChecks(view);
    if (cleared) section.appendChild(cleared);

    // The gate order, the reason slug and the flag codes, behind one summary.
    var decidedBy = renderDecidedBy(view, hasFindings ? c.flags || [] : []);
    if (decidedBy) section.appendChild(decidedBy);

    var record = el("details", "r-record");
    record.appendChild(el("summary", null, "The case record"));
    // A panel with nothing else on the page has already rendered these rows
    // open, above the controls — see render().
    if (hasFindings) record.appendChild(renderRows(window.CXPanelFor(c.useCase).rows(view)));
    /* SHORTENED — see shortRef() below. It is a prefix of the real id, so it
       still finds the record; the whole key is on the record and on the audit
       row, which is where an exact key belongs. */
    record.appendChild(el("p", "muted r-small r-case-id", c.useCase + " · case " + shortRef(c.id)));
    // rca-iih7 / D-31: "Classified as a low-risk use case" used to repeat here
    // — the tier's name is ALREADY on the page, either inside renderCaseRisk's
    // "This request: … — this use case's own X baseline …" sentence (every
    // panel that sets `caseRisk`) or as renderTierRail's own `r-tier-name`
    // fallback headline (every panel that does not). A specialist who read
    // both, plus the tier glyph's colour, described three risk statements on
    // one screen that did not obviously agree — the exact repetition this
    // section's own header comment says the header sentence was built to
    // retire. This was the one place it had not been retired from.
    var rollup = renderRiskRollup(view);
    if (rollup) record.appendChild(rollup);
    section.appendChild(record);

    return section;
  }

  /* THE OUTCOME BADGE — the first thing in the DECISION card, when the API
     supplies one.

     WHY IT IS HERE AND NOT IN A PANEL. It renders above the branch that
     decides between controls and prose, so it appears in BOTH states: a held
     claim shows PENDING with its buttons still under it, and a settled one
     shows APPROVED or DECLINED where the buttons used to be. Putting it in a
     panel's renderActions() would have made it visible only in the actionable
     state, which is the state where the outcome is least interesting.

     IT DERIVES NOTHING. Every string comes off `view.outcome`, which the API
     computed. This file does not know that "approved" means settled, does not
     read `remoteResult`, and does not decide that a held claim is not yet
     decided — those are judgements about the data and they live server-side,
     the same rule `actionable` follows.

     COLOUR IS NEVER THE CARRIER: `tone` only picks a CSS class, and
     `outcome.label` is always rendered as text. */
  function renderOutcomeBadge(outcome) {
    var wrap = el("div", "r-outcome tone-" + String(outcome.tone || "waiting"));
    var label = el("span", "r-outcome-label", outcome.label);
    // The tone is decorative; the word is the fact. Announce the word only.
    wrap.appendChild(label);
    if (outcome.remoteStatus) {
      // Remote's own enum member, printed verbatim beside our sentence — so a
      // reader comparing this card to Remote's UI is comparing like with like.
      wrap.appendChild(el("span", "r-outcome-remote", "Remote status: " + outcome.remoteStatus));
    }
    if (outcome.detail) wrap.appendChild(el("p", "r-outcome-detail", outcome.detail));
    return wrap;
  }

  /* =========================================================================
     WHO DECIDES THIS, AND IN WHAT CAPACITY
     =========================================================================
     THE QUESTION, ASKED BY A SPECIALIST LOOKING AT A LIVE UC-04 ESCALATION:
     "does the tag section show me which type of human approval I am acting
     as?" No. `uc04_specialist_approval` and `queue_mobility_specialists` are
     routing metadata — they record where the ticket was sent, not what the
     person reading it is being asked to be — and a Zendesk tag box is not
     somewhere anyone looks for that. This card says it in the one place the
     decision is actually made.

     IT RENDERS IN BOTH STATES, DELIBERATELY. It sits above the branch between
     controls and the refusal sentence, so a case that cannot be decided here
     still says whose decision it is and which signatures are outstanding.
     Putting it inside the actionable branch would have hidden it in exactly
     the state where "who should be looking at this?" is the live question.

     WHERE THE WORDS COME FROM, IN PRIORITY ORDER:
       1. `view.approvalRoles`, if the API sent it. Nothing sends it today; the
          shape is documented at the top of panels.js and in
          docs/SIDEBAR-APPROVAL-ROLES.md so a server can take this over with no
          change here.
       2. the panel's own `approvalRoles(view)` descriptor — the role NAMES,
          which are a fixed property of the use case (src/review/
          approverEntitlement.js's USE_CASE_ROLES, pinned by
          test/zafApprovalRole.test.js), plus the filled slots read straight off
          the row.

     WHAT IT REFUSES TO SAY. Whether the agent reading it personally holds the
     role. That is a judgement about a person against a roster; it belongs to
     the server, which already makes it on submit (`approver_not_entitled`).
     `youHold` is printed ONLY when the API sends it, and while nothing does,
     this card says plainly that the check happens on submit and that this
     screen was not told the answer — which is true, and better than either
     guessing or staying silent.

     AND IT GATES NOTHING. No button, no listener, no read of `view.actionable`.
     `view.actionable` remains the single question that decides whether any
     control exists, asked once, in renderActions below. 🔴 UC-07 and UC-08
     return an empty `roles` list and gain nothing clickable.
     ====================================================================== */

  function approvalRolesFor(view) {
    // The server's answer wins whenever there is one — same precedence every
    // other field on this screen follows.
    if (view.approvalRoles && typeof view.approvalRoles === "object") return view.approvalRoles;
    var panel = window.CXPanelFor(view.case.useCase);
    return typeof panel.approvalRoles === "function" ? panel.approvalRoles(view) : null;
  }

  /* THE THIRD STATE THIS CARD NEEDED (2026-08-19).
     It was built for two: a slot somebody can fill here, and a slot somebody
     already filled. A real escalated UC-05 case is neither, and the card said
     so in the loudest possible way — "HR Ops · OUTSTANDING", then "Decides
     whether the calculated notice period and payout are correct", then "Whether
     you hold this role is checked by the API when you submit" — with, three
     lines below, the server's own "It has no sign-off path here; the escalation
     is worked on its own ticket."

     Both of those sentences are about a submission that cannot be made.
     `outstanding` says a signature is owed HERE; the entitlement note explains
     what happens WHEN YOU SUBMIT. On a case with no path, each is a promise the
     next line withdraws, and the reader is left to work out which half of the
     screen to believe.

     So an unfilled slot on a case that is not actionable reads NOT OPEN HERE,
     and the submit-time note stands down entirely. What survives is the thing
     the specialist actually needs from this card in that state: the name of the
     role that owns the decision. Naming the owner is not the same claim as
     offering the form, and it is the only one of the two that is true.

     `actionable` is read, not computed — it is the server's field, and it stays
     the ONE question that decides whether a control exists (renderActions).
     This card still renders none. */
  function renderApprovalRoles(view) {
    var described = approvalRolesFor(view);
    if (!described) return null;
    var roles = described.roles || [];
    var openHere = view.actionable === true;

    var box = el("div", "r-capacity");
    box.appendChild(el("h3", "h3", "Who decides this"));
    if (described.summary) box.appendChild(el("p", "r-capacity-summary", described.summary));
    if (!roles.length) return box;

    var entitlementAnswered = false;
    // Does the settled block below carry the signer's name already? Only a
    // single-slot use case can be in that state — a dual-control amendment with
    // one slot filled is not settled at all.
    var settledStatesTheSigner = Boolean(
      view.settled && view.settled.headline && (view.settled.facts || []).length && roles.length === 1
    );
    var list = el("ul", "r-capacity-list");

    roles.forEach(function (role) {
      var filled = Boolean(role.filledBy);

      var item = el("li", "r-capacity-role " + (filled ? "is-filled" : "is-open"));
      var head = el("p", "r-capacity-head");
      head.appendChild(el("span", "r-capacity-label", role.label));
      // The word carries it; the colour on the rail beside it is the third cue.
      // "Outstanding" rather than "pending" because a slot nobody has filled is
      // work somebody still owes, which is the fact an agent is looking for.
      head.appendChild(el("span", "r-capacity-state", filled ? "recorded" : openHere ? "outstanding" : "not open here"));
      item.appendChild(head);

      if (role.decides) item.appendChild(el("p", "muted r-small", "Decides " + role.decides));

      /* WHO SIGNED, unless the settled block below is about to say it in full.
         A closed UC-04 approval publishes `settled`, whose first two rows are
         "Approved by" and "Approved on" — the same two facts. Printing both
         puts one decision on screen twice, inches apart, which is how a reader
         starts wondering whether they are two decisions. The slot still reads
         RECORDED either way, which is this card's own job. */
      if (filled && !settledStatesTheSigner) {
        item.appendChild(
          el(
            "p",
            "r-small r-capacity-filled",
            (role.filledAs || "Recorded") + " by " + role.filledBy + (role.filledOn ? " on " + role.filledOn : "")
          )
        );
      }

      /* THE SERVER'S VERDICT, OR NOTHING. `youHold` is not computed here and
         never can be: this bundle holds no roster, and a roster it did hold
         would be a second copy of an access control. */
      if (role.youHold === true) {
        entitlementAnswered = true;
        item.appendChild(el("p", "r-small r-capacity-you ok", "You hold this role."));
      } else if (role.youHold === false) {
        entitlementAnswered = true;
        item.appendChild(
          el(
            "p",
            "r-small r-capacity-you bad",
            "You do not hold this role, so a decision submitted under it will be refused."
          )
        );
      }

      // The exact grant string, for the person who needs to ask to be added to
      // the roster. It is monospace and small because it is a precise internal
      // term next to plain language, not a substitute for it.
      /* GATING THIS ON `openHere` WAS TRIED ON 2026-08-31 AND REVERTED THE SAME
         HOUR. The argument was sound — on UC-04 the state beside it reads "not
         open here" and no roster grant can open it, so a slug whose stated
         purpose is "quote this when asking for access" invites a request that
         would change nothing. test/zafApprovalRole.test.js refused it, and the
         test is right: the rendered string is an IDENTIFIER, not an invitation.
         Nothing on the page tells the reader to ask for it, the sentence two
         lines up already says the absence is structural rather than a
         permissions problem, and the slug is what a specialist quotes when they
         ask what this role IS. The invitation lives in this comment, which is
         the thing to fix if it ever misleads anyone. */
      /* `role.roleId` IS NOT RENDERED (2026-08-31). "uc04:mobility_specialist"
         is an entitlement-roster key. The comment above used to argue it was
         "what a specialist quotes when they ask what this role IS" — but the
         row already names the role in words and says what it decides, and the
         panel is shown to people outside Remote. An identifier nobody outside
         this system can look up is not a clarification. It is still checked
         server-side on submit, unchanged; only the display is dropped. */

      list.appendChild(item);
    });

    box.appendChild(list);

    /* NAMED, NOT COUNTED — and that is not a style preference.
       UC-06's own controls render an approval meter directly below this,
       reading "1 of 2 approvals recorded". A line here reading "1 of 2 roles
       still to sign" puts two sentences one inch apart, both saying "1 of 2",
       meaning opposite things. This repo has already paid for one screen making
       two claims a reader has to reconcile. Naming the role that still owes a
       signature answers the actual question anyway: not how many, but who. */
    if (roles.length > 1) {
      var open = roles
        .filter(function (role) {
          return !role.filledBy;
        })
        .map(function (role) {
          return role.label;
        });
      box.appendChild(
        el(
          "p",
          "r-small r-capacity-outstanding",
          open.length === 0
            ? "Every role has signed."
            : openHere
              ? "Still to sign: " + open.join(", ") + "."
              // "Still to sign" on a case with no path here reads as a queue
              // somebody is working through on this screen. Nobody is.
              : "Held by: " + open.join(", ") + "."
        )
      );
    }

    /* Only while somebody still has to sign. On a settled case nothing is
       going to be submitted, so a sentence about what happens when you submit
       is noise on the one screen that should read as closed. */
    var anyOutstanding = roles.some(function (role) {
      return !role.filledBy;
    });
    if (openHere && anyOutstanding && !entitlementAnswered && roles.some(function (role) { return Boolean(role.roleId); })) {
      box.appendChild(
        el(
          "p",
          "muted r-small r-capacity-unknown",
          (roles.length === 1 ? "Whether you hold this role" : "Whether you hold one of these roles") +
            " is checked when you submit — this panel is not told, and does not decide it. If your decision " +
            "comes back refused because you do not hold it, that is what happened."
        )
      );
    }

    return box;
  }

  /* =========================================================================
     "ACTING AS" — A LOGICAL PLACE TO SAY WHICH ROLE YOU ARE PLAYING
     =========================================================================
     THE ASK, in the project owner's own words: "you know i will be acting as
     multiple and different types and levels and roles of human approvers. So
     there needs to be a clear indication when i am playing a role. There needs
     to be a logical place to enter that role."

     THE PRIOR ART IS IN THIS REPO AND IS COPIED ON PURPOSE. src/portal/ already
     solves the same problem one surface over: a "Signed in as" persona picker
     with a one-line note saying who that persona is and what they may file. It
     works because it is unembarrassed about what it is. This is the approver
     side of it, in the same shape — a labelled <select> plus a note.

     AND IT CANNOT GRANT ANYTHING, WHICH IS THE WHOLE REASON IT IS ALLOWED TO
     EXIST. It changes which role's FORM is on screen and nothing else. Each
     form still posts its own fixed `role` — customer_admin's block has always
     posted customer_admin — so picking "Payroll Specialist" here is exactly as
     authoritative as scrolling to that block was before, which is to say not at
     all. The server decides: identity from the signed ZAF token
     (src/shared/approverAuth.js), entitlement from the roster
     (src/review/approverEntitlement.js), and a person who does not hold the
     role is refused whatever this control says. A picker that could grant a
     role would be worse than no picker, and this one structurally cannot.

     IT APPEARS ONLY WHERE THERE IS A CHOICE — two or more slots, i.e. UC-06 and
     UC-09. One slot is not a choice, and the card above already names it.

     THE DEFAULT IS THE FIRST OUTSTANDING SLOT, because that is the work: a
     dual-control amendment whose admin has already signed is waiting on
     payroll, and opening on the signed slot would show the agent a form nobody
     needs. */

  /** Every role block the panel rendered, keyed by its own role. */
  function collectRoleSlots(node, found) {
    var slots = found || {};
    var className = String(node.className || "");
    var match = className.match(/(?:^|\s)role-slot-([a-z0-9_]+)/);
    if (match) slots[match[1]] = node;
    (node.childNodes || []).forEach(function (child) {
      collectRoleSlots(child, slots);
    });
    return slots;
  }

  /** The role a descriptor entry addresses a block by — "uc06:x" -> "x". */
  function slotKey(role) {
    if (role.roleId) {
      var parts = String(role.roleId).split(":");
      return parts[parts.length - 1];
    }
    return null;
  }

  function setHidden(node, hidden) {
    var base = String(node.className || "").replace(/\s*is-hidden\b/g, "");
    node.className = hidden ? base + " is-hidden" : base;
  }

  function attachRolePicker(box, actionsNode, described) {
    if (!box || !actionsNode || !described) return;
    var roles = (described.roles || []).filter(function (role) {
      return slotKey(role);
    });
    if (roles.length < 2) return;

    var slots = collectRoleSlots(actionsNode);
    var choices = roles.filter(function (role) {
      return slots[slotKey(role)];
    });
    // Fewer blocks on screen than roles in the descriptor means the panel chose
    // not to render one (UC-09's third slot on a two-slot adjustment). Nothing
    // to switch between, so nothing is drawn — never a picker offering a form
    // that is not there.
    if (choices.length < 2) return;

    var wrap = el("div", "r-role-picker");
    var field = labelledField("select", "role-picker-select", "Acting as", {});
    var select = field.control;
    choices.forEach(function (role) {
      var option = el("option", null, role.label + (role.filledBy ? " — already signed" : ""));
      option.value = slotKey(role);
      select.appendChild(option);
    });
    wrap.appendChild(field.wrap);

    /* NO RUNNING NOTE (2026-08-20). It read "<Role> decides <what it decides>"
       — and `decides` is the SAME string, byte for byte, that the card
       immediately above prints under that role's own name, so selecting a role
       reprinted a line already on screen. What the note carried that the card
       does not is already carried by the <option> itself ("— already signed")
       and by the form the picker reveals, whose legend names the role and whose
       signed state renders as "Approved by …". */
    wrap.appendChild(
      el(
        "p",
        "muted r-small",
        "This only chooses which form you are looking at. It grants nothing: each form submits its own role, " +
          "and whether you may sign it is decided when you submit."
      )
    );
    box.appendChild(wrap);

    function show(key) {
      choices.forEach(function (role) {
        setHidden(slots[slotKey(role)], slotKey(role) !== key);
      });
    }

    // The first slot nobody has signed yet; failing that, the first one.
    var open = choices.filter(function (role) {
      return !role.filledBy;
    })[0];
    var initial = slotKey(open || choices[0]);
    select.value = initial;
    select.addEventListener("change", function () {
      show(select.value);
      resize();
    });
    show(initial);
  }

  /* A UUID, shortened for a person to read (2026-08-31).

     A database key in the middle of a customer-facing line is noise: nobody
     outside this system can look it up, it cannot be read over a phone, and a
     page full of them looks like a debug dump — which is what the project owner
     found on opening this panel to show it to an audience.

     A PREFIX OF THE REAL ID, not a hash and not a new identifier, so it still
     resolves by prefix search and can never name a record that does not exist.
     Anything that is not a UUID is returned unchanged — an email address, a
     session name or a ticket number is already readable, and truncating one
     would destroy information rather than hide noise.

     DEFINED HERE AND IN panels.js AND IN src/shared/publicReference.js. Three
     copies of four lines, because the two browser files are separate <script>
     tags with no module system between them and the server composes some of
     this prose itself. test/zafNoDeveloperArtifacts.test.js holds all three to
     the same answers, which is the same discipline test/n8nParity.test.js
     applies to the gates. */
  var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  function shortRef(value) {
    var v = value === null || value === undefined ? "" : String(value).trim();
    return UUID_RE.test(v) ? v.slice(0, 8) : v;
  }

  function renderActions(view, ticketId, currentUser) {
    var section = el("section", "card actions");
    section.appendChild(el("h2", "h2", "Decision"));

    if (view.outcome && view.outcome.label) {
      section.appendChild(renderOutcomeBadge(view.outcome));
    }

    /* WHO DECIDES THIS renders in BOTH states, and its POSITION depends on
       which state (2026-08-19). On a case that can be decided here it comes
       first, because "which capacity am I acting in" is the question you answer
       before filling the form under it. On a case that cannot, it comes AFTER
       the refusal — the project owner read a card promising a sign-off path and
       then, three lines later, a sentence withdrawing it, and asked reasonably
       which one to believe. Refusal first, then who owns it, is the order those
       two sentences are true in. */
    var capacity = renderApprovalRoles(view);
    var described = approvalRolesFor(view);

    /* A DECISION THAT IS ALREADY MADE IS SHOWN WHETHER OR NOT ANOTHER ONE IS
       OPEN (2026-08-31), and this is a defect a reader found before any test
       did. `settled` used to be drawn only in the `!actionable` branch below —
       a rule written when "settled" and "nothing left to do here" were the same
       thing. Since 2026-08-31 UC-04 has a case that is BOTH: stage 2, the
       employer's approval, is settled, and stage 3, Remote's own mobility
       review, is open on this very screen. So the employer's approval vanished
       from the panel at exactly the moment a specialist is asked to review it —
       the one moment knowing who approved it matters. The API published it the
       whole time; only the rendering dropped it.

       THE `finality` SENTENCE IS DELIBERATELY WITHHELD HERE. It reads "an
       approved request cannot be approved or declined again", which is true of
       the stage below and would be read as "there is nothing to do here" when
       printed directly above a live control. It is still printed in full on a
       case with nothing open, where it means what it says. */
    var settledAlready = view.settled;
    if (view.actionable && settledAlready && settledAlready.headline) {
      var done = el("div", "r-settled-earlier");
      done.appendChild(el("p", "r-settled-headline", settledAlready.headline));
      if (settledAlready.facts && settledAlready.facts.length) done.appendChild(renderRows(settledAlready.facts));
      section.appendChild(done);
    }

    if (capacity && view.actionable) section.appendChild(capacity);

    if (!view.actionable) {
      /* A SETTLED DECISION IS A LIST OF FACTS, NOT A PARAGRAPH.
         `settled` ({headline, facts:[{label,value}], finality}, computed by
         settledFacts() in src/uc04/approvalPolicy.js) carries the same facts as
         `actionableReason` in a shape this panel can lay out. Its string
         sibling, describeSettled(), joins them with NEWLINES — which collapse
         in HTML, so a carefully-labelled account arrived on screen as one
         run-on sentence and the project owner asked, reasonably, "why all this
         story". The facts were never the problem; the rendering was.

         Straight into renderRows(): the label/value pairs are already the shape
         the Case card above uses, so a settled decision reads like the rest of
         the panel instead of like an apology. NOTHING IS REFORMATTED HERE — the
         timestamps arrive pre-humanised by humanTime() (src/shared/
         settledDecision.js), which exists because `pg` returns a Date for a
         timestamptz and the same decision therefore rendered two different ways
         depending on which store it came from. A second formatter in the
         browser would be a rival copy of a rule that now lives in one place.

         The string is still the fallback, for every API that sends no `settled`
         and for a row that cannot say which outcome it got. */
      var settled = view.settled;
      if (settled && settled.headline) {
        section.appendChild(el("p", "r-settled-headline", settled.headline));
        if (settled.facts && settled.facts.length) section.appendChild(renderRows(settled.facts));
        if (settled.finality) section.appendChild(el("p", "muted r-small r-settled-finality", settled.finality));
      } else {
        // The API's own words, not a message this file invented — so the reason
        // an agent reads is the reason the policy actually gave. Coming from
        // the API also means this is the ONE place "is this actionable?" is
        // decided — a panel never gets asked that question, only "what do the
        // controls look like once main.js has already said yes."
        /* THE SERVER'S OWN WORDS, MINUS THE ONES ALREADY ON SCREEN. UC-05's
           refusal is three sentences: where the run stopped, WHY (the exact
           paragraph the panel opened with, byte for byte, because
           `actionableReason` has to stand alone in a context where nothing else
           was printed), and that the escalation is worked on its own ticket.
           The first and third are new; the second is the fourth copy of one
           string. Removing the copy leaves a refusal that reads as a refusal
           instead of as a re-explanation. If nothing is left after the removal,
           the whole reason is printed — a blank refusal is worse than a
           repeated one. */
        var reason = view.actionableReason || "";
        var repeated = view.decidedBy && view.decidedBy.means;
        var trimmed = repeated && reason.indexOf(repeated) !== -1
          ? reason.split(repeated).join(" ").replace(/\s+/g, " ").trim()
          : reason;
        section.appendChild(el("p", "muted", trimmed || reason || "This case is not open to a decision here."));
      }
      if (capacity) section.appendChild(capacity);
      var review = view.review;
      if (review && review.status && review.status !== "pending") {
        section.appendChild(
          el("p", "muted", "Recorded as " + review.status + (review.assignee ? " by " + review.assignee : "") + ".")
        );
        if (review.notes) section.appendChild(el("p", "note-echo", review.notes));
      }
      return section;
    }

    var panel = window.CXPanelFor(view.case.useCase);

    /* A CONTROL IS NEVER DRAWN WITHOUT SOMEWHERE TO SEND IT (2026-08-30).
       Every set of controls below — the panel's own and the shared pair —
       submits through `view.post`, which the use case's loader attaches. A
       loader that attaches none is saying this surface performs no write for
       this use case; UC-07 and UC-08 have always been in that state, and UC-04
       joined them when the employer's approval moved to the customer's own
       surface.

       Without this line that intent rests entirely on the server answering
       `actionable: false` forever. One stale fixture, one hand-built view, one
       future route that forgets, and the sidebar draws an Approve button whose
       click throws — or worse, is wired back to something that writes. The
       panel's own hint says why there is nothing here, which is the same
       sentence the refusal branch above would have printed.

       IT DECIDES NOTHING. `view.actionable` is still the only question about
       whether a decision MAY be made, asked once, above. This asks the
       strictly mechanical question of whether this bundle has anywhere to send
       one, and it can only ever withhold a control. */
    if (typeof view.post !== "function") {
      section.appendChild(el("p", "hint", panel.approveHint(view)));
      return section;
    }

    // A panel may render its own controls — UC-06's two independently-filled
    // role slots don't fit a single approve/decline pair. When it doesn't, this
    // is that single pair: UC-01's exact original behavior, unchanged.
    if (typeof panel.renderActions === "function") {
      var controls = panel.renderActions(view, {
        el: el,
        resize: resize,
        // Shared so a panel cannot ship an unlabelled input by accident, and
        // so the approval meter looks the same wherever it appears. Both are
        // pure presentation helpers — a panel still gets no way to decide
        // whether controls should exist.
        labelledField: labelledField,
        approvalMeter: renderApprovalMeter,
        reload: function () {
          load(ticketId, currentUser);
        },
      });
      section.appendChild(controls);
      // AFTER the controls exist, because the picker only shows and hides the
      // blocks the panel just built. It renders nothing when there is one slot.
      attachRolePicker(capacity, controls, described);
      return section;
    }

    section.appendChild(el("p", "hint", panel.approveHint(view)));

    // N-4 (rca-il7, 2026-08-22): this box was labelled "(optional)" while
    // the server has always refused an empty one — reviewPolicy.js's
    // `reason_required` gate (400, "A reason for the decision is required
    // and is recorded in the audit log.") — which contradicted acceptance
    // §14's "one approve, one decline, a required reason" on the same
    // screen. The gate is correct and is NOT changed here; only the label.
    var noteField = labelledField("textarea", "note", "Reason (required)", {
      rows: 2,
      placeholder: "Recorded in the audit log",
    });
    section.appendChild(noteField.wrap);
    var note = noteField.control;

    var buttons = el("div", "buttons");
    var approve = el("button", "btn approve", "Approve");
    approve.type = "button";
    // DECLINE, NOT DENY (renamed 2026-08-19). `deny` appears zero times in
    // Remote's documented corpus; `declined` is a member of four of its enums,
    // and UC-02's panel has said Decline since it was built because Remote's
    // own `DeclineExpenseParams` forced it to. The API still ACCEPTS `deny`
    // (src/shared/declineVocabulary.js), which is what lets this bundle and
    // the server be re-deployed in either order — an installed bundle that has
    // not been re-uploaded keeps posting the old verb and keeps working.
    var decline = el("button", "btn decline", "Decline");
    decline.type = "button";
    buttons.appendChild(approve);
    buttons.appendChild(decline);
    section.appendChild(buttons);

    // The verdict of an approve/decline — the one message in this sidebar that
    // reports a write to audit_log. It replaces its own text in place with no
    // focus change, so without a live region a screen-reader user clicks
    // Approve and is told nothing at all about whether it worked.
    var status = el("p", "action-status");
    status.setAttribute("role", "status");
    section.appendChild(status);

    function submit(action) {
      approve.disabled = true;
      decline.disabled = true;
      status.className = "action-status";
      status.textContent = "Recording " + action + "…";

      view
        .post(action, { approver: currentUser, note: note.value })
        .then(function (result) {
          if (result.ok) {
            status.className = "action-status ok";
            status.textContent =
              action === "approve"
                ? "Approved." + (result.letterIssued ? " Letter issued and ticket solved." : "")
                : "Declined and recorded.";
            // ...and again as a flash, because the reload below destroys the
            // line above. See pendingFlash.
            pendingFlash =
              action === "approve"
                ? {
                    title: "Approved — recorded in the audit log.",
                    detail: result.letterIssued
                      ? "The verification letter was issued and the ticket solved."
                      : "No letter was issued for this case.",
                  }
                : {
                    title: "Declined — recorded in the audit log.",
                    detail: "Nothing was written to the employment record.",
                  };
            // Re-read rather than patching the DOM from the response: the
            // server is the source of truth for what the case now looks like.
            setTimeout(function () {
              load(ticketId, currentUser);
            }, 900);
          } else {
            status.className = "action-status bad";
            status.textContent = result.reason || "Refused.";
            approve.disabled = false;
            decline.disabled = false;
          }
          resize();
        })
        .catch(function (err) {
          status.className = "action-status bad";
          status.textContent = "Could not reach the review API: " + err.message;
          approve.disabled = false;
          decline.disabled = false;
          resize();
        });
    }

    approve.addEventListener("click", function () {
      submit("approve");
    });
    decline.addEventListener("click", function () {
      submit("decline");
    });

    return section;
  }

  /**
   * D-12 (rca-kfg2) — THE MANUAL SEND, MADE RECORDABLE.
   *
   * An approved third-party-door disclosure issues a letter INSIDE Zendesk
   * only (the requesting party never sees this ticket — VC-33), so the
   * internal note instructs the specialist to send it out of band. Every
   * route to do that from inside Zendesk was tried and found absent (D-12's
   * own evidence), and this system does not send it automatically either —
   * an unattended email to an outside party is exactly the execution a 🟢
   * use case with a human disclosure gate should not grow (migrations/0003's
   * header). What was missing was not a sender: it was any way to record
   * that the step happened, or that it could not — so a specialist who
   * correctly refused to fake a send had nowhere to say so, and the failure
   * was as invisible as a fabricated success would have been.
   *
   * Renders only once there is something to record FOR: a third-party-door
   * case with a letter already issued (the same `documents` check
   * src/review/service.js's `submitManualSendRecord()` enforces server-side,
   * so a stale or tampered client cannot show a control the server would
   * refuse). Called from render(), below `renderActions()` — this is not one
   * of the decision controls, it is what happens after one.
   */
  function renderManualSendControl(view, ticketId, currentUser) {
    var c = view.case || {};
    if (c.source !== "third_party_door") return null;
    var letters = (view.documents || []).filter(function (d) {
      return d.type === "employment_verification_letter";
    });
    if (!letters.length) return null;

    var box = el("section", "card r-manual-send");
    box.appendChild(el("h2", "h2", "Outward disclosure"));

    if (c.manualSendStatus) {
      // ALREADY RECORDED — a fact, not a form. Re-recording happens by
      // reloading this control's own state from the server on every render;
      // there is deliberately no "edit" affordance here, matching the
      // approve/decline controls' own one-shot shape.
      box.appendChild(
        el(
          "p",
          c.manualSendStatus === "sent" ? "action-status ok" : "action-status bad",
          c.manualSendStatus === "sent"
            ? "Recorded as sent" + (c.manualSendBy ? " by " + c.manualSendBy : "") + (c.manualSendAt ? " on " + c.manualSendAt : "") + "."
            : "Recorded as COULD NOT BE SENT" + (c.manualSendBy ? " by " + c.manualSendBy : "") + (c.manualSendAt ? " on " + c.manualSendAt : "") + "."
        )
      );
      if (c.manualSendNote) box.appendChild(el("p", "note-echo", c.manualSendNote));
      return box;
    }

    box.appendChild(
      el(
        "p",
        "muted r-small",
        "This system does not send it — nothing reaches " +
          (c.returnAddress || "the return address") +
          " until a person does. Record what happened once you have acted."
      )
    );

    var noteField = labelledField("textarea", "note", "Note (required if it could not be sent)", {
      rows: 2,
      placeholder: "e.g. a delivery reference, or why it could not be sent",
    });
    box.appendChild(noteField.wrap);
    var note = noteField.control;

    var buttons = el("div", "buttons");
    var sent = el("button", "btn approve", "Mark sent");
    sent.type = "button";
    var couldNot = el("button", "btn decline", "Mark could not send");
    couldNot.type = "button";
    buttons.appendChild(sent);
    buttons.appendChild(couldNot);
    box.appendChild(buttons);

    var status = el("p", "action-status");
    status.setAttribute("role", "status");
    box.appendChild(status);

    function submit(manualStatus) {
      if (manualStatus === "could_not_send" && !note.value.trim()) {
        status.className = "action-status bad";
        status.textContent = "A reason is required when recording that the letter could not be sent.";
        return;
      }
      sent.disabled = true;
      couldNot.disabled = true;
      status.className = "action-status";
      status.textContent = "Recording…";

      view
        .post("manual-send", { approver: currentUser, note: note.value, status: manualStatus })
        .then(function (result) {
          if (result.ok) {
            status.className = "action-status ok";
            status.textContent = "Recorded.";
            setTimeout(function () {
              load(ticketId, currentUser);
            }, 900);
          } else {
            status.className = "action-status bad";
            status.textContent = result.reason || "Refused.";
            sent.disabled = false;
            couldNot.disabled = false;
          }
          resize();
        })
        .catch(function (err) {
          status.className = "action-status bad";
          status.textContent = "Could not reach the review API: " + err.message;
          sent.disabled = false;
          couldNot.disabled = false;
          resize();
        });
    }

    sent.addEventListener("click", function () {
      submit("sent");
    });
    couldNot.addEventListener("click", function () {
      submit("could_not_send");
    });

    return box;
  }

  function render(view, ticketId, currentUser, alsoMatched) {
    clear(root);
    // A fresh page says every sentence for the first time. See alreadySaid().
    resetSaid();
    partitionCache = { basis: null, groups: null };
    root.removeAttribute("aria-busy");
    // Before the header, so the outcome of what the agent just did is the first
    // thing on screen rather than something they have to go looking for.
    renderFlash();
    root.appendChild(renderHeader(view));

    /* One ticket can legitimately reach two use cases — CLAUDE.md records
       exactly that (UC-03 routes on to UC-04), and it is why the idempotency
       ledger is keyed on (use_case, external_ref) rather than the ref alone.
       load() renders the first source that claims the ticket; before this it
       discarded any others in silence, so an agent could be looking at one of
       two live cases with nothing on screen saying so. Now it says so. */
    if (alsoMatched && alsoMatched.length) {
      var also = el("p", "also-matched");
      also.textContent =
        "Also matched in " + alsoMatched.join(" and ") + ". This panel is showing the first match only.";
      root.appendChild(also);
    }

    /* WHAT THIS DOCUMENT IS NOT, before anything it says. Above the decision
       sentence and above every finding, because on the two use cases that
       publish it the page is research and not an answer, and a reader who
       reaches the presence-day count first has already started reading it as
       one. Null on every panel whose API sends no framing. See renderFraming. */
    var framing = renderFraming(view);
    if (framing) root.appendChild(framing);

    /* WHO THIS IS ABOUT, before what was decided about them — and AFTER the
       framing, which is the one thing on a 🔴 page that must stay first. The
       framing says what the whole document is; this says who it concerns. The
       two dossiers keep the disclaimer at the top of the visible page, pinned
       by test, and gain the person underneath it instead of thirty-six
       hexadecimal characters four rows into a record. Null on any panel whose
       API publishes neither field. See renderEmployee. */
    var about = renderEmployee(view);
    if (about) root.appendChild(about);

    /* THE EMPLOYEE'S OWN ACCOUNT OF THE TRIP, in their words on Remote's form.
       It sits directly under "who this is about" because it is the other half
       of the same question, and because until W-1 the panel had already read
       every value in it at decision time and kept none of them — so dimension 4
       said "no document" about a request naming a travel document number. */
    var remoteRequest = renderRemoteRequest(view);
    if (remoteRequest) root.appendChild(remoteRequest);

    /* WHAT THEY WILL ACTUALLY BE DOING THERE. Remote's Mobility Team assesses
       "nature of intended activities"; until W-2 this panel offered one of
       seven dropdown categories and nothing else. It sits beside the request
       rather than under the findings because it is evidence a person reads,
       not a verdict anything reached. */
    var activities = renderActivityProfile(view);
    if (activities) root.appendChild(activities);

    /* THE TREATY CONDITION NOTHING MEASURED. The 183-day row on this page
       carries a caveat saying the day test is one of three cumulative
       conditions and that this system represents neither of the other two.
       Where the destination is a country the customer itself has a company in,
       the second fails on day one — and that is two country codes, not a
       judgement. See src/uc04/employerPresence.js. */
    var presence = renderEmployerPresence(view);
    if (presence) root.appendChild(presence);

    /* THE ORDER OF THIS PAGE IS THE DESIGN (2026-08-19).
       It answers one question, in the order a specialist asks it:

         0. WHAT THIS DOCUMENT IS NOT — the mandatory framing statement, on the
            use cases that have one. It qualifies everything below it, so it
            cannot be below any of it.
         1. WHAT AM I DECIDING, AND FOR WHOM — the header: title, subject,
            outcome badge, one risk sentence, what a signature does.
         2. WHAT AM I BEING ASKED — renderWhy: the decision sentence and the
            subject of the request (the trip, the change).
         3. WHAT NEEDS WEIGHING — renderDecisionBasis: the findings that did NOT
            clear. This is the point of the panel and it used to be below a
            17-row gate table.
         4. THE CONTROLS.
         5. EVERYTHING ELSE, COLLAPSED — the cleared checks, the gate order and
            audit strings, the case record, the rollup.

       Before this, 1–5 were interleaved: the record rows came second, the
       gate ladder and four blocks of engineering backlog came before the
       findings, and the same fact could appear in three of them. The project
       owner's reading — "multiple reports in one" — was accurate, and it was
       accurate because nobody had ever designed the whole page, only its
       parts. */
    var why = renderWhy(view);
    if (why) root.appendChild(why);

    // THE ACCOUNT OF WHY, BETWEEN THE REASON AND THE BUTTONS — deliberately in
    // that order. "Why" says what happened; this says what it happened TO, and
    // it has to be read before a decision, not after it. Null for a use case
    // whose API sends neither field, so nothing renders an empty promise.
    var basis = renderDecisionBasis(view);
    if (basis) root.appendChild(basis);

    /* WHAT THIS RUN COULD NOT SETTLE, above the record it qualifies. Null on
       the seven use cases whose API publishes no `openQuestions`; see
       renderOpenQuestions for why the two that do are the two that need it
       most. */
    var questions = renderOpenQuestions(view);
    if (questions) root.appendChild(questions);

    /* A PANEL WITH NO FINDINGS SECTION LEADS WITH ITS RECORD. UC-01's review
       publishes no `basis` and no `decisionFacts` at all, and UC-07's and
       UC-08's dossiers publish one that is entirely CONTEXT — a citation map,
       no verdicts — so on all three the rows are not reference material behind
       a disclosure: they are the entire analysis the 🔴 escalation bought. They
       render open, here, exactly as they always did. The question is asked of
       hasDecisionAccount() and not of `basis` itself, because a basis arriving
       with no verdict in it is exactly the case that used to hide them. */
    if (!hasDecisionAccount(view)) {
      var detail = el("section", "card");
      detail.appendChild(el("h2", "h2", "Case"));
      detail.appendChild(renderRows(window.CXPanelFor(view.case.useCase).rows(view)));
      root.appendChild(detail);
    }

    /* THE SILENCES, AFTER THE RECORD AND BEFORE THE CONTROLS. Collapsed,
       because it is reference-grade and long — UC-08 states three of these on
       every dossier ever compiled — and above the controls, because "this was
       never looked at" is not a footnote to a decision. See
       renderUncitedFindings. */
    var unsourced = renderUncitedFindings(view);
    if (unsourced) root.appendChild(unsourced);

    root.appendChild(renderActions(view, ticketId, currentUser));

    /* D-12 (rca-kfg2) — after the decision controls, like renderLetterOffer
       below: recording a manual send is not one of the decisions above, it is
       what a specialist does once one of them (approve) has already fired.
       Null on every panel that is not UC-01's third-party door, and on a
       UC-01 case with no letter issued yet — see the function's own header. */
    var manualSend = view.case ? renderManualSendControl(view, ticketId, currentUser) : null;
    if (manualSend) root.appendChild(manualSend);

    /* WHAT THE OTHER PARTY MAY STILL DO, after what THIS reader may do. Below
       the controls on purpose: it is not one of them and must never be read as
       one. Null on every panel whose API sends no offer, and on every UC-03
       case that carries no open one. See renderLetterOffer. */
    var offered = renderLetterOffer(view);
    if (offered) root.appendChild(offered);

    /* BOTH NOTES THAT STOOD HERE ARE CLOSED, and what replaced them is above:
       the panel no longer shows a UUID where a name exists (renderEmployee
       reads `view.employee`, which src/shared/employeeSubject.js publishes),
       and `basis.requester` is rendered rather than parsed and dropped. What is
       still true of the pair is that TWO of the nine APIs publish `employee`
       today — UC-03 and UC-04 — so seven panels still open on an id. That is a
       server change per use case, not a sidebar one; the loaders already pass
       the field through, so each panel gains the block the moment its own API
       sends it. */
    root.appendChild(renderDetails(view));
    resize();
  }

  // -- API ----------------------------------------------------------------
  // MULTIPLE SOURCES, ONE SHELL
  // Each use case's backend is its own small service with its own shape —
  // src/review/server.js (UC-01, `case`+`review`+`documents`), src/uc06/
  // server.js (UC-06, `amendment`), src/uc08/server.js (UC-08, `dossierRow`,
  // read-only). Rather than teach three shapes to every renderer above, each
  // loader here normalizes its response into the ONE shape render()/
  // renderActions() already understand: {found, case, tier, actionable,
  // actionableReason, review, documents, post}. `post` is a closure bound to
  // that source's own endpoint and id — UC-01 posts to /api/review/ticket/
  // :ticketId/:action, UC-06 to /api/amendments/:amendmentId/:action, UC-08
  // has no post at all (view.actionable is always false for it, so it's
  // never called). A ticket belongs to exactly one use case in practice, so
  // load() tries each configured source in turn and renders the first one
  // that has a case — configuring a base URL you don't need simply means
  // that source never returns `found: true`.

  /* ---------------------------------------------------------------------
     EVERY REQUEST GOES THROUGH HERE — SIGNED WHEN THE APP IS SET UP FOR IT
     ---------------------------------------------------------------------
     READS TOO, AND THAT WAS THE SECOND HALF OF THE SAME BUG. This block used
     to be reached only by writes; the nine loaders below each opened with a
     bare fetch(). The API had the matching gap — its signed-identity check ran
     under `req.method === "POST"` — so on the public deployment
     `GET /uc01/api/review/ticket/11` returned an employment id, the
     requester's real email address and the whole decision record to anyone,
     over sequential integer ticket ids. Gating the read on the API side
     without teaching this file to sign one would have produced the same
     two-halves-that-cannot-meet failure described below, one verb over: a
     correctly-configured API 401ing every panel the sidebar tried to open.
     So there is ONE signing shape here, cxRequest(), and cxGet()/cxPost() are
     thin verbs over it — the jwt block cannot drift between them because
     there is only one of it.

     WHAT WAS BROKEN. Each loader used to POST with a bare fetch() carrying
     `X-ZAF-Approver: <the agent's email>` — a header, i.e. a claim, which any
     curl can set to any name. The server grew a signed-identity mode to refuse
     exactly that, and this bundle never sent a token, so a deployed API in
     that mode 401'd every approve/decline forever. Two halves that could not meet.

     WHAT ACTUALLY SIGNS IT. ZAF mints and signs the JWT itself, on Zendesk's
     servers, when a request is made through client.request() with a `jwt`
     block — documented at:
       https://developer.zendesk.com/documentation/apps/app-developer-guide/making-api-requests-from-a-zendesk-app/
     `{{jwt.token}}` is the placeholder ZAF substitutes with the signed token,
     and `{{setting.cxSharedSecret}}` the placeholder for the SECURE app
     setting it signs with. Neither the secret nor the token exists in this
     file, in the bundle, or in devtools — a ZAF bundle is downloadable by
     anyone with an agent seat, which is why the secret must live on Zendesk's
     side and not here. ZAF signs with HS256 ONLY; src/review/zafAuth.js pins
     that (and refuses to also accept RS256 against the same key, which is the
     classic algorithm-confusion attack).

     `secure: true` is REQUIRED for a request that references a secure setting,
     and it changes where the request comes FROM: Zendesk proxies it
     server-side rather than the iframe issuing it. Consequences, both checked
     against the API side of this repo:
       · CORS does not apply — it is not a browser request, so there is no
         preflight and no Origin to match. The servers' Access-Control-* headers
         are simply ignored on this path (they still matter for the unsigned
         fallback below, and `Authorization` was added to their allow-list so
         the fallback can carry a bearer token too if someone wires one).
       · The request origin is Zendesk's proxy, not *.zdusercontent.com. Nothing
         in this repo authorizes on origin — deploy/cx-apis/router.js's
         resolveAllowedOrigin() only ECHOES an allowed origin back for CORS, and
         with no Origin header it returns the configured default, which a
         non-browser caller ignores. So a proxied request neither gains nor
         loses anything by it. CORS is not an authorization mechanism here and
         never was; the signature is.
       · The API must be reachable from Zendesk's servers. `http://localhost:4020`
         is not — which is the other half of why the fallback below exists.

     WHAT A VALID TOKEN PROVES, STATED HONESTLY. The claims below are supplied
     by this file, so a good signature proves "this came through a real
     installed instance of this app, in an account holding the shared secret".
     It does NOT prove which agent clicked — ZAF signs our claims, it does not
     attest them. That still closes the real threat (anyone with curl naming
     themselves as the approver of a payroll change on a public URL) and is
     strictly more than a header, but it is not per-agent attestation and must
     not be described as one.

     WHEN IT IS NOT CONFIGURED. `npm run review-api` on a laptop, seeded
     in-memory, has no shared secret and is not reachable from Zendesk's
     proxy — so with the setting blank this falls back to the original fetch +
     X-ZAF-Approver path, and the server's unsigned posture accepts it. The
     failure direction matters: a server in signed mode that receives the
     fallback refuses (401) rather than trusting it, so a misconfigured install
     can lose the ability to approve, never the requirement to be authenticated.

     ONE THING COULD NOT BE CONFIRMED (developer.zendesk.com is blocked from
     the build environment): whether `metadata().settings` returns a secure
     setting's value, a placeholder, or omits it entirely. The check below
     therefore treats ANY non-empty value as "configured", and the unconfirmed
     case (omitted entirely) degrades to the fallback — which a deployed server
     refuses. Fail-closed either way; worth re-checking against a live install.
     -------------------------------------------------------------------- */

  var JWT_EXPIRY_SECONDS = 60;

  /* Filled at boot from ZAF's own currentUser — not from anything typed on
     screen. Used for the JWT claims AND still sent as the header/body approver,
     so the server can compare the two if it ever wants to. */
  var agent = { email: "", name: "", id: null };

  /* WHY THIS READS A CHECKBOX AND NOT THE SECRET ITSELF.
     This used to be `settings.cxSharedSecret.trim() !== ""`, which can never
     be true. `cxSharedSecret` is a ZAF SECURE setting, and the whole point of
     a secure setting is that Zendesk stores it server-side and never sends it
     to the browser — it exists here only as the `{{setting.cxSharedSecret}}`
     placeholder that Zendesk's proxy substitutes outside the page. So the
     admin would save the secret, the app would still read "" and conclude the
     signed path was unconfigured, and every approval would go out unsigned and
     be refused 401 by a correctly-configured API. Confirmed against a live
     install: the value is stored, is not readable back, and does not appear in
     the settings payload at all.
     `signWrites` is a plain non-secure checkbox, so the app CAN read it. It is
     the admin telling the app what the app is structurally unable to observe.
     Two settings that must agree is not ideal, but the alternative is a switch
     that is wrong 100% of the time.

     The FUNCTION is named for requests, not writes, because it now governs
     both. The SETTING keeps its `signWrites` key deliberately: renaming a
     parameter on an installed ZAF app discards the value every admin already
     saved, and a silently-unticked box here means every request goes out
     unsigned. Its label and help text say "requests" instead. */
  function signedRequestsConfigured() {
    return settings.signWrites === true;
  }

  /** A refusal body (401/403/409) must read as a refusal, not as "unreachable". */
  function recoverErrorBody(err) {
    if (!err) return null;
    if (err.responseJSON && typeof err.responseJSON === "object") return err.responseJSON;
    if (typeof err.responseText === "string" && err.responseText) {
      try {
        return JSON.parse(err.responseText);
      } catch (e) {
        return null;
      }
    }
    return null;
  }

  /** Turn a refusal body into one line an agent can act on, not "HTTP 401". */
  function describeRefusal(body, status) {
    if (body && body.code && body.reason) return body.code + " (HTTP " + status + "): " + body.reason;
    if (body && body.reason) return body.reason;
    return "HTTP " + (status || "error");
  }

  /* THE FAILURE ITSELF, not just its sentence.
     load() used to keep only `err.message`, so nine APIs answering 401 with a
     precise `signed_identity_required` reason were aggregated into "9 backing
     services are unreachable" — which sends a reader to debug networking when
     every one of the nine had in fact answered, immediately and clearly, that
     this app is not authenticated. The APIs were honest; the sidebar
     mistranslated them. Keeping the status and code lets the aggregate say
     which of those two things happened. */
  function requestError(message, status, body) {
    var err = new Error(message);
    err.cxStatus = status || 0;
    err.cxCode = (body && body.code) || null;
    return err;
  }

  /* DID THIS BUNDLE SIGN THE REQUEST IT JUST SENT?
     The one fact about a 401 that the SERVER cannot supply and the SENDER can.
     A deployed API refuses an unsigned read and a wrongly-signed read with the
     same status, and a ZAF `client.request` rejection frequently carries no
     parseable body at all — so from the failure alone "the shared secret does
     not match" and "this bundle never sent a token" are indistinguishable, and
     they have completely different fixes (retype a setting vs. re-upload the
     app).

     It is the second one that is invisible without this. An installed ZAF app
     is a STATIC UPLOAD: it does not track the repo, and it cannot know it is
     old. This account's bundle was uploaded 32 minutes before read-signing
     existed in this file, so it signed writes, sent every read unsigned, and
     produced nine identical 401s that read exactly like a mistyped secret —
     which is what they were diagnosed as, twice. */
  var lastRequestWasSigned = false;

  /** Is this failure "you are not authenticated", as opposed to "I could not
   *  reach you"? Both statuses AND the code, because a ZAF `client.request`
   *  rejection does not always carry a parseable body. */
  function isAuthRefusal(status, code) {
    if (status === 401 || status === 403) return true;
    return typeof code === "string" && /identity|access_key|unauthor/i.test(code);
  }

  /**
   * The one request shape. `options`:
   *   body            present => sent as JSON (and the verb carries a payload)
   *   approver        set as the untrusted X-ZAF-Approver header, as before
   *   notFound        value to RESOLVE with on a 404 instead of throwing
   *   refusalIsAnswer resolve with a 4xx body instead of throwing — true for
   *                   writes, whose callers render the refusal as the result;
   *                   false for reads, where a swallowed 401 would render as
   *                   "no case for this ticket" and hide an auth problem
   *                   behind an empty panel.
   */
  function cxRequest(method, url, options) {
    var opts = options || {};
    var hasBody = opts.body !== undefined && opts.body !== null;

    if (signedRequestsConfigured() && client && typeof client.request === "function") {
      // Remember that this bundle signed. See lastRequestWasSigned's header —
      // it is the difference between "the secret is wrong" and "this bundle
      // cannot sign at all", and only the sender knows it.
      lastRequestWasSigned = true;
      var request = {
        url: url,
        type: method,
        secure: true,
        headers: {
          // The documented shape. src/shared/approverAuth.js reads the token
          // from here first and from X-ZAF-Token second, for reads (via
          // resolveReader) and writes (via resolveApprover) alike.
          Authorization: "Bearer {{jwt.token}}",
          // Still sent, and still untrusted in this mode: the server uses
          // ONLY the verified claim as the approver, so this can never be
          // paired with a valid signature to act under another name.
          "X-ZAF-Approver": opts.approver || "",
        },
        jwt: {
          algorithm: "HS256",
          secret_key: "{{setting.cxSharedSecret}}",
          expiry: JWT_EXPIRY_SECONDS,
          claims: {
            // `email` is what zafAuth.js's identityClaimPaths resolves first,
            // and what every approval policy in this repo records.
            email: agent.email || opts.approver || "",
            name: agent.name || "",
            zafUserId: agent.id === null || agent.id === undefined ? "" : String(agent.id),
          },
        },
      };
      if (hasBody) {
        request.contentType = "application/json";
        request.data = JSON.stringify(opts.body);
      }
      return client.request(request).then(
        function (data) {
          return typeof data === "string" ? JSON.parse(data) : data;
        },
        function (err) {
          var status = (err && err.status) || 0;
          if (status === 404 && opts.notFound !== undefined) return opts.notFound;
          var refusal = recoverErrorBody(err);
          if (refusal && opts.refusalIsAnswer) return refusal;
          throw requestError(describeRefusal(refusal, status), status, refusal);
        }
      );
    }

    /* THE UNSIGNED FALLBACK — `npm run review-api` on a laptop, seeded
       in-memory, with no shared secret and no reachability from Zendesk's
       proxy. It fails in the safe direction for reads exactly as it does for
       writes: a server whose posture requires a signed identity refuses this
       request (401) rather than serving it, so a misconfigured install loses
       the ability to SEE a case, never the requirement to be authenticated to
       see one. */
    lastRequestWasSigned = false;
    var init = { method: method, headers: { Accept: "application/json" } };
    if (hasBody) {
      init.headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(opts.body);
    }
    if (opts.approver !== undefined) init.headers["X-ZAF-Approver"] = opts.approver || "";

    return fetch(url, init).then(function (res) {
      if (res.status === 404 && opts.notFound !== undefined) return opts.notFound;
      return res.json().then(
        function (body) {
          if (res.ok || opts.refusalIsAnswer) return body;
          throw requestError(describeRefusal(body, res.status), res.status, body);
        },
        function () {
          throw requestError("HTTP " + res.status, res.status, null);
        }
      );
    });
  }

  function cxPost(url, body, approver) {
    return cxRequest("POST", url, { body: body || {}, approver: approver || "", refusalIsAnswer: true });
  }

  /* Every panel loader's read. A 404 is a real answer here ("this use case
     holds no case for this ticket"), so it resolves; anything else that is not
     2xx throws, and load()'s error path shows the reason. A 401 must never be
     flattened into {found:false} — "no case exists" and "you are not allowed to
     ask" are opposite things to an agent deciding whether to work the ticket
     by hand. */
  function cxGet(url) {
    return cxRequest("GET", url, { notFound: { found: false } });
  }

  /* THE TWO NAMED-APART FACTS, PASSED THROUGH EXACTLY AS THE API SENT THEM.
     A helper rather than five lines in each of nine loaders: the last time a
     field had to reach every loader, six of them silently dropped it
     (`gateLadder`), and a field parsed and thrown away is indistinguishable
     from one the server never computed.

     NOTHING HERE IS DERIVED OR DEFAULTED. An API that has not been taught to
     send these yields nulls, and nulls render no rail and no risk line — which
     is the safe direction, because the sentence at stake is an architectural
     promise about whether anything may be executed at all. Guessing it is the
     defect this whole shape exists to prevent.

     AND THE LEGACY `tier` IS NOT CARRIED ONTO THE VIEW AT ALL. The APIs still
     send it (deployed clients and existing tests read it), but no loader here
     copies it and nothing in this file reads `view.tier` — so the conflation
     cannot come back through a later edit that reaches for the shorter name. */
  function riskPosture(data) {
    return {
      useCaseTier: data.useCaseTier || null,
      executionModel: data.executionModel || null,
      caseRisk: data.caseRisk || null,
      caseRiskEscalated: data.caseRiskEscalated === true,
      escalatingFlagCount: typeof data.escalatingFlagCount === "number" ? data.escalatingFlagCount : null,
    };
  }

  function loadUc01(baseUrl, ticketId) {
    var base = String(baseUrl).replace(/\/$/, "");
    return cxGet(base + "/api/review/ticket/" + encodeURIComponent(ticketId))
      .then(function (view) {
        if (!view.found) return { found: false };
        // UC-01's view is the ONE shape this file does not rebuild — it is
        // already the shape render() wants — so `decidedBy` and `gateLadder`
        // arrive on it untouched the moment src/review/service.js sends them,
        // with no passthrough to write here. `gateLadder` is defaulted so a
        // deployed API older than that change renders no ladder rather than
        // throwing on an undefined length.
        view.gateLadder = view.gateLadder || [];
        // UC-01 sends the approver in the header only — cxPost() sets that
        // header, and adds the signed Authorization bearer when the app is
        // configured for it. See cxPost's header. `status` is carried through
        // ONLY when the caller supplies one (D-12, rca-kfg2 — the manual-send
        // control's own body); approve/decline never send it, so the body
        // posted for them is byte-identical to before that control existed.
        view.post = function (action, body) {
          var payload = { note: (body && body.note) || "" };
          if (body && body.status) payload.status = body.status;
          return cxPost(
            base + "/api/review/ticket/" + encodeURIComponent(ticketId) + "/" + action,
            payload,
            (body && body.approver) || ""
          );
        };
        return view;
      });
  }

  function loadUc06(baseUrl, ticketId) {
    var base = String(baseUrl).replace(/\/$/, "");
    return cxGet(base + "/api/amendments/by-ticket/" + encodeURIComponent(ticketId))
      .then(function (data) {
        if (!data.found) return { found: false };
        var amendment = data.amendment;
        var view = {
          found: true,
          // WHO THIS IS ABOUT, read fresh from Remote by the server on this
          // request (src/shared/employeeSubject.js). Null on an API that does not
          // publish it yet, and renderEmployee draws nothing for a null — so the
          // two halves deploy in either order, exactly as approvalRoles does.
          employee: data.employee || null,
          case: Object.assign({}, amendment, { useCase: "UC-06" }),
          actionable: data.actionable,
          actionableReason: data.actionableReason,
          // WHO IS BEING ASKED TO DECIDE, when the API says so. Nothing sends
          // this today; the panel's own descriptor stands in until one does
          // (see renderApprovalRoles). Passed through untouched so that the two
          // halves can be deployed in either order — a field parsed and dropped
          // is indistinguishable, from the sidebar, from one the server never
          // computed, which is how gateLadder reached zero of nine panels.
          approvalRoles: data.approvalRoles || null,
          // THE SETTLED DECISION, AS FACTS. Rendered as label/value rows by
          // renderActions when the case is closed; its string sibling joins the
          // same facts with newlines, which HTML collapses into a paragraph.
          settled: data.settled || null,
          // ALL THREE WERE BEING DROPPED HERE, and UC-06 is the use case that
          // could least afford it: its dual control is two people answering
          // DIFFERENT questions — the customer admin about the contract change,
          // the payroll specialist about whether payroll can carry it on that
          // date — and until now this panel showed both of them the same eight
          // rows. `basis` carries each role's own shortlist, computed by
          // describeAmendmentBasis() (src/uc06/decisionFacts.js).
          decidedBy: data.decidedBy || null,
          gateLadder: data.gateLadder || [],
          /* WHO FILED IT, carried to where renderEmployee looks for it. UC-06
             publishes describeRequesterParties() at the TOP level as
             `requester`; renderEmployee reads `basis.requester`, the key UC-04
             uses. Until 2026-09-02 the block was parsed here and dropped, so
             "filed by admin_jane" was the whole account of the requester on a
             panel whose JSON carried the verified-identity finding and the
             consent-is-elsewhere sentence. Same describer, same shape — the
             server's own words, moved one key over. `basis.requester` wins if
             the server ever publishes it there. */
          basis: data.basis
            ? Object.assign({}, data.basis, { requester: data.basis.requester || data.requester || null })
            : data.requester
              ? { requester: data.requester }
              : null,
          /* WHO OWNS IT WHEN IT IS NOT OPEN HERE — the routing table's answer,
             read from the server (handoffFor). The panel's approvalRoles()
             names this team on an escalation instead of listing two slots
             nobody can fill. */
          handoff: data.handoff || null,
          review: null,
          documents: [],
        };
        Object.assign(view, riskPosture(data));
        view.post = function (action, body) {
          return cxPost(
            base + "/api/amendments/" + encodeURIComponent(amendment.id) + "/" + action,
            {
              role: body && body.role,
              approver: (body && body.approver) || "",
              note: (body && body.note) || "",
            },
            (body && body.approver) || ""
          );
        };
        return view;
      });
  }

  function loadUc08(baseUrl, ticketId) {
    var base = String(baseUrl).replace(/\/$/, "");
    // Read-only — see src/uc08/server.js's header. No `post` is ever attached
    // because view.actionable is always false for UC-08, so renderActions()
    // never reaches the code path that would call it.
    return cxGet(base + "/api/dossiers/by-ticket/" + encodeURIComponent(ticketId))
      .then(function (data) {
        if (!data.found) return { found: false };
        var row = data.dossierRow;
        return Object.assign(riskPosture(data), {
          found: true,
          // WHO THIS IS ABOUT, read fresh from Remote by the server on this
          // request (src/shared/employeeSubject.js). Null on an API that does not
          // publish it yet, and renderEmployee draws nothing for a null — so the
          // two halves deploy in either order, exactly as approvalRoles does.
          employee: data.employee || null,
          case: Object.assign({}, row, { useCase: "UC-08", decision: "escalate", reason: "cross_border_tax_inquiry", flags: [] }),
          actionable: data.actionable,
          actionableReason: data.actionableReason,
          // WHO IS BEING ASKED TO DECIDE, when the API says so. Nothing sends
          // this today; the panel's own descriptor stands in until one does
          // (see renderApprovalRoles). Passed through untouched so that the two
          // halves can be deployed in either order — a field parsed and dropped
          // is indistinguishable, from the sidebar, from one the server never
          // computed, which is how gateLadder reached zero of nine panels.
          approvalRoles: data.approvalRoles || null,
          /* THE CITATION MAP THE DOSSIER IS WRITTEN FROM (commit 553c4a9).
             This view now publishes the standard `basis` shape — statutory
             quotations with their article locators, the caveats the corpus
             records against them, and explicit statements of what is NOT
             established — and this loader dropped the whole field, so it was
             computed, serialised, sent over the wire and thrown away one line
             short of the renderer that already knows how to draw it. Exactly
             the failure the `approvalRoles` note above describes, one field
             over: a field parsed and dropped is indistinguishable, from the
             sidebar, from one the server never computed. */
          basis: data.basis || null,
          /* THE SENTENCE THIS USE CASE IS FORBIDDEN TO SKIP (UC-08.md §6).
             `dossier.framing` is written by buildDossier() on every dossier
             and was passed through by no loader, so the mandatory disclaimer
             on a 🔴 use case with no execution path appeared on this screen
             nowhere at all. Read straight off the row the API returned — the
             wording is the use case's and this file composes none of it. */
          framing: (row && row.dossier && row.dossier.framing) || null,
          /* WHAT THIS DOSSIER COULD NOT SETTLE, AND WHAT IT CITES NOTHING
             FOR (2026-08-30). Both are computed by describeDossier() on every
             read and both were dropped one line short of a renderer — the same
             failure as `basis` above, twice more. `openQuestions` is rendered
             above the record by renderOpenQuestions(); `uncited` below it by
             renderUncitedFindings(). Passed through untouched: this file
             composes no part of either sentence. */
          openQuestions: data.openQuestions || [],
          uncited: data.uncited || [],
          /* WHAT THE RETRIEVED MATERIAL IS AND IS NOT — and this one is a
             defect committed by the fix that introduced its renderer, hours
             earlier the same day. panels.js's UC-08 rows read
             `view.citationCoverage.scope` and lead with it ("What this
             material is"), and that row's test builds the view by hand, so it
             was green in the suite and absent from every real sidebar: this
             loader never set the field. Exactly the class of gap the comment
             above describes, introduced while fixing it. */
          citationCoverage: data.citationCoverage || null,
          // THE SETTLED DECISION, AS FACTS. Rendered as label/value rows by
          // renderActions when the case is closed; its string sibling joins the
          // same facts with newlines, which HTML collapses into a paragraph.
          settled: data.settled || null,
          review: null,
          documents: [],
        });
      });
  }

  /**
   * UC-02 — Expense & Receipt Validation. Actionable when the API says so:
   * UC-02.md §6's Finance Ops decision (approve / decline / hold).
   */
  function loadUc02(baseUrl, ticketId) {
    var base = String(baseUrl).replace(/\/$/, "");
    return cxGet(base + "/api/expenses/by-ticket/" + encodeURIComponent(ticketId))
      .then(function (data) {
        if (!data.found) return { found: false };
        var row = data.expense;
        var view = {
          found: true,
          // WHO THIS IS ABOUT, read fresh from Remote by the server on this
          // request (src/shared/employeeSubject.js). Null on an API that does not
          // publish it yet, and renderEmployee draws nothing for a null — so the
          // two halves deploy in either order, exactly as approvalRoles does.
          employee: data.employee || null,
          case: Object.assign({}, row, { useCase: "UC-02" }),
          // Read off the response, never re-derived here. It used to be a
          // hard-coded `false` server-side; UC-02.md §6's Finance Ops decision
          // is real now, and `actionable` is the API's own verdict.
          actionable: data.actionable,
          actionableReason: data.actionableReason,
          // WHO IS BEING ASKED TO DECIDE, when the API says so. Nothing sends
          // this today; the panel's own descriptor stands in until one does
          // (see renderApprovalRoles). Passed through untouched so that the two
          // halves can be deployed in either order — a field parsed and dropped
          // is indistinguishable, from the sidebar, from one the server never
          // computed, which is how gateLadder reached zero of nine panels.
          approvalRoles: data.approvalRoles || null,
          // THE SETTLED DECISION, AS FACTS. Rendered as label/value rows by
          // renderActions when the case is closed; its string sibling joins the
          // same facts with newlines, which HTML collapses into a paragraph.
          settled: data.settled || null,
          // Which gate decided, computed server-side. Passed through untouched;
          // the panel prints it and never re-derives gate order.
          decidedBy: data.decidedBy || null,
          // THE WHOLE LADDER, not only the rung that decided. Every server that
          // sends `decidedBy` has sent `gateLadder` beside it since
          // src/shared/gateLadder.js landed, and this file dropped it — so the
          // sidebar could say "decided by gate 7" and had no way to show what
          // gates 1-6 were, or that 8-12 never ran. Passed through untouched;
          // renderGateLadder() prints the statuses the server marked and
          // derives no order of its own.
          gateLadder: data.gateLadder || [],
          // The DECISION panel's outcome badge, computed server-side by
          // describeOutcome() (src/uc02/reviewPolicy.js). Passed through
          // untouched — the shell prints `label`/`detail` and never works out
          // "was this approved?" from status + remoteResult in the browser.
          // A use case whose API supplies no `outcome` simply renders no
          // badge, which is why this needed no change in the other loaders.
          outcome: data.outcome || null,
          // THE FIGURES THE GATE COMPARED, not merely which gate it was. The
          // ladder says a claim is over its category cap; only this says 750.00
          // USD against a 500.00 USD cap, over by 250.00 (50%) — every one of
          // which the gate was holding at the instant it refused
          // (docs/CORRECTIONS-LOG.md C-27, pattern P7 "said less than it knew").
          // Computed by describeDecisionFacts() server-side; renderFactBundle()
          // prints it and works nothing out.
          decisionFacts: data.decisionFacts || null,
          review: null,
          documents: [],
        };
        // `action` is one of approve/decline/hold — supplied by the UC-02
        // panel's `actions` list, which is the only place those verbs are
        // named in the browser. This function does not know or check them:
        // a verb the server does not recognise is simply not a route there.
        Object.assign(view, riskPosture(data));
        view.post = function (action, body) {
          return cxPost(
            base + "/api/expenses/" + encodeURIComponent(row.id) + "/" + action,
            {
              approver: (body && body.approver) || "",
              note: (body && body.note) || "",
            },
            (body && body.approver) || ""
          );
        };
        return view;
      });
  }

  /**
   * UC-03 — Travel Support Letter / Workation router.
   *
   * `actionable` COMES FROM THE SERVER, like the other eight. It used to be
   * hard-coded `false` here with a sentence explaining that src/uc03/server.js
   * had no POST route at all — true when it was written, and false since the
   * letter sign-off landed there. This was the ONE loader deciding
   * actionability in the browser, which is the rule this file's own header
   * calls rule 2, and it failed in the direction that hides work rather than
   * invents it: a drafted travel letter sat waiting for a signature that this
   * panel had decided, locally, could not be given. The API has answered
   * `actionable` / `actionableReason` for UC-03 since the sign-off shipped
   * (evaluateLetterActionability() in src/uc03/signoffPolicy.js); now this
   * reads the answer.
   */
  function loadUc03(baseUrl, ticketId) {
    var base = String(baseUrl).replace(/\/$/, "");
    return cxGet(base + "/api/cases/by-ticket/" + encodeURIComponent(ticketId))
      .then(function (data) {
        if (!data.found) return { found: false };
        var row = data.caseRow;
        // Passed through even though UC-03's API sends none of it today: a
        // loader that drops a field the server later adds is how `gateLadder`
        // reached zero of nine panels. Nulls render nothing.
        var view = Object.assign(riskPosture(data), {
          found: true,
          // WHO THIS IS ABOUT, read fresh from Remote by the server on this
          // request (src/shared/employeeSubject.js). Null on an API that does not
          // publish it yet, and renderEmployee draws nothing for a null — so the
          // two halves deploy in either order, exactly as approvalRoles does.
          employee: data.employee || null,
          case: Object.assign({}, row, { useCase: "UC-03" }),
          actionable: data.actionable === true,
          actionableReason: data.actionableReason || "",
          // WHAT THE TRAVELLER MAY STILL ASK FOR, which is a different question
          // from what this reader may do (`actionable`) and is answered by a
          // different function server-side (describeLetterOffer()). Rendered
          // READ-ONLY — see renderLetterOffer for why there is no button here.
          letterOffer: data.letterOffer || null,
          // WHO IS BEING ASKED TO DECIDE, when the API says so. Nothing sends
          // this today; the panel's own descriptor stands in until one does
          // (see renderApprovalRoles). Passed through untouched so that the two
          // halves can be deployed in either order — a field parsed and dropped
          // is indistinguishable, from the sidebar, from one the server never
          // computed, which is how gateLadder reached zero of nine panels.
          approvalRoles: data.approvalRoles || null,
          // THE SETTLED DECISION, AS FACTS. Rendered as label/value rows by
          // renderActions when the case is closed; its string sibling joins the
          // same facts with newlines, which HTML collapses into a paragraph.
          settled: data.settled || null,
          // WHICH GATE DECIDED, AND WHAT THE SLUG MEANS. src/uc03/server.js has
          // sent this on every by-ticket response since the shared gate ladder
          // landed, and this loader dropped it — so the "Why" card fell back to
          // printing `route_to_uc04` on its own, the same defect §3.53 fixed for
          // UC-02 one loader over. Passed through untouched; renderWhy() prints
          // the words and keeps the slug beneath.
          decidedBy: data.decidedBy || null,
          gateLadder: data.gateLadder || [],
          // See loadUc02's note. UC-03's bundle is the one that says plainly
          // that NOTHING was dispatched to UC-04 — a fact a router's own
          // decision string cannot carry, and one a specialist would otherwise
          // assume the opposite of.
          decisionFacts: data.decisionFacts || null,
          review: data.reviewEntry || null,
          documents: data.documents || [],
        });
        // THE SIGN-OFF, AND ONLY THE SIGN-OFF. `action` is `signoff` or
        // `decline`, supplied by the UC-03 panel's own `actions` list — the
        // only place those verbs are named in the browser. There is no accept
        // verb here and there cannot be: accepting the letter offer is the
        // TRAVELLER's act and needs their authenticated session, which a
        // sidebar signed as an agent does not have.
        view.post = function (action, body) {
          return cxPost(
            base + "/api/cases/" + encodeURIComponent(row.id) + "/" + action,
            {
              approver: (body && body.approver) || "",
              note: (body && body.note) || "",
            },
            (body && body.approver) || ""
          );
        };
        return view;
      });
  }

  /**
   * UC-04 — Work Authorization / Workation. THE ONE DECISION THIS SCREEN MAKES
   * IS STAGE 3, REMOTE'S OWN MOBILITY REVIEW — and it is recorded here, never
   * sent to Remote (2026-08-31).
   *
   * WHAT THIS LOADER STILL REFUSES TO DO, unchanged from 2026-08-30. It used to
   * attach a `post` that hit `POST /api/authorizations/:id/approve|decline`,
   * which `submitWorkationApproval()` turns into
   * `PATCH /v1/work-authorization-requests/{id}` with `approved_by_manager`.
   * Remote defines that status as THE CUSTOMER'S MANAGER'S decision (see
   * src/uc04/server.js's header for the verified lifecycle), so the sidebar was
   * making the customer's decision for them and stamping a Remote CX agent's
   * name on it. That endpoint is NOT reachable from this bundle and must never
   * become reachable again: the `post` below is bound to ONE path,
   * `/mobility-review`, and the verb it sends is `clear` or `decline` — never
   * `approve`, which is the employer's word for the employer's decision.
   *
   * WHAT IT NOW DOES. Once the employer HAS approved, Remote's own mobility
   * review is this screen's stage, and the server opens it
   * (`actionable: true`, sidebarActionability()). Remote publishes no endpoint
   * for that stage, so the decision is recorded in this system's own audit log
   * under the reviewer's name and nowhere else — and the panel says exactly that
   * before the click, using the SERVER'S sentence (`mobilityReview.notice`), not
   * one composed here.
   *
   * `actionable` still comes from the server and is still the only question that
   * gates a control (renderActions). This loader answers none of it.
   */
  function loadUc04(baseUrl, ticketId) {
    var base = String(baseUrl).replace(/\/$/, "");
    return cxGet(base + "/api/authorizations/by-ticket/" + encodeURIComponent(ticketId))
      .then(function (data) {
        if (!data.found) return { found: false };
        var authorization = data.authorization;
        var view = {
          found: true,
          // WHO THIS IS ABOUT, read fresh from Remote by the server on this
          // request (src/shared/employeeSubject.js). Null on an API that does not
          // publish it yet, and renderEmployee draws nothing for a null — so the
          // two halves deploy in either order, exactly as approvalRoles does.
          employee: data.employee || null,
          /* THE VIEW IS A WHITELIST, and forgetting that is how a server field
             reaches nobody. Both of these are published by src/uc04/server.js's
             by-ticket route and both render their own card; a field parsed
             nowhere is indistinguishable, from the panel, from one the server
             never computed — which is how `gateLadder` reached zero of nine
             panels. Null-safe on both sides so the two halves deploy in either
             order.

             `remoteRequest` — the work-authorization request the employee
             raised, read live (src/uc04/linkedRequest.js). It carries the
             travel document number this panel used to say did not exist.
             `employerPresence` — where the CUSTOMER has legal entities, which
             is the art. 15(2)(b) question (src/uc04/employerPresence.js). */
          remoteRequest: data.remoteRequest || null,
          employerPresence: data.employerPresence || null,
          case: Object.assign({}, authorization, { useCase: "UC-04" }),
          actionable: data.actionable,
          actionableReason: data.actionableReason,
          // WHO IS BEING ASKED TO DECIDE, when the API says so. Nothing sends
          // this today; the panel's own descriptor stands in until one does
          // (see renderApprovalRoles). Passed through untouched so that the two
          // halves can be deployed in either order — a field parsed and dropped
          // is indistinguishable, from the sidebar, from one the server never
          // computed, which is how gateLadder reached zero of nine panels.
          approvalRoles: data.approvalRoles || null,
          // THE SETTLED DECISION, AS FACTS. Rendered as label/value rows by
          // renderActions when the case is closed; its string sibling joins the
          // same facts with newlines, which HTML collapses into a paragraph.
          settled: data.settled || null,
          // Which gate decided, and what its slug means — computed server-side
          // (src/uc04/server.js) and dropped here until now. See loadUc03.
          decidedBy: data.decidedBy || null,
          gateLadder: data.gateLadder || [],
          // WHAT THE SPECIALIST IS ACTUALLY WEIGHING. The ladder answers "where
          // did this stop"; it cannot answer "is this trip all right", which is
          // the question an approve/decline button asks. `basis` carries the four
          // independent dimensions UC-04.md §7 forbids collapsing into a score,
          // each with its own state and the figures behind it — including the
          // ones the system does NOT hold, stated as unknowns with what it would
          // take. Rendered by the shell's renderDecisionBasis().
          basis: data.basis || null,
          // THE SAME "SETTLED BEATS DECISION" RULE AS UC-01's HEADER BADGE
          // (rca-il7, N-1), extended here because it never covered this use
          // case. `c.decision` stays `ready_for_approval` forever — it is the
          // AUTOMATION's verdict, frozen at creation — so renderHeader's badge
          // read that word straight through even after a specialist approved
          // or declined, while the DECISION block a few lines down (built from
          // `settled`, i.e. `settledFacts()`) correctly said "Approved."
          // Ticket #51 showed both on one screen: "Awaiting specialist
          // approval" above "Approved." below (rca-m70i, round-7 R7-15).
          // UC-01 avoids this because its `review` row IS the settlement
          // record; UC-04's settlement lives on `authorization`/`settled`
          // instead, so it has to be translated into the same
          // `{status: "approved"|"rejected"}` shape renderHeader already
          // knows how to prefer. Derived from `settled.headline` — the same
          // fact the DECISION block itself renders — rather than from the
          // store's own `executed`/`declined` status words, so the two can
          // never read the settlement differently.
          review: data.settled ? { status: /^Approved/.test(data.settled.headline) ? "approved" : "rejected" } : null,
          // STAGE 3, WHOLE, FROM THE SERVER. State, whether it is open here,
          // who recorded it, and the notice that says where the decision does
          // and does not go. Passed through untouched — nothing in this bundle
          // composes any of it, which is what keeps "this is not sent to
          // Remote" one string in one place rather than a paraphrase per
          // surface. `|| null` so a deployment whose API has not been updated
          // renders exactly as it did before this existed.
          mobilityReview: data.mobilityReview || null,
          documents: [],
        };
        Object.assign(view, riskPosture(data));
        /* THE ONLY WRITE THIS BUNDLE PERFORMS FOR UC-04, AND IT IS BOUND TO ONE
           PATH. Not `+ "/" + action` — the shape every other loader uses and the
           shape that made the 2026-08-30 defect possible, because it lets any
           verb the panel names become a route segment, including `approve`. Here
           the URL is fixed and the verb travels in the BODY, where
           `evaluateMobilityReview()` checks it against a two-member set. A panel
           that asked for "approve" would get a 400, not the employer's
           endpoint. */
        view.post = function (action, body) {
          return cxPost(
            base + "/api/authorizations/" + encodeURIComponent(authorization.id) + "/mobility-review",
            {
              action: action,
              approver: (body && body.approver) || "",
              note: (body && body.note) || "",
            },
            (body && body.approver) || ""
          );
        };
        return view;
      });
  }

  /**
   * UC-05 — Resignation Notice Calculation. Single HR Ops sign-off — the
   * approve-equivalent action is literally named "signoff", not "approve"
   * (src/uc05/server.js's own routes), and there is no Remote write behind
   * it: the signed-off report is the durable artifact.
   */
  function loadUc05(baseUrl, ticketId) {
    var base = String(baseUrl).replace(/\/$/, "");
    return cxGet(base + "/api/resignations/by-ticket/" + encodeURIComponent(ticketId))
      .then(function (data) {
        if (!data.found) return { found: false };
        var resignation = data.resignation;
        var view = {
          found: true,
          // WHO THIS IS ABOUT, read fresh from Remote by the server on this
          // request (src/shared/employeeSubject.js). Null on an API that does not
          // publish it yet, and renderEmployee draws nothing for a null — so the
          // two halves deploy in either order, exactly as approvalRoles does.
          employee: data.employee || null,
          case: Object.assign({}, resignation, { useCase: "UC-05" }),
          actionable: data.actionable,
          actionableReason: data.actionableReason,
          // WHO IS BEING ASKED TO DECIDE, when the API says so. Nothing sends
          // this today; the panel's own descriptor stands in until one does
          // (see renderApprovalRoles). Passed through untouched so that the two
          // halves can be deployed in either order — a field parsed and dropped
          // is indistinguishable, from the sidebar, from one the server never
          // computed, which is how gateLadder reached zero of nine panels.
          approvalRoles: data.approvalRoles || null,
          // THE SETTLED DECISION, AS FACTS. Rendered as label/value rows by
          // renderActions when the case is closed; its string sibling joins the
          // same facts with newlines, which HTML collapses into a paragraph.
          settled: data.settled || null,
          // Which gate decided, and what its slug means — computed server-side
          // (src/uc05/server.js) and dropped here until now. See loadUc03.
          decidedBy: data.decidedBy || null,
          gateLadder: data.gateLadder || [],
          // THE DERIVATION, not just the verdict — which statute produced the
          // date, over what tenure, how many days short the proposal falls, and
          // what the payout comes to. Signing off IS this use case's execution,
          // so the figures being signed have to be on the screen that signs
          // them. See loadUc04.
          basis: data.basis || null,
          review: null,
          documents: [],
        };
        Object.assign(view, riskPosture(data));
        view.post = function (action, body) {
          return cxPost(
            base + "/api/resignations/" + encodeURIComponent(resignation.id) + "/" + action,
            {
              approver: (body && body.approver) || "",
              note: (body && body.note) || "",
            },
            (body && body.approver) || ""
          );
        };
        return view;
      });
  }

  /**
   * UC-07 — Global Mobility / Permanent Relocation. Read-only, same shape as
   * UC-08's loader — no `post` is ever attached because view.actionable is
   * always false for UC-07 (src/uc07/server.js).
   */
  function loadUc07(baseUrl, ticketId) {
    var base = String(baseUrl).replace(/\/$/, "");
    return cxGet(base + "/api/dossiers/by-ticket/" + encodeURIComponent(ticketId))
      .then(function (data) {
        if (!data.found) return { found: false };
        var row = data.dossierRow;
        // The shell's "Why" card renders `case.flags`. This used to be hard-
        // coded to [], so a dossier with seven raised gates rendered "No
        // escalation flags were raised" — a false negative on the most
        // load-bearing line in a 🔴 review. The codes are read straight off the
        // dossier the API returned; nothing is re-derived here.
        var dossierFlags = (row && row.dossier && row.dossier.flags) || [];
        return Object.assign(riskPosture(data), {
          found: true,
          // WHO THIS IS ABOUT, read fresh from Remote by the server on this
          // request (src/shared/employeeSubject.js). Null on an API that does not
          // publish it yet, and renderEmployee draws nothing for a null — so the
          // two halves deploy in either order, exactly as approvalRoles does.
          employee: data.employee || null,
          case: Object.assign({}, row, {
            useCase: "UC-07",
            decision: "escalate",
            reason: "global_mobility_review",
            flags: dossierFlags.map(function (f) {
              return f.severity ? f.severity + " · " + f.code : f.code;
            }),
          }),
          actionable: data.actionable,
          actionableReason: data.actionableReason,
          // WHO IS BEING ASKED TO DECIDE, when the API says so. Nothing sends
          // this today; the panel's own descriptor stands in until one does
          // (see renderApprovalRoles). Passed through untouched so that the two
          // halves can be deployed in either order — a field parsed and dropped
          // is indistinguishable, from the sidebar, from one the server never
          // computed, which is how gateLadder reached zero of nine panels.
          approvalRoles: data.approvalRoles || null,
          /* THE CITATION MAP THE DOSSIER IS WRITTEN FROM (commit 553c4a9).
             This view now publishes the standard `basis` shape — statutory
             quotations with their article locators, the caveats the corpus
             records against them, and explicit statements of what is NOT
             established — and this loader dropped the whole field, so it was
             computed, serialised, sent over the wire and thrown away one line
             short of the renderer that already knows how to draw it. Exactly
             the failure the `approvalRoles` note above describes, one field
             over: a field parsed and dropped is indistinguishable, from the
             sidebar, from one the server never computed. */
          basis: data.basis || null,
          /* THE SENTENCE THIS USE CASE IS FORBIDDEN TO SKIP (UC-07.md §15's
             mandatory disclaimer row). Same field, same builder, same gap as
             UC-08's loader — with one difference worth recording: UC-07's
             panel DID reach it, as row 34 of the case record labelled
             "Standing", under the narrative it qualifies. Present and
             unreadable is not the same failure as absent, and it is not a
             better one. The row is gone (panels.js) and the sentence now
             renders where it governs. */
          framing: (row && row.dossier && row.dossier.framing) || null,
          /* WHAT THIS DOSSIER COULD NOT SETTLE, AND WHAT IT CITES NOTHING
             FOR (2026-08-30). Both are computed by describeDossier() on every
             read and both were dropped one line short of a renderer — the same
             failure as `basis` above, twice more. `openQuestions` is rendered
             above the record by renderOpenQuestions(); `uncited` below it by
             renderUncitedFindings(). Passed through untouched: this file
             composes no part of either sentence. */
          openQuestions: data.openQuestions || [],
          uncited: data.uncited || [],
          // THE SETTLED DECISION, AS FACTS. Rendered as label/value rows by
          // renderActions when the case is closed; its string sibling joins the
          // same facts with newlines, which HTML collapses into a paragraph.
          settled: data.settled || null,
          review: null,
          documents: [],
        });
      });
  }

  /**
   * UC-09 — Off-Cycle Payroll / Adjustment. Multi-role approve/deny (UC-09 is
   * the one use case still on the old verb — its server has not been renamed) — POST
   * body is {role, approver, note}, `role` one of "requester" / "approver" /
   * "payment_releaser" (src/uc09/server.js).
   */
  function loadUc09(baseUrl, ticketId) {
    var base = String(baseUrl).replace(/\/$/, "");
    return cxGet(base + "/api/adjustments/by-ticket/" + encodeURIComponent(ticketId))
      .then(function (data) {
        if (!data.found) return { found: false };
        var adjustment = data.adjustment;
        var view = {
          found: true,
          // WHO THIS IS ABOUT, read fresh from Remote by the server on this
          // request (src/shared/employeeSubject.js). Null on an API that does not
          // publish it yet, and renderEmployee draws nothing for a null — so the
          // two halves deploy in either order, exactly as approvalRoles does.
          employee: data.employee || null,
          case: Object.assign({}, adjustment, { useCase: "UC-09" }),
          actionable: data.actionable,
          actionableReason: data.actionableReason,
          // WHO IS BEING ASKED TO DECIDE, when the API says so. Nothing sends
          // this today; the panel's own descriptor stands in until one does
          // (see renderApprovalRoles). Passed through untouched so that the two
          // halves can be deployed in either order — a field parsed and dropped
          // is indistinguishable, from the sidebar, from one the server never
          // computed, which is how gateLadder reached zero of nine panels.
          approvalRoles: data.approvalRoles || null,
          // THE SETTLED DECISION, AS FACTS. Rendered as label/value rows by
          // renderActions when the case is closed; its string sibling joins the
          // same facts with newlines, which HTML collapses into a paragraph.
          settled: data.settled || null,
          // Which gate decided, and what its slug means — computed server-side
          // (src/uc09/server.js) and dropped here until now. See loadUc03.
          decidedBy: data.decidedBy || null,
          gateLadder: data.gateLadder || [],
          // WHAT THE SIGNATURE TURNS ON. UC-09 publishes this on both GET views
          // (src/uc09/decisionFacts.js) and this loader was the only one of the
          // nine dropping it — so the money path, the one screen where a human
          // releases a real payment, was also the only approval screen with no
          // basis panel. Passed through untouched; renderDecisionBasis() prints
          // the dimensions the server marked and derives none of its own.
          basis: data.basis || null,
          review: null,
          documents: [],
        };
        Object.assign(view, riskPosture(data));
        view.post = function (action, body) {
          return cxPost(
            base + "/api/adjustments/" + encodeURIComponent(adjustment.id) + "/" + action,
            {
              role: body && body.role,
              approver: (body && body.approver) || "",
              note: (body && body.note) || "",
            },
            (body && body.approver) || ""
          );
        };
        return view;
      });
  }

  var settings = {
    apiBaseUrl: "",
    // The HS256 secret ZAF signs writes with. NEVER readable here at all —
    // it is a secure setting, so Zendesk keeps the value server-side and the
    // page only ever holds the {{setting.cxSharedSecret}} placeholder, which
    // the proxy substitutes. Kept in this object purely so the placeholder's
    // name has one home; nothing branches on it. See cxPost().
    cxSharedSecret: "",
    // The admin's explicit "the secret is set, use it" switch, because the
    // line above can never answer that question. See signedRequestsConfigured().
    signWrites: false,
    uc06ApiBaseUrl: "",
    uc08ApiBaseUrl: "",
    uc02ApiBaseUrl: "",
    uc03ApiBaseUrl: "",
    uc04ApiBaseUrl: "",
    uc05ApiBaseUrl: "",
    uc07ApiBaseUrl: "",
    uc09ApiBaseUrl: "",
  };

  function activeSources() {
    var sources = [];
    if (settings.apiBaseUrl) sources.push({ name: "the review API", fetchView: loadUc01.bind(null, settings.apiBaseUrl) });
    if (settings.uc06ApiBaseUrl) sources.push({ name: "the UC-06 amendments API", fetchView: loadUc06.bind(null, settings.uc06ApiBaseUrl) });
    if (settings.uc08ApiBaseUrl) sources.push({ name: "the UC-08 dossiers API", fetchView: loadUc08.bind(null, settings.uc08ApiBaseUrl) });
    if (settings.uc02ApiBaseUrl) sources.push({ name: "the UC-02 expenses API", fetchView: loadUc02.bind(null, settings.uc02ApiBaseUrl) });
    if (settings.uc03ApiBaseUrl) sources.push({ name: "the UC-03 travel/workation API", fetchView: loadUc03.bind(null, settings.uc03ApiBaseUrl) });
    if (settings.uc04ApiBaseUrl) sources.push({ name: "the UC-04 authorizations API", fetchView: loadUc04.bind(null, settings.uc04ApiBaseUrl) });
    if (settings.uc05ApiBaseUrl) sources.push({ name: "the UC-05 resignations API", fetchView: loadUc05.bind(null, settings.uc05ApiBaseUrl) });
    if (settings.uc07ApiBaseUrl) sources.push({ name: "the UC-07 dossiers API", fetchView: loadUc07.bind(null, settings.uc07ApiBaseUrl) });
    if (settings.uc09ApiBaseUrl) sources.push({ name: "the UC-09 adjustments API", fetchView: loadUc09.bind(null, settings.uc09ApiBaseUrl) });
    return sources;
  }

  /* Ask every configured source AT ONCE, then decide.

     The previous shape asked them one at a time and stopped at the first hit.
     Parallel is both faster (one round trip instead of up to nine) and the only
     way to answer honestly when two use cases both hold a case for the ticket —
     which CLAUDE.md records as a real situation, not a hypothetical, and which
     the sequential version could not even detect. Precedence is unchanged: the
     first source in `activeSources()` order still wins, so which panel renders
     is exactly what it was before.

     In a real install this is 1–3 requests, not nine: apiBaseUrl is the only
     required setting and the other eight default to blank. */
  /* A confirmation that survives the re-read.
     Approving used to set an inline "Approved." line and then, 900ms later,
     call load() — which rebuilds the whole panel from the server and throws
     that line away. The agent saw a flash under a second long, scrolled back
     to a panel that looked much like before, and had no idea whether a payroll
     decision they had just authorised had actually been recorded. On the most
     consequential control in this sidebar, that is the wrong feedback.
     Held here rather than passed through render()'s arguments because the
     reload is asynchronous and the caller has already returned by then. It is
     consumed exactly once — read and cleared by the next render — so it cannot
     linger onto an unrelated case. */
  var pendingFlash = null;

  function renderFlash() {
    if (!pendingFlash) return;
    var flash = el("div", "flash ok");
    // role=status announces it to a screen reader without stealing focus,
    // which matters because the buttons it replaces are now gone.
    flash.setAttribute("role", "status");
    flash.appendChild(el("strong", null, pendingFlash.title));
    if (pendingFlash.detail) flash.appendChild(el("p", null, pendingFlash.detail));
    root.appendChild(flash);
    pendingFlash = null;
  }

  function load(ticketId, currentUser) {
    var sources = activeSources();
    var errors = [];
    var matched = [];
    var firstView = null;
    /* Starts true and is falsified by the first failure that is NOT an auth
       refusal, so "they all refused me" is only claimed when it is true of
       every one of them. One unreachable API among eight refusals is still an
       unreachable API and must not be swallowed by the tidier headline. */
    var allErrorsAreAuth = true;
    /* Was ANY of the refused requests one we actually signed? If none was, this
       bundle is not signing reads — which a correct secret cannot fix. */
    var anyRefusalWasSigned = false;

    renderLoading();

    function finish() {
      if (firstView) {
        render(firstView, ticketId, currentUser, matched.slice(1));
        return;
      }
      root.removeAttribute("aria-busy");
      if (errors.length) {
        // "No case anywhere" and "a configured API is unreachable" mean
        // opposite things to an agent deciding whether to work the ticket by
        // hand, and blurring them is worse than a blank sidebar. The retry is
        // the point: an unreachable API is usually transient, and without a
        // button the only recovery is reloading the whole Zendesk ticket view.
        var authOnly = allErrorsAreAuth;
        renderState({
          kind: "bad",
          title: authOnly
            ? "This sidebar is not authenticated to the APIs"
            : errors.length === 1
              ? "One backing service is unreachable"
              : errors.length + " backing services are unreachable",
          body: authOnly
            ? // A configuration answer, not an outage. Every API replied, and
              // replied that it wants a signed identity. Reads are gated
              // because these routes return an employment id, a requester's
              // email address and a full decision record, so refusing is
              // correct and the fix is on this side.
              //
              // WHICH fix depends on something only the sender knows — see
              // lastRequestWasSigned. Naming the wrong one costs an afternoon:
              // re-typing a secret that was already right, or re-uploading a
              // bundle that was already current.
              (anyRefusalWasSigned
                ? "Every API answered and refused a request this app DID sign, so the signature itself was not accepted. " +
                  "The likeliest cause is that “cxSharedSecret” in this app's settings is not the same value as " +
                  "ZAF_SHARED_SECRET on the API. A secure setting is never sent to the browser, so this app cannot read " +
                  "back what you saved and cannot tell you whether it matches; the API can, and it will stop refusing."
                : "Every API answered and refused, and this app sent those requests UNSIGNED — so no secret you save " +
                  "will change the outcome. Either “Sign requests” is unticked in this app's settings, or this " +
                  "installed bundle predates read-signing: a ZAF app is a static upload, it does not track the repo, " +
                  "and it cannot tell that it is old. If the box is ticked, re-upload the app (`zcli apps:update`).") +
              " Reads are gated because they return an employment id, the requester's email address and the whole " +
              "decision record. The automation may still have decided this ticket — check the audit log before " +
              "working it by hand."
            : "The automation may still have decided this ticket — this sidebar just cannot read the decision right now. " +
              "Do not treat a missing panel as 'no case exists'; check the audit log before working the ticket by hand.",
          detail: errors.join(" · "),
          onRetry: function () {
            load(ticketId, currentUser);
          },
        });
      } else {
        renderState({
          kind: "muted",
          title: "No automated case for this ticket",
          body:
            "Every configured use-case API answered, and none of them has a case filed against ticket " +
            ticketId +
            ". That is a normal answer for a ticket the automation was never meant to pick up.",
        });
      }
    }

    if (!sources.length) {
      return renderState({
        kind: "bad",
        title: "No API is configured",
        body: "Set at least apiBaseUrl in this app's settings — the sidebar has nothing to read a case from.",
      });
    }

    var settled = 0;
    var results = new Array(sources.length);

    function done() {
      settled += 1;
      if (settled < sources.length) return;
      // Walk in source order, not completion order, so precedence is stable.
      for (var i = 0; i < sources.length; i += 1) {
        var r = results[i];
        if (!r) continue;
        if (r.error) {
          errors.push(sources[i].name + ": " + r.error);
          if (!isAuthRefusal(r.status, r.code)) allErrorsAreAuth = false;
          else if (r.signed) anyRefusalWasSigned = true;
        } else if (r.view && r.view.found) {
          matched.push(sources[i].name);
          if (!firstView) firstView = r.view;
        }
      }
      finish();
    }

    sources.forEach(function (source, i) {
      source
        .fetchView(ticketId)
        .then(function (view) {
          results[i] = { view: view };
          done();
        })
        .catch(function (err) {
          results[i] = { error: err.message, status: err.cxStatus || 0, code: err.cxCode || null, signed: lastRequestWasSigned };
          done();
        });
    });
  }

  // -- boot -------------------------------------------------------------------

  if (!client) {
    renderState({
      kind: "bad",
      title: "This app must run inside Zendesk",
      body:
        "The sidebar reads the current ticket and the signed-in agent from the ZAF SDK, neither of which exists " +
        "outside a Zendesk ticket view. Run it with `zcli apps:server zaf-app` and append ?zcli_apps=true to a " +
        "ticket URL.",
    });
    return;
  }

  client
    .metadata()
    .then(function (metadata) {
      var s = metadata.settings || {};
      settings.apiBaseUrl = s.apiBaseUrl || "http://localhost:4020";
      settings.uc06ApiBaseUrl = s.uc06ApiBaseUrl || "";
      settings.uc08ApiBaseUrl = s.uc08ApiBaseUrl || "";
      settings.uc02ApiBaseUrl = s.uc02ApiBaseUrl || "";
      settings.uc03ApiBaseUrl = s.uc03ApiBaseUrl || "";
      settings.uc04ApiBaseUrl = s.uc04ApiBaseUrl || "";
      settings.uc05ApiBaseUrl = s.uc05ApiBaseUrl || "";
      settings.uc07ApiBaseUrl = s.uc07ApiBaseUrl || "";
      settings.uc09ApiBaseUrl = s.uc09ApiBaseUrl || "";
      settings.cxSharedSecret = typeof s.cxSharedSecret === "string" ? s.cxSharedSecret : "";
      // Checkbox settings arrive as real booleans; anything else means unset.
      settings.signWrites = s.signWrites === true || s.signWrites === "true";
      // currentUser comes from ZAF, never from anything on screen — it is the
      // one identity signal here that the agent cannot type. name/id are read
      // only to enrich the JWT claims; the email is what the server records.
      return client.get(["ticket.id", "currentUser.email", "currentUser.name", "currentUser.id"]);
    })
    .then(function (data) {
      var ticketId = data["ticket.id"];
      var currentUser = data["currentUser.email"];
      agent.email = currentUser || "";
      agent.name = data["currentUser.name"] || "";
      agent.id = data["currentUser.id"] === undefined ? null : data["currentUser.id"];
      if (!ticketId) {
        renderState({
          kind: "muted",
          title: "No ticket in context",
          body: "Zendesk did not supply a ticket id. Open the sidebar from inside a ticket view.",
        });
        return;
      }
      load(ticketId, currentUser);
    })
    .catch(function (err) {
      renderState({
        kind: "bad",
        title: "The sidebar failed to start",
        body: "It never got as far as reading a case, so nothing on this ticket has been checked by this panel.",
        detail: err.message,
      });
    });
})();
