// ---------------------------------------------------------------------------
// dashboard.test.js  —  The unified dashboard's static assets + server
// ---------------------------------------------------------------------------
// Same two concerns as playground.test.js / zafApp.test.js:
//   1. The browser asset compiles and never uses innerHTML — npm test never
//      imports app.js, so a syntax error would otherwise ship silently, the
//      exact shape of risk BUILD-LOG.md already logged once for zaf-app's
//      main.js and once for the n8n Code node bodies.
//   2. app.js's SOURCES config — the nine ports/paths it fetches — is
//      cross-checked against the REAL default port each src/uc0N/cli.js (and
//      src/review/cli.js) actually listens on, and the real route each
//      corresponding server.js actually exposes, so a typo'd port or path
//      here fails the suite instead of silently showing "unreachable" for
//      every visitor. (A full live round trip against those exact production
//      ports isn't done here — binding node --test to production ports risks
//      colliding with another suite or a developer's already-running
//      `npm run uc0N-api`; that live check is done manually, once, against a
//      real running set of servers — see docs/BUILD-LOG.md for the result.)
//   3. The dashboard's own server is a pure static-asset server with no API
//      routes of its own (see server.js's header comment for why) — proven
//      here both via request/response doubles and one real listening socket.
// ---------------------------------------------------------------------------

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";
import { PORTS } from "../src/shared/ports.js";

import { createDashboardHandler, startDashboardServer } from "../src/dashboard/server.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const ASSETS = join(ROOT, "src", "dashboard", "assets");
const read = (file) => readFileSync(join(ASSETS, file), "utf8");
const readRoot = (...parts) => readFileSync(join(ROOT, ...parts), "utf8");

// ---------------------------------------------------------------------------
// Static assets
// ---------------------------------------------------------------------------

test("index.html loads exactly the assets that exist", () => {
  const html = read("index.html");
  for (const asset of ["style.css", "app.js"]) {
    assert.ok(html.includes(asset), `index.html must load ${asset}`);
    assert.ok(existsSync(join(ASSETS, asset)), `${asset} is loaded but missing`);
  }
});

test("app.js compiles", () => {
  assert.doesNotThrow(
    () => new vm.Script(read("app.js"), { filename: "app.js" }),
    "app.js does not parse — it would ship broken and the suite would stay green"
  );
});

test("app.js never writes dynamic values with innerHTML", () => {
  const source = read("app.js");
  assert.ok(!/\.innerHTML\s*=/.test(source), "app.js assigns innerHTML");
  assert.ok(!/insertAdjacentHTML|document\.write/.test(source), "app.js injects raw markup");
});

test("app.js does not hardcode a decision's color meaning for an unrecognized value", () => {
  const source = read("app.js");
  // A badge is only styled when the decision string is in the named,
  // documented set — everything else must fall back to a plain "generic"
  // badge rather than inventing a color for a string this repo hasn't
  // defined the meaning of.
  assert.ok(source.includes("KNOWN_DECISIONS"), "expected a named allowlist of styled decision strings");
  assert.ok(source.includes('"generic"'), "expected an explicit fallback class for unrecognized decisions");
});

// ---------------------------------------------------------------------------
// SOURCES config cross-checked against the real files it points at
// ---------------------------------------------------------------------------

/** Extracts the `{ id: "uc0N", ... }` object's raw text so per-field regexes stay scoped to one entry. */
function extractSourceBlock(appJs, id) {
  const start = appJs.indexOf(`id: "${id}"`);
  assert.ok(start !== -1, `app.js has no SOURCES entry for ${id}`);
  const nextEntry = appJs.indexOf('{\n      id: "', start + 10);
  const end = nextEntry === -1 ? appJs.indexOf("\n  ];") : nextEntry;
  return appJs.slice(start, end);
}

/**
 * The default port a use case's cli.js actually listens on.
 *
 * Every cli.js now takes that default from the src/shared/ports.js registry
 * rather than an inline literal, so this resolves the registry key it names.
 * The numeric form is still accepted: this test's job is to prove the
 * dashboard and the CLI agree, and it should keep working whichever way a
 * future CLI expresses its default rather than failing on the syntax.
 */
function realDefaultPort(cliSource) {
  const m = cliSource.match(/Number\(argv\[portIndex \+ 1\]\) : (PORTS\.(\w+)|\d+)/);
  assert.ok(m, "could not find the default-port pattern in this cli.js — has the convention changed?");

  if (m[2]) {
    const port = PORTS[m[2]];
    assert.ok(port, `cli.js names PORTS.${m[2]}, which src/shared/ports.js does not define`);
    return port;
  }
  return Number(m[1]);
}

const UC_FILES = {
  uc01: { cli: "src/review/cli.js", server: "src/review/server.js", routeSegments: ["review", "tickets"], key: "tickets" },
  uc02: { cli: "src/uc02/cli.js", server: "src/uc02/server.js", routeSegments: ["expenses"], key: "expenses" },
  uc03: { cli: "src/uc03/cli.js", server: "src/uc03/server.js", routeSegments: ["cases"], key: "cases" },
  uc04: { cli: "src/uc04/cli.js", server: "src/uc04/server.js", routeSegments: ["authorizations"], key: "authorizations" },
  uc05: { cli: "src/uc05/cli.js", server: "src/uc05/server.js", routeSegments: ["resignations"], key: "resignations" },
  uc06: { cli: "src/uc06/cli.js", server: "src/uc06/server.js", routeSegments: ["amendments"], key: "amendments" },
  uc07: { cli: "src/uc07/cli.js", server: "src/uc07/server.js", routeSegments: ["dossiers"], key: "dossiers" },
  uc08: { cli: "src/uc08/cli.js", server: "src/uc08/server.js", routeSegments: ["dossiers"], key: "dossiers" },
  uc09: { cli: "src/uc09/cli.js", server: "src/uc09/server.js", routeSegments: ["adjustments"], key: "adjustments" },
};

test("app.js declares exactly nine sections, one per use case", () => {
  const source = read("app.js");
  for (const id of Object.keys(UC_FILES)) {
    assert.ok(source.includes(`id: "${id}"`), `app.js is missing a SOURCES entry for ${id}`);
  }
  const matches = source.match(/id: "uc0\d"/g) || [];
  assert.equal(matches.length, 9, "expected exactly nine SOURCES entries");
});

for (const [id, spec] of Object.entries(UC_FILES)) {
  test(`app.js's ${id} section points at the real port ${spec.cli} listens on`, () => {
    const appJs = read("app.js");
    const block = extractSourceBlock(appJs, id);
    const portMatch = block.match(/port:\s*(\d+)/);
    assert.ok(portMatch, `${id}'s SOURCES entry has no port`);

    const realPort = realDefaultPort(readRoot(spec.cli));
    assert.equal(
      Number(portMatch[1]),
      realPort,
      `${id}'s dashboard port (${portMatch[1]}) does not match ${spec.cli}'s real default port (${realPort})`
    );
  });

  test(`app.js's ${id} section points at a route + response key ${spec.server} actually serves`, () => {
    const appJs = read("app.js");
    const block = extractSourceBlock(appJs, id);
    const pathMatch = block.match(/path:\s*"([^"]+)"/);
    const keyMatch = block.match(/key:\s*"([^"]+)"/);
    assert.ok(pathMatch && keyMatch, `${id}'s SOURCES entry is missing path/key`);

    const serverSource = readRoot(spec.server);
    for (const segment of spec.routeSegments) {
      assert.ok(
        serverSource.includes(`"${segment}"`),
        `${spec.server} never mentions the "${segment}" route segment app.js's ${id} section expects`
      );
    }
    assert.equal(keyMatch[1], spec.key);
    assert.ok(
      serverSource.includes(`{ ${spec.key}:`),
      `${spec.server} never sends a "${spec.key}" response key app.js's ${id} section expects`
    );
  });
}

// ---------------------------------------------------------------------------
// The dashboard's own server — static assets only, no API routes
// ---------------------------------------------------------------------------

/** Minimal req/res doubles — same idiom as playground.test.js/review.test.js. */
function callApi(handler, { method, path }) {
  return new Promise((resolve, reject) => {
    const req = {
      method,
      url: path,
      headers: {},
      on(event, cb) {
        if (event === "end") setImmediate(cb);
        return req;
      },
    };
    const res = {
      statusCode: 200,
      headers: {},
      setHeader(k, v) {
        this.headers[k.toLowerCase()] = v;
      },
      end(payload) {
        resolve({ status: this.statusCode, headers: this.headers, body: payload });
      },
    };
    try {
      handler(req, res);
    } catch (err) {
      reject(err);
    }
  });
}

test("GET / serves index.html", async () => {
  const handler = createDashboardHandler();
  const res = await callApi(handler, { method: "GET", path: "/" });
  assert.equal(res.status, 200);
  assert.equal(res.headers["content-type"], "text/html; charset=utf-8");
  assert.ok(res.body.toString().includes("Unified Dashboard"));
});

test("GET /app.js and GET /style.css serve with the right content types", async () => {
  const handler = createDashboardHandler();

  const js = await callApi(handler, { method: "GET", path: "/app.js" });
  assert.equal(js.status, 200);
  assert.equal(js.headers["content-type"], "application/javascript; charset=utf-8");

  const css = await callApi(handler, { method: "GET", path: "/style.css" });
  assert.equal(css.status, 200);
  assert.equal(css.headers["content-type"], "text/css; charset=utf-8");
});

test("an unknown route 404s rather than falling through to a wildcard handler", async () => {
  const handler = createDashboardHandler();
  const res = await callApi(handler, { method: "GET", path: "/api/anything" });
  assert.equal(res.status, 404);
  assert.equal(JSON.parse(res.body).code, "no_such_route");
});

test("the dashboard server actually starts and serves over a real socket", async () => {
  // 4127 is in TEST_BAND (4090-4149), which is reserved AGAINST production
  // ports. It used to be 4061 with a comment claiming that was "distinct from
  // every production/demo port in use" — an assertion no one could check, and
  // it stopped being true the moment 4061 became NEGOTIATION_VIEW and started
  // running as a permanent service. Declared in TEST_PORTS so the registry, not
  // a comment, is what keeps it true.
  const port = 4127;
  const server = await startDashboardServer(port);
  try {
    const res = await fetch(`http://localhost:${port}/`);
    assert.equal(res.status, 200);
    const body = await res.text();
    assert.ok(body.includes("app.js"));
  } finally {
    server.close();
  }
});
