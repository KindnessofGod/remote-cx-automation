// ---------------------------------------------------------------------------
// remotePayrollFailure.test.js  —  "no cycles exist" vs "we could not ask"
// ---------------------------------------------------------------------------
// `listPayrollRuns()` once coerced its own 404 to `{payroll_runs: []}`. That was
// removed; what remained was subtler and is what this file pins. The method
// answers NULL for a 404, THROWS for a 403 or a 5xx, and answers null again for
// a country it cannot name — three completely different facts arriving as two
// values, one of which is an exception that propagates above UC-06's audit
// write and loses the decision entirely.
//
// So the Node path could not report a payroll upstream failure at all: the gate
// that exists for it in policyEngine.js was reachable only from n8n, whose HTTP
// node surfaces the status. `listPayrollRunsResult()` restores the distinction
// using `src/shared/upstreamFailure.js`'s own vocabulary, so the reason ranks in
// the metrics dashboard beside every other upstream failure instead of as a
// UC-06 dialect.
//
// THE OLD METHOD'S CONTRACT IS PINNED HERE TOO, unchanged. It is what
// src/uc06/workflow.js and the n8n parity fixtures are written against, and a
// silent widening is how two callers come to disagree about what a failure
// means.
// ---------------------------------------------------------------------------

import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { RemoteClient } from "../src/remote/restClient.js";
import { UPSTREAM_NOT_FOUND, UPSTREAM_UNREACHABLE } from "../src/shared/upstreamFailure.js";

/** A server that answers every request with one status + body. */
async function withServer(handler, run) {
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, resolve));
  const baseUrl = `http://localhost:${server.address().port}`;
  try {
    await run(baseUrl);
  } finally {
    server.close();
  }
}

const NG_CYCLE = {
  id: "pr_ng_1",
  status: "processing",
  country: { code: "NGA", name: "Nigeria", alpha_2_code: "NG" },
  currency_code: "NGN",
  period_start: "2026-09-01",
  period_end: "2026-09-30",
  cutoff_date: "2026-09-18",
  expected_payout_date: "2026-09-30",
  approval_date: null,
  total_payroll_cost: null,
};

test("POSITIVE — a readable calendar comes back as rows with NO failure attached", async () => {
  // The positive case is asserted first and deliberately: a method whose only
  // tested outcomes are refusals is indistinguishable from one that cannot
  // succeed, which is this repo's most expensive recurring defect.
  await withServer(
    (req, res) => {
      const page = new URL(req.url, "http://x").searchParams.get("page");
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          data: { total_count: 1, current_page: 1, total_pages: 1, payroll_runs: page === "1" ? [NG_CYCLE] : [] },
        })
      );
    },
    async (baseUrl) => {
      const result = await new RemoteClient({ baseUrl }).listPayrollRunsResult({ countryCode: "NG" });
      assert.equal(result.error, null);
      assert.equal(result.payrollRuns.length, 1);
      assert.equal(result.payrollRuns[0].id, "pr_ng_1");
    }
  );
});

test("a 404 is an answer ABOUT THE CALENDAR — kind not_found, status 404", async () => {
  await withServer(
    (_req, res) => {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ message: "Not Found" }));
    },
    async (baseUrl) => {
      const result = await new RemoteClient({ baseUrl }).listPayrollRunsResult({ countryCode: "NG" });
      assert.equal(result.payrollRuns, null);
      assert.equal(result.error.kind, UPSTREAM_NOT_FOUND);
      assert.equal(result.error.status, 404);
      assert.equal(result.error.call, "payroll_runs");
    }
  );
});

test("a 403 is NOT a missing calendar — kind unreachable, and it does not throw", async () => {
  // A throw here propagates through src/uc06/workflow.js ABOVE its audit write,
  // so a refused token loses the amendment decision entirely: no record, no
  // human told. That is finding F-28's shape one use case over.
  await withServer(
    (_req, res) => {
      res.writeHead(403, { "content-type": "application/json" });
      res.end(JSON.stringify({ message: "Forbidden" }));
    },
    async (baseUrl) => {
      const result = await new RemoteClient({ baseUrl, retries: 1 }).listPayrollRunsResult({ countryCode: "NG" });
      assert.equal(result.payrollRuns, null);
      assert.equal(result.error.kind, UPSTREAM_UNREACHABLE);
      assert.equal(result.error.status, 403);
      assert.notEqual(result.error.kind, UPSTREAM_NOT_FOUND, "403 must never be recorded as 'the calendar is not there'");
    }
  );
});

test("a 500 is unreachable too, after the retries are exhausted", async () => {
  await withServer(
    (_req, res) => {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ message: "boom" }));
    },
    async (baseUrl) => {
      const result = await new RemoteClient({ baseUrl, retries: 1, backoff: () => {} }).listPayrollRunsResult({
        countryCode: "NG",
      });
      assert.equal(result.payrollRuns, null);
      assert.equal(result.error.kind, UPSTREAM_UNREACHABLE);
    }
  );
});

test("a country we cannot name is UNREACHABLE, not not_found — nothing was ever asked", async () => {
  // Reporting it as a 404 would be this client asserting an answer on Remote's
  // behalf about a request that was never sent.
  const remote = new RemoteClient({ baseUrl: "http://127.0.0.1:1" }); // never contacted
  for (const bad of [undefined, null, "", "N", "NGA", "  ", 42, {}]) {
    const result = await remote.listPayrollRunsResult({ countryCode: bad });
    assert.equal(result.payrollRuns, null, `countryCode ${JSON.stringify(bad)}`);
    assert.equal(result.error.kind, UPSTREAM_UNREACHABLE, `countryCode ${JSON.stringify(bad)}`);
    assert.equal(result.error.status, null);
    assert.match(result.error.message, /never requested/);
  }
  // The legacy positional company-id call lands on the same path.
  assert.equal((await remote.listPayrollRunsResult("co_amend_01")).error.kind, UPSTREAM_UNREACHABLE);
});

test("an envelope this endpoint does not send is unreachable, never an empty calendar", async () => {
  await withServer(
    (_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ data: { runs: [] } })); // `runs`, not `payroll_runs`
    },
    async (baseUrl) => {
      const result = await new RemoteClient({ baseUrl }).listPayrollRunsResult({ countryCode: "NG" });
      assert.equal(result.payrollRuns, null);
      assert.equal(result.error.kind, UPSTREAM_UNREACHABLE);
    }
  );
});

test("a genuinely empty calendar is rows, not a failure — the distinction the whole method is for", async () => {
  await withServer(
    (_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ data: { total_count: 0, current_page: 1, total_pages: 1, payroll_runs: [] } }));
    },
    async (baseUrl) => {
      const result = await new RemoteClient({ baseUrl }).listPayrollRunsResult({ countryCode: "NG" });
      assert.deepEqual(result.payrollRuns, []);
      assert.equal(result.error, null);
    }
  );
});

test("the legacy listPayrollRuns() contract is UNCHANGED: null on 404, throw on 403", async () => {
  await withServer(
    (_req, res) => {
      res.writeHead(404, { "content-type": "application/json" });
      res.end("{}");
    },
    async (baseUrl) => {
      assert.equal(await new RemoteClient({ baseUrl }).listPayrollRuns({ countryCode: "NG" }), null);
    }
  );
  await withServer(
    (_req, res) => {
      res.writeHead(403, { "content-type": "application/json" });
      res.end("{}");
    },
    async (baseUrl) => {
      const remote = new RemoteClient({ baseUrl, retries: 1 });
      await assert.rejects(() => remote.listPayrollRuns({ countryCode: "NG" }), /payroll-runs.*403/s);
    }
  );
});

test("dedupe is keyed on the row id — the live endpoint really does repeat rows", async () => {
  // Live, a full walk of /v1/payroll-runs returns 34 rows for 17 distinct ids
  // and reports total_count 17. Two copies of one cycle are a transport
  // artifact, not two cycles.
  await withServer(
    (req, res) => {
      const page = new URL(req.url, "http://x").searchParams.get("page");
      const rows =
        page === "1"
          ? [NG_CYCLE, { ...NG_CYCLE, status: "completed" }, { ...NG_CYCLE, id: "pr_ng_2" }]
          : [];
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ data: { total_count: 2, current_page: 1, total_pages: 1, payroll_runs: rows } }));
    },
    async (baseUrl) => {
      const { payrollRuns } = await new RemoteClient({ baseUrl }).listPayrollRunsResult({ countryCode: "NG" });
      assert.deepEqual(
        payrollRuns.map((r) => r.id),
        ["pr_ng_1", "pr_ng_2"],
        "the duplicate id collapses; the distinct id survives"
      );
      assert.equal(payrollRuns[0].status, "processing", "first occurrence wins, so a repeat cannot rewrite a cycle");
    }
  );
});

test("a genuine non-HTTP error still crashes rather than becoming a permanent escalation", async () => {
  // Swallowing everything would turn a defect in this file into a gate that
  // escalates forever and looks appropriately cautious — the failure shape
  // docs/BUILD-LOG.md §3.30 exists about. Only errors the client can ATTRIBUTE
  // are converted: an HTTP status, or a transport failure #doFetch tagged
  // retryable. A body that is not JSON is neither, so it surfaces.
  await withServer(
    (_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end("<html>not json at all</html>");
    },
    async (baseUrl) => {
      await assert.rejects(() => new RemoteClient({ baseUrl }).listPayrollRunsResult({ countryCode: "NG" }));
    }
  );
});

test("a transport failure IS attributable, and is reported as unreachable rather than raised", async () => {
  const remote = new RemoteClient({ baseUrl: "http://example.invalid", retries: 1, backoff: () => {} });
  remote.fetchImpl = () => {
    throw new Error("ECONNREFUSED");
  };
  const result = await remote.listPayrollRunsResult({ countryCode: "NG" });
  assert.equal(result.payrollRuns, null);
  assert.equal(result.error.kind, UPSTREAM_UNREACHABLE);
  assert.equal(result.error.status, null);
});

// ---------------------------------------------------------------------------
// The consumer: UC-06's payroll gate now records WHICH failure it hit
// ---------------------------------------------------------------------------
// The client distinction is only worth having if something reads it. Before
// this, `src/uc06/workflow.js` hard-coded `status: 404, kind: "not_found"` for
// every absent calendar, so a refused token and a downed service were both
// recorded — durably, in `audit_log` — as Remote answering that the calendar is
// not there. A human triages a missing calendar that exists.

test("UC-06 records a 403 on the payroll calendar as UNREACHABLE, not as a missing calendar", async () => {
  const { AuditLogger } = await import("../src/shared/audit.js");
  const { AmendmentStore } = await import("../src/uc06/amendmentStore.js");
  const { handleAmendmentRequest } = await import("../src/uc06/workflow.js");

  const audit = new AuditLogger();
  const amendmentStore = new AmendmentStore();
  const fakeRemote = {
    getEmployment: async () => ({
      status: "active",
      company_id: "co_amend_01",
      job_title: "Senior Engineer",
      weekly_hours: 40,
      base_salary: 5000000,
      currency: "USD",
      country_code: "US",
    }),
    getCountrySchema: async () => ({ required: [] }),
    listPayrollRunsResult: async () => ({
      payrollRuns: null,
      error: {
        call: "payroll_runs",
        status: 403,
        kind: UPSTREAM_UNREACHABLE,
        message: "Remote API /v1/payroll-runs failed: 403",
        // The Error the client carries for listPayrollRuns()'s benefit. It must
        // be stripped before the failure reaches an audit row: an Error
        // serialises to `{}` and would make the failure look empty.
        thrown: new Error("Remote API /v1/payroll-runs failed: 403"),
      },
    }),
  };

  const r = await handleAmendmentRequest(
    {
      employmentId: "emp_active_001",
      session: { authenticatedAdminId: "admin_1", companyId: "co_amend_01" },
      changes: { salary: { oldAmount: 50000, newAmount: 60000, currency: "USD" } },
      requestedEffectiveDate: "2026-09-15",
      now: "2026-08-20",
    },
    {
      remote: fakeRemote,
      audit,
      amendmentStore,
      draftSummary: async () => ({ summary: "salary change", source: "rule_based_fallback" }),
      judge: async () => ({ verdict: "not_evaluated" }),
    }
  );

  assert.equal(r.decision, "escalate", "fail-closed either way — only the recorded reason changes");
  const entry = audit.forUseCase("UC-06").find((e) => e.details?.amendmentId === r.amendmentId);
  const failure = (entry.details.upstreamFailures ?? []).find((f) => f.call === "payroll_runs");
  assert.ok(failure, "the payroll read failure must reach the audit row");
  assert.equal(failure.kind, UPSTREAM_UNREACHABLE);
  assert.equal(failure.status, 403);
  assert.notEqual(failure.status, 404, "a refused token is not an answer about the calendar");
  assert.equal("thrown" in failure, false, "an Error serialises to {} and would make the failure look empty");
});

test("a client that only offers the older method keeps today's recorded reason, unchanged", async () => {
  // Every hand-built fake `remote` in the suite is this shape. Wiring the newer
  // method must not turn each of them into a differently-worded failure for a
  // capability they were never asked to have.
  const { AuditLogger } = await import("../src/shared/audit.js");
  const { AmendmentStore } = await import("../src/uc06/amendmentStore.js");
  const { handleAmendmentRequest } = await import("../src/uc06/workflow.js");

  const audit = new AuditLogger();
  const legacyRemote = {
    getEmployment: async () => ({
      status: "active",
      company_id: "co_amend_01",
      job_title: "Senior Engineer",
      weekly_hours: 40,
      base_salary: 5000000,
      currency: "USD",
      country_code: "US",
    }),
    getCountrySchema: async () => ({ required: [] }),
    listPayrollRuns: async () => null,
  };

  const r = await handleAmendmentRequest(
    {
      employmentId: "emp_active_001",
      session: { authenticatedAdminId: "admin_1", companyId: "co_amend_01" },
      changes: { salary: { oldAmount: 50000, newAmount: 60000, currency: "USD" } },
      requestedEffectiveDate: "2026-09-15",
      now: "2026-08-20",
    },
    {
      remote: legacyRemote,
      audit,
      amendmentStore: new AmendmentStore(),
      draftSummary: async () => ({ summary: "salary change", source: "rule_based_fallback" }),
      judge: async () => ({ verdict: "not_evaluated" }),
    }
  );

  const entry = audit.forUseCase("UC-06").find((e) => e.details?.amendmentId === r.amendmentId);
  const failure = (entry.details.upstreamFailures ?? []).find((f) => f.call === "payroll_runs");
  assert.equal(failure.kind, UPSTREAM_NOT_FOUND);
  assert.equal(failure.status, 404);
});
