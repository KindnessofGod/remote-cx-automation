// ---------------------------------------------------------------------------
// uc01ReviewSubject.test.js — L-17 / VC-17 / DRIFT-042
// ---------------------------------------------------------------------------
// "The sidebar answers *who is this about* with a name; an absent field renders
//  as a NAMED ABSENCE, never a blank."
//
// UC-01 is 🟢: it resolves the clean cases with nobody looking, so the only part
// of it a human ever sees is an exception — and that human was handed an
// employment id where a person's name belongs. Six of the nine use-case servers
// already published the subject through `src/shared/employeeSubject.js`; UC-01,
// the flagship and the only one running live, was one of the three that did not.
// ---------------------------------------------------------------------------

import { test } from "node:test";
import assert from "node:assert/strict";
import { createReviewHandler } from "../src/review/server.js";
import { AuditLogger } from "../src/shared/audit.js";
import { SUBJECT_AVAILABLE, SUBJECT_NOT_FOUND, SUBJECT_NO_EMPLOYMENT_ID } from "../src/shared/employeeSubject.js";

const CASE = {
  id: "case-1",
  useCase: "UC-01",
  externalRef: "1001",
  employmentId: "emp_active_001",
  decision: "human_review",
  reason: "low_confidence",
  flags: ["low_confidence"],
  status: "pending_review",
  classification: { intent: "standard_letter", confidence: 0.4 },
};

function storeFor(caseRow) {
  return {
    async findCaseByExternalRef() { return caseRow; },
    async findReviewEntryByCaseId() { return { id: "rq-1", caseId: caseRow.id, status: "pending" }; },
    async findDocumentsByCaseId() { return []; },
  };
}

async function viewWith(remote, caseRow = CASE) {
  const handler = createReviewHandler({
    store: storeFor(caseRow),
    caseStore: { },
    audit: new AuditLogger(),
    remote,
  });
  let body;
  const res = {
    statusCode: undefined,
    setHeader() {},
    end(payload) { body = payload ? JSON.parse(payload) : null; },
  };
  await handler({ method: "GET", url: `/api/review/ticket/${caseRow.externalRef}`, headers: {} }, res);
  return { status: res.statusCode, body };
}

test("VC-17: the view names the person, not the employment id", async () => {
  const remote = {
    async getEmployment() {
      return { id: "emp_active_001", full_name: "Amara Okafor", job_title: "Senior Engineer", status: "active", contract_type: "eor", country_code: "NG" };
    },
  };
  const { status, body } = await viewWith(remote);
  assert.equal(status, 200);
  assert.ok(body.employee, "the view sends no employee subject at all");
  assert.equal(body.employee.state, SUBJECT_AVAILABLE);
  assert.equal(body.employee.displayName, "Amara Okafor");
  const name = body.employee.fields.find((f) => f.key === "full_name");
  assert.equal(name.value, "Amara Okafor");
});

test("VC-17: an absent field is a NAMED ABSENCE, never a blank", async () => {
  // The half that matters on a disclosure screen. A blank is indistinguishable
  // from a value that is genuinely empty, and "we did not look" and "there is
  // nothing there" are different facts to somebody deciding what may be said
  // about a named person.
  const remote = {
    async getEmployment() {
      return { id: "emp_active_001", full_name: "Amara Okafor", status: "active" };
    },
  };
  const { body } = await viewWith(remote);
  const jobTitle = body.employee.fields.find((f) => f.key === "job_title");
  assert.ok(jobTitle, "the field must still be listed when it has no value");
  assert.equal(jobTitle.value, null, "null, not an empty string a renderer would print as a blank");
  assert.ok(
    typeof jobTitle.absence === "string" && jobTitle.absence.length > 10,
    "an absent field must carry a sentence saying so — that sentence IS the named absence"
  );
  // And a present field carries no absence sentence, so the two are never
  // confused by a renderer looking for truthiness.
  assert.equal(body.employee.fields.find((f) => f.key === "status").absence, null);
});

test("VC-17: a record Remote cannot return says so, and does not read as an empty person", async () => {
  const remote = { async getEmployment() { return null; } };
  const { body } = await viewWith(remote);
  assert.equal(body.employee.state, SUBJECT_NOT_FOUND);
});

test("VC-17: a case with no employment id says THAT, rather than reporting a missing person", async () => {
  const remote = { async getEmployment() { throw new Error("must not be called"); } };
  const { body } = await viewWith(remote, { ...CASE, employmentId: null });
  assert.equal(body.employee.state, SUBJECT_NO_EMPLOYMENT_ID);
  assert.match(body.employee.finding, /no employment/i);
});

test("the subject publishes NO money field, on any path", async () => {
  // UC-01's whole safety property is that its letter never states compensation,
  // and the exception surface is where a "helpful" enrichment would put it back.
  const remote = {
    async getEmployment() {
      return {
        id: "emp_active_001", full_name: "Amara Okafor", status: "active",
        base_salary: 5000000, compensation_gross_amount: 25000, salary: 987654, currency: "USD",
      };
    },
  };
  const { body } = await viewWith(remote);
  const serialised = JSON.stringify(body.employee);
  for (const forbidden of ["5000000", "25000", "987654", "salary", "compensation"]) {
    assert.ok(!serialised.includes(forbidden), `the employee subject leaked ${forbidden}`);
  }
});

// ---------------------------------------------------------------------------
// E3-F12 / rca-wif — owner ruling 2026-08-22, option (a): the sidebar
// WITHHOLDS the subject block on `identity_not_verified`, matching what the
// internal note already does correctly today. Ticket #99: an unauthenticated
// requester quoted Chris Lee's employment id; the case's own verdict was that
// identity could not be established, and the sidebar disclosed the person's
// full name, job title, employment status, contract type and country anyway.
//
// THE POSITIVE CASE LEADS, per the owner's explicit instruction: a
// negative-only suite passes whether the fix lands correctly, lands inverted,
// or does not land at all. So this file first re-asserts (with a
// `human_review`-shaped, VERIFIED case — the #98/#102 shape) that the subject
// block STILL renders, and only then asserts it is withheld on
// `identity_not_verified`.
// ---------------------------------------------------------------------------

test("E3-F12 positive: a verified human_review case (the #98/#102 shape) still shows the full subject block", async () => {
  const remote = {
    async getEmployment() {
      return {
        id: "emp_active_001",
        full_name: "Chris Lee",
        job_title: "Data Scientist",
        status: "active",
        contract_type: "eor",
        country_code: "US",
      };
    },
  };
  const verifiedCase = { ...CASE, decision: "human_review", reason: "low_confidence", flags: ["low_confidence"] };
  const { status, body } = await viewWith(remote, verifiedCase);
  assert.equal(status, 200);
  assert.ok(body.employee, "a verified case must still send the subject block");
  assert.equal(body.employee.state, SUBJECT_AVAILABLE);
  assert.equal(body.employee.displayName, "Chris Lee");
  const values = Object.fromEntries(body.employee.fields.map((f) => [f.key, f.value]));
  assert.equal(values.job_title, "Data Scientist");
  assert.equal(values.status, "active");
  assert.ok(values.contract_type, "contract_type must still be sent on a verified case");
  assert.ok(values.country_code, "country_code must still be sent on a verified case");
});

test("E3-F12: identity_not_verified withholds the subject block entirely — no name, job title, status, contract type or country", async () => {
  // Same employment record as the positive test above — Chris Lee, in full.
  // The only difference is the case's own reason, so this proves the gate
  // keys off the verdict and not off what Remote happens to return.
  const remote = {
    async getEmployment() {
      return {
        id: "emp_active_001",
        full_name: "Chris Lee",
        job_title: "Data Scientist",
        status: "active",
        contract_type: "eor",
        country_code: "US",
      };
    },
  };
  const unverifiedCase = {
    ...CASE,
    decision: "escalate",
    reason: "identity_not_verified",
    flags: ["identity_not_verified"],
    requester: "not-the-employee-on-record@example.org",
  };
  const { status, body } = await viewWith(remote, unverifiedCase);
  assert.equal(status, 200);
  assert.equal(body.employee, undefined, "the review view must not send a subject block at all on identity_not_verified");
  // Belt and braces: no fragment of the withheld facts anywhere in the response
  // body. NOT "eor" — the gate ladder's own reason slugs
  // (`engagement_not_eor_contractor`) legitimately contain that substring and
  // have nothing to do with this employment's contract type.
  const serialised = JSON.stringify(body);
  for (const forbidden of ["Chris Lee", "Data Scientist"]) {
    assert.ok(!serialised.includes(forbidden), `identity_not_verified leaked "${forbidden}" into the review view`);
  }
});

test("E3-F12: identity_not_verified never even asks Remote about the person — the withholding is server-side, not a hidden field", async () => {
  // The owner's directive was explicit: the data must not cross to the
  // browser at all, so this is not a client-side hide of a field the panel
  // was still sent. Proven here by a Remote client that throws if called —
  // if describeEmployee() were still invoked for this reason, this test
  // would fail on the throw rather than on a leaked fact.
  const remote = { async getEmployment() { throw new Error("must not be called for identity_not_verified"); } };
  const unverifiedCase = { ...CASE, decision: "escalate", reason: "identity_not_verified", flags: ["identity_not_verified"] };
  const { status, body } = await viewWith(remote, unverifiedCase);
  assert.equal(status, 200);
  assert.equal(body.employee, undefined);
});

test("E3-F12: the internal note's own withholding is unchanged — this fix touches only the sidebar's view", async () => {
  // Guards against "fixing" this by also stripping the note, which the owner
  // explicitly forbade: the note is correct today and this bead must not
  // touch it. describeDecisionFacts() is UC-01's note/basis builder; on
  // identity_not_verified it is not in CLASSIFICATION_ONLY_FACT_REASONS, so
  // getReviewView() already sends `decisionFacts: null` for this reason —
  // unchanged by this fix, and re-asserted here so a future edit that widens
  // CLASSIFICATION_ONLY_FACT_REASONS to include identity_not_verified fails
  // loudly instead of silently reopening this disclosure through a second
  // field.
  const remote = { async getEmployment() { throw new Error("must not be called"); } };
  const unverifiedCase = { ...CASE, decision: "escalate", reason: "identity_not_verified", flags: ["identity_not_verified"] };
  const { body } = await viewWith(remote, unverifiedCase);
  assert.equal(body.decisionFacts, null);
});

// ---------------------------------------------------------------------------
// rca-h457 (round-7 R7-25) — a portal-sourced case must resolve its subject
// against the SAME world the decision was made in.
//
// The portal always decides against an in-process mock RemoteClient
// (deploy/cx-apis/deps.js's buildPortalHandler(), by design — CLAUDE.md's
// substitution ladder rung 3/4), using mock fixture employment ids like Chris
// Lee's `8ab12460-b568-4c1e-af9d-09b1fabd8f46`. The real Remote Sandbox has
// never heard of that id, so a sidebar that always asks the real client 404s
// and falls back to printing the bare UUID where a name belongs.
//
// `remoteFor()` (src/shared/remoteWorld.js) is the fix already used by the
// four approval paths for exactly this shape of bug (src/shared/remoteWorld.js
// header, "the defect this exists to close"): it chooses the client by the
// record's own persisted `source` column, never by guessing from the id's
// shape. These tests build a `remote` with the same `forSource(source)`
// contract deploy/cx-apis/deps.js's sourceAwareRemote() exposes, and assert
// only on the HTTP response body — never on which branch ran internally.
// ---------------------------------------------------------------------------

function sourceRoutedRemote({ defaultWorld, portalWorld }) {
  return {
    ...defaultWorld,
    forSource(source) {
      return source === "portal" ? portalWorld : defaultWorld;
    },
  };
}

test("rca-h457: a portal-sourced case names the person from the MOCK world, not the real Sandbox", async () => {
  const remote = sourceRoutedRemote({
    defaultWorld: {
      async getEmployment() {
        throw new Error("must not query the real Sandbox for a portal-sourced case");
      },
    },
    portalWorld: {
      async getEmployment() {
        return {
          id: "8ab12460-b568-4c1e-af9d-09b1fabd8f46",
          full_name: "Chris Lee",
          job_title: "Data Scientist",
          status: "active",
          contract_type: "eor",
          country_code: "US",
        };
      },
    },
  });
  const portalCase = { ...CASE, source: "portal", employmentId: "8ab12460-b568-4c1e-af9d-09b1fabd8f46" };
  const { status, body } = await viewWith(remote, portalCase);
  assert.equal(status, 200);
  assert.ok(body.employee, "a portal-sourced case must still receive a subject block");
  assert.equal(body.employee.state, SUBJECT_AVAILABLE);
  assert.equal(
    body.employee.displayName,
    "Chris Lee",
    "the sidebar must show the mock-world name, not fall back to the bare employment id"
  );
});

test("rca-h457: a non-portal case is unaffected — it still reads the default (real) world", async () => {
  const remote = sourceRoutedRemote({
    defaultWorld: {
      async getEmployment() {
        return { id: "emp_active_001", full_name: "Amara Okafor", status: "active" };
      },
    },
    portalWorld: {
      async getEmployment() {
        throw new Error("must not be reached for a non-portal case");
      },
    },
  });
  const zendeskCase = { ...CASE, source: "zendesk" };
  const { status, body } = await viewWith(remote, zendeskCase);
  assert.equal(status, 200);
  assert.equal(body.employee.state, SUBJECT_AVAILABLE);
  assert.equal(body.employee.displayName, "Amara Okafor");
});
