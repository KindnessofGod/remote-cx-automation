// ---------------------------------------------------------------------------
// authorizationRecord.js  —  the document a cleared workation leaves behind
// ---------------------------------------------------------------------------
// WHAT THIS DOCUMENT IS, AND WHY IT IS NOT A SECOND TRAVEL LETTER
//
// UC-03 issues a TRAVEL LETTER: a certificate of employment addressed to a
// consulate, which is why it carries an annual gross salary — the Commission's
// Visa Code Handbook I names MEANS OF SUBSISTENCE as its own evidential head and
// a certificate of employment against it (src/uc03/letter.js's header quotes the
// three heads verbatim). That letter answers a consulate's questions.
//
// UC-04's artifact answers a different question, asked by a different reader.
// UC-04.md §5 says it outright: *"There is no separate 'issue a letter' step in
// this UC; the authorization IS the artifact."* What the employee needs to hold
// is the RECORD OF WHO DECIDED WHAT — because this use case's decisions are
// spread across three parties and two systems, and until now the employee could
// see none of them. So this is a record of decisions, not a letter to an
// authority.
//
// WHICH IS ALSO THE WHOLE ARGUMENT FOR THERE BEING NO SALARY ON IT.
// Compensation answers a means-of-subsistence question nobody is asking here.
// UC-01's employment-verification letter is pay-free for exactly that reason and
// two tests pin it; the same rule applies for the same reason, and this module
// reads no compensation field of any kind — not `base_salary`, not
// `contract_details.annual_gross_salary`, not
// `payment_terms.compensation_gross_amount`. A test asserts that structurally as
// well as behaviourally, because "it happens not to render one" and "it cannot"
// are different guarantees and only the second survives an edit.
//
// THE THING THIS DOCUMENT MUST NEVER DO is let its reader believe Remote's own
// systems hold a clearance. Two of the three stages here happened in THIS
// system, and stage 3 has no Remote endpoint at all (./mobilityReview.js). Every
// row below therefore names WHERE the decision lives, and the closing paragraph
// says the negative in plain words rather than leaving it to be inferred from an
// absent row. `MOBILITY_REVIEW_NOTICE_FOR_EMPLOYEE` is interpolated rather than
// paraphrased: every paraphrase anybody writes of "this did not reach Remote" is
// shorter and more reassuring than the original.
//
// REUSE, NOT A SECOND COPY. `escapeHtml`, `contractTypeLabel`, `countryName` and
// `withDisclaimer` are the same helpers UC-01's and UC-03's letters use. What is
// NOT shared is the letterhead markup, because there is no shared letterhead in
// this repository to share — uc01/letter.js and uc03/letter.js each hold their
// own, and factoring one out means editing two files this build does not own.
// Named here as a real (small) duplication rather than left to be discovered.
//
// DETERMINISTIC. Every value comes from the stored authorization row, the
// employment record, the legal entity, or the stage-3 audit row. No LLM output
// reaches this file, and nothing is invented to fill a row — an unknown renders
// as an em dash.
// ---------------------------------------------------------------------------

import { escapeHtml } from "../shared/html.js";
import { withDisclaimer } from "../shared/disclaimer.js";
import { contractTypeLabel } from "../shared/contractTypes.js";
import { humanTime } from "../shared/settledDecision.js";
// ONE country-name map, UC-03's, imported rather than copied. Its own-property
// guard (finding F-21) is the reason to import it rather than write a second
// one: `COUNTRY_NAMES["constructor"]` would otherwise put a stringified
// JavaScript function on a document.
import { countryName } from "../uc03/letter.js";
import { MOBILITY_REVIEW_NOTICE_FOR_EMPLOYEE, employerApprovalState } from "./mobilityReview.js";

/** What this document is called, wherever it is named. */
export const AUTHORIZATION_RECORD_TYPE = "work_authorization_record";

/** The one em dash every unreadable value renders as — never a guess, never a blank. */
const UNKNOWN = "—";

/**
 * The employee's copy of a cleared work authorization.
 *
 * PRECONDITION, ENFORCED ELSEWHERE. This renders whatever it is given; whether
 * the employee may have it at all is `evaluateAuthorizationRecordDelivery()`'s
 * question (./recordDelivery.js), and whether a stage-3 clearance exists is
 * `readMobilityReview()`'s. Splitting them keeps this function pure and keeps
 * the gate in one place rather than two.
 *
 * @param {object} args
 * @param {object} args.employment        the fetched Remote employment record
 * @param {object|null} [args.legalEntity]  the fetched legal entity, or null — the
 *   document degrades to naming no entity rather than inventing one
 * @param {object} args.authorizationRow  the `uc04_authorizations` row
 * @param {object} args.review            the stage-3 verdict (./mobilityReviewLog.js)
 * @param {string|null} [args.reference]  the ticket / request id, so the record can be cited back
 * @param {string} [args.today]           override for tests; defaults to real today
 * @returns {string} HTML
 */
export function renderWorkAuthorizationRecordHtml({
  employment,
  legalEntity = null,
  authorizationRow,
  review,
  reference = null,
  today = new Date().toISOString().slice(0, 10),
}) {
  const row = authorizationRow ?? {};
  const factors = row.factors ?? {};
  const employer = employerApprovalState(row);

  const destinationCode = factors.destination?.country ?? null;
  const destination = destinationCode ? `${countryName(destinationCode)} (${destinationCode})` : UNKNOWN;
  const travelWindow =
    factors.startDate && factors.endDate
      ? `${factors.startDate} to ${factors.endDate}`
      : factors.startDate || factors.endDate || UNKNOWN;

  const entityName = legalEntity?.name ?? null;
  const entityJurisdiction = legalEntity?.country_name || legalEntity?.country_code || null;

  const employedBy = entityName
    ? `${escapeHtml(entityName)}${entityJurisdiction ? `, registered in ${escapeHtml(entityJurisdiction)}` : ""}`
    : UNKNOWN;

  // THE THREE STAGES, EACH NAMING WHERE ITS DECISION LIVES. That last column is
  // the reason this table exists rather than a paragraph: "approved" and
  // "approved somewhere anybody can look it up" are different facts, and this
  // use case's three stages differ on exactly that.
  const stages = [
    {
      stage: "1 · Requested",
      who: row.requester ?? UNKNOWN,
      when: humanTime(row.createdAt) ?? UNKNOWN,
      outcome: "Filed",
      where: "This system. Remote publishes no API that creates a work-authorization request.",
    },
    {
      stage: "2 · Employer approval",
      who: employer.approver ?? UNKNOWN,
      when: humanTime(employer.at) ?? UNKNOWN,
      outcome: "Approved by the customer's manager",
      where: employer.transmittedToRemote
        ? "Sent to Remote — the work-authorization request was updated there."
        : "This system only. No Remote work-authorization request was linked to this trip, so there was nothing at Remote to update.",
    },
    {
      stage: "3 · Remote's mobility review",
      who: review?.reviewer ?? UNKNOWN,
      when: humanTime(review?.at) ?? UNKNOWN,
      outcome: review?.outcome === "cleared" ? "Cleared" : "Declined",
      where: "This system only. Remote publishes no endpoint for this stage, so Remote's own systems hold no record of it.",
    },
  ];

  const body = `<!doctype html>
<html><head><meta charset="utf-8"><title>Work Authorization Record</title></head>
<body style="font-family: Arial, sans-serif; max-width: 760px; margin: 40px auto; line-height: 1.5;">
  <p style="text-align:right;">${escapeHtml(today)}${reference ? `<br/>Our reference: ${escapeHtml(String(reference))}` : ""}</p>
  <h2>Work Authorization — record of decisions</h2>
  <p>This is a record of the decisions taken on one remote-work request. It is <strong>not</strong> a visa, a work
     permit, or an immigration clearance, and it is not addressed to any authority.</p>
  <table style="border-collapse:collapse;">
    <tr><td style="padding:4px 12px 4px 0;">Employee</td><td>${escapeHtml(employment?.full_name ?? UNKNOWN)}</td></tr>
    <tr><td style="padding:4px 12px 4px 0;">Job title</td><td>${escapeHtml(employment?.job_title || UNKNOWN)}</td></tr>
    <tr><td style="padding:4px 12px 4px 0;">Employment status</td><td>${escapeHtml(employment?.status ?? UNKNOWN)}</td></tr>
    <tr><td style="padding:4px 12px 4px 0;">Contract type</td><td>${escapeHtml(contractTypeLabel(employment?.contract_type, "not recorded"))}</td></tr>
    <tr><td style="padding:4px 12px 4px 0;">Employed by</td><td>${employedBy}</td></tr>
    <tr><td style="padding:4px 12px 4px 0;">Destination</td><td>${escapeHtml(destination)}</td></tr>
    <tr><td style="padding:4px 12px 4px 0;">Travel dates</td><td>${escapeHtml(travelWindow)}</td></tr>
  </table>
  <h3>What was decided, by whom, and where it is recorded</h3>
  <table style="border-collapse:collapse;">
    <tr>
      <th style="text-align:left;padding:4px 12px 4px 0;">Stage</th>
      <th style="text-align:left;padding:4px 12px 4px 0;">Decided by</th>
      <th style="text-align:left;padding:4px 12px 4px 0;">When</th>
      <th style="text-align:left;padding:4px 12px 4px 0;">Outcome</th>
      <th style="text-align:left;padding:4px 12px 4px 0;">Recorded where</th>
    </tr>
    ${stages
      .map(
        (s) =>
          `<tr>
      <td style="padding:4px 12px 4px 0;vertical-align:top;">${escapeHtml(s.stage)}</td>
      <td style="padding:4px 12px 4px 0;vertical-align:top;">${escapeHtml(String(s.who))}</td>
      <td style="padding:4px 12px 4px 0;vertical-align:top;">${escapeHtml(String(s.when))}</td>
      <td style="padding:4px 12px 4px 0;vertical-align:top;">${escapeHtml(s.outcome)}</td>
      <td style="padding:4px 12px 4px 0;vertical-align:top;">${escapeHtml(s.where)}</td>
    </tr>`
      )
      .join("\n    ")}
  </table>
  ${review?.note ? `<p><strong>Note left by Remote's reviewer:</strong> ${escapeHtml(String(review.note))}</p>\n  ` : ""}<h3>What this record does not say</h3>
  <p>${escapeHtml(MOBILITY_REVIEW_NOTICE_FOR_EMPLOYEE)}</p>
  <p>Nothing here assesses whether you may lawfully enter or work in the destination country. That remains a
     question for the destination's own authorities.</p>
  ${entityName ? `<p>Issued by ${escapeHtml(entityName)}.</p>` : ""}
</body></html>`;

  // The mandatory travel disclaimer, appended by the shared injector — the same
  // one every customer-facing UC-03 artifact carries, so a document about
  // travelling to work somewhere cannot be produced without it.
  return withDisclaimer(body, "travel");
}

/**
 * A filename a browser can save it under — built from the record id, never from
 * the employee's name (src/uc03/letterDelivery.js's own reasoning: a name in a
 * filename travels into download folders, mail attachments and screenshots).
 */
export function authorizationRecordFilename(authorizationId) {
  return `work-authorization-record-${authorizationId}.html`;
}
