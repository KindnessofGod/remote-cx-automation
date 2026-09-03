// ---------------------------------------------------------------------------
// portalUc05EmployeeSeesNoFigures.test.js — invariant 14, in both directions
// ---------------------------------------------------------------------------
// qa/contracts/UC-05-acceptance.md §8 invariant 14, written to be testable:
//   "no notice figure, payout figure or comparison reaches an employee-facing
//    surface while the report is pending_signoff."
// And §11's escalation row: no figures, and NO STATEMENT OF WHAT THE PROBLEM IS.
//
// Found failing on the live deployment 2026-09-02 by an agent driving /portal
// as the resigning employee: the result page printed "60 days (statutory) …
// last working day 2026-10-19", "2,704.00 EUR", "Código do Trabalho art.
// 400.º(1)" the moment the form was submitted, while the dialog in front of it
// said "Not yet", "My requests" said "issuing it now would hand over figures
// nobody has checked", and the report route refused 409 with that sentence.
//
// BOTH DIRECTIONS, because the obvious fix — delete the rows — would strand HR
// Ops: the figures must still reach the internal note the specialist opens.
// ---------------------------------------------------------------------------

import { test } from "node:test";
import assert from "node:assert/strict";

import { createPortalHandler } from "../src/portal/server.js";
import { createInProcessFetch } from "../src/remote/mockServer.js";
import { RemoteClient } from "../src/remote/restClient.js";
import { AuditLogger } from "../src/shared/audit.js";
import { buildPortalStores } from "../src/portal/wiring.js";
import { extractFromLetter } from "../src/uc05/letterExtractor.js";
import { fakeZendesk, lastNoteRows, lastPublicReply } from "./portalNoteHelpers.js";

const unconfigured = { isConfigured: () => false };

function portal() {
  const stores = buildPortalStores();
  const zendesk = fakeZendesk();
  const remote = new RemoteClient({ baseUrl: "http://mock.remote.invalid", fetchImpl: createInProcessFetch() });
  const handler = createPortalHandler({
    remote,
    audit: new AuditLogger(),
    stores,
    zendesk,
    llm: { extract: (args) => extractFromLetter(args, unconfigured) },
  });
  return { handler, stores, zendesk };
}

function call(handler, { method = "POST", path, body = null }) {
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
      setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
      writeHead(code, headers) { this.statusCode = code; Object.assign(this.headers, headers ?? {}); },
      end(payload) {
        try { resolve({ status: this.statusCode, body: payload ? JSON.parse(payload) : null }); } catch (e) { reject(e); }
      },
    };
    handler(req, res);
  });
}

// EVERY SHAPE A FIGURE CAN TAKE ON THIS SURFACE. Guarded by CLASS, not by the
// one spelling that leaked: an ISO date, a day count, money with a currency, a
// statute citation, a month count.
const FIGURE = [
  [/\b\d{4}-\d{2}-\d{2}\b/, "an ISO date"],
  [/\b\d+ days?\b/, "a day count"],
  [/\d[\d,]*\.\d{2} [A-Z]{3}\b/, "a money amount"],
  [/\bart\. ?\d|\bs\. ?86\b|\b7:672\b|§ ?622/, "a statute citation"],
  [/\b\d+ months?\b/, "a month count"],
];
// §11: the escalation row also withholds WHAT THE PROBLEM IS.
const PROBLEM = [/earlier/i, /shortfall|short of|days short/i, /not one of the countries|unsupported/i, /already ended|no longer active/i, /could not be worked out/i, /statutory minimum/i];

function employeeText(body) {
  const rows = (body.details ?? []).map((d) => `${d.label}: ${d.value}`);
  return [...rows, body.decidedBy?.means ?? "", body.plainAnswer?.lead ?? "", body.plainAnswer?.next ?? ""].join("\n");
}

const SCENARIOS = [
  { name: "PT clean → pending_signoff", body: { persona: "joao", proposedEndDate: "2026-11-30", ptoDaysAccrued: "18", ptoDaysUsed: "5", ptoHourlyRate: "26.00" }, expectDecision: "prepared_for_signoff" },
  { name: "PT earlier than statutory → escalate", body: { persona: "joao", proposedEndDate: "2026-08-31", ptoDaysAccrued: "10", ptoDaysUsed: "2", ptoHourlyRate: "24.00" }, expectDecision: "escalate" },
  { name: "PT balance with no rate → escalate", body: { persona: "joao", proposedEndDate: "2026-11-30", ptoDaysAccrued: "10", ptoDaysUsed: "0" }, expectDecision: "escalate" },
  { name: "BR not in the table → escalate", body: { persona: "carlos", proposedEndDate: "2026-10-15" }, expectDecision: "escalate" },
  { name: "terminated employee → escalate", body: { persona: "thomas", proposedEndDate: "2026-09-15" }, expectDecision: "escalate" },
];

for (const sc of SCENARIOS) {
  test(`[N-14] ${sc.name}: the employee's page carries no figure`, async () => {
    const { handler } = portal();
    const res = await call(handler, { path: "/api/requests/uc05", body: sc.body });
    assert.equal(res.status, 200, JSON.stringify(res.body).slice(0, 200));
    assert.equal(res.body.decision, sc.expectDecision);

    const text = employeeText(res.body);
    for (const [re, what] of FIGURE) assert.doesNotMatch(text, re, `${what} reached the employee before sign-off:\n${text}`);
    for (const label of ["Statutory notice", "Rule applied", "Tenure at notice", "Proposed vs. statutory", "PTO payout", "Decided by", "Date came from"]) {
      assert.equal((res.body.details ?? []).find((d) => d.label === label), undefined, `"${label}" is on the employee's page`);
    }
    assert.match(text, /^What happens next: Received\./m, "the employee is acknowledged, not left with nothing");
    if (sc.expectDecision === "escalate") {
      for (const re of PROBLEM) assert.doesNotMatch(text, re, `the problem was stated to the employee mid-review:\n${text}`);
    }
  });
}

test("[N-14] …and HR Ops still gets every figure, in the INTERNAL note", async () => {
  const { handler, zendesk } = portal();
  const res = await call(handler, { path: "/api/requests/uc05", body: SCENARIOS[0].body });
  assert.equal(res.status, 200);
  assert.equal(res.body.ticketCreated, true, "a ticket must be raised for the note to exist");

  const ticket = zendesk.created[zendesk.created.length - 1];
  assert.equal(ticket.comment.public, false, "the note carrying figures must never be a public reply");
  const rows = lastNoteRows(zendesk);
  for (const label of ["Statutory notice", "Rule applied", "Tenure at notice", "Proposed vs. statutory", "PTO payout", "Decided by"]) {
    assert.ok(label in rows, `HR Ops lost the "${label}" row — the fix stranded the specialist`);
  }
  assert.match(rows["Statutory notice"], /\b\d{4}-\d{2}-\d{2}\b/, "the specialist sees the end date");
  assert.match(rows["PTO payout"], /\d[\d,]*\.\d{2} [A-Z]{3}\b/, "the specialist sees the payout with its currency");
  // The note's lead is the REAL deciding sentence, not the acknowledgement.
  assert.match(ticket.comment.html_body, /<h3>What happened<\/h3><p>Every check passed/);
  // The note also records what the employee was told, so a specialist can see it.
  assert.match(rows["What happens next"], /^Received\. HR Ops is checking/);
});

test("[N-14] the escalated note carries the real reason; the employee's page and the public reply do not", async () => {
  const { handler, zendesk } = portal();
  const res = await call(handler, { path: "/api/requests/uc05", body: SCENARIOS[1].body });
  assert.equal(res.body.reason, "statutory_discrepancy");
  const html = zendesk.created[zendesk.created.length - 1].comment.html_body;
  assert.match(html, /EARLIER than the statutory minimum/, "HR Ops must be told what the problem is");
  const pub = lastPublicReply(zendesk);
  assert.ok(pub, "the requester's public reply is still posted");
  for (const [re, what] of FIGURE) assert.doesNotMatch(pub, re, `${what} in the public reply`);
  for (const re of PROBLEM) assert.doesNotMatch(pub, re, "the problem stated in the public reply");
});

test("[N-14] the report route still refuses until sign-off, with the same sentence", async () => {
  const { handler } = portal();
  const res = await call(handler, { path: "/api/requests/uc05", body: SCENARIOS[0].body });
  const rep = await call(handler, { path: "/api/requests/uc05/report", body: { persona: "joao", resignationId: res.body.recordId } });
  assert.equal(rep.status, 409);
  assert.equal(rep.body.code, "report_not_signed_off");
});
