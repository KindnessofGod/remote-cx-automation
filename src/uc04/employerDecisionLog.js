// ---------------------------------------------------------------------------
// employerDecisionLog.js — recovering WHO the employer's approver was
// ---------------------------------------------------------------------------
// THE GAP THIS CLOSES, and it was found by a reader rather than by a test.
//
// A mobility specialist opened an approved work authorization in the ZAF
// sidebar and asked where the approver's name was. The panel said "Approved by
// admin_jane". That is the SESSION ID — an audit-grade identity, and not an
// answer to "who approved this trip".
//
// The display name was never lost by accident; it was never durable. Remote's
// schema names this party `employer_approver` and gives it `{id, name, email}`,
// but `uc04_authorizations` has no column for the name (authorizationStore.js's
// `recordEmployerDecision()` says so and explains why: a migration is not
// runnable from a coding session, and a column the store would silently drop is
// worse than no column). So the name lived on the IN-MEMORY row and in the
// prose of a Zendesk note — and the sidebar reads Postgres from a different
// process, where the in-memory row does not exist.
//
// SO THE AUDIT LOG IS THE STORE FOR IT, exactly as it is for stage 3
// (./mobilityReviewLog.js, whose shape this file deliberately mirrors). The row
// is append-only and its `details` is jsonb, so recording a name there needed
// no migration — and it is the right home anyway: an identity belongs on the
// append-only record of who did what, not on a mutable current-state row.
//
// WHAT THIS IS NOT. It never decides anything and never contradicts the store.
// The store's `approver` remains the identity of record; this only supplies the
// human-readable name to print BESIDE it. A missing name yields null and the
// caller prints the id alone — an id is a worse answer than a name, and a
// fabricated name would be far worse than either.
// ---------------------------------------------------------------------------

/** The two audit actions the employer's own decision is written under. */
export const EMPLOYER_DECISION_ACTIONS = Object.freeze(
  new Set(["work_authorization_employer_approved", "work_authorization_employer_declined"])
);

/**
 * The display name recorded for the employer's decision on one authorization.
 *
 * TWO BACKINGS, SAME QUESTION — the discipline every store in this repo uses:
 * in-process memory first (a bare `npm run` or a test, where the logger's own
 * `entries` array IS the log), then Postgres (a pooled deployment, where the
 * process serving this request is not the process that wrote the row).
 *
 * NEWEST WINS. `recordEmployerDecision()` is conditional on the row still
 * awaiting a manager, so there should never be a second decision — but if one
 * exists, the newest is the one whose name the store's `approver` also holds.
 *
 * @param {object} args
 * @param {import("../shared/audit.js").AuditLogger|null} args.audit
 * @param {string|null} args.authorizationId
 * @returns {Promise<{name:string|null, title:string|null, company:string|null}|null>}
 *   null when no employer decision is on record. Each field is independently
 *   null when it was not recorded — a decision written before 2026-08-31 has a
 *   name and no title, and half an answer is worth more than none. Never a
 *   guess, and never the session id dressed up as a name.
 */
export async function readEmployerApprover({ audit, authorizationId }) {
  if (!authorizationId) return null;
  const id = String(authorizationId);

  const local = (audit?.entries ?? []).filter(
    (entry) =>
      entry &&
      entry.useCase === "UC-04" &&
      EMPLOYER_DECISION_ACTIONS.has(entry.action) &&
      String(entry.details?.workAuthorizationId ?? "") === id
  );
  if (local.length) return approverOf(local[local.length - 1].details);

  const pool = audit?.pgPool ?? null;
  if (!pool) return null;

  try {
    const result = await pool.query(
      `select details
         from audit_log
        where use_case = 'UC-04'
          and action = any($1)
          and details->>'workAuthorizationId' = $2
        order by at desc
        limit 1`,
      [[...EMPLOYER_DECISION_ACTIONS], id]
    );
    const row = result.rows[0];
    if (!row) return null;
    // `pg` hands a jsonb column back parsed for most driver/column combinations
    // and as a string for some — the same coercion authorizationStore.js's
    // normalizeRow() applies, for the same reason.
    return approverOf(typeof row.details === "string" ? safeParse(row.details) : (row.details ?? {}));
  } catch {
    // A NAME IS A GARNISH, NOT A FACT THE DECISION DEPENDS ON. If the audit
    // table is unreachable the caller must still render the settled decision
    // under the id it already holds — failing the whole panel to avoid printing
    // a session id would be a strictly worse answer.
    return null;
  }
}

function approverOf(details) {
  const text = (v) => (typeof v === "string" && v.trim() ? v.trim() : null);
  const approver = {
    name: text(details?.approverName),
    title: text(details?.approverTitle),
    company: text(details?.approverCompany),
  };
  // An audit row with none of the three tells the caller nothing it did not
  // already have, and returning an object of nulls would make "no name
  // recorded" indistinguishable from "no decision found".
  return approver.name || approver.title || approver.company ? approver : null;
}

function safeParse(value) {
  try {
    return JSON.parse(value) ?? {};
  } catch {
    return {};
  }
}
