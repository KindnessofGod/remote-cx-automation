// ---------------------------------------------------------------------------
// workflow.js  —  UC-03 orchestration (this IS the n8n workflow, in code)
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
// Same structure as UC-01's workflow.js: this function runs the UC-03 steps
// in order, each corresponding to one node in the n8n version. Written as
// plain code first so the logic is testable; the same sequence gets rebuilt
// visually in n8n for the portfolio.
//
// The sequence (from docs/use-cases/UC-03.md §5):
//   1. classify the request (LLM seam) + parse the itinerary
//   2. fetch authoritative data: employment + supported-countries list
//   3. verify requester identity
//   4. run the deterministic policy gates (policyEngine.js — the thin router)
//   5. route:
//        auto_resolve  -> deterministic informational answer + disclaimer
//        human_review  -> formal Travel Letter DRAFTED, not issued, and ONLY
//                         when the reason is `formal_letter_requested` — the
//                         other two ways to reach human_review mean the router
//                         distrusted its own reading, and a letter drafted from
//                         that is not a letter anybody can sign (see STEP 5)
//        escalate      -> Global Mobility
//        route_to_uc04 -> normalized handoff event, recorded + tagged, NEVER a
//                         live UC-04 call (UC-04 owns its own compliance case),
//                         plus a per-run statement of which of UC-04's required
//                         inputs the event can and cannot carry (uc04Intake.js)
//   6. record the case (+ review queue for non-resolved, + document)
//   7. audit everything (immutable history)
//   8. close the loop on the real Zendesk ticket (if wired)
//
// THIS IS A THIN ROUTER, DELIBERATELY. UC-03 does not assess visa legality,
// tax residence, or Schengen stays — those belong to UC-04/UC-07/UC-08. UC-03
// answers simple informational questions, drafts (never issues) support
// letters behind a human gate, and hands work-authorization intent to UC-04
// with a clear event. Every fact in either artifact comes from authoritative
// Remote reads, never from the LLM.
// ---------------------------------------------------------------------------

import { classifyTravelInquiry } from "./classifier.js";
import { verifyRequester } from "../shared/identity.js";
import { evaluate, describeDecidingGate, describeGateLadder, describeDecisionFacts } from "./policyEngine.js";
import { formatFactsForNote } from "../shared/decisionFacts.js";
import { renderInformationalAnswer, renderTravelLetterHtml } from "./letter.js";
import { classifyRisk } from "../shared/riskEngine.js";
import { normalizeCountrySet } from "../shared/countryCodes.js";

import { claimExternalRef } from "../shared/workflowClaims.js";
import { describeUc04Intake } from "./uc04Intake.js";
import { assessLetterScope, summariseLetterScope, LETTER_SCOPE_EXCEEDED } from "./letterScope.js";
import { normalizeDecisionAction } from "../shared/declineVocabulary.js";
import { mergeStatedTrip } from "./statedTrip.js";
import { readCaseAttachments, documentOfType, findLetterCaseFor } from "./caseAttachments.js";
import {
  evaluateLetterSignoffAction,
  refuse as refuseSignoff,
  LETTER_DOCUMENT_TYPE,
} from "./signoffPolicy.js";
import {
  carryClassificationForward,
  describeLetterOffer,
  evaluateLetterOffer,
  letterClaimRef,
  refuseOffer,
} from "./letterOffer.js";

/**
 * The three outcomes a letter request can reach. Declared once so every place
 * that asks "did this decision involve a letter?" asks the same question — the
 * scope record, the queue note, the audit row and the returned result all did
 * it inline, and the set grew from two to three in this pass.
 */
const LETTER_REASONS = new Set([LETTER_SCOPE_EXCEEDED, "formal_letter_requested", "standard_letter_issued"]);

/** Initial `cases.status` for each policy decision — see caseStore.js. */
const INITIAL_STATUS_BY_DECISION = {
  auto_resolve: "resolved",
  human_review: "pending_review",
  escalate: "escalated",
  route_to_uc04: "routed",
};

const ZENDESK_TAG_BY_DECISION = {
  human_review: ["uc03_formal_letter_review"],
  escalate: ["uc03_escalated"],
  route_to_uc04: ["uc03_routed_uc04"],
};

/**
 * Build the normalized UC-03 -> UC-04 handoff event, shaped to the contract
 * in docs/research/UC-04 BUILDPACK v2.0 §2 ("UC-03 should ideally produce a
 * normalized event such as ..."). UC-04 is never CALLED from here — this event
 * is recorded in the audit log and returned so the routing decision is
 * inspectable, which is all UC-03 owns (see that same section: "This prevents
 * tight coupling between the two use cases").
 */
export function buildUc04HandoffEvent({ employment, classification, externalRef }) {
  return {
    event_type: "CROSS_BORDER_WORK_REQUESTED",
    source_use_case: "UC-03",
    employee_id: employment?.id ?? null,
    origin_country: employment?.country_code ?? null,
    destination_country: classification.destinationCountry,
    start_date: classification.startDate,
    end_date: classification.endDate,
    will_work_abroad: true,
    purpose: "temporary_remote_work",
    source_request_id: externalRef ?? null,
  };
}

/**
 * Handle one travel/workation inquiry end to end.
 * @param {object} ticket
 * @param {string} ticket.text            ticket body
 * @param {object|null} [ticket.session]  authenticated session ({authenticatedEmploymentId}) or null
 * @param {string} ticket.employmentId    which employee the request is ABOUT
 * @param {object|null} [ticket.stated]   WHAT THE TRAVELLER TYPED INTO FIELDS,
 *   when the surface that took the request offered any:
 *   `{destinationCountry: "DE"|null, startDate: "2026-09-20"|null,
 *     endDate: "2026-09-26"|null, addressee: "Spanish Consulate…"|null}`.
 *   Every one is optional and every one is an OVERRIDE of the classifier's
 *   reading of that field, never a new requirement — absent, `null`, `undefined`
 *   and `{}` all behave exactly as a request with no fields at all. A value that
 *   is not the shape it claims is treated as ABSENT and recorded as a problem,
 *   never coerced. See src/uc03/statedTrip.js.
 * @param {string} [ticket.source]        e.g. "zendesk" (default)
 * @param {string} [ticket.externalRef]   the Zendesk ticket id
 * @param {string} [ticket.claimRef]      THE DELIVERY this run's exactly-once
 *   claim is taken under, when that is not the ticket id. Defaults to
 *   `externalRef`, which is right for every inbound request. It differs in
 *   exactly one place: an accepted letter offer is a SECOND decision on the SAME
 *   ticket, and the ticket id was already claimed by the informational answer —
 *   claiming it again would be refused as a duplicate delivery and the letter
 *   would vanish silently. The ticket id still goes on the case row, because
 *   that is where the customer's conversation is; only the claim key differs.
 *   See src/uc03/letterOffer.js's header.
 * @param {string} [ticket.offerAcceptedFrom]  the auto-resolved case whose
 *   letter offer produced this request, when it came from one. Recorded on the
 *   decision's audit row so the two decisions about one trip are joinable from
 *   history alone.
 * @param {object} deps
 * @param {import("../remote/restClient.js").RemoteClient} deps.remote
 * @param {import("../shared/audit.js").AuditLogger} deps.audit
 * @param {import("../shared/caseStore.js").CaseStore} deps.caseStore
 * @param {import("../zendesk/restClient.js").ZendeskClient} [deps.zendesk] when supplied
 *   AND ticket.source === "zendesk" AND ticket.externalRef is set, the outcome is
 *   posted back to the real ticket. Optional — tests/demo/seeds never pass one,
 *   so nothing here ever calls a real Zendesk API by accident.
 * @param {typeof classifyTravelInquiry} [deps.classify] override the classifier
 *   (tests/demo inject classifyTravelInquiryRuleBased so they never depend on
 *   ambient OPENAI_API_KEY)
 * @returns {Promise<{decision:string, route?:string, informationalAnswer?:string,
 *   letterHtml?:string, flags:string[], reason:string, caseId:string,
 *   durationDays:number|null, classification:object, handoffEvent?:object}>}
 */
export async function handleTravelInquiry(
  ticket,
  { remote, audit, caseStore, zendesk = null, classify = classifyTravelInquiry, letterAutoIssue = true }
) {
  // STEP 1 — understand the request (the only LLM step in UC-03). The audit
  // logger is handed to the classifier so the LLM attempt itself is traceable
  // (§4 invariant 7); the trace has no parent row yet and is bound to this
  // decision by the audit.log() in STEP 7.
  const classified = await classify({ text: ticket.text }, { audit });

  // STEP 1b — WHAT THE TRAVELLER SAID THEMSELVES, over what was read from their
  // prose. `ticket.stated` carries the destination, the two dates and an
  // optional addressee when the surface that took the request offered them as
  // fields (the portal's UC-03 form). Absent, null and `{}` all return the
  // classification untouched, and no gate anywhere learns a new input: the merge
  // writes into the classification's own fields, so `evaluate()` decides on one
  // value per field exactly as it always has.
  //
  // AN OVERRIDE, NOT A PRECONDITION. Nothing filled in here can make a request
  // fail that would have succeeded empty — the archived employee still stops at
  // rung 2 with every box completed, because rung 2 asks about the employment
  // record and no form speaks to it. `statedTrip.js`'s header has the full
  // argument and `docs/TRAVEL-LETTER-INPUTS.md` §6.1/§6.2 the source.
  //
  // WHO SAID WHAT IS RECORDED, not implied. `statedTrip.provenance` marks each
  // field `requester_stated` / `classifier_read` / `absent`, and it rides on the
  // classification so it survives into `cases`, into the audit row, and through
  // `carryClassificationForward()` onto the decision that actually issues the
  // letter. A specialist reading a case — and anybody reading history — has to be
  // able to tell a fact the traveller asserted from one a model inferred.
  const { classification, statedTrip } = mergeStatedTrip(classified, ticket.stated);

  // STEP 2 — fetch authoritative data (never trust the ticket for facts). The
  // supported-countries list is a decision input (step 4 gate 6), so its read
  // failure PROPAGATES — a travel inquiry cannot be auto-answered if we can't
  // confirm the destination is supported (fail closed, same as UC-01's reads).
  // `getEmployment()` returns NULL on a 404 (RemoteClient's documented
  // convention) and that null is load-bearing, not an inconvenience: it is the
  // only thing that stops STEP 3 from "verifying" a caller's session against a
  // record derived from that same caller's request. NEVER default this to a
  // synthesized record with `id: ticket.employmentId` — that makes identity
  // compare a caller-supplied value with itself and report success. The n8n
  // port of this file did exactly that and had to be fixed; see
  // workflows/nodes-uc03/travelRouterGates.js and the fail-closed tests in
  // test/n8nUc03Parity.test.js / test/uc03.test.js.
  const employment = await remote.getEmployment(ticket.employmentId);
  // `listCountries()` used to coerce its own 404 to `[]`, so the failure this
  // comment claims to propagate did NOT propagate: only a 5xx threw, while a
  // 404 became an empty registry and every destination — Spain included —
  // escalated as `destination_jurisdiction_excluded`, a claim about the
  // destination's jurisdiction invented from an answer we never got. It now
  // returns null on an unreadable registry (the convention `getEmployment()`
  // and `listPayrollRuns()` already use), and that null is recorded here as an
  // upstream failure rather than re-flattened into an empty set one line later.
  const countries = await remote.listCountries();
  const upstreamFailures = [];
  if (!countries) {
    upstreamFailures.push({
      call: "countries",
      status: 404,
      kind: "not_found",
      message: "Remote returned no usable country registry",
    });
  }
  // ONE alpha-2 set, built once, and the ONLY thing the gate and the audit
  // record ever read (finding F-27). `listCountries()` already guarantees
  // alpha-2 or a dropped row; `normalizeCountrySet` is the belt-and-braces that
  // makes this line correct for ANY `remote` implementation a caller injects —
  // a test double, a future client — rather than correct only because of what
  // the real client happens to do today. It also drops nulls, so an
  // unplaceable row can never enter the set as an unmatched member.
  // `?? []` here is safe ONLY because the null is already carried in
  // `upstreamFailures` above: the empty set never gets to describe the world on
  // its own, because the gate consulting it escalates on the failure first.
  const supportedCountries = normalizeCountrySet((countries ?? []).map((c) => c.country_code));

  // STEP 3 — verify identity from the authenticated session (not a claimed
  // email), against the AUTHORITATIVE record fetched above — null when there
  // isn't one, which verifyRequester() answers with `no_employment_record`.
  const identity = verifyRequester({
    session: ticket.session ?? null,
    employment,
    requesterType: "self",
  });

  // STEP 3b — THE LETTERHEAD, read BEFORE the gates because a gate now decides
  // on it.
  //
  // It used to be read inside STEP 5, after the decision, and that was right
  // while the decision could not depend on it: a letter was always going to
  // stop for a signature, so an unreadable entity only decided whether there
  // was a draft for the signer to look at. It is not right any more. A standard
  // letter this system can write is now ISSUED by the gate; a standard letter
  // it cannot write must stop for a person. That is one decision with two
  // outcomes, and it belongs to `evaluate()` — establishing it afterwards would
  // mean the recorded reason named one rung while a later line changed the
  // result.
  //
  // READ ONLY WHEN A LETTER IS ACTUALLY ASKED FOR, and only when there is a
  // record to read an entity from. This is a skip, not a gate: it can only
  // avoid a call on a run that was never going to render a letter, so it cannot
  // change any decision. Every informational inquiry — the overwhelming
  // majority of UC-03's traffic — still makes exactly the two Remote reads it
  // always did.
  //
  // NEITHER FAILURE MAY TAKE THE RUN DOWN. `getLegalEntity()` returns null on a
  // 404 (RemoteClient's convention) and can throw on a 5xx; both become
  // `letterheadAvailable: false`, which is the human path, with the cause
  // recorded. Losing the run here would lose a decision to a read that only
  // ever fed a document — the F-15 shape, "could not fetch" quietly becoming a
  // fact about the request.
  let legalEntity = null;
  /** Set only when a letter was called for and could NOT be written — see below. */
  let letterDraftBlocked = null;
  if (classification.formalLetterRequested && employment) {
    try {
      legalEntity = await remote.getLegalEntity(employment.legal_entity_id, employment.company_id);
    } catch (err) {
      letterDraftBlocked = {
        code: "letterhead_unavailable",
        detail: `The employing entity could not be read from Remote (${err.message}).`,
      };
    }
    if (!letterDraftBlocked && !legalEntity?.name) {
      letterDraftBlocked = {
        code: "letterhead_unavailable",
        detail: employment.legal_entity_id
          ? `Remote returned no usable legal entity for ${employment.legal_entity_id}, so there is no letterhead to write on.`
          : "The employment record names no legal entity, so there is no letterhead to write on.",
      };
    }
  }

  // STEP 4 — deterministic decision (the thin router)
  const outcome = evaluate({
    employment,
    classification,
    identity,
    supportedCountries,
    upstreamFailures,
    // THE EMPLOYEE'S OWN WORDS, for rung 10's letter-scope check and nothing
    // else. Every other gate decides on the classified values; this one has to
    // read the request itself, because what it is looking for is precisely what
    // the classifier does NOT model — an addressee, a required sentence, a
    // passport number, a language. Fails closed when it is absent (see
    // letterScope.js), so an accepted offer replayed from a case row that
    // predates `ticketText` escalates rather than quietly drafting.
    requestText: ticket.text ?? null,
    // WHETHER THERE IS A LETTERHEAD, from the read above. `false` whenever no
    // letter was asked for, which costs nothing: the rung that reads it is only
    // reached when one was.
    letterheadAvailable: Boolean(classification.formalLetterRequested && !letterDraftBlocked && legalEntity?.name),
    // THE POLICY, PASSED THROUGH UNTOUCHED. Defaulted to `true` at this
    // function's own signature so a caller that says nothing gets the owner's
    // decision, and never re-derived from anything here — this file must not
    // hold a second opinion about a policy the gate owns.
    letterAutoIssue,
  });

  // (risk tier derived from the flags; useful for logging/routing)
  const risk = classifyRisk("UC-03", outcome.flags);

  // WHAT THE REVIEWER NEEDS, computed once from the same inputs the gates
  // compared. UC-03 is 🟢, so its exception surface IS its human-facing product
  // — and `duration_over_cap` was reaching a specialist as "longer than the cap"
  // with neither the trip length nor the cap beside it. That is C-27's shape
  // exactly, one use case over from where it was first found.
  //
  // `supportedCountries` is handed in as THE SET THE GATE ACTUALLY TESTED, not
  // the raw API rows, for the same reason the audit row records it that way: a
  // reader has to be able to tell an unread registry from a genuinely excluded
  // country, and only the count of that set does that.
  const decidedBy = describeDecidingGate(outcome.reason);
  const decisionFactsForReviewer = describeDecisionFacts({
    reason: outcome.reason,
    employment,
    classification,
    identity,
    supportedCountries,
    upstreamFailures,
    requestText: ticket.text ?? null,
  });

  // WHAT THE TEMPLATE COULD AND COULD NOT SAY, recorded on every letter
  // request — the standard ones as well as the refused ones. Computed after
  // the decision from the same pure function the gate used, consulted by
  // nothing, and structurally unable to change an outcome: the same discipline
  // `uc04Intake` follows.
  //
  // RECORDED ON THE STANDARD PATH TOO, ON PURPOSE. "Nothing outside the
  // template was asked for" is a POSITIVE statement a signer needs, and a
  // record that only ever reports faults teaches its reader that silence means
  // nothing was checked. `checked` names every check that ran.
  const letterScope = LETTER_REASONS.has(outcome.reason)
    ? assessLetterScope({ requestText: ticket.text ?? null, classification, employment })
    : null;

  // STEP 5 — route on the decision. Three branches produce an artifact now, and
  // the third is the one this pass added: the informational answer (auto), the
  // STANDARD TRAVEL LETTER issued with no signature (auto), and — when there was
  // no letterhead to write on — no document at all, with the case queued for a
  // person and the reason said out loud.
  let informationalAnswer;
  let letterHtml;
  if (outcome.reason === "all_gates_passed") {
    informationalAnswer = renderInformationalAnswer({
      destinationCountry: classification.destinationCountry,
      startDate: classification.startDate,
      endDate: classification.endDate,
      durationDays: outcome.durationDays,
    });
  } else if (outcome.reason === "standard_letter_issued" || (outcome.reason === "formal_letter_requested" && legalEntity?.name)) {
    // THE LETTER IS RENDERED FROM THE SAME FUNCTION, WITH THE SAME INPUTS, AS
    // THE ONE A SPECIALIST USED TO SIGN. There is no second renderer and no
    // path-dependent content, and that is a decision rather than an economy:
    // a "Travel Letter" whose body depended on who released it would be two
    // different documents wearing one name, and a consulate holding both could
    // not tell which it had. `letter.js` renders one letter; this path and the
    // sign-off path differ only in who releases it.
    //
    // BRANCHED ON THE REASON, NOT ON THE DECISION, for the reason `cc551b4`
    // recorded: `auto_resolve` is now reached two ways, and the informational
    // answer and the letter are different artifacts for different readers.
    letterHtml = renderTravelLetterHtml({
      employment,
      legalEntity,
      destinationCountry: classification.destinationCountry,
      startDate: classification.startDate,
      endDate: classification.endDate,
      // THE REFERENCE THE REQUESTER ALREADY HOLDS, so the document can be cited
      // back — by the employee, by the consulate, or by whoever audits it.
      // `externalRef` is the ticket the conversation lives on; null rather than
      // a placeholder when there is none.
      reference: ticket.externalRef ?? null,
      // THE ONE PIECE OF THE EMPLOYEE'S OWN TEXT THAT REACHES THIS DOCUMENT, and
      // it reaches it as a plain "Attention:" line and nothing else. Read off
      // the classification rather than off `ticket.stated`, because an accepted
      // letter offer re-runs this workflow with the STORED reading and no ticket
      // fields at all — taking it from the ticket would silently drop the
      // addressee on the one path that actually issues the letter.
      //
      // `letterScope.js` IS UNTOUCHED BY THIS AND MUST STAY SO. Its
      // `addressee_specified` markers still scan the REQUEST TEXT, so "address
      // it to the consulate and confirm the company pays" still escalates — on
      // its second clause, and on its first. A field must not become a way to
      // smuggle a compound ask past the scope check
      // (`docs/TRAVEL-LETTER-INPUTS.md` §6.3, precondition 3).
      addressee: classification.statedTrip?.addressee ?? null,
    });
  }
  // `formal_letter_requested` renders the SAME document and does not issue it —
  // that is the whole difference between the two branches above, and it is why
  // they share one expression rather than one being a copy of the other. When it
  // is reached because there is no letterhead, `legalEntity?.name` is false and
  // nothing is rendered at all: putting `undefined` where the company's name
  // goes, on a page a border officer reads, is the failure `cc551b4` closed and
  // this must not reopen it.

  // The UC-04 handoff event exists ONLY for the route_to_uc04 decision — it is
  // recorded and returned for inspection, never dispatched to UC-04.
  //
  // THIS COMMENT WAS ACCURATE AND THE PRODUCT CONTRADICTED IT. `policyEngine.js`
  // told the requester the request "has been handed to the work-authorisation
  // case (UC-04)", so the one true statement about this branch lived in a code
  // comment while the customer-facing string asserted a transfer. Both now say
  // the same thing, and `uc04Intake.js` carries the argument for why the fix is
  // the wording rather than a dispatch.
  const handoffEvent =
    outcome.decision === "route_to_uc04"
      ? buildUc04HandoffEvent({ employment, classification, externalRef: ticket.externalRef })
      : null;

  // WHAT THE HANDOFF CAN AND CANNOT HAND OVER, per run. Not a gate: computed
  // strictly after the decision, consulted by nothing, and structurally unable
  // to change an outcome (`describeUc04Intake` returns a report and takes no
  // dependency). It is what makes "there is nothing to go and look at, and here
  // is what you would need to file instead" a fact ON the decision rather than
  // something a reader has to reconstruct. Deliberately NOT folded into
  // `handoffEvent`: that object is a contract shape compared byte-for-byte
  // against the n8n port in test/n8nUc03Parity.test.js.
  const uc04Intake = handoffEvent ? describeUc04Intake(handoffEvent) : null;

  const requester = ticket.session?.authenticatedEmploymentId ?? "unauthenticated";

  // PROVENANCE on every audit row — the reference the requester holds and the
  // surface they used. `src/auditview/readStore.js` searches
  // `details->>'externalRef'` by name, so anything else is invisible to it.
  // Never defaulted; see src/uc01/workflow.js for the full reasoning.
  const externalRef = ticket.externalRef ?? null;
  const source = ticket.source ?? null;

  // STEP 6a — record the case: the current-state row a specialist would query.
  // DELIVERY-LEVEL IDEMPOTENCY. UC-03 both answers the customer and can route
  // the request on to UC-04, so a duplicate delivery costs twice: a repeated
  // reply and a second downstream handoff. The ledger is keyed by use case as
  // well as ref precisely so the UC-04 handoff is NOT mistaken for a duplicate
  // of this one — same ticket, different use case, its own claim.
  const claim = await claimExternalRef({
    pgPool: caseStore?.pgPool ?? null,
    useCase: "UC-03",
    // The DELIVERY, which is the ticket for every inbound request and is not the
    // ticket for an accepted letter offer — see `ticket.claimRef` above.
    externalRef: ticket.claimRef ?? ticket.externalRef,
    decision: outcome.decision,
  });
  if (!claim.claimed) {
    return {
      decision: outcome.decision,
      reason: outcome.reason,
      flags: outcome.flags,
      decidedBy,
      decisionFacts: decisionFactsForReviewer,
      duplicate: true,
      duplicateOf: ticket.externalRef,
    };
  }

  const caseRow = caseStore.createCase({
    useCase: "UC-03",
    source: ticket.source ?? "zendesk",
    externalRef: ticket.externalRef ?? null,
    employmentId: ticket.employmentId,
    requester,
    classification,
    // THE REQUEST ITSELF, which this workflow used to throw away.
    //
    // `cases` has carried a `ticket_text` column since UC-01 (caseStore.js
    // line 111, and the Postgres schema), UC-01 populates it, and UC-03 — the
    // only OTHER use case that writes to `cases`, and the one that is entirely
    // free-text driven — left it null on every row it ever wrote. Everything
    // downstream reads that column: the playground's request box
    // (`view.case.ticketText`) rendered nothing, and the ZAF sidebar's UC-03
    // panel loads the case row and has nothing else to show.
    //
    // So the human at the end of a UC-03 escalation — the specialist who has
    // to decide whether a formal travel letter can be issued, or what to do
    // with a destination the router could not place — received a decision, a
    // reason and a flag list with NO RECORD OF WHAT THE EMPLOYEE ASKED. The
    // portal's own Zendesk hand-off does not carry it either (it renders the
    // gates' report, not the request), so there was no surface anywhere that
    // did. A gate whose outcome a human must act on, with the input removed,
    // is a decision nobody can check.
    ticketText: ticket.text ?? null,
    decision: outcome.decision,
    reason: outcome.reason,
    flags: outcome.flags,
    status: INITIAL_STATUS_BY_DECISION[outcome.decision],
  });

  // STEP 6b — everything that isn't auto-resolved lands in a specialist queue.
  if (outcome.decision !== "auto_resolve") {
    caseStore.createReviewQueueEntry({
      caseId: caseRow.id,
      notes:
        outcome.decision === "route_to_uc04"
          ? // "Routed to UC-04" read, to the specialist picking this up, as
            // "somebody else already has it". Nobody has it. This queue entry
            // IS the only thing that exists.
            "Work-authorisation intent. A handoff event was recorded for inspection — NOT dispatched: " +
            "no UC-04 case exists and nothing is in a UC-04 queue. UC-04 decides on a work-authorisation " +
            "request the employee raises in Remote's Request Hub; there is no API that creates one."
          : outcome.reason === "formal_letter_requested"
            ? // TWO OPPOSITE JOBS BEHIND ONE REASON, and the note must not make
              // the reader guess which. WITH a drafted letter this is a
              // signature on a prepared document — the posture a deployment
              // chooses by setting `letterAutoIssue: false`. WITHOUT one, there
              // was no letterhead, nothing was written, and the specialist must
              // not go looking for a document that does not exist:
              // `signoffPolicy.js` refuses that case with `letter_missing`, and
              // this says why before they try.
              (letterHtml
                ? "Formal travel letter drafted; awaiting Travel & Mobility Support sign-off before issue. " +
                  "Sign off or decline it on this case — POST /api/cases/:id/signoff|decline (src/uc03/signoffPolicy.js). " +
                  "This deployment requires a signature on every travel letter; on the default posture a standard " +
                  "letter for a trip that cleared every gate is issued without one."
                : `NO LETTER WAS DRAFTED. ${letterDraftBlocked?.detail ?? "The employing entity could not be read from Remote."} ` +
                  "The trip itself passed every gate and would have been issued the standard letter with no " +
                  "signature — what is missing is the letterhead, not the permission. Fix the employing-entity " +
                  "record and re-run the request, or produce the letter outside this system.") +
              (ticket.offerAcceptedFrom
                ? ` Requested by accepting the letter offer on case ${ticket.offerAcceptedFrom}, which answered the same trip informationally — the classification is that decision's, unchanged.`
                : "")
            : outcome.reason === LETTER_SCOPE_EXCEEDED
              ? // NOT a sign-off either, and NOT a problem with the trip. The
                // trip cleared every gate; what cannot be produced is the
                // DOCUMENT. The specialist is being asked to write a letter this
                // system's fixed template cannot express — so the note names
                // each ask rather than telling them a slug.
                "NO LETTER WAS DRAFTED — this is not the standard template. The trip passed every gate; what the " +
                "request asks for is something the template cannot say, so drafting it would have produced a " +
                `document that silently omits it. ${summariseLetterScope(letterScope)} ` +
                "What is owed here is a letter written by a person, not a signature on one written by this system."
              : outcome.decision === "human_review"
                ? // NOT a sign-off. The router could not trust its reading of
                  // the request, so nothing was drafted and there is nothing to
                  // put a signature on — what is owed here is a reading, then a
                  // re-run.
                  "The request could not be classified confidently, so no letter was drafted. Confirm what the " +
                  "employee is asking for and re-run it; there is nothing to sign off."
                : null,
    });
  }

  // STEP 6c — generated artifacts tied to the case (chained after the parent
  // case row per caseStore.js's FK discipline).
  if (informationalAnswer) {
    caseStore.createDocument({ caseId: caseRow.id, type: "travel_informational_response", content: informationalAnswer });
  }
  // THE DOCUMENT ROW IS KEPT, not discarded, because its sha256 is the only
  // thing that answers "what exactly went out?" once the letter has no signer
  // to name. `createDocument()` computes it; the audit row below carries it.
  const letterDocument = letterHtml
    ? caseStore.createDocument({ caseId: caseRow.id, type: "travel_support_letter", content: letterHtml })
    : null;

  // WHAT STOOD IN FOR A SIGNATURE, on the one decision that has none.
  //
  // A signed letter's audit row names the approver and the document's hash. An
  // auto-issued one has no approver, so it has to record what took that place,
  // or an artifact reaches a foreign authority with no accountable origin —
  // which is worse than one waiting on a signature. Three things, and none of
  // them is re-derived here: the ladder is `GATE_SEQUENCE` walked against this
  // decision's own reason, the scope verdict is the object the gate itself
  // consulted, and the hash is the one the document store computed.
  const autoIssue =
    outcome.reason === "standard_letter_issued"
      ? {
          issuedWithoutSignature: true,
          basis:
            "Every gate in UC-03's ladder passed and the letter-scope check found the standard template, so the " +
            "🟢 path issued it. No specialist read this letter; the gates below are the whole of what authorised it.",
          gatesPassed: describeGateLadder(outcome.reason)
            .filter((rung) => rung.status === "passed")
            .map((rung) => ({ position: rung.position, gate: rung.gate, checks: rung.checks })),
          decidedAt: { position: decidedBy?.position ?? null, gate: decidedBy?.gate ?? null, of: decidedBy?.total ?? null },
          // The positive half, in the shape the gate produced it: `standard:
          // true` plus every check that ran. A record that only ever reports
          // faults teaches its reader that silence means nothing was checked.
          letterScope,
          letterDocumentId: letterDocument?.id ?? null,
          letterContentHash: letterDocument?.contentHash ?? null,
        }
      : null;

  // STEP 7 — audit the whole thing (immutable history, linked to the case).
  //
  // DURABLE ON THE ISSUE PATH, best-effort on every other. UC-01's workflow
  // settled this rule for an auto-issued letter and states it in full: the log
  // has to be durable BEFORE the irreversible action, so a failure here refuses
  // the action instead of orphaning it. An `await` that rejects propagates —
  // no letter is posted, no ticket is solved, and the case row above is still
  // there for a specialist to work by hand. Every other UC-03 decision keeps
  // the best-effort write it has always had: nothing irreversible follows them,
  // and making a database blip fail a correctly-refused request would be a
  // worse answer than the one it replaced.
  const auditEvent = {
    useCase: "UC-03",
    action: outcome.decision,
    actor: requester,
    riskTier: risk.tier,
    details: {
      caseId: caseRow.id,
      externalRef,
      source,
      employmentId: ticket.employmentId,
      destinationCountry: classification.destinationCountry,
      // The list AS THE GATE SAW IT, not as the API sent it. Recording the raw
      // rows would have hidden F-27 all over again: the audit trail would have
      // shown a healthy 224-entry list next to an `unsupported_destination`
      // verdict and read as a genuine policy outcome. This is the exact set the
      // membership test ran against, so an empty array here is now a visible,
      // investigable statement that nothing was confirmed supported.
      supportedCountriesChecked: [...supportedCountries],
      classification,
      identity,
      flags: outcome.flags,
      reason: outcome.reason,
      durationDays: outcome.durationDays,
      disclaimerApplied: Boolean(informationalAnswer || letterHtml),
      // TRUE ON EXACTLY ONE REASON, AND IT IS A REASON RATHER THAN A DECISION.
      // For most of this file's life the automation could not issue a UC-03
      // letter at all and this field was the literal `false`; the only row that
      // could carry `true` was the sign-off's. It can now be true here, and it
      // is derived from the rung that decided — not from `Boolean(letterHtml)`,
      // which would also be true of a draft, and not from `decision ===
      // "auto_resolve"`, which is now reached two ways.
      letterIssued: outcome.reason === "standard_letter_issued",
      // …AND WHETHER THERE IS EVEN A DOCUMENT. A case that asked for a letter
      // and got nothing looked identical to one that asked and got one; they are
      // opposite situations for whoever picks the case up.
      letterDrafted: Boolean(letterHtml),
      letterContentHash: letterDocument?.contentHash ?? null,
      ...(autoIssue ? { autoIssue } : {}),
      ...(letterDraftBlocked ? { letterDraftBlocked } : {}),
      // WHO SAID WHICH FACT ABOUT THIS TRIP, and what was thrown away for being
      // the wrong shape. `details.classification` already carries the same block
      // (the provenance rides on the classification so it survives an offer
      // acceptance), and it is lifted to the top of `details` as well because
      // `src/auditview/` reads this object's own keys — a provenance nested two
      // levels down inside a field named for the model is a provenance nobody
      // will find. Absent entirely when the request came with no fields, so a
      // pre-form row and a form row with nothing filled in look the same.
      ...(statedTrip ? { statedTrip } : {}),
      // WHETHER THE TEMPLATE COULD SAY WHAT WAS ASKED, on every decision that
      // involved a letter — recorded in BOTH directions. `standard: true` with
      // the list of checks that produced it is the positive half, and it is the
      // half a signer needs: without it, a clean case and an unchecked one look
      // the same in history.
      ...(letterScope ? { letterScope } : {}),
      // WHERE THIS REQUEST CAME FROM, when it came from an offer rather than
      // from something the employee typed. Two decisions were made about one
      // trip; this is the only field that joins them from history alone.
      offerAcceptedFrom: ticket.offerAcceptedFrom ?? null,
      handoffEvent,
      // Recorded beside the event it describes, so the audit row answers "was
      // anything actually dispatched?" without a reader having to know that the
      // absence of a UC-04 row is the answer. `dispatched: false` is an
      // assertion in the record, not an inference from a missing one.
      uc04Intake,
    },
  };
  if (autoIssue) {
    await audit.logDurable(auditEvent);
  } else {
    audit.log(auditEvent);
  }

  // STEP 8 — close the loop with the customer/specialist on the real ticket.
  // Not caught/backgrounded like audit/caseStore writes above: this IS the
  // customer-facing action, so a failure here should propagate. Our internal
  // case/document/audit records above are already durable regardless.
  if (zendesk && ticket.source === "zendesk" && ticket.externalRef) {
    // KEYED ON THE DECIDING RUNG, NEVER ON `letterHtml`. A DRAFTED letter is
    // also a `letterHtml`, and posting one to the customer's ticket would be
    // this line issuing a document the signature gate exists to hold.
    if (outcome.reason === "standard_letter_issued") {
      // THE ISSUED LETTER, AS HTML, ON THE TICKET — the same primitive the
      // sign-off path uses, and for the same reason it uses it: `publicReply` on
      // the n8n Zendesk node silently escapes HTML (CLAUDE.md's live-resources
      // note), and a travel letter delivered to a border authority as literal
      // markup is a worse failure than not delivering it. This runs after the
      // DURABLE audit row above, so a Zendesk failure surfaces to a human with
      // the decision and the document already recorded.
      await zendesk.resolveWithLetter(ticket.externalRef, letterHtml);
    } else if (outcome.decision === "auto_resolve" && informationalAnswer) {
      // Informational answer is plain text, so use the generic update primitive
      // (public comment + solve) rather than resolveWithLetter's HTML path.
      await zendesk.updateTicket(ticket.externalRef, {
        status: "solved",
        comment: { body: informationalAnswer, public: true },
      });
    } else {
      const note =
        `AI summary — decision: ${outcome.decision} (${outcome.reason}). ` +
        `Flags: ${outcome.flags.length ? outcome.flags.join(", ") : "none"}.` +
        // The deciding rung in plain words (C-22), then the figures that rung
        // compared (C-27). The slugs above stay: they are what `audit_log`, the
        // metrics exception ranking and the n8n port all key on.
        (decidedBy ? ` Decided at gate ${decidedBy.position} of ${decidedBy.total} (${decidedBy.gate}): ${decidedBy.means}` : "") +
        formatFactsForNote(decisionFactsForReviewer) +
        // THE SPECIALIST-FACING HALF OF THE SAME OVERSTATEMENT. "Handoff:
        // CROSS_BORDER_WORK_REQUESTED → destination PT" reads as a message
        // sent. Nothing was sent, and the person reading this note is the only
        // person who will ever act on it — so it says so, and names what the
        // employee has to file and what that filing needs.
        (handoffEvent
          ? ` Handoff event RECORDED, NOT DISPATCHED: ${handoffEvent.event_type} → destination ` +
            `${handoffEvent.destination_country ?? "unknown"}. No UC-04 case exists; UC-04 decides on a ` +
            `work-authorisation request the employee raises in Remote's Request Hub (no API creates one). ` +
            `Not carried by this request: ${uc04Intake.missing.map((m) => m.label).join(", ")}.`
          : "") +
        // WHICH KIND OF HUMAN WORK, not just "a human is needed". These two
        // sentences are the specialist-facing half of the split
        // src/uc03/signoffPolicy.js enforces: one is a signature, the other is
        // a reading. A single "specialist sign-off required" on both told the
        // reader to sign a letter that, for the second, does not exist.
        (outcome.reason === LETTER_SCOPE_EXCEEDED
          ? " NO LETTER WAS DRAFTED: this is not the standard template, and the trip itself is fine. " +
            summariseLetterScope(letterScope)
          : outcome.reason === "formal_letter_requested"
          ? letterHtml
            ? " The travel letter is drafted but NOT issued — Travel & Mobility Support signs it off first. Nothing" +
              " outside the standard template was asked for, so this is a signature on a prepared document."
            : " NO LETTER WAS DRAFTED, and there is nothing here to sign. The trip qualifies for the standard" +
              " letter and this system would have issued it with no signature — what is missing is the LETTERHEAD. " +
              (letterDraftBlocked?.detail ?? "The employing entity could not be read from Remote.") +
              " Fix the employing-entity record and re-run the request."
          : outcome.decision === "human_review"
            ? " Nothing was drafted: the request could not be classified confidently, so what is needed is a" +
              " reading of what the employee is asking for and a re-run — there is nothing to sign off."
            : "");
      await zendesk.flagForReview(ticket.externalRef, {
        note,
        tags: ZENDESK_TAG_BY_DECISION[outcome.decision] ?? [],
      });
    }
  }

  return {
    decision: outcome.decision,
    route: outcome.route ?? null,
    informationalAnswer,
    letterHtml,
    flags: outcome.flags,
    reason: outcome.reason,
    caseId: caseRow.id,
    durationDays: outcome.durationDays,
    // THE CLASSIFICATION THIS DECISION WAS MADE ON, which this result used to
    // omit entirely. Every gate below step 3 in policyEngine.js reads it: the
    // confidence gate gates on `confidence`, the UC-04 route is chosen on
    // `intent`, every destination gate on `destinationCountry`, the day-count
    // on the two dates, and the HITL letter gate on `formalLetterRequested`.
    // The audit row has always recorded it, but no caller could show it — so
    // the portal panel presented `route_to_uc04 / work_authorization_requested`
    // with nothing to say WHICH READER produced that intent or how sure it
    // was, and a reader would reasonably assume the configured LLM did. Driven
    // from the portal with OpenAI unreachable, all four scenarios were
    // `source: "rule_based_fallback"` and the page said nothing at all.
    //
    // §4 invariant 8's point is that the tag exists on the RESULT, not only in
    // a table nobody reading the decision will open. Returned whole rather
    // than as two hand-picked fields, because the next gate to be questioned
    // will be a different one.
    classification,
    // WHICH SIGNAL PROVED (or failed to prove) WHO WAS ASKING — `flags` carries
    // `identity_<reason>` only on a refusal, so a successful check was
    // previously unreportable to any caller.
    identity,
    // THE LETTER THIS ANSWER IS ALLOWED TO BECOME. Present only on the
    // auto-resolved path, where it is the whole product change: the employee is
    // told, in the same breath as the answer, that the formal document exists
    // and can be had without describing the trip again. `offered: false` on
    // every other outcome, with a sentence saying what the case is instead —
    // see src/uc03/letterOffer.js.
    // KEYED ON THE REASON, NOT THE DECISION. `auto_resolve` is now reached two
    // ways and only one of them is an unanswered question: a case that just
    // ISSUED the letter has no offer to make, and `describeNoOffer()` says so in
    // its own words rather than falling through to a sentence about
    // informational replies.
    letterOffer:
      outcome.decision === "auto_resolve"
        ? describeLetterOffer({ caseRow, session: ticket.session ?? null })
        : null,
    // THE DOCUMENT, AND WHETHER ANYBODY HAS IT. `issued` is the new half and it
    // is derived from the deciding rung, so it can never be true of a draft.
    // Null on every outcome that never involved a letter, rather than
    // `{drafted:false}`, which would read as a failure on a case that never
    // wanted one.
    letterDraft: LETTER_REASONS.has(outcome.reason)
      ? {
          drafted: Boolean(letterHtml),
          issued: outcome.reason === "standard_letter_issued",
          contentHash: letterDocument?.contentHash ?? null,
          documentId: letterDocument?.id ?? null,
          ...(letterDraftBlocked ? { blocked: letterDraftBlocked } : {}),
        }
      : null,
    // WHAT STOOD IN FOR A SIGNATURE, on the one decision that has none — the
    // same block the audit row carries, so a caller can show it without reading
    // history. Null on every other outcome.
    autoIssue,
    // What the template could and could not say — see the block that computes
    // it. Null on every outcome that never involved a letter, rather than
    // `{standard:true}`, which would read as a clean bill of health on a
    // request that never asked for one.
    letterScope,
    // WHAT THE TRAVELLER STATED THEMSELVES, per field, and what was rejected.
    // Present only when the request carried fields at all — a result from a
    // free-text-only surface is byte-identical to what it has always been.
    ...(statedTrip ? { statedTrip } : {}),
    // Where in the order this stopped, and what that rung means in plain words.
    decidedBy,
    // The figures the deciding gate compared. Null when nothing was refused —
    // never an empty bundle, which would read like missing data.
    decisionFacts: decisionFactsForReviewer,
    // `uc04Intake` travels WITH `handoffEvent` and never without it — the two
    // are one statement ("this is what was recorded, and this is what it can
    // and cannot hand over"), and a caller that got the event alone is exactly
    // the caller that reads it as a dispatch.
    ...(handoffEvent ? { handoffEvent, uc04Intake } : {}),
  };
}

// ---------------------------------------------------------------------------
// acceptTravelLetterOffer  —  "yes, send me the letter", without asking twice
// ---------------------------------------------------------------------------
// WHAT THIS IS AND, MORE IMPORTANTLY, WHAT IT IS NOT
//
// It is the employee taking up the offer their informational answer carried. It
// produces a second UC-03 decision — the same one they would have got by
// writing "and I need a travel letter for it", minus the retyping and minus the
// re-classification. It does NOT produce a letter that anybody receives:
// `human_review / formal_letter_requested` is where it lands, and
// `submitTravelLetterSignoff()` below is still the only code in this repository
// that can issue one.
//
// THE RE-RUN IS THE REAL WORK, AND IT IS DELIBERATELY A FULL ONE.
// This function does not copy the original decision forward. It calls
// `handleTravelInquiry()` again with the stored classification and the letter
// flag set, so the employment record is READ AGAIN and every gate RUNS AGAIN:
// an employee terminated since Tuesday now escalates `employee_not_active`, a
// destination that has left Remote's registry now escalates, an unreadable
// registry still fails closed. A letter certifies a fact as at the day it is
// written, so the facts are re-established on the day it is asked for.
//
// The one thing that is NOT redone is the reading of the request text. See
// `carryClassificationForward()` — re-classifying could return a different
// destination or a different date, and the employee would be accepting a letter
// about a trip they were never shown.
//
// WHY THE OFFER CANNOT BE REACHED FROM AN UNTRUSTED CLASSIFICATION, three ways:
//   1. only `auto_resolve / all_gates_passed` carries an offer at all, and that
//      outcome is downstream of the confidence gate;
//   2. the confidence figure travels with the carried classification, so the
//      confidence gate runs again on the same number in the re-run;
//   3. STEP 5 drafts a letter only when the RE-RUN's own reason comes back
//      `formal_letter_requested` — a `low_confidence` re-run drafts nothing,
//      exactly as it does for an inbound request.
// ---------------------------------------------------------------------------

/**
 * Accept the formal-letter offer carried by an auto-resolved travel answer.
 *
 * @param {object} args
 * @param {string} args.caseId   the auto-resolved case the offer was made on
 * @param {object|null} args.session  the authenticated session of the employee
 *   accepting. Supplied by the surface that authenticated them — the same trust
 *   model `handleTravelInquiry()`'s `ticket.session` has always had, where n8n
 *   derives it from the Zendesk-authenticated requester and the portal from its
 *   own persona. It is re-verified inside the re-run against the record freshly
 *   read from Remote; that check, not this parameter, is the control.
 * @param {object} deps  as handleTravelInquiry()
 * @returns {Promise<{ok:boolean, status:number, code:string, reason:string,
 *   caseId?:string, fromCaseId?:string, decision?:string, decisionReason?:string,
 *   letterDrafted?:boolean, awaitingSignoff?:boolean}>}
 */
export async function acceptTravelLetterOffer(
  { caseId, session = null },
  // `letterAutoIssue` is passed STRAIGHT THROUGH to the re-run and is never read
  // here: this function decides nothing about the letter, and a second opinion
  // about a policy the gate owns is exactly how two copies of a rule start to
  // drift. Defaulted at `handleTravelInquiry()`'s own signature, so omitting it
  // here means "whatever that function's default is", not "false".
  { remote, audit, caseStore, zendesk = null, letterAutoIssue = undefined }
) {
  // REQUEST-SHAPED CHECKS FIRST, so an unauthenticated call is never answered
  // with information about a case it had no business naming — the same ordering
  // `evaluateLetterSignoffAction()` uses.
  if (!session?.authenticatedEmploymentId) {
    return asRefusal(refuseOffer("session_required"));
  }

  const found = await caseStore.findById(caseId);
  const caseRow = found && found.useCase === "UC-03" ? found : null;

  // The letter request this answer has already become, if it has. A DISPLAY
  // input: it makes a second accept say "already requested, it is case X"
  // instead of "duplicate delivery". What actually stops two letters is the
  // `workflow_claims` primary key below.
  //
  // IT IS A PRECISE PARENT LINK NOW, and it had to become one. This used to be
  // "the newest UC-03 case sharing this reference", which held only while both
  // rows kept the same reference — and they stopped doing so the moment an
  // accepted letter request began raising a Zendesk ticket and being repointed
  // at it. See findLetterCaseFor()'s header.
  const followOnCase = await findLetterCaseFor(caseStore, caseRow);

  const verdict = evaluateLetterOffer({ caseRow, followOnCase, session });
  if (!verdict.allowed) {
    recordOfferRefusal({ audit, caseRow, session, verdict });
    return asRefusal(verdict);
  }

  const result = await handleTravelInquiry(
    {
      // The employee's own words, from the case that answered them. Carried so
      // the specialist reading the letter case sees the request, not a stub.
      text: caseRow.ticketText ?? "",
      session,
      employmentId: caseRow.employmentId,
      source: caseRow.source ?? undefined,
      externalRef: caseRow.externalRef ?? undefined,
      claimRef: letterClaimRef(caseRow),
      offerAcceptedFrom: caseRow.id,
    },
    {
      remote,
      audit,
      caseStore,
      zendesk,
      // NO CLASSIFIER RUNS ON THIS PATH. The seam is filled with the reading
      // that was already made and already acted on, plus the one field the
      // employee just set themselves. Nothing here can reach OpenAI.
      // The parent id travels with the reading, so the letter case records which
      // answer it continues — durably, and independently of any reference either
      // row may be repointed at later.
      classify: async () => carryClassificationForward(caseRow.classification, { acceptedFrom: caseRow.id }),
      ...(letterAutoIssue === undefined ? {} : { letterAutoIssue }),
    }
  );

  if (result.duplicate) {
    return asRefusal(
      refuseOffer("offer_already_accepted", {
        reason:
          "The formal travel letter has already been requested for this trip — this delivery was refused by the " +
          "exactly-once ledger, so nothing was recorded twice.",
      })
    );
  }

  // THE THREE THINGS AN ACCEPTED OFFER CAN PRODUCE, named apart.
  //
  // `letterIssued` is the ordinary one now: the re-run reached the letter rung,
  // the scope was standard and there was a letterhead, so the document exists
  // and the employee has it. `awaitingSignoff` is retained and is now ALWAYS
  // FALSE — kept as a named constant rather than deleted because it is what the
  // caller shape has always promised, and a field that silently disappears is
  // worse to a portal than one that reads false. See the note under `code`.
  const letterIssued = result.reason === "standard_letter_issued" && Boolean(result.letterHtml);
  // `formal_letter_requested` is now reachable on exactly one condition — the
  // employing entity could not be read — and on that condition NOTHING is
  // drafted. So there is no state in which an accepted offer leaves a document
  // waiting for a signature, and this is pinned by test rather than asserted.
  const awaitingSignoff = result.reason === "formal_letter_requested" && Boolean(result.letterHtml);

  // THE TICKET IS NOT REOPENED WHEN THE LETTER ISSUES. The informational answer
  // solved it; `handleTravelInquiry()`'s STEP 8 has already posted the letter
  // with `resolveWithLetter()` on the re-run, which leaves the conversation
  // closed with the document in it — which is the right end state for a request
  // that is finished. It IS reopened when a person now owes work on it, because
  // `flagForReview()` posts an internal note without touching status, so a case
  // needing a human would otherwise sit inside a solved conversation.
  if (!letterIssued && zendesk && caseRow.source === "zendesk" && caseRow.externalRef) {
    await zendesk.updateTicket(caseRow.externalRef, { status: "open" });
  }

  return {
    ok: true,
    status: 200,
    code: letterIssued
      ? "letter_issued"
      : result.reason === "formal_letter_requested"
        ? // TWO OUTCOMES BEHIND ONE REASON, and a caller has to be able to tell
          // them apart without reading flags: the letter is drafted and waiting
          // for a signature (the posture a deployment chooses), or it could not
          // be written at all because there was no letterhead. Neither is
          // `conditions_changed`, which says the trip stopped clearing the gates.
          (result.letterDraft?.drafted ? "letter_drafted" : "letter_not_drafted")
        : // A SEPARATE CODE, because it is a separate thing. This says the trip
          // is still fine and the DOCUMENT is what cannot be produced. Reachable
          // from an offer whenever the original request asked for something
          // outside the template while not asking for a letter — the answer
          // path never consults the scope, so the ask surfaces here for the
          // first time.
          result.reason === LETTER_SCOPE_EXCEEDED
          ? "letter_not_standard"
          : "conditions_changed",
    reason: letterIssued
      ? "Your travel letter has been written and issued — it is attached to this request and posted to the ticket. " +
        "Every check it needed had already passed when the trip was answered, so no signature was needed."
      : result.reason === "formal_letter_requested"
        ? result.letterDraft?.drafted
          ? "The formal travel letter is drafted and with Travel & Mobility Support to sign off. Nothing has been issued yet."
          : `The request is recorded and queued, but no letter could be written: ${result.letterDraft?.blocked?.detail ?? "the letterhead could not be read."} The trip itself is fine — a specialist picks this up.`
        : result.reason === LETTER_SCOPE_EXCEEDED
          ? "The trip is fine — the letter is not the standard one. This request asks for something the template " +
            `cannot say, so nothing was written and Travel & Mobility Support will write it. ${summariseLetterScope(result.letterScope)}`
          : "The trip no longer clears the gates it cleared when it was answered, so no letter was written. The new decision says why.",
    caseId: result.caseId,
    fromCaseId: caseRow.id,
    decision: result.decision,
    decisionReason: result.reason,
    decidedBy: result.decidedBy ?? null,
    letterDrafted: Boolean(result.letterHtml),
    letterIssued,
    // The document's sha256, so the caller can name what it just handed over
    // without fetching it. Null when nothing was written.
    letterContentHash: result.letterDraft?.contentHash ?? null,
    // WHERE THE EMPLOYEE FETCHES IT. Stated by the producer rather than
    // hard-coded by every surface that renders the result — the same reason
    // `describeLetterOffer()` states its own `accept` route.
    letter: letterIssued ? { method: "POST", path: `/api/cases/${result.caseId}/letter` } : null,
    awaitingSignoff,
    // WHAT AUTHORISED IT, carried through so the surface showing the employee
    // their letter can also show why nobody signed it.
    autoIssue: result.autoIssue ?? null,
  };
}

/** A pure-gate refusal, in the response shape every UC-03 write route returns. */
function asRefusal(verdict) {
  return { ok: false, status: verdict.status, code: verdict.code, reason: verdict.reason };
}

/**
 * A refused acceptance is recorded when — and only when — there is both a case
 * and an identified person to attribute it to. Same rule, and same reason, as
 * `recordSignoffRefusal()` below: an endpoint that audits unattributable
 * refusals lets anyone append rows to an append-only table by POSTing case ids.
 */
function recordOfferRefusal({ audit, caseRow, session, verdict }) {
  if (!caseRow || !session?.authenticatedEmploymentId) return;
  const { tier } = classifyRisk("UC-03", caseRow.flags ?? []);
  audit.log({
    useCase: "UC-03",
    action: "travel_letter_offer_refused",
    actor: session.authenticatedEmploymentId,
    riskTier: tier,
    details: {
      caseId: caseRow.id,
      externalRef: caseRow.externalRef ?? null,
      source: caseRow.source ?? null,
      refusalCode: verdict.code,
      refusalReason: verdict.reason,
      aiDecision: caseRow.decision,
      aiReason: caseRow.reason,
      caseStatus: caseRow.status,
    },
  });
}

// ---------------------------------------------------------------------------
// submitTravelLetterSignoff  —  the one human action UC-03 has ever needed
// ---------------------------------------------------------------------------
// WHY THERE IS EXACTLY ONE
// UC-03 is 🟢 and mostly resolves itself. `docs/APPROVAL-QUEUE.md` §0 measured
// three of its cases as `no_approval_surface` — "something must be signed and
// nothing can sign it" — and the measurement was right about the category and
// wrong about the rows: every UC-03 row waiting on a person in production that
// day was `route_to_uc04`, which nobody signs. See src/uc03/signoffPolicy.js's
// header for the full argument and for what each other outcome is refused with.
//
// What genuinely could not be finished is the FORMAL TRAVEL LETTER. It is
// drafted deterministically from authoritative Remote reads, stored as a
// `travel_support_letter` document, and — until this function — could never
// leave the building: `audit_log` carried `letterIssued: false` on every UC-03
// row ever written because there was no code path anywhere that could set it
// true.
//
// THE ORDER OF WRITES IS THE SAME DESIGN DECISION src/review/service.js MAKES
//
//     policy gate -> freshness re-read -> AUDIT -> state -> Zendesk
//
// The audit row is written first and durably. If the process dies between it
// and the state move, history says a named human authorised this while the
// review row still reads `pending` — visibly inconsistent, detectable, and
// safely retryable. The other ordering fails in the direction that matters: an
// issued letter with no record of who authorised it.
//
// THE FRESHNESS RE-READ IS NOT A DUPLICATED GATE. `policyEngine.js` checked
// `employment.status === "active"` when the ticket arrived. A travel letter
// asserts, to a destination authority, that this person is employed TODAY, and
// sign-off can be days later. Re-reading asks "is this still true?", which is a
// different question from the one the gate asked, and it re-reads rather than
// re-deciding, so there is no second copy of the gates to drift.
// ---------------------------------------------------------------------------

/**
 * Record a Travel & Mobility Support specialist's decision on a drafted letter,
 * and — on a sign-off — issue it.
 *
 * @param {object} args
 * @param {string} args.caseId
 * @param {"signoff"|"decline"} args.action  (`deny` accepted, normalised)
 * @param {string|null} args.approver        the VERIFIED identity, never a body claim
 * @param {string} [args.note]               required on a decline, recorded either way
 * @param {object} deps
 * @param {import("../remote/restClient.js").RemoteClient} deps.remote
 * @param {import("../shared/audit.js").AuditLogger} deps.audit
 * @param {import("../shared/caseStore.js").CaseStore} deps.caseStore
 * @param {import("../zendesk/restClient.js").ZendeskClient|null} [deps.zendesk]
 *   when supplied, the signed letter is posted to the real ticket and the ticket
 *   is solved. Optional exactly as in handleTravelInquiry(), so no test ever
 *   reaches a real Zendesk account by accident.
 * @param {{check: Function}|null} [deps.entitlement]
 * @returns {Promise<{ok:boolean, status:number, code:string, reason:string,
 *   caseId?:string, letterIssued?:boolean, letterContentHash?:string|null}>}
 */
export async function submitTravelLetterSignoff(
  { caseId, action: rawAction, approver, note = "" },
  { remote, audit, caseStore, zendesk = null, entitlement = null }
) {
  // SCOPED TO UC-03 BEFORE ANYTHING ELSE. `cases` is a shared table — UC-01
  // writes to it too — so an id alone is not proof of which use case a row
  // belongs to, and this route must never act on somebody else's case. A
  // foreign row is reported as not found rather than as refused: "that is not
  // yours" is itself a disclosure about a case the caller named blindly.
  const found = await caseStore.findById(caseId);
  const caseRow = found && found.useCase === "UC-03" ? found : null;

  // Normalised ONCE, at the edge: `deny` (what the installed ZAF bundle still
  // posts) becomes `decline`. Unknown input is returned unchanged, so a bogus
  // verb still fails the ACTIONS check rather than being rewritten into a valid
  // one.
  const action = normalizeDecisionAction(rawAction);

  // The two child rows the gate needs, read from wherever they actually are —
  // in this process's memory in a seeded run, out of Postgres on the
  // deployment. `includeContent` because a sign-off has to post the real
  // letter, not a hash of it.
  const { reviewEntry, documents } = caseRow
    ? await readCaseAttachments(caseStore, caseRow.id, { includeContent: true })
    : { reviewEntry: null, documents: [] };
  const letterDocument = documentOfType(documents, LETTER_DOCUMENT_TYPE);

  const verdict = evaluateLetterSignoffAction({
    caseRow,
    reviewRow: reviewEntry,
    letterDocument,
    approver,
    action,
    note,
    entitlement,
  });
  if (!verdict.allowed) {
    recordSignoffRefusal({ audit, caseRow, action, approver, verdict });
    return { ok: false, status: verdict.status, code: verdict.code, reason: verdict.reason };
  }

  const actor = approver.trim();
  const { tier } = classifyRisk("UC-03", caseRow.flags ?? []);
  // PROVENANCE COMES OFF THE ROW. Sign-off runs in a different process from the
  // decision, days later, holding only a case id — recoverable only because
  // `cases` persists `external_ref` and `source`.
  const externalRef = caseRow.externalRef ?? null;
  const source = caseRow.source ?? null;

  if (action === "signoff") {
    // Is the fact the letter asserts still true? See this section's header.
    const employment = await remote.getEmployment(caseRow.employmentId);
    if (!employment || employment.status !== "active") {
      const stale = refuseSignoff("employment_no_longer_active");
      recordSignoffRefusal({
        audit,
        caseRow,
        action,
        approver: actor,
        verdict: stale,
        extraDetails: { observedStatus: employment?.status ?? "not_found" },
      });
      return { ok: false, status: stale.status, code: stale.code, reason: stale.reason };
    }
  }

  // --- 1. AUDIT FIRST, DURABLY.
  //
  // `letterContentHash` is on the row deliberately. A signature that does not
  // name the document it covers is a signature on whatever the store happens to
  // hold later; the hash is already computed by `caseStore.createDocument()`,
  // so recording it costs nothing and makes "what exactly did they sign?"
  // answerable from history alone.
  await audit.logDurable({
    useCase: "UC-03",
    action: action === "signoff" ? "travel_letter_signed_off" : "travel_letter_declined",
    actor,
    riskTier: tier,
    details: {
      caseId: caseRow.id,
      externalRef,
      source,
      employmentId: caseRow.employmentId,
      decidedVia: "zaf_sidebar",
      // The automation's own recommendation, beside the human's verdict, in one
      // row — the pairing that makes "did the specialist agree?" answerable
      // from history rather than by definition.
      aiDecision: caseRow.decision,
      aiReason: caseRow.reason,
      flags: caseRow.flags ?? [],
      note: note || null,
      letterDocumentId: letterDocument?.id ?? null,
      letterContentHash: letterDocument?.contentHash ?? null,
      // THE FIELD THAT HAS ONLY EVER BEEN `false`. handleTravelInquiry() writes
      // `letterIssued: false` on every decision it makes, correctly — the
      // automation never issues one. This is the row where it can be true.
      letterIssued: action === "signoff",
    },
  });

  // --- 2. Move the mutable state. `approved`/`rejected` are the exact strings
  // src/metrics/compute.js counts for the HITL accept rate, which is what turns
  // that metric into a measurement instead of a definition.
  await caseStore.updateReviewQueueStatus(caseRow.id, {
    status: action === "signoff" ? "approved" : "rejected",
    assignee: actor,
    notes: note || null,
  });
  await caseStore.updateCaseStatus(caseRow.id, action === "signoff" ? "resolved" : "declined");

  // --- 3. Close the loop with the employee on the real ticket. Not swallowed:
  // this IS the customer-facing half and the records above are already durable,
  // so a failure here should surface to the specialist rather than be hidden.
  // Same reasoning as handleTravelInquiry()'s STEP 8.
  if (zendesk && externalRef) {
    if (action === "signoff") {
      // The signed letter, as HTML, on the ticket. `resolveWithLetter` is the
      // same primitive UC-01's review path uses — `publicReply` on the n8n
      // Zendesk node silently escapes HTML (CLAUDE.md's live-resources note),
      // and a travel letter delivered as literal markup to a border authority
      // is a worse failure than not delivering it.
      await zendesk.resolveWithLetter(externalRef, letterDocument.content);
    } else {
      await zendesk.flagForReview(externalRef, {
        note: `Travel letter declined by ${actor}. Reason: ${note}`,
        tags: ["uc03_letter_declined"],
      });
    }
  }

  return {
    ok: true,
    status: 200,
    code: action === "signoff" ? "signed_off" : "declined",
    reason:
      action === "signoff"
        ? "Travel letter signed off and issued to the employee."
        : "Travel letter declined; nothing was issued.",
    caseId: caseRow.id,
    letterIssued: action === "signoff",
    letterContentHash: letterDocument?.contentHash ?? null,
  };
}

/**
 * Refusals with no identified actor are NOT audited — same reasoning as
 * src/review/service.js's identical helper: anyone who can reach the endpoint
 * could otherwise append unlimited rows to an append-only table by POSTing case
 * ids with no credentials, burying the attributed rows that matter.
 *
 * Everything else IS recorded. A refused sign-off on a real travel letter, by a
 * named identity, is exactly the kind of event an audit log exists for.
 */
const UNATTRIBUTED_SIGNOFF_REFUSALS = new Set(["approver_required", "unknown_action", "case_not_found"]);

function recordSignoffRefusal({ audit, caseRow, action, approver, verdict, extraDetails = {} }) {
  if (!caseRow || UNATTRIBUTED_SIGNOFF_REFUSALS.has(verdict.code)) return;
  const { tier } = classifyRisk("UC-03", caseRow.flags ?? []);
  // Best-effort (log, not logDurable) on purpose: the refusal has ALREADY
  // prevented the issue, so this row is evidence rather than the control — and
  // making it durable would let a database blip turn a correct 403 into a 500,
  // which is a worse answer to give a specialist.
  audit.log({
    useCase: "UC-03",
    action: `travel_letter_${action}_refused`,
    actor: typeof approver === "string" && approver.trim() ? approver.trim() : "unknown",
    riskTier: tier,
    details: {
      caseId: caseRow.id,
      externalRef: caseRow.externalRef ?? null,
      source: caseRow.source ?? null,
      decidedVia: "zaf_sidebar",
      refusalCode: verdict.code,
      refusalReason: verdict.reason,
      aiDecision: caseRow.decision,
      aiReason: caseRow.reason,
      caseStatus: caseRow.status,
      ...extraDetails,
    },
  });
}
