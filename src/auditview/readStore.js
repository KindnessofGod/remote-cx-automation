// ---------------------------------------------------------------------------
// readStore.js  —  Read-only access to the four durable observability tables
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
// The system records every decision durably — `audit_log` (one row per
// decision, written by the Node path AND all nine n8n graphs), `audit_trace`
// (one row per LLM/API *attempt*, parent_id → the decision row), `ops_alerts`
// (one row per failed n8n execution; the ROW is the alert, the Telegram push
// is a convenience), and `workflow_claims` (the exactly-once ledger keyed
// (use_case, external_ref)). What did not exist was any way to LOOK at them:
// watching executions land, or auditing a bug after the fact, meant writing
// SQL by hand. This store is the read side those four tables never had.
//
// READ-ONLY IS STRUCTURAL, NOT POLICED. There is no insert, no update, no
// delete anywhere in this file — the same "no write method exists to ever add
// a bug to" reasoning as src/uc08/dossierStore.js, applied to observability
// data: a viewer that could amend the audit trail would undo the one property
// (append-only) that makes the trail evidence.
//
// READS THROW. This is the §9 rule for anything that feeds a dashboard, and
// it is the opposite of how the WRITE side of audit.js behaves — background
// audit writes swallow errors because a logging failure must never break a
// customer-facing outcome, but a read that swallowed a DB error into an empty
// list would render "nothing happened" over an outage. A wrong number gets
// acted on; a missing one gets investigated. Nothing here catches a pg error.
//
// COLUMN NAMES come from the real Supabase schema (verified via the Supabase
// MCP against project your-project-ref, 2026-08-18) and from the writers
// themselves (src/shared/audit.js, src/shared/workflowClaims.js). Do not
// invent columns — this repo has been burned by fixtures agreeing with code
// while both disagreed with the store (BUILD-LOG §3.30).
//
// THREE MODES, told apart honestly:
//   supabase     a pgPool is attached — every read is a real query.
//   seeded       no pool, demo rows (demoSeed.js) — `npm run audit-ui` on a
//                fresh clone. Every API response carries the mode so the page
//                can say "SEEDED DEMO DATA" instead of letting fabricated rows
//                read as production history.
//   unavailable  no pool and not seeded — the deployed state before
//                SUPABASE_DB_URL is set. Reads THROW no_durable_store rather
//                than serving demo rows on a real URL, where they would be
//                indistinguishable from live history.
// ---------------------------------------------------------------------------

import { claimRefCandidates } from "../shared/claimRef.js";
import { buildDemoDataset } from "./demoSeed.js";
import {
  AUDIT_LOG_DETAIL_KEYS,
  AUDIT_TRACE_DETAIL_KEYS,
  NOT_SEARCHABLE_HERE,
  classifyIdentifier,
  searchedLabels,
} from "./identifiers.js";
import { humanVerdictOf, HUMAN_VERDICT_ACTIONS } from "./humanDecision.js";
import { gateMeaning } from "./gateMeanings.js";

/** ±15 minutes: the window "near in time" means for the bug-audit view. */
export const ALERT_WINDOW_MS = 15 * 60 * 1000;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * THE DECISION VOCABULARY — the actions that ARE a request's answer.
 *
 * Almost all of them are the words a policy engine returns as its `decision`,
 * collected from src/uc01…uc09's policy engines. An `audit_log` row whose
 * `action` is one of these IS the decision; any other action belongs to one —
 * either an EXECUTION (see EXECUTION_ACTIONS below) or an ordinary follow-up
 * EVENT (`expense_auto_approved`, `letter_render_failed`,
 * `human_approve_refused`…).
 *
 * WHY THE DEFINITION IS "THE REQUEST'S ANSWER" AND NOT "WHAT A POLICY ENGINE
 * RETURNED". The two read as the same rule until `duplicate_request_ignored`,
 * which the second definition gets wrong in production. Live, 2026-08-18/19:
 * one expense was submitted twice, two hours apart, and wrote four rows all
 * carrying `storeId 490f2916-…` —
 *
 *   22:31:23.987  auto_approve               submission 1's decision
 *   22:31:23.987  expense_auto_approved      …its pre-write intent
 *   22:31:24.828  expense_approved_write     …its execution
 *   00:40:18.215  duplicate_request_ignored  SUBMISSION 2, in full
 *
 * That last row is not a fourth thing that happened to submission 1. It is
 * everything that happened to submission 2: src/uc02/workflow.js's duplicate
 * gate writes it and RETURNS immediately, so no other row for that request
 * exists anywhere. Left out of this set it renders as "Follow-up event", which
 * asserts something false and consequential — that a decision recorded at
 * 00:40 followed one made two hours and one submission earlier. Every other
 * non-decision action in this system accompanies a decision row written by the
 * same invocation; this one is written INSTEAD of one.
 *
 * So it is a decision, and it is one in substance too: refusing to act on a
 * claim already decided is a verdict on a request, the same shape as `blocked`
 * or `out_of_scope`. That the gate lives in workflow.js rather than
 * policyEngine.js is a fact about where the code sits, not about what the row
 * means.
 *
 * It was NOT given a kind of its own. The question the feed's Kind column
 * answers is "which row is this request's answer?", and a fourth badge would
 * split that answer across two words while helping no one — and the class
 * would have exactly one member and no principle for admitting a second.
 *
 * IT IS THE ONLY REFUSAL-TO-REPROCESS THAT IS VISIBLE HERE AT ALL, which is
 * worth knowing before looking for its siblings. The delivery-level ledger
 * (`claimExternalRef`, src/shared/workflowClaims.js) writes NO audit row: every
 * `if (!claim.claimed)` branch across UC-01…UC-09 returns silently, and the n8n
 * graphs' `Duplicate Delivery — Stop` NoOp writes nothing either. A redelivered
 * webhook therefore leaves a `workflow_claims` row and no `audit_log` row —
 * findable through the bug-audit view's claims panel, never through this feed.
 * Only UC-02's application-level gate, which answers a genuinely separate
 * request rather than a repeated delivery of one, records anything here.
 *
 * A GROUP MAY THEREFORE HOLD MORE THAN ONE DECISION ROW. Nothing downstream
 * may assume otherwise — see traceVerdict.js's decisionAuthorising(), which
 * picks the most recent decision recorded BEFORE the row being explained
 * rather than simply the first one in the group.
 *
 * WHY THIS MATTERS, AND WHY IT IS HERE RATHER THAN IN THE BROWSER. One portal
 * expense submission writes THREE audit_log rows in the same second — the
 * `auto_approve` decision, then `expense_auto_approved`, then
 * `expense_approved_write`. Presented as peers, a reader cannot tell which row
 * IS the decision, clicks a follow-up, and gets an empty Attempts table that
 * looks like a defect. Naming the kind is a judgement about the data, so it is
 * derived server-side and rendered, never re-derived in the page.
 *
 * A HUMAN'S VERDICT IS A DECISION, AND THAT COST THE MOST TO GET WRONG. Live,
 * 2026-08-19, a Finance Ops specialist authorised a real reimbursement and the
 * feed rendered it like a tag update:
 *
 *   04:50:48.103  UC-02  expense_review_release   Follow-up event
 *   04:50:48.453  UC-02  expense_released_write   Follow-up event
 *
 * The first row is the single most consequential act in the whole 🟡 design — a
 * person authorising money — and it satisfies this set's own definition
 * exactly: it is a verdict on a request, and src/uc02/workflow.js writes it
 * INSTEAD of a second automated decision row, not alongside one (the policy
 * engine does not re-run; nothing else anywhere records that person's answer).
 * That is the same reasoning `duplicate_request_ignored` was admitted on. The
 * fourteen human-verdict actions therefore live below, and the vocabulary they
 * come from — with the plain word for what each one decided, and why the
 * refusals and the blocked-execution rows are NOT here — is
 * ./humanDecision.js's HUMAN_VERDICTS. Kept there rather than inlined because
 * the same list has to answer two questions ("is this a decision?" here, "what
 * did they decide?" on the drill-down), and two copies of it would drift.
 *
 * An action NOT in this set is called an event — deliberately the safe
 * direction: a decision word this list misses reads as "follow-up event",
 * which under-claims, where the reverse would label a write as a decision.
 */
export const DECISION_ACTIONS = new Set([
  "auto_resolve",
  "auto_approve",
  "human_review",
  "escalate",
  "blocked",
  "route_to_uc04",
  "ready_for_approval",
  "prepared_for_signoff",
  "dual_approval_required",
  "triple_approval_required",
  "off_cycle_adjustment_required",
  "out_of_scope",
  // The whole of a second submission — see the block above. Not a follow-up of
  // the decision it replays; the answer to a request that was made again.
  "duplicate_request_ignored",
  // Every action a PERSON's verdict is recorded under, across all nine use
  // cases and the ZAF sidebar. Spread rather than restated: humanDecision.js
  // owns the derivation and the exclusions, and a second hand-typed copy here
  // is precisely how the two would come to disagree.
  ...HUMAN_VERDICT_ACTIONS,
]);

/**
 * THE SUBSET OF DECISION_ACTIONS THAT SETTLES A REQUEST, rather than handing
 * it to a further step. rca-8mmd / R7-30: the bug-audit view stamped a
 * reference "Fully traceable" while the only decision row under it was
 * `human_review` — the request was still sitting in review, with the
 * eventual approval recorded under a DIFFERENT reference entirely (the
 * Zendesk ticket id issued at the hand-off). "The ledger claimed this string
 * and audit_log rows carry it" was true and answered a different question
 * than the headline asked.
 *
 * A zero-touch resolution/approval, a refusal, and the recorded whole answer
 * to a resubmission are the only automated decisions with nothing further to
 * happen. Everything else `DECISION_ACTIONS` names is a hand-off: a human
 * verdict that fills only one of several required slots or defers
 * (`humanVerdictOf(...).shape !== "settles"`), or an automated decision that
 * routes the request to a person or another use case (`human_review`,
 * `escalate`, `route_to_uc04`, `ready_for_approval`, `prepared_for_signoff`,
 * `dual_approval_required`, `triple_approval_required`,
 * `off_cycle_adjustment_required`).
 */
const TERMINAL_DECISION_ACTIONS = new Set([
  "auto_resolve",
  "auto_approve",
  "blocked",
  "out_of_scope",
  "duplicate_request_ignored",
]);

/**
 * Does this decision action settle the request, or hand it off awaiting a
 * further step?
 *
 * Read off `DECISION_ACTIONS`/`TERMINAL_DECISION_ACTIONS` rather than
 * re-derived from the shape of the string, for the same reason the rest of
 * this vocabulary is centralised: a second list of the same action names is
 * exactly how they drift apart. An action this vocabulary does not recognise
 * as a decision at all returns `null` — not a decision row, so the question
 * does not apply; an action it recognises but has not been told is terminal
 * defaults to "hand-off", the same under-claiming direction `withKind()`
 * already takes for `kind` itself.
 *
 * @param {string} action
 * @returns {boolean|null} true if settled, false if a hand-off still
 *   awaiting a further step, null if `action` is not a decision at all.
 */
export function decisionReachesOutcome(action) {
  if (!DECISION_ACTIONS.has(action)) return null;
  if (TERMINAL_DECISION_ACTIONS.has(action)) return true;
  const verdict = humanVerdictOf(action);
  if (verdict) return verdict.shape === "settles";
  return false;
}

/**
 * THE EXECUTION VOCABULARY — the actions that record a REAL OUTWARD ACT:
 * a write that left this system and changed something at Remote. Every one is
 * written AFTER its `remote.*` call returned, and every one carries that call's
 * response in `details.remoteResult`. That is the test, and it is the reason
 * this list is six entries long and not sixteen.
 *
 * WHY THIS EXISTS. `expense_approved_write` used to render as "Follow-up
 * event", which is true and useless: it is the row carrying Remote's own
 * `{"status": "approved"}`, the only proof in the whole group that a
 * reimbursement was actually approved. Calling the most consequential row in a
 * submission by the same word as a render-failure notice buries it.
 *
 * DERIVED BY READING THE WRITERS, one call site at a time — never from the
 * shape of the string. `_write` and `_executed` are a hint and nothing more:
 * `amendment_execution_blocked` and `adjustment_execution_not_claimed` both
 * carry "execution" and both mean the opposite (nothing was written), and
 * `resignation_signed_off` carries neither suffix while being the closest UC-05
 * has to a completion.
 *
 *   expense_approved_write   src/uc02/workflow.js — after
 *                            remote.patchExpenseStatus(...) resolves. The
 *                            AUTOMATED approval path.
 *   expense_released_write   src/uc02/workflow.js, submitExpenseReview() STEP 5
 *   expense_declined_write   — the HUMAN path's pair, and the same test passes
 *                            for both: each is appended after that same
 *                            `patchExpenseStatus()` resolves, carrying
 *                            `remoteResult` in `details`. Their names are built
 *                            from `statusForAction()` rather than written as
 *                            literals (`expense_${status}_write`), which is why
 *                            grepping the source for the string finds nothing —
 *                            read the call site, not the file's text.
 *                            A decline is as much an outward act as a release:
 *                            it PATCHes `{status:"declined", reason}` at Remote
 *                            and changes the claim's state there.
 *                            `expense_held_write` does NOT exist and must never
 *                            be added: the hold branch returns before STEP 2,
 *                            so no Remote call and no such row is ever written.
 *   workation_executed       src/uc04/workflow.js — after
 *                            remote.patchWorkAuthorization(...) resolves.
 *   amendment_executed       src/uc06/workflow.js — after
 *                            remote.createContractAmendment(...) resolves.
 *   adjustment_executed      src/uc09/workflow.js — after
 *                            remote.createIncentive(...) resolves. The money.
 *
 * WHAT WAS READ AND DELIBERATELY LEFT OUT, because each one would claim an
 * outward act that had not happened:
 *
 *   expense_auto_approved     UC-02 writes this DURABLY BEFORE the PATCH, so
 *                             the row exists whether or not the write landed.
 *                             An intent, not a result.
 *   workation_approved        the approver's slot, recorded before the PATCH.
 *   amendment_approved        same, and one of two slots — the write may still
 *   adjustment_approved       be several approvals away, or never happen.
 *   expense_review_release    UC-02's human verdict, logged DURABLY FIRST —
 *   expense_review_decline    before the freshness re-read, the state move and
 *   expense_review_hold       the PATCH — so the row exists even when nothing
 *                             is ever sent. `hold` never sends anything at all.
 *   human_approved            src/review/service.js audits FIRST and only then
 *   human_denied              touches Zendesk; the row precedes the act.
 *   resignation_signed_off    UC-05 has NO confirmed Remote write endpoint at
 *                             all (CLAUDE.md §4) — the signed-off report is the
 *                             artifact. Nothing left the system.
 *
 *                             ALL OF THE ABOVE ARE NOW DECISIONS (see the block
 *                             above): each is a person's verdict, and each is
 *                             the only row recording it. They stay out of THIS
 *                             list for the reason given beside them — being a
 *                             verdict and being an outward act are different
 *                             claims, and this list makes only the second.
 *   *_execution_blocked       a refusal. The freshness re-check said no.
 *   *_execution_not_claimed   another caller won the compare-and-set.
 *   *_refused, *_denied       refusals.
 *   letter_render_failed      a failure, upstream of anything customer-facing.
 *   amendment_*_consented     src/remoteui/server.js audits first, then posts a
 *                             best-effort note. The consent is the record.
 *
 * `duplicate_request_ignored` is on NEITHER list, and that is the point: it is
 * a DECISION (see the block above), not a follow-up of the one it replays.
 *
 * UC-01 HAS NO ENTRY HERE, AND THAT IS NOT AN OMISSION. Its customer-facing
 * act — `zendesk.resolveWithLetter()` at STEP 8 of src/uc01/workflow.js — is
 * never audited as a row of its own; `letterIssued` rides inside the decision
 * row instead. Nothing to classify, so nothing is classified.
 *
 * THE SAFETY DIRECTION IS THE SAME ONE DECISION_ACTIONS TAKES, and it points
 * the same way for the same reason: an action this list does not know stays an
 * `event`. Under-claiming makes a real write read as a dull follow-up, which
 * costs a reader one extra click. Over-claiming tells a reader money moved when
 * it did not, which is the error that gets acted on. When a new write path is
 * added, add it here only after reading the call site and confirming the row is
 * written after the response, carrying it.
 *
 * THE UC-02 RENAME LANDING BESIDE THIS. Its review verb `release` is becoming
 * `approve`, and the write's new name is being chosen deliberately rather than
 * collapsed into `expense_approved_write` — that string already names the
 * AUTOMATED approval's write, and one name for both would leave the metrics
 * unable to tell an automated approval from a human one. The legacy pair below
 * therefore stays forever (append-only history keeps writing rows under it
 * true), and the new name is NOT guessed at here: an entry for an action no
 * writer produces would break the very check that keeps this list honest
 * (test/auditview.test.js verifies every entry against its call site). That
 * test derives UC-02's review-write names from `statusForAction()` instead of
 * restating them, so the day the rename lands `npm test` names the string to
 * add rather than the vocabulary silently under-claiming again.
 */
export const EXECUTION_ACTIONS = new Set([
  "expense_approved_write",
  // UC-02's human review path — both verdicts that reach Remote. Built from
  // statusForAction(), so `release` -> released, `decline` -> declined.
  // The human-review path's writes. BOTH SPELLINGS, permanently: `release` was
  // renamed to `approve` on 2026-08-19, and the rows already in `audit_log`
  // under the old names never stop being real — append-only means the log
  // records what the system called things at the time.
  "expense_released_write",
  "expense_declined_write",
  "expense_review_approved_write",
  "expense_review_declined_write",
  "workation_executed",
  "amendment_executed",
  "adjustment_executed",
]);

/**
 * THE CORRELATION KEYS, in priority order — the RECORD id each use case writes
 * into `details` on its decision row and on every row that follows it. These
 * are read off the writers themselves (src/uc0N/workflow.js,
 * src/review/service.js), not inferred:
 *
 *   caseId          UC-01 / UC-03 (and the ZAF sidebar's approve/deny rows)
 *   storeId         UC-02   amendmentId  UC-06   authorizationId  UC-04
 *   resignationId   UC-05   adjustmentId UC-09   dossierId        UC-07/UC-08
 *
 * A RECORD, NOT A SUBMISSION — the distinction is small and the wording used to
 * get it wrong. Live, 2026-08-18/19, one expense was submitted twice two hours
 * apart and produced four rows under one `storeId`: submission 1's decision,
 * its pre-write intent and its execution, then submission 2 in full
 * (`duplicate_request_ignored`). Grouping all four is CORRECT — they are one
 * expense record and a reader auditing that expense wants all four. Calling
 * them "the rows of this submission" is not, and the page no longer does.
 *
 * `storeId` precedes `expenseId` because `storeId` is the id of the stored
 * DECISION record for this expense, which is what ties a decision to its
 * follow-ups; `expenseId` is Remote's id for the claim and is carried too.
 * `reviewId` is last because a review row also carries the `caseId` that ties
 * it to the decision it reviewed, which is the more useful grouping.
 *
 * TIME PROXIMITY IS NOT ON THIS LIST, on purpose. Three rows landing in the
 * same millisecond is evidence of nothing — two unrelated submissions can do
 * that, and a busy day guarantees it. Either a row carries a shared record id
 * or its siblings are not identifiable, and the viewer says which.
 */
export const CORRELATION_FIELDS = [
  "caseId",
  "storeId",
  "amendmentId",
  "authorizationId",
  "resignationId",
  "adjustmentId",
  "dossierId",
  "expenseId",
  "reviewId",
];

/** The first correlation key a row carries, as a scalar SQL expression. */
const CORRELATION_KEY_EXPR = `coalesce(${CORRELATION_FIELDS.map((f) => `details->>'${f}'`).join(", ")})`;

/** The SQL that turns the list above into (field name, value) on every row. */
const CORRELATION_SQL = `
  case
    ${CORRELATION_FIELDS.map((f) => `when details ? '${f}' then '${f}'`).join("\n    ")}
  end                                    as "correlationField",
  ${CORRELATION_KEY_EXPR} as "correlationKey"`;

/** One subquery, one row: how many attempts sit under this decision. */
const TRACE_COUNT_SQL = `(select count(*)::int from audit_trace t where t.parent_id = audit_log.id) as "traceCount"`;

const DECISION_SUMMARY_COLUMNS = `
  id,
  at,
  use_case              as "useCase",
  action,
  actor,
  risk_tier             as "riskTier",
  details->>'externalRef'  as "externalRef",
  details->>'reason'       as "reason",
  details->>'employmentId' as "employmentId",
  details->>'source'       as "source",
  details->>'priorDecision' as "priorDecision",
  details->'flags'         as "flags",
  -- THE HUMAN HALF OF A ROW. A person's verdict is worth nothing on a page
  -- that shows only that it happened: who, in which role, with what note, and
  -- against what the AI had recommended. The actor column above is the who;
  -- these three are the rest, and all four are written by the approval handlers
  -- on every human-verdict row (src/uc02/workflow.js's submitExpenseReview and
  -- its siblings in uc04/05/06/09, plus src/review/service.js).
  details->>'note'         as "note",
  details->>'role'         as "role",
  details->>'aiDecision'   as "aiDecision",
  -- Not the response itself — just whether Remote's own answer is on this row.
  -- That single boolean is what separates "the write landed" from "a human said
  -- yes and nothing records Remote having taken it", and it is small enough to
  -- carry on every summary so the drill-down can answer without a second query.
  (details ? 'remoteResult') as "hasRemoteResult",
  ${CORRELATION_SQL},
  ${TRACE_COUNT_SQL}`;

const ALERT_COLUMNS = `
  id,
  at,
  use_case       as "useCase",
  workflow_name  as "workflowName",
  workflow_id    as "workflowId",
  execution_id   as "executionId",
  execution_url  as "executionUrl",
  failed_node    as "failedNode",
  risk_tier      as "riskTier",
  error_message  as "errorMessage",
  audit_durable  as "auditDurable",
  acknowledged`;

const CLAIM_COLUMNS = `
  use_case     as "useCase",
  external_ref as "externalRef",
  claimed_at   as "claimedAt",
  decision,
  note`;

const TRACE_COLUMNS = `
  id,
  at,
  parent_id as "parentId",
  call,
  attempt,
  ok,
  error,
  details`;

/** The typed error the "unavailable" mode throws. The server maps it to 503. */
export class NoDurableStoreError extends Error {
  constructor() {
    super(
      "no durable store is attached: SUPABASE_DB_URL is unset and this process was not started in " +
        "seeded demo mode. There is no audit history here to read — attach Supabase, or run " +
        "`npm run audit-ui -- --seeded` locally for labelled demo rows."
    );
    this.code = "no_durable_store";
  }
}

export class AuditReadStore {
  /**
   * @param {object} [opts]
   * @param {import("pg").Pool|null} [opts.pgPool]  real reads when set
   * @param {boolean} [opts.seeded]  serve the demo dataset when no pool is set
   * @param {object} [opts.seedData]  test seam: a prebuilt dataset (demoSeed shape)
   * @param {() => number} [opts.now]  test seam for the seeded dataset's clock
   */
  constructor({ pgPool = null, seeded = false, seedData = null, now = Date.now } = {}) {
    this.pgPool = pgPool;
    this.seeded = !pgPool && (seeded || Boolean(seedData));
    this.demo = this.seeded ? (seedData ?? buildDemoDataset(now())) : null;
  }

  /** "supabase" | "seeded" | "unavailable" — every API response reports it. */
  mode() {
    if (this.pgPool) return "supabase";
    if (this.seeded) return "seeded";
    return "unavailable";
  }

  #require() {
    if (!this.pgPool && !this.seeded) throw new NoDurableStoreError();
  }

  /**
   * The seeded equivalent of the feed query's `traceCount` subquery. Computed
   * once, because the demo dataset never changes under a running process.
   */
  #seedTraceCounts() {
    if (!this._traceCounts) {
      this._traceCounts = new Map();
      for (const t of this.demo.auditTrace) {
        this._traceCounts.set(t.parentId, (this._traceCounts.get(t.parentId) ?? 0) + 1);
      }
    }
    return this._traceCounts;
  }

  #summarizeSeeded(row) {
    return summarize(row, this.#seedTraceCounts().get(row.id) ?? 0);
  }

  /**
   * The feed: decisions newest first, one page at a time.
   *
   * KEYSET PAGINATION ON `(at, id)`, NOT OFFSET, AND THE TIEBREAK IS THE POINT.
   * `at` is not unique — one portal expense submission writes three rows in
   * the same second and two of them routinely share a millisecond, and ticket
   * #5's duplicate delivery produced two rows 30µs apart. A cursor of `at`
   * alone therefore either SKIPS a row (`at < cursor` drops its same-instant
   * neighbour) or REPEATS it (`at <= cursor` re-serves it), and which one you
   * get depends on where the page edge happens to fall. That is the same class
   * of defect the repo keyed `workflow_claims` on a composite to avoid, so the
   * cursor here is the composite `(at, id)` too — a total order, with `id`
   * deciding only when `at` cannot. OFFSET has a second problem on top: rows
   * arrive at the head while a reader pages, so page 3 by offset shows rows
   * page 2 already showed.
   *
   * `before` pages BACKWARD through history (strictly older than the cursor);
   * `since` is the live tail (strictly newer). They are opposite ends of the
   * same order and the page never sends both — paging away from the newest
   * page pauses the tail, because prepending rows under a reader on page 3
   * would shift everything they are looking at.
   *
   * One extra row is fetched beyond the page size purely to answer `hasMore`
   * honestly: "there is another page" is a fact about the store, and guessing
   * it from a full page would claim a next page that may not exist.
   *
   * @param {object} [filters]
   * @param {string|null} [filters.useCase]   exact match, e.g. "UC-06"
   * @param {string|null} [filters.action]    exact match, e.g. "escalate"
   * @param {string|null} [filters.q]         case-insensitive substring
   * @param {string|null} [filters.since]     ISO timestamp; strictly newer only
   * @param {string|null} [filters.sinceId]   tiebreak for `since` (composite tail)
   * @param {{at: string, id: string}|null} [filters.before]  page-back cursor
   * @param {number} [filters.limit]          capped at 200
   * @returns {Promise<{decisions: object[], hasMore: boolean, nextCursor: object|null,
   *   pageSize: number}>}
   */
  async listDecisions({
    useCase = null,
    action = null,
    q = null,
    since = null,
    sinceId = null,
    before = null,
    limit = 50,
  } = {}) {
    this.#require();
    const cap = clampLimit(limit);

    let rows;
    if (this.seeded) {
      rows = this.demo.auditLog
        .filter((row) => matchesFilters(row, { useCase, action, q, since, sinceId, before }))
        .sort(cmpRowDesc)
        .slice(0, cap + 1)
        .map((row) => this.#summarizeSeeded(row));
    } else {
      // E4-F15 (rca-0nm): `at` carries Postgres's full microsecond precision,
      // but `since` is whatever the CLIENT was handed back for its own
      // previous newest row — and node-postgres parses `timestamptz` into a
      // JS `Date`, which HOLDS ONLY millisecond precision, before this store's
      // isoAt() ever calls toISOString(). So `since` is always <= the real
      // `at` of the very row it names, and comparing the two AS TIMESTAMPS
      // (in SQL or otherwise) — however the tiebreak is written — makes that
      // same row satisfy "newer than itself" on every poll forever: ticket
      // #109's row was re-served 3, 5, then 6 times across three polls six
      // seconds apart, with `audit_log` holding exactly one row for it the
      // whole time.
      //
      // Fixed by not comparing timestamps of two different precisions at all.
      // The SQL fetch below is deliberately COARSE (`at >= $3`, inclusive, so
      // it can never skip the boundary row) and the exact "strictly newer"
      // decision is made afterwards in JS, on `rows` — which by then have
      // already been through the exact same isoAt() truncation the CLIENT's
      // copy went through. Both sides are now comparing the identical
      // representation, so `isNewerThan()` (below), the same tiebreak the
      // seeded path already uses, is correct here for the same reason it is
      // correct there. `TIE_SLACK` covers rows sharing the boundary row's
      // exact millisecond that the coarse fetch pulls in ahead of `cap`.
      const TIE_SLACK = since ? 20 : 0;
      const result = await this.pgPool.query(
        `select ${DECISION_SUMMARY_COLUMNS}
           from audit_log
          where ($1::text is null or use_case = $1)
            and ($2::text is null or action = $2)
            and ($3::timestamptz is null or at >= $3::timestamptz)
            -- The free-text filter. The correlation key is in here because the
            -- reference lookup's own advice depends on it: when a decision row
            -- does not carry the reference, refVerdict.js tells the reader to
            -- search the feed for the RECORD id instead, and until that
            -- expression was on this list the instruction pointed at something
            -- the feed could not do. Advice a surface cannot honour is worse
            -- than no advice.
            and ($4::text is null
                 or actor ilike $4
                 or details->>'externalRef' ilike $4
                 or details->>'reason' ilike $4
                 or ${CORRELATION_KEY_EXPR} ilike $4)
            -- The page-back cursor. Row-wise comparison, so id breaks the tie
            -- only when at is equal; uuid's byte order and the canonical
            -- lowercase-hex text order agree, so this matches the seeded
            -- path's string compare exactly.
            and ($5::timestamptz is null or (at, id) < ($5::timestamptz, $6::uuid))
          order by at desc, id desc
          limit $7`,
        [
          useCase,
          action,
          since,
          q ? `%${q}%` : null,
          before ? before.at : null,
          before ? before.id : null,
          cap + 1 + TIE_SLACK,
        ]
      );
      rows = result.rows.map((r) => isoAt(coerceFlags(r)));
      // Same branching as matchesFilters() below: with a sinceId, the (at, id)
      // tiebreak; without one, a plain strictly-newer timestamp check.
      if (since) {
        rows = rows.filter((row) =>
          sinceId ? isNewerThan(row, { at: since, id: sinceId }) : cmpAsc(since, row.at) < 0
        );
      }
    }

    const hasMore = rows.length > cap;
    const decisions = rows.slice(0, cap).map(withKind);
    const last = decisions[decisions.length - 1];
    return {
      decisions,
      hasMore,
      nextCursor: hasMore && last ? { at: last.at, id: last.id } : null,
      pageSize: cap,
    };
  }

  /**
   * The oldest `audit_trace` row in the store, or null when the table is empty.
   *
   * This is what makes "this decision PREDATES per-attempt tracing" a claim
   * from data rather than a shrug: a decision recorded before the first trace
   * row that exists anywhere could not have been traced, whatever it did.
   *
   * @returns {Promise<string|null>} ISO timestamp
   */
  async earliestTraceAt() {
    this.#require();
    if (this.seeded) {
      const times = this.demo.auditTrace.map((t) => toIso(t.at)).filter(Boolean).sort();
      return times[0] ?? null;
    }
    const result = await this.pgPool.query(`select min(at) as at from audit_trace`);
    const value = result.rows[0]?.at ?? null;
    return value ? toIso(value) : null;
  }

  /**
   * One decision, drilled into: the full audit_log row, every audit_trace
   * attempt underneath it (oldest first, the order they happened), and the
   * SIBLING rows sharing its record id.
   *
   * WHY SIBLINGS. The row a reader clicks is often not the decision — a UC-02
   * expense submission writes `auto_approve` (the decision), then
   * `expense_auto_approved`, then `expense_approved_write`, and only the first
   * has attempts under it. Correlating them by the record id all three carry
   * (CORRELATION_FIELDS) turns an unexplained empty Attempts table into "this
   * is a follow-up event; the traced work is on the decision row, here."
   * A group is scoped to a RECORD, not to one submission — see
   * CORRELATION_FIELDS for the live case where a second submission joined an
   * existing group two hours later, and why that is the right grouping.
   * A row whose details carry NO key on that list gets `correlation.field =
   * null` and no siblings, which the page states plainly rather than guessing
   * — the whole point is not to invent a relationship the data does not carry.
   *
   * A non-UUID id is a not-found, answered locally — passing it to Postgres
   * would throw a cast error on the uuid column, and "you asked about a row
   * that cannot exist" is not a store failure.
   *
   * @param {string} id  the audit_log row id
   * @returns {Promise<{decision: object, trace: object[],
   *   correlation: {field: string|null, key: string|null}, siblings: object[]}|null>}
   */
  async getDecision(id) {
    this.#require();

    if (this.seeded) {
      const decision = this.demo.auditLog.find((row) => row.id === id);
      if (!decision) return null;
      const trace = this.demo.auditTrace
        .filter((t) => t.parentId === id)
        .sort((a, b) => cmpAsc(a.at, b.at) || (a.attempt ?? 0) - (b.attempt ?? 0));
      const correlation = correlationOf(decision.details);
      const siblings = !correlation.field
        ? []
        : this.demo.auditLog
            .filter(
              (row) =>
                row.id !== id &&
                row.useCase === decision.useCase &&
                String(row.details?.[correlation.field] ?? "") === correlation.key
            )
            .sort((a, b) => cmpAsc(a.at, b.at))
            .map((row) => withKind(this.#summarizeSeeded(row)));
      return { decision: withKind(decision), trace, correlation, siblings };
    }

    if (!UUID_RE.test(String(id))) return null;
    const decisionResult = await this.pgPool.query(
      `select id, at, use_case as "useCase", action, actor, risk_tier as "riskTier", details
         from audit_log where id = $1`,
      [id]
    );
    if (!decisionResult.rows[0]) return null;
    const decision = withKind(isoAt(coerceDetails(decisionResult.rows[0])));
    const traceResult = await this.pgPool.query(
      `select ${TRACE_COLUMNS} from audit_trace where parent_id = $1 order by at asc, attempt asc`,
      [id]
    );

    const correlation = correlationOf(decision.details);
    let siblings = [];
    if (correlation.field) {
      // The field name travels as a PARAMETER to `->>`, never interpolated —
      // it comes from CORRELATION_FIELDS and could be a constant, but a query
      // built by concatenation is a habit worth not having on a table whose
      // whole value is being untampered-with.
      const siblingResult = await this.pgPool.query(
        `select ${DECISION_SUMMARY_COLUMNS}
           from audit_log
          where use_case = $1 and details->>$2 = $3 and id <> $4
          order by at asc, id asc`,
        [decision.useCase, correlation.field, correlation.key, id]
      );
      siblings = siblingResult.rows.map((r) => withKind(isoAt(coerceFlags(r))));
    }

    return {
      decision,
      trace: traceResult.rows.map((r) => isoAt(coerceDetails(r))),
      correlation,
      siblings,
    };
  }

  /**
   * The ops alerts, newest first. The row IS the alert — the Telegram push is
   * a convenience that may fail without losing anything (CLAUDE.md §4) — and
   * `auditDurable` is the column that matters: it answers whether a failure
   * lost a decision or only lost a Zendesk update.
   *
   * @param {object} [opts]
   * @param {number} [opts.limit]
   */
  async listAlerts({ limit = 100 } = {}) {
    this.#require();
    const cap = clampLimit(limit);

    if (this.seeded) {
      return [...this.demo.opsAlerts].sort((a, b) => cmpDesc(a.at, b.at)).slice(0, cap);
    }

    const result = await this.pgPool.query(
      `select ${ALERT_COLUMNS} from ops_alerts order by at desc limit $1`,
      [cap]
    );
    return result.rows.map(isoAt);
  }

  /**
   * The bug-audit lookup: everything one external ref touched.
   *
   *   claims     — its workflow_claims rows (was it claimed? by which use
   *                case? one ref can legitimately be claimed by two — UC-03
   *                routes on to UC-04 — which is why the ledger is keyed by
   *                both). Ordered oldest first: this is a timeline.
   *   decisions  — every audit_log row whose details carry this externalRef.
   *                TWO rows under ONE (useCase, ref) is the duplicate-delivery
   *                signature that predates the claim ledger (ticket #5's two
   *                rows 30µs apart).
   *   alerts     — ops_alerts within ±15 minutes of any of the above. Time
   *                proximity, honestly labelled as such: ops_alerts carries no
   *                ref column, so "near" is the strongest join that exists.
   *
   * @param {string} externalRef
   * @returns {Promise<{claims: object[], decisions: object[], alerts: object[],
   *   alertWindow: {from: string, to: string}|null}>}
   */
  async lookupRef(externalRef) {
    this.#require();
    const ref = String(externalRef);

    // BOTH SPELLINGS OF THE CLAIM KEY. Since 2026-08-31 the ledger keys a bare
    // Zendesk ticket number under `<account>:<ref>` (src/shared/claimRef.js —
    // the account move made `93` name two unrelated tickets). Rows written
    // before that hold the bare form, and a human typing `93` here means "the
    // ticket in front of me". Searching one spelling would report "never
    // claimed" for half the ledger, which on THIS screen is not a cosmetic
    // miss: an absent claim row is read as "the exactly-once ledger did not
    // protect this ticket".
    //
    // `decisions` below is deliberately NOT widened: only the claim node's key
    // changed. `audit_log.details->>'externalRef'` still carries the bare
    // ticket number, and widening it would match nothing while implying the
    // audit trail had moved too.
    const claimKeys = claimRefCandidates(ref);

    let claims;
    let decisions;
    if (this.seeded) {
      claims = this.demo.workflowClaims
        .filter((c) => claimKeys.includes(c.externalRef))
        .sort((a, b) => cmpAsc(a.claimedAt, b.claimedAt));
      decisions = this.demo.auditLog
        .filter((row) => String(row.externalRef ?? row.details?.externalRef ?? "") === ref)
        .sort((a, b) => cmpAsc(a.at, b.at))
        .map((row) => withKind(this.#summarizeSeeded(row)));
    } else {
      const claimsResult = await this.pgPool.query(
        `select ${CLAIM_COLUMNS} from workflow_claims where external_ref = any($1) order by claimed_at asc`,
        [claimKeys]
      );
      const decisionsResult = await this.pgPool.query(
        `select ${DECISION_SUMMARY_COLUMNS}
           from audit_log
          where details->>'externalRef' = $1
          order by at asc`,
        [ref]
      );
      claims = claimsResult.rows.map((r) => isoAt(r, "claimedAt"));
      decisions = decisionsResult.rows.map((r) => withKind(isoAt(coerceFlags(r))));
    }

    const window = timeWindow([
      ...claims.map((c) => c.claimedAt),
      ...decisions.map((d) => d.at),
    ]);

    let alerts = [];
    if (window) {
      if (this.seeded) {
        alerts = this.demo.opsAlerts
          .filter((a) => a.at >= window.from && a.at <= window.to)
          .sort((a, b) => cmpAsc(a.at, b.at));
      } else {
        const alertsResult = await this.pgPool.query(
          `select ${ALERT_COLUMNS} from ops_alerts
            where at between $1::timestamptz and $2::timestamptz
            order by at asc`,
          [window.from, window.to]
        );
        alerts = alertsResult.rows.map(isoAt);
      }
    }

    return { claims, decisions, alerts, alertWindow: window };
  }

  /**
   * THE ONE LOOKUP BOX: try a value against every identifier the four tables
   * carry, rather than making the reader classify their own id first.
   *
   * WHY IT EXISTS. `lookupRef()` above searches ONE key, `externalRef`. A
   * person reached this viewer holding the reference the portal had shown them
   * and got three empty tables — while the decision sat in `audit_log` under a
   * different reference entirely. Empty read as "never recorded"; the truth was
   * "recorded under another key". A viewer whose miss is indistinguishable from
   * a system failure is worse than no viewer, because it converts a working
   * system into a reported outage.
   *
   * FOUR QUERIES, NOT SIXTEEN. One per table, each a single pass with the
   * candidate places OR'd together — never one query per key. Everything is an
   * EXACT match: an identifier is exact, and a substring lookup on an id
   * returns a superset nobody asked for (the feed's `q` is the substring tool,
   * and it says so). The value travels as `$1` and appears in the SQL text
   * exactly nowhere; the key names come from ./identifiers.js, which is a
   * module constant whose shape a test asserts.
   *
   * THE COST, MEASURED RATHER THAN GUESSED. `details->>'k' = $1` is not
   * indexable without an expression index per key, so each probe is a
   * sequential scan. On the live store (218 audit_log rows, 224 audit_trace,
   * 101 ops_alerts, 57 workflow_claims) `EXPLAIN ANALYZE` reports 0.38 ms for
   * the audit_log pass. That is free today and will not be at a million rows,
   * so three bounds are built in rather than promised later: every probe is
   * capped at `limit` rows (default 50, hard max 200 via clampLimit); the four
   * probes run concurrently rather than in series; and the expensive
   * exhaustive pass below runs ONLY on a total miss. See docs/AUDIT-VIEWER.md
   * for the index to add when the numbers change — it is a GIN index and a
   * rewrite to `@>`, and neither is worth carrying before it pays.
   *
   * THE SECOND PASS IS THE HONEST PART. When nothing in the registry matches,
   * one bounded `jsonb_each_text` scan asks a different question: does this
   * value appear under ANY key of `details`, including one this registry has
   * never heard of? A hit there is reported as exactly that — found under an
   * unregistered key, which is named — because "the viewer cannot search by
   * this id" and "the viewer does not know this id exists" are different
   * failures and only one of them is the reader's problem. It is the rare path
   * by construction: a miss is precisely when the extra scan is worth paying
   * for, and precisely when the reader is most stuck.
   *
   * @param {string} value
   * @param {object} [opts]
   * @param {number} [opts.limit]  rows per probe (capped at 200)
   * @returns {Promise<object>}
   */
  async lookupIdentifier(value, { limit = 50 } = {}) {
    this.#require();
    const raw = String(value ?? "").trim();
    const cap = clampLimit(limit);
    const shape = classifyIdentifier(raw);
    const searched = searchedLabels(raw);

    if (raw === "") {
      return emptyLookup(raw, shape, searched, cap);
    }

    const uuid = UUID_RE.test(raw) ? raw : null;
    let decisions;
    let traces;
    let claims;
    let alerts;

    if (this.seeded) {
      decisions = this.demo.auditLog
        .filter((row) => matchesAuditLogIdentifier(row, raw, uuid))
        .sort(cmpRowDesc)
        .slice(0, cap)
        // `details` rides along because the match fields are computed from it.
        // The summary shape alone cannot answer "which key matched": it lifts
        // only externalRef, employmentId and the first CORRELATION_FIELDS hit
        // into columns, so a hand-off key like `uc03CaseId` — which is not a
        // correlation field — would be filtered IN and then reported as having
        // matched on nothing. The SQL path selects `details` for the same
        // reason, so both modes answer identically.
        .map((row) => ({ ...withKind(this.#summarizeSeeded(row)), details: row.details }));
      traces = this.demo.auditTrace
        .filter((t) => matchesTraceIdentifier(t, raw, uuid))
        .sort((a, b) => cmpDesc(a.at, b.at))
        .slice(0, cap);
      claims = this.demo.workflowClaims
        .filter((c) => String(c.externalRef ?? "") === raw)
        .sort((a, b) => cmpAsc(a.claimedAt, b.claimedAt))
        .slice(0, cap);
      alerts = this.demo.opsAlerts
        .filter((a) => matchesAlertIdentifier(a, raw, uuid))
        .sort((a, b) => cmpDesc(a.at, b.at))
        .slice(0, cap);
    } else {
      // Concurrent, not sequential: four independent reads against one pool,
      // so the wall clock is the slowest probe rather than their sum.
      const [decisionRows, traceRows, claimRows, alertRows] = await Promise.all([
        this.pgPool.query(
          `select ${DECISION_SUMMARY_COLUMNS}, details
             from audit_log
            where id = $2::uuid
               or actor = $1
               ${AUDIT_LOG_DETAIL_KEYS.map((k) => `or details->>'${k.key}' = $1`).join("\n               ")}
            order by at desc, id desc
            limit $3`,
          [raw, uuid, cap]
        ),
        this.pgPool.query(
          `select ${TRACE_COLUMNS}
             from audit_trace
            where id = $2::uuid
               or parent_id = $2::uuid
               ${AUDIT_TRACE_DETAIL_KEYS.map((k) => `or details->>'${k.key}' = $1`).join("\n               ")}
            order by at desc
            limit $3`,
          [raw, uuid, cap]
        ),
        this.pgPool.query(
          `select ${CLAIM_COLUMNS} from workflow_claims where external_ref = $1 order by claimed_at asc limit $2`,
          [raw, cap]
        ),
        this.pgPool.query(
          `select ${ALERT_COLUMNS}
             from ops_alerts
            where id = $2::uuid
               or execution_id = $1
               or workflow_id = $1
               or execution_url = $1
            order by at desc
            limit $3`,
          [raw, uuid, cap]
        ),
      ]);
      decisions = decisionRows.rows.map((r) => withKind(isoAt(coerceFlags(coerceDetails(r)))));
      traces = traceRows.rows.map((r) => isoAt(coerceDetails(r)));
      claims = claimRows.rows.map((r) => isoAt(r, "claimedAt"));
      alerts = alertRows.rows.map(isoAt);
    }

    // WHICH field matched, per row. Rendered beside each hit, because "found"
    // without "found where" leaves the reader unable to tell a decision that
    // IS this request from one that merely shares its employment id.
    decisions = decisions.map((row) => ({ ...row, matchedOn: auditLogMatchFields(row, raw, uuid) }));
    traces = traces.map((row) => ({ ...row, matchedOn: traceMatchFields(row, raw, uuid) }));

    const matches = tallyMatches({ decisions, traces, claims, alerts, value: raw, uuid });
    const total = decisions.length + traces.length + claims.length + alerts.length;

    // THE RARE, EXPENSIVE, USEFUL PASS. Only on a total miss — see the header.
    let unregistered = [];
    if (total === 0) {
      unregistered = await this.#scanUnregisteredKeys(raw);
    }

    return {
      value: raw,
      shape,
      searched,
      matches,
      decisions,
      traces,
      claims,
      alerts,
      unregistered,
      exhaustiveScanRan: total === 0,
      rowCap: cap,
      notSearchableHere: NOT_SEARCHABLE_HERE,
    };
  }

  /**
   * Does this value sit under ANY `details` key, including one the registry
   * does not know about? Bounded to 25 (table, key) groups — enough to name
   * the key, never enough to be a table dump.
   */
  async #scanUnregisteredKeys(value) {
    const registered = new Set([
      ...AUDIT_LOG_DETAIL_KEYS.map((k) => `audit_log.${k.key}`),
      ...AUDIT_TRACE_DETAIL_KEYS.map((k) => `audit_trace.${k.key}`),
    ]);

    let groups;
    if (this.seeded) {
      const counts = new Map();
      const scan = (rows, table) => {
        for (const row of rows) {
          for (const [key, val] of Object.entries(row.details ?? {})) {
            if (val === null || typeof val === "object") continue;
            if (String(val) !== value) continue;
            const id = `${table} ${key}`;
            counts.set(id, (counts.get(id) ?? 0) + 1);
          }
        }
      };
      scan(this.demo.auditLog, "audit_log");
      scan(this.demo.auditTrace, "audit_trace");
      groups = [...counts.entries()].map(([id, rows]) => {
        const [table, key] = id.split(" ");
        return { table, key, rows };
      });
    } else {
      const result = await this.pgPool.query(
        `select 'audit_log' as "table", kv.key as key, count(*)::int as rows
           from audit_log, lateral jsonb_each_text(details) kv
          where kv.value = $1
          group by 1, 2
          union all
         select 'audit_trace', kv.key, count(*)::int
           from audit_trace, lateral jsonb_each_text(details) kv
          where kv.value = $1
          group by 1, 2
          limit 25`,
        [value]
      );
      groups = result.rows;
    }

    return groups
      .map((g) => ({ ...g, registered: registered.has(`${g.table}.${g.key}`) }))
      .sort((a, b) => b.rows - a.rows);
  }
}

// --- helpers -----------------------------------------------------------------

function clampLimit(limit) {
  const n = Number(limit);
  if (!Number.isFinite(n) || n < 1) return 50;
  return Math.min(Math.floor(n), 200);
}

/**
 * The feed's summary shape, from a full seeded row — the same columns the
 * Postgres query selects, so the two modes render identically.
 */
function summarize(row, traceCount = 0) {
  const details = row.details ?? {};
  const correlation = correlationOf(details);
  return {
    id: row.id,
    at: row.at,
    useCase: row.useCase,
    action: row.action,
    actor: row.actor ?? null,
    riskTier: row.riskTier ?? null,
    externalRef: row.externalRef ?? details.externalRef ?? null,
    reason: row.reason ?? details.reason ?? null,
    employmentId: details.employmentId ?? null,
    source: details.source ?? null,
    // The decision a replay handed back. Only `duplicate_request_ignored`
    // carries it, and without it that row reads as a decision with no verdict:
    // a feed of nothing but "duplicate_request_ignored" tells a reader that
    // something was refused but never what was replayed instead.
    priorDecision: details.priorDecision ?? null,
    flags: Array.isArray(details.flags) ? details.flags : null,
    // The human half — see DECISION_SUMMARY_COLUMNS for what each one is for.
    // The two paths must produce the same shape or the seeded demo and the
    // live deployment render differently, which is the one thing a demo
    // surface must never do.
    note: details.note ?? null,
    role: details.role ?? null,
    aiDecision: details.aiDecision ?? null,
    hasRemoteResult: Object.prototype.hasOwnProperty.call(details, "remoteResult"),
    correlationField: correlation.field,
    correlationKey: correlation.key,
    traceCount,
  };
}

/**
 * WHAT KIND OF THING `actor` IS (R7-33 / rca-e6zk). The column is written
 * from three different vocabularies with nothing on the page distinguishing
 * them: an authenticated person's email, the literal string
 * "unauthenticated" when no identity was ever checked, and — on paths with
 * no logged-in session (portal personas, third-party door) — the SAME
 * employmentId this row is already about, reused as the actor. "Who acted"
 * is therefore not answerable from this column alone; a reader had to guess
 * from SOURCE, which is blank on well over a third of rows. This never
 * changes what is stored, only what the reader is told about the shape of
 * what is stored.
 *
 * `employmentId` is passed in (rather than read off `row` here) because the
 * caller already resolved the same three-way fill `reason`/`source` use —
 * a column on the feed/sibling path, a `details` key on the drill-down path.
 *
 * @param {string|null|undefined} actor
 * @param {string|null|undefined} employmentId
 * @returns {{code: string, label: string}|null} null when the row carries no
 *   actor at all — an absent value, not a fourth kind of value.
 */
export function classifyActor(actor, employmentId) {
  if (actor === null || actor === undefined || actor === "") return null;
  const value = String(actor);
  if (value === "unauthenticated") {
    return { code: "unauthenticated", label: "no identity was verified for this action" };
  }
  if (EMAIL_RE.test(value)) {
    return { code: "email", label: "an email address" };
  }
  if (UUID_RE.test(value)) {
    if (employmentId != null && value === String(employmentId)) {
      return {
        code: "employment_id_self",
        label: "this row's own employmentId, reused as the actor — not a separate identity for who acted",
      };
    }
    return { code: "uuid", label: "an id — not an email or a name" };
  }
  return { code: "name", label: "a free-text name or role label, not a verified identity" };
}

/**
 * Decision, execution or follow-up event — the server's judgement, attached
 * once so no consumer (least of all the browser) re-derives it. See
 * DECISION_ACTIONS and EXECUTION_ACTIONS for how each vocabulary was derived
 * and why an unknown action falls through to the under-claiming answer.
 *
 * Decision is checked first: the two sets are disjoint today, and if one word
 * ever appeared in both, "this row IS the decision" is the reading a reader
 * needs before "and something was written".
 *
 * IT ALSO ATTACHES THE TWO THINGS THE PAGE MUST NOT DERIVE FOR ITSELF: what a
 * person decided (./humanDecision.js) and what the stored reason slug means in
 * the words its own policy engine holds (./gateMeanings.js). Both are
 * judgements about the data, so both are made here and rendered there — the
 * same division of labour `kind` itself follows. Every path that leaves this
 * store goes through this function, so the feed, the sibling list, the ref
 * lookup and the drill-down cannot disagree about a row.
 */
function withKind(row) {
  const details = row.details && typeof row.details === "object" ? row.details : null;
  const kind = DECISION_ACTIONS.has(row.action)
    ? "decision"
    : EXECUTION_ACTIONS.has(row.action)
      ? "execution"
      : "event";

  // The reason lives in two places depending on which query produced this row:
  // the feed and the sibling list select `details->>'reason'` into a column,
  // the drill-down selects the whole `details`. Read both, so one enrichment
  // serves every path and the feed can never explain a reason the drill-down
  // shows bare (or the reverse).
  const reason = row.reason ?? details?.reason ?? null;
  // Same three-way fill as `reason`, for the same two-query-shapes reason —
  // and it is what tells gateMeaning() below whether the row it is describing
  // was ever read against a live Remote record at all (R7-37 / rca-x0i6).
  const source = row.source ?? details?.source ?? null;
  // Same three-way fill, for classifyActor() below.
  const employmentId = row.employmentId ?? details?.employmentId ?? null;

  return {
    ...row,
    kind,
    // Lifted to the top level on BOTH paths, so a consumer never has to know
    // which query produced the row it is holding.
    reason,
    // What KIND of thing `actor` is on this row (R7-33 / rca-e6zk) — see
    // classifyActor() above. Null when the row carries no actor at all.
    actorKind: classifyActor(row.actor, employmentId),
    // What a person decided, when a person decided it. Null on every automated
    // row, so a consumer testing this field is asking exactly the right
    // question and never has to re-derive the vocabulary.
    humanVerdict: humanVerdictOf(row.action),
    // Does THIS row settle the request, or hand it off awaiting a further
    // step? Null on every non-decision row. See decisionReachesOutcome()
    // above — rca-8mmd / R7-30 is the row this exists to stop misreading.
    reachesOutcome: decisionReachesOutcome(row.action),
    // The plain words the deciding policy engine already holds for this slug —
    // null for a use case with no ladder and for a reason no rung matches. See
    // ./gateMeanings.js: the slug is never replaced, only accompanied. Portal
    // rows get the fixture-source caveat folded in, because "Remote is the
    // legal employer, the employment is active" is a claim about whatever
    // record the gate actually read, and a portal submission read the mock
    // fixtures, not a live Remote record.
    reasonMeaning: gateMeaning(row.useCase, reason, { source }),
    // Present on both query shapes, so the drill-down's write-outcome verdict
    // can read it off a sibling summary without a second fetch.
    hasRemoteResult:
      row.hasRemoteResult ??
      (details ? Object.prototype.hasOwnProperty.call(details, "remoteResult") : false),
    // Same three-way fill for the human half: a column on the feed/sibling
    // path, a `details` key on the drill-down path, null when neither carries
    // it. `null` is "this row records none", not "we failed to look".
    note: row.note ?? details?.note ?? null,
    role: row.role ?? details?.role ?? null,
    aiDecision: row.aiDecision ?? details?.aiDecision ?? null,
  };
}

/**
 * The first CORRELATION_FIELDS entry this row's details actually carry, and
 * its value. `{field: null, key: null}` when the row carries none — a real
 * answer ("these rows cannot be correlated"), not a failure to compute one.
 */
export function correlationOf(details) {
  const bag = details && typeof details === "object" ? details : {};
  for (const field of CORRELATION_FIELDS) {
    const value = bag[field];
    if (value !== undefined && value !== null && String(value) !== "") {
      return { field, key: String(value) };
    }
  }
  return { field: null, key: null };
}

/** `(at, id)` descending — the feed's total order, ties broken by id. */
function cmpRowDesc(a, b) {
  return cmpAsc(b.at, a.at) || String(b.id).localeCompare(String(a.id));
}

/** Strictly before the cursor in `(at, id)` order. */
function isOlderThan(row, cursor) {
  const byTime = cmpAsc(row.at, cursor.at);
  if (byTime !== 0) return byTime < 0;
  return String(row.id).localeCompare(String(cursor.id)) < 0;
}

/** Strictly after the cursor in `(at, id)` order. */
function isNewerThan(row, cursor) {
  const byTime = cmpAsc(row.at, cursor.at);
  if (byTime !== 0) return byTime > 0;
  return String(row.id).localeCompare(String(cursor.id)) > 0;
}

function matchesFilters(row, { useCase, action, q, since, sinceId, before }) {
  if (useCase && row.useCase !== useCase) return false;
  if (action && row.action !== action) return false;
  // Strictly newer than the tail cursor. With `sinceId` the comparison is
  // row-wise, so a row sharing the cursor's millisecond is still delivered —
  // exactly once. Same tiebreak `before` uses, at the other end of the order.
  if (since) {
    if (sinceId) {
      if (!isNewerThan(row, { at: since, id: sinceId })) return false;
    } else if (!(cmpAsc(since, row.at) < 0)) return false;
  }
  if (before && !isOlderThan(row, before)) return false;
  if (q) {
    const needle = q.toLowerCase();
    const hay = [
      row.actor,
      row.externalRef ?? row.details?.externalRef,
      row.reason ?? row.details?.reason,
      // The record id, for the same reason the SQL path carries it — see the
      // comment on that predicate.
      correlationOf(row.details).key,
    ]
      .filter((v) => v !== null && v !== undefined)
      .join("\u0000")
      .toLowerCase();
    if (!hay.includes(needle)) return false;
  }
  return true;
}

/** ISO-string comparisons; pg may hand back Date objects, so normalise first. */
function toIso(value) {
  if (value instanceof Date) return value.toISOString();
  return value == null ? value : String(value);
}
function cmpAsc(a, b) {
  return String(toIso(a)).localeCompare(String(toIso(b)));
}
function cmpDesc(a, b) {
  return cmpAsc(b, a);
}

/**
 * pg returns timestamptz columns as Date objects; the seeded rows are ISO
 * strings. One shape leaves this store: ISO strings, which is also what the
 * browser can render without a parser.
 */
function isoAt(row, field = "at") {
  if (row[field] instanceof Date) return { ...row, [field]: row[field].toISOString() };
  return row;
}

/**
 * The feed selects `details->'flags'`, a jsonb value some driver paths hand
 * back as a string. One shape leaves this store: an array, or null. Anything
 * that is neither (a scalar someone stored under `flags`) becomes null rather
 * than being coerced into a one-element array it never was.
 */
function coerceFlags(row) {
  if (!("flags" in row)) return row;
  let flags = row.flags;
  if (typeof flags === "string") {
    try {
      flags = JSON.parse(flags);
    } catch {
      flags = null;
    }
  }
  return { ...row, flags: Array.isArray(flags) ? flags : null };
}

/** jsonb columns can come back as strings on some driver paths. */
function coerceDetails(row) {
  if (typeof row.details !== "string") return row;
  try {
    return { ...row, details: JSON.parse(row.details) };
  } catch {
    return row;
  }
}

/** [min-15min, max+15min] over a set of ISO timestamps; null when empty. */
function timeWindow(timestamps) {
  const times = timestamps
    .map((t) => new Date(toIso(t)).getTime())
    .filter((t) => Number.isFinite(t));
  if (!times.length) return null;
  return {
    from: new Date(Math.min(...times) - ALERT_WINDOW_MS).toISOString(),
    to: new Date(Math.max(...times) + ALERT_WINDOW_MS).toISOString(),
  };
}

// --- the identifier lookup's helpers -----------------------------------------
//
// The predicates below are the SEEDED half of lookupIdentifier(), and they are
// deliberately generated from the same ./identifiers.js lists the SQL is
// generated from. Two hand-written copies of "which keys count as an id" is
// exactly how the demo dataset and the live deployment would come to answer
// the same question differently — which, on a surface whose whole job is to be
// trustworthy about what it did and did not look at, is the one bug that
// discredits everything else on the page.

/** The `details` keys of one row whose value equals the needle. */
function detailKeyHits(details, keys, value) {
  const bag = details && typeof details === "object" ? details : {};
  return keys.filter((k) => bag[k.key] !== undefined && bag[k.key] !== null && String(bag[k.key]) === value);
}

function matchesAuditLogIdentifier(row, value, uuid) {
  if (uuid && String(row.id) === uuid) return true;
  if (row.actor != null && String(row.actor) === value) return true;
  return detailKeyHits(row.details, AUDIT_LOG_DETAIL_KEYS, value).length > 0;
}

function matchesTraceIdentifier(row, value, uuid) {
  if (uuid && (String(row.id) === uuid || String(row.parentId ?? "") === uuid)) return true;
  return detailKeyHits(row.details, AUDIT_TRACE_DETAIL_KEYS, value).length > 0;
}

function matchesAlertIdentifier(row, value, uuid) {
  if (uuid && String(row.id) === uuid) return true;
  return ["executionId", "workflowId", "executionUrl"].some(
    (f) => row[f] != null && String(row[f]) === value
  );
}

/**
 * WHICH field matched, per row — the difference between "found" and "found
 * where". A decision row can match because it IS this request or because it
 * merely shares the employment id with it, and only naming the field lets a
 * reader tell those apart. The summary shape carries `externalRef`,
 * `employmentId` and `correlationKey` as columns and may carry no `details` at
 * all, so both are consulted.
 */
function auditLogMatchFields(row, value, uuid) {
  const hits = [];
  if (uuid && String(row.id) === uuid) hits.push("id");
  if (row.actor != null && String(row.actor) === value) hits.push("actor");
  for (const k of detailKeyHits(row.details, AUDIT_LOG_DETAIL_KEYS, value)) hits.push(k.key);
  // Summary rows (the feed shape) carry these as columns rather than inside
  // `details`, so a row selected that way would otherwise report no field.
  for (const [field, carried] of [
    ["externalRef", row.externalRef],
    ["employmentId", row.employmentId],
    [row.correlationField, row.correlationKey],
  ]) {
    if (field && carried != null && String(carried) === value && !hits.includes(field)) hits.push(field);
  }
  return hits;
}

function traceMatchFields(row, value, uuid) {
  const hits = [];
  if (uuid && String(row.id) === uuid) hits.push("id");
  if (uuid && String(row.parentId ?? "") === uuid) hits.push("parent_id");
  for (const k of detailKeyHits(row.details, AUDIT_TRACE_DETAIL_KEYS, value)) hits.push(k.key);
  return hits;
}

/**
 * The per-target tally the page shows as "matched on". Counted from the rows
 * actually returned, so a capped probe under-reports rather than claiming a
 * number it did not verify — `rowCap` and the row count together say when that
 * happened.
 */
function tallyMatches({ decisions, traces, claims, alerts, value, uuid }) {
  const counts = new Map();
  const bump = (target, label) => {
    const entry = counts.get(target) ?? { target, label, count: 0 };
    entry.count += 1;
    counts.set(target, entry);
  };

  for (const row of decisions) {
    for (const field of row.matchedOn) {
      const target = field === "id" || field === "actor" ? `audit_log.${field}` : `audit_log.details.${field}`;
      const known = AUDIT_LOG_DETAIL_KEYS.find((k) => k.key === field);
      bump(target, known ? `audit_log · ${known.label}` : `audit_log · ${field}`);
    }
  }
  for (const row of traces) {
    for (const field of row.matchedOn) {
      const target = field === "id" || field === "parent_id" ? `audit_trace.${field}` : `audit_trace.details.${field}`;
      const known = AUDIT_TRACE_DETAIL_KEYS.find((k) => k.key === field);
      bump(target, known ? `audit_trace · ${known.label}` : `audit_trace · ${field}`);
    }
  }
  for (const _ of claims) bump("workflow_claims.external_ref", "exactly-once ledger reference");
  for (const alert of alerts) {
    if (uuid && String(alert.id) === uuid) bump("ops_alerts.id", "ops alert id");
    if (alert.executionId != null && String(alert.executionId) === value) bump("ops_alerts.execution_id", "ops alert · n8n execution id");
    if (alert.workflowId != null && String(alert.workflowId) === value) bump("ops_alerts.workflow_id", "ops alert · n8n workflow id");
    if (alert.executionUrl != null && String(alert.executionUrl) === value) bump("ops_alerts.execution_url", "ops alert · n8n execution URL");
  }

  return [...counts.values()].sort((a, b) => b.count - a.count || a.target.localeCompare(b.target));
}

/**
 * An empty needle is answered without a query. Not a special case for its own
 * sake: `where actor = ''` is a real predicate that would really scan, and
 * "nothing carries the empty string" is a true but useless sentence to have
 * paid four table scans for.
 */
function emptyLookup(value, shape, searched, cap) {
  return {
    value,
    shape,
    searched,
    matches: [],
    decisions: [],
    traces: [],
    claims: [],
    alerts: [],
    unregistered: [],
    exhaustiveScanRan: false,
    rowCap: cap,
    notSearchableHere: NOT_SEARCHABLE_HERE,
  };
}
