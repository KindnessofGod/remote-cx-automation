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

  // -- access code (deployment) -----------------------------------------------
  //
  // The deployment gates every /remoteui/api route behind the shared portal
  // key (src/portal/access.js), the same rule /portal, /audit and /queue apply.
  // NOTHING about that rule lives here: the page holds no key by default,
  // decides nothing about whether one is needed, and renders only what the
  // server said when it refused. sessionStorage, not localStorage — the key
  // should not outlive the browser session on a shared machine. Same names as
  // workauth.js so one unlock serves both stand-in screens.
  var KEY_STORAGE = "portal.accessKey";
  var KEY_HEADER = "X-Portal-Key";

  function storedKey() {
    try { return window.sessionStorage.getItem(KEY_STORAGE) || ""; } catch (err) { return ""; }
  }
  function rememberKey(value) {
    try { window.sessionStorage.setItem(KEY_STORAGE, value); } catch (err) { /* the request still carries it */ }
  }
  function forgetKey() {
    try { window.sessionStorage.removeItem(KEY_STORAGE); } catch (err) { /* ignore */ }
  }
  function isAccessRefusal(json) {
    return Boolean(json && typeof json.code === "string" && json.code.indexOf("portal_access_key") === 0);
  }

  /** Show the code prompt in the server's own words; hide it once a read succeeds. */
  function showAccessGate(payload) {
    var gate = byId("access-gate");
    var configured = payload.code !== "portal_access_key_not_configured";
    byId("access-reason").textContent = payload.reason || "This page requires an access code.";
    byId("access-why").textContent = payload.why || "";
    var howto = byId("access-howto");
    clear(howto);
    (payload.howToFix || []).forEach(function (step) { howto.appendChild(el("li", {}, [String(step)])); });
    byId("access-form").hidden = !configured;
    gate.hidden = false;
    if (configured) byId("access-key").focus();
  }
  function hideAccessGate() { byId("access-gate").hidden = true; }

  /** Every API call goes through here, so no call can forget the session or the key. */
  function api(path, options) {
    var opts = options || {};
    var headers = {};
    if (opts.body) headers["Content-Type"] = "application/json";
    headers[SESSION_HEADER] = ACTIVE_SESSION;
    var key = storedKey();
    if (key) headers[KEY_HEADER] = key;
    return fetch(path, { method: opts.method || "GET", headers: headers, body: opts.body }).then(function (res) {
      return res.json().then(function (json) {
        if (isAccessRefusal(json)) { if (json.code === "portal_access_key_invalid") forgetKey(); showAccessGate(json); }
        else if (res.ok) hideAccessGate();
        return json;
      });
    });
  }

  var employees = [];
  var employeeById = {};

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
    api("api/employees")
      .then(function (data) {
        if (!data.employees) {
          byId("current-employment").textContent = isAccessRefusal(data)
            ? "The employee list needs the access code above."
            : "Could not load employees: " + (data.reason || data.code || "unknown error");
          return;
        }
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

  /** WHO the employee tab is signed in as — the server's answer, never a literal in the HTML. */
  function loadSessionCaption() {
    var box = byId("employee-session-caption");
    var saved = ACTIVE_SESSION;
    ACTIVE_SESSION = "employee";
    var read = api("api/session");
    ACTIVE_SESSION = saved;
    read
      .then(function (data) {
        clear(box);
        if (!data.ok) { box.textContent = "Could not read the employee session: " + (data.reason || data.code || ""); return; }
        box.appendChild(document.createTextNode("The employee session is " + (data.name || "unnamed") + " ("));
        box.appendChild(el("span", { class: "r-mono" }, [String(data.employmentId || data.id || "")]));
        box.appendChild(document.createTextNode(")."));
      })
      .catch(function (err) { box.textContent = "Could not read the employee session: " + err.message; });
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
    updateDecreaseBox();
  }

  /** The decrease attestations appear only when the new salary is below the current one. */
  function updateDecreaseBox() {
    var oldV = num(byId("salary-old").value);
    var newV = num(byId("salary-new").value);
    var type = byId("change-type").value;
    var salaryShown = type === "salary" || type === "composite";
    byId("salary-decrease").hidden = !(salaryShown && Number.isFinite(oldV) && Number.isFinite(newV) && newV < oldV);
  }

  // -- change-type field visibility ---------------------------------------------

  var CHANGE_FIELDS = { salary: "field-salary", jobTitle: "field-jobTitle", weeklyHours: "field-weeklyHours" };

  function onChangeType() {
    var type = byId("change-type").value;
    Object.keys(CHANGE_FIELDS).forEach(function (key) {
      byId(CHANGE_FIELDS[key]).style.display = key === type || type === "composite" ? "" : "none";
    });
    prefillOldValues();
    updateDecreaseBox();
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
    // The clock is a VISIBLE field now, not a hidden variable: the person
    // submitting can see what date the checks will run as at, and clear it.
    setField("evaluate-now", opts.now || "");
    byId("reason-text").value = opts.reason || "";
    updateDecreaseBox();
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
    return api(endpoint, { method: "POST", body: JSON.stringify(body) });
  }

  // The same session header on a READ. The role travels the same way it does
  // on a write — a server-owned session name in a header, never a claim — and
  // the server decides which amendments that session may see. Knowing an id is
  // not permission to read a contract change.
  function get(endpoint) {
    return api(endpoint);
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
      // Only sent when stated. policyEngine.js reads `decreaseReason` and
      // `employeeInformed` off the request and never defaults either, so a
      // blank box here stays a refusal naming the field, not a fabricated
      // attestation. `employeeInformed` is only ever `true` — an unticked box
      // is "not stated", which is what a missing key means.
      var reason = byId("salary-decrease-reason").value.trim();
      if (reason) changes.salary.decreaseReason = reason;
      if (byId("salary-employee-informed").checked) changes.salary.employeeInformed = true;
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
    var asAt = byId("evaluate-now").value;
    if (asAt) body.now = asAt;

    post("api/submit", body)
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
        el("span", { class: "muted small" }, [" ticket #" + result.ticketId]),
      ]),
      // THE FULL ID, because the consent forms and the tracking card ask for
      // it and a person acting as the employee on their own device has only
      // what the admin was shown. It used to be cut to eight characters.
      el("p", { class: "small" }, ["Amendment id: ", el("span", { class: "r-mono" }, [String(result.amendmentId)])]),
      result.summary
        ? el("p", { class: "muted small" }, [result.summary])
        // Remote prints an em dash in an empty cell rather than leaving it
        // blank, so "no summary was drafted" is visible rather than ambiguous.
        : el("p", { class: "r-none small" }, ["—"]),
    ]);

    // WHEN the checks ran. The quick-fills pin this to June/July 2026; a
    // result that did not say so read as "evaluated today".
    if (result.evaluatedAt) {
      wrap.appendChild(el("p", { class: "muted small" }, [
        "Evaluated as at " + String(result.evaluatedAt).slice(0, 10) +
          (result.clockPinned ? " — a date set on the form, not today's." : "."),
      ]));
    }

    // Plain-English context for a refusal, composed SERVER-SIDE and rendered
    // verbatim, ABOVE the slug chips — the sentence is what a person reads,
    // the slug is what somebody greps, and both stay. Absent for anything the
    // server had nothing extra to say about.
    if (result.explanation) {
      wrap.appendChild(el("p", { class: "small muted-note" }, [result.explanation]));
    }

    if (result.flags && result.flags.length) {
      var flagList = el("ul", { class: "tag-list" });
      result.flags.forEach(function (flag) {
        flagList.appendChild(el("li", { class: "tag-chip warn" }, [flag]));
      });
      wrap.appendChild(flagList);
    }

    // The ticket's routing tags are the automation's own bookkeeping and are
    // no longer drawn for the admin; the owning TEAM is, which is the fact
    // they wanted from them.
    wrap.appendChild(el("p", { class: "small" }, [
      (result.actionable
        ? "Open to the two signatures in Remote's support desk. "
        : "Not open to approval here. ") +
        (result.owner && result.owner.team
          ? (result.owner.escalated ? "Escalated to " : "Queued for ") + result.owner.team + ". "
          : "") +
        (result.actionableReason || ""),
    ]));

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

    post("api/consent", body)
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
        "As the " + result.party + ", for amendment ",
        el("span", { class: "r-mono" }, [String(result.amendmentId)]),
        ".",
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

    get("api/amendments/" + encodeURIComponent(id))
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
        " " + (status.label || "") + (result.externalRef ? " \u00b7 ticket #" + result.externalRef : ""),
      ]),
    ]));
    wrap.appendChild(el("p", { class: "small" }, ["Amendment id: ", el("span", { class: "r-mono" }, [String(result.amendmentId)])]));

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
    // WHOSE signatures those are, said to this reader — the server's sentence.
    if (result.signatoriesNote) {
      wrap.appendChild(el("p", { class: "muted small" }, [result.signatoriesNote]));
    }

    // THE CONSENTS, which this page claimed to show and did not. `null` means
    // the read failed and is said; an empty list means none is recorded.
    var consentHead = el("h4", { class: "decision-title" }, ["Consents recorded"]);
    wrap.appendChild(consentHead);
    if (result.consents === null || result.consents === undefined) {
      wrap.appendChild(el("p", { class: "muted small" }, ["The consent records could not be read just now, so nothing is claimed about them."]));
    } else if (!result.consents.length) {
      wrap.appendChild(el("p", { class: "muted small" }, ["No consent is recorded yet — neither the employee nor the employer has consented on this page."]));
    } else {
      var consentList = el("ul", { class: "consent-list" });
      result.consents.forEach(function (c) {
        consentList.appendChild(el("li", {}, [
          statusEl("consent_recorded"),
          " " + (c.party === "employee" ? "The employee" : "The employer") + " consented" +
            (c.by ? " (" + c.by + ")" : "") + (c.at ? " on " + String(c.at).replace("T", " ").slice(0, 16) + " UTC" : "") +
            (c.note ? " — " + c.note : ""),
        ]));
      });
      wrap.appendChild(consentList);
    }

    // Reported, never offered: there is no control on this page that could act
    // on it, and the sentence naming where the decision happens is the
    // server's.
    wrap.appendChild(el("p", { class: "small" }, [
      (result.openToApproval ? "Still open to the two signatures in Remote's support desk. " : "Not open to approval. ") +
        (result.openToApprovalReason || ""),
    ]));
    wrap.appendChild(el("p", { class: "muted-note small" }, [result.note || ""]));

    box.appendChild(wrap);
  }

  // -- boot -----------------------------------------------------------------------

  document.addEventListener("DOMContentLoaded", function () {
    byId("access-form").addEventListener("submit", function (event) {
      event.preventDefault();
      var value = byId("access-key").value.trim();
      if (!value) return;
      rememberKey(value);
      byId("access-key").value = "";
      loadEmployees();
      loadSessionCaption();
    });
    loadEmployees();
    loadSessionCaption();
    setField("effective-date", "2026-07-15");
    ["salary-old", "salary-new"].forEach(function (id) { byId(id).addEventListener("input", updateDecreaseBox); });
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
