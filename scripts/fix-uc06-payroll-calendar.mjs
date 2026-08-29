#!/usr/bin/env node
// ---------------------------------------------------------------------------
// fix-uc06-payroll-calendar.mjs — point UC-06's payroll read at the endpoint
// Remote actually has, and make it answer for the right country
// ---------------------------------------------------------------------------
// WHAT WAS WRONG IN THE LIVE GRAPH
//
// `Fetch Payroll Runs (Remote)` called
// `GET /v1/company-payroll-runs?company_id=…`, which is not a path Remote has.
// Remote's index lists the operation as *"List Company Payroll Runs"* with
// reference id `get_v1_payroll-runs`: the TITLE was mistaken for the URL, and
// the mock server then implemented the invented path too, so the fixture agreed
// with the code and neither agreed with Remote. `src/remote/restClient.js` was
// fixed in commit cd445f0; this script is the same fix for the n8n path.
//
// It hid perfectly. The wrong path 404s, `onError: continueRegularOutput`
// reports that 404 as a SUCCESS carrying `{json:{error:{…,status:404}}}`, and
// the gates escalate `upstream_payroll_runs_404`. So UC-06's payroll gate
// escalated on every live run while looking exactly like a cautious gate doing
// its job — every `audit_log` row for this use case carries the phantom
// failure to prove it.
//
// WHY THE URL ALONE WOULD HAVE BEEN WORSE THAN THE DEAD GATE
//
// The live calendar is company-wide and MULTI-COUNTRY (SG/FR/CA/NL/US, 49
// overlapping period pairs), the endpoint accepts NO filters at all
// (`company_id`, `country_code`, `country`, `status` each answer 422
// "Unexpected field"), its `total_pages` reports 1 while later pages still
// return rows, and rows repeat (34 rows / 17 ids in one walk). `evaluateCutoff()`
// takes the first cycle covering the effective date, so a repointed-but-unfixed
// graph would have handed a French employee Singapore's 6 April lock instead of
// France's 20 April one — trading a visible failure for a silent wrong answer
// about payroll timing, which is the trade this codebase exists to refuse.
//
// So the fix is three parts, and the URL is the least of them:
//   1. this script: the correct path, plus PAGINATION that stops on an empty
//      page and never on `total_pages`;
//   2. `workflows/nodes-uc06/amendmentGates.js`: merge every page, dedupe by
//      id, filter on `country.alpha_2_code`, fail closed with no usable
//      country, and escalate rather than coin-flip when two cycles covering one
//      period disagree about the lock;
//   3. the audit row: `payrollCountry` and `payrollCycleIds`, so which
//      calendar a decision was made from is a durable fact and not something
//      you have to still have the execution open to see.
//
// `onError: continueRegularOutput` STAYS, deliberately. It is what disguised
// this bug, so the instinct is to remove it — but the gates' whole
// upstream-attribution design (src/shared/upstreamFailure.js) depends on
// receiving the error as an item. Without it a payroll 403 reds the node and
// kills the run BEFORE the claim node and before the audit write, losing the
// decision entirely; with it the run escalates naming the real cause and the
// decision is still recorded. The disguise was never the flag: it was that
// nothing distinguished "the endpoint refused" from "the endpoint does not
// exist", and `upstreamFailure.js` now does.
//
// USAGE
//   NODE_USE_ENV_PROXY=1 node scripts/fix-uc06-payroll-calendar.mjs [--publish]
//
// Declarative and idempotent: it makes the graph MATCH the spec below rather
// than applying a one-shot patch, so re-running it is a no-op and a later hand
// edit that drifts is corrected rather than doubled.
//
// `PUT /api/v1/workflows/{id}` PUBLISHES IN PLACE on this API (unlike
// `mcp__n8n__update_workflow`, which writes a draft), so this script re-reads
// the workflow afterwards and asserts `activeVersionId === versionId` and that
// the deployed Code node body is byte-identical to the local file. A success
// status from the write is not evidence of either.
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
  console.error("fix-uc06-payroll-calendar: set N8N_BASE_URL and N8N_API_KEY.");
  process.exit(2);
}

const H = { "X-N8N-API-KEY": KEY, "content-type": "application/json", accept: "application/json" };
const WORKFLOW = "WORKFLOW_UC06_ID";
const PAYROLL_NODE = "Fetch Payroll Runs (Remote)";
const GATES_NODE = "Amendment Gates";
const AUDIT_NODE = "Append Audit Log";
const GATES_FILE = "workflows/nodes-uc06/amendmentGates.js";

const publish = process.argv.includes("--publish");

/**
 * The payroll read, as it must be.
 *
 * `page_size=100` is one request for a calendar this size, but "one request is
 * very likely enough" is how a truncated read becomes a confident wrong answer,
 * so the pager still runs and still stops only on a page that comes back empty.
 * `maxRequests: 50` mirrors RemoteClient.listPayrollRuns()'s MAX_PAGES: a pager
 * whose termination signal is the response must not be able to spin forever if
 * the response stops being trustworthy in a new way.
 */
const PAYROLL_PARAMETERS = {
  url: "https://gateway.remote-sandbox.com/v1/payroll-runs",
  authentication: "genericCredentialType",
  genericAuthType: "httpHeaderAuth",
  options: {
    timeout: 20000,
    pagination: {
      pagination: {
        paginationMode: "updateAParameterInEachRequest",
        parameters: {
          parameters: [
            // $pageCount is 0 on the first request, so this is page 1, 2, 3…
            { type: "qs", name: "page", value: "={{ $pageCount + 1 }}" },
            { type: "qs", name: "page_size", value: "100" },
          ],
        },
        // NOT `total_pages`, which is demonstrably wrong on this endpoint
        // (reports 1 while page 2 still returns rows). An empty page is the
        // only signal it gives that has never lied.
        paginationCompleteWhen: "other",
        completeExpression: "={{ ($response.body?.data?.payroll_runs ?? []).length === 0 }}",
        limitPagesFetched: true,
        maxRequests: 50,
        requestInterval: 0,
      },
    },
  },
};

/**
 * The audit row's `details`. Everything before `payrollCountry` is unchanged;
 * the two new keys are what make this fix checkable after the fact — a decision
 * whose recorded calendar is "FR, 3 cycles" cannot later be confused with one
 * that silently read all seventeen, and one recorded as "null, 0 cycles" says
 * plainly that the country could not be resolved.
 */
const AUDIT_DETAILS =
  "={{ ({ amendmentId: $('Create Amendment Record').item.json.id," +
  " externalRef: $('Amendment Gates').item.json.externalRef," +
  " employmentId: $('Amendment Gates').item.json.employmentId," +
  " amendmentType: $('Amendment Gates').item.json.amendmentType," +
  " changes: $('Amendment Gates').item.json.changes," +
  " reason: $('Amendment Gates').item.json.reason," +
  " flags: $('Amendment Gates').item.json.flags," +
  " requestedEffectiveDate: $('Amendment Gates').item.json.requestedEffectiveDate," +
  " cutoffCycle: $('Amendment Gates').item.json.cutoff && $('Amendment Gates').item.json.cutoff.cycle ? $('Amendment Gates').item.json.cutoff.cycle.id : null," +
  " payrollCountry: $('Amendment Gates').item.json.employment ? $('Amendment Gates').item.json.employment.country_code : null," +
  " payrollCycleIds: ($('Amendment Gates').item.json.payrollCycles ?? []).map(c => c.id)," +
  " upstreamFailures: $('Amendment Gates').item.json.upstreamFailures }) }}";

// n8n returns settings keys on read that it refuses on write, so only the
// whitelisted ones are echoed back (same list as scripts/deploy-node.mjs).
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

// --- 1. the payroll read ----------------------------------------------------
const payroll = nodeNamed(wf, PAYROLL_NODE);
const payrollBefore = JSON.stringify(payroll.parameters);
payroll.parameters = PAYROLL_PARAMETERS;
// Stated, not merely left alone — see the header. An `onError` that silently
// reverted to the default would turn every upstream refusal into a lost
// decision.
payroll.onError = "continueRegularOutput";
if (payrollBefore !== JSON.stringify(payroll.parameters)) {
  changes.push(`${PAYROLL_NODE}: url + pagination`);
}

// --- 2. the gates body ------------------------------------------------------
const gates = nodeNamed(wf, GATES_NODE);
if (gates.parameters?.jsCode !== gatesSource) changes.push(`${GATES_NODE}: jsCode ← ${GATES_FILE}`);
// A STALE SECOND COPY OF THE DECISION LOGIC lives at `parameters.parameters
// .jsCode` on this node — a nested key some earlier writer left behind. n8n
// ignores it, so it changes nothing at runtime and it is three fixes out of
// date, which makes it the most dangerous kind of dead config: anyone reading
// the graph JSON to find out what the gates do finds a plausible, wrong answer
// first. Removed here rather than left for someone to trust.
if (gates.parameters?.parameters !== undefined) changes.push(`${GATES_NODE}: drop stale nested jsCode copy`);
gates.parameters = {
  mode: "runOnceForAllItems",
  language: "javaScript",
  jsCode: gatesSource,
};

// --- 3. the audit row -------------------------------------------------------
const audit = nodeNamed(wf, AUDIT_NODE);
const detailsField = (audit.parameters?.fieldsUi?.fieldValues ?? []).find((f) => f.fieldId === "details");
if (!detailsField) {
  console.error(`✖ ${AUDIT_NODE}: no "details" field to update`);
  process.exit(1);
}
if (detailsField.fieldValue !== AUDIT_DETAILS) changes.push(`${AUDIT_NODE}: details += payrollCountry/payrollCycleIds`);
detailsField.fieldValue = AUDIT_DETAILS;

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
const deployedPayroll = nodeNamed(after, PAYROLL_NODE);
const deployedDetails = (nodeNamed(after, AUDIT_NODE).parameters?.fieldsUi?.fieldValues ?? []).find(
  (f) => f.fieldId === "details"
);
const live = after.versionId === after.activeVersionId;

const checks = [
  ["gates body byte-identical to " + GATES_FILE, deployedGates === gatesSource],
  ["no stale nested jsCode copy", nodeNamed(after, GATES_NODE).parameters?.parameters === undefined],
  ["payroll url is /v1/payroll-runs", deployedPayroll.parameters?.url === PAYROLL_PARAMETERS.url],
  [
    "payroll pagination stops on an empty page",
    deployedPayroll.parameters?.options?.pagination?.pagination?.completeExpression ===
      PAYROLL_PARAMETERS.options.pagination.pagination.completeExpression,
  ],
  ["payroll keeps onError: continueRegularOutput", deployedPayroll.onError === "continueRegularOutput"],
  ["audit details carries payrollCycleIds", deployedDetails?.fieldValue === AUDIT_DETAILS],
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
