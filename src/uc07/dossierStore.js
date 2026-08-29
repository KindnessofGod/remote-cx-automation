// ---------------------------------------------------------------------------
// dossierStore.js  —  UC-07 operational state: feasibility dossiers, write-once
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
// Same motivation as uc08/dossierStore.js: before this file, a relocation
// dossier was computed, audited, and thrown away — nothing could look one up
// later (by a ZAF panel, a specialist re-opening the ticket, or the API below)
// without re-running the whole review. This store fixes that WITHOUT weakening
// UC-07's headline guarantee: it has exactly one write method (createDossier)
// and zero mutation methods. There is no approve, no deny, no markExecuted, no
// status column to flip — a dossier is created once and only ever read again.
// That is the same "removing the parameter removes the bug's precondition"
// reasoning workflow.js's header applies to `remote`/`zendesk`, applied to the
// STORE's own surface area instead of the workflow's dependency list.
//
// SAME in-memory-first / optional-pgPool pattern as every other store in this
// repo: createDossier() is fire-and-forget (nothing downstream depends on the
// row landing before this call returns — it records a decision already made
// and audited); findById()/findByExternalRef() are async and check local
// memory first, then Postgres, because the API server can run as a separate
// process from whatever created the dossier.
//
// The `uc07_dossiers` Supabase table is provisioned by a human per
// docs/SETUP-CHECKLIST.md — this module only ever writes rows to it, never
// creates it.
// ---------------------------------------------------------------------------

import { randomUUID } from "node:crypto";
import { matchesOwner } from "../shared/ownerScope.js";

const SELECT_COLUMNS = `
  id,
  created_at        as "createdAt",
  employment_id      as "employmentId",
  external_ref       as "externalRef",
  source,
  relocation_type    as "relocationType",
  source_country     as "sourceCountry",
  destination_country as "destinationCountry",
  dossier`;

export class DossierStore {
  /**
   * @param {object} [opts]
   * @param {import("pg").Pool|null} [opts.pgPool]  when set, also writes to
   *   Supabase's `uc07_dossiers` table
   */
  constructor({ pgPool = null } = {}) {
    this.pgPool = pgPool;
    this.dossiers = [];
    this.pending = [];
  }

  #track(promise, label) {
    const guarded = promise.catch((err) => {
      console.error(`[uc07] failed to write ${label} to Supabase: ${err.message}`);
    });
    this.pending.push(guarded);
  }

  /**
   * One row per relocation request — the full feasibility dossier UC-07 built,
   * kept for later lookup. Fire-and-forget: the workflow has already logged and
   * returned by the time this is called.
   * @param {object} args
   * @returns {object} the created dossier row
   */
  createDossier({ employmentId = null, externalRef = null, source = null, relocationType, sourceCountry, destinationCountry, dossier }) {
    const row = {
      id: randomUUID(),
      createdAt: new Date().toISOString(),
      employmentId,
      externalRef,
      source,
      relocationType,
      sourceCountry,
      destinationCountry,
      dossier,
    };
    this.dossiers.push(row);

    if (this.pgPool) {
      const insertPromise = this.pgPool.query(
        `insert into uc07_dossiers
           (id, created_at, employment_id, external_ref, source, relocation_type, source_country, destination_country, dossier)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)`,
        [
          row.id,
          row.createdAt,
          row.employmentId,
          row.externalRef,
          row.source,
          row.relocationType,
          row.sourceCountry,
          row.destinationCountry,
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
    const result = await this.pgPool.query(`select ${SELECT_COLUMNS} from uc07_dossiers where id = $1`, [id]);
    return result.rows[0] ? normalizeRow(result.rows[0]) : null;
  }

  /**
   * Newest dossier for a ticket — a ticket could in principle generate more
   * than one review over time.
   * @param {string} externalRef
   */
  async findByExternalRef(externalRef) {
    const localMatches = this.dossiers.filter((d) => String(d.externalRef) === String(externalRef));
    if (localMatches.length) return localMatches[localMatches.length - 1];
    if (!this.pgPool) return null;
    const result = await this.pgPool.query(
      `select ${SELECT_COLUMNS} from uc07_dossiers where external_ref = $1 order by created_at desc limit 1`,
      [String(externalRef)]
    );
    return result.rows[0] ? normalizeRow(result.rows[0]) : null;
  }

  /**
   * The dossiers about ONE employment, newest first — the read behind the
   * portal's "My requests" (src/portal/server.js).
   *
   * DOES THIS PUT A HOLE IN "NO EXECUTION PATH"? NO — and the question is
   * worth answering out loud rather than leaving a reader to wonder.
   * This store's guarantee is one write method and zero mutations. This method
   * is a READ: it takes no id to act on, it changes nothing, and it is the
   * same kind of addition findById(), findByExternalRef() and list() already
   * are (list()'s own header makes the identical point). The WRITE surface is
   * untouched — still createDossier(), still nothing that can alter a row once
   * written.
   *
   * What the portal does with the result keeps the tier visible: a UC-07
   * dossier reports `no_decision_path`, never "awaiting review", because
   * src/portal/requestStatus.js knows nothing inside this system is waiting on
   * anybody. Showing a requester where their dossier went is not a decision
   * path; it is the opposite — it is how they learn that the automation
   * deliberately stopped.
   *
   * NO `requester` COLUMN EXISTS HERE — a dossier records the employment it is
   * about and nothing about who asked — so a requester-scoped ask matches
   * nothing, and saying so beats ignoring the filter, which would widen the
   * scope instead of narrowing it.
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
    let sql = `select ${SELECT_COLUMNS} from uc07_dossiers where employment_id = $1`;
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
   * Every dossier, newest first — and the only way to find one without
   * already knowing its id.
   *
   * WHY THIS READS POSTGRES NOW, AND WHY IT IS THE MOST IMPORTANT READ HERE.
   * This used to be `return [...this.dossiers].reverse()` — this process's
   * memory and nothing else — while `GET /api/dossiers` advertised it as
   * "every dossier built". On the Vercel deployment a process's memory lasts
   * exactly one request, so the route answered `{dossiers: []}` while
   * `uc07_dossiers` held real rows (five of them, checked live 2026-08-19).
   *
   * For this use case in particular that closed the last door. UC-07 is 🔴 and
   * its dossier IS the deliverable — a Mobility Legal Tier-3 specialist has to
   * read it. Ask how one reaches them and every route was shut:
   *   - `by-ticket` needs a Zendesk ticket, and the portal deliberately creates
   *     none for UC-07 (src/portal/ticketing.js explains why, and is right to);
   *   - `findById` needs an id that only the submitter ever saw;
   *   - `list` was this, and returned nothing.
   * So a dossier was compiled, audited, durably stored — and unreachable by the
   * one person it was compiled for. The record existing and the record being
   * findable are different claims, and only the first was ever tested.
   *
   * `flush()` first so rows this process wrote fire-and-forget are in the table
   * before it is read; createDossier() writes to both memory and Postgres, so
   * reading Postgres alone returns each row exactly once rather than twice.
   *
   * Still a plain read — no mutation, and the "one write method, zero
   * mutations" guarantee in this file's header is untouched.
   *
   * @param {object} [opts]
   * @param {number} [opts.limit] newest N, so a growing table cannot become an
   *   unbounded response.
   */
  async list({ limit = 200 } = {}) {
    if (!this.pgPool) return [...this.dossiers].reverse();
    await this.flush();
    const result = await this.pgPool.query(
      `select ${SELECT_COLUMNS} from uc07_dossiers order by created_at desc limit $1`,
      [limit]
    );
    return result.rows.map(normalizeRow);
  }
}

/** Coerce jsonb columns some driver/column combinations hand back as a JSON string. */
function normalizeRow(row) {
  return {
    ...row,
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
