// ---------------------------------------------------------------------------
// uc05NoticeCountries.test.js — the demo country set, and the three outcomes
// that must never collapse into each other
// ---------------------------------------------------------------------------
// WHY THIS FILE EXISTS, SEPARATELY FROM test/uc05.test.js
//
// The demonstrable country set is NL · PT · CA · US (docs/DEMO-COUNTRIES.md).
// Until 2026-08-20 `NOTICE_PERIOD_TABLE` covered PT and CA only, so half the
// demo set fell through to `unsupported_country` — and for the United States
// that outcome was not merely unhelpful, it was FALSE. It says, durably in
// `uc05_resignations` and `audit_log` and in the metrics exception ranking,
// that the US is outside Remote's coverage. The truth is that the US is
// covered and what we hold for it is the finding that no statutory minimum
// binds a resigning employee.
//
// THE FAILURE THIS FILE IS BUILT AGAINST is the one CLAUDE.md §4 names as this
// project's through-line: a path that structurally CANNOT succeed is
// indistinguishable, from outside, from one that is appropriately refusing.
// Every assertion here that matters is therefore POSITIVE — "this input MUST
// produce this decision, this date and this number" — because no amount of
// negative testing separates the two. The NL cases below are the whole point:
// before this pass no Dutch resignation could reach `prepared_for_signoff` by
// any route, and the suite was green.
//
// THREE OUTCOMES, AND THEY GO TO THREE DIFFERENT WORK ORDERS:
//
//   unsupported_country         we hold no rule; the law may require anything
//                               -> somebody adds the country
//   no_statutory_notice_period  SOURCED: no statutory minimum binds a resigning
//                               employee; what is owed is contractual and this
//                               system does not hold contracts
//                               -> somebody opens the contract
//   no_matching_notice_bracket  we hold the rule; no bracket covers this tenure
//                               -> somebody extends the table's low end
//
// A computed date is the fourth. The last test in this file asserts all four
// stay distinguishable through the calculator, the policy engine, the gate
// ladder and the citation layer at once — because each of those layers has its
// own copy of the distinction, and the defect being fixed was precisely that
// two of them had already been collapsed.
//
// HERMETIC: no network. The LLM seam is the real extractFromLetter() forced
// into its unconfigured rule-based branch, exactly as test/uc05.test.js does
// it, so a set OPENAI_API_KEY cannot turn these into slow network calls
// (CLAUDE.md §6, "Never let npm test reach OpenAI").
// ---------------------------------------------------------------------------

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { startMockServer } from "../src/remote/mockServer.js";
import { RemoteClient } from "../src/remote/restClient.js";
import { AuditLogger } from "../src/shared/audit.js";
import { ResignationStore } from "../src/uc05/resignationStore.js";
import { handleResignationRequest } from "../src/uc05/workflow.js";
import { extractFromLetter } from "../src/uc05/letterExtractor.js";
import {
  NOTICE_PERIOD_TABLE,
  getNoticeRule,
  hasNoStatutoryMinimum,
  supportedCountryCodes,
} from "../src/uc05/noticePeriodTable.js";
import {
  computeNoticePeriod,
  addCalendarDays,
  addCalendarMonths,
  applyAnchor,
} from "../src/uc05/noticePeriodCalculator.js";
import { GATE_SEQUENCE, describeDecidingGate } from "../src/uc05/policyEngine.js";
import { sourcesForFinding, uncitedFinding, SOURCE_LIBRARY } from "../src/uc05/decisionSources.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");
const read = (p) => readFileSync(join(repoRoot, p), "utf8");

let server;
let remote;

// 4100 — allocated from TEST_BAND (4090-4149) in src/shared/ports.js and
// declared there under this file's name. The first draft of this file picked
// 4064 by reading test/uc05.test.js's 4063 and adding one, which is exactly the
// reasoning CLAUDE.md §6's port gotcha describes: 4064 was already
// uc06SlackNotifier.test.js's, node --test runs files in parallel, and which of
// the two died would have depended on scheduling. test/ports.test.js caught it.
before(async () => {
  server = await startMockServer(4100);
  remote = new RemoteClient({ baseUrl: "http://localhost:4100" });
});
after(() => server && server.close());

const fakeExtract = (args) => extractFromLetter(args, { isConfigured: () => false });

/** Drive the REAL handler, not the policy engine — the task is end-to-end. */
function submit(overrides) {
  return handleResignationRequest(
    {
      reason: "new opportunity",
      hourlyRateInRemoteInteger: 4000,
      ...overrides,
    },
    { remote, audit: new AuditLogger(), resignationStore: new ResignationStore(), extract: fakeExtract }
  );
}

// Real mock employments, not hand-built records. Both are normalized through
// RemoteClient exactly as production does it.
const NL_EMPLOYMENT = "emp_nl_amend_001"; // Jan Bakker, NL, start 2023-10-01
const US_EMPLOYMENT = "8ab12460-b568-4c1e-af9d-09b1fabd8f46"; // Chris Lee, US, start 2021-09-06
const BR_EMPLOYMENT = "c2cd77da-d576-423f-b4f1-f9e40b313353"; // Carlos Silva, BR — in no table
const PT_EMPLOYMENT = "d73cff71-ced7-4bcf-b764-b9899abc6340"; // (GB) — see the PT bracket tests, which are unit-level

const nl = (o) => submit({ session: { authenticatedEmploymentId: NL_EMPLOYMENT }, employmentId: NL_EMPLOYMENT, ...o });
const us = (o) => submit({ session: { authenticatedEmploymentId: US_EMPLOYMENT }, employmentId: US_EMPLOYMENT, ...o });

// ---------------------------------------------------------------------------
// NETHERLANDS — the positive case, and the arithmetic that only a positive
// case can catch
// ---------------------------------------------------------------------------

test("NL: a Dutch resignation reaches prepared_for_signoff with a real statutory date — BW art. 7:672 lid 4 + lid 1", async () => {
  // Jan Bakker, NL, start 2023-10-01. Resigning 2026-09-15:
  //   art. 672(4) — one month  -> 2026-10-15
  //   art. 672(1) — end of the month it falls in -> 2026-10-31
  // Proposing exactly that date is a `match`, and the whole chain passes.
  //
  // THIS IS THE ASSERTION THE WHOLE FILE EXISTS FOR. Before the NL row was
  // added, no Dutch input of any shape could produce this decision, and
  // nothing in the suite said so — `unsupported_country` is a correct-looking
  // refusal, and "correct refusal" and "cannot ever succeed" are the same
  // observation from outside.
  const r = await nl({ now: "2026-09-15", proposedEndDate: "2026-10-31" });

  assert.equal(r.decision, "prepared_for_signoff");
  assert.equal(r.reason, "all_gates_passed");
  assert.equal(r.notice.countryCode, "NL");
  assert.equal(r.notice.basis, "statutory");
  assert.equal(r.notice.noticeEndDate, "2026-10-31");
  assert.equal(r.notice.discrepancy, "match");
  assert.equal(r.notice.discrepancyDays, 0);
  // The statutory quantity is a MONTH, and there is no statutory day figure.
  assert.equal(r.notice.noticeMonths, 1);
  assert.equal(r.notice.noticeQuantity, "1 month");
  assert.equal(r.notice.noticeDays, null, "the statute says 'één maand', not a number of days");
  assert.equal(r.notice.statutoryMinimumExists, true);
  assert.equal(r.notice.noticeRuleFound, true);
  // The end-of-month rule moved the date, and the record says so — otherwise a
  // reader reproduces "start + one month" by hand, gets 2026-10-15, and reports
  // the system as wrong.
  assert.equal(r.notice.anchorAdjusted, true);
  assert.ok(r.flags.includes("anchor_rule_applied"));
  assert.match(r.notice.sourceCitation, /7:672/);
});

test("NL: one month is NOT thirty days — the 31-day-month case a 30 would have got wrong by a full month", async () => {
  // Resigning on the 1st of a 31-day month is the one shape where the two
  // encodings diverge, and they diverge by a whole month rather than a day:
  //
  //   30 days      2026-10-01 + 30d = 2026-10-31, which IS a month end, so the
  //                anchor leaves it alone -> the employee is told their notice
  //                ends inside the month they resigned in.
  //   one month    2026-10-01 + 1 month = 2026-11-01, month end -> 2026-11-30.
  //
  // Both numbers look plausible on a form. Nothing but this test separates
  // them, and no hand-picked mid-month fixture reaches the difference at all —
  // which is exactly why the wrong encoding would have survived review.
  const r = await nl({ now: "2026-10-01", proposedEndDate: "2026-11-30" });

  assert.equal(r.decision, "prepared_for_signoff");
  assert.equal(r.notice.noticeEndDate, "2026-11-30");
  assert.equal(r.notice.discrepancy, "match");

  // And the counterfactual, spelled out so the regression is legible: the
  // 30-day route lands a month earlier.
  const thirtyDayRoute = applyAnchor(addCalendarDays("2026-10-01", 30), "month_end").date;
  assert.equal(thirtyDayRoute, "2026-10-31");
  assert.notEqual(thirtyDayRoute, r.notice.noticeEndDate);
});

test("NL: a leaving date short of the statutory month escalates as a statutory discrepancy, with the shortfall counted", async () => {
  const r = await nl({ now: "2026-09-15", proposedEndDate: "2026-10-01" });
  assert.equal(r.decision, "escalate");
  assert.equal(r.reason, "statutory_discrepancy");
  assert.equal(r.notice.noticeEndDate, "2026-10-31");
  assert.equal(r.notice.discrepancyDays, -30);
  assert.ok(r.flags.includes("discrepancy_earlier_than_statutory"));
  assert.ok(r.flags.includes("discrepancy_days_-30"));
});

test("NL: the flat month has no tenure dimension — art. 672's ladder is the EMPLOYER's (C-14)", () => {
  // The trap D-01 and CONTRADICTIONS.md C-14 both warn about: art. 7:672 opens
  // with a 1/2/3/4-month ladder banded by service, and that ladder is lid 2,
  // the employer's obligation. The employee's is lid 4 and is flat. A row
  // written from "the first numbers in the article" would model the wrong party
  // and report it as the employee's duty — which is the identical mistake this
  // table already made once for Portugal (C-20).
  const rule = getNoticeRule("NL");
  assert.equal(rule.brackets.length, 1, "a second bracket would mean a tenure dimension the employee's limb does not have");
  assert.equal(rule.brackets[0].tenureMinMonths, 0);
  assert.equal(rule.brackets[0].tenureMaxMonths, null);

  // Proved behaviourally too, across four decades of service: the answer never
  // moves. A structural check alone would pass on a table whose brackets all
  // happened to carry the same number.
  const at = (startDate) =>
    computeNoticePeriod({ countryCode: "NL", startDate, now: "2026-09-15" }).noticeEndDate;
  assert.equal(at("2026-08-01"), at("1986-01-01"));
  assert.equal(at("2026-08-01"), "2026-10-31");

  // And none of 1, 2, 3 or 4 months — the employer's ladder — is expressible
  // here, because there is nowhere for a second figure to live.
  assert.equal(rule.brackets[0].noticeMonths, 1);
});

// ---------------------------------------------------------------------------
// UNITED STATES — a sourced absence, said in words
// ---------------------------------------------------------------------------

test("US: no statutory minimum is a POSITIVE outcome, not unsupported_country and not a zero-day notice", async () => {
  const r = await us({ now: "2026-09-15", proposedEndDate: "2026-09-30" });

  assert.equal(r.decision, "escalate");
  assert.equal(r.reason, "no_statutory_notice_period");
  assert.notEqual(r.reason, "unsupported_country", "the US is covered — this reason is a claim about the LAW, not about our table");
  assert.notEqual(r.reason, "no_matching_notice_bracket");

  // The three things that must all be true at once for this to be the third
  // state rather than either of the other two.
  assert.equal(r.notice.noticeRuleFound, true, "the table DOES hold a rule for the US");
  assert.equal(r.notice.statutoryMinimumExists, false, "and what it holds is that no statutory period exists");
  assert.equal(r.notice.noticeEndDate, null, "so there is no date");

  // NOT ZERO. Zero is a quantity a reader can act on and it says the employee
  // owes nothing, which is a claim about their contract that no source here
  // supports.
  assert.equal(r.notice.noticeDays, null);
  assert.notEqual(r.notice.noticeDays, 0);
  assert.equal(r.notice.noticeMonths, null);

  // Tenure is NOT zeroed just because there is no notice rule — the same point
  // the unsupported-country branch had to be corrected on once already.
  assert.equal(r.notice.tenureMonths, 60);

  // A proposed leaving date cannot be scored against a statutory end that does
  // not exist. `match` here would be the dangerous answer: it would report
  // agreement with a standard nobody applied.
  assert.equal(r.notice.discrepancy, "not_comparable");
  assert.notEqual(r.notice.discrepancy, "match");
  assert.equal(r.notice.discrepancyDays, null);

  // The flag a human acts on names the document that WOULD answer the question.
  assert.ok(r.flags.includes("contractual_notice_not_held"));
  assert.ok(r.flags.includes("country_US"));
});

test("US: the case says so IN WORDS — the citation names WARN and the reason names the contract", async () => {
  const r = await us({ now: "2026-09-15", proposedEndDate: "2026-09-30" });

  // The recorded citation is a sentence a human can read, not a table miss.
  assert.match(r.notice.sourceCitation, /No federal statutory minimum notice runs against a resigning employee/);
  assert.match(r.notice.sourceCitation, /this system does not hold the contract/i);

  // And the gate ladder's prose for this reason must say all three things: no
  // statutory minimum, NOT a gap in our table, and NOT a finding that nothing
  // is owed.
  const gate = describeDecidingGate(r.reason);
  assert.ok(gate, "the deciding reason must have a rung in the ladder");
  assert.match(gate.means, /sourced finding about the law/i);
  assert.match(gate.means, /opposite of "unsupported country"/i);
  assert.match(gate.means, /contract/i);
  assert.match(gate.means, /no notice is owed/i, "it must explicitly refuse the reading 'nothing is owed'");
});

test("US: the citation is tagged [INFERRED] and says what it is NOT evidence of", () => {
  // D-06 is an argument from SCOPE. WARN states what employers of one hundred
  // or more owe on mass layoffs; it never states that a resigning employee owes
  // nothing. A reader who takes the citation at face value has read it
  // backwards, so the provenance has to travel with it.
  const cited = sourcesForFinding("no_statutory_notice_period", "US");
  assert.ok(cited, "the US no-statutory-minimum finding must be cited, not silent");
  assert.equal(cited.citations.length, 1);
  assert.equal(cited.citations[0].sourceId, "D-06");
  assert.match(SOURCE_LIBRARY["D-06"].evidence, /\[INFERRED/);
  // The tag travels with the RESOLVED citation, not only with the library
  // entry — a reader sees the resolved object, and a provenance tag that only
  // exists upstream of what is rendered is not a provenance tag.
  assert.match(cited.citations[0].evidence, /\[INFERRED/);
  assert.match(cited.citations[0].citedFor, /is NOT stated by the source/);
  assert.match(cited.citations[0].citedFor, /argument from scope/i);
  // The caveat naming the two things it leaves open must ride along.
  assert.ok(cited.caveats.some((c) => c.id === "C-13"));
  const c13 = cited.caveats.find((c) => c.id === "C-13");
  assert.match(c13.detail, /state law|mini-WARN/i);
  assert.match(c13.detail, /contract/i);
});

// ---------------------------------------------------------------------------
// THE THREE OUTCOMES STAY DISTINGUISHABLE — the assertion this pass exists for
// ---------------------------------------------------------------------------

test("the three no-date outcomes are distinct in decision, reason, flags, calculator state AND citation layer", async () => {
  // 1. UNSUPPORTED — Brazil is in no table.
  const unsupported = await submit({
    session: { authenticatedEmploymentId: BR_EMPLOYMENT },
    employmentId: BR_EMPLOYMENT,
    now: "2026-09-15",
    proposedEndDate: "2026-09-30",
  });
  // 2. NO STATUTORY MINIMUM — the United States.
  const noMinimum = await us({ now: "2026-09-15", proposedEndDate: "2026-09-30" });
  // 3. NO BRACKET — a UK employee five days in. Employment Rights Act 1996 §86
  //    grants no notice below one month's service, so the country IS covered
  //    and no bracket matches.
  const noBracket = computeNoticePeriod({
    countryCode: "GB",
    startDate: "2026-09-10",
    now: "2026-09-15",
    proposedEndDate: "2026-09-30",
  });

  // Every one of them has no date. That is the ONLY thing they share, and it is
  // what made them collapsible in the first place.
  assert.equal(unsupported.notice.noticeEndDate, null);
  assert.equal(noMinimum.notice.noticeEndDate, null);
  assert.equal(noBracket.noticeEndDate, null);

  // REASONS: three, all different.
  const reasons = [unsupported.reason, noMinimum.reason, "no_matching_notice_bracket"];
  assert.deepEqual(reasons, ["unsupported_country", "no_statutory_notice_period", "no_matching_notice_bracket"]);
  assert.equal(new Set(reasons).size, 3);

  // CALCULATOR STATE: the two-field pair that carries the distinction, and the
  // reason `statutoryMinimumExists` is three-valued rather than a second
  // boolean. `null` is honest ignorance; `false` is a sourced finding. Reading
  // them as the same thing is the defect.
  assert.deepEqual(
    [unsupported.notice.noticeRuleFound, unsupported.notice.statutoryMinimumExists],
    [false, null]
  );
  assert.deepEqual([noMinimum.notice.noticeRuleFound, noMinimum.notice.statutoryMinimumExists], [true, false]);
  assert.deepEqual([noBracket.noticeRuleFound, noBracket.statutoryMinimumExists], [true, true]);

  // GATE LADDER: three rungs, three different `means`, no two alike.
  const means = reasons.map((r) => describeDecidingGate(r)?.means);
  assert.ok(means.every(Boolean), "every reason must have a rung");
  assert.equal(new Set(means).size, 3);

  // CITATION LAYER: `unsupported_country` is uncited BY DESIGN (it is a
  // statement about our coverage, and no jurisdiction publishes one);
  // `no_statutory_notice_period` is cited, because it is a statement about the
  // law. If those two ever render alike, the distinction has been lost one
  // layer further out than the gate ladder.
  assert.equal(sourcesForFinding("unsupported_country", "BR"), null);
  assert.ok(uncitedFinding("unsupported_country", "BR"));
  assert.ok(sourcesForFinding("no_statutory_notice_period", "US"));
  assert.equal(uncitedFinding("no_statutory_notice_period", "US"), null, "a cited finding must not also be listed as uncitable");

  // And the uncited entry must not claim anything about the country's law.
  assert.match(uncitedFinding("unsupported_country", "BR").why, /not about the country's law/);

  // FOURTH OUTCOME, for completeness: a computed date is none of the three.
  const computed = await nl({ now: "2026-09-15", proposedEndDate: "2026-10-31" });
  assert.equal(computed.decision, "prepared_for_signoff");
  assert.equal(computed.notice.noticeEndDate, "2026-10-31");
});

test("no country in the table can produce a zero-day notice period as its ANSWER", () => {
  // A zero-day bracket is legitimate where a statute genuinely grants no notice
  // below a threshold (IE below 13 weeks, CA below three months) — those are
  // brackets that MATCH and return 0. What must never happen is a zero standing
  // in for "we could not work it out", which is what the US row would have been
  // if it had been encoded as `noticeDays: 0` instead of as a third state.
  const noMinimum = computeNoticePeriod({ countryCode: "US", startDate: "2021-09-06", now: "2026-09-15" });
  assert.equal(noMinimum.noticeDays, null);
  assert.notEqual(noMinimum.noticeDays, 0);

  // And the row itself holds no brackets at all — there is no number to state,
  // so there is nowhere for one to be written.
  assert.deepEqual(NOTICE_PERIOD_TABLE.US.brackets, []);
  assert.equal(NOTICE_PERIOD_TABLE.US.basis, "none");
  assert.equal(hasNoStatutoryMinimum(getNoticeRule("US")), true);
  assert.equal(hasNoStatutoryMinimum(getNoticeRule("NL")), false);
  assert.equal(hasNoStatutoryMinimum(getNoticeRule("ZZ")), false, "an absent country is not a sourced absence");
});

// ---------------------------------------------------------------------------
// PORTUGAL — the bracket boundary that erred against the employee (C-18)
// ---------------------------------------------------------------------------

test("PT: at exactly two years' service the notice is 30 days, not 60 — art. 400.º(1) (C-18)", () => {
  // "até dois anos ou mais de dois anos de antiguidade" — UP TO two years
  // inclusive against MORE than two. The table split at 23 months, so exactly
  // 24 months was told it owed 60 days: double the statute, against the
  // employee. Invisible until now because no fixture in this repository tested
  // a tenure of exactly two years, so the code and the fixtures agreed.
  const at = (startDate) =>
    computeNoticePeriod({ countryCode: "PT", startDate, now: "2026-09-15" }).noticeDays;

  assert.equal(at("2024-10-15"), 30, "23 months — inside the first bracket");
  assert.equal(at("2024-09-15"), 30, "EXACTLY 24 months — 'até dois anos', inclusive");
  assert.equal(at("2024-08-15"), 60, "25 months — 'mais de dois anos'");
  assert.equal(at("2019-06-03"), 60, "long service, unchanged");
});

// ---------------------------------------------------------------------------
// TABLE-SHAPE INVARIANTS
// ---------------------------------------------------------------------------

test("every bracket states its period in EXACTLY ONE of days or months", () => {
  // The two are not interchangeable under a month_end anchor (see the NL test
  // above), so a bracket carrying both — or neither — is a table that has
  // drifted, and the drift would show up as a plausible date rather than as an
  // error.
  for (const [code, rule] of Object.entries(NOTICE_PERIOD_TABLE)) {
    const all = [...rule.brackets, ...(rule.probation ? [rule.probation] : [])];
    if (rule.noStatutoryMinimum) {
      assert.equal(all.length, 0, `${code}: a no-statutory-minimum row must hold no brackets`);
      continue;
    }
    assert.ok(all.length > 0, `${code}: a row with a statutory period must hold at least one bracket`);
    for (const b of all) {
      const hasDays = Number.isFinite(b.noticeDays);
      const hasMonths = Number.isFinite(b.noticeMonths);
      assert.ok(hasDays !== hasMonths, `${code}: a bracket must state days XOR months, got ${JSON.stringify(b)}`);
    }
  }
});

test("a row carrying `evidence` names a document this repository actually holds", () => {
  // The `evidence` tag's absence is informative (CA has none, and C-30 says
  // why), so its PRESENCE has to mean something checkable: the sidecar it
  // names must exist on disk, and the tag must be one of the three the project
  // uses. A row asserting [CONFIRMED] against a document nobody vendored is the
  // mirror problem CLAUDE.md §4 names, one layer out.
  const manifest = read("docs/knowledge/DOWNLOAD-MANIFEST.md");
  for (const [code, rule] of Object.entries(NOTICE_PERIOD_TABLE)) {
    if (!rule.evidence) continue;
    assert.match(rule.evidence, /^\[(CONFIRMED|INFERRED|PROPOSED)/, `${code}: unrecognised evidence tag`);
    const ids = [...rule.evidence.matchAll(/\bD-\d{2}\b/g)].map((m) => m[0]);
    assert.ok(ids.length > 0, `${code}: an evidence tag must name at least one D-NN document`);
    for (const id of ids) {
      assert.ok(
        new RegExp(`^\\| ${id} \\|`, "m").test(manifest),
        `${code}: ${id} is cited but has no row in DOWNLOAD-MANIFEST.md §4`
      );
    }
  }
});

test("the demo country set NL · PT · CA · US is fully covered, and each one can be DECIDED", async () => {
  // The gap this whole pass was opened for, pinned so it cannot silently
  // reopen. "Covered" is deliberately not the same claim as "computes a date":
  // the US is covered by a sourced finding that there is nothing to compute,
  // and that is a decision.
  for (const code of ["NL", "PT", "CA", "US"]) {
    assert.ok(supportedCountryCodes().includes(code), `${code} is a demo country and must be in the table`);
  }

  // And each reaches a decision that is ABOUT THE COUNTRY, never
  // `unsupported_country`.
  const decided = await Promise.all([
    nl({ now: "2026-09-15", proposedEndDate: "2026-10-31" }),
    us({ now: "2026-09-15", proposedEndDate: "2026-09-30" }),
  ]);
  for (const r of decided) {
    assert.notEqual(r.reason, "unsupported_country");
  }

  // PT and CA are exercised through the calculator rather than the handler —
  // neither has a resignation-shaped mock employment of its own, and inventing
  // one here would put a fixture in a shared file that another agent's demo
  // scenarios are being built against.
  const pt = computeNoticePeriod({ countryCode: "PT", startDate: "2019-06-03", now: "2026-09-15" });
  assert.equal(pt.noticeDays, 60);
  assert.equal(pt.noticeEndDate, "2026-11-14");
  const ca = computeNoticePeriod({ countryCode: "CA", startDate: "2019-06-03", now: "2026-09-15" });
  assert.equal(ca.noticeEndDate, "2026-09-29");
  // CA is `customary`, not `statutory`, and that word is load-bearing — see
  // CONTRADICTIONS.md C-30 for why its figures are the least-sourced in the
  // table.
  assert.equal(ca.basis, "customary");
});

// ---------------------------------------------------------------------------
// CALENDAR ARITHMETIC — the clamp, in isolation
// ---------------------------------------------------------------------------

test("addCalendarMonths clamps the day-of-month instead of rolling into the next month", () => {
  // setUTCMonth() rolls 31 October into 1 December. Under a month_end anchor
  // that is not a one-day error, it is a whole extra month of notice: 1
  // December's month end is 31 December, 30 November's is itself.
  assert.equal(addCalendarMonths("2026-10-31", 1), "2026-11-30");
  assert.equal(addCalendarMonths("2026-01-31", 1), "2026-02-28");
  assert.equal(addCalendarMonths("2028-01-31", 1), "2028-02-29", "leap year");
  assert.equal(addCalendarMonths("2026-12-15", 1), "2027-01-15", "year rollover");
  assert.equal(addCalendarMonths("2026-09-15", 1), "2026-10-15");
});

test("applyAnchor month_end reports `adjusted` only when it actually moved the date", () => {
  // A record that claims a rule moved a date it did not move sends a reader
  // hunting for an adjustment that never happened — the mirror of the failure
  // `anchorAdjusted` exists to prevent.
  assert.deepEqual(applyAnchor("2026-10-15", "month_end"), { date: "2026-10-31", adjusted: true });
  assert.deepEqual(applyAnchor("2026-10-31", "month_end"), { date: "2026-10-31", adjusted: false });
  assert.deepEqual(applyAnchor("2026-02-28", "month_end"), { date: "2026-02-28", adjusted: false });
  assert.deepEqual(applyAnchor("2028-02-15", "month_end"), { date: "2028-02-29", adjusted: true });
  // It must NOT add a month of its own — the statutory month is added upstream,
  // and doing it twice would double every Dutch notice period.
  assert.equal(applyAnchor("2026-11-01", "month_end").date, "2026-11-30");
});

// ---------------------------------------------------------------------------
// THE GATE LADDER
// ---------------------------------------------------------------------------

test("the gate ladder is a contiguous 1..N sequence with one rung per reason", () => {
  // The new rung was inserted mid-ladder rather than appended, so the positions
  // below it moved. A duplicated or skipped position would show up nowhere
  // else: describeGateLadder() renders whatever it is given.
  const positions = GATE_SEQUENCE.map((g) => g.position);
  assert.deepEqual(positions, positions.map((_, i) => i + 1));
  assert.equal(new Set(GATE_SEQUENCE.map((g) => g.reason)).size, GATE_SEQUENCE.length);

  // And the new rung sits BETWEEN the two it must not be confused with —
  // ordering in this array is documentation of the order evaluate() can produce
  // reasons in, and getting it wrong misdescribes which gate decided.
  const at = (reason) => GATE_SEQUENCE.findIndex((g) => g.reason === reason);
  assert.ok(at("unsupported_country") < at("no_statutory_notice_period"));
  assert.ok(at("no_statutory_notice_period") < at("no_matching_notice_bracket"));
});
