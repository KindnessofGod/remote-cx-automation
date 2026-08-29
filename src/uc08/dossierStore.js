// ---------------------------------------------------------------------------
// dossierStore.js  —  UC-08 operational state: dossiers, write-once
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
// Until this file, handleTaxInquiry() computed a dossier and immediately threw
// it away except for what landed in the audit log — there was no way to look
// one up later (by a ZAF panel, a specialist re-opening the ticket, or the
// API below) without re-running the whole inquiry. This store fixes that
// WITHOUT weakening UC-08's headline guarantee: it has exactly one write
// method (createDossier) and zero mutation methods. There is no approve, no
// deny, no markExecuted, no status column to flip — a dossier is created once
// and only ever read again. That is not an oversight; it is the same
// "removing the parameter removes the bug's precondition" reasoning
// workflow.js's own header applies to `remote`/`zendesk` — here applied to the
// STORE's own surface area instead of the workflow's dependency list.
//
// SAME in-memory-first / optional-pgPool pattern as AmendmentStore/CaseStore:
// createDossier() is fire-and-forget (same reasoning as AuditLogger.log() /
// CaseStore.createCase() — it records a decision already made and audited;
// nothing downstream depends on the row landing before this call returns).
// findById()/findByExternalRef() are async and check local memory first, then
// Postgres, because the API server can run as a separate process from
// whatever created the dossier.
// ---------------------------------------------------------------------------

import { randomUUID } from "node:crypto";
import { matchesOwner } from "../shared/ownerScope.js";

const SELECT_COLUMNS = `
  id,
  created_at        as "createdAt",
  employment_id      as "employmentId",
  external_ref       as "externalRef",
  source,
  inquiry_type        as "inquiryType",
  jurisdictions,
  presence_days       as "presenceDays",
  dossier`;

export class DossierStore {
  /**
   * @param {object} [opts]
   * @param {import("pg").Pool|null} [opts.pgPool]  when set, also writes to
   *   Supabase's `uc08_dossiers` table
   */
  constructor({ pgPool = null } = {}) {
    this.pgPool = pgPool;
    this.dossiers = [];
    this.pending = [];
  }

  #track(promise, label) {
    const guarded = promise.catch((err) => {
      console.error(`[uc08] failed to write ${label} to Supabase: ${err.message}`);
    });
    this.pending.push(guarded);
  }

  /**
   * One row per tax inquiry — the full dossier UC-08 built, kept for later
   * lookup. Fire-and-forget: the workflow has already logged and returned by
   * the time this is called, so nothing waits on it landing.
   * @param {object} args
   * @returns {object} the created dossier row
   */
  createDossier({ employmentId = null, externalRef = null, source = null, inquiryType, jurisdictions, presenceDays, dossier }) {
    const row = {
      id: randomUUID(),
      createdAt: new Date().toISOString(),
      employmentId,
      externalRef,
      source,
      inquiryType,
      jurisdictions,
      presenceDays,
      dossier,
    };
    this.dossiers.push(row);

    if (this.pgPool) {
      const insertPromise = this.pgPool.query(
        `insert into uc08_dossiers
           (id, created_at, employment_id, external_ref, source, inquiry_type, jurisdictions, presence_days, dossier)
         values ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9::jsonb)`,
        [
          row.id,
          row.createdAt,
          row.employmentId,
          row.externalRef,
          row.source,
          row.inquiryType,
          JSON.stringify(row.jurisdictions ?? []),
          row.presenceDays ? JSON.stringify(row.presenceDays) : null,
          JSON.stringify(row.dossier ?? {}),
        ]
      );
      this.#track(insertPromise, `dossier ${row.id}`);
    }
    return row;
  }

  /** @param {string} id */
  async findById(id) {
    const local = this.dossiers.find((d) => d.id === id);
    if (local) return local;
    if (!this.pgPool) return null;
    const result = await this.pgPool.query(`select ${SELECT_COLUMNS} from uc08_dossiers where id = $1`, [id]);
    return result.rows[0] ? normalizeRow(result.rows[0]) : null;
  }

  /**
   * Newest dossier for a ticket — a ticket could in principle generate more
   * than one inquiry over time, same "newest, not the only one" reasoning as
   * the UC-01/UC-06 stores.
   * @param {string} externalRef
   */
  async findByExternalRef(externalRef) {
    const localMatches = this.dossiers.filter((d) => String(d.externalRef) === String(externalRef));
    if (localMatches.length) return localMatches[localMatches.length - 1];
    if (!this.pgPool) return null;
    const result = await this.pgPool.query(
      `select ${SELECT_COLUMNS} from uc08_dossiers where external_ref = $1 order by created_at desc limit 1`,
      [String(externalRef)]
    );
    return result.rows[0] ? normalizeRow(result.rows[0]) : null;
  }

  /**
   * The dossiers about ONE employment, newest first — the read behind the
   * portal's "My requests" (src/portal/server.js).
   *
   * DOES THIS PUT A HOLE IN "NO EXECUTION PATH"? NO, AND IT IS WORTH SAYING SO
   * RATHER THAN LEAVING A READER TO WORK IT OUT.
   * This file's headline guarantee is "exactly one write method, zero
   * mutations" — there is no approve, no deny, no markExecuted, no status
   * column to flip. This method adds a READ. It takes no id to act on, returns
   * copies of rows, and changes nothing; it is the same kind of addition
   * findById(), findByExternalRef() and list() already are, and list()'s own
   * comment makes the identical point. The guarantee is about the store's
   * WRITE surface, and that surface is unchanged: still one method, still
   * createDossier(), still nothing that can alter a row once written.
   *
   * The portal side is where the 🔴 tier is actually visible: a dossier listed
   * through this method reports `no_decision_path`, not "awaiting review",
   * because src/portal/requestStatus.js knows there is no human decision for
   * it to be waiting on and never will be. Listing it tells the requester
   * where their dossier went; it does not offer them, or anyone, a way to
   * decide it.
   *
   * NO `requester` COLUMN EXISTS HERE. A dossier records the employment it is
   * ABOUT and nothing about who asked, so a requester-scoped ask matches
   * nothing — and returning nothing says that, where ignoring the filter would
   * silently widen the scope to every dossier for that employment.
   *
   * @param {object} scope
   * @param {string|null} [scope.employmentId]
   * @param {string|null} [scope.requester]
   * @param {string|null} [scope.source]  e.g. "portal"
   * @param {number} [scope.limit]
   * @returns {Promise<object[]>}
   */
  async listByOwner({ employmentId = null, requester = null, source = null, limit = 50 } = {}) {
    // Fail closed: an unscoped call lists nobody's rows, never everybody's.
    if (!employmentId) return [];
    if (requester) return []; // see the header above
    if (!this.pgPool) {
      return this.dossiers.filter((d) => matchesOwner(d, { employmentId, source })).slice().reverse().slice(0, limit);
    }
    await this.flush();
    const params = [String(employmentId)];
    let sql = `select ${SELECT_COLUMNS} from uc08_dossiers where employment_id = $1`;
    if (source) {
      params.push(String(source));
      sql += ` and source = $${params.length}`;
    }
    params.push(limit);
    sql += ` order by created_at desc limit $${params.length}`;
    const result = await this.pgPool.query(sql, params);
    return result.rows.map(normalizeRow);
  }

  /** Await any DB writes still in flight — call before reading rows back. */
  async flush() {
    await Promise.allSettled(this.pending);
    this.pending = [];
  }

  /**
   * All dossiers created in THIS process, newest first — the source for a
   * dashboard queue. Same in-memory-only scope as ExpenseStore.list(). A
   * plain list read, same as findById/findByExternalRef — it does not
   * weaken the "one write method, zero mutations" guarantee this store's
   * header describes.
   */
  list() {
    return [...this.dossiers].reverse();
  }
}

/** Coerce jsonb columns some driver/column combinations hand back as a JSON string. */
function normalizeRow(row) {
  return {
    ...row,
    jurisdictions: coerceJson(row.jurisdictions, []),
    presenceDays: coerceJson(row.presenceDays, null),
    dossier: coerceJson(row.dossier, {}),
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
