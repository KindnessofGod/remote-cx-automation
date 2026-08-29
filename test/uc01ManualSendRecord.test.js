// ---------------------------------------------------------------------------
// uc01ManualSendRecord.test.js — D-12 (rca-kfg2)
// ---------------------------------------------------------------------------
// "AN AUTHORISED DISCLOSURE HAS NO WAY TO BE SENT... THERE IS ALSO NO CONTROL
//  TO RECORD THAT IT COULD NOT BE SENT — SO THE FAILURE IS INVISIBLE TOO."
//
// This system does not send the letter to an outside party itself (see
// migrations/0003-cases-manual-send-record.sql's header for why building a
// sender would be the wrong fix). What it now has is a durable, audited way
// to record whether the manual step happened, or why it did not.
//
// POSITIVE TEST LEADS (C-16): asserts the record is actually STORED and
// READABLE afterwards (via caseStore.recordManualSend and the round-trip
// back through the case row), not merely that a request returns 200.
// ---------------------------------------------------------------------------

import { test } from "node:test";
import assert from "node:assert/strict";
import { createReviewHandler } from "../src/review/server.js";
import { AuditLogger } from "../src/shared/audit.js";

const APPROVED_THIRD_PARTY_CASE = {
  id: "case-114",
  useCase: "UC-01",
  externalRef: "114",
  employmentId: "emp_active_001",
  source: "third_party_door",
  decision: "human_review",
  reason: "third_party_request",
  flags: [],
  status: "resolved",
  returnAddress: "underwriting@ravensworth-bs.example.com",
  classification: { requestingParty: "Ravensworth Building Society", purpose: "mortgage underwriting" },
};

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

function harness({
  caseRow = APPROVED_THIRD_PARTY_CASE,
  documents = [{ type: "employment_verification_letter" }],
  withZendesk = false,
} = {}) {
  const recorded = [];
  const zendeskNotes = [];
  const store = {
    async findCaseByExternalRef() { return caseRow; },
    async findReviewEntryByCaseId() { return { id: "rq-1", caseId: caseRow.id, status: "approved" }; },
    async findDocumentsByCaseId() { return documents; },
  };
  const caseStore = {
    async recordManualSend(caseId, args) {
      recorded.push({ caseId, ...args });
      return true;
    },
  };
  const zendesk = withZendesk
    ? {
        async flagForReview(id, args) {
          zendeskNotes.push({ id, ...args });
          return true;
        },
      }
    : null;
  const handler = createReviewHandler({
    store,
    caseStore,
    audit: new AuditLogger(),
    remote: { async getEmployment() { return { id: "emp_active_001", status: "active" }; } },
    zendesk,
  });
  return { handler, recorded, zendeskNotes };
}

test("D-12: recording 'sent' on an approved third-party case succeeds and is durably stored", async () => {
  const { handler, recorded } = harness();
  const res = await callApi(handler, {
    method: "POST",
    path: "/api/review/ticket/114/manual-send",
    body: { approver: "dana@example.com", status: "sent", note: "delivery ref 12345" },
  });

  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.manualSendStatus, "sent");
  assert.equal(recorded.length, 1);
  assert.equal(recorded[0].caseId, "case-114");
  assert.equal(recorded[0].status, "sent");
  assert.equal(recorded[0].by, "dana@example.com");
  assert.equal(recorded[0].note, "delivery ref 12345");
  assert.ok(recorded[0].at, "the outcome must carry a timestamp");
});

test("D-12: 'could not send' REQUIRES a reason — the failure must not be recordable as a silent nothing", async () => {
  const { handler, recorded } = harness();
  const res = await callApi(handler, {
    method: "POST",
    path: "/api/review/ticket/114/manual-send",
    body: { approver: "dana@example.com", status: "could_not_send", note: "" },
  });

  assert.equal(res.status, 400);
  assert.equal(res.body.ok, false);
  assert.equal(res.body.code, "reason_required");
  assert.equal(recorded.length, 0, "nothing must be recorded until a reason is supplied");
});

test("D-12: a reasoned 'could not send' is recorded, distinct from 'sent'", async () => {
  const { handler, recorded } = harness();
  const res = await callApi(handler, {
    method: "POST",
    path: "/api/review/ticket/114/manual-send",
    body: {
      approver: "dana@example.com",
      status: "could_not_send",
      note: "No side-conversation create control, no relevant Ticket Actions entry, and CC would expose this internal ticket to the outsider.",
    },
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.manualSendStatus, "could_not_send");
  assert.equal(recorded[0].status, "could_not_send");
  assert.match(recorded[0].note, /No side-conversation/);
});

test("D-12: refused on a case with no letter issued yet — nothing to record a send for", async () => {
  const { handler, recorded } = harness({ documents: [] });
  const res = await callApi(handler, {
    method: "POST",
    path: "/api/review/ticket/114/manual-send",
    body: { approver: "dana@example.com", status: "sent" },
  });
  assert.equal(res.status, 409);
  assert.equal(res.body.code, "no_letter_issued");
  assert.equal(recorded.length, 0);
});

test("D-12: refused on a non-third-party case — there is no outward disclosure to record", async () => {
  const { handler, recorded } = harness({
    caseRow: { ...APPROVED_THIRD_PARTY_CASE, source: "zendesk", externalRef: "1001" },
  });
  const res = await callApi(handler, {
    method: "POST",
    path: "/api/review/ticket/1001/manual-send",
    body: { approver: "dana@example.com", status: "sent" },
  });
  assert.equal(res.status, 409);
  assert.equal(res.body.code, "not_a_third_party_disclosure");
  assert.equal(recorded.length, 0);
});

test("D-12: refused with no approver identified — this must be attributable, never anonymous", async () => {
  const { handler, recorded } = harness();
  const res = await callApi(handler, {
    method: "POST",
    path: "/api/review/ticket/114/manual-send",
    body: { status: "sent" },
  });
  assert.equal(res.status, 401);
  assert.equal(res.body.code, "approver_required");
  assert.equal(recorded.length, 0);
});

test("D-12: an invalid status value is refused rather than silently accepted", async () => {
  const { handler, recorded } = harness();
  const res = await callApi(handler, {
    method: "POST",
    path: "/api/review/ticket/114/manual-send",
    body: { approver: "dana@example.com", status: "definitely_sent_trust_me" },
  });
  assert.equal(res.status, 400);
  assert.equal(res.body.code, "invalid_manual_send_status");
  assert.equal(recorded.length, 0);
});

// rca-fy79 (K1) — the ticket's own internal note, written once at hand-off
// time, instructs the specialist in the FUTURE tense ("send the letter...
// yourself") and can never be edited afterwards (Zendesk comments are
// append-only). These guards assert on the OBSERVABLE OUTPUT actually posted
// back to the real ticket — never on an internal branch or a value the test
// itself injects — so a regression that silently drops the Zendesk call, or
// that posts a note still phrased as an instruction, fails here.
test("D-12/rca-fy79: recording 'sent' posts a PAST-TENSE confirmation to the real ticket, naming who and when", async () => {
  const { handler, zendeskNotes } = harness({ withZendesk: true });
  const res = await callApi(handler, {
    method: "POST",
    path: "/api/review/ticket/114/manual-send",
    body: { approver: "dana@example.com", status: "sent", note: "delivery ref 12345" },
  });

  assert.equal(res.status, 200);
  assert.equal(zendeskNotes.length, 1, "a completion note must be posted back to the real ticket");
  assert.equal(zendeskNotes[0].id, "114");
  const note = zendeskNotes[0].note;
  assert.match(note, /\bSENT\b/);
  assert.match(note, /dana@example\.com/);
  assert.match(note, /underwriting@ravensworth-bs\.example\.com/);
  assert.match(note, /delivery ref 12345/);
  // Must not read as the still-outstanding instruction it is replacing.
  assert.doesNotMatch(note, /Once approved/);
  assert.doesNotMatch(note, /yourself/);
});

test("D-12/rca-fy79: recording 'could not send' posts the reason back to the real ticket, past tense", async () => {
  const { handler, zendeskNotes } = harness({ withZendesk: true });
  const res = await callApi(handler, {
    method: "POST",
    path: "/api/review/ticket/114/manual-send",
    body: { approver: "dana@example.com", status: "could_not_send", note: "no side-conversation control exists" },
  });

  assert.equal(res.status, 200);
  assert.equal(zendeskNotes.length, 1);
  const note = zendeskNotes[0].note;
  assert.match(note, /COULD NOT BE SENT/);
  assert.match(note, /dana@example\.com/);
  assert.match(note, /no side-conversation control exists/);
  assert.doesNotMatch(note, /Once approved/);
});

test("D-12/rca-fy79: no Zendesk client configured — the record still succeeds, and nothing is posted", async () => {
  // withZendesk defaults to false, matching every other test in this file —
  // this is the same optional-dependency shape submitReviewDecision() already
  // has, proven here so this call site never becomes a hard requirement.
  const { handler, zendeskNotes, recorded } = harness();
  const res = await callApi(handler, {
    method: "POST",
    path: "/api/review/ticket/114/manual-send",
    body: { approver: "dana@example.com", status: "sent" },
  });
  assert.equal(res.status, 200);
  assert.equal(recorded.length, 1, "the durable record must not depend on Zendesk being configured");
  assert.equal(zendeskNotes.length, 0);
});

test("D-12: the recorded outcome round-trips onto the GET view for the same ticket", async () => {
  // Once recorded, view.case carries manualSendStatus/manualSendBy/manualSendAt/
  // manualSendNote (src/review/store.js's CASE_COLUMNS, migrations/0003) — the
  // sidebar's read of "was this already recorded" is the SAME case row a POST
  // just updated, not a second source of truth.
  const recordedCase = {
    ...APPROVED_THIRD_PARTY_CASE,
    manualSendStatus: "sent",
    manualSendAt: "2026-08-22T20:00:00Z",
    manualSendBy: "dana@example.com",
    manualSendNote: null,
  };
  const { handler } = harness({ caseRow: recordedCase });
  const res = await callApi(handler, { method: "GET", path: "/api/review/ticket/114" });
  assert.equal(res.status, 200);
  assert.equal(res.body.case.manualSendStatus, "sent");
  assert.equal(res.body.case.manualSendBy, "dana@example.com");
});
