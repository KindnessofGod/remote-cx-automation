#!/usr/bin/env node
// ---------------------------------------------------------------------------
// add-claim-nodes.mjs — give UC-02…UC-09's n8n graphs exactly-once delivery
// ---------------------------------------------------------------------------
// WHAT A CLAIM NODE IS
//
// Every one of these workflows starts at a webhook, and a webhook can deliver
// the same event more than once. Zendesk retries on a slow response, a trigger
// can fire twice on rapid ticket updates, and a customer can double-submit.
// None of that is exceptional — it is the normal behaviour of an at-least-once
// delivery system, which is what webhooks are.
//
// UC-01 learned it live: ticket #5 arrived three times within microseconds and
// produced two audit rows 30µs apart plus a duplicate verification letter
// posted publicly to the customer. Nothing in the graph asked "have I already
// handled this one?"
//
// The claim node asks exactly that, once, at the point where the run stops
// being a calculation and starts leaving marks. It attempts a single INSERT
// into `workflow_claims`, whose PRIMARY KEY is (use_case, external_ref):
//
//   - first delivery  → the insert succeeds → main output → the run continues
//   - later delivery  → the insert violates the key → error output → NoOp, stop
//
// THE GUARANTEE IS THE PRIMARY KEY, NOT THE NODE. A Code node that read the
// table and then decided has a gap between the read and the write that a
// concurrent delivery slips through — precisely the race that produced UC-01's
// duplicate. One statement, adjudicated by Postgres, has no such gap.
//
// KEYED BY USE CASE AS WELL AS REF because one ticket may legitimately reach
// two use cases (UC-03 routes an inquiry on to UC-04). Keying on the ref alone
// would silently drop the handoff — a worse failure than the duplicate it
// prevents, because a dropped request looks like nothing happened at all.
//
// WHERE IT GOES, AND WHY THAT EXACT SPOT
//
//   …gates → [Claim] → [Carry Context] → first durable write → … → Zendesk
//
// After the gates, because a duplicate that is stopped earlier never records
// WHY it was stopped, and re-deciding is free — reading an employment record
// and running deterministic gates leaves no trace and changes nothing.
//
// Before the first durable write, because everything downstream is a record or
// an outward act: a Supabase row, a Zendesk reply, a Remote PATCH. Those are
// the things you cannot do twice.
//
// The `Carry Context` Code node exists because the Supabase node outputs its
// own insert response, not the decision. It restores the gates' output so no
// downstream expression had to change when the claim node was inserted. It
// sets pairedItem explicitly so that `$('…Gates').item` still resolves in the
// nodes further down — several of these graphs address the gates node by name
// rather than reading $json, and item pairing is what makes that work.
//
// STOPPING QUIETLY IS DELIBERATE. The duplicate branch ends at a NoOp, so a
// redelivery is a silent no-op rather than a failed execution. Erroring would
// page a human every time Zendesk did something completely normal, and an
// alert channel that cries wolf is worse than no alert channel.
//
// USAGE
//   NODE_USE_ENV_PROXY=1 node scripts/add-claim-nodes.mjs [--publish]
//
// Declarative, not one-shot: it makes each graph MATCH the spec below. A
// workflow missing the nodes gets them inserted; one that already has them gets
// its claim parameters repaired in place. A script that skipped anything it had
// already touched could never roll out a correction to a field expression,
// which is exactly what the externalRef fallback below turned out to need.
// ---------------------------------------------------------------------------

import "dotenv/config";   // the repo keeps credentials in .env; without this this
                          // script fails with a credentials-shaped error on a
                          // machine that HAS them — see verify-deployed-nodes.mjs

const BASE = (process.env.N8N_BASE_URL ?? "").replace(/[/.]+$/, "");
const KEY = process.env.N8N_API_KEY;

if (!BASE || !KEY) {
  console.error("add-claim-nodes: set N8N_BASE_URL and N8N_API_KEY.");
  process.exit(2);
}

const H = { "X-N8N-API-KEY": KEY, "content-type": "application/json", accept: "application/json" };
const SUPABASE_CRED = { supabaseApi: { id: "CRED_SUPABASE", name: "remote" } };

const CLAIM = "Claim Ticket (Idempotency)";
const CARRY = "Carry Context After Claim";
const STOP = "Duplicate Delivery — Stop";

/**
 * A REQUEST WITH NO EXTERNAL REF MUST STILL BE PROCESSED.
 *
 * `workflow_claims` has both key columns NOT NULL, so a bare
 * `{{ $json.externalRef }}` on a request that carries none inserts null, the
 * insert fails, the run leaves by the ERROR output and stops at the duplicate
 * NoOp — green, silent, having written nothing. The request is simply gone.
 *
 * That is the wrong failure. A request with no external reference cannot be a
 * duplicate DELIVERY of anything, so there is nothing to deduplicate; giving it
 * a per-execution key means the claim always succeeds and the work proceeds.
 *
 * It also closes a disagreement between the two execution paths, which is worse
 * than either behaviour on its own: `src/shared/workflowClaims.js` returns
 * `{claimed: true}` on an absent ref, pinned by a test literally named "an
 * absent ref is processed, never dropped". The graphs said the opposite.
 *
 * Direction of the degradation is deliberate and matches that module: a
 * duplicate is visible in the audit log afterwards and `findRedundantCalls()`
 * surfaces it, whereas a dropped customer request is invisible — nobody knows
 * to go looking for it.
 */
const EXTERNAL_REF_EXPR = "={{ $json.externalRef || ('unreferenced:' + $execution.id) }}";

/**
 * `gates` is the last node whose output IS the decision context.
 * `next` is the first node that writes something durable.
 * `decision` is what to record on the claim row for forensics — an expression
 * where the gates produce a decision, a literal where the tier forbids one
 * (UC-07/UC-08 have no branch: every run escalates, by design).
 */
const TARGETS = [
  // UC-01's first durable write became `Persist Case` when the sidebar's
  // `cases`/`review_queue` rows were added ahead of the audit row. The claim
  // still precedes the FIRST durable write — only its name changed.
  { uc: "UC-01", id: "WORKFLOW_UC01_ID", gates: "Identity + Policy Gates", next: "Persist Case", decision: "={{ $json.decision }}" },
  // `Create Expense Record` since UC-02's graph gained one — it previously had
  // no record node at all, alone among the six UCs with a record table, which
  // is why its duplicate gate could never fire. The claim still precedes the
  // FIRST durable write; only the name of that write changed.
  { uc: "UC-02", id: "WORKFLOW_UC02_ID", gates: "Expense Gates", next: "Create Expense Record", decision: "={{ $json.decision }}" },
  { uc: "UC-03", id: "WORKFLOW_UC03_ID", gates: "Travel Router Gates", next: "Append Audit Log", decision: "={{ $json.decision }}" },
  { uc: "UC-04", id: "WORKFLOW_UC04_ID", gates: "Workation Gates", next: "Create Authorization Record", decision: "={{ $json.decision }}" },
  { uc: "UC-05", id: "WORKFLOW_UC05_ID", gates: "Notice Period Gates", next: "Create Resignation Record", decision: "={{ $json.decision }}" },
  { uc: "UC-06", id: "WORKFLOW_UC06_ID", gates: "Amendment Gates", next: "Create Amendment Record", decision: "={{ $json.decision }}" },
  { uc: "UC-07", id: "WORKFLOW_UC07_ID", gates: "Relocation Gates", next: "Create Dossier Record", decision: "escalate" },
  { uc: "UC-08", id: "WORKFLOW_UC08_ID", gates: "Build Dossier", next: "Create Dossier Record", decision: "escalate" },
  { uc: "UC-09", id: "WORKFLOW_UC09_ID", gates: "Adjustment Gates", next: "Create Adjustment Record", decision: "={{ $json.decision }}" },
];

const ALLOWED_SETTINGS = [
  "executionOrder", "saveDataErrorExecution", "saveDataSuccessExecution",
  "saveManualExecutions", "saveExecutionProgress", "executionTimeout",
  "errorWorkflow", "timezone", "callerPolicy", "callerIds",
];

const publish = process.argv.includes("--publish");
let failed = 0;

for (const t of TARGETS) {
  const res = await fetch(`${BASE}/api/v1/workflows/${t.id}`, { headers: H });
  if (!res.ok) {
    console.error(`✖ ${t.uc}: GET → ${res.status}`);
    failed++;
    continue;
  }
  const wf = await res.json();

  // The claim node's parameters are declared once here and applied whether the
  // node is being created or corrected, so the two paths cannot drift apart.
  const claimParameters = {
    resource: "row",
    operation: "create",
    tableId: "workflow_claims",
    dataToSend: "defineBelow",
    fieldsUi: {
      fieldValues: [
        { fieldId: "use_case", fieldValue: t.uc },
        { fieldId: "external_ref", fieldValue: EXTERNAL_REF_EXPR },
        { fieldId: "decision", fieldValue: t.decision },
        { fieldId: "note", fieldValue: `=claimed by n8n workflow ${t.id}` },
      ],
    },
  };

  const existing = wf.nodes.find((n) => n.name === CLAIM);
  if (existing) {
    const before = JSON.stringify(existing.parameters);
    existing.parameters = claimParameters;
    existing.credentials = SUPABASE_CRED;
    existing.onError = "continueErrorOutput";
    if (before === JSON.stringify(claimParameters)) {
      console.log(`= ${t.uc} already matches the spec`);
      continue;
    }
    console.log(`~ ${t.uc} claim parameters repaired`);
  } else {

  const gates = wf.nodes.find((n) => n.name === t.gates);
  const next = wf.nodes.find((n) => n.name === t.next);
  if (!gates || !next) {
    console.error(`✖ ${t.uc}: missing "${t.gates}" or "${t.next}"`);
    failed++;
    continue;
  }

  const [gx, gy] = gates.position;

  // Make room: everything downstream of the gates moves right by two node
  // widths. Laying the new nodes on top of existing ones would work
  // functionally and be unreadable, which for a graph a human debugs at 3am is
  // the same as broken.
  for (const n of wf.nodes) if (n.position[0] > gx) n.position[0] += 440;

  wf.nodes.push(
    {
      name: CLAIM,
      type: "n8n-nodes-base.supabase",
      typeVersion: 1,
      position: [gx + 220, gy],
      credentials: SUPABASE_CRED,
      // A conflict is an expected outcome, not a failure, so it leaves by the
      // error output instead of stopping the run.
      onError: "continueErrorOutput",
      parameters: claimParameters,
    },
    {
      name: CARRY,
      type: "n8n-nodes-base.code",
      typeVersion: 2,
      position: [gx + 440, gy],
      parameters: {
        jsCode:
          `// The Supabase node returns its own insert response, not our decision\n` +
          `// context. Restore it so nothing downstream had to change when the claim\n` +
          `// node was inserted.\n` +
          `//\n` +
          `// pairedItem is set explicitly because several downstream expressions\n` +
          `// address the gates node by name ($('${t.gates}').item). That resolves\n` +
          `// through item pairing, and a Code node that returns a bare object breaks\n` +
          `// the chain — the failure looks like "can't determine which item to use",\n` +
          `// nowhere near the node that actually caused it.\n` +
          `return [{ json: $('${t.gates}').first().json, pairedItem: { item: 0 } }];\n`,
      },
    },
    {
      name: STOP,
      type: "n8n-nodes-base.noOp",
      typeVersion: 1,
      position: [gx + 440, gy + 208],
      // Deliberately does nothing. A redelivery is normal traffic; the run ends
      // green having written nothing, and the claim row already in the table is
      // the record that it happened.
      parameters: {},
    }
  );

  wf.connections[t.gates] = { main: [[{ node: CLAIM, type: "main", index: 0 }]] };
  wf.connections[CLAIM] = {
    main: [
      [{ node: CARRY, type: "main", index: 0 }], // claimed → carry on
      [{ node: STOP, type: "main", index: 0 }], // conflict → stop quietly
    ],
  };
  wf.connections[CARRY] = { main: [[{ node: t.next, type: "main", index: 0 }]] };
  console.log(`→ ${t.uc} claim inserted between "${t.gates}" and "${t.next}"`);
  }

  const body = {
    name: wf.name,
    nodes: wf.nodes,
    connections: wf.connections,
    settings: Object.fromEntries(
      Object.entries(wf.settings ?? {}).filter(([k]) => ALLOWED_SETTINGS.includes(k))
    ),
  };
  const put = await fetch(`${BASE}/api/v1/workflows/${t.id}`, {
    method: "PUT",
    headers: H,
    body: JSON.stringify(body),
  });
  if (!put.ok) {
    console.error(`✖ ${t.uc}: PUT → ${put.status} ${(await put.text()).slice(0, 300)}`);
    failed++;
    continue;
  }
  console.log(`✔ ${t.uc} saved`);

  if (publish) {
    const act = await fetch(`${BASE}/api/v1/workflows/${t.id}/activate`, { method: "POST", headers: H });
    if (!act.ok) {
      console.error(`✖ ${t.uc}: activate → ${act.status}`);
      failed++;
      continue;
    }
    const after = await act.json();
    // An update writes a DRAFT. Reporting "published" without comparing these
    // two is how a fix sat in the editor for a session while production ran the
    // old graph.
    const live = after.versionId === after.activeVersionId;
    console.log(`${live ? "✔" : "✖"} ${t.uc} published — draft ${String(after.versionId).slice(0, 8)} / production ${String(after.activeVersionId).slice(0, 8)}`);
    if (!live) failed++;
  }
}

process.exit(failed ? 1 : 0);
