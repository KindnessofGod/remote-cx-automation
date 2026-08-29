#!/usr/bin/env node
// ---------------------------------------------------------------------------
// verify-claim-nodes.mjs — is exactly-once delivery actually in force?
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
//
// UC-01 learned the hard way that a webhook is an at-least-once channel: ticket
// #5 arrived three times within microseconds and produced two `audit_log` rows
// 30µs apart plus a duplicate verification letter posted publicly to a real
// customer. Nothing in the graph asked "have I already handled this one?"
//
// The answer is a claim node — a single INSERT into `workflow_claims`, whose
// PRIMARY KEY (use_case, external_ref) adjudicates the race in Postgres rather
// than in application code. All nine graphs now carry one, in the same shape:
//
//   …gates → [Claim Ticket (Idempotency)] → [Carry Context After Claim] → first
//                     │                                                durable
//                     └── (error output) → [Duplicate Delivery — Stop]   write
//
// That shape is the whole guarantee, and every part of it is load-bearing:
//
//   * AFTER the gates, because re-deciding is free (a read plus deterministic
//     logic leaves no trace) and a duplicate stopped earlier never records WHY.
//   * BEFORE the first durable write, because everything downstream is a record
//     or an outward act — a Supabase row, a Zendesk reply, a Remote PATCH.
//   * The error output must reach a NoOp that goes nowhere. If a redelivery
//     could leave that NoOp, the claim would be decoration.
//   * `Carry Context After Claim` must restore the gates' output, because the
//     Supabase node emits its own insert response instead.
//
// A single wrong edge silently un-does all of it while every node still reports
// green, so this checks the WIRING, not just the presence of the nodes.
//
// AND IT CHECKS WHAT IS PUBLISHED, NOT WHAT IS DRAFTED. n8n's REST API returns
// the draft. `mcp__n8n__update_workflow` writes a draft. A session has already
// been lost to a fix that was perfect, deployed, and not running — so a
// `versionId` that differs from `activeVersionId` is reported as loudly as a
// broken edge, and an inactive workflow is a failure too: a claim node in a
// graph that is not serving traffic protects nobody.
//
// USAGE
//   NODE_USE_ENV_PROXY=1 npm run verify-claims
//   NODE_USE_ENV_PROXY=1 node scripts/verify-claim-nodes.mjs
//
// NODE_USE_ENV_PROXY=1 is REQUIRED in this container. Node's global fetch
// ignores HTTPS_PROXY, and anything that goes direct is refused with
// `403 Host not in allowlist` — a message that reads like an allowlist problem
// even when the host is allowlisted and curl reaches it in the same shell.
// It is not baked into the npm script because no other script here does that,
// and an env var that only some commands need is better named at the call site
// than hidden inside package.json.
//
// Exits 0 when every graph is wired and published, 1 on any defect, 2 on a
// config or transport problem. The three are distinct on purpose: "the
// guarantee is broken" and "I could not tell you whether the guarantee is
// broken" are different answers, and neither CI nor a human may read the
// second as a pass.
// ---------------------------------------------------------------------------

import "dotenv/config";   // credentials live in .env; without this this check
                          // exits 2 on a machine that HAS them, and an exit 2 is
                          // indistinguishable from genuinely being unable to reach
                          // n8n — the confusion this file exists to prevent

const CLAIM = "Claim Ticket (Idempotency)";
const CARRY = "Carry Context After Claim";
const STOP = "Duplicate Delivery — Stop";

const CLAIM_TABLE = "workflow_claims";
const SUPABASE_CRED_ID = "CRED_SUPABASE";
const EXTERNAL_REF_EXPR = "={{ $json.externalRef || ('unreferenced:' + $execution.id) }}";

/**
 * One row per workflow that must claim before it writes.
 *
 * `gates` is the last node whose output IS the decision context; `next` is the
 * first node that leaves a mark. `decision` is what the claim row records for
 * forensics — an expression where the gates produce a decision, a literal where
 * the tier forbids one (UC-07/UC-08 have no branch: every run escalates).
 *
 * UC-01 is here and NOT in scripts/add-claim-nodes.mjs, because its claim node
 * was hand-built first and the script was written to bring the other eight up
 * to it. test/claimNodeContract.test.js asserts the two tables still describe
 * the same eight graphs, so this list cannot quietly stop covering one.
 */
const CLAIM_TARGETS = [
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
];

// Strip trailing slashes AND a trailing dot. A dot is a legal DNS root label,
// so `host.example.org.` resolves — but it does not match the TLS certificate,
// and the failure surfaces as a bare "fetch failed" with nothing pointing at
// the URL. Warn rather than fix silently: a malformed value in the environment
// is worth knowing about even when it is recoverable.
const rawBase = process.env.N8N_BASE_URL ?? "";
const BASE = rawBase.replace(/[/.]+$/, "");
if (BASE !== rawBase.replace(/\/+$/, "")) {
  console.warn(
    `note: N8N_BASE_URL has a trailing dot (${rawBase}). Using ${BASE}.\n` +
      `      Worth correcting at the source — as provided it fails TLS.`
  );
}
const KEY = process.env.N8N_API_KEY;

if (!BASE || !KEY) {
  console.error(
    "verify-claim-nodes: set N8N_BASE_URL and N8N_API_KEY.\n" +
      "This check cannot run without them, and a skipped check must never look\n" +
      "like a passing one — exiting 2."
  );
  process.exit(2);
}

async function fetchWorkflow(id) {
  const res = await fetch(`${BASE}/api/v1/workflows/${id}`, {
    headers: { "X-N8N-API-KEY": KEY, accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(`GET /workflows/${id} → ${res.status} ${res.statusText}`);
  }
  return res.json();
}

/** Every node a given node's main outputs lead to, as a flat list of names. */
const mainTargets = (connections, name) =>
  (connections?.[name]?.main ?? []).flatMap((branch) => (branch ?? []).map((c) => c.node));

/** Which nodes feed INTO `name`. The direction the wiring bugs hide in. */
function inboundTo(connections, name) {
  const from = [];
  for (const [source, outs] of Object.entries(connections ?? {})) {
    for (const branch of outs.main ?? []) {
      for (const c of branch ?? []) if (c.node === name) from.push(source);
    }
  }
  return from;
}

const fieldValue = (node, id) =>
  (node.parameters?.fieldsUi?.fieldValues ?? []).find((f) => f.fieldId === id)?.fieldValue;

let defective = 0;
let unpublished = 0;
let checked = 0;

for (const t of CLAIM_TARGETS) {
  let wf;
  try {
    wf = await fetchWorkflow(t.id);
  } catch (err) {
    console.error(
      `✖ ${t.uc}: could not read the workflow — ${err.message}\n` +
        `  Exiting 2: this is "I could not check", not "the check failed".`
    );
    process.exit(2);
  }

  checked++;
  const problems = [];
  const notes = [];
  const nodes = wf.nodes ?? [];
  const conns = wf.connections ?? {};
  const byName = new Map(nodes.map((n) => [n.name, n]));

  const claim = byName.get(CLAIM);
  const carry = byName.get(CARRY);
  const stop = byName.get(STOP);
  const gates = byName.get(t.gates);
  const next = byName.get(t.next);

  // --- 1. the three nodes exist at all ------------------------------------
  if (!claim) problems.push(`no node named "${CLAIM}" — this graph can still process a redelivery twice`);
  if (!carry) problems.push(`no node named "${CARRY}"`);
  if (!stop) problems.push(`no node named "${STOP}" — a conflicting claim has nowhere to land`);
  if (!gates) problems.push(`no gates node named "${t.gates}" — either renamed in n8n or this table is stale; both are drift`);
  if (!next) problems.push(`no first-durable-write node named "${t.next}"`);

  // --- 2. the claim node is the right node, configured the right way -------
  if (claim) {
    if (claim.type !== "n8n-nodes-base.supabase") {
      problems.push(`claim node is a ${claim.type}, not a Supabase row-create`);
    }
    // The Supabase node's own defaults are resource=row, operation=create,
    // dataToSend=defineBelow, so an omitted key is not a defect — UC-01's
    // hand-built node omits all three and behaves identically. Compare the
    // EFFECTIVE value; asserting the literal key would report a false defect
    // on a node that is correct.
    const p = claim.parameters ?? {};
    if ((p.resource ?? "row") !== "row") problems.push(`claim resource is "${p.resource}", not "row"`);
    if ((p.operation ?? "create") !== "create") problems.push(`claim operation is "${p.operation}", not "create"`);
    if ((p.dataToSend ?? "defineBelow") !== "defineBelow") {
      problems.push(
        `claim dataToSend is "${p.dataToSend}" — with autoMapInputData the whole decision ` +
          `context would be mapped onto columns that do not exist`
      );
    }
    if (p.tableId !== CLAIM_TABLE) {
      problems.push(`claim writes to "${p.tableId}", not "${CLAIM_TABLE}" — the ledger IS the guarantee`);
    }
    const credId = claim.credentials?.supabaseApi?.id;
    if (credId !== SUPABASE_CRED_ID) {
      problems.push(`claim credential is ${credId ?? "(none)"}, not supabaseApi ${SUPABASE_CRED_ID}`);
    }
    // Without continueErrorOutput a conflicting insert ERRORS the run instead
    // of taking the second output. The duplicate would still be stopped, but
    // every redelivery would page a human about entirely normal webhook
    // behaviour — and an alert channel that cries wolf gets muted.
    if (claim.onError !== "continueErrorOutput") {
      problems.push(`claim onError is "${claim.onError ?? "(default)"}", not "continueErrorOutput"`);
    }

    const expected = {
      use_case: t.uc,
      external_ref: EXTERNAL_REF_EXPR,
      decision: t.decision,
      note: `=claimed by n8n workflow ${t.id}`,
    };
    for (const [id, want] of Object.entries(expected)) {
      const got = fieldValue(claim, id);
      if (got !== want) problems.push(`claim field ${id} is ${JSON.stringify(got)}, expected ${JSON.stringify(want)}`);
    }
    const extra = (claim.parameters?.fieldsUi?.fieldValues ?? [])
      .map((f) => f.fieldId)
      .filter((id) => !(id in expected));
    if (extra.length) problems.push(`claim writes unexpected column(s): ${extra.join(", ")}`);
  }

  // --- 3. the wiring, which is where a silent regression actually lives ----
  if (gates) {
    const branches = conns[t.gates]?.main ?? [];
    const outs = mainTargets(conns, t.gates);
    if (branches.length !== 1 || outs.length !== 1 || outs[0] !== CLAIM) {
      problems.push(
        `"${t.gates}" leads to [${outs.join(", ") || "nothing"}] — its SOLE main output must be "${CLAIM}". ` +
          `Any second edge is a path around the claim.`
      );
    }
  }

  if (claim) {
    const branches = conns[CLAIM]?.main ?? [];
    const ok0 = (branches[0] ?? []).length === 1 && branches[0][0].node === CARRY;
    const ok1 = (branches[1] ?? []).length === 1 && branches[1][0].node === STOP;
    if (branches.length !== 2 || !ok0 || !ok1) {
      problems.push(
        `claim outputs are ${JSON.stringify(branches.map((b) => (b ?? []).map((c) => c.node)))} — ` +
          `expected main[0] → "${CARRY}" (claimed) and main[1] → "${STOP}" (conflict)`
      );
    }
  }

  if (carry) {
    const outs = mainTargets(conns, CARRY);
    if (outs.length !== 1 || outs[0] !== t.next) {
      problems.push(`"${CARRY}" leads to [${outs.join(", ") || "nothing"}], expected "${t.next}"`);
    }
    // The Code body must hand the gates' decision context back. If it returned
    // the Supabase insert response, every downstream expression would read
    // fields that are not there — and n8n would not complain.
    const body = carry.parameters?.jsCode ?? "";
    if (!body.includes(`$('${t.gates}')`)) {
      problems.push(`"${CARRY}" does not restore "${t.gates}"'s output — downstream nodes would read the insert response`);
    }
  }

  if (stop) {
    if (stop.type !== "n8n-nodes-base.noOp") {
      problems.push(`"${STOP}" is a ${stop.type}, not a NoOp — a duplicate must do nothing, quietly`);
    }
    const onward = mainTargets(conns, STOP);
    if (onward.length) {
      problems.push(`"${STOP}" continues to [${onward.join(", ")}] — a duplicate that carries on is not stopped at all`);
    }
  }

  // The check that catches an insertion done half-way: the first durable write
  // must be reachable ONLY through the claim. A leftover direct edge from the
  // gates would let a redelivery write anyway, and every node would still be
  // green because both paths work.
  if (next) {
    const feeders = inboundTo(conns, t.next);
    const bypass = feeders.filter((f) => f !== CARRY);
    if (!feeders.includes(CARRY)) {
      problems.push(`"${t.next}" is not fed by "${CARRY}" — the claim is not on the path to the first durable write`);
    }
    if (bypass.length) {
      problems.push(`"${t.next}" is ALSO reachable from [${bypass.join(", ")}] — that path skips the claim entirely`);
    }
  }

  // --- 4. nothing was left dangling by the insertion -----------------------
  // Moving edges around is exactly how a node ends up connected to nothing:
  // it stays in the graph, stays green, and never runs again.
  const reachedByAnEdge = new Set(
    Object.values(conns).flatMap((outs) => (outs.main ?? []).flatMap((b) => (b ?? []).map((c) => c.node)))
  );
  const orphans = nodes
    .filter((n) => !reachedByAnEdge.has(n.name))
    .filter((n) => !/webhook|trigger/i.test(n.type))
    .filter((n) => !n.disabled)
    .map((n) => n.name);
  if (orphans.length) {
    problems.push(`orphaned (no inbound edge, never runs): ${orphans.join(", ")}`);
  }

  // --- 5. pairedItem, but only where it is actually load-bearing -----------
  // `$('Gates').item` resolves through item pairing, and a Code node returning
  // a bare object breaks the chain — the failure reads "can't determine which
  // item to use", nowhere near the node that caused it. Where a graph only ever
  // uses `.first()`, pairing is not required, so demanding it everywhere would
  // report a defect that is not one (UC-01 is exactly that case).
  if (carry) {
    const usesItemPairing = JSON.stringify(nodes).includes(`$('${t.gates}').item`);
    const setsPairedItem = (carry.parameters?.jsCode ?? "").includes("pairedItem");
    if (usesItemPairing && !setsPairedItem) {
      problems.push(`downstream nodes use $('${t.gates}').item but "${CARRY}" does not set pairedItem`);
    } else if (!setsPairedItem) {
      notes.push(`"${CARRY}" sets no pairedItem — safe here, no node addresses "${t.gates}" by .item`);
    }
  }

  // --- 6. and the half that is easiest to miss: is any of this LIVE? -------
  if (!wf.active) {
    problems.push(`workflow is NOT active — a claim node in a graph that serves no traffic protects nobody`);
  }
  if (wf.versionId && wf.activeVersionId && wf.versionId !== wf.activeVersionId) {
    unpublished++;
    problems.push(
      `UNPUBLISHED — draft ${String(wf.versionId).slice(0, 8)} ≠ production ${String(wf.activeVersionId).slice(0, 8)}. ` +
        `Everything above describes the DRAFT; production is running something else.`
    );
  } else if (wf.active && !wf.activeVersionId) {
    problems.push(`active but reports no activeVersionId — cannot confirm the draft is what runs`);
  }

  // --- report -------------------------------------------------------------
  if (problems.length) {
    defective++;
    console.error(`\n✖ ${t.uc}  ${wf.name ?? t.id}`);
    for (const p of problems) console.error(`    · ${p}`);
  } else {
    console.log(`✔ ${t.uc}  ${t.gates} → ${CLAIM} → ${CARRY} → ${t.next}   (published, active)`);
    for (const n of notes) console.log(`    note: ${n}`);
  }
}

console.log(
  `\n${checked} workflow${checked === 1 ? "" : "s"} checked · ${defective} defective · ` +
    `${unpublished} with unpublished changes.`
);

if (defective > 0) {
  console.error(
    "\nThe claim node is the only thing standing between an at-least-once webhook\n" +
      "and a second letter in a customer's inbox. Fix the graph(s) above, then\n" +
      "publish — an update writes a draft, it does not go live."
  );
  process.exit(1);
}
