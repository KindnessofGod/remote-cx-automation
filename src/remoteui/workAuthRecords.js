// ---------------------------------------------------------------------------
// workAuthRecords.js  —  the UC-04 requests that were filed HERE, shown to the
//                        employer who has to decide them
// ---------------------------------------------------------------------------
// THE DEFECT THIS CLOSES, IN THE OWNER'S OWN WORDS: "It is meant to reflect
// INSTANTLY on the employer screen." A work-authorization request filed through
// /portal (or through the UC-03 -> UC-04 continuation) reached
// `ready_for_approval`, wrote a durable `uc04_authorizations` row, raised a
// Zendesk ticket — and never appeared at /remoteui/work-authorizations, because
// `resolveEmployerScope()` read exactly two sources: Remote's own list endpoint
// and the rung-3 stand-in store. Nothing joined the request the customer had
// just filed to the manager who is the only person Remote's API lets decide it.
// An approver who cannot see the request that was just filed has no workflow.
//
// WHY THIS IS NOT A RUNG OF THE SUBSTITUTION LADDER
// The stand-in beside this file (./workAuthStandin.js) is rung 3: it SUBSTITUTES
// for data Remote would have held if Remote published a way to create it. These
// rows are a different kind of thing entirely and must not be confused with it.
// They are not a substitute for anything — they are this system's own
// operational record of a request a real person really filed on a real surface,
// which Remote has never been told about because there is no endpoint to tell it
// (`POST /v1/work-authorization-requests` -> 404, both paths, verified live
// 2026-08-30 and recorded in ./workAuthStandin.js's header). So:
//
//   * a stand-in row is a fixture this repository wrote;
//   * a `uc04_record` row is a decision this repository made about a submission
//     it genuinely received.
//
// Both are OURS and neither is Remote's, which is why both are marked. They get
// DIFFERENT markers (`_standin` vs `_record`) because collapsing them would make
// "we invented this trip" and "somebody really asked for this trip" the same
// claim on the screen, and only one of those is a demo artefact.
//
// THE `request` OBJECT USES REMOTE'S OWN FIELD NAMES AND NOTHING ELSE.
// Every key built below is a property of Remote's `WorkAuthorizationRequest`
// schema (the same set ./workAuthStandin.js transcribes). A fact we hold that
// Remote's schema has no field for — nationality, home country, visa type, job
// duties, the risk verdict — is carried OUTSIDE `request`, on our own annotation,
// because a fixture that teaches a field the real API has never returned is the
// exact failure the whole UC-04 block in src/remote/mockServer.js exists to stop
// repeating (CLAUDE.md §6: the employment show route taught a wrong shape and no
// test ever drove the path production always takes).
//
// AND A FIELD WE DO NOT HOLD IS OMITTED, NEVER FILLED. `reason`,
// `additional_information`, `travel_document_number` and `user` are absent from
// every record built here: the portal's UC-04 intake collects none of them, and
// a required-looking field carrying plausible text nobody wrote is a fabricated
// record — the one thing the ladder forbids outright (CLAUDE.md §3 directive 6).
// `destination_country` is a PARTIAL `Country` carrying only the code the
// requester actually chose, for the same reason: Remote's `Country` has eleven
// properties and we were given one.
// ---------------------------------------------------------------------------

import { DECIDABLE_STATUS, EMPLOYER_VERBS } from "./workAuthPolicy.js";
import {
  normalizeActivityProfile,
  describeActivityProfile,
  activityStatementPrefill,
} from "../uc04/activityProfile.js";
// The ONE derivation of the counts, shared with the ZAF sidebar. See measurementsOf().
import { describeDecisionBasis } from "../uc04/decisionFacts.js";

/**
 * The `origin` discriminator for a request that came out of
 * `uc04_authorizations` rather than out of Remote or the stand-in.
 *
 * Named `uc04_record` and not `portal`, deliberately. The store holds rows from
 * every intake this repository has — the portal, the UC-03 continuation, the
 * Zendesk/n8n path, `npm run uc04-api`'s seeds — and calling all of them
 * "portal" would be the screen asserting a provenance it did not check. Which
 * surface a given row came from is a fact the row already carries in its own
 * `source` column, and it is reported per-entry as `filedVia` below rather than
 * baked into the origin of the whole class.
 */
export const RECORD_ORIGIN = "uc04_record";

/** The marker key on every record built here — the `_standin` of this class. */
export const RECORD_ROW_KEY = "_record";

/** Response header naming the uc04_authorizations rows in a payload. */
export const RECORD_HEADER = "X-Uc04-Record-Work-Authorizations";

/**
 * `uc04_authorizations.status` -> the Remote `WorkAuthorizationRequest.status`
 * the screen renders, for the statuses where the EMPLOYER is a party.
 *
 * ONLY THREE ROWS, AND THE ABSENCES ARE THE POINT. `escalated`, `blocked` and
 * `executed` are real statuses of that table and are deliberately unmapped:
 * none of them is awaiting a manager, and inventing a Remote status for them
 * would put a request on this screen that Remote's two-verb PATCH schema has no
 * verdict for. A row this map cannot answer for is EXCLUDED and named in the
 * probe (./workAuthScope.js), never silently dropped — a filter whose exclusions
 * are invisible is how this surface previously contradicted itself for a whole
 * build.
 *
 * The two decided spellings are Remote's own enum members, which is also what
 * the store writes into its status column when an employer decides
 * (src/uc04/authorizationStore.js's EMPLOYER_DECISION_STATUSES). One vocabulary,
 * written once, read back unchanged. `approved_by_remote` / `declined_by_remote`
 * appear nowhere in this file and must never appear: they are stage 3, Remote's
 * own verdict, and no endpoint sets them.
 */
export const STORE_STATUS_TO_REQUEST_STATUS = Object.freeze({
  pending_specialist_approval: DECIDABLE_STATUS,
  [EMPLOYER_VERBS.approve]: EMPLOYER_VERBS.approve,
  [EMPLOYER_VERBS.decline]: EMPLOYER_VERBS.decline,
  // The legacy spelling of a decline, canonicalised on read by the store
  // (src/shared/declineVocabulary.js) but matched here anyway: a row written by
  // an older build renders as what it always meant rather than as an exclusion.
  declined: EMPLOYER_VERBS.decline,
});

/**
 * Why a stored row is not on the employer's screen, in words a reader can act
 * on. Keyed by the store status, so a status added later falls through to the
 * generic sentence rather than vanishing.
 */
export function whyNotForEmployer(status) {
  switch (status) {
    case "escalated":
      return "this request was escalated rather than routed to a manager — a named specialist team owns it, not the employer";
    case "blocked":
      return "this request was refused by a hard gate (a sanctioned destination, or a Schengen/US-CA block), so there is nothing for a manager to weigh";
    case "executed":
      return "this request has already been executed against Remote";
    default:
      return `this request carries the status \`${status}\`, which names no employer decision`;
  }
}

/**
 * ISO 3166-1 alpha-2 or alpha-3? Answered by SHAPE, never assumed.
 *
 * `normalizeEmployment()` shipped the mirror-image defect of this — a 3-letter
 * code placed in a field only ever compared against 2-letter values — and it
 * took a shape check to close it (CLAUDE.md §7 item 3). Remote's `Country`
 * carries BOTH (`alpha_2_code` and `code`), so the honest thing is to put the
 * value in whichever of the two it actually is, and neither when it is neither.
 *
 * @param {unknown} code
 * @returns {{alpha_2_code: string}|{code: string}|null}
 */
export function partialCountry(code) {
  if (typeof code !== "string") return null;
  const trimmed = code.trim().toUpperCase();
  if (/^[A-Z]{2}$/.test(trimmed)) return { alpha_2_code: trimmed };
  if (/^[A-Z]{3}$/.test(trimmed)) return { code: trimmed };
  return null;
}

/** The country code a stored row's factors name, wherever the intake put it. */
export function destinationCodeOf(row) {
  const dest = row?.factors?.destination;
  if (typeof dest === "string") return dest;
  return dest?.country ?? null;
}

/**
 * The `_record` block every record built here carries.
 *
 * Self-describing when read ALONE — out of its envelope, in a log line, inside
 * an audit payload — which is the same promise `_standin` makes and for the same
 * reason: nothing of ours may reach a reader looking like something Remote said.
 */
function markRecord(request, row) {
  return {
    ...request,
    [RECORD_ROW_KEY]: {
      note:
        "OUR RECORD, NOT REMOTE'S — a work-authorization request filed on one of this system's own intake " +
        "surfaces and assessed by UC-04's risk matrix. Remote has never been told about it: it publishes no " +
        "endpoint that creates a work-authorization request (POST answers 404 on both the company and the " +
        "employee path), so there is nothing at Remote to read it back from or to PATCH. Every FIELD here is a " +
        "property of Remote's WorkAuthorizationRequest schema; the VALUES are this system's, and a decision on " +
        "this record is written to uc04_authorizations and audit_log and is never sent to Remote.",
      source: "src/uc04/authorizationStore.js (table uc04_authorizations)",
      authorizationId: row.id,
      // Named here because the request object deliberately does not carry it —
      // Remote's own records carry no employment reference on the wire either.
      employmentId: row.employmentId ?? null,
      filedVia: row.source ?? null,
      storeStatus: row.status ?? null,
      remoteRequestCreated: false,
    },
  };
}

/**
 * One `uc04_authorizations` row as a Remote-shaped `WorkAuthorizationRequest`,
 * or `null` when the row names no employer decision at all.
 *
 * @param {object} row  a row as the store hands it back
 * @returns {object|null}
 */
export function toWorkAuthorizationShape(row) {
  if (!row || typeof row !== "object" || !row.id) return null;
  // Own-property lookup (finding F-21's pattern). A status of `constructor`
  // would otherwise resolve through the prototype chain to a truthy value that
  // is not a status — the same shape of defect as a session key read off a
  // header, and cheap enough to close everywhere rather than only where the
  // input is currently attacker-controlled.
  if (typeof row.status !== "string" || !Object.hasOwn(STORE_STATUS_TO_REQUEST_STATUS, row.status)) return null;
  const status = STORE_STATUS_TO_REQUEST_STATUS[row.status];

  /** @type {Record<string, unknown>} */
  const request = { id: row.id, status };

  // `submitted_at` is a fact we own — this system is what received the
  // submission — so it is the one timestamp here that is not an omission.
  if (row.createdAt) request.submitted_at = row.createdAt;

  const factors = row.factors ?? {};
  if (factors.startDate) request.travel_date_start = factors.startDate;
  if (factors.endDate) request.travel_date_end = factors.endDate;

  const country = partialCountry(destinationCodeOf(row));
  if (country) request.destination_country = country;

  // The one boolean the two schemas genuinely share: signing on the company's
  // behalf abroad IS the permanent-establishment question UC-04's risk matrix
  // exists for, and Remote gives it a field. Only sent when the intake actually
  // recorded one — `undefined` is "not asked", which is not `false`.
  if (typeof factors.hasContractSigningAuthority === "boolean") {
    request.will_negotiate_or_sign_contracts = factors.hasContractSigningAuthority;
  }

  // THE EMPLOYER'S OWN WORDS AND THE EMPLOYER'S OWN IDENTITY, filled only once
  // a real employer has really decided. Both come off the row the decision was
  // written to; neither is guessed, and neither exists before a decision.
  const decided = decidedSlot(row);
  if (decided?.note) request.employer_special_instructions = decided.note;
  if (decided?.approver) request.employer_approver = { id: decided.approver, name: decided.approverName ?? null };

  return markRecord(request, row);
}

/**
 * The filled decision slot on a stored row, whichever verb filled it.
 *
 * Approve fills the single approval slot (`approver`/`approvalNote`/`approvedAt`);
 * decline fills `declinedBy`/`declinedAt`. Both spellings of the decline slot are
 * read (`deniedBy` is what a row written before the 2026-08-19 rename carries) —
 * the store canonicalises on read, so this is belt and braces for an in-memory
 * row or a deployment that has not been redeployed.
 */
export function decidedSlot(row) {
  if (row?.approvedAt) {
    return { action: "approve", approver: row.approver ?? null, approverName: row.approverName ?? null, note: row.approvalNote ?? null, at: row.approvedAt };
  }
  const slot = row?.declinedBy ?? row?.deniedBy ?? null;
  if (slot) {
    return {
      action: "decline",
      approver: slot.approver ?? null,
      approverName: slot.approverName ?? null,
      note: slot.note ?? null,
      at: slot.at ?? row?.declinedAt ?? row?.deniedAt ?? null,
    };
  }
  return null;
}

/**
 * UC-04's own verdict on the trip, for the manager who has to decide it.
 *
 * OUTSIDE `request`, because Remote's schema has no field for any of it — and
 * worth carrying, because the manager approving is being asked to weigh exactly
 * the thing the risk matrix already scored. Nothing here is re-derived: every
 * value is read off the stored row.
 */
export function assessmentOf(row) {
  return {
    decision: row?.decision ?? null,
    reason: row?.reason ?? null,
    flags: Array.isArray(row?.flags) ? row.flags : [],
    riskLevel: row?.risk?.level ?? row?.risk?.tier ?? null,
    tripDays: row?.tripDays ?? null,
    summary: row?.summary ?? null,
  };
}

/**
 * THE COUNTS THE DECISION TURNS ON — for the person who has to sign it.
 *
 * THE REPORT THIS ANSWERS, from a people-operations manager driving the live
 * deployment on 2026-09-02 and asked whether she would authorise her team's
 * travel on this screen. Her answer was no, and her reason was one sentence:
 *
 *   "The screen I decide from is materially thinner than the screen the
 *    employee already saw. The traveller is shown a Schengen day-count, a
 *    tax-residency watch line and an eighteen-rung explanation of what was
 *    checked. I am shown a name, a two-letter country code, two dates and the
 *    words `ready_for_approval`. I am the one carrying the border risk and the
 *    PE exposure, and I have the least information of anyone in the chain."
 *
 * She proved it. She filed the "exactly on the Schengen line" case; the portal
 * told the TRAVELLER "90 of 90 — 0 day(s) of headroom", and her approval row
 * said "Risk level: low". The strings "90", "headroom" and "permanent
 * establishment" appeared nowhere on her screen. The number that decides
 * whether her employee is lawfully in the Netherlands had been calculated,
 * printed and explained — to everyone except the person authorising the trip.
 *
 * NOTHING IS COMPUTED HERE. `describeDecisionBasis()` is the same function the
 * ZAF sidebar renders from, called on the same stored row, and its rows are
 * passed through whole — labels, notes, windows, `comparison`, all of it. That
 * is deliberate and it is the same rule `activityProfileOf()` follows one
 * function below: a second derivation is how the screen that DECIDES and the
 * screen that REVIEWS come to word one trip differently, and of the two, the
 * one that is wrong is always the one nobody re-reads.
 *
 * `comparison: "floor"` TRAVELS WITH THE ROW and the renderer must honour it.
 * Notice-before-departure is the one measurement here whose limit is a minimum;
 * rendered by a ceiling renderer it prints "91 of 14 days · 77 days left" on a
 * trip three months out — arithmetically right, backwards, and it reads as the
 * worst row on the page when it is the safest.
 *
 * EMPTY, NOT ABSENT, WHEN THERE IS NOTHING TO SAY. A request read from Remote
 * or from the stand-in has no stored decision to describe, and an empty list
 * renders as no section at all rather than as a section asserting no findings.
 */
export function measurementsOf(row) {
  if (!row) return [];
  try {
    const basis = describeDecisionBasis({ authorizationRow: row });
    return Array.isArray(basis?.measurements) ? basis.measurements : [];
  } catch {
    // A describer that throws must not take the approval screen down with it.
    // The manager loses a section and keeps the decision; the reverse would be
    // an outage of the only surface Remote's API accepts a verdict from.
    return [];
  }
}

/**
 * The facts UC-04 collects that Remote's schema cannot express, kept beside the
 * request rather than inside it. Five of UC-04's seven gate inputs have no
 * source in any Remote object (CLAUDE.md §7 item 19) — this is where they live.
 */
export function offSchemaFactorsOf(row) {
  const f = row?.factors ?? {};
  return {
    homeCountry: f.homeCountry ?? null,
    nationality: f.nationality ?? null,
    visaType: f.visaType ?? null,
    jobDuties: f.jobDuties ?? null,
  };
}

/**
 * WHAT THE EMPLOYEE SAID THEY WOULD BE DOING — the same four answers, from the
 * same module, that the mobility specialist's ZAF sidebar renders.
 *
 * WHY THIS SURFACE NEEDS IT AT ALL. `/remoteui` is where the CUSTOMER'S OWN
 * MANAGER approves or declines, and theirs is the only work-authorization
 * decision Remote's API accepts (`UC-04.md` §1a). Until now that manager
 * decided from a destination, two dates and a duty category, while the
 * specialist reviewing them AFTERWARDS could read what the traveller actually
 * wrote. The person with the decision had less than the person recording it.
 *
 * ONE MODULE, NOT TWO RENDERINGS. `describeActivityProfile()` is literally the
 * function the sidebar calls, on the same `factors.activityProfile` of the same
 * row. A second composition here would be a second place for "what the employee
 * said" to be spelled differently, on the two screens that must agree — and
 * they must agree, because one of them is reviewing the other.
 *
 * `null` FOR A ROW THAT IS NOT OURS. Only `uc04_authorizations` rows carry
 * `factors`; a request read from Remote or from the stand-in has no such field
 * and never asked the question. The caller renders nothing rather than an
 * empty block, because "this request was filed somewhere that does not ask" is
 * not the same claim as "the traveller answered nothing".
 */
export function activityProfileOf(row) {
  const profile = normalizeActivityProfile(row?.factors?.activityProfile);
  return {
    ...describeActivityProfile(profile),
    /* THE EMPLOYER'S FIELD STARTS FROM THE EMPLOYEE'S ANSWERS. Remote's own
       process asks the admin, at approval, to "use the additional information
       section to provide specific details about the activities the employee is
       expected to perform during the travel" (Help Center 20094378700557) — so
       the fact is captured twice, and the employer's version is the one that
       reaches the record. Composed SERVER-SIDE because the browser must never
       author a string the server owns; `assets/workauth.js` renders what it is
       given. Null when there is nothing to compose, never "", so an untouched
       box is distinguishable from one somebody cleared. */
    statementPrefill: activityStatementPrefill(profile),
    /* THE SENTENCE THAT GOES UNDER THE EMPLOYER'S BOX, WRITTEN HERE AND NOT IN
       THE BROWSER. `describeActivityProfile().finding` is the SPECIALIST's
       sentence — "read by nobody but you: no gate, score or model reads any of
       it" — and it is the wrong sentence for the person about to adopt these
       words as their company's. So the employer gets their own, server-side,
       for the reason every string on these pages is server-side: a provenance
       claim composed in the browser is a claim nobody can check, and it goes on
       asserting whose words these are after the prefill's source changes. */
    statementNotice: profile
      ? "These are the employee's own answers, copied here as a starting point. Whatever is in this box when you " +
        "approve is recorded as the company's statement about the trip, not as theirs."
      : null,
  };
}

/**
 * ONE LINE A DENSE LIST CAN RENDER WITHOUT RE-DERIVING ANYTHING.
 *
 * Built server-side for the same reason every other string on these pages is:
 * the page renders what it is given, and a label computed in the browser is a
 * second place for the same fact to be spelled differently.
 *
 * @param {object} entry  the annotated entry ({employeeName, request, ...})
 */
export function oneLineLabel({ employeeName, request }) {
  const who = employeeName || "Unnamed employee";
  const country = request?.destination_country?.name ?? request?.destination_country?.alpha_2_code ?? request?.destination_country?.code ?? null;
  const start = request?.travel_date_start ?? null;
  const end = request?.travel_date_end ?? null;
  const when = start && end ? `${start} → ${end}` : start || end || null;
  const parts = [who];
  if (country) parts.push(country);
  if (when) parts.push(when);
  // The employee's own stated reason when Remote's record carries one. Never
  // substituted when it does not: an unexplained trip reads as unexplained.
  if (request?.reason) parts.push(request.reason);
  return parts.join(" · ");
}

/**
 * Newest first, by the date the request was SUBMITTED.
 *
 * This is the "instantly" half of the owner's requirement: a request filed a
 * minute ago must be at the top, not wherever a fixture map happened to put it.
 * A record with no `submitted_at` sorts last rather than first — an unknown date
 * must never be allowed to claim the top of a queue.
 */
export function bySubmittedAtDesc(a, b) {
  const at = Date.parse(a?.request?.submitted_at ?? "");
  const bt = Date.parse(b?.request?.submitted_at ?? "");
  const av = Number.isNaN(at) ? -Infinity : at;
  const bv = Number.isNaN(bt) ? -Infinity : bt;
  return bv - av;
}
