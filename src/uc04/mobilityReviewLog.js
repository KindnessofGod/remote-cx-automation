// ---------------------------------------------------------------------------
// mobilityReviewLog.js  —  reading stage 3 back out of the append-only log
// ---------------------------------------------------------------------------
// WHY THE AUDIT LOG IS THE STORE FOR THIS, AND WHAT IT COSTS
//
// Remote's mobility review (stage 3, ./mobilityReview.js) is a durable decision
// with no column to live in. `uc04_authorizations` has fields for the
// EMPLOYER's decision — `approver`, `approval_note`, `approved_at`,
// `denied_by`, `executed_at`, `remote_result` — and no free-form metadata
// column at all. Adding one is a Supabase migration, which cannot be run from a
// coding container (raw TCP to `db.<ref>.supabase.co:5432` is blocked through
// an HTTP CONNECT proxy — CLAUDE.md §6) and is not this build's to make.
//
// So the record is an `audit_log` row, and it is read back from there.
// src/portal/server.js already took this route for UC-04 for the same reason
// and says so in its own comment ("WHY audit_log AND NOT A COLUMN").
//
// WHAT IS GENUINELY GOOD ABOUT IT. `audit_log` is APPEND-ONLY, which is exactly
// the right shape for "a named human decided this at this time": it cannot be
// edited, it carries the actor by construction, `details.authorizationId` is one
// of readStore.js's own CORRELATION_FIELDS so the row groups with the decision
// it reviews in the audit viewer with no change there, and `details.externalRef`
// makes it findable by the one id a human holds (the ticket).
//
// WHAT IT COSTS, STATED RATHER THAN GLOSSED:
//
//   1. NO UNIQUENESS CONSTRAINT. Two simultaneous clearances would both insert.
//      `submitMobilityReview()` therefore claims `(UC-04-mobility-review,
//      <authorizationId>)` in `workflow_claims` — whose PRIMARY KEY is a real
//      guarantee — before it writes, so the race is closed by the database and
//      not by the read below. With no pool (tests, a fresh clone) there is no
//      ledger and this read IS the check; that is a check-then-write, and it is
//      honest about being one.
//   2. NO INDEX ON `details->>'authorizationId'`. The query below is a jsonb
//      scan of one use case's rows. Acceptable at this volume and named here so
//      nobody discovers it as a surprise.
//   3. IT IS A SECOND PLACE UC-04's STATE LIVES. The mitigation is that it is
//      only ever READ through this module and only ever WRITTEN through
//      `submitMobilityReview()` — one reader, one writer.
//
// THE STORE CHANGE THIS WOULD PREFER, if the store's owner wants it: a
// `mobility_review jsonb` column on `uc04_authorizations` plus
// `recordMobilityReview(id, {outcome, reviewer, note, at})`, with a partial
// unique index. Nothing in this module's callers would change shape.
// ---------------------------------------------------------------------------

import { MOBILITY_REVIEW_VERDICT_ACTIONS, MOBILITY_REVIEW_AUDIT_ACTIONS } from "./mobilityReview.js";

/** The `workflow_claims.use_case` stage 3 claims under — NOT "UC-04". */
export const MOBILITY_REVIEW_CLAIM_USE_CASE = "UC-04-mobility-review";
// ^ Keyed apart from UC-04's own ticket claim on purpose. `workflow_claims` is
//   keyed `(use_case, external_ref)`, and UC-04 already claims
//   `("UC-04", <ticket id>)` for the DELIVERY of the request. Claiming stage 3
//   under the same use case would make one collide with the other the moment an
//   authorization id and a ticket id ever coincided, and would silently drop the
//   second — the exact failure the table's own header says keying by use case
//   exists to prevent.

/**
 * The stage-3 verdict on record for one authorization, or null.
 *
 * TWO BACKINGS, SAME QUESTION — the discipline every store in this repo uses.
 * In-process memory first (a bare `npm run` or a test, where the logger's own
 * `entries` array IS the log), then Postgres (a pooled deployment, where the
 * process serving this request is not the process that wrote the row).
 *
 * NEWEST WINS, and there should never be a second. `submitMobilityReview()`
 * refuses once one exists and the claim ledger closes the race; if a duplicate
 * ever does appear, reading the newest is the reading that matches what the
 * last reviewer was told.
 *
 * @param {object} args
 * @param {import("../shared/audit.js").AuditLogger|null} args.audit
 * @param {string|null} args.authorizationId
 * @returns {Promise<{outcome:"cleared"|"declined", reviewer:string|null, at:string|null,
 *                    note:string|null, auditId:string|null, sentToRemote:false}|null>}
 */
export async function readMobilityReview({ audit, authorizationId }) {
  if (!authorizationId) return null;
  const id = String(authorizationId);

  const local = (audit?.entries ?? []).filter(
    (entry) =>
      entry &&
      entry.useCase === "UC-04" &&
      MOBILITY_REVIEW_VERDICT_ACTIONS.has(entry.action) &&
      String(entry.details?.authorizationId ?? "") === id
  );
  if (local.length) return toReview(local[local.length - 1]);

  const pool = audit?.pgPool ?? null;
  if (!pool) return null;

  const result = await pool.query(
    `select id, at, action, actor, details
       from audit_log
      where use_case = 'UC-04'
        and action = any($1)
        and details->>'authorizationId' = $2
      order by at desc
      limit 1`,
    [[...MOBILITY_REVIEW_VERDICT_ACTIONS], id]
  );
  const row = result.rows[0];
  if (!row) return null;
  return toReview({
    id: row.id,
    at: row.at instanceof Date ? row.at.toISOString() : row.at,
    action: row.action,
    actor: row.actor,
    // `pg` hands a jsonb column back parsed for most driver/column combinations
    // and as a string for some — the same coercion authorizationStore.js's
    // normalizeRow() applies, for the same reason.
    details: typeof row.details === "string" ? safeParse(row.details) : (row.details ?? {}),
  });
}

/** One audit row -> the shape every surface reads. */
function toReview(entry) {
  return {
    outcome: entry.action === MOBILITY_REVIEW_AUDIT_ACTIONS.clear ? "cleared" : "declined",
    reviewer: entry.actor ?? null,
    at: entry.at ?? null,
    note: entry.details?.note ?? null,
    auditId: entry.id ?? null,
    // A CONSTANT, NOT A READ. There is no path on which stage 3 reaches Remote,
    // so this is not a field whose value could ever be `true` — publishing it as
    // a literal is what lets a test assert the guarantee rather than the prose.
    sentToRemote: false,
  };
}

function safeParse(value) {
  try {
    return JSON.parse(value) ?? {};
  } catch {
    return {};
  }
}
