// ---------------------------------------------------------------------------
// claimNodeContract.test.js — the idempotency wiring, pinned offline
// ---------------------------------------------------------------------------
// WHY THIS EXISTS, AND WHY IT IS SEPARATE FROM THE LIVE CHECKER
//
// scripts/verify-claim-nodes.mjs asks the only question that finally matters:
// is the claim node wired and published in the graph serving traffic? It needs
// n8n credentials and the network, so it can never run in `npm test` — and a
// check that only runs when someone remembers to run it is a check that stops
// running.
//
// This file pins the half that CAN be proved with nothing but the repo: the
// contract the deployment is built from. Concretely,
// scripts/add-claim-nodes.mjs generates the `Carry Context After Claim` Code
// body as a string, and a Code node body is just a string to n8n — a broken one
// deploys happily and fails at runtime, mid-ticket, having already claimed the
// ref so the retry is treated as a duplicate. Executing it here turns that into
// a failing test.
//
// What is deliberately NOT pinned here: the claim node's own parameter literals
// (table, credential id, onError, the four field expressions). Asserting those
// against the same file that defines them would restate the script's constants
// back to itself and prove nothing — whether they are RIGHT is a question about
// the live graph and the live Supabase table, which is the checker's job.
// ---------------------------------------------------------------------------

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";
import { MAPPINGS as MAPPINGS_IMPORTED } from "../scripts/lib/deployedNodeMappings.mjs";
import { CLAIM_TARGETS } from "../workflows/nodes/claimNodeSpec.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const scriptSource = (name) => readFileSync(join(__dirname, "..", "scripts", name), "utf8");

const ADD = scriptSource("add-claim-nodes.mjs");
const VERIFY_CLAIMS = scriptSource("verify-claim-nodes.mjs");

/**
 * Lift an array literal out of a script by name.
 *
 * These scripts run network calls at module scope, so they cannot be imported —
 * doing so would fire real requests from `npm test`, which is exactly the
 * hermeticity failure this suite exists to prevent. Reading the source and
 * evaluating just the literal keeps the test offline while still reading the
 * real thing rather than a copy of it.
 */
function arrayLiteral(source, name, where) {
  const m = new RegExp(`const ${name} = (\\[[\\s\\S]*?\\n\\]);`).exec(source);
  assert.ok(m, `could not find "const ${name} = [...]" in ${where} — the extraction below is now blind, which is worse than a failure`);
  return new Function(`return ${m[1]}`)();
}

const TARGETS = arrayLiteral(ADD, "TARGETS", "add-claim-nodes.mjs");
// CLAIM_TARGETS MOVED TO A MODULE (2026-08-31, the account-qualified ledger
// key). It used to be an array literal inside verify-claim-nodes.mjs and had to
// be scraped out of the source, because that script runs network calls at
// module scope and cannot be imported. workflows/nodes/claimNodeSpec.js is
// side-effect-free — the deploy and the live checker now read the same object
// out of it — so this reads the real table directly, the same upgrade
// deployedNodeMappings.mjs got in rca-rqeo. The textual extraction stays for
// add-claim-nodes.mjs, which is still a script.
// rca-rqeo moved MAPPINGS out of verify-deployed-nodes.mjs (which cannot be
// imported — it runs network calls at module scope) into scripts/lib/
// deployedNodeMappings.mjs, a side-effect-free module. That module CAN be
// imported directly, which is simpler and less fragile than the textual
// extraction the other two tables still need.
const MAPPINGS = MAPPINGS_IMPORTED;

/**
 * Rebuild the `Carry Context After Claim` body exactly as the script would.
 *
 * The body is assembled as a concatenation of template literals referencing
 * `t.gates`, so the expression is lifted verbatim and evaluated with a target
 * bound. If the script's shape changes, the assertion inside fails loudly
 * rather than silently generating an empty string that passes everything.
 */
function generateCarryBody(target) {
  const m = /jsCode:([\s\S]*?),\n\s*\},/.exec(ADD);
  assert.ok(m, 'could not lift the jsCode expression out of add-claim-nodes.mjs');
  const body = new Function("t", `return (${m[1]})`)(target);
  assert.ok(body.length > 0, "the generated Code body is empty");
  return body;
}

/**
 * Run a Code node body the way n8n does: wrapped in a function (the body ends
 * in a bare `return`, only legal inside one), with n8n's globals mocked.
 *
 * The result is JSON round-tripped. Objects built inside a vm context belong to
 * a different realm, so their prototypes are not the ones assert.deepEqual
 * compares against and every comparison would fail on prototype identity rather
 * than on content. n8n serialises between nodes too, so this is also what
 * production sees.
 */
function runCarryNode(body, { gatesName, gatesJson }) {
  const lookups = [];
  const sandbox = {
    $: (name) => {
      lookups.push(name);
      if (name !== gatesName) throw new Error(`Unexpected $() lookup for "${name}"`);
      return { first: () => ({ json: gatesJson }) };
    },
  };
  const result = vm.runInNewContext(`(function () {\n${body}\n})()`, sandbox, { timeout: 5000 });
  return { items: JSON.parse(JSON.stringify(result)), lookups };
}

/** A decision context with the shape every downstream node reads off it. */
const gatesOutput = () => ({
  externalRef: "4242",
  employmentId: "emp_001",
  decision: "human_review",
  reason: "over_scope_request",
  flags: ["over_scope_disclosure_requested"],
  riskTier: "medium",
  employment: { id: "emp_001", status: "active" },
  session: { authenticatedEmail: "ada@example.com" },
});

// ---------------------------------------------------------------------------
// 1. The generated Code body actually does its one job.
// ---------------------------------------------------------------------------

test("1. Carry Context returns the GATES' output, not the Supabase insert response", () => {
  // The whole reason this node exists. The claim node emits its own insert
  // response; if that reached the audit node, every field it reads would be
  // undefined and n8n would report success the entire way down.
  const target = TARGETS.find((t) => t.uc === "UC-02");
  const json = gatesOutput();
  const { items } = runCarryNode(generateCarryBody(target), { gatesName: target.gates, gatesJson: json });

  assert.equal(items.length, 1, "n8n expects a list of items");
  assert.deepEqual(items[0].json, json, "the decision context must arrive downstream unchanged");
});

test("2. Carry Context sets pairedItem — the load-bearing detail that is easy to drop", () => {
  // Several of these graphs address the gates node by name ($('…Gates').item),
  // which resolves through item pairing. A Code node returning a bare object
  // breaks the chain, and the failure surfaces as "can't determine which item
  // to use" in a node nowhere near the cause.
  const target = TARGETS.find((t) => t.uc === "UC-09");
  const { items } = runCarryNode(generateCarryBody(target), {
    gatesName: target.gates,
    gatesJson: gatesOutput(),
  });

  assert.deepEqual(items[0].pairedItem, { item: 0 }, "without pairedItem, $('Gates').item stops resolving downstream");
});

test("3. the body addresses ITS OWN gates node, and no other", () => {
  // The generator interpolates the gates name into the source. A body that
  // named the wrong node would still compile, still run, and quietly restore
  // some other node's output — so the sandbox throws on any unexpected lookup
  // and the assertion below names the node that was actually asked for.
  for (const target of TARGETS) {
    const { lookups } = runCarryNode(generateCarryBody(target), {
      gatesName: target.gates,
      gatesJson: gatesOutput(),
    });
    assert.deepEqual(lookups, [target.gates], `${target.uc} must read back "${target.gates}"`);
  }
});

test("4. every generated body compiles", () => {
  // A Code node body is a string to n8n: a syntax error deploys happily and
  // only fails mid-ticket. This is the same cheap guard n8nParity.test.js keeps
  // over workflows/nodes/*.js, applied to the bodies that are generated rather
  // than stored as files.
  for (const target of TARGETS) {
    const body = generateCarryBody(target);
    assert.doesNotThrow(() => new Function(body), `${target.uc}'s Carry Context body does not compile`);
  }
});

test("5. the body only reads — it may not decide, write or edit the context", () => {
  // Restoring context is all this node is for. If it ever started deriving a
  // decision, the gates would have a second, unreviewed copy of themselves
  // sitting in the middle of the graph — the duplicated-logic failure this
  // project has already paid for twice.
  for (const target of TARGETS) {
    const body = generateCarryBody(target);
    const code = body
      .split("\n")
      .filter((l) => !l.trim().startsWith("//"))
      .join("\n");
    assert.equal(code.split("return").length - 1, 1, `${target.uc}: exactly one return, no branching`);
    assert.doesNotMatch(code, /\bif\b|\?|&&|\|\|/, `${target.uc}: no decision logic belongs in Carry Context`);
    assert.doesNotMatch(code, /decision\s*[:=]/, `${target.uc}: must not set a decision of its own`);
  }
});

// ---------------------------------------------------------------------------
// 2. The table that says which graphs get a claim at all.
// ---------------------------------------------------------------------------

test("6. the builder covers exactly UC-01…UC-09", () => {
  // Pinning the exact set means a tenth use case cannot be added later without
  // someone consciously deciding whether it needs a claim — the alternative is
  // a new graph that writes durably on every redelivery and nobody noticing,
  // which is precisely how UC-01's duplicate letter reached a real customer.
  //
  // UC-01 was originally OUTSIDE this set: its claim node was hand-built first
  // and the script existed only to bring the other eight up to it. It was added
  // when the externalRef fallback had to be rolled out to every graph — at
  // which point a builder that could not touch UC-01 would have left the one
  // graph that auto-replies to customers as the only one still able to drop a
  // ref-less request.
  assert.deepEqual(
    TARGETS.map((t) => t.uc).sort(),
    ["UC-01", "UC-02", "UC-03", "UC-04", "UC-05", "UC-06", "UC-07", "UC-08", "UC-09"]
  );
  assert.equal(new Set(TARGETS.map((t) => t.id)).size, TARGETS.length, "two rows sharing a workflow id would silently skip one");
});

test("7. the builder and the checker describe the same nine graphs", () => {
  // Two tables, two files, one deployment. A checker that has stopped covering
  // a graph the builder still edits reports a clean bill of health about a
  // workflow nobody is looking at — worse than having no checker, because it
  // is believed. Same discipline as test/n8nParity.test.js: the duplication is
  // allowed to exist only because something fails when the copies diverge.
  const checker = new Map(CLAIM_TARGETS.map((t) => [t.uc, t]));
  assert.ok(checker.has("UC-01"), "UC-01 auto-replies to real customers — it must be checked");
  assert.equal(checker.size, TARGETS.length, "every graph the builder edits must also be checked");

  for (const t of TARGETS) {
    const c = checker.get(t.uc);
    assert.ok(c, `${t.uc} is built with a claim node but never checked`);
    assert.equal(c.id, t.id, `${t.uc}: workflow id disagrees`);
    assert.equal(c.gates, t.gates, `${t.uc}: gates node name disagrees`);
    assert.equal(c.next, t.next, `${t.uc}: first-durable-write node disagrees`);
    assert.equal(c.decision, t.decision, `${t.uc}: claimed decision expression disagrees`);
  }
});

test("8. every gates node named here is a real, deployed node name", () => {
  // The third independent record of these graphs is verify-deployed-nodes.mjs,
  // which pairs each workflow id with the Code node bodies it deploys. Checking
  // the claim tables against it catches the rename that would otherwise make
  // both files agree with each other and neither with n8n — the failure mode
  // where a wrong answer is confirmed by a second copy of itself.
  const deployed = new Set(MAPPINGS.map((m) => `${m.workflowId}::${m.node}`));
  for (const t of CLAIM_TARGETS) {
    assert.ok(
      deployed.has(`${t.id}::${t.gates}`),
      `${t.uc}: "${t.gates}" on ${t.id} is not a node verify-deployed-nodes.mjs knows about`
    );
  }
});

test("9. the two 🔴 dossier graphs claim a literal decision, never an expression", () => {
  // UC-07 and UC-08 have no branch: every run escalates, by design, and no
  // execution path exists to produce a decision to read. An expression there
  // would record null on every claim row — which reads, forensically, as "the
  // gates produced nothing", the exact opposite of what is true.
  for (const uc of ["UC-07", "UC-08"]) {
    const t = CLAIM_TARGETS.find((x) => x.uc === uc);
    assert.equal(t.decision, "escalate", `${uc} must record its one and only outcome literally`);
  }
  for (const t of CLAIM_TARGETS.filter((x) => !["UC-07", "UC-08"].includes(x.uc))) {
    assert.match(t.decision, /^=\{\{/, `${t.uc} decides, so its claim row must record which decision`);
  }
});
