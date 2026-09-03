// ---------------------------------------------------------------------------
// decisionFacts.js  —  What the mobility specialist is actually deciding on
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
//
// C-27 (docs/CORRECTIONS-LOG.md, pattern P7): UC-02 told a Finance Ops
// specialist a claim was "above the policy cap" while holding the claimed
// amount, the cap, the overage and the percentage. The sentence was TRUE, which
// is exactly why no test caught it — there is no assertion for "said less than
// it knew". The generalisation of that defect to the 🟡 tier is this file's
// subject: UC-04 hands a mobility specialist `riskLevel: "medium"` and a flat
// array of flags, and leaves them to reconstruct WHY.
//
// UC-04.md is unusually specific about what that person needs, and it is not a
// level:
//
//   §5  "deterministic 4-dimension gate, each independently confirmed or escalated"
//   §6  the LLM "must NOT ... collapse the 4 dimensions into one score"
//   §7  "4 independent gating dimensions (§5), NEVER collapsed into a single
//        composite score — each must be confirmed with high confidence or the
//        case escalates"
//   §10 log "all 4 dimension results + confidence ... cumulative day count + window"
//   §13 "ZAF specialist panel with per-dimension summary"
//
// `riskLevel` IS that composite score. It is a legitimate routing input — it is
// what policyEngine.js turns into an escalation — but it is the one thing the
// spec says a person must not be shown INSTEAD of the four. This file puts the
// four back, from data the row already holds.
//
// PURE, AND IT DECIDES NOTHING. Same contract as describeDecidingGate() and
// describeGateLadder() in policyEngine.js, and describeCapComparison() in
// UC-02's: it describes a decision already made and already stored. No gate
// reads it, no approval consults it, and it takes no client of any kind. A
// describer that could change an outcome would be a fifth gate nobody reviewed.
//
// IT READS THE PERSISTED ROW AND NOTHING ELSE. Everything here comes off
// `uc04_authorizations` (`factors`, `risk`, `tripDays`, `cumulativeDays`,
// `flags`), which is what the API view has in hand. Two consequences are
// deliberate rather than incidental:
//   - It works identically for a row read back from Supabase days later and for
//     one still in memory. There is no "only fresh decisions can be explained".
//   - Where the row genuinely does not hold a figure — the Schengen window's
//     measured total, the travel document on file — this says so as an explicit
//     unknown and names what it would take. It never re-derives a number from
//     inputs it does not have, and it never defaults one.
//
// THE TWO DISCIPLINES, AND THEY PULL OPPOSITE WAYS.
//   NEVER INVENT, NEVER DEFAULT. A `cumulativeDays` of `{days: 0,
//   periodsCounted: 0}` is NOT "this employee has spent no days there". It is
//   "no travel history was supplied with the request", and 0 is a FLOOR rather
//   than a count — the same distinction src/portal/server.js draws about its own
//   copy of that number. A defaulted value that looks like a measurement is
//   worse than a blank, so that case reports `state: "unknown"`.
//   DO NOT DUMP THE RECORD. Four dimensions, in the spec's own order, each with
//   one finding sentence and its evidence — not forty fields for the specialist
//   to search. `deciding` is lifted out first so the fact that settled the case
//   is not something to hunt for, and `measurements` carries only the thresholds
//   that actually applied to THIS trip.
//
// TWO BLOCKS ADDED 2026-08-19, BOTH ANSWERING QUESTIONS THIS FILE COULD NOT.
//   `requester` — who filed this, about whom, on what surface, and which of
//   those the row does not hold. A workation request is made by one party about
//   another and the identity gate is a comparison between them; a screen that
//   says only "Filed by: Jane Doe" cannot be used to judge whether the request
//   is even coherent.
//   `sources` — where the rule behind each finding can be READ. The repository
//   gained a 35-document statutory corpus on 2026-08-19 and none of it reached
//   the screen where somebody clicks approve. The map lives in
//   `decisionSources.js`; read its header before touching either. It is
//   hand-curated on purpose, it never presents a source as advice, and where a
//   check applies a rule the source contradicts it says so beside the finding —
//   which is the most valuable thing here and the reason it is not optional.
//
//   Neither block changes a gate, a threshold or a decision, and neither can:
//   both are computed after the fact from the same row.
// ---------------------------------------------------------------------------

import { normalizeCountryCode } from "../shared/countryCodes.js";
/* NAMES IN PROSE, NOT CODES (2026-08-31). Three findings on this page
   interpolated a raw alpha-2 code or a raw enum slug into a sentence that sat
   directly above an evidence row rendering the SAME value in words: "PT is
   inside the Schengen area" over "Destination: Portugal", and "Duties are
   'engineering'" over "Job duties: Engineering". The rows get named because
   zaf-app/assets/country.js lists their labels as country-valued; prose is not
   eligible and never will be, so the naming has to happen here. Same argument
   the sidebar already makes for the trip line: a reader should not decode two
   countries before they have read a single finding. */
import { countryLabel } from "../shared/countryNames.js";
import { describeRequesterParties } from "../shared/requesterSubject.js";
import {
  SCHENGEN,
  DNV_COUNTRIES,
  DNV_COUNTRIES_PROVENANCE,
  JOB_DUTY_CATEGORIES,
  SCHENGEN_LIMIT_DAYS,
  SCHENGEN_WINDOW_DAYS,
  LEAD_TIME_MINIMUM_DAYS,
  LEAD_TIME_RECOMMENDED_DAYS,
} from "./riskMatrix.js";
// Pure data plus two lookups — no client, no clock, no I/O. See that file's
// header for why it is a hand-curated map and not a retriever.
import {
  sourcesForFinding,
  uncitedFinding,
  SOURCE_FRAMING,
  CAVEAT_FRAMING,
  CONFIRMATION_FRAMING,
  RETRIEVAL_METHOD,
} from "./decisionSources.js";
import { servesRoute } from "./sourceJurisdiction.js";
import { describeActivityProfile, normalizeActivityProfile } from "./activityProfile.js";
/* THE TWO AGREEMENT REGISTERS, IMPORTED RATHER THAN COPIED (2026-08-31).
   Whether an instrument is in force between two states is a property of the
   PAIR, not of the use case asking — the same argument that makes
   `src/uc04/policyEngine.js` import UC-03's `SANCTIONED_OR_RESTRICTED` rather
   than restate it. Both are frozen citation data: no client, no clock, no I/O,
   and neither is reached by a gate here. They are read ONLY to describe, never
   to decide — see treatyDimension's own note. */
import { SOCIAL_SECURITY_COVERAGE } from "../uc08/decisionSources.js";
import { TAX_CONVENTION_BY_PAIR } from "../uc07/decisionSources.js";
import {
  summariseIdentityDocuments,
  DOCS_ON_FILE,
  DOCS_NONE_ON_FILE,
  DOCS_FIELD_ABSENT,
} from "./identityDocuments.js";

/** The one human this whole file is written for. */
export const DECIDER = Object.freeze({
  role: "mobility_specialist",
  label: "Mobility specialist",
  decides:
    "whether this employee may work from this destination for these dates — and, where the case escalated, what a Mobility Legal reviewer has to settle before anyone can.",
});

// The Schengen pair is IMPORTED from riskMatrix.js rather than restated: they
// were two local constants that happened to agree with the gate, and a
// describer whose limit can drift from the limit that decided is a screen that
// lies quietly. The residency pair stays local because riskMatrix.js has no
// constants for it — 183/365 is written inline there, and lifting it out is a
// change to the gate rather than to this description of it.
const RESIDENCY_WINDOW_DAYS = 365;
const RESIDENCY_LIMIT_DAYS = 183;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The trailing window a rolling-day count was taken over, restated rather than
 * stored. It is fully determined by the trip's start date and a fixed span, so
 * recomputing it here is arithmetic on a value the row holds — not a second
 * source of truth. Returns null when the start date is unreadable, because a
 * window with an invented end is not a window.
 */
function trailingWindow(startDate, spanDays) {
  const startMs = new Date(startDate).getTime();
  if (Number.isNaN(startMs)) return null;
  return {
    from: new Date(startMs - spanDays * DAY_MS).toISOString().slice(0, 10),
    to: String(startDate).slice(0, 10),
    spanDays,
  };
}

const isRealNumber = (v) => typeof v === "number" && Number.isFinite(v);

/**
 * Was the Schengen 90/180 rule in scope, applied, or SUPPRESSED?
 *
 * riskMatrix.js's own Schengen block reads
 * `SCHENGEN.has(dest) && nationality && !DNV_COUNTRIES.has(dest)` — one
 * expression with two very different reasons for being false, and collapsing
 * them is the whole reason this function returns three states rather than a
 * boolean.
 *
 *   "not_applicable" — the destination is outside Schengen (or no nationality
 *                      was stated), so the 90/180 allowance never governed this
 *                      trip. Nothing to report.
 *   "applied"        — the rule was in scope and the matrix measured against it.
 *   "suppressed"     — the destination IS in Schengen, so the rule WAS in scope,
 *                      and it was skipped because the destination sits in
 *                      DNV_COUNTRIES.
 *
 * THE THIRD ONE IS THE POINT. A suppressed check and a passed check produce the
 * same silence, and they are opposite facts — the `not_reached` versus `passed`
 * distinction describeGateLadder() already draws one layer up, appearing here at
 * the level of the data a gate reads. And the list doing the suppressing is
 * uncited (DNV_COUNTRIES_PROVENANCE), so a reader who is not told will assume a
 * sourced exemption where there is a five-entry hand-written one.
 *
 * @returns {"not_applicable"|"applied"|"suppressed"}
 */
function schengenRuleState(destination, nationality) {
  if (!destination || !nationality || !SCHENGEN.has(destination)) return "not_applicable";
  return DNV_COUNTRIES.has(destination) ? "suppressed" : "applied";
}

// ---------------------------------------------------------------------------
// The four dimensions
// ---------------------------------------------------------------------------
// Each returns {position, key, label, question, state, finding, evidence[],
// whatItWouldTake?}. `state` is deliberately five-valued, not two:
//
//   "cleared"       — checked, and nothing was found against it.
//   "attention"     — checked, and something was found a person must weigh.
//   "blocking"      — checked, and what was found no approval can override.
//   "unknown"       — the check RAN but the data it needed was absent, so its
//                     answer is not evidence in either direction.
//   "unavailable"   — the check does not exist yet; nothing was ever consulted.
//   "not_assessed"  — the check never ran, because an earlier gate decided.
//
// "unknown"/"unavailable" and "not_assessed" are separated for the same reason
// describeGateLadder() separates "passed" from "not_reached": a check that never
// ran approved of nothing, and a check that ran on nothing found nothing.
// Collapsing either into "cleared" is precisely how an unevaluated country came
// to sit on a one-click approval screen (finding F-14).
// ---------------------------------------------------------------------------

/**
 * Dimension 1 — totalization / treaty coverage for this country pair.
 *
 * THE HONEST ANSWER HERE IS USUALLY "UNKNOWN", and saying so is the whole point.
 * riskMatrix.js holds `NON_TREATY_PAIRS`, a list of pairs KNOWN to lack an
 * agreement. Absence from that list is absence of a recorded gap; it is not a
 * record of coverage. The matrix's own comment says it treats an unlisted pair
 * as "treaty unknown (medium)" — but it pushes no flag for that case, so nothing
 * downstream can tell an unlisted pair from a confirmed-covered one, and the
 * specialist saw neither. Reporting "unknown" is what UC-04.md §9's "Unconfirmed
 * treaty/totalization coverage → escalate — never guess a country isn't covered"
 * asks for, and it is the state the maintained table named in §3
 * (`[PROPOSED — build-time task]`) would replace with a real answer.
 */
function treatyDimension({ nationality, destination, flags, riskRan }) {
  const base = {
    position: 1,
    key: "treaty_coverage",
    label: "Totalization / treaty coverage",
    question: "Is this country pair covered by a social-security or tax agreement?",
  };
  const pair = nationality && destination ? `${nationality} → ${destination}` : null;
  /* THE PROSE SAID "US → NL" WHILE THE EVIDENCE ROW UNDER IT SAID "United
     States → Netherlands" (2026-08-31). Both were this dimension's own output,
     six lines apart on the rendered page: the row goes through the sidebar's
     country registry because its LABEL is mapped, and a code interpolated into
     a sentence is unreachable by that registry — the same defect §3.101 fixed
     for "Days in NL". Spelling the names here is the fix that cannot drift,
     because it happens where the codes are. */
  const pairLabel =
    nationality && destination
      ? `${countryLabel(nationality, nationality)} → ${countryLabel(destination, destination)}`
      : null;

  if (!riskRan) {
    return {
      ...base,
      state: "not_assessed",
      finding: "Not assessed — an earlier gate decided this request before any country-pair rule was consulted.",
      evidence: [],
    };
  }

  if (flags.includes("non_treaty_pair")) {
    return {
      ...base,
      state: "attention",
      finding: `No totalization or tax agreement is on record for ${pairLabel ?? "this country pair"}. Contributions may fall due in both countries for the same period.`,
      evidence: [
        { label: "Nationality → destination", value: pair ?? "not stated" },
        { label: "Recorded status", value: "known gap" },
      ],
    };
  }

  /* THE REGISTERS ARE NOW READ, AND THE `unknown` STATE IS NO LONGER THE ONLY
     ANSWER (2026-08-31). Twice this branch was left deliberately frozen with
     the note "it is the owner's call" — the second time against a page that was
     displaying, as a caveat under this very finding, C-9's table naming the
     pair as covered. The owner has now called it.

     WHAT CHANGED IS WHERE THE ANSWER COMES FROM, NOT WHAT COUNTS AS ONE. The
     two registers were already in this repository, one use case over each:
     `SOCIAL_SECURITY_COVERAGE` (src/uc08/decisionSources.js) holds six pairs
     with a network, a certificate and a maximum initial detachment;
     `TAX_CONVENTION_BY_PAIR` (src/uc07/decisionSources.js) holds the bilateral
     tax convention for the same six. Nothing is invented here and no figure is
     computed — the pair is looked up, and if BOTH registers answer, the two
     instruments they name are reported with their own columns.

     BOTH LIMBS, OR NEITHER. The question this dimension asks names social
     security AND tax, and they are different instruments settling different
     things: Reg. 883/2004 says whose scheme applies and is silent on taxing
     rights; a convention's art. 15/16 says the reverse. Answering one and
     printing a settled state over both is the misreading the EU branch below
     was written to avoid, so `cleared` requires an entry in each register. A
     pair only one of them holds falls through to `unknown` unchanged, where the
     sentence already tells the reader to read the corpus below.

     IT STILL DECIDES NOTHING. No flag is raised or cleared here, so the risk
     level, the gate ladder and the routing are bit-for-bit what they were: the
     matrix's `NON_TREATY_PAIRS` remains the only country-pair rule with any
     effect on the decision, and it is untouched. That is why this needed no n8n
     republish — `workflows/nodes-uc04/workationGates.js` has no treaty
     dimension to drift from. What changed is only what the specialist is told.

     AND IT DOES NOT CONFIRM A CERTIFICATE. An agreement being in force is not
     an A1 or a CPT63 having been issued for this trip. The finding says so, and
     the certificate column names what would have to be obtained. */
  const coverageKey =
    nationality && destination && nationality !== destination ? [nationality, destination].sort().join("|") : null;
  const socialSecurity = coverageKey && Object.hasOwn(SOCIAL_SECURITY_COVERAGE, coverageKey)
    ? SOCIAL_SECURITY_COVERAGE[coverageKey]
    : null;
  const taxConvention = coverageKey && Object.hasOwn(TAX_CONVENTION_BY_PAIR, coverageKey)
    ? TAX_CONVENTION_BY_PAIR[coverageKey]
    : null;

  if (socialSecurity?.covered === true && taxConvention) {
    return {
      ...base,
      state: "cleared",
      finding:
        `Both limbs are covered for ${pairLabel}: a social-security agreement (${socialSecurity.network}) and a ` +
        "bilateral tax convention, both cited below. No certificate of coverage is confirmed for this trip — " +
        "obtain the one named below before the employee travels.",
      evidence: [
        { label: "Nationality → destination", value: pair },
        { label: "Social-security network", value: socialSecurity.network },
        { label: "Certificate that evidences it", value: socialSecurity.certificate },
        { label: "Maximum initial detachment", value: socialSecurity.maximumInitialDetachment },
        { label: "Tax convention articles", value: taxConvention.locator },
      ],
    };
  }

  /* THE SENTENCE BELOW USED TO END "this system holds no register of pairs that
     ARE covered, so nothing here confirms one" UNCONDITIONALLY, and on an
     intra-EU pair that was FALSE while the same run said so (fixed 2026-08-30,
     §3.100). `EU_EEA_FOR_A1` IS a register of covered pairs; when it answers,
     `a1_certificate_recommended` fires and this page cites Regulation (EC) No
     883/2004 with its three operative articles a few inches above. Printing
     "nothing here confirms coverage" over that citation is the §3.98 shape
     exactly: a caution that outlived the data it was written about, and this
     one contradicted the evidence on its own screen.

     THE STATE IS DELIBERATELY UNCHANGED. Whether an EU pair should still read
     `unknown` is a policy question — Reg 883/2004 settles which state's SOCIAL
     SECURITY applies, and a tax treaty is a different instrument answering a
     different question — and it is recorded as the owner's call rather than
     decided here. What is fixed is only the false clause. */
  const euCoordinated = flags.includes("a1_certificate_recommended");

  return {
    ...base,
    state: "unknown",
    finding: euCoordinated
      ? `${pairLabel ?? "This country pair"} is coordinated for social security by Regulation (EC) No 883/2004, ` +
        "cited below, and an A1 evidences it. The tax side is a separate bilateral instrument and is not on " +
        "record here — confirm it before approving."
      : /* THE CLAUSE THIS REPLACES WAS FALSE, AND THE PAGE DISPROVED IT ITSELF
           (2026-08-31). It read "this system holds no register of pairs that
           ARE covered" — printed, on a US → PT trip, directly above a citation
           to D-20, the SSA's own status table, which carries the US–Portugal
           row (in force 1989-08-01, TIAS 12121). Untrue three times over:
           src/uc08/decisionSources.js's SOCIAL_SECURITY_COVERAGE is a
           five-column register naming six pairs; riskMatrix.js's EU_EEA_FOR_A1
           is a coverage register too (which is what §3.100 established when it
           fixed the EU branch above and left this one); and C-9, rendered as a
           caveat under this very finding, names US–NL, US–PT, US–CA, CA–NL and
           CA–PT with their authorities, dates, certificates and detachment
           limits.

           WHAT SURVIVES IS THE NARROW, TRUE CLAIM: UC-04's own matrix holds a
           known-gap list and nothing else, so the CHECK that produced this
           decision confirms no coverage. A citation is not a gate. Saying so
           precisely is the difference between disclosing a limit of the check
           and denying the existence of material this same page is displaying.

           THE STATE IS DELIBERATELY UNCHANGED, for the second time. Whether a
           pair the corpus documents should still read `unknown` flips whether
           C-9 renders at all and contradicts UC-04.md §3's "never guess a
           country isn't covered" — it is the owner's call, half-owned already
           by qa/HUMAN-DECISIONS-REQUIRED.md §D2(a). Only the false clause is
           fixed here. */
        `${pairLabel ?? "This country pair"} is not on the known-gap list — the absence of a recorded gap, not a ` +
        "record of coverage. Where the sources below name an instrument for this pair, read it there and confirm " +
        "coverage before approving.",
    evidence: [
      /* NATIONALITY → DESTINATION, WHICH IS NOT THE TRIP. The trip line at the
         top of the page reads home country → destination; this pair is keyed on
         NATIONALITY (riskMatrix.js builds `${nationality}_${destinationCountry}`).
         On a US national working in the US they are the same two words and the
         difference is invisible; on a Portuguese national working in Germany
         they diverge silently, under a label that says neither. */
      { label: "Nationality → destination", value: pair ?? "not stated" },
      { label: "Recorded status", value: "no gap on record; coverage unconfirmed" },
    ],
    whatItWouldTake:
      "The maintained totalization/treaty table this use case's specification lists as [PROPOSED], sourced from ssa.gov and the EU portable-document registry, so that 'covered' and 'not on the gap list' stop being the same answer.",
  };
}

/**
 * Dimension 2 — role / activity permanent-establishment sensitivity.
 *
 * This is the one dimension the request itself fully determines, so it is the
 * one that can genuinely read "cleared". UC-04.md §7: contract-signing, sales,
 * executive and legal authority "forces escalation outright, regardless of every
 * other dimension" — so when it fires it names WHICH trigger fired, because "PE
 * risk" alone sends a specialist looking for a reason the system already holds.
 */
// ---------------------------------------------------------------------------
// THE FORM'S OWN WORDS, GIVEN BACK TO THE READER
// ---------------------------------------------------------------------------
// Two of the four dimensions below turn on a value the requester picked from a
// dropdown, and both printed the STORED value: "Travel document type stated by
// the requester: schengen_short_stay", "'work_permit' is what the requester
// SELECTED on the form". The requester never saw either string — the portal
// offered them "Schengen short stay" and "Work permit" — so the mobility
// specialist reading the decision and the person who made the request were
// looking at two different vocabularies for the same choice.
//
// EVERY LABEL BELOW IS TAKEN FROM A SOURCE IN THIS REPOSITORY, NOT INVENTED.
// The visa wording is the portal form's own option text
// (`src/portal/assets/index.html`), which is what the requester actually read,
// checked against riskMatrix.js's `VISA_TYPES` comments. The duty wording is the
// same form's option text and `JOB_DUTY_CATEGORIES`'s own annotations. A WRONG
// visa label on a mobility case is worse than a slug — it would tell a
// specialist the traveller holds a document they do not — so nothing here
// interprets, expands or ranks: each entry restates the option as it was
// offered, and an unmapped value falls back to the stored value with its
// underscores opened out rather than disappearing.
// ---------------------------------------------------------------------------

/** A stored value opened out into readable words when nothing maps it. */
const inWords = (value) => String(value).replace(/[_-]+/g, " ").trim();

/** The seven travel-document options the requester chooses between. */
export const VISA_TYPE_WORDS = Object.freeze({
  schengen_short_stay: "Schengen short stay",
  business_visa: "Business visa",
  digital_nomad_visa: "Digital nomad visa",
  work_permit: "Work permit",
  tourist_visa: "Tourist visa",
  esta_usa: "US ESTA / visa waiver",
  other: "Other",
});
const visaTypeWords = (value) => (value ? (VISA_TYPE_WORDS[value] ?? inWords(value)) : null);

/** The seven duty categories the same form offers. */
export const JOB_DUTY_WORDS = Object.freeze({
  engineering: "Engineering",
  support: "Support",
  operations: "Operations",
  sales: "Sales",
  legal: "Legal",
  executive: "Executive",
  other: "Other",
});
const jobDutyWords = (value) => (value ? (JOB_DUTY_WORDS[value] ?? inWords(value)) : null);

// ---------------------------------------------------------------------------
// THE FIELDS A REFUSED REQUEST COULD NOT READ, NAMED AS THE FORM NAMES THEM
// ---------------------------------------------------------------------------
// `factorValidationIssues()` in ./policyEngine.js returns slugs —
// `missing_home_country`, `invalid_visa_type`, `missing_signing_authority` —
// and puts them on the decision's `flags` beside the `factors_invalid` reason.
// They are precise, they are what the audit row carries, and they are
// unreadable to the person who filled the form in: the boxes they name are
// labelled "Home country", "Visa / permit" and "Can sign contracts on the
// company's behalf".
//
// This is the same defect VISA_TYPE_WORDS and JOB_DUTY_WORDS above were added
// to fix, one level up. Those two translate the VALUE a requester picked; this
// translates the FIELD they picked it in. It is in this file rather than in
// src/portal/plainAnswer.js for the reason that pair is: the words a UC-04
// decision is explained in belong with UC-04, so the sidebar, the portal and
// any later surface read one table rather than three.
//
// EVERY LABEL IS THE FORM'S OWN, VERBATIM AND CAPITALISED AS THE FORM
// CAPITALISES IT (src/portal/assets/index.html's UC-04 card), because the only
// thing this list has to achieve is that the reader can find the box. A
// paraphrase that reads better in a sentence — "the visa you named", "your
// dates" — is worse at the one job: it makes the reader hunt.
//
// TWO ENTRIES ARE NOT A SINGLE BOX, and they say so rather than picking one:
// `missing_dates` fails on either of two date fields without recording which,
// and `factors_missing` means the whole structured block never arrived — there
// is no field to name at all, so it names the absence.
export const FACTOR_ISSUE_WORDS = Object.freeze({
  // Written in the order ./policyEngine.js's factorValidationIssues() tests
  // them, which is also the order the form asks for them. factorIssueWords()
  // walks THIS order rather than the flag array's, so the same request always
  // reads the same way however the flags were assembled.
  factors_missing: "none of the trip details arrived with the request",
  missing_home_country: "Home country",
  missing_destination_country: "Destination country",
  missing_nationality: "Nationality",
  missing_dates: "Start date and End date",
  invalid_visa_type: "Visa / permit",
  invalid_job_duties: "Duties while abroad",
  missing_signing_authority: "Can sign contracts on the company's behalf",
});

/**
 * The fields this decision could not read, in the form's own words.
 *
 * MEMBERSHIP, NEVER PARSING. The caller hands over whatever the decision's
 * `flags` (or `factorIssues`) array holds and this keeps the members of the
 * table above, in the table's order. Nothing here matches a prefix, splits a
 * slug or infers a field from a substring — a flag this table does not name is
 * dropped rather than guessed at, which is what stops an unrelated matrix flag
 * ever being printed to a requester as a field on their form.
 *
 * @param {unknown} issues  the decision's `flags` or `factorIssues`
 * @returns {string[]} the readable field names, possibly empty
 */
export function factorIssueWords(issues) {
  if (!Array.isArray(issues)) return [];
  const present = new Set(issues.filter((f) => typeof f === "string"));
  return Object.keys(FACTOR_ISSUE_WORDS)
    .filter((key) => present.has(key))
    .map((key) => FACTOR_ISSUE_WORDS[key]);
}

function roleDimension({ factors, flags, riskRan }) {
  const base = {
    position: 2,
    key: "role_pe_sensitivity",
    label: "Role / activity PE sensitivity",
    question: "Could this person's duties abroad create a permanent establishment or dependent-agent exposure?",
  };
  const duties = factors?.jobDuties ?? null;
  const signing = typeof factors?.hasContractSigningAuthority === "boolean" ? factors.hasContractSigningAuthority : null;

  if (!riskRan || duties === null) {
    return {
      ...base,
      state: "not_assessed",
      finding: riskRan
        ? "Not assessed — the request states no job-duty category, so no role rule could be applied to it."
        : "Not assessed — an earlier gate decided this request before the role rules ran.",
      evidence: [],
    };
  }

  const triggers = [];
  if (signing === true) triggers.push("authority to sign contracts");
  if (duties === JOB_DUTY_CATEGORIES.executive) triggers.push("an executive role");
  if (duties === JOB_DUTY_CATEGORIES.sales) triggers.push("a sales role (client negotiation)");
  if (duties === JOB_DUTY_CATEGORIES.legal) triggers.push("an in-house legal role (contract negotiation)");

  /* THE PAGE SAID "DATA SCIENTIST" AND "ENGINEERING" SIX INCHES APART AND
     EXPLAINED NEITHER (2026-08-31). Both were correct. "Job title" under "Who
     this is about" is read live from the Remote employment record; this row is
     a category the REQUESTER selected from a fixed list of seven, sent on the
     request body, and `src/uc04/server.js`'s own comment says the title is
     "the only independent evidence about the role this system holds" and that
     "nothing here compares them; a human does."

     THE HUMAN CANNOT DO THAT IF NOBODY TELLS THEM THERE ARE TWO FACTS. The
     stated home country already carries exactly this disclosure a few inches
     up ("It is not read from the Remote employment record and is never
     compared to it, so a wrong country here is not caught anywhere") and the
     duties never did — so the one row on this page where the record offers an
     independent check read as though it WERE the record. It is the same defect
     as the portal's persona caption, which printed the session role over
     eleven different legal relationships: nothing false, and read as a claim
     about a different field that happens to share a vocabulary.

     THE LABEL IS THE FIX, NOT A NEW GATE. Comparing the two automatically
     would be a rule about which of seven categories a job title implies, and
     `src/uc04/intakeExtractor.js` already refuses that judgement by name —
     `jobDuties` is in NEVER_EXTRACTED_FIELDS because "choosing the nearest one
     is exactly the kind of judgement a model must not make here." A Data
     Scientist selecting 'engineering' is a correct answer; so is 'other'. What
     was missing was the reader being told which fact they are looking at. */
  const evidence = [
    { label: "Job duties, as stated on the request", value: jobDutyWords(duties) ?? "not stated" },
    { label: "Contract-signing authority", value: signing === null ? "not stated" : signing ? "yes" : "no" },
  ];

  const dutiesProvenance =
    " Duty category is selected by the requester, not read from the job title; nothing compares the two.";

  if (triggers.length > 0) {
    return {
      ...base,
      state: "attention",
      finding:
        `Permanent-establishment exposure: the employee has ${triggers.join(" and ")}. That escalates this ` +
        "request on its own, whatever the other dimensions read." +
        dutiesProvenance,
      evidence,
    };
  }

  // The flag without a trigger this function can name would mean the matrix
  // raised PE risk for a reason not derivable from `factors`. Say that, rather
  // than reporting "cleared" over the top of a flag that is really there.
  if (flags.includes("pe_risk_dape")) {
    return {
      ...base,
      state: "attention",
      finding:
        "Permanent-establishment exposure was raised, but the stated duties and signing authority do not name " +
        "which rule fired. Read the flags on the case." +
        dutiesProvenance,
      evidence,
    };
  }

  return {
    ...base,
    state: "cleared",
    finding:
      `Duties are '${jobDutyWords(duties) ?? duties}' with no contract-signing authority, so no role rule forcing ` +
      "escalation applies." +
      dutiesProvenance,
    evidence,
  };
}

/**
 * Dimension 3 — cumulative presence in a rolling window.
 *
 * UC-04.md §10 asks the audit to carry the "cumulative day count + window", and
 * the window half is why this dimension exists rather than a bare number: "42
 * days" is meaningless without saying 42 out of what, measured to when, against
 * which limit.
 *
 * THE ZERO IS THE DANGEROUS CASE. `computeCumulativeDays()` returns
 * `{days: 0, periodsCounted: 0}` for an empty travel history, and 0 over 0 trips
 * is a FLOOR, not a count — nobody checked Remote for prior trips; the requester
 * simply sent none. Reporting it as "0 days, well under 183" would be a
 * measurement the system never made, so it reports `unknown` instead and says
 * which. This is the same call src/portal/server.js makes about its own copy of
 * this figure, and UC-04.md §9 makes it a routing rule too: "Incomplete trip
 * history → escalate — cumulative check needs complete data, not a partial one
 * treated as complete."
 */
function presenceDimension({ factors, risk, tripDays, cumulativeDays, flags, riskRan }) {
  const base = {
    position: 3,
    key: "cumulative_presence",
    label: "Cumulative presence, rolling window",
    question: "Counting the trips already taken, how much of the year would this employee have spent there?",
  };
  const destination = normalizeCountryCode(risk?.normalized?.destinationCountry ?? factors?.destination?.country);
  const window = trailingWindow(factors?.startDate, RESIDENCY_WINDOW_DAYS);

  if (!riskRan || !cumulativeDays) {
    return {
      ...base,
      state: "not_assessed",
      finding:
        "Not assessed — no rolling-window count was taken: an earlier gate decided this request, or the destination is the employee's own work country.",
      evidence: [],
    };
  }

  const prior = isRealNumber(cumulativeDays.days) ? cumulativeDays.days : null;
  const periods = isRealNumber(cumulativeDays.periodsCounted) ? cumulativeDays.periodsCounted : null;
  const evidence = [
    { label: "Destination", value: destination || "not stated" },
    {
      label: "Window",
      value: window
        ? `${window.from} to ${window.to} (trailing ${window.spanDays} days)`
        : "not derivable — the trip's start date could not be read",
    },
    { label: "Prior trips counted", value: periods === null ? "unknown" : String(periods) },
  ];

  if (periods === 0) {
    return {
      ...base,
      state: "unknown",
      finding:
        `No prior trips to ${countryLabel(destination, "the destination")} were supplied, so the count is 0 across ` +
        "0 trips — a floor, not a measurement. Nothing was read from Remote to confirm the employee has not been " +
        "there. Treat an empty history as a reason to escalate.",
      evidence,
      whatItWouldTake:
        "A read of this employee's own travel-letter requests across time (this use case's specification lists that same endpoint, filtered by employee, as how Remote's own reviewers do it), so an empty history is a confirmed nil rather than a silence.",
    };
  }

  const total = prior !== null && isRealNumber(tripDays) ? prior + tripDays : null;
  if (total !== null) {
    evidence.push({ label: "Days already spent there in the window", value: `${prior}` });
    evidence.push({ label: "This trip", value: `${tripDays} days` });
    evidence.push({ label: "Total with this trip", value: `${total} of ${RESIDENCY_LIMIT_DAYS} days` });
  }

  if (flags.includes("tax_residency_watch")) {
    return {
      ...base,
      state: "attention",
      finding:
        total === null
          ? `Adding this trip would put the employee past the ${RESIDENCY_LIMIT_DAYS}-day tax-residency watch line for ${destination || "the destination"}.`
          : `${total} days in ${destination || "the destination"} across the trailing ${RESIDENCY_WINDOW_DAYS} days once this trip is added — past the ${RESIDENCY_LIMIT_DAYS}-day watch line by ${total - RESIDENCY_LIMIT_DAYS}.`,
      evidence,
    };
  }

  return {
    ...base,
    state: "cleared",
    finding:
      total === null
        ? `${prior} days already counted in ${destination || "the destination"}; this trip's own length was not derived, so no total is stated.`
        : `${total} days in ${destination || "the destination"} across the trailing ${RESIDENCY_WINDOW_DAYS} days once this trip is added — ${RESIDENCY_LIMIT_DAYS - total} short of the ${RESIDENCY_LIMIT_DAYS}-day watch line.`,
    evidence,
  };
}

/**
 * The `Document read from Remote` evidence row, and the sentence that goes with
 * it — built from what the employment record actually carries (2026-08-31).
 *
 * THIS ROW USED TO BE THE HARD-CODED STRING `"none"`. It reported an absence on
 * a record the same request had already fetched, having never looked at the
 * documented field that holds the answer — the P9 half of C-27 (claiming more
 * than was done) inside the one dimension written to avoid it, and the thing
 * the project owner asked about directly. See `./identityDocuments.js` for what
 * Remote publishes, what the Sandbox holds, and the bound below.
 *
 * IT STILL NEVER CLEARS THE DIMENSION, and the reason is Remote's own: a
 * right-to-work document on the employment record establishes entitlement in
 * the COUNTRY OF EMPLOYMENT, and this dimension is about the DESTINATION. Every
 * branch here therefore returns evidence and prose only — no state — and the
 * caller's state is unchanged by what is found.
 */
function documentEvidence(summary) {
  switch (summary.state) {
    case DOCS_ON_FILE: {
      const kinds = summary.kinds.length ? summary.kinds.join(", ") : "kind not stated on the record";
      return {
        row: {
          label: "Identity documents on the employment record",
          value:
            `${summary.count} on file (${kinds})` +
            (summary.mostRecent ? `, most recent ${summary.mostRecent.slice(0, 10)}` : "") +
            (summary.standin ? " — STAND-IN FIXTURE, not a document Remote returned" : ""),
        },
        clause:
          `the identity document${summary.count === 1 ? "" : "s"} on Remote's record` +
          (summary.standin ? " (a stand-in fixture)" : "") +
          `${summary.count === 1 ? " covers" : " cover"} the country of employment, not the destination`,
      };
    }
    case DOCS_NONE_ON_FILE:
      return {
        row: {
          label: "Identity documents on the employment record",
          value:
            `none${summary.totalFiles ? ` (${summary.totalFiles} file${summary.totalFiles === 1 ? "" : "s"} of other kinds: ${summary.otherTypes.join(", ") || "type not stated"})` : " — the record holds no files at all"}`,
        },
        clause: "Remote's record holds no identity document",
      };
    case DOCS_FIELD_ABSENT:
      return {
        row: { label: "Identity documents on the employment record", value: "not carried on the record read" },
        clause: "Remote's record carries no documents field, so nothing was searched",
      };
    default:
      return {
        row: { label: "Identity documents on the employment record", value: "not read" },
        clause: "no employment record was read",
      };
  }
}

/**
 * Dimension 4 — the immigration authorization document itself.
 *
 * THIS ONE IS NEVER CONFIRMED, AND THAT IS THE FINDING. UC-04.md §5 asks for
 * "immigration-authorization document on file (never inferred from 'this
 * destination usually doesn't enforce it')" and §9 repeats it: "No immigration
 * document on file → Escalate — never inferred". §3 lists the source as
 * `[PROPOSED]`. What the request actually carries is a visa TYPE the requester
 * SELECTED — a claim, not a document — and the matrix's rules read that claim.
 *
 * A `visaType: "work_permit"` therefore means "the requester ticked work
 * permit", and rendering it under a heading like "document verified" would turn
 * a claim into a confirmation, which is the one thing §9 forbids by name. So
 * this dimension states the claim, states that no document backs it, and names
 * what would.
 *
 * WHAT CHANGED 2026-08-31, AND WHAT DID NOT. It now READS the employment
 * record's `files[]` instead of asserting `"none"` — see `documentEvidence()`
 * above and `./identityDocuments.js`. The dimension's STATE is untouched by
 * what it finds: an identity document proves right to work in the country of
 * employment, never entitlement at the destination, so there is no branch here
 * that returns `cleared` and no value of `identityDocuments` that could reach
 * one. §5 and §9 are as binding after this change as before it; the only
 * difference is that the absence is now measured rather than assumed.
 */
/**
 * What the "travel document number" row says when there is no number — and it
 * must never be a bare "none". "Remote holds no number for this request" and
 * "there is no Remote request" and "we could not ask Remote" are three
 * different facts, and the first is the only one that is about the traveller.
 */
function linkedRequestAbsence(linkedRequest) {
  switch (linkedRequest?.state) {
    case "read":
      return "not stated on the request";
    case "missing":
      return "the linked Remote request no longer exists";
    case "unavailable":
      return "Remote could not be asked";
    case "not_looked_up":
      return "not looked up by this deployment";
    default:
      return "no Remote request is linked to this decision";
  }
}

function documentDimension({ factors, flags, riskRan, identityDocuments = null, linkedRequest = null }) {
  const base = {
    position: 4,
    key: "immigration_document",
    label: "Immigration authorization on file",
    question: "Is there a document permitting this person to work there — not merely a stated visa type?",
  };
  const visaType = factors?.visaType ?? null;
  const documents = identityDocuments ?? summariseIdentityDocuments(null);
  const documentRead = documentEvidence(documents);
  /* THE NUMBER THE REQUEST WAS ALREADY CARRYING (W-1). `travel_document_number`
     is a [CONFIRMED] field on Remote's own work-authorization request, it was
     being fetched at decision time by requestLink.js, and it was dropped — so
     this dimension told a specialist "a claim, not a document" about a request
     that named a specific document. It is read live off the linked request now
     (src/uc04/linkedRequest.js).

     IT DOES NOT CLEAR THIS DIMENSION AND NOTHING HERE LETS IT. A travel
     document number is the number of the document the traveller will travel
     ON — a passport in practice — typed by the requester on Remote's form. It
     identifies a document a specialist can go and verify, which is materially
     more than a dropdown selection, and it is still not an authorization to
     WORK at the destination. UC-04.md §5/§9 forbid inferring that document, and
     no branch below returns `cleared` whatever this row holds. */
  const linkedFields = linkedRequest?.fields ?? null;
  const travelDocument = linkedFields?.travelDocumentNumber ?? null;
  const workLocation = linkedFields?.workLocation ?? null;

  const evidence = [
    { label: "Travel document type stated by the requester", value: visaTypeWords(visaType) ?? "not stated" },
    {
      label: "Travel document number on the Remote request",
      value: travelDocument ?? linkedRequestAbsence(linkedRequest),
    },
    documentRead.row,
  ];
  if (workLocation) evidence.push({ label: "Work location stated on the Remote request", value: workLocation });
  const blockedByType =
    riskRan &&
    (flags.includes("visitor_visa_blocks_remote_work") ||
      flags.includes("us_requires_work_permit") ||
      flags.includes("ca_requires_work_permit"));

  if (blockedByType) {
    return {
      ...base,
      state: "blocking",
      finding:
        `The stated document type — ${visaTypeWords(visaType) ?? "none"} — does not permit work at this destination, ` +
        "so this request cannot be granted as worded, whatever document is produced later.",
      evidence,
      whatItWouldTake:
        "Nothing changes this one from here: a document type that permits work has to be obtained and the request re-submitted.",
    };
  }

  return {
    ...base,
    state: "unavailable",
    // TWO SENTENCES, AND THE MIDDLE ONE WENT TO THE ROW BENEATH IT. This used to
    // spend a whole sentence on what the record holds — "though it holds 1 file
    // of other kinds — not filed, rather than not read" — directly above an
    // evidence row that already says `none (1 file of other kinds: contract)`.
    // The distinction that sentence was defending is real and must survive: a
    // record nobody read and a record with nothing filed are different answers.
    // It survives in the CLAUSE, which differs for all four document states, and
    // in the row. It does not need to be argued twice.
    finding: travelDocument
      ? `The Remote request names travel document ${travelDocument} — the document they will travel on, not a right ` +
        "to work at the destination. Verify it, and obtain the destination's authorization before approving."
      : `${visaTypeWords(visaType) ?? "No document type"} is a type the requester selected, not a document, and ` +
        `${documentRead.clause}. Obtain the destination's authorization before approving.`,
    evidence,
    whatItWouldTake:
      "The linked travel-letter request's `travel_document_number` (a [CONFIRMED] field, resolved at decision time when the request is linked, but not kept — this system's work-authorization record has no column for it, which is already an open item on this use case), or an employment custom field holding the immigration authorization. Note that an identity document in `files[]` would NOT do it: Remote's Right-to-Work check establishes entitlement in the country of employment, and this dimension asks about the destination.",
  };
}

// ---------------------------------------------------------------------------
// The numeric thresholds — measured value beside the limit, or nothing
// ---------------------------------------------------------------------------
// "A threshold with no measured value against it" is the brief's own example of
// a fact that fails the "…and then what?" test. Every row here therefore carries
// BOTH sides, or says in words which side is missing and why. A limit on its own
// tells a specialist a rule exists, which they already knew.
// ---------------------------------------------------------------------------
function measurements({ factors, risk, tripDays, cumulativeDays, flags, riskRan }) {
  if (!riskRan) return [];
  const rows = [];
  const destination = normalizeCountryCode(risk?.normalized?.destinationCountry ?? factors?.destination?.country);
  const nationality = normalizeCountryCode(risk?.normalized?.nationality ?? factors?.nationality);

  // Schengen 90/180. The matrix measures it over a trailing 180-day window and
  // does NOT return the total it measured, and `uc04_authorizations` has no
  // column for it — so when the rule applied, the window is restated and the
  // measurement is reported as not recorded rather than recomputed from a travel
  // history this row does not carry. An inequality IS still information when the
  // gate fired: "over 90" is a fact, even without the exact figure.
  const schengenState = schengenRuleState(destination, nationality);

  // THE SUPPRESSED CASE, REPORTED RATHER THAN OMITTED. Before this, a Portuguese
  // or Estonian destination produced no Schengen row at all — identical output to
  // a trip to Japan, where the rule genuinely does not apply. The specialist saw
  // an absence and had no way to learn that a limit which DID govern this trip was
  // waived, still less that the waiver rests on an uncited five-entry list. The
  // row carries its own basis and what a sourced version would need, because a
  // suppression a reader cannot see is a control that has been removed silently.
  if (schengenState === "suppressed") {
    rows.push({
      key: "schengen_90_180",
      label: "Schengen days across a rolling 180 days",
      limit: SCHENGEN_LIMIT_DAYS,
      unit: "days",
      window: trailingWindow(factors?.startDate, SCHENGEN_WINDOW_DAYS),
      measured: null,
      headroom: null,
      breached: false,
      // NOT "passed". Nothing was measured and nothing cleared.
      state: "suppressed",
      note:
        `${countryLabel(destination, "This destination")} is inside the Schengen area, so the ${SCHENGEN_LIMIT_DAYS}-days-in-${SCHENGEN_WINDOW_DAYS} allowance WOULD govern this trip — and it was NOT applied. ` +
        "The check was skipped because this destination is treated as running a formal digital-nomad-visa scheme, which is assumed to sit outside the short-stay allowance. " +
        "No day count was taken, so nothing here says the employee is within the limit; the limit was excused, which is a different fact.",
      basis: {
        table: DNV_COUNTRIES_PROVENANCE.table,
        status: DNV_COUNTRIES_PROVENANCE.status,
        authority: DNV_COUNTRIES_PROVENANCE.authority,
        version: DNV_COUNTRIES_PROVENANCE.version,
        reviewedOn: DNV_COUNTRIES_PROVENANCE.reviewedOn,
        detail: DNV_COUNTRIES_PROVENANCE.basis,
        reference: DNV_COUNTRIES_PROVENANCE.reference,
      },
      whatItWouldTake: DNV_COUNTRIES_PROVENANCE.needsForAVersionedTable.join(" "),
    });
  }

  if (schengenState === "applied") {
    // THE FIGURE IS NOW ON THE ROW. This block used to report `measured: null`
    // with a `whatItWouldTake` naming the fix — "the Schengen total carried on
    // `risk`" — because the matrix computed a day count and kept only the
    // verdict. It carries it now (`risk.schengen`), so the row states the peak,
    // the window that produced it and the headroom, instead of apologising in
    // prose for an inequality.
    //
    // Rows written before that change carry no `risk.schengen`, and they get the
    // old honest absence rather than a recomputation this describer is not
    // allowed to make: describing a row is not the same act as deciding one, and
    // a describer that quietly re-derives a figure the record does not hold is a
    // second source of truth.
    const measurement = risk?.schengen ?? null;
    const counted = measurement?.status === "COUNTED" && isRealNumber(measurement?.peakDays);

    // REFUSED IS NOT UNDER THE LIMIT, and the two were one branch until now.
    //
    // When a prior stay cannot be read, `classifyRisk()` blocks BEFORE choosing
    // a window, so `risk.schengen` is null — indistinguishable, here, from a row
    // decided before the matrix carried the figure at all. Both fell to the same
    // `counted === false` branch, and that branch says "Within the limit" and
    // "this decision predates the matrix". Observed on a decision taken seconds
    // earlier: `state: "within_limit"`, `breached: false`, and a fabricated
    // 180-day window nothing had measured over, on a request the system had just
    // BLOCKED because it could not read the history.
    //
    // Three false statements on the row a specialist actually reads, every one
    // of them in the clearing direction. `NOT_EVALUATED` wearing the costume of
    // an old record.
    //
    // `not_assessed` is the honest state and it already exists — the sidebar
    // glosses it "This check never ran, because an earlier gate decided first.
    // It has approved of nothing." That is exactly what happened. No window is
    // emitted either: `trailingWindow()` would compute a plausible one, and a
    // window nothing measured over is the same lie in a smaller font.
    // FIXED FOR EVERY EARLY EXIT, NOT TWO OF THEM (2026-09-02).
    //
    // The comment above diagnosed this exactly and then closed it for one
    // cause. `classifyRisk()` returns early with `schengen: null` whenever ANY
    // prior gate raised a reason (src/uc04/riskMatrix.js) — a visitor visa, a
    // US/CA work permit, a same-country trip, an invalid date. Only two of
    // those set `travel_history_unreadable` or `NOT_EVALUATED`, so every other
    // early exit fell straight through to the `within_limit` branch and the
    // page rendered, in green, on a decision taken seconds earlier:
    //
    //     Schengen days across a rolling 180 days
    //     not measured on this run      ✓ Within the limit
    //
    // — the value and the state mark contradicting each other on ONE LINE, over
    // a 180-day window `trailingWindow()` had synthesised across a period
    // nothing was measured over, filed below the controls under the summary
    // "Each of these ran and found nothing against the request. None of them is
    // a gate that never ran." Found by a global mobility specialist reading the
    // reassembled panel, who called it the one finding that would stop them
    // signing a Schengen case.
    //
    // THE TEST IS NOW THE ABSENCE OF A MEASUREMENT, WHICH IS THE THING ITSELF.
    // There is no honest route from "no count was taken" to "within the limit",
    // whatever the reason, so the reason is no longer consulted — a new early
    // exit added to the matrix tomorrow is covered by construction rather than
    // by somebody remembering to extend a list. `breached` still wins where the
    // flag records an overstay, because that IS a measurement result: the
    // matrix had to count to raise it.
    const refused = !counted && !flags.includes("schengen_overstay");
    const window = counted && measurement.window
      ? measurement.window
      : refused
        ? null
        : trailingWindow(factors?.startDate, SCHENGEN_WINDOW_DAYS);
    const breached = flags.includes("schengen_overstay");
    rows.push({
      state: refused ? "not_assessed" : breached ? "breached" : "within_limit",
      key: "schengen_90_180",
      label: "Schengen days across a rolling 180 days",
      limit: SCHENGEN_LIMIT_DAYS,
      unit: "days",
      window,
      measured: counted ? measurement.peakDays : null,
      headroom: counted ? SCHENGEN_LIMIT_DAYS - measurement.peakDays : null,
      breached,
      note: counted
        ? (breached
            ? `Over the allowance: ${measurement.peakDays} days of stay against a limit of ${SCHENGEN_LIMIT_DAYS}, over by ${measurement.peakDays - SCHENGEN_LIMIT_DAYS}. That limit is set by law, not by Remote, so no internal approval can grant it.`
            : `Within the allowance: ${measurement.peakDays} days of stay against a limit of ${SCHENGEN_LIMIT_DAYS} — ${SCHENGEN_LIMIT_DAYS - measurement.peakDays} days of headroom.`) +
          ` The figure is the PEAK across the trip: Reg. (EU) 2016/399 art. 6(1) counts "the 180-day period preceding each day of stay", so every day of this trip is measured against its own trailing ${SCHENGEN_WINDOW_DAYS} days and the worst one is reported. It peaks on ${measurement.peakDate}, over ${window?.from ?? "?"} to ${window?.to ?? "?"}. Prior stays and this trip are counted as distinct calendar days, so a stay recorded twice is not counted twice.`
        : breached
          ? `Exceeded: this trip would take the employee past ${SCHENGEN_LIMIT_DAYS} days in the ${SCHENGEN_WINDOW_DAYS} days to ${window?.to ?? "the trip start"}. The exact total is not recorded on this row — only that it is over.`
          : refused
            ? `Not measured, and therefore not cleared. A prior stay could not be read, so no day count was attempted and no ${SCHENGEN_WINDOW_DAYS}-day window was chosen — there is no total here that is under ${SCHENGEN_LIMIT_DAYS}, and none that is over it. Fix or remove the stay named in the decision and re-run; nothing about the allowance has been established either way.`
            : `Not measured on this run, and therefore not cleared. No day count was taken and no ${SCHENGEN_WINDOW_DAYS}-day window was chosen — there is no total here that is under ${SCHENGEN_LIMIT_DAYS}, and none that is over it. This says nothing about the allowance in either direction.`,
      ...(counted
        ? {}
        : {
            whatItWouldTake: refused
              ? "A readable travel history. The row named in the decision has to be corrected or removed; until then there is nothing to measure and this limit stays unassessed."
              : "A re-run once whatever stopped the matrix has been resolved. An earlier gate decided this request before the day count ran, so the allowance was never assessed — the decision on this row is about that earlier gate, not about Schengen.",
          }),
    });
  }

  // Tax residency, 183 days across a trailing 365. This one IS fully derivable
  // from the row, so it carries both sides — and it is omitted entirely when
  // either side is absent or the prior count is the 0-over-0 floor, rather than
  // shown with a manufactured half.
  const prior = isRealNumber(cumulativeDays?.days) ? cumulativeDays.days : null;
  const periods = isRealNumber(cumulativeDays?.periodsCounted) ? cumulativeDays.periodsCounted : null;
  if (prior !== null && isRealNumber(tripDays) && periods !== null && periods > 0) {
    const total = prior + tripDays;
    rows.push({
      state: total > RESIDENCY_LIMIT_DAYS ? "breached" : "within_limit",
      key: "tax_residency_183",
      // A COMPOSED LABEL CANNOT BE NAMED BY THE BROWSER. zaf-app's
      // COUNTRY_VALUED_LABELS maps a whole label onto "this row holds a country
      // code"; a code interpolated INTO a label is invisible to it, and there
      // is no label to register. So this one names its own country, the same as
      // the three prose sites above — otherwise the row reads "Days in NL"
      // directly under a finding that says "Netherlands".
      label: `Days in ${countryLabel(destination, "the destination")} across a rolling ${RESIDENCY_WINDOW_DAYS} days, including this trip`,
      limit: RESIDENCY_LIMIT_DAYS,
      unit: "days",
      window: trailingWindow(factors?.startDate, RESIDENCY_WINDOW_DAYS),
      measured: total,
      headroom: RESIDENCY_LIMIT_DAYS - total,
      breached: total > RESIDENCY_LIMIT_DAYS,
      note:
        total > RESIDENCY_LIMIT_DAYS
          ? `${total} days against a ${RESIDENCY_LIMIT_DAYS}-day watch line — over by ${total - RESIDENCY_LIMIT_DAYS}.`
          : `${total} days against a ${RESIDENCY_LIMIT_DAYS}-day watch line — ${RESIDENCY_LIMIT_DAYS - total} of headroom.`,
    });
  }

  /* W-3 — NOTICE BEFORE DEPARTURE, and it belongs here rather than in a fifth
     dimension. UC-04.md §7 fixes the four dimensions and forbids collapsing
     them; lead time is not a fifth independent judgement, it is a measured
     value against a stated line, which is exactly what this section is.

     IT IS THE FACT THAT DECIDES WHETHER EVERY OTHER REMEDY ON THIS PAGE IS
     REAL. "Obtain the destination's authorization before approving", "obtain
     the certificate named below", a Modelo 21-RFI that must reach the payer by
     the 20th — each is an instruction with a lead time of weeks, printed on a
     screen that until now never said how many days were left. Four days'
     notice and four months' notice rendered identically.

     THE LINE IS THIS SYSTEM'S OWN AND THE ROW SAYS SO. `basis` carries
     `[PROPOSED]` and names no authority, because none sets a notice period for
     a workation — the same disclosure the Schengen suppression row makes about
     `DNV_COUNTRIES`, for the same reason: a limit a reader assumes is a rule is
     worse than no limit at all. */
  const leadTimeDays = isRealNumber(risk?.leadTimeDays) ? risk.leadTimeDays : null;
  if (riskRan && leadTimeDays !== null) {
    const short = leadTimeDays < LEAD_TIME_MINIMUM_DAYS;
    const belowRecommended = !short && leadTimeDays < LEAD_TIME_RECOMMENDED_DAYS;
    const days = (n) => `${n} day${n === 1 ? "" : "s"}`;
    rows.push({
      /* `urgent`, NOT `breached`. The panel's own vocabulary already had the
         right word — "Urgent: checked, and the time left to act on it is
         short" — written before this row existed and describing it exactly.
         `breached` renders as "OVER THE LIMIT", which is what 13 days against a
         14-day MINIMUM is not, and its tone is `stopped`, which would draw a
         short-notice trip in the colour reserved for things an approval cannot
         override. Short notice is neither. */
      state: short ? "urgent" : belowRecommended ? "attention" : "within_limit",
      key: "lead_time",
      label: "Notice before departure",
      limit: LEAD_TIME_MINIMUM_DAYS,
      /* THE ONLY ROW IN THIS SECTION WHOSE LIMIT IS A FLOOR, and saying so is
         not cosmetic. Every other measurement here is a ceiling — 90 Schengen
         days, 183 residency days — so both renderers print "67 of 90 days" and
         "23 days left", which read as "91 of 14 days, 77 days left" on a trip
         three months out: arithmetically right, and backwards. A reader
         scanning for a breach would see the largest number over the smallest
         and take it for the worst row on the page. Absent means ceiling, so
         every existing row is unaffected. */
      comparison: "floor",
      unit: "days",
      window: null,
      measured: leadTimeDays,
      headroom: leadTimeDays - LEAD_TIME_MINIMUM_DAYS,
      // A CEILING CONCEPT, LEFT FALSE ON PURPOSE. Nothing here is over a limit;
      // a value under a floor is the opposite shape, and `state` carries it.
      breached: false,
      note: short
        ? `${days(leadTimeDays)} until departure. Remote's own guidance puts a request under two weeks outside the ` +
          "ordinary flow, and anything this page asks to be obtained — a permit, an A1, a certificate of coverage — " +
          "takes longer than that."
        : belowRecommended
          ? `${days(leadTimeDays)} until departure — inside Remote's two-week floor but below the three-to-eight ` +
            "week window it recommends. Advice, not a threshold: this is a reason to check the remedies below are " +
            "already in hand, not a reason to refuse."
          : `${days(leadTimeDays)} until departure, inside the three-to-eight week window Remote recommends.`,
      /* NO SOURCE PATH HERE. The first draft named the constant's file, and
         test/zafSidebarLayout.test.js refused it — correctly: a `src/uc0N`
         path is engineering backlog wearing a provenance label, and this block
         renders straight at an approver. The table NAME is what a reader needs
         to know a curated list decided this; where it lives is not their
         question. Same shape as DNV_COUNTRIES_PROVENANCE. */
      basis: {
        table: "LEAD_TIME_MINIMUM_DAYS / LEAD_TIME_RECOMMENDED_DAYS",
        status: "[VENDOR-PUBLIC] — Remote's own published guidance, not a statute",
        authority: "Remote Help Center, article 37802834593805",
        version: null,
        reviewedOn: "2026-08-18",
        detail:
          "Remote asks for a remote work authorization \"at least 3-8 weeks before your intended departure\", and " +
          "puts a request under two weeks outside the ordinary flow. Both lines here are Remote's. Neither is a rule " +
          "of law: a notice period is a vendor's process expectation, which is what makes an exception to it the " +
          "specialist's call rather than a refusal.",
      },
    });
  }

  return rows;
}

// ---------------------------------------------------------------------------
// Who is asking, and in what capacity
// ---------------------------------------------------------------------------
// The ticket a specialist sees says "Filed by: Jane Doe (company admin)" and
// stops. That is not enough to judge whether the request is even COHERENT: a
// workation request is made by one party about another, and the whole identity
// gate is a comparison between them. So this block states the filer, the
// subject, the relationship, the surface it arrived on, and — the part that
// takes discipline — every one of those the row does NOT hold.
//
// IT IS BUILT FROM THE ROW, LIKE EVERYTHING ELSE HERE, and the cost of that is
// visible and deliberate. `handleWorkationRequest()` reads the full employment
// record and hands it to the gates; `uc04_authorizations` keeps none of it.
// The employment's own country, its type (employee or contractor) and its
// status are therefore NOT on this screen, and the honest thing is to say so
// and name what the gates did establish, rather than to accept an `employment`
// argument here that only a caller holding a live record could pass. A
// describer that says more when called from the workflow than when called from
// the API is a describer whose output depends on where you stand, and the two
// readers — the specialist in the sidebar, and the auditor reading the row back
// months later — must see the same case.
// ---------------------------------------------------------------------------

/**
 * The four blocks every one of the nine views publishes under `requester`, in
 * the ONE shape `src/shared/requesterSubject.js` defines — so the sidebar needs
 * a single renderer rather than nine.
 *
 * Exported because two callers need exactly this and must not drift: this
 * file's own `describeRequester()`, which adds UC-04's `subject` and
 * `statedReason` on top, and `src/uc04/server.js`, which publishes it top-level
 * beside `employee`. One computation, two placements.
 *
 * @param {object} args
 * @param {object|null} args.authorizationRow
 * @returns {object|null} null when there is no row to describe
 */
export function requesterParties({ authorizationRow } = {}) {
  const row = authorizationRow;
  if (!row) return null;
  const flags = Array.isArray(row.flags) ? row.flags : [];

  // WHICH OF THE TWO PARTIES FILED IT — because since 2026-08-30 there are two.
  // A work-authorization request may be filed by the EMPLOYEE about their own
  // trip (Remote's own primary actor for it) or by a company admin on their
  // behalf, and the identity gate accepts a different comparison for each
  // (src/uc04/submissionIdentity.js). The sentences below used to assert the
  // company comparison unconditionally — "an authenticated actor for the
  // company, not by the employee" — which is now false of a whole class of row,
  // and false in the worst way: confidently, about the one thing this block
  // exists to state precisely.
  //
  // READ OFF THE ROW, comparing the two ids the row already holds — the same
  // comparison describeRequesterParties() makes for `actingFor`, so the two
  // halves of this block cannot contradict each other. It re-derives no
  // verdict: `identityVerified` still comes from the gate's own flag.
  const filerIsSubject =
    typeof row.requester === "string" &&
    typeof row.employmentId === "string" &&
    row.requester.trim() !== "" &&
    row.requester.trim() === row.employmentId.trim();

  const employeeModel = {
    authenticatedState: "authenticated_employee_session",
    authenticatedFinding: (who) =>
      `Filed by ${who}, an authenticated session naming that employment — the employee this request is about, filing it themselves. That is what Remote's own work-authorization request is: it is submitted by the employee, and the employer's manager approves it.`,
    identityChecks:
      "that a session was present, that the employment record could be read, and that the employment id the session names equals the id on that record",
    identityVerifiedFinding:
      "Verified: a session was present, the employment record was read, and the employment the session names is the employment this request is about. That is an authorisation to act on this record — it is not evidence about who the person behind the session is.",
  };

  const adminModel = {
    authenticatedState: "authenticated_company_actor",
    authenticatedFinding: (who) =>
      `Filed by ${who}, an authenticated actor for the company rather than by the employee. UC-04 accepts a session carrying a company id and an admin id, and this row records the admin id that session carried. ` +
      "The company id itself is not kept on the record, so the company this actor was authenticated for cannot be read back here.",
    identityChecks:
      "that a session was present, that the employment record could be read, and that the session's company id equals the employment's company id",
    identityVerifiedFinding:
      "Verified: a session was present, the employment record was read, and the company on the session matched the company on the employment. That is an authorisation to act for this company — it is not evidence about who the person behind the session is.",
  };

  return describeRequesterParties({
    filerId: row.requester,
    subjectEmploymentId: row.employmentId ?? null,
    identityVerified: !flags.includes("identity_not_verified"),
    source: row.source ?? null,
    externalRef: row.externalRef ?? null,
    model: {
      ...(filerIsSubject ? employeeModel : adminModel),
      unauthenticatedFinding:
        "No authenticated actor. The request arrived without a session naming either an employment or an admin id, and the workflow recorded the literal value 'unauthenticated' rather than a name — so nobody is identified as having filed this, and the identity gate below refused it.",
      onBehalfFinding: (who, about) =>
        `Filed by ${who} about employment ${about} — an actor acting on someone else's record, which a company admin's session is built for. Nothing on this row says whether the subject knows of or consented to the request.`,
      // THE UNVERIFIED SENTENCE NAMES BOTH ROUTES, and it must: with two ways
      // to satisfy this gate, "a company mismatch" is no longer the only way to
      // fail it, and a refusal that names one cause it did not establish is the
      // failure mode this whole file exists to avoid.
      identityUnverifiedFinding:
        "NOT verified. Neither accepted relationship could be established — the session was absent, the employment record could not be read, or the session named neither this employment nor this employment's company — and the row does not record which. This is a failure to confirm, not a finding that the filer is unauthorised.",
    },
  });
}

/**
 * The parties to this request, and the relationship the identity gate checked.
 *
 * @param {object} args
 * @param {object|null} args.authorizationRow  a `uc04_authorizations` row
 * @returns {object|null} null when there is no row to describe
 */
export function describeRequester({ authorizationRow } = {}) {
  const row = authorizationRow;
  if (!row) return null;

  const factors = row.factors ?? null;
  const risk = row.risk ?? null;
  const flags = Array.isArray(row.flags) ? row.flags : [];

  // THE FOUR SHARED BLOCKS ARE BUILT ONCE, IN src/shared/requesterSubject.js.
  // They were written here first and were the only ones of the nine — and they
  // are the same three questions on every use case (who filed it, whose record
  // it is about, what "verified" proved), so the sidebar must get one shape and
  // not nine. UC-04's WORDING is more specific than any default could be — its
  // session carries a company id AND an admin id, and the gate compares the
  // former — so the sentences are passed in and the branching lives there.
  // Nothing about the output changed when this moved.
  const subjectId = row.employmentId ?? null;
  const identityVerified = !flags.includes("identity_not_verified");
  const employmentActive = !flags.includes("employee_not_active");

  const { filedBy, actingFor, identity, intake } = requesterParties({ authorizationRow: row });

  const subject = {
    employmentId: subjectId,
    // STATED, NOT READ. Every country on a UC-04 request comes off the request
    // form. Nothing in the gates compares `factors.homeCountry` to the country
    // on the employment record, so labelling either as "the employee's country"
    // would assert a check that does not happen.
    statedHomeCountry: {
      value: normalizeCountryCode(risk?.normalized?.homeCountry ?? factors?.homeCountry) || null,
      finding:
        "Stated on the request, not read from the employment record and never compared to it — a wrong country here is not caught anywhere.",
    },
    statedNationality: {
      value: normalizeCountryCode(risk?.normalized?.nationality ?? factors?.nationality) || null,
      finding:
        "Stated on the request. It drives the Schengen allowance and the treaty pair, and no document confirms it. A second nationality cannot be recorded here.",
    },
    // THE SNAPSHOT AS IT STOOD AT DECISION TIME. Still not retained, and this
    // is NOT the same fact as the `employee` block the API view now publishes:
    // that one is a LIVE read of the record as it is when the screen is opened
    // (src/shared/employeeSubject.js), and a live read cannot answer what the
    // record said weeks ago. Both matter and neither substitutes for the other
    // — "the gate passed on an active employment" and "this person is active
    // now" are different claims, and an approver needs the second while an
    // auditor needs the first.
    employmentRecord: {
      state: "not_retained",
      finding: employmentActive
        ? "The employment gate passed on a record read at decision time; that snapshot is not kept, so the type, country and entity as they stood then cannot be read back. The employee card above is a fresh read of the record as it stands now."
        : "The employment gate refused: the record read at decision time was absent or not active, and which of those cannot be read back — the snapshot is not kept. The employee card above reads the record as it stands now.",
      whatItWouldTake:
        "An employment snapshot on this system's work-authorization record — status, type, country and entity as they stood when the decision was made. The record has no column for it today, the same gap already recorded for the linked travel-letter request and for the requester's own words.",
    },
  };

  return {
    filedBy,
    actingFor,
    subject,
    identity,
    intake,
    // The requester's own words are the single most useful thing an escalated
    // case can carry and the one thing this row structurally cannot: the
    // workflow interpolates `reasonText` into the LLM prompt and the store has
    // no column for it. Saying so is better than a screen that silently implies
    // the person explained nothing.
    statedReason: {
      state: "not_retained",
      finding:
        "The free text explaining the trip is not kept with this decision. It was passed to the summary drafter and written to the audit record, which is where it can be read.",
      whatItWouldTake: "The requester's own words carried on this decision's audit record, or a column for them on the work-authorization record.",
    },
  };
}

// ---------------------------------------------------------------------------
// Attaching the sources
// ---------------------------------------------------------------------------
// The map lives in decisionSources.js; this is the only thing that decides
// WHICH findings a given row raises. It is a translation from the row's own
// vocabulary (flags, and two states that are findings without being flags) into
// the map's keys — nothing here judges anything, and no citation id is ever
// tested in a conditional, per docs/knowledge/README.md's structural rule.
// ---------------------------------------------------------------------------

/** Finding keys a dimension raises on this row, in the order they should read. */
function findingKeysForDimension(dimension, flags) {
  const has = (f) => flags.includes(f);
  switch (dimension.key) {
    case "treaty_coverage":
      return [
        has("a1_certificate_recommended") ? "a1_certificate_recommended" : null,
        has("non_treaty_pair") ? "non_treaty_pair" : null,
        dimension.state === "unknown" ? "treaty_coverage_unconfirmed" : null,
        /* THE CITATION GROUP IS KEYED ON THE STATE, so the covered case needs
           its own key or a pair this system can now name its instruments for
           would render with NO instruments — the state moving and the sources
           not moving with it is the §3.98 defect exactly, and this line is
           where it would have happened. */
        dimension.state === "cleared" ? "treaty_coverage_confirmed" : null,
      ].filter(Boolean);
    case "cumulative_presence":
      return has("tax_residency_watch") ? ["tax_residency_watch"] : [];
    case "immigration_document":
      return [
        has("visitor_visa_blocks_remote_work") ? "visitor_visa_blocks_remote_work" : null,
        has("us_requires_work_permit") ? "us_requires_work_permit" : null,
        has("ca_requires_work_permit") ? "ca_requires_work_permit" : null,
      ].filter(Boolean);
    default:
      // Dimension 2 (PE sensitivity) is deliberately absent: it is the finding
      // this corpus cannot cite, and it is reported through `uncited` below
      // rather than by omission.
      return [];
  }
}

/** Findings a dimension raises that we hold NO source for, said out loud. */
function uncitedKeysForDimension(dimension, flags) {
  switch (dimension.key) {
    case "role_pe_sensitivity":
      return dimension.state === "attention" || flags.includes("pe_risk_dape") ? ["pe_risk_dape"] : [];
    case "immigration_document":
      return dimension.state === "unavailable" ? ["immigration_document_on_file"] : [];
    default:
      return [];
  }
}

/**
 * Everything the mobility specialist's decision turns on, from the row alone.
 *
 * @param {object} args
 * @param {object|null} args.authorizationRow  a `uc04_authorizations` row
 * @returns {{
 *   decider: typeof DECIDER,
 *   requester: object|null,
 *   trip: object,
 *   deciding: {key:string, label:string, finding:string}|null,
 *   dimensions: object[],
 *   measurements: object[],
 *   sources: {framing:string, caveatFraming:string, method:string, entries:object[], uncited:object[]},
 *   riskLevel: {value:string|null, note:string}
 * }|null}  null when there is no row to describe
 */
export function describeDecisionBasis({ authorizationRow, employment = null, linkedRequest = null } = {}) {
  const row = authorizationRow;
  if (!row) return null;

  /* THE EMPLOYMENT RECORD IS READ AT VIEW TIME, NOT PERSISTED (2026-08-31).
     Same shape and same argument as `src/shared/employeeSubject.js`, which
     rejected persisting a display name for three reasons that all apply here:
     it freezes a fact that changes (a document filed the day after the request
     was submitted is exactly the case a specialist cares about), it puts
     personal data in a second place permanently, and it needs a schema change
     — `uc04_authorizations` has no column for this and half-adding one the
     store would drop is worse than reading fresh.

     OPTIONAL, AND ABSENT IS ITS OWN STATE. Callers that hold no record (the
     CLI, a test, any surface with no Remote client) pass nothing and the
     dimension says so in those words, which is a different sentence from "the
     record holds none". It cannot become a decision input: this function is
     consulted after the decision exists and returns a view. */
  const identityDocuments = summariseIdentityDocuments(employment);

  /* WHAT THE PERSON WILL ACTUALLY BE DOING THERE (W-2). Stated by the requester
     on the three questions Remote's own RWA form asks, carried on `factors`,
     and read by nobody but the specialist — no gate, score or model touches it.
     Published whether or not it was asked, because "this surface does not ask
     the question" and "asked and left blank" are different facts, and a panel
     that rendered nothing for the first would be saying the second. */
  const activityProfile = describeActivityProfile(
    normalizeActivityProfile(authorizationRow?.factors?.activityProfile)
  );

  /* THE LINKED REMOTE REQUEST, READ THE SAME WAY AND FOR THE SAME REASON.
     `src/uc04/linkedRequest.js` fetches it at view time from the id the row
     durably holds. Optional here, exactly like `employment`: a caller with no
     Remote client passes nothing, and dimension 4 then says the request was
     never asked about — which is a different sentence from "the request carries
     no document number", and the two must not collapse. */
  const linked = linkedRequest ?? null;

  const factors = row.factors ?? null;
  const risk = row.risk ?? null;
  const flags = Array.isArray(row.flags) ? row.flags : [];
  const tripDays = isRealNumber(row.tripDays) ? row.tripDays : null;
  const cumulativeDays = row.cumulativeDays ?? risk?.cumulativeDays ?? null;
  // `risk` is null whenever a gate refused before the matrix ran — identity,
  // employment status, employer permission, malformed factors. Every dimension
  // below distinguishes that from "ran and found nothing", because the two look
  // identical from a flag list and mean opposite things.
  const riskRan = Boolean(risk);

  const destination = normalizeCountryCode(risk?.normalized?.destinationCountry ?? factors?.destination?.country);
  const homeCountry = normalizeCountryCode(risk?.normalized?.homeCountry ?? factors?.homeCountry);
  const nationality = normalizeCountryCode(risk?.normalized?.nationality ?? factors?.nationality);

  /* THE JURISDICTION PREDICATE, BOUND ONCE (§3.100). Every `sourcesForFinding`
     call below shares it, so two findings on one page cannot end up filtered
     against different routes. Before this, a finding's citations were the same
     whatever countries the trip involved — which is how a Portugal →
     Netherlands workation came to cite the U.S. Social Security Administration
     and the Canada Revenue Agency. */
  const serves = servesRoute({
    homeCountry: homeCountry || null,
    destination: destination || null,
    nationality: nationality || null,
  });

  const trip = {
    homeCountry: homeCountry || null,
    destination: destination || null,
    nationality: nationality || null,
    startDate: factors?.startDate ?? null,
    endDate: factors?.endDate ?? null,
    // THE STORED VALUE STAYS, because it is what the audit row carries and what
    // riskMatrix.js compared. What it must not be is the string on a screen:
    // the sidebar prints this field verbatim, so a mobility specialist reads
    // `schengen_short_stay` while the requester chose "Schengen short stay" —
    // the exact defect the VISA_TYPE_WORDS block above was written to remove
    // from two of the four dimensions, still live one block over. The label is
    // added beside the value rather than replacing it, the way `tripDaysNote`
    // sits beside `tripDays`, so nothing that compares the code breaks and any
    // surface can print the words instead.
    visaType: factors?.visaType ?? null,
    visaTypeLabel: visaTypeWords(factors?.visaType) ?? null,
    // `null`, NEVER 0 — finding F-32. A trip whose length was never derived is
    // not a trip of zero days, and the shortest trip this system can count is
    // one (both ends inclusive), so 0 is not even a value a real trip takes.
    tripDays,
    tripDaysNote:
      tripDays === null
        ? "Not derived — the dates on this request could not be read as a real range, so no length is stated. This is an absence, not a zero."
        : null,
  };

  const dimensions = [
    treatyDimension({ nationality, destination, flags, riskRan }),
    roleDimension({ factors, flags, riskRan }),
    presenceDimension({ factors, risk, tripDays, cumulativeDays, flags, riskRan }),
    documentDimension({ factors, flags, riskRan, identityDocuments, linkedRequest: linked }),
  ].map((d) => ({
    ...d,
    // Inline, beside the finding they belong to — a "Sources" list at the
    // bottom of a page is read by nobody deciding anything. `sources` is the
    // reading list; `uncited` is the same statement in the other direction, and
    // it is rendered too: a citation block that only ever appears where a
    // citation exists teaches a reader that everything unmarked is fine.
    // THE ROUTE IS PASSED NOW (§3.100). Without it every finding cited the same
    // documents whatever countries the trip involved, so a Portugal →
    // Netherlands workation was shown the U.S. Social Security Administration
    // and the Canada Revenue Agency. `route` is built from the values this
    // function already resolved a few lines above — nothing new is derived.
    sources: findingKeysForDimension(d, flags).map((k) => sourcesForFinding(k, { serves })).filter(Boolean),
    uncited: uncitedKeysForDimension(d, flags).map(uncitedFinding).filter(Boolean),
  }));

  const measurementRows = measurements({ factors, risk, tripDays, cumulativeDays, flags, riskRan }).map((m) => ({
    ...m,
    // The suppressed Schengen row cites the DNV scheme's own instruments, not
    // the allowance it waived — the specialist's question there is "on what
    // basis was this excused", and C-17 answers it: on an article containing
    // none of the conditions this system attributes to it.
    sources: [
      sourcesForFinding(
        m.key === "schengen_90_180" && m.state === "suppressed" ? "schengen_90_180_suppressed" : m.key,
        { serves },
      ),
    ].filter(Boolean),
  }));

  // THE FACT THAT SETTLED IT, LIFTED OUT. A specialist should not have to scan
  // four rows to find which one is load-bearing. Blocking outranks attention,
  // and nothing else is ever "the deciding dimension" — a case decided by
  // identity, employment status or employer permission was not decided by any of
  // these four, and claiming otherwise would be the P9 half of C-27 (saying MORE
  // than was done) inside a file written to fix the P7 half.
  const deciding =
    dimensions.find((d) => d.state === "blocking") ?? dimensions.find((d) => d.state === "attention") ?? null;

  // ONE DEDUPED READING LIST, for a panel that renders the whole case's sources
  // together. Built from what the dimensions and measurements above actually
  // raised, in the order they raised it — never from the flag list directly, so
  // a source can only appear here if it appears beside a finding as well.
  const seen = new Set();
  const sourceEntries = [];
  for (const block of [...dimensions.flatMap((d) => d.sources), ...measurementRows.flatMap((m) => m.sources)]) {
    if (seen.has(block.finding)) continue;
    seen.add(block.finding);
    sourceEntries.push(block);
  }
  const seenUncited = new Set();
  const uncitedEntries = [];
  for (const block of dimensions.flatMap((d) => d.uncited)) {
    if (seenUncited.has(block.finding)) continue;
    seenUncited.add(block.finding);
    uncitedEntries.push(block);
  }

  return {
    decider: DECIDER,
    // WHO IS ASKING, AND ABOUT WHOM. First, because a request whose parties do
    // not make sense is not a request to weigh on its merits.
    requester: describeRequester({ authorizationRow: row }),
    trip,
    deciding: deciding ? { key: deciding.key, label: deciding.label, finding: deciding.finding } : null,
    dimensions,
    measurements: measurementRows,
    // THE RAW SUMMARY, BESIDE THE PROSE THAT USES IT. Published so a surface
    // can mark a stand-in fixture as one without re-parsing a sentence, and so
    // a test can assert the state rather than a wording. It carries presence,
    // kinds and dates only — never a file name, number, URL or body.
    identityDocuments,
    linkedRequest: linked,
    activityProfile,
    // THE READING LIST, framed. `framing` and `caveatFraming` are not
    // decoration: a citation rendered without them reads as the system citing
    // authority for its own conclusion, which is the one thing these sources
    // must never be used for.
    sources: {
      framing: SOURCE_FRAMING,
      caveatFraming: CAVEAT_FRAMING,
      // AND THE OTHER DIRECTION. A reading list that only ever reports
      // faults teaches distrust of everything equally — see
      // CONFIRMATION_FRAMING's own header.
      confirmationFraming: CONFIRMATION_FRAMING,
      method: RETRIEVAL_METHOD,
      entries: sourceEntries,
      uncited: uncitedEntries,
    },
    // KEPT, AND LABELLED FOR WHAT IT IS. The level is what policyEngine.js routes
    // on, so hiding it would make the recorded decision unexplainable. It travels
    // with the sentence that stops it being read as the assessment itself.
    riskLevel: {
      value: risk?.riskLevel ?? null,
      note: "A rollup used for routing only. The four dimensions above must never be collapsed into a single score — read them, not this.",
    },
  };
}
