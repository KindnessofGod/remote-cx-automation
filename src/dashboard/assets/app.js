/* ---------------------------------------------------------------------------
 * app.js  —  Unified dashboard front end
 * ---------------------------------------------------------------------------
 * Plain browser JS, no build step, no framework — matches src/playground/
 * assets/app.js and zaf-app/assets/main.js's convention.
 *
 * This file DECIDES NOTHING and RE-DERIVES NOTHING. It fetches each use
 * case's own real list endpoint directly from the browser (every one of the
 * nine servers already answers with Access-Control-Allow-Origin: *) and
 * renders the rows it gets back verbatim, in a table, with textContent only
 * — never innerHTML, because ticket/request text in these rows is untrusted
 * input. There is no second copy of any decision or approval rule here: a
 * "decision" cell shows the exact string the API returned, badge-styled only
 * when it matches one of the three tier outcomes this repo defines
 * (auto_resolve / human_review / escalate, plus a small set of named
 * synonyms each use case actually returns — see SOURCES below); anything
 * else renders as plain text rather than guessing what color it should be.
 *
 * The same discipline now covers the STATUS column: STATUS_TONE below is the
 * one place a lifecycle status becomes a colour, every key in it is cited to
 * the store that writes it, and a status it does not name renders with the
 * neutral dot and its raw string rather than a tone it might not deserve.
 * ------------------------------------------------------------------------- */

(function () {
  "use strict";

  // -- section catalogue ----------------------------------------------------
  // Ports match package.json's npm run scripts exactly (see CLAUDE.md §2).
  // Column `field` values are the exact property names each store's
  // list()/listByUseCase() method returns (verified against
  // src/review/store.js, src/uc0N/*Store.js).

  var SOURCES = [
    {
      id: "uc01",
      tier: "🟢",
      tierLabel: "Low",
      title: "UC-01 — Employment Verification",
      port: 4020,
      path: "/api/review/tickets",
      key: "tickets",
      runCmd: "npm run review-api",
      sub: "Auto-resolve / human review queue. Every case with a review_queue row (auto_resolve cases never get one).",
      columns: [
        { header: "Ticket", field: "externalRef" },
        { header: "Decision", field: "decision", type: "decision" },
        { header: "Status", field: "status", type: "status" },
        { header: "Review", field: "reviewStatus", type: "status" },
        { header: "Employment", field: "employmentId" },
        { header: "Requester", field: "requester" },
        { header: "Reason", field: "reason" },
        { header: "Created", field: "createdAt", type: "time" },
      ],
    },
    {
      id: "uc02",
      tier: "🟢",
      tierLabel: "Low",
      title: "UC-02 — Expense & Receipt Validation",
      port: 4050,
      path: "/api/expenses",
      key: "expenses",
      runCmd: "npm run uc02-api",
      sub: "12 deterministic gates; the one write (PATCH .../expenses/:id) is audited before it fires.",
      columns: [
        { header: "Expense", field: "expenseId" },
        { header: "Decision", field: "decision", type: "decision" },
        { header: "Status", field: "status", type: "status" },
        { header: "Employment", field: "employmentId" },
        { header: "Category", field: "categoryId" },
        { header: "Reason", field: "reason" },
        { header: "Created", field: "createdAt", type: "time" },
      ],
    },
    {
      id: "uc03",
      tier: "🟢",
      tierLabel: "Low",
      title: "UC-03 — Travel Support Letter Router",
      port: 4051,
      path: "/api/cases",
      key: "cases",
      runCmd: "npm run uc03-api",
      sub: "Thin router only — auto_resolve / human_review / escalate / route_to_uc04.",
      columns: [
        { header: "Ticket", field: "externalRef" },
        { header: "Decision", field: "decision", type: "decision" },
        { header: "Status", field: "status", type: "status" },
        { header: "Employment", field: "employmentId" },
        { header: "Requester", field: "requester" },
        { header: "Reason", field: "reason" },
        { header: "Created", field: "createdAt", type: "time" },
      ],
    },
    {
      id: "uc04",
      tier: "🟡",
      tierLabel: "Medium",
      title: "UC-04 — Work Authorization (Workation)",
      port: 4052,
      path: "/api/authorizations",
      key: "authorizations",
      runCmd: "npm run uc04-api",
      sub: "Origin→destination risk matrix; single mobility-specialist approval.",
      columns: [
        { header: "Authorization", field: "id", type: "shortid" },
        { header: "Decision", field: "decision", type: "decision" },
        { header: "Status", field: "status", type: "status" },
        { header: "Employment", field: "employmentId" },
        { header: "Trip days", field: "tripDays" },
        { header: "Cumulative days", field: "cumulativeDays" },
        { header: "Reason", field: "reason" },
        { header: "Created", field: "createdAt", type: "time" },
      ],
    },
    {
      id: "uc05",
      tier: "🟡",
      tierLabel: "Medium",
      title: "UC-05 — Resignation Notice Calculation",
      port: 4053,
      path: "/api/resignations",
      key: "resignations",
      runCmd: "npm run uc05-api",
      sub: "Statutory notice + PTO payout reconciliation; single HR Ops sign-off. No write endpoint exists — the signed-off report IS the artifact.",
      columns: [
        { header: "Resignation", field: "id", type: "shortid" },
        { header: "Decision", field: "decision", type: "decision" },
        { header: "Status", field: "status", type: "status" },
        { header: "Employment", field: "employmentId" },
        { header: "Notice", field: "notice" },
        { header: "Reason", field: "reason" },
        { header: "Created", field: "createdAt", type: "time" },
      ],
    },
    {
      id: "uc06",
      tier: "🟡",
      tierLabel: "Medium",
      title: "UC-06 — Contract Amendment / Payroll Cutoff",
      port: 4021,
      path: "/api/amendments",
      key: "amendments",
      runCmd: "npm run uc06-api",
      sub: "Dual approval (Customer Admin + Payroll Specialist) before the real write fires.",
      columns: [
        { header: "Amendment", field: "id", type: "shortid" },
        { header: "Decision", field: "decision", type: "decision" },
        { header: "Status", field: "status", type: "status" },
        { header: "Employment", field: "employmentId" },
        { header: "Type", field: "amendmentType" },
        { header: "Reason", field: "reason" },
        { header: "Created", field: "createdAt", type: "time" },
      ],
    },
    {
      id: "uc07",
      tier: "🔴",
      tierLabel: "High",
      title: "UC-07 — Global Mobility / Permanent Relocation",
      port: 4054,
      path: "/api/dossiers",
      key: "dossiers",
      runCmd: "npm run uc07-api",
      sub: "No execution path exists — read-only feasibility dossiers for a Mobility Legal specialist. No decision/status column: there is none to show.",
      columns: [
        { header: "Dossier", field: "id", type: "shortid" },
        { header: "Employment", field: "employmentId" },
        { header: "Relocation type", field: "relocationType" },
        { header: "From", field: "sourceCountry" },
        { header: "To", field: "destinationCountry" },
        { header: "Created", field: "createdAt", type: "time" },
      ],
    },
    {
      id: "uc08",
      tier: "🔴",
      tierLabel: "High",
      title: "UC-08 — Cross-Border Tax & Social Security",
      port: 4023,
      path: "/api/dossiers",
      key: "dossiers",
      runCmd: "npm run uc08-api",
      sub: "No execution path exists — read-only tax dossiers, embedding-similarity treaty citations. No decision/status column: there is none to show.",
      columns: [
        { header: "Dossier", field: "id", type: "shortid" },
        { header: "Employment", field: "employmentId" },
        { header: "Inquiry type", field: "inquiryType" },
        { header: "Jurisdictions", field: "jurisdictions" },
        { header: "Presence days", field: "presenceDays" },
        { header: "Created", field: "createdAt", type: "time" },
      ],
    },
    {
      id: "uc09",
      tier: "🔴",
      tierLabel: "High (with execution)",
      title: "UC-09 — Off-Cycle Payroll / Adjustment",
      port: 4055,
      path: "/api/adjustments",
      key: "adjustments",
      runCmd: "npm run uc09-api",
      sub: "The one ‘high-tier-framed’ use case WITH a real write — floor-of-2 multi-role approval, never fewer regardless of risk score.",
      columns: [
        { header: "Adjustment", field: "id", type: "shortid" },
        { header: "Decision", field: "decision", type: "decision" },
        { header: "Status", field: "status", type: "status" },
        { header: "Employment", field: "employmentId" },
        { header: "Type", field: "adjustmentType" },
        { header: "Reason", field: "reason" },
        { header: "Created", field: "createdAt", type: "time" },
      ],
    },
  ];

  // Decision strings this repo actually returns, styled with the shared
  // tier palette. Never invented — see style.css's .decision-* rules.
  var KNOWN_DECISIONS = {
    auto_resolve: true,
    auto_approve: true,
    human_review: true,
    dual_approval_required: true,
    ready_for_approval: true,
    prepared_for_signoff: true,
    escalate: true,
    blocked: true,
  };

  /* -------------------------------------------------------------------------
   * STATUS_TONE — the ONE place a lifecycle status string becomes a colour.
   *
   * A status is not a decision. The decision column keeps the validated
   * --r-decision-* palette; a status is LIFECYCLE STATE, which Remote renders
   * as a coloured dot beside the plain word (.r-status in the shared design
   * system) rather than as a filled pill.
   *
   * Every key below is a status string one of the nine stores actually writes,
   * cited to the file that writes it — so this is a lookup of known vocabulary,
   * not a guess about what a word might mean. A status this table does not
   * name renders with the neutral `.r-status-idle` dot and its RAW string,
   * exactly the rule decisionBadge() already follows for an unrecognised
   * decision: no colour is better than a colour the value might not deserve.
   *
   * The WORD is always rendered either way, so the dot is a redundant cue and
   * never the carrier of the meaning.
   * ---------------------------------------------------------------------- */
  var STATUS_TONE = {
    // Settled — the request reached an end state and nothing is owed.
    resolved: "ok", // uc01/workflow.js, uc03/workflow.js
    approved: "ok", // review_queue (shared/caseStore.js, review/reviewPolicy.js)
    auto_approved: "ok", // uc02/expenseStore.js statusFor()
    signed_off: "ok", // uc05/resignationStore.js
    executed: "ok", // uc04/uc06/uc09 stores, set only after the real write returned

    // Waiting on a named human — the 🟡 gate doing its job, not a fault.
    pending: "warn", // review_queue's initial status (shared/caseStore.js)
    flagged: "warn", // uc02/expenseStore.js statusFor()
    routed: "warn", // uc03/workflow.js — handed to UC-04, still owed an answer

    // Stopped, refused, or handed out of the automation entirely.
    blocked: "danger", // uc02/expenseStore.js, uc04/authorizationStore.js
    escalated: "danger", // every store's non-actionable branch
    rejected: "danger", // review_queue after a decline (review/reviewPolicy.js)
    // BOTH SPELLINGS, permanently. The verb moved `denied` -> `declined` on
    // 2026-08-19 for UC-01/04/05/06; UC-09 still writes `denied`, and a row
    // written before the rename still reads back as `denied` from any store
    // whose canonicalisation this page bypasses.
    declined: "danger", // uc01 case status + uc04/uc05/uc06 stores
    denied: "danger", // pre-2026-08-19 spelling, and UC-09's current one
  };

  // Prefix rules, tried only after an exact match fails. Each store spells its
  // own waiting state differently — pending_review, pending_signoff,
  // pending_dual_approval, pending_specialist_approval, pending_approval — and
  // they all mean the same thing: a human has it and nothing has moved.
  var STATUS_TONE_PREFIXES = [
    { prefix: "pending_", tone: "warn" },
    { prefix: "awaiting_", tone: "warn" },
  ];

  var POLL_MS = 8000;

  // -- tiny DOM helpers (same idiom as playground/app.js) --------------------

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  /** Nothing to show. Remote prints an em dash rather than leaving a cell blank,
   *  so "no value" is visibly rendered instead of ambiguously unrendered. */
  function isEmpty(v) {
    return v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0);
  }

  function noneCell() {
    return el("span", "r-none", "—");
  }

  /** Renders any value honestly — never guesses meaning for shapes it doesn't recognize. */
  function fmtValue(v) {
    if (Array.isArray(v)) return v.join(", ");
    if (typeof v === "object") {
      try {
        var s = JSON.stringify(v);
        return s.length > 90 ? s.slice(0, 87) + "…" : s;
      } catch (e) {
        return "(unserializable)";
      }
    }
    return String(v);
  }

  /* -------------------------------------------------------------------------
   * SHAPES — the named object shapes three columns actually carry.
   *
   * Three columns hold objects, and fmtValue()'s honest fallback for an object
   * is to JSON.stringify it. That is the right default for a shape nobody has
   * described, but it was landing in the rendered page: UC-04's "Cumulative
   * days" printed `{"days":0,"periodsCounted":0}`, UC-05's "Notice" printed a
   * 400-character statutory record truncated mid-key, and UC-08's "Presence
   * days" the same. A raw JSON blob in a table cell is not transparency — the
   * numbers are all present and none of them are readable.
   *
   * These are NOT guesses. Each entry names a shape one of the nine stores
   * writes, is cited to the file that writes it, and prints only fields that
   * shape really has. A column without an entry keeps the JSON fallback, and a
   * value that does not match the expected shape falls back too — so an API
   * that changes shape shows something odd rather than something wrong.
   * ---------------------------------------------------------------------- */
  var SHAPES = {
    // src/uc04/authorizationStore.js — {days, periodsCounted}
    cumulativeDays: function (v) {
      if (typeof v.days !== "number") return null;
      return v.days + (v.days === 1 ? " day" : " days") + " · " + v.periodsCounted + " trip(s)";
    },
    // src/uc08/dossierStore.js — {days, periodsCounted, status, problems[]}
    presenceDays: function (v) {
      if (typeof v.days !== "number") return null;
      var text = v.days + (v.days === 1 ? " day" : " days") + " · " + v.periodsCounted + " period(s)";
      // A counted-with-problems period is exactly the thing a tax specialist
      // must not miss, so it is said rather than dropped.
      if (v.problems && v.problems.length) text += " · " + v.problems.length + " problem(s)";
      return text;
    },
    // src/uc05/resignationStore.js — the statutory notice record. The two
    // fields an HR Ops reviewer scans a list for are how long the notice is and
    // whether the proposed date disagrees with it; the rest is in the sidebar.
    notice: function (v) {
      if (typeof v.noticeDays !== "number") return null;
      var text = v.noticeDays + " days → " + (v.noticeEndDate || "?");
      if (v.discrepancy && v.discrepancy !== "match") text += " · " + v.discrepancy;
      return text;
    },
  };

  function fmtShape(field, value) {
    var shape = SHAPES[field];
    if (!shape || typeof value !== "object" || Array.isArray(value)) return null;
    try {
      return shape(value);
    } catch (e) {
      return null; // malformed — fall through to the honest JSON fallback
    }
  }

  function fmtTime(v) {
    var d = new Date(v);
    return isNaN(d.getTime()) ? String(v) : d.toLocaleString();
  }

  function fmtShortId(v) {
    if (typeof v !== "string") return fmtValue(v);
    return v.length > 8 ? v.slice(0, 8) + "…" : v;
  }

  function decisionBadge(value) {
    if (isEmpty(value)) return noneCell();
    var known = Object.prototype.hasOwnProperty.call(KNOWN_DECISIONS, value);
    return el("span", "badge " + (known ? "decision-" + value : "generic"), String(value));
  }

  /** The tone for a status string, or null when this repo hasn't named it. */
  function statusTone(value) {
    var key = String(value).toLowerCase();
    if (Object.prototype.hasOwnProperty.call(STATUS_TONE, key)) return STATUS_TONE[key];
    for (var i = 0; i < STATUS_TONE_PREFIXES.length; i += 1) {
      if (key.indexOf(STATUS_TONE_PREFIXES[i].prefix) === 0) return STATUS_TONE_PREFIXES[i].tone;
    }
    return null; // unrecognised — rendered idle, with its raw word, never guessed
  }

  function statusCell(value) {
    if (isEmpty(value)) return noneCell();
    var tone = statusTone(value);
    return el("span", "r-status r-status-" + (tone || "idle"), String(value));
  }

  function renderCell(column, row) {
    var value = row[column.field];
    if (column.type === "decision") return decisionBadge(value);
    if (column.type === "status") return statusCell(value);
    if (isEmpty(value)) return noneCell();
    if (column.type === "time") return document.createTextNode(fmtTime(value));
    if (column.type === "shortid") return document.createTextNode(fmtShortId(value));
    var shaped = fmtShape(column.field, value);
    if (shaped !== null) return document.createTextNode(shaped);
    return document.createTextNode(fmtValue(value));
  }

  // -- summary bar -------------------------------------------------------------

  var summaryChips = {};

  function buildSummaryBar() {
    var bar = document.getElementById("summary-bar");
    SOURCES.forEach(function (source) {
      // An anchor, not a span: the sidebar doubles as navigation to the
      // section it reports on. `buildSection` gives each section the matching
      // id. Still status-first — the dot and label are unchanged.
      var chip = el("a", "summary-chip");
      chip.href = "#" + source.id;
      var dot = el("span", "dot");
      chip.appendChild(dot);
      var label = el("span", null, source.id.toUpperCase() + " — checking…");
      chip.appendChild(label);
      bar.appendChild(chip);
      summaryChips[source.id] = { chip: chip, dot: dot, label: label };
    });
  }

  function updateSummaryChip(source, ok, count) {
    var ref = summaryChips[source.id];
    if (!ref) return;
    ref.chip.className = "summary-chip " + (ok ? "up" : "down");
    ref.label.textContent = source.id.toUpperCase() + (ok ? " — " + count + (count === 1 ? " row" : " rows") : " — unreachable");
  }

  // -- section construction ---------------------------------------------------

  function buildSection(source) {
    var section = el("section", "card");
    section.id = source.id; // the sidebar links here
    // Nine <section>s with no accessible name are nine anonymous landmarks.
    section.setAttribute("aria-labelledby", source.id + "-heading");

    var head = el("div", "section-head");
    var titleWrap = el("div", "section-title");
    // The tier glyph is decorative and MUST NOT be the only carrier: a screen
    // reader announces "🟢" as "green circle", which says nothing about risk,
    // and a red/green pair is the classic thing a colour-blind reader cannot
    // separate. `tierLabel` was already on every SOURCES entry and was being
    // rendered nowhere — the word is now printed beside the glyph, matching
    // how `.r-tier` works everywhere else in the design system.
    var tierGlyph = el("span", "tier", source.tier);
    tierGlyph.setAttribute("aria-hidden", "true");
    titleWrap.appendChild(tierGlyph);
    var heading = el("h2", null, source.title);
    heading.id = source.id + "-heading";
    titleWrap.appendChild(heading);
    titleWrap.appendChild(el("span", "tier-word", source.tierLabel + " risk"));
    head.appendChild(titleWrap);

    var refreshBtn = el("button", "refresh-btn", "Refresh");
    refreshBtn.type = "button";
    // Nine identical "Refresh" buttons on one page is nine identical entries in
    // a screen reader's control list. The visible label stays short; the
    // accessible name says which section it refreshes.
    refreshBtn.setAttribute("aria-label", "Refresh " + source.title);
    head.appendChild(refreshBtn);
    section.appendChild(head);

    section.appendChild(el("p", "section-sub", source.sub));
    section.appendChild(
      el("p", "source-link", "GET http://localhost:" + source.port + source.path)
    );

    var tableScroll = el("div", "table-scroll hidden");
    var table = document.createElement("table");
    var thead = document.createElement("thead");
    var headRow = document.createElement("tr");
    source.columns.forEach(function (col) {
      var th = el("th", null, col.header);
      // Without scope, a screen reader has to guess which cells a header
      // governs — and on a nine-column table it usually guesses wrong.
      th.setAttribute("scope", "col");
      headRow.appendChild(th);
    });
    thead.appendChild(headRow);
    table.appendChild(thead);
    var tbody = document.createElement("tbody");
    table.appendChild(tbody);
    tableScroll.appendChild(table);
    section.appendChild(tableScroll);

    var empty = el("p", "muted small hidden", "No rows yet.");
    section.appendChild(empty);

    // The footer Remote closes a list view with: what you are looking at on the
    // left, how fresh it is on the right. This line used to sit ABOVE the table;
    // below reads better, because it describes what was just rendered rather
    // than what is still loading — and it is where a reader looks for a count.
    var foot = el("div", "r-pagination section-foot");
    var status = el("span", "status-line", "Loading…");
    // This line is the ONLY place an unreachable API is reported, and the page
    // repaints it on an 8s poll with no other visual event. Without a live
    // region a screen-reader user is never told a section went down.
    // `polite`, not `assertive`: nine of these must not interrupt each other.
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    var updated = el("span", "updated-line", "");
    foot.appendChild(status);
    foot.appendChild(updated);
    section.appendChild(foot);

    var refs = {
      section: section,
      status: status,
      updated: updated,
      tableScroll: tableScroll,
      tbody: tbody,
      empty: empty,
    };

    refreshBtn.addEventListener("click", function () {
      loadSection(source, refs);
    });

    return refs;
  }

  // -- data loading -------------------------------------------------------------

  function loadSection(source, refs) {
    refs.status.className = "status-line";
    refs.status.textContent = "Loading…";
    refs.updated.textContent = "";

    fetch("http://localhost:" + source.port + source.path)
      .then(function (res) {
        if (!res.ok) throw new Error("HTTP " + res.status);
        return res.json();
      })
      .then(function (data) {
        var rows = Array.isArray(data[source.key]) ? data[source.key] : [];
        renderRows(source, refs, rows);
        refs.status.className = "status-line ok";
        refs.status.textContent = rows.length + (rows.length === 1 ? " row" : " rows");
        refs.updated.textContent = "updated " + new Date().toLocaleTimeString();
        updateSummaryChip(source, true, rows.length);
      })
      .catch(function (err) {
        clear(refs.tbody);
        refs.tableScroll.classList.add("hidden");
        refs.empty.classList.add("hidden");
        refs.status.className = "status-line bad";
        refs.status.textContent =
          "Could not reach " + source.title + " on port " + source.port + " (" + err.message + ") — is it running? Try: " + source.runCmd;
        refs.updated.textContent = "";
        updateSummaryChip(source, false, 0);
      });
  }

  /* Is this table wider than the space it has? Only then does the scroller get
     the fade mask and become keyboard-reachable — a table that fits must not be
     given a phantom clipped edge or an empty tab stop. */
  function markClipping(source, refs) {
    var box = refs.tableScroll;
    var clipped = box.scrollWidth > box.clientWidth + 1;
    box.classList.toggle("is-clipped", clipped);
    if (clipped) {
      box.setAttribute("tabindex", "0");
      box.setAttribute("role", "region");
      box.setAttribute("aria-label", source.title + " table — scrolls horizontally");
    } else {
      box.removeAttribute("tabindex");
      box.removeAttribute("role");
      box.removeAttribute("aria-label");
    }
  }

  function renderRows(source, refs, rows) {
    clear(refs.tbody);

    if (!rows.length) {
      refs.tableScroll.classList.add("hidden");
      refs.empty.classList.remove("hidden");
      return;
    }
    refs.tableScroll.classList.remove("hidden");
    refs.empty.classList.add("hidden");

    rows.forEach(function (row) {
      var tr = document.createElement("tr");
      source.columns.forEach(function (col) {
        var td = document.createElement("td");
        td.appendChild(renderCell(col, row));
        tr.appendChild(td);
      });
      refs.tbody.appendChild(tr);
    });

    markClipping(source, refs);
  }

  function loadAll(sectionRefs) {
    SOURCES.forEach(function (source) {
      loadSection(source, sectionRefs[source.id]);
    });
  }

  // -- boot -----------------------------------------------------------------------

  /* What each tier MEANS, once, rather than nine glyphs the reader has to
     already understand. The tier is the execution path in this architecture
     (CLAUDE.md §3 prime directive 2), so the legend states the consequence, not
     just the colour. Text only — nothing here is derived from the data. */
  var TIER_LEGEND = [
    ["low", "🟢", "Low", "auto-executes, exception-gated"],
    ["medium", "🟡", "Medium", "a named human approves before any write"],
    ["high", "🔴", "High", "no execution path exists — escalation only"],
  ];

  function buildTierLegend() {
    var legend = el("div", "tier-legend");
    legend.setAttribute("aria-label", "What each risk tier means");
    TIER_LEGEND.forEach(function (entry) {
      var item = el("div", "tier-legend-item tier-legend-" + entry[0]);
      // The glyph alone, not a glyph AND a CSS dot: the section headings below
      // already identify a tier by its emoji, and this legend exists to explain
      // those headings. A second, differently-shaded dot beside each one made
      // the legend disagree with the thing it was a legend for. The tier WORD
      // and its consequence are what carry the meaning either way.
      item.appendChild(el("b", null, entry[1] + " " + entry[2]));
      item.appendChild(el("span", null, entry[3]));
      legend.appendChild(item);
    });
    return legend;
  }

  document.addEventListener("DOMContentLoaded", function () {
    buildSummaryBar();

    var intro = document.getElementById("intro");
    if (intro) intro.appendChild(buildTierLegend());

    var container = document.getElementById("sections");
    var sectionRefs = {};
    SOURCES.forEach(function (source) {
      var refs = buildSection(source);
      container.appendChild(refs.section);
      sectionRefs[source.id] = refs;
    });

    loadAll(sectionRefs);
    setInterval(function () {
      loadAll(sectionRefs);
    }, POLL_MS);

    // A viewport change can turn a fitting table into a clipped one and back.
    window.addEventListener("resize", function () {
      SOURCES.forEach(function (source) {
        markClipping(source, sectionRefs[source.id]);
      });
    });
  });
})();
