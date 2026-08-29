#!/usr/bin/env node
// ---------------------------------------------------------------------------
// fix-zendesk-trigger-condition.mjs  —  ONE-TIME fix.
// ---------------------------------------------------------------------------
// The original trigger required status="new" to guarantee it only fires
// once per ticket. Real test showed this account moves agent-created
// tickets straight to "Open", skipping New entirely — so the trigger never
// matched. This replaces that condition with a different single-fire guard:
// the ticket must NOT already carry one of the automation's own outcome
// tags (uc01_auto_resolved / uc01_human_review / verification_exception /
// uc01_out_of_scope_replied).
// That still prevents infinite re-firing on the workflow's own follow-up
// update, without depending on a status value this account never uses.
//
// uc01_out_of_scope_replied added by rca-qdc (F-3, 2026-08-22): the
// out_of_scope branch used to apply NO tag at all, so its own boundary
// reply (itself a ticket update) matched this same guard's "none of our
// outcome tags" clause and re-fired the trigger — an unbounded loop on a
// real customer (tickets #86/#91, stopped only by Zendesk's own 429; see
// qa/evidence/UC-01/2026-08-22-uc01-e2e/FINDINGS.md F-3). Reply Out of
// Scope now applies uc01_out_of_scope_replied, and this guard's tag list
// grew to match — the trigger's own single-fire condition is only as good
// as every terminal branch actually tagging its ticket.
//
// TRIGGER_ID corrected 2026-08-22 (rca-qdc): the value this file carried,
// 49366915255697, 404s live — it was stale. The real, live "UC-01
// verification v2" trigger is 9990000000004 (confirmed via
// GET /api/v2/triggers.json, title match).
//
// Run locally, same .env as setup-zendesk-trigger.mjs.
// Usage: node scripts/fix-zendesk-trigger-condition.mjs
// ---------------------------------------------------------------------------

import "dotenv/config";

const TRIGGER_ID = "9990000000004";
const TEST_TAG = "uc01_test";
const OUTCOME_TAGS = "uc01_auto_resolved uc01_human_review verification_exception uc01_out_of_scope_replied";

const { ZENDESK_SUBDOMAIN, ZENDESK_OAUTH_CLIENT_ID, ZENDESK_OAUTH_CLIENT_SECRET, ZENDESK_EMPLOYMENT_ID_FIELD_ID } =
  process.env;

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

// `actions` must ride along even though this PUT only changes `conditions` —
// a PUT that sends `conditions` alone gets back 422 "Trigger must contain at
// least one action" (confirmed live, rca-qdc 2026-08-22): Zendesk replaces
// the whole record from what's given, not a per-field patch. Read the
// current action set back rather than hard-coding it, so this script keeps
// working if the webhook action ever changes.
const current = await fetch(`${baseUrl}/api/v2/triggers/${TRIGGER_ID}`, {
  headers: { Authorization: `Bearer ${access_token}`, Accept: "application/json" },
});
if (!current.ok) throw new Error(`Read-before-update failed: ${current.status} ${await current.text()}`);
const { trigger: currentTrigger } = await current.json();

const res = await fetch(`${baseUrl}/api/v2/triggers/${TRIGGER_ID}`, {
  method: "PUT",
  headers: { Authorization: `Bearer ${access_token}`, "Content-Type": "application/json", Accept: "application/json" },
  body: JSON.stringify({
    trigger: {
      actions: currentTrigger.actions,
      conditions: {
        all: [
          { field: "current_tags", operator: "includes", value: TEST_TAG },
          { field: `custom_fields_${ZENDESK_EMPLOYMENT_ID_FIELD_ID}`, operator: "present", value: null },
          { field: "current_tags", operator: "not_includes", value: OUTCOME_TAGS },
        ],
        any: [],
      },
    },
  }),
});
const text = await res.text();
if (!res.ok) throw new Error(`Update failed: ${res.status} ${text}`);
console.log("Trigger updated.");

const check = await fetch(`${baseUrl}/api/v2/triggers/${TRIGGER_ID}`, {
  headers: { Authorization: `Bearer ${access_token}`, Accept: "application/json" },
});
const { trigger } = await check.json();
console.log("Current conditions:", JSON.stringify(trigger.conditions, null, 2));
console.log(
  "\nDone. Existing tickets don't get re-evaluated just because the trigger changed — " +
    "to re-test ticket #2, make any small edit to it (e.g. add an internal note) so Zendesk " +
    "re-evaluates it against the new condition."
);
