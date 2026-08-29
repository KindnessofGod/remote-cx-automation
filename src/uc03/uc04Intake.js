// ---------------------------------------------------------------------------
// uc04Intake.js  —  What UC-04 needs, and what a UC-03 routing can actually hand it
// ---------------------------------------------------------------------------
// WHY THIS FILE EXISTS
//
// UC-03's `route_to_uc04` told the requester their request "has been handed to
// the work-authorisation case (UC-04)". Nothing is handed to anything. UC-03
// builds a normalised handoff event, records it, returns it — and stops. No
// UC-04 record is created, nothing enters a UC-04 queue, and a person who goes
// and looks at UC-04 finds nothing there. The sentence asserted a transfer that
// does not happen, which is the inverse of `docs/CORRECTIONS-LOG.md`'s P7: not
// saying less than the system knew, but saying MORE than it did.
//
// AND THE FIX IS NOT "DISPATCH IT". Three independent reasons, any one of which
// is sufficient on its own:
//
//   1. THERE IS NOTHING TO DISPATCH INTO. `POST /v1/work-authorization-requests`
//      does not exist — `docs/REMOTE-VOCABULARY.md` §13.1, [CONFIRMED] from
//      Remote's own `llms.txt` (79 `post_…` entries, none for this resource) and
//      from the resource's own description: a `WorkAuthorizationRequest` is
//      *"submitted by an employee"*, `pending` means *"awaiting manager review"*,
//      and the update body is a closed `oneOf` over approve/decline. The contract
//      is CREATE-BY-EMPLOYEE, DECIDE-BY-API. `src/uc04/requestLink.js` exists
//      because UC-04 used to invent the record it decided on; a UC-03 dispatch
//      would reintroduce that exact defect one use case upstream.
//
//   2. IT WOULD BE A TIER ESCALATION PERFORMED BY AUTOMATION. UC-03 is 🟢
//      (validate -> auto-execute). UC-04 is 🟡 (AI prepares -> a human approves
//      -> execute). A 🟢 workflow that silently manufactures a 🟡 record has
//      created the *object* of a human approval with no human anywhere in it —
//      `CLAUDE.md` §3 directive 2 is precisely the rule that forbids this, and
//      UC-04's `ready_for_approval` is a one-click specialist approve, so the
//      manufactured record would arrive already pointed at a real decision.
//
//   3. THE DATA DOES NOT EXIST. Of the seven inputs UC-04's completeness gate
//      requires (`request_completeness`, `factors_invalid`), UC-03 can source
//      ONE reliably, TWO best-effort, and FOUR not at all — see the table below.
//      A dispatched record would land `blocked / factors_invalid` immediately,
//      so the dispatch would produce a refusal describing OUR incomplete
//      forwarding while reading as a finding about the employee's trip. That is
//      the manufactured-refusal shape `docs/BUILD-LOG.md` §3.30 names.
//
// WHAT THIS FILE DOES INSTEAD. It states, per run, exactly which of UC-04's
// required inputs this handoff carries and which it does not — so the answer to
// *"am I supposed to go and look at UC-04?"* is on the decision itself rather
// than reconstructed by a reader. It DECIDES NOTHING. It is not a gate, it
// cannot change a decision, and it is computed only after `route_to_uc04` has
// already been chosen. UC-03 stays the thin router `docs/use-cases/UC-03.md`
// says it is.
//
// IT DOES NOT IMPORT FROM `src/uc04/`, ON PURPOSE. UC-04's requirement list
// lives inside a non-exported `factorValidationIssues()`, and its `evaluate()`
// runs identity, employment-status, sanctions and employer-permission gates
// BEFORE completeness — so calling it as an oracle would answer a different
// question and couple a 🟢 router to a 🟡 engine's whole gate order. Instead the
// list is declared here and pinned to UC-04's real one by a test that reads
// `src/uc04/policyEngine.js` and compares the slugs (`test/uc03.test.js`). If
// UC-04 adds or removes a required input, that test goes red — which is the
// same anti-drift idiom `test/uc04Portal.test.js` already uses against the
// portal's own form.
// ---------------------------------------------------------------------------

/**
 * The seven inputs UC-04's completeness gate requires, and where — if anywhere
 * — a UC-03 travel routing can source each one.
 *
 * `uc04Issue` is the exact slug `src/uc04/policyEngine.js` pushes when the input
 * is absent or malformed. It is the join key the drift test compares on, and it
 * is what a specialist would see on the UC-04 refusal if this were dispatched.
 *
 * `source` is a plain-words statement of provenance, or `null` when UC-03 has no
 * source at all. `null` is the load-bearing value: four of the seven are `null`,
 * and they are the reason a dispatch cannot work.
 *
 * @type {ReadonlyArray<{input:string, label:string, uc04Issue:string,
 *   handoffField:string|null, source:string|null}>}
 */
export const UC04_REQUIRED_INPUTS = Object.freeze([
  {
    input: "homeCountry",
    label: "the country the employee works from",
    uc04Issue: "missing_home_country",
    handoffField: "origin_country",
    // An authoritative Remote read, never the ticket text — the employment
    // record's own country. This is the one input UC-03 always has.
    source: "the employment record UC-03 read from Remote",
  },
  {
    input: "destination.country",
    label: "the destination country",
    uc04Issue: "missing_destination_country",
    handoffField: "destination_country",
    // Best-effort, and genuinely absent on some routings: the intent gate is
    // position 5 in UC-03's ladder and the destination gate is position 6, so a
    // `route_to_uc04` is decided BEFORE anything checks a destination was read.
    source: "read out of the request text by the classifier — may be absent",
  },
  {
    input: "startDate / endDate",
    label: "the travel dates",
    uc04Issue: "missing_dates",
    handoffField: "start_date",
    // Same shape: the duration gate is position 9, four rungs below the routing
    // gate, so it never runs on this path.
    source: "read out of the request text by the classifier — may be absent",
  },
  {
    input: "nationality",
    label: "the employee's nationality",
    uc04Issue: "missing_nationality",
    handoffField: null,
    // Not on the normalized employment record (`normalizeEmployment()` produces
    // no such field) and not in the classifier's output schema. There is no
    // read anywhere in UC-03 that could produce it.
    source: null,
  },
  {
    input: "visaType",
    label: "the visa the employee intends to travel on",
    uc04Issue: "invalid_visa_type",
    handoffField: null,
    // A closed seven-member enum (`VALID_VISA_TYPES`). Nothing in UC-03 asks.
    source: null,
  },
  {
    input: "jobDuties",
    label: "the job duties they will perform while away",
    uc04Issue: "invalid_job_duties",
    handoffField: null,
    // A closed seven-member enum (`VALID_JOB_DUTIES`), and the input UC-04's
    // permanent-establishment risk turns on most sharply (`executive`).
    source: null,
  },
  {
    input: "hasContractSigningAuthority",
    label: "whether they can sign contracts for the company",
    uc04Issue: "missing_signing_authority",
    handoffField: null,
    // Must be a BOOLEAN in UC-04 — absent is not false, precisely because
    // guessing `false` here understates permanent-establishment risk.
    source: null,
  },
]);

/**
 * The four inputs UC-03 can never source, whatever the request says. Exported
 * because the requester-facing sentence in `policyEngine.js` names them and a
 * second hand-written copy of the list would be free to drift from this one.
 * @type {ReadonlyArray<string>}
 */
export const UC04_INPUTS_UC03_CANNOT_SOURCE = Object.freeze(
  UC04_REQUIRED_INPUTS.filter((i) => i.source === null).map((i) => i.label)
);

/**
 * Which of UC-04's required inputs does THIS handoff actually carry?
 *
 * Reads only the handoff event that was already built — it computes no new
 * facts, calls nothing, and cannot alter a decision. An input counts as carried
 * only when the handoff event holds a non-null value for it; an input UC-03 has
 * no source for is never carried, and is reported separately from one that was
 * simply not stated in this particular request, because the two have different
 * answers ("we never ask" vs "you did not say").
 *
 * @param {object|null} handoffEvent  the event `buildUc04HandoffEvent()` produced
 * @returns {{carried: Array<{input:string,label:string,value:string,source:string}>,
 *            missing: Array<{input:string,label:string,uc04Issue:string,why:string}>,
 *            dispatched: false, uc04RecordCreated: false}}
 */
export function describeUc04Intake(handoffEvent) {
  const carried = [];
  const missing = [];

  for (const input of UC04_REQUIRED_INPUTS) {
    const value = input.handoffField ? (handoffEvent?.[input.handoffField] ?? null) : null;
    if (input.source !== null && value !== null && value !== undefined) {
      carried.push({ input: input.input, label: input.label, value: String(value), source: input.source });
      continue;
    }
    missing.push({
      input: input.input,
      label: input.label,
      uc04Issue: input.uc04Issue,
      why:
        input.source === null
          ? "UC-03 has no source for this — a travel request never states it, and it is on no record UC-03 reads."
          : "Not stated in this request, and the routing gate decides before the gate that would have checked it.",
    });
  }

  // Both flags are literal `false` rather than derived, and they are the point
  // of the whole object: they are the machine-readable form of the sentence
  // this file was written to correct. Nothing here can ever set them true — if
  // a dispatch is ever built, it will have to change this file, and every
  // consumer of this shape will be looking at the field it changed.
  return { carried, missing, dispatched: false, uc04RecordCreated: false };
}
