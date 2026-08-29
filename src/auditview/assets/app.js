// ---------------------------------------------------------------------------
// app.js  —  The audit trail viewer's client (plain browser JS, no build step)
// ---------------------------------------------------------------------------
// WHAT THIS FILE IS ALLOWED TO DO
// Fetch the GET routes src/auditview/server.js serves and render what came
// back. That is all.
//
// WHAT IT DELIBERATELY DOES NOT DO
//   1. It re-derives no verdict. The duplicate-call banner renders the
//      server's redundantCalls array (computed by findRedundantCalls in the
//      metrics layer); the duplicate-delivery banner renders the server's
//      duplicateDeliveries array. DECISION_DOT below maps a decision word to
//      a colour and NOTHING else — an unrecognised decision still renders,
//      with its word, in the neutral style.
//   2. It never writes markup. Every dynamic value goes through textContent —
//      audit rows carry text customers and operators typed.
//   3. It holds no rule about access. The key prompt renders the server's own
//      refusal body, exactly like the portal's gate.
//   4. It POSTs nothing, because there is nothing to POST to — the server has
//      no POST route at all.
//
// WHAT IT DOES DECIDE, and why that is not a contradiction: how a VALUE LOOKS.
// Money is an integer in the currency's minor unit everywhere in this system
// (src/shared/money.js) — rendering 12500 as "125.00 USD" from the row's own
// paired currency field is presentation, and presentation belongs in the page.
// It never invents a currency: a money-shaped integer whose currency field is
// absent renders as the integer, because a number labelled with the wrong
// currency is worse than a number labelled with none.
//
// LIVE TAILING vs. PAGING — the one genuine tension on this page. Polling
// prepends rows; paging asks to look at a fixed window of history. They are
// resolved explicitly rather than left to race: the tail runs only on the
// NEWEST page, paging away from it pauses the tail and says so on screen, and
// coming back resumes it. Nothing ever shifts under a reader unannounced.
// Pagination itself is keyset on the server's `(at, id)` cursor; this file
// only remembers the STACK of pages walked, so "Newer" is a pop rather than a
// second kind of query that could disagree with the first.
// ---------------------------------------------------------------------------

(function () {
  "use strict";

  var POLL_MS = 4000;

  // -- decision colour, and nothing more ------------------------------------
  // Presentation only: the word always renders beside the dot, so colour is
  // never the sole carrier. The dots are the design system's three-step STATE
  // scale (settled/waiting/stopped — remote-ui.css), not the metrics chart's
  // categorical palette: a decision in a table is state, not series identity.
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

  var TIER_WORD = { low: "Low", medium: "Medium", high: "High" };

  // -- tiny DOM helpers ------------------------------------------------------

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
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  function decisionBadge(action) {
    var word = action === undefined || action === null ? "(none)" : String(action);
    var dot = Object.prototype.hasOwnProperty.call(DECISION_DOT, word) ? DECISION_DOT[word] : null;
    return el("span", "r-badge r-badge-decision" + (dot ? " r-badge-" + dot : ""), word);
  }

  /** The verdict a replay returned, beside the replay itself. Same open
   *  vocabulary as decisionBadge: an unrecognised word still renders, it just
   *  renders without a colour. */
  function replayedChip(priorDecision) {
    var word = String(priorDecision);
    var dot = Object.prototype.hasOwnProperty.call(DECISION_DOT, word) ? DECISION_DOT[word] : null;
    var chip = el("span", "r-badge r-badge-decision replayed-chip" + (dot ? " r-badge-" + dot : ""), "replayed: " + word);
    chip.title = "This request was not decided again — the stored decision for the same subject was returned.";
    return chip;
  }

  function tierBadge(tier) {
    if (!tier) return el("span", "r-none", "—");
    var known = Object.prototype.hasOwnProperty.call(TIER_WORD, tier);
    return el("span", "r-tier" + (known ? " r-tier-" + tier : ""), known ? TIER_WORD[tier] : String(tier));
  }

  function durableBadge(auditDurable) {
    // The server's boolean, rendered — the words carry the meaning, the colour
    // is decoration. null/undefined is honestly "unknown", not assumed safe.
    if (auditDurable === true) return el("span", "r-badge r-badge-ok", "yes — only the outward action was lost");
    if (auditDurable === false) return el("span", "r-badge r-badge-danger", "NO — the decision was lost");
    return el("span", "r-badge", "unknown");
  }

  function timeCell(iso) {
    var cell = el("td", "r-num when-cell");
    if (!iso) {
      cell.appendChild(el("span", "r-none", "—"));
      return cell;
    }
    var d = new Date(iso);
    var abs = isNaN(d.getTime()) ? String(iso) : d.toLocaleString();
    var node = el("time", "", abs);
    node.setAttribute("datetime", String(iso));
    node.title = String(iso);
    cell.appendChild(node);
    return cell;
  }

  // R7-36: an audit_trace row's `at` means a different clock depending on
  // which path wrote it — see src/shared/audit.js and
  // workflows/nodes/collectTraceSteps.js for why. Every row now carries
  // `details.atSemantic` naming which one, and this renders that label right
  // next to the timestamp it qualifies, rather than leaving a reader to guess
  // from `details.source` or from whether the value looks "too early."
  var AT_SEMANTIC_LABELS = {
    call_attempt: { text: "call time", title: "When the calling code recorded this attempt — before it was persisted." },
    trace_write: { text: "insert time", title: "When this row was inserted into audit_trace, downstream of the decision it describes — not when the traced call ran." },
  };

  function traceTimeCell(t) {
    var cell = timeCell(t && t.at);
    var semantic = t && t.details && AT_SEMANTIC_LABELS[t.details.atSemantic];
    if (semantic) {
      var chip = el("span", "at-semantic-chip", semantic.text);
      chip.title = semantic.title;
      cell.appendChild(chip);
    }
    return cell;
  }

  // R7-33: `actor` is written from three different vocabularies with nothing
  // on the page distinguishing them — an email, the literal
  // "unauthenticated", or (on paths with no logged-in session) the row's own
  // employmentId reused as the actor. The server now classifies which one a
  // given row carries (readStore.js's classifyActor()); this renders that
  // classification right next to the value, the same pattern R7-36 used for
  // an ambiguous timestamp above.
  var ACTOR_KIND_CHIP_TEXT = {
    unauthenticated: "unauthenticated",
    email: "email",
    employment_id_self: "employment id",
    uuid: "id",
    name: "name/role",
  };

  function actorKindChip(actorKind) {
    if (!actorKind || !Object.prototype.hasOwnProperty.call(ACTOR_KIND_CHIP_TEXT, actorKind.code)) return null;
    var chip = el("span", "actor-kind-chip", ACTOR_KIND_CHIP_TEXT[actorKind.code]);
    chip.title = actorKind.label;
    return chip;
  }

  function actorCell(decision) {
    var cell = textCell(decision.actor);
    var chip = actorKindChip(decision.actorKind);
    if (chip) cell.appendChild(chip);
    return cell;
  }

  function textCell(value, className) {
    var cell = el("td", className || "");
    if (value === undefined || value === null || value === "") {
      cell.appendChild(el("span", "r-none", "—"));
    } else {
      cell.textContent = String(value);
    }
    return cell;
  }

  // The three kinds, as the words a reader sees. The CLASSIFICATION is the
  // server's (readStore.js's DECISION_ACTIONS / EXECUTION_ACTIONS); this map
  // only spells it, the same division of labour as decisionBadge below.
  //
  // "Execution" is its own word because "Follow-up event" buried the row that
  // matters most: the one appended after the write to Remote returned, carrying
  // Remote's own response. Any kind this map does not know still renders — in
  // the event style, with whatever word the server sent — rather than
  // disappearing, the same open-vocabulary rule DECISION_DOT follows.
  var KIND_LABEL = {
    decision: { word: "Decision", cls: "r-badge-kind-decision" },
    execution: { word: "Execution", cls: "r-badge-kind-execution" },
    event: { word: "Follow-up event", cls: "r-badge-kind-event" },
  };

  function kindBadge(kind) {
    var spec = KIND_LABEL[kind];
    if (!spec) return el("span", "r-badge r-badge-kind-event", String(kind));
    return el("span", "r-badge " + spec.cls, spec.word);
  }

  /** The same word, for a sentence rather than a badge. */
  function kindWord(kind) {
    var spec = KIND_LABEL[kind];
    return spec ? spec.word : String(kind);
  }

  /**
   * WHAT A PERSON DECIDED, beside the action that records it.
   *
   * `humanVerdict` is the server's (src/auditview/humanDecision.js) — the word
   * and whether it settles the request, fills one signature slot, or defers it.
   * This function chooses none of that; it only spells it. Absent on every
   * automated row, so nothing renders there.
   *
   * WHY IT IS IN THE FEED AND NOT ONLY IN THE DRILL-DOWN. The row that reads
   * `expense_review_release` is a specialist authorising money; before this,
   * the feed said only that an action with that name happened, and a reader
   * scanning the page could not tell an approval from a tag update without
   * opening every row.
   */
  function humanChip(verdict) {
    var chip = el("span", "r-badge human-chip human-chip-" + verdict.shape, "human: " + verdict.word);
    chip.title =
      verdict.shape === "slot"
        ? "One role's signature on a request that needs more than one. The request is not settled by this row."
        : verdict.shape === "defers"
          ? "A person deferred the request rather than settling it. It stays open."
          : "A person's verdict on this request, recorded before anything was acted on.";
    return chip;
  }

  /**
   * The reason cell: THE SLUG, ALWAYS, and the plain words beside it when the
   * server sent any.
   *
   * The slug is never replaced. It is the exact string in `audit_log`, in the
   * metrics exception ranking and in the n8n Code-node ports — what a person
   * greps for and what the Action/search filters match — so prose in its place
   * would make the page readable and the system harder to trace. `reasonMeaning`
   * is null for a use case with no gate ladder at all (UC-07, UC-08) and for a
   * reason no rung matches, and this renders exactly as it always did in both cases:
   * no guess, no "unknown gate" placeholder.
   *
   * The sentence is clamped to two lines by CSS, with the whole of it on the
   * title and in full in the drill-down. Presentation, which is this file's
   * one job.
   */
  function reasonCell(row) {
    var cell = el("td", "reason-cell");
    if (row.reason === undefined || row.reason === null || row.reason === "") {
      cell.appendChild(el("span", "r-none", "—"));
      return cell;
    }
    var slug = el("span", "reason-slug", String(row.reason));
    slug.title = String(row.reason);
    cell.appendChild(slug);
    var meaning = row.reasonMeaning;
    if (meaning && meaning.means) {
      var prose = el("span", "reason-means", meaning.means);
      prose.title = meaning.means + (meaning.gate ? "\n\ngate: " + meaning.gate : "");
      cell.appendChild(prose);
    }
    return cell;
  }

  /** "gate 4 of 16 (Policy cap)" — only the parts the server actually sent. */
  function gateLine(meaning) {
    if (!meaning) return "";
    var where =
      meaning.position === null || meaning.position === undefined
        ? ""
        : "gate " + meaning.position + (meaning.total ? " of " + meaning.total : "");
    var named = meaning.gate ? (where ? " (" + meaning.gate + ")" : meaning.gate) : "";
    return (where + named).trim();
  }

  /** A short, still-identifiable form of a long id, with the whole one on hover. */
  function shortId(value) {
    var text = String(value);
    return text.length > 12 ? text.slice(0, 8) + "…" : text;
  }

  /**
   * The reference, as a thing you can act on rather than a string to squint at.
   *
   * THE REFERENCE IS THE ONE ID THAT TIES A REQUEST'S RECORDS TOGETHER, and
   * until this cell existed the feed showed it as dead text: a reader looking
   * at a row had the id in front of them and no way to get from it to
   * everything else under it except retyping it into another tab. It is never
   * shortened, for the same reason — a truncated reference cannot be copied,
   * quoted or pasted, which is the entire use of one.
   *
   * The button stops propagation because the ROW's own click opens the
   * drill-down; without that, tracing a reference would silently do the other
   * thing.
   */
  function refCell(value) {
    var cell = el("td", "r-id ref-cell");
    if (value === undefined || value === null || value === "") {
      cell.appendChild(el("span", "r-none", "—"));
      return cell;
    }
    var text = String(value);
    var button = el("button", "ref-trace", text);
    button.type = "button";
    button.title = "Trace " + text + " — every claim, decision, attempt and alert this id reaches";
    button.addEventListener("click", function (event) {
      event.stopPropagation();
      traceRef(text);
    });
    cell.appendChild(button);
    return cell;
  }

  /** Open the id lookup on a given string, from anywhere on the page. */
  function traceRef(ref) {
    byId("ref-input").value = ref;
    activateTab("bugaudit");
    lookupIdentifier(ref);
  }

  function idCell(value, className) {
    var cell = el("td", className || "r-id");
    if (value === undefined || value === null || value === "") {
      cell.appendChild(el("span", "r-none", "—"));
      return cell;
    }
    var node = el("span", "", shortId(value));
    node.title = String(value);
    cell.appendChild(node);
    return cell;
  }

  function chipList(values) {
    var wrap = el("span", "chips");
    values.forEach(function (value) {
      var chip = el("span", "chip", String(value));
      // A long flag code is truncated visually; the whole value stays on the
      // title, so nothing on this page ever shows a value it has silently cut.
      chip.title = String(value);
      wrap.appendChild(chip);
    });
    return wrap;
  }

  /** An array cell: chips, never `["a","b"]` — and an EMPTY array says so. */
  function flagsCell(flags) {
    var cell = el("td", "flags-cell");
    if (!Array.isArray(flags)) {
      cell.appendChild(el("span", "r-none", "—"));
    } else if (flags.length === 0) {
      cell.appendChild(el("span", "r-none", "none"));
    } else {
      cell.appendChild(chipList(flags));
    }
    return cell;
  }

  // -- value formatting (presentation only — see the file header) -------------

  /**
   * Money fields, each paired with the field carrying ITS currency code.
   *
   * Read off the writers (src/uc02/workflow.js records `amount` beside
   * `currency` and `convertedAmount` beside `convertedCurrency`, and both are
   * integers in the minor unit). A field is only ever rendered as money when
   * its partner is present in the SAME object — otherwise the integer is
   * printed as an integer, because guessing "USD" onto a figure this row never
   * labelled would be exactly the kind of confident wrongness a money ×100
   * system must not produce.
   */
  var MONEY_FIELDS = {
    amount: "currency",
    taxAmount: "currency",
    convertedAmount: "convertedCurrency",
    grossAmount: "currency",
    netAmount: "currency",
    payoutAmount: "currency",
    adjustmentAmount: "currency",
    oldSalary: "currency",
    newSalary: "currency",
  };

  function formatMoney(minorUnits, currency) {
    var human = Number(minorUnits) / 100;
    return (
      human.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " " + String(currency)
    );
  }

  var ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

  function isPlainObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }

  /**
   * One `details` entry rendered as a human would want to read it. Returns a
   * node, so an array becomes chips and a timestamp becomes a <time>.
   *
   * EMPTY IS NOT ABSENT. A key that is present with a null/empty value prints
   * the em dash (the portal's idiom); a key that is not in the object at all
   * simply has no row. Collapsing those two would erase the difference between
   * "the LLM drafted nothing" and "this writer never records a draft."
   */
  function valueNode(key, value, parent) {
    if (value === null || value === undefined || value === "") return el("span", "r-none", "—");

    if (typeof value === "boolean") return el("span", "bool bool-" + String(value), value ? "yes" : "no");

    if (typeof value === "number" && Object.prototype.hasOwnProperty.call(MONEY_FIELDS, key)) {
      var currency = parent ? parent[MONEY_FIELDS[key]] : null;
      if (currency) {
        var money = el("span", "money", formatMoney(value, currency));
        money.title = String(value) + " (integer, currency minor unit — src/shared/money.js)";
        return money;
      }
      // No currency in this row: print the raw integer and say why it is raw.
      var bare = el("span", "money-unlabelled", String(value));
      bare.title = "No currency field beside this amount in the row, so it is shown unconverted.";
      return bare;
    }

    if (Array.isArray(value)) {
      if (value.length === 0) return el("span", "r-none", "none");
      if (value.every(function (v) { return v === null || typeof v !== "object"; })) return chipList(value);
      return rawBlock(value, value.length + " entries");
    }

    if (typeof value === "string" && ISO_INSTANT.test(value) && !isNaN(new Date(value).getTime())) {
      var when = el("time", "", new Date(value).toLocaleString());
      when.setAttribute("datetime", value);
      when.title = value;
      return when;
    }

    return el("span", "", String(value));
  }

  /**
   * A nested object stays REACHABLE but stops being the primary presentation:
   * `remoteResult` is large and genuinely nested, and dumping it inline is how
   * the whole record became unreadable in the first place.
   */
  function rawBlock(value, summaryText) {
    var box = el("details", "raw-block");
    box.appendChild(el("summary", "raw-summary", summaryText));
    box.appendChild(el("pre", "details-json", JSON.stringify(value, null, 2)));
    return box;
  }

  /**
   * The label/value table. Headers run DOWN THE SIDE with scope="row" — the
   * portal's detailTable() idiom (src/portal/assets/app.js); without the scope
   * a screen reader pairs each value with the wrong header, or with none.
   * Nested objects sort to the bottom so the scalars a reader came for are not
   * pushed below a wall of JSON.
   */
  function detailTable(details) {
    var wrap = el("div", "r-table-wrap");
    var table = el("table", "r-table detail-table");
    var body = el("tbody");
    var keys = Object.keys(details);
    var scalars = keys.filter(function (k) { return !isPlainObject(details[k]); });
    var nested = keys.filter(function (k) { return isPlainObject(details[k]); });

    scalars.concat(nested).forEach(function (key) {
      var tr = el("tr");
      var th = el("th", "detail-label", key);
      th.setAttribute("scope", "row");
      tr.appendChild(th);
      var td = el("td", "detail-value");
      var value = details[key];
      td.appendChild(
        isPlainObject(value)
          ? rawBlock(value, Object.keys(value).length + " field" + (Object.keys(value).length === 1 ? "" : "s"))
          : valueNode(key, value, details)
      );
      tr.appendChild(td);
      body.appendChild(tr);
    });

    table.appendChild(body);
    wrap.appendChild(table);
    return wrap;
  }

  // -- access key (the portal's mechanism, same header) ----------------------

  var KEY_STORAGE = "auditview.accessKey";
  var KEY_HEADER = "X-Portal-Key";

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
      /* the request below still carries it */
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
  function api(path) {
    var headers = {};
    var key = storedKey();
    if (key) headers[KEY_HEADER] = key;
    return fetch(path, { method: "GET", headers: headers });
  }

  function showAccessGate(payload) {
    var configured = payload.code !== "portal_access_key_not_configured";
    byId("access-reason").textContent = payload.reason || "This viewer requires an access key.";
    byId("access-why").textContent = payload.why || "";
    var howto = byId("access-howto");
    clear(howto);
    (payload.howToFix || []).forEach(function (step) {
      howto.appendChild(el("li", "", String(step)));
    });
    byId("access-form").hidden = !configured;
    byId("access-gate").hidden = false;
    if (configured) byId("access-key").focus();
  }

  function hideAccessGate() {
    byId("access-gate").hidden = true;
  }

  // -- error rendering (a failed read must be SEEN, never an empty list) -----

  function showError(title, detail) {
    byId("error-title").textContent = title;
    byId("error-detail").textContent = detail || "";
    byId("error-banner").hidden = false;
  }

  function clearError() {
    byId("error-banner").hidden = true;
  }

  /**
   * Unwrap one API response. 401 → the access gate (throws "handled");
   * any other failure → the error banner, in the server's words.
   */
  function unwrap(res) {
    if (res.status === 401) {
      return res.json().then(function (payload) {
        forgetKey();
        showAccessGate(payload || {});
        throw new Error("__handled__");
      });
    }
    if (!res.ok) {
      return res.json().then(
        function (payload) {
          showError(
            "Read failed (" + ((payload && payload.code) || res.status) + ").",
            (payload && payload.reason) || "The server refused this read."
          );
          throw new Error("__handled__");
        },
        function () {
          showError("Read failed (HTTP " + res.status + ").", "");
          throw new Error("__handled__");
        }
      );
    }
    return res.json();
  }

  function swallowHandled(err) {
    if (err && err.message === "__handled__") return null;
    showError("Request failed.", err && err.message ? err.message : String(err));
    return null;
  }

  // -- mode ------------------------------------------------------------------

  function renderMode(mode) {
    var line = byId("mode-line");
    if (mode === "supabase") {
      line.textContent = "Supabase — live rows.";
      byId("seeded-banner").hidden = true;
    } else if (mode === "seeded") {
      line.textContent = "Seeded demo data.";
      byId("seeded-banner").hidden = false;
    } else {
      line.textContent = "No durable store attached.";
    }
  }

  // -- tabs ------------------------------------------------------------------

  var TABS = ["feed", "bugaudit", "alerts"];

  function activateTab(name) {
    TABS.forEach(function (tab) {
      byId("tab-" + tab).hidden = tab !== name;
      var nav = byId("nav-" + tab);
      nav.classList.toggle("is-active", tab === name);
      if (tab === name) nav.setAttribute("aria-current", "page");
      else nav.removeAttribute("aria-current");
    });
    if (name === "alerts") loadAlerts();
  }

  // -- the live feed ---------------------------------------------------------

  // The reader's own preference, which is NOT the same as whether the tail is
  // actually running: paging into history suspends it without forgetting that
  // the reader asked for it, so returning to the newest page resumes rather
  // than making them click twice.
  var liveWanted = true;
  var pollTimer = null;

  // The page cursors already walked. Empty = the newest page, the only page
  // the tail may run on. Each entry is a server-issued opaque cursor.
  var cursorStack = [];
  var nextCursor = null; // cursor for the page AFTER the one on screen
  var pageRange = { first: null, last: null, count: 0 };

  // The tail cursor: the newest (at, id) already rendered. BOTH halves — a row
  // sharing the newest millisecond would otherwise never arrive (`at >`) or
  // arrive twice (`at >=`), which is the same tiebreak problem paging has.
  var newestAt = null;
  var newestId = null;

  // E4-F15 (rca-0nm) — every id currently rendered on screen, kept in sync
  // with the DOM by loadPage() (which rebuilds it from the page just drawn)
  // and pollFeed() (which adds as it prepends). This is defence in depth: the
  // server-side fix for the boundary row being re-served is in readStore.js's
  // listDecisions(), but a client that trusts the server's "since"/"since_id"
  // boundary to be exclusive with no check of its own has no second line of
  // defence against exactly the class of bug that caused this — a
  // sub-millisecond precision loss on the round trip through `at`. Filtering
  // here by id, which is never lossy, means a repeated boundary row can never
  // render twice no matter what causes the repeat.
  var seenIds = new Set();

  function tailRunning() {
    return liveWanted && cursorStack.length === 0;
  }

  function pageSize() {
    return byId("page-size").value;
  }

  function filterParams() {
    var params = new URLSearchParams();
    var useCase = byId("filter-usecase").value;
    var action = byId("filter-action").value;
    var q = byId("filter-q").value.trim();
    if (useCase) params.set("use_case", useCase);
    if (action) params.set("action", action);
    if (q) params.set("q", q);
    params.set("limit", pageSize());
    return params;
  }

  function feedRow(decision) {
    var tr = el("tr", "feed-row");
    tr.tabIndex = 0;
    tr.setAttribute("role", "button");
    tr.setAttribute("aria-label", "Open " + kindWord(decision.kind).toLowerCase() + " " + decision.id);
    tr.appendChild(timeCell(decision.at));
    var kindCell = el("td");
    kindCell.appendChild(kindBadge(decision.kind));
    tr.appendChild(kindCell);
    tr.appendChild(textCell(decision.useCase));
    var decisionCell = el("td");
    decisionCell.appendChild(decisionBadge(decision.action));
    // WHAT A REPLAY HANDED BACK. `duplicate_request_ignored` is a decision in
    // this feed's vocabulary (readStore.js's DECISION_ACTIONS explains why: it
    // is written INSTEAD of a decision row, not alongside one) — but on its own
    // it names a refusal without naming the verdict, and a column of them reads
    // as a wall with no outcome in it. The replayed decision is the outcome.
    if (decision.priorDecision) {
      decisionCell.appendChild(replayedChip(decision.priorDecision));
    }
    // WHO DECIDED WHAT, when a person did. `expense_review_release` names the
    // handler; "human: released for payment" names the act.
    if (decision.humanVerdict) {
      decisionCell.appendChild(humanChip(decision.humanVerdict));
    }
    tr.appendChild(decisionCell);
    var tierCell = el("td");
    tierCell.appendChild(tierBadge(decision.riskTier));
    tr.appendChild(tierCell);
    tr.appendChild(actorCell(decision));
    tr.appendChild(idCell(decision.employmentId));
    tr.appendChild(refCell(decision.externalRef));
    // The record id this row's siblings share. Visible in the feed so three
    // rows on one record read as three rows on one record.
    var group = el("td", "r-id group-cell");
    if (decision.correlationKey) {
      var groupNode = el("span", "", shortId(decision.correlationKey));
      groupNode.title = decision.correlationField + ": " + decision.correlationKey;
      group.appendChild(groupNode);
    } else {
      group.appendChild(el("span", "r-none", "—"));
    }
    tr.appendChild(group);
    tr.appendChild(textCell(decision.traceCount, "r-num"));
    tr.appendChild(flagsCell(decision.flags));
    tr.appendChild(textCell(decision.source));
    tr.appendChild(reasonCell(decision));
    function open() {
      openDrill(decision.id);
    }
    tr.addEventListener("click", open);
    tr.addEventListener("keydown", function (event) {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        open();
      }
    });
    return tr;
  }

  function renderFeedEmptyState() {
    var empty = byId("feed-rows").children.length === 0;
    byId("feed-empty").hidden = !empty;

    // A SEARCH THAT FOUND NOTHING IS NOT PROOF THE REQUEST DID NOT HAPPEN.
    // This feed searches `audit_log` only, and a decision row carries the
    // reference only if its use case wrote one there — the exactly-once ledger
    // may hold it either way. So an empty result under a non-empty search box
    // offers the lookup that reads both tables, instead of letting "no rows"
    // stand as the answer to "where did my request go?".
    var q = byId("filter-q").value.trim();
    var offer = byId("feed-empty-trace");
    offer.hidden = !(empty && q);
    if (offer.hidden) return;
    byId("feed-empty-trace-text").textContent =
      "This feed searches audit_log only, and matches a substring of the actor, reference, reason or record id. The id lookup tries an exact match against every identifier all four tables carry, and says what it looked at: ";
    var button = byId("feed-trace-q");
    button.textContent = "Trace " + q;
  }

  /** Where the reader is, in words — page number and the window on screen. */
  function renderPager() {
    var page = cursorStack.length + 1;
    var where = byId("pager-where");
    if (!pageRange.count) {
      where.textContent = cursorStack.length ? "Page " + page + " — no rows here." : "";
    } else {
      where.textContent =
        "Page " +
        page +
        " · " +
        pageRange.count +
        " row" +
        (pageRange.count === 1 ? "" : "s") +
        ", " +
        new Date(pageRange.first).toLocaleString() +
        " → " +
        new Date(pageRange.last).toLocaleString() +
        (nextCursor ? "" : " · oldest page");
    }
    byId("page-newer").disabled = cursorStack.length === 0;
    byId("page-older").disabled = !nextCursor;
    byId("pager-paused").hidden = tailRunning() || !liveWanted;
    renderLiveToggle();
  }

  /**
   * Load the page named by the current cursor stack. Used for the first load,
   * a filter change, a page-size change and both pager buttons — one code
   * path, so a page can never be assembled two different ways.
   */
  function loadPage() {
    var params = filterParams();
    var top = cursorStack.length ? cursorStack[cursorStack.length - 1] : null;
    if (top) params.set("before", top);
    api("api/decisions?" + params.toString())
      .then(unwrap)
      .then(function (payload) {
        if (!payload) return;
        clearError();
        hideAccessGate();
        renderMode(payload.mode);
        var rows = byId("feed-rows");
        clear(rows);
        seenIds = new Set();
        payload.decisions.forEach(function (d) {
          rows.appendChild(feedRow(d));
          seenIds.add(d.id);
        });
        nextCursor = payload.page ? payload.page.nextCursor : null;
        pageRange = {
          count: payload.decisions.length,
          first: payload.decisions.length ? payload.decisions[0].at : null,
          last: payload.decisions.length ? payload.decisions[payload.decisions.length - 1].at : null,
        };
        // The tail only ever continues from the newest page's newest row.
        if (cursorStack.length === 0 && payload.decisions.length) {
          newestAt = payload.decisions[0].at;
          newestId = payload.decisions[0].id;
        }
        renderFeedEmptyState();
        renderPager();
      })
      .catch(swallowHandled);
  }

  /** Filters or page size changed: back to the newest page, cursors dropped. */
  function reloadFeed() {
    cursorStack = [];
    nextCursor = null;
    newestAt = null;
    newestId = null;
    loadPage();
  }

  /** Tail: fetch only rows newer than the newest seen, prepend them. */
  function pollFeed() {
    if (!tailRunning()) return;
    var params = filterParams();
    if (newestAt) {
      params.set("since", newestAt);
      if (newestId) params.set("since_id", newestId);
    }
    api("api/decisions?" + params.toString())
      .then(unwrap)
      .then(function (payload) {
        if (!payload) return;
        clearError();
        // A poll that lands after the reader has paged away must not inject
        // rows into the history page they are now reading.
        if (!tailRunning()) return;
        // E4-F15 (rca-0nm): the server's "since"/"since_id" boundary can
        // re-serve the row already on screen (a sub-millisecond precision
        // loss on `at`'s round trip through the wire); drop anything whose id
        // is already rendered before it ever reaches the DOM, so a repeated
        // boundary row can never be inserted twice.
        var fresh = payload.decisions.filter(function (d) {
          return !seenIds.has(d.id);
        });
        var rows = byId("feed-rows");
        // Newest first from the server; prepend in reverse so order holds.
        for (var i = fresh.length - 1; i >= 0; i--) {
          var row = feedRow(fresh[i]);
          row.classList.add("feed-row-new");
          rows.insertBefore(row, rows.firstChild);
          seenIds.add(fresh[i].id);
        }
        if (fresh.length) {
          newestAt = fresh[0].at;
          newestId = fresh[0].id;
          pageRange = {
            count: rows.children.length,
            first: fresh[0].at,
            last: pageRange.last,
          };
          renderPager();
        }
        renderFeedEmptyState();
      })
      .catch(swallowHandled);
  }

  function renderLiveToggle() {
    var on = tailRunning();
    var toggle = byId("live-toggle");
    toggle.setAttribute("aria-pressed", liveWanted ? "true" : "false");
    toggle.classList.toggle("is-paused", !on);
    byId("live-toggle-word").textContent = on
      ? "Live"
      : liveWanted
        ? "Paused (paging)"
        : "Paused";
  }

  function setLive(on) {
    liveWanted = on;
    renderPager();
  }

  // -- drill-down ------------------------------------------------------------

  function summaryItem(label, node) {
    var wrap = el("div", "summary-item");
    wrap.appendChild(el("span", "summary-label", label));
    wrap.appendChild(node);
    return wrap;
  }

  function openDrill(id) {
    api("api/decisions/" + encodeURIComponent(id))
      .then(unwrap)
      .then(function (payload) {
        if (!payload) return;
        clearError();
        var d = payload.decision;
        byId("drill-id").textContent = d.id;
        byId("drill-title-word").textContent = kindWord(d.kind);

        var summary = byId("drill-summary");
        clear(summary);
        summary.appendChild(summaryItem("Row kind", kindBadge(d.kind)));
        summary.appendChild(summaryItem("Use case", el("span", "", d.useCase)));
        summary.appendChild(summaryItem("Action", decisionBadge(d.action)));
        var actorNode = el("span", "", d.actor || "—");
        var actorChip = actorKindChip(d.actorKind);
        if (actorChip) actorNode.appendChild(actorChip);
        summary.appendChild(summaryItem("Actor", actorNode));
        summary.appendChild(summaryItem("Tier", tierBadge(d.riskTier)));
        var when = el("span", "", d.at ? new Date(d.at).toLocaleString() : "—");
        summary.appendChild(summaryItem("When", when));

        renderReason(d);
        renderHumanDecision(payload);
        renderWriteOutcome(payload);

        // The server's verdict, rendered verbatim. An empty `redundantCalls`
        // means no OFFENDING group exists — true both when every multi-attempt
        // group was a clean retry sequence AND when there is no multi-attempt
        // group at all (three different calls, each fired once, is not a
        // retry sequence to describe). `hasMultiAttemptGroup` is what tells
        // those two apart, so the "reads as one clean retry sequence" blurb
        // only shows when there is actually a group it is a claim about.
        var redundant = payload.redundantCalls || [];
        byId("drill-redundant").hidden = redundant.length === 0;
        byId("drill-clean").hidden = redundant.length !== 0 || !payload.hasMultiAttemptGroup;
        byId("drill-redundant-detail").textContent = redundant
          .map(function (flag) {
            return flag.detail;
          })
          .join(" ");

        var traceBody = byId("drill-trace");
        clear(traceBody);
        payload.trace.forEach(function (t) {
          var tr = el("tr");
          tr.appendChild(traceTimeCell(t));
          tr.appendChild(textCell(t.call, "r-mono"));
          tr.appendChild(textCell(t.attempt, "r-num"));
          var outcome = el("td");
          outcome.appendChild(
            t.ok
              ? el("span", "r-status r-status-ok", "ok")
              : el("span", "r-status r-status-danger", "failed")
          );
          tr.appendChild(outcome);
          var duration =
            t.details && t.details.durationMs !== undefined && t.details.durationMs !== null
              ? t.details.durationMs + " ms"
              : null;
          tr.appendChild(textCell(duration, "r-num"));
          tr.appendChild(textCell(t.error, "error-cell"));
          traceBody.appendChild(tr);
        });

        renderTraceVerdict(payload);
        renderSiblings(payload);

        // The record, as a table. The raw JSON stays one click away — kept
        // reachable for debugging, just no longer the primary presentation.
        var details = d.details || {};
        var detailsBox = byId("drill-details");
        clear(detailsBox);
        var keys = Object.keys(details);
        byId("drill-details-empty").hidden = keys.length > 0;
        if (keys.length) detailsBox.appendChild(detailTable(details));
        byId("drill-details-raw").textContent = JSON.stringify(details, null, 2);

        byId("drill").hidden = false;
        byId("drill").scrollIntoView({ behavior: "smooth", block: "nearest" });
      })
      .catch(swallowHandled);
  }

  /**
   * The stored reason, in full: the slug, then the plain words its own policy
   * engine holds, then which rung of that engine's ladder decided.
   *
   * Shown only when the server sent a meaning. A use case with no gate ladder
   * (UC-01, UC-06) and an unrecognised reason both render as they always have —
   * the slug alone, in the summary and the details table — because inventing a
   * sentence for a ladder that does not exist is worse than the slug.
   */
  function renderReason(d) {
    var box = byId("drill-reason");
    var meaning = d.reasonMeaning;
    if (!d.reason || !meaning || !meaning.means) {
      box.hidden = true;
      return;
    }
    byId("drill-reason-slug").textContent = String(d.reason);
    byId("drill-reason-means").textContent = meaning.means;
    byId("drill-reason-gate").textContent = gateLine(meaning);
    box.hidden = false;
  }

  /**
   * A PERSON'S DECISION, when this row is one.
   *
   * Every word is the server's: `humanVerdict` says what they decided
   * (src/auditview/humanDecision.js). This function shows the block exactly
   * when the server sent a verdict and lists the facts the row actually
   * carries — a missing note prints "no note recorded", which is different
   * from a note this page failed to show.
   *
   * THE AI's RECOMMENDATION IS LISTED BESIDE THE HUMAN's VERDICT because that
   * pairing is the whole reason the approval handlers record `aiDecision` on the
   * same row: without it, "did the specialist agree with the automation?" is
   * unanswerable from history, and the HITL accept rate would be restating its
   * own definition.
   *
   * The write-outcome question ("did it reach Remote?") is NOT rendered here
   * any more — see renderWriteOutcome() below. It used to live inside this
   * block, gated on the same `d.humanVerdict` check, which meant it never even
   * ran on a fully automated row (R7-32 / rca-ltja). The two questions ("did a
   * person decide this?" and "did the write land?") are independent and are
   * now shown independently.
   */
  function renderHumanDecision(payload) {
    var d = payload.decision;
    var box = byId("drill-human");
    if (!d.humanVerdict) {
      box.hidden = true;
      return;
    }
    box.hidden = false;

    var actorKindText = d.actorKind ? " (" + ACTOR_KIND_CHIP_TEXT[d.actorKind.code] + ")" : "";
    byId("drill-human-headline").textContent =
      (d.actor ? d.actor + actorKindText : "an unnamed actor") + " — " + d.humanVerdict.word;

    var facts = byId("drill-human-facts");
    clear(facts);
    addFact(facts, "Decided by", d.actor ? d.actor + actorKindText : "not recorded on this row");
    if (d.role) addFact(facts, "Acting as", d.role);
    addFact(facts, "Note", d.note ? d.note : "no note recorded");
    addFact(
      facts,
      "The automation had recommended",
      d.aiDecision ? d.aiDecision : "not recorded on this row"
    );
  }

  /**
   * DID THE WRITE THIS DECISION AUTHORISED ACTUALLY LAND AT REMOTE?
   *
   * Every word is the server's (src/auditview/humanDecision.js's
   * writeOutcome()). Shown for ANY decision row — a person's verdict or a
   * fully automated `auto_resolve`/`auto_approve` alike, which is the fix for
   * R7-32 / rca-ltja: the check used to be nested inside the human-decision
   * block and therefore only ever ran when `humanVerdict` was set, so an
   * automated row's `letterIssued: true` (or an automated approval) went
   * unexamined — attempts existing under a row is not evidence an outward
   * write happened. `payload.writeOutcome` is null for a row this question
   * does not apply to at all (an execution row, or an ordinary follow-up
   * event), and the block hides exactly then.
   */
  function renderWriteOutcome(payload) {
    var write = payload.writeOutcome;
    var box = byId("drill-write");
    if (!write) {
      box.hidden = true;
      return;
    }
    box.hidden = false;
    box.className = "verdict verdict-" + (write.code || "unknown");
    byId("drill-write-headline").textContent = write.headline || "";
    byId("drill-write-detail").textContent = write.detail || "";
  }

  function addFact(list, label, value) {
    var li = el("li", "");
    li.appendChild(el("span", "fact-label", label + ": "));
    li.appendChild(el("span", "fact-value", String(value)));
    list.appendChild(li);
  }

  /**
   * The empty-attempts verdict. Every word here is the server's
   * (traceVerdict.js); this function decides only whether the block is shown
   * at all — and it is shown exactly when the table it explains is empty.
   */
  function renderTraceVerdict(payload) {
    var verdict = payload.traceVerdict || {};
    var box = byId("drill-verdict");
    box.hidden = payload.trace.length > 0;
    box.className = "verdict verdict-" + (verdict.code || "unknown");
    byId("drill-verdict-headline").textContent = verdict.headline || "";
    byId("drill-verdict-detail").textContent = verdict.detail || "";

    var evidence = byId("drill-verdict-evidence");
    clear(evidence);
    (verdict.evidence || []).forEach(function (item) {
      var li = el("li", "");
      li.appendChild(el("span", "r-mono evidence-field", item.field + ": " + item.value));
      li.appendChild(el("span", "evidence-meaning", " — " + item.meaning));
      evidence.appendChild(li);
    });

    var jump = byId("drill-verdict-open");
    jump.hidden = !verdict.relatedDecisionId;
    jump.onclick = verdict.relatedDecisionId
      ? function () {
          openDrill(verdict.relatedDecisionId);
        }
      : null;
  }

  /**
   * The other rows sharing this row's RECORD id. Deliberately not "the rows of
   * this submission": one record can be submitted more than once, and live it
   * was — a second expense submission joined an existing group two hours later
   * as `duplicate_request_ignored`. Grouping all of them is right (a reader
   * auditing that expense wants all of them); calling them one submission was
   * not. When the server reports no correlation field, this says so plainly —
   * the alternative would be grouping by timestamp proximity, which is evidence
   * of nothing.
   */
  function renderSiblings(payload) {
    var correlation = payload.correlation || {};
    var siblings = payload.siblings || [];
    var note = byId("drill-correlation");
    var wrap = byId("drill-siblings-wrap");
    var body = byId("drill-siblings");
    clear(body);

    if (!correlation.field) {
      note.textContent =
        "This row carries no shared record id in its details, so the other rows on the same record cannot be " +
        "identified for it. Grouping by timestamp alone would be a guess, so nothing is grouped.";
      wrap.hidden = true;
      return;
    }

    if (!siblings.length) {
      note.textContent =
        "No other audit_log row carries " + correlation.field + " " + correlation.key + " — this record has one row.";
      wrap.hidden = true;
      return;
    }

    note.textContent =
      siblings.length +
      " other row" +
      (siblings.length === 1 ? "" : "s") +
      " share " +
      correlation.field +
      " " +
      correlation.key +
      ", oldest first.";
    wrap.hidden = false;
    siblings.forEach(function (s) {
      var tr = el("tr", "feed-row");
      tr.tabIndex = 0;
      tr.setAttribute("role", "button");
      tr.appendChild(timeCell(s.at));
      var kind = el("td");
      kind.appendChild(kindBadge(s.kind));
      tr.appendChild(kind);
      var action = el("td");
      action.appendChild(decisionBadge(s.action));
      if (s.humanVerdict) action.appendChild(humanChip(s.humanVerdict));
      tr.appendChild(action);
      tr.appendChild(textCell(s.traceCount, "r-num"));
      tr.appendChild(reasonCell(s));
      function open() {
        openDrill(s.id);
      }
      tr.addEventListener("click", open);
      tr.addEventListener("keydown", function (event) {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          open();
        }
      });
      body.appendChild(tr);
    });
  }

  // -- bug audit -------------------------------------------------------------

  /**
   * THE ONE LOOKUP. It takes whatever id the reader holds and asks the server
   * to try it everywhere, rather than requiring them to know which kind of id
   * it is — the requirement that made a recorded decision look like a lost one.
   *
   * Two sections come back and they answer different questions, so both
   * render: the IDENTIFIER section (what carries this id, matched on which
   * field, and what an empty answer does and does not prove) always, and the
   * REFERENCE section (claims, the per-reference timeline, nearby alerts) only
   * when the value actually resolved as an external reference. The server
   * decides which of those applies; this file only renders what it was sent.
   */
  function lookupIdentifier(value) {
    api("api/lookup/" + encodeURIComponent(value))
      .then(unwrap)
      .then(function (payload) {
        if (!payload) return;
        clearError();
        hideAccessGate();
        renderMode(payload.mode);
        renderLookup(payload);
        if (payload.reference) renderReference(payload.reference);
        else byId("ref-results").hidden = true;
      })
      .catch(swallowHandled);
  }

  function renderReference(payload) {
    byId("ref-results").hidden = false;
    renderRefVerdict(payload.refVerdict);

    var duplicates = payload.duplicateDeliveries || [];
    byId("ref-duplicate").hidden = duplicates.length === 0;
    byId("ref-duplicate-detail").textContent = duplicates
      .map(function (d) {
        return d.useCase + " recorded " + d.decisionRows + " decision rows for ref " + d.externalRef + ".";
      })
      .join(" ");

    var claims = byId("ref-claims");
    clear(claims);
    payload.claims.forEach(function (c) {
      var tr = el("tr");
      tr.appendChild(textCell(c.useCase));
      tr.appendChild(timeCell(c.claimedAt));
      var cell = el("td");
      cell.appendChild(decisionBadge(c.decision));
      tr.appendChild(cell);
      tr.appendChild(textCell(c.note));
      claims.appendChild(tr);
    });
    byId("ref-claims-empty").hidden = payload.claims.length > 0;

    var decisions = byId("ref-decisions");
    clear(decisions);
    payload.decisions.forEach(function (d) {
      var tr = el("tr", "feed-row");
      tr.tabIndex = 0;
      tr.appendChild(timeCell(d.at));
      var kind = el("td");
      kind.appendChild(kindBadge(d.kind));
      tr.appendChild(kind);
      tr.appendChild(textCell(d.useCase));
      var cell = el("td");
      cell.appendChild(decisionBadge(d.action));
      if (d.humanVerdict) cell.appendChild(humanChip(d.humanVerdict));
      tr.appendChild(cell);
      tr.appendChild(actorCell(d));
      tr.appendChild(textCell(d.traceCount, "r-num"));
      tr.appendChild(reasonCell(d));
      tr.addEventListener("click", function () {
        activateTab("feed");
        openDrill(d.id);
      });
      decisions.appendChild(tr);
    });
    byId("ref-decisions-empty").hidden = payload.decisions.length > 0;

    var alerts = byId("ref-alerts");
    clear(alerts);
    payload.alerts.forEach(function (a) {
      alerts.appendChild(alertRefRow(a));
    });
    byId("ref-alerts-empty").hidden = payload.alerts.length > 0;
    byId("ref-window").textContent = payload.alertWindow
      ? "window: ±15 min around this ref's activity"
      : "no activity, so no window to search";
  }

  /**
   * The identifier half. `matchedOn` is rendered on every row on purpose: a
   * row can match because it IS this request or merely because it shares the
   * employee, and only the field name tells the two apart. The verdict's words
   * are the server's — this function picks a tone class and writes text.
   */
  function renderLookup(payload) {
    byId("lookup-results").hidden = false;
    var verdict = payload.identifierVerdict || null;
    var banner = byId("lookup-verdict");
    if (!verdict) {
      banner.hidden = true;
    } else {
      var tone = Object.prototype.hasOwnProperty.call(VERDICT_TONE, verdict.tone) ? verdict.tone : "neutral";
      banner.className = "r-banner " + VERDICT_TONE[tone];
      byId("lookup-verdict-icon").textContent = VERDICT_ICON[tone];
      byId("lookup-verdict-headline").textContent = verdict.headline || "";
      byId("lookup-verdict-detail").textContent = verdict.detail ? " " + verdict.detail : "";
      var notes = byId("lookup-verdict-notes");
      clear(notes);
      (verdict.notes || []).forEach(function (note) {
        notes.appendChild(el("span", "ref-verdict-note", note));
      });
      // The shape reading is the server's too, and it is shown beside the
      // verdict rather than instead of it: "we think this is a UUID" is
      // context for the answer, never the answer.
      byId("lookup-verdict-shape").textContent = payload.shape
        ? "Read as " + payload.shape.label + ". " + payload.shape.meaning
        : "";
      banner.hidden = false;
    }

    var steps = (verdict && verdict.nextSteps) || [];
    byId("lookup-next").hidden = steps.length === 0;
    var stepList = byId("lookup-next-steps");
    clear(stepList);
    steps.forEach(function (step) {
      stepList.appendChild(el("li", "", step));
    });

    // Rows already shown in the reference timeline below are not repeated
    // here; anything matched on some OTHER field is exactly what the old
    // reference-only lookup could not reach, so it is the part worth showing.
    var rows = payload.decisions || [];
    if (payload.reference) {
      rows = rows.filter(function (row) {
        return (row.matchedOn || []).some(function (f) {
          return f !== "externalRef";
        });
      });
      byId("lookup-rows-title").textContent = "Other rows carrying this id";
    } else {
      byId("lookup-rows-title").textContent = "Rows carrying this id (audit_log)";
    }
    byId("lookup-rows-card").hidden = rows.length === 0;
    byId("lookup-rows-meta").textContent =
      rows.length >= payload.rowCap ? "showing the first " + payload.rowCap : "";
    var body = byId("lookup-rows");
    clear(body);
    rows.forEach(function (d) {
      var tr = el("tr", "feed-row");
      tr.tabIndex = 0;
      tr.appendChild(timeCell(d.at));
      var kind = el("td");
      kind.appendChild(kindBadge(d.kind));
      tr.appendChild(kind);
      tr.appendChild(textCell(d.useCase));
      var cell = el("td");
      cell.appendChild(decisionBadge(d.action));
      if (d.humanVerdict) cell.appendChild(humanChip(d.humanVerdict));
      tr.appendChild(cell);
      tr.appendChild(actorCell(d));
      var matched = el("td");
      matched.appendChild(chipList(d.matchedOn || []));
      tr.appendChild(matched);
      tr.appendChild(reasonCell(d));
      tr.addEventListener("click", function () {
        activateTab("feed");
        openDrill(d.id);
      });
      body.appendChild(tr);
    });

    var traces = payload.traces || [];
    byId("lookup-traces-card").hidden = traces.length === 0;
    var traceBody = byId("lookup-traces");
    clear(traceBody);
    traces.forEach(function (t) {
      var tr = el("tr");
      tr.appendChild(traceTimeCell(t));
      tr.appendChild(textCell(t.call));
      tr.appendChild(textCell(t.attempt, "r-num"));
      tr.appendChild(textCell(t.ok === null || t.ok === undefined ? null : t.ok ? "yes" : "no"));
      var matchedCell = el("td");
      matchedCell.appendChild(chipList(t.matchedOn || []));
      tr.appendChild(matchedCell);
      traceBody.appendChild(tr);
    });

    var alerts = payload.alerts || [];
    byId("lookup-alerts-card").hidden = alerts.length === 0;
    var alertBody = byId("lookup-alerts");
    clear(alertBody);
    alerts.forEach(function (a) {
      alertBody.appendChild(alertRefRow(a));
    });

    // WHERE IT LOOKED — open by default when nothing was found, because that
    // is exactly when a reader needs to see the boundary of the search rather
    // than infer one.
    var scope = byId("lookup-scope");
    var searched = payload.searched || [];
    var found = (payload.matches || []).length > 0;
    scope.open = !found;
    byId("lookup-scope-count").textContent =
      searched.length + " identifier fields across audit_log, audit_trace, workflow_claims and ops_alerts";
    var searchedList = byId("lookup-searched");
    clear(searchedList);
    searched.forEach(function (t) {
      var li = el("li", "");
      li.appendChild(el("span", "r-mono", t.target));
      li.appendChild(el("span", "", " — " + t.label));
      searchedList.appendChild(li);
    });
    var unsearchable = byId("lookup-unsearchable");
    clear(unsearchable);
    (payload.notSearchableHere || []).forEach(function (item) {
      var li = el("li", "");
      li.appendChild(el("strong", "", item.what));
      li.appendChild(el("span", "", " — " + item.why + " Look instead in: " + item.where));
      unsearchable.appendChild(li);
    });
  }

  /**
   * The server's verdict on what this reference can actually trace.
   *
   * Every word is the server's (src/auditview/refVerdict.js) — this function
   * chooses a tone class and an icon from the verdict's own `tone` and writes
   * text. It never inspects claims, decisions or alerts to reach an opinion of
   * its own: which of four situations an empty table means is a judgement, and
   * a second copy of it here is how the page and the API come to disagree.
   */
  // Only the tone classes the shared design system actually defines
  // (src/shared/ui/remote-ui.css). `ok` deliberately lands on the neutral
  // treatment rather than a green one: a complete trace is a normal state, and
  // a success colour beside a decision badge that may itself say `escalate`
  // would read as a verdict on the request rather than on the trail.
  var VERDICT_TONE = { ok: "r-banner-neutral", warn: "r-banner-warn", neutral: "r-banner-neutral" };
  var VERDICT_ICON = { ok: "✓", warn: "⚠", neutral: "ℹ" };

  function renderRefVerdict(verdict) {
    var banner = byId("ref-verdict");
    if (!verdict) {
      banner.hidden = true;
      return;
    }
    var tone = Object.prototype.hasOwnProperty.call(VERDICT_TONE, verdict.tone)
      ? verdict.tone
      : "neutral";
    banner.className = "r-banner " + VERDICT_TONE[tone];
    byId("ref-verdict-icon").textContent = VERDICT_ICON[tone];
    byId("ref-verdict-headline").textContent = verdict.headline || "";
    byId("ref-verdict-detail").textContent = verdict.detail ? " " + verdict.detail : "";
    var notes = byId("ref-verdict-notes");
    clear(notes);
    (verdict.notes || []).forEach(function (note) {
      notes.appendChild(el("span", "ref-verdict-note", note));
    });
    banner.hidden = false;
  }

  function alertRefRow(a) {
    var tr = el("tr");
    tr.appendChild(timeCell(a.at));
    tr.appendChild(textCell(a.useCase));
    tr.appendChild(textCell(a.failedNode, "r-mono"));
    tr.appendChild(textCell(a.errorMessage, "error-cell"));
    var cell = el("td");
    cell.appendChild(durableBadge(a.auditDurable));
    tr.appendChild(cell);
    return tr;
  }

  // -- ops alerts ------------------------------------------------------------

  function loadAlerts() {
    api("api/alerts")
      .then(unwrap)
      .then(function (payload) {
        if (!payload) return;
        clearError();
        hideAccessGate();
        renderMode(payload.mode);
        var rows = byId("alerts-rows");
        clear(rows);
        payload.alerts.forEach(function (a) {
          var tr = el("tr");
          tr.appendChild(timeCell(a.at));
          tr.appendChild(textCell(a.useCase));
          tr.appendChild(textCell(a.workflowName));
          tr.appendChild(textCell(a.failedNode, "r-mono"));
          tr.appendChild(textCell(a.errorMessage, "error-cell"));
          var durable = el("td");
          durable.appendChild(durableBadge(a.auditDurable));
          tr.appendChild(durable);
          var exec = el("td");
          if (a.executionUrl) {
            var link = el("a", "r-mono", a.executionId || "open");
            link.href = a.executionUrl;
            link.target = "_blank";
            link.rel = "noreferrer noopener";
            exec.appendChild(link);
          } else {
            exec.appendChild(el("span", "r-none", a.executionId || "—"));
          }
          tr.appendChild(exec);
          rows.appendChild(tr);
        });
        byId("alerts-empty").hidden = payload.alerts.length > 0;
      })
      .catch(swallowHandled);
  }

  // -- boot ------------------------------------------------------------------

  var booted = false;

  function boot() {
    api("api/meta")
      .then(unwrap)
      .then(function (payload) {
        if (!payload) return;
        booted = true;
        hideAccessGate();
        renderMode(payload.mode);
        reloadFeed();
        if (pollTimer) clearInterval(pollTimer);
        pollTimer = setInterval(pollFeed, POLL_MS);
      })
      .catch(swallowHandled);
  }

  function wire() {
    TABS.forEach(function (tab) {
      byId("nav-" + tab).addEventListener("click", function () {
        activateTab(tab);
      });
    });

    byId("live-toggle").addEventListener("click", function () {
      setLive(!liveWanted);
      if (tailRunning()) pollFeed(); // catch up immediately on resume
    });

    // Paging is a push/pop over the server's cursors — never an offset, and
    // never a cursor this file assembled itself.
    byId("page-older").addEventListener("click", function () {
      if (!nextCursor) return;
      cursorStack.push(nextCursor);
      loadPage();
    });
    byId("page-newer").addEventListener("click", function () {
      if (!cursorStack.length) return;
      cursorStack.pop();
      loadPage();
      // Back on the newest page the tail resumes on its own (tailRunning()
      // reads the stack), and the next poll fills in whatever landed meanwhile.
    });
    byId("page-size").addEventListener("change", reloadFeed);

    // The escape hatch from an empty feed search — see renderFeedEmptyState.
    byId("feed-trace-q").addEventListener("click", function () {
      var q = byId("filter-q").value.trim();
      if (q) traceRef(q);
    });

    ["filter-usecase", "filter-action"].forEach(function (id) {
      byId(id).addEventListener("change", reloadFeed);
    });
    var qTimer = null;
    byId("filter-q").addEventListener("input", function () {
      if (qTimer) clearTimeout(qTimer);
      qTimer = setTimeout(reloadFeed, 250);
    });

    byId("drill-close").addEventListener("click", function () {
      byId("drill").hidden = true;
    });

    byId("ref-form").addEventListener("submit", function (event) {
      event.preventDefault();
      var ref = byId("ref-input").value.trim();
      if (ref) lookupIdentifier(ref);
    });

    byId("access-form").addEventListener("submit", function (event) {
      event.preventDefault();
      var value = byId("access-key").value.trim();
      if (!value) return;
      rememberKey(value);
      byId("access-key").value = "";
      hideAccessGate();
      // Already booted: everything is wired and the key was all that was
      // missing — re-booting would attach a second poll loop.
      if (!booted) boot();
      else reloadFeed();
    });
  }

  wire();
  boot();
})();
