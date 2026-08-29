/* ---------------------------------------------------------------------------
 * app.js  —  UC-01 chat demo front end
 * ---------------------------------------------------------------------------
 * Plain browser JS, no build step, no framework — matches the repo's "clone
 * and run in one command" convention (same style as zaf-app/assets/main.js).
 *
 * Same non-negotiable as the ZAF sidebar and the playground: this file
 * DECIDES NOTHING. Every message it sends is handed to the server, which
 * calls handleVerificationTicket() on it, and everything this page renders
 * is read straight back off that response — the decision string, the reason,
 * the flags, the letter. There is no `=== "auto_resolve"` / `=== "human_review"`
 * anywhere in here, because a second copy of the policy in the browser is the
 * exact bug the rest of BUILD-LOG.md's gotchas exist to warn against. And
 * every dynamic value is written with textContent, never innerHTML, because
 * ticket text is untrusted input.
 * ------------------------------------------------------------------------- */

(function () {
  "use strict";

  // -- decision -> tone: the ONE place this surface maps a server string ------
  //
  // A chat reply carries a DECISION, not a lifecycle state — there is no
  // pending/resolved/escalated column here, only what handleVerificationTicket()
  // decided about this one message. So the shared `.r-badge-decision` component
  // is the right one rather than `.r-status`: it paints the ALREADY-VALIDATED
  // categorical palette (auto / human / escalate) that the metrics dashboard and
  // every other surface use for these same three concepts. Re-tinting them as
  // ok/warn/danger would make this page disagree with the dashboard about what
  // "escalate" looks like.
  //
  // This table is presentation only: it turns a decision string the server
  // produced into a dot colour and a readable label. It never invents, overrides
  // or recomputes a decision. Anything unrecognised gets the neutral badge and
  // keeps its RAW string as the word — never a guessed tone.
  var DECISION_TONES = {
    auto_resolve: { tone: "r-badge-auto", label: "Auto-resolved" },
    human_review: { tone: "r-badge-human", label: "Awaiting review" },
    escalate: { tone: "r-badge-escalate", label: "Escalated" },
  };

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

  function decisionBadge(decision) {
    var known = DECISION_TONES[decision];
    return el(
      "span",
      "r-badge r-badge-decision " + (known ? known.tone : ""),
      known ? known.label : String(decision)
    );
  }

  // -- rendering one exchange --------------------------------------------------

  function appendExchange(inputText, result) {
    var log = document.getElementById("chat-log");
    document.getElementById("chat-empty").style.display = "none";

    log.appendChild(el("div", "bubble user", inputText));

    var reply = el("div", "bubble assistant");
    if (result.ok === false) {
      reply.appendChild(el("p", "action-status bad", result.reason || "Something went wrong."));
      log.appendChild(reply);
      return;
    }

    if (result.decision === "out_of_scope" && result.reply) {
      reply.appendChild(el("p", "reply-text", result.reply));
    } else {
      var decisionLine = el("p", "decision-line");
      decisionLine.appendChild(el("span", "decision-caption", "Decision"));
      decisionLine.appendChild(decisionBadge(result.decision));
      reply.appendChild(decisionLine);

      // An empty reason is shown as the em dash Remote prints in an empty cell,
      // rather than a blank line that reads as "not rendered yet".
      if (result.reason) reply.appendChild(el("p", "reason", result.reason));
      else reply.appendChild(el("p", "reason r-none", "—"));

      if (result.flags && result.flags.length) {
        var flagUl = el("ul", "flags");
        result.flags.forEach(function (f) {
          flagUl.appendChild(el("li", "flag", f));
        });
        reply.appendChild(flagUl);
      }

      if (result.letterHtml) {
        var iframe = document.createElement("iframe");
        iframe.className = "letter-frame";
        // An <iframe> with no title is announced as "frame" and nothing else,
        // which on this page hides the entire deliverable behind a shrug.
        iframe.setAttribute("title", "Employment verification letter");
        iframe.setAttribute("sandbox", "");
        iframe.srcdoc = result.letterHtml;
        reply.appendChild(iframe);
      }
    }

    log.appendChild(reply);
    log.scrollTop = log.scrollHeight;
  }

  // -- sending -----------------------------------------------------------------

  function sendMessage(evt) {
    evt.preventDefault();
    var input = document.getElementById("message-input");
    var text = input.value.trim();
    if (!text) return;

    var btn = document.getElementById("send-btn");
    btn.disabled = true;

    var customAbout = document.getElementById("custom-about-id").value.trim();
    var customLoggedIn = document.getElementById("custom-logged-in-id").value.trim();
    var payload = {
      text: text,
      asEmploymentId: customLoggedIn || document.getElementById("logged-in-select").value || null,
      employmentId: customAbout || document.getElementById("about-select").value,
      hasAttachment: document.getElementById("attachment-checkbox").checked,
      consentOnRecord: document.getElementById("consent-checkbox").checked,
    };

    input.value = "";

    fetch("/api/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
      .then(function (res) {
        return res.json();
      })
      .then(function (result) {
        appendExchange(text, result);
      })
      .catch(function (err) {
        appendExchange(text, { ok: false, reason: "Could not reach the chat demo API: " + err.message });
      })
      .then(function () {
        btn.disabled = false;
        input.focus();
      });
  }

  // -- boot ---------------------------------------------------------------------

  document.addEventListener("DOMContentLoaded", function () {
    document.getElementById("message-form").addEventListener("submit", sendMessage);
    document.getElementById("message-input").focus();
  });
})();
