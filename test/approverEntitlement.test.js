// ---------------------------------------------------------------------------
// approverEntitlement.test.js  —  role entitlement on the four approval paths
// ---------------------------------------------------------------------------
// THE DEFECT (docs/APPROVAL-ROUTING.md §1.3). src/uc06/server.js and
// src/uc09/server.js both built their policy call as
// `{ role: body.role, approver: identity.approver }` — the identity verified,
// the ROLE taken straight off the request body, against a ZAF token that
// carries no role claim at all. UC-04 and UC-05 had no role concept whatsoever:
// `approver` only had to be a non-empty string, so any identity that could
// reach the approve route issued a work authorization. The four-eyes controls
// held (two different PEOPLE were genuinely required) and never once required
// an ENTITLED person.
//
// WHY THE POSITIVE TESTS COME FIRST IN THIS FILE, AND WHY THEY ARE THE POINT.
// A refusal test proves nothing on its own here. A roster with a typo in it, a
// role name that no longer matches the policy's own vocabulary, a check wired
// before the gate instead of after — every one of those produces a use case
// that refuses everything, and "refuses everything" is indistinguishable from
// "correctly cautious" unless something asserts that the RIGHT person still
// gets through. That is this repository's most expensive recurring defect
// (CLAUDE.md §4, §7's UC-03 write-up), so each of the four use cases below has
// an entitled approver driving a real approval end to end through its real
// HTTP handler.
// ---------------------------------------------------------------------------

import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";

import {
  parseRoster,
  createEntitlementChecker,
  createUnconfiguredEntitlement,
  entitlementRequired,
  resolveEntitlement,
  USE_CASE_ROLES,
  UC01_ROLE,
  UC04_ROLE,
  UC05_ROLE,
  NOT_ENTITLED,
  NOT_CONFIGURED,
} from "../src/review/approverEntitlement.js";

import { startMockServer, resetWorkAuthorizations } from "../src/remote/mockServer.js";
import { RemoteClient } from "../src/remote/restClient.js";
import { AuditLogger } from "../src/shared/audit.js";

import { AuthorizationStore } from "../src/uc04/authorizationStore.js";
import { handleWorkationRequest } from "../src/uc04/workflow.js";
import { createUc04Handler } from "../src/uc04/server.js";
import { draftSummary as uc04DraftSummary } from "../src/uc04/requestParser.js";
import { evaluateApprovalAction as uc04Evaluate } from "../src/uc04/approvalPolicy.js";

import { ResignationStore } from "../src/uc05/resignationStore.js";
import { handleResignationRequest } from "../src/uc05/workflow.js";
import { createUc05Handler } from "../src/uc05/server.js";
import { extractFromLetter } from "../src/uc05/letterExtractor.js";
import { evaluateSignoffAction as uc05Evaluate } from "../src/uc05/signoffPolicy.js";

import { AmendmentStore } from "../src/uc06/amendmentStore.js";
import { handleAmendmentRequest } from "../src/uc06/workflow.js";
import { createUc06Handler } from "../src/uc06/server.js";
import { draftSummary as uc06DraftSummary } from "../src/uc06/changeParser.js";
import { evaluateApprovalAction as uc06Evaluate, ROLES as UC06_POLICY_ROLES } from "../src/uc06/dualApprovalPolicy.js";

import { AdjustmentStore } from "../src/uc09/adjustmentStore.js";
import { handleAdjustmentRequest } from "../src/uc09/workflow.js";
import { createUc09Handler } from "../src/uc09/server.js";
import { judgeNarrative } from "../src/shared/narrativeJudge.js";
import { evaluateApprovalAction as uc09Evaluate, ROLES as UC09_POLICY_ROLES } from "../src/uc09/multiApprovalPolicy.js";

import { CaseStore } from "../src/shared/caseStore.js";
import { InMemoryReviewStore } from "../src/review/store.js";
import { createReviewHandler } from "../src/review/server.js";
import { handleVerificationTicket } from "../src/uc01/workflow.js";
import { classifyRequestRuleBased } from "../src/uc01/classifier.js";

// ---------------------------------------------------------------------------
// The roster every test below shares.
//
// It is deliberately NOT one person holding everything: `payroll.sam` holds
// UC-06's payroll_specialist AND UC-09's approver, `admin.ana` holds only
// UC-06's customer_admin, and `both.bea` holds both UC-09 slots — which is what
// lets the four-eyes tests prove that entitlement does not weaken segregation
// of duties even when the roster would happily allow one human to fill two
// slots.
// ---------------------------------------------------------------------------
const ROSTER_TEXT = [
  "mobility.sam@remote.test=mobility_specialist",
  "hr.jane@remote.test=hr_ops",
  "admin.ana@remote.test=uc06:customer_admin",
  "payroll.sam@remote.test=uc06:payroll_specialist,uc09:approver",
  "req.rita@remote.test=uc09:requester",
  "app.alan@remote.test=uc09:approver",
  "rel.ray@remote.test=uc09:payment_releaser",
  "both.bea@remote.test=uc09:requester,uc09:approver",
].join(";");

const entitlement = createEntitlementChecker({ grants: parseRoster(ROSTER_TEXT), source: "test roster" });

// ---------------------------------------------------------------------------
// 1. THE VOCABULARY MUST NOT DRIFT
// ---------------------------------------------------------------------------

test("USE_CASE_ROLES matches each policy's own ROLES set — a role in one and not the other is a dead gate", () => {
  // A role the policy accepts but the entitlement module has never heard of is
  // refused as "no entitlement is defined", which reads as a policy decision
  // and is actually a typo. Comparing the two sets is the only thing that keeps
  // them honest, because nothing else reads both.
  assert.deepEqual([...UC06_POLICY_ROLES].sort(), [...USE_CASE_ROLES["UC-06"]].sort());
  assert.deepEqual([...UC09_POLICY_ROLES].sort(), [...USE_CASE_ROLES["UC-09"]].sort());
  // UC-04/UC-05 have no policy ROLES set — the role is nominal and supplied by
  // the policy as a constant, so the constant is what has to match.
  assert.deepEqual(USE_CASE_ROLES["UC-04"], [UC04_ROLE]);
  assert.deepEqual(USE_CASE_ROLES["UC-05"], [UC05_ROLE]);
  assert.deepEqual(USE_CASE_ROLES["UC-01"], [UC01_ROLE]);
});

// ---------------------------------------------------------------------------
// 2. THE ROSTER ITSELF
// ---------------------------------------------------------------------------

test("a roster reads in both shapes people actually write", () => {
  const compact = parseRoster("sam@remote.test=mobility_specialist; jane@remote.test=hr_ops,uc06:customer_admin");
  const json = parseRoster('{"sam@remote.test":["mobility_specialist"],"jane@remote.test":["hr_ops","uc06:customer_admin"]}');
  assert.deepEqual([...compact.keys()].sort(), [...json.keys()].sort());
  for (const key of compact.keys()) {
    assert.deepEqual([...compact.get(key).grants].sort(), [...json.get(key).grants].sort());
  }
});

test("a bare role name grants that role wherever it is defined; a qualified one grants only that slot", () => {
  const bare = parseRoster("sam@remote.test=payroll_specialist");
  assert.deepEqual([...bare.values()][0].grants, new Set(["uc06:payroll_specialist"]));

  const qualified = parseRoster("sam@remote.test=uc09:approver");
  assert.deepEqual([...qualified.values()][0].grants, new Set(["uc09:approver"]));
});

test("a role name that matches nothing THROWS at parse time — a typo must not become an empty grant", () => {
  // The whole failure mode this module is written against: a roster with
  // `mobility_specialst` in it refuses every mobility specialist forever, and
  // looks exactly like a working gate while doing it. Objecting at build time
  // is the one place it is cheap to fix.
  assert.throws(() => parseRoster("sam@remote.test=mobility_specialst"), /unknown approver role/);
  assert.throws(() => parseRoster("sam@remote.test=uc06:payment_releaser"), /unknown approver role/);
  assert.throws(() => parseRoster("sam@remote.test="), /grants no roles/);
  assert.throws(() => parseRoster("sam@remote.test mobility_specialist"), /no "=" between/);
  assert.throws(() => parseRoster("{not json"), /not valid JSON/);
});

test("roster identities are matched with the repo's own definition of 'the same human', not with ===", () => {
  // isSameApprover() (NFKC, whitespace, case, confusable folding) is what UC-06
  // and UC-09 already use to decide four-eyes. A roster matching bytes instead
  // would give two different answers to one question about one person.
  const checker = createEntitlementChecker({ grants: parseRoster("Sam Patel=mobility_specialist") });
  for (const spelling of ["Sam Patel", "sam patel", " SAM PATEL "]) {
    assert.equal(
      checker.check({ useCase: "UC-04", role: UC04_ROLE, approver: spelling }),
      null,
      `${JSON.stringify(spelling)} is the same human as the roster entry`
    );
  }
});

// ---------------------------------------------------------------------------
// 3. THE DEFAULTS — pinned the way test/approverAuth.test.js pins F-20's
//    defaults, because the defect was never in the mechanism.
// ---------------------------------------------------------------------------

test("DEFAULT: with a durable store attached and nothing configured, entitlement is REQUIRED", () => {
  assert.equal(entitlementRequired({}, { persistent: true }), true);
});

test("DEFAULT: a seeded in-memory demo does not enforce it, so a fresh clone still approves", () => {
  assert.equal(entitlementRequired({}, { persistent: false }), false);
  const posture = resolveEntitlement({}, { persistent: false });
  assert.equal(posture.required, false);
  assert.equal(posture.entitlement, null, "not enforced must mean NOT CONSULTED, never a checker that says yes");
  assert.equal(posture.warning, null);
});

test("DEFAULT: an embedder that says nothing at all gets the strict posture", () => {
  assert.equal(entitlementRequired({}), true);
});

test("DEFAULT: both overrides are explicit, and the strict one wins when both are set", () => {
  assert.equal(entitlementRequired({ APPROVER_ROLES_ALLOW_ANY: "true" }, { persistent: true }), false);
  assert.equal(entitlementRequired({ APPROVER_ROLES_REQUIRE: "true" }, { persistent: false }), true);
  assert.equal(
    entitlementRequired({ APPROVER_ROLES_REQUIRE: "true", APPROVER_ROLES_ALLOW_ANY: "true" }, { persistent: false }),
    true,
    "contradictory configuration must resolve toward the safer reading"
  );
});

test('DEFAULT: only the literal string "true" weakens it — no truthiness, no near-misses', () => {
  for (const value of ["1", "yes", "TRUE", "True", " true", ""]) {
    assert.equal(entitlementRequired({ APPROVER_ROLES_ALLOW_ANY: value }, { persistent: true }), true);
  }
});

test("DEFAULT: required but unconfigured refuses by ITS OWN NAME, and never falls open", () => {
  // The loud failure, deliberately the same shape as a persistent deployment
  // with no ZAF verifier. The distinct code is the whole point: "nobody set
  // APPROVER_ROLES" and "this person is not a payroll specialist" are two
  // different afternoons of work and must not share a slug.
  const posture = resolveEntitlement({}, { persistent: true });
  assert.equal(posture.required, true);
  assert.ok(posture.entitlement, "unconfigured must produce a REFUSER, not a null that means 'not consulted'");
  assert.match(posture.warning, /APPROVER_ROLES/);

  const verdict = posture.entitlement.check({ useCase: "UC-09", role: "approver", approver: "anyone@remote.test" });
  assert.equal(verdict.allowed, false);
  assert.equal(verdict.code, NOT_CONFIGURED);
  assert.equal(verdict.status, 403);
  assert.match(verdict.reason, /APPROVER_ROLES/);
});

test("DEFAULT: an UNREADABLE roster refuses too — it never degrades to open", () => {
  const posture = resolveEntitlement({ APPROVER_ROLES: "sam@remote.test=not_a_role" }, { persistent: true });
  assert.equal(posture.required, true);
  assert.equal(posture.entitlement.check({ useCase: "UC-04", role: UC04_ROLE, approver: "sam@remote.test" }).code, NOT_CONFIGURED);
  assert.match(posture.warning, /could not be parsed/);
});

test("DEFAULT: a configured roster is the source, and its describe() names it without leaking it", () => {
  const posture = resolveEntitlement({ APPROVER_ROLES: ROSTER_TEXT }, { persistent: true });
  assert.equal(posture.required, true);
  assert.equal(posture.source, "APPROVER_ROLES");
  const described = posture.entitlement.describe();
  assert.equal(described.enforced, true);
  assert.equal(described.approvers, 8);
  assert.ok(described.grants >= 8);
});

// ---------------------------------------------------------------------------
// rca-pb8a: describe().coverage — the field that would have shown the K10
// fallout from OUTSIDE. A NEGATIVE CONTROL is required here, not a green
// test: `source: "APPROVER_ROLES"` and `writes: WORKING` were BOTH already
// true in the incident this bead exists for while UC-01 refused every
// approver — a coverage field that reports a healthy number regardless of
// what the roster actually grants is exactly that bug wearing a new name.
// ---------------------------------------------------------------------------

test("describe().coverage: a roster that grants ONLY uc05:hr_ops reports zero coverage for every OTHER enforcing use case", () => {
  // This is the exact shape rca-pb8a predicted: a scoped uc05:hr_ops entry
  // that shadows nothing for UC-01, UC-03, UC-04, UC-06 or UC-09.
  const posture = resolveEntitlement({ APPROVER_ROLES: "hr.jane@remote.test=uc05:hr_ops" }, { persistent: true });
  const coverage = posture.entitlement.describe().coverage;
  assert.equal(coverage["UC-05"], 1, "the roster DOES cover the use case it names");
  assert.equal(coverage["UC-01"], 0, "a scoped uc05:hr_ops grant must NOT cover UC-01");
  assert.equal(coverage["UC-03"], 0);
  assert.equal(coverage["UC-04"], 0);
  assert.equal(coverage["UC-06"], 0);
  assert.equal(coverage["UC-09"], 0);
});

test("describe().coverage: a BARE hr_ops grant covers both UC-01 and UC-05, unlike the scoped form above", () => {
  const posture = resolveEntitlement({ APPROVER_ROLES: "hr.jane@remote.test=hr_ops" }, { persistent: true });
  const coverage = posture.entitlement.describe().coverage;
  assert.equal(coverage["UC-01"], 1);
  assert.equal(coverage["UC-05"], 1);
  assert.equal(coverage["UC-03"], 0);
});

test("describe().coverage: counts DISTINCT approvers, not grants — two people on one slot still coverage 2", () => {
  const posture = resolveEntitlement(
    { APPROVER_ROLES: "app.alan@remote.test=uc09:approver;req.rita@remote.test=uc09:requester" },
    { persistent: true }
  );
  const coverage = posture.entitlement.describe().coverage;
  assert.equal(coverage["UC-09"], 2);
});

test("describe().coverage: the full ROSTER_TEXT fixture matches a hand count across every enforcing use case", () => {
  // ROSTER_TEXT: mobility.sam(mobility_specialist) hr.jane(hr_ops) admin.ana(uc06:customer_admin)
  // payroll.sam(uc06:payroll_specialist,uc09:approver) req.rita(uc09:requester) app.alan(uc09:approver)
  // rel.ray(uc09:payment_releaser) both.bea(uc09:requester,uc09:approver)
  const posture = resolveEntitlement({ APPROVER_ROLES: ROSTER_TEXT }, { persistent: true });
  const coverage = posture.entitlement.describe().coverage;
  assert.deepEqual(coverage, {
    "UC-01": 1, // hr.jane, bare hr_ops
    "UC-03": 0, // nobody holds travel_support_specialist
    "UC-04": 1, // mobility.sam
    "UC-05": 1, // hr.jane, bare hr_ops
    "UC-06": 2, // admin.ana, payroll.sam
    "UC-09": 5, // payroll.sam, req.rita, app.alan, rel.ray, both.bea
  });
});

test("describe().coverage: UNCONFIGURED/UNREADABLE/EMPTY rosters all report zero for EVERY enforcing use case", () => {
  // These are the three refuser postures resolveEntitlement() can return.
  // Each already refuses every approval; coverage must say so too, not go
  // quiet just because there is no roster to count.
  for (const env of [
    {}, // unset
    { APPROVER_ROLES: "sam@remote.test=not_a_role" }, // unreadable
  ]) {
    const posture = resolveEntitlement(env, { persistent: true });
    assert.deepEqual(posture.entitlement.describe().coverage, {
      "UC-01": 0,
      "UC-03": 0,
      "UC-04": 0,
      "UC-05": 0,
      "UC-06": 0,
      "UC-09": 0,
    });
  }
});

// ---------------------------------------------------------------------------
// 4. STRUCTURAL: the check can only ever REFUSE
// ---------------------------------------------------------------------------

test("STRUCTURAL: check() has no return value that means 'approved'", () => {
  const checkers = [entitlement, createUnconfiguredEntitlement()];
  const approvers = ["mobility.sam@remote.test", "nobody@evil.test", "", null, undefined, "   ", 42];
  let seen = 0;
  for (const checker of checkers) {
    for (const [useCase, roles] of Object.entries(USE_CASE_ROLES)) {
      for (const role of [...roles, "bogus_role", null]) {
        for (const approver of approvers) {
          const verdict = checker.check({ useCase, role, approver });
          seen++;
          if (verdict === null) continue;
          assert.equal(verdict.allowed, false, "the only non-null verdict this module may produce is a refusal");
          assert.ok(verdict.code && verdict.reason, "a refusal must name itself and explain itself");
          assert.equal(verdict.status, 403);
        }
      }
    }
    // An unknown use case is refused, not waved through. UC-01 is no longer a
    // genuinely absent use case (K10 added it to USE_CASE_ROLES) — UC-99 is.
    assert.equal(checker.check({ useCase: "UC-99", role: "anything", approver: "a@b.test" }).allowed, false);
  }
  assert.ok(seen > 200, `the grid must actually be a grid (saw ${seen} inputs)`);
});

// ---------------------------------------------------------------------------
// 5. STRUCTURAL: it cannot convert a refusal into an approval, over a grid
//
// MUTATION-VERIFIED. Breaking createEntitlementChecker().check() to return
// `{allowed: true, code: "approve", status: 200, reason: "ok"}` for an
// unentitled approver turns this test red at
//   "a refusal must survive the entitlement check unchanged"
// and breaking the CALL SITE in any of the four policies — moving the
// `if (entitlement)` block above the actionability check — turns it red at the
// same assertion, because a not-found/escalated row then refuses with
// approver_not_entitled instead of its own reason. Restored after checking.
// The technique is copied from test/uc09ApprovalFloor.test.js.
// ---------------------------------------------------------------------------

const UC06_ROWS = [
  null,
  { decision: "escalate", status: "pending_dual_approval" },
  { decision: "dual_approval_required", status: "executing" },
  { decision: "dual_approval_required", status: "executed", executedAt: "2026-08-01T00:00:00Z" },
  { decision: "dual_approval_required", status: "pending_dual_approval" },
  {
    decision: "dual_approval_required",
    status: "pending_dual_approval",
    adminApproval: { approver: "admin.ana@remote.test", at: "2026-08-01T00:00:00Z" },
  },
];

const UC09_ROWS = [
  null,
  { decision: "escalate", status: "pending_approval", approvalSlotsRequired: 2 },
  { decision: "dual_approval_required", status: "executing", approvalSlotsRequired: 2 },
  { decision: "dual_approval_required", status: "denied", approvalSlotsRequired: 2 },
  { decision: "dual_approval_required", status: "pending_approval", approvalSlotsRequired: 2 },
  {
    decision: "dual_approval_required",
    status: "pending_approval",
    approvalSlotsRequired: 2,
    requesterApproval: { approver: "req.rita@remote.test", at: "2026-08-01T00:00:00Z" },
  },
];

const UC04_ROWS = [
  null,
  { decision: "blocked", status: "blocked" },
  { decision: "escalate", status: "escalated" },
  { decision: "ready_for_approval", status: "executed", approvedAt: "2026-08-01T00:00:00Z" },
  { decision: "ready_for_approval", status: "pending_specialist_approval" },
];

const UC05_ROWS = [
  null,
  { decision: "escalate", status: "escalated" },
  { decision: "prepared_for_signoff", status: "signed_off", signedOffBy: { approver: "hr.jane@remote.test" } },
  { decision: "prepared_for_signoff", status: "pending_signoff" },
];

const APPROVERS = ["mobility.sam@remote.test", "hr.jane@remote.test", "admin.ana@remote.test", "nobody@evil.test", "", null];

test("STRUCTURAL GRID: entitlement never turns a refusal into an approval, and never changes a refusal's reason", () => {
  let inputs = 0;
  let refusalsSeen = 0;
  let approvalsBlocked = 0;
  let approvalsKept = 0;

  const cases = [
    ...UC06_ROWS.flatMap((amendmentRow) =>
      ["customer_admin", "payroll_specialist", "bogus"].flatMap((role) =>
        ["approve", "decline", "frobnicate"].flatMap((action) =>
          APPROVERS.map((approver) => ({
            run: (ent) => uc06Evaluate({ amendmentRow, role, approver, action, entitlement: ent }),
          }))
        )
      )
    ),
    ...UC09_ROWS.flatMap((adjustmentRow) =>
      ["requester", "approver", "payment_releaser", "bogus"].flatMap((role) =>
        ["approve", "deny", "frobnicate"].flatMap((action) =>
          APPROVERS.map((approver) => ({
            run: (ent) => uc09Evaluate({ adjustmentRow, role, approver, action, entitlement: ent }),
          }))
        )
      )
    ),
    ...UC04_ROWS.flatMap((authorizationRow) =>
      ["approve", "decline", "frobnicate"].flatMap((action) =>
        APPROVERS.map((approver) => ({
          run: (ent) => uc04Evaluate({ authorizationRow, approver, action, entitlement: ent }),
        }))
      )
    ),
    ...UC05_ROWS.flatMap((resignationRow) =>
      ["signoff", "decline", "frobnicate"].flatMap((action) =>
        APPROVERS.map((approver) => ({
          run: (ent) => uc05Evaluate({ resignationRow, approver, action, entitlement: ent }),
        }))
      )
    ),
  ];

  for (const { run } of cases) {
    inputs++;
    const base = run(null); // the policy exactly as it behaved before this change
    const gated = run(entitlement);

    if (base.allowed === false) {
      refusalsSeen++;
      assert.deepEqual(
        gated,
        base,
        "a refusal must survive the entitlement check unchanged — it may neither be lifted nor relabelled"
      );
      continue;
    }

    // The only two legal outcomes for something that WAS allowed.
    if (gated.allowed === true) {
      approvalsKept++;
      assert.deepEqual(gated, base, "an entitled approval must be byte-identical to the ungated one");
    } else {
      approvalsBlocked++;
      assert.equal(gated.code, NOT_ENTITLED);
      assert.equal(gated.status, 403);
    }
  }

  // A grid that produced no approvals at all would pass every assertion above
  // and prove nothing — the exact failure this file's header is about.
  assert.ok(inputs > 500, `grid too small to be a grid (${inputs})`);
  assert.ok(refusalsSeen > 100, `expected plenty of pre-existing refusals (${refusalsSeen})`);
  assert.ok(approvalsKept > 0, `an ENTITLED approver must still be allowed somewhere (${approvalsKept})`);
  assert.ok(approvalsBlocked > 0, `an unentitled approver must be refused somewhere (${approvalsBlocked})`);
});

// ---------------------------------------------------------------------------
// 6. END TO END, through the real HTTP handlers
// ---------------------------------------------------------------------------

let server;
let remote;

before(async () => {
  server = await startMockServer(4113); // test band; see src/shared/ports.js
  remote = new RemoteClient({ baseUrl: "http://localhost:4113" });
});
after(() => server && server.close());

function callApi(handler, { method, path, body = null, headers = {} }) {
  return new Promise((resolve, reject) => {
    const req = {
      method,
      url: path,
      headers,
      on(event, cb) {
        if (event === "data" && body) cb(Buffer.from(JSON.stringify(body)));
        if (event === "end") setImmediate(cb);
        return req;
      },
    };
    const res = {
      statusCode: 200,
      headers: {},
      setHeader(k, v) {
        this.headers[k.toLowerCase()] = v;
      },
      end(payload) {
        resolve({ status: this.statusCode, headers: this.headers, body: payload ? JSON.parse(payload) : null });
      },
    };
    handler(req, res).catch(reject);
  });
}

let audit;
beforeEach(() => {
  audit = new AuditLogger();
});

// Every LLM seam injected into its unconfigured branch — this devcontainer's
// .env carries a genuine but unreachable OPENAI_API_KEY, so an uninjected seam
// is a real, slow, doomed network call (CLAUDE.md §6).
const fakeJudge = async () => ({ verdict: "not_evaluated", reason: null });

// --- UC-04 -----------------------------------------------------------------

async function uc04Fixture() {
  resetWorkAuthorizations();
  const authorizationStore = new AuthorizationStore();
  const created = await handleWorkationRequest(
    {
      employmentId: "emp_active_001",
      session: { companyId: "co_amend_01", authenticatedAdminId: "admin_jane" },
      factors: {
        homeCountry: "DE",
        nationality: "DE",
        destination: { country: "ES" },
        startDate: "2026-09-01",
        endDate: "2026-09-14",
        visaType: "schengen_short_stay",
        jobDuties: "engineering",
        hasContractSigningAuthority: false,
      },
      now: "2026-08-15",
    },
    {
      remote,
      audit,
      authorizationStore,
      draftSummary: (args) => uc04DraftSummary(args, { isConfigured: () => false }),
      judge: fakeJudge,
    }
  );
  assert.equal(created.decision, "ready_for_approval");
  return {
    id: created.authorizationId,
    handler: createUc04Handler({ authorizationStore, audit, remote, entitlement }),
  };
}

test("POSITIVE UC-04: an entitled mobility specialist still approves, end to end", async () => {
  const { id, handler } = await uc04Fixture();
  const res = await callApi(handler, {
    method: "POST",
    path: `/api/authorizations/${id}/approve`,
    body: { approver: "mobility.sam@remote.test", note: "checked" },
  });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.ok(["executed", "approved_no_remote_record"].includes(res.body.code), res.body.code);
});

test("NEGATIVE UC-04: an approver on the roster for a DIFFERENT role is refused, and the reason says which", async () => {
  const { id, handler } = await uc04Fixture();
  const res = await callApi(handler, {
    method: "POST",
    path: `/api/authorizations/${id}/approve`,
    // A real, rostered human — just not a mobility specialist. Refusing an
    // unknown stranger would only prove the roster is a list of names; this
    // proves it is a list of ROLES.
    body: { approver: "hr.jane@remote.test", note: "let me" },
  });
  assert.equal(res.status, 403);
  assert.equal(res.body.code, NOT_ENTITLED);
  assert.match(res.body.reason, /mobility_specialist/);
  assert.match(res.body.reason, /UC-04/);
  // K10: `hr_ops` is now bare-granted in BOTH UC-01 and UC-05 (they share the
  // role — see approverEntitlement.js's USE_CASE_ROLES comment), so
  // hr.jane@remote.test's held-grants list grew to include uc01:hr_ops too.
  // The held-list order is alphabetical (parseRoster sorts nothing; `holds`
  // is built with `[...held.grants].sort()`), so uc01 sorts before uc05.
  assert.match(res.body.reason, /holds only: uc01:hr_ops, uc05:hr_ops/);
});

test("NEGATIVE UC-04: an identity nobody rostered is refused, and told so plainly", async () => {
  const { id, handler } = await uc04Fixture();
  const res = await callApi(handler, {
    method: "POST",
    path: `/api/authorizations/${id}/approve`,
    body: { approver: "nobody@evil.test" },
  });
  assert.equal(res.status, 403);
  assert.equal(res.body.code, NOT_ENTITLED);
  assert.match(res.body.reason, /not on the entitlement roster at all/);
});

test("UC-04 unchanged where entitlement is not enforced — the seeded-demo posture still approves", async () => {
  // The clone-and-run guarantee, asserted rather than assumed: the SAME
  // identity and the SAME request the roster refuses two tests up succeeds when
  // no entitlement is wired, which is the posture `npm run uc04-api` runs in on
  // a fresh clone with no APPROVER_ROLES and no Supabase.
  resetWorkAuthorizations();
  const authorizationStore = new AuthorizationStore();
  const created = await handleWorkationRequest(
    {
      employmentId: "emp_active_001",
      session: { companyId: "co_amend_01", authenticatedAdminId: "admin_jane" },
      factors: {
        homeCountry: "DE",
        nationality: "DE",
        destination: { country: "ES" },
        startDate: "2026-09-01",
        endDate: "2026-09-14",
        visaType: "schengen_short_stay",
        jobDuties: "engineering",
        hasContractSigningAuthority: false,
      },
      now: "2026-08-15",
    },
    {
      remote,
      audit,
      authorizationStore,
      draftSummary: (args) => uc04DraftSummary(args, { isConfigured: () => false }),
      judge: fakeJudge,
    }
  );
  const openHandler = createUc04Handler({ authorizationStore, audit, remote }); // no `entitlement` at all
  const res = await callApi(openHandler, {
    method: "POST",
    path: `/api/authorizations/${created.authorizationId}/approve`,
    body: { approver: "hr.jane@remote.test", note: "demo posture" },
  });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.ok(["executed", "approved_no_remote_record"].includes(res.body.code), res.body.code);
});

// --- UC-05 -----------------------------------------------------------------

async function uc05Fixture() {
  const resignationStore = new ResignationStore();
  const created = await handleResignationRequest(
    {
      session: { authenticatedEmploymentId: "emp_uk_001" },
      employmentId: "emp_uk_001",
      proposedEndDate: "2026-09-15",
      reason: "new opportunity",
      now: "2026-08-16",
      hourlyRateInRemoteInteger: 4000,
    },
    { remote, audit, resignationStore, extract: (args) => extractFromLetter(args, { isConfigured: () => false }) }
  );
  assert.equal(created.decision, "prepared_for_signoff");
  return { id: created.resignationId, handler: createUc05Handler({ resignationStore, audit, remote, entitlement }) };
}

test("POSITIVE UC-05: an entitled HR Ops signer still signs off, end to end", async () => {
  const { id, handler } = await uc05Fixture();
  const res = await callApi(handler, {
    method: "POST",
    path: `/api/resignations/${id}/signoff`,
    body: { approver: "hr.jane@remote.test", note: "figures check out" },
  });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.code, "signed_off");
});

test("NEGATIVE UC-05: a mobility specialist may not sign off an HR Ops report", async () => {
  const { id, handler } = await uc05Fixture();
  const res = await callApi(handler, {
    method: "POST",
    path: `/api/resignations/${id}/signoff`,
    body: { approver: "mobility.sam@remote.test" },
  });
  assert.equal(res.status, 403);
  assert.equal(res.body.code, NOT_ENTITLED);
  assert.match(res.body.reason, /hr_ops/);
});

test("NEGATIVE UC-05: a DECLINE is gated too — claiming a role you do not hold is the same defect either verb", async () => {
  const { id, handler } = await uc05Fixture();
  const res = await callApi(handler, {
    method: "POST",
    path: `/api/resignations/${id}/decline`,
    body: { approver: "mobility.sam@remote.test", note: "no" },
  });
  assert.equal(res.status, 403);
  assert.equal(res.body.code, NOT_ENTITLED);
});

// --- UC-06 -----------------------------------------------------------------

async function uc06Fixture() {
  const amendmentStore = new AmendmentStore();
  const created = await handleAmendmentRequest(
    {
      employmentId: "emp_nl_amend_001",
      session: { companyId: "co_amend_01", authenticatedAdminId: "admin_jane" },
      changes: { salary: { oldAmount: 50000, newAmount: 60000, currency: "USD" } },
      requestedEffectiveDate: "2026-07-15",
      now: "2026-06-20",
    },
    {
      remote,
      audit,
      amendmentStore,
      draftSummary: (args) => uc06DraftSummary(args, { isConfigured: () => false }),
      judge: fakeJudge,
    }
  );
  assert.equal(created.decision, "dual_approval_required");
  return { id: created.amendmentId, handler: createUc06Handler({ amendmentStore, audit, remote, entitlement }) };
}

test("POSITIVE UC-06: two entitled approvers, one per role, still execute the amendment", async () => {
  const { id, handler } = await uc06Fixture();

  const first = await callApi(handler, {
    method: "POST",
    path: `/api/amendments/${id}/approve`,
    body: { role: "customer_admin", approver: "admin.ana@remote.test", note: "1/2" },
  });
  assert.equal(first.status, 200, JSON.stringify(first.body));
  assert.equal(first.body.code, "approved_awaiting_second");

  const second = await callApi(handler, {
    method: "POST",
    path: `/api/amendments/${id}/approve`,
    body: { role: "payroll_specialist", approver: "payroll.sam@remote.test", note: "2/2" },
  });
  assert.equal(second.status, 200, JSON.stringify(second.body));
  assert.equal(second.body.code, "executed");
});

test("NEGATIVE UC-06: the roles are not interchangeable — swapping the two entitled people refuses both", async () => {
  const { id, handler } = await uc06Fixture();

  const asPayroll = await callApi(handler, {
    method: "POST",
    path: `/api/amendments/${id}/approve`,
    body: { role: "payroll_specialist", approver: "admin.ana@remote.test" },
  });
  assert.equal(asPayroll.status, 403);
  assert.equal(asPayroll.body.code, NOT_ENTITLED);
  assert.match(asPayroll.body.reason, /holds only: uc06:customer_admin/);

  const asAdmin = await callApi(handler, {
    method: "POST",
    path: `/api/amendments/${id}/approve`,
    body: { role: "customer_admin", approver: "payroll.sam@remote.test" },
  });
  assert.equal(asAdmin.status, 403);
  assert.equal(asAdmin.body.code, NOT_ENTITLED);
});

test("UC-06 four-eyes is untouched: the same-person refusal still fires BEFORE entitlement is consulted", async () => {
  // A roster that entitles one human to both slots must not become a way around
  // segregation of duties, and the more specific refusal must still be the one
  // reported — entitlement runs last precisely so it cannot mask this.
  const bothRoles = createEntitlementChecker({
    grants: parseRoster("solo@remote.test=uc06:customer_admin,uc06:payroll_specialist"),
  });
  const amendmentStore = new AmendmentStore();
  const created = await handleAmendmentRequest(
    {
      employmentId: "emp_nl_amend_001",
      session: { companyId: "co_amend_01", authenticatedAdminId: "admin_jane" },
      changes: { salary: { oldAmount: 50000, newAmount: 60000, currency: "USD" } },
      requestedEffectiveDate: "2026-07-15",
      now: "2026-06-20",
    },
    {
      remote,
      audit,
      amendmentStore,
      draftSummary: (args) => uc06DraftSummary(args, { isConfigured: () => false }),
      judge: fakeJudge,
    }
  );
  const handler = createUc06Handler({ amendmentStore, audit, remote, entitlement: bothRoles });

  const first = await callApi(handler, {
    method: "POST",
    path: `/api/amendments/${created.amendmentId}/approve`,
    body: { role: "customer_admin", approver: "solo@remote.test" },
  });
  assert.equal(first.body.code, "approved_awaiting_second");

  const second = await callApi(handler, {
    method: "POST",
    path: `/api/amendments/${created.amendmentId}/approve`,
    body: { role: "payroll_specialist", approver: "Solo@Remote.test " },
  });
  assert.equal(second.status, 409);
  assert.equal(second.body.code, "same_person_cannot_fill_both_roles");
});

// --- UC-09 -----------------------------------------------------------------

const uc09Remote = {
  getEmployment: (id) => ({ id, status: "active", company_id: "co_test", country_code: "US", compensation_gross_amount: 10000000 }),
  getCountrySchema: () => ({ required: ["employment_id", "type", "amount", "currency"] }),
  isLlmConfigured: () => false,
  createIncentive: async (payload) => ({ success: true, incentiveId: "inc_" + Math.random().toString(36).slice(2), ...payload }),
};

async function uc09Fixture(entitlementChecker = entitlement) {
  const adjustmentStore = new AdjustmentStore();
  const created = await handleAdjustmentRequest(
    {
      employmentId: "emp_test_1",
      session: { companyId: "co_test", authenticatedAdminId: "admin_1" },
      adjustmentRequest: { type: "bonus", amount: 500_000, currency: "USD", amountTaxType: "gross", description: "Performance bonus" },
      reasonText: "Annual performance bonus",
    },
    { remote: uc09Remote, audit, adjustmentStore, judge: (args) => judgeNarrative(args, { isConfigured: () => false }) }
  );
  return {
    id: created.adjustmentId,
    handler: createUc09Handler({ adjustmentStore, audit, remote: uc09Remote, entitlement: entitlementChecker }),
  };
}

test("POSITIVE UC-09: two entitled approvers in their own slots still execute the payment", async () => {
  const { id, handler } = await uc09Fixture();

  const first = await callApi(handler, {
    method: "POST",
    path: `/api/adjustments/${id}/approve`,
    body: { role: "requester", approver: "req.rita@remote.test", note: "1/2" },
  });
  assert.equal(first.status, 200, JSON.stringify(first.body));
  assert.equal(first.body.code, "approved_awaiting_more");

  const second = await callApi(handler, {
    method: "POST",
    path: `/api/adjustments/${id}/approve`,
    body: { role: "approver", approver: "app.alan@remote.test", note: "2/2" },
  });
  assert.equal(second.status, 200, JSON.stringify(second.body));
  assert.equal(second.body.code, "executed");
});

test("NEGATIVE UC-09: a payment releaser may not sign the requester slot — this is the money path", async () => {
  const { id, handler } = await uc09Fixture();
  const res = await callApi(handler, {
    method: "POST",
    path: `/api/adjustments/${id}/approve`,
    body: { role: "requester", approver: "rel.ray@remote.test" },
  });
  assert.equal(res.status, 403);
  assert.equal(res.body.code, NOT_ENTITLED);
  assert.match(res.body.reason, /"requester"/);
  assert.match(res.body.reason, /UC-09/);
});

test("UC-09's floor of two is untouched: one entitled approval never executes", async () => {
  const { id, handler } = await uc09Fixture();
  const only = await callApi(handler, {
    method: "POST",
    path: `/api/adjustments/${id}/approve`,
    body: { role: "requester", approver: "req.rita@remote.test" },
  });
  assert.equal(only.body.code, "approved_awaiting_more", "entitlement must not satisfy a slot it did not fill");

  const view = await callApi(handler, { method: "GET", path: `/api/adjustments/${id}` });
  assert.notEqual(view.body.adjustment.status, "executed");
});

test("UC-09 four-eyes is untouched even when ONE human is entitled to both slots", async () => {
  const bothSlots = createEntitlementChecker({ grants: parseRoster("both.bea@remote.test=uc09:requester,uc09:approver") });
  const { id, handler } = await uc09Fixture(bothSlots);

  const first = await callApi(handler, {
    method: "POST",
    path: `/api/adjustments/${id}/approve`,
    body: { role: "requester", approver: "both.bea@remote.test" },
  });
  assert.equal(first.body.code, "approved_awaiting_more");

  const second = await callApi(handler, {
    method: "POST",
    path: `/api/adjustments/${id}/approve`,
    body: { role: "approver", approver: "Both.Bea@remote.test" },
  });
  assert.equal(second.status, 409);
  assert.equal(second.body.code, "same_person_cannot_fill_multiple_roles");
});

test("UC-09 required-but-unconfigured refuses every approval, by its own name", async () => {
  const { id, handler } = await uc09Fixture(createUnconfiguredEntitlement());
  const res = await callApi(handler, {
    method: "POST",
    path: `/api/adjustments/${id}/approve`,
    body: { role: "requester", approver: "req.rita@remote.test" },
  });
  assert.equal(res.status, 403);
  assert.equal(res.body.code, NOT_CONFIGURED);
  assert.match(res.body.reason, /APPROVER_ROLES/);
});

test("NOT ENFORCED still means NOT CONSULTED: the same handler with no entitlement approves as it always did", async () => {
  const { id, handler } = await uc09Fixture(null);
  const first = await callApi(handler, {
    method: "POST",
    path: `/api/adjustments/${id}/approve`,
    body: { role: "requester", approver: "anyone@example.com" },
  });
  assert.equal(first.status, 200);
  const second = await callApi(handler, {
    method: "POST",
    path: `/api/adjustments/${id}/approve`,
    body: { role: "approver", approver: "someone.else@example.com" },
  });
  assert.equal(second.body.code, "executed", "a fresh clone's seeded demo must keep working exactly as before");
});

// --- UC-01 -----------------------------------------------------------------
//
// K10 (qa/HUMAN-DECISIONS-REQUIRED.md, 2026-08-23): UC-01's review API
// enforced NO approver-role entitlement — the checker was already wired into
// UC-03/04/05/06/09, and deploy/cx-apis/deps.js was ALREADY building one and
// handing it to createReviewHandler(); reviewPolicy.js/service.js/server.js
// simply had no parameter to receive it, so the key was silently dropped by
// destructuring. An identity absent from APPROVER_ROLES approved
// successfully even with APPROVER_ROLES_REQUIRE=true — not the flag failing,
// a missing call site. THESE TESTS ASSERT ON OBSERVABLE OUTPUT (a real
// approve/decline through the real HTTP handler), never on the flag's own
// value — a test that reads the flag passes today against the live defect.

async function uc01Fixture(entitlementChecker = entitlement, ticketId = "uc01-entitlement-1") {
  const caseStore = new CaseStore();
  const store = new InMemoryReviewStore(caseStore);
  const created = await handleVerificationTicket(
    {
      source: "zendesk",
      externalRef: ticketId,
      text: "Please complete the attached verification form.",
      session: { authenticatedEmploymentId: "emp_active_001" },
      employmentId: "emp_active_001",
      hasAttachment: true,
    },
    { remote, audit, caseStore, classify: classifyRequestRuleBased }
  );
  assert.equal(created.decision, "human_review"); // guard: the fixture must actually need a human
  return {
    ticketId,
    handler: createReviewHandler({ store, caseStore, audit, remote, entitlement: entitlementChecker }),
  };
}

test("POSITIVE UC-01: an entitled HR Ops specialist still approves, end to end", async () => {
  const { ticketId, handler } = await uc01Fixture(entitlement, "uc01-entitlement-positive");
  const res = await callApi(handler, {
    method: "POST",
    path: `/api/review/ticket/${ticketId}/approve`,
    headers: { "x-zaf-approver": "hr.jane@remote.test" },
    body: { note: "verified against the record" },
  });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.letterIssued, true);
});

test("NEGATIVE UC-01: a mobility specialist may not approve an HR Ops verification", async () => {
  const { ticketId, handler } = await uc01Fixture(entitlement, "uc01-entitlement-wrong-role");
  const res = await callApi(handler, {
    method: "POST",
    path: `/api/review/ticket/${ticketId}/approve`,
    headers: { "x-zaf-approver": "mobility.sam@remote.test" },
    body: { note: "checked" },
  });
  assert.equal(res.status, 403);
  assert.equal(res.body.code, NOT_ENTITLED);
  assert.match(res.body.reason, /hr_ops/);
});

test("NEGATIVE UC-01: an identity on no roster at all is refused", async () => {
  const { ticketId, handler } = await uc01Fixture(entitlement, "uc01-entitlement-unrostered");
  const res = await callApi(handler, {
    method: "POST",
    path: `/api/review/ticket/${ticketId}/approve`,
    headers: { "x-zaf-approver": "nobody@nowhere.test" },
    body: { note: "checked" },
  });
  assert.equal(res.status, 403);
  assert.equal(res.body.code, NOT_ENTITLED);
});

test("NEGATIVE UC-01: a DECLINE is gated too — claiming a role you do not hold is the same defect either verb", async () => {
  const { ticketId, handler } = await uc01Fixture(entitlement, "uc01-entitlement-decline");
  const res = await callApi(handler, {
    method: "POST",
    path: `/api/review/ticket/${ticketId}/decline`,
    headers: { "x-zaf-approver": "mobility.sam@remote.test" },
    body: { note: "no" },
  });
  assert.equal(res.status, 403);
  assert.equal(res.body.code, NOT_ENTITLED);
});

test("UC-01 ordering: an ESCALATED case still refuses no_review_path for an unentitled approver — entitlement never masks the real reason", async () => {
  const caseStore = new CaseStore();
  const store = new InMemoryReviewStore(caseStore);
  const escalated = await handleVerificationTicket(
    {
      source: "zendesk",
      externalRef: "uc01-entitlement-escalated",
      text: "I need a standard employment letter.",
      session: { authenticatedEmploymentId: "emp_terminated_002" },
      employmentId: "emp_terminated_002",
    },
    { remote, audit, caseStore, classify: classifyRequestRuleBased }
  );
  assert.equal(escalated.decision, "escalate"); // guard
  const handler = createReviewHandler({ store, caseStore, audit, remote, entitlement });
  const res = await callApi(handler, {
    method: "POST",
    path: `/api/review/ticket/uc01-entitlement-escalated/approve`,
    headers: { "x-zaf-approver": "mobility.sam@remote.test" },
    body: { note: "trying anyway" },
  });
  assert.equal(res.status, 403);
  assert.equal(res.body.code, "no_review_path", "actionability must still be checked BEFORE entitlement");
});

test("UC-01 ordering: a second decision on a settled case still refuses already_decided for an unentitled approver", async () => {
  const { ticketId, handler } = await uc01Fixture(entitlement, "uc01-entitlement-settled");
  const first = await callApi(handler, {
    method: "POST",
    path: `/api/review/ticket/${ticketId}/approve`,
    headers: { "x-zaf-approver": "hr.jane@remote.test" },
    body: { note: "verified" },
  });
  assert.equal(first.status, 200, JSON.stringify(first.body));

  const second = await callApi(handler, {
    method: "POST",
    path: `/api/review/ticket/${ticketId}/approve`,
    headers: { "x-zaf-approver": "mobility.sam@remote.test" },
    body: { note: "trying again" },
  });
  assert.equal(second.status, 409);
  assert.equal(
    second.body.code,
    "already_decided",
    "an unentitled approver on a settled case must still get the real refusal, not an entitlement one"
  );
});

test("UC-01 NOT ENFORCED still means NOT CONSULTED: the same handler with no entitlement approves as it always did", async () => {
  const { ticketId, handler } = await uc01Fixture(null, "uc01-entitlement-not-enforced");
  const res = await callApi(handler, {
    method: "POST",
    path: `/api/review/ticket/${ticketId}/approve`,
    headers: { "x-zaf-approver": "anyone@example.com" },
    body: { note: "fresh clone posture" },
  });
  assert.equal(res.status, 200, JSON.stringify(res.body));
});
