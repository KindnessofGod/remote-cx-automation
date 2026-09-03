// ---------------------------------------------------------------------------
// noticeReport.js  —  the document a signed-off resignation leaves behind
// ---------------------------------------------------------------------------
// WHAT THIS DOCUMENT IS, AND WHY UC-05 IS THE USE CASE THAT MOST NEEDED ONE
//
// Every other 🟡/🟢 use case in this repository ends in an act somewhere else:
// UC-02 patches an expense at Remote, UC-04's employer approval updates a
// Remote work-authorization request, UC-06 writes a contract amendment. UC-05
// ends nowhere. `UC-05.md` §3, `workflow.js`, `resignationStore.js` and
// `signoffPolicy.js` all say the same sentence in their headers — no Remote
// termination endpoint is confirmed to exist, so **the signed-off report IS the
// durable artifact**. The portal card promises exactly that to the person
// filing: *"HR Ops checks the figures and signs them off, and that signed-off
// summary is the record."*
//
// It did not exist. A row that reached `signed_off` rendered `DOCUMENT: —` in
// "My requests", and every plausible collect route 404'd `no_such_route`. The
// one use case whose entire output is a document produced none — a decision
// that is correct, durable, audited and reaches nobody, which is this
// repository's most expensive recurring shape (CLAUDE.md §7's honest-gaps list,
// five entries deep).
//
// ---------------------------------------------------------------------------
// WHAT IS ON IT, AND WHY EACH ROW IS THERE
// ---------------------------------------------------------------------------
//   THE NOTICE PERIOD AND THE STATUTE IT CAME FROM. A period with no citation
//   is a number the employee cannot check and cannot argue with. `sourceCitation`
//   is the calculator's own — "Código do Trabalho art. 400.º(1)", not "PT".
//
//   THE QUANTITY THE STATUTE STATES, NOT A DERIVED DAY COUNT. BW art. 7:672(4)
//   says "één maand" and `noticeDays` is deliberately null on that row, so
//   prose that interpolated it read **"null days (statutory)"** — which is what
//   the portal printed to a Dutch employee. `noticeQuantity` is the field to
//   render; decisionFacts.js's header rule 2b says the same thing.
//
//   THE DATE IT WAS COUNTED FROM. `noticeStartDate`. Without it a last working
//   day is unreproducible and silently perishable: the same proposed date reads
//   "29 days later than required" counted from one day and "4 days earlier than
//   allowed" counted from another, and nothing on the page said which.
//
//   THE TENURE, because every bracket in the table is selected by it.
//
//   THE HOLIDAY SETTLEMENT WITH ITS WORKING. Not the total alone. See
//   ./payoutWorking.js — an employee supplied four numbers and was shown a
//   fifth, with none of the four beside it.
//
//   WHO SIGNED IT OFF AND WHEN, because that signature is the only thing that
//   turns the calculation into a record, and a record that does not name its
//   signatory is an assertion.
//
// ---------------------------------------------------------------------------
// THE THING THIS DOCUMENT MUST NEVER DO
// ---------------------------------------------------------------------------
// ...is let its reader believe their employment has been ended, or that Remote
// has been told anything. Nothing here reached Remote — there is no endpoint to
// reach — and the closing section says so in plain words rather than leaving it
// to be inferred from an absent row. `NO_REMOTE_WRITE_NOTICE` is interpolated
// rather than paraphrased, for src/uc04/mobilityReview.js's reason: every
// paraphrase anybody writes of "this did not reach Remote" is shorter and more
// reassuring than the original.
//
// NO SALARY, and it is argued rather than inherited. UC-03's travel letter
// carries annual pay because a consulate asks a means-of-subsistence question;
// nobody asks it here. The HOURLY RATE does appear, and only inside the
// settlement working — because it is an input to a figure this document states,
// supplied on the request itself, and a settlement whose multiplier is hidden
// is the exact defect this module was built to fix. No annual, gross or base
// compensation field is read anywhere in this file.
//
// DETERMINISTIC. Every value comes from the stored resignation row or the
// employment record. No LLM output reaches this file. Nothing is invented to
// fill a row — an unknown renders as an em dash, and a figure that was never
// derived renders as a sentence saying so, never as a zero.
// ---------------------------------------------------------------------------

import { escapeHtml } from "../shared/html.js";
import { contractTypeLabel } from "../shared/contractTypes.js";
import { humanTime } from "../shared/settledDecision.js";
import { formatMoney } from "../shared/money.js";
// ONE country-name map, UC-03's, imported rather than copied — src/uc04/
// authorizationRecord.js's reasoning: its own-property guard (finding F-21) is
// why `COUNTRY_NAMES["constructor"]` cannot put a stringified JavaScript
// function on a document.
import { countryName } from "../uc03/letter.js";
import {
  describePayoutWorking,
  describePayoutProvenance,
  describeNoBalanceProvenance,
  describeUnusablePayoutLines,
  payoutProvenanceFromPayout,
} from "./payoutWorking.js";

/** What this document is called, wherever it is named. */
export const NOTICE_REPORT_TYPE = "resignation_notice_report";

/**
 * The negative, in one place, so no paraphrase of it can be shorter than this.
 * Published as a constant for the same reason UC-04's is: it travels onto the
 * collect route's JSON as well as into the HTML, and a test can pin a constant.
 */
export const NO_REMOTE_WRITE_NOTICE =
  "Nothing on this report was sent to Remote. Remote publishes no endpoint that records a resignation, a notice period or a " +
  "final settlement, so Remote's own systems hold no record of any of it — and this report does not end your employment. " +
  "It states what was calculated and that HR Ops confirmed it. Offboarding itself is a separate process, run by people.";

/** The one em dash every unreadable value renders as — never a guess, never a blank. */
const UNKNOWN = "—";

/**
 * The statutory quantity as the statute states it.
 *
 * `noticeQuantity` first, ALWAYS, and `noticeDays` only as a fallback for a row
 * written before that field existed. Reversing the two is how "null days" got
 * onto a screen: a month-denominated rule has no statutory day count, and
 * `noticeDays` is null on it precisely so nothing can print one.
 */
function quantity(notice) {
  if (typeof notice?.noticeQuantity === "string" && notice.noticeQuantity.trim()) return notice.noticeQuantity.trim();
  if (typeof notice?.noticeDays === "number" && Number.isFinite(notice.noticeDays)) {
    return `${notice.noticeDays} day${notice.noticeDays === 1 ? "" : "s"}`;
  }
  return null;
}

/** Length of service, or an explicit statement that it was not established. */
function tenure(notice) {
  if (typeof notice?.tenureMonths !== "number" || !Number.isFinite(notice.tenureMonths)) return UNKNOWN;
  return `${notice.tenureMonths} month${notice.tenureMonths === 1 ? "" : "s"}${notice.onProbation === true ? ", inside the probation period" : ""}`;
}

/**
 * The proposed last working day beside the statutory one.
 *
 * A signed-off report can legitimately carry any of `match`,
 * `later_than_statutory` and `no_proposed_date` — `earlier_than_statutory` is
 * escalated by src/uc05/policyEngine.js and never reaches sign-off, so it can
 * never reach this document either. It is still handled rather than assumed
 * impossible, the same discipline src/portal/letterAccess.js applies to its own
 * "should never happen" branches.
 */
function comparison(notice) {
  const proposed = notice?.proposedEndDate ?? null;
  const statutory = notice?.noticeEndDate ?? null;
  if (!proposed) return "No leaving date was stated on the resignation, so the statutory date above stands on its own.";
  if (!statutory) return `${proposed} was stated as the intended last working day. No statutory end date was worked out, so the two were not compared.`;

  const delta = typeof notice?.discrepancyDays === "number" && Number.isFinite(notice.discrepancyDays) ? notice.discrepancyDays : null;
  if (delta === null) return `${proposed} was stated as the intended last working day, against a statutory end of ${statutory}.`;
  if (delta === 0) return `${proposed} was stated as the intended last working day, which is exactly the statutory date.`;
  if (delta > 0) {
    return `${proposed} was stated as the intended last working day — ${delta} day${delta === 1 ? "" : "s"} beyond the statutory minimum. Working more notice than the minimum is allowed.`;
  }
  return `${proposed} was stated as the intended last working day — ${Math.abs(delta)} day${Math.abs(delta) === 1 ? "" : "s"} short of the statutory minimum.`;
}

/**
 * The holiday settlement, with its arithmetic on the page.
 *
 * NO TOTAL IS PRINTED WHERE NONE WAS DERIVED, and a refusal is not rendered as
 * a zero — finding F-28's rule, restated on a document somebody signs: "we could
 * not work it out" and "nothing is owed" are opposite statements that a bare
 * 0.00 makes indistinguishable.
 *
 * @returns {{heading:string, rows:string[], total:string|null}}
 */
function settlement(payout, ptoSource) {
  const provenance = describePayoutProvenance(ptoSource);

  if (!payout) {
    return {
      heading: "No holiday settlement was reconciled for this resignation.",
      rows: provenance ? [provenance] : [],
      total: null,
    };
  }

  if (payout.computable === false || payout.totalInRemoteInteger === null) {
    return {
      heading:
        "The holiday settlement could NOT be worked out, so no figure is stated. This is the absence of an amount, not an amount of nothing — nothing here says no holiday is owed.",
      rows: [...describeUnusablePayoutLines(payout.unusableLines), ...(provenance ? [provenance] : [])],
      total: null,
    };
  }

  if (payout.source === "no_time_off_records") {
    // A DIFFERENT SENTENCE FROM `provenance`, because a phrasing that says how a
    // figure was arrived at contradicts itself directly under "no figure is
    // stated". See describeNoBalanceProvenance()'s header.
    const silence = describeNoBalanceProvenance(ptoSource);
    return {
      heading:
        "No holiday balance was established for this resignation, so no settlement figure is stated. Nothing here says no holiday is owed — a zero would be a claim nobody made.",
      rows: silence ? [silence] : [],
      total: null,
    };
  }

  const working = describePayoutWorking(payout);
  return {
    heading: "How the settlement figure was worked out:",
    rows: [...working, ...(provenance ? [provenance] : [])],
    total: formatMoney(payout.totalInRemoteInteger, payout.currency ?? "USD"),
  };
}

/** One `<tr>`, with both cells escaped. */
function row(label, value) {
  return `<tr><td style="padding:4px 16px 4px 0;vertical-align:top;white-space:nowrap;">${escapeHtml(label)}</td><td style="padding:4px 0;vertical-align:top;">${escapeHtml(String(value))}</td></tr>`;
}

/**
 * The employee's copy of a signed-off notice and settlement report.
 *
 * PRECONDITION, ENFORCED ELSEWHERE. This renders whatever it is given; whether
 * the employee may have it at all — and whether HR Ops has signed it — is
 * `evaluateResignationReportDelivery()`'s question (./reportDelivery.js).
 * Splitting them keeps this function pure and keeps the gate in one place.
 *
 * @param {object} args
 * @param {object|null} [args.employment]     the fetched Remote employment record, or null —
 *   the document degrades to em dashes rather than inventing a name
 * @param {object} args.resignationRow        the `uc05_resignations` row
 * @param {string|null} [args.ptoSource]      where the leave days came from
 *   (src/uc05/workflow.js's PTO_SOURCE_*). Passed IN rather than read off the row,
 *   because the row does not carry it — the audit row does.
 * @param {string|null} [args.reference]      the ticket / request id, so it can be cited back
 * @param {string} [args.today]               override for tests; defaults to real today
 * @returns {string} HTML
 */
export function renderResignationReportHtml({
  employment = null,
  resignationRow,
  ptoSource = null,
  reference = null,
  today = new Date().toISOString().slice(0, 10),
}) {
  const rowData = resignationRow ?? {};
  const notice = rowData.notice ?? null;
  const payout = rowData.payout ?? null;
  const signedOff = rowData.signedOffBy ?? null;
  const signedOffBy = (typeof signedOff === "string" ? signedOff : signedOff?.approver) ?? UNKNOWN;
  const signedOffAt = humanTime(signedOff?.at ?? rowData.signedOffAt) ?? UNKNOWN;
  const signedOffNote = signedOff?.note ?? rowData.signedOffNote ?? null;

  const countryCode = notice?.countryCode ?? null;
  const country = countryCode ? `${countryName(countryCode)} (${countryCode})` : UNKNOWN;

  const period = quantity(notice);
  const lastWorkingDay = notice?.noticeEndDate ?? null;
  const countedFrom = notice?.noticeStartDate ?? null;
  // `ptoSource` when a caller has it (it is on the workflow's result and on the
  // audit row), the reconciliation's own line stamps when it does not — because
  // `uc05_resignations` has no column for it, and a report collected days later
  // is read back from the row alone. Never defaulted to a guess: both return
  // null when nothing said, and the settlement then states no provenance at all.
  const money = settlement(payout, ptoSource ?? payoutProvenanceFromPayout(payout));

  // THE ANCHOR NOTE. A date moved by a country's own permitted-termination-date
  // rule is a date the reader will otherwise try to reproduce by adding days and
  // fail to. Saying so is the difference between "this is wrong" and "this is
  // why it is not simply the start date plus the notice period".
  const anchorNote =
    notice?.anchorAdjusted === true
      ? " That country's own rule about which dates an employment may end on moved this date, so it is not simply the date above plus the notice period."
      : "";

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Resignation — notice and settlement report</title></head>
<body style="font-family: Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color:#1f2937; max-width:760px; margin:40px auto; line-height:1.6;">
  <p style="text-align:right;">${escapeHtml(today)}${reference ? `<br/>Our reference: ${escapeHtml(String(reference))}` : ""}</p>
  <h2 style="margin-bottom:4px;">Resignation — notice period and final settlement</h2>
  <p style="margin-top:0;">This report states what was calculated from this employment record and this country's statutory
     notice rule, and records that it was checked and signed off by HR Ops. <strong>It does not end an employment</strong>,
     and it is not a legal opinion.</p>

  <h3>Who this is about</h3>
  <table style="border-collapse:collapse;">
    ${row("Employee", employment?.full_name ?? UNKNOWN)}
    ${row("Job title", employment?.job_title || UNKNOWN)}
    ${row("Employment status at filing", employment?.status ?? UNKNOWN)}
    ${row("Contract type", contractTypeLabel(employment?.contract_type, "not recorded"))}
    ${row("Country whose notice rule was applied", country)}
    ${row("Length of service", tenure(notice))}
  </table>

  <h3>Notice period</h3>
  <table style="border-collapse:collapse;">
    ${row("Statutory notice period", period ?? "not determined")}
    ${row("Basis", notice?.basis ?? UNKNOWN)}
    ${row("Rule applied", notice?.sourceCitation ?? "no rule on file")}
    ${row("Counted from", countedFrom ?? "not determined")}
    ${row("Last working day", lastWorkingDay ?? "not determined")}
  </table>
  <p>${
    lastWorkingDay && countedFrom && period
      ? escapeHtml(
          `The notice period of ${period} was counted from ${countedFrom}, which puts the last working day at ${lastWorkingDay}.`
        ) + escapeHtml(anchorNote)
      : escapeHtml(
          "No statutory last working day was produced for this resignation, so none is stated here. A date nobody derived must not appear on a document like this one."
        )
  }</p>
  <p>${escapeHtml(comparison(notice))}</p>

  <h3>Accrued holiday settlement</h3>
  <p>${escapeHtml(money.heading)}</p>
  ${money.rows.length ? `<ul>\n    ${money.rows.map((r) => `<li>${escapeHtml(r)}</li>`).join("\n    ")}\n  </ul>` : ""}
  ${money.total ? `<p><strong>Total accrued holiday settlement: ${escapeHtml(money.total)}</strong></p>` : ""}

  <h3>Sign-off</h3>
  <table style="border-collapse:collapse;">
    ${row("Signed off by", signedOffBy)}
    ${row("Signed off at", signedOffAt)}
    ${row("Recorded where", "This system only. Remote publishes no endpoint for a resignation, so there is nothing at Remote to update.")}
  </table>
  ${signedOffNote ? `<p><strong>Note left at sign-off:</strong> ${escapeHtml(String(signedOffNote))}</p>` : ""}

  <h3>What this report does not say</h3>
  <p>${escapeHtml(NO_REMOTE_WRITE_NOTICE)}</p>
  <p>The notice period above is the statutory minimum for the country named, taken from the rule cited. It is not a reading of
     an employment contract — this system holds no contracts and has read none — so a contract may require longer notice, and
     nothing here has looked. This is general information, not legal advice.</p>
</body></html>`;
}

/**
 * A filename a browser can save it under — built from the record id, never from
 * the employee's name (src/uc03/letterDelivery.js's reasoning: a name in a
 * filename travels into download folders, mail attachments and screenshots).
 */
export function noticeReportFilename(resignationId) {
  return `resignation-notice-report-${resignationId}.html`;
}
