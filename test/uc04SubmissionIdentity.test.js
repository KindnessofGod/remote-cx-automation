// ---------------------------------------------------------------------------
// uc04SubmissionIdentity.test.js — who may SUBMIT a work-authorization request
// ---------------------------------------------------------------------------
// WHAT WENT WRONG, AND WHY IT NEEDS ITS OWN FILE
//
// UC-04's identity gate compared one thing: `session.companyId ===
// employment.company_id`. Only a company-admin session carries a `companyId`,
// so an employee filing a request about their own trip failed it and got back
// `escalate / identity_not_verified` — a sentence that reads as a finding about
// the traveller while describing our own plumbing. The portal then wrote the
// refusal down as a rule ("a workation request is filed by the company admin on
// the employee's behalf"), which was the only sentence in this repository that
// ever claimed it, and it contradicted docs/use-cases/UC-04.md §1 ("Primary
// actor: Employee") and Remote's own object — a WorkAuthorizationRequest is
// "submitted by an employee who needs authorization to work in a different
// country", with `user` (the employee) and `employer_approver` (the customer's
// manager) as two separate parties.
//
// The defect was a conflation: WHO MAY SUBMIT was answered with the test for
// WHO REPRESENTS THE COMPANY. The employer's part of UC-04 is the APPROVAL, and
// that is enforced elsewhere entirely (approvalPolicy.js, and the role
// entitlement in src/review/approverEntitlement.js) — untouched by any of this.
//
// THE PROPERTIES PINNED HERE, in the order they matter:
//
//   1. FAIL-CLOSED. Absent, empty and non-string ids on either side of either
//      comparison never verify. `null === null` once passed UC-06's and UC-09's
//      identity gates (CLAUDE.md §4) and this use case now has two comparisons
//      to make that mistake in rather than one.
//   2. A SUBJECT IS NOT A CLAIM. The employee's id is matched against the id on
//      the record REMOTE RETURNED, and an employee filing about somebody else
//      is refused rather than quietly retargeted at themselves.
//   3. THE ADMIN PATH IS UNCHANGED, including the company boundary — the thing
//      a widening is most likely to break while every new test passes.
//
// HERMETIC BY CONSTRUCTION: a stub Remote, no server, no port, no LLM. The two
// LLM seams (`draftSummary`, `judge`) are injected, per CLAUDE.md §6 — a real
// OPENAI_API_KEY in the environment must never make a test call out.
// ---------------------------------------------------------------------------

import { test } from "node:test";
import assert from "node:assert/strict";

import { verifySubmissionIdentity } from "../src/uc04/submissionIdentity.js";
import { handleWorkationRequest } from "../src/uc04/workflow.js";
import { AuthorizationStore } from "../src/uc04/authorizationStore.js";
import { AuditLogger } from "../src/shared/audit.js";
import { ownerScopeFor } from "../src/portal/ownership.js";
import { PERSONAS } from "../src/portal/personas.js";

// ---------------------------------------------------------------------------
// 1. The rule itself
// ---------------------------------------------------------------------------

const EMPLOYMENT = { id: "emp_1", company_id: "co_1", status: "active", custom_fields: { workation_permission: true } };

test("the employee who IS the subject verifies, and the basis says which relationship proved it", () => {
  const v = verifySubmissionIdentity({ session: { authenticatedEmploymentId: "emp_1" }, employment: EMPLOYMENT });
  assert.equal(v.verified, true);
  assert.equal(v.basis, "employment_subject");
});

test("a company admin for the subject's company still verifies — the original rule, kept", () => {
  const v = verifySubmissionIdentity({
    session: { companyId: "co_1", authenticatedAdminId: "admin_jane" },
    employment: EMPLOYMENT,
  });
  assert.equal(v.verified, true);
  assert.equal(v.basis, "company_actor");
});

test("an employee session naming a DIFFERENT employment does not verify", () => {
  const v = verifySubmissionIdentity({ session: { authenticatedEmploymentId: "emp_2" }, employment: EMPLOYMENT });
  assert.equal(v.verified, false);
  assert.equal(v.basis, null);
});

test("an admin of another company does not verify", () => {
  const v = verifySubmissionIdentity({
    session: { companyId: "co_other", authenticatedAdminId: "admin_jane" },
    employment: EMPLOYMENT,
  });
  assert.equal(v.verified, false);
});

test("FAIL-CLOSED: two absent values never verify, on either comparison", () => {
  // THE `null === null` BUG, both ways round. A session with no company and a
  // record normalised to a null company compared EQUAL in UC-06 and UC-09 and
  // passed their identity gates; a record with no id and a session naming no
  // employment is the same shape one field over. Neither may verify, and the
  // second is the one this change introduced the opportunity for.
  const noCompanyEither = verifySubmissionIdentity({
    session: { companyId: null, authenticatedAdminId: "admin_jane" },
    employment: { id: "emp_1", company_id: null },
  });
  assert.equal(noCompanyEither.verified, false, "null === null verified a company");

  const noIdEither = verifySubmissionIdentity({
    session: { authenticatedEmploymentId: undefined },
    employment: { id: undefined, company_id: "co_1" },
  });
  assert.equal(noIdEither.verified, false, "undefined === undefined verified an employment");

  const bothEmpty = verifySubmissionIdentity({
    session: { authenticatedEmploymentId: "", companyId: "" },
    employment: { id: "", company_id: "" },
  });
  assert.equal(bothEmpty.verified, false, "an empty string matched an empty string");

  const whitespace = verifySubmissionIdentity({
    session: { authenticatedEmploymentId: "   " },
    employment: { id: "   " },
  });
  assert.equal(whitespace.verified, false, "whitespace matched whitespace");
});

test("FAIL-CLOSED: no session, no employment record, and a non-string id all refuse", () => {
  assert.equal(verifySubmissionIdentity({ session: null, employment: EMPLOYMENT }).verified, false);
  // A 404 from Remote is `null` (RemoteClient.getEmployment's own convention),
  // which is exactly the case where nothing about the subject is known.
  assert.equal(verifySubmissionIdentity({ session: { authenticatedEmploymentId: "emp_1" }, employment: null }).verified, false);
  assert.equal(verifySubmissionIdentity({}).verified, false);
  // Ids are compared as strings; anything else is unrecognised rather than
  // coerced, so `1 == "1"` can never become an identity.
  assert.equal(
    verifySubmissionIdentity({ session: { authenticatedEmploymentId: 1 }, employment: { id: 1 } }).verified,
    false
  );
});

// ---------------------------------------------------------------------------
// 2. The gate, through the real workflow
// ---------------------------------------------------------------------------

const FACTORS = {
  homeCountry: "DE",
  nationality: "DE",
  destination: { country: "ES" },
  startDate: "2026-09-01",
  endDate: "2026-09-14",
  visaType: "schengen_short_stay",
  jobDuties: "engineering",
  hasContractSigningAuthority: false,
};

/** A Remote stub: one readable employment, and no work-authorization requests. */
function stubRemote(employment = EMPLOYMENT) {
  return {
    async getEmployment(id) {
      return id === employment.id ? employment : null;
    },
    async listWorkAuthorizations() {
      return [];
    },
  };
}

const noLlm = {
  draftSummary: async () => ({ summary: "stub" }),
  judge: async () => ({ verdict: "not_evaluated", reason: null }),
};

function submit({ session, employmentId = "emp_1", externalRef, remote = stubRemote() }) {
  const audit = new AuditLogger();
  const authorizationStore = new AuthorizationStore();
  return handleWorkationRequest(
    { employmentId, session, factors: FACTORS, externalRef, source: "portal", now: "2026-08-15" },
    { remote, audit, authorizationStore, ...noLlm }
  ).then((result) => ({ result, audit, authorizationStore }));
}

test("an employee filing about their own trip reaches a decision instead of identity_not_verified", async () => {
  const { result } = await submit({ session: { authenticatedEmploymentId: "emp_1" }, externalRef: "sid-1" });
  assert.equal(result.decision, "ready_for_approval");
  assert.equal(result.reason, "all_gates_passed");
  assert.ok(!result.flags.includes("identity_not_verified"));
});

test("an employee filing about somebody ELSE's employment is still identity_not_verified", async () => {
  const { result } = await submit({
    session: { authenticatedEmploymentId: "emp_2" },
    externalRef: "sid-2",
  });
  assert.equal(result.decision, "escalate");
  assert.equal(result.reason, "identity_not_verified");
});

test("the session is matched against the RECORD's id, not against the id that was asked about", async () => {
  // Remote answers 404 (null). A session claiming to be `emp_missing` and a
  // request asking about `emp_missing` agree perfectly with each other and with
  // nothing else — two claims, no record. That must not verify.
  const { result } = await submit({
    session: { authenticatedEmploymentId: "emp_missing" },
    employmentId: "emp_missing",
    externalRef: "sid-3",
  });
  assert.equal(result.reason, "identity_not_verified");
});

test("an admin for the company still clears, and an admin for another company still does not", async () => {
  const mine = await submit({
    session: { companyId: "co_1", authenticatedAdminId: "admin_jane" },
    externalRef: "sid-4",
  });
  assert.equal(mine.result.decision, "ready_for_approval");

  const theirs = await submit({
    session: { companyId: "co_other", authenticatedAdminId: "admin_jane" },
    externalRef: "sid-5",
  });
  assert.equal(theirs.result.reason, "identity_not_verified");
});

test("an employee-filed row records the EMPLOYEE as the filer, not the literal 'unauthenticated'", async () => {
  // Before this change `requester` read `session.authenticatedAdminId ??
  // "unauthenticated"`, so a request that had just PASSED the identity gate was
  // recorded as having been filed by nobody — and every employee's rows would
  // have collapsed onto that one unscopable owner value.
  const { result, audit, authorizationStore } = await submit({
    session: { authenticatedEmploymentId: "emp_1" },
    externalRef: "sid-6",
  });
  const row = await authorizationStore.findById(result.authorizationId);
  assert.equal(row.requester, "emp_1");

  const entry = audit.entries.find((e) => e.details?.externalRef === "sid-6");
  assert.equal(entry.actor, "emp_1");
  // WHAT "VERIFIED" VERIFIED, on the append-only row: two relationships satisfy
  // this gate now, and the absence of an `identity_not_verified` flag says only
  // that one of them did.
  assert.equal(entry.details.identityBasis, "employment_subject");
});

test("an admin-filed row is unchanged: the admin id is the filer and the basis names the company route", async () => {
  const { audit } = await submit({
    session: { companyId: "co_1", authenticatedAdminId: "admin_jane" },
    externalRef: "sid-7",
  });
  const entry = audit.entries.find((e) => e.details?.externalRef === "sid-7");
  assert.equal(entry.actor, "admin_jane");
  assert.equal(entry.details.identityBasis, "company_actor");
});

test("a refused request records no basis at all, rather than a relationship nobody proved", async () => {
  const { audit } = await submit({ session: null, externalRef: "sid-8" });
  const entry = audit.entries.find((e) => e.details?.externalRef === "sid-8");
  assert.equal(entry.details.identityBasis, null);
});

// ---------------------------------------------------------------------------
// 3. What the filer can then SEE — the disclosure half
// ---------------------------------------------------------------------------

test("an employee's UC-04 scope is rows they filed AND rows about them, not everything about them", () => {
  // THE TIGHTER OF THE TWO READINGS, on purpose. "Rows about me" would put a
  // company admin's mobility assessment of an employee onto that employee's own
  // history page — a disclosure change nobody has decided, and one this portal
  // must not make as a side effect of who is allowed to file. Scoping on both
  // columns is exactly what an employee can create through this portal, so
  // nothing they filed is hidden by it.
  const scope = ownerScopeFor(PERSONAS.chris, "uc04");
  assert.equal(scope.scoped, true);
  assert.deepEqual(scope.query, {
    employmentId: PERSONAS.chris.employmentId,
    requester: PERSONAS.chris.employmentId,
  });
});

test("the admin's UC-04 scope is unchanged — the rows that name them as the filer", () => {
  const scope = ownerScopeFor(PERSONAS.admin, "uc04");
  assert.equal(scope.scoped, true);
  assert.deepEqual(scope.query, { requester: "admin_jane" });
});

test("UC-09 is NOT widened by any of this: an employee session still owns none of them", () => {
  // The other on-behalf-of use case moves money, is 🔴-framed, and nothing here
  // says an employee may request their own off-cycle payment. A widening that
  // leaked one type over would be the expensive kind of "while I was in here".
  const scope = ownerScopeFor(PERSONAS.chris, "uc09");
  assert.equal(scope.scoped, false);
  assert.match(scope.reason, /company admin/i);
});

// ---------------------------------------------------------------------------
// 4. And the screen must not contradict the gate
// ---------------------------------------------------------------------------
// `requesterParties()` states, in words, what "verified" verified. It asserted
// the company comparison unconditionally — "an authenticated actor for the
// company — not by the employee" — which is now false of a whole class of row,
// and false in the worst way: confidently, about the one thing that block
// exists to state precisely. The portal has already paid for this exact shape
// once (CLAUDE.md §6: a persona caption that read `kind` and captioned eleven
// legal relationships "employee"). It is derived from the row, never restated.

test("an employee-filed row is described as the employee filing for themselves", async () => {
  const { requesterParties } = await import("../src/uc04/decisionFacts.js");
  const block = requesterParties({
    authorizationRow: { requester: "emp_1", employmentId: "emp_1", flags: [], source: "portal", externalRef: "r1" },
  });
  assert.equal(block.filedBy.state, "authenticated_employee_session");
  assert.equal(block.actingFor.state, "the_subject_themselves");
  assert.doesNotMatch(block.filedBy.finding, /not by the employee/i);
  assert.match(block.identity.checks, /employment id the session names equals the id on that record/);
});

test("an admin-filed row keeps the company wording, and the two never appear on the same row", async () => {
  const { requesterParties } = await import("../src/uc04/decisionFacts.js");
  const block = requesterParties({
    authorizationRow: { requester: "admin_jane", employmentId: "emp_1", flags: [], source: "portal", externalRef: "r2" },
  });
  assert.equal(block.filedBy.state, "authenticated_company_actor");
  assert.equal(block.actingFor.state, "on_behalf_of_the_subject");
  assert.match(block.identity.checks, /company id equals the employment's company id/);
});

test("an unverified row names BOTH routes it could not establish, not just the company one", async () => {
  const { requesterParties } = await import("../src/uc04/decisionFacts.js");
  const block = requesterParties({
    authorizationRow: {
      requester: "unauthenticated",
      employmentId: "emp_1",
      flags: ["identity_not_verified"],
      source: "portal",
      externalRef: "r3",
    },
  });
  assert.equal(block.identity.state, "not_verified");
  // A refusal that names one cause it did not establish is the failure this
  // whole describer exists to avoid.
  assert.match(block.identity.finding, /neither this employment nor this employment's company/i);
});
