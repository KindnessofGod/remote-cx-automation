// ---------------------------------------------------------------------------
// approverIdentity.js  —  who counts as "a different human" in a four-eyes check
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
// UC-06 and UC-09 both require independent approvals from separate people
// before anything executes — a contract amendment that changes pay, and an
// off-cycle payroll payment. That control is the entire reason those use cases
// are allowed to have an execution path at all (see UC-09.md's tier-framing
// note: a risk score may raise the number of approvers, never remove the human).
//
// An authorized penetration test of this repo defeated the control in both
// places, in seconds:
//
//   UC-06 — dualApprovalPolicy.js compared ROLES but never compared PEOPLE, so
//           one person approved as customer_admin and then again as
//           payroll_specialist, and the real Remote write fired.
//   UC-09 — multiApprovalPolicy.js compared approver identities with `===`, so
//           "Bob Smith", "bob smith" and "BOB SMITH" counted as three separate
//           humans and filled all three slots on a payment.
//
// Both are the same defect wearing different clothes: the system knew how many
// approvals it had, and not how many PEOPLE it had. This module is the single
// answer to that question, so the rule cannot drift between the two use cases.
//
// DESIGN NOTE — this normalises for COMPARISON only. The raw string the human
// supplied is what gets written to the audit log, always. Normalising the
// stored value would quietly rewrite the record of who approved what, which is
// exactly the thing an audit trail exists to prevent.
// ---------------------------------------------------------------------------

// Characters from other scripts that render identically (or near enough) to
// ASCII in a proportional UI font. Without folding these, "аdmin@x.com" with a
// Cyrillic а is a different string but the same-looking person — which is all
// an attacker needs when the check is a string comparison and the reviewer is
// a human glancing at a list. NFKC does NOT fold these: it normalises width and
// compatibility forms, not cross-script confusables.
const CONFUSABLES = new Map(Object.entries({
  // Cyrillic
  а: "a", в: "b", е: "e", к: "k", м: "m", н: "h", о: "o", р: "p", с: "c", т: "t", у: "y", х: "x",
  А: "a", В: "b", Е: "e", К: "k", М: "m", Н: "h", О: "o", Р: "p", С: "c", Т: "t", У: "y", Х: "x",
  // Greek
  α: "a", β: "b", ε: "e", ι: "i", κ: "k", ν: "v", ο: "o", ρ: "p", τ: "t", υ: "u", χ: "x",
  Α: "a", Β: "b", Ε: "e", Ι: "i", Κ: "k", Ν: "n", Ο: "o", Ρ: "p", Τ: "t", Υ: "y", Χ: "x",
}));

/**
 * Reduce an approver identity to a canonical form for comparison.
 *
 * Steps, each earning its place against a bypass the pentest actually used or
 * that trivially follows from one:
 *   1. NFKC          — collapses full-width and compatibility forms.
 *   2. trim + collapse internal whitespace — " bob  smith " === "bob smith".
 *   3. lowercase     — email local parts are case-insensitive in every practical
 *                      identity system, and display names always are.
 *   4. confusable fold — see CONFUSABLES above.
 *
 * @param {unknown} value
 * @returns {string} canonical form, or "" when the value is not a usable identity
 */
export function canonicalizeApprover(value) {
  if (typeof value !== "string") return "";
  let s = value.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
  s = [...s].map((ch) => CONFUSABLES.get(ch) ?? ch).join("");
  return s;
}

/**
 * True when `value` is a usable approver identity at all. Empty, whitespace-only
 * and non-string values fail closed — an anonymous approval is not an approval.
 * @param {unknown} value
 * @returns {boolean}
 */
export function isUsableApprover(value) {
  return canonicalizeApprover(value).length > 0;
}

/**
 * True when two approver identities denote the SAME human for four-eyes
 * purposes. Two unusable identities are NOT "the same person" — they are both
 * invalid, which callers must reject separately rather than treat as a match.
 * @param {unknown} a
 * @param {unknown} b
 * @returns {boolean}
 */
export function isSameApprover(a, b) {
  const ca = canonicalizeApprover(a);
  const cb = canonicalizeApprover(b);
  if (!ca || !cb) return false;
  return ca === cb;
}

/**
 * Count how many genuinely DISTINCT humans appear in a list of approver
 * identities. This is the number a four-eyes floor must be compared against —
 * never the number of filled slots, which is what both use cases were doing.
 * @param {Array<unknown>} approvers
 * @returns {number}
 */
export function countDistinctApprovers(approvers) {
  const set = new Set();
  for (const a of approvers || []) {
    const c = canonicalizeApprover(a);
    if (c) set.add(c);
  }
  return set.size;
}
