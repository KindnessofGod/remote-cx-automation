// ---------------------------------------------------------------------------
// letter.js  —  UC-01 letter rendering
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
// Once the gates pass, we build the actual employment verification letter from
// AUTHORITATIVE data (the fields fetched from Remote) — never from anything the
// LLM wrote. Here we render HTML. In production you'd pass this HTML to a
// headless renderer (Playwright/Puppeteer/WeasyPrint) to produce a PDF; that's
// the `pdf-service` in the foundation doc. HTML is enough to see it working.
// ---------------------------------------------------------------------------

// The engagement type in words comes from `src/shared/contractTypes.js`, which
// is the ONE copy. This file used to hold its own four-entry map; so did
// `src/shared/employeeSubject.js` and `src/uc03/letter.js`, none of them knowing
// what the others held, and none of them holding an entry for `global_payroll`
// — which is what the LIVE API returns and what leaked to a specialist as a raw
// slug. See that module's header for the grounding of every value.
import { contractTypeLabel } from "../shared/contractTypes.js";

/**
 * Render the standard employment verification letter as HTML.
 * @param {object} employment  fetched employment record
 * @param {object} legalEntity fetched legal entity — {name, address} from the
 *   mock, or {name, country_code} from the real API (no address field is
 *   exposed there; see restClient.js's getLegalEntity() comment).
 * @param {object} [options]
 * @param {string|null} [options.requestingParty]  E4-F17 (rca-0nm): who
 *   actually asked for this letter, when it was not the employee. Every
 *   auto-resolve letter (workflow.js's STEP 7a) and every self-service one
 *   (selfServiceLetter.js) is genuinely the employee's own request and passes
 *   nothing here, which keeps the default sentence below unchanged. The one
 *   caller that DOES pass this is review/service.js's approve path, on the
 *   `third_party_request` reason — a bank or landlord asked, with the
 *   employee's consent on record, and the letter used to tell the reader the
 *   employee had asked, which was false in a formal document going to the
 *   third party's own address. See test/thirdPartyLetter.test.js.
 * @param {string|null} [options.reference]  rca-tlb2 (R7-20): the portal tells
 *   the requester this is "the one to quote when asking anyone to trace it",
 *   but until now it was printed nowhere on the document itself — only the
 *   download filename carried it, which a landlord or letting agent holding a
 *   printed or forwarded copy never sees. Callers pass the same reference the
 *   requester was shown (`externalRef`/the ticket id); when none exists yet
 *   the row is simply omitted, the same convention `job_title`'s absence
 *   already uses below.
 * @returns {string} HTML
 */
export function renderLetterHtml(employment, legalEntity, options = {}) {
  const contract = contractTypeLabel(employment.contract_type, "not recorded");
  const today = new Date().toISOString().slice(0, 10);
  const entityLocation = legalEntity.address || legalEntity.country_code || "";
  const requestingParty =
    typeof options.requestingParty === "string" && options.requestingParty.trim() ? options.requestingParty.trim() : null;
  const reference =
    typeof options.reference === "string" && options.reference.trim() ? options.reference.trim() : null;
  // ADDRESSED TO WHOEVER ASKED (2026-08-28, owner: "if First Bank sent the
  // request, the letter should be addressed to them").
  //
  // "To Whom It May Concern" is right for a letter the EMPLOYEE was given to
  // hand around — they do not know yet who will read it. It is wrong for a
  // letter answering a named institution that asked a specific question about a
  // specific person, which is what a third-party disclosure is: a real bank
  // receives a letter with their own name on it, and a generic one reads as a
  // template nobody checked.
  //
  // Falls back to the generic form whenever no party is named, which is every
  // employee-requested and self-service letter — those are unchanged.
  const addresseeLines = requestingParty
    ? [requestingParty, typeof options.returnAddress === "string" ? options.returnAddress.trim() : ""].filter(Boolean)
    : [];
  const addresseeBlock = addresseeLines.length
    ? `\n    <div class="addressee">${addresseeLines.map((l) => `<p>${escapeHtml(l)}</p>`).join("")}</div>\n`
    : "";
  // "Dear Sir or Madam" under a named addressee block is the ordinary business
  // form — better than "Dear First National Bank," which reads as a mail merge.
  const salutation = requestingParty ? "Dear Sir or Madam," : "To Whom It May Concern,";

  const provenanceSentence = requestingParty
    ? `This letter is issued upon a request from <strong>${escapeHtml(requestingParty)}</strong>, with the employee's consent, for employment verification purposes.`
    : `This letter is issued upon the employee's request for employment verification purposes.`;

  // --- THE CUSTOMIZED LETTER, and why it is a SECOND DOCUMENT ---------------
  // Owner decision 2026-08-28. Remote's own product has two: the standard
  // template (instant, self-service, salary-free) and the customized letter —
  // "None of these templates fits my needs" — which a person prepares and
  // which may state things the template never does. See
  // docs/UC01-INTAKE-FIELDS.md §2/§4.
  //
  // So this is NOT the standard letter learning to print a salary. When
  // `authorisedFields` is empty — which is EVERY automatic issuance, every
  // self-service click, and every path that does not pass through a named
  // human — this function is byte-identical to what it has always produced,
  // and `test/uc01.test.js`'s money invariant still holds over it unchanged.
  // The extra rows exist only downstream of a specialist who saw each value
  // and said yes (src/uc01/disclosureFields.js).
  //
  // THE VALUES ARE NOT THIS FILE'S TO CHOOSE. Each arrives already read from
  // the Remote record and already formatted; nothing here parses, scales,
  // rounds or defaults a figure, because the one thing worse than declining to
  // state a salary is stating the wrong one. A field the record could not
  // support never reaches this list at all — `authorisableDisclosures()`
  // dropped it, and the specialist was shown it as unavailable before they
  // decided, so an approval can never silently produce a blank row.
  const authorisedFields = Array.isArray(options.authorisedFields)
    ? options.authorisedFields.filter(
        (d) => d && typeof d.label === "string" && typeof d.value === "string" && d.value.trim() !== ""
      )
    : [];
  const isCustomized = authorisedFields.length > 0;
  const authorisedBy =
    typeof options.authorisedBy === "string" && options.authorisedBy.trim() ? options.authorisedBy.trim() : null;
  const authorisedRows = authorisedFields
    .map((d) => `<tr><th>${escapeHtml(d.label)}</th><td>${escapeHtml(d.value)}</td></tr>`)
    .join("\n        ");

  // NO SALARY OR COMPENSATION IS DISCLOSED HERE, and the enforcement is this
  // template's own field list — not, as this comment used to claim,
  // `STANDARD_LETTER_FIELDS`.
  //
  // That claim was false in a way worth recording, because it is the kind of
  // false that reads as reassuring. `STANDARD_LETTER_FIELDS` (policyEngine.js)
  // is the list of fields a REQUESTER may ask for without tripping the
  // over-scope gate. It is not consulted here and never has been: nothing
  // imports it into this file. The reason no salary reaches a customer is
  // simply that the table below names its rows one by one and none of them is
  // a compensation field — a structural guarantee, but a different one, and
  // pointing at the wrong mechanism is how a future edit "safely" adds a row
  // on the strength of a filter that does not exist.
  //
  // The two lists also genuinely disagree: this template renders `job_title`,
  // which `STANDARD_LETTER_FIELDS` does not contain. The disagreement is
  // conservative rather than dangerous — a request that explicitly asks for a
  // job title is routed to a human even though the letter would have printed
  // it anyway — so it costs a needless review, never a disclosure. Aligning
  // them means editing the n8n port of the same list
  // (`workflows/nodes/gates.js`) in the same change, or `test/n8nParity.test.js`
  // fails; it is recorded here rather than done by halves.
  //
  // `test/uc01.test.js`'s "the rendered letter contains no value the record
  // carries as compensation" asserts the guarantee against the RENDERED
  // output, driven from the record's own numbers rather than hard-coded ones.
  //
  // NOTE: the font stack names Inter first but imports NOTHING, and that is a
  // decision rather than an omission. This letter is a real customer-facing
  // document — workflow.js posts it to a Zendesk ticket as html_body and
  // src/pdf/ renders it to PDF — so it is opened by the employee and by
  // whoever they forwarded it to: a landlord, a bank, an immigration officer.
  //
  // The template used to pull a webfont from a third-party CDN. That meant
  // every one of those readers silently called that third party on open,
  // handing over their IP, user agent and referrer, which leaks the fact that
  // a named person is reading an employment verification document to a company
  // with no part in the transaction. For an EOR operating in the EU that is
  // not hypothetical: a Munich court found in 2022 that embedding Google Fonts
  // without consent breached GDPR. It was also a reliability problem — PDF
  // rendering fetched the font at generation time, so a blocked network
  // changed the typography of a legal-ish document with nothing to show for it.
  //
  // Readers who have Inter installed still get it; everyone else falls back to
  // their own system font. Nothing is fetched either way, and the test
  // "the letter fetches nothing from anywhere" in test/uc01.test.js keeps it
  // that way. This comment stays OUT of the returned HTML on purpose: internal
  // reasoning belongs in the source, not in the document a customer receives.
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Employment Verification Letter</title>
  <style>
    body {
      font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      color: #1f2937;
      background: #ffffff;
      margin: 0;
      padding: 0;
      line-height: 1.6;
    }
    .page {
      max-width: 720px;
      margin: 48px auto;
      padding: 64px;
      border: 1px solid #e5e7eb;
      box-shadow: 0 4px 24px rgba(0,0,0,0.06);
    }
    .letterhead {
      border-bottom: 2px solid #111827;
      padding-bottom: 24px;
      margin-bottom: 40px;
    }
    .letterhead h1 {
      font-size: 22px;
      font-weight: 700;
      margin: 0 0 4px 0;
      color: #111827;
    }
    .letterhead p {
      margin: 0;
      font-size: 13px;
      color: #6b7280;
    }
    .date {
      text-align: right;
      font-size: 14px;
      color: #4b5563;
      margin-bottom: 32px;
    }
    .subject {
      font-size: 18px;
      font-weight: 600;
      margin: 0 0 24px 0;
      color: #111827;
    }
    .body-text {
      font-size: 15px;
      margin-bottom: 32px;
    }
    .details-table {
      width: 100%;
      border-collapse: collapse;
      margin: 24px 0 32px 0;
      font-size: 14px;
    }
    .details-table th,
    .details-table td {
      text-align: left;
      padding: 12px 16px;
      border-bottom: 1px solid #e5e7eb;
    }
    .details-table th {
      width: 40%;
      color: #6b7280;
      font-weight: 500;
      background: #f9fafb;
    }
    .details-table td {
      font-weight: 500;
      color: #111827;
    }
    .disclaimer {
      font-size: 13px;
      color: #6b7280;
      border-top: 1px solid #e5e7eb;
      padding-top: 24px;
      margin-top: 40px;
    }
    .signature {
      margin-top: 48px;
    }
    .signature p {
      margin: 4px 0;
      font-size: 14px;
    }
    .signature .name {
      font-weight: 600;
      color: #111827;
    }
  </style>
</head>
<body>
  <div class="page">
    <div class="letterhead">
      <h1>${escapeHtml(legalEntity.name)}</h1>
      <p>${entityLocation ? escapeHtml(entityLocation) : "Employer of Record"}</p>
    </div>

    <div class="date">${today}</div>
${addresseeBlock}
    <p class="subject">${isCustomized ? "Customized Employment Verification Letter" : "Employment Verification Letter"}</p>

    <div class="body-text">
      <p>${salutation}</p>
      <p>
        This letter confirms that <strong>${escapeHtml(employment.full_name)}</strong>
        is employed by <strong>${escapeHtml(legalEntity.name)}</strong> in the capacity
        detailed below. ${provenanceSentence}
      </p>
    </div>

    <table class="details-table">
      <tbody>
        ${reference ? `<tr><th>Reference</th><td>${escapeHtml(reference)}</td></tr>` : ""}
        <tr><th>Employee name</th><td>${escapeHtml(employment.full_name)}</td></tr>
        ${employment.job_title ? `<tr><th>Job title</th><td>${escapeHtml(employment.job_title)}</td></tr>` : ""}
        <tr><th>Employment status</th><td>${escapeHtml(employment.status)}</td></tr>
        <tr><th>Contract type</th><td>${escapeHtml(contract)}</td></tr>
        <tr><th>Start date</th><td>${escapeHtml(employment.start_date)}</td></tr>
        <tr><th>On probation</th><td>${employment.probation ? "Yes" : "No"}</td></tr>
        <tr><th>Employer of Record</th><td>${escapeHtml(legalEntity.name)}${entityLocation ? `, ${escapeHtml(entityLocation)}` : ""}</td></tr>
        ${authorisedRows}
      </tbody>
    </table>

    <div class="body-text">
      <p>
        ${
          isCustomized
            ? `This letter states additional details beyond the standard template, released at the employee's request` +
              `${authorisedBy ? ` and authorised by ${escapeHtml(authorisedBy)}` : ""} on ${today}.` +
              ` No employment fact is stated here that is not held on the employee's record.`
            : `This verification covers the standard employment facts listed above only.
        Financial details and other confidential employment terms are not
        disclosed in this letter.`
        }
      </p>
      <p>
        For further verification, please contact our support team at the address
        listed above.
      </p>
    </div>

    <div class="signature">
      <p>Sincerely,</p>
      <p class="name">${escapeHtml(legalEntity.name)}</p>
      <p>Employer of Record</p>
    </div>

    <p class="disclaimer">
      This letter is generated automatically for employment verification purposes.
      It does not constitute a legal contract or offer of employment.
    </p>
  </div>
</body>
</html>`;
}

function escapeHtml(text) {
  if (text == null) return "";
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
