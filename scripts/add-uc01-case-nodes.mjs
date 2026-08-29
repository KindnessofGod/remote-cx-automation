// ---------------------------------------------------------------------------
// add-uc01-case-nodes.mjs — give UC-01's live graph the two rows the sidebar reads
// ---------------------------------------------------------------------------
// THE DEFECT THIS CLOSES
// UC-01 is the one use case proven green end to end from a real inbound Zendesk
// ticket. Its live graph (WORKFLOW_UC01_ID) wrote to exactly three tables:
// audit_log, workflow_claims and audit_trace. It never wrote `cases` or
// `review_queue`.
//
// Those two are precisely what the ZAF sidebar reads. So opening tickets #3-#6
// — the ones that ran perfectly — showed an EMPTY sidebar, and, far worse, a
// `human_review` decision reached a specialist as a Zendesk internal note and a
// tag while no row ever entered the review queue. There was nothing to approve.
// The 🟡 human-in-the-loop gate that this whole architecture is organised
// around has never been closed end to end on the live path.
//
// The other eight graphs already create their own record row (uc04_authorizations,
// uc06_amendments, and so on), which is why tickets 9-14 render and #3-#6 do
// not. UC-01 is the odd one out because it was built first, when the `cases`
// write existed only in the Node path — and nothing since has compared the two.
//
// WHAT IT MIRRORS
// src/uc01/workflow.js, exactly:
//   STEP 6a  create the case row              — ALWAYS
//   STEP 6b  create a review_queue entry      — human_review AND escalate only
//   STEP 7   audit durably
//   STEP 8   anything customer-facing
// Both records therefore land BEFORE `Append Audit Log`, which already sits
// before `Route by Decision` and every Zendesk node.
//
// WHY A FAN-OUT AND NOT AN IF NODE
// STEP 6b is conditional, which normally means an IF node — but an IF's v2
// filter structure is fiddly to get right, and getting it wrong on a graph that
// auto-replies to real customers is not a cheap mistake. Instead `Persist Case`
// fans out to two branches:
//
//   Persist Case ─┬─▶ Queue Gate ─▶ Queue for Specialist Review   (y=40)
//                 └─▶ Carry Context After Records ─▶ Append Audit Log ─▶ (unchanged)
//
// `Queue Gate` is a Code node that returns [] for auto_resolve, which stops
// its branch and leaves the spine untouched. No merge node, no new control
// flow, and the existing chain keeps its exact shape downstream.
//
// BRANCH ORDER IS SET BY CANVAS POSITION, NOT BY THE CONNECTION ARRAY — see
// the comment above the connections block. Getting that wrong cost two
// deployments and two false diagnoses.
//
// The queue insert deliberately does NOT set onError. A lost review_queue row
// means a specialist never sees a case that needs them, so it should fail
// loudly and reach `RCX OPS · Error Alerts` rather than be swallowed — the
// audit row is already durable by then, so the decision itself is never lost.
//
// FK SAFETY: review_queue.case_id is NOT NULL and points at cases.id. The
// branch reads it from `$('Persist Case')`, so the parent row provably exists
// first — CLAUDE.md §6 records a live FK violation from a child insert racing
// its parent.
//
// Declarative and idempotent, like add-claim-nodes.mjs: it inserts what is
// missing and repairs what is present, so re-running is safe.
//
// Usage:  node scripts/add-uc01-case-nodes.mjs [--publish]
// Without --publish it saves only. Note that PUT /api/v1/workflows/{id}
// publishes in place on an already-active workflow (CLAUDE.md §6) — --publish
// additionally re-activates and PROVES it by comparing versionId against
// activeVersionId, because an update that reports success while production runs
// the old graph is this project's most expensive recurring mistake.
// ---------------------------------------------------------------------------

import "dotenv/config";   // the repo keeps credentials in .env; without this this
                          // script fails with a credentials-shaped error on a
                          // machine that HAS them — see verify-deployed-nodes.mjs

const BASE = (process.env.N8N_BASE_URL ?? "").replace(/[/.]+$/, "");
const KEY = process.env.N8N_API_KEY;
if (!BASE || !KEY) {
  console.error("add-uc01-case-nodes: set N8N_BASE_URL and N8N_API_KEY.");
  process.exit(2);
}

const H = { "X-N8N-API-KEY": KEY, "content-type": "application/json", accept: "application/json" };
const SUPABASE_CRED = { supabaseApi: { id: "CRED_SUPABASE", name: "remote" } };

const WORKFLOW_ID = "WORKFLOW_UC01_ID";
const GATES = "Identity + Policy Gates";
const CARRY_CLAIM = "Carry Context After Claim";
const AUDIT = "Append Audit Log";

const PERSIST = "Persist Case";
const CARRY_RECORDS = "Carry Context After Records";
const QUEUE_GATE = "Queue Gate — Specialist Needed?";
const QUEUE = "Queue for Specialist Review";

/**
 * INITIAL_STATUS_BY_DECISION from src/uc01/workflow.js, inlined as an
 * expression. Kept as a literal map rather than a chain of ternaries so it
 * reads the same way as the source it mirrors, and so an unrecognised decision
 * falls to pending_review — a human looking at it — instead of resolved.
 */
const STATUS_EXPR =
  "={{ ({ auto_resolve: 'resolved', human_review: 'pending_review', escalate: 'escalated' })[$json.decision] || 'pending_review' }}";

// Same expression the claim node uses, so a ref-less delivery is traceable in
// `cases` under the identifier it was claimed by rather than as a null.
const EXTERNAL_REF_EXPR = "={{ $json.externalRef || ('unreferenced:' + $execution.id) }}";

const QUEUE_GATE_CODE = `// Mirrors src/uc01/workflow.js STEP 6b: a specialist queue entry exists for
// human_review AND escalate, never for auto_resolve. Returning [] ends this
// branch without touching the audit spine that runs beside it.
//
// The decision is read from the gates node, not from $json, because the
// Supabase node upstream emits its own insert response.
const decision = $('${GATES}').first().json.decision;
if (decision !== 'human_review' && decision !== 'escalate') return [];
return [{ json: { caseId: $('${PERSIST}').first().json.id, decision } }];`;

const CARRY_RECORDS_CODE = `// The Supabase node returns its own insert response, not our decision context.
// Same restore pattern as '${CARRY_CLAIM}' directly above, so no downstream
// expression had to change when the case node was inserted.
return [{ json: $('${GATES}').first().json }];`;

const NODES = {
  [PERSIST]: {
    name: PERSIST,
    type: "n8n-nodes-base.supabase",
    typeVersion: 1,
    position: [1120, 120],
    credentials: SUPABASE_CRED,
    parameters: {
      resource: "row",
      operation: "create",
      tableId: "cases",
      dataToSend: "defineBelow",
      fieldsUi: {
        fieldValues: [
          { fieldId: "use_case", fieldValue: "UC-01" },
          { fieldId: "source", fieldValue: "={{ $json.source || 'zendesk' }}" },
          { fieldId: "external_ref", fieldValue: EXTERNAL_REF_EXPR },
          { fieldId: "employment_id", fieldValue: "={{ $json.employmentId }}" },
          {
            fieldId: "requester",
            fieldValue: "={{ $json.session ? $json.session.authenticatedEmail : null }}",
          },
          { fieldId: "classification", fieldValue: "={{ $json.classification }}" },
          { fieldId: "decision", fieldValue: "={{ $json.decision }}" },
          { fieldId: "reason", fieldValue: "={{ $json.reason }}" },
          { fieldId: "flags", fieldValue: "={{ $json.flags }}" },
          { fieldId: "status", fieldValue: STATUS_EXPR },
        ],
      },
    },
  },
  [CARRY_RECORDS]: {
    name: CARRY_RECORDS,
    type: "n8n-nodes-base.code",
    typeVersion: 2,
    position: [1320, 300],
    parameters: { jsCode: CARRY_RECORDS_CODE },
  },
  [QUEUE_GATE]: {
    name: QUEUE_GATE,
    type: "n8n-nodes-base.code",
    typeVersion: 2,
    position: [1320, 40],
    parameters: { jsCode: QUEUE_GATE_CODE },
  },
  [QUEUE]: {
    name: QUEUE,
    type: "n8n-nodes-base.supabase",
    typeVersion: 1,
    position: [1520, 40],
    credentials: SUPABASE_CRED,
    parameters: {
      resource: "row",
      operation: "create",
      tableId: "review_queue",
      dataToSend: "defineBelow",
      fieldsUi: {
        fieldValues: [
          { fieldId: "case_id", fieldValue: "={{ $json.caseId }}" },
          { fieldId: "status", fieldValue: "pending" },
        ],
      },
    },
  },
};

const ALLOWED_SETTINGS = [
  "executionOrder", "saveDataErrorExecution", "saveDataSuccessExecution",
  "saveManualExecutions", "saveExecutionProgress", "executionTimeout",
  "errorWorkflow", "timezone", "callerPolicy", "callerIds",
];

const publish = process.argv.includes("--publish");

const res = await fetch(`${BASE}/api/v1/workflows/${WORKFLOW_ID}`, { headers: H });
if (!res.ok) {
  console.error(`✖ GET → ${res.status}`);
  process.exit(1);
}
const wf = await res.json();

// Refuse rather than guess if the graph is not the shape this script was
// written against. Rewiring a live customer-facing automation on an assumption
// is exactly the class of change that must fail closed.
for (const required of [GATES, CARRY_CLAIM, AUDIT]) {
  if (!wf.nodes.some((n) => n.name === required)) {
    console.error(`✖ node "${required}" not found — graph is not the expected shape, refusing to edit.`);
    process.exit(1);
  }
}

for (const [name, def] of Object.entries(NODES)) {
  const existing = wf.nodes.find((n) => n.name === name);
  if (existing) {
    Object.assign(existing, def, { id: existing.id });
    console.log(`↻ repaired "${name}"`);
  } else {
    wf.nodes.push(def);
    console.log(`+ inserted "${name}"`);
  }
}

// QUEUE BRANCH FIRST — and "first" is decided by CANVAS POSITION, not by the
// order of this array. That distinction cost two deployments.
//
// n8n's v1 execution order walks a fan-out in order of node position, topmost
// first, and follows each branch to its end before starting the next. So the
// audit spine ran to `Escalate Ticket`, that node failed on a non-numeric
// ticket id, the execution ended — and `Queue Gate` was still sitting unrun on
// the nodeExecutionStack. Reordering this array changed nothing, because the
// array was never what decided it: `Carry Context After Records` was at y=40
// and `Queue Gate` at y=240.
//
// Evidence: ref `casefix-proof-20260818-a` (spine listed first) and `-b`
// (queue listed first) BOTH recorded claim 1 / case 1 / audit 1 / queue 0 on
// an `escalate`, which src/uc01/workflow.js STEP 6b says must be queued.
// Execution 4940 shows `Carry Context After Records` at executionIndex 9 while
// `Queue Gate` never ran at all.
//
// The queue branch is therefore placed ABOVE the spine (y=40 vs y=300), which
// also restores the Node path's real order — 6a case, 6b queue, 7 audit.
// Moving the audit after costs nothing that matters: it still precedes
// `Route by Decision` and every customer-facing action, which is the ordering
// guarantee the architecture actually makes.
//
// The array order below is kept matching the intended execution order anyway,
// so the file reads the way it runs — but the POSITIONS are what enforce it.
wf.connections[CARRY_CLAIM] = { main: [[{ node: PERSIST, type: "main", index: 0 }]] };
wf.connections[PERSIST] = {
  main: [[
    { node: QUEUE_GATE, type: "main", index: 0 },
    { node: CARRY_RECORDS, type: "main", index: 0 },
  ]],
};
wf.connections[CARRY_RECORDS] = { main: [[{ node: AUDIT, type: "main", index: 0 }]] };
wf.connections[QUEUE_GATE] = { main: [[{ node: QUEUE, type: "main", index: 0 }]] };
wf.connections[QUEUE] = { main: [[]] };

const body = {
  name: wf.name,
  nodes: wf.nodes,
  connections: wf.connections,
  settings: Object.fromEntries(
    Object.entries(wf.settings ?? {}).filter(([k]) => ALLOWED_SETTINGS.includes(k))
  ),
};

const put = await fetch(`${BASE}/api/v1/workflows/${WORKFLOW_ID}`, {
  method: "PUT",
  headers: H,
  body: JSON.stringify(body),
});
if (!put.ok) {
  console.error(`✖ PUT → ${put.status} ${(await put.text()).slice(0, 300)}`);
  process.exit(1);
}
console.log("✔ saved");

if (publish) {
  const act = await fetch(`${BASE}/api/v1/workflows/${WORKFLOW_ID}/activate`, { method: "POST", headers: H });
  if (!act.ok) {
    console.error(`✖ activate → ${act.status}`);
    process.exit(1);
  }
  const after = await act.json();
  const live = after.versionId === after.activeVersionId;
  console.log(
    `${live ? "✔" : "✖"} published — draft ${String(after.versionId).slice(0, 8)} / production ${String(after.activeVersionId).slice(0, 8)}`
  );
  if (!live) process.exit(1);
}
