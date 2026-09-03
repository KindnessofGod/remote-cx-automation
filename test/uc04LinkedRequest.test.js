/**
 * W-1 — THE PANEL SAID "NO DOCUMENT" ABOUT A REQUEST CARRYING A DOCUMENT NUMBER.
 *
 * `requestLink.js` resolves which Remote work-authorization request a decision
 * belongs to, at decision time, and keeps only its id. Everything else Remote
 * returned — `travel_document_number`, `work_location`,
 * `will_negotiate_or_sign_contracts`, `reason`, `additional_information`,
 * `submitted_at` — was read and dropped. Meanwhile dimension 4 told a
 * specialist the request holds nothing but a visa TYPE from a dropdown, and its
 * own `whatItWouldTake` named `travel_document_number` as the field that would
 * improve it. The field was already being fetched.
 *
 * FOUR PROPERTIES, AND THE FIRST TWO ARE THE ONES THAT COULD DO HARM:
 *
 * 1. IT CANNOT CLEAR THE IMMIGRATION DIMENSION, EVER. A travel document number
 *    is the number of the document the traveller will travel ON — a passport —
 *    typed by the requester on Remote's own form. UC-04.md §5/§9 forbid
 *    inferring the immigration document, and no value of this read may produce
 *    a `cleared`.
 * 2. IT CANNOT CHANGE A DECISION. The read happens on the route that RENDERS a
 *    verdict, after the verdict exists. Asserted structurally as well as
 *    behaviourally, because "it happens to be called late" is not a guarantee.
 * 3. FOUR ABSENCES, FOUR SENTENCES. "No linked request", "Remote says it is
 *    gone", "we could not ask" and "this deployment never asks" are different
 *    facts and only one of them is about the traveller.
 * 4. IT FAILS SOFT. A read failure degrades one card and never the panel — the
 *    one place in UC-04 where soft is right, because the alternative is hiding
 *    a case from the specialist holding the ticket for it.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  readLinkedRequest,
  LINKED_NONE,
  LINKED_NOT_LOOKED_UP,
  LINKED_MISSING,
  LINKED_UNAVAILABLE,
  LINKED_READ,
} from "../src/uc04/linkedRequest.js";
import { describeDecisionBasis } from "../src/uc04/decisionFacts.js";
import { classifyRisk } from "../src/uc04/riskMatrix.js";

const REQUEST = {
  id: "war_001",
  status: "pending",
  travel_document_number: "NL7712345",
  work_location: "Client office, Amsterdam",
  will_negotiate_or_sign_contracts: false,
  reason: "Team offsite",
  additional_information: "Returning via Berlin",
  submitted_at: "2026-08-20T09:00:00Z",
};

const remoteWith = (impl) => ({ getWorkAuthorization: impl });

function basisWith(linkedRequest) {
  const factors = {
    homeCountry: "US",
    nationality: "US",
    destination: { country: "NL" },
    startDate: "2026-12-01",
    endDate: "2026-12-10",
    visaType: "schengen_short_stay",
    jobDuties: "engineering",
    hasContractSigningAuthority: false,
    priorTravel: [],
  };
  const risk = classifyRisk({
    sourceCountry: "US",
    homeCountry: "US",
    nationality: "US",
    destinationCountry: "NL",
    startDate: factors.startDate,
    endDate: factors.endDate,
    visaType: factors.visaType,
    jobDuties: factors.jobDuties,
    hasContractSigningAuthority: false,
    travelHistory: [],
    now: "2026-09-01T00:00:00Z",
  });
  return describeDecisionBasis({
    authorizationRow: { factors, risk, flags: (risk.flags ?? []).map((f) => f.code ?? f), tripDays: 10 },
    linkedRequest,
  });
}

const documentDimensionOf = (basis) => basis.dimensions.find((d) => d.key === "immigration_document");
const rowOf = (basis, label) =>
  documentDimensionOf(basis).evidence.find((e) => e.label === label)?.value ?? null;

// ---------------------------------------------------------------------------
// The read itself
// ---------------------------------------------------------------------------

test("a linked request is read live and named field by field", async () => {
  const read = await readLinkedRequest({ remote: remoteWith(async () => REQUEST), workAuthorizationId: "war_001" });
  assert.equal(read.state, LINKED_READ);
  assert.equal(read.id, "war_001");
  assert.deepEqual(read.fields, {
    travelDocumentNumber: "NL7712345",
    workLocation: "Client office, Amsterdam",
    willNegotiateOrSignContracts: false,
    reason: "Team offsite",
    additionalInformation: "Returning via Berlin",
    submittedAt: "2026-08-20T09:00:00Z",
    status: "pending",
  });
  assert.match(read.finding, /Read from Remote just now/);
  // THE ID IS DATA, NOT PROSE. A raw UUID in a sentence a specialist reads is
  // the bare-UUID defect this panel already fixed once for `employmentId`;
  // test/zafNoDeveloperArtifacts.test.js caught this one before it shipped.
  assert.doesNotMatch(read.finding, /war_001/);
  assert.equal(read.id, "war_001", "the id must still be published as a field");
});

test("a field Remote adds later does not reach the panel unlabelled", async () => {
  // Named one by one on purpose: a spread would put a new Remote field on an
  // approval screen with no label, no provenance and nobody's decision behind
  // it. The set of keys is the contract.
  const read = await readLinkedRequest({
    remote: remoteWith(async () => ({ ...REQUEST, some_new_remote_field: "surprise" })),
    workAuthorizationId: "war_001",
  });
  assert.ok(!Object.values(read.fields).includes("surprise"));
  assert.ok(!("some_new_remote_field" in read.fields));
});

test("'will not sign' and 'nobody asked' stay apart", async () => {
  // `false` is an answer; absent is not. A boolean cast here reports an
  // unanswered question as a confident no, on the one field that feeds the
  // permanent-establishment dimension.
  const answeredNo = await readLinkedRequest({
    remote: remoteWith(async () => ({ ...REQUEST, will_negotiate_or_sign_contracts: false })),
    workAuthorizationId: "war_001",
  });
  const unanswered = await readLinkedRequest({
    remote: remoteWith(async () => ({ ...REQUEST, will_negotiate_or_sign_contracts: undefined })),
    workAuthorizationId: "war_001",
  });
  assert.equal(answeredNo.fields.willNegotiateOrSignContracts, false);
  assert.equal(unanswered.fields.willNegotiateOrSignContracts, null);
});

// ---------------------------------------------------------------------------
// 3. Four absences, four sentences
// ---------------------------------------------------------------------------

test("the four absences are four different states and four different sentences", async () => {
  const none = await readLinkedRequest({ remote: remoteWith(async () => REQUEST), workAuthorizationId: null });
  const notLookedUp = await readLinkedRequest({ remote: null, workAuthorizationId: "war_001" });
  const missing = await readLinkedRequest({ remote: remoteWith(async () => null), workAuthorizationId: "war_001" });
  const unavailable = await readLinkedRequest({
    remote: remoteWith(async () => {
      const err = new Error("boom");
      err.status = 503;
      throw err;
    }),
    workAuthorizationId: "war_001",
  });

  assert.equal(none.state, LINKED_NONE);
  assert.equal(notLookedUp.state, LINKED_NOT_LOOKED_UP);
  assert.equal(missing.state, LINKED_MISSING);
  assert.equal(unavailable.state, LINKED_UNAVAILABLE);

  const findings = [none, notLookedUp, missing, unavailable].map((r) => r.finding);
  assert.equal(new Set(findings).size, 4, "two absences are telling a specialist the same thing");
  // The one that is NOT about the traveller must say so.
  assert.match(unavailable.finding, /failure to read, not a finding about the request/);
  assert.match(unavailable.finding, /HTTP 503/);
  // And a 404 is Remote answering, which is a different fact from a failure.
  assert.equal(missing.httpStatus, 404);
  assert.equal(unavailable.httpStatus, 503);
});

test("the read never throws, whatever Remote does", async () => {
  // A display block on the panel a specialist opened holding the ticket. A read
  // failure here degrades one card; throwing would lose the whole case.
  for (const impl of [
    async () => {
      throw new Error("network");
    },
    async () => {
      throw "a string, not an Error";
    },
    async () => undefined,
  ]) {
    const read = await readLinkedRequest({ remote: remoteWith(impl), workAuthorizationId: "war_001" });
    assert.ok(read.finding, "a branch returned no sentence");
    assert.ok([LINKED_MISSING, LINKED_UNAVAILABLE].includes(read.state));
  }
});

// ---------------------------------------------------------------------------
// 1. It cannot clear the immigration dimension
// ---------------------------------------------------------------------------

test("a travel document number reaches the finding, and still does not clear the dimension", async () => {
  const read = await readLinkedRequest({ remote: remoteWith(async () => REQUEST), workAuthorizationId: "war_001" });
  const dimension = documentDimensionOf(basisWith(read));

  assert.match(dimension.finding, /NL7712345/, "the number the request was already carrying is still not shown");
  assert.match(dimension.finding, /not a right to work at the destination/);
  assert.match(dimension.finding, /Verify it, and obtain the destination's authorization/);
  // THE GUARANTEE. UC-04.md §5/§9 forbid inferring the immigration document.
  assert.notEqual(dimension.state, "cleared");
});

test("no linked request, however rich, can reach a cleared state on this dimension", async () => {
  // Swept rather than argued: every shape this read can produce, against the
  // one state that must be unreachable.
  const shapes = [
    REQUEST,
    { ...REQUEST, status: "approved" },
    { ...REQUEST, will_negotiate_or_sign_contracts: true },
    { ...REQUEST, travel_document_number: "WORK-PERMIT-12345" },
    null,
  ];
  for (const shape of shapes) {
    const read = await readLinkedRequest({ remote: remoteWith(async () => shape), workAuthorizationId: "war_001" });
    assert.notEqual(documentDimensionOf(basisWith(read)).state, "cleared", JSON.stringify(shape));
  }
});

test("the evidence row says WHICH absence it is, never a bare 'none'", async () => {
  const LABEL = "Travel document number on the Remote request";
  const cases = [
    [await readLinkedRequest({ remote: remoteWith(async () => REQUEST), workAuthorizationId: "war_001" }), "NL7712345"],
    [
      await readLinkedRequest({
        remote: remoteWith(async () => ({ ...REQUEST, travel_document_number: null })),
        workAuthorizationId: "war_001",
      }),
      "not stated on the request",
    ],
    [await readLinkedRequest({ remote: remoteWith(async () => null), workAuthorizationId: "war_001" }), "the linked Remote request no longer exists"],
    [await readLinkedRequest({ remote: null, workAuthorizationId: null }), "no Remote request is linked to this decision"],
  ];
  for (const [read, expected] of cases) {
    assert.equal(rowOf(basisWith(read), LABEL), expected);
  }
});

test("with no linked request the finding is the one it always was", async () => {
  // The portal's ordinary case must not regress into naming a document nobody
  // supplied, and must not start reporting an absence as if Remote had spoken.
  const read = await readLinkedRequest({ remote: null, workAuthorizationId: null });
  const dimension = documentDimensionOf(basisWith(read));
  assert.match(dimension.finding, /is a type the requester selected, not a document/);
  assert.doesNotMatch(dimension.finding, /travel document [A-Z0-9]/);
});

// ---------------------------------------------------------------------------
// 2. It cannot change a decision — structurally
// ---------------------------------------------------------------------------

test("no gate, matrix or workflow reads the linked request", () => {
  // The same guard decisionSources.js and identityDocuments.js already carry.
  // A fact that cannot change an outcome can be reported honestly without
  // anyone re-auditing the gates; a fact that CAN must be argued from the spec.
  for (const file of ["policyEngine.js", "riskMatrix.js", "approvalPolicy.js", "workflow.js", "requestParser.js"]) {
    const source = readFileSync(new URL(`../src/uc04/${file}`, import.meta.url), "utf8");
    assert.ok(
      !source.includes("readLinkedRequest") && !source.includes("linkedRequest.js"),
      `src/uc04/${file} reaches for the linked request — it would make a view fact a gate input`
    );
  }
});

test("both new blocks survive the view whitelist and reach a rendered panel", async () => {
  /* THE FAILURE THIS EXISTS FOR, AND IT HAPPENED. The server published
     `remoteRequest` and `employerPresence`, the renderers were written, every
     unit test passed — and neither card appeared, because `loadUc04()` builds
     its view from a WHITELIST and neither key was on it. A field parsed nowhere
     is indistinguishable, from the panel, from one the server never computed;
     that is how `gateLadder` once reached zero of nine panels.

     No test that imports a function can see this. It is only visible by driving
     the real bundle against the real handler and reading what came out, which
     is what this does. */
  const { renderSidebar } = await import("./fixtures/zafSidebar.js");
  const { createUc04Handler } = await import("../src/uc04/server.js");
  const { AuthorizationStore } = await import("../src/uc04/authorizationStore.js");
  const { AuditLogger } = await import("../src/shared/audit.js");
  const { handleWorkationRequest } = await import("../src/uc04/workflow.js");

  const employment = {
    id: "emp1", status: "active", company_id: "co1", full_name: "Chris Lee",
    job_title: "Staff Engineer", country_code: "US", contract_type: "employee",
    custom_fields: { workation_permission: true },
  };
  const remote = {
    async getEmployment() { return employment; },
    async listLegalEntities() { return [{ id: "le_nl", name: "Acme BV", country_code: "NL" }]; },
    async getWorkAuthorization() { return REQUEST; },
    async listWorkAuthorizations() { return { work_authorization_requests: [] }; },
  };

  const store = new AuthorizationStore();
  const audit = new AuditLogger();
  await handleWorkationRequest(
    {
      employmentId: "emp1",
      session: { companyId: "co1", authenticatedAdminId: "admin" },
      factors: {
        homeCountry: "US", nationality: "US", destination: { country: "NL" },
        startDate: "2026-12-01", endDate: "2026-12-10", visaType: "schengen_short_stay",
        jobDuties: "engineering", hasContractSigningAuthority: false,
        activityProfile: { activitiesToBePerformed: "Design reviews", specialWorksite: "none" },
      },
      travelHistory: [], reasonText: "planning", externalRef: "77", source: "portal", now: "2026-09-01",
    },
    { remote, audit, authorizationStore: store, draftSummary: async () => ({ summary: "s" }), judge: async () => ({ verdict: "ok" }) }
  );
  const row = await store.findByExternalRef("77");
  row.workAuthorizationId = "war_001";

  const handler = createUc04Handler({ authorizationStore: store, audit, remote });
  const BASE = "http://uc04.test";
  const { text } = await renderSidebar({
    settings: { apiBaseUrl: "", uc04ApiBaseUrl: BASE },
    ticketId: "77",
    respond: async (url, init) => {
      if (String(url).indexOf(BASE) !== 0) return { status: 404, body: { found: false } };
      const res = { code: 200, body: null, setHeader() {}, writeHead(c) { this.code = c; }, end(b) { this.body = b; } };
      await handler({ method: init?.method || "GET", url: String(url).slice(BASE.length), headers: {} }, res);
      return { status: res.code, body: JSON.parse(res.body) };
    },
  });

  assert.match(text, /The request the employee raised in Remote/);
  assert.match(text, /NL7712345/, "the travel document number did not reach the rendered panel");
  assert.match(text, /Where the customer has companies/);
  assert.match(text, /has a legal entity in Netherlands/);
  assert.match(text, /What they will be doing there/);
  assert.match(text, /Notice before departure/);
  // A DATE, NOT A TIMESTAMP. The machine-readable form printed in a row of
  // plain-language facts reads as something nobody looked at.
  assert.match(text, /Submitted 2026-08-20/);
  assert.doesNotMatch(text, /2026-08-20T09:00:00Z/);
});

test("the panel renders every state and paraphrases none of them", () => {
  const main = readFileSync(new URL("../zaf-app/assets/main.js", import.meta.url), "utf8");
  assert.match(main, /function renderRemoteRequest\(view\)/);
  // The card appears for an absence too — otherwise "no linked request" and "a
  // panel without the field" look identical.
  assert.match(main, /if \(!request \|\| !request\.finding\) return null;/);
  // The provenance sentence is the server's, verbatim.
  assert.match(main, /request\.finding/);
  // Tristate at the render layer as well as the read layer.
  assert.match(main, /willNegotiateOrSignContracts === true/);
  assert.match(main, /willNegotiateOrSignContracts === false/);
});
