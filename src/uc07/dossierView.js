// ---------------------------------------------------------------------------
// dossierView.js  —  what a Mobility Legal specialist needs, ranked, at READ
// ---------------------------------------------------------------------------
// THE READER AND THE DECISION
// Reader: a Remote Mobility Legal Tier-3 specialist. Decision: is this
// permanent relocation safe to attempt, and if not, what has to be settled
// first — and by whom. UC-07 has no execution path, so the dossier IS the
// product. A dossier that omits what the decision turns on has failed at the
// only thing it does.
//
// WHAT WAS MISSING, AND WHY IT WAS INVISIBLE
// The stored dossier is rich — sixteen sections, every flag carrying a severity
// and a message, a cost estimate that refuses to invent a figure. What it never
// did was ANSWER THE READER'S QUESTIONS IN THEIR ORDER:
//
//   * `uncertainty: 0.6` — a number with no dimensions. See explainUncertainty()
//     in transitionGate.js.
//   * Sixteen sections, flat. Nothing said which two flags BLOCK the plan and
//     which eleven merely need settling, even though every flag already carried
//     the severity that decides it.
//   * Every hole was recorded — `seniorityDate: null`, `pto.cashout.unusable`,
//     `costEstimate.pendingQuotes`, `mot.code: "NOT_EVALUATED"`,
//     `coverage.status: "NOT_EVALUATED"`, `transitionSafety.missing` — and each
//     sat in a different nested object under a different key with a different
//     spelling of "we could not establish this". A specialist had to go looking
//     for absences, which is the one thing nobody thinks to do.
//
// WHY DERIVED AT READ TIME RATHER THAN ADDED TO THE DOSSIER
// `evaluateRelocationFeasibility()` and `buildDossier()` are compared WHOLE,
// key for key, against `workflows/nodes-uc07/relocationGates.js`
// (test/n8nUc07Parity.test.js) — a file this pass may not edit. Adding a key to
// either would break that comparison. Deriving on read is strictly better here
// anyway: it applies identically to rows written by the n8n path, and to every
// dossier already in `uc07_dossiers`.
//
// IT CANNOT BECOME AN EXECUTION PATH. A pure function of a stored row: no
// dependency, no parameter, no id to act on, nothing returned but text and
// numbers already in the row. server.js spreads it into a GET response and
// still has no write verb of any kind (asserted by test/uc07.test.js F-38).
// ---------------------------------------------------------------------------

import { countryLabel } from "../shared/countryNames.js";
import { explainUncertainty } from "./transitionGate.js";
import {
  sourcesForFinding,
  uncitedFinding,
  routeKey,
  NATIONALITY_NOT_HELD,
  SOURCE_FRAMING,
  CAVEAT_FRAMING,
  CONFIRMATION_FRAMING,
} from "./decisionSources.js";

/**
 * The specialist-facing reading of one stored dossier row.
 *
 * @param {object|null} dossierRow  a row from DossierStore (or its `dossier` blob)
 * @returns {{
 *   verdictSummary: object,
 *   blockers: Array<object>,
 *   reviewItems: Array<object>,
 *   uncertaintyBreakdown: object,
 *   openQuestions: Array<{code:string, priority:number, question:string}>
 * }}
 */
export function describeDossier(dossierRow) {
  const row = dossierRow ?? {};
  const dossier = row.dossier ?? {};
  const flags = Array.isArray(dossier.flags) ? dossier.flags : [];

  const blockers = flags.filter((f) => f?.severity === "HIGH");
  const reviewItems = flags.filter((f) => f?.severity && f.severity !== "HIGH");

  const sourceCountry = row.sourceCountry ?? dossier.sourceCountry ?? null;
  const destinationCountry = row.destinationCountry ?? dossier.destinationCountry ?? null;
  const statutory = describeStatutorySources({ flags, sourceCountry, destinationCountry });

  return {
    verdictSummary: describeVerdict({ dossier, row, blockers, reviewItems }),
    blockers,
    reviewItems,
    uncertaintyBreakdown: explainUncertainty(flags),
    // THE VENDORED INSTRUMENTS, per finding. Flat lists for an API reader and
    // the audit viewer; `basis` is the same content in the shape the ZAF
    // sidebar's renderNarrativeBlock()/renderSources() already understand.
    sources: statutory.sources,
    uncited: statutory.uncited,
    basis: statutory.basis,
    openQuestions: collectOpenQuestions(dossier, statutory),
  };
}

// ---------------------------------------------------------------------------
// The statutory instruments
// ---------------------------------------------------------------------------
// WHY HERE AND NOT IN THE DOSSIER. `evaluateRelocationFeasibility()` and
// `buildDossier()` are compared WHOLE, key for key, against
// workflows/nodes-uc07/relocationGates.js (test/n8nUc07Parity.test.js), a file
// this pass may not edit — so adding a key to either would break a comparison
// rather than improve a dossier. Deriving on read is strictly better anyway: it
// applies identically to rows the n8n path wrote, and to every dossier already
// in `uc07_dossiers`.
//
// WHAT IT WILL NOT DO. It never guesses a route. Where the source or the
// destination could not be determined, every route-axis citation is
// unreachable and the block says so — which is a fact about the dossier a
// specialist needs, not a blank to skim past.
//
// TWO FINDINGS ARE CITED ON EVERY DOSSIER WITH A ROUTE, whether or not a gate
// fired for them: tax residence at both ends, and which social-security system
// the person joins. A permanent relocation always crosses both boundaries. They
// are not flags because there is nothing to flag — they are what the move IS.
// ---------------------------------------------------------------------------

/** The route-axis findings a relocation raises by existing, not by failing a gate. */
const INHERENT_FINDINGS = Object.freeze(["tax_residency_change", "social_security_on_permanent_move"]);

/**
 * THE COUNTRIES BY NAME, EVERYWHERE A PERSON READS THEM.
 *
 * A Mobility Legal specialist opened this dossier and was told the move was
 * "DE → NL". Both halves are ISO 3166-1 alpha-2 codes, and `NL`/`NO`/`NE` are
 * one glance from each other — decoding them is work this screen was making its
 * reader do before they could start on the actual question. The codes have NOT
 * gone anywhere: `sourceCountry`, `destinationCountry` and `routeKey` are still
 * the stored values on the same object, which is what every citation is keyed by
 * and what anyone quoting this into another system needs.
 *
 * `countryLabel()` passes anything that is not code-shaped through untouched, so
 * a value that already arrived as a name stays a name — do not wrap twice.
 */
const routeName = (from, to) => `${countryLabel(from)} → ${countryLabel(to)}`;

/** A `routeKey()` pair ("CA|NL") as the two countries, for prose. */
const routePairName = (key) =>
  String(key)
    .split("|")
    .map((code) => countryLabel(code))
    .join("–");

// ---------------------------------------------------------------------------
// THE FIELD NAMES A SPECIALIST NEVER AGREED TO LEARN
// ---------------------------------------------------------------------------
// Three of the questions below were assembled out of arrays this system fills
// with its own identifiers, and printed them verbatim: "Missing or unusable:
// annualGrossSalaryRemoteInteger (not_an_integer)", "awaiting:
// destination_contract_active, right_to_work_confirmed", "monthlyManagementFee,
// eorTransferFee still need quoting". Each was true and none was addressed to
// the person reading it — and an open question a reader skips is an open
// question that does not get answered, which is the same outcome as not asking.
//
// EVERY LABEL BELOW IS A RESTATEMENT, NOT A DEFINITION. Each one says in words
// what the identifier beside it already names in `transitionGate.js` and
// `costCalculator.js`; nothing here decides anything, adds a condition, or
// changes which questions are raised. An unmapped value falls back to its
// identifier with the underscores opened out, so a field added later reads as
// clumsy English rather than vanishing from a question about what is missing.
// ---------------------------------------------------------------------------

/** An identifier from this system's own arrays, opened out into readable words. */
const inWords = (value) =>
  String(value)
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim()
    .toLowerCase();

/** The four conditions `evaluateTransitionSafety()` requires before the source
 *  employment may be ended, in the words its own header states them in. */
const TRANSITION_CONDITION_WORDS = Object.freeze({
  destination_contract_active: "the destination contract is active",
  right_to_work_confirmed: "the right to work in the destination is confirmed",
  destination_start_date_confirmed: "the destination start date is confirmed",
  source_exit_plan_validated: "the source exit plan has been validated",
});

/** The two inputs `reconcilePtoCashout()` needs, and why each was unusable. */
const CASHOUT_FIELD_WORDS = Object.freeze({
  liquidatedDays: "the number of untaken PTO days being paid out",
  annualGrossSalaryRemoteInteger: "the annual gross salary the daily rate is derived from",
});
const CASHOUT_REASON_WORDS = Object.freeze({
  missing: "not supplied",
  not_a_non_negative_number: "not a usable number of days",
  not_an_integer: "not a usable amount",
});

/**
 * The components still awaiting a quote, by the label the estimate already gives
 * them. `pendingQuotes` holds the component KEYS, and `components[]` beside it
 * already carries a human label for every one — so this is a lookup in the same
 * object, never a second naming of the same fees.
 */
function pendingQuoteNames(cost) {
  const byKey = new Map((cost?.components ?? []).map((c) => [c?.key, c?.label]));
  return (cost?.pendingQuotes ?? [])
    .map((key) => byKey.get(key) || inWords(key))
    .join(", ");
}

/** The narrative judge's three verdicts, as a reader would say them. */
const FAITHFULNESS_WORDS = Object.freeze({
  faithful: "matched the structured facts",
  not_faithful: "did NOT match the structured facts",
  not_evaluated: "was not checked",
});

function describeStatutorySources({ flags, sourceCountry, destinationCountry }) {
  const scope = { sourceCountry, destinationCountry };
  const key = routeKey(sourceCountry, destinationCountry);
  const sources = [];
  const uncited = [];

  const consider = (findingKey) => {
    const group = sourcesForFinding(findingKey, scope);
    if (group) {
      sources.push(group);
      return group;
    }
    const absence = uncitedFinding(findingKey, scope);
    if (absence) uncited.push(absence);
    return null;
  };

  // Every flag this dossier actually raised, in the order the gates raised it —
  // so the reading list is ordered by what happened, not by what this file
  // happens to know most about.
  const byFinding = new Map();
  for (const flag of flags) {
    const code = flag?.code;
    if (!code || byFinding.has(code)) continue;
    byFinding.set(code, consider(code));
  }

  // Then the two that are inherent in a relocation. Skipped if a flag already
  // covered the same ground: UC07_TAX_RESIDENCY_REVIEW_REQUIRED and
  // `tax_residency_change` cite identically, and printing both would be one
  // fact wearing two headings.
  const taxAlreadyCited = byFinding.has("UC07_TAX_RESIDENCY_REVIEW_REQUIRED");
  for (const findingKey of INHERENT_FINDINGS) {
    if (findingKey === "tax_residency_change" && taxAlreadyCited) continue;
    byFinding.set(findingKey, consider(findingKey));
  }

  const immigrationCited = sources.some((g) => g.axis === "destination");
  const taxGroup = sources.find((g) => g.finding === "tax_residency_change" || g.finding === "UC07_TAX_RESIDENCY_REVIEW_REQUIRED") ?? null;
  const socialGroup = sources.find((g) => g.finding === "social_security_on_permanent_move") ?? null;
  const immigrationGroups = sources.filter((g) => g.axis === "destination");

  return {
    routeKey: key,
    sourceCountry,
    destinationCountry,
    sources,
    uncited,
    immigrationCited,
    // THE SIDEBAR CONTRACT — `basis.<key>` blocks carrying a `sentence`,
    // optional `fields[]` with their own sentences, and `sources`: exactly what
    // zaf-app/assets/main.js's renderNarrativeBlock() and renderSources()
    // already draw for UC-04, UC-05 and UC-06. Nothing new is asked of the
    // browser. See docs/use-cases/UC-07.md §15 for the one line in main.js's
    // loadUc07() that has to pass `basis` through before it renders.
    basis: {
      sources: { framing: SOURCE_FRAMING, caveatFraming: CAVEAT_FRAMING, confirmationFraming: CONFIRMATION_FRAMING },
      immigration: {
        sentence: immigrationCited
          ? `${countryLabel(destinationCountry)} publishes the route(s) below. THIS SYSTEM HOLDS NO NATIONALITY for this employee, so none of them can be identified as the route this person needs — they are what the destination requires of a third-country national, and nothing more.`
          : destinationCountry
            ? `This system holds no immigration instrument for ${countryLabel(destinationCountry)}. That is not a finding that it has no requirements — nobody has looked, so nothing here reads as a clearance.`
            : "No destination country was determined, so no immigration instrument could be looked up at all.",
        fields: immigrationGroups.flatMap((g) =>
          g.routes.map((route) => ({ label: route.label, sentence: route.whatTheSourceSays }))
        ),
        why: NATIONALITY_NOT_HELD.statement,
        sources: immigrationGroups,
      },
      taxResidence: {
        sentence: taxGroup
          ? taxGroup.bothEnds.statement
          : key
            ? `This system holds a domestic residence test for four countries only, and ${routePairName(key)} is not covered on both ends.`
            : "No route was determined, so neither end's residence rule could be looked up.",
        fields: taxGroup
          ? [
              { label: `${countryLabel(taxGroup.sourceCountry)} — residence ends`, sentence: taxGroup.bothEnds.source.says },
              { label: `${countryLabel(taxGroup.destinationCountry)} — residence begins`, sentence: taxGroup.bothEnds.destination.says },
            ]
          : [],
        sources: taxGroup ? [taxGroup] : [],
      },
      socialSecurity: {
        sentence: socialGroup
          ? socialGroup.statement
          : key
            ? `This system holds no social-security instrument for ${routePairName(key)}.`
            : "No route was determined, so no social-security instrument could be looked up.",
        fields: socialGroup ? [{ label: "Network", sentence: socialGroup.network }] : [],
        sources: socialGroup ? [socialGroup] : [],
      },
    },
  };
}

/**
 * The verdict in a sentence that says what it means for the reader.
 *
 * BLOCK / REVIEW / PROCEED are the gate's vocabulary, not a specialist's, and
 * only one of them is self-explanatory. In particular PROCEED is the one most
 * easily misread: it is the deterministic gates finding nothing wrong with the
 * PLAN — it is not an approval, and this use case has no way to give one.
 */
function describeVerdict({ dossier, row, blockers, reviewItems }) {
  const verdict = dossier.verdict ?? null;
  const route =
    row.sourceCountry && row.destinationCountry
      ? routeName(row.sourceCountry, row.destinationCountry)
      : dossier.sourceCountry && dossier.destinationCountry
        ? routeName(dossier.sourceCountry, dossier.destinationCountry)
        : null;

  const meaning =
    verdict === "BLOCK"
      ? `${blockers.length} blocking condition(s) mean the plan cannot proceed AS PROPOSED. Each one has to be resolved or the plan changed.`
      : verdict === "REVIEW"
        ? `No blocking condition, but ${reviewItems.length} item(s) need settling before this can be signed off.`
        : verdict === "PROCEED"
          ? "The deterministic gates found nothing wrong with the plan. This is NOT an approval — UC-07 has no execution path, and a human decides."
          : "No feasibility verdict is recorded on this dossier.";

  return {
    verdict,
    route,
    // Restated because `feasible` is the narrowest word in the dossier and the
    // easiest to over-read: it means "PROCEED", nothing more.
    feasible: dossier.feasible ?? null,
    blockerCount: blockers.length,
    reviewItemCount: reviewItems.length,
    requiredActions: Array.isArray(dossier.requiredActions) ? dossier.requiredActions : [],
    statement: route ? `${route}. ${meaning}` : meaning,
  };
}

/**
 * Every fact this dossier could NOT establish, in one place, ranked.
 *
 * Ranking is the point. Priority 1 is anything that makes the dossier unsafe to
 * act on as it stands (an unknown route, an underivable settlement figure, an
 * unauthorised offboarding sequence). Priority 2 is a real hole that does not
 * invalidate the rest. Priority 3 is quality signal on the drafted prose.
 *
 * Each entry NAMES THE FIELD it is missing, because an escalation that says
 * "some information is missing" sends a specialist looking for nothing —
 * exactly what reconcilePtoCashout()'s `unusable[]` exists to avoid one layer
 * down, and this reuses that list rather than restating it.
 */
function collectOpenQuestions(dossier, statutory = null) {
  const questions = [];
  const dateChecks = dossier.dateChecks ?? {};
  const transition = dossier.transitionSafety ?? {};
  const pto = dossier.pto ?? {};
  const cashout = pto.cashout ?? {};
  const cost = dossier.costEstimate ?? {};

  if (!dossier.sourceCountry || !dossier.destinationCountry) {
    questions.push({
      code: "route_not_determined",
      priority: 1,
      question:
        "The source and/or destination country could not be determined from the request. Every other gate in this " +
        "dossier reasons about a route — confirm it with the requester before relying on any of them.",
    });
  }

  if (cashout.computable === false) {
    const fields = (cashout.unusable ?? [])
      .map((u) => `${CASHOUT_FIELD_WORDS[u.field] ?? inWords(u.field)} (${CASHOUT_REASON_WORDS[u.reason] ?? inWords(u.reason)})`)
      .join(", ");
    questions.push({
      code: "pto_cashout_not_computable",
      priority: 1,
      question:
        "The liquidated PTO payout could not be derived, so the cost estimate carries no settlement line at any value" +
        (fields ? `. Missing or unusable: ${fields}` : "") +
        ". Supply these before the estimate is used for anything.",
    });
  }

  if (transition.sourceOffboardingAuthorized === false) {
    questions.push({
      code: "source_offboarding_not_authorized",
      priority: 1,
      question:
        "Source offboarding is NOT authorised until each of these is confirmed: " +
        `${(transition.missing ?? []).map((m) => TRANSITION_CONDITION_WORDS[m] ?? inWords(m)).join("; ")}. ` +
        "Never terminate the source employment merely because the " +
        "destination record exists — that sequence is what leaves an employee unemployed between two contracts.",
    });
  }

  if (dateChecks.mot?.code === "NOT_EVALUATED") {
    questions.push({
      code: "mot_not_evaluated",
      priority: 2,
      question:
        "Minimum onboarding time was not evaluated — the destination creation date, the proposed start date, or the " +
        "country's lead-time requirement was missing. The start date has not been checked against anything.",
    });
  }

  if (dateChecks.coverage?.status === "NOT_EVALUATED") {
    questions.push({
      code: "coverage_not_evaluated",
      priority: 2,
      question:
        "The employment gap/overlap check did not run — the source last working day, the source termination date, or " +
        "the destination start date is missing. Neither a gap nor an overlap has been ruled out.",
    });
  }

  if (dateChecks.alignment?.aligned === null) {
    questions.push({
      code: "month_end_alignment_not_evaluated",
      priority: 2,
      question:
        "Month-end alignment could not be checked without both dates, so duplicate-management-fee exposure is " +
        "unknown rather than absent.",
    });
  }

  const seniority = dossier.seniority ?? {};
  if (seniority.status === "PRESERVED" && !seniority.seniorityDate) {
    questions.push({
      code: "seniority_date_missing",
      priority: 2,
      question:
        "Seniority is preserved, but the original hire date it is preserved FROM was never supplied. Statutory " +
        "notice, severance and vesting are all counted from that date.",
    });
  } else if (seniority.status === "REQUIRES_LEGAL_REVIEW") {
    questions.push({
      code: "seniority_requires_legal_review",
      priority: 2,
      question: "Seniority continuity has not been confirmed for the destination jurisdiction and needs legal review.",
    });
  }

  if (cost.status === "INCOMPLETE") {
    questions.push({
      code: "cost_estimate_incomplete",
      priority: 2,
      question:
        `No cost estimate could be produced${cost.reason ? `: ${cost.reason}` : ""}. Every monetary line is pending ` +
        "input — the absence of a total here is not a total of zero.",
    });
  } else if ((cost.pendingQuotes ?? []).length) {
    questions.push({
      code: "cost_quotes_pending",
      priority: 2,
      question:
        `The cost estimate is partial: ${pendingQuoteNames(cost)} still need quoting, and are excluded from ` +
        `the ${cost.knownTermTotalDisplay ?? "known"} term total rather than counted as zero.`,
    });
  }

  if (!(dossier.citations ?? []).length) {
    questions.push({
      code: "no_citations",
      priority: 2,
      question: "No global-mobility guidance matched this request in the local reference corpus.",
    });
  }

  // THE INPUT THAT DECIDES WHICH IMMIGRATION RULE APPLIES, AND IS NOT HELD.
  // Priority 1 wherever an immigration instrument is cited, because a route
  // printed without it reads as this person's route. There is no nationality
  // field anywhere in UC-07, so this cannot be conditioned on detecting whom it
  // applies to — see NATIONALITY_NOT_HELD.
  if (statutory?.immigrationCited) {
    questions.push({
      code: "nationality_not_held",
      priority: 1,
      question:
        "The destination's published immigration routes are cited below, and this system holds NO nationality, citizenship or " +
        "passport for this employee — there is no such field in the request. Which of those routes applies, or whether any is " +
        "needed at all, cannot be answered from anything in this dossier. Confirm the passport before reading a route as this " +
        "person's route.",
    });
  }

  // THE FLAG WITH THE LEAST BEHIND IT, said where it is weighed rather than in
  // a document. Every other 🔴 finding here either cites a vendored instrument
  // or is honestly a Remote product rule; this one is the flag most likely to
  // be escalated onward and its governing material is paraphrase-only by
  // licence and was never retrieved.
  if ((dossier.flags ?? []).some((f) => f?.code === "UC07_PE_RISK_REVIEW_REQUIRED")) {
    questions.push({
      code: "pe_risk_unsourced",
      priority: 2,
      question:
        "Permanent-establishment exposure is flagged and this repository cites NOTHING for it. The governing material is the " +
        "OECD Model art. 5 and its Commentary plus BEPS Action 7 — copyrighted, paraphrase-only, and not retrieved by this " +
        "project — so the flag is a request for a professional determination and carries no source of its own.",
    });
  }

  const verdictOfJudge = dossier.faithfulness?.verdict ?? null;
  if (verdictOfJudge === "not_evaluated" || verdictOfJudge === null) {
    questions.push({
      code: "narrative_not_checked",
      priority: 3,
      question:
        "The drafted narrative was not checked against the structured facts (the faithfulness judge did not run). " +
        "Read it against the sections above rather than instead of them.",
    });
  } else if (verdictOfJudge !== "faithful") {
    questions.push({
      code: "narrative_flagged",
      priority: 3,
      question:
      `The check on the drafted narrative ${FAITHFULNESS_WORDS[verdictOfJudge] ?? inWords(verdictOfJudge)} — ` +
      "read the structured facts above, not the prose.",
    });
  }

  return questions.sort((a, b) => a.priority - b.priority);
}
