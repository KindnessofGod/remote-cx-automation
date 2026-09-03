// ---------------------------------------------------------------------------
// textIntake.js  —  UC-04 from a message instead of a form
// ---------------------------------------------------------------------------
// WHAT THIS IS
// The front door `src/uc04/` did not have. `handleWorkationRequest()` requires
// seven structured factors, so every route into UC-04 assumed somebody had
// already filled in a form. This takes a request in a person's own words,
// reads what it honestly can (`intakeExtractor.js`), sources what the record
// already knows, and runs the SAME `policyEngine.evaluate()` and the SAME
// `handleWorkationRequest()` a form submission runs. It adds no gate, changes
// no gate, and holds no policy of its own.
//
// ---------------------------------------------------------------------------
// THE DESIGN QUESTION: WHAT HAPPENS WHEN THE EXTRACTION IS INCOMPLETE?
// ---------------------------------------------------------------------------
// Free text can never complete a UC-04 request. Four of its seven required
// inputs — nationality, visa type, job duties, contract-signing authority — are
// things nobody writes in a message about a trip, and `src/uc03/uc04Intake.js`
// already recorded exactly that, input by input, with `source: null` on those
// four. So an incomplete extraction is not an edge case here; it is the normal
// case, and what happens next is the whole design.
//
// There were two defensible answers, and they are genuinely different:
//
//   (a) ASK THE REQUESTER for the missing facts, or
//   (b) PROCEED TO A HUMAN with the gap named explicitly.
//
// THIS BUILD CHOOSES (a), AND THE ARGUMENT IS IN docs/use-cases/UC-04.md §16.
// In short: (b) sends a mobility specialist a case whose deciding gate is
// `factors_invalid` — a refusal that describes OUR incomplete reading while
// reading as a finding about the employee's trip, which is the manufactured-
// refusal shape docs/BUILD-LOG.md §3.30 keeps costing this project. It also
// spends the specialist's time on the one thing the requester could have
// answered in four seconds. A workation request that is missing its visa type
// is not a hard case; it is an unfinished one.
//
// BUT THE ASK IS SUBORDINATE TO THE GATES, AND THAT IS THE LOAD-BEARING PART.
// The clarification is not a decision and never pre-empts one. It is offered
// ONLY when `policyEngine.evaluate()` — the real one, on the real record, with
// identity already checked — comes back with `factors_invalid` as the DECIDING
// reason. Every gate that sits above completeness therefore still decides
// first, in its own words:
//
//   · a request from an unverified session       -> escalate / identity_not_verified
//   · a request about a non-active employment    -> escalate / employee_not_active
//   · a SANCTIONED destination                   -> blocked  / sanctioned_region
//   · no employer workation permission           -> blocked  / employer_permission_not_granted
//
// So a message naming Iran is blocked and is never asked a follow-up question,
// because the sanctions gate sits at position 3 and completeness at position 5.
// The list of things to ask for is `evaluate()`'s own `factorIssues` array —
// not a second copy of UC-04's requirement list living in this file.
//
// AND THE ANSWERS COME BACK THROUGH A PICKER, NOT THROUGH PROSE. Each thing the
// clarification asks for carries its allowed values, taken from
// `policyEngine.js`'s own exported `VALID_VISA_TYPES` / `VALID_JOB_DUTIES`. A
// country must arrive as an ISO alpha-2 code and is refused otherwise. No model
// runs on the answering path at all. The form's picker is what stops "Spain"
// reaching a comparison against "ES"; an extraction has no picker, so the
// clarification puts one back.
//
// WHY A CLARIFICATION WRITES NO DECISION, AND WHY THAT MATTERS MECHANICALLY.
// `handleWorkationRequest()` claims `(use_case, external_ref)` in
// `workflow_claims` before its first durable write. If the first turn ran the
// full workflow, the second turn — the same request, now complete, under the
// same reference a chat naturally reuses — would be refused as a duplicate
// delivery and its decision would never be recorded. A question is not a
// decision, so it must not consume the decision's exactly-once claim. The cost
// of that choice is one extra `getEmployment` read per clarified request, paid
// knowingly: the alternative is deciding first and asking second, which spends
// the claim on a question.
// ---------------------------------------------------------------------------

import { evaluate as evaluatePolicy, VALID_VISA_TYPES, VALID_JOB_DUTIES } from "./policyEngine.js";
import { handleWorkationRequest } from "./workflow.js";
import { verifySubmissionIdentity } from "./submissionIdentity.js";
import {
  extractWorkationFactors,
  NEVER_EXTRACTED_FIELDS,
  FROM_TEXT,
  FROM_ANSWER,
  FROM_RECORD,
  NOT_SOURCED,
} from "./intakeExtractor.js";
import { normalizeCountryCode, isWellFormedCountryCode } from "../shared/countryCodes.js";

// Re-exported so a caller reading a decision's provenance imports the vocabulary
// from the module it is talking to. Defined in intakeExtractor.js — see there.
export { FROM_TEXT, FROM_ANSWER, FROM_RECORD, NOT_SOURCED };

/**
 * One question per outstanding input, built from `evaluate()`'s own issue
 * slugs. `answerField` is the key the caller sends back in `supplied`;
 * `allowedValues` is null for a free value (a date, a country code) and a real
 * list for the two closed enums, so an answering surface can render a picker
 * rather than a text box.
 *
 * `missing_dates` is one issue covering two fields — that is UC-04's own
 * grouping, not a simplification here — so it asks for both.
 */
const QUESTIONS = Object.freeze({
  factors_missing: {
    answerField: null,
    question: "Tell us about the trip: where, when, on what visa, and what you will be doing.",
    allowedValues: null,
  },
  missing_home_country: {
    answerField: "homeCountry",
    question: "Which country does this employee normally work from? (ISO two-letter code)",
    allowedValues: null,
  },
  missing_destination_country: {
    answerField: "destinationCountry",
    question: "Which country do you want to work from? (ISO two-letter code)",
    allowedValues: null,
  },
  missing_dates: {
    answerField: "startDate",
    alsoAnswerField: "endDate",
    question: "What are the first and last days of the trip? (YYYY-MM-DD)",
    allowedValues: null,
  },
  missing_nationality: {
    answerField: "nationality",
    question: "What nationality is the employee's passport? (ISO two-letter code)",
    allowedValues: null,
  },
  invalid_visa_type: {
    answerField: "visaType",
    question: "Which travel document will the employee enter on?",
    allowedValues: [...VALID_VISA_TYPES],
  },
  invalid_job_duties: {
    answerField: "jobDuties",
    question: "What kind of work will they be doing while they are there?",
    allowedValues: [...VALID_JOB_DUTIES],
  },
  missing_signing_authority: {
    answerField: "hasContractSigningAuthority",
    question: "Can this employee sign contracts on the company's behalf? (yes or no — an unanswered question is not a no)",
    allowedValues: [true, false],
  },
});

const NEVER_EXTRACTED_BY_ISSUE = new Map(NEVER_EXTRACTED_FIELDS.map((f) => [f.uc04Issue, f]));

/**
 * Turn `evaluate()`'s `factorIssues` into a clarification a person can answer.
 *
 * PURE, and it takes the issues rather than the factors, so it can only ever
 * ask about something the policy engine actually said was missing. It cannot
 * invent a question, and it cannot suppress one.
 *
 * @param {string[]} factorIssues  straight off `evaluate().factorIssues`
 * @returns {Array<{uc04Issue:string, answerField:string|null, question:string,
 *   allowedValues:Array|null, whyNotRead:string|null}>}
 */
export function buildClarificationQuestions(factorIssues = []) {
  const asked = [];
  for (const issue of factorIssues) {
    const q = QUESTIONS[issue];
    if (!q) continue; // an issue with no question is reported as-is, never guessed at
    const never = NEVER_EXTRACTED_BY_ISSUE.get(issue);
    asked.push({
      uc04Issue: issue,
      answerField: q.answerField,
      ...(q.alsoAnswerField ? { alsoAnswerField: q.alsoAnswerField } : {}),
      question: q.question,
      allowedValues: q.allowedValues ?? null,
      // Why this one was not read out of the message. For the four inputs this
      // system refuses to extract at all, that reason is a safety property and
      // the requester deserves to see it rather than assume we simply failed.
      whyNotRead: never ? never.why : null,
    });
  }
  return asked;
}

/** A country answer is accepted only as a canonical alpha-2 code. */
function acceptCountry(value) {
  const code = normalizeCountryCode(value);
  return isWellFormedCountryCode(code) ? code : null;
}

/**
 * Assemble UC-04's seven factors from three sources, with a provenance note per
 * field. The order of precedence is fixed and is the point:
 *
 *   1. an answer the requester gave     — a stated fact, and the most recent one
 *   2. a value read out of the message  — a CANDIDATE, and marked as one everywhere
 *   3. the employment record            — authoritative, and the only source for
 *                                         `homeCountry` a message should not override
 *                                         with prose
 *
 * A country that does not arrive as a well-formed alpha-2 code is dropped to
 * null with a note, never passed through. Passing it through is how "Spain"
 * reaches a `Set.has("ES")` and how `"us"` walked past the US work-permit block
 * (finding F-13).
 */
function assembleFactors({ extraction, supplied, employment }) {
  const provenance = {};
  const note = (field, from, value, detail = null) => {
    provenance[field] = { from, value: value ?? null, ...(detail ? { detail } : {}) };
  };

  const suppliedCountry = (key) => {
    if (supplied[key] === undefined || supplied[key] === null || supplied[key] === "") return undefined;
    const code = acceptCountry(supplied[key]);
    return code ?? { invalid: String(supplied[key]) };
  };

  // --- home country: the record, unless the requester corrects it ----------
  let homeCountry = null;
  const suppliedHome = suppliedCountry("homeCountry");
  if (typeof suppliedHome === "string") {
    homeCountry = suppliedHome;
    note("homeCountry", FROM_ANSWER, homeCountry);
  } else if (suppliedHome && suppliedHome.invalid) {
    note("homeCountry", NOT_SOURCED, null, `"${suppliedHome.invalid}" is not an ISO two-letter country code.`);
  } else if (employment?.country_code) {
    homeCountry = normalizeCountryCode(employment.country_code) || null;
    note("homeCountry", FROM_RECORD, homeCountry);
  } else {
    note("homeCountry", NOT_SOURCED, null, "The employment record carries no usable country code.");
  }

  // --- destination: an answer, else a candidate read from the message ------
  let destinationCountry = null;
  const suppliedDestination = suppliedCountry("destinationCountry");
  if (typeof suppliedDestination === "string") {
    destinationCountry = suppliedDestination;
    note("destination.country", FROM_ANSWER, destinationCountry);
  } else if (suppliedDestination && suppliedDestination.invalid) {
    note("destination.country", NOT_SOURCED, null, `"${suppliedDestination.invalid}" is not an ISO two-letter country code.`);
  } else if (extraction.candidates.destinationCountry) {
    destinationCountry = extraction.candidates.destinationCountry;
    note("destination.country", FROM_TEXT, destinationCountry);
  } else {
    note("destination.country", NOT_SOURCED, null);
  }

  // --- dates ---------------------------------------------------------------
  const pickDate = (key) => {
    const answer = typeof supplied[key] === "string" && supplied[key].trim() ? supplied[key].trim() : null;
    if (answer) {
      note(key, FROM_ANSWER, answer);
      return answer;
    }
    const candidate = extraction.candidates[key];
    if (candidate) {
      note(key, FROM_TEXT, candidate);
      return candidate;
    }
    note(key, NOT_SOURCED, null);
    return null;
  };
  const startDate = pickDate("startDate");
  const endDate = pickDate("endDate");

  // --- the four this system refuses to read out of prose -------------------
  const answerOnly = (key) => {
    const value = supplied[key];
    if (value === undefined || value === null || value === "") {
      note(key, NOT_SOURCED, null, NEVER_EXTRACTED_BY_ISSUE_BY_FIELD[key] ?? null);
      return null;
    }
    note(key, FROM_ANSWER, value);
    return value;
  };
  const nationality = (() => {
    const answer = suppliedCountry("nationality");
    if (typeof answer === "string") {
      note("nationality", FROM_ANSWER, answer);
      return answer;
    }
    if (answer && answer.invalid) {
      note("nationality", NOT_SOURCED, null, `"${answer.invalid}" is not an ISO two-letter country code.`);
      return null;
    }
    note("nationality", NOT_SOURCED, null, NEVER_EXTRACTED_BY_ISSUE_BY_FIELD.nationality);
    return null;
  })();
  const visaType = answerOnly("visaType");
  const jobDuties = answerOnly("jobDuties");

  // A BOOLEAN OR NOTHING. `Boolean(undefined)` is `false`, and false here is a
  // claim that the employee CANNOT sign contracts — the answer that understates
  // permanent-establishment risk. An unanswered question stays unanswered, and
  // UC-04's completeness gate refuses it by name.
  let hasContractSigningAuthority = null;
  if (typeof supplied.hasContractSigningAuthority === "boolean") {
    hasContractSigningAuthority = supplied.hasContractSigningAuthority;
    note("hasContractSigningAuthority", FROM_ANSWER, hasContractSigningAuthority);
  } else {
    note(
      "hasContractSigningAuthority",
      NOT_SOURCED,
      null,
      NEVER_EXTRACTED_BY_ISSUE_BY_FIELD.hasContractSigningAuthority
    );
  }

  const factors = {
    homeCountry,
    nationality,
    destination: { country: destinationCountry },
    startDate,
    endDate,
    visaType,
    jobDuties,
    hasContractSigningAuthority,
  };

  return { factors, provenance };
}

/** field -> the written reason this system will not read it out of prose. */
const NEVER_EXTRACTED_BY_ISSUE_BY_FIELD = Object.freeze(
  Object.fromEntries(NEVER_EXTRACTED_FIELDS.map((f) => [f.field, f.why]))
);

/**
 * Submit a workation request written in the requester's own words.
 *
 * Returns one of two shapes, and they are deliberately not interchangeable:
 *
 *   { status: "needs_clarification", … }  nothing was decided and nothing was
 *       written except the record that we asked. `questions` names every
 *       outstanding input with its allowed values; `readFromText` names every
 *       candidate we did take, so the requester can correct one we got wrong.
 *
 *   { status: "decided", … }  the full `handleWorkationRequest()` ran — same
 *       gates, same audit row, same durable record, same idempotency claim as
 *       a form submission, plus an `extraction` block marking which factors
 *       came out of prose.
 *
 * @param {object} request
 * @param {string} request.text        the request, in the requester's own words
 * @param {string} request.employmentId
 * @param {object|null} [request.session]  { companyId, authenticatedAdminId }
 * @param {object} [request.supplied]  answers to a previous clarification —
 *   structured values only, validated here, never free prose
 * @param {Array} [request.travelHistory]
 * @param {string} [request.externalRef]
 * @param {string} [request.source]
 * @param {string} [request.now]
 * @param {string|null} [request.workAuthorizationId]
 *
 * @param {object} deps
 * @param {import("../remote/restClient.js").RemoteClient} deps.remote
 * @param {import("../shared/audit.js").AuditLogger} deps.audit
 * @param {import("./authorizationStore.js").AuthorizationStore} deps.authorizationStore
 * @param {typeof extractWorkationFactors} [deps.extract]  test-only seam —
 *   defaults to the real extractor so production is unaffected; injectable so
 *   `npm test` never makes a real, retried LLM call because OPENAI_API_KEY
 *   happens to be set (§6, issues #32/#27 — this hazard has bitten twice).
 * @param {Function} [deps.draftSummary]  threaded to handleWorkationRequest()
 * @param {Function} [deps.judge]         threaded to handleWorkationRequest()
 */
export async function handleWorkationTextRequest(request, deps = {}) {
  const {
    text = "",
    employmentId,
    session = null,
    supplied = {},
    travelHistory = [],
    externalRef = null,
    source = null,
    now = new Date().toISOString(),
  } = request;

  const { remote, audit, extract = extractWorkationFactors } = deps;

  const extraction = await extract({ text }, { audit });

  // The record is read here for the PRE-FLIGHT below. `handleWorkationRequest()`
  // reads it again for the decision it records — deliberately not passed
  // through, because the decision must be taken on the record as it stands when
  // the decision is taken, not on a copy this function happened to fetch first.
  const employment = await remote.getEmployment(employmentId);
  // THE SAME RULE THE DECISION WILL USE, imported rather than restated — this
  // pre-flight and handleWorkationRequest() must never disagree about who is
  // allowed to file, or the page would ask a requester for more facts and then
  // refuse them on identity anyway (or worse, the reverse). This line used to
  // be its own weaker copy — `session.companyId === employment.company_id` with
  // no presence check on either side, so two nulls compared equal.
  const identityVerified = verifySubmissionIdentity({ session, employment }).verified;

  const { factors, provenance } = assembleFactors({ extraction, supplied, employment });

  // PRE-FLIGHT — the real gates, on the real record, purely to answer one
  // question: is completeness the gate that decides? Nothing here is recorded
  // as a decision and nothing is written. `evaluate()` is pure, so calling it
  // twice costs nothing and, more importantly, means the list of things to ask
  // for comes from the gate itself rather than from a second copy of UC-04's
  // requirement list living in this file.
  const preflight = evaluatePolicy({ identityVerified, employment, factors, now, travelHistory });

  const extractionBlock = {
    source: extraction.source,
    confidence: extraction.confidence,
    // WHICH FACTORS A MODEL PRODUCED, carried onto the decision and into the
    // audit row so a specialist is never shown an extracted value that looks
    // like a stated one. See workflow.js's `extraction` handling.
    provenance,
    readFromText: extraction.read,
    rejected: extraction.rejected,
  };

  if (preflight.reason === "factors_invalid") {
    const questions = buildClarificationQuestions(preflight.factorIssues);
    // THE ASK IS RECORDED, THE DECISION IS NOT. A clarification is not a
    // verdict, so it writes no `uc04_authorizations` row and claims no external
    // ref — but a request that arrived and was answered with a question must
    // still be findable, or the audit trail shows a silence where a person was
    // waiting. Same `externalRef`/`source` provenance every other row carries.
    audit.log({
      useCase: "UC-04",
      action: "clarification_requested",
      actor: session?.authenticatedAdminId ?? "unauthenticated",
      riskTier: "medium",
      details: {
        externalRef,
        source,
        employmentId,
        outstanding: preflight.factorIssues,
        extraction: extractionBlock,
        // The requester's own words, kept for the same reason workflow.js keeps
        // `reasonText`: the next person to look at this needs to see what was
        // actually asked for, not only what we managed to parse out of it.
        text: text || null,
      },
    });

    return {
      status: "needs_clarification",
      decision: null,
      reason: "awaiting_requester_clarification",
      outstanding: preflight.factorIssues,
      questions,
      // Everything we DID read, so it can be corrected rather than discovered
      // later on an approval screen. Each one is a candidate, not a statement.
      readFromText: extraction.read,
      rejected: extraction.rejected,
      extraction: extractionBlock,
      factors,
    };
  }

  const result = await handleWorkationRequest(
    {
      employmentId,
      workAuthorizationId: request.workAuthorizationId ?? null,
      session,
      factors,
      travelHistory,
      // The requester's own words ARE the reason text on this path — there is
      // no separate box for them, and workflow.js already records it.
      reasonText: text,
      externalRef,
      source,
      now,
      extraction: extractionBlock,
    },
    deps
  );

  return { status: "decided", ...result, extraction: extractionBlock, factors };
}
