// ---------------------------------------------------------------------------
// publicReference.js — an identifier a person can read out loud
// ---------------------------------------------------------------------------
// WHY. A UUID is a database key. Printed in the middle of a customer-facing
// sentence it is noise: nobody outside this system can look it up, it cannot be
// read over a phone, and it makes a page written for a customer look like a
// debug dump — which is what the project owner found when they opened the ZAF
// sidebar to show it to an audience.
//
// The short form is not an invention: it is the form this project already uses
// in its own records and write-ups ("audit_log 0544fbe5", "cases ec0f6836"). It
// is enough to find the row, and the FULL id is never destroyed — it stays on
// the record and on the append-only audit row, which is where an exact key
// belongs.
//
// NOT A HASH AND NOT A NEW IDENTIFIER. It is a prefix of the real id, so it
// still resolves by prefix search and cannot name a record that does not exist.
// Anything that is not a UUID is returned unchanged: an email address, a
// session name or a ticket number is already readable, and truncating one would
// destroy information rather than hide noise.
// ---------------------------------------------------------------------------

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * @param {unknown} id
 * @returns {string} the first block of a UUID, or the input unchanged
 */
export function shortReference(id) {
  const s = id == null ? "" : String(id).trim();
  if (!UUID.test(s)) return s;
  return s.slice(0, 8);
}

/** True when `id` is a UUID, i.e. when shortening it actually hides something. */
export function isOpaqueIdentifier(id) {
  return UUID.test(String(id ?? "").trim());
}
