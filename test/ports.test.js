// ---------------------------------------------------------------------------
// ports.test.js — no two processes may claim the same socket
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
// Three separate times, a port collision in this repo produced a failure that
// looked like anything except a port collision:
//
//   1. test/audit.test.js bound 4016, which zendesk.test.js already used.
//      `node --test` runs files in parallel, so it surfaced as an intermittent
//      EADDRINUSE flake attributed to "test pollution".
//   2. uc02's seed mock bound 4051 — UC-03's PUBLIC API port. Starting the
//      nine use-case APIs the way `npm run dashboard` instructs killed UC-03.
//   3. uc04's seed mock and uc05's seed mock both bound 4028, so whichever
//      lost the race died. Which one lost depended on start order, which made
//      it look nondeterministic.
//
// Every one of those files carried a comment asserting its port was "distinct
// from every other mock-server port already in use". The comments were sincere
// and wrong: they had been checked against the other MOCK ports and never
// against the API ports. A comment cannot be executed. This can.
// ---------------------------------------------------------------------------

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { PORTS, TEST_PORTS, SEED_MOCK_BAND, TEST_BAND, BROWSER_BLOCKED_PORTS } from "../src/shared/ports.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

/**
 * Strip comments so documentation examples aren't mistaken for live code.
 *
 * The line-comment rule refuses to fire after a colon, and that is not
 * cosmetic: `"http://localhost:4091"` begins with `//` too, so the naive
 * "slash-slash to end of line" rule this used to carry deleted the rest of
 * every line holding a URL. (That rule's own source cannot be quoted inside a
 * block comment — it ends in the two characters that close one, which is a
 * small demonstration of the same class of problem.)
 * Every port that only ever appeared inside a base URL was therefore
 * invisible to all four scans below — including 4091, where one test needs the
 * socket dead and another binds it. A scanner that cannot see a thing agrees
 * with every claim about it.
 */
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/** Strip string contents, so quoted data isn't mistaken for a port. */
function stripStrings(src) {
  return src.replace(/'[^']*'/g, "''").replace(/"[^"]*"/g, '""').replace(/`[\s\S]*?`/g, "``");
}

/** Every 4-digit localhost-range port literal in a chunk of source. */
function portLiterals(src) {
  return [...src.matchAll(/\b(4\d{3})\b/g)].map((m) => Number(m[1]));
}

/**
 * Port literals written into CODE, ignoring quoted data.
 *
 * The distinction matters: `externalRef: "4001"` is a Zendesk ticket number
 * that happens to look like a port, while `startMockServer(4013)` is a real
 * binding. So bare numbers count, quoted ones don't — except when the string
 * spells out a URL, which is the other way a port gets hard-coded.
 */
function boundPortLiterals(src) {
  const code = stripComments(src);
  const inUrls = [...code.matchAll(/localhost:(\d{4})/g)].map((m) => Number(m[1]));
  return [...portLiterals(stripStrings(code)), ...inUrls];
}

test("every registered port is unique", () => {
  const seen = new Map();
  const duplicates = [];

  for (const [name, port] of Object.entries(PORTS)) {
    if (seen.has(port)) duplicates.push(`${port}: ${seen.get(port)} and ${name}`);
    else seen.set(port, name);
  }

  assert.deepEqual(duplicates, [], `two entries claim the same port:\n  ${duplicates.join("\n  ")}`);
});

test("every seed/companion mock sits inside the reserved band", () => {
  // The band exists so a demo and `npm test` can never fight over a socket.
  // Anything named *_MOCK that a long-lived server starts belongs in it.
  const bandMembers = Object.entries(PORTS).filter(([name]) => name.endsWith("_SEED_MOCK") || name.endsWith("_REMOTE_MOCK") || name.endsWith("_ZENDESK_MOCK") || name === "PDF_DEMO_MOCK");

  assert.ok(bandMembers.length >= 10, "expected the seed band to be populated");

  for (const [name, port] of bandMembers) {
    assert.ok(
      port >= SEED_MOCK_BAND.min && port <= SEED_MOCK_BAND.max,
      `${name} (${port}) is outside the reserved seed band ${SEED_MOCK_BAND.min}-${SEED_MOCK_BAND.max}`
    );
  }
});

test("no test file binds a port inside the seed band", () => {
  // This is the invariant that stops bug #1 above from recurring: test files
  // run in parallel with each other, and a developer may well have a demo
  // running while the suite executes.
  const offenders = [];

  for (const file of readdirSync(join(ROOT, "test")).filter((f) => f.endsWith(".js"))) {
    const src = readFileSync(join(ROOT, "test", file), "utf8");
    for (const port of boundPortLiterals(src)) {
      if (port >= SEED_MOCK_BAND.min && port <= SEED_MOCK_BAND.max) {
        offenders.push(`test/${file} uses ${port}`);
      }
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `test files must stay out of ${SEED_MOCK_BAND.min}-${SEED_MOCK_BAND.max}:\n  ${offenders.join("\n  ")}`
  );
});

test("no CLI hard-codes a port literal — they all come from the registry", () => {
  // The actual regression guard. Every collision above began as a plausible
  // literal typed into one file by someone who had no way to see the others.
  // Comments are stripped first, so the header docs in dashboard/cli.js that
  // legitimately quote the nine API ports don't trip this.
  const offenders = [];

  const cliFiles = readdirSync(join(ROOT, "src"), { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .flatMap((d) => {
      const dirPath = join(ROOT, "src", d.name);
      return readdirSync(dirPath)
        .filter((f) => f === "cli.js" || f === "demo.js" || f === "scenarios.js" || f === "seed.js")
        .map((f) => join("src", d.name, f));
    });

  for (const relPath of cliFiles) {
    const src = readFileSync(join(ROOT, relPath), "utf8");
    for (const port of boundPortLiterals(src)) {
      offenders.push(`${relPath} hard-codes ${port} — add it to src/shared/ports.js and import it`);
    }
  }

  assert.deepEqual(offenders, [], offenders.join("\n  "));
});

test("no port is one a browser refuses to open", () => {
  // The chat demo shipped on 4045, which Chrome blocks outright
  // (ERR_UNSAFE_PORT — 4045 is lockd). This is the nastiest failure mode in
  // the whole port story: the server boots, prints its URL, and answers curl
  // with a 200, so every signal a developer checks says healthy — and the
  // browser still refuses. Anyone opening the demo concludes the app is
  // broken, and nothing in the logs contradicts them.
  //
  // Five of the six surfaces here exist to be opened in a browser, so a port
  // a browser won't open is not a valid choice for any of them.
  const offenders = Object.entries(PORTS)
    .filter(([, port]) => BROWSER_BLOCKED_PORTS.includes(port))
    .map(([name, port]) => `${name} (${port}) is on the browser blocked-port list`);

  assert.deepEqual(offenders, [], `\n  ${offenders.join("\n  ")}`);
});

test("no test binds a port that a running server owns", () => {
  // Why this matters even though nothing is "wrong" with the code: `npm test`
  // used to fail outright whenever a demo was running, because four test files
  // bound live API ports (4021, 4023, 4053, 4054). The suite is meant to be
  // the thing you can always run. Sharing a socket with `npm run dashboard`'s
  // nine servers is the one way to make that false.
  const owned = new Map(Object.entries(PORTS).map(([name, port]) => [port, name]));
  const offenders = [];

  for (const file of readdirSync(join(ROOT, "test")).filter((f) => f.endsWith(".js"))) {
    const src = readFileSync(join(ROOT, "test", file), "utf8");
    for (const port of boundPortLiterals(src)) {
      if (owned.has(port)) {
        offenders.push(`test/${file} binds ${port}, which is ${owned.get(port)} — move it into ${TEST_BAND.min}-${TEST_BAND.max}`);
      }
    }
  }

  assert.deepEqual(offenders, [], `\n  ${offenders.join("\n  ")}`);
});

test("the nine use-case APIs and their seed mocks never overlap", () => {
  // The specific shape of bug #2: an API port and a mock port colliding is the
  // dangerous case, because the mock is invisible in every doc and every URL.
  const apiPorts = [
    PORTS.UC01_REVIEW_API,
    PORTS.UC02_API,
    PORTS.UC03_API,
    PORTS.UC04_API,
    PORTS.UC05_API,
    PORTS.UC06_API,
    PORTS.UC07_API,
    PORTS.UC08_API,
    PORTS.UC09_API,
    PORTS.DASHBOARD,
  ];
  const mockPorts = Object.entries(PORTS)
    .filter(([name]) => name.includes("MOCK"))
    .map(([, port]) => port);

  const overlap = apiPorts.filter((p) => mockPorts.includes(p));
  assert.deepEqual(overlap, [], `these ports serve as both an API and a mock: ${overlap.join(", ")}`);
});

// ---------------------------------------------------------------------------
// The half the registry did not cover: ports bound by the TESTS THEMSELVES
// ---------------------------------------------------------------------------
// Everything above this line checks servers against servers, and tests against
// servers. Nothing checked tests against each other, and the suite binds 37
// sockets across 30 files. Two live consequences, both reproduced rather than
// reasoned about:
//
//   - test/audit.test.js bound 4062, a port in no registry anywhere. A scratch
//     server on it cancelled all 12 of that file's tests — reported not as a
//     port error but as "Promise resolution is still pending but the event
//     loop has already resolved", because the before() hook's listen() never
//     settles.
//   - Six ports were shared. `node --test test/uc03Server.test.js
//     test/portalTicket.test.js test/lowTierExceptionData.test.js
//     test/remoteCountries.test.js` — all four on 4094 — cancelled 21 of 67
//     tests. The FULL suite passed, because the scheduler happened not to
//     overlap those four files. Passing was luck, not evidence.
//
// So the same rule the servers already live under now applies to the tests:
// the allocation is written down in one place, and a scan proves the files
// agree with it. Comments in six of those files claimed their port was "free
// in the test band"; every one was sincere and four were wrong.
// ---------------------------------------------------------------------------

/**
 * Ports a test file CLAIMS — bound, or deliberately left dead.
 *
 * Narrower than `boundPortLiterals()` on purpose. That helper takes every bare
 * 4xxx literal, which is right for "did a CLI hard-code a port" but wrong here:
 * the suite is full of 4xxx values that are not ports (`id: 4242`,
 * `amount: 4500`, a uuid fragment). Matching the forms a socket is actually
 * claimed through keeps the registry a registry of ports.
 *
 * A form dropped from this list would make the scan quietly blind, so
 * `detectTestPorts` is pinned against a synthetic source below, AND the
 * registry comparison runs in both directions — a declared port nothing is
 * found binding fails just as loudly as an undeclared one.
 */
function detectTestPorts(src) {
  const code = stripComments(src);
  const forms = [
    /\bstart[A-Za-z]*\(\s*(4\d{3})\s*[,)]/g, // startMockServer(4062), startZendeskMock(4015)
    /\.listen\(\s*(4\d{3})\s*[,)]/g, //           server.listen(4090)
    /localhost:(4\d{3})/g, //                     baseUrl: "http://localhost:4090"
    /\b[A-Za-z_]*PORT[A-Za-z_]*\s*[:=]\s*(4\d{3})\b/g, // const REMOTE_PORT = 4104
    /\bport\s*:\s*(4\d{3})\b/g, //                { port: 4104 }
    // const port = 4127 — lowercase, assigned rather than declared as a
    // constant or passed inline. Nothing above matched this form, so
    // test/dashboard.test.js was invisible to the scanner: absent from
    // TEST_PORTS entirely, and free to collide with a production port
    // (NEGOTIATION_VIEW, 4061) while this suite reported 13/13 green.
    /(?:const|let|var)\s+\w*[Pp]ort\w*\s*=\s*(4\d{3})\b/g,
  ];
  const found = new Set();
  for (const form of forms) {
    form.lastIndex = 0; // matchAll seeds from lastIndex; a shared /g regex remembers
    for (const m of code.matchAll(form)) found.add(Number(m[1]));
  }
  return [...found].sort((a, b) => a - b);
}

/**
 * This file is the one test excluded from the scan, because the only 4xxx
 * literals in it are the canary's synthetic sample below — a string of
 * example bindings, not bindings. The exclusion is narrow and is itself
 * checked: the test after the canary asserts this file cannot bind anything,
 * by asserting it imports nothing that could.
 */
const SCANNER_OWN_FILE = "ports.test.js";

test("detectTestPorts recognises every form a test claims a socket through", () => {
  // The canary. A regex silently dropped from the list above turns every scan
  // below into a scan that finds nothing and therefore complains about
  // nothing — the exact shape of the dead-probe-name failure in the trace
  // verifier. Each line here is a form that appears verbatim in the suite.
  const synthetic = `
    server = await startMockServer(4011);
    zendeskServer = await startZendeskMock(4015);
    await remoteFlaky.listen(4090);
    const remote = new RemoteClient({ baseUrl: "http://localhost:4092" });
    const REMOTE_PORT = 4104;
    const cfg = { port: 4105 };
    const ticketId = 4242;            // not a port
    const amount = 4500;              // not a port
  `;

  assert.deepEqual(detectTestPorts(synthetic), [4011, 4015, 4090, 4092, 4104, 4105]);
});

test("every port a test file claims is declared in TEST_PORTS — and every declaration is real", () => {
  // Both directions in one assertion, deliberately. An undeclared port is the
  // bug that bit (4062). A declaration nothing binds is how the scanner goes
  // blind without saying so.
  const scanned = {};
  for (const file of readdirSync(join(ROOT, "test")).filter((f) => f.endsWith(".js") && f !== SCANNER_OWN_FILE)) {
    const ports = detectTestPorts(readFileSync(join(ROOT, "test", file), "utf8"));
    if (ports.length) scanned[file] = ports;
  }

  const declared = Object.fromEntries(Object.entries(TEST_PORTS).map(([f, ports]) => [f, [...ports].sort((a, b) => a - b)]));

  assert.deepEqual(
    scanned,
    declared,
    "src/shared/ports.js TEST_PORTS and the test files disagree. Left = what the files bind, right = what the registry says."
  );
});

test("no two test files claim the same port", () => {
  // The invariant the six collisions violated. `node --test` runs files in
  // parallel, so two files on one port is an EADDRINUSE whose visible symptom
  // is a whole file's worth of cancelled tests, attributed to anything but a
  // port.
  const owner = new Map();
  const collisions = [];

  for (const [file, ports] of Object.entries(TEST_PORTS)) {
    for (const port of ports) {
      if (owner.has(port)) collisions.push(`${port}: ${owner.get(port)} and ${file}`);
      else owner.set(port, file);
    }
  }

  assert.deepEqual(collisions, [], `two test files claim one socket:\n  ${collisions.join("\n  ")}`);
});

test("no declared test port belongs to a server, a seed mock, or a browser's blocklist", () => {
  // The same three questions the server registry answers about itself, now
  // asked of the test allocations directly rather than of a band they are
  // assumed to sit in. `npm test` must survive `npm run dashboard` running.
  const owned = new Map(Object.entries(PORTS).map(([name, port]) => [port, name]));
  const offenders = [];

  for (const [file, ports] of Object.entries(TEST_PORTS)) {
    for (const port of ports) {
      if (owned.has(port)) offenders.push(`${file} claims ${port}, which is ${owned.get(port)}`);
      if (port >= SEED_MOCK_BAND.min && port <= SEED_MOCK_BAND.max) {
        offenders.push(`${file} claims ${port}, inside the seed-mock reserve ${SEED_MOCK_BAND.min}-${SEED_MOCK_BAND.max}`);
      }
      if (BROWSER_BLOCKED_PORTS.includes(port)) offenders.push(`${file} claims ${port}, which browsers refuse`);
    }
  }

  assert.deepEqual(offenders, [], `\n  ${offenders.join("\n  ")}`);
});

test("TEST_BAND is wide enough for the files that need it", () => {
  // 4090-4099 was ten slots for thirty files. That is why six ports ended up
  // shared and why fifteen files sit below the band instead: there was no room,
  // and nothing said so. Any future allocation goes inside the band; the ones
  // already below it are left where they are, because moving a unique, working
  // port is churn.
  const inBand = Object.values(TEST_PORTS)
    .flat()
    .filter((p) => p >= TEST_BAND.min && p <= TEST_BAND.max);
  const bandSize = TEST_BAND.max - TEST_BAND.min + 1;

  assert.ok(bandSize > inBand.length, `the test band is full: ${inBand.length} of ${bandSize} slots claimed`);
  assert.ok(TEST_BAND.min > SEED_MOCK_BAND.max, "the test band must start above the seed-mock reserve");
});

test("the scanner's own file is exempt from the scan, and cannot abuse the exemption", () => {
  // An exemption nobody checks is how a file quietly acquires a real binding
  // and keeps its pass. This one holds only while ports.test.js remains what
  // it is: a reader of files. It imports node:fs, node:url, node:path and the
  // registry — nothing that can open a socket — so there is no way for it to
  // bind the ports its canary names.
  const src = readFileSync(join(ROOT, "test", SCANNER_OWN_FILE), "utf8");
  const imported = [...src.matchAll(/^import [^;]*? from "([^"]+)";/gm)].map((m) => m[1]);

  assert.deepEqual(imported.filter((m) => m.startsWith("../src/")), ["../src/shared/ports.js"]);
  for (const m of imported) {
    assert.ok(
      m.startsWith("node:") || m === "../src/shared/ports.js",
      `${SCANNER_OWN_FILE} imports ${m}; anything beyond node builtins and the registry could bind a socket`
    );
  }
});
