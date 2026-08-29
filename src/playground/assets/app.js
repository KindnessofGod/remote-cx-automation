/* ---------------------------------------------------------------------------
 * app.js  —  UC-01 playground front end
 * ---------------------------------------------------------------------------
 * Plain browser JS, no build step, no framework — matches the repo's "clone
 * and run in one command" convention (same style as zaf-app/assets/main.js).
 *
 * Same non-negotiable as the ZAF sidebar: this file DECIDES NOTHING. Every
 * decision it shows came from the server (handleVerificationTicket,
 * reviewPolicy, submitReviewDecision) — this is a view and a set of buttons,
 * not a second copy of the rules. And every dynamic value is written with
 * textContent, never innerHTML, because ticket text is untrusted input.
 * ------------------------------------------------------------------------- */

(function () {
  "use strict";

  var DECISION_LABELS = {
    auto_resolve: "Auto-resolved",
    human_review: "Awaiting review",
    escalate: "Escalated",
  };
  var TIER_LABELS = { low: "🟢 Low", medium: "🟡 Medium", high: "🔴 High" };

  // -- lifecycle state -> tone: the ONE place this surface maps a status ------
  //
  // Every string below is produced by the SERVER — case statuses come from
  // src/uc01/workflow.js's INITIAL_STATUS_BY_DECISION and reviewPolicy.js's
  // REVIEW_ACTIONS, review statuses from the same place. This table is purely
  // presentation: it picks a dot colour and a capitalised label for a status
  // the server already decided. It never invents, overrides or recomputes one.
  //
  // Anything not listed here falls through to the neutral `idle` dot and keeps
  // its RAW string as the word. Guessing a tone for an unrecognised status is
  // how a page ends up telling a specialist that something is fine because a
  // lookup missed — an unknown state must look unknown.
  var STATUS_TONES = {
    // resolved / approved — the work is done
    resolved: { tone: "r-status-ok", label: "Resolved" },
    approved: { tone: "r-status-ok", label: "Approved" },
    // pending_* / awaiting_* — someone still has to act
    pending_review: { tone: "r-status-warn", label: "Pending review" },
    pending: { tone: "r-status-warn", label: "Pending" },
    // escalated / declined / rejected — stopped, refused or handed off
    escalated: { tone: "r-status-danger", label: "Escalated" },
    // The verb moved `denied` -> `declined` on 2026-08-19 (the review API
    // still accepts `deny` on input). Both are mapped: a case decided
    // before the rename must not render as an unrecognised status.
    declined: { tone: "r-status-danger", label: "Declined" },
    denied: { tone: "r-status-danger", label: "Denied" },
    rejected: { tone: "r-status-danger", label: "Rejected" },
  };

  var EXAMPLES = [
    {
      label: "§12.1 Standard letter",
      text: "Please send me a standard employment verification letter.",
      loggedIn: "emp_active_001",
      about: "emp_active_001",
      attachment: false,
      consent: false,
      simulateLow: false,
    },
    {
      label: "§12.2 Terminated employee",
      text: "I need a standard employment letter.",
      loggedIn: "emp_terminated_002",
      about: "emp_terminated_002",
      attachment: false,
      consent: false,
      simulateLow: false,
    },
    {
      label: "§12.3 Uploaded bank form",
      text: "My bank sent this form, please complete it.",
      loggedIn: "emp_active_001",
      about: "emp_active_001",
      attachment: true,
      consent: false,
      simulateLow: false,
    },
    {
      label: "§12.4 External portal URL",
      text: "Here is the link to my lender's portal: https://verify.example.com/xyz",
      loggedIn: "emp_active_001",
      about: "emp_active_001",
      attachment: false,
      consent: false,
      simulateLow: false,
    },
    {
      label: "§12.5a Third party, no consent",
      text: "This is First Bank, we need to verify employment directly.",
      loggedIn: "",
      about: "emp_active_001",
      attachment: false,
      consent: false,
      simulateLow: false,
    },
    {
      label: "§12.5b Third party, with consent",
      text: "This is First Bank, please verify employment on behalf of the employee.",
      loggedIn: "",
      about: "emp_active_001",
      attachment: false,
      consent: true,
      simulateLow: false,
    },
    {
      label: "§12.6 Ambiguous / low confidence",
      text: "Necesito una carta de verificación de empleo, no estoy segura del formato exacto.",
      loggedIn: "emp_active_001",
      about: "emp_active_001",
      attachment: false,
      consent: false,
      simulateLow: true,
    },
    {
      label: "§12.7 Over-scope (asks for salary)",
      text: "Please send a standard employment verification letter, and can you also confirm my salary on it?",
      loggedIn: "emp_active_001",
      about: "emp_active_001",
      attachment: false,
      consent: false,
      simulateLow: false,
    },
  ];

  // -- tiny DOM helpers ---------------------------------------------------

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  function appendRow(dl, label, value) {
    dl.appendChild(el("dt", null, label));
    var empty = value === null || value === undefined || value === "" || value === "—";
    // Remote prints an em dash in an empty cell rather than leaving it blank,
    // so "nothing here" is visible instead of ambiguously unrendered.
    dl.appendChild(el("dd", empty ? "r-none" : null, empty ? "—" : String(value)));
  }

  /**
   * A lifecycle state as Remote renders it: a coloured dot beside a plain word.
   * `prefix` labels which state it is when a row shows more than one.
   */
  function statusEl(status, prefix) {
    var known = STATUS_TONES[status];
    return el(
      "span",
      "r-status " + (known ? known.tone : "r-status-idle"),
      (prefix || "") + (known ? known.label : String(status))
    );
  }

  /** The em dash Remote prints in an empty cell. */
  function noneEl() {
    return el("span", "r-none", "—");
  }

  /** A table cell holding `value`, or the em dash when there is nothing to show. */
  function cellOrNone(className, value) {
    var td = el("td", className);
    if (value === null || value === undefined || value === "") td.appendChild(noneEl());
    else td.textContent = String(value);
    return td;
  }

  /** A label with the required asterisk, plus the word for a screen reader. */
  function requiredLabel(text) {
    var span = el("span", null, text);
    span.appendChild(el("span", "r-req", "*"));
    span.appendChild(el("span", "r-sr-only", "required"));
    return span;
  }

  function decisionBadge(decision) {
    return el("span", "badge decision-" + decision, DECISION_LABELS[decision] || decision);
  }

  function tierBadge(tier) {
    return el("span", "badge tier-" + tier, TIER_LABELS[tier] || tier);
  }

  function flagsList(flags) {
    if (!flags || !flags.length) return el("p", "muted small", "No escalation flags were raised.");
    var ul = el("ul", "flags");
    flags.forEach(function (f) {
      ul.appendChild(el("li", "flag", f));
    });
    return ul;
  }

  // -- examples ------------------------------------------------------------

  function renderExamples() {
    var container = document.getElementById("examples");
    EXAMPLES.forEach(function (ex) {
      var btn = el("button", "example-btn", ex.label);
      btn.type = "button";
      btn.addEventListener("click", function () {
        applyExample(ex);
      });
      container.appendChild(btn);
    });
  }

  function applyExample(ex) {
    document.getElementById("ticket-text").value = ex.text;
    document.getElementById("logged-in-select").value = ex.loggedIn;
    document.getElementById("about-select").value = ex.about;
    document.getElementById("attachment-checkbox").checked = ex.attachment;
    document.getElementById("consent-checkbox").checked = ex.consent;
    document.getElementById("simulate-low-confidence").checked = ex.simulateLow;
  }

  // -- ticket submit --------------------------------------------------------

  function submitTicket(evt) {
    evt.preventDefault();
    var btn = document.getElementById("submit-btn");
    btn.disabled = true;

    var customAbout = document.getElementById("custom-about-id").value.trim();
    var customLoggedIn = document.getElementById("custom-logged-in-id").value.trim();
    var payload = {
      text: document.getElementById("ticket-text").value,
      asEmploymentId: customLoggedIn || document.getElementById("logged-in-select").value || null,
      employmentId: customAbout || document.getElementById("about-select").value,
      hasAttachment: document.getElementById("attachment-checkbox").checked,
      consentOnRecord: document.getElementById("consent-checkbox").checked,
      simulateLowConfidence: document.getElementById("simulate-low-confidence").checked,
    };

    fetch("/api/tickets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
      .then(function (res) {
        return res.json();
      })
      .then(function (result) {
        renderTicketResult(result);
        loadQueue();
        loadAudit();
      })
      .catch(function (err) {
        renderTicketResult({ ok: false, reason: "Could not reach the playground API: " + err.message });
      })
      .then(function () {
        btn.disabled = false;
      });
  }

  function renderTicketResult(result) {
    var container = document.getElementById("ticket-result");
    clear(container);

    if (result.ok === false) {
      container.appendChild(el("p", "action-status bad", result.reason || "Something went wrong."));
      return;
    }

    var box = el("div", "result-box");
    var badges = el("div", "badges");
    badges.appendChild(decisionBadge(result.decision));
    box.appendChild(badges);

    var dl = el("dl", "rows");
    appendRow(dl, "Ticket", result.externalRef);
    if (result.decision === "out_of_scope" && result.reply) {
      appendRow(dl, "Response", result.reply);
    } else {
      appendRow(dl, "Reason", result.reason);
    }
    box.appendChild(dl);
    box.appendChild(flagsList(result.flags));

    if (result.letterHtml) {
      var iframe = document.createElement("iframe");
      iframe.className = "letter-frame";
      // Without a title an <iframe> announces as "frame" — the letter is the
      // whole point of the auto-resolve path, so it gets a name.
      iframe.setAttribute("title", "Employment verification letter");
      iframe.setAttribute("sandbox", "");
      iframe.srcdoc = result.letterHtml;
      box.appendChild(iframe);
    }

    container.appendChild(box);
  }

  // -- queue ------------------------------------------------------------------

  function loadQueue() {
    fetch("/api/cases")
      .then(function (r) {
        return r.json();
      })
      .then(function (data) {
        renderQueue(data.cases || []);
      });
  }

  function renderQueue(cases) {
    var table = document.getElementById("queue-table");
    var empty = document.getElementById("queue-empty");
    var body = document.getElementById("queue-body");
    clear(body);

    if (!cases.length) {
      table.classList.add("hidden");
      empty.classList.remove("hidden");
      return;
    }
    table.classList.remove("hidden");
    empty.classList.add("hidden");

    cases.forEach(function (c) {
      var tr = el("tr", "clickable");
      tr.appendChild(el("td", null, c.externalRef));
      tr.appendChild(el("td", null, c.employmentId));
      tr.appendChild(el("td", null, c.requester));

      var decisionTd = document.createElement("td");
      decisionTd.appendChild(decisionBadge(c.decision));
      tr.appendChild(decisionTd);

      var tierTd = document.createElement("td");
      tierTd.appendChild(tierBadge(c.tier));
      tr.appendChild(tierTd);

      // State, the way Remote renders it: a dot beside the word. The case's own
      // status always shows; the review-queue status only when one exists.
      var statusTd = document.createElement("td");
      var statusCell = el("div", "status-cell");
      statusCell.appendChild(statusEl(c.status));
      if (c.reviewStatus) statusCell.appendChild(statusEl(c.reviewStatus, "Review: "));
      statusTd.appendChild(statusCell);
      tr.appendChild(statusTd);

      // The row was click-only, which made the entire specialist half of this
      // page unreachable by keyboard: a <tr> takes no focus and fires no
      // activation event. The fix is a real control rather than
      // tabindex/role="button" theatre on a table row — a button is focusable,
      // Enter/Space-activatable and announced correctly for free. The row click
      // stays as a mouse convenience on top of it.
      var actionTd = el("td", "action-cell");
      if (c.actionable) actionTd.appendChild(el("span", "needs-decision", "Needs decision"));
      var openBtn = el("button", "r-btn r-btn-sm r-btn-secondary", "Open");
      openBtn.type = "button";
      // Nine identical "Open" buttons need nine distinguishable names.
      openBtn.setAttribute("aria-label", "Open case " + c.externalRef);
      openBtn.addEventListener("click", function (evt) {
        evt.stopPropagation();
        loadCaseDetail(c.externalRef);
      });
      actionTd.appendChild(openBtn);
      tr.appendChild(actionTd);

      tr.addEventListener("click", function () {
        loadCaseDetail(c.externalRef);
      });
      body.appendChild(tr);
    });
  }

  // -- case detail / act as specialist ----------------------------------------

  function loadCaseDetail(ref) {
    fetch("/api/cases/" + encodeURIComponent(ref))
      .then(function (r) {
        return r.json();
      })
      .then(function (view) {
        renderCaseDetail(ref, view);
      });
  }

  function loadNextActionableCase(excludeRef) {
    fetch("/api/cases")
      .then(function (r) {
        return r.json();
      })
      .then(function (data) {
        var cases = data.cases || [];
        var next = cases.find(function (c) {
          return c.externalRef !== excludeRef && c.actionable && c.reviewStatus === "pending";
        });
        if (next) {
          loadCaseDetail(next.externalRef);
        } else {
          var container = document.getElementById("case-detail");
          clear(container);
          container.appendChild(el("p", "muted small", "All caught up — no awaiting cases."));
        }
      });
  }

  function renderCaseDetail(ref, view) {
    var container = document.getElementById("case-detail");
    clear(container);

    if (!view.found) {
      container.appendChild(el("p", "muted small", "Case not found."));
      return;
    }

    var box = el("div", "result-box");
    var badges = el("div", "badges");
    badges.appendChild(decisionBadge(view.case.decision));
    if (view.tier) badges.appendChild(tierBadge(view.tier));
    box.appendChild(badges);

    var dl = el("dl", "rows");
    appendRow(dl, "Ticket", ref);
    appendRow(dl, "About", view.case.employmentId);
    appendRow(dl, "Requester", view.case.requester);
    appendRow(dl, "Reason", view.case.reason);

    var classification = view.case.classification || {};
    appendRow(dl, "Intent", classification.intent || "—");
    appendRow(dl, "Classification source", classification.source || "—");
    appendRow(dl, "Confidence", typeof classification.confidence === "number" ? classification.confidence : "—");
    appendRow(dl, "Requester type", classification.requesterType || "—");
    appendRow(dl, "Has attachment", classification.hasAttachment ? "Yes" : "No");
    appendRow(dl, "Has external URL", classification.hasExternalUrl ? "Yes" : "No");
    box.appendChild(dl);
    box.appendChild(flagsList(view.case.flags));

    if (view.case.ticketText) {
      var requestBox = el("div", "ticket-text-box");
      requestBox.appendChild(el("h4", null, "Original request"));
      requestBox.appendChild(el("pre", null, view.case.ticketText));
      box.appendChild(requestBox);
    }

    container.appendChild(box);

    var actionsBox = el("div", "result-box");
    actionsBox.style.marginTop = "10px";

    if (!view.actionable) {
      actionsBox.appendChild(el("p", "muted small", view.actionableReason || "This case is not open to a decision here."));
      container.appendChild(actionsBox);
      return;
    }

    // Both fields below are genuinely required — the server refuses without
    // them (reviewPolicy.js's `approver_required` / `reason_required`), so they
    // carry the asterisk. Nothing else on this page does.
    var approverLabel = el("label", "field");
    approverLabel.appendChild(requiredLabel("Acting as (specialist name)"));
    var approverInput = document.createElement("input");
    approverInput.type = "text";
    approverInput.placeholder = "e.g. agent_taylor";
    approverLabel.appendChild(approverInput);
    actionsBox.appendChild(approverLabel);

    var noteLabel = el("label", "field");
    noteLabel.appendChild(requiredLabel("Reason for decision"));
    var noteInput = document.createElement("textarea");
    noteInput.rows = 3;
    noteInput.placeholder = "e.g. Approved after verifying third-party consent by phone.";
    noteLabel.appendChild(noteInput);
    actionsBox.appendChild(noteLabel);

    var buttons = el("div", "field-row");
    var approveBtn = el("button", "btn approve", "Approve");
    var declineBtn = el("button", "btn decline", "Decline");
    approveBtn.type = "button";
    declineBtn.type = "button";
    buttons.appendChild(approveBtn);
    buttons.appendChild(declineBtn);
    actionsBox.appendChild(buttons);

    var status = el("p", "action-status");
    actionsBox.appendChild(status);

    function submit(action) {
      if (!approverInput.value.trim()) {
        status.className = "action-status bad";
        status.textContent = "Enter a specialist name first — the audit log needs someone to attribute this to.";
        return;
      }
      if (!noteInput.value.trim()) {
        status.className = "action-status bad";
        status.textContent = "Enter a reason for the decision — it is recorded in the audit log.";
        return;
      }
      approveBtn.disabled = true;
      declineBtn.disabled = true;
      status.className = "action-status";
      status.textContent = "Recording " + action + "…";

      fetch("/api/cases/" + encodeURIComponent(ref) + "/" + action, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ approver: approverInput.value.trim(), note: noteInput.value }),
      })
        .then(function (r) {
          return r.json();
        })
        .then(function (result) {
          if (result.ok) {
            status.className = "action-status ok";
            status.textContent =
              action === "approve" ? "Approved." + (result.letterIssued ? " Letter issued." : "") : "Denied and recorded.";
            loadQueue();
            loadAudit();
            setTimeout(function () {
              loadNextActionableCase(ref);
            }, 400);
          } else {
            status.className = "action-status bad";
            status.textContent = result.reason || "Refused.";
            approveBtn.disabled = false;
            declineBtn.disabled = false;
          }
        })
        .catch(function (err) {
          status.className = "action-status bad";
          status.textContent = "Could not reach the playground API: " + err.message;
          approveBtn.disabled = false;
          declineBtn.disabled = false;
        });
    }

    approveBtn.addEventListener("click", function () {
      submit("approve");
    });
    declineBtn.addEventListener("click", function () {
      submit("decline");
    });

    container.appendChild(actionsBox);
  }

  // -- audit log ----------------------------------------------------------------

  function loadAudit() {
    fetch("/api/audit")
      .then(function (r) {
        return r.json();
      })
      .then(function (data) {
        renderAudit(data.entries || []);
      });
  }

  function renderAudit(entries) {
    var table = document.getElementById("audit-table");
    var empty = document.getElementById("audit-empty");
    var body = document.getElementById("audit-body");
    clear(body);

    if (!entries.length) {
      table.classList.add("hidden");
      empty.classList.remove("hidden");
      return;
    }
    table.classList.remove("hidden");
    empty.classList.add("hidden");

    entries.forEach(function (entry) {
      var tr = document.createElement("tr");
      tr.appendChild(el("td", null, new Date(entry.at).toLocaleTimeString()));
      tr.appendChild(el("td", null, entry.useCase));
      tr.appendChild(el("td", null, entry.action));
      tr.appendChild(cellOrNone(null, entry.actor));
      tr.appendChild(cellOrNone(null, entry.riskTier));
      tr.appendChild(cellOrNone("audit-reason", entry.details && entry.details.note));
      var detailsTd = document.createElement("td");
      var summary = "";
      try {
        summary = JSON.stringify(entry.details || {});
      } catch (e) {
        summary = "(unserializable details)";
      }
      detailsTd.appendChild(el("code", "audit-details", summary));

      // The per-attempt trace that produced this decision (invariant 7's second
      // level). These used to arrive as top-level rows in the same list and
      // rendered as blank ones — empty use case, empty action, `{}` details —
      // because they carry `call`/`attempt`/`ok` and none of the decision-row
      // columns. The server now nests them here, so they read as what they are.
      var steps = entry.traceSteps || [];
      if (steps.length) {
        var line = steps
          .map(function (s) {
            return s.call + " #" + s.attempt + " " + (s.ok ? "ok" : "failed" + (s.error ? ": " + s.error : ""));
          })
          .join(" · ");
        detailsTd.appendChild(el("div", "audit-trace", steps.length + " attempt(s): " + line));
      }
      tr.appendChild(detailsTd);
      body.appendChild(tr);
    });
  }

  // -- boot -----------------------------------------------------------------------

  document.addEventListener("DOMContentLoaded", function () {
    renderExamples();
    document.getElementById("ticket-form").addEventListener("submit", submitTicket);
    loadQueue();
    loadAudit();
  });
})();
