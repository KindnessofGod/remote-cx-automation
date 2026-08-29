// ---------------------------------------------------------------------------
// approverAuth.js  —  Where an approver's identity is allowed to come from
// ---------------------------------------------------------------------------
// WHY THIS EXISTS (QA finding F-20, HIGH — authorization)
// Prime directive #3: "identity comes from an authenticated signal, never a
// claim." src/review/server.js honoured that — it can be run with
// `requireSignedIdentity: true` and then verifies an RS256 ZAF token, ignoring
// any name in the header or body. The four APIs that grew up beside it
// (uc04, uc05, uc06, uc09) did not: each read `body.approver ?? null` straight
// off an unauthenticated POST and passed it to its approval policy as the
// human who signed. A curl with `{"approver": "nobody@evil.test"}` executed a
// real work-authorization write and put that string in the audit log as the
// authorizing human. There was no configuration in which those endpoints could
// do better — the signed path did not exist for them at all.
//
// The fix is one mechanism, in one file, used by all five. Copying review's
// twenty lines four more times would have made "how does this service decide
// who you are?" a question with five answers, which is how one of them ends up
// out of date.
//
// PRECEDENCE, AND WHY IT MATTERS MORE THAN IT LOOKS
//   requireSignedIdentity: true  -> ONLY the verified token claim is consulted.
//       The header and body are not read at all, so a valid signature can
//       never be paired with a spoofed display name. No token, or no verifier
//       configured, is a 401 — it deliberately cannot degrade to trusting the
//       header, because a service that silently downgrades its auth under
//       misconfiguration has no auth.
//   requireSignedIdentity: false -> the demo/local posture, the same one
//       review/server.js ships with: header first, body second, both
//       untrusted. Every response says so, and every CLI prints it at
//       startup, so nobody mistakes the demo posture for a deployed one.
//
// The header is preferred over the body even in the untrusted mode because it
// is the one the ZAF sidebar actually sets from `currentUser`; a body-supplied
// approver is a hand-rolled request, and where both appear the ambiguity is
// resolved toward the surface a real agent uses.
//
// READS ARE GATED BY THE SAME RULE — see resolveReader() below
// Everything above is about WHO an action is attributed to, which is a
// write-shaped question, and that framing is how every GET route on the public
// deployment ended up unauthenticated: nothing was attributed, so nothing was
// checked. A read of these APIs discloses an employment id, the requester's
// real email address and the full decision record, over sequential integer
// ticket ids. resolveReader() applies the same signature check to a read, off
// the same flag, through the same verifySignedIdentity() helper — one
// mechanism, so the read half cannot drift into being the lenient one.
// ---------------------------------------------------------------------------

/** Header the ZAF sidebar sets from ZAF's currentUser. Untrusted on its own. */
export const APPROVER_HEADER = "x-zaf-approver";
/** Header carrying the signed ZAF identity token (see src/review/zafAuth.js). */
export const TOKEN_HEADER = "x-zaf-token";
/**
 * The header ZAF's own documented client-side flow uses:
 * `headers: { Authorization: "Bearer {{jwt.token}}" }` on client.request().
 * Accepted alongside X-ZAF-Token because that IS the shape the shipped sidebar
 * sends — a server that only read X-ZAF-Token would 401 every real approval
 * while looking perfectly correct in isolation, which is exactly the two-halves
 * -that-cannot-meet defect this pass fixes.
 */
export const AUTHORIZATION_HEADER = "authorization";

/**
 * Pull the signed token out of whichever header carries it, X-ZAF-Token first
 * because it is unambiguous. `Authorization` is only read when it is a Bearer
 * value — a Basic credential is somebody else's auth scheme and must not be
 * fed to a JWT verifier as if it were a token.
 *
 * @param {Record<string,string|string[]>} [headers]
 * @returns {string|null}
 */
export function extractSignedToken(headers = {}) {
  const direct = headers[TOKEN_HEADER];
  if (typeof direct === "string" && direct.trim()) return direct.trim();

  const authorization = headers[AUTHORIZATION_HEADER];
  if (typeof authorization === "string") {
    const match = /^Bearer[ \t]+(\S+)$/i.exec(authorization.trim());
    if (match) return match[1];
  }
  return null;
}

/**
 * @typedef {object} ApproverResolution
 * @property {boolean} ok
 * @property {string|null} [approver]  the identity to attribute the action to
 * @property {boolean} [verified]      true only when it came from a signature
 * @property {number} [status]         HTTP status for a refusal
 * @property {string} [code]           refusal code
 * @property {string} [reason]         human-readable refusal
 */

/**
 * Decide who — if anyone — this request is allowed to act as.
 *
 * @param {object} args
 * @param {import("node:http").IncomingMessage} args.req
 * @param {object} [args.body]                      already-parsed JSON body
 * @param {boolean} [args.requireSignedIdentity]
 * @param {{verify: (token: string) => {ok: boolean, approver?: string, code?: string, reason?: string}}|null} [args.zafVerifier]
 * @returns {ApproverResolution}
 */
export function resolveApprover({ req, body = {}, requireSignedIdentity = false, zafVerifier = null }) {
  if (requireSignedIdentity) {
    const verdict = verifySignedIdentity({ req, zafVerifier, action: ACTION_WRITE });
    if (!verdict.ok) return verdict;
    // The verified claim is the ONLY source of identity in this mode.
    return { ok: true, approver: verdict.identity, verified: true };
  }

  const claimed = req.headers?.[APPROVER_HEADER] || body?.approver || null;
  return { ok: true, approver: typeof claimed === "string" ? claimed : null, verified: false };
}

/**
 * Decide whether this request may READ.
 *
 * WHY A READ NEEDS THIS AT ALL — the defect that produced it
 * The signed-identity mechanism above was applied to POST only. Every GET route
 * on the public deployment was therefore unauthenticated, and each one returns
 * exactly the material this project exists to protect: an employment id, the
 * requester's real email address, the decision, its reason, its flags, the
 * whole review state. Ticket ids are sequential integers, so the entire corpus
 * was enumerable across all nine prefixes by anyone with curl. Authenticating
 * the write and leaving the read open protects the audit log's attribution
 * while publishing the thing the audit log is about.
 *
 * SAME RULE AS WRITES, DELIBERATELY. The caller passes the SAME flag it passes
 * to resolveApprover — on the deployment that is readPosture()'s
 * `signedIdentityRequired`, which ORs "a durable store is attached" with "this
 * URL is publicly reachable". A second, weaker rule for reads would be a
 * second thing to keep in step, and the first one to fall behind.
 *
 * WHAT IT DOES NOT DO. It returns no identity to attribute anything to and
 * performs no authorization beyond "this caller holds the shared secret".
 * There is no per-record ownership check here, and this must not be described
 * as one: an HS256 ZAF token proves the call came through a real installed
 * instance of the app in an account that holds the secret (see
 * src/review/zafAuth.js's header), not which agent asked. That closes the
 * actual hole — anonymous enumeration from the open internet — and nothing
 * more.
 *
 * @param {object} args
 * @param {import("node:http").IncomingMessage} args.req
 * @param {boolean} [args.requireSignedIdentity]
 * @param {{verify: (token: string) => {ok: boolean, approver?: string, code?: string, reason?: string}}|null} [args.zafVerifier]
 * @returns {{ok:true, reader:string|null, verified:boolean}|{ok:false, status:number, code:string, reason:string}}
 */
export function resolveReader({ req, requireSignedIdentity = false, zafVerifier = null }) {
  if (!requireSignedIdentity) return { ok: true, reader: null, verified: false };
  const verdict = verifySignedIdentity({ req, zafVerifier, action: ACTION_READ });
  if (!verdict.ok) return verdict;
  return { ok: true, reader: verdict.identity, verified: true };
}

const ACTION_READ = {
  noun: "read customer-case data",
  missingToken:
    "This service requires a signed ZAF identity token on READS as well as writes, and none was " +
    "supplied. Send it as `Authorization: Bearer <token>` (what the sidebar's client.request() jwt " +
    "block sends) or in X-ZAF-Token. Reads are gated because these routes return an employment id, " +
    "the requester's email address and the full decision record — see src/shared/approverAuth.js.",
  notConfigured:
    "This service requires a signed ZAF identity token on reads, but no verifier is configured, so " +
    "no token can be checked and every read is refused. Set ZAF_SHARED_SECRET (the HS256 secret the " +
    "ZAF sidebar signs with). See src/review/zafAuth.js.",
};

const ACTION_WRITE = {
  noun: "change state",
  missingToken:
    "This service requires a signed ZAF identity token — as `Authorization: Bearer <token>` " +
    "(what the sidebar's client.request() jwt block sends) or in X-ZAF-Token — and none was supplied.",
  notConfigured:
    "This service requires a signed ZAF identity token, but no verifier is configured. See src/review/zafAuth.js.",
};

/**
 * The one signature check, shared by the read gate and the write gate.
 *
 * Extracted rather than copied because the two gates must agree about what a
 * valid token IS — which header carries it, which failures are fatal, and that
 * a missing verifier refuses rather than degrading. Two copies of that would
 * be two chances for the read half to quietly become the lenient one, which is
 * precisely the shape of the defect resolveReader() exists to fix.
 *
 * Only the prose differs between them, so only the prose is parameterised. The
 * failure CODES are identical on purpose: an operator debugging a 401 should
 * not have to learn a second vocabulary depending on the verb they used.
 */
function verifySignedIdentity({ req, zafVerifier, action }) {
  const token = extractSignedToken(req.headers);
  if (!token) {
    // BOTH FACTS, NOT JUST THE FIRST ONE TO FAIL.
    //
    // The order of these two checks is deliberate and stays: the CODE has to
    // remain `signed_identity_required` whenever no token arrived, because
    // that code is precisely what tells "this caller never signed" apart from
    // "this caller's signature did not verify" — the distinction §3.51 cost a
    // whole afternoon to establish and the sidebar now branches its advice on.
    //
    // But when no verifier is configured either, this function KNOWS a second
    // thing the caller has no way to learn: sending a token would not have
    // helped, because there is nothing here to check one with. Reporting only
    // the first failure sends an operator to re-upload the app when the fix is
    // an environment variable on the server. Two different afternoons of work,
    // and the fact separating them was being discarded one line before the
    // branch that holds it.
    //
    // It discloses no more than the deployment already does: any caller who
    // sends any string at all gets `signed_identity_not_configured` from the
    // next branch down. This says the same thing to a caller who sent nothing.
    const alsoUnconfigured = zafVerifier
      ? ""
      : " NOTE: this service also has no verifier configured right now, so no token would be accepted" +
        " either — sending one will not change the outcome until ZAF_SHARED_SECRET is set on the server.";
    return {
      ok: false,
      status: 401,
      code: "signed_identity_required",
      reason: action.missingToken + alsoUnconfigured,
    };
  }
  if (!zafVerifier) {
    return { ok: false, status: 401, code: "signed_identity_not_configured", reason: action.notConfigured };
  }
  const verdict = zafVerifier.verify(token);
  if (!verdict.ok) {
    return { ok: false, status: 401, code: verdict.code, reason: verdict.reason };
  }
  return { ok: true, identity: verdict.approver };
}

/**
 * The posture a DEPLOYED service runs in. Secure by default.
 *
 * This used to be `env.ZAF_REQUIRE_SIGNED_IDENTITY === "true"` — signed
 * identity only when someone remembered to ask for it — which is what kept
 * finding F-20 open after the mechanism above was built. The mechanism being
 * available is not the same as it being on, and an unconfigured deployment
 * trusting a name in the request body is the exact defect F-20 describes.
 *
 * Prime directive #3 ("identity comes from an authenticated signal, never a
 * claim") is the tiebreak against this repo's other convention, that optional
 * integrations degrade to a safe default rather than failing. Degrading is
 * right for a mock Remote server or an absent LLM key; it is wrong for
 * identity, where the degraded state is *believing whoever asks*. So the
 * unset case is now the strict one, and weakening it takes an explicit,
 * greppable `ZAF_ALLOW_UNSIGNED_IDENTITY=true`.
 *
 * Note this deliberately fails LOUDLY rather than silently: with no verifier
 * provisioned, every approve/decline is refused with `signed_identity_not_
 * configured`. A refused approval is recoverable in a minute by whoever is
 * deploying; an approval attributed to an attacker-supplied string is not
 * recoverable at all.
 *
 * THE DISCRIMINATOR IS PERSISTENCE, and picking it was the whole design
 * question. These APIs have no separate production entrypoint — `npm run
 * uc06-api` is both the demo and the deployment, so "is this a deployment?"
 * cannot be answered by which file started it. What actually separates the two
 * is whether a real store is attached: a CLI with a live Supabase pool is
 * recording decisions that outlive the process and attributing them to a named
 * human, while a CLI that seeded three invented amendments into memory and
 * printed "nothing is persisted" is not.
 *
 * Two rejected alternatives, for the record. A flat `return true` reads
 * stricter but makes `npm run uc06-api` refuse every approval on a fresh
 * clone, which this repo explicitly trades against ("clone and run in one
 * command"). A second function named `...ForDemo()` moves the weak default
 * rather than removing it, and leaves the strict path with no callers — dead
 * code that looks like a fix.
 *
 * @param {NodeJS.ProcessEnv} [env]
 * @param {object} [opts]
 * @param {boolean} [opts.persistent]  true when a real durable store is wired
 */
export function signedIdentityRequired(env = process.env, { persistent = true } = {}) {
  if (env.ZAF_REQUIRE_SIGNED_IDENTITY === "true") return true;
  if (env.ZAF_ALLOW_UNSIGNED_IDENTITY === "true") return false;
  return persistent;
}
