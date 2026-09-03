// ---------------------------------------------------------------------------
// rateLimit.js — a ceiling on an intentionally unauthenticated door
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
//
// src/thirdparty/ is open by design: a bank asking about somebody's employment
// must not need an account (VC-33). That posture is correct and this file does
// not change it. What it fixes is that "no account required" had also come to
// mean "no ceiling of any kind" on a page that, on the deployment:
//
//   - makes a REAL OpenAI call per submission, billed to the deployment;
//   - writes durable rows to a real Postgres database;
//   - can raise a real Zendesk ticket once an employee consents.
//
// So the cost of the door was unbounded and payable by anyone who found the
// URL. Before pointing it at a public audience, it needs a number.
//
// ---------------------------------------------------------------------------
// WHY THIS CANNOT BREAK VC-33, WHICH IS THE THING WORTH CHECKING
//
// VC-33 says every submission gets the SAME acknowledgement whatever the door
// FINDS — a real employee, one who declined, and a person who does not exist
// must be indistinguishable from outside. A refusal that depended on the
// lookup would be exactly the side channel that forbids.
//
// This one cannot be, structurally, for two reasons:
//
//   1. It is keyed ONLY on the caller (their address, and a global counter).
//      Nothing it reads comes from the request's subject, and nothing it reads
//      comes from Remote. It literally has no access to the answer.
//   2. It is consulted BEFORE any lookup, alongside the shape validations that
//      already return 4xx (`all_fields_required`, `message_too_long`). By the
//      time the door knows anything about who exists, this has already run.
//
// The caller learns only a fact about their own traffic, which they already
// knew. That is the same reason a 400 for a missing field is not a disclosure.
//
// ---------------------------------------------------------------------------
// WHY IT FAILS CLOSED
//
// If the counter cannot be read or written, the ceiling does not exist, and a
// limiter that cannot count cannot bound anything. Accepting traffic in that
// state is precisely the case it was built for. So an error refuses.
//
// This is the same direction `readPosture()` chose for approver identity, and
// the trade is deliberate: a refused enquiry costs a retry, an unbounded spend
// does not stop. The refusal is 503 and says "temporarily", because that is
// what it is — it is not a judgement about the enquiry.
//
// ---------------------------------------------------------------------------
// WHAT AN ADDRESS LIMIT IS AND IS NOT
//
// Per-address counting is a speed bump. Addresses rotate, and anyone who wants
// to get past it will. It is here to stop the ordinary cases — a stuck retry
// loop, one enthusiastic viewer, a naive script — cheaply.
//
// THE GLOBAL DAILY CEILING IS THE ACTUAL COST BOUND, and it is the number to
// look at. Whatever happens, the door does a known maximum amount of paid work
// per day. It is deliberately a blunt instrument: when it trips, the door is
// closed for everyone until the window rolls, which is the correct failure for
// a demonstration and would be the wrong one for a product.
// ---------------------------------------------------------------------------

/**
 * Submissions one address may make per hour.
 *
 * Deliberately generous. A real enquirer sends one; this is set high enough
 * that the person DEMONSTRATING the system — who submits from a single address
 * over and over while rehearsing — is never the one it stops. The bound that
 * actually protects the bill is the global ceiling below, which no amount of
 * rehearsing approaches. Setting this tight would have made the limiter's most
 * likely victim its own author, which is how a control gets switched off.
 */
export const PER_ADDRESS_PER_HOUR = readPositiveInt(
  typeof process !== "undefined" ? process.env.THIRD_PARTY_RATE_PER_HOUR : undefined,
  20
);

/** Submissions the door will serve in a day, from everyone combined. */
export const GLOBAL_PER_DAY = readPositiveInt(
  typeof process !== "undefined" ? process.env.THIRD_PARTY_RATE_PER_DAY : undefined,
  250
);

/**
 * Parse an override, and FAIL TO THE SAFE VALUE on anything unparseable.
 *
 * The direction is the point, and it is the same one
 * `readIntakeWindowMs()` guards: a typo must never silently become "no limit".
 * `Number("")` is 0 and `Number("abc")` is NaN, and either reaching the cap
 * unchecked would disable the ceiling while leaving it looking configured.
 * An explicit 0 is not honoured for the same reason — switching this off is a
 * code change, not a typo away.
 */
function readPositiveInt(raw, fallback) {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

export const RATE_LIMITED_CODE = "rate_limited";

/**
 * The message a throttled caller sees.
 *
 * A fixed literal, like THIRD_PARTY_ACK_MESSAGE, and for a related reason: no
 * branch may select between two different throttle messages, or the choice
 * becomes readable. It says nothing about what was found because it runs
 * before anything is found.
 */
export const RATE_LIMITED_MESSAGE =
  "We have received a lot of requests from your connection just now. Please wait a little and try again — nothing you sent has been lost.";

/**
 * The caller's address, as well as it can be known behind a proxy.
 *
 * `x-forwarded-for` is client-suppliable in general. On Vercel the platform
 * sets it, and `x-vercel-forwarded-for` is set by the platform only, so it is
 * preferred where present. The socket address is the last resort and is the
 * right answer for `npm run thirdparty`.
 *
 * A caller who forges a different value each time defeats the per-address
 * bucket. That is expected and is why the global ceiling exists — see the
 * header. Forging cannot raise the global ceiling, because that bucket does
 * not depend on anything the caller sends.
 */
export function callerAddress(req) {
  const h = (req && req.headers) || {};
  const first = (v) => String(Array.isArray(v) ? v[0] : v || "").split(",")[0].trim();
  return (
    first(h["x-vercel-forwarded-for"]) ||
    first(h["x-real-ip"]) ||
    first(h["x-forwarded-for"]) ||
    (req && req.socket && req.socket.remoteAddress) ||
    "unknown"
  );
}

/** Bucket boundary for a window, as an ISO string — the counter's second key. */
export function windowStart(ms, windowMs) {
  return new Date(Math.floor(ms / windowMs) * windowMs).toISOString();
}

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/**
 * In-memory counter. Correct for `npm run thirdparty` (one process, one box)
 * and for tests; NOT durable, so it counts nothing useful on a serverless
 * deployment where each invocation is a fresh process. That is why
 * createPgRateLimitStore() exists, and why the deployment must pass one.
 */
export function createMemoryRateLimitStore() {
  const counts = new Map();
  return {
    kind: "memory",
    async bump(key, start) {
      const k = key + " " + start;
      const next = (counts.get(k) || 0) + 1;
      counts.set(k, next);
      return next;
    },
  };
}

/**
 * Durable counter over Postgres.
 *
 * THE GUARANTEE IS THE PRIMARY KEY AND THE ATOMIC UPSERT, NOT THIS CODE — the
 * same lesson `workflow_claims` cost us. A read-then-write would let two
 * concurrent submissions both observe 7 hits under a limit of 8 and both
 * proceed. INSERT ... ON CONFLICT ... DO UPDATE SET hits = <table>.hits + 1
 * RETURNING hits increments and reports the post-increment value in one
 * statement, so concurrent callers get distinct numbers.
 *
 * The table is created on first use rather than left to a migration. That is
 * unusual in this repo and is deliberate: the migration file exists
 * (migrations/0004) for the record, but this container has never been able to
 * reach Supabase over raw TCP (CLAUDE.md §6), so a deploy that assumed the
 * table had been applied by hand would fail closed on every request — turning
 * a cost control into an outage. CREATE TABLE IF NOT EXISTS is idempotent and
 * the connection's role owns the schema.
 */
// ---------------------------------------------------------------------------
// HARDEN_SQL — why the table is closed at creation and not by a hand-run ALTER
// ---------------------------------------------------------------------------
// Supabase's linter flagged this table on 2026-09-01 as the ONE table in the
// project with row-level security disabled (`rls_disabled_in_public`), and the
// reason it was the only one is this file: every other table was created by a
// migration, and this one is created above, on first use. So closing it by hand
// on the live database would have fixed production and left a fresh environment
// born open — the same "fixed here, reopens there" shape the deployed-vs-repo
// gaps in CLAUDE.md §7 keep costing this project.
//
// TWO STATEMENTS, AND THE SECOND IS NOT BELT-AND-BRACES.
// RLS governs SELECT/INSERT/UPDATE/DELETE. It does NOT govern TRUNCATE, which
// is controlled by table privilege alone — and `anon` was granted every
// privilege on this table, including TRUNCATE, by Supabase's default grants on
// the public schema. So enabling RLS on its own stops the read of the address
// list and still leaves anyone holding the (publicly distributable) anon key
// able to WIPE THE COUNTERS — which is the one action that actually defeats the
// ceiling. `anon` cannot be assumed harmless here: the whole point of this
// table is that it bounds a door with no account behind it.
//
// WHY THE ADDRESSES MATTER. `bucket_key` is "addr:" + the caller's address, so
// the rows are a record of who visited an unauthenticated door — thin, but
// personal. The migration's own header argues this table is "a counter and not
// a log" because it holds nothing about the SUBJECT of an enquiry; that is
// still true, and it was never a claim about the CALLER.
//
// WHY IT CANNOT BREAK THE DOOR. Both statements run inside a DO block that
// swallows exactly two conditions and nothing else: `insufficient_privilege`,
// for a role that may create a table without owning it, and `undefined_object`,
// because `anon` and `authenticated` are Supabase roles that do not exist on a
// plain Postgres. A limiter that refused traffic because it could not tighten
// its own permissions would convert a security improvement into the outage the
// migration file's header was written to avoid. Any other error still throws,
// and the limiter still fails closed on it.
const HARDEN_SQL =
  "DO $$ BEGIN " +
  "EXECUTE 'ALTER TABLE third_party_rate_limit ENABLE ROW LEVEL SECURITY'; " +
  "EXECUTE 'REVOKE ALL ON third_party_rate_limit FROM anon, authenticated'; " +
  "EXCEPTION WHEN insufficient_privilege THEN NULL; " +
  "WHEN undefined_object THEN NULL; END $$";

const ensuredPools = new WeakMap();

export function createPgRateLimitStore(pool) {
  // Keyed on the POOL, not on the store, because deps.js may build a fresh
  // store per invocation while the pool is shared and long-lived. Without this
  // every single request paid for a `CREATE TABLE IF NOT EXISTS` round trip on
  // the hot path of a page whose whole problem was doing too much work per
  // request.
  const ensure = () => {
    if (!ensuredPools.has(pool)) {
      ensuredPools.set(pool, pool.query(
        "CREATE TABLE IF NOT EXISTS third_party_rate_limit (" +
          "bucket_key text NOT NULL, " +
          "window_start timestamptz NOT NULL, " +
          "hits integer NOT NULL DEFAULT 0, " +
          "PRIMARY KEY (bucket_key, window_start))"
      ).then(() => pool.query(HARDEN_SQL)));
    }
    return ensuredPools.get(pool);
  };
  return {
    kind: "postgres",
    async bump(key, start) {
      await ensure();
      const { rows } = await pool.query(
        "INSERT INTO third_party_rate_limit (bucket_key, window_start, hits) VALUES ($1, $2, 1) " +
          "ON CONFLICT (bucket_key, window_start) " +
          "DO UPDATE SET hits = third_party_rate_limit.hits + 1 RETURNING hits",
        [key, start]
      );
      return Number(rows[0].hits);
    },
  };
}

/**
 * Consume one unit of quota for this caller.
 *
 * Both buckets are incremented on every call, deliberately: a caller who is
 * about to be refused by the global ceiling has still consumed the work of
 * asking, and counting only until the first refusal would let a single address
 * probe the global counter for free.
 *
 * @returns {Promise<{allowed: boolean, code?: string, retryAfterSeconds?: number, degraded?: boolean}>}
 */
export async function consume({ store, address, now = Date.now(), limits = {} }) {
  const perAddress = limits.perAddressPerHour == null ? PER_ADDRESS_PER_HOUR : limits.perAddressPerHour;
  const globalCap = limits.globalPerDay == null ? GLOBAL_PER_DAY : limits.globalPerDay;
  try {
    const [addressHits, globalHits] = await Promise.all([
      store.bump("addr:" + address, windowStart(now, HOUR)),
      store.bump("global", windowStart(now, DAY)),
    ]);
    if (globalHits > globalCap) {
      return { allowed: false, code: RATE_LIMITED_CODE, retryAfterSeconds: secondsLeft(now, DAY) };
    }
    if (addressHits > perAddress) {
      return { allowed: false, code: RATE_LIMITED_CODE, retryAfterSeconds: secondsLeft(now, HOUR) };
    }
    return { allowed: true };
  } catch {
    // FAIL CLOSED — see the header. A counter that cannot count cannot bound.
    // The error itself is deliberately not surfaced: this door tells an
    // unauthenticated caller nothing about its internals.
    return { allowed: false, code: RATE_LIMITED_CODE, retryAfterSeconds: 60, degraded: true };
  }
}

function secondsLeft(now, windowMs) {
  return Math.max(1, Math.ceil((Math.floor(now / windowMs) * windowMs + windowMs - now) / 1000));
}
