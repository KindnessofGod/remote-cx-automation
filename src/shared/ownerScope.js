// ---------------------------------------------------------------------------
// ownerScope.js  —  "is this row this requester's?", in one predicate
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
// Seven stores gained a `listByOwner()` at the same time, for the same reason
// (src/portal/server.js's "My requests"), and each of them needs the identical
// in-memory predicate before it decides whether to read Postgres at all. Seven
// copies of a four-line ownership check is seven places one of them can be
// written with `||` where the others have `&&` — and an ownership check that
// is too WIDE fails silently: it returns somebody else's rows, and every test
// that only asserts "my row is in the list" still passes.
//
// So the predicate lives once. It knows only the three field names that are
// genuinely uniform across all seven row shapes (`employmentId`, `requester`,
// `source`); it knows no table, no column list and no SQL, all of which differ
// per store and stay in the store that owns them.
//
// FAIL CLOSED IS THE POINT. An unscoped call — neither an employment nor a
// requester — matches NOTHING rather than everything. The natural way to write
// "apply each filter if it was given" is a chain of `if (x && …) return false`
// with a `return true` at the end, and that idiom answers `true` for the empty
// scope, which is the one answer that must never be given: it turns "who is
// this?" into "list every requester's requests".
// ---------------------------------------------------------------------------

/**
 * Does this row belong to the owner named by `scope`?
 *
 * Every supplied field must match (AND, never OR): an owner scope narrows, and
 * a second condition that could WIDEN it would defeat the first.
 *
 * @param {object} row  a store row, in its camelCase in-memory shape
 * @param {object} scope
 * @param {string|null} [scope.employmentId]  the employment the row is about
 * @param {string|null} [scope.requester]     who filed it (stores that keep one)
 * @param {string|null} [scope.source]        e.g. "portal" — which surface filed it
 * @returns {boolean}
 */
export function matchesOwner(row, { employmentId = null, requester = null, source = null } = {}) {
  // See the header: no owner named means no rows, never all rows.
  if (!employmentId && !requester) return false;
  if (!row) return false;
  if (employmentId && String(row.employmentId ?? "") !== String(employmentId)) return false;
  if (requester && String(row.requester ?? "") !== String(requester)) return false;
  if (source && String(row.source ?? "") !== String(source)) return false;
  return true;
}
