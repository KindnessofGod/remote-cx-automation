// ---------------------------------------------------------------------------
// mockServerColdStart.test.js — the mock's cross-request state, on serverless
// ---------------------------------------------------------------------------
// THE DEFECT (reported at the end of §3.52, not fixed there):
//
//   §3.52 routed a portal-originated record's EXECUTION into the same world its
//   DECISION was made in — the in-process mock — because the portal's personas
//   are mock ids and a public page must not write into a real Remote account.
//   That is right, and it left one hole: `WORK_AUTHORIZATIONS` in
//   src/remote/mockServer.js is module-level process state. A UC-04 submission
//   CREATED the record in one HTTP request; the specialist's approval PATCHed
//   it in a LATER one. On a serverless function those are different
//   invocations, so a cold start between them made the record VANISH and the
//   approval 404 *at the mock*.
//
// HOW THE DEFECT WAS CLOSED FOR GOOD, 2026-08-19. The original fix encoded the
// record inside the id the create minted, so a later invocation could rebuild
// it. That machinery is now gone, along with its whole justification: there is
// no `POST /v1/work-authorization-requests` on the real API, so nothing creates
// a work authorization here any more. Every request a caller can address is a
// fixture CHECKED INTO src/remote/mockServer.js, and a fresh module load has it
// already — the cold start has nothing to lose. Deleting a careful mechanism is
// the right outcome when the thing it compensated for should never have existed.
//
// WHY A POSITIVE TEST IS THE ONLY THING THAT FINDS THIS. A path that cannot
// succeed and a path refusing correctly produce identical output from outside
// (CLAUDE.md §4/§5, §3.30, §3.52). Every fail-closed assertion in this repo
// passed while portal-originated UC-04 approvals were unreachable. So the
// load-bearing test here is test 1: an approval MUST land across a cold start.
//
// HOW A COLD START IS SIMULATED. Importing the module under a fresh URL
// (`?cold=N`) gives a genuinely separate module instance with its own
// `WORK_AUTHORIZATIONS`, deep-copied from the fixture template — the same thing
// a new serverless container does, and stronger than mutating the map by hand,
// because it also proves nothing else in the module is quietly carrying state.
// Test 0 pins that the two instances really are disjoint, so a later refactor
// cannot turn this whole file into a no-op without failing loudly.
//
// Hermetic: createInProcessFetch() dispatches into the mock's route table
// in-process. No socket, no network, no key.
// ---------------------------------------------------------------------------

import { test } from "node:test";
import assert from "node:assert/strict";

import { RemoteClient } from "../src/remote/restClient.js";
import { PORTAL_SOURCE } from "../src/portal/server.js";
import { AuditLogger } from "../src/shared/audit.js";
import { AuthorizationStore } from "../src/uc04/authorizationStore.js";
import { handleWorkationRequest, submitWorkationApproval } from "../src/uc04/workflow.js";
import { draftSummary as uc04DraftSummary } from "../src/uc04/requestParser.js";
import { VISA_TYPES, JOB_DUTY_CATEGORIES } from "../src/uc04/riskMatrix.js";

// The same base URL deps.js's mockRemoteClient() uses. `.invalid` is reserved
// by RFC 2606 and can never resolve, so if fetchImpl were ever dropped the
// failure would be immediate rather than a silent call to something real.
const MOCK_BASE_URL = "http://mock.remote.invalid";

// Fixture ids, from src/remote/mockServer.js. Named here rather than repeated
// so a fixture change breaks one line, not seven.
const PENDING_ES_FOR_CHRIS = "6b8e1d47-0c53-4a92-bf10-77d4c2e8a5f3";
const SETTLED_PT_FOR_AMARA = "b0d9a3e2-4f17-4c86-9a55-1e6b7c8d90aa";

let coldStarts = 0;
/**
 * One serverless invocation: a freshly loaded mock module plus the client
 * deps.js would build in front of it. Returns both, so a test can inspect the
 * module's own state and not only the client's answers.
 */
async function invocation() {
  const mod = await import(`../src/remote/mockServer.js?cold=${++coldStarts}`);
  return {
    mod,
    remote: new RemoteClient({ baseUrl: MOCK_BASE_URL, fetchImpl: mod.createInProcessFetch() }),
  };
}

// Never a real, retried LLM call from a suite that does not care about prose
// (CLAUDE.md §6): the REAL drafter, forced into its unconfigured branch.
const fakeUc04Draft = (args) => uc04DraftSummary(args, { isConfigured: () => false });
const fakeJudge = async () => ({ verdict: "not_evaluated", reason: null });

function workationRequest(source) {
  return {
    employmentId: "8ab12460-b568-4c1e-af9d-09b1fabd8f46",
    session: { companyId: "co_amend_01", authenticatedAdminId: "admin_jane" },
    factors: {
      homeCountry: "US",
      nationality: "US",
      destination: { country: "ES" },
      startDate: "2026-09-01",
      endDate: "2026-09-14",
      visaType: VISA_TYPES.schengen_short_stay,
      jobDuties: JOB_DUTY_CATEGORIES.engineering,
      hasContractSigningAuthority: false,
    },
    travelHistory: [],
    now: "2026-08-15",
    source,
  };
}

// ---------------------------------------------------------------------------
// 0. The simulation itself
// ---------------------------------------------------------------------------

test("0. two invocations are genuinely disjoint modules — the cold start is real, not staged", async () => {
  const first = await invocation();
  // Settle one request in A's world. A PATCH is a state change, so this is a
  // real mutation of A's copy and nothing else.
  await first.remote.patchWorkAuthorization(PENDING_ES_FOR_CHRIS, { status: "approved_by_manager" });
  assert.equal(first.mod.WORK_AUTHORIZATIONS[PENDING_ES_FOR_CHRIS].status, "approved_by_manager");

  const second = await invocation();
  assert.notEqual(second.mod, first.mod);
  assert.equal(
    second.mod.WORK_AUTHORIZATIONS[PENDING_ES_FOR_CHRIS].status,
    "pending",
    "a fresh invocation must not carry A's mutation, or this file proves nothing"
  );
});

// ---------------------------------------------------------------------------
// 1. THE POSITIVE — the whole point of the file
// ---------------------------------------------------------------------------

test("1. POSITIVE — a portal-originated UC-04 authorization IS approvable ACROSS A COLD START", async () => {
  const audit = new AuditLogger();
  const authorizationStore = new AuthorizationStore();

  // --- invocation A: the portal submits. The record is created in A's mock.
  const submit = await invocation();
  const submitted = await handleWorkationRequest(workationRequest(PORTAL_SOURCE), {
    remote: submit.remote,
    audit,
    authorizationStore,
    draftSummary: fakeUc04Draft,
    judge: fakeJudge,
  });
  assert.equal(submitted.decision, "ready_for_approval", submitted.reason);
  assert.equal(
    submitted.workAuthorizationId,
    PENDING_ES_FOR_CHRIS,
    "the pending request this employee raised in Remote's Request Hub, resolved not created"
  );

  // --- invocation B: a specialist approves, days later, in a new container.
  const approve = await invocation();
  assert.equal(
    approve.mod.WORK_AUTHORIZATIONS[submitted.workAuthorizationId].status,
    "pending",
    "the approving invocation has never seen A's work, and starts from the checked-in fixture"
  );

  const result = await submitWorkationApproval(
    { authorizationId: submitted.authorizationId, action: "approve", approver: "mobility_sam" },
    // forSource(PORTAL_SOURCE) -> the mock, exactly as deps.js wires it. The
    // default client throws on every method, so this cannot pass by silently
    // executing in the wrong world.
    { remote: sourceAware(approve.remote), audit, authorizationStore }
  );

  assert.equal(result.ok, true, result.reason);
  assert.equal(result.code, "executed");
  assert.equal(result.remoteResult.status, "approved_by_manager");
  // `approved_by` is not a property of Remote's object at all — the approver is
  // read back as `employer_approver`, and both update schemas are
  // `additionalProperties: false` (docs/REMOTE-VOCABULARY.md §5.6).
  assert.equal("approved_by" in result.remoteResult, false);
});

test("2. THE CREATE IS GONE — the mock refuses the POST exactly as the live API does", async () => {
  // THE NEGATIVE THIS PASS EXISTS FOR. `POST /v1/work-authorization-requests`
  // is not a route on Remote's API, and the mock used to implement it, which is
  // why the whole suite agreed with code that had been aimed at nothing.
  //
  // The body shape is the assertion that matters. Live, this Sandbox answers an
  // UNROUTED method+path with a bare JSON STRING and a ROUTED path with a
  // missing record with an OBJECT (docs/REMOTE-VOCABULARY.md §13.0(a)) — and
  // since the GET on this same collection returns 200, a bare string here means
  // exactly one thing: there is no POST route. A mock that answered with its own
  // `{error:"no_such_route"}` vocabulary would erase the only read-only signal
  // that separates "this endpoint does not exist" from "this record does not".
  const cold = await invocation();
  const res = await cold.mod.createInProcessFetch()(`${MOCK_BASE_URL}/v1/work-authorization-requests`, {
    method: "POST",
    body: JSON.stringify({ employment_id: "emp_active_001", destination_country: "ES" }),
  });
  assert.equal(res.status, 404);
  const body = await res.json();
  assert.equal(typeof body, "string", "the UNROUTED 404 is a bare JSON string, not an object");
  assert.equal(body, "Not Found");

  // And the client method is gone too, not merely unused: a method that refuses
  // is one edit away from being called again.
  assert.equal(cold.remote.createWorkAuthorization, undefined);
});

test("3. THE OLD PATCH BODY IS REFUSED — the mock stopped agreeing with us", async () => {
  // If this passes with the old payload, the mock has not been fixed. Every
  // field below was sent by this repository until 2026-08-19 and accepted by a
  // mock that merged whatever it was given.
  const cold = await invocation();
  const fetchImpl = cold.mod.createInProcessFetch();
  const patch = (payload) =>
    fetchImpl(`${MOCK_BASE_URL}/v1/work-authorization-requests/${PENDING_ES_FOR_CHRIS}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    });

  const legacy = await patch({
    status: "approved_by_remote",
    approved_by: "mobility_sam",
    approved_at: "2026-08-19T00:00:00Z",
    decision_reason: null,
  });
  assert.equal(legacy.status, 422, "the exact body this repo used to send must now be refused");
  assert.match((await legacy.json()).errors.status[0], /approved_by_manager/);

  // The status alone, without the three refused fields, is still not a caller's
  // to set: `approved_by_remote` is Remote's own compliance verdict.
  const remoteVerdict = await patch({ status: "approved_by_remote" });
  assert.equal(remoteVerdict.status, 422);

  // `additionalProperties: false` — a field Remote does not have, on an
  // otherwise valid branch.
  const extra = await patch({ status: "approved_by_manager", approved_by: "mobility_sam" });
  assert.equal(extra.status, 422);
  assert.ok((await extra.json()).errors.approved_by);

  // A decline without the REQUIRED `reason`.
  const noReason = await patch({ status: "declined_by_manager" });
  assert.equal(noReason.status, 422);
  assert.ok((await noReason.json()).errors.reason);

  // A status that is not a member of the enum at all — `declined` (which this
  // repo's REST-client JSDoc used to document) is not one; the member is
  // `declined_by_manager`.
  const notAMember = await patch({ status: "declined" });
  assert.equal(notAMember.status, 422);

  // And the request is untouched by any of the five refusals.
  assert.equal(cold.mod.WORK_AUTHORIZATIONS[PENDING_ES_FOR_CHRIS].status, "pending");
});

test("3b. both accepted branches ARE accepted — the mock is strict, not merely hostile", async () => {
  // The converse of test 3, and it earns its place: a validator that refuses
  // everything passes every negative test ever written about it.
  const cold = await invocation();
  const fetchImpl = cold.mod.createInProcessFetch();

  const approved = await fetchImpl(`${MOCK_BASE_URL}/v1/work-authorization-requests/${PENDING_ES_FOR_CHRIS}`, {
    method: "PATCH",
    body: JSON.stringify({ status: "approved_by_manager", employer_special_instructions: "keep receipts" }),
  });
  assert.equal(approved.status, 200);
  const approvedRow = (await approved.json()).data.work_authorization_request;
  assert.equal(approvedRow.status, "approved_by_manager");
  assert.equal(approvedRow.employer_special_instructions, "keep receipts");

  const cold2 = await invocation();
  const declined = await cold2.mod.createInProcessFetch()(
    `${MOCK_BASE_URL}/v1/work-authorization-requests/${PENDING_ES_FOR_CHRIS}`,
    { method: "PATCH", body: JSON.stringify({ status: "declined_by_manager", reason: "outside policy" }) }
  );
  assert.equal(declined.status, 200);
  assert.equal((await declined.json()).data.work_authorization_request.status, "declined_by_manager");
});

test("3c. an already-decided request cannot be re-decided — only `pending` awaits a manager", async () => {
  const cold = await invocation();
  const res = await cold.mod.createInProcessFetch()(
    `${MOCK_BASE_URL}/v1/work-authorization-requests/${SETTLED_PT_FOR_AMARA}`,
    { method: "PATCH", body: JSON.stringify({ status: "declined_by_manager", reason: "changed our mind" }) }
  );
  assert.equal(res.status, 422);
  assert.match((await res.json()).errors.status[0], /already approved_by_manager/);
});

// ---------------------------------------------------------------------------
// 4-6. What is deliberately still refused, and how loudly
// ---------------------------------------------------------------------------

test("4. an id no fixture backs still 404s — resolution is a lookup, never an invention", async () => {
  const cold = await invocation();
  // The shape this mock used to mint: an id that carried its own record. A
  // durable row still holding one in `uc04_authorizations.work_authorization_id`
  // must NOT rebuild into a work authorization nobody raised — that would
  // fabricate the very artifact a specialist's approval is recorded against.
  assert.equal(
    await cold.remote.getWorkAuthorization("war_k3f9a2b1"),
    null,
    "the read answers null on 404, as it does for any absent record"
  );
  await assert.rejects(
    () => cold.remote.patchWorkAuthorization("war_k3f9a2b1", { status: "approved_by_manager" }),
    (err) => {
      assert.match(err.message, /404/);
      return true;
    }
  );
});

test("5. that 404 is the REAL API's ROUTED shape — an object, not the bare string a missing route returns", async () => {
  // The two 404s are the whole read-only technique (§13.0(a)), and the mock has
  // to keep them apart or it teaches the distinction away. `{id}` is a route
  // that exists; `war_k3f9a2b1` is a record that does not.
  const cold = await invocation();
  const res = await cold.mod.createInProcessFetch()(
    `${MOCK_BASE_URL}/v1/work-authorization-requests/war_k3f9a2b1`,
    { method: "GET" }
  );
  assert.equal(res.status, 404);
  const body = await res.json();
  assert.equal(typeof body, "object");
  assert.deepEqual(body, { message: "Not Found" });
});

test("6. the collection is readable and filterable, and its envelope is Remote's", async () => {
  // `employment_id` and `status` are documented query parameters on Remote's own
  // list endpoint — which is what makes resolving a request by employment a
  // LOOKUP rather than a heuristic this repo invented.
  const cold = await invocation();
  const fetchImpl = cold.mod.createInProcessFetch();

  const all = await (await fetchImpl(`${MOCK_BASE_URL}/v1/work-authorization-requests`, { method: "GET" })).json();
  assert.equal(all.data.total_count, 3);
  assert.ok(Array.isArray(all.data.work_authorization_requests), "the array is named, not bare under `data`");

  const filtered = await (
    await fetchImpl(
      `${MOCK_BASE_URL}/v1/work-authorization-requests?employment_id=emp_active_001&status=pending`,
      { method: "GET" }
    )
  ).json();
  assert.equal(filtered.data.total_count, 1);
  assert.equal(filtered.data.work_authorization_requests[0].destination_country.alpha_2_code, "ES");

  // A closed-enum filter VALIDATES rather than silently not filtering — the trap
  // §13.0(b) records against `/v1/expenses?status=banana`, which happily returns
  // every row.
  const bogus = await fetchImpl(`${MOCK_BASE_URL}/v1/work-authorization-requests?status=pending_mobility`, {
    method: "GET",
  });
  assert.equal(bogus.status, 422, "`pending_mobility` was never a member of this enum, and this repo used to send it");
});

test("7. nothing on the wire carries an `employment_id` — the index is the mock's, not Remote's", async () => {
  // The real `WorkAuthorizationRequest` has NO employment reference at all; the
  // list filter is resolved server-side. Putting one on the record would be this
  // fixture teaching a field the API has never returned — the precise failure
  // mode that let the invented create survive.
  const cold = await invocation();
  for (const row of Object.values(cold.mod.WORK_AUTHORIZATIONS)) {
    assert.equal("employment_id" in row, false, `${row.id} must not carry an employment_id`);
    assert.equal("start_date" in row, false, "Remote's fields are travel_date_start / travel_date_end");
    assert.equal(typeof row.destination_country, "object", "destination_country is a Country object");
  }
});

// ---------------------------------------------------------------------------
// 8. The guarantee from §3.52 that must not move
// ---------------------------------------------------------------------------

test("8. nothing here widens the world mapping — only the portal tag yields the mock", async () => {
  const cold = await invocation();
  const real = { __real: true };
  const aware = sourceAwareOver(real, cold.remote);

  for (const source of [null, undefined, "", "webhook", "zaf", "remoteui", "PORTAL", "portal ", "seed"]) {
    assert.equal(aware.forSource(source), real, `source ${JSON.stringify(source)} must NOT reach the mock`);
  }
  assert.equal(aware.forSource(PORTAL_SOURCE), cold.remote);
});

// ---------------------------------------------------------------------------
// A local stand-in for deps.js's sourceAwareRemote() that lets a test choose
// BOTH clients. deps.js builds its mock from the process-wide module, which is
// exactly what this file must not use — every mock here is a cold instance.
// ---------------------------------------------------------------------------
function sourceAwareOver(defaultClient, mockClient) {
  const forSource = (source) => (source === PORTAL_SOURCE ? mockClient : defaultClient);
  return new Proxy(defaultClient, {
    get(target, prop, receiver) {
      if (prop === "forSource") return forSource;
      const value = Reflect.get(target, prop, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

// The default client throws on every method, so a portal record that escaped
// into the real world fails loudly rather than passing by accident.
function sourceAware(mockClient) {
  const refuse = new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === "then") return undefined;
        return () => {
          throw new Error(`a portal-originated record reached the REAL client (${String(prop)})`);
        };
      },
    }
  );
  return sourceAwareOver(refuse, mockClient);
}
