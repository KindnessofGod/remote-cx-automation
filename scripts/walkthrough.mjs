#!/usr/bin/env node
// ---------------------------------------------------------------------------
// scripts/walkthrough.mjs  —  `npm run walkthrough`
// ---------------------------------------------------------------------------
// One command that exercises all nine use cases' HTTP APIs end to end,
// against real seeded data, via real HTTP calls (not internal function
// calls) — the same seed each `npm run ucNN-api` prints on boot.
//
// For each use case this script:
//   1. spawns that UC's real CLI (`node src/ucNN/cli.js --seeded --port <p>`)
//      exactly as `npm run ucNN-api` would, forcing the offline/seeded mode
//      so this never needs credentials or reaches a real service;
//   2. polls GET /healthz until the server is actually listening;
//   3. makes real `fetch()` calls against its documented routes — the same
//      routes a human would `curl` (see docs/WALKTHROUGH.md, which mirrors
//      every call this script makes);
//   4. prints a labeled summary: decision, key fields, and — for every
//      🟡/🔴 tier use case that has a real approval surface — walks the
//      actual approve/decline flow, including a refusal, so the HITL gate is
//      demonstrated, not just asserted;
//   5. shuts the server down cleanly (SIGTERM, falling back to SIGKILL) so
//      the next use case's server can bind the same port range without
//      collision, then moves to the next use case in sequence.
//
// This is a demo/walkthrough tool, not a test — it exists to give a
// reviewer one command that proves the nine APIs actually work, end to end,
// over real HTTP. `npm test` covers correctness; this script covers "does
// it run."
//
// Zero credentials required: every UC's cli.js defaults to (or is forced
// into, via --seeded) an in-memory store seeded against either the local
// mock Remote server or no Remote dependency at all (UC-07/UC-08 have none).
// ---------------------------------------------------------------------------

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

const APPROVER = "demo.specialist@example.com";

let totalSteps = 0;
let failedSteps = 0;

// ---------------------------------------------------------------------------
// small helpers
// ---------------------------------------------------------------------------

function heading(text) {
  console.log(`\n${"=".repeat(78)}`);
  console.log(text);
  console.log("=".repeat(78));
}

function sub(text) {
  console.log(`\n--- ${text} ---`);
}

/** One labeled fact about a seeded record, printed and counted. */
function report(label, value) {
  totalSteps++;
  console.log(`   ${label}: ${value}`);
}

function fail(label, detail) {
  totalSteps++;
  failedSteps++;
  console.error(`   ✗ ${label}: ${detail}`);
}

async function waitForHealth(baseUrl, { timeoutMs = 15_000, intervalMs = 150 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastErr;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${baseUrl}/healthz`);
      if (res.ok) return;
    } catch (err) {
      lastErr = err;
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`Server at ${baseUrl} never became healthy (${lastErr?.message ?? "timeout"})`);
}

function stopServer(proc) {
  return new Promise((resolve) => {
    if (proc.exitCode !== null || proc.signalCode !== null) return resolve();
    const hardKill = setTimeout(() => {
      try {
        proc.kill("SIGKILL");
      } catch {
        /* already gone */
      }
    }, 5_000);
    proc.once("exit", () => {
      clearTimeout(hardKill);
      resolve();
    });
    proc.kill("SIGTERM");
  });
}

/**
 * Spawn a UC's cli.js (identical to `npm run ucNN-api`), wait for it to be
 * ready, run `fn(baseUrl)` against the REAL HTTP server, then shut it down
 * cleanly whether `fn` succeeded or threw.
 */
async function withServer({ name, cliPath, port, args = [] }, fn) {
  heading(name);
  const proc = spawn(process.execPath, [cliPath, ...args, "--port", String(port)], {
    cwd: repoRoot,
    stdio: ["ignore", "pipe", "pipe"],
    env: process.env,
  });

  let output = "";
  proc.stdout.on("data", (d) => (output += d));
  proc.stderr.on("data", (d) => (output += d));

  const baseUrl = `http://localhost:${port}`;
  try {
    await waitForHealth(baseUrl);
    console.log(output.trim()); // the CLI's own seed banner — real, not reconstructed
    await fn(baseUrl);
  } catch (err) {
    console.error(`\n   ✗ ${name} did not complete cleanly: ${err.message}`);
    console.error("   --- captured server output ---");
    console.error(output);
    failedSteps++;
  } finally {
    await stopServer(proc);
  }
}

async function getJson(url, opts) {
  const res = await fetch(url, opts);
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

async function postJson(url, payload, headers = {}) {
  return getJson(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(payload),
  });
}

// ---------------------------------------------------------------------------
// UC-01 — Employment Verification (🟡 HITL via the review API / ZAF sidebar)
// ---------------------------------------------------------------------------

async function runUc01(baseUrl) {
  const tickets = ["2001", "2002", "2003", "2004"];
  const views = {};
  for (const id of tickets) {
    const { status, body } = await getJson(`${baseUrl}/api/review/ticket/${id}`);
    views[id] = body;
    if (status === 200 && body?.found) {
      report(
        `ticket ${id}`,
        `decision=${body.case.decision} tier=${body.tier} actionable=${body.actionable} (${body.actionableReason ?? body.case.reason})`
      );
    } else {
      fail(`ticket ${id}`, `unexpected response ${status}`);
    }
  }

  const actionableId = tickets.find((id) => views[id]?.actionable);
  const blockedId = tickets.find((id) => views[id]?.found && !views[id].actionable);

  if (actionableId) {
    sub(`approve flow — ticket ${actionableId} (actionable: human_review)`);
    const approve = await postJson(
      `${baseUrl}/api/review/ticket/${actionableId}/approve`,
      { note: "Verified via walkthrough demo." },
      { "X-ZAF-Approver": APPROVER }
    );
    report("approve result", `status=${approve.status} code=${approve.body?.code} letterIssued=${approve.body?.letterIssued}`);

    sub(`re-decide refusal — ticket ${actionableId} decided twice`);
    const again = await postJson(
      `${baseUrl}/api/review/ticket/${actionableId}/approve`,
      { note: "second attempt" },
      { "X-ZAF-Approver": APPROVER }
    );
    report("second-decision result", `status=${again.status} code=${again.body?.code} (expected: refused, not_awaiting_review)`);
  } else {
    report("approve flow", "skipped — no actionable seeded ticket found this run");
  }

  if (blockedId) {
    sub(`escalation refusal — ticket ${blockedId} has no approve button`);
    const blocked = await postJson(
      `${baseUrl}/api/review/ticket/${blockedId}/approve`,
      { note: "should be refused" },
      { "X-ZAF-Approver": APPROVER }
    );
    report("blocked-approve result", `status=${blocked.status} code=${blocked.body?.code} (expected: 403 no_review_path, or a prior decided state)`);
  }
}

// ---------------------------------------------------------------------------
// UC-02 — Expense & Receipt Validation (🟢 auto-execute, read-only API)
// ---------------------------------------------------------------------------

async function runUc02(baseUrl) {
  const refs = ["ticket-2001", "ticket-2002", "ticket-2003"];
  for (const ref of refs) {
    const { status, body } = await getJson(`${baseUrl}/api/expenses/by-ticket/${ref}`);
    if (status === 200 && body?.found) {
      const e = body.expense;
      report(ref, `decision=${e.decision} category=${e.categoryId} flags=[${(e.flags ?? []).join(", ")}] actionable=${body.actionable}`);
    } else {
      fail(ref, `unexpected response ${status}`);
    }
  }
  report("write surface", "none in this API — auto-approved claims resolve zero-touch; exceptions route to a Finance Ops queue outside this API (actionable: false, by design)");
}

// ---------------------------------------------------------------------------
// UC-03 — Travel Support Letter router (🟢 thin router)
// ---------------------------------------------------------------------------

async function runUc03(baseUrl) {
  const refs = ["9001", "9002", "9003"];
  for (const ref of refs) {
    const { status, body } = await getJson(`${baseUrl}/api/cases/by-ticket/${ref}`);
    if (status === 200 && body?.found) {
      report(`ticket ${ref}`, `decision=${body.caseRow.decision} reason=${body.caseRow.reason}`);
    } else {
      fail(`ticket ${ref}`, `unexpected response ${status}`);
    }
  }
  report("write surface", "none in this API — the formal-letter sign-off is out of scope for this build (see docs/use-cases/UC-03.md)");
}

// ---------------------------------------------------------------------------
// UC-04 — Work Authorization / Workation (🟡 single mobility specialist)
// ---------------------------------------------------------------------------

async function runUc04(baseUrl) {
  const refs = ["4001", "4002", "4003"];
  const views = {};
  for (const ref of refs) {
    const { status, body } = await getJson(`${baseUrl}/api/authorizations/by-ticket/${ref}`);
    views[ref] = body;
    if (status === 200 && body?.found) {
      report(`ticket ${ref}`, `decision=${body.authorization.decision} tier=${body.tier} actionable=${body.actionable} (${body.actionableReason})`);
    } else {
      fail(`ticket ${ref}`, `unexpected response ${status}`);
    }
  }

  const actionable = refs.find((r) => views[r]?.actionable);
  if (actionable) {
    sub(`single-specialist approve — ticket ${actionable}`);
    const id = views[actionable].authorization.id;
    const approve = await postJson(`${baseUrl}/api/authorizations/${id}/approve`, {
      approver: APPROVER,
      note: "Approved via walkthrough demo.",
    });
    report("approve result", `status=${approve.status} code=${approve.body?.code} reason=${approve.body?.reason}`);
  }

  const blocked = refs.find((r) => views[r]?.found && !views[r].actionable);
  if (blocked) {
    sub(`refusal — ticket ${blocked} is not open to approval`);
    const id = views[blocked].authorization.id;
    const denied = await postJson(`${baseUrl}/api/authorizations/${id}/approve`, {
      approver: APPROVER,
      note: "should be refused",
    });
    report("blocked-approve result", `status=${denied.status} code=${denied.body?.code}`);
  }
}

// ---------------------------------------------------------------------------
// UC-05 — Resignation Notice Calculation (🟡 single HR Ops sign-off)
// ---------------------------------------------------------------------------

async function runUc05(baseUrl) {
  const refs = ["5001", "5002", "5003"];
  const views = {};
  for (const ref of refs) {
    const { status, body } = await getJson(`${baseUrl}/api/resignations/by-ticket/${ref}`);
    views[ref] = body;
    if (status === 200 && body?.found) {
      report(`ticket ${ref}`, `decision=${body.resignation.decision} tier=${body.tier} actionable=${body.actionable} (${body.actionableReason})`);
    } else {
      fail(`ticket ${ref}`, `unexpected response ${status}`);
    }
  }

  const actionable = refs.find((r) => views[r]?.actionable);
  if (actionable) {
    sub(`HR Ops sign-off — ticket ${actionable}`);
    const id = views[actionable].resignation.id;
    const signoff = await postJson(`${baseUrl}/api/resignations/${id}/signoff`, {
      approver: APPROVER,
      note: "Signed off via walkthrough demo.",
    });
    report("signoff result", `status=${signoff.status} code=${signoff.body?.code} reason=${signoff.body?.reason}`);
  }

  const blocked = refs.find((r) => views[r]?.found && !views[r].actionable);
  if (blocked) {
    sub(`refusal — ticket ${blocked} is not open to sign-off`);
    const id = views[blocked].resignation.id;
    const denied = await postJson(`${baseUrl}/api/resignations/${id}/signoff`, {
      approver: APPROVER,
      note: "should be refused",
    });
    report("blocked-signoff result", `status=${denied.status} code=${denied.body?.code}`);
  }
  report("write surface", "sign-off only — no Remote write route exists (UC-05.md §3: no confirmed Remote endpoint)");
}

// ---------------------------------------------------------------------------
// UC-06 — Contract Amendment / Payroll Cutoff (🟡 DUAL approval)
// ---------------------------------------------------------------------------

async function runUc06(baseUrl) {
  const refs = ["3001", "3002", "3003"];
  const views = {};
  for (const ref of refs) {
    const { status, body } = await getJson(`${baseUrl}/api/amendments/by-ticket/${ref}`);
    views[ref] = body;
    if (status === 200 && body?.found) {
      report(`ticket ${ref}`, `decision=${body.amendment.decision} tier=${body.tier} actionable=${body.actionable} (${body.actionableReason})`);
    } else {
      fail(`ticket ${ref}`, `unexpected response ${status}`);
    }
  }

  const actionable = refs.find((r) => views[r]?.actionable);
  if (actionable) {
    const id = views[actionable].amendment.id;
    sub(`dual approval, role 1/2 — ticket ${actionable} (customer_admin)`);
    const first = await postJson(`${baseUrl}/api/amendments/${id}/approve`, {
      role: "customer_admin",
      approver: "admin@example.com",
      note: "Customer admin approval via walkthrough demo.",
    });
    report("customer_admin approve result", `status=${first.status} code=${first.body?.code} (expected: approved_awaiting_second)`);

    sub(`dual approval, role 2/2 — ticket ${actionable} (payroll_specialist)`);
    const second = await postJson(`${baseUrl}/api/amendments/${id}/approve`, {
      role: "payroll_specialist",
      approver: "payroll@example.com",
      note: "Payroll specialist approval via walkthrough demo.",
    });
    report(
      "payroll_specialist approve result",
      `status=${second.status} code=${second.body?.code} (expected: executed — both slots filled, real PATCH fired against the mock Remote)`
    );
  }

  const blocked = refs.find((r) => views[r]?.found && !views[r].actionable);
  if (blocked) {
    sub(`refusal — ticket ${blocked} is not open to approval (cutoff already passed)`);
    const id = views[blocked].amendment.id;
    const denied = await postJson(`${baseUrl}/api/amendments/${id}/approve`, {
      role: "customer_admin",
      approver: "admin@example.com",
      note: "should be refused",
    });
    report("blocked-approve result", `status=${denied.status} code=${denied.body?.code}`);
  }
}

// ---------------------------------------------------------------------------
// UC-07 — Global Mobility / Permanent Relocation (🔴 NO execution path)
// ---------------------------------------------------------------------------

async function runUc07(baseUrl) {
  const refs = ["9001", "9002", "9003"];
  for (const ref of refs) {
    const { status, body } = await getJson(`${baseUrl}/api/dossiers/by-ticket/${ref}`);
    if (status === 200 && body?.found) {
      // The stored row has no top-level "decision" field — UC-07's decision
      // is always "escalate" by design (see workflow.js's own return type
      // and server.js's fixed ACTIONABILITY constant), so persisting it
      // redundantly on every row would add nothing. What varies per case is
      // the feasibility verdict inside the dossier itself.
      report(
        `ticket ${ref}`,
        `decision=escalate (always, by design) verdict=${body.dossierRow.dossier?.verdict} relocation=${body.dossierRow.sourceCountry}->${body.dossierRow.destinationCountry} actionable=${body.actionable} (${body.actionableReason})`
      );
    } else {
      fail(`ticket ${ref}`, `unexpected response ${status}`);
    }
  }

  sub("proving no execution path exists");
  const post = await postJson(`${baseUrl}/api/dossiers`, { note: "this must not be possible" });
  report("POST /api/dossiers", `status=${post.status} code=${post.body?.code} (expected: 404 no_such_route — there is no write route at all, not a runtime refusal)`);
}

// ---------------------------------------------------------------------------
// UC-08 — Cross-Border Tax & Social Security (🔴 NO execution path)
// ---------------------------------------------------------------------------

async function runUc08(baseUrl) {
  const refs = ["8001", "8002", "8003"];
  for (const ref of refs) {
    const { status, body } = await getJson(`${baseUrl}/api/dossiers/by-ticket/${ref}`);
    if (status === 200 && body?.found) {
      // Same shape as UC-07: no top-level "decision" on the row — UC-08's
      // decision is always "escalate" by design (server.js's fixed
      // ACTIONABILITY constant). What varies is the inquiry type and the
      // treaty citations the retriever attached.
      const citations = body.dossierRow.dossier?.citations?.length ?? 0;
      report(
        `ticket ${ref}`,
        `decision=escalate (always, by design) inquiryType=${body.dossierRow.inquiryType} citations=${citations} actionable=${body.actionable} (${body.actionableReason})`
      );
    } else {
      fail(`ticket ${ref}`, `unexpected response ${status}`);
    }
  }

  sub("proving no execution path exists");
  const post = await postJson(`${baseUrl}/api/dossiers`, { note: "this must not be possible" });
  report("POST /api/dossiers", `status=${post.status} code=${post.body?.code} (expected: 404 no_such_route — there is no write route at all, not a runtime refusal)`);
}

// ---------------------------------------------------------------------------
// UC-09 — Off-Cycle Payroll / Adjustment (🔴-framed, WITH execution, floor-of-2/3)
// ---------------------------------------------------------------------------

async function runUc09(baseUrl) {
  const refs = ["9001", "9002", "9003"];
  const views = {};
  for (const ref of refs) {
    const { status, body } = await getJson(`${baseUrl}/api/adjustments/by-ticket/${ref}`);
    views[ref] = body;
    if (status === 200 && body?.found) {
      report(
        `ticket ${ref}`,
        `decision=${body.adjustment.decision} approvalSlotsRequired=${body.adjustment.approvalSlotsRequired} actionable=${body.actionable} (${body.actionableReason})`
      );
    } else {
      fail(`ticket ${ref}`, `unexpected response ${status}`);
    }
  }

  // ticket 9001: standard case, needs exactly 2 approvals (requester + approver)
  if (views["9001"]?.actionable) {
    const id = views["9001"].adjustment.id;
    sub("2-of-2 approval flow — ticket 9001 (standard, needs 2 approvals)");
    const r1 = await postJson(`${baseUrl}/api/adjustments/${id}/approve`, { role: "requester", approver: "requester@example.com", note: "1/2" });
    report("requester approve", `status=${r1.status} code=${r1.body?.code}`);
    const r2 = await postJson(`${baseUrl}/api/adjustments/${id}/approve`, { role: "approver", approver: "approver@example.com", note: "2/2" });
    report("approver approve", `status=${r2.status} code=${r2.body?.code} (expected: executed — real incentive write fired against the mock Remote)`);
  }

  // ticket 9002: high-risk case, needs 3 approvals (requester + approver + payment_releaser)
  if (views["9002"]?.actionable) {
    const id = views["9002"].adjustment.id;
    sub("3-of-3 approval flow — ticket 9002 (high-risk, needs 3 approvals)");
    const r1 = await postJson(`${baseUrl}/api/adjustments/${id}/approve`, { role: "requester", approver: "requester@example.com", note: "1/3" });
    report("requester approve", `status=${r1.status} code=${r1.body?.code} (expected: approved_awaiting_second)`);
    const r2 = await postJson(`${baseUrl}/api/adjustments/${id}/approve`, { role: "approver", approver: "approver@example.com", note: "2/3" });
    report("approver approve", `status=${r2.status} code=${r2.body?.code} (expected: still awaiting — the floor-of-2 invariant never drops the third slot for a high-risk case)`);
    const r3 = await postJson(`${baseUrl}/api/adjustments/${id}/approve`, {
      role: "payment_releaser",
      approver: "releaser@example.com",
      note: "3/3",
    });
    report("payment_releaser approve", `status=${r3.status} code=${r3.body?.code} (expected: executed)`);
  }

  // ticket 9003: left read-only in this run — same 3-approval shape as 9002,
  // already demonstrated above; shown here only via its GET summary.
  report("ticket 9003", "left un-actioned in this run — see the GET summary above (same 3-approval shape as 9002)");
}

// ---------------------------------------------------------------------------
// driver
// ---------------------------------------------------------------------------

const USE_CASES = [
  {
    key: "uc01",
    title: "UC-01 — Employment Verification  (🟡 HITL, review-api)",
    cliPath: "src/review/cli.js",
    port: 4020,
    args: ["--seeded"],
    run: runUc01,
  },
  {
    key: "uc02",
    title: "UC-02 — Expense & Receipt Validation  (🟢 auto-execute)",
    cliPath: "src/uc02/cli.js",
    port: 4050,
    args: [],
    run: runUc02,
  },
  {
    key: "uc03",
    title: "UC-03 — Travel Support Letter router  (🟢 thin router)",
    cliPath: "src/uc03/cli.js",
    port: 4051,
    args: ["--seeded"],
    run: runUc03,
  },
  {
    key: "uc04",
    title: "UC-04 — Work Authorization / Workation  (🟡 single specialist)",
    cliPath: "src/uc04/cli.js",
    port: 4052,
    args: ["--seeded"],
    run: runUc04,
  },
  {
    key: "uc05",
    title: "UC-05 — Resignation Notice Calculation  (🟡 single HR Ops sign-off)",
    cliPath: "src/uc05/cli.js",
    port: 4053,
    args: ["--seeded"],
    run: runUc05,
  },
  {
    key: "uc06",
    title: "UC-06 — Contract Amendment / Payroll Cutoff  (🟡 DUAL approval)",
    cliPath: "src/uc06/cli.js",
    port: 4021,
    args: ["--seeded"],
    run: runUc06,
  },
  {
    key: "uc07",
    title: "UC-07 — Global Mobility / Permanent Relocation  (🔴 NO execution path)",
    cliPath: "src/uc07/cli.js",
    port: 4054,
    args: ["--seeded"],
    run: runUc07,
  },
  {
    key: "uc08",
    title: "UC-08 — Cross-Border Tax & Social Security  (🔴 NO execution path)",
    cliPath: "src/uc08/cli.js",
    port: 4023,
    args: ["--seeded"],
    run: runUc08,
  },
  {
    key: "uc09",
    title: "UC-09 — Off-Cycle Payroll / Adjustment  (🔴-framed, WITH execution, floor-of-2/3)",
    cliPath: "src/uc09/cli.js",
    port: 4055,
    args: ["--seeded"],
    run: runUc09,
  },
];

async function main() {
  console.log("Remote CX Automation — full walkthrough (all 9 use cases, real HTTP calls, zero credentials)\n");

  for (const uc of USE_CASES) {
    await withServer(
      { name: uc.title, cliPath: path.join(repoRoot, uc.cliPath), port: uc.port, args: uc.args },
      uc.run
    );
  }

  heading("Summary");
  console.log(`${totalSteps - failedSteps}/${totalSteps} checks completed without an unexpected error.`);
  if (failedSteps > 0) {
    console.log(`${failedSteps} check(s) hit an unexpected response — see output above.`);
    process.exitCode = 1;
  } else {
    console.log("All nine use cases walked end to end over real HTTP against their seeded data.");
  }
}

main().catch((err) => {
  console.error("\nWalkthrough failed to complete:", err);
  process.exitCode = 1;
});
