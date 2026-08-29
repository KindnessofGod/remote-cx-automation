// ---------------------------------------------------------------------------
// queueStore.js  —  Read-only access to everything that might be awaiting a human
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
// Nine use cases keep their state in eight different places: five record tables
// with their own status columns (uc02_expenses, uc04_authorizations,
// uc05_resignations, uc06_amendments, uc09_adjustments), two dossier tables
// with no status column at all (uc07_dossiers, uc08_dossiers), and `cases` +
// `review_queue` for UC-01 and UC-03. Nothing has ever read all eight together,
// which is why "what is waiting on a person right now?" had no answer.
//
// READ-ONLY IS STRUCTURAL, exactly as in src/auditview/readStore.js and
// src/uc08/dossierStore.js: there is no insert, update or delete anywhere in
// this file, so there is no write for a bug to live in. This surface reports on
// approvals and must never become a second place to make one.
//
// READS THROW. §9's rule for anything feeding a dashboard. A pg error swallowed
// into an empty array would render "nothing is waiting for anyone" over an
// outage, which is the most dangerous sentence this page could print. Nothing
// here catches a pg error. (The Zendesk enrichment is the deliberate opposite —
// see ticketFacts.js for why an unknown there is labelled rather than thrown.)
//
// EVERY QUERY IS PARAMETERISED and every column name below was read off the
// live schema (Supabase project your-project-ref, 2026-08-19) rather than
// remembered. This repo has been burned by fixtures agreeing with code while
// both disagreed with the store.
//
// THE THREE MODES are the audit viewer's, for the same reasons:
//   supabase     a pool is attached — real reads.
//   seeded       no pool, labelled demo rows, so a fresh clone shows the UI.
//   unavailable  no pool and not seeded (the deployed state before
//                SUPABASE_DB_URL is set) — reads THROW rather than serve demo
//                rows on a public URL where they would read as real history.
// ---------------------------------------------------------------------------

import { buildQueueDemoDataset } from "./demoSeed.js";

/** Per-table row cap. Generous enough to hold this account's whole history. */
const ROW_CAP = 500;

export class NoDurableStoreError extends Error {
  constructor() {
    super(
      "no durable store is attached: SUPABASE_DB_URL is unset and this process was not started in seeded demo mode. " +
        "There is nothing to read here — attach Supabase, or run `npm run queue-ui -- --seeded` locally for labelled demo rows."
    );
    this.code = "no_durable_store";
  }
}

/** The record tables that carry a decision and a status column. */
const RECORD_TABLES = Object.freeze([
  // `requester` is NOT universal, and assuming it was cost a 42703 against the
  // live schema before this view had ever rendered: uc02_expenses has no such
  // column (its submitter is the employment the expense belongs to). Each row
  // therefore names its own columns rather than sharing a select list that is
  // true of four tables out of five.
  { useCase: "UC-02", table: "uc02_expenses", extra: "" },
  { useCase: "UC-04", table: "uc04_authorizations", extra: ", requester" },
  { useCase: "UC-05", table: "uc05_resignations", extra: ", requester" },
  { useCase: "UC-06", table: "uc06_amendments", extra: ", requester, admin_approval, payroll_approval" },
  {
    useCase: "UC-09",
    table: "uc09_adjustments",
    extra: ", requester, approval_slots_required, requester_approval, approver_approval, payment_releaser_approval",
  },
]);

const DOSSIER_TABLES = Object.freeze([
  { useCase: "UC-07", table: "uc07_dossiers" },
  { useCase: "UC-08", table: "uc08_dossiers" },
]);

export class ApprovalQueueStore {
  /**
   * @param {object} [opts]
   * @param {import("pg").Pool|null} [opts.pgPool]
   * @param {boolean} [opts.seeded]
   * @param {object} [opts.seedData]  test seam
   * @param {() => number} [opts.now]
   */
  constructor({ pgPool = null, seeded = false, seedData = null, now = Date.now } = {}) {
    this.pgPool = pgPool;
    this.seeded = !pgPool && (seeded || Boolean(seedData));
    this.demo = this.seeded ? (seedData ?? buildQueueDemoDataset(now())) : null;
  }

  /** "supabase" | "seeded" | "unavailable" — every response reports it. */
  mode() {
    if (this.pgPool) return "supabase";
    if (this.seeded) return "seeded";
    return "unavailable";
  }

  #require() {
    if (!this.pgPool && !this.seeded) throw new NoDurableStoreError();
  }

  /**
   * Every record from all eight places, normalised into one row shape. The
   * awaiting/settled judgement is NOT made here — awaiting.js makes it, once,
   * over this output.
   *
   * @returns {Promise<object[]>}
   */
  async listRecords() {
    this.#require();
    if (this.seeded) return this.demo.records.map((r) => ({ ...r }));

    const rows = [];

    for (const { useCase, table, extra } of RECORD_TABLES) {
      // Table names are from the frozen constant above, never from input; every
      // value that could come from a caller is bound.
      const result = await this.pgPool.query(
        `select id, created_at, employment_id, decision, reason, status,
                external_ref, source${extra}
           from ${table}
          order by created_at desc
          limit $1`,
        [ROW_CAP]
      );
      for (const row of result.rows) rows.push(normaliseRecord(useCase, row));
    }

    for (const { useCase, table } of DOSSIER_TABLES) {
      const result = await this.pgPool.query(
        `select id, created_at, employment_id, external_ref, source
           from ${table}
          order by created_at desc
          limit $1`,
        [ROW_CAP]
      );
      for (const row of result.rows) rows.push(normaliseDossier(useCase, row));
    }

    // UC-01 and UC-03 live in `cases`; whether a person is still needed lives in
    // `review_queue`. LEFT JOIN rather than INNER, so a case with no queue entry
    // is visible as exactly that rather than absent.
    const cases = await this.pgPool.query(
      `select c.id, c.created_at, c.use_case, c.source, c.external_ref, c.employment_id,
              c.requester, c.decision, c.reason, c.status,
              rq.status as queue_status, rq.assignee as queue_assignee
         from cases c
         left join review_queue rq on rq.case_id = c.id
        order by c.created_at desc
        limit $1`,
      [ROW_CAP]
    );
    for (const row of cases.rows) rows.push(normaliseCase(row));

    return rows;
  }

  /**
   * Ticket ids that an audit row states outright, keyed by the record id and by
   * the reference the request was submitted under.
   *
   * This is the STRONGEST evidence a ticket exists for a record — stronger than
   * the shape of a reference, which has been wrong in production. Only the
   * portal writes these rows today, so most records have none, and their
   * absence proves nothing either way.
   */
  async ticketLinks() {
    this.#require();
    if (this.seeded) return { byRecordId: new Map(Object.entries(this.demo.ticketLinks ?? {})), bySubmittedRef: new Map() };

    const result = await this.pgPool.query(
      `select details->>'recordId'     as record_id,
              details->>'ticketId'     as ticket_id,
              details->>'recordedRef'  as recorded_ref,
              details->>'externalRef'  as submitted_ref
         from audit_log
        where action = any($1::text[])
        order by at desc
        limit $2`,
      [["portal_reference_relinked", "portal_reference_superseded"], ROW_CAP]
    );

    const byRecordId = new Map();
    const bySubmittedRef = new Map();
    for (const row of result.rows) {
      const ticket = row.ticket_id ?? row.recorded_ref ?? null;
      if (!ticket) continue;
      if (row.record_id && !byRecordId.has(row.record_id)) byRecordId.set(row.record_id, ticket);
      if (row.submitted_ref && !bySubmittedRef.has(row.submitted_ref)) bySubmittedRef.set(row.submitted_ref, ticket);
    }
    return { byRecordId, bySubmittedRef };
  }
}

function normaliseRecord(useCase, row) {
  return {
    useCase,
    recordId: String(row.id),
    createdAt: iso(row.created_at),
    employmentId: row.employment_id ?? null,
    requester: row.requester ?? null,
    decision: row.decision ?? null,
    reason: row.reason ?? null,
    status: row.status ?? null,
    reference: row.external_ref ?? null,
    source: row.source ?? null,
    queueStatus: undefined,
    raw: row,
  };
}

function normaliseDossier(useCase, row) {
  return {
    useCase,
    recordId: String(row.id),
    createdAt: iso(row.created_at),
    employmentId: row.employment_id ?? null,
    requester: null,
    // A dossier records no decision and no status, and this view says so rather
    // than inventing "escalate" for it. The escalation is what produced it.
    decision: null,
    reason: null,
    status: null,
    reference: row.external_ref ?? null,
    source: row.source ?? null,
    queueStatus: undefined,
    raw: row,
  };
}

function normaliseCase(row) {
  return {
    useCase: row.use_case,
    recordId: String(row.id),
    createdAt: iso(row.created_at),
    employmentId: row.employment_id ?? null,
    requester: row.requester ?? null,
    decision: row.decision ?? null,
    reason: row.reason ?? null,
    status: row.status ?? null,
    reference: row.external_ref ?? null,
    source: row.source ?? null,
    // `undefined` means "this use case does not use review_queue"; `null` means
    // "it does and there is no entry". The two are different facts.
    queueStatus: row.queue_status ?? null,
    queueAssignee: row.queue_assignee ?? null,
    raw: row,
  };
}

function iso(value) {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}
