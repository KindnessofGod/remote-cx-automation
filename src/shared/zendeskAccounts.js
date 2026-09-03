// ---------------------------------------------------------------------------
// zendeskAccounts.js — which Zendesk ACCOUNT does a stored ticket number mean?
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
//
// This project has moved Zendesk account twice: `your-subdomain` → `your-subdomain`
// (2026-08-15) → `your-subdomainhelp` (2026-08-29). Each move migrated the
// CONFIGURATION — custom field, groups, webhooks, triggers, the app — and none
// of them migrated the HISTORY, because the history lives in Supabase and has
// never recorded which account a ticket number belonged to.
//
// So `cases.external_ref`, `audit_log.details.externalRef`,
// `workflow_claims.external_ref` and `review_queue` all hold bare integers like
// "51", and every consumer used to resolve them against whatever
// `ZENDESK_SUBDOMAIN` happens to be TODAY.
//
// THE FAILURE THAT MAKES THIS WORTH A FILE. Zendesk numbers tickets from 1 per
// account. The retired account reached #143; the current one started again at
// #1. So a reference is not merely at risk of 404ing — that is the harmless
// case, and the one item 12 already described. The dangerous case is that it
// SILENTLY RESOLVES TO A REAL, UNRELATED TICKET. On 2026-08-29 a stored "3"
// pointed at a resignation record from the old account and opened somebody
// else's verification request on the new one. Nothing errors. The link works.
// The queue reports `confirmed` and names a group.
//
// And it gets WORSE with use rather than settling: the overlap window is the
// new account's ticket count, which only grows.
//
// WHY A TIMESTAMP AND NOT A COLUMN. Stamping the account onto every historical
// row is the textbook fix and it needs a schema change plus a backfill of a
// production database — and this container has never been able to reach
// Supabase over raw TCP (CLAUDE.md §6), so it could not even be executed from
// here. A row's own `created_at` already carries the answer, because an account
// cutover is a moment in time: a row written before an account existed cannot
// possibly refer to a ticket in it. No migration, no write, nothing to backfill,
// and it stays correct for rows written before anyone thought about this.
//
// WHAT IT REFUSES TO DO. It never guesses. Where two accounts could both have
// been writing — the cutover is a window, not an instant, because the old
// account's webhooks kept working until the shared secret was rotated — it
// answers `ambiguous` and the caller must not link. That is the same choice
// `ticketVerdict.js` makes everywhere else: a reference's shape is evidence,
// never a verdict, and "not checked" is not a synonym for "fine".
// ---------------------------------------------------------------------------

/**
 * Every Zendesk account this project has used, oldest first.
 *
 * `from`/`until` are the window during which a record written by this system
 * could have been referring to a ticket in that account. They deliberately
 * OVERLAP across a migration, because for a few hours both accounts could
 * genuinely produce work:
 *
 *   - `your-subdomainhelp` starts at 2026-08-29T00:00:00Z, the day its tickets
 *     began to exist. Nothing written before that can name one of its tickets.
 *   - `your-subdomain` runs until 2026-08-29T03:45:00Z, when the inbound webhook
 *     secret was rotated. Before that its nine webhooks still authenticated and
 *     could still drive a workflow; after it they receive 403 and the account
 *     became incapable of writing anything here.
 *
 * A timestamp inside both windows is ambiguous ON PURPOSE. It is a few hours
 * wide, it contains only this project's own migration-test tickets, and
 * narrowing it by guesswork would trade an honest "cannot tell" for a
 * confident answer that might be wrong — the exact trade this whole file exists
 * to refuse.
 */
export const ZENDESK_ACCOUNTS = Object.freeze([
  Object.freeze({ subdomain: "your-subdomain", from: null, until: "2026-08-15T00:00:00Z" }),
  Object.freeze({ subdomain: "your-subdomain", from: "2026-08-15T00:00:00Z", until: "2026-08-29T03:45:00Z" }),
  Object.freeze({ subdomain: "your-subdomainhelp", from: "2026-08-29T00:00:00Z", until: null }),
]);

function ms(iso) {
  if (iso == null) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : t;
}

/**
 * Which account was this record's ticket reference written against?
 *
 * @param {string|Date|null|undefined} writtenAt  the record's own created_at
 * @returns {{subdomain: string|null, ambiguous: boolean, reason: string,
 *            candidates: string[]}}
 *
 * FAILS TO `ambiguous`, NEVER TO THE CURRENT ACCOUNT. A missing or unparseable
 * timestamp is precisely the case where the old behaviour was wrong, so
 * defaulting to "today's account" would reintroduce the bug at the one input
 * most likely to hit it.
 */
export function resolveTicketAccount(writtenAt) {
  const t = writtenAt instanceof Date ? writtenAt.getTime() : ms(writtenAt);
  if (t == null) {
    return {
      subdomain: null,
      ambiguous: true,
      reason: "the record carries no usable timestamp, so the account it was written against cannot be established",
      candidates: ZENDESK_ACCOUNTS.map((a) => a.subdomain),
    };
  }
  const hits = ZENDESK_ACCOUNTS.filter((a) => {
    const from = ms(a.from);
    const until = ms(a.until);
    return (from == null || t >= from) && (until == null || t < until);
  });
  if (hits.length === 1) {
    return { subdomain: hits[0].subdomain, ambiguous: false, reason: "", candidates: [hits[0].subdomain] };
  }
  if (hits.length === 0) {
    return {
      subdomain: null,
      ambiguous: true,
      reason: "the record's timestamp falls outside every known account window",
      candidates: [],
    };
  }
  return {
    subdomain: null,
    ambiguous: true,
    reason:
      "the record was written during an account migration, when more than one Zendesk account could still create work here",
    candidates: hits.map((a) => a.subdomain),
  };
}

/**
 * Can a ticket reference stored at `writtenAt` be trusted to mean a ticket in
 * `currentSubdomain`?
 *
 * The only `true` is an unambiguous match. Everything else — a different
 * account, an ambiguous window, an unreadable timestamp, an unconfigured
 * subdomain — is `false`, and the caller must neither link it nor believe a
 * lookup made against the current account.
 */
export function referenceBelongsToCurrentAccount(writtenAt, currentSubdomain) {
  if (!currentSubdomain) return false;
  const r = resolveTicketAccount(writtenAt);
  return !r.ambiguous && r.subdomain === currentSubdomain;
}

/**
 * Should a `by-ticket/:ref` lookup REFUSE the row it just found?
 *
 * WHY THIS IS SEPARATE FROM referenceBelongsToCurrentAccount(). That predicate
 * answers "may I link this?" and is deliberately fail-closed: anything it
 * cannot positively establish is `false`. That is right for the approval
 * queue, which is *adding* a link it could simply omit.
 *
 * A by-ticket lookup is the opposite situation. It is the ZAF sidebar's ONLY
 * route to a case, so fail-closed there does not withhold a hyperlink — it
 * hides live work from the specialist holding the ticket, and it would do so
 * on every laptop where ZENDESK_SUBDOMAIN is simply unset. Hiding a real case
 * from the person deciding it is its own kind of wrong answer.
 *
 * So this refuses on POSITIVE EVIDENCE OF A DIFFERENT ACCOUNT and on nothing
 * else. Three inputs pass through, each because refusing on them would be a
 * guess in the harmful direction:
 *
 *   - no configured subdomain      — nothing to compare against
 *   - an ambiguous timestamp       — the migration window, a few hours wide
 *   - an unreadable timestamp      — cannot establish anything either way
 *
 * That is a real, named limit rather than an oversight: a row written during
 * the cutover window can still be served against the wrong account. It is
 * hours wide and contains only this project's own migration-test rows, and the
 * alternative — refusing everything unprovable — costs more than it buys here.
 *
 * @param {string|Date|null|undefined} writtenAt   the row's own createdAt
 * @param {string|null|undefined} currentSubdomain the account this deployment talks to
 * @param {string} reference                       the ref that was asked for, for the message
 * @returns {{found: false, reason: string, storedAccount: string,
 *            currentAccount: string, detail: string}|null}
 */
export function foreignTicketAccountRefusal(writtenAt, currentSubdomain, reference) {
  if (!currentSubdomain) return null;
  const resolved = resolveTicketAccount(writtenAt);
  if (resolved.ambiguous || !resolved.subdomain) return null;
  if (resolved.subdomain === currentSubdomain) return null;
  return {
    found: false,
    reason: "reference_belongs_to_another_zendesk_account",
    storedAccount: resolved.subdomain,
    currentAccount: currentSubdomain,
    detail:
      `A record is stored against reference ${JSON.stringify(String(reference))}, but it was written while this ` +
      `system was connected to the Zendesk account "${resolved.subdomain}". This deployment is connected to ` +
      `"${currentSubdomain}", and Zendesk numbers tickets from 1 per account — so the stored reference and the ` +
      `ticket you are looking at are two different tickets that happen to share a number. Refusing rather than ` +
      `returning the record, because a case about the wrong person is worse than no case at all.`,
  };
}
