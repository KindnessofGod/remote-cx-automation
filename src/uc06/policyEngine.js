// ---------------------------------------------------------------------------
// policyEngine.js  —  UC-06's deterministic gates
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
// Same role as src/uc01/policyEngine.js: this is the system's judgment, and
// it contains no AI. Ordered gates, first failure wins — "when in doubt,
// reduce automation" (the same principle UC-01's identity gate follows):
//
//   0. upstream reads — did every Remote read this decision rests on actually
//                        SUCCEED? A failed read is not a policy refusal (see
//                        shared/upstreamFailure.js, and live execution 4232:
//                        three 404s swallowed, recorded `identity_not_verified`)
//   1. identity      — is the requester an authorized admin for this company?
//   2. employment     — is this employee still active? (can't amend an exit)
//   3. schema         — does the FULL next-state payload satisfy this
//                        country's dynamic required-field schema?
//   4. cutoff         — can the requested effective date still be honored?
//
// Only gate 4 can produce the "urgent" flag rather than a hard escalate —
// every other failure escalates outright, because none of them are things a
// 1-click dual approval should paper over (00-FOUNDATION.md invariant #2:
// "Never assume static fields"; UC-06.md §6: "must NOT... skip cutoff/
// schema/money checks").
// ---------------------------------------------------------------------------

import { validateAgainstSchema } from "../shared/schemaValidator.js";
import { toRemoteInteger } from "../shared/money.js";
import { evaluateCutoff, cyclesCovering, distinctCutoffCount } from "./cutoffEngine.js";
import { amendmentType } from "./changeParser.js";
import { findUpstreamFailure, upstreamVerdict } from "../shared/upstreamFailure.js";
import { bindGateDescriptions } from "../shared/gateLadder.js";

// ---------------------------------------------------------------------------
// THE PAYLOAD IS BUILT AGAINST THE SCHEMA THAT ARRIVED, NOT AGAINST A FIXTURE
// ---------------------------------------------------------------------------
// This function used to emit four fixed keys — {job_title, weekly_hours,
// base_salary, currency} — which are the field names in
// `src/remote/mockServer.js`'s COUNTRY_SCHEMAS, not Remote's. Against a real
// country form that payload is wrong in BOTH directions at once, and the live
// captures below are verbatim from gateway.remote-sandbox.com, 2026-08-18:
//
//   GET /v1/countries/NLD/employment_basic_information -> 200 [CONFIRMED]
//     required   : has_seniority_date, name, job_title, provisional_start_date,
//                  tax_servicing_countries, tax_job_category, login_email
//                  (DEU adds mobile_number; FRA adds ack_non_eligible_job_titles;
//                   GBR/USA/CAN/PRT/SGP are identical to NLD)
//     properties : the seven above + personal_email, seniority_date, work_email
//     additionalProperties: FALSE
//
// So six of seven required fields were missing, and three of the four keys sent
// (weekly_hours, base_salary, currency) are not properties of that form at all
// — under `additionalProperties: false` they are rejections, not harmless
// extras. `schema_invalid` therefore fired on every live amendment, ahead of the
// payroll gate, and UC-06 was not reachable end to end.
//
// WHICH FIELDS COULD BE SOURCED, AND WHICH COULD NOT — the honest list.
// Sourced from the normalized employment record (see CARRY_THROUGH below):
//     job_title <- employment.job_title
//     name <- employment.full_name          (live: basic_information.name)
//     provisional_start_date <- employment.start_date
//     annual_gross_salary / base_salary <- employment.base_salary
//     work_hours_per_week / weekly_hours <- employment.weekly_hours
//     compensation_currency_code / currency <- employment.currency
//     effective_date <- the request's own requestedEffectiveDate
// NOT sourceable today, because `normalizeEmployment()` does not surface them:
//     has_seniority_date, tax_servicing_countries, tax_job_category,
//     login_email, mobile_number
// They are read here under their own names anyway, so a widened normalizer
// needs no change on this side; until then a real amendment escalates
// `schema_invalid` naming exactly those, which is the truthful answer. NOTHING
// IS DEFAULTED OR GUESSED to fill them — `has_seniority_date` carries a schema
// `default: "no"` on DEU and `ack_non_eligible_job_titles` is a human
// attestation ("I confirm that this job title isn't on the list of non-eligible
// titles"); writing either from code would put a guessed value into a payroll
// write, which is what prime directive #1 exists to prevent.
//
// THE FORM WAS ALSO THE WRONG FORM, AND THAT IS NOW FIXED. The paragraph this
// replaces recorded `employment_basic_information` as still-open. It is closed:
// UC-06 validates against `GET /v1/contract-amendments/schema?employment_id=
// &country_code=&form=contract_amendment` and writes through
// `POST /v1/contract-amendments`. Live 2026-08-18, NLD required:
// annual_gross_salary, effective_date, job_title, role_description,
// contract_duration_type, work_schedule, work_hours_per_week [CONFIRMED].
// See src/remote/restClient.js's getContractAmendmentSchema() header for the
// three independent reasons the old pair could never have worked.
//
// WHERE THE VALUES COME FROM NOW. `normalizeEmployment()` carries Remote's own
// `contract_details` and `basic_information` blocks through untouched, and the
// contract-amendment form uses THE SAME FIELD NAMES as `contract_details`
// does — annual_gross_salary, compensation_currency_code, work_hours_per_week,
// work_schedule, contract_duration_type, contract_end_date, role_description,
// experience_level, holiday_allowance are all name-identical, checked field by
// field against the live NLD/DEU/GBR/SGP/CAN/FRA/PRT forms. So a required field
// is looked up under ITS OWN NAME (see sourceValue() below) and this file never
// invents a mapping. A field no block carries stays absent and surfaces as
// `missing_<field>`: live, that is `uk_country` on GB, `schedule_type` and
// `required_qualifications` on DE, `role_description`/`experience_level` on
// several SG and PT records. Nothing is defaulted to fill them.
//
// PROOF THAT THIS SOURCING IS RIGHT, not merely plausible: every active
// non-contractor Sandbox employment was driven through
// `POST /v1/contract-amendments/automatable` — a CHECK that creates nothing —
// with a payload sourced this way and nothing invented. Five NL employments
// (75b88008, 80e3d52f, ce76d3ed, cd3e9ebf, 06537f78) answered **200**; every
// other record answered 422 naming exactly the fields its own record does not
// carry. A 200 there is Remote itself agreeing the payload would be accepted.
// ---------------------------------------------------------------------------

/**
 * Schema field name -> where its value honestly comes from. `ctx` carries the
 * request's own fields (only `requestedEffectiveDate` so far), which are as
 * legitimate a source as the employment record: `effective_date` IS the
 * requested date, not a guess about it.
 *
 * The five entries reading `employment[name]` directly are the fields
 * `normalizeEmployment()` drops today (see the note above). They return
 * undefined against a real record, which surfaces as `missing_<field>` rather
 * than as a fabricated value.
 */
const CARRY_THROUGH = {
  job_title: (e) => e.job_title,
  name: (e) => e.full_name ?? e.name,
  // CAVEAT, worth knowing before trusting this one: normalizeEmployment() sets
  // start_date from basic_information.provisional_start_date and falls back to
  // seniority_date when that is absent, so in the fallback case this carries a
  // seniority date under a start-date name. Not fixable from here.
  provisional_start_date: (e) => e.start_date ?? e.provisional_start_date,
  base_salary: (e) => e.base_salary,
  annual_gross_salary: (e) => e.base_salary,
  currency: (e) => e.currency,
  compensation_currency_code: (e) => e.currency,
  weekly_hours: (e) => e.weekly_hours,
  work_hours_per_week: (e) => e.weekly_hours,
  effective_date: (e, ctx) => ctx.requestedEffectiveDate,
  has_seniority_date: (e) => e.has_seniority_date,
  tax_servicing_countries: (e) => e.tax_servicing_countries,
  tax_job_category: (e) => e.tax_job_category,
  login_email: (e) => e.login_email,
  mobile_number: (e) => e.mobile_number,
  // A SALARY DECREASE NEEDS TWO THINGS NO RECORD CAN SUPPLY, and Remote
  // enforces both server-side rather than through the schema's `allOf` (they
  // fall out of a JSONLogic `x-jsf-logic` block that compares the submitted
  // amount to the CURRENT contract, which this repo does not evaluate). Live
  // 2026-08-18 on NL employment 293527ed-…, identical payloads:
  //   annual_gross_salary 3900000 (increase) -> 200
  //   annual_gross_salary 3600000 (no change) -> 200
  //   annual_gross_salary 3300000 (decrease) -> 422 {"salary_decrease_reason":
  //     ["can't be blank"],"was_employee_informed":["can't be blank"]}
  // Both are human judgements — WHY the pay is being cut, and whether the
  // employee has been told. Neither may be defaulted from code, so they are
  // read from the request and, when the request is silent, reported as
  // `missing_salary_decrease_reason` / `missing_was_employee_informed`. The
  // amendment escalates naming them, which is the honest answer.
  salary_decrease_reason: (e, ctx) => ctx.changes?.salary?.decreaseReason,
  was_employee_informed: (e, ctx) => ctx.changes?.salary?.employeeInformed,
};

/**
 * ONE required field -> its value, looked up under its own name.
 *
 * Order: an explicit CARRY_THROUGH entry first (those encode a genuine rename
 * the API itself performs, e.g. the form's `name` is the record's `full_name`),
 * then the record's own blocks — top level, then `basic_information`, then
 * `contract_details`. All three are Remote's vocabulary, so a hit is Remote
 * agreeing with Remote, not this file guessing.
 *
 * A field none of them carries returns undefined and is left OUT of the
 * payload; validateAgainstSchema() then names it. That is the whole mechanism
 * for "we do not have this value", and it must stay the only one.
 */
function sourceValue(field, employment, ctx) {
  if (field in CARRY_THROUGH) {
    const value = CARRY_THROUGH[field](employment, ctx);
    if (usable(value)) return value;
  }
  const direct = employment?.[field];
  if (usable(direct)) return direct;
  const basic = employment?.basic_information?.[field];
  if (usable(basic)) return basic;
  const contract = employment?.contract_details?.[field];
  if (usable(contract)) return contract;
  return undefined;
}

/**
 * Coerce a value the RECORD supplied to the type the SCHEMA declares for that
 * field — and only in that direction.
 *
 * This is not laxity, it is a real shape mismatch inside Remote's own data:
 * live, `contract_details.work_hours_per_week` is the STRING "24" on one NL
 * record and the NUMBER 40 on another, while the amendment form declares
 * `{"type": "number"}` and the API enforces it —
 *   work_hours_per_week: 24    -> 200
 *   work_hours_per_week: "24"  -> 422 "Type mismatch. Expected Number but got String."
 * [CONFIRMED 2026-08-18]. Submitting Remote's own value back verbatim is
 * therefore rejected by Remote. The schema names the type; this reads it.
 *
 * IT IS DELIBERATELY NOT APPLIED TO A REQUESTED CHANGE. A quoted "39000"
 * arriving from a request portal is still refused outright by CHANGE_TARGETS
 * above, because that string is an unvalidated human input and coercing it is
 * how a 100x scaling error gets in. A string read out of the employment record
 * is a different thing: it is a value Remote already stored and already knows
 * the type of. Only whole numbers survive an `integer` field, and only finite
 * numbers survive a `number` field — anything else is left alone and fails
 * validation loudly rather than being silently reshaped.
 */
function coerceToSchemaType(value, field, countrySchema) {
  const declared = countrySchema?.properties?.[field]?.type;
  const types = Array.isArray(declared) ? declared : [declared];
  if (typeof value !== "string" || value.trim() === "") return value;
  if (!types.includes("number") && !types.includes("integer")) return value;
  const num = Number(value);
  if (!Number.isFinite(num)) return value;
  if (types.includes("integer") && !types.includes("number") && !Number.isInteger(num)) return value;
  return num;
}

/**
 * Resolve a schema's `allOf` if/then/else rules against a candidate payload.
 *
 * WHY THIS IS NOT OPTIONAL. `validateAgainstSchema()` checks the top-level
 * `required` list, and on the real forms that list is only part of the answer:
 * the API enforces the conditionals too, and it enforces them in BOTH
 * directions. Live 2026-08-18, all on active NL employments:
 *   fixed_term  -> `contract_end_date: ["can't be blank"]`
 *   part_time   -> `default_weekly_hours` + `part_time_salary_confirmation`
 *                  `["can't be blank"]`
 *   full_time   -> `part_time_salary_confirmation: ["must be empty"]`
 * A payload that satisfies `required` and ignores `allOf` is a payload the
 * write rejects — the same "passes our checks, fails Remote's" shape this whole
 * pass exists to remove.
 *
 * THE SUPPORTED SUBSET IS EXACTLY WHAT THE LIVE FORMS USE, and no more:
 * `if.properties.<f>.const` (with `if.required`), `then`/`else` `required`
 * lists, and `then`/`else` `properties.<f>: false` meaning "this branch forbids
 * the field". A rule this does not understand is SKIPPED rather than guessed
 * at — an unrecognised rule that silently added a requirement would refuse
 * amendments for a reason nobody could trace, and one that silently dropped a
 * field would send an incomplete payload. Skipping leaves the conservative
 * `required` list intact and lets Remote have the last word.
 *
 * `x-jsf-logic` (JSONLogic computed minimums, e.g. the Dutch part-time salary
 * floor) is NOT evaluated. It is a real constraint and a real gap; the write
 * fails loudly against it rather than this file re-implementing a rules engine.
 *
 * @param {object|null} countrySchema
 * @param {object} payload  the candidate, whose values decide which branch applies
 * @returns {{required: string[], forbidden: Set<string>}}
 */
export function effectiveSchema(countrySchema, payload) {
  const base = Array.isArray(countrySchema?.required) ? countrySchema.required : [];
  const required = new Set(base);
  const forbidden = new Set();
  const rules = Array.isArray(countrySchema?.allOf) ? countrySchema.allOf : [];

  for (const rule of rules) {
    if (!rule || typeof rule !== "object" || !rule.if) continue;
    const holds = matchesCondition(rule.if, payload);
    if (holds === null) continue; // not understood -> neither branch. See below.
    const branch = holds ? rule.then : rule.else;
    if (!branch || typeof branch !== "object") continue;
    if (Array.isArray(branch.required)) {
      for (const field of branch.required) required.add(field);
    }
    if (branch.properties && typeof branch.properties === "object") {
      for (const [field, spec] of Object.entries(branch.properties)) {
        if (spec === false) forbidden.add(field);
      }
    }
  }
  // A field cannot be both. `then.required` is an explicit statement about THIS
  // branch; a `false` reached in the same pass came from a different rule's
  // branch, and the explicit requirement is the safer of the two to honour.
  for (const field of required) forbidden.delete(field);
  return { required: [...required], forbidden };
}

/**
 * Does `if` hold for this payload? `true`, `false`, or `null` for "this rule
 * uses something we do not model".
 *
 * THE NULL IS THE WHOLE POINT, and it was learned the expensive way. An earlier
 * version returned `false` for an unrecognised condition, which quietly selected
 * the `else` branch — and `else` is where these forms put their prohibitions.
 * The live Dutch rule is
 *     if   annual_gross_salary <= 7199999   (one cent below the current salary)
 *     then required [salary_decrease_reason, was_employee_informed]
 *     else those two are FORBIDDEN
 * so a resolver that did not understand `maximum` took the `else` branch and
 * concluded a salary DECREASE must not carry a decrease reason — the exact
 * inversion of what Remote requires. Proven in production: execution 5098, a
 * 72,000 -> 66,000 amendment, passed the schema gate with neither attestation.
 * "Not understood" and "false" are different answers and must stay different.
 *
 * MODELLED: `const`, and the numeric bounds `maximum` / `minimum` /
 * `exclusiveMaximum` / `exclusiveMinimum`, plus `if.required`. Those are what
 * the live forms use, and the bounds are how Remote expresses "is this a
 * decrease" and "is this below the statutory floor" — materialised per
 * employment, which is why the schema endpoint takes an employment id.
 *
 * An ABSENT value never satisfies a condition, which is what makes an unsourced
 * field fall to `else` rather than silently opening `then`.
 */
const NUMERIC_BOUNDS = {
  maximum: (v, b) => v <= b,
  minimum: (v, b) => v >= b,
  exclusiveMaximum: (v, b) => v < b,
  exclusiveMinimum: (v, b) => v > b,
};

function matchesCondition(condition, payload) {
  const props = condition.properties;
  let holds = true;
  if (props && typeof props === "object") {
    for (const [field, spec] of Object.entries(props)) {
      if (!spec || typeof spec !== "object") return null;
      const bounds = Object.keys(NUMERIC_BOUNDS).filter((k) => typeof spec[k] === "number");
      const hasConst = "const" in spec;
      if (!hasConst && bounds.length === 0) return null; // not modelled -> skip the rule
      const value = payload?.[field];
      if (hasConst && value !== spec.const) holds = false;
      for (const bound of bounds) {
        // A non-number can never satisfy a numeric bound, and it is not an
        // unmodelled rule either — it is a payload that fails this branch.
        if (typeof value !== "number" || !NUMERIC_BOUNDS[bound](value, spec[bound])) holds = false;
      }
    }
  }
  if (Array.isArray(condition.required)) {
    for (const field of condition.required) {
      if (!usable(payload?.[field])) holds = false;
    }
  }
  return holds;
}

/**
 * Each structured change, and the field names a schema might call it by. The
 * FIRST alias each schema declares wins, so the schema decides the name and
 * this list never does — that is the difference between a mapping and a rename.
 * `companion: true` marks a value that rides with another change (a currency
 * belongs to an amount); a form that has no field for it is not refusing the
 * amendment, so a missing companion is skipped silently rather than reported.
 */
// A VALUE IS CLASSIFIED BEFORE ANY ARITHMETIC RUNS (finding F-31, the same
// shape as UC-05's F-28 and UC-07's F-29). `toRemoteInteger(null)` THREW out of
// this function, 44 lines before createAmendment() and 63 before audit.log() in
// workflow.js — so a blank salary from the request portal produced HTTP 500 and
// ZERO audit rows, the one outcome this architecture exists to prevent. Every
// other gate failure here fails closed to a durable, audited escalate.
//
// The refusal is NOT a default. Coercing an absent amount to 0 would draft a
// decrease-to-zero for a human to one-click approve, and a quoted "39000" is
// refused rather than coerced because silently accepting it is how a 100x
// scaling error gets in (UC-09 finding F-05, UC-05's reconcilePtoPayout).
//
// HOURS ARE DELIBERATELY LOOSER THAN MONEY: live
// `contract_details.work_hours_per_week` is the STRING "24", so a quoted number
// is that field's real shape and refusing it would invent a constraint the API
// contradicts. Only emptiness is refused there.
const realNumber = (v) => typeof v === "number" && Number.isFinite(v);
const presentValue = (v) => v !== undefined && v !== null && v !== "" && !(typeof v === "number" && Number.isNaN(v));

const CHANGE_TARGETS = [
  {
    key: "jobTitle",
    field: "newValue",
    aliases: ["job_title"],
    legacy: "job_title",
    stated: (c) => c.jobTitle.newValue,
    derivable: (v) => typeof v === "string" && v.trim() !== "",
    value: (v) => v,
  },
  {
    key: "weeklyHours",
    field: "newValue",
    aliases: ["work_hours_per_week", "weekly_hours"],
    legacy: "weekly_hours",
    stated: (c) => c.weeklyHours.newValue,
    derivable: presentValue,
    value: (v) => v,
  },
  {
    key: "salary",
    field: "newAmount",
    aliases: ["annual_gross_salary", "base_salary"],
    legacy: "base_salary",
    stated: (c) => c.salary.newAmount,
    derivable: realNumber,
    // Money ×100 on the way out, every time, on whichever name the form uses
    // (live NL carries annual_gross_salary: 3600000 for a 36,000.00 salary).
    // Only ever reached with a value `derivable` has already accepted.
    value: (v) => toRemoteInteger(v),
  },
  {
    key: "salary",
    field: "currency",
    companion: true,
    aliases: ["compensation_currency_code", "currency"],
    legacy: "currency",
    stated: (c) => c.salary.currency,
    derivable: presentValue,
    value: (v) => v,
  },
];

/** The legacy four, carried through whenever the schema does not close itself. */
const LEGACY_CARRY = ["job_title", "weekly_hours", "base_salary", "currency"];

/**
 * A schema's own vocabulary, and whether it closes it.
 *
 * `properties` present -> those names are what the form accepts.
 * `additionalProperties === false` -> anything else is a REJECTION, so a change
 * with no declared field cannot be expressed at all.
 * Neither present -> the schema states requirements and says nothing about what
 * is allowed. JSON Schema's own default there is permissive, so inventing a
 * constraint would be exactly the move that caused this bug. The mock's
 * `{required: [...]}` shape is this case.
 */
function schemaVocabulary(countrySchema) {
  const required = Array.isArray(countrySchema?.required) ? countrySchema.required : [];
  const props = countrySchema?.properties;
  const hasProps = Boolean(props) && typeof props === "object" && !Array.isArray(props);
  const declared = new Set([...(hasProps ? Object.keys(props) : []), ...required]);
  return { required, declared, closed: hasProps && countrySchema.additionalProperties === false };
}

const usable = (value) => value !== undefined && value !== null && value !== "";

/**
 * Build the FULL next-state payload — the employment record's current fields
 * merged with the proposed changes, not just the diff. The country schema's
 * `required` list describes a complete valid record, so validating a bare diff
 * against it would flag every unrelated required field as missing on every
 * amendment.
 *
 * @param {object} args
 * @param {object|null} args.employment  normalized employment record
 * @param {object} args.changes  {salary?: {newAmount, currency}, jobTitle?: {newValue}, weeklyHours?: {newValue}}
 * @param {object|null} [args.countrySchema]  the schema this payload will be validated against
 * @param {string} [args.requestedEffectiveDate]
 * @returns {{payload: object, unexpressible: string[], underivable: string[]}}
 *   `unexpressible` names the requested changes this schema has no field for;
 *   `underivable` names those whose stated value is not a value at all (blank,
 *   null, NaN, or a quoted amount). Both are refusals rather than validation
 *   failures; see evaluate() below.
 */
export function buildAmendmentPayload({ employment, changes, countrySchema = null, requestedEffectiveDate = null } = {}) {
  const emp = employment ?? {};
  const chg = changes ?? {};
  const ctx = { requestedEffectiveDate, changes: chg };
  const { required, declared, closed } = schemaVocabulary(countrySchema);

  const payload = {};
  const unexpressible = [];
  const underivable = [];
  const refused = new Set();

  // 1. The requested changes, each under the name THIS schema calls it by.
  for (const target of CHANGE_TARGETS) {
    if (!chg[target.key]) continue;

    // Classify BEFORE arithmetic. A companion is not reported here: a currency
    // nobody stated is simply omitted, and validateAgainstSchema() names it as
    // `missing_<field>` if the form requires it — the mechanism that already
    // exists for a value we do not have.
    const stated = target.stated(chg);
    if (!target.derivable(stated)) {
      if (!target.companion) {
        underivable.push(`${target.key}.${target.field}`);
        // The field this amendment was ABOUT is now barred from carry-through
        // below. Filling it with the employee's current salary would put the OLD
        // figure under the very key the requester meant to change, in a row
        // whose whole point is that the new figure is unknown — a reader has no
        // way to tell that apart from an approved amount.
        for (const alias of target.aliases) refused.add(alias);
        refused.add(target.legacy);
      }
      continue;
    }

    const name = target.aliases.find((alias) => declared.has(alias)) ?? (closed ? null : target.legacy);
    if (!name) {
      // A form that cannot express this change must not silently drop it and
      // then pass validation on the leftovers — that approves a SALARY_INCREASE
      // whose amount appears nowhere in the validated payload.
      if (!target.companion && !unexpressible.includes(target.key)) unexpressible.push(target.key);
      continue;
    }
    payload[name] = target.value(stated);
  }

  // 2. Everything else the record must still contain, carried through unchanged.
  //    A closed schema is carried strictly to its own required list; an open one
  //    also keeps the four keys this function has always emitted, so the mock
  //    path and every existing caller are unaffected.
  const carry = (names) => {
    for (const field of names) {
      if (field in payload || refused.has(field)) continue;
      const value = sourceValue(field, emp, ctx);
      if (usable(value)) payload[field] = coerceToSchemaType(value, field, countrySchema);
      // Not usable -> left out on purpose. validateAgainstSchema() reports it
      // as `missing_<field>`, the gate that already exists for exactly this.
    }
  };
  carry(closed ? required : [...new Set([...required, ...LEGACY_CARRY])]);

  // 3. The conditionals, resolved against what the payload now says.
  //    This has to run AFTER step 2, because which branch applies depends on
  //    values step 2 sourced (`work_schedule`, `contract_duration_type`) and on
  //    the amount step 1 wrote — not on anything this file decides.
  //
  //    A SALARY DECREASE'S two attestations fall out of here rather than out of
  //    a special case: the form itself carries
  //    `if annual_gross_salary <= <current - 1 cent> then required
  //    [salary_decrease_reason, was_employee_informed]`, materialised for this
  //    employment. The schema names the rule; this code never does.
  const conditional = effectiveSchema(countrySchema, payload);
  const extra = [...conditional.required];
  carry(extra);

  // 4. Fields THIS branch forbids. Live, a full_time payload carrying
  //    `part_time_salary_confirmation` is refused with `["must be empty"]` —
  //    a value the record legitimately holds is still a rejection here, so
  //    carrying it through "because we have it" breaks the write.
  for (const field of conditional.forbidden) delete payload[field];

  // WHAT IS *REQUIRED*, NOT WHAT WAS CARRIED. The two lists differ on an open
  // schema, where LEGACY_CARRY adds four keys the form never demanded — folding
  // those in would fail an amendment for a field nothing asked for.
  const effectiveRequired = [...new Set([...required, ...extra])].filter((f) => !conditional.forbidden.has(f));
  return { payload, unexpressible, underivable, effectiveRequired };
}

/**
 * @param {object} args
 * @param {boolean} args.identityVerified   requester is an authorized admin for employment.company_id
 * @param {object|null} args.employment     normalized employment record
 * @param {object} args.countrySchema       {required: string[]} from RemoteClient.getCountrySchema()
 * @param {object} args.changes             proposed changes, structured (see changeParser.js)
 * @param {string} args.requestedEffectiveDate
 * @param {string|number|Date} args.now
 * @param {object[]} args.payrollCycles     from RemoteClient.listPayrollRuns()
 * @param {Array<{call:string,status:number|null,kind:string,message:string}>} [args.upstreamFailures]
 *   Reads that FAILED rather than returned data (shared/upstreamFailure.js).
 *   Defaults to `[]`, so every existing caller and test is unaffected; each
 *   entry can only ever make this function stricter.
 * @returns {{decision:string, reason:string, flags:string[], amendmentType:string, payload?:object, cutoff?:object}}
 */
export function evaluate({
  identityVerified,
  employment,
  countrySchema,
  changes,
  requestedEffectiveDate,
  now,
  payrollCycles,
  upstreamFailures = [],
}) {
  const type = amendmentType(changes);

  // Gate 0 — the employment read, ahead of everything that reads it. Live
  // execution 4232 escalated `identity_not_verified` on an amendment whose
  // employment fetch had 404'd; the gate that would have named a real upstream
  // problem (`country_schema_unavailable`) never ran, because identity refused
  // first on a record that was never loaded.
  const employmentFailure = upstreamVerdict(findUpstreamFailure(upstreamFailures, "employment"));
  if (employmentFailure) return { ...employmentFailure, amendmentType: type };

  if (!identityVerified) {
    return { decision: "escalate", reason: "identity_not_verified", flags: ["identity_not_verified"], amendmentType: type };
  }
  if (!employment || employment.status !== "active") {
    return { decision: "escalate", reason: "employee_not_active", flags: ["employee_not_active"], amendmentType: type };
  }

  const { payload, unexpressible, underivable, effectiveRequired } = buildAmendmentPayload({ employment, changes, countrySchema, requestedEffectiveDate });

  // A schema we could not fetch is NOT a schema with no required fields
  // (finding F-15). `validateAgainstSchema(payload, {required: []})` returns
  // valid for literally any payload, so treating an unavailable schema as an
  // empty one turns invariant #2 into a gate that always opens — the exact
  // "assume a static field set" failure the invariant exists to forbid, only
  // worse, because it assumes the empty set. `remote.getCountrySchema()`
  // returns null when the endpoint 404s or answers an unusable shape; that
  // null must escalate to a human who can check the country's real
  // requirements before anyone approves a write.
  // The failure list is checked BEFORE the schema's own shape, not inside it: a
  // read that failed produced no schema anyone may validate against, so a
  // schema object arriving beside a recorded failure is not evidence.
  //
  // This reason already names the upstream problem accurately, so it stays —
  // but when the read is known to have failed, the flag records WHICH call and
  // WHAT status, so `audit_log.details` can be triaged without opening n8n (a
  // 404 on an unsupported country and a 403 from a scope-less token are the
  // same reason string and completely different fixes).
  const schemaFailure = findUpstreamFailure(upstreamFailures, "country_schema");
  if (schemaFailure || !countrySchema || !Array.isArray(countrySchema.required)) {
    const failure = schemaFailure;
    return {
      decision: "escalate",
      reason: "country_schema_unavailable",
      flags: failure
        ? ["country_schema_unavailable", `upstream_country_schema_${failure.status ?? "error"}`]
        : ["country_schema_unavailable"],
      amendmentType: type,
      payload,
    };
  }

  // A change whose stated value is not a value at all — blank, null, NaN, or a
  // quoted amount — is refused FIRST, ahead of every question about which field
  // name the form uses. It is also the more actionable message: "you did not
  // give me a salary" is something the requester can fix, and it is what used to
  // arrive as an unaudited HTTP 500 (finding F-31).
  if (underivable.length) {
    return {
      decision: "escalate",
      reason: "change_value_underivable",
      flags: ["change_value_underivable", ...underivable.map((f) => `underivable_${f.replace(".", "_")}`)],
      amendmentType: type,
      payload,
    };
  }

  // A requested change the form has no field for is a refusal in its own right,
  // and it must be reported BEFORE validation: the payload that reaches
  // validateAgainstSchema() no longer contains that change, so a `schema_valid`
  // verdict on it would be a verdict about a different amendment than the one
  // requested. Live, this is what an employment_basic_information schema says
  // about a salary change — that form has no salary field at all.
  if (unexpressible.length) {
    return {
      decision: "escalate",
      reason: "change_not_expressible",
      flags: ["change_not_expressible", ...unexpressible.map((f) => `unexpressible_${f}`)],
      amendmentType: type,
      payload,
    };
  }

  // Validated against the EFFECTIVE required list — the schema's own `required`
  // plus whatever its `allOf` branches add for this payload, minus what they
  // forbid. Checking only `countrySchema.required` would pass a payload the
  // real write rejects (live: a fixed_term amendment with no `contract_end_date`
  // is `422 "can't be blank"` while satisfying `required` completely).
  const schemaCheck = validateAgainstSchema(payload, { required: effectiveRequired ?? countrySchema.required });
  if (!schemaCheck.valid) {
    return {
      decision: "escalate",
      reason: "schema_invalid",
      flags: ["schema_invalid", ...schemaCheck.missing.map((f) => `missing_${f}`)],
      amendmentType: type,
      payload,
    };
  }

  // The payroll calendar read, checked BEFORE the cutoff engine runs on it.
  // An empty `payrollCycles` from a failed fetch is indistinguishable from a
  // company that genuinely has no cycles, and the cutoff engine reports both as
  // `no_matching_payroll_cycle` — the same F-15 shape as the schema gate above
  // ("could not fetch" quietly becoming a fact about the data). A fetch we
  // never got an answer from cannot be allowed to describe the calendar.
  const payrollFailure = upstreamVerdict(findUpstreamFailure(upstreamFailures, "payroll_runs"));
  if (payrollFailure) return { ...payrollFailure, amendmentType: type, payload };

  // The ambiguity gate runs BEFORE evaluateCutoff(), because evaluateCutoff()
  // cannot express "I do not know which of these governs" — it returns one
  // cycle, and a recorded cycle is an answer. See cutoffEngine.js's note above
  // cyclesCovering() for why the choice cannot be made from Remote's reference.
  const coveringCycles = cyclesCovering(payrollCycles, requestedEffectiveDate);
  if (coveringCycles.length > 1 && distinctCutoffCount(coveringCycles) > 1) {
    return {
      decision: "escalate",
      reason: "ambiguous_payroll_cycle",
      flags: ["ambiguous_payroll_cycle"],
      amendmentType: type,
      payload,
      cutoff: {
        // `cycle: null` on purpose: recording one of the candidates would put a
        // coin-flip cutoff into the amendment row and into the audit trail,
        // where a later reader would take it for the answer.
        cycle: null,
        noMatchingCycle: false,
        cutoffUnknown: true,
        cutoffAlreadyPassed: false,
        urgentWithin48h: false,
        retroactive: false,
        hoursUntilCutoff: null,
        ambiguousCycles: coveringCycles.map((c) => ({
          id: c.id ?? null,
          type: c.type ?? null,
          status: c.status ?? null,
          cutoff_date: c.cutoff_date ?? null,
        })),
      },
    };
  }

  const cutoff = evaluateCutoff({ requestedEffectiveDate, now, payrollCycles });
  if (cutoff.noMatchingCycle) {
    return { decision: "escalate", reason: "no_matching_payroll_cycle", flags: ["no_matching_payroll_cycle"], amendmentType: type, payload, cutoff };
  }
  // The cycle exists but its cutoff timestamp is unreadable (finding F-26b).
  // We cannot prove the amendment makes the run, and "cannot prove" is not
  // "yes" — escalate rather than let a NaN comparison quietly report a clear
  // runway. Placed before the passed/urgent checks because both of those are
  // answers to a question this case could not evaluate.
  if (cutoff.cutoffUnknown) {
    return { decision: "escalate", reason: "cutoff_date_unknown", flags: ["cutoff_date_unknown"], amendmentType: type, payload, cutoff };
  }
  // The requested cycle's cutoff has already passed — this would require a
  // retroactive correction rather than a normal forward-dated change. Escalate
  // rather than silently drafting a retroactive payload for 1-click approval
  // (see the file header and docs/use-cases/UC-06.md's failure-mode table).
  if (cutoff.cutoffAlreadyPassed) {
    return {
      decision: "escalate",
      reason: "cutoff_lock_passed",
      flags: ["cutoff_lock_passed", "retroactive_change"],
      amendmentType: type,
      payload,
      cutoff,
    };
  }

  const flags = cutoff.urgentWithin48h ? ["urgent_cutoff"] : [];
  return { decision: "dual_approval_required", reason: "all_gates_passed", flags, amendmentType: type, payload, cutoff };
}


// ---------------------------------------------------------------------------
// GATE_SEQUENCE  —  what each reason MEANS, and where in the order it sits
// ---------------------------------------------------------------------------
// UC-06 HAD NO LADDER AT ALL until now, which made it the thinnest surface of
// the three medium-tier use cases: UC-04 and UC-05's API views carry
// `decidedBy` and `gateLadder`, and UC-06's carried the raw slug and nothing
// else. `cutoff_lock_passed` and `change_not_expressible` are not sentences
// anybody outside this file can act on, and this is the use case where TWO
// different people have to act on them.
//
// Derived by reading evaluate() top to bottom. `checks` is the PASSING
// condition; `means` is what it is to a person when that reason is the one that
// decided. The raw slug stays visible beside the prose — it is the string in
// `audit_log`, in the metrics exception ranking and in the n8n port
// (workflows/nodes-uc06/amendmentGates.js), and therefore what somebody greps.
//
// TWO AUDIENCES, AND THE ROWS SAY WHICH. UC-06's dual control is a customer
// admin (is this the right change to this contract?) and a Remote payroll
// specialist (can payroll carry it on the date it takes effect?). Some rungs
// belong to one and some to the other, and a rung that reads as a payroll
// problem when it is really a contract-form problem sends the case to the wrong
// desk. `means` names whose problem it is.
//
// The two upstream reasons (`upstream_record_not_found`, `upstream_unavailable`)
// have no rung, because evaluate() does not author them — they come back from
// shared/upstreamFailure.js's upstreamVerdict(), which is its own vocabulary
// shared by every use case. UC-09's ladder makes the same call for the same
// reason. describeDecidingGate() returns null for them, which is the honest
// degradation: the caller shows the bare slug, exactly what it showed before
// this ladder existed.
// ---------------------------------------------------------------------------
export const GATE_SEQUENCE = Object.freeze([
  {
    position: 1,
    reason: "identity_not_verified",
    gate: "identity",
    checks: "the requester is an authenticated admin for the company this employment belongs to",
    means:
      "We could not confirm the requester acts for the company that employs this person, so nothing about the amendment was assessed. This is a failure to VERIFY — it is not a finding that the requester is unauthorised. A Zendesk requester legitimately lands here: a ticket carries an authenticated person, not an authenticated company-admin session, which is the signal this gate needs.",
  },
  {
    position: 2,
    reason: "employee_not_active",
    gate: "employment_status",
    checks: "the employment record exists and is active",
    means:
      "The employment record is missing or is not active, so there is no live contract to amend. Nothing about the proposed change or the payroll calendar was looked at.",
  },
  {
    position: 3,
    reason: "country_schema_unavailable",
    gate: "country_form",
    checks: "the country's own amendment form was fetched and states which fields it requires",
    means:
      "The country's amendment form could not be read, so there is nothing to validate the change against. This is deliberately NOT treated as a form with no requirements: an empty required list validates literally any payload, which would turn the schema check into a gate that always opens. A flag on the case names the call and the HTTP status, because a 404 on an unsupported country and a 403 from a scope-less token read identically here and need opposite fixes.",
  },
  {
    position: 4,
    reason: "change_value_underivable",
    gate: "change_values",
    checks:
      "every requested change states a value that is actually a value — a real number for money, a non-blank string for text",
    means:
      "At least one requested change has no usable value: blank, null, not a number, or a quoted amount where a number is required. This is the requester's to fix and it is the most actionable message in the ladder — \"you did not give me a salary\". A quoted amount is refused rather than coerced, because coercing an unvalidated string is how a 100x scaling error reaches payroll.",
  },
  {
    position: 5,
    reason: "change_not_expressible",
    gate: "form_vocabulary",
    checks: "the country's form has a field for every change being requested",
    means:
      "The country's amendment form has no field for at least one of the requested changes, so that change cannot be submitted through it at all. It is reported BEFORE validation on purpose: the payload that would reach the validator no longer contains the change, so a \"valid\" verdict on it would be a verdict about a different amendment than the one asked for. Live, this is exactly what a basic-information form says about a salary change — it has no salary field.",
  },
  {
    position: 6,
    reason: "schema_invalid",
    gate: "schema_validation",
    checks:
      "the complete next-state record satisfies everything the country's form requires, including its conditional rules",
    means:
      "The full record this amendment would produce is missing at least one field the country's form requires — the flags name which. Validation is against the EFFECTIVE required list, the form's own `required` plus whatever its conditional branches add for this particular payload, because checking only the top-level list passes payloads the real write rejects.",
  },
  {
    position: 7,
    reason: "ambiguous_payroll_cycle",
    gate: "payroll_cycle_identity",
    checks: "exactly one payroll cycle, or several agreeing on their lock time, covers the requested effective date",
    means:
      "More than one payroll cycle covers this effective date and they lock at DIFFERENT times, so which one governs is genuinely undecided — and ten days of difference in a payroll lock is the difference between the change landing and not landing. No cycle is recorded on the case, deliberately: writing down one of the candidates would put a coin-flip cutoff into the audit trail where a later reader would take it for the answer. The candidates are listed instead. This one is the payroll specialist's to settle.",
  },
  {
    position: 8,
    reason: "no_matching_payroll_cycle",
    gate: "payroll_cycle_exists",
    checks: "some payroll cycle's period covers the requested effective date",
    means:
      "No payroll cycle on record covers the requested effective date, so there is no run for this change to land in. Usually this means the effective date is beyond the last published cycle rather than that anything is wrong with the amendment itself — the contract change may be perfectly sound and simply have nowhere yet to be paid from.",
  },
  {
    position: 9,
    reason: "cutoff_date_unknown",
    gate: "cutoff_readable",
    checks: "the governing cycle states a lock time that can be read",
    means:
      "The payroll cycle exists but its lock time is unreadable, so we cannot say whether this change makes the run. \"Cannot prove\" is not \"yes\": an unreadable timestamp compares false against everything, which would have reported a comfortable runway derived from no information at all. A person has to establish the real lock time.",
  },
  {
    position: 10,
    reason: "cutoff_lock_passed",
    gate: "cutoff_lock",
    checks: "the governing cycle's lock has not yet closed",
    means:
      "The payroll lock for the cycle covering this effective date has already closed, so applying the change now would be a retroactive correction rather than an ordinary forward-dated one. It escalates rather than being quietly re-drafted against the next cycle, because moving somebody's effective date is a decision, not a formatting step.",
  },
  {
    position: 11,
    reason: "all_gates_passed",
    gate: "outcome",
    checks: "every gate above passed",
    means:
      "Every check passed, so the amendment is prepared and waiting on TWO named humans: the employer's signatory, and an independent Remote payroll specialist. Nothing has been sent to Remote — the contract is unchanged until both slots are filled by two different people, and one approval alone executes nothing.",
  },
]);

const descriptions = bindGateDescriptions(GATE_SEQUENCE);

/**
 * Which gate decided this outcome, and what that means in plain words.
 * Returns null for a reason with no row — see shared/gateLadder.js.
 * @param {string} reason  the slug evaluate() returned
 */
export const describeDecidingGate = descriptions.describeDecidingGate;

/**
 * The whole ordered ladder, each rung marked passed / decided / not_reached.
 * @param {string} reason  the slug evaluate() returned
 */
export const describeGateLadder = descriptions.describeGateLadder;
