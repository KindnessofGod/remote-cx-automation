// ---------------------------------------------------------------------------
// app.js  —  Live demo client script (plain JS, no build step)
// ---------------------------------------------------------------------------

(function () {
  "use strict";

  var OUTCOME_TAGS = ["uc01_auto_resolved", "uc01_human_review", "verification_exception"];
  var pollTimer = null;
  // The letter as it currently stands on the real ticket, kept for the dialog
  // so opening it needs no second fetch and cannot show something older than
  // what the panel behind it is already showing.
  var currentLetterHtml = null;

  // -- ticket state -> tone: the ONE place this surface maps a status ---------
  //
  // Every string below is a REAL Zendesk ticket status, read back off the real
  // ticket by GET /api/status/:id. This table is presentation only: it picks a
  // dot colour and a readable word for a state Zendesk already owns. It never
  // invents, overrides or recomputes anything — in particular it does not infer
  // the automation's DECISION from the status; the outcome tags below the badge
  // are the ticket's own record of that.
  //
  // Anything unrecognised falls through to the neutral `idle` dot and keeps its
  // RAW status string as the word. A status this page has never seen must look
  // unknown, not be guessed into "fine".
  var STATUS_TONES = {
    // resolved — the automation (or an agent) closed it out
    solved: { tone: "r-status-ok", label: "Solved" },
    closed: { tone: "r-status-ok", label: "Closed" },
    // submitted / processing / awaiting — someone or something still has to act
    new: { tone: "r-status-warn", label: "Submitted" },
    open: { tone: "r-status-warn", label: "Processing" },
    pending: { tone: "r-status-warn", label: "Pending" },
    hold: { tone: "r-status-warn", label: "On hold" },
  };

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

  function loadEmployees() {
    fetch("/api/employees")
      .then(function (res) { return res.json(); })
      .then(function (data) {
        var select = document.getElementById("employee-select");
        clear(select);
        data.employees.forEach(function (emp) {
          select.appendChild(el("option", { value: emp.id }, [emp.name]));
        });
      });
  }

  function submitRequest(ev) {
    ev.preventDefault();
    var button = document.getElementById("submit-btn");
    button.disabled = true;

    var employmentId = document.getElementById("employee-select").value;
    var text = document.getElementById("request-text").value;

    fetch("/api/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ employmentId: employmentId, text: text }),
    })
      .then(function (res) { return res.json(); })
      .then(function (result) {
        button.disabled = false;
        if (!result.ok) {
          renderSubmitError(result);
          return;
        }
        renderSubmitted(result);
        startPolling(result.ticketId);
      })
      .catch(function (err) {
        button.disabled = false;
        renderSubmitError({ reason: err.message });
      });
  }

  function renderSubmitError(result) {
    var box = document.getElementById("submit-result");
    clear(box);
    box.appendChild(el("p", { class: "action-status bad" }, ["Couldn't submit: " + (result.reason || result.code || "unknown error")]));
  }

  function renderSubmitted(result) {
    var box = document.getElementById("submit-result");
    clear(box);
    var wrap = el("div", { class: "result-box" }, [
      el("p", {}, ["Created real ticket #" + result.ticketId + " for " + result.employee.name + " (" + result.employee.email + ")."]),
      el("p", { class: "muted small" }, ["Waiting for the live n8n workflow to process it..."]),
    ]);
    box.appendChild(wrap);
    document.getElementById("status-section").style.display = "";
  }

  // WHEN TO STOP WATCHING — and getting this wrong is what produced the report
  // "I approved it in Zendesk, it is meant to show on this page".
  //
  // This used to stop as soon as ANY of OUTCOME_TAGS appeared, and
  // `uc01_human_review` is one of them. So the moment the automation handed a
  // ticket to a person — the ONLY case where somebody then goes and does
  // something in Zendesk — this page stopped polling and froze on "Pending".
  // The approval landed on the ticket seconds later and the page never looked
  // again. It read as the approval not working; nothing was wrong with it.
  //
  // Now it stops on a TERMINAL outcome only, decided by the server
  // (`describeOutcome()`), and a hand-off is explicitly not terminal — it is the
  // state most worth watching.
  var TERMINAL_OUTCOMES = ["auto", "approved", "declined"];

  // A human decision takes as long as it takes, so the watch is bounded rather
  // than infinite: fast while the automation is running, slow once it is
  // clearly a person's turn, and it gives up with a visible RETRY rather than
  // silently going quiet — a page that has stopped polling and a page that is
  // still polling look identical, which is how this went unnoticed.
  var FAST_MS = 3000;
  var SLOW_MS = 10000;
  var GIVE_UP_MS = 30 * 60 * 1000;

  var pollStartedAt = 0;

  function startPolling(ticketId) {
    if (pollTimer) clearTimeout(pollTimer);
    pollStartedAt = Date.now();
    poll(ticketId);
  }

  function scheduleNextPoll(ticketId, interval) {
    if (pollTimer) clearTimeout(pollTimer);
    pollTimer = setTimeout(function () { poll(ticketId); }, interval);
  }

  function poll(ticketId) {
    fetch("/api/status/" + ticketId)
      .then(function (res) { return res.json(); })
      .then(function (result) {
        if (!result.ok) return scheduleNextPoll(ticketId, SLOW_MS);
        renderStatus(result);

        var kind = result.outcome ? result.outcome.kind : "pending";
        if (TERMINAL_OUTCOMES.indexOf(kind) !== -1) {
          pollTimer = null;
          return;
        }
        if (Date.now() - pollStartedAt > GIVE_UP_MS) {
          pollTimer = null;
          renderWatchStopped(ticketId);
          return;
        }
        scheduleNextPoll(ticketId, kind === "waiting" ? SLOW_MS : FAST_MS);
      })
      .catch(function () { scheduleNextPoll(ticketId, SLOW_MS); });
  }

  /** Said out loud, because a page that has given up looks exactly like one that has not. */
  function renderWatchStopped(ticketId) {
    var panel = document.getElementById("status-panel");
    var note = el("div", { class: "ld-watch-stopped" });
    note.appendChild(el("p", { class: "small" }, [
      "This page stopped watching after 30 minutes. The ticket is unaffected — it is still open and still waiting on a specialist.",
    ]));
    var again = el("button", { type: "button", class: "r-btn r-btn-secondary r-btn-sm" }, ["Check again"]);
    again.addEventListener("click", function () { startPolling(ticketId); });
    note.appendChild(again);
    panel.appendChild(note);
  }

  function renderStatus(result) {
    var panel = document.getElementById("status-panel");
    clear(panel);
    currentLetterHtml = result.publicReplyHtml || null;

    // FIRST, ABOVE THE STATUS WORD. What a person wants from this page is "did
    // it work" — the Zendesk status and the tags are the evidence for that
    // answer, not the answer itself, so they now sit underneath it.
    renderOutcome(panel, result.outcome, result.ticketId, Boolean(result.publicReplyHtml));

    // Lifecycle state, the way Remote renders it: a coloured dot beside the
    // plain word. The word is the label; the dot is a redundant cue.
    var known = STATUS_TONES[result.status];
    var status = el(
      "span",
      { class: "r-status " + (known ? known.tone : "r-status-idle") },
      [known ? known.label : String(result.status)]
    );
    panel.appendChild(el("p", { class: "status-line" }, [status]));

    var tags = result.tags || [];
    if (tags.length) {
      var tagList = el("ul", { class: "tag-list" });
      tags.forEach(function (tag) {
        tagList.appendChild(el("li", { class: "tag-chip" }, [tag]));
      });
      panel.appendChild(tagList);
    } else {
      // No tags yet is a real, meaningful state — print the em dash rather than
      // an empty <ul> that reads as "still rendering".
      panel.appendChild(el("p", { class: "r-none small" }, ["—  no tags on the ticket yet"]));
    }

    if (result.publicReplyHtml) {
      // `title` is not optional on an iframe: without it this is announced as
      // an unnamed "frame", and it holds the actual public reply the customer
      // received — the single most important thing on the page.
      var iframe = el("iframe", {
        class: "letter-frame",
        sandbox: "",
        title: "The public reply posted to the real Zendesk ticket",
      });
      panel.appendChild(iframe);
      iframe.srcdoc = result.publicReplyHtml;
    } else {
      panel.appendChild(el("p", { class: "muted small" }, ["No reply yet — still processing, or waiting on a specialist."]));
    }
  }

  // -- the outcome banner and the letter dialog -------------------------------
  //
  // REPORTED, after approving a real ticket in Zendesk: "it is meant to show on
  // this page, approved and now download". The page polled the ticket and
  // rendered a Zendesk status word and a row of tags, and left the reader to
  // work out from `solved` + a tag list whether a person had actually said yes
  // — on the one surface built to be watched by somebody who is NOT in Zendesk.
  //
  // WHAT IT SAYS IS DECIDED BY THE SERVER (`describeOutcome()` in server.js).
  // This function only draws it. The browser holds no copy of the rule, which
  // is the same reason `/api/context` owns the portal's copy.

  function renderOutcome(panel, outcome, ticketId, hasLetter) {
    if (!outcome) return;
    var banner = el("div", { class: "ld-outcome ld-outcome-" + outcome.kind, role: "status" });
    banner.appendChild(el("p", { class: "ld-outcome-label" }, [outcome.label]));
    banner.appendChild(el("p", { class: "ld-outcome-detail" }, [outcome.detail]));

    // THE BUTTON APPEARS ONLY WHEN THERE IS SOMETHING BEHIND IT. A "download"
    // that opens an empty dialog is worse than no button: it reads as the
    // system having lost the letter.
    if (hasLetter) {
      var open = el("button", { type: "button", class: "r-btn r-btn-primary ld-letter-btn" }, ["View & download the letter"]);
      open.addEventListener("click", function () { openLetterDialog(ticketId); });
      banner.appendChild(open);
    }
    panel.appendChild(banner);
  }

  /**
   * The letter, full size, over the page.
   *
   * A NATIVE <dialog>, not a hand-built overlay: it brings focus trapping,
   * Escape-to-close and inert-background for free, and every one of those is
   * something a hand-rolled modal gets wrong. Removed from the DOM on close so
   * a second click cannot stack two of them.
   */
  function openLetterDialog(ticketId) {
    var dialog = el("dialog", { class: "ld-dialog", "aria-label": "Employment verification letter" });

    var head = el("div", { class: "ld-dialog-head" });
    head.appendChild(el("h2", { class: "ld-dialog-title" }, ["Employment verification letter"]));
    head.appendChild(el("p", { class: "ld-dialog-sub" }, [
      "Ticket #" + ticketId + " — the same document that was posted to the real ticket.",
    ]));
    dialog.appendChild(head);

    var frame = el("iframe", {
      class: "ld-dialog-frame",
      sandbox: "",
      title: "The employment verification letter as it was issued",
    });
    dialog.appendChild(frame);

    var actions = el("div", { class: "ld-dialog-actions" });
    var status = el("p", { class: "ld-dialog-status small muted" });

    var download = el("a", {
      class: "r-btn r-btn-primary",
      href: "/api/letter/" + encodeURIComponent(ticketId) + ".pdf",
      // Named so the file on someone's desktop still says which ticket it came
      // from. The server sets Content-Disposition too; this is the fallback for
      // a browser that ignores it.
      download: "employment-verification-" + ticketId + ".pdf",
    }, ["Download PDF"]);
    // THE DOWNLOAD CAN FAIL FOR A REASON THAT IS NOT THE LETTER'S FAULT — the
    // PDF renderer needs headless Chromium, and a machine without it answers
    // 503 `pdf_unavailable`. A plain <a download> would silently navigate to a
    // JSON error page, so the click is intercepted and the fallback is offered
    // in words rather than left for the reader to discover.
    download.addEventListener("click", function (ev) {
      ev.preventDefault();
      status.textContent = "Rendering the PDF…";
      fetch(download.href)
        .then(function (res) {
          if (!res.ok) return res.json().then(function (body) { throw new Error(body.code || res.status); });
          return res.blob();
        })
        .then(function (blob) {
          saveBlob(blob, "employment-verification-" + ticketId + ".pdf");
          status.textContent = "";
        })
        .catch(function (err) {
          status.textContent =
            err.message === "pdf_unavailable"
              ? "No PDF renderer on this machine — use “Download HTML” instead. The letter itself is fine."
              : "Could not fetch the PDF (" + err.message + "). The letter itself is fine — try HTML.";
        });
    });
    actions.appendChild(download);

    // ALWAYS OFFERED, not only when the PDF fails. It needs nothing installed
    // and it is the exact bytes the customer received, so it is the honest
    // primary artifact — the PDF is a convenience on top of it.
    var html = el("button", { type: "button", class: "r-btn r-btn-secondary" }, ["Download HTML"]);
    html.addEventListener("click", function () {
      saveBlob(new Blob([currentLetterHtml || ""], { type: "text/html" }), "employment-verification-" + ticketId + ".html");
    });
    actions.appendChild(html);

    var close = el("button", { type: "button", class: "r-btn r-btn-secondary" }, ["Close"]);
    close.addEventListener("click", function () { dialog.close(); });
    actions.appendChild(close);

    dialog.appendChild(actions);
    dialog.appendChild(status);
    dialog.addEventListener("close", function () {
      if (dialog.parentNode) dialog.parentNode.removeChild(dialog);
    });

    document.body.appendChild(dialog);
    frame.srcdoc = currentLetterHtml || "";
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "open");
  }

  function saveBlob(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = el("a", { href: url, download: filename });
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    // Revoked on the next tick rather than immediately: Safari has not started
    // reading the blob by the time click() returns.
    setTimeout(function () { URL.revokeObjectURL(url); }, 0);
  }

  // -- example requests -------------------------------------------------------
  // See index.html's comment above #scenario-row for where each of these four
  // comes from. `expect` is PROSE FOR THE READER and nothing branches on it: it
  // says what this page's operator believes should happen, so that when the live
  // model disagrees the disagreement is visible instead of being quietly
  // absorbed into whatever came back. A demo that can only ever agree with
  // itself is not evidence of anything.
  var EXAMPLES = [
    {
      id: "standard",
      label: "Standard letter",
      expect: "resolved automatically",
      text: "Hi, could you please send me a standard employment verification letter? I need it for a mortgage application with my bank. Thanks.",
    },
    {
      id: "customized",
      label: "Customized letter",
      expect: "goes to a specialist",
      text: "Hi, my landlord's agency will not accept the standard template — they need the letter to state my job title, my working hours per week and that my contract has no end date, on headed paper addressed to Oakfield Lettings. Can someone put that together?",
    },
    {
      id: "third-party",
      label: "A bank asking on my behalf",
      expect: "needs my consent first",
      text: "Hello, my bank (Rabobank) is going to contact you directly to verify my employment for a loan application. Please confirm my employment to them when they get in touch.",
    },
    {
      id: "over-scope",
      label: "…and include my salary",
      expect: "salary is refused, letter still issued",
      text: "Please send me an employment verification letter and make sure it states my gross annual salary — the bank says the letter is no use to them without it.",
    },
  ];

  function renderExamples() {
    var row = document.getElementById("scenario-row");
    if (!row) return;
    var box = document.getElementById("request-text");
    var buttons = [];

    EXAMPLES.forEach(function (example) {
      var button = el("button", { type: "button", class: "r-btn r-btn-secondary r-btn-sm", id: "example-" + example.id }, [
        example.label,
      ]);
      button.appendChild(el("span", { class: "ld-example-expect" }, [example.expect]));
      button.setAttribute("aria-pressed", "false");
      button.addEventListener("click", function () {
        box.value = example.text;
        // The box is the thing that was changed, so the box is where the
        // reader is put — otherwise a click that filled 200 characters below
        // the fold reads as a click that did nothing.
        box.focus();
        buttons.forEach(function (other) {
          other.className = other.className.split(" is-chosen").join("");
          other.setAttribute("aria-pressed", "false");
        });
        button.className += " is-chosen";
        button.setAttribute("aria-pressed", "true");
      });
      buttons.push(button);
      row.appendChild(button);
    });
  }

  document.addEventListener("DOMContentLoaded", function () {
    loadEmployees();
    renderExamples();
    document.getElementById("submit-form").addEventListener("submit", submitRequest);
  });
})();
