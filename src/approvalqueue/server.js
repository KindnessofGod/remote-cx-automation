// ---------------------------------------------------------------------------
// server.js  —  The approval queue's HTTP surface
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
// Every approval this system needs is recorded in one of eight places and read
// from none of them together, so "what is waiting on a person, and can that
// person get to it?" had no answer short of hand-written SQL plus a Zendesk
// session. This server is that answer, and its headline is deliberately not the
// queue but the STUCK LIST — the items awaiting a human with no reachable place
// to be approved.
//
// THERE IS NO POST ROUTE IN THIS FILE. Not one that refuses — an absence of
// one, the same structural discipline as src/uc08/server.js and
// src/auditview/server.js. This surface REPORTS on approvals. If it could also
// make one there would be two places where an approval happens, each with its
// own idea of who may approve and when, which is the duplicated-gates bug with
// a UI on top. There is no branch for any method but GET, so anything else
// falls through to 404 no_such_route, and test/approvalQueue.test.js asserts
// that both behaviourally and structurally.
//
// THE VERDICTS ARE THE SERVER'S, NOT THE PAGE'S. Awaiting-or-settled, ticket
// reachability, group correctness and the stuck classification are all computed
// here by the pure modules beside this file. The browser renders the words it
// is sent and re-derives nothing — the rule every asset in this repo follows,
// and the one that matters most on a page whose whole job is to say what is
// broken.
//
// ERRORS RENDER; AN EMPTY QUEUE IS NEVER MANUFACTURED. The store throws on any
// read failure (§9). This file catches that throw only to show it — 503
// no_durable_store or 500 queue_read_failed, rendered as a banner. It never
// maps a failure to an empty list, because "nothing is waiting for anyone" is
// the most dangerous sentence this page could print.
//
// ACCESS is the portal's shared key, reused whole (src/portal/access.js) — one
// key, now three surfaces. This view serves employment ids, requester names and
// full decision records, exactly as the audit viewer does. The page itself is
// ungated because it carries no data and is how an operator is told a key is
// needed; every /api route beneath it is gated.
// ---------------------------------------------------------------------------

import { createServer } from "node:http";
import { stripHtmlComments, stripJsComments } from "../shared/stripBuildComments.js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { checkPortalAccess, checkPortalAccessThrottled, OPEN_ACCESS } from "../portal/access.js";
import { NoDurableStoreError } from "./queueStore.js";
import { TicketFacts } from "./ticketFacts.js";
import { buildQueue } from "./queue.js";
import { APPROVAL_ROUTES } from "./approvalRoutes.js";
import { handoffDirections } from "./handoffDirections.js";
import { CATEGORY_ORDER, CATEGORY_LABELS } from "./stuck.js";
import { teamProvisioning, teamProvisioningSummary } from "./teams.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const ASSETS = {
  "/": { file: "index.html", type: "text/html; charset=utf-8" },
  "/app.js": { file: "app.js", type: "application/javascript; charset=utf-8" },
  "/style.css": { file: "style.css", type: "text/css; charset=utf-8" },
  // The shared design system, at the same relative path as every other browser
  // surface, so this is the same product rather than a ninth look.
  "/remote-ui.css": {
    file: "remote-ui.css",
    dir: join(__dirname, "..", "shared", "ui"),
    type: "text/css; charset=utf-8",
  },
};

/**
 * @param {object} deps
 * @param {import("./queueStore.js").ApprovalQueueStore} deps.store
 * @param {TicketFacts} [deps.ticketFacts]
 * @param {object} [deps.access]  shared-key posture; OPEN_ACCESS so a fresh
 *   clone's `npm run queue-ui` needs no configuration.
 * @param {string} [deps.basePath]  mount prefix on the deployment ("/queue").
 * @param {() => number} [deps.now]  test seam for the waiting clock.
 */
export function createApprovalQueueHandler({
  // The durable counter behind the failed-key ceiling. Optional: without it
  // the gate behaves exactly as it did before the ceiling existed, which is
  // the right default for a local run and for tests. deploy/cx-apis/deps.js
  // passes the Postgres-backed one, because an in-memory counter on a
  // serverless deployment starts at zero every invocation and bounds nothing.
  throttleStore = null,
  store,
  ticketFacts = new TicketFacts(),
  access = OPEN_ACCESS,
  basePath = "",
  now = Date.now,
}) {
  const prefix = String(basePath || "").replace(/\/+$/, "");

  return async function handle(req, res) {
    const url = new URL(req.url, "http://localhost");
    const parts = url.pathname.split("/").filter(Boolean);

    try {
      if (req.method === "GET" && ASSETS[url.pathname]) {
        const asset = ASSETS[url.pathname];
        const body = readFileSync(join(asset.dir ?? join(__dirname, "assets"), asset.file));
        res.statusCode = 200;
        res.setHeader("Content-Type", asset.type);
        // COMMENTS ARE STRIPPED AT SERVE TIME. These pages are public — only
        // the /api routes below the gate need the key — so anything in the
        // bundle is readable by a stranger via view-source. The comments in
        // these files name internal issue ids (rca-*, DRIFT-*) and src/ paths,
        // which is internal detail leaking to anyone who looks. The source
        // files keep their comments for the next developer.
        //
        // src/thirdparty/ has done this since it shipped; the fix was applied
        // to one of four surfaces and the other three kept serving 305 KB of
        // annotated source. Doing it in the shared shape here rather than in
        // one file, because that is how it came to be true of only one.
        if (asset.file === "index.html") {
          return res.end(withBaseHref(stripHtmlComments(body.toString("utf8")), prefix));
        }
        if (asset.file === "app.js") {
          return res.end(stripJsComments(body.toString("utf8")));
        }
        return res.end(body);
      }

      // THE GATE, before the route match rather than inside each route, so a
      // route added later is gated by existing rather than by being remembered.
      // THROTTLED, not merely checked. The key alone had no brute-force
      // ceiling: eight wrong guesses in a row returned eight plain 401s with
      // no counter, no delay and no lockout, against a shared secret standing
      // in front of the real audit_log and the approval queue on a PUBLIC
      // deployment.
      //
      // Only a supplied-and-WRONG key counts. A missing key is the ordinary
      // first screen — the page fires several API calls before anyone has
      // typed anything — so counting those would lock out an honest visitor
      // before they had entered a thing. A CORRECT key is admitted even from
      // an already-throttled address, so nobody holding the code can be shut
      // out by somebody else guessing from the same network.
      //
      // It fails OPEN, which is the opposite of the third-party door's limiter
      // and deliberately so. There, the limiter is the only control and an
      // unbounded billable spend does not stop by itself. Here the control is
      // the KEY, checked before this runs and unaffected by whether the
      // counter works — so a counter that cannot count leaves the secret
      // exactly as strong as it was, while failing closed would turn a
      // Postgres hiccup into a total lockout of everyone holding the right
      // code. The stricter direction would be the outage.
      const verdict = await checkPortalAccessThrottled(req, access, { store: throttleStore });
      if (!verdict.ok) return send(res, verdict.status, verdict.body);

      if (req.method === "GET" && isPath(parts, ["api", "meta"]) && parts.length === 2) {
        const teamProvisioningTable = teamProvisioning();
        return send(res, 200, {
          ok: true,
          mode: store.mode(),
          verification: ticketFacts.posture(),
          // The approval-surface table, so the page can show which use cases
          // have a control at all without deriving it from the items it happens
          // to be holding — an empty queue must still be able to say that UC-03
          // has nowhere to approve.
          // …each carrying the three sentences a receiving human is owed —
          // where to act, what the verbs are, what they cannot do here —
          // composed from the row rather than written out per use case. This is
          // the same object the Zendesk hand-off note renders, so a reviewer can
          // read here exactly what a specialist will be told there.
          routes: Object.values(APPROVAL_ROUTES).map((route) => ({
            ...route,
            directions: handoffDirections({ useCase: route.useCase }),
          })),
          // A team with no Zendesk group is a standing hole rather than an
          // event, so it is reported whether or not anything is sitting in it
          // right now — see teams.js. The summary rides alongside the table so
          // the page can STATE the account-level answer instead of leaving a
          // reader to infer it from the absence of red cells: "all nine
          // provisioned" is a check that ran and passed, and a surface that can
          // only ever print faults teaches its reader to distrust it.
          teams: teamProvisioningTable,
          teamProvisioning: teamProvisioningSummary(teamProvisioningTable),
          categories: CATEGORY_ORDER.map((c) => ({ category: c, label: CATEGORY_LABELS[c] })),
        });
      }

      if (req.method === "GET" && isPath(parts, ["api", "queue"]) && parts.length === 2) {
        const queue = await buildQueue({ store, ticketFacts, now: now() });
        // The posture is read AFTER buildQueue, not before, and that ordering is
        // the whole point: `lastLookup` is null until a lookup has actually run,
        // so /api/meta (which is served before any lookup) can only ever report
        // "nothing checked yet". Only here can the page learn that this refresh
        // hit its ticket budget and left ids unchecked. Without it a truncated
        // read renders identically to a complete one — the same "cannot tell
        // clean from did-not-look" failure this viewer exists to expose.
        return send(res, 200, { ok: true, ...queue, verification: ticketFacts.posture() });
      }

      return send(res, 404, { ok: false, code: "no_such_route", path: url.pathname });
    } catch (err) {
      if (err instanceof NoDurableStoreError) {
        return send(res, 503, { ok: false, code: err.code, reason: err.message });
      }
      // Shown, never swallowed into an empty queue. See the header.
      return send(res, 500, { ok: false, code: "queue_read_failed", reason: err.message });
    }
  };
}

/** Mounted pages need a <base> so their relative asset URLs resolve. */
export function withBaseHref(html, prefix) {
  if (!prefix) return html;
  return html.replace("<head>", `<head>\n<base href="${prefix}/" />`);
}

function isPath(parts, expected) {
  return expected.every((segment, i) => parts[i] === segment);
}

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

/** Start the queue view on `port`. The port is passed in — never a literal
 *  here; src/shared/ports.js is the only place a port is written down. */
export function startApprovalQueueServer(deps, port) {
  const server = createServer(createApprovalQueueHandler(deps));
  return new Promise((resolve) => server.listen(port, () => resolve(server)));
}
