// ---------------------------------------------------------------------------
// verify-live-uc01.mjs  —  Read-only proof that the UC-01 chain still works
// ---------------------------------------------------------------------------
// WHY THIS EXISTS, AND WHY IT IS NOT `npm run live`
// `npm run live` (src/liveVerify.js) is the fuller check, but it REQUIRES
// SUPABASE_DB_URL and opens a raw TCP Postgres connection — which the coding
// container cannot do at all (CLAUDE.md §6: an HTTP CONNECT proxy cannot relay
// a raw pg socket, so `db.<ref>.supabase.co:5432` fails ENOTFOUND no matter
// what is allowlisted). One unreachable dependency therefore blocks the check
// on three reachable ones.
//
// This script proves the reachable links, and nothing else:
//   1. every demo employment id this repo hard-codes is STILL ALIVE
//      (CLAUDE.md §6: `fde4007b-…` is dead; a dead id 404s in a way that reads
//      like a credential, host or permission problem and is none of them —
//      so this check runs FIRST and names the failure correctly)
//   2. `handleVerificationTicket()` end to end against a live Sandbox record,
//      with a REAL OpenAI classification (no injected fake), and
//   3. the rendered letter contains ZERO salary, asserted against the actual
//      compensation figures the live record carries — not against a fixture, and
//   4. the n8n "Identity + Policy Gates" Code node body — the SOURCE in this
//      repo, run in a vm against the LIVE Remote payload and the LIVE Zendesk
//      requester email. That is the half of the chain n8n runs, and it is the
//      half most exposed to a reseed: its identity gate compares the ticket
//      requester's address to the address on the Remote record, and the reseed
//      changed the whole account's email domain.
//
// It writes NOTHING: no Supabase (`pgPool` omitted → the stores stay
// in-memory), no Zendesk (`zendesk` omitted → the workflow never calls one),
// no Remote writes (UC-01 has no write path). It costs one small OpenAI call
// per employment tested.
//
// It does NOT — and cannot — verify the n8n half of the chain (Zendesk trigger
// → webhook → n8n graph → Supabase audit row). See docs/LIVE-PATH-STATUS.md
// for exactly which links are proven and which are not.
//
// Usage:  NODE_USE_ENV_PROXY=1 node scripts/verify-live-uc01.mjs
//   (NODE_USE_ENV_PROXY=1 is required in this container — Node's global fetch
//    ignores HTTPS_PROXY, and direct egress is refused; CLAUDE.md §6.)
// ---------------------------------------------------------------------------

import "dotenv/config";   // credentials live in .env; without this these checks
                          // exit 2 on a machine that HAS them, and an exit 2 is
                          // indistinguishable from genuinely being unable to reach
                          // the service — the confusion they exist to prevent
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { config } from "../src/shared/config.js";
import { RemoteClient } from "../src/remote/restClient.js";
import { AuditLogger } from "../src/shared/audit.js";
import { CaseStore } from "../src/shared/caseStore.js";
import { handleVerificationTicket } from "../src/uc01/workflow.js";
import { KNOWN_EMPLOYEES } from "../src/livedemo/employees.js";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");

const missing = [];
if (!config.remote.token) missing.push("REMOTE_API_TOKEN");
if (!config.openai.apiKey) missing.push("OPENAI_API_KEY");
if (missing.length > 0) {
  console.error(`Missing required env vars: ${missing.join(", ")}`);
  process.exit(1);
}
if (!/remote-sandbox|localhost/.test(config.remote.baseUrl)) {
  console.error(`Refusing to run against a non-Sandbox host: ${config.remote.baseUrl}`);
  process.exit(1);
}

const remote = new RemoteClient({ baseUrl: config.remote.baseUrl, token: config.remote.token });
let ok = true;
const fail = (m) => {
  console.error(`   FAIL — ${m}`);
  ok = false;
};

// --- 1. Are the hard-coded demo ids still alive? --------------------------
// Do this before anything else. A dead id produces a 404 that looks like a
// credential/host/permission failure, and debugging it as one costs hours.
console.log(`=== [1/4] Demo employment ids still alive? (${config.remote.baseUrl}) ===`);
const alive = [];
for (const e of KNOWN_EMPLOYEES) {
  try {
    const employment = await remote.getEmployment(e.id);
    if (!employment) {
      fail(`${e.id} (${e.name}) — NOT FOUND. The Sandbox may have been reseeded again; re-list /v1/employments and refresh src/livedemo/employees.js.`);
      continue;
    }
    const emailOnRecord = employment.email ?? null;
    console.log(`   ok — ${e.id} · ${employment.full_name} · ${employment.status} · ${employment.contract_type} · ${employment.country_code}`);
    if (emailOnRecord && emailOnRecord !== e.email) {
      fail(`${e.id} email drifted: file says ${e.email}, record says ${emailOnRecord}. Identity fails closed on a mismatch.`);
    }
    if (employment.status !== "active") {
      fail(`${e.id} is '${employment.status}', not 'active' — the status gate will refuse it.`);
    }
    alive.push({ ...e, employment });
  } catch (err) {
    fail(`${e.id} (${e.name}) — ${err.message}`);
  }
}

// --- 2. The real workflow, real OpenAI, real Sandbox ----------------------
// TWO scenarios per employee, on purpose. A fail-closed system that refuses
// everything and a system that works are indistinguishable from the refusals
// alone (CLAUDE.md §5's methodological lesson) — so the standard request is a
// POSITIVE test: it MUST reach auto_resolve and MUST render a letter, or the
// live path is dead however green the refusals look.
const SCENARIOS = [
  {
    name: "standard request",
    text: "Hi, could you please send me a standard employment verification letter for my landlord? Thank you.",
    expect: { decision: "auto_resolve", letter: true },
  },
  {
    name: "salary asked (over-scope)",
    text: "Please send an employment verification letter that also states my annual salary.",
    expect: { decision: "human_review", letter: false },
  },
];

console.log(`\n=== [2/4] handleVerificationTicket() — real OpenAI + real Sandbox, no writes ===`);
const results = [];
for (const e of alive) {
  for (const scenario of SCENARIOS) {
    // No pgPool and no zendesk: the stores stay in memory and nothing is posted.
    const audit = new AuditLogger();
    const caseStore = new CaseStore();
    try {
      const result = await handleVerificationTicket(
        {
          text: scenario.text,
          // Identity comes from an authenticated signal, never a claim.
          session: { authenticatedEmploymentId: e.id },
          employmentId: e.id,
          source: "zendesk",
          externalRef: `live-readonly-check-${Date.now()}`,
        },
        { remote, audit, caseStore }
      );
      const entry = audit.forUseCase("UC-01")[0];
      const identity = entry?.details?.identity;
      console.log(
        `   ${e.employment.full_name} / ${scenario.name}: decision=${result.decision} reason=${result.reason} ` +
          `flags=[${result.flags.join(", ") || "none"}] ` +
          `classification.source=${entry?.details?.classification?.source ?? "?"} ` +
          `identity.verified=${identity?.verified} (${identity?.reason ?? "?"}) ` +
          `letter=${result.letterHtml ? `${result.letterHtml.length} chars` : "none"}`
      );
      if (result.decision !== scenario.expect.decision) {
        fail(`${e.employment.full_name} / ${scenario.name}: expected ${scenario.expect.decision}, got ${result.decision} (${result.reason})`);
      }
      if (scenario.expect.letter && !result.letterHtml) {
        fail(`${e.employment.full_name} / ${scenario.name}: expected a rendered letter, got none — the auto-resolve path is DEAD.`);
      }
      if (!scenario.expect.letter && result.letterHtml) {
        fail(`${e.employment.full_name} / ${scenario.name}: a letter was rendered on a non-auto_resolve decision.`);
      }
      results.push({ e, scenario, result });
    } catch (err) {
      fail(`${e.employment.full_name} / ${scenario.name}: workflow threw — ${err.message}`);
    }
  }
}

// --- 3. The letter must disclose no salary, ever --------------------------
// Asserted against the figures the LIVE record actually carries, so this can
// never pass by the fixture happening to have no salary in it.
console.log(`\n=== [3/4] Rendered letter contains zero salary ===`);
let checked = 0;
for (const { e, result } of results) {
  if (!result.letterHtml) continue;
  checked += 1;
  // normalizeEmployment() carries `contract_details` / `basic_information`
  // through as the blocks Remote sends, so the live figures are right here.
  const figures = new Set();
  const collect = (o) => {
    if (!o || typeof o !== "object") return;
    for (const [k, v] of Object.entries(o)) {
      if (v && typeof v === "object") collect(v);
      else if (/salar|compens|gross|rate|amount/i.test(k) && (typeof v === "number" || typeof v === "string")) {
        const str = String(v);
        if (/^\d{3,}$/.test(str)) figures.add(str);
      }
    }
  };
  collect(e.employment);
  const leaked = [...figures].filter((f) => result.letterHtml.includes(f));
  const words = ["salary", "compensation", "gross", "annual pay"].filter((w) =>
    result.letterHtml.toLowerCase().includes(w)
  );
  if (leaked.length > 0) fail(`${e.employment.full_name}: letter leaked compensation figure(s) ${leaked.join(", ")}`);
  if (words.length > 0) fail(`${e.employment.full_name}: letter mentions ${words.join(", ")}`);
  if (leaked.length === 0 && words.length === 0) {
    console.log(
      `   ok — ${e.employment.full_name}: no salary word, and none of the ${figures.size} compensation figure(s) ` +
        `the live record carries (${[...figures].join(", ") || "none"}) appear in the letter`
    );
  }
}
if (checked === 0) fail("No letter was rendered by any scenario — the auto-resolve path never succeeded.");

// --- 4. The n8n gates node, against the live payload ----------------------
// IMPORTANT SCOPE LIMIT: this runs the body in THIS REPO, not the body n8n is
// actually serving. The n8n MCP connector is not authorised here, so the
// deployed graph cannot be read or driven. What this does prove is that the
// n8n-side logic still handles the reseeded record shape and the current email
// domain — which is the failure the reseed could plausibly have caused. It
// does NOT prove the deployed graph matches this file.
console.log(`\n=== [4/4] n8n "Identity + Policy Gates" body (repo source) vs live payload ===`);
const gatesSource = readFileSync(join(REPO, "workflows", "nodes", "gates.js"), "utf8");

function runGatesNode({ ctx, employmentResponse, consentRows = [] }) {
  const sandbox = {
    $: (nodeName) => {
      if (nodeName === "Validate Classification") return { first: () => ({ json: ctx }) };
      // rca-wn30: the live graph now runs
      // Fetch Employment (Remote) -> Lookup Consent Records -> Identity + Policy
      // Gates, so gates.js reads the employment BY NAME (the lookup owns
      // `$input`) and reads the consent rows off the lookup. This sandbox has
      // to answer per name for the same reason: gates.js falls back to
      // `$input`, so a name-blind or throwing mock would quietly verify the
      // FALLBACK path while claiming to check what production runs.
      if (nodeName === "Fetch Employment (Remote)") return { first: () => ({ json: employmentResponse }) };
      if (nodeName === "Lookup Consent Records") return { all: () => consentRows.map((json) => ({ json })) };
      throw new Error(`Unexpected $() lookup for "${nodeName}"`);
    },
    $input: { first: () => ({ json: employmentResponse }) },
  };
  // vm results are cross-realm — JSON round-trip, which is also what n8n does
  // between nodes (CLAUDE.md §6).
  // The node returns n8n's item array: [{ json: … }].
  const out = vm.runInNewContext(`(function () {\n${gatesSource}\n})()`, sandbox, { timeout: 5000 });
  return JSON.parse(JSON.stringify(out))[0].json;
}

for (const e of alive) {
  // The raw payload, exactly as the n8n HTTP node receives it from Remote.
  const res = await fetch(`${config.remote.baseUrl}/v1/employments/${e.id}`, {
    headers: { Authorization: `Bearer ${config.remote.token}` },
  });
  const employmentResponse = await res.json();
  const emailOnRecord = employmentResponse?.data?.employment?.basic_information?.email ?? null;

  for (const [label, authenticatedEmail, expectVerified] of [
    ["requester email matches the record", emailOnRecord, true],
    ["requester email is the pre-reseed address", String(emailOnRecord).replace(/@.*/, "@howe-dickens-and-conn-dq6kjb.example.com"), false],
  ]) {
    const out = runGatesNode({
      ctx: {
        employmentId: e.id,
        session: authenticatedEmail ? { authenticatedEmail: String(authenticatedEmail).toLowerCase() } : null,
        // The shape the "Validate Classification" node emits for a plain
        // standard-letter request (see workflows/nodes/validateClassification.js).
        classification: {
          intent: "standard_letter",
          requesterType: "self",
          requestedFields: ["full_name", "start_date", "contract_type", "status"],
          confidence: 0.95,
          hasAttachment: false,
          hasExternalUrl: false,
          source: "llm",
        },
      },
      employmentResponse,
    });
    const verified = out.identity?.verified === true;
    console.log(`   ${e.employment.full_name} / ${label}: decision=${out.decision} reason=${out.reason} identity=${out.identity?.verified} (${out.identity?.reason}) flags=[${(out.flags || []).join(", ") || "none"}]`);
    if (expectVerified && out.decision !== "auto_resolve") {
      fail(`${e.employment.full_name}: the n8n gates did NOT auto-resolve a clean standard request against the live record — got ${out.decision} (${out.reason}).`);
    }
    if (verified !== expectVerified) {
      fail(
        expectVerified
          ? `${e.employment.full_name}: the n8n identity gate REFUSED a requester whose address matches the live record — a real Zendesk ticket would escalate instead of auto-resolving.`
          : `${e.employment.full_name}: the n8n identity gate ACCEPTED a stale pre-reseed address — it is not comparing what it claims to.`
      );
    }
  }
}

console.log(`\n${ok ? "ALL CHECKS PASSED" : "CHECKS FAILED"}`);
process.exit(ok ? 0 : 1);
