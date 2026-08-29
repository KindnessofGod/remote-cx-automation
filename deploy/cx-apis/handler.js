// ---------------------------------------------------------------------------
// handler.js  —  The serverless entry point for all nine review/approval APIs
// ---------------------------------------------------------------------------
// Read router.js first: it explains the one-function-nine-handlers choice and
// the URL shape. This file is the I/O half — environment, request/response
// plumbing, and the two things a serverless deployment has to do that a local
// `npm run ucNN-api` does not:
//
//   1. SAY ITS POSTURE OUT LOUD, AS DATA. The CLIs print a warning at startup
//      when signed identity is required but no verifier is configured. Nobody
//      watches a lambda start, so that warning would land in a log nobody
//      reads and the operator would first meet the problem as a bare 401 from
//      a button inside Zendesk. Instead the posture is served at
//      GET /__cx/health, and any write the missing verifier would refuse is
//      refused HERE with a body naming the missing environment variable and
//      where its value comes from. The refusal CODE is unchanged
//      (`signed_identity_not_configured`, from approverAuth.js) so there is
//      nothing new to learn — only the explanation is added.
//
//      This gate is strictly a REFUSAL. It fires only in the exact state where
//      the underlying handler would already refuse every write, so there is no
//      input for which it lets something through that the real gate would have
//      stopped. That ordering is the point: the missing ZAF key must not be
//      worked around, only explained.
//
//   2. SURVIVE A PRE-PARSED BODY. Vercel's Node runtime may populate
//      `req.body` and consume the underlying stream before the handler runs.
//      Every server in src/ reads its body with readJsonBody(req), which
//      listens for "data"/"end" — on an already-drained stream that resolves
//      to `{}`, so an approve would arrive with no role and no note and fail
//      for a reason having nothing to do with the request. See bodyShim().
//
// A TENTH THING IS MOUNTED HERE AND IT IS NOT A USE CASE. `/portal` serves the
// request portal (src/portal/) — the intake surface for the seven use cases
// Remote publishes no event API for. It is delegated whole, gate included, and
// it is gated by a DIFFERENT credential: a shared key, not a ZAF-signed
// identity, because the portal is not inside Zendesk and nothing mints a token
// for it. See router.js's PORTAL comment for why it is not a tenth USE_CASES
// row, and src/portal/access.js for what a shared key does and does not prove.
//
// Everything with an environment dependency is injectable (createCxHandler),
// so the whole deployment is exercisable with a fake pool, a fake verifier and
// no network — test/deployRouter.test.js. `export default` binds the real
// ones, and is what Vercel invokes.
// ---------------------------------------------------------------------------

import { Readable } from "node:stream";
import {
  USE_CASES,
  PORTAL,
  AUDIT_VIEW,
  QUEUE_VIEW,
  THIRD_PARTY_DOOR,
  resolveRoute,
  isMemoryOnlyList,
  serverlessListNotice,
  resolveAllowedOrigin,
} from "./router.js";
import {
  buildHandler,
  readPosture,
  uc02IdentityVerifier,
  buildPortalHandler,
  buildAuditViewHandler,
  buildApprovalQueueHandler,
  buildThirdPartyDoorHandler,
  portalPosture,
  llmPosture,
  PORTAL_BASE_PATH,
  AUDIT_BASE_PATH,
  QUEUE_BASE_PATH,
  THIRD_PARTY_BASE_PATH,
} from "./deps.js";
import { PER_ADDRESS_PER_HOUR, GLOBAL_PER_DAY } from "../../src/thirdparty/rateLimit.js";
import { readIntakeWindowMs, DEFAULT_INTAKE_WINDOW_MS } from "../../src/thirdparty/server.js";
import { getPgPool } from "../../src/shared/db.js";
import { buildZafVerifierFromEnv } from "../../src/shared/zafVerifierFromEnv.js";

/** Where a human goes to fix a configuration problem this file reports. */
const SETUP_DOC = "deploy/cx-apis/README.md in the repository";

function cors(res, allowedOrigin) {
  res.setHeader("Access-Control-Allow-Origin", allowedOrigin);
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-ZAF-Approver, X-ZAF-Token");
  res.setHeader("Vary", "Origin");
}

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body, null, 2));
}

/**
 * Give the real handler a request it can read the body from.
 *
 * Returns `req` itself when the stream is intact — the common and cheapest
 * case, and the one every local test already exercises. Only when the runtime
 * has already parsed the body does this build a stand-in: a fresh Readable
 * carrying the same bytes, with `url`, `method`, `headers` and `socket` copied
 * across, which is the entire surface the src/ handlers touch.
 *
 * readJsonBody's 64 KB cap still applies, because that cap is enforced on the
 * bytes it reads rather than on the socket.
 */
export function bodyShim(req, url) {
  if (req.body === undefined || req.body === null) {
    req.url = url;
    return req;
  }
  const raw = typeof req.body === "string" || Buffer.isBuffer(req.body) ? req.body : JSON.stringify(req.body);
  const bytes = Buffer.from(raw);
  const shim = Readable.from(bytes.length ? [bytes] : []);
  shim.url = url;
  shim.method = req.method;
  shim.headers = req.headers;
  shim.socket = req.socket;
  return shim;
}

/** The index page: what is deployed here and how to address it. */
function indexBody(posture, origin) {
  return {
    service: "remote-cx-automation — review/approval APIs",
    howToAddress:
      "Each use case is mounted under its own path prefix on this one host. Append that use " +
      "case's own routes to the prefix, e.g. /uc06/api/amendments/by-ticket/12345.",
    useCases: USE_CASES.map((u) => ({ prefix: "/" + u.prefix, label: u.label, hasWriteRoutes: u.writes })),
    surfaces: [
      { prefix: PORTAL_BASE_PATH, label: PORTAL.label, kind: "browser page + intake API" },
      { prefix: AUDIT_BASE_PATH, label: AUDIT_VIEW.label, kind: "browser page + read-only API" },
      { prefix: QUEUE_BASE_PATH, label: QUEUE_VIEW.label, kind: "browser page + read-only API" },
      {
        prefix: THIRD_PARTY_BASE_PATH,
        label: THIRD_PARTY_DOOR.label,
        kind: "browser page + unauthenticated intake API — no key, no ZAF token, by design",
      },
    ],
    posture,
    yourOrigin: origin || null,
    health: "/__cx/health",
  };
}

/**
 * Names the reason(s) a signed approver identity is being demanded, rather
 * than asserting one.
 *
 * `readPosture()` ORs two independent triggers together — a durable store
 * (the decision outlives the process, so it must name a human) and public
 * reachability (anyone can reach the URL, so a header is not a claim worth
 * trusting). Either alone is sufficient, and on Vercel with SUPABASE_DB_URL
 * unset it is the SECOND one firing while the first is false. Hard-coding
 * "a durable store is attached" here therefore printed a reason that was
 * flatly untrue of the live deployment — a health endpoint that misreports
 * WHY it is refusing sends the reader to fix the wrong thing.
 */
function whySignedIdentity(posture) {
  const reasons = [];
  if (posture.supabaseAttached) reasons.push("a durable store is attached");
  if (posture.publiclyReachable) reasons.push("this deployment is publicly reachable");
  // Neither flag set means an explicit ZAF_REQUIRE_SIGNED_IDENTITY=true.
  return reasons.length ? reasons.join(" and ") : "it was required explicitly";
}

/**
 * "Is the portal mounted, and is it gated?" — answerable without a request.
 *
 * `accessKeyRequired: false` on a publicly reachable deployment is the thing to
 * escalate here, exactly as `readsRequireSignedIdentity: false` is for the nine.
 */
function portalHealth(portal) {
  const usable = !portal.required || portal.keyConfigured;
  return {
    mounted: true,
    prefix: PORTAL_BASE_PATH,
    accessKeyRequired: portal.required,
    accessKeyConfigured: portal.keyConfigured,
    keyHeader: portal.header,
    whyRequired: portal.reasons,
    status: !portal.required
      ? "OPEN — no key is required here. That is correct only for a local, non-durable run; on a public " +
        "deployment it means anyone can submit requests that write audit rows."
      : usable
        ? "WORKING — a shared key is required and one is configured. The page asks for it once and keeps it " +
          "for the browser session."
        : `REFUSED BY DESIGN — a shared key is required here (${portal.reasons.join("; ")}) and ` +
          "PORTAL_ACCESS_KEY is not set, so every request under /portal/api is refused with " +
          `portal_access_key_not_configured. Set PORTAL_ACCESS_KEY and redeploy. See ${SETUP_DOC}.`,
    // Not gated, and deliberately: the page carries no data and no key, and
    // serving it is how an operator is told a key is needed at all.
    pageIsPublic: true,

    // THE ONE PIECE OF CONFIG THAT FAILS SILENTLY, REPORTED SO IT CANNOT.
    //
    // Every ticket the portal hands off carries the Remote employment id in a
    // Zendesk custom field, and all nine intake triggers condition on that
    // field being PRESENT. With ZENDESK_EMPLOYMENT_ID_FIELD_ID unset, the
    // portal omits `custom_fields` entirely: Zendesk returns 200, the ticket
    // is created, correctly tagged, correctly grouped — and can never drive a
    // workflow, and never tells the specialist which employment it concerns.
    //
    // Nothing errored anywhere. It went unnoticed from 2026-08-18 until
    // 2026-08-27, and it was found only by raising a real request and reading
    // the ticket back, because the value was invisible from outside. That is
    // the gap this field closes. The id is not a secret — it is a Zendesk
    // field identifier, already in this repository and in its public tree.
    //
    // `configured: false` is the loud case; do not soften the wording.
    employmentIdField: {
      configured: Boolean(portal.employmentIdFieldId),
      id: portal.employmentIdFieldId ?? null,
      whyItMatters:
        "Every hand-off ticket carries the Remote employment id in this Zendesk custom field, and all " +
        "nine intake triggers require it to be present.",
      status: portal.employmentIdFieldId
        ? "SET — hand-off tickets will carry the employment id. Confirm the id EXISTS on the Zendesk " +
          "account (a nonexistent id is discarded silently, exactly like an unset one)."
        : "NOT SET — every hand-off ticket is created without an employment id. No error is raised " +
          "anywhere: Zendesk returns 200, the ticket looks correct, and no workflow can ever fire on " +
          "it. Set ZENDESK_EMPLOYMENT_ID_FIELD_ID and redeploy.",
    },
  };
}

/**
 * "Is the audit viewer mounted, gated, and does it have anything to read?"
 *
 * Same shared-key posture as the portal (one key, two surfaces), plus the one
 * question the portal block cannot answer for it: whether a durable store is
 * attached. With none, the viewer's API answers 503 no_durable_store on every
 * read — it never serves demo rows on a public URL (deps.js's
 * buildAuditViewHandler explains why).
 */
function auditViewHealth(portal, pgPool) {
  const usable = !portal.required || portal.keyConfigured;
  return {
    mounted: true,
    prefix: AUDIT_BASE_PATH,
    readOnly: true, // structural: src/auditview/server.js has no POST route
    durableStoreAttached: Boolean(pgPool),
    accessKeyRequired: portal.required,
    accessKeyConfigured: portal.keyConfigured,
    keyHeader: portal.header,
    status: !portal.required
      ? "OPEN — no key is required here. Correct only for a local, non-durable run; this surface serves " +
        "real audit rows (employment ids, actors, full decision records)."
      : usable
        ? pgPool
          ? "WORKING — a shared key is required and configured, and Supabase is attached, so reads return real rows."
          : "KEY OK, NO DATA — the key gate works, but SUPABASE_DB_URL is unset, so every read answers 503 " +
            "no_durable_store. Set it in the Vercel project."
        : `REFUSED BY DESIGN — a shared key is required here (${portal.reasons.join("; ")}) and ` +
          "PORTAL_ACCESS_KEY is not set, so every request under /audit/api is refused. It is the same key as " +
          `the portal's — setting it once opens both. See ${SETUP_DOC}.`,
    pageIsPublic: true,
  };
}

/**
 * "Is the third-party door mounted, and can it actually reach a real
 * employment record?" — answerable without a request, and without ever
 * telling this endpoint's own caller anything the door itself would refuse
 * to tell a third party.
 *
 * DELIBERATELY NO `accessKeyRequired`/`accessKeyConfigured` FIELDS. Those
 * exist on portalHealth()/auditViewHealth() because those two surfaces ARE
 * gated. This one is not, and reporting `accessKeyRequired: false` here would
 * read exactly like the pre-fix data-exposure bug this file's own header
 * warns about, when it is in fact the correct, load-bearing posture for
 * VC-06/VC-07/VC-08/VC-33 — see router.js's THIRD_PARTY_DOOR comment.
 *
 * `remoteReachable` is reported because it is the one thing that changes
 * whether a submission through this door produces a real case/consent row: an
 * unconfigured REMOTE_API_TOKEN still returns the identical acknowledgement
 * (VC-33 requires that), but nothing durable is written behind it.
 */
function thirdPartyDoorHealth(posture) {
  // The door is open by design; the question this block has to answer is
  // whether the CEILING on it is real. An in-memory counter on a serverless
  // deployment is not a ceiling — each invocation is a fresh process, so it
  // starts at zero every time. "Built" and "provisioned" are two claims, the
  // same lesson the approver-entitlement row here already records, so the
  // STORE IN USE is reported rather than the fact that a limiter exists.
  const durableCeiling = posture.supabaseAttached;
  return {
    mounted: true,
    prefix: THIRD_PARTY_BASE_PATH,
    gated: false,
    // THE EFFECTIVE WINDOW, not the shipped default.
    //
    // Reported because it was un-observable and that turned out to matter. The
    // window was lowered to 20s for a demo and restored in code on
    // 2026-08-29 — but THIRD_PARTY_INTAKE_WINDOW_MS overrides the default, and
    // nothing on this endpoint said which value was actually in force. So the
    // restore could not be verified from outside: an env var left set on the
    // project would have made it cosmetic, silently. Same class as the
    // approver-entitlement row below, which this endpoint had to learn once
    // already — reporting that a control EXISTS is not reporting that it is
    // IN EFFECT.
    intakeDeduplication: {
      windowMs: readIntakeWindowMs(process.env),
      shippedDefaultMs: DEFAULT_INTAKE_WINDOW_MS,
      overriddenByEnv: readIntakeWindowMs(process.env) !== DEFAULT_INTAKE_WINDOW_MS,
      status:
        readIntakeWindowMs(process.env) === 0
          ? "DISABLED — every submission is treated as new, so one enquirer who submits twice can send a real employee two consent requests for one disclosure."
          : readIntakeWindowMs(process.env) < 50800
            ? "TOO SHORT — the duplicate this window absorbs was measured at 50.8s apart, and this window does not cover it."
            : "IN EFFECT — a repeat of the same enquiry inside this window is joined to the first rather than filed again.",
    },
    rateLimit: {
      perAddressPerHour: PER_ADDRESS_PER_HOUR,
      globalPerDay: GLOBAL_PER_DAY,
      store: durableCeiling ? "postgres" : "memory",
      effective: durableCeiling,
      failsClosed: true,
      status: durableCeiling
        ? "ENFORCED — counted in Postgres, so the ceiling holds across invocations. " +
          "A counter that cannot be read refuses rather than allows."
        : "NOT EFFECTIVE — no durable store is attached, so the limiter is counting in memory and " +
          "every invocation starts at zero. On a publicly reachable deployment that is no ceiling " +
          "at all. Set SUPABASE_DB_URL.",
    },
    remoteReachable: posture.remoteConfigured,
    status: posture.remoteConfigured
      ? "OPEN BY DESIGN — no key, no ZAF token. A submission runs the real workflow against the live " +
        "Remote record and every outcome (real employee, declined, nonexistent, internal error) returns " +
        "the identical acknowledgement — VC-33. This is the intended posture, not a gap."
      : "OPEN BY DESIGN, BUT REMOTE_API_TOKEN IS UNSET — a submission still returns the identical " +
        "acknowledgement (VC-33 is unaffected), but no case or consent_records row is written behind it, " +
        "so nothing durable exists for the evaluator to read back. Set REMOTE_BASE_URL/REMOTE_API_TOKEN.",
    pageIsPublic: true,
  };
}

/**
 * "Is free text on this deployment read by a model, or matched against
 * keywords?" — the question this endpoint could not answer at all.
 *
 * IT WAS ASKED IN ANGER. A user of the deployed system concluded "you were not
 * using any form of LLM in this entire system... all the outputs were
 * predetermined." That happened to be false — the UC-03 classifier was calling
 * OpenAI and returning `source: "llm"` — but every surface a person can reach
 * was silent on it, and a claim nobody can check is worth the same as a claim
 * that is wrong. Everything else this deployment depends on is stated here as
 * data; the one thing the whole system is judged on was not.
 *
 * IT IS ALSO A REAL POSTURE, not a nicety. portalLlmDefaults() swaps four named
 * rule-based classifiers in whenever no key is configured (src/portal/
 * wiring.js), so the same URL either interprets a sentence or matches keywords
 * in it, decided by an environment variable and indistinguishable from outside.
 * That is the same "built vs. provisioned" gap this file already reports for
 * the ZAF verifier and the entitlement roster.
 *
 * THE SEAM LIST IS EVIDENCE, NOT PROSE: it is read out of what
 * portalLlmDefaults() actually returned, so it is empty exactly when the real
 * OpenAI path runs, and names the substitute functions when it does not.
 *
 * No secret is read or reported — a boolean and a model NAME, nothing else.
 */
function llmHealth(llm) {
  const seams = llm.ruleBasedSeams.map((s) => `${s.seam} -> ${s.fallback}()`);
  return {
    configured: llm.configured,
    model: llm.model,
    freeTextInterpretedBy: llm.freeTextInterpretedBy,
    ruleBasedSeams: llm.ruleBasedSeams,
    status: llm.configured
      ? `WORKING — an OpenAI key is configured, so free-text requests really are read by a model ` +
        `(${llm.model}). A classifier's own output records which path answered it: \`source: "llm"\` when ` +
        `the model did, \`source: "rule_based_fallback"\` when a call failed and the rules caught it. ` +
        `Deterministic code still makes every decision — the model only reads the request.`
      : `RULE-BASED — OPENAI_API_KEY is not set on this deployment, so no model is called and nothing ` +
        `here is an LLM output. The portal's ${llm.ruleBasedSeams.length} classification seams are ` +
        `substituted with named keyword functions (${seams.join(", ")}), so a free-text request is ` +
        `matched, not read: a phrasing the keywords miss is escalated rather than understood. Set ` +
        `OPENAI_API_KEY in the Vercel project to change this. Gates and decisions are unaffected either ` +
        `way — an LLM never decides anything here.`,
  };
}

/**
 * The one place that answers "is this deployment actually usable, and for
 * what?" — written to be read by someone who has never deployed anything.
 */
function healthBody(posture, origin, verifierBuilt, portal, pgPool, llm) {
  const writesWork = verifierBuilt || !posture.signedIdentityRequired;
  // Two independent questions about reads, and conflating them is what let the
  // breach hide: "is there data to read?" (Supabase) and "may anyone read it?"
  // (the signed-identity gate). The old body answered only the first, so a
  // deployment serving employment ids and requester email addresses to the open
  // internet reported `reads: "WORKING"` and nothing contradicted it.
  const readsGated = posture.signedIdentityRequired;
  const readsUsable = !readsGated || verifierBuilt;
  return {
    ok: true,
    reads: !readsUsable
      ? `REFUSED BY DESIGN — a signed ZAF identity is required on reads here (${whySignedIdentity(posture)}) ` +
        "and no ZAF verifier is configured, so every GET under a use-case prefix returns 401 " +
        "signed_identity_not_configured until ZAF_SHARED_SECRET is set. These routes disclose an " +
        "employment id, the requester's email address and the full decision record, so an open read " +
        `is a data-exposure issue, not a convenience. See ${SETUP_DOC}.`
      : posture.supabaseAttached
        ? "WORKING — Supabase is attached, so every GET route reads real rows."
        : "NOT WORKING — SUPABASE_DB_URL is unset, so every read comes back empty. Set it in the Vercel project.",
    // The one-word answer to "are reads protected?", answerable without making
    // a request. `false` on a publicly reachable deployment is the breach.
    readsRequireSignedIdentity: readsGated,
    writes: writesWork
      ? "WORKING — approve/deny will be accepted (subject to each use case's own policy gates)."
      : `REFUSED BY DESIGN — signed approver identity is required here (${whySignedIdentity(posture)}) ` +
        "and no ZAF verifier is configured, so every approve/deny returns 401 " +
        "signed_identity_not_configured until ZAF_SHARED_SECRET is set (the HS256 secret the " +
        "sidebar signs with — the same value as the app's `cxSharedSecret` secure setting). This is the correct " +
        "behaviour, not a bug: an approval attributed to an unverified name would make the audit " +
        `log's attribution worthless. See ${SETUP_DOC}.`,
    // The portal is a SECOND surface with a SECOND credential, so "is the
    // deployment gated?" has two answers and neither implies the other. It is
    // reported here — rather than left to be discovered by making a request —
    // for the reason this whole file exists: nobody watches a lambda boot, and
    // an ungated intake page would look identical from outside to a gated one
    // until somebody submitted something.
    portal: portalHealth(portal),
    // A THIRD surface, same second credential as the portal. Reported for the
    // same reason: an ungated audit viewer would look identical from outside
    // to a gated one until somebody read a decision record off it.
    auditView: auditViewHealth(portal, pgPool),
    // A FOURTH surface, and the one with the OPPOSITE gate from the other
    // three: reported so "mounted and open" is visible as the deliberate
    // posture it is, not discovered by someone finding it unlocked.
    thirdPartyDoor: thirdPartyDoorHealth(posture),
    // A FIFTH question, and the one nothing here used to answer: does this
    // deployment interpret free text with a model at all? See llmHealth().
    llm: llmHealth(llm),
    posture: { ...posture, zafVerifierBuilt: verifierBuilt },
    // Echoed so the exact value for ZAF_ALLOWED_ORIGIN can be READ off a real
    // request from the sidebar rather than guessed from the account subdomain.
    yourOrigin: origin || null,
    effectiveAllowedOrigin: resolveAllowedOrigin(posture.allowedOriginSetting, origin),
    runtime: { node: process.version },
  };
}

/**
 * The explained refusal described in this file's header.
 *
 * `kind` is "write" or "read". Reads were added because gating them was the
 * fix for a live data-exposure issue: every GET route here returned an
 * employment id, the requester's real email address and the whole decision
 * record to an unauthenticated caller, over sequential integer ticket ids. The
 * refusal body has to be as legible for that case as for a refused approval —
 * a bare 401 on a read reads like a broken deployment, and the next thing that
 * happens is somebody "fixes" it by taking the gate back off.
 */
function unconfiguredVerifierBody(prefix, posture, kind = "write") {
  const isRead = kind === "read";
  return {
    ok: false,
    code: "signed_identity_not_configured",
    reason: isRead
      ? "This request would disclose customer-case data, and this deployment requires a " +
        "cryptographically signed ZAF identity before it will do that. No ZAF verifier is " +
        "configured, so it is refused. Nothing is wrong with your request."
      : "This request would change state, and this deployment requires a cryptographically signed " +
        "approver identity before it will do that. No ZAF verifier is configured, so it is refused. " +
        "Nothing is wrong with your request.",
    // Derived, never asserted. This sentence used to hard-code "A durable
    // Supabase store is attached" — the same defect whySignedIdentity() was
    // written to fix for /__cx/health, surviving one function away because the
    // two were fixed on different days. On the live deployment that claim was
    // false: SUPABASE_DB_URL was unset and it was public reachability doing
    // the work, so the refusal sent the reader to inspect a database that was
    // not there.
    why: isRead
      ? `Signed identity is required here because ${whySignedIdentity(posture)}. A read of these routes ` +
        "returns an employment id, the requester's real email address, the decision and its flags — " +
        "and ticket ids are sequential integers, so an open read is an enumerable export of the whole " +
        "corpus, not a single lookup."
      : `Signed identity is required here because ${whySignedIdentity(posture)}. A decision recorded ` +
        "here is durable and names a human in the audit log, and the service will not attribute that " +
        "to an unverified header.",
    howToFix: [
      "Generate one long random string — this is the shared secret. It is not fetched from Zendesk; you choose it.",
      "Install the ZAF app (zaf-app/) into the Zendesk account and paste the secret into its secure setting `cxSharedSecret`.",
      "Add the SAME value to this Vercel project as the environment variable ZAF_SHARED_SECRET, then redeploy.",
      "Do NOT also set ZAF_APP_PUBLIC_KEY_PEM/ZAF_APP_ID — those are the RS256 server-side-app mechanism, " +
        "and setting both is refused rather than silently resolved (src/shared/zafVerifierFromEnv.js).",
      `Full instructions: ${SETUP_DOC}.`,
    ],
    // This used to read "Every GET route under /${prefix} works right now
    // without this." It was accurate, and it was describing the defect: reads
    // were open because only writes were gated. One variable now unblocks both.
    scope: `Both reads and writes under /${prefix} need this. Setting ZAF_SHARED_SECRET restores both.`,
    checkPosture: "/__cx/health",
  };
}

/**
 * Build the deployment's request handler.
 *
 * @param {object} [deps]
 * @param {() => import("pg").Pool|null} [deps.getPool]
 * @param {NodeJS.ProcessEnv} [deps.env]
 * @param {() => Promise<{verify:Function}|null>} [deps.buildVerifier]
 * @param {typeof buildHandler} [deps.build]
 * @param {typeof llmPosture} [deps.llm]  test seam; defaults to the real
 *   isLlmConfigured()/portalLlmDefaults() pair the portal handler is wired
 *   from. Injectable so both postures are testable without an OPENAI_API_KEY
 *   deciding which one a test happens to see.
 */
export function createCxHandler({
  getPool = getPgPool,
  env = process.env,
  // `env` is threaded in (rather than letting the builder reach for
  // process.env) so the posture and the verifier are always read off the SAME
  // environment — a test that injects one and not the other proves nothing.
  buildVerifier = () => buildZafVerifierFromEnv("cx-apis", env),
  build = buildHandler,
  buildPortal = buildPortalHandler,
  buildAudit = buildAuditViewHandler,
  buildQueueView = buildApprovalQueueHandler,
  buildThirdPartyDoor = buildThirdPartyDoorHandler,
  llm = llmPosture,
} = {}) {
  // Cached as a PROMISE, not a value, so two concurrent requests on a warm
  // instance share one build instead of racing — the ZAF_APP_ID path makes a
  // network call.
  let verifierPromise = null;
  const verifier = () => (verifierPromise ??= Promise.resolve(buildVerifier()));

  return async function cxHandler(req, res) {
    const pgPool = getPool();
    const posture = readPosture(env, { pgPool });
    const origin = req.headers?.origin || null;
    const allowedOrigin = resolveAllowedOrigin(posture.allowedOriginSetting, origin);
    const route = resolveRoute(req.url || "/");

    // Preflight is answered here for meta/unknown paths; a use-case handler
    // answers its own (identically) once the request reaches it.
    //
    // The PORTAL is excluded from every CORS header on this deployment, which
    // is a decision rather than an omission. The sidebar is a cross-origin
    // caller by construction (it runs on Zendesk's domain), so the nine must
    // send CORS; the portal's only client is its own page on this same origin.
    // Sending no Access-Control-Allow-Origin means a preflight for the
    // x-portal-key header fails and another site's script cannot drive the
    // intake API from a visitor's browser. It protects nothing on its own —
    // the key is still the gate, and curl ignores CORS entirely — but there is
    // no reason to hand out a permission nothing needs.
    if (req.method === "OPTIONS" && (route.kind === "meta" || route.kind === "unknown")) {
      cors(res, allowedOrigin);
      res.statusCode = 204;
      return res.end();
    }

    if (route.kind === "meta") {
      cors(res, allowedOrigin);
      if (route.route === "/healthz") return send(res, 200, { ok: true });
      if (route.route === "/__cx/health") {
        return send(
          res,
          200,
          healthBody(posture, origin, Boolean(await verifier()), portalPosture(env, { pgPool }), pgPool, llm())
        );
      }
      return send(res, 200, indexBody(posture, origin));
    }

    // ---- the request portal (src/portal/) ----
    //
    // Delegated whole, gate included. The shared-key check lives in the portal
    // itself (src/portal/access.js), not here, for the reason router.js gives
    // for keeping it out of USE_CASES: `npm run portal` and this deployment
    // must apply ONE rule, and a copy of it in this file would be a second
    // one to keep in step. What this file contributes is the posture — the
    // pool and the environment it is computed from — which is exactly the part
    // a serverless deployment knows and the CLI cannot.
    if (route.kind === "portal") {
      const access = portalPosture(env, { pgPool });
      const portalHandler = buildPortal({ pgPool, env, access });
      try {
        return await portalHandler(bodyShim(req, route.url), res);
      } catch (err) {
        console.error(`[cx-apis] ${req.method} ${route.path} failed: ${err.stack}`);
        if (res.headersSent) return;
        return send(res, 500, { ok: false, code: "internal_error", reason: err.message, path: route.path });
      }
    }

    // ---- the audit trail viewer (src/auditview/) ----
    //
    // Delegated whole, gate included, exactly like the portal above and for
    // the same reason: `npm run audit-ui` and this deployment must apply ONE
    // access rule, and a copy of it here would be a second one to keep in
    // step. GET-only by construction — the delegated server has no POST route.
    if (route.kind === "audit") {
      const access = portalPosture(env, { pgPool });
      const auditHandler = buildAudit({ pgPool, env, access });
      try {
        return await auditHandler(bodyShim(req, route.url), res);
      } catch (err) {
        console.error(`[cx-apis] ${req.method} ${route.path} failed: ${err.stack}`);
        if (res.headersSent) return;
        return send(res, 500, { ok: false, code: "internal_error", reason: err.message, path: route.path });
      }
    }

    // ---- the approval queue (src/approvalqueue/) ----
    //
    // Delegated whole, gate included, exactly like the portal and the audit
    // viewer above and for the same reason: one access rule, in one place.
    // GET-only by construction — the delegated server has no POST route.
    if (route.kind === "queue") {
      const access = portalPosture(env, { pgPool });
      const queueHandler = buildQueueView({ pgPool, env, access });
      try {
        return await queueHandler(bodyShim(req, route.url), res);
      } catch (err) {
        console.error(`[cx-apis] ${req.method} ${route.path} failed: ${err.stack}`);
        if (res.headersSent) return;
        return send(res, 500, { ok: false, code: "internal_error", reason: err.message, path: route.path });
      }
    }

    // ---- the third-party consent door (src/thirdparty/) ----
    //
    // Delegated whole, and DELIBERATELY carries no access gate at all — see
    // router.js's THIRD_PARTY_DOOR comment and thirdPartyDoorHealth() above.
    // Every credential mechanism this file has (the ZAF verifier, the
    // portal's shared key) exists to attribute an action to a known human or
    // agent; this route exists precisely for a caller who is neither, and
    // gating it would make VC-06/VC-07/VC-08/VC-33 unrunnable from outside.
    if (route.kind === "thirdparty") {
      const doorHandler = buildThirdPartyDoor({ pgPool, env });
      try {
        return await doorHandler(bodyShim(req, route.url), res);
      } catch (err) {
        console.error(`[cx-apis] ${req.method} ${route.path} failed: ${err.stack}`);
        if (res.headersSent) return;
        return send(res, 500, { ok: false, code: "internal_error", reason: err.message, path: route.path });
      }
    }

    if (route.kind === "unknown") {
      cors(res, allowedOrigin);
      return send(res, 404, {
        ok: false,
        code: "no_such_use_case",
        reason:
          `"${route.path}" does not start with a known prefix. Every route on this deployment is ` +
          `mounted under one — the nine use-case APIs, ${PORTAL_BASE_PATH} for the request portal, ` +
          `${AUDIT_BASE_PATH} for the audit trail viewer, ${QUEUE_BASE_PATH} for the approval queue, or ` +
          `${THIRD_PARTY_BASE_PATH} for the third-party consent door.`,
        path: route.path,
        knownPrefixes: [
          ...USE_CASES.map((u) => "/" + u.prefix),
          PORTAL_BASE_PATH,
          AUDIT_BASE_PATH,
          QUEUE_BASE_PATH,
          THIRD_PARTY_BASE_PATH,
        ],
        hint: "GET / lists them with their labels.",
      });
    }

    // ---- a real use case from here on ----

    if (isMemoryOnlyList(route, req.method)) {
      cors(res, allowedOrigin);
      return send(res, 501, serverlessListNotice(route));
    }

    // Built only for a request that could actually consult it.
    //
    // This used to be `req.method === "POST"`, on the reasoning that no GET
    // route reaches resolveApprover(). That was true and it was the bug: reads
    // consulted no verifier because reads were not gated at all, so every GET
    // route served an employment id and the requester's email address to
    // anyone. Reads are now gated by the same posture flag as writes
    // (src/shared/approverAuth.js's resolveReader), so a read needs the
    // verifier exactly when that flag is set.
    //
    // The optimisation the old condition was protecting still holds where it
    // mattered — the ZAF_APP_ID form makes a network call to Zendesk, and in
    // the unsigned local posture a read still builds nothing.
    const zafVerifier = req.method === "POST" || posture.signedIdentityRequired ? await verifier() : null;

    // The explained refusal. Strictly narrower than what the handler would do
    // on its own: it fires only where the request is already refused downstream
    // — the use-case handler returns the same `signed_identity_not_configured`
    // code, just without the paragraph naming the missing variable.
    if (req.method === "POST") {
      const uc02Blocked = route.prefix === "uc02" && !uc02IdentityVerifier(env);
      const approvalBlocked =
        route.useCase.writes && route.prefix !== "uc02" && posture.signedIdentityRequired && !zafVerifier;
      if (uc02Blocked || approvalBlocked) {
        cors(res, allowedOrigin);
        return send(res, 401, unconfiguredVerifierBody(route.prefix, posture));
      }
    } else if (
      req.method === "GET" &&
      posture.signedIdentityRequired &&
      !zafVerifier &&
      // A per-use-case liveness probe (`/uc06/healthz`) carries no customer
      // data and is how an operator establishes the function is answering at
      // all. Each use-case handler exempts it for the same reason; exempting
      // it here too keeps the two gates saying the same thing. The
      // deployment-level meta routes (/, /healthz, /__cx/health,
      // /__cx/routes) never reach this branch — they return in the `meta`
      // block above.
      route.innerPath !== "/healthz"
    ) {
      // Applies to all nine, including the three with no write route: uc03,
      // uc07 and uc08 hold case records and dossiers, which is exactly the
      // material a public read must not hand over. "It has no POST route" was
      // never a reason its GET routes were safe to publish.
      cors(res, allowedOrigin);
      return send(res, 401, unconfiguredVerifierBody(route.prefix, posture, "read"));
    }

    const useCaseHandler = build(route.prefix, {
      pgPool,
      allowedOrigin,
      verifier: zafVerifier,
      requireSignedIdentity: posture.signedIdentityRequired,
      env,
    });

    try {
      return await useCaseHandler(bodyShim(req, route.url), res);
    } catch (err) {
      // A throw that escaped a use-case handler's own try/catch — dependency
      // construction, or the unavailableRemote() stand-in. Reported with its
      // message intact, because the message IS the instruction.
      console.error(`[cx-apis] ${req.method} ${route.path} failed: ${err.stack}`);
      if (res.headersSent) return;
      cors(res, allowedOrigin);
      return send(res, 500, { ok: false, code: "internal_error", reason: err.message, path: route.path });
    }
  };
}

/** What Vercel invokes. */
export default createCxHandler();
