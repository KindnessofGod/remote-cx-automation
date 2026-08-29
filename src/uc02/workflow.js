// ---------------------------------------------------------------------------
// workflow.js  —  UC-02 end to end: submission -> gates -> auto-approve | flag
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
// The single entry point that wires the pure pieces (policyEngine.js,
// policyCaps.js, expenseClassifier.js) to I/O (Remote, AuditLogger,
// ExpenseStore) — the same role src/uc06/workflow.js plays there.
//
// EXECUTION PATH (low tier, 00-FOUNDATION.md §2): validate -> auto-execute ->
// resolve, exception-gated. The ONLY write this file can make is
// remote.patchExpenseStatus(..., {status:"approved"}), and it is reached only
// when every deterministic gate in policyEngine.js passed — the classifier's
// confidence is never a substitute for any of them (a confident expense that is
// over cap or fails math still routes to a human; pinned by a test).
//
// WRITE ORDERING IS DELIBERATE, THE n8n LESSON FROM §5 APPLIED TO NODE:
//   audit (durable) -> Remote PATCH -> store
// The durable `expense_auto_approved` row lands BEFORE the real write, so a
// crash in between leaves "approval recorded, write unconfirmed" — visible and
// safely retryable, never "a real reimbursement write with no record of who
// authorised it". The post-write audit entry and the store's remoteResult then
// capture the write's actual outcome.
// ---------------------------------------------------------------------------

import { createHash } from "node:crypto";
import { classifyRisk } from "../shared/riskEngine.js";
import { verifyRequester } from "../shared/identity.js";
import { getPolicyCap } from "./policyCaps.js";
import {
  evaluate as evaluatePolicy,
  describeCapComparison,
  captureEvidence,
  describeDecisionFacts,
} from "./policyEngine.js";
import {
  evaluateReviewAction,
  normalizeAction,
  statusForAction,
  REFUSALS as REVIEW_REFUSALS,
} from "./reviewPolicy.js";
import { classifyExpense } from "./expenseClassifier.js";
import { isCategoryFileable, findSelectableCategory } from "./expenseCategories.js";

import { claimExternalRef } from "../shared/workflowClaims.js";
import { remoteFor } from "../shared/remoteWorld.js";

/**
 * The name Remote publishes for a category code, for the one place a CLAIMANT
 * reads it — the cap-comparison sentence.
 *
 * READ, NEVER DERIVED. `title` is a real field on a Remote expense-category row
 * (`{code, title, description, is_selectable, …}`), so this returns what the
 * platform calls the category and never a re-spelling of the code: turning
 * `work_meals_and_entertainment.external_meals_and_entertainment` into words
 * here would invent a name Remote does not use, and a claimant querying it with
 * Finance Ops would be quoting something that exists nowhere.
 *
 * NULL, NEVER THE CODE, WHEN THERE IS NO TITLE. `describeCapComparison()` omits
 * the category clause entirely for a null, which is the honest outcome: the
 * money comparison is what the sentence is for, and the key is still on
 * `capComparison.categoryId` for the reader who needs it. Falling back to the
 * code would restore the leak on precisely the path nobody re-reads.
 *
 * Looked up through `findSelectableCategory()` rather than a fresh scan, so the
 * prototype-pollution guard and the selectability rule stay in one place.
 *
 * @param {unknown} list  the category list as Remote returned it
 * @param {unknown} code  the classifier's category code
 * @returns {string|null}
 */
function categoryTitle(list, code) {
  const row = findSelectableCategory(list, code);
  const title = typeof row?.title === "string" ? row.title.trim() : "";
  return title || null;
}

/**
 * A receipt fingerprint derived from the expense record itself (finding F-24).
 *
 * WHY: dedupe used to run ONLY when the caller supplied `receiptHash`, which
 * let the submitter decide whether the duplicate check happened at all — an
 * integrity control with an opt-out is not a control. The platform's real
 * image hash is still the better signal when present, so it is still used;
 * this is the floor beneath it, computed server-side from data the submitter
 * does not get to choose, so SOME dedupe always runs.
 *
 * The expense id is deliberately NOT part of the material: two different
 * expense records carrying the same receipt is precisely the case worth
 * catching. `submitted_at` is excluded for the same reason.
 *
 * @param {object|null} expense
 * @returns {string|null}
 */
export function deriveReceiptFingerprint(expense) {
  if (!expense || typeof expense !== "object") return null;
  // THE REAL RECORD'S OWN FIELDS. This used to hash `total_amount`,
  // `total_currency`, `description` and a `lines[]` digest — none of which
  // exist on a Remote expense, so every real expense hashed the same material
  // (five empty strings and one employment id) and the derived fingerprint
  // collided across every expense the same employee ever filed. A dedupe control
  // that flags every second expense as a duplicate is as broken as one that flags
  // none; it just fails in the direction that looks safe.
  //
  // The material below is the signature of "the same real-world expense filed
  // twice": same employee, same money, same currency, same tax, same date,
  // same title. The expense id is deliberately NOT included — two different
  // expense records carrying one receipt is precisely the case worth catching —
  // and neither are the receipt file ids, which differ per upload even when the
  // underlying receipt is the same document.
  const material = [
    expense.employment_id,
    expense.amount,
    expense.currency?.code,
    expense.tax_amount,
    expense.expense_date,
    expense.title,
  ]
    .map((value) => String(value ?? ""))
    .join("\u0000"); // NUL as an unambiguous field separator: it can never
  // appear inside an expense field, so two different field splits can never
  // hash to the same material. Written as an escape, never a literal NUL byte
  // — a raw control character in source silently survives grep, `file` and
  // most diffs as "binary", and one editor round-trip that strips it would
  // change every derived receipt hash with nothing to show in the diff.
  return `derived:${createHash("sha256").update(material).digest("hex").slice(0, 32)}`;
}

/**
 * Process an expense submission end to end.
 *
 * @param {object} submission
 * @param {string} submission.expenseId     the Remote expense id being decided
 * @param {string} submission.employmentId  the employment the expense belongs to
 * @param {object|null} submission.session  {authenticatedEmploymentId} — the
 *   authenticated submitter (the Remote product's session). Fails closed: no
 *   session, or one that doesn't match the employment, means unverified — the
 *   same "identity from a signal, never a claim" rule as UC-01/UC-06.
 * @param {string} [submission.receiptHash] platform-computed fingerprint of the
 *   receipt image, used for the §7 duplicate check. Null when unavailable
 *   (dedupe simply doesn't run — never a blocker on an unknown).
 * @param {string} [submission.externalRef] e.g. the Zendesk ticket id
 * @param {string} [submission.source]      e.g. "webhook" | "remoteui" | "zaf"
 * @param {object} deps
 * @param {import("../remote/restClient.js").RemoteClient} deps.remote
 * @param {import("../shared/audit.js").AuditLogger} deps.audit
 * @param {import("./expenseStore.js").ExpenseStore} deps.expenseStore
 * @param {typeof classifyExpense} [deps.classify]  override for tests — defaults
 *   to the real classifyExpense() so production is unaffected; injectable so a
 *   test that doesn't care about classification never makes a real, retried
 *   LLM call just because OPENAI_API_KEY happens to be set in its environment.
 */
export async function handleExpenseSubmission(
  submission,
  { remote, audit, expenseStore, classify = classifyExpense } = {}
) {
  const {
    expenseId,
    employmentId,
    session = null,
    receiptHash = null,
    externalRef = null,
    source = null,
  } = submission;

  const actor = session?.authenticatedEmploymentId ?? "unauthenticated";

  // Reads that FAILED rather than returned data, collected in gate order (see
  // src/shared/upstreamFailure.js). RemoteClient returns null on a 404 and
  // THROWS on anything else (403/5xx/transport) — a call that could not be
  // COMPLETED, a different fact than "the record doesn't exist". Both are
  // caught here and pushed into the same array, so evaluatePolicy() below
  // sees one consistent shape regardless of which failure mode occurred.
  // Before the throw case was caught, the exception propagated straight out
  // of this function: the request left no store row and no audit row,
  // silently lost rather than a named, audited escalation — the read-side
  // version of the "lost request" failure mode already fixed for UC-05/07
  // (money arithmetic throwing upstream of the audit write). CLAUDE.md's own
  // standing note names the live symptom: the Sandbox token's role lacks
  // access to GET /v1/employee/expense-categories and 403s on every call.
  const upstreamFailures = [];

  /** A thrown RemoteClient error ends "...: <status>" for an HTTP failure
   *  (e.g. "Remote API /v1/employee/expense-categories failed: 403") and
   *  carries no trailing status for a transport/network failure. */
  function pushCaughtFailure(call, err) {
    const statusMatch = /:\s*(\d{3})\s*$/.exec(err.message ?? "");
    upstreamFailures.push({
      call,
      status: statusMatch ? Number(statusMatch[1]) : null,
      kind: statusMatch ? "http_error" : "unavailable",
      message: err.message,
    });
  }

  let employment = null;
  try {
    employment = await remote.getEmployment(employmentId);
  } catch (err) {
    pushCaughtFailure("employment", err);
  }
  // A null employment means Remote answered 404. Recorded rather than left to
  // the identity gate: `verifyRequester({session, employment: null})` is
  // unverified by construction, so without this every missing employment reads
  // as an identity failure in the audit log — the exact misattribution live
  // execution 4218 produced.
  if (!employment && !upstreamFailures.some((f) => f.call === "employment")) {
    upstreamFailures.push({
      call: "employment",
      status: 404,
      kind: "not_found",
      message: "Remote returned 404 for this employment id",
    });
  }
  const identity = verifyRequester({ session, employment });
  const employmentActive = Boolean(employment && employment.status === "active");

  // -------------------------------------------------------------------------
  // IDEMPOTENCY (finding F-24) — before any decision is made a second time.
  // -------------------------------------------------------------------------
  // A webhook that redelivers, a retried HTTP call, or two near-simultaneous
  // triggers (exactly what happened live on UC-01's ticket #5) used to produce
  // two decisions, two audit rows and TWO REAL APPROVAL WRITES for one expense.
  // A submission for an expense this store has already decided is therefore a
  // no-op that replays the recorded decision.
  //
  // Deliberately AFTER the identity check, and scoped to the same employment:
  // replaying a stored decision is itself a disclosure, so an unverified or
  // third-party caller never gets one — they fall through to the normal gates
  // and escalate there.
  const prior =
    identity.verified && typeof expenseId === "string" && expenseId
      ? await expenseStore.findByExpenseId(expenseId)
      : null;
  if (prior && prior.employmentId === employmentId) {
    const { tier: priorTier } = classifyRisk("UC-02", prior.flags ?? []);
    audit.log({
      useCase: "UC-02",
      action: "duplicate_request_ignored",
      actor: session?.authenticatedEmploymentId ?? "unauthenticated",
      riskTier: priorTier,
      details: {
        storeId: prior.id,
        expenseId,
        employmentId,
        priorDecision: prior.decision,
        priorDecidedAt: prior.createdAt,
        externalRef,
        source,
        reason: "an expense decision already exists for this expense id — no second write was issued",
      },
    });
    return {
      storeId: prior.id,
      expenseId,
      decision: prior.decision,
      reason: prior.reason,
      flags: prior.flags,
      tier: priorTier,
      categoryId: prior.categoryId,
      categorySource: prior.categorySource,
      confidence: prior.confidence,
      idempotent: true,
      alreadyDecidedAt: prior.createdAt,
    };
  }

  let expense = null;
  try {
    expense = await remote.getExpense(expenseId);
  } catch (err) {
    pushCaughtFailure("expense", err);
  }
  const expenseOwned = Boolean(expense && expense.employment_id === employmentId);

  // The COMPANY-side category endpoint, discriminated by this expense's own
  // employment id. That id is always present here — it is a required field of
  // the submission and the identity gate has just been run against it — which
  // is why the accurate, per-employee discriminator is also the safe one; the
  // `country_code` fallback would depend on `normalizeEmployment()`'s alpha-2/
  // alpha-3 field, the exact axis that broke UC-03's gate in production.
  // See RemoteClient.getExpenseCategories() for why the employee-authenticated
  // endpoint this used to call can never work for an unattended service.
  let categories = null;
  try {
    categories = await remote.getExpenseCategories({
      employmentId,
      countryCode: employment?.country_code ?? null,
    });
  } catch (err) {
    pushCaughtFailure("expense_categories", err);
  }
  // null is a 404 from the collection endpoint, NOT "this employee has no
  // categories" — and the two are opposite expenses. Without this the category
  // gate reports `category_unverified`, which blames the classifier for an
  // upstream outage.
  if ((categories === null || categories === undefined) && !upstreamFailures.some((f) => f.call === "expense_categories")) {
    upstreamFailures.push({
      call: "expense_categories",
      status: 404,
      kind: "not_found",
      message: "Remote returned 404 for the expense-categories list",
    });
  }
  const categoryList = Array.isArray(categories) ? categories : [];

  const classification = await classify({ expense, categoryList }, { audit });

  // The gate: not merely "is this code in the list", but "could the employee
  // actually file an expense under it" — active, and a selectable leaf rather than
  // a parent heading. See expenseCategories.js. This comparison used to read
  // `c.id === …` against rows that have no `id` field, so it was permanently
  // false and no expense could ever clear it.
  const categoryValid = isCategoryFileable(categoryList, classification.categoryId);

  // Duplicate detection (§7), and it ALWAYS runs (F-24). The submitter's own
  // `receiptHash` is checked first when present, then a fingerprint derived
  // server-side from the expense record — so a caller who simply omits the
  // hash no longer opts their expense out of the duplicate check.
  const derivedReceiptHash = deriveReceiptFingerprint(expense);
  const duplicate =
    (receiptHash ? await expenseStore.findByReceiptHash(receiptHash) : null) ??
    (derivedReceiptHash ? await expenseStore.findByReceiptHash(derivedReceiptHash) : null);

  const policyCap = getPolicyCap(classification.categoryId);
  const result = evaluatePolicy({
    identityVerified: identity.verified,
    employmentActive,
    expense,
    expenseOwned,
    duplicate,
    categoryValid,
    classification,
    policyCap,
    upstreamFailures,
  });

  // THE FIGURES BEHIND A CAP REFUSAL, computed once here from the same inputs
  // gate 12 compared. A tester read a Zendesk note saying their expense was
  // "above the policy cap" and could not see the amount, the cap, or the
  // overage — all three of which this function held at the moment it refused.
  // Derived (never persisted, never re-derived downstream) and carried on the
  // return value, so the portal's result panel and the Zendesk internal note
  // built from it both name the numbers. Null for every non-cap decision.
  //
  // THE SENTENCE IS COMPOSED FOR THE CLAIMANT; THE KEY TRAVELS BESIDE IT.
  // `classification.categoryId` is Remote's own enum — the value that came back
  // reading `work_meals_and_entertainment.external_meals_and_entertainment` —
  // and it was being dropped into the middle of the sentence a claimant reads
  // when their expense is refused for exceeding a cap. Finance Ops needs that
  // key (it is what they type to open the claim in Remote) and the claimant
  // needs the money comparison; those are two readers, not one
  // (docs/UI-AUDIENCES.md). So the sentence names the category by the TITLE
  // Remote publishes for it — "External meals and entertainment", a real field
  // on the category row, never a re-spelling this repository invented — while
  // `capComparison.categoryId` still carries the enum verbatim for the ticket
  // note, the sidebar and the stored evidence.
  //
  // A MISSING TITLE IS AN OMISSION, NEVER THE KEY AGAIN. `categoryTitle()`
  // answers null when the list has no row for the code, and
  // describeCapComparison() already omits the category clause entirely on null.
  // Falling back to the code would put the leak straight back on the rarest
  // path, which is the one nobody would look at again.
  const capCategoryTitle = categoryTitle(categoryList, classification.categoryId);
  const capBase = describeCapComparison({
    reason: result.reason,
    expense,
    policyCap,
    categoryId: capCategoryTitle,
  });
  const capComparison = capBase
    ? { ...capBase, categoryId: classification.categoryId, categoryTitle: capCategoryTitle }
    : null;

  // …AND THE SAME TREATMENT FOR EVERY OTHER REASON, WHICH IS WHAT WAS MISSING.
  //
  // `capComparison` closed C-27 for the cap and only for the cap, on the
  // synchronous response and the note built from it. A duplicate refusal still
  // named no earlier expense, a currency refusal named neither currency, a
  // confidence refusal named neither the score nor the threshold, and an
  // ownership refusal named neither employment — and the Finance Ops specialist
  // who opens the sidebar tomorrow saw none of it for ANY reason, because that
  // surface is built from the STORED ROW and the row held no figures at all.
  //
  // `captureEvidence()` takes the raw readings; it is PERSISTED with the row so
  // the figures outlive this process. The prose is derived from it at read time
  // rather than stored, so a better explanation improves every historical
  // decision instead of only future ones — `describeCapComparison`'s own rule,
  // applied to the whole ladder.
  const evidence = captureEvidence({
    expense,
    employment,
    employmentId,
    identity,
    classification,
    categoryList,
    policyCap,
    duplicate,
    upstreamFailures,
  });
  const decisionFacts = describeDecisionFacts({ reason: result.reason, evidence });

  // DELIVERY-LEVEL IDEMPOTENCY, distinct from the two domain checks above.
  //
  // `findByExpenseId` and `findByReceiptHash` answer "is this the same expense?"
  // Both are read-then-write, so two concurrent deliveries of the SAME webhook
  // can both read "no prior" and both proceed — the exact race that produced
  // UC-01's duplicate letter. This claim answers the different question "have I
  // already handled this delivery?", and it is decided by a primary key rather
  // than by application code, so concurrency cannot defeat it.
  //
  // Taken here because everything below is a durable record or an outward act.
  const claim = await claimExternalRef({
    pgPool: expenseStore.pgPool ?? null,
    useCase: "UC-02",
    externalRef,
    decision: result.decision,
  });
  if (!claim.claimed) {
    return {
      expenseId,
      decision: result.decision,
      reason: result.reason,
      flags: result.flags,
      capComparison,
      decisionFacts,
      duplicate: true,
      duplicateOf: externalRef,
    };
  }

  const row = expenseStore.createExpense({
    expenseId,
    employmentId,
    receiptHash,
    derivedReceiptHash,
    decision: result.decision,
    reason: result.reason,
    flags: result.flags,
    categoryId: classification.categoryId,
    categorySource: classification.source,
    confidence: classification.confidence,
    externalRef,
    source,
    // THE FIGURES THE GATES COMPARED, on the row a specialist opens later.
    // Without this the sidebar's UC-02 panel can say WHICH gate refused and what
    // that means, and cannot say what it refused about — no amount, no cap, no
    // duplicate pointer, no currencies. The audit row has carried most of these
    // since the audit fix, but nothing reading a case reads `audit_log`.
    decisionEvidence: evidence,
  });

  // The decision row is durable BEFORE anything outward happens — the same
  // ordering the audit spine follows (see the file header's write-ordering
  // section), applied to the operational row. createExpense() is
  // fire-and-forget like every sibling store's create, which is fine for a
  // long-lived process and is NOT fine in a serverless function that may stop
  // executing as soon as the response is written: the insert that carries the
  // §7 duplicate gate's only evidence would be the thing that never lands.
  // No-op when no pool is configured.
  if (expenseStore.pgPool) await expenseStore.flush();

  const { tier } = classifyRisk("UC-02", result.flags);

  audit.log({
    useCase: "UC-02",
    action: result.decision,
    actor,
    riskTier: tier,
    details: {
      storeId: row.id,
      externalRef,
      source,
      expenseId,
      employmentId,
      reason: result.reason,
      flags: result.flags,
      categoryId: classification.categoryId,
      categorySource: classification.source,
      confidence: classification.confidence,
      // The real record's fields. `amount` is in the expense's ORIGINAL currency
      // and `convertedAmount` in the company's billing currency; both are
      // integers in the currency's minor unit. Recording BOTH plus both codes
      // is deliberate — an audit row carrying a bare number and no currency
      // cannot be re-checked, and the cap gate compares the converted figure.
      amount: expense?.amount ?? null,
      currency: expense?.currency?.code ?? null,
      convertedAmount: expense?.converted_amount ?? null,
      convertedCurrency: expense?.converted_currency?.code ?? null,
      taxAmount: expense?.tax_amount ?? null,
      receiptCount: Array.isArray(expense?.receipts) ? expense.receipts.length : 0,
      receiptHash: receiptHash ?? null,
      derivedReceiptHash,
      receiptHashSource: receiptHash ? "submitted" : "derived",
      expenseStatus: expense?.status ?? null, // the F-11 gate's input, on the record
      // WHICH read failed and WHAT it answered. Empty on every healthy run.
      upstreamFailures,
    },
  });

  if (result.decision === "auto_approve") {
    // Durable BEFORE the write — see the file header's write-ordering section.
    await audit.logDurable({
      useCase: "UC-02",
      action: "expense_auto_approved",
      actor,
      riskTier: tier,
      details: {
        storeId: row.id,
        externalRef,
        source,
        expenseId,
        employmentId,
        amount: expense.amount,
        currency: expense.currency?.code ?? null,
        convertedAmount: expense.converted_amount,
        convertedCurrency: expense.converted_currency?.code ?? null,
      },
    });
    const remoteResult = await remote.patchExpenseStatus(expenseId, { status: "approved" });
    await expenseStore.markAutoApproved(row.id, remoteResult);
    audit.log({
      useCase: "UC-02",
      action: "expense_approved_write",
      actor,
      riskTier: tier,
      details: { storeId: row.id, externalRef, source, expenseId, remoteResult },
    });
  }

  return {
    storeId: row.id,
    expenseId,
    decision: result.decision,
    reason: result.reason,
    flags: result.flags,
    tier,
    categoryId: classification.categoryId,
    categorySource: classification.source,
    confidence: classification.confidence,
    capComparison,
    // The figures behind whichever gate decided — the cap's four numbers when it
    // was the cap, and the equivalent for the other fourteen rungs.
    decisionFacts,
  };
}

// ---------------------------------------------------------------------------
// THE FINANCE OPS DECISION (§6's "else" branch, finally reachable)
// ---------------------------------------------------------------------------
// Everything above this line is the automated pass: an expense arrives, the gates
// run, and a compliant one is approved with no human involved. §6's other
// branch — "route to Finance Ops (ZAF) -> PATCH status: declined (with reason)
// or hold" — had no implementation at all. A flagged expense landed in
// `uc02_expenses` with `status: "flagged"`, was rendered read-only in the ZAF
// sidebar, and nothing in this system could resolve it. The honest answer to
// "where does the human actually review it?" was: nowhere.
//
// WRITE ORDERING, and the one place it differs from the auto path above.
// The auto path is audit(durable) -> PATCH -> store, because the decision was
// made by code that had just finished checking every precondition. A human
// decision has a precondition that can have EXPIRED since — so the order here
// is:
//
//   1. audit.logDurable   the human's verdict, recorded first and always. If
//                         everything below fails, we still know who decided
//                         what and when. This is also the row that makes the
//                         HITL accept rate a measurement rather than a
//                         definition: it carries the AI's recommendation
//                         (`aiDecision`, `aiReason`) BESIDE the human's
//                         verdict, so the two can be compared. A row holding
//                         only the human's answer would make "did the
//                         specialist agree with the AI?" unanswerable.
//   2. freshness re-read  is this still true? (below)
//   3. store.markReviewed the operational state moves
//   4. Remote PATCH       the outward act
//   5. audit + store      what Remote actually said
//
// THE FRESHNESS RE-READ IS ASYMMETRIC, ON PURPOSE.
// UC-06 established the rule: the gates checked "is this employee active?"
// when the expense arrived, and a human may decide days later, so re-read before
// executing. Here that re-read BLOCKS an `approve` and does NOT block a
// `decline`, and the asymmetry is the whole point:
//
//   - approve  moves real money to a person. If the employment ended in the
//              meantime, that is exactly the reimbursement a fresh check
//              exists to stop. Blocked, 409, and the expense stays open.
//   - decline  refuses money. Blocking it because the employee left would
//              strand the expense in `flagged` forever with no way out — a gate
//              that structurally cannot succeed, which is this repository's
//              most expensive recurring failure (CLAUDE.md §4/§5). Declining
//              is the conservative direction; it does not need protecting from
//              a stale record. The observed status is recorded in the audit
//              row either way, so nothing is hidden.
//   - hold     makes no Remote write at all, so there is nothing to gate.
// ---------------------------------------------------------------------------

/**
 * THE HUMAN PATH'S WRITE ROWS ARE NAMED SEPARATELY FROM THE AUTOMATION'S, AND
 * THIS IS THE ONE PLACE THE release->approve RENAME DID NOT SIMPLY SUBSTITUTE.
 *
 * The row used to be `expense_${status}_write`, which produced
 * `expense_released_write` for an approval. Renaming `released` to `approved`
 * would have made that expression emit `expense_approved_write` — and
 * `expense_approved_write` IS ALREADY TAKEN: it is what the AUTO-APPROVE path
 * writes after its own PATCH (see markAutoApproved's caller above; five such
 * rows are live). Collapsing them would leave `audit_log` unable to answer
 * "was this approved by the automation or by a person?" — which is precisely
 * the question UC-02.md §11's Finance-Ops accept rate is computed from, and
 * the same question `statusForAction()` keeps `auto_approved` and `approved`
 * apart to answer at the row level. A metric that cannot separate the two
 * would report the automation's own throughput as human agreement.
 *
 * So the human path's write rows take the `expense_review_` prefix its verdict
 * rows already carry, giving one prefix for the whole Finance Ops vocabulary:
 *
 *   expense_review_approve         the verdict (durable, BEFORE the PATCH)
 *   expense_review_decline
 *   expense_review_hold
 *   expense_review_approved_write  what Remote answered (AFTER the PATCH)
 *   expense_review_declined_write
 *
 * An explicit map rather than a template, because a template is how the
 * collision arose: `expense_${status}_write` reads as obviously correct and
 * silently depends on no other path having chosen the same status word.
 *
 * HISTORY IS NOT REWRITTEN. The `expense_review_release` /
 * `expense_released_write` rows already in `audit_log` keep their names —
 * `audit_log` is append-only and records what the system called things at the
 * time. Only rows written from now on use the names above.
 */
// EXPORTED so the audit viewer's vocabulary test can DERIVE these names rather
// than restate them. A restated copy would share any omission and compare equal
// — the same reason the trace-node checker lifts its probe list out of the
// deployed body instead of keeping a local one (CLAUDE.md §7).
export const REVIEW_WRITE_ACTIONS = Object.freeze({
  approved: "expense_review_approved_write",
  declined: "expense_review_declined_write",
});

/**
 * Record a Finance Ops specialist's decision on a flagged expense, and carry it
 * out at Remote.
 *
 * @param {object} args
 * @param {string} args.storeId   the `uc02_expenses` row id (NOT the Remote
 *   expense id — the store row is what carries the decision and its state)
 * @param {"approve"|"decline"|"hold"|"release"} args.action  `release` is the
 *   accepted legacy spelling of `approve` (reviewPolicy.js's ACTION_ALIASES);
 *   it is canonicalised HERE, once, at the entry point, so nothing below —
 *   the audit action name, the store's `review_action` column, the response
 *   `code` — ever sees the alias
 * @param {string} args.reviewer  the authenticated specialist; resolved by
 *   src/shared/approverAuth.js before this is ever called, never a claim read
 *   out of a request body in the deployed posture
 * @param {string} [args.note]  REQUIRED for a decline — it becomes Remote's
 *   `reason`, which DeclineExpenseParams makes mandatory (UC-02.md §3)
 *
 * @param {object} deps
 * @param {import("../remote/restClient.js").RemoteClient} deps.remote
 * @param {import("../shared/audit.js").AuditLogger} deps.audit
 * @param {import("./expenseStore.js").ExpenseStore} deps.expenseStore
 */
export async function submitExpenseReview(
  { storeId, action: rawAction, reviewer, note = "" },
  { remote, audit, expenseStore }
) {
  const action = normalizeAction(rawAction);
  const expenseRow = await expenseStore.findById(storeId);
  const verdict = evaluateReviewAction({ expenseRow, reviewer, action, note });
  if (!verdict.allowed) {
    recordReviewRefusal({ audit, expenseRow, action, reviewer, verdict });
    return { ok: false, status: verdict.status, code: verdict.code, reason: verdict.reason };
  }

  const actor = reviewer.trim();
  const { tier } = classifyRisk("UC-02", expenseRow.flags ?? []);
  const status = statusForAction(action);

  // PROVENANCE COMES OFF THE ROW HERE, not off this call. A review happens in a
  // different process from the submission, possibly days later, and the caller
  // holds only a storeId — so the reference the requester was shown and the
  // surface they used are recoverable ONLY because `uc02_expenses` persists
  // both (`external_ref`, `source`). Without that they would be unrecoverable
  // for the named human's verdict, which is the row that matters most. Still
  // never defaulted: a row created before those columns were populated stays
  // honestly null rather than inheriting the reviewer's own surface.
  const externalRef = expenseRow.externalRef ?? null;
  const source = expenseRow.source ?? null;

  // EXECUTE IN THE WORLD THE DECISION WAS MADE IN.
  // An expense submitted through the request portal was validated against this
  // repo's mock Remote (deliberately — a public page must not write into a
  // real account), so its `expenseId` is a mock fixture id like
  // `exp_sandbox_over_cap_402`, which the real Sandbox has never heard of: its
  // expenses are UUIDs, a wholly disjoint set. Releasing such an expense against
  // the real gateway 404'd, which is how this was found — live, by a human
  // clicking Approve (the button read "Release" at the time). Resolved from
  // the row's own durable `source`, never from
  // the shape of the id: the portal's personas MIRROR real employment ids, so
  // getEmployment() succeeds against either world and an id heuristic would be
  // wrong half the time and wrong invisibly. See src/shared/remoteWorld.js.
  const remoteForRow = remoteFor(remote, expenseRow.source);

  // STEP 1 — the verdict, durable, before anything else. See the header.
  await audit.logDurable({
    useCase: "UC-02",
    action: `expense_review_${action}`,
    actor,
    riskTier: tier,
    details: {
      storeId,
      externalRef,
      source,
      expenseId: expenseRow.expenseId,
      employmentId: expenseRow.employmentId,
      reviewAction: action,
      note: note || null,
      // The AI's recommendation, recorded beside the human's verdict. This
      // pairing is what UC-02.md §11's Finance-Ops accept rate is computed
      // from — without it, the metric could only restate its own definition.
      aiDecision: expenseRow.decision,
      aiReason: expenseRow.reason,
      aiFlags: expenseRow.flags ?? [],
    },
  });

  // `hold` stops here: no Remote status exists for it, and the expense stays
  // open to a later approve or decline. See reviewPolicy.js's header.
  if (action === "hold") {
    const held = await expenseStore.markReviewed(storeId, { action, reviewer: actor, note, status });
    return {
      ok: true,
      status: 200,
      code: "held",
      reason:
        "Held by Finance Ops — the expense stays pending at Remote and can still be approved or declined.",
      storeId,
      expense: held,
    };
  }

  // STEP 2 — freshness. Asymmetric by design; see the header.
  const employment = await remoteForRow.getEmployment(expenseRow.employmentId);
  const employmentActive = Boolean(employment && employment.status === "active");
  if (action === "approve" && !employmentActive) {
    await audit.log({
      useCase: "UC-02",
      action: "expense_review_execution_blocked",
      actor,
      riskTier: tier,
      details: {
        storeId,
        externalRef,
        source,
        expenseId: expenseRow.expenseId,
        observedStatus: employment?.status ?? "not_found",
      },
    });
    return {
      ok: false,
      status: 409,
      code: "employment_no_longer_active",
      reason: REVIEW_REFUSALS.employment_no_longer_active.reason,
      storeId,
    };
  }

  // STEP 3 — the operational state moves.
  await expenseStore.markReviewed(storeId, { action, reviewer: actor, note, status });

  // STEP 4 — the outward act. The body is Remote's own closed `oneOf`
  // (UC-02.md §3): `{status:"approved"}` carries NOTHING else, which is what
  // makes asserting VAT recovery structurally impossible rather than merely
  // forbidden; `{status:"declined", reason}` must carry a reason, which
  // reviewPolicy.js has already required before we get here.
  //
  // REMOTE'S `reason` IS NOT OUR `reason`, AND THIS IS THE ONE PLACE THE TWO
  // MEET. `DeclineExpenseParams.reason` is documented as "Reason for
  // declination" and is read back on the expense for DISPLAY TO THE EMPLOYEE
  // (example: "Expense not refundable"). Ours is a machine gate code —
  // `over_policy_cap`, `identity_not_verified` — that exists to be searched in
  // `audit_log` and ranked in the metrics layer. So the reviewer's own `note`
  // is what goes on the wire, deliberately, and `result.reason` never does.
  // "Tidying" this to send the gate code would put `over_policy_cap` in front
  // of the employee whose money it is. REMOTE-VOCABULARY.md §2.4 — the two
  // words collide and the safe answer is to keep both and never map one onto
  // the other.
  const payload =
    action === "approve" ? { status: "approved" } : { status: "declined", reason: note.trim() };
  const remoteResult = await remoteForRow.patchExpenseStatus(expenseRow.expenseId, payload);

  // STEP 5 — what Remote actually said.
  await audit.log({
    useCase: "UC-02",
    action: REVIEW_WRITE_ACTIONS[status],
    actor,
    riskTier: tier,
    details: { storeId, externalRef, source, expenseId: expenseRow.expenseId, payload, remoteResult },
  });
  const finalRow = await expenseStore.recordReviewWrite(storeId, remoteResult);

  return {
    ok: true,
    status: 200,
    code: status,
    reason:
      action === "approve"
        ? "Approved by Finance Ops — the expense was approved at Remote."
        : "Declined by Finance Ops — the expense was declined at Remote with the stated reason.",
    storeId,
    expense: finalRow,
    remoteResult,
  };
}

/**
 * Refusals with no identified actor are not audited — same reasoning as
 * recordRefusal() in uc04/workflow.js and src/review/service.js: an
 * unattributed row in an append-only log is worse than no row.
 */
const UNATTRIBUTED_REVIEW_REFUSALS = new Set([
  "reviewer_required",
  "unknown_action",
  "expense_not_found",
]);

function recordReviewRefusal({ audit, expenseRow, action, reviewer, verdict }) {
  if (!expenseRow || UNATTRIBUTED_REVIEW_REFUSALS.has(verdict.code)) return;
  const { tier } = classifyRisk("UC-02", expenseRow.flags ?? []);
  audit.log({
    useCase: "UC-02",
    action: `expense_review_${action}_refused`,
    actor: typeof reviewer === "string" && reviewer.trim() ? reviewer.trim() : "unknown",
    riskTier: tier,
    details: {
      storeId: expenseRow.id,
      externalRef: expenseRow.externalRef ?? null,
      source: expenseRow.source ?? null,
      refusalCode: verdict.code,
      refusalReason: verdict.reason,
    },
  });
}

