// ---------------------------------------------------------------------------
// employeeSubject.js  —  the person a decision is about, published by name
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
//
// The project owner, reading the ZAF sidebar on a live ticket: *"In that Zendesk
// bar I never even saw any relevant info of the employee — not even name. That
// is bad."*
//
// They were right, and `zaf-app/assets/main.js` had already found it and could
// not fix it from where it stood: `RemoteClient.getEmployment()` normalises a
// display name onto every employment it returns (`full_name`, from
// `raw.full_name` or `basic_information.name`), and NONE of the nine by-ticket
// views published it. The stores persist `employment_id` and nothing else about
// the person, so the sidebar was handed a UUID and a name was not one of the
// fields it was sent. A specialist deciding whether to sign a travel letter or
// approve a workation was shown `3537d9ee-2017-4a53-952e-9d3b042aeab5` where a
// human being belongs.
//
// THE TWO SHAPES, AND WHY THIS ONE.
//
//   (a) PERSIST a display name on the record at decision time. No call at view
//       time. Rejected on three counts. It freezes a fact that can change —
//       a name corrected, an employment ended — and a panel showing a name
//       frozen weeks ago is a panel quietly disagreeing with the document the
//       button is about to produce. It puts personal data in a second place, in
//       nine tables, permanently, when the stores today hold only an opaque id.
//       And it needs a schema change on nine stores to answer a question one
//       GET already answers.
//
//   (b) RE-READ the employment at view time — this file. It is the same read
//       the ACTION on that screen already performs: `submitTravelLetterSignoff()`
//       (uc03/workflow.js) and `submitWorkationApproval()` (uc04/workflow.js)
//       both call `remote.getEmployment()` immediately before acting, because
//       "is this employee active?" was checked when the ticket arrived and the
//       approval can be days later. So the panel and the button now read the
//       SAME record at the SAME freshness. Under (a) they could not: the screen
//       would show the decision-time snapshot and the button would act on a
//       record it never showed anyone.
//
//   The cost is one GET per panel open, by a human, once. That is the price of
//   the screen and the action agreeing.
//
// AN ABSENCE IS NEVER A BLANK, AND NEVER THE ID RELABELLED. Five states, not
// two, because `src/shared/upstreamFailure.js` already established that "Remote
// says there is no such record" and "we could not ask Remote" are different
// facts with different fixes — and a specialist reading a name that quietly
// failed to load is worse served than one told it could not be fetched.
//
//   available        the record was read; `fields` carries what it holds
//   not_found        Remote answered 404. An answer ABOUT the record.
//   unavailable      403 / 5xx / transport. NOTHING about this person is known.
//   not_looked_up    this API has no Remote client wired in at all.
//   no_employment_id the stored row names no employment to look up.
//
// IT DECIDES NOTHING, AND CANNOT. Same contract as `describeDecidingGate()` and
// `describeDecisionBasis()`: it is consulted after a decision exists, by a view,
// and no gate, policy or approval reads it. A failed read here degrades the
// SCREEN and never the outcome — every caller wraps it so that a Remote outage
// makes the panel say "could not be fetched", not 500.
//
// EACH USE CASE CHOOSES ITS OWN FIELDS, and that is the point of the registry
// below rather than a fixed block of nine rows everywhere. A travel-letter
// signer and an off-cycle-payment approver need different facts about the same
// person; see each caller for the argument. Compensation is NOT in the registry
// at all — see the note on MONEY at the bottom of this header.
//
// MONEY IS NOT AUTOMATICALLY RELEVANT (CLAUDE.md §3, and `src/uc01/letter.js`'s
// two tests). No field in this registry reads pay, hours or currency, and no
// caller can ask for one, because the registry is a closed set and an unknown
// key throws at call time rather than silently rendering nothing. A use case
// whose decision genuinely turns on money publishes it from its own domain data
// — UC-06's amendment already publishes the old and new salary it is amending,
// and UC-09's adjustment the amount it is paying — where it is the SUBJECT of
// the decision rather than a fact about the person that came along for free.
// ---------------------------------------------------------------------------

import { countryNameAndCode } from "./countryNames.js";
import { contractTypeLabel, CONTRACT_TYPE_NOT_DETERMINED } from "./contractTypes.js";

/** State: the record was read and `fields` describes it. */
export const SUBJECT_AVAILABLE = "available";
/** State: Remote answered 404 — an authoritative answer about the record. */
export const SUBJECT_NOT_FOUND = "not_found";
/** State: Remote refused or could not be reached. Nothing is known. */
export const SUBJECT_UNAVAILABLE = "unavailable";
/** State: this API was wired without a Remote client, so nothing was asked. */
export const SUBJECT_NOT_LOOKED_UP = "not_looked_up";
/** State: the stored row names no employment. */
export const SUBJECT_NO_EMPLOYMENT_ID = "no_employment_id";

// The engagement type in words lives in `./contractTypes.js`, which is the ONE
// copy of that vocabulary. This file used to hold a private four-entry map, and
// so did `src/uc01/letter.js` and `src/uc03/letter.js` — three copies, identical
// and none of them knowing it, and not one holding an entry for
// `global_payroll`. That is the value `normalizeEmployment()` writes for a
// live global-payroll employment, and THIS panel is where it reached a
// specialist as the raw slug "global_payroll".

/**
 * The closed set of facts about a person any view may publish.
 *
 * `read` returns a DISPLAY STRING or null. Null is never a blank on the screen:
 * the caller renders `absence` beside the label, so "the record carries no job
 * title" is distinguishable from "nobody thought to show it".
 *
 * There is no entry for pay, hours, currency, bank details, personal email,
 * mobile number, date of birth or address. Some of those the normalizer holds
 * (`mobile_number`, `login_email`); none of them is a fact any of the nine
 * decisions turns on, and a registry is the place to refuse them once.
 */
const FIELDS = Object.freeze({
  full_name: {
    label: "Name",
    read: (e) => text(e.full_name),
    absence: "The employment record carries no display name.",
  },
  job_title: {
    label: "Job title",
    read: (e) => text(e.job_title),
    absence: "The employment record carries no job title.",
  },
  status: {
    label: "Employment status",
    read: (e) => text(e.status),
    absence: "The employment record carries no status.",
  },
  contract_type: {
    label: "Contract type",
    read: (e) => {
      const raw = text(e.contract_type);
      if (!raw) return null;
      // "unknown" is what normalizeEmployment() writes when the API offered
      // neither `employment_model` nor `type`. It is a real value meaning "we
      // could not tell", and rendering it as a contract type would make it look
      // like one. NULL rather than the shared module's `absent` string, because
      // this registry's `absence` prose below says the same thing at length and
      // is what the panel renders — two competing sentences would be worse than
      // either. `contractTypeName()` returns null for it too; the check stays
      // here so this file's own reason survives next to this file's own prose.
      if (raw === CONTRACT_TYPE_NOT_DETERMINED) return null;
      // A value with no curated label reaches the reader MARKED as unrecognised
      // rather than as a bare slug — see contractTypes.js's header for why that
      // departs from countryLabel()'s bare-code fallback. The marker string is
      // NOT repeated here: `contractTypeLabel()` owns it, so there is one
      // wording for one state across all three surfaces.
      return contractTypeLabel(raw);
    },
    absence:
      "The employment record does not say which engagement type this is — the normalizer records 'unknown' when Remote offers neither an employment model nor a type.",
  },
  country_code: {
    label: "Country of employment",
    // Name and code together, because this is a value somebody may have to
    // quote back or compare against a code on the request.
    read: (e) => (text(e.country_code) ? countryNameAndCode(e.country_code, "") || null : null),
    absence:
      "The employment record carries no usable 2-letter country code. `normalizeEmployment()` yields null rather than a 3-letter code it cannot convert, so this is 'not confirmed', not 'nowhere'.",
  },
  start_date: {
    label: "Start date",
    read: (e) => text(e.start_date),
    absence: "The employment record carries no start date.",
  },
  email: {
    label: "Work email",
    read: (e) => text(e.email),
    absence: "The employment record carries no work email.",
  },
});

/** Every field key a caller may ask for. Exported for tests and for a caller
 *  that wants to assert its own list against the registry. */
export const EMPLOYEE_FIELD_KEYS = Object.freeze(Object.keys(FIELDS));

function text(value) {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed === "" ? null : trimmed;
  }
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

/**
 * ONE READ, IN THE FIVE-STATE VOCABULARY — split out of `describeEmployee()`
 * on 2026-08-31 so a caller that needs the RECORD as well as the display rows
 * can have both for one GET.
 *
 * WHY IT IS EXPORTED RATHER THAN INLINE. UC-04's fourth dimension reports what
 * documents Remote holds (`src/uc04/identityDocuments.js`), and its panel
 * already re-reads the employment for the subject block one function over.
 * Without this split the choice was a second GET per panel open or a second
 * copy of the not_found / unavailable / not_looked_up distinction — and that
 * distinction is the whole point of this file, so a second copy of it is the
 * worse of the two.
 *
 * `employment` is the raw normalized record and is NOT part of what any panel
 * renders: `describeEmployee()` still publishes only the closed `FIELDS`
 * registry, so nothing here widens what reaches a screen. A caller wanting the
 * record must ask for it by name and answer for what it does with it.
 *
 * @param {object} args
 * @param {{getEmployment: Function}|null} args.remote
 * @param {string|null} args.employmentId
 * @returns {Promise<{state:string, employmentId:string|null, employment:object|null, httpStatus:number|null, finding:string}>}
 */
export async function readEmploymentForSubject({ remote, employmentId }) {
  const id = text(employmentId);
  if (!id) {
    return {
      state: SUBJECT_NO_EMPLOYMENT_ID,
      employmentId: null,
      employment: null,
      httpStatus: null,
      finding:
        "This record names no employment, so there is no person to look up. It is a record with the field missing, not a record about nobody.",
    };
  }

  if (!remote || typeof remote.getEmployment !== "function") {
    return {
      state: SUBJECT_NOT_LOOKED_UP,
      employmentId: id,
      employment: null,
      httpStatus: null,
      finding:
        `No Remote client is wired into this API, so nothing about employment ${id} was asked for. This says nothing about the employee — only that this deployment cannot read them.`,
    };
  }

  let employment = null;
  try {
    employment = await remote.getEmployment(id);
  } catch (err) {
    // RemoteClient returns null on 404 and THROWS on anything else, carrying
    // the status when it has one. So a throw here is never "the record is
    // gone" — it is "the request was not evaluated", which is the distinction
    // src/shared/upstreamFailure.js exists to keep.
    const status = Number.isInteger(err?.status) ? err.status : null;
    return {
      state: SUBJECT_UNAVAILABLE,
      employmentId: id,
      employment: null,
      httpStatus: status,
      finding:
        `Remote could not be asked about employment ${id}${status ? ` (HTTP ${status})` : ""}. This is a failure to read, not a finding about the employee: nothing here says the record is missing, inactive or wrong.`,
    };
  }

  if (!employment) {
    return {
      state: SUBJECT_NOT_FOUND,
      employmentId: id,
      employment: null,
      httpStatus: 404,
      finding:
        `Remote answered that employment ${id} does not exist. That is an answer about the record: either the id on this case is wrong, or the employment has been removed since the decision was made.`,
    };
  }

  return { state: SUBJECT_AVAILABLE, employmentId: id, employment, httpStatus: null, finding: "" };
}

/**
 * The person this decision is about, read fresh from Remote.
 *
 * @param {object} args
 * @param {{getEmployment: Function}|null} args.remote  the REST client, or null
 *   when this API was wired without one. Null is a STATE, not an error.
 * @param {string|null} args.employmentId  off the stored row.
 * @param {string[]} args.fields  ordered field keys from EMPLOYEE_FIELD_KEYS.
 *   Chosen per use case and argued at each call site.
 * @param {() => Date} [args.now]  injectable clock, so `readAt` is testable.
 * @param {object|null} [args.read]  a `readEmploymentForSubject()` result this
 *   caller already has. Supplied ONLY to avoid a second GET for the same
 *   record on the same panel open; when absent this function reads for itself
 *   exactly as it always has, so the eight callers that pass nothing are
 *   unchanged.
 * @returns {Promise<object>} always an object, never null, never a throw.
 */
export async function describeEmployee({ remote, employmentId, fields, now = () => new Date(), read = null }) {
  const chosen = Array.isArray(fields) ? fields : [];
  for (const key of chosen) {
    // A typo'd key must not degrade to a silently missing row. This is the same
    // rule `verify-traces` enforces on n8n's probe names: a name nothing
    // recognises is indistinguishable from an absence, forever, without error.
    if (!Object.prototype.hasOwnProperty.call(FIELDS, key)) {
      throw new Error(`describeEmployee: unknown field '${key}'. Known: ${EMPLOYEE_FIELD_KEYS.join(", ")}`);
    }
  }

  const outcome = read ?? (await readEmploymentForSubject({ remote, employmentId }));
  if (outcome.state !== SUBJECT_AVAILABLE) {
    return frame({
      state: outcome.state,
      employmentId: outcome.employmentId,
      httpStatus: outcome.httpStatus,
      finding: outcome.finding,
    });
  }
  const { employment, employmentId: id } = outcome;

  const rows = chosen.map((key) => {
    const spec = FIELDS[key];
    const value = spec.read(employment) ?? null;
    return value === null
      ? { key, label: spec.label, value: null, absence: spec.absence }
      : { key, label: spec.label, value, absence: null };
  });

  return frame({
    state: SUBJECT_AVAILABLE,
    employmentId: id,
    // Lifted out of `fields` as well as being in it: a renderer wants a heading
    // and should not have to search an array for the key that is the person's
    // name. Null when the record genuinely carries none, which is a real case
    // the display must handle rather than fall back to the id.
    displayName: text(employment.full_name),
    fields: rows,
    readAt: now().toISOString(),
    finding:
      "Read from Remote just now, when this screen was opened — not a snapshot stored at decision time. It is the same record the action on this screen re-reads before it acts.",
  });
}

/** One shape for all five states, so a renderer needs one branch on `state`
 *  and never a test for the presence of a key. */
function frame({ state, employmentId, displayName = null, fields = [], readAt = null, httpStatus = null, finding }) {
  return { state, employmentId, displayName, fields, readAt, httpStatus, finding };
}
