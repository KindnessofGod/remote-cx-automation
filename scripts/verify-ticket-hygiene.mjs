#!/usr/bin/env node
// ---------------------------------------------------------------------------
// verify-ticket-hygiene.mjs — prove the LIVE Zendesk queue carries no harness
// vocabulary, with an instrument that has been negative-controlled first
// ---------------------------------------------------------------------------
// WHY THIS EXISTS, AND WHY IT IS SEPARATE FROM THE TWO CLEANUP SCRIPTS
//
// rca-mk6n / finding N-2 closed the SUBJECT half; rca-1qju found the identical
// leak one field over, in a TAG (ticket #72, "rca-c73-vc-blocked-proof").
// `clean-harness-ticket-subjects.mjs` and `clean-harness-ticket-tags.mjs` are
// the one-time cleanups. `src/zendesk/ticketHygiene.js` is the write-time
// guard that stops the next one. This is the third thing, and the one the
// round-7 gate actually turns on: an independent READ-ONLY check that the live
// account is clean right now.
//
// It exists because of how rca-1qju was nearly closed on a false zero, twice,
// in opposite directions:
//
//   * The mayor's first sweep normalised `[_-]` to spaces BEFORE matching.
//     That turns "rca-1bk-vc11-proof" into "rca 1bk vc11 proof", which the
//     bead-id pattern does not match. It reported 0 tag leaks and was wrong.
//   * A raw-only sweep has the mirror-image hole: it catches
//     "rca-c73-vc-blocked-proof" and misses "uc01_live_proof", where the
//     separator sits inside the phrase rather than after the id.
//
// NEITHER SPELLING IS OPTIONAL, and which one a given detector happens to
// handle is invisible from inside its result — both produce a confident zero.
// So the patterns in ticketHygiene.js read `-`, `_` and whitespace as the same
// separator and the string edges as boundaries, and this script proves they
// still do before believing anything it reports. Guarding the guard: the
// detector is one regex list one edit away from being quietly halved.
//
// THE NEGATIVE CONTROL IS THE POINT. Before touching the network, every known-
// dirty value below is pushed through the SAME function the sweep uses (not
// through the regex list directly — a control that bypasses the call path
// under test controls nothing), and every known-clean value from the account's
// real tag vocabulary is pushed through it too. If a dirty value is missed or
// a clean one is flagged, the instrument is wrong and this script exits 2
// WITHOUT SWEEPING: it reports that it cannot tell you, rather than reporting
// a zero it has not earned. A clean sweep from an uncontrolled instrument is
// worth nothing.
//
// EXIT CODES — 0 is only ever reachable by an instrument that passed its own
// controls and then found nothing, matching `verify-deployed`/`verify-claims`/
// `verify-traces`: a check that could not run must never be mistaken for a
// check that passed.
//   0  controls passed AND the live account is clean
//   1  the live account carries at least one leak (they are listed)
//   2  could not tell you — no credentials, unreachable account, or the
//      instrument failed its own negative control
//
// Read-only by construction: the only Zendesk call reachable from this file is
// `getTicket()`. Nothing here can write.
//
// Usage:
//   npm run verify-ticket-hygiene              # sweep ids 1-150
//   node scripts/verify-ticket-hygiene.mjs --max=250
// ---------------------------------------------------------------------------

import "dotenv/config";
import { ZendeskClient } from "../src/zendesk/restClient.js";
import { findHarnessVocabulary, findHarnessVocabularyInTags } from "../src/zendesk/ticketHygiene.js";
import { config, isZendeskConfigured } from "../src/shared/config.js";

const argv = process.argv.slice(2);
const maxArg = argv.find((a) => a.startsWith("--max="));
const MAX_ID = maxArg ? Number(maxArg.slice("--max=".length)) : 150;

// Known-dirty. Each must be FLAGGED. The `why` column records which leg of the
// matcher catches it, so a future edit that drops one leg fails here loudly
// instead of silently halving the detector.
const MUST_FLAG = [
  ["rca-c73-vc-blocked-proof", "bead id, hyphen-joined — the live leak rca-1qju found"],
  ["rca-1bk-vc11-proof", "bead id, hyphen-joined — the tag rca-1qju's own title names"],
  ["uc01_live_proof", "phrase, UNDERSCORE-joined — a spaces-only pattern misses this"],
  ["vc_33_proof", "criterion id, UNDERSCORE-joined — a hyphens-only pattern misses this"],
  ["rca_j2d_proof", "bead id, underscore-joined — the same id the other way round"],
  ["Re-eval of VC-11", "subject spelling: hyphens and spaces, no underscores"],
  ["#70 rca-1bk VC-11 live proof — out of scope (2)", "a subject leak, the original N-2 shape"],
];

// Known-clean, taken from the account's REAL tag vocabulary and subjects (read
// live 2026-08-23) rather than invented. Each must PASS. This half matters as
// much as the other: a matcher that flags everything reports zero leaks only
// because it has refused every ticket, and widening the patterns is exactly
// the change that would do it.
const MUST_PASS = [
  "escalated_by_ultimate",
  "uc01_test",
  "queue_hr_ops",
  "uc01_auto_resolved",
  "uc01_human_review",
  "uc03_routed_uc04",
  "uc02_finance_ops_review",
  "escalation_mobility_legal_t3",
  "routing_proof",
  "portal_html_probe",
  "uc01_outofscope_loop_evidence",
  "Employment verification letter request",
  "Quick question (not work related)",
];

/** The one detector both legs of this script use — subjects and tags alike. */
function detect(text) {
  return findHarnessVocabulary(text);
}

function runNegativeControl() {
  let ok = true;
  console.log("NEGATIVE CONTROL — pushing known values through the same detector the sweep uses\n");
  for (const [value, why] of MUST_FLAG) {
    const hit = detect(value);
    console.log(`  ${hit ? "flags " : "MISSES"} ${JSON.stringify(value)}${hit ? ` -> ${hit.name} "${hit.term}"` : ""}`);
    if (!hit) {
      console.log(`          ^ must be flagged: ${why}`);
      ok = false;
    }
  }
  console.log("");
  for (const value of MUST_PASS) {
    const hit = detect(value);
    if (hit) {
      console.log(`  FALSE POSITIVE on ${JSON.stringify(value)} -> ${hit.name} "${hit.term}"`);
      ok = false;
    }
  }
  if (ok) console.log(`  ${MUST_PASS.length} known-clean values all passed (no false positives)\n`);
  return ok;
}

function buildClient() {
  // Flat shape, not `config.zendesk` — passing the config object straight in
  // 401s on EVERY call and reads exactly like an account/2SV problem when it
  // is only a wrong argument shape. Same as both cleanup scripts.
  return new ZendeskClient({
    subdomain: config.zendesk.subdomain,
    email: config.zendesk.email,
    apiToken: config.zendesk.apiToken,
    clientId: config.zendesk.oauthClientId,
    clientSecret: config.zendesk.oauthClientSecret,
  });
}

async function main() {
  if (!runNegativeControl()) {
    console.error(
      "INSTRUMENT FAILED ITS OWN NEGATIVE CONTROL — not sweeping.\n" +
        "A zero from a detector that misses a known leak (or flags a known-clean tag) means nothing.\n" +
        "Fix findHarnessVocabulary() in src/zendesk/ticketHygiene.js before trusting any sweep.",
    );
    process.exit(2);
  }

  if (!isZendeskConfigured()) {
    console.error(
      "CANNOT VERIFY — no Zendesk credentials configured. Set ZENDESK_SUBDOMAIN plus either\n" +
        "ZENDESK_OAUTH_CLIENT_ID/ZENDESK_OAUTH_CLIENT_SECRET or ZENDESK_EMAIL/ZENDESK_API_TOKEN.\n" +
        "Exiting 2, not 0 — a check that could not run is not a check that passed.",
    );
    process.exit(2);
  }

  const zendesk = buildClient();
  const subjectLeaks = [];
  const tagLeaks = [];
  let real = 0;
  let reached = false;

  for (let id = 1; id <= MAX_ID; id++) {
    let ticket;
    try {
      ticket = await zendesk.getTicket(id);
    } catch (err) {
      // A transport/auth failure is "could not tell you", not "clean".
      console.error(`\nCANNOT VERIFY — reading ticket #${id} failed: ${err.message}`);
      console.error("Exiting 2, not 0 — an unreachable account is not a clean account.");
      process.exit(2);
    }
    reached = true;
    if (!ticket) continue; // ids are not dense; a gap is not an error
    real++;

    const sHit = detect(ticket.subject);
    if (sHit) subjectLeaks.push({ id, value: ticket.subject, hit: sHit });

    for (const tag of ticket.tags ?? []) {
      const tHit = detect(tag);
      if (tHit) tagLeaks.push({ id, value: tag, hit: tHit, allTags: ticket.tags });
    }
  }

  if (!reached) {
    console.error("CANNOT VERIFY — no ticket read completed. Exiting 2.");
    process.exit(2);
  }

  console.log(`swept ticket ids 1-${MAX_ID}: ${real} real tickets\n`);
  for (const { id, value, hit } of subjectLeaks) {
    console.log(`  #${id} SUBJECT LEAK [${hit.name} "${hit.term}"] ${JSON.stringify(value)}`);
  }
  for (const { id, value, hit, allTags } of tagLeaks) {
    console.log(`  #${id} TAG LEAK     [${hit.name} "${hit.term}"] ${JSON.stringify(value)}  (all tags: ${JSON.stringify(allTags)})`);
  }
  console.log(`  subject leaks: ${subjectLeaks.length}`);
  console.log(`  tag leaks:     ${tagLeaks.length}`);

  const total = subjectLeaks.length + tagLeaks.length;
  if (total > 0) {
    console.error(
      `\nFAIL — ${total} harness-vocabulary leak(s) live in the queue a persona reads on its own\n` +
        "authorised surface. Run scripts/clean-harness-ticket-subjects.mjs --live and/or\n" +
        "scripts/clean-harness-ticket-tags.mjs --live, then re-run this.",
    );
    process.exit(1);
  }
  console.log("\nPASS — negative control held, and 0 subject leaks / 0 tag leaks across the live queue.");
}

main().catch((err) => {
  console.error("CANNOT VERIFY —", err.message);
  process.exit(2);
});
