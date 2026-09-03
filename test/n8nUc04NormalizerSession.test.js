// ---------------------------------------------------------------------------
// n8nUc04NormalizerSession.test.js — the n8n normalizer must not strip the
//                                     identity the gates node reads
// ---------------------------------------------------------------------------
// THE DEFECT THIS PINS (found 2026-08-30, by reading the deployed graph after
// publishing a change to it — not by any test).
//
// `workflows/nodes-uc04/workationGates.js` gained an employee-subject identity
// leg: the traveller may file their own request, which is how Remote's own
// object works (`user` submits, `employer_approver` decides). The gate reads
// `session.authenticatedEmploymentId`.
//
// `normalizeWorkationRequest.js` — the node immediately upstream, and the ONLY
// thing that constructs a session on the n8n path — built a session out of
// `companyId` + `authenticatedAdminId` and nothing else. So it dropped the
// field on the way in, and the new leg was DEAD IN PRODUCTION the moment it was
// deployed: present in the body, unreachable by any input.
//
// WHY THE PARITY TEST DID NOT CATCH IT, WHICH IS THE PART WORTH KEEPING.
// `n8nUc04Parity.test.js` hands the gates node a session DIRECTLY — that is the
// right shape for comparing two decision engines, and it means the normalizer
// has never been in the loop. Two nodes each correct in isolation, wired
// together into something that cannot work. This file covers the seam.
// ---------------------------------------------------------------------------
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SOURCE = readFileSync(join(__dirname, "..", "workflows", "nodes-uc04", "normalizeWorkationRequest.js"), "utf8");

/** Run the Code-node body with n8n's globals mocked, exactly as n8n wraps it. */
function runNormalizer(body) {
  const sandbox = { $input: { first: () => ({ json: { body } }) } };
  const result = vm.runInNewContext(`(function () {\n${SOURCE}\n})()`, sandbox, { timeout: 5000 });
  return JSON.parse(JSON.stringify(result[0].json));
}

const FACTORS = {
  homeCountry: "DE",
  nationality: "DE",
  destinationCountry: "ES",
  startDate: "2026-09-01",
  endDate: "2026-09-14",
  visaType: "schengen_short_stay",
  jobDuties: "engineering",
  hasContractSigningAuthority: false,
};
const base = (session) => ({ employmentId: "emp-1", factors: FACTORS, session, externalRef: "p-1" });

test("an employee's own authenticated employment id SURVIVES normalization", () => {
  const out = runNormalizer(base({ authenticatedEmploymentId: "emp-1" }));
  assert.equal(
    out.session?.authenticatedEmploymentId,
    "emp-1",
    "the gates node reads this field; dropping it here makes the employee-subject leg unreachable in production"
  );
});

test("the admin shape is unchanged, and still needs BOTH halves", () => {
  const admin = runNormalizer(base({ companyId: "co-1", authenticatedAdminId: "admin-1" }));
  assert.deepEqual(admin.session, { companyId: "co-1", authenticatedAdminId: "admin-1" });

  // Half an admin session is not an admin session.
  assert.equal(runNormalizer(base({ companyId: "co-1" })).session, null);
  assert.equal(runNormalizer(base({ authenticatedAdminId: "admin-1" })).session, null);
});

test("an admin session that ALSO names a subject keeps both", () => {
  const out = runNormalizer(base({ companyId: "co-1", authenticatedAdminId: "admin-1", authenticatedEmploymentId: "emp-9" }));
  assert.deepEqual(out.session, { companyId: "co-1", authenticatedAdminId: "admin-1", authenticatedEmploymentId: "emp-9" });
});

test("empty and non-string ids never become a session — null must never meet null at the gate", () => {
  for (const value of ["", "   ", null, undefined, 0, false, {}, []]) {
    assert.equal(
      runNormalizer(base({ authenticatedEmploymentId: value })).session,
      null,
      `authenticatedEmploymentId ${JSON.stringify(value)} must not produce a session`
    );
  }
  assert.equal(runNormalizer(base(null)).session, null);
  assert.equal(runNormalizer(base("not-an-object")).session, null);
});

test("the session is whitelisted, not passed through — a body cannot smuggle a field into it", () => {
  const out = runNormalizer(
    base({ authenticatedEmploymentId: "emp-1", companyId: "co-1", authenticatedAdminId: "admin-1", role: "admin", verified: true })
  );
  assert.deepEqual(
    Object.keys(out.session).sort(),
    ["authenticatedAdminId", "authenticatedEmploymentId", "companyId"],
    "only the three known ids may appear; anything else is a claim wearing a session's clothes"
  );
});

test("a Zendesk ticket still yields an email session and never an employment one", () => {
  // A ticket carries no Remote session — the email is the best authenticated
  // signal there is, and inventing an employment id from the field the ticket
  // names would turn a claim into an identity.
  const out = runNormalizer({
    ticket: {
      id: 4242,
      subject: "Workation",
      description: "Two weeks in Madrid",
      custom_fields: [{ id: 9990000000001, value: "emp-1" }],
      requester: { email: "Chris.Lee@Acme.test" },
    },
  });
  assert.deepEqual(out.session, { authenticatedEmail: "chris.lee@acme.test" });
  assert.equal(out.employmentId, "emp-1");
});
