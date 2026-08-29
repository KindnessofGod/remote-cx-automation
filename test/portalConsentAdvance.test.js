// ---------------------------------------------------------------------------
// portalConsentAdvance.test.js — the WIRING, not the module
// ---------------------------------------------------------------------------
// This file exists because of a bug that shipped with eight passing tests
// behind it.
//
// `advanceOnConsentGrant()` was correct and unit-tested. The portal route that
// calls it compared `decision === "grant"` — the WIRE verb — while the route
// normalises to `decision === "granted"` (the stored status) fifty lines
// earlier. So the guard never fired: the grant recorded correctly, the response
// was a clean 200, and nothing advanced. From outside it was indistinguishable
// from the bug it had just been written to fix, and the module tests could not
// see it because the module was never reached.
//
// The lesson, and the reason this is a separate file: a seam tested only from
// one side is untested. These tests drive the ROUTE.
// ---------------------------------------------------------------------------

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { createPortalHandler } from "../src/portal/server.js";
import { CaseStore } from "../src/shared/caseStore.js";
import { AuditLogger } from "../src/shared/audit.js";
import { RemoteClient } from "../src/remote/restClient.js";
import { createInProcessFetch } from "../src/remote/mockServer.js";
import { handleVerificationTicket } from "../src/uc01/workflow.js";
import { classifyRequestRuleBased } from "../src/uc01/classifier.js";
import { PERSONAS } from "../src/portal/personas.js";

function callApi(h, { method, path, body = null }) {
  return new Promise((resolve, reject) => {
    const req = {
      method,
      url: path,
      headers: {},
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
        resolve({ status: this.statusCode, body: payload ? JSON.parse(payload) : null });
      },
    };
    h(req, res).catch(reject);
  });
}

/**
 * A pending third-party enquiry about an employment a portal persona OWNS.
 *
 * The personas carry real Sandbox UUIDs, which the in-process mock does not
 * hold — and the route refuses unless the deciding persona's employment id
 * equals the consent record's. So the door is given a small stand-in client
 * that answers for exactly that id, with the mock's own active-employee shape.
 * This test is about the WIRING; the record only has to be valid enough to
 * reach `awaiting_employee_consent`, which the assertion below enforces.
 */
async function pending() {
  const persona = Object.values(PERSONAS).find((p) => p.kind === "employee" && p.employmentId);
  assert.ok(persona, "no employee persona to decide as");

  const mock = new RemoteClient({ baseUrl: "http://mock.local", token: "t", fetchImpl: createInProcessFetch() });
  const template = await mock.getEmployment("emp_active_001");
  const record = { ...(template.raw ?? template), id: persona.employmentId };
  const doorRemote = {
    getEmployment: async (id) => (id === persona.employmentId ? { ...record, raw: record } : null),
    getLegalEntity: async () => null,
    listOffboardings: async () => [],
  };

  const caseStore = new CaseStore();
  const audit = new AuditLogger();
  const tickets = [];
  const zendesk = {
    createTicket: async (t) => {
      tickets.push(t);
      return { id: 6100 + tickets.length };
    },
    flagForReview: async () => ({}),
    listGroups: async () => [],
  };

  const out = await handleVerificationTicket(
    {
      text: "We need confirmation of this applicants employment status and start date.",
      session: null,
      employmentId: persona.employmentId,
      requestingParty: "Sandpiper Finance",
      purpose: "Personal loan verification",
      subjectName: "Amara Okafor",
      returnAddress: "loans@sandpiper.example.com",
      source: "third_party_door",
      externalRef: "fde193df-4704-40f3-bec5-c83683df3ab9",
    },
    { remote: doorRemote, audit, caseStore, zendesk, classify: classifyRequestRuleBased }
  );
  assert.equal(out.decision, "awaiting_employee_consent", `fixture reached ${out.decision}/${out.reason}`);
  const consent = caseStore.consentRecords.find((r) => r.status === "pending");
  assert.ok(consent, "no pending consent record to decide");

  const handler = createPortalHandler({
    remote: doorRemote,
    audit,
    stores: { uc01: caseStore },
    llm: {},
    zendesk,
    thirdPartyRemote: doorRemote,
  });
  return { handler, caseStore, tickets, consent, persona: persona.id };
}

test("granting through the ROUTE raises the ticket — the wiring, not just the module", async () => {
  const { handler, tickets, consent, persona } = await pending();

  const res = await callApi(handler, {
    method: "POST",
    path: `/api/consent-requests/${consent.id}/decide`,
    body: { decision: "grant", persona },
  });

  assert.equal(res.status, 200, `the grant itself failed: ${JSON.stringify(res.body)}`);
  assert.equal(res.body.request.status, "granted");
  assert.equal(tickets.length, 1, "granting through the route recorded the consent but advanced nothing");
});

test("denying through the ROUTE advances nothing", async () => {
  const { handler, tickets, consent, persona } = await pending();
  const res = await callApi(handler, {
    method: "POST",
    path: `/api/consent-requests/${consent.id}/decide`,
    body: { decision: "deny", persona },
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.request.status, "denied");
  assert.equal(tickets.length, 0, "a refusal was handed to a specialist");
});

test("the route compares the NORMALISED decision, not the wire verb", () => {
  // The defect in one assertion. `grant` is what the browser sends; `granted`
  // is what the route works in. A guard on the wire verb is dead code that
  // looks alive.
  const source = readSource();
  const guard = source.slice(source.indexOf("advanceOnConsentGrant({"));
  assert.ok(guard.length > 0, "the advance call has moved — re-point this test");
  assert.match(
    source,
    /if \(decision === "granted"\) \{/,
    "the advance is gated on something other than the normalised decision"
  );
  assert.doesNotMatch(
    source,
    /if \(decision === "grant"\) \{/,
    "the advance is gated on the wire verb again — it will never fire"
  );
});

function readSource() {
  return readFileSync(new URL("../src/portal/server.js", import.meta.url), "utf8");
}


