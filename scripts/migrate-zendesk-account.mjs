#!/usr/bin/env node
// ---------------------------------------------------------------------------
// migrate-zendesk-account.mjs — rebuild this project's Zendesk configuration
// on a NEW account, from a capture of the old one.
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
// The Zendesk account this project runs against expired, and every integration
// point is keyed to account-scoped ids: a custom field, nine groups, nine
// webhooks and nine triggers. Recreating those by hand is 28 forms, and three
// of the ids are also hard-coded in n8n Code node bodies — so a hand migration
// that looks complete can still leave the pipeline silently dead.
//
//   node scripts/migrate-zendesk-account.mjs --dry-run   # print the plan
//   node scripts/migrate-zendesk-account.mjs             # create, then verify
//
// Reads ~/zendesk-migration/MANIFEST.json (written by capturing the OLD
// account) and the ZENDESK_NEW_* variables. Writes an id map to
// ~/zendesk-migration/id-map.json, which is the input to the n8n node edits.
//
// ---------------------------------------------------------------------------
// THE THREE THINGS THIS EXISTS TO GET RIGHT
//
// 1. THE FIELD ID APPEARS TWICE IN EVERY TRIGGER, and the second one is easy
//    to miss. Once in the condition (`custom_fields_<id>` present), and again
//    inside the webhook payload TEMPLATE, both as `custom_fields[].id` and as
//    the placeholder `{{ticket.ticket_field_<id>}}`. Rewriting only the
//    condition produces a trigger that fires correctly and posts an EMPTY
//    employment id to n8n — which then escalates every ticket for want of a
//    record, with no error anywhere. So the rewrite is done over the whole
//    serialised condition/action blob, not field by field.
//
// 2. IT IS IDEMPOTENT, because a half-finished migration is the normal case.
//    Every create is preceded by a find-by-name; an existing object is adopted
//    and reported as `reused`. Re-running after a failure at object 19 of 28
//    must not leave two of everything, and on Zendesk a duplicate TRIGGER is
//    not cosmetic — both fire, and n8n receives the same ticket twice.
//
// 3. IT VERIFIES BY READING BACK, never by trusting the create response. This
//    project has been burned repeatedly by a success flag that described the
//    request rather than the state (a pinned n8n node, a Zendesk field write
//    to a nonexistent id, a `PATCH` returning an empty body). Every object is
//    re-fetched and compared after the fact.
// ---------------------------------------------------------------------------

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const DRY = process.argv.includes("--dry-run");
const DIR = join(homedir(), "zendesk-migration");
const MANIFEST = join(DIR, "MANIFEST.json");
const IDMAP = join(DIR, "id-map.json");

const SUB = process.env.ZENDESK_NEW_SUBDOMAIN;
const CID = process.env.ZENDESK_NEW_OAUTH_CLIENT_ID;
const SEC = process.env.ZENDESK_NEW_OAUTH_CLIENT_SECRET;
const HOOK_SECRET = process.env.N8N_WEBHOOK_TOKEN;

function die(msg) {
  console.error("\n  " + msg + "\n");
  // Exit 2, never 1 and never 0: this script's silence must never be readable
  // as success. Same rule as verify-deployed / verify-traces.
  process.exit(2);
}

if (!SUB || !CID || !SEC) die("ZENDESK_NEW_SUBDOMAIN / _OAUTH_CLIENT_ID / _OAUTH_CLIENT_SECRET must all be set.");
if (!HOOK_SECRET) die("N8N_WEBHOOK_TOKEN is not set — the nine webhooks would be created UNAUTHENTICATED.");
if (!existsSync(MANIFEST)) die(`No capture of the old account at ${MANIFEST}.`);

const manifest = JSON.parse(readFileSync(MANIFEST, "utf8"));
const BASE = `https://${SUB}.zendesk.com`;

// --- auth ------------------------------------------------------------------
/**
 * A token from client_credentials.
 *
 * THE FAILURE THIS CHECKS FOR IS NOT "NO TOKEN". An OAuth client whose
 * "Allowed scopes" field is left empty returns a perfectly valid-looking
 * bearer token that then 403s on every endpoint with "You are missing the
 * following required scopes: read". The token request succeeds; the account is
 * unusable. That reads exactly like a wrong secret and is a blank form field,
 * and it cost this project an afternoon on the previous account. So the token
 * is not accepted until it has actually READ something.
 */
async function token() {
  const r = await fetch(`${BASE}/oauth/tokens`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ grant_type: "client_credentials", client_id: CID, client_secret: SEC, scope: "read write" }),
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok || !body.access_token) {
    die(
      `Token request failed (HTTP ${r.status}): ${JSON.stringify(body).slice(0, 300)}\n` +
        `  If this says invalid_scope, the client's "Allowed scopes" list exists but does not include read/write.`
    );
  }
  return body.access_token;
}

let TOKEN = null;
async function api(path, { method = "GET", body = null } = {}) {
  const r = await fetch(`${BASE}/api/v2/${path}`, {
    method,
    headers: {
      authorization: `Bearer ${TOKEN}`,
      ...(body ? { "content-type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await r.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON error page */ }
  if (!r.ok) {
    const hint = r.status === 403 && /scope/i.test(text)
      ? '  <- the OAuth client has no "read"/"write" in Allowed scopes'
      : "";
    die(`${method} ${path} -> HTTP ${r.status}\n  ${text.slice(0, 300)}${hint}`);
  }
  return json;
}

// --- helpers ---------------------------------------------------------------
const log = (...a) => console.log(" ", ...a);
const created = { field: null, groups: {}, webhooks: {}, triggers: {} };

/** Adopt an existing object by name, or create it. Returns [id, "reused"|"created"]. */
async function ensure({ label, find, create }) {
  const existing = await find();
  if (existing) return [existing, "reused"];
  if (DRY) return ["(dry-run)", "would create"];
  return [await create(), "created"];
}

// --- 1. the custom field ---------------------------------------------------
async function migrateField() {
  const want = manifest.employmentIdField;
  const [id, how] = await ensure({
    label: want.title,
    find: async () => {
      const all = await api("ticket_fields.json?per_page=100");
      const hit = all.ticket_fields.find((f) => f.title === want.title && f.active);
      return hit ? hit.id : null;
    },
    create: async () => {
      const r = await api("ticket_fields.json", {
        method: "POST",
        body: { ticket_field: { type: want.type, title: want.title } },
      });
      return r.ticket_field.id;
    },
  });
  created.field = id;
  log(`field    ${how.padEnd(12)} ${want.title} -> ${id}`);
  return id;
}

// --- 2. the nine escalation groups -----------------------------------------
async function migrateGroups() {
  const all = DRY ? { groups: [] } : await api("groups.json?per_page=100");
  for (const name of Object.keys(manifest.groups)) {
    const [id, how] = await ensure({
      label: name,
      find: async () => {
        const hit = all.groups.find((g) => g.name === name);
        return hit ? hit.id : null;
      },
      create: async () => (await api("groups.json", { method: "POST", body: { group: { name } } })).group.id,
    });
    created.groups[name] = id;
    log(`group    ${how.padEnd(12)} ${name} -> ${id}`);
  }
}

// --- 3. the nine webhooks --------------------------------------------------
/**
 * The shared secret is carried over UNCHANGED from the old account.
 *
 * That is the point: rotation order is normally Zendesk-first-then-n8n and is
 * not optional, because a Zendesk webhook that fails even once is
 * circuit-broken and can only be replaced. Keeping the same secret means the
 * n8n credential never has to change, so that ordering problem does not arise
 * at all and none of the nine graphs is touched.
 */
async function migrateWebhooks() {
  const all = DRY ? { webhooks: [] } : await api("webhooks");
  for (const w of manifest.webhooks) {
    const [id, how] = await ensure({
      label: w.name,
      find: async () => {
        const hit = (all.webhooks || []).find((x) => x.name === w.name);
        return hit ? hit.id : null;
      },
      create: async () => {
        const r = await api("webhooks", {
          method: "POST",
          body: {
            webhook: {
              name: w.name,
              endpoint: w.endpoint,
              http_method: w.method || "POST",
              request_format: w.format || "json",
              status: "active",
              subscriptions: ["conditional_ticket_events"],
              authentication: {
                type: "api_key",
                add_position: "header",
                data: { name: w.authHeaderName || "X-YOUR-WEBHOOK-TOKEN", value: HOOK_SECRET },
              },
            },
          },
        });
        return r.webhook.id;
      },
    });
    created.webhooks[w.name] = { id, oldId: w.oldId };
    log(`webhook  ${how.padEnd(12)} ${w.name} -> ${id}`);
  }
}

// --- 4. the nine triggers --------------------------------------------------
/**
 * Rewritten by SERIALISING the whole conditions/actions blob and replacing ids
 * in the text, rather than walking named fields.
 *
 * That is deliberate and it is the crux of this script. The old field id
 * appears in at least three distinct places per trigger with three different
 * syntaxes — `custom_fields_<id>` in a condition, `"id":<id>` inside the
 * payload JSON, and `{{ticket.ticket_field_<id>}}` as a placeholder inside a
 * STRING inside that JSON. A field-by-field walk reaches the first and misses
 * the other two, and the result is a trigger that fires perfectly and delivers
 * an empty employment id, which every downstream gate then reports as "no
 * record" rather than as a configuration fault.
 */
function rewriteTrigger(t, fieldId, webhookIdByOld) {
  let blob = JSON.stringify({ conditions: t.conditions, actions: t.actions });
  const oldField = String(manifest.employmentIdField.oldId);
  const before = blob;
  blob = blob.split(oldField).join(String(fieldId));
  if (blob === before) {
    die(`Trigger ${t.title}: the old field id ${oldField} did not appear at all — the manifest and the trigger disagree.`);
  }
  for (const [oldId, newId] of Object.entries(webhookIdByOld)) {
    blob = blob.split(oldId).join(newId);
  }
  if (blob.includes(oldField)) die(`Trigger ${t.title}: old field id survived the rewrite.`);
  return JSON.parse(blob);
}

async function migrateTriggers(fieldId) {
  const webhookIdByOld = {};
  for (const v of Object.values(created.webhooks)) if (v.oldId) webhookIdByOld[v.oldId] = v.id;
  const all = DRY ? { triggers: [] } : await api("triggers.json?per_page=100");
  for (const t of manifest.triggers) {
    const rewritten = DRY && !created.field ? null : rewriteTrigger(t, fieldId, webhookIdByOld);
    const [id, how] = await ensure({
      label: t.title,
      find: async () => {
        const hit = all.triggers.find((x) => x.title === t.title);
        return hit ? hit.id : null;
      },
      create: async () =>
        (await api("triggers.json", {
          method: "POST",
          body: { trigger: { title: t.title, active: true, conditions: rewritten.conditions, actions: rewritten.actions } },
        })).trigger.id,
    });
    created.triggers[t.title] = id;
    log(`trigger  ${how.padEnd(12)} ${t.title} -> ${id}`);
  }
}

// --- 5. read everything back ----------------------------------------------
/**
 * Verification is a SECOND fetch, not the create response.
 *
 * A create that returns 201 has told you what the request said, not what the
 * account holds. The specific thing checked here is the one that fails
 * silently: that every trigger's stored payload now names the NEW field id and
 * no longer names the old one anywhere.
 */
async function verify(fieldId) {
  console.log("\n  verifying by reading the account back\n");
  const fields = await api("ticket_fields.json?per_page=100");
  const f = fields.ticket_fields.find((x) => x.id === fieldId);
  log(f ? `field ${fieldId} present, title ${JSON.stringify(f.title)}` : `FIELD ${fieldId} NOT FOUND`);

  const triggers = await api("triggers.json?per_page=100");
  const oldField = String(manifest.employmentIdField.oldId);
  let bad = 0;
  for (const t of manifest.triggers) {
    const live = triggers.triggers.find((x) => x.title === t.title);
    if (!live) { log(`MISSING trigger ${t.title}`); bad++; continue; }
    const blob = JSON.stringify({ c: live.conditions, a: live.actions });
    const hasNew = blob.includes(String(fieldId));
    const hasOld = blob.includes(oldField);
    if (!hasNew || hasOld || !live.active) {
      log(`DEFECTIVE ${t.title}: newFieldId=${hasNew} oldFieldIdStillPresent=${hasOld} active=${live.active}`);
      bad++;
    } else log(`ok  ${t.title}`);
  }
  const hooks = await api("webhooks");
  for (const w of manifest.webhooks) {
    const live = (hooks.webhooks || []).find((x) => x.name === w.name);
    if (!live) { log(`MISSING webhook ${w.name}`); bad++; continue; }
    const auth = (live.authentication || {}).type;
    if (auth !== "api_key" || live.status !== "active") {
      log(`DEFECTIVE webhook ${w.name}: auth=${auth} status=${live.status}`);
      bad++;
    }
  }
  if (bad) die(`${bad} object(s) are missing or defective. Nothing has been switched over — the old account is still live.`);
  console.log("\n  all objects present and correct\n");
}

// --- main ------------------------------------------------------------------
console.log(`\n  ${DRY ? "DRY RUN — nothing will be created" : "MIGRATING"}  ->  ${BASE}\n`);
TOKEN = DRY ? null : await token();
if (!DRY) {
  const me = await api("users/me.json");
  log(`authenticated as ${me.user.name} (${me.user.role})`);
  if (me.user.role !== "admin") die("This client is not an admin — creating triggers and webhooks will fail.");
  console.log("");
}
const fieldId = DRY ? "(new id)" : await migrateField();
await migrateGroups();
await migrateWebhooks();
await migrateTriggers(fieldId);

if (!DRY) {
  await verify(fieldId);
  writeFileSync(IDMAP, JSON.stringify({ subdomain: SUB, employmentIdField: { oldId: manifest.employmentIdField.oldId, newId: fieldId }, ...created }, null, 2));
  console.log(`  id map written to ${IDMAP}`);
  console.log(`\n  NEXT, and nothing works until it is done:`);
  console.log(`    ZENDESK_EMPLOYMENT_ID_FIELD_ID=${fieldId}   (.env AND Vercel)`);
  console.log(`    the same id is hard-coded in nine n8n Code nodes — republish each\n`);
}
