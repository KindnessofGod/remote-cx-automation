#!/usr/bin/env node
// ---------------------------------------------------------------------------
// verify-surfaces.mjs — the UC-01 surface runner (rca-tcj)
// ---------------------------------------------------------------------------
// Drives UC-01's real surfaces on the DEPLOYED system and asserts, instead of
// a human re-running eighteen single-use scripts by hand. See
// qa/contracts/UC-01-acceptance.md §13 for the surface list this is built
// from, and the rca-tcj bead for the four non-negotiable rules this file's
// structure follows.
//
// EXIT CODES (rule 4 — never silently 0 when a surface could not be read):
//   0  clean — every fact x surface x scenario cell is "pass" or "na"
//   1  a real defect was found — at least one "fail"
//   2  could not tell — a surface was unreadable, a required scenario is
//      missing, the target was refused, the portal key did not work, or a
//      FAIL's only evidence is STALE (rca-h7v GAP 1 — predates the deploy
//      that could have changed the surface it is judging)
//
// USAGE
//   npm run verify-surfaces                        # full run against production
//   npm run verify-surfaces -- --target=<url>       # override (self-test only)
//   npm run verify-surfaces -- --self-test-exit2    # prove rule 4 (ordering step 1)
//   npm run verify-surfaces -- --self-test-positive-lead   # prove rule 3 (step 2)
//   npm run verify-surfaces -- --self-test-fact-coverage   # prove rca-h7v GAP 2 offline
//   npm run verify-surfaces -- --self-test-stale    # prove rca-h7v GAP 1 offline
//   npm run verify-surfaces -- --regressions        # re-find the 3 known regressions
//   npm run verify-surfaces -- --no-browser         # skip the two browser-driven surfaces
// ---------------------------------------------------------------------------

import "dotenv/config";
import { config } from "../src/shared/config.js";
import { RemoteClient } from "../src/remote/restClient.js";
import { ZendeskClient } from "../src/zendesk/restClient.js";

import { resolveTarget, verifyPortalKey, SurfaceUnreachableError } from "../src/surfaceverify/target.js";
import { discoverScenarios, MissingScenarioError } from "../src/surfaceverify/scenarios.js";
import { getRegistry, REGISTERED } from "../src/surfaceverify/registries/index.js";
import { ALL_FACTS, makePositiveLeadFact } from "../src/surfaceverify/facts.js";
import { makeZendeskSurfaces } from "../src/surfaceverify/surfaces/zendeskComments.js";
import { makeZafSidebarSurface, makeThirdPartyDoorSurface, closeSharedBrowser } from "../src/surfaceverify/surfaces/browser.js";
import { runFactLoop, formatGrid, overallExitCode, analyzeFactCoverage } from "../src/surfaceverify/runner.js";
import { resolveSubject } from "../src/surfaceverify/subject.js";
import { runRegressionSuite } from "../src/surfaceverify/regressions.js";
import { getCommitTimestamp, markStaleFailures } from "../src/surfaceverify/staleness.js";

const argv = process.argv.slice(2);

// --uc=UC-02 selects a registry. Defaults to UC-01 so every existing caller —
// including the two self-tests and the regression suite — behaves exactly as
// before. A use case with no registry is exit 2 (unwritten), never a pass:
// "registered" and "verified" are different claims and the second is the one
// anybody cares about.
const ucArg = (argv.find((a) => a.startsWith("--uc=")) || "--uc=UC-01").slice(5);
let REGISTRY;
try { REGISTRY = getRegistry(ucArg); }
catch (err) {
  console.error(err.message);
  process.exit(2);
}
const flag = (name) => argv.includes(`--${name}`);
const opt = (name) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
};

async function main() {
  if (flag("regressions")) return runRegressionsMode();
  if (flag("self-test-exit2")) return selfTestExit2();
  if (flag("self-test-positive-lead")) return selfTestPositiveLead();
  if (flag("self-test-fact-coverage")) return selfTestFactCoverage();
  if (flag("self-test-stale")) return selfTestStale();
  return fullRun({ explicitTarget: opt("target"), noBrowser: flag("no-browser") });
}

// ---------------------------------------------------------------------------
// ORDERING STEP 1 (rca-tcj): "Build rule 4 FIRST, and prove it by pointing the
// runner at a preview host and at a wrong PORTAL_ACCESS_KEY. Both must exit 2."
// ---------------------------------------------------------------------------
async function selfTestExit2() {
  console.log("=== SELF-TEST: rule 4 — exit 2 on an unreachable/refused target ===\n");
  let allOk = true;

  // (a) a Vercel PREVIEW host must be refused, never treated as production.
  console.log("(a) preview host refusal");
  try {
    resolveTarget({ explicit: "https://remote-cx-apis-abc123def-someorg.vercel.app" });
    console.log("   FAIL — a preview host was NOT refused");
    allOk = false;
  } catch (err) {
    if (err instanceof SurfaceUnreachableError && err.code === "preview_host_refused") {
      console.log(`   ok — refused: ${err.message.slice(0, 90)}...`);
    } else {
      console.log(`   FAIL — refused for the wrong reason: ${err.message}`);
      allOk = false;
    }
  }

  // (b) a wrong PORTAL_ACCESS_KEY must be refused when checked against the real target.
  console.log("(b) wrong PORTAL_ACCESS_KEY refusal (against the real production host)");
  try {
    const baseUrl = resolveTarget({});
    await verifyPortalKey({ baseUrl, portalKey: "definitely-not-the-real-key-00000" });
    console.log("   FAIL — a wrong key was NOT refused");
    allOk = false;
  } catch (err) {
    if (err instanceof SurfaceUnreachableError && err.code === "portal_key_rejected") {
      console.log(`   ok — refused: ${err.message.slice(0, 90)}...`);
    } else {
      console.log(`   FAIL — refused for the wrong reason: ${err.message}`);
      allOk = false;
    }
  }

  console.log(`\n${allOk ? "SELF-TEST PASSED — rule 4 refuses both cases" : "SELF-TEST FAILED"}`);
  process.exit(allOk ? 0 : 1);
}

// ---------------------------------------------------------------------------
// ORDERING STEP 2: "Build rule 3's positive-lead check SECOND, and SEE IT FAIL
// before it passes — point it at a reason no decision carries and confirm the
// run fails rather than skips."
// ---------------------------------------------------------------------------
async function selfTestPositiveLead() {
  console.log("=== SELF-TEST: rule 3 — a missing required reason FAILS the run, never skips ===\n");
  const baseUrl = resolveTarget({});
  const portalKey = process.env.PORTAL_ACCESS_KEY;
  await verifyPortalKey({ baseUrl, portalKey });

  const FAKE_REASON = {
    reason: "definitely_fake_reason_that_can_never_exist_xyz",
    label: "self-test-only fake reason",
    required: true,
    why: "this is the self-test proving a missing required reason fails the run",
  };
  const { missingRequired } = await discoverScenarios({
    baseUrl,
    portalKey,
    useCase: "UC-01",
    requiredReasons: [FAKE_REASON],
  });

  if (missingRequired.length === 1 && missingRequired[0] instanceof MissingScenarioError) {
    console.log(`ok — a required-but-absent reason produced a FAILURE, not a skip:\n  ${missingRequired[0].message}`);
    console.log("\nSELF-TEST PASSED — rule 3's positive-lead check fails correctly before it can ever pass");
    process.exit(0);
  }
  console.log("FAIL — a missing required reason did not produce a failure");
  process.exit(1);
}

// ---------------------------------------------------------------------------
// GAP 2 SELF-TEST (rca-h7v): "construct a registry where a required fact
// matches no scenario, see the run go red, and only then wire it in." Entirely
// offline — no target, no network.
// ---------------------------------------------------------------------------
async function selfTestFactCoverage() {
  console.log("=== SELF-TEST: GAP 2 (rca-h7v) — a REQUIRED fact exercised on zero scenarios FAILS the run, never reports 'na' ===\n");
  const fakeFacts = [{ id: "self_test_required_but_unexercised", required: true, appliesToScenario: () => false }];
  const fakeRows = [{ fact: fakeFacts[0].id, surface: "someSurface", scenario: "some_reason", verdict: "na", detail: "fact does not apply to this scenario's reason" }];

  const { coverageFailRows, zeroScenarioFacts } = analyzeFactCoverage(fakeRows, fakeFacts);
  console.log(`facts exercised on zero scenarios: ${zeroScenarioFacts.join(", ") || "none"}`);

  let allOk = true;
  if (coverageFailRows.length === 1 && coverageFailRows[0].verdict === "fail") {
    console.log(`   ok — the required-and-unexercised fact produced a FAIL row: ${coverageFailRows[0].detail}`);
  } else {
    console.log("   FAIL — a required fact exercised on zero scenarios did not fail the run");
    allOk = false;
  }
  const code = overallExitCode([...fakeRows, ...coverageFailRows]);
  if (code === 1) {
    console.log("   ok — overall exit code is 1 (a real defect), not 0");
  } else {
    console.log(`   FAIL — overall exit code was ${code}, expected 1`);
    allOk = false;
  }

  console.log(`\n${allOk ? "SELF-TEST PASSED — GAP 2's coverage check fails correctly before it can ever pass" : "SELF-TEST FAILED"}`);
  process.exit(allOk ? 0 : 1);
}

// ---------------------------------------------------------------------------
// GAP 1 SELF-TEST (rca-h7v): "Prove exit 2 for a genuinely stale scenario
// before you touch the reporting path." Entirely offline — synthetic
// scenarios and a fixed deploy time, no target, no network.
// ---------------------------------------------------------------------------
async function selfTestStale() {
  console.log("=== SELF-TEST: GAP 1 (rca-h7v) — a FAIL whose evidence predates the deploy is STALE (exit 2), never a live defect ===\n");
  const deployTime = new Date("2026-08-22T13:20:58Z");
  const scenarios = [
    { reason: "self_test_stale_reason", decision: { id: "self-test-stale", at: "2026-08-22T07:37:34Z" } },
    { reason: "self_test_fresh_reason", decision: { id: "self-test-fresh", at: "2026-08-22T13:25:00Z" } },
  ];
  const rows = [
    { fact: "someFact", surface: "someSurface", scenario: "self_test_stale_reason", verdict: "fail", detail: "synthetic fail on pre-deploy evidence" },
    { fact: "someFact", surface: "someSurface", scenario: "self_test_fresh_reason", verdict: "fail", detail: "synthetic fail on post-deploy evidence" },
  ];

  const marked = markStaleFailures(rows, scenarios, deployTime);
  const staleRow = marked.find((r) => r.scenario === "self_test_stale_reason");
  const freshRow = marked.find((r) => r.scenario === "self_test_fresh_reason");

  let allOk = true;
  if (staleRow.verdict === "stale") {
    console.log(`   ok — pre-deploy evidence downgraded: ${staleRow.detail.slice(0, 100)}...`);
  } else {
    console.log(`   FAIL — pre-deploy evidence was NOT downgraded to stale (verdict: ${staleRow.verdict})`);
    allOk = false;
  }
  if (freshRow.verdict === "fail") {
    console.log("   ok — post-deploy evidence stayed a real FAIL");
  } else {
    console.log(`   FAIL — post-deploy evidence was wrongly downgraded (verdict: ${freshRow.verdict})`);
    allOk = false;
  }
  const code = overallExitCode(marked);
  if (code === 2) {
    console.log('   ok — overall exit code is 2 ("could not tell"), not 1, when any fail is stale');
  } else {
    console.log(`   FAIL — overall exit code was ${code}, expected 2`);
    allOk = false;
  }

  console.log(`\n${allOk ? "SELF-TEST PASSED — GAP 1's stale verdict behaves correctly" : "SELF-TEST FAILED"}`);
  process.exit(allOk ? 0 : 1);
}

// ---------------------------------------------------------------------------
// FALSIFICATION: re-find the three known regressions at their pre-fix commits.
// ---------------------------------------------------------------------------
async function runRegressionsMode() {
  console.log("=== Regression re-find: E3-F12, E4-F14, E4-F15 ===\n");
  const results = await runRegressionSuite();
  let allFound = true;
  for (const r of results) {
    console.log(`${r.id} (${r.refBefore} -> ${r.refAfter}): ${r.reFound ? "RE-FOUND" : "NOT RE-FOUND"}`);
    if (!r.reFound) allFound = false;
  }
  if (!allFound) {
    console.log(
      "\nAt least one regression could NOT be re-found at its pre-fix commit. Per rca-tcj: " +
        "'it is not worth keeping — say so and stop.' STOPPING."
    );
    process.exit(1);
  }
  console.log("\nAll three regressions re-found at their pre-fix commits, and are green at HEAD.");
  process.exit(0);
}

// ---------------------------------------------------------------------------
// THE FULL RUN
// ---------------------------------------------------------------------------
async function fullRun({ explicitTarget, noBrowser }) {
  let baseUrl;
  try {
    baseUrl = resolveTarget({ explicit: explicitTarget });
    const portalKey = process.env.PORTAL_ACCESS_KEY;
    console.log(`Target: ${baseUrl}`);
    await verifyPortalKey({ baseUrl, portalKey });

    if (!config.remote.token) throw new SurfaceUnreachableError("REMOTE_API_TOKEN not set", { code: "missing_env" });
    if (!process.env.ZENDESK_SUBDOMAIN) throw new SurfaceUnreachableError("ZENDESK_SUBDOMAIN not set", { code: "missing_env" });

    const remote = new RemoteClient({ baseUrl: config.remote.baseUrl, token: config.remote.token });
    const zendesk = new ZendeskClient({
      subdomain: config.zendesk.subdomain,
      clientId: config.zendesk.oauthClientId,
      clientSecret: config.zendesk.oauthClientSecret,
      scope: "read write", // NOT the ZendeskClient default (`tickets:read tickets:write`) — see
      // scripts/verify-surfaces.mjs's own bead reconnaissance: omitting/narrowing scope here
      // returns a token that 403s on /api/v2/groups, which the ticket-meta surface needs.
    });

    console.log("\n=== Discovering scenarios (rule 3: from real decisions, never fixtured) ===");
    console.log(`Use case: ${REGISTRY.useCase} (tier ${REGISTRY.tier}, registry ${REGISTERED.length} of 9 written)`);
    const { found: scenarios, missingRequired, totalScanned } = await discoverScenarios({
      baseUrl, portalKey, useCase: REGISTRY.useCase, requiredReasons: REGISTRY.requiredReasons,
    });
    console.log(`Scanned ${totalScanned} real decisions.`);
    for (const s of scenarios) {
      console.log(`  ${s.reason.padEnd(30)} -> decision ${s.decision.id} (ticket ${s.decision.zendeskTicketId ?? s.decision.externalRef}, at ${s.decision.at})`);
    }
    if (missingRequired.length > 0) {
      console.log("\nMISSING REQUIRED SCENARIO(S) — this is a FAILURE, not a skip (rule 3 / C-16):");
      for (const e of missingRequired) console.log(`  - ${e.message}`);
    }

    const surfaces = makeZendeskSurfaces(zendesk); // zendeskPublicReply, zendeskInternalNote, zendeskTicketMeta
    if (!REGISTRY.reachesZendesk) {
      // MEASURED, not configured: of 60 UC-02 decisions in production, ZERO
      // carry a numeric Zendesk reference. Saying so out loud matters, because
      // every note/reply/tag fact will read `na` for want of a surface, and an
      // `na` that means "this use case has no hand-off at all" must not be
      // read as "this use case is fine".
      console.log(`\n  NOTE: no ${REGISTRY.useCase} decision row can be JOINED to a Zendesk ticket.`);
      console.log("  Tickets DO exist for this use case; no decision row carries their id, so this runner");
      console.log("  cannot reach a note or a tag from a decision. Its note/reply/tag facts read `na` for");
      console.log("  want of a JOIN, not for want of a hand-off — those are different defects and the");
      console.log("  second one is worse. Neither is a clean bill of health.");
    }

    let thirdPartyDoorResult = null;
    if (!noBrowser) {
      try {
        surfaces.zafSidebarBody = makeZafSidebarSurface({
          subdomain: config.zendesk.subdomain,
          storageStatePath: process.env.ZENDESK_E2E_STORAGE_STATE || `${process.env.HOME}/.secrets/zendesk-e2e/storageState.json`,
        });
        const doorSurface = makeThirdPartyDoorSurface({ baseUrl });
        console.log("\n=== F-1: third-party door form (functional, not just 'does the page load') ===");
        thirdPartyDoorResult = await doorSurface.submitOnce();
        console.log(`  submitted=${thirdPartyDoorResult.submitted} message=${JSON.stringify(thirdPartyDoorResult.message ?? thirdPartyDoorResult.error)}`);
      } catch (err) {
        console.log(`  browser surfaces unavailable: ${err.message}`);
      }
    }

    // UC-01's letter-shaped positive lead is swapped for the one THIS registry
    // declares. Six of nine use cases were failing that fact for producing no
    // letter — which most of them are not supposed to produce. The GUARD is
    // unchanged and still required: an artifact that never appears fails the
    // run, whatever the artifact is.
    //
    // Built ONCE and used for BOTH the loop and the coverage analysis. The
    // first version mapped it inline at the loop and left analyzeFactCoverage()
    // reading ALL_FACTS, so the retired fact was still coverage-checked, found
    // on zero scenarios, and reported FAIL — a run failing for a fact it was no
    // longer running. Two sources for one list is how that happens.
    const FACTS = ALL_FACTS.map((f) =>
      f.id === "positiveLeadRendersLetter" ? makePositiveLeadFact(REGISTRY) : f);

    console.log("\n=== Running the fact loop (rule 1: every fact x every surface x every scenario) ===");
    let { rows } = await runFactLoop({
      scenarios,
      surfaces,
      // UC-01's letter-shaped positive lead is swapped for the one this
      // registry declares. Six of nine use cases were failing that fact for
      // producing no letter — which most of them are not supposed to produce.
      // The GUARD is unchanged and still required: an artifact that never
      // appears fails the run, whatever the artifact is.
      facts: FACTS,
      resolveSubject: (scenario) => resolveSubject(remote, scenario.decision.employmentId),
    });

    // GAP 1 (rca-h7v): a FAIL whose evidence predates the deploy that could
    // have changed the surface it is judging is not a live defect — it is
    // unknown, and reported as such (verdict "stale", exit 2), never as a
    // FAIL. Conservative first version: one global deploy time (HEAD's own
    // commit), not per-surface provenance.
    const deployTime = getCommitTimestamp({ ref: "HEAD" });
    console.log(`\nDeploy time (HEAD's commit, GAP 1 rca-h7v): ${deployTime.toISOString()}`);
    rows = markStaleFailures(rows, scenarios, deployTime);

    // GAP 2 (rca-h7v): a fact with no scenario is indistinguishable from a
    // passing one unless it is named. A REQUIRED fact exercised on zero
    // scenarios FAILS the run rather than sitting as a silent "na".
    const { zeroScenarioFacts, oneScenarioFacts, coverageFailRows } = analyzeFactCoverage(rows, FACTS);
    rows.push(...coverageFailRows);

    console.log("\n" + formatGrid(rows));

    console.log("\n=== Fact coverage (GAP 2, rca-h7v) ===");
    console.log(`facts exercised on zero scenarios: ${zeroScenarioFacts.join(", ") || "none"}`);
    console.log(`facts exercised on exactly one scenario: ${oneScenarioFacts.join(", ") || "none"}`);

    console.log("\n=== Details ===");
    for (const r of rows) {
      if (r.verdict === "fail" || r.verdict === "unreadable" || r.verdict === "stale") {
        console.log(`[${r.verdict.toUpperCase()}] ${r.fact} / ${r.surface} / ${r.scenario}: ${r.detail}`);
      }
    }

    const THIRD_PARTY_ACK =
      "If we're able to confirm anything with the person named, you'll hear from us at the contact you provided.";
    if (thirdPartyDoorResult) {
      const ok = thirdPartyDoorResult.submitted;
      console.log(`\nF-1 verdict: ${ok ? "PASS" : "FAIL"} — door form ${ok ? "submitted and showed an acknowledgement" : "did not operate"}`);
      if (!ok) rows.push({ fact: "thirdPartyDoorOperable", surface: "thirdPartyDoorForm", scenario: "n/a", verdict: "fail", detail: thirdPartyDoorResult.error ?? "form did not submit" });
    }

    const missingCount = missingRequired.length;
    const code = missingCount > 0 ? 1 : overallExitCode(rows);
    console.log(`\n${code === 0 ? "CLEAN" : code === 1 ? "DEFECT(S) FOUND" : "COULD NOT TELL"} — exit ${code}`);
    await closeSharedBrowser();
    process.exit(code);
  } catch (err) {
    await closeSharedBrowser().catch(() => {});
    if (err instanceof SurfaceUnreachableError) {
      console.error(`\nCOULD NOT TELL (exit 2): [${err.code}] ${err.message}`);
      process.exit(2);
    }
    console.error(`\nCOULD NOT TELL (exit 2): unexpected error: ${err.stack}`);
    process.exit(2);
  }
}

main();
