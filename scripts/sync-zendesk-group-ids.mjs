#!/usr/bin/env node
// ---------------------------------------------------------------------------
// sync-zendesk-group-ids.mjs — resolve group NAMES to group_ids, once, into the
// n8n routing node's body
// ---------------------------------------------------------------------------
// WHY A GENERATED BLOCK AND NOT A LOOKUP
//
// The n8n Zendesk node assigns a ticket by `updateFields.group`, which becomes
// `body.group_id` — a NUMBER. Group ids are minted by Zendesk when a group is
// created and differ between accounts, so they cannot live in
// src/shared/escalationRouting.js: that module answers "which team owns this",
// which is a fact about Remote's org, and an id is a fact about one Zendesk
// instance. Two different kinds of fact, and mixing them makes the source of
// truth wrong in any other account.
//
// The alternative — resolving the group inside the graph at runtime — needs an
// HTTP Request node per graph, and n8n STRIPS CREDENTIALS FROM HTTP REQUEST
// NODES ON CREATE (CLAUDE.md §6), so that route costs a manual credential
// selection in the editor for every one of them, each failing late and quietly.
//
// So the resolution happens here, once, and is baked into
// workflows/nodes/assignRouting.js between its GENERATED markers. The deployed
// body then stays byte-identical to a file in this repo, which is the thing
// `npm run verify-deployed` can actually check.
//
// THIS SCRIPT ONLY READS ZENDESK. It never creates, renames or deletes a group
// — scripts/setup-zendesk-groups.mjs is the only thing that creates them, on
// purpose, and must be run first. A name with no group is reported and left
// out of the map, which makes the routing node take its tag-and-say-so path
// rather than assigning to something that does not exist.
//
// USAGE
//   node scripts/sync-zendesk-group-ids.mjs              # rewrite the block
//   node scripts/sync-zendesk-group-ids.mjs --dry-run    # report only
//   node scripts/sync-zendesk-group-ids.mjs --base-url http://localhost:4087
//
// Then deploy: node scripts/deploy-routing-nodes.mjs
// ---------------------------------------------------------------------------

import "dotenv/config";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ZendeskClient } from "../src/zendesk/restClient.js";
import { ESCALATION_GROUPS } from "../src/shared/escalationRouting.js";
import { config, isZendeskConfigured } from "../src/shared/config.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT_FILE = path.join(ROOT, "workflows", "nodes", "assignRouting.js");
// The same resolution, for the Node processes. TWO TARGETS AND ONE PASS, on
// purpose: the portal used to resolve the group over the API at request time
// and 403 on it (the shared client's least-privilege scope has no `read`), so
// every escalation was tagged and left unassigned. Writing both files here
// means the graphs and the services can never disagree about which id a name
// resolves to — two sync steps could, and the drift would be invisible until a
// ticket landed in the wrong queue.
const SHARED_FILE = path.join(ROOT, "src", "shared", "escalationGroupIds.js");

const BEGIN = "// --- GENERATED: Zendesk group name -> group_id, resolved from the live account";
const END = "// --- END GENERATED ---";

const argv = process.argv.slice(2);
const dryRun = argv.includes("--dry-run");
const baseUrlIndex = argv.indexOf("--base-url");
const baseUrl = baseUrlIndex !== -1 ? argv[baseUrlIndex + 1] : null;

function buildClient() {
  if (baseUrl) {
    return new ZendeskClient({ baseUrl, email: "setup@portal.test", apiToken: "demo" });
  }
  if (!isZendeskConfigured()) {
    console.error(
      "No Zendesk credentials configured. Set ZENDESK_SUBDOMAIN plus either the\n" +
        "OAuth pair (ZENDESK_OAUTH_CLIENT_ID / ZENDESK_OAUTH_CLIENT_SECRET) or the\n" +
        "email/API-token pair, or pass --base-url to run against a mock."
    );
    process.exit(2);
  }
  return new ZendeskClient({
    subdomain: config.zendesk.subdomain,
    email: config.zendesk.email,
    apiToken: config.zendesk.apiToken,
    clientId: config.zendesk.oauthClientId,
    clientSecret: config.zendesk.oauthClientSecret,
    // Groups are an admin surface and the client's default scope is the least
    // privilege the ticket path needs, so a default-scoped token is VALID and
    // still 403s here — "missing the following required scopes: groups:read,
    // read", which reads like an account permission problem and is really a
    // scope this request never asked for. Asked for here, and only in the two
    // group scripts, so the wider grant stays with the deliberate setup act
    // rather than with every running workflow.
    scope: "read write",
  });
}

const zendesk = buildClient();

let live;
try {
  live = (await zendesk.listGroups()) ?? [];
} catch (err) {
  // Distinct exit code from "the ids drifted": "I could not read the account"
  // and "the account disagrees with the file" are different answers, and a
  // caller must not treat the first as the second.
  console.error(`✖ could not read the Zendesk groups: ${err.message}`);
  console.error(
    "  Reading groups needs the `read` scope. The shared client's OAuth\n" +
      "  client_credentials flow requests only `tickets:read tickets:write`, so a\n" +
      "  scoped-down OAuth client 403s here even though its ticket calls work."
  );
  process.exit(2);
}

const byName = new Map();
for (const g of live) if (g && typeof g.name === "string") byName.set(g.name, g.id);

const resolved = {};
const missing = [];
for (const name of ESCALATION_GROUPS) {
  const id = byName.get(name);
  if (typeof id === "number" && Number.isInteger(id) && id > 0) resolved[name] = id;
  else missing.push(name);
}

for (const name of ESCALATION_GROUPS) {
  console.log(`  ${resolved[name] ? "✔" : "✖"} ${name}${resolved[name] ? ` → ${resolved[name]}` : " — no such group"}`);
}

const entries = Object.entries(resolved)
  .map(([name, id]) => `  ${JSON.stringify(name)}: ${id},`)
  .join("\n");

/**
 * Replace one declaration inside a file's GENERATED block, keeping the block's
 * own hand-written explanation — which says WHY the ids are baked in, and is
 * the part a reader needs most.
 */
async function rewrite(file, decl, body) {
  const source = await readFile(file, "utf8");
  const beginAt = source.indexOf(BEGIN);
  const endAt = source.indexOf(END);
  if (beginAt === -1 || endAt === -1 || endAt < beginAt) {
    console.error(`✖ ${file} has no GENERATED block to rewrite — markers moved or were removed.`);
    process.exit(2);
  }
  const declAt = source.slice(0, endAt).lastIndexOf(decl);
  if (declAt === -1) {
    console.error(`✖ ${file}'s GENERATED block has no \`${decl}\` to replace.`);
    process.exit(2);
  }
  const next = source.slice(0, declAt) + body + "\n" + source.slice(endAt);
  const rel = path.relative(ROOT, file);
  if (next === source) {
    console.log(`= ${rel} already matches the account.`);
    return false;
  }
  if (dryRun) {
    console.log(`→ ${rel} WOULD change (dry run; nothing written).`);
    return false;
  }
  await writeFile(file, next);
  console.log(`→ ${rel} updated.`);
  return true;
}

console.log("");
const changedPort = await rewrite(
  PORT_FILE,
  "const GROUP_IDS =",
  Object.keys(resolved).length === 0 ? "const GROUP_IDS = {};" : `const GROUP_IDS = {\n${entries}\n};`
);
await rewrite(
  SHARED_FILE,
  "export const ESCALATION_GROUP_IDS =",
  Object.keys(resolved).length === 0
    ? "export const ESCALATION_GROUP_IDS = Object.freeze({});"
    : `export const ESCALATION_GROUP_IDS = Object.freeze({\n${entries}\n});`
);
if (changedPort) {
  console.log("\nDeploy the n8n node: node scripts/deploy-routing-nodes.mjs");
}

if (missing.length > 0) {
  console.log(
    `\n${missing.length} group${missing.length === 1 ? "" : "s"} do not exist in this account: ${missing.join(", ")}.\n` +
      "Run scripts/setup-zendesk-groups.mjs to create them. Until then those use\n" +
      "cases tag the ticket and say on it that assignment was skipped — which is\n" +
      "the intended visible failure, not a silent one."
  );
}
