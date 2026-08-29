// ---------------------------------------------------------------------------
// letterAccess.js  —  the travel letter, on the requester's own history page
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
//
// The project owner, looking at "My requests" with a UC-03 letter request in it:
//
//   "This should not end here. A travel letter was requested. It should be
//    recorded, and the user should be able to download the letter. The question
//    now is: from where?"
//
// The letter is real. It is rendered, hashed and stored as a
// `travel_support_letter` row in `documents`, and its sha256 is on the
// decision's audit row. "My requests" listed the request as a status and a
// sentence, with no sign that a document existed, no way to see it and no way
// to get it — **a decision that is correct, durable, audited and reaches
// nobody**, which is the failure shape `CLAUDE.md` §7's honest-gaps list now
// names five times over. An issued document nobody can fetch is the worst
// version of it, because the audit row records a delivery.
//
// ---------------------------------------------------------------------------
// THREE STATES, AND THEY ARE NOT THE SAME
// ---------------------------------------------------------------------------
//   ISSUED   — the document exists and has gone out. This is where a download
//              belongs, and the only state that gets one.
//   DRAFTED  — written and held for a Travel & Mobility Support specialist.
//              There is nothing to download yet, and a button here would be
//              worse than no button: it would promise a document the sign-off
//              gate exists to withhold.
//   NONE     — no letter was written. Four different situations, distinguished
//              by src/uc03/letterDelivery.js's describeNoLetter(), and no
//              control that implies otherwise.
//
// ---------------------------------------------------------------------------
// THIS MODULE DECIDES NOTHING ABOUT WHO MAY HAVE IT
// ---------------------------------------------------------------------------
// `evaluateLetterDelivery()` in src/uc03/letterDelivery.js is the gate: the
// session must be the employment the case is about, it fails closed on a
// missing session, and it refuses a caller before telling them whether a letter
// exists. This module CALLS it and translates the verdict into something a
// history row can render. It does not restate the rule, does not shortcut it,
// and cannot answer "collectable" where the gate would answer anything else —
// the same verdict decides both, which is what stops this page offering a
// button the fetch route would refuse.
//
// IT IS HANDED THE READER'S REAL SESSION, never the case's own employment id.
// Comparing a row against itself is the "verify a claim against itself" shape
// this repository has had to fix four times (CLAUDE.md §4). The session comes
// from ./personas.js's server-owned map, exactly as every other UC-03 route on
// this portal gets one, and `ownerScopeFor()` has already scoped the listing to
// that same person — so the two agree by construction rather than by luck, and
// where they ever did not, this would say "not yours" rather than invent a
// download.
//
// PURE. Rows in, a description out. No store, no clock, no network.
// ---------------------------------------------------------------------------

import { evaluateLetterDelivery } from "../uc03/letterDelivery.js";
import { evaluateLetterDelivery as evaluateUc01LetterDelivery } from "../uc01/letterDelivery.js";

/** What a history row can say about a letter. Presentation only. */
export const LETTER_STATES = Object.freeze({
  ISSUED: "issued",
  DRAFTED: "drafted",
  NONE: "none",
});

/**
 * The letter on one UC-03 case, as the person who filed it should see it.
 *
 * @param {object} args
 * @param {object|null} args.caseRow  the `cases` row, camelCase
 * @param {object|null} [args.letterDocument]  the stored `travel_support_letter`
 *   for that case, or null. Passed IN so this stays pure — the caller reads it.
 * @param {object|null} args.session  the reader's server-owned session
 * @returns {{state:string, label:string, detail:string, collect:{method:string,path:string}|null}}
 */
export function describeLetterForRequester({ caseRow, letterDocument = null, session }) {
  const verdict = evaluateLetterDelivery({ caseRow, session, letterDocument });

  if (verdict.allowed) {
    return {
      state: LETTER_STATES.ISSUED,
      label: "Ready",
      // NOT the gate's own sentence, which is written for a route's response
      // body ("…can be collected by the employee it is about"). On this row the
      // reader IS that employee and has already been told so by the page they
      // are on; what they need is what the document is and that it is theirs.
      detail: "The formal travel letter for this trip has been written and issued. It is yours to open or save.",
      // RELATIVE, WITH NO LEADING SLASH, and that is the whole of a production
      // outage this row caused. The page fetches this path verbatim
      // (`api()` in assets/app.js), and every other call it makes is relative
      // — `api("api/context")`, `api("api/requests/uc03/continue")` — because
      // the portal is mounted under a prefix on the deployment (`/portal`) and
      // at the root by `npm run portal`. A LEADING SLASH resolves against the
      // domain root instead, so "Open the letter" fetched /api/requests/uc03/
      // letter, missed the mount entirely, and the router answered
      // `no_such_use_case` — to a requester who had just been told their letter
      // was ready.
      //
      // Every test passed throughout, and would have passed with the slash:
      // they drive the handler in-process with basePath "", where the two forms
      // are the same string. Only a request through the deployed prefix can
      // tell them apart, which is why the assertion added with this fix is that
      // the path is relative, not that it resolves.
      collect: { method: "POST", path: "api/requests/uc03/letter" },
    };
  }

  if (verdict.code === "letter_not_issued") {
    return {
      state: LETTER_STATES.DRAFTED,
      label: "With a specialist",
      // The gate's own words, because they name WHO has it, and a team name
      // typed here is exactly how `Local HR Legal` came to appear five times in
      // src/uc05/ for a team that existed nowhere.
      detail: verdict.reason,
      collect: null,
    };
  }

  if (verdict.code === "no_letter_on_this_case") {
    return {
      state: LETTER_STATES.NONE,
      label: "None",
      // describeNoLetter()'s sentence, which distinguishes four situations —
      // never asked for, asked for and held for want of a letterhead, asked for
      // and beyond the standard template, or unrecognised. "No letter" is not
      // one fact.
      detail: verdict.reason,
      collect: null,
    };
  }

  // EVERYTHING ELSE IS A REFUSAL ABOUT THE READER, not about the document —
  // `case_not_found`, `session_required`, `not_the_traveller`. It should be
  // unreachable from a listing the ownership scope has already narrowed to this
  // person, and if it is ever reached it must not read as "you have no letter":
  // that would report an access problem as an absence, which is the direction
  // that gets believed. Rendered as the gate's own sentence with no control.
  return { state: LETTER_STATES.NONE, label: "Not available", detail: verdict.reason, collect: null };
}

/**
 * The letter on one UC-01 self-service case, as the employee it is about
 * should see it — the same shape as describeLetterForRequester() above, for
 * the same reason (round-6 D-01/D-03: UC-01 is now a portal request type and
 * had no analogue of this at all).
 *
 * ONLY TWO STATES REACH HERE, because src/uc01/selfServiceLetter.js never
 * writes a `cases` row unless the letter was ALSO written in the same call —
 * there is no DRAFTED state to translate.
 *
 * @param {object} args
 * @param {object|null} args.caseRow  the `cases` row, camelCase, UC-01-scoped by the caller
 * @param {object|null} [args.letterDocument]  the stored `employment_verification_letter`, or null
 * @param {object|null} args.session  the reader's server-owned session
 * @returns {{state:string, label:string, detail:string, collect:{method:string,path:string}|null}}
 */
export function describeUc01LetterForRequester({ caseRow, letterDocument = null, session }) {
  const verdict = evaluateUc01LetterDelivery({ caseRow, session, letterDocument });

  if (verdict.allowed) {
    return {
      state: LETTER_STATES.ISSUED,
      label: "Ready",
      detail: "Your employment verification letter has been issued. It is yours to open or save.",
      // RELATIVE, WITH NO LEADING SLASH — see the identical comment on the
      // UC-03 branch above; the production outage it describes applies here
      // exactly as it does there.
      collect: { method: "POST", path: "api/requests/uc01/letter" },
      // rca-cput: a PDF sibling of the route above, same gate, same case —
      // src/pdf/ already renders this exact letter and nothing offered it.
      // Present unconditionally: whether it actually WORKS depends on the
      // server having a `renderPdf` dependency configured, which the fetch
      // route itself reports (`pdf_rendering_unavailable`) rather than this
      // module guessing at server configuration it cannot see.
      collectPdf: { method: "POST", path: "api/requests/uc01/letter/pdf" },
    };
  }

  // A case this store holds is never missing its letter (see the header), so
  // `no_letter_on_this_case` should be unreachable here — but it is handled
  // rather than assumed impossible, the same discipline the UC-03 branch
  // above applies to its own "should never happen" refusals.
  return { state: LETTER_STATES.NONE, label: "Not available", detail: verdict.reason, collect: null };
}
