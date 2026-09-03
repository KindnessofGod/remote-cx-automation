// ---------------------------------------------------------------------------
// remoteUiWorkAuthQueue.test.js  —  the employer's queue SCREEN, driven for
//                                   real against the real server
// ---------------------------------------------------------------------------
// WHY THIS FILE EXISTS, ON TOP OF remoteuiWorkAuth.test.js
// That file pins the SERVER: the company boundary, the two verbs, the audit
// ordering. It reads workauth.js only as text. But `npm test` never imports a
// browser asset (CLAUDE.md §6), so everything the page RENDERS is true only
// until the next edit — and this page was rebuilt from a column of tall cards
// (one request per screenful, with the approve/decline controls in a separate
// form far below the request they acted on) into a dense queue with the
// decision on the row. The properties that redesign bought are exactly the kind
// that regress silently:
//
//   1. ONE ROW PER REQUEST, and several visible at once. Asserted as "the queue
//      is a list of <li>, one per pending request", because that is the
//      structural fact density rests on.
//   2. THE BOILERPLATE IS SAID ONCE. The three-stage explainer and the stand-in
//      disclosure used to be rendered verbatim under every card. A count is the
//      only assertion that can tell "said once" from "said per row" — a
//      substring check passes either way.
//   3. WHAT IS PER-ROW IS PER-ROW. The permanent-establishment sentence is a
//      fact the employee stated about ONE trip, and it must appear on that trip
//      and not on the others.
//   4. THE DECISION LANDS ON THE ROW. Approve posts and the row itself shows
//      the server's verdict, with no reload and no second form.
//   5. THE PROVENANCE BADGE DEGRADES. An origin value this page has never seen
//      renders as itself. The alternative — an if/else over two known strings —
//      labels the next origin the server learns to send "From Remote's API",
//      which is the one sentence the badge exists to prevent.
//
// The DOM here is deliberately minimal: appendChild/removeChild/textContent/
// className/setAttribute/hidden/disabled/value is the entire surface
// workauth.js uses, and the source assertions at the bottom pin that it never
// reaches for innerHTML. A node with a method the real DOM has would let the
// renderer start depending on something this harness cannot check.
// ---------------------------------------------------------------------------

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";
import { Readable } from "node:stream";

import { createInProcessFetch, resetWorkAuthorizations } from "../src/remote/mockServer.js";
import { RemoteClient } from "../src/remote/restClient.js";
import { AmendmentStore } from "../src/uc06/amendmentStore.js";
import { createRemoteUiHandler } from "../src/remoteui/server.js";
import { STAGE_3_NOTE } from "../src/remoteui/workAuthPolicy.js";
import { createWorkAuthorizationStandin } from "../src/remoteui/workAuthStandin.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ASSETS = join(__dirname, "..", "src", "remoteui", "assets");
const read = (file) => readFileSync(join(ASSETS, file), "utf8");
const SOURCE = read("workauth.js");
const HTML = read("workauth.html");

// The ids the page's shell owns and the script fills. Named once, asserted
// against BOTH the real HTML and the harness below, so a harness that has
// drifted from the page cannot keep passing.
const SHELL_IDS = [
  "stages",
  "next-stage",
  "queue",
  "queue-message",
  "queue-scope",
  "queue-count",
  "probe",
  "announce",
  "exclusions",
  "reload",
  "live-note",
];

// ---------------------------------------------------------------------------
// A DOM small enough to read, and a real server behind fetch()
// ---------------------------------------------------------------------------

function createNode(tagName) {
  return {
    tagName: String(tagName).toLowerCase(),
    className: "",
    textContent: "",
    childNodes: [],
    attributes: {},
    listeners: {},
    hidden: false,
    disabled: false,
    value: "",
    get firstChild() {
      return this.childNodes[0] || null;
    },
    appendChild(child) {
      this.childNodes.push(child);
      return child;
    },
    removeChild(child) {
      const i = this.childNodes.indexOf(child);
      if (i !== -1) this.childNodes.splice(i, 1);
      return child;
    },
    setAttribute(name, value) {
      this.attributes[name] = String(value);
    },
    removeAttribute(name) {
      delete this.attributes[name];
    },
    addEventListener(type, fn) {
      (this.listeners[type] = this.listeners[type] || []).push(fn);
    },
    focus() {},
  };
}

function textOf(node) {
  const own = node.textContent ? String(node.textContent) : "";
  const kids = node.childNodes.map(textOf).join(" ");
  return (own + " " + kids).replace(/\s+/g, " ").trim();
}

function collect(node, predicate, found = []) {
  if (predicate(node)) found.push(node);
  node.childNodes.forEach((child) => collect(child, predicate, found));
  return found;
}

/** Every occurrence of a sentence in a subtree — "once" is the assertion. */
function countText(node, needle) {
  return collect(node, (n) => String(n.textContent || "").indexOf(needle) !== -1).length;
}

function buttonsIn(node) {
  return collect(node, (n) => n.tagName === "button");
}

function click(node) {
  (node.listeners.click || []).forEach((fn) => fn({ preventDefault() {} }));
}

let auditRows;
let handler;

function buildHandler() {
  const client = new RemoteClient({ baseUrl: "http://mock.remote.invalid", fetchImpl: createInProcessFetch() });
  return createRemoteUiHandler({
    remote: client,
    audit: {
      logDurable: async (row) => auditRows.push(row),
      log: async (row) => auditRows.push(row),
      logTraceStep: async () => {},
    },
    amendmentStore: new AmendmentStore(),
    zendesk: { createTicket: async () => ({ id: 1 }), updateTicket: async () => ({}) },
    employees: [],
    employmentIdFieldId: "1",
    workAuthStandin: createWorkAuthorizationStandin(),
  });
}

/** Drive the real handler with a real request/response pair. No socket. */
function callHandler(h, { method = "GET", path, body = null, headers = {} }) {
  return new Promise((resolve, reject) => {
    const req = Readable.from(body ? [Buffer.from(body)] : []);
    req.method = method;
    req.url = path;
    req.headers = headers;
    const chunks = [];
    const res = {
      statusCode: 200,
      _headers: {},
      setHeader(k, v) {
        this._headers[k] = v;
      },
      getHeader(k) {
        return this._headers[k];
      },
      end(chunk) {
        if (chunk) chunks.push(Buffer.from(chunk));
        const raw = Buffer.concat(chunks).toString("utf8");
        let json = null;
        try {
          json = JSON.parse(raw);
        } catch {
          /* an asset, not JSON */
        }
        resolve({ status: this.statusCode, raw, json });
      },
    };
    Promise.resolve(h(req, res)).catch(reject);
  });
}

/**
 * Boot the real workauth.js against the fake DOM.
 *
 * `respond` defaults to the REAL handler, so what the page renders is what the
 * server actually sends — the point of the harness. A test that needs a shape
 * the current server does not produce (an unknown origin, say) passes its own.
 */
async function renderPage({ respond, hidden = false } = {}) {
  const nodes = {};
  SHELL_IDS.forEach((id) => {
    nodes[id] = createNode("div");
  });

  const pending = new Set();
  const intervals = [];
  const document = {
    readyState: "complete",
    hidden,
    getElementById: (id) => nodes[id] || null,
    createElement: createNode,
    listeners: {},
    addEventListener(type, fn) {
      (this.listeners[type] = this.listeners[type] || []).push(fn);
    },
  };

  const calls = [];
  const context = {
    document,
    console,
    JSON,
    Promise,
    String,
    Number,
    Boolean,
    Object,
    Array,
    Date,
    Math,
    RegExp,
    encodeURIComponent,
    setTimeout,
    fetch: (url, init) => {
      const options = init || {};
      calls.push({ url: String(url), method: options.method || "GET", body: options.body || null });
      const path = String(url).indexOf("/") === 0 ? String(url) : "/" + String(url);
      const work = (async () => {
        const res = respond
          ? await respond(path, options)
          : await callHandler(handler, {
              method: options.method || "GET",
              path,
              body: options.body,
              headers: { "x-remoteui-session": "admin" },
            });
        return { status: res.status, ok: res.status >= 200 && res.status < 300, json: async () => res.json };
      })();
      pending.add(work);
      work.then(
        () => pending.delete(work),
        () => pending.delete(work)
      );
      return work;
    },
  };
  context.window = {
    document,
    sessionStorage: { getItem: () => "", setItem: () => {} },
    setInterval: (fn, ms) => {
      intervals.push({ fn, ms });
      return intervals.length;
    },
    clearInterval: () => {},
  };

  vm.createContext(context);
  new vm.Script(SOURCE, { filename: "workauth.js" }).runInContext(context);
  await settle(pending);

  return {
    nodes,
    calls,
    intervals,
    document,
    async tick() {
      // One poll, exactly as the interval would fire it.
      intervals.forEach((entry) => entry.fn());
      await settle(pending);
    },
    async settle() {
      await settle(pending);
    },
    rows: () => nodes.queue.childNodes.filter((n) => n.tagName === "li"),
    text: () => textOf(nodes.queue),
  };
}

async function settle(pending) {
  let idle = 0;
  for (let i = 0; i < 2000 && idle < 3; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
    idle = pending.size === 0 ? idle + 1 : 0;
  }
  if (pending.size !== 0) throw new Error(`workauth.js did not become idle; ${pending.size} fetch(es) pending`);
}

beforeEach(() => {
  auditRows = [];
  // A PATCH mutates the mock's request in place, so without this the first
  // approval leaves it approved for every test after it — and that failure
  // presents as an ABSENCE, which reads exactly like the feature not working.
  resetWorkAuthorizations();
  handler = buildHandler();
});

// ---------------------------------------------------------------------------
// 1. The queue is a queue
// ---------------------------------------------------------------------------

test("the page's shell carries every id the script fills — the harness and the page agree", () => {
  for (const id of SHELL_IDS) {
    assert.ok(HTML.includes(`id="${id}"`), `workauth.html is missing id="${id}", which workauth.js writes into`);
  }
});

test("every pending request is ONE row, and they are all in the list at once", async () => {
  const page = await renderPage();
  const rows = page.rows();

  const server = await callHandler(handler, { path: "/api/work-authorizations", headers: { "x-remoteui-session": "admin" } });
  assert.ok(server.json.requests.length >= 2, "the fixture must hold more than one pending request to be a queue at all");
  assert.equal(rows.length, server.json.requests.length);

  // Every row names its own request and carries its own two buttons, so the
  // decision is never a matter of matching an id in a dropdown against a card
  // that has scrolled off screen.
  server.json.requests.forEach((entry, i) => {
    const row = rows[i];
    assert.equal(row.attributes["data-request-id"], String(entry.id));
    const labels = buttonsIn(row).map((b) => b.textContent);
    assert.ok(labels.includes("Approve"), "each row must carry its own Approve");
    assert.ok(labels.includes("Decline"), "each row must carry its own Decline");
  });
});

test("the ladder and stand-in prose are said ONCE, not once per row", async () => {
  const page = await renderPage();
  assert.ok(page.rows().length >= 2, "this assertion is only meaningful with more than one row");

  // The stage-3 sentence belongs to the page, and it is in the banner that
  // never collapses — not on any row.
  assert.equal(countText(page.nodes.queue, STAGE_3_NOTE.slice(0, 60)), 0);
  assert.equal(countText(page.nodes["next-stage"], STAGE_3_NOTE.slice(0, 60)), 1);

  // The three stages likewise: rendered once, inside the collapsed explainer.
  const stageItems = collect(page.nodes.stages, (n) => n.tagName === "li");
  assert.equal(stageItems.length, 3);
  assert.equal(collect(page.nodes.queue, (n) => n.tagName === "li" && /Mobility Team/.test(textOf(n))).length, 0);
});

test("what IS about one request stays on that request — the PE sentence is not boilerplate", async () => {
  const page = await renderPage();
  const server = await callHandler(handler, { path: "/api/work-authorizations", headers: { "x-remoteui-session": "admin" } });
  const flagged = server.json.requests.filter((r) => r.request.will_negotiate_or_sign_contracts).length;
  assert.ok(flagged >= 1, "the fixture must contain a request that states it, or this proves nothing");
  assert.ok(flagged < server.json.requests.length, "and one that does not, or 'per row' is indistinguishable from 'always'");

  const shown = page.rows().filter((row) => /permanent-establishment/.test(textOf(row))).length;
  assert.equal(shown, flagged);
});

test("the full request is available behind a disclosure, not forced onto the row", async () => {
  const page = await renderPage();
  const row = page.rows()[0];
  const details = collect(row, (n) => n.tagName === "details");
  assert.equal(details.length, 1, "one disclosure per row");
  assert.match(textOf(details[0]), /Request id/);
  // And the row's own visible line stays a LINE: who, where, when, why. The
  // server composes it (`label`) and the page falls back to composing one only
  // for a payload that predates the field — either way it is not a paragraph,
  // because row height is the whole reason the queue is readable as a queue.
  const title = collect(row, (n) => String(n.className).indexOf("wa-row-title") !== -1)[0];
  assert.ok(title, "the row must carry a one-line summary");
  const line = textOf(title);
  assert.ok(line.length < 140, `the row's line is ${line.length} chars — that is a paragraph`);
  assert.match(line, /·/, "the line names more than one fact about the trip");
});

// ---------------------------------------------------------------------------
// 2. The decision, on the row
// ---------------------------------------------------------------------------

test("approving on the row posts the decision and shows the SERVER's verdict in place", async () => {
  const page = await renderPage();
  const row = page.rows()[0];
  const id = row.attributes["data-request-id"];

  click(buttonsIn(row).find((b) => b.textContent === "Approve"));
  await page.settle();

  const posted = page.calls.filter((c) => c.method === "POST");
  assert.equal(posted.length, 1);
  assert.ok(posted[0].url.indexOf(encodeURIComponent(id)) !== -1, "the POST must be about the row that was clicked");
  assert.deepEqual(JSON.parse(posted[0].body).action, "approve");
  assert.equal(auditRows.length, 1, "the server wrote the durable record");

  // The outcome is on the row, in the server's own words — and the row is
  // still there after the re-read that follows the decision.
  const after = page.rows().find((r) => r.attributes["data-request-id"] === id);
  assert.ok(after, "the decided row must not vanish out from under the reader");
  const outcome = collect(after, (n) => String(n.className).indexOf("wa-row-outcome") === 0)[0];
  assert.ok(outcome && outcome.hidden === false, "the verdict must render on the row itself");
  assert.match(textOf(outcome), new RegExp(auditRows[0].details.status));
});

test("declining asks for the reason on the row, and sends it", async () => {
  const page = await renderPage();
  const row = page.rows()[0];

  const declineBox = collect(row, (n) => String(n.className).indexOf("wa-row-decline") === 0)[0];
  assert.equal(declineBox.hidden, true, "the reason box is out of the way until it is needed");

  click(buttonsIn(row).find((b) => b.textContent === "Decline"));
  assert.equal(declineBox.hidden, false, "declining must ask for a reason before it sends anything");
  assert.equal(page.calls.filter((c) => c.method === "POST").length, 0, "nothing is sent by opening the form");

  const reason = collect(declineBox, (n) => n.tagName === "textarea")[0];
  assert.ok(reason, "the reason field must be a real control");
  const label = collect(declineBox, (n) => n.tagName === "label")[0];
  assert.equal(label.attributes.for, reason.id, "and it must be labelled, not placeholder-only");

  reason.value = "the destination needs a permit we do not hold";
  click(buttonsIn(declineBox).find((b) => b.textContent === "Confirm decline"));
  await page.settle();

  const posted = page.calls.filter((c) => c.method === "POST");
  assert.equal(posted.length, 1);
  const body = JSON.parse(posted[0].body);
  assert.equal(body.action, "decline");
  assert.equal(body.reason, "the destination needs a permit we do not hold");
});

// ---------------------------------------------------------------------------
// 3. Provenance, and what happens to a value this page has never seen
// ---------------------------------------------------------------------------

test("an origin the page has never seen renders as itself rather than as Remote's", async () => {
  // The server is gaining a third origin (a portal-filed request) while this
  // is written. A page that switched on two known strings would have badged it
  // "From Remote's API" — a stand-in or a customer-filed record wearing
  // Remote's name is the exact thing the badge exists to prevent.
  const payload = {
    ok: true,
    companyId: "co_amend_01",
    stages: [],
    nextStage: STAGE_3_NOTE,
    decidableStatus: "pending",
    requests: [
      {
        id: "portal-wa-1",
        origin: "portal_filed",
        employeeName: "Chris Lee",
        request: {
          status: "pending",
          reason: "Workation",
          destination_country: { name: "Spain", code: "ES" },
          travel_date_start: "2026-09-01",
          travel_date_end: "2026-09-14",
        },
      },
    ],
    scope: { employments: [], unreadable: [], verdict: {}, standinUnattributed: [] },
    remoteProbe: { asked: true, endpoint: "GET /v1/work-authorization-requests", employmentsQueried: 1, rowsReturned: 0 },
  };
  const page = await renderPage({ respond: async () => ({ status: 200, json: payload }) });

  const row = page.rows()[0];
  const badge = collect(row, (n) => String(n.className).indexOf("wa-origin") !== -1)[0];
  assert.ok(badge, "every row carries a provenance badge");
  assert.equal(badge.textContent, "portal_filed", "an unknown origin is shown verbatim, never guessed at");
  assert.ok(!/From Remote's API/.test(textOf(row)), "and is never labelled as Remote's own record");

  // A label the server sends wins over anything this page would have chosen.
  const labelled = JSON.parse(JSON.stringify(payload));
  labelled.requests[0].originLabel = "Filed in the request portal";
  const second = await renderPage({ respond: async () => ({ status: 200, json: labelled }) });
  const relabelled = collect(second.rows()[0], (n) => String(n.className).indexOf("wa-origin") !== -1)[0];
  assert.equal(relabelled.textContent, "Filed in the request portal");
});

// ---------------------------------------------------------------------------
// THE FILING TIME — reported from the live deployment, 2026-08-31
// ---------------------------------------------------------------------------
// "There are no timestamps here, so I don't even know when I am looking at a
// request I initiated." Twenty-three rows, ordered newest-first by
// `sortBySubmittedAt()` in src/remoteui/workAuthRecords.js — SORTED BY A FACT
// THE PAGE DID NOT SHOW. `submitted_at` had been on every row of this payload
// since the screen shipped.
//
// The defect is not that a nice-to-have was missing. It is that the ONE
// question this screen exists to let an employer answer — which of these is
// the request I just filed, and is this one still current — was unanswerable
// from it, while the data to answer it was already in the DOM's own source
// object and already governing the order the rows appeared in.
// ---------------------------------------------------------------------------

function stampOf(row) {
  return collect(row, (n) => String(n.className).indexOf("wa-row-filed") !== -1)[0];
}

function queuePayload(requests) {
  return {
    ok: true,
    companyId: "co_amend_01",
    stages: [],
    nextStage: STAGE_3_NOTE,
    decidableStatus: "pending",
    requests,
    scope: { employments: [], unreadable: [], verdict: {}, standinUnattributed: [] },
    remoteProbe: { asked: true, endpoint: "GET /v1/work-authorization-requests", employmentsQueried: 1, rowsReturned: 0 },
  };
}

test("every row says WHEN it was filed, and carries the exact instant it was filed at", async () => {
  const payload = queuePayload([
    {
      id: "uc04-stamped",
      origin: "uc04_record",
      employeeName: "Chris Lee",
      request: {
        status: "pending",
        submitted_at: "2026-08-31T19:36:40Z",
        destination_country: { name: "Netherlands", code: "NL" },
        travel_date_start: "2026-09-01",
        travel_date_end: "2026-09-21",
      },
    },
  ]);
  const page = await renderPage({ respond: async () => ({ status: 200, json: payload }) });

  const stamp = stampOf(page.rows()[0]);
  assert.ok(stamp, "the row carries a filing stamp");
  assert.match(stamp.textContent, /^Filed /, "and names what the time means, rather than printing a bare date");
  assert.match(stamp.textContent, /2026/, "an absolute year, so it survives a page that refreshes every ten seconds");

  // The exact instant must be recoverable. A rendered local string rounds to
  // the minute; two requests filed seconds apart would be indistinguishable on
  // the face of the row, which is the failure this whole fix is about.
  assert.equal(
    stamp.attributes.title,
    "Filed at 2026-08-31T19:36:40Z (exact value as recorded)",
    "the unrounded value as the server sent it"
  );
});

test("a row with no filing time SAYS SO — it never shows a plausible date instead", async () => {
  // The honest-absence direction, and the one that matters most: a missing
  // stamp rendered as `new Date()` reads as "filed just now", which is the
  // single most misleading thing this element could say on a screen whose
  // whole purpose is telling a just-filed request from an old one.
  for (const submitted of [undefined, null, "", "not a date at all"]) {
    const request = {
      status: "pending",
      destination_country: { name: "Portugal", code: "PT" },
      travel_date_start: "2026-12-01",
      travel_date_end: "2026-12-12",
    };
    if (submitted !== undefined) request.submitted_at = submitted;
    const page = await renderPage({
      respond: async () => ({
        status: 200,
        json: queuePayload([{ id: "wa-unstamped", origin: "standin", employeeName: "Alexandre Tremblay", request }]),
      }),
    });
    const stamp = stampOf(page.rows()[0]);
    assert.ok(stamp, `submitted_at ${JSON.stringify(submitted)}: the element is still rendered`);
    assert.equal(stamp.textContent, "filing time not recorded");
    assert.ok(
      !/\d{4}/.test(stamp.textContent),
      `submitted_at ${JSON.stringify(submitted)}: an unrecorded filing time must never render as a year`
    );
    assert.ok(String(stamp.className).indexOf("wa-row-filed-unknown") !== -1, "and is marked as an absence, not a value");
  }
});

test("the filing stamp is per-row, like the PE sentence and unlike the boilerplate", async () => {
  // The regression this catches is the stamp being lifted to the header as
  // "last updated", which is a fact about the SCREEN. Two requests filed at
  // different times must show two different times.
  const mk = (id, at) => ({
    id,
    origin: "uc04_record",
    employeeName: "Chris Lee",
    request: {
      status: "pending",
      submitted_at: at,
      destination_country: { name: "Netherlands", code: "NL" },
      travel_date_start: "2026-09-01",
      travel_date_end: "2026-09-21",
    },
  });
  const page = await renderPage({
    respond: async () => ({
      status: 200,
      json: queuePayload([mk("wa-new", "2026-08-31T19:36:40Z"), mk("wa-old", "2026-07-02T08:00:00Z")]),
    }),
  });
  const rows = page.rows();
  assert.equal(rows.length, 2);
  const first = stampOf(rows[0]);
  const second = stampOf(rows[1]);
  assert.notEqual(first.attributes.title, second.attributes.title, "each row stamps its OWN filing time");
  assert.match(first.attributes.title, /2026-08-31T19:36:40Z/);
  assert.match(second.attributes.title, /2026-07-02T08:00:00Z/);
});

test("the server's own one-line label is what the row shows, and a marker block reaches the reader", async () => {
  // Three fields the server added while this page was being rebuilt: `label`
  // (the row's line, composed server-side so there is one spelling of it),
  // `decidable` (the same predicate the pending list is filtered on) and a
  // `_record` marker on requests this system holds rather than invented. None
  // of them may need an edit here to be honoured, and none may be recomputed.
  const payload = {
    ok: true,
    companyId: "co_amend_01",
    stages: [],
    nextStage: STAGE_3_NOTE,
    decidableStatus: "pending",
    requests: [
      {
        id: "uc04-1",
        origin: "uc04_record",
        employeeName: "Chris Lee",
        label: "Chris Lee · Portugal · 2026-11-02 → 2026-11-09 · Client meetings",
        decidable: false,
        filedVia: "portal",
        ticketId: "36",
        assessment: { decision: "ready_for_approval", reason: "all_gates_passed", flags: [], riskLevel: null },
        offSchemaFactors: { homeCountry: "US", nationality: null, visaType: null, jobDuties: null },
        request: {
          status: "pending",
          destination_country: { name: "Portugal" },
          _record: { note: "OUR RECORD, NOT REMOTE'S — filed on one of this system's own intake surfaces." },
        },
      },
    ],
    scope: { employments: [], unreadable: [], verdict: {}, standinUnattributed: [] },
    remoteProbe: { asked: true, endpoint: "GET /v1/work-authorization-requests", employmentsQueried: 1, rowsReturned: 0 },
  };
  const page = await renderPage({ respond: async () => ({ status: 200, json: payload }) });
  const row = page.rows()[0];

  const title = collect(row, (n) => String(n.className).indexOf("wa-row-title") !== -1)[0];
  assert.equal(textOf(title).indexOf(payload.requests[0].label), 0, "the server's line is rendered verbatim, not recomposed");

  // A marker block the page has no name for still reaches the reader: it is
  // collected by shape, so `_record` needed no edit here to be shown.
  assert.match(textOf(row), /OUR RECORD, NOT REMOTE'S/);
  assert.match(textOf(row), /portal/, "how it was filed is a fact about this row");
  assert.match(textOf(row), /36/, "and so is the ticket it raised");

  // `decidable: false` is the SERVER's answer and it is believed.
  buttonsIn(row)
    .filter((b) => b.textContent === "Approve" || b.textContent === "Decline")
    .forEach((b) => assert.equal(b.disabled, true, `${b.textContent} must be refused on a row the server calls undecidable`));
});

// ---------------------------------------------------------------------------
// 4. Instant: the list refreshes itself, and stops when nobody is looking
// ---------------------------------------------------------------------------

test("the queue polls on an interval, and a hidden tab polls nothing", async () => {
  const page = await renderPage();
  assert.equal(page.intervals.length, 1, "exactly one interval — a page that stacks timers is a busy loop in waiting");
  assert.ok(page.intervals[0].ms >= 5000, "polling faster than every 5s is a load generator, not a refresh");

  const before = page.calls.length;
  await page.tick();
  assert.ok(page.calls.length > before, "a visible tab re-reads the list");

  const hiddenPage = await renderPage({ hidden: true });
  const hiddenBefore = hiddenPage.calls.length;
  await hiddenPage.tick();
  assert.equal(hiddenPage.calls.length, hiddenBefore, "a hidden tab must not poll at all");

  // And the explicit control stays: an interval is a promise about the future,
  // and a reader who wants to know NOW should not have to trust it.
  assert.ok(HTML.includes('id="reload"'), "the page keeps a Reload control");
  assert.ok(/live-note/.test(SOURCE), "and says on screen that it is refreshing itself");
});

test("a newly-filed request appears on the next poll with no reload", async () => {
  let extra = false;
  const base = {
    ok: true,
    companyId: "co_amend_01",
    stages: [],
    nextStage: STAGE_3_NOTE,
    decidableStatus: "pending",
    scope: { employments: [], unreadable: [], verdict: {}, standinUnattributed: [] },
    remoteProbe: { asked: true, endpoint: "GET /v1/work-authorization-requests", employmentsQueried: 1, rowsReturned: 0 },
  };
  const one = {
    id: "wa-1",
    origin: "standin",
    employeeName: "Chris Lee",
    request: { status: "pending", destination_country: { name: "Spain" }, travel_date_start: "a", travel_date_end: "b" },
  };
  const two = { ...one, id: "wa-2", employeeName: "Emma Thompson" };

  const page = await renderPage({
    respond: async () => ({ status: 200, json: { ...base, requests: extra ? [one, two] : [one] } }),
  });
  assert.equal(page.rows().length, 1);

  extra = true;
  await page.tick();
  assert.equal(page.rows().length, 2, "the new request must arrive without anybody pressing anything");
  assert.match(page.text(), /Emma Thompson/);
});

// ---------------------------------------------------------------------------
// 5. The source rules this repo applies to every browser asset
// ---------------------------------------------------------------------------

test("workauth.js compiles, and builds every node rather than injecting markup", () => {
  assert.doesNotThrow(() => new vm.Script(SOURCE, { filename: "workauth.js" }));
  assert.ok(!/\.innerHTML\s*=/.test(SOURCE), "workauth.js assigns innerHTML");
  assert.ok(!/\.outerHTML\s*=/.test(SOURCE), "workauth.js assigns outerHTML");
  assert.ok(!/insertAdjacentHTML|document\.write/.test(SOURCE), "workauth.js injects raw markup");
  // The only mentions of innerHTML that survive are the header's account of why
  // it is not used — a rule stated in the file it governs.
  assert.equal((SOURCE.match(/innerHTML/g) || []).length, 1);
});

test("the page states no rule, status or role the server owns", () => {
  // Remote's status vocabulary belongs to workAuthPolicy.js. The page sends
  // `approve`/`decline` and renders whatever comes back.
  assert.ok(!/approved_by_manager|declined_by_manager|approved_by_remote|declined_by_remote/.test(SOURCE));

  // No status literal is compared against: `decidableStatus` arrives on the
  // payload, and a page that knew "pending" would keep its own copy of which
  // statuses an employer may act on.
  assert.ok(!/["']pending["']/.test(SOURCE), "the page must not carry its own copy of the decidable status");

  // Nor may it decide who may act. The role travels as one header the SERVER
  // looks up, and every refusal is rendered from the server's own words.
  // Comments are stripped first: naming a refusal code in a comment that
  // explains WHY the page defers to the server is the opposite of restating it.
  const code = SOURCE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  assert.ok(!/role_not_authorized|not_your_company|not_awaiting_manager/.test(code));
  assert.ok(!/companyId\s*:/.test(SOURCE), "the company is never sent — the boundary is the server's alone");

  // And the two empty states stay two: "asked and holds nothing" is not the
  // same fact as "asked about nobody".
  assert.match(SOURCE, /remoteProbe\.asked|remoteProbe && payload\.remoteProbe\.asked/);
  assert.match(SOURCE, /Remote was not asked about anybody/);
  assert.match(SOURCE, /renderExclusions/);
});

// ---------------------------------------------------------------------------
// WHERE the stamp sits, not just whether it exists.
//
// The stamp shipped correct and was REPORTED AS MISSING by the first person to
// use the screen: `margin-left: auto` pinned it against the Approve button at
// the far right of a wide row, in 12px secondary text, and at that distance
// from the name it reads as chrome. The three tests above would all have passed
// in that state — they assert the string is rendered, and it was.
//
// So this pins the property those tests cannot see: the stamp is part of the
// title line the eye is already on, and nothing pushes it to the opposite edge.
// ---------------------------------------------------------------------------
test("the filing stamp is not exiled to the far edge of the row", () => {
  const css = read("style.css");
  const rule = css.match(/^\.wa-row-filed \{[^}]*\}/m);
  assert.ok(rule, "expected a .wa-row-filed rule in style.css");
  assert.ok(
    !/margin-left:\s*auto/.test(rule[0]),
    "the filing stamp must not be pushed to the end of the flex line — that is " +
      "the layout a real user read as 'there are no timestamps here'"
  );
});

test("the filing stamp is rendered into the title line, beside the name", () => {
  const js = read("workauth.js");
  // Both row shapes — the server-labelled one-liner and the name + summary
  // fallback — must carry it, and both must carry it on the TITLE line.
  const titleAppends = js.match(/titleLine\.appendChild\(filedStamp\(entry\)\);/g) ?? [];
  assert.equal(titleAppends.length, 2, "both row shapes must stamp the title line");
  assert.ok(
    !/actions\.appendChild\(filedStamp\(/.test(js),
    "the stamp belongs to the request, not to the approve/decline controls"
  );
});
