// ---------------------------------------------------------------------------
// router.js  —  Nine node:http handlers, one serverless function
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
// The ZAF sidebar runs in an agent's browser inside Zendesk and fetches these
// APIs directly, so "the APIs are up" has to mean "up on the public internet",
// not "up while a laptop is open". Vercel's free tier gives serverless
// functions, not long-lived processes — so the nine `npm run ucNN-api`
// processes have to become something a function can serve.
//
// ONE FUNCTION, NOT NINE. Every server in src/ already exposes its request
// handler as a plain `(req, res)` function built by a `createXxxHandler(deps)`
// factory — that is exactly the signature Vercel's Node runtime invokes. So
// the whole deployment is a prefix router: strip `/ucNN`, hand the rest to
// that use case's real handler, unchanged. Nine separate functions would mean
// nine copies of the dependency wiring, nine cold starts, nine sets of
// environment variables to keep in step, and nine chances for one of them to
// drift — the same "the gates exist twice" hazard CLAUDE.md §6 already records
// for the n8n Code nodes. Nothing here re-implements a route, a gate or a
// policy: this file only decides WHICH handler sees the request.
//
// THE URL SHAPE IS CHOSEN TO REQUIRE NO SIDEBAR CHANGES. zaf-app already takes
// nine independent base URLs and appends each use case's own paths
// (`base + "/api/amendments/by-ticket/..."`). Giving each use case a path
// prefix on one host means the settings become
//   apiBaseUrl      = https://<deployment>/uc01
//   uc06ApiBaseUrl  = https://<deployment>/uc06
// and not one line of zaf-app/ has to change. Two use cases genuinely collide
// on their own paths — UC-07 and UC-08 both serve `/api/dossiers` — so a
// prefix is not cosmetic, it is the thing that makes one host possible at all.
//
// This file is PURE: no I/O, no environment, no stores. It is unit-testable
// without deploying anything, which is the point (test/deployRouter.test.js).
// ---------------------------------------------------------------------------

/**
 * Query parameters this deployment's own rewrite injects. They must never
 * reach a use-case handler, and never be mistaken for a caller's parameter.
 *
 * Learned from deploy/remote-bridge: a Vercel rewrite injects its OWN named
 * source parameter on top of the destination's, so `source: "/:cxpath*"` adds
 * `cxpath=...` whether you asked for it or not. The bridge's first version
 * used `/:path*` and every proxied request arrived upstream carrying
 * `?path=...`, which the real API rejected as an unexpected field. Both names
 * are deliberately prefixed/obscure so stripping them can never eat a genuine
 * query parameter.
 */
export const ROUTING_PARAMS = ["__cx_path", "cxpath"];

/**
 * The nine use cases, in sidebar precedence order.
 *
 * `writes`        — has at least one POST route that changes state, so the
 *                   signed-identity gate applies to it.
 * `memoryOnlyList`— a bare "list everything" route whose store keeps its rows
 *                   in process memory only. See serverlessListNotice() below
 *                   for why those are answered with an explanation rather
 *                   than an empty array.
 */
export const USE_CASES = Object.freeze([
  { prefix: "uc01", label: "UC-01 employment verification (review API)", writes: true, memoryOnlyList: null },
  { prefix: "uc02", label: "UC-02 expense & receipt validation", writes: true, memoryOnlyList: "/api/expenses" },
  // `writes: true` since the travel letter's sign-off landed. It is ONE route
  // for ONE decision (a drafted formal letter); every other UC-03 outcome is
  // refused by name — see src/uc03/signoffPolicy.js. The flag is what applies
  // the signed-identity gate to it, so getting it wrong would publish an
  // unauthenticated approval, not merely mislabel a listing.
  { prefix: "uc03", label: "UC-03 travel support / workation router", writes: true, memoryOnlyList: null },
  { prefix: "uc04", label: "UC-04 work authorization", writes: true, memoryOnlyList: "/api/authorizations" },
  { prefix: "uc05", label: "UC-05 resignation notice", writes: true, memoryOnlyList: "/api/resignations" },
  { prefix: "uc06", label: "UC-06 contract amendment (dual approval)", writes: true, memoryOnlyList: "/api/amendments" },
  { prefix: "uc07", label: "UC-07 global mobility dossiers (read-only)", writes: false, memoryOnlyList: "/api/dossiers" },
  { prefix: "uc08", label: "UC-08 cross-border tax dossiers (read-only)", writes: false, memoryOnlyList: "/api/dossiers" },
  { prefix: "uc09", label: "UC-09 off-cycle payroll adjustment", writes: true, memoryOnlyList: "/api/adjustments" },
]);

const BY_PREFIX = new Map(USE_CASES.map((u) => [u.prefix, u]));

/**
 * The request portal (src/portal/), mounted alongside the nine.
 *
 * It is NOT a tenth entry in USE_CASES, and the distinction is load-bearing
 * rather than tidy: every field on a USE_CASES row describes a review/approval
 * API (does it write? does it have a memory-only list route?), and every gate
 * in handler.js that reads those fields applies the ZAF-signed identity rule to
 * them. The portal cannot satisfy that rule — it is not inside Zendesk, so
 * nothing mints a ZAF token for it — and it carries its own, weaker shared-key
 * gate instead (src/portal/access.js). Listing it as a use case would silently
 * subject it to a gate it can never pass, and, worse, would invite the reverse
 * repair: relaxing the nine's gate until the portal fits through it.
 *
 * INTAKE, NOT REVIEW. The portal has no route that reads an existing record —
 * no `by-ticket`, no `/:id` — so `memoryOnlyList` and the serverless-list
 * notice have nothing to say about it. A submission's decision is returned
 * once, in the response to the POST that produced it.
 */
export const PORTAL = Object.freeze({
  prefix: "portal",
  label: "Request portal — intake for the eight request types with no Remote event API",
  writes: true,
});

/**
 * The audit trail viewer (src/auditview/), mounted alongside the nine and the
 * portal. Same reasoning as PORTAL for staying out of USE_CASES: it is not a
 * review/approval API and cannot present a ZAF token, so listing it there
 * would subject it to a gate it can never pass. It carries the portal's own
 * shared-key gate instead (src/portal/access.js — one key, two surfaces).
 *
 * READ-ONLY, STRUCTURALLY: its server has no POST route at all
 * (src/auditview/server.js), which is why `writes: false` here is a fact
 * about the code rather than a policy about the deployment.
 */
export const AUDIT_VIEW = Object.freeze({
  prefix: "audit",
  label: "Audit trail viewer — audit_log, audit_trace, workflow_claims, ops_alerts (read-only)",
  writes: false,
});

/**
 * The approval queue (src/approvalqueue/), mounted alongside the nine, the
 * portal and the audit viewer. Same reasoning as PORTAL and AUDIT_VIEW for
 * staying out of USE_CASES: it is not a review/approval API and cannot present
 * a ZAF token, so listing it there would subject it to a gate it can never
 * pass. It carries the portal's shared-key gate instead — one key, now three
 * surfaces.
 *
 * READ-ONLY, STRUCTURALLY: its server has no POST route at all
 * (src/approvalqueue/server.js), so `writes: false` here is a fact about the
 * code rather than a policy about the deployment. That matters more for this
 * surface than for the audit viewer: this one reports on approvals, and a
 * second place to MAKE one would be two policies with nothing keeping them in
 * step.
 */
export const QUEUE_VIEW = Object.freeze({
  prefix: "queue",
  label: "Approval queue — everything awaiting a human, and everything nobody can reach (read-only)",
  writes: false,
});

/**
 * The Remote-product stand-in (src/remoteui/), mounted alongside the nine, the
 * portal, the audit viewer and the queue.
 *
 * Same reasoning as PORTAL for staying out of USE_CASES: it is not a
 * review/approval API and cannot present a ZAF token — it stands in for
 * Remote's OWN product surfaces, which are not inside Zendesk — so listing it
 * there would subject it to a gate it can never pass. It carries the portal's
 * shared-key gate instead (src/portal/access.js), one key now opening five
 * surfaces.
 *
 * WHY IT IS MOUNTED AT ALL. It was `npm run remoteui` and nothing else, so the
 * two flows that begin inside Remote's product — a customer admin requesting a
 * contract amendment, and a customer's manager deciding a work-authorization
 * request — could not appear in a browser demo of the deployment at all. Every
 * other surface in this repository could; these two were reachable only from a
 * clone.
 *
 * IT WRITES. `writes: true` is a fact about the code and not a posture: the
 * amendment path creates a real Zendesk ticket, and the work-authorization path
 * records a durable audit row and can PATCH a real Remote record. That is
 * exactly why the shared key is not optional here, and why the gate lives in
 * the surface itself rather than in a copy kept here.
 */
export const REMOTE_UI = Object.freeze({
  prefix: "remoteui",
  label: "Remote product stand-in — the customer admin's amendment request (UC-06) and the employer's work-authorization decision (UC-04, stage 2)",
  writes: true,
});

/**
 * The third-party consent door (src/thirdparty/), mounted alongside the nine,
 * the portal, the audit viewer and the queue. It is NOT a fifth "portal-style"
 * surface with the same shared-key gate — it is deliberately gated by
 * NOTHING. VC-06/VC-07/VC-08/VC-33 (qa/contracts/UC-01-acceptance.md §16) all
 * enter through this door, and the entry condition they exist to prove is
 * that the caller has NO credential of any kind: "there is no authenticated
 * signal at all, and there cannot be" (§4). A shared key here would not be a
 * stronger gate, it would be a different channel — a bank does not hold a
 * PORTAL_ACCESS_KEY, and requiring one would make the criteria this surface
 * exists to make evidenceable permanently unrunnable from outside.
 *
 * Structurally safe to leave open: `src/thirdparty/server.js`'s own
 * invariant (VC-33) is that its ONE response body,
 * `THIRD_PARTY_ACK_MESSAGE`, is a parameterless constant no branch can
 * select — so an unauthenticated caller can trigger the real workflow
 * (case row, consent lookup, audit trace) but can never learn its outcome.
 * The thing an open gate would normally expose is exactly the thing this
 * route is built to never return.
 */
export const THIRD_PARTY_DOOR = Object.freeze({
  prefix: "thirdparty",
  label: "Third-party consent door — unauthenticated intake for a bank, landlord or screening vendor (no key, no ZAF token, by design — VC-33)",
  writes: true,
});

/** Deployment-level routes that belong to no use case. */
const META_ROUTES = new Set(["/", "/healthz", "/__cx/health", "/__cx/routes"]);

/**
 * Work out the original request path.
 *
 * `__cx_path` is injected by the rewrite in vercel.json and is authoritative.
 * The fallback — stripping a leading `/api` off the pathname — exists so that
 * hitting the function directly at `/api/uc06/...`, which is what a debugging
 * request does when it bypasses the rewrite, still routes the same way instead
 * of silently 404ing. deploy/remote-bridge pays for exactly this fallback in
 * its own header comment.
 *
 * @param {URL} url
 * @returns {string} a path with a single leading slash
 */
function originalPath(url) {
  const injected = url.searchParams.get("__cx_path");
  if (injected !== null && injected !== "") return "/" + injected.replace(/^\/+/, "");
  const stripped = url.pathname.replace(/^\/api(?=\/|$)/, "");
  return stripped === "" ? "/" : stripped;
}

/** The caller's own query string, minus this deployment's routing artifacts. */
function forwardedSearch(url) {
  const params = new URLSearchParams(url.search);
  for (const p of ROUTING_PARAMS) params.delete(p);
  const s = params.toString();
  return s ? `?${s}` : "";
}

/**
 * @typedef {object} Route
 * @property {"meta"|"usecase"|"portal"|"audit"|"queue"|"remoteui"|"thirdparty"|"unknown"} kind
 * @property {string} path        the resolved original path, for diagnostics
 * @property {string} [route]     meta only: which meta route
 * @property {string} [prefix]    usecase only: "uc06"
 * @property {object} [useCase]   usecase only: the USE_CASES entry
 * @property {string} [url]       usecase only: the url to hand the real handler
 * @property {string} [innerPath] usecase only: `url` without its query string
 */

/**
 * Decide who should answer this request. Pure — give it a raw `req.url`.
 *
 * @param {string} rawUrl  e.g. "/api?__cx_path=uc06/api/amendments/by-ticket/7"
 * @returns {Route}
 */
export function resolveRoute(rawUrl) {
  // The base is irrelevant — only pathname/search are read — but URL requires
  // one for a relative input.
  const url = new URL(rawUrl || "/", "http://cx.invalid");
  const path = originalPath(url);

  if (META_ROUTES.has(path)) {
    return { kind: "meta", route: path, path };
  }

  const segments = path.split("/").filter(Boolean);

  if (segments[0] === PORTAL.prefix) {
    const innerPath = "/" + segments.slice(1).join("/");
    return {
      kind: "portal",
      prefix: PORTAL.prefix,
      path,
      innerPath,
      url: innerPath + forwardedSearch(url),
    };
  }

  if (segments[0] === QUEUE_VIEW.prefix) {
    const innerPath = "/" + segments.slice(1).join("/");
    return {
      kind: "queue",
      prefix: QUEUE_VIEW.prefix,
      path,
      innerPath,
      url: innerPath + forwardedSearch(url),
    };
  }

  if (segments[0] === AUDIT_VIEW.prefix) {
    const innerPath = "/" + segments.slice(1).join("/");
    return {
      kind: "audit",
      prefix: AUDIT_VIEW.prefix,
      path,
      innerPath,
      url: innerPath + forwardedSearch(url),
    };
  }

  if (segments[0] === REMOTE_UI.prefix) {
    const innerPath = "/" + segments.slice(1).join("/");
    return {
      kind: "remoteui",
      prefix: REMOTE_UI.prefix,
      path,
      innerPath,
      url: innerPath + forwardedSearch(url),
    };
  }

  if (segments[0] === THIRD_PARTY_DOOR.prefix) {
    const innerPath = "/" + segments.slice(1).join("/");
    return {
      kind: "thirdparty",
      prefix: THIRD_PARTY_DOOR.prefix,
      path,
      innerPath,
      url: innerPath + forwardedSearch(url),
    };
  }

  const useCase = BY_PREFIX.get(segments[0]);
  if (!useCase) {
    return { kind: "unknown", path };
  }

  const innerPath = "/" + segments.slice(1).join("/");
  return {
    kind: "usecase",
    prefix: useCase.prefix,
    useCase,
    path,
    innerPath,
    url: innerPath + forwardedSearch(url),
  };
}

/**
 * Should this request be answered with the "that list is process-local"
 * explanation instead of being passed through?
 *
 * WHY THIS IS NOT SILENT. Seven of the nine stores keep `list()` in a plain
 * array on the instance — honestly documented as in-memory-only in each store
 * (see src/uc02/expenseStore.js's header). A serverless function builds a
 * fresh store per request, so those arrays are ALWAYS empty here, and an empty
 * `{"amendments": []}` from a deployment whose Supabase table holds seven rows
 * is a wrong answer that looks like a working one — precisely the failure this
 * project's own honesty directive exists to prevent. The per-ticket and
 * per-id reads that the sidebar actually uses are unaffected: those fall
 * through to Postgres by design.
 *
 * @param {Route} route
 * @param {string} method
 */
export function isMemoryOnlyList(route, method) {
  if (route.kind !== "usecase" || method !== "GET") return false;
  return Boolean(route.useCase.memoryOnlyList) && route.innerPath === route.useCase.memoryOnlyList;
}

/** The body returned for the case above. Explains itself and names the way out. */
export function serverlessListNotice(route) {
  return {
    ok: false,
    code: "list_not_available_serverless",
    reason:
      `${route.useCase.label}'s "list everything" route reads an in-process array, and this ` +
      `deployment builds a fresh store for every request — so it would always answer with an ` +
      `empty list, which would look like "no records exist" rather than "this route cannot ` +
      `answer here".`,
    useThisInstead: [
      `GET /${route.prefix}${route.useCase.memoryOnlyList}/by-ticket/:zendeskTicketId`,
      `GET /${route.prefix}${route.useCase.memoryOnlyList}/:id`,
    ],
    note: "Both of those read Supabase and work. The ZAF sidebar only ever calls the by-ticket route.",
  };
}

/**
 * Resolve the CORS origin to send back.
 *
 * ZAF_ALLOWED_ORIGIN may be a single origin or a comma-separated list, because
 * a Zendesk app iframe's origin is not obviously predictable from the account
 * subdomain and the value that works has to be discovered from a real request
 * (GET /__cx/health echoes it back for exactly that reason). A request whose
 * Origin is not on the list gets the FIRST configured entry, so the browser
 * refuses it — a mismatch must fail visibly, never be reflected.
 *
 * Unset means "*", which is the same default the servers ship with locally.
 * CORS is not an authorization mechanism here and never was: every
 * state-changing route is gated by the signed-identity check and its use
 * case's own policy engine.
 *
 * @param {string|undefined|null} configured  raw ZAF_ALLOWED_ORIGIN
 * @param {string|undefined|null} requestOrigin  the request's Origin header
 */
export function resolveAllowedOrigin(configured, requestOrigin) {
  const raw = (configured || "").trim();
  if (!raw || raw === "*") return "*";
  const allowed = raw.split(",").map((s) => s.trim()).filter(Boolean);
  if (!allowed.length) return "*";
  if (requestOrigin && allowed.includes(requestOrigin)) return requestOrigin;
  return allowed[0];
}
