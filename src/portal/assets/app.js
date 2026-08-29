// ---------------------------------------------------------------------------
// app.js  —  The request portal's client (plain browser JS, no build step)
// ---------------------------------------------------------------------------
// WHAT THIS FILE IS ALLOWED TO DO
// Shape form fields into the body its adapter in src/portal/server.js documents,
// POST it, and render whatever came back. That is all.
//
// WHAT IT DELIBERATELY DOES NOT DO — and why each one matters here specifically
//   1. It contains NO decision logic. No threshold, no tier comparison, no
//      "if the trip is longer than N". The decision string, the reason, the
//      flags, the record id and every detail line are read off the response.
//      DECISION_DOT below maps a decision to a colour and NOTHING else: an
//      unrecognised decision still renders, with its word, in the neutral
//      style — the same rule src/dashboard/assets/app.js follows.
//   2. It carries NO copy of a tier, a description or a "what the human
//      controls" sentence. Those come from GET /api/context (which serves
//      src/portal/requestTypes.js verbatim) and are written into the
//      [data-field] placeholders in index.html. A copy here would be an
//      eighth place for them to drift.
//   3. It never claims a role. The persona picker sends a KEY; the server
//      resolves it to a session and refuses an unknown one (401).
//   4. It never writes markup. Every dynamic value goes through textContent,
//      because a request body on this page is text a person typed.
//
// The scenario quick-fills are the one place this file holds domain-shaped
// data, and they are exactly that: FILL VALUES, copied from each use case's own
// `cli.js` seed constants. Nothing reads them back to decide anything, and each
// request type includes at least one scenario that fails a real gate — a
// refusal demonstrates the system better than a success does.
// ---------------------------------------------------------------------------

(function () {
  "use strict";

  // -- decision colour, and nothing more ------------------------------------
  // Presentation only. Every badge also carries the decision WORD, so colour is
  // never the sole carrier of meaning (the shared design system's rule 1).
  var DECISION_DOT = {
    auto_approve: "auto",
    auto_resolve: "auto",
    human_review: "human",
    route_to_uc04: "human",
    ready_for_approval: "human",
    prepared_for_signoff: "human",
    dual_approval_required: "human",
    triple_approval_required: "human",
    off_cycle_adjustment_required: "human",
    escalate: "escalate",
    blocked: "blocked",
  };

  // -- decision WORDS, and nothing else -------------------------------------
  // round-6 D-06: this badge used to print the raw decision code
  // (`auto_resolve`, `escalate`, …) straight from the response — this
  // system's own pipeline vocabulary, on a screen written for the person who
  // filed the request. THE CLOSED SET ABOVE (DECISION_DOT) is the same eleven
  // values this project's workflows ever return, so a label exists for every
  // one of them; humanizeCode() below is only the fallback for a value this
  // table has not been told about yet, never the primary path — it does not
  // know what any code MEANS, it only stops an underscore-joined token from
  // reaching the page looking like one.
  var DECISION_LABEL = {
    auto_approve: "Approved automatically",
    auto_resolve: "Resolved automatically",
    human_review: "Sent to a specialist",
    route_to_uc04: "Routed to work authorization",
    ready_for_approval: "Ready for a specialist's approval",
    prepared_for_signoff: "Prepared for sign-off",
    dual_approval_required: "Needs two approvals",
    triple_approval_required: "Needs three approvals",
    off_cycle_adjustment_required: "Off-cycle adjustment",
    escalate: "Escalated to a specialist",
    blocked: "Blocked",
  };

  // THE GENERIC FALLBACK, and only that: no table of meanings, just the
  // mechanical transform that stops a code reading as one — underscores to
  // spaces, a capital letter to start the sentence. Never the first choice;
  // DECISION_LABEL and reasonLabel (the server-computed field the "Reason"
  // column reads) exist so this almost never fires.
  function humanizeCode(code) {
    var text = String(code || "").replace(/_/g, " ").trim();
    if (!text) return null;
    return text.charAt(0).toUpperCase() + text.slice(1);
  }

  var TIER_WORD = { low: "Low risk", medium: "Medium risk", high: "High risk" };
  var TIER_GROUPS = ["low", "medium", "high"];

  // -- fields the SERVER refuses a submission without -------------------------
  // One entry per `*_required` refusal in src/portal/server.js's adapters, each
  // named beside it. Marking a field required here renders a marker for a rule
  // that already exists on the server; it does not create one, and nothing on
  // this page is gated on it.
  //
  // Two deliberate omissions:
  //   * No `required` attribute is set on the element. One scenario quick-fill
  //     ("No question asked") exists precisely to show the SERVER refusing an
  //     empty question — a browser-side block would swallow that demonstration
  //     before it ever reached the gate it is meant to demonstrate.
  //   * UC-05 has no entry, because its adapter has no `*_required` refusal: it
  //     accepts either a pasted letter or a structured date. Marking either one
  //     required would claim a rule this system does not have.
  var REQUIRED_FIELDS = [
    "uc02-expenseId", // expense_required
    "uc03-text", // text_required
    "uc04-employmentId", // employment_required
    "uc04-destinationCountry", // destination_required
    "uc07-text", // text_required
    "uc08-text", // text_required
    "uc09-employmentId", // employment_required
    "uc09-requestText", // request_text_required
  ];

  var context = null;
  var activeType = null;

  // -- the UC-03 -> UC-04 continuation the employee has opened, if any -------
  //
  // Set only by a SUCCESSFUL POST to /api/requests/uc03/continue — i.e. only
  // after the server has authenticated the employee, confirmed the travel
  // request is theirs and was routed, and durably recorded that they asked.
  // Cleared whenever the page moves somewhere else, so a link cannot survive a
  // navigation and quietly attach itself to an unrelated request the admin
  // files ten minutes later.
  //
  // It holds a CASE ID, and the SERVER'S OWN LIST of which boxes it said were
  // still empty — and nothing that decides anything. The values themselves live
  // in the form, where the employee can correct them; this variable does not
  // remember them, so what is submitted is always what is on screen.
  //
  // `gaps` is the load-bearing addition and it is worth being precise about what
  // it is NOT. It is not a copy of UC-04's completeness rule. This page holds no
  // opinion about what a workation assessment requires and gains none here: the
  // list arrives from /api/requests/uc03/continue, which builds it from
  // src/uc03/uc04Intake.js, which is itself pinned to src/uc04/policyEngine.js
  // by a drift test. If UC-04 ever requires an eighth input, the server names it,
  // this page marks and checks it, and not one line below changes. A local list
  // would be the second copy — and the second copy is the thing that drifts.
  var pendingContinuation = null;

  // -- tiny DOM helpers (same idiom as dashboard/playground/remoteui) --------

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  function byId(id) {
    return document.getElementById(id);
  }

  function clear(node) {
    while (node && node.firstChild) node.removeChild(node.firstChild);
  }

  function value(id) {
    var node = byId(id);
    return node ? String(node.value).trim() : "";
  }

  function checked(id) {
    var node = byId(id);
    return Boolean(node && node.checked);
  }

  /** "" for an untouched optional field, so the server's own default applies. */
  function orNull(id) {
    return value(id) || null;
  }

  /** Nothing to show. Rendered as the em dash Remote prints in an empty cell. */
  function isEmpty(v) {
    return v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0);
  }

  function noneCell() {
    return el("span", "r-none", "—");
  }

  // -- the reference control -------------------------------------------------
  //
  // WHY THIS EXISTS AT ALL. Every workflow claims its `externalRef` in the
  // shared `workflow_claims` table before its first durable write, and the
  // table's PRIMARY KEY `(use_case, external_ref)` is what makes delivery
  // exactly-once. Two behaviours follow from that, both already real and
  // neither previously discoverable from this page:
  //
  //   * A NEW reference is processed normally.
  //   * A REPEATED one is refused at the key — nothing is re-decided, nothing
  //     is written twice. That is the guarantee working, and it is the single
  //     most useful thing a tester can see with their own eyes.
  //
  // Before this control, the reference box was optional free text: leaving it
  // blank submitted no ref at all (which `claimExternalRef()` documents as
  // proceeding unclaimed, since a request with no reference cannot be a
  // duplicate DELIVERY of anything), and typing the same value twice produced a
  // refusal with no hint that the repetition was the cause. Both paths existed;
  // neither was visible. So the choice is now explicit, and a generated
  // reference is shown in the result panel for a tester to copy and reuse.
  //
  // NO CLAIM LOGIC LIVES HERE. This file decides which reference to SEND. Every
  // workflow still does the claiming, in the one place it belongs.

  /** The last reference each form actually submitted, so "reuse" means repeat. */
  var lastRef = {};

  /** Unique per submission — a counter as well as the clock, because two
   *  clicks inside one millisecond must not collide and silently look like the
   *  duplicate-delivery refusal this control exists to demonstrate. */
  var refCounter = 0;
  function generateRef(typeId) {
    refCounter += 1;
    return (
      typeId +
      "-" +
      new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14) +
      "-" +
      refCounter +
      Math.random().toString(36).slice(2, 6)
    );
  }

  function refMode(typeId) {
    var reuse = byId("refmode-" + typeId + "-reuse");
    return reuse && reuse.checked ? "reuse" : "new";
  }

  function setRefMode(typeId, mode) {
    var target = byId("refmode-" + typeId + "-" + mode);
    if (target) target.checked = true;
    syncRefField(typeId);
  }

  /** Show the text box only when it can actually be used. */
  function syncRefField(typeId) {
    var wrap = byId("refwrap-" + typeId);
    var input = byId(typeId + "-externalRef");
    if (!wrap || !input) return;
    var reuse = refMode(typeId) === "reuse";
    wrap.hidden = !reuse;
    input.disabled = !reuse;
    if (reuse && !input.value && lastRef[typeId]) input.value = lastRef[typeId];
  }

  /**
   * Report the reference a submission actually used, on the form itself.
   * Called only after the request has gone, so it can never show a value that
   * was generated and then not sent.
   */
  function showSentRef(typeId, ref) {
    var line = byId("refsent-" + typeId);
    if (!line || !ref) return;
    clear(line);
    line.appendChild(el("span", null, "Last reference sent: "));
    line.appendChild(el("code", "tag-chip", ref));
    line.appendChild(
      el("span", null, " — it is already in the box below, so choosing “Reuse” and submitting again sends this same id.")
    );
    line.hidden = false;
  }

  /**
   * The reference to send. In reuse mode with an empty box there is nothing to
   * repeat, so it generates one rather than sending null — sending null would
   * silently proceed unclaimed, which is the opposite of what the tester asked
   * for and would look like the duplicate check simply not firing.
   */
  function reference(typeId) {
    if (refMode(typeId) === "reuse") {
      var typed = value(typeId + "-externalRef");
      if (typed) return typed;
    }
    return generateRef(typeId);
  }

  /**
   * Turn each form's plain "Reference (optional)" box into the two-way control.
   * Done here rather than in index.html so the seven forms cannot drift — the
   * markup and the wiring are written once and applied to whichever reference
   * fields exist.
   */
  function upgradeReferenceFields(types) {
    types.forEach(function (type) {
      var input = byId(type.id + "-externalRef");
      if (!input) return;
      var label = input.closest ? input.closest("label") : input.parentNode;
      if (!label || !label.parentNode) return;

      var group = el("div", "ref-control");
      group.appendChild(el("span", "r-label", "Request reference"));
      // ONE SENTENCE, AND IT DESCRIBES THE CONTROL BENEATH IT.
      // This hint used to run to five dense lines: what a delivery is as
      // distinct from a subject, that every workflow claims the reference
      // before its first durable write, and — on all seven forms, including a
      // work-authorization one — a clause about what UC-02 separately asks
      // about an expense. That last one was jargon AND about a different
      // request type than the one being filled in.
      //
      // None of it is lost. The claim mechanism and the delivery/subject
      // distinction are explained at length in this control's own header
      // comment above, which is where somebody debugging a duplicate looks.
      // The expense-specific half is said on the ONE form it is true of, next
      // to the control that acts on it — UC-02's "File this as a new expense"
      // checkbox in index.html.
      //
      // HOW TO SEE THE REFUSAL now lives in this sentence, and it used to be
      // printed under every decision on every request type, forever: "Switch
      // this form to 'Reuse a reference' and submit again to see it refused as
      // an already-processed delivery." That is a demo instruction, and a demo
      // instruction belongs beside the control it operates — which is these two
      // radio buttons, three lines below — not stapled to the outcome of a
      // decision somebody is trying to read.
      group.appendChild(
        el(
          "span",
          "r-hint ref-hint",
          "An id for this one submission. Send the same id twice — choose \u201cReuse a reference\u201d below and submit again — and the repeat is turned away, so nothing is done twice."
        )
      );

      var choices = el("div", "ref-choices");
      [
        { mode: "new", text: "Generate a new reference" },
        { mode: "reuse", text: "Reuse a reference (send the same one again)" },
      ].forEach(function (choice) {
        var wrap = el("label", "ref-choice");
        var radio = document.createElement("input");
        radio.type = "radio";
        radio.name = "refmode-" + type.id;
        radio.id = "refmode-" + type.id + "-" + choice.mode;
        radio.value = choice.mode;
        if (choice.mode === "new") radio.checked = true;
        radio.addEventListener("change", function () {
          syncRefField(type.id);
        });
        wrap.appendChild(radio);
        wrap.appendChild(el("span", null, choice.text));
        choices.appendChild(wrap);
      });
      group.appendChild(choices);

      // WHERE THE GENERATED REFERENCE BECOMES VISIBLE.
      // In "new" mode the text box is hidden and disabled — it is not an input
      // then — so writing the generated value into it after a submission put
      // the reference somewhere nobody could read. A tester asked to see the id
      // that had just been generated and there was, from the form's side of the
      // page, nowhere it appeared. This line is that place: empty until a
      // submission has actually happened, then the exact string that was sent.
      var sent = el("p", "small r-secondary ref-sent");
      sent.id = "refsent-" + type.id;
      sent.hidden = true;
      group.appendChild(sent);

      label.parentNode.insertBefore(group, label);
      label.id = "refwrap-" + type.id;
      label.hidden = true;
      input.disabled = true;
      syncRefField(type.id);
    });
  }

  /**
   * The expense id to file against: the fixture itself, or a fresh copy of it.
   *
   * WHY. UC-02 replays the stored decision for an expense it has already
   * judged, so against a fixed fixture list every scenario on this page is a
   * one-shot — and a tester who generated a new request reference and expected
   * a new decision got the replay instead. The reference identifies the
   * DELIVERY; the expense is the SUBJECT, and only a new subject gets a new
   * run through the gates.
   *
   * The `~fresh-<token>` form is understood by src/remote/mockServer.js, which
   * mints a copy of the base expense on read. Nothing in src/uc02/ knows the form
   * exists — to the workflow it is simply another expense id, which is what
   * makes the resulting run a real one rather than a special case.
   */
  function freshCopyOf(expenseId) {
    if (!expenseId || !checked("uc02-freshCopy")) return expenseId;
    refCounter += 1;
    return (
      expenseId +
      "~fresh-" +
      new Date().toISOString().replace(/[-:.TZ]/g, "").slice(8, 14) +
      refCounter +
      Math.random().toString(36).slice(2, 5)
    );
  }

  // -- the seven body builders ----------------------------------------------
  // One per adapter in src/portal/server.js. Each key below is a `body.*` read
  // in that adapter — if a field name here and a field name there ever disagree,
  // the adapter wins and this is the file to correct.

  var BUILDERS = {
    // L-14. The identity IS the persona picker at the top of the page,
    // exactly the way a real Requests-tab click would already know who is
    // asking — src/uc01/selfServiceLetter.js still re-verifies the session
    // server-side, so nothing here carries an identity claim for it to trust.
    //
    // `note` (rca-etp9) is the one field this card offers: free text the
    // employee typed, carried as-is. It is never compared, classified, or
    // read by anything that decides whether the letter issues — the server
    // only stores it for whoever reads the request afterwards.
    // `language` is Remote's own and only standard-letter field (article
    // 4422684040461). Carried the same way `note` is — recorded against the
    // request, never consulted by a gate. See the field's own comment in
    // index.html for why a non-English choice is shown back rather than
    // silently answered in English.
    uc01: function (persona) {
      return {
        persona: persona,
        note: orNull("uc01-note"),
        language: orNull("uc01-language"),
      };
    },

    uc02: function (persona) {
      return {
        persona: persona,
        expenseId: freshCopyOf(value("uc02-expenseId")),
        receiptHash: orNull("uc02-receiptHash"),
        externalRef: reference("uc02"),
      };
    },

    uc03: function (persona) {
      return {
        persona: persona,
        text: value("uc03-text"),
        // WHAT THE TRAVELLER STATED, as opposed to what a model read out of
        // the sentence above. Four optional members, every one of them null
        // when its box was not touched — `orNull()` and never `""`, because an
        // empty string is a stated value of nothing and null is "they did not
        // say", and those are the two answers this repository has most often
        // conflated. A body whose four members are all null is the body this
        // form sent before these boxes existed, which is what keeps every
        // request that succeeds today succeeding.
        //
        // NOTHING IS DECIDED HERE. The four values are carried, not compared:
        // no date arithmetic, no country check, no opinion about whether a
        // stated destination agrees with the prose. Those belong to the gates.
        stated: {
          destinationCountry: orNull("uc03-destinationCountry"),
          startDate: orNull("uc03-startDate"),
          endDate: orNull("uc03-endDate"),
          addressee: orNull("uc03-addressee"),
        },
        externalRef: reference("uc03"),
      };
    },

    uc04: function (persona) {
      return {
        persona: persona,
        // THE UC-03 CASE THIS CONTINUES, when the admin arrived here from an
        // employee's continuation. Null otherwise, and the server treats it as
        // a NAME rather than a fact: it re-reads that case and refuses if it is
        // not a UC-03 routing about this same employee. So this field can only
        // ever ask for a link, never assert one.
        continuationOf: pendingContinuation ? pendingContinuation.caseId : null,
        employmentId: value("uc04-employmentId"),
        homeCountry: orNull("uc04-homeCountry"),
        nationality: orNull("uc04-nationality"),
        destinationCountry: value("uc04-destinationCountry"),
        startDate: orNull("uc04-startDate"),
        endDate: orNull("uc04-endDate"),
        visaType: orNull("uc04-visaType"),
        jobDuties: orNull("uc04-jobDuties"),
        hasContractSigningAuthority: checked("uc04-hasContractSigningAuthority"),
        // PRIOR STAYS, stated by the traveller. Two rows always, blank or not:
        // src/portal/server.js's `buildTravelHistory()` drops a row nobody
        // touched, so an untouched pair sends exactly what the hard-coded `[]`
        // used to, and a half-filled row is refused BY NAME rather than
        // silently completed. Nothing here counts anything — the day windows
        // and their arithmetic are the server's.
        travelHistory: [
          { country: value("uc04-h1-country"), startDate: value("uc04-h1-startDate"), endDate: value("uc04-h1-endDate") },
          { country: value("uc04-h2-country"), startDate: value("uc04-h2-startDate"), endDate: value("uc04-h2-endDate") },
        ],
        reasonText: value("uc04-reasonText"),
        externalRef: reference("uc04"),
        now: orNull("uc04-now"),
      };
    },

    uc05: function (persona) {
      return {
        persona: persona,
        letterText: value("uc05-letterText"),
        proposedEndDate: orNull("uc05-proposedEndDate"),
        reason: orNull("uc05-reason"),
        ptoType: orNull("uc05-ptoType"),
        ptoDaysAccrued: value("uc05-ptoDaysAccrued"),
        ptoDaysUsed: value("uc05-ptoDaysUsed"),
        ptoHourlyRate: value("uc05-ptoHourlyRate"),
        currency: orNull("uc05-currency"),
        externalRef: reference("uc05"),
        now: orNull("uc05-now"),
      };
    },

    // UC-07 and UC-08 take no persona: their adapters resolve none, because a
    // dossier is compiled for a specialist and executes nothing on anyone's
    // behalf. Note what the booleans do here — `checked()` always sends a real
    // true/false, so an unticked box means "not confirmed", never "unknown".
    uc07: function (persona) {
      return {
        // Sent so the server can tie the dossier to the employment the session
        // IS when the form leaves the subject blank. It is a persona KEY, not
        // an identity claim — the server resolves it through its own map.
        persona: persona,
        text: value("uc07-text"),
        employmentId: orNull("uc07-employmentId"),
        externalRef: reference("uc07"),
        salary: value("uc07-salary"),
        minimumVisaSalary: value("uc07-minimumVisaSalary"),
        currency: orNull("uc07-currency"),
        months: value("uc07-months"),
        creationDate: orNull("uc07-creationDate"),
        proposedStartDate: orNull("uc07-proposedStartDate"),
        destinationStartDate: orNull("uc07-destinationStartDate"),
        sourceTerminationDate: orNull("uc07-sourceTerminationDate"),
        sourceLastWorkingDay: orNull("uc07-sourceLastWorkingDay"),
        originalHireDate: orNull("uc07-originalHireDate"),
        destinationSupported: checked("uc07-destinationSupported"),
        immigrationSupportRequired: checked("uc07-immigrationSupportRequired"),
        immigrationConfirmed: checked("uc07-immigrationConfirmed"),
        rightToWorkConfirmed: checked("uc07-rightToWorkConfirmed"),
        destinationStartDateConfirmed: checked("uc07-destinationStartDateConfirmed"),
        sourceExitPlanValidated: checked("uc07-sourceExitPlanValidated"),
        employerPresenceInDestination: checked("uc07-employerPresenceInDestination"),
        taxTreatyNexusConfirmed: checked("uc07-taxTreatyNexusConfirmed"),
        ptoTransferAllowed: checked("uc07-ptoTransferAllowed"),
        sourcePtoDays: value("uc07-sourcePtoDays"),
        seniorityPreservable: value("uc07-seniorityPreservable"),
      };
    },

    uc08: function (persona) {
      return {
        persona: persona, // same reasoning as uc07 above
        text: value("uc08-text"),
        employmentId: orNull("uc08-employmentId"),
        externalRef: reference("uc08"),
        targetCountry: orNull("uc08-targetCountry"),
        windowStart: orNull("uc08-windowStart"),
        windowEnd: orNull("uc08-windowEnd"),
        // Rows are sent as typed; the server drops any that are incomplete
        // rather than this page guessing a missing date.
        presencePeriods: [
          { country: value("uc08-p1-country"), startDate: value("uc08-p1-startDate"), endDate: value("uc08-p1-endDate") },
          { country: value("uc08-p2-country"), startDate: value("uc08-p2-startDate"), endDate: value("uc08-p2-endDate") },
        ],
      };
    },

    uc09: function (persona) {
      return {
        persona: persona,
        employmentId: value("uc09-employmentId"),
        requestText: value("uc09-requestText"),
        reasonText: value("uc09-reasonText"),
        externalRef: reference("uc09"),
        now: orNull("uc09-now"),
      };
    },
  };

  // -- scenario quick-fills --------------------------------------------------
  // `persona` sets the sidebar picker; `fields` is a map of element id -> value
  // (a boolean sets a checkbox, everything else sets .value). `fails: true`
  // only labels the button — no behaviour hangs off it.
  //
  // `turnsOn` SAYS WHICH KIND OF DEMONSTRATION THIS IS, and it is the one field
  // here that exists for the reader rather than for the form.
  //
  // The project owner: "I would love a prefilled scenario where another person
  // won't get the same [outcome]. You can make it easier: for positive outcomes
  // I can act as one particular employee, for negative ones I can act as
  // another — just need to switch from the sidebar... There can be nuanced ones
  // that don't depend on the employee's details; we can work with that."
  //
  // So there are two kinds of scenario on this page and they answer different
  // questions:
  //
  //   turnsOn: "who"  — the SAME request, the SAME words, a different person,
  //                     and a different answer, because something on that
  //                     person's own record decides it. Alexandre Tremblay's
  //                     record names no employing entity, so there is no
  //                     letterhead to write his travel letter on; Amanda
  //                     Walker's employer has not granted workation permission;
  //                     Lars van der Berg is not at the admin's company at all.
  //                     Every one of those facts is in src/portal/personas.js's
  //                     note for that persona, written for the reader.
  //   turnsOn: "what" — the answer is the same whoever asks. A letter for a
  //                     consulate needs a person's signature for everybody; a
  //                     sanctioned destination is blocked for everybody.
  //
  // The distinction is the difference between "you are not eligible" and "what
  // you asked for needs a person", and a reader who cannot tell them apart will
  // read the first as the second. showScenarioNote() prints it in a sentence
  // when a quick-fill is clicked; nothing else reads this field and no gate
  // knows it exists.

  var SCENARIOS = {
    // -----------------------------------------------------------------------
    // UC-01 — the four chips are REMOTE'S OWN ELIGIBILITY ARTICLE, one each
    // -----------------------------------------------------------------------
    // support.remote.com article 17537524163853 ("Why is the employment
    // verification letter request not available on my Remote profile?"),
    // fetched live 2026-08-28, lists exactly three reasons the option does not
    // appear: you are not employed through a Remote entity (it names Direct
    // Employees and Contractors), your onboarding is not finalised, or you are
    // offboarding. `src/uc01/engagementEligibility.js` was written from
    // DRIFT-074 and arrives at the same four classes independently, which is
    // the strongest confirmation in this file: two documents, one written by
    // Remote and one by us, refusing the same people for the same reasons.
    //
    // So each chip below is one row of that article, driven by a persona whose
    // record genuinely carries the disqualifying fact — Carlos Silva's
    // `contract_type` is "contractor" as a MIRRORED SANDBOX VALUE, not a label
    // this repo chose (src/remote/mockServer.js's roster comment), and Thomas
    // Weber is genuinely `archived`.
    //
    // THE OUTCOMES WERE MEASURED, NOT PREDICTED. Every persona here was run
    // through issueSelfServiceLetter() against the mock fixtures before the
    // chip was written, so `fails: true` marks a refusal that was observed:
    //   chris   -> issued          carlos/alexandre -> engagement_not_eor_contractor
    //   amanda  -> engagement_not_eor_direct        thomas -> employee_not_active
    //
    // THE ONE ROW WITH NO CHIP is the article's "onboarding not finalised".
    // `ONBOARDING_STATUSES` exists in the gate and no persona on this page
    // carries an onboarding status, so it is genuinely unreachable from here
    // rather than omitted for space. Named so a reader counting three chips
    // against Remote's three reasons does not conclude the fourth is missing
    // from the code — it is missing from the cast.
    //
    // ALL FOUR TURN ON "who". The words typed are identical in every one; the
    // only thing that moves is whose record is being asked about, which is the
    // entire argument for a letter being a property of the employment rather
    // than of the request.
    uc01: [
      {
        id: "uc01-standard",
        turnsOn: "who",
        label: "Standard letter",
        persona: "chris",
        fields: {
          "uc01-language": "en",
          "uc01-note": "This is for a mortgage application with my bank.",
        },
      },
      {
        // Not a refusal and not an issue-in-Dutch either — the third thing,
        // which is the one people assume does not exist.
        id: "uc01-language-dutch",
        turnsOn: "what",
        label: "…the same letter, in Dutch",
        persona: "chris",
        note:
          "Same person, same request, a language this demo has no template for — so the choice is carried and shown back rather than quietly answered in English.",
        fields: {
          "uc01-language": "nl",
          "uc01-note": "My bank in Amsterdam needs this in Dutch.",
        },
      },
      {
        id: "uc01-contractor",
        turnsOn: "who",
        label: "Asked by a contractor",
        fails: true,
        persona: "carlos",
        note:
          "Remote is not this person's employer, so there is nothing here it can attest to — the same reason Remote's own help centre gives.",
        fields: {
          "uc01-language": "en",
          "uc01-note": "This is for a mortgage application with my bank.",
        },
      },
      {
        id: "uc01-direct",
        turnsOn: "who",
        label: "Asked by a direct employee",
        fails: true,
        persona: "amanda",
        note: "Employed by the company itself rather than through Remote, so the letter has to come from them.",
        fields: {
          "uc01-language": "en",
          "uc01-note": "This is for a mortgage application with my bank.",
        },
      },
      {
        id: "uc01-archived",
        turnsOn: "who",
        label: "Asked by an archived employee",
        fails: true,
        persona: "thomas",
        fields: {
          "uc01-language": "en",
          "uc01-note": "This is for a mortgage application with my bank.",
        },
      },
    ],

    uc02: [
      // Chris owns both of these expenses. Both directions from one person,
      // because a persona that can only ever be shown refusing proves nothing
      // about whether it can succeed.
      {
        id: "uc02-sandbox-clean",
        turnsOn: "what",
        label: "Clean meals expense",
        persona: "chris",
        fields: { "uc02-expenseId": "exp_sandbox_clean_401", "uc02-receiptHash": "", "uc02-externalRef": "ticket-2006" },
      },
      {
        id: "uc02-sandbox-cap",
        turnsOn: "what",
        label: "Over the category cap",
        fails: true,
        persona: "chris",
        fields: { "uc02-expenseId": "exp_sandbox_over_cap_402", "uc02-receiptHash": "", "uc02-externalRef": "ticket-2007" },
      },
      // The ownership gate, with both people visible on the picker. Both expenses
      // belong to James and both are otherwise clean, so the ONLY thing that can
      // refuse either is the ownership check. They are two different expenses
      // rather than one, because UC-02's duplicate gate would otherwise answer
      // whichever button is clicked second — see mockServer.js's note on the pair.
      {
        id: "uc02-owner",
        turnsOn: "who",
        label: "Someone else's expense",
        fails: true,
        persona: "chris",
        fields: { "uc02-expenseId": "exp_sandbox_other_owner_403", "uc02-receiptHash": "", "uc02-externalRef": "ticket-2004" },
      },
      {
        id: "uc02-owner-ok",
        turnsOn: "who",
        label: "…James's own expense, filed by James",
        persona: "james",
        fields: { "uc02-expenseId": "exp_sandbox_own_404", "uc02-receiptHash": "", "uc02-externalRef": "ticket-2008" },
      },
      {
        id: "uc02-persona",
        turnsOn: "who",
        label: "Filed by an admin",
        fails: true,
        persona: "admin",
        fields: { "uc02-expenseId": "exp_sandbox_clean_401", "uc02-receiptHash": "", "uc02-externalRef": "ticket-2005" },
      },
    ],

    // EVERY UC-03 QUICK-FILL NAMES THE FOUR TRIP BOXES, blank or not — the
    // equality rule test/portalCopy.test.js pins for all seven types, and here
    // it is load-bearing rather than tidy: a scenario that omitted them would
    // inherit the previously clicked scenario's destination and dates, so
    // "Workation from Portugal" would submit Spain and a fortnight in
    // September that its own text never mentions.
    //
    // THE VALUES ARE READ OUT OF EACH SCENARIO'S OWN TEXT
    // (docs/TRAVEL-LETTER-INPUTS.md §6.5), so a quick-fill leaves the form
    // self-consistent instead of half-filled — and none of them is chosen to
    // change an outcome. "Asked by an archived employee" in particular must
    // still be refused for being archived: if filling these boxes moves it,
    // they have become a gate instead of an override.
    uc03: [
      {
        id: "uc03-trip",
        turnsOn: "what",
        label: "Short business trip",
        persona: "chris",
        fields: {
          "uc03-text": "I'm travelling to Spain for a client meeting from September 14 to October 2, 2026. Can you confirm business travel is fine?",
          "uc03-destinationCountry": "ES",
          "uc03-startDate": "2026-09-14",
          "uc03-endDate": "2026-10-02",
          "uc03-addressee": "",
          "uc03-externalRef": "9001",
        },
      },
      {
        // THE DELIBERATE BLANK, and §6.5 argues it rather than allowing it:
        // this scenario's text names a country and no dates at all, and
        // inventing a fortnight for it would hide the routing the scenario
        // exists to demonstrate — a workation is routed on WHAT is being asked,
        // not on how long it lasts.
        id: "uc03-workation",
        turnsOn: "what",
        label: "Workation from Portugal",
        persona: "chris",
        note:
          "This request names no dates, so the date boxes are left empty on purpose — what is being asked is enough to answer it.",
        fields: {
          "uc03-text": "I'd like to work remotely from Portugal for a month while on holiday — can I do my normal job from there?",
          "uc03-destinationCountry": "PT",
          "uc03-startDate": "",
          "uc03-endDate": "",
          "uc03-addressee": "",
          "uc03-externalRef": "9002",
        },
      },
      {
        id: "uc03-letter",
        turnsOn: "who",
        label: "Visa support letter",
        persona: "chris",
        fields: {
          "uc03-text": "I need a travel letter for my visa application for a conference in Germany from September 20 to September 26, 2026.",
          "uc03-destinationCountry": "DE",
          "uc03-startDate": "2026-09-20",
          "uc03-endDate": "2026-09-26",
          "uc03-addressee": "",
          "uc03-externalRef": "9003",
        },
      },
      {
        // THE SAME REQUEST, WORD FOR WORD, FROM SOMEBODY ELSE. `uc03-letter`
        // above is issued on the spot; this one stops for a specialist — and
        // the only difference between the two submissions is which person is
        // signed in. Alexandre Tremblay is a contractor whose record names no
        // employing entity, so there is no letterhead the letter could be
        // written on. Verified against the mock rather than assumed:
        // `auto_resolve / standard_letter_issued` as Chris Lee,
        // `human_review / formal_letter_requested` as Alexandre.
        id: "uc03-letter-no-entity",
        turnsOn: "who",
        label: "…the same letter, asked by Alexandre",
        fails: true,
        persona: "alexandre",
        note:
          "The very same words as \u201cVisa support letter\u201d. Alexandre\u2019s record names no employing entity, so there is no letterhead to write his letter on and a specialist has to.",
        // THE SAME WORDS MEANS THE SAME BOXES. This scenario's text is
        // `uc03-letter`'s word for word, so its trip values are that
        // scenario's — leaving them blank here would make the one thing this
        // pair is FOR (only the person changed) untrue of the form.
        fields: {
          "uc03-text": "I need a travel letter for my visa application for a conference in Germany from September 20 to September 26, 2026.",
          "uc03-destinationCountry": "DE",
          "uc03-startDate": "2026-09-20",
          "uc03-endDate": "2026-09-26",
          "uc03-addressee": "",
          "uc03-externalRef": "9005",
        },
      },
      {
        id: "uc03-terminated",
        turnsOn: "who",
        label: "Asked by an archived employee",
        fails: true,
        persona: "thomas",
        fields: {
          "uc03-text": "I'm travelling to Spain for a client meeting from September 14 to October 2, 2026.",
          "uc03-destinationCountry": "ES",
          "uc03-startDate": "2026-09-14",
          "uc03-endDate": "2026-10-02",
          "uc03-addressee": "",
          "uc03-externalRef": "9004",
        },
      },
    ],

    // Every SUBJECT below is a real Remote Sandbox employment id (the same
    // seven people the persona picker offers — src/portal/personas.js). The
    // subject is not a session: the admin persona types an employment id into
    // the form, so it needs no persona of its own, but it must still be an id
    // a tester can cross-check against their own Sandbox.
    //
    // WHY THE SUBJECT WAS CHOSEN, PER SCENARIO, IS NOT COSMETIC HERE. UC-04's
    // policyEngine.js reads exactly three things off the employment record —
    // company_id (identity), status, and custom_fields.workation_permission —
    // while homeCountry/nationality/destination are FORM fields the risk matrix
    // judges. So the subject changes whether the request is admissible at all,
    // never which square of the matrix it lands in. Anna Müller is used for the
    // three matrix scenarios so the record's own country (DE) agrees with the
    // home country the form states; the previous subject was Nigerian while the
    // form said DE, which read as a contradiction on screen and was one.
    uc04: [
      {
        id: "uc04-low",
        turnsOn: "who",
        label: "Low-risk Schengen trip",
        persona: "admin",
        fields: {
          // Anna Müller — DE, employee, active (real Sandbox id).
          "uc04-employmentId": "09b65526-643b-4956-959b-916e6429bd23",
          "uc04-homeCountry": "DE",
          "uc04-nationality": "DE",
          "uc04-destinationCountry": "ES",
          "uc04-startDate": "2026-09-01",
          "uc04-endDate": "2026-09-14",
          "uc04-visaType": "schengen_short_stay",
          "uc04-jobDuties": "engineering",
          "uc04-hasContractSigningAuthority": false,
          // Blank, and named rather than omitted — the same convention UC-08's
          // period rows already follow. A quick-fill only sets the keys it
          // lists, so a row left out here would keep whatever the previously
          // clicked scenario put in it and quietly change this one's counts.
          "uc04-h1-country": "",
          "uc04-h1-startDate": "",
          "uc04-h1-endDate": "",
          "uc04-h2-country": "",
          "uc04-h2-startDate": "",
          "uc04-h2-endDate": "",
          "uc04-reasonText": "Two weeks working alongside the Madrid team.",
          "uc04-externalRef": "4001",
          "uc04-now": "2026-08-15",
        },
      },
      {
        // THE SAME TRIP, THE SAME FORM, A DIFFERENT TRAVELLER. "Low-risk
        // Schengen trip" above is prepared for a mobility specialist; naming
        // Amanda Walker instead blocks it outright, because her employer has
        // not granted workation permission — a fact on HER record, not on this
        // form. Nothing else about the request changes. Verified against the
        // mock: `ready_for_approval / all_gates_passed` for Anna Müller,
        // `blocked / employer_permission_not_granted` for Amanda.
        id: "uc04-no-permission",
        turnsOn: "who",
        label: "…the same trip, for Amanda",
        fails: true,
        persona: "admin",
        note:
          "Identical to \u201cLow-risk Schengen trip\u201d except for who is travelling. Amanda\u2019s employer has not agreed to her working from another country, so this is refused outright rather than sent to anyone.",
        fields: {
          // Amanda J Walker — US, global-payroll employee, active (real
          // Sandbox id), whose record carries no workation permission.
          "uc04-employmentId": "e818418e-1db7-431d-a663-9f477addb8bd",
          "uc04-homeCountry": "DE",
          "uc04-nationality": "DE",
          "uc04-destinationCountry": "ES",
          "uc04-startDate": "2026-09-01",
          "uc04-endDate": "2026-09-14",
          "uc04-visaType": "schengen_short_stay",
          "uc04-jobDuties": "engineering",
          "uc04-hasContractSigningAuthority": false,
          "uc04-h1-country": "",
          "uc04-h1-startDate": "",
          "uc04-h1-endDate": "",
          "uc04-h2-country": "",
          "uc04-h2-startDate": "",
          "uc04-h2-endDate": "",
          "uc04-reasonText": "Two weeks working alongside the Madrid team.",
          "uc04-externalRef": "4013",
          "uc04-now": "2026-08-15",
        },
      },
      {
        // AND THE SAME TRIP FOR SOMEBODY AT ANOTHER COMPANY. Lars van der Berg
        // is the one person on the picker who does not work for Acme, so the
        // admin filing this has no standing over his record at all — refused on
        // identity, before any question about the trip is reached. It is the
        // company boundary being shown, which is a different refusal from
        // Amanda's and reads identically on the form.
        id: "uc04-other-company",
        turnsOn: "who",
        label: "…the same trip, for Lars",
        fails: true,
        persona: "admin",
        note:
          "Identical again, for the one person here who does not work for this company. Jane Doe cannot file anything for him \u2014 refused on identity, before the trip itself is looked at.",
        fields: {
          // Lars van der Berg — NL, EOR employee, active (real Sandbox id),
          // employed by co_northwind_02 rather than by the admin's Acme.
          "uc04-employmentId": "673a1884-86fb-4101-83d3-b6c544d93bca",
          "uc04-homeCountry": "DE",
          "uc04-nationality": "DE",
          "uc04-destinationCountry": "ES",
          "uc04-startDate": "2026-09-01",
          "uc04-endDate": "2026-09-14",
          "uc04-visaType": "schengen_short_stay",
          "uc04-jobDuties": "engineering",
          "uc04-hasContractSigningAuthority": false,
          "uc04-h1-country": "",
          "uc04-h1-startDate": "",
          "uc04-h1-endDate": "",
          "uc04-h2-country": "",
          "uc04-h2-startDate": "",
          "uc04-h2-endDate": "",
          "uc04-reasonText": "Two weeks working alongside the Madrid team.",
          "uc04-externalRef": "4014",
          "uc04-now": "2026-08-15",
        },
      },
      {
        id: "uc04-same",
        turnsOn: "what",
        label: "Same-country workation",
        fails: true,
        persona: "admin",
        fields: {
          // Anna Müller — DE, employee, active. The countries moved NG -> DE
          // with her: the gate this scenario demonstrates is "home country ==
          // destination country", which is country-agnostic, and no Sandbox
          // person is Nigerian. `blocked / same_country_workation` is
          // unchanged, verified by running it.
          "uc04-employmentId": "09b65526-643b-4956-959b-916e6429bd23",
          "uc04-homeCountry": "DE",
          "uc04-nationality": "DE",
          "uc04-destinationCountry": "DE",
          "uc04-startDate": "2026-09-01",
          "uc04-endDate": "2026-09-14",
          "uc04-visaType": "schengen_short_stay",
          "uc04-jobDuties": "engineering",
          "uc04-hasContractSigningAuthority": false,
          // Blank, and named rather than omitted — the same convention UC-08's
          // period rows already follow. A quick-fill only sets the keys it
          // lists, so a row left out here would keep whatever the previously
          // clicked scenario put in it and quietly change this one's counts.
          "uc04-h1-country": "",
          "uc04-h1-startDate": "",
          "uc04-h1-endDate": "",
          "uc04-h2-country": "",
          "uc04-h2-startDate": "",
          "uc04-h2-endDate": "",
          "uc04-reasonText": "Working from another city at home.",
          "uc04-externalRef": "4002",
          "uc04-now": "2026-08-15",
        },
      },
      {
        id: "uc04-pe",
        turnsOn: "what",
        label: "Sales role, signing authority",
        fails: true,
        persona: "admin",
        fields: {
          // Anna Müller — DE, employee, active.
          "uc04-employmentId": "09b65526-643b-4956-959b-916e6429bd23",
          "uc04-homeCountry": "DE",
          "uc04-nationality": "DE",
          "uc04-destinationCountry": "GB",
          "uc04-startDate": "2026-09-01",
          "uc04-endDate": "2026-09-10",
          "uc04-visaType": "business_visa",
          "uc04-jobDuties": "sales",
          "uc04-hasContractSigningAuthority": true,
          // Blank, and named rather than omitted — the same convention UC-08's
          // period rows already follow. A quick-fill only sets the keys it
          // lists, so a row left out here would keep whatever the previously
          // clicked scenario put in it and quietly change this one's counts.
          "uc04-h1-country": "",
          "uc04-h1-startDate": "",
          "uc04-h1-endDate": "",
          "uc04-h2-country": "",
          "uc04-h2-startDate": "",
          "uc04-h2-endDate": "",
          "uc04-reasonText": "Closing deals from the London office.",
          "uc04-externalRef": "4003",
          "uc04-now": "2026-08-15",
        },
      },
      {
        // THE POSITIVE ROW FOR A DESTINATION THAT NEEDS A REAL PERMIT.
        // The matrix hard-blocks US and Canada for anything but `work_permit`,
        // and this form did not offer `work_permit` at all — so every US or
        // Canadian workation submitted here was `blocked`, and no scenario
        // said so or contradicted it. A gate with only a refusing example is
        // indistinguishable from a gate that cannot pass.
        id: "uc04-us-permit",
        turnsOn: "what",
        label: "US, with a work permit",
        persona: "admin",
        fields: {
          // Anna Müller — DE, employee, active.
          "uc04-employmentId": "09b65526-643b-4956-959b-916e6429bd23",
          "uc04-homeCountry": "DE",
          "uc04-nationality": "DE",
          "uc04-destinationCountry": "US",
          "uc04-startDate": "2026-09-01",
          "uc04-endDate": "2026-09-14",
          "uc04-visaType": "work_permit",
          "uc04-jobDuties": "engineering",
          "uc04-hasContractSigningAuthority": false,
          // Blank, and named rather than omitted — the same convention UC-08's
          // period rows already follow. A quick-fill only sets the keys it
          // lists, so a row left out here would keep whatever the previously
          // clicked scenario put in it and quietly change this one's counts.
          "uc04-h1-country": "",
          "uc04-h1-startDate": "",
          "uc04-h1-endDate": "",
          "uc04-h2-country": "",
          "uc04-h2-startDate": "",
          "uc04-h2-endDate": "",
          "uc04-reasonText": "Two weeks with the Austin team, work permit already issued.",
          "uc04-externalRef": "4004",
          "uc04-now": "2026-08-15",
        },
      },
      {
        // The matrix's HIGHEST permanent-establishment rule, which this form
        // could not state: `executive`. The option offered instead was
        // "Management", a value policyEngine.js does not recognise, so a
        // C-suite traveller came back `blocked / factors_invalid` — a data
        // complaint — rather than the Tier-2 escalation the matrix has an
        // actual rule for.
        id: "uc04-executive",
        turnsOn: "what",
        label: "Executive abroad (PE risk)",
        fails: true,
        persona: "admin",
        fields: {
          "uc04-employmentId": "09b65526-643b-4956-959b-916e6429bd23",
          "uc04-homeCountry": "DE",
          "uc04-nationality": "DE",
          "uc04-destinationCountry": "PT",
          "uc04-startDate": "2026-09-01",
          "uc04-endDate": "2026-09-14",
          "uc04-visaType": "digital_nomad_visa",
          "uc04-jobDuties": "executive",
          "uc04-hasContractSigningAuthority": true,
          // Blank, and named rather than omitted — the same convention UC-08's
          // period rows already follow. A quick-fill only sets the keys it
          // lists, so a row left out here would keep whatever the previously
          // clicked scenario put in it and quietly change this one's counts.
          "uc04-h1-country": "",
          "uc04-h1-startDate": "",
          "uc04-h1-endDate": "",
          "uc04-h2-country": "",
          "uc04-h2-startDate": "",
          "uc04-h2-endDate": "",
          "uc04-reasonText": "Two weeks running the business from Lisbon.",
          "uc04-externalRef": "4005",
          "uc04-now": "2026-08-15",
        },
      },
      {
        // The sanctions hard block, in its own words. Without this row the
        // only way to see `blocked / sanctioned_region` was to type a country
        // code by hand — and the gate that produces it sits ahead of employer
        // permission and factor validation precisely so it cannot be masked by
        // either.
        id: "uc04-sanctioned",
        turnsOn: "what",
        label: "Sanctioned destination",
        fails: true,
        persona: "admin",
        fields: {
          "uc04-employmentId": "09b65526-643b-4956-959b-916e6429bd23",
          "uc04-homeCountry": "DE",
          "uc04-nationality": "DE",
          "uc04-destinationCountry": "IR",
          "uc04-startDate": "2026-09-01",
          "uc04-endDate": "2026-09-14",
          "uc04-visaType": "business_visa",
          "uc04-jobDuties": "engineering",
          "uc04-hasContractSigningAuthority": false,
          // Blank, and named rather than omitted — the same convention UC-08's
          // period rows already follow. A quick-fill only sets the keys it
          // lists, so a row left out here would keep whatever the previously
          // clicked scenario put in it and quietly change this one's counts.
          "uc04-h1-country": "",
          "uc04-h1-startDate": "",
          "uc04-h1-endDate": "",
          "uc04-h2-country": "",
          "uc04-h2-startDate": "",
          "uc04-h2-endDate": "",
          "uc04-reasonText": "Site visit.",
          "uc04-externalRef": "4006",
          "uc04-now": "2026-08-15",
        },
      },
      {
        // THE TWO DAY-COUNTS DISAGREEING, HONESTLY — the one thing no other
        // row here can show. Two prior stays in Spain: one falls inside both
        // counting windows, the other inside the 365-day one and outside the
        // 180-day one. So the Schengen count reads 59 of 90 (still inside)
        // while the tax-residency count reads 210 of 183 (already past), and
        // the request is `ready_for_approval` carrying `tax_residency_watch`.
        // Two windows measuring different things is not a contradiction to be
        // reconciled away, and a scenario that only ever showed them agreeing
        // hid that.
        id: "uc04-disagree",
        turnsOn: "what",
        label: "Two counts, two answers",
        persona: "admin",
        fields: {
          "uc04-employmentId": "09b65526-643b-4956-959b-916e6429bd23",
          "uc04-homeCountry": "DE",
          "uc04-nationality": "DE",
          "uc04-destinationCountry": "ES",
          "uc04-startDate": "2026-09-01",
          "uc04-endDate": "2026-09-14",
          "uc04-visaType": "schengen_short_stay",
          "uc04-jobDuties": "engineering",
          "uc04-hasContractSigningAuthority": false,
          "uc04-h1-country": "ES",
          "uc04-h1-startDate": "2026-07-01",
          "uc04-h1-endDate": "2026-08-14",
          "uc04-h2-country": "ES",
          "uc04-h2-startDate": "2025-10-01",
          "uc04-h2-endDate": "2026-02-28",
          "uc04-reasonText": "Another fortnight in Madrid, after a long stretch there earlier.",
          "uc04-externalRef": "4007",
          "uc04-now": "2026-08-15",
        },
      },
      {
        // THE COUNT THAT CHANGES NOTHING, and it is here because the four
        // scenarios below it would otherwise be the only ones with a history at
        // all — leaving "a number appeared" and "a number mattered"
        // indistinguishable. Twenty prior days in Spain, a fourteen-day trip:
        // the Schengen peak reads 34 of 90 and the 183/365 count reads 34, so
        // both windows are consulted, both report a real measurement, and
        // neither moves the decision. Contrast with "Low-risk Schengen trip",
        // which states no stays at all and whose result says so — 0 over 0
        // trips is a FLOOR, not a count.
        id: "uc04-history-clear",
        turnsOn: "what",
        label: "Prior stays, well inside",
        persona: "admin",
        note:
          "Twenty days already spent in Spain \u2014 a real count, and it changes nothing.",
        fields: {
          "uc04-employmentId": "09b65526-643b-4956-959b-916e6429bd23",
          "uc04-homeCountry": "DE",
          "uc04-nationality": "DE",
          "uc04-destinationCountry": "ES",
          "uc04-startDate": "2026-09-01",
          "uc04-endDate": "2026-09-14",
          "uc04-visaType": "schengen_short_stay",
          "uc04-jobDuties": "engineering",
          "uc04-hasContractSigningAuthority": false,
          "uc04-h1-country": "ES",
          "uc04-h1-startDate": "2026-04-01",
          "uc04-h1-endDate": "2026-04-20",
          "uc04-h2-country": "",
          "uc04-h2-startDate": "",
          "uc04-h2-endDate": "",
          "uc04-reasonText": "A fortnight in Madrid, after a short spring visit.",
          "uc04-externalRef": "4009",
          "uc04-now": "2026-08-15",
        },
      },
      {
        // THE BOUNDARY, FROM THE ALLOWED SIDE. 76 prior days plus a 14-day
        // trip is exactly 90 of 90 — zero days of headroom, and allowed,
        // because `schengenPeakDays()` breaches on `peakDays > 90` rather than
        // `>= 90`. Driven: `ready_for_approval / all_gates_passed`, and the
        // Schengen row prints "90 of 90 — 0 day(s) of headroom". Paired with
        // the block two rows down, this is what shows the line sits exactly
        // where the code says it does; a scenario that only ever demonstrated
        // 121 of 90 leaves "over" and "at" looking like the same case.
        id: "uc04-history-edge",
        turnsOn: "what",
        label: "Exactly on the Schengen line",
        persona: "admin",
        note:
          "Ninety days of ninety, and it clears \u2014 the limit is exceeding it, not reaching it.",
        fields: {
          "uc04-employmentId": "09b65526-643b-4956-959b-916e6429bd23",
          "uc04-homeCountry": "DE",
          "uc04-nationality": "DE",
          "uc04-destinationCountry": "ES",
          "uc04-startDate": "2026-09-01",
          "uc04-endDate": "2026-09-14",
          "uc04-visaType": "schengen_short_stay",
          "uc04-jobDuties": "engineering",
          "uc04-hasContractSigningAuthority": false,
          "uc04-h1-country": "ES",
          "uc04-h1-startDate": "2026-06-01",
          "uc04-h1-endDate": "2026-08-15",
          "uc04-h2-country": "",
          "uc04-h2-startDate": "",
          "uc04-h2-endDate": "",
          "uc04-reasonText": "A fortnight in Madrid, straight after a long summer there.",
          "uc04-externalRef": "4010",
          "uc04-now": "2026-08-15",
        },
      },
      {
        // THE UNION, AND THE PROOF THAT IT IS NOT A SUM. The two stated stays
        // are 45 and 41 days and share the fortnight 1–15 July, so they cover
        // 71 distinct days and not 86. With the trip that peaks at 85 of 90 —
        // allowed. SUMMED it would read 100 of 90 and this request would be
        // blocked, which is exactly the defect `73920c9` fixed
        // (docs/BUILD-LOG.md; CLAUDE.md §7's gaps list, items 1–3). A traveller
        // refused on days they did not spend is not a stricter system, it is a
        // wrong one, and this is the row that would go red if the arithmetic
        // regressed.
        id: "uc04-history-overlap",
        turnsOn: "what",
        label: "Two stays that overlap",
        persona: "admin",
        note:
          "Forty-five days and forty-one, but only seventy-one distinct days \u2014 a day spent once is counted once.",
        fields: {
          "uc04-employmentId": "09b65526-643b-4956-959b-916e6429bd23",
          "uc04-homeCountry": "DE",
          "uc04-nationality": "DE",
          "uc04-destinationCountry": "ES",
          "uc04-startDate": "2026-09-01",
          "uc04-endDate": "2026-09-14",
          "uc04-visaType": "schengen_short_stay",
          "uc04-jobDuties": "engineering",
          "uc04-hasContractSigningAuthority": false,
          "uc04-h1-country": "ES",
          "uc04-h1-startDate": "2026-06-01",
          "uc04-h1-endDate": "2026-07-15",
          "uc04-h2-country": "ES",
          "uc04-h2-startDate": "2026-07-01",
          "uc04-h2-endDate": "2026-08-10",
          "uc04-reasonText": "A fortnight in Madrid, after two stays that ran into each other.",
          "uc04-externalRef": "4011",
          "uc04-now": "2026-08-15",
        },
      },
      {
        // THE BLOCK, WITH ITS FIGURE. 107 prior days and a 14-day trip make
        // 121 of 90 — `blocked / schengen_90_180_exceeded`, flagged
        // `schengen_overstay`, and the Schengen row prints "over by 31" rather
        // than a bare verdict. Note the row beneath it says the 183/365 count
        // was NOT REACHED, which is a different claim from "under the line".
        // Before the
        // form had prior-stay boxes this decision was unreachable from the
        // page: the history was hard-coded empty, so the single most
        // consequential gate UC-04 owns could not be demonstrated at all.
        id: "uc04-history-over",
        turnsOn: "what",
        label: "Over the Schengen limit",
        fails: true,
        persona: "admin",
        note:
          "One hundred and twenty-one days of ninety \u2014 over by thirty-one, and the block prints the figure it refused on.",
        fields: {
          "uc04-employmentId": "09b65526-643b-4956-959b-916e6429bd23",
          "uc04-homeCountry": "DE",
          "uc04-nationality": "DE",
          "uc04-destinationCountry": "ES",
          "uc04-startDate": "2026-09-01",
          "uc04-endDate": "2026-09-14",
          "uc04-visaType": "schengen_short_stay",
          "uc04-jobDuties": "engineering",
          "uc04-hasContractSigningAuthority": false,
          "uc04-h1-country": "ES",
          "uc04-h1-startDate": "2026-05-01",
          "uc04-h1-endDate": "2026-08-15",
          "uc04-h2-country": "",
          "uc04-h2-startDate": "",
          "uc04-h2-endDate": "",
          "uc04-reasonText": "A fortnight in Madrid, after most of the summer there.",
          "uc04-externalRef": "4012",
          "uc04-now": "2026-08-15",
        },
      },
      {
        id: "uc04-persona",
        turnsOn: "who",
        label: "Filed by the employee",
        fails: true,
        persona: "chris",
        // Chris Lee filing for himself — his own real Sandbox id as the
        // subject, so the refusal is plainly about the ROLE and not about a
        // subject nobody recognises. Refused at the persona gate (403) before
        // any record is read.
        //
        // IT NAMES ALL EIGHTEEN BOXES ANYWAY, and used to name two. A quick-fill
        // only sets what it lists, so clicking any scenario above and then this
        // one left that scenario's dates, visa, duties and prior stays sitting
        // in the form under a different requester — values nobody chose and
        // nobody could see were stale. Being refused before anything is read is
        // a reason the LEFTOVERS DO NOT MATTER TO THE VERDICT; it is not a
        // reason to leave them on screen. Every scenario in every request type
        // now names the same key set, and test/portalCopy.test.js checks it.
        note:
          "Every box is filled in, and it is still turned away \u2014 on who is asking, before any of it is read.",
        fields: {
          "uc04-employmentId": "8ab12460-b568-4c1e-af9d-09b1fabd8f46",
          "uc04-homeCountry": "DE",
          "uc04-nationality": "DE",
          "uc04-destinationCountry": "ES",
          "uc04-startDate": "2026-09-01",
          "uc04-endDate": "2026-09-14",
          "uc04-visaType": "schengen_short_stay",
          "uc04-jobDuties": "engineering",
          "uc04-hasContractSigningAuthority": false,
          "uc04-h1-country": "",
          "uc04-h1-startDate": "",
          "uc04-h1-endDate": "",
          "uc04-h2-country": "",
          "uc04-h2-startDate": "",
          "uc04-h2-endDate": "",
          "uc04-reasonText": "Two weeks with the Madrid team.",
          "uc04-externalRef": "4008",
          "uc04-now": "2026-08-15",
        },
      },
    ],

    uc05: [
      // Every subject here is a mirrored Sandbox person (src/portal/personas.js).
      //
      // WHY THE FIRST FOUR ARE PORTUGAL, AND WHY THEY ARE FIRST.
      // The report that produced this ordering was that everything a tester
      // clicked came back refused: a Brazilian resignation (no rule in the
      // table) and a Portuguese one proposing a leaving date 23 days inside the
      // statutory notice. Both refusals are correct and neither shows the use
      // case doing its job — computing a statutory leaving date and a holiday
      // settlement a person can sign. Nothing on this row did that for a
      // country the demo set actually covers, and a row of buttons that only
      // ever refuses is indistinguishable from a use case that cannot succeed
      // (docs/BUILD-LOG.md §3.30, the most expensive recurring defect here).
      //
      // Portugal is the only country on this page that CAN show it.
      // docs/DEMO-COUNTRIES.md fixes the demonstrable set at NL · PT · CA · US;
      // src/uc05/noticePeriodTable.js holds GB, IE, DE, PL, IN, PH, MX, CA and
      // PT. The intersection is PT and CA — and of those two only Portugal has
      // a persona here, because the roster mirrors the project owner's own
      // Sandbox and there is no Canadian record on it. So the headline is PT,
      // and so are the three under it: one success is an example, four are the
      // rule (a clean run, a settlement worth reading, the exact-date boundary,
      // and the bracket one side of the two-year line).
      //
      // Every figure these four quote in their own note is driven through the
      // real handler by test/portalUc05Success.test.js and compared against the
      // number that comes back — a note is a claim, and a claim nobody runs is
      // how the "balance is unknown" line below survived while the payout row
      // it described was printing 0.00.
      //
      // The refusals are kept, moved below the successes, and every one carries
      // the "refused" mark the button renders from `fails: true`.
      {
        id: "uc05-pt-clean",
        turnsOn: "who",
        label: "Portugal, signed off",
        persona: "joao",
        note:
          "More than two years' service, so Portugal asks for 60 days \u2014 the date given is well beyond it, and the holiday owed comes to 2,704.00 EUR.",
        fields: {
          "uc05-proposedEndDate": "2026-11-30",
          "uc05-now": "2026-08-20",
          "uc05-letterText": "",
          "uc05-reason": "new opportunity",
          "uc05-ptoType": "vacation",
          "uc05-ptoDaysAccrued": "18",
          "uc05-ptoDaysUsed": "5",
          "uc05-ptoHourlyRate": "26.00",
          "uc05-currency": "EUR",
          "uc05-externalRef": "5010",
        },
      },
      // THE SETTLEMENT, RATHER THAN THE DATE. The one above shows the notice
      // period; this one exists so the money column is worth looking at — a
      // balance with days taken against it and a half-day remainder, so the
      // subtraction and the day-to-hours conversion are both visible instead of
      // a round number that could have come from anywhere.
      {
        id: "uc05-pt-payout",
        turnsOn: "who",
        label: "Portugal, holiday to settle",
        persona: "joao",
        note:
          "24 days accrued and 6.5 taken leaves 17.5 to pay, which is where the 3,990.00 EUR settlement comes from.",
        fields: {
          "uc05-proposedEndDate": "2026-12-31",
          "uc05-now": "2026-08-20",
          "uc05-letterText": "",
          "uc05-reason": "family reasons",
          "uc05-ptoType": "vacation",
          "uc05-ptoDaysAccrued": "24",
          "uc05-ptoDaysUsed": "6.5",
          "uc05-ptoHourlyRate": "28.50",
          "uc05-currency": "EUR",
          "uc05-externalRef": "5011",
        },
      },
      // THE BOUNDARY THAT STILL SUCCEEDS. The proposed date IS the statutory
      // date, so the comparison reads `match (0 days)` rather than a shortfall.
      // Worth its own button because "on the line" is the case a reader expects
      // to be refused, and the whole point of the comparison is that it is not:
      // src/uc05/policyEngine.js escalates only `earlier_than_statutory`.
      // The days-used box holds a typed 0, which is an answer rather than a
      // blank — src/portal/server.js's buildTimeOffBalances() keeps the two
      // apart deliberately (finding F-35).
      {
        id: "uc05-pt-exact",
        turnsOn: "who",
        label: "Portugal, exactly on the statutory date",
        persona: "joao",
        note:
          "The date given is the statutory date itself, so the comparison reads a match rather than a shortfall \u2014 and it still reaches a sign-off.",
        fields: {
          "uc05-proposedEndDate": "2026-10-19",
          "uc05-now": "2026-08-20",
          "uc05-letterText": "",
          "uc05-reason": "new opportunity",
          "uc05-ptoType": "vacation",
          "uc05-ptoDaysAccrued": "12",
          "uc05-ptoDaysUsed": "0",
          "uc05-ptoHourlyRate": "26.00",
          "uc05-currency": "EUR",
          "uc05-externalRef": "5012",
        },
      },
      // THE OTHER SIDE OF PORTUGAL'S TWO-YEAR LINE, on the same employee.
      // src/uc05/noticePeriodTable.js gives PT 30 days under two years' service
      // and 60 days at or above it, and every other Portuguese scenario here
      // sits in the 60-day half — so the bracket lookup was only ever shown
      // returning one answer, which demonstrates a lookup no more than a
      // constant would. docs/DEMO-COUNTRIES.md §5 records the under-two-year
      // bracket as not demonstrable on live Sandbox data (both PT records start
      // 2023-06-26); the "evaluate as at" box is how it is demonstrable here,
      // and the note says out loud that the reading date is what moves.
      {
        id: "uc05-pt-under-two-years",
        turnsOn: "who",
        label: "Portugal, before the two-year line",
        persona: "joao",
        note:
          "Read as at 1 May 2021, a month before Jo\u00e3o's second anniversary \u2014 under two years Portugal asks 30 days, not 60.",
        fields: {
          "uc05-proposedEndDate": "2021-06-30",
          "uc05-now": "2021-05-01",
          "uc05-letterText": "",
          "uc05-reason": "new opportunity",
          "uc05-ptoType": "vacation",
          "uc05-ptoDaysAccrued": "9",
          "uc05-ptoDaysUsed": "2",
          "uc05-ptoHourlyRate": "22.00",
          "uc05-currency": "EUR",
          "uc05-externalRef": "5013",
        },
      },
      // A second country whose rule is a SLIDING SCALE rather than two brackets:
      // the United Kingdom adds a week per year of service (Employment Rights
      // Act 1996 §86), and Emma's five and a half years land her on 35 days.
      {
        id: "uc05-sandbox-gb",
        turnsOn: "who",
        label: "UK, within statute",
        persona: "emma",
        fields: {
          "uc05-proposedEndDate": "2026-10-15",
          "uc05-now": "2026-08-16",
          "uc05-letterText": "",
          "uc05-reason": "new opportunity",
          "uc05-ptoType": "vacation",
          "uc05-ptoDaysAccrued": "12",
          "uc05-ptoDaysUsed": "3",
          "uc05-ptoHourlyRate": "40.00",
          "uc05-currency": "GBP",
          "uc05-externalRef": "5005",
        },
      },
      // Germany's rule is an ANCHOR, not a bracket: four weeks landing on the
      // 15th or the end of a month (BGB §622).
      //
      // ITS NOTE USED TO SAY SOMETHING THE PAGE DOES NOT DO. It claimed the
      // empty holiday boxes make the result "say the balance is unknown rather
      // than showing a zero nobody worked out" — driven through the real
      // handler, the payout row reads exactly `0.00 EUR (no_time_off_records)`.
      // The tag is the honest half and the zero is real; what is not true is
      // that a reader is shown anything other than a zero. The note now says
      // what is on the screen, and test/portalUc05Success.test.js pins it.
      {
        id: "uc05-de",
        turnsOn: "who",
        label: "Germany, month-anchored",
        persona: "anna",
        note:
          "The holiday boxes are left empty on purpose \u2014 the payout row then reads 0.00 and names no records as its source, which is not the same fact as a balance somebody counted.",
        fields: {
          "uc05-proposedEndDate": "2026-10-31",
          "uc05-now": "2026-08-10",
          "uc05-letterText": "",
          "uc05-reason": "relocation",
          "uc05-ptoType": "vacation",
          "uc05-ptoDaysAccrued": "",
          "uc05-ptoDaysUsed": "",
          "uc05-ptoHourlyRate": "",
          "uc05-currency": "EUR",
          "uc05-externalRef": "5002",
        },
      },
      // THE LETTER PATH, WHICH NOTHING ON THIS PAGE USED TO DEMONSTRATE. The
      // typed-date scenarios above send an empty letter, so the textarea a
      // reader meets first was never filled by any of them and
      // src/uc05/letterExtractor.js never ran from the portal at all.
      //
      // WHAT DECIDES WHICH SOURCE IS USED, read out of src/uc05/workflow.js
      // rather than assumed: an explicit `proposedEndDate` OR an explicit
      // `reason` skips the extractor ENTIRELY. So a scenario that pastes a
      // letter and also types a date does not demonstrate letter reading — it
      // demonstrates the letter being ignored. Both are worth seeing, so there
      // is one of each (the second is under the refusals below), and the result
      // panel's "Date came from" line names which path answered
      // (`rule_based_fallback` or `llm` for the letter, `structured_input` for
      // the boxes).
      {
        id: "uc05-letter",
        turnsOn: "what",
        label: "From the letter alone",
        persona: "emma",
        note:
          "The date and reason boxes are left empty on purpose \u2014 both are read out of the letter instead. The result says where the date came from.",
        fields: {
          "uc05-proposedEndDate": "",
          "uc05-now": "2026-08-16",
          "uc05-letterText":
            "Dear team,\n\nI am writing to resign from my role. My last working day will be 15 October 2026.\nI have decided to pursue a new opportunity elsewhere.\n\nThank you for everything,\nEmma",
          "uc05-reason": "",
          "uc05-ptoType": "vacation",
          "uc05-ptoDaysAccrued": "12",
          "uc05-ptoDaysUsed": "3",
          "uc05-ptoHourlyRate": "40.00",
          "uc05-currency": "GBP",
          "uc05-externalRef": "5007",
        },
      },
      // --- the refusals, all four of them below this line ---------------------
      // Kept, and kept clickable: a page that only ever succeeds proves as
      // little as one that only ever refuses. They are simply no longer what a
      // reader meets first.
      //
      // The long-bracket clash. This used to be Poland; the Sandbox has no Polish
      // employment, so it is Portugal, on PT's OWN rule — 60 calendar days past
      // two years' service (Código do Trabalho art. 400). João is well past two
      // years, and five weeks' notice does not cover 60 days. This is the one
      // that reached the live account as ticket #53.
      {
        id: "uc05-pt",
        turnsOn: "who",
        label: "Portugal, notice too short",
        fails: true,
        persona: "joao",
        fields: {
          "uc05-proposedEndDate": "2026-08-31",
          "uc05-now": "2026-07-25",
          "uc05-letterText": "",
          "uc05-reason": "family reasons",
          "uc05-ptoType": "vacation",
          "uc05-ptoDaysAccrued": "10",
          "uc05-ptoDaysUsed": "2",
          "uc05-ptoHourlyRate": "24.00",
          "uc05-currency": "EUR",
          "uc05-externalRef": "5003",
        },
      },
      {
        id: "uc05-letter-clash",
        turnsOn: "what",
        label: "Letter and box disagree",
        fails: true,
        persona: "emma",
        note:
          "The letter says 15 October and the box says 15 September. The box wins and the letter is not read at all \u2014 the result names which of the two the date came from.",
        fields: {
          "uc05-proposedEndDate": "2026-09-15",
          "uc05-now": "2026-08-16",
          "uc05-letterText":
            "Dear team,\n\nI am writing to resign from my role. My last working day will be 15 October 2026.\nI have decided to pursue a new opportunity elsewhere.\n\nThank you for everything,\nEmma",
          "uc05-reason": "",
          "uc05-ptoType": "vacation",
          "uc05-ptoDaysAccrued": "12",
          "uc05-ptoDaysUsed": "3",
          "uc05-ptoHourlyRate": "40.00",
          "uc05-currency": "GBP",
          "uc05-externalRef": "5008",
        },
      },
      // Brazil is not in the nine-country table, and that escalation is the right
      // answer rather than a gap. This is the one that reached the live account
      // as ticket #54.
      {
        id: "uc05-sandbox-br",
        turnsOn: "who",
        label: "Brazil, no rule in the table",
        fails: true,
        persona: "carlos",
        note:
          "The holiday boxes are left empty on purpose: with no rule on file for Brazil there is no notice period to work a payout against.",
        fields: {
          "uc05-proposedEndDate": "2026-10-15",
          "uc05-now": "2026-08-16",
          "uc05-letterText": "",
          "uc05-reason": "new opportunity",
          "uc05-ptoType": "vacation",
          "uc05-ptoDaysAccrued": "",
          "uc05-ptoDaysUsed": "",
          "uc05-ptoHourlyRate": "",
          "uc05-currency": "BRL",
          "uc05-externalRef": "5006",
        },
      },
      {
        id: "uc05-terminated",
        turnsOn: "who",
        label: "Already archived",
        fails: true,
        persona: "thomas",
        // THE BUG THIS ENTRY CAUSED, and the rule that now prevents it. It used
        // to name six of the ten boxes, and a quick-fill only sets what it
        // names — so clicking "Portugal, notice too short" and then this one
        // left Portugal's holiday type, days used, hourly rate and currency
        // sitting in the form, values this scenario never chose and nobody
        // could see were stale. Identical to the defect UC-04's prior-stay rows
        // hit, fixed the same way: every scenario names every key, blank ones
        // included, and test/portalCopy.test.js now checks that for all seven
        // request types rather than trusting anyone to remember.
        note:
          "Almost every box is left empty on purpose \u2014 this request is turned away because the employment is already closed, before a single figure is read.",
        fields: {
          "uc05-proposedEndDate": "2026-09-15",
          "uc05-now": "2026-08-16",
          "uc05-letterText": "",
          "uc05-reason": "",
          "uc05-ptoType": "",
          "uc05-ptoDaysAccrued": "",
          "uc05-ptoDaysUsed": "",
          "uc05-ptoHourlyRate": "",
          "uc05-currency": "",
          "uc05-externalRef": "5004",
        },
      },
    ],

    // UC-07 and UC-08 make NO Remote read at all — `handleRelocationReview()`
    // and `handleTaxInquiry()` take no `remote` client, which is the structural
    // half of "no execution path exists". So the employment id here is a
    // reference on the dossier, not an input to a gate, and repointing it
    // cannot move a verdict. It is still a real Sandbox id, for the same reason
    // the personas are: a tester should recognise the person and be able to
    // check the id against their own account.
    //
    // The route each dossier reports is parsed from the TEXT, not from the
    // record, so where the story named a country nobody in the roster comes
    // from, the story moved to a country somebody does — rather than pinning a
    // Portuguese id to a Spanish story and calling it fixed.
    uc07: [
      {
        id: "uc07-feasible",
        turnsOn: "what",
        label: "Feasible: Portugal → Netherlands",
        fields: {
          // João Silva — PT, employee, active. Story moved ES -> PT with him;
          // the parsed route reads PT → NL and the verdict stays PROCEED.
          "uc07-text": "We're permanently relocating our engineer from Portugal to the Netherlands. She already has the right to work there. Source last working day June 30, destination start July 1.",
          "uc07-employmentId": "378eee6b-c6db-4484-ba32-7283bd0e2de9",
          "uc07-externalRef": "7001",
          "uc07-salary": "64800",
          "uc07-minimumVisaSalary": "54000",
          "uc07-currency": "EUR",
          "uc07-months": "12",
          "uc07-creationDate": "2026-05-01",
          "uc07-proposedStartDate": "2026-07-01",
          "uc07-destinationStartDate": "2026-07-01",
          "uc07-sourceTerminationDate": "2026-06-30",
          "uc07-sourceLastWorkingDay": "2026-06-30",
          "uc07-originalHireDate": "2019-06-03",
          "uc07-destinationSupported": true,
          "uc07-immigrationSupportRequired": false,
          "uc07-immigrationConfirmed": true,
          "uc07-rightToWorkConfirmed": true,
          "uc07-destinationStartDateConfirmed": true,
          "uc07-sourceExitPlanValidated": true,
          "uc07-employerPresenceInDestination": true,
          "uc07-taxTreatyNexusConfirmed": true,
          "uc07-ptoTransferAllowed": true,
          "uc07-sourcePtoDays": "12",
          "uc07-seniorityPreservable": "yes",
        },
      },
      {
        id: "uc07-blocked",
        turnsOn: "what",
        label: "Blocked: unsupported country, salary under the visa minimum",
        fails: true,
        fields: {
          // Carlos Silva — BR, CONTRACTOR, active. The story says "our
          // contractor", and he is the only contractor in the Sandbox roster,
          // so the subject and the sentence now agree. Story unchanged: it
          // names no source country to move.
          "uc07-text": "Moving our contractor to a country that isn't on the supported list, full time. The salary offered is below the visa minimum.",
          "uc07-employmentId": "c2cd77da-d576-423f-b4f1-f9e40b313353",
          "uc07-externalRef": "7002",
          "uc07-salary": "38400",
          "uc07-minimumVisaSalary": "54000",
          "uc07-currency": "USD",
          "uc07-months": "12",
          "uc07-creationDate": "2026-05-01",
          "uc07-proposedStartDate": "2026-06-30",
          "uc07-destinationStartDate": "2026-06-30",
          "uc07-sourceTerminationDate": "2026-06-15",
          "uc07-sourceLastWorkingDay": "2026-06-12",
          "uc07-originalHireDate": "",
          "uc07-destinationSupported": false,
          "uc07-immigrationSupportRequired": false,
          "uc07-immigrationConfirmed": false,
          "uc07-rightToWorkConfirmed": false,
          "uc07-destinationStartDateConfirmed": false,
          "uc07-sourceExitPlanValidated": false,
          "uc07-employerPresenceInDestination": false,
          "uc07-taxTreatyNexusConfirmed": false,
          "uc07-ptoTransferAllowed": false,
          "uc07-sourcePtoDays": "18",
          "uc07-seniorityPreservable": "unknown",
        },
      },
      {
        id: "uc07-review",
        turnsOn: "what",
        label: "Review: immigration + PE + PTO risk",
        fails: true,
        fields: {
          // Emma Thompson — GB, employee, active. Story moved FR -> GB with
          // her; the parsed route reads GB → DE and the verdict stays REVIEW.
          "uc07-text": "Relocating our product manager from the United Kingdom to Germany. She can work there, but the immigration assessment isn't done, dates overlap by two weeks, PTO won't transfer, and we're unsure about seniority continuity.",
          "uc07-employmentId": "d73cff71-ced7-4bcf-b764-b9899abc6340",
          "uc07-externalRef": "7003",
          "uc07-salary": "72000",
          "uc07-minimumVisaSalary": "57600",
          "uc07-currency": "EUR",
          "uc07-months": "12",
          "uc07-creationDate": "2026-06-01",
          "uc07-proposedStartDate": "2026-07-01",
          "uc07-destinationStartDate": "2026-07-01",
          "uc07-sourceTerminationDate": "2026-07-15",
          "uc07-sourceLastWorkingDay": "2026-07-14",
          "uc07-originalHireDate": "",
          "uc07-destinationSupported": true,
          "uc07-immigrationSupportRequired": true,
          "uc07-immigrationConfirmed": false,
          "uc07-rightToWorkConfirmed": true,
          "uc07-destinationStartDateConfirmed": true,
          "uc07-sourceExitPlanValidated": true,
          "uc07-employerPresenceInDestination": false,
          "uc07-taxTreatyNexusConfirmed": false,
          "uc07-ptoTransferAllowed": false,
          "uc07-sourcePtoDays": "15",
          "uc07-seniorityPreservable": "unknown",
        },
      },
    ],

    uc08: [
      {
        id: "uc08-dual",
        turnsOn: "what",
        label: "Dual residency: Germany / Spain",
        fields: {
          // Anna Müller — DE, employee, active. One of the two countries in
          // the question is genuinely hers.
          "uc08-text": "I've been splitting my time between Germany and Spain this year and I think I may be a dual resident of both countries for tax purposes. Can you help?",
          "uc08-employmentId": "09b65526-643b-4956-959b-916e6429bd23",
          "uc08-externalRef": "8001",
          "uc08-targetCountry": "",
          "uc08-windowStart": "",
          "uc08-windowEnd": "",
          "uc08-p1-country": "",
          "uc08-p1-startDate": "",
          "uc08-p1-endDate": "",
          "uc08-p2-country": "",
          "uc08-p2-startDate": "",
          "uc08-p2-endDate": "",
        },
      },
      {
        id: "uc08-183",
        turnsOn: "what",
        label: "183-day threshold: UK assignment",
        fields: {
          // João Silva — PT, employee, active. Deliberately NOT one of the two
          // GB people: the question is whether a visitor crosses the UK's
          // 183-day threshold, which only makes sense asked by someone whose
          // own country is not the UK.
          "uc08-text": "I've been asked to work from our London office for a few months. Do we need to withhold UK payroll tax for this?",
          "uc08-employmentId": "378eee6b-c6db-4484-ba32-7283bd0e2de9",
          "uc08-externalRef": "8002",
          "uc08-targetCountry": "GB",
          "uc08-windowStart": "2026-01-01",
          "uc08-windowEnd": "2026-12-31",
          "uc08-p1-country": "GB",
          "uc08-p1-startDate": "2026-03-01",
          "uc08-p1-endDate": "2026-05-31",
          "uc08-p2-country": "",
          "uc08-p2-startDate": "",
          "uc08-p2-endDate": "",
        },
      },
      {
        id: "uc08-a1",
        turnsOn: "what",
        label: "Totalization: A1 certificate",
        fields: {
          // Anna Müller — DE, employee, active. An A1 keeps someone on their
          // HOME country's social security, so the subject needs a home
          // country inside the EU coordination rules; Germany is hers.
          "uc08-text": "We need an A1 certificate of coverage for a short-term assignment to France so the employee stays on home-country social security.",
          "uc08-employmentId": "09b65526-643b-4956-959b-916e6429bd23",
          "uc08-externalRef": "8003",
          "uc08-targetCountry": "",
          "uc08-windowStart": "",
          "uc08-windowEnd": "",
          "uc08-p1-country": "",
          "uc08-p1-startDate": "",
          "uc08-p1-endDate": "",
          "uc08-p2-country": "",
          "uc08-p2-startDate": "",
          "uc08-p2-endDate": "",
        },
      },
      {
        id: "uc08-empty",
        turnsOn: "what",
        label: "No question asked",
        fails: true,
        fields: {
          // Chris Lee — the roster's default active subject. Refused for the
          // empty question before anything about the subject matters.
          "uc08-text": "",
          "uc08-employmentId": "8ab12460-b568-4c1e-af9d-09b1fabd8f46",
          "uc08-externalRef": "8004",
          "uc08-targetCountry": "GB",
          "uc08-windowStart": "2026-01-01",
          "uc08-windowEnd": "2026-12-31",
          "uc08-p1-country": "GB",
          "uc08-p1-startDate": "2026-03-01",
          "uc08-p1-endDate": "",
          "uc08-p2-country": "",
          "uc08-p2-startDate": "",
          "uc08-p2-endDate": "",
        },
      },
    ],

    // UC-09 DOES read the record — status, country schema and salary all feed
    // its gates — so each subject below was RUN through the real gates before
    // being written here, not assumed. Chris Lee reaches
    // `triple_approval_required` on a $5,000 bonus with the same two flags the
    // previous subject produced; Thomas Weber's `archived` status refuses
    // through the same `employment_not_active` branch a `terminated` record
    // did. (`archived` tripping UC-03's gate was not evidence for this one —
    // it is a different gate and was checked separately.)
    uc09: [
      {
        id: "uc09-bonus",
        turnsOn: "what",
        label: "$5,000 performance bonus",
        persona: "admin",
        fields: {
          // Chris Lee — US, employee, active (real Sandbox id).
          "uc09-employmentId": "8ab12460-b568-4c1e-af9d-09b1fabd8f46",
          "uc09-requestText": "Process a $5,000 gross performance bonus for the Q2 cycle",
          "uc09-reasonText": "Annual performance bonus",
          "uc09-externalRef": "9001",
          "uc09-now": "2026-06-20",
        },
      },
      {
        id: "uc09-high",
        turnsOn: "what",
        label: "$15,000 relocation top-up",
        persona: "admin",
        fields: {
          // Chris Lee — US, employee, active.
          "uc09-employmentId": "8ab12460-b568-4c1e-af9d-09b1fabd8f46",
          "uc09-requestText": "Process a $15,000 gross relocation top-up",
          "uc09-reasonText": "Relocation assistance",
          "uc09-externalRef": "9002",
          "uc09-now": "2026-06-20",
        },
      },
      {
        id: "uc09-terminated",
        turnsOn: "who",
        label: "Paying a leaver",
        fails: true,
        persona: "admin",
        fields: {
          // Thomas Weber — DE, employee, ARCHIVED. `archived` is genuinely the
          // Sandbox's status for him, and UC-09's gate tests `!== "active"`,
          // so it refuses through the same branch the old `terminated` fixture
          // did: `escalate / employment_not_active`, flag `inactive_employment`
          // — verified by running the gates, not inferred from UC-03.
          "uc09-employmentId": "9927057d-c8bc-4c71-940d-a5bc4ccf877e",
          "uc09-requestText": "Process a $5,000 final bonus",
          "uc09-reasonText": "Goodwill payment after departure",
          "uc09-externalRef": "9004",
          "uc09-now": "2026-06-20",
        },
      },
      {
        id: "uc09-persona",
        turnsOn: "who",
        label: "Requested by the employee",
        fails: true,
        persona: "chris",
        fields: {
          // Chris Lee asking to be paid himself — his own real Sandbox id, so
          // the refusal reads as "the employee cannot request this", not as a
          // subject nobody recognises. Refused at the persona gate (403).
          "uc09-employmentId": "8ab12460-b568-4c1e-af9d-09b1fabd8f46",
          "uc09-requestText": "Process a $5,000 performance bonus for me",
          "uc09-reasonText": "",
          "uc09-externalRef": "9005",
          "uc09-now": "2026-06-20",
        },
      },
    ],
  };

  // -- access key ------------------------------------------------------------
  //
  // The deployment gates every /api route behind a shared key
  // (src/portal/access.js). NOTHING about that rule lives here: the page holds
  // no key, decides nothing about whether one is needed, and renders only what
  // the server said when it refused. sessionStorage, not localStorage — the key
  // should not outlive the browser session on a shared machine.

  var booted = false;
  var KEY_STORAGE = "portal.accessKey";
  var KEY_HEADER = "X-Portal-Key";

  function storedKey() {
    try {
      return window.sessionStorage.getItem(KEY_STORAGE) || "";
    } catch (err) {
      return ""; // private mode, or storage disabled: ask every time
    }
  }

  function rememberKey(value) {
    try {
      window.sessionStorage.setItem(KEY_STORAGE, value);
    } catch (err) {
      /* nothing to do — the request below still carries it */
    }
  }

  function forgetKey() {
    try {
      window.sessionStorage.removeItem(KEY_STORAGE);
    } catch (err) {
      /* ignore */
    }
  }

  /** Every API call goes through here, so the key can never be forgotten on one. */
  function api(path, options) {
    var opts = options || {};
    var headers = {};
    var key = storedKey();
    if (opts.headers) {
      for (var name in opts.headers) {
        if (Object.prototype.hasOwnProperty.call(opts.headers, name)) headers[name] = opts.headers[name];
      }
    }
    if (key) headers[KEY_HEADER] = key;
    return fetch(path, { method: opts.method || "GET", headers: headers, body: opts.body });
  }

  /**
   * Show the key prompt, in the server's own words.
   *
   * `payload` is the refusal body. The three codes are told apart only to
   * decide whether asking for a key can possibly help: with
   * portal_access_key_not_configured it cannot, because the server has none to
   * match, so the form is hidden rather than inviting an endless retry.
   */
  function showAccessGate(payload) {
    var gate = byId("access-gate");
    var configured = payload.code !== "portal_access_key_not_configured";

    byId("access-reason").textContent = payload.reason || "This portal requires an access key.";
    byId("access-why").textContent = payload.why || "";

    var howto = byId("access-howto");
    clear(howto);
    (payload.howToFix || []).forEach(function (step) {
      howto.appendChild(el("li", "", String(step)));
    });

    byId("access-form").hidden = !configured;
    gate.hidden = false;
    if (configured) byId("access-key").focus();
  }

  function hideAccessGate() {
    byId("access-gate").hidden = true;
  }

  function wireAccessForm() {
    byId("access-form").addEventListener("submit", function (event) {
      event.preventDefault();
      var value = byId("access-key").value.trim();
      if (!value) return;
      rememberKey(value);
      byId("access-key").value = "";
      hideAccessGate();
      // Already-booted page: the forms are wired and the key is all that was
      // missing. Booting again would attach a SECOND submit listener to every
      // form and post each submission twice — on a page whose whole purpose is
      // writing records, that is not a cosmetic bug.
      if (!booted) boot();
    });
  }

  // -- boot ------------------------------------------------------------------

  function boot() {
    api("api/context")
      .then(function (res) {
        if (res.status === 401) {
          return res.json().then(function (payload) {
            // A key that was accepted before and is refused now is a changed
            // key, not a changed rule: drop it so the prompt starts empty.
            forgetKey();
            showAccessGate(payload || {});
            return null;
          });
        }
        if (!res.ok) throw new Error("HTTP " + res.status);
        return res.json();
      })
      .then(function (data) {
        if (!data) return; // the access gate is showing
        hideAccessGate();
        booted = true;
        context = data;
        renderNav(data.requestTypes || []);
        applyDescriptions(data.requestTypes || []);
        renderPersonas(data.personas || [], data.defaultPersonaId);
        renderExpenses(data.expenses || []);
        // BEFORE anything that writes a value into a form. A <select> refuses
        // a value it has no option for, so a quick-fill or a continuation
        // prefill that ran first would silently land on "".
        renderCountrySelects(data.countries || [], data.demoCountries || []);
        wireForms();
        upgradeReferenceFields(data.requestTypes || []);
        markRequiredFields();
        attachCounters();
        renderScenarios();
        renderHomeTiles(data.requestTypes || []);
        wireHomeLinks();
        wireReceiptUpload();
        showHome();
        startConsentBadgePolling();
      })
      .catch(function (err) {
        byId("boot-error").hidden = false;
        byId("boot-error-body").textContent =
          "GET api/context failed: " + err.message + ". Start the portal with `npm run portal`, or check /__cx/health on the deployment.";
      });
  }

  /**
   * The home view's tile grid — one tile per request type, same data
   * renderNav() reads, so the seven descriptions still exist in exactly one
   * place server-side (requestTypes.js). Clicking a tile does exactly what
   * clicking its sidebar nav row does.
   */
  function renderHomeTiles(types) {
    var grid = byId("home-tiles");
    clear(grid);
    types.forEach(function (type) {
      var tile = el("button", "home-tile");
      tile.type = "button";
      var icon = el("span", "r-tile", type.icon || "");
      icon.setAttribute("aria-hidden", "true");
      var body = el("div", "home-tile-body");
      body.appendChild(el("p", "home-tile-title", type.title));
      body.appendChild(el("p", "home-tile-desc", type.description));
      // THE BADGE SAYS THE RISK WORD AND STOPS. It used to read "Medium risk ·
      // UC-04". "UC-04" is this repo's own name for a use case and names
      // nothing the reader has ever seen; the risk word is the half that means
      // something to them. The code still travels on every payload
      // (`type.useCase`) and is still printed where an id is what is wanted —
      // the result panel's header and the "My requests" table.
      var tier = el("span", "r-tier r-tier-" + type.tier, TIER_WORD[type.tier] || type.tier);
      body.appendChild(tier);
      tile.appendChild(icon);
      tile.appendChild(body);
      tile.addEventListener("click", function () {
        activate(type.id);
      });
      grid.appendChild(tile);
    });
  }

  /** Show the home view: every use-case card hidden, no sidebar row active. */
  function showHome() {
    clearContinuation(); // same rule as activate(): leaving drops the link
    activeType = null;
    var cards = document.querySelectorAll(".uc-card");
    for (var i = 0; i < cards.length; i += 1) cards[i].hidden = true;
    byId("card-my-requests").hidden = true;
    byId("card-consent-requests").hidden = true;
    stopPolling(); // leaving the panel stops the asking — see startPolling()
    stopConsentPolling();
    byId("home-panel").hidden = false;
    var items = document.querySelectorAll(".r-nav-item");
    for (var j = 0; j < items.length; j += 1) {
      items[j].classList.remove("is-active");
      items[j].removeAttribute("aria-current");
    }
  }

  function wireHomeLinks() {
    byId("home-link").addEventListener("click", showHome);
    var links = document.querySelectorAll("[data-home-link]");
    for (var i = 0; i < links.length; i += 1) links[i].addEventListener("click", showHome);
    // Re-reads every record's CURRENT state right now, without waiting for the
    // next poll. Kept alongside the automatic refresh rather than replaced by
    // it: a tester who has just clicked Approve in the sidebar wants the answer
    // immediately, not in up to four seconds.
    byId("my-requests-refresh").addEventListener("click", function () {
      loadMyRequests();
    });
    byId("my-requests-live").addEventListener("click", function () {
      setLive(!liveWanted);
    });
    byId("consent-requests-refresh").addEventListener("click", function () {
      loadConsentRequests();
    });
    byId("consent-requests-live").addEventListener("click", function () {
      setConsentLive(!consentLiveWanted);
    });
    // R7-17's home banner is the same nudge as the sidebar badge, just louder
    // — clicking it goes to exactly where the badge already points.
    var bannerAction = byId("consent-badge-banner-action");
    if (bannerAction) bannerAction.addEventListener("click", showConsentRequests);
  }

  /** The sidebar, grouped by tier — built from the server's list, never a copy. */
  function renderNav(types) {
    var nav = byId("request-nav");
    clear(nav);

    TIER_GROUPS.forEach(function (tier) {
      var inTier = types.filter(function (t) {
        return t.tier === tier;
      });
      if (!inTier.length) return;

      nav.appendChild(el("div", "r-nav-label", TIER_WORD[tier] || tier));

      inTier.forEach(function (type) {
        var button = el("button", "r-nav-item");
        button.type = "button";
        button.id = "nav-" + type.id;
        // The icon, not "UC-04". The slot is the same one "My requests" below
        // already fills with an emoji, so this is the nav's existing shape
        // rather than a new one.
        var mark = el("span", "nav-code", type.icon || "");
        mark.setAttribute("aria-hidden", "true");
        button.appendChild(mark);
        // The label a requester reads, and — under it — the use-case code.
        // The code came OFF the badge and the blurb deliberately (nobody asking
        // to work abroad knows what "UC-04" means), but the nav is the one place
        // it earns its keep: this is the builder's own navigation surface, and
        // the codes are how the specs, the tests and the audit rows are named.
        // Dimmed and aria-hidden, so it is a landmark for whoever knows it and
        // invisible to a screen reader reading the list of request types.
        var text = el("span", "nav-text", type.label);
        if (type.useCase) {
          var code = el("span", "nav-subcode", type.useCase);
          code.setAttribute("aria-hidden", "true");
          text.appendChild(code);
        }
        button.appendChild(text);
        button.addEventListener("click", function () {
          activate(type.id);
        });
        nav.appendChild(button);
      });
    });

    // "My requests" sits in its own group under the seven request types, and
    // NOT inside a tier: it is not a request type, it has no tier, and putting
    // it in one would be the page inventing a fact about it. It is built here
    // rather than in index.html for the same reason the seven above are — the
    // nav has exactly one builder.
    nav.appendChild(el("div", "r-nav-label", "Status"));
    var mine = el("button", "r-nav-item");
    mine.type = "button";
    mine.id = "nav-my-requests";
    mine.appendChild(el("span", "nav-code", "\u{1F4CB}"));
    mine.appendChild(el("span", "nav-text", "My requests"));
    mine.addEventListener("click", showMyRequests);
    nav.appendChild(mine);

    // F-2/L-13: the employee's own consent surface — see showConsentRequests()
    // below. Same "own group under Status, not a tier" reasoning as "My
    // requests" above: it is not a request type either.
    var consent = el("button", "r-nav-item");
    consent.type = "button";
    consent.id = "nav-consent-requests";
    consent.appendChild(el("span", "nav-code", "\u{1F50F}"));
    consent.appendChild(el("span", "nav-text", "Consent requests"));
    // R7-17: the count, not just the tab. The sidebar is the one piece of
    // markup present on EVERY view — home, a use-case form, "My requests" —
    // so a badge here is the fix for all three surfaces the finding named,
    // with no new "check every page" logic. Hidden until refreshConsentBadge()
    // reports a pending count above zero for the CURRENT persona.
    var consentBadge = el("span", "nav-badge", "");
    consentBadge.id = "nav-consent-badge";
    consentBadge.hidden = true;
    consent.appendChild(consentBadge);
    consent.addEventListener("click", showConsentRequests);
    nav.appendChild(consent);
  }

  /**
   * Fill each card's [data-field] placeholders from the server's description of
   * that request type. Nothing on the page carries its own copy of a tier word,
   * a description or a humanControl sentence.
   */
  function applyDescriptions(types) {
    types.forEach(function (type) {
      var card = byId("card-" + type.id);
      if (!card) return;

      var nodes = card.querySelectorAll("[data-field]");
      for (var i = 0; i < nodes.length; i += 1) {
        var node = nodes[i];
        var field = node.getAttribute("data-field");
        if (field === "tier") {
          node.className = "r-tier r-tier-" + type.tier;
          // The WORD, always — the dot is decorative. And the word ONLY: see
          // renderHomeTiles() for why the use-case code came off this badge.
          node.textContent = TIER_WORD[type.tier] || type.tier;
        } else {
          node.textContent = type[field] === undefined || type[field] === null ? "" : String(type[field]);
        }
      }
    });
  }

  function renderPersonas(personas, defaultPersonaId) {
    var select = byId("persona");
    clear(select);
    personas.forEach(function (persona) {
      // `engagement` is the RECORD's own contract type, read through the same
      // gate the letter uses (labelledPersonas() in server.js). `kind` is the
      // session role and is only worth printing for the one persona who is not
      // an employee — printing it for everybody is what made the picker read
      // "Carlos Silva — employee" about a contractor.
      //
      // Absent means the engagement could not be read, and an unread record is
      // captioned with NOTHING rather than with a guess. A name on its own is
      // an honest label; a wrong one is not.
      var label = persona.kind === "company_admin"
        ? persona.kind.replace(/_/g, " ")
        : (persona.engagement || null);
      var option = el("option", null, label ? persona.name + " — " + label : persona.name);
      option.value = persona.id;
      select.appendChild(option);
    });
    // R7-42 / D-02: a <select> with no default falls back to whichever option
    // is first in DOM order, which is an accident of the server's map, not a
    // choice about who "signed in". Set it explicitly to the server-named
    // default (falling back to whatever the browser already picked if the
    // server didn't send one, or didn't offer that persona) so the page never
    // silently issues a letter naming the wrong person on a first click.
    var offersDefault = personas.some(function (p) {
      return p.id === defaultPersonaId;
    });
    if (defaultPersonaId && offersDefault) {
      select.value = defaultPersonaId;
    }
    select.addEventListener("change", renderPersonaNote);
    // R7-17: switching who this page acts as must switch whose consent
    // requests the badge counts — otherwise it would keep showing the
    // PREVIOUS persona's count after "Signed in as" changes, which is worse
    // than showing nothing at all.
    select.addEventListener("change", refreshConsentBadge);
    renderPersonaNote();
  }

  /**
   * One persona out of the roster the SERVER sent, by key.
   *
   * Null for a key the server did not offer, so every caller states a name this
   * page was given rather than one it composed — the same rule
   * personaNameForEmployment() follows for the other direction.
   */
  function personaById(id) {
    if (!id) return null;
    return (
      ((context && context.personas) || []).filter(function (p) {
        return p.id === id;
      })[0] || null
    );
  }

  function renderPersonaNote() {
    var current = personaById(byId("persona").value);
    byId("persona-note").textContent = current ? current.note : "";
  }

  function renderExpenses(expenses) {
    var select = byId("uc02-expenseId");
    clear(select);
    if (!expenses.length) {
      var none = el("option", null, "no expenses could be read from Remote");
      none.value = "";
      select.appendChild(none);
      return;
    }
    expenses.forEach(function (expense) {
      var option = el(
        "option",
        null,
        expense.title + " — " + expense.amount + " " + expense.currency + " (" + expense.id + ")"
      );
      option.value = expense.id;
      select.appendChild(option);
    });
  }

  /**
   * Every country box on this page, filled from the ONE list the server owns.
   *
   * WHAT THE OPTIONS ARE. `value` is the ISO alpha-2 code — the exact string
   * `SANCTIONED_OR_RESTRICTED.has()`, `SCHENGEN.has()` and the presence-day
   * calculator compare — and the visible label is the country's name, because
   * a person picks Spain and a Set reads "ES". That pairing is the whole point
   * of the change: it is no longer possible to submit a country code this
   * system cannot recognise, which is where every alpha-2/alpha-3 defect in
   * this repo's history entered (src/portal/countries.js's header lists them).
   *
   * WHY A <select> AND NOT AN <input list=...> DATALIST. A datalist is a
   * suggestion: the input still accepts anything typed past it, so "Spain",
   * "ESP" and "es" all still reach the server and the failure mode survives
   * the fix. A select can only emit a value it was given. 249 options is a
   * long menu, which is why the four demo countries are repeated in a group at
   * the top — but length is a usability cost, and a free-text box is a
   * correctness one.
   *
   * WHY THE DEMO FOUR APPEAR TWICE. Once at the top for reach, once in their
   * alphabetical place so somebody scrolling to "N" still finds the
   * Netherlands where it belongs. Same value either way; a duplicate option is
   * a shortcut, not a second country.
   *
   * NO POLICY IS EXPRESSED HERE. The list is not filtered by what UC-04's risk
   * matrix knows, by Remote's supported-country registry, or by any sanctions
   * set. A destination with no rule written for it is UNEVALUATED, not
   * cleared, and picking one is meant to produce an honest escalation — a
   * picker that quietly withheld those countries would hide a real behaviour
   * of this system while leaving it in the code.
   */
  function renderCountrySelects(countries, demoCodes) {
    var nameOf = {};
    countries.forEach(function (country) {
      nameOf[country.code] = country.name;
    });
    var demo = (demoCodes || []).filter(function (code) {
      return nameOf[code];
    });

    var nodes = document.querySelectorAll("[data-country-select]");
    for (var i = 0; i < nodes.length; i++) {
      var select = nodes[i];
      clear(select);

      // The empty first option, worded by the field itself (data-blank). It
      // MUST stay selectable and MUST stay empty: an untouched picker submits
      // "" exactly as the untouched text box did, which is what keeps "blank
      // means unknown, never a confirmed zero" true of the prior-stay rows.
      var blank = el("option", null, select.getAttribute("data-blank") || "not stated");
      blank.value = "";
      select.appendChild(blank);

      if (demo.length) {
        var top = document.createElement("optgroup");
        top.label = "Used in this demo";
        demo.forEach(function (code) {
          top.appendChild(countryOption(code, nameOf[code]));
        });
        select.appendChild(top);
      }

      var all = document.createElement("optgroup");
      all.label = "All countries";
      countries.forEach(function (country) {
        all.appendChild(countryOption(country.code, country.name));
      });
      select.appendChild(all);
    }
  }

  function countryOption(code, name) {
    var option = el("option", null, name);
    option.value = code;
    return option;
  }

  /**
   * Write a value into a form field — and never lose one to a picker.
   *
   * A <select> given a value it has no option for does not throw and does not
   * keep it: it lands on "" and reports success. So a scenario quick-fill or a
   * continuation prefill naming a country this list does not carry would
   * silently submit "no country stated" instead, and the refusal that came
   * back would name the wrong thing entirely. This appends the unknown value
   * as its own option, labelled as unknown, so the code the server sent is the
   * code the form shows and the code it submits. The check is the assignment
   * itself, so nothing here needs to know which fields are pickers.
   */
  /**
   * Empty every box on one form, so whatever fills it next starts from nothing.
   *
   * THE INVARIANT THIS EXISTS TO MAKE TRUE: after any prefill — a quick-fill or
   * a UC-03 continuation — no repeating row may be left HALF populated. Either
   * a row is wholly filled or it is wholly empty.
   *
   * THE DEFECT THAT NAMED IT. A traveller continued a routing into the work
   * authorization form and was refused `travel_history_unreadable` — "prior
   * stay 1: start date missing, end date missing; prior stay 2: start date
   * missing, end date missing". The refusal is correct and it is the good kind:
   * buildTravelHistory() names an unreadable row rather than dropping it,
   * because computeCumulativeDays() answers NaN for a stay it cannot read and
   * NaN loses every threshold comparison silently, so one bad row would CLEAR a
   * traveller the same history would otherwise block. The rows should never
   * have looked like that. The continuation carries exactly five fields
   * (CARRIED_FIELDS in src/portal/uc03Continuation.js) and touched nothing
   * else, so anything an earlier interaction had left in the two prior-stay
   * rows survived underneath it — including a country picked on its own, with
   * no dates beside it.
   *
   * Driven in a real browser before this was written, the whole-row case
   * reproduces exactly: click the "Two counts, two answers" quick-fill, walk to
   * UC-03, submit a workation, continue it — and both Spanish stays are still
   * sitting in the form, silently counted into a decision about Portugal that
   * nobody stated them for. The half-row case is the same leak with one of the
   * three boxes touched.
   *
   * WHY CLEARING, RATHER THAN NAMING EVERY FIELD IN THE PREFILL. The
   * alternative is to have the continuation state a value for all eighteen
   * boxes, the way the quick-fills do. That is more code and, worse, it is a
   * SECOND COPY of the form's field list living in a file the form does not
   * import: add a box next year and the copy silently keeps a stale value in
   * it, which is a failure with no symptom. This derives the field list FROM
   * the form, so a box added later is covered by the box existing. The cost is
   * that a prefill discards anything already typed into that form — which is
   * right for both callers: a quick-fill means "this whole scenario", and a
   * continuation is the START of an assessment about a trip the admin has not
   * seen before.
   *
   * TWO KINDS OF CONTROL ARE DELIBERATELY LEFT ALONE. Radios, because the only
   * ones here are the reference control's new/reuse pair and blanking them
   * would leave the form in neither mode (syncRefField below re-reads it).
   * Nothing outside the <form> is touched at all, so the persona picker — which
   * applyContinuation() moves on purpose — is not this function's business.
   */
  function blankForm(typeId) {
    var form = byId("form-" + typeId);
    if (!form) return;
    var nodes = form.querySelectorAll("input, select, textarea");
    for (var i = 0; i < nodes.length; i += 1) {
      var node = nodes[i];
      if (node.type === "radio") continue;
      if (node.type === "checkbox") node.checked = false;
      else node.value = "";
    }
    syncRefField(typeId);
  }

  function setFieldValue(node, raw) {
    var next = raw === null || raw === undefined ? "" : String(raw);
    node.value = next;
    if (next !== "" && node.value !== next) {
      var option = el("option", null, next + " — not on this list");
      option.value = next;
      node.appendChild(option);
      node.value = next;
    }

    // SETTING `.value` FIRES NOTHING, and two things on this page listen.
    // Visible on camera as a textarea holding 48 characters above a counter
    // still reading "0/500" — the counter (attachCounters) and the
    // continuation's gap marks (markGaps) both bind to `input`, and a
    // quick-fill is the one way a box changes without a keystroke.
    //
    // Dispatched rather than each listener being called by hand, because the
    // list of things that care is not this function's business to know, and a
    // listener added later would silently not be told. Both current listeners
    // are guarded, idempotent refreshes, so hearing this is exactly right for
    // them: a filled gap box SHOULD stop being marked as a gap.
    node.dispatchEvent(new Event("input", { bubbles: true }));
    node.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function renderScenarios() {
    Object.keys(SCENARIOS).forEach(function (typeId) {
      var row = document.querySelector('[data-scenarios="' + typeId + '"]');
      if (!row) return;
      clear(row);

      // ONE note per row, rewritten by whichever quick-fill was clicked last.
      // It exists because of two things a person reported in the same minute:
      // they could not tell WHICH scenario was currently loaded (the buttons
      // all looked the same after clicking), and they read a deliberately
      // empty box as "the quick-fill did not work". A scenario that leaves a
      // field blank ON PURPOSE and one that forgot look identical on the form,
      // so the ones that do it say so here, in their own words.
      var note = el("p", "scenario-note");
      note.hidden = true;
      if (row.parentNode) row.parentNode.appendChild(note);

      var buttons = [];
      SCENARIOS[typeId].forEach(function (scenario) {
        var button = el("button", "r-btn r-btn-secondary r-btn-sm" + (scenario.fails ? " scenario-fails" : ""));
        button.type = "button";
        button.id = "fill-" + scenario.id;
        button.setAttribute("aria-pressed", "false");
        button.appendChild(document.createTextNode(scenario.label));
        if (scenario.fails) button.appendChild(el("span", "fails-mark", "refused"));
        button.addEventListener("click", function () {
          var movedFrom = applyScenario(typeId, scenario);
          buttons.forEach(function (other) {
            other.className = other.className.split(" is-chosen").join("");
            other.setAttribute("aria-pressed", "false");
          });
          button.className += " is-chosen";
          button.setAttribute("aria-pressed", "true");
          showScenarioNote(note, scenario, movedFrom);
        });
        buttons.push(button);
        row.appendChild(button);
      });
    });
  }

  /**
   * What the form now holds, and why anything on it is empty.
   *
   * The name is always printed, because "which one did I click" was the first
   * question. `scenario.note` is optional and is only written where a blank is
   * DELIBERATE — a field this scenario chose not to state, for a reason a
   * reader can check against the result. It is prose, not a mechanism: nothing
   * reads it, and a scenario without one behaves identically.
   */
  function showScenarioNote(note, scenario, movedFrom) {
    clear(note);
    note.appendChild(document.createTextNode("Filled in from \u201c" + scenario.label + "\u201d."));
    if (scenario.note) note.appendChild(document.createTextNode(" " + scenario.note));

    // THE SESSION MOVED, AND THE READER IS TOLD SO BY US.
    //
    // THE REPORT: "how do i start as chris lee and end up as admin?" Several of
    // these quick-fills carry a `persona`, because who is asking is half of what
    // they demonstrate — two UC-04 scenarios differ ONLY in the traveller, and
    // one exists to show an employee being refused a form their own admin files.
    // Every one of those switches was silent: the picker in the sidebar changed
    // under the reader, and the only way to notice was to look at it.
    //
    // A PERSON WHO HAS BEEN SILENTLY SWAPPED DOES NOT TRUST THE SCREEN. That is
    // the same finding continuationOffer's own notice was written for, one step
    // earlier in the same journey, and the same sentence is owed here: the
    // continuation warns before the redirect, and this warns after the click,
    // because a quick-fill has no "before" to warn on.
    //
    // BOTH NAMES, because "you are now X" leaves the reader working out whether
    // that is a change at all. Null when nothing moved, so a quick-fill that
    // keeps the reader as themselves says nothing — this line appears exactly
    // when something happened.
    var movedTo = personaById(byId("persona").value);
    var movedFromPersona = personaById(movedFrom);
    if (movedTo && movedFromPersona) {
      note.appendChild(
        el(
          "span",
          "scenario-session-moved",
          " Signed in as " + movedTo.name + " now, not " + movedFromPersona.name + " \u2014 this request is filed by them."
        )
      );
    }
    // WHICH KIND OF DEMONSTRATION THIS IS — see `turnsOn` in SCENARIOS. Written
    // as a sentence to the person clicking, because "you are not eligible" and
    // "what you asked for needs a person" are different things to be told and a
    // reader who cannot tell them apart will read the first as the second.
    // Silent for a scenario that does not say, so nothing is invented.
    if (TURNS_ON[scenario.turnsOn]) {
      note.appendChild(el("span", "scenario-turns-on", " " + TURNS_ON[scenario.turnsOn]));
    }
    note.hidden = false;
  }

  var TURNS_ON = {
    who: "The answer here depends on WHO is asking \u2014 change the person in the sidebar and the same request comes back differently, because of something on that person\u2019s own record.",
    what: "The answer here depends on WHAT is asked, not on who is asking \u2014 anyone sending this gets the same answer.",
  };

  function applyScenario(typeId, scenario) {
    // EVERY BOX FIRST, then this scenario's own values. Each quick-fill already
    // names every key its type uses — test/portalCopy.test.js pins that as an
    // EQUALITY across a type's scenarios, not a superset — and this makes the
    // same invariant structural rather than remembered: a key added to one
    // scenario and forgotten in the others can no longer leave a stale value
    // behind. See blankForm().
    blankForm(typeId);

    // A QUICK-FILL IS A WHOLE OTHER REQUEST, SO THE LINK CANNOT SURVIVE IT.
    //
    // THE REPORT, and it is the refusal a tester actually hit: an employee
    // continued his own travel request, landed here, could not tell what to
    // type, and pressed a quick-fill to find out. The quick-fill wrote its own
    // traveller into `uc04-employmentId` — a DIFFERENT person, which is the
    // entire point of the two scenarios that vary only by who is asking — while
    // `pendingContinuation` went on naming the first employee's UC-03 case. The
    // server refused it `continuation_subject_mismatch` (403), correctly: a
    // work-authorization record must not point at somebody else's trip.
    //
    // THE REFUSAL WAS RIGHT AND THE STATE WAS OURS. Nobody chose to file
    // Amanda's trip against Chris's travel request; a button did it, and the
    // banner over the form went on saying "Continued from Chris Lee's travel
    // request" while every box under it described someone else. That is
    // clearCarriedMarks()'s sibling failure and clearContinuation()'s own header
    // already argues this exact case for the other trigger — leaving one form
    // and coming back — without ever being wired to this one. Not relying on
    // somebody else's gate to cover our own state, in its words.
    //
    // UNCONDITIONAL, not `typeId === "uc04"`. activate() already drops the link
    // when the reader leaves for another type; what is new here is that a
    // quick-fill states a complete request of its own — its traveller, its
    // destination, its dates — so whichever form it lands on, it is no longer
    // the trip the continuation was about.
    clearContinuation();

    var wasSignedInAs = byId("persona").value;
    if (scenario.persona) {
      byId("persona").value = scenario.persona;
      renderPersonaNote();
    }
    Object.keys(scenario.fields).forEach(function (id) {
      var node = byId(id);
      if (!node) return;
      if (node.type === "checkbox") node.checked = Boolean(scenario.fields[id]);
      else setFieldValue(node, scenario.fields[id]);
      // A quick-fill that silently changes values inside a COLLAPSED
      // "fill in the fields yourself" panel would have the user submit
      // something they never saw. Open the disclosure around any field this
      // scenario touched, so what is about to be sent is on screen.
      var disclosure = node.closest ? node.closest(".manual-fields") : null;
      if (disclosure) disclosure.open = true;

      // A scenario that fills a REFERENCE means that reference, so switch the
      // form to reuse mode and reveal the box. Otherwise the fill would be
      // silently discarded in favour of a generated ref, and clicking the same
      // scenario twice — which is how several of them demonstrate the
      // duplicate-delivery refusal — would stop demonstrating anything.
      if (/-externalRef$/.test(id) && scenario.fields[id]) {
        setRefMode(id.replace("-externalRef", ""), "reuse");
      }
    });

    // Assigning `.value` from script fires neither `input` nor `change`, so the
    // per-box listeners installed by markGaps() never hear a quick-fill. Without
    // this, a scenario that filled a box a continuation was asking for would
    // leave "(still needed)" sitting on a box that now has a value in it.
    refreshGapMarks();

    // WHO WAS SIGNED IN BEFORE THIS BUTTON WAS PRESSED, returned rather than
    // stored: SCENARIOS is a constant, and hanging a field off the scenario the
    // reader clicked would leave one click's state on it for the next one. Null
    // when the session did not move, so the caller has nothing to announce.
    return byId("persona").value === wasSignedInAs ? null : wasSignedInAs;
  }

  /**
   * Put the design system's required marker on every field REQUIRED_FIELDS
   * names. The asterisk alone is not self-describing, so it is hidden from the
   * accessibility tree and the word "required" is added beside it — a screen
   * reader hears the label and the word, a sighted reader sees the label and
   * the mark, and neither is asked to decode a bare "*".
   */
  function markRequiredFields() {
    REQUIRED_FIELDS.forEach(function (id) {
      var field = byId(id);
      if (!field || !field.closest) return;
      var wrapper = field.closest(".r-field");
      var label = wrapper ? wrapper.querySelector(".r-label") : null;
      if (!label || label.querySelector(".r-req")) return;

      var mark = el("span", "r-req", "*");
      mark.setAttribute("aria-hidden", "true");
      var word = el("span", "r-sr-only", "required");

      // Before the parenthetical hint when there is one, so the marker sits
      // against the label it qualifies rather than after an aside.
      var hint = label.querySelector(".r-hint");
      if (hint) {
        // The markup indents the hint onto its own line, leaving a run of
        // whitespace the marker would otherwise float away from its label on.
        var before = hint.previousSibling;
        if (before && before.nodeType === 3) before.textContent = before.textContent.replace(/\s+$/, "");
        label.insertBefore(mark, hint);
        label.insertBefore(word, hint);
        label.insertBefore(document.createTextNode(" "), hint);
      } else {
        label.appendChild(mark);
        label.appendChild(word);
      }
    });
  }

  /**
   * The "0/255"-style counter Remote shows under a bounded field, wired to
   * every textarea that DECLARES a maxlength — and to no others. The number on
   * the right is a limit the browser will actually enforce; a limit invented
   * here for a field that has none would be a promise nothing keeps, and
   * silently capping what someone typed into a support request is worse than
   * showing no counter at all. No textarea on this page declares one today, so
   * this wires nothing until the markup says otherwise.
   */
  function attachCounters() {
    var areas = document.querySelectorAll("textarea");
    for (var i = 0; i < areas.length; i += 1) {
      (function (area) {
        var max = Number(area.getAttribute("maxlength"));
        if (!max || max <= 0) return;
        var counter = el("span", "r-counter");
        var update = function () {
          counter.textContent = String(area.value.length) + "/" + String(max);
        };
        area.addEventListener("input", update);
        update();
        area.parentNode.insertBefore(counter, area.nextSibling);
      })(areas[i]);
    }
  }

  /**
   * UC-02's receipt upload. This demo runs no OCR — nothing here invents a
   * merchant name, an amount, or a category from the file's contents, which
   * would misrepresent what the gates actually did. What it CAN honestly do
   * is hash the file's real bytes with the browser's own crypto, so the
   * duplicate-receipt gate is comparing something genuine: upload the same
   * file twice and it really is the same hash, not a fabricated one that
   * happens to always differ. The hash field stays a normal, editable text
   * input either way — uploading is one way to fill it, typing is the other,
   * and neither is disabled by the presence of the other.
   */
  function wireReceiptUpload() {
    var input = byId("uc02-receiptFile");
    if (!input) return;
    var nameEl = byId("uc02-receiptFileName");
    var hashEl = byId("uc02-receiptHash");
    input.addEventListener("change", function () {
      var file = input.files && input.files[0];
      if (!file) {
        nameEl.textContent = "";
        return;
      }
      nameEl.textContent = file.name + " (" + Math.round(file.size / 1024) + " KB) — hashing…";
      if (!(window.crypto && window.crypto.subtle)) {
        nameEl.textContent = file.name + " — this browser has no crypto.subtle; type a hash below instead";
        return;
      }
      file
        .arrayBuffer()
        .then(function (buf) {
          return window.crypto.subtle.digest("SHA-256", buf);
        })
        .then(function (digest) {
          var bytes = new Uint8Array(digest);
          var hex = "";
          for (var i = 0; i < bytes.length; i += 1) hex += bytes[i].toString(16).padStart(2, "0");
          hashEl.value = hex.slice(0, 16); // matches the seeded hash-seed-NNN length this demo's fixtures use
          nameEl.textContent = file.name + " (" + Math.round(file.size / 1024) + " KB) — hash filled in below";
        })
        .catch(function (err) {
          nameEl.textContent = file.name + " — could not hash it (" + err.message + "); type one below instead";
        });
    });
  }

  function wireForms() {
    Object.keys(BUILDERS).forEach(function (typeId) {
      var form = byId("form-" + typeId);
      if (!form) return;
      form.addEventListener("submit", function (ev) {
        ev.preventDefault();
        submit(typeId, form);
      });
    });
  }

  function activate(typeId) {
    // MOVING ANYWHERE THAT IS NOT UC-04 DROPS THE LINK. applyContinuation()
    // sets `pendingContinuation` and then calls this with "uc04", so the one
    // navigation that keeps it is the one that made it.
    if (typeId !== "uc04") clearContinuation();
    activeType = typeId;
    byId("home-panel").hidden = true;
    byId("card-my-requests").hidden = true;
    byId("card-consent-requests").hidden = true;
    stopPolling();
    stopConsentPolling();
    var cards = document.querySelectorAll(".uc-card");
    for (var i = 0; i < cards.length; i += 1) {
      cards[i].hidden = cards[i].getAttribute("data-type") !== typeId;
    }
    var items = document.querySelectorAll(".r-nav-item");
    for (var j = 0; j < items.length; j += 1) {
      var isActive = items[j].id === "nav-" + typeId;
      items[j].classList.toggle("is-active", isActive);
      if (isActive) items[j].setAttribute("aria-current", "page");
      else items[j].removeAttribute("aria-current");
    }
  }

  // -- "My requests": read-only status ---------------------------------------
  //
  // WHAT THIS RENDERS, AND WHAT IT DELIBERATELY DOES NOT.
  // It renders the server's answer verbatim — every label, every sentence and
  // every state name comes from src/portal/requestStatus.js, which is where
  // the seven stores' different vocabularies are translated into one. This
  // file adds NO control that could decide anything: there is no approve
  // button here, no decline, no hold, and there must never be one. The portal's
  // own copy explains why and it is still true — a second place to decide is a
  // second, unaudited place to decide. Approvals happen in the ZAF sidebar and
  // each use case's own approval endpoint, behind a signed approver identity
  // this page has no way to present.
  //
  // textContent only, no innerHTML, and no re-derived policy: the badge class
  // is picked off the server's own `state` string rather than by this file
  // deciding what "decided" means.

  // POLLING, and why it is polling rather than a promise of "instant".
  //
  // A decision is made somewhere else entirely — the ZAF sidebar, or a use
  // case's own approval endpoint — so this page has no way to be told when one
  // happens. It asks. Every POLL_MS the whole list is re-read and re-rendered,
  // which is what makes a state change appear without the user touching
  // anything. The page says so in its own copy rather than implying a push: a
  // few seconds of lag is expected and stating it is cheaper than a user
  // deciding the feature is broken.
  //
  // Same shape as src/auditview/assets/app.js's feed: one interval, a visible
  // Live/Paused control, and the timer cleared the moment the panel is hidden —
  // a portal left open on another tab must not keep asking forever.
  var POLL_MS = 4000;
  var pollTimer = null;
  var liveWanted = true;

  function showMyRequests() {
    clearContinuation(); // same rule as activate(): leaving drops the link
    activeType = null;
    byId("home-panel").hidden = true;
    var cards = document.querySelectorAll(".uc-card");
    for (var i = 0; i < cards.length; i += 1) cards[i].hidden = true;
    var items = document.querySelectorAll(".r-nav-item");
    for (var j = 0; j < items.length; j += 1) {
      items[j].classList.remove("is-active");
      items[j].removeAttribute("aria-current");
    }
    byId("card-consent-requests").hidden = true;
    stopConsentPolling();
    byId("card-my-requests").hidden = false;
    loadMyRequests();
    startPolling();
  }

  function startPolling() {
    stopPolling();
    renderLiveToggle();
    if (!liveWanted) return;
    pollTimer = setInterval(function () {
      // Only while the panel is actually on screen. Polling a hidden panel
      // spends the server's time to update something nobody is looking at.
      if (byId("card-my-requests").hidden) return stopPolling();
      loadMyRequests({ quiet: true });
    }, POLL_MS);
  }

  function stopPolling() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = null;
  }

  function setLive(on) {
    liveWanted = on;
    if (on) startPolling();
    else {
      stopPolling();
      renderLiveToggle();
    }
  }

  function renderLiveToggle() {
    var toggle = byId("my-requests-live");
    if (!toggle) return;
    toggle.classList.toggle("is-paused", !liveWanted);
    toggle.setAttribute("aria-pressed", liveWanted ? "true" : "false");
    toggle.textContent = liveWanted ? "Live — checking every " + POLL_MS / 1000 + "s" : "Paused";
  }

  function loadMyRequests(opts) {
    var quiet = Boolean(opts && opts.quiet);
    var rows = byId("my-requests-rows");
    // A poll must not blank the table it is refreshing: emptying rendered rows
    // four times a minute makes a live view unreadable and steals focus from
    // anything inside it. Only an explicit load says so, and it says so in the
    // note line rather than by destroying the table — the header row staying
    // put is what stops the card collapsing and jumping the page.
    if (!quiet) {
      clear(rows);
      setMyRequestsNote("Reading each record's current state…");
    }

    api("api/my-requests?persona=" + encodeURIComponent(byId("persona").value))
      .then(function (res) {
        return res.json();
      })
      .then(function (payload) {
        byId("my-requests-boundary").textContent = payload.note || "";
        byId("my-requests-scope").textContent = payload.scope || "";
        // The server's own sentence, or nothing at all. An empty line left
        // permanently on screen reads as a heading for a section that is not
        // there, so the element is hidden rather than blanked.
        var decided = payload.decided || {};
        var banner = byId("my-requests-decided");
        banner.textContent = decided.summary || "";
        banner.hidden = !decided.summary;
        renderMyRequests(payload.requests || []);
        renderMyRequestsUnavailable(payload.notListed || []);
        var stamp = byId("my-requests-checked");
        if (stamp) stamp.textContent = "Last checked " + new Date().toLocaleString();
      })
      .catch(function (err) {
        // A failed POLL leaves the last good rows on screen and says so; a
        // failed explicit load has nothing to preserve.
        if (quiet) {
          var stamp = byId("my-requests-checked");
          if (stamp) stamp.textContent = "Could not refresh: " + err.message;
          return;
        }
        clear(rows);
        setMyRequestsNote("Could not read your requests: " + err.message);
      });
  }

  /** The one line under the table: pending, empty, or the reason neither. */
  function setMyRequestsNote(text) {
    var note = byId("my-requests-note");
    if (!note) return;
    note.textContent = text || "";
    note.hidden = !text;
  }

  // -- table cells -----------------------------------------------------------
  //
  // Deliberately the same vocabulary the Execution & Audit Trail viewer's feed
  // uses, because these are two views of the same events and a reader moving
  // between them should not have to relearn where the time is or what an em
  // dash means. A value the server did not send prints "—": "nothing here" and
  // "this cell failed to render" are different facts and this page's whole
  // discipline is not blurring them.

  function cellText(value, className) {
    var cell = el("td", className || "");
    if (isEmpty(value)) cell.appendChild(noneCell());
    else cell.textContent = String(value);
    return cell;
  }

  /** A cell of prose — the only ones allowed to wrap, so the row stays scannable. */
  function proseCell(value, className) {
    var cell = el("td", "prose-cell" + (className ? " " + className : ""));
    if (isEmpty(value)) cell.appendChild(noneCell());
    else cell.textContent = String(value);
    return cell;
  }

  /**
   * The request reference, in full and selectable — see myRequestRow for why
   * this is not `idCell`. The `title` says what it is rather than repeating
   * the value, because the value is already fully visible.
   *
   * R7-40: this is the one value the portal's own copy tells a requester to
   * quote on a phone call, so it also gets a Copy button — `user-select: all`
   * alone needs a mouse drag or a click-then-Ctrl+C a reader has to already
   * know about, and does nothing on a touch device with no hover.
   */
  function referenceCell(value) {
    var cell = el("td", "r-id reference-cell");
    if (isEmpty(value)) {
      cell.appendChild(noneCell());
      return cell;
    }
    var node = el("code", "tag-chip", String(value));
    node.title = "The id that ties every record of this request together — quote it to have this request traced.";
    cell.appendChild(node);
    cell.appendChild(copyButton(String(value)));
    return cell;
  }

  /**
   * An identifier, shortened on screen and whole in the tooltip.
   *
   * R7-40: the tooltip shows the full value but does not let a reader GET it —
   * a `title` attribute is not selectable text in most browsers, so the only
   * place the full record id existed was the download filename. A Copy button
   * puts it on the clipboard directly from the row it is shortened in.
   */
  function idCell(value) {
    var cell = el("td", "r-id");
    if (isEmpty(value)) {
      cell.appendChild(noneCell());
      return cell;
    }
    var node = el("span", "", shortId(value));
    node.title = String(value);
    cell.appendChild(node);
    cell.appendChild(copyButton(String(value)));
    return cell;
  }

  /**
   * A small "Copy" control placed beside an identifier's visible text.
   * Copies the FULL value, never the shortened/displayed one — that is the
   * whole point of the button existing next to a value that may be elided.
   */
  function copyButton(fullValue) {
    var btn = el("button", "copy-btn", "Copy");
    btn.type = "button";
    btn.title = "Copy the full value to the clipboard";
    btn.addEventListener("click", function (event) {
      // Rows are not otherwise clickable, but stopping propagation keeps this
      // safe if that ever changes.
      event.stopPropagation();
      copyToClipboard(fullValue, btn);
    });
    return btn;
  }

  /** Clipboard API where available; a hidden-textarea fallback where not. */
  function copyToClipboard(text, btn) {
    var report = function (ok) {
      var original = "Copy";
      btn.textContent = ok ? "Copied" : "Copy failed";
      btn.disabled = true;
      setTimeout(function () {
        btn.textContent = original;
        btn.disabled = false;
      }, 1500);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(
        function () {
          report(true);
        },
        function () {
          report(false);
        }
      );
      return;
    }
    var area = document.createElement("textarea");
    area.value = text;
    // Off-screen rather than hidden: some browsers refuse to select() an
    // element with display:none, which would make the fallback a no-op.
    area.style.position = "fixed";
    area.style.top = "-1000px";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.focus();
    area.select();
    var ok = false;
    try {
      ok = document.execCommand("copy");
    } catch (err) {
      ok = false;
    }
    document.body.removeChild(area);
    report(ok);
  }

  /**
   * A timestamp: the reader's own local time, the raw ISO in the tooltip, and
   * how long ago underneath it.
   *
   * BOTH halves are needed and neither replaces the other. "4 min ago" is what
   * answers "did my approval just land?", which is the question this page is
   * open for — but it is unquotable, and a requester chasing a decision needs
   * an absolute time to put in a message. The ISO is kept in `title` so
   * formatting never destroys the value the record actually holds.
   */
  function timeCell(iso) {
    var cell = el("td", "r-num when-cell");
    if (isEmpty(iso)) {
      cell.appendChild(noneCell());
      return cell;
    }
    var when = new Date(iso);
    var node = el("time", "", isNaN(when.getTime()) ? String(iso) : when.toLocaleString());
    node.setAttribute("datetime", String(iso));
    node.title = String(iso);
    cell.appendChild(node);
    var ago = timeAgo(when);
    if (ago) cell.appendChild(el("span", "when-ago", ago));
    return cell;
  }

  function timeAgo(when) {
    if (isNaN(when.getTime())) return "";
    var seconds = Math.round((Date.now() - when.getTime()) / 1000);
    // A stamp in the future is a clock disagreement between this browser and
    // the server, not a fact about the request. Say nothing rather than
    // "in 3 minutes", which reads as a claim about the record.
    if (seconds < 0) return "";
    if (seconds < 60) return "just now";
    var minutes = Math.round(seconds / 60);
    if (minutes < 60) return minutes + " min ago";
    var hours = Math.round(minutes / 60);
    if (hours < 48) return hours + " h ago";
    return Math.round(hours / 24) + " d ago";
  }

  // -- the table -------------------------------------------------------------

  function renderMyRequests(requests) {
    var rows = byId("my-requests-rows");
    clear(rows);

    if (!requests.length) {
      setMyRequestsNote(
        // NOT "in this session" any more, and the wording matters: this list
        // is read from the durable stores, so an empty one really does mean
        // nothing has been filed rather than "this process has forgotten".
        "You have not filed anything through this portal yet. Submit a request from the left, then come back here."
      );
      return;
    }

    setMyRequestsNote("");
    requests.forEach(function (request) {
      rows.appendChild(myRequestRow(request));
    });
  }

  /**
   * One request, one row.
   *
   * COLUMN ORDER IS THE ARGUMENT. The first eight answer the only question a
   * requester has — what happened to mine, when, and who decided it — and the
   * identifiers follow them, off the right edge on a narrow screen where they
   * belong. That is what the sideways scroll buys: the plumbing does not have
   * to be deleted to stop it crowding out the answer.
   *
   * Nothing here decides what any of it MEANS. The status word, the sentence
   * under "what happened", the settled flag and the resolution line are all the
   * server's, exactly as they were when this was a column of cards.
   */
  function myRequestRow(request) {
    var status = request.status || {};
    var tr = el("tr", "my-request-row");
    // A decision a person made is the row worth finding in a list of twelve.
    // The class is a left accent and a tint, not a colour that carries meaning
    // on its own — the word in the Status cell does that.
    if (request.settled) tr.classList.add("is-decided");

    tr.appendChild(timeCell(request.submittedAt));

    var useCase = el("td");
    useCase.appendChild(el("span", "nav-code", request.useCase));
    tr.appendChild(useCase);

    tr.appendChild(cellText(request.recordLabel || "Record", "record-label-cell"));

    // The shared .badge treatment: the WORD is always present and carries the
    // meaning; the dot's colour is decoration on top of it. The tone comes
    // from the server's own `state` string — this file never decides what
    // "decided" means, and an unrecognised state keeps the neutral dot rather
    // than being guessed into a colour.
    var statusCell = el("td");
    statusCell.appendChild(el("span", "badge state-" + (status.state || "unknown"), status.label || "Unknown"));
    tr.appendChild(statusCell);

    // The sentence that actually answers the question, and — when the deciding
    // use case supplied one — its own settled sentence underneath, verbatim.
    var happened = el("td", "prose-cell what-cell");
    if (isEmpty(status.detail) && isEmpty(request.resolution)) {
      happened.appendChild(noneCell());
    } else {
      if (!isEmpty(status.detail)) happened.appendChild(el("span", "what-detail", status.detail));
      var resolution = resolutionBlock(request);
      if (resolution) happened.appendChild(resolution);
    }
    tr.appendChild(happened);

    // THE DOCUMENT THIS REQUEST PRODUCED, and where to get it. Directly after
    // "what happened" because it is part of that answer and not an identifier —
    // the column order argument above puts the answer first and the plumbing
    // off the right edge.
    tr.appendChild(documentCell(request));

    tr.appendChild(timeCell(status.decidedAt));
    tr.appendChild(cellText(status.decidedBy));
    tr.appendChild(proseCell(status.note, "note-cell"));

    var intake = el("td");
    if (isEmpty(request.decision)) intake.appendChild(noneCell());
    else intake.appendChild(decisionBadge(request.decision));
    tr.appendChild(intake);

    // round-6 D-06: `reasonLabel` is a plain phrase, computed server-side by
    // src/portal/requestStatus.js's reasonLabel() — never the raw `reason`
    // code (`over_policy_cap`, `destination_unknown`, …), which is this
    // system's own gate vocabulary and stays on the record for a specialist
    // to search `audit_log` by. `r-id`'s monospace-identifier treatment comes
    // off with it — this cell no longer holds an identifier.
    tr.appendChild(cellText(request.reasonLabel, "reason-cell"));
    tr.appendChild(cellText(status.awaitingRole));
    tr.appendChild(idCell(request.recordId));
    // NOT idCell. `idCell` shortens anything over 12 characters, which is right
    // for a UUID nobody retypes and wrong for the one string on this row that
    // exists to be copied: a portal reference is ~26 characters, so every one
    // of them rendered as `uc02-202…` — unusable in the single place a
    // requester goes to look it up. Shown in full, and told what it is for.
    tr.appendChild(referenceCell(request.externalRef));
    // Shown verbatim so the translation in the Status column never hides the
    // underlying fact — a reader can always check what the store itself said.
    tr.appendChild(cellText(status.storeStatus, "r-id"));

    return tr;
  }


  // -- the document a request produced, and where to get it ------------------
  //
  // "This should not end here. A travel letter was requested. It should be
  // recorded, and the user should be able to download the letter. The question
  // now is: from where?" — the project owner, reading this list. The letter was
  // rendered, hashed and stored the whole time; the row said a status and a
  // sentence and gave no sign a document existed. An artifact that exists and
  // cannot be reached is the failure shape this repository keeps paying for.
  //
  // THREE STATES, AND ONLY ONE OF THEM GETS A BUTTON. `issued` can be opened or
  // saved. `drafted` says who is holding it and offers nothing — a control there
  // would promise a document the sign-off gate exists to withhold, which is
  // worse than no control. `none` says which of the four "no letter" situations
  // this is, in the server's words. Every one of those decisions is made in
  // src/portal/letterAccess.js from src/uc03/letterDelivery.js's own verdict;
  // this function branches on `collect` being present and on nothing else.
  function documentCell(request) {
    var doc = request.document;
    var td = el("td", "document-cell");
    // Six of the seven use cases produce nothing a requester can hold, and the
    // em dash says so the same way every other empty cell on this row does.
    if (!doc) {
      td.appendChild(noneCell());
      return td;
    }

    td.appendChild(el("span", "badge doc-" + (doc.state || "none"), doc.label || "Unknown"));
    if (!isEmpty(doc.detail)) td.appendChild(el("span", "doc-detail", doc.detail));
    if (!doc.collect) return td;

    var actions = el("div", "doc-actions");
    var status = el("p", "action-status");
    status.setAttribute("role", "status");

    var open = el("button", "r-btn r-btn-primary r-btn-small");
    open.type = "button";
    open.textContent = "Open the letter";
    open.addEventListener("click", function () {
      collectLetter(request, doc, status, function (payload) {
        showLetter(payload);
      });
    });
    actions.appendChild(open);

    var save = el("button", "r-btn r-btn-secondary r-btn-small");
    save.type = "button";
    save.textContent = "Save it";
    save.addEventListener("click", function () {
      collectLetter(request, doc, status, function (payload) {
        saveLetter(payload, status);
      });
    });
    actions.appendChild(save);

    // rca-cput: "Save it" downloaded the .html and nothing else was offered —
    // to a letting agent or embassy, a .html attachment with a UUID in the
    // name is at best puzzling. `doc.collectPdf` is only ever present for
    // UC-01's letter (src/portal/letterAccess.js) — whether it actually WORKS
    // depends on the deployment having Chromium wired in, which the fetch
    // route reports for itself (`pdf_rendering_unavailable`) rather than this
    // page guessing.
    if (doc.collectPdf) {
      var savePdf = el("button", "r-btn r-btn-secondary r-btn-small");
      savePdf.type = "button";
      savePdf.textContent = "Save as PDF";
      savePdf.addEventListener("click", function () {
        collectLetter(request, doc, status, function (payload) {
          saveLetter(payload, status);
        }, "collectPdf");
      });
      actions.appendChild(savePdf);
    }

    td.appendChild(actions);
    td.appendChild(status);
    return td;
  }

  /**
   * Fetch the letter, then hand it to whoever asked for it.
   *
   * THE PATH AND THE METHOD ARE THE SERVER'S (`doc.collect`, or `doc[endpointKey]`
   * when a caller names a different one — currently only `"collectPdf"`, the
   * same document in a different format), like every other route this page
   * calls. The persona is sent as a KEY — the session behind it is the
   * server's own, from src/portal/personas.js, so nothing this page could
   * type names the employee the letter is about, and the same gate that
   * decided the badge above decides this fetch.
   *
   * A REFUSAL IS PRINTED WITH ITS CODE and nothing is opened. This page cannot
   * know what went wrong and does not guess; the code is the string somebody
   * greps for.
   */
  function collectLetter(request, doc, status, then, endpointKey) {
    var endpoint = doc[endpointKey || "collect"];
    status.className = "action-status";
    status.textContent = "Fetching…";
    api(endpoint.path, {
      method: endpoint.method || "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ persona: byId("persona").value, caseId: request.recordId }),
    })
      .then(function (res) {
        return res.json().then(function (payload) {
          return { status: res.status, payload: payload };
        });
      })
      .then(function (result) {
        var body = result.payload || {};
        if (body.ok !== true || !body.content) {
          status.className = "action-status bad";
          status.textContent = "Not available (" + (body.code || result.status) + "): " + (body.reason || "");
          return;
        }
        status.className = "action-status";
        status.textContent = "";
        then(body);
      })
      .catch(function (err) {
        status.className = "action-status bad";
        status.textContent = "Could not fetch the letter: " + err.message;
      });
  }

  /**
   * Show the letter, in a way it cannot execute in this page's origin.
   *
   * THE DOCUMENT IS HTML THIS SYSTEM RENDERED, and it carries the employee's
   * name, job title and base compensation. It is still HTML, so it is put in a
   * `<iframe sandbox="">` — an EMPTY sandbox attribute, which is the restrictive
   * one: no `allow-scripts`, so nothing in the document runs, and no
   * `allow-same-origin`, so the frame gets an opaque origin and could not reach
   * this page's DOM, cookies or storage even if it did. `srcdoc` rather than a
   * `blob:` URL deliberately: a blob URL INHERITS the creating page's origin, so
   * opening one in a tab would run the document as this page.
   *
   * A <dialog>, for the reasons presentResultDialog() sets out: the browser owns
   * the focus trap, Escape, the inert background and the restored focus, and a
   * hand-rolled overlay gets all four subtly wrong.
   */
  // ONE DIALOG, TWO KINDS OF DOCUMENT. `payload.type` is the server's
  // `documents.type` (src/uc03/letterDelivery.js / src/uc01/letterDelivery.js)
  // — read here only to pick which plain-English name to print, never to
  // decide whether the dialog opens or what it contains. Round-6 D-01/D-03:
  // before this, every letter this dialog showed was labelled "travel letter"
  // regardless of which one it was — harmless while only UC-03 fed it, wrong
  // the moment UC-01's employment verification letter did too.
  var LETTER_TYPE_LABELS = {
    travel_support_letter: "travel letter",
    employment_verification_letter: "employment verification letter",
  };

  function letterTypeLabel(payload) {
    return LETTER_TYPE_LABELS[payload && payload.type] || "letter";
  }

  function showLetter(payload) {
    var existing = document.querySelector("dialog.letter-dialog");
    if (existing && existing.parentNode) existing.parentNode.removeChild(existing);

    var typeLabel = letterTypeLabel(payload);
    var dialog = el("dialog", "interstitial-dialog letter-dialog");
    var panel = el("div", "interstitial-panel letter-panel");
    var heading = el("h3", "interstitial-title", "Your " + typeLabel);
    heading.id = "portal-letter-title";
    dialog.setAttribute("aria-labelledby", heading.id);
    panel.appendChild(heading);

    // WHO SIGNED IT, said rather than left to be inferred from the absence of a
    // name — the server states it (`issuedWithoutSignature`) because a letter
    // that issued on the 🟢 path has no signer and that is the design.
    if (payload.issuedWithoutSignature === true) {
      panel.appendChild(
        el(
          "p",
          "small r-secondary",
          "Issued automatically — every check this letter asserts passed on your request, so no specialist had to sign it."
        )
      );
    }

    var frame = el("iframe", "letter-frame");
    // EMPTY, not omitted. An absent sandbox attribute is no sandbox at all.
    frame.setAttribute("sandbox", "");
    frame.setAttribute("title", "The " + typeLabel + ", as it was issued");
    frame.setAttribute("srcdoc", payload.content);
    panel.appendChild(frame);

    // THE CONTENT HASH IS NOT PRINTED UNDER THE LETTER. Its argument was that
    // it is what the audit row records, so a reader holding the letter could
    // check that what they were handed is what history says was issued — but
    // checking it means computing a SHA-256 over the document's exact bytes,
    // which is not something the person taking this letter to a visa
    // appointment is going to do, and `sha256 3f2a…` under their own name and
    // job title reads as an error message. The hash is still recorded on the
    // case and in `audit_log`, where the person who WOULD verify it looks, and
    // it is still on `payload.contentHash` for any surface built for them.

    var buttons = el("div", "interstitial-buttons");
    var save = el("button", "r-btn r-btn-primary");
    save.type = "button";
    save.textContent = "Save it";
    var saveStatus = el("p", "action-status");
    saveStatus.setAttribute("role", "status");
    save.addEventListener("click", function () {
      saveLetter(payload, saveStatus);
    });
    buttons.appendChild(save);

    var close = el("button", "r-btn r-btn-secondary");
    close.type = "button";
    close.textContent = "Close";
    close.addEventListener("click", function () {
      dialog.close();
    });
    buttons.appendChild(close);
    panel.appendChild(buttons);
    panel.appendChild(saveStatus);

    dialog.appendChild(panel);
    dialog.addEventListener("close", function () {
      if (dialog.parentNode) dialog.parentNode.removeChild(dialog);
    });
    // THE THIRD WAY OUT, same as the result dialog's and for the same reason —
    // a click on the dimmed backdrop. This dialog already had a labelled Close
    // button and Escape (see the focus note below for the one place Escape is
    // the letter's rather than ours); clicking outside the card did nothing,
    // which is the first thing most people try. `target === dialog` is exactly
    // "outside the card": a <dialog> in the top layer reports backdrop clicks
    // against itself and clicks on the card against the node inside it.
    dialog.addEventListener("click", function (event) {
      if (event && event.target === dialog) dialog.close();
    });
    document.body.appendChild(dialog);
    if (typeof dialog.showModal === "function") {
      dialog.showModal();
      // WHERE FOCUS STARTS, AND WHY IT IS NOT LEFT TO THE ENGINE.
      //
      // `showModal()` focuses the first focusable element, which here is the
      // IFRAME — and that broke Escape. Checked in a real browser rather than
      // assumed: with focus on the frame, `document.activeElement` reads
      // IFRAME and pressing Escape does nothing at all, because the key event
      // is delivered to the framed document, which is a separate browsing
      // context with an opaque origin. A sandboxed frame cannot forward it and
      // this page cannot listen for it. "Escape dismisses" is not negotiable,
      // so focus starts on the dialog's own heading instead, in this document,
      // where Escape belongs to the dialog.
      //
      // THE FRAME STAYS TABBABLE, deliberately. It is a scrollable region and
      // removing it from the tab order would make a two-page letter unreadable
      // by keyboard. So the honest statement of the behaviour is: Escape works
      // from everywhere in this dialog EXCEPT while focus is inside the letter
      // itself, where the browser has given the key to the letter — and one
      // Tab from there reaches "Save it" and "Close", which always work. That
      // is a property of cross-origin frames, not something this page can fix,
      // and the alternative costs more than it buys.
      heading.setAttribute("tabindex", "-1");
      heading.focus();
    } else {
      dialog.setAttribute("open", "open");
    }
  }

  /**
   * Put the letter in the reader's downloads folder, under a name they will
   * recognise.
   *
   * THE FILENAME IS THE SERVER'S (`travel-letter-<case id>.html`), built from
   * the case id rather than the employee's name — a filename ends up in shared
   * folders and mail clients, and the id identifies the document without naming
   * the person.
   *
   * A BLOB WITH `download`, which never navigates: the browser writes the file
   * and no document is ever loaded, so the HTML cannot execute anywhere. The
   * object URL is revoked immediately after the click; the download has already
   * been handed to the browser by then.
   *
   * TWO ENCODINGS, because this now also saves a PDF (rca-cput). The letter
   * HTML travels as a plain string; a PDF is binary and travels as base64
   * (src/uc01/letterDelivery.js's `describeIssuedLetterAsPdf`,
   * `payload.encoding === "base64"`) — decoded here into the raw bytes a
   * Blob needs, never treated as text.
   */
  function saveLetter(payload, status) {
    try {
      var blob;
      if (payload.encoding === "base64") {
        var binary = atob(payload.content);
        var bytes = new Uint8Array(binary.length);
        for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        blob = new Blob([bytes], { type: payload.contentType || "application/octet-stream" });
      } else {
        blob = new Blob([payload.content], { type: payload.contentType || "text/html" });
      }
      var href = URL.createObjectURL(blob);
      var link = document.createElement("a");
      link.href = href;
      link.download = payload.filename || "travel-letter.html";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(href);
      if (status) {
        status.className = "action-status ok";
        status.textContent = "Saved as " + link.download + ".";
      }
    } catch (err) {
      if (status) {
        status.className = "action-status bad";
        status.textContent = "Could not save the letter: " + err.message;
      }
    }
  }

  /**
   * What a person decided, as LABELLED FACTS where the server sent them that
   * way and as its one sentence where it did not.
   *
   * WHY IT IS NOT A PARAGRAPH ANY MORE. The project owner read a settled
   * approval that ran who, when, their note, that Remote had not been updated,
   * why, and that the decision was final into one block of prose, and asked
   * "please explain to me why all this story". Three of those facts already had
   * their own column on this very row. The server now publishes the fields and
   * drops the ones a column carries (see settledFactsFor); this draws whatever
   * is left, one per line, under the label naming it.
   *
   * IT DECIDES NOTHING AND DROPS NOTHING. Every label, every value and the
   * finality line come from the server verbatim; there is no branch here on
   * what any of them mean, and a use case that publishes no fields still gets
   * its sentence rendered exactly as before. textContent throughout — the whole
   * page's rule, and it matters most here, because a note is text a person
   * typed.
   */
  function resolutionBlock(request) {
    var settled = request.resolutionFacts;
    if (!settled || !settled.facts) {
      if (isEmpty(request.resolution)) return null;
      return el("span", "what-resolution", request.resolution);
    }
    var box = el("div", "what-resolution");
    if (!isEmpty(settled.headline)) box.appendChild(el("span", "resolution-headline", settled.headline));
    var facts = settled.facts;
    for (var i = 0; i < facts.length; i += 1) {
      var line = el("span", "resolution-fact");
      line.appendChild(el("span", "resolution-label", facts[i].label));
      line.appendChild(el("span", "resolution-value", facts[i].value));
      box.appendChild(line);
    }
    if (!isEmpty(settled.finality)) box.appendChild(el("span", "resolution-finality", settled.finality));
    return box;
  }

  /**
   * The use cases this listing could NOT show, and why.
   *
   * The server has always sent these; nothing rendered them, so a use case that
   * failed to read looked identical to a requester who had filed nothing. That
   * is precisely the confusion a malformed UC-05 query caused in production —
   * an approved UC-02 claim appeared to have vanished when the only broken
   * thing was one other use case's SQL. A gap that names itself cannot do that.
   */
  function renderMyRequestsUnavailable(entries) {
    var box = byId("my-requests-unavailable");
    if (!box) return;
    clear(box);
    // Only the FAILURES are worth a banner. A use case this persona simply has
    // no scope for is a boundary, not an incident, and printing seven of them
    // under every listing would train the reader to ignore the box that also
    // carries the real one.
    var failed = entries.filter(function (entry) {
      return entry && entry.failed;
    });
    box.hidden = !failed.length;
    if (!failed.length) return;

    var banner = el("div", "r-banner r-banner-warn");
    banner.appendChild(
      el(
        "p",
        "",
        failed.length === 1
          ? "One use case could not be read just now. Everything else below is complete."
          : failed.length + " use cases could not be read just now. Everything else below is complete."
      )
    );
    failed.forEach(function (entry) {
      banner.appendChild(el("p", "small", entry.useCase + " — " + entry.reason));
    });
    box.appendChild(banner);
  }

  // -- Consent requests: F-2/L-13, the employee's own act ---------------------
  //
  // WHAT THIS IS, AND WHY IT IS NOT "MY REQUESTS" WITH BUTTONS ON IT. "My
  // requests" above is read-only by design — its own header explains why a
  // second place to decide a 🟡/🔴 case would be a second, unaudited one. This
  // panel is a different KIND of act: an employee granting or refusing
  // disclosure of their OWN employment to a third party is not a specialist
  // reviewing somebody else's case, the same distinction
  // src/remoteui/roles.js already draws for UC-06 ("Consent is the employee's
  // or employer's act, never the admin's"). The server enforces the boundary
  // (GET/POST /api/consent-requests…, src/portal/server.js) — this file
  // renders what it returns and calls the same two routes; it decides nothing
  // itself.
  //
  // ONLY PENDING REQUESTS EVER APPEAR HERE. `findConsentRequestsForEmployee()`
  // (src/shared/caseStore.js) filters to rows that are neither granted nor
  // denied, on purpose — once decided, a request drops off this list, and that
  // disappearance IS the visible proof the decision landed. There is no
  // decided-history table here; the durable row still exists in
  // `consent_records` and is auditable there.
  var CONSENT_POLL_MS = 4000;
  var consentPollTimer = null;
  var consentLiveWanted = true;

  function showConsentRequests() {
    clearContinuation();
    activeType = null;
    byId("home-panel").hidden = true;
    var cards = document.querySelectorAll(".uc-card");
    for (var i = 0; i < cards.length; i += 1) cards[i].hidden = true;
    var items = document.querySelectorAll(".r-nav-item");
    for (var j = 0; j < items.length; j += 1) {
      items[j].classList.remove("is-active");
      items[j].removeAttribute("aria-current");
    }
    byId("card-my-requests").hidden = true;
    stopPolling();
    byId("card-consent-requests").hidden = false;
    loadConsentRequests();
    startConsentPolling();
  }

  function startConsentPolling() {
    stopConsentPolling();
    renderConsentLiveToggle();
    if (!consentLiveWanted) return;
    consentPollTimer = setInterval(function () {
      if (byId("card-consent-requests").hidden) return stopConsentPolling();
      loadConsentRequests({ quiet: true });
    }, CONSENT_POLL_MS);
  }

  function stopConsentPolling() {
    if (consentPollTimer) clearInterval(consentPollTimer);
    consentPollTimer = null;
  }

  function setConsentLive(on) {
    consentLiveWanted = on;
    if (on) startConsentPolling();
    else {
      stopConsentPolling();
      renderConsentLiveToggle();
    }
  }

  function renderConsentLiveToggle() {
    var toggle = byId("consent-requests-live");
    if (!toggle) return;
    toggle.classList.toggle("is-paused", !consentLiveWanted);
    toggle.setAttribute("aria-pressed", consentLiveWanted ? "true" : "false");
    toggle.textContent = consentLiveWanted
      ? "Live — checking every " + CONSENT_POLL_MS / 1000 + "s"
      : "Paused";
  }

  function setConsentNote(text) {
    var note = byId("consent-requests-note");
    if (!note) return;
    note.textContent = text || "";
    note.hidden = !text;
  }

  function loadConsentRequests(opts) {
    var quiet = Boolean(opts && opts.quiet);
    var rows = byId("consent-requests-rows");
    if (!quiet) {
      clear(rows);
      setConsentNote("Reading who is asking…");
    }
    var box = byId("consent-requests-unavailable");
    clear(box);
    box.hidden = true;

    api("api/consent-requests?persona=" + encodeURIComponent(byId("persona").value))
      .then(function (res) {
        return res.json().then(function (payload) {
          return { status: res.status, payload: payload };
        });
      })
      .then(function (result) {
        var body = result.payload || {};
        if (body.ok !== true) {
          // Told apart from an empty list, which means something different:
          // "nobody has asked" versus "this persona may not see who has".
          clear(rows);
          setConsentNote("");
          box.hidden = false;
          box.appendChild(
            el(
              "p",
              "r-empty-body",
              body.reason || "This persona cannot view consent requests (" + (body.code || result.status) + ")."
            )
          );
          return;
        }
        renderConsentRequests(body.requests || [], body.agePolicyDays);
        var stamp = byId("consent-requests-checked");
        if (stamp) stamp.textContent = "Last checked " + new Date().toLocaleString();
      })
      .catch(function (err) {
        if (quiet) {
          var stamp = byId("consent-requests-checked");
          if (stamp) stamp.textContent = "Could not refresh: " + err.message;
          return;
        }
        clear(rows);
        setConsentNote("Could not read consent requests: " + err.message);
      });
  }

  function renderConsentRequests(requests, agePolicyDays) {
    var rows = byId("consent-requests-rows");
    clear(rows);

    if (!requests.length) {
      setConsentNote("Nobody is currently waiting on you for a consent decision.");
      return;
    }

    setConsentNote("");
    requests.forEach(function (request) {
      rows.appendChild(consentRequestRow(request, agePolicyDays));
    });
  }

  // -- Consent badge: R7-17 --------------------------------------------------
  //
  // WHAT THIS FIXES. A real employee's report: two third-party consent
  // requests had waited over a day for a decision only they could make, and
  // "nothing on the employee's normal path mentions they exist: no badge, no
  // count, no banner on the portal home page, the UC-01 request form, or 'My
  // requests'." They found the tab only by clicking it out of curiosity.
  //
  // WHY A POLL RATHER THAN PUSH. This page has no server-sent events and no
  // websocket, and every other live surface here (loadMyRequests,
  // loadConsentRequests) already polls — this reuses that shape rather than
  // inventing a second one. Independent of BOTH of those timers: it must keep
  // running on the home view and every use-case card, which is exactly where
  // those two are stopped (see showHome()/activate()).
  //
  // WHY IT READS THE SAME ENDPOINT loadConsentRequests() DOES, RATHER THAN A
  // NEW ONE. `GET /api/consent-requests?persona=` already answers "how many
  // is this persona being asked to decide" — server.js is the one place that
  // decides who may see what, and a second endpoint here would be a second,
  // driftable answer to the same question.
  var CONSENT_BADGE_POLL_MS = 15000;
  var consentBadgePollTimer = null;

  function refreshConsentBadge() {
    var personaField = byId("persona");
    var personaValue = personaField && personaField.value;
    if (!personaValue) return;

    api("api/consent-requests?persona=" + encodeURIComponent(personaValue))
      .then(function (res) {
        return res.json();
      })
      .then(function (body) {
        // A persona that cannot view consent requests at all (`ok: false`,
        // e.g. a specialist rather than an employee) is not the same as an
        // employee with zero pending — both hide the badge, but only the
        // first is silent about why, and that is fine here: this is a
        // proactive nudge, and the "Consent requests" tab itself still gives
        // the real reason if opened directly.
        setConsentBadgeCount(body && body.ok === true ? (body.requests || []).length : 0);
      })
      .catch(function () {
        // Silent on purpose — see the note above. Loud failure here would
        // make a background poll compete for attention with the page's real
        // errors.
      });
  }

  function setConsentBadgeCount(count) {
    var navBadge = byId("nav-consent-badge");
    if (navBadge) {
      navBadge.hidden = !count;
      navBadge.textContent = String(count);
    }

    var banner = byId("consent-badge-banner");
    var text = byId("consent-badge-banner-text");
    if (!banner || !text) return;
    banner.hidden = !count;
    if (count) {
      text.textContent =
        count === 1
          ? "Someone is waiting on you to decide who may be told about your employment."
          : count + " people are waiting on you to decide who may be told about your employment.";
    }
  }

  function startConsentBadgePolling() {
    stopConsentBadgePolling();
    refreshConsentBadge();
    consentBadgePollTimer = setInterval(refreshConsentBadge, CONSENT_BADGE_POLL_MS);
  }

  function stopConsentBadgePolling() {
    if (consentBadgePollTimer) clearInterval(consentBadgePollTimer);
    consentBadgePollTimer = null;
  }

  /**
   * One pending consent request, one row: who is asking, what for, how long
   * it has been waiting (L-19's own policy figure, labelled as ours rather
   * than Remote's — the exact wording src/approvalqueue/ already uses, so a
   * reader moving between the two surfaces sees the same claim), and the two
   * acts this page allows.
   */
  function consentRequestRow(request, agePolicyDays) {
    var tr = el("tr", "consent-request-row");
    if (request.waitingLong) tr.classList.add("is-decided");

    tr.appendChild(timeCell(request.createdAt));
    tr.appendChild(cellText(request.requestingParty, "record-label-cell"));
    tr.appendChild(proseCell(request.purpose));

    var waitCell = el("td");
    var days = typeof request.ageDays === "number" ? request.ageDays : 0;
    waitCell.appendChild(
      el("span", "small", days + " day" + (days === 1 ? "" : "s"))
    );
    if (request.waitingLong) {
      var warn = el(
        "span",
        "when-ago",
        "waiting longer than our own " + (agePolicyDays || CONSENT_AGE_WARN_DAYS_FALLBACK) + "-day figure — nothing lapses or changes because of it"
      );
      waitCell.appendChild(warn);
    }
    tr.appendChild(waitCell);

    tr.appendChild(consentDecideCell(request));
    return tr;
  }

  // Matches src/shared/consentPolicy.js's CONSENT_AGE_WARN_DAYS. Used ONLY as
  // a display fallback if a response ever omits `agePolicyDays` — the number
  // that actually decides `waitingLong` always comes from the server, never
  // from this constant.
  var CONSENT_AGE_WARN_DAYS_FALLBACK = 3;

  function consentDecideCell(request) {
    var td = el("td", "document-cell");
    var actions = el("div", "doc-actions");
    var status = el("p", "action-status");
    status.setAttribute("role", "status");

    var grant = el("button", "r-btn r-btn-primary r-btn-small");
    grant.type = "button";
    grant.textContent = "Grant";
    grant.addEventListener("click", function () {
      decideConsentRequest(request, "grant", [grant, refuse], status);
    });

    var refuse = el("button", "r-btn r-btn-danger r-btn-small");
    refuse.type = "button";
    refuse.textContent = "Refuse";
    refuse.addEventListener("click", function () {
      decideConsentRequest(request, "deny", [grant, refuse], status);
    });

    actions.appendChild(grant);
    actions.appendChild(refuse);
    td.appendChild(actions);
    td.appendChild(status);
    return td;
  }

  /**
   * Grant or refuse ONE request, via the same route
   * `src/portal/server.js`'s `POST /api/consent-requests/:id/decide` already
   * exposes. `persona` is sent as a KEY, exactly like every other write this
   * page makes — the session behind it is the server's own, so nothing typed
   * here can name a different employee's consent.
   *
   * On success the row is removed rather than re-rendered "decided": this
   * list is deliberately PENDING-ONLY (see the section header above), so a
   * decided request belongs off it, not on it in a different colour. The
   * banner above the table says what just happened, the same
   * `decided-summary` treatment "My requests" uses.
   */
  function decideConsentRequest(request, decision, buttons, status) {
    buttons.forEach(function (btn) {
      btn.disabled = true;
    });
    status.className = "action-status";
    status.textContent = decision === "grant" ? "Granting…" : "Refusing…";

    api("api/consent-requests/" + encodeURIComponent(request.id) + "/decide", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ persona: byId("persona").value, decision: decision }),
    })
      .then(function (res) {
        return res.json().then(function (payload) {
          return { status: res.status, payload: payload };
        });
      })
      .then(function (result) {
        var body = result.payload || {};
        if (body.ok !== true) {
          status.className = "action-status bad";
          status.textContent = "Could not record your decision (" + (body.code || result.status) + "): " + (body.reason || "");
          buttons.forEach(function (btn) {
            btn.disabled = false;
          });
          return;
        }
        var banner = byId("consent-requests-decided");
        banner.textContent =
          decision === "grant"
            ? "You granted " + (request.requestingParty || "this party") + "'s request. It has left this list."
            : "You refused " + (request.requestingParty || "this party") + "'s request. It has left this list.";
        banner.hidden = false;
        loadConsentRequests();
        refreshConsentBadge();
      })
      .catch(function (err) {
        status.className = "action-status bad";
        status.textContent = "Could not record your decision: " + err.message;
        buttons.forEach(function (btn) {
          btn.disabled = false;
        });
      });
  }

  // -- submitting ------------------------------------------------------------

  // D-26: THE PENDING STATE USED TO BE ONE LINE ("Running the real gates…")
  // WITH NO EXPLANATION OF THE WAIT OR WHAT LEAVING DOES. The real gates this
  // page runs take up to ~15 seconds — a real LLM classification, a real
  // Remote read, a real durable write, not a spinner standing in for nothing
  // — and a requester watching a disabled button with no explanation has no
  // way to tell "still working" from "hung". In production an employee
  // assumed the latter, left the page, and resubmitted, creating duplicate
  // ticket #118 (D-26). Kept byte-identical to src/thirdparty/assets/app.js's
  // own copy of this sentence — no shared module, since the two pages are
  // served by two separate standalone servers with no common bundle.
  var LEAVING_COST_MESSAGE =
    "This can take up to 15 seconds because we run the real checks now, not after you leave. Please don't close this tab, and avoid sending it again: leaving does not cancel the request, and it may already be underway.";

  function submit(typeId, form) {
    var button = form.querySelector("button[type=submit]");
    var box = byId("result-" + typeId);

    // THE ONE PLACE THIS PAGE DECLINES TO SEND SOMETHING, AND ITS EXACT SCOPE.
    //
    // Only while a continuation is open, and only about boxes the server named.
    // A UC-04 request filed straight from this form is untouched and still
    // reaches gate 5 with whatever it carries — that refusal is a real
    // demonstration of a real gate and swallowing it would be the mistake
    // REQUIRED_FIELDS' own comment warns about, one form down.
    //
    // What is different about a continuation is that the server has ALREADY
    // answered the question. It said, in the same response that filled this
    // form in, which inputs it could not supply. Posting anyway spends a real
    // decision — a durable `uc04_authorizations` row, an `audit_log` row and a
    // claimed idempotency key — to be told back what we were told before we
    // asked, in the vocabulary of a policy refusal ("blocked", "factors_invalid")
    // that reads as a finding about the employee's trip and is nothing of the
    // kind. That is the manufactured-refusal shape docs/BUILD-LOG.md §3.30 names.
    //
    // So nothing is judged here and nothing decision-shaped is rendered: the page
    // says which boxes are empty, in the server's words, and puts the cursor in
    // the first one.
    if (typeId === "uc04" && pendingContinuation) {
      var gaps = unfilledGaps();
      if (gaps.length) {
        showGapPrompt(box, gaps);
        return;
      }
    }

    button.disabled = true;
    clear(box);
    box.appendChild(el("p", "result-pending", "Running the real gates…"));
    box.appendChild(el("p", "small r-secondary", LEAVING_COST_MESSAGE));

    // Built once, so the reference actually SENT is the one reported back and
    // the one "reuse" will repeat. Rebuilding it for the report would generate
    // a second, different reference and quietly make the reuse control lie.
    var body = BUILDERS[typeId](byId("persona").value);
    var sentRef = body.externalRef || null;

    api("api/requests/" + typeId, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
      .then(function (res) {
        return res.json().then(function (payload) {
          return { status: res.status, payload: payload };
        });
      })
      .then(function (result) {
        button.disabled = false;
        // An expired or wrong key mid-session: re-prompt rather than render
        // "Refused: portal_access_key_required" as though a gate had judged
        // the request. Nothing was decided, so nothing decision-shaped is shown.
        if (result.status === 401 && String(result.payload.code || "").indexOf("portal_access_key") === 0) {
          forgetKey();
          clear(box);
          showAccessGate(result.payload);
          return;
        }
        // Remember what was sent, and prefill the reuse box with it, so
        // switching to "Reuse" and clicking again is genuinely a repeat of the
        // delivery that just happened rather than a fresh one.
        if (sentRef) {
          lastRef[typeId] = sentRef;
          var input = byId(typeId + "-externalRef");
          if (input && refMode(typeId) !== "reuse") input.value = sentRef;
          showSentRef(typeId, sentRef);
        }
        render(box, result.payload, sentRef);
      })
      .catch(function (err) {
        button.disabled = false;
        clear(box);
        box.appendChild(el("p", "action-status bad", "Couldn't submit: " + err.message));
      });
  }

  /**
   * "Not sent yet — these are still empty."
   *
   * DELIBERATELY NOT DECISION-SHAPED. No `.result-box`, no `refused` class, no
   * decision word: nothing has been judged, no gate has run, and no row exists
   * anywhere. A panel that looked like the refusal panel would be this page
   * imitating a verdict it has no standing to reach, which is worse than the
   * dead end it replaces.
   *
   * Every label and every reason below is the SERVER'S sentence, carried through
   * unedited — including the distinction it drew between "you did not say this"
   * and "we never ask this", which is the more interesting half and the reason
   * some of these boxes could never have been filled in for the employee.
   */
  function showGapPrompt(box, gaps) {
    clear(box);
    var panel = el("div", "gap-prompt");
    panel.appendChild(el("span", "r-status r-status-warn", "Not submitted"));
    panel.appendChild(
      el(
        "p",
        "small",
        gaps.length === 1
          ? "One thing is still empty, and the assessment cannot be made without it. Nothing has been sent and nothing has been decided."
          : gaps.length +
              " things are still empty, and the assessment cannot be made without them. Nothing has been sent and nothing has been decided."
      )
    );

    var list = el("ul", "continuation-list");
    gaps.forEach(function (gap) {
      var li = el("li");
      li.appendChild(el("strong", null, gap.label || gap.field));
      if (gap.why) li.appendChild(el("span", "small r-secondary", " — " + gap.why));
      list.appendChild(li);
    });
    panel.appendChild(list);
    box.appendChild(panel);

    // Straight to the first empty box, opening the fields section if it is shut.
    // The original defect was a person not seeing a box, so leaving them to find
    // it again from a list would be half a fix.
    var first = byId(gaps[0].field);
    if (first) {
      var manual = document.querySelector("#form-uc04 .manual-fields");
      if (manual) manual.open = true;
      if (first.scrollIntoView) first.scrollIntoView({ block: "center" });
      if (first.focus) first.focus();
    }
  }

  /**
   * Render whatever came back. The only branch is ok/refused — everything else
   * is the server's own words, printed.
   */
  function render(box, payload, sentRef) {
    clear(box);

    if (!payload || payload.ok !== true) {
      var refusal = el("div", "result-box refused");
      var refusalHead = el("div", "result-head");
      // Lifecycle state as the design system's .r-status: a dot beside the
      // plain word. The word carries the meaning; the dot is the redundant cue.
      refusalHead.appendChild(el("span", "r-status r-status-danger", "Refused"));
      // The refusal CODE is a tag, not a state — a machine identifier a reader
      // can quote back — so it keeps the chip treatment rather than a dot.
      refusalHead.appendChild(el("span", "tag-chip", (payload && payload.code) || "unknown"));
      refusal.appendChild(refusalHead);
      if (payload && payload.reason) refusal.appendChild(el("p", "result-reason", payload.reason));
      refusal.appendChild(
        el(
          "p",
          "small r-secondary",
          "This is a POLICY refusal: a gate judged the request and said no. It is not the same thing as a repeated reference being refused as an already-processed delivery — that appears below a successful submission, not here."
        )
      );
      if (sentRef) refusal.appendChild(referenceLine(sentRef));
      box.appendChild(refusal);
      // TAKEN TO, NOT INTERRUPTED WITH. This panel is as far below the fold as
      // every other result — measured at 1152px and 1482px on a 900px-tall
      // viewport, 2108px and 2781px on a 740px one — so leaving it where it
      // falls would make a refusal the one outcome you still have to go
      // looking for. It gets the scroll and not the dialog because a refused
      // submission is a CORRECTION LOOP: the form is still on screen with
      // their answers in it, their next act is to fix it, and a modal in front
      // of it would be dismissed on every attempt. presentResultDialog()'s
      // header argues the whole of this.
      bringIntoView(refusal);
      return;
    }

    var wrap = el("div", "result-box");

    var head = el("div", "result-head");
    head.appendChild(outcomeStatus(payload));
    head.appendChild(decisionBadge(payload.decision));
    // WHAT WAS CREATED, NAMED — and no longer a second id nobody can use.
    // This line used to end with `shortId(payload.recordId)`, rendered as
    // `dde76d58…`. Elided, so it cannot be copied; internal, so it is not the
    // string anyone would quote; and printed directly above the reference,
    // which is the id that can be. Two ids, one usable. The record id is still
    // shown IN FULL in "My requests", where a row needs to identify its own
    // record.
    // WHAT WAS CREATED, IN THE WORD THE REQUESTER WOULD USE. This used to read
    // `UC-04 · Work authorization request`. "UC-04" is this repository's own
    // index — it appears in the roadmap, the build log and nine directory
    // names, and nowhere a person who filed a request has ever been. The label
    // beside it already says what the record is.
    head.appendChild(el("span", "r-muted small", payload.recordLabel));
    wrap.appendChild(head);

    // THE ANSWER, FIRST AND IN A SENTENCE.
    //
    // The panel used to open with a status chip, a decision string and then
    // several screens of machinery, and the answer to the question the person
    // actually asked was somewhere inside it. The project owner: "when the user
    // asks a question, I would love there to be a quick answer, so that the
    // person doesn't need to scroll down indefinitely."
    //
    // NOT COMPOSED HERE. Choosing between "yes", "not yet" and "no" means
    // comparing a decision string, which is the one thing this file may never
    // do — and the country in it is a NAME, which would mean shipping a second
    // copy of the country list into a browser asset. Both live server-side in
    // src/portal/plainAnswer.js; what arrives is two finished strings.
    //
    // IT SITS ABOVE THE PROMOTED OFFER ON PURPOSE, and it is the first thing in
    // the dialog the result opens with. The answer says what happened to their
    // request; the offer, when there is one, proposes what they can do about
    // it. In that order, in both places, and neither repeats the other's words.
    // When the dialog is dismissed both return here, the answer takes focus,
    // and the offer is the line directly beneath it.
    var answerBlock = plainAnswerBlock(payload);
    if (answerBlock) wrap.appendChild(answerBlock);

    // THE OFFER, SECOND — and only when there IS one. offersOn() returns the
    // offers this result carries, in priority order, and the first of them is
    // promoted: it goes directly under the answer, above the reference and the
    // gate ladder, and presentResultDialog() below shows the two together as
    // one modal so they arrive rather than wait to be found. Empty for a
    // refusal and for every hand-off, which is most results — see offersOn()
    // for which results have something to offer and which have nothing, a
    // question the answer above does not change.
    var offers = offersOn(payload);
    var interstitial = offers.length ? promoteToInterstitial(offers[0]) : null;
    if (interstitial) wrap.appendChild(interstitial);
    // The offers this result carries beyond the promoted one are NOT dropped —
    // they are appended further down, after the facts table, by the
    // `offers.slice(1)` loop below. Checked before adding a second one here.

    // The reference this submission used, FIRST — it is the identity of the
    // thing being reported, and it used to sit at the very bottom of a panel
    // long enough that a tester scrolled past it and asked where the generated
    // id had gone.
    if (sentRef) wrap.appendChild(referenceLine(sentRef));

    // THE "ALREADY HANDLED" NOTICE, and why it sits above the reason.
    //
    // THREE different things get called "duplicate" here, and a tester must
    // not have to guess which one they got:
    //   * kind "delivery" — the REFERENCE had already been processed, so the
    //                       request was not decided again and nothing was
    //                       written twice. No gate ran.
    //   * kind "record"   — the SUBJECT had already been decided (UC-02 asks
    //                       "have I judged this expense before?" ahead of its
    //                       gates), so the stored decision was replayed. The
    //                       reference was fine.
    //   * a `blocked` decision reading `duplicate_submission` — UC-02's §7
    //                       receipt gate found this RECEIPT already reimbursed
    //                       on another expense. That is a gate judging the money,
    //                       and it renders as an ordinary decision, NOT here.
    // Every wording comes from the server; this file only places it and picks
    // the heading, which names the kind so the two are never confused.
    //
    // rca-lapd (R7-12): SKIPPED WHENEVER A LETTER IS READY TO COLLECT. That
    // interstitial box already told the reader "your letter is ready" and
    // folds this exact explanation into itself as a follow-on line (see
    // letterCollection()) — a second, amber-styled "refused as a repeat
    // delivery" panel underneath it read as a contradiction of the box right
    // above it, which is verbatim what an employee asked this screen: "did
    // that work or not?" One result gets one panel, not two disagreeing ones.
    var letterIsReady = !!(payload.letter && payload.letter.collect && payload.recordId);
    if (payload.alreadyHandled === true && !letterIsReady) {
      var dupe = el("div", "duplicate-notice");
      dupe.appendChild(
        el(
          "span",
          "r-status r-status-warn",
          payload.alreadyHandledKind === "record"
            ? "Already decided — the stored decision was replayed"
            : "Already processed — this reference was refused as a repeat delivery"
        )
      );
      dupe.appendChild(el("p", "result-reason", payload.duplicateExplanation || ""));
      if (payload.duplicateOf) {
        dupe.appendChild(el("p", "small r-secondary", "Reference already claimed: " + payload.duplicateOf));
      }
      if (payload.alreadyDecidedAt) {
        dupe.appendChild(el("p", "small r-secondary", "First decided at " + payload.alreadyDecidedAt));
      }
      // rca-0jya (R7-41): the employee's own question — "will this be held
      // against me again next year?" — had no answer on this screen at all.
      // Only self-service's join (selfServiceLetterDeliveryFields() on the
      // server) sets this; every other adapter's hold is the permanent
      // idempotency key and has no expiry to report.
      if (payload.duplicateWindowExpiresAt) {
        dupe.appendChild(
          el(
            "p",
            "small r-secondary",
            "This hold clears automatically at " +
              payload.duplicateWindowExpiresAt +
              " — a request made after that time is not affected by this one."
          )
        );
      }
      wrap.appendChild(dupe);
    }

    // A repeat this deployment had no way to catch. Reported so an in-memory
    // run does not read as the duplicate check being broken.
    if (payload.ledgerUndetected === true) {
      var blind = el("div", "duplicate-notice");
      blind.appendChild(el("span", "r-status r-status-warn", "Repeat NOT refused — no durable ledger here"));
      blind.appendChild(el("p", "result-reason", payload.ledgerUndetectedExplanation || ""));
      wrap.appendChild(blind);
    }

    // THE REASON, IN WORDS, OR NOT AT ALL.
    //
    // `over_policy_cap` printed alone, above a gate line phrased as the
    // PASSING condition ("the converted amount is within the category cap"),
    // left a reader to invert the sentence themselves to find out what had
    // happened. A tester asked, in as many words, for it to say that the
    // expense is above the policy cap. `means` comes from the policy engine
    // (GATE_SEQUENCE), per REASON and not per gate — one gate refuses several
    // ways — and it is that sentence.
    //
    // THE SLUG USED TO SIT BESIDE IT IN A CHIP, and its argument was that it is
    // the exact string in `audit_log`, in the metrics exception ranking and in
    // the n8n ports, so it is what someone searches for. Every one of those is
    // a place a SPECIALIST looks. The person on this page does not search the
    // audit log; the string they can quote is the reference, which is printed
    // three lines above, and the slug still travels — on the envelope, in the
    // stored record, and as its own labelled row in the Zendesk note the
    // specialist opens.
    //
    // AND THE BARE-SLUG FALLBACK HAS GONE WITH IT. Where the server has no
    // plain-words sentence, this used to print `payload.reason` on its own, so
    // the one outcome with no gate row — UC-09's `amount_not_extracted` — was
    // the one that showed the employee an identifier and nothing else. Nothing
    // is printed here now in that case: what happened to their request is
    // answered in a sentence at the top of the panel by the plain answer, which
    // is composed from the decision class and needs no gate row to exist.
    if (payload.decidedBy && payload.decidedBy.means) {
      wrap.appendChild(el("p", "result-reason", payload.decidedBy.means));
    }

    // WHAT ACTUALLY DECIDED — REMOVED FROM THIS PAGE, AND NOT FROM THE SYSTEM.
    //
    // Three blocks used to stand here and all three were about the machinery:
    //
    //   * "Decided by gate 12 of 16 — Policy cap" and "That gate checks: the
    //     converted amount is within the category cap". A coordinate in an
    //     ordering this repository owns, plus that gate's PASSING condition,
    //     which on a refusal says the opposite of what happened unless the
    //     reader inverts it.
    //   * The whole ladder, sixteen rungs deep, each with its own "Checks:"
    //     line, under a paragraph ending "...is written up in docs/GATES.md" —
    //     a path in a source tree, on the screen of somebody who filed an
    //     expense.
    //   * The flags, as chips: `pe_risk_high`, `schengen_window_exceeded`,
    //     `over_policy_cap`. Identifiers, unexplained, in a row.
    //
    // None of the three answers any of the four questions the person reading
    // this page has — what happened to my request, do I need to do anything,
    // who has it and roughly when, and how do I get what was produced. The
    // deciding gate's plain-words sentence, which does answer the first, is
    // printed directly above as the reason.
    //
    // ROUTED, NOT DELETED. Every one of them is the substance of the hand-off
    // for the specialist who has to re-examine the case, and every one of them
    // is in the Zendesk internal note that specialist opens: the gate and its
    // position as the "Decided by" row (server.js's gateNarration() marks it
    // `specialistDetail`), the flags as their own labelled row in the decision
    // table (buildTicketNote). `payload.gateLadder` is still on the envelope
    // for any surface that wants it — the ZAF sidebar is one — and this page is
    // simply no longer the surface that draws it.
    //
    if (payload.details && payload.details.length) {
      // THE SAME SENTENCE, TWICE. The server sends the deciding gate's `means`
      // in two places — as `decidedBy.means`, rendered as the reason paragraph
      // a few lines above, and again as the "What happened" detail row. Both
      // are the server's words; nothing here decides what they say. Printing a
      // one-line `means` twice was merely redundant, but a `means` that has to
      // explain what happens NEXT (UC-03's routing rung is four sentences)
      // reads as a page fault the second time it appears.
      //
      // DROPPED BY VALUE-IDENTITY ONLY — never by label. A row is skipped when
      // its text is character-for-character the paragraph already on screen, so
      // a use case whose "What happened" says anything the paragraph did not
      // still prints in full. This removes a duplicate; it can never remove
      // information.
      wrap.appendChild(detailTable(withoutRepeatOf(payload.details, payload.decidedBy && payload.decidedBy.means)));
    }

    // THE HAND-OFF, AND ONLY THE HALF THE REQUESTER CAN USE.
    //
    // This block used to render on any `ticketNote`, and its comment defended
    // that: "`ticketNote` always says something — a ticket raised, or which of
    // the several reasons none was — so 'no ticket' is never left to be
    // inferred from silence." Every word true, and aimed at the wrong reader.
    // What an employee actually met was "No Zendesk ticket: this decision needs
    // no human, so raising one would be noise in a real queue" — our support-
    // queue hygiene, explained to somebody who had just asked whether they may
    // travel. The project owner, on that line: "this info is useless to the
    // user. Whether we raised an internal ticket is not their business and
    // there is nothing they can do with it."
    //
    // TWO CASES SURVIVE, and both answer one of the four questions this reader
    // has. A ticket that EXISTS is a reference they can quote when they chase
    // it. A hand-off that FAILED is a limit on their own request — their case
    // may be sitting where nobody will see it — and an absence is never left
    // silent (docs/UI-AUDIENCES.md §5). What goes is the third case: a ticket
    // deliberately not raised, which is a fact about our queue and not about
    // their request. The note itself is still on the envelope and still in the
    // specialist's ticket; nothing is being hidden from the reader it was for.
    if (payload.ticketCreated || payload.ticketError) {
      var handoff = el("div", "ticket-note");
      handoff.appendChild(
        el(
          "span",
          payload.ticketCreated ? "r-status r-status-ok" : "r-status r-status-warn",
          payload.ticketCreated ? "Zendesk ticket #" + payload.ticketId : "Not handed over"
        )
      );
      if (payload.ticketNote) handoff.appendChild(el("p", "small r-secondary", payload.ticketNote));
      // THE ROUTING TAGS ARE NOT SHOWN HERE. `portal_request`, `uc04`,
      // `uc04_specialist_approval`, `queue_mobility_specialists` — the strings a
      // Zendesk trigger matches on to put the ticket in front of the right team.
      // They are ON the ticket, which is where they do their work and where the
      // specialist can see them; printed to the requester they are four
      // identifiers under a sentence that has already told them, by team name,
      // who has their request. `payload.ticketTags` is still on the envelope.
      if (payload.ticketError) handoff.appendChild(el("p", "small r-secondary", "Zendesk said: " + payload.ticketError));
      wrap.appendChild(handoff);
    }

    // ANY OTHER OFFER STILL RENDERS, down here, unpromoted. ONE modal per
    // result is the rule — two stacked interruptions is a dark pattern and the
    // second is never read — but "not the interruption" must never mean "not on
    // the page": a second offer that quietly disappeared would be exactly the
    // defect this whole change exists to fix, committed by the fix. UC-03's
    // three offers cannot in fact co-occur (the server sends a continuation
    // only on a routing, an offer of a letter only where none has been written,
    // and a collectable letter only where one has), so this loop is usually
    // empty; it is written this way so the impossible case degrades to
    // "quieter" rather than to "gone".
    offers.slice(1).forEach(function (extra) {
      wrap.appendChild(extra);
    });
    wrap.appendChild(trackingLink(payload));
    box.appendChild(wrap);

    // AFTER the result is in the document, never before: showModal() moves
    // focus, and moving focus into a node that is not yet on the page is how a
    // dialog ends up unreachable by a keyboard. It is also why the parts are
    // captured only now — each one remembers the sibling it has to go back
    // before, and the panel is not finished until this line.
    //
    // THE ANSWER FIRST AND THE RECOMMENDATION SECOND, which is the order they
    // are read in and the order they sit in on the page. Nothing happens on a
    // browser with no <dialog>, or on a payload with neither — the blocks then
    // stay where they were appended above, and the scroll below takes the
    // reader to them.
    if (!presentResultDialog([answerBlock, interstitial])) bringIntoView(answerBlock || interstitial);
  }

  /**
   * The route to "My requests", on the result panel.
   *
   * WHY: a requester filed an over-cap expense, was told a Finance Ops
   * specialist would review it, and never saw the outcome. The data was right
   * all along — the row read `approved` with the reviewer recorded — but "My
   * requests" is a separate nav item and nothing on the result pointed at it,
   * so the one place that would ever tell them the answer was unreachable from
   * the one screen that said an answer was coming.
   *
   * THIS OPENS THE EXISTING VIEW AND RENDERS NO STATUS OF ITS OWN. Duplicating
   * the status table into the result panel would be a second place to keep
   * right; it calls showMyRequests(), the same function the nav button calls.
   * It is a pointer, never a control — no approve, no deny, nothing that could
   * decide a request, here or anywhere on this page.
   *
   * WHETHER TO SHOW IT AND WHAT IT SAYS BOTH COME FROM THE SERVER
   * (`payload.tracking`, trackingHint() in requestStatus.js). This function
   * branches on no decision string.
   */
  function trackingLink(payload) {
    var hint = payload.tracking;
    if (!hint || hint.show !== true) return document.createDocumentFragment();

    var wrap = el("p", "next-step small" + (hint.awaitingHuman ? " next-step-awaiting" : ""));
    wrap.appendChild(document.createTextNode(hint.sentence + " "));

    var open = el("button", "r-link-button");
    open.type = "button";
    open.textContent = hint.label;
    open.addEventListener("click", function () {
      showMyRequests();
    });
    wrap.appendChild(open);
    return wrap;
  }

  // -- offers, and which one is allowed to interrupt -------------------------
  //
  // THE PREDICATE, WRITTEN DOWN SO IT IS ARGUED RATHER THAN ASSUMED.
  // A result earns a modal when it OFFERS THE READER A NEXT ACTION they would
  // otherwise have to discover by scrolling. Three kinds of result exist on
  // this page and only the first qualifies:
  //
  //   * AN OFFER — something the reader can take up now, here, themselves.
  //     UC-03's routing to work authorization, and UC-03's formal travel
  //     letter. These interrupt.
  //   * A HAND-OFF — a specialist must act and the reader's next step is to
  //     wait. Every 🟡 outcome, and UC-02's flagged claims. The panel says so
  //     plainly (the plain answer at the top names the team that has it, and
  //     the tracking pointer under it says where their answer appears); it does not
  //     interrupt, because an interruption carrying nothing to act on trains
  //     people to dismiss without reading, and the next one they dismiss will
  //     be the disclaimer.
  //   * A REFUSAL — nothing is offered at all. Never a modal.
  //
  // SO THE HONEST ANSWER IS THAT ONE USE CASE OF THE SEVEN EARNS IT, and it
  // earns it three times: the routing to work authorization, the offer of a
  // formal letter, and a letter already issued and waiting to be collected.
  // UC-02, UC-04, UC-05 and UC-09 are hand-offs by
  // construction; UC-07 and UC-08 are the 🔴 pair whose whole guarantee is that
  // nothing can be approved anywhere, so an offer there would be a lie with a
  // button on it. Manufacturing five more offers so the pattern looked general
  // would be the wrong reading of "across all the use cases": what that asks
  // for is that a reader never has to scroll to find the thing they can act
  // on — and where there is nothing to act on there is nothing to surface.
  // The per-use-case reasoning is recorded in each docs/use-cases/UC-0X.md.
  //
  // NOT ONE DECISION STRING IS COMPARED IN HERE. Each builder reads its own
  // server-sent offer object (`continuation.available`, `letterOffer.offered`)
  // and returns null when there is nothing to offer, so what interrupts is
  // decided by the use case that made the offer and never by this file.
  function offersOn(payload) {
    // ORDER IS PRIORITY, and it is the order in which a reader can act. A
    // routing is a REDIRECTION — until it is taken, nothing else about the
    // request can move — where the letter is an extra on an answer that is
    // already complete. So a routing outranks a letter, and would win if a
    // result ever carried both.
    //
    // A LETTER THAT EXISTS OUTRANKS THE OFFER TO ASK FOR ONE, and this order
    // used to be the other way round on an argument that is not safe to rest
    // on. It read: the collection "cannot co-occur with either of the two above
    // it … the offer to ASK for one is sent only where there is nothing to
    // collect", and then reasoned that if the impossible pair ever did arrive,
    // the offer should still win because it is "the thing the reader must do
    // something about" rather than "the thing already sitting in their hands".
    //
    // Both halves are worth correcting. The premise is TRUE TODAY and was
    // checked rather than assumed — driven live 2026-08-20, a result carrying
    // an issued letter comes back `letterOffer: {offered: false,
    // no_offer_on_this_case}`, so letterOffer() returns null and the pair does
    // not arrive together. But it is a fact about what src/uc03/letterOffer.js
    // currently sends, not a property of this page, and nothing here would
    // notice if it changed. The CONCLUSION was wrong outright: a letter is not
    // "in their hands" until they can open it, and the whole reason this order
    // is being revisited is a traveller who had one issued and could not reach
    // it. You do not ask somebody whether they would like a document you have
    // already written for them. So the collection goes first, and if the pair
    // ever does arrive the reader gets the document rather than the question.
    //
    // (The report that sent this pair here was of a different defect, and it is
    // worth not confusing them: what the project owner saw was one offer card —
    // the letter OFFER, accepted in place — showing a green "written and issued"
    // banner with no way to open the letter. That was acceptLetterOffer()
    // mutating its own box, not offersOn() building two.)
    var built = [];
    [continuationOffer, letterCollection, letterOffer].forEach(function (build) {
      var node = build(payload);
      if (node) built.push(node);
    });
    return built;
  }

  /**
   * The shell every offer is built into: one box, one real heading.
   *
   * THE HEADING IS A REAL HEADING AND NOT A BADGE, because it has to read as
   * the title of a section rather than as a chip beside one — "Also available,
   * dialog" is not a name for anything.
   *
   * IT IS AN <h4> AND IT USED TO BE AN <h3>, and the demotion is the whole
   * shape of this change. The offer used to be the top of the dialog and so the
   * dialog's accessible name; the ANSWER is now the top of it (an <h3>, under
   * the card's own <h2>), and the offer is a RECOMMENDATION underneath the
   * answer. The document outline should say so, because that is the one
   * statement of the hierarchy a screen-reader user gets. The styling is
   * unchanged — `.interstitial-title` carries it and does not care about the
   * tag.
   *
   * It carries no id here — promoteToInterstitial() assigns the one the dialog
   * falls back to when there is no answer to be labelled by, so two offers on
   * one payload cannot both claim the same id.
   */
  function offerBox(className, headline) {
    var box = el("div", "continuation-offer" + (className ? " " + className : ""));
    box.appendChild(el("h4", "interstitial-title", headline));
    return box;
  }

  /** The dialog's accessible name, in the two places it can come from, named
   *  once each so a heading and the label pointing at it cannot drift apart.
   *  The ANSWER's heading is the name whenever there is an answer; the promoted
   *  offer's is the fallback for a payload that carries no plain answer at all
   *  (an older deployment answering a newer page). */
  var ANSWER_TITLE_ID = "portal-answer-title";
  var INTERSTITIAL_TITLE_ID = "portal-interstitial-title";

  /**
   * Mark one offer as the interruption: the styling that says "read this" and
   * the id the dialog is labelled by. Returns the node so a caller can append and
   * present it in one expression.
   */
  function promoteToInterstitial(node) {
    node.className += " interstitial";
    var heading = node.querySelector(".interstitial-title");
    if (heading) heading.id = INTERSTITIAL_TITLE_ID;
    return node;
  }

  /**
   * The dismiss control every interstitial carries.
   *
   * THERE HAS TO BE ONE, and it has to take nothing away. This node is shown as
   * a modal the moment the result renders; a modal with no way out is a trap,
   * and a modal whose content vanishes when you leave it has removed something
   * from the page. Dismissing closes the dialog and the node lands where it was
   * always going to be — see presentResultDialog().
   */
  function dismissButton(label) {
    var dismiss = el("button", "r-btn r-btn-secondary");
    dismiss.type = "button";
    dismiss.textContent = label || "Not now";
    dismiss.setAttribute("data-interstitial-dismiss", "true");
    return dismiss;
  }

  // -- UC-03 -> UC-04: the interruption, not the lecture ---------------------
  //
  // WHAT THIS CONTROL IS. A `route_to_uc04` used to end the journey: the
  // requester was told, correctly, that nothing had been dispatched and that a
  // work-authorization request had to be raised in Remote — and then had no
  // way to take a single further step here. The one person who can unblock the
  // request was the one person with nothing to click.
  //
  // WHY IT MOVED TO THE TOP AND LOST ITS PROCEDURE. It used to be a block at
  // the very bottom of the result: a headline, a four-step numbered procedure
  // for Remote's own Requests section, a paragraph about which API operations
  // exist, and only then the button. Several screens below the fold, after the
  // gate ladder and the facts table. The DECISION here is "this is a different
  // request" — so the page now says that first, and offers the one thing the
  // employee can do about it. The removed prose is described in
  // src/portal/uc03Continuation.js's WORK_AUTHORIZATION_NOTICE: the steps
  // narrated Remote's own product back to a Remote employee, and the API
  // paragraph explained our engineering constraint to a traveller.
  //
  // WHAT IT IS NOT, AND THIS IS THE WHOLE DESIGN. It does not submit anything.
  // Clicking it posts to /api/requests/uc03/continue, which runs no gate,
  // creates no UC-04 record and creates nothing in Remote — it authenticates
  // the employee, confirms the routing is theirs, records that they asked, and
  // answers with what carries across. The employee then reads a prefilled form
  // and submits it themselves. That deliberate act is the entire difference
  // between the employee raising a work authorization (Remote's own flow, on
  // the surface this portal stands in for) and UC-03's automation raising one
  // on their behalf — which src/uc03/uc04Intake.js refuses and this page does
  // not sneak past. A redirect that quietly submitted would be that refusal,
  // undone, wearing a button. That honesty now costs one sentence instead of a
  // numbered list.
  //
  // THE OFFER IS THE SERVER'S. This function branches on `continuation.available`
  // and on no decision string of its own: `available` is false for every UC-03
  // outcome that produced no handoff event, which is every outcome that is not
  // a routing. No comparison against a decision string appears in this file.
  function continuationOffer(payload) {
    var offer = payload.continuation;
    if (!offer || offer.available !== true || !offer.caseId || !offer.notice) return null;

    var box = offerBox(null, offer.notice.headline);
    box.appendChild(el("p", "result-reason", offer.notice.sentence));

    if (offer.stillNeeded && offer.stillNeeded.length) {
      box.appendChild(
        el(
          "p",
          "small r-secondary",
          "You will be asked for " +
            offer.stillNeeded.length +
            (offer.stillNeeded.length === 1 ? " thing." : " things.")
        )
      );
    }

    // WHO WILL BE SIGNED IN ON THE NEXT SCREEN, SAID BEFORE THEY GET THERE.
    //
    // THE REPORT. An employee took this offer as himself and wrote: "i noticed
    // i was chris lee in uc-03 and became admin instantly i was redirected to
    // uc-04." The switch is real, deliberate and correct — UC-04's identity
    // gate wants a company session because the assessment is the employer's
    // stage — and it happened with no warning, so the first thing he learned on
    // the new form was that he was somebody else. A person who has just been
    // silently swapped does not trust the rest of the screen, and he then read
    // every empty box as a puzzle rather than as a question.
    //
    // ONE SENTENCE, AND ONLY THE HALF HE CAN ACT ON. Not which gate compares
    // what, not why the session object needs a company id — that reasoning is
    // in applyContinuation()'s "THE SESSION MOVES" comment, where it belongs.
    // What a traveller needs is that the next form is filled in by their
    // employer's admin and that it is still their trip, so that neither the
    // change of name nor the request's subject is a surprise.
    //
    // PAGE-AUTHORED, exactly as LETTER_OFFER_HEADLINE is: the server sends
    // `headline`, `sentence`, `action` and `dismiss`, and no statement about
    // the session. The same one-line server change would move it, and until
    // then a reader learning this from us beats a reader learning it from the
    // persona picker.
    box.appendChild(
      el(
        "p",
        "small r-secondary",
        "Your employer's admin completes this next part, so the form opens signed in as them. It is still your trip, and your name is on it."
      )
    );

    var buttons = el("div", "interstitial-buttons");
    var button = el("button", "r-btn r-btn-primary");
    button.type = "button";
    button.textContent = offer.notice.action;
    button.addEventListener("click", function () {
      openContinuation(offer.caseId, button, box);
    });
    buttons.appendChild(button);

    buttons.appendChild(dismissButton(offer.notice.dismiss));

    box.appendChild(buttons);
    return box;
  }

  /**
   * Open the result in a modal — the ANSWER first, and the recommendation
   * under it — and put every piece of it back on the page when it closes.
   *
   * ------------------------------------------------------------------------
   * WHAT INVERTED, AND WHY IT IS NOT A REVERSAL OF fef494b'S RULE
   * ------------------------------------------------------------------------
   * fef494b wrote the predicate down: A RESULT EARNS A MODAL WHEN IT OFFERS THE
   * READER A NEXT ACTION THEY WOULD OTHERWISE HAVE TO SCROLL TO FIND — and, on
   * that reading, one use case of seven earned one. The reasoning behind the
   * refusals was that an interruption carrying nothing actionable trains people
   * to dismiss without reading, and the next thing they dismiss unread is the
   * 🔴 disclaimer. That reasoning is intact and it is why this is still one
   * dialog carrying at most one offer.
   *
   * What the project owner corrected is its PREMISE: "I want the answer for
   * everything to always be in the pop up, and then in this case a
   * recommendation." AN ANSWER IS NOT NOTHING. It is the single thing the
   * requester came for, and on this page it is the thing they have to scroll to.
   * So the rule is now: THE MODAL CARRIES THE ANSWER, AND THE RECOMMENDATION
   * WHEN THERE IS ONE.
   *
   * ------------------------------------------------------------------------
   * THE MEASUREMENT THAT DECIDED "ALWAYS", RATHER THAN "WHEN IT IS OFF-SCREEN"
   * ------------------------------------------------------------------------
   * Two readings were defensible: every result opens with the answer in a
   * dialog, or only the results whose answer is not already the first thing on
   * screen. 267b01d puts the plain answer at the TOP of the panel body, so on a
   * short result it might already be visible — in which case a dialog would add
   * an interaction and remove nothing.
   *
   * Measured rather than assumed, in Chromium, one quick-fill per request type,
   * `window.scrollY === 0` throughout — the distance from the top of the
   * viewport to the answer's first pixel:
   *
   *              1180x900          340x740
   *   UC-02       1153px            2090px
   *   UC-03        926px            1681px
   *   UC-04       1795px            3707px
   *   UC-05       1653px            3251px
   *   UC-07       2037px            3887px
   *   UC-08       1482px            2831px
   *   UC-09       1246px            2196px
   *
   * Fourteen measurements, fourteen below the fold, the nearest of them 26px
   * past it and the furthest more than five screens down. The reason is
   * structural rather than incidental: the result panel renders BELOW the form
   * that produced it, the forms are long, and nothing scrolls. So the condition
   * "only when the answer is off-screen" is not a different rule from "always"
   * — it is the same rule with a test that is currently true every time, and
   * paying for it would mean branching on getBoundingClientRect() in a file
   * whose whole discipline is that it renders what it is given. It is written
   * as "always", with the numbers above as the thing to re-measure if the page
   * ever scrolls its result into view or the forms get short.
   *
   * (INTAKE REFUSALS ARE THE ONE OUTCOME LEFT OUT, and they were measured too —
   * 1152px/1482px wide, 2108px/2781px narrow, equally below the fold. They are
   * left out for a reason and not by omission: a refused submission is a
   * CORRECTION LOOP. Their form is still on screen with their answers in it and
   * their next act is to fix it, so a modal would cost a dismissal on every
   * attempt; and by 267b01d's deliberate design a refusal carries no
   * plainAnswer, so a dialog there would have to be labelled by a heading this
   * page invented, which is the one thing it may not write. render() scrolls
   * that panel into view instead — the answer is reached without scrolling
   * either way, and the loudness matches what the reader has to do next.)
   *
   * ------------------------------------------------------------------------
   * MECHANICS
   * ------------------------------------------------------------------------
   * WHY <dialog> AND NOT A HAND-ROLLED OVERLAY. A modal has to trap focus, be
   * labelled, close on Escape, restore focus to where it came from, and hide
   * the rest of the page from assistive technology. `showModal()` does every
   * one of those in the browser engine; a div-with-a-fixed-position does none
   * of them, and the versions of it people write by hand get the focus trap
   * subtly wrong. An inaccessible dialog would be worse than the wall of text
   * it replaces.
   *
   * ONE NODE EACH, NOT COPIES. Every part is built once by render(), appended
   * where it belongs in the panel, and MOVED into the dialog — so there is one
   * button, one listener and one set of words. Two copies would be two places
   * for the same sentence to drift.
   *
   * RESTORED BACK TO FRONT, which is the one non-obvious line in here. Each
   * part remembers the sibling it sat before, and the answer's remembered
   * sibling IS the recommendation. Putting the answer back first would ask the
   * DOM to insert it before a node that is still inside the dialog. Walking the
   * list in reverse puts each anchor back before anything needs to be inserted
   * ahead of it.
   *
   * IT DEGRADES TO THE PAGE. If `showModal` does not exist the parts simply
   * stay where render() put them, at the top of the result, and render() scrolls
   * the first of them into view. The information is reachable either way; the
   * dialog only decides how loudly it arrives.
   */
  function presentResultDialog(parts) {
    var live = (parts || []).filter(Boolean);
    if (!live.length) return null;
    if (typeof document.createElement("dialog").showModal !== "function") return null;

    var dialog = el("dialog", "interstitial-dialog");
    // ONE CARD INSIDE THE DIALOG, holding the answer and the recommendation as
    // one thing to read. Before this there was only ever one node in here and
    // it could carry the card treatment itself; two nodes each carrying it
    // would read as two stacked panels floating over the page.
    var panel = el("div", "interstitial-panel");
    dialog.appendChild(panel);

    // -- THE WAY OUT, AND WHY IT IS AT THE TOP --------------------------------
    //
    // The project owner: "I also noticed your popup had no way to exit it."
    // There was one — a "Close" appended after the last block, or the promoted
    // offer's own dismiss — and both of them sat at the BOTTOM of a panel that
    // is capped at `calc(100vh - 48px)` and scrolls (style.css,
    // `.interstitial-panel`). An answer plus a letter recommendation with three
    // certified facts and a sign-off note is taller than that on a phone, so
    // the only exit was below the fold OF THE MODAL ITSELF. A control you have
    // to scroll a trap to find is not a way out; it is the same trap with a
    // footnote.
    //
    // So the close control is now the panel's own chrome: first child, above
    // the answer's heading, present on EVERY dialog this page opens — all seven
    // use cases, offer or no offer, not just the one that was reported. It is
    // the first thing in the panel and therefore the first thing reachable by
    // keyboard, which is also where a screen-reader user expects it.
    //
    // IT IS NOT THE OFFER'S DISMISS AND CARRIES A DIFFERENT ATTRIBUTE. The
    // promoted offer keeps its own button and its own word — "Not now" — which
    // is a decision ABOUT THE OFFER; this one is a decision about the dialog.
    // The two are not "identical doors": one declines a thing, the other puts
    // the page back. They are told apart by attribute so each is asserted for
    // what it is (`data-dialog-close` here, `data-interstitial-dismiss` there).
    //
    // LABELLED WITH A WORD, NOT A GLYPH. A bare "✕" needs CSS to be a close
    // button rather than a stray character, and the stylesheet is not this
    // change's to write; "Close" is unambiguous with no styling at all, and is
    // what an assistive technology reads either way.
    var chromeClose = el("button", "r-link-button interstitial-close", "Close");
    chromeClose.type = "button";
    chromeClose.setAttribute("data-dialog-close", "true");
    chromeClose.setAttribute("aria-label", "Close");
    panel.appendChild(chromeClose);

    // THE ACCESSIBLE NAME IS THE ANSWER'S HEADING. It used to be the offer's,
    // which was right when the offer was the only thing in here and is wrong
    // now: a dialog is named by what it is about, and it is about what happened
    // to their request. The fallback is the promoted offer's own heading, for a
    // payload that carries no plain answer at all.
    var title = live[0].querySelector(".plain-answer-lead, .interstitial-title");
    if (title && title.id) dialog.setAttribute("aria-labelledby", title.id);

    var spots = live.map(function (node) {
      return { node: node, home: node.parentNode, anchor: node.nextSibling };
    });
    spots.forEach(function (spot) {
      panel.appendChild(spot.node);
    });
    document.body.appendChild(dialog);

    // THE BOTTOM "CLOSE" ROW HAS GONE. It used to be appended after the last
    // block whenever no offer supplied a dismiss — the control the chrome close
    // above now is, in the one place a scrolled panel could hide it. Nothing
    // else was ever put in that row, so it went whole.

    function restore() {
      // Back to exactly where each was in the result, LAST FIRST — see the
      // header. A dismissed answer is a quieter answer and never a missing one.
      for (var i = spots.length - 1; i >= 0; i -= 1) {
        if (spots[i].home) spots[i].home.insertBefore(spots[i].node, spots[i].anchor);
      }
      // WHERE THE KEYBOARD LANDS, and why the browser cannot answer it here.
      // <dialog> restores focus to whatever had it when showModal() ran — and
      // in this flow that is <body>, because submit() disables the submit
      // button while the request is in flight, which blurs it, and re-enabling
      // does not take focus back. So the engine faithfully restores focus to
      // nothing, and a keyboard user who presses Escape is dropped at the top
      // of the document with the whole page to tab through again. Checked in a
      // real browser rather than assumed: document.activeElement reads BODY.
      //
      // It lands on the FIRST part — the answer — which is also what carries a
      // reader who dismissed with a mouse down to it, since focusing a node
      // scrolls it into view and the answer is a screen or more below the fold.
      //
      // Only when the browser's own restoration had nowhere to go. If focus WAS
      // restored somewhere real, the browser has done the right thing and this
      // must not overrule it.
      if (!document.activeElement || document.activeElement === document.body) {
        live[0].setAttribute("tabindex", "-1");
        if (live[0].focus) live[0].focus();
      }
      if (dialog.parentNode) dialog.parentNode.removeChild(dialog);
      // AND THE DISMISS CONTROL GOES WITH THE DIALOG. It exists to close a
      // modal; on the page there is no modal to close, so leaving it there
      // would leave a control that does nothing — which reads as broken rather
      // than as finished. The action beside it still works, which is the whole
      // point of restoring the nodes instead of destroying them. The chrome
      // close needs no line of its own: it was never inside one of the restored
      // blocks, so it leaves with the dialog it belongs to.
      var spent = live
        .map(function (node) {
          return node.querySelector("[data-interstitial-dismiss]");
        })
        .filter(Boolean)[0];
      if (spent && spent.parentNode) spent.parentNode.removeChild(spent);
    }
    // Fires for Escape as well as for close() — the browser's own dismissal and
    // ours end in the same place, which is the only way they cannot diverge.
    // Focus goes back to whatever opened the dialog; where the browser has
    // nowhere to put it (see restore()) it lands on the answer.
    dialog.addEventListener("close", restore);

    // THE THREE WAYS OUT A MODAL IS EXPECTED TO HAVE, and this had one and a
    // half: the control, which was below the panel's own scroll fold, and
    // Escape. Both of the others are here now.
    //
    //   1. THE CONTROL — the chrome close at the top of the panel, above.
    //   2. ESCAPE — the browser's, via the "close" event listener above. Not
    //      re-implemented: a keydown handler of our own would be a second
    //      dismissal path free to diverge from the engine's.
    //   3. THE BACKDROP — a click on the dimmed area outside the card. It was
    //      genuinely missing, and it is the one most people reach for first.
    chromeClose.addEventListener("click", function () {
      dialog.close();
    });
    // A <dialog> in the top layer receives clicks on its own ::backdrop as
    // clicks on the DIALOG element itself; a click anywhere on the card inside
    // it reports that inner node as the target. So `target === dialog` is
    // exactly "outside the card", with no coordinate arithmetic and nothing to
    // get wrong at the edges. Guarded because the event object is the only
    // thing this handler reads and a caller that dispatches without one (the
    // test sandboxes do) must not turn a stray click into a dismissal.
    dialog.addEventListener("click", function (event) {
      if (event && event.target === dialog) dialog.close();
    });

    // THE OFFER'S OWN DISMISS still closes the dialog, and still says the
    // server's word for declining ("Not now"). It is a decision about the
    // offer; the chrome close is a decision about the dialog.
    var dismiss = dialog.querySelector("[data-interstitial-dismiss]");
    if (dismiss) {
      dismiss.addEventListener("click", function () {
        dialog.close();
      });
    }
    dialog.showModal();
    return dialog;
  }

  /**
   * Take the reader to a block they would otherwise have to scroll to find.
   *
   * The quiet half of the same instruction the dialog answers loudly, and the
   * one an intake refusal gets: their form is still on screen with their
   * answers in it, and a modal between them and their correction would be
   * dismissed on every attempt. Nothing is announced by it — `#result-ucNN` is
   * already an `aria-live="polite"` region, so a screen reader has the refusal
   * without being moved anywhere, and moving focus here would announce it
   * twice.
   */
  function bringIntoView(node) {
    if (!node || typeof node.scrollIntoView !== "function") return;
    try {
      node.scrollIntoView({ block: "center", behavior: "smooth" });
    } catch (err) {
      node.scrollIntoView();
    }
  }

  // -- UC-03: the answer that is allowed to become the letter ----------------
  //
  // THE SECOND OFFER, AND THE SECOND INTERRUPTION. The project owner, looking
  // at this block: "I should not have to scroll up to see this, it should be a
  // popup, plus redirect if need be." It sat at the very bottom of a long
  // result — under the decision, the gate ladder and the facts table — so a
  // traveller who did not scroll never learned the letter existed, which made
  // an offer that is built, tested and correct reachable by nobody. It is now
  // an offer in offersOn()'s sense and is promoted to the modal on the one
  // outcome that carries it.
  //
  // WHAT CAME OFF IT: `offer.reason` — "Every gate passed, so the same trip can
  // be certified in a formal travel letter — drafted from this decision and
  // issued only after a Travel & Mobility Support specialist signs it off."
  // Every clause of it is already on this panel. "Every gate passed" is the
  // decision in the head of the result and every rung of the ladder under it;
  // "the same trip can be certified in a formal travel letter" is now the
  // heading; and the drafting and the sign-off are said at greater length, and
  // with the fact the sentence lacks, by `signoffNote` two lines down —
  // "Nothing is sent to you or to anyone else before that". A heading followed
  // by prose that says the heading again is what the editorial sweep removes,
  // and it would be worst of all inside a dialog, where the body would be
  // restating its own title.
  //
  // THE HEADING IS A QUESTION ADDRESSED TO THE READER, and that is a different
  // kind of sentence from the one it replaces. It read "A formal travel letter
  // for this trip" — a label for a feature, which ASSERTS that the letter
  // exists and leaves the reader to work out whether the assertion is about
  // them. It now reads "Do you need a formal letter for your trip?", which is
  // the decision actually in front of them, and the only one this block asks
  // them to make. The project owner, on the modal that opened with the label:
  // "I want the answer for everything to always be in the pop up, and then in
  // this case a recommendation, starting with something like 'Do you need a
  // formal letter for your trip?'"
  //
  // AND IT IS NOW SUBORDINATE TO THE ANSWER, not a substitute for it. The
  // dialog opens with what happened to their request (plainAnswerBlock()); this
  // is the recommendation underneath it. A reader who wants neither closes the
  // dialog having already had the thing they came for, which is the whole
  // reason the inversion is worth doing.
  //
  // STILL THIS PAGE'S OWN WORDS, which is the one thing here that is not the
  // server's, and it is still a label rather than a policy: the badge it
  // originally replaced ("Also available") was page-authored too. The server
  // has no headline to give — src/uc03/letterOffer.js's `describeLetterOffer()`
  // sends `reason`, `produces`, `label`, `signoffNote` and `carries` and no
  // notice block, unlike the continuation's WORK_AUTHORIZATION_NOTICE.
  // REPORTED AS A ONE-LINE SERVER CHANGE rather than made here, because
  // src/uc03/ is not this build's territory: give describeLetterOffer() a
  // `notice: {headline, sentence, action, dismiss}` in the shape
  // uc03Continuation.js already uses, and this constant goes away.
  //
  // WHAT THIS OFFER MEANS AND WHO MAY ACCEPT IT IS UNCHANGED. It is the
  // TRAVELLER's, accepted with the traveller's own server-held session, which
  // is why this page can carry a button at all and why the ZAF sidebar renders
  // the same offer read-only (test/zafUc03LetterOffer.test.js). Moving where it
  // appears is not a change to what it is.
  var LETTER_OFFER_HEADLINE = "Do you need a formal letter for your trip?";

  // WHAT THIS CONTROL IS. An employee asked whether a business trip was fine,
  // cleared every gate, and got an informational answer. If they then need the
  // formal letter — for a visa appointment, or to hand to a border officer —
  // they used to have to file a SECOND request, phrased so the classifier
  // detected a letter ask. src/uc03/letterOffer.js removed that second request:
  // the answer now OFFERS the letter, and accepting re-runs the same gates on
  // the same reading. This is the first surface that shows the offer to the
  // person it was made to.
  //
  // WHY THE TRIP IS PRINTED AND NOT JUST A BUTTON. The whole point of the offer
  // is that the employee does not restate the trip — which means the offer has
  // to SHOW them the trip it is about, or clicking it is agreeing to a document
  // they have not read. The three values come from `carries` on the server's
  // own offer; they are the same three the informational answer already told
  // them, and the server sends the sentence saying what to do if one is wrong.
  //
  // IT IS NOT A LETTER BUTTON. Accepting records a second decision and DRAFTS
  // the letter; a Travel & Mobility Support specialist signs it off, and that
  // signature is the only thing that issues anything. The wait is stated before
  // the click (`signoffNote`), because an offer that reads as "get a letter"
  // and then produces a wait is a worse experience than the one it replaced.
  //
  // THE OFFER IS THE SERVER'S. This function branches on `letterOffer.offered`
  // and on no decision string of its own — the server sends `null` on every
  // outcome that is not an auto-resolve and `{offered:false}` on an
  // auto-resolve whose offer cannot be taken. No comparison against the
  // auto-resolve decision string appears anywhere in this file — the same rule
  // continuationOffer() follows, and the same one test/portal.test.js pins.
  function letterOffer(payload) {
    var offer = payload.letterOffer;
    if (!offer || offer.offered !== true || !offer.caseId || !offer.accept) return null;

    var box = offerBox("letter-offer", LETTER_OFFER_HEADLINE);
    // WHAT THE LETTER IS. `produces` is the server's, and it is the sentence
    // that carries facts a heading cannot: whose letterhead, what it confirms,
    // and what it is for.
    if (offer.produces) box.appendChild(el("p", "result-reason", offer.produces));

    var carries = offer.carries || {};
    box.appendChild(el("p", "small letter-offer-lead", "It would certify:"));
    var facts = el("ul", "continuation-list");
    [
      {
        label: "Destination",
        // THE NAME, AND THE CODE ONLY WHERE THERE IS NO NAME. This row read
        // "Spain (ES)", and the comment defending the code argued from the
        // AUDIT: the code is what the gates compared and what the audit row
        // carries. Both facts are true and neither is about this reader. The
        // person here is a traveller being asked to check, before they accept,
        // that the letter is about the right trip — and "Spain" is what they
        // check it against. The audit row still carries the code; nothing about
        // what is recorded changes by not printing it at somebody who cannot
        // use it. The project owner's standing rule, given twice: full country
        // names on every screen a person reads.
        //
        // THE CODE SURVIVES AS THE FALLBACK, and that is not a leftover: the
        // server sends `destinationName: null` for a code it cannot name, and
        // showing the raw code then is better than a blank or a guess — it is
        // the one string the reader can go and look up. Same rule as
        // countryLabel() server-side, and no name is ever invented here.
        value: carries.destinationName || carries.destinationCountry,
      },
      { label: "First day", value: carries.startDate },
      { label: "Last day", value: carries.endDate },
    ].forEach(function (fact) {
      var li = el("li");
      li.appendChild(el("strong", null, fact.label));
      // A value the record does not hold is SAID to be missing rather than
      // left as an empty line — the one thing a person must be able to do
      // here is notice that a figure is wrong or absent before it reaches a
      // document a consulate reads.
      li.appendChild(document.createTextNode(" — " + (fact.value ? String(fact.value) : "not recorded")));
      facts.appendChild(li);
    });
    box.appendChild(facts);
    if (carries.correction) box.appendChild(el("p", "small r-secondary", carries.correction));
    if (offer.signoffNote) box.appendChild(el("p", "small r-secondary", offer.signoffNote));

    var buttons = el("div", "interstitial-buttons");
    var button = el("button", "r-btn r-btn-primary");
    button.type = "button";
    // The server's own label for what accepting does.
    button.textContent = offer.label || "Request a formal travel letter";
    var status = el("p", "action-status");
    status.setAttribute("role", "status");
    button.addEventListener("click", function () {
      acceptLetterOffer(offer, button, status, box);
    });
    buttons.appendChild(button);
    buttons.appendChild(dismissButton(null));
    box.appendChild(buttons);
    box.appendChild(status);
    return box;
  }

  // -- the letter that already exists ----------------------------------------
  //
  // THE OTHER HALF OF THE QUESTION ABOVE. `letterOffer` is for an answer that
  // COULD become a letter. This is for one that already IS one: since the
  // standard letter began issuing itself with nobody in the path, an employee
  // can ask for a visa support letter, have it written, hashed, stored and
  // issued — and be shown a result with no sign that any document exists. The
  // one person the letter is about was the one person with nothing to click.
  // "A travel letter was requested. It should be recorded, and the user should
  // be able to download the letter. The question now is: from where?"
  //
  // WHETHER THERE IS A CONTROL IS NOT DECIDED HERE. `letter.collect` is
  // src/uc03/letterDelivery.js's verdict, relayed by src/portal/letterAccess.js
  // — the same verdict the fetch route runs and the same one the requester's
  // history row is built from. A letter that is DRAFTED and held for a
  // specialist has no `collect`, so this returns null and the reader is told
  // where it is by the facts table instead of being offered a document the
  // sign-off gate exists to withhold. No decision string is compared in here.
  //
  // A PAGE-AUTHORED LABEL, exactly as LETTER_OFFER_HEADLINE is one, and for the
  // same reason: the server sends the state and the sentence, not a headline.
  // GENERIC ON PURPOSE (round-6 D-01/D-03): this box now renders for UC-01's
  // employment verification letter as well as UC-03's travel letter, and
  // `letter` (src/portal/letterAccess.js's return shape) carries no `type` to
  // pick a more specific noun from — `letter.detail`, printed immediately
  // below, is the server's own sentence and already names which document it is.
  var LETTER_READY_HEADLINE = "Your letter is ready";

  function letterCollection(payload) {
    var letter = payload.letter;
    if (!letter || !letter.collect || !payload.recordId) return null;

    var box = offerBox("letter-offer", LETTER_READY_HEADLINE);
    if (letter.detail) box.appendChild(el("p", "result-reason", letter.detail));

    // rca-lapd (R7-12): when THIS SAME result also joined an already-claimed
    // delivery — a second click on a request already in flight — that fact
    // belongs here, as a plain follow-on line under the "ready" headline
    // above, not as a second, amber-styled panel underneath it. Two panels
    // that both talk about this one result, one reading "ready" and the other
    // reading "refused", is what a tester meant by "did that work or not?" —
    // the panels disagreed with each other about the same outcome. The
    // standalone notice below skips itself for exactly this reason, so this is
    // the only place these fields render whenever a letter is also ready.
    if (payload.alreadyHandled === true) {
      if (payload.duplicateExplanation) {
        box.appendChild(el("p", "small r-secondary", payload.duplicateExplanation));
      }
      if (payload.duplicateOf) {
        box.appendChild(el("p", "small r-secondary", "Reference already claimed: " + payload.duplicateOf));
      }
      if (payload.alreadyDecidedAt) {
        box.appendChild(el("p", "small r-secondary", "First decided at " + payload.alreadyDecidedAt));
      }
      if (payload.duplicateWindowExpiresAt) {
        box.appendChild(
          el(
            "p",
            "small r-secondary",
            "This hold clears automatically at " +
              payload.duplicateWindowExpiresAt +
              " — a request made after that time is not affected by this one."
          )
        );
      }
    }

    var status = el("p", "action-status");
    status.setAttribute("role", "status");

    var buttons = letterCollectionControls(letter, payload.recordId, status);
    buttons.appendChild(dismissButton(null));
    box.appendChild(buttons);
    box.appendChild(status);
    return box;
  }

  /**
   * The two controls that hand a letter over: open it, or save it.
   *
   * ONE BUILDER, TWO PLACES, because the letter can be reached from two and
   * only one of them had it. A result that ARRIVES carrying an issued letter is
   * letterCollection() above. A result that BECOMES one — the traveller accepts
   * the offer on an already-answered trip, and the 🟢 path writes and issues the
   * letter in that same call — is acceptLetterOffer(), which showed the
   * server's "written and issued" sentence and offered nothing to press. The
   * project owner, looking at exactly that panel: "so now, how do i get my
   * letter?" He could not, from there.
   *
   * IT DECIDES NOTHING ABOUT WHO MAY HAVE IT. `letter.collect` is
   * src/uc03/letterDelivery.js's verdict either way — relayed through
   * src/portal/letterAccess.js on the intake response and, for the accept
   * response, computed against the NEW case by the same letterOnCase() call. A
   * letter that is drafted and held for a signature has no `collect`, so
   * neither caller builds a button, and the sign-off gate is not something this
   * page can talk its way past. Nothing is fetched until one is pressed.
   */
  function letterCollectionControls(letter, recordId, status) {
    var request = { recordId: recordId };
    var buttons = el("div", "interstitial-buttons");

    var open = el("button", "r-btn r-btn-primary");
    open.type = "button";
    open.textContent = "Open the letter";
    open.addEventListener("click", function () {
      collectLetter(request, letter, status, function (body) {
        showLetter(body);
      });
    });
    buttons.appendChild(open);

    var save = el("button", "r-btn r-btn-secondary");
    save.type = "button";
    save.textContent = "Save it";
    save.addEventListener("click", function () {
      collectLetter(request, letter, status, function (body) {
        saveLetter(body, status);
      });
    });
    buttons.appendChild(save);

    // rca-cput: the same PDF option documentCell() offers on "My requests",
    // offered here too — this panel is the FIRST place an employee sees the
    // letter, immediately after it issues, and is exactly where the bug was
    // observed ("'Save it' downloads … .html … no PDF option anywhere").
    if (letter.collectPdf) {
      var savePdf = el("button", "r-btn r-btn-secondary");
      savePdf.type = "button";
      savePdf.textContent = "Save as PDF";
      savePdf.addEventListener("click", function () {
        collectLetter(request, letter, status, function (body) {
          saveLetter(body, status);
        }, "collectPdf");
      });
      buttons.appendChild(savePdf);
    }
    return buttons;
  }

  /**
   * Accept the offer. Records a second decision and drafts a letter; it issues
   * nothing, and the page says so in the server's words either way.
   *
   * The path is the server's (`offer.accept`), and the persona is sent as a KEY
   * — the session behind it is the server's own, from src/portal/personas.js,
   * so nothing this page could type names the employee the letter is about.
   */
  function acceptLetterOffer(offer, button, status, box) {
    button.disabled = true;
    status.className = "action-status";
    status.textContent = "Requesting…";
    api(offer.accept.path, {
      method: offer.accept.method || "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ persona: byId("persona").value, caseId: offer.caseId }),
    })
      .then(function (res) {
        return res.json().then(function (payload) {
          return { status: res.status, payload: payload };
        });
      })
      .then(function (result) {
        var body = result.payload || {};
        if (body.ok !== true) {
          // The server's own refusal, printed with its code. This page cannot
          // know what went wrong and does not guess — and the code is the
          // string somebody greps for.
          button.disabled = false;
          status.className = "action-status bad";
          status.textContent = "Not requested (" + (body.code || result.status) + "): " + (body.reason || "");
          return;
        }
        // The button is gone rather than re-enabled: the request is recorded,
        // and a second click is refused by the exactly-once ledger — offering
        // it again would invite a refusal the page itself already knows about.
        if (button.parentNode) button.parentNode.removeChild(button);
        // AND THE MODAL STOPS INTERRUPTING, because it has been taken up. The
        // node itself is not destroyed: closing moves it back into the result
        // carrying the confirmation and the rows below, where the reader can
        // re-read them beside the decision they came from. `closest` walks out
        // to the dialog this box may or may not currently live inside, so this
        // is a no-op once the offer has been dismissed onto the page.
        var openDialog = box && box.closest ? box.closest("dialog") : null;
        if (openDialog && openDialog.open) openDialog.close();
        status.className = "action-status ok";
        status.textContent = body.reason || "Requested.";

        // --- AND THEN, IF THERE IS A LETTER, THE WAY TO GET IT --------------
        //
        // THE DEFECT, IN THE PROJECT OWNER'S OWN FIVE WORDS. He submitted the
        // short business trip, accepted the offer on the answer, and read the
        // green sentence above: "Your travel letter has been written and issued
        // — it is attached to this request and posted to the ticket." Then:
        // "so now, how do i get my letter?" There was nothing to press. The
        // panel announced a document and gave no way to reach it, which is this
        // repository's most expensive recurring shape — correct, durable,
        // audited, and reaching nobody — with the document already written.
        //
        // WHY IT WAS MISSED FOR SO LONG. `letterCollection()` builds exactly
        // these controls, and it is built from the INTAKE response. This is the
        // ACCEPT response, on a panel that never re-renders, so a letter that
        // came into existence between the two was in a state no builder ran
        // for. The intake path was tested; this one had no letter to collect
        // when it was written, because accepting used to produce a draft held
        // for a signature and nothing else.
        //
        // THE SERVER DECIDES WHETHER THERE IS ANYTHING TO COLLECT, exactly as
        // it does on the intake response: `letterAccess.collect` is
        // src/uc03/letterDelivery.js's verdict against the new case and the
        // reader's own session. A drafted-and-held letter yields no `collect`
        // and therefore no button — the sentence above already says a
        // specialist has it — so no decision string is compared here and this
        // page cannot offer a document the collect route would refuse.
        if (body.letterAccess && body.letterAccess.collect && body.recordId) {
          status.parentNode.appendChild(
            letterCollectionControls(body.letterAccess, body.recordId, status)
          );
        }

        // WHAT CAME OFF THIS PANEL, AND WHY THE LIST KEEPS GETTING SHORTER.
        //
        // Three rows went earlier because they answer none of the four
        // questions the person who asked for this letter has: two internal
        // record ids ("This letter request", "Continues the answer") and the
        // decision word with its slug. All three are still on the response and
        // in the Zendesk note the specialist opens.
        //
        // TWO MORE GO NOW, and they are the same defect one degree subtler,
        // because both were TRUE and both were argued for in this file. They
        // read "Letter drafted — yes" and "Waiting on a specialist signature —
        // no", directly under a sentence that had just said the letter was
        // written and issued with no signature needed. The old comment defended
        // them as the whole of "do I have it yet?" — but that question is now
        // answered by the buttons above, and answered by handing the document
        // over rather than by describing its state. What was left was the same
        // fact three times, twice in our vocabulary: `letterDrafted` and
        // `awaitingSignoff` are the names src/uc03/workflow.js records, and a
        // yes/no beside each asks the reader to compose them into a meaning the
        // server's sentence already states. The project owner, on this exact
        // panel: "this info is useless to the user".
        //
        // THE HAND-OFF BLOCK IS NOW ONLY THE HALF A TRAVELLER CAN USE. It used
        // to render on any `ticketNote`, including the note that says none was
        // raised: "No Zendesk ticket: this decision needs no human, so raising
        // one would be noise in a real queue." That is our queue hygiene,
        // explained to an employee — nothing they can act on and nothing that
        // is their business. What stays is a ticket that EXISTS, because it is
        // a reference they can quote, and a hand-off that FAILED, because that
        // is a limit on their own request and an absence is never left silent
        // (docs/UI-AUDIENCES.md §5). Both branch on a server-sent fact rather
        // than on a decision string, and the full note is still on the response
        // and in the specialist's ticket.
        if (body.ticketId) {
          var handoff = el("div", "ticket-note");
          handoff.appendChild(el("span", "r-status r-status-ok", "Zendesk ticket #" + body.ticketId));
          if (body.ticketNote) handoff.appendChild(el("p", "small r-secondary", body.ticketNote));
          status.parentNode.appendChild(handoff);
        } else if (body.ticketError) {
          var failed = el("div", "ticket-note");
          failed.appendChild(el("span", "r-status r-status-warn", "Not handed over"));
          if (body.ticketNote) failed.appendChild(el("p", "small r-secondary", body.ticketNote));
          failed.appendChild(el("p", "small r-secondary", "Zendesk said: " + body.ticketError));
          status.parentNode.appendChild(failed);
        }
      })
      .catch(function (err) {
        button.disabled = false;
        status.className = "action-status bad";
        status.textContent = "Couldn't request the letter: " + err.message;
      });
  }

  /** Ask the server for the continuation. Nothing is submitted by this call. */
  function openContinuation(caseId, button, box) {
    button.disabled = true;
    api("api/requests/uc03/continue", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ persona: byId("persona").value, caseId: caseId }),
    })
      .then(function (res) {
        return res.json().then(function (payload) {
          return { status: res.status, payload: payload };
        });
      })
      .then(function (result) {
        button.disabled = false;
        if (!result.payload || result.payload.ok !== true) {
          // The server's own refusal, printed. No local guess at what went
          // wrong — this page cannot know, and the codes are the ones somebody
          // greps for.
          box.appendChild(
            el(
              "p",
              "action-status bad",
              "Couldn't continue (" + (result.payload && result.payload.code) + "): " + ((result.payload && result.payload.reason) || "")
            )
          );
          return;
        }
        // The form is about to be brought to the front; a modal still sitting
        // over it would hide the very thing this button exists to reach.
        // `closest` walks out of the interstitial to the dialog it may or may
        // not currently live inside, so this is a no-op once it is dismissed.
        var openDialog = box.closest ? box.closest("dialog") : null;
        if (openDialog && openDialog.open) openDialog.close();
        applyContinuation(result.payload);
      })
      .catch(function (err) {
        button.disabled = false;
        box.appendChild(el("p", "action-status bad", "Couldn't continue: " + err.message));
      });
  }

  /**
   * Land the employee on the UC-04 form with what UC-03 established already in
   * it, marked, and editable.
   *
   * EDITABLE IS NOT A CONCESSION, IT IS THE POINT. Three of the five carried
   * values came out of a classifier reading free text, and the server labels
   * each one `authority: "reading"` for exactly that reason. A reading is not a
   * fact. Locking them would turn one model's interpretation of a sentence into
   * the input a permanent-establishment assessment is made on, with nobody
   * having confirmed it.
   */
  function applyContinuation(data) {
    // THE FORM STARTS EMPTY. The continuation carries five fields and touches
    // nothing else, so without this every other box keeps whatever an earlier
    // interaction left in it — including a prior-stay row with a country and no
    // dates, which the server correctly refuses as `travel_history_unreadable`
    // and which nobody on this page ever chose. blankForm() carries the whole
    // argument and the reproduction.
    blankForm("uc04");
    pendingContinuation = {
      caseId: data.caseId,
      externalRef: data.externalRef,
      gaps: gapsFrom(data),
    };

    clearCarriedMarks();
    (data.prefill || []).forEach(function (item) {
      var node = byId(item.field);
      if (!node) return;
      // A null value is left BLANK rather than written as "null" or "": the
      // classifier did not read it, and an empty field says that honestly. The
      // still-needed list below names it in words.
      if (item.value !== null && item.value !== undefined) setFieldValue(node, item.value);
      markCarried(item);
    });

    // ...and then the same absences are marked ON THE BOXES THEMSELVES.
    //
    // WHY THIS EXISTS, in one sentence: a real employee continued a routing,
    // filled in the dates, the visa and the duties, missed the one unmarked box
    // in the middle of the grid, and got `blocked / factors_invalid /
    // missing_nationality` — decided at gate 5 of 17, before the risk matrix ran
    // at all. The gate was right. The page was the problem: it named the missing
    // things in a paragraph at the top and then rendered them as plain empty
    // inputs, visually identical to the optional "Evaluate as at" beside them,
    // while the fields that were ALREADY FILLED were the ones wearing a marker.
    // The one box that mattered was the only one with nothing on it.
    markGaps(pendingContinuation.gaps);

    var reason = byId("uc04-reasonText");
    if (reason && data.reasonText) reason.value = data.reasonText;

    // The shared reference, so the two decisions land under one string in the
    // audit trail. The server re-derives it from the durable UC-03 row and
    // overrides whatever is sent, so this only keeps the page honest about what
    // it is about to submit — it does not decide it.
    var refField = byId("uc04-externalRef");
    if (refField && data.externalRef) {
      setRefMode("uc04", "reuse");
      refField.value = data.externalRef;
    }

    // The manual fields live behind a collapsed <details>. A prefilled form
    // nobody can see is a form nobody will correct, and the four things still
    // being asked for are all inside it.
    var manual = document.querySelector("#form-uc04 .manual-fields");
    if (manual) manual.open = true;

    // THE SESSION MOVES, BECAUSE THE ACTOR DOES. UC-04's own identity gate
    // wants a company session (`session.companyId === employment.company_id`),
    // and it wants one because the assessment is the EMPLOYER's stage —
    // Remote's manager approval, which precedes Remote's own review. Leaving
    // the employee selected would produce `identity_not_verified`, a refusal
    // describing OUR plumbing while reading as a finding about their trip.
    //
    // The key is FOUND, never written down here: the first company-admin
    // persona the server offered. A literal would be a second copy of a
    // personas.js key, and the roster has already been rebuilt once.
    var adminPersona = ((context && context.personas) || []).filter(function (p) {
      return p.kind === "company_admin";
    })[0];
    var picker = byId("persona");
    if (picker && adminPersona) {
      picker.value = adminPersona.id;
      renderPersonaNote();
    }

    renderContinuationBanner(data);
    activate("uc04");
    var banner = byId("uc04-continuation");
    if (banner && banner.scrollIntoView) banner.scrollIntoView({ block: "start" });
  }

  /**
   * What the employee lands on at the top of the UC-04 form: a badge and one
   * closed disclosure. It used to carry two sentences between them; see the
   * comment at the bottom of the function for what they said and why the
   * heading alone now says it.
   *
   * IT USED TO BE TWENTY LINES, AND THAT WAS THE DEFECT. Everything true of
   * this flow was said on it: which stage of Remote's approval this is and why
   * the session picker moves, every carried value listed a second time beside
   * the boxes already holding them, every still-needed item with its own
   * sentence — four of which said the same thing in the same words — a
   * paragraph of schema evidence for nationality, and a paragraph on Remote
   * having no create endpoint for a work authorization. All of it accurate.
   * None of it needed by a person who has to fill in five boxes, and a reader
   * who has to get through it to reach the first input is a reader who skims,
   * which is how the box in the middle of the grid got missed in the first
   * place.
   *
   * HONEST IS NOT THE SAME AS VERBOSE, and this repo's disclosure discipline is
   * about not hiding what the system cannot do — not about saying it on every
   * surface. The reasons a field is empty are stated ONCE, together, behind a
   * disclosure nobody has to open; the engineering evidence behind them lives
   * where engineering evidence belongs and is named below rather than lost:
   *
   *   - Which stage this is, and why the persona picker moves to the company
   *     admin: applyContinuation()'s "THE SESSION MOVES" comment above.
   *   - That continuing creates nothing in Remote and submits nothing:
   *     openContinuation()'s header comment, and src/portal/uc03Continuation.js,
   *     which is the code that makes it true.
   *   - That no API creates a work authorization, and what the employee must do
   *     in Remote instead: still ON THE PAGE, one screen earlier — the UC-03
   *     result panel's own next-step block renders fileItInRemote in full,
   *     steps and all (see continuationOffer). Repeating it here was the second
   *     printing of something already read.
   *   - The nationality schema evidence: src/portal/uc03Continuation.js's
   *     NATIONALITY_IS_ASKED and its comment, plus the live-capture test in
   *     test/portalUc03ContinuationForm.test.js.
   *
   * WHAT IS NOT CUT is every control: each carried box still wears its mark,
   * each empty box still wears "(still needed)" and aria-required, and the
   * submission is still held back until they have answers. Prose came off the
   * page; nothing that tells the employee which box to type in did.
   */
  function renderContinuationBanner(data) {
    var box = byId("uc04-continuation");
    if (!box) return;
    clear(box);
    box.hidden = false;

    // WHOSE TRIP THIS IS, IN THE HEADING ITSELF.
    //
    // THE REPORT: "i noticed i was chris lee in uc-03 and became admin
    // instantly i was redirected to uc-04… i am finding it hard to fill in the
    // right things that will make this page be a success."
    //
    // WHAT WAS ACTUALLY WRONG, checked rather than assumed. The subject IS
    // carried and always was: the continuation's first prefill is
    // `uc04-employmentId` holding Chris's own employment id, `authority:
    // "record"`. Nothing was lost in the hand-over. But an ID is what carried,
    // and an id is not a person — the box reads
    // `8ab12460-b568-4c1e-af9d-09b1fabd8f46` while the sidebar now reads
    // somebody else's name, and nothing on the screen said the two belonged to
    // one request. A form that had kept every promise it made looked, to the
    // person reading it, like one that had lost him.
    //
    // WHY THE NAME GOES IN THE HEADING AND NOT IN A LINE UNDER IT. The rule
    // below is the project owner's — "remove this part, only the heading is
    // needed" — and a paragraph explaining the subject would be the prose that
    // rule removed, growing back with a better excuse. A heading may carry a
    // fact; that is the exception its own comment already names. So the fact
    // goes in, and no sentence comes with it. The other half of the surprise —
    // that the next screen is signed in as the employer's admin — is now said
    // BEFORE the redirect, on the offer the employee presses (see
    // continuationOffer), which is where a warning is worth something.
    //
    // THE NAME IS A LOOKUP, NOT A GUESS: the employment id the server carried,
    // matched against the persona roster the server sent. An id with no
    // matching persona prints the plain heading rather than a wrong name, so
    // this page never composes an identity.
    var subject = carriedSubjectName(data);
    box.appendChild(
      el(
        "span",
        "r-status r-status-warn",
        subject ? "Continued from " + subject + "\u2019s travel request" : "Continued from your travel request"
      )
    );

    // AND THAT IS THE WHOLE BANNER. The project owner, pointing at what used to
    // sit underneath it: "remove this part — only the heading is needed. Same
    // for every use case." The two sentences were "Working from another country
    // needs a work authorization check first, and this form is it. What your
    // travel request already told us is filled in below — check those answers,
    // then complete the boxes marked 'still needed'." The first half of that is
    // the heading again; the second half narrates the form the reader is
    // looking at — and the form already says it about itself, in the only place
    // it can be read against the actual boxes: each carried box wears its
    // "carried over" mark and each empty one wears "(still needed)" and
    // aria-required. Prose describing a control the reader is looking at is the
    // control described twice, and only one of the two can be wrong.
    //
    // A HEADING PLUS A FACT WOULD HAVE BEEN KEPT. "Spain, 14 September to 2
    // October, carried over" tells a reader something the heading cannot, and
    // that kind of line survives this rule wherever it appears. What went is the
    // restatement of the page's PURPOSE.
    //
    // NOTHING ABOUT WHAT THIS SYSTEM DID OR DID NOT DO WAS TOUCHED, here or
    // anywhere else in this sweep. That nothing was submitted by continuing,
    // that no work-authorisation case exists yet, the destination the router
    // read and the confidence it read it with — every one of those is a
    // statement about our own behaviour, and is how a requester knows whether
    // anything is waiting on them. They stay.

    // AND THEN THE ONE THING THE BANNER IS ALLOWED TO ADD: a way to finish.
    // Two worked completions of exactly the boxes that are still empty, written
    // by the server (src/portal/uc03Continuation.js's buildCompletions) and
    // rendered here. They are NOT the quick-fill row above the form: those name
    // a traveller of their own, and pressing one during a continuation is what
    // produced `continuation_subject_mismatch`.
    box.appendChild(completionRow(data));

    box.appendChild(whyBlank(data));
  }

  /**
   * "I do not know what to put in the rest of this."
   *
   * THE REPORT, in the project owner's words: *"if i am transferred from uc-03
   * to uc-04, some of my details are sent to, but clearly i do not know exactly
   * what to put in the remaining empty fields to ensure a success or a failure,
   * so this is where the 2nd prefill is. or have you solve this for a different
   * employee apart from chris, and i just need to switch to him?"*
   *
   * The answer to the second half was NO, and that is the whole defect: every
   * UC-04 quick-fill on this page names Anna, Amanda or Lars as the traveller,
   * so there was nothing waiting for the person who had just been routed here.
   * Pressing one to see what a valid answer looks like overwrote the employment
   * id the continuation had carried, and the server then refused the submission
   * for pointing at somebody else's trip.
   *
   * THE ONE PROPERTY THAT MAKES THESE DIFFERENT, and the reason the lead
   * sentence says it out loud: a completion writes ONLY into boxes the server
   * listed as still needed. The traveller, the home country, the destination
   * and any date the routing did read are never touched, so the link to the
   * UC-03 case survives, the persona does not move, and the two decisions still
   * land under one reference. src/portal/uc03Continuation.js builds the maps
   * and test/portalContinuationCompletions.test.js pins that they contain
   * nothing else.
   */
  function completionRow(data) {
    var completions = data.completions || [];
    if (!completions.length) return document.createDocumentFragment();

    // NO LEAD SENTENCE, and its absence is the project owner's standing rule
    // rather than an oversight: "remove this part — only the heading is needed.
    // Same for every use case." A line here saying what these buttons do would
    // be that paragraph growing back with a better excuse. The buttons say it
    // — "Fill the rest" — and the note below says what was filled, once one has
    // been pressed and there is something to report.
    var wrap = el("div", "continuation-completions");

    var row = el("div", "scenario-row");
    var note = el("p", "scenario-note");
    note.hidden = true;
    var buttons = [];

    completions.forEach(function (completion) {
      var button = el("button", "r-btn r-btn-secondary r-btn-sm");
      button.type = "button";
      button.id = "fill-" + completion.id;
      button.setAttribute("aria-pressed", "false");
      button.appendChild(document.createTextNode(completion.label));
      button.addEventListener("click", function () {
        applyCompletion(completion);
        buttons.forEach(function (other) {
          other.className = other.className.split(" is-chosen").join("");
          other.setAttribute("aria-pressed", "false");
        });
        button.className += " is-chosen";
        button.setAttribute("aria-pressed", "true");
        clear(note);
        note.hidden = !completion.note;
        if (completion.note) note.appendChild(document.createTextNode(completion.note));
      });
      buttons.push(button);
      row.appendChild(button);
    });

    wrap.appendChild(row);
    wrap.appendChild(note);
    return wrap;
  }

  /**
   * Write one completion into the form.
   *
   * NO clearContinuation() HERE, and that is the difference from applyScenario()
   * one screen up rather than an omission. A quick-fill states a whole other
   * request, so the link to a specific travel request cannot survive it; a
   * completion answers the questions THIS request left open, so the link is the
   * thing it is completing.
   *
   * The gap marks are refreshed rather than cleared: refreshGapMarks() re-reads
   * each box the server asked for and drops the marker only from the ones that
   * now hold something, so a completion that could not offer a value (no home
   * country to suggest as a nationality, say) leaves that box still marked.
   */
  function applyCompletion(completion) {
    var fields = completion.fields || {};
    Object.keys(fields).forEach(function (field) {
      var node = byId(field);
      if (!node) return;
      if (node.type === "checkbox") node.checked = fields[field] === true;
      else setFieldValue(node, fields[field]);
    });
    refreshGapMarks();
  }

  /**
   * "Why are some boxes blank?" — closed, and answerable without opening.
   *
   * EVERY SENTENCE IN HERE IS THE SERVER'S. The page contributes the summary
   * line and nothing else: each reason comes from `stillNeeded[].why`, which
   * src/portal/uc03Continuation.js writes from src/uc03/uc04Intake.js's own account of
   * what a travel request can and cannot contain. A page-authored explanation
   * would be a second opinion about UC-04's inputs living in the one file no
   * test imports — the same drift the gap machinery is deliberately built to
   * avoid.
   *
   * It is CLOSED by default and stays closed for anyone who just wants to fill
   * the form in: the boxes themselves say which are needed, and this only
   * answers the different question "why are you asking me and not looking it
   * up".
   *
   * ONE THING IN HERE IS STILL WRITTEN FOR US AND NOT FOR THE EMPLOYEE: the
   * server's sentences name UC-03 by its internal identifier, which means
   * nothing to somebody asking to work from Lisbon for three weeks. That copy
   * belongs to src/portal/uc03Continuation.js and is fixed there, not here —
   * rewording it in the browser would put a second version of the server's own
   * explanation in the one file no test imports. Being behind a shut disclosure
   * is why it can wait: nobody has to read it to finish the form.
   */
  function whyBlank(data) {
    var reasons = (data.stillNeeded || []).filter(function (item) {
      return item && item.why;
    });
    if (!reasons.length && !data.nationalityNote) return document.createDocumentFragment();

    var box = el("details", "continuation-why");
    box.appendChild(el("summary", null, "Why are some boxes blank?"));

    if (reasons.length) {
      // ONE REASON, ONE LINE, however many boxes share it. Four of the five
      // still-needed entries arrive carrying the SAME sentence, and printing it
      // four times was most of what made this section unreadable — a reader who
      // has read it once and meets it again three times learns nothing and
      // stops reading. Grouping is a rendering choice about the server's text,
      // not an edit of it: every sentence appears exactly as it was written,
      // and every label it covers is named.
      var order = [];
      var byReason = {};
      reasons.forEach(function (item) {
        var key = item.why;
        if (!byReason[key]) {
          byReason[key] = [];
          order.push(key);
        }
        byReason[key].push(item.label);
      });

      var list = el("ul", "continuation-list");
      order.forEach(function (why) {
        var li = el("li");
        li.appendChild(el("strong", null, byReason[why].join(", ")));
        li.appendChild(el("span", "small r-secondary", " — " + why));
        list.appendChild(li);
      });
      box.appendChild(list);
    }

    if (data.nationalityNote) box.appendChild(el("p", "small r-secondary", data.nationalityNote));
    return box;
  }

  /**
   * Mark one prefilled field so its value is visibly not something you typed —
   * and say in five words where it came from.
   *
   * THIS IS WHAT SURVIVED THE CARRIED-OVER LIST. The banner used to print all
   * five carried values a second time, each with a sentence naming its source.
   * Most of that was the form read back aloud: the values are IN the boxes, and
   * a reader looking at a filled box does not need it quoted above the form.
   * The one part a box cannot show is where its value came from — the server
   * labels each one `authority: "record"` or `"reading"`, and that difference is
   * the whole reason these boxes are editable rather than locked: a value a
   * model read out of a sentence is an interpretation, and the person whose
   * trip it is is the only one who can say whether it is right. So it moved
   * onto the box it is about, where it costs no line above the form.
   */
  function markCarried(item) {
    var node = byId(item.field);
    var wrapper = node && node.closest ? node.closest(".r-field") : null;
    if (!wrapper) return;

    // NOTHING CARRIED, SO NOTHING IS MARKED AS CARRIED. A prefill entry that
    // arrived with no value is one of the boxes the server is ASKING for, and
    // markGaps() is about to mark it "(still needed)". Wearing both marks put
    // two notes on one label describing the same empty box from two directions,
    // under two different border colours — noise on the one control this whole
    // flow was rebuilt to make unmissable.
    if (item.value === null || item.value === undefined) return;

    wrapper.classList.add("is-carried");
    var label = wrapper.querySelector(".r-label");
    if (!label || label.querySelector(".carried-mark")) return;

    // THE ONE CARRIED VALUE A PERSON CANNOT READ IS THE ONE THAT MATTERS MOST.
    // Every other prefill is a country, a date or a code somebody recognises;
    // this one is `8ab12460-b568-4c1e-af9d-09b1fabd8f46`, and it is the answer
    // to "who is this request about" — the question an employee had after the
    // persona picker moved to their company's admin under them. The name is
    // matched out of the server's own roster and appended to the mark that is
    // already there, so nothing new is drawn and no id is hidden: the box still
    // holds and still submits the id, because that is what UC-04 reads.
    var named = item.field === "uc04-employmentId" ? personaNameForEmployment(item.value) : null;
    label.appendChild(
      el(
        "span",
        "carried-mark",
        named
          ? " (" + named + ", from your travel request)"
          : item.authority === "record"
            ? " (from your Remote profile)"
            : " (from your request — check it)"
      )
    );
  }

  /**
   * The name of the person a continuation is about, out of the server's own
   * roster — or null, which prints nothing.
   *
   * TWO SERVER-SENT FACTS, JOINED AND NOTHING ELSE. The employment id comes
   * from the continuation's own `prefill` (the entry for `uc04-employmentId`,
   * which the server marks `authority: "record"`); the name comes from the
   * persona list `/api/context` sent. This page holds neither and matches the
   * one against the other, so it cannot name somebody the server did not, and
   * an id with no matching persona — an admin who typed one in by hand, a
   * roster that has changed — yields null and the banner simply says less.
   *
   * IT IS DISPLAY ONLY. What gets submitted is the value in the box, which the
   * employee can still edit; this never writes one.
   */
  function carriedSubjectName(data) {
    var carried = (data && data.prefill ? data.prefill : []).filter(function (item) {
      return item && item.field === "uc04-employmentId" && item.value;
    })[0];
    return carried ? personaNameForEmployment(carried.value) : null;
  }

  /** One employment id, matched against the roster the server sent. Null when
   *  nothing matches — never a guess, and never a name this page composed. */
  function personaNameForEmployment(employmentId) {
    if (!employmentId) return null;
    var match = ((context && context.personas) || []).filter(function (p) {
      return p.employmentId === employmentId;
    })[0];
    return match && match.name ? match.name : null;
  }

  /** Idempotent: applying a second continuation must not stack markers. */
  function clearCarriedMarks() {
    var marks = document.querySelectorAll(".carried-mark");
    for (var i = 0; i < marks.length; i += 1) marks[i].parentNode.removeChild(marks[i]);
    var fields = document.querySelectorAll(".r-field.is-carried");
    for (var j = 0; j < fields.length; j += 1) fields[j].classList.remove("is-carried");
    clearGapMarks();
  }

  // -- the boxes the server said are empty -----------------------------------
  //
  // THE PAGE NEVER DECIDES WHICH BOXES THESE ARE. Every entry below comes from
  // the continuation payload, in the server's own words, and the page's entire
  // contribution is "is this box empty?" — a question about a DOM node, not
  // about workation policy. There is no field name, no requirement and no
  // vocabulary of UC-04's anywhere in these four functions.

  /**
   * The two ways the server states an absence, unified.
   *
   *   `stillNeeded` — "we never ask this on a travel request, so supply it".
   *   `prefill` with `value: null` — "we would have carried this and there was
   *   nothing to carry".
   *
   * Both are the SERVER saying a box has no value, so both are asked for. Taking
   * only the first would leave one real hole: src/uc03/uc04Intake.js reports the
   * date PAIR against the start date alone, so a request that stated a start and
   * no end reports its dates as carried while UC-04 still refuses `missing_dates`
   * — it requires both. The prefill list reports each date separately, so reading
   * both lists closes that without this page forming a rival opinion about dates.
   */
  function gapsFrom(data) {
    var gaps = [];
    var seen = {};

    function add(field, label, why) {
      if (!field || seen[field]) return;
      seen[field] = true;
      gaps.push({ field: field, label: label, why: why || null });
    }

    (data.stillNeeded || []).forEach(function (item) {
      (item.fields || []).forEach(function (field) {
        add(field, item.label, item.why);
      });
    });
    (data.prefill || []).forEach(function (item) {
      if (item.value === null || item.value === undefined) add(item.field, item.label, null);
    });
    return gaps;
  }

  /**
   * Mark each empty box on the form, and take the mark off again the moment it
   * is filled — so the page keeps telling the truth while the employee types
   * rather than only at the moment it loaded.
   */
  function markGaps(gaps) {
    (gaps || []).forEach(function (gap) {
      var node = byId(gap.field);
      var wrapper = node && node.closest ? node.closest(".r-field") : null;
      if (!node || !wrapper) return;

      // Not on a checkbox: `aria-required` announces "you must supply this", and
      // an unchecked box has already supplied `false`. See isAnswered().
      if (node.type !== "checkbox") node.setAttribute("aria-required", "true");
      refreshGapMark(gap, node, wrapper);

      // Bound ONCE per element, ever. A second continuation in the same visit
      // would otherwise stack a second pair of listeners on the same box, and
      // the count would grow for as long as the tab stayed open. The listener is
      // safe to keep across continuations because it reads the box and nothing
      // else — see refreshGapMark.
      if (node.getAttribute("data-gap-bound") === "true") return;
      node.setAttribute("data-gap-bound", "true");

      // `input` for typing, `change` for the date pickers and the selects. Both,
      // because a select fires only `change` in older browsers and a text input
      // fires only `input` while it is being typed into.
      var refresh = function () {
        // Only while this box is one the CURRENT continuation is asking for. The
        // listener outlives the continuation that installed it, and a stale one
        // re-marking a field on an unrelated request would be this page inventing
        // a requirement — the one thing it is not allowed to do.
        if (!isGapNow(gap.field)) return;
        var w = node.closest ? node.closest(".r-field") : null;
        if (w) refreshGapMark(gap, node, w);
      };
      node.addEventListener("input", refresh);
      node.addEventListener("change", refresh);
    });
  }

  /** One box: marked while empty, unmarked once it has something in it. */
  function refreshGapMark(gap, node, wrapper) {
    var label = wrapper.querySelector(".r-label");
    var existing = label ? label.querySelector(".gap-mark") : null;

    if (isAnswered(node)) {
      wrapper.classList.remove("is-still-needed");
      if (existing) existing.parentNode.removeChild(existing);
      return;
    }
    wrapper.classList.add("is-still-needed");
    if (!existing && label) {
      // The words, not only the colour. `.gap-mark` is styled, but a marker that
      // is only a border colour is unreadable to anyone who cannot see it and
      // ambiguous to everyone else — the "carried over" marks beside it already
      // carry their meaning in text, and these have to be at least as legible or
      // the filled fields go on looking more urgent than the empty ones.
      label.appendChild(el("span", "gap-mark", " (still needed)"));
    }
  }

  /**
   * Does this control hold an answer?
   *
   * A CHECKBOX ALWAYS DOES, and that is a fact about checkboxes rather than a
   * judgement about the question: unchecked is submitted as `false`, `false` is a
   * boolean, and UC-04's gate wants a boolean and not a truthy one — it refuses
   * `missing_signing_authority` only for a value that is not a boolean at all,
   * which this form structurally cannot produce. Treating one as "empty" would
   * put a marker on a box no amount of clicking can clear, and block a submission
   * on a question that has already been answered "no".
   */
  function isAnswered(node) {
    if (node.type === "checkbox") return true;
    return String(node.value || "").trim() !== "";
  }

  /** Re-read every box the open continuation is asking for, and re-mark it. */
  function refreshGapMarks() {
    if (!pendingContinuation) return;
    (pendingContinuation.gaps || []).forEach(function (gap) {
      var node = byId(gap.field);
      var wrapper = node && node.closest ? node.closest(".r-field") : null;
      if (node && wrapper) refreshGapMark(gap, node, wrapper);
    });
  }

  /** Is this box one the continuation currently open is asking for? */
  function isGapNow(field) {
    if (!pendingContinuation) return false;
    return (pendingContinuation.gaps || []).some(function (gap) {
      return gap.field === field;
    });
  }

  /** The gaps that are still gaps, right now. Empty when the form is complete. */
  function unfilledGaps() {
    if (!pendingContinuation) return [];
    return (pendingContinuation.gaps || []).filter(function (gap) {
      var node = byId(gap.field);
      return node ? !isAnswered(node) : false;
    });
  }

  /** Idempotent, same as clearCarriedMarks — and called by it. */
  function clearGapMarks() {
    var marks = document.querySelectorAll(".gap-mark");
    for (var i = 0; i < marks.length; i += 1) marks[i].parentNode.removeChild(marks[i]);
    var fields = document.querySelectorAll(".r-field.is-still-needed");
    for (var j = 0; j < fields.length; j += 1) fields[j].classList.remove("is-still-needed");
    // The announcement goes with the marker. A box left announcing itself as
    // required after the continuation that required it has been dropped would
    // be telling a screen reader something no longer true — and this form is
    // deliberately not required-marked when it is filed on its own, because an
    // incomplete submission is a real demonstration of a real gate.
    var announced = document.querySelectorAll('#form-uc04 [aria-required="true"]');
    for (var k = 0; k < announced.length; k += 1) announced[k].removeAttribute("aria-required");
  }

  /**
   * Forget the link.
   *
   * A continuation is a link between two specific requests, so it must not
   * outlive the visit that made it. Without this, an admin who continued one
   * employee's trip, wandered to another form and came back would file an
   * unrelated workation request carrying the first employee's case id — which
   * the server would refuse on the subject check, but only because that check
   * exists. Not relying on somebody else's gate to cover our own state.
   */
  function clearContinuation() {
    pendingContinuation = null;
    clearCarriedMarks();
    var box = byId("uc04-continuation");
    if (box) {
      clear(box);
      box.hidden = true;
    }
  }

  /**
   * The reference this submission actually used, shown so a tester can copy it
   * into the "Reuse" box and watch the duplicate-delivery refusal happen. A
   * generated reference that is never displayed is one nobody can reuse, which
   * would make half the control pointless.
   */
  // THE GATE LADDER USED TO BE RENDERED HERE and is not any more — see the
  // block it was called from, in render(). It was sixteen collapsed rungs, each
  // with its own "Checks:" line, under a paragraph that ended by citing
  // `docs/GATES.md`. Every rung of it is still computed and still published on
  // the envelope (`payload.gateLadder`, from describeGateLadder in each policy
  // engine); this page is simply not the surface that draws it, because the
  // person reading this page is the one who filed the request. The ZAF sidebar
  // renders the same field for the specialist who has to act on it.

  /**
   * The reference this submission used. The id, labelled, and nothing else.
   *
   * IT USED TO CARRY TWO SENTENCES AND BOTH HAVE GONE, for different reasons.
   *
   * "The id that ties every record of this request together; quote it to have
   * this request traced" was added because the page showed the reference while
   * saying only what REUSING it does — and at the time it was also a false
   * promise, since the displayed reference reached no record until d9f1850
   * fixed that. It is now true, and being true is exactly why it stopped
   * needing to be said here: a string labelled "Reference sent", sitting in a
   * copyable chip, is self-evident. The explanation still exists in the two
   * places somebody looks for it rather than past it — the control that
   * generates the reference, above the form, and the "My requests" column that
   * lists them.
   *
   * "Switch this form to 'Reuse a reference' and submit again…" was a DEMO
   * INSTRUCTION printed on the outcome of every decision of every request type.
   * It now sits beside the radio buttons it operates (upgradeReferenceFields).
   *
   * What is left is the thing a reader actually needs: the id, prominent and
   * easy to copy.
   */
  function referenceLine(ref) {
    var line = el("p", "small r-secondary ref-used");
    line.appendChild(el("span", null, "Reference sent: "));
    line.appendChild(el("code", "tag-chip", ref));
    return line;
  }

  /**
   * The submission's own lifecycle state, beside — not instead of — the
   * decision badge. The two answer different questions and the design system
   * draws them differently on purpose: STATE is what happened to this
   * submission (it was accepted, a record exists), DECISION is what the gates
   * concluded about it. Both are read off the response.
   *
   * The response carries no `status` column of its own — the seven adapters
   * return decision/reason/flags/recordId and nothing else — so the state
   * rendered here is the one the envelope really does carry: whether the
   * server accepted the submission, and whether it wrote a record. When there
   * is no record id the honest word is the weaker "Accepted", never "Recorded".
   *
   * The dot is deliberately the NEUTRAL tone, not the green "ok" one. Being
   * recorded is a fact about intake, not a verdict — and a green dot beside a
   * decision that escalated would read as "this went well", as well as
   * competing with the validated green the escalate badge already owns. A
   * refusal is the one state that earns a colour here, because when the server
   * refuses there is no decision badge for the eye to go to instead.
   */
  function outcomeStatus(payload) {
    return el("span", "r-status r-status-idle", payload.recordId ? "Recorded" : "Accepted");
  }

  function decisionBadge(decision) {
    var code = decision === undefined || decision === null ? null : String(decision);
    // THE TONE IS KEYED ON THE RAW CODE, never on the label — DECISION_DOT is
    // the closed set this project's workflows actually return, and looking it
    // up by the words a reader sees would break the moment the label above
    // changed for readability.
    var tone = code && Object.prototype.hasOwnProperty.call(DECISION_DOT, code) ? " decision-" + DECISION_DOT[code] : "";
    // round-6 D-06: the WORD shown is never the raw code — `auto_resolve`,
    // `escalate` and the rest are this system's own pipeline vocabulary, not
    // words the person who filed the request chose or would recognise.
    var text = code === null ? "(no decision returned)" : DECISION_LABEL[code] || humanizeCode(code);
    return el("span", "badge" + tone, text);
  }

  /**
   * `details` minus any row whose value is exactly `text`. Used only to stop
   * the deciding gate's sentence appearing twice on one panel — see the call
   * site. Returns the list untouched when there is no `text` to match.
   */
  function withoutRepeatOf(details, text) {
    if (!text) return details;
    var target = String(text);
    return details.filter(function (row) {
      return String(row.value) !== target;
    });
  }

  function detailTable(details) {
    var wrap = el("div", "r-table-wrap");
    var table = el("table", "r-table detail-table");
    var body = el("tbody");
    details.forEach(function (row) {
      var tr = el("tr");
      var th = el("th", "detail-label", row.label);
      // A label/value table's headers run down the side, not across the top.
      // Without scope="row" a screen reader pairs each value with the wrong
      // header — or with none.
      th.setAttribute("scope", "row");
      tr.appendChild(th);
      var td = el("td");
      // A detail the server sent with no value prints the em dash rather than
      // an empty cell — "nothing here" is a different answer from a row that
      // failed to render, and this page's whole discipline is not blurring the
      // two. Several details are legitimately blank (a narrative an
      // unconfigured LLM never drafted, for one).
      if (isEmpty(row.value)) td.appendChild(noneCell());
      else td.textContent = String(row.value);
      tr.appendChild(td);
      body.appendChild(tr);
    });
    table.appendChild(body);
    wrap.appendChild(table);
    return wrap;
  }

  /**
   * The plain answer, at the top of the result. Two strings, printed.
   *
   * WHAT THIS FUNCTION DOES NOT DO is the whole of its design: it does not
   * choose a word, does not compare a decision, does not know which use case it
   * is rendering and does not hold a country name. `lead` and `next` are
   * written by src/portal/plainAnswer.js from the decision, the execution path,
   * the routing table's team and the country code the envelope carries — so the
   * wording moves in one place, and the same module can dress the ZAF sidebar's
   * panels without a second copy of any of it.
   *
   * `shape` PICKS A TONE AND NOTHING ELSE — the same contract DECISION_DOT has
   * with a colour. An unrecognised shape still renders, with its sentences, in
   * the neutral style; the words never depend on this file recognising it.
   *
   * IT REPLACED nextStep(), which was a browser-side sentence keyed on
   * `executionPath` alone. That could not tell an auto-approval from a hand-off,
   * so an expense that had already been approved at Remote with nobody
   * involved was told "a specialist decides it, and their decision is recorded
   * against this request" — false, on the happiest path this portal has. Both
   * of the facts that sentence carried survive: who decides, and the 🔴 pair's
   * guarantee that nobody approves it here or anywhere, now said by a module
   * that knows which of the two it is looking at.
   */
  function plainAnswerBlock(payload) {
    var answer = payload.plainAnswer;
    // A response with no answer on it renders nothing rather than a placeholder
    // — an older deployment answering a newer page is the case, and an empty
    // panel head is better than a sentence this page made up to fill it. NULL
    // rather than an empty fragment, because render() now has to know whether
    // there is an answer to open the dialog with, and "did this build a node?"
    // is a question a fragment cannot answer.
    if (!answer || !answer.lead) return null;

    var box = el("div", "plain-answer" + (answer.shape ? " answer-" + answer.shape : ""));
    // A HEADING, AND NOT A PARAGRAPH ANY MORE. This sentence is the accessible
    // name of the dialog the result opens with, so it has to BE the title of
    // the thing rather than merely look like it: an <h3> under the card's own
    // <h2>, with the recommendation's heading demoted to <h4> beneath it
    // (offerBox()). The styling is unchanged — `.plain-answer-lead` carries it,
    // and always did.
    var lead = el("h3", "plain-answer-lead", answer.lead);
    lead.id = ANSWER_TITLE_ID;
    box.appendChild(lead);
    if (answer.next) box.appendChild(el("p", "plain-answer-next", answer.next));
    // WHO READ THE REQUEST, IN THE POP-UP. The facts table has carried this for
    // as long as it has been computed, and the table is several screens below
    // the fold — so a requester who typed a paragraph about a conference, got an
    // answer they did not recognise and never scrolled concluded that nothing
    // had read their words and that every result here is written in advance.
    // The page knew. It just never said it where they were looking.
    //
    // THE SENTENCE IS THE SERVER'S, like everything else in this block: what
    // read the request is a fact about the run (§4 invariant 8's source tag),
    // and a page that composed its own sentence about it would be a second
    // place to keep true. Absent on a result that carries no such fact, which
    // renders nothing rather than a guess.
    // A bare truthiness check and not isEmpty(): every function in this block
    // is lifted into a `node:vm` sandbox by test/portalResultDialog.test.js and
    // test/portalInterstitial.test.js, which give it `document` and `el()` and
    // nothing else. A helper reached from here is a helper that has to be
    // lifted too, and the sentence is a string the server either sent or did
    // not.
    if (payload.readBy) box.appendChild(el("p", "plain-answer-provenance small", payload.readBy));
    return box;
  }

  function shortId(id) {
    if (!id) return "(none)";
    var text = String(id);
    return text.length > 12 ? text.slice(0, 8) + "…" : text;
  }

  document.addEventListener("DOMContentLoaded", function () {
    wireAccessForm();
    boot();
  });
})();
