// ---------------------------------------------------------------------------
// uc02ExpenseIdExtraction.test.js — which expense is this ticket about?
// ---------------------------------------------------------------------------
// UC-02's n8n node reads the expense id out of the ticket TEXT, because a
// Zendesk ticket has no expense-id custom field. Until 2026-08-29 it accepted
// only `expense id: X` / `expense #X` and an `exp_`-prefixed token, so the most
// natural sentence an employee can write — "please review my expense claim
// 724ffc63-98f8-..." — was refused. Measured on live ticket 13, which named a
// real Sandbox expense and was still turned away.
//
// WHY WIDENING IS SAFE HERE AND WOULD NOT BE ELSEWHERE. Naming the wrong
// expense cannot approve anything: ownership ("this expense belongs to this
// employment") is re-proved downstream against the authoritative Remote record.
// A false positive therefore costs a refusal with a vaguer reason; a false
// negative costs a real employee being told their claim names no claim. The
// asymmetry is what justifies four tiers instead of one.
//
// The single thing that must never happen is capturing the EMPLOYMENT id — a
// UUID sitting in the very same ticket — so that is tested from several angles.
// ---------------------------------------------------------------------------

import { test } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const SRC = readFileSync(new URL("../workflows/nodes-uc02/normalizeExpenseSubmission.js", import.meta.url), "utf8");
const FIELD_ID = 9990000000001;
const EMPLOYMENT = "09b65526-643b-4956-959b-916e6429bd23";
const EXPENSE = "724ffc63-98f8-4586-a663-82e888fdc8e0";

/** Run the real node body over a Zendesk-shaped ticket. */
function run(description, { subject = "Expense claim", employmentId = EMPLOYMENT } = {}) {
  const ticket = {
    id: 13,
    subject,
    description,
    attachments: [],
    requester: { email: "anna@example.com" },
    custom_fields: [{ id: FIELD_ID, value: employmentId }],
  };
  const sandbox = { $input: { first: () => ({ json: { body: { ticket } } }) } };
  const out = vm.runInNewContext(`(function () {\n${SRC}\n})()`, sandbox, { timeout: 5000 });
  return JSON.parse(JSON.stringify(out))[0].json;
}

function refuses(description, opts) {
  assert.throws(() => run(description, opts), /names no expense id/);
}

// --- the forms that already worked, which must keep working ----------------

test("tier 1 — the explicit label still works", () => {
  assert.equal(run(`Expense ID: ${EXPENSE}`).expenseId, EXPENSE);
  assert.equal(run(`expense #${EXPENSE}`).expenseId, EXPENSE);
});

test("tier 2 — a self-identifying token still works", () => {
  assert.equal(run("Please look at exp_10045 for me").expenseId, "exp_10045");
});

// --- the sentence that used to be refused -----------------------------------

test("tier 3 — THE REGRESSION THIS FIXES: 'my expense claim <id>'", () => {
  // Live ticket 13, verbatim in shape. This threw before today.
  assert.equal(
    run(`Please could you review my expense claim ${EXPENSE} (client lunch)? Receipt is attached.`).expenseId,
    EXPENSE
  );
});

test("tier 3 — the other nouns people actually use", () => {
  for (const phrase of [
    `my claim ${EXPENSE} please`,
    `reimbursement ${EXPENSE}`,
    `the expense for the client lunch ${EXPENSE}`,
    `Expense number ${EXPENSE}`,
    `claim ref ${EXPENSE}`,
  ]) {
    assert.equal(run(phrase).expenseId, EXPENSE, `not extracted from: ${phrase}`);
  }
});

test("tier 4 — a bare id with no noun at all, when it is the only candidate", () => {
  assert.equal(run(`Hi, can you look at ${EXPENSE}? Thanks.`).expenseId, EXPENSE);
});

// --- the safety properties ---------------------------------------------------

test("the EMPLOYMENT id is never mistaken for the expense", () => {
  // It is a UUID in the same ticket. Every tier must exclude it.
  refuses(`My employment id is ${EMPLOYMENT}, please check my expenses.`);
  refuses(`expense id: ${EMPLOYMENT}`);
  refuses(`Please review my expense claim ${EMPLOYMENT}`);
});

test("the employment id alongside a real expense id picks the EXPENSE", () => {
  const out = run(`Employment ${EMPLOYMENT}. Please review expense claim ${EXPENSE}.`);
  assert.equal(out.expenseId, EXPENSE);
  assert.equal(out.employmentId, EMPLOYMENT);
});

test("TWO candidate ids is refused, not resolved", () => {
  // Genuine ambiguity. Guessing which claim someone meant is a money risk, and
  // this is the boundary between widening a match and inventing an answer.
  const other = "11111111-2222-4333-8444-555555555555";
  refuses(`Please look at ${EXPENSE} and ${other}.`);
});

test("a ticket that names nothing is still refused", () => {
  refuses("Hello, I submitted an expense last week. Could you check it please?");
  refuses("");
});

test("prose containing numbers does not become an id", () => {
  // Dates, amounts and short words must not be captured.
  refuses("I spent 85 EUR on 12 August 2026 at a client dinner. Please approve.");
});

test("the id is matched case-insensitively but returned usable", () => {
  const out = run(`EXPENSE ID: ${EXPENSE.toUpperCase()}`);
  assert.equal(out.expenseId.toLowerCase(), EXPENSE);
});

// --- everything else the node promises must be unchanged ---------------------

test("the rest of the normalized output is untouched by the widening", () => {
  const out = run(`Expense ID: ${EXPENSE}`);
  assert.equal(out.employmentId, EMPLOYMENT);
  assert.equal(out.source, "zendesk");
  assert.equal(out.externalRef, "13");
  assert.deepEqual(out.session, { authenticatedEmail: "anna@example.com" });
  assert.equal(out.receiptHash, null);
});

test("a ticket with no employment id still throws BEFORE any expense matching", () => {
  assert.throws(
    () => run(`Expense ID: ${EXPENSE}`, { employmentId: "" }),
    /has no Remote employment id/,
    "the employment guard must stay first — it is the identity check"
  );
});

// --- regressions from writing this, kept because both nearly shipped ---------

test("an ordinary long WORD is never mistaken for an id", () => {
  // The first draft accepted any token of 8+ characters, and on
  // "Expense claim / My employment id is ..." it extracted the word
  // "employment". A candidate must now be a UUID, or contain a digit.
  for (const word of ["employment", "reimbursed", "attachment", "yesterday"]) {
    refuses(`Please check my expense ${word} from last week.`);
  }
});

test("the SUBJECT's noun cannot reach across and grab an id from the body", () => {
  // Subject and description are matched as one string, so "Expense claim" in
  // the subject sits next to whatever the body opens with. With two candidate
  // ids that let tier 3 pick the first while tier 4 would have refused.
  const other = "11111111-2222-4333-8444-555555555555";
  refuses(`Please look at ${EXPENSE} and ${other}.`, { subject: "Expense claim" });
});

test("an EXPLICIT label still settles a ticket that names two ids", () => {
  // Ambiguity is refused only where nobody has said which one they mean. A
  // person writing "Expense ID: X" has said it, even if another id appears.
  const other = "11111111-2222-4333-8444-555555555555";
  const out = run(`Expense ID: ${EXPENSE}. For context see also ${other}.`);
  assert.equal(out.expenseId, EXPENSE);
});
