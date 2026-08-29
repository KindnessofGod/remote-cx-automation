// ---------------------------------------------------------------------------
// identifiers.js  —  every id the viewer can search by, named once
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
// A person reached this viewer holding the string the portal had just shown
// them — "the id that ties every record of this request together; quote it to
// have this request traced" — pasted it in, and got nothing. The decision WAS
// recorded. It simply carried a different reference (the originating ticket
// id), and the only lookup this page had was keyed on `externalRef`.
//
// An empty result is the worst answer that surface can give, because it reads
// as "the decision was never recorded" when the truth was "recorded under a
// different key". Those are opposite conclusions, and the UI presented the
// alarming one silently.
//
// TWO THINGS FIX IT, and this file is the first.
//
//   1. SEARCH EVERY SHAPE. A request carries many ids — the external
//      reference, the record id its rows are grouped by, the employment id,
//      the audit row's own uuid, the n8n execution id on an ops alert — and
//      the person in front of this tool holds WHICHEVER ONE THEY WERE GIVEN.
//      Making them classify their own id before searching is asking them to
//      know the thing they came here to find out.
//
//   2. NAME WHAT WAS SEARCHED. A lookup that finds nothing must be able to say
//      what it looked at, so a reader can tell "no record exists for this id"
//      from "this is not an id this viewer can search by". This registry is
//      what makes that sentence possible: `searchedLabels()` is generated from
//      the same list the queries are generated from, so the two cannot drift
//      into the viewer claiming to have searched somewhere it did not.
//
// THE KEY LIST IS DERIVED FROM THE LIVE STORE, NOT INVENTED. Every entry below
// was confirmed present in project your-project-ref on 2026-08-19 by
// counting rows per JSON key across all nine use cases, and every value under
// every one of them is a JSON *string* (checked with jsonb_typeof — which is
// why `->> = $1` is an exact comparison here and not a lossy cast). This repo's
// signature defect is code and fixtures agreeing while neither matches the
// store (BUILD-LOG §3.30), so the counts are recorded beside each key.
//
// NOTHING HERE READS OR WRITES. It is a list and three pure functions; the
// queries live in readStore.js and the judgement in identifierVerdict.js.
// ---------------------------------------------------------------------------

/**
 * A JSON key is safe to place in SQL text only if it cannot be anything but a
 * key. Every key below is a module constant — none is ever user input — but a
 * constant that LOOKS like input is a habit worth not having on a table whose
 * whole value is being untampered-with, so the shape is asserted rather than
 * assumed (test/auditViewLookup.test.js walks the registry with this).
 */
export const SAFE_JSON_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * THE IDENTIFIER-BEARING KEYS OF `audit_log.details`, with the live row count
 * each carried on 2026-08-19. Ordered most-general first, purely so the
 * "matched on" list a reader sees reads in a sensible order.
 *
 * WHAT IS DELIBERATELY NOT HERE: keys that describe a request rather than
 * identify one — `reason`, `decision`, `summary`, `categoryId` (a Remote
 * taxonomy id, not this request's), `receiptHash` (a fingerprint nobody is
 * handed to quote). An identifier lookup that matched a category id would
 * return every expense in that category and call it a trace.
 */
export const AUDIT_LOG_DETAIL_KEYS = [
  { key: "externalRef", label: "external reference", rows: 156 },
  { key: "employmentId", label: "employment id", rows: 201 },
  // The record ids — the same list readStore.js groups rows by (Group in the
  // feed). Searching them is what makes the drill-down's "Same record" panel
  // reachable from an id instead of only from a row already on screen.
  { key: "caseId", label: "UC-01/UC-03 case id", rows: 14 },
  { key: "storeId", label: "UC-02 expense record id", rows: 47 },
  { key: "expenseId", label: "UC-02 Remote expense id", rows: 63 },
  { key: "authorizationId", label: "UC-04 authorization id", rows: 16 },
  { key: "resignationId", label: "UC-05 resignation id", rows: 18 },
  { key: "amendmentId", label: "UC-06 amendment id", rows: 29 },
  { key: "dossierId", label: "UC-07/UC-08 dossier id", rows: 26 },
  { key: "adjustmentId", label: "UC-09 adjustment id", rows: 9 },
  { key: "reviewId", label: "review-queue id", rows: 1 },
  // THE HAND-OFF KEYS, and they are the reason this whole file exists. UC-03
  // routing a travel request on to UC-04 writes the ORIGINATING request's ids
  // onto the continuation's rows: `uc03CaseId` on both sides, and
  // `uc04AuthorizationId` on the link row. A reader holding either one is
  // holding a real, quotable identifier of a real request, and until now no
  // lookup in this viewer could see it.
  { key: "uc03CaseId", label: "originating UC-03 case id (hand-off)", rows: 2 },
  { key: "uc04AuthorizationId", label: "continuation UC-04 authorization id (hand-off)", rows: 1 },
  // Remote's own id for a work-authorization request. Null on every live row
  // so far (a blocked request never creates one), kept because a row that DOES
  // carry one is exactly the row someone holding a Remote-side id will want.
  { key: "workAuthorizationId", label: "Remote work-authorization id", rows: 1 },
  // rca-v07y: the Zendesk ticket id a `portal_reference_relinked` row names
  // (src/portal/server.js's `recordTicketRelink()`) — the id a specialist
  // holds when they open a ticket, and, until now, the one identifier this
  // file's own NOT_SEARCHABLE_HERE entry below incorrectly implied was always
  // reachable via `externalRef`. It is not: a relink row's `externalRef` is
  // the requester's OWN prior reference (or, since rca-v07y, the ticket id
  // itself only when no prior reference existed) — a ticket raised for a
  // request that already carried a different reference left the ticket id
  // reachable NOWHERE in `audit_log` before this key existed.
  // `rows: 0` here means UNMEASURED, not "confirmed empty" — unlike every
  // entry above, this count was not taken against the live store: this
  // session has no Supabase access (CLAUDE.md §6), and test/auditViewLookup
  // .test.js requires every entry's `rows` to be a number, so a sentinel
  // string is not available. `recordTicketRelink()` has written this key on
  // every relink row all along (rca-v07y only made it SEARCHABLE, not
  // present) — the next pass with live access should replace this with a real
  // count the way the 2026-08-19 pass counted every entry above.
  { key: "ticketId", label: "Zendesk ticket id (ticket hand-off)", rows: 0 },
];

/**
 * `audit_trace.details` carries the reference on EVERY row (224/224 live) plus
 * the n8n execution that produced it. That matters more than it looks: a trace
 * row is written per LLM/API attempt, and an operator who has an execution id
 * from an ops alert or from n8n's own UI has, until now, had no way to get
 * from it to the decision it belongs to.
 */
export const AUDIT_TRACE_DETAIL_KEYS = [
  { key: "externalRef", label: "external reference", rows: 224 },
  { key: "executionId", label: "n8n execution id", rows: 224 },
  { key: "workflowId", label: "n8n workflow id", rows: 224 },
];

/**
 * THE FULL SEARCH SURFACE, one entry per place a value can be looked for.
 * `readStore.lookupIdentifier()` builds its four queries from this list and
 * reports back the same list as `searched`, so what the viewer TELLS a reader
 * it searched is generated from what it actually searched.
 *
 * `uuidOnly` marks the probes that are pointless on a non-uuid string: a uuid
 * column cannot hold "50", and passing one to Postgres throws a cast error
 * rather than returning nothing — the same reason getDecision() answers a
 * non-uuid id locally.
 */
export const IDENTIFIER_TARGETS = [
  { target: "audit_log.id", table: "audit_log", field: "id", uuidOnly: true, label: "audit_log row id" },
  { target: "audit_log.actor", table: "audit_log", field: "actor", label: "actor (who acted)" },
  ...AUDIT_LOG_DETAIL_KEYS.map((k) => ({
    target: `audit_log.details.${k.key}`,
    table: "audit_log",
    field: `details.${k.key}`,
    json: k.key,
    label: `audit_log · ${k.label}`,
  })),
  { target: "audit_trace.id", table: "audit_trace", field: "id", uuidOnly: true, label: "audit_trace row id" },
  {
    target: "audit_trace.parent_id",
    table: "audit_trace",
    field: "parent_id",
    uuidOnly: true,
    label: "audit_trace parent (the decision an attempt belongs to)",
  },
  ...AUDIT_TRACE_DETAIL_KEYS.map((k) => ({
    target: `audit_trace.details.${k.key}`,
    table: "audit_trace",
    field: `details.${k.key}`,
    json: k.key,
    label: `audit_trace · ${k.label}`,
  })),
  {
    target: "workflow_claims.external_ref",
    table: "workflow_claims",
    field: "external_ref",
    label: "exactly-once ledger reference",
  },
  { target: "ops_alerts.id", table: "ops_alerts", field: "id", uuidOnly: true, label: "ops alert id" },
  { target: "ops_alerts.execution_id", table: "ops_alerts", field: "execution_id", label: "ops alert · n8n execution id" },
  { target: "ops_alerts.workflow_id", table: "ops_alerts", field: "workflow_id", label: "ops alert · n8n workflow id" },
  { target: "ops_alerts.execution_url", table: "ops_alerts", field: "execution_url", label: "ops alert · n8n execution URL" },
];

/**
 * WHAT THIS VIEWER STRUCTURALLY CANNOT SEE, stated rather than left as the
 * silence a reader has to interpret.
 *
 * The viewer reads four tables and only four. Everything below is a real
 * identifier a person may be holding and a real place it may live, and none of
 * them is in those four — so "not found here" is genuinely not the same claim
 * as "no such request". Naming the boundary is the difference between an
 * answer and an absence.
 */
export const NOT_SEARCHABLE_HERE = [
  {
    what: "A use case's own record id, when no audit row ever carried it",
    why:
      "Each use case keeps its own table (uc02_expenses, uc04_authorizations, uc05_resignations, " +
      "uc06_amendments, uc07_dossiers, uc08_dossiers, uc09_adjustments, cases, review_queue). This viewer " +
      "reads the four observability tables only, so a record id reaches it exactly when a writer copied it " +
      "into audit_log.details — and only then.",
    where: "That use case's own API (npm run ucNN-api / the /ucNN prefix on the deployment).",
  },
  {
    what: "A Zendesk ticket id that no run ever recorded",
    why:
      "A ticket id becomes findable here by being written as an externalRef or a ticketId (rca-v07y). A ticket that never reached a " +
      "workflow, or reached one that failed before its first durable write, leaves nothing in these tables.",
    where: "Zendesk itself, and the ops_alerts tab for a run that failed before it could record anything.",
  },
  {
    what: "An id issued by Remote or by Zendesk and never written back",
    why:
      "Employment ids and work-authorization ids are searchable because writers record them. Anything else " +
      "Remote-side (payroll run ids, incentive ids, expense category ids) is outside this trail.",
    where: "The Remote API, via the use case that called it.",
  },
];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The portal's submission reference: `uc04-20260819205605-2hnba`. Recognised
 * because that shape is the one a requester is most likely to be holding — it
 * is the string the portal puts on screen and calls the id that ties every
 * record together — and because it tells us something useful when it is NOT
 * found: this is a kind of id the viewer definitely searches (`externalRef`
 * in two tables), so nothing carrying it is a statement about the writers,
 * not about the reader's typing.
 */
const PORTAL_REF_RE = /^uc0[1-9]-\d{8,14}-[a-z0-9]+$/i;

/**
 * WHAT SHAPE IS THIS STRING — and, more to the point, what does NOT finding it
 * mean for that shape?
 *
 * The shape is never used to decide WHERE to search (everything is searched
 * every time; that is the whole design). It is used only to say something true
 * about an empty result, which is a different job: "nothing carries this
 * portal reference" and "nothing carries this arbitrary string" are honest
 * sentences with very different next steps behind them.
 *
 * `unknown` is a first-class answer and stays visible, for the same reason
 * traceVerdict.js keeps `unexplained`: an honest "we cannot tell what kind of
 * id this is" is the answer that stops a reader concluding their request was
 * never recorded.
 *
 * @param {string} value
 * @returns {{code: string, label: string, meaning: string}}
 */
export function classifyIdentifier(value) {
  const raw = String(value ?? "").trim();

  if (PORTAL_REF_RE.test(raw)) {
    return {
      code: "portal_reference",
      label: "a portal submission reference",
      meaning:
        "This is the shape the request portal issues and reports after a submission, and it is a kind this " +
        "viewer definitely searches — it is what `externalRef` carries in both audit_log and workflow_claims.",
    };
  }
  if (UUID_RE.test(raw)) {
    return {
      code: "uuid",
      label: "a UUID",
      meaning:
        "Every id this system generates itself is a UUID — the audit row's own id, a trace row's id and its " +
        "parent, an ops alert's id, and every use case's record id. This viewer searches all of those that " +
        "appear in the four observability tables.",
    };
  }
  if (/^\d{1,9}$/.test(raw)) {
    return {
      code: "ticket_number",
      label: "a bare number",
      meaning:
        "A request that arrived on a Zendesk ticket carries the ticket id as its external reference, so a bare " +
        "number is normally a ticket id. n8n execution ids are numeric too, and both are searched.",
    };
  }
  if (raw === "") {
    return { code: "empty", label: "an empty string", meaning: "There is nothing to look for." };
  }
  return {
    code: "unknown",
    label: "an identifier of no shape this viewer recognises",
    meaning:
      "It is not a UUID, not a portal reference and not a bare number. It may still be a legitimate external " +
      "reference — the workflows accept any string, and live history holds references like " +
      "`claim-proof-uc07-a` — so it is searched everywhere all the same. But this viewer cannot tell you " +
      "whether it is a kind of id it can search by, and it will not pretend otherwise.",
  };
}

/** Which targets are worth probing for this value (uuid-only ones, or not). */
export function targetsFor(value) {
  const isUuid = UUID_RE.test(String(value ?? "").trim());
  return IDENTIFIER_TARGETS.filter((t) => !t.uuidOnly || isUuid);
}

/** The human-readable list of everywhere a given lookup actually looked. */
export function searchedLabels(value) {
  return targetsFor(value).map((t) => ({ target: t.target, label: t.label }));
}

export { UUID_RE };
