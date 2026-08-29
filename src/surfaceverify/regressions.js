// ---------------------------------------------------------------------------
// regressions.js  —  Falsification: can this runner re-find the three known
// regressions at the commit before each was fixed?
// ---------------------------------------------------------------------------
// "From a clean checkout at the commit BEFORE each fix landed, the runner
// re-finds E3-F12 (e188ce8~1), E4-F14 (d89aae8~1) and E4-F15 (9098f99~1). If
// it cannot re-find all three, it is not worth keeping — say so and stop."
//
// This does NOT check out the old commit into the working tree (that would
// mean re-deploying old, vulnerable code to prove a point). Instead it reads
// the ONE file each fix touched at the OLD ref with `git show <ref>:<path>`,
// drops it as a sibling temp module next to its unchanged dependencies (so
// relative imports still resolve), imports it, and exercises it with the
// EXACT SAME fixture the live fact-loop uses. This is the same technique
// `scripts/verify-live-uc01.mjs` already uses for the n8n gates node (a
// node:vm sandbox over source read off disk) — generalised to "off a git ref"
// for the two files that are real ES modules (server.js, readStore.js), and
// applied as-is (vm) for the one that is a raw n8n Code node body
// (composeInternalNote.js).
// ---------------------------------------------------------------------------

import vm from "node:vm";
import { execFileSync } from "node:child_process";
import { writeFileSync, unlinkSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { randomBytes } from "node:crypto";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** `git show <ref>:<path>` relative to the repo root. Throws if the ref/path don't exist. */
function showAtRef(ref, relPath) {
  return execFileSync("git", ["show", `${ref}:${relPath}`], { cwd: REPO_ROOT, encoding: "utf8" });
}

/**
 * Import a repo file's content AT A GIVEN GIT REF as a live ES module, by
 * dropping it as a sibling of its real (HEAD) location so its relative
 * imports resolve against HEAD's copies of everything it depends on but
 * did not itself change in the commit under test. Cleans up after itself.
 *
 * @param {string} relPath  e.g. "src/review/server.js"
 * @param {string} ref      e.g. "e188ce8~1"
 * @returns {Promise<{module: object, cleanup: () => void}>}
 */
async function importAtRef(relPath, ref) {
  const source = showAtRef(ref, relPath);
  const dir = join(REPO_ROOT, dirname(relPath));
  const base = relPath.split("/").pop().replace(/\.js$/, "");
  const tempPath = join(dir, `.regr-${base}-${randomBytes(4).toString("hex")}.mjs`);
  writeFileSync(tempPath, source);
  const cleanup = () => {
    try {
      unlinkSync(tempPath);
    } catch {
      /* best-effort */
    }
  };
  try {
    const mod = await import(pathToFileURL(tempPath).href);
    return { module: mod, cleanup };
  } catch (err) {
    cleanup();
    throw err;
  }
}

/** Run an n8n Code-node-shaped file (raw script using the `$json` global) at a git ref. */
function runCodeNodeAtRef(relPath, ref, ctx) {
  const source = showAtRef(ref, relPath);
  const sandbox = { $json: ctx };
  const wrapped = `(function () {\n${source}\n})()`;
  const result = vm.runInNewContext(wrapped, sandbox, { timeout: 5000 });
  return JSON.parse(JSON.stringify(result[0].json));
}

const IDENTITY_UNVERIFIED_CASE = {
  id: "regr-case-1",
  useCase: "UC-01",
  externalRef: "9001",
  employmentId: "emp_regr_001",
  decision: "escalate",
  reason: "identity_not_verified",
  flags: ["identity_requester_employment_mismatch"],
  status: "pending_review",
  classification: { intent: "standard_letter", confidence: 0.9 },
};

function storeFor(caseRow) {
  return {
    async findCaseByExternalRef() {
      return caseRow;
    },
    async findReviewEntryByCaseId() {
      return { id: "rq-regr-1", caseId: caseRow.id, status: "pending" };
    },
    async findDocumentsByCaseId() {
      return [];
    },
  };
}

/**
 * E3-F12: does GET /api/review/ticket/:id (src/review/server.js AT `ref`)
 * withhold the subject block on identity_not_verified?
 * @returns {Promise<{withheld: boolean, body: object}>}
 */
export async function checkE3F12AtRef(ref) {
  const { module: mod, cleanup } = await importAtRef("src/review/server.js", ref);
  try {
    const remote = {
      async getEmployment() {
        return {
          id: "emp_regr_001",
          full_name: "Regression Test Subject",
          job_title: "Senior Engineer",
          status: "active",
          contract_type: "eor",
          country_code: "US",
        };
      },
    };
    const handler = mod.createReviewHandler({
      store: storeFor(IDENTITY_UNVERIFIED_CASE),
      caseStore: {},
      audit: { forUseCase: () => [] },
      remote,
    });
    let body;
    const res = {
      statusCode: undefined,
      setHeader() {},
      end(payload) {
        body = payload ? JSON.parse(payload) : null;
      },
    };
    await handler({ method: "GET", url: `/api/review/ticket/${IDENTITY_UNVERIFIED_CASE.externalRef}`, headers: {} }, res);
    return { withheld: body?.employee === undefined, body };
  } finally {
    cleanup();
  }
}

const ESCALATE_ID_UNVERIFIED_CTX = {
  decision: "escalate",
  reason: "identity_not_verified",
  flags: ["identity_requester_employment_mismatch"],
  employment: {
    id: "emp_regr_001",
    full_name: "Regression Test Subject",
    job_title: "Senior Engineer",
    status: "active",
    contract_type: "eor",
    country_code: "US",
  },
  classification: { requesterType: "self", source: "llm" },
  identity: { reason: "identity_not_verified" },
  routingNote: "Assigned to HR Ops (Zendesk group 6168404929823), tagged queue_hr_ops.",
};

/**
 * E4-F14: does the internal-note composer AT `ref` withhold the subject line
 * on identity_not_verified?
 * @returns {{withheld: boolean, note: object}}
 */
export function checkE4F14AtRef(ref) {
  const note = runCodeNodeAtRef("workflows/nodes/composeInternalNote.js", ref, ESCALATE_ID_UNVERIFIED_CTX);
  const text = note.internalNote ?? "";
  return { withheld: !text.includes("Regression Test Subject"), note };
}

/**
 * E4-F15: does listDecisions() (src/auditview/readStore.js AT `ref`) exclude
 * its own since/since_id boundary row on an idle poll?
 * @returns {Promise<{reappeared: boolean}>}
 */
export async function checkE4F15AtRef(ref) {
  const { module: mod, cleanup } = await importAtRef("src/auditview/readStore.js", ref);
  try {
    const at = new Date("2026-08-22T10:25:05.347Z");
    const newest = {
      id: "7be1f147-0000-4000-8000-000000000000",
      at,
      useCase: "UC-01",
      action: "escalate",
      actor: "regr@example.org",
      riskTier: "medium",
      externalRef: "regr-1",
      reason: "identity_not_verified",
    };
    const pool = {
      async query() {
        return { rows: [newest], rowCount: 1 };
      },
    };
    const store = new mod.AuditReadStore({ pgPool: pool });
    const firstPage = await store.listDecisions({ limit: 50 });
    const [seen] = firstPage.decisions;
    const idlePoll = await store.listDecisions({ since: seen.at, sinceId: seen.id, limit: 50 });
    return { reappeared: idlePoll.decisions.length > 0 };
  } finally {
    cleanup();
  }
}

/**
 * Run all three regression checks at BOTH the pre-fix ref and HEAD, and
 * report whether the runner's own logic can tell them apart. This IS the
 * kill switch: rca-tcj says if this cannot re-find all three, stop and say so
 * rather than shipping something that merely agrees with the current tree.
 */
export async function runRegressionSuite() {
  const results = [];

  {
    const before = await checkE3F12AtRef("e188ce8~1");
    const after = await checkE3F12AtRef("HEAD");
    results.push({
      id: "E3-F12",
      refBefore: "e188ce8~1",
      refAfter: "HEAD",
      reFound: before.withheld === false && after.withheld === true,
      before,
      after,
    });
  }

  {
    const before = checkE4F14AtRef("d89aae8~1");
    const after = checkE4F14AtRef("HEAD");
    results.push({
      id: "E4-F14",
      refBefore: "d89aae8~1",
      refAfter: "HEAD",
      reFound: before.withheld === false && after.withheld === true,
      before,
      after,
    });
  }

  {
    const before = await checkE4F15AtRef("9098f99~1");
    const after = await checkE4F15AtRef("HEAD");
    results.push({
      id: "E4-F15",
      refBefore: "9098f99~1",
      refAfter: "HEAD",
      reFound: before.reappeared === true && after.reappeared === false,
      before,
      after,
    });
  }

  return results;
}
