#!/usr/bin/env node
// ---------------------------------------------------------------------------
// apply-ultimate-ai-tag-exclusion.mjs — ONE-TIME, IDEMPOTENT live change.
// ---------------------------------------------------------------------------
// Adds exactly one condition to the third-party Zendesk trigger
// 6151614032671 ("Ultimate.ai Email Channel Automation"):
//
//     current_tags   not_includes   uc01_test
//
// WHY. On real ticket #125 (2026-08-23, qa/evidence/UC-01/
// 2026-08-23-uc01-zendesk-live/) UC-01 answered and solved in twelve seconds
// and, one second later, that bot posted publicly on the same already-solved
// ticket: "a member of the support team will get back to you within the next
// 48 hours." It is not this project's bot — it sits at position 3, ahead of
// UC-01's trigger, and fires on ANY public comment on the brand with no tag
// exclusion. It makes a correct automation look broken on camera.
//
// SCOPE, and it is narrow. qa/HUMAN-DECISIONS-REQUIRED.md §K5 authorises ONE
// condition on THIS trigger and nothing else: not reordering triggers, not
// disabling the integration, no other edit to a third-party integration on a
// live support desk. This script therefore refuses to be a general trigger
// editor — the id, the field, the operator and the value are all constants.
//
// THIS IS A LIVE PRODUCTION SUPPORT DESK. There is no deploy verb in this
// repo for it: running this file IS the change, and committing it is not.
//
// A ZENDESK 200 IS NOT A READBACK. Every assertion below is made against a
// fresh GET after the write — the condition present with exactly that
// field/operator/value, the trigger still enabled, still at position 3, and
// nothing else on the record altered. Exits 2 if any of that fails, so a
// broken run can never be misread as a passing one.
//
// Usage:  node scripts/apply-ultimate-ai-tag-exclusion.mjs
//         (needs ZENDESK_SUBDOMAIN + the OAuth pair; NODE_USE_ENV_PROXY=1 in
//          this container, whose global fetch ignores HTTPS_PROXY.)
// ---------------------------------------------------------------------------

import "dotenv/config";

const TRIGGER_ID = "6151614032671";
const EXPECTED_POSITION = 3;
const NEW_CONDITION = { field: "current_tags", operator: "not_includes", value: "uc01_test" };

const { ZENDESK_SUBDOMAIN, ZENDESK_OAUTH_CLIENT_ID, ZENDESK_OAUTH_CLIENT_SECRET } = process.env;
if (!ZENDESK_SUBDOMAIN || !ZENDESK_OAUTH_CLIENT_ID || !ZENDESK_OAUTH_CLIENT_SECRET) {
  console.error("Missing ZENDESK_SUBDOMAIN / ZENDESK_OAUTH_CLIENT_ID / ZENDESK_OAUTH_CLIENT_SECRET.");
  process.exit(2);
}
const baseUrl = `https://${ZENDESK_SUBDOMAIN}.zendesk.com`;

// `read write`, not the ticket path's least-privilege scope: triggers are an
// admin surface and a default-scoped token is VALID and still 403s here.
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
if (!tokenRes.ok) {
  console.error(`OAuth token request failed: ${tokenRes.status} ${await tokenRes.text()}`);
  process.exit(2);
}
const { access_token: accessToken } = await tokenRes.json();
const auth = { Authorization: `Bearer ${accessToken}`, Accept: "application/json" };

async function readTrigger() {
  const res = await fetch(`${baseUrl}/api/v2/triggers/${TRIGGER_ID}`, { headers: auth });
  if (!res.ok) {
    console.error(`GET trigger ${TRIGGER_ID} failed: ${res.status} ${await res.text()}`);
    process.exit(2);
  }
  return (await res.json()).trigger;
}

const hasCondition = (conditions) =>
  conditions.some(
    (c) => c.field === NEW_CONDITION.field && c.operator === NEW_CONDITION.operator && c.value === NEW_CONDITION.value
  );

const before = await readTrigger();
console.log(
  `BEFORE  active=${before.active} position=${before.position} ` +
    `conditions.all=${before.conditions.all.length} conditions.any=${before.conditions.any.length}`
);

if (hasCondition(before.conditions.all)) {
  console.log("Condition ALREADY PRESENT — no write issued (this script is idempotent).");
} else {
  // `actions` must ride along even though only `conditions` changes: a PUT
  // sending `conditions` alone gets 422 "Trigger must contain at least one
  // action" on this account (confirmed live, rca-qdc 2026-08-22). Read back
  // rather than hard-coded, so the third-party webhook id and payload template
  // go back byte-identical to what the account already had.
  const put = await fetch(`${baseUrl}/api/v2/triggers/${TRIGGER_ID}`, {
    method: "PUT",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify({
      trigger: {
        actions: before.actions,
        conditions: { all: [...before.conditions.all, NEW_CONDITION], any: before.conditions.any },
      },
    }),
  });
  if (!put.ok) {
    console.error(`PUT failed: ${put.status} ${await put.text()}`);
    process.exit(2);
  }
  console.log(`PUT returned ${put.status} — which is NOT a readback. Reading the trigger back now.`);
}

const after = await readTrigger();
const problems = [];
if (!hasCondition(after.conditions.all)) problems.push("the condition is NOT present after the write");
if (after.active !== true) problems.push(`the trigger is no longer enabled (active=${after.active})`);
if (after.position !== EXPECTED_POSITION) problems.push(`position moved: ${after.position} (expected ${EXPECTED_POSITION})`);
if (after.conditions.all.length !== before.conditions.all.length + (hasCondition(before.conditions.all) ? 0 : 1))
  problems.push("conditions.all changed by more than the one authorised condition");
if (JSON.stringify(after.conditions.any) !== JSON.stringify(before.conditions.any)) problems.push("conditions.any changed");
if (JSON.stringify(after.actions) !== JSON.stringify(before.actions)) problems.push("actions changed");
if (after.title !== before.title) problems.push("title changed");

console.log(
  "\nAFTER (live readback):\n" +
    JSON.stringify(
      { id: after.id, title: after.title, active: after.active, position: after.position, updated_at: after.updated_at, conditions: after.conditions },
      null,
      2
    )
);

if (problems.length > 0) {
  console.error("\n✖ READBACK FAILED:\n - " + problems.join("\n - "));
  process.exit(2);
}
console.log("\n✓ condition present, trigger still enabled, still at position 3, nothing else changed.");
console.log(
  "  The acceptance proof is an ABSENCE — only a fresh UC-01 ticket can show it.\n" +
    "  See qa/evidence/UC-01/2026-08-23-k5-ultimate-trigger/README.md."
);
