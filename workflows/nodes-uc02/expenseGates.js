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
// Ported from src/uc02/policyCaps.js — both copies move together; the
// reasoning, and the six categories deliberately left uncapped, live there.
  "work_meals_and_entertainment.internal_meals_and_entertainment": 50000, // $500.00
  "work_meals_and_entertainment.external_meals_and_entertainment": 30000, // $300.00
  "business_travel.accommodation": 100000, // $1,000.00
  "business_travel.travel_long_distance": 100000, // $1,000.00
  "business_travel.local_transportation": 20000, // $200.00
  "home_office_and_co_working.co_working_part_time_or_daily": 25000, // $250.00
  "tech_and_work_equipment.software_and_subscriptions": 20000, // $200.00
  "company_and_office_expenses.office_supplies_and_shipping": 15000, // $150.00
  "business_travel.personal_meals_during_business_travel": 7500, // $75.00 per day
  "business_travel.tolls_or_parking": 5000, // $50.00
  "business_travel.fuel": 15000, // $150.00
  "business_travel.communication_and_data_usage": 7500, // $75.00
  "business_travel.travel_insurance": 20000, // $200.00
  "business_travel.car_rental_short_term": 40000, // $400.00
  "home_office_and_co_working.home_internet": 10000, // $100.00 per month
  "home_office_and_co_working.co_working_full_month": 50000, // $500.00 per month
  "home_office_and_co_working.utilities": 15000, // $150.00 per month
  "tech_and_work_equipment.phone": 10000, // $100.00 per month
  "tech_and_work_equipment.work_equipment_employee_owned": 50000, // $500.00
  "tech_and_work_equipment.work_equipment_employer_owned": 50000, // $500.00
  "learning_and_development.learning_and_development": 50000, // $500.00
  "stipends_and_wellness.gym_and_wellness": 7500, // $75.00 per month
  "stipends_and_wellness.stipends_and_perks": 10000, // $100.00
  "stipends_and_wellness.recognition_awards_and_gifts": 10000, // $100.00
  "company_and_office_expenses.employee_recognition_and_corporate_gifts": 10000, // $100.00
  "company_and_office_expenses.personal_occasion_gifts": 5000, // $50.00
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

/**
 * The confidence an ambiguous (tied) rule-based match is reported at.
 *
 * Below policyEngine.js's 0.85 gate ON PURPOSE — the whole point is that gate
 * 13 catches it. Raising this above 0.85 silently re-enables deciding a
 * category by list order.
 */
const AMBIGUOUS_MATCH_CONFIDENCE = 0.5;

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
  // How many categories share the winning score. A TIE IS NOT A WINNER: see
  // AMBIGUOUS_MATCH_CONFIDENCE below.
  let tiedAtBest = 0;
  for (const category of list) {
    const haystack = categoryHaystack(category);
    const score = tokens.filter((token) => haystack.includes(token)).length;
    if (score > bestScore) {
      best = category;
      bestScore = score;
      tiedAtBest = 1;
    } else if (score > 0 && score === bestScore) {
      tiedAtBest += 1;
    }
  }
  const ambiguous = tiedAtBest > 1;

  // NO record-category lookup: the record's category namespace (deprecated flat
  // enum: `meals`, `tech_equipment`) is DISJOINT from the selectable list's
  // hierarchical codes, so it can never resolve — and mapping between them
  // would mean inventing a correspondence Remote does not publish. The recorded
  // category's TITLE is folded into the match text above instead.
  const categoryId = (bestScore > 0 ? best : null)?.code ?? null;

  let confidence = categoryId ? 0.9 : 0.6;
  if (NON_ENGLISH_SIGNALS.some((re) => re.test(text))) confidence = 0.5;
  if (LOW_CONF_SIGNALS.some((re) => re.test(text))) confidence = 0.4;
  // A TIE MUST NOT SCORE AS CERTAINTY. Measured live 2026-08-29 on the Sandbox
  // expense "Office Chair", whose recorded category is the legacy PARENT code
  // `tech_equipment` ("Tech / Work Equipment"). The joined text therefore
  // carries the tokens `tech`, `work` and `equipment`, which appear in BOTH
  // `tech_and_work_equipment.equipment_shipping_and_customs` and
  // `tech_and_work_equipment.work_equipment_employee_owned`. The scores were
  // equal, `>` kept whichever the category list happened to yield first, and
  // the result was reported at 0.9 — above the 0.85 gate — so a coin flip
  // between "shipping and customs" and "buying the chair" cleared the
  // confidence gate as a confident answer.
  //
  // That is the same defect this file's header already records for substring
  // scoring: "a false category resolves a false cap, and 0.9 clears the
  // confidence gate." Ordering is not evidence, so an unresolved tie is capped
  // BELOW the gate and gate 13 sends it to a human. Math.min, never assignment,
  // so this can only ever lower a confidence another signal already reduced.
  if (ambiguous) confidence = Math.min(confidence, AMBIGUOUS_MATCH_CONFIDENCE);

  const reason = !categoryId
    ? "No category could be resolved from the expense's title or its recorded category name."
    : ambiguous
      ? `Rule-based token overlap tied ${tiedAtBest} categories, so the match was decided by list order rather than by evidence — reported below the confidence gate so a person chooses.`
      : "Rule-based token overlap between the expense's title (plus its recorded category name) and this category's own text.";

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


/**
 * Which recorded fields the receipt disagrees with — field NAMES only, never
 * amounts, so no caller can treat the model's number as a value to use. Vendor
 * is deliberately not compared: the record has no merchant field and `title` is
 * a purpose ("Team lunch"), not a trading name. Mirrors src/uc02/policyEngine.js.
 */
function receiptContradictions(expense, extracted) {
  const out = [];
  if (!expense || !extracted) return out;

  const claimedCurrency = (expense && expense.currency && expense.currency.code) || (expense && expense.currency) || null;
  if (extracted.currency && claimedCurrency && String(extracted.currency).toUpperCase() !== String(claimedCurrency).toUpperCase()) {
    out.push('receipt_currency_differs');
  }

  const claimedTotal = Number.isInteger(expense && expense.amount) ? expense.amount : null;
  if (Number.isInteger(extracted.total) && claimedTotal !== null && extracted.total !== claimedTotal) {
    out.push('receipt_total_differs');
  }

  const claimedDate = typeof (expense && expense.expense_date) === 'string' ? expense.expense_date.slice(0, 10) : null;
  if (extracted.date && claimedDate && extracted.date !== claimedDate) {
    out.push('receipt_date_differs');
  }

  return out;
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
const RECEIPT_NOT_ATTEMPTED_REASONS = Object.freeze([
  "extraction_not_configured",
  "no_receipt_attached",
  "zendesk_not_configured",
  "no_ticket_supplied",
]);

function evaluate({
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

  // Gate 8b — DOES THE RECEIPT SUPPORT THE CLAIM? [E-1]
  //
  // Mirrors src/uc02/policyEngine.js verbatim in behaviour; see that file for
  // the full reasoning. Three properties: Remote's figures are never
  // overwritten by the model's, this block can only ever refuse, and an ABSENT
  // reading is skipped entirely (absent is not "unreadable" — treating it as
  // one would send every claim to a human and disable the green tier).
  if (receiptReading) {
    if (!receiptReading.extracted) {
      if (!RECEIPT_NOT_ATTEMPTED_REASONS.includes(receiptReading.reason)) {
        return { decision: 'human_review', reason: 'receipt_unreadable', flags: ['receipt_unreadable'] };
      }
    } else {
      const contradictions = receiptContradictions(expense, receiptReading.extracted);
      if (contradictions.length) {
        return {
          decision: 'human_review',
          reason: 'receipt_does_not_support_claim',
          flags: ['receipt_does_not_support_claim'].concat(contradictions),
        };
      }
    }
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

  // FAILS CLOSED, ported from src/uc02/policyEngine.js 2026-08-31 — this file
  // had only the bare comparison below, which is the defect src's own comment
  // describes: `undefined < 0.85` and `NaN < 0.85` are both FALSE, so a
  // classification whose confidence never arrived walked straight past this
  // gate to `auto_approve` — and this is the one of the three whose auto path
  // MOVES MONEY (`PATCH /v1/expenses/:id {status:"approved"}`).
  //
  // The two copies were wrong in OPPOSITE directions and no test could see
  // either: src crashed (`flags` unbound — fixed in the same change), this one
  // auto-approved. `test/n8nUc02Parity.test.js` compares the two, so a shared
  // input that makes one throw and the other approve was never fed to it,
  // because both classifiers always emit a number. Latent on both sides, and
  // the fail-open side is the one that would have paid a claim.
  const confidenceValue = classification.confidence;
  if (typeof confidenceValue !== 'number' || Number.isNaN(confidenceValue)) {
    return { decision: 'human_review', reason: 'low_confidence', flags: ['low_confidence', 'confidence_unknown'] };
  }
  if (confidenceValue < CONFIDENCE_THRESHOLD) {
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

// [E-1] What the receipt attached to the TICKET was read to say, from the
// "Read Receipt (API)" node. Read by NAME, because $json here is whatever the
// previous node emitted and does not carry it.
//
// AN UNREACHABLE READER IS "NOBODY TRIED", NOT "UNREADABLE". If that node
// errored (it runs with onError: continueRegularOutput so an outage cannot
// abort the run), or answered a shape we do not recognise, the response has no
// `source` and this stays null — which gate 8b skips entirely. The alternative,
// treating our own API being down as an unreadable receipt, would send every
// claim to a human for the duration of an outage: a self-inflicted outage of
// the green tier, on top of the one already happening.
// PORTED VERBATIM from src/uc02/policyEngine.js. Both copies move together —
// test/uc02ReceiptNoteParity.test.js executes this file's body and compares.
function describeReceiptReading(expense, receiptReading) {
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

let receiptReading = null;
try {
  const read = $('Read Receipt (API)').item.json;
  if (read && typeof read.source === 'string') {
    receiptReading = { extracted: read.extracted ?? null, source: read.source, reason: read.reason };
  }
} catch (err) {
  receiptReading = null;
}


// ===========================================================================
// COMPOSED TICKET PROSE — BEGIN
// ===========================================================================
// Everything between this sentinel and "COMPOSED TICKET PROSE — END" is lifted
// verbatim and executed by test/n8nUc02TerminalZendeskNodes.test.js. It is
// self-contained on purpose — it reads no `const` declared above it — so the
// test can run it without the rest of this body. DO NOT reach outward from
// inside the block; a reference to an outer binding turns the lift into a
// ReferenceError that reads like a test-harness problem rather than an edit.
//
// ---------------------------------------------------------------------------
// WHY THE PROSE MOVED HERE, AND WHAT IT REPLACES
// ---------------------------------------------------------------------------
// UC-02's five terminal Zendesk nodes each carried a hand-typed sentence in a
// node parameter. A Zendesk "update ticket" node has no `jsCode`, so
// `npm run verify-deployed`'s body diff is STRUCTURALLY BLIND to it: the words
// written onto a real customer's ticket were versioned by nothing and read back
// by no check. Same defect, same fix, as UC-01's composeInternalNote.js and
// UC-04's composeInternalNote() — compose here, in a file that is byte-diffed,
// and let the node interpolate one field.
//
// The four sentences that are being retired, and what is wrong with each. The
// evidence is in workflows/nodes-uc02/terminalZendeskNodesSpec.js as DATA
// (ESCALATE_REASON_EVALUATED) rather than as a paragraph, so the counts below
// are a test's to take rather than a reader's to trust.
//
// 1. "No auto-approval issued."  (Escalate Expense Ticket)
//    MISLEADING for 3 of the 6 reachable escalate reasons. All three Remote
//    reads carry `onError: continueRegularOutput`, so `upstream_unavailable`
//    and `upstream_record_not_found` are genuinely reachable, and
//    GATE_SEQUENCE's own words for them are "this expense was never evaluated.
//    Nothing has been decided about it either way." `identity_not_verified`
//    likewise: "nothing about the expense was disclosed or decided." Saying
//    "no auto-approval issued" about a claim NOBODY ASSESSED implies an
//    assessment ran and came back negative. The composer splits by reason
//    class instead — see ESCALATE_NOT_EVALUATED_REASONS.
//
// 2. "Routed to a human rather than dropped."  (Unrecognised Expense Decision)
//    True at the Zendesk layer and DIRECTLY CONTRADICTED by the sidebar.
//    src/uc02/reviewPolicy.js's evaluateExpenseActionability() refuses any row
//    whose `decision !== "human_review"`, so the human this note routes the
//    ticket to opens the panel and is told "it was never routed to Finance
//    Ops, so it has no review path here." One ticket, two surfaces, opposite
//    claims. The composer says what actually happened — the gates emitted none
//    of their four decisions, which is an AUTOMATION FAULT and not a decision
//    about the expense.
//
// 3. "This claim was blocked, not approved."  (Flag Blocked Expense)
//    Not false, and it stops one sentence short of the thing the reader needs:
//    the ticket is assigned to the owning team while NOTHING on it is open to
//    that team's approve/decline. Every non-review note now carries that clause
//    — the sidebar's refusal and the ticket's own words agree for the first
//    time.
//
// 4. "AI summary — ..."  (Flag Blocked / Flag For Review / Escalate)
//    UC-02 DOES have a real LLM node ("Classify Expense (LLM)"), so "AI" is
//    defensible in a way it is not on UC-07. It is still dropped from all
//    three, and the judgement is per node rather than blanket:
//      - Flag Blocked Expense — FALSE. Both reachable `blocked` reasons
//        (`expense_not_pending`, gate 5; `duplicate_submission`, gate 6) are
//        decided BEFORE gate 7 reads the classifier at all. The note described
//        gate outcomes and credited them to a model that had not been consulted.
//      - Escalate Expense Ticket — FALSE. Every reachable escalate reason is
//        gate 0-4, all of them before the classifier is read.
//      - Flag Expense For Review — TRUE OF SOME AND FALSE OF OTHERS.
//        `category_unverified` (7), `policy_cap_unknown` (12) and
//        `low_confidence` (13) do rest on the classification; gates 8-11 and 14
//        do not. A label that is right half the time is not a label.
//    Replaced by something strictly more informative and never false: the note
//    names `classification.source` (`llm` / `rule_based_fallback`) and the
//    confidence figure, and then states — in describeDecidingGate()'s own
//    words, ported from src — whether the run ever reached the gate that reads
//    that figure. A reader can now tell "the model decided this" from "the
//    model was consulted and overruled" from "the model played no part".
//
// ---------------------------------------------------------------------------
// THREE PROPERTIES OF THE OLD NODES THAT ARE DELIBERATELY PRESERVED
// ---------------------------------------------------------------------------
// 1. THE RAW REASON IS ALWAYS PRINTED. Every retired note interpolated
//    `$json.reason` rather than enumerating causes, which made it structurally
//    immune to UC-04's over-narrow-enumeration defect (a sentence naming a
//    cause that is right for 5 of 12 inputs). The composer keeps that: the
//    "Assessment:" line prints `reason` verbatim, ALWAYS, and the gate ladder
//    below is an addition to it and never a substitute. An unrecognised reason
//    gets describeDecidingGate()'s honest "cannot be stated", never a guess —
//    a wrong attribution is worse than an absent one.
// 2. NO TEAM NAME IS HAND-TYPED. `routingNote`, appended by the Zendesk node,
//    is the one place a team is named, off the routing table. This composer
//    says "the team named in the routing line below" and never spells one out.
//    That costs one thing and it is named here rather than smoothed over: the
//    sidebar's own refusals (src/uc02/reviewPolicy.js's describeNoReviewPath()
//    and REFUSALS.not_awaiting_review) DO say "Finance Ops", and the sentences
//    quoted below are therefore quoted with that phrase dropped rather than
//    byte-for-byte. The alternative is a second copy of a team name six words
//    from the routing table's copy of it, which is exactly the failure
//    docs/ESCALATION-DESTINATIONS.md §2.2 records for UC-04 ("one team, four
//    spellings, none of them the group's name").
// 3. THE GATE ORDER IS src's, POSITION FOR POSITION. GATE_SEQUENCE below is
//    generated from src/uc02/policyEngine.js's export and is held byte-equal to
//    it by test/n8nUc02TerminalZendeskNodes.test.js. Positions 0-15, sixteen
//    rungs, unchanged.
//
// PURE, AND IT DECIDES NOTHING. Same contract as describeDecidingGate() and
// describeReceiptReading() above: it reads a decision already made and cannot
// change what was decided. Nothing on this graph branches on its output, and
// nothing may — `Route by Decision` switches on `decision` and must go on
// doing so.
// ---------------------------------------------------------------------------

// --- src/uc02/policyEngine.js's GATE_SEQUENCE + CONFIDENCE_GATE_POSITION,
// --- ported verbatim (a Code node cannot import). GENERATED from that export,
// --- not retyped, and held equal to it by test.
const CONFIDENCE_GATE_POSITION = 13;
const GATE_SEQUENCE = [
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
];

// --- src/uc02/policyEngine.js's describeDecidingGate(), ported verbatim -----
// Including its unrecognised-reason branch, which is the property preserved
// note 1 above depends on: a reason no rung matches yields position: null and
// a `note` saying so, never a nearby rung's words.
const LADDER_LENGTH = new Set(GATE_SEQUENCE.map((g) => g.position)).size;

function describeDecidingGate(gateReason) {
  const entry = GATE_SEQUENCE.find((g) => g.reason === gateReason);
  if (!entry) {
    return {
      position: null,
      gate: 'unknown',
      checks: '',
      means: '',
      ladderLength: LADDER_LENGTH,
      confidenceConsulted: false,
      note: 'No gate in GATE_SEQUENCE matches the reason "' + gateReason + '", so which gate decided cannot be stated.',
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
      ? 'The run reached the classifier-confidence gate, so the confidence figure below was consulted.'
      : 'The gates run in order and the first failure wins, so this run stopped at gate ' + entry.position + ' (' + entry.gate + ') — BEFORE gate ' + CONFIDENCE_GATE_POSITION + ', where the classifier\'s confidence is read. That figure describes how sure the LLM was about the expense CATEGORY; it played no part in this outcome.',
  };
}

/**
 * The three escalate reasons on which NOTHING ABOUT THE CLAIM WAS EVALUATED,
 * as opposed to the three on which a gate answered a question about it.
 *
 * This split is the whole of defect 2 above. All six produce `escalate`, so a
 * single sentence has to be true of all six or it is false of some — and "No
 * auto-approval issued" is false of exactly these three, because it implies an
 * assessment that never ran. Reachability is not assumed: the three Remote
 * reads carry `onError: continueRegularOutput` (read live off the graph), which
 * is what makes the two upstream reasons real rather than theoretical.
 *
 * The full six, with the verdict on the retired sentence, are DATA in
 * workflows/nodes-uc02/terminalZendeskNodesSpec.js's ESCALATE_REASON_EVALUATED,
 * and a test asserts that table covers exactly the reasons this body can emit
 * as `escalate` — so a seventh added tomorrow fails a test instead of quietly
 * inheriting whichever branch it lands in.
 */
const ESCALATE_NOT_EVALUATED_REASONS = ['upstream_unavailable', 'upstream_record_not_found', 'identity_not_verified'];

/**
 * A money figure or nothing. NEVER a fallback number.
 *
 * `null` on anything that is not a safe integer, because the one thing the
 * substitution ladder forbids outright is fabricating money (CLAUDE.md §3):
 * a claim whose amount could not be read prints no amount, and the caller
 * drops the clause rather than printing "0.00" or "unknown USD".
 */
/**
 * The currency the cap corpus is denominated in. A SECOND copy of
 * POLICY_CAP_CURRENCY above, declared here because this block is lifted and
 * executed on its own by test/n8nUc02TerminalZendeskNodes.test.js and must not
 * reach outward; that test asserts the two copies are equal, so the duplication
 * cannot drift silently.
 */
const POLICY_CAP_CURRENCY_LABEL = 'USD';

function formatMinorUnits(minor, currencyCodeValue) {
  if (!Number.isSafeInteger(minor)) return null;
  const figure = (minor / 100).toFixed(2);
  return typeof currencyCodeValue === 'string' && currencyCodeValue ? figure + ' ' + currencyCodeValue : figure;
}

/** The four decisions `evaluate()` can return. Anything else is the fault. */
const KNOWN_DECISIONS = ['auto_approve', 'human_review', 'blocked', 'escalate'];

/**
 * The internal note the ticket carries. DETERMINISTIC TEXT, never LLM-authored
 * — the same discipline as UC-01's composeInternalNote.js and UC-04's
 * composeInternalNote().
 *
 * EMITTED FOR EVERY DECISION, including `auto_approve`, so all five terminal
 * Zendesk nodes can adopt `internalNote` without this file changing again.
 */
function composeInternalNote(args) {
  const decisionValue = args.decision;
  const reasonValue = args.reason;
  const flagList = Array.isArray(args.flags) ? args.flags : [];
  const flagText = flagList.length ? flagList.join(', ') : 'none';
  const cls = args.classification && typeof args.classification === 'object' ? args.classification : {};
  const gate = describeDecidingGate(reasonValue);
  const recognised = KNOWN_DECISIONS.indexOf(decisionValue) !== -1;
  const neverEvaluated = decisionValue === 'escalate' && ESCALATE_NOT_EVALUATED_REASONS.indexOf(reasonValue) !== -1;

  const lines = [];

  // --- 1. What happened, in one line, before any detail --------------------
  if (!recognised) {
    lines.push(
      'UC-02 expense claim — AUTOMATION FAULT. The gates returned a decision this graph does not recognise (' +
        JSON.stringify(decisionValue === undefined ? null : decisionValue) +
        '), so this ticket was assigned to a human. Nothing has been decided about the expense itself.'
    );
  } else if (decisionValue === 'auto_approve') {
    lines.push(
      'UC-02 expense claim — every gate passed, so the automation approved this claim at Remote and no person was asked to decide. This note is the record of that, not a request.'
    );
  } else if (decisionValue === 'human_review') {
    lines.push(
      'UC-02 expense claim — the automation has PREPARED this claim and decided nothing about whether it may be reimbursed. It is waiting on a human.'
    );
  } else if (decisionValue === 'blocked') {
    lines.push(
      'UC-02 expense claim — STOPPED. This claim was not approved, and it is not waiting on a decision from anyone here.'
    );
  } else if (neverEvaluated) {
    lines.push(
      'UC-02 expense claim — NEVER EVALUATED. Nothing has been decided about this claim either way, and nothing was approved or refused on its merits.'
    );
  } else {
    lines.push(
      'UC-02 expense claim — stopped before any assessment of the spend ran. No amount was compared against any policy cap.'
    );
  }

  // --- 2. The deciding gate, in the gate's own words -----------------------
  lines.push('');
  lines.push(
    gate.position === null
      ? 'Which gate decided this cannot be stated. ' + gate.note
      : 'Decided at gate ' +
        gate.position +
        ' of ' +
        gate.ladderLength +
        ' (' +
        gate.gate +
        '), which checks ' +
        gate.checks +
        '. ' +
        gate.means
  );

  // --- 3. The figures the gate compared ------------------------------------
  // Each clause is dropped entirely when its value is absent, never defaulted.
  // A blank is honest; a zero beside a real currency code is a measurement
  // claim nobody made.
  //
  // BOTH MONEY FIGURES, ALWAYS, EVEN WHEN THEY AGREE — the same property
  // describeReceiptReading() is pinned on above. A note printing one figure
  // invites the reader to take it as "the amount".
  //
  // THEY ARE STATED AS FACTS, NEVER AS ROLES. An earlier draft wrote "the
  // figure the cap gate compares" beside the converted amount, which is a
  // claim that a comparison HAPPENED — false on every escalate and on most
  // blocked runs, and it sat two lines under "No amount was compared against
  // any policy cap". The gate sentence above already says what ran.
  const facts = [];
  const claimed = formatMinorUnits(args.amount, args.currency);
  const converted = formatMinorUnits(args.convertedAmount, args.convertedCurrency);
  if (claimed) facts.push('Claimed: ' + claimed + '.');
  if (converted) facts.push('Converted: ' + converted + '.');
  facts.push(
    'Category as read: ' +
      (cls.categoryId ? cls.categoryId : 'none resolved') +
      (args.categoryValid === true ? ' (fileable by this employee)' : args.categoryValid === false ? ' (NOT a category this employee can file against)' : '') +
      ', reported by ' +
      (cls.source ? cls.source : 'an unrecorded reader') +
      ' at confidence ' +
      (typeof cls.confidence === 'number' ? cls.confidence : 'not reported') +
      '.'
  );
  // POLICY_CAP_CURRENCY_LABEL, not args.convertedCurrency: the cap corpus is
  // denominated in one currency and an expense may be in another — that is the
  // whole of gate 12's `policy_cap_currency_mismatch`. Labelling a USD cap with
  // the claim's EUR code would print a figure that does not exist.
  const cap = formatMinorUnits(args.policyCap, POLICY_CAP_CURRENCY_LABEL);
  facts.push(cap ? 'Spend cap recorded for that category: ' + cap + '.' : 'Spend cap recorded for that category: none.');
  // The sentence that replaces "AI summary". src's own words for whether the
  // classifier's figure was consulted at all — see note 4 in this block's
  // header for why a blanket "AI" label was wrong on three nodes in three
  // different ways. Suppressed when the gate is unknown, because then it is a
  // verbatim repeat of the line two paragraphs up.
  if (gate.position !== null) facts.push(gate.note);
  lines.push('');
  lines.push(facts.join(' '));

  // --- 4. The receipt, both readings side by side --------------------------
  // Folded in here rather than appended by one node's own expression, which is
  // where it used to live: `Flag Expense For Review` carried a bare
  // `{{ $json.receiptNote || '' }}`, so the reading gate 8b compiled reached a
  // reviewer on ONE of the five branches and nowhere else.
  if (typeof args.receiptNote === 'string' && args.receiptNote) {
    lines.push('');
    lines.push(args.receiptNote);
  }

  // --- 5. The decision itself, with the raw reason ALWAYS printed ----------
  lines.push('');
  lines.push(
    'Assessment: ' +
      (decisionValue === undefined || decisionValue === null ? 'none emitted' : decisionValue) +
      ' (' +
      (reasonValue === undefined || reasonValue === null ? 'no reason emitted' : reasonValue) +
      '). Flags: ' +
      flagText +
      '.'
  );

  // --- 6. Who decides, and where -------------------------------------------
  // Every branch answers the question the sidebar will be asked, in the
  // sidebar's own terms, so the ticket and the panel cannot contradict each
  // other. src/uc02/reviewPolicy.js's evaluateExpenseActionability() refuses
  // every row whose `decision !== "human_review"`; the sentences below are its
  // describeNoReviewPath() / REFUSALS text with the hand-typed team name
  // dropped (see property 2 in this block's header).
  const NO_CONTROL =
    'The ZAF sidebar refuses any expense whose decision is not `human_review`, so this ticket carries no approve/decline control at all.';
  lines.push('');
  lines.push('WHO DECIDES, AND WHERE');
  if (!recognised) {
    lines.push(
      'Nobody yet — and that is the fault, not a decision. The gates emit exactly four decisions (' +
        KNOWN_DECISIONS.join(', ') +
        ') and this run emitted none of them, so no branch of this graph has judged the expense: nothing was written to Remote and no cap was compared. ' +
        NO_CONTROL +
        ' Work this ticket by hand and raise the automation fault; the routing line below says which team holds it, not which team can decide it.'
    );
  } else if (decisionValue === 'auto_approve') {
    lines.push(
      'Nobody, and nobody was asked. Every gate passed, so the approval has already been written to the expense record at Remote — this ticket is the record of that. ' +
        NO_CONTROL
    );
  } else if (decisionValue === 'human_review') {
    lines.push(
      "Here, on this ticket. Open its ZAF sidebar and use the UC-02 panel: approve, decline or hold. A decline must state a reason — Remote's DeclineExpenseParams requires one, and an unexplained decline is not something an employee can act on. The team being asked is named in the routing line below."
    );
  } else if (decisionValue === 'blocked') {
    lines.push(
      'Nowhere here. A block is a hard stop, not an exception to weigh — there is nothing to approve. ' +
        NO_CONTROL +
        ' The ticket is assigned to the team in the routing line below so the claim is visible and so anything that has to happen outside this system can happen, but nothing on it is open to that team\'s approve or decline.'
    );
  } else {
    lines.push(
      'Nowhere here. This claim has no approval path on this ticket; the escalation is worked directly. ' +
        NO_CONTROL +
        (neverEvaluated
          ? ' And there is nothing to overturn: the claim was never assessed, so the thing to act on is the failure named in the gate sentence above, not the expense.'
          : ' The gate sentence above says what stopped it; the expense itself was never weighed against a cap.') +
        ' The ticket is assigned to the team in the routing line below, which owns the work, not a decision on this claim.'
    );
  }

  return lines.join('\n');
}

/**
 * The CUSTOMER-FACING reply, and the only text in this file an employee reads.
 *
 * PLAIN TEXT, DELIBERATELY. n8n's Zendesk node sends `publicReply` as plain
 * text and SILENTLY ESCAPES HTML — its `internalNote` sibling is the one
 * documented "(Accepts HTML)". UC-01 delivered a whole letter to a customer as
 * literal `&lt;!doctype html&gt;…` source on a fully green run because of this
 * (CLAUDE.md §4). So: no tags, no entities, no markup of any kind, asserted by
 * test/n8nUc02TerminalZendeskNodes.test.js.
 *
 * THE CLAIM "has been automatically approved" IS TRUE AND STAYS. This reply is
 * reachable only downstream of `Approve Expense (Remote)`, the real
 * PATCH /v1/expenses/:id, and that node carries NO `onError` (read live off
 * `WORKFLOW_UC02_ID`) — so a failed write aborts the branch and this reply is
 * never sent. What is ADDED is the figure: the employee used to receive a bare
 * "approved" with no amount, which is unverifiable by the person it is about.
 *
 * The CONVERTED amount, not the claimed one, because that is the figure gate 12
 * compared against the cap — and on this path the two are equal anyway, since
 * gate 11 requires the currencies to match and the figures to be identical.
 * `null` amount ⇒ the figure clause is dropped, never guessed.
 *
 * @returns {string|null} null for every decision but `auto_approve` — no other
 *   branch of this graph sends the customer anything.
 */
function composeCustomerReply(args) {
  if (args.decision !== 'auto_approve') return null;
  const figure = formatMinorUnits(args.convertedAmount, args.convertedCurrency);
  return (
    'Your expense claim' +
    (figure ? ' for ' + figure : '') +
    ' has been automatically approved. It was checked against the spend cap recorded for its expense category, and the approval has been written to the expense record at Remote. No further action is needed from you.'
  );
}

// ===========================================================================
// COMPOSED TICKET PROSE — END
// ===========================================================================

const result = evaluate({
  identityVerified,
  employmentActive,
  expense,
  expenseOwned,
  duplicate,
  categoryValid,
  classification,
  policyCap,
  receiptReading,
  upstreamFailures,
});
const decision = result.decision;
const reason = result.reason;
const flags = result.flags;

// The ticket prose, composed HERE rather than typed into five Zendesk node
// parameters. See the "COMPOSED TICKET PROSE" block above for what each of the
// retired sentences got wrong. DISPLAY ONLY: nothing on this graph branches on
// either field, and nothing may.
const internalNote = composeInternalNote({
  decision,
  reason,
  flags,
  classification,
  categoryValid,
  policyCap,
  amount: expense?.amount ?? null,
  currency: expense?.currency?.code ?? null,
  convertedAmount: expense?.converted_amount ?? null,
  convertedCurrency: expense?.converted_currency?.code ?? null,
  receiptNote: describeReceiptReading(expense, receiptReading),
});
const customerReply = composeCustomerReply({
  decision,
  convertedAmount: expense?.converted_amount ?? null,
  convertedCurrency: expense?.converted_currency?.code ?? null,
});

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
    // The reviewer-facing sentence. Carried on the node output so the Zendesk
    // internal note can name both readings without re-deriving the comparison
    // — the note must never be able to contradict the decision beside it.
    receiptNote: describeReceiptReading(expense, receiptReading),
    // The composed Zendesk prose. `internalNote` is read by all five terminal
    // Zendesk nodes; `customerReply` by "Resolve Expense Ticket" alone, and it
    // is the only string in this file a customer ever sees. Both are addressed
    // as $('Expense Gates').first().json.<field> — see
    // workflows/nodes-uc02/terminalZendeskNodesSpec.js for why '.first()' and
    // not '$json'.
    internalNote,
    customerReply,
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
