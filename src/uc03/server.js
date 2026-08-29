// ---------------------------------------------------------------------------
// server.js  —  The HTTP API for UC-03's cases. NOT read-only: three POST handlers (signoff,
// decline, request-letter) live below. Only UC-07 and UC-08 have no POST route
// ---------------------------------------------------------------------------
// WHY THERE IS EXACTLY ONE WRITE ROUTE, AND WHAT IT WILL NOT DO
// UC-03 is a 🟢 low-tier router. It auto-resolves informational travel
// questions zero-touch, and the overwhelming majority of what it produces has
// no human control at all — correctly. This file used to have NO write route,
// and `docs/APPROVAL-QUEUE.md` §0 measured the consequence against production:
// UC-03 cases in the category `no_approval_surface`, "something must be signed
// and nothing can sign it".
//
// One thing could be signed: the FORMAL TRAVEL LETTER. So:
//
//   POST /api/cases/:id/signoff   -> issue the drafted letter
//   POST /api/cases/:id/decline   -> refuse it, with a required reason
//
// THAT PAIR IS NOW NARROW, AND THE NARROWING IS DELIBERATE. A standard letter
// for a traveller every gate has qualified is written and issued by the gate
// itself with nobody in the path (`docs/use-cases/UC-03.md` §23). What still
// reaches these two routes is a letter that was asked for, IS allowed, and had
// no letterhead to be written on — on which nothing is drafted, so the policy
// refuses both verbs by name. `src/uc03/signoffPolicy.js`'s header says so in
// full rather than leaving it to be discovered.
//
// and one route that is not a control at all:
//
//   POST /api/cases/:id/letter -> the EMPLOYEE collecting a letter this system
//       has already issued them. Not a control: the document exists, it went
//       out, and this hands over the bytes to the one person it is about. It
//       creates nothing, mutates nothing and audits nothing — see
//       src/uc03/letterDelivery.js for why the traveller rule is the narrowest
//       one available and why the verb is POST.
//
//   POST /api/cases/:id/request-letter -> the EMPLOYEE accepting the letter
//       offer their informational answer carried. It records a second decision
//       and drafts a letter for the signature above; it issues nothing, and it
//       cannot — see src/uc03/letterOffer.js for why the offer is not the
//       letter, and why accepting produces a new case rather than reopening the
//       answered one.
//
// and nothing else. There is no approve route for a `route_to_uc04` handoff (a
// 🟢 router must not mint a 🟡 work authorization by click), none for an
// escalation (an escalation is visible here and never closed here), and none
// for a `human_review` the router reached because it distrusted its own reading
// of the request. Each is refused BY NAME, with a sentence saying what the
// outstanding human work actually is — see src/uc03/signoffPolicy.js.
//
// The two GET routes answer `actionable` themselves. The sidebar renders that
// answer and never re-derives it; the panel is told what the controls look
// like, never whether there should be any.
// ---------------------------------------------------------------------------

import { createServer } from "node:http";
import { resolveApprover, resolveReader } from "../shared/approverAuth.js";
import { describeDecidingGate, describeGateLadder, describeDecisionFacts } from "./policyEngine.js";
import {
  evaluateLetterActionability,
  recommendLetterAction,
  settledFacts,
  approvalRoles,
  LETTER_DOCUMENT_TYPE,
} from "./signoffPolicy.js";
import { describeLetterOffer } from "./letterOffer.js";
import { evaluateLetterDelivery, describeIssuedLetter, ISSUED_REASON } from "./letterDelivery.js";
import { acceptTravelLetterOffer, submitTravelLetterSignoff } from "./workflow.js";
import { readCaseAttachments, documentOfType, findLetterCaseFor } from "./caseAttachments.js";
import { describeRiskPosture } from "../shared/riskEngine.js";
import { describeEmployee } from "../shared/employeeSubject.js";
import { describeRequesterParties } from "../shared/requesterSubject.js";
import { readJsonBody } from "../shared/httpBody.js";

/**
 * @param {object} deps
 * @param {import("../shared/caseStore.js").CaseStore} deps.caseStore
 * @param {import("../shared/audit.js").AuditLogger} [deps.audit]  required for the
 *   sign-off route; absent in a purely read-only wiring.
 * @param {import("../remote/restClient.js").RemoteClient} [deps.remote]  the sign-off's
 *   freshness re-read of the employment record.
 * @param {import("../zendesk/restClient.js").ZendeskClient|null} [deps.zendesk]  when
 *   supplied, a signed-off letter is posted to the real ticket. Never defaulted to a
 *   live client here — a handler invents no credential source of its own.
 * @param {string} [deps.allowedOrigin]
 * @param {boolean} [deps.requireSignedIdentity]  gate GETs on a signed ZAF
 *   identity, the same flag the deployment applies to writes. Defaults to
 *   false so a credential-free `npm run` clone still reads.
 * @param {{verify: (token: string) => object}|null} [deps.zafVerifier]
 * @param {{check: Function}|null} [deps.entitlement]  role-entitlement checker
 *   (src/review/approverEntitlement.js). Built by the CLI / deployment from the
 *   SAME posture that decides requireSignedIdentity, and `null` here by default
 *   for the same reason zafVerifier is. Consulted inside the sign-off policy,
 *   after every existing refusal, and able only to refuse.
 */
export function createUc03Handler({
  caseStore,
  audit = null,
  remote = null,
  zendesk = null,
  allowedOrigin = "*",
  requireSignedIdentity = false,
  zafVerifier = null,
  entitlement = null,
}) {
  return async function handle(req, res) {
    const url = new URL(req.url, "http://localhost");
    const parts = url.pathname.split("/").filter(Boolean);
    cors(res, allowedOrigin);

    if (req.method === "OPTIONS") {
      res.statusCode = 204;
      return res.end();
    }
    if (req.method === "GET" && parts[0] === "healthz") {
      return send(res, 200, { ok: true });
    }

    // READ GATE — the same signed identity a write requires, off the same flag.
    //
    // WHY. This route returns an employment id, the requester's real email
    // address, the decision, its reason and its flags. That was reachable with
    // no credential at all on the public deployment, over sequential integer
    // ticket ids, because the signed-identity mechanism was only ever applied
    // to POST. Authenticating the write and publishing the read protects the
    // audit log's attribution while giving away what the audit log is about.
    //
    // GET ONLY, on purpose: a POST is gated one layer down by resolveApprover(),
    // which is strictly stricter (it must also resolve an approver identity)
    // and would only be run twice for no gain.
    //
    // `healthz` above is deliberately outside this — it carries no customer
    // data and is how an operator establishes the service is alive at all.
    if (req.method === "GET") {
      const readGate = resolveReader({ req, requireSignedIdentity, zafVerifier });
      if (!readGate.ok) {
        return send(res, readGate.status, { ok: false, code: readGate.code, reason: readGate.reason });
      }
    }

    try {
      // GET /api/cases — every UC-03 case, newest first.
      if (req.method === "GET" && isPath(parts, ["api", "cases"]) && parts.length === 2) {
        return send(res, 200, { cases: await caseStore.listByUseCase("UC-03") });
      }

      // GET /api/cases/by-ticket/:externalRef — opened in the context of a
      // Zendesk ticket. Must come before the generic /:id route since
      // "by-ticket" would otherwise be read as a case id.
      if (req.method === "GET" && isPath(parts, ["api", "cases", "by-ticket"]) && parts[3] && parts.length === 4) {
        // Scoped to UC-03: `cases` is shared with UC-01, so a bare ticket id
        // matched that use case's rows too and rendered them here.
        const caseRow = await caseStore.findByExternalRef(parts[3], "UC-03");
        if (!caseRow) return send(res, 404, { found: false });
        // The reader identity, when there is one — the only input `youHold` can
        // be answered from. Never `req.headers` directly: an unverified name is
        // exactly what entitlement exists to stop being authoritative.
        const reader = resolveReader({ req, requireSignedIdentity, zafVerifier }).reader ?? null;
        return send(res, 200, await caseView(caseRow, { caseStore, entitlement, reader, remote }));
      }

      // GET /api/cases/:id
      if (req.method === "GET" && isPath(parts, ["api", "cases"]) && parts[2] && parts.length === 3) {
        // SCOPED TO UC-03 HERE TOO. `findById` reads the shared `cases` table,
        // so without this a UC-01 employment-verification case was rendered
        // through UC-03's gate ladder and its sign-off descriptors — the same
        // cross-use-case leak the by-ticket route above was already fixed for,
        // one route down and never noticed because nothing but a UC-03 id was
        // ever typed into it.
        const found = await caseStore.findById(parts[2]);
        const caseRow = found && found.useCase === "UC-03" ? found : null;
        if (!caseRow) return send(res, 404, { found: false });
        const reader = resolveReader({ req, requireSignedIdentity, zafVerifier }).reader ?? null;
        return send(res, 200, await caseView(caseRow, { caseStore, entitlement, reader, remote }));
      }

      // POST /api/cases/:id/request-letter   body: {session:{authenticatedEmploymentId}}
      //
      // THE EMPLOYEE ACCEPTING THE OFFER THEIR ANSWER CARRIED — not an
      // approval, and deliberately not routed through `resolveApprover()`,
      // which resolves the internal identity that SIGNS things. The person
      // asking here is the traveller, and the identity that matters is the same
      // authenticated session the original request was verified with.
      //
      // TWO IDENTITIES, AND BOTH ARE CHECKED. The CALLER must satisfy the same
      // signed-identity posture the GET routes do, so an anonymous POST cannot
      // reach this at all on the deployment; the SUBJECT is the session in the
      // body, supplied by whichever surface authenticated the employee (the
      // portal from its persona, n8n from the Zendesk-authenticated requester)
      // exactly as `handleTravelInquiry()`'s `ticket.session` always has been.
      // That session is never believed on its own: the re-run verifies it
      // against the record it freshly reads from Remote, and that is the check
      // that decides. Without a session, no letter can be drafted at all — the
      // identity gate escalates, which is the property a test pins.
      //
      // It creates a DECISION, never a document anybody receives:
      // `submitTravelLetterSignoff` above is still the only route that issues.
      // MATCHED BEFORE the signoff route below, whose verb segment is not
      // whitelisted (it accepts `deny` as a legacy spelling, so it cannot be).
      // Order is what keeps `request-letter` out of `submitTravelLetterSignoff`.
      if (
        req.method === "POST" &&
        isPath(parts, ["api", "cases"]) &&
        parts[2] &&
        parts[3] === "request-letter" &&
        parts.length === 4
      ) {
        const readGate = resolveReader({ req, requireSignedIdentity, zafVerifier });
        if (!readGate.ok) {
          return send(res, readGate.status, { ok: false, code: readGate.code, reason: readGate.reason });
        }
        const body = await readJsonBody(req);
        const result = await acceptTravelLetterOffer(
          { caseId: parts[2], session: body.session ?? null },
          { remote, audit, caseStore, zendesk }
        );
        return send(res, result.status, result);
      }

      // POST /api/cases/:id/letter   body: {session:{authenticatedEmploymentId}}
      //
      // THE EMPLOYEE COLLECTING THE LETTER THIS SYSTEM ISSUED THEM. Not a
      // control and not an approval: the document already exists and already
      // went out — this is the route that hands over the bytes.
      //
      // WHY IT EXISTS AT ALL. The standard letter is now written and issued by
      // the gate with nobody in the path, and the only delivery that existed was
      // `submitTravelLetterSignoff()`'s post to a Zendesk ticket. A request that
      // never went through Zendesk — the portal's, which is most of them — had a
      // correct, durable, audited, ISSUED document and no way for its subject to
      // read it. `CLAUDE.md` §7's honest-gaps list names that failure shape four
      // times over; this is the one where the audit row claims a delivery.
      //
      // WHY A POST FOR A READ, WHICH IS THE OBVIOUS OBJECTION. The traveller's
      // identity is a `{session}` object, exactly as
      // `/api/cases/:id/request-letter` above takes it — that is the shape every
      // surface authenticating an employee already builds for this use case, and
      // matching it is worth more than the verb. It also keeps an employment id
      // out of a URL and out of every access log that URL passes through. This
      // route creates nothing, mutates nothing, and audits nothing.
      //
      // MATCHED BEFORE the signoff route below for the same reason
      // `request-letter` is: that route's verb segment is not whitelisted.
      if (
        req.method === "POST" &&
        isPath(parts, ["api", "cases"]) &&
        parts[2] &&
        parts[3] === "letter" &&
        parts.length === 4
      ) {
        const readGate = resolveReader({ req, requireSignedIdentity, zafVerifier });
        if (!readGate.ok) {
          return send(res, readGate.status, { ok: false, code: readGate.code, reason: readGate.reason });
        }
        const body = await readJsonBody(req);
        const found = await caseStore.findById(parts[2]);
        const caseRow = found && found.useCase === "UC-03" ? found : null;
        // `includeContent` because handing over the letter is the whole point;
        // every other reader in this file deliberately takes the hash only.
        const { documents } = caseRow
          ? await readCaseAttachments(caseStore, caseRow.id, { includeContent: true })
          : { documents: [] };
        const letterDocument = documentOfType(documents, LETTER_DOCUMENT_TYPE);
        const verdict = evaluateLetterDelivery({ caseRow, session: body.session ?? null, letterDocument });
        if (!verdict.allowed) {
          return send(res, verdict.status, { ok: false, code: verdict.code, reason: verdict.reason });
        }
        return send(res, 200, describeIssuedLetter(caseRow, letterDocument));
      }

      // POST /api/cases/:id/signoff   body: {note}
      // POST /api/cases/:id/decline   body: {note}  (note REQUIRED)
      //   `/deny` is still routed as the legacy spelling — the segment is not
      //   whitelisted here, and submitTravelLetterSignoff() canonicalises it, so
      //   the installed ZAF bundle keeps working until it is re-uploaded. An
      //   unrecognised verb still fails the policy's own ACTIONS check.
      if (req.method === "POST" && isPath(parts, ["api", "cases"]) && parts[2] && parts[3] && parts.length === 4) {
        const body = await readJsonBody(req);

        // IDENTITY BEFORE ACTION (finding F-20). `body.approver` must never be
        // handed to the policy as the human who signed: an unauthenticated curl
        // could then name anyone — including someone holding the very role this
        // gate exists to require — and the audit log would record that name as
        // fact. resolveApprover() is the one shared decision about where an
        // identity may come from; with requireSignedIdentity on it is a verified
        // claim and nothing else, and it refuses rather than degrading when
        // misconfigured.
        const identity = resolveApprover({ req, body, requireSignedIdentity, zafVerifier });
        if (!identity.ok) {
          return send(res, identity.status, { ok: false, code: identity.code, reason: identity.reason });
        }

        const result = await submitTravelLetterSignoff(
          { caseId: parts[2], action: parts[3], approver: identity.approver, note: body.note ?? "" },
          { remote, audit, caseStore, zendesk, entitlement }
        );
        return send(res, result.status, result);
      }

      return send(res, 404, { ok: false, code: "no_such_route", path: url.pathname });
    } catch (err) {
      console.error(`[uc03-api] ${req.method} ${url.pathname} failed: ${err.stack}`);
      return send(res, 500, { ok: false, code: "internal_error", reason: err.message });
    }
  };
}

/**
 * The reason slug in plain words, plus where it sits in the gate order.
 *
 * The slug itself is NOT replaced — it stays on `caseRow.reason`, because it
 * is the exact string in `audit_log`, in the metrics exception ranking and in
 * the n8n port, and therefore the thing somebody searches by. `decidedBy`
 * carries the meaning beside it, and `gateLadder` carries the whole ordered
 * sequence with each rung marked passed / decided / not_reached, so a reader
 * can see how far the request got rather than only where it stopped.
 *
 * Both are null/[] for a reason with no row rather than a guess — see
 * src/shared/gateLadder.js.
 */
function describeDecision(caseRow) {
  return {
    decidedBy: describeDecidingGate(caseRow?.reason),
    gateLadder: describeGateLadder(caseRow?.reason),
    // THE FIGURES, REBUILT FROM THE STORED ROW.
    //
    // A decision reaches this route days after it was made, so the reviewer here
    // is the one furthest from the run — and until now they got a reason slug, a
    // gate name and a `means` sentence with no numbers in it at all. Most of the
    // figures survive on the row: `cases.classification` is a jsonb column
    // holding the destination, both dates, the confidence and which reader
    // produced them, so the day count, the cap comparison and the threshold
    // comparison all recompute exactly (`describeDecisionFacts` derives them
    // rather than reading them off an outcome, precisely so this call is
    // possible).
    //
    // TWO INPUTS ARE DELIBERATELY NOT PASSED, and both are `null`/`[]` rather
    // than a stand-in: the supported-country SET and the upstream-failure list
    // are per-run facts nothing persists on `cases`. Passing an empty Set would
    // be worse than passing nothing — the bundle reads a size of 0 as "the
    // registry came back empty", which is a finding about our own read, and
    // manufacturing it here would be the defaulted-value-that-looks-like-a-
    // measurement this repo has paid for three times. Passing null makes it an
    // explicit unknown that names `audit_log`'s `supportedCountriesChecked` as
    // the place the real set is recorded.
    decisionFacts: describeDecisionFacts({
      reason: caseRow?.reason,
      classification: caseRow?.classification ?? null,
      supportedCountries: null,
      upstreamFailures: [],
    }),
  };
}

/**
 * One case, as the sidebar needs it: the row, why it was decided that way,
 * whether anybody may act on it, and who is being asked to.
 *
 * `actionable` IS ANSWERED HERE, SERVER-SIDE, and that is the point of this
 * function existing. `zaf-app/assets/main.js`'s `loadUc03` hard-codes
 * `actionable: false` in the browser — the only one of the nine loaders that
 * decides it client-side — because until now there was no route for it to be
 * true about. It fails closed, so it is safe, but the repo's own rule is that
 * the server decides and the panel renders. The server now decides. Wiring the
 * loader to read this answer is a one-function change in `zaf-app/`, which this
 * unit of work does not own; until it lands, the sidebar shows a correct
 * read-only UC-03 panel and the sign-off is reachable over the API.
 */
async function caseView(caseRow, { caseStore, entitlement = null, reader = null, remote = null }) {
  const { reviewEntry, documents } = await readCaseAttachments(caseStore, caseRow.id);
  const letterDocument = documentOfType(documents, LETTER_DOCUMENT_TYPE);
  const actionability = evaluateLetterActionability({ caseRow, reviewRow: reviewEntry, letterDocument });
  // THE OFFER, REBUILT FROM THE STORED ROW — which is the whole reason it is
  // answered here and not only in the workflow's return value. The employee who
  // needs the letter usually finds out days after the answer arrived, in a
  // different process, holding nothing but a ticket id. `followOnCase` is the
  // newest case on the same ticket, so an offer that has already been taken
  // says so and names the case it became, instead of inviting a second click
  // the exactly-once ledger would then refuse.
  //
  // ASKED BY PARENT LINK, NOT BY REFERENCE. The two rows no longer share one:
  // an accepted letter request raises a Zendesk ticket and is repointed at it,
  // so "the newest case on this ticket" would find nothing when asked about the
  // answered case — and this case would go on advertising an offer somebody has
  // already taken. See findLetterCaseFor().
  const followOnCase = await findLetterCaseFor(caseStore, caseRow);

  return {
    found: true,
    caseRow,
    // WHO THIS IS ABOUT — the fields that will appear over the signer's name.
    //
    // The specialist reading this screen is being asked for ONE thing: to put
    // Travel & Mobility Support's signature on a letter. `renderTravelLetterHtml()`
    // prints Employee / Job title / Employment status / Contract type / Start
    // date, and until now the panel showed none of them — it showed
    // `employmentId`, a UUID, where the person belongs. Each of the five is here
    // because the letter ASSERTS it, and a signature over an assertion nobody
    // was shown is not a control.
    //
    // The sixth, `country_code`, is not on the letter and is here anyway: UC-03
    // reads it as `origin_country` (workflow.js) and hands it to UC-04 on every
    // `route_to_uc04`, and `policyEngine.js` already calls it "Home country on
    // the record". A trip's origin is what makes its Schengen and 183-day
    // framing mean anything.
    //
    // WHAT IS DELIBERATELY NOT HERE. Compensation: the letter's own base-pay row
    // is unreachable on a real record (`normalizeEmployment()` yields no flat
    // `base_salary`, on purpose), no gate in this use case reads pay, and
    // CLAUDE.md §3 makes money a decision rather than a default —
    // test/employeeSubject.test.js pins that this view publishes none. Work
    // email: the identity gate has already compared the requester's address to
    // the record's and recorded the verdict as a flag, and printing both invites
    // a reader to re-adjudicate a check the system made while putting a second
    // personal identifier on the screen.
    //
    // READ FRESH, NOT STORED. See src/shared/employeeSubject.js's header for why
    // this is a live read rather than a name frozen on the row: this is the same
    // record `submitTravelLetterSignoff()` re-reads before it issues anything, so
    // the screen and the button can no longer disagree. A failed read degrades
    // this block and never the case — `state` says which of the five things
    // happened, and the panel never shows a blank or the id relabelled.
    employee: await describeEmployee({
      remote,
      employmentId: caseRow.employmentId,
      fields: ["full_name", "job_title", "status", "contract_type", "start_date", "country_code"],
    }),
    // WHO ASKED, in the one shape all nine publish (src/shared/requesterSubject.js).
    //
    // UC-03's answer is usually "the employee themselves", and that is exactly
    // why it is worth stating rather than assuming: the letter names one person
    // and the session that asked for it names another value, and nothing on the
    // screen previously said whether they were the same. `actingFor` COMPARES
    // them rather than asserting the usual case, so the day a delegated request
    // arrives the sentence changes instead of staying quietly wrong.
    //
    // `identityVerified` is read off the FLAGS, not recomputed: the gate pushes
    // `identity_<reason>` only when it refuses, so the absence of any such flag
    // is the gate's own "verified" and this view invents no second opinion.
    requester: describeRequesterParties({
      filerId: caseRow.requester,
      subjectEmploymentId: caseRow.employmentId,
      identityVerified: !(caseRow.flags ?? []).some((f) => typeof f === "string" && f.startsWith("identity_")),
      source: caseRow.source ?? null,
      externalRef: caseRow.externalRef ?? null,
      model: {
        authenticatedState: "authenticated_employee_session",
        // Says WHAT the session proved and stops there. Whether the filer is
        // the traveller is `actingFor`'s answer and is a COMPARISON — asserting
        // it here too produced a block that contradicted itself the first time
        // a mismatched session was driven through it.
        authenticatedFinding: (who) =>
          `Filed from a session authenticated for employment ${who}. UC-03's session carries an employee's OWN employment id — this use case has no admin or third-party intake — so this value names an employee, not an administrator acting for one.`,
        unauthenticatedFinding:
          "No authenticated session. The request arrived with none, and the workflow recorded the literal value 'unauthenticated' rather than a name — so nobody is identified as having asked, and the identity gate refused it at position 1.",
        selfFinding:
          "The session's employment id and the case's employment id are the same value, so the person asking is the person the letter would be about. That is the shape UC-03 is built for.",
        onBehalfFinding: (who, about) =>
          `The session was authenticated for employment ${who} but this case is about employment ${about} — they are NOT the same person. UC-03 has no delegated intake, so this combination is not one the identity gate is designed to pass.`,
        identityChecks:
          "that a session was present, that the employment record could be read from Remote, and that the session's employment id equals the id on that record",
        identityVerifiedFinding:
          "Verified: a session was present, the employment record was read, and the session's employment id matched the record's own id. That is an authenticated session for this employment — it is not proof of who was at the keyboard.",
        identityUnverifiedFinding:
          "NOT verified. One of the three conditions failed — no session, no readable employment record, or a session naming a different employment. The specific reason is on `flags` as `identity_<reason>`. This is a failure to confirm, not a finding that the asker was an impostor.",
      },
    }),
    // THE USE CASE'S TIER AND THIS REQUEST'S RISK, NAMED APART — the same two
    // facts every other server sends, and the reason the sidebar can print
    // "resolves on its own; a human is involved only by exception" above a
    // control that IS that exception.
    ...describeRiskPosture("UC-03", caseRow.flags ?? []),
    actionable: actionability.allowed,
    actionableReason: actionability.reason,
    // WHAT THIS SYSTEM WOULD DO, AND WHY — a proposal beside the compiled case,
    // never instead of it. Null on every case with nothing to propose. It is
    // computed FROM `actionability` above, so it can never propose a click the
    // policy would refuse. See recommendLetterAction()'s header.
    recommendation: recommendLetterAction({ caseRow, reviewRow: reviewEntry, letterDocument }),
    // What the EMPLOYEE may still ask for on this case, as distinct from what a
    // SPECIALIST may do to it (`actionable`). They are different people, and
    // conflating them is how an auto-resolved case ended up looking like a case
    // with nothing left in it.
    letterOffer: describeLetterOffer({ caseRow, followOnCase }),
    // WHERE THE TRAVELLER COLLECTS THE DOCUMENT, when there is one to collect.
    // Stated by the server, like every other route this view names, so a surface
    // never hard-codes a path — and null rather than an always-present object,
    // because a fetch link on a case with no letter is a link to a 404.
    //
    // `contentHash` is here and the CONTENT is not: this view is what a sidebar
    // renders, and a specialist's panel has no business holding an employee's
    // pay. The hash lets a reader confirm the document they were handed is the
    // one history records.
    letter:
      letterDocument && caseRow.reason === ISSUED_REASON
        ? {
            issued: true,
            issuedWithoutSignature: true,
            documentId: letterDocument.id,
            contentHash: letterDocument.contentHash ?? null,
            collect: { method: "POST", path: `/api/cases/${caseRow.id}/letter` },
            collectableBy: "the employee the letter is about, authenticated — nobody else",
          }
        : null,
    // WHO IS BEING ASKED TO DECIDE, in the shape docs/SIDEBAR-APPROVAL-ROLES.md
    // §3 specifies, so the sidebar renders it with no sidebar change. `youHold`
    // is null unless entitlement is enforced AND the reader is verified — null
    // is not true, and only one of those is safe to render as a tick.
    approvalRoles: approvalRoles({ caseRow, reviewRow: reviewEntry, entitlement, reader }),
    // Null while the case is still open: there is nothing settled to describe,
    // and an empty bundle reads like missing data.
    settled: settledFacts(reviewEntry, letterDocument),
    ...describeDecision(caseRow),
    reviewEntry,
    documents,
  };
}

function cors(res, allowedOrigin) {
  res.setHeader("Access-Control-Allow-Origin", allowedOrigin);
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  // Authorization/X-ZAF-Token are allow-listed because the READ gate needs the
  // signed token on a GET; a browser would otherwise fail the preflight.
  // X-ZAF-Approver is the unsigned local posture's header, same as every other
  // approval API's CORS line.
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-ZAF-Approver, X-ZAF-Token");
  res.setHeader("Vary", "Origin");
}

function isPath(parts, expected) {
  return expected.every((segment, i) => parts[i] === segment);
}

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

/** Start the API on `port`. Returns the http.Server once listening. */
export function startUc03Server(deps, port = 4051) {
  const server = createServer(createUc03Handler(deps));
  // Bound how long a connection may sit open, so a slow/hostile client can't
  // exhaust server resources. headersTimeout < requestTimeout, per Node's
  // own constraint (headers are a prefix of the full request).
  server.requestTimeout = 30_000;
  server.headersTimeout = 10_000;
  return new Promise((resolve) => server.listen(port, () => resolve(server)));
}
