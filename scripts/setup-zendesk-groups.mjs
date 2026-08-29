#!/usr/bin/env node
// ---------------------------------------------------------------------------
// setup-zendesk-groups.mjs  —  provision the teams escalations are assigned to
// ---------------------------------------------------------------------------
// WHY THIS IS A SCRIPT AND NOT SOMETHING THE AUTOMATION DOES
//
// An escalation is only a hand-off if it reaches a named team, so the portal
// assigns escalated tickets to a Zendesk group (src/shared/escalationRouting.js
// holds the one mapping, taken from each use case's own spec). Those groups
// have to exist first.
//
// The tempting shortcut is to create a missing group on the fly at escalation
// time. That would mean an automated workflow silently creating ORG STRUCTURE
// in a live Zendesk account, as a side effect of an employee filing an expense
// — an outward, consequential, hard-to-undo act happening because nobody said
// no. This repository's standing rule is that such acts are decisions, not side
// effects, so `RemoteClient.listGroups()` is what the escalation path calls and
// `createGroup()` is called from here and nowhere else. When a group is missing
// at escalation time the ticket is tagged, an internal note names the intended
// team, and the response says assignment was skipped. Visible failure, never
// silent.
//
// IDEMPOTENT. It lists what exists, creates only what is missing, and prints
// what it did — so re-running it is safe and its output is the record of what
// changed. It creates groups and nothing else; it never renames, merges or
// deletes one, because this script's job is to add what is missing, and
// removing a team's group in a live account is not a thing a setup script
// should be able to do by accident.
//
// Requires in .env: ZENDESK_SUBDOMAIN, plus either the OAuth pair
// (ZENDESK_OAUTH_CLIENT_ID / ZENDESK_OAUTH_CLIENT_SECRET) or the
// email/API-token pair the shared client also supports.
//
// Usage:
//   node scripts/setup-zendesk-groups.mjs             # create what is missing
//   node scripts/setup-zendesk-groups.mjs --dry-run   # report only, change nothing
//   node scripts/setup-zendesk-groups.mjs --base-url http://localhost:4087
//                                                     # against the local mock
// ---------------------------------------------------------------------------

import "dotenv/config";
import { ZendeskClient } from "../src/zendesk/restClient.js";
import { ESCALATION_GROUPS, ESCALATION_ROUTES } from "../src/shared/escalationRouting.js";
import { config, isZendeskConfigured } from "../src/shared/config.js";

const argv = process.argv.slice(2);
const dryRun = argv.includes("--dry-run");
const baseUrlIndex = argv.indexOf("--base-url");
const baseUrl = baseUrlIndex !== -1 ? argv[baseUrlIndex + 1] : null;

function buildClient() {
  // An explicit --base-url wins, so the script can be rehearsed against the
  // local mock before it is pointed at a real account. That rehearsal is the
  // point: this is the one script here that creates objects in a live Zendesk.
  if (baseUrl) {
    return new ZendeskClient({ baseUrl, email: "setup@portal.test", apiToken: "demo" });
  }
  if (!isZendeskConfigured()) {
    console.error(
      "No Zendesk credentials configured. Set ZENDESK_SUBDOMAIN plus either\n" +
        "ZENDESK_OAUTH_CLIENT_ID/ZENDESK_OAUTH_CLIENT_SECRET or ZENDESK_EMAIL/ZENDESK_API_TOKEN\n" +
        "in .env, or pass --base-url http://localhost:4087 to rehearse against the mock."
    );
    process.exit(1);
  }
  return new ZendeskClient({
    subdomain: config.zendesk.subdomain,
    email: config.zendesk.email,
    apiToken: config.zendesk.apiToken,
    clientId: config.zendesk.oauthClientId,
    clientSecret: config.zendesk.oauthClientSecret,
    // Groups are an ADMIN surface, and the client's default scope is the least
    // privilege the ticket path needs. Under `tickets:read tickets:write` the
    // token is valid and GET /api/v2/groups still 403s — "You are missing the
    // following required scopes: groups:read, read" — which reads like a
    // permission problem with the account and is really a scope this request
    // never asked for. Asked for here, and only here, so the wider grant lives
    // with the one-off setup act rather than with every running workflow.
    scope: "read write",
  });
}

async function main() {
  const zendesk = buildClient();
  const target = baseUrl ?? `${config.zendesk.subdomain}.zendesk.com`;

  console.log(`▶ Escalation groups on ${target}${dryRun ? "  (DRY RUN — nothing will be created)" : ""}\n`);

  // WHICH TEAM OWNS WHAT, printed before anything is touched, so the person
  // running this can check the mapping against the specs rather than trust it.
  console.log("  Owning teams, per use case (src/shared/escalationRouting.js):");
  for (const [useCase, route] of Object.entries(ESCALATION_ROUTES)) {
    console.log(`    ${useCase}  →  ${route.group.padEnd(28)} tag ${route.queueTag}`);
    // Printed on its own line, and only when the two differ, so the one row
    // where they do (UC-04) is visible rather than folded into a single name.
    if (route.escalationGroup) {
      console.log(`             escalates to  ${route.escalationGroup.padEnd(28)} tag ${route.escalationTag}`);
    } else {
      console.log(`             escalates to  ${"(same team)".padEnd(28)} tag ${route.escalationTag}`);
    }
  }
  console.log("");

  const existing = await zendesk.listGroups();
  const byName = new Map(existing.map((g) => [g.name, g]));
  console.log(`  ${existing.length} group(s) already exist in this account.\n`);

  const created = [];
  const present = [];
  const failed = [];

  for (const name of ESCALATION_GROUPS) {
    if (byName.has(name)) {
      present.push(name);
      console.log(`  = already exists   ${name}  (id ${byName.get(name).id})`);
      continue;
    }
    if (dryRun) {
      created.push(name);
      console.log(`  + would create     ${name}`);
      continue;
    }
    try {
      const group = await zendesk.createGroup(name);
      created.push(name);
      console.log(`  + created          ${name}  (id ${group?.id ?? "?"})`);
    } catch (err) {
      // Reported and carried on, rather than aborting: one group failing must
      // not leave the rest unprovisioned, and the summary below names it.
      failed.push({ name, error: err.message });
      console.log(`  ! FAILED           ${name}  — ${err.message}`);
    }
  }

  console.log("");
  console.log(
    `▶ ${dryRun ? "Would create" : "Created"} ${created.length}, already present ${present.length}, failed ${failed.length}.`
  );
  if (failed.length) {
    console.log("  Escalations for the failed teams will still be TAGGED and will carry an internal");
    console.log("  note naming the intended team — they will simply be unassigned. Re-run this script");
    console.log("  once the cause is fixed; it is idempotent.");
    process.exitCode = 1;
  } else if (!dryRun) {
    console.log("  Escalated tickets will now be assigned to their owning team on creation.");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
