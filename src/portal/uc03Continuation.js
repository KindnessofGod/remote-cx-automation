// ---------------------------------------------------------------------------
// uc03Continuation.js  —  "Continue to work authorization", as a human act
// ---------------------------------------------------------------------------
// THE ONE DISTINCTION THIS WHOLE FILE TURNS ON
//
// Remote's rule is that a Remote Work Authorization (RWA) is raised BY THE
// EMPLOYEE, in Remote's own Requests section — Requests → New request → Remote
// Work Authorization. No API creates one: `docs/research/CROSS-BORDER-FLOW.md`
// §5 establishes it from Remote's own `llms.txt` (list / show / update only,
// no `post_` entry for either the travel-letter or the work-authorization
// family) and from the resource description itself, *"submitted by an
// employee"*. `docs/BUILD-LOG.md` §3.66 records the `POST` this repo once
// invented on exactly that reasoning gap.
//
// So there are two acts here that would produce the SAME record and are
// completely different things:
//
//   LEGITIMATE  — the employee, on the surface that stands in for Remote's
//                 Requests section, deciding to take their travel question
//                 further. `src/portal/` is precisely that stand-in (see its
//                 server.js header, and `src/remoteui/` for the established
//                 pattern), so the click IS the employee raising it.
//
//   REFUSED     — UC-03's automation creating one because the classifier read
//                 "work". Same record, no human anywhere in it, and it is what
//                 `src/uc03/uc04Intake.js` reason 2 refuses: a 🟢 router that
//                 manufactures a 🟡 record has created the OBJECT of a human
//                 approval with nobody having asked for it.
//
// The difference between them is a human act of intent in between, and this
// file exists to make that act REAL and VISIBLE rather than a redirect that
// quietly submits on the employee's behalf. Three things follow concretely:
//
//   1. Nothing here runs on the UC-03 decision path. `describeContinuation()`
//      is computed AFTER a `route_to_uc04` has already been chosen, decides
//      nothing, and cannot change a decision — the same posture, and the same
//      reason, as `describeUc04Intake()` itself.
//   2. The employee's click is a SEPARATE, AUTHENTICATED, DURABLY RECORDED
//      request (`POST /api/requests/uc03/continue` in ./server.js). If that row
//      cannot be written the continuation does not proceed — see that route for
//      why blocking is right here and is the opposite of ./refusalAudit.js's
//      rule for a refusal.
//   3. Nothing is created in Remote, by this file or by the route that uses it.
//      `src/uc04/requestLink.js` will correctly resolve the resulting decision
//      as `unlinked` — Remote answering "no such request", which is an ANSWER
//      and not a failure — and the portal prints that verbatim. The verdict
//      genuinely cannot transmit until the employee files the real RWA.
//
// WHAT THIS FILE IS NOT ALLOWED TO DO
// It holds no gate and no policy. It maps a handoff event UC-03 already built
// onto the UC-04 form's own fields, and it reports which of UC-04's required
// inputs are carried and which are not — taking that second answer from
// `describeUc04Intake()` rather than deriving a rival one, because a second
// derivation is a second thing to keep right. If this file were deleted, every
// gate in the system would behave identically and the UC-04 form would open
// empty.
// ---------------------------------------------------------------------------

// READ-ONLY IMPORTS FROM UC-03. `describeUc04Intake` and `UC04_REQUIRED_INPUTS`
// are UC-03's own exports; using them is the point ("UC-03 already builds a
// handoff event; use it rather than inventing a second linkage"). Nothing in
// src/uc03/ is written to from anywhere in this file.
import { UC04_REQUIRED_INPUTS, describeUc04Intake } from "../uc03/uc04Intake.js";

// READ-ONLY IMPORTS FROM UC-04's MATRIX, for buildCompletions() below. The
// visa a destination expects is a fact about the matrix, so it is derived from
// the matrix's own sets rather than restated — a second copy of DNV_COUNTRIES
// in this file (or, worse, in the browser asset) would be a fourth country
// vocabulary of the kind docs/UI-AUDIENCES.md's sweep already found three of.
// Nothing in src/uc04/ is written to from anywhere in this file.
import { DNV_COUNTRIES, SCHENGEN, VISA_TYPES } from "../uc04/riskMatrix.js";

/**
 * WHERE EACH OF UC-04's REQUIRED INPUTS LIVES ON THE PORTAL'S UC-04 FORM.
 *
 * Keyed by `input` — the one property present on BOTH halves of
 * `describeUc04Intake()`'s answer (its `carried` entries carry no `uc04Issue`),
 * so it is the only key that joins across the whole report.
 *
 * `test/portalUc03Continuation.test.js` asserts this map covers every member of
 * `UC04_REQUIRED_INPUTS` and names only ids that exist in the real
 * `index.html`. Both halves matter. An input UC-04 gains would otherwise be
 * silently absent from the form — the employee is never asked, and UC-04
 * refuses `factors_invalid` describing OUR omission while reading as a finding
 * about their trip, which is the manufactured-refusal shape `docs/BUILD-LOG.md`
 * §3.30 names. And a renamed form field would leave the prefill writing into an
 * element that is not there, silently, because assigning to a missing element
 * is a no-op in the browser and not an error.
 *
 * @type {ReadonlyArray<{input:string, fields:string[]}>}
 */
export const UC04_FORM_FIELDS = Object.freeze([
  { input: "homeCountry", fields: ["uc04-homeCountry"] },
  { input: "destination.country", fields: ["uc04-destinationCountry"] },
  { input: "startDate / endDate", fields: ["uc04-startDate", "uc04-endDate"] },
  { input: "nationality", fields: ["uc04-nationality"] },
  { input: "visaType", fields: ["uc04-visaType"] },
  { input: "jobDuties", fields: ["uc04-jobDuties"] },
  { input: "hasContractSigningAuthority", fields: ["uc04-hasContractSigningAuthority"] },
]);

/**
 * The values a UC-03 routing can hand the UC-04 form, and where each came from.
 *
 * `authority` is the load-bearing column and it has exactly two values:
 *
 *   "record"  — read off the Remote employment record UC-03 fetched. As close
 *               to a fact as this system gets.
 *   "reading" — the classifier's reading of free text. A READING IS NOT A FACT,
 *               which is why every one of these lands in an editable field,
 *               labelled on the page, instead of being sent straight through.
 *               `docs/research/CROSS-BORDER-FLOW.md` §7 D-3 is the standing
 *               example of this classifier being confidently wrong about
 *               exactly this kind of request.
 *
 * NOTHING IS SOURCED FROM THE EMPLOYMENT RECORD THAT REMOTE DOES NOT PUT
 * THERE — see NATIONALITY_IS_ASKED below, which is the case where that costs
 * something.
 *
 * `from` names a field on the handoff event `buildUc04HandoffEvent()` produces,
 * never a field this file invents.
 *
 * @type {ReadonlyArray<{field:string, from:string, authority:"record"|"reading", label:string}>}
 */
export const CARRIED_FIELDS = Object.freeze([
  { field: "uc04-employmentId", from: "employee_id", authority: "record", label: "Travelling employee" },
  { field: "uc04-homeCountry", from: "origin_country", authority: "record", label: "Home country" },
  { field: "uc04-destinationCountry", from: "destination_country", authority: "reading", label: "Destination country" },
  { field: "uc04-startDate", from: "start_date", authority: "reading", label: "Start date" },
  { field: "uc04-endDate", from: "end_date", authority: "reading", label: "End date" },
]);

/**
 * WHY NATIONALITY IS ASKED AND NEVER PREFILLED — checked, not assumed.
 *
 * `GET /v1/employments/{employment_id}`'s OpenAPI, fetched live 2026-08-19,
 * contains ZERO occurrences of `nationality`, `citizenship` or `passport`. (It
 * also contains zero `custom_fields` and zero `workation_permission`, which is
 * `docs/research/CROSS-BORDER-FLOW.md` §7 D-1's finding, re-run here rather
 * than taken on trust.) Remote's work-authorization object carries no
 * nationality either — its own fields are `destination_country`,
 * `travel_date_start`/`_end`, `travel_document_number`, `work_location`,
 * `will_negotiate_or_sign_contracts`, `reason`, `additional_information`,
 * `status`, `submitted_at`, `user`, `employer_approver` and
 * `employer_special_instructions` [CONFIRMED — schema, the list endpoint,
 * fetched the same day]. And `normalizeEmployment()` builds no `nationality`
 * key out of any of it.
 *
 * `src/remote/mockServer.js`'s fixtures DO carry a flat `nationality`, and the
 * mock's flat shape is handed straight back by `normalizeEmployment()`'s early
 * return — so `employment.nationality` is readable from here and reading it
 * would work perfectly, offline, forever, against a field Remote has never
 * returned. That is the fixture-agrees-with-the-code defect `docs/BUILD-LOG.md`
 * §3.66 and §3.30 both name, and it would cost far more than the keystroke it
 * saves: nationality is what the risk matrix's Schengen and visa arithmetic
 * turns on.
 *
 * So the employee is asked. A value the record genuinely carries is prefilled
 * and labelled as coming from the record; a value it does not carry is asked
 * for, never inferred.
 */
/* THE SENTENCE THE EMPLOYEE READS, not the evidence behind it. The reasoning
   above — which schema was fetched, which endpoint it came from, how many
   occurrences of the word it holds — is why we are confident, and confidence is
   an engineering concern. What the person filling in the form needs is that
   nothing was guessed on their behalf and that this box is theirs to answer.
   The evidence stays in this comment, where the next engineer will look for it;
   it came off the page under the same rule that removed the Requests-section
   procedure below. */
export const NATIONALITY_IS_ASKED =
  "Your employment record does not hold nationality, so this is asked rather than filled in for you — " +
  "a guess here would move the visa and permanent-establishment assessment without anybody having said it.";

/**
 * The interruption a `route_to_uc04` deserves, and everything it deliberately
 * no longer says.
 *
 * WHAT THIS REPLACED, AND WHY IT WENT. The result panel used to end in a block
 * headed "Your next step": a four-step numbered procedure for Remote's own
 * Requests section, followed by a paragraph explaining that no API anywhere
 * creates a work-authorization request. Both were true and sourced. Both were
 * wrong to print.
 *
 * The steps narrate Remote's own product back to a Remote employee who uses it
 * every week — from a support tool, which makes it read as condescension rather
 * than as help. And the API paragraph is OUR engineering constraint, explained
 * to a traveller who has no use for it: why this system cannot create the
 * request is argued at length in src/uc03/uc04Intake.js and
 * docs/use-cases/UC-03.md, and that is where it belongs. The project owner's
 * words: "we are supposed to implement it, not tell Remote how they do their
 * thing."
 *
 * WHAT REPLACED IT IS SHORTER AND LOUDER. The decision this notice announces IS
 * "this is a different request" — so it says that, at the top, before the
 * analysis, and offers the one thing the employee can do about it. The wall of
 * prose was several screens below the fold, after the gate ladder and the facts
 * table, which is where a next step goes to die.
 *
 * WHAT SURVIVES IS THE HONESTY, in one sentence rather than a procedure:
 * continuing carries the trip details forward and asks for what a travel
 * request never states, and it creates nothing in Remote. That is a fact about
 * what THIS system does, which is the line the rest of this page's copy is
 * edited on — statements about our own behaviour stay; instruction about
 * Remote's product and exposition about our API surface go.
 */
export const WORK_AUTHORIZATION_NOTICE = Object.freeze({
  headline: "Working from another country needs authorization",
  // ONE CLAUSE CAME OFF THE FRONT OF THIS (2026-08-20): "This is a different
  // request from a business trip." The headline directly above already says
  // that working from another country needs authorization, so the clause was
  // the heading paraphrased — and inside a modal, whose accessible name IS that
  // headline, a body that opens by restating its own title is the same defect
  // with a spotlight on it. What is left is the two things the headline cannot
  // carry: what continuing does to the trip details, and what it does NOT do.
  // The second half is a statement about this system's own behaviour and is not
  // editable under this rule.
  sentence:
    "Continuing carries your trip details across and asks you for the things a travel request never " +
    "states; nothing is submitted until you send that form.",
  action: "Start the work authorization",
  dismiss: "Not now",
});

/**
 * The reference that ties the two records together.
 *
 * THE UC-04 SUBMISSION REUSES THE UC-03 REQUEST'S OWN REFERENCE, and that is
 * not a shortcut — it is the key `workflow_claims` was designed around.
 * `CLAUDE.md` §4: the ledger is keyed `(use_case, external_ref)`, and is keyed
 * that way *"because one ticket may legitimately reach two use cases (UC-03
 * routes on to UC-04); keying on the ref alone would silently drop the
 * second"*. This is that case, arriving. Sharing the reference therefore costs
 * no idempotency guarantee — the two claims differ in their first column — and
 * buys the thing the audit viewer actually reads: its bug-audit view is keyed
 * by externalRef, so one reference renders the travel decision and the
 * work-authorization decision as one story instead of two unrelated rows.
 *
 * A UC-03 case with no reference of its own still gets one, DERIVED FROM ITS
 * OWN ID so it is stable across redeliveries. A random one would claim a fresh
 * key on every attempt and defeat the ledger it is being fed to.
 *
 * @param {{id:string, externalRef?:string|null}} caseRow
 * @returns {string}
 */
export function continuationRef(caseRow) {
  const stated = typeof caseRow?.externalRef === "string" ? caseRow.externalRef.trim() : "";
  return stated || `uc03-case-${caseRow?.id ?? "unknown"}`;
}

/**
 * Describe the continuation from a UC-03 routing: what carries across, what the
 * employee still has to supply, and what they have to do in Remote itself.
 *
 * PURE. No I/O, no store, no clock. It reads the handoff event UC-03 already
 * built and the intake report UC-03 already computed, and neither re-derives
 * nor second-guesses either one.
 *
 * @param {object} args
 * @param {object|null} args.handoffEvent  from `buildUc04HandoffEvent()`
 * @param {object|null} args.intake        from `describeUc04Intake()`
 * @param {{id:string, externalRef?:string|null}|null} args.caseRow
 * @param {string|null} [args.ticketText]  the employee's own words, context only
 */
/**
 * DEMO DATES, pinned rather than computed, for the one completion that needs
 * them. `describeContinuation()` is documented PURE — no I/O, no store, no
 * clock — and reading `Date.now()` here to invent "three weeks from today"
 * would quietly take that away for the sake of a demo convenience. So the trip
 * is a constant and `uc04-now` is pinned to a date before it, exactly as every
 * quick-fill scenario in src/portal/assets/app.js already does, and the
 * completion's outcome is therefore the same in September as it was in August.
 *
 * They are only ever written when the routing carried NO dates — which is the
 * usual case, because the request that routes to UC-04 most often ("can I work
 * from Portugal for a month?") states no dates at all on purpose.
 */
const DEMO_TRIP = Object.freeze({
  "uc04-startDate": "2026-09-01",
  "uc04-endDate": "2026-09-21",
  "uc04-now": "2026-08-15",
});

/**
 * The visa a destination expects, taken from UC-04's matrix rather than guessed.
 *
 * Three of the matrix's rules decide this and they are checked in the matrix's
 * own order of severity: US and Canada hard-block anything that is not a work
 * permit; a country with a digital-nomad route is assessed on that route (and
 * is exempt from the Schengen 90/180 block for it); the rest of Schengen is
 * short-stay. Anything else gets a business visa, which is the neutral option —
 * it raises nothing by itself and lets the duties decide.
 *
 * This is a SUGGESTION written into an editable box, never a finding. The
 * traveller's real visa is whatever they hold, and the box stays theirs to
 * correct — the same posture as every `authority: "reading"` prefill above.
 *
 * @param {string|null} destination  two-letter code, or null
 * @returns {string}
 */
function suggestedVisa(destination) {
  const dest = typeof destination === "string" ? destination.trim().toUpperCase() : "";
  if (dest === "US" || dest === "CA") return VISA_TYPES.work_permit;
  if (DNV_COUNTRIES.has(dest)) return VISA_TYPES.digital_nomad_visa;
  if (SCHENGEN.has(dest)) return VISA_TYPES.schengen_short_stay;
  return VISA_TYPES.business_visa;
}

/**
 * Two ways to finish a continuation, for the traveller who was already routed.
 *
 * WHY THIS EXISTS, in the project owner's words: *"if i am transferred from
 * uc-03 to uc-04, some of my details are sent to, but clearly i do not know
 * exactly what to put in the remaining empty fields to ensure a success or a
 * failure."* That is an accurate description of the page as it stood. The
 * continuation carries five boxes and leaves four asking for things a travel
 * request never states — nationality, visa, duties, signing authority, and
 * usually the dates too — and the only quick-fills on the page were built for
 * OTHER PEOPLE. Every UC-04 scenario in app.js names Anna, Amanda or Lars as
 * the traveller, so pressing one to learn what a valid answer looks like
 * replaced the employment id the continuation had just carried, and the
 * request was then refused `continuation_subject_mismatch` for pointing at
 * somebody else's trip. The refusal was correct. There was simply nothing on
 * the page that finished the request the reader was actually making.
 *
 * SO THESE FILL THE GAPS AND NOTHING ELSE. The `fields` map only ever names a
 * still-needed input: the traveller, the home country, the destination and any
 * date the routing did read are untouched, so a completion cannot move the
 * subject and the link to the UC-03 case survives it. That property is the
 * whole point of the function and is pinned by test.
 *
 * WHY TWO, AND WHY THESE TWO. One has to reach the specialist's one-click
 * approval and one has to be stopped, because a form that can only ever be
 * shown succeeding demonstrates as little as one that can only ever be shown
 * refusing — CLAUDE.md §5's standing lesson, which this repository has paid for
 * three times. They differ in exactly two values, both stated by the traveller
 * rather than read off a record, so the contrast is about the TRIP and never
 * about the person: an engineer with no signing authority raises nothing, and
 * an executive who can sign contracts abroad is the matrix's highest
 * permanent-establishment exposure.
 *
 * NATIONALITY IS THE ONE SUGGESTION THAT IS A GUESS, and it is labelled as one
 * on the button rather than buried here. NATIONALITY_IS_ASKED above is the
 * standing rule — the employment record does not hold it, so the system does
 * not infer it — and a demo completion is not an exception to that rule so
 * much as a worked example being offered: the home country is written into the
 * box the traveller can see and change, exactly as if they had typed it. It is
 * never sent as carried, never marked `authority: "record"`, and the box keeps
 * its "still needed" marking until somebody looks at it.
 *
 * @param {object|null} handoffEvent
 * @param {ReadonlyArray<{input:string}>} stillNeeded
 * @returns {ReadonlyArray<{id:string,label:string,note:string,fields:Record<string,string|boolean>}>}
 */
export function buildCompletions(handoffEvent, stillNeeded) {
  const needed = new Set((stillNeeded || []).map((entry) => entry && entry.input));
  // NOTHING MISSING MEANS NO BUTTONS. A routing that carried everything is
  // ready to submit, and offering to "fill the rest" would be offering to
  // overwrite what it carried.
  if (needed.size === 0) return Object.freeze([]);

  const destination = valueOf(handoffEvent, "destination_country");
  const home = valueOf(handoffEvent, "origin_country");

  /** @param {{jobDuties:string, signing:boolean}} shape */
  const fieldsFor_ = ({ jobDuties, signing }) => {
    /** @type {Record<string, string|boolean>} */
    const fields = {};
    if (needed.has("startDate / endDate")) Object.assign(fields, DEMO_TRIP);
    // The home country, offered as the nationality — see the note above. Left
    // alone when the routing carried no home country either, because a blank
    // box asking a question is better than a box filled with nothing.
    if (needed.has("nationality") && home) fields["uc04-nationality"] = home;
    if (needed.has("visaType")) fields["uc04-visaType"] = suggestedVisa(destination);
    if (needed.has("jobDuties")) fields["uc04-jobDuties"] = jobDuties;
    if (needed.has("hasContractSigningAuthority")) fields["uc04-hasContractSigningAuthority"] = signing;
    return fields;
  };

  return Object.freeze([
    Object.freeze({
      id: "continuation-routine",
      label: "Fill the rest — routine trip",
      note:
        "An engineer who signs nothing on the company’s behalf. Nothing here creates a taxable presence, "
        + "so this is the version a mobility specialist can approve in one click. Check the nationality — "
        + "your home country is offered as a starting point, not read from your record.",
      fields: Object.freeze(fieldsFor_({ jobDuties: "engineering", signing: false })),
    }),
    Object.freeze({
      id: "continuation-senior",
      label: "Fill the rest — an executive who signs contracts",
      note:
        "The same trip, for someone who can commit the company while they are abroad. That is the highest "
        + "permanent-establishment exposure the assessment knows about, so this one is escalated to a "
        + "specialist team instead of being cleared.",
      fields: Object.freeze(fieldsFor_({ jobDuties: "executive", signing: true })),
    }),
  ]);
}

export function describeContinuation({ handoffEvent, intake, caseRow, ticketText = null }) {
  // NOT AVAILABLE IS A REAL ANSWER, and the shape is identical either way so a
  // caller cannot forget to check. A UC-03 decision that is not a routing has
  // no handoff event, and the handoff event is the only thing there is to carry.
  if (!handoffEvent || !caseRow) {
    return {
      available: false,
      caseId: caseRow?.id ?? null,
      externalRef: null,
      prefill: [],
      stillNeeded: [],
      completions: [],
      notice: WORK_AUTHORIZATION_NOTICE,
      nationalityNote: NATIONALITY_IS_ASKED,
      reasonText: null,
    };
  }

  const prefill = CARRIED_FIELDS.map((carried) => ({
    field: carried.field,
    label: carried.label,
    authority: carried.authority,
    // `?? null`, never `?? ""`: a date the classifier did not read is ABSENT,
    // and an empty string in a date input is the same pixel as an absent one
    // but a different claim in a payload.
    value: valueOf(handoffEvent, carried.from),
  }));

  // TAKEN WHOLE FROM UC-03's OWN ANSWER, widened only with the form fields that
  // supply each input. The `why` sentences travel unedited — they are what
  // distinguishes "you did not say" from "we never ask", which is the
  // distinction the form's two blocks are built on.
  //
  // ONE KNOWN IMPRECISION, LEFT ALONE DELIBERATELY. `describeUc04Intake()`
  // reports the date PAIR against `handoffField: "start_date"` only, so a
  // routing that read a start date and no end date reports dates as carried
  // while `src/uc04/policyEngine.js` still refuses `missing_dates` (it requires
  // both). Not worked around here, because a rival verdict computed in the
  // portal is exactly the second derivation this file exists not to have — and
  // it costs nothing in practice: the prefill below reports each date
  // separately, so an absent end date shows as absent on the page whatever the
  // summary line says. Reported as a finding in src/uc03/, which is read-only
  // to this build.
  const missing = Array.isArray(intake?.missing) ? intake.missing : [];
  const stillNeeded = missing.map((entry) => ({ ...entry, fields: fieldsFor(entry.input) }));

  return {
    available: true,
    caseId: caseRow.id,
    externalRef: continuationRef(caseRow),
    prefill,
    stillNeeded,
    // Two worked completions of exactly the boxes `stillNeeded` names, so the
    // reader can see what a valid answer looks like without a quick-fill built
    // for somebody else replacing the traveller they came here about.
    completions: buildCompletions(handoffEvent, stillNeeded),
    notice: WORK_AUTHORIZATION_NOTICE,
    nationalityNote: NATIONALITY_IS_ASKED,
    // The employee's own sentence, carried into UC-04's free-text `reasonText`
    // as CONTEXT. UC-04's own form note already says that field is "never a
    // source of facts" and nothing in its policy engine reads it — so carrying
    // it informs the specialist without informing a gate.
    reasonText: typeof ticketText === "string" && ticketText.trim() ? ticketText.trim() : null,
  };
}

/**
 * Rebuild the intake report from a handoff event, for the durable path.
 *
 * The continuation route resolves a UC-03 case a DIFFERENT process may have
 * decided (the deployment builds a fresh handler per request), so the
 * `uc04Intake` that workflow returned is long gone. Recomputing it from the
 * event is exact rather than approximate: `describeUc04Intake()` reads the
 * event and nothing else, so the same event yields the same report.
 *
 * @param {object|null} handoffEvent
 */
export function intakeFor(handoffEvent) {
  return handoffEvent ? describeUc04Intake(handoffEvent) : null;
}

/** One handoff-event field, or null. Never `undefined`, which JSON silently drops. */
function valueOf(handoffEvent, key) {
  const raw = handoffEvent?.[key];
  return raw === undefined || raw === null || raw === "" ? null : raw;
}

/** The form fields that supply one of UC-04's required inputs. */
function fieldsFor(input) {
  const entry = UC04_FORM_FIELDS.find((f) => f.input === input);
  // An unmapped input yields an empty list rather than a throw: the employee
  // still sees it named in plain words with its `why`, they simply get no field
  // highlighted. Throwing here would take a working page down over a labelling
  // gap; the drift test is what catches the gap.
  return entry ? [...entry.fields] : [];
}

/**
 * Is this UC-03 case one this employee may continue?
 *
 * Four conditions, each refusal naming itself so the caller reports the real
 * one. Ownership is compared against the SESSION's employment id — never one
 * from a request body — which is `CLAUDE.md` prime directive #3 applied one
 * layer above the workflow, the same way ./ownership.js does it.
 *
 * @param {object|null} caseRow
 * @param {string|null} employmentId  from the resolved persona's session
 * @returns {{ok:true}|{ok:false, code:string, reason:string}}
 */
export function checkContinuable(caseRow, employmentId) {
  if (!caseRow) {
    return {
      ok: false,
      code: "continuation_case_not_found",
      reason:
        "No travel request with that id. A continuation names the UC-03 case it continues and the portal reads that case back, rather than trusting the details sent with the click.",
    };
  }
  if (caseRow.useCase !== "UC-03") {
    return {
      ok: false,
      code: "continuation_not_a_travel_request",
      reason: `That case is ${caseRow.useCase ?? "an unknown use case"}, not a travel request. The cases table is shared between use cases, so the use case is part of a row's identity rather than decoration.`,
    };
  }
  if (caseRow.decision !== "route_to_uc04") {
    return {
      ok: false,
      code: "continuation_not_routed",
      reason: `That travel request was decided ${caseRow.decision ?? "with no decision recorded"}, not route_to_uc04. Only a routing has a work-authorization step to continue to — every other outcome was answered, drafted or escalated inside UC-03.`,
    };
  }
  if (!employmentId || caseRow.employmentId !== employmentId) {
    return {
      ok: false,
      code: "continuation_not_yours",
      reason:
        "That travel request is about a different employee. Raising a work authorization is the traveller's own act, so the portal continues only a request the authenticated employee is the subject of.",
    };
  }
  return { ok: true };
}

/**
 * The two audit actions this flow writes.
 *
 * `..._requested` is the employee's act of intent — the row that makes the
 * click a raising rather than an automation. `..._linked` is the tie between
 * the two records, written after the UC-04 assessment returns and naming BOTH
 * ids, so the trail reads in either direction: from a work-authorization record
 * back to the travel request that started it, and from a travel request forward
 * to whatever the mobility desk made of it.
 *
 * Both rows put `externalRef`, `reason` and `source` under those exact names in
 * `details`, because `src/auditview/readStore.js` selects `details->>'…'` BY
 * NAME — a parallel shape is a row that exists in Postgres and is invisible in
 * the viewer, which is most of the way back to having no trail at all.
 */
export const CONTINUATION_REQUESTED = "uc03_continuation_requested";
export const CONTINUATION_LINKED = "uc03_continuation_linked";

/** Exported for the drift test, which compares this file's map against UC-03's list. */
export const UC04_REQUIRED_INPUT_NAMES = Object.freeze(UC04_REQUIRED_INPUTS.map((i) => i.input));
