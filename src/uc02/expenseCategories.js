// ---------------------------------------------------------------------------
// expenseCategories.js  —  what counts as a category an expense may be filed under
// ---------------------------------------------------------------------------
// WHY THIS EXISTS AS ITS OWN PURE MODULE
// The category gate is the one thing standing between an LLM's guess and a real
// reimbursement write: `policyEngine.js` gate 7 refuses anything the employee's
// own active list does not contain. That gate is only as good as the notion of
// "contains", and the previous notion was
//
//     categoryList.some(c => c.id === classification.categoryId)
//
// which could never be true, because a REAL Remote category row has no `id`
// field at all. Confirmed against the live sandbox 2026-08-17 — a row is:
//
//   {
//     code: "business_travel.accommodation",       // the stable identifier
//     parent: { code, title, slug } | null,        // null on a top-level node
//     scope: "global",                             // global|country|company|legal_entity
//     status: "active",                            // active|inactive
//     instructions: null,
//     description: "Hotel or other lodging during your trip.",
//     title: "Accommodation",                      // human-readable name
//     prompt: null,
//     slug: "17fde76f-a927-4463-84eb-b7a9e69fc8b6",// per-account UUID
//     is_selectable: true                          // leaves true, parents false
//   }
//
// `code` is the identifier this system keys on, not `slug`: the slug is an
// account-scoped UUID that differs between the sandbox and any production
// account, while the code is stable, human-meaningful and is also what the API
// itself uses to reference a parent. An audit row reading
// "business_travel.accommodation" is reviewable; one reading a UUID is not.
//
// SELECTABILITY IS A SAFETY PROPERTY, NOT A DISPLAY DETAIL. Remote's docs:
// "Leaf nodes have `is_selectable: true`; parent nodes are excluded unless
// `include_parents=true`." A parent node is a heading — an employee cannot file
// against one, so an expense auto-approved into one would be approving something
// the platform itself would refuse. Same for `status: "inactive"`: a retired
// category is not a category this automation may spend against.
//
// FAILS CLOSED ON EVERY UNKNOWN, deliberately. The default live response
// already contains only active, selectable leaves — so on today's data these
// checks are redundant, and that is exactly why they are written explicitly
// rather than assumed. `include_parents=true`, a future API change, a fixture
// drifting, or a caller reusing this list for something else all turn the
// assumption false silently. A missing `is_selectable` is not "probably fine";
// it is not selectable.
// ---------------------------------------------------------------------------

/**
 * May an expense be filed under this category row?
 *
 * Strict equality on both flags, on purpose: `is_selectable: "false"` (a string)
 * and `is_selectable: undefined` are both truthy-or-absent traps that a loose
 * check would wave through. Only a real boolean `true` and the literal status
 * `"active"` pass.
 *
 * @param {unknown} row a category row as returned by GET /v1/expenses/categories
 * @returns {boolean}
 */
export function isSelectableCategory(row) {
  if (!row || typeof row !== "object") return false;
  if (typeof row.code !== "string" || row.code === "") return false;
  return row.status === "active" && row.is_selectable === true;
}

/**
 * The subset of a fetched list an expense may actually be filed under.
 *
 * Used in two places, and it is the same reasoning both times: the gate
 * validates against it, AND the classifier is only ever *shown* it. Never
 * offering the model a category it may not pick removes the precondition for
 * that whole class of mistake, instead of catching it afterwards — the same
 * move `handleTaxInquiry()` makes by not accepting a write-capable client.
 *
 * @param {unknown} list
 * @returns {object[]}
 */
export function selectableCategories(list) {
  return (Array.isArray(list) ? list : []).filter(isSelectableCategory);
}

/**
 * Look one category up by its `code`, returning it ONLY if an expense may be filed
 * under it. Returns null for an unknown code, an inactive row, a parent node,
 * and — because the lookup is a Map built from own entries rather than a
 * property access — for `"constructor"`, `"toString"` and every other
 * Object.prototype member (the F-12b lesson, applied to the category list too).
 *
 * @param {unknown} list
 * @param {unknown} code
 * @returns {object|null}
 */
export function findSelectableCategory(list, code) {
  if (typeof code !== "string" || code === "") return null;
  const byCode = new Map(selectableCategories(list).map((row) => [row.code, row]));
  return byCode.get(code) ?? null;
}

/**
 * The gate's actual question, named: is this classification's category one the
 * employee could really file under?
 *
 * @param {unknown} list
 * @param {unknown} code
 * @returns {boolean}
 */
export function isCategoryFileable(list, code) {
  return findSelectableCategory(list, code) !== null;
}
