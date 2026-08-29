#!/usr/bin/env node
// ---------------------------------------------------------------------------
// cleanup-duplicate-zendesk-setup.mjs  —  ONE-TIME cleanup.
// ---------------------------------------------------------------------------
// setup-zendesk-trigger.mjs was accidentally run twice, creating two
// duplicate webhook+trigger pairs that would both fire on the same ticket.
// This deletes the older pair, keeping the newer one. Run locally, same
// .env as setup-zendesk-trigger.mjs.
//
// Usage: node scripts/cleanup-duplicate-zendesk-setup.mjs
// ---------------------------------------------------------------------------

import "dotenv/config";

const WEBHOOK_ID_TO_DELETE = "01KYWVA6C3TBM61QGRN0PW2BY1";
const TRIGGER_ID_TO_DELETE = "49366907565073";

const { ZENDESK_SUBDOMAIN, ZENDESK_OAUTH_CLIENT_ID, ZENDESK_OAUTH_CLIENT_SECRET } = process.env;
const baseUrl = `https://${ZENDESK_SUBDOMAIN}.zendesk.com`;

const tokenRes = await fetch(`${baseUrl}/oauth/tokens`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Accept: "application/json" },
  body: JSON.stringify({
    grant_type: "client_credentials",
    client_id: ZENDESK_OAUTH_CLIENT_ID,
    client_secret: ZENDESK_OAUTH_CLIENT_SECRET,
    scope: "read write",
  }),
});
if (!tokenRes.ok) throw new Error(`OAuth token request failed: ${tokenRes.status} ${await tokenRes.text()}`);
const { access_token } = await tokenRes.json();

async function del(path) {
  const res = await fetch(`${baseUrl}${path}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${access_token}` },
  });
  if (!res.ok && res.status !== 404) throw new Error(`DELETE ${path} failed: ${res.status} ${await res.text()}`);
  console.log(`  deleted ${path} (status ${res.status})`);
}

console.log(`Deleting duplicate trigger ${TRIGGER_ID_TO_DELETE}...`);
await del(`/api/v2/triggers/${TRIGGER_ID_TO_DELETE}`);

console.log(`Deleting duplicate webhook ${WEBHOOK_ID_TO_DELETE}...`);
await del(`/api/v2/webhooks/${WEBHOOK_ID_TO_DELETE}`);

console.log("\nDone. Remaining pair: webhook 01KYWVB0XVNPYQ30Y0K4VBB8E9 / trigger 49366915255697.");
