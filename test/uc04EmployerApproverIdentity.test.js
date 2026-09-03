// ---------------------------------------------------------------------------
// uc04EmployerApproverIdentity.test.js — who approved it, and where it renders
// ---------------------------------------------------------------------------
// TWO DEFECTS, FOUND BY A READER OPENING AN APPROVED TICKET IN THE SIDEBAR AND
// ASKING WHERE THE APPROVER'S NAME WAS. Neither was visible to any existing
// test, and they compound: one hid the block, the other emptied it.
//
//   1. THE BLOCK WAS HIDDEN. main.js drew `settled` only in its `!actionable`
//      branch — a rule from when "settled" and "nothing left to do here" were
//      the same thing. Since 2026-08-31 UC-04 is BOTH: stage 2 (the employer's
//      approval) is settled while stage 3 (Remote's mobility review) is open on
//      that very screen. So the employer's approval disappeared from the panel
//      at exactly the moment a specialist was asked to review it. The API had
//      been publishing it the whole time — verified live against the
//      deployment, which returned `settled.headline: "Approved."` for the
//      ticket the reader was looking at.
//
//   2. THE NAME WAS NEVER DURABLE. `uc04_authorizations` has no column for the
//      approver's display name, so it lived on the in-memory row and in the
//      prose of a Zendesk note. The sidebar reads Postgres from another
//      process, so the strongest thing the panel could have said was "Approved
//      by admin_jane" — a session id, which is an audit-grade identity and not
//      an answer to "who approved this".
// ---------------------------------------------------------------------------

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { settledFacts } from "../src/uc04/approvalPolicy.js";
import { readEmployerApprover, EMPLOYER_DECISION_ACTIONS } from "../src/uc04/employerDecisionLog.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MAIN_JS = readFileSync(join(__dirname, "..", "zaf-app", "assets", "main.js"), "utf8");

const factsOf = (row) => Object.fromEntries((settledFacts(row) ?? { facts: [] }).facts.map((f) => [f.label, f.value]));

const APPROVED = {
  id: "auth-1",
  status: "approved_by_manager",
  approver: "admin_jane",
  approvedAt: "2026-08-31T20:20:03.903Z",
};

test("an approved row names the approver in WORDS, with the session id kept", () => {
  const facts = factsOf({ ...APPROVED, approverName: "Jane Doe (company admin)" });
  assert.equal(facts["Approved by"], "Jane Doe (company admin) (admin_jane)");
  // The id is never dropped: it is what the audit trail is keyed on, and it is
  // what the Zendesk hand-off note prints, so the two surfaces agree.
  assert.match(facts["Approved by"], /admin_jane/);
});

test("with no name recorded it still says the id — an id beats an invented name", () => {
  assert.equal(factsOf(APPROVED)["Approved by"], "admin_jane");
});

test("a decline names the decliner the same way — and is settled AT ALL", () => {
  // The row is exactly what recordEmployerDecision() writes for a decline.
  // Before 2026-08-31 settledFacts() returned NULL for it: the approve branch
  // accepts `approvedAt`, the decline branch tested only the status word, and
  // `declined_by_manager` is not an alias of `declined`. So the decliner, the
  // date and the mandatory reason all vanished from the panel.
  const row = {
    id: "auth-2",
    status: "declined_by_manager",
    declinedAt: "2026-08-31T20:20:03.903Z",
    declinedBy: { approver: "admin_jane", approverName: "Jane Doe (company admin)", note: "Not this quarter", at: "2026-08-31T20:20:03.903Z" },
  };
  assert.ok(settledFacts(row), "an employer decline must produce a settled block");
  assert.equal(settledFacts(row).headline, "Declined.");
  const facts = factsOf(row);
  assert.equal(facts["Declined by"], "Jane Doe (company admin) (admin_jane)");
  assert.equal(facts["Reason given"], "Not this quarter");
});

// --- the audit log as the store for the name ------------------------------

const auditWith = (entries) => ({ entries, pgPool: null });

test("the approver's name is recovered from the append-only audit row", async () => {
  const audit = auditWith([
    {
      useCase: "UC-04",
      action: "work_authorization_employer_approved",
      actor: "admin_jane",
      details: { workAuthorizationId: "auth-1", approverName: "Jane Doe (company admin)" },
    },
  ]);
  assert.deepEqual(await readEmployerApprover({ audit, authorizationId: "auth-1" }), { name: "Jane Doe (company admin)", title: null, company: null });
});

test("it answers null rather than guessing — and never returns the session id as a name", async () => {
  // A row from before 2026-08-31 carries no `approverName`. The honest answer is
  // nothing, so the caller prints the id; returning `actor` here would dress a
  // session id up as a person's name, which is the defect wearing a disguise.
  const audit = auditWith([
    { useCase: "UC-04", action: "work_authorization_employer_approved", actor: "admin_jane", details: { workAuthorizationId: "auth-1" } },
  ]);
  assert.equal(await readEmployerApprover({ audit, authorizationId: "auth-1" }), null);
  assert.equal(await readEmployerApprover({ audit, authorizationId: null }), null);
  assert.equal(await readEmployerApprover({ audit: null, authorizationId: "auth-1" }), null);
  // Another authorization's decision is not this one's.
  assert.equal(await readEmployerApprover({ audit, authorizationId: "auth-2" }), null);
});

test("it reads only the employer's own two actions", async () => {
  assert.deepEqual([...EMPLOYER_DECISION_ACTIONS].sort(), [
    "work_authorization_employer_approved",
    "work_authorization_employer_declined",
  ]);
  // Stage 3's verdict must not be mistaken for stage 2's — they are different
  // people deciding different things, and mixing them is the exact defect the
  // 2026-08-30 pass removed from this panel.
  const audit = auditWith([
    { useCase: "UC-04", action: "work_authorization_mobility_cleared", actor: "spec_sam", details: { workAuthorizationId: "auth-1", approverName: "Sam (mobility)" } },
  ]);
  assert.equal(await readEmployerApprover({ audit, authorizationId: "auth-1" }), null);
});

test("an unreadable audit table costs the name, never the panel", async () => {
  const audit = { entries: [], pgPool: { query: async () => { throw new Error("connection reset"); } } };
  assert.equal(await readEmployerApprover({ audit, authorizationId: "auth-1" }), null);
});

// --- the rendering, which is what the reader actually hit -------------------

test("the settled decision renders on an ACTIONABLE case too", () => {
  // Structural, because this is browser code npm test never executes. The
  // defect was precisely that the only `settled` render sat inside
  // `if (!view.actionable)`, so asserting the string exists proves nothing —
  // what matters is that a render exists OUTSIDE that branch.
  const actionsFn = MAIN_JS.slice(MAIN_JS.indexOf("function renderActions("));
  const notActionable = actionsFn.indexOf("if (!view.actionable)");
  const earlyRender = actionsFn.indexOf("r-settled-earlier");
  assert.ok(earlyRender !== -1, "no settled render outside the !actionable branch");
  assert.ok(
    earlyRender < notActionable,
    "the already-settled block must render BEFORE the not-actionable branch, or it is still unreachable on an open case"
  );
  assert.match(actionsFn.slice(0, notActionable), /view\.actionable && settledAlready/);
});

test("the already-settled block withholds the finality sentence", () => {
  // "an approved request cannot be approved or declined again" is true of the
  // stage below and reads as "there is nothing to do here" when printed above a
  // live control. It is still printed in full where nothing is open.
  const actionsFn = MAIN_JS.slice(MAIN_JS.indexOf("function renderActions("));
  const early = actionsFn.slice(actionsFn.indexOf("r-settled-earlier"), actionsFn.indexOf("if (!view.actionable)"));
  assert.ok(!/finality/.test(early), "the open-case block must not print `finality`");
  // ...and the closed-case branch still does, so nothing was lost.
  assert.match(actionsFn.slice(actionsFn.indexOf("if (!view.actionable)")), /settled\.finality/);
});

// ---------------------------------------------------------------------------
// "APPROVED BY admin_jane" IS NOT AN ANSWER, and this is the objection that
// produced the change: Remote has many client companies, so a session id says
// nothing about who the person is, what standing they had to approve an
// employee's work authorization, or which client they belong to.
// ---------------------------------------------------------------------------
test("a settled approval names the person, their standing and the employer", () => {
  const facts = factsOf({
    ...APPROVED,
    approverName: "Jane Okonkwo",
    approverTitle: "Head of People Operations",
    approverCompany: "Meridian Analytics",
  });
  assert.equal(facts["Approved by"], "Jane Okonkwo (admin_jane)");
  assert.equal(facts["Their role"], "Head of People Operations");
  // The company row must say whose side this decision was taken on. Stage 2 is
  // the CUSTOMER'S decision, and a bare company name beside a Remote-branded
  // panel is exactly the ambiguity being removed.
  assert.match(facts["Acting for"], /^Meridian Analytics — the employer, not Remote$/);
});

test("each part is omitted rather than guessed when it was not recorded", () => {
  // A decision written before the title and company were captured still renders
  // — half an answer is worth more than none, and an invented job title on a
  // record of who approved somebody's work authorization would be far worse
  // than a missing one.
  const facts = factsOf({ ...APPROVED, approverName: "Jane Okonkwo" });
  assert.equal(facts["Approved by"], "Jane Okonkwo (admin_jane)");
  assert.equal(facts["Their role"], undefined);
  assert.equal(facts["Acting for"], undefined);
});

test("the audit row carries the standing and the employer, not just the name", async () => {
  const audit = { entries: [{
    useCase: "UC-04", action: "work_authorization_employer_approved", actor: "admin_jane",
    details: { workAuthorizationId: "auth-1", approverName: "Jane Okonkwo",
      approverTitle: "Head of People Operations", approverCompany: "Meridian Analytics" },
  }], pgPool: null };
  assert.deepEqual(await readEmployerApprover({ audit, authorizationId: "auth-1" }), {
    name: "Jane Okonkwo", title: "Head of People Operations", company: "Meridian Analytics",
  });
});
