// ---------------------------------------------------------------------------
// letterDelivery.js  —  Handing an issued travel letter to the person it is about
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
//
// The standard travel letter is now WRITTEN AND ISSUED by the gate, with nobody
// in the path (`policyEngine.js`'s letter rung; `docs/use-cases/UC-03.md` §23).
// It is stored as a `travel_support_letter` document on the case, its sha256 is
// on the decision's audit row — and until this module, no route anywhere would
// give it to the employee. The signed path had one: `submitTravelLetterSignoff()`
// posts the letter to the Zendesk ticket. A request that never went through
// Zendesk — the portal's, which is where most of this system's traffic comes
// from — had nothing.
//
// That is the failure this repository has now written down four times in one
// day, in `CLAUDE.md` §7's honest-gaps list: a decision that is correct,
// durable, audited **and reaches nobody**. An issued letter nobody can fetch is
// the worst version of it, because the audit row says a document was delivered.
//
// ---------------------------------------------------------------------------
// WHO MAY FETCH IT, AND WHY THAT IS A DIFFERENT QUESTION FROM WHO MAY SIGN
// ---------------------------------------------------------------------------
// `signoffPolicy.js` answers "may this SPECIALIST release this document?".
// This answers "is this the TRAVELLER the document is about?" — a different
// person, a different namespace, and a different failure if it is got wrong.
// The document names an employee, their job title, their employer and their
// base compensation, so the rule is the narrowest one available: the session
// must be the employment the case is about. Not their company, not their
// manager, not a specialist — the letter is about one person and it goes to
// that person. `letterOffer.js` already states the same rule for ASKING for the
// letter (`not_the_traveller`); this states it for COLLECTING it, and the two
// deliberately use the same code so a surface can render one message.
//
// FAILS CLOSED ON A MISSING SESSION. No session is `session_required` (401),
// never "here is the document" — the same ordering `evaluateLetterSignoffAction()`
// uses, where request-shaped checks come before anything that could disclose
// which case a caller has named.
//
// THIS IS NOT THE CONTROL THE OFFER PATH HAS, AND IT DOES NOT PRETEND TO BE.
// It compares a caller-supplied session against a value stored on the row,
// which is the "verify a claim against itself" shape this repo has had to fix
// four times. What makes it sound HERE is that it is not verifying an identity
// in order to act — it is a read gate on an already-decided case, layered under
// whatever signed-identity posture the deployment applies to every UC-03 route
// (`resolveReader()` in `server.js`). Said plainly rather than left implicit,
// because the shape is the one that has bitten.
//
// PURE. No store, no clock, no network. The caller reads the rows; this decides.
// ---------------------------------------------------------------------------

/** The `documents.type` an issued travel letter is stored under. */
export const LETTER_DOCUMENT_TYPE = "travel_support_letter";

/**
 * The `cases.reason` that means "this letter went out with no signature".
 * Named, never inferred from the presence of a document — a DRAFT is also a
 * document, and on the signed path one exists long before anybody may have it.
 */
export const ISSUED_REASON = "standard_letter_issued";

export const DELIVERY_REFUSALS = {
  case_not_found: { status: 404, reason: "No UC-03 case exists with this id." },
  session_required: {
    status: 401,
    reason:
      "A travel letter is about one named employee, so collecting it needs the same authenticated session the " +
      "request was verified with.",
  },
  not_the_traveller: {
    status: 403,
    reason: "A travel letter may only be collected by the employee it is about.",
  },
  no_letter_on_this_case: {
    status: 404,
    reason: "No travel letter was written for this request.",
  },
  letter_not_issued: {
    status: 409,
    reason:
      "A travel letter exists on this case but has not been issued, so it is not yours to collect yet. It is with " +
      "a Travel & Mobility Support specialist.",
  },
};

/**
 * May this session collect this case's letter, and is there one to collect?
 *
 * ORDER IS DELIBERATE and matches every other gate in this use case:
 * request-shaped checks first (is there a case, is there a session, is it the
 * right person), then the state of the artifact. A caller who is not the
 * traveller is refused BEFORE being told whether a letter exists — "no letter
 * on that case" is itself a fact about somebody else's request.
 *
 * @param {object} args
 * @param {object|null} args.caseRow   the `cases` row (camelCase), UC-03-scoped by the caller
 * @param {object|null} args.session   `{authenticatedEmploymentId}` — the traveller's, never a body claim about someone else
 * @param {object|null} [args.letterDocument]  the stored `travel_support_letter`,
 *   passed IN rather than looked up so this stays pure — the same shape
 *   `evaluateLetterActionability()` uses.
 * @returns {{allowed:boolean, code:string, reason:string, status:number}}
 */
export function evaluateLetterDelivery({ caseRow, session, letterDocument = null }) {
  if (!caseRow) return refuseDelivery("case_not_found");
  if (!session?.authenticatedEmploymentId) return refuseDelivery("session_required");
  if (session.authenticatedEmploymentId !== caseRow.employmentId) return refuseDelivery("not_the_traveller");

  if (!letterDocument) {
    return refuseDelivery("no_letter_on_this_case", { reason: describeNoLetter(caseRow) });
  }

  // ISSUED IS A PROPERTY OF THE DECISION, NOT OF THE DOCUMENT. A `human_review`
  // case decided before the standard letter began issuing itself may hold a
  // drafted letter that no specialist has released; handing that over would be
  // this module issuing a document the sign-off gate exists to hold.
  if (caseRow.reason !== ISSUED_REASON && !isSignedOff(caseRow)) {
    return refuseDelivery("letter_not_issued");
  }

  return {
    allowed: true,
    code: "letter_available",
    status: 200,
    reason: "The travel letter for this trip has been issued and can be collected by the employee it is about.",
  };
}

/**
 * A case with no letter document, described by what it actually is — the same
 * rule `describeNoSignoffPath()` and `describeNoOffer()` follow. "No letter" is
 * four different situations and only one of them is a problem.
 */
export function describeNoLetter(caseRow) {
  const row = caseRow ?? {};

  if (row.decision === "auto_resolve" && row.reason === "all_gates_passed") {
    return (
      "This request was answered informationally and no travel letter was asked for, so none was written. You can " +
      "ask for one for the same trip without describing it again — accept the letter offer on this request."
    );
  }

  if (row.decision === "human_review" && row.reason === "formal_letter_requested") {
    return (
      "A travel letter was asked for and the trip qualifies for it, but your employing entity's record could not " +
      "be read — so there was no letterhead to write on and nothing was written. A Travel & Mobility Support " +
      "specialist has it."
    );
  }

  if (row.decision === "escalate" && row.reason === "letter_scope_exceeded") {
    return (
      "A travel letter was asked for and it is not the standard one — this request asks for something the standard " +
      "template cannot say, so nothing was written automatically and Travel & Mobility Support is writing it by hand."
    );
  }

  return DELIVERY_REFUSALS.no_letter_on_this_case.reason;
}

/**
 * A pre-change case whose drafted letter a specialist DID sign off. Those rows
 * are real — `review_queue` holds them — and their letter genuinely is issued,
 * so refusing them here would take a document away from someone who already has
 * it on their ticket. `reviewRow` is not always available to this gate, so the
 * case's own settled status is what is read.
 */
function isSignedOff(caseRow) {
  return caseRow?.decision === "human_review" && caseRow?.status === "resolved";
}

/**
 * The letter as a surface should hand it over: the bytes, what they are, and
 * the hash that names them.
 *
 * `contentHash` travels WITH the content, never instead of it — it is what the
 * audit row records, so a reader holding the document can check that the thing
 * they were given is the thing history says was issued.
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
    // A NAME A BROWSER CAN SAVE IT UNDER. Built from the case id rather than the
    // employee's name: a filename ends up in shared folders and mail clients,
    // and the case id identifies the document without naming the person.
    filename: `travel-letter-${caseRow.id}.html`,
    contentHash: letterDocument.contentHash ?? null,
    issuedAt: letterDocument.createdAt ?? null,
    // WHETHER ANYBODY SIGNED IT, stated on the document itself rather than left
    // for the reader to infer from the absence of a name. A letter that issued
    // on the 🟢 path has no signer and that is the design, not an omission.
    issuedWithoutSignature: caseRow.reason === ISSUED_REASON,
    content: letterDocument.content,
  };
}

/** @param {keyof DELIVERY_REFUSALS} code */
export function refuseDelivery(code, extra = {}) {
  const { status, reason } = DELIVERY_REFUSALS[code];
  return { allowed: false, code, reason, status, ...extra };
}
