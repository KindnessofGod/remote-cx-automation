// ---------------------------------------------------------------------------
// workflowClaims.js — exactly-once, guaranteed by the database
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
//
// Duplicate delivery is normal, not exceptional. Zendesk retries webhooks, a
// trigger can fire twice on rapid ticket updates, and a customer can double-
// submit a form. UC-01 learned this the expensive way: ticket #5 arrived three
// times within microseconds and produced two audit rows 30µs apart plus a
// duplicate verification letter posted publicly to the customer.
//
// UC-01 was then fixed and the other eight were not, so until now a single
// expense claim could be approved twice and a single amendment recorded twice.
//
// THE GUARANTEE IS THE PRIMARY KEY, NOT THIS CODE.
//
// `workflow_claims` is keyed (use_case, external_ref), and the insert below is
// a single `ON CONFLICT DO NOTHING` statement: rowCount is 1 for exactly one
// caller and 0 for every other, with no read-then-write gap. A check-then-
// insert in application code has precisely the race that caused the original
// bug — two callers both read "unclaimed", both proceed, both act.
//
// ONE LEDGER FOR BOTH EXECUTION PATHS. The Node app and the n8n graphs share
// this table. Two ledgers would not have helped: each path would read the
// other's refs as unclaimed and duplicate its work.
//
// KEYED BY USE CASE AS WELL AS REF, because one ticket may legitimately reach
// two use cases — UC-03 routes an inquiry on to UC-04. Keying on the ref alone
// would silently drop the second, which is a worse failure than the duplicate
// it prevents: a dropped request looks like nothing happened.
// ---------------------------------------------------------------------------

/**
 * Claim an external reference for a use case, exactly once.
 *
 * Degrades safely. With no `pgPool` (tests, offline demos, a fresh clone) the
 * request is processed and `ledgerUnavailable` is set on the result, so a
 * caller can tell "claimed because nothing was contending" apart from "claimed
 * because nothing was checking". See the branch below for why it does not try
 * to synthesise the guarantee in memory.
 *
 * @param {object} args
 * @param {object|null} [args.pgPool]     a `pg` Pool, or null when unconfigured
 * @param {string} args.useCase           e.g. "UC-04"
 * @param {string|number} args.externalRef  the ticket / request id
 * @param {string|null} [args.decision]   recorded for forensics, never read back
 * @returns {Promise<{claimed: boolean}>}
 */
export async function claimExternalRef({ pgPool = null, useCase, externalRef, decision = null }) {
  if (externalRef == null || externalRef === "") {
    // Nothing to key on. Proceed rather than refuse: a request with no external
    // reference cannot be a duplicate *delivery* of anything, and refusing it
    // would turn a missing optional field into a dropped request.
    return { claimed: true };
  }

  const ref = String(externalRef);

  if (!pgPool) {
    // NO LEDGER, NO GUARANTEE — and saying so is better than faking it.
    //
    // The first version of this kept a module-level Set as a stand-in. That was
    // wrong three ways, and the tests caught it immediately:
    //   1. Exactly-once is a property of SHARED durable state. A per-process
    //      set cannot see the n8n path or a second instance, so the "guarantee"
    //      it offers is real only in the one case that never matters.
    //   2. Module-level state made behaviour depend on what ran earlier in the
    //      process. Two independent tests seeding the same reference are not
    //      duplicate deliveries, but the set could not tell them apart.
    //   3. It grew without bound for the life of the process.
    //
    // So the unconfigured path processes the request. That is the same
    // direction every other optional integration in this repo degrades: do the
    // work, rather than silently drop a request that is probably legitimate.
    // Production always has the pool; this branch is tests and offline demos,
    // where a visible duplicate is a far cheaper failure than a vanished one.
    return { claimed: true, ledgerUnavailable: true };
  }

  try {
    const res = await pgPool.query(
      `insert into workflow_claims (use_case, external_ref, decision)
       values ($1, $2, $3)
       on conflict (use_case, external_ref) do nothing
       returning external_ref`,
      [useCase, ref, decision]
    );
    return { claimed: res.rowCount === 1 };
  } catch (err) {
    // FAIL OPEN, deliberately, and this is the one judgement call in the file.
    //
    // If the ledger is unreachable the choice is between processing a request
    // that might be a duplicate, or dropping one that is probably legitimate.
    // For these use cases a duplicate is recoverable — it is visible in the
    // audit log, and `findRedundantCalls()` in the metrics layer surfaces it —
    // whereas a silently dropped customer request is not: nobody knows to look
    // for it. Both outcomes are bad; only one is detectable afterwards.
    //
    // The exception is any path that moves money. UC-09 must NOT rely on this
    // fallback, which is why its multi-approval gate is what actually protects
    // the payout, not the claim.
    return { claimed: true, ledgerUnavailable: true, error: err.message };
  }
}

/**
 * D-26: read back the `decision` a WINNING claim recorded for `externalRef`.
 *
 * The header above documents `decision` as "recorded for forensics, never
 * read back" — true of `claimExternalRef()` itself, and this is a different,
 * narrower purpose: recovering the identity (a reference, a case id) the
 * winning claim recorded, so a caller who just LOST a claim (their
 * submission is a duplicate of one already in flight or already handled) can
 * be told which existing record it names, instead of minting an orphaned new
 * one that resolves to nothing. Used by content-derived, time-bucketed keys
 * that have no other durable row to look the original identity up on — see
 * `src/thirdparty/server.js` and `src/uc01/selfServiceLetter.js` (both D-26).
 *
 * Degrades to `null` with no pgPool, exactly like `claimExternalRef()` does —
 * a caller of this function already went through that path and got
 * `ledgerUnavailable: true` back, so it already knows not to trust an absence
 * here as "no prior submission exists".
 *
 * @param {object} args
 * @param {object|null} [args.pgPool]
 * @param {string} args.useCase
 * @param {string|number} args.externalRef
 * @returns {Promise<string|null>}
 */
export async function findClaimDecision({ pgPool = null, useCase, externalRef }) {
  if (!pgPool || externalRef == null || externalRef === "") return null;
  try {
    const result = await pgPool.query(
      `select decision from workflow_claims where use_case = $1 and external_ref = $2 limit 1`,
      [useCase, String(externalRef)]
    );
    return result.rows[0]?.decision ?? null;
  } catch (err) {
    console.error(`[workflowClaims] findClaimDecision failed for ${useCase}:${externalRef}: ${err.message}`);
    return null;
  }
}
