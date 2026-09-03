// ---------------------------------------------------------------------------
// awaiting.js  —  Does this stored record still need a person, and which person
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
//
// Every use case records its own state in its own column vocabulary
// ("flagged", "pending_specialist_approval", "pending_signoff",
// "pending_dual_approval", "pending_approval", plus review_queue's "pending").
// Nine vocabularies is fine — each store's words are its own — but a queue that
// spans all nine has to read them together, and reading them together is a
// judgement. It is made once, here, and the browser renders the answer.
//
// IT READS THE RECORDED STATUS AND NOTHING ELSE. There is no branch here that
// re-decides a request, re-reads a policy engine, or infers a state from a
// decision string when the status column disagrees with it. This surface
// reports on approvals; if it computed its own answer it would become a rival
// source of truth for the one fact the approval APIs own.
//
// A STATUS THIS FILE DOES NOT RECOGNISE IS "unknown", NEVER "settled".
// The failure this rule prevents is specific and quiet: a status added to a
// store later — a new hold state, a new transient — would fall through a
// two-way branch as "not awaiting", and the item would vanish from the queue
// while still needing a person. An empty queue and an unreadable queue must
// never look the same. Same discipline as src/uc04/decisionFacts.js's
// unknown-vs-cleared and src/auditview/identifierVerdict.js's
// not-found-vs-cannot-tell.
//
// THREE THINGS A PERSON CAN BE WAITING FOR, and they are not interchangeable:
//   "approval"  a named human must click approve or decline. There is a
//               control, or there should be one.
//   "handling"  the automation escalated. Nobody approves an escalation —
//               the sidebar deliberately gives an escalation no buttons, so
//               the safe path cannot double as a dismiss button. What it needs
//               is a team, which makes its hand-off (the ticket and its group)
//               the whole of its reachability.
//   "reading"   a 🔴 dossier. Compiled for a named specialist to read and act
//               on outside this system. Nothing may approve it here, ever.
// ---------------------------------------------------------------------------

/**
 * Per use case: which recorded statuses mean a person is still needed, which
 * mean the matter is closed, and what the person is waiting to do.
 *
 * Taken from each store's own writer, not from a spec:
 *   uc02  statusFor()/statusForAction()  src/uc02/expenseStore.js:588, reviewPolicy.js:254
 *   uc04  src/uc04/authorizationStore.js:131 + markDeclined/markExecuted
 *   uc05  src/uc05/resignationStore.js:120
 *   uc06  src/uc06/amendmentStore.js:123
 *   uc09  src/uc09/adjustmentStore.js:132
 */
const STATUS_MAP = Object.freeze({
  "UC-02": {
    awaiting: { flagged: "approval", held: "approval", escalated: "handling" },
    settled: ["auto_approved", "approved", "declined", "released", "blocked"],
  },
  "UC-04": {
    // THE THREE-STAGE MODEL, IN THE QUEUE'S OWN VOCABULARY (2026-08-31, UC-04.md
    // §1a). `approved_by_manager` is Remote's own enum value and it is NOT a
    // settled state: it means the customer's manager approved and Remote's
    // mobility review — stage 3 — has not happened. An employee holding it is
    // not yet cleared to travel, so a queue that called it settled would drop
    // the one item still genuinely waiting on a Remote human. `declined_by_manager`
    // IS settled: stage 2 declining ends the request, and there is no stage 3
    // to reach.
    //
    // BOTH WERE FALLING THROUGH TO `unknown` until this entry existed, because
    // the employer surface began writing them before this map knew them — the
    // exact "a status added to a store later" failure the header above warns
    // about, arriving three weeks after the warning was written. It failed
    // honestly rather than lying, which is why it was findable.
    awaiting: {
      pending_specialist_approval: "approval",
      approved_by_manager: "approval",
      escalated: "handling",
    },
    settled: ["executed", "declined", "declined_by_manager", "blocked"],
  },
  "UC-05": {
    awaiting: { pending_signoff: "approval", escalated: "handling" },
    settled: ["signed_off", "declined", "blocked"],
  },
  "UC-06": {
    awaiting: { pending_dual_approval: "approval", escalated: "handling" },
    // "executing" is the brief window between the second signature and the
    // Remote write. A person is not waiting in it; the machine is.
    settled: ["executed", "declined", "executing", "blocked"],
  },
  "UC-09": {
    awaiting: { pending_approval: "approval", escalated: "handling" },
    settled: ["executed", "denied", "declined", "executing", "blocked"],
  },
});

/** UC-07 and UC-08 have no status column at all — a dossier exists or it does
 *  not, and every one of them is waiting to be read by a named team. */
const DOSSIER_USE_CASES = new Set(["UC-07", "UC-08"]);

/**
 * @param {object} args
 * @param {string} args.useCase   "UC-01" … "UC-09"
 * @param {string|null} args.status   the record's own status column
 * @param {string|null} [args.queueStatus]  review_queue.status, for UC-01/UC-03
 * @returns {{state:"awaiting"|"settled"|"unknown", waitingFor:string|null,
 *   detail:string}}
 */
export function awaitingState({ useCase, status, queueStatus = undefined }) {
  if (DOSSIER_USE_CASES.has(useCase)) {
    return {
      state: "awaiting",
      waitingFor: "reading",
      detail:
        "A dossier is compiled once and never changes state — there is no column that could say it had been dealt with. It is waiting to be read until the team it was compiled for says otherwise, somewhere this system cannot see.",
    };
  }

  // G-3/L-19: UC-01's consent round-trip, checked AHEAD of the review_queue
  // read below. `awaiting_consent` is written to `cases.status` for a
  // third-party request nobody has answered yet (VC-06), and it deliberately
  // creates NO review_queue row — the person waited on is the EMPLOYEE, not a
  // specialist, so there is nothing for a reviewer to action and no queue
  // entry exists to read. Without this check the case's `queueStatus` reads
  // `null` ("no review-queue entry was created for this case") and the
  // fall-through below would report it SETTLED — exactly backwards for a
  // request that is, by construction, still waiting on a person. The waiting
  // party is named as "consent" so the page can render it distinctly from
  // "approval"/"handling"/"reading" (the ageing verdict itself is computed by
  // the caller from `createdAt`, per owner answer A5 — see stuck.js).
  if (useCase === "UC-01" && status === "awaiting_consent") {
    return {
      state: "awaiting",
      waitingFor: "consent",
      detail:
        "A third party asked about this employment and the employee has not yet answered whether they may be told anything. Nothing was disclosed and nothing was decided — waiting on the employee, not a specialist.",
    };
  }

  // UC-01 and UC-03 keep their state in review_queue, not on the case.
  if (queueStatus !== undefined) {
    if (queueStatus === null) {
      return {
        state: "settled",
        waitingFor: null,
        detail: "No review-queue entry was created for this case, so nothing was ever queued for a person.",
      };
    }
    if (queueStatus === "pending") {
      return { state: "awaiting", waitingFor: "approval", detail: "Queued for review and not yet decided." };
    }
    if (queueStatus === "approved" || queueStatus === "declined" || queueStatus === "resolved") {
      return { state: "settled", waitingFor: null, detail: `A person recorded "${queueStatus}".` };
    }
    return {
      state: "unknown",
      waitingFor: null,
      detail: `The review queue holds the status "${queueStatus}", which this view does not recognise. It is not being reported as settled, because a status nobody recognises clears nothing.`,
    };
  }

  const map = STATUS_MAP[useCase];
  if (!map) {
    return {
      state: "unknown",
      waitingFor: null,
      detail: `${useCase} has no status vocabulary registered in this view, so whether it is waiting for a person cannot be answered from here.`,
    };
  }
  if (status && Object.hasOwn(map.awaiting, status)) {
    return { state: "awaiting", waitingFor: map.awaiting[status], detail: `Recorded status: ${status}.` };
  }
  if (status && map.settled.includes(status)) {
    return { state: "settled", waitingFor: null, detail: `Recorded status: ${status}.` };
  }
  return {
    state: "unknown",
    waitingFor: null,
    detail: status
      ? `The record holds the status "${status}", which this view does not recognise. It is NOT being counted as settled — a status nobody recognises clears nothing.`
      : "The record holds no status at all, so whether a person is still needed cannot be answered from it.",
  };
}

/**
 * Which approval slots are filled, which are outstanding, and who may no longer
 * sign because they already have.
 *
 * ONLY THE RECORDED SLOTS ARE READ. The four-eyes rule itself — who may fill a
 * slot, whether two names are the same person — lives in each use case's own
 * policy engine and is deliberately not reimplemented here. What this returns
 * is a description of the row, so `barred` is "these names are already on this
 * record", not a ruling about anyone.
 *
 * @param {object} args
 * @param {string} args.useCase
 * @param {object} args.row  the raw record row (snake_case, as stored)
 * @returns {{applies:boolean, required:number|null, filled:number,
 *   slots:{key:string,label:string,filled:boolean,by:string|null,at:string|null}[],
 *   outstanding:string[], barred:string[], note:string}}
 */
export function approvalProgress({ useCase, row }) {
  const none = {
    applies: false,
    required: null,
    filled: 0,
    slots: [],
    outstanding: [],
    barred: [],
    note: "",
  };

  if (useCase === "UC-06") {
    const slots = [
      slotOf("customer_admin", "Customer admin", row.admin_approval),
      slotOf("payroll_specialist", "Payroll specialist", row.payroll_approval),
    ];
    return summarise(slots, 2, "Two different people. One identity cannot fill both slots.");
  }

  if (useCase === "UC-09") {
    const slots = [
      slotOf("requester", "Requester", row.requester_approval),
      slotOf("approver", "Approver", row.approver_approval),
      slotOf("payment_releaser", "Payment releaser", row.payment_releaser_approval),
    ];
    // The stored requirement, floored at 2 exactly as the policy floors it —
    // restated, not recomputed: a row whose column says 1 is a row this view
    // must not present as satisfiable by one signature.
    const stored = Number(row.approval_slots_required);
    const required = Number.isFinite(stored) ? Math.max(2, stored) : 2;
    const note =
      Number.isFinite(stored) && stored < 2
        ? `The row records ${stored} required slot(s); two is the floor no risk score can lower, so two is what is shown.`
        : "All signatures must come from different people.";
    return summarise(slots.slice(0, Math.max(required, filledCount(slots))), required, note);
  }

  return none;

  function filledCount(slots) {
    return slots.filter((s) => s.filled).length;
  }

  function summarise(slots, required, note) {
    const filled = slots.filter((s) => s.filled);
    return {
      applies: true,
      required,
      filled: filled.length,
      slots,
      outstanding: slots.filter((s) => !s.filled).map((s) => s.label),
      barred: [...new Set(filled.map((s) => s.by).filter(Boolean))],
      note,
    };
  }
}

/** One slot, read out of its jsonb column. `{}` and null both mean unfilled. */
function slotOf(key, label, raw) {
  const value = typeof raw === "string" ? safeParse(raw) : raw;
  const by = value && typeof value === "object" ? (value.approver ?? value.by ?? null) : null;
  const at = value && typeof value === "object" ? (value.at ?? value.approvedAt ?? null) : null;
  return { key, label, filled: Boolean(by), by, at };
}

function safeParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * How long it has waited, in whole hours and days, plus a sentence.
 * Returns nulls rather than a zero when the timestamp is unreadable — an age of
 * 0 for a record whose date could not be parsed is a fabricated measurement.
 */
export function waited(createdAt, now = Date.now()) {
  const started = new Date(createdAt).getTime();
  if (!Number.isFinite(started)) {
    return { ms: null, hours: null, days: null, label: "age unknown — the record carries no readable timestamp" };
  }
  const ms = Math.max(0, now - started);
  const hours = Math.floor(ms / 3_600_000);
  const days = Math.floor(hours / 24);
  if (hours < 1) return { ms, hours, days, label: "under an hour" };
  if (hours < 48) return { ms, hours, days, label: `${hours} hour${hours === 1 ? "" : "s"}` };
  return { ms, hours, days, label: `${days} days` };
}
