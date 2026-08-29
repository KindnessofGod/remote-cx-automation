// ---------------------------------------------------------------------------
// audit.js  —  Audit logger (append-only record of everything that happens)
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
// Auditability is part of "done" for any customer-facing support system that
// changes state on someone's behalf. Every decision the automation makes — every read that
// informed it, every gate it passed or failed, every human who approved — must
// be recorded so it can be inspected later. In production this is a Postgres
// table (Supabase's `audit_log`); here we ALSO keep the original in-memory
// list + optional JSON-lines file, with the SAME interface as before, so
// tests and the demo never need a database.
//
// log() stays synchronous for existing callers (workflow.js doesn't await it).
// When a pgPool is supplied, the DB write happens in the background — errors
// are caught and logged, never thrown into the caller. Call flush() to wait
// for any pending writes (used by the live-verification script, which needs
// to know the row landed before reading it back).
//
// logDurable() is the deliberate exception — see its own comment. Both share
// the same entry construction and in-memory/file recording, so the two paths
// can never drift into writing differently-shaped rows.
//
// WHAT `audit_trace.at` MEANS (R7-36). This file always stamps `at` at CALL
// TIME — the instant the code below constructs the entry, which is also the
// instant the calling code observed the attempt's outcome. The n8n path
// (workflows/nodes/collectTraceSteps.js) cannot do this: it runs downstream
// of the decision, reading back what already happened, and leaves `at` to
// Postgres's own `now()` default at INSERT time — WRITE TIME, not call time.
// The two are different clocks and can disagree about which side of a
// decision an attempt falls on, which is why every trace row now carries
// `details.atSemantic` ("call_attempt" here, "trace_write" there) naming
// which one produced it — see logTraceStep()'s own comment for the detail.
// ---------------------------------------------------------------------------

import { appendFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

export class AuditLogger {
  /**
   * @param {string|null} filePath  optional path to also write JSON-lines to
   * @param {object} [opts]
   * @param {import("pg").Pool|null} [opts.pgPool]  when set, also writes each
   *   entry to the Supabase `audit_log` table in the background
   */
  constructor(filePath = null, { pgPool = null } = {}) {
    this.entries = [];
    this.filePath = filePath;
    this.pgPool = pgPool;
    this.pending = [];
    // Trace steps recorded before their parent decision row exists (the UC-01
    // classifier runs in STEP 1, its decision row is audited in STEP 7). They
    // wait here until #record() creates the parent, which binds them — see
    // #bindPendingTracesTo() for why that ordering matters.
    this.pendingTraces = [];
    // parent audit entry id -> trace entries bound to it. Their Supabase
    // inserts must not fire until the parent row itself has landed
    // (audit_trace.parent_id is an FK on audit_log.id) — #writeToDb() chains
    // them onto its own insert, same rule as caseStore.js's child tables.
    this.tracesByParent = new Map();
  }

  /**
   * Record one auditable event.
   * @param {object} event
   * @param {string} event.useCase   e.g. "UC-01"
   * @param {string} event.action    e.g. "auto_resolve" | "escalate" | "human_review"
   * @param {string} [event.actor]   who/what triggered it
   * @param {string} [event.riskTier] "low" | "medium" | "high"
   * @param {object} [event.details] any structured context (inputs, outputs, gates)
   */
  log(event) {
    const entry = this.#record(event);
    if (this.pgPool) {
      const write = this.#writeToDb(entry).catch((err) => {
        console.error(`[audit] failed to write entry ${entry.id} to Supabase: ${err.message}`);
      });
      this.pending.push(write);
    }
    return entry;
  }

  /**
   * Like log(), but AWAITS the Supabase write and lets a failure throw.
   *
   * WHY THE ASYMMETRY WITH log(). On the automated decision path an audit
   * write is a side-effect of a decision that has already been made and acted
   * on, so a logging failure must never break a customer-facing outcome —
   * hence the background write above. A human clicking "Approve" in the ZAF
   * sidebar is the opposite situation: the audit row *is* the record that the
   * human authorised the action, and the agent is about to be told "approved."
   * Reporting success while the row silently failed to land would make the
   * sidebar lie about accountability, and the HITL accept-rate metric would be
   * computed from an incomplete history. Same reasoning as metrics/source.js:
   * a missing number gets investigated, a wrong one gets acted on.
   *
   * @param {object} event  same shape as log()
   */
  async logDurable(event) {
    const entry = this.#record(event);
    if (this.pgPool) {
      await this.#writeToDb(entry);
    }
    return entry;
  }

  /**
   * Record one ATTEMPT at an LLM/API call, as the per-step half of §4
   * invariant 7. Where log() creates the one-row decision summary, this
   * creates the detailed trace underneath it — every attempt, including
   * failed and abandoned ones, so a "why did this fail at 3am" investigation
   * can see what actually happened rather than only that the decision landed.
   *
   * WHY parentId MAY BE OMITTED. The attempt that informs a decision usually
   * happens BEFORE the decision row exists — UC-01 classifies in STEP 1 and
   * audits the decision in STEP 7 — so the caller often does not yet know the
   * parent id. In that case the entry is held in `pendingTraces` and bound to
   * the next audit-log row #record() creates (the decision row, in the UC-01
   * flow — see #bindPendingTracesTo()). A trace WITH a parentId is persisted
   * immediately, exactly like log()'s background Supabase write.
   *
   * WHAT `at` MEANS ON THIS PATH (R7-36). `at` is stamped HERE, synchronously,
   * at the moment the calling code observed the attempt's outcome — call time,
   * not write time. It can therefore land before OR after its parent decision
   * row's own `at`, depending only on when in the workflow the attempt itself
   * happened (classify-before-decide vs. decide-before-notify), never on when
   * either row reached Supabase. Every entry is tagged
   * `details.atSemantic: "call_attempt"` so a reader of one row, with no other
   * context, can tell which clock it is reading — the n8n path
   * (workflows/nodes/collectTraceSteps.js) tags its own rows
   * `"trace_write"` for the opposite reason: it has no access to when the
   * traced node actually ran, only to when ITS OWN insert executes.
   *
   * @param {object} trace
   * @param {string} trace.call       which call it was, e.g. "classify.askJson"
   * @param {number} trace.attempt    attempt number, 1 = first try
   * @param {boolean} trace.ok        whether this attempt succeeded
   * @param {string} [trace.parentId] the audit-log row this belongs to; omit
   *   when the parent decision row does not exist yet (see above)
   * @param {string} [trace.error]    failure message when !ok
   * @param {object} [trace.details]  any structured context
   * @returns {object} the recorded trace entry
   */
  logTraceStep({ call, attempt, ok, parentId = null, error = null, details = null }) {
    const entry = {
      id: randomUUID(),
      at: new Date().toISOString(),
      parentId,
      call,
      attempt,
      ok,
      error,
      details: { ...(details || {}), atSemantic: "call_attempt" },
    };
    this.entries.push(entry);
    if (parentId) {
      this.#persistTrace(entry);
    } else {
      this.pendingTraces.push(entry);
    }
    return entry;
  }

  /**
   * Record a trace step that belongs to NO decision row, and will never get
   * one — and PERSIST it now.
   *
   * WHY THIS EXISTS  (DRIFT-121)
   * `logTraceStep()` above holds a parentless entry in `pendingTraces`, and the
   * ONLY thing that ever drains that array is `#bindPendingTracesTo()`, which
   * is called from `#record()` — the `audit_log` write path. That is correct
   * for the case it was built for: the classifier's LLM attempt happens before
   * the decision row exists, and the very next `log()` adopts it.
   *
   * It is wrong for a path that never writes an `audit_log` row at all.
   * `src/uc01/workflow.js` returns for `out_of_scope` before any case or audit
   * row is created, so a trace step added there would sit in `pendingTraces`
   * for the life of the process, reach no file and no table, and be discarded
   * on exit. The row would simply never be written.
   *
   * Worse, a test asserting against `this.entries` — the obvious way to write
   * one — goes GREEN over exactly that, because `entries` is the in-memory
   * buffer and not the destination. That is fixtures agreeing with code, inside
   * the very mechanism added to make an invisible path visible.
   *
   * THE SCHEMA ALREADY ALLOWED THIS. `audit_trace.parent_id` is NULLABLE, with
   * FK `audit_trace_parent_id_fkey -> audit_log.id`, and a SQL foreign key
   * permits NULL (read live, 2026-08-21). No migration was needed; only a code
   * path. That is the difference between this and DRIFT-120.
   *
   * AWAITABLE, AND LOUD ON FAILURE. `logTraceStep()`'s background write
   * swallows its error into a console line, which is right for a trace that
   * accompanies a durable decision row — the decision survives either way. Here
   * the trace is the ONLY record that this request was ever seen, so an
   * unpersistable one and an absent one must not look alike. On failure the
   * returned entry carries `persisted: false` and the error, so the caller can
   * tell; it deliberately does NOT write an `audit_log` row to report it,
   * because VC-11/VC-31 require zero of those on this path and reporting a
   * failure by breaking the invariant would be its own defect.
   *
   * @param {object} trace  same shape as logTraceStep(), minus `parentId`
   * @returns {Promise<object>} the entry, with `persisted` and `persistError`
   */
  async logStandaloneTraceStep({ call, attempt = 1, ok = true, error = null, details = null }) {
    const entry = {
      id: randomUUID(),
      at: new Date().toISOString(),
      parentId: null,
      call,
      attempt,
      ok,
      error,
      // Same semantic as logTraceStep() above, and the same reason: this `at`
      // is stamped here, at call time, not at persist time (R7-36).
      details: { ...(details || {}), atSemantic: "call_attempt" },
      persisted: false,
      persistError: null,
    };
    this.entries.push(entry);

    try {
      if (this.filePath) {
        appendFileSync(this.filePath, JSON.stringify(entry) + "\n");
        entry.persisted = true;
      }
      if (this.pgPool) {
        await this.#writeTraceToDb(entry);
        entry.persisted = true;
      }
      // Neither a file nor a pool configured: there is no destination, so
      // "persisted" is honestly false rather than vacuously true. An in-memory
      // run has nowhere to put it and must not claim otherwise.
    } catch (err) {
      entry.persisted = false;
      entry.persistError = err?.message ?? String(err);
      console.error(`[audit] standalone trace ${entry.id} (${call}) could not be persisted: ${entry.persistError}`);
    }
    return entry;
  }

  /** Build the entry and record it in memory (+ the JSON-lines file). */
  #record(event) {
    const entry = {
      id: randomUUID(),
      at: new Date().toISOString(),
      ...event,
    };
    this.entries.push(entry);
    if (this.filePath) {
      appendFileSync(this.filePath, JSON.stringify(entry) + "\n");
    }
    // This row is the parent for any trace steps recorded earlier whose
    // decision row did not exist yet (e.g. the classifier's LLM attempt).
    this.#bindPendingTracesTo(entry.id);
    return entry;
  }

  /**
   * Give every held trace step its parent id and file line. Must be the next
   * audit-log row AFTER the attempts: in the UC-01 flow the decision row is
   * the first log() after the classifier ran, so this binds the classifier's
   * attempts to exactly that decision. If any other log() happened in between
   * it would claim them instead — true for the flows built so far (workflow.js
   * audits the decision before anything else does). The Supabase insert is NOT
   * attempted here: the trace is registered in `tracesByParent` and #writeToDb()
   * fires it chained onto the parent's own insert, so the audit_trace FK on
   * audit_log.id can never race its parent into Postgres.
   */
  #bindPendingTracesTo(parentId) {
    if (this.pendingTraces.length === 0) return;
    for (const trace of this.pendingTraces) {
      trace.parentId = parentId;
      if (this.filePath) {
        appendFileSync(this.filePath, JSON.stringify(trace) + "\n");
      }
    }
    this.tracesByParent.set(parentId, this.pendingTraces);
    this.pendingTraces = [];
  }

  /** Write one trace entry to the JSON-lines file + Supabase (background). */
  #persistTrace(entry) {
    if (this.filePath) {
      appendFileSync(this.filePath, JSON.stringify(entry) + "\n");
    }
    if (this.pgPool) {
      const write = this.#writeTraceToDb(entry).catch((err) => {
        console.error(`[audit] failed to write trace step ${entry.id} to Supabase: ${err.message}`);
      });
      this.pending.push(write);
    }
  }

  async #writeToDb(entry) {
    await this.pgPool.query(
      `insert into audit_log (id, at, use_case, action, actor, risk_tier, details)
       values ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
      [
        entry.id,
        entry.at,
        entry.useCase,
        entry.action,
        entry.actor ?? null,
        entry.riskTier ?? null,
        JSON.stringify(entry.details ?? {}),
      ]
    );
    // Any trace steps bound to this row (#bindPendingTracesTo) are inserted
    // only AFTER the parent has landed, so their FK can never fire first.
    const traces = this.tracesByParent.get(entry.id) ?? [];
    this.tracesByParent.delete(entry.id);
    for (const trace of traces) {
      await this.#writeTraceToDb(trace);
    }
  }

  async #writeTraceToDb(entry) {
    await this.pgPool.query(
      `insert into audit_trace (id, at, parent_id, call, attempt, ok, error, details)
       values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)`,
      [
        entry.id,
        entry.at,
        entry.parentId,
        entry.call,
        entry.attempt,
        entry.ok,
        entry.error ?? null,
        JSON.stringify(entry.details ?? {}),
      ]
    );
  }

  /** Await any DB writes still in flight — call before reading rows back. */
  async flush() {
    await Promise.allSettled(this.pending);
    this.pending = [];
  }

  /** Return all entries for one use case — handy for inspection and tests. */
  forUseCase(useCase) {
    return this.entries.filter((e) => e.useCase === useCase);
  }
}
