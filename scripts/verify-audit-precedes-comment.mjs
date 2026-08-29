#!/usr/bin/env node
// ---------------------------------------------------------------------------
// verify-audit-precedes-comment.mjs — §16 item 7, made repeatable (rca-gv45)
// ---------------------------------------------------------------------------
// WHAT §16 ITEM 7 REQUIRES
// "Audit trace — the durable audit row's timestamp precedes the Zendesk
// comment's." (qa/contracts/UC-01-acceptance.md §16.7)
//
// WHY THIS DID NOT EXIST BEFORE THIS SCRIPT
// UC-01 round 6 ran under persona isolation: ops could read /audit but not the
// ticket, the specialist could read the ticket but not the feed. Neither side
// alone can compare a timestamp against the other, so the round recorded item
// 7 as CONSISTENT (audit 18:44:39.947Z; comment "7 minutes ago", rendered) but
// could not reach PROVEN — not because the ordering was in doubt, but because
// nobody read the comment's ABSOLUTE timestamp. The render is lossy; the
// underlying Zendesk record is not.
//
// This script is meant to run OUTSIDE any isolated persona's turn — after a
// round, by whoever synthesises its results (who was never denied either
// surface) — so isolation is never weakened to make item 7 measurable. See
// rca-gv45's own notes for the full reasoning, including why the two
// alternatives (A1: read through the ZAF app frame; A2: a server-side OAuth
// read, used here) are not equivalent and why A2 was chosen: A1 would be new
// Zendesk-REST plumbing added to a live, installed production ZAF app
// (zaf-app/ makes zero /api/v2 calls today) for a QA-only need; A2 reuses two
// pieces of tested infrastructure that already exist for exactly this kind of
// read (src/surfaceverify/auditApi.js's fetchRef, src/zendesk/restClient.js's
// ZendeskClient) and needs no production deploy.
//
// PRECISION — READ THIS BEFORE TRUSTING A "PROVEN" OUTPUT
//   - the durable audit row carries MILLISECOND precision (Supabase timestamptz).
//   - a Zendesk comment's `created_at` carries WHOLE-SECOND precision — verified
//     live against both /api/v2/tickets/:id/comments.json and .../audits.json;
//     neither has a sub-second field to reach for.
// So a comment's `created_at` is treated as the EARLIEST instant it could be
// (floor), never the exact one. "PROVEN" means the audit row's millisecond
// timestamp is strictly before that floor — i.e. before the comment could
// possibly have posted. When the two land in the same whole second, ordering
// genuinely cannot be decided at this precision: that is reported as TIE, not
// guessed at either direction. See rca-gv45's own note: this was measured
// once (n=1, gap 1.053s) — do not read "ties are rare" into this script.
//
// WHAT THIS PROVES AND WHAT IT DOES NOT
// This confirms the DATA is reachable, at what precision, from a SERVER-SIDE
// OAuth client_credentials caller — not from inside the ZAF app frame a
// specialist actually uses. That is the honest boundary of what a script
// invoked from a shell can prove; see the bead for the still-open question of
// whether a same-second-or-better guarantee is what §16 item 7 requires, and
// for a structural alternative worth evaluating (the audit row recording the
// comment id it announces, which would prove ordering with no clock at all).
//
// USAGE
//   node scripts/verify-audit-precedes-comment.mjs <ticket-id>
//   node scripts/verify-audit-precedes-comment.mjs 96 --target=http://localhost:4044
//
// EXIT CODES
//   0  PROVEN — the audit row strictly precedes the comment's earliest instant
//   1  VIOLATION — the audit row is at or after the comment by 1s or more —
//      a REAL defect in ordering, not a precision artefact
//   2  could not tell — no decision row / no public comment found, the target
//      or portal key was refused, OR the two land in the same whole second
//      (TIE — ambiguous at this precision, an owner question, not a defect)
//
// Requires in .env: PORTAL_ACCESS_KEY (to read /audit/api/refs), and either
// ZENDESK_OAUTH_CLIENT_ID/SECRET or ZENDESK_EMAIL/API_TOKEN plus
// ZENDESK_SUBDOMAIN (to read the ticket's comments).
// ---------------------------------------------------------------------------

import "dotenv/config";
import { config, isZendeskConfigured } from "../src/shared/config.js";
import { ZendeskClient } from "../src/zendesk/restClient.js";
import { resolveTarget, verifyPortalKey, SurfaceUnreachableError } from "../src/surfaceverify/target.js";
import { fetchRef } from "../src/surfaceverify/auditApi.js";

const argv = process.argv.slice(2);
const ref = argv.find((a) => !a.startsWith("--"));
const opt = (name) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
};

async function main() {
  if (!ref) {
    console.error("Usage: node scripts/verify-audit-precedes-comment.mjs <ticket-id> [--target=<url>]");
    process.exit(2);
  }

  const portalKey = process.env.PORTAL_ACCESS_KEY;
  if (!portalKey) {
    console.error("PORTAL_ACCESS_KEY is not set — cannot read /audit/api/refs. See .env.example.");
    process.exit(2);
  }
  if (!isZendeskConfigured()) {
    console.error(
      "Zendesk is not configured — set ZENDESK_SUBDOMAIN plus either\n" +
        "ZENDESK_OAUTH_CLIENT_ID/ZENDESK_OAUTH_CLIENT_SECRET or ZENDESK_EMAIL/ZENDESK_API_TOKEN in .env."
    );
    process.exit(2);
  }

  let baseUrl;
  try {
    baseUrl = resolveTarget({ explicit: opt("target") });
    await verifyPortalKey({ baseUrl, portalKey });
  } catch (err) {
    if (err instanceof SurfaceUnreachableError) {
      console.error(`Could not reach the audit surface: ${err.message}`);
      process.exit(2);
    }
    throw err;
  }

  console.log(`§16 item 7 — ticket ${ref} against ${baseUrl}\n`);

  // --- the audit side: the last DECISION-kind row under this ref (the most
  // recent settling decision — "event" rows like a refused approval attempt
  // never themselves produce the customer-facing comment this item is about).
  let refPayload;
  try {
    refPayload = await fetchRef({ baseUrl, portalKey, ref });
  } catch (err) {
    console.error(`Could not read /audit/api/refs/${ref}: ${err.message}`);
    process.exit(2);
  }
  const decisionRows = (refPayload.decisions ?? []).filter((d) => d.kind === "decision");
  if (decisionRows.length === 0) {
    console.error(`No decision-kind audit_log row found for external ref ${ref}. Nothing to compare.`);
    process.exit(2);
  }
  const auditRow = decisionRows[decisionRows.length - 1]; // ascending order per fetchRef
  const auditAtMs = Date.parse(auditRow.at);

  // --- the Zendesk side: the last PUBLIC comment on this ticket.
  const zendesk = new ZendeskClient({
    subdomain: config.zendesk.subdomain,
    email: config.zendesk.email,
    apiToken: config.zendesk.apiToken,
    clientId: config.zendesk.oauthClientId,
    clientSecret: config.zendesk.oauthClientSecret,
    // default scope (tickets:read tickets:write) is enough — this is a
    // routine ticket read, not the admin-shaped groups read setup-zendesk-
    // groups.mjs needs the wider "read write" scope for.
  });
  let comments;
  try {
    comments = await zendesk.getTicketComments(ref);
  } catch (err) {
    console.error(`Could not read ticket ${ref}'s comments from Zendesk: ${err.message}`);
    process.exit(2);
  }
  const publicComments = comments.filter((c) => c.public);
  if (publicComments.length === 0) {
    console.error(`Ticket ${ref} has no public comment. Nothing to compare — this may be a pure-refusal case.`);
    process.exit(2);
  }
  const comment = publicComments[publicComments.length - 1];
  const commentFloorMs = Date.parse(comment.created_at);

  const gapMs = commentFloorMs - auditAtMs;

  console.log(`audit row     : ${auditRow.at}  (action=${auditRow.action}, id=${auditRow.id})`);
  console.log(`public comment: ${comment.created_at}  (id=${comment.id}, whole-second precision — this is its EARLIEST possible instant)`);
  console.log(`gap (comment floor − audit) = ${(gapMs / 1000).toFixed(3)}s\n`);

  if (gapMs > 0) {
    console.log(
      `PROVEN — the audit row precedes the comment's earliest possible instant by ${(gapMs / 1000).toFixed(3)}s. ` +
        `Boundary of this proof: read as a server-side OAuth client_credentials caller, not through the ZAF app ` +
        `frame a specialist actually uses (rca-gv45).`
    );
    process.exit(0);
  }
  if (gapMs > -1000) {
    console.log(
      "TIE — the audit row and the comment land in the same whole second. Ordering cannot be decided at this " +
        "precision (Zendesk gives no sub-second field on either endpoint checked). This is an owner question, not " +
        "a defect: does a procedure that decides ordering except within one whole second clear §16 item 7's bar of " +
        "PROVEN? (rca-gv45). Do not read a single TIE, or a single non-TIE, as the general case — this script " +
        "reports one pairing, not a distribution."
    );
    process.exit(2);
  }
  console.log(
    `VIOLATION — the audit row is at or after the comment by ${Math.abs(gapMs / 1000).toFixed(3)}s. This is a real ` +
      "ordering defect, not a precision artefact (the gap exceeds the 1s floor uncertainty)."
  );
  process.exit(1);
}

main().catch((err) => {
  console.error(err.stack || err.message);
  process.exit(2);
});
