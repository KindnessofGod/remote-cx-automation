// ---------------------------------------------------------------------------
// decisionFacts.js  —  What HR Ops is actually signing off on
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
//
// C-27 / pattern P7 (docs/CORRECTIONS-LOG.md), generalised to the 🟡 tier. In
// UC-02 the sentence was "above the policy cap" while the system held the
// amount, the cap, the overage and the percentage. In UC-05 the sentence is
// `statutory_discrepancy`, and the system holds the proposed last working day,
// the statutory one, the shortfall in days, the country's own rule, the statute
// that sets it, the employee's tenure, and — separately — a money figure. Every
// one of those is on the row already. None of them reached the surface.
//
// WHAT MAKES UC-05 DIFFERENT FROM UC-04, and why this needed its own file: HR
// Ops is not weighing a risk, they are CHECKING AN ARITHMETIC RESULT before
// putting their name to it. Signing off is the entire execution of UC-05 — the
// signed report IS the durable artifact, there is no Remote write behind it
// (UC-05.md §1, workflow.js's header). So the facts they need are the
// derivation, not a risk profile: which rule, from which statute, over which
// tenure, producing which date, compared against which proposal, and what money
// is attached.
//
// PURE, AND IT DECIDES NOTHING. Same contract as describeDecidingGate() /
// describeGateLadder() beside it, and as UC-04's decisionFacts.js: it describes
// a decision already made and already stored. No gate reads it.
//
// TWO THINGS IT MUST NEVER DO, both learned expensively in this file's
// neighbours:
//
//   1. RENDER MONEY RAW. `payout.totalInRemoteInteger` is Remote's ×100 integer
//      form. Printing 384615 to a person about to authorise a final payment is a
//      100× error in the one direction nobody catches by eye. Every money value
//      leaves here through formatMoney() and never as a bare number, and the
//      currency is always named beside it.
//
//   2. RENDER `notice.noticeDays` WHEN THERE IS NO NOTICE END DATE. On the
//      unsupported-country path the calculator returns `noticeDays: 0` and says
//      so in its own comment: "STILL 0, AND STILL WRONG ... it stays because the
//      n8n port returns 0 here too and test/n8nUc05Parity.test.js compares this
//      exact field. Until they move together, nothing RENDERS the number: every
//      consumer keys off `noticeEndDate === null`." This file is a new consumer,
//      so it keys off the same thing. "We hold no rule for this country" is not
//      "this employee owes no notice", and 0 is the most dangerous default a
//      reader could act on.
//
//   2b. RENDER A DAY COUNT FOR A RULE THE STATUTE STATES IN MONTHS. The NL row
//      (BW art. 7:672(4), "één maand") carries `noticeMonths: 1` and
//      `noticeDays: null`, because there is no statutory day figure to state and
//      30 is not it. Prose reads `noticeQuantity` — "1 month", "30 days" — which
//      is one path for every row rather than a Dutch special case.
//
// A THIRD, SOFTER ONE: an empty PTO balance list yields `totalInRemoteInteger:
// 0` with `source: "no_time_off_records"`. That zero is honest arithmetic over
// an empty list and dishonest as a statement about the employee — nobody read
// Remote's time-off records; the request carried none. It is reported as
// "no records were supplied", never as a payout of zero.
// ---------------------------------------------------------------------------

import { formatMoney } from "../shared/money.js";
// THE TEAM NAME IS READ, NEVER TYPED. This file used to tell the reader of a
// notice shortfall that "Local HR Legal decides how the shortfall is handled".
// No team of that name existed in src/shared/escalationRouting.js, in the
// Zendesk groups, or in the setup script — every UC-05 escalation went to HR
// Ops. The screen and the routing were two sources of truth for one fact and
// they had already drifted. There is one now.
import { escalationTeamFor } from "../shared/escalationRouting.js";
// THE STATUTE BEHIND THE NUMBER, where this repository actually holds it. A
// hand-curated map from finding + country to a vendored document — no
// retrieval, no ranking, no nearest match. See src/uc05/decisionSources.js's
// header for the whole argument; the short version is that "23 days short" is
// arithmetic and Código do Trabalho art. 401.º is what makes it a decision
// somebody can take.
import { sourcesForFinding, uncitedFinding, shortfallHandlings } from "./decisionSources.js";

/**
 * Who a UC-05 escalation is addressed to, from the routing table.
 * A missing route prints a sentence naming the gap rather than a team.
 */
const ESCALATION_TEAM =
  escalationTeamFor("UC-05") ??
  "The team that owns UC-05 escalations (none is defined in src/shared/escalationRouting.js, which is itself the finding)";

/** The one human this file is written for. */
export const DECIDER = Object.freeze({
  role: "hr_ops",
  label: "HR Ops",
  decides:
    "whether this notice-period and PTO-payout calculation is right, and can be signed. Signing records the report — it files nothing with Remote and terminates nobody.",
});

const isRealNumber = (v) => typeof v === "number" && Number.isFinite(v);
const isMoneyInteger = (v) => Number.isInteger(v);

/**
 * The reading list for a set of findings in one country, plus the same
 * statement in the other direction for the findings we hold nothing for.
 *
 * BOTH HALVES ARE RENDERED. A citation block that only ever appears where a
 * citation exists teaches a reader that everything unmarked is unsourced-but-
 * fine, and eight of the nine countries in the notice table are unmarked. The
 * uncited entry says which country, and says plainly that the number applied
 * rests on a citation string nothing in this repository has checked.
 *
 * @param {string[]} findingKeys  in the order they should read
 * @param {string|null} country   ISO alpha-2 from the notice result
 */
function readingList(findingKeys, country) {
  const cited = [];
  const uncited = [];
  const seenUncited = new Set();
  for (const key of findingKeys) {
    const block = sourcesForFinding(key, country);
    if (block) {
      cited.push(block);
      continue;
    }
    const absent = uncitedFinding(key, country);
    // One "we hold no statute for this country" sentence, not one per finding —
    // it is the same fact each time and repeating it buries the findings.
    if (absent && !seenUncited.has(absent.why)) {
      seenUncited.add(absent.why);
      uncited.push(absent);
    }
  }
  return { sources: cited, uncited };
}

/**
 * How the statutory notice end date was arrived at.
 *
 * `stated: false` is the honest shape whenever no end date was produced — the
 * two escalations that reach it (`unsupported_country`, `no_matching_notice_bracket`)
 * are opposite findings that used to be reported identically, so this says which
 * one and what it means for the reader's next move.
 */
function noticeBasis(notice) {
  if (!notice) {
    return {
      stated: false,
      country: null,
      why: "No notice period was calculated at all — the request was refused before the calculator ran (identity, employment status, or a missing start date).",
      sentence: "No statutory notice figure exists for this request.",
    };
  }

  const country = notice.countryCode || null;
  const citation = notice.sourceCitation ?? null;
  const tenureMonths = isRealNumber(notice.tenureMonths) ? notice.tenureMonths : null;
  const shared = {
    country,
    // The statute, not just the country. "Employment Rights Act 1996 §86" is
    // what makes the number checkable by the person signing; "GB" is not.
    rule: citation,
    basis: notice.basis ?? null,
    tenureMonths,
    onProbation: notice.onProbation === true,
    ruleFound: notice.noticeRuleFound === true,
  };

  if (!notice.noticeEndDate) {
    // THE SOURCED-ABSENCE CASE, FIRST, because both branches below are trivially
    // true of it and would each describe it wrongly. `statutoryMinimumExists ===
    // false` means the table DOES cover this country and what it holds is the
    // finding that no statutory notice binds a resigning employee. Saying "not
    // in our table" (the else-branch) is false; saying "no bracket covers this
    // tenure" (the if-branch) implies a ladder exists that this person fell off.
    //
    // The sentence has one job beyond accuracy: it must not read as "no notice
    // is owed". The statute being silent and the contract being silent are
    // different facts, and this system has only checked the first.
    if (notice.statutoryMinimumExists === false) {
      return {
        ...shared,
        ...readingList(["no_statutory_notice_period"], country),
        stated: false,
        why:
          `${country || "This employee's country"} sets no statutory minimum notice period on a resigning employee, so there is no statutory date to calculate — this is a finding about the law, not a gap in this system's table. ` +
          `What notice is owed comes from ${tenureMonths === null ? "the employee's contract" : `the employee's contract (they have ${tenureMonths} months of service)`}, and this system does not hold contracts and has not read one.`,
        sentence:
          "No statutory notice period applies. This is NOT a finding that no notice is owed — the contract or policy may require notice, and nothing here has looked at it.",
      };
    }
    // DELIBERATELY NO `noticeDays` HERE. See this file's header, rule 2.
    const ruleFound = notice.noticeRuleFound === true;
    return {
      ...shared,
      // `unsupported_country` is a statement about OUR table and gets the
      // uncited treatment; `no_matching_notice_bracket` is a statement about a
      // country we do hold a rule for, and where we hold its statute too the
      // statute is what explains the gap (PT probation can run to 240 days
      // while the bracket stops at five months).
      ...readingList(ruleFound ? ["no_matching_notice_bracket"] : ["unsupported_country"], country),
      stated: false,
      why: ruleFound
        ? `This system does hold ${country || "this country"}'s statutory notice rules, but none of its brackets covers ${tenureMonths === null ? "this employee's tenure" : `${tenureMonths} months of service`} — so no notice period was produced. Somebody has to confirm what is owed at that length of service; the country is not the problem.`
        : `${country || "This employee's country"} is not one of the countries whose statutory notice rules this system holds, so no notice period was produced. That is a gap in our own table and says nothing about what that country's law requires.`,
      sentence: "No statutory notice end date was produced, so there is no calculated date to check.",
    };
  }

  return {
    ...shared,
    // THE "RULE APPLIED" LINE, WITH THE RULE ATTACHED. `sourceCitation` is a
    // short string with no URL, no version and no retrieved-on date; where this
    // repository holds the statute behind it, the document travels beside it,
    // and where it does not, that is said rather than left to be assumed.
    ...readingList(
      notice.onProbation === true ? ["statutory_notice_rule", "notice_during_probation"] : ["statutory_notice_rule"],
      country
    ),
    stated: true,
    noticeDays: isRealNumber(notice.noticeDays) ? notice.noticeDays : null,
    // THE QUANTITY THE STATUTE ACTUALLY STATES, in its own unit. BW art. 7:672(4)
    // says "één maand" and there is no statutory day count to print for it —
    // `noticeDays` is null on that row for exactly that reason, so prose that
    // interpolated it would read "null days' notice". Every day-denominated row
    // gets the identical treatment ("30 days"), so this is one code path and not
    // a Dutch special case.
    noticeQuantity: notice.noticeQuantity ?? (isRealNumber(notice.noticeDays) ? `${notice.noticeDays} days` : null),
    noticeMonths: isRealNumber(notice.noticeMonths) ? notice.noticeMonths : null,
    noticeStartDate: notice.noticeStartDate ?? null,
    noticeEndDate: notice.noticeEndDate,
    // A date moved by a country's own termination-date rule is a date the reader
    // will otherwise try to reproduce by adding days and fail to. BGB §622 snaps
    // to the 15th or month end; the Polish rule to the 1st of the following
    // month. Saying so is the difference between "this is wrong" and "this is
    // why it is not start + N".
    anchorAdjusted: notice.anchorAdjusted === true,
    sentence:
      `${notice.noticeQuantity ?? `${notice.noticeDays} days`}' notice under ${citation ?? "the country's rule"}, running ${notice.noticeStartDate ?? "from the day after submission"} to ${notice.noticeEndDate}` +
      (tenureMonths === null ? "" : `, on ${tenureMonths} months of service`) +
      (notice.onProbation === true ? ", inside the probation period" : "") +
      (notice.anchorAdjusted === true
        ? ". The end date was moved by that country's own permitted-termination-date rule, so it is not simply the start date plus the notice days."
        : "."),
  };
}

/**
 * The proposed last working day beside the statutory one, with the gap measured.
 *
 * THIS IS THE C-27 SHAPE ITSELF. `statutory_discrepancy` was the whole message,
 * and the two dates and the number of days between them were all sitting on
 * `notice`. Returns null only when the calculation never produced a statutory
 * date to compare against — never a zero, and never a one-sided comparison.
 */
function discrepancyBasis(notice) {
  if (!notice || !notice.noticeEndDate) return null;
  const proposed = notice.proposedEndDate ?? null;
  const statutory = notice.noticeEndDate;
  const country = notice.countryCode || null;

  if (!proposed) {
    return {
      proposedEndDate: null,
      statutoryEndDate: statutory,
      deltaDays: null,
      direction: "no_proposed_date",
      sentence: `The resignation names no last working day, so there is nothing to compare against the statutory end of ${statutory}. Nothing here is short — no date was proposed at all.`,
    };
  }

  const delta = isRealNumber(notice.discrepancyDays) ? notice.discrepancyDays : null;
  if (delta === null) {
    return {
      proposedEndDate: proposed,
      statutoryEndDate: statutory,
      deltaDays: null,
      direction: "unmeasured",
      sentence: `A last working day of ${proposed} was proposed against a statutory end of ${statutory}, but the gap between them was not measured, so it is not stated here.`,
    };
  }

  const direction = delta < 0 ? "earlier_than_statutory" : delta > 0 ? "later_than_statutory" : "match";
  const sentence =
    direction === "earlier_than_statutory"
      ? `${proposed} was proposed as the last working day; statute puts it at ${statutory}. That is ${Math.abs(delta)} days SHORT of the minimum notice. ${ESCALATION_TEAM} decides how the shortfall is handled — it is a real conflict between the proposal and the law, not an arithmetic slip.`
      : direction === "later_than_statutory"
        ? `${proposed} was proposed as the last working day; statute requires only ${statutory}. That is ${delta} days MORE notice than the minimum, which nothing forbids.`
        : `${proposed} was proposed as the last working day, which is exactly the statutory end date. No discrepancy.`;

  // THE HALF THAT WAS MISSING, AND THE REASON THIS FUNCTION GAINED A SECOND
  // JOB. Everything above is arithmetic: two dates and the number of days
  // between them. It is all true and it decides nothing. The person receiving
  // an escalated shortfall is choosing between handlings — the notice is
  // served, the employer accepts the earlier date, the missing period is paid
  // for, another date is agreed — and where this repository holds the country's
  // notice statute, that statute speaks to the choice: Código do Trabalho art.
  // 401.º states what an employee who does not serve the notice owes, and art.
  // 400.º(6) states who owes nothing at all.
  //
  // ONLY ON A SHORTFALL. `later_than_statutory` and `match` are not conflicts
  // and have nothing to resolve; attaching handling options to them would
  // manufacture a decision where none exists.
  const short = direction === "earlier_than_statutory";
  const handling = short ? shortfallHandlings(country) : null;

  return {
    proposedEndDate: proposed,
    statutoryEndDate: statutory,
    deltaDays: delta,
    direction,
    sentence,
    ...(short ? readingList(["statutory_discrepancy"], country) : { sources: [], uncited: [] }),
    // The structured form, for an API or a page that wants to lay the handlings
    // out itself. Null for every country whose statute this corpus does not
    // hold — see decisionSources.js's shortfallHandlings(): a generic option
    // list under an unread jurisdiction is a nearest match in disguise.
    handling,
    // The same content in the shape the shared sidebar already renders
    // (`block.fields[].sentence`, zaf-app/assets/main.js's renderNarrativeBlock),
    // so the handlings reach the screen without a panel learning UC-05's
    // vocabulary. Derived from `handling`, never written twice.
    fields: handling
      ? [
          { label: "How this can be handled", sentence: handling.framing },
          ...handling.options.map((o) => ({
            label: o.label,
            sentence:
              o.whatTheSourceSays +
              (o.state === "source_silent"
                ? ` (${o.document.instrument}, ${o.locator}: the retrieved text does not address this.)`
                : ` (${o.document.instrument}, ${o.locator}.)`),
          })),
          {
            label: handling.exemption.label,
            sentence: `${handling.exemption.whatTheSourceSays} (${handling.exemption.document.instrument}, ${handling.exemption.locator}.)`,
          },
          ...handling.boundaries.map((b) => ({ label: "Before treating this minimum as settled", sentence: b })),
        ]
      : [],
  };
}

/**
 * The money, in units a person can read, or an explicit statement that there is
 * no figure.
 *
 * `computable: false` is the case F-28 exists for: a partial sum is a wrong sum,
 * so the reconciler refuses to produce a total, and a report reaching sign-off
 * showing `null` invites exactly the reading the ×100 rules exist to prevent —
 * "nothing is owed" — when the truth is "we could not work it out". This names
 * the lines and the fields that made it uncomputable, which is what turns the
 * refusal into something somebody can fix.
 */
function payoutBasis(payout) {
  if (!payout) {
    return {
      stated: false,
      computable: null,
      total: null,
      currency: null,
      lines: [],
      unusable: [],
      sentence: "No PTO payout was reconciled — the request was refused before the calculation ran.",
    };
  }

  const currency = payout.currency ?? null;
  const lines = Array.isArray(payout.lines)
    ? payout.lines.map((l) => ({
        timeOffType: l.timeOffType ?? null,
        daysAvailable: isRealNumber(l.daysAvailable) ? l.daysAvailable : null,
        // ×100 -> human, always. Never the raw integer. See header rule 1.
        payout: isMoneyInteger(l.payoutInRemoteInteger)
          ? formatMoney(l.payoutInRemoteInteger, l.currency ?? currency ?? "USD")
          : null,
      }))
    : [];

  const unusable = Array.isArray(payout.unusableLines)
    ? payout.unusableLines.map((l) => ({
        index: l.index ?? null,
        timeOffType: l.timeOffType ?? null,
        missing: Array.isArray(l.missing) ? l.missing : [],
        reason: l.reason ?? null,
        source: l.source ?? null,
      }))
    : [];

  if (payout.computable === false) {
    const fields = [...new Set(unusable.flatMap((l) => l.missing))];
    return {
      stated: false,
      computable: false,
      total: null,
      currency,
      lines,
      unusable,
      sentence:
        `The payout could NOT be worked out. ${unusable.length} balance line${unusable.length === 1 ? "" : "s"} ` +
        `${unusable.length === 1 ? "is" : "are"} missing ${fields.length ? fields.join(", ") : "required fields"}. ` +
        "No total is shown because a partial sum would be a wrong sum — this is an absence of a figure, not a figure of zero." +
        missingRateSentence(unusable, fields) +
        unreadableSentence(unusable),
    };
  }

  // An empty balance list. Arithmetically 0; as a statement about the employee,
  // unknown. Say which.
  if (payout.source === "no_time_off_records") {
    return {
      stated: false,
      computable: true,
      total: null,
      currency,
      lines: [],
      unusable: [],
      sentence:
        "No time-off balances were supplied with this resignation, so no payout was computed. This is not a finding that nothing is owed — nothing was read from Remote's time-off records to establish that either way.",
    };
  }

  const total = isMoneyInteger(payout.totalInRemoteInteger)
    ? formatMoney(payout.totalInRemoteInteger, currency ?? "USD")
    : null;
  const reported = isMoneyInteger(payout.reportedBalanceInRemoteInteger)
    ? formatMoney(payout.reportedBalanceInRemoteInteger, currency ?? "USD")
    : null;

  return {
    stated: total !== null,
    computable: true,
    total,
    currency,
    lines,
    unusable,
    reportedByEmployee: reported,
    hasDiscrepancy: payout.hasDiscrepancy === true,
    sentence:
      total === null
        ? "The payout total is not a usable amount, so it is not stated."
        : `${total} across ${lines.length} balance line${lines.length === 1 ? "" : "s"}` +
          (payout.hasDiscrepancy === true && reported
            ? `. The employee's own stated balance is ${reported} — the two do not agree, and the difference has to be resolved before this is signed.`
            : "."),
  };
}

/**
 * The sentence a specialist needs when the only thing missing is the PAY RATE,
 * and the days came from Remote.
 *
 * WHY IT IS ITS OWN SENTENCE. "missing hourlyRateInRemoteInteger" names a
 * field, and a field name sends someone looking for a value to fetch. There is
 * nothing to fetch: no Remote endpoint publishes an hourly or a daily rate.
 * `contract_details` carries `annual_gross_salary`, and converting that needs a
 * weeks-per-year and a working-days-per-year figure Remote never states, plus a
 * jurisdictional rule about which base a leave payout is computed on — so a
 * derived rate would be an assumption wearing a formula, printed as money on a
 * document the employee signs. The action is a person supplying the contractual
 * rate, and the sentence has to say so or the case sits in a queue while
 * somebody hunts for an endpoint that does not exist.
 *
 * @param {Array<{missing:string[], source:string|null}>} unusable
 * @param {string[]} fields  the distinct missing field names across all lines
 */
function missingRateSentence(unusable, fields) {
  const onlyTheRate = fields.length === 1 && fields[0] === "hourlyRateInRemoteInteger";
  if (!onlyTheRate) return "";
  const fromRemote = unusable.some((l) => l.source === "remote_leave_policy_summary");
  return fromRemote
    ? " The accrued days themselves came from Remote's Time Off API and are not in doubt — what is missing is the pay rate, " +
        "which Remote does not publish on any endpoint. Supply the employee's contractual hourly rate and this settles; " +
        "it is not something a further read of Remote can answer."
    : " What is missing is the pay rate. Remote does not publish one, so it has to be supplied with the request.";
}

/**
 * The sentence for the other absence: we ASKED Remote for the balance and did
 * not get an answer. Distinct from "no balances were mentioned", which settles
 * quietly at nothing — the whole reason a failed read produces a refused line
 * rather than an empty list.
 * @param {Array<{reason:string|null}>} unusable
 */
function unreadableSentence(unusable) {
  return unusable.some((l) => l.reason === "remote_leave_policy_summary_unreadable")
    ? " The balance could not be read from Remote at all — this is a failed read of the Time Off API, not a finding that " +
        "no leave is owed. Nothing here says the employee has nothing accrued."
    : "";
}

/**
 * Everything HR Ops's sign-off turns on, from the persisted row alone.
 *
 * @param {object} args
 * @param {object|null} args.resignationRow  a `uc05_resignations` row
 * @returns {{
 *   decider: typeof DECIDER,
 *   notice: object,
 *   discrepancy: object|null,
 *   payout: object,
 *   unknowns: Array<{what:string, why:string, whatItWouldTake:string|null}>
 * }|null}  null when there is no row to describe
 */
export function describeSignoffBasis({ resignationRow } = {}) {
  const row = resignationRow;
  if (!row) return null;

  const notice = noticeBasis(row.notice ?? null);
  const discrepancy = discrepancyBasis(row.notice ?? null);
  const payout = payoutBasis(row.payout ?? null);

  // WHAT IS MISSING, COLLECTED IN ONE PLACE rather than left for the reader to
  // notice by its absence. An unknown a person has to DEDUCE from a blank field
  // is the same defect as a fact withheld: they act on what they can see.
  const unknowns = [];
  if (!notice.stated) {
    unknowns.push({
      what: "The statutory notice end date",
      why: notice.why,
      whatItWouldTake: notice.ruleFound
        ? "Extending this country's notice table to cover this length of service — the country itself is already held."
        : "Adding this country's statutory notice rule to src/uc05/noticePeriodTable.js, sourced from the statute rather than inferred.",
    });
  }
  if (payout.computable === false) {
    const missingOnlyTheRate =
      payout.unusable.length > 0 &&
      payout.unusable.every((l) => l.missing.length === 1 && l.missing[0] === "hourlyRateInRemoteInteger");
    unknowns.push({
      what: "The accrued-PTO payout",
      why: payout.sentence,
      // NAME THE ACTION THAT ACTUALLY CLOSES IT. When the days came from Remote
      // and only the rate is absent, "a complete balance line" is the wrong
      // instruction — the balance line IS complete, and no read of Remote will
      // ever finish it, because Remote publishes no pay rate.
      whatItWouldTake: missingOnlyTheRate
        ? "The employee's contractual hourly rate, supplied with the request in Remote's integer (x100) form. Remote itself publishes no hourly or daily rate on any endpoint, so this cannot be sourced by reading harder."
        : "A complete balance line — an hourly rate in Remote's integer form and a usable accrued-days figure — for every time-off type.",
    });
  }
  if (payout.computable === true && !payout.stated && payout.lines.length === 0) {
    unknowns.push({
      what: "The employee's accrued time-off balance",
      why: "No balances were supplied with the request, and this system does not read Remote's time-off records itself.",
      whatItWouldTake:
        "A read of the employee's time-off balances at submission, so an empty list becomes a confirmed nil rather than a silence.",
    });
  }
  // WHAT A SHORTFALL COSTS — NAMED AS AN ABSENCE, NEVER ESTIMATED.
  //
  // The system computes days and produces a PTO figure, and a reader who sees
  // money on the page beside "23 days SHORT" will reasonably assume the money
  // column accounts for the shortfall. It does not, and it must not: where a
  // statute attaches a payment to a short notice it measures it on its own base
  // — Portugal's art. 401.º on the base retribution and diuturnidades for the
  // period not served, which is not the pay rate the PTO payout uses — and a
  // money figure derived here from a statute this repository read once, on one
  // day, is precisely the well-formed-number-beside-a-citation failure
  // docs/knowledge/'s own rules name. The article and its measure travel with
  // the case in words (see `discrepancy.handling`); the arithmetic is a
  // person's.
  if (discrepancy && discrepancy.direction === "earlier_than_statutory") {
    unknowns.push({
      what: "What the shortfall costs, if anything",
      why:
        "No figure for the missing notice period appears anywhere on this case, and the PTO payout does not include one. " +
        (discrepancy.handling
          ? `${discrepancy.handling.country}'s statute does attach a payment to a short notice and the case carries the article and the words it measures it by — but this system computes no amount from it, deliberately.`
          : "Whether this country's statute attaches a payment to a short notice is not something this repository holds a source for, so nothing here says either way."),
      whatItWouldTake:
        "A person applying the statute to this contract. This is not a gap to close in code: a payment computed from a statutory formula, on a document an employee signs, is the one thing this system is built not to produce.",
    });
  }

  const extraction = row.letterExtraction ?? null;
  if (extraction && extraction.proposedEndDate && extraction.source && extraction.source !== "structured_input") {
    unknowns.push({
      what: "How the proposed last working day was obtained",
      why: `It was read out of the resignation letter (${extraction.source}${extraction.confidence ? `, confidence ${extraction.confidence}` : ""}), not supplied as a structured field. The date the calculation compared against is therefore an extraction, and worth confirming against the letter itself.`,
      whatItWouldTake: null,
    });
  }

  return { decider: DECIDER, notice, discrepancy, payout, unknowns };
}
