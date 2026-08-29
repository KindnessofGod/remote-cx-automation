// ---------------------------------------------------------------------------
// requestedFieldVocabulary.js — normalising what the classifier CALLS a field
// ---------------------------------------------------------------------------
// WHY THIS EXISTS, and it is a live demo failure rather than a hypothetical.
//
// `src/uc01/classifier.js`'s prompt is explicit: *"Use ONLY these canonical
// values"*, and it lists `compensation` with a COMPENSATION section naming
// salary / pay / current pay / wages / income / remuneration as things that all
// map to it. On ticket #161 the model returned **`gross_annual_salary`**.
//
// Nothing was wrong downstream. `FIELD_VOCABULARY` mapped `compensation ->
// salary` and nothing else, `AUTHORISABLE_FIELDS` is an exact-match set, so
// `gross_annual_salary` fell through both and the sidebar told a specialist
// *"gross_annual_salary — never released"* about the one field the whole
// feature exists to release. The request was correctly understood, correctly
// escalated, correctly routed — and then answered with a refusal to disclose
// something the system was perfectly willing to disclose.
//
// THE RULE IT BROKE IS PRIME DIRECTIVE #1: an LLM's output *"may never reach a
// gate unvalidated"*. A frozen prompt is not validation. It is a request, and
// this is what a model declining it looks like — not a crash, not a schema
// failure (`gross_annual_salary` is a perfectly good string), but a silent
// semantic miss that reads on screen as a policy decision.
//
// SO THE MAP IS EXPLICIT AND NOT A PATTERN. `/salary|pay|wage/` would be
// shorter and would also swallow `payslip`, `payment_date` and `pay_grade` —
// and a false positive here does not merely mislabel a row, it puts a salary on
// a letter the requester never asked for one on. Every entry below is a spelling
// a model plausibly emits for a field this system already knows how to answer.
// An unrecognised name is returned UNCHANGED, so it stays outside
// AUTHORISABLE_FIELDS and is refused by the closed set exactly as before —
// this widens what we RECOGNISE, never what we RELEASE.
//
// WHERE IT IS USED, AND THE COPY IN THE N8N PORT. `src/uc01/policyEngine.js`
// imports it; `workflows/nodes/gates.js` carries the same table inline because
// a Code node cannot import, and `test/n8nParity.test.js` executes that body and
// compares decisions. If you add a synonym here, add it there in the same edit.
// ---------------------------------------------------------------------------

/**
 * Classifier spelling -> CONTRACT vocabulary.
 *
 * The contract-vocabulary side must match `AUTHORISABLE_FIELDS` in
 * `disclosureFields.js` for a field to be releasable, and
 * `STANDARD_LETTER_FIELDS` in `policyEngine.js` for it to be in-scope. Those
 * two lists are the authority; this one only decides which of them a given
 * string is talking about.
 */
export const REQUESTED_FIELD_SYNONYMS = Object.freeze({
  // --- salary ------------------------------------------------------------
  // `compensation` is the classifier's own documented canonical value and is
  // the one the 48-case golden dataset encodes, so it stays first.
  compensation: "salary",
  compensation_amount: "salary",
  salary: "salary",
  gross_salary: "salary",
  annual_salary: "salary",
  gross_annual_salary: "salary", // observed live, ticket #161
  annual_gross_salary: "salary", // Remote's own field name, so a model may echo it
  salary_amount: "salary",
  base_salary: "salary",
  gross_pay: "salary",
  pay: "salary",
  current_pay: "salary",
  wage: "salary",
  wages: "salary",
  income: "salary",
  remuneration: "salary",

  // --- working hours ------------------------------------------------------
  working_hours: "working_hours",
  work_hours: "working_hours",
  hours: "working_hours",
  hours_per_week: "working_hours",
  weekly_hours: "working_hours",
  work_hours_per_week: "working_hours",
  contracted_hours: "working_hours",
  working_hours_per_week: "working_hours",

  // --- contract end -------------------------------------------------------
  end_date: "end_date",
  contract_end: "end_date",
  contract_end_date: "end_date",
  end_of_contract: "end_date",
  contract_duration: "end_date",
  contract_term: "end_date",

  // --- job title ----------------------------------------------------------
  job_title: "job_title",
  title: "job_title",
  position: "job_title",
  role: "job_title",
  job_role: "job_title",
});

/**
 * One classifier field name, in contract vocabulary.
 *
 * SHAPE FIRST. A model may return `"Gross Annual Salary"` or `"gross-annual
 * salary"` as readily as the snake_case its prompt asks for, so the string is
 * normalised before it is looked up — lowercased, trimmed, and any run of
 * spaces or hyphens collapsed to a single underscore.
 *
 * `Object.hasOwn`, not `??` — F-21's pattern. `field` originates in an LLM
 * response, so `"constructor"` and `"toString"` resolve through the prototype
 * chain to a FUNCTION, which is not undefined and would survive `??`.
 *
 * @param {unknown} field
 * @returns {string} the contract name, or the cleaned original when unrecognised
 */
export function canonicaliseRequestedField(field) {
  if (typeof field !== "string") return "";
  const cleaned = field.trim().toLowerCase().replace(/[\s-]+/g, "_");
  return Object.hasOwn(REQUESTED_FIELD_SYNONYMS, cleaned) ? REQUESTED_FIELD_SYNONYMS[cleaned] : cleaned;
}
