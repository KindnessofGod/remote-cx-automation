// ---------------------------------------------------------------------------
// uc05OpenItems.test.js — the four UC-05 items left open on 2026-09-02
// ---------------------------------------------------------------------------
// WHY THIS FILE EXISTS
//
// The 2026-09-02 statute pass corrected four countries that were stating the
// WRONG PARTY'S notice obligation, and deliberately left four things open, each
// named in a commit message or a code comment. This file is the guard for all
// four, and every test in it was checked the only way that means anything: by
// putting the old behaviour back and watching the assertion go red.
//
//   1. Remote publishes `days_of_notice` on every resignation record and NO
//      CODE READ IT. The comparison this system performed was statute vs. what
//      the EMPLOYEE asked for; the one that carries the risk is statute vs.
//      what the EMPLOYER is about to accept (DRIFT-095, `[N-5]`).
//   2. `noStatutoryProbationNotice: true` sat on the Portugal row and NOTHING
//      CONSUMED IT, so a probationer was answered with 30 days beside a
//      citation, in the same object, saying they owed nothing (C-20, D-03).
//   3. Canada's refusal wording had no Québec variant. "The notice owed comes
//      from the contract" is exact for Ontario and the United States and FALSE
//      in Québec, where CCQ art. 2091 binds either party and art. 2092 makes
//      the remedy non-renounceable (C-35, D-44).
//   4. Poland's `week_saturday` anchor was not built, so the two-week bracket
//      declared itself unanchored — honest, and unfinished (C-33, D-43,
//      Kodeks pracy art. 30 § 2¹).
//
// WHAT THESE TESTS DELIBERATELY DO NOT DO: pin a SPELLING. A guard that names
// one wrong phrase passes the moment the phrase is reworded, which is the
// failure `CLAUDE.md` §7 item 22 records ("a guard that names the wrong spelling
// is not a guard"). Where a class of statement has to be absent — a Canadian
// refusal sourcing the obligation to the contract and nowhere else, a Polish
// notice period ending on any day but Saturday — the test enumerates the class
// and checks every member of it.
// ---------------------------------------------------------------------------

import { test } from "node:test";
import assert from "node:assert/strict";

import { evaluate, GATE_SEQUENCE, describeDecidingGate } from "../src/uc05/policyEngine.js";
import { computeNoticePeriod, applyAnchor } from "../src/uc05/noticePeriodCalculator.js";
import { NOTICE_PERIOD_TABLE } from "../src/uc05/noticePeriodTable.js";
import { reconcileNoticeFigures } from "../src/uc05/noticeReconciliation.js";
import { describeSignoffBasis } from "../src/uc05/decisionFacts.js";

const active = (over = {}) => ({ id: "emp_1", status: "active", ...over });

const decide = (over = {}, extra = {}) =>
  evaluate({
    identityVerified: true,
    employment: active(over),
    now: "2026-09-02",
    ...extra,
  });

/** The row shape describeSignoffBasis() reads — the panel sees only this. */
const rowFor = (result) => ({ notice: result.notice, payout: result.payout, letterExtraction: null });

// ---------------------------------------------------------------------------
// 1. REMOTE'S `days_of_notice` — read, held against the statute, neither preferred
// ---------------------------------------------------------------------------

test("[N-5] the reconciliation carries BOTH figures and BOTH provenances, never one", () => {
  const r = reconcileNoticeFigures({
    statuteDays: 60,
    statuteQuantity: "60 days",
    statuteCitation: "Código do Trabalho art. 400.º(1)",
    remoteDaysOfNotice: 30,
    remoteRecordRef: "ofb_88",
  });
  assert.equal(r.verdict, "statute_longer");
  assert.equal(r.compared, true);
  // Both numbers survive to the reader, and each says where it came from.
  assert.equal(r.remote.daysOfNotice, 30);
  assert.equal(r.statute.days, 60);
  assert.equal(r.remote.recordRef, "ofb_88");
  assert.match(r.remote.provenance, /CONTRACT TERMS AND local labour law/);
  assert.match(r.statute.provenance, /Código do Trabalho art\. 400\.º\(1\)/);
  assert.match(r.statute.provenance, /has read no contract/);
  // NEITHER IS PREFERRED. The one verdict that is a real conflict refuses to
  // pick, by name, and says why picking is not this system's job.
  assert.equal(r.governing, "undetermined");
  assert.match(r.sentence, /question of law/);
});

test("[N-5] EVERY comparing verdict states both figures — no one-sided answer, in any direction", () => {
  // THE CLASS, not one case. Whatever the two numbers are, a compared verdict
  // that mentioned only one of them would be the defect: the reader would take
  // the surviving figure for the notice period.
  for (const [remote, statute] of [
    [30, 30],
    [90, 30],
    [14, 30],
    [0, 7],
    [7, 0],
  ]) {
    const r = reconcileNoticeFigures({
      statuteDays: statute,
      statuteQuantity: `${statute} days`,
      statuteCitation: "some statute",
      remoteDaysOfNotice: remote,
    });
    assert.equal(r.compared, true, `${remote} vs ${statute} should be comparable`);
    assert.ok(r.sentence.includes(String(remote)), `${remote} vs ${statute}: Remote's figure is missing from the sentence`);
    assert.ok(r.sentence.includes(String(statute)), `${remote} vs ${statute}: the statutory figure is missing from the sentence`);
    assert.equal(r.remote.daysOfNotice, remote);
    assert.equal(r.statute.days, statute);
  }
});

test("[N-5] an ABSENCE is never an agreement, and it always names which side was missing", () => {
  // Four ways a comparison can fail to happen. Each has to be distinguishable,
  // because they are four different work orders — and none of them may report
  // `agree`, which is the whole hazard of a one-sided screen.
  const cases = [
    { args: { statuteDays: 30, statuteQuantity: "30 days" }, reason: "remote_figure_absent", side: "remote" },
    { args: { statuteDays: 30, statuteQuantity: "30 days", remoteDaysOfNotice: "30" }, reason: "remote_figure_unreadable", side: "remote" },
    { args: { statuteDays: 30, statuteQuantity: "30 days", remoteDaysOfNotice: -5 }, reason: "remote_figure_unreadable", side: "remote" },
    { args: { remoteDaysOfNotice: 30 }, reason: "no_statutory_figure", side: "statute" },
    { args: { statuteMonths: 1, statuteQuantity: "1 month", remoteDaysOfNotice: 30 }, reason: "statute_figure_not_a_day_count", side: null },
  ];
  const seen = new Set();
  for (const c of cases) {
    const r = reconcileNoticeFigures(c.args);
    assert.equal(r.verdict, "not_compared", `${c.reason}: should not have compared`);
    assert.equal(r.compared, false);
    assert.equal(r.notComparedReason, c.reason);
    assert.equal(r.missingSide, c.side);
    assert.equal(r.governing, null, `${c.reason}: nothing governs when nothing was compared`);
    assert.equal(r.differenceDays, null);
    seen.add(c.reason);
  }
  // Four distinct reasons across five inputs: a non-numeric and a negative
  // `days_of_notice` are the same finding (we could not read it as a number of
  // days) and correctly share a name. Every OTHER pair must differ.
  assert.equal(seen.size, new Set(cases.map((c) => c.reason)).size);
  assert.equal(seen.size, 4);
});

test("[N-5] a month is never turned into thirty days so a subtraction can happen", () => {
  // BW art. 7:672(4)'s "één maand" and Kodeks pracy art. 36 § 1's "1 miesiąc"
  // have no statutory day count, and the calculator refuses to print one. A
  // reconciliation that quietly used 30 would manufacture the very false
  // precision the rest of this use case refuses — and it would do it inside a
  // block whose only output is a claim that two figures differ.
  const nl = decide({ country_code: "NL", start_date: "2020-01-01" }, { remoteDaysOfNotice: 30 });
  assert.equal(nl.notice.noticeMonths, 1);
  assert.equal(nl.notice.noticeDays, null);
  assert.equal(nl.notice.reconciliation.verdict, "not_compared");
  assert.equal(nl.notice.reconciliation.notComparedReason, "statute_figure_not_a_day_count");
  // And it still shows both sides — the refusal is to SUBTRACT, not to inform.
  assert.equal(nl.notice.reconciliation.remote.daysOfNotice, 30);
  assert.equal(nl.notice.reconciliation.statute.months, 1);
  assert.equal(nl.decision, "prepared_for_signoff", "a non-comparison must not itself escalate");
});

test("[N-5] Remote's figure BELOW the statutory floor escalates, under its own reason", () => {
  // Portugal, more than two years' service: art. 400.º(1) gives 60 days. A
  // record saying 30 is a blended contract-and-statute figure under the floor.
  const r = decide({ country_code: "PT", start_date: "2020-01-01" }, { remoteDaysOfNotice: 30 });
  assert.equal(r.decision, "escalate");
  assert.equal(r.reason, "remote_notice_below_statutory");
  assert.ok(r.flags.includes("notice_shortfall_days_30"));
  assert.ok(r.flags.includes("remote_notice_days_30"));
  // NOT `statutory_discrepancy`. That rung's own sentence is about a date the
  // EMPLOYEE proposed, and no proposal exists on this case — two findings
  // sharing one reason string is what gate 4's own history is a record of.
  assert.notEqual(r.reason, "statutory_discrepancy");
  const rung = describeDecidingGate(r.reason);
  assert.ok(rung, "the deciding reason has no rung on the ladder");
  assert.equal(rung.gate, "notice_reconciliation");
  assert.ok(
    !/proposed in the resignation is EARLIER/.test(rung.means),
    "the rung describes an employee proposal that does not exist on this case"
  );
});

test("[N-5] Remote's figure ABOVE the statutory floor is lawful: flagged, not escalated", () => {
  // The ordinary case in EOR work — a contractual notice above the statutory
  // floor. Serving the longer period serves the minimum too, so there is
  // nothing to choose and nothing to escalate. Same reasoning as
  // `later_than_statutory`.
  const r = decide({ country_code: "PT", start_date: "2020-01-01" }, { remoteDaysOfNotice: 90 });
  assert.equal(r.decision, "prepared_for_signoff");
  assert.equal(r.reason, "all_gates_passed");
  assert.ok(r.flags.includes("remote_notice_longer_than_statutory"));
  assert.equal(r.notice.reconciliation.governing, "remote_notice_satisfies_both");
});

test("[N-5] agreement is SHOWN rather than left silent, and adds no flag", () => {
  const r = decide({ country_code: "PT", start_date: "2020-01-01" }, { remoteDaysOfNotice: 60 });
  assert.equal(r.decision, "prepared_for_signoff");
  assert.equal(r.notice.reconciliation.verdict, "agree");
  assert.equal(r.notice.reconciliation.governing, "agreed");
  // An agreement nobody can see is not evidence to them (`[N-6]`) — so both
  // figures are still on the case...
  assert.match(r.notice.reconciliation.sentence, /60/);
  // ...and it is not in `flags`, because a flag on every agreeing resignation
  // would put a row in the metrics exception ranking for every case this
  // system ever sees.
  assert.deepEqual(r.flags.filter((f) => f.startsWith("remote_notice_")), []);
});

test("[N-5] the panel shows the reconciliation, and names the unread figure as an UNKNOWN", () => {
  // The state of every case today: nothing in this system fetches
  // GET /v1/resignations/{offboarding_request_id}. A specialist who is not told
  // so reads the statutory figure as the notice period rather than as a floor
  // checked against nothing.
  const r = decide({ country_code: "PT", start_date: "2020-01-01" });
  const basis = describeSignoffBasis({ resignationRow: rowFor(r) });
  assert.ok(basis.reconciliation, "the sign-off panel has no reconciliation block at all");
  assert.equal(basis.reconciliation.verdict, "not_compared");
  assert.equal(basis.reconciliation.missingSide, "remote");
  const unknown = basis.unknowns.find((u) => /Remote itself requires/.test(u.what));
  assert.ok(unknown, "the unread days_of_notice is not named among what the case does not know");
  assert.match(unknown.whatItWouldTake, /resignation:read/);
  assert.match(unknown.whatItWouldTake, /offboarding_request_id/);

  // And when it IS read, the block reports the comparison rather than an unknown.
  const compared = decide({ country_code: "PT", start_date: "2020-01-01" }, { remoteDaysOfNotice: 60 });
  const comparedBasis = describeSignoffBasis({ resignationRow: rowFor(compared) });
  assert.equal(comparedBasis.reconciliation.compared, true);
  assert.equal(
    comparedBasis.unknowns.filter((u) => /Remote itself requires/.test(u.what)).length,
    0,
    "a comparison that happened is still being reported as an unknown"
  );
});

test("[N-5] the workflow accepts the figure off the record as well as bare", async () => {
  // A caller holds one of two shapes: the integer, or the resignation record it
  // came off. Both have to work, or the plumbing is a hook nobody can reach.
  const { handleResignationRequest } = await import("../src/uc05/workflow.js");
  const { ResignationStore } = await import("../src/uc05/resignationStore.js");
  const { AuditLogger } = await import("../src/shared/audit.js");

  const employment = {
    id: "emp_pt_9",
    status: "active",
    country_code: "PT",
    start_date: "2020-01-01",
    contract_details: { compensation_currency_code: "EUR" },
  };
  const run = async (ticketExtra) =>
    handleResignationRequest(
      {
        employmentId: "emp_pt_9",
        session: { authenticatedEmploymentId: "emp_pt_9" },
        timeOffBalances: [],
        now: "2026-09-02",
        externalRef: `open-items-${Math.random()}`,
        ...ticketExtra,
      },
      {
        remote: { getEmployment: async () => employment },
        audit: new AuditLogger(null, { pgPool: null }),
        resignationStore: new ResignationStore({ pgPool: null }),
        extract: async () => ({ proposedEndDate: null, reason: null, confidence: 1, source: "structured_input" }),
      }
    );

  const bare = await run({ remoteDaysOfNotice: 30 });
  assert.equal(bare.reason, "remote_notice_below_statutory");

  const fromRecord = await run({
    remoteResignation: { offboarding_request_id: "ofb_9", days_of_notice: 30 },
  });
  assert.equal(fromRecord.reason, "remote_notice_below_statutory");
  assert.equal(fromRecord.notice.reconciliation.remote.recordRef, "ofb_9");

  // And with neither: the honest non-comparison, not a silent pass.
  const neither = await run({});
  assert.equal(neither.decision, "prepared_for_signoff");
  assert.equal(neither.notice.reconciliation.notComparedReason, "remote_figure_absent");
});

// ---------------------------------------------------------------------------
// 2. PORTUGAL — the probation exemption the row recorded and nothing read
// ---------------------------------------------------------------------------

test("[C-20] a Portuguese probationer is NOT answered with the ordinary bracket", () => {
  // art. 114.º(1): "durante o período experimental … qualquer das partes pode
  // denunciar o contrato SEM AVISO PRÉVIO". The row carried that finding in
  // `noStatutoryProbationNotice` and `pickBracket()` fell through to art.
  // 400.º(1)'s 30 days — a figure from an article that does not reach a
  // probationer, printed beside a citation saying they owe nothing.
  const r = decide({ country_code: "PT", start_date: "2026-07-01", probation_end_date: "2026-12-01" });
  assert.equal(r.notice.onProbation, true);
  assert.equal(r.decision, "escalate");
  assert.equal(r.reason, "no_statutory_notice_during_probation");
  assert.equal(r.notice.noStatutoryProbationNotice, true);

  // THE NUMBER IS GONE, IN BOTH DIRECTIONS. Not 30 — that was the wrong
  // article. Not 0 either: art. 114.º(1) opens "salvo acordo escrito em
  // contrário", so a written contract may require notice where the statute does
  // not, and this system holds no contract. A zero is a quantity a reader acts
  // on; there is no quantity here to state.
  assert.equal(r.notice.noticeDays, null);
  assert.equal(r.notice.noticeMonths, null);
  assert.equal(r.notice.noticeQuantity, null);
  assert.equal(r.notice.noticeEndDate, null);
  assert.ok(r.flags.includes("contractual_notice_not_held"));
  assert.ok(r.flags.includes("on_probation"));
});

test("[C-20] the probation finding is NOT collapsed into the three absences beside it", () => {
  // Portugal HAS a statutory notice regime — art. 400.º(1) applies the day
  // probation ends — so `statutoryMinimumExists` stays true, and none of the
  // other three no-end-date reasons may own this case. Each would send it to a
  // different, wrong desk: extend the table, add the country, read the contract
  // because the country sets nothing.
  const r = decide({ country_code: "PT", start_date: "2026-07-01", probation_end_date: "2026-12-01" });
  assert.equal(r.notice.statutoryMinimumExists, true);
  assert.equal(r.notice.noticeRuleFound, true);
  for (const wrong of ["unsupported_country", "no_matching_notice_bracket", "no_statutory_notice_period"]) {
    assert.notEqual(r.reason, wrong);
  }
  const rung = describeDecidingGate(r.reason);
  assert.ok(rung, "the probation reason has no rung on the gate ladder");
  assert.match(rung.means, /without notice/i);
  assert.match(rung.means, /unless otherwise agreed in writing/i);
});

test("[C-20] the exemption applies ONLY inside probation, and only where the row records it", () => {
  // The negative control that makes the branch a rule rather than a country
  // switch. One day past the probation end date the ordinary article applies
  // again and produces a real number.
  const after = decide({ country_code: "PT", start_date: "2026-07-01", probation_end_date: "2026-09-01" });
  assert.equal(after.notice.onProbation, false);
  assert.equal(after.notice.noticeDays, 30);
  assert.equal(after.decision, "prepared_for_signoff");

  // And a country whose row does NOT carry the flag keeps its own probation
  // bracket — Germany's two weeks under BGB §622(3), untouched by this change.
  const de = decide({ country_code: "DE", start_date: "2026-07-01", probation_end_date: "2026-12-01" });
  assert.equal(de.notice.onProbation, true);
  assert.equal(de.notice.noticeDays, 14);
  assert.equal(de.reason, "all_gates_passed");

  // The flag is on exactly one row today, and it is a POSITIVE statutory
  // finding rather than "we hold no probation rule" (`probation: null`), which
  // several rows carry and which means something else entirely.
  const flagged = Object.values(NOTICE_PERIOD_TABLE).filter((r) => r.noStatutoryProbationNotice === true);
  assert.deepEqual(flagged.map((r) => r.countryCode), ["PT"]);
});

test("[C-20] the panel says the statute gives no notice, and does NOT clear the employee to leave", () => {
  const r = decide({ country_code: "PT", start_date: "2026-07-01", probation_end_date: "2026-12-01" });
  const basis = describeSignoffBasis({ resignationRow: rowFor(r) });
  assert.equal(basis.notice.stated, false);
  const text = `${basis.notice.why} ${basis.notice.sentence}`;
  assert.match(text, /probation/i);
  assert.match(text, /WITHOUT notice/i);
  // THE HALF THAT MATTERS MOST. A screen that stops at "the statute requires no
  // notice" is read as "you may leave today", which is a claim about a contract
  // nobody has opened.
  assert.match(text, /unless otherwise agreed in writing/i);
  assert.match(text, /no contract has been read|does not hold/i);
  // And no day figure anywhere on the notice block — not 30, not 0.
  assert.equal(basis.notice.noticeDays, undefined);
  assert.ok(!/\b(30|15|0) days\b/.test(text), `a day figure reached the probation panel: ${text}`);
});

// ---------------------------------------------------------------------------
// 3. CANADA — the refusal wording, and the province it was false for
// ---------------------------------------------------------------------------

/** Every sentence the Canadian refusal puts in front of a person. */
function canadianRefusalText() {
  const r = decide({ country_code: "CA", start_date: "2019-01-01" });
  const basis = describeSignoffBasis({ resignationRow: rowFor(r) });
  return {
    result: r,
    basis,
    text: [basis.notice.why, basis.notice.sentence, basis.notice.rule].filter(Boolean).join(" "),
  };
}

test("[C-35] the Canadian refusal names the Québec regime, not only the contract", () => {
  const { text, result } = canadianRefusalText();
  // CCQ art. 2091 binds CHACUNE DES PARTIES — either party — so a resigning
  // Québec employee owes a délai de congé under ENACTED law, and art. 2092
  // makes the remedy for an insufficient one non-renounceable.
  assert.match(text, /Qu[ée]bec/);
  assert.match(text, /Civil Code|Code civil/);
  assert.match(text, /BOTH parties|either party|reasonable time/i);
  assert.match(text, /renounce/i);
  // The finding is on the case as a flag too, so it survives into the audit row
  // and the queue rather than living only in prose.
  assert.ok(result.flags.includes("notice_standard_not_a_number"));
  assert.ok(result.flags.includes("no_statutory_notice_period"));
});

test("[C-35] NO Canadian sentence sources the obligation to the contract WITHOUT naming the province", () => {
  // THE CLASS, not the old spelling. The defect was not one phrase — it was any
  // sentence telling a reader where the obligation comes from as though the
  // answer were the same across Canada. Every such sentence must carry the
  // qualifier that decides between the two regimes; a reworded version of the
  // old claim fails this exactly as the original does.
  const { text } = canadianRefusalText();
  const sourcing = /\b(comes from|is contractual|contractual or common-law|from the (employee'?s )?contract)\b/i;
  const qualifier = /province|Qu[ée]bec|common-law provinces/i;
  const sentences = text.split(/(?<=\.)\s+/).filter(Boolean);
  const offenders = sentences.filter((s) => sourcing.test(s) && !qualifier.test(s));
  assert.deepEqual(
    offenders,
    [],
    `a Canadian sentence sources the notice obligation without saying which province it is true of: ${offenders.join(" | ")}`
  );
  // And at least one sentence DOES make the sourcing claim — otherwise this
  // test passes by the text having gone silent, which is a different defect.
  assert.ok(sentences.some((s) => sourcing.test(s)), "the refusal no longer says where the obligation comes from at all");
});

test("[C-35] the United States refusal is NOT given Canada's words", () => {
  // The negative control, and the reason `noticeStandardWithoutNumber` is a
  // field rather than a country check. Both rows report
  // `statutoryMinimumExists: false`; only one of them has a province where the
  // obligation is statutory. Pasting Québec's sentence onto the US row would be
  // a fresh false claim in the opposite direction.
  const us = decide({ country_code: "US", start_date: "2019-01-01" });
  const basis = describeSignoffBasis({ resignationRow: rowFor(us) });
  const text = [basis.notice.why, basis.notice.sentence, basis.notice.rule].filter(Boolean).join(" ");
  assert.equal(us.reason, "no_statutory_notice_period");
  assert.ok(!/Qu[ée]bec/.test(text), "the US refusal has acquired Québec's wording");
  assert.ok(!us.flags.includes("notice_standard_not_a_number"));
  assert.match(text, /contract/i);
  assert.equal(NOTICE_PERIOD_TABLE.US.noticeStandardWithoutNumber, undefined);
  assert.equal(NOTICE_PERIOD_TABLE.CA.noticeStandardWithoutNumber, true);
});

test("[C-35] Canada still computes NOTHING — art. 2091 states a standard, not a quantity", () => {
  // D-44: "A refusal is the right answer to a reasonableness test; a number
  // never is." The 0/7/14 brackets removed earlier the same day must not come
  // back in another costume now that the row is sourced.
  assert.deepEqual(NOTICE_PERIOD_TABLE.CA.brackets, []);
  assert.equal(NOTICE_PERIOD_TABLE.CA.probation, null);
  for (const tenureStart of ["2026-08-01", "2024-01-01", "2015-01-01"]) {
    const r = decide({ country_code: "CA", start_date: tenureStart });
    assert.equal(r.decision, "escalate");
    assert.equal(r.notice.noticeDays, null);
    assert.equal(r.notice.noticeEndDate, null);
  }
  // The evidence tag exists now — the row was deliberately untagged while
  // nobody had read a Canadian statute, and two have now been read.
  assert.match(NOTICE_PERIOD_TABLE.CA.evidence, /D-05/);
  assert.match(NOTICE_PERIOD_TABLE.CA.evidence, /D-44/);
});

// ---------------------------------------------------------------------------
// 4. POLAND — art. 30 § 2¹'s other half
// ---------------------------------------------------------------------------

test("[C-33] a two-week Polish notice period ends on a SATURDAY, whatever day it was filed", () => {
  // Kodeks pracy art. 30 § 2¹: a notice period comprising a week or a multiple
  // of weeks ends "w sobotę". THE CLASS, not one date: every filing day of the
  // week, so a fix that happens to be right for one weekday fails here.
  for (let offset = 0; offset < 14; offset += 1) {
    const now = new Date(Date.UTC(2026, 8, 1 + offset)).toISOString().slice(0, 10);
    const r = computeNoticePeriod({ countryCode: "PL", startDate: "2026-06-01", now });
    assert.equal(r.noticeDays, 14, `${now}: not the two-week bracket`);
    const end = new Date(`${r.noticeEndDate}T00:00:00Z`);
    assert.equal(end.getUTCDay(), 6, `filed ${now}: notice ends ${r.noticeEndDate}, which is not a Saturday`);
    // FORWARD ONLY, and by less than a week. A notice period may be lengthened
    // to reach its statutory landing day; shortening one puts the employee in
    // breach, and jumping a whole extra week is a fortnight served as three.
    const raw = new Date(`${now}T00:00:00Z`);
    raw.setUTCDate(raw.getUTCDate() + 14);
    const served = Math.round((end.getTime() - raw.getTime()) / 86400000);
    assert.ok(served >= 0 && served < 7, `filed ${now}: the anchor moved the end by ${served} days`);
  }
});

test("[C-33] applyAnchor's week_saturday leaves a date that is already Saturday alone", () => {
  // `adjusted` is what the panel uses to tell the reader the date is not simply
  // start + N days. Reporting an adjustment that did not happen is the same
  // class of false vouching as the month_end anchor's own note.
  const saturday = applyAnchor("2026-09-05", "week_saturday"); // 2026-09-05 is a Saturday
  assert.equal(saturday.date, "2026-09-05");
  assert.equal(saturday.adjusted, false);
  const sunday = applyAnchor("2026-09-06", "week_saturday");
  assert.equal(sunday.date, "2026-09-12");
  assert.equal(sunday.adjusted, true);
});

test("[C-33] the monthly Polish brackets still land on a month END, not a Saturday", () => {
  // The same subsection gives two rules and they must not have swapped. A
  // Saturday anchor on the one- and three-month periods would be the mirror of
  // the defect this closes.
  for (const [startDate, expectMonths] of [
    ["2026-01-01", 1],
    ["2020-01-01", 3],
  ]) {
    const r = computeNoticePeriod({ countryCode: "PL", startDate, now: "2026-09-02" });
    assert.equal(r.noticeMonths, expectMonths);
    assert.equal(r.noticeDays, null, "a month-denominated period must not print a day count");
    const end = new Date(`${r.noticeEndDate}T00:00:00Z`);
    const next = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() + 1, 1));
    assert.equal(
      r.noticeEndDate,
      new Date(next.getTime() - 86400000).toISOString().slice(0, 10),
      `${expectMonths}-month notice ended ${r.noticeEndDate}, which is not a month end`
    );
  }
});

test("[C-33] the citation no longer says the Saturday rule is unmodelled, and the bracket carries it", () => {
  // A citation describing a capability that now exists is the stale-disclosure
  // failure C-18's own comment records: a reader checks the caveat, finds it
  // resolved, and stops checking the thing beside it.
  const pl = NOTICE_PERIOD_TABLE.PL;
  assert.ok(
    !/does not model|unanchored/i.test(pl.sourceCitation),
    `the Polish citation still calls the Saturday rule unmodelled: ${pl.sourceCitation}`
  );
  assert.match(pl.sourceCitation, /SATURDAY/);
  const twoWeek = pl.brackets.find((b) => b.noticeDays === 14);
  assert.equal(twoWeek.anchorRule, "week_saturday");
  assert.equal(pl.anchorRule, "month_end", "the row's own anchor is the monthly one");
});

// ---------------------------------------------------------------------------
// The ladder itself — every reason this engine can produce has a rung
// ---------------------------------------------------------------------------

test("every reason evaluate() can return is described by exactly one rung", () => {
  // Two reasons were added by this pass. A reason with no rung renders as a raw
  // slug on a specialist's screen, and a duplicate rung makes the ladder
  // ambiguous about which gate decided.
  const reasons = GATE_SEQUENCE.map((r) => r.reason);
  assert.equal(new Set(reasons).size, reasons.length, "a reason appears on two rungs");
  const positions = GATE_SEQUENCE.map((r) => r.position);
  assert.deepEqual(positions, [...positions].sort((a, b) => a - b), "the ladder is out of order");
  for (const reason of ["no_statutory_notice_during_probation", "remote_notice_below_statutory"]) {
    const rung = describeDecidingGate(reason);
    assert.ok(rung, `${reason} has no rung`);
    assert.ok(rung.means.length > 100, `${reason}'s rung says almost nothing`);
  }
});
