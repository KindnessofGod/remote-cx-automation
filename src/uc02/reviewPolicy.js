// ---------------------------------------------------------------------------
// reviewPolicy.js  —  Which human actions are permitted on a flagged expense
// ---------------------------------------------------------------------------
// WHY THIS EXISTS, AND THE CONTRADICTION IT SETTLES
//
// UC-02.md carried two claims that cannot both be true:
//
//   §6 (the workflow):  "... else -> annotate -> route to Finance Ops (ZAF)
//                        -> PATCH status: declined (with reason) or hold
//                        -> audit"
//   §15 (build status): "Finance Ops review queue: deliberately none, and this
//                        is not a gap ... there is no approve/deny decision
//                        here for a queue to hold."
//
// The second was wrong, and it was wrong in the direction that hides work:
// §6 names a human action, in a named surface, producing a named write with a
// required reason. src/uc02/server.js's view() then hard-set `actionable:
// false` with the reason "routed to a Finance Ops review queue outside this
// API" — a queue that exists nowhere in this repository. So a flagged expense
// landed in `uc02_expenses` with `status: "flagged"`, was rendered read-only in
// the sidebar, and no control anywhere in the system could resolve it. The
// answer to "where does a human actually review this?" was: nowhere.
//
// This file resolves the contradiction in favour of §6, which is the spec's
// own designed flow. §15 has been corrected rather than left standing.
//
// THREE VERBS, AND WHY THESE THREE
// §6 names two outcomes ("declined (with reason) or hold") and the surrounding
// flow implies the third: a specialist who inspects an exception and finds it
// legitimate must be able to clear it, or the automation's exception path is a
// one-way trip to a refusal. So:
//
//   approve  -> PATCH {status:"approved"}          (the human clears the flag)
//   decline  -> PATCH {status:"declined", reason}  (`reason` is REQUIRED by
//               Remote's own DeclineExpenseParams — UC-02.md §3, [CONFIRMED])
//   hold     -> NO Remote write at all
//
// THE POSITIVE VERB USED TO BE `release`, AND THAT WAS AN OUTLIER WITH NO
// RECORDED REASON. It cost four words for one act: the button said RELEASE,
// this store recorded `released`, the audit row said `expense_review_release`,
// and Remote — the only system whose vocabulary is not ours to choose —
// recorded `approved`. Every sibling approval surface in the repository says
// approve (UC-01's review, UC-04, UC-06, UC-09; UC-05 says signoff because it
// signs off a report rather than approving a payment). A reader comparing a
// sidebar to an audit log to Remote's own record had to hold a four-way
// translation in their head to establish that nothing had gone wrong.
// Renamed to `approve` throughout, 2026-08-19. `release` is still ACCEPTED on
// input and normalised away (normalizeAction below) because a deployed ZAF
// bundle posts it; legacy `released` rows still read back correctly
// (canonicalStatus below). See docs/BUILD-LOG.md §3.57.
//
// THE ASYMMETRY — approve/decline, NOT approve/deny — IS DELIBERATE.
// `decline` is REMOTE'S OWN WORD. `DeclineExpenseParams` is the request type,
// `declined` is the member of its status enum, and `reason` is the field that
// type makes mandatory. Renaming it "deny" for symmetry with UC-04/UC-06/UC-09
// would rename Remote's own field in our UI, and a specialist reading our
// DECLINED beside Remote's `declined` would be reading the same word twice
// rather than translating. The positive verb had no such anchor — `approve`
// IS Remote's word for it — which is exactly why one half moved and the other
// did not.
//
// `hold` writes nothing to Remote ON PURPOSE, and this is the one design point
// worth reading twice. Remote's expense `status` enum is
// `canceled|pending|declined|approved|processing|reimbursed` [CONFIRMED] —
// there is no "held" member. Inventing one would mean writing a status Remote
// does not define; mapping hold onto `canceled` would mean a specialist asking
// for more information silently killing the employee's expense. So a hold is a
// LOCAL state: the expense stays `pending` at Remote, exactly as it already is,
// and this system records who parked it and why. That makes hold NON-TERMINAL:
// a held expense is still actionable and can later be approved or declined.
// Approve and decline are terminal.
//
// ONE ROLE, NOT TWO — UC-02 is 🟢 low tier. UC-04's single mobility specialist
// is the structural model (src/uc04/approvalPolicy.js), not UC-06's dual
// control: nothing in UC-02.md names a second signature, and manufacturing one
// for a receipt would be ceremony rather than control.
//
// Pure function, no I/O, same as every sibling policy module. policyEngine.js
// decided WHETHER an expense needed a human (once, when it was submitted). This
// file decides whether ONE review action is permitted RIGHT NOW — a question
// asked once per expense and possibly days later.
// ---------------------------------------------------------------------------

import { describeDecidingGate } from "./policyEngine.js";

/** The three verbs a Finance Ops specialist may take. */
export const ACTIONS = new Set(["approve", "decline", "hold"]);

/**
 * Input spellings this system still ANSWERS TO but no longer produces.
 *
 * WHY AN ALIAS RATHER THAN A CLEAN BREAK. The rename is ours; the callers are
 * not all ours to redeploy at the same instant. A ZAF app is a bundle uploaded
 * into a Zendesk account (installation `9990001`), so between deploying this
 * API and re-uploading that bundle there is a window in which the old bundle
 * posts `/release` to the new server. Without the alias, every Finance Ops
 * approval in that window 400s with `unknown_action` — a rename taking the
 * approve button offline, which is precisely the class of self-inflicted dead
 * gate this repository keeps paying for.
 *
 * It maps INPUT only. Nothing in this module ever emits `release` again, so
 * the alias can be deleted once no deployed caller sends it, and deleting it
 * cannot change any recorded outcome.
 */
export const ACTION_ALIASES = Object.freeze({ release: "approve" });

/**
 * Stored `status` values this system still READS but no longer writes, and the
 * canonical value each one means. Two live rows in `uc02_expenses` carry
 * `released` (verified 2026-08-19); renaming the verb without this map would
 * have rendered both as an unrecognised status — an expense that WAS approved
 * reported as unknown, which is worse than the inconsistent word was.
 */
export const STATUS_ALIASES = Object.freeze({ released: "approved" });

/**
 * Actions that end the expense's review. A held expense is deliberately NOT here:
 * see the header. `already_decided` is measured against this set, so holding
 * twice is permitted and approving twice is not.
 */
export const TERMINAL_ACTIONS = new Set(["approve", "decline"]);

/** Store statuses that are still open to a human decision. */
export const OPEN_STATUSES = new Set(["flagged", "held"]);

/**
 * The canonical spelling of an action a caller supplied. Applied ONCE, at the
 * edge (server.js's route match and workflow.js's entry), so nothing
 * downstream — the audit action name, the store's `review_action` column, the
 * response `code` — ever has to know the alias existed.
 *
 * @param {unknown} action
 * @returns {string} the canonical verb, or the input unchanged when it is not
 *   an alias (so an unknown action still fails the ACTIONS check rather than
 *   being quietly rewritten into a valid one)
 */
export function normalizeAction(action) {
  if (typeof action !== "string") return action;
  return Object.prototype.hasOwnProperty.call(ACTION_ALIASES, action) ? ACTION_ALIASES[action] : action;
}

/**
 * The canonical spelling of a stored status. Same rule one column over: a row
 * written before the rename reads back as what it always meant.
 *
 * @param {unknown} status
 */
export function canonicalStatus(status) {
  if (typeof status !== "string") return status;
  return Object.prototype.hasOwnProperty.call(STATUS_ALIASES, status) ? STATUS_ALIASES[status] : status;
}

export const REFUSALS = {
  expense_not_found: { status: 404, reason: "No expense submission exists with this id." },
  reviewer_required: { status: 401, reason: "No Finance Ops reviewer identity was supplied." },
  unknown_action: { status: 400, reason: "action must be 'approve', 'decline' or 'hold'." },
  decline_reason_required: {
    status: 400,
    reason:
      "A decline must state a reason. Remote's DeclineExpenseParams requires one, and an unexplained decline is not something an employee can act on.",
  },
  not_awaiting_review: {
    status: 403,
    reason:
      "This expense was auto-approved, blocked or escalated — it was never routed to Finance Ops, so it has no review path here.",
  },
  already_decided: { status: 409, reason: "This expense has already been approved or declined." },
  // ^ The GENERIC form, and it is a fallback rather than the normal answer.
  //   describeSettled() below builds the specific one from the row. See its
  //   header for why "approved or declined" is not good enough.
  employment_no_longer_active: {
    status: 409,
    reason:
      "The employment record is no longer active. Re-run the expense rather than approving a reimbursement against it.",
  },
};

/**
 * Is this expense open to a human decision at all? Split out so a UI can ask
 * "should I show the Finance Ops controls?" without needing a fake reviewer
 * identity to ask with — same reasoning as evaluateCaseActionability() /
 * evaluateAuthorizationActionability() / evaluateAmendmentActionability().
 *
 * Keyed on `decision === "human_review"` rather than on the flags: UC-02's
 * gates 1–6 are hard stops that produce `blocked`/`escalate` (a duplicate
 * receipt, an expense that is not the submitter's, an identity that never
 * verified) and none of those is an exception for Finance Ops to weigh — they
 * are refusals with nothing to weigh. §6's "else" branch is exactly and only
 * the `human_review` one.
 *
 * @param {object} args
 * @param {object|null} args.expenseRow
 */
export function evaluateExpenseActionability({ expenseRow }) {
  if (!expenseRow) return refuse("expense_not_found");
  if (expenseRow.decision !== "human_review") return refuse("not_awaiting_review", { reason: describeNoReviewPath(expenseRow) });
  // canonicalStatus() so a row written before the release->approve rename is
  // measured against the same set as one written after it. A legacy `released`
  // row must read as decided, not as an unrecognised status that OPEN_STATUSES
  // happens to exclude for the right answer by accident.
  const status = canonicalStatus(expenseRow.status);
  if (!OPEN_STATUSES.has(status)) return refuse("already_decided", { reason: describeSettled(expenseRow) });
  return {
    allowed: true,
    code: "actionable",
    status: 200,
    reason:
      status === "held"
        ? "On hold with Finance Ops — can still be approved or declined."
        : "Awaiting a Finance Ops decision: approve, decline (with a reason) or hold.",
  };
}

/**
 * Decide whether `reviewer` may take `action` on this expense right now.
 *
 * @param {object} args
 * @param {object|null} args.expenseRow
 * @param {string|null} args.reviewer
 * @param {"approve"|"decline"|"hold"|"release"} args.action  `release` is the
 *   accepted legacy spelling of `approve`; it is normalised before anything
 *   else looks at it, so every verdict this function returns names the
 *   canonical verb whichever spelling arrived
 * @param {string} [args.note]  the reason/annotation; REQUIRED for a decline
 */
export function evaluateReviewAction({ expenseRow, reviewer, action: rawAction, note = "" }) {
  const action = normalizeAction(rawAction);
  if (!reviewer || typeof reviewer !== "string" || !reviewer.trim()) {
    return refuse("reviewer_required");
  }
  if (!ACTIONS.has(action)) return refuse("unknown_action");

  // Checked BEFORE actionability so a caller who forgot the reason is told
  // that, rather than being told the expense is fine and then silently sending
  // Remote a decline with no `reason` for it to reject.
  if (action === "decline" && !String(note ?? "").trim()) {
    return refuse("decline_reason_required");
  }

  const actionability = evaluateExpenseActionability({ expenseRow });
  if (!actionability.allowed) return actionability;

  return { allowed: true, code: action, status: 200, reason: `Permitted: ${action}.` };
}

/**
 * The store status a completed review action puts the expense into.
 *
 * `approve` -> `approved`, deliberately NOT `auto_approved`: the store already
 * uses `auto_approved` for the expense nothing human ever touched, and the whole
 * point of the human slot is that those two are different facts. One word for
 * both would make "did a person look at this?" unanswerable from the row.
 */
export function statusForAction(action) {
  const canonical = normalizeAction(action);
  if (canonical === "approve") return "approved";
  if (canonical === "decline") return "declined";
  return "held";
}

/**
 * WHY THESE TWO REFUSALS ARE BUILT FROM THE ROW AND NOT WRITTEN AS CONSTANTS
 *
 * A specialist opened a settled expense and the panel said, in full:
 *
 *     "This expense has already been released or declined."
 *
 * Every word true, and it answers none of the questions the person reading it
 * has. WHICH of the two happened decides whether the employee is owed money.
 * WHO decided it decides who to ask. WHEN decides whether it is still live.
 * The note they left is the actual content of the decision. And whether the
 * write to Remote actually landed decides whether the reimbursement exists or
 * only the record of it does.
 *
 * Every one of those was already on the row — `reviewAction`, `reviewer`,
 * `reviewedAt`, `reviewNote`, `remoteResult` — and was being thrown away in
 * favour of a sentence that enumerates possibilities the row does not have to
 * guess between. That is the same defect as `over_policy_cap` printed above a
 * gate description phrased as the passing condition: the system knew, and said
 * something weaker.
 *
 * `not_awaiting_review` had the same shape one door over — "auto-approved,
 * blocked or escalated", a list of three when the row names one.
 *
 * The generic strings stay in REFUSALS as the fallback for a row missing the
 * detail, because an honest "we cannot say which" is still better than a
 * confident guess. They should be rare.
 */

/**
 * The verb a settled row was settled BY, canonicalised.
 *
 * `reviewAction` is what the specialist chose; `status` is where it left the
 * row. They agree, and the verb is the one a person recognises. Both are read
 * through the alias maps, so a row carrying `release`/`released` — written
 * before the 2026-08-19 rename, and two such rows are live — resolves to
 * `approve` and is described exactly as a row written today would be.
 */
function settledAction(expenseRow) {
  const stored = normalizeAction(expenseRow.reviewAction ?? null);
  if (stored) return stored;
  const status = canonicalStatus(expenseRow.status);
  if (status === "approved") return "approve";
  if (status === "declined") return "decline";
  return null;
}

/** A settled expense, described by what actually happened to it. */
export function describeSettled(expenseRow) {
  const who = String(expenseRow.reviewer ?? "").trim();
  const when = expenseRow.reviewedAt ? ` on ${expenseRow.reviewedAt}` : "";
  const by = who ? ` by ${who}${when}` : when ? ` (${when.trim()})` : "";
  const note = String(expenseRow.reviewNote ?? "").trim();

  const action = settledAction(expenseRow);
  if (!action) return REFUSALS.already_decided.reason;

  if (action === "approve") {
    // Whether the money side actually landed is a DIFFERENT fact from whether
    // a human said yes, and conflating them is how "approved" comes to mean
    // two things. `remoteResult` is written only after the PATCH returns.
    const wrote = expenseRow.remoteResult
      ? "The expense was approved at Remote."
      : "No Remote write is recorded against it, so the approval may not have reached Remote — check the audit trail before assuming the reimbursement exists.";
    return `Already APPROVED${by}. ${wrote}${note ? ` Note left: “${note}”.` : ""} An approved expense cannot be approved or declined again.`;
  }
  if (action === "decline") {
    return `Already DECLINED${by}.${note ? ` Reason given: “${note}”.` : " No reason was recorded, which a decline is supposed to carry."} A declined expense cannot be re-decided here — the employee has to file again.`;
  }
  return REFUSALS.already_decided.reason;
}

// ---------------------------------------------------------------------------
// THE OUTCOME BADGE — what a reader sees before they read anything else
// ---------------------------------------------------------------------------
// WHY IT EXISTS. The sidebar's DECISION card showed either the buttons or a
// paragraph. Once an expense was settled, the OUTCOME — the single fact a person
// opens the card for — was findable only by reading that paragraph to its end.
// describeSettled() is a good paragraph and it is still the wrong shape for
// "did this get approved?".
//
// IT SPEAKS REMOTE'S VOCABULARY, NOT OURS. The expense status enum is
// `canceled|pending|declined|approved|processing|reimbursed` [CONFIRMED], and
// `remoteStatus` below is only ever a member of it or `null`. That is the
// whole reason `release` had to go: a badge cannot report an expense's state in
// Remote's words while the surrounding UI reports it in a word Remote has
// never heard of.
//
// THE TWO RULES IT MUST NOT BREAK, both of which a naive badge breaks:
//
//   1. A HELD EXPENSE IS NOT DECIDED. `terminal: false`, and the tone is
//      `waiting`. A held expense is still actionable (evaluateExpenseActionability
//      says so) and the badge must not contradict the buttons sitting under it.
//   2. "A HUMAN APPROVED IT" AND "REMOTE ACCEPTED THE WRITE" ARE DIFFERENT
//      FACTS. `remoteResult` is written only after the PATCH returns, so a row
//      with a verdict and no `remoteResult` is a decision that may never have
//      left this system. describeSettled() already refuses to conflate the two
//      in prose; a badge reading a flat APPROVED over such a row would undo
//      that in the most prominent element on the card. So that row gets
//      `writeConfirmed: false`, a label that SAYS "not confirmed at Remote",
//      `remoteStatus: null` — we cannot name a status Remote may not hold —
//      and the waiting tone rather than the settled one.
//
// COLOUR IS NEVER THE CARRIER. `tone` is a hint for the shell's stylesheet and
// `label` always renders. The three tones map onto the design system's state
// scale (--r-dot-settled/waiting/stopped), which green/red collapse under
// deuteranopia and are legal only because the word is always beside them
// (test/uiPalette.test.js says so in as many words).
//
// It lives HERE, in the policy module, for the reason `actionable` does:
// src/uc02/server.js's view() calls it and the browser prints the result. The
// shell is never asked to work out what happened from `status` + `remoteResult`
// + `reviewAction`, because that is a judgement about the data and this repo
// keeps those server-side.
// ---------------------------------------------------------------------------

/** The three tones, which are also the design system's state scale. */
const SETTLED = "settled";
const WAITING = "waiting";
const STOPPED = "stopped";

/**
 * The outcome of one expense, in Remote's own status vocabulary.
 *
 * @param {object|null} expenseRow
 * @returns {null|{label:string, remoteStatus:string|null, tone:string,
 *   terminal:boolean, writeConfirmed:boolean|null, decidedBy:string|null,
 *   detail:string}}
 */
export function describeOutcome(expenseRow) {
  if (!expenseRow) return null;

  const status = canonicalStatus(expenseRow.status);
  const wrote = Boolean(expenseRow.remoteResult);
  const who = String(expenseRow.reviewer ?? "").trim() || null;

  // The two terminal human verdicts, and the automation's own approval. All
  // three share rule 2 above, so they share one shape.
  const settledVerdicts = {
    auto_approved: {
      label: "APPROVED",
      remoteStatus: "approved",
      tone: SETTLED,
      decidedBy: "automation",
      detail: "Every gate passed, so this expense was approved at Remote automatically. No human decision was required.",
    },
    approved: {
      label: "APPROVED",
      remoteStatus: "approved",
      tone: SETTLED,
      decidedBy: who,
      detail: who
        ? `Approved at Remote by ${who}.`
        : "Approved at Remote. No approver is recorded against the row, which is itself worth checking.",
    },
    declined: {
      label: "DECLINED",
      remoteStatus: "declined",
      tone: STOPPED,
      decidedBy: who,
      detail: who
        ? `Declined at Remote by ${who}, with the reason shown below.`
        : "Declined at Remote. No approver is recorded against the row, which is itself worth checking.",
    },
  };

  const verdict = settledVerdicts[status];
  if (verdict) {
    if (wrote) return { ...verdict, terminal: true, writeConfirmed: true };
    // Rule 2. The decision stands; the write is unproven. Say both, and do NOT
    // claim a Remote status we have no response for.
    return {
      label: `${verdict.label} — NOT CONFIRMED AT REMOTE`,
      remoteStatus: null,
      tone: WAITING,
      terminal: true,
      writeConfirmed: false,
      decidedBy: verdict.decidedBy,
      detail:
        `The decision is recorded${who ? ` (${who})` : ""}, but no Remote write is recorded against it — ` +
        "so the expense may still be pending at Remote. Check the audit trail before telling anyone the money moved.",
    };
  }

  // Rule 1. Held and flagged are BOTH still pending at Remote, and neither is
  // decided — `terminal: false` is what stops the badge contradicting the
  // buttons rendered under it.
  if (status === "held") {
    return {
      label: "PENDING",
      remoteStatus: "pending",
      tone: WAITING,
      terminal: false,
      writeConfirmed: null,
      decidedBy: who,
      detail: `Held by Finance Ops${who ? ` (${who})` : ""} — nothing has been written to Remote, so the expense is still pending there and can still be approved or declined.`,
    };
  }
  if (status === "flagged") {
    return {
      label: "PENDING",
      remoteStatus: "pending",
      tone: WAITING,
      terminal: false,
      writeConfirmed: null,
      decidedBy: null,
      detail: "Awaiting a Finance Ops decision. Nothing has been written to Remote, so the expense is still pending there.",
    };
  }

  // Blocked and escalated. Deliberately NOT given a Remote status: this system
  // refused before writing anything, and naming the expense `pending` would read
  // as a state we had observed rather than one we simply never changed.
  if (status === "blocked" || status === "escalated") {
    return {
      label: "NO REMOTE WRITE",
      remoteStatus: null,
      tone: STOPPED,
      terminal: true,
      writeConfirmed: null,
      decidedBy: null,
      detail:
        status === "blocked"
          ? "Refused by a hard gate before any write. Nothing was sent to Remote and there is no Finance Ops decision to take here."
          : "Escalated before any write. Nothing was sent to Remote; the escalation is handled on its own ticket.",
    };
  }

  // An unrecognised status. Report it verbatim rather than rounding it to the
  // nearest known outcome — the honest direction, and the one that makes a
  // future status visible instead of silently mislabelled.
  return {
    label: String(expenseRow.status ?? "UNKNOWN").toUpperCase(),
    remoteStatus: null,
    tone: WAITING,
    terminal: false,
    writeConfirmed: null,
    decidedBy: who,
    detail: `This expense carries a status the outcome vocabulary does not recognise (${String(expenseRow.status)}). Nothing is being claimed about Remote.`,
  };
}

/**
 * An expense that never reached Finance Ops, described by which of the three
 * outcomes it actually got — and, for a refusal, what that refusal MEANT.
 */
export function describeNoReviewPath(expenseRow) {
  const gate = describeDecidingGate(expenseRow.reason);
  const because = gate.means ? ` ${gate.means}` : "";

  if (expenseRow.decision === "auto_approve") {
    const when = expenseRow.autoApprovedAt ? ` on ${expenseRow.autoApprovedAt}` : "";
    return `This expense was AUTO-APPROVED${when} — every gate passed, so no human decision was ever required.${because} There is nothing here for Finance Ops to weigh.`;
  }
  if (expenseRow.decision === "blocked") {
    return `This expense was BLOCKED at gate ${gate.position} (${gate.gate}).${because} A block is a hard stop, not an exception for Finance Ops to weigh — there is nothing to approve.`;
  }
  if (expenseRow.decision === "escalate") {
    return `This expense was ESCALATED at gate ${gate.position} (${gate.gate}).${because} It has no approval path here; the escalation is handled on its own ticket.`;
  }
  return REFUSALS.not_awaiting_review.reason;
}

/** @param {keyof REFUSALS} code */
export function refuse(code, extra = {}) {
  const { status, reason } = REFUSALS[code];
  return { allowed: false, code, reason, status, ...extra };
}
