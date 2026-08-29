// ---------------------------------------------------------------------------
// amendmentStatus.js  —  "What happened to the amendment I requested?"
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
// The admin who requests a contract amendment in this stand-in gets a decision
// at intake — `dual_approval_required` or `escalate` — and then the request
// leaves for somewhere they cannot see. Two named people approve it in the ZAF
// sidebar, or one of them denies it, and the amendment either reaches Remote or
// does not. Every one of those facts was recorded on the row from the first
// day; none of them was ever shown to the person who asked for the change.
//
// That is the same half-a-gate this repo just closed on the portal
// (src/portal/server.js's GET /api/my-requests, and see ./requestStatus.js's
// header there): a human control whose outcome the requester cannot observe is
// only half a control, because the requester's only remaining option is to ask
// a human whether a human has answered yet.
//
// WHAT IT IS: a pure row -> description translation, no I/O, no store, no http,
// exactly like src/portal/requestStatus.js. It is deliberately NOT that file:
// the portal's seven request types do not include UC-06 (its intake is here
// and on the Zendesk path, not there), and UC-06's dual-approval shape — two
// independently-signed slots that must both fill — has no equivalent in that
// vocabulary. Rather than widen a table this use case is not in, this is the
// same discipline applied once more, next to the surface that needs it.
//
// WHAT IT MUST NOT DO
//   - It holds NO policy. Nothing here decides whether an approval is
//     permitted; src/uc06/dualApprovalPolicy.js does, server-side, and this
//     surface offers no control that could take one anyway. If this file were
//     deleted, no gate anywhere would behave differently — the page would
//     simply have nothing to draw.
//   - It invents no status. A row whose status it does not recognise reports
//     `unknown` and says so, rather than falling through to a plausible
//     default: "we do not know" and "nothing has happened yet" are different
//     facts and only one of them is safe to act on.
//   - It never composes the settled sentence itself. That comes from UC-06's
//     own describeSettled() (src/uc06/dualApprovalPolicy.js), which names both
//     signatures, the note, and — the load-bearing clause — whether the write
//     to Remote actually landed, which on a contract amendment is the
//     difference between the employee's terms having changed and only the
//     record of it having changed.
// ---------------------------------------------------------------------------

/** This surface's own small vocabulary. */
export const STATES = Object.freeze({
  AWAITING_APPROVAL: "awaiting_approval",
  APPLYING: "applying",
  EXECUTED: "executed",
  // `declined`, not `denied` — the verb moved on 2026-08-19 to match Remote's
  // own vocabulary (`deny` occurs zero times in their corpus). This is THIS
  // page's state name, not the stored status; the stored status is matched in
  // both spellings below, because a row written before the rename is still a
  // real decision and must not render as "unknown".
  DECLINED: "declined",
  ESCALATED: "escalated",
  UNKNOWN: "unknown",
});

/**
 * The two signature slots, in the order UC-06 names them. Kept as data rather
 * than as two hand-written branches so "how many signatures does this need"
 * has one answer and a reader can count it.
 */
const SLOTS = Object.freeze([
  { key: "adminApproval", role: "customer_admin", label: "Customer Admin" },
  { key: "payrollApproval", role: "payroll_specialist", label: "Payroll Specialist" },
]);

/**
 * @typedef {object} AmendmentStatus
 * @property {string} state       one of STATES
 * @property {string} label       one short phrase for a badge
 * @property {string} detail      one plain-English sentence: what this means
 * @property {string|null} awaitingRole  who it is sitting with (a LABEL)
 * @property {string|null} decidedBy  the human who ended it, when one has
 * @property {string|null} decidedAt
 * @property {string|null} note
 * @property {string|null} storeStatus  UC-06's own raw status, shown verbatim
 * @property {Array<{role:string,label:string,signed:boolean,approver:string|null,at:string|null,note:string|null}>} signatures
 * @property {number} signaturesCollected
 * @property {number} signaturesRequired
 */

/**
 * Describe one stored amendment in the requester's vocabulary.
 *
 * @param {object|null} row  the amendment as AmendmentStore returns it
 * @returns {AmendmentStatus}
 */
export function describeAmendmentStatus(row) {
  if (!row) {
    return base(STATES.UNKNOWN, "Unknown", "The amendment could not be read back.", null, []);
  }

  const signatures = readSignatures(row);
  const declined = row.declinedBy ?? row.deniedBy ?? null;

  switch (row.status) {
    case "pending_dual_approval":
      return base(
        STATES.AWAITING_APPROVAL,
        "Awaiting dual approval",
        `${signatures.filter((slot) => slot.signed).length} of ${SLOTS.length} signatures are recorded. Nothing reaches Remote until both are, and dual control requires two different people — one person cannot fill both slots.`,
        row.status,
        signatures,
        { awaitingRole: nextUnsigned(signatures) }
      );

    case "executing":
      // The F-09 execution claim. NOT reported as executed: a claim taken is
      // not a write landed, and telling the requester their contract has
      // changed while the PUT is still in flight is the one rounding that
      // cannot be walked back.
      return base(
        STATES.APPLYING,
        "Being applied",
        "Both approvals are recorded and the amendment is being applied at Remote right now. It is not confirmed applied until Remote has answered.",
        row.status,
        signatures
      );

    case "executed":
      return base(
        STATES.EXECUTED,
        "Applied",
        "Both approvals were recorded and the amendment was submitted to Remote.",
        row.status,
        signatures,
        { decidedAt: row.executedAt ?? null }
      );

    case "declined":
    case "denied": // pre-2026-08-19 spelling; see the STATES note above
      return base(
        STATES.DECLINED,
        "Declined",
        "An approver declined this amendment. A decline ends it for both roles — the other slot is not asked, and the change has to be requested again.",
        row.status,
        signatures,
        {
          decidedBy: declined?.approver ?? null,
          decidedAt: declined?.at ?? null,
          note: declined?.note ?? null,
        }
      );

    case "escalated":
      // Not a human queue and not a failure: the gates refused to prepare it
      // for approval at all, so nobody is waiting on a signature. Saying
      // "awaiting approval" here would invent a queue.
      return base(
        STATES.ESCALATED,
        "Escalated",
        `The gates escalated this request${row.reason ? ` (${row.reason})` : ""} instead of opening it for approval, so it is not sitting with an approver — a specialist picks it up on its ticket.`,
        row.status,
        signatures
      );

    default:
      return base(
        STATES.UNKNOWN,
        "Unknown",
        `UC-06 reported a status this page does not recognise: ${row.status}`,
        row.status ?? null,
        signatures
      );
  }
}

/** The two slots as data, read off the row and never inferred from a count. */
function readSignatures(row) {
  return SLOTS.map((slot) => {
    const signed = row[slot.key] ?? null;
    return {
      role: slot.role,
      label: slot.label,
      signed: Boolean(signed),
      approver: signed?.approver ?? null,
      at: signed?.at ?? null,
      note: signed?.note ?? null,
    };
  });
}

/** Which role the request is actually waiting on — a LABEL, never a gate. */
function nextUnsigned(signatures) {
  const waiting = signatures.filter((slot) => !slot.signed).map((slot) => slot.label);
  return waiting.length ? waiting.join(" and ") : null;
}

function base(state, label, detail, storeStatus, signatures, extra = {}) {
  return {
    state,
    label,
    detail,
    awaitingRole: null,
    decidedBy: null,
    decidedAt: null,
    note: null,
    storeStatus,
    signatures,
    signaturesCollected: signatures.filter((slot) => slot.signed).length,
    signaturesRequired: SLOTS.length,
    ...extra,
  };
}
