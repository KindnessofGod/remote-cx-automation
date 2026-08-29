// ---------------------------------------------------------------------------
// gateLadder.js  —  Turning a decision's reason slug into something a human
//                   can read, without moving the decision itself anywhere.
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
// Every policy engine in this repo returns `{decision, reason, flags}`, and the
// reason is a slug: `over_policy_cap`, `duration_over_cap`,
// `employer_permission_not_granted`. A slug is the right thing to STORE — it is
// the exact string in `audit_log`, in the metrics exception ranking, and in the
// n8n Code-node ports, so it is the thing a person searches by. It is the wrong
// thing to SHOW on its own: a tester reading `human_review / over_policy_cap`
// above a gate description phrased as the passing condition ("the converted
// amount is within the category cap") has to invert the sentence themselves to
// work out what actually happened.
//
// The fix is data, not prose in a template: each policy engine publishes a
// `GATE_SEQUENCE` beside its own gates — one row PER REASON (a single gate can
// refuse several ways, and each way means something different to a person) —
// carrying the gate's position in the real evaluation order, the condition it
// checks, and a `means` sentence saying in plain words what it is to a human
// when THAT reason is the one that decided.
//
// This file holds the two pure functions that walk such a sequence. They are
// here rather than duplicated per use case for the reason CLAUDE.md §6 already
// records about the gates themselves: anything that exists twice drifts, and
// the traversal is entirely use-case independent — only the DATA is specific,
// and the data stays beside the gates it describes so a new gate and its row
// are added in the same edit.
//
// SHAPE OF A ROW
//   {
//     position: 1-based place in the actual evaluation order (unique per row —
//               where one gate can refuse several ways, the rows carry the
//               order the source checks them in, because that order is real:
//               it decides which reason wins when more than one applies),
//     reason:   the exact slug the engine returns,
//     gate:     the gate's name — shared by sibling rows of the same gate,
//     checks:   what is true when this rung is SATISFIED (the passing
//               condition), so "passed" reads correctly against it,
//     means:    what it is to a person when this rung is the one that decided,
//   }
//
// The raw slug is never removed from anything — `means` sits BESIDE it.
// ---------------------------------------------------------------------------

/**
 * @typedef {object} GateRow
 * @property {number} position
 * @property {string} reason
 * @property {string} gate
 * @property {string} checks
 * @property {string} means
 */

/**
 * Which rung of the ladder decided this outcome, and what that means.
 *
 * Returns `null` — never a guess — when the reason has no row. That is the
 * honest degradation: the caller then shows the bare slug, exactly what it
 * showed before any of this existed. A fabricated "unknown gate" row would
 * read like a position in the sequence and be worse than no answer. The drift
 * guard in test/gateLadder.test.js exists so that null is a bug report rather
 * than a normal state.
 *
 * @param {GateRow[]} sequence  the use case's own GATE_SEQUENCE
 * @param {string} reason       the slug the policy engine returned
 * @returns {(GateRow & {total:number})|null}
 */
export function describeDecidingGate(sequence, reason) {
  const row = sequence.find((r) => r.reason === reason);
  if (!row) return null;
  // `total` IS THE NUMBER OF RUNGS, NOT THE NUMBER OF ROWS.
  //
  // These are the same number only while every rung has exactly one reason,
  // which stopped being true for UC-01 when G-1 landed: engagement eligibility
  // is ONE gate that refuses FIVE ways, and the terminal gate has two outcomes,
  // so the table has 18 rows describing 13 rungs. `sequence.length` then told a
  // specialist "decided at gate 11 of 18" — a sentence in which one of the two
  // numbers counts gates and the other counts table rows, and which invites the
  // reader to believe there are seven more checks than exist.
  //
  // Counting distinct positions is also what makes the ladder renderable: a
  // rung marked `not_reached` has to be one rung whatever its reason count.
  const total = new Set(sequence.map((r) => r.position)).size;
  return { ...row, total };
}

/**
 * The whole ordered ladder, with each rung marked against this outcome:
 *
 *   "passed"      — this rung's condition held (or, for a sibling outcome of
 *                   the deciding gate, did not apply). `checks` is written as
 *                   the passing condition precisely so this reads correctly.
 *   "decided"     — this is the rung that produced the decision.
 *   "not_reached" — evaluation stopped before this rung ran, so nothing is
 *                   known about it. NOT "it would have passed."
 *
 * Returns `[]` for a reason with no row. A ladder whose statuses are all
 * guessed is worse than no ladder — and `describeDecidingGate()` has already
 * returned null, so the caller knows why.
 *
 * @param {GateRow[]} sequence
 * @param {string} reason
 * @returns {Array<GateRow & {status:"passed"|"decided"|"not_reached"}>}
 */
export function describeGateLadder(sequence, reason) {
  const deciding = sequence.find((r) => r.reason === reason);
  if (!deciding) return [];
  return sequence.map((row) => ({
    ...row,
    status:
      row.reason === deciding.reason
        ? "decided"
        : row.position < deciding.position
          ? "passed"
          : "not_reached",
  }));
}

/**
 * Bind both functions to one use case's sequence, so each policy engine can
 * export single-argument `describeDecidingGate(reason)` /
 * `describeGateLadder(reason)` — the call shape every caller (server view,
 * portal, sidebar) uses, identical across use cases.
 *
 * @param {GateRow[]} sequence
 */
export function bindGateDescriptions(sequence) {
  return {
    describeDecidingGate: (reason) => describeDecidingGate(sequence, reason),
    describeGateLadder: (reason) => describeGateLadder(sequence, reason),
  };
}
