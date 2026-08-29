// ---------------------------------------------------------------------------
// expenseStore.js  —  UC-02 operational state (processed expense submissions)
// ---------------------------------------------------------------------------
// IN-MEMORY FIRST, WITH AN OPTIONAL SUPABASE pgPool — same pattern as every
// other store in this repo (caseStore.js, uc04/authorizationStore.js,
// uc05/resignationStore.js, uc06/amendmentStore.js, uc07+uc08/dossierStore.js,
// uc09/adjustmentStore.js). Unconfigured it behaves exactly as it always did,
// which is what keeps `npm test` and a fresh clone hermetic.
//
// WHAT THIS HEADER USED TO SAY, AND WHY THAT MATTERS MORE THAN THE FIX
// It said, in good faith: "no `uc02_expenses` schema has been verified or
// created in the Supabase project", and therefore this store is in-memory
// only. **The table existed.** It was provisioned in project
// your-project-ref with the seventeen columns this file wrote at the time,
// RLS enabled and zero policies like every other table — and, tellingly, with two
// non-primary-key indexes that exist for no other purpose than the two lookups
// below: `uc02_expenses_receipt_hash_idx` and `uc02_expenses_external_ref_idx`.
// Somebody provisioned the storage for this store's read-through and the store
// was never pointed at it. A comment stating a fact about infrastructure ages
// silently: nothing fails, no test goes red, and the expense keeps propagating
// (it had been copied into src/portal/wiring.js, workflows/README.md,
// docs/use-cases/UC-02.md and deploy/cx-apis/README.md by the time it was
// caught). The lesson is written up in docs/BUILD-LOG.md §3.35.
//
// THE CONSEQUENCE THAT WAS NOT MERELY "A ROW IS MISSING"
// In a serverless function, in-process memory lasts exactly one request. So
// `findByReceiptHash` — the §7 duplicate-receipt gate — returned null on EVERY
// call on the deployed portal. The gate was not refusing correctly; it was
// structurally incapable of firing. That is the same failure class this repo
// keeps recording (CLAUDE.md §4/§5): a gate that cannot reach its outcome is
// indistinguishable from a healthy one under any negative test, because
// "correctly found no duplicate" and "cannot find a duplicate" produce the
// identical output. Only a POSITIVE test detects it — submit the same receipt
// twice, and the second MUST be blocked. That test now exists
// (`test/uc02Persistence.test.js`) and it fails against the old store.
//
// WHICH HASH IS PERSISTED, AND THE ONE CASE THAT STILL NEEDS A COLUMN
// A row carries two dedupe keys: the hash the submitter supplied
// (`receiptHash`, optional) and the fingerprint derived server-side from the
// expense record's own fields (`derivedReceiptHash`, finding F-24 — always
// present, deliberately excluding the expense id so two different expense
// records carrying one receipt collide). The table has ONE hash column, so the
// persisted value is `derivedReceiptHash ?? receiptHash` and the read-through
// matches BOTH candidates against it.
//
// Derived-preferred rather than submitted-preferred because it is the only
// choice that is SYMMETRIC: the derived fingerprint is a pure function of the
// expense record, so two filings of one expense persist the same key whether
// either of them supplied a hash or not. Submitted-preferred would make
// duplicate detection depend on which of the two expenses happened to arrive
// first, and an order-dependent control is worse than one with a named gap.
// The persisted value is self-labelling (`deriveReceiptFingerprint` prefixes
// `derived:`), so a row read back is split into the right field again rather
// than mislabelled — see normalizeRow().
//
// The named gap: cross-process, two expenses whose RECORD FIELDS differ (so the
// derived fingerprints differ) but which carry the same submitter-supplied
// receipt hash are not matched. In-process they still are. Closing it is a
// provisioning step, not a code change — a `derived_receipt_hash text` column
// plus an index, after which `receipt_hash` holds the submitted hash and both
// are queried. Written up in docs/SETUP-CHECKLIST.md rather than applied here,
// following this repo's convention that tables are human-provisioned and the
// code only ever reads and writes them.
//
// NO MONEY IS PERSISTED HERE, ON PURPOSE. The twenty-one columns carry the
// decision, the classification and the ids — never an amount. UC-02's figures
// are ×100-scaled integers (src/shared/money.js) that live on the Remote
// record and in the audit row, and a value that never round-trips through this
// layer can never be rescaled by it.
//
// Fire-and-forget vs. awaited: createExpense() records the row in memory
// synchronously and lets the INSERT run in the background (the decision is
// already made; nothing downstream needs the row to have landed), exactly as
// the sibling stores do. markAutoApproved() is awaited because it carries the
// result of the real Remote write. It flushes first: unlike the siblings —
// whose later mutation arrives in a separate request — this one fires
// microseconds after the INSERT in the SAME request, so without the flush the
// UPDATE can overtake its own INSERT and silently match zero rows.
// markReviewed()/recordReviewWrite() — the Finance Ops slot added with §6's
// review flow — are awaited and flush for exactly the same reason.
// ---------------------------------------------------------------------------

import { randomUUID } from "node:crypto";
import { matchesOwner } from "../shared/ownerScope.js";
import { canonicalStatus, normalizeAction } from "./reviewPolicy.js";

/**
 * The twenty-one real columns of `uc02_expenses`, aliased to the camelCase
 * field names the in-memory row uses, so a row read back from Postgres is
 * shaped like a row that never left. `receipt_hash` is selected under a
 * neutral name and split by normalizeRow() — see the header.
 */
const SELECT_COLUMNS = `
  id,
  created_at        as "createdAt",
  updated_at        as "updatedAt",
  expense_id        as "expenseId",
  employment_id     as "employmentId",
  receipt_hash      as "storedReceiptHash",
  decision,
  reason,
  flags,
  category_id       as "categoryId",
  category_source   as "categorySource",
  confidence,
  external_ref      as "externalRef",
  source,
  status,
  auto_approved_at  as "autoApprovedAt",
  remote_result     as "remoteResult",
  review_action     as "reviewAction",
  reviewer,
  review_note       as "reviewNote",
  reviewed_at       as "reviewedAt",
  decision_evidence as "decisionEvidence"`;

export class ExpenseStore {
  /**
   * @param {object} [opts]
   * @param {import("pg").Pool|null} [opts.pgPool]  when set, rows are also
   *   written to Supabase's `uc02_expenses` table and every per-row lookup
   *   falls through to it on a miss — which is what makes the store work in a
   *   serverless function, where memory lasts one request.
   */
  constructor({ pgPool = null } = {}) {
    this.pgPool = pgPool;
    this.expenses = [];
    this.pending = [];
  }

  #track(promise, label) {
    const guarded = promise.catch((err) => {
      console.error(`[uc02] failed to write ${label} to Supabase: ${err.message}`);
    });
    this.pending.push(guarded);
  }

  /**
   * One row per expense submission — the decision, the classification that
   * fed it, and the state derived from it.
   * @param {object} args
   * @returns {object} the created row
   */
  createExpense({
    expenseId,
    employmentId,
    receiptHash = null,
    derivedReceiptHash = null,
    decision,
    reason,
    flags,
    categoryId = null,
    categorySource = null,
    confidence = null,
    externalRef = null,
    source = null,
    decisionEvidence = null,
  }) {
    const now = new Date().toISOString();
    const row = {
      id: randomUUID(),
      createdAt: now,
      updatedAt: now,
      expenseId,
      employmentId,
      receiptHash,
      derivedReceiptHash,
      receiptHashSource: receiptHash ? "submitted" : "derived",
      decision,
      reason,
      flags,
      categoryId,
      categorySource,
      confidence,
      externalRef,
      source,
      status: statusFor(decision),
      autoApprovedAt: null,
      remoteResult: null,
      // The Finance Ops review slot (§6). Empty until a named specialist
      // approves, declines or holds the expense — see reviewPolicy.js.
      reviewAction: null,
      reviewer: null,
      reviewNote: null,
      reviewedAt: null,
      // THE FIGURES THE GATES COMPARED (`captureEvidence()` in policyEngine.js).
      //
      // Raw readings only — amounts, currency codes, counts, the duplicate's ids
      // — never the sentences derived from them, so improving an explanation
      // improves every historical row instead of only future ones. Nullable and
      // additive: a row written before the column existed reads back as `null`,
      // which `describeDecisionFacts()` answers with an absent bundle rather
      // than a bundle of blanks.
      decisionEvidence,
    };
    this.expenses.push(row);

    if (this.pgPool) {
      const insertPromise = this.pgPool.query(
        `insert into uc02_expenses
           (id, created_at, updated_at, expense_id, employment_id, receipt_hash,
            decision, reason, flags, category_id, category_source, confidence,
            external_ref, source, status, auto_approved_at, remote_result,
            decision_evidence)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12,$13,$14,$15,$16,$17::jsonb,
                 $18::jsonb)`,
        [
          row.id,
          row.createdAt,
          row.updatedAt,
          row.expenseId,
          row.employmentId,
          dedupeKey(row),
          row.decision,
          row.reason,
          JSON.stringify(row.flags ?? []),
          row.categoryId,
          row.categorySource,
          row.confidence,
          row.externalRef,
          row.source,
          row.status,
          row.autoApprovedAt,
          row.remoteResult ? JSON.stringify(row.remoteResult) : null,
          row.decisionEvidence ? JSON.stringify(row.decisionEvidence) : null,
        ]
      );
      this.#track(insertPromise, `expense ${row.id}`);
    }
    return row;
  }

  /** @param {string} id */
  async findById(id) {
    const local = this.expenses.find((row) => row.id === id);
    if (local) return local;
    if (!this.pgPool) return null;
    const result = await this.pgPool.query(`select ${SELECT_COLUMNS} from uc02_expenses where id = $1`, [id]);
    return result.rows[0] ? normalizeRow(result.rows[0]) : null;
  }

  /**
   * The most recent row for a given expense id — the delivery-level replay
   * check in workflow.js. Reads through, because a redelivered webhook very
   * often lands on a different process than the first delivery did.
   * @param {string} expenseId
   */
  async findByExpenseId(expenseId) {
    const matches = this.expenses.filter((row) => row.expenseId === expenseId);
    if (matches.length) return matches[matches.length - 1];
    if (!this.pgPool) return null;
    const result = await this.pgPool.query(
      `select ${SELECT_COLUMNS} from uc02_expenses where expense_id = $1 order by created_at desc limit 1`,
      [String(expenseId)]
    );
    return result.rows[0] ? normalizeRow(result.rows[0]) : null;
  }

  /**
   * The most recent row tied to a Zendesk ticket (externalRef) — what the
   * `GET /api/expenses/by-ticket/:ref` lookup serves. "Newest, not the only
   * one", same reasoning as UC-01/UC-05/UC-06's stores.
   * @param {string} externalRef
   */
  async findByExternalRef(externalRef) {
    const matches = this.expenses.filter((row) => String(row.externalRef) === String(externalRef));
    if (matches.length) return matches[matches.length - 1];
    if (!this.pgPool) return null;
    const result = await this.pgPool.query(
      `select ${SELECT_COLUMNS} from uc02_expenses where external_ref = $1 order by created_at desc limit 1`,
      [String(externalRef)]
    );
    return result.rows[0] ? normalizeRow(result.rows[0]) : null;
  }

  /**
   * The §7 duplicate-hash lookup, and the reason this store needed a pool at
   * all. Returns the EARLIEST previously-processed expense carrying the same
   * receipt hash — matching either the hash the submitter supplied or the
   * fingerprint derived server-side (finding F-24), so an expense filed once with
   * a hash and once without still collides.
   *
   * Reads through to Postgres on a memory miss. Without that the gate could
   * only ever see expenses decided inside this one process, which on a
   * serverless deployment means none at all.
   * @param {string|null} receiptHash
   */
  async findByReceiptHash(receiptHash) {
    if (!receiptHash) return null;
    const local = this.expenses.find(
      (row) => row.receiptHash === receiptHash || row.derivedReceiptHash === receiptHash
    );
    if (local) return local;
    if (!this.pgPool) return null;
    // Earliest, not newest: §7's answer is "which expense was this one a
    // duplicate OF", and that is the first one filed.
    const result = await this.pgPool.query(
      `select ${SELECT_COLUMNS} from uc02_expenses where receipt_hash = $1 order by created_at asc limit 1`,
      [receiptHash]
    );
    return result.rows[0] ? normalizeRow(result.rows[0]) : null;
  }

  /**
   * Record the outcome of the real Remote approval write.
   * @param {string} id
   * @param {object} remoteResult
   */
  async markAutoApproved(id, remoteResult) {
    const now = new Date().toISOString();
    const local = this.expenses.find((r) => r.id === id);
    if (local) {
      local.status = "auto_approved";
      local.autoApprovedAt = now;
      local.remoteResult = remoteResult;
      local.updatedAt = now;
    }
    if (this.pgPool) {
      // See the header: this UPDATE fires in the same request as its own
      // background INSERT, so it must not be allowed to overtake it.
      await this.flush();
      await this.pgPool.query(
        `update uc02_expenses
            set status = 'auto_approved', auto_approved_at = $2, remote_result = $3::jsonb, updated_at = $2
          where id = $1`,
        [id, now, remoteResult ? JSON.stringify(remoteResult) : null]
      );
    }
    return this.findById(id);
  }

  /**
   * Attach a Zendesk ticket id as this expense's externalRef — the by-ticket
   * lookup the ZAF sidebar uses to find it. Called AFTER the ticket exists,
   * because the gates run first and the ticket is created from their outcome
   * (00-FOUNDATION.md §2's trigger-source model), so the row necessarily
   * predates the id. Same method, same reasoning, as
   * uc04/authorizationStore.js and uc06/amendmentStore.js.
   *
   * NOT the idempotency key. The claim in `workflow_claims` was taken under
   * whatever ref the request carried, before this row existed; re-pointing
   * `external_ref` here changes where the sidebar looks it up and nothing
   * about what has already been claimed.
   *
   * @param {string} id
   * @param {string} externalRef
   */
  async linkTicket(id, externalRef) {
    const now = new Date().toISOString();
    const local = this.expenses.find((r) => r.id === id);
    if (local) {
      local.externalRef = String(externalRef);
      local.updatedAt = now;
    }
    if (this.pgPool) {
      // Flush first, for the reason markAutoApproved() records: this UPDATE
      // can fire in the same request as its own background INSERT.
      await this.flush();
      await this.pgPool.query(`update uc02_expenses set external_ref = $2, updated_at = $3 where id = $1`, [
        id,
        String(externalRef),
        now,
      ]);
    }
    return this.findById(id);
  }

  /**
   * Record a Finance Ops specialist's verdict on a flagged expense (§6).
   *
   * TWO MUTATIONS, NOT ONE, and the split is the same one UC-04 makes between
   * recordApproval() and markExecuted(): this method records WHO DECIDED and
   * WHAT THEY DECIDED, and recordReviewWrite() below records what Remote said
   * when the decision was carried out. Collapsing them would make "a human
   * approved this expense" and "Remote accepted the approval" the same fact, and
   * they are not — a PATCH can fail after a perfectly valid human decision,
   * and the decision must survive that.
   *
   * `hold` never reaches recordReviewWrite() at all: it makes no Remote write,
   * because Remote's status enum has no "held" member (reviewPolicy.js's
   * header). It is a local parking state and stays reversible.
   *
   * @param {string} id
   * @param {object} args
   * @param {"approve"|"decline"|"hold"} args.action  already canonicalised by
   *   normalizeAction() at the workflow entry point — this store never sees
   *   the legacy `release` spelling and so never has to know it existed
   * @param {string} args.reviewer
   * @param {string} [args.note]
   * @param {string} args.status   from statusForAction() — passed in rather
   *   than re-derived here, so the status vocabulary lives in the policy
   *   module and this store never becomes a second place it is decided.
   */
  async markReviewed(id, { action, reviewer, note = "", status }) {
    const now = new Date().toISOString();
    const local = this.expenses.find((r) => r.id === id);
    if (local) {
      local.status = status;
      local.reviewAction = action;
      local.reviewer = reviewer;
      local.reviewNote = note || null;
      local.reviewedAt = now;
      local.updatedAt = now;
    }
    if (this.pgPool) {
      // Same reasoning as markAutoApproved(): this UPDATE can fire in the same
      // request as its own background INSERT, so it must not overtake it.
      await this.flush();
      await this.pgPool.query(
        `update uc02_expenses
            set status = $2, review_action = $3, reviewer = $4, review_note = $5,
                reviewed_at = $6, updated_at = $6
          where id = $1`,
        [id, status, action, reviewer, note || null, now]
      );
    }
    return this.findById(id);
  }

  /**
   * Record what Remote answered when an approval or a decline was carried out.
   * Separate from markReviewed() — see its header.
   * @param {string} id
   * @param {object} remoteResult
   */
  async recordReviewWrite(id, remoteResult) {
    const now = new Date().toISOString();
    const local = this.expenses.find((r) => r.id === id);
    if (local) {
      local.remoteResult = remoteResult;
      local.updatedAt = now;
    }
    if (this.pgPool) {
      await this.flush();
      await this.pgPool.query(
        `update uc02_expenses set remote_result = $2::jsonb, updated_at = $3 where id = $1`,
        [id, remoteResult ? JSON.stringify(remoteResult) : null, now]
      );
    }
    return this.findById(id);
  }

  /**
   * The expenses ONE requester filed, newest first — the read behind the
   * portal's "My requests" (src/portal/server.js).
   *
   * WHY THIS IS A STORE METHOD AND NOT A QUERY IN THE PORTAL
   * Everything it takes to answer this correctly is schema knowledge: the
   * table name, the twenty-one column aliases in SELECT_COLUMNS, and — the
   * part that would have gone wrong silently — normalizeRow(), which splits
   * the one `receipt_hash` column back into two fields and coerces the jsonb
   * columns some driver/column combinations hand back as strings. A row read
   * by a portal-side query would be shaped differently from a row read by
   * findById(), and the portal's describeStatus() reads camelCase fields
   * (`reviewedAt`, `reviewNote`) that only normalizeRow() produces. It would
   * not have thrown; it would have reported `unknown` for an expense a specialist
   * had decided, which is the failure this whole route exists to fix.
   *
   * NO `requester` COLUMN EXISTS HERE, and that is not an omission: an expense's
   * owner IS its employment (§4's ownership gate refuses an expense filed under
   * anyone else's session). A requester-scoped ask therefore matches nothing,
   * and returning nothing states that rather than ignoring the filter — an
   * ignored filter WIDENS a scope, which is the one direction an ownership
   * check must never fail in.
   *
   * `flush()` first, for the reason list() and the sibling stores record:
   * createExpense() is fire-and-forget, so a row written moments ago may still
   * be in flight.
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
    if (!employmentId) return [];
    if (requester) return []; // see the header above
    if (!this.pgPool) {
      return this.expenses.filter((row) => matchesOwner(row, { employmentId, source })).reverse().slice(0, limit);
    }
    await this.flush();
    const params = [String(employmentId)];
    let sql = `select ${SELECT_COLUMNS} from uc02_expenses where employment_id = $1`;
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
   * All submissions processed in THIS process, newest first — the source for a
   * dashboard queue. In-memory only, like every sibling store's list(): a
   * serverless deployment answers this route with the explicit
   * "that list is process-local" message rather than an empty array that looks
   * like an answer (deploy/cx-apis/router.js's isMemoryOnlyList).
   */
  list() {
    return [...this.expenses].reverse();
  }
}

/**
 * The single value written to the one `receipt_hash` column — see the header's
 * "which hash is persisted" section. Derived-preferred because it is the only
 * symmetric choice.
 */
function dedupeKey(row) {
  return row.derivedReceiptHash ?? row.receiptHash ?? null;
}

/**
 * Shape a Postgres row like a row that never left memory: split the one stored
 * hash back into the field it came from (the `derived:` prefix that
 * deriveReceiptFingerprint() writes makes the value self-labelling), coerce the
 * jsonb columns that some driver/column combinations hand back as JSON strings
 * — same fix and same reasoning as uc05/resignationStore.js's normalizeRow() —
 * and normalise timestamps to the ISO strings the in-memory rows use.
 */
function normalizeRow(row) {
  const { storedReceiptHash, ...rest } = row;
  const derived = typeof storedReceiptHash === "string" && storedReceiptHash.startsWith("derived:");
  return {
    ...rest,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
    autoApprovedAt: toIso(row.autoApprovedAt),
    // THE STORED VOCABULARY, CANONICALISED ON THE WAY OUT (2026-08-19).
    // `release`/`released` was renamed to `approve`/`approved` throughout
    // (src/uc02/reviewPolicy.js's header says why). Two rows in the live
    // `uc02_expenses` table were written under the old words, and the rename
    // must not turn either of them into an expense nobody can read: the sidebar
    // would render an unrecognised status, describeStatus() would report
    // `unknown` for an expense that WAS approved, and the outcome badge would
    // print the raw word. Mapping them here — at the one place a Postgres row
    // becomes an in-memory row — means exactly one layer knows the old
    // spellings existed, and every layer above sees one vocabulary.
    //
    // It is a READ-side map, so it works whether or not the optional data
    // migration in docs/SETUP-CHECKLIST.md is ever applied. That is deliberate:
    // backward compatibility that depends on a human running SQL is not
    // backward compatibility.
    //
    // `?? null` on each, so a row written before the four columns were
    // provisioned reads back as "nobody has reviewed this" rather than as
    // `undefined`, which JSON.stringify drops entirely and the sidebar would
    // then render as a missing field rather than an empty one.
    status: canonicalStatus(row.status),
    reviewAction: normalizeAction(row.reviewAction ?? null),
    reviewer: row.reviewer ?? null,
    reviewNote: row.reviewNote ?? null,
    reviewedAt: toIso(row.reviewedAt),
    receiptHash: derived ? null : (storedReceiptHash ?? null),
    derivedReceiptHash: derived ? storedReceiptHash : null,
    receiptHashSource: storedReceiptHash === null || storedReceiptHash === undefined ? null : derived ? "derived" : "submitted",
    flags: coerceJson(row.flags, []),
    remoteResult: coerceJson(row.remoteResult, null),
  };
}

function toIso(value) {
  if (value === null || value === undefined) return null;
  return value instanceof Date ? value.toISOString() : String(value);
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

function statusFor(decision) {
  if (decision === "auto_approve") return "auto_approved";
  if (decision === "human_review") return "flagged";
  if (decision === "blocked") return "blocked";
  return "escalated";
}
