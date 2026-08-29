#!/usr/bin/env node
// ---------------------------------------------------------------------------
// fix-uc06-amendment-form.mjs — point UC-06's schema read at the form that can
// actually express a contract amendment
// ---------------------------------------------------------------------------
// WHAT WAS WRONG IN THE LIVE GRAPH
//
// `Fetch Country Schema (Remote)` called
// `GET /v1/countries/{ALPHA3}/employment_basic_information`. That form declares
// exactly ten properties — has_seniority_date, name, job_title,
// provisional_start_date, tax_servicing_countries, tax_job_category,
// login_email, personal_email, seniority_date, work_email — with
// `additionalProperties: false`. There is NO salary property and NO hours
// property [CONFIRMED live, gateway.remote-sandbox.com 2026-08-18]. UC-06's
// headline case is a salary change, so the graph was validating every amendment
// against a form that structurally cannot state one.
//
// Two more facts about the same pair, each independently fatal:
//   `PATCH /v1/employments/{id}/basic-information` answers 404 on every
//   employment and every status — the verb does not exist. The documented verb
//   is PUT, and Remote's reference says its supported employment statuses are
//   `created`, `job_title_review`, `created_reserve_paid`,
//   `created_awaiting_reserve` — NOT `active`, which is the only status this
//   graph's own gate 2 admits.
//
// THE RIGHT FORM, and it works on active employments:
//   GET /v1/contract-amendments/schema?employment_id=&country_code=&form=contract_amendment
//   Live NLD required: annual_gross_salary, effective_date, job_title,
//   role_description, contract_duration_type, work_schedule,
//   work_hours_per_week. 200 for eor + global_payroll across
//   NLD/DEU/GBR/FRA/CAN/SGP/PRT; 404 for every contractor; 500 for USA and NGA.
//
// Proven end to end by really doing it: a contract amendment was filed against
// the ACTIVE Dutch employment 75b88008-… (POST /v1/contract-amendments -> 201,
// amendment 82f8d1c6-…, `changes: {"compensation.amount":{"current":7500000,
// "previous":7200000}}`) and then cancelled through the Sandbox-only cancel
// endpoint.
//
// THE COUNTRY CODE ALONE IS NOT ENOUGH, AND THAT IS THE PART WORTH READING.
// This endpoint is documented as "the json schema of the contract_amendment
// form for a SPECIFIC EMPLOYMENT", and it means it: the DEU form fetched with a
// Dutch employment id requires eight fields, while the same DEU form fetched
// with the German employment requires TEN, adding `schedule_type` and
// `required_qualifications`. So `employment_id` is a required query parameter
// here, not a convenience, and the URL below sends the id off the record just
// fetched — falling back to the requested id only when the employment read
// returned no usable record, in which case the schema read will fail too and be
// recorded as an upstream failure rather than guessed around.
//
// `onError: continueRegularOutput` STAYS, for the reason
// scripts/fix-uc06-payroll-calendar.mjs states at length: the gates'
// upstream-attribution design needs the failure delivered as an item. Without
// it a 404 reds the node and kills the run BEFORE the claim node and the audit
// write, losing the decision entirely.
//
// USAGE
//   NODE_USE_ENV_PROXY=1 node scripts/fix-uc06-amendment-form.mjs [--publish]
//
// Declarative and idempotent: it makes the graph MATCH the spec below rather
// than applying a one-shot patch. `PUT /api/v1/workflows/{id}` PUBLISHES IN
// PLACE on this API (unlike `mcp__n8n__update_workflow`, which writes a draft),
// so this re-reads the workflow afterwards and asserts
// `activeVersionId === versionId` and that the deployed Code node body is
// byte-identical to the local file. A success status from the write is not
// evidence of either.
// ---------------------------------------------------------------------------

import "dotenv/config";   // the repo keeps credentials in .env; without this this
                          // script fails with a credentials-shaped error on a
                          // machine that HAS them — see verify-deployed-nodes.mjs
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASE = (process.env.N8N_BASE_URL ?? "").replace(/[/.]+$/, "");
const KEY = process.env.N8N_API_KEY;

if (!BASE || !KEY) {
  console.error("fix-uc06-amendment-form: set N8N_BASE_URL and N8N_API_KEY.");
  process.exit(2);
}

const H = { "X-N8N-API-KEY": KEY, "content-type": "application/json", accept: "application/json" };
const WORKFLOW = "WORKFLOW_UC06_ID";
const SCHEMA_NODE = "Fetch Country Schema (Remote)";
const GATES_NODE = "Amendment Gates";
const GATES_FILE = "workflows/nodes-uc06/amendmentGates.js";

const publish = process.argv.includes("--publish");

// The alpha-3 resolution is carried over from the previous URL unchanged: the
// live record nests `country.code` (ALPHA-3) and has no top-level
// `country_code`, and this endpoint's `country_code` parameter is documented as
// "Country code according to ISO 3-digit alphabetic codes". A code that is not
// three A–Z letters resolves to the literal `UNRESOLVED_COUNTRY`, which 404s —
// visibly — rather than silently sending something plausible.
const ALPHA3 =
  "{{ [$json.data?.employment?.country?.code, $json.data?.country?.code]" +
  ".map(c => typeof c === 'string' ? c.trim().toUpperCase() : '')" +
  ".find(c => c.length === 3 && c.split('').every(ch => ch >= 'A' && ch <= 'Z'))" +
  " || 'UNRESOLVED_COUNTRY' }}";

// The employment id off the record just fetched. The fallback to the REQUESTED
// id is deliberate and cannot launder a failed read: if the employment fetch
// returned an error item there is no record, the schema fetch for that id fails
// too, and `describeUpstreamError()` in the gates records it as
// `upstream_country_schema_<status>` — which is what is true.
const EMPLOYMENT_ID =
  "{{ $json.data?.employment?.id || $json.data?.id" +
  " || $('Normalize Amendment Request').first().json.employmentId || 'UNRESOLVED_EMPLOYMENT' }}";

const SCHEMA_PARAMETERS = {
  authentication: "genericCredentialType",
  genericAuthType: "httpHeaderAuth",
  options: { timeout: 20000 },
  url:
    `=https://gateway.remote-sandbox.com/v1/contract-amendments/schema` +
    `?employment_id=${EMPLOYMENT_ID}&country_code=${ALPHA3}&form=contract_amendment`,
};

const ALLOWED_SETTINGS = [
  "executionOrder",
  "saveDataErrorExecution",
  "saveDataSuccessExecution",
  "saveManualExecutions",
  "saveExecutionProgress",
  "executionTimeout",
  "errorWorkflow",
  "timezone",
  "callerPolicy",
  "callerIds",
];

const get = async () => {
  const res = await fetch(`${BASE}/api/v1/workflows/${WORKFLOW}`, { headers: H });
  if (!res.ok) {
    console.error(`✖ GET ${WORKFLOW} → ${res.status}`);
    process.exit(1);
  }
  return res.json();
};

const nodeNamed = (wf, name) => {
  const node = (wf.nodes ?? []).find((n) => n.name === name);
  if (!node) {
    console.error(`✖ ${WORKFLOW}: no node named "${name}"`);
    process.exit(1);
  }
  return node;
};

const wf = await get();
const gatesSource = await readFile(path.join(ROOT, GATES_FILE), "utf8");
const changes = [];

// --- 1. the schema read -----------------------------------------------------
const schema = nodeNamed(wf, SCHEMA_NODE);
const schemaBefore = JSON.stringify(schema.parameters);
const credentials = schema.credentials;
schema.parameters = SCHEMA_PARAMETERS;
schema.credentials = credentials; // never re-derive a credential from a script
schema.onError = "continueRegularOutput";
if (schemaBefore !== JSON.stringify(schema.parameters)) {
  changes.push(`${SCHEMA_NODE}: url ← /v1/contract-amendments/schema`);
}

// --- 2. the gates body ------------------------------------------------------
const gates = nodeNamed(wf, GATES_NODE);
if (gates.parameters?.jsCode !== gatesSource) changes.push(`${GATES_NODE}: jsCode ← ${GATES_FILE}`);
// A stale second copy of the decision logic has appeared at
// `parameters.parameters.jsCode` on this node before. n8n ignores it, so it
// changes nothing at runtime and is silently out of date — the most dangerous
// kind of dead config, since anyone reading the graph JSON finds a plausible,
// wrong answer first. Removed here rather than left for someone to trust.
if (gates.parameters?.parameters !== undefined) changes.push(`${GATES_NODE}: drop stale nested jsCode copy`);
gates.parameters = {
  mode: "runOnceForAllItems",
  language: "javaScript",
  jsCode: gatesSource,
};

if (changes.length === 0) {
  console.log("= already matches spec, nothing to write");
} else {
  for (const c of changes) console.log(`  → ${c}`);
}

const body = {
  name: wf.name,
  nodes: wf.nodes,
  connections: wf.connections,
  settings: Object.fromEntries(
    Object.entries(wf.settings ?? {}).filter(([k]) => ALLOWED_SETTINGS.includes(k))
  ),
};
const put = await fetch(`${BASE}/api/v1/workflows/${WORKFLOW}`, {
  method: "PUT",
  headers: H,
  body: JSON.stringify(body),
});
if (!put.ok) {
  console.error(`✖ PUT ${WORKFLOW} → ${put.status} ${(await put.text()).slice(0, 400)}`);
  process.exit(1);
}
console.log(`✔ saved ${WORKFLOW}`);

if (publish) {
  const act = await fetch(`${BASE}/api/v1/workflows/${WORKFLOW}/activate`, { method: "POST", headers: H });
  if (!act.ok) {
    console.error(`✖ activate ${WORKFLOW} → ${act.status} ${(await act.text()).slice(0, 300)}`);
    process.exit(1);
  }
}

// --- verify against what n8n reports, not against the write's status code ----
const after = await get();
const deployedGates = nodeNamed(after, GATES_NODE).parameters?.jsCode ?? "";
const deployedSchema = nodeNamed(after, SCHEMA_NODE);
const live = after.versionId === after.activeVersionId;

const checks = [
  ["gates body byte-identical to " + GATES_FILE, deployedGates === gatesSource],
  ["no stale nested jsCode copy", nodeNamed(after, GATES_NODE).parameters?.parameters === undefined],
  ["schema url is /v1/contract-amendments/schema", deployedSchema.parameters?.url === SCHEMA_PARAMETERS.url],
  ["schema url carries employment_id", String(deployedSchema.parameters?.url).includes("employment_id=")],
  ["schema url carries form=contract_amendment", String(deployedSchema.parameters?.url).includes("form=contract_amendment")],
  ["schema keeps its Remote credential", Boolean(deployedSchema.credentials?.httpHeaderAuth?.id)],
  ["schema keeps onError: continueRegularOutput", deployedSchema.onError === "continueRegularOutput"],
  [`draft ${String(after.versionId).slice(0, 8)} is the ACTIVE version`, live],
];

let ok = true;
for (const [label, pass] of checks) {
  console.log(`${pass ? "✔" : "✖"} ${label}`);
  if (!pass) ok = false;
}
if (!live) {
  console.log(`  production is ${String(after.activeVersionId).slice(0, 8)} — re-run with --publish`);
}
process.exit(ok ? 0 : 1);
