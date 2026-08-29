// ---------------------------------------------------------------------------
// server.js  —  the Remote Sandbox stand-in (a pass-through, not a replacement)
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
// Remote's Sandbox is the real API and stays the source of truth. But several
// fields on its demo employments are null (see enrichment.js's audit), and those
// nulls make three use cases escalate on every input — so a demo can only ever
// show the refusal half of the system.
//
// This sits IN FRONT of the Sandbox rather than replacing it:
//
//     n8n / the app  ->  this bridge  ->  real Remote Sandbox
//                             |
//                             +-- fills ONLY the fields the Sandbox left empty
//
// Every response is real Sandbox data wherever the Sandbox had data. That
// distinction is the point: a mock would prove nothing about request shaping,
// auth, or response parsing, because it would answer whatever this project
// expected to hear. A pass-through still has to get all of that right, and only
// the demo-completeness gap is synthesized.
//
// HONESTY IS ENFORCED, NOT PROMISED. Every enriched field is named in an
// `X-Standin-Enriched` response header and in a `_standin` block on the body,
// and the server logs each one. Nothing it adds can be mistaken for Sandbox
// data by anyone reading the response, the logs, or the audit trail.
// ---------------------------------------------------------------------------

import http from "node:http";
import { enrichEmployment, remainingGaps, STANDIN_PROFILES } from "./enrichment.js";
import { projectPayrollCalendar } from "./payrollProjection.js";

const UPSTREAM_DEFAULT = "https://gateway.remote-sandbox.com";

/**
 * @param {object} opts
 * @param {string} [opts.upstream]   real Remote base URL
 * @param {string|null} [opts.token] bearer token forwarded upstream; when null,
 *   the caller's own Authorization header is passed through untouched
 * @param {typeof fetch} [opts.fetchImpl] injectable for hermetic tests
 * @param {boolean} [opts.quiet]
 * @param {object} [opts.profiles] demo-completeness profiles; injectable so a
 *   test can exercise enrichment without depending on the real Sandbox ids.
 * @param {number} [opts.projectionHorizonMonths] how far past today the payroll
 *   calendar is continued. 0 disables projection entirely, which is what makes
 *   the "refuses because it cannot know" demo reproducible through this bridge
 *   rather than only against the raw gateway.
 * @param {() => Date} [opts.clock] injectable so a test can pin "today".
 */
export function createBridge({ upstream = UPSTREAM_DEFAULT, token = null, fetchImpl = fetch, quiet = false, profiles = STANDIN_PROFILES, projectionHorizonMonths = 12, clock = () => new Date() } = {}) {
  const log = (...a) => { if (!quiet) console.log("[remote-bridge]", ...a); };

  return http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");

    if (url.pathname === "/__bridge/health") {
      return send(res, 200, { ok: true, upstream, mode: token ? "bridge_token" : "passthrough_auth" });
    }

    // Only GETs are proxied. The bridge exists to make READS complete enough to
    // demo; it deliberately refuses writes so it can never become a way to fake
    // a state change that the real API never saw.
    if (req.method !== "GET") {
      return send(res, 405, {
        error: "method_not_allowed",
        message: "The Sandbox stand-in proxies reads only. Writes must go to the real Remote API.",
      });
    }

    const target = `${upstream}${url.pathname}${url.search}`;
    let upstreamRes;
    let bodyText;
    try {
      const auth = token ? `Bearer ${token}` : req.headers.authorization;
      upstreamRes = await fetchImpl(target, {
        headers: { Accept: "application/json", ...(auth ? { Authorization: auth } : {}) },
      });
      bodyText = await upstreamRes.text();
    } catch (err) {
      // Upstream unreachable is reported as upstream unreachable. The bridge
      // never substitutes a fabricated record for a failed call — that would
      // turn an outage into a silently wrong answer, which is the one failure
      // mode this whole project is built to avoid.
      log("upstream unreachable:", err.message);
      return send(res, 502, { error: "upstream_unreachable", message: err.message, upstream });
    }

    let payload;
    try {
      payload = bodyText ? JSON.parse(bodyText) : null;
    } catch {
      res.writeHead(upstreamRes.status, { "content-type": upstreamRes.headers.get("content-type") || "text/plain" });
      return res.end(bodyText);
    }

    // ---- the payroll calendar ------------------------------------------
    // `GET /v1/payroll-runs` is a LIST, so this is the one place the stand-in
    // adds rows rather than filling fields. The rule is enforced inside
    // projectPayrollCalendar(): only periods after a country's last real
    // `period_end` are eligible, and no real row is touched.
    //
    // APPENDED ONLY TO A PAGE THAT ALREADY HAS REAL ROWS. RemoteClient
    // .listPayrollRuns() pages until it sees an EMPTY page, so putting
    // projections on an empty one would make that loop run to its 50-page
    // ceiling every call. It also dedupes by `id`, which makes appending the
    // same projected rows to several pages harmless rather than duplicative.
    const realRuns = payload?.data?.payroll_runs;
    if (upstreamRes.ok && url.pathname === "/v1/payroll-runs" && Array.isArray(realRuns)) {
      if (realRuns.length === 0 || projectionHorizonMonths <= 0) {
        if (projectionHorizonMonths <= 0) log("projection disabled (horizon 0) — raw Sandbox calendar passed through");
        return send(res, 200, payload);
      }
      const { projected, notes } = projectPayrollCalendar(realRuns, {
        now: clock(),
        horizonMonths: projectionHorizonMonths,
      });
      for (const note of notes) log("payroll:", note);

      const out = {
        ...payload,
        data: { ...payload.data, payroll_runs: [...realRuns, ...projected] },
        _standin: {
          note: "Rows whose id begins `standin-` are PROJECTED: the Sandbox calendar ends before them, and each continues its own country's last real cycle (period length, cutoff offset, payout anchor). Every row without that prefix is unmodified Sandbox data. Monetary totals and approval dates on projected rows are null, never invented.",
          projectedCycleIds: projected.map((p) => p.id),
          realCycleCount: realRuns.length,
          cadenceNotes: notes,
          upstreamStatus: upstreamRes.status,
        },
      };
      res.setHeader("X-Standin-Projected-Cycles", String(projected.length));
      res.setHeader("X-Standin-Upstream", String(upstreamRes.status));
      return send(res, 200, out);
    }

    const employment = payload?.data?.employment;
    if (!upstreamRes.ok || !employment) {
      return send(res, upstreamRes.status, payload);
    }

    const { employment: enrichedEmployment, enriched, profileFound } = enrichEmployment(employment, profiles);
    const gaps = remainingGaps(enrichedEmployment);

    if (enriched.length) log(`${employment.id}: filled ${enriched.length} empty field(s) -> ${enriched.join(", ")}`);
    if (gaps.length) log(`${employment.id}: still empty after enrichment -> ${gaps.join(", ")}`);

    const out = {
      ...payload,
      data: { ...payload.data, employment: enrichedEmployment },
      // Named with a leading underscore and a plain-English note so it reads as
      // metadata in any log, dashboard or audit payload it ends up inside.
      _standin: {
        note: "Fields listed in `enriched` were EMPTY on the real Remote Sandbox record and were filled by the demo stand-in. Everything else is unmodified Sandbox data.",
        enriched,
        stillEmpty: gaps,
        profileFound,
        upstreamStatus: upstreamRes.status,
      },
    };

    res.setHeader("X-Standin-Enriched", enriched.join(",") || "none");
    res.setHeader("X-Standin-Upstream", String(upstreamRes.status));
    return send(res, 200, out);
  });
}

function send(res, status, body) {
  const json = JSON.stringify(body ?? {});
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(json) });
  res.end(json);
}
