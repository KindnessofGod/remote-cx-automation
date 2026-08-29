#!/usr/bin/env node
// ---------------------------------------------------------------------------
// setup-zendesk-trigger.mjs  —  ONE-TIME setup: wire the real Zendesk account
// to the already-live n8n UC-01 workflow.
// ---------------------------------------------------------------------------
// Run this LOCALLY, where your real .env lives (this session has no Zendesk
// credentials and cannot run it). It creates:
//   1. A webhook target pointing at the n8n production webhook URL.
//   2. A trigger scoped NARROWLY to test tickets only — it fires when a
//      ticket is new, carries the tag below, AND has the Remote Employment
//      ID custom field set. It deliberately does NOT match "all new
//      tickets" while this is being validated; widen it later once proven.
//
// Requires in .env: ZENDESK_SUBDOMAIN, ZENDESK_OAUTH_CLIENT_ID,
// ZENDESK_OAUTH_CLIENT_SECRET, ZENDESK_EMPLOYMENT_ID_FIELD_ID.
//
// KNOWN RISK, READ BEFORE RUNNING: the trigger's webhook action builds its
// JSON body from Zendesk placeholders (e.g. {{ticket.description}}). Zendesk
// documents that placeholders are safely JSON-escaped when a webhook's
// request_format is "json", but this script can't verify that live from
// this environment. Before tagging a real ticket, use Zendesk Admin Center's
// "Test webhook" feature (Objects and rules -> Webhooks -> this webhook ->
// Test) to send a sample event and confirm n8n receives valid, well-formed
// JSON (check the execution in n8n) — do this once before trusting it.
//
// Usage: node scripts/setup-zendesk-trigger.mjs
// ---------------------------------------------------------------------------

import "dotenv/config";

const TEST_TAG = "uc01_test";
const N8N_WEBHOOK_URL =
  "https://n8n.your-host.example/webhook/00000000-0000-4000-8000-00000000n8n0/uc-01-verification";

const { ZENDESK_SUBDOMAIN, ZENDESK_OAUTH_CLIENT_ID, ZENDESK_OAUTH_CLIENT_SECRET, ZENDESK_EMPLOYMENT_ID_FIELD_ID } =
  process.env;

for (const [name, value] of Object.entries({
  ZENDESK_SUBDOMAIN,
  ZENDESK_OAUTH_CLIENT_ID,
  ZENDESK_OAUTH_CLIENT_SECRET,
  ZENDESK_EMPLOYMENT_ID_FIELD_ID,
})) {
  if (!value) {
    console.error(`Missing ${name} in .env — see .env.example.`);
    process.exit(1);
  }
}

const baseUrl = `https://${ZENDESK_SUBDOMAIN}.zendesk.com`;

async function getAccessToken() {
  const res = await fetch(`${baseUrl}/oauth/tokens`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      grant_type: "client_credentials",
      client_id: ZENDESK_OAUTH_CLIENT_ID,
      client_secret: ZENDESK_OAUTH_CLIENT_SECRET,
      // Broad scope on purpose: webhook/trigger management needs more than
      // the app's routine "tickets:read tickets:write" (see restClient.js).
      scope: "read write",
    }),
  });
  if (!res.ok) {
    throw new Error(
      `OAuth token request failed: ${res.status} ${await res.text()}. If "unauthorized_client", ` +
        "your OAuth client may need the read/write scope added, or is registered as Public instead of Confidential."
    );
  }
  return (await res.json()).access_token;
}

async function api(token, method, path, body) {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const parsed = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(`${method} ${path} failed: ${res.status} ${text}`);
  return parsed;
}

const token = await getAccessToken();
console.log("Authenticated against " + baseUrl);

console.log(`Creating webhook -> ${N8N_WEBHOOK_URL}`);
const { webhook } = await api(token, "POST", "/api/v2/webhooks", {
  webhook: {
    name: "UC-01 n8n verification (test-scoped)",
    status: "active",
    endpoint: N8N_WEBHOOK_URL,
    http_method: "POST",
    request_format: "json",
    subscriptions: ["conditional_ticket_events"],
  },
});
console.log(`  created webhook ${webhook.id}`);

// Body shape must match what src/zendesk/normalizeTicket.js / the n8n
// "Normalize Ticket" node expects: { ticket: { id, subject, description,
// attachments, custom_fields: [{id, value}], requester: { email } } }.
const webhookBody = JSON.stringify({
  ticket: {
    id: "{{ticket.id}}",
    subject: "{{ticket.title}}",
    description: "{{ticket.description}}",
    attachments: [],
    custom_fields: [{ id: Number(ZENDESK_EMPLOYMENT_ID_FIELD_ID), value: `{{ticket.ticket_field_${ZENDESK_EMPLOYMENT_ID_FIELD_ID}}}` }],
    requester: { email: "{{ticket.requester.email}}" },
  },
});

console.log(`Creating trigger scoped to tag "${TEST_TAG}"...`);
const { trigger } = await api(token, "POST", "/api/v2/triggers", {
  trigger: {
    title: "UC-01 verification — test-tagged tickets only",
    conditions: {
      all: [
        { field: "status", operator: "is", value: "new" },
        { field: "current_tags", operator: "includes", value: TEST_TAG },
        { field: `custom_fields_${ZENDESK_EMPLOYMENT_ID_FIELD_ID}`, operator: "present", value: null },
      ],
      any: [],
    },
    actions: [{ field: "notification_webhook", value: [webhook.id, webhookBody] }],
  },
});
console.log(`  created trigger ${trigger.id}`);

console.log("\nReading both back to confirm...");
const check1 = await api(token, "GET", `/api/v2/webhooks/${webhook.id}`);
const check2 = await api(token, "GET", `/api/v2/triggers/${trigger.id}`);
console.log(`  webhook ${check1.webhook.id}: status=${check1.webhook.status}`);
console.log(`  trigger ${check2.trigger.id}: active=${check2.trigger.active}`);

console.log(
  `\nDone. Before using a real ticket: Admin Center -> Objects and rules -> Webhooks -> ` +
    `"${webhook.name}" -> Test, and confirm n8n's execution log shows a well-formed payload.\n` +
    `Then: tag a real test ticket "${TEST_TAG}" with the Remote Employment ID field set and leave its ` +
    `status as New — it will fire once. It stops matching once the status changes away from New, so it ` +
    "won't re-fire on the workflow's own follow-up update."
);
