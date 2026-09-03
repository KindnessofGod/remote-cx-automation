// ---------------------------------------------------------------------------
// app.js  —  The approval queue's client (plain browser JS, no build step)
// ---------------------------------------------------------------------------
// WHAT THIS FILE IS ALLOWED TO DO
// Fetch the two GET routes src/approvalqueue/server.js serves and render what
// came back. That is all.
//
// WHAT IT DELIBERATELY DOES NOT DO
//   1. It re-derives no verdict. Whether an item is waiting, whether its ticket
//      is real, whether its queue is the right one, and whether it is stuck are
//      all the server's answers; this file prints the words it was sent. The
//      one thing it maps locally is a category name to a colour, and the words
//      always render beside the colour so colour is never the sole carrier.
//   2. It never writes markup. Every dynamic value goes through textContent —
//      these rows carry requester names and free text people typed.
//   3. It renders no control that could approve anything, not even a disabled
//      one. There is nothing to POST to; the server has no POST route.
//   4. It holds no rule about access. The key prompt renders the server's own
//      refusal body, exactly like the portal's and the audit viewer's.
//   5. It never turns an unknown into a zero. "Cannot tell" is its own tile and
//      its own badge everywhere it appears, and an empty stuck list prints why
//      it is empty rather than just being empty.
// ---------------------------------------------------------------------------

(function () {
  "use strict";

  // Presentation only — the label always renders beside the dot.
  var CATEGORY_TONE = {
    no_ticket: "danger",
    ticket_missing: "danger",
    no_approval_surface: "danger",
    queue_owner_absent: "warn",
    queued_elsewhere: "warn",
    unqueued: "warn",
  };

  var TIER_CLASS = { low: "r-tier-low", medium: "r-tier-medium", high: "r-tier-high" };

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

  // -- access key (the portal's mechanism, same header) ----------------------

  var KEY_STORAGE = "approvalqueue.accessKey";
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

  function api(path) {
    var headers = {};
    var key = storedKey();
    if (key) headers[KEY_HEADER] = key;
    return fetch(path, { method: "GET", headers: headers });
  }

  function showAccessGate(payload) {
    var configured = payload.code !== "portal_access_key_not_configured";
    byId("access-reason").textContent = payload.reason || "This view requires an access key.";
    byId("access-why").textContent = payload.why || "";
    var howto = byId("access-howto");
    clear(howto);
    (payload.howToFix || []).forEach(function (step) {
      howto.appendChild(el("li", "", String(step)));
    });
    byId("access-form").hidden = !configured;
    byId("access-gate").hidden = false;
    byId("views").hidden = true;
    if (configured) byId("access-key").focus();
  }

  function showError(title, detail) {
    byId("error-title").textContent = title;
    byId("error-detail").textContent = detail || "";
    byId("error-banner").hidden = false;
  }
  function clearError() {
    byId("error-banner").hidden = true;
  }

  /** Unwrap one response. 401 → the gate; anything else failing → the banner. */
  function unwrap(res) {
    if (res.status === 401) {
      return res.json().then(function (payload) {
        forgetKey();
        showAccessGate(payload || {});
        throw new Error("handled");
      });
    }
    return res.json().then(function (payload) {
      if (!res.ok || payload.ok === false) {
        showError(payload.code || "Read failed", payload.reason || "");
        throw new Error("handled");
      }
      byId("access-gate").hidden = true;
      byId("views").hidden = false;
      clearError();
      return payload;
    });
  }

  // -- rendering -------------------------------------------------------------

  /** One item, as a card. The same card serves both list views. */
  function itemCard(item) {
    var card = el("div", "r-card item-card");
    var head = el("div", "r-card-head item-head");

    var left = el("div", "item-ident");
    var tier = el("span", "r-tier " + (TIER_CLASS[item.tier] || ""), item.useCase);
    left.appendChild(tier);
    left.appendChild(el("span", "item-decision", item.decision || "no decision recorded"));
    if (item.reason) left.appendChild(el("span", "r-muted", item.reason));
    head.appendChild(left);

    var right = el("div", "item-age");
    right.appendChild(el("span", "r-label", "Waiting"));
    right.appendChild(el("strong", "", item.waited.label));
    head.appendChild(right);
    card.appendChild(head);

    var body = el("div", "r-card-body");

    body.appendChild(fact("Waiting on", item.awaitingWho));
    body.appendChild(fact("Owning team", item.owningGroup || "none defined"));
    body.appendChild(fact("Reference", item.reference || "none recorded"));
    body.appendChild(ticketFact(item));

    // G-4/F3/L-19: the figure stuck.js's own explanation names ("our own
    // policy figure") — printed here, on the operator surface, rather than
    // left implicit anywhere else.
    if (item.consentAgePolicy) {
      body.appendChild(
        fact(
          "Consent age policy (ours, not Remote's)",
          item.consentAgePolicy.days + " day" + (item.consentAgePolicy.days === 1 ? "" : "s") +
            (item.consentAgePolicy.waitingLong ? " — waiting longer than this; nothing lapses or changes because of it" : " — within the window")
        )
      );
    }

    if (item.directions) body.appendChild(directionsBlock(item.directions));

    if (item.progress && item.progress.applies) body.appendChild(progressBlock(item.progress));

    var verdict = el("p", "item-why " + (item.stuckVerdict.stuck === true ? "why-bad" : item.stuckVerdict.stuck === "unknown" ? "why-unknown" : "why-ok"));
    verdict.textContent = item.stuckVerdict.why;
    body.appendChild(verdict);

    if (item.stuckVerdict.also && item.stuckVerdict.also.length) {
      body.appendChild(el("p", "r-muted item-also", "Also true of this item: " + item.stuckVerdict.also.join("; ") + "."));
    }

    card.appendChild(body);
    return card;
  }

  /**
   * WHERE TO ACT, WHAT THE VERBS ARE, WHAT YOU CANNOT DO HERE.
   *
   * The three sentences arrive composed from the server (handoffDirections.js)
   * and are printed verbatim. THE PAGE PICKS NO WORDS OF ITS OWN — the same
   * three sentences go onto the Zendesk hand-off note, and a page that phrased
   * them differently would be a second version of the one thing this block
   * exists to stop drifting. The only local decision is the class name, so
   * "there is no control and that is deliberate" and "there is no control and
   * that is a hole" do not look alike at a glance.
   */
  function directionsBlock(d) {
    var box = el("div", "directions directions-" + d.control);
    box.appendChild(fact("Where to act", d.where.replace(/^Where to act: /, "")));
    box.appendChild(fact("Your options", d.options.replace(/^Your options: /, "")));
    box.appendChild(fact("Not here", d.limits.replace(/^What you cannot do here: /, "")));
    return box;
  }

  function fact(label, value) {
    var row = el("div", "fact");
    row.appendChild(el("span", "r-label", label));
    row.appendChild(el("span", "fact-value", value));
    return row;
  }

  /**
   * The ticket line. A LINK IS RENDERED ONLY FOR A CONFIRMED TICKET — the
   * server sends a url for that state and null for every other, so an
   * unverified or missing ticket cannot become a link that 404s.
   */
  function ticketFact(item) {
    var row = el("div", "fact");
    row.appendChild(el("span", "r-label", "Where it is actioned"));
    var value = el("span", "fact-value");

    var badge = el("span", "r-badge ticket-" + item.ticket.state, ticketWord(item.ticket.state));
    value.appendChild(badge);

    if (item.ticket.state === "confirmed" && item.ticket.url) {
      var link = el("a", "ticket-link", "ticket #" + item.ticket.ticketId);
      link.href = item.ticket.url;
      link.target = "_blank";
      link.rel = "noreferrer noopener";
      value.appendChild(link);
    } else if (item.ticket.ticketId) {
      value.appendChild(el("span", "", "#" + item.ticket.ticketId));
    }

    value.appendChild(el("span", "ticket-detail", item.ticket.headline));
    value.appendChild(el("span", "r-muted ticket-detail", item.ticket.detail));
    value.appendChild(el("span", "r-muted ticket-detail", item.ticket.group.detail));
    row.appendChild(value);
    return row;
  }

  function ticketWord(state) {
    if (state === "confirmed") return "ticket confirmed";
    if (state === "not_found") return "no such ticket";
    if (state === "unverified") return "not checked";
    // NOT "no ticket": there is one, and it is in a Zendesk account this view
    // is not reading. Saying "no ticket" would describe a hand-off that never
    // happened, when what actually happened is that the account was migrated
    // out from under the reference (honest-gaps item 23).
    if (state === "foreign_account") return "other Zendesk account";
    return "no ticket";
  }

  /** UC-06's two slots and UC-09's floor of two, as filled/outstanding. */
  function progressBlock(progress) {
    var box = el("div", "progress");
    box.appendChild(el("span", "r-label", "Signatures: " + progress.filled + " of " + progress.required));
    var list = el("div", "r-approval-slots");
    progress.slots.forEach(function (slot) {
      var s = el("div", "r-approval-slot " + (slot.filled ? "is-filled" : "is-open"));
      s.appendChild(el("strong", "", slot.label));
      s.appendChild(el("span", "", slot.filled ? "signed by " + slot.by : "outstanding"));
      list.appendChild(s);
    });
    box.appendChild(list);
    box.appendChild(el("p", "r-muted", progress.note));
    if (progress.barred.length) {
      box.appendChild(
        el(
          "p",
          "r-muted",
          "Already signed, so may not fill another slot on this record: " + progress.barred.join(", ") + "."
        )
      );
    }
    return box;
  }

  function renderStuck(queue) {
    var host = byId("stuck-groups");
    clear(host);

    var groups = queue.summary.byCategory;
    byId("stuck-empty").hidden = groups.length > 0;
    if (!groups.length) {
      byId("stuck-empty-body").textContent =
        queue.summary.unknown > 0
          ? "Nothing that this view could check is stuck. " +
            queue.summary.unknown +
            " item(s) could not be checked at all, so they are not counted as reachable either — see the “Cannot tell” tile."
          : "Every item waiting on a person has a real ticket, in the queue of the team that owns it, with a control to act on it.";
    }

    groups.forEach(function (group) {
      var section = el("section", "stuck-group");
      var head = el("div", "r-section-head");
      var title = el("h2", "r-section-title", group.label);
      head.appendChild(title);
      head.appendChild(el("span", "r-counter tone-" + (CATEGORY_TONE[group.category] || "warn"), String(group.count)));
      section.appendChild(head);
      queue.stuck
        .filter(function (i) {
          return i.stuckVerdict.category === group.category;
        })
        .forEach(function (item) {
          section.appendChild(itemCard(item));
        });
      host.appendChild(section);
    });

    if (queue.unknown.length) {
      var section = el("section", "stuck-group");
      var head = el("div", "r-section-head");
      head.appendChild(el("h2", "r-section-title", "Could not be checked"));
      head.appendChild(el("span", "r-counter tone-unknown", String(queue.unknown.length)));
      section.appendChild(head);
      section.appendChild(
        el(
          "p",
          "r-page-sub",
          "These are waiting on a person and this view could not establish whether anyone can reach them. " +
            "They are not on the stuck list and they are not counted as reachable."
        )
      );
      queue.unknown.forEach(function (item) {
        section.appendChild(itemCard(item));
      });
      host.appendChild(section);
    }
  }

  function renderWaiting(queue) {
    var host = byId("waiting-rows");
    clear(host);
    byId("waiting-empty").hidden = queue.items.length > 0;
    queue.items.forEach(function (item) {
      host.appendChild(itemCard(item));
    });
  }

  function renderUseCases(queue) {
    var host = byId("usecase-table");
    clear(host);
    var wrap = el("div", "r-table-wrap");
    var table = el("table", "r-table");
    var head = el("thead");
    var hrow = el("tr");
    ["Use case", "Tier", "Waiting", "Nobody can act", "Cannot tell", "Decided", "Approval control"].forEach(function (h) {
      hrow.appendChild(el("th", "", h));
    });
    head.appendChild(hrow);
    table.appendChild(head);

    var body = el("tbody");
    queue.byUseCase.forEach(function (row) {
      var tr = el("tr");
      tr.appendChild(el("td", "", row.useCase));
      tr.appendChild(el("td", "", row.tier || "—"));
      tr.appendChild(el("td", "", String(row.waiting)));
      tr.appendChild(el("td", row.stuck ? "cell-bad" : "", String(row.stuck)));
      tr.appendChild(el("td", row.unknown ? "cell-unknown" : "", String(row.unknown)));
      tr.appendChild(el("td", "", String(row.settled)));
      tr.appendChild(el("td", "", controlWord(row.control)));
      body.appendChild(tr);
    });
    table.appendChild(body);
    wrap.appendChild(table);
    host.appendChild(wrap);
  }

  function controlWord(control) {
    if (control === "exists") return "yes — in the sidebar";
    if (control === "none_by_design") return "none, by design";
    if (control === "none_missing") return "none, and one is needed";
    return "not known to this view";
  }

  /**
   * The teams block. Unprovisioned first — the server sorts it that way, and
   * this file preserves the order it was given rather than re-sorting, so the
   * page and the API can never disagree about what is worst.
   *
   * The account-level verdict is printed above the table, in the server's own
   * words, and it is printed in every state — including "all provisioned".
   * A block that only ever appears when something is wrong reads as absent when
   * the check did not run, and the two must not look alike.
   */
  function renderTeams(meta) {
    var host = byId("team-table");
    clear(host);
    var summary = meta.teamProvisioning;
    if (summary) {
      var note = el("p", summary.state === "all_provisioned" ? "team-verdict team-verdict-ok" : "team-verdict team-verdict-bad");
      note.textContent = summary.headline;
      host.appendChild(note);
    }
    var wrap = el("div", "r-table-wrap");
    var table = el("table", "r-table");
    var head = el("thead");
    var hrow = el("tr");
    ["Team", "Has a queue", "Routed from", "What that means"].forEach(function (h) {
      hrow.appendChild(el("th", "", h));
    });
    head.appendChild(hrow);
    table.appendChild(head);
    var body = el("tbody");
    (meta.teams || []).forEach(function (team) {
      var tr = el("tr");
      tr.appendChild(el("td", "", team.name));
      tr.appendChild(el("td", team.provisioned ? "" : "cell-bad", team.provisioned ? "yes" : "NO"));
      tr.appendChild(el("td", "", team.useCases.join(", ")));
      tr.appendChild(el("td", "", team.detail));
      body.appendChild(tr);
    });
    table.appendChild(body);
    wrap.appendChild(table);
    host.appendChild(wrap);
  }

  function renderSurfaces(meta) {
    var host = byId("surface-cards");
    clear(host);
    meta.routes.forEach(function (route) {
      var card = el("div", "r-card surface-card");
      var head = el("div", "r-card-head");
      var left = el("div", "item-ident");
      left.appendChild(el("span", "r-tier " + (TIER_CLASS[route.tier] || ""), route.useCase));
      left.appendChild(el("span", "item-decision", controlWord(route.control)));
      head.appendChild(left);
      card.appendChild(head);

      var body = el("div", "r-card-body");
      body.appendChild(fact("Screen", route.surface || "none"));
      body.appendChild(fact("Recorded by", route.endpoint || "no route exists"));
      body.appendChild(
        fact(
          "Signatures needed",
          route.slotsRequired === null ? "none — no approval is taken here" : String(route.slotsRequired)
        )
      );
      if (route.roles.length) {
        body.appendChild(
          fact(
            "Named roles",
            route.roles
              .map(function (r) {
                return r.label;
              })
              .join(", ")
          )
        );
      }
      body.appendChild(el("p", "item-why " + (route.control === "none_missing" ? "why-bad" : "why-ok"), route.note));
      card.appendChild(body);
      host.appendChild(card);
    });
  }

  // -- tabs ------------------------------------------------------------------

  var TABS = ["stuck", "waiting", "usecases", "surfaces"];

  function showTab(name) {
    TABS.forEach(function (tab) {
      byId("tab-" + tab).hidden = tab !== name;
      byId("nav-" + tab).classList.toggle("is-active", tab === name);
    });
  }

  // -- boot ------------------------------------------------------------------

  function load() {
    return api("api/meta")
      .then(unwrap)
      .then(function (meta) {
        byId("mode-line").textContent = modeWord(meta.mode);
        byId("verify-line").textContent = meta.verification.detail;
        byId("seeded-banner").hidden = meta.mode !== "seeded";
        renderSurfaces(meta);
        renderTeams(meta);
        return api("api/queue").then(unwrap);
      })
      .then(function (queue) {
        // Re-stated from the QUEUE payload, overriding the line /api/meta set
        // above. Meta is served before any ticket lookup has run, so it can
        // only say what the checker is capable of; this one says what this
        // refresh actually managed — including "N of M ids were NOT checked"
        // when the budget ran out. A truncated read must not look like a
        // complete one.
        if (queue.verification && queue.verification.detail) {
          byId("verify-line").textContent = queue.verification.detail;
        }
        byId("tile-waiting").textContent = String(queue.summary.total);
        byId("tile-waiting-note").textContent =
          "out of " + queue.counts.recordsRead + " records read across all nine use cases";
        byId("tile-stuck").textContent = String(queue.summary.stuck);
        byId("tile-unknown").textContent = String(queue.summary.unknown);
        byId("tile-reachable").textContent = String(queue.summary.reachable);
        byId("count-stuck").textContent = String(queue.summary.stuck);
        byId("count-waiting").textContent = String(queue.summary.total);
        renderStuck(queue);
        renderWaiting(queue);
        renderUseCases(queue);
      })
      .catch(function (err) {
        if (err && err.message === "handled") return;
        showError("Could not load the queue", err ? err.message : "");
      });
  }

  function modeWord(mode) {
    if (mode === "supabase") return "Real reads from Supabase.";
    if (mode === "seeded") return "Demonstration rows — nothing here is real work.";
    return "No store attached.";
  }

  document.addEventListener("DOMContentLoaded", function () {
    TABS.forEach(function (tab) {
      byId("nav-" + tab).addEventListener("click", function () {
        showTab(tab);
      });
    });
    byId("access-form").addEventListener("submit", function (event) {
      event.preventDefault();
      rememberKey(byId("access-key").value.trim());
      load();
    });
    load();
  });
})();
