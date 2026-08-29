// ---------------------------------------------------------------------------
// letterDelivery.js  —  Handing an issued self-service letter to the employee it is about
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
//
// `issueSelfServiceLetter()` (./selfServiceLetter.js) writes and returns the
// standard employment verification letter in ONE call — there is no draft, no
// sign-off, no second visit. The portal's initial response used to carry the
// rendered HTML straight back in `letterHtml` and the browser never read that
// field (round-6 D-01: "Pressing 'Get my letter' produces a complete, correct
// letter and returns it in the HTTP response. The screen shows no letter, no
// preview, no link, no download"). Worse, the row this call writes to `cases`
// had no ownership rule at all (src/portal/ownership.js), so returning to "My
// requests" later — which is the ONLY thing the result panel told the
// employee to do — answered `"reason":"No ownership rule exists for uc01."`
// and listed nothing. A letter that is correct, durable, audited, and reaches
// nobody is this repository's most expensive recurring shape
// (CLAUDE.md §7's honest-gaps list).
//
// This module is UC-03's `letterDelivery.js` (see its header for the fuller
// argument) applied to UC-01's much simpler shape: there is no DRAFTED state,
// because `issueSelfServiceLetter()` never writes a `cases` row unless the
// letter was ALSO written and issued in the same call — a case existing on
// this store therefore always means a letter document exists beside it. Two
// states remain rather than three: ISSUED, and every refusal that means "this
// is not yours to open".
//
// PURE. Rows in, a verdict out. No store, no clock, no network.
// ---------------------------------------------------------------------------

/** The `documents.type` an issued self-service letter is stored under. */
export const LETTER_DOCUMENT_TYPE = "employment_verification_letter";

export const DELIVERY_REFUSALS = {
  case_not_found: { status: 404, reason: "No employment verification letter request exists with this id." },
  session_required: {
    status: 401,
    reason:
      "An employment verification letter is about one named employee, so collecting it needs the same authenticated session the letter was issued to.",
  },
  not_the_employee: {
    status: 403,
    reason: "An employment verification letter may only be collected by the employee it is about.",
  },
  no_letter_on_this_case: {
    status: 404,
    reason: "No letter document is stored on this request.",
  },
};

/**
 * May this session collect this case's letter, and is there one to collect?
 *
 * ORDER IS DELIBERATE, matching every other gate in this repository:
 * request-shaped checks first (is there a case, is there a session, is it the
 * right person), then the state of the artifact.
 *
 * @param {object} args
 * @param {object|null} args.caseRow   the `cases` row (camelCase), UC-01-scoped by the caller
 * @param {object|null} args.session   `{authenticatedEmploymentId}` — the employee's own, never a body claim about someone else
 * @param {object|null} [args.letterDocument]  the stored `employment_verification_letter`,
 *   passed IN rather than looked up so this stays pure
 * @returns {{allowed:boolean, code:string, reason:string, status:number}}
 */
export function evaluateLetterDelivery({ caseRow, session, letterDocument = null }) {
  if (!caseRow) return refuseDelivery("case_not_found");
  if (!session?.authenticatedEmploymentId) return refuseDelivery("session_required");
  if (session.authenticatedEmploymentId !== caseRow.employmentId) return refuseDelivery("not_the_employee");
  if (!letterDocument) return refuseDelivery("no_letter_on_this_case");

  return {
    allowed: true,
    code: "letter_available",
    status: 200,
    reason: "The employment verification letter has been issued and can be collected by the employee it is about.",
  };
}

/**
 * The letter as a surface should hand it over: the bytes, what they are, and
 * the hash that names them.
 *
 * @param {object} caseRow
 * @param {object} letterDocument  including `content`
 */
export function describeIssuedLetter(caseRow, letterDocument) {
  return {
    ok: true,
    code: "letter_available",
    status: 200,
    caseId: caseRow.id,
    documentId: letterDocument.id,
    type: LETTER_DOCUMENT_TYPE,
    contentType: "text/html",
    // A NAME A BROWSER CAN SAVE IT UNDER, built from the case id rather than
    // the employee's name — src/uc03/letterDelivery.js's own reasoning.
    filename: `employment-verification-letter-${caseRow.id}.html`,
    contentHash: letterDocument.contentHash ?? null,
    issuedAt: letterDocument.createdAt ?? null,
    // This path never has a signer to report — self-service issues with
    // nobody in the path, always. Stated rather than left for the reader to
    // infer from an absent field, the same rule UC-03's `issuedWithoutSignature` follows.
    issuedWithoutSignature: true,
    content: letterDocument.content,
  };
}

/**
 * The same issued letter, rendered to PDF bytes — for a surface that already
 * has `pdfBuffer` in hand (src/pdf/render.js's `renderPdfFromHtml`, run
 * against `letterDocument.content`). Kept separate from
 * `describeIssuedLetter()` rather than parameterised, because the two shapes
 * differ in more than a content type: the bytes are base64 here (a PDF is
 * binary and `content` travels over JSON), and the filename ends `.pdf`.
 *
 * rca-cput (round-7 R7-21, VOID but real): `npm run pdf-demo` already proves
 * `renderPdfFromHtml` renders this exact letter — the capability existed and
 * was offered nowhere an employee could reach it. This is what reaches it;
 * rendering itself still happens only where a caller supplies `renderPdf`
 * (see src/portal/server.js's own seam), so a deployment with no Chromium
 * available degrades to "PDF not offered", never to a broken button.
 *
 * @param {object} caseRow
 * @param {object} letterDocument
 * @param {Buffer} pdfBuffer
 */
export function describeIssuedLetterAsPdf(caseRow, letterDocument, pdfBuffer) {
  return {
    ok: true,
    code: "letter_available",
    status: 200,
    caseId: caseRow.id,
    documentId: letterDocument.id,
    type: LETTER_DOCUMENT_TYPE,
    contentType: "application/pdf",
    filename: `employment-verification-letter-${caseRow.id}.pdf`,
    contentHash: letterDocument.contentHash ?? null,
    issuedAt: letterDocument.createdAt ?? null,
    issuedWithoutSignature: true,
    // BASE64: a PDF is binary and this travels as a JSON string, the same
    // choice every other byte-payload response in this repository makes.
    encoding: "base64",
    content: pdfBuffer.toString("base64"),
  };
}

/** @param {keyof DELIVERY_REFUSALS} code */
export function refuseDelivery(code, extra = {}) {
  const { status, reason } = DELIVERY_REFUSALS[code];
  return { allowed: false, code, reason, status, ...extra };
}
