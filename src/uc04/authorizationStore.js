// ---------------------------------------------------------------------------
// authorizationStore.js  —  UC-04 operational state (single-approval tracking)
// ---------------------------------------------------------------------------
// WHY A SEPARATE STORE, NOT A REUSE OF review_queue
// Same reasoning as src/uc06/amendmentStore.js: review_queue is shaped for
// ONE decision per case (a single approve/decline, one approver header).
// UC-04 is closer to UC-01's shape than UC-06's — a single specialist
// approves, the work authorization is then issued, the case closes — so a
// one-slot approve shape would technically fit review_queue. But the work-
// authorization is a richer record than review_queue's three columns (it
// carries the workation's own lifecycle: created, awaiting_specialist,
// approved, declined, executed, with the remote_result of the
// work-authorization PATCH that the workflow fires on approve). Putting
// that in review_queue would overloading the table with workation-specific
// fields. This is its own small store, following the identical discipline
// as src/uc06/amendmentStore.js file-for-file — including the same fire-and-
// forget createAuthorization() (records a decision already made and
// audited; nothing downstream depends on the row landing before this call
// returns) and the same await+throw mutation methods (each one IS the
// record that a human authorised something, so a silent failure there
// would be worse than an error surfaced to the caller — exactly the
// asymmetry AuditLogger.logDurable() and CaseStore.updateReviewQueueStatus()
// already establish, for the same reason).
//
// The Supabase table is `uc04_authorizations`, schema documented for
// human provisioning alongside the other UC-* tables in SETUP-CHECKLIST.
// The CLI / server pass the same `pgPool` flag that amendmentStore and
// CaseStore accept — a configured URL gives real Postgres, an unset one
// keeps everything in memory and the suite hermetic.
// ---------------------------------------------------------------------------

import { randomUUID } from "node:crypto";
import { matchesOwner } from "../shared/ownerScope.js";
import { canonicalDecisionStatus } from "../shared/declineVocabulary.js";

const SELECT_COLUMNS = `
  id,
  created_at                as "createdAt",
  updated_at                as "updatedAt",
  employment_id             as "employmentId",
  requester,
  factors,
  risk,
  trip_days                 as "tripDays",
  cumulative_days           as "cumulativeDays",
  decision,
  reason,
  flags,
  summary,
  faithfulness,
  external_ref              as "externalRef",
  source,
  work_authorization_id     as "workAuthorizationId",
  status,
  approver,
  approval_note             as "approvalNote",
  approved_at               as "approvedAt",
  -- THE COLUMN NAMES STAY denied_*, THE FIELD NAMES DO NOT (2026-08-19).
  -- The verb moved to \`decline\` (docs/BUILD-LOG.md §3.61, src/shared/
  -- declineVocabulary.js). Renaming a physical column is a MANDATORY,
  -- non-idempotent migration: code expecting the new name is broken until
  -- somebody runs it, which is the opposite of the read-side compatibility
  -- this rename is built on. Aliasing moves the vocabulary where it is read
  -- and costs nothing; docs/SETUP-CHECKLIST.md records the optional rename.
  denied_by                 as "declinedBy",
  denied_at                 as "declinedAt",
  executed_at               as "executedAt",
  remote_result             as "remoteResult"`;

export class AuthorizationStore {
  /**
   * @param {object} [opts]
   * @param {import("pg").Pool|null} [opts.pgPool]  when set, also writes to
   *   Supabase's `uc04_authorizations` table
   */
  constructor({ pgPool = null } = {}) {
    this.pgPool = pgPool;
    this.authorizations = [];
    this.pending = [];
  }

  #track(promise, label) {
    const guarded = promise.catch((err) => {
      console.error(`[uc04] failed to write ${label} to Supabase: ${err.message}`);
    });
    this.pending.push(guarded);
  }

  /**
   * One row per workation request — the decision, the risk-matrix result,
   * the drafted summary, and (once created) the single approval slot that
   * starts empty.
   * @param {object} args
   * @returns {object} the created authorization row
   */
  createAuthorization({
    employmentId,
    requester,
    factors,
    risk,
    tripDays,
    cumulativeDays,
    decision,
    reason,
    flags,
    summary = null,
    faithfulness = null,
    externalRef = null,
    source = null,
    workAuthorizationId = null,
  }) {
    const now = new Date().toISOString();
    const row = {
      id: randomUUID(),
      createdAt: now,
      updatedAt: now,
      employmentId,
      requester,
      factors,
      risk,
      tripDays,
      cumulativeDays,
      decision,
      reason,
      flags,
      summary,
      faithfulness,
      externalRef,
      source,
      workAuthorizationId,
      // "pending_specialist_approval" is the only status this store's approval
      // flow acts on. Anything escalated stays informational (mirrors UC-01's
      // "escalations are visible, never actionable" rule). A "blocked"
      // decision is recorded with status "blocked" — it will never reach
      // approval but the row is kept for audit.
      status:
        decision === "ready_for_approval"
          ? "pending_specialist_approval"
          : decision === "blocked"
            ? "blocked"
            : "escalated",
      approver: null,
      approvalNote: null,
      approvedAt: null,
      declinedBy: null,
      declinedAt: null,
      executedAt: null,
      remoteResult: null,
    };
    this.authorizations.push(row);

    if (this.pgPool) {
      const insertPromise = this.pgPool.query(
        `insert into uc04_authorizations
           (id, created_at, updated_at, employment_id, requester, factors, risk,
            trip_days, cumulative_days, decision, reason, flags, summary,
            faithfulness, external_ref, source, work_authorization_id, status)
         values ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8,$9::jsonb,$10,$11,$12::jsonb,$13,$14::jsonb,$15,$16,$17,$18)`,
        [
          row.id,
          row.createdAt,
          row.updatedAt,
          row.employmentId,
          row.requester,
          JSON.stringify(row.factors ?? {}),
          JSON.stringify(row.risk ?? {}),
          row.tripDays,
          row.cumulativeDays ? JSON.stringify(row.cumulativeDays) : null,
          row.decision,
          row.reason,
          JSON.stringify(row.flags ?? []),
          row.summary,
          row.faithfulness ? JSON.stringify(row.faithfulness) : null,
          row.externalRef,
          row.source,
          row.workAuthorizationId,
          row.status,
        ]
      );
      this.#track(insertPromise, `authorization ${row.id}`);
    }
    return row;
  }

  /**
   * @param {string} id
   * @returns {Promise<object|null>} checks local memory first, then Postgres
   *   (if configured) — same "either backing may have it" discipline as
   *   CaseStore's mutation methods and AmendmentStore.findById().
   */
  async findById(id) {
    const local = this.authorizations.find((a) => a.id === id);
    if (local) return local;
    if (!this.pgPool) return null;
    const result = await this.pgPool.query(`select ${SELECT_COLUMNS} from uc04_authorizations where id = $1`, [id]);
    return result.rows[0] ? normalizeRow(result.rows[0]) : null;
  }

  /**
   * Newest authorization tied to a given Zendesk ticket (externalRef) — a
   * ticket could in principle generate more than one request over time,
   * same "newest, not the only one" reasoning as the other stores.
   * @param {string} externalRef
   */
  async findByExternalRef(externalRef) {
    const localMatches = this.authorizations.filter((a) => String(a.externalRef) === String(externalRef));
    if (localMatches.length) return localMatches[localMatches.length - 1];
    if (!this.pgPool) return null;
    const result = await this.pgPool.query(
      `select ${SELECT_COLUMNS} from uc04_authorizations where external_ref = $1 order by created_at desc limit 1`,
      [String(externalRef)]
    );
    return result.rows[0] ? normalizeRow(result.rows[0]) : null;
  }

  /**
   * Attach the Zendesk ticket id as the authorization's externalRef — the
   * by-ticket lookup the ZAF sidebar uses to find this authorization. Called
   * AFTER the ticket exists, because UC-04's "gates first, ticket after"
   * ordering (00-FOUNDATION.md §2's Remote-native webhook path) means the
   * authorization row is created before the ticket id can possibly be known.
   * @param {string} id
   * @param {string} externalRef
   */
  async linkTicket(id, externalRef) {
    const now = new Date().toISOString();
    const local = this.authorizations.find((a) => a.id === id);
    if (local) {
      local.externalRef = String(externalRef);
      local.updatedAt = now;
    }
    if (this.pgPool) {
      await this.pgPool.query(
        `update uc04_authorizations set external_ref = $2, updated_at = $3 where id = $1`,
        [id, String(externalRef), now]
      );
    }
    return this.findById(id);
  }

  /** Fill the single approval slot. Does not itself decide whether that's allowed — see approvalPolicy.js. */
  async recordApproval(id, approver, note) {
    const now = new Date().toISOString();
    const slot = { approver, note: note || null, at: now };
    const local = this.authorizations.find((a) => a.id === id);
    if (local) {
      local.approver = slot.approver;
      local.approvalNote = slot.note;
      local.approvedAt = slot.at;
      local.updatedAt = now;
    }
    if (this.pgPool) {
      await this.pgPool.query(
        `update uc04_authorizations set approver = $2, approval_note = $3, approved_at = $4, updated_at = $4 where id = $1`,
        [id, slot.approver, slot.note, slot.at]
      );
    }
    return this.findById(id);
  }

  /**
   * Record the specialist's refusal. `declined`, not `denied` — see
   * src/shared/declineVocabulary.js. A row written before the rename still
   * reads back correctly, because normalizeRow() canonicalises it.
   */
  async markDeclined(id, approver, note) {
    const now = new Date().toISOString();
    const declinedBy = { approver, note: note || null, at: now };
    const local = this.authorizations.find((a) => a.id === id);
    if (local) {
      local.status = "declined";
      local.declinedBy = declinedBy;
      local.declinedAt = now;
      local.updatedAt = now;
    }
    if (this.pgPool) {
      await this.pgPool.query(
        `update uc04_authorizations set status = 'declined', denied_by = $2::jsonb, denied_at = $3, updated_at = $3 where id = $1`,
        [id, JSON.stringify(declinedBy), now]
      );
    }
    return this.findById(id);
  }

  async markExecuted(id, remoteResult) {
    const now = new Date().toISOString();
    const local = this.authorizations.find((a) => a.id === id);
    if (local) {
      local.status = "executed";
      local.executedAt = now;
      local.remoteResult = remoteResult;
      local.updatedAt = now;
    }
    if (this.pgPool) {
      await this.pgPool.query(
        `update uc04_authorizations set status = 'executed', executed_at = $2, remote_result = $3::jsonb, updated_at = $2 where id = $1`,
        [id, now, JSON.stringify(remoteResult ?? {})]
      );
    }
    return this.findById(id);
  }

  /**
   * The work-authorization requests ONE requester owns, newest first — the read behind the
   * portal's "My requests" (src/portal/server.js).
   *
   * TWO OWNER SCOPES, BECAUSE THIS TABLE HAS TWO DIFFERENT OWNERS.
   * `employmentId` is the person the record is ABOUT; `requester` is the
   * authenticated session that filed it. They are the same person for a
   * self-service request and deliberately different for one a company admin
   * files on an employee's behalf, which is exactly what this table holds. A
   * caller asking "what did I file?" and a caller asking "what is on my
   * record?" are asking different questions, and answering the first with the
   * second would show an admin nothing at all.
   *
   * Whichever fields are supplied are ANDed. Supplying neither returns nothing
   * rather than everything — see src/shared/ownerScope.js's header for why
   * that is the direction this has to fail in.
   *
   * `flush()` first because creation is fire-and-forget: a row written moments
   * ago may still be in flight, and reading Postgres alone then loses it.
   *
   * @param {object} scope
   * @param {string|null} [scope.employmentId]
   * @param {string|null} [scope.requester]
   * @param {string|null} [scope.source]  e.g. "portal"
   * @param {number} [scope.limit]  newest N — an unbounded response is its own outage
   * @returns {Promise<object[]>}
   */
  async listByOwner({ employmentId = null, requester = null, source = null, limit = 50 } = {}) {
    // Fail closed: an unscoped call lists nobody's rows, never everybody's.
    if (!employmentId && !requester) return [];
    if (!this.pgPool) {
      return this.authorizations
        .filter((row) => matchesOwner(row, { employmentId, requester, source }))
        .slice()
        .reverse()
        .slice(0, limit);
    }
    await this.flush();
    const params = [];
    const conditions = [];
    for (const [column, value] of [
      ["employment_id", employmentId],
      ["requester", requester],
      ["source", source],
    ]) {
      if (!value) continue;
      params.push(String(value));
      conditions.push(`${column} = $${params.length}`);
    }
    params.push(limit);
    const result = await this.pgPool.query(
      `select ${SELECT_COLUMNS} from uc04_authorizations where ${conditions.join(" and ")} order by created_at desc limit $${params.length}`,
      params
    );
    return result.rows.map(normalizeRow);
  }

  /** Await any DB writes still in flight — call before reading rows back. */
  async flush() {
    await Promise.allSettled(this.pending);
    this.pending = [];
  }

  /**
   * All authorizations created in THIS process, newest first — the source
   * for a dashboard queue. Same in-memory-only scope as ExpenseStore.list():
   * the seeded CLI always creates its demo rows through this store directly,
   * so the local array is populated whether or not a pgPool is configured.
   */
  list() {
    return [...this.authorizations].reverse();
  }
}

/**
 * Coerce jsonb columns that some driver/column combinations hand back as a
 * JSON string rather than a parsed object — same fix as
 * amendmentStore.normalizeRow().
 */
function normalizeRow(row) {
  return {
    ...row,
    factors: coerceJson(row.factors, {}),
    risk: coerceJson(row.risk, null),
    cumulativeDays: coerceJson(row.cumulativeDays, null),
    flags: coerceJson(row.flags, []),
    faithfulness: coerceJson(row.faithfulness, null),
    // The one place a Postgres row becomes an in-memory row, which is why the
    // legacy `denied` status is canonicalised HERE and nowhere else.
    status: canonicalDecisionStatus(row.status),
    declinedBy: coerceJson(row.declinedBy, null),
    remoteResult: coerceJson(row.remoteResult, null),
  };
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
