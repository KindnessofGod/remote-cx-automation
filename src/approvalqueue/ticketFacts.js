// ---------------------------------------------------------------------------
// ticketFacts.js  —  Asking Zendesk whether a ticket is real, within a budget
// ---------------------------------------------------------------------------
// WHY THIS IS A SEPARATE FILE FROM THE JUDGEMENT
// ticketVerdict.js decides what a lookup MEANS and is pure, so it can be tested
// without a network. This file does the asking. Injecting it is what keeps
// `npm test` hermetic while the whole purpose of the feature is to touch a real
// account.
//
// A FAILED LOOKUP IS "UNKNOWN", NEVER "MISSING". A 500 from Zendesk, an expired
// token, a network blip — none of them are evidence that a ticket does not
// exist, and reporting one as `not_found` would put a healthy hand-off on the
// stuck list and send someone to fix a ticket that is fine. Every failure path
// here returns `{checked:false, reason}`, which ticketVerdict.js renders as the
// explicit middle state.
//
// THE OPPOSITE RULE APPLIES TO THE SUPABASE READS (queueStore.js): those throw,
// because a database read that failed into an empty list would render "nothing
// is waiting" over an outage. The difference is that Supabase IS this view's
// data and Zendesk is an enrichment of it — a wrong number gets acted on, a
// missing one gets investigated, and an unknown one gets labelled unknown.
//
// A BUDGET, BECAUSE THIS IS A LIST VIEW. One page can hold a hundred items and
// a hundred serial ticket reads is a page that never loads and an account that
// rate-limits. Lookups are deduplicated by id, capped, and everything past the
// cap is returned as `checked:false` with the cap named — not silently dropped,
// and not silently treated as fine.
//
// THE BUDGET IS AN ACCOUNT-WIDE CONTROL, NOT A PAGE-PERFORMANCE ONE, AND THAT
// IS WHY IT MOVED FROM 60 TO 15. Zendesk rate-limits per ACCOUNT, per minute —
// the same budget the live n8n pipeline spends on every real ticket it reads,
// updates and solves. At 60 a single render of a read-only viewer could spend
// up to 61 calls (60 reads plus the OAuth token fetch), so three or four
// impatient refreshes could 429 the whole account and the visible damage would
// land somewhere else entirely: n8n failing to reply to a real customer, with
// nothing in this page's own logs to connect the two. A viewer must never be
// able to take the pipeline down. See DEFAULT_BUDGET below for the number.
//
// AND THE CACHE HAS TO OUTLIVE THE REQUEST, OR IT IS NOT A CACHE. The cache
// used to be per-instance (`this.cache`), which reads as a cache and behaves as
// one only while a process handles more than one render. On the serverless
// deployment deploy/cx-apis/deps.js builds a fresh TicketFacts per invocation
// (queueTicketFacts()), so every entry was born and thrown away inside one
// request and NOTHING was ever reused: the second load of the same page paid
// the full budget again. It is now module-scoped and keyed on the Zendesk
// client object, the same shape and for the same reason as
// src/thirdparty/rateLimit.js's `ensuredPools` WeakMap — a fresh wrapper per
// invocation over a long-lived client, so the long-lived thing is what the
// cache must hang off. Keying on the CLIENT (not on a subdomain string, and
// not globally) is what stops two clients — the demo fake and the real
// account, or two accounts — reading each other's tickets, which would be a
// cross-account disclosure rather than merely a stale number.
// ---------------------------------------------------------------------------

/**
 * How many distinct ticket ids ONE page render may read from Zendesk.
 *
 * FIFTEEN, AND THE NUMBER IS ARGUED RATHER THAN FELT:
 *
 *   - The ceiling that matters is Zendesk's per-account per-minute limit, which
 *     on the most restrictive plan tier is 200 requests/minute and is SHARED
 *     with the live n8n pipeline. 15 reads + 1 token fetch is ~8% of that, so
 *     even a dozen refreshes in one minute leave the pipeline its air. At 60,
 *     four refreshes exhausted the entire account minute.
 *   - The reads are serial (see lookupMany), so the budget is also the page's
 *     latency: at the 200-400ms per Zendesk round trip this project measures,
 *     15 is 3-6 seconds and 60 was 12-24 — a page a human abandons and reloads,
 *     which is precisely how the account got hammered.
 *   - Coverage is not lost, only spread: this page's headline is the STUCK
 *     list, measured at 31 items of 124 waiting (CLAUDE.md §7 item 6), and with
 *     the cross-invocation cache below a second and third refresh check fresh
 *     ids rather than re-reading the first fifteen. Anything not reached is
 *     reported `checked:false` naming the budget — never as "fine".
 *
 * Overridable per deployment (`QUEUE_TICKET_LOOKUP_BUDGET`) so raising it is a
 * setting rather than a release, and clamped to MAX_BUDGET so it can never be
 * raised to a number that makes this page an account-wide outage.
 */
export const DEFAULT_BUDGET = readBudget(
  typeof process !== "undefined" ? process.env.QUEUE_TICKET_LOOKUP_BUDGET : undefined,
  15
);

/**
 * The hard ceiling on any override. A number above this is not a considered
 * choice about a read-only viewer, it is a way to spend the account's whole
 * minute budget from a page nobody is watching.
 */
export const MAX_BUDGET = 100;

/**
 * Parse an override, FAILING TO THE SAFE VALUE on anything unusable — the same
 * direction (and the same reasoning) as rateLimit.js's readPositiveInt(): a
 * typo must never silently become a bigger budget. `Number("")` is 0 and
 * `Number("abc")` is NaN, and either one reaching the cap unchecked would
 * disable the bound while leaving it looking configured.
 */
export function readBudget(raw, fallback) {
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) return fallback;
  return Math.min(n, MAX_BUDGET);
}

/**
 * How long a read ticket stays usable.
 *
 * SIXTY SECONDS, chosen against what is actually cached: `status`, `group_id`
 * and `assignee_id` — all MUTABLE, and all of them things a person reading this
 * page is likely to have just changed (items 7-8 of CLAUDE.md §7 are a backlog
 * of tickets sitting in the wrong group, and the fix is to re-assign them and
 * look again). A long TTL would show a reader their own repair as not yet done,
 * which on this page is worse than a slow load: it is the viewer contradicting
 * the account. A minute is long enough to absorb the burst the cache exists for
 * — a double-click, an impatient reload, two people opening the page at once —
 * and short enough that "I fixed it, refresh" tells the truth on the second try.
 */
export const TICKET_CACHE_TTL_MS = 60 * 1000;

/**
 * Cap on entries held per client, so a long-lived process cannot grow this
 * without bound. Expired entries are dropped first; only if that is not enough
 * does insertion order decide (Map iterates in insertion order).
 */
const MAX_CACHE_ENTRIES = 500;

/**
 * The cross-invocation cache — module-scoped, keyed on the Zendesk CLIENT.
 *
 * A WeakMap rather than a Map for the reason rateLimit.js's `ensuredPools`
 * gives: the key is the long-lived object, and when it is collected its cached
 * tickets go with it rather than pinning one deploy's account data in memory
 * forever.
 */
const ticketCaches = new WeakMap();

/**
 * @param {object} zendesk
 * @returns {Map<string, {result: object, expiresAt: number}>}
 */
function cacheFor(zendesk) {
  if (!ticketCaches.has(zendesk)) ticketCaches.set(zendesk, new Map());
  return ticketCaches.get(zendesk);
}

function pruneCache(cache, now) {
  if (cache.size <= MAX_CACHE_ENTRIES) return;
  for (const [id, entry] of cache) {
    if (entry.expiresAt <= now) cache.delete(id);
  }
  for (const id of cache.keys()) {
    if (cache.size <= MAX_CACHE_ENTRIES) break;
    cache.delete(id);
  }
}

export class TicketFacts {
  /**
   * @param {object} [opts]
   * @param {{getTicket:(id:string)=>Promise<object|null>}|null} [opts.zendesk]
   *   any object with getTicket — the real ZendeskClient, or a fake in tests.
   *   Null means no verification is possible and every answer is "unknown".
   * @param {number} [opts.budget]
   * @param {string|null} [opts.subdomain]  for composing links, server-side
   * @param {() => number} [opts.now]  injected clock — the TTL below is the one
   *   piece of behaviour here that cannot be tested by waiting, and a test that
   *   sleeps for a real minute is a test nobody runs.
   */
  constructor({ zendesk = null, budget = DEFAULT_BUDGET, subdomain = null, demo = false, now = () => Date.now() } = {}) {
    this.zendesk = zendesk;
    this.budget = budget;
    this.subdomain = subdomain;
    // The seeded run's client is a fake over the demo tickets. Reporting that
    // as "read back from Zendesk" would be the page asserting an integration it
    // does not have — the same lie as serving demo rows unlabelled.
    this.demo = demo;
    this.now = now;
    // Shared across every instance built over the SAME client (see the header).
    // A client that is not an object cannot key a WeakMap, so that case keeps a
    // private map rather than throwing — a caller passing something exotic gets
    // the old per-instance behaviour, never a crashed page.
    this.cache =
      zendesk && (typeof zendesk === "object" || typeof zendesk === "function") ? cacheFor(zendesk) : new Map();
    /**
     * What the LAST lookupMany() actually managed to do — see lookupReport().
     * Null until one runs, which is itself the honest answer for a caller (the
     * /api/meta route) that never looked anything up.
     */
    this.lastLookup = null;
  }

  get configured() {
    return Boolean(this.zendesk);
  }

  /** How this view describes its own verification posture, for the page. */
  posture() {
    if (this.configured && this.demo) {
      return {
        state: "demo",
        detail:
          "Tickets are looked up in the demonstration dataset, not in a Zendesk account. Every ticket on this page is an example." +
          truncationSentence(this.lastLookup),
        lastLookup: this.lookupReport(),
      };
    }
    return this.configured
      ? {
          state: "verifying",
          detail:
            `Ticket ids are read back from Zendesk (up to ${this.budget} distinct ids per refresh). ` +
            "A reference is only reported as a real ticket once it has been read." +
            truncationSentence(this.lastLookup),
          // The machine-readable half of the same fact. A page that wants to
          // badge "this refresh was incomplete" should read this rather than
          // parse the prose above.
          lastLookup: this.lookupReport(),
        }
      : {
          state: "unverified",
          detail:
            "No Zendesk client is configured for this view, so no reference can be confirmed to be a real ticket. " +
            "References shaped like ticket ids are reported as unverified — never as reachable, and never as missing.",
          lastLookup: this.lookupReport(),
        };
  }

  /**
   * WHAT THE LAST REFRESH ACTUALLY MANAGED TO DO — the answer to "is this page
   * complete, or did it stop looking?"
   *
   * This repository has been burned repeatedly by a check that cannot tell
   * "clean" from "did not look" (CLAUDE.md §6: `verify-deployed` exits 2 rather
   * than 0 when it cannot reach what it checks; `not_reached` is deliberately
   * distinct from `passed` in the gate ladder). The per-item answer was already
   * honest — everything past the budget comes back `checked:false` naming the
   * budget — but nothing said it at the level of the PAGE, so a render that
   * checked 15 of 90 ids looked exactly like one that checked all 90 unless a
   * reader opened every row. This is that fact, counted.
   *
   * @returns {{requested:number, read:number, fromCache:number, unchecked:number,
   *   budget:number, truncated:boolean, at:string}|null}
   */
  lookupReport() {
    return this.lastLookup;
  }

  /**
   * @param {string[]} ids
   * @returns {Promise<Map<string, {checked:boolean, found?:boolean, ticket?:object, reason?:string}>>}
   */
  async lookupMany(ids) {
    const wanted = [...new Set(ids.filter(Boolean).map(String))];
    const out = new Map();
    const now = this.now();

    if (!this.configured) {
      for (const id of wanted) out.set(id, { checked: false, reason: "no Zendesk client is configured for this view" });
      // Recorded, not skipped: "nothing could be checked" is a state this page
      // must be able to state about itself, and `truncated:false` is the
      // truthful value — no budget was reached, there was simply nothing to
      // spend it on.
      this.lastLookup = report({ requested: wanted.length, read: 0, fromCache: 0, unchecked: wanted.length, budget: this.budget, truncated: false, now });
      return out;
    }

    let spent = 0;
    let fromCache = 0;
    let unchecked = 0;
    let truncated = false;
    for (const id of wanted) {
      const cached = this.cache.get(id);
      // AN EXPIRED ENTRY IS A MISS, NOT A HIT. Dropped rather than merely
      // ignored, so a page that has stopped asking about an id does not keep
      // its dead ticket alive in the shared cache forever.
      if (cached && cached.expiresAt <= now) this.cache.delete(id);
      else if (cached) {
        fromCache += 1;
        out.set(id, cached.result);
        continue;
      }
      if (spent >= this.budget) {
        truncated = true;
        unchecked += 1;
        out.set(id, {
          checked: false,
          reason: `this refresh's lookup budget of ${this.budget} ticket reads was already spent`,
        });
        continue;
      }
      spent += 1;
      let result;
      try {
        const ticket = await this.zendesk.getTicket(id);
        // The shared client returns null on 404 — that IS the answer, not a failure.
        result = ticket ? { checked: true, found: true, ticket } : { checked: true, found: false };
      } catch (err) {
        result = { checked: false, reason: `the Zendesk read failed: ${err.message}` };
      }
      // ONLY A REAL ANSWER IS CACHED. A failed read is "unknown" (see the
      // header), and an unknown that persisted for the TTL would be the worst
      // of both: one transient 500 pinning a healthy hand-off onto the stuck
      // list for a minute of everybody's refreshes, with no read left to
      // correct it. A failure costs its budget unit and is retried next time.
      if (result.checked) {
        this.cache.set(id, { result, expiresAt: now + TICKET_CACHE_TTL_MS });
        pruneCache(this.cache, now);
      } else {
        unchecked += 1;
      }
      out.set(id, result);
    }
    this.lastLookup = report({ requested: wanted.length, read: spent, fromCache, unchecked, budget: this.budget, truncated, now });
    return out;
  }
}

function report({ requested, read, fromCache, unchecked, budget, truncated, now }) {
  return { requested, read, fromCache, unchecked, budget, truncated, at: new Date(now).toISOString() };
}

/**
 * The prose half of the truncation fact, appended to the posture sentence so a
 * reader who never opens a row still learns that the page stopped looking.
 * Empty — not "all ids were checked" — when there is nothing to report, because
 * a posture read before any lookup has run must not claim completeness it has
 * no evidence for.
 */
function truncationSentence(lastLookup) {
  if (!lastLookup || !lastLookup.truncated) return "";
  return (
    ` This refresh reached its budget: ${lastLookup.unchecked} of ${lastLookup.requested} ticket ids were NOT checked` +
    " and are reported as unverified rather than as missing. Refresh again to check more of them."
  );
}
