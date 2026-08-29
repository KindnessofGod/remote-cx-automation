// ---------------------------------------------------------------------------
// restClient.js  —  The one place that talks to the Zendesk REST API
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
// Same reasoning as src/remote/restClient.js: centralise auth, base URL, and
// error handling for every Zendesk call in one place. Ticket endpoint shapes
// are verified against developer.zendesk.com (GET/POST/PUT /api/v2/tickets,
// the {ticket: {...}} envelope, comment/tags/status fields) — not invented.
//
// AUTH — TWO MODES, because Zendesk is mid-migration off API tokens:
//
// 1. TOKEN (legacy): HTTP Basic auth, username "{email}/token", password =
//    the API token. Verified against developer.zendesk.com. Zendesk is
//    phasing this out — per their own published timeline (found via search,
//    the announcement articles themselves are gated behind a login so
//    couldn't be read directly): tokens unused 30+ days deactivate
//    2026-07-28, NEW token creation via UI/API stops 2026-10-27, ALL tokens
//    deactivate 2027-04-30. On at least one account tested during this
//    build, new-token creation was already unavailable well before that
//    October date — rollout is evidently not waiting for the stated cutoff.
//
// 2. OAUTH CLIENT_CREDENTIALS (preferred): built by Zendesk specifically for
//    server-to-server automation with no interactive user. VERIFIED LIVE
//    against a real account (see BUILD-LOG.md decision log for the full
//    debugging story): POST {baseUrl}/oauth/tokens with a JSON body of
//    {grant_type, client_id, client_secret, scope} returns
//    {access_token, token_type: "bearer", expires_in, scope}. Two real
//    gotchas found only by testing live, not from docs:
//      - The OAuth client must be registered as CONFIDENTIAL, not Public —
//        a Public client gets a 400 "unauthorized_client" for this grant.
//      - The token's scope must match what the calling endpoint needs.
//        "tickets:read tickets:write" (used below) is sufficient for every
//        ticket read/write this app performs. It is NOT sufficient for
//        GET /api/v2/ticket_fields (that needs "account_settings:read" and
//        plain "read" too) — irrelevant to the running automation, since
//        listTicketFields() below is a one-off setup helper, not something
//        the app calls routinely.
//
// RETRY — #request() (every ticket read/write) is wrapped in ONE withRetry()
// envelope (src/shared/retry.js, invariant 10) that covers BOTH the OAuth
// token fetch (via #authHeader() -> #fetchOAuthToken(), when the cached
// token is missing/expired) AND the resource call itself. This is
// deliberate, not an oversight: #fetchOAuthToken() does NOT get its own
// separate withRetry(). If it did, a persistently-failing token endpoint
// would be retried 3 times inside #fetchOAuthToken, and then the whole
// #request would retry THAT 3 times too — 9 real attempts before giving up,
// not the 3 the wrapper promises everywhere else. With one shared envelope,
// a transient failure anywhere in "get a token, then make the call" costs at
// most 3 attempts total, and once a token is cached, later attempts skip
// #fetchOAuthToken() entirely (see #authHeader()) so no token calls are
// wasted retrying an already-authenticated request.
// Only transient failures retry: a network error (fetch() itself throwing)
// or a transient HTTP status (429/5xx, isRetryableStatus()). A 404 returns
// null on the first attempt, exactly as before; a genuine 400 (e.g. "bad
// client secret" on the token endpoint) throws immediately, exactly as
// before — retrying either would just repeat the same wrong request.
// ---------------------------------------------------------------------------

import { withRetry, isRetryableStatus } from "../shared/retry.js";
import { assertTicketBodyClean } from "./ticketHygiene.js";

export class ZendeskClient {
  /**
   * @param {object} opts
   * @param {string} [opts.subdomain]  e.g. "acme" for acme.zendesk.com — ignored if baseUrl is set
   * @param {string} [opts.baseUrl]    override for testing against a local mock (e.g. http://localhost:4014)
   * @param {string} [opts.email]      TOKEN mode: the agent/admin email the token was generated under
   * @param {string} [opts.apiToken]   TOKEN mode: the Zendesk API token
   * @param {string} [opts.clientId]     OAUTH mode: the registered OAuth client's identifier
   * @param {string} [opts.clientSecret] OAUTH mode: the registered OAuth client's secret
   * @param {number} [opts.retries] retry attempts per call — test-only seam, defaults to withRetry()'s 3
   * @param {(attempt:number) => Promise<void>} [opts.backoff] test-only seam — inject a no-op to keep tests instant; defaults to withRetry()'s real backoff
   */
  constructor({
    subdomain,
    baseUrl = null,
    email = null,
    apiToken = null,
    clientId = null,
    clientSecret = null,
    // The OAuth scope requested for client_credentials. The default is the
    // LEAST PRIVILEGE the routine path needs — the workflows only ever read and
    // write tickets — and it stays the default precisely because this client is
    // the one an automation holds. Admin-shaped work needs more: /api/v2/groups
    // 403s under `tickets:*` with "missing the following required scopes:
    // groups:read, read", so scripts/setup-zendesk-groups.mjs passes the wider
    // "read write" explicitly. Widening the default instead would hand every
    // workflow account-wide read for the sake of one setup script.
    // Verified live 2026-08-19: `read write` returns a token that reads groups
    // (200); `tickets:read tickets:write` returns a valid token that 403s there.
    scope = "tickets:read tickets:write",
    retries = undefined,
    backoff = undefined,
  }) {
    this.baseUrl = (baseUrl ?? `https://${subdomain}.zendesk.com`).replace(/\/$/, "");
    this.email = email;
    this.apiToken = apiToken;
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.scope = scope;
    this.authMode = clientId && clientSecret ? "oauth" : "token";
    this._accessToken = null;
    this._accessTokenExpiresAt = 0; // epoch ms
    this._retryOpts = {
      ...(retries !== undefined ? { retries } : {}),
      ...(backoff !== undefined ? { backoff } : {}),
    };
  }

  async #authHeader() {
    if (this.authMode === "token") {
      return `Basic ${Buffer.from(`${this.email}/token:${this.apiToken}`).toString("base64")}`;
    }
    if (!this._accessToken || Date.now() >= this._accessTokenExpiresAt) {
      await this.#fetchOAuthToken();
    }
    return `Bearer ${this._accessToken}`;
  }

  /** Raw fetch, wrapped so a genuine network error (not an HTTP error response) is tagged retryable. */
  async #doFetch(url, opts) {
    try {
      return await fetch(url, opts);
    } catch (networkErr) {
      throw Object.assign(new Error(`network error calling ${url}: ${networkErr.message}`), {
        retryable: true,
        cause: networkErr,
      });
    }
  }

  /**
   * Verified live against a real account — see the OAUTH note in the file
   * header. Deliberately NOT wrapped in its own withRetry() — see the RETRY
   * note in the file header for why: #request() below is the one retry
   * envelope, and it covers this call too.
   */
  async #fetchOAuthToken() {
    const res = await this.#doFetch(`${this.baseUrl}/oauth/tokens`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        grant_type: "client_credentials",
        client_id: this.clientId,
        client_secret: this.clientSecret,
        scope: this.scope,
      }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      const err = new Error(
        `Zendesk OAuth token request failed: ${res.status} ${detail}. If the error is "unauthorized_client", ` +
          "the OAuth client is likely registered as Public instead of Confidential — see the file header."
      );
      if (isRetryableStatus(res.status)) err.retryable = true; // a 400 (bad client secret) etc. is NOT retryable
      throw err;
    }
    const body = await res.json();
    this._accessToken = body.access_token;
    const expiresInMs = (body.expires_in ?? 1800) * 1000; // Zendesk default is 30 min
    this._accessTokenExpiresAt = Date.now() + expiresInMs - 60_000; // refresh 60s early
  }

  /**
   * Every ticket read/write goes through here, wrapped in ONE retry envelope
   * that also covers the OAuth token fetch — see the RETRY note in the file
   * header for why that's deliberate.
   */
  async #request(method, path, body = null) {
    // rca-mk6n / finding N-2, widened by rca-1qju: never let a bead id,
    // criterion id, or testing-round phrase reach a live ticket's subject or
    // tags — see ticketHygiene.js for why. Checked HERE, not in individual
    // methods like createTicket, because this is the one place every ticket
    // write in this client actually passes through (create/update/reply/
    // resolve/flag all end in a `{ticket: {...}}` body over #request) —
    // making that claim true structurally instead of merely asserting it.
    assertTicketBodyClean(body?.ticket);
    return withRetry(
      async () => {
        const headers = { Accept: "application/json", Authorization: await this.#authHeader() };
        if (body) headers["Content-Type"] = "application/json";
        const res = await this.#doFetch(`${this.baseUrl}${path}`, {
          method,
          headers,
          body: body ? JSON.stringify(body) : undefined,
        });
        if (isRetryableStatus(res.status)) {
          throw Object.assign(new Error(`Zendesk API ${method} ${path} failed: ${res.status}`), { retryable: true });
        }
        if (res.status === 404) return null;
        if (!res.ok) {
          const detail = await res.text().catch(() => "");
          throw new Error(`Zendesk API ${method} ${path} failed: ${res.status} ${detail}`);
        }
        if (res.status === 204) return null; // no content
        return res.json();
      },
      { shouldRetry: (err) => err.retryable === true, ...this._retryOpts }
    );
  }

  /** GET /api/v2/tickets/:id — the raw ticket object. */
  async getTicket(id) {
    const result = await this.#request("GET", `/api/v2/tickets/${id}`);
    return result?.ticket ?? null;
  }

  /**
   * GET /api/v2/tickets/:id/comments — the ticket's comment trail, oldest
   * first. Used by src/livedemo/ to show the client the letter once it lands,
   * without needing them to open the real Zendesk ticket themselves.
   */
  async getTicketComments(id) {
    const result = await this.#request("GET", `/api/v2/tickets/${id}/comments`);
    return result?.comments ?? [];
  }

  /**
   * POST /api/v2/tickets — creates a real ticket. This is the ONE write this
   * client makes that isn't a reaction to a decision already made elsewhere —
   * it's the "front door": src/livedemo/ uses it to simulate a client's
   * request arriving, the same way a real customer's email or web-form
   * submission would. Everything downstream (classify, fetch, gates, decide)
   * is exactly the same live n8n pipeline either way.
   * @param {object} fields  {subject, comment: {body, public}, requester: {name, email}, tags, custom_fields}
   */
  /**
   * GET /api/v2/users/search — the Zendesk user id behind an email address.
   *
   * WHY A CALLER NEEDS THIS BEFORE createTicket(). Passing
   * `requester: {name, email}` sets the ticket's REQUESTER correctly, but it
   * does not set the first comment's AUTHOR: Zendesk attributes a comment with
   * no explicit `author_id` to the authenticated caller. So a ticket raised on
   * a customer's behalf reads as though the API account wrote the customer's
   * own words — observed live on ticket #136, where both the request and the
   * automated reply appeared under the account owner's name.
   *
   * Returns null when the address matches no user, which is a legitimate
   * outcome (a first-time requester Zendesk has not created yet) and must
   * leave the caller free to fall back to `requester: {...}` rather than fail.
   *
   * @param {string} email
   * @returns {Promise<number|null>}
   */
  async findUserIdByEmail(email) {
    if (typeof email !== "string" || !email.includes("@")) return null;
    // `email:` is an exact-match field query; a bare term would match on name
    // and organisation too and could return somebody else entirely.
    const q = encodeURIComponent(`email:${email}`);
    const result = await this.#request("GET", `/api/v2/users/search.json?query=${q}`);
    const users = Array.isArray(result?.users) ? result.users : [];
    const exact = users.find((u) => String(u?.email ?? "").toLowerCase() === email.toLowerCase());
    return exact?.id ?? null;
  }

  async createTicket(fields) {
    // Harness-vocabulary guard (rca-mk6n / N-2, rca-1qju) runs inside
    // #request() below, on every ticket write this client makes — not here.
    const result = await this.#request("POST", "/api/v2/tickets", { ticket: fields });
    const ticket = result?.ticket ?? null;
    return this.#healDroppedCustomFields(ticket, fields.custom_fields);
  }

  /**
   * rca-7rkh: Zendesk has been observed silently dropping `custom_fields`
   * set on the SAME `POST /api/v2/tickets` call that creates the ticket —
   * the create returns 200 with the value already read back as null, no
   * error, no rejected field. Verified live (ticket #120): a plain PUT with
   * the byte-identical `custom_fields` payload against the same ticket DID
   * stick. Every UC-01 trigger (and every other use case's) gates on one of
   * these fields being present, so a silently-dropped field is not cosmetic
   * — the ticket sits in the queue with no automation ever firing on it.
   *
   * This re-applies, once, only the fields that did not take — turning the
   * silent drop into a self-healing follow-up write instead of a ticket
   * that never reaches the workflow it depends on. A field the create call
   * genuinely did apply is left alone: this must never fire an update on a
   * ticket that came back correct.
   */
  async #healDroppedCustomFields(ticket, requestedFields) {
    if (!ticket || !Array.isArray(requestedFields) || requestedFields.length === 0) return ticket;
    const applied = new Map((ticket.custom_fields ?? []).map((f) => [f.id, f.value]));
    const dropped = requestedFields.filter((f) => f.value != null && applied.get(f.id) !== f.value);
    if (dropped.length === 0) return ticket;
    const healed = await this.updateTicket(ticket.id, { custom_fields: dropped });
    return healed?.ticket ?? ticket;
  }

  /**
   * GET /api/v2/groups — the teams an escalation can be assigned to.
   *
   * Read-only, and that is the whole point of it existing separately from
   * createGroup() below: the escalation path CALLS THIS ONE and never the
   * other. A workflow that quietly created org structure in a live Zendesk
   * account the first time something escalated would be an outward,
   * consequential act happening as a side effect. Groups are provisioned
   * deliberately by scripts/setup-zendesk-groups.mjs; at escalation time a
   * missing group is reported on the ticket, not conjured.
   */
  async listGroups() {
    const result = await this.#request("GET", "/api/v2/groups");
    return result?.groups ?? [];
  }

  /**
   * POST /api/v2/groups — create one team.
   *
   * SETUP ONLY. Called by scripts/setup-zendesk-groups.mjs and by nothing else
   * in this repository; see listGroups() above for why that separation is
   * load-bearing rather than tidy.
   * @param {string} name
   */
  async createGroup(name) {
    const result = await this.#request("POST", "/api/v2/groups", { group: { name } });
    return result?.group ?? null;
  }

  /**
   * GET /api/v2/ticket_fields — used only as a one-off setup helper, to find
   * the id of the custom field carrying the Remote employment id (see
   * normalizeTicket.js / ZENDESK_EMPLOYMENT_ID_FIELD_ID in .env.example).
   * Not used by the automation itself.
   */
  async listTicketFields() {
    const result = await this.#request("GET", "/api/v2/ticket_fields");
    return result?.ticket_fields ?? [];
  }

  /**
   * PUT /api/v2/tickets/:id — the general-purpose update primitive.
   * `ticketPatch.subject`/`.tags`/`.additional_tags` are checked for harness
   * vocabulary in #request() below, same as createTicket() — `remove_tags` is
   * not checked, since it only names a tag being taken OFF the ticket.
   *
   * NOTE (rca-7txk, live 2026-08-23): `remove_tags` is a NO-OP on this
   * single-ticket PUT — verified against a real ticket (#72): the tag
   * survived the call and a re-read confirmed it was still present. Zendesk
   * documents `remove_tags` for the bulk `update_many` endpoint only.
   * `resolveWithLetter()`/`flagForReview()` below no longer send it — see
   * `#tagsAfterRemoval()`. This raw primitive still accepts it in a caller's
   * `ticketPatch` because it is a thin pass-through, but a caller reaching
   * for tag removal should use the two named methods, not this field.
   */
  updateTicket(id, ticketPatch) {
    return this.#request("PUT", `/api/v2/tickets/${id}`, { ticket: ticketPatch });
  }

  /**
   * Compute the tag set a caller wants after tags/additionalTags/removeTags
   * are applied, resolving `removeTags` against the ticket's OWN current
   * tags rather than Zendesk's `remove_tags` field (rca-7txk: that field is a
   * no-op on the single-ticket PUT — verified live against ticket #72, the
   * same finding scripts/clean-harness-ticket-tags.mjs worked around
   * directly). Only called when `removeTags` is non-empty; the two callers
   * below keep their original `tags` (full replace) / `additional_tags`
   * (additive) fields untouched otherwise, since those two are confirmed
   * working on the single-ticket endpoint.
   * @param {string|number} id
   * @param {string[]} tags           explicit full-replace base, if given
   * @param {string[]} additionalTags tags to add before removal
   * @param {string[]} removeTags     tags to drop
   * @returns {Promise<string[]>} the final tag list, to send via `tags`
   */
  async #tagsAfterRemoval(id, { tags = [], additionalTags = [], removeTags = [] }) {
    let base = tags.length ? tags : ((await this.getTicket(id))?.tags ?? []);
    if (additionalTags.length) base = [...new Set([...base, ...additionalTags])];
    const removeSet = new Set(removeTags);
    return base.filter((t) => !removeSet.has(t));
  }

  /**
   * Post the generated letter as a public reply and resolve the ticket — the
   * AUTO path from docs/use-cases/UC-01.md §5 ("attach to Zendesk → reply →
   * resolve"). Zendesk comments accept an `html_body` for rich content.
   * @param {string|number} id
   * @param {string} letterHtml
   * @param {object} [extra]
   * @param {string[]} [extra.tags]  the owning team's `queue_*` tag. An
   *   auto-resolved ticket is still somebody's work — it is how the escalation
   *   RATE gets a denominator (`escalation_*` over `queue_*`), which is the
   *   whole reason src/shared/escalationRouting.js splits the two tags. Omitted
   *   by every existing caller, so the emitted patch is byte-identical to what
   *   it was before this parameter existed.
   *
   *   NOTE, and it is Zendesk's semantics rather than this repo's choice: a
   *   ticket update REPLACES the tag set. This client has always done that on
   *   the flagForReview path; passing tags here extends the same behaviour to
   *   the auto path rather than inventing a second one.
   * @param {number|null} [extra.groupId]  owner decision, 2026-08-22 (mail
   *   rcc-wisp-u36ja, F-6/rca-1rx): an auto-resolved ticket is still somebody's
   *   work and is now ASSIGNED to that team, the same way an escalated one
   *   already is — never a group CREATE, and omitted (never guessed) when no
   *   group could be resolved, exactly like `flagForReview`'s `groupId`.
   */
  /**
   * Post a PLAIN-TEXT public reply and solve the ticket — the G-1 refusal and
   * G-2 deflection paths.
   *
   * Separate from `resolveWithLetter()` on purpose, even though both end in
   * `status: "solved"` plus a public comment. What is being sent is a different
   * kind of thing: one is a factual document about a named person, the other is
   * an answer explaining why no such document is coming. Sending a refusal
   * through a method called `resolveWithLetter` would make every call site and
   * every log line read as though a letter had been issued, which is the
   * opposite of what happened.
   *
   * Uses `body` rather than `html_body` because the copy is prose, not markup —
   * and because `publicReply`-style plain text is the one thing this account's
   * Zendesk integration has never mangled. (`CLAUDE.md` §4: the n8n node's
   * `publicReply` silently ESCAPES html, which is how a customer once received
   * a letter as literal `&lt;!doctype html&gt;`. Plain text sent as plain text
   * cannot hit that.)
   *
   * @param {string|number} id
   * @param {string} text   the requester-facing reply, from refusalCopy.js
   * @param {object} [opts]
   * @param {string[]} [opts.tags]
   */
  replyAndSolve(id, text, { tags = [] } = {}) {
    return this.updateTicket(id, {
      status: "solved",
      ...(tags.length ? { tags } : {}),
      comment: {
        body: text,
        public: true,
      },
    });
  }

  /**
   * @param {string[]} [opts.removeTags]  rca-iih7 / D-30, mechanism corrected
   *   by rca-7txk. Drops specific tags without needing (or clobbering) the
   *   ticket's full current tag list, unlike `tags` above — used to drop a
   *   queue-building tag (`uc01_human_review`) that a decision has made
   *   stale, e.g. from `submitReviewDecision()`'s approve path, without
   *   disturbing `queue_hr_ops` or anything else already on the ticket.
   *   Resolved via `#tagsAfterRemoval()` (fetch the ticket's own current
   *   tags, filter, send back as `tags`) rather than Zendesk's `remove_tags`
   *   field, which is a no-op on this single-ticket PUT — verified live
   *   against ticket #72.
   */
  async resolveWithLetter(id, letterHtml, { tags = [], groupId = null, removeTags = [] } = {}) {
    // When removeTags is empty this reproduces the previous {tags} behaviour
    // byte-for-byte; when it isn't, finalTags must be sent even if it comes
    // out empty (an all-tags-removed ticket) — omitting an empty `tags` field
    // here would silently leave the stale tag(s) in place.
    const tagsPatch = removeTags.length
      ? { tags: await this.#tagsAfterRemoval(id, { tags, removeTags }) }
      : tags.length
        ? { tags }
        : {};
    return this.updateTicket(id, {
      status: "solved",
      ...tagsPatch,
      ...(groupId ? { group_id: groupId } : {}),
      comment: {
        html_body: letterHtml,
        public: true,
      },
    });
  }

  /**
   * Post an internal (agent-only) note and apply tags, without resolving —
   * the HUMAN_REVIEW / ESCALATE paths (§5b/§5c: "post AI case summary" /
   * "tag `verification_exception`, route to HR Ops queue").
   * @param {string|number} id
   * @param {object} args
   * @param {string} args.note   the internal note body (AI summary + recommended action)
   * @param {string[]} [args.tags]  REPLACES the ticket's whole tag set, same
   *   Zendesk semantics `resolveWithLetter()` documents above — only safe on a
   *   fresh ticket whose tags this call is the first to set.
   * @param {string[]} [args.additionalTags]  rca-iih7 / D-30. ADDS tags without
   *   touching the rest, via Zendesk's `additional_tags` field — for a call
   *   that is not the first write to a ticket's tags and must not clobber
   *   tags a caller does not know about (e.g. an outside app's own tag).
   * @param {string[]} [args.removeTags]  removes specific tags — e.g. dropping
   *   `uc01_human_review` once a decision has been recorded, so a queue built
   *   from that tag stops showing a ticket nobody needs to look at again
   *   (§16 item 2's sibling defect, D-30: the tag naming "needs review"
   *   outlived the review itself). Resolved via `#tagsAfterRemoval()`, same
   *   as `resolveWithLetter()` above — NOT via Zendesk's `remove_tags` field,
   *   which is a no-op on this single-ticket PUT (rca-7txk, verified live
   *   against ticket #72).
   * @param {number|null} [args.groupId]  THE HAND-OFF ITSELF. A tag is a label
   *   something COULD route on; assignment is what puts the ticket in a team's
   *   queue. Resolved by src/shared/groupAssignment.js from
   *   src/shared/escalationRouting.js, and left absent when no group could be
   *   resolved — an omitted `group_id` leaves the ticket where it is, whereas a
   *   guessed one would assign real work to the wrong team. The caller says so
   *   in the note instead: visible failure, never silent.
   */
  async flagForReview(id, { note, tags = [], additionalTags = [], removeTags = [], groupId = null }) {
    // Same reasoning as resolveWithLetter() above: once removeTags is in
    // play, tags/additionalTags fold into the ONE computed final list sent
    // via `tags` (full replace) — Zendesk's `additional_tags` field still
    // works standalone (kept below when removeTags is empty), but mixing it
    // with a `remove_tags` no-op would only re-add what removal just took
    // out on the next call, or leave the caller unable to express "add this,
    // remove that" in one write at all.
    const tagsPatch = removeTags.length
      ? { tags: await this.#tagsAfterRemoval(id, { tags, additionalTags, removeTags }) }
      : {
          ...(tags.length ? { tags } : {}),
          ...(additionalTags.length ? { additional_tags: additionalTags } : {}),
        };
    return this.updateTicket(id, {
      ...tagsPatch,
      ...(groupId ? { group_id: groupId } : {}),
      comment: {
        body: note,
        public: false,
      },
    });
  }
}
