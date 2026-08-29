// ---------------------------------------------------------------------------
// deps.js  —  What each use case's handler is given, in a serverless process
// ---------------------------------------------------------------------------
// WHY THIS IS DIFFERENT FROM THE ucNN CLIs
// Every `src/ucNN/cli.js` does three things this deployment must not:
//
//   1. It starts an in-process MOCK REMOTE SERVER on a second socket and seeds
//      itself through it. A serverless function cannot listen on a socket, and
//      even if it could, seeding on every cold start would insert duplicate
//      rows into Supabase and (for the LLM-backed use cases) bill an OpenAI
//      call per cold start. So there is NO seeding and NO mock here — see
//      unavailableRemote() below for what replaces it, and why it refuses
//      loudly rather than quietly pointing at a localhost port that cannot
//      exist in a function.
//
//      ONE EXCEPTION, ADDED WITH THE PORTAL AND WORTH READING BEFORE YOU
//      "CORRECT" IT: buildPortalHandler() at the bottom of this file DOES give
//      the request portal a mock Remote — not on a socket, but by injecting a
//      transport that dispatches straight into the mock's route table
//      (createInProcessFetch(), src/remote/mockServer.js). That is the portal
//      keeping the promise it prints locally ("the portal never touches a real
//      Remote account"), and the alternative is worse in both directions: its
//      personas are mock fixture ids, so a real Sandbox would 404 every one of
//      them, and a public page would be writing into a real account.
//
//      THAT PARAGRAPH USED TO END "The nine APIs are unchanged — they still
//      get remoteClient()/unavailableRemote()." That sentence was the bug, and
//      it cost a live 404 on 2026-08-19:
//
//        PATCH /v1/expenses/exp_sandbox_over_cap_402~fresh-0425041sf1 -> 404
//
//      The portal DECIDES in the mock world; a submission that needs a human
//      is EXECUTED later by one of those nine APIs, against the real gateway,
//      using an id that only ever existed in the mock. The two halves were
//      each correct in isolation and only the join was wrong — the same shape
//      of defect as the un-pooled ExpenseStore recorded a few lines below.
//      buildHandler() now gives every use case a SOURCE-AWARE client
//      (sourceAwareRemote() below): the real client for ordinary records, the
//      in-process mock for portal-originated ones, chosen per RECORD at
//      execution time from the row's own durable `source` column.

//   2. It keeps ONE store for the process lifetime. Here a store is built
//      PER REQUEST. That is not just harmless — it is required for
//      correctness. Every store checks its local in-memory array BEFORE
//      Postgres (`findByExternalRef` in amendmentStore.js et al), which is
//      right for a single long-lived process that created the row itself, and
//      wrong for a warm lambda that might still be holding a row from a
//      DIFFERENT ticket's request. A fresh store per request makes Supabase
//      unambiguously the source of truth.
//   3. It prints its security posture once at startup, where a human is
//      watching. Nobody watches a lambda boot, so the posture is exposed as
//      data instead — see handler.js.
//
// The pg Pool is the one thing that is SHARED: getPgPool() is already a
// module-level singleton, so a warm invocation reuses established connections
// instead of opening a new one per request. It is passed in rather than read
// here, so the whole deployment can be exercised with a fake pool and no
// network — the same dependency-injection discipline the src/ handlers use.
// ---------------------------------------------------------------------------

import { config, isZendeskConfigured } from "../../src/shared/config.js";
import { signedIdentityRequired } from "../../src/shared/approverAuth.js";
import { resolveEntitlement } from "../../src/review/approverEntitlement.js";
import { normalizePemFromEnv } from "../../src/shared/zafVerifierFromEnv.js";
import { createZafVerifier } from "../../src/review/zafAuth.js";
import { RemoteClient } from "../../src/remote/restClient.js";
import { ZendeskClient } from "../../src/zendesk/restClient.js";

import { AuditLogger } from "../../src/shared/audit.js";
import { CaseStore } from "../../src/shared/caseStore.js";
import { PostgresReviewStore, InMemoryReviewStore } from "../../src/review/store.js";
import { ExpenseStore } from "../../src/uc02/expenseStore.js";
import { AuthorizationStore } from "../../src/uc04/authorizationStore.js";
import { ResignationStore } from "../../src/uc05/resignationStore.js";
import { AmendmentStore } from "../../src/uc06/amendmentStore.js";
import { DossierStore as Uc07DossierStore } from "../../src/uc07/dossierStore.js";
import { DossierStore as Uc08DossierStore } from "../../src/uc08/dossierStore.js";
import { AdjustmentStore } from "../../src/uc09/adjustmentStore.js";

import { createReviewHandler } from "../../src/review/server.js";
import { createUc02Handler, UC02_IDENTITY_CLAIM_PATHS } from "../../src/uc02/server.js";
import { createUc03Handler } from "../../src/uc03/server.js";
import { createUc04Handler } from "../../src/uc04/server.js";
import { createUc05Handler } from "../../src/uc05/server.js";
import { createUc06Handler } from "../../src/uc06/server.js";
import { createUc07Handler } from "../../src/uc07/server.js";
import { createUc08Handler } from "../../src/uc08/server.js";
import { createUc09Handler } from "../../src/uc09/server.js";

import { createPortalHandler, PORTAL_SOURCE } from "../../src/portal/server.js";
import { createThirdPartyDoorHandler } from "../../src/thirdparty/server.js";
import { createPortalThrottleStore } from "../../src/portal/access.js";
import { createPgRateLimitStore, PER_ADDRESS_PER_HOUR, GLOBAL_PER_DAY } from "../../src/thirdparty/rateLimit.js";
import { KNOWN_EMPLOYEES } from "../../src/livedemo/employees.js";
import { createAuditViewHandler } from "../../src/auditview/server.js";
import { createApprovalQueueHandler } from "../../src/approvalqueue/server.js";
import { ApprovalQueueStore } from "../../src/approvalqueue/queueStore.js";
import { TicketFacts } from "../../src/approvalqueue/ticketFacts.js";
import { AuditReadStore } from "../../src/auditview/readStore.js";
import { buildPortalStores, portalLlmDefaults } from "../../src/portal/wiring.js";
import { isLlmConfigured } from "../../src/shared/llm.js";
import { portalAccessPosture } from "../../src/portal/access.js";
import { createInProcessFetch } from "../../src/remote/mockServer.js";

/**
 * A Remote client that cannot be used, and says why.
 *
 * The CLIs fall back to a mock Remote server when REMOTE_API_TOKEN is unset.
 * There is no such fallback in a function, and the naive alternative — a
 * RemoteClient left pointing at config.js's `http://localhost:4010` default —
 * would stall until the request timed out and then report a connection error,
 * which reads like a broken deployment rather than a missing setting.
 *
 * A Proxy is used instead of enumerating RemoteClient's methods, so this can
 * never drift out of step with the real client's surface: ANY property access
 * yields a function that throws one clear, greppable message.
 *
 * Only the approve/execute paths need Remote at all (an approval re-reads the
 * employment record first — "is this still true?"), so every read-only route
 * is unaffected by this being unconfigured.
 */
export function unavailableRemote() {
  const fail = (method) => () => {
    throw new Error(
      `remote_api_not_configured: RemoteClient.${String(method)}() was called, but this deployment ` +
        `has REMOTE_API_TOKEN unset and a serverless function has no in-process mock Remote server. ` +
        `Set REMOTE_BASE_URL and REMOTE_API_TOKEN in the Vercel project's Environment Variables. ` +
        `Read-only routes do not need them; approve/deny does, because it re-reads the employment record.`
    );
  };
  return new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === "then") return undefined; // must never look like a thenable
        return fail(prop);
      },
    }
  );
}

/** The real Remote client when configured, the explicit-failure stand-in otherwise. */
export function remoteClient() {
  if (!config.remote.token) return unavailableRemote();
  return new RemoteClient({ baseUrl: config.remote.baseUrl, token: config.remote.token });
}

/**
 * A base URL for the in-process mock. The host is never resolved — the
 * injected transport dispatches straight into the mock's route table — but
 * RemoteClient builds absolute URLs, and `.invalid` is the reserved TLD that
 * guarantees a mistake here becomes a DNS failure rather than a request to
 * somebody's server.
 *
 * Declared up here, beside remoteClient(), because it now has TWO readers: the
 * portal (which is always the mock) and sourceAwareRemote() (which is the mock
 * only for portal-originated records).
 */
const MOCK_BASE_URL = "http://mock.remote.invalid";

/** A RemoteClient whose transport dispatches into src/remote/mockServer.js. */
export function mockRemoteClient() {
  return new RemoteClient({ baseUrl: MOCK_BASE_URL, fetchImpl: createInProcessFetch() });
}

/**
 * The Remote client the nine APIs are given: the real one, plus the ability to
 * answer "which client belongs to a record from THIS source?".
 *
 * WHY THIS EXISTS — see the "ONE EXCEPTION" block at the top of this file. The
 * portal decides in the mock world and the review APIs executed in the real
 * one, so a portal-originated claim addressed a sub-record id (`exp_*`,
 * `war_*`) the real Sandbox has never heard of and 404'd on every release.
 *
 * THE SHAPE IS ADDITIVE, NEVER A REPLACEMENT. The returned object IS the
 * default client for every existing purpose — a Proxy so it can never drift
 * out of step with RemoteClient's surface, the same reasoning
 * unavailableRemote() uses — and merely GAINS `forSource(source)`. Every
 * current caller, every test fake and every `remote.getEmployment(...)` in
 * `src/` keeps working with no signature change; only the four approval paths
 * ask the extra question, via src/shared/remoteWorld.js's remoteFor().
 *
 * THE MOCK CLIENT IS BUILT ONCE PER REQUEST, not per call: createInProcessFetch()
 * is cheap but not free, and a single release path touches Remote twice (the
 * freshness re-read and the write) — those two must be the same client, or the
 * "is this still true?" check and the act it guards could disagree about which
 * world they are in.
 *
 * THE MAPPING IS ONE-DIRECTIONAL, and that is the safety property:
 * `forSource(PORTAL_SOURCE)` is the ONLY input that yields the mock, and there
 * is no input that yields the real gateway for a portal record. So the
 * portal's promise — it never writes into a real Remote account — is kept by
 * construction, independent of what any caller passes.
 *
 * @param {object} defaultClient  remoteClient() or unavailableRemote()
 * @returns {object} defaultClient + forSource()
 */
export function sourceAwareRemote(defaultClient) {
  // A Proxy target must be an object. A caller that deliberately passes null
  // (or a test that passes nothing usable) gets its own value back untouched —
  // wrapping is an enhancement, and an enhancement must never be the thing
  // that throws.
  if (defaultClient === null || (typeof defaultClient !== "object" && typeof defaultClient !== "function")) {
    return defaultClient;
  }
  let mock = null;
  const forSource = (source) => {
    if (source !== PORTAL_SOURCE) return defaultClient;
    if (!mock) mock = mockRemoteClient();
    return mock;
  };
  return new Proxy(defaultClient, {
    get(target, prop, receiver) {
      // Answered BEFORE anything is forwarded, because `defaultClient` may be
      // unavailableRemote(), whose every property access throws by design.
      if (prop === "forSource") return forSource;
      const value = Reflect.get(target, prop, receiver);
      // Bound to the real client: RemoteClient's methods read `this.baseUrl`,
      // and an unbound reference would be invoked with the Proxy as `this` —
      // which works, but only by accident of the Proxy forwarding reads.
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

/** The real Zendesk client when configured, null otherwise (same rule as review/cli.js). */
export function zendeskClient() {
  if (!isZendeskConfigured()) return null;
  return new ZendeskClient({
    subdomain: config.zendesk.subdomain,
    email: config.zendesk.email,
    apiToken: config.zendesk.apiToken,
    clientId: config.zendesk.oauthClientId,
    clientSecret: config.zendesk.oauthClientSecret,
  });
}

/**
 * UC-02's POST route identifies the SUBMITTER by employment id, not an
 * approver by email, so it needs the same key with a different claim-path list
 * (UC02_IDENTITY_CLAIM_PATHS, exported by its own server for this purpose).
 *
 * Reads the SAME configuration as buildZafVerifierFromEnv() and applies the
 * same rule: ZAF_SHARED_SECRET (HS256, the client-side app this repo actually
 * ships) or ZAF_APP_PUBLIC_KEY_PEM (RS256, a server-side app), never both —
 * both present is refused rather than resolved, because the two belong to
 * different app types. Built here rather than reused because only the
 * claim-path list differs, and a copy that read a DIFFERENT variable is how
 * one route ends up unverifiable while every other one works.
 *
 * The static forms only: the live-fetch fallback in zafVerifierFromEnv.js needs
 * the legacy Zendesk email/API-token pair, which a deployment should not be
 * built on given Zendesk's published end-of-life for API tokens (CLAUDE.md §4).
 *
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {{verify: Function}|null}
 */
export function uc02IdentityVerifier(env = process.env) {
  const sharedSecret = (env.ZAF_SHARED_SECRET || "").trim() || null;
  const pem = normalizePemFromEnv(env.ZAF_APP_PUBLIC_KEY_PEM);
  if (sharedSecret && pem) return null;
  if (!sharedSecret && !pem) return null;
  return createZafVerifier({
    ...(sharedSecret ? { sharedSecret } : { publicKeyPem: pem }),
    issuer: env.ZAF_JWT_ISSUER || undefined,
    audience: env.ZAF_JWT_AUDIENCE || undefined,
    identityClaimPaths: UC02_IDENTITY_CLAIM_PATHS,
  });
}

/**
 * The deployment's own posture — one object, computed from the environment,
 * reported verbatim by GET /__cx/health and consulted by the write gate.
 *
 * `signedIdentityRequired` comes from the shared rule in approverAuth.js,
 * whose discriminator is whether a durable store is attached — the right
 * question for a process someone runs on their own machine.
 *
 * IT IS THE WRONG QUESTION HERE, so this deployment widens it. The shared rule
 * reasons about DURABILITY: a decision that outlives the process should name a
 * verified human. On a public URL the sharper risk is REACHABILITY — anyone on
 * the internet can POST to it. Those come apart in exactly one state, and it is
 * the state a first deploy lands in: no SUPABASE_DB_URL set yet, so no pool, so
 * `persistent` is false, so the shared rule permits the header posture — on a
 * URL the whole internet can reach. Approving a payroll change would be a curl
 * command with a name of your choosing in a header.
 *
 * So: running on Vercel is itself sufficient to require signed identity,
 * whether or not a store is attached. `VERCEL` is set by the platform on every
 * deployment and cannot be forgotten the way an explicit flag can. This can
 * only ever ADD a requirement — a deployment that already required signing
 * still does — so it cannot let anything through that the shared rule refused.
 *
 * The cost is honest and stated in /__cx/health: until ZAF_SHARED_SECRET is
 * set, reads work and every write is refused. A deployment that refuses
 * writes is recoverable in one environment-variable change; a public endpoint
 * that accepted an unauthenticated payroll approval is not.
 *
 * @param {NodeJS.ProcessEnv} [env]
 * @param {object} [opts]
 * @param {import("pg").Pool|null} [opts.pgPool]
 */
export function readPosture(env = process.env, { pgPool = null } = {}) {
  const persistent = Boolean(pgPool);
  const publiclyReachable = Boolean(env.VERCEL);
  // Same OR as signedIdentityRequired below, and for the same reason: the
  // platform check may add the requirement, never remove one.
  const entitlementPosture = resolveEntitlement(env, { persistent: persistent || publiclyReachable });
  // Loud on purpose, same shape as every ucNN CLI's startup line
  // (src/uc05/cli.js). Nobody watches a lambda boot, so this is the one place
  // the warning still reaches a human — the Vercel runtime log — for the
  // deployments where readPosture() itself, not buildHandler(), is the only
  // call site that ever resolves entitlement for a given request (e.g. every
  // hit to /__cx/health itself). Previously dropped entirely (rca-pb8a).
  if (entitlementPosture.warning) console.warn(`⚠ ${entitlementPosture.warning}`);
  return {
    publiclyReachable,
    supabaseAttached: persistent,
    remoteConfigured: Boolean(config.remote.token),
    remoteBaseUrl: config.remote.token ? config.remote.baseUrl : null,
    zendeskConfigured: isZendeskConfigured(),
    // OR, never AND: the platform check can add the requirement but never
    // remove one the shared rule already imposed.
    signedIdentityRequired: signedIdentityRequired(env, { persistent }) || publiclyReachable,
    // REPORTED, because "every approval is refused because nobody set
    // APPROVER_ROLES" and "every approval is refused because the roster says
    // no" are the same 403 from outside, and this repo's most expensive
    // recurring defect is exactly that indistinguishability. `source` names
    // which of the two a reader is looking at without a request in hand.
    approverEntitlementEnforced: entitlementPosture.required,
    approverEntitlementSource: entitlementPosture.source,
    // Per-use-case counts, not identities — safe on this public,
    // unauthenticated endpoint. `null` only when entitlement is not enforced
    // at all (the seeded in-memory demo posture), where there is no checker
    // to ask. A mounted, enforcing use case reading 0 here is the alarm this
    // bead exists for: a non-empty, correctly-sourced roster that still grants
    // nobody that use case's role (rca-pb8a, rca-9f0a).
    approverEntitlementCoverage: entitlementPosture.entitlement ? entitlementPosture.entitlement.describe().coverage : null,
    // Reported SEPARATELY, not merged into one "a key is configured" flag: they
    // are different mechanisms for different Zendesk app types, and this repo's
    // sidebar can only ever satisfy the HS256 one. A single merged flag reading
    // `true` off the RS256 half would say "writes are set up" about a
    // deployment that will refuse every real approval with
    // `unsupported_algorithm`. Setting both is refused — see
    // src/shared/zafVerifierFromEnv.js — so `true` here twice means broken.
    zafSharedSecretConfigured: Boolean((env.ZAF_SHARED_SECRET || "").trim()),
    zafPublicKeyConfigured: Boolean(
      normalizePemFromEnv(env.ZAF_APP_PUBLIC_KEY_PEM) ||
        (env.ZAF_APP_ID && config.zendesk.subdomain && config.zendesk.email && config.zendesk.apiToken)
    ),
    allowedOriginSetting: env.ZAF_ALLOWED_ORIGIN || null,
  };
}

/**
 * "Does this deployment read free text with a model, or with keyword rules?"
 *
 * WHY THIS EXISTS. Every other thing this deployment's posture depends on is
 * reported at /__cx/health — the store, Remote, Zendesk, the ZAF verifier, the
 * entitlement source, the portal key. The LLM was not, and it is the single
 * most load-bearing claim the system makes about itself. A user of the
 * deployed system said, in as many words, "I suspected that you were not using
 * any form of LLM in this entire system and I was right. All the outputs were
 * predetermined." They were wrong — but nothing they could reach said so, and
 * an unanswerable accusation is indistinguishable from a true one.
 *
 * It is worse than an unanswered question, because the answer CHANGES silently:
 * portalLlmDefaults() substitutes four named rule-based classifiers whenever no
 * key is configured, so the same URL either interprets a sentence with a model
 * or matches keywords in it, decided entirely by an environment variable, and
 * visible from outside in neither case.
 *
 * DERIVED FROM THE RUNTIME'S OWN FUNCTIONS, NEVER RE-DERIVED. This asks
 * isLlmConfigured() and portalLlmDefaults() — the exact two the portal handler
 * is wired from in buildPortalHandler() below — rather than reading
 * OPENAI_API_KEY itself. A health check that computes its answer independently
 * of the code path it describes can report green while that path does something
 * else; that is the failure mode `npm run verify-deployed` exists to prevent,
 * and reproducing it here would be self-defeating. The seam list is read OUT of
 * portalLlmDefaults()' return value (keys and each function's own `.name`), not
 * restated as a literal, so a fifth seam added there appears here with no edit.
 *
 * NO SECRET IS READ OR REPORTED. `configured` is a boolean and `model` is a
 * model name (OPENAI_MODEL, default gpt-4o-mini) — the key itself is never
 * touched here, not even to measure it.
 *
 * @param {object} [seams] test seams; every default is the real runtime function
 * @param {() => boolean} [seams.isConfigured]
 * @param {() => object} [seams.portalDefaults]
 * @param {string} [seams.model]
 * @returns {{configured:boolean, model:string|null, freeTextInterpretedBy:"llm"|"rule_based",
 *            ruleBasedSeams:Array<{seam:string, fallback:string}>}}
 */
export function llmPosture({
  isConfigured = isLlmConfigured,
  portalDefaults = portalLlmDefaults,
  model = config.openai.model,
} = {}) {
  const configured = Boolean(isConfigured());
  const substituted = portalDefaults() || {};
  return {
    configured,
    // Null rather than the default model name when nothing is configured: no
    // model would be used, and printing "gpt-4o-mini" beside `configured:
    // false` is exactly the half-read that produces a confident wrong answer.
    model: configured ? model : null,
    freeTextInterpretedBy: configured ? "llm" : "rule_based",
    // Empty when the real OpenAI-backed path runs, because that is literally
    // what portalLlmDefaults() returns then — the list IS the evidence, not a
    // description of it.
    ruleBasedSeams: Object.keys(substituted)
      .sort()
      .map((seam) => ({ seam, fallback: substituted[seam]?.name || "(anonymous function)" })),
  };
}

/**
 * Build the real handler for one use case, with a store set built fresh for
 * this request.
 *
 * @param {string} prefix  "uc01".."uc09"
 * @param {object} ctx
 * @param {import("pg").Pool|null} ctx.pgPool
 * @param {string} ctx.allowedOrigin
 * @param {{verify:Function}|null} ctx.verifier
 * @param {boolean} ctx.requireSignedIdentity
 * @param {NodeJS.ProcessEnv} [ctx.env]
 * @param {object} [ctx.remote]   test seam; defaults to the env-derived client
 * @param {object|null} [ctx.zendesk]  test seam; defaults to the env-derived client
 * @returns {(req: any, res: any) => Promise<void>}
 */
export function buildHandler(
  prefix,
  { pgPool = null, allowedOrigin = "*", verifier = null, requireSignedIdentity = true, env = process.env, remote, zendesk }
) {
  const audit = new AuditLogger(null, { pgPool });
  // Source-aware even when a test injects its own client: `forSource` is
  // ADDED to whatever it is given, so an injected fake keeps behaving exactly
  // as it did AND a portal-originated record still reaches the mock. Wrapping
  // only the env-derived client would have left the seam untested in exactly
  // the tests that exist to test it.
  const rc = sourceAwareRemote(remote !== undefined ? remote : remoteClient());
  // Given to EVERY use case, including the three read-only ones, because
  // `requireSignedIdentity` now gates GETs as well as POSTs — see
  // src/shared/approverAuth.js's resolveReader(). uc03/uc07/uc08 have no
  // write route at all and still need it: a dossier is exactly the sort of
  // record this deployment must not hand to an anonymous caller.
  // ROLE ENTITLEMENT (docs/APPROVAL-ROUTING.md §1.3), built HERE rather than
  // left to each handler's default, for the reason finding F-20 exists: a
  // control that is only wired into the CLIs is a control the deployment does
  // not have, and the deployment is the publicly reachable half. Same posture
  // input as `requireSignedIdentity` above — this URL is persistent and
  // publicly reachable, so entitlement is enforced and APPROVER_ROLES must be
  // set; until it is, every approve/decline refuses with
  // `approver_entitlement_not_configured`, which is the same loud failure a
  // missing ZAF verifier already produces. uc02/uc07/uc08 ignore the key
  // (uc02 keeps its own review gate; the 🔴/read-only ones have no approval
  // route at all), so it rides along in `common` harmlessly there. UC-01 USED
  // TO BE ON THAT LIST TOO, and the omission was live for as long as this
  // comment said so: `common` was already spreading a fully-built checker
  // into `createReviewHandler()` (below), but reviewPolicy.js/service.js/
  // server.js had no parameter to receive it, so the key was silently
  // dropped by destructuring and every UC-01 approval bypassed entitlement
  // even on this deployment. Fixed by K10 (qa/HUMAN-DECISIONS-REQUIRED.md,
  // 2026-08-23) — src/review/ now has the same call site UC-03/04/05/06/09
  // do. UC-03 USED TO BE
  // ON THAT LIST and no longer is: it has exactly one approval — the formal
  // travel letter's sign-off — and it consults the same roster as the rest.
  const { entitlement, warning: entitlementWarning } = resolveEntitlement(env, { persistent: requireSignedIdentity });
  // Previously dropped by this same destructure (rca-pb8a) — the loudest
  // signals this module produces ("APPROVER_ROLES is unset", "parsed to zero
  // approvers", "could not be parsed") reached nowhere. Same shape as every
  // ucNN CLI's startup warning (src/uc05/cli.js) — the Vercel runtime log is
  // the only "startup" a lambda has.
  if (entitlementWarning) console.warn(`⚠ ${entitlementWarning}`);
  const common = { allowedOrigin, requireSignedIdentity, zafVerifier: verifier, entitlement };

  switch (prefix) {
    case "uc01": {
      const caseStore = new CaseStore({ pgPool });
      // PostgresReviewStore is a genuinely different implementation (it JOINs
      // cases to review_queue in SQL); the in-memory one exists so a
      // credential-free clone still renders something. With no pool this
      // deployment has nothing to serve, and returns empty rather than
      // pretending otherwise.
      const store = pgPool ? new PostgresReviewStore(pgPool) : new InMemoryReviewStore(caseStore);
      return createReviewHandler({
        store,
        caseStore,
        audit,
        remote: rc,
        zendesk: zendesk !== undefined ? zendesk : zendeskClient(),
        ...common,
      });
    }
    case "uc02":
      // requireSignedIdentity is deliberately NOT passed through:
      // uc02/server.js defaults it to true and this deployment must never
      // relax that. Its POST submits an expense claim on behalf of a named
      // employment id, on a public URL. `allowUnauthenticatedDemo` is
      // likewise never set here.
      return createUc02Handler({
        // POOLED, like every sibling. This read `new ExpenseStore()` with no
        // pool while src/portal/wiring.js's comment already declared "there is
        // now no exception in this list" — so the portal persisted a claim to
        // Supabase and this API, serving the sidebar's by-ticket lookup for
        // that very claim, could not see it. Both halves looked correct in
        // isolation; only the join was broken.
        expenseStore: new ExpenseStore({ pgPool }),
        audit,
        remote: rc,
        allowedOrigin,
        identityVerifier: uc02IdentityVerifier(env),
        // The READ gate, under its own name because uc02's
        // `requireSignedIdentity` already names the WRITE gate there and is
        // bound to the employment-id claim list. Same posture flag, same
        // agent-identity verifier as every other use case.
        requireSignedReads: requireSignedIdentity,
        readVerifier: verifier,
        // The §6 Finance Ops review gate. Passed EXPLICITLY rather than left
        // to the server's own default, so this deployment's posture is stated
        // here beside every other use case's rather than inferred one file
        // away — and so it reads identically to the uc04/05/06/09 lines below.
        requireSignedReviews: requireSignedIdentity,
        reviewVerifier: verifier,
      });
    case "uc03":
      // AUDIT/REMOTE/ZENDESK ARE NEW HERE, and they are what the one write route
      // needs: a durable record of the signature, a freshness re-read of the
      // employment the letter asserts is active, and the ticket the signed
      // letter is posted to. `entitlement` already rides in `common`. See
      // src/uc03/signoffPolicy.js for why exactly one UC-03 outcome is signable.
      return createUc03Handler({
        caseStore: new CaseStore({ pgPool }),
        audit,
        remote: rc,
        zendesk: zendesk !== undefined ? zendesk : zendeskClient(),
        ...common,
      });
    case "uc04":
      return createUc04Handler({ authorizationStore: new AuthorizationStore({ pgPool }), audit, remote: rc, ...common });
    case "uc05":
      return createUc05Handler({ resignationStore: new ResignationStore({ pgPool }), audit, remote: rc, ...common });
    case "uc06":
      return createUc06Handler({ amendmentStore: new AmendmentStore({ pgPool }), audit, remote: rc, ...common });
    case "uc07":
      return createUc07Handler({ dossierStore: new Uc07DossierStore({ pgPool }), ...common });
    case "uc08":
      return createUc08Handler({ dossierStore: new Uc08DossierStore({ pgPool }), ...common });
    case "uc09":
      return createUc09Handler({ adjustmentStore: new AdjustmentStore({ pgPool }), audit, remote: rc, ...common });
    default:
      throw new Error(`unknown use case prefix: ${prefix}`);
  }
}

// ---------------------------------------------------------------------------
// The request portal (src/portal/), mounted at /portal
// ---------------------------------------------------------------------------

/** The path prefix the portal is served under. One constant, two readers. */
export const PORTAL_BASE_PATH = "/portal";

/**
 * The portal's access posture for this deployment.
 *
 * Same shape of rule as readPosture()'s `signedIdentityRequired`, and for the
 * same reason, but a DIFFERENT credential: the portal is not inside Zendesk,
 * so no ZAF token exists for it to present. See src/portal/access.js's header
 * for why a shared key is the right weaker mechanism and what it does not
 * prove.
 *
 * @param {NodeJS.ProcessEnv} [env]
 * @param {object} [opts]
 * @param {import("pg").Pool|null} [opts.pgPool]
 */
export function portalPosture(env = process.env, { pgPool = null } = {}) {
  return portalAccessPosture(env, { persistent: Boolean(pgPool) });
}

/**
 * Build the portal's request handler for one invocation.
 *
 * THE REMOTE CLIENT IS THE MOCK, ALWAYS — the same promise `npm run portal`
 * prints on every start ("the portal never touches a real Remote account"),
 * kept true in a process that cannot open a socket by injecting the transport
 * instead of the data (createInProcessFetch(), src/remote/mockServer.js).
 *
 * Pointing it at the real Sandbox was considered and rejected twice over:
 * every persona is a mock fixture id, so all five Remote-dependent forms would
 * 404 upstream and refuse — a page that cannot succeed, which is exactly the
 * defect class docs/BUILD-LOG.md §3.30 exists to warn about — and a publicly
 * reachable page would be writing work-authorization records into a real
 * account.
 *
 * The STORES, by contrast, are the real ones with the real pool, so a
 * submission's row lands in Supabase and is there for the E2E test plan's
 * verification query. Mock upstream, real ledger: the same split every
 * `npm run ucNN-api` already runs with.
 *
 * @param {object} ctx
 * @param {import("pg").Pool|null} [ctx.pgPool]
 * @param {NodeJS.ProcessEnv} [ctx.env]
 * @param {object} [ctx.access]  test seam; defaults to the env-derived posture
 * @param {object} [ctx.remote]  test seam; defaults to the in-process mock client
 * @param {object} [ctx.llm]  test seam; defaults to portalLlmDefaults(). Needed
 *   because a test that let this default through would make real, retried
 *   OpenAI calls whenever an OPENAI_API_KEY happens to sit in the environment —
 *   the hazard CLAUDE.md §6 records being burned by three times.
 */
export function buildPortalHandler({ pgPool = null, env = process.env, access, remote, llm } = {}) {
  return createPortalHandler({
    // The failed-key ceiling's durable counter. Postgres-backed whenever a
    // pool exists, because an in-memory counter on this deployment starts at
    // zero every invocation and would bound nothing — the same "built is not
    // provisioned" trap the approver-entitlement gate taught this file once
    // already. It fails OPEN, so a broken counter cannot lock out a holder of
    // the correct key.
    throttleStore: createPortalThrottleStore(pgPool),
    // The SAME constructor sourceAwareRemote() uses for a portal-originated
    // record, so the world a submission is decided in and the world it is
    // later executed in cannot drift apart in one of the two places.
    remote: remote !== undefined ? remote : mockRemoteClient(),
    audit: new AuditLogger(null, { pgPool }),
    // Built by the same function `npm run portal` uses, so the two entry
    // points cannot drift into persisting different things (src/portal/wiring.js).
    stores: buildPortalStores({ pgPool }),
    llm: llm !== undefined ? llm : portalLlmDefaults(),
    access: access ?? portalPosture(env, { pgPool }),
    basePath: PORTAL_BASE_PATH,
    // The Zendesk hand-off: a decision that needs a human gets a pre-tagged
    // ticket, so the ZAF sidebar's by-ticket lookup can find it (see
    // src/portal/ticketing.js). `zendeskClient()` returns null when no
    // credentials are configured, and the portal then reports "no client
    // configured" on the response rather than failing the submission — the
    // decision is durable either way.
    //
    // NO MOCK FALLBACK HERE, unlike `npm run portal`. A function cannot start
    // a companion mock server, and a portal pointed at a localhost mock that
    // is not running would time out and read as a broken deployment. Saying
    // "no ticket was raised, and why" is the honest answer in that state.
    zendesk: zendeskClient(),
    // The REAL client, for one path only: advancing a third-party enquiry whose
    // consent the employee has just granted. `remote` above is the in-process
    // mock by design (this portal's own personas and submissions live there),
    // but a third-party-door case names a real Sandbox employment id — decided
    // against the mock it would 404 and escalate a disclosure the employee had
    // just approved. Passed explicitly rather than by making the portal's whole
    // client source-aware, because widening `remote` would quietly move the
    // portal's own intake onto the live account.
    thirdPartyRemote: remoteClient(),
    employmentIdFieldId: config.zendesk.employmentIdFieldId ?? null,
  });
}

// ---------------------------------------------------------------------------
// The third-party consent door (src/thirdparty/), mounted at /thirdparty
// ---------------------------------------------------------------------------

/** The path prefix the third-party door is served under. One constant, two readers. */
export const THIRD_PARTY_BASE_PATH = "/thirdparty";

/**
 * Build the third-party door's request handler for one invocation.
 *
 * DELIBERATELY UNGATED — see router.js's THIRD_PARTY_DOOR comment for why no
 * shared key and no ZAF verifier apply here. This is the one surface on the
 * whole deployment that must be reachable with zero credentials, because
 * VC-06/VC-07/VC-08/VC-33 exist to prove exactly that a caller with none can
 * trigger the real workflow and learn nothing from its outcome.
 *
 * THE REMOTE CLIENT IS THE REAL ONE, unlike the portal's mock. The portal's
 * personas are mock fixture ids that a real Sandbox would 404 on every one of
 * them; the third-party door has no personas at all — every submission names
 * an employment reference typed by a stranger, which is exactly the shape a
 * real record lookup is meant to test. Pointing this at the mock would make
 * VC-07's "a positive third-party run exists" unfalsifiable against anything
 * Remote actually holds. `remoteClient()` degrades to the explicit-failure
 * stand-in when REMOTE_API_TOKEN is unset, and `createThirdPartyDoorHandler`'s
 * own try/catch around `handleVerificationTicket()` (src/thirdparty/server.js)
 * already swallows that failure into the same fixed acknowledgement every
 * other outcome gets — so an unconfigured deployment answers identically to a
 * configured one, just without a case/consent row behind it.
 *
 * THE STORES ARE THE REAL, POOLED ONES, so a submission's case row and
 * `consent_records` artifact land in Supabase where the evaluator's E2E
 * evidence queries (§16) can find them — the same "mock upstream where it
 * must be, real ledger always" split every other surface on this deployment
 * uses.
 *
 * @param {object} ctx
 * @param {import("pg").Pool|null} [ctx.pgPool]
 * @param {NodeJS.ProcessEnv} [ctx.env]
 * @param {object} [ctx.remote]     test seam; defaults to the env-derived client
 * @param {object} [ctx.audit]      test seam; defaults to the pool-backed logger
 * @param {object} [ctx.caseStore]  test seam; defaults to the pool-backed store
 * @param {object} [ctx.zendesk]    test seam; defaults to the env-derived
 *   client. rca-52q / E3-F9: a `human_review`/`escalate` outcome now raises a
 *   real hand-off ticket (src/uc01/workflow.js STEP 8's third-party branch) —
 *   `zendeskClient()` returns null when no credentials are configured, and
 *   the decision is still made, recorded and audited exactly as before; only
 *   the hand-off does not happen. NEVER read by anything this handler returns
 *   to the caller — see src/thirdparty/server.js's file header, VC-33.
 */
export function buildThirdPartyDoorHandler({ pgPool = null, env = process.env, remote, audit, caseStore, zendesk } = {}) {
  return createThirdPartyDoorHandler({
    remote: remote !== undefined ? remote : remoteClient(),
    audit: audit !== undefined ? audit : new AuditLogger(null, { pgPool }),
    caseStore: caseStore !== undefined ? caseStore : new CaseStore({ pgPool }),
    zendesk: zendesk !== undefined ? zendesk : zendeskClient(),
    basePath: THIRD_PARTY_BASE_PATH,
    // THE DURABLE COUNTER. The door's own default is an in-memory Map, which
    // is correct locally and counts NOTHING here: every request to this
    // function is a fresh process, so an in-memory limiter would start at zero
    // for each one and bound nothing at all. It has to be the Postgres store
    // or it is decoration.
    //
    // When there is no pool the door keeps its in-memory default. That is the
    // seeded-demo posture (no durable store, nothing outlives the process) and
    // it is the same discriminator readPosture() uses everywhere else — but
    // note it is NOT a safe default here in the way an unconfigured Zendesk
    // seam is: an unpooled PUBLIC deployment would have no effective ceiling.
    // Today that combination cannot arise, because a public deployment is
    // exactly where SUPABASE_DB_URL is set; /__cx/health reports the store in
    // use so it can be checked rather than assumed.
    rateLimitStore: pgPool ? createPgRateLimitStore(pgPool) : undefined,
    // The quick-fills' example subject. Taken from KNOWN_EMPLOYEES rather
    // than written out here, because that list is the ONE place in this repo
    // where a Sandbox id is re-verified against the live account (its header
    // records the 2026-08-19 check, character for character) — and the ids rot
    // silently when the Sandbox is re-provisioned, which has already happened
    // once. A second copy would be a second thing to forget.
    //
    // This copy reads the live Sandbox, so it needs a live id; src/thirdparty/
    // cli.js passes the mock's own instead. Neither is a lookup — see the
    // GET /api/example comment in src/thirdparty/server.js.
    // The SHORT ID, not the UUID — that is what an enquirer is actually
    // handed, and the door resolves it via ?short_id= (see restClient.js's
    // findEmploymentByShortId). `shortId` is verified live alongside the UUID
    // in KNOWN_EMPLOYEES; if it is ever absent the UUID still works, so the
    // fallback is a real fallback rather than a broken demo.
    demoSubject: KNOWN_EMPLOYEES[0]
      ? {
          employmentReference: KNOWN_EMPLOYEES[0].shortId ?? KNOWN_EMPLOYEES[0].id,
          subjectName: KNOWN_EMPLOYEES[0].name,
        }
      : null,
  });
}

// ---------------------------------------------------------------------------
// The audit trail viewer (src/auditview/), mounted at /audit
// ---------------------------------------------------------------------------

/** The path prefix the audit viewer is served under. One constant, two readers. */
export const AUDIT_BASE_PATH = "/audit";

/**
 * Build the audit viewer's request handler for one invocation.
 *
 * NEVER SEEDED HERE, deliberately. `npm run audit-ui` degrades to labelled
 * demo rows when no store is attached, because a fresh clone should show the
 * UI. A DEPLOYMENT must not: demo rows on a public URL are indistinguishable
 * from live history, so with no pool attached every read answers 503
 * no_durable_store instead — the same honesty rule as serverlessListNotice().
 *
 * The gate is the portal's shared key, reused whole (src/portal/access.js) and
 * computed by the SAME portalPosture() — one key opens both surfaces. This
 * viewer serves real audit rows (employment ids, actors, requester emails in
 * details), so on Vercel the posture always requires it.
 *
 * @param {object} ctx
 * @param {import("pg").Pool|null} [ctx.pgPool]
 * @param {NodeJS.ProcessEnv} [ctx.env]
 * @param {object} [ctx.access]  test seam; defaults to the env-derived posture
 * @param {object} [ctx.store]   test seam; defaults to the pool-backed store
 */
export function buildAuditViewHandler({ pgPool = null, env = process.env, access, store } = {}) {
  return createAuditViewHandler({
    store: store !== undefined ? store : new AuditReadStore({ pgPool, seeded: false }),
    access: access ?? portalPosture(env, { pgPool }),
    // The failed-key ceiling's durable counter. Postgres-backed whenever a
    // pool exists, because an in-memory counter on this deployment starts at
    // zero every invocation and would bound nothing — the same "built is not
    // provisioned" trap the approver-entitlement gate taught this file once
    // already. It fails OPEN, so a broken counter cannot lock out a holder of
    // the correct key.
    throttleStore: createPortalThrottleStore(pgPool),
    basePath: AUDIT_BASE_PATH,
  });
}


export const QUEUE_BASE_PATH = "/queue";

/**
 * Build the approval queue's request handler for one invocation.
 *
 * NEVER SEEDED HERE, for the same reason the audit viewer is not: demo rows on
 * a public URL are indistinguishable from real work, and this page's whole
 * claim is that its stuck list is real. With no pool attached every read
 * answers 503 no_durable_store.
 *
 * ZENDESK IS OPTIONAL AND ITS ABSENCE IS VISIBLE. Unconfigured, no reference
 * can be confirmed to be a real ticket, so every ticket-shaped reference is
 * reported as unverified and counted under "cannot tell" — never as reachable.
 * The client is the shared one at its least-privilege default: it reads
 * tickets, writes none, and compares group ids against the already-synced map
 * rather than listing groups, which would need a wider scope.
 *
 * @param {object} ctx
 * @param {import("pg").Pool|null} [ctx.pgPool]
 * @param {NodeJS.ProcessEnv} [ctx.env]
 * @param {object} [ctx.access]  test seam; defaults to the env-derived posture
 * @param {object} [ctx.store]   test seam
 * @param {object} [ctx.ticketFacts]  test seam
 */
export function buildApprovalQueueHandler({ pgPool = null, env = process.env, access, store, ticketFacts } = {}) {
  return createApprovalQueueHandler({
    store: store !== undefined ? store : new ApprovalQueueStore({ pgPool, seeded: false }),
    ticketFacts: ticketFacts !== undefined ? ticketFacts : queueTicketFacts(env),
    access: access ?? portalPosture(env, { pgPool }),
    // The failed-key ceiling's durable counter. Postgres-backed whenever a
    // pool exists, because an in-memory counter on this deployment starts at
    // zero every invocation and would bound nothing — the same "built is not
    // provisioned" trap the approver-entitlement gate taught this file once
    // already. It fails OPEN, so a broken counter cannot lock out a holder of
    // the correct key.
    throttleStore: createPortalThrottleStore(pgPool),
    basePath: QUEUE_BASE_PATH,
  });
}

function queueTicketFacts(env) {
  const subdomain = env.ZENDESK_SUBDOMAIN;
  const clientId = env.ZENDESK_OAUTH_CLIENT_ID;
  const clientSecret = env.ZENDESK_OAUTH_CLIENT_SECRET;
  if (!subdomain || !clientId || !clientSecret) return new TicketFacts();
  return new TicketFacts({ zendesk: new ZendeskClient({ subdomain, clientId, clientSecret }), subdomain });
}
