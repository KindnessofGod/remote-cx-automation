// ---------------------------------------------------------------------------
// checkDuplicateReceipt.js — body of UC-02's "Check Duplicate Receipt
// (Supabase)" n8n Code node
// ---------------------------------------------------------------------------
// WHAT THIS REPLACED, VERBATIM
//
//   // PLACEHOLDER: no `uc02_expenses` Supabase table has been provisioned yet
//   // ... Returning duplicate: null unconditionally means dedupe simply never
//   // fires here ...
//   return [{ json: { duplicate: null } }];
//
// The premise was false. `uc02_expenses` existed the whole time, in project
// your-project-ref, with seventeen columns — and with the only
// non-primary-key indexes of any `uc0*` table, on `receipt_hash` and
// `external_ref`, i.e. exactly this gate's two lookups. Somebody provisioned
// the storage and nothing was ever pointed at it. The same false premise had
// been copied into src/uc02/expenseStore.js, src/portal/wiring.js,
// workflows/README.md, docs/use-cases/UC-02.md and deploy/cx-apis/README.md —
// a comment stating a fact about infrastructure ages silently, because nothing
// fails and no test goes red.
//
// So UC-02's duplicate gate on the n8n path was not refusing correctly; it was
// structurally incapable of firing, which is indistinguishable from healthy
// under every negative test. See docs/BUILD-LOG.md §3.39.
//
// WHAT THIS NODE DOES
//
// It interprets the rows "Fetch Receipt Matches (Supabase)" returned and hands
// the gates ONE item of the shape they already expect (`{duplicate}`), plus the
// hashes the gates and the persist node carry forward.
//
// PRECEDENCE MIRRORS src/uc02/workflow.js EXACTLY:
//
//   (receiptHash ? findByReceiptHash(receiptHash) : null) ??
//   (derived     ? findByReceiptHash(derived)     : null)
//
// — the submitter's own hash first, the derived fingerprint second, and within
// each the EARLIEST row, because §7's answer is "which expense was this one a
// duplicate OF" and that is the first one filed. The Supabase node is ordered
// `created_at.asc` so `find()` on the returned array is that same "earliest".
//
// WHY A CODE NODE SITS BETWEEN THE QUERY AND THE GATES
//
// Two reasons, both learned the hard way in this repo:
//   1. A Supabase node emits ROWS, not our context — the same reason
//      "Carry Context After Claim" exists. Anything downstream reading $json
//      would see an expense row where it expects a decision context.
//   2. A query returning zero rows emits ZERO ITEMS, and a node with no input
//      is SKIPPED, silently taking the rest of the graph with it. The query
//      node therefore carries `alwaysOutputData: true` (which emits one EMPTY
//      item instead), and this node — a Code node, which always returns exactly
//      what it says it returns — is what guarantees the chain's shape is
//      identical whether the lookup matched or not. A "no duplicate" run and a
//      "duplicate found" run must differ in exactly one field and nothing else.
//
// Runs inside n8n's sandbox: no imports, no network. `$()` is provided by n8n
// (and mocked by the parity test). All upstream data is read by named node
// lookups, so the body never depends on graph ordering or fan-in shape.
// ---------------------------------------------------------------------------

var context = $('Derive Receipt Fingerprint').first().json;

// `.all()` rather than `.first()`: both candidate hashes are queried in one
// ORed read, so the answer to "did the SUBMITTED hash match" can only be found
// by looking at every returned row's own `receipt_hash`, not at row zero.
var items = $('Fetch Receipt Matches (Supabase)').all();

// Rows that are actually rows. With `alwaysOutputData: true` a zero-result
// query emits one empty item, and an `onError` item would carry `error`
// instead — neither is a stored expense, and neither may be read as one.
var rows = [];
for (var i = 0; i < items.length; i += 1) {
  var json = items[i] ? items[i].json : null;
  if (json && typeof json.receipt_hash === 'string' && json.receipt_hash) rows.push(json);
}

/** The earliest row stored under exactly this key, or null. */
function earliestMatching(key) {
  if (!key) return null;
  for (var j = 0; j < rows.length; j += 1) {
    if (rows[j].receipt_hash === key) return rows[j];
  }
  return null;
}

var submittedMatch = earliestMatching(context.receiptHash);
var derivedMatch = earliestMatching(context.derivedReceiptHash);
var duplicate = submittedMatch || derivedMatch || null;

// WHICH key caught it — recorded because "flagged as a duplicate" and "flagged
// as a duplicate BY A FINGERPRINT THE SUBMITTER NEVER SUPPLIED" are different
// facts to a human reviewing the block, and only the second one proves the
// F-24 always-on fallback is doing work.
var duplicateMatchedOn = submittedMatch
  ? 'submitted_receipt_hash'
  : derivedMatch
    ? 'derived_receipt_fingerprint'
    : null;

return [
  {
    json: Object.assign({}, context, {
      duplicate: duplicate,
      duplicateMatchedOn: duplicateMatchedOn,
      duplicateOfId: duplicate ? duplicate.id || null : null,
      duplicateOfExternalRef: duplicate ? duplicate.external_ref || null : null,
      // How many stored expenses carry either key. Zero on the overwhelming
      // majority of runs, and the number a human checks first when asking
      // "did the lookup actually run?" — the question the placeholder body
      // made unanswerable.
      receiptMatchCount: rows.length,
    }),
    pairedItem: { item: 0 },
  },
];
