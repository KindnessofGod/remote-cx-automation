// ---------------------------------------------------------------------------
// workauth.js  —  The employer's work-authorization queue (plain JS, no build)
// ---------------------------------------------------------------------------
// One list, and the decision ON the row. This file DECIDES NOTHING. The stages,
// the two verbs, which requests exist, which company they belong to, whether a
// record is a stand-in, what happens at stage 3 — all of it comes from the API
// response verbatim and is rendered as given. There is no second copy of a rule
// here to drift out of step with the server's.
//
// WHY THE LAYOUT IS A LIST AND NOT A COLUMN OF CARDS. Every request used to be
// a full card carrying the three-stage explainer and the stand-in disclosure
// again, under a separate "record your decision" form further down the page
// that named its subject in a <select>. Two consequences, both observed on the
// real screen: one request filled the viewport, so the queue could not be read
// as a queue; and the buttons were nowhere near the request they acted on, so
// approving meant matching an id in a dropdown against a card scrolled off
// screen. What is true of the SCREEN is now said once, in the page's collapsed
// explainer; what is true of a ROW — its provenance badge, and the
// permanent-establishment fact when the employee has stated it — stays on the
// row, because it is about that request and nothing else.
//
// The company is never sent. It is not in a body, a header or a query string on
// any request this file makes: the server resolves it from the session and this
// page could not widen it if it tried.
//
// Every dynamic value is written with textContent, never innerHTML, because the
// content originates in a support flow and includes a third party's free text.
// ---------------------------------------------------------------------------

(function () {
  "use strict";

  // The signed-in role. Sent as a header the server LOOKS UP; it is not an
  // authorization claim, and a value the server does not know is refused rather
  // than defaulted.
  var SESSION_HEADER = "X-RemoteUi-Session";
  var SESSION = "admin";

  // The deployment gates every /api route behind one shared key
  // (src/portal/access.js) — the same key that opens /portal, /audit and
  // /queue, because it is the same secret. Nothing about that rule lives here:
  // this page holds no key by default, decides nothing about whether one is
  // needed, and renders only what the server said when it refused.
  // sessionStorage rather than localStorage: a shared machine should not keep
  // it past the browser session.
  var KEY_STORAGE = "portal.accessKey";
  var KEY_HEADER = "X-Portal-Key";

  // How often the queue re-asks. A manager watching this screen should see a
  // newly-filed request without deciding to press anything, which is the whole
  // point of the surface; ten seconds is frequent enough to feel immediate and
  // slow enough that a background tab is not a load generator. Polling stops
  // entirely while the tab is hidden — see startPolling().
  var POLL_MS = 10000;

  function byId(id) {
    return document.getElementById(id);
  }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  function clear(node) {
    while (node && node.firstChild) node.removeChild(node.firstChild);
  }

  /**
   * Read a key out of a plain lookup table without going through the
   * prototype. `TABLE["constructor"]` otherwise resolves to a function and a
   * value that came off the wire would select it — the same hazard
   * workAuthPolicy.js guards its verb table against.
   */
  function pick(table, key) {
    return Object.prototype.hasOwnProperty.call(table, key) ? table[key] : null;
  }

  function storedKey() {
    try {
      return window.sessionStorage.getItem(KEY_STORAGE) || "";
    } catch (err) {
      return "";
    }
  }

  function rememberKey(value) {
    try {
      window.sessionStorage.setItem(KEY_STORAGE, value);
    } catch (err) {
      /* private mode — the request below still carries it */
    }
  }

  /** Every API call goes through here, so no call can forget a header. */
  function api(path, options) {
    var opts = options || {};
    var headers = { "Content-Type": "application/json" };
    headers[SESSION_HEADER] = SESSION;
    var key = storedKey();
    if (key) headers[KEY_HEADER] = key;
    return fetch(path, { method: opts.method || "GET", headers: headers, body: opts.body }).then(function (res) {
      return res.json().then(function (json) {
        return { status: res.status, json: json };
      });
    });
  }

  /**
   * The access-key panel, in the SERVER's words.
   *
   * The three refusal codes are told apart for exactly one purpose: deciding
   * whether asking for a key can possibly help. With
   * `portal_access_key_not_configured` it cannot — the server has nothing to
   * match — so no input is offered rather than inviting an endless retry.
   */
  function renderAccessGate(target, payload) {
    clear(target);
    var box = el("div", "r-banner r-banner-warn");
    box.setAttribute("role", "note");
    var body = el("span");
    body.appendChild(el("strong", "", payload.reason || "This page requires an access code."));
    if (payload.why) body.appendChild(el("p", "r-muted small", payload.why));
    var steps = el("ul", "r-muted small");
    (payload.howToFix || []).forEach(function (step) {
      steps.appendChild(el("li", "", String(step)));
    });
    body.appendChild(steps);

    if (payload.code !== "portal_access_key_not_configured") {
      var form = el("form", "access-form");
      var label = el("label", "r-label", "Access code");
      label.setAttribute("for", "workauth-access-key");
      var input = document.createElement("input");
      input.type = "password";
      input.id = "workauth-access-key";
      input.className = "r-input";
      var save = el("button", "r-btn r-btn-primary r-btn-sm", "Save and retry");
      save.type = "submit";
      form.appendChild(label);
      form.appendChild(input);
      form.appendChild(save);
      form.addEventListener("submit", function (event) {
        event.preventDefault();
        rememberKey(input.value.trim());
        load();
      });
      body.appendChild(form);
    }
    box.appendChild(body);
    target.appendChild(box);
  }

  // -- state ----------------------------------------------------------------

  var STATE = {
    // The last payload rendered, so a poll that changed nothing does not
    // rebuild the DOM under a reader's cursor.
    signature: "",
    // A row whose decline form is open, or whose instructions box has been
    // typed into. A poll must not throw that away, so the render is DEFERRED
    // rather than the fetch skipped: the data stays fresh, the typing survives.
    editing: null,
    loading: false,
    // Decisions taken in this browser session, kept so the row that was just
    // decided still shows its outcome after the next poll drops it from the
    // pending list. The DURABLE record is the server's audit row; this is only
    // so the reader is not left wondering whether the click landed.
    decided: {},
    /* WHAT THE EMPLOYER HAS TYPED, KEYED BY REQUEST ID, so a re-render can put
       it back. Before this the instructions box's only protection was the
       deferral above — the render was postponed, which kept the words and
       froze the whole queue to do it. With the draft held here a rebuild costs
       nothing, so an explicit Reload can force through safely. Cleared when the
       request is decided; never persisted anywhere — the durable record is the
       audit row the server writes when a decision is taken. */
    drafts: {},
    timer: null,
  };

  // -- rendering ------------------------------------------------------------

  function renderStages(stages, nextStage) {
    var list = byId("stages");
    clear(list);
    (stages || []).forEach(function (stage) {
      var item = el("li", stage.ours ? "wa-stage wa-stage-current" : "wa-stage");
      item.appendChild(el("strong", "", stage.actor + " " + stage.what));
      item.appendChild(el("span", "r-muted small", " — " + stage.where));
      item.appendChild(el("p", "r-muted small", stage.api));
      list.appendChild(item);
    });
    byId("next-stage").textContent = nextStage || "";
  }

  function describeScope(payload) {
    var mine = (payload.scope && payload.scope.employments ? payload.scope.employments : []).filter(function (e) {
      return e.inCompany;
    });
    var line =
      "Company " + payload.companyId + " — " + mine.length + " employment(s) in scope, resolved from your session.";
    var unreadable = (payload.scope && payload.scope.unreadable) || [];
    if (unreadable.length) {
      // Named, never silently dropped: an unreadable employment is not an
      // absent one, and a scope that shrank because a read failed must say so.
      line += " " + unreadable.length + " employment(s) could not be read and are excluded.";
    }
    return line;
  }

  function describeProbe(probe) {
    if (!probe) return "";
    var line =
      "Remote was asked: " +
      probe.endpoint +
      " — " +
      probe.employmentsQueried +
      " employment(s) queried, " +
      probe.rowsReturned +
      " row(s) returned.";
    if (probe.failures && probe.failures.length) {
      line += " " + probe.failures.length + " call(s) failed and are not counted as empty.";
    }
    return line;
  }

  /**
   * THE PROVENANCE BADGE, and the reason it is not a switch over known strings.
   *
   * A stand-in record must never reach a reader looking like something Remote
   * said. This is one of three independent places it is marked (the `standin-`
   * id and the record's own `_standin` block are the other two, neither of
   * which depends on this page rendering). But an `if (origin === "standin")`
   * else-real is a CLOSED LIST, and a closed list mislabels the first origin
   * the server learns to send — a portal-filed request would have rendered as
   * "From Remote's API", which is the one sentence this badge exists to stop.
   * So: the server's own label wins if it sends one, the token itself is shown
   * verbatim when it does not, and an unrecognised origin gets the neutral tone
   * rather than either of the two confident ones.
   */
  var ORIGIN_LABEL = {
    standin: "Stand-in record",
    remote_api: "From Remote's API",
    uc04_record: "Filed on this system",
  };
  var ORIGIN_TONE = { standin: "r-status-warn", remote_api: "r-status-ok", uc04_record: "r-status-info" };

  function originBadge(entry) {
    var origin = entry.origin === undefined || entry.origin === null ? "" : String(entry.origin);
    var label = entry.originLabel || pick(ORIGIN_LABEL, origin) || origin || "origin not stated";
    var tone = pick(ORIGIN_TONE, origin) || "r-status-info";
    var badge = el("span", "r-status " + tone + " wa-origin", label);
    badge.setAttribute("title", "Record origin: " + (origin || "not stated"));
    return badge;
  }

  /**
   * May this row be acted on?
   *
   * The server answers it if it can — `decidable` on the row is believed over
   * anything computed here. Failing that, the comparison is between two values
   * the SERVER sent (`decidableStatus` and the record's own status), not a
   * status string this page knows. And when neither is present the buttons
   * stay enabled: the decision route refuses a settled request by name
   * (`not_awaiting_manager`), so the honest failure direction is to let the
   * server say so rather than to grey out a row on a guess.
   */
  function decidable(entry, payload) {
    if (typeof entry.decidable === "boolean") return entry.decidable;
    var status = entry.request && entry.request.status;
    if (!status || !payload.decidableStatus) return true;
    return String(status) === String(payload.decidableStatus);
  }

  /**
   * The row's one line.
   *
   * The SERVER's `label` is used whenever it sends one — a label composed in
   * the browser is a second place for the same fact to be spelled differently,
   * and the two spellings drift silently because both look right on their own
   * page. The composition below is a fallback for a payload that predates the
   * field, not a rival implementation of it.
   */
  function summarise(entry) {
    var request = entry.request || {};
    var country = request.destination_country || {};
    var where = country.name || country.code || "destination not stated";
    var when =
      request.travel_date_start && request.travel_date_end
        ? request.travel_date_start + " → " + request.travel_date_end
        : "dates not stated";
    return where + " · " + when + (request.reason ? " · " + request.reason : "");
  }

  function labelledTextarea(id, labelText, rows) {
    var field = el("div", "r-field wa-field");
    var label = el("label", "r-label wa-field-label", labelText);
    label.setAttribute("for", id);
    var input = document.createElement("textarea");
    input.id = id;
    input.className = "r-textarea wa-textarea";
    input.rows = rows || 2;
    field.appendChild(label);
    field.appendChild(input);
    return { field: field, input: input };
  }

  /**
   * Whatever the record says about ITSELF being ours.
   *
   * A record this system produced carries a marker block naming what it is —
   * `_standin` for a demo fixture, `_record` for a request really filed here,
   * and they are deliberately different because "we invented this trip" and
   * "somebody really asked for this trip" are not the same claim. Collected by
   * shape (an underscore-prefixed object carrying a `note`) rather than by
   * name, so a marker added on the server's side reaches the reader without an
   * edit here. Remote's own records carry none and render none.
   */
  function provenanceNotes(request) {
    var notes = [];
    Object.keys(request || {}).forEach(function (key) {
      if (key.charAt(0) !== "_") return;
      var block = request[key];
      if (!block || typeof block !== "object") return;
      if (block.note) notes.push(String(block.note));
      if (block.sandboxProbe) notes.push(String(block.sandboxProbe));
    });
    return notes;
  }

  /**
   * One row per count, under a label the server wrote.
   *
   * A FLOOR IS NOT A CEILING, AND ONE RENDERER FOR BOTH PRINTS THE FLOOR
   * BACKWARDS. Every measurement here except notice-before-departure is a
   * ceiling — 90 Schengen days, 183 residency days — so "67 of 90 · 23 days
   * left" is right for them and reads as "91 of 14 days · 77 days left" on a
   * notice period three months out: arithmetically true, and it scans as the
   * worst row on the page when it is the safest. `comparison` travels on the
   * row for exactly this; absent means ceiling, which is what every other row
   * is.
   *
   * A ROW WITH NO MEASUREMENT IS STILL DRAWN, and that is the point of it. A
   * check that never ran says so — "not measured on this run" — because
   * omitting it would leave the manager reading a page that looks complete.
   * The server decides which of those a row is (`state`); this only prints it.
   */
  function renderMeasurements(list, measurements) {
    if (!Array.isArray(measurements) || !measurements.length) return;
    measurements.forEach(function (m) {
      if (!m || !m.label) return;
      var unit = m.unit ? " " + m.unit : "";
      var value;
      if (m.measured === null || m.measured === undefined) {
        value = "not measured on this run";
      } else if (m.comparison === "floor") {
        // "17 days · 14 days minimum · 3 days spare" — the shape a minimum has.
        var spare = m.headroom;
        value =
          m.measured + unit +
          (m.limit !== null && m.limit !== undefined ? " · " + m.limit + unit + " minimum" : "") +
          (spare === null || spare === undefined
            ? ""
            : spare < 0
              ? " · short by " + Math.abs(spare) + unit
              : " · " + spare + unit + " spare");
      } else {
        value =
          m.measured + " of " + m.limit + unit +
          (m.headroom === null || m.headroom === undefined
            ? ""
            : m.headroom < 0
              ? " · over by " + Math.abs(m.headroom) + unit
              : " · " + m.headroom + unit + " left");
      }
      // The server's own sentence as the hover, so the caveat that qualifies
      // the number travels with it rather than being left on another screen.
      definition(list, m.label, value, m.note || null);
    });
  }

  function definition(list, term, value, title) {
    if (value === undefined || value === null || value === "") return;
    list.appendChild(el("dt", "wa-dt", term));
    var dd = el("dd", "wa-dd", value);
    // The exact value, kept recoverable when the visible one is a rendering of
    // it rather than the value itself — the same bargain filedStamp() already
    // strikes on the row above.
    if (title) dd.setAttribute("title", title);
    list.appendChild(dd);
  }

  /**
   * An instant, in the reader's own locale, or null when there is not one.
   *
   * LIFTED OUT OF filedStamp() RATHER THAN COPIED (2026-09-01). The detail
   * block below printed `request.submitted_at` RAW — "2026-09-01T05:55:16.624Z"
   * — four inches under the row title rendering the SAME field as "Filed Sep
   * 01, 2026". Two spellings of one fact on one screen is the drift this file
   * argues against twice already, and the machine-readable one was the copy
   * inside the panel a manager opens in order to read carefully.
   *
   * It returns null rather than a fallback string: "when was this filed" has a
   * real absent state, and filedStamp() has its own sentence for it that says
   * the record carries no submitted_at. A shared formatter inventing "unknown"
   * here would take that sentence away from it.
   */
  function localTimeText(raw) {
    var ms = raw ? Date.parse(raw) : NaN;
    if (!raw || isNaN(ms)) return null;
    var when = new Date(ms);
    try {
      return when.toLocaleString(undefined, {
        year: "numeric", month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit",
      });
    } catch (err) {
      // A locale the browser cannot format is not a reason to show nothing.
      return when.toISOString().replace("T", " ").slice(0, 16) + " UTC";
    }
  }

  /**
   * WHEN THIS REQUEST WAS FILED — rendered because the screen was sorted by a
   * fact it did not show.
   *
   * `submitted_at` has been on every row of this payload since the screen
   * shipped, and `sortBySubmittedAt()` in src/remoteui/workAuthRecords.js
   * ORDERS THE LIST BY IT. So a reader looking at twenty-three rows was being
   * shown the newest first with nothing on the page saying so, and could not
   * tell which row was the request they had just filed — the question this
   * screen exists to let them answer. Reported from the live deployment on
   * 2026-08-31 looking at exactly that list.
   *
   * THREE THINGS IT WILL NOT DO, each of which would be worse than no stamp:
   *
   *   1. It never invents one. A row whose `submitted_at` is absent or
   *      unparseable says "filing time not recorded" — not today's date, not
   *      the epoch, not a blank that reads as "just now". The stand-in records
   *      carry real fixture stamps and the UC-04 records carry their own
   *      `createdAt`, but a payload that predates the field must degrade to
   *      the honest answer rather than to a plausible one.
   *   2. It never says "2 hours ago" alone. A relative stamp is the one form
   *      that cannot answer "is this the one I just filed?" across a page
   *      reload boundary, and this list AUTO-REFRESHES EVERY TEN SECONDS, so a
   *      relative figure silently restates itself against a moving now.
   *   3. It does not fold the stamp into the server's `label`. That line is
   *      composed server-side on purpose (see `summarise()`'s own comment); a
   *      second place spelling the same row differently is the drift this file
   *      already argues against twice.
   *
   * The absolute local time is the visible text and the exact ISO value is the
   * `title`, so the precise instant is recoverable without cluttering a row
   * that already carries a name, a country and a travel window.
   */
  function filedStamp(entry) {
    var raw = entry.request && entry.request.submitted_at;
    var ms = raw ? Date.parse(raw) : NaN;
    if (!raw || isNaN(ms)) {
      var unknown = el("span", "wa-row-filed wa-row-filed-unknown", "filing time not recorded");
      unknown.setAttribute("title", "This record carries no submitted_at, so when it was filed is not known here.");
      return unknown;
    }
    var text = localTimeText(raw);
    var stamp = el("span", "wa-row-filed", "Filed " + text);
    stamp.setAttribute("title", "Filed at " + String(raw) + " (exact value as recorded)");
    return stamp;
  }

  /**
   * ONE ROW. Everything on it is a property of THIS request; nothing that is
   * true of the screen is repeated here.
   */
  function renderRow(entry, payload, index) {
    var request = entry.request || {};
    var row = el("li", "wa-row");
    row.setAttribute("data-request-id", String(entry.id));

    var main = el("div", "wa-row-main");
    var titleLine = el("div", "wa-row-title");
    var who = entry.employeeName || (request.user && request.user.name) || entry.id;
    if (entry.label) {
      // One line, the server's, already carrying who / where / when / why.
      titleLine.appendChild(el("span", "wa-row-name wa-row-line", entry.label));
      titleLine.appendChild(originBadge(entry));
      titleLine.appendChild(filedStamp(entry));
      main.appendChild(titleLine);
    } else {
      titleLine.appendChild(el("span", "wa-row-name", who));
      titleLine.appendChild(originBadge(entry));
      titleLine.appendChild(filedStamp(entry));
      main.appendChild(titleLine);
      main.appendChild(el("p", "wa-row-sub", summarise(entry)));
    }

    // ROW-SPECIFIC AND THEREFORE STAYS. This is not boilerplate: it is a fact
    // the employee stated about this trip, and it is the fact a
    // permanent-establishment question turns on.
    if (request.will_negotiate_or_sign_contracts) {
      var warn = el("p", "wa-row-flag");
      warn.appendChild(el("span", "wa-row-flag-mark", "!"));
      warn.appendChild(
        el(
          "span",
          "",
          "The employee says they will negotiate or sign contracts while there. That is the fact a permanent-establishment question turns on."
        )
      );
      main.appendChild(warn);
    }
    row.appendChild(main);

    var actions = el("div", "wa-row-actions");
    var outcome = el("div", "wa-row-outcome");
    outcome.hidden = true;
    var declineBox = el("div", "wa-row-decline");
    declineBox.hidden = true;

    var detail = document.createElement("details");
    detail.className = "wa-row-detail";
    detail.appendChild(el("summary", "wa-row-detail-summary", "Full request"));
    var body = el("div", "wa-row-detail-body");
    var dl = el("dl", "wa-dl");
    definition(dl, "Request id", entry.id);
    definition(dl, "Status", request.status);
    definition(dl, "Submitted", localTimeText(request.submitted_at), request.submitted_at);
    /* REMOTE'S FIELD NAME, not the question the employee was asked — two names
       for one value, checked and left that way on purpose (2026-09-01). This
       list renders REMOTE'S OWN OBJECT field by field, so Remote's own names
       are the honest labels for it; ACTIVITY_QUESTIONS' wording is a QUESTION
       and belongs to the block that renders the answer to it. Unifying them
       here would mean this file spelling out a question label, which
       test/remoteUiActivityPrefill.test.js forbids by reading
       src/uc04/activityProfile.js — and that guard is what caught the attempt.
       A label the browser writes is a second copy of the server's words, free
       to drift; it already did once on this very block, to an "(optional)". */
    definition(dl, "Work location", request.work_location);
    definition(dl, "Travel document", request.travel_document_number);
    definition(dl, "Employee", request.user && request.user.email);
    definition(dl, "Employment", entry.employmentId);
    definition(dl, "What they said", request.additional_information);
    definition(dl, "Instructions already on the record", request.employer_special_instructions);
    // Facts this system holds that Remote's schema has no field for. They are
    // outside `request` on the payload for exactly that reason, and they are
    // rendered only when the server sent them — an absent factor is not
    // "none", and a dash under "Visa type" would be this page asserting one.
    definition(dl, "Filed via", entry.filedVia);
    definition(dl, "Zendesk ticket", entry.ticketId);
    var assessment = entry.assessment || {};
    definition(dl, "This system's assessment", assessment.summary);
    definition(dl, "Its decision", assessment.decision);
    definition(dl, "Because", assessment.reason);
    definition(dl, "Risk", assessment.riskLevel);
    definition(dl, "Flags", (assessment.flags || []).join(", "));
    var factors = entry.offSchemaFactors || {};
    definition(dl, "Home country", factors.homeCountry);
    definition(dl, "Nationality", factors.nationality);
    definition(dl, "Visa type", factors.visaType);
    definition(dl, "Job duties", factors.jobDuties);
    // WHAT THEY SAID THEY WOULD BE DOING — the same four answers the mobility
    // specialist's sidebar shows, from the same server-side computation. The
    // manager deciding this had less in front of them than the specialist
    // reviewing them afterwards; this is that asymmetry closed. Labels and
    // values are the server's, so the two screens cannot word one trip
    // differently. An entry with no profile (a request read from Remote or the
    // stand-in, which never asked the question) renders nothing here rather
    // than four empty rows.
    /* THE COUNTS THE DECISION TURNS ON, rendered where the decision is taken.
       The manager reading this row is the one carrying the border risk and the
       PE exposure, and until now she had a name, a country code, two dates and
       the word `ready_for_approval` — while the traveller had already been
       shown the day counts. Server's rows, server's words; this file decides
       only which of them to draw. See measurementsOf() in
       ../workAuthRecords.js for the report that forced it. */
    renderMeasurements(dl, entry.measurements);

    var activity = entry.activityProfile || null;
    if (activity && activity.asked && activity.fields) {
      activity.fields.forEach(function (field) {
        /* THE ABSENCE IS THE SERVER'S SENTENCE, AND RENDERING NOTHING WOULD
           THROW AWAY THE DISTINCTION THE SERVER JUST MADE. `definition()`
           returns early on a null value, so a question the employee left blank
           produced no row — byte-identical to a request filed somewhere that
           never asked. Those are different facts and only one is about the
           traveller; `normalizeActivityProfile()` was corrected the same day to
           keep them apart, and this consumer was discarding the correction. */
        definition(dl, field.label, field.value || field.absence);
      });
    }
    definition(dl, "Already decided", entry.outcome);
    body.appendChild(dl);
    provenanceNotes(request).forEach(function (note) {
      body.appendChild(el("p", "r-muted small", note));
    });

    /* Remote's own optional field, offered where the decision is taken rather
       than in a form elsewhere on the page. Sent with whichever verb is used.

       PREFILLED WITH THE EMPLOYEE'S OWN ANSWERS, AND IT IS REMOTE'S PROCESS
       RATHER THAN A CONVENIENCE. Help Center 20094378700557 asks the admin, at
       approval, to "use the additional information section to provide specific
       details about the activities the employee is expected to perform during
       the travel". So the decisive fact is captured twice — the employee claims
       it, the employer states it — and the employer's version is the one that
       reaches the record Remote acts on. An empty box at that moment is how the
       second capture becomes a paraphrase of nothing.

       STILL THEIR WORDS, NOT THE EMPLOYEE'S. The box is editable, its label and
       the line under it say whose words are in it and that submitting adopts
       them, and what is submitted is recorded as the company's statement. A
       prefill filed as the employee's claim would merge two parties' statements
       into one, which is the defect the whole UC-04 panel exists to avoid.

       THE STRING IS THE SERVER'S. `statementPrefill` is composed by
       activityProfileOf() from the same four answers the ZAF sidebar renders;
       composing it here would be a second spelling of a fact the server owns,
       which this file is asserted never to do. */
    var activityBlock = entry.activityProfile || null;
    var prefill = (activityBlock && activityBlock.statementPrefill) || "";
    var prefillNotice = (activityBlock && activityBlock.statementNotice) || "";
    // A DRAFT BEATS THE PREFILL, INCLUDING AN EMPTY ONE. `hasOwnProperty`, not
    // truthiness: a manager who deliberately cleared the box has a draft of "",
    // and re-seeding the employee's words over it is the defect this whole
    // draft store exists to prevent.
    var draft = Object.prototype.hasOwnProperty.call(STATE.drafts, entry.id) ? STATE.drafts[entry.id] : null;
    var instructions = labelledTextarea(
      "wa-instructions-" + index,
      // STILL OPTIONAL, AND THE LABEL MUST KEEP SAYING SO. The prefilled
      // variant dropped the word, asserting a requiredness
      // `buildDecisionPayload()` does not have — it sends the field only when
      // non-empty, on either verb. It also carried "edit before you approve",
      // an instruction nothing enforces.
      prefill
        ? "The activities this employee is expected to perform (optional) — the employer's words, carried on the record"
        : "Special instructions to Remote (optional) — the employer's words, carried on the record",
      prefill ? 6 : 2
    );
    instructions.input.value = draft === null ? prefill : draft;
    instructions.input.placeholder = "e.g. approved on condition that no client contracts are signed";
    // The server's sentence, verbatim. A provenance claim composed in the
    // browser is one nobody can check, and it would go on asserting whose words
    // these are after the prefill's source changed.
    if (prefillNotice) instructions.field.appendChild(el("p", "r-muted small", prefillNotice));
    /* TOUCHED, NOT NON-EMPTY, AND THE PREFILL IS WHY THAT DISTINCTION NOW
       MATTERS. This read `STATE.editing = instructions.input.value ? entry.id
       : null`, which was right for a box that started empty: text present means
       somebody typed it. With a prefilled box it inverts on the one action a
       manager is most entitled to take — CLEARING IT. Emptying the field would
       set `editing` back to null, the next poll would re-render the row, and
       the prefill would silently come back under their cursor, so the screen
       would appear to refuse to let them delete the employee's words. Once
       touched, the row is theirs until they decide. */
    instructions.input.addEventListener("input", function () {
      STATE.drafts[entry.id] = instructions.input.value;
      STATE.editing = entry.id;
      // THE NOTE FOLLOWS THE STATE IMMEDIATELY, not on the next poll. It was
      // refreshed only when the timer fired, so for up to ten seconds after the
      // first keystroke the page went on promising a refresh it had already
      // stopped doing. The whole point of naming the pause is that the reader
      // learns about it when it starts.
      describePolling();
    });
    /* AND POLLING RESUMES WHEN THEY LEAVE THE BOX. `STATE.editing` was cleared
       only by deciding or by cancelling a decline, so one keystroke stopped
       automatic refresh for the rest of the session — honest since the note
       started naming the pause, but still a queue that never updated again
       until clicked. The deferral exists so the list is not rebuilt under a
       cursor; once the cursor has left, there is nothing to protect. The words
       are safe either way, because STATE.drafts outlives the render. */
    instructions.input.addEventListener("blur", function () {
      if (STATE.editing === entry.id) {
        STATE.editing = null;
        describePolling();
      }
    });
    detail.appendChild(body);

    var approve = el("button", "r-btn r-btn-primary r-btn-sm wa-approve", "Approve");
    approve.type = "button";
    var decline = el("button", "r-btn r-btn-secondary r-btn-sm wa-decline", "Decline");
    decline.type = "button";

    if (!decidable(entry, payload)) {
      approve.disabled = true;
      decline.disabled = true;
    }

    // The decline reason lives on the row and is asked for BEFORE the request
    // is sent, because Remote requires one with a decline and a refusal that
    // arrives after the click reads as the page being broken.
    var reason = labelledTextarea("wa-reason-" + index, "Why are you declining? Remote requires a reason.", 2);
    var confirm = el("button", "r-btn r-btn-danger r-btn-sm", "Confirm decline");
    confirm.type = "button";
    var cancel = el("button", "r-btn r-btn-secondary r-btn-sm", "Cancel");
    cancel.type = "button";
    var declineActions = el("div", "wa-decline-actions");
    declineActions.appendChild(confirm);
    declineActions.appendChild(cancel);
    declineBox.appendChild(reason.field);
    declineBox.appendChild(declineActions);

    function busy(on) {
      approve.disabled = on || !decidable(entry, payload);
      decline.disabled = on || !decidable(entry, payload);
      confirm.disabled = on;
    }

    function send(action, reasonText) {
      busy(true);
      /* AN UNTOUCHED PREFILL IS NOT SENT ON A DECLINE. Remote's instruction to
         provide the expected activities is an APPROVAL instruction (Help Center
         20094378700557); it says nothing about a refusal. So on a decline an
         unread prefill would be an employer statement, on the durable audit
         row, about a trip they have just refused — with no source of authority
         at all. `server.js` compounds it: the record keeps only the decline
         reason, while the append-only row keeps the instructions, so the trail
         would carry a statement the record does not.

         An EDITED box is still sent on a decline. Those are the manager's own
         words and dropping them would lose something they wrote on purpose.
         The draft store is what tells the two apart. */
      var untouched = !Object.prototype.hasOwnProperty.call(STATE.drafts, entry.id);
      var instructionsText = action === "decline" && untouched ? "" : instructions.input.value;
      submitDecision(entry, action, reasonText, instructionsText).then(function (result) {
        busy(false);
        STATE.editing = null;
        declineBox.hidden = true;
        showOutcome(outcome, actions, detail, result);
        // The list is re-read afterwards so anything else that changed while
        // this one was open appears too; the outcome above survives it,
        // because STATE.decided is rendered back onto the row.
        load({ quiet: true });
      });
    }

    approve.addEventListener("click", function () {
      send("approve", "");
    });
    decline.addEventListener("click", function () {
      declineBox.hidden = false;
      STATE.editing = entry.id;
      reason.input.focus();
    });
    cancel.addEventListener("click", function () {
      declineBox.hidden = true;
      STATE.editing = null;
    });
    confirm.addEventListener("click", function () {
      send("decline", reason.input.value);
    });

    /* THE BOX SITS WITH THE BUTTONS, NOT INSIDE "FULL REQUEST".
       It used to be appended into the `<details>` block, which is COLLAPSED by
       default, while Approve was appended to the row and is not. So a manager
       could file a decision in one click having never seen the field, its label
       or the sentence saying whose words are in it — and with the prefill that
       became a real harm rather than a cosmetic one: the employee's four
       answers were adopted as the company's independent statement, silently,
       and then rendered back to the mobility specialist as "Note left" beside
       "Approved by <a named manager>" and sent to the Mobility Team's Zendesk
       queue under "Employer's words:". The specialist would be reading the
       traveller's own claim as corroboration by a second party.

       Everything the code said about this being safe — editable, labelled,
       disclaimed — was only ever true of a manager who opened the disclosure,
       and nothing asked them to. A control whose safeguards are one click away
       from the button that fires it has no safeguards. `<details>` keeps what
       it was always for: the record as filed, for reading. */
    row.appendChild(instructions.field);
    actions.appendChild(approve);
    actions.appendChild(decline);
    row.appendChild(actions);
    row.appendChild(declineBox);
    row.appendChild(detail);
    row.appendChild(outcome);

    // A decision taken earlier in this session is replayed onto its own row, so
    // the reader who just clicked still sees what happened after a poll.
    var already = pick(STATE.decided, String(entry.id));
    if (already) showOutcome(outcome, actions, detail, already);

    return row;
  }

  /**
   * THE VERDICT, ON THE ROW IT IS ABOUT — in the server's words.
   *
   * Every string here came back from the decision route: the status, the
   * reason, whether Remote was told, and what stage 3 is. Nothing is composed
   * from a status this page recognises, because it recognises none.
   */
  function showOutcome(target, actions, detail, result) {
    var json = (result && result.json) || {};
    clear(target);
    target.hidden = false;
    target.className = "wa-row-outcome " + (json.ok ? "is-ok" : "is-bad");
    if (actions) actions.hidden = Boolean(json.ok);
    if (detail && json.ok) detail.hidden = true;

    var head = el("p", "wa-outcome-head");
    head.appendChild(el("span", json.ok ? "r-status r-status-ok" : "r-status r-status-danger", json.status || json.code || ""));
    var approver = json.request && json.request.employer_approver;
    if (approver && (approver.name || approver.id)) {
      head.appendChild(el("span", "r-muted small", " Decided by " + (approver.name || approver.id)));
    }
    target.appendChild(head);
    if (json.reason) target.appendChild(el("p", "wa-outcome-line", json.reason));
    if (json.remoteWrite && json.remoteWrite.detail) {
      target.appendChild(el("p", "r-muted small", json.remoteWrite.detail));
    }
    if (json.nextStage) target.appendChild(el("p", "r-muted small", json.nextStage));
  }

  function submitDecision(entry, action, reasonText, instructionsText) {
    return api("api/work-authorizations/" + encodeURIComponent(entry.id) + "/decision", {
      method: "POST",
      body: JSON.stringify({
        action: action,
        reason: reasonText || "",
        employerSpecialInstructions: instructionsText || "",
      }),
    })
      .then(function (result) {
        // Remembered by id so the row can show it again after the next poll.
        // Only a decision the SERVER accepted is remembered: a refusal is about
        // this attempt, not about the record, and replaying it would tell the
        // reader their request had been settled when it has not.
        if (result.json && result.json.ok) {
          STATE.decided[String(entry.id)] = { entry: entry, json: result.json };
          // The draft has been submitted and is now on the audit row. Keeping
          // it would re-seed a decided request's box with words already spent.
          delete STATE.drafts[entry.id];
        }
        announce(result.json && (result.json.status || result.json.reason || result.json.code));
        return result;
      })
      .catch(function (err) {
        return { json: { ok: false, code: "unreachable", reason: err.message } };
      });
  }

  function announce(text) {
    var node = byId("announce");
    if (node) node.textContent = text ? String(text) : "";
  }

  /**
   * What this session is NOT being shown, and why.
   *
   * Rendered rather than filtered silently: a stand-in request whose employment
   * answers with another company is the boundary WORKING, and an exclusion
   * nobody can see is how this surface previously managed to say a person was
   * outside the company and show their request in the same breath.
   */
  function renderExclusions(target, payload) {
    clear(target);
    var excluded = (payload.scope && payload.scope.standinUnattributed) || [];
    var unreadable = (payload.scope && payload.scope.unreadable) || [];
    if (!excluded.length && !unreadable.length) return;

    var details = document.createElement("details");
    details.className = "wa-exclusions";
    details.appendChild(el("summary", "", "Not shown to you (" + (excluded.length + unreadable.length) + ")"));
    var list = el("ul", "r-muted small");
    excluded.forEach(function (row) {
      list.appendChild(el("li", "", row.id + " — " + row.reason));
    });
    unreadable.forEach(function (line) {
      list.appendChild(el("li", "", "employment not readable: " + line));
    });
    details.appendChild(list);
    target.appendChild(details);
  }

  function renderEmpty(target, payload) {
    // AN EMPTY LIST IS NOT ONE STATE. "Remote was asked and holds nothing" and
    // "this session owns nobody, so Remote was asked about nothing" look
    // identical on screen and are different facts — the second one is a
    // misconfiguration wearing the first one's clothes, and it shipped once.
    // The server decides which it is; this only renders the verdict.
    var verdict = (payload.scope && payload.scope.verdict) || {};
    var asked = payload.remoteProbe && payload.remoteProbe.asked;
    var box = el("div", asked ? "r-banner r-banner-neutral" : "r-banner r-banner-warn");
    box.setAttribute("role", "note");
    var body = el("span");
    body.appendChild(
      el("strong", "", asked ? "Nothing is awaiting your decision." : "Remote was not asked about anybody.")
    );
    body.appendChild(el("p", "", verdict.detail || ""));
    body.appendChild(el("p", "r-muted small", (payload.remoteProbe && payload.remoteProbe.detail) || ""));
    box.appendChild(body);
    target.appendChild(box);
  }

  function signatureOf(payload) {
    return (payload.requests || [])
      .map(function (entry) {
        return entry.id + ":" + ((entry.request && entry.request.status) || "");
      })
      .join("|");
  }

  function renderQueue(payload) {
    var queue = byId("queue");
    var message = byId("queue-message");
    queue.setAttribute("aria-busy", "false");
    clear(message);

    byId("queue-scope").textContent = describeScope(payload);
    byId("probe").textContent = describeProbe(payload.remoteProbe);

    var requests = payload.requests || [];
    byId("queue-count").textContent = requests.length ? "(" + requests.length + ")" : "";

    clear(queue);
    requests.forEach(function (entry, index) {
      queue.appendChild(renderRow(entry, payload, index));
    });

    // A request decided in this session has left the pending list, and the row
    // that showed the outcome would vanish with it. It is rendered back, marked
    // settled, so a reader is never left asking whether their click landed.
    var listed = {};
    requests.forEach(function (entry) {
      listed[String(entry.id)] = true;
    });
    Object.keys(STATE.decided).forEach(function (id, index) {
      if (pick(listed, id)) return;
      var remembered = STATE.decided[id];
      var entry = remembered.entry;
      if (!entry) return;
      var row = renderRow(entry, payload, "settled-" + index);
      row.className = "wa-row is-settled";
      queue.appendChild(row);
    });

    if (!queue.firstChild) renderEmpty(message, payload);
    renderExclusions(byId("exclusions"), payload);
  }

  // -- wiring ---------------------------------------------------------------

  function load(options) {
    var opts = options || {};
    if (STATE.loading) return Promise.resolve();
    STATE.loading = true;
    var queue = byId("queue");
    var message = byId("queue-message");
    if (!opts.quiet) {
      queue.setAttribute("aria-busy", "true");
      clear(message);
      message.appendChild(el("p", "r-muted", "Asking Remote what is awaiting your decision…"));
    }

    return api("api/work-authorizations")
      .then(function (result) {
        STATE.loading = false;
        if (result.status === 401 && String(result.json.code || "").indexOf("portal_access_key") === 0) {
          clear(queue);
          queue.setAttribute("aria-busy", "false");
          return renderAccessGate(message, result.json);
        }
        if (!result.json.ok) {
          clear(queue);
          queue.setAttribute("aria-busy", "false");
          clear(message);
          return message.appendChild(el("p", "r-muted", result.json.reason || result.json.code));
        }
        renderStages(result.json.stages, result.json.nextStage);

        // A poll that changed nothing must not rebuild the list under a
        // reader's cursor, and a poll must never discard something being
        // typed — the fetch still happened, only the render waits.
        var signature = signatureOf(result.json);
        /* A POLL DEFERS; AN EXPLICIT RELOAD DOES NOT. The deferral is right —
           rebuilding the list under a reader's cursor is its own defect — but
           it was also unconditional, so a single touched box stopped the whole
           queue updating for as long as the manager left it touched, while the
           live note went on promising a refresh every ten seconds and the
           Reload button did nothing. The person clicking Reload is ASKING for
           the rebuild, and STATE.drafts now means it costs them nothing. */
        if (STATE.editing && opts.quiet) {
          STATE.signature = "";
          describePolling();
          return undefined;
        }
        if (opts.quiet && signature === STATE.signature) return undefined;
        STATE.signature = signature;
        renderQueue(result.json);
        if (!opts.quiet) {
          announce((result.json.requests || []).length + " request(s) awaiting your decision.");
        }
        return undefined;
      })
      .catch(function (err) {
        STATE.loading = false;
        clear(queue);
        queue.setAttribute("aria-busy", "false");
        clear(message);
        message.appendChild(el("p", "r-muted", "Could not reach this page's API: " + err.message));
      });
  }

  /**
   * Auto-refresh, and the two things that stop it.
   *
   * A hidden tab polls nothing — a background tab is not a reader, and this
   * page is deployed on a shared function. Coming back into view re-reads
   * immediately rather than waiting out the interval, because the first thing a
   * returning manager does is look at the list. `Reload` stays on the page: an
   * interval is a promise about the future and a reader who wants to know NOW
   * should not have to trust it.
   */
  function startPolling() {
    if (STATE.timer) return;
    STATE.timer = window.setInterval(function () {
      if (document.hidden) return;
      load({ quiet: true });
    }, POLL_MS);
    describePolling();
  }

  function describePolling() {
    var note = byId("live-note");
    if (!note) return;
    /* THE NOTE HAS TO NAME THE PAUSE IT IS IN. It knew about one of the two —
       a backgrounded tab — and said "Auto-refreshing every 10 seconds" through
       the other, which is the state a manager reaches simply by typing in a
       box. The queue then stopped updating, the count beside it stayed stale,
       and the page said none of it. Naming the pause also has to name the way
       out, or it is a dead end with better wording. */
    note.textContent = document.hidden
      ? "Auto-refresh paused while this tab is in the background."
      : STATE.editing
        ? "Paused while you have unsent words in a request. Reload to refresh now — your words are kept."
        : "Auto-refreshing every " + Math.round(POLL_MS / 1000) + " seconds.";
  }

  function wire() {
    byId("reload").addEventListener("click", function () {
      load();
    });
    document.addEventListener("visibilitychange", function () {
      describePolling();
      if (!document.hidden) load({ quiet: true });
    });
    startPolling();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      wire();
      load();
    });
  } else {
    wire();
    load();
  }
})();
