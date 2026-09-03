// ---------------------------------------------------------------------------
// portalUc05Copy.test.js  —  the words a resigning employee is shown
// ---------------------------------------------------------------------------
// WHY THIS FILE EXISTS
//
// Eight statements on UC-05's result panel were observed live, by a person
// resigning, and every one of them was false or unreadable. Every one of them
// was also produced by code that returned HTTP 200 with a correct decision and
// a correct stored row — which is this repository's whole history in one place:
// *"Read the words the user sees, not just the HTTP status."*
//
// Each test below drives the REAL portal handler through the REAL UC-05
// workflow and reads the string off the response. None of them asserts on a
// status code, a stored field or a decision — those were all right the whole
// time. They assert on the sentence.
//
// THE OLD STRING IS QUOTED IN FULL beside each, because a guard that only says
// what the copy must contain cannot tell a reader what it was protecting
// against, and this file's assertions are otherwise indistinguishable from
// arbitrary wording preferences.
//
// HERMETIC: mock Remote dispatched in-process, no port bound, the one LLM seam
// injected with the real extractor forced down its unconfigured branch.
// ---------------------------------------------------------------------------

import { test } from "node:test";
import assert from "node:assert/strict";

import { createPortalHandler } from "../src/portal/server.js";
import { createInProcessFetch } from "../src/remote/mockServer.js";
import { RemoteClient } from "../src/remote/restClient.js";
import { AuditLogger } from "../src/shared/audit.js";
import { buildPortalStores } from "../src/portal/wiring.js";
import { extractFromLetter } from "../src/uc05/letterExtractor.js";
import { reasonLabel } from "../src/portal/requestStatus.js";
import { fakeZendesk, lastNoteRows } from "./portalNoteHelpers.js";
// [N-14] SINCE 2026-09-02 THE FIGURES ARE THE SPECIALIST'S, NOT THE EMPLOYEE'S.
// The statutory notice, the rule, the tenure, the comparison and the payout are
// `specialistDetail` rows: stripped from the requester's response, printed in
// the internal note HR Ops opens. The wording assertions below are about those
// lines and now read them where their reader does — off the note, recorded by a
// fake Zendesk (test/portalNoteHelpers.js). The employee's page is asserted
// figure-free in test/portalUc05EmployeeSeesNoFigures.test.js.

const unconfigured = { isConfigured: () => false };

function portal() {
  const stores = buildPortalStores();
  const remote = new RemoteClient({ baseUrl: "http://mock.remote.invalid", fetchImpl: createInProcessFetch() });
  const zendesk = fakeZendesk();
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

/** File one resignation and hand back the panel's own detail rows. */
async function file(body) {
  const { handler, zendesk } = portal();
  const res = await call(handler, { path: "/api/requests/uc05", body });
  assert.equal(res.status, 200, `the request itself must succeed: ${JSON.stringify(res.body)}`);
  return {
    res,
    detail: (label) => {
      const rows = lastNoteRows(zendesk);
      assert.ok(label in rows, `no "${label}" row reached the specialist's note; rows: ${Object.keys(rows).join(", ")}`);
      return String(rows[label]);
    },
  };
}

// ---------------------------------------------------------------------------
// 1. "null days (statutory) → last working day 2026-10-31"
// ---------------------------------------------------------------------------
// The Netherlands' rule is MONTH-denominated: BW art. 7:672(4) says "één
// maand", so `noticeDays` is deliberately null on that row — the calculator's
// own typedef says it is null "precisely so that nothing can print a day figure
// the statute never stated". The panel interpolated it anyway.
//
// The field that exists for prose is `noticeQuantity`, and it was populated the
// whole time.

test("a month-denominated notice period never renders the word null to an employee", async () => {
  const { detail } = await file({
    persona: "lars",
    proposedEndDate: "2026-10-31",
    now: "2026-08-10",
    reason: "relocation",
    currency: "EUR",
    externalRef: "copy-nl-1",
  });

  const line = detail("Statutory notice");
  // BEFORE: "null days (statutory) → last working day 2026-09-30"
  assert.doesNotMatch(line, /\bnull\b/, `the word "null" reached a resigning employee: ${line}`);
  // Asserted as "no day count at all" rather than as "not the string null",
  // because "0 days" and "undefined days" are the same defect wearing different
  // spellings and a guard naming one lets the others through.
  assert.doesNotMatch(line, /\d+ days/, `a day count was printed for a rule denominated in months: ${line}`);
  assert.match(line, /^1 month \(statutory\)/, `the statute's own quantity must be what is printed: ${line}`);
});

// ---------------------------------------------------------------------------
// 2. "0.00 EUR — no leave balances are recorded for this employee"
// ---------------------------------------------------------------------------
// Shown when the employee left the holiday boxes blank. The form's own help
// text promises the opposite: "Leave 'days accrued' blank and no balance is
// sent at all — the result then says the balance is unknown, rather than
// showing a zero nobody worked out."
//
// Two separate falsehoods in one line. The 0.00 is a settlement figure nobody
// derived. And "no leave balances are recorded for this employee" is a claim
// about the EMPLOYMENT RECORD — made here off an empty leave-policy list, which
// says an employment has no leave POLICY on file, not that an employee has a
// zero BALANCE.

test("a blank holiday box produces no figure at all, and never a zero", async () => {
  const { detail } = await file({
    persona: "lars",
    proposedEndDate: "2026-10-31",
    now: "2026-08-10",
    reason: "relocation",
    ptoDaysAccrued: "",
    ptoDaysUsed: "",
    ptoHourlyRate: "",
    currency: "EUR",
    externalRef: "copy-nl-2",
  });

  const line = detail("PTO payout");
  // BEFORE: "0.00 EUR — no leave balances are recorded for this employee"
  //
  // NO DIGITS ANYWHERE, rather than "not the string 0.00". A guard naming one
  // spelling of a wrong figure is the mistake CLAUDE.md §7 item 22 records
  // paying for: the first draft of the metrics-tile test rejected `$0.0000` and
  // the bug printed `$0.00`.
  assert.ok(!/\d/.test(line), `a settlement figure was shown for a balance nobody counted: ${line}`);
  assert.ok(line.startsWith("not known"), `the balance must be reported as unknown: ${line}`);
  assert.match(line, /not a finding that no holiday is owed/, "the absence must not read as a nil entitlement");
});

// ---------------------------------------------------------------------------
// 3. "unusable_time_off_records: vacation — missing hourlyRateInRemoteInteger"
// ---------------------------------------------------------------------------
// A database column name and a reconciler source tag, rendered verbatim to a
// person who is resigning. It names no action, and the action it implies —
// go and fetch this field — is impossible: no Remote endpoint publishes an
// hourly or a daily rate (ptoPayout.js's header).

test("a refused settlement is explained in words, never in field names", async () => {
  const { res, detail } = await file({
    persona: "joao",
    proposedEndDate: "2026-11-30",
    now: "2026-08-20",
    reason: "new opportunity",
    ptoType: "vacation",
    ptoDaysAccrued: "18",
    ptoDaysUsed: "5",
    ptoHourlyRate: "",
    currency: "EUR",
    externalRef: "copy-rate-1",
  });

  // The DECISION is unchanged and correct — this is a rendering fix, and a
  // rendering fix that moved a gate would be a much bigger problem than the one
  // it set out to solve.
  assert.equal(res.body.decision, "escalate");
  assert.equal(res.body.reason, "pto_balance_unusable");

  const line = detail("PTO payout");
  // BEFORE: "not derivable — unusable_time_off_records: vacation — missing hourlyRateInRemoteInteger"
  assert.doesNotMatch(line, /hourlyRateInRemoteInteger/, `a database column name was shown to the requester: ${line}`);
  assert.doesNotMatch(line, /unusable_time_off_records/, `a source tag was shown to the requester: ${line}`);
  assert.match(line, /no hourly rate was given/, "the missing thing must be named in words");
  assert.match(
    line,
    /Remote does not publish a pay rate on any endpoint/,
    "and the sentence must name the action that closes it, since a further read of Remote cannot"
  );
  // The leave type is still named — WHICH balance is the actionable half, and
  // dropping it would be over-correcting into vagueness.
  assert.match(line, /vacation/);
});

// ---------------------------------------------------------------------------
// 4. The settlement with no working
// ---------------------------------------------------------------------------
// "2704.00 EUR" from (18 − 5) × 8h × 26.00 EUR. All four inputs were supplied
// by the employee on this very form and not one of them was on the screen.

test("the settlement shows every number it was worked out from", async () => {
  const { detail } = await file({
    persona: "joao",
    proposedEndDate: "2026-11-30",
    now: "2026-08-20",
    reason: "new opportunity",
    ptoType: "vacation",
    ptoDaysAccrued: "18",
    ptoDaysUsed: "5",
    ptoHourlyRate: "26.00",
    currency: "EUR",
    externalRef: "copy-working-1",
  });

  const line = detail("PTO payout");
  // BEFORE: "2704.00 EUR — from the leave balances on record"
  for (const shown of ["18 days accrued", "5 taken", "13 days", "8 hours per day", "26.00 EUR per hour"]) {
    assert.ok(line.includes(shown), `"${shown}" is missing from the settlement working: ${line}`);
  }
  assert.match(line, /= 2,704\.00 EUR/, "the derivation must end at the figure it produced");
  // THE TOTAL IS STILL THE FIRST THING ON THE LINE. Working is not a substitute
  // for the answer, and burying the amount behind its own arithmetic would be a
  // different way of failing the same reader.
  assert.ok(line.startsWith("2704.00 EUR"), `the amount must lead the line: ${line}`);
});

// ---------------------------------------------------------------------------
// 5. "from the leave balances on record"
// ---------------------------------------------------------------------------
// Attributed to Remote's records. The figures were typed into this form.

test("figures the employee typed are not attributed to records nobody read", async () => {
  const { detail } = await file({
    persona: "joao",
    proposedEndDate: "2026-11-30",
    now: "2026-08-20",
    reason: "new opportunity",
    ptoType: "vacation",
    ptoDaysAccrued: "18",
    ptoDaysUsed: "5",
    ptoHourlyRate: "26.00",
    currency: "EUR",
    externalRef: "copy-provenance-1",
  });

  const line = detail("PTO payout");
  // BEFORE: "2704.00 EUR — from the leave balances on record"
  assert.doesNotMatch(line, /leave balances on record/, `typed figures are still attributed to records: ${line}`);
  assert.match(
    line,
    /worked out from the holiday figures given on this request, not from Remote's records/,
    "the panel must say where the figures actually came from"
  );
});

// ---------------------------------------------------------------------------
// 6. The answer that silently expires
// ---------------------------------------------------------------------------
// Notice runs from the day the resignation is read, so the SAME proposed date
// is "later than required" one week and "earlier than allowed" the next.
// Nothing on the panel named the day it counted from, so a reader who saved the
// answer — or came back to it — had no way to know it had moved under them.
//
// THE TWO RUNS ARE THE ASSERTION. Checking that some date appears would pass on
// a constant; only driving the same request on two reading dates shows the line
// tracks the anchor.

test("every computed last working day names the date it was counted from", async () => {
  const shared = {
    persona: "joao",
    proposedEndDate: "2026-11-30",
    reason: "new opportunity",
    currency: "EUR",
  };

  const early = await file({ ...shared, now: "2026-08-20", externalRef: "copy-anchor-a" });
  const late = await file({ ...shared, now: "2026-09-20", externalRef: "copy-anchor-b" });

  const a = early.detail("Statutory notice");
  const b = late.detail("Statutory notice");

  // BEFORE: "60 days (statutory) → last working day 2026-10-19" — with no
  // statement anywhere of the 2026-08-20 it was counted from.
  assert.match(a, /counted from 2026-08-20/, `the anchor date is missing: ${a}`);
  assert.match(b, /counted from 2026-09-20/, `the anchor date is missing: ${b}`);

  // The last working day really does move with it, which is the whole reason
  // the anchor has to be printed. If these two ever came out equal the test
  // above would be pinning a decoration rather than a fact.
  assert.notEqual(a, b, "the same request read a month apart must not produce the same line");
  assert.match(a, /last working day 2026-10-19/);
  assert.match(b, /last working day 2026-11-19/);
});

// ---------------------------------------------------------------------------
// 7. Two different no-result branches that read as the same thing
// ---------------------------------------------------------------------------
// `noticeLine()` tested `noticeRuleFound` alone, so a country whose rule this
// system HOLDS — and whose content is the sourced finding that no statutory
// minimum binds a resigning employee — fell through to "this tenure falls
// outside every bracket in the country's rule".
//
// Those imply opposite next actions: extend our table's low end, versus open
// the contract. And the wrong one was printed directly above a citation reading
// "No statutory minimum notice runs against a resigning employee under the
// Canada Labour Code…" — the line contradicted the line beneath it.

test("no statutory minimum and no rule on file are told apart, and neither reads as a missing bracket", async () => {
  const canada = await file({
    persona: "alexandre",
    proposedEndDate: "2026-10-15",
    now: "2026-08-16",
    reason: "new opportunity",
    currency: "CAD",
    externalRef: "copy-branch-ca",
  });
  const brazil = await file({
    persona: "carlos",
    proposedEndDate: "2026-10-15",
    now: "2026-08-16",
    reason: "new opportunity",
    currency: "BRL",
    externalRef: "copy-branch-br",
  });

  const ca = canada.detail("Statutory notice");
  const br = brazil.detail("Statutory notice");

  // The two gates confirm which case each really is, so this test cannot pass
  // by both requests landing on the same branch for some unrelated reason.
  assert.equal(canada.res.body.reason, "no_statutory_notice_period");
  assert.equal(brazil.res.body.reason, "unsupported_country");

  // BEFORE (Canada): "not determined — this tenure falls outside every bracket in the country's rule"
  assert.doesNotMatch(ca, /outside every bracket/, `a sourced finding is still reported as a gap in our table: ${ca}`);
  assert.match(ca, /no statutory minimum applies/, `Canada's line must state the finding: ${ca}`);
  assert.match(
    ca,
    /NOT a finding that no notice is owed/,
    "and it must not be readable as 'you owe no notice' — the statute is silent, the contract may not be"
  );
  assert.match(ca, /contract/, "it must point at the contract, which is where the answer actually is");

  // Brazil is genuinely a gap in our own table and still says so.
  assert.match(br, /no statutory rule on file for this country/, `Brazil's line must state the gap: ${br}`);

  // AND THE TWO MUST NOT BE THE SAME SENTENCE, which is the defect itself.
  assert.notEqual(ca, br, "two opposite findings are still being reported identically");
});

// ---------------------------------------------------------------------------
// 8. "the contract and the statute disagree on the notice owed"
// ---------------------------------------------------------------------------
// NO CONTRACT IS READ ANYWHERE IN THIS SYSTEM, and it says so itself in three
// places. As written, this gloss alleged an unlawful contract term nobody had
// checked — to the employee, on their own escalation.

test("a statutory discrepancy is described as a short proposed date, not as an unlawful contract", () => {
  const label = reasonLabel("statutory_discrepancy");
  // BEFORE: "the contract and the statute disagree on the notice owed"
  assert.doesNotMatch(label, /contract/i, `the gloss still alleges something about a contract nobody read: ${label}`);
  assert.equal(label, "the leaving date proposed is earlier than the statutory notice period allows");
});

test("the escalation HR Ops sees is about the proposed date — and the employee's page no longer carries the comparison", async () => {
  // [N-14] This test used to be titled "the escalation the employee sees is
  // about their own proposed date". The comparison row is now the specialist's
  // (read off the note below); the employee's page says a specialist is
  // looking and states neither the figures nor the problem — §11's escalation
  // row, decided 2026-08-21, built 2026-09-02.
  const { res, detail } = await file({
    persona: "joao",
    proposedEndDate: "2026-08-31",
    now: "2026-07-25",
    reason: "family reasons",
    ptoType: "vacation",
    ptoDaysAccrued: "10",
    ptoDaysUsed: "2",
    ptoHourlyRate: "24.00",
    currency: "EUR",
    externalRef: "copy-discrepancy-1",
  });

  assert.equal(res.body.decision, "escalate");
  assert.equal(res.body.reason, "statutory_discrepancy");
  // The panel's own comparison row already said the true thing; the reason
  // GLOSS beside it said something else entirely, and the two travelled
  // together on "My requests" and on the status sentence.
  assert.match(detail("Proposed vs. statutory"), /2026-08-31 — 23 days earlier than the statutory notice period allows/);
  assert.equal((res.body.details ?? []).find((d) => d.label === "Proposed vs. statutory"), undefined, "the comparison reached the employee mid-review");
  assert.doesNotMatch(String(res.body.decidedBy?.means ?? ""), /earlier|short/i, "the problem was stated to the employee mid-review");
  assert.doesNotMatch(
    reasonLabel(res.body.reason),
    /contract/i,
    "the reason gloss carried on this decision must not allege a contract term"
  );
});


// ---------------------------------------------------------------------------
// A TYPED REASON DOES NOT SILENCE THE LETTER (2026-09-02, live ticket 227)
// ---------------------------------------------------------------------------
test("a resignation that types a reason and states its last day only in the letter still has that day compared", async () => {
  const { res, detail } = await file({
    persona: "joao",
    reason: "new opportunity",
    letterText: "I am resigning for a new opportunity. My last working day will be 30 November 2026.",
    now: "2026-09-02",
    externalRef: "copy-reason-and-letter",
  });
  assert.equal(res.status, 200);
  assert.match(detail("Proposed vs. statutory"), /2026-11-30/, "the letter's date never reached the comparison");
  assert.doesNotMatch(detail("Date came from"), /structured_input/, "nothing structured supplied that date");
});
