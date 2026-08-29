// ---------------------------------------------------------------------------
// index.js  —  the Remote Sandbox stand-in, as a Vercel function
// ---------------------------------------------------------------------------
// Same contract as src/remotebridge/server.js: proxy reads to the real Remote
// Sandbox and fill ONLY the fields it left empty, naming every one.
//
// NO CREDENTIALS ARE STORED HERE. The caller's own Authorization header is
// forwarded upstream untouched, so n8n keeps using its existing Remote Sandbox
// credential and this deployment holds no secret to leak. A stand-in that
// stored a token would become a way to read the Sandbox without one.
//
// ---------------------------------------------------------------------------
// ROUTING — three deployments' worth of scar tissue, so read before changing
// ---------------------------------------------------------------------------
// Every attempt reported `state: READY` with a clean build log and then 404'd
// every path, which reads like a broken build and is not one. In order:
//
//   1. `vercel.json` used `"source": "/(.*)"` -> `"destination": "/api/$1"`.
//      Numbered capture groups are the LEGACY `routes` syntax; `rewrites` uses
//      named parameters, so `$1` interpolated to nothing.
//   2. `api/enrichment.js` sat beside the handler, but Vercel turns EVERY file
//      under `api/` into its own route, so it became a second lambda. The
//      deployment's own `lambdaRuntimeStats` saying `{"nodejs":2}` was the
//      only visible tell.
//   3. The handler was `api/[...path].js`, a catch-all. With the rewrite fixed
//      and the helper moved out, the build produced exactly ONE lambda and
//      `/api/__bridge/health` STILL 404'd — so the bracketed filename was not
//      surviving the deploy as a catch-all route.
//
// Hence this shape, which has no ambiguity left to get wrong: ONE function at
// the plain path `api/index.js`, its helper OUTSIDE `api/` in `lib/` so it can
// never become a route, and the original path passed explicitly as a query
// parameter by the rewrite rather than inferred from a filename convention.
//
// The lesson worth keeping: on Vercel, `READY` means the build succeeded, not
// that anything is reachable. Check a real request, and check the lambda
// count — a wrong count is the earliest signal that the file layout, not the
// code, is the problem.
// ---------------------------------------------------------------------------

import { enrichEmployment, remainingGaps } from "../lib/enrichment.js";
import { projectPayrollCalendar } from "../lib/payrollProjection.js";

// How far past today the payroll calendar is continued. 0 disables projection,
// which turns this deployment back into a pure pass-through — that is the
// switch for demonstrating the "refuses because it cannot know" path through
// the same URL rather than only against the raw gateway.
const PROJECTION_HORIZON_MONTHS = Number(process.env.STANDIN_PAYROLL_HORIZON_MONTHS ?? 12);

const UPSTREAM = process.env.REMOTE_UPSTREAM || "https://gateway.remote-sandbox.com";

/**
 * The path to request upstream.
 *
 * `__standin_path` is injected by the rewrite in vercel.json and is the
 * authoritative source. The fallbacks exist so that hitting `/api/...`
 * directly — bypassing the rewrite, which is what a debugging request does —
 * still works rather than silently proxying to the wrong endpoint.
 */
function upstreamPath(req, url) {
  const injected = url.searchParams.get("__standin_path");
  if (injected) return "/" + injected.replace(/^\/+/, "");
  return url.pathname.replace(/^\/api(?=\/|$)/, "") || "/";
}

/**
 * Routing artifacts that must never be forwarded upstream.
 *
 * A rewrite injects its OWN named source parameters into the query string on
 * top of the destination's — `source: "/:standinpath*"` adds `standinpath=...`
 * whether you asked for it or not. The first version used `/:path*`, so every
 * proxied request arrived at Remote carrying `?path=v1/employments/<id>`, and
 * Remote answered `422 {"errors":{"path":["Unexpected field"]}}`.
 *
 * That failure is worth naming because of how it presents: the bridge's own
 * health check was a clean 200, the deployment was READY, and the 422 came
 * back from the REAL API — so it reads as a malformed request from n8n rather
 * than as something the proxy added in transit.
 *
 * The source parameter is deliberately named `standinpath` rather than `path`
 * so that stripping it can never eat a genuine upstream query parameter that
 * happens to be called `path`.
 */
const ROUTING_PARAMS = ["__standin_path", "standinpath"];

/** The caller's own query string, minus the routing artifacts above. */
function forwardedSearch(url) {
  const params = new URLSearchParams(url.search);
  for (const p of ROUTING_PARAMS) params.delete(p);
  const s = params.toString();
  return s ? `?${s}` : "";
}

export default async function handler(req, res) {
  const url = new URL(req.url, "http://localhost");
  const path = upstreamPath(req, url);

  if (path === "/__bridge/health") {
    return res.status(200).json({
      ok: true,
      upstream: UPSTREAM,
      mode: "passthrough_auth",
      // Echoed so a routing problem is diagnosable from the health check
      // itself, rather than from a 404 that looks like a failed build.
      resolvedPath: path,
      rawUrl: req.url,
      // `forwardedQuery` is what actually reaches Remote after ROUTING_PARAMS
      // are stripped, and it is the field that makes a "422 Unexpected field"
      // diagnosable in one request instead of three.
      //
      // IT IS ALSO A DRIFT MARKER, and worth keeping for that alone: the
      // deployment answering this URL on 2026-08-18 returned `forwardedQuery`
      // and NOT `rawUrl`, yet no commit in this repo's history has ever
      // contained the string — so the live bridge was deployed from source
      // that was never committed. Both fields are emitted here so that
      // redeploying from the repo is a pure addition and can never silently
      // remove a diagnostic the live version had.
      forwardedQuery: forwardedSearch(url),
      projectionHorizonMonths: PROJECTION_HORIZON_MONTHS,
    });
  }

  // Reads only. A stand-in must never be able to fake a state change the real
  // API never saw.
  if (req.method !== "GET") {
    return res.status(405).json({
      error: "method_not_allowed",
      message: "The Sandbox stand-in proxies reads only. Writes must go to the real Remote API.",
    });
  }

  const target = `${UPSTREAM}${path}${forwardedSearch(url)}`;
  let upstreamRes;
  let bodyText;
  try {
    upstreamRes = await fetch(target, {
      headers: {
        Accept: "application/json",
        ...(req.headers.authorization ? { Authorization: req.headers.authorization } : {}),
      },
    });
    bodyText = await upstreamRes.text();
  } catch (err) {
    // An outage stays an outage. Substituting a fabricated record here would
    // turn a failure into a silently wrong answer.
    return res.status(502).json({ error: "upstream_unreachable", message: err.message, upstream: UPSTREAM });
  }

  let payload;
  try {
    payload = bodyText ? JSON.parse(bodyText) : null;
  } catch {
    return res.status(upstreamRes.status).send(bodyText);
  }

  // The payroll calendar is a LIST, so it is the one place the stand-in appends
  // rows rather than filling fields. The rule lives in projectPayrollCalendar():
  // only periods after a country's last real `period_end` are eligible, real
  // rows are never touched, and money is never invented.
  //
  // Appended only to a page that already has real rows — RemoteClient
  // .listPayrollRuns() pages until it sees an EMPTY one, so projecting onto an
  // empty page would spin that loop to its 50-page ceiling on every call.
  const realRuns = payload?.data?.payroll_runs;
  if (upstreamRes.ok && path === "/v1/payroll-runs" && Array.isArray(realRuns) && realRuns.length > 0) {
    const { projected, notes } = projectPayrollCalendar(realRuns, {
      horizonMonths: PROJECTION_HORIZON_MONTHS,
    });
    res.setHeader("X-Standin-Projected-Cycles", String(projected.length));
    res.setHeader("X-Standin-Upstream", String(upstreamRes.status));
    return res.status(200).json({
      ...payload,
      data: { ...payload.data, payroll_runs: [...realRuns, ...projected] },
      _standin: {
        note: "Rows whose id begins `standin-` are PROJECTED: the Sandbox calendar ends before them, and each continues its own country's last real cycle (period length, cutoff offset, payout anchor). Every row without that prefix is unmodified Sandbox data. Monetary totals and approval dates on projected rows are null, never invented.",
        projectedCycleIds: projected.map((p) => p.id),
        realCycleCount: realRuns.length,
        cadenceNotes: notes,
        upstreamStatus: upstreamRes.status,
      },
    });
  }

  const employment = payload?.data?.employment;
  if (!upstreamRes.ok || !employment) {
    return res.status(upstreamRes.status).json(payload);
  }

  const { employment: enriched, enriched: filled, profileFound } = enrichEmployment(employment);
  res.setHeader("X-Standin-Enriched", filled.join(",") || "none");
  res.setHeader("X-Standin-Upstream", String(upstreamRes.status));

  return res.status(200).json({
    ...payload,
    data: { ...payload.data, employment: enriched },
    _standin: {
      note: "Fields listed in `enriched` were EMPTY on the real Remote Sandbox record and were filled by the demo stand-in. Everything else is unmodified Sandbox data.",
      enriched: filled,
      stillEmpty: remainingGaps(enriched),
      profileFound,
      upstreamStatus: upstreamRes.status,
    },
  });
}
