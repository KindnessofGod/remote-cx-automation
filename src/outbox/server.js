// ---------------------------------------------------------------------------
// src/outbox/server.js — WHAT THE CUSTOMER ACTUALLY RECEIVED
// ---------------------------------------------------------------------------
// Read-only, in the UC-08 structural sense: THERE IS NO POST ROUTE IN THIS
// FILE. It sends nothing, changes nothing, and cannot.
//
// WHY IT EXISTS. Auto-resolved verification letters are posted as public replies
// to `owner+employee-eor-usa-10001@rempel-paucek-4c3wac.example.com`.
// `.example.com` is a RESERVED domain — nothing sent there is delivered
// anywhere, ever. So the happy path's customer-facing half has been asserted
// (the reply exists on the ticket, the HTML is well formed, the tests pass) and
// never once READ BY A PERSON.
//
// MEASURED against the live `your-subdomain` desk, 2026-08-23 (rca-a4yw): 108
// tickets, of which 15 carry `uc01_auto_resolved` — #78 #81 #87 #93 #95 #97
// #113 #120 #121 #122 #123 #124 #125 #127 #128 — and ALL FIFTEEN are addressed
// to that one reserved address. The figure this file first carried was SEVEN;
// it was never measured, and it was a little under half the real number.
//
// The owner found it from the outside, which is the part worth keeping: the
// only mail this system had ever delivered to a real inbox was third-party
// refusals and escalations, because those were the only ones addressed to a
// real person. It looked like the system only did refusals. It did not — it
// only ever DELIVERED refusals.
//
// Every verification check in this project looked at the TICKET. None looked at
// the INBOX. This page is the inbox.
// ---------------------------------------------------------------------------

import { createServer } from "node:http";
import { PORTS } from "../shared/ports.js";

// RFC 2606 reserved names. Matched as a DOMAIN SUFFIX, not immediately after
// the `@` — the first version required `@example.com` and therefore passed
// `owner+employee-eor-usa-10001@rempel-paucek-4c3wac.example.com` as
// DELIVERABLE. That is the exact address this page was built to flag, and the
// page said it was fine. A detector that misses the one case that motivated it
// is worse than none, and this project has now made that mistake five times.
const RESERVED = /(^|[.@])(example\.(com|org|net)|test|invalid|localhost)$/i;
export const isUndeliverable = (email) => (email ? RESERVED.test(String(email).split("@").pop()) : true);

/**
 * Public comments this system posted, newest first, with the recipient.
 *
 * `get` is injected rather than reaching past ZendeskClient's private
 * `#request`. That class deliberately exposes eight methods and none of them
 * is "fetch an arbitrary path" — which is the same discipline UC-08's store
 * uses to make its no-write guarantee structural. Widening it so a read-only
 * page could borrow it would trade a real guarantee for a convenience.
 */
export async function collectOutbox(get, { limit = 60 } = {}) {
  const search = await get(
    `/api/v2/search.json?query=${encodeURIComponent("type:ticket order_by:created_at sort:desc")}&per_page=${limit}`
  );
  const roles = new Map(); // author_id -> role, one lookup per distinct author
  const roleOf = async (id) => {
    if (!roles.has(id)) {
      let role = "system"; // Zendesk uses -1 for its own automations; that id 400s
      try { role = (await get(`/api/v2/users/${id}.json`)).user?.role ?? "system"; } catch { /* system */ }
      roles.set(id, role);
    }
    return roles.get(id);
  };

  const out = [];
  for (const t of (search.results ?? []).slice(0, limit)) {
    let requester = null;
    try { requester = (await get(`/api/v2/users/${t.requester_id}.json`)).user; } catch { /* shown as unknown */ }
    if (requester) roles.set(requester.id, requester.role);
    let comments = [];
    try { comments = (await get(`/api/v2/tickets/${t.id}/comments.json`)).comments ?? []; } catch { /* shown as unreadable */ }

    // Only what the DESK said, and only publicly. An internal note never left
    // the building, and the requester's own message is not something we sent.
    //
    // Discriminated by the author's ROLE, not by `author_id !== requester_id`.
    // That inequality was the first version and it silently dropped the only
    // genuinely-delivered letters on the desk: on a third-party-door ticket the
    // requester IS the admin who submitted it (#108, #114 — both to a real
    // gmail inbox), so our own reply compared equal to the requester and
    // vanished. The page then showed 123 undeliverable and 6 "deliverable",
    // with every real delivery hidden — indistinguishable from a detector that
    // simply flags everything. Second near-miss of that exact shape in this
    // one file; see the RESERVED regex above for the first.
    const outbound = [];
    for (const c of comments) {
      if (!c.public) continue;
      if (await roleOf(c.author_id) === "end-user") continue; // inbound
      outbound.push(c);
    }

    // Zendesk's OWN verdict, and it outranks ours: it stamps this tag on a
    // ticket when the notification to the requester failed to deliver. An
    // address can be perfectly well-formed, on no reserved list, and still
    // bounce — `usa-demo-employee-monthly-12@rempel-paucek-4c3wac.com` does,
    // on #83/#101/#112. Reading the address alone called those DELIVERED.
    const bounced = (t.tags ?? []).includes("system_email_notification_failure");

    for (const c of outbound) {
      const email = requester?.email ?? null;
      const reserved = isUndeliverable(email);
      out.push({
        ticket: t.id,
        subject: t.subject,
        status: t.status,
        tags: t.tags ?? [],
        to: email,
        toName: requester?.name ?? null,
        reserved,
        bounced,
        // THE POINT OF THE PAGE. A reserved domain means this message was
        // composed, posted, marked delivered by every check we have — and
        // arrived nowhere.
        deliverable: !reserved && !bounced,
        at: c.created_at,
        html: c.html_body ?? null,
        text: c.plain_body ?? "",
      });
    }
  }
  return out.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
}

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

export function renderOutbox(items) {
  const undeliverable = items.filter((i) => !i.deliverable).length;
  const rows = items.map((i) => `
    <article class="msg ${i.deliverable ? "ok" : "void"}">
      <header>
        <span class="pill">${i.deliverable ? "DELIVERED" : "WENT NOWHERE"}</span>
        <b>#${i.ticket}</b> ${esc(i.subject)}
        <span class="to">to ${esc(i.to ?? "unknown")}${i.toName ? " · " + esc(i.toName) : ""}</span>
        <span class="at">${esc(i.at)}</span>
      </header>
      ${i.deliverable ? "" : `<p class="why">${i.reserved
        ? `This address is on a RESERVED domain. The message was composed, posted to the ticket and
           passed every check this project has — and arrived in no inbox.`
        : `Zendesk stamped this ticket <code>system_email_notification_failure</code>: the address is not
           reserved and looks fine, and the notification to it still failed. The desk's own verdict, not ours.`}</p>`}
      <div class="body">${i.html ?? "<pre>" + esc(i.text) + "</pre>"}</div>
    </article>`).join("\n");

  return `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Outbox — what the customer received</title>
<style>
:root{color-scheme:dark}body{margin:0;background:#0a0c11;color:#e8eaf0;font:15px/1.5 ui-sans-serif,system-ui,sans-serif}
header.top{padding:14px;background:#111520;border-bottom:1px solid #212734}
h1{margin:0;font-size:17px}.sub{color:#8b94a6;font-size:13px;margin-top:4px}
main{max-width:900px;margin:0 auto;padding:12px}
.msg{border:1px solid #232b3a;border-radius:10px;margin-bottom:12px;overflow:hidden;background:#121722}
.msg.void{border-color:#6a2626}
.msg header{display:flex;flex-wrap:wrap;gap:8px;align-items:baseline;padding:9px 12px;background:#151b28;font-size:13px}
.pill{font-size:10px;font-weight:800;letter-spacing:.06em;padding:2px 8px;border-radius:99px;background:#10331e;color:#79dfa0}
.msg.void .pill{background:#3a1616;color:#ff9d9d}
.to{color:#8ab6ff}.at{margin-left:auto;color:#6f7889;font-size:11px}
.why{margin:0;padding:9px 12px;background:#2a1414;color:#ffb3b3;font-size:12.5px;border-bottom:1px solid #3a1f1f}
.body{padding:12px;background:#fff;color:#111}
.body table{border-collapse:collapse}.body td,.body th{border:1px solid #ccc;padding:4px 8px}
pre{white-space:pre-wrap;font:13px ui-monospace,monospace}
</style></head><body>
<header class="top"><h1>Outbox — what the customer actually received</h1>
<div class="sub">${items.length} public message(s) this desk sent.
<b style="color:#ff9d9d">${undeliverable} went nowhere</b>
(${items.filter((i) => i.reserved).length} to a reserved domain,
${items.filter((i) => !i.reserved && i.bounced).length} that Zendesk itself recorded as failing).
<b style="color:#79dfa0">${items.length - undeliverable} arrived</b> — the positive control: a page that
flagged everything would look exactly like a working one.
Every check in this project looks at the ticket; this page looks at the inbox.</div></header>
<main>${rows || "<p>No outbound messages found.</p>"}</main></body></html>`;
}

export function createOutboxServer({ get }) {
  return createServer(async (req, res) => {
    if (req.method !== "GET") { res.writeHead(405).end("read-only"); return; }
    try {
      const items = await collectOutbox(get);
      const body = req.url.startsWith("/api")
        ? JSON.stringify({ items, undeliverable: items.filter((i) => !i.deliverable).length }, null, 1)
        : renderOutbox(items);
      res.writeHead(200, { "content-type": req.url.startsWith("/api") ? "application/json" : "text/html; charset=utf-8" });
      res.end(body);
    } catch (err) {
      // Reads that feed a display THROW, per this project's convention: a wrong
      // number gets acted on, a missing one gets investigated.
      res.writeHead(502, { "content-type": "text/plain" }).end(`outbox unreadable: ${err.message}`);
    }
  });
}

export const OUTBOX_PORT = PORTS.OUTBOX;
