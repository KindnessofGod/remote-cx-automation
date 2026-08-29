// ---------------------------------------------------------------------------
// remoteBridgeDeployParity.test.js  —  the stand-in exists twice
// ---------------------------------------------------------------------------
// `src/remotebridge/` is the local server; `deploy/remote-bridge/` is the same
// stand-in as a Vercel function, and it cannot import across the deployment
// root, so its logic modules are BYTE COPIES under `lib/`.
//
// Nothing was holding those copies together. That is the same shape as the n8n
// Code nodes (`test/n8nParity.test.js`) and the same shape as the bug it keeps
// catching: an edit lands in one copy, the suite stays green, and the deployed
// behaviour quietly diverges from the tested behaviour. The divergence is
// invisible precisely because BOTH files individually look correct.
//
// It matters more here than it looks. n8n is what actually calls the deployed
// copy, so a fix made only in `src/` is a fix that production never receives —
// and the honesty rules these modules encode (never overwrite real data, never
// invent money) are exactly the ones you cannot afford to have drift.
// ---------------------------------------------------------------------------

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const PAIRS = [
  ["src/remotebridge/enrichment.js", "deploy/remote-bridge/lib/enrichment.js"],
  ["src/remotebridge/payrollProjection.js", "deploy/remote-bridge/lib/payrollProjection.js"],
];

for (const [source, deployed] of PAIRS) {
  test(`${deployed} is byte-identical to ${source}`, () => {
    const a = readFileSync(new URL(`../${source}`, import.meta.url), "utf8");
    const b = readFileSync(new URL(`../${deployed}`, import.meta.url), "utf8");
    assert.equal(
      b,
      a,
      `${deployed} has drifted from ${source}. The deployed copy is what n8n calls, so this is a production divergence, not a housekeeping nit. Re-copy the file rather than hand-editing either side.`
    );
  });
}

test("the deployed handler actually uses the projection it ships", () => {
  const handler = readFileSync(new URL("../deploy/remote-bridge/api/index.js", import.meta.url), "utf8");
  assert.ok(
    handler.includes("projectPayrollCalendar"),
    "shipping the module without calling it would leave the deployment a pass-through while the tests describe a projecting bridge"
  );
  assert.ok(
    handler.includes('path === "/v1/payroll-runs"'),
    "the projection must be scoped to the payroll route"
  );
  assert.ok(
    handler.includes("realRuns.length > 0"),
    "projections must never be appended to an empty page — RemoteClient.listPayrollRuns() pages until it sees one"
  );
});
