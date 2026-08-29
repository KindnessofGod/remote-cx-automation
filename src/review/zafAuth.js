// ---------------------------------------------------------------------------
// zafAuth.js — Verifying a ZAF-signed identity token
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
// src/review/server.js used to TRUST the X-ZAF-Approver header outright — see
// its own security-status comment and docs/BUILD-LOG.md §5 item 11 ("the one
// remaining code task that blocks a public deployment"). This module is that
// fix: real signature verification of a token the sidebar forwards, so the
// server believes a cryptographically-checked claim instead of a bare header
// anyone who can reach the endpoint could set to any name they like.
//
// ---------------------------------------------------------------------------
// TWO ZENDESK MECHANISMS, AND THIS FILE NOW SUPPORTS BOTH — DELIBERATELY
// ---------------------------------------------------------------------------
// An earlier revision of this file supported ONE of them, and it was the wrong
// one for the app this repo actually ships. Both are real; which applies is
// decided entirely by what KIND of app is calling.
//
//   RS256 — "Building a server-side app — Part 5: Securing the app"
//     https://developer.zendesk.com/documentation/apps/build-an-app/building-a-server-side-app/part-5-secure-the-app/
//     Zendesk signs an RS256 JWT on a request IT MAKES to YOUR server, to
//     render a server-side app's page. The verifying side fetches the app's
//     own public key — GET /api/v2/apps/{app_id}/public_key.pem (see
//     fetchZafAppPublicKey below). APPLIES TO: a server-side app. This repo
//     does not currently ship one; the path is kept because adding one is a
//     realistic next step and re-deriving this is not free.
//
//   HS256 — "Making API requests from a Zendesk app"
//     https://developer.zendesk.com/documentation/apps/app-developer-guide/making-api-requests-from-a-zendesk-app/
//     A CLIENT-SIDE app (a static bundle Zendesk hosts — which is exactly what
//     zaf-app/ is: manifest.json points ticket_sidebar at assets/iframe.html)
//     asks ZAF itself to mint and sign a JWT per request, via the `jwt` block
//     of client.request():
//         jwt: { algorithm: "HS256", secret_key: "{{setting.cxSharedSecret}}",
//                expiry: 60, claims: { … } }
//     and forwards it as `Authorization: Bearer {{jwt.token}}`. The signing
//     secret is a SECURE app setting: its value lives on Zendesk's servers and
//     never enters the browser — the bundle only ever contains the
//     placeholder. **ZAF signs these tokens with HS256 only.**
//     APPLIES TO: zaf-app/, i.e. every approve/decline this repo can actually
//     make today.
//
// WHAT THIS CORRECTS, RECORDED RATHER THAN QUIETLY DELETED
// The previous header of this file honestly flagged that the mechanism was
// unconfirmed and that "one JWT per page load, forwarded on every fetch()"
// was this module's own design guess rather than something read off a Zendesk
// page. That guess was wrong in two ways, both now resolved:
//   1. WRONG ALGORITHM. A verifier pinned to RS256 can never accept a real
//      ZAF client-side token, because ZAF only ever signs HS256. The two
//      halves could not meet: a server in signed-identity mode would have
//      401'd every approve/decline forever.
//   2. WRONG DIRECTION. The RS256 mechanism authenticates a request ZENDESK
//      MAKES TO US. The sidebar needed the opposite — a request WE make from
//      inside a Zendesk app to our own backend.
// The claim name could not be read off a page either, and still cannot be —
// but under HS256 it stops being a guess: the claims are OURS, supplied by
// zaf-app/assets/main.js's `jwt.claims`, so identityClaimPaths below matches
// what that file sends (`email`) while keeping the fallback list for a
// server-side app's Zendesk-minted claims.
//
// WHAT AN HS256 TOKEN ACTUALLY PROVES — DO NOT OVERCLAIM THIS
// The claims are supplied by app JavaScript, so a valid signature proves the
// call came through a real installed instance of this app in an account that
// holds the shared secret. It does NOT cryptographically prove WHICH agent
// clicked: ZAF fills nothing in for us. That still closes the actual threat —
// anyone-with-curl naming themselves as the approver on a public URL — and it
// is a strictly larger guarantee than an unauthenticated header, but it is not
// per-agent attestation and this repo must not describe it as one.
//
// ---------------------------------------------------------------------------
// THE ALGORITHM IS CHOSEN BY CONFIGURATION, NEVER BY THE TOKEN
// ---------------------------------------------------------------------------
// Supporting two algorithms in one verifier is how the classic JWT confusion
// attack gets in: a verifier that reads `header.alg` and then picks the key
// can be handed an HS256 token signed with the RSA PUBLIC key (public data) and
// will happily accept it. So the mode here is fixed by WHICH SECRET WAS
// CONFIGURED — publicKeyPem ⇒ RS256, sharedSecret ⇒ HS256 — and the incoming
// header must then MATCH that, checked before the payload is touched at all.
// Configuring both is refused outright (`ambiguous_verifier_configuration`)
// rather than silently resolved: the two belong to different app types, so
// both being present means nobody knows which app this deployment is serving.
// ---------------------------------------------------------------------------

import { createVerify, createHmac, timingSafeEqual } from "node:crypto";

const ALG_RS256 = "RS256";
const ALG_HS256 = "HS256";
const DEFAULT_CLOCK_TOLERANCE_SEC = 30;

/**
 * Ordered claim paths tried, in order, to find the requesting agent's identity.
 * `email` is first because it is what zaf-app/assets/main.js puts in its
 * `jwt.claims` (and what every approval policy in this repo records as the
 * approver); the rest are kept for a server-side app's Zendesk-minted token,
 * whose exact claim name is still unconfirmed — see the header.
 */
const DEFAULT_IDENTITY_CLAIM_PATHS = ["email", "sub", "user.email", "requester.email", "agent.email"];

function base64UrlDecode(segment) {
  return Buffer.from(segment, "base64url");
}

function getClaim(claims, path) {
  return path.split(".").reduce((value, key) => (value && typeof value === "object" ? value[key] : undefined), claims);
}

/**
 * Which algorithm this verifier is BOUND to, derived from configuration alone.
 * Never looks at the token. Returns an error verdict rather than throwing, so
 * every caller keeps one uniform failure shape.
 *
 * @returns {{alg: string}|{error: {ok:false, code:string, reason:string}}}
 */
function resolveVerifierMode({ publicKeyPem, sharedSecret }) {
  if (publicKeyPem && sharedSecret) {
    return {
      error: {
        ok: false,
        code: "ambiguous_verifier_configuration",
        reason:
          "Both an RS256 public key and an HS256 shared secret are configured. They belong to different " +
          "Zendesk app types (server-side vs client-side), so this refuses rather than guessing which one " +
          "this deployment is meant to trust.",
      },
    };
  }
  if (sharedSecret) return { alg: ALG_HS256 };
  if (publicKeyPem) return { alg: ALG_RS256 };
  // Fails closed rather than pretending a real check happened — a verifier
  // with nothing to verify against must refuse, not silently accept.
  return {
    error: {
      ok: false,
      code: "verifier_not_configured",
      reason: "No ZAF verification key (RS256 public key or HS256 shared secret) is configured.",
    },
  };
}

/** RS256 (server-side app). Never throws — a bad key or segment is "invalid". */
function verifyRs256(signingInput, signatureB64, publicKeyPem) {
  try {
    const verifier = createVerify("RSA-SHA256");
    verifier.update(signingInput);
    verifier.end();
    return verifier.verify(publicKeyPem, base64UrlDecode(signatureB64));
  } catch {
    return false;
  }
}

/**
 * HS256 (client-side ZAF app). Constant-time compare via timingSafeEqual, which
 * requires equal lengths — an unequal length is itself a mismatch and is
 * reported without ever calling into the timing-safe path (which throws on a
 * length mismatch rather than returning false).
 */
function verifyHs256(signingInput, signatureB64, sharedSecret) {
  try {
    const expected = createHmac("sha256", sharedSecret).update(signingInput).digest();
    const provided = base64UrlDecode(signatureB64);
    if (provided.length !== expected.length) return false;
    return timingSafeEqual(provided, expected);
  } catch {
    return false;
  }
}

/**
 * Verify a compact JWT (`header.payload.signature`) against the ONE algorithm
 * this call is configured for. Pure and synchronous — no network, no clock
 * other than what is passed in — so it is fully hermetic to unit test with a
 * locally generated keypair or a literal secret string.
 *
 * FAILS CLOSED on every ambiguous case, in this order: a missing token, no (or
 * a contradictory) verifier configuration, a malformed structure, an algorithm
 * other than the configured one, a bad signature, an expired or not-yet-valid
 * token, an issuer/audience mismatch (only checked when configured), or a token
 * with no extractable identity claim. There is no path that returns a trusted
 * identity without every one of these checks passing — never falls back to
 * trusting a claimed value.
 *
 * @param {string|null|undefined} token
 * @param {object} opts
 * @param {string} [opts.publicKeyPem]     PEM RSA public key ⇒ verifies RS256 (server-side app)
 * @param {string} [opts.sharedSecret]     ZAF secure-setting secret ⇒ verifies HS256 (client-side app)
 * @param {string} [opts.issuer]           expected `iss` claim, checked only if set
 * @param {string} [opts.audience]         expected `aud` claim, checked only if set
 * @param {string[]} [opts.identityClaimPaths]  see the header note above
 * @param {number} [opts.clockToleranceSec]
 * @param {() => number} [opts.now]        injectable clock, seconds since epoch
 * @returns {{ok:true, approver:string, claims:object, algorithm:string}|{ok:false, code:string, reason:string}}
 */
export function verifyZafToken(token, opts) {
  const {
    publicKeyPem,
    sharedSecret,
    issuer,
    audience,
    identityClaimPaths = DEFAULT_IDENTITY_CLAIM_PATHS,
    clockToleranceSec = DEFAULT_CLOCK_TOLERANCE_SEC,
    now = () => Math.floor(Date.now() / 1000),
  } = opts || {};

  if (!token || typeof token !== "string") {
    return { ok: false, code: "token_missing", reason: "No signed identity token was supplied." };
  }

  const mode = resolveVerifierMode({ publicKeyPem, sharedSecret });
  if (mode.error) return mode.error;

  const parts = token.split(".");
  if (parts.length !== 3) {
    return { ok: false, code: "token_malformed", reason: "Token is not a three-part JWT." };
  }
  const [headerB64, payloadB64, signatureB64] = parts;

  let header, claims;
  try {
    header = JSON.parse(base64UrlDecode(headerB64).toString("utf8"));
    claims = JSON.parse(base64UrlDecode(payloadB64).toString("utf8"));
  } catch {
    return { ok: false, code: "token_malformed", reason: "Token header/payload was not valid JSON." };
  }

  // Pin the algorithm to the CONFIGURED one BEFORE verifying anything else —
  // see the header note on downgrade and confusion attacks. Checking this first
  // means a forged header can never steer which key or which check runs next.
  if (!header || header.alg !== mode.alg) {
    return {
      ok: false,
      code: "unsupported_algorithm",
      reason: `Token algorithm must be ${mode.alg}, got ${(header && header.alg) || "none"}.`,
    };
  }

  const signingInput = `${headerB64}.${payloadB64}`;
  const signatureValid =
    mode.alg === ALG_HS256
      ? verifyHs256(signingInput, signatureB64, sharedSecret)
      : verifyRs256(signingInput, signatureB64, publicKeyPem);
  if (!signatureValid) {
    return { ok: false, code: "invalid_signature", reason: "Token signature did not verify against the configured key." };
  }

  const nowSec = now();
  if (typeof claims.exp === "number" && nowSec > claims.exp + clockToleranceSec) {
    return { ok: false, code: "token_expired", reason: "Token has expired." };
  }
  if (typeof claims.nbf === "number" && nowSec < claims.nbf - clockToleranceSec) {
    return { ok: false, code: "token_not_yet_valid", reason: "Token is not valid yet." };
  }
  // `iat` in the future is the same class of problem as `nbf` in the future —
  // a token minted by a clock ahead of ours, or backdated by hand. ZAF sets it
  // on every token it signs, so this is a real check rather than a theoretical
  // one, and it uses the same tolerance so ordinary skew does not refuse work.
  if (typeof claims.iat === "number" && nowSec < claims.iat - clockToleranceSec) {
    return { ok: false, code: "token_issued_in_future", reason: "Token was issued in the future." };
  }
  if (issuer && claims.iss !== issuer) {
    return { ok: false, code: "issuer_mismatch", reason: "Token issuer did not match the configured value." };
  }
  if (audience && claims.aud !== audience) {
    return { ok: false, code: "audience_mismatch", reason: "Token audience did not match the configured value." };
  }

  let approver = null;
  for (const path of identityClaimPaths) {
    const value = getClaim(claims, path);
    if (typeof value === "string" && value.trim()) {
      approver = value.trim();
      break;
    }
  }
  if (!approver) {
    return { ok: false, code: "identity_claim_missing", reason: "Token carried no recognizable approver identity claim." };
  }

  return { ok: true, approver, claims, algorithm: mode.alg };
}

/**
 * Bind a verifier instance to a fixed configuration, so server.js calls
 * `.verify(token)` per request without threading config through every call
 * site. A closure over verifyZafToken — no state of its own, no I/O — so it
 * is exactly as testable as the function it wraps.
 *
 * `algorithm` is exposed for logging/health output: a deployment needs to be
 * able to say which mechanism it is enforcing without a request in hand, and
 * "which one is it?" is exactly the question this whole file exists to stop
 * anyone from having to guess. It is `null` when the configuration is
 * unusable, in which case every verify() call refuses.
 *
 * @param {Parameters<typeof verifyZafToken>[1]} opts
 * @returns {{verify: (token: string) => ReturnType<typeof verifyZafToken>, algorithm: string|null}}
 */
export function createZafVerifier(opts) {
  const mode = resolveVerifierMode(opts || {});
  return { verify: (token) => verifyZafToken(token, opts), algorithm: mode.error ? null : mode.alg };
}

/**
 * Fetch a ZAF app's RS256 public key from Zendesk's own API, per the
 * server-side-app mechanism cited in this module's header comment. A REAL
 * network call — never exercised by `npm test`, which always injects
 * `publicKeyPem` directly into verifyZafToken/createZafVerifier.
 *
 * NOT the path zaf-app/ uses. This repo's sidebar is a client-side app and
 * authenticates with the HS256 shared secret instead; this stays for a
 * server-side app, so that adding one does not mean re-deriving the mechanism
 * from scratch.
 *
 * @param {object} args
 * @param {string} args.subdomain   the Zendesk account subdomain
 * @param {string} args.appId       the installed app's numeric id
 * @param {string} args.email       an agent/admin email for Basic auth
 * @param {string} args.apiToken    that agent's Zendesk API token
 * @param {typeof fetch} [args.fetchImpl]  injectable, defaults to the global fetch
 * @returns {Promise<string>} PEM-encoded public key
 */
export async function fetchZafAppPublicKey({ subdomain, appId, email, apiToken, fetchImpl = fetch }) {
  const url = `https://${subdomain}.zendesk.com/api/v2/apps/${appId}/public_key.pem`;
  const auth = Buffer.from(`${email}/token:${apiToken}`).toString("base64");
  const res = await fetchImpl(url, { headers: { Authorization: `Basic ${auth}` } });
  if (!res.ok) {
    throw new Error(`Failed to fetch ZAF app public key: HTTP ${res.status}`);
  }
  return res.text();
}
