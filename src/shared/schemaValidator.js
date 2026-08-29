// ---------------------------------------------------------------------------
// schemaValidator.js  —  Dynamic per-country schema validation
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
// Remote does not use one fixed set of employment fields. Each country has its
// own required fields (tax IDs, national insurance numbers, local address
// shapes). Before writing anything back to Remote, you must fetch that
// country's schema and check your payload against it. Guessing the fields is
// how you create invalid or non-compliant records.
//
// UC-01 (letters) doesn't write to Remote, so it doesn't need this — but UC-05,
// UC-06, UC-07, UC-09 do. It lives in the shared layer so they all reuse it.
//
// This is a PRESENCE validator: it checks that every field in `required` is
// satisfied. It does not check types, formats or bounds. See "the depth this
// validator does NOT have" at the bottom before reaching for it in a new gate.
// ---------------------------------------------------------------------------
//
// `null` IS A LEGAL VALUE OF A REQUIRED FIELD, AND THIS USED TO CALL IT MISSING
//
// The whole body of this function used to be
//     value === undefined || value === null || value === ""  ->  missing
// which folds three different states into one. Remote's live form schemas do
// not agree that they are the same state. On the contract-amendment form —
// the form UC-06 actually writes through — `effective_date` is in `required`
// AND typed `["string","null"]`, on every one of the four demo countries whose
// schema answers. A payload Remote accepts came back `schema_invalid` here.
//
// The direction was safe: a spurious `schema_invalid` escalates rather than
// writes. But the RECORDED REASON named the wrong cause, and a wrong reason is
// what a human then acts on — the same failure this repo has now paid for in
// UC-03's `destination_unknown` and in the swallowed-upstream-failure work.
// "We never got a value" and "you gave us the value the form permits" are
// different answers and must stay different.
//
// Evidence, first-hand and dated (do not re-derive this from memory):
//   docs/knowledge/layer-2-remote/L2-09-contract-amendment-schemas-demo-four.md
//     GET /v1/contract-amendments/schema — NLD eor (sha256 2d14aa5f…), NLD gpe
//     (f4e69fc2…), PRT eor (6cc35603…), CAN gpe (36f050ef…), live 2026-08-19.
//     `effective_date`: type ["string","null"], format date, in `required` on
//     all four.  <- the only field CONFIRMED both required and nullable.
//   docs/knowledge/layer-2-remote/L2-08-country-form-schemas-demo-four.md §3
//     contract_details — PRT/CAN `probation_length` ["number","null"] and USA
//     `flsa_classification` ["string","null"] (null an explicit `oneOf`
//     member). Both are nullable but NOT in the top-level `required` list, so
//     today they never reach the loop below. They become reachable the moment
//     an `allOf` branch requires them — which is precisely the depth this file
//     does not have. See the closing note.
//
// WHAT THE FIX IS, EXACTLY — and what it deliberately is not:
//
//   undefined / key absent  ->  MISSING.        Unchanged. A required field
//                                               nobody supplied is still a
//                                               refusal, always.
//   ""                      ->  MISSING.        Unchanged, and deliberately
//                                               stricter than JSON Schema. A
//                                               blank string reaching a Remote
//                                               write is a caller bug; Remote
//                                               answers `422 "can't be blank"`
//                                               for it, so calling it
//                                               satisfied would only move the
//                                               refusal later and further away.
//   null, schema SAYS null is legal   ->  SATISFIED.   <- the fix.
//   null, schema SILENT               ->  MISSING.     Unchanged.
//   null, schema says null is illegal ->  MISSING.     Unchanged.
//
// So nullability is OPT-IN, evidenced by the schema itself, and every other
// path keeps the behaviour it had. That asymmetry is on purpose: this function
// is called with two very different kinds of argument. `RemoteClient`'s
// `getCountrySchema()` / `getContractAmendmentSchema()` return the WHOLE live
// schema, `properties` included, so nullability is visible. But
// `src/uc02/server.js` passes a hand-written `{required: [...]}` with no
// properties at all, and `src/uc06/policyEngine.js` passes
// `{required: effectiveRequired}` — a synthesized object that DROPS the
// properties it was derived from. If "silent" meant "null is fine", a `null`
// expenseId would sail through UC-02's submission gate. A validator may only
// become more permissive where a source of truth says so.
//
// KNOWN, UNFIXED, AND NOT FIXABLE FROM THIS FILE: because UC-06's call site
// synthesizes `{required: effectiveRequired ?? countrySchema.required}`, the
// live `effective_date` case above still reports `missing_effective_date`
// there. The one-line change that closes it belongs to that file's owner:
//     validateAgainstSchema(payload, { ...countrySchema, required: effectiveRequired ?? countrySchema.required })
// which keeps `properties` alongside the effective required list. Recorded
// here rather than done quietly across an ownership boundary.
// ---------------------------------------------------------------------------

/**
 * Does this property's schema permit `null` as a value?
 *
 * Exported because the answer is evidence, not an implementation detail — a
 * gate that wants to say "present, and legally null" rather than "missing" can
 * ask the same question this file asks, instead of re-deriving it.
 *
 * Every form below appears in a live Remote schema (L2-08/L2-09) except
 * `nullable: true`, which is OpenAPI 3.0's spelling and is accepted so a
 * schema fetched from a different Remote surface is not silently misread.
 *
 * ANYTHING NOT UNDERSTOOD ANSWERS `false`, including an unresolved `$ref`.
 * "We do not know" and "null is legal" are not the same answer, and only one
 * of them is safe to guess — the same rule `src/uc06/policyEngine.js`'s
 * condition resolver learned the expensive way, pointed the other direction:
 * there an unmodelled condition must not select a branch; here an unmodelled
 * type must not grant a permission.
 *
 * @param {object|undefined|null} property  one entry of a schema's `properties`
 * @returns {boolean}
 */
export function permitsNull(property) {
  if (!property || typeof property !== "object") return false;

  // {"type": "null"} and the union form {"type": ["string", "null"]} — the two
  // shapes Remote's live forms actually use.
  const { type } = property;
  if (type === "null") return true;
  if (Array.isArray(type) && type.includes("null")) return true;

  // OpenAPI 3.0's nullable flag, for schemas that come from that dialect.
  if (property.nullable === true) return true;

  // `null` as an explicit member of a choice. USA `flsa_classification` is
  // exactly this shape: a `oneOf` whose members include {"type": "null"}.
  //
  // `allOf` is NOT in this list, and its absence is the point: `oneOf`/`anyOf`
  // are satisfied by ONE branch, so a null-typed member is a permission, while
  // `allOf` requires EVERY branch, so the same member proves nothing on its
  // own. Reading it the same way would be a loosening dressed as symmetry.
  for (const key of ["oneOf", "anyOf"]) {
    const branches = property[key];
    if (Array.isArray(branches) && branches.some((b) => permitsNull(b))) return true;
  }

  // `null` as an enumerated or constant value.
  if (Array.isArray(property.enum) && property.enum.includes(null)) return true;
  if (Object.prototype.hasOwnProperty.call(property, "const") && property.const === null) return true;

  return false;
}

/**
 * @param {object} payload  the data you intend to send to Remote
 * @param {object} schema   the country/form schema. `{required: string[]}` at
 *   minimum; pass the WHOLE schema (with `properties`) whenever you have it, or
 *   nullability is invisible and every `null` is reported as missing.
 * @returns {{valid: boolean, missing: string[]}}
 *   `missing` is "required fields this payload does not satisfy". That includes
 *   a field present with an illegal `null` — reported by name rather than as a
 *   bare `valid: false`, because the field name is what the caller turns into a
 *   flag. The return SHAPE is fixed at these two keys on purpose: callers
 *   deep-equal it.
 */
export function validateAgainstSchema(payload, schema) {
  const required = (schema && schema.required) || [];
  const properties = schema && typeof schema.properties === "object" && schema.properties !== null ? schema.properties : null;

  const missing = required.filter((field) => {
    const value = payload?.[field];
    if (value === undefined || value === "") return true;
    if (value === null) return !permitsNull(properties?.[field]);
    return false;
  });

  return { valid: missing.length === 0, missing };
}

// ---------------------------------------------------------------------------
// THE DEPTH THIS VALIDATOR DOES NOT HAVE — read before using it in a new gate
//
// It reads `schema.required` and, now, `schema.properties[field].type`. It
// reads nothing else. It cannot see:
//   - the 81 conditional `allOf` rules on the live USA `contract_details` form,
//     or the 72 on Canada's (L2-08 §3);
//   - any `minimum` — including the 34 US per-state hourly minimum-wage floors
//     in ×100 minor units, and the Dutch full-time annual floors (L2-08 §5,
//     L2-09);
//   - a `properties: {x: false}` prohibition, where carrying a field through
//     "because we have it" is itself a rejection.
//
// `src/uc06/policyEngine.js#effectiveSchema()` DOES resolve `if`/`then`/`else`
// including numeric bounds, and answers `null` — neither branch — for a
// condition it does not model. Five use cases reach for the shallow shared one.
// Closing that gap means lifting `effectiveSchema()` down into this file and
// having UC-06 import it; it is deliberately NOT done here, because resolving a
// conditional branch wrongly makes validation STRICTER than Remote and starts
// refusing valid payloads — a new failure, not a fix — and because the correct
// semantics already exist, tested, in a file this change does not own.
// ---------------------------------------------------------------------------
