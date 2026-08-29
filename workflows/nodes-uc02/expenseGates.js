// ---------------------------------------------------------------------------
// expenseGates.js — body of the "Expense Gates" n8n Code node
// ---------------------------------------------------------------------------
// UC-02's deterministic core in n8n: identity -> employment -> expense ->
// ownership -> duplicate -> category -> itemization -> math -> currency ->
// policy cap -> confidence -> VAT, in ONE node so the decision logic stays in
// one place, exactly as src/uc02/policyEngine.js does. It also ports
// policyCaps.js (getPolicyCap + the integer ×100 spend-cap corpus) and
// expenseClassifier.js's classifyExpenseRuleBased() verbatim.
//
// test/n8nUc02Parity.test.js executes THIS FILE and asserts it reaches the
// same decision as policyEngine.evaluate() for every §12 scenario, same
// discipline as UC-01's gates.js and UC-06's amendmentGates.js — see
// workflows/README.md's "Why Code node bodies live in nodes/*.js" for the bug
// class this guards against (a template-literal escape collapsing silently).
//
// THE LLM SEAM — which pattern applies, and why:
// The classification output IS decision-relevant (gate 6 reads categoryValid,
// gate 11 reads confidence), so unlike UC-06's draftSummary (display prose,
// pattern b) this node DOES consume the "Classify Expense (LLM)" node's
// output. But it consumes it exactly the way the real classifyExpense() does:
// validated against a strict shape (isValidClassification, ported below)
// before being trusted for anything — malformed JSON, an invented category
// id, or an out-of-range confidence all fall back to the rule-based
// classifier. That is pattern (a): a validated LLM result and the rule-based
// fallback are EQUALLY valid decision inputs, and a confident classification
// can never override a failed deterministic check (prime directive #1 — the
// over-cap-with-confidence scenario in the parity test pins this). The LLM
// node's output is never a live LLM call from inside this body: no imports,
// no network.
//
// MONEY: every cap and every total comparison stays in Remote's integer ×100
// domain, ported verbatim — 50000 means $500.00. Never re-derived or
// reformatted.
//
// THE WRITE: this node only COMPUTES the decision and the write payload
// ({status:"approved"} on auto_approve). The actual PATCH /v1/expenses/:id
// is a separate HTTP Request node in the n8n graph, reached ONLY on the
// auto_approve branch — building that node is a separate step, done by
// someone with n8n access.
//
// IDENTITY: expense submissions originate in the Remote product (UC-02.md §2),
// so the webhook payload carries the authenticated session, and the
// self-session rule of src/shared/identity.js's verifyRequester() applies
// directly. No session, or one that doesn't match the employment, fails
// closed to escalate — same "identity from a signal, never a claim" rule as
// UC-01/UC-06. DUPLICATE: the check is now ALWAYS on, on this path too. It
// used to fire only when the submission carried a `receiptHash`, and the
// lookup it consulted was a placeholder returning `{duplicate: null}` — two
// dead layers stacked, so the gate could not refuse a duplicate under any
// input. Closing it was the GRAPH change this header used to describe as
// future work: "Derive Receipt Fingerprint" computes the F-24 server-side
// fingerprint from the expense record, "Fetch Receipt Matches (Supabase)"
// reads `uc02_expenses` for either key, and "Check Duplicate Receipt
// (Supabase)" applies src/uc02/workflow.js's submitted-then-derived
// precedence. A submitter who omits the hash can no longer opt out of the
// check. See docs/BUILD-LOG.md §3.39.
//
// Runs inside n8n's sandbox: no imports, no network. `$()` is provided by
// n8n (and mocked by the parity test). All upstream data is read by named
// node lookups, so the body never depends on graph ordering or fan-in shape.
// ---------------------------------------------------------------------------

const request = $('Normalize Expense Submission').first().json;

// --- shared/upstreamFailure.js, ported verbatim (a Code node cannot import) --
// The three Remote nodes above carry `onError: continueRegularOutput`, which
// reports `executionStatus: "success"` and hands THIS node an error object in
// place of the record. Without the detector below, all three of execution
// 4218's failures (404 employment, 404 expense, 403 categories) collapsed into
// `null` and the gates recorded `identity_not_verified` — a policy refusal that
// never happened. See src/shared/upstreamFailure.js for the full reasoning;
// test/n8nUc02Parity.test.js proves this copy agrees with it.
const UPSTREAM_NOT_FOUND = 'not_found';
const UPSTREAM_UNREACHABLE = 'unreachable';
const REASON_UPSTREAM_NOT_FOUND = 'upstream_record_not_found';
const REASON_UPSTREAM_UNAVAILABLE = 'upstream_unavailable';

function describeUpstreamError(raw, call) {
  if (!raw || typeof raw !== 'object') return null;
  if (!('error' in raw)) return null;
  if ('data' in raw) return null;
  const err = raw.error;
  if (typeof err === 'string') {
    return { call, status: null, kind: UPSTREAM_UNREACHABLE, message: err.slice(0, 200) };
  }
  if (!err || typeof err !== 'object') return null;
  const numeric = Number(err.status ?? err.httpCode ?? err.statusCode);
  const status = Number.isInteger(numeric) ? numeric : null;
  const message =
    typeof err.message === 'string' ? err.message.slice(0, 200) : String(err.name ?? 'upstream call failed');
  return { call, kind: status === 404 ? UPSTREAM_NOT_FOUND : UPSTREAM_UNREACHABLE, status, message };
}

function findUpstreamFailure(failures, call) {
  if (!Array.isArray(failures)) return null;
  for (const failure of failures) {
    if (failure && failure.call === call) return failure;
  }
  return null;
}

function upstreamVerdict(failure) {
  if (!failure) return null;
  const reason = failure.kind === UPSTREAM_NOT_FOUND ? REASON_UPSTREAM_NOT_FOUND : REASON_UPSTREAM_UNAVAILABLE;
  return {
    decision: 'escalate',
    reason,
    flags: [reason, 'upstream_' + failure.call + '_' + (failure.status === null ? 'error' : failure.status)],
  };
}

const empRaw = $('Fetch Employment (Remote)').first().json;
const expenseRaw = $('Fetch Expense (Remote)').first().json;
const categoriesRaw = $('Fetch Expense Categories (Remote)').first().json;

// Built in gate order, so the first entry is the earliest-failing read.
const upstreamFailures = [
  describeUpstreamError(empRaw, 'employment'),
  describeUpstreamError(expenseRaw, 'expense'),
  describeUpstreamError(categoriesRaw, 'expense_categories'),
].filter(Boolean);

const employment =
  (empRaw && empRaw.data && empRaw.data.employment) ||
  (empRaw && empRaw.data) ||
  (empRaw && empRaw.employment) ||
  null;

const expense =
  (expenseRaw && expenseRaw.data && expenseRaw.data.expense) ||
  (expenseRaw && expenseRaw.data) ||
  (expenseRaw && expenseRaw.expense) ||
  null;

// The REAL envelope of GET /v1/expenses/categories is `{data: [...]}` — a flat
// array. `data.categories` is NOT a second supported shape: it is what this
// repo's mock used to invent, kept here only so a stale fixture or proxy fails
// loudly against parity instead of silently yielding an empty list. See
// src/uc02/expenseCategories.js for the row shape and why `code` is the key.
const categoryList = Array.isArray(categoriesRaw?.data)
  ? categoriesRaw.data
  : Array.isArray(categoriesRaw)
    ? categoriesRaw
    : (categoriesRaw?.data?.categories ?? categoriesRaw?.categories ?? []);

// THE DEDUPE VERDICT, AND THE GUARD THAT USED TO SIT HERE.
//
// This line read:
//   const duplicate = request.receiptHash ? (dupRaw ? dupRaw.duplicate : null) : null;
//
// — a SECOND dead layer beneath the placeholder lookup node. Even once the
// lookup was real, that guard discarded its answer whenever the submitter had
// not supplied a hash, and the Zendesk intake path sets `receiptHash: null`
// unconditionally (a ticket carries no receipt-image hash). So on the real
// inbound channel the gate was doubly incapable of firing: nothing looked, and
// nothing would have been believed if it had.
//
// It is gone because the upstream node now ALWAYS has a key to look up — the
// fingerprint derived server-side from the expense record (finding F-24) —
// so "the submitter supplied no hash" no longer means "no dedupe was
// possible". src/uc02/workflow.js made exactly this change first; this is
// parity with it, not a new policy.
const dupRaw = $('Check Duplicate Receipt (Supabase)').first().json;
const duplicate = dupRaw ? dupRaw.duplicate ?? null : null;
const derivedReceiptHash = dupRaw ? dupRaw.derivedReceiptHash ?? null : null;
const duplicateMatchedOn = dupRaw ? dupRaw.duplicateMatchedOn ?? null : null;
// The value the persist node writes into the single `receipt_hash` column, and
// the value the NEXT expense will look this one up by. Derived-preferred, the
// same expression as src/uc02/expenseStore.js's dedupeKey(); computed upstream
// so the key an expense is stored under and the keys it is found by can never
// drift apart.
const dedupeKey = dupRaw ? dupRaw.dedupeKey ?? null : null;

// --- identity: an authenticated signal, never a claim -----------------------
// src/shared/identity.js verifyRequester()'s self-session path, verbatim, PLUS
// the Zendesk channel's own authenticated signal. A Zendesk ticket carries no
// Remote session, so — exactly as UC-01's workflows/nodes/gates.js does — the
// next-best authenticated signal is the requester Zendesk itself authenticated,
// matched against the email on the authoritative Remote record. The normalizer
// only ever reads that from ticket.requester.email, NEVER from an address typed
// into the ticket body. Fails closed: a missing email on either side is
// unverified. This branch is unreachable unless authenticatedEmail is present,
// so the session path (and every parity fixture) is unchanged.
const session = request.session;
const employmentEmail = employment
  ? employment.basic_information?.email ??
    employment.basic_information?.personal_email ??
    employment.email ??
    employment.personal_email ??
    null
  : null;
const identityVerified =
  Boolean(
    session && session.authenticatedEmploymentId && employment && session.authenticatedEmploymentId === employment.id
  ) ||
  Boolean(
    session &&
      session.authenticatedEmail &&
      employmentEmail &&
      session.authenticatedEmail === String(employmentEmail).toLowerCase()
  );
const employmentActive = Boolean(employment && employment.status === 'active');
const expenseOwned = Boolean(expense && expense.employment_id === request.employmentId);

// --- policyCaps.js: getPolicyCap() — the integer ×100 cap corpus ------------
// Keyed by the REAL API's category `code`, read from the live sandbox — not by
// the `cat_*` ids that only ever existed in this repo's mock. An unknown key
// fails closed to a human review (F-12), so the many live categories with no
// cap here escalate rather than approve unbounded.
const POLICY_CAPS = {
  'work_meals_and_entertainment.internal_meals_and_entertainment': 50000, // $500.00
  'work_meals_and_entertainment.external_meals_and_entertainment': 30000, // $300.00
  'business_travel.accommodation': 100000, // $1,000.00
  'business_travel.travel_long_distance': 100000, // $1,000.00
  'business_travel.local_transportation': 20000, // $200.00
  'home_office_and_co_working.co_working_part_time_or_daily': 25000, // $250.00
  'tech_and_work_equipment.software_and_subscriptions': 20000, // $200.00
  'company_and_office_expenses.office_supplies_and_shipping': 15000, // $150.00
};
// Map lookup, not POLICY_CAPS[categoryId]: an object literal inherits from
// Object.prototype, so a category id of "constructor"/"toString" returns an
// inherited FUNCTION that `?? null` happily passes on as a cap (finding F-12).
const POLICY_CAPS_BY_ID = new Map(Object.entries(POLICY_CAPS));
function getPolicyCap(categoryId) {
  if (typeof categoryId !== 'string' || !categoryId) return null;
  const cap = POLICY_CAPS_BY_ID.get(categoryId);
  return Number.isSafeInteger(cap) && cap >= 0 ? cap : null;
}

// --- expenseClassifier.js: rule-based fallback + strict LLM-shape validation
const CONFIDENCE_THRESHOLD = 0.85;

const LOW_CONF_SIGNALS = [
  /\b(blurr(?:y|ied)?|illegible|unreadable|faded|damaged|out[- ]of[- ]focus)\b/,
  /\bpoor (scan|image) quality\b/,
];

const NON_ENGLISH_SIGNALS = [
  /\bnon[- ]english\b/,
  /\bforeign language\b/,
  /\b(in german|in french|in spanish|in japanese|in chinese|in mandarin)\b/,
  /\b(german|french|spanish|japanese|chinese|mandarin) (receipt|invoice)\b/,
];

// --- src/uc02/expenseCategories.js, verbatim -------------------------------
// A real Remote category row is keyed by `code` and carries `status` +
// `is_selectable`; it has NO `id` field, which is why the old `c.id === …`
// comparison in this file was permanently false. Only an active, selectable
// leaf may be filed against — a parent node is a heading the platform itself
// would refuse, so approving into one would approve something impossible.
// Strict equality on both flags: an absent flag fails closed.
function isSelectableCategory(row) {
  if (!row || typeof row !== 'object') return false;
  if (typeof row.code !== 'string' || row.code === '') return false;
  return row.status === 'active' && row.is_selectable === true;
}

function selectableCategories(list) {
  return (Array.isArray(list) ? list : []).filter(isSelectableCategory);
}

function findSelectableCategory(list, code) {
  if (typeof code !== 'string' || code === '') return null;
  const byCode = new Map(selectableCategories(list).map((row) => [row.code, row]));
  return byCode.get(code) ?? null;
}

function isCategoryFileable(list, code) {
  return findSelectableCategory(list, code) !== null;
}

// Stopwords + a 4-char floor: real category descriptions are prose, and
// substring-matching an expense's tokens against prose makes "the" match "other".
// See src/uc02/expenseClassifier.js for the measured false positive this fixes.
const MATCH_MIN_TOKEN_LENGTH = 4;
const MATCH_STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'from', 'that', 'this', 'was', 'were', 'are', 'during', 'after',
  'other', 'any', 'all', 'its', 'our', 'your', 'when', 'have', 'has', 'had', 'not', 'but', 'per',
  'via', 'into', 'onto', 'over', 'out', 'off', 'one', 'two', 'add', 'list', 'also', 'such', 'than',
  'then', 'them', 'they', 'their', 'some', 'more', 'most', 'each', 'just', 'only', 'very', 'been',
  'being', 'will', 'would', 'can', 'could', 'should', 'about', 'under', 'above', 'between',
  'because', 'while', 'where', 'which', 'what', 'who', 'whom', 'whose',
]);

function matchTokens(text) {
  return [
    ...new Set(
      String(text ?? '')
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((token) => token.length >= MATCH_MIN_TOKEN_LENGTH && !MATCH_STOPWORDS.has(token))
    ),
  ];
}

function categoryHaystack(category) {
  return `${category?.code ?? ''} ${category?.title ?? ''} ${category?.description ?? ''}`.toLowerCase();
}

function classifyExpenseRuleBased({ expense, categoryList = [] }) {
  const list = selectableCategories(categoryList);
  // The REAL text fields: `title` (required) and `notes` (nullable). There is
  // no `description` on a Remote expense. The recorded category's TITLE joins
  // them as a hint — see the note on categoryId below.
  const text = [expense?.title, expense?.notes, expense?.expense_category?.title]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  const tokens = matchTokens(text);

  let best = null;
  let bestScore = 0;
  for (const category of list) {
    const haystack = categoryHaystack(category);
    const score = tokens.filter((token) => haystack.includes(token)).length;
    if (score > bestScore) {
      best = category;
      bestScore = score;
    }
  }

  // NO record-category lookup: the record's category namespace (deprecated flat
  // enum: `meals`, `tech_equipment`) is DISJOINT from the selectable list's
  // hierarchical codes, so it can never resolve — and mapping between them
  // would mean inventing a correspondence Remote does not publish. The recorded
  // category's TITLE is folded into the match text above instead.
  const categoryId = (bestScore > 0 ? best : null)?.code ?? null;

  let confidence = categoryId ? 0.9 : 0.6;
  if (NON_ENGLISH_SIGNALS.some((re) => re.test(text))) confidence = 0.5;
  if (LOW_CONF_SIGNALS.some((re) => re.test(text))) confidence = 0.4;

  const reason = categoryId
    ? "Rule-based token overlap between the expense's title (plus its recorded category name) and this category's own text."
    : "No category could be resolved from the expense's title or its recorded category name.";

  return { categoryId, reason, confidence, source: 'rule_based_fallback' };
}

function isValidClassification(obj, categoryList) {
  if (!obj || typeof obj !== 'object') return false;
  if (obj.categoryId !== null && !isCategoryFileable(categoryList, obj.categoryId)) return false;
  return (
    typeof obj.reason === 'string' &&
    typeof obj.confidence === 'number' &&
    obj.confidence >= 0 &&
    obj.confidence <= 1
  );
}

// The LLM node's response is the standard OpenAI chat shape; parse its JSON
// content, validate against the strict shape, else fall back to rules.
let classification;
try {
  const raw = $('Classify Expense (LLM)').first().json?.choices?.[0]?.message?.content;
  const candidate = JSON.parse(raw);
  classification = isValidClassification(candidate, categoryList)
    ? { categoryId: candidate.categoryId, reason: candidate.reason, confidence: candidate.confidence, source: 'llm' }
    : classifyExpenseRuleBased({ expense, categoryList });
} catch (e) {
  classification = classifyExpenseRuleBased({ expense, categoryList });
}

// Not "is this code present" but "could the employee really file under it" —
// active, and a selectable leaf. See isSelectableCategory above.
const categoryValid = isCategoryFileable(categoryList, classification.categoryId);

const policyCap = getPolicyCap(classification.categoryId);

// --- policyEngine.js: evaluate() — ordered gates, first failure wins --------
// Copied verbatim (exact reason/flag strings, exact gate order). The real
// signature takes every derived input; the node derives them above exactly the
// way src/uc02/workflow.js does.
//
// ⚠ THE ITEMIZATION AND LINE-SUM GATES ARE GONE, AND THAT IS NOT A REGRESSION.
// They read `expense.lines[]` and `expense.total_amount` — neither field exists
// on a real Remote expense (verified against 220 live records and the `Expense`
// schema, 2026-08-17), so this node refused every real expense with
// `missing_itemized_breakdown`. Live execution 4366 is that failure. They are
// replaced by receipt evidence, tax containment and conversion identity — see
// src/uc02/policyEngine.js's header for the full reasoning, which is the
// canonical copy of it. test/n8nUc02Parity.test.js proves this body and that
// file agree.
const APPROVABLE_EXPENSE_STATUSES = new Set(['pending']);
const POLICY_CAP_CURRENCY = 'USD';

// F-23: `null` -> 0 and `true` -> 1 both survive Number(); 100.5 cannot exist
// in an integer minor-unit domain at all.
function isMoneyScaledInteger(value) {
  return typeof value === 'number' && Number.isSafeInteger(value);
}

// The `code` off a real CurrencyDefinition object — the API returns an OBJECT
// here, never a bare string.
function currencyCode(currency) {
  if (!currency || typeof currency !== 'object') return null;
  return typeof currency.code === 'string' && currency.code ? currency.code : null;
}

// Receipt rows that are actually evidence: the File schema marks id, name, type
// and inserted_at required, and a row missing any of them is a placeholder a
// reviewer could not open.
function usableReceipts(expense) {
  const rows = expense && Array.isArray(expense.receipts) ? expense.receipts : [];
  return rows.filter(
    (row) =>
      row &&
      typeof row === 'object' &&
      typeof row.id === 'string' &&
      row.id !== '' &&
      typeof row.name === 'string' &&
      row.name !== '' &&
      typeof row.type === 'string' &&
      row.type !== '' &&
      typeof row.inserted_at === 'string' &&
      row.inserted_at !== ''
  );
}

// String comparison on a zero-padded ISO date is exactly chronological, so no
// Date parsing (and no timezone) is involved.
function isPastDate(value, now) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parts = value.split('-').map(Number);
  if (parts[1] < 1 || parts[1] > 12 || parts[2] < 1 || parts[2] > 31) return false;
  return value <= (now || new Date()).toISOString().slice(0, 10);
}

function evaluate({
  identityVerified,
  employmentActive,
  expense,
  expenseOwned,
  duplicate,
  categoryValid,
  classification,
  policyCap,
  upstreamFailures = [],
  now = new Date(),
}) {
  // Gate 0 — the employment read, ahead of the three gates that read it.
  const employmentFailure = upstreamVerdict(findUpstreamFailure(upstreamFailures, 'employment'));
  if (employmentFailure) return employmentFailure;

  if (!identityVerified) {
    return { decision: 'escalate', reason: 'identity_not_verified', flags: ['identity_not_verified'] };
  }
  if (!employmentActive) {
    return { decision: 'escalate', reason: 'employee_not_active', flags: ['employee_not_active'] };
  }
  // Checked BEFORE `!expense`: a read that failed produced no data anyone may
  // rely on, so the failure decides this gate whatever was passed beside it.
  // A 404 is an authoritative "no such expense" and keeps this gate's own reason
  // (plus a flag naming the status); anything else is not an answer about the
  // expense at all and takes the upstream reason.
  const expenseFailure = findUpstreamFailure(upstreamFailures, 'expense');
  if (expenseFailure && expenseFailure.kind !== UPSTREAM_NOT_FOUND) return upstreamVerdict(expenseFailure);
  if (!expense || expenseFailure) {
    return {
      decision: 'escalate',
      reason: 'expense_not_found',
      flags: expenseFailure
        ? ['expense_not_found', 'upstream_expense_' + (expenseFailure.status ?? 'error')]
        : ['expense_not_found'],
    };
  }
  if (!expenseOwned) {
    return { decision: 'escalate', reason: 'expense_employment_mismatch', flags: ['expense_employment_mismatch'] };
  }
  // F-11: an approved/declined/processing/reimbursed/canceled expense is a
  // decision somebody has already made. Those are Remote's own `Expense.status`
  // members verbatim — this comment used to say `paid`/`cancelled`, and neither
  // is one (REMOTE-VOCABULARY.md §6.6). Whitelist, so an unknown status blocks
  // rather than slips by.
  if (!APPROVABLE_EXPENSE_STATUSES.has(expense.status)) {
    return { decision: 'blocked', reason: 'expense_not_pending', flags: ['expense_not_pending'] };
  }
  if (duplicate) {
    return { decision: 'blocked', reason: 'duplicate_submission', flags: ['duplicate_submission'] };
  }

  // A category list we never received cannot make a category "unverified" —
  // that reason blames the classifier for an upstream outage (execution 4218's
  // 403 from a scope-less token is exactly this case). Checked ahead of
  // `categoryValid` for the same reason as the expense gate above.
  const categoriesFailure = upstreamVerdict(findUpstreamFailure(upstreamFailures, 'expense_categories'));
  if (categoriesFailure) return categoriesFailure;
  if (!categoryValid) {
    return { decision: 'human_review', reason: 'category_unverified', flags: ['category_unverified'] };
  }

  // Gate 8 — RECEIPT EVIDENCE: the record's only independent artifact backing
  // the money. Replaces the itemization gate; same purpose, real field.
  if (!usableReceipts(expense).length) {
    return { decision: 'human_review', reason: 'missing_receipt_evidence', flags: ['missing_receipt_evidence'] };
  }

  // F-23: sanity BEFORE any arithmetic or cap comparison, on the REAL fields.
  if (!isMoneyScaledInteger(expense.amount) || expense.amount <= 0) {
    return { decision: 'human_review', reason: 'invalid_amount', flags: ['invalid_amount'] };
  }
  if (!isMoneyScaledInteger(expense.converted_amount) || expense.converted_amount <= 0) {
    return { decision: 'human_review', reason: 'invalid_amount', flags: ['invalid_amount'] };
  }
  if (!isMoneyScaledInteger(expense.tax_amount) || expense.tax_amount < 0) {
    return { decision: 'human_review', reason: 'invalid_amount', flags: ['invalid_amount'] };
  }
  if (!isMoneyScaledInteger(expense.converted_tax_amount) || expense.converted_tax_amount < 0) {
    return { decision: 'human_review', reason: 'invalid_amount', flags: ['invalid_amount'] };
  }

  // Gate 10a — TAX CONTAINMENT: tax_amount is documented as the tax portion OF
  // amount, and a portion cannot exceed its whole.
  if (expense.tax_amount > expense.amount || expense.converted_tax_amount > expense.converted_amount) {
    return { decision: 'human_review', reason: 'tax_exceeds_amount', flags: ['tax_exceeds_amount'] };
  }

  // Gate 10b/11 — CONVERSION. Same currency both sides => no conversion
  // happened => the converted figures must equal the originals exactly.
  // Different currencies => the record carries no rate, so nothing can be
  // verified and the expense is flagged rather than estimated.
  const from = currencyCode(expense.currency);
  const to = currencyCode(expense.converted_currency);
  if (!from || !to || from !== to) {
    return { decision: 'human_review', reason: 'currency_conversion_unverified', flags: ['currency_conversion_unverified'] };
  }
  if (expense.converted_amount !== expense.amount || expense.converted_tax_amount !== expense.tax_amount) {
    return { decision: 'human_review', reason: 'conversion_identity_mismatch', flags: ['conversion_identity_mismatch'] };
  }

  // F-12: an unknown cap is not "no cap" — it fails closed to a human.
  if (!isMoneyScaledInteger(policyCap) || policyCap < 0) {
    return { decision: 'human_review', reason: 'policy_cap_unknown', flags: ['policy_cap_unknown'] };
  }
  // ...and a cap in one currency cannot measure an amount in another. The caps
  // corpus is denominated in POLICY_CAP_CURRENCY; the live account bills in
  // five currencies, so comparing every expense's raw `amount` to one table would
  // apply a USD cap to GBP pence.
  if (to !== POLICY_CAP_CURRENCY) {
    return { decision: 'human_review', reason: 'policy_cap_currency_mismatch', flags: ['policy_cap_currency_mismatch'] };
  }
  if (expense.converted_amount > policyCap) {
    return { decision: 'human_review', reason: 'over_policy_cap', flags: ['over_policy_cap'] };
  }

  if (classification.confidence < CONFIDENCE_THRESHOLD) {
    return { decision: 'human_review', reason: 'low_confidence', flags: ['low_confidence'] };
  }

  // Gate 14 — the schema says expense_date "Must be in the past".
  if (!isPastDate(expense.expense_date, now)) {
    return { decision: 'human_review', reason: 'expense_date_invalid', flags: ['expense_date_invalid'] };
  }

  // NO VAT GATE, deliberately. `vat_amount` does not exist; the real field is
  // `tax_amount`, which every live record carries as non-zero — refusing on it
  // would refuse 100% of real expenses. VAT recovery is instead unassertable BY
  // CONSTRUCTION: the approve write's body is `{status:"approved"}` and has no
  // VAT field. See src/uc02/policyEngine.js.
  return { decision: 'auto_approve', reason: 'all_gates_passed', flags: [] };
}

const result = evaluate({
  identityVerified,
  employmentActive,
  expense,
  expenseOwned,
  duplicate,
  categoryValid,
  classification,
  policyCap,
  upstreamFailures,
});
const decision = result.decision;
const reason = result.reason;
const flags = result.flags;

// riskEngine.js: UC-02's base tier is "low"; any flag pushes it to "medium".
const riskTier = flags.length > 0 ? 'medium' : 'low';

// The ONLY write this use case can make — computed, not executed. The graph's
// HTTP Request node performs it on the auto_approve branch.
const writePayload = decision === 'auto_approve' ? { status: 'approved' } : null;

return [{
  json: {
    ...request,
    employment,
    expense,
    categoryList,
    duplicate,
    classification,
    categoryValid,
    policyCap,
    decision,
    reason,
    flags,
    riskTier,
    // Carried so "Append Audit Log" can put WHICH call failed and WHAT it
    // answered into `audit_log.details` — the difference between a triage that
    // starts at the right service and one that hunts a phantom identity bug.
    upstreamFailures,
    categoryId: classification.categoryId,
    categorySource: classification.source,
    confidence: classification.confidence,
    receiptHash: request.receiptHash ?? null,
    // The F-24 pair, carried so "Persist Expense (Supabase)" can write the
    // dedupe key and the audit row can record WHICH key a block came from.
    // `receiptHashSource` mirrors the field src/uc02/workflow.js puts in its
    // own audit details, so a row from either execution path reads the same.
    derivedReceiptHash,
    dedupeKey,
    receiptHashSource: request.receiptHash ? 'submitted' : 'derived',
    duplicateMatchedOn,
    // statusFor() from src/uc02/expenseStore.js, ported so the `status` column
    // this graph writes matches the one the Node path writes for the same
    // decision. A Supabase node cannot express this mapping in an expression
    // without re-deriving policy in the graph, which is the thing the parity
    // discipline exists to prevent.
    storeStatus:
      decision === 'auto_approve'
        ? 'auto_approved'
        : decision === 'human_review'
          ? 'flagged'
          : decision === 'blocked'
            ? 'blocked'
            : 'escalated',
    // Real fields. Both figures AND both codes: an audit row carrying a bare
    // number and no currency cannot be re-checked, and the cap gate compares
    // the converted (billing-currency) figure.
    amount: expense?.amount ?? null,
    currency: expense?.currency?.code ?? null,
    convertedAmount: expense?.converted_amount ?? null,
    convertedCurrency: expense?.converted_currency?.code ?? null,
    taxAmount: expense?.tax_amount ?? null,
    receiptCount: Array.isArray(expense?.receipts) ? expense.receipts.length : 0,
    writePayload,
  },
}];
