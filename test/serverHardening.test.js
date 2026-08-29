// ---------------------------------------------------------------------------
// serverHardening.test.js  —  BA-4 (server hardening)
// ---------------------------------------------------------------------------
// The other ucNNServer.test.js files exercise createUcNNHandler() with a
// request/response double, never a real listening socket, so nothing in the
// suite previously touched startUcNNServer() itself or the shutdown idiom
// duplicated identically across every src/ucNN/cli.js (+ src/review/cli.js).
// This file closes that gap:
//   1. startUc02Server() (representative of all 9 hardened servers — every
//      one got the identical two-line change) carries the bounded
//      requestTimeout/headersTimeout.
//   2. the graceful-shutdown idiom used in every cli.js — server.close(cb)
//      wrapped in a bounded force-close fallback — really does let an
//      in-flight request finish before the socket reports closed, and really
//      does force a stuck connection closed after the grace period instead
//      of hanging the process forever. cli.js's shutdown() isn't exported
//      (by design — see server.js's header on why signal handling lives only
//      in the CLI entry point), so this proves the underlying node:http
//      mechanics it relies on rather than re-importing a script.
// All timeouts below are single-digit-millisecond, not the real 10s grace
// period, so this stays fast.
// ---------------------------------------------------------------------------

import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import net from "node:net";
import { startUc02Server } from "../src/uc02/server.js";
import { ExpenseStore } from "../src/uc02/expenseStore.js";
import { AuditLogger } from "../src/shared/audit.js";
import { RemoteClient } from "../src/remote/restClient.js";
import { readJsonBody } from "../src/shared/httpBody.js";

test("startUc02Server sets the bounded request/headers timeouts (same pattern applied to all 9 hardened servers)", async () => {
  const server = await startUc02Server(
    {
      expenseStore: new ExpenseStore(),
      audit: new AuditLogger(),
      remote: new RemoteClient({ baseUrl: "http://localhost:1" }), // never called — no route hit below
    },
    0 // ephemeral port, avoids clashing with any fixed CLI/test port
  );
  try {
    assert.equal(server.requestTimeout, 30_000);
    assert.equal(server.headersTimeout, 10_000);
  } finally {
    server.close();
  }
});

test("graceful-shutdown idiom (server.close(cb) + bounded force-close, as used identically in every ucNN/cli.js): lets an in-flight request finish before reporting closed", async () => {
  let releaseRequest;
  const inFlight = new Promise((resolve) => (releaseRequest = resolve));
  const server = createServer(async (req, res) => {
    await inFlight; // simulate a slow in-flight request that outlives the SIGTERM
    res.end("ok");
  });
  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();

  const client = net.connect(port, "127.0.0.1");
  await new Promise((resolve) => client.on("connect", resolve));
  client.write("GET / HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n");
  await new Promise((r) => setTimeout(r, 10)); // let the server accept + start handling it

  let closed = false;
  const closePromise = new Promise((resolve) => {
    server.close(() => {
      closed = true;
      resolve();
    });
  });

  // server.close() must stop accepting NEW connections immediately but must
  // not report closed while the one in-flight request is still pending.
  await assert.rejects(
    () => new Promise((_, reject) => net.connect(port, "127.0.0.1").on("error", reject).on("connect", () => reject(new Error("new connection was accepted after close()")))),
    /ECONNREFUSED/
  );
  assert.equal(closed, false, "server.close() callback fired before the in-flight request finished");

  releaseRequest();
  await closePromise;
  assert.equal(closed, true);
  client.destroy();
});

test("graceful-shutdown idiom: a stuck connection is force-closed after the bounded grace period instead of hanging forever", async () => {
  const server = createServer(() => {
    // Deliberately never responds — simulates a connection that would
    // otherwise keep server.close()'s callback from ever firing.
  });
  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();

  const client = net.connect(port, "127.0.0.1");
  await new Promise((resolve) => client.on("connect", resolve));
  client.write("GET / HTTP/1.1\r\nHost: localhost\r\n\r\n");
  await new Promise((r) => setTimeout(r, 10)); // let the server accept the connection

  let closed = false;
  server.close(() => {
    closed = true;
  });

  await new Promise((r) => setTimeout(r, 20));
  assert.equal(closed, false, "sanity check: still open before the forced close — nothing responded yet");

  // The same forced fallback every cli.js's shutdown() calls once its grace
  // timer fires.
  server.closeAllConnections();
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(closed, true, "server.close() callback never fired even after closeAllConnections()");

  client.destroy();
});

// ---------------------------------------------------------------------------
// F-16 (HIGH) — an oversized request body must hang up, not kill the process
// ---------------------------------------------------------------------------
// Every server had its own copy of readJsonBody(), and every copy rejected the
// promise at the 64 KB cap and then KEPT READING: `raw` grew until V8's maximum
// string length threw inside an EventEmitter callback and the process exited.
// One unauthenticated request took down both the review API and the UC-06 API.
// These tests pin the two properties the shared src/shared/httpBody.js now
// guarantees: the buffer stops growing, and the socket is destroyed.
// ---------------------------------------------------------------------------

test("F-16. readJsonBody stops accumulating at the cap and destroys the request stream", async () => {
  const { EventEmitter } = await import("node:events");
  const req = new EventEmitter();
  let destroyed = false;
  let paused = false;
  req.socket = { destroy: () => (destroyed = true) };
  req.pause = () => (paused = true);

  const promise = readJsonBody(req, { limit: 1_000 });

  // Two chunks: the first is under the cap, the second blows it. A third
  // arrives AFTER the refusal — the old code would have appended it.
  req.emit("data", Buffer.alloc(600, "a"));
  req.emit("data", Buffer.alloc(600, "b"));
  req.emit("data", Buffer.alloc(10_000_000, "c"));

  await assert.rejects(promise, (err) => {
    assert.equal(err.code, "body_too_large");
    assert.equal(err.status, 413);
    return true;
  });
  assert.equal(destroyed, true, "the socket was never destroyed — the client can keep sending");
  assert.equal(paused, true, "the stream was never paused");
});

test("F-16. a real server survives a body far larger than the cap, and hangs up on the sender", async () => {
  let handlerError = null;
  const server = createServer(async (req, res) => {
    try {
      const body = await readJsonBody(req, { limit: 4_000 });
      res.end(JSON.stringify(body));
    } catch (err) {
      handlerError = err;
      // The socket is already gone by now; writing is a no-op, and must not
      // throw either.
      try {
        res.statusCode = 413;
        res.end();
      } catch {
        /* expected once the socket is destroyed */
      }
    }
  });
  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();

  const client = net.connect(port, "127.0.0.1");
  await new Promise((resolve) => client.on("connect", resolve));
  client.on("error", () => {}); // ECONNRESET is the expected outcome for the sender

  const megabyte = "x".repeat(1_000_000);
  client.write(
    `POST /api/anything HTTP/1.1\r\nHost: localhost\r\nContent-Type: application/json\r\nContent-Length: 20000000\r\n\r\n`
  );
  for (let i = 0; i < 5; i++) client.write(megabyte);

  // The connection is closed by the server, rather than the process dying.
  await new Promise((resolve) => {
    client.on("close", resolve);
    setTimeout(resolve, 1_000); // safety net so a hang fails the assertion below, not the suite
  });

  assert.ok(handlerError, "the handler never saw the oversized-body refusal");
  assert.equal(handlerError.code, "body_too_large");

  // THE POINT: this process is still alive and the server still answers.
  const ok = await new Promise((resolve, reject) => {
    const probe = net.connect(port, "127.0.0.1");
    probe.on("error", reject);
    probe.on("connect", () => {
      probe.write("POST /api/anything HTTP/1.1\r\nHost: localhost\r\nContent-Length: 2\r\n\r\n{}");
    });
    let seen = "";
    probe.on("data", (chunk) => {
      seen += chunk;
      if (seen.includes("\r\n\r\n")) {
        probe.destroy();
        resolve(seen);
      }
    });
  });
  assert.match(ok, /^HTTP\/1\.1 200/);

  client.destroy();
  server.close();
});

test("F-16. every HTTP surface in the repo uses the shared reader — no private copy survives", async () => {
  const { readdirSync, readFileSync, statSync } = await import("node:fs");
  const { join, dirname } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "src");

  const offenders = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (entry.endsWith(".js") && full !== join(SRC, "shared", "httpBody.js")) {
        const src = readFileSync(full, "utf8");
        // A private definition is the bug; an import of the shared one is fine.
        if (/function readJsonBody\s*\(/.test(src)) offenders.push(full);
      }
    }
  };
  walk(SRC);
  assert.deepEqual(offenders, [], `these files still define their own body reader: ${offenders.join(", ")}`);
});
