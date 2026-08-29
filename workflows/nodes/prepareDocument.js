// ---------------------------------------------------------------------------
// prepareDocument.js — body of the "Prepare Document" n8n Code node
// ---------------------------------------------------------------------------
// rca-uim / DRIFT-086: the deployed auto_resolve chain was
// Render Letter -> Reply + Solve Ticket, with NOTHING between rendering the
// letter and posting it publicly to the customer. No copy was ever stored —
// invariant 12 ("no documents row on a refusal") passed for the wrong reason,
// because there was never a documents row on ANY path, auto_resolve included.
//
// This node sits between them (with "Persist Document" — the Supabase write —
// immediately after it), and mirrors src/uc01/workflow.js STEP 7b
// (caseStore.createDocument()) exactly: a documents row needs case_id, type,
// content and a sha256 of the content, and it must be written BEFORE the
// Zendesk reply, for the identical reason "Append Audit Log" already runs
// ahead of "Route by Decision" — nothing customer-facing may precede the
// durable write.
//
// SHA-256 IS HAND-WRITTEN AND DEPENDENCY-FREE, same reasoning and the same
// implementation as workflows/nodes-uc02/deriveReceiptFingerprint.js's
// sha256Hex/utf8Bytes: an n8n Code node has no imports, and this sandbox is
// not guaranteed to expose `crypto`. Depending on it would make the stored
// hash silently environment-dependent — the same class of defect as the
// missing persist step this node exists to close.
// test/uc01PersistDocumentParity.test.js proves this copy byte-equal to
// node:crypto's createHash("sha256") for a range of inputs, and proves the
// whole node's output matches src/shared/caseStore.js#createDocument()'s own
// {type, content, contentHash} shape for the same letter.
//
// FAILS CLOSED. No caseId or no letterHtml on the context throws rather than
// writing a documents row with a null case_id (documents.case_id is a NOT
// NULL foreign key onto cases.id — the write would fail at Postgres anyway,
// but throwing here names the actual cause instead of a generic Supabase
// error) or silently skipping the persist and posting an unstored letter,
// which is the exact defect this node exists to close.
// ---------------------------------------------------------------------------

// --- sha256, dependency-free (ported from deriveReceiptFingerprint.js) -----

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
 * pathological employee/entity name cannot make the two execution paths'
 * hashes disagree.
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

// --- the document -------------------------------------------------------

const ctx = $input.first().json;

// FAILS CLOSED: only reached on the auto_resolve branch, where both fields
// are guaranteed by "Render Letter" (it throws first if legalEntity is
// missing) and "Carry Context Forward" (it now always sets caseId, from
// "Persist Case", ahead of this node) — but this node must not assume the
// graph upstream of it stays correct forever. A silent skip here is a letter
// posted with no durable copy, which is the exact defect DRIFT-086 named.
if (!ctx.caseId) {
  throw new Error(
    'Prepare Document: no caseId on context. "Persist Case" must run, and ' +
    '"Carry Context Forward" must carry its id, before "Render Letter".'
  );
}
if (typeof ctx.letterHtml !== 'string' || ctx.letterHtml.length === 0) {
  throw new Error('Prepare Document: no letterHtml on context — nothing to persist.');
}

const documentType = 'employment_verification_letter';
const documentContentHash = sha256Hex(ctx.letterHtml);

return [{ json: Object.assign({}, ctx, { documentType, documentContentHash }) }];
