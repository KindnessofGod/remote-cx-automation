// ---------------------------------------------------------------------------
// auditApi.js  —  Thin client for the deployed /audit/api/* surface
// ---------------------------------------------------------------------------
// Deliberately thin: this is a READ client over a surface that already exists
// (src/auditview/server.js) and already validates its own inputs. Nothing here
// re-derives a verdict the server already computes (redundantCalls, traceVerdict,
// refVerdict) — it just fetches and returns.
//
// GOTCHA PAID FOR IN THIS PASS: the query parameter is `use_case` (snake_case),
// NOT `useCase` — read directly off src/auditview/server.js:117
// (`url.searchParams.get("use_case")`). The mayor's reconnaissance note on
// rca-tcj said `useCase=UC-01`; that parameter is silently ignored by the real
// server (unknown query params are just never read), so a request built that
// way still "worked" only because every real decision in this environment
// happens to be UC-01 today. Verified live 2026-08-22: `use_case=UC-01` and
// `use_case=UC-99` return different row counts against the SAME endpoint;
// `useCase=UC-01` behaves identically to no filter at all. Rule 3 says
// scenarios are discovered against the real system, never trusted from a
// recon note — this is that rule catching a recon note.
// ---------------------------------------------------------------------------

import { SurfaceUnreachableError } from "./target.js";

async function getJson(url, { portalKey, fetchImpl = fetch }) {
  let res;
  try {
    res = await fetchImpl(url, { headers: { "x-portal-key": portalKey } });
  } catch (err) {
    throw new SurfaceUnreachableError(`network error calling ${url}: ${err.message}`, { code: "network_error" });
  }
  if (res.status === 401 || res.status === 403) {
    throw new SurfaceUnreachableError(`${url} refused the portal key (HTTP ${res.status})`, {
      code: "portal_key_rejected",
    });
  }
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new SurfaceUnreachableError(`${url} did not return JSON (HTTP ${res.status}): ${text.slice(0, 200)}`, {
      code: "bad_response_body",
    });
  }
  if (!res.ok || body.ok === false) {
    throw new SurfaceUnreachableError(`${url} returned ${res.status}: ${body.reason ?? text.slice(0, 200)}`, {
      code: body.code ?? "target_error_response",
    });
  }
  return body;
}

/**
 * Page through /audit/api/decisions collecting every row, up to `maxPages` *
 * `limit` rows, for a single use case. Used for scenario discovery (rule 3):
 * the runner needs the MOST RECENT real decision of each required reason, not
 * a fixture.
 *
 * @param {object} opts
 * @param {string} opts.baseUrl
 * @param {string} opts.portalKey
 * @param {string} opts.useCase   e.g. "UC-01"
 * @param {number} [opts.maxPages]
 * @param {typeof fetch} [opts.fetchImpl]
 * @returns {Promise<object[]>} decisions, newest first
 */
export async function fetchAllDecisions({ baseUrl, portalKey, useCase, maxPages = 10, fetchImpl = fetch }) {
  const all = [];
  let before = null;
  for (let page = 0; page < maxPages; page++) {
    const params = new URLSearchParams({ use_case: useCase, limit: "200" });
    if (before) params.set("before", before);
    const body = await getJson(`${baseUrl}/audit/api/decisions?${params}`, { portalKey, fetchImpl });
    all.push(...body.decisions);
    if (!body.page.hasMore || !body.page.nextCursor) break;
    before = body.page.nextCursor;
  }
  return all;
}

/** GET /audit/api/decisions/:id — the full decision + trace + verdicts. */
export async function fetchDecision({ baseUrl, portalKey, id, fetchImpl = fetch }) {
  return getJson(`${baseUrl}/audit/api/decisions/${encodeURIComponent(id)}`, { portalKey, fetchImpl });
}

/** GET /audit/api/refs/:ref — claims + decisions + alerts + verdict for one external ref. */
export async function fetchRef({ baseUrl, portalKey, ref, fetchImpl = fetch }) {
  return getJson(`${baseUrl}/audit/api/refs/${encodeURIComponent(ref)}`, { portalKey, fetchImpl });
}

/**
 * Run the EXACT poll the Live Feed's browser makes — `since`/`since_id` set to
 * a decision's own (at, id) — and report whether that row comes back.
 *
 * This is E4-F15's assertion (qa/evidence/.../FINDINGS.md): "the row named by
 * since_id must NOT come back." It needs no browser: the poll is a GET the
 * server answers identically whether a browser or this script asks it, and
 * the server comment in readStore.js says as much (the browser renders
 * exactly what it is sent).
 *
 * @param {object} opts
 * @param {string} opts.baseUrl
 * @param {string} opts.portalKey
 * @param {string} opts.useCase
 * @param {{id: string, at: string}} opts.boundary  the row to poll "since"
 * @param {typeof fetch} [opts.fetchImpl]
 * @returns {Promise<{reappeared: boolean, returnedIds: string[]}>}
 */
export async function pollSinceBoundary({ baseUrl, portalKey, useCase, boundary, fetchImpl = fetch }) {
  const params = new URLSearchParams({
    use_case: useCase,
    since: boundary.at,
    since_id: boundary.id,
    limit: "50",
  });
  const body = await getJson(`${baseUrl}/audit/api/decisions?${params}`, { portalKey, fetchImpl });
  const returnedIds = body.decisions.map((d) => d.id);
  return { reappeared: returnedIds.includes(boundary.id), returnedIds };
}
