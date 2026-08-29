// ---------------------------------------------------------------------------
// server.js  —  The execution & audit trail viewer's HTTP surface
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
// Four tables record everything this system does (readStore.js's header names
// them); this server is the window onto them: a live feed of decisions as they
// land, a drill-down from any decision to every LLM/API attempt underneath it,
// a bug-audit lookup by external ref, and the ops-alerts ledger.
//
// THERE IS NO POST ROUTE IN THIS FILE — not a POST route that refuses, an
// absence of one, the same structural discipline as src/uc08/server.js. A
// viewer over the audit trail must not be able to amend it, and the strongest
// form of "must not" is "cannot": there is no branch for any method but GET,
// so anything else falls through to 404 no_such_route. test/auditview.test.js
// asserts this both behaviourally (a POST 404s) and structurally (the source
// never mentions the method).
//
// THE VERDICTS ARE THE SERVER'S, NOT THE PAGE'S. The redundant-call check on a
// decision's trace is computed HERE, by the same findRedundantCalls() the
// metrics dashboard uses (src/metrics/compute.js, issue #33) — the browser
// renders the flags it was sent and re-derives nothing, the rule every asset
// in this repo follows.
//
// ERRORS RENDER, EMPTY LISTS DON'T LIE. The store throws on any read failure
// (§9: a read that feeds a dashboard throws). This file catches that throw
// only to SHOW it — a 500 audit_read_failed (or 503 no_durable_store) whose
// body the page renders as an error banner. It never maps a failure to [].
//
// ACCESS is the portal's shared-key mechanism, reused whole
// (src/portal/access.js — read its header for what a shared key does and does
// not prove). This surface serves real audit rows: employment ids, requester
// emails, actors, full decision records. One key opens both surfaces on the
// deployment, deliberately: the operator already holds PORTAL_ACCESS_KEY.
// Same shape as the portal too: the page itself is served ungated (it carries
// no data and is how the operator is TOLD a key is needed); every /api route
// beneath it is gated.
// ---------------------------------------------------------------------------

import { createServer } from "node:http";
import { stripHtmlComments, stripJsComments } from "../shared/stripBuildComments.js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { checkPortalAccess, checkPortalAccessThrottled, OPEN_ACCESS } from "../portal/access.js";
import { findRedundantCalls, hasMultiAttemptGroup } from "../metrics/compute.js";
import { NoDurableStoreError } from "./readStore.js";
import { traceVerdict } from "./traceVerdict.js";
import { refVerdict } from "./refVerdict.js";
import { identifierVerdict } from "./identifierVerdict.js";
import { writeOutcome } from "./humanDecision.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const ASSETS = {
  "/": { file: "index.html", type: "text/html; charset=utf-8" },
  "/app.js": { file: "app.js", type: "application/javascript; charset=utf-8" },
  "/style.css": { file: "style.css", type: "text/css; charset=utf-8" },
  // The shared design system, served at the same relative path as every other
  // browser surface so the viewer is the same product, not an eighth look.
  "/remote-ui.css": {
    file: "remote-ui.css",
    dir: join(__dirname, "..", "shared", "ui"),
    type: "text/css; charset=utf-8",
  },
};

/**
 * @param {object} deps
 * @param {import("./readStore.js").AuditReadStore} deps.store
 * @param {object} [deps.access]  the shared-key posture from
 *   src/portal/access.js. Defaults to OPEN_ACCESS so a fresh clone's
 *   `npm run audit-ui` needs no configuration; the CLI and the deployment both
 *   compute a real one.
 * @param {string} [deps.basePath]  the mount prefix on the deployment
 *   ("/audit"); "" for `npm run audit-ui`.
 */
export function createAuditViewHandler({ store, access = OPEN_ACCESS, basePath = "", throttleStore = null }) {
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

      // THE GATE. Everything below reads real audit rows; everything above is
      // the empty shell that asks for the key. Placed before the route match,
      // so a route added later is gated by existing, not by being remembered.
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
        // The page's boot probe: which mode is this process in, and (as a side
        // effect of being gated) is the caller's key accepted.
        return send(res, 200, { ok: true, mode: store.mode() });
      }

      if (req.method === "GET" && isPath(parts, ["api", "decisions"]) && parts.length === 2) {
        // The page-back cursor arrives as one opaque string; a malformed one is
        // a 400 rather than a silently-ignored parameter, because "your cursor
        // was nonsense so here is page 1 again" is indistinguishable from
        // paging having stopped working.
        let before = null;
        try {
          before = parseCursor(url.searchParams.get("before"));
        } catch (err) {
          return send(res, 400, { ok: false, code: "bad_cursor", reason: err.message });
        }
        const page = await store.listDecisions({
          useCase: url.searchParams.get("use_case"),
          action: url.searchParams.get("action"),
          q: url.searchParams.get("q"),
          since: url.searchParams.get("since"),
          sinceId: url.searchParams.get("since_id"),
          before,
          limit: url.searchParams.get("limit") ?? undefined,
        });
        return send(res, 200, {
          ok: true,
          mode: store.mode(),
          decisions: page.decisions,
          page: {
            size: page.pageSize,
            returned: page.decisions.length,
            hasMore: page.hasMore,
            // The cursor for the NEXT (older) page, already encoded — the page
            // never assembles one itself, so the composite `(at, id)` key
            // exists in exactly one place.
            nextCursor: page.nextCursor ? formatCursor(page.nextCursor) : null,
          },
        });
      }

      if (req.method === "GET" && isPath(parts, ["api", "decisions"]) && parts.length === 3) {
        const id = decodeURIComponent(parts[2]);
        const found = await store.getDecision(id);
        if (!found) return send(res, 404, { ok: false, code: "decision_not_found", id });
        return send(res, 200, {
          ok: true,
          mode: store.mode(),
          decision: found.decision,
          trace: found.trace,
          // The rows of the same submission, correlated by the record id they
          // all carry. `correlation.field === null` means this row carries no
          // key on that list — stated, not guessed around.
          correlation: found.correlation,
          siblings: found.siblings,
          // WHY the attempts table is empty, when it is. A judgement, so it is
          // made here and rendered there.
          traceVerdict: traceVerdict({
            decision: found.decision,
            trace: found.trace,
            siblings: found.siblings,
            correlation: found.correlation,
            earliestTraceAt: found.trace.length ? null : await store.earliestTraceAt(),
          }),
          // The duplicate-vs-retry verdict, computed by the metrics layer's own
          // detector — never re-derived, here or in the browser. An empty array
          // means no OFFENDING multi-attempt group exists — which is true both
          // when every group read as a clean 1..n retry AND when there is no
          // multi-attempt group at all, so it alone cannot justify "every
          // multi-attempt group below reads as one clean retry sequence" (R7-35:
          // that blurb rendered on rows whose calls each fired once, three
          // DIFFERENT calls at attempt 1 — no retry sequence to describe).
          // `hasMultiAttemptGroup` answers the question `redundantCalls` cannot.
          redundantCalls: findRedundantCalls(found.trace),
          hasMultiAttemptGroup: hasMultiAttemptGroup(found.trace),
          // WHETHER THE WRITE A PERSON AUTHORISED ACTUALLY LANDED. null on
          // every row that is not a human verdict, so the page shows the block
          // exactly when there is a person's decision to explain. The
          // judgement is here rather than in app.js for the same reason `kind`
          // is: reading an absent `remoteResult` as "Remote may not have taken
          // it" is an inference about the data, and the browser makes none.
          writeOutcome: writeOutcome({ decision: found.decision, siblings: found.siblings }),
        });
      }

      if (req.method === "GET" && isPath(parts, ["api", "alerts"]) && parts.length === 2) {
        const alerts = await store.listAlerts({ limit: url.searchParams.get("limit") ?? undefined });
        return send(res, 200, { ok: true, mode: store.mode(), alerts });
      }

      if (req.method === "GET" && isPath(parts, ["api", "refs"]) && parts.length === 3) {
        const ref = decodeURIComponent(parts[2]);
        return send(res, 200, { ok: true, mode: store.mode(), ...(await referencePayload(store, ref)) });
      }

      // THE ONE LOOKUP BOX. /api/refs above answers "what does this EXTERNAL
      // REFERENCE reach"; this answers "what does this ID — whichever kind it
      // is — reach", which is the question a person actually arrives with.
      //
      // It exists because the narrower route's empty answer was indistinguish-
      // able from a lost decision: a requester quoted the reference the portal
      // had told them to quote, the decision row carried a different one, and
      // the page showed three empty tables. See identifierVerdict.js.
      //
      // When the value DOES resolve as an external reference, the reference
      // view is composed in alongside it rather than duplicated — one code
      // path builds it, so the two routes cannot come to disagree about the
      // same ref.
      if (req.method === "GET" && isPath(parts, ["api", "lookup"]) && parts.length === 3) {
        const value = decodeURIComponent(parts[2]);
        const lookup = await store.lookupIdentifier(value, {
          limit: url.searchParams.get("limit") ?? undefined,
        });
        const asReference = lookup.matches.some((m) => m.target.endsWith("external_ref") || m.target.endsWith(".externalRef"));
        return send(res, 200, {
          ok: true,
          mode: store.mode(),
          ...lookup,
          // WHICH OF THREE THINGS AN EMPTY RESULT MEANS — never the alarming
          // one by default. A judgement, so it is made here and rendered
          // there, the same rule traceVerdict and refVerdict follow.
          identifierVerdict: identifierVerdict(lookup),
          reference: asReference ? await referencePayload(store, value) : null,
        });
      }

      return send(res, 404, { ok: false, code: "no_such_route", path: url.pathname });
    } catch (err) {
      if (err instanceof NoDurableStoreError) {
        return send(res, 503, {
          ok: false,
          code: err.code,
          reason: err.message,
          howToFix: [
            "Set SUPABASE_DB_URL on this process (the Vercel project's Environment Variables, or .env locally), then restart/redeploy.",
            "For a zero-credential local demo, run `npm run audit-ui -- --seeded` — the page then shows labelled demo rows.",
          ],
        });
      }
      // A real read failure. Rendered, never swallowed into an empty list — a
      // feed that showed nothing over an outage would read as "nothing
      // happened", which is the wrong-number-vs-missing-number failure §9 warns
      // about, inverted.
      console.error(`[auditview] ${req.method} ${url.pathname} failed: ${err.stack}`);
      return send(res, 500, {
        ok: false,
        code: "audit_read_failed",
        reason: err.message,
        note: "The store threw rather than serving an empty list — investigate the read, do not trust this page's numbers until it recovers.",
      });
    }
  };
}


/**
 * The reference view: claims, decisions, alerts, the duplicate-delivery
 * verdict and refVerdict. Extracted so /api/refs and /api/lookup build it from
 * one place — two copies of a composition are two things that drift.
 */
async function referencePayload(store, ref) {
  const result = await store.lookupRef(ref);
  // Duplicate-delivery verdict per (useCase, ref): more than one AUTOMATED
  // decision row under one pair is the pre-claim-ledger signature. Computed
  // here, rendered there — same rule as redundantCalls above.
  //
  // rca-nr4i / D-18: count only AUTOMATED decision rows, not every audit_log
  // row that happens to carry this ref. A case that escalated and was later
  // approved in the ZAF sidebar genuinely accumulates two "decision"-kind
  // rows under one ref BY DESIGN (the triage decision, then the person's
  // verdict), and `duplicate_request_ignored` is UC-02's own dedup gate
  // correctly reporting a resubmission. Neither is "the failure the
  // workflow_claims ledger exists to stop" -- the ledger's guarantee is about
  // the ONE claim made before the FIRST durable write, which only the
  // automated row represents.
  const byPair = new Map();
  for (const d of result.decisions) {
    if (d.kind !== "decision" || d.humanVerdict !== null || d.action === "duplicate_request_ignored") continue;
    const key = `${d.useCase}\u0000${ref}`;
    byPair.set(key, (byPair.get(key) ?? 0) + 1);
  }
  const duplicateDeliveries = [...byPair.entries()]
    .filter(([, count]) => count > 1)
    .map(([key, count]) => ({ useCase: key.split("\u0000")[0], externalRef: ref, decisionRows: count }));
  return {
    externalRef: ref,
    ...result,
    duplicateDeliveries,
    // WHAT THIS REFERENCE ACTUALLY LETS YOU TRACE — computed here for the same
    // reason traceVerdict is: "one of these tables came back empty, and here is
    // which of four different things that means" is a judgement about the data,
    // and the browser makes none. See refVerdict.js's header.
    refVerdict: refVerdict({ externalRef: ref, ...result }),
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

/**
 * The feed's page cursor: `<iso at>~<uuid id>`.
 *
 * ONE STRING, TWO PARTS, and the second part is the whole point — `at` is not
 * unique in `audit_log` (one submission writes three rows in the same second),
 * so a cursor of `at` alone drops or repeats rows at a page edge depending on
 * where the boundary falls. `~` is the separator because neither an ISO
 * timestamp nor a UUID can contain one, so the split is unambiguous. It is
 * deliberately NOT base64: a cursor a human can read in a URL is a cursor a
 * human can reason about when a page looks wrong.
 */
export function formatCursor(cursor) {
  return `${cursor.at}~${cursor.id}`;
}

const CURSOR_RE = /^(.+)~([0-9a-fA-F-]{36})$/;

export function parseCursor(raw) {
  if (raw === null || raw === undefined || raw === "") return null;
  const match = CURSOR_RE.exec(String(raw));
  if (!match) throw new Error(`not a page cursor: expected "<timestamp>~<uuid>", got ${JSON.stringify(String(raw))}`);
  const at = match[1];
  if (Number.isNaN(Date.parse(at))) throw new Error(`page cursor carries an unparseable timestamp: ${JSON.stringify(at)}`);
  return { at, id: match[2] };
}

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

/**
 * Start the viewer on `port`. The port is passed in — never defaulted to a
 * literal here (src/shared/ports.js is the only place a port is written down).
 */
export function startAuditViewServer(deps, port) {
  const server = createServer(createAuditViewHandler(deps));
  return new Promise((resolve) => server.listen(port, () => resolve(server)));
}
