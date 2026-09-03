// ---------------------------------------------------------------------------
// claimRefQualification.test.js — the ledger key, on both execution paths
// ---------------------------------------------------------------------------
// `workflow_claims` is ONE table shared by the Node app and the nine n8n
// graphs, so the two paths must compute the same key from the same input or
// each reads the other's refs as unclaimed — the two-ledger failure the single
// table exists to prevent, reintroduced one level down.
//
// The Node path calls qualifyClaimRef(). The n8n path evaluates a STRING, and a
// string is not covered by any test that imports a function. So this file does
// what test/n8nParity.test.js does for Code-node bodies: it EXECUTES the
// published expression in a node:vm sandbox with n8n's own `$json` / `$execution`
// in scope, and asserts the two agree over one shared table of inputs.
// ---------------------------------------------------------------------------

import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";

import {
  qualifyClaimRef,
  claimRefCandidates,
  currentZendeskAccount,
  BARE_TICKET_REF,
} from "../src/shared/claimRef.js";
import { EXTERNAL_REF_EXPR, externalRefExpression, claimNodeIssues, CLAIM_TARGETS } from "../workflows/nodes/claimNodeSpec.js";

/** Evaluate the n8n expression the way n8n does: the body between `{{` and `}}`. */
function evalExpression(expr, { externalRef, executionId = "9999" }) {
  const body = expr.replace(/^=\{\{/, "").replace(/\}\}$/, "").trim();
  const sandbox = { $json: { externalRef }, $execution: { id: executionId } };
  return vm.runInNewContext(`(${body})`, sandbox);
}

// Every shape a real external ref has taken in this repository, plus the two
// that broke it. Both paths are driven from THIS list — a case added here is
// automatically demanded of both.
const CASES = [
  { input: "93", why: "a bare Zendesk ticket number — the case that broke UC-01" },
  { input: 93, why: "the same, arriving as a number rather than a string" },
  { input: "143", why: "the retired account's high-water mark" },
  { input: "claim-proof-uc07-a", why: "a descriptive proof ref" },
  { input: "uc03-continuation-9002", why: "contains digits but is not a ticket id" },
  { input: "portal-a1b2c3", why: "a portal submission id" },
  { input: "3537d9ee-2017-4a53-952e-9d3b042aeab5", why: "an authorization UUID (UC-04 stage 3)" },
  { input: "your-subdomainhelp:93", why: "an already-qualified ref — must not be qualified twice" },
];

test("the n8n expression and the Node path compute the SAME ledger key", () => {
  for (const c of CASES) {
    assert.equal(
      evalExpression(EXTERNAL_REF_EXPR, { externalRef: c.input }),
      qualifyClaimRef(c.input),
      `disagreed on ${JSON.stringify(c.input)} (${c.why}) — the two execution paths would key differently`
    );
  }
});

test("a bare ticket number is qualified with the account that minted it", () => {
  const account = currentZendeskAccount();
  assert.equal(account, "your-subdomainhelp", "the open row in ZENDESK_ACCOUNTS is the account tickets are minted on");
  assert.equal(qualifyClaimRef("93"), "your-subdomainhelp:93");
  // THE WHOLE POINT: the new key cannot collide with the old one. `93` on the
  // retired account claimed `93`; `93` on this account claims something else.
  assert.notEqual(qualifyClaimRef("93"), "93");
});

test("qualification is idempotent — a second pass never produces account:account:93", () => {
  const once = qualifyClaimRef("93");
  assert.equal(qualifyClaimRef(once), once);
  assert.equal(qualifyClaimRef(qualifyClaimRef(once)), once);
});

test("a ref that is not a bare ticket number is passed through untouched", () => {
  // These are already globally unique and name no account. Qualifying them
  // would change a key for no reason AND break continuity with the rows that
  // already hold them — a new failure in exchange for nothing.
  for (const ref of ["claim-proof-uc07-a", "portal-a1b2c3", "3537d9ee-2017-4a53-952e-9d3b042aeab5"]) {
    assert.equal(qualifyClaimRef(ref), ref);
  }
});

test("BARE_TICKET_REF is anchored at both ends", () => {
  // Unanchored, it would match `uc03-continuation-9002` and qualify a reference
  // whose number is not a ticket id at all.
  assert.ok(BARE_TICKET_REF.test("9002"));
  assert.ok(!BARE_TICKET_REF.test("uc03-continuation-9002"));
  assert.ok(!BARE_TICKET_REF.test("9002-b"));
  assert.ok(!BARE_TICKET_REF.test("your-subdomainhelp:93"));
});

test("no reference at all still produces a key, on both paths", () => {
  // Both key columns are NOT NULL. A null insert fails the key, takes the error
  // output and vanishes at the duplicate NoOp — a green run that wrote nothing,
  // the same failure shape this whole change exists to remove.
  for (const empty of [undefined, null, ""]) {
    assert.match(evalExpression(EXTERNAL_REF_EXPR, { externalRef: empty }), /^unreferenced:9999$/);
    // The Node path answers null and its caller claims unconditionally rather
    // than keying on an execution id it does not have. Different mechanism,
    // same outcome: the request is processed, never silently dropped.
    assert.equal(qualifyClaimRef(empty), null);
  }
});

test("a reader can still find a claim filed under EITHER spelling", () => {
  // Rows written before 2026-08-31 hold the bare form. A human typing `93` into
  // the audit viewer means "the ticket in front of me"; answering "no claim"
  // because the row is filed as `your-subdomainhelp:93` would be the viewer
  // reporting an absence that is really a spelling.
  assert.deepEqual(claimRefCandidates("93"), ["your-subdomainhelp:93", "93"]);
  // Qualified first: a row under the new key was written by THIS account.
  assert.equal(claimRefCandidates("93")[0], "your-subdomainhelp:93");
  // A ref that is not a ticket number has exactly one spelling, not two.
  assert.deepEqual(claimRefCandidates("claim-proof-uc07-a"), ["claim-proof-uc07-a"]);
  assert.deepEqual(claimRefCandidates(""), []);
});

test("the expression refuses to be built when no single account is open", () => {
  // A half-qualified key (`null:93`) would be worse than no qualification at
  // all, so this throws rather than emitting one.
  assert.throws(() => externalRefExpression(null), /no single open account|cannot be qualified/);
});

test("all nine graphs are covered, and the checker fails a stale node", () => {
  assert.equal(CLAIM_TARGETS.length, 9, "one claim target per graph");
  assert.equal(new Set(CLAIM_TARGETS.map((t) => t.id)).size, 9, "no graph listed twice");

  const t = CLAIM_TARGETS[0];
  // NEGATIVE CONTROL: the exact node shape that is live right now, before this
  // change. If the checker passes this, it is checking nothing.
  const stale = {
    parameters: {
      tableId: "workflow_claims",
      fieldsUi: {
        fieldValues: [
          { fieldId: "use_case", fieldValue: t.uc },
          { fieldId: "external_ref", fieldValue: "={{ $json.externalRef || ('unreferenced:' + $execution.id) }}" },
          { fieldId: "decision", fieldValue: t.decision },
          { fieldId: "note", fieldValue: `=claimed by n8n workflow ${t.id}` },
        ],
      },
    },
  };
  const issues = claimNodeIssues(stale, t);
  assert.equal(issues.length, 1, `expected exactly the external_ref issue, got ${JSON.stringify(issues)}`);
  assert.match(issues[0], /external_ref/);

  assert.deepEqual(claimNodeIssues({ parameters: { tableId: "workflow_claims", fieldsUi: { fieldValues: [
    { fieldId: "use_case", fieldValue: t.uc },
    { fieldId: "external_ref", fieldValue: EXTERNAL_REF_EXPR },
    { fieldId: "decision", fieldValue: t.decision },
    { fieldId: "note", fieldValue: `=claimed by n8n workflow ${t.id}` },
  ] } } }, t), [], "the spec's own field values must pass its own checker");
});
