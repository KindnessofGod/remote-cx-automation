// ---------------------------------------------------------------------------
// remoteOffboardingsRead.test.js — rca-bdz: the second Remote read G-1 needs
// ---------------------------------------------------------------------------
// `RemoteClient.listOffboardingsForEmployment()` is what makes an employee
// serving notice visible to G-1 even though the employment record's own
// `status` stays "active" for the whole time an offboarding runs. This file
// pins the SAME "not_found vs unreachable" shape `listPayrollRunsResult()`
// already establishes (test/remotePayrollFailure.test.js is the template):
// an empty list is a real, positive answer; a failed read is a distinct,
// non-throwing failure a caller can fail closed on.
// ---------------------------------------------------------------------------

import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { RemoteClient } from "../src/remote/restClient.js";
import { UPSTREAM_NOT_FOUND, UPSTREAM_UNREACHABLE } from "../src/shared/upstreamFailure.js";

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

test("POSITIVE — a genuinely empty offboardings list is rows ([]), not a failure", async () => {
  // Asserted first and deliberately: matches the live measurement (rca-bdz's
  // mayor note, 2026-08-21) — HTTP 200 with an empty list for a real,
  // currently-active Sandbox employment.
  await withServer(
    (_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ data: { total_count: 0, current_page: 1, total_pages: 0, offboardings: [] } }));
    },
    async (baseUrl) => {
      const result = await new RemoteClient({ baseUrl }).listOffboardingsForEmployment("emp_1");
      assert.deepEqual(result.offboardings, []);
      assert.equal(result.error, null);
    }
  );
});

test("a real offboarding on file comes back as rows", async () => {
  const row = { id: "off_1", type: "resignation", status: "in_review" };
  await withServer(
    (_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ data: { total_count: 1, current_page: 1, total_pages: 1, offboardings: [row] } }));
    },
    async (baseUrl) => {
      const result = await new RemoteClient({ baseUrl }).listOffboardingsForEmployment("emp_1");
      assert.deepEqual(result.offboardings, [row]);
      assert.equal(result.error, null);
    }
  );
});

test("a 404 does not throw — kind not_found, status 404", async () => {
  await withServer(
    (_req, res) => {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ message: "Not Found" }));
    },
    async (baseUrl) => {
      const result = await new RemoteClient({ baseUrl }).listOffboardingsForEmployment("emp_1");
      assert.equal(result.offboardings, null);
      assert.equal(result.error.kind, UPSTREAM_NOT_FOUND);
      assert.equal(result.error.status, 404);
      assert.equal(result.error.call, "offboardings");
    }
  );
});

test("a 403 is NOT a missing offboarding — kind unreachable, and it does not throw", async () => {
  // A throw here would propagate through src/uc01/workflow.js ABOVE its
  // audit write and lose the decision entirely — the same F-28 shape
  // listPayrollRunsResult()'s own header names.
  await withServer(
    (_req, res) => {
      res.writeHead(403, { "content-type": "application/json" });
      res.end(JSON.stringify({ message: "Forbidden" }));
    },
    async (baseUrl) => {
      const result = await new RemoteClient({ baseUrl, retries: 1 }).listOffboardingsForEmployment("emp_1");
      assert.equal(result.offboardings, null);
      assert.equal(result.error.kind, UPSTREAM_UNREACHABLE);
      assert.equal(result.error.status, 403);
    }
  );
});

test("a 500 is unreachable too, after retries are exhausted", async () => {
  await withServer(
    (_req, res) => {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ message: "boom" }));
    },
    async (baseUrl) => {
      const result = await new RemoteClient({ baseUrl, retries: 1, backoff: () => {} }).listOffboardingsForEmployment("emp_1");
      assert.equal(result.offboardings, null);
      assert.equal(result.error.kind, UPSTREAM_UNREACHABLE);
    }
  );
});

test("an envelope this endpoint does not send is unreachable, never an empty list", async () => {
  await withServer(
    (_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ data: { rows: [] } })); // `rows`, not `offboardings`
    },
    async (baseUrl) => {
      const result = await new RemoteClient({ baseUrl }).listOffboardingsForEmployment("emp_1");
      assert.equal(result.offboardings, null);
      assert.equal(result.error.kind, UPSTREAM_UNREACHABLE);
    }
  );
});

test("a genuine non-HTTP error still crashes rather than becoming a permanent escalation", async () => {
  await withServer(
    (_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end("<html>not json at all</html>");
    },
    async (baseUrl) => {
      await assert.rejects(() => new RemoteClient({ baseUrl }).listOffboardingsForEmployment("emp_1"));
    }
  );
});

test("a transport failure is reported as unreachable rather than raised", async () => {
  const remote = new RemoteClient({ baseUrl: "http://example.invalid", retries: 1, backoff: () => {} });
  remote.fetchImpl = () => {
    throw new Error("ECONNREFUSED");
  };
  const result = await remote.listOffboardingsForEmployment("emp_1");
  assert.equal(result.offboardings, null);
  assert.equal(result.error.kind, UPSTREAM_UNREACHABLE);
  assert.equal(result.error.status, null);
});
