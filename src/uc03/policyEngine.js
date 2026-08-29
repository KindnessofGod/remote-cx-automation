// ---------------------------------------------------------------------------
// policyEngine.js  —  UC-03 deterministic decision gates (the thin router)
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
// The LLM (classifier) only *interprets* the request. The DECISION of what to
// do with it is made here, with plain rules — no AI. This is the same
// "AI interprets. Rules decide." separation as UC-01's policyEngine.js.
//
// UC-03 is deliberately NOT a compliance engine. Its job is to route:
//   - work-authorization intent  -> UC-04 (a flag + normalized handoff event;
//                                   this file decides NOTHING about it)
//   - standard travel letter     -> auto_resolve: written and issued, no
//                                   signature. The routine case is 🟢 like any
//                                   other 🟢 case, and rungs 1-11 are what
//                                   qualify it (see the letter rung's own note)
//   - non-standard travel letter -> escalate: the template cannot say what was
//                                   asked, so nothing is drafted and a person
//                                   writes it
//   - letter with no letterhead  -> human_review: asked for, allowed, and
//                                   nowhere to write it — a record problem
//   - sanctioned / over-cap      -> escalate to Global Mobility
//   - everything else, compliant -> auto_resolve (informational answer +
//                                   mandatory travel disclaimer)
//
// There is deliberately NO Schengen 90/180-day or tax-residence logic here.
// The research blueprint floated rolling-stay counting as a deterministic
// rule, but the distilled spec (docs/use-cases/UC-03.md §7) does NOT include
// it — and building an unverifiable half-rule would be worse than none. What
// IS here matches §7 exactly: a destination-jurisdiction check (step 7),
// cumulative duration vs. cap, and a sanctioned-region hard override.
//
// COUNTRY CODES ARE NORMALISED ONCE, AT THE TOP OF evaluate()
// The destination code reaching this router comes from an LLM extraction, so
// its case is whatever the model emitted. `SANCTIONED_OR_RESTRICTED.has()` is
// case-sensitive: a lowercase "ru" missed the sanctions override entirely
// (the same defect class as UC-04's finding F-13). It happened to still
// escalate — via the jurisdiction-registry gate two steps later — but with
// the WRONG reason, and a sanctions control whose correctness depends on a
// different gate downstream is not a control. Both the lookup key and the two
// caller-supplied sets are normalised here, once, via
// src/shared/countryCodes.js.
// ---------------------------------------------------------------------------

import { normalizeCountryCode, normalizeCountrySet } from "../shared/countryCodes.js";
import { findUpstreamFailure, upstreamVerdict } from "../shared/upstreamFailure.js";
import { bindGateDescriptions } from "../shared/gateLadder.js";
import { decisionFacts, fact, unknownFact } from "../shared/decisionFacts.js";
// Names only — no policy. GATE_SEQUENCE's rung 5 tells the requester what a
// work-authorisation request needs that their travel request did not carry, and
// takes the list from the one place that declares it rather than retyping it.
import { UC04_INPUTS_UC03_CANNOT_SOURCE } from "./uc04Intake.js";
import { DEFAULT_CONFIDENCE_THRESHOLD } from "./confidenceFloor.js";
import { assessLetterScope, LETTER_SCOPE_EXCEEDED } from "./letterScope.js";
// PROVENANCE ONLY — read by describeDecisionFacts() and by nothing in
// `evaluate()`. The gates decide on the merged value, never on who supplied it:
// a rule that treated a stated destination differently from a read one would
// make the form a gate, which is precisely what statedTrip.js forbids.
import { PROVENANCE, PROVENANCE_NOTES } from "./statedTrip.js";

const STATED = PROVENANCE.STATED;

/**
 * Destinations that are a HARD ESCALATE no matter what. Illustrative
 * demonstration subset — NOT Remote's authoritative compliance list, which
 * this portfolio does not have access to (production would source this from
 * the compliance team). Checked BEFORE the jurisdiction-registry list on
 * purpose: a sanctions gate must not depend on that list being complete and
 * correct (defense in depth — see evaluate() step 6).
 *
 * AF AND IQ WERE ADDED FROM REMOTE'S OWN EXCLUSIONS, NOT INVENTED.
 * `GET /v1/countries` returns 224 rows, and the 26 ISO 3166-1 alpha-2 codes it
 * omits are the sanctions/embargo set plus uninhabited and dependent
 * territories. Among sovereign states, Remote's exclusions are a strict
 * SUPERSET of the eight codes this list originally held: it also omits
 * **Afghanistan (AF)** and **Iraq (IQ)**. Verified live 2026-08-17 — AF, IQ
 * and RU are all absent from the 224, while ME/BS/MQ/KW are present with
 * `eor_onboarding: false` and ES is present with `true`.
 * Evidence and reasoning: `docs/research/COUNTRY-SUPPORT-SEMANTICS.md` §4.2
 * and §8 point 2.
 *
 * WHY DUPLICATE WHAT THE REGISTRY ALREADY EXCLUDES. Because a control that
 * only works while an upstream list stays correct is not a control. Remote's
 * stated membership rule for that list is *where creating a company is
 * allowed* ([CONFIRMED] — <https://developer.remote.com/reference/get_v1_countries.md>),
 * which is a corporate/KYB question, not a travel-compliance one; a country
 * could become company-creatable while remaining travel-hostile. Naming these
 * two here means the sanctions gate — the one whose reason string a specialist
 * can act on — fires on them directly instead of a downstream membership test
 * catching them by side effect. Strictly more restrictive than before, so it
 * is fail-closed-safe by construction.
 */
export const SANCTIONED_OR_RESTRICTED = new Set([
  "CU",
  "IR",
  "KP",
  "SY",
  "RU",
  "BY",
  "MM",
  "VE",
  "AF", // absent from Remote's own `GET /v1/countries` registry — see above
  "IQ", // absent from Remote's own `GET /v1/countries` registry — see above
]);

/**
 * Cap on cumulative travel duration for the zero-touch informational path,
 * in days (inclusive). Illustrative default — Remote's real travel policy
 * would define this, and it is configurable per-call via evaluate()'s
 * `durationCapDays`. Per the UC-03/UC-04 boundary research, duration is a
 * RISK VARIABLE, never the primary classifier — exceeding the cap escalates,
 * it does not re-route.
 */
export const DEFAULT_DURATION_CAP_DAYS = 30;

/**
 * Minimum classifier confidence required before this router will act on the
 * classified intent at all. UC-03.md §7's first deterministic rule: "Request-
 * type classification confidence gate (low confidence → human review, never a
 * guessed route)."
 *
 * Checked BEFORE the intent-based routing in step 4 on purpose: everything
 * this router does after that point — routing to UC-04, reading a destination,
 * answering informationally — is downstream of the classified intent. Gating
 * after the route would be gating the wrong thing.
 *
 * WHY 0.6 AND NOT UC-01's 0.85. `classifier.js`'s rule-based fallback scores
 * 0.9 when it parsed a destination AND a start date, and 0.6 when it did not —
 * so in UC-03 a 0.6 is "I read the intent but not the whole itinerary", not
 * "I may have read the intent wrong". Missing dates and missing destinations
 * already have their own dedicated gates further down (`duration_unknown`,
 * `destination_unknown`), which handle that case precisely; a 0.85 threshold
 * here would simply pre-empt them and turn every date-less inquiry into a
 * generic human_review with a less useful reason. 0.6 is the floor the
 * classifier itself treats as usable, so this gate catches what it is actually
 * for: a classification neither path considers trustworthy (an LLM returning
 * 0.05 or 0.4), plus — via the fail-closed branch below — one with no
 * confidence at all.
 *
 * DEFINED IN `confidenceFloor.js` AND RE-EXPORTED HERE. `letterScope.js` needs
 * the same floor and this file imports `letterScope.js`, so the constant lives
 * one file down to keep the two out of a cycle. Every existing importer still
 * reads it from here; there is still exactly one definition of the number.
 */
export { DEFAULT_CONFIDENCE_THRESHOLD };

/**
 * Deterministic day-count over the itinerary dates the classifier parsed —
 * the spec's own §9 "Deterministic day-count over LLM parse" guard: we never
 * gate on an LLM-provided number we can't recompute, we recompute it.
 * Inclusive of both endpoints: "March 1 to March 22" is 22 days.
 * @param {string|null} startDate  "YYYY-MM-DD"
 * @param {string|null} endDate    "YYYY-MM-DD"
 * @returns {number|null} inclusive day count, or null when either date is
 *   missing or the range is invalid
 */
export function computeDurationDays(startDate, endDate) {
  if (!startDate || !endDate) return null;
  const start = Date.parse(startDate);
  const end = Date.parse(endDate);
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return null;
  return Math.round((end - start) / 86_400_000) + 1;
}

/**
 * Decide how a travel/workation inquiry should be handled.
 * @param {object} args
 * @param {object} args.employment         the fetched employment record
 * @param {object} args.classification     output of classifyTravelInquiry()
 * @param {object} args.identity           output of verifyRequester()
 * @param {Set<string>} [args.supportedCountries]  ISO alpha-2 codes present in
 *   Remote's country registry, from `remote.listCountries()` — i.e. the
 *   jurisdictions where Remote allows a company to be created, which is what
 *   `GET /v1/countries` documents itself as returning. NOT an EOR-capability
 *   set. Absent/empty means nothing can be confirmed -> escalate (this check
 *   must fail closed, never open). See step 7 for the full reasoning.
 * @param {Array<{call:string,status:number|null,kind:string,message:string}>} [args.upstreamFailures]
 *   reads that failed rather than answered. Only `countries` is consulted here,
 *   and only to stop an unread registry from being reported as a fact about the
 *   destination — see step 6b. Always yields an escalation, never an approval.
 * @param {Set<string>} [args.sanctionedRegions]   defaults to SANCTIONED_OR_RESTRICTED
 * @param {number} [args.durationCapDays]          defaults to DEFAULT_DURATION_CAP_DAYS
 * @param {number} [args.confidenceThreshold]      defaults to DEFAULT_CONFIDENCE_THRESHOLD
 * @returns {{decision:"auto_resolve"|"human_review"|"escalate"|"route_to_uc04",
 *            route?: "uc04_work_authorization", reason:string, flags:string[],
 *            durationDays:number|null}}
 */
export function evaluate({
  employment,
  classification,
  identity,
  supportedCountries = new Set(),
  upstreamFailures = [],
  sanctionedRegions = SANCTIONED_OR_RESTRICTED,
  durationCapDays = DEFAULT_DURATION_CAP_DAYS,
  confidenceThreshold = DEFAULT_CONFIDENCE_THRESHOLD,
  // THE EMPLOYEE'S OWN WORDS. Read by exactly one gate (rung 10's letter-scope
  // check) and by nothing else — every other gate decides on the CLASSIFIED
  // values, and must keep doing so. It has no default that means "fine": an
  // absent or blank text makes the letter scope non-standard, because "we saw
  // nothing unusual" and "we had nothing to look at" are opposite statements.
  // A caller that forgets it therefore gets a refusal, never a clearance.
  requestText = null,
  // WHETHER THERE IS A LETTERHEAD TO WRITE ON, established by the caller before
  // this function runs. Read by exactly one gate (rung 11) and by nothing else.
  //
  // IT IS AN INPUT RATHER THAN A LATER CHECK because it now SELECTS BETWEEN TWO
  // DECISIONS, and a decision has to be made by the gate that owns it. A
  // standard letter this system can write is issued here and now; a standard
  // letter it cannot write stops for a person. Establishing that in
  // `workflow.js` after `evaluate()` returned would mean the recorded reason
  // named one rung while a later line changed the outcome — the shape
  // `docs/GATES.md` exists to prevent.
  //
  // DEFAULTS TO FALSE, WHICH IS THE SIGNATURE PATH. A caller that has not
  // established a letterhead has not established one; the fail-closed answer is
  // the more cautious of the two outcomes, and it is exactly the behaviour every
  // caller had before this parameter existed.
  letterheadAvailable = false,
  // WHETHER THIS DEPLOYMENT ISSUES THE STANDARD LETTER AT ALL, or requires a
  // signature on every travel letter regardless.
  //
  // TRUE IS THE PROJECT OWNER'S DECISION and it is the only default: *"for a
  // short business trip where the user is qualified, that should be fully
  // automated — no need for anybody to sign."* Nothing in this repository sets
  // it to false, and a reader should not imagine that something does.
  //
  // IT EXISTS AS A PARAMETER FOR THE SAME REASON `durationCapDays` and
  // `sanctionedRegions` do: it is a policy number, not a law of the system, and
  // the company, the country or the month could each be a reason to require the
  // signature back. Turning it off restores exactly the behaviour every path had
  // before this rung split — a drafted letter, a queue row and one signature —
  // which is also why that path is still tested rather than described.
  letterAutoIssue = true,
}) {
  const flags = [];

  // 1. Identity must be verified first — a security gate, not negotiable.
  if (!identity.verified) {
    flags.push(`identity_${identity.reason}`);
    return { decision: "escalate", flags, reason: "identity_not_verified", durationDays: null };
  }

  // 2. Employee must be ACTIVE — never give travel support (or route anything)
  //    for a terminated/suspended employee.
  if (employment.status !== "active") {
    flags.push(`employment_status_${employment.status}`);
    return { decision: "escalate", flags, reason: "employee_not_active", durationDays: null };
  }

  // 3. Confidence gate (UC-03.md §7, bullet 1) — every decision below this
  //    line is made ON the classified intent, so an intent we are not
  //    confident in must not be acted on: low confidence goes to a human, it
  //    never picks a route. FAILS CLOSED: a missing or non-numeric confidence
  //    is treated as low, because `undefined < 0.85` and `NaN < 0.85` are both
  //    false and a bare comparison would wave exactly those cases through.
  const confidence = classification.confidence;
  if (typeof confidence !== "number" || Number.isNaN(confidence)) {
    flags.push("confidence_unknown");
    return { decision: "human_review", flags, reason: "confidence_unknown", durationDays: null };
  }
  if (confidence < confidenceThreshold) {
    flags.push("low_confidence");
    return { decision: "human_review", flags, reason: "low_confidence", durationDays: null };
  }

  // 4. The UC-03/UC-04 boundary: actively performing normal job duties from
  //    the destination belongs to the work-authorization pipeline. UC-03's
  //    only job is to ROUTE there — a normalized handoff event + audit + tag,
  //    never a live UC-04 call (workflow.js). Duration/destination are UC-04's
  //    compliance inputs, not gates here: a yes to "will they work?" is
  //    routed regardless of how long or where.
  if (classification.intent === "work_authorization") {
    flags.push("uc04_work_authorization");
    return {
      decision: "route_to_uc04",
      route: "uc04_work_authorization",
      flags,
      reason: "work_authorization_requested",
      durationDays: null,
    };
  }

  // 5. We cannot support (or rule out) a destination we were never told.
  //    Normalised HERE, once — every membership test below reads
  //    `destinationCountry`, never `classification.destinationCountry`, so a
  //    lowercase code cannot slip past the sanctions set (see the file header).
  const destinationCountry = normalizeCountryCode(classification.destinationCountry);
  if (!destinationCountry) {
    flags.push("destination_unknown");
    // D-04. NOT a new decision and NOT a new reason — this is still the same
    // "we were never told a destination" escalation. It is a second, additive
    // flag naming a DIFFERENT possibility the classifier read from the same
    // text: that the request may not be about travel at all (a landlord
    // letter, a lease, a mortgage — round-6 evidence, D-04). The requester-
    // facing wording this changes lives in src/portal/plainAnswer.js; the
    // gate ladder, GATE_SEQUENCE and this rung's own reason are untouched.
    if (classification.nonTravelSignal === true) flags.push("possible_non_travel_request");
    return { decision: "escalate", flags, reason: "destination_unknown", durationDays: null };
  }

  // 6. Sanctioned/restricted region -> HARD escalate, checked independently of
  //    (and BEFORE) the supported list. Even a destination that somehow
  //    appeared in the supported list is still blocked here — that's the point
  //    of the override.
  // The set itself is normalised too, not just the key: `sanctionedRegions`
  // and `supportedCountries` are caller-supplied (the latter straight from
  // `remote.listCountries()`), so normalising only one side would leave the
  // same case mismatch, just on the other end of the comparison.
  if (normalizeCountrySet(sanctionedRegions).has(destinationCountry)) {
    flags.push("sanctioned_region");
    return {
      decision: "escalate",
      flags,
      reason: "sanctioned_region",
      durationDays: null,
    };
  }

  // 7. Destination must appear in Remote's own country registry
  //    (`GET /v1/countries`). An empty/incomplete list fails CLOSED —
  //    unconfirmed escalates rather than guessing.
  //
  // WHAT THIS GATE ACTUALLY TESTS, AND WHY THE FLAG IS NAMED THAT WAY.
  // It used to say `unsupported_destination`, which asserts "Remote does not
  // support this country" — a claim this test cannot make. Remote publishes
  // several product-scoped country lists, and the one read here has a stated
  // membership rule that is neither about EOR capability nor about travel:
  // *"The countries present in the list are the ones where creating a company
  // is allowed"* ([CONFIRMED] —
  // <https://developer.remote.com/reference/get_v1_countries.md>). Its
  // exclusions are consequently the sanctioned / signup-prevented set (§4.2 of
  // the research note), which is exactly what a travel router wants from it and
  // exactly why the name now says *jurisdiction excluded* rather than
  // *unsupported*: a specialist reading the reason should be able to act on it,
  // and "unsupported" was not true in any sense they would recognise.
  //
  // RE-EXAMINED 2026-08-18 AND CONFIRMED, with evidence the original decision
  // did not have. Remote's own OpenAPI types the `destination_country` of BOTH
  // a travel-letter request AND a work-authorization request as the `Country`
  // schema — "A supported country on Remote", the exact row shape returned by
  // `GET /v1/countries` ([CONFIRMED], fetched 2026-08-18 from
  // developer.remote.com/reference/get_v1_travel-letter-requests.md and
  // .../get_v1_work-authorization-requests.md). So membership in this registry
  // is not an approximation of "may they go there" that this repo invented: it
  // is the set of destinations Remote's own mobility objects can even
  // represent. Neither object carries any destination-eligibility field, and
  // both end at `approved_by_remote`/`declined_by_remote` — the real
  // travel judgment is adjudicated per request by Remote's Mobility team, which
  // is what step 4 routes to and what this gate must not pretend to replace.
  //
  // DELIBERATELY NOT `eor_onboarding: true`. That field is documented as
  // *"whether Remote supports EOR onboarding in this country"* ([CONFIRMED] —
  // <https://developer.remote.com/docs/working-with-countries.md>) — an
  // employing-entity footprint signal, true for only 91 of the 224 rows.
  // Gating travel on it would escalate a French employee's trip to Martinique
  // and a German employee's fortnight in Montenegro, both `eor_onboarding:
  // false`, neither remotely a compliance problem. Whether Remote can *employ*
  // somewhere and whether an already-employed person may *visit* share a
  // country code and nothing else. Pinned by a positive test
  // (test/uc03.test.js, "Montenegro"): if someone later 'tightens' this to the
  // EOR flag, that test fails. Full argument:
  // `docs/research/COUNTRY-SUPPORT-SEMANTICS.md` §5 and §8.
  //
  // HISTORICAL AUDIT ROWS KEEP THE OLD STRING. `audit_log` is append-only, so
  // rows written before this rename still read `unsupported_destination`;
  // `rankExceptionReasons()` in src/metrics/compute.js folds the two together
  // explicitly rather than rewriting history.
  // 6b. …but FIRST: did we actually read the registry this gate is about to
  // consult? `listCountries()` used to coerce its own 404 to `[]`, so an
  // unreadable registry produced an empty set and the gate below reported
  // `destination_jurisdiction_excluded` — a claim about the destination's
  // jurisdiction, derived from an answer that never arrived. Same F-15/F-25
  // shape as UC-06's payroll gate: "could not fetch" quietly becoming a fact
  // about the data.
  //
  // POSITION IS DELIBERATE — after the sanctions override, before the registry
  // check. Sanctions are a hard block held locally and are still knowable when
  // Remote is unreachable, so a sanctioned destination must keep its own, more
  // actionable reason; everything below this line genuinely depends on the read.
  // `upstreamVerdict()` only ever returns an escalation, so this can change a
  // refusal's recorded reason and never turn one into an approval.
  const registryFailure = upstreamVerdict(findUpstreamFailure(upstreamFailures, "countries"));
  if (registryFailure) return { ...registryFailure, durationDays: null };

  if (!normalizeCountrySet(supportedCountries).has(destinationCountry)) {
    flags.push("destination_jurisdiction_excluded");
    return { decision: "escalate", flags, reason: "destination_jurisdiction_excluded", durationDays: null };
  }

  // 8. Deterministic day-count over the parsed dates. Missing dates -> cannot
  //    confirm under-cap -> escalate for information-gathering.
  const durationDays = computeDurationDays(classification.startDate, classification.endDate);
  if (durationDays === null) {
    flags.push("duration_unknown");
    return { decision: "escalate", flags, reason: "duration_unknown", durationDays };
  }

  // 9. Over-cap cumulative duration -> escalate to Global Mobility. A risk
  //    variable, not a re-router (per the boundary research).
  if (durationDays > durationCapDays) {
    flags.push("duration_over_cap");
    return { decision: "escalate", flags, reason: "duration_over_cap", durationDays };
  }

  // 10. An explicit request for a formal travel letter. TWO OUTCOMES, and the
  //    split is the point: is this the STANDARD template, or did the requester
  //    ask for something the template cannot say?
  //
  //    NEITHER OUTCOME ISSUES ANYTHING, and that is not a hedge — it is what
  //    Remote does. `TravelLetterRequest.status` documents `approved_by_remote`
  //    as *"Fully approved by both the manager and Remote. The travel letter
  //    will be generated"*, and the update body is a closed `oneOf` over
  //    `approved_by_manager` | `declined_by_manager`, so no client can even
  //    reach the generating state ([CONFIRMED] — developer.remote.com, fetched
  //    2026-08-20; UC-03.md §18). Remote self-serves the *employment
  //    verification* letter instantly from a template with nobody in the loop;
  //    it does not self-serve this one. Auto-issuing here would be strictly
  //    more permissive than the platform we are built against.
  //
  //    WHAT THE SPLIT CHANGES is what the human is asked to do. A standard
  //    request is a signature on a prepared document. A non-standard one is a
  //    document this system cannot prepare — and it used to be handed over as
  //    if it had been, because `renderTravelLetterHtml()` has fixed rows and no
  //    free-text block, so an addressee, a passport number or a required
  //    sentence was simply dropped and nothing recorded that it had been. See
  //    `letterScope.js` for why a model may only ever add a finding here.
  if (classification.formalLetterRequested) {
    const scope = assessLetterScope({ requestText, classification, employment, confidenceThreshold });
    if (!scope.standard) {
      flags.push(LETTER_SCOPE_EXCEEDED);
      // One flag per finding, so a specialist can filter on the CAUSE. The
      // prefix keeps them unmistakable in an `audit_log.details.flags` array
      // shared with identity, employment and destination flags.
      for (const finding of scope.findings) flags.push(`letter_${finding.code}`);
      // THE REASON IS A LITERAL, not the constant one line above, and that is
      // not an oversight. `test/gateLadder.test.js` scrapes THIS FILE for
      // `reason: "..."` strings to prove every rung documented in
      // GATE_SEQUENCE is still reachable and every reachable one is
      // documented. A constant is invisible to that scraper, so writing one
      // here would silently switch the drift guard off for this rung. The two
      // are pinned equal by test instead.
      return { decision: "escalate", flags, reason: "letter_scope_exceeded", durationDays };
    }

    // THE STANDARD LETTER FOR A QUALIFIED TRAVELLER ON A SHORT BUSINESS TRIP.
    //
    // WHAT "QUALIFIED" IS, AND WHY IT IS NOT A NEW TEST. It is every rung above
    // this one, and nothing else — reaching this line already means: identity
    // was proved against the authoritative record (rung 1), the employment is
    // ACTIVE (2), the reading of the request is one this router trusts (3-4),
    // the trip is BUSINESS TRAVEL rather than work performed abroad, because
    // work-authorisation intent left at rung 5, the destination was read (6),
    // is not sanctioned or restricted (7), the country registry was actually
    // READ (7b) and the destination is in it (8), and the trip's length is known
    // (9) and inside the cap (10). Rung 11 then established that the template
    // can say what was asked and that every row it asserts has a value behind
    // it. A second, tighter "short trip" number would be invented; the cap at
    // rung 10 is the band this repository already defines, and `SHORT` is what
    // being inside it means.
    //
    // WHY THIS IS 🟢 AND NOT A WEAKENING OF THE TIER MODEL. Prime directive 2's
    // 🟢 path is *validate -> auto-execute -> resolve, exception-gated*. Every
    // sentence of that describes this outcome: the gates are the validation, the
    // letter is the execution, and the exceptions — a non-standard ask, an
    // untrusted reading, an unqualified traveller, an unreadable letterhead —
    // each leave by their own rung with the document unwritten. What changed is
    // not the tier; it is the recognition that the SIGNATURE was gating the
    // routine case as well as the exceptional one.
    //
    // THE PLATFORM ARGUMENT THAT USED TO SIT HERE HAS MOVED, NOT VANISHED.
    // `1e14f46` read Remote's `TravelLetterRequest` and found generation
    // conditioned on `approved_by_remote`, unsettable by any client, and
    // concluded the signature should stay. That evidence is about REMOTE'S OWN
    // Request Hub flow, and this system does not call that endpoint: it renders
    // its own letter from the employment record it read. So there is no
    // platform to be more permissive than on this path, and the decision is
    // ours. `docs/use-cases/UC-03.md` §23 records the finding and why it does
    // not bind here, rather than dropping it — a reader who finds `1e14f46` and
    // not §23 would think this gate was removed by accident.
    //
    // TWO CAUSES REACH THE SIGNATURE, AND THE FLAGS SAY WHICH. They share a
    // reason because they are the same thing to the ladder — the standard letter
    // was not issued automatically — and they are opposite things to the person
    // who picks the case up: one has a prepared document to read and sign, the
    // other has nothing and needs a record fixed.
    if (!letterAutoIssue) {
      flags.push("formal_letter_requested");
      return { decision: "human_review", flags, reason: "formal_letter_requested", durationDays };
    }
    if (!letterheadAvailable) {
      flags.push("formal_letter_requested");
      // NAMES THE CAUSE, not just the outcome. Without it a specialist opening
      // this case sees a letter request waiting for a signature and goes looking
      // for the document to sign; there is none, and the reason is a record
      // problem rather than anything about the trip.
      flags.push("letterhead_unavailable");
      return { decision: "human_review", flags, reason: "formal_letter_requested", durationDays };
    }

    // NO FLAG IS PUSHED HERE, DELIBERATELY. `classifyRisk()` reads `flags` as
    // ESCALATION flags — any non-empty list raises a 🟢 use case to medium and
    // sets `escalated: true`, and `describeRiskPosture()` reports the length as
    // `escalatingFlagCount`. An auto-issued standard letter is the routine
    // outcome, so a flag here would make every successful issue read to the
    // sidebar as an escalated medium-risk case. The fact is carried where it
    // belongs: in the reason slug, and in the audit row's `autoIssue` block.
    return { decision: "auto_resolve", flags, reason: "standard_letter_issued", durationDays };
  }

  // All gates passed: safe to resolve the INQUIRY with an informational answer
  // (+ mandatory travel disclaimer). Note this is informational resolution —
  // no formal letter is generated on this path.
  return { decision: "auto_resolve", flags, reason: "all_gates_passed", durationDays };
}

// ---------------------------------------------------------------------------
// GATE_SEQUENCE  —  what each reason MEANS, and where in the order it sits
// ---------------------------------------------------------------------------
// Derived by reading evaluate() above top to bottom, NOT from the header
// comment (which numbers gates informally and omits the terminal outcome).
// One row per REASON — a single gate can refuse several ways and each way
// means something different to a person — in the exact order evaluate() can
// produce them. `checks` is the PASSING condition; `means` is what it is to a
// human when that reason is the one that decided. The raw slug stays visible
// beside the prose: it is what `audit_log`, the metrics exception ranking and
// the n8n port all key on, so it is the string somebody searches by.
//
// Two rungs here are ROUTES, not refusals: position 3 hands the request to
// UC-04, and position 9 sends a drafted letter to a specialist. Their `means`
// says so, rather than implying something was wrong with the request.
// ---------------------------------------------------------------------------
export const GATE_SEQUENCE = Object.freeze([
  {
    position: 1,
    reason: "identity_not_verified",
    gate: "identity",
    checks: "the person asking is the authenticated employee the travel request is about",
    means:
      "We could not confirm the person asking is the employee this trip is for, so nothing about their employment or travel was answered. This is a failure to VERIFY — it is not a finding that they are someone else.",
  },
  {
    position: 2,
    reason: "employee_not_active",
    gate: "employment_status",
    checks: "the employment record is active",
    means:
      "The employment record is not active, so there is no live employment to give travel support against. A former or suspended employee's travel is not something this can answer.",
  },
  {
    position: 3,
    reason: "confidence_unknown",
    gate: "classification_confidence",
    checks: "the classifier reported a usable confidence in what this request is",
    means:
      "How sure we are about what this request is asking could not be established at all, so the reading of it was not acted on. A person confirms what is being asked before anything is decided. Nothing has been concluded about the trip itself.",
  },
  {
    position: 4,
    reason: "low_confidence",
    gate: "classification_confidence",
    checks: "the classifier is confident enough in what this request is",
    means:
      "What this request is asking for could not be read confidently enough to act on, so a person reads it first. A request understood wrongly here would be answered wrongly in every way that follows. This says nothing about whether the trip is allowed.",
  },
  {
    position: 5,
    reason: "work_authorization_requested",
    gate: "intent_routing",
    checks: "the request is about the travel itself, not about being allowed to work from the destination",
    // THIS SENTENCE HAS BEEN WRONG TWICE, IN OPPOSITE DIRECTIONS, AND THE SECOND
    // TIME IS THE INSTRUCTIVE ONE.
    //
    // First it was FALSE: it read "It has been handed to the work-authorisation
    // case (UC-04)", and nothing is handed to anything — `workflow.js` builds a
    // handoff event, records it and returns it for inspection. The requester who
    // went and looked found an empty queue, which is the correct thing to find
    // and the opposite of what this text told them.
    //
    // The correction was true and it was written for the wrong reader. Every
    // clause of it was about US — "this use case", "this router", "no UC-04
    // queue holding this request", "the handoff event recorded on this decision"
    // — delivered to an employee who had asked whether they may work from
    // Portugal for a month. The project owner's report: "the user asked a simple
    // question… the answer should not be that thing." `docs/UI-AUDIENCES.md` is
    // the standing rule, and the failure it names is exactly this one: the text
    // passed *is it accurate, is it cited, does it overstate* and nothing was
    // checking whether it answered a question its reader had.
    //
    // THIS STRING HAS TWO AUDIENCES, WHICH IS WHY THE INTERNAL DETAIL IS NOT
    // SIMPLY DELETED. `means` is published to the employee's own result page
    // (src/portal/server.js's `gateNarration()`, under "What happened") AND into
    // the specialist's Zendesk note. `docs/UI-AUDIENCES.md`'s routing test comes
    // first: "useless to THIS reader, or to everyone?" — and "no UC-04 case was
    // created, nothing is in a UC-04 queue" is genuinely useful to the
    // specialist, so it MOVED rather than went. It is still stated, twice, on
    // the surfaces that reader has: `describeUc04Intake()`'s literal
    // `dispatched: false` / `uc04RecordCreated: false` and the note
    // `workflow.js` STEP 8 composes around it. Nothing was lost from the record.
    //
    // WHAT THE EMPLOYEE KEEPS, and each is here because its absence costs them
    // something concrete: that nothing is in flight (otherwise they wait for an
    // answer that is never coming), what to do next, and what that will ask them
    // for (otherwise they are sent to a form that refuses them).
    //
    // NO COUNT, DELIBERATELY. This sentence used to say "four things" and name
    // four — the four inputs UC-03 can never source. The portal's continuation
    // page shows the run's OWN still-missing list (`describeUc04Intake().missing`
    // via src/portal/uc03Continuation.js), which is those four PLUS anything this
    // particular request did not state: on the Portugal example, which carries no
    // dates, that is five. Both numbers are correct answers to different
    // questions, and a static string cannot hold the second — so it names the
    // items and asserts no total. The list is still derived from
    // UC04_REQUIRED_INPUTS rather than retyped, so it cannot drift from the list
    // the drift test pins.
    //
    // AND IT MUST NOT READ AS PERMISSION. This rung decides nothing about
    // eligibility, and some destinations are refused outright at the next stage.
    means:
      "Nothing has been submitted on the employee's behalf and nobody is reviewing anything — this answer is the whole of what has happened so far. " +
      "The next step is a work-authorization request the employee raises themselves in Remote's Request Hub, and it asks for details a travel message never states: " +
      UC04_INPUTS_UC03_CANNOT_SOURCE.join(", ") +
      ". Whether working from the destination is allowed is settled on that request, and it has not been settled yet.",
  },
  {
    position: 6,
    reason: "destination_unknown",
    gate: "destination_known",
    checks: "the request names a destination country",
    // round-6 D-07: this used to read "...which country THE EMPLOYEE is
    // travelling to... Where THEY are going has to be established..." — third
    // person about the reader, on a sentence gateNarration() (server.js) sends
    // to BOTH audiences unchanged: the employee's own result page AND the
    // specialist's Zendesk note (see the large comment on `route_to_uc04`
    // above, which explains why `means` is shared rather than split). "You"
    // would be equally wrong the other direction — correct when the employee
    // reads it, wrong when a specialist reads it about someone else's trip.
    // Naming no person at all is the sentence that is true from both seats.
    means:
      "This request does not say which country is the destination, in a form that could be used — so nothing about the destination has been checked. The destination has to be established before anything else about the trip can be.",
  },
  {
    position: 7,
    reason: "sanctioned_region",
    gate: "sanctions",
    checks: "the destination is not on the sanctioned or restricted list",
    means:
      "The destination is on the sanctioned or restricted list. This is not a support question at all — Global Mobility owns it, and no extra information from the employee changes that.",
  },
  {
    position: 8,
    reason: "destination_jurisdiction_excluded",
    gate: "supported_destination",
    checks: "the destination appears in Remote's supported-country registry",
    means:
      "The destination could not be CONFIRMED as a country Remote supports. That may be because Remote does not support it, or because Remote's list of countries could not be read when this was answered — either way it is unconfirmed, which is not the same as confirmed-bad.",
  },
  {
    position: 9,
    reason: "duration_unknown",
    gate: "duration_computable",
    checks: "the request carries a start and an end date the system can count between",
    means:
      "Usable travel dates could not be read out of the request, so the length of the trip is unknown. The trip is not too long — nobody has established how long it is.",
  },
  {
    position: 10,
    reason: "duration_over_cap",
    gate: "duration_cap",
    checks: "the trip is within the travel-duration cap for a straightforward informational answer",
    means:
      "The trip is longer than the cap for an automatic informational answer, so Global Mobility weighs it instead. Length is a risk signal here, not a refusal — a longer trip is allowed to be fine, it just is not decided here.",
  },
  {
    position: 11,
    reason: "letter_scope_exceeded",
    gate: "letter_within_template",
    checks:
      "a requested letter is the standard template — every row it asserts has a value, and nothing outside the template was asked for",
    means:
      "A formal travel letter was asked for, and it is not the standard one. The request asks for something the standard letter cannot express — a named addressee asked for in a sentence, particular wording, an identity document, a statement of who bears the costs, another language, or a row removed — or a row it states has no value behind it. NO LETTER WAS DRAFTED, deliberately: the standard one would have left out what was asked for without saying so, and that is the document somebody would then have been asked to sign. Everything that was asked for is listed with this request, beside what the standard letter cannot carry and why.",
  },
  {
    position: 12,
    reason: "formal_letter_requested",
    gate: "letter_issuable",
    checks: "a requested letter may be issued automatically and has an employing entity to be written on",
    means:
      "The standard letter was asked for and the trip qualifies for it, but it was not issued automatically. There are two reasons that can happen and this request is one of them: either every travel letter here needs a specialist's signature, in which case the letter IS drafted and is waiting for one — or the employing entity could not be read, in which case there is no letterhead, NOTHING WAS DRAFTED, and what is owed is a fix to the employing-entity record and a re-run rather than a signature. Every check about the trip itself passed either way.",
  },
  {
    position: 13,
    reason: "standard_letter_issued",
    gate: "standard_letter",
    // WHAT THIS RUNG TESTS — after a sentence that said the opposite. `checks`
    // read "the request is informational and does not ask for a formal travel
    // letter", which is the condition for the rung BELOW this one (14,
    // `all_gates_passed`) and the exact inverse of what lands here. It is
    // leftover wording from before `7061c40` split the letter path in two, and
    // it reached a real requester: their letter was correctly written and
    // issued, and the page told them the deciding gate checks that they had
    // not asked for one. The condition for THIS rung is the letter branch
    // itself — `classification.formalLetterRequested` true, having cleared the
    // scope rung and the issuable rung above it. There is no further test
    // here, which is why the second half names the rungs rather than a new
    // predicate.
    checks: "the request asks for the standard travel letter, and every rung above it passed",
    means:
      "The employee asked for the standard travel letter, every check passed, and there was a letterhead to write it on — so it was written and issued to them straight away, with nobody in the path. This is the routine outcome this path is built for: checked, produced and closed in one pass. A letter that is NOT the standard one, a request that could not be read confidently, a traveller who does not qualify, or an employing entity that could not be read each stops earlier, with the document unwritten.",
  },
  {
    position: 14,
    reason: "all_gates_passed",
    gate: "outcome",
    checks: "every gate above passed",
    means:
      "Every check passed, so the question was answered directly, with the standing note that entry requirements are the destination's to set. No formal travel letter was written — none was asked for, and an answer is not a letter. One is offered for the same trip, and accepting it does not mean describing the trip again.",
  },
]);

const descriptions = bindGateDescriptions(GATE_SEQUENCE);

/**
 * Which gate decided this outcome, and what that means in plain words.
 * Returns null for a reason with no row — see shared/gateLadder.js.
 * @param {string} reason  the slug evaluate() returned
 */
export const describeDecidingGate = descriptions.describeDecidingGate;

/**
 * The whole ordered ladder, each rung marked passed / decided / not_reached.
 * @param {string} reason  the slug evaluate() returned
 */
export const describeGateLadder = descriptions.describeGateLadder;

/**
 * A code the letter-scope check declared, in words rather than in its slug
 * form. `request_text` and `template_completeness` are the names those checks
 * are DECLARED by in `letterScope.js`, and they belong in the stored finding;
 * they do not belong on a line a travel specialist reads, where an underscore
 * is a piece of this codebase's vocabulary leaking onto their screen. Derived
 * from the code rather than mapped to a hand-written label, so a check added
 * there cannot arrive here with no name at all — the trade is that the words
 * are only as good as the code, and a properly written label belongs beside
 * the codes themselves.
 * @param {string} code
 */
function humanise(code) {
  return String(code).replace(/_/g, " ");
}

/**
 * THE FIGURES BEHIND THE ROUTE OR THE REFUSAL.
 *
 * `means` above says what happened; this says what it happened TO. UC-03 is 🟢,
 * so a person only ever sees the exceptions, and every one of them was reaching
 * that person as a slug, a flag list and a sentence with no numbers in it.
 * `duration_over_cap` is the exact twin of UC-02's `over_policy_cap` (C-27):
 * this router computes the day count and compares it against a cap, holds both
 * figures at the instant it refuses, and told the specialist only that the trip
 * was "longer than the cap".
 *
 * P9 IS THE CONSTRAINT HERE, NOT P7. UC-03 is where the log's most recent
 * correction landed (C-31): the panel said a request "has been handed to the
 * work-authorisation case (UC-04)" when nothing was sent anywhere. Adding detail
 * is exactly the opportunity to re-assert that. So the `work_authorization_requested`
 * bundle below states `dispatched: false` as a literal — matching what
 * `uc04Intake.js` records — and every fact about a "next step" describes what
 * the PERSON must do, never something the system did.
 *
 * THE SUPPORTED-COUNTRY REGISTRY IS COUNTED, NOT ASSUMED. An empty registry and
 * a 224-row registry produce the same refusal for a destination that is not in
 * it, and they are opposite situations — one means the read failed, the other
 * means Remote genuinely excludes that country. The count is the fact that tells
 * them apart, and when the caller cannot supply it (a view rebuilt from a stored
 * case row) it is an explicit unknown rather than a zero, because a zero here
 * would read as "the registry was empty", which is a finding.
 *
 * PURE, AND IT DECIDES NOTHING — `evaluate()` neither calls it nor can see it.
 *
 * @param {object} args
 * @param {string} args.reason  the slug evaluate() returned
 * @param {object|null} [args.employment]
 * @param {object|null} [args.classification]
 * @param {object|null} [args.identity]
 * @param {Set<string>|null} [args.supportedCountries]  pass null (not an empty
 *   set) when the caller does not have it — see the header.
 * @param {Array<object>} [args.upstreamFailures]
 * @param {number} [args.durationCapDays]
 * @param {number} [args.confidenceThreshold]
 * @param {Set<string>} [args.sanctionedRegions]
 * @param {string|null} [args.requestText]  the employee's own words — read only
 *   by the `letter_scope_exceeded` bundle
 * @returns {{reason:string, sentence:string,
 *            facts:import("../shared/decisionFacts.js").DecisionFact[]}|null}
 */
export function describeDecisionFacts({
  reason,
  employment = null,
  classification = null,
  identity = null,
  supportedCountries = null,
  upstreamFailures = [],
  durationCapDays = DEFAULT_DURATION_CAP_DAYS,
  confidenceThreshold = DEFAULT_CONFIDENCE_THRESHOLD,
  sanctionedRegions = SANCTIONED_OR_RESTRICTED,
  // Only `letter_scope_exceeded` reads it, and it re-runs the same pure
  // assessment `evaluate()` ran rather than being handed the result — this
  // function is called from surfaces rebuilding a view out of a stored case
  // row, where the outcome object is long gone but the text is on the row.
  requestText = null,
}) {
  const c = classification ?? {};
  const destination = normalizeCountryCode(c.destinationCountry);
  const days = computeDurationDays(c.startDate, c.endDate);
  const registrySize = supportedCountries ? normalizeCountrySet(supportedCountries).size : null;
  const registryFailed = Boolean(findUpstreamFailure(upstreamFailures, "countries"));

  // WHO SAID EACH FIGURE, when the request carried fields as well as prose.
  // `null` whenever it did not, and every line below then reads exactly as it
  // always has — the labels and notes only change on a decision where there is
  // something new to say.
  const provenance = c.statedTrip?.provenance ?? null;
  const statedProblems = c.statedTrip?.problems ?? [];

  /**
   * One itinerary row, labelled and annotated by WHERE THE VALUE CAME FROM.
   *
   * "as read" is a claim about provenance, and on a request where the traveller
   * typed the destination into a picker it is a false one — the specialist
   * reading it would go looking for the sentence it was read out of. A fact the
   * traveller asserted and one a model inferred from prose call for different
   * things from the person holding them: the first is checked with the
   * traveller, the second is checked against the traveller's own words.
   */
  const itineraryFact = (field, noun, value, classifiedNote) => {
    const source = provenance?.[field] ?? null;
    if (source === STATED) return fact(`${noun} as stated`, value, PROVENANCE_NOTES[STATED]);
    return fact(`${noun} as read`, value, classifiedNote);
  };

  /** The itinerary as this decision had it — wanted by most of these bundles. */
  const itineraryFacts = () => [
    itineraryFact(
      "destinationCountry",
      "Destination",
      destination,
      "where this request says the employee is going, read out of their own words — nobody has confirmed it against a booking, an invitation or any other record"
    ),
    itineraryFact("startDate", "Start date", c.startDate),
    itineraryFact("endDate", "End date", c.endDate),
    ...statedProblemFacts(),
  ];

  /**
   * WHAT THE TRAVELLER ENTERED AND THIS SYSTEM DID NOT USE.
   *
   * Not an aside. A person who typed a date into a box believes the decision was
   * made on it, so a refusal that never mentions the discarded value reads as a
   * finding about their trip rather than about their keystroke — and the
   * specialist picking the case up has no way to know a value was offered at
   * all. One row per problem, each naming what was received. Empty on every
   * request that carried no fields, which is most of them.
   */
  function statedProblemFacts() {
    return statedProblems.map((p) =>
      unknownFact(
        p.label ?? "A value entered on the request",
        `${p.detail}${p.received ? ` Received: "${p.received}".` : ""}`
      )
    );
  }

  switch (reason) {
    case "identity_not_verified":
      return decisionFacts(
        reason,
        IDENTITY_SENTENCE[identity?.reason] ??
          "The identity check did not pass, and the signal it failed on was not recorded on this decision.",
        [
          fact("Identity signal used", identity?.method, "session = an authenticated login; none = no session was present"),
          fact("What was missing", identity?.reason),
          employment
            ? fact("Employment record read", employment.id)
            : unknownFact(
                "Employment record read",
                "Remote returned no record for this employment id, so there was nothing to check an identity against. Confirm the employment id on this request is the right one before treating this as an identity problem."
              ),
        ]
      );

    case "employee_not_active":
      return decisionFacts(
        reason,
        `The employment record's status is "${employment?.status ?? "not recorded"}", so there is no live employment to give travel support against.`,
        [
          fact("Status on the record", employment?.status),
          fact("Employment id", employment?.id),
          fact("Home country on the record", employment?.country_code),
        ]
      );

    case "confidence_unknown":
      return decisionFacts(
        reason,
        `The classifier returned no usable confidence figure, so nothing could be compared against the ${confidenceThreshold} threshold.`,
        [
          unknownFact(
            "Confidence reported",
            `Absent, or not a number. This is not a low score — a low score would be a figure below ${confidenceThreshold}, and this is no figure at all.`
          ),
          fact("Threshold it would have been compared against", confidenceThreshold),
          fact("Which reader produced the classification", c.source),
          fact("Intent it reported anyway", c.intent, "reported, but NOT acted on — everything decided after this point rests on this reading, which is why nothing was decided on it"),
        ]
      );

    case "low_confidence":
      return decisionFacts(
        reason,
        `The classifier reported ${c.confidence} against a ${confidenceThreshold} threshold, so the intent it read was not acted on.`,
        [
          fact("Confidence reported", c.confidence),
          fact("Threshold", confidenceThreshold),
          fact("Intent it read", c.intent, "not acted on — confirm this first, because it decides which pipeline the request belongs to"),
          fact("Which reader produced it", c.source, "llm = the model answered; rule_based_fallback = the rules answered because the model was unreachable or returned an invalid shape"),
          ...itineraryFacts(),
        ]
      );

    case "work_authorization_requested":
      // EVERY SENTENCE HERE IS ABOUT WHAT A PERSON MUST DO. Nothing below
      // asserts an action by the system, because the system took none — see the
      // header and C-31. `Dispatched to UC-04` is stated as the literal "no"
      // rather than omitted, because an absent row is an inference and a
      // reviewer already read one absence the wrong way once.
      return decisionFacts(
        reason,
        "The employee intends to work while away, which is a work-authorisation question. UC-03 decided nothing further about it — not the destination, not the duration — and sent nothing anywhere.",
        [
          fact("Dispatched to UC-04", "no", "no work-authorisation case was created and no UC-04 queue holds this — there is nothing to go and look at"),
          fact("What exists instead", "a handoff event recorded on this decision", "the trip as this router read it, for the person picking this ticket up"),
          ...itineraryFacts(),
          fact("Home country on the record", employment?.country_code),
          fact(
            "What a work-authorisation request needs that a travel ticket never states",
            UC04_INPUTS_UC03_CANNOT_SOURCE.join(", "),
            "the employee raises that request in Remote's own Request Hub"
          ),
        ]
      );

    case "destination_unknown":
      return decisionFacts(
        reason,
        "No destination country could be read out of the request, so neither the sanctions check nor the registry check could run at all.",
        [
          unknownFact(
            "Destination",
            "No country code could be established from this request — nothing was entered as a field and none could be read from the text. Ask the employee where they are going; nothing below this gate has been evaluated."
          ),
          itineraryFact("startDate", "Start date", c.startDate),
          itineraryFact("endDate", "End date", c.endDate),
          fact("Which reader produced the classification", c.source),
          ...statedProblemFacts(),
        ]
      );

    case "sanctioned_region":
      return decisionFacts(
        reason,
        `${destination ?? "The destination"} is on the sanctioned or restricted list, so Global Mobility owns this and no further information from the employee changes it.`,
        [
          fact("Destination", destination),
          fact("Trip length as read", days === null ? null : `${days} days`, "recorded for context only — a sanctioned destination is refused at any length"),
          fact(
            "The restricted list this was matched against",
            [...normalizeCountrySet(sanctionedRegions)].sort().join(", "),
            "an illustrative demonstration set, NOT Remote's authoritative compliance list — the real one comes from the compliance team"
          ),
        ]
      );

    case "destination_jurisdiction_excluded":
      return decisionFacts(
        reason,
        registrySize === 0
          ? `${destination ?? "The destination"} could not be confirmed against Remote's country registry because that registry came back EMPTY — this is an unread list, not a finding about the destination.`
          : `${destination ?? "The destination"} is not present in Remote's country registry as read on this run${registrySize === null ? "" : ` (${registrySize} countries)`}.`,
        [
          fact("Destination", destination),
          registrySize === null
            ? unknownFact(
                "Countries in the registry on this run",
                "Not carried on this record. The decision's own audit entry lists the countries this destination was checked against (recorded there as `supportedCountriesChecked`) — an empty list there means the registry could not be read, not that the destination is excluded."
              )
            : fact("Countries in the registry on this run", registrySize, registrySize === 0 ? "ZERO — the gate had nothing to match against, so this refusal describes our read and not the destination" : "the exact list this destination was checked against"),
          fact("Registry read failed", registryFailed ? "yes" : "no"),
          fact(
            "What registry membership means",
            "the countries where Remote allows a company to be created",
            "the same list Remote draws the destination from on its own travel-letter and work-authorisation requests — it is NOT a list of where Remote can employ people"
          ),
        ]
      );

    case "duration_unknown":
      return decisionFacts(
        reason,
        "Usable travel dates could not be read out of the request, so the length of the trip is unknown. The trip is not too long — nobody has established how long it is.",
        [
          c.startDate
            ? itineraryFact("startDate", "Start date", c.startDate)
            : unknownFact("Start date", "Neither entered on the request nor readable from what the employee wrote."),
          c.endDate
            ? itineraryFact("endDate", "End date", c.endDate)
            : unknownFact("End date", "Neither entered on the request nor readable from what the employee wrote."),
          unknownFact(
            "Trip length",
            `Not computable from the dates above. It is NOT zero and it is NOT within the ${durationCapDays}-day cap — it is uncounted.`
          ),
          itineraryFact("destinationCountry", "Destination", destination),
          ...statedProblemFacts(),
        ]
      );

    case "duration_over_cap": {
      // THE UC-03 TWIN OF `over_policy_cap`. Both figures and the difference,
      // for the same reason C-27 gave: "longer than the cap" is a comparison,
      // and showing one side of a comparison is showing none of it.
      const over = days === null ? null : days - durationCapDays;
      return decisionFacts(
        reason,
        days === null
          ? `The trip was measured as longer than the ${durationCapDays}-day cap, but the day count is not on this record.`
          : `${days} days against a ${durationCapDays}-day cap — ${over} day${over === 1 ? "" : "s"} over.`,
        [
          fact("Trip length", days === null ? null : `${days} days`, "counted deterministically from the two dates, inclusive of both — never a figure the classifier supplied"),
          fact("Cap for an automatic informational answer", `${durationCapDays} days`),
          fact("Over by", over === null ? null : `${over} days`),
          ...itineraryFacts(),
          fact(
            "What being over the cap does NOT mean",
            "that the trip is disallowed",
            "length is a risk signal here, not a refusal — Global Mobility weighs it, and a longer trip is allowed to be fine"
          ),
        ]
      );
    }

    case "letter_scope_exceeded": {
      // THE FINDINGS ARE THE FACTS. A specialist picking this up is being asked
      // to produce a document this system could not, so the one thing they need
      // is WHAT was asked and WHY the template cannot say it — not a slug. Each
      // finding carries its own source, so "Remote collects this field and we
      // do not" is distinguishable from "a model thought it saw something".
      const scope = assessLetterScope({
        requestText,
        classification,
        employment,
        confidenceThreshold,
      });
      const asked = scope.findings.filter((f) => f.foundBy !== "template_completeness");
      const holes = scope.findings.filter((f) => f.foundBy === "template_completeness");
      return decisionFacts(
        reason,
        asked.length && holes.length
          ? `${asked.length} thing${asked.length === 1 ? "" : "s"} were asked for that the standard template cannot say, and ${holes.length} row${holes.length === 1 ? " it asserts has" : "s it asserts have"} no value. No letter was drafted.`
          : asked.length
            ? `${asked.length} thing${asked.length === 1 ? " was" : "s were"} asked for that the standard template cannot say. No letter was drafted — the template would have omitted ${asked.length === 1 ? "it" : "them"} silently.`
            : `${holes.length} row${holes.length === 1 ? "" : "s"} the template asserts ${holes.length === 1 ? "has" : "have"} no value behind ${holes.length === 1 ? "it" : "them"}, so the letter would print a placeholder where a consulate reads a fact. No letter was drafted.`,
        [
          fact("Letter drafted", "no", "deliberately — a template that cannot say what was asked produces a document nobody should sign"),
          ...scope.findings.map((f) =>
            fact(f.label, f.detail, `found by: ${humanise(f.foundBy)} · ${f.source}`)
          ),
          fact("What was checked", scope.checked.map(humanise).join(", "), "every check that ran, so a clean one is visible as well as a failed one"),
          ...itineraryFacts(),
          fact(
            "What this is NOT",
            "a refusal of the trip",
            "every gate above this one passed — the trip is fine and the DOCUMENT is what cannot be produced here"
          ),
        ]
      );
    }

    case "formal_letter_requested":
      // THE ONLY WAY THIS RUNG IS REACHED NOW. A standard letter for a
      // qualifying trip issues at rung 13 without a signature; what stops here
      // is a letter this system was asked for, is allowed to write, and has
      // nowhere to write it. Every fact below therefore points at the RECORD,
      // not at the trip — a specialist sent looking for a document to sign
      // would find none, which is what `letter_missing` refuses by name.
      return decisionFacts(
        reason,
        "The standard travel letter was asked for and the trip qualifies for it, but it was not issued automatically. Either every travel letter here requires a signature, or the employing entity could not be read and there was no letterhead to write on — the flags say which. Every gate about the trip passed.",
        [
          fact("Letter drafted", "see the flags on this decision", "a `letterhead_unavailable` flag on this decision means no document exists, and the sign-off screen refuses this case for that reason; without that flag the letter is drafted and waiting for a signature"),
          fact(
            "Letter scope",
            "standard",
            "the request asked for nothing the template cannot express, and every row the template asserts has a value — so nothing about the ASK is what stopped this"
          ),
          fact("Employing entity on the record", employment?.legal_entity_id, "the id the letterhead is read from; absent here means the employment record names no entity at all"),
          fact(
            "What is owed here",
            "a signature if the letter is drafted; a fix to the employing-entity record and a re-run if it is not",
            "the two are opposite jobs and the `letterhead_unavailable` flag is what tells them apart"
          ),
          ...itineraryFacts(),
          fact("Trip length", days === null ? null : `${days} days`),
          fact("Cap this stayed within", `${durationCapDays} days`),
        ]
      );

    case "standard_letter_issued":
      // A SUCCESS BUNDLE, WHICH THIS FUNCTION OTHERWISE NEVER RETURNS. Every
      // other case here explains a refusal, and `all_gates_passed` returns null
      // for exactly that reason. This one is different because the outcome is an
      // ACT: a document left the building with nobody in the path, so the
      // figures that authorised it are the only account of why. `audit_log`'s
      // `autoIssue` block records the same facts durably; this is the half a
      // reader sees.
      return decisionFacts(
        reason,
        `The standard travel letter was written and issued with no signature: every gate passed, the request asked for nothing the template cannot say, and the trip is ${days === null ? "inside" : `${days} days against a ${durationCapDays}-day`} cap.`,
        [
          fact("Letter issued", "yes", "issued to the employee with nobody in the path — that is the intended outcome for a routine trip, not a control that was skipped"),
          fact(
            "What stood in for a signer",
            "every gate above this rung, and the letter-scope check",
            "the checks listed on this decision mark each one, and the decision's audit entry records the same list beside a fingerprint of the exact document that was issued"
          ),
          fact(
            "Letter scope",
            "standard",
            "nothing outside the template was asked for and every row it asserts has a value — a request for a named addressee, particular wording, an identity document, a cost statement, another language or a row removed would have stopped at the rung above"
          ),
          ...itineraryFacts(),
          fact("Trip length", days === null ? null : `${days} days`, "counted deterministically from the two dates, inclusive of both"),
          fact("Cap this stayed within", `${durationCapDays} days`),
          fact(
            "What this letter still does NOT assert",
            "a work authorisation, or any view on visa or entry requirements",
            "it confirms employment and the professional nature of the travel; the destination authority sets entry rules and this document does not speak to them"
          ),
        ]
      );

    default:
      // all_gates_passed. Nothing was refused and nothing routed, so there are
      // no figures behind a refusal; the informational answer itself carries the
      // itinerary. null rather than an empty bundle, so a renderer shows nothing
      // rather than an empty panel that reads like missing data.
      return null;
  }
}

/** What each identity failure actually is, in the reviewer's terms. */
const IDENTITY_SENTENCE = Object.freeze({
  no_employment_record:
    "Remote returned no employment record for the id on this ticket, so there was nothing to verify the requester against. This is a record problem before it is an identity one.",
  session_employment_mismatch:
    "The requester is signed in, but as a DIFFERENT employee from the one this request is about. That is an access attempt on somebody else's record, not a verification gap.",
  unauthenticated_requires_stepup:
    "The request arrived with no authenticated session at all, so the requester's identity rests on a claim. Step-up verification is needed before anything is answered.",
});
