// ---------------------------------------------------------------------------
// caseAttachments.js  —  A case's review-queue row and its documents, from
//                        wherever they actually are
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
// `CaseStore` reads a CASE memory-first-then-pool (`findById`, `findByExternalRef`)
// precisely because "the review API usually runs in a DIFFERENT PROCESS from the
// workflow" — CLAUDE.md §6 records that gotcha and the cost of getting it
// backwards: an API that passes every test and silently no-ops in production.
// It has no such reader for the two CHILD tables, so UC-03's server read them
// straight off the in-memory arrays:
//
//     caseStore.reviewQueue.find(...)   // empty in the API's process
//     caseStore.documents.filter(...)   // empty in the API's process
//
// In the seeded demo that is correct, because the workflow and the API are the
// same process. On the deployment — one Vercel function, a real pool, cases
// written by n8n or by the portal — the case renders and its review entry and
// its drafted letter are both silently absent. That was survivable while the
// panel only displayed them. It is not survivable now that a specialist's
// sign-off depends on them: `evaluateLetterActionability()` refuses without a
// review row and refuses without a letter, so a pooled deployment would refuse
// every real letter with `review_entry_missing` — a dead gate that looks
// exactly like a careful one, which is this repository's most expensive
// recurring defect.
//
// It lives in `src/uc03/` rather than on `CaseStore` because UC-03 is the
// caller that needs it; `src/review/store.js` already has the same two reads
// for UC-01, bound to that API's own store class.
//
// READS THROW, they do not degrade. A sign-off gate that treats an unreachable
// database as "no letter exists" would refuse a valid letter for a reason that
// is a lie about the case. Same rule as src/review/store.js's header.
// ---------------------------------------------------------------------------

import { isAcceptanceOf } from "./letterOffer.js";

/** `documents` columns, camelCased once here. `content` is opt-in — see below. */
const DOCUMENT_COLUMNS = `id, created_at as "createdAt", case_id as "caseId", type, content_hash as "contentHash"`;

const REVIEW_COLUMNS = `
  id,
  created_at as "createdAt",
  updated_at as "updatedAt",
  case_id    as "caseId",
  status,
  assignee,
  notes`;

/**
 * The newest `review_queue` row for a case, and its documents.
 *
 * MEMORY FIRST, THEN THE POOL — the same precedence `CaseStore.findById()`
 * uses, and for the same reason: with no pool the in-memory array is the only
 * copy there is, and with a pool the process that created the row may not be
 * this one. Memory is only preferred when it actually holds something, so a
 * fresh API process falls through to Postgres rather than reporting an empty
 * queue.
 *
 * @param {import("../shared/caseStore.js").CaseStore} caseStore
 * @param {string} caseId
 * @param {object} [opts]
 * @param {boolean} [opts.includeContent] include each document's body. Off by
 *   default (the panel shows that a letter exists and its hash, not its bytes);
 *   the sign-off path turns it on because it has to post the actual letter.
 * @returns {Promise<{reviewEntry: object|null, documents: object[]}>}
 */
export async function readCaseAttachments(caseStore, caseId, { includeContent = false } = {}) {
  const localReviews = caseStore.reviewQueue.filter((r) => r.caseId === caseId);
  const localDocuments = caseStore.documents.filter((d) => d.caseId === caseId);

  let reviewEntry = localReviews.length ? localReviews[localReviews.length - 1] : null;
  let documents = localDocuments;

  if (caseStore.pgPool) {
    if (!reviewEntry) {
      const result = await caseStore.pgPool.query(
        `select ${REVIEW_COLUMNS} from review_queue where case_id = $1 order by created_at desc limit 1`,
        [caseId]
      );
      reviewEntry = result.rows[0] ?? null;
    }
    if (!documents.length) {
      const result = await caseStore.pgPool.query(
        `select ${DOCUMENT_COLUMNS}${includeContent ? ", content" : ""}
           from documents where case_id = $1 order by created_at asc`,
        [caseId]
      );
      documents = result.rows;
    }
  }

  return {
    reviewEntry,
    // The in-memory rows carry `content` whether or not it was asked for, so it
    // is stripped here rather than at the two call sites — one rule, applied
    // wherever the rows came from.
    documents: includeContent ? documents : documents.map(({ content, ...rest }) => rest),
  };
}

/**
 * The one document of `type` on this case, newest last, or null.
 * @param {object[]} documents
 * @param {string} type
 */
export function documentOfType(documents, type) {
  const matches = (documents ?? []).filter((d) => d?.type === type);
  return matches.length ? matches[matches.length - 1] : null;
}

// ---------------------------------------------------------------------------
// The letter request a trip's answer became, if it became one
// ---------------------------------------------------------------------------
// WHY A LOOKUP AND NOT A COLUMN. `cases` has no parent column and this is not
// the place to add one — the link lives on the letter case's own classification
// (`offerAcceptedFrom`, set by `carryClassificationForward()`), which is written
// once, by the accept, and never rewritten afterwards.
//
// WHY NOT THE REFERENCE, WHICH IS WHAT THIS USED TO BE. The answered case and
// the letter case started life sharing one `externalRef`, so "the newest UC-03
// case on this reference" found the letter. It stopped being true the moment
// the letter request began raising a Zendesk ticket: `linkTicket()` repoints the
// letter case at the ticket id (src/portal/ticketing.js's `letterTicketPlan()`
// argues why the ticket follows the trip), the two rows share no reference, and
// the lookup silently finds nothing. A second accept then reads as a first one,
// and an answered case still advertises an offer that has already been taken.
// Neither errors. Both are wrong quietly, which is the shape this repository
// pays the most for.
//
// SCOPED TO THE TRAVELLER, not scanned. `listByOwner()` is indexed on
// `employment_id` and already exists for the portal's "My requests"; the
// alternative — reading every UC-03 case to find one child — is a table scan on
// a request path.
//
// THE REFERENCE LOOKUP REMAINS AS A FALLBACK, for rows written before the
// parent link existed: their classification carries no `offerAcceptedFrom`, and
// they still share a reference with the answer they continue, so the old
// question is still the right one to ask about them.
//
// A DISPLAY INPUT, NEVER THE CONTROL. What actually stops two letters is the
// `workflow_claims` primary key on `(use_case, <ref>#letter)`. This decides
// whether the refusal names the case, not whether there is one.
// ---------------------------------------------------------------------------

/**
 * The letter case that continues `caseRow`, or the newest case sharing its
 * reference when no parent link is recorded — or null.
 *
 * @param {import("../shared/caseStore.js").CaseStore} caseStore
 * @param {object|null} caseRow
 * @returns {Promise<object|null>}
 */
export async function findLetterCaseFor(caseStore, caseRow) {
  if (!caseRow) return null;

  if (caseRow.employmentId) {
    const owned = await caseStore.listByOwner({ employmentId: caseRow.employmentId, useCase: "UC-03" });
    const child = (owned ?? []).find((row) => isAcceptanceOf(row, caseRow.id));
    if (child) return child;
  }

  return caseRow.externalRef ? await caseStore.findByExternalRef(caseRow.externalRef, "UC-03") : null;
}
