// ---------------------------------------------------------------------------
// resignationStore.js  —  UC-05 operational state (validated discrepancy reports)
// ---------------------------------------------------------------------------
// WHY A DEDICATED STORE, NOT A REUSE OF review_queue
// Same reasoning as src/uc06/amendmentStore.js's header: review_queue is
// shaped for ONE decision per case (a single approve/decline, one approver
// header). UC-05 also has a single-decision shape (a single HR Ops sign-off
// or decline, not a dual approval), but the FIELDS it carries are different
// from a verification review: the full notice-period calculation, the PTO
// payout reconciliation, the LLM-extracted letter facts, and a status
// lifecycle that ends at `signed_off` rather than `executed`. Overloading
// review_queue with a polymorphic "useCase" column would erase the field
// difference at the storage layer; a small, dedicated store with the same
// in-memory-first / optional-pgPool pattern as every other store in this
// repo is the cheaper way to keep the schema honest.
//
// WHY NO MUTATIONS BEYOND createResignation/recordSignoff/markDenied
// UC-05 is a 🟡 HITL-prepared use case whose "execution" is the HR Ops
// sign-off on a calculated report (UC-05.md §1: "HR Ops verifies +
// submits"). The spec explicitly notes that NO write endpoint to Remote is
// confirmed for resignations — the "execution" here is producing a
// validated discrepancy report and audit-logging it (per the ticket
// itself). The store therefore has no `markExecuted` method calling a real
// Remote endpoint; the signed-off report is the durable artifact, the same
// way UC-08's dossier is its durable artifact and has no execution path.
// If a future Remote write endpoint is confirmed, the lifecycle would
// grow a `markOffboarded` method here, but it does not exist today and
// adding it speculatively would break the no-invented-write-endpoint
// discipline the ticket calls for.
//
// SAME in-memory-first / optional-pgPool PATTERN AS CaseStore / AuditLogger
// / AmendmentStore / DossierStore: tests/demo/the seeded CLI never touch a
// database; `npm run uc05-api` uses real Supabase when SUPABASE_DB_URL is
// configured. createResignation() is fire-and-forget for the same reason
// the others are (a decision is already made and audited by the time this
// is called; nothing downstream depends on the row landing before this
// call returns). recordSignoff() / markDenied() are awaited and let
// failures throw, same asymmetry as every other store: each one IS the
// record that a human authorised the prepared report, so a silent failure
// there would be worse than an error surfaced to the caller.
// ---------------------------------------------------------------------------

import { randomUUID } from "node:crypto";
import { matchesOwner } from "../shared/ownerScope.js";
import { canonicalDecisionStatus } from "../shared/declineVocabulary.js";

const SELECT_COLUMNS = `
  id,
  created_at                 as "createdAt",
  updated_at                 as "updatedAt",
  employment_id               as "employmentId",
  requester,
  letter_extraction           as "letterExtraction",
  notice                      as "notice",
  payout                      as "payout",
  decision,
  reason,
  flags,
  status,
  signed_off_by               as "signedOffBy",
  signed_off_note             as "signedOffNote",
  signed_off_at               as "signedOffAt",
  -- The COLUMN keeps its name, the FIELD does not: see the same note in
  -- src/uc04/authorizationStore.js. Renaming a physical column would be a
  -- mandatory migration; aliasing is free and needs nobody to run SQL.
  denied_by                   as "declinedBy",
  external_ref                as "externalRef",
  source`;

export class ResignationStore {
  /**
   * @param {object} [opts]
   * @param {import("pg").Pool|null} [opts.pgPool]  when set, also writes to
   *   Supabase's `uc05_resignations` table
   */
  constructor({ pgPool = null } = {}) {
    this.pgPool = pgPool;
    this.resignations = [];
    this.pending = [];
  }

  #track(promise, label) {
    const guarded = promise.catch((err) => {
      console.error(`[uc05] failed to write ${label} to Supabase: ${err.message}`);
    });
    this.pending.push(guarded);
  }

  /**
   * One row per resignation request — the prepared discrepancy report and
   * (later) the HR Ops sign-off slot.
   * @param {object} args
   * @returns {object} the created resignation row
   */
  createResignation({
    employmentId,
    requester,
    letterExtraction = null,
    notice = null,
    payout = null,
    decision,
    reason = null,
    flags = [],
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
      letterExtraction,
      notice,
      payout,
      decision,
      reason,
      flags,
      // "pending_signoff" is the only status this store's sign-off flow
      // acts on. Anything escalated (UC-05.md §8: "Statutory discrepancy ->
      // escalate to the local HR/Legal desk") stays informational, with no buttons
      // and no sign-off path here — same shape as UC-01's "escalations are
      // visible, never actionable" rule.
      status: decision === "prepared_for_signoff" ? "pending_signoff" : "escalated",
      signedOffBy: null,
      signedOffNote: null,
      signedOffAt: null,
      declinedBy: null,
      externalRef,
      source,
    };
    this.resignations.push(row);

    if (this.pgPool) {
      const insertPromise = this.pgPool.query(
        `insert into uc05_resignations
           (id, created_at, updated_at, employment_id, requester, letter_extraction, notice, payout,
            decision, reason, flags, status, external_ref, source)
         values ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8::jsonb,$9,$10,$11::jsonb,$12,$13,$14)`,
        [
          row.id,
          row.createdAt,
          row.updatedAt,
          row.employmentId,
          row.requester,
          row.letterExtraction ? JSON.stringify(row.letterExtraction) : null,
          row.notice ? JSON.stringify(row.notice) : null,
          row.payout ? JSON.stringify(row.payout) : null,
          row.decision,
          row.reason,
          JSON.stringify(row.flags ?? []),
          row.status,
          row.externalRef,
          row.source,
        ]
      );
      this.#track(insertPromise, `resignation ${row.id}`);
    }
    return row;
  }

  /** @param {string} id */
  async findById(id) {
    const local = this.resignations.find((r) => r.id === id);
    if (local) return local;
    if (!this.pgPool) return null;
    const result = await this.pgPool.query(`select ${SELECT_COLUMNS} from uc05_resignations where id = $1`, [id]);
    return result.rows[0] ? normalizeRow(result.rows[0]) : null;
  }

  /**
   * Newest resignation for a Zendesk ticket / external reference. Same
   * "newest, not the only one" reasoning as UC-01/UC-06/UC-08's stores.
   * @param {string} externalRef
   */
  async findByExternalRef(externalRef) {
    const localMatches = this.resignations.filter((r) => String(r.externalRef) === String(externalRef));
    if (localMatches.length) return localMatches[localMatches.length - 1];
    if (!this.pgPool) return null;
    const result = await this.pgPool.query(
      `select ${SELECT_COLUMNS} from uc05_resignations where external_ref = $1 order by created_at desc limit 1`,
      [String(externalRef)]
    );
    return result.rows[0] ? normalizeRow(result.rows[0]) : null;
  }

  /**
   * Attach a Zendesk ticket id as this resignation's externalRef — the
   * by-ticket lookup the ZAF sidebar uses to find it. Called AFTER the ticket
   * exists, because the gates run first and the ticket is created from their
   * outcome, so the row necessarily predates the id. Same method and same
   * reasoning as uc04/authorizationStore.js's.
   * @param {string} id
   * @param {string} externalRef
   */
  async linkTicket(id, externalRef) {
    const now = new Date().toISOString();
    const local = this.resignations.find((r) => r.id === id);
    if (local) {
      local.externalRef = String(externalRef);
      local.updatedAt = now;
    }
    if (this.pgPool) {
      await this.pgPool.query(`update uc05_resignations set external_ref = $2, updated_at = $3 where id = $1`, [
        id,
        String(externalRef),
        now,
      ]);
    }
    return this.findById(id);
  }

  /**
   * Record the HR Ops sign-off on a prepared report. Does not itself
   * decide whether the action is permitted — see signoffPolicy.js (the
   * same "policy vs storage" split review/dualApprovalPolicy.js draws).
   * @param {string} id
   * @param {string} approver
   * @param {string|null} note
   */
  async recordSignoff(id, approver, note) {
    const now = new Date().toISOString();
    const slot = { approver, note: note || null, at: now };

    const local = this.resignations.find((r) => r.id === id);
    if (local) {
      local.signedOffBy = slot;
      local.status = "signed_off";
      local.updatedAt = now;
    }
    if (this.pgPool) {
      await this.pgPool.query(
        `update uc05_resignations set signed_off_by = $2::jsonb, status = 'signed_off', updated_at = $3 where id = $1`,
        [id, JSON.stringify(slot), now]
      );
    }
    return this.findById(id);
  }

  /**
   * @param {string} id
   * @param {string} approver
   * @param {string|null} note
   */
  async markDeclined(id, approver, note) {
    const now = new Date().toISOString();
    const declinedBy = { approver, note: note || null, at: now };

    const local = this.resignations.find((r) => r.id === id);
    if (local) {
      local.status = "declined";
      local.declinedBy = declinedBy;
      local.updatedAt = now;
    }
    if (this.pgPool) {
      await this.pgPool.query(
        `update uc05_resignations set status = 'declined', denied_by = $2::jsonb, updated_at = $3 where id = $1`,
        [id, JSON.stringify(declinedBy), now]
      );
    }
    return this.findById(id);
  }

  /**
   * The resignation records ONE requester owns, newest first — the read behind the
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
      return this.resignations
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
      `select ${SELECT_COLUMNS} from uc05_resignations where ${conditions.join(" and ")} order by created_at desc limit $${params.length}`,
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
   * Every resignation, newest first — the HR Ops queue.
   *
   * This used to return `[...this.resignations].reverse()`: this process's
   * memory only, while `GET /api/resignations` advertised it as "every
   * processed resignation, newest first". On the Vercel deployment a process's
   * memory lasts one request, so the route answered `{resignations: []}` while
   * `uc05_resignations` held real rows (checked live 2026-08-19).
   *
   * That is not cosmetic for a 🟡 use case. A `prepared_for_signoff` report is
   * waiting on a named human, and this route is the only way to find one
   * without already holding its id or its ticket ref — which is to say, the
   * only way to answer "what is waiting for me?". An HR Ops specialist opening
   * the queue saw an empty list and concluded there was nothing to sign off.
   *
   * `flush()` first because createResignation() is fire-and-forget; it writes
   * to memory and Postgres both, so reading Postgres alone returns each row
   * once rather than twice.
   *
   * @param {object} [opts]
   * @param {number} [opts.limit] newest N — an unbounded queue response is its
   *   own outage.
   */
  async list({ limit = 200 } = {}) {
    if (!this.pgPool) return [...this.resignations].reverse();
    await this.flush();
    const result = await this.pgPool.query(
      `select ${SELECT_COLUMNS} from uc05_resignations order by created_at desc limit $1`,
      [limit]
    );
    return result.rows.map(normalizeRow);
  }
}

/**
 * Coerce jsonb columns that some driver/column combinations hand back as a
 * JSON string rather than a parsed object — same reasoning and same fix as
 * uc06/amendmentStore.js's normalizeRow().
 */
function normalizeRow(row) {
  return {
    ...row,
    letterExtraction: coerceJson(row.letterExtraction, null),
    notice: coerceJson(row.notice, null),
    payout: coerceJson(row.payout, null),
    flags: coerceJson(row.flags, []),
    signedOffBy: coerceJson(row.signedOffBy, null),
    // The one place a Postgres row becomes an in-memory row — so the legacy
    // `denied` status is canonicalised here and nowhere else.
    status: canonicalDecisionStatus(row.status),
    declinedBy: coerceJson(row.declinedBy, null),
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
