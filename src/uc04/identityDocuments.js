// ---------------------------------------------------------------------------
// identityDocuments.js  —  what Remote holds, and exactly what that proves
// ---------------------------------------------------------------------------
// WHY THIS EXISTS (2026-08-31)
//
// The project owner, reading UC-04's fourth dimension on a live ticket:
// *"Immigration documents. Is this documents the employee we provide? In every
// life scenario, would the employee have an important documents in their
// sandbox or in their employee details, or did they usually have that?"*
//
// The answer turned out to be yes on both counts, and the panel was saying no
// without having looked. Three separate findings, each measured:
//
//   RUNG 1 — REMOTE REALLY DOES COLLECT THESE. Remote's own help centre,
//   *"Remote's Right-to-Work Checks"* (article 31105131499789, retrieved
//   2026-08-31): *"Remote collects nationally recognized identification
//   documents and conducts secure identity verification through trusted
//   providers. For employees working in a country other than their country of
//   nationality or usual residence, the Mobility team reviews residence permits
//   and other relevant documentation to confirm both legal stay and work
//   authorization."* So this is ordinary EOR onboarding, not an exotic case,
//   and Remote — not only the employee — is the party holding the document.
//
//   RUNG 1 — THE API HAS A TYPED HOME FOR IT, ON THE RECORD UC-04 ALREADY
//   READS. `GET /v1/employments/{id}` carries `files[]`, documented as
//   *"Documents associated with this employment (e.g., contracts, tax forms,
//   identity documents)"*, whose `File` schema example is literally
//   `{name: "id.pdf", type: "id", sub_type: "personal_id"}`.
//
//   RUNG 2 — THE SANDBOX HOLDS NONE. Swept 2026-08-31 across all 112
//   employments: 333 files, of types `contract` 108, `expense` 221,
//   `document_scan` 2, `background_check` 2 — and ZERO of type `id`, every
//   `sub_type` null. (The two `document_scan` rows are named `receipt.pdf`.)
//   A Sandbox that holds none of a thing is rung 2 being empty; it is never
//   rung 1 answering (CLAUDE.md §3), so nothing here reads that emptiness as a
//   statement about how Remote works.
//
// And `normalizeEmployment()` discarded the array entirely, so the dimension's
// evidence row `Document read from Remote: none` was a hard-coded string on a
// record that had already been fetched.
//
// ---------------------------------------------------------------------------
// THE BOUND, WHICH IS THE WHOLE REASON THIS FILE IS CAREFUL
// ---------------------------------------------------------------------------
// FINDING AN IDENTITY DOCUMENT MUST NOT CLEAR THIS DIMENSION, and this is not
// caution for its own sake — it is what Remote's own documentation says. A
// right-to-work document on the employment record establishes entitlement in
// the COUNTRY OF EMPLOYMENT. UC-04 asks about the DESTINATION, and Remote's
// *"Remote Work Authorization"* article (37802834593805, updated 2026-08-18)
// puts the answer on both sides at once: a work authorization is *"subject to
// the visa or work permit regulations of both the destination country and the
// employment country."*
//
// So UC-04.md §5's "never inferred from 'this destination usually doesn't
// enforce it'" and §9's "No immigration document on file → Escalate — never
// inferred" both survive this change untouched. What changes is only that the
// panel now reports a real, bounded fact where it used to report a hard-coded
// absence. `summariseIdentityDocuments()` returns no `cleared` state and has no
// caller that could produce one: every state below is either an absence or a
// presence explicitly scoped to the wrong country.
//
// NO GATE READS THIS. Same contract as `describeDecisionBasis()` and
// `describeEmployee()` — consulted after a decision exists, by a view. Nothing
// in policyEngine.js, riskMatrix.js, approvalPolicy.js or workflow.js imports
// this file, and `test/uc04ImmigrationDocuments.js` pins that structurally, for
// the same reason decisionSources.js is pinned: a fact that cannot change an
// outcome can be shown honestly without anyone having to re-audit the gates.
//
// PRESENCE ONLY — NEVER CONTENT. No file name, document number, URL or byte
// ever leaves this function. A specialist is told THAT a document of a given
// type is on the record and when it was filed; to read it they go to Remote,
// which is where the access control is. Prime directive #5 is why: this repo
// does not become a second place a personal identity document is legible.
// ---------------------------------------------------------------------------

/**
 * Remote's own `type` value for an identity document, per the `File` schema.
 * ONE ENTRY, DELIBERATELY. `document_scan` and `background_check` also exist in
 * the Sandbox and neither is an identity document — a background check is a
 * report ABOUT a person and a scan is untyped by definition, so folding either
 * in would manufacture the very confirmation this file's header refuses.
 */
export const IDENTITY_FILE_TYPES = Object.freeze(["id"]);

/** The record was never looked at — no employment was read at all. */
export const DOCS_NOT_READ = "not_read";
/** A record was read, but it carries no `files` key. Nothing was searched. */
export const DOCS_FIELD_ABSENT = "field_absent";
/** The record was read, `files` was present, and no identity document is in it. */
export const DOCS_NONE_ON_FILE = "none_on_file";
/** The record was read and carries at least one identity document. */
export const DOCS_ON_FILE = "on_file";

function isPlainFile(entry) {
  return Boolean(entry) && typeof entry === "object" && !Array.isArray(entry);
}

function textOf(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * What the employment record says about identity documents — presence, kinds
 * and dates only.
 *
 * FOUR STATES, NOT TWO, and the split that matters is between the first three.
 * "nobody looked", "we looked at a record with no such field" and "we looked
 * and there are none" were all rendering as the same word before this file
 * existed, and only the third is a fact about the employee. The same argument
 * `src/shared/employeeSubject.js` makes for its five states, and the same one
 * `src/shared/upstreamFailure.js` makes for `not_found` vs `unavailable`.
 *
 * @param {object|null} employment  a `normalizeEmployment()` result, or null
 *   when no record was read.
 * @returns {{
 *   state: string,
 *   count: number,
 *   kinds: string[],
 *   mostRecent: string|null,
 *   totalFiles: number|null,
 *   otherTypes: string[],
 *   standin: boolean
 * }}
 */
export function summariseIdentityDocuments(employment) {
  const empty = { count: 0, kinds: [], mostRecent: null, totalFiles: null, otherTypes: [], standin: false };

  if (!employment || typeof employment !== "object" || Array.isArray(employment)) {
    return { state: DOCS_NOT_READ, ...empty };
  }

  const files = employment.files;
  // AN ABSENT KEY IS NOT AN EMPTY ARRAY — see normalizeEmployment()'s note on
  // the same distinction. `null` reaches here for a record read before this
  // field was carried, for the mock's flat shape, and for any caller passing a
  // hand-built object; none of those is a finding that the employee has no
  // documents, and reporting them as one is exactly the defect being fixed.
  if (!Array.isArray(files)) return { state: DOCS_FIELD_ABSENT, ...empty };

  const rows = files.filter(isPlainFile);
  const identity = rows.filter((f) => IDENTITY_FILE_TYPES.includes(textOf(f.type) ?? ""));

  // Every non-identity type on the record, named. A specialist who is told
  // "no identity document" is owed the difference between an empty record and a
  // record holding eight contracts and no passport — the second says the
  // integration works and the document is genuinely not filed.
  const otherTypes = [...new Set(rows.map((f) => textOf(f.type)).filter((t) => t && !IDENTITY_FILE_TYPES.includes(t)))].sort();

  // The kind of identity document, in Remote's own `sub_type` vocabulary
  // (`personal_id` in its schema example). Not translated into prose: this file
  // does not hold a curated vocabulary for a field whose value set has never
  // been observed populated — every `sub_type` in the Sandbox is null — and
  // inventing labels for values nobody has seen is how a display starts
  // disagreeing with the API it describes.
  const kinds = [...new Set(identity.map((f) => textOf(f.sub_type)).filter(Boolean))].sort();

  const dates = identity
    .map((f) => textOf(f.inserted_at) ?? textOf(f.created_at))
    .filter(Boolean)
    .sort();

  // SELF-IDENTIFYING SUBSTITUTION, SURFACED RATHER THAN SMOOTHED OVER
  // (CLAUDE.md §3, rungs 3 and 4). The Sandbox holds no identity document at
  // all, so the only way to demonstrate the populated branch is a fixture — and
  // a fixture that reaches a reader looking like something Remote said is the
  // one thing the ladder forbids outright. Any `standin-` id makes the whole
  // summary declare itself, and every surface that renders this prints the
  // declaration beside the finding.
  const standin = identity.some((f) => String(f.id ?? "").startsWith("standin-"));

  return {
    state: identity.length > 0 ? DOCS_ON_FILE : DOCS_NONE_ON_FILE,
    count: identity.length,
    kinds,
    mostRecent: dates.length ? dates[dates.length - 1] : null,
    totalFiles: rows.length,
    otherTypes,
    standin,
  };
}
