// ---------------------------------------------------------------------------
// amendmentStore.js  —  UC-06 operational state (dual-approval tracking)
// ---------------------------------------------------------------------------
// WHY A SEPARATE STORE, NOT A REUSE OF review_queue
// src/review/reviewPolicy.js's own header notes "UC-06's dual approval
// extends this rule rather than replacing it" — and the PRINCIPLES do extend
// (pure policy separate from storage, one decision per case, actionability
// computed server-side never re-derived in the UI). What does NOT extend
// cleanly is the SCHEMA: `review_queue` has one status/assignee/notes slot
// for a single decision. UC-06 needs two independently-identified approval
// slots that both have to fill before anything executes. Rather than encode
// a role into a free-text column on a one-slot table, this is its own small
// store following the identical discipline instead.
//
// SAME in-memory-first / optional-pgPool PATTERN AS CaseStore/AuditLogger:
// tests/demo/the seeded CLI never touch a database; `npm run uc06-api` uses
// real Supabase when SUPABASE_DB_URL is configured. `createAmendment()` is
// fire-and-forget in the background (same as AuditLogger.log()/CaseStore.
// createCase()) because it records a decision that's already been made and
// acted on informationally — nothing depends on it landing before returning.
// recordApproval()/markDenied()/markExecuted() are awaited and allowed to
// throw: each one IS the record that a human authorised something (or that
// a real write happened), so a silent failure there would be worse than an
// error surfaced to the caller — the same asymmetry AuditLogger.logDurable()
// and CaseStore.updateReviewQueueStatus() already establish, for the same
// reason. They also don't require the row to already be in local memory:
// the API server can run as a different process from whatever created the
// amendment, so they update whichever backing (memory and/or Postgres)
// actually has it, exactly like CaseStore's update methods.
// ---------------------------------------------------------------------------

import { randomUUID } from "node:crypto";
import { canonicalDecisionStatus } from "../shared/declineVocabulary.js";

const SELECT_COLUMNS = `
  id,
  created_at                 as "createdAt",
  updated_at                 as "updatedAt",
  employment_id               as "employmentId",
  requester,
  changes,
  amendment_type              as "amendmentType",
  requested_effective_date    as "requestedEffectiveDate",
  decision,
  reason,
  flags,
  payload,
  cutoff,
  summary,
  faithfulness,
  external_ref                as "externalRef",
  source,
  status,
  admin_approval               as "adminApproval",
  payroll_approval             as "payrollApproval",
  -- The COLUMN keeps its name, the FIELD does not: see the same note in
  -- src/uc04/authorizationStore.js. A physical column rename is a mandatory
  -- migration; an alias needs nobody to run SQL and cannot be forgotten.
  denied_by                   as "declinedBy",
  executed_at                 as "executedAt",
  remote_result                as "remoteResult"`;

export class AmendmentStore {
  /**
   * @param {object} [opts]
   * @param {import("pg").Pool|null} [opts.pgPool]  when set, also writes to
   *   Supabase's `uc06_amendments` table
   */
  constructor({ pgPool = null } = {}) {
    this.pgPool = pgPool;
    this.amendments = [];
    this.pending = [];
  }

  #track(promise, label) {
    const guarded = promise.catch((err) => {
      console.error(`[uc06] failed to write ${label} to Supabase: ${err.message}`);
    });
    this.pending.push(guarded);
  }

  /**
   * One row per amendment request — decision, drafted payload, and (once
   * created) the dual-approval slots that start empty.
   * @param {object} args
   * @returns {object} the created amendment row
   */
  createAmendment({
    employmentId,
    requester,
    changes,
    amendmentType,
    requestedEffectiveDate,
    decision,
    reason,
    flags,
    payload = null,
    cutoff = null,
    summary = null,
    faithfulness = null,
    externalRef = null,
    source = null,
  }) {
    const now = new Date().toISOString();
    const row = {
      id: randomUUID(),
      createdAt: now,
      updatedAt: now,
      employmentId,
      requester,
      changes,
      amendmentType,
      requestedEffectiveDate,
      decision,
      reason,
      flags,
      payload,
      cutoff,
      summary,
      faithfulness,
      externalRef,
      source,
      // "pending_dual_approval" is the only status this store's approval
      // flow acts on; anything escalated stays informational (mirrors UC-01's
      // "escalations are visible, never actionable" rule).
      status: decision === "dual_approval_required" ? "pending_dual_approval" : "escalated",
      adminApproval: null,
      payrollApproval: null,
      declinedBy: null,
      executedAt: null,
      remoteResult: null,
    };
    this.amendments.push(row);

    if (this.pgPool) {
      const insertPromise = this.pgPool.query(
        `insert into uc06_amendments
           (id, created_at, updated_at, employment_id, requester, changes, amendment_type,
            requested_effective_date, decision, reason, flags, payload, cutoff, summary,
            faithfulness, external_ref, source, status)
         values ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10,$11::jsonb,$12::jsonb,$13::jsonb,$14,$15::jsonb,$16,$17,$18)`,
        [
          row.id,
          row.createdAt,
          row.updatedAt,
          row.employmentId,
          row.requester,
          JSON.stringify(row.changes ?? {}),
          row.amendmentType,
          row.requestedEffectiveDate,
          row.decision,
          row.reason,
          JSON.stringify(row.flags ?? []),
          row.payload ? JSON.stringify(row.payload) : null,
          row.cutoff ? JSON.stringify(row.cutoff) : null,
          row.summary,
          row.faithfulness ? JSON.stringify(row.faithfulness) : null,
          row.externalRef,
          row.source,
          row.status,
        ]
      );
      this.#track(insertPromise, `amendment ${row.id}`);
    }
    return row;
  }

  /**
   * @param {string} id
   * @returns {Promise<object|null>} checks local memory first, then Postgres
   *   (if configured) — same "either backing may have it" discipline as
   *   CaseStore's mutation methods.
   */
  async findById(id) {
    const local = this.amendments.find((a) => a.id === id);
    if (local) return local;
    if (!this.pgPool) return null;
    const result = await this.pgPool.query(`select ${SELECT_COLUMNS} from uc06_amendments where id = $1`, [id]);
    return result.rows[0] ? normalizeRow(result.rows[0]) : null;
  }

  /**
   * Find the amendment tied to a given Zendesk ticket (externalRef) — the
   * newest one, matching UC-01's review store's "newest, not the only one"
   * reasoning: a ticket that was reopened and re-run could have more than
   * one amendment row over time.
   * @param {string} externalRef
   */
  async findByExternalRef(externalRef) {
    const localMatches = this.amendments.filter((a) => String(a.externalRef) === String(externalRef));
    if (localMatches.length) return localMatches[localMatches.length - 1];
    if (!this.pgPool) return null;
    const result = await this.pgPool.query(
      `select ${SELECT_COLUMNS} from uc06_amendments where external_ref = $1 order by created_at desc limit 1`,
      [String(externalRef)]
    );
    return result.rows[0] ? normalizeRow(result.rows[0]) : null;
  }

  /** Fill one approval slot. Does not itself decide whether that's allowed — see dualApprovalPolicy.js. */
  async recordApproval(id, role, approver, note) {
    const now = new Date().toISOString();
    const slot = { approver, note: note || null, at: now };
    const key = role === "customer_admin" ? "adminApproval" : "payrollApproval";
    const column = role === "customer_admin" ? "admin_approval" : "payroll_approval";

    const local = this.amendments.find((a) => a.id === id);
    if (local) {
      local[key] = slot;
      local.updatedAt = now;
    }
    if (this.pgPool) {
      await this.pgPool.query(
        `update uc06_amendments set ${column} = $2::jsonb, updated_at = $3 where id = $1`,
        [id, JSON.stringify(slot), now]
      );
    }
    return this.findById(id);
  }

  /**
   * Attach the Zendesk ticket id as the amendment's externalRef — the
   * by-ticket lookup the ZAF sidebar uses to find this amendment. Called by
   * src/remoteui/ AFTER the ticket exists, because UC-06's "gates first,
   * ticket after" ordering (00-FOUNDATION.md §2's Remote-native webhook
   * path) means the amendment row is created before the ticket id can
   * possibly be known. Mirrors the "either backing may have it" discipline
   * of the other mutation methods.
   */
  async linkTicket(id, externalRef) {
    const now = new Date().toISOString();
    const local = this.amendments.find((a) => a.id === id);
    if (local) {
      local.externalRef = String(externalRef);
      local.updatedAt = now;
    }
    if (this.pgPool) {
      await this.pgPool.query(
        `update uc06_amendments set external_ref = $2, updated_at = $3 where id = $1`,
        [id, String(externalRef), now]
      );
    }
    return this.findById(id);
  }

  /**
   * COMPARE-AND-SET: claim this amendment for execution (QA finding F-09,
   * CRITICAL — concurrency). Identical mechanism, and identical reasoning, to
   * AdjustmentStore.claimForExecution() — see that method's comment for the
   * full write-up; UC-06's version of the bug double-PATCHed real payroll
   * when both approvals landed together.
   *
   * The compare and the set are the first statements here, executed
   * synchronously before this function's first `await`: an await yields the
   * event-loop turn, and that gap is the whole vulnerability. Do not insert
   * one above them.
   *
   * @param {string} id
   * @returns {Promise<object|null>} the claimed row, or null if another caller
   *   claimed it first.
   */
  async claimForExecution(id) {
    const local = this.amendments.find((a) => a.id === id);
    let claimedLocally = false;

    // ---- synchronous compare-and-set; no await above this line ----
    if (local) {
      if (local.status !== "pending_dual_approval") return null;
      local.status = "executing";
      local.updatedAt = new Date().toISOString();
      claimedLocally = true;
    }
    // ---- end of the critical section ----

    if (this.pgPool) {
      const result = await this.pgPool.query(
        `update uc06_amendments set status = 'executing', updated_at = $2
           where id = $1 and status = 'pending_dual_approval'`,
        [id, new Date().toISOString()]
      );
      if (!claimedLocally && result.rowCount !== 1) return null;
    } else if (!claimedLocally) {
      return null;
    }

    return this.findById(id);
  }

  /**
   * Give the claim back, `executing -> pending_dual_approval`. Only for an
   * execution abandoned BEFORE the Remote PATCH was attempted. See
   * AdjustmentStore.releaseExecutionClaim() for why a post-write failure
   * deliberately does NOT release.
   * @param {string} id
   */
  async releaseExecutionClaim(id) {
    const local = this.amendments.find((a) => a.id === id);
    if (local && local.status === "executing") {
      local.status = "pending_dual_approval";
      local.updatedAt = new Date().toISOString();
    }
    if (this.pgPool) {
      await this.pgPool.query(
        `update uc06_amendments set status = 'pending_dual_approval', updated_at = $2
           where id = $1 and status = 'executing'`,
        [id, new Date().toISOString()]
      );
    }
    return this.findById(id);
  }

  async markDeclined(id, role, approver, note) {
    const now = new Date().toISOString();
    const declinedBy = { role, approver, note: note || null, at: now };

    const local = this.amendments.find((a) => a.id === id);
    if (local) {
      local.status = "declined";
      local.declinedBy = declinedBy;
      local.updatedAt = now;
    }
    if (this.pgPool) {
      await this.pgPool.query(
        `update uc06_amendments set status = 'declined', denied_by = $2::jsonb, updated_at = $3 where id = $1`,
        [id, JSON.stringify(declinedBy), now]
      );
    }
    return this.findById(id);
  }

  async markExecuted(id, remoteResult) {
    const now = new Date().toISOString();

    const local = this.amendments.find((a) => a.id === id);
    if (local) {
      local.status = "executed";
      local.executedAt = now;
      local.remoteResult = remoteResult;
      local.updatedAt = now;
    }
    if (this.pgPool) {
      await this.pgPool.query(
        `update uc06_amendments set status = 'executed', executed_at = $2, remote_result = $3::jsonb, updated_at = $2 where id = $1`,
        [id, now, JSON.stringify(remoteResult ?? {})]
      );
    }
    return this.findById(id);
  }

  isFullyApproved(row) {
    return Boolean(row.adminApproval && row.payrollApproval);
  }

  /** Await any DB writes still in flight — call before reading rows back. */
  async flush() {
    await Promise.allSettled(this.pending);
    this.pending = [];
  }

  /**
   * All amendments created in THIS process, newest first — the source for a
   * dashboard queue. Same in-memory-only scope as ExpenseStore.list().
   */
  list() {
    return [...this.amendments].reverse();
  }
}

/**
 * Coerce jsonb columns that some driver/column combinations hand back as a
 * JSON string rather than a parsed object — same reasoning and same fix as
 * review/store.js's normalizeCase().
 */
function normalizeRow(row) {
  return {
    ...row,
    changes: coerceJson(row.changes, {}),
    flags: coerceJson(row.flags, []),
    payload: coerceJson(row.payload, null),
    cutoff: coerceJson(row.cutoff, null),
    faithfulness: coerceJson(row.faithfulness, null),
    adminApproval: coerceJson(row.adminApproval, null),
    payrollApproval: coerceJson(row.payrollApproval, null),
    // The one place a Postgres row becomes an in-memory row — so the legacy
    // `denied` status is canonicalised here and nowhere else.
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
