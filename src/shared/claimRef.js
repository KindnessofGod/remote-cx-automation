// ---------------------------------------------------------------------------
// claimRef.js — the key `workflow_claims` is claimed under
// ---------------------------------------------------------------------------
// WHY THIS EXISTS. `workflow_claims` is the exactly-once ledger, keyed
// `(use_case, external_ref)`, and `external_ref` was a BARE ZENDESK TICKET
// NUMBER with nothing recording which account minted it. This project has moved
// Zendesk account twice. `your-subdomain` reached #143; `your-subdomainhelp` restarted
// at #1. So on 2026-08-31 five real new tickets — 88, 92, 93, 94, 95 — were each
// refused by the PRIMARY KEY as a redelivery of an unrelated ticket from the
// retired account: the claim node's insert conflicted, the run left by the error
// output, stopped at `Duplicate Delivery — Stop` having written nothing, and n8n
// reported the execution `success`. UC-01 answered no new ticket at all, and
// five green runs said otherwise. (CLAUDE.md §7, honest-gaps item 24.)
//
// It hit UC-01 first and not worst-by-luck: the key includes the use case, so a
// collision needs the OLD account to have claimed that ref for that same use
// case, and UC-01's claimed range is by far the densest. Every other graph has
// the same latent defect and will hit it as `your-subdomainhelp` counts up towards
// #143. Nothing here is UC-01-specific.
//
// THE FIX IS ADDITIVE, AND THAT IS THE WHOLE POINT. A qualified ref
// (`your-subdomainhelp:93`) can never equal a bare one (`93`), so:
//   - every historical row keeps its meaning and keeps protecting the ticket it
//     was really about;
//   - no row is migrated, updated or deleted — which also means this needed no
//     write to the production database, unreachable from a coding session
//     anyway (CLAUDE.md §6);
//   - a THIRD account move costs one line in ZENDESK_ACCOUNTS.
// The rejected alternative was deleting the pre-migration claim rows: one
// statement, instantly correct, and it throws away the exactly-once history of
// every ticket the retired account processed, so a genuine old redelivery would
// be re-processed. Cheaper and strictly worse.
//
// This is the WRITE-side twin of src/shared/zendeskAccounts.js, which fixed the
// READ side (item 23) by deriving the account from each row's own timestamp.
// Same principle — the account is part of what a ticket number MEANS — applied
// at the other end. A new row now says so itself instead of needing to be dated.
//
// ONLY A BARE TICKET NUMBER IS QUALIFIED, and the narrowness is deliberate.
// Refs like `claim-proof-uc07-a`, a portal submission id, a content-derived
// dedupe key (src/thirdparty/, src/uc01/selfServiceLetter.js) or the
// authorization UUID stage-3 claims under (src/uc04/mobilityReviewLog.js) are
// already globally unique and carry no account ambiguity. Qualifying them would
// change a key for no reason and break continuity with the rows already holding
// them — a new failure in exchange for nothing.
// ---------------------------------------------------------------------------

import { ZENDESK_ACCOUNTS } from "./zendeskAccounts.js";

/**
 * A bare Zendesk ticket number: digits and nothing else.
 *
 * Anchored at both ends, and it must stay that way — an unanchored test would
 * qualify `uc03-continuation-9002`, whose number is not a ticket id at all.
 */
export const BARE_TICKET_REF = /^\d+$/;

/** The separator. A colon cannot occur in a bare ticket number, so a qualified
 *  ref is unambiguously distinguishable from an unqualified one by inspection,
 *  in a database row a human is reading with no code to hand. */
export const ACCOUNT_SEPARATOR = ":";

/**
 * The account tickets are being minted on NOW — the open-ended row in
 * ZENDESK_ACCOUNTS, which is the one register this project already updates on
 * an account move.
 *
 * Read from that table rather than from `ZENDESK_SUBDOMAIN` on purpose: an n8n
 * Code node cannot read process env at all (n8n blocks `$env` inside nodes by
 * default — CLAUDE.md §4 records a header that went out empty because of it),
 * so the n8n side must carry the account as a LITERAL. If the Node side keyed
 * off an environment variable and the n8n side off a literal, the two execution
 * paths could key differently and each would read the other's refs as
 * unclaimed — which is the two-ledger failure the single shared table exists to
 * prevent, reintroduced one level down.
 *
 * @returns {string|null} null only if the table has no open row, which would
 *   itself be the bug — and null means "do not qualify", never "guess".
 */
export function currentZendeskAccount() {
  const open = ZENDESK_ACCOUNTS.filter((a) => a.until === null);
  // Exactly one row may be open. Two would mean the table was edited without
  // closing the previous account, and picking either one silently would make
  // the ledger key depend on array order.
  if (open.length !== 1) return null;
  return open[0].subdomain;
}

/**
 * The key to claim `externalRef` under.
 *
 * @param {string|number|null|undefined} externalRef
 * @param {object} [opts]
 * @param {string|null} [opts.account]  defaults to `currentZendeskAccount()`
 * @returns {string|null} the qualified key, the ref unchanged when it is not a
 *   bare ticket number, or null when there is nothing to key on at all
 */
export function qualifyClaimRef(externalRef, { account = currentZendeskAccount() } = {}) {
  if (externalRef == null || externalRef === "") return null;
  const ref = String(externalRef);
  if (!account) return ref;
  if (!BARE_TICKET_REF.test(ref)) return ref;
  // IDEMPOTENT BY CONSTRUCTION: an already-qualified ref contains a colon, so
  // it fails BARE_TICKET_REF and is returned untouched. Calling this twice can
  // never produce `account:account:93`.
  return `${account}${ACCOUNT_SEPARATOR}${ref}`;
}

/**
 * Both spellings of one reference, newest first — for a READER searching the
 * ledger by the number printed on a Zendesk ticket.
 *
 * The write side is now unambiguous; the read side is not, because rows written
 * before 2026-08-31 hold the bare form. A human typing `93` into the audit
 * viewer's bug-audit tab means "the ticket in front of me", and answering
 * "no claim" because the row is filed under `your-subdomainhelp:93` would be the
 * viewer confidently reporting an absence that is really a spelling.
 *
 * @param {string|number|null|undefined} externalRef
 * @param {object} [opts]
 * @param {string|null} [opts.account]
 * @returns {string[]} deduplicated, qualified form first
 */
export function claimRefCandidates(externalRef, { account = currentZendeskAccount() } = {}) {
  if (externalRef == null || externalRef === "") return [];
  const ref = String(externalRef);
  const qualified = qualifyClaimRef(ref, { account });
  return [...new Set([qualified, ref].filter(Boolean))];
}
