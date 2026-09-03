// ---------------------------------------------------------------------------
// policyEngine.js  —  UC-02's deterministic gates (no AI in here)
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
// Same role as src/uc01/policyEngine.js and src/uc06/policyEngine.js: this is
// the system's judgment, and it contains no model output. The classifier may
// pick a category and attach a confidence — the gates decide what that is
// allowed to mean, and a confident classification can never override a failed
// deterministic check (that is the whole point of prime directive #1). Ordered
// gates, first failure wins:
//
//   0. upstream reads — did every Remote read this decision rests on actually
//                       SUCCEED? A failed read is not a policy refusal, and
//                       must never be recorded as one (see shared/
//                       upstreamFailure.js for the live evidence)
//   1. identity       — is the submitter the authenticated employee the expense
//                       belongs to? (shared/identity.js, fails closed)
//   2. employment     — is that employee still active? (can't pay a terminee)
//   3. expense        — does the expense exist at all?
//   4. ownership      — is the expense actually THIS employee's, not someone
//                       else's slipped in by id?
//   5. state          — is the expense still PENDING? (F-11) an approved,
//                       declined, reimbursed or canceled expense is somebody's
//                       finished decision -> hard block, never overturned
//                       (Remote's own spelling on both counts: the enum member
//                       is `reimbursed`, not `paid`, and `canceled` with one
//                       `l` — the double-`l` form is Remote's spelling on
//                       time off, travel letters and work authorizations, and
//                       normalising the two to a house style would break two
//                       enums to fix two others. REMOTE-VOCABULARY.md §6.6.)
//   6. duplicate      — receipt hash already processed? -> hard block
//   7. category       — the classified category must exist in the employee's
//                       real active list; never trust an invented id
//   8. receipt        — is there an actual receipt artifact behind this money?
//   9. amount sanity  — every amount must be a finite integer ×100 value (F-23)
//                       BEFORE any arithmetic or cap comparison
//   10. reconciliation— the record's own money figures must agree with each
//                       other (tax containment + conversion identity)
//   11. currency      — a cross-currency expense cannot be verified from the
//                       record, because the record carries no rate
//   12. policy cap    — the cap must be KNOWN (F-12), denominated in the same
//                       currency as the figure being compared, and not exceeded
//   13. confidence    — < 0.85 (spec §8) -> a human reviews the receipt
//   14. expense date  — the schema says it "must be in the past"
//
// Gates 1–6 are hard stops (escalate / block). Gates 7–14 route to
// `human_review` — the expense is legitimately a candidate for a Finance Ops
// specialist, not something 1-click automation should paper over.
//
// ===========================================================================
// WHAT HAPPENED TO THE ITEMIZATION AND LINE-SUM GATES  (read this before
// "simplifying" anything below)
// ===========================================================================
// Gates 8 and 10 used to be `missing_itemized_breakdown` and `math_mismatch`:
// the expense had to carry an `expense.lines[]` array, and those lines had to sum
// to `expense.total_amount`.
//
// NONE OF THOSE FIELDS EXIST. Verified 2026-08-17 against 220 live sandbox
// records and the `Expense` schema at developer.remote.com: a Remote expense
// has `amount`, not `total_amount`; `currency` as an OBJECT, not
// `total_currency` as a string; and NO itemization array of any kind. Remote's
// expense model has no parts. So `Array.isArray(expense.lines)` was always
// false, every real expense stopped at `missing_itemized_breakdown`, and UC-02
// could not approve anything — for months, while every fail-closed test in the
// suite stayed green, because a use case that structurally cannot succeed is
// indistinguishable from one being appropriately cautious.
//
// DELETING THE CHECK WAS NOT AN OPTION. A gate that cannot fail is worse than
// no gate, because it looks like protection. The line-sum check was a real
// integrity control, and the question is what it was really FOR: it refused to
// auto-approve a stated money figure that nothing independent corroborated. It
// compared a stated total against an independently-stated decomposition.
//
// The real record still offers exactly that shape of check — a stated figure
// against an independently-stated second figure — on the quantities it actually
// has. Three of them, and each one CAN fail on representable real data:
//
//  (a) RECEIPT EVIDENCE (gate 8). The receipt is the record's only independent
//      artifact: the document the expense rests on. `receipts` is an array
//      with `maxItems: 5`, so an EMPTY one is representable, and an expense with
//      no receipt has literally nothing behind the number. This use case is
//      named "Expense & Receipt Validation"; a receiptless auto-approval would
//      be the one thing it must never do. This is the itemization gate's true
//      heir — same purpose ("is this re-checkable?"), on the artifact the real
//      model provides instead of one it doesn't.
//
//  (b) TAX CONTAINMENT (gate 10). The schema defines `tax_amount` as "the tax
//      portion OF the expense amount". A portion cannot exceed its whole, so
//      `0 <= tax_amount <= amount` is a genuine arithmetic invariant with real
//      semantics — and nothing upstream enforces it, since both are separately
//      submitted integers. Same for the converted pair.
//
//  (c) CONVERSION IDENTITY (gate 10). When `currency.code ===
//      converted_currency.code` no conversion happened, so the conversion is
//      the identity map and `converted_amount` MUST equal `amount` (and
//      `converted_tax_amount` MUST equal `tax_amount`). These are four
//      independently stored integers that have to reconcile exactly. This is
//      the closest structural analogue to the old line sum: two figures that
//      must agree, where disagreement means the record contradicts itself.
//
// WHAT IS HONESTLY *NOT* CHECKABLE, AND IS THEREFORE REFUSED RATHER THAN
// WAVED THROUGH: a CROSS-currency expense. The real record carries no
// `conversion_rate` field (confirmed — it is not in the schema), so given only
// `amount` and `converted_amount` in different currencies, ANY converted figure
// is consistent with SOME rate. There is nothing to verify. The tax pair could
// in principle imply the same rate, but `tax_amount` is small (10 minor units
// on every live row, against amounts up to 1,138,127) and integer rounding
// swamps the ratio — a "same implied rate" test would be noise dressed up as a
// control. So gate 11 flags every cross-currency expense for a human, which is
// exactly what UC-02.md §7/§9 already ask for ("flag estimation vs. final
// rate"). Being able to say "this cannot be verified" is the point.
//
// AND THE VAT GATE IS GONE ON PURPOSE — see the note above gate 12.
// ---------------------------------------------------------------------------

import { findUpstreamFailure, upstreamVerdict, UPSTREAM_NOT_FOUND } from "../shared/upstreamFailure.js";
import { POLICY_CAP_CURRENCY } from "./policyCaps.js";
import { formatMoney } from "../shared/money.js";
import { selectableCategories } from "./expenseCategories.js";
import { decisionFacts, fact, unknownFact } from "../shared/decisionFacts.js";
import { shortReference } from "../shared/publicReference.js";
import { humanTime } from "../shared/settledDecision.js";

export const CONFIDENCE_THRESHOLD = 0.85;

/**
 * The three ways gate 12 can refuse. Named once so describeCapComparison()
 * below and any caller asking "is this a cap decision?" read the same set.
 */
export const CAP_REASONS = new Set([
  "over_policy_cap",
  "policy_cap_unknown",
  "policy_cap_currency_mismatch",
]);

/**
 * The only expense states this automation may act on (finding F-11).
 * UC-02.md §3: the write "approves a PENDING expense" — every other state
 * (approved / declined / processing / reimbursed / canceled / anything Remote
 * adds later / a record with no status at all) is a decision somebody has
 * already made, and re-approving it either overturns a human or pays twice.
 * Those five are Remote's own `Expense.status` enum members verbatim —
 * REMOTE-VOCABULARY.md §6.6 caught this list naming `paid` and `cancelled`,
 * neither of which is a member, and this is the documentation a later widening
 * of the whitelist below would be argued from.
 *
 * A WHITELIST, not a blacklist, on purpose: a status this table has never
 * heard of must block, not slip through. Widen it only against a live
 * sandbox response that proves the extra value really is pre-decision.
 */
export const APPROVABLE_EXPENSE_STATUSES = new Set(["pending"]);

/**
 * Is this a legitimate money value in Remote's integer ×100 domain?
 * (finding F-23.) Rejects, by construction: non-numbers (`null` -> 0 and
 * `true` -> 1 both survive `Number()`, which is exactly how a boolean once
 * satisfied the lineSum === statedTotal check), NaN/Infinity, and any
 * fractional value — 100.5 cannot exist in a ×100 integer domain, and
 * accepting it means the scaling invariant was violated upstream.
 * @param {unknown} value
 */
export function isMoneyScaledInteger(value) {
  return typeof value === "number" && Number.isSafeInteger(value);
}

/**
 * Evaluate one expense submission against every gate.
 * @param {object} args
 * @param {boolean} args.identityVerified   submitter is the authenticated owner (see workflow.js)
 * @param {boolean} args.employmentActive   the employment record is status "active"
 * @param {object|null} args.expense        the Remote expense record, in its REAL shape:
 *   `{amount, currency:{code,…}, converted_amount, converted_currency:{code,…},
 *     tax_amount, converted_tax_amount, receipts:[File], expense_date, status,
 *     expense_category:{code,…}|null, …}`. Every amount is an integer in the
 *   currency's minor unit ("in cents" per the schema) — `amount: 4647` is
 *   £46.47. There is no `total_amount`, no `lines[]` and no `vat_amount`.
 * @param {boolean} args.expenseOwned       expense.employment_id === the submitted employmentId
 * @param {object|null} args.duplicate      a previously-processed expense with the same receipt hash, or null
 * @param {boolean} args.categoryValid      classified category id exists in the employee's active list
 * @param {object} args.classification      {categoryId, confidence, reason, source} from the classifier
 * @param {number|null} args.policyCap      the category's spend cap in integer ×100, or null when UNKNOWN
 *   (null is "no cap could be found", which routes to a human — see F-12)
 * @param {{extracted: object|null, source: string, reason: string}|null} [args.receiptReading]
 *   What receiptExtraction.js read off the attached receipt, or null/absent when
 *   no reading was attempted on this path. ABSENT IS NOT "UNREADABLE" — see gate
 *   8b. Defaults to `null`, so every existing caller and test is unaffected and
 *   the green tier is not disabled by wiring this in.
 * @param {Array<{call:string,status:number|null,kind:string,message:string}>} [args.upstreamFailures]
 *   Reads that FAILED rather than returned data (shared/upstreamFailure.js).
 *   Defaults to `[]`, so every existing caller and test is unaffected. Each
 *   entry can only ever make this function stricter — see the gates below.
 * @returns {{decision:"auto_approve"|"human_review"|"blocked"|"escalate", reason:string, flags:string[]}}
 */
/**
 * THE GATES IN ORDER, as data — so a decision can say WHICH one decided it.
 *
 * WHY THIS EXISTS (the defect it fixes)
 * A tester submitted an expense belonging to somebody else, got
 * `escalate / expense_employment_mismatch`, and saw "Classifier confidence 0.9"
 * printed beside it. They reasonably asked why the system escalates at 0.9
 * confidence. It does not — the two facts are unrelated, and presenting them
 * side by side with no relationship shown made the confidence look causal.
 *
 * Ownership is gate 4. Confidence is gate 13. First failure wins, so that run
 * stopped at gate 4 and the confidence value was never consulted by anything.
 * It describes the LLM's certainty about the expense CATEGORY, which is exactly
 * the separation prime directive #1 exists to enforce: the LLM interpreted, the
 * deterministic code decided, and the deterministic code refused on a fact the
 * LLM has no say in.
 *
 * EACH ROW ALSO CARRIES `means`: what it is to a person when THAT reason fires.
 * `checks` describes the gate ("the converted amount is within the category
 * cap"); `means` describes the outcome ("the expense is ABOVE the spend cap for
 * its category, so a person has to authorise it"). A tester reading
 * `over_policy_cap` beside a gate description phrased as the passing condition
 * had to invert the sentence themselves to learn what had happened, and asked
 * for it to be said plainly. It is per-REASON and not per-gate because one gate
 * refuses several ways: position 12 alone means "no cap exists", "the cap is in
 * another currency" or "the expense is over it", which are three different things
 * to tell somebody.
 *
 * The slug is still shown beside it. It is the audit vocabulary — the exact
 * string in `audit_log`, in the metrics ranking and in the n8n ports — so
 * replacing it with prose would break the reader's ability to search for it.
 *
 * The right fix is to make the run legible rather than to hide the confidence —
 * hiding an input is its own dishonesty. So the position of each gate lives
 * HERE, beside the gates themselves, and a caller can render "gate 4 of 14
 * decided this; the classifier's confidence was never reached". Nothing
 * downstream re-derives gate order; test/uc02Review.test.js pins that every
 * reason `evaluate()` can return appears below, so the two cannot drift.
 */
export const GATE_SEQUENCE = Object.freeze([
  { position: 0, reason: "upstream_unavailable", gate: "Upstream read", checks: "the employment record could be read at all", means: "Remote's API could not be reached, so this expense was never evaluated. Nothing has been decided about it either way." },
  { position: 0, reason: "upstream_record_not_found", gate: "Upstream read", checks: "the employment record could be read at all", means: "Remote has no employment record under that id, so there was nothing to check this expense against." },
  { position: 1, reason: "identity_not_verified", gate: "Identity", checks: "the submitter is the employee on the record", means: "The submitter could not be matched to the employee on the record, so nothing about the expense was disclosed or decided." },
  { position: 2, reason: "employee_not_active", gate: "Employment status", checks: "the employment is active", means: "The employment is not active, so an expense cannot be reimbursed against it." },
  { position: 3, reason: "expense_not_found", gate: "Expense exists", checks: "the expense record exists at Remote", means: "No expense with that id exists at Remote." },
  { position: 4, reason: "expense_employment_mismatch", gate: "Ownership", checks: "the expense belongs to the submitter", means: "The expense belongs to a different employee, so the person who submitted it cannot act on it." },
  { position: 5, reason: "expense_not_pending", gate: "Expense state", checks: "the expense is still pending a decision", means: "The expense has already been approved or declined. Deciding it again would either overturn a person's decision or pay it twice." },
  { position: 6, reason: "duplicate_submission", gate: "Duplicate receipt", checks: "this receipt was not already reimbursed", means: "This receipt was already reimbursed on another expense, so paying it again would pay the same expense twice." },
  { position: 7, reason: "category_unverified", gate: "Category", checks: "the category is a real, fileable one for this employee", means: "The category is not one this employee can file against, so the spend cannot be checked against any policy cap." },
  { position: 8, reason: "missing_receipt_evidence", gate: "Receipt evidence", checks: "a receipt is attached", means: "No receipt is attached, so there is nothing evidencing what was spent." },
  { position: 8, reason: "receipt_unreadable", gate: "Receipt evidence", checks: "the attached receipt could actually be read", means: "The receipt is attached but could not be read, so nothing has checked what it says. An unreadable receipt is an unchecked one." },
  { position: 8, reason: "receipt_does_not_support_claim", gate: "Receipt evidence", checks: "the receipt agrees with the recorded claim", means: "What the receipt shows does not match what the claim records, so a person compares the two readings side by side." },
  { position: 9, reason: "invalid_amount", gate: "Amount sanity", checks: "every money field is a valid ×100 integer", means: "One of the money fields is not a whole number of minor units, so the arithmetic on it cannot be trusted." },
  { position: 10, reason: "tax_exceeds_amount", gate: "Tax containment", checks: "the tax portion does not exceed its whole", means: "The tax portion is larger than the expense it is part of, which cannot be correct." },
  { position: 11, reason: "currency_conversion_unverified", gate: "Conversion", checks: "a cross-currency expense cannot be verified, so a human decides", means: "The expense was filed in one currency and converted into another, and this system cannot verify the rate that was used — so a person decides rather than approving a figure it cannot check." },
  { position: 11, reason: "conversion_identity_mismatch", gate: "Conversion", checks: "same-currency figures agree with each other", means: "The expense says it was not converted, yet its original and converted figures differ." },
  { position: 12, reason: "policy_cap_unknown", gate: "Policy cap", checks: "a cap exists for this category", means: "No spend cap could be found for this category, so there is nothing to compare the amount against. A person decides rather than approving an amount nothing checked." },
  { position: 12, reason: "policy_cap_currency_mismatch", gate: "Policy cap", checks: "the cap is denominated in the billing currency", means: "The category's spend cap is set in a different currency from the expense, so the two amounts cannot be compared." },
  { position: 12, reason: "over_policy_cap", gate: "Policy cap", checks: "the converted amount is within the category cap", means: "The expense is ABOVE the spend cap for its category, so a person has to authorise it." },
  { position: 13, reason: "low_confidence", gate: "Classifier confidence", checks: "the category classification is confident enough", means: "The classifier was not confident enough about which category this belongs to, so a person confirms it." },
  { position: 14, reason: "expense_date_invalid", gate: "Expense date", checks: "the expense date is in the past", means: "The expense is dated in the future." },
  { position: 15, reason: "all_gates_passed", gate: "All gates", checks: "every gate above passed", means: "Every check passed: the expense belongs to this employee, its category is one they can file against, it carries a receipt, and the amount is within that category's spend cap — so no person is needed." },
]);

/** The position of the gate that reads `classification.confidence`. */
export const CONFIDENCE_GATE_POSITION = 13;

/**
 * Which gate produced this decision, and whether the classifier's confidence
 * was ever consulted on the way there.
 *
 * PURE, AND IT DECIDES NOTHING — it describes a decision already made. Callers
 * render it; no gate anywhere reads it.
 *
 * @param {string} reason  the `reason` an evaluate() result carried
 * @returns {{position:number|null, gate:string, checks:string, confidenceConsulted:boolean, note:string}}
 */
/** How many rungs the ladder has, derived from the sequence rather than
 *  counted by hand — "gate 12" means nothing without "of 16", and a hardcoded
 *  total would go stale the first time a gate is inserted. */
const LADDER_LENGTH = new Set(GATE_SEQUENCE.map((g) => g.position)).size;

export function describeDecidingGate(reason) {
  const entry = GATE_SEQUENCE.find((g) => g.reason === reason);
  if (!entry) {
    // An unrecognised reason gets an honest "we cannot say", never a guess —
    // a wrong attribution is worse than an absent one.
    return {
      position: null,
      gate: "unknown",
      checks: "",
      means: "",
      ladderLength: LADDER_LENGTH,
      confidenceConsulted: false,
      note: `No gate in GATE_SEQUENCE matches the reason "${reason}", so which gate decided cannot be stated.`,
    };
  }
  const confidenceConsulted = entry.position >= CONFIDENCE_GATE_POSITION;
  return {
    position: entry.position,
    gate: entry.gate,
    checks: entry.checks,
    means: entry.means,
    ladderLength: LADDER_LENGTH,
    confidenceConsulted,
    note: confidenceConsulted
      ? "The run reached the classifier-confidence gate, so the confidence figure below was consulted."
      : `The gates run in order and the first failure wins, so this run stopped at gate ${entry.position} (${entry.gate}) — BEFORE gate ${CONFIDENCE_GATE_POSITION}, where the classifier's confidence is read. That figure describes how sure the LLM was about the expense CATEGORY; it played no part in this outcome.`,
  };
}

/**
 * Reasons that mean NOBODY TRIED, as opposed to tried-and-failed.
 *
 * The difference decides whether a claim is refused. `extraction_not_configured`
 * is a deployment that has no reader wired; `no_receipt_attached` is the
 * ordinary case where the receipt lives on the Remote expense record and never
 * touched the Zendesk ticket — which is MOST expense tickets. Treating either as
 * "unreadable" would refuse almost everything and disable the green tier, the
 * failure §16.8 of the acceptance contract exists for.
 *
 * Everything NOT in this list refuses, so the list is the thing to be careful
 * about: adding a genuine failure here would silently re-open the hole [E-1]
 * closed.
 */
export const RECEIPT_NOT_ATTEMPTED_REASONS = Object.freeze([
  "extraction_not_configured",
  "no_receipt_attached",
  "zendesk_not_configured",
  "no_ticket_supplied",
]);

export function evaluate({
  identityVerified,
  employmentActive,
  expense,
  expenseOwned,
  duplicate,
  categoryValid,
  classification,
  policyCap,
  receiptReading = null,
  upstreamFailures = [],
  now = new Date(),
}) {
  // Gate 0 — the employment read. FIRST, because gates 1, 2 and 4 all read the
  // employment record: when that fetch failed, "identity not verified" and
  // "employee not active" are not findings, they are artifacts of having no
  // record to check. This is exactly the misattribution live execution 4218
  // produced (a 404'd employment recorded as `identity_not_verified` while the
  // webhook carried a valid authenticated session).
  const employmentFailure = upstreamVerdict(findUpstreamFailure(upstreamFailures, "employment"));
  if (employmentFailure) return employmentFailure;

  if (!identityVerified) {
    return { decision: "escalate", reason: "identity_not_verified", flags: ["identity_not_verified"] };
  }
  if (!employmentActive) {
    return { decision: "escalate", reason: "employee_not_active", flags: ["employee_not_active"] };
  }
  // Gate 3 — the expense itself. Note the failure list is checked BEFORE
  // `!expense`, not inside it: a read that failed produced no data anyone may
  // rely on, so the failure decides this gate whatever else was passed
  // alongside it. (A caller handing in both a failure and a record is
  // contradicting itself; failing closed on the failure is the only safe
  // reading, and a test pins it.)
  //
  // A 404 IS an authoritative "this expense does not exist", and this gate
  // already names that precisely — so the reason stays and the upstream flag is
  // added beside it, letting a triager see it came from a real Remote 404
  // rather than from a normalizer dropping the field. Any OTHER failure (403,
  // 5xx, transport) is not an answer about the expense at all, and takes the
  // upstream reason: we do not know whether this expense exists.
  const expenseFailure = findUpstreamFailure(upstreamFailures, "expense");
  if (expenseFailure && expenseFailure.kind !== UPSTREAM_NOT_FOUND) return upstreamVerdict(expenseFailure);
  if (!expense || expenseFailure) {
    return {
      decision: "escalate",
      reason: "expense_not_found",
      flags: expenseFailure
        ? ["expense_not_found", `upstream_expense_${expenseFailure.status ?? "error"}`]
        : ["expense_not_found"],
    };
  }
  if (!expenseOwned) {
    return { decision: "escalate", reason: "expense_employment_mismatch", flags: ["expense_employment_mismatch"] };
  }
  // Gate 5 — state (F-11). Placed with the other hard stops, and BEFORE the
  // duplicate check, because "this expense was already decided" is a fact about
  // the record itself: an already-approved expense must not be re-approved
  // even on its very first pass through this system.
  if (!APPROVABLE_EXPENSE_STATUSES.has(expense.status)) {
    return {
      decision: "blocked",
      reason: "expense_not_pending",
      flags: ["expense_not_pending"],
    };
  }

  if (duplicate) {
    return { decision: "blocked", reason: "duplicate_submission", flags: ["duplicate_submission"] };
  }

  // Gate 7 — the category, validated against the employee's REAL active list.
  // If that list could not be fetched — a 403 from a scope-less token is what
  // execution 4218 actually hit — then nothing about the category was checked,
  // and `category_unverified` blames the classifier for somebody else's outage.
  // Checked ahead of `categoryValid` for the same reason as the expense gate
  // above: a list we never received cannot validate anything, so a `true`
  // arriving beside a failure is not evidence.
  //
  // BOTH kinds take the upstream reason here: a 404 on a collection endpoint is
  // not "this employee has no categories", it is "that endpoint did not answer".
  const categoriesFailure = upstreamVerdict(findUpstreamFailure(upstreamFailures, "expense_categories"));
  if (categoriesFailure) return categoriesFailure;
  if (!categoryValid) {
    return { decision: "human_review", reason: "category_unverified", flags: ["category_unverified"] };
  }

  // Gate 8 — RECEIPT EVIDENCE (the itemization gate's heir; see the header).
  // Not merely "the array is non-empty": a File row the schema would reject is
  // a placeholder, not an artifact anybody could pull up and re-check.
  if (!usableReceipts(expense).length) {
    return { decision: "human_review", reason: "missing_receipt_evidence", flags: ["missing_receipt_evidence"] };
  }

  // Gate 8b — DOES THE RECEIPT SUPPORT THE CLAIM? [E-1]
  //
  // Gate 8 above proves an artifact EXISTS. This one is the first thing in this
  // use case that reads what the artifact SAYS. Acceptance contract §6:
  // "The receipt image contradicts the record — wrong vendor, wrong date, wrong
  // currency, or a total that is not the claimed amount" -> `human_review` /
  // `receipt_does_not_support_claim`, and "the receipt cannot be fetched or
  // cannot be read" -> `human_review` / `receipt_unreadable`, because "an
  // unreadable receipt is an unchecked one".
  //
  // THREE PROPERTIES THIS IS BUILT TO HOLD, all of them testable:
  //
  // 1. REMOTE'S FIGURES ARE NEVER OVERWRITTEN BY THE MODEL'S (§13). Nothing
  //    below assigns to `expense`. The model's numbers are compared and then
  //    discarded; they reach a human as a second reading beside Remote's, never
  //    merged into one corrected figure — a merged figure has already decided.
  // 2. IT CAN ONLY EVER REFUSE. There is no branch here returning
  //    `auto_approve`, so no future edit can let a model's transcription
  //    approve anything.
  // 3. IT IS SKIPPED ENTIRELY WHEN NO READING WAS ATTEMPTED. `receiptReading`
  //    absent means the extractor is not wired on this path — which is NOT the
  //    same as a receipt that could not be read, and must not be. Treating
  //    "unconfigured" as "unreadable" would send every claim everywhere to a
  //    human and quietly disable the green tier, which is precisely the failure
  //    §16.8 of the contract exists for.
  if (receiptReading) {
    if (!receiptReading.extracted) {
      // Attempted and failed. `extraction_not_configured` is the one reason
      // that means "nobody tried", so it does not refuse.
      if (!RECEIPT_NOT_ATTEMPTED_REASONS.includes(receiptReading.reason)) {
        return { decision: "human_review", reason: "receipt_unreadable", flags: ["receipt_unreadable"] };
      }
    } else {
      const contradictions = receiptContradictions(expense, receiptReading.extracted);
      if (contradictions.length) {
        return {
          decision: "human_review",
          reason: "receipt_does_not_support_claim",
          // The flags name WHICH field disagreed, so the reviewer's panel can
          // point at it. They are observations, never figures.
          flags: ["receipt_does_not_support_claim", ...contradictions],
        };
      }
    }
  }

  // Gate 9 — amount sanity (F-23), on the REAL field names. Before any
  // arithmetic, because all of it is only meaningful once the numbers are known
  // to be numbers. What this catches that arithmetic alone cannot: `null` and
  // `true` coerce to 0 and 1 through `Number()`, so a malformed record can
  // satisfy an equality check perfectly and auto-approve.
  //
  // `amount`/`converted_amount` must be POSITIVE — a zero-value reimbursement
  // is not something to approve automatically. The tax figures may legitimately
  // be zero (a tax-free expense), so they are only required to be non-negative.
  if (!isMoneyScaledInteger(expense.amount) || expense.amount <= 0) {
    return { decision: "human_review", reason: "invalid_amount", flags: ["invalid_amount"] };
  }
  if (!isMoneyScaledInteger(expense.converted_amount) || expense.converted_amount <= 0) {
    return { decision: "human_review", reason: "invalid_amount", flags: ["invalid_amount"] };
  }
  if (!isMoneyScaledInteger(expense.tax_amount) || expense.tax_amount < 0) {
    return { decision: "human_review", reason: "invalid_amount", flags: ["invalid_amount"] };
  }
  if (!isMoneyScaledInteger(expense.converted_tax_amount) || expense.converted_tax_amount < 0) {
    return { decision: "human_review", reason: "invalid_amount", flags: ["invalid_amount"] };
  }

  // Gate 10a — TAX CONTAINMENT. `tax_amount` is documented as "the tax portion
  // of the expense amount"; a portion cannot exceed its whole. Both sides
  // checked, because the converted pair is stored independently.
  if (expense.tax_amount > expense.amount || expense.converted_tax_amount > expense.converted_amount) {
    return { decision: "human_review", reason: "tax_exceeds_amount", flags: ["tax_exceeds_amount"] };
  }

  // Gate 10b/11 — CONVERSION. Same currency both sides means no conversion
  // happened, so the converted figures must equal the originals exactly;
  // different currencies mean a conversion this record gives us no way to
  // verify. See the header for why no rate can be recovered.
  const from = currencyCode(expense.currency);
  const to = currencyCode(expense.converted_currency);
  if (!from || !to || from !== to) {
    return {
      decision: "human_review",
      reason: "currency_conversion_unverified",
      flags: ["currency_conversion_unverified"],
    };
  }
  if (expense.converted_amount !== expense.amount || expense.converted_tax_amount !== expense.tax_amount) {
    return {
      decision: "human_review",
      reason: "conversion_identity_mismatch",
      flags: ["conversion_identity_mismatch"],
    };
  }

  // Gate 12 — the cap must be KNOWN before it can be enforced (F-12). An
  // unknown cap is not "no cap"; it is a category this system has no policy
  // for, and approving an unbounded amount against no policy is exactly the
  // fail-open this project refuses everywhere else.
  if (!isMoneyScaledInteger(policyCap) || policyCap < 0) {
    return { decision: "human_review", reason: "policy_cap_unknown", flags: ["policy_cap_unknown"] };
  }
  // ...AND IT MUST BE DENOMINATED IN THE SAME CURRENCY AS THE FIGURE IT IS
  // COMPARED AGAINST. The caps corpus is a single flat table of integers; a
  // cap of 50000 means 500.00 of ONE currency. `amount` is in the expense's
  // ORIGINAL currency, which varies per employee — the live account bills in
  // EUR, USD, CAD, SGD and GBP — so comparing every expense's `amount` to one
  // table silently applies a USD cap to GBP pence and SGD cents. That is a
  // category error that mis-enforces policy on most of the workforce while
  // looking like it works.
  //
  // `converted_amount` is defined as the amount "converted to the company's
  // billing currency", which is the only figure a single cap table can
  // meaningfully measure — so that is what gate 12 compares. When the billing
  // currency is not the corpus's currency, the cap is simply not applicable and
  // a human decides. Note that on this sandbox the converted fields are seeded
  // equal to the originals rather than genuinely converted, so this refuses the
  // non-USD expenses outright — which is the honest outcome, not a workaround.
  if (to !== POLICY_CAP_CURRENCY) {
    return {
      decision: "human_review",
      reason: "policy_cap_currency_mismatch",
      flags: ["policy_cap_currency_mismatch"],
    };
  }
  if (expense.converted_amount > policyCap) {
    return { decision: "human_review", reason: "over_policy_cap", flags: ["over_policy_cap"] };
  }

  // FAILS CLOSED, matching UC-01 and UC-03. `undefined < 0.85` and `NaN < 0.85`
  // are both false, so the bare comparison auto-approved every classification
  // whose confidence never arrived — and this is the one of the three whose
  // auto path moves money (PATCH /v1/expenses/:id {status:"approved"}).
  const confidenceValue = classification.confidence;
  if (typeof confidenceValue !== "number" || Number.isNaN(confidenceValue)) {
    // FIXED 2026-08-31. This read `flags.push("confidence_unknown")` and
    // `flags` is bound NOWHERE — not a parameter of `evaluate()`, not declared
    // in this file. So the gate that exists to fail closed on an unusable
    // confidence threw `ReferenceError: flags is not defined` instead of
    // returning `human_review`, and in n8n a throw aborts the node BEFORE the
    // audit write, losing the decision entirely.
    //
    // It survived because no test ever fed a non-numeric confidence: both
    // classifiers always emit a number, so the line is unreachable through the
    // normal path and is exactly the defensive branch you cannot reach on
    // purpose. That is what makes a fail-closed guard worth writing and worth
    // testing directly rather than through the caller.
    return { decision: "human_review", reason: "low_confidence", flags: ["low_confidence", "confidence_unknown"] };
  }
  if (confidenceValue < CONFIDENCE_THRESHOLD) {
    return { decision: "human_review", reason: "low_confidence", flags: ["low_confidence"] };
  }

  // Gate 14 — the expense date. The schema is explicit: "Must be in the past."
  // An expense for money not yet spent is not something to reimburse
  // automatically, and a malformed date is not a date.
  if (!isPastDate(expense.expense_date, now)) {
    return { decision: "human_review", reason: "expense_date_invalid", flags: ["expense_date_invalid"] };
  }

  // NOTE ON VAT (UC-02.md §9, "never auto-assert VAT recovery"). There used to
  // be a gate here refusing any expense whose `vat_amount` was non-zero. That
  // field does not exist on a real Remote expense. The real record has
  // `tax_amount` — simply the tax portion of the expense — and EVERY one of the
  // 220 live records carries a non-zero one, so mapping the old rule onto it
  // would refuse 100% of real expenses and leave this use case exactly as dead as
  // the `lines` bug did.
  //
  // The control is preserved BY CONSTRUCTION instead of by a flag. The approve
  // write's body is a `oneOf` over `{status:"approved"}` and
  // `{status:"declined", reason}` — there is no VAT-recovery field on the
  // record or in the write, so this automation structurally CANNOT assert VAT
  // recovery. That is the same move UC-08 makes by not accepting a
  // write-capable client: removing the precondition beats catching the mistake.
  // What remains genuinely checkable about tax is its arithmetic containment,
  // which gate 10a does. `test/uc02.test.js` test 14 pins the write body.
  return { decision: "auto_approve", reason: "all_gates_passed", flags: [] };
}

/** The `code` off a real CurrencyDefinition object, or null. */
function currencyCode(currency) {
  if (!currency || typeof currency !== "object") return null;
  return typeof currency.code === "string" && currency.code ? currency.code : null;
}

/**
 * Receipt rows that are actually evidence.
 *
 * The `File` schema marks `id`, `name`, `type` and `inserted_at` required. A
 * row missing any of them is a placeholder — the array is non-empty but there
 * is nothing a reviewer could open — so a bare `receipts.length > 0` check
 * would be exactly the kind of gate that looks like protection and isn't.
 */
export function usableReceipts(expense) {
  const rows = Array.isArray(expense?.receipts) ? expense.receipts : [];
  return rows.filter(
    (row) =>
      row &&
      typeof row === "object" &&
      typeof row.id === "string" &&
      row.id !== "" &&
      typeof row.name === "string" &&
      row.name !== "" &&
      typeof row.type === "string" &&
      row.type !== "" &&
      typeof row.inserted_at === "string" &&
      row.inserted_at !== ""
  );
}

/**
 * Is `value` a well-formed ISO `YYYY-MM-DD` date that is not in the future?
 *
 * String comparison on a zero-padded ISO date is exactly chronological, so no
 * Date parsing (and no timezone) is involved — `new Date("2026-07-01")` would
 * introduce a UTC-midnight boundary that makes the verdict depend on the
 * reviewer's timezone.
 */
export function isPastDate(value, now = new Date()) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  return value <= now.toISOString().slice(0, 10);
}


/**
 * THE WHOLE LADDER, with each rung's standing in one particular run.
 *
 * WHY THIS EXISTS. `describeDecidingGate()` answers "which gate decided this",
 * which is the right answer to the wrong question for someone seeing the system
 * for the first time. A tester read "Decided by gate 15 — All gates" and asked,
 * reasonably, what gates 1 to 14 were: the number was presented as if the
 * sequence were common knowledge, and nothing anywhere named it. A position in
 * an order nobody can see is not an explanation, it is a citation to a missing
 * document.
 *
 * So this returns the order itself, and marks each rung with what happened to
 * it in this run. Because the gates run in order and the FIRST FAILURE WINS,
 * that marking is fully determined by the deciding position — every rung above
 * it necessarily passed, and every rung below it was never evaluated at all.
 * That last part is the one people get wrong, and it is why "not reached" is a
 * distinct word here and not folded into "passed": a gate that never ran has
 * said nothing about this expense in either direction.
 *
 * POSITIONS ARE COLLAPSED, REASONS ARE NOT. Three different reasons sit at
 * position 12 (no cap found, cap in the wrong currency, over the cap) because
 * they are three ways one gate can refuse. The ladder shows one rung per
 * position and lists the refusals it can produce, so the count a reader sees
 * matches the numbers printed beside a decision.
 *
 * PURE, AND IT DECIDES NOTHING — like describeDecidingGate(), it describes a
 * decision already made. No gate reads it.
 *
 * @param {string} reason  the `reason` an evaluate() result carried
 * @returns {{position:number, gate:string, checks:string, refusals:string[],
 *            status:"passed"|"decided"|"not_reached"|"unknown"}[]}
 */
export function describeGateLadder(reason) {
  const decided = describeDecidingGate(reason);

  const byPosition = new Map();
  for (const entry of GATE_SEQUENCE) {
    const rung = byPosition.get(entry.position);
    if (rung) {
      rung.refusals.push(entry.reason);
      continue;
    }
    byPosition.set(entry.position, {
      position: entry.position,
      gate: entry.gate,
      checks: entry.checks,
      refusals: [entry.reason],
    });
  }

  return [...byPosition.values()]
    .sort((a, b) => a.position - b.position)
    .map((rung) => ({
      ...rung,
      // An unrecognised reason cannot place the run on the ladder, so every
      // rung reads "unknown" rather than a confident ordering built on a guess.
      status:
        decided.position === null
          ? "unknown"
          : rung.position < decided.position
            ? "passed"
            : rung.position === decided.position
              ? "decided"
              : "not_reached",
    }));
}

/**
 * The cap comparison, in the figures a person needs to act on it.
 *
 * WHY THIS EXISTS. A tester read a Zendesk note saying their expense was
 * "above the policy cap" and asked, entirely reasonably: above it by how much?
 * Gate 12 held every one of those numbers at the instant it refused — the
 * converted amount, the category's cap, both in the same currency — and
 * reported only the verdict. A Finance Ops specialist was then being asked to
 * authorise an amount the ticket never named. Same defect shape as "decided by
 * gate 15" citing an order nobody could see (docs/GATES.md): the system knew,
 * and did not say.
 *
 * PURE, AND IT DECIDES NOTHING. Like describeDecidingGate()/describeGateLadder()
 * above, this describes a decision already made. No gate reads it.
 *
 * THE MONEY RULES, none of which are negotiable:
 *  - Every figure goes out through `formatMoney()` (src/shared/money.js). These
 *    are ×100 integers; rendering one raw is a 100× error in front of somebody
 *    authorising a payment.
 *  - The currency is NAMED, and it is `POLICY_CAP_CURRENCY` rather than the
 *    expense's original currency, because the figure gate 12 compared is
 *    `converted_amount` — the amount in the company's billing currency. Naming
 *    the original currency beside the converted figure would be labelling a
 *    number with units it is not in.
 *  - The percentage is DERIVED, so it is guarded. A zero cap makes the ratio
 *    undefined, not "0%" and not `Infinity`; the caller gets `percentOver:
 *    null` and a sentence that says the overage in money only. Fabricating a
 *    percentage here would be the same class of manufactured value as the
 *    manufactured zero this repo has already paid for twice.
 *
 * ONLY `over_policy_cap` GETS ARITHMETIC. `policy_cap_unknown` means no cap was
 * found, so there is nothing to be over — it says that instead.
 * `policy_cap_currency_mismatch` names the two currencies, because a percentage
 * across two currencies would be meaningless (it is the very comparison gate 12
 * refuses to make).
 *
 * @param {object} args
 * @param {string} args.reason              the reason evaluate() returned
 * @param {object|null} args.expense        the Remote expense record
 * @param {number|null} args.policyCap      the category's cap, integer ×100
 * @param {string|null} [args.categoryId]   the classified category's code
 * @returns {{reason:string, amount:string|null, cap:string|null,
 *            overage:string|null, percentOver:number|null, currency:string|null,
 *            expenseCurrency:string|null, categoryId:string|null,
 *            sentence:string}|null}  null when the decision was not a cap one
 */
export function describeCapComparison({ reason, expense, policyCap, categoryId = null }) {
  if (!CAP_REASONS.has(reason)) return null;

  const category = categoryId ?? null;
  const forCategory = category ? ` for ${category}` : "";
  const expenseCurrency = expense?.converted_currency?.code ?? expense?.currency?.code ?? null;

  const base = {
    reason,
    amount: null,
    cap: null,
    overage: null,
    percentOver: null,
    currency: null,
    expenseCurrency,
    categoryId: category,
    sentence: "",
  };

  if (reason === "policy_cap_unknown") {
    return {
      ...base,
      // No cap was found, so there is no arithmetic to show and none is shown.
      sentence: `No spend cap is on record${forCategory}, so the amount was not compared against anything. A person decides rather than approving an amount nothing checked.`,
    };
  }

  if (reason === "policy_cap_currency_mismatch") {
    return {
      ...base,
      currency: POLICY_CAP_CURRENCY,
      sentence:
        `The cap${forCategory} is set in ${POLICY_CAP_CURRENCY}` +
        (expenseCurrency ? `, and this expense converts to ${expenseCurrency}` : ", and this expense converts to another currency") +
        `. Two amounts in different currencies cannot be compared, so the cap was not enforced and a person decides.`,
    };
  }

  // over_policy_cap. Both figures are integers ×100 in POLICY_CAP_CURRENCY —
  // gate 12 only reaches this line once it has established that.
  const amount = expense?.converted_amount;
  const cap = policyCap;
  if (!isMoneyScaledInteger(amount) || !isMoneyScaledInteger(cap)) {
    // Reachable only if a caller hands in a reason and a record that never went
    // together. Say so rather than printing arithmetic on a number nobody
    // vouched for.
    return {
      ...base,
      currency: POLICY_CAP_CURRENCY,
      sentence: `The expense is above the spend cap${forCategory}, but the figures behind that comparison are not both valid amounts, so they are not shown.`,
    };
  }

  const overage = amount - cap;
  // Guarded: a zero cap makes the ratio undefined. null, never Infinity, NaN
  // or a fabricated 0.
  const percentOver = cap > 0 ? Math.round((overage / cap) * 1000) / 10 : null;

  return {
    reason,
    amount: formatMoney(amount, POLICY_CAP_CURRENCY),
    cap: formatMoney(cap, POLICY_CAP_CURRENCY),
    overage: formatMoney(overage, POLICY_CAP_CURRENCY),
    percentOver,
    currency: POLICY_CAP_CURRENCY,
    expenseCurrency,
    categoryId: category,
    sentence:
      `${formatMoney(amount, POLICY_CAP_CURRENCY)} claimed against a ${formatMoney(cap, POLICY_CAP_CURRENCY)} cap${forCategory}` +
      ` — over by ${formatMoney(overage, POLICY_CAP_CURRENCY)}` +
      (percentOver === null ? " (the cap is zero, so a percentage is undefined)." : ` (${percentOver}% over).`),
  };
}

// ---------------------------------------------------------------------------
// THE EVIDENCE A DECISION WAS MADE FROM, AND WHAT IT MEANS TO A PERSON
// ---------------------------------------------------------------------------
// `describeCapComparison()` above closed C-27 for ONE reason — the cap — on ONE
// surface: the synchronous response to a submission, and the Zendesk note built
// from it. Every other reason UC-02 can refuse for still arrived as a slug and a
// `means` sentence, and the Finance Ops specialist who opens the sidebar the
// next morning got neither, for ANY reason, because the surface they read is
// built from the STORED ROW and the stored row held none of the figures.
//
// So two functions, deliberately split:
//
//   captureEvidence()      the raw figures the gates compared — numbers, ids,
//                          codes, counts. No prose. This is what gets persisted.
//   describeDecisionFacts()  the prose, derived from that evidence at read time.
//
// WHY THE SPLIT, AND WHY THE SENTENCES ARE NOT WHAT IS STORED. `describeCapComparison`'s
// own header states the rule this follows: the figures travel, the sentence is
// derived. A stored sentence is frozen at the wording of the day it was written,
// so improving an explanation would leave every historical row saying the old
// thing — and `audit_log` already exists for "what the system said at the time".
// Storing the numbers and re-deriving the words means a better explanation
// improves every decision ever made, and a decision can still be re-checked
// against the figures it was actually made from.
//
// EVERY FIGURE IS A REAL READING OR AN EXPLICIT UNKNOWN. `captureEvidence` is
// called with whatever the workflow actually had — a null expense, an empty
// category list, a failed upstream read — and records nulls as nulls. It never
// substitutes a zero. A `receiptCount: 0` from this function means "the record
// carried no receipts", and a `null` means "there was no record to count", which
// are opposite facts about an expense somebody is waiting to be paid for.
// ---------------------------------------------------------------------------

/**
 * The raw figures gate 0–14 compared, as one flat object.
 *
 * PERSISTED. `ExpenseStore` writes this to `uc02_expenses.decision_evidence`,
 * which is why it holds only JSON scalars and short arrays — no Date objects, no
 * class instances, nothing whose meaning depends on the process that made it.
 *
 * @param {object} args
 * @param {object|null} [args.expense]         the Remote expense record
 * @param {object|null} [args.employment]      the Remote employment record
 * @param {string|null} [args.employmentId]    the submitter's employment id
 * @param {object|null} [args.identity]        verifyRequester()'s output
 * @param {object|null} [args.classification]  classifyExpenseCategory()'s output
 * @param {Array<object>} [args.categoryList]  the employee's real category list
 * @param {number|null} [args.policyCap]       the category's cap, integer ×100
 * @param {object|null} [args.duplicate]       the PRIOR row this collided with
 * @param {Array<object>} [args.upstreamFailures]
 */
export function captureEvidence({
  expense = null,
  employment = null,
  employmentId = null,
  identity = null,
  classification = null,
  categoryList = [],
  policyCap = null,
  duplicate = null,
  upstreamFailures = [],
} = {}) {
  return {
    // The subject of the whole decision. Recorded on the bundle as well as on
    // the row, so a bundle handed to a renderer on its own is still self-describing.
    expenseId: expense?.id ?? null,
    // Identity, gate 1. `method` and `reason` together say WHICH signal was
    // missing — "no session at all" and "signed in as somebody else" are the
    // same refusal and opposite situations.
    identityMethod: identity?.method ?? null,
    identityReason: identity?.reason ?? null,
    submitterEmploymentId: employmentId ?? null,

    // Employment, gate 2.
    employmentStatus: employment?.status ?? null,

    // Ownership, gate 4. BOTH sides, because "this expense belongs to somebody
    // else" is unactionable without saying whose it is and whose the caller is.
    expenseOwnerEmploymentId: expense?.employment_id ?? null,

    // Expense state, gate 5, and the set it was tested against.
    expenseStatus: expense?.status ?? null,
    approvableStatuses: [...APPROVABLE_EXPENSE_STATUSES],

    // Duplicate receipt, gate 6 — THE POINTER TO THE ORIGINAL. A duplicate flag
    // with nothing identifying what it duplicates asks the reviewer to go and
    // find a row they have no key for.
    duplicateOf: duplicate
      ? {
          storeId: duplicate.id ?? null,
          expenseId: duplicate.expenseId ?? null,
          decision: duplicate.decision ?? null,
          decidedAt: duplicate.createdAt ?? null,
          externalRef: duplicate.externalRef ?? null,
        }
      : null,

    // Category, gate 7, and the classifier reading behind it.
    categoryId: classification?.categoryId ?? null,
    categorySource: classification?.source ?? null,
    confidence: typeof classification?.confidence === "number" ? classification.confidence : null,
    confidenceThreshold: CONFIDENCE_THRESHOLD,
    // Ids only, and only the FILEABLE ones — a reviewer re-filing a rejected
    // category needs the list of what they may re-file it as, not the whole
    // taxonomy including the parent headings nothing can be filed against.
    fileableCategoryIds: selectableCategories(categoryList).map((c) => c.code),

    // Receipt evidence, gate 8. BOTH counts, because they differ: a row that the
    // File schema would reject is present in the array and is not evidence, so
    // `2 attached / 0 usable` is a completely different conversation from `0
    // attached`.
    receiptCount: Array.isArray(expense?.receipts) ? expense.receipts.length : null,
    usableReceiptCount: expense ? usableReceipts(expense).length : null,

    // Money, gates 9–12. All four figures and both currency codes: the audit row
    // already records these for exactly this reason ("a bare number and no
    // currency cannot be re-checked"), and the reviewer surface needs them for
    // the same one.
    amount: expense?.amount ?? null,
    currency: expense?.currency?.code ?? null,
    convertedAmount: expense?.converted_amount ?? null,
    convertedCurrency: expense?.converted_currency?.code ?? null,
    taxAmount: expense?.tax_amount ?? null,
    convertedTaxAmount: expense?.converted_tax_amount ?? null,
    policyCap: policyCap ?? null,
    policyCapCurrency: POLICY_CAP_CURRENCY,

    // Expense date, gate 14.
    expenseDate: expense?.expense_date ?? null,

    // Gate 0, and the provenance of every refusal above that names a read.
    upstreamFailures: Array.isArray(upstreamFailures) ? upstreamFailures : [],
  };
}

/**
 * The figures behind THIS decision, in a person's words.
 *
 * PURE, AND IT DECIDES NOTHING. Like the three describers above it, this
 * describes a decision already made; `evaluate()` neither calls it nor can see
 * it.
 *
 * @param {object} args
 * @param {string} args.reason  the slug evaluate() returned
 * @param {object|null} [args.evidence]  captureEvidence()'s output, live or
 *   read back off the stored row. Null yields null — an absent bundle, never a
 *   bundle of invented blanks.
 * @returns {{reason:string, sentence:string,
 *            facts:import("../shared/decisionFacts.js").DecisionFact[]}|null}
 */
export function describeDecisionFacts({ reason, evidence = null }) {
  if (!evidence) return null;
  const e = evidence;
  const money = (v) => (isMoneyScaledInteger(v) ? formatMoney(v, e.currency ?? POLICY_CAP_CURRENCY) : null);
  const convertedMoney = (v) => (isMoneyScaledInteger(v) ? formatMoney(v, e.convertedCurrency ?? POLICY_CAP_CURRENCY) : null);
  const failure = (call) => e.upstreamFailures?.find((f) => f?.call === call) ?? null;

  switch (reason) {
    case "upstream_unavailable":
    case "upstream_record_not_found": {
      const f = e.upstreamFailures?.[0] ?? null;
      return decisionFacts(
        reason,
        f
          ? `The ${f.call} read answered ${f.status ?? "with a transport failure"} rather than with data, so this expense was not evaluated against anything.`
          : "A read this decision depended on did not answer, so the expense was not evaluated.",
        [
          fact("Which read failed", f?.call),
          fact("What it answered", f?.status),
          fact("Message", f?.message),
          fact(
            "What was NOT concluded",
            "anything about the expense",
            "this is a failure to LOOK, not a finding — re-run it once the read works rather than treating it as a refusal"
          ),
        ]
      );
    }

    case "identity_not_verified":
      return decisionFacts(
        reason,
        IDENTITY_SENTENCE[e.identityReason] ??
          "The identity check did not pass, and the signal it failed on was not recorded on this decision.",
        [
          fact("Identity signal used", e.identityMethod, "session = an authenticated login; none = no session was present"),
          fact("What was missing", e.identityReason),
          fact("Employment id the submitter claimed", e.submitterEmploymentId),
          failure("employment")
            ? fact("Employment read", `failed (${failure("employment").status})`, "so there was no record to check an identity against — this is a read problem before it is an identity one")
            : fact("Employment record status", e.employmentStatus),
        ]
      );

    case "employee_not_active":
      return decisionFacts(
        reason,
        `The employment is "${e.employmentStatus ?? "not recorded"}", so an expense cannot be reimbursed against it.`,
        [
          fact("Status on the record", e.employmentStatus),
          fact("Employment id", e.submitterEmploymentId),
        ]
      );

    case "expense_not_found": {
      const f = failure("expense");
      return decisionFacts(
        reason,
        f
          ? `Remote answered ${f.status} for this expense id, so there is no record to reimburse.`
          : "Remote holds no expense under this id.",
        [
          e.expenseId
            ? fact("Expense id looked up", e.expenseId)
            : unknownFact("Expense id looked up", "The lookup returned no record, so no id was read back off one. The id that was searched for is on the store row beside this bundle."),
          fact("What Remote answered", f?.status ?? "404"),
          fact("Message", f?.message),
        ]
      );
    }

    case "expense_employment_mismatch":
      // BOTH SIDES. "It belongs to someone else" without saying whose it is and
      // whose the caller is leaves the reviewer with a refusal they cannot check.
      return decisionFacts(
        reason,
        `The expense is filed against employment ${e.expenseOwnerEmploymentId ?? "(not recorded)"}, and the submitter is ${e.submitterEmploymentId ?? "(not recorded)"}.`,
        [
          fact("Expense belongs to", e.expenseOwnerEmploymentId),
          fact("Submitted by", e.submitterEmploymentId),
          fact(
            "What was NOT checked",
            "the amount, the category and the receipt",
            "ownership is gate 4 and the money questions start at gate 9 — nothing below gate 4 ran, so nothing below it approved of anything"
          ),
        ]
      );

    case "expense_not_pending":
      return decisionFacts(
        reason,
        `The expense is already "${e.expenseStatus ?? "not recorded"}". Deciding it again would either overturn a person's decision or pay it twice.`,
        [
          fact("Status now", e.expenseStatus),
          fact("Statuses this automation may act on", (e.approvableStatuses ?? []).join(", ")),
          fact("Amount on the record", money(e.amount), e.currency ? `in ${e.currency}, the currency it was filed in` : undefined),
        ]
      );

    case "duplicate_submission":
      // THE POINTER, which is the whole of what this refusal needs. A duplicate
      // flag naming nothing sends the reviewer to search for a row they have no
      // key for — and the alternative to finding it is paying twice.
      return decisionFacts(
        reason,
        e.duplicateOf?.expenseId
          ? `This receipt was already reimbursed on expense ${e.duplicateOf.expenseId}, decided ${e.duplicateOf.decidedAt ?? "at an unrecorded time"}.`
          : "This receipt matches one already processed, but the earlier record is not identified on this decision.",
        [
          fact("Already filed as expense", e.duplicateOf?.expenseId),
          fact("That decision was", e.duplicateOf?.decision),
          // A DATE A PERSON READS, and a reference a person can quote
          // (2026-08-31). This row printed a raw ISO instant and a full UUID on
          // a panel a customer sees — found by seeding UC-02's BLOCKED outcome
          // and rendering it, which no earlier check reached. The short form is
          // a PREFIX of the real id, so the pointer still does its job: it is
          // here so a reviewer can open the earlier record rather than search
          // for a row they have no key for, and a prefix search finds it.
          fact("Decided at", humanTime(e.duplicateOf?.decidedAt) ?? e.duplicateOf?.decidedAt),
          fact("Its store row", shortReference(e.duplicateOf?.storeId), "the reference to open in the audit viewer"),
          e.duplicateOf?.externalRef
            ? fact("Its ticket", e.duplicateOf.externalRef)
            : unknownFact("Its ticket", "The earlier submission carried no ticket reference — it was filed through a surface that does not create one, so open it by its store row above."),
          fact("This submission's expense id", e.expenseId),
          fact("Amount on THIS submission", money(e.amount), e.currency ? `in ${e.currency}` : undefined),
        ]
      );

    case "category_unverified":
      return decisionFacts(
        reason,
        `"${e.categoryId ?? "no category"}" is not a category this employee can file against, so the spend could not be checked against any policy cap.`,
        [
          fact("Category the classifier chose", e.categoryId),
          fact("Which reader chose it", e.categorySource, "llm = the model answered; rule_based_fallback = the rules answered because the model was unreachable or returned an invalid shape"),
          fact("Its confidence", e.confidence, "recorded for context — the confidence GATE is gate 13 and this run stopped at gate 7, so this figure decided nothing"),
          e.fileableCategoryIds?.length
            ? fact("What this employee CAN file against", e.fileableCategoryIds.join(", "))
            : unknownFact(
                "What this employee CAN file against",
                "The fileable list is empty on this record. That is not 'no categories exist' — check whether the category read succeeded before re-filing."
              ),
        ]
      );

    case "missing_receipt_evidence":
      // TWO COUNTS, because they differ and the difference is the whole finding.
      return decisionFacts(
        reason,
        e.receiptCount === 0
          ? "No receipt is attached, so there is nothing evidencing what was spent."
          : `${e.receiptCount ?? "an unrecorded number of"} receipt row(s) are attached and none of them is usable evidence — each is missing a field the file schema requires, so there is nothing a reviewer could open.`,
        [
          fact("Receipt rows attached", e.receiptCount),
          fact("Of those, usable as evidence", e.usableReceiptCount, "a row missing id, name, type or upload time is a placeholder, not an artifact"),
          fact("Amount claimed", money(e.amount), e.currency ? `in ${e.currency}` : undefined),
        ]
      );

    case "invalid_amount":
      // NAME THE FIELD. "One of the money fields is not a whole number of minor
      // units" is true of four different fields and actionable about none.
      return decisionFacts(
        reason,
        `${invalidMoneyFields(e).join(", ") || "A money field"} did not pass the ×100-integer check, so no arithmetic was done on this expense.`,
        [
          fact("Fields that failed", invalidMoneyFields(e).join(", ")),
          fact("amount", rawMoney(e.amount)),
          fact("converted_amount", rawMoney(e.convertedAmount)),
          fact("tax_amount", rawMoney(e.taxAmount)),
          fact("converted_tax_amount", rawMoney(e.convertedTaxAmount)),
          fact(
            "What a valid figure looks like",
            "a positive whole number of minor units (500.00 is 50000)",
            "tax may be zero; the two amounts may not"
          ),
        ]
      );

    case "tax_exceeds_amount":
      return decisionFacts(
        reason,
        `The tax portion (${money(e.taxAmount) ?? "not recorded"}) is larger than the expense it is part of (${money(e.amount) ?? "not recorded"}).`,
        [
          fact("Tax", money(e.taxAmount)),
          fact("Expense amount", money(e.amount)),
          fact("Tax, converted", convertedMoney(e.convertedTaxAmount)),
          fact("Amount, converted", convertedMoney(e.convertedAmount)),
          fact("Currency filed in", e.currency),
          fact("Currency converted to", e.convertedCurrency),
        ]
      );

    case "currency_conversion_unverified":
      // NAME BOTH CURRENCIES. The refusal is entirely about a pair, and the pair
      // was never printed.
      return decisionFacts(
        reason,
        `Filed in ${e.currency ?? "an unrecorded currency"} and converted to ${e.convertedCurrency ?? "an unrecorded currency"}. The record carries no rate, so the converted figure cannot be re-derived and a person decides rather than approving a number nothing checked.`,
        [
          fact("Filed in", e.currency),
          fact("Converted to", e.convertedCurrency),
          fact("Amount as filed", money(e.amount)),
          fact("Amount as converted", convertedMoney(e.convertedAmount)),
          unknownFact(
            "The rate used",
            "Not on the Remote expense record. This is a property of the record, not a gap in this run — the two amounts and the two currencies above are everything there is to check the conversion against."
          ),
        ]
      );

    case "conversion_identity_mismatch":
      return decisionFacts(
        reason,
        `The expense says it was not converted — both sides are ${e.currency ?? "the same currency"} — yet its original and converted figures differ.`,
        [
          fact("Currency, both sides", e.currency),
          fact("Amount as filed", money(e.amount)),
          fact("Amount as converted", convertedMoney(e.convertedAmount)),
          fact("Tax as filed", money(e.taxAmount)),
          fact("Tax as converted", convertedMoney(e.convertedTaxAmount)),
        ]
      );

    case "policy_cap_unknown":
    case "policy_cap_currency_mismatch":
    case "over_policy_cap": {
      // ONE COPY OF THE CAP ARITHMETIC. `describeCapComparison()` already holds
      // it, is already tested, and is what the submission response and the
      // Zendesk note use — so this reconstructs the shape it expects out of the
      // stored evidence rather than growing a second implementation that would
      // be free to round differently.
      const cap = describeCapComparison({
        reason,
        expense: {
          converted_amount: e.convertedAmount,
          currency: e.currency ? { code: e.currency } : null,
          converted_currency: e.convertedCurrency ? { code: e.convertedCurrency } : null,
        },
        policyCap: e.policyCap,
        categoryId: e.categoryId,
      });
      return decisionFacts(reason, cap?.sentence ?? "", [
        fact("Claimed", cap?.amount),
        fact("Cap", cap?.cap),
        fact("Over by", cap?.overage),
        fact("Percent over", cap?.percentOver === null || cap?.percentOver === undefined ? null : `${cap.percentOver}%`, cap?.percentOver === null ? "the cap is zero, so a percentage is undefined — it is not 0%" : undefined),
        fact("Category", e.categoryId),
        fact("Cap currency", cap?.currency),
        fact("Expense converts to", cap?.expenseCurrency),
      ]);
    }

    case "low_confidence":
      // THE VALUE AND THE THRESHOLD. "Not confident enough" is a comparison, and
      // one side of a comparison is none of it.
      return decisionFacts(
        reason,
        `The classifier reported ${e.confidence ?? "no figure"} against a ${e.confidenceThreshold ?? CONFIDENCE_THRESHOLD} threshold, so a person confirms the category.`,
        [
          fact("Confidence reported", e.confidence),
          fact("Threshold", e.confidenceThreshold ?? CONFIDENCE_THRESHOLD),
          fact("Category it chose", e.categoryId),
          fact("Which reader chose it", e.categorySource),
          fact(
            "What this does NOT say",
            "that the amount is wrong",
            "gate 13 reads the classifier's certainty about the CATEGORY only — every money question above it passed"
          ),
        ]
      );

    case "expense_date_invalid":
      return decisionFacts(
        reason,
        `The expense date is "${e.expenseDate ?? "not recorded"}", which is not a past ISO date — money not yet spent is not reimbursed automatically.`,
        [
          fact("Date on the record", e.expenseDate),
          fact("What is required", "an ISO YYYY-MM-DD date on or before today"),
          fact("Amount", money(e.amount), e.currency ? `in ${e.currency}` : undefined),
        ]
      );

    default:
      // all_gates_passed. Nothing was refused, so there are no figures behind a
      // refusal; `means` already says what happened.
      return null;
  }
}

/** Which of the four money fields actually failed gate 9, by name. */
function invalidMoneyFields(e) {
  const bad = [];
  if (!isMoneyScaledInteger(e.amount) || e.amount <= 0) bad.push("amount");
  if (!isMoneyScaledInteger(e.convertedAmount) || e.convertedAmount <= 0) bad.push("converted_amount");
  if (!isMoneyScaledInteger(e.taxAmount) || e.taxAmount < 0) bad.push("tax_amount");
  if (!isMoneyScaledInteger(e.convertedTaxAmount) || e.convertedTaxAmount < 0) bad.push("converted_tax_amount");
  return bad;
}

/**
 * A money field printed AS STORED, unformatted, for the one gate that is about
 * the storage itself.
 *
 * `formatMoney()` is right everywhere else and wrong here: gate 9 refuses
 * because the value is not a ×100 integer, so dividing it by 100 and printing it
 * as currency would present the malformed value as a clean amount and hide the
 * exact thing the reviewer has to see. `null` and `true` are printed as `null`
 * and `true`, which is what is wrong with them.
 */
function rawMoney(v) {
  if (v === null || v === undefined) return "null";
  return String(v);
}

/** What each identity failure actually is, in the reviewer's terms. */
const IDENTITY_SENTENCE = Object.freeze({
  no_employment_record:
    "Remote returned no employment record for the id on this submission, so there was nothing to verify the submitter against. This is a record problem before it is an identity one.",
  session_employment_mismatch:
    "The submitter is signed in, but as a DIFFERENT employee from the one this expense is filed against. That is an access attempt on somebody else's record, not a verification gap.",
  unauthenticated_requires_stepup:
    "The submission arrived with no authenticated session at all, so the submitter's identity rests on a claim. Nothing about the expense was disclosed or decided.",
});

/**
 * Which recorded fields the receipt disagrees with. Observations only — this
 * returns field NAMES, never amounts, so no caller can accidentally treat the
 * model's number as a value to use.
 *
 * WHAT IS COMPARED, AND WHAT DELIBERATELY IS NOT:
 *
 * - `currency` and `total` are compared when the receipt shows both. Money is
 *   compared as integer minor units on both sides — the same ×100 discipline as
 *   everywhere else — so no float ever enters the comparison.
 * - `date` is compared only when the record carries `expense_date`.
 * - VENDOR IS NOT COMPARED, though §6 lists it. The expense record has no
 *   merchant field: its nearest counterpart is `title`, which is a human's
 *   description of the purpose ("Team lunch") and not the vendor's trading name
 *   ("Cafe Central"). Comparing those two would flag almost every honest claim,
 *   and a gate that fires on everything teaches its reader to ignore it. When a
 *   merchant field exists on the record this is the place to add it.
 *
 * A null on either side is not a disagreement. An unreadable FIELD is not a
 * contradicted one, and saying otherwise would refuse a claim for the crime of
 * having a smudged date.
 */
/**
 * One sentence a reviewer can read, putting the receipt's figures BESIDE
 * Remote's rather than merged into them.
 *
 * WHY THIS EXISTS. Gate 8b's own header states the intent — the model's
 * numbers "reach a human as a second reading beside Remote's, never merged
 * into one corrected figure" — and until now nothing delivered them anywhere.
 * The reading was computed, compared, and discarded. On the Zendesk path the
 * only trace of it was inside the n8n execution: the internal note said
 * `decision: human_review (policy_cap_unknown)` and never mentioned that a
 * receipt had been read at all, so the reviewer it was compiled for could not
 * see it, and neither could anyone watching a demonstration.
 *
 * THREE THINGS IT DELIBERATELY DOES.
 *
 * 1. BOTH FIGURES, ALWAYS, SIDE BY SIDE — even when they agree. A note that
 *    printed only the receipt's total would be the merged figure the gate
 *    forbids, one indirection away: a reader would take it as "the amount".
 *    Printing both makes it unmistakable which number came from where, and
 *    lets a reviewer catch a case the gate cannot (both readings wrong in the
 *    same direction).
 * 2. IT NAMES WHAT DISAGREED, using the gate's own contradiction codes rather
 *    than re-deriving the comparison. A second implementation of "do these
 *    agree?" would eventually disagree with the gate, and the note would then
 *    contradict the decision it is explaining.
 * 3. IT DECIDES NOTHING. Pure, called after evaluate(), consulted by no gate.
 *
 * `notAttempted` is kept distinct from `unreadable` because those are
 * different facts about the world and the same word for both is what
 * RECEIPT_NOT_ATTEMPTED_REASONS exists to prevent: nobody tried, versus tried
 * and failed.
 *
 * @returns {string|null} null when there is nothing to say, so a caller can
 *   append it unconditionally without producing a dangling sentence.
 */
export function describeReceiptReading(expense, receiptReading) {
  if (!receiptReading) return null;

  const money = (minor, currency) =>
    Number.isInteger(minor) ? `${(minor / 100).toFixed(2)} ${currency ?? ""}`.trim() : "an unreadable amount";
  const claimCurrency = expense?.currency?.code ?? expense?.currency ?? null;

  if (!receiptReading.extracted) {
    return RECEIPT_NOT_ATTEMPTED_REASONS.includes(receiptReading.reason)
      ? `Receipt: not read (${receiptReading.reason}) — nothing was checked against the claim, and nothing was assumed either.`
      : `Receipt: attached but could NOT be read (${receiptReading.reason}). An unreadable receipt is an unchecked one.`;
  }

  const e = receiptReading.extracted;
  const disagreements = receiptContradictions(expense, e);
  const parts = [
    `Receipt reads: ${e.merchant ?? "unnamed merchant"}, ${money(e.total, e.currency)}, dated ${e.date ?? "no legible date"}.`,
    `Claim records: ${money(expense?.amount, claimCurrency)}, dated ${expense?.expense_date ?? "no date"}.`,
  ];
  parts.push(
    disagreements.length
      ? `These DISAGREE (${disagreements.join(", ")}) — both readings are shown above; neither has been corrected by the other.`
      : "These agree on currency, total and date. Merchant is not compared: the expense record has no merchant field."
  );
  return parts.join(" ");
}

export function receiptContradictions(expense, extracted) {
  const out = [];
  if (!expense || !extracted) return out;

  const claimedCurrency = expense?.currency?.code ?? expense?.currency ?? null;
  if (extracted.currency && claimedCurrency && String(extracted.currency).toUpperCase() !== String(claimedCurrency).toUpperCase()) {
    out.push("receipt_currency_differs");
  }

  const claimedTotal = Number.isInteger(expense?.amount) ? expense.amount : null;
  if (Number.isInteger(extracted.total) && claimedTotal !== null && extracted.total !== claimedTotal) {
    out.push("receipt_total_differs");
  }

  const claimedDate = typeof expense?.expense_date === "string" ? expense.expense_date.slice(0, 10) : null;
  if (extracted.date && claimedDate && extracted.date !== claimedDate) {
    out.push("receipt_date_differs");
  }

  return out;
}
