// ---------------------------------------------------------------------------
// n8nUc05Parity.test.js — the n8n "Notice Period Gates" Code node and
// policyEngine.js/noticePeriodCalculator.js/ptoPayout.js must agree
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
// Same reasoning as test/n8nParity.test.js (UC-01) and
// test/n8nUc06Parity.test.js (UC-06): UC-05's decision logic exists twice
// — once as src/uc05/{policyEngine,noticePeriodCalculator,ptoPayout,
// letterExtractor}.js, once as the "Notice Period Gates" Code node in
// workflows/nodes-uc05/noticePeriodGates.js. This test executes the ACTUAL
// node body in a node:vm sandbox and asserts it reaches the same
// decision/reason/flags/notice/payout as the real Node functions across
// every UC-05.md §12 scenario, so the two copies cannot drift apart
// unnoticed — and so a broken node body (the escaping bug class
// documented in workflows/README.md) fails a test instead of failing a
// live HR Ops sign-off.
//
// UC-05.md §12 lists 6 scenarios; this parity test covers all 5
// gate-relevant ones (the 6th is a webhook-trigger concern, not a gates
// concern). Each one is matched against the real evaluate() from
// src/uc05/policyEngine.js using the same identity, employment, and
// extraction inputs the node body itself derives, so the comparison
// isolates the deterministic logic.
// ---------------------------------------------------------------------------

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";
import { evaluate } from "../src/uc05/policyEngine.js";
import { payoutCurrencyFor } from "../src/uc05/ptoPayout.js";
import { normalizeEmployment } from "../src/remote/restClient.js";
import { extractFromLetter } from "../src/uc05/letterExtractor.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const GATES_PATH = join(__dirname, "..", "workflows", "nodes-uc05", "noticePeriodGates.js");
const gatesSource = readFileSync(GATES_PATH, "utf8");

/**
 * Run the n8n "Notice Period Gates" Code node body with n8n's globals mocked.
 * Mirrors the runXxxNode() helpers in n8nUc06Parity.test.js / n8nUc08Parity.test.js.
 */
function runNoticePeriodGatesNode({ request, employmentResponse }) {
  const sandbox = {
    $: (nodeName) => {
      if (nodeName === "Normalize Resignation Request") return { first: () => ({ json: request }) };
      if (nodeName === "Fetch Employment (Remote)") return { first: () => ({ json: employmentResponse }) };
      throw new Error(`Unexpected $() lookup for "${nodeName}"`);
    },
    // $input.first().json — the immediate predecessor: Fetch Employment (Remote)
    $input: { first: () => ({ json: employmentResponse }) },
  };

  const wrapped = `(function () {\n${gatesSource}\n})()`;
  const result = vm.runInNewContext(wrapped, sandbox, { timeout: 5000 });

  // Round-trip through JSON — same cross-realm reasoning as every other parity
  // test in this repo. node:vm results belong to a different realm, so
  // assert.deepEqual would fail on prototype identity.
  return JSON.parse(JSON.stringify(result[0].json));
}

/** The real Remote API shape (nested under data.employment), like UC-06's. */
const employmentResponse = (over = {}) => ({
  data: {
    employment: {
      id: "emp_uk_001",
      status: "active",
      country_code: "GB",
      start_date: "2023-01-10",
      probation_end_date: null,
      ...over,
    },
  },
});

/** Same shape the not-yet-built "Normalize Resignation Request" node would produce. */
const requestFor = (over = {}) => ({
  employmentId: "emp_uk_001",
  session: { authenticatedEmploymentId: "emp_uk_001" },
  letterText: "",
  timeOffBalances: [],
  currency: "USD",
  proposedEndDate: null,
  reason: null,
  externalRef: "5001",
  source: "webhook",
  now: "2026-08-16",
  ...over,
});

/**
 * UC-05.md §12 scenarios, expressed so both implementations receive
 * equivalent inputs. Each scenario ships a session override (when the
 * identity gate isn't being exercised) and an employment override (when
 * the country/tenure/employment-status gate isn't).
 */
const SCENARIOS = [
  {
    name: "\u00a712.1 UK standard resignation, proposed LWD within statutory notice -> prepared_for_signoff",
    request: {
      proposedEndDate: "2026-09-15",
      reason: "new opportunity",
    },
  },
  {
    name: "\u00a712.2 PL tenure >3y, proposed LWD shorter than statutory 3-month notice -> escalate",
    request: {
      session: { authenticatedEmploymentId: "emp_pl_001" },
      proposedEndDate: "2026-08-31",
      reason: "family reasons",
      now: "2026-07-25",
    },
    employmentOver: { id: "emp_pl_001", country_code: "PL", start_date: "2022-01-10" },
  },
  {
    name: "\u00a712.3 PTO payout correctness + money scaling: 5 accrued/2 used at 5000/hour -> 320000 in Remote integer",
    request: {
      proposedEndDate: "2026-09-15",
      timeOffBalances: [
        { timeOffType: "vacation", daysAccrued: 10, daysUsed: 2, hourlyRateInRemoteInteger: 5000 },
      ],
    },
  },
  {
    name: "\u00a712.4 missing seniority date (no start_date) -> escalate, missing_seniority_date",
    request: { proposedEndDate: "2026-09-15" },
    employmentOver: { start_date: null },
  },
  {
    name: "\u00a712.5 country outside the 9-country table -> escalate, unsupported_country",
    request: {},
    employmentOver: { id: "emp_unsupported_country_001", country_code: "CH", start_date: "2020-01-01" },
    sessionOver: { authenticatedEmploymentId: "emp_unsupported_country_001" },
  },
  // --- F-33: a negative day count is unreadable, not zero ------------------
  // These three rows are the reason the comparison above was widened. On the
  // pre-fix node body the first two produce `computable: true`, `total: 0` /
  // `total: 390000` and decision `prepared_for_signoff`, against src/'s
  // refusal — a disagreement invisible to a totalInRemoteInteger check alone
  // in the first case, since src/ answers null and the node answers 0.
  {
    name: "F-33 a NEGATIVE accrual is refused by both copies, never clamped to a computable zero",
    request: {
      proposedEndDate: "2026-09-15",
      currency: "GBP",
      timeOffBalances: [
        { timeOffType: "vacation", daysAccrued: -8, daysUsed: 0, hourlyRateInRemoteInteger: 3250 },
      ],
    },
  },
  {
    name: "F-33 a NEGATIVE daysUsed is refused by both copies — the clamp turns it into an OVERpayment",
    request: {
      proposedEndDate: "2026-09-15",
      currency: "GBP",
      timeOffBalances: [
        { timeOffType: "vacation", daysAccrued: 10, daysUsed: -5, hourlyRateInRemoteInteger: 3250 },
      ],
    },
  },
  {
    name: "F-33 POSITIVE both copies still pay out a real balance, and still pay 0 on a genuine overdraw",
    request: {
      proposedEndDate: "2026-09-15",
      currency: "GBP",
      timeOffBalances: [
        { timeOffType: "vacation", daysAccrued: 18, daysUsed: 6, hourlyRateInRemoteInteger: 3250 },
        { timeOffType: "personal", daysAccrued: 4, daysUsed: 6, hourlyRateInRemoteInteger: 3250 },
      ],
    },
  },
  {
    name: "\u00a76.1 no session at all -> escalate, identity_not_verified",
    request: { session: null, proposedEndDate: "2026-09-15" },
  },
  {
    name: "\u00a76.2 session employment does not match the record -> escalate, identity_not_verified",
    request: {
      session: { authenticatedEmploymentId: "emp_de_001" },
      proposedEndDate: "2026-09-15",
    },
  },
  {
    name: "\u00a76.3 terminated employee -> escalate, employee_not_active",
    request: { proposedEndDate: "2026-09-15" },
    employmentOver: { status: "terminated" },
  },
  {
    name: "\u00a76.4 DE non-probation: established DE employee gets 4-week notice + month_15 anchor",
    request: {
      session: { authenticatedEmploymentId: "emp_de_001" },
      proposedEndDate: "2026-10-31",
      now: "2026-08-10",
    },
    employmentOver: {
      id: "emp_de_001",
      country_code: "DE",
      start_date: "2022-01-01",
    },
  },
  {
    name: "\u00a76.5 DE probation: probationary employee gets 2-week notice, not 4-week",
    request: {
      session: { authenticatedEmploymentId: "emp_de_probation_001" },
      proposedEndDate: "2026-09-15",
      now: "2026-08-01",
    },
    employmentOver: {
      id: "emp_de_probation_001",
      country_code: "DE",
      start_date: "2026-05-01",
      probation_end_date: "2026-11-01",
    },
  },
  {
    name: "\u00a76.6 proposed LWD exactly on statutory end -> discrepancy 'match', still prepared_for_signoff",
    request: { proposedEndDate: "2026-09-06" }, // 2026-08-16 + 21 days = 2026-09-06 for UK 37-48 month bracket
  },
  {
    name: "\u00a76.7 letterText with no stated date: rule-based extraction returns null proposedEndDate",
    request: {
      letterText: "I am resigning effective in due course, thank you for the opportunity.",
      proposedEndDate: null,
      reason: null,
    },
  },
  {
    name: "\u00a76.8 PT >2y tenure gives 60 days notice, <2y gives 30",
    request: {
      session: { authenticatedEmploymentId: "emp_pt_old" },
      proposedEndDate: "2026-12-15",
    },
    employmentOver: { id: "emp_pt_old", country_code: "PT", start_date: "2024-01-01" },
  },
  // The exact delivery that killed n8n execution 4975 (finding F-28): a
  // time-off balance in a shape carrying none of the fields the payout
  // multiplies. It used to throw a TypeError out of the Code node BEFORE the
  // audit write, so the request vanished. Both copies must now reach the same
  // audited escalate — and the parity loop below compares them field by field,
  // including payout.computable/unusableLines, so a fix in one copy that
  // wasn't ported to the other fails here.
  // ---------------------------------------------------------------------------
  // The two countries added 2026-08-20. These are the parity cases that matter
  // most in this file, because they exercise code paths that exist in BOTH
  // copies and in NEITHER before this pass: month-denominated arithmetic, the
  // month_end anchor, and the third `statutoryMinimumExists` state. A drift
  // here would produce a Dutch notice date that is right in the Node app and a
  // month wrong in production, or a US resignation that says "no statutory
  // minimum" on one path and "unsupported country" on the other.
  // ---------------------------------------------------------------------------
  {
    name: "NL one month flat (BW 7:672 lid 4) with the end-of-month anchor (lid 1) -> prepared_for_signoff",
    request: {
      session: { authenticatedEmploymentId: "emp_nl_001" },
      proposedEndDate: "2026-10-31",
      reason: "new opportunity",
      now: "2026-09-15",
    },
    employmentOver: { id: "emp_nl_001", country_code: "NL", start_date: "2023-10-01" },
  },
  {
    name: "NL filed on the 1st of a 31-day month — the case where 30 days and one month diverge by a full month",
    request: {
      session: { authenticatedEmploymentId: "emp_nl_001" },
      proposedEndDate: "2026-11-30",
      reason: "new opportunity",
      now: "2026-10-01",
    },
    employmentOver: { id: "emp_nl_001", country_code: "NL", start_date: "2023-10-01" },
  },
  {
    name: "NL proposed leaving date short of the statutory month -> escalate, statutory_discrepancy",
    request: {
      session: { authenticatedEmploymentId: "emp_nl_001" },
      proposedEndDate: "2026-10-01",
      reason: "new opportunity",
      now: "2026-09-15",
    },
    employmentOver: { id: "emp_nl_001", country_code: "NL", start_date: "2023-10-01" },
  },
  {
    name: "US no statutory minimum -> escalate, no_statutory_notice_period (NOT unsupported_country)",
    request: {
      session: { authenticatedEmploymentId: "emp_us_001" },
      proposedEndDate: "2026-09-30",
      reason: "new opportunity",
      now: "2026-09-15",
    },
    employmentOver: { id: "emp_us_001", country_code: "US", start_date: "2021-09-06" },
  },
  {
    name: "PT at EXACTLY 24 months is 30 days, not 60 — art. 400.\u00ba(1) 'at\u00e9 dois anos', C-18",
    request: {
      session: { authenticatedEmploymentId: "emp_pt_002" },
      proposedEndDate: "2026-10-15",
      reason: "new opportunity",
      now: "2026-09-15",
    },
    employmentOver: { id: "emp_pt_002", country_code: "PT", start_date: "2024-09-15" },
  },
  {
    name: "F-28 malformed time-off balance (execution 4975) -> escalate, pto_balance_unusable",
    request: {
      session: { authenticatedEmploymentId: "emp_ca_001" },
      letterText:
        "I am resigning from my position, effective 30 September 2026. Please confirm my final working day and any outstanding leave payout.",
      proposedEndDate: "2026-09-30",
      timeOffBalances: [{ type: "vacation", balanceDays: 8 }],
      currency: "EUR",
      now: "2026-08-18",
    },
    employmentOver: { id: "emp_ca_001", country_code: "CA", start_date: "2023-06-24" },
  },
  {
    name: "F-28 malformed balance PLUS a statutory discrepancy -> the earlier gate still owns the reason",
    request: {
      session: { authenticatedEmploymentId: "emp_pl_001" },
      proposedEndDate: "2026-08-31",
      timeOffBalances: [{ type: "vacation", balanceDays: 8 }],
      now: "2026-07-25",
    },
    employmentOver: { id: "emp_pl_001", country_code: "PL", start_date: "2022-01-10" },
  },
  {
    name: "F-28 one usable line and one unusable line -> no partial total in either copy",
    request: {
      proposedEndDate: "2026-09-15",
      timeOffBalances: [
        { timeOffType: "vacation", daysAccrued: 10, daysUsed: 2, hourlyRateInRemoteInteger: 5000 },
        { type: "sick", balanceDays: 3 },
      ],
    },
  },
  // -------------------------------------------------------------------------
  // The four items closed on 2026-09-02. Each of these exercises a code path
  // that exists in BOTH copies and in NEITHER before that date, which is the
  // class of change this file exists for: a drift here produces a Polish
  // leaving date that is right in the Node app and up to six days wrong in
  // production, or a Portuguese probationer told they owe 30 days on one
  // execution path and nothing on the other.
  // -------------------------------------------------------------------------
  {
    name: "PL two-week bracket lands on a SATURDAY (Kodeks pracy art. 30 \u00a72\u00b9), in both copies",
    request: {
      session: { authenticatedEmploymentId: "emp_pl_short" },
      reason: "new opportunity",
      now: "2026-09-02",
    },
    employmentOver: { id: "emp_pl_short", country_code: "PL", start_date: "2026-06-01" },
  },
  {
    name: "PL monthly bracket still lands on a month END, so the two anchors did not swap",
    request: {
      session: { authenticatedEmploymentId: "emp_pl_year" },
      now: "2026-09-02",
    },
    employmentOver: { id: "emp_pl_year", country_code: "PL", start_date: "2026-01-01" },
  },
  {
    name: "PT inside probation owes NOTHING (art. 114.\u00ba(1)) and produces no end date, in both copies",
    request: {
      session: { authenticatedEmploymentId: "emp_pt_probation" },
      now: "2026-09-02",
    },
    employmentOver: {
      id: "emp_pt_probation",
      country_code: "PT",
      start_date: "2026-07-01",
      probation_end_date: "2026-12-01",
    },
  },
  {
    name: "CA is a sourced absence with a Qu\u00e9bec variant — the extra flag must exist on both paths",
    request: {
      session: { authenticatedEmploymentId: "emp_ca_002" },
      now: "2026-09-02",
    },
    employmentOver: { id: "emp_ca_002", country_code: "CA", start_date: "2019-01-01" },
  },
  {
    name: "Remote's days_of_notice BELOW the statutory floor escalates identically on both paths",
    request: {
      session: { authenticatedEmploymentId: "emp_pt_reconcile" },
      now: "2026-09-02",
      remoteDaysOfNotice: 30,
      offboardingRequestId: "ofb_parity_1",
    },
    employmentOver: { id: "emp_pt_reconcile", country_code: "PT", start_date: "2020-01-01" },
  },
  {
    name: "Remote's days_of_notice ABOVE the floor is flagged and passes, identically on both paths",
    request: {
      session: { authenticatedEmploymentId: "emp_pt_reconcile" },
      now: "2026-09-02",
      remoteDaysOfNotice: 90,
      offboardingRequestId: "ofb_parity_2",
    },
    employmentOver: { id: "emp_pt_reconcile", country_code: "PT", start_date: "2020-01-01" },
  },
  {
    name: "a month-denominated statute is NOT compared with a day count, on either path",
    request: {
      session: { authenticatedEmploymentId: "emp_nl_reconcile" },
      now: "2026-09-02",
      remoteDaysOfNotice: 30,
    },
    employmentOver: { id: "emp_nl_reconcile", country_code: "NL", start_date: "2020-01-01" },
  },
];

for (const scenario of SCENARIOS) {
  test(`n8n Notice Period Gates match policyEngine \u2014 ${scenario.name}`, async () => {
    const request = requestFor({ ...scenario.request, ...(scenario.sessionOver ? { session: scenario.sessionOver } : {}) });
    const empResponse = employmentResponse(scenario.employmentOver ?? {});

    const fromN8n = runNoticePeriodGatesNode({ request, employmentResponse: empResponse });

    // The n8n node derives identity itself; the parity comparison should use
    // the SAME identity the n8n node derived, so the comparison isolates the
    // gates — not two different identity implementations disagreeing.
    const identityVerified = Boolean(
      request.session && fromN8n.employment && request.session.authenticatedEmploymentId === fromN8n.employment.id
    );

    // When the request carries an explicit proposedEndDate, that's what
    // policyEngine.evaluate() must be fed (it mirrors the Node workflow's
    // structured-input path, which overrides any LLM extraction). When it
    // doesn't, run the real rule-based extraction against the letter text —
    // the SAME function the node body itself runs.
    const effectiveProposedEndDate = fromN8n.extraction.proposedEndDate;

    const fromPolicyEngine = evaluate({
      identityVerified,
      employment: fromN8n.employment,
      proposedEndDate: effectiveProposedEndDate,
      timeOffBalances: request.timeOffBalances,
      // THE SAME RULE THE NODE BODY RUNS. workflow.js picks the currency before
      // calling evaluate() — stated, else Remote's compensation_currency_code,
      // else nothing — and the gates body does the same inline. Feeding
      // `request.currency` here would compare a null-currency evaluate() against
      // a body that read the employment record, and the scenario that proves
      // the n8n path stopped fabricating dollars would fail for the wrong reason.
      currency: payoutCurrencyFor({ stated: request.currency, employment: fromN8n.employment }),
      now: request.now,
      // Remote's own figure, when the scenario supplies one. Passed on BOTH
      // sides or the comparison would be between a reconciled result and an
      // unreconciled one, which would pass trivially and prove nothing.
      remoteDaysOfNotice: request.remoteDaysOfNotice ?? null,
      remoteRecordRef: request.offboardingRequestId ?? null,
    });

    assert.equal(fromN8n.decision, fromPolicyEngine.decision, "decision differs");
    assert.equal(fromN8n.reason, fromPolicyEngine.reason, "reason differs");
    assert.deepEqual(fromN8n.flags, fromPolicyEngine.flags, "flags differ");
    // Status is derived from the decision exactly the way the real
    // resignationStore.createResignation() derives it — see
    // src/uc05/resignationStore.js line 120: "status: decision === 'prepared_for_signoff' ? 'pending_signoff' : 'escalated'".
    const expectedStatus = fromN8n.decision === "prepared_for_signoff" ? "pending_signoff" : "escalated";
    assert.equal(fromN8n.status, expectedStatus, "status must be derived from the decision the same way the store does");

    // Notice parity: the calculator is a pure function; the n8n port must
    // match it byte-for-byte for every field that flows into the report.
    if (fromPolicyEngine.notice) {
      assert.equal(fromN8n.notice.countryCode, fromPolicyEngine.notice.countryCode, "notice.countryCode differs");
      assert.equal(fromN8n.notice.noticeDays, fromPolicyEngine.notice.noticeDays, "notice.noticeDays differs");
      assert.equal(fromN8n.notice.noticeEndDate, fromPolicyEngine.notice.noticeEndDate, "notice.noticeEndDate differs");
      assert.equal(fromN8n.notice.discrepancy, fromPolicyEngine.notice.discrepancy, "notice.discrepancy differs");
      assert.equal(fromN8n.notice.discrepancyDays, fromPolicyEngine.notice.discrepancyDays, "notice.discrepancyDays differs");
      assert.equal(fromN8n.notice.anchorAdjusted, fromPolicyEngine.notice.anchorAdjusted, "notice.anchorAdjusted differs");
      // The dates tenure was measured between travel on both copies (2026-09-02).
      assert.equal(fromN8n.notice.tenureMeasuredFrom, fromPolicyEngine.notice.tenureMeasuredFrom, "notice.tenureMeasuredFrom differs");
      assert.equal(fromN8n.notice.tenureMeasuredTo, fromPolicyEngine.notice.tenureMeasuredTo, "notice.tenureMeasuredTo differs");
      // Added 2026-08-20 with the NL/US rows. `statutoryMinimumExists` is the
      // three-valued field that keeps "no rule on file", "no statutory minimum"
      // and "no bracket for this tenure" apart; if the two copies disagreed on
      // it, one execution path would report the United States as an unsupported
      // country while the other reported it correctly, and every existing
      // assertion in this file would still pass. `noticeMonths` and
      // `noticeQuantity` are compared for the same reason one layer down: a
      // month-denominated rule has no statutory day count, so `noticeDays`
      // alone is null on BOTH sides and compares equal while the actual
      // quantity drifts.
      assert.equal(fromN8n.notice.statutoryMinimumExists, fromPolicyEngine.notice.statutoryMinimumExists, "notice.statutoryMinimumExists differs");
      assert.equal(fromN8n.notice.noticeMonths, fromPolicyEngine.notice.noticeMonths, "notice.noticeMonths differs");
      assert.equal(fromN8n.notice.noticeQuantity, fromPolicyEngine.notice.noticeQuantity, "notice.noticeQuantity differs");
      // Added 2026-09-02 with the probation exemption. `noStatutoryProbationNotice`
      // is what separates "the statute gives a probationer no notice period"
      // from the three absences beside it, and every one of those produces
      // `noticeEndDate: null` too — so without this field the two copies could
      // disagree about WHY a Portuguese probationer got no date while every
      // other assertion here passed.
      assert.equal(
        fromN8n.notice.noStatutoryProbationNotice,
        fromPolicyEngine.notice.noStatutoryProbationNotice,
        "notice.noStatutoryProbationNotice differs"
      );
      // And the field that keeps Canada from being described as the United
      // States. Both rows report `statutoryMinimumExists: false`; only one of
      // them has a province where the obligation is statutory.
      assert.equal(
        fromN8n.notice.noticeStandardWithoutNumber,
        fromPolicyEngine.notice.noticeStandardWithoutNumber,
        "notice.noticeStandardWithoutNumber differs"
      );
      // THE WHOLE RECONCILIATION BLOCK, deep-equal, including its prose — with
      // ONE field lifted out and checked separately, for a reason worth stating.
      //
      // Compared as an object rather than field by field on purpose: this block
      // is the one thing on the row that carries a SENTENCE a specialist reads
      // and acts on, and a paraphrase in the n8n copy would be invisible to any
      // verdict-level check while telling two different stories about the same
      // resignation on two execution paths.
      //
      // `statute.provenance` ends with the country row's own `sourceCitation`,
      // and the two TABLES have differed in punctuation since long before this
      // block existed — the n8n copies write "art. 400(1)" and an ASCII hyphen
      // where src writes "art. 400.º(1)" and an em dash. Deep-equalling it here
      // would turn this assertion into a check on that older, deliberate
      // divergence and would fail on every scenario in this file for a reason
      // that has nothing to do with the reconciliation. So the SHAPE of the
      // provenance is asserted instead: both sides make the same claim about
      // where their figure came from, and both name a statute.
      const strip = (block) => {
        if (!block) return block;
        const copy = JSON.parse(JSON.stringify(block));
        if (copy.statute) delete copy.statute.provenance;
        return copy;
      };
      assert.deepEqual(
        strip(fromN8n.notice.reconciliation),
        strip(fromPolicyEngine.notice.reconciliation),
        "notice.reconciliation differs — Remote's days_of_notice is described differently on the two paths"
      );
      if (fromPolicyEngine.notice.reconciliation) {
        const nodeProv = fromN8n.notice.reconciliation.statute.provenance;
        const srcProv = fromPolicyEngine.notice.reconciliation.statute.provenance;
        // The class statement is identical prose on both paths; only the
        // citation tail may differ.
        const lead = "This system's own statutory notice table, derived from the statute named beside it and from length of service alone. It has read no contract.";
        assert.ok(nodeProv.startsWith(lead), "the n8n copy no longer states where its figure came from");
        assert.ok(srcProv.startsWith(lead), "src no longer states where its figure came from");
        assert.equal(
          nodeProv.includes("Statute applied:"),
          srcProv.includes("Statute applied:"),
          "one path names a statute behind its figure and the other does not"
        );
      }
    }

    // Payout parity: ×100 scaling is the load-bearing invariant. A drift
    // here would either overpay or underpay by 100x.
    //
    // `computable` and `unusableLines` are compared too (F-33). A refusal that
    // exists in one copy and not the other reads identically on
    // totalInRemoteInteger alone whenever the other copy's answer happens to
    // be 0 — which is exactly the shape a coerced-to-zero defect produces. The
    // fields that say WHY have to be compared, or parity is blind to the one
    // difference that matters.
    if (fromPolicyEngine.payout) {
      assert.equal(fromN8n.payout.totalInRemoteInteger, fromPolicyEngine.payout.totalInRemoteInteger, "payout.totalInRemoteInteger differs");
      assert.equal(fromN8n.payout.source, fromPolicyEngine.payout.source, "payout.source differs");
      assert.equal(fromN8n.payout.computable, fromPolicyEngine.payout.computable, "payout.computable differs");
      assert.deepEqual(fromN8n.payout.unusableLines, fromPolicyEngine.payout.unusableLines, "payout.unusableLines differ");
      assert.deepEqual(fromN8n.payout.lines, fromPolicyEngine.payout.lines, "payout.lines differ");
    }

    // Extraction parity: when there's no explicit proposedEndDate/reason
    // (i.e. the node ran the rule-based extractor on letterText), the
    // n8n-side extraction must match what the real letterExtractor's
    // rule-based path would produce.
    // A TYPED DATE is what makes extraction unnecessary. A typed REASON alone
    // used to skip it too — in both copies — so a letter that stated its last
    // day beside a reason box was recorded as proposing no date (live ticket
    // 227, 2026-09-02). Now: no date typed → both copies extract from the
    // letter and a typed reason is merged in; date typed → structured_input.
    if (!request.proposedEndDate) {
      const realRuleBased = await extractFromLetter(
        { text: request.letterText || "" },
        { isConfigured: () => false }
      );
      assert.equal(fromN8n.extraction.proposedEndDate, realRuleBased.proposedEndDate, "extraction.proposedEndDate differs from real rule-based path");
      assert.equal(fromN8n.extraction.source, realRuleBased.source, "extraction.source differs from real rule-based path");
      if (request.reason != null) assert.equal(fromN8n.extraction.reason, request.reason, "a typed reason must survive extraction");
    } else {
      assert.equal(fromN8n.extraction.source, "structured_input", "a typed date must yield source 'structured_input'");
      assert.equal(fromN8n.extraction.proposedEndDate, request.proposedEndDate);
      assert.equal(fromN8n.extraction.reason, request.reason);
    }
  });
}

// ---------------------------------------------------------------------------
// IDENTITY MUST NEVER BE PROVED AGAINST AN ECHO OF THE CALLER'S OWN REQUEST
// ---------------------------------------------------------------------------
// The node builds its `employment` object from the "Fetch Employment (Remote)"
// response. When that response carried nothing usable — an error body, an
// outage page, a 200 in an unexpected shape, a node configured to continue on
// error — the node used to BACKFILL the record's `id` from
// `request.employmentId`, a caller-supplied value, and then verify identity by
// comparing `session.authenticatedEmploymentId` against it. A caller who sends
// the same string in both places therefore "verified" against itself, having
// proved nothing at all. That is prime directive #3 inverted ("identity comes
// from an authenticated signal, never a claim").
//
// It failed closed only by ACCIDENT: the very next gate
// (`employment.status !== 'active'`, reading the same synthesized record's
// `'unknown'` default) happened to catch the run. An identity control whose
// correctness depends on a downstream gate is not a control — so these tests
// assert the run stops at the IDENTITY gate specifically, not merely that it
// stops.
//
// The reference implementation has no such hole: RemoteClient.getEmployment()
// returns `null` on a 404, so src/uc05/workflow.js hands `null` to
// verifyRequester(), which answers `no_employment_record` and evaluate()'s
// gate 1 fires. These tests pin the node to that same behaviour and that same
// value.
const NO_USABLE_RECORD_FIXTURES = [
  // A 404 reached the node with no body at all (e.g. the HTTP node set to
  // continue on error, or an empty error branch).
  ["a 404 with no body", undefined],
  // A 200 with an empty body.
  ["an empty body", {}],
  // The gateway's real 404 payload, which is a body — not an absence.
  ["an error body", { message: "Employment not found" }],
  // A 200 whose envelope carries no employment record. This is the shape the
  // LIVE graph can actually reach the gates with, because a 404 hard-errors
  // the HTTP node before this one runs.
  ["a 200 in an unexpected shape", { data: { total_count: 4, custom_field_values: [] } }],
  // A record that came back without an id — nothing authoritative to match.
  ["a record with no id", { data: { employment: { status: "active", country_code: "GB", start_date: "2023-01-10" } } }],
];

for (const [label, employmentResponseFixture] of NO_USABLE_RECORD_FIXTURES) {
  test(`identity fails closed on ${label}, even when the session id matches the requested employmentId`, () => {
    const request = requestFor({
      employmentId: "emp_uk_001",
      // The attack shape: the caller controls BOTH sides of the comparison.
      session: { authenticatedEmploymentId: "emp_uk_001" },
      proposedEndDate: "2026-09-15",
      externalRef: "5901",
    });
    const out = runNoticePeriodGatesNode({ request, employmentResponse: employmentResponseFixture });

    // The value the reference implementation produces for "no record" is
    // literally `null` (RemoteClient.getEmployment()'s documented 404
    // convention), so no downstream reader can mistake a synthesis for an
    // authoritative record.
    assert.equal(out.employment, null, "a failed/unusable fetch must be no record — never a placeholder echoing the request");

    // And the IDENTITY gate must be the one that stops it. If this reads
    // `employee_not_active` the identity gate passed on a self-echoed claim
    // and a later gate compensated — the exact shape this codebase rejects.
    assert.equal(out.decision, "escalate");
    assert.equal(out.reason, "identity_not_verified", "the run must stop at the IDENTITY gate, not at the employment-status gate one step later");
    assert.deepEqual(out.flags, ["identity_not_verified"]);
    assert.equal(out.notice, null);
    assert.equal(out.payout, null);

    // Parity with the reference implementation's own answer for "no record".
    const fromPolicyEngine = evaluate({
      identityVerified: false,
      employment: null,
      proposedEndDate: request.proposedEndDate,
      timeOffBalances: request.timeOffBalances,
      currency: request.currency,
      now: request.now,
    });
    assert.equal(out.decision, fromPolicyEngine.decision);
    assert.equal(out.reason, fromPolicyEngine.reason);
    assert.deepEqual(out.flags, fromPolicyEngine.flags);
  });
}

test("the Zendesk email identity path also fails closed when no employment record came back", () => {
  // Without an authoritative record there is no authoritative email either, so
  // the second identity signal must fail closed for the same reason the first
  // does — and must not be rescued by anything the caller supplied.
  const out = runNoticePeriodGatesNode({
    request: requestFor({
      session: { authenticatedEmail: "alexandre@example.com" },
      proposedEndDate: "2026-09-15",
      externalRef: "5902",
    }),
    employmentResponse: { message: "Employment not found" },
  });
  assert.equal(out.employment, null);
  assert.equal(out.decision, "escalate");
  assert.equal(out.reason, "identity_not_verified");
});

test("the n8n node body parses and returns n8n's item shape", () => {
  const out = runNoticePeriodGatesNode({
    request: requestFor({ proposedEndDate: "2026-09-15" }),
    employmentResponse: employmentResponse(),
  });
  assert.equal(typeof out.decision, "string");
  assert.ok(Array.isArray(out.flags));
  assert.equal(out.status, "pending_signoff");
  assert.equal(out.riskTier, "medium"); // no flags, UC-05's base tier is medium
  assert.equal(out.notice.countryCode, "GB");
  // SEVEN, NOT TWENTY-ONE (corrected 2026-09-02). This fixture's employee has
  // ~37 months' service and used to land in the `37-48 months -> 21 days`
  // bracket — which was ERA 1996 s.86(1), the EMPLOYER'S sliding scale. s.86(2)
  // gives a resigning employee one week, flat, from one month's service and it
  // does not rise. D-41, legislation.gov.uk.
  assert.equal(out.notice.noticeDays, 7);
  assert.equal(out.notice.noticeEndDate, "2026-08-23");
});

test("any flag pushes riskTier from medium to high (UC-05 \ud83d\udfe1 -> high under flag)", () => {
  // Discrepancy earlier_than_statutory is a flag, so the risk tier moves up
  // even though UC-05 is base \ud83d\udfe1.
  const out = runNoticePeriodGatesNode({
    request: requestFor({
      session: { authenticatedEmploymentId: "emp_pl_001" },
      proposedEndDate: "2026-08-31",
      now: "2026-07-25",
    }),
    employmentResponse: employmentResponse({ id: "emp_pl_001", country_code: "PL", start_date: "2022-01-10" }),
  });
  assert.equal(out.decision, "escalate");
  assert.equal(out.riskTier, "high");
  assert.ok(out.flags.includes("discrepancy_earlier_than_statutory"));
});

// ---------------------------------------------------------------------------
// THE N8N PATH STOPPED FABRICATING DOLLARS — and both copies agree on what
// replaces them. Until 2026-09-02 the normalize node filled an absent currency
// with 'USD', the gates body did it again as `request.currency || 'USD'`, and
// reconcilePtoPayout() a third time in three places — so the fix that stopped
// the PORTAL denominating a Portuguese settlement in dollars (uc05PayoutCurrency
// .test.js) never reached a ticket-filed resignation. Every scenario above
// passes "USD" explicitly, which is why the drift was invisible here.
// ---------------------------------------------------------------------------

test("no currency anywhere, no balances: both copies carry null — not 'USD' — and 'no_time_off_records'", () => {
  const out = runNoticePeriodGatesNode({
    request: requestFor({ currency: undefined, timeOffBalances: [] }),
    employmentResponse: employmentResponse(),
  });
  assert.equal(out.payout.source, "no_time_off_records");
  assert.equal(out.payout.currency, null, "the n8n body padded an absent currency with 'USD'");
  const fromSrc = evaluate({
    identityVerified: true, employment: employmentResponse().data.employment,
    proposedEndDate: "2026-09-15", timeOffBalances: [], now: "2026-08-16",
  });
  assert.equal(fromSrc.payout.currency, null);
  assert.equal(fromSrc.payout.source, out.payout.source);
});

test("a balance line with no currency is REFUSED identically on both paths — 'currency' named as the missing field", () => {
  const line = [{ timeOffType: "vacation", daysAccrued: 10, daysUsed: 2, hourlyRateInRemoteInteger: 4800 }];
  const out = runNoticePeriodGatesNode({
    request: requestFor({ currency: undefined, timeOffBalances: line }),
    employmentResponse: employmentResponse(),
  });
  assert.equal(out.payout.computable, false, "the n8n body computed a total in a currency nobody stated");
  assert.equal(out.payout.totalInRemoteInteger, null);
  assert.ok(out.payout.unusableLines[0].missing.includes("currency"), JSON.stringify(out.payout.unusableLines));
  const fromSrc = evaluate({
    identityVerified: true, employment: employmentResponse().data.employment,
    proposedEndDate: "2026-09-15", timeOffBalances: line, now: "2026-08-16",
  });
  assert.deepEqual(fromSrc.payout.unusableLines[0].missing, out.payout.unusableLines[0].missing);
});

test("no currency on the request: both copies take Remote's own compensation_currency_code off the employment record", () => {
  const line = [{ timeOffType: "vacation", daysAccrued: 10, daysUsed: 2, hourlyRateInRemoteInteger: 4800 }];
  const emp = employmentResponse({ contract_details: { compensation_currency_code: "EUR" } });
  const out = runNoticePeriodGatesNode({
    request: requestFor({ currency: undefined, timeOffBalances: line }),
    employmentResponse: emp,
  });
  assert.equal(out.payout.computable, true);
  assert.equal(out.payout.currency, "EUR", "the n8n body never read the employment record's currency");
  assert.equal(out.payout.lines[0].currency, "EUR");
  const chosen = payoutCurrencyFor({ stated: undefined, employment: emp.data.employment });
  assert.equal(chosen, "EUR");
  // …and a STATED currency still wins over the record's, on both sides.
  const stated = runNoticePeriodGatesNode({
    request: requestFor({ currency: "gbp", timeOffBalances: line }),
    employmentResponse: emp,
  });
  assert.equal(stated.payout.currency, "GBP", "normalised, and the caller's word over the record's");
  assert.equal(payoutCurrencyFor({ stated: "gbp", employment: emp.data.employment }), "GBP");
});

// ---------------------------------------------------------------------------
// THE TWO NORMALISERS AGREE ON WHERE A START DATE COMES FROM. Every scenario
// above hands the node a record with a top-level `start_date`, which the real
// Sandbox never sends — it sends `provisional_start_date`. The node read only
// `start_date` / `basic_information.start_date`, i.e. the stand-in's enriched
// shape (filled for two hard-coded ids), so two real Portuguese employees
// escalated `missing_seniority_date` on the graph (executions 11936, 11939)
// while the src path processed them. The harness feeds evaluate() the NODE's
// normalised record, so gate parity could never see it; this compares the
// normalisers directly.
// ---------------------------------------------------------------------------

test("start-date precedence: the node's normaliser and normalizeEmployment() agree on every real shape", () => {
  const shapes = {
    "gateway: top-level provisional_start_date, basic_information without a date (the real Sandbox shape)":
      { id: "emp_pt", status: "active", type: "contractor", provisional_start_date: "2023-06-26", basic_information: { name: "Inês Carvalho" }, country: { alpha_2_code: "PT" } },
    "basic_information.provisional_start_date only":
      { id: "emp_a", status: "active", employment_model: "eor", basic_information: { provisional_start_date: "2022-03-01" }, country: { alpha_2_code: "NL" } },
    "basic_information.seniority_date only":
      { id: "emp_b", status: "active", employment_model: "eor", basic_information: { seniority_date: "2021-01-15" }, country: { alpha_2_code: "NL" } },
    "stand-in enriched: basic_information.start_date AND provisional_start_date":
      { id: "emp_c", status: "active", type: "employee", provisional_start_date: "2023-06-26", basic_information: { start_date: "2023-06-26" }, country: { alpha_2_code: "US" } },
    "no date anywhere":
      { id: "emp_d", status: "active", type: "employee", basic_information: { name: "Nobody" }, country: { alpha_2_code: "NL" } },
  };
  for (const [label, raw] of Object.entries(shapes)) {
    const out = runNoticePeriodGatesNode({
      request: requestFor({ employmentId: raw.id, session: { authenticatedEmploymentId: raw.id }, proposedEndDate: "2026-12-31" }),
      employmentResponse: { data: { employment: raw } },
    });
    const expected = normalizeEmployment(raw).start_date;
    assert.equal(out.employment.start_date, expected, label);
    if (expected === null) {
      assert.equal(out.reason, "missing_seniority_date", label + " — nothing to compute tenure from");
    } else {
      assert.notEqual(out.reason, "missing_seniority_date", label + " — the node refused a record that carries a start date");
    }
  }
});

test("a typed reason no longer silences the letter: the last day stated in prose reaches the comparison, in both copies", () => {
  const letter = "I am resigning for a new opportunity. My last working day will be 30 November 2026.";
  const out = runNoticePeriodGatesNode({
    request: requestFor({ proposedEndDate: null, reason: "new opportunity", letterText: letter }),
    employmentResponse: employmentResponse(),
  });
  assert.equal(out.extraction.proposedEndDate, "2026-11-30", "the n8n copy discarded the letter's date because a reason was typed");
  assert.equal(out.extraction.reason, "new opportunity", "the typed reason must be kept beside the extracted date");
  assert.notEqual(out.extraction.source, "structured_input", "nothing structured supplied the date");
  assert.equal(out.notice.proposedEndDate, "2026-11-30");
  // …and with NO letter and only a reason, there is honestly no date.
  const bare = runNoticePeriodGatesNode({
    request: requestFor({ proposedEndDate: null, reason: "new opportunity", letterText: "" }),
    employmentResponse: employmentResponse(),
  });
  assert.equal(bare.extraction.proposedEndDate, null);
  assert.equal(bare.extraction.reason, "new opportunity");
});

test("empty balances returns a zero payout honestly tagged, never guesses", () => {
  const out = runNoticePeriodGatesNode({
    request: requestFor({ proposedEndDate: "2026-09-15" }),
    employmentResponse: employmentResponse(),
  });
  assert.equal(out.payout.totalInRemoteInteger, 0);
  assert.equal(out.payout.source, "no_time_off_records");
  assert.deepEqual(out.payout.lines, []);
});

// ---------------------------------------------------------------------------
// The two "no statutory end date" branches must be told apart — in BOTH copies.
// ---------------------------------------------------------------------------
// computeNoticePeriod() can return `noticeEndDate: null` for two unrelated
// reasons: the country is not in the 9-country table, or the country IS in it
// but no bracket covers this employee's tenure (GB's lowest bracket starts at
// 1 month, so a three-week UK employee lands here). Both used to report
// `unsupported_country`, which is a false statement about the United Kingdom,
// and both used to report `discrepancy: "no_proposed_date"` even when the
// employee HAD proposed a date — a result object contradicting itself.
//
// `noticeRuleFound` is the field that separates them, and `not_comparable` is
// the honest discrepancy value when the employee DID name a date and there is
// no statutory end to measure it against (`no_proposed_date` keeps its literal
// meaning: they named none). Both live in the real calculator and in this node
// body, so the parity assertions above still compare like with like.
//
// Merge note (2026-08-19): this branch and trunk found the same defect
// independently and fixed it the same way, down to the `noticeRuleFound` name.
// Resolved to trunk's implementation, which is the stronger of the two — it
// splits the unmeasurable case in half (`not_comparable` vs `no_proposed_date`)
// where this branch collapsed both into one `not_computed`, and it carries
// `tenure_months_N` on the bracket branch, which is the number a human needs.
// These tests were kept and re-pointed at those strings.
// ---------------------------------------------------------------------------

/** The real function's verdict for the same inputs — the parity reference. */
const realVerdict = ({ employment, proposedEndDate = null, now = "2026-08-16" }) =>
  JSON.parse(
    JSON.stringify(
      evaluate({ identityVerified: true, employment, proposedEndDate, timeOffBalances: [], currency: "USD", now })
    )
  );

test("country outside the table -> unsupported_country, and the discrepancy does not claim a missing date", () => {
  const employment = { id: "emp_ch_001", status: "active", country_code: "CH", start_date: "2020-01-01", probation_end_date: null };
  const out = runNoticePeriodGatesNode({
    request: requestFor({ session: { authenticatedEmploymentId: "emp_ch_001" }, employmentId: "emp_ch_001", proposedEndDate: "2026-09-01" }),
    employmentResponse: employmentResponse(employment),
  });
  const real = realVerdict({ employment, proposedEndDate: "2026-09-01" });

  assert.equal(out.reason, real.reason);
  assert.equal(out.reason, "unsupported_country");
  assert.equal(out.notice.noticeRuleFound, false);
  assert.equal(out.notice.noticeRuleFound, real.notice.noticeRuleFound);
  // The self-contradiction this replaced: proposedEndDate present AND
  // discrepancy: "no_proposed_date", in the same object.
  assert.equal(out.notice.proposedEndDate, "2026-09-01");
  assert.equal(out.notice.discrepancy, "not_comparable");
  assert.equal(out.notice.discrepancy, real.notice.discrepancy);
});

test("the unmeasurable case splits in two: a stated date is not_comparable, no date is no_proposed_date", () => {
  // Same country, same everything, one input different. The whole point of
  // splitting the label is that these two employees are not in the same
  // situation and the record must not say they are.
  const employment = { id: "emp_ch_001", status: "active", country_code: "CH", start_date: "2020-01-01", probation_end_date: null };
  const req = (over) => requestFor({ session: { authenticatedEmploymentId: "emp_ch_001" }, employmentId: "emp_ch_001", ...over });

  const stated = runNoticePeriodGatesNode({ request: req({ proposedEndDate: "2026-09-01" }), employmentResponse: employmentResponse(employment) });
  const silent = runNoticePeriodGatesNode({ request: req({ proposedEndDate: null, reason: null }), employmentResponse: employmentResponse(employment) });

  assert.equal(stated.notice.discrepancy, "not_comparable");
  assert.equal(silent.notice.discrepancy, "no_proposed_date");
  assert.equal(stated.notice.discrepancy, realVerdict({ employment, proposedEndDate: "2026-09-01" }).notice.discrepancy);
  assert.equal(silent.notice.discrepancy, realVerdict({ employment }).notice.discrepancy);
});

test("country IS supported but no bracket covers the tenure -> no_matching_notice_bracket, not unsupported_country", () => {
  // A UK employee three weeks into the job. GB's lowest bracket starts at one
  // month of service, so no statutory notice figure exists yet — which is a
  // fact about this employee, not about the United Kingdom.
  const employment = { id: "emp_uk_001", status: "active", country_code: "GB", start_date: "2026-08-01", probation_end_date: null };
  const out = runNoticePeriodGatesNode({
    request: requestFor({ proposedEndDate: "2026-09-01" }),
    employmentResponse: employmentResponse(employment),
  });
  const real = realVerdict({ employment, proposedEndDate: "2026-09-01" });

  assert.equal(out.decision, "escalate");
  assert.equal(out.reason, real.reason);
  assert.equal(out.reason, "no_matching_notice_bracket");
  assert.notEqual(out.reason, "unsupported_country", "a supported country must never be reported as unsupported");
  assert.ok(out.flags.includes("no_matching_notice_bracket"));
  assert.ok(out.flags.includes("country_GB"));
  assert.equal(out.notice.noticeRuleFound, true, "GB's rule WAS found; only the bracket was missing");
  assert.deepEqual(out.flags, real.flags);
});

test("POSITIVE: a supported country with matching tenure MUST reach prepared_for_signoff with a real end date", () => {
  // The check that a refusal suite cannot make. Every test above is a
  // refusal, and a gate that structurally cannot succeed looks exactly like
  // one refusing correctly from the outside — only demanding success tells
  // them apart. This one also pins that `no_proposed_date` still means what it
  // says: a statutory end date WAS computed, the employee just named no date.
  const employment = { id: "emp_uk_001", status: "active", country_code: "GB", start_date: "2023-01-10", probation_end_date: null };
  const out = runNoticePeriodGatesNode({
    request: requestFor({ proposedEndDate: null, reason: null }),
    employmentResponse: employmentResponse(employment),
  });
  const real = realVerdict({ employment });

  assert.equal(out.decision, "prepared_for_signoff");
  assert.equal(out.decision, real.decision);
  assert.equal(out.reason, "all_gates_passed");
  assert.equal(out.notice.noticeRuleFound, true);
  assert.equal(out.notice.noticeEndDate, real.notice.noticeEndDate);
  assert.ok(out.notice.noticeEndDate, "a supported country with matching tenure must produce a date, not null");
  assert.equal(out.notice.discrepancy, "no_proposed_date", "no date proposed, but one WAS computed to compare against");
  assert.equal(out.notice.discrepancy, real.notice.discrepancy);
  assert.equal(out.status, "pending_signoff");
});

test("POSITIVE: every country in the 9-country table can still reach a signed-off-able report", () => {
  // The strongest form of the same check: no country in the table may be
  // structurally incapable of producing a statutory end date. A typo in one
  // country's brackets or anchor rule would otherwise surface only as a
  // permanently-escalating country nobody notices.
  // CANADA IS DELIBERATELY NOT IN THIS LIST since 2026-09-02, and the US never
  // was. Both are covered by a SOURCED FINDING that no statutory minimum binds
  // a resigning employee, so neither can produce a statutory end date and
  // neither should — CONTRADICTIONS.md C-30, and the assertion directly below.
  // The check this test exists for is unchanged for every row that DOES hold a
  // statutory rule: none of them may be structurally incapable of computing.
  const countries = ["GB", "IE", "DE", "PL", "IN", "PH", "MX", "PT"];
  for (const country_code of countries) {
    const employment = { id: "emp_x", status: "active", country_code, start_date: "2018-01-10", probation_end_date: null };
    const out = runNoticePeriodGatesNode({
      request: requestFor({ session: { authenticatedEmploymentId: "emp_x" }, employmentId: "emp_x" }),
      employmentResponse: employmentResponse(employment),
    });
    assert.equal(out.decision, "prepared_for_signoff", `${country_code} could not reach prepared_for_signoff`);
    assert.ok(out.notice.noticeEndDate, `${country_code} produced no statutory end date`);
    assert.equal(out.notice.noticeRuleFound, true);
    assert.equal(out.notice.discrepancy, "no_proposed_date");
  }

  // THE OTHER HALF, so removing a country from the list above can never be the
  // way this test is made to pass. A sourced absence must escalate for its OWN
  // reason — not `unsupported_country`, which means "a gap in our table" and
  // goes to a different desk.
  for (const country_code of ["CA", "US"]) {
    const employment = { id: "emp_x", status: "active", country_code, start_date: "2018-01-10", probation_end_date: null };
    const out = runNoticePeriodGatesNode({
      request: requestFor({ session: { authenticatedEmploymentId: "emp_x" }, employmentId: "emp_x" }),
      employmentResponse: employmentResponse(employment),
    });
    assert.equal(out.decision, "escalate", `${country_code} produced a signable report from a country with no statutory rule`);
    assert.equal(out.reason, "no_statutory_notice_period", `${country_code} escalated for the wrong reason`);
    assert.equal(out.notice.noticeEndDate, null, `${country_code} computed a date it has no rule for`);
  }
});

test("n8n Code node body is syntactically valid", () => {
  // Same guard as every other parity test in this repo — a Code node body
  // is just a string to n8n, so a broken one deploys happily and only
  // fails mid-execution. Compiling the file here turns that into a
  // failing test instead. `new Function` is used rather than import
  // because these bodies end in a bare `return`, which is only legal
  // inside a function — exactly how n8n wraps them.
  const src = readFileSync(GATES_PATH, "utf8");
  assert.doesNotThrow(() => new Function(src), `noticePeriodGates.js does not compile`);
});

// ---------------------------------------------------------------------------
// THE ALPHA-3 DEFECT (finding F-27) — the country code that selects the
// statutory notice rule
// ---------------------------------------------------------------------------
// `getNoticeRule(countryCode)` is a lookup into a 9-country table keyed on the
// ALPHA-2 form ("DE", "GB", "PT"). The live API nests
// `country: {code: "DEU", alpha_2_code: "DE"}` — `code` is ALPHA-3, and there
// is no top-level `country_code` on the record at all. This node's old chain
// (`country_code ?? basic_information.country_code ?? country.alpha_2_code ??
// country.code`) had a written-down path that placed "DEU" into that key, and a
// "DEU" lookup misses every row in the table. Nothing crashes: the run simply
// escalates `unsupported_country` forever, which is indistinguishable from the
// gate working correctly. Only a POSITIVE test — "this German employee MUST get
// the BGB §622 rule" — detects that, which is what the first test below is.
//
// Fixtures are REAL Sandbox records copied verbatim
// (test/fixtures/remoteEmployment.js), never a synthetic flat
// `{country_code: "DE"}` object that agrees with the code rather than the API.
import {
  LIVE_EMPLOYMENT_DE,
  LIVE_EMPLOYMENT_CA,
  withoutAlpha2,
} from "./fixtures/remoteEmployment.js";

/**
 * UC-05's graph reads employments through the Sandbox stand-in
 * (`your-sandbox-standin.vercel.app`, CLAUDE.md §6), which fills ONLY fields
 * the real Sandbox left null — `basic_information.start_date` among them, since
 * without it UC-05 cannot compute tenure at all and escalates every time.
 *
 * The value used here is NOT invented: it is the same real record's own
 * `provisional_start_date`, moved to the key this node reads. Nothing else on
 * the record is touched.
 */
const asStandinServesIt = (record) => ({
  ...record,
  basic_information: { ...record.basic_information, start_date: record.provisional_start_date },
});

const liveEmploymentResponse = (record) => ({ data: { employment: record } });

/** A request whose session matches the REAL record's real id. */
const requestForLiveRecord = (record, over = {}) =>
  requestFor({
    employmentId: record.id,
    session: { authenticatedEmploymentId: record.id },
    ...over,
  });

test("POSITIVE: a real German employment selects the BGB §622 rule — 28 days with the month_15 anchor", () => {
  const record = asStandinServesIt(LIVE_EMPLOYMENT_DE);
  assert.equal(record.country.code, "DEU", "fixture guard: the live record really does carry the alpha-3 form");
  assert.equal(record.country_code, undefined, "fixture guard: there is no top-level country_code on a live record");

  const out = runNoticePeriodGatesNode({
    request: requestForLiveRecord(record, { proposedEndDate: "2026-09-15", now: "2026-08-17" }),
    employmentResponse: liveEmploymentResponse(record),
  });

  // The load-bearing assertion: "DE" selected a real row in the table.
  assert.equal(out.employment.country_code, "DE");
  assert.notEqual(out.employment.country_code, "DEU");

  // And the run reaches a real statutory answer rather than escalating.
  assert.equal(out.notice.countryCode, "DE");
  assert.equal(out.notice.noticeDays, 28);
  assert.equal(out.notice.noticeEndDate, "2026-09-15"); // 2026-08-17 + 28d = 09-14, anchored to the 15th
  assert.equal(out.notice.anchorAdjusted, true);
  assert.match(out.notice.sourceCitation, /BGB/);
  assert.equal(out.decision, "prepared_for_signoff");
  assert.equal(out.reason, "all_gates_passed");
  assert.notEqual(out.reason, "unsupported_country");

  // Parity: the reference implementation, fed the SAME real record through the
  // real normalizeEmployment(), resolves the same code.
  assert.equal(normalizeEmployment(record).country_code, "DE");

  // …and the real policy engine agrees on the whole answer.
  const fromPolicyEngine = evaluate({
    identityVerified: true,
    employment: out.employment,
    proposedEndDate: "2026-09-15",
    timeOffBalances: [],
    currency: "USD",
    now: "2026-08-17",
  });
  assert.equal(out.decision, fromPolicyEngine.decision);
  assert.equal(out.notice.noticeEndDate, fromPolicyEngine.notice.noticeEndDate);
});

test("a real Canadian employment resolves 'CA' and gets the customary-notice row, not 'CAN'", () => {
  const record = asStandinServesIt(LIVE_EMPLOYMENT_CA);
  const out = runNoticePeriodGatesNode({
    request: requestForLiveRecord(record, { proposedEndDate: "2026-09-15", now: "2026-08-17" }),
    employmentResponse: liveEmploymentResponse(record),
  });
  assert.equal(out.employment.country_code, "CA");
  assert.equal(out.notice.countryCode, "CA");
  // NO NOTICE DAYS, AND THAT IS THE POINT (corrected 2026-09-02). This asserted
  // `noticeDays: 14` from the invented customary bracket. What this test is
  // really about is the alpha-2/alpha-3 resolution — that a live Canadian
  // record resolves to "CA" and not "CAN" — and that half is untouched and
  // still asserted above. The notice half now checks the sourced absence.
  assert.equal(out.notice.noticeDays, null);
  assert.equal(out.decision, "escalate");
  assert.equal(out.reason, "no_statutory_notice_period");
  assert.equal(normalizeEmployment(record).country_code, "CA");
});

test("FAIL CLOSED: an alpha-3-only record yields null, and a null country escalates unsupported_country", () => {
  // The same real German record with `country.alpha_2_code` deleted and nothing
  // else changed. "DEU" cannot be looked up, so the node must yield null rather
  // than a wrong string — and a country we cannot confirm must escalate, never
  // silently pick a rule or widen anything.
  const record = withoutAlpha2(asStandinServesIt(LIVE_EMPLOYMENT_DE));
  const out = runNoticePeriodGatesNode({
    request: requestForLiveRecord(record, { proposedEndDate: "2026-09-15", now: "2026-08-17" }),
    employmentResponse: liveEmploymentResponse(record),
  });

  assert.equal(out.employment.country_code, null, "an alpha-3-only record must yield null, never 'DEU'");
  assert.equal(out.decision, "escalate");
  assert.equal(out.reason, "unsupported_country");
  assert.ok(out.flags.includes("unsupported_country"));
  assert.equal(out.notice.noticeEndDate, null, "no statutory answer may be produced for an unconfirmed country");
  assert.equal(out.status, "escalated");
  assert.equal(normalizeEmployment(record).country_code, null);

  // Parity with the reference implementation's own answer for the same record.
  const fromPolicyEngine = evaluate({
    identityVerified: true,
    employment: out.employment,
    proposedEndDate: "2026-09-15",
    timeOffBalances: [],
    currency: "USD",
    now: "2026-08-17",
  });
  assert.equal(out.decision, fromPolicyEngine.decision);
  assert.equal(out.reason, fromPolicyEngine.reason);
});

test("a lowercase or padded alpha-2 code is canonicalised, not rejected", () => {
  // getNoticeRule() upper-cases its argument, so " de " would have worked here
  // by luck. It must be canonicalised at the CONSTRUCTION SITE anyway, because
  // the same field is compared case-sensitively elsewhere in this repo — the
  // reason src/shared/countryCodes.js exists at all (finding F-13).
  const base = asStandinServesIt(LIVE_EMPLOYMENT_DE);
  const record = { ...base, country: { ...base.country, alpha_2_code: " de " } };
  const out = runNoticePeriodGatesNode({
    request: requestForLiveRecord(record, { proposedEndDate: "2026-09-15", now: "2026-08-17" }),
    employmentResponse: liveEmploymentResponse(record),
  });
  assert.equal(out.employment.country_code, "DE");
  assert.equal(out.notice.noticeDays, 28);
});
