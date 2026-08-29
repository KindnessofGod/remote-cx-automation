// ---------------------------------------------------------------------------
// adjustmentStore.js  —  UC-09 operational state (multi-approval tracking)
// ---------------------------------------------------------------------------
// WHY A SEPARATE STORE, NOT A REUSE OF review_queue OR amendmentStore
// Similar to amendmentStore.js's reasoning, but UC-09 needs up to THREE
// approval slots (requester + approver + payment_releaser) that all must fill
// before execution, with segregation of duties enforcement (no person filling
// multiple roles). Rather than overload existing stores with N-role logic,
// this is its own small store following the identical discipline.
//
// SAME in-memory-first / optional-pgPool PATTERN AS CaseStore/AuditLogger:
// tests/demo/the seeded CLI never touch a database; `npm run uc09-api` uses
// real Supabase when SUPABASE_DB_URL is configured. `createAdjustment()` is
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
// adjustment, so they update whichever backing (memory and/or Postgres)
// actually has it, exactly like CaseStore's update methods.
// ---------------------------------------------------------------------------

import { randomUUID } from "node:crypto";
import { matchesOwner } from "../shared/ownerScope.js";
import { isFullyApproved as isFullyApprovedPolicy } from "./multiApprovalPolicy.js";

const SELECT_COLUMNS = `
  id,
  created_at                 as "createdAt",
  updated_at                 as "updatedAt",
  employment_id               as "employmentId",
  requester,
  adjustment,
  adjustment_type              as "adjustmentType",
  processing_date             as "processingDate",
  decision,
  reason,
  flags,
  risk_basis                  as "riskBasis",
  payload,
  summary,
  faithfulness,
  external_ref                as "externalRef",
  source,
  status,
  approval_slots_required      as "approvalSlotsRequired",
  requester_approval           as "requesterApproval",
  approver_approval           as "approverApproval",
  payment_releaser_approval   as "paymentReleaserApproval",
  denied_by                   as "deniedBy",
  executed_at                 as "executedAt",
  remote_result                as "remoteResult"`;

export class AdjustmentStore {
  /**
   * @param {object} [opts]
   * @param {import("pg").Pool|null} [opts.pgPool]  when set, also writes to
   *   Supabase's `uc09_adjustments` table
   */
  constructor({ pgPool = null } = {}) {
    this.pgPool = pgPool;
    this.adjustments = [];
    this.pending = [];
  }

  #track(promise, label) {
    const guarded = promise.catch((err) => {
      console.error(`[uc09] failed to write ${label} to Supabase: ${err.message}`);
    });
    this.pending.push(guarded);
  }

  /**
   * One row per adjustment request — decision, drafted payload, and (once
   * created) the approval slots that start empty.
   * @param {object} args
   * @returns {object} the created adjustment row
   */
  createAdjustment({
    employmentId,
    requester,
    adjustment,
    adjustmentType,
    processingDate,
    decision,
    reason,
    flags,
    riskBasis = null,
    payload = null,
    summary = null,
    faithfulness = null,
    externalRef = null,
    source = null,
    approvalSlotsRequired = 2,  // Default to minimum 2 approvals
  }) {
    const now = new Date().toISOString();
    const row = {
      id: randomUUID(),
      createdAt: now,
      updatedAt: now,
      employmentId,
      requester,
      adjustment,
      adjustmentType,
      processingDate,
      decision,
      reason,
      flags,
      // WHERE EACH RISK DIMENSION'S ANSWER CAME FROM (policyEngine.js's
      // `riskBasis`), ON THE OPERATIONAL ROW — not only in `audit_log`.
      //
      // It was computed, returned, written to the audit row and then dropped
      // here, so `approvalView.js`'s and `decisionFacts.js`'s `row.riskBasis`
      // lookups were dead on every row that had ever existed: the jurisdiction
      // dimension could say the list had matched and never which country
      // matched it, and reported `not recorded on this row` in production
      // while the value was sitting in `audit_log` all along. The approval
      // screen is read from THIS table; a basis that lives only in the audit
      // log is a basis no approver will ever see.
      riskBasis,
      payload,
      summary,
      faithfulness,
      externalRef,
      source,
      approvalSlotsRequired,
      // "pending_approval" is the only status this store's approval
      // flow acts on; anything escalated stays informational (mirrors UC-01's
      // "escalations are visible, never actionable" rule).
      status: decision.includes("approval_required") ? "pending_approval" : "escalated",
      requesterApproval: null,
      approverApproval: null,
      paymentReleaserApproval: null,
      deniedBy: null,
      executedAt: null,
      remoteResult: null,
    };
    this.adjustments.push(row);

    if (this.pgPool) {
      const insertPromise = this.pgPool.query(
        `insert into uc09_adjustments
           (id, created_at, updated_at, employment_id, requester, adjustment, adjustment_type,
            processing_date, decision, reason, flags, risk_basis, payload, summary,
            faithfulness, external_ref, source, approval_slots_required, status)
         values ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10,$11::jsonb,$12::jsonb,$13::jsonb,$14,$15::jsonb,$16,$17,$18,$19)`,
        [
          row.id,
          row.createdAt,
          row.updatedAt,
          row.employmentId,
          row.requester,
          JSON.stringify(row.adjustment ?? {}),
          row.adjustmentType,
          row.processingDate,
          row.decision,
          row.reason,
          JSON.stringify(row.flags ?? []),
          row.riskBasis ? JSON.stringify(row.riskBasis) : null,
          row.payload ? JSON.stringify(row.payload) : null,
          row.summary,
          row.faithfulness ? JSON.stringify(row.faithfulness) : null,
          row.externalRef,
          row.source,
          row.approvalSlotsRequired,
          row.status,
        ]
      );
      this.#track(insertPromise, `adjustment ${row.id}`);
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
    const local = this.adjustments.find((a) => a.id === id);
    if (local) return local;
    if (!this.pgPool) return null;
    const result = await this.pgPool.query(`select ${SELECT_COLUMNS} from uc09_adjustments where id = $1`, [id]);
    return result.rows[0] ? normalizeRow(result.rows[0]) : null;
  }

  /**
   * Find the adjustment tied to a given Zendesk ticket (externalRef) — the
   * newest one, matching UC-01's review store's "newest, not the only one"
   * reasoning: a ticket that was reopened and re-run could have more than
   * one adjustment row over time.
   * @param {string} externalRef
   */
  async findByExternalRef(externalRef) {
    const localMatches = this.adjustments.filter((a) => String(a.externalRef) === String(externalRef));
    if (localMatches.length) return localMatches[localMatches.length - 1];
    if (!this.pgPool) return null;
    const result = await this.pgPool.query(
      `select ${SELECT_COLUMNS} from uc09_adjustments where external_ref = $1 order by created_at desc limit 1`,
      [String(externalRef)]
    );
    return result.rows[0] ? normalizeRow(result.rows[0]) : null;
  }

  /** Fill one approval slot. Does not itself decide whether that's allowed — see multiApprovalPolicy.js. */
  async recordApproval(id, role, approver, note) {
    const now = new Date().toISOString();
    const slot = { approver, note: note || null, at: now };
    let key, column;

    switch (role) {
      case "requester":
        key = "requesterApproval";
        column = "requester_approval";
        break;
      case "approver":
        key = "approverApproval";
        column = "approver_approval";
        break;
      case "payment_releaser":
        key = "paymentReleaserApproval";
        column = "payment_releaser_approval";
        break;
      default:
        throw new Error(`Invalid role: ${role}`);
    }

    const local = this.adjustments.find((a) => a.id === id);
    if (local) {
      local[key] = slot;
      local.updatedAt = now;
    }
    if (this.pgPool) {
      await this.pgPool.query(
        `update uc09_adjustments set ${column} = $2::jsonb, updated_at = $3 where id = $1`,
        [id, JSON.stringify(slot), now]
      );
    }
    return this.findById(id);
  }

  /**
   * Attach the Zendesk ticket id as the adjustment's externalRef — the
   * by-ticket lookup the ZAF sidebar uses to find this adjustment. Called by
   * the workflow AFTER the ticket exists, because UC-09's "gates first,
   * ticket after" ordering (00-FOUNDATION.md §2's Remote-native webhook
   * path) means the adjustment row is created before the ticket id can
   * possibly be known. Mirrors the "either backing may have it" discipline
   * of the other mutation methods.
   */
  async linkTicket(id, externalRef) {
    const now = new Date().toISOString();
    const local = this.adjustments.find((a) => a.id === id);
    if (local) {
      local.externalRef = String(externalRef);
      local.updatedAt = now;
    }
    if (this.pgPool) {
      await this.pgPool.query(
        `update uc09_adjustments set external_ref = $2, updated_at = $3 where id = $1`,
        [id, String(externalRef), now]
      );
    }
    return this.findById(id);
  }

  /**
   * COMPARE-AND-SET: claim this adjustment for execution (QA finding F-09,
   * CRITICAL — concurrency).
   *
   * ---------------------------------------------------------------------
   * THE BUG. submitAdjustmentApproval() ran "are we fully approved?" and then
   * `remote.createIncentive(...)` with nothing in between holding a claim.
   * Two or three approvals arriving together each recorded their own slot,
   * each then re-read a row that by that point showed every slot filled, and
   * each executed. Three parallel approvals produced three createIncentive
   * calls: $15,000 disbursed against a $5,000 adjustment. The four-eyes
   * control was intact the whole time — it counted approvals correctly. The
   * missing piece was that "we may execute" and "we are executing" were never
   * distinguished, so N callers could hold the first at once.
   *
   * Reproduced live before the fix: two approvals fired with `Promise.all`
   * against the last required slot produced TWO `createIncentive` calls on one
   * adjustment.
   *
   * THE CLAIM. `pending_approval -> executing` is a transition only ONE
   * caller can win. The winner gets the row; every later caller gets null and
   * must not write. This is the same shape as a SQL `UPDATE ... WHERE
   * status = 'pending_approval'` guarded by rowCount, which is exactly what
   * the Postgres branch below does.
   *
   * ---------------------------------------------------------------------
   * THIS METHOD, AND releaseExecutionClaim() BELOW, WERE EACH DEFINED TWICE
   * IN THIS CLASS. In JavaScript the LATER definition silently wins — no
   * error, no warning, no lint failure in this repo's toolchain. The two
   * bodies happened to be identical, so nothing was broken; what was broken
   * was the next person to touch it, because a fix applied to the first copy
   * would have done NOTHING while reading as done. On a compare-and-set that
   * is the only thing standing between two concurrent approvals and two real
   * payments, "the edit you can see had no effect" is the most expensive
   * shape a latent defect can take. `test/uc09ApprovalFloor.test.js` now
   * parses every file in `src/uc09/` and fails on any class member declared
   * more than once, so a recurrence is loud instead of latent.
   * ---------------------------------------------------------------------
   *
   * WHY THE IN-MEMORY PATH IS ATOMIC, AND WHY IT IS FRAGILE. Node runs one
   * turn of the event loop at a time, so a read-then-write pair is atomic
   * PROVIDED NO `await` SEPARATES THEM — an await yields the turn, and that
   * gap is precisely where the second caller slipped in before. The compare
   * and the set below are therefore the first statements in this method, run
   * synchronously before the function's first await. **Do not insert an
   * await, a logging call that returns a promise, or a findById() above
   * them.** Everything that needs I/O happens after the claim is already won.
   *
   * THE SQL PATH. `where id = $1 and status = 'pending_approval'` makes
   * Postgres itself the arbiter: the row is locked for the duration of the
   * UPDATE, so of N concurrent statements exactly one reports rowCount 1.
   * The in-memory claim is mirrored to Postgres rather than re-decided there,
   * because in a single-process deployment memory is the authority and in a
   * multi-process one (the API server is often a different process from
   * whatever created the row — see this file's header) the row will not be in
   * local memory at all and the SQL branch is the only claim there is.
   * A cross-process deployment that ALSO caches rows in memory needs the SQL
   * claim to be the only one consulted; that is a deployment-shape decision
   * recorded here rather than silently assumed.
   *
   * @param {string} id
   * @returns {Promise<object|null>} the claimed row, or null if somebody else
   *   claimed it first (or it is not in a claimable state at all).
   */
  async claimForExecution(id) {
    const local = this.adjustments.find((a) => a.id === id);
    let claimedLocally = false;

    // ---- synchronous compare-and-set; no await above this line ----
    if (local) {
      if (local.status !== "pending_approval") return null;
      local.status = "executing";
      local.updatedAt = new Date().toISOString();
      claimedLocally = true;
    }
    // ---- end of the critical section ----

    if (this.pgPool) {
      const now = new Date().toISOString();
      const result = await this.pgPool.query(
        `update uc09_adjustments set status = 'executing', updated_at = $2
           where id = $1 and status = 'pending_approval'`,
        [id, now]
      );
      if (!claimedLocally && result.rowCount !== 1) return null;
    } else if (!claimedLocally) {
      return null; // no row anywhere to claim
    }

    return this.findById(id);
  }

  /**
   * Give the claim back, `executing -> pending_approval`. Called only when the
   * execution was abandoned BEFORE any Remote write was attempted (the
   * freshness re-check failing is the real case). A row abandoned AFTER the
   * write was attempted is deliberately left in `executing`: we do not know
   * whether the money moved, and the safe reading of "unknown" on a payment
   * path is "do not let anyone press it again without looking."
   * @param {string} id
   */
  async releaseExecutionClaim(id) {
    const local = this.adjustments.find((a) => a.id === id);
    if (local && local.status === "executing") {
      local.status = "pending_approval";
      local.updatedAt = new Date().toISOString();
    }
    if (this.pgPool) {
      await this.pgPool.query(
        `update uc09_adjustments set status = 'pending_approval', updated_at = $2
           where id = $1 and status = 'executing'`,
        [id, new Date().toISOString()]
      );
    }
    return this.findById(id);
  }

  async markDenied(id, role, approver, note) {
    const now = new Date().toISOString();
    const deniedBy = { role, approver, note: note || null, at: now };

    const local = this.adjustments.find((a) => a.id === id);
    if (local) {
      local.status = "denied";
      local.deniedBy = deniedBy;
      local.updatedAt = now;
    }
    if (this.pgPool) {
      await this.pgPool.query(
        `update uc09_adjustments set status = 'denied', denied_by = $2::jsonb, updated_at = $3 where id = $1`,
        [id, JSON.stringify(deniedBy), now]
      );
    }
    return this.findById(id);
  }

  async markExecuted(id, remoteResult) {
    const now = new Date().toISOString();

    const local = this.adjustments.find((a) => a.id === id);
    if (local) {
      local.status = "executed";
      local.executedAt = now;
      local.remoteResult = remoteResult;
      local.updatedAt = now;
    }
    if (this.pgPool) {
      await this.pgPool.query(
        `update uc09_adjustments set status = 'executed', executed_at = $2, remote_result = $3::jsonb, updated_at = $2 where id = $1`,
        [id, now, JSON.stringify(remoteResult ?? {})]
      );
    }
    return this.findById(id);
  }

  /**
   * Delegates to multiApprovalPolicy.js's isFullyApproved() — this method
   * used to carry its own copy of the check (`filledCount >=
   * approvalSlotsRequired`, no floor against a null requirement, no
   * distinct-humans count). Three independent definitions of "enough
   * approvals" existed across this use case (here, workflow.js's own local
   * copy, and this exported policy function) and only one of them was ever
   * on the execution path — the other two were dead code that still looked
   * authoritative enough to test directly. One definition now, in the file
   * whose job this is; this method exists only so callers that already
   * spell it `adjustmentStore.isFullyApproved(row)` keep working.
   */
  isFullyApproved(row) {
    return isFullyApprovedPolicy(row);
  }

  /**
   * The off-cycle adjustments ONE requester owns, newest first — the read behind the
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
      return this.adjustments
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
      `select ${SELECT_COLUMNS} from uc09_adjustments where ${conditions.join(" and ")} order by created_at desc limit $${params.length}`,
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
   * All adjustments created in THIS process, newest first — the source for
   * a dashboard queue. Same in-memory-only scope as ExpenseStore.list().
   */
  list() {
    return [...this.adjustments].reverse();
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
    adjustment: coerceJson(row.adjustment, {}),
    flags: coerceJson(row.flags, []),
    riskBasis: coerceJson(row.riskBasis, null),
    payload: coerceJson(row.payload, null),
    faithfulness: coerceJson(row.faithfulness, null),
    requesterApproval: coerceJson(row.requesterApproval, null),
    approverApproval: coerceJson(row.approverApproval, null),
    paymentReleaserApproval: coerceJson(row.paymentReleaserApproval, null),
    deniedBy: coerceJson(row.deniedBy, null),
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