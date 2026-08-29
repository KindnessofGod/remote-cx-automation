// ---------------------------------------------------------------------------
// scenarios.js  —  RULE 3: scenarios are DISCOVERED, never fixtured
// ---------------------------------------------------------------------------
// "Query the deployed audit API for the most recent real decision of each
// required reason. A fixture we control is how src/remote/mockServer.js came
// to teach the wrong response shape. `all_gates_passed` MUST be among the
// required reasons and its absence must FAIL the run. C-16 is why: UC-03
// could not auto-resolve for ANY input, ever, and every fail-closed assertion
// passed, because refusing correctly and being unable to succeed are
// indistinguishable from outside."
//
// So `discoverScenarios()` never returns a scenario it invented — it returns
// EITHER the real, most-recent decision row of a required reason, OR a
// MissingScenarioError, which the caller (runner.js) turns into a FAILURE, not
// a skip.
// ---------------------------------------------------------------------------

import { fetchAllDecisions, fetchDecision } from "./auditApi.js";

/**
 * The reasons this runner requires evidence of, for UC-01, and why each one is
 * on the list (qa/contracts/UC-01-acceptance.md §16, and the eleven determinate
 * findings named in rca-tcj).
 */
export const REQUIRED_REASONS = Object.freeze([
  {
    reason: "all_gates_passed",
    label: "clean auto-resolve — the positive lead",
    required: true, // MUST exist; absence is C-16's shape and must FAIL, never skip
    why: "§16 item 1/2/5; without a real all_gates_passed decision this run cannot tell 'refuses correctly' from 'cannot succeed'.",
  },
  {
    reason: "identity_not_verified",
    label: "unauthenticated requester quoting a real employment id",
    required: true,
    why: "E3-F12 / E4-F14 / F-12 — the subject-withholding fact this runner exists to check on every surface.",
  },
  {
    reason: "third_party_request",
    label: "a bank/landlord/vendor disclosure request",
    required: true,
    why: "§16 items 11/12 — a positive third-party run must exist; the refusal path alone proves nothing.",
  },
  {
    reason: "employee_not_active",
    label: "an eligibility refusal (archived employee)",
    required: false,
    why: "F-11/F-13 — the escalate/blocked branches' note and tagging.",
  },
]);

export class MissingScenarioError extends Error {
  constructor(reason, why) {
    super(
      `no real decision with reason="${reason}" was found in the deployed audit log — ${why} ` +
        "This is a FAILURE (exit 1), not a skip: a check that silently passes when a required scenario " +
        "cannot be found is indistinguishable from that scenario always failing (C-16)."
    );
    this.name = "MissingScenarioError";
    this.reason = reason;
  }
}

/**
 * @param {object} opts
 * @param {string} opts.baseUrl
 * @param {string} opts.portalKey
 * @param {string} [opts.useCase]
 * @param {typeof fetch} [opts.fetchImpl]
 * @param {{reason:string, required:boolean, label:string, why:string}[]} [opts.requiredReasons]
 * @returns {Promise<{found: object[], missingRequired: MissingScenarioError[]}>}
 *   `found` is one scenario object per reason that has at least one real
 *   decision — {reason, label, decision} where `decision` is the most recent
 *   row (by `at` desc) carrying that reason.
 */
// src/portal/server.js's REFERENCE_RELINKED_ACTION — duplicated as a literal
// rather than imported, because that module is the portal's HTTP handler
// (heavy, side-effecting to import) and this file talks to it only over REST,
// per this runner's own design (rule 2). Recorded as its own row rather than a
// bare string at each use site so the two call sites below stay obviously the
// same fact.
const TICKET_RELINK_ACTION = "portal_reference_relinked";

export async function discoverScenarios({
  baseUrl,
  portalKey,
  useCase = "UC-01",
  fetchImpl = fetch,
  requiredReasons = REQUIRED_REASONS,
}) {
  const all = await fetchAllDecisions({ baseUrl, portalKey, useCase, fetchImpl });
  // `all` is already newest-first (order by at desc, id desc) per readStore.js.
  // KEYED BY REASON, AND BY ACTION WHERE THERE IS NO REASON — 2026-08-23.
  //
  // UC-07 and UC-08 record NO `reason` on ANY decision: 21 and 7 rows in
  // production, every one `escalate`, the column empty throughout. Keyed on
  // reason alone they discovered nothing, so every fact ran on zero scenarios
  // and the runner reported "could not tell" forever — a 🔴 use case whose
  // whole guarantee is that nothing may be approved was UNMEASURABLE by the
  // instrument built to measure it.
  //
  // For a use case with no execution path the ESCALATION IS THE SUCCESS PATH,
  // so a registry may name its scenario by `action` instead. A spec supplies
  // one or the other, never both.
  //
  // This does NOT bless the empty column. "Correct by construction" and "the
  // field was never populated" are indistinguishable from outside, which is
  // this repository's oldest recurring defect; the registries record the
  // absence explicitly so it stays a known question rather than a silence.
  const byReason = new Map();
  const byAction = new Map();
  for (const d of all) {
    if (d.action && d.action !== TICKET_RELINK_ACTION && !byAction.has(d.action)) {
      byAction.set(d.action, d);
    }
    if (!d.reason) continue;
    // rca-whir: a ticket-relink row now carries the REASON of the decision it
    // relinked (src/portal/server.js's recordTicketRelink()), so it can sit
    // under the same key here — but it is not itself a decision, and letting
    // it win this race would replace `decision.action` (the real gate outcome,
    // e.g. "human_review") with the relink event's own action name, silently
    // stopping every fact keyed on `.action` (internalNoteNotBareSlug,
    // escalateNeverInstructsApprove) from ever being exercised, in exchange
    // for a ticket id this loop can fetch a different way below. Skipped here,
    // never selected as `decision`.
    if (d.action === TICKET_RELINK_ACTION) continue;
    if (!byReason.has(d.reason)) byReason.set(d.reason, d); // first hit = newest
  }

  const found = [];
  const missingRequired = [];
  for (const spec of requiredReasons) {
    const decision = spec.reason ? byReason.get(spec.reason) : byAction.get(spec.action);
    if (decision) {
      // GOTCHA FOUND BUILDING THIS RUNNER, 2026-08-22: the list summary's
      // top-level `externalRef` is `details->>'externalRef'`
      // (readStore.js:356) — and for third-party-door-sourced decisions,
      // THAT field holds the door's own minted case reference (a UUID used as
      // the idempotency claim key), NOT the Zendesk ticket the hand-off
      // created. The real ticket number lives at `details.ticketId`. Using
      // `externalRef` uniformly as "the Zendesk ticket id" silently made
      // every Zendesk-facing surface read `Number("530b3977-…")` -> NaN ->
      // null for this scenario, which this loop would otherwise have reported
      // as a quiet, misleading "na" on every fact for third_party_request —
      // not a defect in the product, a defect in this runner's own field
      // assumption. Fetching the full decision (one extra real API call, per
      // rule 3 still fully "discovered") resolves the actual ticket id.
      const full = await fetchDecision({ baseUrl, portalKey, id: decision.id, fetchImpl });
      const details = full.decision?.details ?? {};
      let zendeskTicketId =
        details.ticketId ?? (Number.isInteger(Number(decision.externalRef)) ? decision.externalRef : null);

      // rca-whir: UC-02 (and every other portal-ticketed use case) creates its
      // Zendesk ticket AFTER the decision is already durably audited
      // (src/portal/ticketing.js's raiseTicketIfNeeded()), so the ticket id
      // usually lands on a SEPARATE, later row rather than on the decision row
      // itself — a `portal_reference_relinked` row correlated to this exact
      // decision by the record id both carry (readStore.js's
      // CORRELATION_FIELDS, e.g. `storeId` for UC-02), which is exactly what
      // `full.siblings` above was already computed from. Only reached when the
      // decision carries no ticket id of its own; a decision that already
      // resolved one (UC-01's third-party path, which sets `ticketId` directly
      // on its own follow-up row — see the gotcha above) never pays this
      // second fetch.
      if (!zendeskTicketId) {
        const relinkSibling = (full.siblings ?? []).find((s) => s.action === TICKET_RELINK_ACTION);
        if (relinkSibling) {
          const relinkFull = await fetchDecision({ baseUrl, portalKey, id: relinkSibling.id, fetchImpl });
          zendeskTicketId = relinkFull.decision?.details?.ticketId ?? null;
        }
      }

      // An action-keyed scenario labels itself by its action, so the grid and
      // every "no scenario for X" message name something a reader can find in
      // the audit log rather than the word "null".
      found.push({ reason: spec.reason ?? spec.action, label: spec.label,
                   decision: { ...decision, zendeskTicketId } });
    } else if (spec.required) {
      missingRequired.push(new MissingScenarioError(spec.reason ?? spec.action, spec.why));
    }
    // required:false and missing -> silently absent from `found`; the caller
    // simply has fewer facts to check, which is not the same failure mode as
    // a REQUIRED reason being absent.
  }

  return { found, missingRequired, totalScanned: all.length };
}
