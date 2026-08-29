// ---------------------------------------------------------------------------
// classifier-evaluator.js
// UC-01 Classifier V2 deterministic evaluator
// ---------------------------------------------------------------------------
//
// PURPOSE
// -------
// This file is the deterministic "examiner" for the UC-01 classifier.
//
// It does NOT ask another LLM whether the classifier was correct.
//
// Golden answer + actual answer
//              ↓
//        deterministic comparison
//              ↓
//       Phoenix annotations
//
// V2 BUSINESS TAXONOMY
// --------------------
//
// intent:
//   standard_letter
//   customized_letter
//   third_party_verification
//   out_of_scope
//
// requesterType:
//   self
//   third_party
//
// IMPORTANT SOURCE-OF-TRUTH RULES
// -------------------------------
//
// hasAttachment:
//   Expected value comes from INPUT METADATA.
//   The LLM does not predict this.
//
// hasExternalUrl:
//   In Classifier V2 this is detected deterministically from ticket text.
//   We still grade the final classifier output against the golden expected
//   value because it is part of the Classification contract.
//
// requestedFields:
//   Must use the canonical V2 field vocabulary.
//
// confidence:
//   NOT included in exact-match scoring.
//   We do not have a human-labelled "correct confidence" value yet.
//
// source / llm_path:
//   Observability only.
//   It is NOT part of case_exact_match.
//
// ---------------------------------------------------------------------------

function grade(
  name,
  passed,
  explanation
) {
  return {
    name,
    score: passed ? 1 : 0,
    label: passed ? "pass" : "fail",
    explanation,
  };
}

// ---------------------------------------------------------------------------
// Normalize requestedFields only for ordering.
//
// IMPORTANT:
//
// We deliberately do NOT translate:
//
//   salary -> compensation
//   pay -> compensation
//
// inside the evaluator.
//
// Why?
//
// Because V2 defines "compensation" as the classifier CONTRACT.
//
// If the model/fallback emits "salary", that is a classifier contract failure.
// The evaluator should expose that failure rather than silently repair it.
//
// ---------------------------------------------------------------------------

function normalizeFields(fields) {
  if (!Array.isArray(fields)) {
    return [];
  }

  return [...fields]
    .map((field) =>
      String(field)
    )
    .sort();
}

function arraysEqual(
  left,
  right
) {
  return (
    left.length ===
      right.length &&
    left.every(
      (value, index) =>
        value ===
        right[index]
    )
  );
}

function formatFields(fields) {
  return JSON.stringify(
    fields
  );
}

// ---------------------------------------------------------------------------
// Main deterministic grader
// ---------------------------------------------------------------------------

export function gradeClassifier(
  expected,
  actual,
  input
) {
  const grades = [];

  // -------------------------------------------------------------------------
  // INTENT
  // -------------------------------------------------------------------------

  const intentCorrect =
    expected.intent ===
    actual.intent;

  grades.push(
    grade(
      "intent_correct",
      intentCorrect,
      `expected=${expected.intent}; actual=${actual.intent}`
    )
  );

  // -------------------------------------------------------------------------
  // REQUESTER TYPE
  // -------------------------------------------------------------------------

  const requesterCorrect =
    expected.requesterType ===
    actual.requesterType;

  grades.push(
    grade(
      "requester_correct",
      requesterCorrect,
      `expected=${expected.requesterType}; actual=${actual.requesterType}`
    )
  );

  // -------------------------------------------------------------------------
  // ATTACHMENT
  //
  // Trusted input metadata is the source of truth.
  // -------------------------------------------------------------------------

  const expectedHasAttachment =
    input?.hasAttachment ===
    true;

  const actualHasAttachment =
    actual.hasAttachment ===
    true;

  const attachmentCorrect =
    expectedHasAttachment ===
    actualHasAttachment;

  grades.push(
    grade(
      "attachment_correct",
      attachmentCorrect,
      `expected_from_input_metadata=${expectedHasAttachment}; actual=${actualHasAttachment}`
    )
  );

  // -------------------------------------------------------------------------
  // EXTERNAL URL
  // -------------------------------------------------------------------------

  const expectedHasExternalUrl =
    expected.hasExternalUrl ===
    true;

  const actualHasExternalUrl =
    actual.hasExternalUrl ===
    true;

  const externalUrlCorrect =
    expectedHasExternalUrl ===
    actualHasExternalUrl;

  grades.push(
    grade(
      "external_url_correct",
      externalUrlCorrect,
      `expected=${expectedHasExternalUrl}; actual=${actualHasExternalUrl}`
    )
  );

  // -------------------------------------------------------------------------
  // REQUESTED FIELDS
  // -------------------------------------------------------------------------

  const expectedFields =
    normalizeFields(
      expected.requestedFields
    );

  const actualFields =
    normalizeFields(
      actual.requestedFields
    );

  const fieldsCorrect =
    arraysEqual(
      expectedFields,
      actualFields
    );

  grades.push(
    grade(
      "fields_exact_match",
      fieldsCorrect,
      `expected=${formatFields(expectedFields)}; actual=${formatFields(actualFields)}`
    )
  );

  // -------------------------------------------------------------------------
  // WHOLE CASE EXACT MATCH
  //
  // Confidence is intentionally excluded.
  // Source is intentionally excluded.
  // -------------------------------------------------------------------------

  const caseExactMatch =
    intentCorrect &&
    requesterCorrect &&
    attachmentCorrect &&
    externalUrlCorrect &&
    fieldsCorrect;

  grades.push(
    grade(
      "case_exact_match",
      caseExactMatch,
      caseExactMatch
        ? "All classifier dimensions matched their correct sources of truth."
        : "At least one classifier dimension differed from its correct source of truth."
    )
  );

  // -------------------------------------------------------------------------
  // COMPENSATION RECALL CASE
  //
  // Only emitted on golden cases that truly contain compensation.
  //
  // This is the V2 replacement for the old salary_recall_case.
  //
  // We care about this separately because missing compensation can turn a
  // customized / sensitive request into something that appears safer than it
  // really is.
  // -------------------------------------------------------------------------

  if (
    expectedFields.includes(
      "compensation"
    )
  ) {
    const detectedCompensation =
      actualFields.includes(
        "compensation"
      );

    grades.push(
      grade(
        "compensation_recall_case",
        detectedCompensation,
        detectedCompensation
          ? "Golden answer contains compensation and classifier detected compensation."
          : "Golden answer contains compensation but classifier missed compensation."
      )
    );
  }

  // -------------------------------------------------------------------------
  // THIRD-PARTY VERIFICATION ROUTE RECALL
  //
  // Only emitted on cases whose golden business route is direct third-party
  // verification.
  //
  // This metric directly measures the taxonomy problem discovered during V1.
  // -------------------------------------------------------------------------

  if (
    expected.intent ===
    "third_party_verification"
  ) {
    const detectedThirdPartyRoute =
      actual.intent ===
      "third_party_verification";

    grades.push(
      grade(
        "third_party_route_recall_case",
        detectedThirdPartyRoute,
        detectedThirdPartyRoute
          ? "Golden route is third_party_verification and classifier selected that route."
          : `Golden route is third_party_verification but classifier returned ${actual.intent}.`
      )
    );
  }

  // -------------------------------------------------------------------------
  // CUSTOMIZED LETTER ROUTE RECALL
  //
  // Only emitted on true customized-letter cases.
  // -------------------------------------------------------------------------

  if (
    expected.intent ===
    "customized_letter"
  ) {
    const detectedCustomizedRoute =
      actual.intent ===
      "customized_letter";

    grades.push(
      grade(
        "customized_route_recall_case",
        detectedCustomizedRoute,
        detectedCustomizedRoute
          ? "Golden route is customized_letter and classifier selected that route."
          : `Golden route is customized_letter but classifier returned ${actual.intent}.`
      )
    );
  }

  // -------------------------------------------------------------------------
  // LLM PATH
  //
  // Observability only.
  //
  // A fallback result is not automatically wrong.
  // Therefore this metric is NOT included in case_exact_match.
  // -------------------------------------------------------------------------

  const usedLlm =
    actual.source ===
    "llm";

  grades.push(
    grade(
      "llm_path",
      usedLlm,
      `classifier source=${actual.source ?? "unknown"}`
    )
  );

  return grades;
}