// ---------------------------------------------------------------------------
// workAuthStandin.js  —  Rung 3: the work-authorization requests Remote cannot
//                        hold, and could not create even if it wanted to
// ---------------------------------------------------------------------------
// WHY THIS FILE EXISTS — the substitution ladder, applied one rung at a time
// (CLAUDE.md §3 directive 6, docs/SANDBOX-STANDIN.md).
//
//   Rung 1 — Remote's documentation ANSWERS the shape. Every field below is a
//     property of Remote's own `WorkAuthorizationRequest` schema and nothing
//     else is added. Not one field is invented.
//   Rung 2 — the Sandbox ANSWERS THE READ and is used for it. Verified live
//     2026-08-30: `GET /v1/work-authorization-requests` -> **200**, correct
//     envelope (`total_count, current_page, total_pages,
//     work_authorization_requests`), and **0 rows**. The server asks it on
//     every list, every time, and reports what it got back.
//   Rung 2 CANNOT CREATE ONE, and that is a property of the API rather than of
//     our credentials: `POST /v1/work-authorization-requests` -> **404** and
//     `POST /v1/employee/work-authorization-requests` -> **404**. Remote's
//     contract is create-by-employee-in-the-Request-Hub, decide-by-API. So
//     there is no request anywhere for an employer to decide, and stage 2 —
//     the entire subject of this surface — would be permanently
//     undemonstrable.
//   Rung 3 — THIS FILE supplies the object, and only the object.
//
// A USE CASE THAT CAN ONLY EVER REFUSE IS INDISTINGUISHABLE FROM A BROKEN ONE.
// That is the sentence docs/SANDBOX-STANDIN.md §1 was written around, and it is
// exactly the state this surface would otherwise ship in: an empty list, on
// every load, forever, with a plausible reason.
//
// THE TWO CONSTRAINTS THAT MAKE THIS HONEST RATHER THAN A FAKE, neither
// negotiable:
//
//   1. EVERY SUBSTITUTED FACT IS SELF-IDENTIFYING. Ids begin `standin-`. Every
//      record carries a `_standin` block naming what it is and why it exists,
//      so the record stays self-describing when it is read alone — out of its
//      envelope, in a log line, inside an audit payload. The list response
//      names the stand-in ids in a header as well
//      (`X-Standin-Work-Authorizations`), the same shape src/remotebridge/
//      uses. Nothing here can reach a reader looking like something Remote
//      said.
//   2. NOTHING IS FABRICATED THAT REMOTE WOULD HAVE SUPPLIED. `submitted_at`
//      is a date the stand-in owns, because the stand-in is what created the
//      row. `employer_approver` starts null and is filled only from the SESSION
//      of whoever actually decides — a fact we hold, not one we guess. Remote's
//      own stage-3 verdict fields are never touched: no record here ever
//      reaches `approved_by_remote`, because inventing Remote's compliance
//      answer is precisely the defect src/uc04/workflow.js's header records
//      this repository shipping once already.
//
// THE COMPANY LIVES OUTSIDE THE RECORD, exactly as Remote's does. There is no
// employment reference on the wire: Remote's list endpoint documents an
// `employment_id` filter that its own server resolves internally, and
// src/remote/mockServer.js keeps its index outside the record for the same
// reason. Putting a `company_id` on the record would be this file teaching a
// field the real API has never returned — the one failure mode the whole UC-04
// fixture block exists to stop repeating.
// ---------------------------------------------------------------------------

/** Every stand-in id begins with this. One prefix, checked in one place. */
export const STANDIN_ID_PREFIX = "standin-";

/** The marker key on every stand-in record (src/remotebridge/'s STANDIN_ROW_KEY). */
export const STANDIN_ROW_KEY = "_standin";

/** Response header naming the stand-in rows in a payload, like X-Standin-Enriched. */
export const STANDIN_HEADER = "X-Standin-Work-Authorizations";

/** Is this id one of ours? The one test a write path runs before choosing a world. */
export function isStandinId(id) {
  return typeof id === "string" && id.startsWith(STANDIN_ID_PREFIX);
}

const STANDIN_NOTE =
  "STAND-IN RECORD — not Remote data. Remote publishes no endpoint that creates a work-authorization " +
  "request (POST answers 404 on both the company and the employee path; an employee raises one inside " +
  "Remote's own Request Hub), and the Sandbox holds none, so there would otherwise be nothing for an " +
  "employer to decide. Every FIELD below is a property of Remote's WorkAuthorizationRequest schema; the " +
  "VALUES are this repository's. A decision on this record is written here and is never sent to Remote.";

/**
 * Country objects in Remote's own shape — `destination_country` is a full
 * `Country`, never a bare code. Local to this file rather than imported from
 * the mock, because a stand-in must not depend on a fixture it is standing in
 * beside; these are ours and are marked as ours by the record that carries them.
 */
const ES = Object.freeze({
  alpha_2_code: "ES",
  code: "ESP",
  name: "Spain",
  region: "Europe",
  subregion: "Southern Europe",
  eor_onboarding: true,
});
const PT = Object.freeze({
  alpha_2_code: "PT",
  code: "PRT",
  name: "Portugal",
  region: "Europe",
  subregion: "Southern Europe",
  eor_onboarding: true,
});
const IT = Object.freeze({
  alpha_2_code: "IT",
  code: "ITA",
  name: "Italy",
  region: "Europe",
  subregion: "Southern Europe",
  eor_onboarding: true,
});

/**
 * The requests this surface stands in with.
 *
 * The people are the portal's personas (src/portal/personas.js), read-only, so
 * a reviewer meets the same names on both surfaces and there is no second
 * roster to drift. The `employmentId` sits in the INDEX below, never on the
 * record — and no company sits anywhere here at all: see the INDEX comment.
 *
 * FOUR ROWS, EACH CARRYING ONE THING THE SURFACE HAS TO BE ABLE TO SHOW:
 *   - two ordinary pending requests at Acme, so the approve and the decline
 *     paths each have a subject and the positive case is reachable;
 *   - one at a DIFFERENT company, so the company boundary is demonstrable as a
 *     refusal rather than only asserted in a comment;
 *   - one already settled, so "this is no longer awaiting a manager" is
 *     reachable without first spending the pending one.
 */
const FIXTURES = {
  "standin-wa-0001": {
    id: "standin-wa-0001",
    status: "pending",
    submitted_at: "2026-08-24T09:12:00Z",
    reason: "Workation",
    additional_information: "Working alongside the Madrid team for two weeks.",
    travel_date_start: "2026-09-01",
    travel_date_end: "2026-09-14",
    travel_document_number: "US998877",
    work_location: "Coworking space, Madrid",
    will_negotiate_or_sign_contracts: false,
    employer_special_instructions: null,
    destination_country: ES,
    user: { id: "usr_chris_lee", name: "Chris Lee", email: "chris.lee@acme.test" },
    employer_approver: null,
  },
  "standin-wa-0002": {
    id: "standin-wa-0002",
    status: "pending",
    submitted_at: "2026-08-26T14:40:00Z",
    reason: "Client meetings",
    additional_information: "Two client meetings in Lisbon, then remote work from the hotel.",
    travel_date_start: "2026-10-05",
    travel_date_end: "2026-10-16",
    travel_document_number: "GB4412907",
    work_location: "Lisbon",
    // TRUE, and it is the field a manager is meant to stop on: signing on the
    // company's behalf abroad is the permanent-establishment question UC-04's
    // risk matrix exists for. Left here so the screen has something a human
    // would actually weigh rather than a uniformly harmless list.
    will_negotiate_or_sign_contracts: true,
    employer_special_instructions: null,
    destination_country: PT,
    user: { id: "usr_emma", name: "Emma Thompson", email: "emma.thompson@acme.test" },
    employer_approver: null,
  },
  // THE COMPANY BOUNDARY, as a record rather than as a claim. Lars is the one
  // persona NOT employed by Acme (src/portal/personas.js: co_northwind_02), so
  // Acme's admin must neither see this nor be able to decide it by quoting the
  // id. A boundary nothing exercises is a boundary nobody has checked.
  "standin-wa-0003": {
    id: "standin-wa-0003",
    status: "pending",
    submitted_at: "2026-08-27T08:05:00Z",
    reason: "Workation",
    additional_information: "Three weeks from Milan.",
    travel_date_start: "2026-09-07",
    travel_date_end: "2026-09-27",
    travel_document_number: "NL7712345",
    work_location: "Milan",
    will_negotiate_or_sign_contracts: false,
    employer_special_instructions: null,
    destination_country: IT,
    user: { id: "usr_lars", name: "Lars van der Berg", email: "lars.vandenberg@northwind.test" },
    employer_approver: null,
  },
  // Already settled — so the "no longer awaiting a manager" refusal is
  // reachable without spending one of the two pending rows above it.
  "standin-wa-0004": {
    id: "standin-wa-0004",
    status: "approved_by_manager",
    submitted_at: "2026-07-02T08:00:00Z",
    reason: "Conference",
    additional_information: "Attending a conference in Lisbon.",
    travel_date_start: "2026-07-20",
    travel_date_end: "2026-07-24",
    travel_document_number: "US998877",
    work_location: "Lisbon",
    will_negotiate_or_sign_contracts: false,
    employer_special_instructions: "Approved on condition that no client contracts are signed.",
    destination_country: PT,
    user: { id: "usr_chris_lee", name: "Chris Lee", email: "chris.lee@acme.test" },
    employer_approver: { id: "admin_jane", name: "Jane Doe", email: "jane.doe@acme.test" },
  },
};

/**
 * The employment index Remote's list filter implies but its response body does
 * not carry. Outside the record, deliberately — see the header.
 *
 * ONE FIELD, AND THE FIELD THAT IS ABSENT IS THE POINT. This map used to carry
 * a `companyId` beside each employment, and the store filtered on it. That was
 * a rung-3 fixture ASSERTING a company association over an employment record
 * that answers the question itself — which is the one thing the substitution
 * ladder forbids: rung 3 may fill what rung 2 left empty, and a real value
 * always wins (CLAUDE.md §3 directive 6).
 *
 * The cost was not theoretical. Driven against a Remote whose employments are
 * at a different company from the demo session's, one response said in its
 * `scope` block that Chris Lee is NOT in this company and in its `requests`
 * block that Chris Lee's request IS this company's to decide. Both from the
 * same payload, because the two answers came from two different authorities.
 *
 * So a stand-in row now names an EMPLOYMENT and nothing more. Whose company
 * that employment belongs to is read back off the employment record by
 * ./workAuthScope.js, from the same read the boundary itself is built on — and
 * an employment that cannot be read yields no company and no listing, which is
 * rung 3 declining to fill a field it has no right to.
 *
 * The employment ids are the portal personas' real Remote Sandbox ids, so a
 * reviewer can cross-check each one against their own account even though the
 * REQUEST beside it is ours.
 */
const INDEX = Object.freeze({
  "standin-wa-0001": { employmentId: "8ab12460-b568-4c1e-af9d-09b1fabd8f46" },
  "standin-wa-0002": { employmentId: "d73cff71-ced7-4bcf-b764-b9899abc6340" },
  "standin-wa-0003": { employmentId: "673a1884-86fb-4101-83d3-b6c544d93bca" },
  "standin-wa-0004": { employmentId: "8ab12460-b568-4c1e-af9d-09b1fabd8f46" },
});

/** The `_standin` block every record carries out of this store. */
function markStandin(record, index) {
  return {
    ...record,
    [STANDIN_ROW_KEY]: {
      note: STANDIN_NOTE,
      ladderRung: 3,
      source: "src/remoteui/workAuthStandin.js",
      // The EMPLOYMENT only. Named here because the record itself deliberately
      // does not carry it, so a reader holding one row out of context still
      // learns whose it is.
      //
      // NO `companyId`. A stand-in must not assert a company association: the
      // employment record answers that question, and a fixture that answered it
      // differently is exactly how one response came to contradict itself. The
      // company is attached by ./workAuthScope.js from the employment read.
      employmentId: index?.employmentId ?? null,
      sandboxProbe:
        "GET /v1/work-authorization-requests answers 200 with 0 rows, and no POST exists on this resource " +
        "(404 on both the company and the employee path), verified live 2026-08-30.",
    },
  };
}

/**
 * A stand-in store, scoped by company from its own index.
 *
 * ONE PER PROCESS BY DEFAULT AND THAT IS A LIMITATION, STATED. A decision
 * recorded here lives in this process's memory; on a serverless deployment each
 * invocation gets a fresh copy, so a stand-in row reads `pending` again on the
 * next request. The DURABLE record of the decision is the `audit_log` row the
 * server writes before it touches this store at all — that is the artifact, and
 * it is written to Postgres exactly as every other decision in this repository
 * is. Saying so is the point: the alternative is a demo surface that quietly
 * looks like it persisted something it did not.
 */
export function createWorkAuthorizationStandin(fixtures = FIXTURES) {
  const rows = structuredClone(fixtures);

  return {
    kind: "standin",

    /**
     * Every stand-in record whose employment is in the supplied set.
     *
     * THE CALLER SUPPLIES THE EMPLOYMENTS, and it can only supply ones it has
     * already established belong to the session's company by reading each
     * record back from Remote. So this store cannot widen a scope: it has no
     * company id to compare against and no way to acquire one. An employment
     * that was unreadable, or that answered with another company, is simply not
     * in the set and its requests are not returned.
     *
     * @param {Iterable<string>} employmentIds
     */
    listForEmployments(employmentIds) {
      const allowed = employmentIds instanceof Set ? employmentIds : new Set(employmentIds ?? []);
      return Object.values(rows)
        .filter((row) => allowed.has(INDEX[row.id]?.employmentId))
        .map((row) => markStandin(row, INDEX[row.id]));
    },

    /**
     * Every stand-in record, unfiltered.
     *
     * Exists so the scope resolver can REPORT the rows it left out rather than
     * dropping them silently — "this stand-in names an employment your session
     * does not own" is a fact worth showing, and a filter whose exclusions are
     * invisible is how the previous version's contradiction went unnoticed.
     */
    listAll() {
      return Object.values(rows).map((row) => markStandin(row, INDEX[row.id]));
    },

    /**
     * One record by id, WITHOUT any scoping — the caller must scope it.
     *
     * Deliberately not company-filtered here: the policy layer decides whether a
     * record is in scope, and a store that silently returned null for an
     * out-of-company id would make "no such request" and "not yours" the same
     * answer. They are different facts and the refusal codes say so.
     */
    findById(id) {
      if (!isStandinId(id) || !Object.hasOwn(rows, id)) return null;
      return markStandin(rows[id], INDEX[id]);
    },

    /** The index entry — whose employment. Read-only. Carries no company, by design. */
    indexOf(id) {
      return Object.hasOwn(INDEX, id) ? INDEX[id] : null;
    },

    /**
     * Apply an employer verdict to a stand-in record.
     *
     * Takes the SAME payload shape the real PATCH takes, built by
     * buildDecisionPayload(), so the stand-in write and the Remote write are
     * driven by one body and cannot drift into accepting different things. The
     * status is whatever that payload carries and is never chosen here.
     */
    decide(id, payload, approver = null) {
      const row = rows[id];
      if (!row) return null;
      row.status = payload.status;
      if ("employer_special_instructions" in payload) {
        row.employer_special_instructions = payload.employer_special_instructions;
      }
      // Filled from the session, never guessed. `reason` on the record is the
      // EMPLOYEE's reason for travelling; the decline branch's `reason` is the
      // MANAGER's, and the two are different things wearing one name — so the
      // manager's is not written over the employee's, exactly as the mock
      // server's PATCH route refuses to do.
      if (approver) row.employer_approver = approver;
      return markStandin(row, INDEX[id]);
    },
  };
}
