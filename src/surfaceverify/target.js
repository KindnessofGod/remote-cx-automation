// ---------------------------------------------------------------------------
// target.js  —  Which host `verify-surfaces` is allowed to point at
// ---------------------------------------------------------------------------
// WHY THIS EXISTS — RULE 4, BUILT FIRST, PER rca-tcj
// "Refuse a Vercel PREVIEW host outright (remote-cx-apis--<hash>-<org>.vercel.app)
// — previews do not carry production secrets and three beads have been opened
// on findings that were really 'we probed the wrong host'." A preview
// deployment is a DIFFERENT database, a DIFFERENT Zendesk trigger wiring (or
// none), and answers every request with plausible-looking JSON — so a runner
// that doesn't check the host first can run to completion, print a clean grid,
// and have verified nothing.
//
// The one host this project's own docs (CLAUDE.md "Live resources") name as
// production is https://remote-cx-apis.vercel.app — the production alias
// tracking `orchestration/gascity-pilot`. Everything else on *.vercel.app is
// refused: a preview URL has the shape `remote-cx-apis-<hash>-<org>.vercel.app`
// or carries `-git-` — either way it is NOT the alias, and the distinction is
// exactly the one CLAUDE.md paid for.
//
// THIS MODULE THROWS. It does not print or exit — that is the CLI's job
// (scripts/verify-surfaces.mjs), so this logic is testable without a process.
// ---------------------------------------------------------------------------

export const PRODUCTION_HOST = "remote-cx-apis.vercel.app";

/** Thrown for anything this runner must treat as "could not tell", never "0 defects". */
export class SurfaceUnreachableError extends Error {
  constructor(message, { code = "target_unreachable" } = {}) {
    super(message);
    this.name = "SurfaceUnreachableError";
    this.code = code;
  }
}

/**
 * Resolve and validate the target base URL.
 *
 * @param {object} opts
 * @param {string} [opts.explicit]  a URL passed on the CLI (--target=…)
 * @param {boolean} [opts.allowPreviewForSelfTest]  ONLY set by the runner's own
 *   self-test of rule 4 itself (proving refusal works) — never by a real run.
 * @returns {string} a validated base URL with no trailing slash
 * @throws {SurfaceUnreachableError} on anything this run must not proceed against
 */
export function resolveTarget({ explicit = null, allowPreviewForSelfTest = false } = {}) {
  const raw = (explicit || `https://${PRODUCTION_HOST}`).trim().replace(/\/+$/, "");

  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new SurfaceUnreachableError(`--target is not a valid URL: ${JSON.stringify(raw)}`, {
      code: "bad_target_url",
    });
  }

  if (url.protocol !== "https:" && !/^(localhost|127\.0\.0\.1)$/.test(url.hostname)) {
    throw new SurfaceUnreachableError(
      `refusing a non-HTTPS target (${url.protocol}//${url.hostname}) — production is always HTTPS`,
      { code: "insecure_target" }
    );
  }

  if (url.hostname.endsWith(".vercel.app") && url.hostname !== PRODUCTION_HOST && !allowPreviewForSelfTest) {
    throw new SurfaceUnreachableError(
      `refusing Vercel PREVIEW host "${url.hostname}" — previews do not carry production secrets ` +
        `(no real Supabase, no real Zendesk trigger wiring) and three prior beads were opened on ` +
        `findings that were really "we probed the wrong host". The only accepted vercel.app host is ` +
        `"${PRODUCTION_HOST}". Pass an explicit --target only for a local server or a deliberate ` +
        `override you can justify in the run's own output.`,
      { code: "preview_host_refused" }
    );
  }

  return raw;
}

/**
 * Confirm the portal/audit shared key actually authenticates against `baseUrl`,
 * by calling the cheapest gated route (/audit/api/meta). A wrong key must
 * exit 2 (could not tell), never 0 or a "defect found" — holding a key that
 * doesn't work is not a finding about the product, it is this run being
 * unable to see anything at all.
 *
 * @param {object} opts
 * @param {string} opts.baseUrl
 * @param {string} opts.portalKey
 * @param {typeof fetch} [opts.fetchImpl]
 */
export async function verifyPortalKey({ baseUrl, portalKey, fetchImpl = fetch }) {
  if (!portalKey) {
    throw new SurfaceUnreachableError(
      "no PORTAL_ACCESS_KEY supplied — the audit/portal surfaces cannot be read without it",
      { code: "portal_key_missing" }
    );
  }
  let res;
  try {
    res = await fetchImpl(`${baseUrl}/audit/api/meta`, { headers: { "x-portal-key": portalKey } });
  } catch (err) {
    throw new SurfaceUnreachableError(`could not reach ${baseUrl}/audit/api/meta: ${err.message}`, {
      code: "network_error",
    });
  }
  if (res.status === 401 || res.status === 403) {
    throw new SurfaceUnreachableError(
      `${baseUrl}/audit/api/meta refused the supplied PORTAL_ACCESS_KEY (HTTP ${res.status}) — ` +
        "this run cannot authenticate to the deployment, which is a reason to exit 2, not to report 0 defects.",
      { code: "portal_key_rejected" }
    );
  }
  if (!res.ok) {
    throw new SurfaceUnreachableError(`${baseUrl}/audit/api/meta returned HTTP ${res.status}`, {
      code: "target_error_response",
    });
  }
  return true;
}
