// ---------------------------------------------------------------------------
// app.js  —  UC-06 Remote UI stand-in client (plain JS, no build step)
// ---------------------------------------------------------------------------
// This page is three forms in front of real, role-gated endpoints. It posts a
// Remote-native event-shaped body to /api/submit (company admin) or /api/consent
// (employee/employer) and renders whatever the real UC-06 gates + the real
// authorization policy returned. It decides nothing — the decision, the flags,
// the summary, the tags, whether an amendment is open to approval, and whether
// a submission was within its role all come from the API response verbatim.
// The role is the session it logs in as (sent as a header, never invented in
// the body), and the server is the only place authorization is decided.
// All dynamic values are written with textContent, never innerHTML, because
// the content originates in a support flow (untrusted).
// ---------------------------------------------------------------------------

(function () {
  "use strict";

  var DECISION_LABELS = {
    dual_approval_required: "Awaiting dual approval",
    escalate: "Escalated",
  };

  // -- server string -> tone: the ONE place this surface maps one -------------
  //
  // Two different kinds of string come back from the server, and they get two
  // different components on purpose:
  //
  //   * a DECISION (`dual_approval_required` / `escalate`) keeps the local
  //     `.badge.decision-*` rules, which paint the ALREADY-VALIDATED
  //     auto/human/escalate palette. Those three colours mean the same three
  //     things on every surface in this project, so an escalation must not be
  //     re-tinted "danger" here just because it is a stop.
  //   * a LIFECYCLE STATE gets the shared `.r-status` — a coloured dot beside
  //     the plain word, which is how Remote renders state.
  //
  // The table below is the state half, and it is presentation only: it picks a
  // dot colour and a readable label for a state the server already decided. It
  // never invents, overrides or recomputes one. Anything unrecognised gets the
  // neutral `idle` dot and keeps its RAW string — never a guessed tone.
  var STATE_TONES = {
    // consented — the party signed off; the ZAF sidebar's dual approval is
    // still the gate that lets anything execute.
    consent_recorded: { tone: "r-status-ok", label: "Consent recorded" },

    // The amendment lifecycle, as src/remoteui/amendmentStatus.js reports it.
    // Presentation only: a dot colour and a readable word for a state the
    // server has already decided. THE WORD CARRIES THE MEANING — remove every
    // colour here and the card still says which of these it is, in the label
    // beside it and in the sentence below.
    awaiting_approval: { tone: "r-status-warn", label: "Awaiting dual approval" },
    // Deliberately NOT `ok`: both approvals are in and the write is in flight,
    // which is not the same as the contract having changed.
    applying: { tone: "r-status-info", label: "Being applied" },
    executed: { tone: "r-status-ok", label: "Applied" },
    denied: { tone: "r-status-danger", label: "Denied" },
    escalated: { tone: "r-status-idle", label: "Escalated" },
    unknown: { tone: "r-status-idle", label: "Unknown" },
  };

  function statusEl(state) {
    var known = STATE_TONES[state];
    return el(
      "span",
      { class: "r-status " + (known ? known.tone : "r-status-idle") },
      [known ? known.label : String(state)]
    );
  }

  // Which server-owned demo session is "logged in". The server maps each key
  // to an authenticated identity and authorizes against it; the browser never
  // claims a role in the request body.
  var ACTIVE_SESSION = "admin";
  var SESSION_HEADER = "X-RemoteUi-Session";

  var employees = [];
  var employeeById = {};
  var scenarioNow = null;

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    for (var key in attrs || {}) node.setAttribute(key, attrs[key]);
    (children || []).forEach(function (child) {
      node.appendChild(typeof child === "string" ? document.createTextNode(child) : child);
    });
    return node;
  }

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  function byId(id) {
    return document.getElementById(id);
  }

  function setField(id, value) {
    byId(id).value = value === null || value === undefined ? "" : value;
  }

  // A SPAN IS NOT A FORM CONTROL, and `setField` on one is silently a no-op
  // that still "works". `#salary-currency` is a <span>: assigning `.value` to
  // it creates an expando property nobody can see, so the currency never
  // appeared beside the salary boxes, while `byId("salary-currency").value`
  // still read the expando back and looked correct. Text goes in as text.
  function setText(id, value) {
    byId(id).textContent = value === null || value === undefined ? "" : String(value);
  }

  // THE AUTHORITATIVE CURRENCY OF THE SELECTED CONTRACT, read from the
  // employment record and never typed by anyone. It is deliberately a variable
  // rather than a field: there is no currency INPUT on this form, because a
  // contract's currency is not something a demo user gets to choose, and the
  // one thing that must never happen is a salary amendment that silently
  // redenominates a contract. Null means "the record did not tell us", and a
  // null currency is submitted as null so the gates refuse — see buildChanges.
  var currentCurrency = null;

  function num(value) {
    var n = Number(value);
    return Number.isFinite(n) ? n : NaN;
  }

  // -- role switching ----------------------------------------------------------

  var ROLE_KEYS = ["admin", "employer", "employee"];

  function activateRole(role) {
    ACTIVE_SESSION = role;
    ROLE_KEYS.forEach(function (key) {
      var tab = byId("tab-" + key);
      tab.classList.toggle("active", key === role);
      // Roving tabindex. `role="tab"` is a PROMISE that the strip behaves like
      // a tablist: one stop in the tab order, arrows to move between tabs.
      // Leaving all three focusable made the markup claim a pattern it did not
      // implement, which is worse than plain buttons — a screen-reader user is
      // told to press an arrow key and nothing happens.
      tab.tabIndex = key === role ? 0 : -1;
      // Presentation only, and additive: the tab strip is now the shared
      // `.r-tabs`, which is a tablist, so the selected state has to be
      // announced as well as painted. The switching itself is unchanged, and
      // this is still only a view switch — the server decides authorization
      // from the session header, never from anything the page claims.
      tab.setAttribute("aria-selected", key === role ? "true" : "false");
      byId("path-" + key).style.display = key === role ? "" : "none";
    });
  }

  // -- employees (admin path only) ---------------------------------------------

  function loadEmployees() {
    fetch("/api/employees")
      .then(function (res) { return res.json(); })
      .then(function (data) {
        employees = data.employees || [];
        var select = byId("employee-select");
        clear(select);
        employees.forEach(function (emp) {
          employeeById[emp.id] = emp;
          select.appendChild(el("option", { value: emp.id }, [emp.name + " (" + emp.id + ")"]));
        });
        if (employees.length) renderCurrent(employees[0]);
      })
      .catch(function (err) {
        byId("current-employment").textContent = "Could not load employees: " + err.message;
      });
  }

  function currentFor() {
    var id = byId("employee-select").value;
    var emp = employeeById[id];
    return (emp && emp.current) || null;
  }

  function renderCurrent(emp) {
    var box = byId("current-employment");
    clear(box);
    if (!emp) {
      box.textContent = "No employee selected.";
      return;
    }
    var c = emp.current;
    if (!c) {
      box.textContent = emp.name + " — current contract values unavailable (Remote read failed).";
      return;
    }
    var parts = [
      emp.name + " · status " + c.status,
      // `c.currency` is null whenever the record did not state one — appending
      // it unguarded rendered the string "50,000.00 null" on the one line a
      // reviewer reads to sanity-check the contract they are about to amend.
      c.salary
        ? c.salary.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) +
          (c.currency ? " " + c.currency : " (currency unknown)")
        : "salary n/a",
      c.jobTitle || "title n/a",
      c.weeklyHours ? c.weeklyHours + " h/wk" : "hours n/a",
    ];
    box.appendChild(el("div", {}, [parts.join(" — ")]));
  }

  function prefillOldValues() {
    var c = currentFor();
    if (!c) {
      currentCurrency = null;
      setText("salary-currency", "");
      return;
    }
    if (typeof c.salary === "number") setField("salary-old", c.salary);
    currentCurrency = c.currency || null;
    setText("salary-currency", currentCurrency || "currency unknown");
    setField("title-old", c.jobTitle || "");
    if (typeof c.weeklyHours === "number") setField("hours-old", c.weeklyHours);
  }

  function onEmployeeChange() {
    renderCurrent(employeeById[byId("employee-select").value]);
    prefillOldValues();
    ["salary-new", "title-new", "hours-new"].forEach(function (id) { setField(id, ""); });
  }

  // -- change-type field visibility ---------------------------------------------

  var CHANGE_FIELDS = { salary: "field-salary", jobTitle: "field-jobTitle", weeklyHours: "field-weeklyHours" };

  function onChangeType() {
    var type = byId("change-type").value;
    Object.keys(CHANGE_FIELDS).forEach(function (key) {
      byId(CHANGE_FIELDS[key]).style.display = key === type || type === "composite" ? "" : "none";
    });
    prefillOldValues();
  }

  // -- scenario quick-fills (fixed against the mock payroll calendar) --------------

  function fillScenario(opts) {
    setField("employee-select", opts.employeeId);
    onEmployeeChange();
    setField("change-type", opts.changeType);
    onChangeType();
    if (opts.values) {
      Object.keys(opts.values).forEach(function (key) {
        var id = opts.valueFields[key];
        if (id) setField(id, opts.values[key]);
      });
    }
    setField("effective-date", opts.effectiveDate);
    scenarioNow = opts.now;
    byId("reason-text").value = opts.reason || "";
  }

  // Every scenario below is pinned against the mock NL payroll calendar
  // (run_nl_2026_06 cutoff 2026-06-10, run_nl_2026_07 cutoff 2026-07-10) and
  // against the Dutch fixtures' own contract values, because the Netherlands
  // is a country Remote actually publishes a contract-amendment form for.
  //
  // THE SCENARIOS USED TO NAME NIGERIAN EMPLOYMENTS, AND ALL FOUR WERE
  // UNREACHABLE. `GET /v1/contract-amendments/schema` answers 500 for NGA, so
  // every one of them escalated `country_schema_unavailable` at a gate two
  // steps ahead of the gate it claimed to demonstrate — "After cutoff" never
  // reached the cutoff engine, and "Before cutoff" could not reach
  // `dual_approval_required` under any input. See src/remoteui/employees.js's
  // header for the full account. `test/remoteui.test.js` now asserts each
  // scenario's decision AND its reason, so a roster that drifts back to a
  // formless country fails the suite instead of quietly demoing a refusal.
  var SCENARIOS = {
    "fill-before-cutoff": {
      label: "Before cutoff",
      employeeId: "emp_nl_amend_001",
      changeType: "salary",
      valueFields: { salaryOld: "salary-old", salaryNew: "salary-new" },
      values: { salaryOld: 50000, salaryNew: 60000 },
      effectiveDate: "2026-07-15",
      now: "2026-06-20",
      reason: "Promotion, effective with the July payroll cycle.",
    },
    "fill-within-48h": {
      label: "Within 48h of cutoff",
      employeeId: "emp_nl_amend_001",
      changeType: "jobTitle",
      valueFields: { titleOld: "title-old", titleNew: "title-new" },
      values: { titleOld: "Senior Software Engineer", titleNew: "Lead Software Engineer" },
      effectiveDate: "2026-07-15",
      now: "2026-07-09",
      reason: "Title change from the next cycle — the July cutoff is nearly here.",
    },
    "fill-after-cutoff": {
      label: "After cutoff",
      employeeId: "emp_nl_amend_001",
      changeType: "jobTitle",
      valueFields: { titleOld: "title-old", titleNew: "title-new" },
      values: { titleOld: "Senior Software Engineer", titleNew: "Staff Engineer" },
      effectiveDate: "2026-06-15",
      now: "2026-06-20",
      reason: "Backdated title change requested after the June cutoff passed.",
    },
    "fill-terminated": {
      label: "Terminated employee",
      employeeId: "emp_terminated_002",
      changeType: "salary",
      valueFields: { salaryOld: "salary-old", salaryNew: "salary-new" },
      values: { salaryOld: 60000, salaryNew: 65000 },
      effectiveDate: "2026-07-15",
      now: "2026-06-20",
      reason: "Salary review for a leaver.",
    },
    "fill-no-form": {
      label: "Country with no form",
      employeeId: "emp_active_001",
      changeType: "salary",
      valueFields: { salaryOld: "salary-old", salaryNew: "salary-new" },
      values: { salaryOld: 50000, salaryNew: 60000 },
      effectiveDate: "2026-07-15",
      now: "2026-06-20",
      reason: "Promotion for a Nigeria-based employee — Remote publishes no contract-amendment form there.",
    },
  };

  // -- submitting helpers (shared by all three paths) ----------------------------

  function post(endpoint, body) {
    // `[SESSION_HEADER]` — the brackets are load-bearing. Without them the
    // header goes out named literally "SESSION_HEADER", the server sees no
    // session at all, and EVERY submission and consent comes back refused as
    // `unauthenticated`. (Which is the right failure mode — this fails closed,
    // exactly as roles.js intends — but it meant no path on the page worked.)
    // Nothing about the authorization changes here: the role still travels as
    // a server-owned session name in a header, never a claim in the body, and
    // the server is still the only place authorization is decided.
    var headers = { "Content-Type": "application/json" };
    headers[SESSION_HEADER] = ACTIVE_SESSION;
    return fetch(endpoint, {
      method: "POST",
      headers: headers,
      body: JSON.stringify(body),
    }).then(function (res) { return res.json(); });
  }

  // The same session header on a READ. The role travels the same way it does
  // on a write — a server-owned session name in a header, never a claim — and
  // the server decides which amendments that session may see. Knowing an id is
  // not permission to read a contract change.
  function get(endpoint) {
    var headers = {};
    headers[SESSION_HEADER] = ACTIVE_SESSION;
    return fetch(endpoint, { headers: headers }).then(function (res) { return res.json(); });
  }

  // A refusal renders the same everywhere: the server's code + reason, verbatim.
  function renderRefusal(result, box) {
    box.appendChild(el("p", { class: "action-status bad" }, ["Refused: " + (result.code || "unknown error") + " — " + (result.reason || "")]));
  }

  function renderError(message, box) {
    clear(box);
    box.appendChild(el("p", { class: "action-status bad" }, ["Couldn't submit: " + message]));
  }

  // -- admin path: submit an amendment request -------------------------------------

  function buildChanges() {
    var type = byId("change-type").value;
    var include = function (key) { return type === key || type === "composite"; };
    var changes = {};
    if (include("salary")) {
      changes.salary = {
        oldAmount: num(byId("salary-old").value),
        newAmount: num(byId("salary-new").value),
        // NO `|| "USD"` FALLBACK, and that removal is the point. This line
        // used to read a <span>'s `.value` and fall back to a hard-coded
        // "USD" — so every Dutch employment, all of which are paid in EUR,
        // submitted a salary amendment denominated in dollars. policyEngine.js
        // writes `changes.salary.currency` straight through to the form's
        // `compensation_currency_code` and never compares it to the record, so
        // that default would have silently redenominated a live contract.
        // A currency the record did not supply is now null, which the gates
        // refuse, rather than a plausible guess that they accept.
        currency: currentCurrency,
      };
    }
    if (include("jobTitle")) {
      changes.jobTitle = { oldValue: byId("title-old").value, newValue: byId("title-new").value };
    }
    if (include("weeklyHours")) {
      changes.weeklyHours = { oldValue: num(byId("hours-old").value), newValue: num(byId("hours-new").value) };
    }
    return changes;
  }

  function submitRequest(ev) {
    ev.preventDefault();
    var button = byId("submit-btn");
    button.disabled = true;

    var body = {
      employmentId: byId("employee-select").value,
      changes: buildChanges(),
      requestedEffectiveDate: byId("effective-date").value,
      reasonText: byId("reason-text").value,
    };
    if (scenarioNow) body.now = scenarioNow;

    post("/api/submit", body)
      .then(function (result) {
        button.disabled = false;
        renderResult(result);
      })
      .catch(function (err) {
        button.disabled = false;
        renderError(err.message, byId("submit-result"));
      });
  }

  function renderResult(result) {
    var box = byId("submit-result");
    clear(box);

    if (!result.ok) {
      renderRefusal(result, box);
      return;
    }

    // The id the requester needs in order to follow this anywhere — the track
    // card below, and the two consent forms — carried across rather than left
    // to be copied out of a truncated string on screen.
    if (result.amendmentId) byId("track-amendment").value = result.amendmentId;

    var wrap = el("div", { class: "result-box" }, [
      el("div", { class: "result-head" }, [
        el("span", { class: "badge decision-" + result.decision }, [DECISION_LABELS[result.decision] || result.decision]),
        el("span", { class: "muted small" }, [" ticket #" + result.ticketId + " · amendment " + String(result.amendmentId).slice(0, 8)]),
      ]),
      result.summary
        ? el("p", { class: "muted small" }, [result.summary])
        // Remote prints an em dash in an empty cell rather than leaving it
        // blank, so "no summary was drafted" is visible rather than ambiguous.
        : el("p", { class: "r-none small" }, ["—"]),
    ]);

    if (result.flags && result.flags.length) {
      var flagList = el("ul", { class: "tag-list" });
      result.flags.forEach(function (flag) {
        flagList.appendChild(el("li", { class: "tag-chip warn" }, [flag]));
      });
      wrap.appendChild(flagList);
    }

    if (result.tags && result.tags.length) {
      var tagList = el("ul", { class: "tag-list" });
      result.tags.forEach(function (tag) {
        tagList.appendChild(el("li", { class: "tag-chip" }, [tag]));
      });
      wrap.appendChild(tagList);
    }

    wrap.appendChild(el("p", { class: "small" }, [
      (result.actionable ? "Open to the two-role approval in the ZAF sidebar. " : "Not open to approval here. ") +
        (result.actionableReason || ""),
    ]));

    // Plain-English context for a refusal, composed SERVER-SIDE and rendered
    // verbatim. The page does not decide when it appears and does not compose
    // it — same rule as every other string here: the server decides, the page
    // shows. Absent for anything the server had nothing extra to say about.
    if (result.explanation) {
      wrap.appendChild(el("p", { class: "small muted-note" }, [result.explanation]));
    }

    box.appendChild(wrap);
  }

  // -- employer / employee paths: consent to an amendment --------------------------

  function submitConsent(formKey, party) {
    var button = byId(formKey + "-btn");
    button.disabled = true;

    var body = {
      amendmentId: byId(formKey + "-amendment").value,
      party: party,
      note: byId(formKey + "-note").value,
    };

    post("/api/consent", body)
      .then(function (result) {
        button.disabled = false;
        renderConsent(result, byId(formKey + "-result"));
      })
      .catch(function (err) {
        button.disabled = false;
        renderError(err.message, byId(formKey + "-result"));
      });
  }

  function renderConsent(result, box) {
    clear(box);
    if (!result.ok) {
      renderRefusal(result, box);
      return;
    }
    var wrap = el("div", { class: "result-box" }, [
      el("div", { class: "result-head" }, [statusEl(result.code)]),
      el("p", { class: "small" }, [
        "As the " + result.party + ", for amendment " + String(result.amendmentId).slice(0, 8) + ".",
      ]),
      result.reason
        ? el("p", { class: "muted small" }, [result.reason])
        : el("p", { class: "r-none small" }, ["—"]),
    ]);
    box.appendChild(wrap);
  }

  // -- tracking: what a person decided about an amendment ------------------------
  //
  // READ ONLY. Every control in this block asks a question; none of them
  // changes anything, and there is no approve/deny/acknowledge here to add one
  // to. UC-06's two approvals live in the ZAF sidebar, where dual control
  // requires two different people; a control here would be a second place to
  // decide, with one signature, outside that audit.
  //
  // POLLING, and why it is polling. The approval happens in another process
  // entirely, so this page cannot be told when one lands — it asks. The page's
  // own copy says that rather than implying a push, and the toggle starts OFF:
  // an amendment sits with two humans for hours or days, so a page that polls
  // from the moment it loads spends the server's time on a question nobody has
  // asked yet.
  var TRACK_POLL_MS = 5000;
  var trackTimer = null;
  var trackLive = false;

  function trackedId() {
    return byId("track-amendment").value.trim();
  }

  function renderTrackToggle() {
    var toggle = byId("track-live");
    toggle.classList.toggle("is-paused", !trackLive);
    toggle.setAttribute("aria-pressed", trackLive ? "true" : "false");
    toggle.textContent = trackLive ? "Live — checking every " + TRACK_POLL_MS / 1000 + "s" : "Live off";
  }

  function stopTrackPolling() {
    if (trackTimer) clearInterval(trackTimer);
    trackTimer = null;
  }

  function setTrackLive(on) {
    trackLive = on;
    stopTrackPolling();
    renderTrackToggle();
    if (!on) return;
    trackTimer = setInterval(function () {
      // Nothing to poll for once the id is cleared, and nothing to poll for on
      // a settled amendment either — a decision that has been taken does not
      // change, and asking forever after it costs the server for no answer.
      if (!trackedId()) return setTrackLive(false);
      loadTracked({ quiet: true });
    }, TRACK_POLL_MS);
  }

  function loadTracked(opts) {
    var quiet = Boolean(opts && opts.quiet);
    var box = byId("track-result");
    var id = trackedId();
    if (!id) {
      clear(box);
      box.appendChild(el("p", { class: "action-status bad" }, ["Enter the amendment id to check."]));
      return;
    }
    // A poll must not blank what it is refreshing: replacing a rendered
    // decision with "Reading..." every few seconds makes a live view
    // unreadable. Only an explicit check says so.
    if (!quiet) {
      clear(box);
      box.appendChild(el("p", { class: "r-muted small" }, ["Reading the record..."]));
    }

    get("/api/amendments/" + encodeURIComponent(id))
      .then(function (result) {
        renderTracked(result);
        byId("track-checked").textContent = "Last checked " + new Date().toLocaleTimeString();
        // Stop asking once a person has finished with it. `settled` is the
        // server's answer, not this file's — nothing here decides what
        // "decided" means.
        if (result.ok && result.settled) setTrackLive(false);
      })
      .catch(function (err) {
        // A failed POLL leaves the last good answer on screen and says so; a
        // failed explicit check has nothing to preserve.
        if (quiet) {
          byId("track-checked").textContent = "Could not refresh: " + err.message;
          return;
        }
        renderError(err.message, byId("track-result"));
      });
  }

  function renderTracked(result) {
    var box = byId("track-result");
    clear(box);

    if (!result.ok) {
      renderRefusal(result, box);
      return;
    }

    var status = result.status || {};
    var wrap = el("div", { class: "result-box" + (result.settled ? " is-decided" : "") });

    wrap.appendChild(el("div", { class: "result-head" }, [
      statusEl(status.state),
      el("span", { class: "muted small" }, [
        " " + (status.label || "") + " \u00b7 amendment " + String(result.amendmentId).slice(0, 8) +
          (result.externalRef ? " \u00b7 ticket #" + result.externalRef : ""),
      ]),
    ]));

    // The sentence that answers the question, composed server-side.
    wrap.appendChild(el("p", { class: "small" }, [status.detail || ""]));

    // WHAT A PERSON ACTUALLY DID, given its own block rather than a row among
    // identifiers. The sentence is UC-06's own describeSettled() verbatim —
    // which outcome, both signatures, the note, and whether the write to
    // Remote landed, which is a different fact from whether two humans agreed.
    if (result.settled) {
      var decided = el("div", { class: "decision-block" }, [
        el("h4", { class: "decision-title" }, ["Decided by a person"]),
      ]);
      if (result.resolution) decided.appendChild(el("p", { class: "small" }, [result.resolution]));
      if (status.decidedBy) decided.appendChild(el("p", { class: "muted small" }, ["Decided by " + status.decidedBy + (status.decidedAt ? " on " + status.decidedAt : "")]));
      if (status.note) decided.appendChild(el("p", { class: "muted small" }, ["Their note: " + status.note]));
      wrap.appendChild(decided);
    }

    // The two signature slots, named. Dual control is about two PEOPLE, so
    // "1 of 2" without saying which one is signed hides the thing the control
    // is for. Every value here is read off the server's own list.
    var slots = status.signatures || [];
    if (slots.length) {
      var list = el("ul", { class: "tag-list" });
      slots.forEach(function (slot) {
        list.appendChild(el("li", { class: "tag-chip" + (slot.signed ? "" : " warn") }, [
          slot.label + ": " + (slot.signed ? (slot.approver || "signed") + (slot.at ? " on " + slot.at : "") : "not yet signed"),
        ]));
      });
      wrap.appendChild(list);
    }

    if (status.awaitingRole) {
      wrap.appendChild(el("p", { class: "muted small" }, ["Waiting on: " + status.awaitingRole]));
    }

    // Reported, never offered: there is no control on this page that could act
    // on it, and the sentence naming where the decision happens is the
    // server's.
    wrap.appendChild(el("p", { class: "small" }, [
      (result.openToApproval ? "Still open to the two-role approval in the ZAF sidebar. " : "Not open to approval. ") +
        (result.openToApprovalReason || ""),
    ]));
    wrap.appendChild(el("p", { class: "muted-note small" }, [result.note || ""]));

    box.appendChild(wrap);
  }

  // -- boot -----------------------------------------------------------------------

  document.addEventListener("DOMContentLoaded", function () {
    loadEmployees();
    setField("effective-date", "2026-07-15");
    byId("employee-select").addEventListener("change", onEmployeeChange);
    byId("change-type").addEventListener("change", onChangeType);
    byId("submit-form").addEventListener("submit", submitRequest);
    byId("consent-employer-form").addEventListener("submit", function (ev) { ev.preventDefault(); submitConsent("consent-employer", "employer"); });
    byId("consent-employee-form").addEventListener("submit", function (ev) { ev.preventDefault(); submitConsent("consent-employee", "employee"); });
    byId("track-form").addEventListener("submit", function (ev) { ev.preventDefault(); loadTracked(); });
    byId("track-live").addEventListener("click", function () { setTrackLive(!trackLive); });
    renderTrackToggle();
    ROLE_KEYS.forEach(function (key) {
      byId("tab-" + key).addEventListener("click", function () { activateRole(key); });
    });

    // The other half of the tablist contract: Left/Right (and Home/End) move
    // between tabs, wrapping. Without this the markup announces a widget that
    // cannot be operated the way it says it can.
    byId("role-tabs").addEventListener("keydown", function (ev) {
      var current = ROLE_KEYS.indexOf(ACTIVE_SESSION);
      var next = null;
      if (ev.key === "ArrowRight") next = (current + 1) % ROLE_KEYS.length;
      else if (ev.key === "ArrowLeft") next = (current - 1 + ROLE_KEYS.length) % ROLE_KEYS.length;
      else if (ev.key === "Home") next = 0;
      else if (ev.key === "End") next = ROLE_KEYS.length - 1;
      if (next === null) return;
      ev.preventDefault();
      activateRole(ROLE_KEYS[next]);
      byId("tab-" + ROLE_KEYS[next]).focus();
    });
    Object.keys(SCENARIOS).forEach(function (id) {
      byId(id).addEventListener("click", function () {
        fillScenario(SCENARIOS[id]);
      });
    });
  });
})();
