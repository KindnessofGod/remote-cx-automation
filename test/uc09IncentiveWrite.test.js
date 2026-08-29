// ---------------------------------------------------------------------------
// uc09IncentiveWrite.test.js — UC-09's money write, against the corrected mock
// ---------------------------------------------------------------------------
// WHY THIS FILE EXISTS, AND WHY IT IS SEPARATE FROM uc09.test.js
//
// Every other UC-09 test drives `fakeRemote`, a stub whose `createIncentive`
// accepts whatever it is handed and echoes it back. That is the right double
// for testing gates, and it is exactly the double under which this defect
// lived for the whole life of the project:
//
//   * `createIncentive()` POSTed `/v1/recurring-incentives`, a path Remote has
//     never served (404, confirmed live 2026-08-19);
//   * the payload carried `currency`, `description`, `processing_date` and
//     `tax_calculation_method: "automatic"` — the first three are not
//     properties of Remote's incentive resource at all, and the fourth stood
//     where the REQUIRED `amount_tax_type` (`gross`|`net`) belongs;
//   * and `INCENTIVE_REQUIRED_FIELDS`, the gate meant to catch that, REQUIRED
//     `currency` and OMITTED `amount_tax_type` — so it green-lit a payload
//     Remote would have rejected.
//
// Every test passed throughout, because `src/remote/mockServer.js` had been
// written to agree with the code rather than with the API: it served the
// invented path and accepted the invented fields. A fixture that agrees with
// the code cannot ever disagree with it, which is the same failure this
// repository has now paid for in UC-03, UC-04 and UC-06.
//
// So these tests go over a real socket, through the real `RemoteClient`, into
// the real mock — and they assert in BOTH directions:
//   POSITIVE: a fully-approved adjustment MUST reach the write and come back
//             with a real incentive record. A suite of refusals proves
//             nothing: a use case that structurally cannot succeed and one
//             being appropriately cautious look identical from outside.
//   NEGATIVE: the OLD payload must now be REJECTED. If it still passes, the
//             mock has not been fixed and the positive test above is measuring
//             a fixture, not an API.
// ---------------------------------------------------------------------------

import { test } from "node:test";
import assert from "node:assert/strict";
import { startMockServer } from "../src/remote/mockServer.js";
import { RemoteClient } from "../src/remote/restClient.js";
import { AdjustmentStore } from "../src/uc09/adjustmentStore.js";
import { handleAdjustmentRequest, submitAdjustmentApproval } from "../src/uc09/workflow.js";
import {
  INCENTIVE_REQUIRED_FIELDS,
  AMOUNT_TAX_TYPES,
  INCENTIVE_TYPES,
  prepareIncentivePayload,
} from "../src/uc09/policyEngine.js";
import { judgeNarrative } from "../src/shared/narrativeJudge.js";

// Port 0: the OS picks a free one. A fixed port fails the whole file with
// EADDRINUSE the moment anything else on the machine holds it, and a red suite
// that says nothing about the code trains you to skim failures
// (test/remoteShapeFidelity.test.js records the time that really happened).
async function withMock(fn) {
  const server = await startMockServer(0);
  try {
    return await fn(`http://localhost:${server.address().port}`);
  } finally {
    server.close();
  }
}

/** Raw POST, so a payload can be sent that our own builder would refuse to build. */
async function postIncentive(baseUrl, body, path = "/v1/incentives") {
  const res = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  let parsed = null;
  try {
    parsed = await res.json();
  } catch {
    parsed = null;
  }
  return { status: res.status, body: parsed };
}

// The LLM seams, forced into their unconfigured branches. This file uses
// structured input only (no free-text parse), but `handleAdjustmentRequest()`
// calls the faithfulness judge on every run — un-injected it makes a real,
// slow, doomed OpenAI call (CLAUDE.md §6).
const fakeJudge = (args) => judgeNarrative(args, { isConfigured: () => false });
const silentAudit = { log: () => {}, logDurable: () => {}, logTraceStep: () => {} };

const SESSION = { companyId: "co_amend_01", authenticatedAdminId: "admin_1" };
const EMPLOYMENT_ID = "emp_active_001"; // active, company co_amend_01, in the mock

/**
 * Drive one adjustment from request to execution against the real mock over
 * HTTP: request -> requester approval -> approver approval -> the write.
 * Nothing here is faked except the LLM judge and the audit sink.
 */
async function runToExecution(baseUrl, adjustmentRequest, { externalRef }) {
  const remote = new RemoteClient({ baseUrl });
  const adjustmentStore = new AdjustmentStore();
  const deps = { remote, audit: silentAudit, adjustmentStore, judge: fakeJudge };

  const created = await handleAdjustmentRequest(
    { employmentId: EMPLOYMENT_ID, session: SESSION, adjustmentRequest, externalRef, now: "2026-06-20" },
    deps
  );

  const first = await submitAdjustmentApproval(
    { adjustmentId: created.adjustmentId, role: "requester", approver: "ada@acme.test", action: "approve" },
    deps
  );
  const second = await submitAdjustmentApproval(
    { adjustmentId: created.adjustmentId, role: "approver", approver: "bob@acme.test", action: "approve" },
    deps
  );

  return { created, first, second, row: adjustmentStore.list()[0], adjustmentStore };
}

// ---------------------------------------------------------------------------
// POSITIVE — the one that had never been written
// ---------------------------------------------------------------------------

test("POSITIVE: a fully-approved adjustment reaches POST /v1/incentives on the real mock and comes back a real incentive", async () => {
  await withMock(async (baseUrl) => {
    const { created, second, row } = await runToExecution(
      baseUrl,
      {
        type: "bonus",
        amount: 500_000, // $5,000.00 in Remote's ×100 integer form
        currency: "USD",
        amountTaxType: "gross",
        description: "Q2 performance bonus",
        effectiveDate: "2026-07-01",
      },
      { externalRef: "uc09-write-positive-1" }
    );

    assert.equal(created.decision, "dual_approval_required");
    assert.equal(created.approvalSlotsRequired, 2, "the floor of two is unchanged");

    // THE WRITE ACTUALLY HAPPENED. Before this fix the same call 404'd against
    // a path that does not exist, and no test anywhere would have noticed.
    assert.equal(second.code, "executed", second.reason);
    assert.equal(row.status, "executed");

    const result = row.remoteResult;
    assert.ok(result, "the row carries what Remote returned, not a success flag we made up");
    assert.match(result.id, /^inc_/, "a real incentive id came back from the resource");
    // "When the incentive is created and it is not yet associated to a payroll
    // cycle, its status is `pending`." Creating an incentive is not paying it —
    // our `executed` means "we filed it", never "the money moved".
    assert.equal(result.status, "pending");
    assert.equal(result.employment_id, EMPLOYMENT_ID);
    assert.equal(result.amount, 500_000);
    assert.equal(result.amount_tax_type, "gross");
    assert.equal(result.note, "Q2 performance bonus");
    assert.equal(result.recurring_incentive_id, null, "one-time, not a monthly standing payment");
  });
});

test("POSITIVE: the payload put on the wire is Remote's shape exactly — no invented keys, no missing required one", async () => {
  await withMock(async (baseUrl) => {
    const { row } = await runToExecution(
      baseUrl,
      {
        type: "bonus",
        amount: 500_000,
        currency: "USD",
        amountTaxType: "gross",
        description: "Q2 performance bonus",
        effectiveDate: "2026-07-01",
        processingDate: "2026-07-15", // ours; must NOT reach Remote
      },
      { externalRef: "uc09-write-positive-2" }
    );

    const sent = row.payload;
    assert.deepEqual(
      Object.keys(sent).sort(),
      ["amount", "amount_tax_type", "effective_date", "employment_id", "note", "type"],
      "these six keys and no others"
    );
    // The four fields that used to be here. Each one is named individually so a
    // failure says WHICH resurrected, not merely that the key set changed.
    assert.equal(sent.currency, undefined, "Remote pays in the employment's currency; it has no `currency` field");
    assert.equal(sent.description, undefined, "the real field is `note`");
    assert.equal(sent.processing_date, undefined, "not a property of the incentive resource");
    assert.equal(sent.tax_calculation_method, undefined, "replaced by the REQUIRED amount_tax_type");
    // And every field Remote requires is present.
    for (const field of INCENTIVE_REQUIRED_FIELDS) {
      assert.ok(sent[field] !== undefined && sent[field] !== null && sent[field] !== "", `required field ${field} is present`);
    }
  });
});

// ---------------------------------------------------------------------------
// NEGATIVE — the mock now refuses what Remote refuses
// ---------------------------------------------------------------------------

test("NEGATIVE: the OLD payload is REJECTED by the mock — if this passes, the mock was not fixed", async () => {
  await withMock(async (baseUrl) => {
    // Byte for byte what prepareIncentivePayload() produced before this pass.
    const oldPayload = {
      employment_id: EMPLOYMENT_ID,
      type: "bonus",
      amount: 500_000,
      currency: "USD",
      description: "Off-cycle bonus",
      effective_date: "2026-07-01",
      processing_date: null,
      tax_calculation_method: "automatic",
    };

    const res = await postIncentive(baseUrl, oldPayload);
    assert.equal(res.status, 422, "the payload this repo shipped for months is not a valid incentive");
    // The message names every invented field, so the failure is diagnosable
    // rather than merely red.
    for (const dead of ["currency", "description", "processing_date", "tax_calculation_method"]) {
      assert.match(res.body.message, new RegExp(dead), `the refusal names ${dead}`);
    }
  });
});

test("NEGATIVE: /v1/recurring-incentives 404s, exactly as the live Sandbox does", async () => {
  await withMock(async (baseUrl) => {
    // The path `createIncentive()` used to POST. Confirmed live 2026-08-19:
    // GET /v1/recurring-incentives -> 404 "Not Found"; GET /v1/incentives -> 200.
    const res = await postIncentive(baseUrl, { employment_id: EMPLOYMENT_ID }, "/v1/recurring-incentives");
    assert.equal(res.status, 404);
    assert.equal(res.body, "Not Found");
  });
});

test("NEGATIVE: the mock refuses a missing amount_tax_type, a bad tax enum member, and a bad type enum member", async () => {
  await withMock(async (baseUrl) => {
    const valid = {
      employment_id: EMPLOYMENT_ID,
      type: "bonus",
      amount: 500_000,
      amount_tax_type: "gross",
      effective_date: "2026-07-01",
    };

    const missing = { ...valid };
    delete missing.amount_tax_type;
    const missingRes = await postIncentive(baseUrl, missing);
    assert.equal(missingRes.status, 422);
    assert.match(missingRes.body.message, /amount_tax_type/);

    // "automatic" — the value we used to send under the other name. It is not
    // a member of AmountTaxType and never was.
    const badEnum = await postIncentive(baseUrl, { ...valid, amount_tax_type: "automatic" });
    assert.equal(badEnum.status, 422);
    assert.match(badEnum.body.message, /gross, net/);

    // `relocation_topup` — the name this repo's own parser used to emit. It is
    // not a member of CreateOneTimeIncentiveParams.type; Remote's name is
    // `relocation_allowance`.
    const badType = await postIncentive(baseUrl, { ...valid, type: "relocation_topup" });
    assert.equal(badType.status, 422);
    assert.match(badType.body.message, /supported incentive type/);

    // A float amount: "the Remote API only accepts currencies and their
    // fractional amounts as integers."
    const badAmount = await postIncentive(baseUrl, { ...valid, amount: 5000.25 });
    assert.equal(badAmount.status, 422);

    // And the control: the same body with nothing wrong is accepted, so the
    // four refusals above are about the defects and not about the route being
    // dead. Remote answers 201 on create.
    const ok = await postIncentive(baseUrl, valid);
    assert.equal(ok.status, 201);
    assert.equal(ok.body.data.incentive.status, "pending");
  });
});

// ---------------------------------------------------------------------------
// MONEY — gross vs net is not a naming question
// ---------------------------------------------------------------------------

test("MONEY: gross and net are carried verbatim and pay DIFFERENT sums for the same integer", async () => {
  await withMock(async (baseUrl) => {
    // Remote, on `amount_tax_type`:
    //   "`gross` indicates that the amount given is the amount to be paid
    //    before taxes are subtracted. `net` indicates that the amount which
    //    will be paid to the employee after taxes. Remote will gross this up to
    //    ensure the taxes are included and employee receives the amount
    //    requested without further reduction."
    //
    // So 500000 sent as `gross` costs the company 5,000.00 and the employee
    // receives less; sent as `net` the employee receives 5,000.00 and the
    // company pays MORE — Remote computes the uplift, we never do. The integer
    // is identical in both cases, which is precisely why sending the wrong word
    // is invisible at every layer that only looks at the number.
    const gross = await runToExecution(
      baseUrl,
      { type: "bonus", amount: 500_000, currency: "USD", amountTaxType: "gross", effectiveDate: "2026-07-01" },
      { externalRef: "uc09-money-gross" }
    );
    const net = await runToExecution(
      baseUrl,
      { type: "bonus", amount: 500_000, currency: "USD", amountTaxType: "net", effectiveDate: "2026-07-01" },
      { externalRef: "uc09-money-net" }
    );

    assert.equal(gross.row.payload.amount, 500_000);
    assert.equal(net.row.payload.amount, 500_000, "the same integer");
    assert.equal(gross.row.payload.amount_tax_type, "gross");
    assert.equal(net.row.payload.amount_tax_type, "net", "and the reading that decides what it costs");
    assert.equal(gross.row.remoteResult.amount_tax_type, "gross", "carried unaltered to Remote");
    assert.equal(net.row.remoteResult.amount_tax_type, "net");
  });
});

test("MONEY: an unstated gross/net stops the request — it is never defaulted", async () => {
  await withMock(async (baseUrl) => {
    const remote = new RemoteClient({ baseUrl });
    const adjustmentStore = new AdjustmentStore();
    const result = await handleAdjustmentRequest(
      {
        employmentId: EMPLOYMENT_ID,
        session: SESSION,
        // Everything else is in order. Only the tax reading is missing — which
        // used to be silently filled with `tax_calculation_method: "automatic"`,
        // a value that is not a reading of the amount at all.
        adjustmentRequest: { type: "bonus", amount: 500_000, currency: "USD", effectiveDate: "2026-07-01" },
        externalRef: "uc09-money-unstated",
        now: "2026-06-20",
      },
      { remote, audit: silentAudit, adjustmentStore, judge: fakeJudge }
    );

    assert.equal(result.decision, "escalate");
    assert.equal(result.reason, "invalid_adjustment_structure");
    assert.ok(result.flags.includes("missing_amount_tax_type"), `flags: ${result.flags.join(", ")}`);
    assert.equal(result.approvalSlotsRequired, 0, "and no signature is collected for something unpayable");

    // The builder refuses too, so a caller reaching it by another route still
    // cannot produce a payload carrying an invented tax reading.
    const built = prepareIncentivePayload(
      { type: "bonus", amount: 500_000, currency: "USD" },
      { id: EMPLOYMENT_ID, status: "active" }
    );
    assert.equal(built, null);
  });
});

test("MONEY: an invalid gross/net is refused rather than coerced to the nearest member", async () => {
  const built = prepareIncentivePayload(
    { type: "bonus", amount: 500_000, amountTaxType: "automatic" },
    { id: EMPLOYMENT_ID, status: "active" }
  );
  assert.equal(built, null, '"automatic" is not gross and is not net; it is not a reading of the amount');
});

// ---------------------------------------------------------------------------
// The schema constants, pinned against Remote's published contract
// ---------------------------------------------------------------------------

test("INCENTIVE_REQUIRED_FIELDS is Remote's own `required` array for CreateOneTimeIncentiveParams", () => {
  // Verbatim, in Remote's own order, from the OpenAPI on
  // developer.remote.com/reference/post_v1_incentives [CONFIRMED 2026-08-19].
  assert.deepEqual(INCENTIVE_REQUIRED_FIELDS, ["type", "amount", "amount_tax_type", "employment_id", "effective_date"]);
  // The two halves of the old defect, stated as assertions so neither can come
  // back quietly: a field Remote does not accept was required, and a field
  // Remote demands was absent.
  assert.ok(!INCENTIVE_REQUIRED_FIELDS.includes("currency"));
  assert.ok(INCENTIVE_REQUIRED_FIELDS.includes("amount_tax_type"));
});

test("AmountTaxType has exactly two members, and INCENTIVE_TYPES is the 21-member one-time enum", () => {
  assert.deepEqual([...AMOUNT_TAX_TYPES], ["gross", "net"]);
  assert.equal(INCENTIVE_TYPES.length, 21);
  assert.ok(INCENTIVE_TYPES.includes("relocation_allowance"));
  assert.ok(INCENTIVE_TYPES.includes("signing_bonus"), "present on the one-time resource, absent from the recurring one");
  // Names this repo invented and used for months.
  assert.ok(!INCENTIVE_TYPES.includes("relocation_topup"));
  assert.ok(!INCENTIVE_TYPES.includes("retroactive_pay"));
});

test("the client posts /v1/incentives and nothing else — the invented path cannot come back", async () => {
  const seen = [];
  const client = new RemoteClient({
    baseUrl: "http://example.invalid",
    fetchImpl: async (url, init) => {
      seen.push({ url, method: init.method });
      return new Response(JSON.stringify({ data: { incentive: { id: "inc_1", status: "pending" } } }), {
        status: 201,
        headers: { "content-type": "application/json" },
      });
    },
  });

  const result = await client.createIncentive({
    type: "bonus",
    amount: 1,
    amount_tax_type: "gross",
    employment_id: EMPLOYMENT_ID,
    effective_date: "2026-07-01",
  });

  assert.equal(seen.length, 1);
  assert.equal(seen[0].url, "http://example.invalid/v1/incentives");
  assert.ok(!seen[0].url.includes("recurring"), "not the recurring resource: an off-cycle adjustment is a single event");
  assert.equal(seen[0].method, "POST");
  // Remote's envelope is `{data: {incentive: {...}}}`; the client unwraps it so
  // callers hold the incentive rather than a wrapper.
  assert.equal(result.id, "inc_1");
  assert.equal(result.status, "pending");
});
