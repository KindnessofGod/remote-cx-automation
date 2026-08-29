#!/usr/bin/env node
// Serve the outbox. Reads live Zendesk; sends nothing, changes nothing.
//
// The reader is a plain OAuth GET rather than ZendeskClient, which exposes
// eight named methods and no arbitrary-path escape hatch. Widening that class
// so a read-only page could borrow it would trade a real structural guarantee
// for a convenience — the same reason UC-08's store has one write method.
import "dotenv/config";
import { config } from "../shared/config.js";
import { createOutboxServer, OUTBOX_PORT } from "./server.js";

const sub = config.zendesk.subdomain;
let token = null;

async function get(path) {
  if (!token) {
    const r = await fetch(`https://${sub}.zendesk.com/oauth/tokens`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      // `read write` exactly: a narrower scope 403s on /users and /search, and
      // omitting scope returns a token that 403s on everything. Both look like
      // success from outside.
      body: JSON.stringify({
        grant_type: "client_credentials", client_id: config.zendesk.oauthClientId,
        client_secret: config.zendesk.oauthClientSecret, scope: "read write",
      }),
    });
    const j = await r.json();
    if (!j.access_token) throw new Error(`no Zendesk token (${r.status})`);
    token = j.access_token;
  }
  const r = await fetch(`https://${sub}.zendesk.com${path}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) throw new Error(`${path} → HTTP ${r.status}`);
  return r.json();
}

createOutboxServer({ get }).listen(OUTBOX_PORT, () => {
  console.log(`Outbox — what the customer actually received: http://localhost:${OUTBOX_PORT}`);
  console.log("Every other check in this project reads the TICKET. This one reads the INBOX.");
});
