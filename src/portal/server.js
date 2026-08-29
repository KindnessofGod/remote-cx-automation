// ---------------------------------------------------------------------------
// server.js  —  The request portal's HTTP API
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
// Seven of this repo's nine use cases had no entry point. UC-01 has three
// (the live Zendesk trigger, the playground, the chat demo), UC-06 has the
// Remote UI stand-in — and UC-02, 03, 04, 05, 07, 08 and 09 could only ever be
// seen as the two or three rows their own `cli.js` seeded at boot. You could
// read what they decided; you could not make one decide anything. This is the
// missing surface: one Remote-styled intake page with seven request forms,
// each one submitting the shape that use case's workflow actually reads.
//
// It is the same argument src/remoteui/ makes, generalised. Every trigger in
// this system starts as a person asking for something — an expense, a
// trip, a resignation, a relocation — and in the real product those requests
// begin inside Remote, not inside Zendesk. Remote has no public API that emits
// "an employee submitted an expense for validation" as an event, so nothing in
// this repo could demonstrate any of these flows from where they truly start.
// This page stands in for those missing surfaces, and says so on itself.
//
// THE ONE ARCHITECTURAL DECISION WORTH READING BEFORE CHANGING ANYTHING HERE
// The portal calls each workflow function IN-PROCESS. It does NOT call the
// nine use-case APIs over HTTP, and it does not require any of them to be
// running.
//
// That is not a convenience choice. UC-07's and UC-08's APIs have NO POST
// route — not a POST route that refuses, an absence of one, asserted by
// test/uc08Server.test.js ("any POST 404s as no_such_route"). "No execution
// path exists" is the single headline artifact of the 🔴 tier in this
// portfolio. Routing portal intake through those APIs would have required
// opening a write route into both of them, which is to say: the portal would
// have had to break the thing the portfolio is arguing, in order to
// demonstrate it. Calling the workflow function directly costs nothing and
// breaks nothing, because handleRelocationReview() and handleTaxInquiry() take
// an audit logger and a dossier store and NO remote/zendesk client at all —
// there is no write-capable dependency for this file to pass them even by
// mistake. See the UC-07/UC-08 adapters below: their `deps` objects are
// visibly missing `remote`, and that is the point.
//
// WHAT THIS FILE DELIBERATELY DOES NOT DO
//   - It re-implements no gate. Every decision, reason, flag and record id in
//     a response came out of the real `handle*` function; this file's own
//     logic is limited to shaping form fields into the ticket object that
//     function documents, and shaping its return value into one common
//     envelope the browser can render without branching per use case.
//   - It offers no approve/decline anywhere. The portal is an INTAKE surface, and
//     now also a READ-ONLY status surface ("My requests", below). The human
//     gates live where they already live — the ZAF sidebar and each use case's
//     own approval endpoint — and duplicating them here would create a second,
//     unaudited place a 🟡 decision could be made. Showing a requester what
//     happened to their request is reading; deciding is not, and the line
//     between them is exactly where GET /api/my-requests stops.
//   - It re-implements no authentication. Who may reach this API at all is
//     one shared key, decided by ./access.js — a deliberately weaker
//     mechanism than the nine APIs' ZAF-signed identity, because a page that
//     is not inside Zendesk has no ZAF token to present. Read that file's
//     header before changing anything about it.
//   - It writes to its OWN in-memory stores, not to the stores the nine
//     `npm run ucNN-api` processes seeded. That boundary is real and the page
//     states it plainly rather than letting someone wonder why a submission
//     never appears on `npm run dashboard`.
//
// WHAT CHANGED ABOUT ZENDESK, AND WHY THIS FILE USED TO SAY THE OPPOSITE
// This header used to state flatly that the portal "creates no tickets — it is
// the request's starting point, not its support-channel copy". That was true,
// and it left the loop open: the ZAF sidebar finds a case by TICKET ID, so a
// portal submission that needed a human produced a correct, durably recorded
// decision with nothing for the sidebar to attach to. The human gate existed
// and was unreachable for exactly those requests.
//
// So the portal now raises a ticket — but only for a decision that needs a
// human, only AFTER the real gates have run and the record is durable, and
// never as something a workflow does on its own. ./ticketing.js is the one
// place that decides which submissions qualify, and why two use cases
// deliberately do not. Zendesk is REAL when configured and the mock otherwise,
// the same choice src/remoteui/cli.js makes.
// ---------------------------------------------------------------------------

import { advanceOnConsentGrant } from "../uc01/consentAdvance.js";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { REQUEST_TYPES, findRequestType } from "./requestTypes.js";
import { PORTAL_COUNTRIES, DEMO_COUNTRY_CODES } from "./countries.js";
import { listPersonas, resolvePersona, DEFAULT_PERSONA_ID } from "./personas.js";
import { toRemoteInteger, fromRemoteInteger } from "../shared/money.js";
// THE HALF A PERSON READS. `countryName()` answers null for a code it cannot
// name, so a caller that would rather print the code keeps that choice;
// `countryLabel()` is the one that makes it. This file used to carry its own
// three-line lookup over PORTAL_COUNTRIES, written before the shared module
// existed — see the note where it was removed.
import { countryName, countryLabel } from "../shared/countryNames.js";

// The eight real workflows (L-14 adds UC-01's self-service letter). Nothing
// else in this file decides anything.
import { issueSelfServiceLetter } from "../uc01/selfServiceLetter.js";
import { handleExpenseSubmission } from "../uc02/workflow.js";
// `buildUc04HandoffEvent` alongside the workflow, and READ-ONLY: the
// continuation route rebuilds the handoff event for a case decided by another
// process (the deployment builds a fresh handler per request, so the object the
// workflow returned is long gone) and it rebuilds it with UC-03's OWN builder
// rather than a second copy of the shape. See ./uc03Continuation.js.
import { handleTravelInquiry, buildUc04HandoffEvent, acceptTravelLetterOffer } from "../uc03/workflow.js";
import { handleWorkationRequest } from "../uc04/workflow.js";
// THE MATRIX'S OWN DAY COUNTER, IMPORTED RATHER THAN RE-IMPLEMENTED.
// The portal shows the two Schengen figures the decision row cannot carry (see
// describeTravelWindows() below). A second copy of an inclusive, window-clipped
// day count is a copy that drifts from the one the gate used, and then the page
// tells a specialist a different number from the one that decided their case.
// `SCHENGEN` / `DNV_COUNTRIES` are imported for the same reason and are read
// ONLY to decide which SENTENCE to print — never to decide anything.
import { computeCumulativeDays, SCHENGEN, DNV_COUNTRIES } from "../uc04/riskMatrix.js";
import { handleResignationRequest } from "../uc05/workflow.js";
import { handleRelocationReview } from "../uc07/workflow.js";
import { handleTaxInquiry } from "../uc08/workflow.js";
import { handleAdjustmentRequest } from "../uc09/workflow.js";
import { readJsonBody } from "../shared/httpBody.js";
import { CONSENT_AGE_WARN_DAYS, isConsentWaitingLong } from "../shared/consentPolicy.js";
// One formatter for a moment, shared with the settled-decision describers, so a
// timestamp printed in a column and the same timestamp printed in a fact read
// identically — which is also what lets the de-duplication below compare them.
import { humanTime } from "../shared/settledDecision.js";
import { checkPortalAccess, checkPortalAccessThrottled, OPEN_ACCESS } from "./access.js";
import {
  describeStatus,
  STATES,
  trackingHint,
  reasonLabel,
  ticketHandoffAlreadyHandled,
  ticketHandoffNotNeeded,
  ticketHandoffNoZendeskConfigured,
  ticketHandoffAssigned,
  ticketHandoffUnassigned,
  ticketHandoffCreationFailed,
  ticketHandoffNoRequestType,
} from "./requestStatus.js";
import { plainAnswer } from "./plainAnswer.js";
import { ownerScopeFor } from "./ownership.js";
// The travel letter, on the requester's own history page. The POLICY is
// src/uc03/letterDelivery.js's — who may collect one, and whether there is one
// to collect; ./letterAccess.js only translates its verdict into a row, and
// describeIssuedLetter() hands over the bytes. Nothing here restates either.
import { describeLetterForRequester, describeUc01LetterForRequester } from "./letterAccess.js";
import { evaluateLetterDelivery, describeIssuedLetter, LETTER_DOCUMENT_TYPE } from "../uc03/letterDelivery.js";
// UC-01's own, much simpler analogue (round-6 D-01) — a self-service case
// never exists without its letter already issued, so this is the same shape
// with no DRAFTED state to translate. See its header.
import {
  evaluateLetterDelivery as evaluateUc01LetterDelivery,
  describeIssuedLetter as describeUc01IssuedLetter,
  describeIssuedLetterAsPdf as describeUc01IssuedLetterAsPdf,
  LETTER_DOCUMENT_TYPE as UC01_LETTER_DOCUMENT_TYPE,
} from "../uc01/letterDelivery.js";
import { readCaseAttachments, documentOfType } from "../uc03/caseAttachments.js";
// The UC-03 -> UC-04 continuation. Read its header before touching the route
// below it: the whole design turns on the difference between the EMPLOYEE
// raising a work authorization (legitimate, and what Remote's own flow is) and
// UC-03's automation raising one on their behalf (refused, and refused again
// here). Nothing in it decides anything.
import {
  describeContinuation,
  intakeFor,
  continuationRef,
  checkContinuable,
  CONTINUATION_REQUESTED,
  CONTINUATION_LINKED,
} from "./uc03Continuation.js";
// The one place that decides which of this route's refusals is a decision
// worth recording. Read its header before adding a refusal to any adapter —
// the split it makes (identity refusals are audited, incomplete forms are not)
// is the whole of the reasoning, and the rule keys on the STATUS, so a new
// refusal lands on the right side by being given the right one.
import { recordIntakeRefusal } from "./refusalAudit.js";
// The vocabulary a settled request is described in, imported rather than
// paraphrased — for all four use cases that have such a describer, not only
// UC-02. It is the reviewer-facing sentence and it is the right one for the
// requester too: it names WHICH of the outcomes happened, WHO decided, WHEN,
// the note they left, and — the part a paraphrase always loses — whether the
// write to Remote actually landed, which is a different fact from whether a
// human said yes. See ../shared/settledDecision.js's header for why that
// distinction is the load-bearing one.
//
// NAMESPACE IMPORTS, because each module contributes TWO things that have to
// travel together: its `describeSettled` and its own `REFUSALS.already_decided`
// fallback sentence. Every one of these describers returns that generic
// sentence for a row it cannot read an outcome from ("already executed or
// declined" — a list of two when the row names neither), and printing THAT to
// the person who filed the request would be the exact defect the describers
// were written to fix, one surface further out. settledSummary() below drops
// it, and the requester sees the status describer's own sentence instead.
//
// These are imported HERE and not into ./requestStatus.js on purpose: that
// file imports nothing at all, and a test pins it, because a pure translation
// that depends on no policy module cannot drift out of step with one.
import * as uc02Review from "../uc02/reviewPolicy.js";
import * as uc04Approval from "../uc04/approvalPolicy.js";
import * as uc05Signoff from "../uc05/signoffPolicy.js";
import * as uc09MultiApproval from "../uc09/multiApprovalPolicy.js";
import { needsTicket, ticketTags, TICKETABLE_TYPES, letterTicketPlan } from "./ticketing.js";
import { handoffFor, urgencyFor } from "../shared/escalationRouting.js";
import { describeDecidingGate, describeGateLadder } from "../uc02/policyEngine.js";
// THE SAME TWO FUNCTIONS FOR THE OTHER FOUR USE CASES THAT PUBLISH A LADDER.
//
// UC-03, UC-04, UC-05 and UC-09 have each carried a `GATE_SEQUENCE` with a
// per-reason `means` since src/shared/gateLadder.js landed, and each one's own
// API already returns `decidedBy`/`gateLadder` on its by-ticket route. This
// file imported UC-02's pair only, so a portal submission to any of the other
// four rendered the bare slug — `duration_over_cap`, `employee_not_active` —
// with the plain-words sentence sitting one import away. The same hole reached
// further than the page: `details` is what buildTicketNote() writes into the
// Zendesk internal note, so the specialist opening the hand-off got the slug
// too. Namespaced because five modules export the same two names.
import * as uc03Gates from "../uc03/policyEngine.js";
import * as uc04Gates from "../uc04/policyEngine.js";
import * as uc05Gates from "../uc05/policyEngine.js";
import * as uc09Gates from "../uc09/policyEngine.js";
import { resolveGroupAssignment } from "../shared/groupAssignment.js";
import { stripHtmlComments, stripJsComments } from "../shared/stripBuildComments.js";
// Imported, never restated. The panel tells the reader what the confidence
// floor is; a literal here would be a second copy free to disagree with the
// gate it describes.
import { DEFAULT_CONFIDENCE_THRESHOLD as UC03_CONFIDENCE_FLOOR } from "../uc03/policyEngine.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const ASSETS = {
  "/": { file: "index.html", type: "text/html; charset=utf-8" },
  "/app.js": { file: "app.js", type: "application/javascript; charset=utf-8" },
  "/style.css": { file: "style.css", type: "text/css; charset=utf-8" },
  // The shared design system (src/shared/ui/remote-ui.css), served from every
  // browser surface at the same path so they stay one product rather than
  // seven. `dir` overrides the default assets/ lookup below.
  "/remote-ui.css": {
    file: "remote-ui.css",
    dir: join(__dirname, "..", "shared", "ui"),
    type: "text/css; charset=utf-8",
  },
};

// The source tag every record this portal creates carries, so an audit row or
// a stored case can always be traced back to "a human typed this into the
// portal" rather than "a seed script produced it".
export const PORTAL_SOURCE = "portal";

/**
 * How many of each request type "My requests" reads back. Bounded for the same
 * reason every other list read in this repo is: an unbounded response over a
 * growing table is its own outage. Per type rather than overall, so one noisy
 * use case cannot push another off the page entirely.
 */
export const MY_REQUESTS_PER_TYPE_LIMIT = 25;

// UC-07 plan facts the form does NOT ask for, with the values it assumes.
// A relocation plan carries ~20 structured facts; a real intake gathers them
// from Remote, a mobility questionnaire and a fee quote. Rather than hide the
// rest in browser state (where a reader cannot see them), the form exposes the
// facts that actually move the gates and the remainder is declared here, once,
// visibly, and documented. Anything the request body sends wins over these.
export const UC07_PLAN_DEFAULTS = Object.freeze({
  destinationEntityActive: true, // Remote has a live entity in the destination
  months: 12, // destination contract length, for the cost estimate
  managementFeeBasisPoints: 1200, // 12% of the ANNUAL gross salary — the fee shape, not a quote
  minimumOnboardingLeadTimeBusinessDays: 20, // the MOT gate's threshold
  transferFeeRemoteInteger: null, // absent => the estimate honestly reads QUOTE_REQUIRED
  mobilityFeeRemoteInteger: null, // same
});

/**
 * @param {object} deps
 * @param {import("../remote/restClient.js").RemoteClient} deps.remote  used by
 *   UC-02/03/04/05/09 only. UC-07 and UC-08 never receive it — see the header.
 * @param {import("../shared/audit.js").AuditLogger} deps.audit
 * @param {object} deps.stores  one store per use case, all owned by this process
 * @param {object} [deps.llm]  optional overrides for every LLM seam behind the
 *   seven workflows — `classifyExpense`, `classifyTravel`, `draftSummary`,
 *   `judge`, `extract`, `parseRelocation`, `draftRelocationNarrative`,
 *   `parseInquiry`, `draftTaxNarrative`, `parseAdjustment`. Defaults are the
 *   real functions, so production behaviour is unchanged; they exist because
 *   this repo has been burned repeatedly by a test making a real, retried
 *   OpenAI call just because an (unreachable) OPENAI_API_KEY sat in `.env`.
 *   Every new LLM call site gets its injectable seam on day one — see
 *   CLAUDE.md §6.
 * @param {object} [deps.access]  the shared-key posture from ./access.js.
 *   Defaults to OPEN_ACCESS, so a fresh clone's `npm run portal` needs no
 *   configuration; the CLI and the Vercel deployment both compute a real one
 *   (durable store attached OR publicly reachable => a key is required).
 * @param {string} [deps.basePath]  the path this portal is mounted under, e.g.
 *   "/portal" on the deployment. "" means the server root, which is how
 *   `npm run portal` serves it.
 */
export function createPortalHandler({
  // The durable counter behind the failed-key ceiling. Optional: without it
  // the gate behaves exactly as it did before the ceiling existed, which is
  // the right default for a local run and for tests. deploy/cx-apis/deps.js
  // passes the Postgres-backed one, because an in-memory counter on a
  // serverless deployment starts at zero every invocation and bounds nothing.
  throttleStore = null,
  remote,
  audit,
  stores,
  llm = {},
  access = OPEN_ACCESS,
  basePath = "",
  zendesk = null,
  // The client used ONLY to advance a third-party enquiry whose consent was
  // just granted. Separate from `remote` above because this portal's own
  // submissions are decided against the in-process mock on purpose, while a
  // third-party-door case names a real Remote record. Optional: without it the
  // advance falls back to `remote`, which is right for `npm run portal` (whose
  // door is also on the mock) and wrong only where the two differ, which is
  // exactly where deps.js passes it.
  thirdPartyRemote = null,
  employmentIdFieldId = null,
  // OPTIONAL, matching src/uc01/workflow.js's own `renderPdf` seam exactly:
  // undefined by default, so a fresh clone and the Vercel deployment (no
  // Chromium available there) behave exactly as before this existed — the
  // route below refuses by name (`pdf_rendering_unavailable`) rather than
  // failing. `npm run portal` wires the real `renderPdfFromHtml` (see
  // cli.js); `npm test` never does, the same discipline every other
  // heavyweight-integration seam in this repo follows (CLAUDE.md §6).
  renderPdf = undefined,
}) {
  const adapters = buildAdapters({ remote, audit, stores, llm });
  const prefix = String(basePath || "").replace(/\/+$/, "");
  // The references THIS PROCESS has already seen submitted.
  //
  // WHAT THIS USED TO BE, AND WHY IT NO LONGER IS THAT
  // This array used to be the source of "My requests" — every submission
  // pushed a row and the status route read them back. That made the whole
  // read-back loop structurally impossible on the deployment, where a fresh
  // handler is built per request and the array is therefore always empty. The
  // route's own header said so out loud, honestly, and the honesty was
  // mistaken for the feature working within a stated limit. It was not: a
  // requester who filed an expense through the deployed portal could never see it
  // again, decided or otherwise. "My requests" now derives from the durable
  // stores (see the route below) and this array has no part in it.
  //
  // IT STILL HAS ONE JOB, and it is a job that genuinely NEEDS process-local
  // memory: the `ledgerBlind` observation on the intake route. That reports
  // "you sent this reference twice and this run had no durable idempotency
  // ledger to refuse the second one with" — a statement about what this
  // process has witnessed, which no durable store can make precisely because
  // the durable store is the thing that is missing. Nothing else reads it.
  const seenRefs = [];

  return async function handle(req, res) {
    const url = new URL(req.url, "http://localhost");
    const parts = url.pathname.split("/").filter(Boolean);

    try {
      if (req.method === "GET" && ASSETS[url.pathname]) {
        const asset = ASSETS[url.pathname];
        const body = readFileSync(join(asset.dir ?? join(__dirname, "assets"), asset.file));
        res.statusCode = 200;
        res.setHeader("Content-Type", asset.type);
        // COMMENTS ARE STRIPPED AT SERVE TIME. These pages are public — only
        // the /api routes below the gate need the key — so anything in the
        // bundle is readable by a stranger via view-source. The comments in
        // these files name internal issue ids (rca-*, DRIFT-*) and src/ paths,
        // which is internal detail leaking to anyone who looks. The source
        // files keep their comments for the next developer.
        //
        // src/thirdparty/ has done this since it shipped; the fix was applied
        // to one of four surfaces and the other three kept serving 305 KB of
        // annotated source. Doing it in the shared shape here rather than in
        // one file, because that is how it came to be true of only one.
        if (asset.file === "index.html") {
          return res.end(withBaseHref(stripHtmlComments(body.toString("utf8")), prefix));
        }
        if (asset.file === "app.js") {
          return res.end(stripJsComments(body.toString("utf8")));
        }
        return res.end(body);
      }

      // THE GATE. Everything below this line either reads records or writes
      // them; everything above it is the empty shell that asks for the key.
      // See ./access.js for the rule and why the shell is deliberately outside
      // it. Placed here — before the route match — so a route added later is
      // gated by existing rather than by being remembered.
      // THROTTLED, not merely checked. The key alone had no brute-force
      // ceiling: eight wrong guesses in a row returned eight plain 401s with
      // no counter, no delay and no lockout, against a shared secret standing
      // in front of the real audit_log and the approval queue on a PUBLIC
      // deployment.
      //
      // Only a supplied-and-WRONG key counts. A missing key is the ordinary
      // first screen — the page fires several API calls before anyone has
      // typed anything — so counting those would lock out an honest visitor
      // before they had entered a thing. A CORRECT key is admitted even from
      // an already-throttled address, so nobody holding the code can be shut
      // out by somebody else guessing from the same network.
      //
      // It fails OPEN, which is the opposite of the third-party door's limiter
      // and deliberately so. There, the limiter is the only control and an
      // unbounded billable spend does not stop by itself. Here the control is
      // the KEY, checked before this runs and unaffected by whether the
      // counter works — so a counter that cannot count leaves the secret
      // exactly as strong as it was, while failing closed would turn a
      // Postgres hiccup into a total lockout of everyone holding the right
      // code. The stricter direction would be the outage.
      const verdict = await checkPortalAccessThrottled(req, access, { store: throttleStore });
      if (!verdict.ok) return send(res, verdict.status, verdict.body);

      // GET /api/context — everything the page needs to draw its forms:
      // the seven request types (from requestTypes.js, so the page never
      // carries its own copy of a tier or a "what the human controls"
      // sentence), the demo personas, the mock Remote's expense records for
      // UC-02's picker, and the country list every country picker is built
      // from. One round trip; the page is static otherwise.
      //
      // WHY THE COUNTRY LIST COMES DOWN THIS ROUTE rather than living in
      // app.js. Same rule as the request types above: the browser holds no
      // copy of data the server owns, because the copy is the thing that
      // drifts. It is also why the page does not fetch `GET /v1/countries`
      // itself — a public form must render without a live API behind it, the
      // portal's Remote reads are the in-process mock by design, and that
      // mock's list is a 21-row illustrative subset with no Canada in it. See
      // ./countries.js for why the picker offers ISO's 249 rather than
      // Remote's 224, and why narrowing it would hide a real behaviour.
      if (req.method === "GET" && isPath(parts, ["api", "context"])) {
        return send(res, 200, {
          requestTypes: REQUEST_TYPES,
          personas: await labelledPersonas(remote),
          defaultPersonaId: DEFAULT_PERSONA_ID,
          expenses: await listExpensesForPicker(remote),
          countries: PORTAL_COUNTRIES,
          demoCountries: DEMO_COUNTRY_CODES,
        });
      }

      // POST /api/requests/:type — run that use case's REAL workflow.
      //
      // `parts.length === 3` is EXACT on purpose. Without it this matched
      // anything beginning `/api/requests/uc02/…`, so a POST to
      // `/api/requests/uc02/<id>/approve` was quietly served by the INTAKE
      // route with the trailing segments ignored — it refused, but it refused
      // as "you did not name a persona", which reads like a decision surface
      // that exists and is merely unauthenticated. On an intake-only API the
      // absence of a decision route should be visible as a 404, not inferred
      // from a 401. Found by a test asserting no such route exists.
      if (req.method === "POST" && isPath(parts, ["api", "requests"]) && parts[2] && parts.length === 3) {
        const type = findRequestType(parts[2]);
        if (!type) return send(res, 404, { ok: false, code: "unknown_request_type", type: parts[2] });

        const body = await readJsonBody(req);
        const outcome = await adapters[type.id](body);
        if (!outcome.ok) {
          // A REFUSAL IS A DECISION, AND A DECISION IS RECORDED BEFORE THE
          // CALLER HEARS IT. An adapter refuses on identity BEFORE its workflow
          // runs, so none of the durable writes below this line happen — which
          // used to mean an admin's attempt to file an employee's expense left
          // no trace anywhere, while the page handed the requester a reference
          // that named nothing in any table. ./refusalAudit.js decides which
          // refusals qualify and why the 400s deliberately do not.
          //
          // ONE PLACE, NOT EIGHTEEN. Written here rather than at each `refusal(…)`
          // site for the same reason the access gate sits above the route match:
          // a refusal added later is covered by existing, not by being
          // remembered. The persona is resolved the same way the adapters
          // resolve it — through the server-owned map, never out of the body.
          //
          // AWAITED, AND STILL UNABLE TO THROW. The await is what makes the
          // sentence above this block true rather than aspirational: without it
          // the row is written after the response, and on the deployment the
          // platform may freeze the invocation the moment the response is
          // written — so the refusals would go missing in production and
          // nowhere else. recordIntakeRefusal() absorbs every failure into a
          // stderr line, so awaiting it can never turn a 403 into a 500.
          await recordIntakeRefusal({
            audit,
            type,
            refusal: outcome,
            body,
            persona: resolvePersona(body.persona),
          });
          return send(res, outcome.status ?? 400, { ok: false, ...outcome });
        }

        // --- The Zendesk hand-off, and the ordering that makes it safe ------
        //
        // GATES FIRST, TICKET AFTER — 00-FOUNDATION.md §2's trigger-source
        // model, exactly as src/remoteui/ does it. Everything above this line
        // has already happened: the real workflow ran, the decision was made,
        // the record was written and the audit row is durable. Only now is a
        // ticket raised, pre-tagged with the outcome so a trigger can route it
        // and the sidebar can find it.
        //
        // The order is not stylistic. If Zendesk is down, or the credentials
        // are wrong, or the account rejects the payload, a decision that was
        // genuinely made must not be erased by the failure of the thing that
        // merely announces it. So the whole hand-off is wrapped: a throw here
        // is reported on the response and recorded, and the decision stands.
        // (test/portalTicket.test.js pins this with a Zendesk client that
        // always throws — the same proof src/remoteui/ carries.)

        // --- THE REFERENCE THE REQUESTER IS ABOUT TO BE SHOWN ---------------
        //
        // The page prints the reference it SENT and calls it "the id that ties
        // every record of this request together". One adapter files the request
        // under a DIFFERENT one on purpose (UC-04 continuing a UC-03 routing —
        // see recordReferenceSubstitution() below and ./uc03Continuation.js),
        // and until that substitution was itself recorded, the sentence on the
        // page was false and the id traced nothing.
        //
        // ENFORCED HERE, ONCE, RATHER THAN IN SEVEN ADAPTERS, for the same
        // reason the access gate sits above the route match and
        // recordIntakeRefusal() sits here rather than at eighteen refusal
        // sites: a use case added later is covered by existing, not by being
        // remembered. An adapter that files under a different reference says so
        // by putting `recordedRef` on its envelope; every adapter that passes
        // `body.externalRef` straight through — which is all six of the others
        // — says nothing and the default is correct for it.
        const submittedRef = readSubmittedRef(body.externalRef);
        const recordedRef =
          outcome.envelope.recordedRef !== undefined ? outcome.envelope.recordedRef : submittedRef;
        await recordReferenceSubstitution({
          audit,
          type,
          submittedRef,
          recordedRef,
          persona: resolvePersona(body.persona),
          envelope: outcome.envelope,
        });

        // WHEN A REPEAT SHOULD HAVE BEEN CAUGHT AND WAS NOT, say so.
        //
        // `claimExternalRef()` needs a `workflow_claims` table to key against,
        // and with no pgPool there is none — it documents that it proceeds
        // rather than faking the guarantee in memory. Correct, and it means a
        // repeated reference sails through on an in-memory run, which from the
        // page looks exactly like the duplicate check being broken.
        //
        // This process HAS seen the reference before (its own ledger says so),
        // so it can report the difference between "not a duplicate" and "a
        // duplicate this deployment has no way to refuse". That is an
        // observation about what already happened, not a second claim check —
        // nothing here refuses anything, and the request has already run.
        const seenBefore =
          submittedRef && seenRefs.some((e) => e.type === type.id && e.submittedRef === submittedRef);
        const ledgerBlind = seenBefore && outcome.envelope.alreadyHandled !== true && !stores[type.id]?.pgPool;

        const handoff = await raiseTicketIfNeeded({
          typeId: type.id,
          decision: outcome.envelope.decision ?? null,
          recordId: outcome.envelope.recordId ?? null,
          persona: resolvePersona(body.persona),
          outcome,
          type,
          stores,
          zendesk,
          employmentIdFieldId,
          audit,
          externalRef: submittedRef,
        });

        // Note that this process has now seen this reference. ONLY the
        // reference: the record itself is durable and "My requests" reads it
        // from the store, so nothing about the decision is remembered here.
        //
        // The REQUESTER'S OWN reference, not the ticket id the record may have
        // ended up carrying — once a ticket is raised the record's externalRef
        // becomes the ticket id, and comparing against that would compare
        // against a value the requester never typed, so the "have I seen this
        // before?" check would never fire.
        //
        // A REFUSED REDELIVERY IS NOT A NEW SIGHTING: it decided nothing and
        // wrote nothing, and its refusal is already reported on this response.
        if (outcome.envelope.alreadyHandled !== true) seenRefs.push({
          type: type.id,
          submittedRef,
        });

        return send(res, 200, {
          ok: true,
          // WHAT THIS REQUEST IS ACTUALLY FILED UNDER, on the wire, so a
          // caller reading the response is never left to assume it is the
          // reference they sent. Equal to `submittedRef` for six of the seven
          // types and for every UC-04 request that is not a continuation.
          recordedRef: recordedRef ?? null,
          ...handoff.envelope,
          ...(ledgerBlind
            ? {
                ledgerUndetected: true,
                ledgerUndetectedExplanation:
                  "You have submitted this reference before in this session, and it was NOT refused as a duplicate delivery — because this run has no durable idempotency ledger attached. claimExternalRef() keys on the workflow_claims table, and with no database it proceeds rather than inventing the guarantee in memory. Attach Supabase (or use the deployment) to see the refusal.",
              }
            : {}),
          // Everything descriptive about the request type comes from the
          // server, so the page renders facts it was given rather than facts
          // it re-derived. main.js's rule in the ZAF sidebar, applied here.
          type: type.id,
          useCase: type.useCase,
          tier: type.tier,
          executionPath: type.executionPath,
          humanControl: type.humanControl,
          recordLabel: type.recordLabel,
          ...outcome.envelope,
          // THE ROWS THE REQUESTER SEES, AND ONLY THOSE.
          //
          // Spread after the envelope so it REPLACES the full array rather than
          // being overwritten by it, and placed after the hand-off above so the
          // specialist's Zendesk note is composed from everything the adapters
          // published while this page is not. See forRequester() for the four
          // questions a row has to answer to be here, and specialistDetail()
          // for the rows that are kept and routed rather than deleted.
          details: forRequester(outcome.envelope.details),
          // WHERE THE ANSWER WILL APPEAR. Spread AFTER the envelope because it
          // is derived from the envelope's own `decision` and `recordId`, and
          // sent as a sentence the page prints verbatim — the same rule every
          // other line on that page follows. Not part of `details`, which is
          // deliberate: `details` is spread into the Zendesk internal note
          // (buildTicketNote), and telling a Finance Ops specialist to check
          // the requester's own portal view would be addressing the wrong
          // reader.
          tracking: trackingHint({
            decision: outcome.envelope.decision ?? null,
            executionPath: type.executionPath,
            recordId: outcome.envelope.recordId ?? null,
            recordLabel: type.recordLabel,
          }),
          // THE ANSWER TO THE QUESTION THEY ASKED, FIRST — see ./plainAnswer.js.
          //
          // Spread after the envelope for the same reason `tracking` is: it is
          // derived from fields the envelope carries and must never be
          // overwritten by one. Composed here rather than in the browser
          // because choosing a verb means comparing a decision string, and
          // app.js re-derives no policy; and because the country's NAME is a
          // server-side lookup (src/shared/countryNames.js), so the page
          // receives "Spain" and never learns what `ES` means.
          plainAnswer: plainAnswer({
            useCase: type.useCase,
            decision: outcome.envelope.decision ?? null,
            // THE REASON, FOR ONE QUESTION ONLY: did this outcome produce
            // something the requester now holds? `auto_resolve` is reached two
            // ways on UC-03 — an informational answer, and a travel letter
            // written and issued — and the decision alone cannot tell them
            // apart, so an employee who asked for a visa support letter and
            // GOT one was told their trip "needs nothing further from Remote".
            // ./plainAnswer.js reads this against a named set and never for
            // what it means.
            reason: outcome.envelope.reason ?? null,
            // THE FLAGS, because on ONE refusal they are the whole answer.
            // UC-04's `factors_invalid` carries which boxes could not be read
            // (`missing_nationality`, `invalid_visa_type`, …) in `flags`, and
            // without them the requester is told "some of your details could
            // not be read" and cannot act on it. Named against a table in
            // ./plainAnswer.js and src/uc04/decisionFacts.js, never parsed —
            // the reason above is read the same way. Every other shape ignores
            // them, which is why this is a pass-through and not a new argument
            // per use case.
            flags: outcome.envelope.flags ?? null,
            executionPath: type.executionPath,
            recordLabel: type.recordLabel,
            placeCode: subjectCountryOf(outcome.envelope),
          }),
        });
      }

      // ---------------------------------------------------------------------
      // POST /api/requests/uc03/continue — the employee raising the RWA
      // ---------------------------------------------------------------------
      // THIS ROUTE IS THE HUMAN ACT OF INTENT, AND IT EXISTS SO THERE IS ONE.
      //
      // Remote's rule: a Remote Work Authorization is raised by the EMPLOYEE,
      // in Remote's Requests section, and no API creates one
      // (docs/research/CROSS-BORDER-FLOW.md §5). This portal is the stand-in for
      // that surface, so an employee clicking "continue to work authorization"
      // IS the employee raising it — legitimate, and Remote's own flow. UC-03's
      // automation silently creating the same thing would be automation raising
      // it, which src/uc03/uc04Intake.js refuses and this build does not undo.
      // The whole difference between those two is a deliberate human act in
      // between, so that act gets its own authenticated request and its own
      // durable row rather than being inferred from a page transition.
      //
      // WHAT IT DOES NOT DO. It runs no gate, submits nothing to UC-04, creates
      // nothing in Remote, and creates no UC-04 record. It reads a case back,
      // records that its subject asked to continue, and answers with the values
      // that will be PREFILLED into the UC-04 form and the ones the employee
      // still has to supply. Submitting is a separate, later act on the UC-04
      // form, which is the employer's assessment (see that adapter).
      //
      // WHY THE CASE IS RE-READ RATHER THAN TAKEN FROM THE CLICK. Everything
      // that decides whether this continuation may happen — whose request it
      // is, what it was decided, which use case it belongs to — is read off the
      // durable row, never out of the body. A body that carried its own
      // destination and employment id would be a claim, and prime directive #3
      // is that identity comes from an authenticated signal and never a claim.
      // Re-reading is also what makes this work on the deployment at all: the
      // process that decided the case is gone by now.
      //
      // `parts.length === 4` is EXACT, for the reason the intake route above
      // states in full: `isPath()` is a PREFIX match, so without it
      // `/api/requests/uc03/continue/<anything>` would be served by this route
      // with the trailing segments ignored — a sub-resource that does not exist
      // answering 200 rather than 404.
      if (req.method === "POST" && isPath(parts, ["api", "requests", "uc03", "continue"]) && parts.length === 4) {
        const body = await readJsonBody(req);
        const persona = resolvePersona(body.persona);
        if (!persona) {
          const denial = unauthenticated();
          return send(res, denial.status, { ok: false, code: denial.code, reason: denial.reason });
        }
        // THE TRAVELLER, AND ONLY THE TRAVELLER. An admin persona is refused
        // here even though an admin files the UC-04 assessment two steps later,
        // because these are two different acts by two different parties —
        // Remote's own model, where the employee submits and the employer then
        // approves. An admin "continuing" on someone's behalf would be exactly
        // the silent raising this route exists to replace with a real one.
        if (persona.kind !== "employee") {
          return send(res, 403, {
            ok: false,
            code: "persona_cannot_continue",
            reason:
              "A work authorization is raised by the travelling employee — Remote's own rule, and the reason this step is a person's click rather than something the router does. An admin's part comes next, at the assessment.",
          });
        }

        const caseId = typeof body.caseId === "string" ? body.caseId.trim() : "";
        if (!caseId) {
          return send(res, 400, {
            ok: false,
            code: "continuation_case_required",
            reason: "Name the travel request this continues.",
          });
        }

        const caseRow = await stores.uc03.findById(caseId);
        const allowed = checkContinuable(caseRow, persona.employmentId);
        if (!allowed.ok) {
          return send(res, allowed.code === "continuation_case_not_found" ? 404 : 403, {
            ok: false,
            ...allowed,
          });
        }

        // The handoff event, rebuilt with UC-03's OWN builder from the durable
        // row plus a fresh employment read. Not a second shape: this is
        // literally `buildUc04HandoffEvent()`, the function UC-03 calls, given
        // the same three inputs. The employment read is what supplies
        // `origin_country`, and re-reading it now rather than trusting a
        // remembered value is the same "is it still true?" discipline UC-06's
        // approval path established.
        const employment = await remote.getEmployment(caseRow.employmentId);
        const handoffEvent = buildUc04HandoffEvent({
          employment,
          classification: caseRow.classification ?? {},
          externalRef: caseRow.externalRef ?? null,
        });
        const continuation = describeContinuation({
          handoffEvent,
          intake: intakeFor(handoffEvent),
          caseRow,
          ticketText: caseRow.ticketText ?? null,
        });

        // --- THE ROW THAT MAKES THIS A RAISING AND NOT AN AUTOMATION -------
        //
        // logDurable(), NOT log(), and the asymmetry is deliberate. Everywhere
        // else in this file a failed audit write must not break the caller's
        // outcome — ./refusalAudit.js argues that at length for a refusal, and
        // it is right there. Here it inverts. The ONLY thing separating this
        // continuation from the silent dispatch src/uc03/uc04Intake.js refuses
        // is a recorded human act; if the record cannot be written, there is no
        // recorded human act, and proceeding anyway would produce precisely the
        // thing that was refused while reporting success. So a failure here
        // propagates and the continuation does not happen.
        await audit.logDurable({
          useCase: "UC-03",
          action: CONTINUATION_REQUESTED,
          // The employee's own authenticated employment id — the server's
          // answer, from ./personas.js's map, never the body's.
          actor: persona.session.authenticatedEmploymentId,
          riskTier: "low",
          caseId: caseRow.id,
          details: {
            // Selected BY NAME by src/auditview/readStore.js — a parallel shape
            // is a row that exists in Postgres and is invisible in the viewer.
            externalRef: continuation.externalRef,
            reason: CONTINUATION_REQUESTED,
            source: PORTAL_SOURCE,
            typeId: "uc03",
            uc03CaseId: caseRow.id,
            // The event as it was rebuilt, so the row records what was offered
            // rather than only that something was.
            handoffEvent,
            // The two halves of the honest answer, kept apart: what carried,
            // and what nobody has said yet.
            carriedFields: continuation.prefill.filter((p) => p.value !== null).map((p) => p.field),
            stillNeeded: continuation.stillNeeded.map((s) => s.uc04Issue),
            // Literal, never derived, for the same reason describeUc04Intake()
            // states its own two flags literally: this is the machine-readable
            // form of "the employee asked; nothing was created anywhere".
            uc04RecordCreated: false,
            remoteRequestCreated: false,
          },
        });

        return send(res, 200, {
          ok: true,
          ...continuation,
          // The type descriptor for the card the page is about to open, from
          // requestTypes.js, so the page still renders facts it was given.
          nextType: findRequestType("uc04") ?? null,
        });
      }

      // ---------------------------------------------------------------------
      // POST /api/requests/uc03/request-letter — the traveller taking the offer
      // ---------------------------------------------------------------------
      // WHAT THIS IS. An employee asked whether a business trip was all right,
      // cleared every gate, and was answered informationally. The answer
      // carries an OFFER (src/uc03/letterOffer.js): the same trip, certified in
      // a formal letter, without describing it again. This route is them
      // saying yes.
      //
      // WHAT ACCEPTING PRODUCES, AND THIS PARAGRAPH WAS WRONG FOR MONTHS. It
      // read: "It issues no letter and it cannot. Accepting produces a second
      // UC-03 decision — `human_review / formal_letter_requested`, with the
      // letter DRAFTED — and `submitTravelLetterSignoff()` remains the only
      // code in this repository that can set `letterIssued: true`." That was
      // true when it was written and stopped being true when the 🟢 path began
      // issuing the standard letter with nobody in the path. Driven live on
      // 2026-08-20 against the mock, the short-business-trip offer accepted to
      // `auto_resolve / standard_letter_issued`, `letterDrafted: true`,
      // `letterIssued: true`, `awaitingSignoff: false` — the letter written and
      // handed over in the same call.
      //
      // SO ACCEPTING HAS TWO OUTCOMES, and the difference is the employing
      // entity's record rather than anything the traveller does: a readable
      // letterhead is written and issued straight away; an unreadable one is
      // drafted and held, and `submitTravelLetterSignoff()` is still the only
      // thing that can issue THAT one. `signoffNote` on the offer says both
      // before the click. What the traveller gets back is below — including,
      // when a letter really was issued, the way to collect it, which is the
      // half this route did not send and the reason the letter was unreachable.
      //
      // WHY IT IS ITS OWN ROUTE RATHER THAN A FLAG ON THE INTAKE. The same
      // reason /continue above is its own route: this is a deliberate human act
      // by a named person, and an act of intent that is inferred from a page
      // transition is not recorded anywhere. It is also a SECOND decision on a
      // request that already has one, so it cannot ride on the submission that
      // produced the first.
      //
      // THE SESSION IS THE SERVER'S. `persona.session` comes from
      // ./personas.js's map, never from the body — prime directive #3, and the
      // reason this route takes a persona key and a case id and nothing else.
      // It is not believed on its own either: acceptTravelLetterOffer() re-runs
      // the whole router, which verifies the requester against the employment
      // record it freshly reads from Remote. That check decides; this one only
      // buys a clean refusal instead of an escalated case row.
      //
      // NO `zendesk` DEPENDENCY, for the reason the uc03 adapter below states
      // in full: the accept path posts a ticket reply when the case's source is
      // `zendesk`, and a portal case's is not. The portal never lets a workflow
      // speak on its behalf.
      //
      // `parts.length === 4` is EXACT, for the reason /continue states: without
      // it `isPath()`'s prefix match would serve
      // `/api/requests/uc03/request-letter/<anything>` from here.
      if (req.method === "POST" && isPath(parts, ["api", "requests", "uc03", "request-letter"]) && parts.length === 4) {
        const body = await readJsonBody(req);
        const persona = resolvePersona(body.persona);
        if (!persona) {
          const denial = unauthenticated();
          return send(res, denial.status, { ok: false, code: denial.code, reason: denial.reason });
        }
        // THE TRAVELLER, AND ONLY THE TRAVELLER. A travel letter is issued to
        // the employee it is about and names them to a consulate; an admin
        // requesting one on somebody's behalf is a different act with a
        // different subject, and the offer's own identity check would refuse it
        // anyway — an admin persona's session carries a company, not an
        // employment, so it would land on `session_required`, a refusal whose
        // words would describe the wrong problem. Refusing by name here is what
        // makes the answer readable.
        if (persona.kind !== "employee") {
          return send(res, 403, {
            ok: false,
            code: "persona_cannot_request_letter",
            reason:
              "A travel letter certifies the employment of the person travelling, so it is requested by that employee. An admin cannot take up an offer made to someone else.",
          });
        }

        const caseId = typeof body.caseId === "string" ? body.caseId.trim() : "";
        if (!caseId) {
          return send(res, 400, {
            ok: false,
            code: "letter_case_required",
            reason: "Name the answered travel request this letter is for.",
          });
        }

        const result = await acceptTravelLetterOffer(
          { caseId, session: persona.session },
          { remote, audit, caseStore: stores.uc03 }
        );

        // --- THE HAND-OFF, AND ONLY ON A DECISION THAT WAS ACTUALLY MADE ---
        //
        // A refusal returns here untouched. `evaluateLetterOffer()` refuses an
        // unauthenticated caller, a case that is not theirs, and a second
        // accept — and NOTHING was decided in any of those, so there is nothing
        // to hand over. Raising a ticket on a refusal would put the exact
        // duplicate the exactly-once ledger exists to prevent into a real
        // support queue, and would let anyone holding the access key mint
        // tickets by POSTing case ids.
        if (!result.ok) return send(res, result.status, result);

        return send(res, result.status, {
          ...result,
          // --- WHERE THE LETTER IS, IF ACCEPTING PRODUCED ONE ---------------
          //
          // THE DEFECT THIS CLOSES, reported by the project owner in five
          // words: "so now, how do i get my letter?" He submitted the short
          // business trip, took the offer on the answer, and the panel told him
          // — correctly, in the server's own sentence — that his letter had
          // been written and issued. There was no way to open it. The accept
          // response carried `letter: {method, path}`, which is
          // src/uc03/server.js's route and not one this portal serves, so the
          // page could do nothing with it; the portal's own collect control is
          // built from a `collect` verdict, and this response had none.
          //
          // The route header above still said "It issues no letter and it
          // cannot", which was true when it was written and stopped being true
          // when the 🟢 path began issuing the standard letter with nobody in
          // the path — the accept observed here returns `letterIssued: true`,
          // `awaitingSignoff: false`. That sentence has been corrected where it
          // sits; this comment records what replaced the assumption.
          //
          // IT IS THE SAME VERDICT AS EVERYWHERE ELSE. `letterOnCase()` calls
          // `evaluateLetterDelivery()` through ./letterAccess.js — the same
          // call the collect route runs, the same one the history row's badge
          // is built from — against the NEW case the letter is attached to and
          // the reader's own server-held session. So this cannot offer a
          // control the collect route would refuse, and a letter that is
          // DRAFTED and held for a signature yields no `collect` and therefore
          // no button, which is the sign-off gate doing its job rather than
          // this route deciding anything.
          //
          // `recordId` is the case the buttons collect against, named the same
          // way the intake response names it so the page has one shape to read.
          recordId: result.caseId ?? null,
          letterAccess: await letterOnCase({
            caseStore: stores.uc03,
            caseId: result.caseId,
            session: persona.session,
          }),
          ...(await handOffLetterRequest({
            result,
            persona,
            stores,
            zendesk,
            employmentIdFieldId,
            audit,
          })),
        });
      }

      // ---------------------------------------------------------------------
      // POST /api/requests/uc03/letter — the traveller collecting their letter
      // ---------------------------------------------------------------------
      // THE ROUTE THAT ANSWERS "FROM WHERE?". The standard travel letter is
      // written and issued by the gate with nobody in the path, and the only
      // delivery that existed was submitTravelLetterSignoff()'s post to a
      // Zendesk ticket. A request filed HERE never goes through Zendesk, so its
      // letter was correct, durable, audited, ISSUED — and unreachable by the
      // one person it is about. This hands over the bytes.
      //
      // IT IS NOT A CONTROL. Nothing is created, nothing is mutated, nothing is
      // audited: the document already exists and already went out. The
      // read-only boundary "My requests" states in its own payload is untouched
      // — showing a document is reading, and this is the read.
      //
      // THE SESSION IS THE SERVER'S, AND THE GATE IS UC-03'S. `persona.session`
      // comes from ./personas.js's map and never from the body (prime directive
      // #3); `evaluateLetterDelivery()` then decides, and it is the SAME call
      // the history row's badge was computed from (./letterAccess.js) — so this
      // page structurally cannot offer a save on something this route refuses.
      //
      // A POST FOR A READ, matching `/api/requests/uc03/request-letter` above
      // and `src/uc03/server.js`'s own `/api/cases/:id/letter`: the traveller's
      // identity is a persona key in a body, which keeps an employment id out
      // of a URL and out of every access log that URL passes through.
      //
      // `parts.length === 4` is EXACT, for the reason /continue states: without
      // it `isPath()`'s prefix match would serve
      // `/api/requests/uc03/letter/<anything>` from here.
      if (req.method === "POST" && isPath(parts, ["api", "requests", "uc03", "letter"]) && parts.length === 4) {
        const body = await readJsonBody(req);
        const persona = resolvePersona(body.persona);
        if (!persona) {
          const denial = unauthenticated();
          return send(res, denial.status, { ok: false, code: denial.code, reason: denial.reason });
        }
        const caseId = typeof body.caseId === "string" ? body.caseId.trim() : "";
        if (!caseId) {
          return send(res, 400, {
            ok: false,
            code: "letter_case_required",
            reason: "Name the travel request whose letter you are collecting.",
          });
        }

        const found = await stores.uc03.findById(caseId);
        // UC-03-SCOPED BY THE CALLER, exactly as src/uc03/server.js does it: an
        // id belonging to another use case's store must read as "no such case"
        // and never as a letter that happens to be missing.
        const caseRow = found && found.useCase === "UC-03" ? found : null;
        const { documents } = caseRow
          ? await readCaseAttachments(stores.uc03, caseRow.id, { includeContent: true })
          : { documents: [] };
        const letterDocument = documentOfType(documents, LETTER_DOCUMENT_TYPE);
        const verdict = evaluateLetterDelivery({ caseRow, session: persona.session, letterDocument });
        if (!verdict.allowed) {
          return send(res, verdict.status, { ok: false, code: verdict.code, reason: verdict.reason });
        }
        return send(res, 200, describeIssuedLetter(caseRow, letterDocument));
      }

      // ---------------------------------------------------------------------
      // POST /api/requests/uc01/letter — the employee collecting their
      // self-service employment verification letter
      // ---------------------------------------------------------------------
      // ROUND-6 D-01. The initial `/api/requests/uc01` response already
      // carries the letter (in `letterHtml` and now, structurally, in
      // `letter.collect`) — this route is what a RETURNING visit uses, from
      // "My requests", the surface the result panel itself points at
      // ("This is already final. Open 'My requests' to see it"). Same shape
      // as UC-03's route immediately above; UC-01's own
      // src/uc01/letterDelivery.js is the gate, not this file.
      if (req.method === "POST" && isPath(parts, ["api", "requests", "uc01", "letter"]) && parts.length === 4) {
        const body = await readJsonBody(req);
        const persona = resolvePersona(body.persona);
        if (!persona) {
          const denial = unauthenticated();
          return send(res, denial.status, { ok: false, code: denial.code, reason: denial.reason });
        }
        const caseId = typeof body.caseId === "string" ? body.caseId.trim() : "";
        if (!caseId) {
          return send(res, 400, {
            ok: false,
            code: "letter_case_required",
            reason: "Name the letter request you are collecting.",
          });
        }

        const found = await stores.uc01.findById(caseId);
        // UC-01-SCOPED BY THE CALLER, exactly as the UC-03 route above scopes
        // itself: an id belonging to another use case's store (`cases` is
        // shared) must read as "no such case", never as a letter that happens
        // to be missing.
        const caseRow = found && found.useCase === "UC-01" ? found : null;
        const { documents } = caseRow
          ? await readCaseAttachments(stores.uc01, caseRow.id, { includeContent: true })
          : { documents: [] };
        const letterDocument = documentOfType(documents, UC01_LETTER_DOCUMENT_TYPE);
        const verdict = evaluateUc01LetterDelivery({ caseRow, session: persona.session, letterDocument });
        if (!verdict.allowed) {
          return send(res, verdict.status, { ok: false, code: verdict.code, reason: verdict.reason });
        }
        return send(res, 200, describeUc01IssuedLetter(caseRow, letterDocument));
      }

      // ---------------------------------------------------------------------
      // POST /api/requests/uc01/letter/pdf — the same letter, as a PDF
      // ---------------------------------------------------------------------
      // rca-cput (round-7 R7-21, VOID but real): "Save it" only ever offered
      // the stored HTML; there was no PDF option anywhere on this surface, and
      // src/pdf/ + `npm run pdf-demo` already prove the exact letter renders
      // to a real PDF. SAME GATE as the route above — this is not a second
      // opinion about who may collect the letter, only a second FORMAT of the
      // same collectable artifact — so it is written as a sibling block
      // rather than a branch inside the route above, to keep the identity
      // check for the two responses provably identical rather than merely
      // similar.
      if (
        req.method === "POST" &&
        isPath(parts, ["api", "requests", "uc01", "letter", "pdf"]) &&
        parts.length === 5
      ) {
        const body = await readJsonBody(req);
        const persona = resolvePersona(body.persona);
        if (!persona) {
          const denial = unauthenticated();
          return send(res, denial.status, { ok: false, code: denial.code, reason: denial.reason });
        }
        const caseId = typeof body.caseId === "string" ? body.caseId.trim() : "";
        if (!caseId) {
          return send(res, 400, {
            ok: false,
            code: "letter_case_required",
            reason: "Name the letter request you are collecting.",
          });
        }

        const found = await stores.uc01.findById(caseId);
        const caseRow = found && found.useCase === "UC-01" ? found : null;
        const { documents } = caseRow
          ? await readCaseAttachments(stores.uc01, caseRow.id, { includeContent: true })
          : { documents: [] };
        const letterDocument = documentOfType(documents, UC01_LETTER_DOCUMENT_TYPE);
        const verdict = evaluateUc01LetterDelivery({ caseRow, session: persona.session, letterDocument });
        if (!verdict.allowed) {
          return send(res, verdict.status, { ok: false, code: verdict.code, reason: verdict.reason });
        }

        // THE OPTIONAL SEAM. Refused by its own name rather than attempted and
        // failed — the same "required-but-unconfigured refuses by its own
        // name" discipline CLAUDE.md §4 records for approver entitlement.
        if (typeof renderPdf !== "function") {
          return send(res, 503, {
            ok: false,
            code: "pdf_rendering_unavailable",
            reason:
              'PDF rendering is not configured on this deployment. Use "Save it" for the HTML letter — it opens and prints cleanly from any browser.',
          });
        }

        let pdfBuffer;
        try {
          pdfBuffer = await renderPdf(letterDocument.content);
        } catch (err) {
          console.error(`[portal] uc01 letter pdf render failed for ${caseRow.id}: ${err.stack}`);
          return send(res, 502, {
            ok: false,
            code: "pdf_render_failed",
            reason: 'The letter could not be rendered to PDF. Use "Save it" for the HTML letter instead.',
          });
        }
        return send(res, 200, describeUc01IssuedLetterAsPdf(caseRow, letterDocument, pdfBuffer));
      }

      // ---------------------------------------------------------------------
      // GET /api/my-requests?persona=<key> — "what happened to what I filed?"
      // ---------------------------------------------------------------------
      // THE QUESTION THIS ANSWERS, AND WHY IT DID NOT HAVE AN ANSWER
      // Someone submitted an over-cap expense here, was told `human_review /
      // over_policy_cap`, and asked where a human would actually review it.
      // The honest answer was nowhere — and even after §6's Finance Ops
      // decision was built (src/uc02/reviewPolicy.js), the person who filed
      // the expense still had no way to see that it had been decided. A gate
      // whose outcome the requester cannot observe is only half a gate.
      //
      // AND THEN IT STILL HAD NO ANSWER, FOR A YEAR OF SESSIONS, BEHIND A
      // COMMENT THAT SAID SO. This route used to read a process-local array
      // pushed to at submission time, and its own header stated the limit
      // plainly: "a serverless deployment builds a fresh handler per request,
      // so the ledger is empty there". Every word true. What the sentence did
      // not say is that the deployment is the ONLY place a real requester ever
      // touches this page — so "My requests" was not a feature with a stated
      // limit, it was a feature that could never once succeed, described
      // accurately. A user found it the way users do: "I did not see the
      // effect of the approve on the UI/portal." An honest comment and a
      // working feature are not the same thing, and this repo's most expensive
      // recurring defect is exactly this shape (CLAUDE.md §4/§5) — a path that
      // structurally cannot succeed while every assertion about it passes,
      // because refusing correctly and being unable to succeed look identical
      // from outside.
      //
      // SO THE LIST IS DERIVED FROM THE DURABLE STORES. Every record already
      // carries what it takes: an employment id, a requester, a `source` and a
      // decision. Each store answers `listByOwner()` and each one falls
      // through to Postgres, exactly as `findById()` always did. Nothing about
      // this list now depends on the process that took the submission still
      // being alive.
      //
      // THE STATE IS RE-READ, NEVER REMEMBERED — and now that is true of the
      // membership as well as the status. Both come from the same live read.
      // Caching either would mean this page could show "awaiting review" for a
      // expense a specialist released an hour ago, which is the one failure mode
      // a status view has.
      //
      // WHOSE REQUESTS, AND WHERE THAT ANSWER COMES FROM. The persona key is
      // resolved through ./personas.js's server-owned map before anything is
      // read, and the scope is built from what that map says — an employment
      // id, or an admin id — never from a value in the query string or the
      // body. ./ownership.js holds the pairing table and its reasoning. An
      // unknown persona is refused rather than defaulted, because the natural
      // default ("no persona filter") is the one that lists everybody's
      // requests to anybody holding the shared access key.
      //
      // READ-ONLY, AND THAT BOUNDARY IS LOAD-BEARING.
      // This route offers no approve, no decline, no hold — nothing that changes
      // anything. The portal's own header states the rule and it still holds
      // verbatim: duplicating the human gate here "would create a second,
      // unaudited place a decision could be made". Showing status is reading;
      // deciding is not. The decisions live where they already live — the ZAF
      // sidebar and each use case's own approval endpoint — and each one is
      // gated there by a signed approver identity this page could not present
      // even if it wanted to (its own access key is a shared secret, not an
      // identity; see ./access.js's header).
      //
      // Exact length, same reasoning as the intake route above: this surface
      // has no sub-resources, and a matcher that swallowed them would make
      // `/api/my-requests/<id>/release` answer 200 with a list.
      if (req.method === "GET" && isPath(parts, ["api", "my-requests"]) && parts.length === 2) {
        const persona = resolvePersona(url.searchParams.get("persona"));
        if (!persona) {
          return send(res, 401, {
            ok: false,
            code: "unknown_persona",
            reason:
              "Name the persona whose requests to list. The portal resolves it against its own map and reads nothing without one — an unscoped read would list every requester's requests.",
          });
        }

        const requests = [];
        // The pairings this session cannot own, and why. Reported rather than
        // silently omitted: "not listed" and "you filed none" are different
        // facts, and only one of them is safe to act on. Same rule
        // ./requestStatus.js applies to a status it does not recognise.
        const notListed = [];

        for (const type of REQUEST_TYPES) {
          const store = stores[type.id];
          const scope = ownerScopeFor(persona, type.id);
          if (!scope.scoped) {
            notListed.push({ type: type.id, useCase: type.useCase, reason: scope.reason });
            continue;
          }
          if (!store || typeof store.listByOwner !== "function") continue;

          // ONE STORE'S FAILURE MUST NOT ERASE THE OTHER SIX.
          //
          // This loop used to let a throw escape to the route's catch, which
          // answers 500 for the whole page. Live on 2026-08-19 that is exactly
          // what happened: three stores built their SQL with `${params.length}`
          // where `$${params.length}` was meant, so Postgres saw
          // `employment_id = 1` and refused with `operator does not exist:
          // text = integer`. A two-character bug in ONE use case made every
          // requester's entire history unreadable — a UC-02 claim that had been
          // approved minutes earlier was invisible because UC-05's query was
          // malformed.
          //
          // The requests that CAN be read are the answer to the question this
          // route was built for. A use case that cannot be read is reported as
          // such, beside the ones that could, and the reason travels with it —
          // "not listed" and "you filed none" are different facts, which is
          // already why `notListed` exists for the unscopable ones.
          //
          // The error text is deliberately included: this page is reached by
          // the person who filed the request, not by an operator, but the
          // alternative is a silent gap, and a silent gap is what let the
          // original defect run in production unnoticed. It names no record and
          // no other requester.
          let rows;
          try {
            rows = await store.listByOwner({
              ...scope.query,
              // Requests filed HERE. The stores are shared with the nine ucNN
              // APIs and with n8n, so without this a portal user would be shown
              // seeded demo rows and Zendesk-originated cases they never filed.
              source: PORTAL_SOURCE,
              limit: MY_REQUESTS_PER_TYPE_LIMIT,
            });
          } catch (err) {
            console.error(`[portal] my-requests: ${type.id} could not be listed: ${err.stack}`);
            notListed.push({
              type: type.id,
              useCase: type.useCase,
              reason: `This use case could not be read just now (${err.message}). Your other requests below are unaffected, and nothing about this one has changed — only this page's ability to show it.`,
              failed: true,
            });
            continue;
          }
          for (const row of rows) requests.push(myRequestView(type, row));
        }

        // THE DOCUMENT ON THE ROW, for the two use cases that produce one the
        // requester may hold.
        //
        // "This should not end here. A travel letter was requested. It should
        // be recorded, and the user should be able to download the letter. The
        // question now is: from where?" — the project owner, reading this very
        // list. The letter was rendered, hashed and stored the whole time; the
        // row said a status and a sentence and gave no sign a document existed.
        //
        // WHY IT IS A SECOND PASS RATHER THAN PART OF myRequestView(). That
        // function is pure and synchronous over one row, which is what lets
        // every other column be read straight off the record. A letter lives in
        // the `documents` table, so knowing whether there is one is a READ —
        // and one that must go through readCaseAttachments(), because on a
        // pooled deployment the process serving this page is not the process
        // that wrote the row (CLAUDE.md §6). Keeping the read out here leaves
        // the view function honest about what it costs.
        //
        // ONE READ PER ROW THAT COULD HAVE ONE, bounded by
        // MY_REQUESTS_PER_TYPE_LIMIT. A failure to read a document must not
        // remove a request from the list: the row is the answer to "what
        // happened to mine", the document is an extra on it, so the catch
        // leaves `document` null rather than letting the throw reach the
        // route's 500.
        const uc03Scope = ownerScopeFor(persona, "uc03");
        if (uc03Scope.scoped && stores.uc03) {
          for (const request of requests) {
            if (request.type !== "uc03" || !request.recordId) continue;
            try {
              const caseRow = await stores.uc03.findById(request.recordId);
              if (!caseRow) continue;
              const { documents } = await readCaseAttachments(stores.uc03, caseRow.id);
              request.document = describeLetterForRequester({
                caseRow,
                letterDocument: documentOfType(documents, LETTER_DOCUMENT_TYPE),
                // THE READER'S OWN SESSION, from ./personas.js's server-owned
                // map — never the case's own employment id, which would be a
                // row verified against itself.
                session: persona.session,
              });
            } catch (err) {
              console.error(`[portal] my-requests: uc03 document for ${request.recordId}: ${err.stack}`);
            }
          }
        }

        // UC-01's own analogue — round-6 D-01. This is the ONLY thing "My
        // requests" was ever able to do for a self-service letter before this
        // pass, because ownerScopeFor() refused every uc01 pairing outright
        // ("No ownership rule exists for uc01"); now that it is scoped, a
        // returning employee reaches the same open/save controls the UC-03
        // branch above already has.
        const uc01Scope = ownerScopeFor(persona, "uc01");
        if (uc01Scope.scoped && stores.uc01) {
          for (const request of requests) {
            if (request.type !== "uc01" || !request.recordId) continue;
            try {
              const caseRow = await stores.uc01.findById(request.recordId);
              if (!caseRow) continue;
              const { documents } = await readCaseAttachments(stores.uc01, caseRow.id);
              request.document = describeUc01LetterForRequester({
                caseRow,
                letterDocument: documentOfType(documents, UC01_LETTER_DOCUMENT_TYPE),
                session: persona.session,
              });
            } catch (err) {
              console.error(`[portal] my-requests: uc01 document for ${request.recordId}: ${err.stack}`);
            }
          }
        }

        // Newest first across all seven, so the page reads as one history
        // rather than as seven queues concatenated.
        //
        // SORTED BY WHEN IT WAS FILED, NOT BY WHEN IT WAS DECIDED, and that is
        // deliberate: this is the requester's own history and a list that
        // reordered itself under them every time a specialist touched
        // something would be unreadable. What a decision changes is PROMINENCE,
        // not position — `settled` below, and the count that follows it, are
        // what make one impossible to scroll past.
        requests.sort((a, b) => String(b.submittedAt ?? "").localeCompare(String(a.submittedAt ?? "")));

        // "Has anything happened since I last looked?", answered once, here.
        // The page could count `settled` itself; it deliberately does not, for
        // the same reason it composes no other sentence on this surface.
        const settled = requests.filter((request) => request.settled);

        return send(res, 200, {
          ok: true,
          requests,
          notListed,
          readOnly: true,
          decided: {
            count: settled.length,
            total: requests.length,
            useCases: settled.map((request) => request.useCase),
            summary: settled.length
              ? `${settled.length} of your ${requests.length} request${requests.length === 1 ? "" : "s"} ${settled.length === 1 ? "has" : "have"} been decided by a person: ${settled.map((request) => `${request.useCase} — ${request.status.label.toLowerCase()}`).join("; ")}.`
              : "",
          },
          // Stated in the payload, not only in the page's copy, so the boundary
          // travels with the data to anything else that reads this route.
          note:
            "Read-only. The portal shows what happened to a request; it never offers a control that could decide one — that would be a second, unaudited place the decision could be made. A specialist reviews and decides it, and you'll see the outcome here as soon as they do.",
          // Careful about what this claims. The list is read from the RECORD
          // rather than from a submission list this page kept — which is the
          // fix — and whether a record outlives the process depends on a
          // durable store being attached, which is true of the deployment and
          // not of a bare `npm run portal`. Saying "this survives a restart"
          // flatly would be the same shape of overclaim the old note made in
          // the other direction.
          scope:
            "Every request you filed through this portal, read live from the record itself rather than from a list this page kept. Where a durable store is attached — which is how the deployment runs — that record outlives the process that took the submission, which is what makes this work on serverless, where a fresh process is built for every single request. Each status below is re-read on every load, never cached.",
        });
      }

      // ---------------------------------------------------------------------
      // GET /api/consent-requests?persona=<key> — L-13, the employee's own
      // consent surface: "who is asking to be told about me, and I have not
      // yet answered."
      // ---------------------------------------------------------------------
      // AN ACT ABOUT ONE'S OWN CONSENT, NOT A SPECIALIST APPROVAL.
      //
      // This file's own header states the portal "offers no approve/decline
      // anywhere... duplicating [the human gate] here would create a second,
      // unaudited place a 🟡 decision could be made" — and that rule is
      // exactly right, for the 🟡/🔴 review gates the ZAF sidebar and each use
      // case's own approval endpoint already own. GRANTING OR DENYING CONSENT
      // TO DISCLOSE ONE'S OWN EMPLOYMENT IS A DIFFERENT ACT: it is the
      // employee acting on their OWN record, never a specialist deciding
      // someone ELSE's case, and `src/remoteui/roles.js` already draws this
      // exact line for UC-06 ("Consent is the employee's or employer's act,
      // never the admin's... the admin's control point is the dual approval
      // in the sidebar, not a signature"). This route is that same distinction
      // applied to UC-01's third-party disclosure.
      //
      // EMPLOYEE PERSONAS ONLY, scoped by their OWN employment id — never an
      // admin, and never another employee's requests. Copies
      // `src/remoteui/roles.js`'s cross-party refusal rather than reinventing
      // it (L-13's own done-criterion).
      if (req.method === "GET" && isPath(parts, ["api", "consent-requests"]) && parts.length === 2) {
        const persona = resolvePersona(url.searchParams.get("persona"));
        if (!persona) {
          const denial = unauthenticated();
          return send(res, denial.status, { ok: false, code: denial.code, reason: denial.reason });
        }
        if (persona.kind !== "employee") {
          return send(res, 403, {
            ok: false,
            code: "persona_cannot_view_consent_requests",
            reason: "Only the employee named on a request may see who is asking to be told about them.",
          });
        }
        const store = stores.uc01;
        if (!store || typeof store.findConsentRequestsForEmployee !== "function") {
          return send(res, 200, { ok: true, requests: [] });
        }
        const rows = await store.findConsentRequestsForEmployee(persona.employmentId);
        return send(res, 200, {
          ok: true,
          requests: rows.map((r) => consentRequestView(r)),
          // L-19: the ageing rule, stated here so the page can label its own
          // "waiting longer than X" verdict as OUR policy figure, never
          // Remote's — A5's decision applies to every non-UC-06 clock.
          agePolicyDays: CONSENT_AGE_WARN_DAYS,
        });
      }

      // ---------------------------------------------------------------------
      // POST /api/consent-requests/:id/decide — grant or deny one request
      // ---------------------------------------------------------------------
      if (
        req.method === "POST" &&
        isPath(parts, ["api", "consent-requests"]) &&
        parts[2] &&
        parts[3] === "decide" &&
        parts.length === 4
      ) {
        const body = await readJsonBody(req);
        const persona = resolvePersona(body.persona);
        if (!persona) {
          const denial = unauthenticated();
          return send(res, denial.status, { ok: false, code: denial.code, reason: denial.reason });
        }
        if (persona.kind !== "employee") {
          return send(res, 403, {
            ok: false,
            code: "persona_cannot_decide_consent",
            reason: "Only the employee named on a request may grant or deny it.",
          });
        }
        const decision = body.decision === "grant" ? "granted" : body.decision === "deny" ? "denied" : null;
        if (!decision) {
          return send(res, 400, { ok: false, code: "decision_required", reason: "decision must be 'grant' or 'deny'." });
        }
        const store = stores.uc01;
        const record = store ? await store.findConsentRecordById(parts[2]) : null;
        if (!record) {
          return send(res, 404, { ok: false, code: "consent_request_not_found" });
        }
        // CROSS-PARTY REFUSAL, server-side — an employment id claimed in the
        // body is never trusted; the record's OWN employment id (read back by
        // findConsentRecordById(), joined through `cases`) is compared to the
        // session's. Two nulls are never a match (matches() in roles.js draws
        // the identical line for the identical reason).
        if (!record.employmentId || record.employmentId !== persona.employmentId) {
          return send(res, 403, {
            ok: false,
            code: "not_your_consent_request",
            reason: "An employee may only decide a request about their own employment.",
          });
        }
        if (record.status === "granted" || record.status === "denied") {
          return send(res, 409, {
            ok: false,
            code: "already_decided",
            reason: `This request was already ${record.status} and cannot be decided twice.`,
          });
        }
        await store.updateConsentDecision(parts[2], {
          status: decision,
          grantedByEmploymentId: persona.employmentId,
          grantedBySignal: "portal_persona_session",
        });
        // DURABLE, BEFORE THE RESPONSE — the same ordering invariant 4
        // requires for every decision in this repo: the record of what the
        // employee decided must exist before anyone is told it happened.
        await audit.logDurable({
          useCase: "UC-01",
          action: decision === "granted" ? "consent_granted" : "consent_denied",
          actor: persona.employmentId,
          riskTier: "medium",
          details: {
            consentRecordId: parts[2],
            caseId: record.caseId,
            requestingParty: record.requestingParty,
            purpose: record.purpose,
          },
        });
        // THE GRANT IS WHAT ADVANCES THE ENQUIRY (rca — owner report
        // 2026-08-28: "I consented... I went to Zendesk expecting to see a
        // ticket... I do not see that"). Until now, granting recorded the
        // employee's decision and stopped: raising the hand-off needed the
        // third party to ask a second time, which nobody should have to do.
        //
        // AWAITED, but its outcome cannot fail this response — the employee's
        // decision is already durable above, and losing their grant to a
        // Zendesk hiccup would be strictly worse than a late hand-off. Only a
        // GRANT advances; a denial returns `consent_not_granted` and reaches
        // no specialist, which is the point of the employee owning this.
        //
        // `forSource()` is not optional here. This portal's own `remote` is
        // the in-process MOCK by construction (deploy/cx-apis/deps.js explains
        // why), and a third-party case names a REAL employment id — looking it
        // up in the mock would 404 and turn a consented, valid disclosure into
        // an escalation about a record that "does not exist".
        // `"granted"`, NOT `"grant"`. The wire verb is `grant`; it is normalised
        // to the stored status `granted` at the top of this route, and the first
        // version of this guard compared against the wire verb — so it never
        // fired, the grant recorded correctly, and NOTHING advanced. Silent, and
        // identical from outside to the bug it was written to fix. Pinned by a
        // route-level test rather than a module-level one, because the module
        // was correct the whole time.
        if (decision === "granted") {
          const advanceRemote =
            (typeof remote?.forSource === "function" ? remote.forSource("third_party_door") : null) ??
            thirdPartyRemote ??
            remote;
          const advanced = await advanceOnConsentGrant({
            caseStore: store,
            audit,
            remote: advanceRemote,
            zendesk,
            consentRecordId: parts[2],
          });
          if (!advanced.advanced) {
            console.log(`[portal] consent granted but not advanced: ${advanced.reason}`);
          }
        }

        const updated = await store.findConsentRecordById(parts[2]);
        return send(res, 200, { ok: true, request: consentRequestView(updated) });
      }

      return send(res, 404, { ok: false, code: "no_such_route", path: url.pathname });
    } catch (err) {
      console.error(`[portal] ${req.method} ${url.pathname} failed: ${err.stack}`);
      return send(res, 500, { ok: false, code: "internal_error", reason: err.message });
    }
  };
}

/**
 * One consent_records row, shaped for the employee deciding it. Never the
 * message text the third party sent (that lives on the CASE, which this
 * route does not expose) — the employee needs enough to decide (who is
 * asking, for what, how long it has been waiting), not the third party's
 * own prose.
 */
function consentRequestView(row) {
  const ageMs = Date.now() - new Date(row.createdAt).getTime();
  const ageDays = Math.floor(ageMs / (24 * 60 * 60 * 1000));
  return {
    id: row.id,
    requestingParty: row.requestingParty,
    purpose: row.purpose,
    status: row.status,
    createdAt: row.createdAt,
    ageDays,
    // L-19/VC-32: an age and a verdict, never a state change. `waitingLong`
    // is a LABEL for the page to style, not a transition of any kind — the
    // row's own `status` above is completely unaffected by how old it is.
    // Shared with the approval queue (src/approvalqueue/queue.js) via
    // ../shared/consentPolicy.js so the two surfaces can never disagree on
    // the figure or the verdict.
    waitingLong: isConsentWaitingLong(row.status, row.createdAt),
  };
}

// ---------------------------------------------------------------------------
// One stored row, as the requester sees it
// ---------------------------------------------------------------------------
// Everything here is READ off the row or off ./requestTypes.js. Nothing is
// re-derived, and no decision string is invented: a field the store does not
// carry stays null and the page simply omits that line, which is why a 🔴
// dossier shows no "decision" — its store has no such column, and printing
// "escalate" from this file would be this file deciding.
// ---------------------------------------------------------------------------
function myRequestView(type, row) {
  const status = describeStatus(type.id, row);
  return {
    type: type.id,
    useCase: type.useCase,
    tier: type.tier,
    recordLabel: type.recordLabel,
    recordId: row.id ?? null,
    // What the record carries NOW. Once a ticket is raised this is the ticket
    // id, which is also what the ZAF sidebar looks the case up by — so a
    // requester quoting it and a specialist searching it are using one string.
    externalRef: row.externalRef ?? null,
    submittedAt: row.createdAt ?? null,
    decision: row.decision ?? null,
    reason: row.reason ?? null,
    // round-6 D-06: the "Reason" column used to render `reason` above
    // straight to the requester — this system's own gate vocabulary
    // (`over_policy_cap`, `destination_unknown`, …). `reason` stays, because
    // it is the string a specialist searches `audit_log` by; `reasonLabel` is
    // what the page is allowed to print.
    reasonLabel: reasonLabel(row.reason ?? null),
    status,
    // HAS A HUMAN FINISHED WITH THIS? Decided HERE rather than in the browser,
    // for the same reason every other string on that page is: the page renders
    // what it is given and never decides what "decided" means. It reads the
    // portal's own STATE — not any use case's store status — so it is one
    // answer for all seven and it does not move when a use case renames a verb
    // in its own vocabulary.
    settled: SETTLED_STATES.has(status.state),
    // The settled sentence in the deciding use case's OWN vocabulary rather
    // than a paraphrase of it — see the import comment. Null for anything
    // still open and for the use cases with no describer of their own;
    // `status.decidedBy`/`decidedAt`/`note` carry the same facts in fields for
    // all seven either way, so nothing is lost where this is null.
    resolution: settledSummary(type.id, row, status),
    // THE SAME FACTS, AS FACTS. See settledFactsFor() — the sentence above is
    // kept for a surface that can only render one string, and this is what the
    // page actually draws.
    resolutionFacts: settledFactsFor(type.id, row, status),
    // THE DOCUMENT THIS REQUEST PRODUCED, when the requester may hold one.
    // NULL HERE AND FILLED IN BY THE ROUTE, for exactly one use case: knowing
    // whether a travel letter exists means reading the `documents` table, and
    // this function is pure and synchronous. Null is the honest default and it
    // renders as an em dash — six of the seven use cases produce no artifact a
    // requester can collect, and the two that produce something they cannot are
    // named in docs/use-cases/UC-03.md §22.
    document: null,
  };
}

/**
 * The portal states that mean A HUMAN HAS FINISHED WITH IT.
 *
 * ON_HOLD is deliberately absent: a hold is not a verdict — the expense is still
 * open, can still be released or declined, and telling the person waiting for
 * their money that it has been "decided" would be the reassuring rounding
 * ./requestStatus.js's header refuses to make. AUTO_RESOLVED is absent for the
 * opposite reason: it is finished, but no human ever touched it, and this flag
 * exists to answer "has a person looked at this yet?".
 */
const SETTLED_STATES = new Set([STATES.APPROVED, STATES.DECLINED, STATES.EXECUTED]);

/**
 * Each use case's own settled-expense describer, keyed by the portal's type id.
 *
 * FOUR OF THE SEVEN HAVE ONE, AND IT USED TO BE ONE. This map read `uc02` only,
 * so a requester whose workation was approved, whose resignation report was
 * signed off, or whose off-cycle payment was executed got the status
 * describer's single sentence and none of what the row actually carried —
 * both signatures on a dual-approved adjustment, the note the specialist left,
 * or whether the write to Remote landed at all. Every one of those sentences
 * already existed, one import away, written for the reviewer's own panel
 * (src/shared/settledDecision.js). UC-03 and the two 🔴 dossiers have no
 * describer because they have no human decision to describe.
 */
const SETTLED_DESCRIBERS = {
  uc02: uc02Review,
  uc04: uc04Approval,
  uc05: uc05Signoff,
  uc09: uc09MultiApproval,
};

/**
 * The sentence naming what actually happened, or null.
 *
 * GUARDED ON THE PORTAL'S OWN STATE, NOT ON A STORE STATUS STRING. It used to
 * test `row.status !== "released" && row.status !== "declined"` — UC-02's two
 * terminal statuses, spelled out here, in a second file. A verb renamed inside
 * src/uc02/ (release -> approve) would have left this comparison silently
 * matching nothing, and a requester whose expense HAD been decided would have
 * been shown no resolution at all: the failure would have been an absence,
 * which is the kind nobody reports. `status.state` is the portal's vocabulary
 * and it is the one this file is entitled to compare against.
 *
 * The generic fallback is dropped rather than printed. Every describer returns
 * its own "already X or Y" sentence for a row whose outcome it cannot read
 * (an `executing` adjustment, mid-write, is exactly such a row), and that
 * sentence enumerates possibilities the reader wanted resolved. Where it comes
 * back, the status describer's sentence is already on screen and says more.
 */
function settledSummary(typeId, row, status) {
  const policy = SETTLED_DESCRIBERS[typeId];
  if (!policy || !row) return null;
  if (!SETTLED_STATES.has(status.state)) return null;
  const sentence = policy.describeSettled(row);
  if (!sentence || sentence === policy.REFUSALS?.already_decided?.reason) return null;
  return sentence;
}

/**
 * The settled decision as LABELLED FACTS, where the deciding use case publishes
 * them that way.
 *
 * WHY A SECOND ACCESSOR AND NOT A REPLACEMENT. The project owner read a settled
 * UC-04 approval and asked "please explain to me why all this story": five facts
 * — who, when, their note, that Remote was not updated, and why — run together
 * into one paragraph, three of which this page ALREADY has their own column for.
 * A paragraph is the right shape for a surface that can render exactly one
 * string (the sidebar's reason field is one), and the wrong shape for a table.
 * So the describer publishes both and each surface takes the one it can draw.
 *
 * Only the use cases that publish `settledFacts()` return anything here; the
 * rest fall through to the sentence, unchanged. Nothing is invented for a use
 * case that has not been converted — an absent list means "this describer has no
 * fields", never "this decision has no facts".
 */
function settledFactsFor(typeId, row, status) {
  const policy = SETTLED_DESCRIBERS[typeId];
  if (!policy || !row || typeof policy.settledFacts !== "function") return null;
  if (!SETTLED_STATES.has(status.state)) return null;
  const settled = policy.settledFacts(row);
  if (!settled) return null;

  // SAID ONCE, IN ONE PLACE. Who decided, when, and the note they left are
  // already three COLUMNS of this table (`status.decidedBy`, `status.decidedAt`,
  // `status.note`), read off the same row. Printing them again inside the
  // resolution cell is exactly the repetition that turned a decision into a
  // story, so a fact whose VALUE a column already carries is dropped here.
  //
  // MATCHED ON VALUE, NEVER ON LABEL. The labels belong to the deciding use
  // case's own vocabulary — "Approved by" for one, "Signed off by" for the next
  // — and a label list kept here would be a second copy free to drift out of
  // step with the describer it filters. A value comparison cannot drift: if the
  // column is showing that string, the reader has it.
  const alreadyShown = new Set(
    [status.decidedBy, humanTime(status.decidedAt), status.note].map((v) => String(v ?? "").trim()).filter(Boolean)
  );
  const facts = (settled.facts ?? []).filter((fact) => !alreadyShown.has(String(fact.value ?? "").trim()));
  return { ...settled, facts };
}

// ---------------------------------------------------------------------------
// The Zendesk hand-off
// ---------------------------------------------------------------------------
// Raise a pre-tagged ticket for a decision that needs a human, and point the
// stored record's `externalRef` at it so the ZAF sidebar's by-ticket lookup
// finds it. Whether a ticket is needed at all is decided by ./ticketing.js —
// a pure function, so "which submissions reach a human" is one readable table
// rather than a condition buried in this route.
//
// EVERY FAILURE MODE HERE IS NON-FATAL, and each is reported rather than
// swallowed. The decision and its audit row already exist; a ticket that could
// not be raised is a hand-off that did not happen, which a person needs to
// know about — but it is never a reason to fail a request whose real work is
// done. The response carries `ticketId: null` plus `ticketError`, and the
// audit log gets a row naming the failure, so "no ticket" is never silent.
// ---------------------------------------------------------------------------

async function raiseTicketIfNeeded({
  typeId,
  decision,
  recordId,
  persona,
  outcome,
  type,
  stores,
  zendesk,
  employmentIdFieldId,
  audit,
  // The reference the requester was shown, carried this far for one row: the
  // hand-off failure below. See its comment for why that row above all others.
  externalRef = null,
  // WHAT THE TICKET IS CALLED, when the default does not say enough.
  //
  // The default names the request TYPE and the decision, which is the whole
  // truth for a submission: one form, one decision, one ticket. The letter
  // hand-off below is the one caller for which it is not — a `human_review` on
  // a travel request is either "the router distrusted its own reading" or "a
  // formal letter is drafted and needs a signature", and those are different
  // work. A specialist scanning a queue reads the subject line before anything
  // else, so the difference belongs there and not only in the tags.
  subject = null,
}) {
  // ANYTHING ALREADY HANDLED RAISES NOTHING — both flavours (see
  // deliveryFields()). Either the ledger refused this reference or the subject
  // had already been decided; in both cases nothing new was decided, no second
  // record exists, and the first submission's ticket (if it needed one) already
  // stands. Creating a ticket here would be precisely the duplicate this
  // machinery exists to prevent, arriving in a real support queue.
  if (outcome.envelope.alreadyHandled === true) {
    return {
      ticketId: null,
      envelope: {
        ticketId: null,
        ticketCreated: false,
        ticketNote: ticketHandoffAlreadyHandled(),
      },
    };
  }

  const wanted = needsTicket(typeId, decision);
  if (!wanted) {
    return {
      ticketId: null,
      envelope: {
        ticketId: null,
        ticketCreated: false,
        // Said plainly, because "no ticket" has two very different causes and
        // a tester must not have to guess which one they got.
        ticketNote: ticketHandoffNotNeeded({ ticketable: TICKETABLE_TYPES.includes(typeId) }),
      },
    };
  }

  if (!zendesk) {
    return {
      ticketId: null,
      envelope: {
        ticketId: null,
        ticketCreated: false,
        ticketNote: ticketHandoffNoZendeskConfigured(),
      },
    };
  }

  const tags = ticketTags(typeId, decision);

  // --- ROUTE IT TO THE TEAM THAT OWNS IT ------------------------------------
  // A tag is a label something COULD route on. Assignment is the hand-off.
  // src/shared/escalationRouting.js holds the one mapping, taken from each use
  // case's own spec; `urgencyFor()` raises priority and sets a due date only
  // when the DECISION produced a real deadline (UC-06's payroll cutoff lock is
  // the only one this system actually knows).
  //
  // THE DECISION IS PART OF THE LOOKUP, and it did not used to be. `routeFor()`
  // was applied to every ticketed decision and pushed one `escalation_<team>`
  // tag onto all of them — so a `ready_for_approval`, the ordinary healthy
  // medium-tier outcome, reached Zendesk labelled an escalation and addressed
  // to UC-04's Tier-2 legal queue. `handoffFor()` splits the two claims the one
  // tag was making: the OWNING TEAM's `queue_*` tag goes on every ticket (the
  // reviews have to be routable too, which is why "tag only escalations" is the
  // wrong fix), and the `escalation_*` tag goes on only when the decision
  // really is an escalation. See that module's header.
  //
  // The group is looked up, never created — see RemoteClient.listGroups()'s
  // header. A missing group is reported on the ticket and in the note, so the
  // failure is visible rather than a silently unassigned escalation.
  //
  // RESOLVED THROUGH src/shared/groupAssignment.js, NOT REIMPLEMENTED HERE.
  // This used to be a second copy of that module's live-read/synced-id/
  // no-handoff logic, kept only because another agent held this file while
  // groupAssignment.js was built. The two copies drifted (rca-ee04): a wording
  // fix landed on the shared module's no-handoff sentence and this copy kept
  // printing `src/shared/escalationRouting.js` and the raw use-case code to a
  // requester's own result panel. One implementation now, so there is nothing
  // left to drift.
  const handoff = handoffFor({ useCase: type.useCase, decision });
  const urgency = urgencyFor({ useCase: type.useCase, deadlineIso: deadlineFrom(outcome) });
  const resolved = await resolveGroupAssignment({ handoff, zendesk, useCase: type.useCase });
  tags.push(...resolved.routingTags);

  const assignment = {
    ...resolved,
    priority: urgency.priority,
    dueAt: urgency.dueAt,
    urgencyReason: urgency.urgencyReason,
  };

  try {
    const ticket = await zendesk.createTicket({
      subject: subject ?? `${type.useCase} — ${type.label} (${decision})`,
      // `html_body`, NOT `body`, AND ONLY BECAUSE THIS IS AN INTERNAL NOTE.
      // CLAUDE.md §4 records the expensive half of this rule: a PUBLIC reply
      // sent through n8n's `publicReply` is plain text and silently escapes
      // HTML, which once delivered a verification letter to a customer as
      // literal `&lt;!doctype html&gt;…` on a run that reported success
      // everywhere. An internal note is the documented "(Accepts HTML)" side,
      // confirmed against this account by posting one and reading the rendered
      // comment back — never by trusting the create call's status.
      comment: {
        html_body: buildTicketNote({ type, outcome, decision, recordId, persona, assignment }),
        public: false,
      },
      requester: persona ? { name: persona.name, email: personaEmail(persona) } : undefined,
      tags,
      priority: assignment.priority,
      ...(assignment.groupId ? { group_id: assignment.groupId } : {}),
      ...(assignment.dueAt ? { due_at: assignment.dueAt } : {}),
      custom_fields:
        employmentIdFieldId && persona?.employmentId
          ? [{ id: Number(employmentIdFieldId), value: persona.employmentId }]
          : undefined,
    });

    // Let the record's own background insert land before updating it — the
    // same flush-before-update rule every pooled store in this repo follows,
    // because an UPDATE that overtakes its own INSERT matches zero rows.
    const store = stores[typeId];
    if (store?.flush) await store.flush();
    if (recordId && store?.linkTicket) await store.linkTicket(recordId, String(ticket.id));

    // --- THE RECORD'S REFERENCE JUST CHANGED, AND NOTHING SAID SO ---------
    //
    // linkTicket() REPLACES the stored record's `external_ref` with the ticket
    // id, so the ZAF sidebar's by-ticket lookup finds it. Everything written
    // about this request from here on carries the ticket id — a UC-03 routing
    // continued into UC-04 files both decisions under it (./uc03Continuation.js)
    // — while the requester is still holding the reference they submitted.
    //
    // Measured on the live trail for one request: the travel decision sat under
    // `uc03-20260819205307-1psu2` and every row after it under `"50"`, with
    // neither half naming the other. Two half-stories under two ids is not what
    // "the id that ties every record of this request together" promises, and
    // the join existed nowhere — not in a column, not in a row.
    //
    // So the relink is recorded, keyed on the reference the REQUESTER holds,
    // naming the one the records carry from now on. Same rule as
    // recordReferenceSubstitution() and for the same reason: readStore.js
    // resolves a reference by `details->>'externalRef'` alone, so a pointer
    // that is not in that field is a pointer nobody can follow.
    await recordTicketRelink({
      audit,
      type,
      typeId,
      submittedRef: externalRef,
      ticketId: String(ticket.id),
      recordId,
      persona,
      // THE GATE REASON THIS TICKET WAS RAISED FOR — rca-whir. Without this,
      // every use case whose ticket is created AFTER its decision (the portal's
      // "gates first, ticket after" ordering, see this function's header) wrote
      // its ticket id onto a row keyed `details.reason: "portal_reference_
      // relinked"` — its own action name, not the decision's — so a reader
      // joining on `details->>'reason'` (src/surfaceverify/scenarios.js's
      // `discoverScenarios()`, keyed exactly that way) could find a real,
      // ticketed UC-02 decision by reason and never see the ticket id sitting
      // one row later under a different reason. Measured live 2026-08-22: 65
      // UC-02 audit rows, 21 carrying SOME externalRef, exactly ONE numeric and
      // joinable. Carrying the reason forward turns this relink row into the
      // newest, joinable row FOR THAT REASON — the same shape
      // src/uc01/workflow.js's third-party hand-off already uses
      // (`details.reason: outcome.reason` beside its own `ticketId`).
      reason: outcome.envelope.reason ?? null,
    });

    // --- A PUBLIC REPLY, SO THE PERSON WHO ASKED CAN READ AN ANSWER --------
    // ROUND-6 D-05. Every portal-raised ticket carried exactly ONE comment —
    // the internal note above — and Zendesk's own end-user request view
    // (`/hc/en-us/requests/:id`) has nothing else to show, ever, because
    // nothing else was ever written to it
    // (qa/evidence/UC-01/2026-08-22-uc01-e2e-6/OPEN-DEFECTS.md D-05: ticket
    // #119 carried one message, marked Internal, and zero public replies,
    // unchanged twenty minutes later).
    //
    // THE WORDS ARE NOT WRITTEN HERE A SECOND TIME. `plainAnswer()` is the
    // exact function that composes the sentence this same decision renders on
    // the result panel — reusing it means the ticket and the page can never
    // disagree about what happened (§14 UX_ACCEPTANCE, "Consistency"), which a
    // hand-authored reply sitting beside it could silently stop doing the
    // moment either one changed.
    //
    // BEST-EFFORT, ON PURPOSE. The ticket and its internal note already exist
    // and are already correct; a failure writing the SECOND comment must not
    // erase either or be reported as a hand-off failure — that name is reserved
    // for `portal_ticket_creation_failed` above, where the record needs a
    // human and got none at all. Here a human already has it; only the
    // requester's own copy of the news failed to post.
    try {
      const summary = plainAnswer({
        useCase: type.useCase,
        decision: outcome.envelope.decision ?? null,
        reason: outcome.envelope.reason ?? null,
        flags: outcome.envelope.flags ?? null,
        executionPath: type.executionPath,
        recordLabel: type.recordLabel,
        placeCode: subjectCountryOf(outcome.envelope),
      });
      const publicReply = [summary.lead, summary.next].filter(Boolean).join(" ");
      await zendesk.updateTicket(ticket.id, { comment: { body: publicReply, public: true } });
    } catch (err) {
      audit.log({
        useCase: type.useCase,
        action: "portal_public_reply_failed",
        actor: persona?.id ?? "portal",
        riskTier: type.tier,
        details: { typeId, recordId, ticketId: String(ticket.id), error: err.message, source: PORTAL_SOURCE },
      });
    }

    return {
      ticketId: String(ticket.id),
      envelope: {
        ticketId: String(ticket.id),
        ticketCreated: true,
        ticketTags: tags,
        ticketAssignment: assignment,
        ticketNote: assignment.assigned
          ? ticketHandoffAssigned({
              ticketId: ticket.id,
              group: assignment.intendedGroup,
              priority: assignment.priority,
              dueAt: assignment.dueAt,
            })
          : ticketHandoffUnassigned({ ticketId: ticket.id, skippedReason: assignment.skippedReason }),
      },
    };
  } catch (err) {
    // The decision is already durable. Record the hand-off failure and say so
    // on the response; never lose the decision to it.
    audit.log({
      useCase: type.useCase,
      action: "portal_ticket_creation_failed",
      actor: persona?.id ?? "portal",
      riskTier: type.tier,
      // THE REFERENCE, ON THE ONE ROW THAT SAYS A REQUEST FELL ON THE FLOOR.
      // This row is written when the decision is durable but the Zendesk
      // hand-off failed — so the request needs a human and no human will ever
      // see it. Measured live on 2026-08-19 it carried no `externalRef`, which
      // meant the requester holding that reference could not find the row
      // telling them their request had been dropped. Of every row this system
      // writes, it is the one it is least acceptable to be unable to find.
      details: {
        typeId,
        recordId,
        decision,
        tags,
        error: err.message,
        externalRef: externalRef ?? null,
        source: PORTAL_SOURCE,
      },
    });
    return {
      ticketId: null,
      envelope: {
        ticketId: null,
        ticketCreated: false,
        ticketTags: tags,
        ticketError: err.message,
        ticketNote: ticketHandoffCreationFailed(),
      },
    };
  }
}

// ---------------------------------------------------------------------------
// The letter request's hand-off — the second decision reaching a human
// ---------------------------------------------------------------------------
// WHY THIS EXISTS AT ALL. `POST /api/requests/uc03/request-letter` produced a
// correct, durable, audited `human_review / formal_letter_requested` decision
// with the letter drafted — and returned without raising a ticket, because it
// never went near `raiseTicketIfNeeded()`. The ZAF sidebar finds a case by
// TICKET ID, so the specialist opened Zendesk and there was nothing there: not
// a missing button, a missing case. The project owner reported it in exactly
// those words. See ./ticketing.js's `letterTicketPlan()` for the design
// argument — whether the ticket follows the case or the trip — and for why a
// trip that already has one gets no second.
//
// IT RUNS AFTER THE DECISION IS DURABLE, and that ordering is the point rather
// than an accident of where the call sits. `acceptTravelLetterOffer()` has
// already returned: the case row, the `review_queue` row, the drafted document
// and the audit row all exist. A Zendesk failure from here is a hand-off that
// did not happen, which is reported and recorded; it can never erase a decision
// that was genuinely made. Same rule, same reason, as the submission path's own
// hand-off, and `test/portalUc03LetterHandoff.test.js` pins it with a Zendesk
// client that always throws.
//
// EVERY FAILURE IS VISIBLE. `raiseTicketIfNeeded()` writes
// `portal_ticket_creation_failed` and returns `ticketError`; production already
// carries one such row with no retry (`293b0f4e`, CLAUDE.md §7 item 9), and the
// one thing worse than that row is a second instance of it nobody can see.
// ---------------------------------------------------------------------------

/**
 * Raise (or decline to raise) the Zendesk ticket for an accepted letter offer.
 *
 * @param {object} args
 * @param {object} args.result  what `acceptTravelLetterOffer()` returned, on a
 *   successful accept only.
 * @returns {Promise<object>} the envelope to merge onto the route's response:
 *   `ticketId` / `ticketCreated` / `ticketNote`, exactly the fields the result
 *   panel already knows how to draw, plus `ticketHandoff` naming which of the
 *   four outcomes this was.
 */
async function handOffLetterRequest({ result, persona, stores, zendesk, employmentIdFieldId, audit }) {
  const type = findRequestType("uc03");
  const store = stores.uc03;

  // The trip's own case, read back rather than remembered: `linkTicket()` may
  // have moved its reference since it was written, and the reference is the
  // whole question here.
  const answeredCase = result.fromCaseId ? await store.findById(result.fromCaseId) : null;
  const plan = letterTicketPlan({ answeredCase, decision: result.decision ?? null });

  if (!plan.raise) {
    return {
      // The EXISTING ticket when the trip has one — not null. The requester is
      // told where their letter went, and "no new ticket" is not the same
      // sentence as "no ticket".
      ticketId: plan.existingTicketId,
      ticketCreated: false,
      ticketNote: plan.note,
      ticketHandoff: plan.code,
    };
  }

  if (!type) {
    // Unreachable while requestTypes.js carries a uc03 row, and stated rather
    // than assumed: the alternative is a TypeError inside a hand-off whose
    // entire purpose is to fail visibly.
    return {
      ticketId: null,
      ticketCreated: false,
      ticketNote: ticketHandoffNoRequestType(),
      ticketHandoff: "no_request_type",
    };
  }

  // The letter case as stored, for the facts the specialist needs on the
  // ticket. Read from the store rather than rebuilt from the accept response:
  // the response is a summary written for the traveller, and a signature is not
  // something to ask for on the strength of a summary.
  const letterCase = await store.findById(result.caseId);
  const trip = letterCase?.classification ?? {};

  const outcome = {
    envelope: {
      decision: result.decision ?? null,
      reason: result.decisionReason ?? null,
      flags: letterCase?.flags ?? [],
      details: [
        detail(
          LEAD_DETAIL,
          result.awaitingSignoff === true
            ? "The traveller accepted the formal-letter offer on a trip this system had already answered and cleared. " +
                "The letter is drafted and unissued: it needs a Travel & Mobility Support signature before it reaches them."
            : result.reason ?? "A formal travel letter was requested against an already-answered trip."
        ),
        detail("What the employee asked", letterCase?.ticketText ?? "not recorded"),
        detail("Destination", trip.destinationCountry ?? "not recorded"),
        detail("First day", trip.startDate ?? "not recorded"),
        detail("Last day", trip.endDate ?? "not recorded"),
        // DRAFTED AND ISSUED ARE TWO FACTS. `submitTravelLetterSignoff()` is
        // the only code in this repository that can set `letterIssued: true`,
        // and a specialist must never read "letter" on a ticket and assume the
        // customer already has it.
        detail("Letter drafted", result.letterDrafted === true ? "yes — held, unissued, for the signature below" : "no"),
        detail("Awaiting sign-off", result.awaitingSignoff === true ? "yes" : "no"),
        detail("Continues the answered case", result.fromCaseId ?? "not recorded"),
        detail(
          "How to sign it",
          "Open this ticket in the ZAF sidebar — it loads the newest UC-03 case on the ticket, which is this letter " +
            "— or POST /api/cases/" + (result.caseId ?? ":id") + "/signoff (decline needs a reason)."
        ),
      ],
    },
  };

  const handoff = await raiseTicketIfNeeded({
    typeId: "uc03",
    decision: result.decision ?? null,
    // The LETTER case, so `linkTicket()` points the row the sidebar will render
    // at the ticket it will be opened from.
    recordId: result.caseId ?? null,
    persona,
    outcome,
    type,
    stores,
    zendesk,
    employmentIdFieldId,
    audit,
    // The reference the requester has been holding since they asked the
    // question — the one the relink row must be keyed on, or the join it
    // records points from a string nobody typed.
    externalRef: answeredCase?.externalRef ?? null,
    subject: `${type.useCase} — formal travel letter, awaiting sign-off`,
  });

  return { ...handoff.envelope, ticketHandoff: plan.code };
}

// ---------------------------------------------------------------------------
// The reference the requester HOLDS vs. the reference the records CARRY
// ---------------------------------------------------------------------------
// WHAT WAS BROKEN, AND HOW IT WAS FOUND
// The result panel prints the reference the page SENT, under this sentence:
// "the id that ties every record of this request together; quote it to have
// this request traced." A requester quoted `uc04-20260819205605-2hnba` in the
// audit viewer and found nothing. Against production:
//
//   select … from audit_log where details->>'externalRef' like 'uc04-20260819%'
//   -> 0 rows
//
// The decision was there the whole time, three rows away, under `"50"` — the
// Zendesk ticket id of the UC-03 travel request the assessment continued. So
// the sentence on screen was FALSE, on the one control whose entire job is
// traceability, and it was found by somebody doing exactly what the page told
// them to do. `docs/CORRECTIONS-LOG.md` calls this P9: said MORE than it did.
//
// WHY THE SUBSTITUTION IS RIGHT AND IS NOT THE BUG
// A UC-04 assessment continuing a UC-03 routing is filed under the TRAVEL
// request's reference on purpose (./uc03Continuation.js states the reasoning in
// full). Two things follow from `workflow_claims`' primary key
// `(use_case, external_ref)`: sharing the string costs no idempotency, because
// the two claims differ in their FIRST column — `(UC-03, "50")` and
// `(UC-04, "50")` are two rows, and a redelivery of either is still refused at
// the key — and sharing it buys the thing `src/auditview/` actually reads,
// whose bug-audit view is keyed by externalRef and therefore renders the travel
// decision and the work-authorization decision as one story rather than two
// unrelated rows. Undoing it would break the join and fix nothing: the
// requester would then hold a reference that traces half the request.
//
// WHAT IS THE BUG IS THE SILENCE. The server accepted a reference, filed the
// request under a different one, and told the requester the first one traced
// everything. So the substitution is now ITSELF an audited event, keyed on the
// reference the requester was shown and naming the one the records carry. Both
// strings now resolve in the viewer, and either one leads to the other.
//
// WHY A ROW AND NOT A COLUMN NEXT TO IT. `src/auditview/readStore.js` looks a
// reference up with `where details->>'externalRef' = $1` — one column, exact
// match. A `submittedRef` field sitting beside `externalRef` on the decision
// row would be a fact that is true, recorded, and unfindable from the only
// string a human holds, which is most of the way back to the defect. The row is
// what makes the promise true; the extra field on it is the pointer.
// ---------------------------------------------------------------------------

/**
 * The action name for a record being relinked to its Zendesk ticket id.
 *
 * A DIFFERENT FACT FROM A SUBSTITUTION, so a different action. A substitution
 * means the reference the requester was shown was never used. A relink means it
 * WAS used, and a second reference — the ticket id — joined it afterwards and
 * is what everything downstream will carry. Collapsing the two would make the
 * feed unreadable in exactly the place a reader is trying to work out which id
 * to trust.
 */
export const REFERENCE_RELINKED_ACTION = "portal_reference_relinked";

/**
 * The correlation field name each ticketable use case's OWN decision rows
 * carry their record id under — rca-whir, and copied verbatim from
 * `src/auditview/readStore.js`'s `CORRELATION_FIELDS` comment (the list is
 * documented there once; this is not a second source of truth, it is the
 * subset this file needs to WRITE the same field name a decision row already
 * carries, so a relink row becomes a real sibling of it). Without this, a
 * relink row's `recordId` sat under a key (`recordId`) no decision row for any
 * use case ever writes, so `details->>'storeId'`-style sibling correlation
 * (what `src/surfaceverify/scenarios.js`'s ticket lookup uses to find a
 * decision's OWN relink row, scoped to that one record rather than any row
 * sharing its reason) could never match it.
 */
const RECORD_CORRELATION_FIELD = Object.freeze({
  uc01: "caseId",
  uc02: "storeId",
  uc03: "caseId",
  uc04: "authorizationId",
  uc05: "resignationId",
  uc06: "amendmentId",
  uc09: "adjustmentId",
});

/**
 * Record that a request's stored record now also answers to a Zendesk ticket id.
 *
 * Best-effort in the same never-silent way as the substitution row, and for a
 * stronger reason: this runs INSIDE raiseTicketIfNeeded()'s try block, where a
 * throw would be caught and reported as "the ticket could not be created" — a
 * ticket that was in fact created. So it swallows its own failure rather than
 * borrowing that catch and misattributing itself.
 *
 * @param {string|null} [reason] the underlying decision's own reason (e.g.
 *   "over_policy_cap"), so this row is joinable by reason — rca-whir. Written
 *   into `details.reason` so `discoverScenarios()`'s `details->>'reason'`
 *   lookup can find a ticketed decision by the reason it was raised for; a
 *   caller that omits it gets the row's own action name, matching this
 *   function's behaviour before rca-whir.
 * @returns {Promise<object|null>}
 */
export async function recordTicketRelink({ audit, type, typeId, submittedRef, ticketId, recordId, persona, reason = null }) {
  const ref = readSubmittedRef(submittedRef);
  if (!ticketId || ref === ticketId) return null;
  const session = persona?.session ?? null;
  const write = typeof audit?.logDurable === "function" ? audit.logDurable.bind(audit) : audit?.log?.bind(audit);
  if (typeof write !== "function") return null;

  // NO REFERENCE WAS SUBMITTED — rca-v07y. This function used to return here,
  // reasoning that a row keyed on null is a row nobody can find. That is true
  // and it drew the wrong conclusion: the fix for an unfindable row is to key
  // it on something findable, not to skip writing it. The ticket id is the
  // only reference this request has from this moment on, so it is what
  // `externalRef` carries below — a self-relink rather than a null one.
  //
  // Skipping the row entirely left every `store.linkTicket()` write with no
  // `audit_log` counterpart at all: `src/auditview/readStore.js`'s
  // `lookupRef()` — what `/audit`'s reference lookup runs — reads ONLY
  // `audit_log`, never the use-case store `linkTicket()` actually updates
  // (`src/auditview/identifiers.js`'s `NOT_SEARCHABLE_HERE` says so in so many
  // words). So a ticket created for a requester who typed no reference was
  // durably linked in the store and permanently invisible to `/audit` — a null
  // column standing in for a loud failure, in a file that otherwise goes out
  // of its way to avoid exactly that (see the row this one sits beside,
  // `recordReferenceSubstitution()`, and `recordIntakeRefusal()`).
  //
  // Measured against production 2026-08-22: 42 of 60 UC-02 decisions carried
  // `externalRef: null` and the other 18 a portal-generated reference — zero
  // carried the ticket id the hand-off actually created, for exactly this
  // reason. `linkTicket()` itself was never the defect (it correctly repoints
  // the store's `external_ref`, proved by
  // `test/portalTicket.test.js`'s "findable BY TICKET ID" case); the defect
  // was this function declining to leave `/audit` a trail to follow when
  // there was no PRIOR reference to relink FROM.
  const externalRef = ref ?? ticketId;
  const note = ref
    ? `This request was submitted under reference ${ref} and handed to a human as Zendesk ticket ${ticketId}. ` +
      `Its stored record now carries ${ticketId} as its reference, so anything decided about it from here on ` +
      `— including a work-authorization assessment continuing it — is filed under ${ticketId}. ` +
      "The two references name the same request."
    : `No reference was submitted with this request. It was handed to a human as Zendesk ticket ${ticketId}, and ` +
      `its stored record now carries ${ticketId} as its ONLY reference — so ${ticketId} is what finds it, here ` +
      "and everywhere else.";

  try {
    return await write({
      useCase: type.useCase,
      action: REFERENCE_RELINKED_ACTION,
      actor: session?.authenticatedEmploymentId ?? session?.authenticatedAdminId ?? "unauthenticated",
      riskTier: type.tier,
      details: {
        typeId,
        // The requester's own reference when they held one; the ticket id
        // itself when they did not — either way, a string this row can
        // actually be found by. See the no-reference branch above.
        externalRef,
        // THE DECISION'S OWN REASON (e.g. "over_policy_cap"), NOT this row's
        // own action name — rca-whir. `details->>'reason'` is the field
        // src/surfaceverify/scenarios.js joins scenario discovery on, keyed by
        // required reason; a relink row that echoed its own action name back as
        // "reason" was invisible to every such lookup, so a real, ticketed
        // decision could never be found by the reason a caller actually asked
        // for. Falls back to this row's own action name only when no caller
        // supplies one, matching the field's pre-existing value exactly for
        // any caller not yet updated to pass it.
        reason: reason ?? REFERENCE_RELINKED_ACTION,
        // Where the rest of the trail is from here on.
        recordedRef: ticketId,
        ticketId,
        recordId: recordId ?? null,
        // THE CORRELATION FIELD, under the SAME NAME the decision row itself
        // uses — rca-whir. `storeId` for UC-02, `authorizationId` for UC-04,
        // etc (RECORD_CORRELATION_FIELD above). This is what turns this row
        // into a genuine SIBLING of the decision it is relinking, scoped to
        // that one record — `recordId` alone was already carried above, under
        // a key no decision row anywhere writes, so nothing could ever
        // correlate on it.
        ...(recordId && RECORD_CORRELATION_FIELD[typeId] ? { [RECORD_CORRELATION_FIELD[typeId]]: recordId } : {}),
        note,
        source: PORTAL_SOURCE,
      },
    });
  } catch (err) {
    console.error(`[portal] failed to audit ${type?.useCase} ticket relink "${ref}" -> "${ticketId}": ${err.message}`);
    return null;
  }
}

/**
 * The action name for a reference substitution.
 *
 * NAMED FOR WHAT HAPPENED TO THE REFERENCE, not for what was decided. Nothing
 * was judged here — a gate had already run and its own row already exists. This
 * row says only "the id you were given is not the id these records carry, and
 * here is the id that is", which is why it must never be mistaken in a feed for
 * a decision.
 */
export const REFERENCE_SUPERSEDED_ACTION = "portal_reference_superseded";

/**
 * Read a caller-supplied reference as a non-empty string, or not at all.
 *
 * Same defensive read ./refusalAudit.js uses: a caller must not be able to
 * smuggle an object or a number into a text column.
 */
export function readSubmittedRef(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/**
 * Build the substitution event, or null when there was no substitution.
 *
 * PURE. It decides nothing about the request and writes nowhere.
 *
 * Returns null in the ordinary case — the two references are the same string,
 * so the reference the requester holds already finds the decision row and a
 * second row would be noise. A feed that is mostly noise trains its reader to
 * stop looking, which is the same call ./refusalAudit.js makes about 400s.
 *
 * @param {object} args
 * @param {{id:string, useCase:string, tier:string}} args.type
 * @param {string|null} args.submittedRef  the reference the requester was shown
 * @param {string|null} args.recordedRef   the reference the decision was filed under
 * @param {object|null} args.persona       resolved server-side, never from the body
 * @param {object} [args.envelope]         the adapter's own answer, for context only
 * @returns {object|null}
 */
export function buildReferenceSupersededEvent({ type, submittedRef, recordedRef, persona = null, envelope = {} }) {
  if (!submittedRef) return null;
  if (recordedRef && recordedRef === submittedRef) return null;

  const session = persona?.session ?? null;

  return {
    useCase: type.useCase,
    action: REFERENCE_SUPERSEDED_ACTION,
    // The server's answer, never the body's — the same expression
    // ./refusalAudit.js mirrors from the workflows themselves.
    actor: session?.authenticatedEmploymentId ?? session?.authenticatedAdminId ?? "unauthenticated",
    riskTier: type.tier,
    details: {
      typeId: type.id,
      // THE WHOLE POINT. This row is keyed on the string the REQUESTER holds,
      // because that is the only string they can quote. Every other row about
      // this request is keyed on `recordedRef`, and finding those is what this
      // one exists for.
      externalRef: submittedRef,
      // The searchable slug, in the slot the viewer's `reason` column reads.
      reason: REFERENCE_SUPERSEDED_ACTION,
      // WHERE TO GO NEXT, under the name it is: not another externalRef, which
      // would put two different meanings in one field on one row.
      recordedRef: recordedRef ?? null,
      recordId: envelope.recordId ?? null,
      decision: envelope.decision ?? null,
      // The sentence a person reads when this row is the only one their id
      // finds. It has to be able to stand alone, because by construction it is
      // the first and possibly only thing they will see.
      note: recordedRef
        ? `This request was submitted under reference ${submittedRef} and filed under reference ${recordedRef}. ` +
          `Trace it by ${recordedRef} — that is the reference its decision, its idempotency claim and every related ` +
          `record carry. The two references name the same request.`
        : `This request was submitted under reference ${submittedRef} and its decision was NOT filed under any ` +
          `reference. There is no reference to trace it by; use the record id instead.`,
      source: PORTAL_SOURCE,
    },
  };
}

/**
 * Record one reference substitution, durably, without ever failing the request.
 *
 * DURABLE AND AWAITED, unlike ./refusalAudit.js's best-effort row, because the
 * two are protecting opposite things. There, the caller is being told NO and a
 * logger outage must not turn a working control into a 500. Here the caller has
 * already been decided and is about to be handed a reference — and if this row
 * is missing, that reference names nothing, which is exactly the defect. So it
 * uses logDurable() where the logger offers one, and awaits it.
 *
 * IT STILL CANNOT THROW. The decision is already made and already recorded
 * under `recordedRef`; failing the response would discard a completed decision
 * to protect a pointer to it, which is strictly worse than the pointer being
 * missing. A failure is loud on stderr instead — the same never-silent swallow
 * ./refusalAudit.js documents.
 *
 * @returns {Promise<object|null>} the recorded entry, or null when nothing was recorded
 */
export async function recordReferenceSubstitution({ audit, type, submittedRef, recordedRef, persona, envelope }) {
  const event = buildReferenceSupersededEvent({ type, submittedRef, recordedRef, persona, envelope });
  if (!event) return null;
  const write = typeof audit?.logDurable === "function" ? audit.logDurable.bind(audit) : audit?.log?.bind(audit);
  if (typeof write !== "function") return null;
  try {
    return await write(event);
  } catch (err) {
    console.error(
      `[portal] failed to audit ${type?.useCase} reference substitution ` +
        `"${submittedRef}" -> "${recordedRef}": ${err.message}`
    );
    return null;
  }
}

/**
 * Values that are TELEMETRY, not the specialist's business.
 *
 * The project owner opened a hand-off ticket and found "Narrative faithfulness:
 * not_evaluated" sitting in the body of it. That is this system checking its own
 * drafted prose against the structured facts it was drafted from — a real check,
 * worth keeping, and meaningless to a mobility specialist deciding whether
 * somebody may work from Portugal. It is not deleted; it moves to the operators'
 * section at the bottom, with everything else that is about the machinery rather
 * than about the request.
 *
 * MATCHED ON LABEL, and the labels are the ones the adapters above already
 * publish, so a detail added later defaults to the SPECIALIST's section. That
 * direction is deliberate: a new fact the specialist does not need is noise they
 * can skip, while a new fact hidden from them is a fact nobody reads.
 */
const OPS_ONLY_DETAILS = new Set(["Narrative faithfulness"]);

/**
 * The one detail that is the ANSWER rather than a supporting fact.
 *
 * gateNarration() publishes the deciding gate's `means` under this label — the
 * plain-words statement of what actually happened, the single line a specialist
 * opening this ticket most needs. In the old note it was the fourteenth line,
 * below a 403 about an API scope. It leads now.
 */
const LEAD_DETAIL = "What happened";

/**
 * Who filed it, without saying their role twice.
 *
 * Several personas carry the role inside their display name ("Jane Doe (company
 * admin)"), so the old `${name} (${kind})` printed "Jane Doe (company admin)
 * (company_admin)" — the same fact, twice, once in words and once as a slug.
 * The slug is kept where it adds something and dropped where it does not.
 */
function filedBy(persona) {
  if (!persona) return "unidentified";
  const spelled = String(persona.kind ?? "").replace(/_/g, " ").toLowerCase();
  return spelled && persona.name.toLowerCase().includes(spelled) ? persona.name : `${persona.name} (${persona.kind})`;
}

/** HTML-escape every interpolated value. A note carries text a person typed. */
function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** A table of label/value rows, or "" when there is nothing to put in it. */
function factTable(rows) {
  const kept = rows.filter((row) => row && row.value !== null && row.value !== undefined && row.value !== "");
  if (!kept.length) return "";
  const body = kept
    .map(
      (row) =>
        `<tr><th style="text-align:left;vertical-align:top;padding:4px 12px 4px 0;white-space:nowrap;">${esc(row.label)}</th>` +
        `<td style="vertical-align:top;padding:4px 0;">${esc(row.value)}</td></tr>`
    )
    .join("");
  return `<table><tbody>${body}</tbody></table>`;
}

/**
 * The internal note the ticket opens with.
 *
 * THIS IS THE ACTUAL ARGUMENT OF THE HAND-OFF. A specialist should open the
 * ticket already holding the analysis — what was decided, why, which gates
 * flagged, the record id to look it up by, and the drafted summary or dossier
 * where the use case produced one — rather than the raw request and an
 * invitation to redo the work the automation just did. A ticket that only says
 * "please look at this" is a queue entry; a ticket carrying the analysis is a
 * hand-off.
 *
 * WHY IT IS HTML NOW. It used to be a wall of plain text with ASCII rules
 * (`--- routing ---`) standing in for headings, and the project owner asked:
 * "why is it always ugly, not well formatted and look that way, is that all
 * zendesk looks like, or you just used the bare minimum". It was the bare
 * minimum. A Zendesk internal note accepts HTML — CLAUDE.md §4 records exactly
 * this, alongside the expensive lesson that a PUBLIC reply does NOT and silently
 * escapes it — so the note is composed as headings, paragraphs and tables.
 * Confirmed against the live account rather than assumed: h2/h3, p, strong, em,
 * ul/li, table/tbody/tr/th/td, hr and inline `style` all survive Zendesk's
 * sanitiser; `class` does not, which is why every rule here is inline.
 *
 * ORDER IS THE ARGUMENT. What was decided, what it means and what the reader
 * must do come first, on the first screen. The machinery — routing tags, which
 * Zendesk group this landed in and why it might not have, and this system's own
 * quality telemetry — is real, is kept, and sits at the bottom under its own
 * heading, because the reader of this note is a specialist and not an operator.
 * The 403 about `GET /api/v2/groups` used to be the THIRD LINE of the note.
 *
 * EVERY INTERPOLATED VALUE IS ESCAPED. Notes carry text people typed — a
 * requester's free-text reason, an approver's note — and this is the one surface
 * in the project that composes markup rather than setting textContent.
 *
 * Everything in it came out of the real workflow. This function formats; it
 * decides nothing, and every value it prints was already recorded and audited
 * before the ticket existed.
 */
function buildTicketNote({ type, outcome, decision, recordId, persona, assignment }) {
  const env = outcome.envelope;
  const details = env.details ?? [];
  const lead = details.find((d) => d.label === LEAD_DETAIL) ?? null;
  const forSpecialist = details.filter((d) => d !== lead && !OPS_ONLY_DETAILS.has(d.label));
  const forOperators = details.filter((d) => OPS_ONLY_DETAILS.has(d.label));

  const handOff =
    assignment.escalated === null
      ? null
      : assignment.escalated
        ? "<p><strong>Escalation.</strong> The automation stopped here and could not finish.</p>"
        : "<p><strong>Routine review.</strong> This is the human gate working, not an escalation.</p>";

  const parts = [
    `<h2>${esc(type.label)} — a person has to decide</h2>`,
    handOff,
    `<p><strong>What a human controls here.</strong> ${esc(type.humanControl)}</p>`,
    lead ? `<h3>What happened</h3><p>${esc(lead.value)}</p>` : null,
    "<h3>The decision so far</h3>",
    factTable([
      { label: "Decision", value: decision },
      { label: "Reason", value: env.reason ?? "—" },
      { label: "Flags", value: (env.flags ?? []).length ? env.flags.join(", ") : "none" },
      { label: type.recordLabel, value: recordId ?? "—" },
      { label: "Filed by", value: filedBy(persona) },
      { label: "Owning team", value: assignment.intendedGroup ?? "none defined" },
      { label: "Priority", value: assignment.priority },
      { label: "Due", value: assignment.dueAt ?? "no deadline was produced by this decision" },
      { label: "Urgency", value: assignment.urgencyReason ?? "" },
    ]),
    forSpecialist.length ? "<h3>What the checks reported</h3>" : null,
    forSpecialist.length ? factTable(forSpecialist) : null,
    "<hr>",
    '<h3 style="color:#68737d;">For operators</h3>',
    '<p style="color:#68737d;">Raised by the Remote request portal AFTER the real gates ran. The decision above was ' +
      "already recorded and audited before this ticket existed.</p>",
    factTable([
      { label: "Use case", value: type.useCase },
      {
        label: "Assignment",
        value: assignment.assigned
          ? `assigned to Zendesk group ${assignment.groupId}` +
            (assignment.assignedFrom === "synced"
              ? // rca-ynsb: dropped the `npm run sync-groups` command — this
                // note's reader is the specialist working the ticket, who has
                // no repo and no terminal. Same candour (cached, not live;
                // can be stale), routed to who they'd ask instead of what
                // they'd run.
                " — from a locally cached list of group ids, because the account could not be read live just now. That cache can go stale; if this looks wrong, flag it to the team that maintains this account's Zendesk groups."
              : assignment.assignedFrom === "live"
                ? " — read live from the account."
                : "")
          : // The requester-facing sentence never carries a path or this
            // project's own use-case code (rca-ee04's split); this note's
            // reader is a specialist, so the routed candour — what is broken
            // and who to tell (rca-ynsb: not a repo path or a script to run,
            // which this reader could not use) — is appended rather than
            // lost.
            `NOT assigned — ${assignment.skippedReason}${assignment.operatorRemedy ? ` ${assignment.operatorRemedy}` : ""}`,
      },
      { label: "Routing tags", value: assignment.routingTags?.length ? assignment.routingTags.join(", ") : "none" },
      ...forOperators.map((d) => ({ label: d.label, value: d.value })),
    ]),
  ];
  return parts.filter((part) => part !== null && part !== "").join("\n");
}

/**
 * The real deadline this decision produced, if it produced one.
 *
 * ONLY UC-06 HAS ONE, and it is a genuine clock rather than an invented SLA:
 * the payroll cutoff lock is a time the platform enforces, computed by the
 * cutoff engine from the payroll calendar, and UC-06.md §9 already names it as
 * the urgency trigger ("within 48h of cutoff → urgent escalation to Payroll
 * Ops"). Every other use case returns null and keeps its table priority,
 * because a due date this system cannot honour is a promise it should not make.
 *
 * Read out of the decision's own details rather than recomputed — recomputing
 * would put a second cutoff calculation in the portal, which is exactly the
 * "the gates exist twice" defect CLAUDE.md §6 records.
 */
function deadlineFrom(outcome) {
  const cutoff = (outcome.envelope.details ?? []).find((d) => /cutoff lock/i.test(d.label ?? ""));
  if (!cutoff || !cutoff.value) return null;
  const parsed = Date.parse(cutoff.value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

/**
 * A requester address for the ticket. Personas carry no email of their own —
 * they are keyed by a real Sandbox employment id and the mock holds the record
 * — so this derives a demo address rather than inventing a plausible one. A
 * ticket in a real account must never carry an address that could belong to a
 * real person.
 *
 * `example.com`, NOT `.invalid`, AND THE DIFFERENCE COST A WHOLE FEATURE.
 * RFC 2606 reserves both, and `.invalid` is the more emphatic of the two — a
 * TLD guaranteed never to resolve. Zendesk rejects it: `POST /api/v2/tickets`
 * answers `422 RecordInvalid`, "Requester: Email: chris@portal.invalid is not a
 * valid address". So EVERY portal decision that needed a human failed to raise
 * its ticket, on a run where the decision itself was correct and durably
 * recorded. The failure was reported honestly on the page and in `audit_log`
 * (`portal_ticket_creation_failed`) and still looked, from Zendesk, exactly
 * like the hand-off not being built — a tester checked the account and found
 * nothing there.
 *
 * `example.com` is reserved by the same RFC for exactly this purpose, is
 * IANA-controlled, accepts no mail, and passes Zendesk's validator. Confirmed
 * against the live account 2026-08-19: `.invalid` 422s and `example.com`
 * creates the ticket. Do not "tidy" this back to a more obviously fake domain
 * without creating a ticket to prove the account still accepts it.
 */
function personaEmail(persona) {
  return `${persona.id}@example.com`;
}

/**
 * The employment a persona key IS, resolved through the server-owned map —
 * never a value out of the request body. Null for an unknown key and for the
 * admin persona, who is not an employment. Used only by the two dossier
 * adapters, which take no persona of their own; see their comments.
 */
function subjectEmploymentId(personaKey) {
  return resolvePersona(personaKey)?.employmentId ?? null;
}

// ---------------------------------------------------------------------------
// The seven adapters
// ---------------------------------------------------------------------------
// Each one does exactly three things: resolve the server-owned session, shape
// the form fields into the ticket object its workflow documents, and shape the
// workflow's return value into the common envelope. No adapter contains a
// gate, a threshold, a decision string it invented, or a branch on a decision.
// ---------------------------------------------------------------------------

function buildAdapters({ remote, audit, stores, llm }) {
  return {
    // --- UC-01 (🟢) — L-14, the self-service letter -----------------------
    // See src/uc01/selfServiceLetter.js's header for why this is a
    // deliberately separate, simpler path from the ticket-driven workflow.
    async uc01(body) {
      const persona = resolvePersona(body.persona);
      if (!persona) return unauthenticated();
      if (persona.kind !== "employee") {
        return refusal(403, "persona_cannot_self_serve", "This letter is issued to the employee it is about, not an admin.");
      }
      const result = await issueSelfServiceLetter(
        { employmentId: persona.employmentId, session: persona.session, externalRef: body.externalRef || null },
        { remote, audit, caseStore: stores.uc01 }
      );
      if (!result.ok) return refusal(result.status, result.code, result.reason);

      // rca-etp9 (round-7 R7-03): the free-text box the card was missing.
      // Carried, never decided on — `issueSelfServiceLetter()` above has
      // already run every gate and rendered the letter without it, matching
      // its own header ("the only free-text field ... plays no part in
      // whether the letter issues"). Stored as its own document (not folded
      // into the letter) so it never touches the rendered document a bank or
      // landlord receives. Skipped on a joined duplicate (`result.duplicate`)
      // — `result.caseId` there belongs to the FIRST issuance, and attaching
      // a later call's own words to someone else's case would misattribute
      // them.
      const note = typeof body.note === "string" ? body.note.trim() : "";
      if (note && !result.duplicate && result.caseId && typeof stores.uc01?.createDocument === "function") {
        stores.uc01.createDocument({ caseId: result.caseId, type: "employee_note", content: note });
      }

      // LANGUAGE — Remote's own and only field on this form (support.remote.com
      // article 4422684040461, fetched live 2026-08-28: "Choose the language you
      // want and click on Create and download").
      //
      // Carried exactly like `note` above and for the same reason: it is intake,
      // not a gate. `issueSelfServiceLetter()` has already run every gate and
      // rendered the letter before this line, so nothing here can change whether
      // the letter issues — which is what keeps this an honest addition rather
      // than a second decision path.
      //
      // WHY A NON-ENGLISH CHOICE IS RECORDED AND SAID BACK, and never silently
      // dropped. src/uc01/letter.js has ONE template. A picker offering twenty
      // languages and answering all of them in English is a fake control, and
      // this repository has already paid for one of those (the "Response Data"
      // dropdown that asked a different question under a different mode). The
      // ladder's rule applies unchanged: a substituted fact must self-identify.
      // So the chosen language rides on the response as a row the requester
      // reads, and a non-English choice adds a document the specialist reads.
      const language = typeof body.language === "string" ? body.language.trim() : "";
      const englishRequested = language === "" || language === "en";
      if (!englishRequested && !result.duplicate && result.caseId && typeof stores.uc01?.createDocument === "function") {
        stores.uc01.createDocument({
          caseId: result.caseId,
          type: "letter_language_request",
          content: language,
        });
      }

      return ok({
        decision: "auto_resolve",
        reason: "self_service_all_gates_passed",
        flags: [],
        recordId: result.caseId,
        letterHtml: result.letterHtml,
        // D-26: `issueSelfServiceLetter()` may have JOINED an issuance already
        // claimed in the last hour rather than creating a new one — see its
        // own header. `recordedRef` is the existing mechanism for "the
        // reference this was actually filed under differs from what was
        // submitted" (recordReferenceSubstitution() above); set explicitly
        // here because the default (falling back to `submittedRef`) would
        // otherwise hand the caller back a reference — or `null` — that
        // resolves to nothing. `...selfServiceLetterDeliveryFields(result)`
        // spreads the SAME `alreadyHandled`/`duplicateExplanation` vocabulary
        // the other six adapters already spread in below (this was the one
        // adapter that never could, because `issueSelfServiceLetter()` had
        // nothing to report `duplicate: true` from until now) — render()
        // already knows how to show it, so the requester is told this joined
        // a request already in flight rather than the page silently
        // reprinting the same letter with no explanation. It is its OWN
        // function, not the shared `deliveryFields()`, because that one's
        // wording (an exact reference, a permanent key) is wrong for this
        // surface's hourly, no-reference join — see its own comment.
        recordedRef: result.externalRef,
        ...selfServiceLetterDeliveryFields(result),
        // ROUND-6 D-01. `letterHtml` above was the whole answer to "did the
        // employee get their letter" and the browser never read it — this is
        // the SAME shape UC-03's `letter` field already gives the result
        // panel (offersOn() -> letterCollection() in assets/app.js), read back
        // from the durable case rather than from `result.letterHtml` for the
        // same reason UC-03's does: whether THIS reader may have it is a
        // question src/uc01/letterDelivery.js answers, not a variable in this
        // function.
        letter: await letterOnUc01Case({ caseStore: stores.uc01, caseId: result.caseId, session: persona.session }),
        details: [
          specialistDetail("Employment", persona.employmentId),
          // BOTH AUDIENCES, deliberately — see specialistDetail()'s own rule
          // just above: a statement of a LIMIT never goes specialist-only,
          // because a requester acting on a false completeness is worse off
          // than one reading an extra line. "You asked for Dutch and this is
          // English" is exactly that kind of line.
          ...(englishRequested
            ? []
            : [detail("Letter language", `${language} requested — the letter below is English`)]),
        ],
      });
    },

    // --- UC-02 (🟢) ------------------------------------------------------
    // The expense is identified by an expense id that must already exist in
    // Remote: the portal submits an expense FOR VALIDATION, it does not invent
    // the money. Every figure the gates check (total, line items, currency,
    // conversion, VAT) is read from the Remote record by the workflow itself,
    // never from this form — which is why the form has no amount field.
    async uc02(body) {
      const persona = resolvePersona(body.persona);
      if (!persona) return unauthenticated();
      if (persona.kind !== "employee") {
        return refusal(403, "persona_cannot_claim", "An expense is filed by the employee it belongs to, not by an admin.");
      }
      if (!body.expenseId) return refusal(400, "expense_required", "Pick the expense to validate.");

      const result = await handleExpenseSubmission(
        {
          expenseId: body.expenseId,
          employmentId: persona.employmentId,
          session: persona.session,
          // Optional: no hash means the duplicate gate does not run at all
          // (workflow.js). The page says so, rather than sending a fabricated
          // hash that would make every second demo submission look duplicate.
          receiptHash: body.receiptHash || null,
          externalRef: body.externalRef || null,
          source: PORTAL_SOURCE,
        },
        { remote, audit, expenseStore: stores.uc02, ...pick(llm, { classifyExpense: "classify" }) }
      );

      // WHICH GATE DECIDED, computed server-side from the policy engine's own
      // ordering (describeDecidingGate) and rendered by the page. The reason
      // this is not left to the browser is finding-shaped: a tester saw
      // `escalate / expense_employment_mismatch` printed beside "Classifier
      // confidence 0.9" and asked why we escalate at 0.9 confidence. We do not
      // — ownership is gate 4, confidence is gate 13, first failure wins, and
      // that run never reached gate 13. Presenting both with no relationship
      // shown made the confidence look causal. The confidence is still shown
      // (hiding an input is its own dishonesty); it is now LABELLED with what
      // it describes and whether anything consulted it.
      const gate = describeDecidingGate(result.reason);
      return ok({
        decision: result.decision,
        reason: result.reason,
        flags: result.flags,
        recordId: result.storeId,
        ...deliveryFields(result),
        decidedBy: gate,
        // THE WHOLE LADDER, not only the rung that decided. "Decided by gate 15"
        // is a citation to an order nobody outside this file could see, and a
        // tester asked outright what gates 1 to 14 were. Sent as data so the
        // page prints the sequence rather than learning it — the same rule
        // `decidedBy` already follows one line above.
        gateLadder: describeGateLadder(result.reason),
        details: [
          // THE EXPENSE RECORD'S ID IN REMOTE. The Finance Ops reviewer opens
          // the claim by it; the employee chose it from a picker that shows
          // what it is, filed one, and is told at the top of the panel what
          // happened to "your expense claim". An id is not how they think of it.
          specialistDetail("Expense", result.expenseId),
          // WHAT HAPPENED, before WHICH GATE SAID IT. This row used to carry
          // only the gate and its `checks` string — and `checks` is phrased as
          // the PASSING condition, so a refusal read "Decided by: gate 12 —
          // Policy cap (the converted amount is within the category cap)" on a
          // expense that was over the cap. True, and it says the opposite of
          // what happened unless the reader inverts it themselves. It reaches
          // further than the page, too: `details` is what buildTicketNote()
          // writes into the Zendesk internal note, so a specialist opening the
          // ticket read the passing condition as well.
          detail("What happened", gate.means || result.reason),
          // THE COORDINATES ARE THE SPECIALIST'S — see gateNarration(), which
          // makes the same split for the other four use cases that publish a
          // ladder. The employee has the plain-words sentence one row above.
          specialistDetail(
            "Decided by",
            gate.position === null
              ? gate.gate
              : `gate ${gate.position} of ${gate.ladderLength ?? "the sequence"} — ${gate.gate}, which checks that ${gate.checks}`
          ),
          // REMOTE'S OWN CATEGORY IDENTIFIER, and it is an identifier:
          // `work_meals_and_entertainment.external_meals_and_entertainment`.
          // The Finance Ops specialist checking the claim against the policy
          // needs the exact key; the employee who filed a lunch receipt does
          // not, and the figure that decided their claim is on the cap
          // comparison row in money rather than in a key.
          specialistDetail("Category", result.categoryId ?? "not classified"),
          specialistDetail("Category decided by", result.categorySource),
          // THE NUMBERS BEHIND A CAP REFUSAL, when the decision was one. A
          // tester read "above the policy cap" on a Zendesk note and had to
          // ask what the amount, the cap and the overage were — every one of
          // which gate 12 held at the instant it refused. `result.capComparison`
          // is computed once in the workflow from the same figures the gate
          // compared, already formatted through src/shared/money.js (these are
          // ×100 integers; rendering one raw is a 100× error in front of
          // somebody authorising a payment) and already carrying its currency.
          // Nothing is re-derived here, and the row is simply absent for every
          // non-cap decision — this list is spread into the ticket note too, so
          // an empty row would be a blank line in a specialist's inbox.
          ...(result.capComparison
            ? [detail("Cap comparison", result.capComparison.sentence)]
            : []),
          specialistDetail(
            // Labelled with WHAT it is about and WHETHER it mattered. The bare
            // "Classifier confidence" was true and misleading.
            //
            // AND IT IS A SPECIALIST'S ROW. A number between 0 and 1 describing
            // how sure a classifier was, qualified by which gate did or did not
            // consult it, answers a question only somebody re-examining the
            // decision asks. The employee cannot raise it, cannot appeal it and
            // cannot tell from it whether they will be paid.
            "Classifier confidence in the CATEGORY",
            result.confidence === null || result.confidence === undefined
              ? "not classified"
              : `${result.confidence}${gate.confidenceConsulted ? " — consulted by gate 13" : " — NOT consulted; this run stopped earlier"}`
          ),
          // The tier this repository's own architecture recorded against the
          // decision. Real, audited, and a fact about our design rather than
          // about their claim.
          specialistDetail("Risk tier recorded", result.tier),
        ],
      });
    },

    // --- UC-03 (🟢) ------------------------------------------------------
    // Free text in, a routing decision out. The only LLM step in UC-03 is the
    // classifier, and it can never do more than describe the request.
    async uc03(body) {
      const persona = resolvePersona(body.persona);
      if (!persona) return unauthenticated();
      if (persona.kind !== "employee") {
        return refusal(403, "persona_cannot_ask", "A travel inquiry is filed by the travelling employee.");
      }
      if (!textOf(body.text)) return refusal(400, "text_required", "Describe the trip.");

      const result = await handleTravelInquiry(
        {
          text: body.text,
          employmentId: persona.employmentId,
          session: persona.session,
          externalRef: body.externalRef || null,
          source: PORTAL_SOURCE,
          // THE TRIP AS THE TRAVELLER STATED IT — four optional values from the
          // boxes beside the text box, normalised by statedTrip() and passed
          // through untouched. This adapter forms no opinion about them: it
          // does not check that the destination is a country the risk matrix
          // knows, does not compare the dates, and does not require any of
          // them. A ticket whose four members are all null is the ticket this
          // adapter sent before the boxes existed, so nothing that is decided
          // today can be decided differently by their absence.
          stated: buildStatedTrip(body.stated),
        },
        // No `zendesk` IN THE ADAPTER, and that is still deliberate even now
        // that the portal has a Zendesk client. UC-03's workflow posts a REPLY
        // to a ticket when given a client and `source === "zendesk"` — that is
        // the automation answering a customer on a ticket it was triggered by,
        // which is not what is happening here. The portal's own hand-off runs
        // AFTER this workflow returns and only ever CREATES a ticket from the
        // decision; it never lets a workflow reply on the portal's behalf.
        { remote, audit, caseStore: stores.uc03, ...pick(llm, { classifyTravel: "classify" }) }
      );

      // WHAT THE PANEL SAYS ABOUT THE CLASSIFIER, AND WHY IT NOW SAYS ANYTHING.
      // Every gate in UC-03's router below the identity/status pair is decided
      // ON the classification: `intent` picks the UC-04 route, `confidence`
      // gates the whole router, `destinationCountry` feeds three gates and the
      // day-count feeds two more. The panel named none of it, so a reader
      // seeing `route_to_uc04 / work_authorization_requested` had nothing to
      // tell them WHO read the request that way. Driven with OpenAI
      // unreachable, all four quick-fills came back `rule_based_fallback` and
      // the page was silent about it — a demo viewer would reasonably assume
      // the configured model had classified them. This is UC-02's existing
      // "Category decided by" discipline, applied to the use case where the
      // classifier decides considerably more.
      const c = result.classification ?? {};
      // ONE WORDING, TWO PLACES. `row` goes in the facts table (and from there
      // into the Zendesk internal note); `sentence` goes in the pop-up, which
      // is the only part of this page a requester is guaranteed to read. See
      // describeReader() for why the old wording could not serve either reader.
      const reader = describeReader(c.source);
      // The confidence gate is gate 3 and returns immediately, so it is
      // consulted on every run that got past identity and employment status —
      // unlike UC-02's, which most runs never reach. Say what it did rather
      // than printing a bare number beside an unrelated verdict.
      const confidenceNote =
        typeof c.confidence === "number"
          ? `${c.confidence} — the router refuses to act on an intent below ${UC03_CONFIDENCE_FLOOR}`
          : "not scored — treated as too low to act on";
      // The slug in plain words, from UC-03's own GATE_SEQUENCE. See
      // gateNarration() - the sentence existed the whole time and this adapter
      // printed the identifier.
      const g03 = gateNarration(uc03Gates, result.reason);

      // --- THE CONTINUATION OFFER, and what it is NOT --------------------
      //
      // This is descriptive, not an action. It says "a next step exists, here
      // is what would carry across and what you would still have to supply" —
      // and it is computed from the handoff event and intake report the
      // workflow ALREADY returned, after a decision that has already been
      // made. It cannot change one. The employee's actual act of intent is a
      // separate authenticated POST to /api/requests/uc03/continue, below.
      //
      // `available` is false for every decision that is not a routing, because
      // `handoffEvent` is null for every one of them — so the control cannot
      // appear on an auto-resolved answer or an escalation, and that follows
      // from UC-03's own output rather than from a decision string compared
      // here. (`describeContinuation` returns the same shape either way, so
      // the page has one thing to read and no branch to forget.)
      //
      // THE REFERENCE IS DELIBERATELY BLANKED ON THIS PREVIEW. A
      // `route_to_uc04` raises a Zendesk ticket AFTER this adapter returns
      // (./ticketing.js, then `store.linkTicket()`), and that call REPLACES the
      // case row's `externalRef` with the ticket id. So any reference computed
      // here is superseded moments later, and printing it would hand the
      // requester a string that names nothing. The continue route re-derives it
      // from the durable row, where it is correct — and the answer there is
      // usually the ticket id, which is the best possible outcome: the travel
      // decision, the work-authorization decision, the ZAF sidebar's by-ticket
      // lookup and the audit viewer's reference trace then all key on one string.
      const continuation = {
        ...describeContinuation({
          handoffEvent: result.handoffEvent ?? null,
          intake: result.uc04Intake ?? null,
          caseRow: { id: result.caseId, externalRef: body.externalRef || null },
          ticketText: body.text,
        }),
        externalRef: null,
      };

      // --- THE DOCUMENT, AND WHERE THE PERSON IT IS ABOUT COLLECTS IT ------
      //
      // "A travel letter was requested. It should be recorded, and the user
      // should be able to download the letter. The question now is: from
      // where?" — the project owner. The answer used to be "their own history
      // page, if they think to go and look", and the result that ISSUED the
      // letter said nothing about it at all: the panel's one letter row said
      // the document was waiting for a signature, which on this outcome is
      // false.
      //
      // Read back from the durable case rather than from `result.letterHtml`,
      // because whether this reader may HAVE it is a question about the case
      // and the session, not about a variable in this function — and
      // src/uc03/letterDelivery.js is the only thing that answers it. A `null`
      // here means the read failed or the case is not this reader's, and the
      // panel then shows no control, which is the safe direction.
      const letter = await letterOnCase({
        caseStore: stores.uc03,
        caseId: result.caseId,
        session: persona.session,
      });

      return ok({
        decision: result.decision,
        reason: result.reason,
        flags: result.flags,
        recordId: result.caseId,
        // Null whenever the reading was normal — see describeReader(). The
        // requester is only told about the reading when there is something for
        // them to DO about it.
        readBy: reader.sentence,
        // THE LETTER: which of the three states it is in, in the server's
        // words, and — only when this reader may actually have it — the route
        // to collect it. `collect` is src/uc03/letterDelivery.js's verdict,
        // not a decision made here, so the page cannot offer a button the
        // fetch route would refuse.
        letter,
        // THE COUNTRY THIS TRIP IS ABOUT — A CODE, and the code the gates
        // compared. `subjectCountryOf()` reads it and ./plainAnswer.js names it
        // once, at the point of rendering; nothing downstream compares, stores
        // or posts this field, and putting a NAME here would be the alpha-3
        // defect one alphabet over (src/shared/countryNames.js's own header).
        //
        // WHY THE CLASSIFICATION AND NOT THE LETTER OFFER OR THE HAND-OFF.
        // Those two carry the same code and are the only structured places
        // UC-03 used to expose it — but an offer exists only on an answered
        // trip and a hand-off only on a routing, so an ESCALATION exposed
        // nothing and its summary named no place at all. This is the one value
        // present on every path a decision is reached on, and it is the value
        // the destination gates read: `null` here means the router genuinely
        // could not place the trip, which is a fact worth carrying rather than
        // a hole to be filled from somewhere else.
        subjectCountry: c.destinationCountry ?? null,
        continuation,
        // --- THE LETTER THIS ANSWER IS ALLOWED TO BECOME -------------------
        //
        // Computed by src/uc03/letterOffer.js and returned by the workflow on
        // every auto-resolved answer; `null` on every other outcome, and
        // `{offered:false, reason}` when the case is auto-resolved but the
        // offer cannot be taken. Passed through whole, because the panel prints
        // the server's sentences and decides nothing.
        //
        // WHY IT WAS INVISIBLE UNTIL NOW, and it is worth naming because it is
        // this repository's most persistent defect: the mechanism was built,
        // tested and proven end to end — answer → accept → drafted → signed →
        // issued — and not one surface rendered it. An employee who asked "is
        // this trip fine?" was told yes and shown nothing about the document
        // they would need at the visa appointment. Work that is complete,
        // correct and reachable by nobody is indistinguishable, from where they
        // stand, from work that was never done.
        //
        // `accept` IS REPLACED, ON PURPOSE. describeLetterOffer() answers with
        // UC-03's own API path (`/api/cases/:id/request-letter` on :4051),
        // which is the truthful answer for the surface that asked it — and it
        // is not this one. The portal accepts on its own authenticated route
        // below, where the traveller's session is the server's answer from
        // ./personas.js rather than anything the browser could name. Rewriting
        // it here keeps the page reading one field it was given instead of
        // assembling a URL of its own.
        letterOffer: result.letterOffer
          ? {
              ...result.letterOffer,
              accept: { method: "POST", path: "api/requests/uc03/request-letter" },
              // THE DESTINATION IN THE READER'S WORDS, beside the code and never
              // instead of it. `carries.destinationCountry` is `ES` — the exact
              // string the gates compared, the audit row records and the country
              // picker on this very page sends, so it stays. But the person
              // being asked to confirm a trip before it is certified to a
              // consulate should not have to know that `ES` is Spain, and the
              // name is a lookup this file already holds for its own picker.
              // Presentation only: nothing downstream reads it, and a code with
              // no row simply yields null and renders the code alone.
              carries: result.letterOffer.carries
                ? { ...result.letterOffer.carries, destinationName: countryName(result.letterOffer.carries.destinationCountry) }
                : result.letterOffer.carries,
            }
          : null,
        ...deliveryFields(result),
        ...g03.fields,
        details: [
          ...g03.details,
          // `uc04_work_authorization` — the name of the route inside this
          // system. The requester is told, in a sentence at the top of the
          // panel, that their question was read as working from the destination
          // rather than travelling to it and that this is a different request;
          // the routing key is what the specialist picking it up matches on.
          specialistDetail("Routed to", result.route ?? "handled in UC-03"),
          // THE SAME COUNTRY THE SUMMARY ABOVE THIS TABLE NAMES. It printed
          // `ES` while the sentence four rows up said "Spain" — one fact in two
          // vocabularies, a few hundred pixels apart, and this table is also
          // what buildTicketNote() writes into the Zendesk note, so the
          // specialist read the code too.
          //
          // `countryLabel()` AND NOT `countryNameAndCode()`: this row is a
          // finding a reader weighs, not a reference anybody repeats into
          // another system — the letter offer below is that, and it keeps its
          // code. And a value that is not code-shaped comes back untouched, so
          // a classifier that ever answered "ESP" or "Spain" stays visibly
          // wrong here instead of being dressed up as a rendered name.
          detail(
            "Destination read from the request",
            countryLabel(c.destinationCountry, "none stated — the router cannot place this trip")
          ),
          // THE ROW THE OWNER NAMED, AND WHY IT IS ROUTED RATHER THAN DELETED.
          // "An AI language model read your request in your own words" is true
          // and useless to the person who wrote those words: they cannot act on
          // it, and the trip details it produced are printed two rows below
          // either way. It is exactly what the specialist needs, though —
          // whether a model or the keyword fallback placed the destination, and
          // how sure it was, is the first thing anybody re-reading the case
          // wants. describeReader() already carries the other half of this
          // split: `sentence` is null for a normal reading and becomes advice
          // the requester CAN act on ("check the trip details below") only when
          // the fallback ran.
          specialistDetail("Request read by", reader.row),
          specialistDetail("Confidence in that reading", confidenceNote),
          // "1 days" was printed for a single-day trip. Small, and it is on
          // the customer-facing panel.
          detail("Trip length", result.durationDays == null ? "not determined" : `${result.durationDays} day${result.durationDays === 1 ? "" : "s"}`),
          // THE LETTER, IN THE STATE IT IS ACTUALLY IN. This row read
          // `letterHtml ? "yes — held for specialist sign-off" : "no"` and was
          // stale on the outcome that matters most: since the standard letter
          // began issuing itself, a letter can be WRITTEN AND HANDED OVER with
          // nobody in the path — and this row told the person holding it that
          // it was waiting on a signature. Three states, and the words are
          // src/uc03/letterDelivery.js's own (see letterOnCase()), so the row,
          // the requester's history page and the collect route cannot disagree.
          detail("Formal travel letter", letter ? letter.detail : "Could not be read on this request."),
          detail("Informational answer", result.informationalAnswer ?? "none — this request did not auto-resolve"),
          // THE HANDOFF'S CONTENTS, not just its name. This printed
          // `CROSS_BORDER_WORK_REQUESTED` and stopped — and that string is
          // also all that reached the Zendesk ticket the portal raises, since
          // the ticket body renders these very details. So the mobility
          // specialist who has to open a UC-04 case from a UC-03 routing was
          // handed an event type and no event: no destination, no origin, no
          // dates. The payload was recorded in `audit_log.details.handoffEvent`
          // the whole time, which is the wrong place to make somebody look.
          //
          // ITS TWO COUNTRIES ARE NAMED FOR THE SAME REASON THE ROW ABOVE IS.
          // This printed `US → PT` four rows under a row that had just been
          // taught to say "Portugal", which is the two-vocabularies defect
          // recreated inside one table. The EVENT still carries the codes —
          // `result.handoffEvent` is untouched, it is what the continuation
          // prefill and the audit row are built from, and this line reads it
          // without changing it.
          // THE HAND-OFF PAYLOAD IS THE HAND-OFF'S READER'S. It carries an
          // event-type constant and a raw employment id, and the employee has
          // already been shown the same trip in the continuation offer — which
          // is the control that lets them act on it, and which names what would
          // carry across in their own words. This row is what the mobility
          // specialist opening the ticket reads instead of an event name with
          // no event, which is what it used to be.
          specialistDetail(
            "Handoff to UC-04",
            result.handoffEvent
              ? `${result.handoffEvent.event_type} — ${countryLabel(result.handoffEvent.origin_country, "unknown origin")} → ` +
                `${countryLabel(result.handoffEvent.destination_country, "unknown destination")}, ` +
                `${result.handoffEvent.start_date ?? "no start date stated"} to ${result.handoffEvent.end_date ?? "no end date stated"}, ` +
                `employment ${result.handoffEvent.employee_id ?? "unknown"}`
              : "none"
          ),
        ],
      });
    },

    // --- UC-04 (🟡) ------------------------------------------------------
    // The form's fields ARE the risk matrix's inputs — including, since
    // 2026-08-19, `travelHistory`. It used to be hard-coded `[]`, which made
    // both of UC-04's day thresholds (Schengen 90/180 and the 183/365
    // tax-residency watch) unreachable from this page for every request ever
    // filed through it. See buildTravelHistory()'s header for why "the portal
    // has no source of prior trips" was true and still the wrong conclusion,
    // and for the calculator defect the refusal below exists to stay clear of.
    //
    // THE FIELD IS OPTIONAL AND ITS ABSENCE IS UNCHANGED BEHAVIOUR. A body with
    // no `travelHistory` key produces `[]`, exactly as before, and the result
    // panel keeps saying that 0 over 0 trips is a floor rather than a count.
    async uc04(body) {
      const persona = resolvePersona(body.persona);
      if (!persona) return unauthenticated();
      if (persona.kind !== "company_admin") {
        return refusal(403, "persona_cannot_request", "A workation request is filed by the company admin on the employee's behalf.");
      }
      if (!body.employmentId) return refusal(400, "employment_required", "Pick the travelling employee.");
      if (!body.destinationCountry) return refusal(400, "destination_required", "Pick a destination country.");

      // PRIOR STAYS, READ BEFORE ANYTHING ELSE RUNS. Refused rather than
      // trimmed: UC-04's day counter answers NaN for a stay it cannot read, and
      // NaN loses every threshold comparison silently, so a history with one
      // bad row would clear a traveller the same history would otherwise block.
      // The row is named, so the requester can fix the one that is wrong.
      //
      // ASSET NOTE (the input this reads does not exist on the page yet).
      // src/portal/assets/ was owned by another change in flight when this
      // landed, so the form has no travel-history rows and `body.travelHistory`
      // is absent for every browser submission — this is a no-op until the
      // input lands, and every existing scenario behaves exactly as before.
      // The API accepts the field now, and `npm run uc04-api`'s seeds 4004-4006
      // and scripts/demo-countries-matrix.mjs's UC04-CANL-3/4, UC04-CACA-1/2
      // and UC04-USPT-2 exercise it end to end in the meantime.
      //
      // What the page has to send is an array of `{country, startDate, endDate}`.
      // The convention to copy is UC-08's presence periods, which are the same
      // shape one use case over: two `.period-row` blocks of
      // `id="uc04-h1-country" / "uc04-h1-startDate" / "uc04-h1-endDate"` (and
      // `h2`), read in BUILDERS.uc04 as
      //   travelHistory: [
      //     { country: value("uc04-h1-country"), startDate: value("uc04-h1-startDate"), endDate: value("uc04-h1-endDate") },
      //     { country: value("uc04-h2-country"), startDate: value("uc04-h2-startDate"), endDate: value("uc04-h2-endDate") },
      //   ],
      // An untouched row is dropped here, so two always-rendered blank rows are
      // safe. NOTE that index.html's existing field-note under the UC-04 form
      // ("Prior trips are sent empty…") becomes FALSE the moment those inputs
      // exist and must be replaced in the same change.
      const travel = buildTravelHistory(body.travelHistory);
      if (travel.unreadable.length > 0) {
        return refusal(
          400,
          "travel_history_unreadable",
          "A prior stay could not be read, so no day count was attempted: " +
            travel.unreadable.join("; ") +
            ". A count that is missing a stay is not a smaller count — it is not a count — and this system's day counter " +
            "would answer with a silent NaN that clears every threshold rather than refusing. Fix the stay or remove it."
        );
      }

      // --- CONTINUED FROM A UC-03 ROUTING? --------------------------------
      //
      // `continuationOf` names the UC-03 case the employee chose to continue
      // (POST /api/requests/uc03/continue, above). It is OPTIONAL and changes
      // no gate: with it or without it, the same `handleWorkationRequest()`
      // runs on the same factors. What it changes is the RECORD — the two
      // decisions end up joined instead of unrelated.
      //
      // THE CASE IS RE-READ HERE TOO, and for a second reason on top of the
      // first: this is a different actor from the one who continued. The
      // employee raises; the company admin assesses. So the only thing an
      // admin's body can do is NAME a case, and the server decides whether
      // that name refers to a real UC-03 routing about the employee this
      // assessment is about. A mismatch is refused rather than absorbed — a
      // work-authorization record pointing at somebody else's travel request
      // is worse than one pointing at nothing.
      let continuationCase = null;
      if (typeof body.continuationOf === "string" && body.continuationOf.trim()) {
        continuationCase = await stores.uc03.findById(body.continuationOf.trim());
        if (!continuationCase || continuationCase.useCase !== "UC-03" || continuationCase.decision !== "route_to_uc04") {
          return refusal(
            404,
            "continuation_not_found",
            "That travel request does not exist, is not a travel request, or was not routed to work authorization. The assessment is not filed against a request nobody can find — the link is the whole point of naming one."
          );
        }
        if (continuationCase.employmentId !== body.employmentId) {
          return refusal(
            403,
            "continuation_subject_mismatch",
            "That travel request is about a different employee than this assessment. A work-authorization record must not point at somebody else's trip."
          );
        }
      }

      // THE SHARED REFERENCE, RE-DERIVED SERVER-SIDE. The page sends this same
      // value back (it received it from the continue route), so the override is
      // a no-op in the ordinary case and a correction otherwise — the body
      // never gets to decide which UC-03 request this decision is filed beside.
      // Sharing one reference across the two use cases is safe BY DESIGN and
      // not by luck: `workflow_claims` is keyed `(use_case, external_ref)`
      // precisely because "one ticket may legitimately reach two use cases
      // (UC-03 routes on to UC-04)" (CLAUDE.md §4). See ./uc03Continuation.js.
      const externalRef = continuationCase ? continuationRef(continuationCase) : body.externalRef || null;

      const result = await handleWorkationRequest(
        {
          employmentId: body.employmentId,
          session: persona.session,
          factors: {
            homeCountry: body.homeCountry || null,
            nationality: body.nationality || null,
            destination: { country: body.destinationCountry },
            startDate: body.startDate || null,
            endDate: body.endDate || null,
            visaType: body.visaType || null,
            jobDuties: body.jobDuties || null,
            hasContractSigningAuthority: Boolean(body.hasContractSigningAuthority),
          },
          // The requester's own stated prior stays — never read from Remote,
          // never invented, and empty when they state none. See the refusal
          // above and buildTravelHistory()'s header.
          travelHistory: travel.periods,
          reasonText: body.reasonText || "",
          externalRef,
          source: PORTAL_SOURCE,
          now: body.now || undefined,
        },
        { remote, audit, authorizationStore: stores.uc04, ...pick(llm, { draftSummary: "draftSummary", judge: "judge" }) }
      );

      // --- THE LINK, WRITTEN WHERE IT SURVIVES ----------------------------
      //
      // Both ids in one row, so the trail reads in EITHER direction: from a
      // work-authorization record back to the travel request that started it,
      // and from a travel request forward to what the mobility desk made of it.
      //
      // WHY audit_log AND NOT A COLUMN. `uc04_authorizations` has no free-form
      // metadata column, and src/uc04/ is not this build's to change. It would
      // also be the weaker place: ./ticketing.js raises a UC-04 ticket for a
      // `ready_for_approval` and `linkTicket()` then REPLACES that record's
      // `external_ref` with the new ticket id, so a linkage living in that
      // column would be overwritten minutes later by a mechanism that knows
      // nothing about it. `audit_log` is append-only — nothing rewrites a row —
      // and it is what src/auditview/ reads.
      //
      // AFTER the workflow, so a failure to record the link can never erase a
      // decision that was genuinely made; and awaited, so the link is durable
      // before the caller is told, which is the ordering the deployment needs
      // (the platform may freeze the invocation the moment the response is
      // written).
      if (continuationCase) {
        await audit.logDurable({
          useCase: "UC-04",
          action: CONTINUATION_LINKED,
          actor: persona.session.authenticatedAdminId,
          riskTier: "medium",
          caseId: continuationCase.id,
          details: {
            externalRef,
            reason: CONTINUATION_LINKED,
            source: PORTAL_SOURCE,
            typeId: "uc04",
            uc03CaseId: continuationCase.id,
            uc04AuthorizationId: result.authorizationId ?? null,
            employmentId: body.employmentId,
            decision: result.decision,
            uc04Reason: result.reason,
            // The honest closing statement, literal rather than derived, and
            // the same one src/uc03/uc04Intake.js makes about itself: an
            // assessment now exists, and there is still no Remote request for
            // it to be transmitted to until the employee files one. UC-04's own
            // requestLink.js resolves that as `unlinked`, and this build does
            // not defeat it.
            remoteRequestCreated: false,
          },
        });
      }

      const g04 = gateNarration(uc04Gates, result.reason);
      return ok({
        decision: result.decision,
        reason: result.reason,
        flags: result.flags,
        recordId: result.authorizationId,
        // THE PLACE THIS DECISION IS ABOUT, for the plain answer at the top of
        // the panel. The code as the requester chose it on the picker — the
        // same string the risk matrix compared — named once, server-side, by
        // ./plainAnswer.js.
        subjectCountry: body.destinationCountry || null,
        // THE REFERENCE THIS DECISION IS ACTUALLY FILED UNDER, declared because
        // it is the one adapter where it can differ from the one the requester
        // was shown. A continuation is filed under the TRAVEL request's
        // reference (see the const above and ./uc03Continuation.js), which is
        // what joins the two decisions — and which left the requester holding a
        // string that named nothing until the intake route started recording
        // the substitution. Declared even when it matches, so this line is a
        // statement of fact rather than a flag that only appears when it is
        // interesting; the route writes nothing when the two agree.
        recordedRef: externalRef,
        // Echoed so the page can show the tie without re-deriving it, and so a
        // caller reading the response can follow it back. Null when this was an
        // ordinary admin-filed request, which is most of them.
        continuationOf: continuationCase
          ? { uc03CaseId: continuationCase.id, externalRef, decision: continuationCase.decision }
          : null,
        ...deliveryFields(result),
        ...g04.fields,
        details: [
          ...g04.details,
          // The matrix's own score. It is what the mobility specialist weighs
          // and it is not a fact about the trip: "high" does not tell the
          // traveller whether they are going, and "low" does not tell them they
          // are. What happened, and who has it, are both said in sentences at
          // the top of the panel.
          specialistDetail("Risk level", result.riskLevel ?? "not scored"),
          // F-32 made tripDays honest: `null` when no length was ever derived
          // (undated, unreadable or reversed dates, or gates that never ran).
          // Template-literalling that printed "null days" — technically honest,
          // and still an improvement on the "0 days" it replaced, but a reader
          // should not have to know JavaScript to parse a trip length.
          detail("Trip length", result.tripDays == null ? "not determined" : `${result.tripDays} days`),
          // computeCumulativeDays() answers {days, periodsCounted} — an OBJECT,
          // and it answers one even for an empty history (0 days over 0 trips),
          // so `?? "no travel history supplied"` would never fire and the panel
          // would print "[object Object]".
          //
          // THE "FLOOR, NOT A COUNT" SENTENCE IS NOW CONDITIONAL, and that is
          // the point of this change. It was printed unconditionally, which was
          // correct only for as long as `travelHistory` was hard-coded empty.
          // With a stated history it becomes false — the count IS a count of
          // what the requester stated — and the same words would then conceal
          // the very figure that decided the case. 0 over 0 stays a floor:
          // nobody read Remote, the requester simply stated nothing.
          detail(
            "Cumulative days abroad",
            result.cumulativeDays
              ? `${result.cumulativeDays.days} day(s) over ${result.cumulativeDays.periodsCounted} prior trip(s)` +
                (result.cumulativeDays.periodsCounted > 0
                  ? " — counted from the prior stays stated on this request, not read from Remote"
                  : " — no prior stays were stated and none were read from Remote, so this is a floor, not a count")
              : "not computed for this decision"
          ),
          // THE TWO LIMITS, EACH WITH ITS OWN MEASURED FIGURE AND ITS OWN
          // WINDOW. Empty when no prior stay was stated — a threshold row with
          // no measurement against it tells a reader a rule exists, which they
          // already knew (decisionFacts.js's own rule, applied one layer out).
          ...describeTravelWindows({
            periods: travel.periods,
            factors: { destination: { country: body.destinationCountry }, startDate: body.startDate || null },
            result,
          }),
          // "none created" was the wrong word in both halves. UC-04 CREATES no
          // Remote record — `POST /v1/work-authorization-requests` does not
          // exist (BUILD-LOG §3.66); the request is raised by the employee in
          // Remote's own Request Hub and this decision is the verdict PATCHed
          // back onto it. So the question this line answers is not "did we make
          // one?" but "which existing request is this decision attached to, and
          // did we manage to establish that?" — and the third answer, "we could
          // not tell WHICH", is the one worth printing loudest, because a
          // verdict that cannot name its request cannot be transmitted.
          // WHAT IS STILL TO BE DONE IN REMOTE, WITHOUT THE LOOKUP CODE.
          // remoteRequestLine() is the sentence — including the half that is a
          // genuine next action ("a request is raised by the employee in
          // Remote's own Request Hub"), which is why this row stays on the
          // requester's panel. The machine-readable reason for the lookup's
          // outcome follows it, for the ticket only: it is the string somebody
          // greps `audit_log` by and it is noise in front of a traveller.
          detail("Remote work-authorization request", remoteRequestLine(result)),
          ...(result.remoteRequest && !result.remoteRequest.linked && result.remoteRequest.reason
            ? [specialistDetail("Remote lookup outcome", result.remoteRequest.reason)]
            : []),
          // WHERE THIS ASSESSMENT CAME FROM, when it came from somewhere. This
          // list is also what buildTicketNote() writes into the Zendesk
          // internal note, so the specialist opening the work-authorization
          // ticket is told, in the note itself, which travel request produced
          // it and under what shared reference — instead of two tickets that
          // look unrelated. Absent entirely for an ordinary admin-filed
          // request, because an empty row is a blank line in somebody's inbox.
          ...(continuationCase
            ? [
                detail(
                  "Continued from",
                  `UC-03 travel request ${continuationCase.id} (reference ${externalRef}), continued by the travelling employee. ` +
                    "Nothing was created in Remote by that continuation: no API can raise a work-authorization request, so the " +
                    "employee still has to file it in Remote's Requests section before this verdict has anywhere to go."
                ),
              ]
            : []),
          // THE DRAFT IS WRITTEN FOR THE PERSON WHO HAS TO DECIDE. It restates
          // the request back in this system's vocabulary — travel document,
          // stated duties, the block reason — which is a briefing for the
          // specialist and, to the requester, their own form read back to them
          // with the field names showing.
          specialistDetail("Drafted summary", result.summary),
          // Telemetry: this system checking its own drafted prose against the
          // structured facts it was drafted from. OPS_ONLY_DETAILS already
          // routes it to the operators' section of the ticket; it was still
          // being printed to the employee, one reader further from anybody who
          // could use it. forRequester() drops it.
          detail("Narrative faithfulness", faithfulnessOf(result.faithfulness)),
        ],
      });
    },

    // --- UC-05 (🟡) ------------------------------------------------------
    // Both intake paths the workflow supports are exposed: an explicit
    // proposed end date (tagged `structured_input`, no LLM runs at all) or a
    // pasted letter the extractor reads a date out of. The statutory end date
    // is ALWAYS computed by the calculator — the extracted date is only ever
    // the employee's stated intent, which is exactly what the discrepancy gate
    // compares against.
    async uc05(body) {
      const persona = resolvePersona(body.persona);
      if (!persona) return unauthenticated();
      if (persona.kind !== "employee") {
        return refusal(403, "persona_cannot_resign", "A resignation is filed by the resigning employee.");
      }

      const result = await handleResignationRequest(
        {
          employmentId: persona.employmentId,
          session: persona.session,
          letterText: body.letterText || "",
          proposedEndDate: body.proposedEndDate || null,
          reason: body.reason || null,
          timeOffBalances: buildTimeOffBalances(body),
          currency: body.currency || "USD",
          externalRef: body.externalRef || null,
          source: PORTAL_SOURCE,
          now: body.now || undefined,
        },
        { remote, audit, resignationStore: stores.uc05, ...pick(llm, { extract: "extract" }) }
      );

      const notice = result.notice ?? null;
      const payout = result.payout ?? null;
      const g05 = gateNarration(uc05Gates, result.reason);
      return ok({
        decision: result.decision,
        reason: result.reason,
        flags: result.flags,
        recordId: result.resignationId,
        ...deliveryFields(result),
        ...g05.fields,
        details: [
          ...g05.details,
          detail(
            "Statutory notice",
            // NO DAY COUNT WITHOUT AN END DATE. This used to interpolate
            // `notice.noticeDays` unconditionally, and both of the calculator's
            // no-result branches set that field to 0 — so a Brazilian
            // resignation rendered "0 days (unknown) → last working day not
            // determinable". "0 days" is a quantity a reader can act on, and it
            // is the most dangerous possible reading of "we could not work this
            // out": it says the employee owes no notice at all. The 0 is still
            // in the stored record for now (it has to move in lockstep with the
            // n8n port — see noticePeriodCalculator.js), so the honest thing
            // this layer can do is refuse to show it. `noticeEndDate` is the
            // single field that says whether a notice period was actually
            // derived, so it is the thing to branch on.
            noticeLine(notice)
          ),
          detail("Rule applied", notice?.sourceCitation ?? "not calculated"),
          detail("Tenure at notice", tenureLine(notice)),
          detail("Proposed vs. statutory", discrepancyLine(notice)),
          detail("PTO payout", ptoPayoutLine(payout)),
          // WHETHER A DATE WAS TYPED IN A BOX OR READ OUT OF A PASTED LETTER —
          // `structured_input` / `rule_based_fallback`. The employee knows
          // which of the two they did, because they did it; the row exists so
          // the HR Ops signatory can tell whether the date they are confirming
          // was stated or extracted. Its slug form is the one recorded in
          // `audit_log`, which is the other reason it belongs on the ticket.
          specialistDetail("Date came from", result.extractionSource),
        ],
      });
    },

    // --- UC-07 (🔴, no execution path) -----------------------------------
    // Note what is NOT in the deps object below: no `remote`, no `zendesk`.
    // That is the whole guarantee. handleRelocationReview() has no parameter
    // through which a write-capable client could arrive, so the portal cannot
    // hand it one — not by configuration, not by a later bug in this file.
    async uc07(body) {
      if (!textOf(body.text)) return refusal(400, "text_required", "Describe the relocation.");

      const result = await handleRelocationReview(
        {
          text: body.text,
          // TIED TO ITS SUBJECT WHEN THE SESSION KNOWS ONE. A dossier is the
          // only record here whose employment id was previously read from the
          // form alone, so an employee asking about their own move produced a
          // row with `employment_id: null` — a record belonging to nobody,
          // which "My requests" then could not find under any scope. No kind
          // check and no refusal is added: anyone may ask a relocation
          // question, with or without a persona. The body still wins, because
          // an admin asking on somebody's behalf types the subject in.
          employmentId: body.employmentId || subjectEmploymentId(body.persona),
          externalRef: body.externalRef || null,
          source: PORTAL_SOURCE,
          plan: buildRelocationPlan(body),
        },
        {
          audit,
          dossierStore: stores.uc07,
          ...pick(llm, { parseRelocation: "classify", draftRelocationNarrative: "draftNarrative", judge: "judge" }),
        }
      );

      const d = result.dossier ?? {};
      return ok({
        decision: result.decision,
        reason: d.verdict ? `feasibility verdict: ${d.verdict}` : "compiled for specialist review",
        flags: (d.flags ?? []).map((f) => (typeof f === "string" ? f : f.code)),
        recordId: result.dossierId,
        // Where they are proposing to move to — the dossier's own reading of
        // the request, not the form's, because UC-07 takes free text and this
        // is the country it actually compiled against.
        subjectCountry: d.destinationCountry ?? null,
        ...deliveryFields(result),
        details: [
          detail("Feasibility verdict", d.verdict ?? "unknown"),
          // NAMED, NEVER CODED. This read `US → PT`, and a person weighing a
          // permanent relocation should not be decoding ISO 3166-1 to find out
          // where they are being told they are moving. The DOSSIER still holds
          // the codes — nothing here writes back — and `countryLabel()` passes
          // a value that is not code-shaped straight through, so a parser that
          // ever answered "USA" stays visibly wrong instead of being dressed up.
          detail(
            "Route",
            `${countryLabel(d.sourceCountry, "unknown origin")} → ${countryLabel(d.destinationCountry, "unknown destination")} ` +
              `(${words(d.relocationType) || "unknown type"})`
          ),
          // THE SPECIALIST'S WORK LIST, IN THE SPECIALIST'S CODES —
          // `IMMIGRATION_ASSESSMENT, PE_REVIEW, TAX_REVIEW`. It is the substance
          // of what Mobility Legal has to do next and it is not a list of
          // things the employee can do: none of these is an action available to
          // them, and the narrative below already tells them, in a sentence,
          // that items remain to be settled before anyone can sign this off.
          specialistDetail("Required actions", listOrNone(d.requiredActions)),
          detail("PTO decision", ptoDecisionLine(d.pto, d.costEstimate && d.costEstimate.currency)),
          // STATUS ALONE HID THE MISSING DATE. This printed only
          // `d.seniority.status`, so every PROCEED dossier read "PRESERVED"
          // while `seniorityDate` was null underneath — and preserved-from-when
          // is the entire substance of the verdict, since statutory notice,
          // severance and vesting all count from it. The date, or the reason
          // there isn't one, belongs on the same line as the word.
          detail("Seniority", seniorityLine(d.seniority)),
          // This system's own confidence in its own compilation. A number the
          // reader cannot check, cannot appeal and cannot act on.
          specialistDetail("Uncertainty score", d.uncertainty ?? "not scored"),
          detail("Cost estimate", costLine(result.costEstimate)),
          // WHICH PASSAGES THE RETRIEVER PUT IN FRONT OF THE SPECIALIST. It is
          // provenance — the specialist checks whether the right guidance was
          // pulled, and the framing line below already tells the employee that
          // the whole dossier is research for a qualified person to review.
          specialistDetail("Guidance cited", listOrNone((d.citations ?? []).map((c) => c.title))),
          detail("Narrative", d.narrative ?? ""),
          detail("Framing", d.framing ?? ""),
        ],
      });
    },

    // --- UC-08 (🔴, no execution path) -----------------------------------
    // Same shape, same absence of `remote`/`zendesk`, same reason.
    async uc08(body) {
      if (!textOf(body.text)) return refusal(400, "text_required", "Describe the tax question.");

      const result = await handleTaxInquiry(
        {
          text: body.text,
          // Same reasoning as UC-07's, one door over.
          employmentId: body.employmentId || subjectEmploymentId(body.persona),
          externalRef: body.externalRef || null,
          source: PORTAL_SOURCE,
          presencePeriods: buildPresencePeriods(body.presencePeriods),
          targetCountry: body.targetCountry || null,
          windowStart: body.windowStart || null,
          windowEnd: body.windowEnd || null,
        },
        {
          audit,
          dossierStore: stores.uc08,
          ...pick(llm, { parseInquiry: "classify", draftTaxNarrative: "draftNarrative", judge: "judge" }),
        }
      );

      const d = result.dossier ?? {};
      const presence = result.presenceDays;
      return ok({
        decision: result.decision,
        reason: `${d.inquiryType ?? "inquiry"} compiled for a tax specialist`,
        flags: [],
        recordId: result.dossierId,
        // The jurisdiction the presence count was made against, when the
        // request named one. Not `d.jurisdictions`, which is a list and can be
        // empty on exactly the dossiers that most need naming.
        subjectCountry: body.targetCountry || null,
        ...deliveryFields(result),
        details: [
          // `dual_residency` / `withholding` / `totalization` — the parser's
          // own classification key. The narrative's first sentence says the
          // same thing in words ("This inquiry reads as a dual tax-residency
          // question"), so the requester loses nothing and the tax specialist
          // keeps the key their own corpus is indexed by.
          specialistDetail("Inquiry type", d.inquiryType ?? "unknown"),
          // The countries this question touches, by name. The dossier's own
          // `jurisdictions` array is alpha-2 and stays that way — it is what
          // the treaty lookup keys on; this is the rendering of it.
          detail("Jurisdictions", listOrNone((d.jurisdictions ?? []).map((code) => countryLabel(code)))),
          detail(
            // computePresenceDays() returns {days, periodsCounted} and nothing
            // else — the country and window come from the request, so they are
            // read back from the body rather than invented onto the result.
            "Presence days",
            presence && presence.status === "NOT_EVALUATED"
              ? // Never a number here: the calculator could not read its inputs,
                // and a plausible-looking count is worse than a visible blank.
                // Reached now by two different inputs, and the problems list
                // says which: a period nobody finished filling in, and a
                // request to count days with no travel records at all.
                `NOT COUNTED — ${(presence.problems ?? []).join("; ")}`
              : presence
                ? // The country is echoed as the calculator normalised it, not
                  // as it was typed: rendering the raw box meant a request for
                  // "gb" reported "92 distinct day(s) in gb", a code that is
                  // not the one the comparison actually used. It is then NAMED,
                  // because a day count is a finding a person weighs and "GB"
                  // is one glance from three other codes. Normalise first and
                  // name second, in that order — `countryLabel()` returns a
                  // value that is not code-shaped untouched, so an alpha-3 the
                  // form let through still shows as itself.
                  `${presence.days} distinct day(s) in ${countryLabel(String(body.targetCountry).trim().toUpperCase())} between ${body.windowStart} and ${body.windowEnd} (${presence.periodsCounted} of ${buildPresencePeriods(body.presencePeriods).length} supplied record(s) fell in that country and window; overlaps counted once)`
                : "not counted — a target country and a window are required"
          ),
          // Same judgement as UC-07's "Guidance cited", and one degree further
          // from the requester: `matchedOn` is the retriever describing HOW it
          // found each passage ("dual resident,residency,resident of both"),
          // which is a statement about our own retrieval and not about their
          // tax position.
          specialistDetail("Treaty passages cited", listOrNone((d.citations ?? []).map((c) => `${c.title} (${c.matchedOn})`))),
          detail("Narrative", d.narrative ?? ""),
          detail("Framing", d.framing ?? ""),
        ],
      });
    },

    // --- UC-09 (🔴-framed, and the one that really can move money) --------
    // Free text only, on purpose. handleAdjustmentRequest() treats a
    // STRUCTURED amount as already being in Remote's ×100 integer form (its
    // own comment records the 100× money bug that assumption exists to
    // prevent), while the parsed free-text path is documented as human-scale
    // and is scaled by the workflow itself. A form field labelled "amount"
    // would sit exactly on top of that trap, so the portal does not offer one.
    async uc09(body) {
      const persona = resolvePersona(body.persona);
      if (!persona) return unauthenticated();
      if (persona.kind !== "company_admin") {
        return refusal(403, "persona_cannot_request", "An off-cycle payroll adjustment is requested by the company admin.");
      }
      if (!body.employmentId) return refusal(400, "employment_required", "Pick the employee to be paid.");
      if (!textOf(body.requestText)) return refusal(400, "request_text_required", "Describe the adjustment, including the amount.");

      const result = await handleAdjustmentRequest(
        {
          employmentId: body.employmentId,
          session: persona.session,
          requestText: body.requestText,
          reasonText: body.reasonText || "",
          externalRef: body.externalRef || null,
          source: PORTAL_SOURCE,
          now: body.now || undefined,
        },
        { remote, audit, adjustmentStore: stores.uc09, ...pick(llm, { parseAdjustment: "parseAdjustment", judge: "judge" }) }
      );

      const g09 = gateNarration(uc09Gates, result.reason);
      return ok({
        decision: result.decision,
        reason: result.reason,
        flags: result.flags,
        recordId: result.adjustmentId,
        ...deliveryFields(result),
        ...g09.fields,
        details: [
          ...g09.details,
          detail(
            "Approvals required before any money moves",
            // NOT the bare number. `0` printed under this label, four lines
            // below a headline promising "the floor is Math.max(2, …), so no
            // risk score can ever lower it to one pair of eyes, let alone
            // none", reads as the floor having been lowered to none — and it
            // appeared verbatim on the Payroll Ops escalation ticket too. What
            // a zero actually means here is the opposite: this request was
            // refused before any approval path was opened, so there is nothing
            // for anyone to sign and no route to a payment at all.
            result.approvalPathOpen
              ? String(result.approvalSlotsRequired)
              : "none — no approval path was opened. This request was refused before it could collect signatures, so there is no route from here to a payment; the floor of two is not lowered, it is never reached."
          ),
          // The parser's classification of the payment. Payroll Ops matches on
          // it; the person who asked for the payment described it themselves in
          // the request text this was derived from.
          specialistDetail("Adjustment type", result.adjustmentType ?? "not classified"),
          // WHERE THE RUN ACTUALLY STOPPED. UC-09 has no rule-based amount
          // extraction on purpose (adjustmentParser.js's own header: a wrong
          // number here is paid out), so whenever the LLM is unconfigured or
          // unreachable EVERY free-text request refuses at the parser. Nothing
          // on screen was false before this line, but the reason a tester read
          // was always the parser's, and the gate a scenario existed to
          // demonstrate went unexercised while looking exercised. Said plainly,
          // with the remedy the parser's header prescribes.
          detail(
            "Amount",
            result.amountEstablished
              ? "established from the request text and carried forward as a ×100 integer"
              : "NOT ESTABLISHED — the run stopped at the amount parser, which refuses rather than guessing a figure that would be paid out. A payroll specialist must read the request on the ticket and re-submit it with the amount as structured input."
          ),
          // Written for the person who has to authorise the payment.
          specialistDetail("Drafted summary", result.summary),
          // Telemetry — see UC-04's copy of this row. Routed to the operators'
          // section of the ticket by OPS_ONLY_DETAILS and off the page entirely
          // by forRequester().
          detail("Narrative faithfulness", faithfulnessOf(result.faithfulness)),
          // WHY THIS IS NOT THE REQUESTER'S ROW even though it is an absence.
          // The absence itself — that no money has moved and none can until
          // every approval is recorded — is stated to them in a sentence at the
          // top of the panel, by the plain answer, and again on the approvals
          // row above. What this line adds beyond that is an account of which
          // of this system's own surfaces holds the write, which is a fact
          // about our architecture. The rule is that a limit affecting the
          // requester must survive somewhere they read; it is not that every
          // wording of it must.
          specialistDetail(
            "Executed?",
            "no — the portal has no approve control; the write fires only from the approval endpoint once every slot is filled"
          ),
        ],
      });
    },
  };
}

// ---------------------------------------------------------------------------
// Shaping helpers — form fields in, documented workflow input out
// ---------------------------------------------------------------------------

/**
 * UC-05's time-off input. The form asks for whole days and an hourly rate in
 * human units; the ×100 scaling happens here, at the boundary, exactly like
 * every other value entering this system (00-FOUNDATION.md §4 invariant 1).
 * Nothing stated about accrual at all -> an empty array, which
 * reconcilePtoPayout() reports honestly as `no_time_off_records` rather than
 * as a zero balance it computed.
 *
 * AND IT NEVER SUPPLIES A NUMBER THE REQUESTER DID NOT — finding F-30.
 * This function used to end each line with
 * `Number.isFinite(hourlyRate) ? toRemoteInteger(hourlyRate) : 0`, and the
 * guard did not even bite: `Number("") === 0`, so a blank rate box took the
 * *finite* branch and scaled a zero. Either way the adapter handed UC-05 a
 * perfectly well-formed balance carrying a rate nobody had given it. Driven
 * through the real route with 8 accrued days and a blank rate, the portal
 * answered `prepared_for_signoff` and printed **"0.00 EUR (time_off_records)"**
 * — a confident payout of nothing on eight genuinely accrued days, which is an
 * underpayment a human signs off on with no error anywhere.
 *
 * The deeper damage was to the gate. UC-05 had just built the refusal for
 * exactly this (F-28, `pto_balance_unusable`), and it was unreachable through
 * this entry point, because the adapter destroyed the evidence that anything
 * was missing one layer before the gate could see it. A missing figure must
 * stay missing all the way to the policy engine.
 *
 * So each field is either forwarded as stated or left out:
 *   - a rate that is not a readable number is OMITTED, and reconcilePtoPayout()
 *     refuses the line naming `hourlyRateInRemoteInteger`;
 *   - a stated-but-unreadable accrual is forwarded RAW, so the reconciler
 *     refuses it by name rather than the portal reporting "no records" — an
 *     accrual we could not read is not the same fact as an empty PTO section;
 *   - a blank days-used box is OMITTED rather than sent as 0 or as "", because
 *     the reconciler documents that field as optional and refuses `""`;
 *     omitting it lets that documented rule apply instead of this file
 *     answering a question nobody asked.
 * A typed `0` is the requester's own answer and still computes: "the user said
 * zero" and "we don't know" are different facts, and only one is safe to
 * compute with.
 *
 * NOTHING HERE DECIDES. The portal is an adapter; whether an unusable balance
 * escalates is the policy engine's judgement (prime directive 1), and this
 * function deliberately adds no second refusal of its own — it only stops
 * concealing the inputs the gate needs.
 *
 * A NEGATIVE stated accrual IS forwarded, as of finding F-35. This paragraph
 * used to say the opposite, and the reason it gave — that reconcilePtoPayout()
 * would clamp it to a computable 0.00 — stopped being true when F-33 taught
 * unusableFields() to refuse a negative day count by name. A rationale that
 * outlives the weakness it was reasoning about turns into a hole: the deleted
 * shortcut was suppressing exactly the input the gate had since been built to
 * catch. Same rule as every other field here — stated is forwarded, absent
 * stays absent, and UC-05's gate does the deciding.
 */
export function buildTimeOffBalances(body) {
  // "Nothing was stated" is the only reading that justifies an empty PTO
  // section. Everything else is forwarded, readable or not.
  //
  // THE `daysAccrued <= 0` SHORTCUT THAT USED TO BE HERE IS GONE — finding F-35,
  // and it is F-30 rebuilt one layer over. It read:
  //
  //     if (Number.isFinite(daysAccrued) && daysAccrued <= 0) return [];
  //
  // and its own comment defended the negative case on the grounds that
  // reconcilePtoPayout() "clamps with Math.max(0, …) and would report a
  // computable 0.00". That was true when it was written and has not been true
  // since F-33: unusableFields() now refuses a negative day count by name,
  // precisely so a stated -8 becomes a question rather than a payout. The
  // shortcut was still deleting the evidence one layer before the gate that
  // had been built to catch it — the exact relationship F-30 removed between
  // this function and F-28.
  //
  // Driven through the real form (Emma Thompson, -8 accrued days, a valid
  // 40.00 rate) the portal answered `prepared_for_signoff` and printed
  // **"PTO PAYOUT 0.00 GBP (no_time_off_records)"**: a final settlement of
  // nothing, reported as though no balance had ever been mentioned, with no
  // flag anywhere and an HR Ops sign-off button waiting on it.
  //
  // A typed `0` now also survives, which is what this function's own comment
  // below already promised and the deleted line contradicted. "The employee
  // says they accrued nothing" and "the employee said nothing" are different
  // facts; both settle at 0.00, but only one of them is an answer, and the
  // reconciler's `source` field is where that difference is recorded
  // (`time_off_records` vs `no_time_off_records`).
  if (!stated(body.ptoDaysAccrued)) return [];
  const daysAccrued = Number(body.ptoDaysAccrued);

  const balance = {
    timeOffType: body.ptoType || "vacation",
    // Unreadable stays unreadable: the reconciler names the field, this file
    // does not swallow it.
    daysAccrued: Number.isFinite(daysAccrued) ? daysAccrued : body.ptoDaysAccrued,
  };

  if (stated(body.ptoDaysUsed)) {
    const daysUsed = Number(body.ptoDaysUsed);
    balance.daysUsed = Number.isFinite(daysUsed) ? daysUsed : body.ptoDaysUsed;
  }

  const hourlyRate = Number(body.ptoHourlyRate);
  if (stated(body.ptoHourlyRate) && Number.isFinite(hourlyRate)) {
    balance.hourlyRateInRemoteInteger = toRemoteInteger(hourlyRate);
  }

  return [balance];
}

/**
 * The UC-07 PTO line. `liquidatedDays` is `null` when nobody counted the
 * balance (F-29), and printing that as "null days liquidated" — or worse, as a
 * bare 0 — states a count the dossier does not have. The cashout is shown
 * beside it because that is the figure a mobility specialist acts on, and its
 * refusal is as much a finding as its total.
 */
function ptoDecisionLine(pto, currency = null) {
  if (!pto) return "not evaluated";
  const days = typeof pto.liquidatedDays === "number" ? `${pto.liquidatedDays} days liquidated` : "day count not established";
  // THE CASHOUT WAS PRINTED WITHOUT A DENOMINATION — "cashout 2618.18", on a
  // relocation dossier, two rows above a cost estimate reading "7,226.18 USD".
  // A specialist reading a bare figure supplies a currency from context, and
  // the context on that panel is a DIFFERENT total. The currency was available
  // the whole time: `costEstimate.currency` is the same string
  // costCalculator.js stamps on the ptoCashout component, so it is this
  // figure's own denomination and not a neighbour's.
  //
  // WHEN IT IS ABSENT THE ABSENCE IS STATED, never defaulted. This repo's money
  // rule is that a wrong figure gets acted on while a missing one gets
  // investigated, and a manufactured currency on a relocation cost is the
  // former wearing the latter's clothes.
  const amount = pto.cashout && pto.cashout.computable ? fromRemoteInteger(pto.cashout.totalRemoteInteger).toFixed(2) : null;
  const denominated = currency ? `cashout ${amount} ${currency}` : `cashout ${amount} — the currency is not recorded on this dossier`;
  const cashout = pto.cashout
    ? pto.cashout.computable
      ? denominated
      : `cashout not derivable — missing ${pto.cashout.unusable.map((u) => words(u.field)).join(", ")}`
    : "cashout not evaluated";
  // `words()` on the decision and on any missing field name: TRANSFER and
  // LIQUIDATE read as words already, but the calculator's field names
  // (`dailyRateRemoteInteger` and its neighbours) do not, and this line is read
  // by the person whose leave balance it is.
  return `${words(pto.decision)} (${days}; ${cashout})`;
}

/**
 * The UC-05 payout line the page shows. It reports what reconcilePtoPayout()
 * concluded and adds nothing: a refused reconciliation has `null` money fields
 * (finding F-28), so formatting it as a number would both throw
 * (`fromRemoteInteger(null)`) and, if it did not, print a figure nobody
 * derived. Naming the missing field is what makes the escalation actionable
 * to whoever reads it.
 */
/**
 * The statutory-notice line. Says a number only when one was derived.
 * `noticeEndDate` is the calculator's own "did this work" signal — it is null
 * on both no-result branches and a date on every path that produced one.
 */
function noticeLine(notice) {
  if (!notice) return "not calculated";
  if (!notice.noticeEndDate) {
    return notice.noticeRuleFound === false
      ? "not determined — no statutory rule on file for this country"
      : "not determined — this tenure falls outside every bracket in the country's rule";
  }
  return `${notice.noticeDays} days (${notice.basis}) → last working day ${notice.noticeEndDate}`;
}

/**
 * Length of service. `null` means "we could not work it out" and must not be
 * rendered as a number: the no-rule branch used to hardcode `tenureMonths: 0`,
 * so a five-year Brazilian employee was shown — and durably recorded — as
 * having served 0 months. Not knowing a country's notice law says nothing
 * about how long somebody has worked there.
 */
function tenureLine(notice) {
  if (!notice) return "not calculated";
  if (typeof notice.tenureMonths !== "number") return "not determined";
  return `${notice.tenureMonths} months${notice.onProbation ? ", on probation" : ""}`;
}

/**
 * Where the balances the payout was worked out from came from, in words.
 *
 * `time_off_records` / `no_time_off_records` are the reconciler's own source
 * tags. They were printed raw, in brackets, after the money — so the line a
 * resigning employee read to find out what they were owed ended in an
 * identifier from a table they have never seen. The FACT matters and stays:
 * a payout of 0.00 because nobody has any recorded leave is a different
 * statement from a payout of 0.00 that was calculated, and the second sentence
 * is the one somebody would otherwise supply from memory.
 *
 * A source this map does not know is printed as it is rather than dropped —
 * a new tag should look unfinished, not invisible.
 */
const PTO_SOURCE_WORDS = Object.freeze({
  time_off_records: "from the leave balances on record",
  no_time_off_records: "no leave balances are recorded for this employee",
});

function ptoSourceWords(source) {
  const key = String(source ?? "").trim();
  if (!key) return null;
  return PTO_SOURCE_WORDS[key] ?? key;
}

function ptoPayoutLine(payout) {
  if (!payout) return "not calculated";
  const source = ptoSourceWords(payout.source);
  if (payout.computable === false || payout.totalInRemoteInteger === null) {
    const named = (payout.unusableLines ?? [])
      .map((line) => `${line.timeOffType ?? "balance"} — missing ${(line.missing ?? []).join(", ")}`)
      .join("; ");
    return `not derivable${source ? ` — ${source}` : ""}${named ? `: ${named}` : ""}`;
  }
  return `${fromRemoteInteger(payout.totalInRemoteInteger).toFixed(2)} ${payout.currency}${source ? ` — ${source}` : ""}`;
}

/**
 * The leaving date they proposed, measured against the one the law gives.
 *
 * The comparison used to print the calculator's own flag —
 * `2026-08-31 — earlier_than_statutory (-23 days)` — which is the most
 * consequential line on the panel for a person who has just resigned, written
 * in the vocabulary of the function that computed it. A negative number of days
 * is worse still: the reader has to work out which direction "-23" points
 * before they know whether they are leaving too early or too late.
 *
 * The four flags are named in the calculator's own typedef (`match`,
 * `earlier_than_statutory`, `later_than_statutory`, `no_proposed_date`,
 * `not_comparable`) and the wording below is a rendering of them and nothing
 * more — no threshold is applied here and no verdict is reached. An unknown
 * flag falls through to itself, so a new one is visibly unwritten rather than
 * silently swallowed.
 */
function discrepancyLine(notice) {
  if (!notice) return "not compared";
  const proposed = notice.proposedEndDate ?? null;
  const days = notice.discrepancyDays;
  const size = typeof days === "number" ? `${Math.abs(days)} day${Math.abs(days) === 1 ? "" : "s"}` : null;
  switch (notice.discrepancy) {
    case "match":
      return `${proposed} — the same day the statutory notice period ends.`;
    case "later_than_statutory":
      return `${proposed} — ${size ? `${size} later than ` : "later than "}the statutory notice period requires. Giving more notice than the minimum is allowed.`;
    case "earlier_than_statutory":
      // THE ONE THAT NEEDS THEM TO DO SOMETHING, so it says so. The shortfall
      // is what the case is escalated on; the gate's own plain-words sentence
      // sits two rows above and names who is deciding it.
      return `${proposed} — ${size ? `${size} earlier than ` : "earlier than "}the statutory notice period allows. That shortfall is what a person has to decide about.`;
    case "no_proposed_date":
      return "No leaving date was stated, so there was nothing to compare against the statutory one.";
    case "not_comparable":
      return `${proposed ?? "A date was stated"} — no statutory end date was worked out, so the two could not be compared.`;
    default:
      return `${proposed ?? "no date stated"} — ${notice.discrepancy}${size ? ` (${size})` : ""}`;
  }
}

/**
 * Did the requester put anything in this box at all? A form sends "" for an
 * untouched field and `Number("")` is 0, which is why every `Number(x) || 0`
 * on a form value quietly turns silence into an answer.
 */
function stated(value) {
  return value !== null && value !== undefined && String(value).trim() !== "";
}

/**
 * UC-07's structured relocation plan: the documented defaults, overlaid with
 * the facts the form actually collects. Money arrives in human units and is
 * scaled here; a blank field stays undefined so the default applies rather
 * than a 0 that would read as "confirmed to be zero".
 */
function buildRelocationPlan(body) {
  const plan = { ...UC07_PLAN_DEFAULTS };

  const money = (value) => {
    const n = Number(value);
    return Number.isFinite(n) && value !== "" && value !== null && value !== undefined ? toRemoteInteger(n) : undefined;
  };

  // ANNUAL gross, x100 — the key transitionGate/costCalculator read and the
  // period Remote's own `annual_gross_salary` uses. It was `salaryRemoteInteger`
  // until the period was made explicit in the name; writing the old key here
  // would put the salary somewhere nothing reads, and every portal relocation
  // would report its cashout as underivable while the box plainly had a number
  // in it.
  assign(plan, "annualGrossSalaryRemoteInteger", money(body.salary));
  assign(plan, "minimumVisaSalaryRemoteInteger", money(body.minimumVisaSalary));
  assign(plan, "currency", body.currency || undefined);
  assign(plan, "months", Number(body.months) || undefined);

  for (const field of ["creationDate", "proposedStartDate", "destinationStartDate", "sourceTerminationDate", "sourceLastWorkingDay", "originalHireDate"]) {
    assign(plan, field, body[field] || undefined);
  }

  // Booleans are sent explicitly by the form (checkbox state), so `false` is a
  // real answer and must not be treated as "unset".
  for (const field of [
    "destinationSupported",
    "immigrationSupportRequired",
    "immigrationConfirmed",
    "rightToWorkConfirmed",
    "destinationStartDateConfirmed",
    "sourceExitPlanValidated",
    "employerPresenceInDestination",
    "taxTreatyNexusConfirmed",
    "ptoTransferAllowed",
  ]) {
    if (typeof body[field] === "boolean") plan[field] = body[field];
  }

  // NOT `Number(x) || 0` — finding F-30, the same shape as UC-05's rate box.
  // evaluateTransitionGates() defaults this to `null` on purpose (F-29): a
  // liquidated balance nobody has counted must reach reconcilePtoCashout() as
  // unknown so it refuses, because a counted zero settles the final payment at
  // nothing and a specialist signs it. A blank box is therefore left UNSET,
  // and an unreadable one is forwarded as typed so the gate names it rather
  // than this file swallowing it. A typed 0 is the requester's own answer and
  // still cashes out at zero, which is correct and is asserted.
  if (stated(body.sourcePtoDays)) {
    const days = Number(body.sourcePtoDays);
    plan.sourcePtoDays = Number.isFinite(days) ? days : body.sourcePtoDays;
  }

  // Tri-state on purpose: true / false / null(unknown). evaluateSeniority()
  // treats null as REQUIRES_LEGAL_REVIEW, which is a different and more honest
  // answer than "resets".
  plan.seniorityPreservable =
    body.seniorityPreservable === "yes" ? true : body.seniorityPreservable === "no" ? false : null;

  return plan;
}

/**
 * UC-08's presence periods. An UNTOUCHED row is dropped; a row the requester
 * PARTLY filled in is forwarded exactly as they left it.
 *
 * AND IT NEVER DELETES A ROW THE REQUESTER TOUCHED — the same finding as F-30
 * one use case over, and the same fix. This function used to be
 * `.filter((r) => r && r.country && r.startDate && r.endDate)`, which is the
 * portal deciding, one layer above the gate, that an incomplete travel record
 * simply did not happen. Driven through the real route with two periods — a
 * complete March–May stay in the UK and a July stay whose end date was left
 * blank — the portal answered "92 distinct day(s) in GB … (1 period(s)
 * counted)". Confident, precise, and computed from half the input, with
 * nothing anywhere on the page saying a row had been discarded. On the use case
 * whose whole subject is the 183-day threshold, the discarded July stay is
 * exactly the evidence that decides the question.
 *
 * The form's two rows both render empty, so an untouched row must still be
 * dropped — an empty row is not a stated period, it is a row nobody used. But
 * a row carrying ANY value is a period the requester meant to tell us about,
 * and it goes to computePresenceDays() raw, where the missing date makes it
 * `unparseable period dates for GB: "2026-07-01" → ""` and the whole count
 * becomes an explicit NOT_EVALUATED naming the offending row. Louder than a
 * silent drop, and correct: a count that is missing a period is not a smaller
 * count, it is not a count.
 *
 * NOTHING HERE DECIDES. Whether an unreadable period escalates, blanks the
 * count, or is merely reported is presenceCalculator.js's judgement (prime
 * directive 1). This function only stops concealing the input it is given.
 */
export function buildPresencePeriods(rows) {
  if (!Array.isArray(rows)) return [];
  return rows
    .filter((r) => r && (stated(r.country) || stated(r.startDate) || stated(r.endDate)))
    .map((r) => ({
      // Trimmed and upper-cased only when there is something to normalise:
      // String(null) is "null", which would arrive at the calculator as a
      // country code. The calculator normalises again on its own side — this is
      // for the value that gets STORED and displayed, so a dossier does not
      // record a country as " gb ".
      country: stated(r.country) ? String(r.country).trim().toUpperCase() : r.country,
      startDate: r.startDate,
      endDate: r.endDate,
    }));
}

// ---------------------------------------------------------------------------
// UC-04's travel history — the input that makes the risk matrix COMPUTE
// ---------------------------------------------------------------------------
// WHAT THIS REPLACES, AND WHY IT WAS WRONG
// `travelHistory: []` was hard-coded at the UC-04 adapter's call site, with a
// comment explaining that the portal has no source of prior trips and that
// inventing one would make the cumulative-day gate look like it had data it
// does not have. The first half was true and the second half was the wrong
// conclusion drawn from it. The consequence was not caution: it made BOTH of
// UC-04's day thresholds — the Schengen 90-in-180 immigration limit and the
// 183-in-365 tax-residency watch — structurally unreachable from this page.
// They could never fire, for anyone, and a gate that cannot fire is
// indistinguishable from one that is appropriately quiet (CLAUDE.md §4).
//
// The distinction the original comment missed is between INVENTING a history
// and ACCEPTING a stated one. Nothing here fabricates a trip. The requester
// states their own prior stays, exactly as they state their nationality, their
// visa type and their duties — every other input on this form is a claim too,
// and the matrix has always judged claims. What the page must not do is print
// a stated history as though it had been read from Remote, so the result panel
// says whose figures these are (describeTravelWindows() below).
//
// AN UNTOUCHED ROW IS DROPPED; AN UNREADABLE ONE IS REFUSED. This is the one
// place it departs from buildPresencePeriods(), which forwards a half-filled
// row raw so that UC-08's calculator can name it. UC-04's calculator does not
// name it: `computeCumulativeDays()` runs `Math.max(NaN, winStart)` on an
// unreadable date, never trips its `end < start` guard, and returns
// `{days: NaN}`. NaN loses every comparison, so `cum.days + tripDays > 90` and
// `> 183` are both silently FALSE and the request comes back cleared. Observed:
// a 123-day Spanish stay plus one row with an unreadable end date scores `low`
// / `all_gates_passed`, and `NaN` serialises to `null` through JSON, so the
// stored row reads "not computed" rather than "computed wrong".
//
// That is a defect in the calculator and it is reported, not fixed here —
// changing an arithmetic gate is its own reviewed unit of work. But this page
// must not be the thing that reaches it, and it has only three options: forward
// (a wrong approval with no warning), drop (a smaller count presented as a
// count), or refuse. A count that is missing a period is not a smaller count,
// it is not a count — buildPresencePeriods()'s own conclusion, one use case
// over. So it refuses, and the refusal names the row. When
// `computeCumulativeDays()` learns to refuse for itself, this guard becomes
// redundant rather than wrong, and the rows can be forwarded raw like UC-08's.
// ---------------------------------------------------------------------------

/** A date the calculator can actually read. Blank is not "unreadable" — it is unstated. */
const readableDate = (value) => stated(value) && !Number.isNaN(new Date(String(value).trim()).getTime());

/**
 * The prior stays a requester stated, in the shape `classifyRisk()` expects:
 * `{country, startDate, endDate}` with both ends inclusive.
 *
 * @param {unknown} rows
 * @returns {{periods: Array<{country:string,startDate:string,endDate:string}>, unreadable: string[]}}
 *   `unreadable` is a list of human-readable descriptions of rows the day
 *   counter could not evaluate. Non-empty means the request must be refused,
 *   never trimmed down to the rows that happened to parse.
 */
export function buildTravelHistory(rows) {
  if (!Array.isArray(rows)) return { periods: [], unreadable: [] };
  const periods = [];
  const unreadable = [];

  rows.forEach((r, i) => {
    // An entirely empty row is a row nobody used — the form renders blanks.
    if (!r || (!stated(r.country) && !stated(r.startDate) && !stated(r.endDate))) return;

    const country = stated(r.country) ? String(r.country).trim().toUpperCase() : null;
    const problems = [];
    if (!country) problems.push("no country");
    if (!readableDate(r.startDate)) problems.push(`start date ${stated(r.startDate) ? `"${r.startDate}"` : "missing"}`);
    if (!readableDate(r.endDate)) problems.push(`end date ${stated(r.endDate) ? `"${r.endDate}"` : "missing"}`);
    // Backwards dates are readable but not a stay. `computeCumulativeDays()`
    // does skip these (`end < start` -> continue), so forwarding one would
    // merely drop it silently — the same concealment, quieter.
    if (problems.length === 0 && new Date(r.endDate).getTime() < new Date(r.startDate).getTime()) {
      problems.push(`the stay ends (${r.endDate}) before it starts (${r.startDate})`);
    }

    if (problems.length > 0) {
      unreadable.push(`prior stay ${i + 1}: ${problems.join(", ")}`);
      return;
    }
    periods.push({ country, startDate: String(r.startDate).trim(), endDate: String(r.endDate).trim() });
  });

  return { periods, unreadable };
}

/**
 * The two day counts behind a UC-04 decision, each beside its own limit and its
 * own window — because they are different questions and can disagree.
 *
 * WHY THIS IS COMPUTED HERE AND NOT READ OFF THE DECISION.
 * `src/uc04/decisionFacts.js` reports the 183/365 row with a real `measured`
 * figure, because `uc04_authorizations` persists `cumulativeDays`. It reports
 * the Schengen row with `measured: null` and says so, because the matrix
 * computes that total, keeps only the verdict, and the row has no column for
 * it — decisionFacts' own `whatItWouldTake` names the fix (a `travel_history`
 * column, or the total carried on `risk`). That fix is a schema change to a
 * durable table and is left as the recorded open item it already is.
 *
 * So the missing half is recomputed HERE, from the history this request
 * submitted moments ago, with the matrix's own exported counter — and it is
 * labelled as a recomputation rather than presented as a reading of the record.
 * It DECIDES NOTHING: same contract as describeDecisionBasis() and
 * describeGateLadder(). No gate consults it, and it runs after the workflow has
 * already answered.
 *
 * TWO LIMITS, TWO WINDOWS, TWO MEANINGS, and the honesty each one needs:
 *   - Schengen 90/180 is an IMMIGRATION limit with a statutory source
 *     (Reg. (EU) 2016/399 Art. 6(1)). Its window here is the one the matrix
 *     uses: a single trailing 180 days anchored at the trip start. The
 *     regulation evaluates "the 180-day period preceding each day of stay" —
 *     a different computation, recorded as C-1 in
 *     docs/knowledge/layer-1-statutory/CONTRADICTIONS.md and NOT implemented
 *     here. The line says which one it is, so a reader is never told a figure
 *     is the regulation's when it is the code's.
 *   - 183/365 is a tax-residency WATCH, and the single pair of constants stands
 *     in for four differently-shaped national tests (C-12): the Netherlands has
 *     no day count at all — AWR art. 4 judges residence by the circumstances —
 *     so precise "headroom" against 183 is headroom against a line that country
 *     does not draw. The line says the threshold is this system's own screening
 *     rule and not the destination's law.
 *
 * @returns {Array<{label:string, value:string}>} detail rows, or [] when there
 *   is nothing measured to report.
 */
function describeTravelWindows({ periods, factors, result }) {
  if (!Array.isArray(periods) || periods.length === 0) return [];
  const destination = String(factors?.destination?.country ?? "").trim().toUpperCase();
  const start = factors?.startDate;
  if (!destination || !stated(start) || Number.isNaN(new Date(start).getTime())) return [];

  // THE CODE DECIDES AND THE NAME IS READ — src/shared/countryNames.js's own
  // division. `destination` above is the normalised alpha-2 every comparison in
  // this function uses (SCHENGEN.has, DNV_COUNTRIES.has, the day counter's
  // `country` argument), and it stays exactly as it is. `place` is the same
  // fact for the sentences: these rows are the most-read prose on a UC-04
  // result and they printed "90 day(s) already stated in PT", which asks a
  // traveller to know that PT is Portugal and not "part-time".
  const place = countryLabel(destination, "the destination");

  const rows = [];
  const trip = Number.isFinite(result?.tripDays) ? result.tripDays : null;
  const windowFrom = (spanDays) =>
    new Date(new Date(start).getTime() - spanDays * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  // What the requester actually stated, before any window clips it. Printed
  // first so the two clipped figures below are readable as SUBSETS of a stated
  // input rather than as numbers from nowhere.
  const forDestination = periods.filter((p) => p.country === destination);
  rows.push(
    detail(
      "Prior stays stated by the requester",
      `${periods.length} stay(s) supplied, ${forDestination.length} of them in ${place}. ` +
        "Stated on this form by the person filing the request — this page does not read travel history from Remote, " +
        "so these are claims the matrix judged, exactly like the nationality and visa type beside them."
    )
  );

  // --- Schengen 90/180 -----------------------------------------------------
  const inSchengen = SCHENGEN.has(destination);
  const suppressed = inSchengen && DNV_COUNTRIES.has(destination);
  if (inSchengen) {
    const from = windowFrom(180);
    const cum = computeCumulativeDays({ travelHistory: periods, country: destination, windowStart: from, windowEnd: start });
    const total = trip === null ? null : cum.days + trip;
    const measured =
      `${cum.days} day(s) already stated in ${place} between ${from} and ${start} ` +
      `(${cum.periodsCounted} stated stay(s) fell in that window)` +
      (total === null
        ? "; this trip's own length was not derived, so no total is stated"
        : `, plus ${trip} day(s) for this trip = ${total} of 90`);

    if (suppressed) {
      // THE SHARPEST LINE ON THIS PAGE. The number exists, it was stated, it is
      // printed — and the check it belongs to was skipped, on the strength of a
      // five-entry hand-written list with no authority, version or review date
      // (DNV_COUNTRIES_PROVENANCE). A suppressed check and a passed check
      // produce identical silence, and they are opposite facts.
      rows.push(
        detail(
          "Schengen 90-in-180",
          `NOT APPLIED. ${place} is inside the Schengen area, so the 90/180 allowance would govern this trip, ` +
            `and this system skips the check for ${place} because it treats it as running a formal digital-nomad-visa scheme. ` +
            `The count was still available: ${measured}. Nothing here says the traveller is within the limit — the limit was excused, ` +
            "which is a different fact, and the list doing the excusing is uncited."
        )
      );
    } else {
      const breached = Array.isArray(result?.flags) && result.flags.includes("schengen_overstay");
      rows.push(
        detail(
          "Schengen 90-in-180",
          `${breached ? "OVER THE LIMIT" : "Within the limit"}. ${measured}` +
            (total === null || breached ? "" : ` — ${90 - total} day(s) of headroom`) +
            (total !== null && breached ? ` — over by ${total - 90}` : "") +
            ". Recomputed by this page from the stays stated above, using the matrix's own day counter: the decision record " +
            "keeps the verdict but not the total. The window is a single trailing 180 days anchored at the trip start, which " +
            "is what this system computes; Reg. (EU) 2016/399 Art. 6(1) evaluates the 180 days preceding EACH day of stay, " +
            "and that difference is an open finding, not something this figure reflects."
        )
      );
    }
  }

  // --- 183/365 tax-residency watch ----------------------------------------
  // Read off the DECISION, not recomputed: `cumulativeDays` is persisted, so
  // this is the figure the gate actually used and the figure a specialist will
  // see on the sidebar. Absent when a hard block returned before the matrix
  // reached this threshold at all — reported as such, never as a zero.
  const cumulative = result?.cumulativeDays ?? null;
  if (cumulative && Number.isFinite(cumulative.days)) {
    const total = trip === null ? null : cumulative.days + trip;
    const watched = Array.isArray(result?.flags) && result.flags.includes("tax_residency_watch");
    rows.push(
      detail(
        "183-in-365 tax-residency watch",
        `${watched ? "OVER THE WATCH LINE" : "Under the watch line"}. ` +
          `${cumulative.days} day(s) counted in ${place} over the trailing 365 days to ${start} ` +
          `across ${cumulative.periodsCounted} stated stay(s)` +
          (total === null
            ? "; this trip's own length was not derived, so no total is stated. "
            : `, plus ${trip} day(s) for this trip = ${total} of 183` +
              (watched ? ` — over by ${total - 183}. ` : ` — ${183 - total} day(s) of headroom. `)) +
          "A different question from the row above, over a different window: that one asks whether the traveller may ENTER, " +
          "this one asks whether they may become tax-resident. They can disagree. " +
          "183 over 365 is this system's own single screening line, applied to every destination — it is not the destination's " +
          "own residence test, and at least one of the countries this demo uses (the Netherlands) has no day count in its law at all."
      )
    );
  } else if (forDestination.length > 0) {
    rows.push(
      detail(
        "183-in-365 tax-residency watch",
        "Not reached — a hard block decided this request before the rolling-window count was taken. " +
          "Not a finding that the traveller is within the line; nothing was counted against it."
      )
    );
  }

  return rows;
}

// ---------------------------------------------------------------------------
// THE PERSONA PICKER USED TO CALL EVERY PERSON AN "EMPLOYEE"
// ---------------------------------------------------------------------------
// Reported 2026-08-28, looking at the UC-01 card: "I thought Carlos Silva was a
// contractor, why is he showing as an employee on the portal, is it as if
// everybody there is an employee?"
//
// He is a contractor. `src/remote/mockServer.js` mirrors a real Sandbox record
// whose `contract_type` is genuinely "contractor", the note under the picker
// said so in prose, and the letter refused him `engagement_not_eor_contractor`.
// The DROPDOWN said "Carlos Silva — employee".
//
// The cause is one word doing two jobs. `persona.kind` answers "who is at the
// keyboard" and has exactly two values, `employee` and `company_admin` — it is
// the SESSION ROLE, and it is what the picker was rendering. `contract_type`
// answers "what is the legal relationship with Remote". Both spell one of their
// values "employee", so the label was strictly true and read as a claim about
// something it had never been about. On a card whose whole demonstration is
// that a contractor is refused, that is not cosmetic: the screen contradicted
// the answer it was about to give.
//
// THE LABEL IS NOW DERIVED FROM THE GATE, NOT RESTATED BESIDE IT. It would have
// been half a line to add an `engagement: "contractor"` string to each persona
// in personas.js. That is the version that drifts — a second hand-maintained
// copy of a fact the employment record already holds, free to disagree with the
// record the moment either changes, which is the failure that just happened one
// level up. So this calls `classifyEngagement()`, the SAME function
// `issueSelfServiceLetter()` calls. The picker cannot now say "employee" about
// somebody the letter is about to refuse as a contractor, because one function
// answers both questions.
//
// FAILS SOFT, DELIBERATELY, AND THIS IS THE ONE PLACE THAT IS RIGHT. Everywhere
// a gate reads an engagement it fails CLOSED — an unreadable value refuses. Here
// an unreadable value yields NO LABEL AT ALL rather than a guess or a default,
// because this is a caption on a dropdown, and captioning an unknown record
// "employee" is precisely the defect being fixed. Silence is the honest output.
const ENGAGEMENT_LABEL_CACHE = new Map();

async function labelledPersonas(remote) {
  const personas = listPersonas();
  return Promise.all(
    personas.map(async (persona) => {
      if (!persona.employmentId) return persona; // the admin — no employment to read
      if (ENGAGEMENT_LABEL_CACHE.has(persona.id)) {
        return { ...persona, engagement: ENGAGEMENT_LABEL_CACHE.get(persona.id) };
      }
      try {
        const employment = await remote.getEmployment(persona.employmentId);
        // The record's own word, lightly humanised — never a word this file
        // chose. "global_payroll_employee" prints as "global payroll employee",
        // and if Remote ever returns something nobody here has seen, the
        // picker shows that instead of quietly normalising it away.
        // `contract_type` AND NOTHING ELSE — the exact field classifyEngagement
        // branches on (engagementEligibility.js). An earlier draft here fell
        // back to `employment_type` when it was absent, which would have
        // captioned a person by a field the gate never reads: a caption and a
        // refusal disagreeing again, one field lower down. If the gate ever
        // widens what it reads, widen this in the same edit.
        const raw = employment?.contract_type ?? null;
        const label = typeof raw === "string" && raw.trim() ? raw.trim().replace(/_/g, " ") : null;
        ENGAGEMENT_LABEL_CACHE.set(persona.id, label);
        return { ...persona, engagement: label };
      } catch (err) {
        console.error(`[portal] could not read engagement for ${persona.id}: ${err.message}`);
        return persona;
      }
    })
  );
}

/** The expense records the UC-02 picker offers, read live from Remote. */
async function listExpensesForPicker(remote) {
  try {
    // GET /v1/employee/expenses answers `{expenses: [...]}` once the client
    // has unwrapped `data` — tolerate a bare array too rather than assuming.
    const payload = await remote.listExpenses({ pageSize: 50 });
    const expenses = Array.isArray(payload) ? payload : (payload?.expenses ?? []);
    return expenses.map((e) => ({
      id: e.id,
      employmentId: e.employment_id,
      title: e.title,
      // The REAL record's fields: `amount` (not `total_amount`), `currency` as
      // an OBJECT (not a bare string), and the hierarchical `expense_category`
      // (there is no `category_id`). Money leaves the API in human units, minor
      // units only ever inside it.
      amount: fromRemoteInteger(Number(e.amount)),
      currency: e.currency?.code ?? null,
      status: e.status,
      categoryId: e.expense_category?.code ?? null,
    }));
  } catch (err) {
    // A failed picker read must not take the whole page down — six other
    // forms still work, and the page renders an explicit failure line.
    console.error(`[portal] could not list expenses: ${err.message}`);
    return [];
  }
}

// ---------------------------------------------------------------------------
// Envelope helpers
// ---------------------------------------------------------------------------

/**
 * THREE different things in this system get called "duplicate", and a tester
 * must never have to guess which one they got. They are not variations on a
 * theme — they are produced by different machinery, at different points, and
 * they mean different things:
 *
 *   1. DUPLICATE DELIVERY (`duplicate: true`) — the same external REFERENCE was
 *      submitted twice, so `claimExternalRef()` refused the second at the
 *      `workflow_claims` primary key. No gate ran; nothing was decided again;
 *      nothing was written twice. This is the exactly-once guarantee working,
 *      and it is a property of the LEDGER.
 *
 *   2. ALREADY-DECIDED REPLAY (`idempotent: true`) — a different check, one
 *      layer in. UC-02 asks "have I already decided this EXPENSE?" before its
 *      gates run (workflow.js's F-24 block), so re-submitting the same expense
 *      under a brand-new reference replays the stored decision rather than
 *      issuing a second approval write. The reference was fine; the SUBJECT
 *      had already been judged.
 *
 *   3. A DUPLICATE-RECEIPT POLICY REFUSAL — not reported here at all, because
 *      it is a real decision: UC-02's §7 receipt gate found that this RECEIPT
 *      has already been reimbursed on a different expense, and answered
 *      `blocked` / `duplicate_submission`. A gate judged the money. It arrives
 *      as an ordinary decision with an ordinary record id.
 *
 * The first two say "we already handled this"; the third says "this breaks a
 * rule". Collapsing any of them into the others would make the exactly-once
 * machinery indistinguishable from a policy engine catching a double
 * reimbursement, so all three stay distinguishable on the wire and the page
 * prints whichever happened.
 *
 * WHY 1 IS INVISIBLE ON AN IN-MEMORY RUN, stated because it looks like a bug.
 * `claimExternalRef()` has no ledger without a pgPool and documents that it
 * proceeds — a per-process Set would fake a guarantee that only holds in the
 * one case that never matters. So on `npm run portal --seeded` a repeated
 * reference is NOT refused. `ledgerUndetected` below says so at the moment it
 * happens, rather than leaving a tester to conclude the check does not work.
 */
// THE LOCAL `countryName()` THAT USED TO SIT HERE IS GONE, and it is worth one
// paragraph rather than a silent deletion. It was three lines over
// PORTAL_COUNTRIES — `find(c => c.code === code.toUpperCase())` — written when
// this file was the only surface naming a country, and it had exactly one
// caller (UC-03's letter offer). src/shared/countryNames.js now derives the
// same map from the same generated list and is what the ZAF sidebar reads too,
// so keeping a second lookup here would have been the two-copies-of-one-thing
// defect this repository pays for most often: not wrong on the day it is
// written, wrong the day one copy is corrected.
//
// The imported `countryName()` is a strict improvement at that one call site —
// it normalises through normalizeCountryCode(), so a code with stray
// whitespace resolves where the local `.toUpperCase()` alone would have missed
// it — and it keeps the property the call site depends on: NULL, never a
// guess, for a code the list cannot name, so the page prints the code it really
// is instead of a country nobody chose.

/**
 * THE COUNTRY THIS REQUEST IS ABOUT, for the plain answer at the top of the
 * result — a destination, a target jurisdiction, the place a decision is
 * really about. A CODE: ./plainAnswer.js does the naming, once, at the point
 * of rendering.
 *
 * `subjectCountry` IS THE WHOLE CONTRACT, and it is one line beside the
 * decision each adapter already returns. Reading it here rather than hunting
 * through `details` is deliberate: `details` is a list of labelled strings
 * written for a person to read, and keying anything off one of those labels
 * would make a copy edit break a sentence somewhere else.
 *
 * FOUR OF THE SEVEN ADAPTERS PUBLISH ONE — uc03 (the destination the router
 * read), uc04 (the destination on the form), uc07 (the dossier's own reading of
 * where they are moving to) and uc08 (the jurisdiction the presence count was
 * made against). The other three have no country to name: an expense claim, a
 * resignation and an off-cycle payment are all about a person, not a place, and
 * a `subjectCountry` invented for them would be their employment's country
 * dressed up as the subject of the request.
 *
 * THIS FUNCTION USED TO CARRY A FALLBACK FOR UC-03, and the fallback is gone
 * because the field is now published. It read the two STRUCTURED places UC-03
 * happened to expose a destination — `letterOffer.carries.destinationCountry`
 * on an answered trip and the continuation prefill's `uc04-destinationCountry`
 * on a routing — both exact, and between them covering only the two outcomes
 * that produce an offer or a hand-off. A UC-03 ESCALATION produces neither, so
 * the one summary most in need of a place ("this could not be judged
 * automatically") named none: an archived employee's trip to Spain read as a
 * travel question about nowhere. `classification.destinationCountry` is what
 * every destination gate compared and it is present on every non-duplicate
 * path, so publishing it strictly supersedes both branches rather than adding a
 * third source of the same fact.
 */
function subjectCountryOf(envelope) {
  return envelope?.subjectCountry ?? null;
}

function deliveryFields(result) {
  if (result?.duplicate === true) {
    return {
      alreadyHandled: true,
      alreadyHandledKind: "delivery",
      duplicateDelivery: true,
      duplicateOf: result.duplicateOf ?? null,
      duplicateExplanation:
        "This exact reference had already been processed, so this request was not decided again and nothing was written twice. This is not a policy refusal: no gate judged the request this time. The decision shown is the one the first submission reached.",
    };
  }
  if (result?.idempotent === true) {
    return {
      alreadyHandled: true,
      alreadyHandledKind: "record",
      duplicateDelivery: false,
      duplicateOf: null,
      duplicateExplanation:
        "This subject had already been decided, so the stored decision was replayed instead of being reached again — no second approval write was issued. Note this is NOT the reference check: the reference was accepted, and it is the expense itself that had already been judged. Nor is it a policy refusal; no gate said no this time.",
      alreadyDecidedAt: result.alreadyDecidedAt ?? null,
    };
  }
  return { alreadyHandled: false, duplicateDelivery: false };
}

/**
 * UC-01 self-service's OWN version of the block above (rca-0jya/R7-41),
 * because `deliveryFields()`'s "delivery" wording is wrong for this surface
 * in two ways, not merely generic. It says "this exact reference had already
 * been processed" — but a self-service click never carries a
 * requester-supplied reference to repeat; the join key is an hourly bucket on
 * `employmentId` (`selfServiceLetter.js`'s `intakeKey`), invisible to the
 * requester. And it never names an expiry, because for every OTHER adapter
 * the claim really is permanent — `workflow_claims`' primary key, held
 * forever. Self-service's is not: D-26 chose an hour deliberately so a
 * genuinely later request — next month, next year, for an unrelated reason —
 * is issued fresh rather than silently joining a stale one. Answering "when
 * does this clear" was the whole point of R7-41; `duplicateWindowExpiresAt`
 * is threaded straight from `issueSelfServiceLetter()`'s own bucket boundary
 * rather than re-derived here, so the two can never disagree about it.
 */
function selfServiceLetterDeliveryFields(result) {
  if (result?.duplicate !== true) return { alreadyHandled: false, duplicateDelivery: false };
  return {
    alreadyHandled: true,
    alreadyHandledKind: "delivery",
    duplicateDelivery: true,
    duplicateOf: result.duplicateOf ?? null,
    duplicateExplanation:
      "This joined the standard employment verification letter you already requested within the last hour, rather than issuing a second one — nothing was decided twice. This hold is a one-hour window on repeat clicks, not a permanent block on this kind of request: once the window passes, your next request — including one filed for a different reason, months or years from now — is treated as new and issued fresh.",
    duplicateWindowExpiresAt: result.duplicateWindowExpiresAt ?? null,
  };
}

/**
 * The travel letter on a UC-03 case, as the person who filed it should see it.
 *
 * WHY THE RESULT PANEL NEEDS THIS AND NOT A BOOLEAN. It used to print
 * `result.letterHtml ? "yes — held for specialist sign-off" : "no"`, and that
 * sentence stopped being true the day the standard letter began issuing itself
 * with nobody in the path: an employee whose letter had ALREADY been written
 * and handed over was told it was waiting for a signature that would never
 * come. The three states are src/uc03/letterDelivery.js's, translated by
 * ./letterAccess.js — the same call the requester's own history row is built
 * from, so the two structurally cannot disagree, and neither can offer a
 * control the fetch route would refuse.
 *
 * IT IS A READ, AND A FAILED READ IS NOT AN ABSENCE. A throw returns null, and
 * the caller prints nothing rather than "no letter" — reporting a database
 * problem as a fact about the document is the direction that gets believed.
 *
 * THE SESSION IS THE READER'S OWN, from ./personas.js's server-owned map. The
 * case's own employment id would be a row verified against itself.
 */
async function letterOnCase({ caseStore, caseId, session }) {
  if (!caseStore || !caseId) return null;
  try {
    const found = await caseStore.findById(caseId);
    // UC-03-scoped by the caller, exactly as the collect route does it.
    const caseRow = found && found.useCase === "UC-03" ? found : null;
    if (!caseRow) return null;
    const { documents } = await readCaseAttachments(caseStore, caseRow.id);
    return describeLetterForRequester({
      caseRow,
      letterDocument: documentOfType(documents, LETTER_DOCUMENT_TYPE),
      session,
    });
  } catch (err) {
    console.error(`[portal] letter state for ${caseId}: ${err.stack}`);
    return null;
  }
}

/**
 * UC-01's analogue of letterOnCase() above — round-6 D-01. Kept as its own
 * function rather than a parameter on letterOnCase(), matching every other
 * per-use-case pair in this file (describeLetterForRequester /
 * describeUc01LetterForRequester, evaluateLetterDelivery /
 * evaluateUc01LetterDelivery): the shapes are similar, not shared, and a
 * `useCase` switch inside one function is how the next divergence between
 * them gets bolted onto the wrong branch.
 */
async function letterOnUc01Case({ caseStore, caseId, session }) {
  if (!caseStore || !caseId) return null;
  try {
    const found = await caseStore.findById(caseId);
    // UC-01-scoped by the caller, exactly as the collect route does it —
    // `cases` is shared with UC-03.
    const caseRow = found && found.useCase === "UC-01" ? found : null;
    if (!caseRow) return null;
    const { documents } = await readCaseAttachments(caseStore, caseRow.id);
    return describeUc01LetterForRequester({
      caseRow,
      letterDocument: documentOfType(documents, UC01_LETTER_DOCUMENT_TYPE),
      session,
    });
  } catch (err) {
    console.error(`[portal] uc01 letter state for ${caseId}: ${err.stack}`);
    return null;
  }
}

/**
 * WHO READ THE REQUEST, said to the person who wrote it.
 *
 * WHY THIS IS NOW TWO SENTENCES AND NOT ONE LABEL. The panel has carried a
 * "Request read by" row since UC-03's classifier became visible, and the row
 * was right — but the pop-up is what a requester reads, and the pop-up did not
 * carry it. An employee submitted a visa-letter request, was shown an answer
 * they did not recognise, and concluded that nothing had read their words at
 * all and that every output here is written in advance. They were wrong about
 * the cause and right that the page never told them.
 *
 * "the LLM" AND "rule_based_fallback" ARE OUR WORDS, NOT THEIRS. The row used
 * to read "the rule-based fallback (the LLM was unconfigured or failed)",
 * which explains our engineering to somebody asking about a conference in
 * Germany. Both halves now say the same thing in the reader's vocabulary, from
 * one place, so the row and the pop-up can never drift.
 *
 * NOT RECORDED IS ITS OWN ANSWER. A request whose result carries no source tag
 * is not evidence either way, and claiming a model read it would be the
 * overstatement this whole pass exists to remove.
 *
 * @param {unknown} source  the `classification.source` tag (§4 invariant 8)
 */
// WHO READ THE REQUEST — TWO AUDIENCES, AND ONLY ONE OF THEM HAS A USE FOR IT.
//
// `row` goes to the specialist. It reaches them through the facts table, which
// is also what the Zendesk ticket body renders, and there it earns its place:
// a specialist deciding whether to trust an extracted destination needs to know
// whether a model or a keyword list produced it.
//
// `sentence` goes to the requester's pop-up, and for a NORMAL reading it is
// null — deliberately. "An AI language model read your request" tells an
// employee nothing they can do anything about; the trip details are printed
// directly beneath it either way, and they would check those or not check them
// regardless of what produced them. It was put there to settle an argument
// about whether the model was running, which is the builder's question, not
// theirs.
//
// A DEGRADED reading is the exception, and it is the only one, because there
// the employee has an action: the fallback reads by keyword and misses
// phrasings a model would catch, so "check these details" is advice they can
// act on. It says what to do, not what ran.
function describeReader(source) {
  if (source === "llm") {
    return { row: "an AI language model", sentence: null };
  }
  if (source === "rule_based_fallback") {
    return {
      row: "a fixed list of keywords, because the AI model could not be reached",
      sentence: "Please check the trip details below — some of them may have been read incorrectly.",
    };
  }
  return { row: "not recorded", sentence: null };
}

const ok = (envelope) => ({ ok: true, envelope });
const refusal = (status, code, reason) => ({ ok: false, status, code, reason });
const unauthenticated = () =>
  refusal(401, "unauthenticated", "No known portal session — the persona must be one the server itself knows, never a role named in the request body.");

/**
 * The plain-words half of a decision, for the four use cases whose policy
 * engines publish a `GATE_SEQUENCE` through src/shared/gateLadder.js.
 *
 * WHY IT EXISTS. UC-02's adapter has carried `decidedBy`, `gateLadder` and a
 * "What happened" line since the gate ladder was built; UC-03, UC-04, UC-05
 * and UC-09 grew the identical data beside their own gates and nothing here
 * read it, so those four rendered the bare slug. The system held the sentence
 * and printed the identifier — and `details` is also what buildTicketNote()
 * writes into the Zendesk internal note, so the specialist receiving the
 * hand-off read the identifier too.
 *
 * THE SLUG IS NOT REPLACED. It stays on the envelope's `reason`, because it is
 * the exact string in `audit_log`, in the metrics exception ranking and in the
 * n8n ports - the thing somebody searches by. `means` sits beside it.
 *
 * A reason with no row returns `decidedBy: null` and says so, rather than
 * guessing a gate. That is what describeDecidingGate() promises and
 * test/gateLadder.test.js's drift guard exists to keep rare.
 *
 * @param {{describeDecidingGate: Function, describeGateLadder: Function}} gates
 * @param {string} reason  the slug the policy engine returned
 */
function gateNarration(gates, reason) {
  const decidedBy = gates.describeDecidingGate(reason) ?? null;
  return {
    fields: { decidedBy, gateLadder: gates.describeGateLadder(reason) },
    details: decidedBy
      ? [
          detail("What happened", decidedBy.means),
          // FOR THE SPECIALIST, NOT THE REQUESTER. "gate 4 of 18 — risk_matrix,
          // which checks that..." cites a position in an ordering that belongs
          // to this system: it tells the person who has to re-examine the case
          // exactly where it stopped, and it tells the employee who filed it
          // nothing they can act on — the plain-words `means` directly above is
          // their answer, and it says the same thing without the coordinates.
          // The total still travels with the position and is read off the
          // sequence rather than counted by hand: a hardcoded total goes stale
          // the first time a gate is added.
          specialistDetail(
            "Decided by",
            `gate ${decidedBy.position} of ${decidedBy.total} — ${decidedBy.gate}, which checks that ${decidedBy.checks}`
          ),
        ]
      : [
          // A REASON WITH NO ROW IN THE SEQUENCE, and this is the specialist's
          // problem rather than the requester's. It used to print, on the
          // employee's own screen: `No row in this use case's gate sequence
          // describes the reason "amount_not_extracted"... The slug above is
          // the whole of what was recorded.` Two internal vocabularies (a gate
          // sequence, a slug) and a pointer to a chip, describing a gap in this
          // repository's own tables. What happened to their request is still
          // answered, in a sentence, by the plain answer at the top of the panel
          // — which is composed from the decision CLASS and needs no gate row.
          specialistDetail(
            "What happened",
            `No row in this use case's gate sequence describes the reason "${reason}", so what it means in plain words cannot be stated here. The reason slug is the whole of what was recorded.`
          ),
        ],
  };
}

// ---------------------------------------------------------------------------
// WHO A DETAIL ROW IS FOR
// ---------------------------------------------------------------------------
// `details` is rendered in TWO places from one array: the requester's result
// panel, and the body of the Zendesk internal note a specialist opens
// (buildTicketNote). Those are different readers with different questions, and
// for a long time every row went to both.
//
// The project owner, three times, about three different screens: "Stop
// littering info all over the UI that is useless to my user... design all my UI
// as if you were the employee, for employee-facing UI; admin, for admin-facing
// UI; or specialist."
//
// THE REQUESTER'S FOUR QUESTIONS, which is the whole test a row has to pass:
//   1. What happened to my request?
//   2. Do I need to do anything?
//   3. If somebody else must act, who, and roughly when?
//   4. If something was produced for me, how do I get it?
// A row answering none of them is litter on their page however true it is.
//
// A SPECIALIST'S QUESTIONS ARE DIFFERENT and several of those same rows are the
// substance of their hand-off: which gate decided and where it sits in the
// order, what read the request and how confident it was, the provenance of a
// cited list, the drafted summary they are being asked to check. So the rule is
// ROUTE, NOT DELETE — `specialistDetail()` keeps the row on the ticket and
// takes it off the requester's screen. Only a row nobody needs is removed.
//
// THE DEFAULT IS "EVERYONE", DELIBERATELY, and it is the opposite default from
// OPS_ONLY_DETAILS above. A new row that reaches the requester when it need not
// is noise they can skip; a new row hidden from them is a fact nobody outside
// this repository ever sees. test/portalRequesterFacts.test.js is what stops
// that default becoming an excuse: it drives every quick-fill on all seven
// forms and fails when a requester-facing row carries vocabulary an employee
// has no use for, so a new row goes to the wrong audience LOUDLY.
const FOR_SPECIALIST = "specialist";

/** One labelled line in the result panel. Values are stringified for textContent. */
function detail(label, value) {
  return { label, value: value === null || value === undefined ? "—" : String(value) };
}

/**
 * A line for the SPECIALIST'S ticket, and not for the requester's screen.
 *
 * Identical to detail() but tagged, so buildTicketNote() prints it and
 * forRequester() drops it. Never used for a statement of a LIMIT or an ABSENCE
 * that changes what the requester should do — an employee acting on a false
 * completeness is worse off than one reading an extra line, so "no date was
 * given", "this was not checked" and "nobody has confirmed this" stay on both.
 */
function specialistDetail(label, value) {
  return { ...detail(label, value), audience: FOR_SPECIALIST };
}

/**
 * The rows the person who filed the request actually sees.
 *
 * Applied ONCE, at the response boundary, AFTER the ticket has been raised —
 * so the specialist's note is built from the full array and cannot be thinned
 * by a change made for the requester's benefit. Written here rather than in
 * seven adapters for the same reason recordIntakeRefusal() and the access gate
 * are: a use case added later is covered by existing, not by being remembered.
 *
 * It also drops OPS_ONLY_DETAILS, which the ticket note already routes to its
 * own operators' section. "Narrative faithfulness: not_evaluated" — this
 * system checking its own drafted prose against the facts it was drafted from —
 * was moved off a specialist's ticket months ago and was still being printed to
 * the employee, which is one reader further from anyone who could use it.
 *
 * The `audience` key is stripped rather than shipped: the browser has no use
 * for it and a field on the wire is a field somebody eventually branches on.
 */
function forRequester(details) {
  if (!Array.isArray(details)) return details;
  return details
    .filter((row) => row && row.audience !== FOR_SPECIALIST && !OPS_ONLY_DETAILS.has(row.label))
    .map(({ audience, ...row }) => row);
}

function listOrNone(items) {
  return Array.isArray(items) && items.length ? items.join(", ") : "none";
}

/**
 * An identifier, spelled the way it would be read aloud.
 *
 * Several values that ARE for the requester arrive as constants — a relocation
 * type (`permanent_relocation`), a seniority verdict (`REQUIRES_LEGAL_REVIEW`),
 * a cost component (`eorTransferFee`). Each of them is a real finding the
 * person reading it needs; only its SPELLING is machinery, and the spelling is
 * this layer's business rather than the calculators'.
 *
 * PRESENTATION ONLY, AND ONLY HERE. The stores, the audit rows, the dossiers
 * and every gate keep the constant untouched — this is applied at the moment of
 * rendering, exactly as `countryLabel()` is, and for the same reason: two
 * spellings of one fact must never both be able to travel.
 *
 * IT DOES NOT TRANSLATE. `permanent_relocation` becomes "permanent relocation"
 * and nothing more; a value this makes no clearer stays visibly as itself
 * rather than being dressed up in a word nobody chose. A value that is not
 * identifier-shaped comes back untouched, so a sentence passed through it is
 * not mangled — the same pass-through rule src/shared/countryNames.js follows.
 */
function words(value) {
  const text = String(value ?? "").trim();
  if (!text) return text;
  if (/\s/.test(text)) return text;
  const split = text
    .replace(/_/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .trim();
  // A camelCase source splits into words that were never meant to be capital —
  // `eorTransferFee` would otherwise read "eor Transfer Fee", which looks like
  // a typo rather than a phrase. A source that STARTED upper case
  // (`REQUIRES_LEGAL_REVIEW`) keeps its case: it is a verdict, and shouting it
  // is what the calculator meant.
  return /^[a-z]/.test(text) ? split.toLowerCase() : split;
}

/**
 * The cost calculator answers either a CALCULATED estimate with a known total
 * and a list of components still awaiting a quote, or an honestly INCOMPLETE
 * one when no salary was supplied. Both are reported as they are — a missing
 * quote is never silently rendered as zero.
 */
/**
 * Seniority continuity, with the date it turns on. Reports the gate's own
 * verdict and adds nothing: a PRESERVED status whose date was never supplied
 * says so in words rather than showing a bare "PRESERVED" over a silent null.
 */
function seniorityLine(seniority) {
  if (!seniority) return "not evaluated";
  // `words()` on the status only: `REQUIRES_LEGAL_REVIEW` is a finding the
  // person being relocated needs and an identifier is not how it should be
  // spelled to them. The dossier keeps the constant.
  const status = words(seniority.status);
  if (seniority.seniorityDate) return `${status} from ${seniority.seniorityDate}`;
  return `${status} — ${seniority.reason ?? "no date established"}`;
}

/**
 * The cost line a Mobility Legal specialist reads.
 *
 * It used to be `${knownTotalDisplay} known over ${months} months`, and
 * `knownTotalDisplay` is a ONE-MONTH figure — the components list carries the
 * management fee at its monthly value. The portal's own seeded "Portugal →
 * Netherlands" scenario therefore printed "7,800.00 EUR known over 12 months"
 * for an engagement whose twelve-month management fee is 93,600.00 EUR. The
 * smaller number, with the larger period's label on it: not a rounding error
 * but a twelvefold understatement of the thing the dossier exists to inform.
 *
 * Now it leads with the term total and shows the monthly rate beside it, so
 * neither number can be read as the other. Both come from the estimate; this
 * function derives nothing.
 */
function costLine(estimate) {
  if (!estimate) return "not estimated";
  if (estimate.status !== "CALCULATED") return `${estimate.status} — ${estimate.reason ?? "insufficient input"}`;
  // `eorTransferFee, mobilityFee` are the calculator's own FIELD NAMES, and they
  // were being printed to the person the relocation is about. The fact — that
  // these components have no quote yet, so the total below is not the whole
  // cost — is exactly what they need; the camel case is not. See words().
  const pending = estimate.pendingQuotes?.length
    ? `, awaiting quotes for: ${estimate.pendingQuotes.map(words).join(", ")}`
    : "";
  // A null total is an absence, never a zero — see the INCOMPLETE branch of
  // src/uc07/costCalculator.js for why those fields are nullable at all.
  if (!estimate.knownTermTotalDisplay) return `no derivable total${pending}`;
  return `${estimate.knownTermTotalDisplay} known over ${estimate.months} months (${estimate.knownTotalDisplay} in month 1)${pending}`;
}

/** The judge is informational everywhere it runs; absence is an explicit state. */
/**
 * WHICH Remote request this decision is attached to, in the requester's words.
 *
 * Reads `result.remoteRequest`, which src/uc04/workflow.js composes and puts in
 * the audit row — never re-derived here. Three states, and the split between
 * the last two is the whole point: Remote answering "no such request" is an
 * ANSWER and changes nothing about the decision, while being unable to
 * establish which request is a FAILURE, and the verdict stays untransmitted
 * rather than being PATCHed onto a request nobody identified.
 */
function remoteRequestLine(result) {
  const link = result.remoteRequest;
  if (!link) return "not looked up for this decision";
  if (link.linked && link.id) return `${link.id} — this decision will be recorded against it at Remote`;
  // THE SENTENCE ONLY. `link.reason` used to be appended in brackets —
  // `(no_pending_work_authorization_request)` — restating in an identifier what
  // the sentence has just said in words. It is still published, beside this
  // row, as a specialistDetail: it is the string somebody greps `audit_log` by,
  // which is a specialist's use and not a traveller's.
  return link.detail;
}

function faithfulnessOf(faithfulness) {
  if (!faithfulness) return "not evaluated";
  return faithfulness.reason ? `${faithfulness.verdict} — ${faithfulness.reason}` : faithfulness.verdict;
}

/**
 * Translate the portal's LLM-override names into the dependency names the
 * target workflow expects, skipping any that were not supplied so the real
 * default stays in place. Keeps the CLI/tests naming every seam
 * unambiguously (`classifyExpense` vs `classifyTravel`) while each workflow
 * still receives its own documented parameter name.
 */
function pick(llm, mapping) {
  const deps = {};
  for (const [ours, theirs] of Object.entries(mapping)) {
    if (typeof llm[ours] === "function") deps[theirs] = llm[ours];
  }
  return deps;
}

function assign(target, key, value) {
  if (value !== undefined) target[key] = value;
}

function textOf(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/**
 * WHAT THE TRAVELLER STATED ABOUT THEIR OWN TRIP — the four optional boxes on
 * the UC-03 form (docs/TRAVEL-LETTER-INPUTS.md §6), carried through to the
 * ticket as `ticket.stated` and nothing else.
 *
 * IT NORMALISES AND IT DOES NOT DECIDE. Four named members, each a trimmed
 * string or null; anything else the body carried is dropped, so a caller
 * cannot smuggle a fifth field into the ticket through this door. There is no
 * date arithmetic here, no country check, no comparison against what the
 * classifier read: this function's whole job is to make "they did not say"
 * (null) distinguishable from "they said nothing" (""), which is the
 * distinction the rest of this repository keeps paying for when it is lost.
 * Whether a stated value is USED, and which one wins where the two disagree,
 * belongs to src/uc03/ — the gates, not the intake.
 *
 * EXPORTED for the same reason buildTravelHistory() and buildPresencePeriods()
 * are: the rule about what a blank means is the thing worth pinning, and a
 * test that had to drive an HTTP request to reach it would be testing the
 * route instead.
 *
 * ALWAYS AN OBJECT, never null, so a downstream reader has one shape to read
 * and no branch to forget. A body with no `stated` at all — every non-browser
 * caller, and this page before these boxes existed — yields four nulls, which
 * is the same thing as not having stated anything.
 */
export function buildStatedTrip(raw) {
  const source = raw && typeof raw === "object" ? raw : {};
  return {
    destinationCountry: textOf(source.destinationCountry),
    startDate: textOf(source.startDate),
    endDate: textOf(source.endDate),
    addressee: textOf(source.addressee),
  };
}

// ---------------------------------------------------------------------------
// Plumbing (identical in shape to every other server in this repo)
// ---------------------------------------------------------------------------

/**
 * Make the page work at a path prefix as well as at the root.
 *
 * The deployment mounts this portal under `/portal`, so `/app.js` — an
 * absolute URL — would leave the browser asking the deployment's router for a
 * use case named "app.js". Every asset and fetch in the page is therefore
 * RELATIVE, and one injected `<base>` decides what they are relative TO.
 *
 * A base tag rather than a redirect to `/portal/` on purpose: relative URLs
 * resolved against `/portal` (no trailing slash) would drop the prefix, and
 * whether a rewrite preserves a trailing slash is exactly the sort of platform
 * detail this deployment has already been bitten by twice (deploy/cx-apis/README.md
 * §2). With a base tag the page is correct at both spellings and there is
 * nothing to preserve.
 *
 * @param {string} html
 * @param {string} prefix  "" locally, "/portal" on the deployment
 */
export function withBaseHref(html, prefix) {
  if (!prefix) return html;
  return html.replace("<head>", `<head>\n<base href="${prefix}/" />`);
}

function isPath(parts, expected) {
  return expected.every((segment, i) => parts[i] === segment);
}


function send(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

/**
 * Start the portal on `port`. Returns the http.Server once listening.
 * The port is passed in — never defaulted to a literal here (src/shared/ports.js
 * is the only place a port number is written down).
 */
export function startPortalServer(deps, port) {
  const server = createServer(createPortalHandler(deps));
  return new Promise((resolve) => server.listen(port, () => resolve(server)));
}
