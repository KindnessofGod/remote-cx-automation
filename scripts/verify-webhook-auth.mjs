#!/usr/bin/env node
// ---------------------------------------------------------------------------
// verify-webhook-auth.mjs — do the nine PRODUCTION webhooks actually refuse an
//                           unauthenticated caller?
// ---------------------------------------------------------------------------
// Checks the DEPLOYED thing, not a local file, and follows the same contract as
// verify-deployed / verify-traces / verify-ticket-hygiene: it exits 2 — never
// 0 — when it cannot reach what it is checking, so a skipped check can never be
// misread as a passing one.
//
// WHY THE HTTP PROBE IS THE POINT (docs/WEBHOOK-AUTH.md §3)
//
// Reading `authentication: "headerAuth"` off the graph proves a parameter is
// set. It does not prove the running instance refuses anybody. Those came apart
// on 2026-08-27: UC-01 read `headerAuth` with a credential attached while the
// credential was the WRONG ONE (an outbound Remote API token), a configuration
// that reads correct in every structural check and would have rejected every
// real delivery. So each graph gets an unauthenticated POST and must answer 403
// AND create no execution.
//
// WHAT THIS CANNOT DO, STATED PLAINLY. It cannot prove the key still OPENS the
// door — that needs the shared secret, which lives only in the n8n credential
// store and nine Zendesk records and is readable from neither. A green run here
// means "shut", not "working". Only a real Zendesk delivery proves "working",
// and Zendesk's own webhook TEST endpoint cannot stand in for one: it builds a
// synthetic webhook carrying no credentials and reports every correctly-secured
// webhook as broken (§4.1).
//
// Needs N8N_API_KEY, and NODE_USE_ENV_PROXY=1 in a proxied container.
// ---------------------------------------------------------------------------
import "dotenv/config";   // the repo keeps credentials in .env. Without this the
                          // script exits 2 with "N8N_API_KEY is not set" on a machine
                          // that HAS the key — an honest refusal to a question it was
                          // never actually asked, and indistinguishable at a glance
                          // from n8n being unreachable. The sibling verify-* scripts
                          // all load it; this one was missed (b5aafe4 covered 14).
import process from "node:process";

const BASE = process.env.N8N_BASE_URL_PUBLIC || "https://n8n.your-host.example";
const KEY = process.env.N8N_API_KEY;

/** The nine production graphs, and the webhook path each one answers on. */
const GRAPHS = [
  { uc: "UC-01", id: "WORKFLOW_UC01_ID", path: "uc-01-verification" },
  { uc: "UC-02", id: "WORKFLOW_UC02_ID", path: "uc-02-expense" },
  { uc: "UC-03", id: "WORKFLOW_UC03_ID", path: "uc-03-inquiry" },
  { uc: "UC-04", id: "WORKFLOW_UC04_ID", path: "uc-04-workation" },
  { uc: "UC-05", id: "WORKFLOW_UC05_ID", path: "uc-05-resignation" },
  { uc: "UC-06", id: "WORKFLOW_UC06_ID", path: "uc-06-amendment" },
  { uc: "UC-07", id: "WORKFLOW_UC07_ID", path: "uc-07-relocation" },
  { uc: "UC-08", id: "WORKFLOW_UC08_ID", path: "uc-08-inquiry" },
  { uc: "UC-09", id: "WORKFLOW_UC09_ID", path: "uc-09-adjustment" },
];

// The n8n Webhook node's OWN default. n8n prunes any parameter equal to its
// default before saving, so a node configured to "Immediately" through the
// EDITOR stores no `responseMode` key at all — see docs/WEBHOOK-AUTH.md §4.2.
// Absent means DEFAULT, never "unset".
const RESPONSE_MODE_NODE_DEFAULT = "onReceived";
const WANT_RESPONSE_MODE = "onReceived";
const WANT_RESPONSE_DATA = '{"status":"received"}';

function die(msg) {
  console.error(`\nCANNOT CHECK: ${msg}`);
  console.error("Exiting 2 — this is NOT a pass.");
  process.exit(2);
}

async function api(pathname) {
  const res = await fetch(`${BASE}/api/v1${pathname}`, { headers: { "X-N8N-API-KEY": KEY } });
  if (!res.ok) die(`GET /api/v1${pathname} -> ${res.status} ${res.statusText}`);
  return res.json();
}

/** Newest execution id for a workflow, or null. Compared before/after the probe:
 *  a count would be capped by `limit` on a busy graph and silently stop moving. */
async function newestExecutionId(workflowId) {
  const d = await api(`/executions?workflowId=${workflowId}&limit=1`);
  return d?.data?.[0]?.id ?? null;
}

if (!KEY) die("N8N_API_KEY is not set.");

console.log(`Checking ${GRAPHS.length} production webhooks on ${BASE}\n`);

const defects = [];
for (const g of GRAPHS) {
  const wf = await api(`/workflows/${g.id}`);
  const node = (wf.nodes ?? []).find((n) => n.type === "n8n-nodes-base.webhook");
  if (!node) { defects.push(`${g.uc}: no webhook node`); continue; }

  const p = node.parameters ?? {};
  const cred = node.credentials?.httpHeaderAuth;
  const issues = [];

  if (p.authentication !== "headerAuth") issues.push(`authentication=${JSON.stringify(p.authentication ?? "none")}`);
  if (!cred?.id) issues.push("no header-auth credential attached");
  if ((p.responseMode ?? RESPONSE_MODE_NODE_DEFAULT) !== WANT_RESPONSE_MODE) {
    issues.push(`responseMode effectively ${JSON.stringify(p.responseMode ?? RESPONSE_MODE_NODE_DEFAULT)} — the F-4 disclosure`);
  }
  if (p.options?.responseData !== WANT_RESPONSE_DATA) issues.push(`responseData=${JSON.stringify(p.options?.responseData)}`);
  if (wf.active !== true) issues.push("workflow is not active");

  // The behavioural half: does the RUNNING instance actually refuse?
  const before = await newestExecutionId(g.id);
  let status, body;
  try {
    const res = await fetch(`${BASE}/webhook/${g.path}?src=verify-webhook-auth`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    status = res.status;
    body = (await res.text()).slice(0, 60);
  } catch (err) {
    die(`probing /webhook/${g.path}: ${err.message}`);
  }
  await new Promise((r) => setTimeout(r, 1500));
  const after = await newestExecutionId(g.id);

  if (status !== 403) issues.push(`unauthenticated POST returned ${status} (${body}) — expected 403`);
  if (before !== after) issues.push(`an execution RAN for an unauthenticated caller (${before} -> ${after})`);

  const verdict = issues.length ? `DEFECTIVE — ${issues.join("; ")}` : `locked (403, no execution)`;
  console.log(`  ${g.uc}  ${issues.length ? "✗" : "✓"}  ${verdict}`);
  if (issues.length) defects.push(`${g.uc}: ${issues.join("; ")}`);
}

console.log(`\n${GRAPHS.length} checked · ${defects.length} defective`);
if (defects.length) {
  console.error("\nA green run here means SHUT, not WORKING — prove the positive");
  console.error("direction with a real Zendesk delivery (docs/WEBHOOK-AUTH.md §3).");
  process.exit(1);
}
console.log("\nAll nine refuse an unauthenticated caller.");
console.log("This does NOT prove the key still opens them — see docs/WEBHOOK-AUTH.md §3.");
