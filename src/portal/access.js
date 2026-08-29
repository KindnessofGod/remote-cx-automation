// ---------------------------------------------------------------------------
// access.js  —  Who may reach the request portal's API at all
// ---------------------------------------------------------------------------
// WHY THIS EXISTS, AND WHY IT IS NOT THE MECHANISM NEXT DOOR
// The nine review/approval APIs gate every read and every write behind a
// ZAF-SIGNED identity (src/shared/approverAuth.js). That mechanism is not
// available here and cannot be made available: a ZAF token is minted by
// Zendesk for an app running inside Zendesk, and the portal is deliberately
// NOT inside Zendesk — it stands in for the Remote product surfaces that emit
// these requests in the first place (src/portal/server.js's header). There is
// no agent, no ticket and no app instance to sign anything.
//
// So the portal gets the weakest credential that is still a credential: one
// shared secret, held by whoever is allowed to use the page, sent on every API
// request. It proves possession of a secret and NOTHING else — not who is
// asking, not that they may act for a given employee. It is worth being blunt
// about that, because the temptation with a shared key is to describe it as
// authentication and then reason as if it were. It closes exactly one hole:
// an anonymous caller on the open internet driving a surface that WRITES
// audit_log rows and use-case records into a real Supabase.
//
// THE RULE IS COPIED, DELIBERATELY, FROM readPosture() IN deploy/cx-apis/deps.js
//   required = (a durable store is attached) OR (the deployment is public)
// ORed, never ANDed, so the platform check can ADD the requirement but can
// never remove one the store check already imposed. Those two come apart in
// exactly one state, and it is the state a first deploy lands in: VERCEL set,
// SUPABASE_DB_URL not yet — a live URL with no store, which the durability
// half alone would leave open. Unset locally with no pool means open, so a
// fresh clone still runs `npm run portal` with no configuration at all.
//
// WHAT IS **NOT** GATED, and why that is not an oversight: the page itself
// (HTML/CSS/JS). It carries no customer data, no key and no decision — it is
// an empty shell that asks for the key. Serving the shell is how the operator
// is TOLD a key is needed; refusing it would leave a bare 401 in a browser and
// no way to supply one. Every /api route beneath it is gated, which is where
// the data and the writes are.
// ---------------------------------------------------------------------------

import { createHash, timingSafeEqual } from "node:crypto";

import {
  callerAddress,
  consume,
  createMemoryRateLimitStore,
  createPgRateLimitStore,
} from "../thirdparty/rateLimit.js";

/** The header the page sends. Lower-cased, as node:http normalizes them. */
export const PORTAL_KEY_HEADER = "x-portal-key";

/** The environment variable holding the expected value. */
export const PORTAL_KEY_ENV = "PORTAL_ACCESS_KEY";

/**
 * The store/override half of the rule, before the platform check widens it.
 * Mirrors signedIdentityRequired() in src/shared/approverAuth.js, including
 * the exact-string-"true" comparison: an env var is a string, and `Boolean("false")`
 * is `true`.
 */
function baseRequired(env, persistent) {
  if (env.PORTAL_REQUIRE_ACCESS_KEY === "true") return true;
  if (env.PORTAL_ALLOW_OPEN_ACCESS === "true") return false;
  return persistent;
}

/**
 * Is a key required for this process?
 *
 * `PORTAL_ALLOW_OPEN_ACCESS=true` can switch off the durability half — a local
 * demo pointed at Supabase, say — and CANNOT switch off the platform half. That
 * asymmetry is the whole point of the OR: no environment variable set by a
 * person can make a publicly reachable deployment open.
 *
 * @param {NodeJS.ProcessEnv} [env]
 * @param {object} [opts]
 * @param {boolean} [opts.persistent]  true when a real durable store is wired
 */
export function portalAccessRequired(env = process.env, { persistent = true } = {}) {
  return baseRequired(env, persistent) || Boolean(env.VERCEL);
}

/**
 * The portal's whole posture as one object — the same "report it as data,
 * nobody watches a lambda boot" discipline deploy/cx-apis/handler.js applies to
 * the nine APIs. Consumed by the gate below, by GET /__cx/health, and printed
 * by `npm run portal` at startup.
 *
 * The key itself is held here and never reported; `keyConfigured` is the only
 * thing said about it.
 *
 * @param {NodeJS.ProcessEnv} [env]
 * @param {object} [opts]
 * @param {boolean} [opts.persistent]
 */
export function portalAccessPosture(env = process.env, { persistent = true } = {}) {
  const key = (env[PORTAL_KEY_ENV] || "").trim() || null;
  const required = portalAccessRequired(env, { persistent });
  return {
    required,
    keyConfigured: Boolean(key),
    header: PORTAL_KEY_HEADER,
    // Named, never asserted — the same lesson whySignedIdentity() records one
    // directory over: a posture that misreports WHY it is refusing sends the
    // reader to fix the wrong thing.
    reasons: [
      ...(persistent ? ["a durable store is attached, so a submission writes rows that outlive the process"] : []),
      ...(env.VERCEL ? ["this deployment is publicly reachable, so anyone on the internet can post to it"] : []),
      ...(!persistent && !env.VERCEL && required ? [`${"PORTAL_REQUIRE_ACCESS_KEY"} is set to true`] : []),
    ],
    // Not part of the posture the gate reads — kept beside it so exactly one
    // object has to be passed around.
    key,
    // Also not read by the gate, and here for the same "one object" reason:
    // /__cx/health reports it. It is the one portal setting that fails
    // SILENTLY — unset, every hand-off ticket is created without an employment
    // id, Zendesk returns 200, and no workflow can ever fire on it. Reporting
    // it is what makes that checkable from outside instead of only by raising a
    // real request and reading the ticket back, which is how it was eventually
    // found (CLAUDE.md §7 honest-gaps #21).
    employmentIdFieldId: env.ZENDESK_EMPLOYMENT_ID_FIELD_ID || null,
  };
}

/** The posture of a process that gates nothing. Handy for tests and defaults. */
export const OPEN_ACCESS = Object.freeze({ required: false, keyConfigured: false, header: PORTAL_KEY_HEADER, reasons: [], key: null, employmentIdFieldId: null });

/** Constant-time compare of two secrets of any length. */
function secretsMatch(a, b) {
  const ha = createHash("sha256").update(String(a)).digest();
  const hb = createHash("sha256").update(String(b)).digest();
  return timingSafeEqual(ha, hb);
}

/**
 * Decide whether one request may reach the portal's API.
 *
 * The three refusal bodies below are read by the PERSON USING THE PAGE, not
 * by whoever deployed it (that reader has this file's own comments, and
 * cli.js's startup message, cli.js:177/181, which prints `posture.reasons`
 * verbatim on purpose — that console is read by an operator). An employee
 * asking for their own letter can land on this screen in the ordinary case
 * (`portal_access_key_required`, before they have entered anything) just as
 * easily as an operator can in the misconfigured one, so nothing here may
 * assume a developer is reading it. R7-43 / D-08 found this file explaining
 * itself in its own implementation vocabulary — "a durable store is
 * attached", "this repo's real gates", "an audit row and a use-case record",
 * "ask whoever deployed this" — on exactly that screen. Say what is true
 * (a code is needed; here is what to do) without saying how the system
 * decided it needed one.
 *
 * FAILS CLOSED IN THE CONFIGURATION GAP. When a key is required and none is
 * configured, every API request is refused rather than allowed — a portal that
 * refuses is fixed with one environment variable, whereas a public page that
 * wrote a row for an anonymous caller cannot be un-written.
 *
 * @param {{headers?: Record<string,string|string[]|undefined>}} req
 * @param {ReturnType<typeof portalAccessPosture>} posture
 * @returns {{ok: true}|{ok: false, status: number, body: object}}
 */
export function checkPortalAccess(req, posture) {
  if (!posture?.required) return { ok: true };

  if (!posture.keyConfigured) {
    return refuse(401, {
      code: "portal_access_key_not_configured",
      reason: "This page can't accept requests yet — nothing is wrong with what you did.",
      why: "It needs an access code before it will accept a request, because it's publicly reachable, and no code has been set up for it yet.",
      howToFix: [
        "This isn't something you can fix yourself.",
        `Tell your HR or IT contact that this page needs ${PORTAL_KEY_ENV} set before it can be used.`,
      ],
    });
  }

  const supplied = headerValue(req, PORTAL_KEY_HEADER);
  if (!supplied) {
    return refuse(401, {
      code: "portal_access_key_required",
      reason: "This page requires an access code before it will accept your request.",
      why: "The code makes sure only people who are meant to use this page can submit a request or see its records.",
      howToFix: [
        "Enter the access code in the box on this page — you only need to do it once per browser.",
        "If you don't have a code, ask your HR or IT contact for it.",
      ],
    });
  }

  if (!secretsMatch(supplied, posture.key)) {
    return refuse(401, {
      code: "portal_access_key_invalid",
      reason: "That access code doesn't match.",
      why: "Codes are checked carefully, and nothing about the correct one is shown back — that's on purpose, so a guess can't be narrowed down.",
      howToFix: [
        "Check for an extra space or a missing character and try again.",
        "If it still doesn't work, ask your HR or IT contact for the current code.",
      ],
    });
  }

  return { ok: true };
}

function refuse(status, body) {
  return { ok: false, status, body: { ok: false, ...body, checkPosture: "/__cx/health" } };
}

/** First value of a header, tolerating node's string|string[] shape. */
function headerValue(req, name) {
  const raw = req?.headers?.[name];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

// ---------------------------------------------------------------------------
// BRUTE-FORCE CEILING ON THE FAILED-KEY PATH
// ---------------------------------------------------------------------------
// WHAT WAS WRONG. checkPortalAccess() above compares in constant time and
// returns. Nothing counted. Verified live against the deployment: eight
// consecutive wrong keys returned eight 401s at full speed, with no counter, no
// lockout and no delay. Behind this one shared secret sit /audit (real
// audit_log rows — employment ids, requester emails, whole decision records)
// and /queue (everything waiting on a human). A shared key is the weakest
// credential that is still a credential, as this file's header says out loud;
// the one thing that must not also be true of it is that it can be guessed for
// free, forever, at line rate.
//
// THE COUNTER IS NOT REINVENTED. src/thirdparty/rateLimit.js already has one:
// durable over Postgres, atomic (INSERT ... ON CONFLICT ... RETURNING, so two
// concurrent callers get distinct numbers rather than both reading 7 under a
// limit of 8), with a rolling window, and already proven live on the
// third-party door. It is imported whole.
//
// THREE DESIGN POINTS, EACH THE ANSWER TO A WAY THIS CONTROL COULD HURT THE
// PEOPLE IT IS FOR:
//
//   1. ONLY A WRONG KEY IS COUNTED. Not a success, and not an absent key.
//        - Successes: a legitimate holder refreshing /audit or /queue emits a
//          request per refresh and could otherwise exhaust their own quota in a
//          minute. Locking the owner out mid-demo is the failure this control
//          would be blamed for, and it is structurally impossible here: the
//          counter is never touched on the ok path.
//        - An ABSENT key is not a guess. `portal_access_key_required` is the
//          ORDINARY first screen — the page loads, fires its API calls, and
//          only then does the reader type the code. Counting those would lock
//          out an honest first-time visitor before they had entered anything.
//          Brute force means SUPPLYING candidate values; that is the only path
//          that is counted.
//   2. NO GLOBAL CEILING IS ENFORCED, on purpose. A cap on total failures
//      across all callers is exactly how one attacker locks out every
//      legitimate holder — the control becomes the outage. The global bucket is
//      still incremented (it is a free, countable "how many key failures today"
//      number in the same table) but its cap is infinite, so no address's
//      traffic can ever refuse another address's request.
//   3. THE BUCKET NAME IS ITS OWN. `keyfail:addr:<addr>` and `keyfail:global`,
//      via a prefixing wrapper around the shared store. The third-party door
//      counts under `addr:<addr>` / `global` in the same table, and if the two
//      shared a bucket a burst of key guesses would close the consent door for
//      the day — two unrelated controls exhausting each other's quota.
//
// WHY IT FAILS **OPEN**, WHICH IS THE OPPOSITE OF THE DOOR NEXT DOOR
// consume() fails closed: on a store error it refuses, because the third-party
// door has NO other control and an unbounded, billable spend does not stop by
// itself. Here the situation is inverted. The access control is the KEY, and
// the key is checked before this ever runs and is unaffected by whether the
// counter works. A limiter that cannot count leaves the secret exactly as
// strong as it was; refusing in that state would convert a Postgres hiccup into
// a total lockout of the audit viewer and the approval queue for everyone
// holding the correct code — an outage manufactured by a control that was only
// ever a speed bump. So a degraded counter yields the ordinary 401 and the
// caller with the right key still gets in. The same reasoning covers "no store
// passed at all" (a fresh clone, `npm run portal` with no pool): §9's
// degrade-to-a-safe-default, where safe HERE means "behave exactly as this file
// did before the ceiling existed", not "refuse".
// ---------------------------------------------------------------------------

/**
 * Wrong keys one address may supply per hour before it is throttled.
 *
 * Ten, and the number is chosen from both ends. A person mistyping a code they
 * genuinely hold needs two or three attempts; a browser holding a stale key can
 * retry a handful more before anyone reads the screen — so ten is comfortably
 * above every honest use, which is what stops the control being switched off
 * for getting in its author's way (the mistake src/thirdparty/rateLimit.js
 * records making the opposite way round). From the other end it caps an online
 * guesser at 240 attempts a day per address. That is not what makes the secret
 * safe — its entropy is — but it removes "unbounded free guessing at line rate"
 * as a property of the system, and it makes the attempt visible as a number
 * instead of invisible.
 */
export const PORTAL_KEY_FAILURES_PER_HOUR = 10;

/** Bucket namespace, kept apart from the third-party door's (see point 3). */
export const PORTAL_KEY_FAILURE_BUCKET_PREFIX = "keyfail:";

export const PORTAL_KEY_THROTTLED_CODE = "portal_access_key_throttled";

/**
 * The one throttled body.
 *
 * A fixed literal for the same reason THIRD_PARTY_ACK_MESSAGE is one: no branch
 * may select between two throttle messages, or the choice itself becomes
 * readable. It says nothing about how close a guess was, nothing about how many
 * attempts remain, and nothing about whether a code was even supplied — after
 * the ceiling trips, a wrong code and a missing one are the same screen. Copy
 * discipline is the gate's (R7-43 / D-08): written for the person reading it,
 * who may well be an employee whose colleague shares the connection.
 */
const THROTTLED_BODY = Object.freeze({
  code: PORTAL_KEY_THROTTLED_CODE,
  reason: "Too many incorrect access codes have been tried from this connection.",
  why: "Pausing after repeated wrong codes is what stops someone guessing their way in. It is about this connection, not about you or about the code you entered.",
  howToFix: Object.freeze([
    "Wait a little while, then try again.",
    "Ask your HR or IT contact to confirm the current code before your next try.",
  ]),
});

/**
 * Wrap a rate-limit store so every key it writes lands under our own prefix.
 *
 * Cheaper and safer than a second table: `consume()` hard-codes the key shapes
 * `addr:<address>` and `global`, and prefixing at the store boundary is the one
 * place that cannot be forgotten by a future call site.
 *
 * @param {{bump: (key: string, start: string) => Promise<number>}} store
 */
export function namespacedRateLimitStore(store, prefix = PORTAL_KEY_FAILURE_BUCKET_PREFIX) {
  return {
    kind: `${store.kind || "unknown"}:${prefix}`,
    bump: (key, start) => store.bump(prefix + key, start),
  };
}

/**
 * Build the store the throttle should use for a given process.
 *
 * A convenience so a server wires this in one line. Postgres when a pool is
 * attached (the deployment: each invocation is a fresh process, so an in-memory
 * counter there counts nothing); memory otherwise, which is correct for
 * `npm run portal` — one process, one box.
 *
 * @param {{query: Function}|null|undefined} pool
 */
export function createPortalThrottleStore(pool) {
  return pool ? createPgRateLimitStore(pool) : createMemoryRateLimitStore();
}

/**
 * checkPortalAccess() plus a ceiling on repeated wrong keys.
 *
 * Deliberately a SEPARATE, async export rather than a change to
 * checkPortalAccess(): that function is called synchronously by three servers
 * (portal, auditview, approvalqueue) and is a pure function several tests treat
 * as one. Its behaviour is unchanged and remains the whole verdict — this only
 * ever converts an already-refused `portal_access_key_invalid` into a 429.
 * It cannot turn a pass into a refusal, and there is no value it can return
 * that fills a gate; the same "can only ever refuse, consulted last" shape
 * approverEntitlement.js pins by test.
 *
 * @param {{headers?: Record<string,string|string[]|undefined>, socket?: object}} req
 * @param {ReturnType<typeof portalAccessPosture>} posture
 * @param {object} [opts]
 * @param {{bump: (key: string, start: string) => Promise<number>}} [opts.store]  injectable; omit to disable
 * @param {number} [opts.now]
 * @param {number} [opts.failuresPerHour]
 * @returns {Promise<{ok: true}|{ok: false, status: number, body: object}>}
 */
export async function checkPortalAccessThrottled(req, posture, opts = {}) {
  const verdict = checkPortalAccess(req, posture);

  // A correct key is never counted, whatever this address has done before —
  // point 1 above, and the single most important line in this function.
  if (verdict.ok) return verdict;

  // Only a supplied-and-wrong code is a guess. An absent code is the ordinary
  // first screen, and a missing PORTAL_ACCESS_KEY is the operator's problem,
  // not the reader's; neither may consume quota.
  if (verdict.body?.code !== "portal_access_key_invalid") return verdict;

  const store = opts.store;
  if (!store) return verdict; // no counter wired — degrade to the prior behaviour

  const outcome = await consume({
    store: namespacedRateLimitStore(store),
    address: callerAddress(req),
    now: opts.now == null ? Date.now() : opts.now,
    limits: {
      perAddressPerHour: opts.failuresPerHour == null ? PORTAL_KEY_FAILURES_PER_HOUR : opts.failuresPerHour,
      // Counted, never enforced. See point 2: a global failure cap is a
      // one-attacker-locks-out-everyone switch.
      globalPerDay: Number.POSITIVE_INFINITY,
    },
  });

  // `degraded` is consume()'s fail-CLOSED signal. Inverted here, deliberately —
  // see "WHY IT FAILS OPEN" above. This one line is the whole decision.
  if (outcome.allowed || outcome.degraded) return verdict;

  return refuse(429, { ...THROTTLED_BODY });
}
