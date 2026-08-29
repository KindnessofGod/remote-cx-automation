// ---------------------------------------------------------------------------
// server.js  —  L-12: the third-party consent door's HTTP API
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
// UC-01's G-3 consent regime (VC-06/VC-07/VC-08) needs an entry point for the
// side that has always been missing: a stranger — a bank, a landlord, a
// screening vendor — asking Remote to confirm somebody's employment. Every
// other surface in this repo authenticates a persona first (src/portal/'s
// resolvePersona(), src/remoteui/'s session map); this one deliberately does
// not, because the whole point of the channel is that the person on the
// other side is NOT authenticated. `qa/HUMAN-DECISIONS-REQUIRED.md`'s `G3`
// answer names this shape explicitly: "the third-party door is its own
// surface rather than a persona on the existing one... a free-text compose
// box... the real channel is a mailbox, and a bank's verification request is
// prose written by someone with no knowledge of our schema."
//
// THE ONE INVARIANT THIS FILE EXISTS TO HOLD (invariant 14, VC-33)
// The existence of a person is itself a disclosure. A request about (a) a
// real employee with no consent yet, (b) a real employee who declined, and
// (c) a person who does not exist at Remote at all MUST be indistinguishable
// from outside — same wording, same status code, same shape, no timing
// signal. The obvious way to write this handler — branch on what
// `handleVerificationTicket()` decided, and reply accordingly — is exactly
// the failure mode VC-33 was written to catch: "the criterion most likely to
// be satisfied on paper and violated in fact... every natural implementation
// returns early on 'no such record'."
//
// So this handler is built the other way round. `THIRD_PARTY_ACK_MESSAGE` is
// a CONSTANT with no parameters — not a function of the decision, not a
// function of whether the employment resolved, not a function of whether an
// error was thrown. It is impossible for a branch to select it, because
// nothing here branches to produce it: every code path that reaches a
// response reads the identical literal. That is the "structural" proof
// Amendment 3 to VC-33 asks for, preferred over a sampled timing comparison
// because it is a proof rather than a sample. The real workflow still runs in
// full underneath (classification, the Remote read, the consent lookup, the
// case/audit rows) — this file changes nothing about what UC-01 decides, only
// what a THIRD PARTY is ever shown of it.
//
// WHAT THIS FILE DELIBERATELY DOES NOT DO
//   - It authenticates nobody, and offers no persona picker. That absence is
//     the design, not an oversight — see the header above.
//   - It re-implements no gate. Every decision, case row, consent artifact and
//     audit row comes from the real `handleVerificationTicket()`
//     (src/uc01/workflow.js); this file's own logic is limited to shaping the
//     form fields into a ticket and returning one fixed sentence.
//   - It never reveals `result.decision`, `result.reason`, `result.flags`,
//     employment facts, or anything read from Remote. Nothing computed by the
//     workflow reaches the HTTP response at all.
//
// D-25/D-28 (rca-87ee) ADDED TWO MORE FIELDS TO THE RESPONSE SHAPE, AND
// NEITHER WEAKENS THE ABOVE. `reference` (POST /api/requests) is a random id
// THIS DOOR minted before any lookup ran — a property of the submission, not
// of what was found — returned unconditionally on every path so an enquirer
// can quote it later; it carries no employment fact. The evidence-attach
// route (POST /api/requests/:reference/evidence) answers the same fixed ack
// on every call, whether or not `:reference` resolves to anything, for the
// identical reason: a lookup miss must read exactly like a lookup hit.
//
// R7-23 (rca-n5x8) ADDED A THIRD ROUTE for the same reason, generalised: an
// enquirer with a reference and something to say — no authorisation to
// attach, just a follow-up — had nowhere at all to say it (the evidence
// route above is specifically for "I have written authorisation", and
// misfiling a plain status chase there would misrepresent what they hold).
// POST /api/requests/:reference/followup records the message durably, keyed by
// the reference, and returns the same fixed ack every time.
//
// R7-49 SPLIT THAT ROUTE'S "NO LOOKUP" RULE INTO ITS TWO HALVES, BECAUSE ONLY
// ONE OF THEM WAS EVER ABOUT VC-33. The route originally performed no lookup at
// all, which kept the RESPONSE safe and left the ROW unattributable: an
// unauthenticated stranger could post any reference they liked — including a
// real one — and `audit_log` gained a `third_party_followup_received` row
// against a genuine case that read exactly like an enquirer's own message. The
// rate limiter bounds how MANY of those a caller can write; nothing bounded
// WHAT they could be keyed to, and `/audit` is the screen an operator uses to
// reconstruct a case. So the route now DOES resolve the reference — and the
// result reaches the stored row (`details.referenceResolved`) and nothing else.
// The response stays a constant selected by no branch, which is the invariant;
// "performs no lookup" never was.
// ---------------------------------------------------------------------------

import { createServer } from "node:http";
import { randomUUID, createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { handleVerificationTicket } from "../uc01/workflow.js";
import { classifyRequest } from "../uc01/classifier.js";
import {
  consume as consumeRateLimit,
  callerAddress,
  createMemoryRateLimitStore,
  RATE_LIMITED_CODE,
  RATE_LIMITED_MESSAGE,
} from "./rateLimit.js";
import { readJsonBody } from "../shared/httpBody.js";
import { claimExternalRef, findClaimDecision } from "../shared/workflowClaims.js";
import { stripHtmlComments, stripJsComments } from "../shared/stripBuildComments.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const ASSETS = {
  "/": { file: "index.html", type: "text/html; charset=utf-8" },
  "/app.js": { file: "app.js", type: "application/javascript; charset=utf-8" },
  "/style.css": { file: "style.css", type: "text/css; charset=utf-8" },
  "/remote-ui.css": {
    file: "remote-ui.css",
    dir: join(__dirname, "..", "shared", "ui"),
    type: "text/css; charset=utf-8",
  },
};

/**
 * THE ONE SENTENCE A THIRD PARTY EVER READS FROM THIS DOOR.
 *
 * A constant, not a template and not a function of anything computed above
 * it — see the file header. It OPENS word-for-word identically to
 * `src/uc01/refusalCopy.js`'s `awaiting_employee_consent`/`consent_refused`
 * entry (VC-33's requirement that the wording never differ between "not yet
 * answered" and "declined" extends here to "never resolved at all" and "an
 * internal error occurred" — a fourth case Amendment 3 requires be tested
 * with the other three) — but it is NOT byte-identical to it: this door
 * appends one further sentence, "We can't share anything further about this
 * request here," which belongs to this channel alone (refusalCopy.js's
 * entry is read by the requester's own ticket note, not by an unauthenticated
 * caller with nowhere else to look). Neither channel leaks anything the other
 * does not, and each is internally uniform across all four of its own cases —
 * that is what VC-33 requires, not that the two channels read as one string.
 */
export const THIRD_PARTY_ACK_MESSAGE =
  "Thanks for getting in touch. We can't disclose employment details to an outside party without the employee's own permission, so we've made a note of this request. If we're able to confirm anything, you'll hear from us. We can't share anything further about this request here.";

/**
 * D-28 (rca-87ee): THE ANSWER TO "I ALREADY HAVE THEIR WRITTEN
 * AUTHORISATION — WHERE DO I PUT IT?"
 *
 * Same VC-33 discipline as THIRD_PARTY_ACK_MESSAGE above and for the same
 * reason: whether `:reference` in the URL resolves to a real submission, a
 * mistyped one, or nothing at all must never change what this route says
 * back. A constant, sent unconditionally — see the evidence route below,
 * which performs its lookup/write in a swallowed try/catch and never lets
 * the outcome reach this string.
 */
export const EVIDENCE_ACK_MESSAGE =
  "Thanks — we've noted that you have the employee's written authorisation and attached what you sent us to the original request. It will be reviewed alongside it. We can't share anything further about this request here.";

/**
 * R7-23 (rca-n5x8): THE ANSWER TO "I HAVE A REFERENCE — WHERE DO I QUOTE
 * IT?"
 *
 * `THIRD_PARTY_ACK_MESSAGE` tells every enquirer to "write to us again about
 * this request", but until this route existed nowhere on the page — or in
 * this API — accepted a previously-issued reference for anything other than
 * evidence of the employee's written authorisation (the `/evidence` route
 * above). An enquirer chasing a deadline with nothing to attach had no
 * surface at all: revisiting the page served the same blank intake form.
 *
 * Same VC-33 discipline as the two acks above: whether `:reference` names a
 * real submission, a mistyped one, or nothing at all cannot be observed from
 * the response. The route DOES resolve it (R7-49 — see the file header and the
 * route's own comment), but only so the STORED ROW can say which it was; the
 * outcome never reaches this constant, which is returned unconditionally.
 */
/**
 * The answer to "is there a letter for me yet?" when there is not one — and it
 * is a CONSTANT for the same reason THIRD_PARTY_ACK_MESSAGE is.
 *
 * OWNER DECISION 2026-08-28: the letter must reach the third party on this
 * page. That is a deliberate, stated narrowing of VC-33 and it is worth being
 * precise about what it does and does not give up.
 *
 * WHAT IS GIVEN UP: an enquirer who holds a reference can now tell "a
 * specialist approved this disclosure to me" from "anything else". That is the
 * point — a disclosure a human deliberately authorised to this party is not a
 * secret from this party.
 *
 * WHAT IS NOT GIVEN UP, and what keeps the invariant's substance:
 *   - Only the holder of the `randomUUID()` this door minted can ask at all.
 *     It is a capability, not a lookup key: nothing about an employment, a
 *     name or a date of birth reaches this route.
 *   - EVERY other state answers with the constant below — pending consent,
 *     consent refused, a specialist who declined, a reference that names
 *     nothing, and a person Remote has never heard of are all one answer.
 *     "Declined" and "does not exist" remain indistinguishable, which was
 *     always the load-bearing half.
 *   - Nothing automatic ever flips this. The gate is the EXISTENCE of a letter
 *     document, and a letter document exists only where a named specialist
 *     approved in the sidebar (review/service.js). No policy path, no
 *     classifier, and no consent grant on its own can produce one.
 */
export const NO_LETTER_YET_MESSAGE =
  "We don't have anything to share about this request yet. If there's a response for you, it will appear here.";

export const FOLLOWUP_ACK_MESSAGE =
  "Thanks — we've added your message to the original request. It will be reviewed alongside it. We can't share anything further about this request here.";

/**
 * @param {object} deps
 * @param {import("../remote/restClient.js").RemoteClient} deps.remote
 * @param {import("../shared/audit.js").AuditLogger} deps.audit
 * @param {import("../shared/caseStore.js").CaseStore} deps.caseStore
 * @param {typeof classifyRequest} [deps.classify]
 * @param {import("../zendesk/restClient.js").ZendeskClient} [deps.zendesk]
 *   rca-52q / E3-F9. Optional, like every other Zendesk seam in this repo —
 *   when supplied, a `human_review`/`escalate` outcome (consent GRANTED, or
 *   granted-but-inactive) raises a real, pre-tagged Zendesk ticket for a
 *   specialist (src/uc01/workflow.js STEP 8's third-party branch). Without
 *   it the decision is still made, recorded and audited exactly as before —
 *   only the hand-off does not happen, the same "durable either way" rule
 *   every other Zendesk seam in this project follows. NEVER read by
 *   anything this handler returns to the caller — see the file header:
 *   nothing about the outcome may reach the response, and that includes
 *   whether a ticket was raised for it.
 * @param {string} [deps.basePath]  the mount prefix on the deployment
 *   ("/thirdparty"); "" for `npm run thirdparty`. See withBaseHref() below —
 *   this is F-1: the page's own HTML asked the browser for root-absolute
 *   assets, which 404 under any prefix, because nothing ever told it one
 *   might exist.
 */
export function createThirdPartyDoorHandler({
  remote,
  audit,
  caseStore,
  classify = classifyRequest,
  zendesk,
  basePath = "",
  demoSubject = null,
  // The ceiling on this deliberately-unauthenticated door. Defaults to an
  // in-memory counter, which is right for `npm run thirdparty` and for tests
  // and is WORTH NOTHING on the serverless deployment, where every invocation
  // is a fresh process — so deploy/cx-apis/deps.js passes the Postgres-backed
  // one. See rateLimit.js's header for why it fails closed, and for why this
  // cannot become a VC-33 side channel.
  rateLimitStore = createMemoryRateLimitStore(),
  rateLimits = {},
}) {
  const prefix = String(basePath || "").replace(/\/+$/, "");

  return async function handle(req, res) {
    const url = new URL(req.url, "http://localhost");
    const parts = url.pathname.split("/").filter(Boolean);

    try {
      // ---- the ceiling, before anything else -----------------------------
      // FIRST statement of the request, ahead of body parsing, every shape
      // check and every lookup. Two reasons, and the second is the load-bearing
      // one:
      //   - it bounds ALL the work a caller can cause, not just the paid part;
      //   - it runs before the door knows ANYTHING about who exists, so its
      //     refusal cannot vary with the answer. A limiter consulted after the
      //     lookup would be a VC-33 side channel; this one has no access to the
      //     information it would need to become one.
      // GET is exempt: the page and its assets are static files, and throttling
      // a stylesheet would break the page for a visitor who has submitted
      // nothing.
      if (req.method === "POST") {
        const verdict = await consumeRateLimit({
          store: rateLimitStore,
          address: callerAddress(req),
          limits: rateLimits,
        });
        if (!verdict.allowed) {
          res.setHeader("Retry-After", String(verdict.retryAfterSeconds || 60));
          return send(res, 503, {
            ok: false,
            code: RATE_LIMITED_CODE,
            reason: RATE_LIMITED_MESSAGE,
          });
        }
      }

      if (req.method === "GET" && ASSETS[url.pathname]) {
        const asset = ASSETS[url.pathname];
        const body = readFileSync(join(asset.dir ?? join(__dirname, "assets"), asset.file));
        res.statusCode = 200;
        res.setHeader("Content-Type", asset.type);
        // rca-b7rr / R7-10: this door is unauthenticated by design (see the
        // file header), so a developer comment naming a defect id or a
        // src/ path is a straight leak of internal detail to any stranger
        // who reads view-source. Stripped at serve time — the source files
        // keep their comments for the next developer reading the code.
        if (asset.file === "index.html") {
          return res.end(withBaseHref(stripHtmlComments(body.toString("utf8")), prefix));
        }
        if (asset.file === "app.js") {
          return res.end(stripJsComments(body.toString("utf8")));
        }
        return res.end(body);
      }

      // GET /api/example — the reference and name the page's quick-fills use.
      //
      // WHY THE SERVER OWNS THIS AND THE BROWSER DOES NOT. The two copies of
      // this door talk to two different Remotes: `npm run thirdparty` runs
      // against the in-process mock (src/thirdparty/cli.js), and the mounted
      // copy on the deployment reads the live Sandbox. A reference hardcoded
      // in app.js therefore resolves on exactly one of them and 404s on the
      // other — which, because every outcome returns the identical
      // acknowledgement (VC-33), would be COMPLETELY INVISIBLE from the page.
      // A demo that silently stopped reaching a real record is the failure
      // this route exists to prevent. Same rule the portal's own /api/context
      // follows: the browser holds no copy of a fact the server owns.
      //
      // IT IS NOT A LOOKUP, AND STRUCTURALLY CANNOT BECOME ONE. It returns a
      // value this handler was CONSTRUCTED with and touches `remote` not at
      // all — there is no id in the request to resolve, so it cannot be
      // pointed at a person, and it discloses nothing about anybody it was
      // not already configured to name. Absent configuration it answers
      // `{demo: null}` and the quick-fills simply leave the reference blank,
      // which is the correct posture for a real deployment: a production door
      // has no demo subject and should offer none.
      if (req.method === "GET" && isPath(parts, ["api", "example"]) && parts.length === 2) {
        return send(res, 200, {
          demo: demoSubject
            ? { employmentReference: demoSubject.employmentReference, subjectName: demoSubject.subjectName }
            : null,
        });
      }

      // POST /api/requests — the third party's ask.
      if (req.method === "POST" && isPath(parts, ["api", "requests"]) && parts.length === 2) {
        const body = await readJsonBody(req);

        // FORM VALIDATION IS NOT A DISCLOSURE. Refusing an EMPTY field is a
        // statement about the form, not about any employment record — it is
        // reached identically whether or not the fields, once filled, would
        // resolve to a real person. This is the one 400 this route may ever
        // return, and it is checked BEFORE anything about a specific
        // employment is looked at.
        const submittingParty = textOf(body.requestingParty);
        const purpose = textOf(body.purpose);
        const employmentReference = textOf(body.employmentReference);
        const message = textOf(body.message);
        // WHOSE EMPLOYMENT IS THIS ABOUT? Added 2026-08-28, and its absence
        // was the largest gap on this form. Reported by the project owner
        // ("should they not be including the employee's name?") and then
        // confirmed against every canonical verification form there is:
        // Fannie Mae 1005 item 7 "Name and Address of Applicant", VA 26-8497
        // item 2, the Dutch NHG model werkgeversverklaring, Experian Verify
        // ("Employee Full Name" — required), Truework, and university/employer
        // HR policies. Remote's OWN standard letter prints the employee's full
        // name as its first line. There is no verification form anywhere that
        // omits it, and this one did.
        //
        // WHAT IT IS FOR, AND THE LINE THAT MUST NOT BE CROSSED. The name is
        // how a specialist knows WHOSE PERMISSION TO GO AND ASK — Remote's own
        // published posture is that it answers a third party "after receiving
        // permission from you (the employee)" (support.remote.com 19201215338509).
        // It is NEVER used to answer the requester, and it is never a lookup
        // key: this door does not resolve a person by name, because "does
        // anyone called X work for you" is precisely the question VC-33 exists
        // to refuse. It reaches the hand-off note and nothing else.
        //
        // IT IS A CLAIM, NOT A FACT. Everything in this field was typed by an
        // unauthenticated stranger. The hand-off note labels it as what the
        // enquirer asserted, never as something Remote holds.
        const subjectName = textOf(body.subjectName);
        if (!submittingParty || !purpose || !employmentReference || !message || !subjectName) {
          return send(res, 400, {
            ok: false,
            code: "all_fields_required",
            reason:
              "Name who you are, whose employment this is about, what this is for, the employment reference you were given, and what you need confirmed.",
          });
        }
        // SHAPE ONLY, and deliberately permissive — same discipline as the
        // reference check below. A name is not `[A-Za-z ]+`: it carries
        // apostrophes, hyphens, and every script Unicode has. The only thing
        // refused is something too short to be a name at all, and the refusal
        // is reached identically whether or not the name would resolve to
        // anybody, so it discloses nothing. Length is capped because this
        // string is rendered into a Zendesk note, not because a long name is
        // suspicious.
        if (message.length > FREE_TEXT_MAX_LENGTH) {
          return send(res, 400, {
            ok: false,
            code: "message_too_long",
            reason: `Keep the request under ${FREE_TEXT_MAX_LENGTH} characters. Tell us what you need confirmed; supporting documents can follow.`,
          });
        }
        if (subjectName.length < SUBJECT_NAME_MIN_LENGTH || subjectName.length > SUBJECT_NAME_MAX_LENGTH) {
          return send(res, 400, {
            ok: false,
            code: "subject_name_malformed",
            reason: `Give the full legal name of the person this is about (between ${SUBJECT_NAME_MIN_LENGTH} and ${SUBJECT_NAME_MAX_LENGTH} characters).`,
          });
        }

        // DATE OF BIRTH — THE DISAMBIGUATOR, and the reason a name alone was
        // never going to be enough. "There could be a hundred Alex Ocumbos"
        // is the entire problem this field exists to solve, and it is the
        // problem every real verification system solves the same way: with
        // one further fact THE SUBJECT THEMSELF supplied.
        //
        // WHY DATE OF BIRTH AND NOT A NATIONAL ID. In the United States the
        // answer would be the Social Security Number — Experian Verify
        // requires the full SSN, The Work Number keys on SSN plus an employer
        // code and does not require the name at all, and employers receiving
        // these ask for the last four. We deliberately do NOT collect one,
        // and the form says so. Those services key on SSN because they ARE
        // credentialed consumer reporting agencies under the FCRA, with a
        // permissible-purpose regime and audited verifier accounts behind
        // them. An unauthenticated public web page is the opposite of that,
        // and a box on it asking strangers for national ID numbers is a
        // phishing target that would collect more risk than it resolves.
        //
        // Date of birth is what the rest of the world uses instead, and it is
        // not a compromise: the Dutch NHG model werkgeversverklaring — the
        // standard employer's statement for a mortgage — identifies the
        // employee by name, address, DATE OF BIRTH, start date and position,
        // and carries no BSN at all. Truework asks for it alongside the SSN
        // rather than instead of it. Name plus date of birth plus the
        // employee's own Remote Employee ID is three facts, all of which the
        // applicant supplied to the bank themselves.
        //
        // IT IS NEVER MATCHED. Like the name, this goes to the specialist as
        // a claim and to nothing else. This door resolves an employment by
        // the Employee ID and by nothing else.
        const subjectDateOfBirth = textOf(body.subjectDateOfBirth);
        if (!subjectDateOfBirth) {
          return send(res, 400, {
            ok: false,
            code: "subject_date_of_birth_required",
            reason:
              "Give the date of birth the person gave you. A name on its own cannot identify anybody — there may be many people with the same one.",
          });
        }
        // SHAPE ONLY, and it must stay that way. A plausibility check on the
        // date (an age range, say) would be a statement about who could
        // possibly be employed, evaluated before any record is read — which
        // is a rule about people, not about the form. This refuses `2026-13-45`
        // and accepts anything a browser date input can produce.
        if (!ISO_DATE_SHAPE.test(subjectDateOfBirth) || Number.isNaN(Date.parse(subjectDateOfBirth))) {
          return send(res, 400, {
            ok: false,
            code: "subject_date_of_birth_malformed",
            reason: "Give the date of birth as a date (YYYY-MM-DD).",
          });
        }

        // WHAT THE APPLICANT TOLD THE BANK — optional, and the shape of the
        // whole transaction rather than an extra.
        //
        // A verification request is NEVER "does anyone called X work for
        // you?" It is "your employee told us these facts; confirm them."
        // Fannie Mae's Form 1005 is built this way — the lender fills in what
        // the applicant declared and the employer ticks it off — and the
        // HomeLet tenant-referencing form is explicit that the applicant
        // declares position, salary, hours and start date so the employer can
        // "verify the information about my earnings, dates of employment and
        // previous tenancy term". The requester discovers none of it; the
        // employee supplies it and it travels employee -> bank -> employer.
        //
        // So this field carries the claim being checked. Optional because an
        // enquirer may genuinely have only the name and the id, and refusing
        // them would help nobody.
        const subjectClaimedStartDate = textOf(body.subjectClaimedStartDate);
        if (subjectClaimedStartDate && (!ISO_DATE_SHAPE.test(subjectClaimedStartDate) || Number.isNaN(Date.parse(subjectClaimedStartDate)))) {
          return send(res, 400, {
            ok: false,
            code: "subject_claimed_start_date_malformed",
            reason: "Give the start date they told you as a date (YYYY-MM-DD), or leave it blank.",
          });
        }

        // R7-45: OPTIONAL SEVENTH FIELD — a screening/referencing agency
        // submitting for a client (a bank, a landlord) rather than on its own
        // account. Folded into a single `requestingParty` string here, at the
        // door, rather than threaded as its own field through consent
        // scoping/audit/letter rendering downstream: `findConsentArtifact()`'s
        // match (`matchesParty()`, src/shared/caseStore.js) and the intake
        // idempotency key below both treat `requestingParty` as one opaque
        // string, and everything that reads it back (the consent prompt, the
        // audit trail, VC-30's scoping) already works correctly as long as
        // that string is stable and human-readable — which composing it once,
        // here, gives them for free. Without this an enquirer had no field for
        // the relationship at all and improvised by hand-annotating the
        // organization field instead (R7-45's evidence).
        const actingOnBehalfOf = textOf(body.actingOnBehalfOf);
        const requestingParty = actingOnBehalfOf
          ? `${submittingParty} (acting on behalf of ${actingOnBehalfOf})`
          : submittingParty;

        // D-27: `employmentReference` is checked for FORM SHAPE ONLY — long
        // enough to plausibly be a reference at all — same discipline as the
        // four-field check above and never a lookup against anything Remote
        // holds. This refusal is reached identically whether or not the
        // finished string would resolve to a real employment, so it is not a
        // disclosure: it fires on "x" exactly as it would on a well-formed but
        // fabricated reference.
        // SHAPE, NOT EXISTENCE — and it is a security control as well as a
        // usability one. This value is passed to RemoteClient.getEmployment(),
        // which builds a URL path from it. Before the sink was encoded, a
        // reference like "aaaaaa/../../../v1/companies?page_size=100" walked
        // out of /v1/employments and reached another Remote endpoint carrying
        // this deployment's bearer token — from a door that is deliberately
        // unauthenticated (VC-33). The sink is fixed too; this refuses it
        // earlier, and refuses identically whether or not the string would
        // have resolved, so it discloses nothing.
        if (!/^[A-Za-z0-9_-]+$/.test(employmentReference)) {
          return send(res, 400, {
            ok: false,
            code: "employment_reference_malformed",
            reason:
              "That doesn't look like an employment reference — they are letters, digits, hyphens and underscores only. Check what the person gave you and try again.",
          });
        }
        if (employmentReference.length < EMPLOYMENT_REFERENCE_MIN_LENGTH) {
          return send(res, 400, {
            ok: false,
            code: "employment_reference_too_short",
            reason: `That doesn't look like a complete employment reference — check what the person gave you and try again (at least ${EMPLOYMENT_REFERENCE_MIN_LENGTH} characters).`,
          });
        }

        // THE FIFTH FIELD, VALIDATED SEPARATELY AND DISTINGUISHABLY (F1).
        //
        // A return address is identity-adjacent — it is how the notification
        // path (src/thirdparty/agedNotice.js, L-19/VC-32) reaches back out
        // once the ageing window passes — so an absent one and an unreadable
        // one fail closed with DIFFERENT reasons: "you gave us nothing to
        // write back to" is a different problem for the caller to fix than
        // "what you gave us doesn't look like an address". Both are still
        // FORM validation, checked before anything about a specific
        // employment is looked at, so neither is a disclosure — same
        // discipline as the four-field check above, just not folded into it,
        // because collapsing the two would erase the distinction this finding
        // exists to require.
        const returnAddress = textOf(body.returnAddress);
        if (!returnAddress) {
          return send(res, 400, {
            ok: false,
            code: "return_address_required",
            reason: "Give us a way to reach you — we cannot follow up on a request with nowhere to send the answer.",
          });
        }
        if (!EMAIL_SHAPE.test(returnAddress)) {
          return send(res, 400, {
            ok: false,
            code: "return_address_unreadable",
            reason: "That doesn't look like an email address we could write back to.",
          });
        }

        // D-28: THE SIXTH FIELD, OPTIONAL. An enquirer who already holds the
        // employee's written authorisation can say so right here rather than
        // coming back later through POST /api/requests/:reference/evidence.
        // Validated only if supplied — it is genuinely optional, so a blank
        // value is not a form error, but a non-blank one too short to be
        // useful is (same discipline as employmentReference above: shape,
        // never a lookup).
        const consentEvidence = textOf(body.consentEvidence);
        if (consentEvidence && consentEvidence.length < EVIDENCE_MIN_LENGTH) {
          return send(res, 400, {
            ok: false,
            code: "evidence_too_short",
            reason: `Say a little more about what you hold and where we can verify it (at least ${EVIDENCE_MIN_LENGTH} characters), or leave this blank.`,
          });
        }

        // D-25: MINTED HERE, BEFORE ANY LOOKUP RUNS, AND RETURNED ON EVERY
        // PATH BELOW — found, not-found, and the internal-error catch just
        // below. That ordering
        // is what keeps returning it safe under VC-33: the reference is a
        // property of THIS SUBMISSION (a random, unguessable id this door
        // handed out), never a property of what the lookup underneath it
        // found, so handing it back discloses nothing about any employment —
        // only "we received a request; here is what to call it if you write
        // back." A durable, real Remote/case/audit trail already existed
        // behind this value (src/uc01/workflow.js writes it onto the case and
        // audit details); it was simply never given to the one party who
        // caused it. It is returned as its OWN response field (`reference`),
        // never folded into `message` — `THIRD_PARTY_ACK_MESSAGE` stays the
        // fixed literal src/surfaceverify/surfaces/browser.js's #result-message
        // check expects.
        // `let`, not `const`: the intake-window join below may rebind this to the
        // reference the FIRST submission was given, so a re-decided enquiry keeps
        // the reference the enquirer already holds (D-25).
        let reference = randomUUID();
        // What the WORKFLOW claims. Identical to `reference` on a first
        // submission; diverges only when a granted consent reopens a joined
        // enquiry — see the join branch below.
        let workflowRef = reference;

        // D-26: AN IDEMPOTENCY KEY DERIVED FROM THE INTAKE ITSELF, NOT A
        // FRESH RANDOM ID PER SUBMISSION.
        //
        // Until now `reference` above doubled as the ONLY identity this
        // submission had, and it is a per-call `randomUUID()` — the OPPOSITE
        // of an idempotency key: it guarantees a resubmission gets a
        // DIFFERENT identity, so two submissions of the same enquiry always
        // became two rows. Production hit this twice in one hour: the button
        // sat disabled for 8.3-13.1s with no progress signal, the enquirer
        // assumed it had hung, and "Quayside Property Group" / "Tenancy
        // referencing" / one employment was filed twice, 50.8 seconds apart.
        //
        // `intakeKey` is content-derived (employment reference + requesting
        // party + purpose, normalised) and claimed through the SAME
        // `workflow_claims` PRIMARY KEY every other use case's exactly-once
        // guarantee rests on (`claimExternalRef()`'s own header: "THE
        // GUARANTEE IS THE PRIMARY KEY, NOT THIS CODE") — a check-then-act
        // here would have exactly the race that caused the original bug.
        //
        // Bucketed into a window rather than claimed forever: this door has
        // no ticket id to key against, and a permanent key would silently
        // fold a genuinely new future enquiry that happens to reuse the same
        // wording (the same bank re-verifying the same employee next year,
        // say) into a year-old row — a dropped request wearing a "handled"
        // costume. An hour comfortably covers "assumed it had hung and
        // immediately resubmitted" while leaving a later, distinct enquiry
        // free to proceed. The accepted edge case is a resubmission landing
        // just after the bucket boundary, which degrades to two rows
        // (visible, recoverable) rather than the request vanishing — the
        // direction CLAUDE.md §4 states this repository prefers.
        const intakeKey = deriveThirdPartyIntakeKey({ employmentReference, requestingParty, purpose });
        const intakeClaim = await claimExternalRef({
          pgPool: caseStore.pgPool ?? null,
          useCase: "UC-01",
          externalRef: intakeKey,
          decision: reference,
        });

        if (!intakeClaim.claimed) {
          // MAKE THE SECOND SUBMISSION SAFE, NOT MERELY DISCOURAGED (D-26
          // item 3). No second call to `handleVerificationTicket()` — no
          // second case, no second consent row, no second audit row. Join
          // the reference the FIRST submission was given (recorded as
          // `decision` on the winning claim row precisely so a later
          // duplicate can recover it) rather than minting a new one that
          // would resolve to nothing, which would break D-25's promise that
          // every returned reference names a real case.
          const joinedReference =
            (await findClaimDecision({ pgPool: caseStore.pgPool ?? null, useCase: "UC-01", externalRef: intakeKey })) ??
            reference;

          // Evidence offered on this resubmission still lands on the ONE row
          // this enquiry has — the same swallowed, VC-33-safe attach logic
          // the standalone endpoint below uses.
          if (consentEvidence) {
            await attachThirdPartyEvidence({ caseStore, reference: joinedReference, evidenceReference: consentEvidence });
          }

          // THE ONE THING THAT REOPENS A JOINED ENQUIRY: the employee has
          // since said yes.
          //
          // The window exists to absorb an impatient enquirer who assumed the
          // button had hung (D-26) — two submissions of the SAME question
          // deserve one answer. But once consent is granted the question is no
          // longer the same one: the first submission was answered
          // `awaiting_employee_consent` because nobody had decided, and
          // somebody now has. Joining here would strand a granted consent for
          // up to an hour with nothing to advance it, since the follow-up
          // route deliberately re-decides nothing and the grant itself raises
          // no ticket (uc01/workflow.js STEP 8 excludes that state on purpose
          // — the employee owns it, not a specialist).
          //
          // Re-run under the JOINED reference, never a new one, so the
          // reference the enquirer already holds stays the one that resolves
          // (D-25) and the letter they collect hangs off the case this run
          // produces. `findByDoorReference()` takes the newest match, which is
          // that case.
          const consentNowGranted = await thirdPartyConsentGranted({
            caseStore,
            reference: joinedReference,
          });
          if (!consentNowGranted) {
            // `duplicate: true` is a fact about THIS DOOR'S OWN submission
            // history, never about what any lookup found — it is decided
            // entirely above, before `handleVerificationTicket()` would even
            // run, so it carries no employment fact and does not weaken VC-33.
            return send(res, 200, { ok: true, message: THIRD_PARTY_ACK_MESSAGE, reference: joinedReference, duplicate: true });
          }
          // The enquirer keeps their reference; the WORKFLOW gets a fresh one.
          // `handleVerificationTicket()` claims its `externalRef` before the
          // first durable write (exactly-once), and the first run already
          // claimed `joinedReference` — so re-running under it is refused as a
          // duplicate delivery and writes nothing at all. That is exactly what
          // happened on the deployment: the reopen fired, returned the right
          // reference, and produced no decision and no ticket.
          reference = joinedReference;
          workflowRef = randomUUID();
        }

        // EVERYTHING BELOW THIS LINE RUNS THE SAME WAY REGARDLESS OF WHAT IT
        // FINDS. `handleVerificationTicket()` is awaited; its result is
        // discarded into a variable this handler never reads from again. An
        // internal error is caught and treated exactly like a normal
        // completion — Amendment 3's "fourth case", tested alongside the
        // other three in test/thirdPartyDoor.test.js.
        try {
          // REMOTE'S OWN EMPLOYEE ID, RESOLVED TO THE RECORD IT NAMES.
          //
          // The question this answers is the one nobody had asked: what can a
          // bank actually HOLD? Not `2f7f8210-91fc-47db-803c-77a1cc625781` —
          // no employee reads a UUID down a phone. Remote publishes a
          // six-character "Employee ID" to every employee, in their own
          // profile under Job and Pay (support.remote.com 20120956060941),
          // and that is the thing that gets written on a form and handed
          // over. The API exposes it as `short_id`; `?short_id=` resolves it
          // exactly (measured live 2026-08-28 — 112 employments, 112 distinct
          // codes, exact-match filter).
          //
          // A UUID STILL WORKS. This only fires for something SHAPED like a
          // short id, and falls through to the original value otherwise, so
          // an enquirer holding either one is served. Resolution failure is
          // not an error and is not reported: an unresolvable code simply
          // stays as it is and fails to find an employment further down,
          // which is the same place a wrong UUID fails. That symmetry is the
          // point — "no such code", "no such employment" and "found, but no
          // consent" must be indistinguishable from outside (VC-33), and the
          // whole block below is already swallowed for exactly that reason.
          let resolvedEmploymentId = employmentReference;
          if (/^[A-Za-z0-9]{6}$/.test(employmentReference) && typeof remote?.findEmploymentByShortId === "function") {
            try {
              const found = await remote.findEmploymentByShortId(employmentReference);
              if (found?.id) resolvedEmploymentId = found.id;
            } catch {
              // Deliberately silent, and NOT merely defensive: a thrown
              // lookup that changed the outward answer would make an
              // unreachable Remote distinguishable from a code that does not
              // exist, which is a disclosure by side channel.
            }
          }

          const outcome = await handleVerificationTicket(
            {
              text: message,
              session: null,
              // The enquirer's reference, which survives a re-decide even when
              // `externalRef` below does not.
              doorReference: reference,
              employmentId: resolvedEmploymentId,
              requestingParty,
              subjectName,
              subjectDateOfBirth,
              subjectClaimedStartDate,
              purpose,
              returnAddress,
              source: "third_party_door",
              externalRef: workflowRef,
            },
            { remote, audit, caseStore, classify, zendesk }
          );
          // OPERATOR VISIBILITY ONLY — never the response, and never anything
          // the caller can observe. REPORTED 2026-08-28: a submission appeared
          // to vanish, because the caller is told a fixed constant (VC-33) and
          // the console said nothing either, so "waiting on the employee" and
          // "the server threw" looked identical from the outside AND from the
          // inside. The failure sibling below has logged to this same stream
          // since the door shipped; this is the success case catching up.
          //
          // It reads `outcome` but cannot reach the response: the acknowledgement
          // was decided before this ran and is a literal constant no branch can
          // select. `test/thirdPartyDoor.test.js` pins that separately.
          console.log(
            `[thirdparty] ${outcome?.decision ?? "unknown"} / ${outcome?.reason ?? "unknown"}` +
              (outcome?.decision === "awaiting_employee_consent"
                ? " — consent recorded as PENDING; the employee, not a specialist, answers this." +
                  " No hand-off ticket is created for this state, by design (workflow.js STEP 8)."
                : "") +
              (zendesk ? "" : " — no Zendesk client wired, so no hand-off ticket can be created.")
          );
        } catch (err) {
          // Logged for an operator to find via the Live Feed/server logs —
          // never surfaced to the caller. See the file header: an internal
          // error must not produce an outward response different from a
          // successful lookup that found nothing.
          console.error(`[thirdparty] handleVerificationTicket failed: ${err?.stack ?? err}`);
        }

        // D-28: if evidence was offered on this same form, attach it now that
        // the case exists (the ordering L-9 requires — "the case must exist
        // first"). Uses the SAME `reference` just minted above, and the same
        // swallowed, VC-33-safe attach logic the standalone endpoint below
        // uses — whether this succeeds, finds nothing, or throws changes
        // nothing about the response already decided above.
        if (consentEvidence) {
          await attachThirdPartyEvidence({ caseStore, reference, evidenceReference: consentEvidence });
        }

        return send(res, 200, { ok: true, message: THIRD_PARTY_ACK_MESSAGE, reference });
      }

      // POST /api/requests/:reference/evidence — D-28: "I already have their
      // written authorisation — where do I put it?" A SECOND step against an
      // EXISTING submission, never a field on the first one: consent_records
      // rows FK to cases.id NOT NULL (src/shared/caseStore.js), so the case
      // this evidence attaches to has to exist before this route can attach
      // anything to it — the same ordering L-9 imposed on the pending row
      // `handleVerificationTicket()` writes itself. This is for an enquirer
      // who obtains the authorisation AFTER their original submission — one
      // who already has it in hand when they first write in can say so on
      // the same form (the optional `consentEvidence` field above), which
      // calls this exact same internal logic once its own case exists.
      if (req.method === "POST" && isPath(parts, ["api", "requests"]) && parts.length === 4 && parts[3] === "evidence") {
        const reference = textOf(decodeURIComponent(parts[2]));
        const body = await readJsonBody(req);
        const evidenceReference = textOf(body.evidenceReference);

        // FORM VALIDATION, same discipline as the fields above: reached
        // identically whether or not `reference` turns out to name anything.
        if (!reference || !evidenceReference) {
          return send(res, 400, {
            ok: false,
            code: "evidence_required",
            reason: "Give us the reference from your original request and describe (or link to) the written authorisation you hold.",
          });
        }
        if (evidenceReference.length < EVIDENCE_MIN_LENGTH) {
          return send(res, 400, {
            ok: false,
            code: "evidence_too_short",
            reason: `Say a little more about what you hold and where we can verify it (at least ${EVIDENCE_MIN_LENGTH} characters).`,
          });
        }

        // EVERYTHING BELOW RUNS THE SAME WAY REGARDLESS OF WHAT IT FINDS —
        // identical discipline to the submission route above, and for the
        // identical reason (VC-33): whether `reference` matches a real prior
        // submission, a mistyped one, or nothing at all must never be
        // observable from the response. A miss is not an error here — it is
        // caught inside attachThirdPartyEvidence() the same as a genuine one.
        await attachThirdPartyEvidence({ caseStore, reference, evidenceReference });

        return send(res, 200, { ok: true, message: EVIDENCE_ACK_MESSAGE });
      }

      // POST /api/requests/:reference/followup — R7-23: a general "I'm
      // writing to you again about this request" surface, for an enquirer
      // with nothing to attach — just a reference and something to say
      // (a deadline, a correction, "any update?"). Deliberately NOT folded
      // into the /evidence route above: that route's `evidenceReference`
      // sets a consent_records row to `asserted` (a claim of holding written
      // authorisation), which a plain status chase is not, and misfiling one
      // as the other would misrepresent what the enquirer actually has.
      // -------------------------------------------------------------------
      // GET /api/requests/:reference/letter — the approved disclosure, to the
      // party it was approved for. See NO_LETTER_YET_MESSAGE's header for the
      // exact scope of the VC-33 narrowing this implements.
      // -------------------------------------------------------------------
      if (req.method === "GET" && isPath(parts, ["api", "requests"]) && parts.length === 4 && parts[3] === "letter") {
        const reference = textOf(decodeURIComponent(parts[2]));
        // Shape-checked before it reaches any store, exactly as the intake
        // reference is: this value comes from an unauthenticated stranger and
        // a permissive lookup key is a place to probe.
        if (!reference || !UUID_SHAPE.test(reference)) {
          return send(res, 200, { ok: true, ready: false, message: NO_LETTER_YET_MESSAGE });
        }

        let letter = null;
        try {
          const caseRow =
            typeof caseStore.findByDoorReference === "function"
              ? await caseStore.findByDoorReference(reference)
              : null;
          if (caseRow && typeof caseStore.findLetterForCase === "function") {
            letter = await caseStore.findLetterForCase(caseRow.id);
          }
        } catch (err) {
          // SWALLOWED, and the response below is unchanged. A store that
          // throws must not become a way to tell a real reference from an
          // invented one — the same reasoning as the short-id lookup above.
          console.error(`[thirdparty] letter lookup failed: ${err?.stack ?? err}`);
        }

        if (!letter?.content) {
          return send(res, 200, { ok: true, ready: false, message: NO_LETTER_YET_MESSAGE });
        }
        return send(res, 200, {
          ok: true,
          ready: true,
          // The hash travels with it so the recipient can quote it, and so a
          // forwarded copy can be checked against the `documents` row that
          // proves which specialist issued it.
          contentHash: letter.contentHash ?? null,
          issuedAt: letter.createdAt ?? null,
          letterHtml: letter.content,
        });
      }

      if (req.method === "POST" && isPath(parts, ["api", "requests"]) && parts.length === 4 && parts[3] === "followup") {
        const reference = textOf(decodeURIComponent(parts[2]));
        const body = await readJsonBody(req);
        const message = textOf(body.message);

        // FORM VALIDATION, same discipline as every field above: reached
        // identically whether or not `reference` turns out to name anything.
        if (!reference || !message) {
          return send(res, 400, {
            ok: false,
            code: "followup_message_required",
            reason: "Give us the reference from your original request and what you'd like to add.",
          });
        }
        if (message.length > FREE_TEXT_MAX_LENGTH) {
          return send(res, 400, {
            ok: false,
            code: "message_too_long",
            reason: `Keep the message under ${FREE_TEXT_MAX_LENGTH} characters.`,
          });
        }
        if (message.length < FOLLOWUP_MIN_LENGTH) {
          return send(res, 400, {
            ok: false,
            code: "followup_too_short",
            reason: `Say a little more about what you'd like to add (at least ${FOLLOWUP_MIN_LENGTH} characters).`,
          });
        }

        // THE LOOKUP RESULT REACHES THE DATABASE AND NEVER THE RESPONSE.
        //
        // This route used to perform no lookup at all, and the row it wrote
        // said only "somebody sent a follow-up about REF". Since the route is
        // unauthenticated and `:reference` is whatever the caller typed, that
        // made `audit_log` writable by any stranger AGAINST ANY REFERENCE THEY
        // CHOSE — including a genuine one read off a real case. The rate
        // limiter bounds the COST of that; it does nothing about the
        // CONTENT. `/audit` is the screen an operator reads to reconstruct
        // what happened to a case, so a planted row keyed to a real
        // externalRef sits in a real case's trail looking exactly like a
        // genuine enquirer's message, and nothing on the screen can separate
        // the two. That is audit-trail pollution, and the fix is not to refuse
        // the write (see below) but to make the row SAY WHICH IT IS.
        //
        // WHY NOT SIMPLY REFUSE AN UNRESOLVABLE REFERENCE: because the refusal
        // would be the disclosure. A 404 here — or any response that differed
        // — would answer "does this reference exist?" for an unauthenticated
        // caller, which is the same question VC-33 forbids one step removed
        // (a door reference is minted per submission, so "this reference is
        // real" is "a request about somebody was accepted"). The response
        // below is therefore unchanged and unchangeable: `FOLLOWUP_ACK_MESSAGE`
        // is a literal constant, `send()` is called once, on a line no branch
        // guards, and nothing computed here is passed to it.
        //
        // THREE VALUES, NEVER TWO. `referenceResolved` is true / false /
        // null, and null (the store could not answer) is deliberately NOT
        // folded into false — the same rule ticketFacts.js states for Zendesk
        // reads and the gate ladder states for `not_reached`: "we looked and
        // found nothing" and "we could not look" send a reader to two
        // different places, and collapsing them would let one database blip
        // relabel every genuine follow-up in that window as planted.
        const resolution = await resolveFollowupReference({ caseStore, reference });

        audit.log({
          useCase: "UC-01",
          action: "third_party_followup_received",
          actor: "unauthenticated",
          // Keyed by the SAME `details.externalRef` every other UC-01 audit row
          // for this submission carries (src/uc01/workflow.js), so a specialist
          // working the real case finds it in the same audit trail.
          details: {
            externalRef: reference,
            message,
            referenceResolved: resolution.resolved,
            // Present only when it resolved — a null here would be a fourth
            // way of saying what `referenceResolved` already says, and two
            // fields restating one fact drift. When present it is the case a
            // reader should open, so the row is not merely labelled but
            // followable.
            ...(resolution.caseId ? { caseId: resolution.caseId } : {}),
          },
        });

        return send(res, 200, { ok: true, message: FOLLOWUP_ACK_MESSAGE });
      }

      return send(res, 404, { ok: false, code: "no_such_route" });
    } catch (err) {
      // Even the CATCH-ALL must not distinguish "we broke" from "we
      // declined" to an outside caller of this specific route — but a
      // genuinely malformed request (e.g. unparseable JSON, handled by
      // readJsonBody) is a client-request problem, not an employment-record
      // question, so it is safe to answer distinctly from the ack above.
      console.error(`[thirdparty] unexpected error: ${err?.stack ?? err}`);
      return send(res, 500, { ok: false, code: "internal_error" });
    }
  };
}

function textOf(v) {
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
}

/**
 * D-26: THE INTAKE-DERIVED IDEMPOTENCY KEY.
 *
 * Same material an enquirer already typed — employment reference, requesting
 * party, purpose — normalised (trim + lowercase) and hashed, the same
 * discipline `deriveReceiptFingerprint()` (src/uc02/workflow.js) uses so a
 * receipt filed twice server-side dedupes on the record's own fields rather
 * than on a caller-suppliable flag. `message`/`returnAddress`/`consentEvidence`
 * are deliberately EXCLUDED: an enquirer re-typing their message slightly on
 * a resubmit is still the same enquiry, and requiring byte-identical prose
 * would make the join miss the exact case it exists to catch.
 *
 * Bucketed by time (see the call site's comment for why this is a window and
 * not a permanent key). The join separator is the escape `\u0000`, never a
 * literal NUL byte, for the same reason `deriveReceiptFingerprint()` writes
 * it that way: a raw control character in source survives most diffs as
 * "binary" and silently changes every derived key on one editor round-trip.
 *
 * @param {object} args
 * @param {string} args.employmentReference
 * @param {string} args.requestingParty
 * @param {string} args.purpose
 * @returns {string}
 */
function deriveThirdPartyIntakeKey({ employmentReference, requestingParty, purpose }) {
  const material = [employmentReference, requestingParty, purpose]
    .map((v) => String(v ?? "").trim().toLowerCase())
    .join("\u0000");
  const fingerprint = createHash("sha256").update(material).digest("hex").slice(0, 32);
  // ZERO DISABLES JOINING. A unique suffix means no two submissions ever share
  // a key, so `claimExternalRef()` always claims cleanly and every enquiry is
  // its own. Done here rather than by branching at the call site so there is
  // exactly one place that decides what "the same enquiry" means.
  if (INTAKE_DUPLICATE_WINDOW_MS === 0) return `intake:${fingerprint}:${randomUUID()}`;
  const bucket = Math.floor(Date.now() / INTAKE_DUPLICATE_WINDOW_MS);
  return `intake:${fingerprint}:${bucket}`;
}

/**
 * D-26's duplicate-submission window — CONFIGURABLE, and two minutes by default.
 *
 * REVISED 2026-08-28 (owner: "if I test this entire system a hundred times, it
 * should work a hundred times"). It was an hour, and an hour was never what the
 * evidence supported. The incident it exists for is recorded at the call site
 * and is precise: the button sat disabled for 8.3-13.1s with no progress
 * signal, the enquirer assumed it had hung, and the same enquiry was filed
 * twice **50.8 seconds apart**. An hour is seventy times that. Everything
 * between about two minutes and an hour was buying nothing and blocking a
 * legitimate second enquiry — including every repeat of a test or a demo.
 *
 * Two minutes covers the measured case with more than double the margin.
 *
 * `THIRD_PARTY_INTAKE_WINDOW_MS=0` disables joining entirely: every submission
 * becomes its own enquiry. That is the right setting for a demo or a test
 * environment and the wrong one for production, which is why zero is opt-in
 * rather than the default — the failure it protects against is a duplicate
 * consent request sent to a real employee about a real disclosure.
 */
/** Two minutes — see readIntakeWindowMs()'s header for why, and why not an hour. */
export const CORRECT_INTAKE_WINDOW_MS = 2 * 60 * 1000;

// RESTORED 2026-08-29. Between 2026-08-28 and this date the default was 20
// seconds, lowered so the demo could be rehearsed without a re-run being joined
// to the previous one. That window did NOT cover the duplicate this guard
// exists for — measured at 50.8 seconds apart — so while it stood the
// deployment could file a duplicate enquiry, meaning a real employee could
// receive two consent requests for one disclosure. It is back to the correct
// value; `THIRD_PARTY_INTAKE_WINDOW_MS` is the knob for a demo environment, so
// nobody has to weaken the shipped default again.
export const DEFAULT_INTAKE_WINDOW_MS = CORRECT_INTAKE_WINDOW_MS;

const INTAKE_DUPLICATE_WINDOW_MS = readIntakeWindowMs(process.env);

/**
 * Parse the window from the environment, failing to the SAFE default on
 * anything unusable. A typo (`"2m"`, `"abc"`) must not silently disable
 * de-duplication — that would turn a misconfiguration into duplicate
 * disclosures, which is the one direction this must never fail in. Zero is the
 * single value that disables it, and it has to be written exactly.
 *
 * @param {Record<string, string|undefined>} env
 */
export function readIntakeWindowMs(env = process.env) {
  const raw = env?.THIRD_PARTY_INTAKE_WINDOW_MS;
  if (raw === undefined || String(raw).trim() === "") return DEFAULT_INTAKE_WINDOW_MS;
  const parsed = Number(String(raw).trim());
  if (!Number.isFinite(parsed) || parsed < 0) return DEFAULT_INTAKE_WINDOW_MS;
  return Math.floor(parsed);
}


/**
 * D-28 (rca-87ee) — attach a third party's claimed evidence of the employee's
 * written authorisation to the case their `reference` names, if one exists.
 * Shared by the inline `consentEvidence` field on the main submission and the
 * standalone `POST /api/requests/:reference/evidence` follow-up route, so the
 * two ways an enquirer can supply evidence (right away, or after they obtain
 * it) run through exactly one lookup/write path rather than two that could
 * drift.
 *
 * EVERYTHING HERE IS SWALLOWED, ON PURPOSE. Whether `reference` names a real
 * case, a mistyped one, or nothing at all must never be observable from the
 * caller's side (VC-33) — both call sites reply with the same fixed message
 * regardless, so this function has no return value for either to branch on.
 *
 * `requestingParty`/`purpose` are read OFF the found case's OWN stored
 * `classification` — never re-collected from the caller — because
 * `findConsentArtifact()`'s match is trim+lowercase EXACT STRING EQUALITY
 * (`matchesParty()`, src/shared/caseStore.js): a re-typed or re-worded value
 * would silently fail to join to the pending row `handleVerificationTicket()`
 * already created, and the failure would be indistinguishable from "no
 * consent was ever asked about" — the exact trap this bead's dispatch note
 * names.
 *
 * @param {object} args
 * @param {import("../shared/caseStore.js").CaseStore} args.caseStore
 * @param {string} args.reference        the externalRef the door minted
 * @param {string} args.evidenceReference  what the enquirer says they hold
 */
/**
 * Has the employee granted consent since this enquiry was first answered?
 *
 * Consulted at exactly ONE place — the intake-window join — to decide whether a
 * resubmission is the same question again (join it) or a question whose answer
 * has changed (re-decide it). It never reaches the caller: both branches return
 * byte-identical bodies, so this cannot become a way to ask "did they consent?"
 * by watching the response.
 *
 * Fails CLOSED to joining. A throw, a missing store method, or a case that
 * cannot be found all mean "no", which reproduces exactly the old behaviour —
 * the safe direction, because a wrongly-joined request is visible and
 * recoverable (the enquirer asks again next hour) while a wrongly re-run one
 * would duplicate a decision.
 */
export async function thirdPartyConsentGranted({ caseStore, reference }) {
  try {
    const caseRow =
      typeof caseStore.findByDoorReference === "function" ? await caseStore.findByDoorReference(reference) : null;
    // Only an enquiry that STOPPED for consent can be reopened by consent.
    if (!caseRow || caseRow.decision !== "awaiting_employee_consent") return false;
    if (typeof caseStore.findConsentArtifact !== "function") return false;
    const cls = caseRow.classification || {};
    const artifact = await caseStore.findConsentArtifact({
      employmentId: caseRow.employmentId,
      requestingParty: cls.requestingParty ?? null,
      purpose: cls.purpose ?? null,
      // Scoped to THIS enquiry, matching the gate. Asking the broader question
      // here would reopen an enquiry on the strength of a consent granted for
      // a different one — and the gate would then refuse it anyway, which is
      // the worst combination: work done, ticket raised, disclosure declined.
      enquiryReference: cls.doorReference ?? caseRow.externalRef ?? null,
    });
    return artifact?.status === "granted";
  } catch {
    return false;
  }
}

/**
 * R7-49 — DOES THIS FOLLOW-UP NAME A REAL ENQUIRY? An answer for the AUDIT ROW,
 * and for nothing else.
 *
 * Read the follow-up route's own comment for why this exists (audit-trail
 * pollution: an unauthenticated caller could key a durable row to any reference
 * they chose) and why it cannot be a refusal instead (the refusal would answer
 * "does this reference exist?", which is VC-33's question one step removed).
 * What matters here are three properties:
 *
 *   1. IT HAS NO RETURN VALUE THE RESPONSE CAN USE. Its result is spread into
 *      `details` and read by nothing else in the request. `send()` is called on
 *      one unguarded line with a literal constant, exactly as before, so the
 *      byte-for-byte response is the same for every caller — the same
 *      structural proof the file header prefers over a sampled comparison.
 *   2. IT RUNS UNCONDITIONALLY, on every reference that passed form validation.
 *      No shape gate in front of it: a gate would give a well-formed reference
 *      and a nonsense one two different amounts of work, and the store read is
 *      parameterised and cheap enough not to need one. A resolving reference
 *      and a non-resolving one therefore take the identical path and differ
 *      only in whether a row came back.
 *   3. IT USES findByDoorReference(), NOT findByExternalRef(). That lookup is
 *      scoped to `source = 'third_party_door'` on purpose (see its header): a
 *      caller quoting a guessable Zendesk ticket id must not be able to make
 *      this row say `referenceResolved: true` about a case that has nothing to
 *      do with this door.
 *
 * FAILS TO `null`, NEVER TO `false`. A store that throws, or one with no such
 * method, means "we could not look" — and labelling a genuine follow-up as
 * unresolved because the database blinked would poison the trail in the other
 * direction, which is the same defect wearing the opposite sign.
 *
 * @param {object} args
 * @param {import("../shared/caseStore.js").CaseStore} args.caseStore
 * @param {string} args.reference
 * @returns {Promise<{resolved: boolean|null, caseId: string|null}>}
 */
export async function resolveFollowupReference({ caseStore, reference }) {
  try {
    if (typeof caseStore?.findByDoorReference !== "function") return { resolved: null, caseId: null };
    const caseRow = await caseStore.findByDoorReference(reference);
    return caseRow ? { resolved: true, caseId: caseRow.id ?? null } : { resolved: false, caseId: null };
  } catch (err) {
    // Logged for an operator, swallowed for the caller — same rule as every
    // other store touch on this door.
    console.error(`[thirdparty] follow-up reference resolution failed: ${err?.stack ?? err}`);
    return { resolved: null, caseId: null };
  }
}

async function attachThirdPartyEvidence({ caseStore, reference, evidenceReference }) {
  try {
    const caseRow =
      typeof caseStore.findByExternalRef === "function" ? await caseStore.findByExternalRef(reference, "UC-01") : null;
    if (!caseRow || caseRow.source !== "third_party_door") return;

    const cls = caseRow.classification || {};
    const existing =
      typeof caseStore.findConsentArtifact === "function"
        ? await caseStore.findConsentArtifact({
            employmentId: caseRow.employmentId,
            requestingParty: cls.requestingParty ?? null,
            purpose: cls.purpose ?? null,
          })
        : null;

    if (existing && existing.status !== "granted" && existing.status !== "denied") {
      // A row already exists (the pending one workflow.js created, or an
      // earlier "asserted" one) and the employee has not yet decided it
      // either way — attach the evidence to THAT row rather than creating a
      // second one findConsentArtifact() would then have to choose between.
      await caseStore.updateConsentDecision(existing.id, {
        status: "asserted",
        grantedByEmploymentId: null,
        grantedBySignal: "third_party_door_evidence",
        evidenceReference,
      });
    } else if (!existing && cls.requestingParty && cls.purpose && typeof caseStore.createConsentRecord === "function") {
      // No pending row exists at all — e.g. this decision never reached
      // `awaiting_employee_consent` (STEP 6c only creates one on that exact
      // outcome). Record the evidence anyway, scoped the same way, so a
      // specialist reading this case still finds it rather than the
      // assertion being silently dropped.
      caseStore.createConsentRecord({
        caseId: caseRow.id,
        consentType: "third_party_verification",
        status: "asserted",
        source: "third_party_door",
        evidenceReference,
        requestingParty: cls.requestingParty,
        purpose: cls.purpose,
      });
    }
    // `existing.status === "granted" | "denied"`: the employee already gave a
    // definitive answer. Left alone on purpose — evidence arriving after a
    // terminal decision does not reopen it.
  } catch (err) {
    console.error(`[thirdparty] evidence attach failed: ${err?.stack ?? err}`);
  }
}

/**
 * A deliberately loose shape check — this is a FORM validation ("does this
 * look like an address at all"), never a deliverability check, and never a
 * lookup against anything Remote holds. `unreadable` per F1 means exactly
 * this: not absent, but not shaped like an address either.
 */
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * D-27: the shortest a genuine employment reference could plausibly be.
 * Real ones observed in this repo's own fixtures are Remote employment UUIDs
 * (36 characters, e.g. `3537d9ee-2017-4a53-952e-9d3b042aeab5`) or this door's
 * own minted reference (also a UUID) — but a reference is opaque to Remote's
 * partner API by design (it is looked up, never parsed), so this is a floor
 * chosen to catch "x" and "asdf", not a claim about the one true format.
 * Deliberately loose for the same reason EMAIL_SHAPE is: shape, not identity.
 */
const EMPLOYMENT_REFERENCE_MIN_LENGTH = 6;

/**
 * FORM shape for the subject's name — never a check against anything Remote
 * holds. Two characters is the shortest real full name this refuses to rule
 * out; the ceiling exists because the value is rendered into a Zendesk note.
 */
const SUBJECT_NAME_MIN_LENGTH = 2;
const SUBJECT_NAME_MAX_LENGTH = 120;

/**
 * Upper bound on any free-text field a stranger can post to this door.
 *
 * THIS IS A COST AND ABUSE CONTROL, NOT A VALIDATION. The door is
 * unauthenticated by design (VC-33) and `message` is the one field that reaches
 * a REAL OpenAI call on the deployment, so before this cap a single anonymous
 * request could hand the classifier an unbounded amount of text — and the
 * deployment pays per token. There is no rate limit in front of it either
 * (see the note in the module header), so the cheapest bound available is a
 * bound on each individual request.
 *
 * It is enforced on SHAPE, before any lookup, exactly like the name check
 * above: the refusal is reached identically whether or not the reference would
 * resolve to anybody, so it discloses nothing about who exists.
 *
 * 4,000 characters is roughly two sides of A4. Nothing a bank needs to ask
 * about one person's employment comes close, and the longest genuine enquiry
 * in this repo's own fixtures is under 400.
 */
const FREE_TEXT_MAX_LENGTH = 4000;

/**
 * FORM shape for a date. Deliberately not a plausibility check — see the call
 * site: an age range would be a rule about who can be employed, applied before
 * any record is read.
 */
const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_DATE_SHAPE = /^\d{4}-\d{2}-\d{2}$/;

/** D-28: same FORM-shape-only discipline as EMPLOYMENT_REFERENCE_MIN_LENGTH. */
const EVIDENCE_MIN_LENGTH = 10;

/** R7-23: same FORM-shape-only discipline as EVIDENCE_MIN_LENGTH. */
const FOLLOWUP_MIN_LENGTH = 10;

/**
 * Make the page work at a path prefix as well as at the root.
 *
 * The deployment mounts this door under `/thirdparty`, so a root-absolute
 * `/app.js` leaves the browser asking the deployment's router for a use case
 * named "app.js" — F-1, found by actually loading the page in a browser
 * rather than curling the API route directly. Every asset and fetch in the
 * page is RELATIVE (index.html, app.js) and this injected `<base>` decides
 * what they are relative to. A base tag rather than a redirect to
 * `/thirdparty/`, for the same reason `src/portal/server.js`'s own
 * `withBaseHref()` gives: relative URLs resolved against `/thirdparty` (no
 * trailing slash) would drop the prefix, and whether a rewrite preserves a
 * trailing slash is a platform detail this deployment has already been
 * bitten by (deploy/cx-apis/README.md §2). With a base tag the page is
 * correct at both spellings.
 *
 * @param {string} html
 * @param {string} prefix  "" locally, "/thirdparty" on the deployment
 */
export function withBaseHref(html, prefix) {
  if (!prefix) return html;
  return html.replace("<head>", `<head>\n<base href="${prefix}/" />`);
}

function isPath(parts, expected) {
  if (parts.length < expected.length) return false;
  return expected.every((seg, i) => parts[i] === seg);
}

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

/** Start a standalone HTTP server — `npm run thirdparty`. */
export function startThirdPartyDoorServer(deps, port = 4048) {
  const handler = createThirdPartyDoorHandler(deps);
  const server = createServer(handler);
  return new Promise((resolve) => server.listen(port, () => resolve(server)));
}
