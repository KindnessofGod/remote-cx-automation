// ---------------------------------------------------------------------------
// source.js  —  Where the metrics rows come from
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
// compute.js is pure and knows nothing about storage. This file is the only
// place that does, which is what lets the same metric definitions run against
// a live Supabase database and against an in-memory CaseStore in tests.
//
// The two sources disagree about naming: Postgres columns are snake_case
// (`use_case`, `created_at`) while CaseStore's in-memory rows are camelCase
// (`useCase`, `createdAt`). Rather than teach compute.js both dialects — which
// would put a storage detail into the business logic — the SQL aliases every
// column into the camelCase shape the in-memory store already emits. The
// mapping lives here, once, in the query itself.
// ---------------------------------------------------------------------------

/**
 * Read metric rows from Postgres.
 *
 * Note the deliberate asymmetry with the rest of the app: everything else
 * writes in the background and swallows errors so a logging failure can never
 * break a customer-facing decision. Reads here do the opposite and throw,
 * because a dashboard that silently renders partial data is worse than one
 * that refuses to render — a wrong number gets acted on, a missing one gets
 * investigated.
 *
 * @param {import("pg").Pool} pgPool
 * @param {object} [opts]
 * @param {number} [opts.sinceDays] only include cases created in this window
 * @returns {Promise<{cases: object[], reviewQueue: object[]}>}
 */
export async function loadRowsFromPostgres(pgPool, { sinceDays = null } = {}) {
  const where = sinceDays ? `where created_at >= now() - ($1 || ' days')::interval` : "";
  const params = sinceDays ? [String(sinceDays)] : [];

  const casesResult = await pgPool.query(
    `select id,
            created_at  as "createdAt",
            updated_at  as "updatedAt",
            use_case    as "useCase",
            source,
            external_ref as "externalRef",
            employment_id as "employmentId",
            requester,
            classification,
            decision,
            reason,
            flags,
            status
       from cases
       ${where}
      order by created_at asc`,
    params
  );

  // Fetch every review row whose parent case is in the window, rather than
  // filtering review_queue by its own created_at — a case created inside the
  // window can be reviewed after it, and that review still belongs to it.
  const reviewResult = await pgPool.query(
    `select rq.id,
            rq.created_at as "createdAt",
            rq.updated_at as "updatedAt",
            rq.case_id    as "caseId",
            rq.status,
            rq.assignee,
            rq.notes
       from review_queue rq
       join cases c on c.id = rq.case_id
       ${where ? where.replace(/created_at/g, "c.created_at") : ""}
      order by rq.created_at asc`,
    params
  );

  return { cases: normalizeRows(casesResult.rows), reviewQueue: reviewResult.rows };
}

/**
 * Read the same shape out of an in-memory CaseStore.
 * @param {import("../shared/caseStore.js").CaseStore} caseStore
 */
export function loadRowsFromStore(caseStore) {
  return { cases: normalizeRows(caseStore.cases), reviewQueue: caseStore.reviewQueue };
}

/**
 * Defend against the two shapes `flags` can arrive in. The in-memory store
 * holds a real array; Postgres returns jsonb which the driver usually parses
 * to an array but returns as a string for some column/driver combinations.
 * findIntegrityBreaches() reads `flags.length`, and a JSON *string* has a
 * length too — `"[]"` would report as 2 flags and manufacture a false
 * integrity breach out of a perfectly healthy case. So coerce once, here.
 */
function normalizeRows(rows) {
  return rows.map((row) => ({ ...row, flags: coerceFlags(row.flags) }));
}

function coerceFlags(flags) {
  if (Array.isArray(flags)) return flags;
  if (typeof flags === "string") {
    try {
      const parsed = JSON.parse(flags);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

// ---------------------------------------------------------------------------
// THE DEPLOYED AUDIT API AS A SOURCE — added 2026-08-23
// ---------------------------------------------------------------------------
// `loadRowsFromPostgres` needs a raw TCP connection to port 5432. That is
// unreachable from any environment behind an HTTP CONNECT proxy — including
// the container this project is developed in, where `npm run metrics` dies on
// ENETUNREACH before rendering anything.
//
// The consequence was not a missing feature, it was a missing HABIT: the
// impact dashboard is the single artifact that most directly demonstrates
// whether the automation is working, and it had never been generated because the
// one command that generates it could not run where the work happens.
//
// The deployed audit API serves the same decision rows over HTTPS. This reader
// uses it, which means the dashboard can be produced from anywhere holding the
// portal key rather than only from a machine with database credentials.
//
// IT IS NOT A SUBSTITUTE AND MUST NOT BE LABELLED AS ONE. The audit log is an
// append-only record of DECISIONS; `cases` is mutable CURRENT STATE, and the
// two are deliberately never conflated in this codebase. What comes back here
// is every decision as it was made, with no later human verdict folded in — so
// metrics computed from it describe what the system DECIDED, not what a
// reviewer subsequently did. The caller labels the source accordingly, and
// `reviewQueue` is returned EMPTY rather than approximated: an approval rate
// inferred from decision rows would be a guess wearing a number's clothes.
// ---------------------------------------------------------------------------

/**
 * Read decision rows from the deployed audit API.
 *
 * Throws on any failure, like its Postgres sibling and for the same reason: a
 * dashboard that silently renders partial data is worse than one that refuses.
 *
 * @param {object} opts
 * @param {string} opts.baseUrl   deployment root, e.g. https://…vercel.app
 * @param {string} opts.portalKey value for the x-portal-key header
 * @param {number} [opts.limit]   rows per use case
 * @returns {Promise<{cases: object[], reviewQueue: object[], decisionsOnly: true}>}
 */
export async function loadRowsFromAuditApi({ baseUrl, portalKey, limit = 200 }) {
  if (!baseUrl) throw new Error("loadRowsFromAuditApi: no baseUrl");
  if (!portalKey) throw new Error("loadRowsFromAuditApi: no portalKey — the audit API refuses without one");

  const useCases = ["UC-01", "UC-02", "UC-03", "UC-04", "UC-05", "UC-06", "UC-07", "UC-08", "UC-09"];
  const cases = [];

  for (const uc of useCases) {
    // `use_case`, NOT `useCase`. An unrecognised query parameter is silently
    // ignored by this API and returns a plausible, complete, WRONG result — a
    // first pass at a per-use-case table showed all nine identical and was
    // entirely credible. Named here because the trap is invisible at the call
    // site and costs a whole table.
    const url = `${baseUrl.replace(/\/$/, "")}/audit/api/decisions?use_case=${uc}&limit=${limit}`;
    const res = await fetch(url, { headers: { "x-portal-key": portalKey } });
    if (!res.ok) throw new Error(`audit API ${uc} → HTTP ${res.status}`);
    const body = await res.json();

    for (const d of body.decisions ?? []) {
      cases.push({
        id: d.id,
        createdAt: d.at,
        updatedAt: d.at,
        useCase: d.useCase,
        source: d.source ?? "audit_log",
        externalRef: d.externalRef,
        employmentId: d.employmentId,
        requester: d.actor,
        classification: null,
        decision: d.action,
        reason: d.reason,
        flags: d.flags ?? [],
        status: d.action,
      });
    }
  }

  // Empty, deliberately. See the header: inferring approvals from decision
  // rows would be a guess wearing a number's clothes.
  return { cases, reviewQueue: [], decisionsOnly: true };
}
