// ---------------------------------------------------------------------------
// portalUc05Report.test.js  —  the one thing UC-05 exists to produce
// ---------------------------------------------------------------------------
// WHAT IS UNDER TEST
//
// UC-05 makes no Remote write. `UC-05.md` §3, `src/uc05/workflow.js`,
// `resignationStore.js` and `signoffPolicy.js` all say the same sentence in
// their own headers: no Remote termination endpoint is confirmed to exist, so
// **the signed-off report IS the durable artifact**. The portal card promises
// it in as many words — *"HR Ops checks the figures and signs them off, and
// that signed-off summary is the record."*
//
// It did not exist. A resigning employee reported that a UC-05 record which had
// reached `signed_off` showed `DOCUMENT: —` in "My requests", and that
// `POST /portal/api/requests/uc05/{report,letter,record}` all answered
// **404 `no_such_route`** — while UC-01 had two letter routes and UC-04 had a
// record route. The one use case whose entire output is a document produced
// none: a decision correct, durable, audited, and reaching nobody, which is
// this repository's most expensive recurring shape (CLAUDE.md §7).
//
// This file pins the fix the way test/portalUc01LetterAccess.test.js and
// test/portalLetterAccess.test.js pin theirs: the row and the fetch route agree
// on ONE verdict, only the employee it is about may ever collect it, it cannot
// be issued before sign-off, and the document states the facts it exists to
// state rather than merely existing.
//
// HERMETIC: mock Remote dispatched in-process, no port bound.
// ---------------------------------------------------------------------------

import { test } from "node:test";
import assert from "node:assert/strict";

import { createPortalHandler } from "../src/portal/server.js";
import { createInProcessFetch } from "../src/remote/mockServer.js";
import { RemoteClient } from "../src/remote/restClient.js";
import { AuditLogger } from "../src/shared/audit.js";
import { buildPortalStores } from "../src/portal/wiring.js";
import { extractFromLetter } from "../src/uc05/letterExtractor.js";
import { submitResignationApproval } from "../src/uc05/workflow.js";
import { evaluateResignationReportDelivery } from "../src/uc05/reportDelivery.js";
import { describeResignationReportForRequester, LETTER_STATES } from "../src/portal/letterAccess.js";
import { renderResignationReportHtml, NOTICE_REPORT_TYPE } from "../src/uc05/noticeReport.js";
import { PERSONAS } from "../src/portal/personas.js";

const unconfigured = { isConfigured: () => false };

function world() {
  const stores = buildPortalStores();
  const remote = new RemoteClient({ baseUrl: "http://mock.remote.invalid", fetchImpl: createInProcessFetch() });
  const audit = new AuditLogger();
  const handler = createPortalHandler({
    remote,
    audit,
    stores,
    llm: { extract: (args) => extractFromLetter(args, unconfigured) },
  });
  return { handler, stores, remote, audit };
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
      setHeader(k, v) {
        this.headers[k.toLowerCase()] = v;
      },
      end(payload) {
        resolve({ status: this.statusCode, body: payload ? JSON.parse(String(payload)) : null });
      },
    };
    handler(req, res).catch(reject);
  });
}

/** The Portuguese scenario the demo uses: 60 days' notice, 2,704.00 EUR settlement. */
const RESIGNATION = {
  persona: "joao",
  proposedEndDate: "2026-11-30",
  now: "2026-08-20",
  reason: "new opportunity",
  ptoType: "vacation",
  ptoDaysAccrued: "18",
  ptoDaysUsed: "5",
  ptoHourlyRate: "26.00",
  currency: "EUR",
};

async function fileResignation(w, externalRef) {
  const res = await call(w.handler, { path: "/api/requests/uc05", body: { ...RESIGNATION, externalRef } });
  assert.equal(res.status, 200);
  assert.equal(res.body.decision, "prepared_for_signoff", `reason: ${res.body.reason}`);
  return res.body.recordId;
}

const collect = (w, persona, resignationId) =>
  call(w.handler, { path: "/api/requests/uc05/report", body: { persona, resignationId } });

const signOff = (w, resignationId, note = "Figures check out.") =>
  submitResignationApproval(
    { resignationId, action: "signoff", approver: "hr.ops@example.com", note },
    { remote: w.remote, audit: w.audit, resignationStore: w.stores.uc05 }
  );

// ---------------------------------------------------------------------------
// 1. THE ROUTE EXISTS AT ALL — the reported defect, in one assertion
// ---------------------------------------------------------------------------

test("POST /api/requests/uc05/report is a route, not a 404", async () => {
  const w = world();
  const id = await fileResignation(w, "report-route-1");
  const res = await collect(w, "joao", id);

  // BEFORE: {"ok":false,"code":"no_such_route","path":"/api/requests/uc05/report"} — 404.
  // Asserted against the ROUTER's own miss code rather than against a status,
  // because a refusal from the gate is also a non-200 and the two are opposite
  // outcomes: one means "this system has no such thing", the other means "not
  // yet, and here is who has it".
  assert.notEqual(res.body.code, "no_such_route", "UC-05 still has no route that hands over its own artifact");
  assert.notEqual(res.status, 404);
});

// ---------------------------------------------------------------------------
// 2. IT CANNOT BE ISSUED BEFORE SIGN-OFF, and it says so where it is withheld
// ---------------------------------------------------------------------------
// Everything on this document is a CALCULATION until HR Ops confirms it — a
// statutory notice period, a last working day, a settlement figure. Handing it
// over as "the record" beforehand would be figures nobody has checked, on the
// document an employee reads to find out when they stop working and what they
// are owed. Same ordering rule as UC-04's record on stage 2.

test("a prepared report is withheld until HR Ops signs it off, and names who is holding it", async () => {
  const w = world();
  const id = await fileResignation(w, "report-gate-1");

  const before = await collect(w, "joao", id);
  assert.equal(before.status, 409);
  assert.equal(before.body.code, "report_not_signed_off");
  assert.equal(before.body.ok, false);
  assert.ok(!("content" in before.body), "a withheld report must not carry its own bytes");
  assert.match(before.body.reason, /HR Ops has not signed this report off/);
  assert.match(before.body.reason, /calculation rather than a record/);

  await signOff(w, id);

  const after = await collect(w, "joao", id);
  assert.equal(after.status, 200);
  assert.equal(after.body.code, "report_available");
  assert.equal(after.body.type, NOTICE_REPORT_TYPE);
  assert.ok(after.body.content.length > 0);
});

test("an escalated resignation says no report is coming — not that one is on its way", async () => {
  const w = world();
  // A leaving date inside Portugal's 60-day minimum: escalates, never enters
  // the sign-off path at all.
  const res = await call(w.handler, {
    path: "/api/requests/uc05",
    body: { ...RESIGNATION, proposedEndDate: "2026-08-31", now: "2026-07-25", externalRef: "report-gate-2" },
  });
  assert.equal(res.body.decision, "escalate");

  const out = await collect(w, "joao", res.body.recordId);
  assert.equal(out.status, 409);
  // NOT `report_not_signed_off`, which would tell somebody to keep checking
  // back for a document that is not coming. ./signoffPolicy.js refuses the
  // sign-off action on this row outright.
  assert.equal(out.body.code, "report_never_prepared");
  assert.match(out.body.reason, /none is coming/);
});

test("a declined report is refused under its own name, never as 'not yet'", async () => {
  const w = world();
  const id = await fileResignation(w, "report-gate-3");
  await submitResignationApproval(
    { resignationId: id, action: "decline", approver: "hr.ops@example.com", note: "Balance disputed." },
    { remote: w.remote, audit: w.audit, resignationStore: w.stores.uc05 }
  );

  const out = await collect(w, "joao", id);
  assert.equal(out.status, 409);
  assert.equal(out.body.code, "report_declined");
  assert.doesNotMatch(out.body.reason, /not signed this report off yet|has not signed/);
});

// ---------------------------------------------------------------------------
// 3. ONLY THE EMPLOYEE IT IS ABOUT — and it fails closed
// ---------------------------------------------------------------------------

test("the report goes to its subject and to nobody else", async () => {
  const w = world();
  const id = await fileResignation(w, "report-owner-1");
  await signOff(w, id);

  const stranger = await collect(w, "emma", id);
  assert.equal(stranger.status, 403);
  assert.equal(stranger.body.code, "not_the_employee");
  assert.ok(!("content" in stranger.body));

  // FAILS CLOSED WITH NO SESSION, and the gate is asked directly so the refusal
  // is pinned at the policy rather than at whatever the portal happens to do
  // with an unknown persona key.
  const noSession = evaluateResignationReportDelivery({
    resignationRow: await w.stores.uc05.findById(id),
    session: null,
  });
  assert.equal(noSession.allowed, false);
  assert.equal(noSession.code, "session_required");

  // ORDER MATTERS: a stranger must be refused BEFORE learning whether a person
  // has resigned. Asked about a resignation that does not exist, the gate
  // answers about the RECORD; asked about one that does, with the wrong
  // session, it answers about the READER — and never leaks the state of the
  // report to either.
  const missing = evaluateResignationReportDelivery({ resignationRow: null, session: null });
  assert.equal(missing.code, "resignation_not_found");
  assert.doesNotMatch(stranger.body.reason, /signed off|escalated|pending/i);
});

// ---------------------------------------------------------------------------
// 4. THE ROW AND THE ROUTE AGREE — one verdict, two surfaces
// ---------------------------------------------------------------------------
// The badge on "My requests" is computed from the SAME gate the collect route
// calls, so the page structurally cannot offer a control that route refuses.

test("the 'My requests' document cell is computed from the collect route's own gate", async () => {
  const w = world();
  const id = await fileResignation(w, "report-row-1");

  const listBefore = await call(w.handler, { method: "GET", path: "/api/my-requests?persona=joao" });
  const rowBefore = listBefore.body.requests.find((r) => r.recordId === id);
  assert.ok(rowBefore, "the resignation is not on the requester's own history at all");
  // BEFORE THIS BUILD: `document` was null on every UC-05 row, always, so the
  // cell rendered the em dash six use cases with no artifact also render.
  assert.ok(rowBefore.document, "UC-05 rows still carry no document description");
  assert.equal(rowBefore.document.state, LETTER_STATES.DRAFTED);
  assert.equal(rowBefore.document.label, "With HR Ops");
  assert.equal(rowBefore.document.collect, null, "a control here would promise a document the gate withholds");

  await signOff(w, id);

  const listAfter = await call(w.handler, { method: "GET", path: "/api/my-requests?persona=joao" });
  const rowAfter = listAfter.body.requests.find((r) => r.recordId === id);
  assert.equal(rowAfter.document.state, LETTER_STATES.ISSUED);
  assert.equal(rowAfter.document.label, "Ready");

  // THE BROWSER'S COLLECTOR IS GENERIC AND THE SERVER NAMES ITS OWN TERMS —
  // src/portal/assets/app.js hard-codes "letter" and `caseId` as DEFAULTS, both
  // wrong here. Getting `idField` wrong makes the route answer
  // `resignation_id_required` to a button the same server just offered.
  assert.equal(rowAfter.document.collect.idField, "resignationId");
  assert.equal(rowAfter.document.collect.noun, "notice and settlement report");
  // RELATIVE, WITH NO LEADING SLASH. A leading slash resolves against the
  // domain root and misses the `/portal` mount entirely — the production outage
  // recorded on the UC-03 branch of src/portal/letterAccess.js.
  assert.equal(rowAfter.document.collect.path, "api/requests/uc05/report");
  assert.ok(!rowAfter.document.collect.path.startsWith("/"));

  // And the offered control really is honoured by the route it names.
  const fetched = await call(w.handler, {
    method: rowAfter.document.collect.method,
    path: `/${rowAfter.document.collect.path}`,
    body: { persona: "joao", [rowAfter.document.collect.idField]: id },
  });
  assert.equal(fetched.status, 200);
  assert.equal(fetched.body.filename, `resignation-notice-report-${id}.html`);
});

test("the describer never offers a control the gate would refuse", async () => {
  const w = world();
  const id = await fileResignation(w, "report-row-2");
  const row = await w.stores.uc05.findById(id);
  const session = PERSONAS.joao.session;

  for (const [label, verdictArgs] of [
    ["before sign-off", { resignationRow: row, session }],
    ["wrong reader", { resignationRow: row, session: PERSONAS.emma.session }],
    ["no session", { resignationRow: row, session: null }],
    ["no row", { resignationRow: null, session }],
  ]) {
    const verdict = evaluateResignationReportDelivery(verdictArgs);
    const described = describeResignationReportForRequester(verdictArgs);
    assert.equal(
      described.collect === null,
      !verdict.allowed,
      `${label}: the row offered a control the gate answers ${verdict.code} to`
    );
  }
});

// ---------------------------------------------------------------------------
// 5. WHAT THE DOCUMENT ACTUALLY SAYS
// ---------------------------------------------------------------------------
// A document that exists and states nothing is the same dead end one step
// further along. Each of these is a fact the report was commissioned to carry.

test("the report states the notice period, its statute, the anchor, the last working day, the tenure and the settlement", async () => {
  const w = world();
  const id = await fileResignation(w, "report-content-1");
  await signOff(w, id);
  const res = await collect(w, "joao", id);
  const html = res.body.content;

  // The notice period AS THE STATUTE DENOMINATES IT, and the statute itself.
  assert.match(html, /60 days/);
  assert.match(html, /Código do Trabalho art\. 400/);
  // The anchor, without which the last working day is unreproducible.
  assert.match(html, /Counted from/);
  assert.match(html, /2026-08-20/);
  assert.match(html, /2026-10-19/);
  // The tenure every bracket in the table is selected by.
  assert.match(html, /86 months/);
  // The settlement WITH ITS WORKING — not the total alone.
  for (const shown of ["18 days accrued", "5 taken", "13 days", "8 hours per day", "26.00 EUR per hour", "2,704.00 EUR"]) {
    assert.ok(html.includes(shown), `the report does not show "${shown}"`);
  }
  // Who turned the calculation into a record.
  assert.match(html, /hr\.ops@example\.com/);
  assert.match(html, /Figures check out\./);

  // AND THE NEGATIVE, in plain words rather than left to be inferred from an
  // absent row. This is the one thing the document must never let a reader get
  // wrong: nothing here ended an employment and nothing reached Remote.
  assert.match(html, /Nothing on this report was sent to Remote/);
  assert.match(html, /does not end your employment/);
  assert.equal(res.body.sentToRemote, false);

  // NO COMPENSATION FIELD IS READ. UC-01's over-scope precedent, for UC-01's
  // reason — a consulate's means-of-subsistence question is not asked here. The
  // HOURLY RATE is present, and only inside the settlement working, because it
  // is an input to a figure this document states and was supplied on the
  // request. Driven from the record's own numbers rather than hard-coded ones.
  const employment = await w.remote.getEmployment(PERSONAS.joao.employmentId);
  for (const field of [
    employment?.contract_details?.annual_gross_salary,
    employment?.base_salary,
    employment?.payment_terms?.compensation_gross_amount,
  ]) {
    if (field === undefined || field === null) continue;
    assert.ok(!html.includes(String(field)), `the report discloses a compensation value: ${field}`);
  }
});

test("the report never prints 'null' or an undeclared figure, on a month-denominated rule or an absent balance", async () => {
  const w = world();
  // Lars: NL, month-denominated (BW art. 7:672(4) "één maand", so noticeDays is
  // null by design) AND no holiday figures supplied at all. Both of the panel's
  // own defects in one document.
  const res = await call(w.handler, {
    path: "/api/requests/uc05",
    body: {
      persona: "lars",
      proposedEndDate: "2026-10-31",
      now: "2026-08-10",
      reason: "relocation",
      currency: "EUR",
      externalRef: "report-content-2",
    },
  });
  const id = res.body.recordId;
  await signOff(w, id);
  const out = await collect(w, "lars", id);
  const html = out.body.content;

  assert.match(html, /1 month/, "the statute's own quantity must be what the report prints");
  assert.doesNotMatch(html, /\bnull\b/, "the word null reached a document an employee keeps");
  assert.doesNotMatch(html, /null days/);
  // NO ZERO SETTLEMENT. An absent balance is an absence of a figure, not a
  // figure of nothing — finding F-28's rule, restated on a document somebody
  // signs.
  assert.doesNotMatch(html, /0\.00/, "a settlement of nothing was stated for a balance nobody counted");
  assert.match(html, /no settlement figure is stated/);
  assert.match(html, /Nothing here says no holiday is owed/);
});

// ---------------------------------------------------------------------------
// 6. THE HANDOVER IS AUDITED
// ---------------------------------------------------------------------------
// There is no `documents` row for a UC-05 report — it is rendered on demand —
// so the audit row carrying the sha256 is the only durable statement of what
// bytes were handed to the employee. Same shape as UC-04's record route.

test("collecting the report writes an audit row naming the bytes that were handed over", async () => {
  const w = world();
  const id = await fileResignation(w, "report-audit-1");
  await signOff(w, id);
  const res = await collect(w, "joao", id);

  const issued = w.audit.entries.filter((e) => e.action === "resignation_report_issued");
  assert.equal(issued.length, 1, "the handover left no durable trace");
  const row = issued[0];
  assert.equal(row.useCase, "UC-05");
  assert.equal(row.details.resignationId, id);
  assert.equal(row.details.externalRef, "report-audit-1");
  assert.equal(row.details.documentType, NOTICE_REPORT_TYPE);
  assert.equal(row.details.sentToRemote, false);
  assert.equal(row.details.contentBytes, Buffer.byteLength(res.body.content));
  assert.match(row.details.contentHash, /^[0-9a-f]{64}$/);

  // A REFUSED collection writes no such row — the trail must not record a
  // delivery that never happened.
  await collect(w, "emma", id);
  assert.equal(w.audit.entries.filter((e) => e.action === "resignation_report_issued").length, 1);
});

// ---------------------------------------------------------------------------
// 7. THE RENDERER DEGRADES RATHER THAN INVENTING
// ---------------------------------------------------------------------------

test("an unreadable employment leaves em dashes, not guesses, and the decisions still print", () => {
  const html = renderResignationReportHtml({
    employment: null,
    resignationRow: {
      id: "abc",
      employmentId: "e1",
      decision: "prepared_for_signoff",
      status: "signed_off",
      signedOffBy: { approver: "hr.ops@example.com", at: "2026-09-01T10:00:00Z", note: null },
      notice: {
        countryCode: "PT",
        basis: "statutory",
        sourceCitation: "Código do Trabalho art. 400.º(1)",
        tenureMonths: 86,
        noticeQuantity: "60 days",
        noticeDays: 60,
        noticeStartDate: "2026-08-20",
        noticeEndDate: "2026-10-19",
        proposedEndDate: null,
        discrepancyDays: null,
        noticeRuleFound: true,
        statutoryMinimumExists: true,
      },
      payout: null,
    },
    today: "2026-09-01",
  });

  assert.match(html, /—/, "an unknown must render as the em dash, never as a blank or a guess");
  assert.match(html, /60 days/);
  assert.match(html, /2026-10-19/);
  assert.match(html, /hr\.ops@example\.com/);
  assert.match(html, /No holiday settlement was reconciled/);
  assert.match(html, /Nothing on this report was sent to Remote/);
});
