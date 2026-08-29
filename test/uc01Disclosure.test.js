// ---------------------------------------------------------------------------
// uc01Disclosure.test.js — what an approval may release, and to whom
// ---------------------------------------------------------------------------
// WHY THIS FILE EXISTS, AND THE FIRST TEST IS THE REASON.
//
// On 2026-08-28 approving an over-scope UC-01 request began issuing Remote's
// CUSTOMIZED letter, which may state the employee's salary. The design rests on
// exactly one control: a named specialist SAW the figure on their screen and
// authorised it.
//
// The first version of that change put the control on one condition and the
// disclosure on none. `src/review/server.js` attached values to the sidebar only
// when `reason === "over_scope_request"`; `src/review/service.js` released them
// on EVERY approve. `evaluate()` returns at the first gate that fires, and three
// approvable reasons sit above the over-scope gate — `third_party_request`
// (gate 4), `artifact_present` (gate 6), `non_standard_request` (gate 7) —
// while the classifier fills `requestedFields` regardless of which gate stopped
// the ladder.
//
// So: a bank asks through the third-party door for "employment and annual gross
// salary", consent is on record, gate 4 fires. The sidebar shows consent facts
// and NO salary row — nothing to see, nothing to weigh. The specialist approves.
// The letter states the salary and goes out. The control never ran.
//
// The whole suite was green for that. It is not a test that was weakened; it is
// a test that did not exist, on the newest and most consequential path in the
// use case. This file is it.
// ---------------------------------------------------------------------------

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  AUTHORISABLE_FIELDS,
  DISCLOSURE_REASONS,
  NOT_RECORDED,
  approvalMayDisclose,
  authorisableDisclosures,
  readDisclosure,
} from "../src/uc01/disclosureFields.js";
import { REQUESTED_FIELD_SYNONYMS } from "../src/uc01/requestedFieldVocabulary.js";
import { overScopeFieldsRequested } from "../src/uc01/policyEngine.js";
import { renderLetterHtml } from "../src/uc01/letter.js";
import { RemoteClient } from "../src/remote/restClient.js";
import { createInProcessFetch } from "../src/remote/mockServer.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repo = (...parts) => readFileSync(join(__dirname, "..", ...parts), "utf8");

const remote = new RemoteClient({ baseUrl: "http://mock.remote.invalid", fetchImpl: createInProcessFetch() });
const EMPLOYMENT_ID = "2f7f8210-91fc-47db-803c-77a1cc625781"; // Alex Morgan — carries a salary

// ---------------------------------------------------------------------------
// 1. The bug, pinned so it cannot come back
// ---------------------------------------------------------------------------

test("a reason the sidebar shows no values for can never release any", async () => {
  const employment = await remote.getEmployment(EMPLOYMENT_ID);
  // What a bank actually asks for through the third-party door. `salary` is the
  // CONTRACT vocabulary the classifier's `compensation` is translated into.
  const requested = ["salary"];

  // The guard that makes this test meaningful rather than vacuous: this record
  // genuinely carries a salary, so "nothing was released" is a decision and not
  // an empty fixture.
  assert.ok(
    authorisableDisclosures(employment, requested).length > 0,
    "the fixture carries no salary, so this test could not tell a refusal from an absence"
  );

  for (const reason of ["third_party_request", "artifact_present", "non_standard_request", "low_confidence"]) {
    assert.equal(
      approvalMayDisclose(reason),
      false,
      `approving a "${reason}" case may disclose, and its sidebar shows no values to authorise`
    );
  }
});

test("the reasons that MAY disclose are exactly the reasons the sidebar shows values for", () => {
  // Read out of the server rather than restated here — a copy of the condition
  // in this file would be a third copy of the thing that already drifted once.
  const server = repo("src", "review", "server.js");
  const service = repo("src", "review", "service.js");

  assert.match(
    server,
    /approvalMayDisclose\(view\.case\?\.reason\)/,
    "the sidebar decides what to show from something other than the shared predicate"
  );
  assert.match(
    service,
    /approvalMayDisclose\(caseRow\.reason\)/,
    "the approve path decides what to release from something other than the shared predicate"
  );
  assert.doesNotMatch(
    server,
    /reason === "over_scope_request"/,
    "the sidebar has grown its own inline condition again"
  );
});

test("approvalMayDisclose fails closed on anything it does not recognise", () => {
  for (const bad of [null, undefined, "", "over_scope", "OVER_SCOPE_REQUEST", 0, {}, ["over_scope_request"]]) {
    assert.equal(approvalMayDisclose(bad), false, `${JSON.stringify(bad)} was treated as a disclosing reason`);
  }
  assert.equal(approvalMayDisclose("over_scope_request"), true, "the one real disclosing reason stopped working");
});

// ---------------------------------------------------------------------------
// 2. The three copies of the list, held together
// ---------------------------------------------------------------------------
// A browser bundle cannot import from `src/`, and an n8n Code node cannot
// import at all — so the list exists three times by necessity. Necessity is not
// permission to drift: both copies are read out of their own files here and
// compared against the source of truth.

test("the browser bundle and the n8n note agree with the server about which reasons disclose", () => {
  const listFrom = (source, where) => {
    const match = source.match(/DISCLOSURE_REASONS\s*=\s*\[([^\]]*)\]/);
    assert.ok(match, `${where} no longer declares DISCLOSURE_REASONS — re-point this test`);
    return match[1]
      .split(",")
      .map((entry) => entry.trim().replace(/^["']|["']$/g, ""))
      .filter(Boolean);
  };

  assert.deepEqual(
    listFrom(repo("zaf-app", "assets", "panels.js"), "the ZAF bundle"),
    [...DISCLOSURE_REASONS],
    "the sidebar bundle promises 'never salary' on a reason that now discloses, or the reverse"
  );
  assert.deepEqual(
    listFrom(repo("workflows", "nodes", "composeInternalNote.js"), "the n8n internal-note node"),
    [...DISCLOSURE_REASONS],
    "the durable ticket note names the wrong document for at least one reason"
  );
});

// ---------------------------------------------------------------------------
// 3. The closed set
// ---------------------------------------------------------------------------

test("a field outside the authorisable set is never released, however it is spelled", async () => {
  const employment = await remote.getEmployment(EMPLOYMENT_ID);
  const hostile = [
    "bank_account",
    "passport_number",
    "home_address",
    "medical",
    // Prototype keys: `LABELS[field]` and `FIELD_VOCABULARY[f]` are plain
    // objects, so these resolve through the chain to real functions unless the
    // lookup is an own-property check. They leaked nothing even before that
    // check existed, but they rendered `function Object() { [native code] }` as
    // a field label on the reviewer's screen and in the ticket note.
    "constructor",
    "__proto__",
    "toString",
    "valueOf",
  ];

  assert.deepEqual(
    authorisableDisclosures(employment, hostile),
    [],
    "something outside AUTHORISABLE_FIELDS reached the letter"
  );

  for (const field of hostile) {
    const d = readDisclosure(employment, field);
    assert.equal(d.authorisable, false, `${field} is authorisable`);
    assert.equal(d.value, null, `${field} resolved to a value`);
    assert.equal(typeof d.label, "string", `${field}'s label is a ${typeof d.label}, not a string`);
    assert.doesNotMatch(d.label, /native code|function/, `${field}'s label renders a JavaScript internal`);
  }
});

test("the authorisable set is the one the owner chose, and grows only on purpose", () => {
  // Not a tautology: this is the list a specialist may put on a customer-facing
  // document, decided by the project owner on 2026-08-28. A silent addition is
  // a widening of what this system will ever disclose, and it should cost a
  // deliberate edit here.
  assert.deepEqual([...AUTHORISABLE_FIELDS], ["salary", "job_title", "working_hours", "end_date"]);
});

// ---------------------------------------------------------------------------
// 4. The letter itself, in both directions
// ---------------------------------------------------------------------------

test("the standard letter is byte-identical whether or not the customized path exists", async () => {
  const employment = await remote.getEmployment(EMPLOYMENT_ID);
  const entity = await remote.getLegalEntity(employment.legal_entity_id, employment.company_id);

  // Every way a caller can say "nothing authorised". All four must produce the
  // same document, because three of them are what the automatic paths pass.
  const variants = [
    renderLetterHtml(employment, entity, { reference: "1" }),
    renderLetterHtml(employment, entity, { reference: "1", authorisedFields: [] }),
    renderLetterHtml(employment, entity, { reference: "1", authorisedFields: null }),
    // A hostile shape: entries with no usable value must be dropped, not
    // rendered as blank rows.
    renderLetterHtml(employment, entity, {
      reference: "1",
      authorisedFields: [{ label: "Annual gross salary", value: "   " }, { label: "x" }, null],
    }),
  ];
  for (const [i, html] of variants.entries()) {
    assert.equal(html, variants[0], `variant ${i} produced a different standard letter`);
    assert.match(html, /Employment Verification Letter/);
    assert.doesNotMatch(html, /Customized Employment Verification Letter/, `variant ${i} became a customized letter`);
    assert.match(
      html,
      /Financial details and other confidential employment terms are not/,
      `variant ${i} dropped the standard letter's own disclosure statement`
    );
  }

  // Driven from the record's own number rather than a literal, so this cannot
  // pass against a fixture whose salary has changed.
  const figure = String(employment.base_salary).slice(0, 3);
  assert.ok(!variants[0].includes(`${figure},`), "the standard letter states a figure resembling the salary");
});

test("a customized letter states the authorised fields, names its approver, and drops the claim it discloses nothing", async () => {
  const employment = await remote.getEmployment(EMPLOYMENT_ID);
  const entity = await remote.getLegalEntity(employment.legal_entity_id, employment.company_id);
  const authorised = authorisableDisclosures(employment, ["salary", "working_hours"]);
  assert.ok(authorised.length >= 1, "the fixture supports nothing, so this test would pass vacuously");

  const html = renderLetterHtml(employment, entity, {
    reference: "159",
    authorisedFields: authorised,
    authorisedBy: "specialist@example.test",
  });

  assert.match(html, /Customized Employment Verification Letter/);
  for (const d of authorised) {
    assert.ok(html.includes(d.value), `the letter omits the authorised value for ${d.field}`);
  }
  assert.match(html, /authorised by specialist@example\.test/);

  // THE SENTENCE THAT WOULD MAKE THE DOCUMENT CONTRADICT ITSELF. "Financial
  // details ... are not disclosed in this letter" printed above a salary row is
  // worse than the disclosure, because a reader trusts it.
  assert.doesNotMatch(
    html,
    /Financial details and other confidential employment terms are not/,
    "the customized letter still claims to disclose no financial details"
  );
});

test("a field the record cannot support gets its row anyway, as a NAMED ABSENCE", async () => {
  // REPORTED FROM A REAL TICKET. The requester wrote "my contract has no end
  // date", asking the letter to confirm it. The record carries neither an end
  // date nor a duration type, the field was dropped, and the letter said
  // nothing at all — a question asked and answered with silence.
  //
  // Dropping the row is the MORE dangerous option, not the safer one: a letter
  // that omits the end date because it was unreadable, beside one that omits it
  // because the contract is permanent, teaches its reader that omission means
  // permanent. See NOT_RECORDED's own header.
  const employment = await remote.getEmployment(EMPLOYMENT_ID);
  const entity = await remote.getLegalEntity(employment.legal_entity_id, employment.company_id);

  const authorised = authorisableDisclosures(employment, ["end_date"]);
  assert.equal(authorised.length, 1, "an authorised field vanished from the letter instead of being stated absent");
  assert.equal(authorised[0].value, NOT_RECORDED);

  const html = renderLetterHtml(employment, entity, { reference: "1", authorisedFields: authorised });
  assert.match(html, /Contract end date/, "the row the requester asked about is missing from the letter");
  assert.match(html, new RegExp(NOT_RECORDED));

  // AND IT MUST NOT READ AS "there is no end date". "Not recorded" and "None —
  // indefinite" are different sentences and the wording must keep them apart;
  // "N/A" would collapse them, which is the whole point of the constant.
  assert.doesNotMatch(html, /Contract end date<\/th><td>N\/A/, "the absence was collapsed into an ambiguous N/A");
  assert.doesNotMatch(
    html,
    /Contract end date<\/th><td>None/,
    "an unreadable end date was stated as there being none, which is a fabrication"
  );
});

test("an INDEFINITE contract says so in words, and never shares wording with an unreadable one", () => {
  // The three answers, kept apart. This is the distinction a mortgage
  // underwriter acts on.
  const base = { full_name: "X", status: "active", contract_type: "eor", start_date: "2020-01-01" };

  const indefinite = readDisclosure({ ...base, contract_details: { contract_duration_type: "indefinite" } }, "end_date");
  assert.equal(indefinite.available, true);
  assert.match(indefinite.value, /indefinite/i);

  const fixed = readDisclosure({ ...base, contract_details: { contract_end_date: "2028-06-26" } }, "end_date");
  assert.equal(fixed.value, "2028-06-26");

  const unknown = readDisclosure({ ...base, contract_details: {} }, "end_date");
  assert.equal(unknown.available, false);
  assert.equal(unknown.value, null);

  assert.notEqual(indefinite.value, NOT_RECORDED, "an indefinite contract and an unreadable one say the same thing");
});

// ---------------------------------------------------------------------------
// 5. The classifier does not obey its own prompt, and must not need to
// ---------------------------------------------------------------------------

test("a salary asked for in the model's own words is still recognised as salary", async () => {
  // TICKET #161, LIVE. `src/uc01/classifier.js`'s prompt says "Use ONLY these
  // canonical values" and lists `compensation`. The model returned
  // `gross_annual_salary`. Nothing downstream was broken — the one-entry
  // vocabulary map and the exact-match AUTHORISABLE_FIELDS both let it through
  // untranslated — so the sidebar told a specialist "gross_annual_salary —
  // never released" about the ONE field the disclosure feature exists to
  // release, on a ticket that had asked for exactly that.
  //
  // A frozen prompt is a request, not validation. Prime directive #1.
  const employment = await remote.getEmployment(EMPLOYMENT_ID);

  const spellings = [
    "gross_annual_salary", // what the live model actually returned
    "compensation", // what its prompt tells it to return
    "annual_gross_salary", // Remote's own field name, which a model may echo
    "Gross Annual Salary", // title case with spaces
    "annual-salary", // hyphens
    "  WAGES  ", // padding and case
    "remuneration",
    "current pay",
  ];

  for (const raw of spellings) {
    const [canonical] = overScopeFieldsRequested({ requestedFields: [raw] });
    assert.equal(canonical, "salary", `"${raw}" was not recognised as a salary request`);
    const released = authorisableDisclosures(employment, [canonical]);
    assert.equal(released.length, 1, `"${raw}" normalised to salary and then released nothing`);
    assert.match(released[0].value, /USD per year \(gross\)/);
  }
});

test("widening what we RECOGNISE never widens what we RELEASE", () => {
  // The synonym table is generous on purpose — a model reaches for many words
  // for one field. That generosity must stay on the recognition side only: an
  // unrecognised name passes through UNCHANGED, stays outside
  // AUTHORISABLE_FIELDS, and is refused by the closed set exactly as before.
  for (const raw of ["bank_account", "passport_number", "payslip", "payment_date", "pay_grade", "constructor"]) {
    const [canonical] = overScopeFieldsRequested({ requestedFields: [raw] });
    assert.ok(
      !AUTHORISABLE_FIELDS.includes(canonical),
      `"${raw}" normalised to "${canonical}", which is releasable — the synonym table has widened disclosure`
    );
  }

  // The near-misses are the ones worth naming. `/salary|pay|wage/` as a pattern
  // would swallow all three of these, which is why the table is explicit.
  for (const raw of ["payslip", "payment_date", "pay_grade"]) {
    const [canonical] = overScopeFieldsRequested({ requestedFields: [raw] });
    assert.notEqual(canonical, "salary", `"${raw}" was read as a salary request`);
  }
});

test("every synonym points at a field this system can actually answer", () => {
  // A synonym mapping to a name outside AUTHORISABLE_FIELDS would be dead
  // weight that reads as support: the sidebar would relabel the request and
  // then still refuse it, which is the worst of both.
  for (const [spelling, canonical] of Object.entries(REQUESTED_FIELD_SYNONYMS)) {
    assert.ok(
      AUTHORISABLE_FIELDS.includes(canonical),
      `"${spelling}" maps to "${canonical}", which is not a field this system can release`
    );
  }
});

test("the n8n port carries the same synonyms, so both paths read one request the same way", () => {
  // A decision made on the n8n path and a disclosure decided on the Node path
  // must agree about what was asked for. The parity suite compares DECISIONS,
  // and these two spellings produce the same decision either way — so only a
  // direct comparison catches the drift.
  const node = repo("workflows", "nodes", "gates.js");
  for (const spelling of Object.keys(REQUESTED_FIELD_SYNONYMS)) {
    assert.ok(
      node.includes(`${spelling}:`),
      `the n8n gates body does not know the spelling "${spelling}", so the two paths would name the same request differently`
    );
  }
});
