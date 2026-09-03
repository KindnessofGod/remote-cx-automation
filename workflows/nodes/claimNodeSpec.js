// ---------------------------------------------------------------------------
// claimNodeSpec.js — what `Claim Ticket (Idempotency)` writes, on all nine
// ---------------------------------------------------------------------------
// The Supabase node that takes the exactly-once claim before the first durable
// write. `scripts/verify-claim-nodes.mjs` checks its FIELDS and its WIRING;
// this file is where the field values themselves live, so the thing that is
// deployed and the thing that is verified are one object rather than two
// strings that have to be kept in step by hand.
//
// WHY IT CHANGED ON 2026-08-31. `external_ref` was a bare Zendesk ticket
// number. This project has moved Zendesk account twice, the current account
// restarted its numbering at 1 while the retired one reached 143, and the
// PRIMARY KEY `(use_case, external_ref)` therefore refused five real new
// tickets as redeliveries of unrelated old ones — silently, with the run
// reporting `success` after stopping at `Duplicate Delivery — Stop` having
// written nothing. The whole account of it, and why the fix is additive rather
// than a migration, is in src/shared/claimRef.js.
//
// THE EXPRESSION IS GENERATED, NOT TYPED. It is built from
// `currentZendeskAccount()`, the same function the Node execution path keys on,
// so the two paths cannot key differently — and a FOURTH account move changes
// one line in ZENDESK_ACCOUNTS, at which point `npm run verify-claim-nodes`
// reports the live graphs as drifted until they are redeployed. That is the
// intended behaviour: the ledger key is part of the deployment, and a stale one
// is exactly the defect this replaces.
//
// AN n8n CODE NODE CANNOT READ process.env, so the account HAS to appear as a
// literal in the published expression (CLAUDE.md §4 records a webhook header
// that went out empty for exactly this reason). That is why the account comes
// from a versioned table rather than an environment variable.
// ---------------------------------------------------------------------------

import { currentZendeskAccount } from "../../src/shared/claimRef.js";

export const CLAIM_NODE_NAME = "Claim Ticket (Idempotency)";
export const CLAIM_TABLE = "workflow_claims";

/**
 * The `external_ref` value, as an n8n expression.
 *
 * It is the same three-way rule as `qualifyClaimRef()`, and
 * `test/claimRefQualification.test.js` EVALUATES this string against that
 * function over a shared table of inputs — the n8n-parity discipline this repo
 * already uses for Code-node bodies, applied to an expression:
 *
 *   1. no reference at all  -> `unreferenced:<execution id>`, because both key
 *      columns are NOT NULL and a bare null insert fails the key, takes the
 *      error output and vanishes at the duplicate NoOp — a green run that wrote
 *      nothing, which is the same failure shape being fixed here;
 *   2. a bare ticket number -> `<account>:<number>`;
 *   3. anything else        -> unchanged. A descriptive ref, a portal id or a
 *      content-derived key is already unique and names no account.
 *
 * @param {string|null} [account]
 * @returns {string}
 */
export function externalRefExpression(account = currentZendeskAccount()) {
  if (!account) {
    // No open account in the table means the register is mid-edit. Publishing a
    // half-qualified key would be worse than publishing none, so this refuses
    // rather than emitting `null:93`.
    throw new Error(
      "claimNodeSpec: ZENDESK_ACCOUNTS has no single open account, so the claim key cannot be qualified. " +
        "Close the previous account and open exactly one new one."
    );
  }
  // Deliberately one expression with no IIFE and no helper: n8n evaluates this
  // string, and the smaller the language surface it needs, the fewer ways it
  // has to behave differently from the Node path it must agree with.
  return (
    "={{ $json.externalRef === undefined || $json.externalRef === null || $json.externalRef === '' " +
    "? 'unreferenced:' + $execution.id " +
    `: (/^[0-9]+$/.test(String($json.externalRef)) ? '${account}:' + String($json.externalRef) : String($json.externalRef)) }}`
  );
}

export const EXTERNAL_REF_EXPR = externalRefExpression();

/**
 * One row per workflow that must claim before it writes.
 *
 * `gates` is the last node whose output IS the decision context; `next` is the
 * first node that leaves a mark. `decision` is what the claim row records for
 * forensics — an expression where the gates produce a decision, a literal where
 * the tier forbids one (UC-07/UC-08 have no branch: every run escalates).
 */
export const CLAIM_TARGETS = Object.freeze([
  // UC-01's first durable write is no longer the audit row: `Persist Case`
  // was inserted ahead of it so the ZAF sidebar has a `cases` row to read
  // (the graph wrote audit_log, workflow_claims and audit_trace, and none
  // of the three is what the sidebar queries). The claim still precedes
  // the FIRST durable write, which is the whole guarantee — only the name
  // of that write changed.
  { uc: "UC-01", id: "WORKFLOW_UC01_ID", gates: "Identity + Policy Gates", next: "Persist Case", decision: "={{ $json.decision }}" },
  // UC-02's first durable write became `Create Expense Record` when the graph
  // gained one (it had none, alone among the six UCs with a record table — the
  // reason its duplicate gate could never fire). The claim still precedes the
  // FIRST durable write, which is the whole guarantee; only the name of that
  // write changed, exactly as UC-01's note above describes.
  { uc: "UC-02", id: "WORKFLOW_UC02_ID", gates: "Expense Gates", next: "Create Expense Record", decision: "={{ $json.decision }}" },
  { uc: "UC-03", id: "WORKFLOW_UC03_ID", gates: "Travel Router Gates", next: "Append Audit Log", decision: "={{ $json.decision }}" },
  { uc: "UC-04", id: "WORKFLOW_UC04_ID", gates: "Workation Gates", next: "Create Authorization Record", decision: "={{ $json.decision }}" },
  { uc: "UC-05", id: "WORKFLOW_UC05_ID", gates: "Notice Period Gates", next: "Create Resignation Record", decision: "={{ $json.decision }}" },
  { uc: "UC-06", id: "WORKFLOW_UC06_ID", gates: "Amendment Gates", next: "Create Amendment Record", decision: "={{ $json.decision }}" },
  { uc: "UC-07", id: "WORKFLOW_UC07_ID", gates: "Relocation Gates", next: "Create Dossier Record", decision: "escalate" },
  { uc: "UC-08", id: "WORKFLOW_UC08_ID", gates: "Build Dossier", next: "Create Dossier Record", decision: "escalate" },
  { uc: "UC-09", id: "WORKFLOW_UC09_ID", gates: "Adjustment Gates", next: "Create Adjustment Record", decision: "={{ $json.decision }}" },
]);

/** The four field values one graph's claim node must carry. */
export function claimFieldValues(target) {
  return [
    { fieldId: "use_case", fieldValue: target.uc },
    { fieldId: "external_ref", fieldValue: EXTERNAL_REF_EXPR },
    { fieldId: "decision", fieldValue: target.decision },
    { fieldId: "note", fieldValue: `=claimed by n8n workflow ${target.id}` },
  ];
}

/**
 * What `scripts/deploy-terminal-nodes.mjs` publishes.
 *
 * ONLY `fieldsUi` and `tableId` are named, so `credentials`, `onError`,
 * `position` and the node id are left exactly as the live graph holds them. The
 * claim node's `onError: continueErrorOutput` in particular is load-bearing —
 * it is what routes a redelivery to the silent NoOp instead of erroring the run
 * and paging a human about normal webhook behaviour — and it is checked
 * separately by `npm run verify-claim-nodes`.
 */
export function collectDeployTargets() {
  return CLAIM_TARGETS.map((t) => ({
    workflowId: t.id,
    node: CLAIM_NODE_NAME,
    parameters: { tableId: CLAIM_TABLE, fieldsUi: { fieldValues: claimFieldValues(t) } },
    check: (node) => claimNodeIssues(node, t),
  }));
}

/**
 * Read-back checker. Compares what the API returned against what the spec says,
 * field by field, and reports an UNEXPECTED column too — a fifth field would be
 * a write nobody specified into the ledger every use case shares.
 *
 * @param {object|null} node the node as the n8n API returned it
 * @param {object} target the CLAIM_TARGETS row it should match
 * @returns {string[]}
 */
export function claimNodeIssues(node, target) {
  if (!node) return [`"${CLAIM_NODE_NAME}" not found`];
  const issues = [];
  const got = node.parameters?.fieldsUi?.fieldValues ?? [];
  const want = claimFieldValues(target);
  for (const w of want) {
    const g = got.find((f) => f.fieldId === w.fieldId);
    if (!g) issues.push(`field ${w.fieldId} is missing`);
    else if (g.fieldValue !== w.fieldValue) {
      issues.push(`field ${w.fieldId} is ${JSON.stringify(g.fieldValue)}, expected ${JSON.stringify(w.fieldValue)}`);
    }
  }
  const known = new Set(want.map((w) => w.fieldId));
  const extra = got.map((f) => f.fieldId).filter((id) => !known.has(id));
  if (extra.length) issues.push(`writes unexpected column(s): ${extra.join(", ")}`);
  if (node.parameters?.tableId !== CLAIM_TABLE) {
    issues.push(`tableId is ${JSON.stringify(node.parameters?.tableId)}, expected ${JSON.stringify(CLAIM_TABLE)}`);
  }
  return issues;
}
