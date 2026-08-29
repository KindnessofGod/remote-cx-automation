// ---------------------------------------------------------------------------
// uc04RequestLink.test.js — which Remote request a UC-04 decision is about
// ---------------------------------------------------------------------------
// THE DEFECT THIS FILE GUARDS. `src/uc04/workflow.js` used to CREATE the
// work-authorization record it decided on, by POSTing to
// `/v1/work-authorization-requests` — an endpoint Remote does not have — and
// swallow the failure with a `console.error`. A written record and an unwritten
// one were therefore indistinguishable from every durable surface, which is why
// the defect survived for months with a fully green suite.
//
// `src/uc04/requestLink.js` replaced it. The dangerous half is not "did we find
// a request"; it is "are we SURE this is the right one" — PATCHing a request we
// did not identify records an employer verdict against a trip nobody assessed.
// So the three states are asserted here directly, with fake clients, because the
// mock deliberately holds only well-formed fixtures and cannot produce an
// ambiguous or unreachable answer.
//
// Hermetic: fake clients only. No socket, no network, no key.
// ---------------------------------------------------------------------------

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  resolveWorkAuthorizationRequest,
  LINK_LINKED,
  LINK_UNLINKED,
  LINK_UNRESOLVED,
} from "../src/uc04/requestLink.js";
import { handleWorkationRequest } from "../src/uc04/workflow.js";
import { AuditLogger } from "../src/shared/audit.js";
import { AuthorizationStore } from "../src/uc04/authorizationStore.js";
import { draftSummary } from "../src/uc04/requestParser.js";
import { VISA_TYPES, JOB_DUTY_CATEGORIES } from "../src/uc04/riskMatrix.js";

const fakeDraftSummary = (args) => draftSummary(args, { isConfigured: () => false });
const fakeJudge = async () => ({ verdict: "not_evaluated", reason: null });

/** A `WorkAuthorizationRequest`, in Remote's own shape. */
function request({ id = "req_1", status = "pending", country = "ES" } = {}) {
  return {
    id,
    status,
    submitted_at: "2026-08-10T09:14:00Z",
    reason: "Workation",
    additional_information: null,
    travel_date_start: "2026-09-01",
    travel_date_end: "2026-09-14",
    travel_document_number: "FC123456",
    work_location: null,
    will_negotiate_or_sign_contracts: false,
    employer_special_instructions: null,
    // A full `Country` object, which is what the real API returns — never the
    // bare code this repo's old fixtures served.
    destination_country: { alpha_2_code: country, code: `${country}X`, name: country },
    user: null,
    employer_approver: null,
  };
}

function fakeRemote({ get = async () => null, list = async () => [] } = {}) {
  return { getWorkAuthorization: get, listWorkAuthorizations: list };
}

// ---------------------------------------------------------------------------
// LINKED — the webhook path, and the lookup path
// ---------------------------------------------------------------------------

test("an id from the webhook resolves to the pending request it names", async () => {
  const link = await resolveWorkAuthorizationRequest({
    remote: fakeRemote({ get: async (id) => request({ id }) }),
    workAuthorizationId: "req_9",
    destinationCountry: "ES",
  });
  assert.equal(link.state, LINK_LINKED);
  assert.equal(link.id, "req_9");
});

test("with no id, exactly one pending request for this employee AND destination links", async () => {
  const link = await resolveWorkAuthorizationRequest({
    remote: fakeRemote({ list: async () => [request({ id: "req_es" })] }),
    employmentId: "emp_1",
    destinationCountry: "ES",
  });
  assert.equal(link.state, LINK_LINKED);
  assert.equal(link.id, "req_es");
});

test("the lookup asks Remote for PENDING only — the one status a manager may decide", async () => {
  let asked = null;
  await resolveWorkAuthorizationRequest({
    remote: fakeRemote({
      list: async (args) => {
        asked = args;
        return [];
      },
    }),
    employmentId: "emp_1",
    destinationCountry: "ES",
  });
  assert.deepEqual(asked, { employmentId: "emp_1", status: "pending" });
});

// ---------------------------------------------------------------------------
// UNLINKED — Remote answered, and the answer is "there is no such request"
// ---------------------------------------------------------------------------

test("no id and no employment is UNLINKED, not an error — nothing could be looked up", async () => {
  const link = await resolveWorkAuthorizationRequest({ remote: fakeRemote(), destinationCountry: "ES" });
  assert.equal(link.state, LINK_UNLINKED);
  assert.equal(link.reason, "no_remote_work_authorization_request");
});

test("Remote holding no pending request for this employee is UNLINKED — the portal's ordinary case", async () => {
  const link = await resolveWorkAuthorizationRequest({
    remote: fakeRemote({ list: async () => [] }),
    employmentId: "emp_1",
    destinationCountry: "ES",
  });
  assert.equal(link.state, LINK_UNLINKED);
  assert.equal(link.reason, "no_pending_work_authorization_request");
});

test("pending requests that all name other destinations is UNLINKED, not a guess at the nearest one", async () => {
  const link = await resolveWorkAuthorizationRequest({
    remote: fakeRemote({ list: async () => [request({ id: "req_pt", country: "PT" })] }),
    employmentId: "emp_1",
    destinationCountry: "ES",
  });
  assert.equal(link.state, LINK_UNLINKED);
  assert.equal(link.reason, "no_matching_work_authorization_request");
  assert.equal(link.id, null);
});

// ---------------------------------------------------------------------------
// UNRESOLVED — we could not establish WHICH request this is. Never guess past
// this: a PATCH against a request we did not identify approves a trip nobody
// assessed.
// ---------------------------------------------------------------------------

test("two pending requests to the same destination is UNRESOLVED — employment alone does not identify one", async () => {
  const link = await resolveWorkAuthorizationRequest({
    remote: fakeRemote({ list: async () => [request({ id: "a" }), request({ id: "b" })] }),
    employmentId: "emp_1",
    destinationCountry: "ES",
  });
  assert.equal(link.state, LINK_UNRESOLVED);
  assert.equal(link.reason, "work_authorization_ambiguous");
  assert.equal(link.id, null, "an ambiguous resolution must not carry one of the candidates forward");
});

test("candidates with no readable destination to tell them apart is UNRESOLVED", async () => {
  const link = await resolveWorkAuthorizationRequest({
    remote: fakeRemote({ list: async () => [request({ id: "a" })] }),
    employmentId: "emp_1",
    destinationCountry: null,
  });
  assert.equal(link.state, LINK_UNRESOLVED);
  assert.equal(link.reason, "work_authorization_ambiguous");
});

test("a named id whose record is for a DIFFERENT destination is UNRESOLVED, never linked", async () => {
  // The most dangerous single case in this file. The gates judged Spain; the
  // request the webhook named is for Portugal. Approving it would record an
  // employer verdict against a trip that was never assessed.
  const link = await resolveWorkAuthorizationRequest({
    remote: fakeRemote({ get: async (id) => request({ id, country: "PT" }) }),
    workAuthorizationId: "req_pt",
    destinationCountry: "ES",
  });
  assert.equal(link.state, LINK_UNRESOLVED);
  assert.equal(link.reason, "work_authorization_destination_mismatch");
});

test("a named id whose record is no longer pending is UNRESOLVED", async () => {
  const link = await resolveWorkAuthorizationRequest({
    remote: fakeRemote({ get: async (id) => request({ id, status: "approved_by_manager" }) }),
    workAuthorizationId: "req_done",
    destinationCountry: "ES",
  });
  assert.equal(link.state, LINK_UNRESOLVED);
  assert.equal(link.reason, "work_authorization_not_pending");
});

test("a named id that 404s is UNRESOLVED with a not_found upstream — an id we were HANDED should have resolved", async () => {
  // Distinct from UNLINKED on purpose. "Nobody raised a request" and "the id
  // this request arrived with does not exist" are different facts with
  // different fixes, and recording them as one is the mistake
  // src/shared/upstreamFailure.js already exists to prevent one use case over.
  const link = await resolveWorkAuthorizationRequest({
    remote: fakeRemote({ get: async () => null }),
    workAuthorizationId: "req_gone",
    destinationCountry: "ES",
  });
  assert.equal(link.state, LINK_UNRESOLVED);
  assert.equal(link.reason, "work_authorization_not_found");
  assert.equal(link.upstream.kind, "not_found");
  assert.equal(link.upstream.status, 404);
});

test("a read that THROWS is UNRESOLVED and unreachable — nothing about the request is knowable", async () => {
  const link = await resolveWorkAuthorizationRequest({
    remote: fakeRemote({
      get: async () => {
        throw new Error("Remote API GET failed: 503");
      },
    }),
    workAuthorizationId: "req_1",
    destinationCountry: "ES",
  });
  assert.equal(link.state, LINK_UNRESOLVED);
  assert.equal(link.reason, "work_authorization_unreachable");
  assert.equal(link.upstream.kind, "unreachable");
});

test("a failing LIST is unreachable too, and never reported as 'no request exists'", async () => {
  const link = await resolveWorkAuthorizationRequest({
    remote: fakeRemote({
      list: async () => {
        throw new Error("Remote API GET failed: 403");
      },
    }),
    employmentId: "emp_1",
    destinationCountry: "ES",
  });
  assert.equal(link.state, LINK_UNRESOLVED);
  assert.equal(link.reason, "work_authorization_unreachable");
});

// ---------------------------------------------------------------------------
// FAIL-CLOSED BY CONSTRUCTION — the property the whole design rests on
// ---------------------------------------------------------------------------

const FACTORS = {
  homeCountry: "DE",
  nationality: "DE",
  destination: { country: "ES" },
  startDate: "2026-09-01",
  endDate: "2026-09-14",
  visaType: VISA_TYPES.schengen_short_stay,
  jobDuties: JOB_DUTY_CATEGORIES.engineering,
  hasContractSigningAuthority: false,
};

const ACTIVE_EMPLOYMENT = {
  id: "emp_1",
  status: "active",
  company_id: "co_1",
  custom_fields: { workation_permission: true },
};

function submitWith(remoteOverrides, ticketOverrides = {}) {
  return handleWorkationRequest(
    {
      employmentId: "emp_1",
      session: { companyId: "co_1", authenticatedAdminId: "admin_jane" },
      factors: FACTORS,
      travelHistory: [],
      now: "2026-08-15",
      ...ticketOverrides,
    },
    {
      remote: { getEmployment: async () => ACTIVE_EMPLOYMENT, ...remoteOverrides },
      audit: new AuditLogger(),
      authorizationStore: new AuthorizationStore(),
      draftSummary: fakeDraftSummary,
      judge: fakeJudge,
    }
  );
}

test("POSITIVE: a resolvable request still reaches ready_for_approval — the link is not a new refusal", async () => {
  // Load-bearing. Every assertion below it is a refusal, and a resolver that
  // refused everything would satisfy all of them while making UC-04 unusable —
  // the exact "structurally cannot succeed vs. appropriately cautious" collapse
  // this repository keeps paying for.
  const r = await submitWith({
    getWorkAuthorization: async (id) => request({ id }),
    listWorkAuthorizations: async () => [],
  }, { workAuthorizationId: "req_live" });
  assert.equal(r.decision, "ready_for_approval");
  assert.equal(r.workAuthorizationId, "req_live");
  assert.equal(r.remoteRequest.linked, true);
});

test("an UNRESOLVED link downgrades ready_for_approval to escalate, and records why", async () => {
  const r = await submitWith({
    getWorkAuthorization: async () => null,
    listWorkAuthorizations: async () => [],
  }, { workAuthorizationId: "req_gone" });
  assert.equal(r.decision, "escalate", "a request we cannot identify is not one-click approvable");
  assert.equal(r.reason, "work_authorization_not_found");
  assert.ok(r.flags.includes("work_authorization_not_found"));
  assert.equal(r.workAuthorizationId, null);
});

test("an UNRESOLVED link never overwrites an EARLIER gate's reason — first failure still wins", async () => {
  // Ordered gates: the employer-permission refusal happened before anything
  // about Remote's request was asked. The link reason rides along as a flag so
  // nothing is lost, but the recorded REASON stays the one that decided.
  const r = await submitWith(
    {
      getEmployment: async () => ({ ...ACTIVE_EMPLOYMENT, custom_fields: { workation_permission: true } }),
      getWorkAuthorization: async () => null,
      listWorkAuthorizations: async () => [],
    },
    { workAuthorizationId: "req_gone", factors: { ...FACTORS, destination: { country: "ZZ" } } }
  );
  assert.equal(r.decision, "escalate");
  assert.equal(r.reason, "destination_out_of_scope", "the gate that decided keeps the reason");
  assert.ok(r.flags.includes("work_authorization_not_found"), "and the link failure is still recorded");
});

test("an UNLINKED result changes NO decision — Remote answering 'no such request' is an answer", async () => {
  const r = await submitWith({ listWorkAuthorizations: async () => [] });
  assert.equal(r.decision, "ready_for_approval");
  assert.equal(r.remoteRequest.linked, false);
  assert.equal(r.remoteRequest.state, "unlinked");
  assert.equal(r.remoteRequest.reason, "no_pending_work_authorization_request");
});

test("a BLOCKED decision resolves nothing at all — Remote is not touched for a hard stop", async () => {
  const calls = [];
  const r = await submitWith(
    {
      getWorkAuthorization: async (...a) => (calls.push("get"), request()),
      listWorkAuthorizations: async (...a) => (calls.push("list"), []),
    },
    { workAuthorizationId: "req_1", factors: { ...FACTORS, destination: { country: "IR" } } }
  );
  assert.equal(r.decision, "blocked");
  assert.deepEqual(calls, []);
  assert.equal(r.remoteRequest.linked, false);
  assert.equal(r.remoteRequest.state, "not_resolved_for_this_decision");
});
