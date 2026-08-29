// ---------------------------------------------------------------------------
// deriveReceiptFingerprint.js — body of UC-02's "Derive Receipt Fingerprint"
// n8n Code node
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
//
// UC-02's duplicate-receipt gate (UC-02.md §7) needs something to look up. On
// the n8n path it had nothing: the node named "Check Duplicate Receipt
// (Supabase)" was a Code node whose entire body was
// `return [{ json: { duplicate: null } }]`, so the gate did not refuse
// correctly — it was structurally incapable of firing. That is the failure
// this repo keeps paying for (CLAUDE.md §4's through-line, §5's methodological
// lesson): a gate that cannot reach its outcome and a gate that is being
// appropriately cautious produce byte-identical output under every negative
// test, because "correctly found no duplicate" and "cannot find a duplicate"
// are the same sentence from outside. Only a POSITIVE test tells them apart —
// file the same receipt twice, the second MUST be flagged.
//
// This node computes the lookup KEYS. The Supabase node after it performs the
// read, and "Check Duplicate Receipt (Supabase)" interprets the result.
// Splitting it three ways is not ceremony: an n8n Code node has no network, so
// the query cannot live here, and a Supabase node emits its own rows rather
// than our context, so the interpretation cannot live there.
//
// TWO KEYS, AND WHY THE DERIVED ONE IS PREFERRED
//
// An expense carries at most two dedupe keys:
//   1. `receiptHash` — the platform's own fingerprint of the receipt IMAGE,
//      supplied by the submitter. Optional, and on the Zendesk intake path
//      always absent (normalizeExpenseSubmission.js sets it to null: a ticket
//      carries no image hash).
//   2. the fingerprint DERIVED here from the expense record's own fields
//      (finding F-24). Always present when the record resolved, computed
//      server-side from data the submitter does not choose.
//
// `src/uc02/expenseStore.js` persists `derived ?? submitted` into the single
// `receipt_hash` column, and this node must agree with it exactly or the two
// execution paths would file the same expense under two different keys and never
// collide. Derived-preferred because it is the only SYMMETRIC choice: the
// derived fingerprint is a pure function of the expense record, so two filings
// of one expense produce the same key whether or not either supplied a hash.
// Submitted-preferred would make duplicate detection depend on which of the
// two expenses happened to arrive first, and an order-dependent control is worse
// than one with a named gap.
//
// THE MATERIAL IS COPIED FROM src/uc02/workflow.js's deriveReceiptFingerprint()
// AND MUST STAY IDENTICAL. Same six fields, same order, same NUL separator,
// same sha256, same 32-hex truncation, same `derived:` prefix. The parity test
// (test/n8nUc02Parity.test.js) runs THIS body and compares its output against
// the real function's for every mock-server expense, so a divergence is caught
// rather than discovered as a dedupe that silently never matches.
//
// The expense id is deliberately NOT part of the material — two different
// expense records carrying one receipt is precisely the case worth catching —
// and neither is `submitted_at`, nor the receipt file ids, which differ per
// upload even when the underlying document is the same.
//
// WHY SHA-256 IS HAND-WRITTEN HERE
//
// An n8n Code node runs with no imports (see the header of expenseGates.js —
// the same rule every node body in this repo follows) and this instance's
// sandbox is not guaranteed to expose `crypto`. Depending on it would make the
// dedupe key silently environment-dependent, which is the same class of defect
// as the placeholder it replaces. So the digest is computed in plain
// JavaScript, and the parity test proves byte-equality with `node:crypto`'s
// `createHash("sha256")` rather than asserting it in prose.
//
// Runs inside n8n's sandbox: no imports, no network. `$()` is provided by n8n
// (and mocked by the parity test). All upstream data is read by named node
// lookups, so the body never depends on graph ordering or fan-in shape.
// ---------------------------------------------------------------------------

// --- sha256, dependency-free ------------------------------------------------

var SHA256_K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

/**
 * UTF-8 encode a JS string to a byte array, matching Buffer.from(str, "utf8")
 * — including its replacement of an unpaired surrogate with U+FFFD, so a
 * pathological expense title cannot make the two execution paths disagree.
 */
function utf8Bytes(str) {
  var out = [];
  for (var i = 0; i < str.length; i += 1) {
    var c = str.charCodeAt(i);
    if (c < 0x80) {
      out.push(c);
    } else if (c < 0x800) {
      out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
    } else if (c >= 0xd800 && c <= 0xdbff) {
      var next = i + 1 < str.length ? str.charCodeAt(i + 1) : 0;
      if (next >= 0xdc00 && next <= 0xdfff) {
        var cp = 0x10000 + ((c - 0xd800) << 10) + (next - 0xdc00);
        out.push(
          0xf0 | (cp >> 18),
          0x80 | ((cp >> 12) & 0x3f),
          0x80 | ((cp >> 6) & 0x3f),
          0x80 | (cp & 0x3f)
        );
        i += 1;
      } else {
        out.push(0xef, 0xbf, 0xbd); // lone high surrogate -> U+FFFD
      }
    } else if (c >= 0xdc00 && c <= 0xdfff) {
      out.push(0xef, 0xbf, 0xbd); // lone low surrogate -> U+FFFD
    } else {
      out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
    }
  }
  return out;
}

/** SHA-256 of a UTF-8 string, lowercase hex. */
function sha256Hex(str) {
  var bytes = utf8Bytes(str);
  var byteLength = bytes.length;

  // Padding: 0x80, then zeros, then the 64-bit big-endian bit length.
  bytes.push(0x80);
  while (bytes.length % 64 !== 56) bytes.push(0x00);
  // `byteLength * 8` exceeds 32 bits only above 512MB, which no expense field
  // reaches; the high word is carried anyway so the padding is correct rather
  // than correct-in-practice.
  var bitsHi = Math.floor(byteLength / 536870912);
  var bitsLo = (byteLength * 8) >>> 0;
  bytes.push((bitsHi >>> 24) & 0xff, (bitsHi >>> 16) & 0xff, (bitsHi >>> 8) & 0xff, bitsHi & 0xff);
  bytes.push((bitsLo >>> 24) & 0xff, (bitsLo >>> 16) & 0xff, (bitsLo >>> 8) & 0xff, bitsLo & 0xff);

  var h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a;
  var h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;

  var w = new Array(64);
  for (var offset = 0; offset < bytes.length; offset += 64) {
    for (var t = 0; t < 16; t += 1) {
      var b = offset + t * 4;
      w[t] = ((bytes[b] << 24) | (bytes[b + 1] << 16) | (bytes[b + 2] << 8) | bytes[b + 3]) >>> 0;
    }
    for (var t2 = 16; t2 < 64; t2 += 1) {
      var x = w[t2 - 15];
      var y = w[t2 - 2];
      var s0 = (((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3)) >>> 0;
      var s1 = (((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10)) >>> 0;
      w[t2] = (w[t2 - 16] + s0 + w[t2 - 7] + s1) >>> 0;
    }

    var a = h0, bb = h1, c2 = h2, d = h3, e = h4, f = h5, g = h6, hh = h7;
    for (var t3 = 0; t3 < 64; t3 += 1) {
      var S1 = (((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7))) >>> 0;
      var ch = ((e & f) ^ (~e & g)) >>> 0;
      var temp1 = (hh + S1 + ch + SHA256_K[t3] + w[t3]) >>> 0;
      var S0 = (((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10))) >>> 0;
      var maj = ((a & bb) ^ (a & c2) ^ (bb & c2)) >>> 0;
      var temp2 = (S0 + maj) >>> 0;
      hh = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c2;
      c2 = bb;
      bb = a;
      a = (temp1 + temp2) >>> 0;
    }

    h0 = (h0 + a) >>> 0;
    h1 = (h1 + bb) >>> 0;
    h2 = (h2 + c2) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
    h5 = (h5 + f) >>> 0;
    h6 = (h6 + g) >>> 0;
    h7 = (h7 + hh) >>> 0;
  }

  var words = [h0, h1, h2, h3, h4, h5, h6, h7];
  var hex = '';
  for (var i2 = 0; i2 < words.length; i2 += 1) {
    var word = words[i2];
    for (var shift = 28; shift >= 0; shift -= 4) {
      hex += ((word >>> shift) & 0xf).toString(16);
    }
  }
  return hex;
}

// --- the fingerprint --------------------------------------------------------

/**
 * Byte-for-byte the same computation as src/uc02/workflow.js's
 * deriveReceiptFingerprint(). Returns null when no expense record resolved —
 * there is nothing to fingerprint, which is a different fact from "no
 * duplicate" and is carried as such.
 */
function deriveReceiptFingerprint(expense) {
  if (!expense || typeof expense !== 'object') return null;
  var material = [
    expense.employment_id,
    expense.amount,
    expense.currency ? expense.currency.code : undefined,
    expense.tax_amount,
    expense.expense_date,
    expense.title,
  ]
    .map(function (value) {
      return String(value === null || value === undefined ? '' : value);
    })
    .join('\u0000'); // NUL as an unambiguous field separator: it can never
  // appear inside an expense field, so two different field splits can never
  // hash to the same material. Written as an escape, never a literal NUL byte
  // — a raw control character in source silently survives grep, `file` and
  // most diffs as "binary", and one editor round-trip that strips it would
  // change every derived receipt hash with nothing to show in the diff.
  return 'derived:' + sha256Hex(material).slice(0, 32);
}

/**
 * A lookup key must be safe to place inside PostgREST's `or=(col.eq.X,…)`
 * grammar, where `,` `.` `(` `)` and quotes are structural. Derived
 * fingerprints are `derived:` + hex and always pass. A SUBMITTED hash is
 * caller-controlled, so anything outside this charset is dropped rather than
 * escaped — a value that cannot be a receipt fingerprint is not one, and
 * dropping it is recorded on the item instead of silently widening the query.
 */
function isSafeKey(value) {
  return typeof value === 'string' && /^[A-Za-z0-9:_-]{1,200}$/.test(value);
}

var request = $('Normalize Expense Submission').first().json;
var expenseRaw = $('Fetch Expense (Remote)').first().json;

// The same envelope normalization expenseGates.js performs, so both nodes
// fingerprint the SAME record. A failed read (onError: continueRegularOutput
// hands this node an error object in place of the record) yields null here and
// the gates node reports it as an upstream failure — this node never has to
// know about that, it just has nothing to fingerprint.
var expense =
  (expenseRaw && expenseRaw.data && expenseRaw.data.expense) ||
  (expenseRaw && expenseRaw.data) ||
  (expenseRaw && expenseRaw.expense) ||
  null;

var submittedReceiptHash = request.receiptHash ? String(request.receiptHash) : null;
var derivedReceiptHash = deriveReceiptFingerprint(expense);

// The value that WOULD be persisted for this expense — derived-preferred, and
// the same expression src/uc02/expenseStore.js's dedupeKey() uses. The gates
// node carries it forward and the persist node writes it, so the key an expense
// is stored under and the keys it is looked up by are computed in one place.
var dedupeKey = derivedReceiptHash || submittedReceiptHash || null;

var submittedUsable = isSafeKey(submittedReceiptHash);
var submittedDropped = submittedReceiptHash !== null && !submittedUsable;

// EXACTLY TWO candidates, always. The Supabase node after this one is
// configured with two `receipt_hash eq` conditions ORed together, and an
// expression resolving to undefined there would query for an empty string
// rather than "skip this condition" — so the second slot is padded with the
// first when there is only one real key. `eq.X or eq.X` is simply `eq.X`.
var candidates = [];
if (submittedUsable) candidates.push(submittedReceiptHash);
if (derivedReceiptHash) candidates.push(derivedReceiptHash);

// Nothing to look up at all (no expense record AND no usable submitted hash).
// A key that can never match is used rather than skipping the query, so the
// chain's shape is identical on every path and the interpreting node sees a
// consistent input. It is recorded on the item as `lookupPossible: false`.
var lookupPossible = candidates.length > 0;
if (!lookupPossible) candidates.push('unfingerprintable:no-expense-record');
while (candidates.length < 2) candidates.push(candidates[0]);

return [
  {
    json: Object.assign({}, request, {
      receiptHash: submittedReceiptHash,
      derivedReceiptHash: derivedReceiptHash,
      dedupeKey: dedupeKey,
      hashCandidates: candidates.slice(0, 2),
      lookupPossible: lookupPossible,
      // Visible rather than silent: a submitted hash that could not be used as
      // a lookup key is a fact a human triaging a missed duplicate needs.
      submittedReceiptHashDropped: submittedDropped,
    }),
    pairedItem: { item: 0 },
  },
];
