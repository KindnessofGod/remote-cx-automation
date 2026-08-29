#!/usr/bin/env node
// ---------------------------------------------------------------------------
// deploy-zaf-app.mjs — publish zaf-app/ to the INSTALLED Zendesk app.
// ---------------------------------------------------------------------------
// GIT PUSH IS NOT THE DEPLOY VERB FOR THE ZAF APP. Every other surface in this
// project ships when the branch ships: Vercel's production alias tracks
// orchestration/gascity-pilot, so a push publishes the APIs, the portal, the
// third-party door and the audit viewer. The sidebar is the exception. It is a
// PACKAGED UPLOAD to Zendesk — manifest.json points at "assets/iframe.html", a
// path inside the bundle, not a URL on our host — so the account keeps serving
// whatever zip was last uploaded, however old, while the repo, the tests and
// every reviewer's reading of the code all agree on the new behaviour.
//
// That gap cost a full evaluation round. rca-il7's N-1/N-4 fix was committed,
// pushed and proven against a real ticket via `zcli apps:server` — which serves
// the app from LOCALHOST into the agent's own browser. It proved the code and
// touched nothing the evaluator loads. The installed app sat at 1.9.0 for two
// days, so the next evaluation would have measured pre-fix code and reported a
// correct fix as not landing.
//
// WHY THIS EXISTS RATHER THAN "run zcli". `zcli apps:update` needs
// ZENDESK_EMAIL + ZENDESK_API_TOKEN or an interactive `zcli login`, and this
// project has neither: the account is behind 2SV and Zendesk is retiring API
// tokens as an auth method (all tokens stop working 2027-04-30). rca-2ns
// therefore concluded no agent could deploy the app at all.
//
// THAT WAS A FALSE BLOCKER, and it is the fourth of its exact shape here. The
// OAuth client_credentials pair already in .env — the one that runs every other
// Zendesk call in this repo — carries the broad `write` scope, and `write`
// covers the apps endpoints. Measured, not assumed:
//
//     POST /api/v2/apps/uploads.json      -> 201 {"id": 3594126}
//     PUT  /api/v2/apps/9990001.json      -> 202 {"job_id": "05cd613b…"}
//     GET  /api/v2/apps/job_statuses/…    -> "completed"
//     GET  /api/v2/apps/owned.json        -> 9990001 v1.10.0
//
// The lesson is the one this repository keeps paying for: a tool that cannot
// authenticate says nothing about whether the ACCOUNT will refuse you. Find a
// caller that can before recording something as impossible.
//
// USAGE
//   node scripts/deploy-zaf-app.mjs            publish, then verify
//   node scripts/deploy-zaf-app.mjs --check    read the installed version only
//
// EXIT CODES
//   0  published and verified (or --check succeeded)
//   1  refused, or published and the verification did NOT confirm it
//   2  could not tell — credentials or network. NEVER read as success.
// ---------------------------------------------------------------------------

import "dotenv/config";   // the repo keeps credentials in .env; without this this
                          // deploy verb fails with a credentials-shaped error on a
                          // machine that HAS them — see verify-deployed-nodes.mjs
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, statSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { openAsBlob } from "node:fs";

import { assessZafDrift } from "./lib/zafDrift.mjs";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const APP_DIR = join(REPO, "zaf-app");
const APP_ID = process.env.ZAF_APP_ID || "9990001";
const checkOnly = process.argv.includes("--check");

/**
 * Newest commit time touching zaf-app/, excluding zaf-app/tmp/ (build output,
 * gitignored — including it would make the check fire on every local
 * `zcli apps:package` run, which is the same bug wearing a different hat).
 * Commit time, not mtime: a git checkout rewrites mtimes and would produce
 * false DRIFTED reports on a tree nobody has touched. Returns null — never a
 * guess — if git has nothing to say, so callers report "could not tell"
 * rather than a false "in sync".
 */
function newestZafAppCommitTime() {
  let out;
  try {
    out = execFileSync(
      "git",
      ["log", "-1", "--format=%cI", "--", "zaf-app", ":(exclude)zaf-app/tmp"],
      { cwd: REPO, encoding: "utf8" },
    ).trim();
  } catch {
    return null;
  }
  return out || null;
}

/** Load .env without a dependency — this script may run before npm install. */
function loadEnv() {
  for (const p of [join(REPO, ".env"), join(process.env.HOME ?? "", ".secrets/remote-cx.env")]) {
    let text;
    try { text = readFileSync(p, "utf8"); } catch { continue; }
    for (const line of text.split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
}

const die = (code, msg) => { process.stderr.write(`${msg}\n`); process.exit(code); };
const say = (msg) => process.stdout.write(`${msg}\n`);

loadEnv();
const SUB = process.env.ZENDESK_SUBDOMAIN;
const ID = process.env.ZENDESK_OAUTH_CLIENT_ID;
const SECRET = process.env.ZENDESK_OAUTH_CLIENT_SECRET;
if (!SUB || !ID || !SECRET) {
  die(2, "COULD NOT TELL: ZENDESK_SUBDOMAIN / OAUTH_CLIENT_ID / OAUTH_CLIENT_SECRET are not all set.\n"
       + "This is exit 2, not a failure of the deploy — nothing was attempted.");
}
const BASE = `https://${SUB}.zendesk.com`;

async function token() {
  const r = await fetch(`${BASE}/oauth/tokens`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    // `read write` is required: the client's Allowed-scopes list is non-empty,
    // so requesting a scope outside it returns invalid_scope and no token,
    // while OMITTING scope returns a token that 403s on every call. Both look
    // like success from the outside. See CLAUDE.md's OAuth-scope gotcha.
    body: JSON.stringify({ grant_type: "client_credentials", client_id: ID, client_secret: SECRET, scope: "read write" }),
  });
  if (!r.ok) die(2, `COULD NOT TELL: token endpoint ${r.status}. Nothing was attempted.`);
  const t = (await r.json()).access_token;
  if (!t) die(2, "COULD NOT TELL: token endpoint returned no access_token.");
  return t;
}

async function installedVersion(tok) {
  const r = await fetch(`${BASE}/api/v2/apps/owned.json`, { headers: { Authorization: `Bearer ${tok}` } });
  if (!r.ok) die(2, `COULD NOT TELL: GET /apps/owned.json ${r.status}.`);
  const app = (await r.json()).apps.find((a) => String(a.id) === String(APP_ID));
  return app ? { version: app.version, updated: app.updated_at, name: app.name } : null;
}

const tok = await token();
const before = await installedVersion(tok);
if (!before) die(1, `REFUSED: app ${APP_ID} is not owned by this account.`);

const manifest = JSON.parse(readFileSync(join(APP_DIR, "manifest.json"), "utf8"));
say(`installed : v${before.version}  (updated ${before.updated})`);
say(`repo      : v${manifest.version}`);

if (checkOnly) {
  const treeNewestCommitAt = newestZafAppCommitTime();
  say(`tree      : newest zaf-app/ commit ${treeNewestCommitAt ?? "(unreadable)"}`);
  const verdict = assessZafDrift({
    manifestVersion: manifest.version,
    installedVersion: before.version,
    installedUpdatedAt: before.updated,
    treeNewestCommitAt,
  });
  if (verdict.status === "unknown") {
    die(2, `COULD NOT TELL: ${verdict.reason}.\n`
         + "This is exit 2, not 'in sync' — a version-string match with an unreadable\n"
         + "content timestamp is exactly the shape rca-xsbt found blind.");
  }
  say(verdict.status === "drifted" ? `DRIFTED — ${verdict.reason}.` : `in sync — ${verdict.reason}.`);
  process.exit(verdict.status === "drifted" ? 1 : 0);
}

if (String(before.version) === String(manifest.version)) {
  die(1, `REFUSED: manifest is still v${manifest.version}, the version already installed.\n`
       + "Bump zaf-app/manifest.json first. Publishing the same version number makes\n"
       + "'is the fix live?' unanswerable from the account, which is the whole defect\n"
       + "this script exists to close.");
}

// zcli packages without credentials even though it prints an auth error while
// doing it — the zip lands regardless. Its output is therefore checked by
// LOOKING FOR THE FILE, never by trusting the exit status.
say("packaging…");
try { rmSync(join(APP_DIR, "tmp"), { recursive: true, force: true }); } catch { /* first run */ }
try { execFileSync("zcli", ["apps:package", APP_DIR], { cwd: REPO, stdio: "pipe", timeout: 180_000 }); }
catch { /* prints an auth error and still writes the zip; verified below */ }

let zip = null;
try {
  const dir = join(APP_DIR, "tmp");
  const z = readdirSync(dir).filter((f) => f.endsWith(".zip"))
    .map((f) => ({ f: join(dir, f), t: statSync(join(dir, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t)[0];
  if (z) zip = z.f;
} catch { /* handled below */ }
if (!zip) die(1, "REFUSED: zcli produced no package. Nothing was uploaded.");
say(`packaged  : ${zip} (${statSync(zip).size} bytes)`);

const form = new FormData();
form.append("uploaded_data", await openAsBlob(zip), "app.zip");
const up = await fetch(`${BASE}/api/v2/apps/uploads.json`, {
  method: "POST", headers: { Authorization: `Bearer ${tok}` }, body: form,
});
if (!up.ok) die(1, `REFUSED: upload ${up.status} ${await up.text()}`);
const uploadId = (await up.json()).id;
say(`uploaded  : upload_id ${uploadId}`);

const pub = await fetch(`${BASE}/api/v2/apps/${APP_ID}.json`, {
  method: "PUT",
  headers: { Authorization: `Bearer ${tok}`, "Content-Type": "application/json" },
  body: JSON.stringify({ upload_id: uploadId }),
});
if (!pub.ok) die(1, `REFUSED: publish ${pub.status} ${await pub.text()}`);
const jobId = (await pub.json()).job_id;
say(`publishing: job ${jobId}`);

// Publishing is ASYNCHRONOUS. A 202 means "accepted", not "live" — returning
// here would be the pinned-n8n-node mistake in a different costume.
let status = null;
for (let i = 0; i < 20; i++) {
  const r = await fetch(`${BASE}/api/v2/apps/job_statuses/${jobId}.json`, { headers: { Authorization: `Bearer ${tok}` } });
  if (r.ok) {
    const j = await r.json();
    status = j.status;
    if (status === "completed") break;
    if (status === "failed") die(1, `REFUSED: publish job failed — ${j.message ?? "no message"}`);
  }
  await new Promise((r2) => setTimeout(r2, 5000));
}
if (status !== "completed") die(2, `COULD NOT TELL: publish job ${jobId} never reported completed.`);

// Read the ACCOUNT back. The job saying "completed" is the account's claim
// about itself; this is the independent check, and it is the only line that
// entitles anyone to say the sidebar changed.
const after = await installedVersion(tok);
if (!after || String(after.version) !== String(manifest.version)) {
  die(1, `PUBLISHED BUT NOT CONFIRMED: account still reports v${after?.version}. Do not record this as deployed.`);
}
say(`\nVERIFIED  : ${after.name} is now v${after.version} (updated ${after.updated})`);
say("Read from GET /api/v2/apps/owned.json, not from the manifest in this tree.");
