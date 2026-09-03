// ---------------------------------------------------------------------------
// activityProfile.js  —  What the person will actually be DOING there
// ---------------------------------------------------------------------------
// THE GAP THIS CLOSES. UC-04's panel told a mobility specialist that the
// traveller's work is one of seven dropdown categories — `engineering`,
// `sales`, `legal`… — and nothing else. Remote's own Mobility Team publishes
// what it assesses, and "Nature of intended activities" is one of the five
// items on the list; the RWA form the employee fills in asks for three things
// this system never collected (Help Center article `37802834593805`, retrieved
// 2026-08-18, verbatim):
//
//     - Activities to be performed
//     - Institutions or organizations visiting
//     - Special worksites (e.g., laboratories, manufacturing sites, etc.)
//
// plus "Travel/work location", which is `work_location` on Remote's own request
// object. That is ladder rung 1 — Remote's own documentation — and it is not
// overridden by this project's opinion about what a workation form should ask.
//
// WHY THESE ARE FREE TEXT AND NOT THE SIX YES/NO QUESTIONS THE SCOPE ASKED FOR.
// `docs/UC04-DECISION-SURFACE.md` W-2 proposed a structured questionnaire. It
// was written before the Help Center article was read. Remote asks these as
// open questions, the specialist reading them is assessing "nature of intended
// activities" rather than ticking boxes, and a fixed list of six would (a) be
// this project's invention presented beside Remote's own fields and (b) force
// the requester to pick the nearest wrong answer — which is the same failure
// `intakeExtractor.js` already refuses by name for `jobDuties`.
//
// NOTHING HERE IS A GATE INPUT, AND THAT IS ENFORCED RATHER THAN INTENDED.
// `test/uc04ActivityProfile.test.js` reads policyEngine.js, riskMatrix.js,
// approvalPolicy.js and requestParser.js and fails if any of them mentions this
// module. Two reasons, and the second is the one that matters:
//
//   · It is UNVERIFIED FREE TEXT typed by the requester. Prime directive 1 —
//     an LLM may interpret, deterministic code decides — has a sibling here: a
//     human's prose may inform, and may not decide. A rule keyed on the word
//     "laboratory" appearing in a sentence is a rule anybody can pass by
//     rephrasing, and one an honest requester can fail by being specific.
//   · A gate that read it would make the ANSWER worse, not just riskier. The
//     value of these fields is that a specialist reads what the traveller
//     actually wrote. A system that scored them would start rewarding the
//     phrasing that scores well.
//
// So this module normalises, bounds and describes. It never judges.
// ---------------------------------------------------------------------------

/**
 * The three questions, in Remote's own words and Remote's own order.
 *
 * `label` is what the requester is asked. `hint` is why it is being asked, in
 * the requester's terms rather than the specialist's — somebody filling in a
 * form does not know what a permanent establishment is and must not have to.
 * `absence` is what the panel says when the field is empty, and each is
 * different on purpose: "nobody asked" and "asked and left blank" are the same
 * string on a screen unless somebody writes two.
 */
export const ACTIVITY_QUESTIONS = Object.freeze([
  Object.freeze({
    key: "activities",
    field: "activitiesToBePerformed",
    label: "Activities to be performed",
    hint: "What you will actually be doing — meetings, client work, a conference, hands-on work on site.",
    absence: "Not stated on the request. Remote's own form asks for this, and a specialist assessing the nature of the work has only the duty category without it.",
  }),
  Object.freeze({
    key: "institutions",
    field: "institutionsVisited",
    label: "Institutions or organizations you will visit",
    hint: "Any company, client, university or public body you will attend in person. \"None\" is an answer.",
    absence: "Not stated on the request. Whether the traveller will be on a third party's premises is unanswered, not answered no.",
  }),
  Object.freeze({
    key: "worksites",
    field: "specialWorksite",
    label: "Special worksites",
    hint: "Laboratories, manufacturing or industrial sites, hospitals, anywhere with its own access or safety rules. \"None\" is an answer.",
    absence: "Not stated on the request. A site with its own access or safety regime is unanswered, not ruled out.",
  }),
  Object.freeze({
    key: "workLocation",
    field: "workLocation",
    label: "Where you will be working",
    hint: "The address or the kind of place — a client office, a coworking space, your own accommodation.",
    absence: "Not stated on the request. This is `work_location` on Remote's own work-authorization request, where it is read from when one is linked.",
  }),
]);

/**
 * The cap, and why there is one.
 *
 * These four fields are the only unvalidated free text on a UC-04 request that
 * reaches a durable store and a rendered panel. 2,000 characters is generous
 * for the question asked and short enough that a paste of an entire document
 * cannot become the panel. The same reasoning as the third-party door's 4,000
 * (docs/BUILD-LOG.md, 2026-08-29): bound the shape before anything reads it.
 */
export const ACTIVITY_FIELD_MAX_CHARS = 2000;

/**
 * The bound on the COMPOSED prefill, which is a different question from the
 * bound on one field. `ACTIVITY_FIELD_MAX_CHARS` asks "how much prose may a
 * requester write into a box a person will read"; this asks "how much text may
 * be the DEFAULT contents of a write the employer has not looked at yet". Four
 * fields at the field cap is over 8,000 characters flowing into `approval_note`
 * and into a Zendesk internal note. Over this line the prefill is dropped
 * entirely rather than clipped — see activityStatementPrefill().
 */
export const ACTIVITY_PREFILL_MAX_CHARS = 1500;

const clean = (value) => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.length > ACTIVITY_FIELD_MAX_CHARS ? trimmed.slice(0, ACTIVITY_FIELD_MAX_CHARS) : trimmed;
};

/** The input keys, including the short aliases, that mean "this surface asked". */
const ACCEPTED_KEYS = Object.freeze([
  "activitiesToBePerformed", "activities",
  "institutionsVisited", "institutions",
  "specialWorksite", "worksites", "specialWorksites",
  "workLocation", "work_location",
]);

/**
 * Normalise whatever a caller supplied into the four known keys, or null.
 *
 * NULL MEANS "THIS SURFACE DOES NOT ASK". An object of four nulls means "asked,
 * and the employee left them blank". They are different facts about the request
 * and only the second is about the traveller, which is why every field carries
 * two different absence sentences.
 *
 * ASKED-NESS IS DECIDED BY THE KEYS PRESENT, NOT BY THE VALUES — corrected
 * 2026-09-01 after driving it. The first version returned null whenever every
 * value came out blank, with a comment claiming that "asked and got nothing" is
 * "the same information as not asking". It is not, and the module's own header
 * says so two paragraphs up. A requester who submitted the form with all four
 * boxes empty was reported to the specialist as *"This request was filed
 * through a surface that does not ask the question"* — false, and false in the
 * reassuring direction, because it excuses the silence instead of showing it.
 * Whitespace-only input hit it too: `{activitiesToBePerformed: "   "}` collapsed
 * to "never asked".
 *
 * @param {object|null|undefined} input
 * @returns {{activitiesToBePerformed:string|null, institutionsVisited:string|null,
 *   specialWorksite:string|null, workLocation:string|null}|null}
 */
export function normalizeActivityProfile(input) {
  if (!input || typeof input !== "object") return null;
  // `Object.hasOwn`, not a truthiness check: the question of whether a surface
  // ASKED is answered by the field being on the payload at all, and a blank
  // answer is the case this distinction exists for.
  if (!ACCEPTED_KEYS.some((key) => Object.hasOwn(input, key))) return null;
  return {
    activitiesToBePerformed: clean(input.activitiesToBePerformed ?? input.activities),
    institutionsVisited: clean(input.institutionsVisited ?? input.institutions),
    specialWorksite: clean(input.specialWorksite ?? input.worksites ?? input.specialWorksites),
    workLocation: clean(input.workLocation ?? input.work_location),
  };
}

/**
 * The employee's four answers, composed into the one block of text the
 * EMPLOYER's approval form is prefilled with.
 *
 * WHY THERE IS A PREFILL AT ALL, and it is Remote's own process rather than a
 * convenience. Help Center article `20094378700557`: when approving, the admin
 * must *"use the additional information section to provide specific details
 * about the activities the employee is expected to perform during the travel."*
 * So the decisive fact is captured TWICE — the employee claims it, then the
 * employer states it — and the second capture is the one that ends up on the
 * record Remote acts on. An empty box at that moment is how the second capture
 * becomes a paraphrase of nothing, or a copy-paste of whatever the manager can
 * still remember.
 *
 * IT IS A STARTING POINT, NEVER AN ANSWER PUT IN SOMEBODY'S MOUTH. The employer
 * is a different party making a different statement — Remote asks them for what
 * the employee is *expected* to perform, which is the company's account and not
 * the traveller's. The field they see is editable, its provenance says whose
 * words are in it, and what they submit is recorded as theirs. Prefilling and
 * then recording the result as the employee's claim would merge two parties'
 * statements into one, which is the defect this whole panel is built to avoid.
 *
 * ONE FUNCTION, SO THE TWO SURFACES CANNOT DRIFT. The ZAF sidebar renders these
 * same four answers through `describeActivityProfile()`; this composes the same
 * four into prose. A second spelling of "what the employee said" would be a
 * second place for it to be wrong, and the owner's requirement is explicitly
 * that the employer's field carry exactly what the specialist's panel shows.
 *
 * Returns null when there is nothing to compose — an empty prefill is correct
 * and must not become an empty string that looks like an answered field.
 *
 * @param {object|null} profile  the output of normalizeActivityProfile()
 * @returns {string|null}
 */
export function activityStatementPrefill(profile) {
  if (!profile) return null;
  const lines = ACTIVITY_QUESTIONS.map((question) => {
    const value = profile[question.field];
    // ONE QUESTION, ONE LINE, ALWAYS — and this is a security property, not
    // formatting. Every value here is unvalidated employee free text, and the
    // composition below is `label: value` joined by newlines. An employee who
    // types a newline into "where you will be working" can therefore author a
    // line that reads exactly like one of ours: a fabricated
    // "Special worksites: none" contradicting the real answer three lines up,
    // or a whole sentence — "Approved on condition that the employee MAY sign
    // client contracts" — that arrives in the Zendesk hand-off under
    // "Employer's words:" attributed to a named manager. Collapsing every
    // whitespace run to a single space makes each answer occupy exactly the one
    // line its own label owns. It cannot be got round by more newlines.
    return value ? `${question.label}: ${value.replace(/\s+/gu, " ").trim()}` : null;
  }).filter(Boolean);
  if (!lines.length) return null;

  /* AND A BOUND, BECAUSE THIS IS NOW THE DEFAULT BODY OF A WRITE. Four fields
     at ACTIVITY_FIELD_MAX_CHARS is over 8,000 characters, and that cap was
     chosen for a rendered panel, not for a string that flows unread into
     `approval_note` and into a Zendesk note. Over the bound the answer is NOT
     truncated — a clipped quotation attributed to the employer is worse than no
     quotation, and the manager can read the answers in full a few rows above.
     The box is left empty instead, which is the state it was in before any of
     this and is never wrong. */
  const composed = lines.join("\n");
  return composed.length > ACTIVITY_PREFILL_MAX_CHARS ? null : composed;
}

/**
 * The panel's view of it: four rows, each with what was said or which silence
 * this is, and one sentence of provenance for the block.
 *
 * NOT A VERDICT, AND NO BRANCH HERE PRODUCES ONE. There is no state, no flag
 * and no score — the specialist reads what the traveller wrote. See the header
 * for why a rule keyed on this text would make the answer worse rather than
 * safer.
 *
 * @param {object|null} profile  the output of normalizeActivityProfile()
 * @returns {{asked:boolean, fields:Array, finding:string}}
 */
export function describeActivityProfile(profile) {
  const asked = Boolean(profile);
  const fields = ACTIVITY_QUESTIONS.map((question) => ({
    key: question.key,
    label: question.label,
    value: asked ? (profile[question.field] ?? null) : null,
    absence: asked
      ? question.absence
      : "This request was filed through a surface that does not ask the question. Nothing here is a statement about the trip.",
  }));

  return {
    asked,
    fields,
    finding: asked
      ? "Stated by the requester in their own words, and read by nobody but you: no gate, score or model reads any " +
        "of it. Remote's Mobility Team assesses the nature of intended activities, and these are the three questions " +
        "Remote's own form asks."
      : "This request carries no account of the intended activities. Remote's own form asks for them, and a request " +
        "that did not come through a surface asking the question has not answered it — which is not the same as " +
        "there being nothing to report.",
  };
}
