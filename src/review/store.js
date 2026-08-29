// ---------------------------------------------------------------------------
// store.js  —  Reading a case back out, for the sidebar to render
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
// Same split as the metrics layer: reviewPolicy.js is pure and knows nothing
// about storage, and this is the only file in the review path that does. That
// is what lets the identical policy run against a live Supabase database and
// against an in-memory CaseStore in tests.
//
// It repeats source.js's aliasing trick for the same reason: Postgres columns
// are snake_case, CaseStore's in-memory rows are camelCase, and the business
// logic should learn neither dialect. The SQL aliases every column into the
// camelCase shape, once, here.
//
// Reads THROW on failure rather than returning an empty view. A sidebar that
// silently renders "no case found" when the database is unreachable would tell
// an agent the automation never looked at their ticket, which is a worse lie
// than an error message.
// ---------------------------------------------------------------------------

// D-13 (rca-kfg2) — `return_address` was written on every third-party-door
// case (src/shared/caseStore.js `createCase()`) and never read back here, so
// PostgresReviewStore.findCaseByExternalRef() always resolved `returnAddress`
// as `undefined`. Ticket #114 recorded a decision naming a real return
// address ("…will send to the return address on file") while the sidebar's
// CASE panel, one query away from the same row, showed "No return address on
// file" beneath it — two panels on one screen disagreeing about a fact both
// were reading from the same column, because only one of them was actually
// selecting it. InMemoryReviewStore never had this gap: it spreads the whole
// in-memory row (`normalizeCase()`), which is why the bug was invisible to
// every test that runs without SUPABASE_DB_URL set.
// D-12 (rca-kfg2) — the manual-send outcome record (migrations/0003) is
// selected here too, for the same reason `returnAddress` had to be added
// right above: this list is a SEPARATE, hand-maintained copy of
// src/shared/caseStore.js's own CASE_SELECT_COLUMNS, and a column added to
// one and not the other is exactly this file's own D-13 bug waiting to
// recur. If you add a column to either list, add it to both.
const CASE_COLUMNS = `
  id,
  created_at    as "createdAt",
  updated_at    as "updatedAt",
  use_case      as "useCase",
  source,
  external_ref  as "externalRef",
  employment_id as "employmentId",
  requester,
  classification,
  decision,
  reason,
  flags,
  status,
  return_address as "returnAddress",
  manual_send_status as "manualSendStatus",
  manual_send_at     as "manualSendAt",
  manual_send_by     as "manualSendBy",
  manual_send_note   as "manualSendNote"`;

const REVIEW_COLUMNS = `
  id,
  created_at as "createdAt",
  updated_at as "updatedAt",
  case_id    as "caseId",
  status,
  assignee,
  notes`;

/**
 * A store backed by Supabase Postgres — what the review API uses in production.
 * Implements the same three methods as InMemoryReviewStore below, so service.js
 * never learns which one it was handed.
 */
export class PostgresReviewStore {
  /** @param {import("pg").Pool} pgPool */
  constructor(pgPool) {
    this.pgPool = pgPool;
  }

  /**
   * The newest case for a Zendesk ticket. Newest, not "the" case, because a
   * ticket that was reopened and re-run produces a second case row — and the
   * sidebar must show the state the specialist is actually working, not the
   * first attempt from three days ago.
   * @param {string} externalRef  the Zendesk ticket id
   */
  async findCaseByExternalRef(externalRef, useCase = "UC-01") {
    // Scoped by use case. `cases` is shared — UC-03 writes rows here too — so
    // a ticket id alone is not a unique key, and this review API would happily
    // hand a UC-03 travel case to the UC-01 approve/decline path. The default is
    // UC-01 because that is what this store is: the review API mounted at
    // /uc01. See the fuller note in src/shared/caseStore.js.
    const result = await this.pgPool.query(
      `select ${CASE_COLUMNS} from cases
        where external_ref = $1
          and use_case = $2
        order by created_at desc
        limit 1`,
      [String(externalRef), String(useCase)]
    );
    return normalizeCase(result.rows[0] ?? null);
  }

  async findReviewEntryByCaseId(caseId) {
    const result = await this.pgPool.query(
      `select ${REVIEW_COLUMNS} from review_queue
        where case_id = $1
        order by created_at desc
        limit 1`,
      [caseId]
    );
    return result.rows[0] ?? null;
  }

  /**
   * Documents are returned WITHOUT their `content`. The sidebar shows that a
   * letter exists and what its hash is; it does not need to pull a document
   * body it never renders, and not shipping employment details into an iframe
   * that doesn't display them is the cheaper side of that trade.
   */
  async findDocumentsByCaseId(caseId) {
    const result = await this.pgPool.query(
      `select id, created_at as "createdAt", case_id as "caseId", type,
              content_hash as "contentHash"
         from documents
        where case_id = $1
        order by created_at asc`,
      [caseId]
    );
    return result.rows;
  }

  /**
   * Every case that has a review_queue row (i.e. every human_review/escalate
   * case UC-01 has ever produced), newest first — the source for a dashboard's
   * UC-01 queue. An inner join, deliberately: a case with no review_queue row
   * was never a human's job (auto_resolve), so it has nothing to show here.
   */
  async list() {
    const result = await this.pgPool.query(
      `select c.id, c.external_ref as "externalRef", c.use_case as "useCase",
              c.employment_id as "employmentId", c.requester, c.decision, c.reason,
              c.flags, c.status, c.created_at as "createdAt",
              r.status as "reviewStatus"
         from cases c
         join review_queue r on r.case_id = c.id
        order by c.created_at desc`
    );
    return result.rows.map((row) => ({ ...row, flags: coerceJson(row.flags, []) }));
  }
}

/**
 * The same three reads against an in-memory CaseStore — used by the tests, the
 * demo, and any run where SUPABASE_DB_URL isn't set. Async to match the
 * Postgres store exactly, so service.js has one code path rather than two.
 */
export class InMemoryReviewStore {
  /** @param {import("../shared/caseStore.js").CaseStore} caseStore */
  constructor(caseStore) {
    this.caseStore = caseStore;
  }

  async findCaseByExternalRef(externalRef) {
    const matches = this.caseStore.cases.filter((c) => String(c.externalRef) === String(externalRef));
    return normalizeCase(matches.length ? matches[matches.length - 1] : null);
  }

  async findReviewEntryByCaseId(caseId) {
    const matches = this.caseStore.reviewQueue.filter((r) => r.caseId === caseId);
    return matches.length ? matches[matches.length - 1] : null;
  }

  async findDocumentsByCaseId(caseId) {
    return this.caseStore.documents
      .filter((d) => d.caseId === caseId)
      .map(({ content, ...rest }) => rest); // same omission as the SQL above
  }

  /**
   * Every case that has a review_queue row, newest first — same join as
   * PostgresReviewStore.list(), done in memory instead of SQL.
   */
  async list() {
    const rows = this.caseStore.reviewQueue
      .map((review) => {
        const caseRow = this.caseStore.cases.find((c) => c.id === review.caseId);
        if (!caseRow) return null;
        return {
          id: caseRow.id,
          externalRef: caseRow.externalRef,
          useCase: caseRow.useCase,
          employmentId: caseRow.employmentId,
          requester: caseRow.requester,
          decision: caseRow.decision,
          reason: caseRow.reason,
          flags: caseRow.flags,
          status: caseRow.status,
          createdAt: caseRow.createdAt,
          reviewStatus: review.status,
        };
      })
      .filter(Boolean);
    return rows.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }
}

/**
 * Coerce the two shapes `flags` and `classification` arrive in. The in-memory
 * store holds real objects; the `pg` driver usually parses jsonb but hands back
 * a string for some column/driver combinations. reviewPolicy.js reads
 * `flags` as an array (classifyRisk checks `.length`) — and a JSON *string*
 * has a length too, so `"[]"` would look like two flags and silently push a
 * clean low-tier case to medium. Coerce once, here, exactly as
 * metrics/source.js does for the same reason.
 */
function normalizeCase(row) {
  if (!row) return null;
  return { ...row, flags: coerceJson(row.flags, []), classification: coerceJson(row.classification, {}) };
}

function coerceJson(value, fallback) {
  if (value === null || value === undefined) return fallback;
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}
