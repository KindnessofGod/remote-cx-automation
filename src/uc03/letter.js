// ---------------------------------------------------------------------------
// letter.js  —  UC-03 response rendering (deterministic, no LLM in either)
// ---------------------------------------------------------------------------
// WHY TWO FUNCTIONS
// The spec's automation boundary is "zero-touch informational resolution ...
// HITL if a formal travel letter is generated", so UC-03 produces two
// very different artifacts:
//
//   1. renderInformationalAnswer() — the AUTO path. A plain-text answer to
//      "can I travel for business / workation?" that is deliberately NOT a
//      legal document. No compensation is ever mentioned here. The mandatory
//      travel disclaimer is appended by the shared disclaimer-injector.
//
//   2. renderTravelLetterHtml() — the FORMAL Travel Letter, rendered
//      deterministically from authoritative Remote data. It includes the
//      employee's ANNUAL GROSS SALARY where the record holds one, scaled ×100
//      via the shared money middleware (src/shared/money.js) exactly like every
//      money value in/out of the Remote API. Fields come ONLY from the fetched
//      employment record, never from anything the LLM wrote.
//
// ---------------------------------------------------------------------------
// ONE LETTER, ONE BODY — WHY THE COMPENSATION ROW SURVIVED AUTO-ISSUE
// ---------------------------------------------------------------------------
// This header used to end "...and it never leaves the building without a
// human's sign-off". That stopped being true when the standard letter began
// issuing on the 🟢 path, and the row that had to be re-argued is the money one:
// with nobody in the path, the decision to put an employee's pay on a document
// bound for a foreign authority is made entirely by this file.
//
// IT STAYS, and the argument has three legs.
//
//   1. IT IS THE ROW THAT ANSWERS THE QUESTION THE LETTER IS FOR. The
//      Commission's Visa Code Handbook I names MEANS OF SUBSISTENCE as its own
//      evidential head and names a certificate of employment against it
//      (§5.2.2(d)/(e)). A travel letter without it is a letter that answers two
//      of the three heads it is offered against. UC-01's employment-verification
//      letter is pay-free because pay answers nothing it is asked; here it
//      answers something specific.
//
//   2. THE SIGNATURE WAS NEVER A CONTROL OVER THIS ROW. On the path this
//      replaces, a specialist read the letter and signed it — and there was no
//      gate, no field and no prompt anywhere asking them to weigh the
//      compensation row, nor any outcome available to them other than signing a
//      correct standard letter or declining it wholesale. Removing them removes
//      a check on the document's CORRECTNESS, which the gates and the scope
//      check now do; it does not remove a check on disclosure, because there
//      was not one.
//
//   3. A PATH-DEPENDENT BODY WOULD BE TWO DOCUMENTS WEARING ONE NAME. If the
//      auto-issued letter dropped a row the signed one carries, an employer
//      could hand a consulate two "Travel Letters" asserting different things,
//      with nothing on either saying which kind it was — and the shorter one
//      would be a silently truncated document, which is the exact defect
//      `letterScope.js` exists to prevent, arriving from a new direction.
//      `test/uc03AutoIssue.test.js` pins this in both directions: the issued
//      letter carries the row, and it is byte-identical to what this same
//      function renders for the same inputs, so no second renderer can appear.
//
//      THIS IS A RULE ABOUT THE ISSUE PATH, NOT ABOUT THE RECORD. Two
//      employments legitimately differ: an EOR employment has an annual gross
//      salary and a contractor has a per-period rate Remote records under a
//      different name and a scale this repo has not established, so the
//      contractor's letter states no salary at all. The same record always
//      produces the same document; different records may not, exactly as the
//      job-title and jurisdiction rows already work. What the offer promises is
//      worded to match (src/uc03/letterOffer.js's `produces`).
//
// ---------------------------------------------------------------------------
// ESCAPING — WHICH OF THE TWO FUNCTIONS DOES IT, AND WHY ONLY ONE
// ---------------------------------------------------------------------------
// `renderTravelLetterHtml()` routes every interpolated value through
// `escapeHtml()` (src/shared/html.js), the same helper uc01/letter.js has always
// used. It did not until 2026-08-20, and the gap was not an exploit: everything
// it prints comes from a Remote read or from the country registry. It is a
// PRECONDITION. This letter is now issued with nobody in the path, and
// `docs/TRAVEL-LETTER-INPUTS.md` §6.3/§7 proposes putting the employee's own
// words — a named embassy or consulate — onto it, naming this as the first of
// three things that must be true first. Escaping landed on its own so the
// ordering is legible in the history rather than buried in the feature.
//
// `renderInformationalAnswer()` DOES NOT ESCAPE, and must not start: it returns
// PLAIN TEXT, posted as a Zendesk comment body, where `&amp;` would be shown to
// the customer literally. Two functions in one file with opposite rules is worth
// a sentence rather than a rediscovery.
//
// WHAT REPLACES THE SIGNATURE AS THE EMPLOYEE'S CONSENT. Two things that
// already existed and now carry weight they did not before:
// `renderInformationalAnswer()` lists the rows the letter will contain BEFORE
// the employee accepts the offer, and `letterScope.js`'s `omission_requested`
// marker routes "please leave my salary out" to a person who can write the
// letter by hand. A marker only fires on an ask, and nobody asks about a row
// they were never told was there — which is why the listing is not decoration.
// ---------------------------------------------------------------------------

import { formatMoney, parseRemoteMinorUnits } from "../shared/money.js";
// ONE escaper, shared with uc01/letter.js's job rather than copied — see
// src/shared/html.js for why UC-01 still holds a private copy and why closing
// that is a separate unit of work.
import { escapeHtml } from "../shared/html.js";
import { withDisclaimer } from "../shared/disclaimer.js";
// The engagement type in words. ONE copy, shared with uc01/letter.js and
// shared/employeeSubject.js — all three used to hold a private four-entry map,
// none of which had an entry for `global_payroll`, the value the live API
// actually returns and the one that reached a specialist as a raw slug.
import { contractTypeLabel } from "../shared/contractTypes.js";
// The addressee's length cap and whitespace rule, shared with the intake merge
// so the renderer and the form cannot come to disagree about what is renderable.
import { normaliseStatedAddressee } from "./statedTrip.js";

/** Display names for the destinations the mock/supported list actually serves. */
const COUNTRY_NAMES = {
  ES: "Spain",
  DE: "Germany",
  FR: "France",
  PT: "Portugal",
  IT: "Italy",
  NL: "Netherlands",
  IE: "Ireland",
  PL: "Poland",
  GB: "United Kingdom",
  US: "United States",
  CA: "Canada",
  IN: "India",
  PH: "Philippines",
  MX: "Mexico",
  NG: "Nigeria",
  EE: "Estonia",
  CU: "Cuba",
  IR: "Iran",
  KP: "North Korea",
  SY: "Syria",
  RU: "Russia",
  BY: "Belarus",
  MM: "Myanmar",
  VE: "Venezuela",
};

export function countryName(code) {
  // Own-property check (finding F-21's pattern): `code` originates in
  // LLM/rule-based classification of customer text, so it is untrusted, and
  // `COUNTRY_NAMES["constructor"]` would otherwise put a stringified
  // JavaScript function into a customer-facing letter — reproduced directly
  // in testing: without this guard, countryName("constructor") resolves via
  // the prototype chain to the native Object constructor. Same own-property
  // discipline the LLM-facing lookups elsewhere in this project use for
  // untrusted map keys. (Independently found and fixed twice this session,
  // once here and once in a parallel review pass — both converged on the
  // same guard, which is itself a good sign.)
  if (typeof code !== "string" || !Object.hasOwn(COUNTRY_NAMES, code)) return code;
  return COUNTRY_NAMES[code] ?? code;
}

/**
 * The formal Travel Letter. Rendered deterministically from authoritative Remote
 * reads — see the file header for why compensation is present here, absent from
 * the informational answer and absent from UC-01's standard letter, and why the
 * body does not change when nobody signs it.
 *
 * WHAT A CONSULATE ACTUALLY DOES WITH THIS DOCUMENT, and why the rows are the
 * rows. The Commission's Visa Code Handbook I names three evidential heads a
 * business traveller's supporting documents must satisfy, and a letter of this
 * kind is offered against all three:
 *
 *   - **purpose of the journey** — Annex A(1)(e), *"documents proving the
 *     applicant's employment status in the company"* (examples given: contract,
 *     proof of social-security contributions);
 *   - **intention to leave before the visa expires** — Annex B(3), *"proof of
 *     employment or professional activity"*, which *"may be proved by a work
 *     contract; certificate of employment; information on professional status"*;
 *   - **means of subsistence** — §5.2.2(d)/(e), *"salary slips"* and
 *     *"certificate of employment"*.
 *
 * [CONFIRMED — Commission Implementing Decision C(2024) 4319 Annex, fetched
 * 2026-08-20, sha256 f671a0cff5a800d723784826739c46129e24056d45e8823cfd07eae24b3142ac.]
 * §5.1.1 names *"statement of employment from the applicant's employer"* among
 * the originals a consulate keeps. So the employment rows and the compensation
 * row are not decoration and not this repo's invention — each answers a
 * question the Handbook says the consulate is asking. Compensation in
 * particular has until now rested on the research blueprint alone; §5.2.2(d)
 * is the primary source for it.
 *
 * WHAT IT DELIBERATELY DOES NOT ASSERT is longer than what it does, and the
 * comparison lives in `docs/use-cases/UC-03.md` §18 rather than in a comment
 * here: a passport number, a date of birth, who bears the costs, an
 * accommodation address, a named signatory, a language other than English.
 * (An addressee was on that list until this pass. It came off it because the
 * value can now be SUPPLIED — by the traveller, on the request, as a field —
 * which was always the reason it was missing rather than anything about the
 * document: `docs/TRAVEL-LETTER-INPUTS.md` §7 establishes that Remote treats
 * `embassy_address` as routine required intake and that `letterScope.js`'s own
 * refusal text is a statement about intake, not about the letter. Nothing else
 * on the list moved: each of the others is either an employer's undertaking, a
 * fact this system holds nowhere, or set per consulate.)
 * Every one of them is a field Remote's own `TravelLetterRequest` collects and
 * this system does not hold, and NONE of them is invented to fill the row.
 * `letterScope.js` is what makes a request for any of them stop here instead of
 * being dropped from the document in silence.
 *
 * @param {object} args
 * @param {object} args.employment          fetched employment record
 * @param {object} args.legalEntity         fetched legal entity — {name, country_name, country_code}
 * @param {string} args.destinationCountry  ISO alpha-2 code
 * @param {string} [args.destinationName]   display name; defaults to countryName()
 * @param {string} [args.startDate]         "YYYY-MM-DD"
 * @param {string} [args.endDate]           "YYYY-MM-DD"
 * @param {string|null} [args.reference]    the requester's own reference for this
 *   request — the ticket id or case id. Rendered so the letter can be cited back;
 *   omitted entirely when there is none, never filled with a placeholder.
 * @param {string|null} [args.addressee]    the embassy or consulate the TRAVELLER
 *   named, when they named one. Rendered as a plain "Attention:" line above the
 *   salutation and nothing else; absent leaves the letter exactly as it was. Never
 *   inferred, never truncated — see the block that reads it.
 * @returns {string} HTML
 */
export function renderTravelLetterHtml({ employment, legalEntity, destinationCountry, destinationName, startDate, endDate, reference = null, addressee = null }) {
  const contract = contractTypeLabel(employment.contract_type, "not recorded");
  const today = new Date().toISOString().slice(0, 10);
  const destination = destinationName || countryName(destinationCountry);
  const travelWindow =
    startDate && endDate ? `${startDate} to ${endDate}` : startDate || endDate || "to be confirmed";
  // The ONLY money in any UC-03 artifact, and it is now read from the shape
  // production actually receives — see readAnnualGrossSalary() below for what
  // was established about the figure and what deliberately was not.
  const salary = readAnnualGrossSalary(employment);
  const compensation = salary ? formatMoney(salary.minorUnits, salary.currency) : null;

  // THE EMPLOYER'S JURISDICTION, which the letter did not say. A consulate
  // reading "Remote Germany EOR GmbH" learns the entity's name and nothing
  // about where it is registered, and the employing jurisdiction is what makes
  // the employment statement locatable. `getLegalEntity()` already returns this
  // — `country_name` and the alpha-2 `country_code`, both derived from Remote's
  // own registry read at the boundary (`RemoteClient#normalizeLegalEntity()`).
  // It was simply never rendered.
  //
  // THE REGISTERED ADDRESS IS NOT HERE AND MUST NOT BE ADDED. The real endpoint
  // `GET /v1/companies/:id/legal-entities` exposes NO address field — only the
  // mock fixture carries one, and it says so about itself. Rendering it would
  // put a value on a consular document that exists only in test data.
  // `docs/use-cases/UC-03.md` §18 lists it as a stated gap.
  const entityJurisdiction = legalEntity?.country_name || legalEntity?.country_code || null;

  // THE ONE VALUE ON THIS PAGE THE EMPLOYEE TYPED, and the three conditions
  // `docs/TRAVEL-LETTER-INPUTS.md` §6.3 requires of it are ALL met before it is
  // here, not any of them:
  //
  //   1. escaping is closed — every interpolation in this template routes
  //      through `escapeHtml()` (`src/shared/html.js`, landed on its own in
  //      `beec724` precisely so this could follow it), and this is the first
  //      untrusted free text the letter has ever carried;
  //   2. it is length-capped and rendered as a plain "Attention:" line with NO
  //      other change to the body — the salutation, every row, the closing and
  //      the disclaimer are exactly what they were. `normaliseStatedAddressee()`
  //      is the cap, applied here as well as at intake so a caller reaching this
  //      renderer directly gets the same rule, and it REFUSES an over-long value
  //      rather than truncating a consulate's name;
  //   3. `letterScope.js`'s `addressee_specified` markers are untouched and
  //      still scan the request TEXT, so a compound ask ("address it to X and
  //      confirm the company pays") still escalates instead of being half-served
  //      by this line.
  //
  // ABSENT IS THE NORMAL CASE AND CHANGES NOTHING. The letter opens "To Whom It
  // May Concern", which §7 argues is never wrong — a letter headed to the WRONG
  // post reads as prepared for somebody else's application, which is why this
  // value is only ever the traveller's own and is never inferred.
  const attention = normaliseStatedAddressee(addressee).addressee;

  const body = `<!doctype html>
<html><head><meta charset="utf-8"><title>Travel Letter</title></head>
<body style="font-family: Arial, sans-serif; max-width: 720px; margin: 40px auto; line-height: 1.5;">
  <p style="text-align:right;">${today}${reference ? `<br/>Our reference: ${escapeHtml(reference)}` : ""}</p>
  <h2>Travel Letter</h2>
  ${attention ? `<p>Attention: ${escapeHtml(attention)}</p>\n  ` : ""}<p>To Whom It May Concern,</p>
  <p>This letter confirms the employment of <strong>${escapeHtml(employment.full_name)}</strong>
     with ${escapeHtml(legalEntity.name)}, and the professional nature of their business travel to
     <strong>${escapeHtml(destination)}</strong>${travelWindow ? ` (${escapeHtml(travelWindow)})` : ""}.</p>
  <table style="border-collapse:collapse;">
    <tr><td style="padding:4px 12px 4px 0;">Employee</td><td>${escapeHtml(employment.full_name)}</td></tr>
    <tr><td style="padding:4px 12px 4px 0;">Job title</td><td>${escapeHtml(employment.job_title || "—")}</td></tr>
    <tr><td style="padding:4px 12px 4px 0;">Employment status</td><td>${escapeHtml(employment.status)}</td></tr>
    <tr><td style="padding:4px 12px 4px 0;">Contract type</td><td>${escapeHtml(contract)}</td></tr>
    <tr><td style="padding:4px 12px 4px 0;">Start date</td><td>${escapeHtml(employment.start_date)}</td></tr>
    ${entityJurisdiction ? `<tr><td style="padding:4px 12px 4px 0;">Employer registered in</td><td>${escapeHtml(entityJurisdiction)}</td></tr>` : ""}
    <tr><td style="padding:4px 12px 4px 0;">Destination country</td><td>${escapeHtml(destination)} (${escapeHtml(destinationCountry)})</td></tr>
    <tr><td style="padding:4px 12px 4px 0;">Travel dates</td><td>${escapeHtml(travelWindow)}</td></tr>
    ${compensation ? `<tr><td style="padding:4px 12px 4px 0;">Annual gross salary</td><td>${escapeHtml(compensation)}</td></tr>` : ""}
  </table>
  <p>This letter confirms the professional nature of the travel. It is not a work
     authorization and it does not constitute an assessment of visa or entry
     requirements for the destination country.</p>
  <p>Sincerely,<br/>${escapeHtml(legalEntity.name)}</p>
</body></html>`;

  // The mandatory travel disclaimer — appended by the shared injector, so no
  // customer-facing UC-03 artifact can be produced without it.
  return withDisclaimer(body, "travel");
}

/**
 * The one money figure this letter is allowed to state — an ANNUAL GROSS SALARY
 * in minor units with its own currency — or null when the record does not hold
 * one this function can vouch for.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS NOT `employment.base_salary` ANY MORE
 * ---------------------------------------------------------------------------
 * It was, for the project's whole life, and the row COULD NOT RENDER IN
 * PRODUCTION. `normalizeEmployment()` (src/remote/restClient.js) produces no
 * `base_salary` and no `currency` key for a real API response — its own comment
 * says so and calls it a handoff item — so only the mock server's flat fixtures
 * ever satisfied the old test, and `test/uc03AutoIssue.test.js` asserted the
 * row's presence against exactly those fixtures and passed. A fixture that
 * agrees with the code while neither agrees with Remote is this repository's
 * most expensive recurring failure (CLAUDE.md §4), and it was sitting on the
 * most sensitive row of a document now issued with nobody in the path.
 *
 * ---------------------------------------------------------------------------
 * TWO NAMES, TWO DIFFERENT FACTS, AND ONLY ONE OF THEM HAS A SETTLED SCALE
 * ---------------------------------------------------------------------------
 * EOR employee — `contract_details.annual_gross_salary` with
 * `contract_details.compensation_currency_code`. An ANNUAL salary, and the ×100
 * scale is [CONFIRMED]: Remote types the same field on its cost calculator as
 * *"The annual gross salary in the region's local currency, in cents"*
 * (developer.remote.com/reference/post_v1_cost-calculator_estimation.md, HTTP
 * 200, fetched 2026-08-20; `src/uc07/costCalculator.js` already rests on that
 * sentence). The live contract-amendment captures agree independently:
 * `src/remote/fixtures/contractAmendmentSchemas.js` records 7199999 as *"one
 * cent below the CURRENT salary of the employment (7200000)"*, and one
 * employment's bound appears as 6158130 GBP / 8342855 USD / 31127687 PLN /
 * 7199999 EUR — a coherent ~£61.5k salary in minor units and an implausible
 * ~£6.1M in major ones.
 *
 * Contractor — `contract_details.payment_terms.compensation_gross_amount` with
 * `period_unit: "monthly"`. A RATE, not a salary, and its ×100 scale is
 * [UNKNOWN]: the committed live capture carries 25000, which is $250.00 or
 * $25,000.00 a month depending on an answer no public Remote reference states
 * (the field appears in no reference page — it lives inside the per-country
 * `contractor_contract_details` form, which needs a live token). So it is NOT
 * read here, and `test/uc03LetterCompensation.test.js` pins that structurally,
 * because the field name invites a one-line "fix" that would put a possibly
 * 100×-wrong figure on a consular document. Establish the scale from Remote
 * first, then give it its own row with its own period label — a rate printed
 * under a salary's heading answers the means-of-subsistence question without
 * saying over what period, which the letter's header argues is worse than
 * saying nothing.
 *
 * ---------------------------------------------------------------------------
 * WHY THE MOCK'S FLAT SHAPE IS STILL ACCEPTED
 * ---------------------------------------------------------------------------
 * `normalizeEmployment()` returns the mock's flat record untouched, so
 * `base_salary`/`currency` is a real shape INSIDE this system even though
 * Remote never sends it; and UC-06's payload builder already maps that field
 * onto the amendment form's `annual_gross_salary`, which is what makes the two
 * the same fact under two names rather than two facts. Dropping it would blank
 * the row in the portal, the playground and `npm run walkthrough` and prove
 * nothing. The live shape is tried FIRST so a record carrying both is read as
 * Remote describes it.
 *
 * NO CURRENCY DEFAULT. The old line fell back to `"USD"`. A salary printed in
 * the wrong currency is exactly as wrong as one printed at the wrong scale, so
 * an unusable currency code yields no row — the same shape-assert-or-null
 * discipline `pickAlpha2()` uses in the REST client, and for the same reason: a
 * missing value gets investigated, a wrong one gets acted on.
 *
 * @param {object} employment
 * @returns {{minorUnits: number, currency: string}|null}
 */
function readAnnualGrossSalary(employment) {
  const contractDetails = employment?.contract_details ?? null;
  const candidates = [
    // The live shape, as `GET /v1/employments/{id}` nests it.
    [contractDetails?.annual_gross_salary, contractDetails?.compensation_currency_code],
    // The mock server's flat shape, passed through by normalizeEmployment().
    [employment?.base_salary, employment?.currency],
  ];
  for (const [amount, currency] of candidates) {
    // Not `typeof === "number"`: this API sends money as a quoted string on at
    // least one endpoint, and parseRemoteMinorUnits() is the one place that
    // knows which strings are a number and which are an invention.
    const minorUnits = parseRemoteMinorUnits(amount);
    if (minorUnits === null) continue;
    if (typeof currency !== "string" || !/^[A-Za-z]{3}$/.test(currency)) continue;
    return { minorUnits, currency: currency.toUpperCase() };
  }
  return null;
}

/**
 * The AUTO path's informational answer — plain text, zero-touch, deterministic.
 * It summarises what UC-03 verified (destination, duration), states plainly
 * that entry requirements are the destination authority's to set, and OFFERS
 * the formal letter for the same trip. No compensation, no legal conclusions,
 * disclaimer always appended.
 *
 * THE OFFER IS STATED UNCONDITIONALLY BECAUSE THIS TEXT IS ONLY EVER REACHED ON
 * `auto_resolve / all_gates_passed`, and every such case is letter-eligible:
 * rungs 1-10 of `policyEngine.js`'s ladder decide the answer and the letter
 * identically, and only the letter rungs differ. What the offer promises is
 * therefore true whenever this paragraph is printed — and what it now promises
 * is an ISSUED letter, because that is what accepting it produces. The one
 * exception it names out loud is the letterhead, which is the only thing left
 * that can send a standard letter to a person. See src/uc03/letterOffer.js.
 *
 * IT POINTS AT THE OFFER FOR WHAT THE LETTER SAYS, AND DOES NOT LIST IT HERE.
 * A document that issues with nobody in the path is a document nobody warned the
 * employee about, and the row a person is most likely to object to is their own
 * pay — so the rows ARE listed, in `describeLetterOffer()`'s `produces`, which
 * is what a surface renders beside the accept control. They are not listed in
 * THIS text because this text is the zero-touch answer, and
 * `test/uc03.test.js`'s money invariant on it is worth more than a second copy
 * of a list: an informational reply that has learned to say the word
 * "compensation" is one edit away from saying a number.
 *
 * WHY IT IS SAID AT ALL. `letterScope.js`'s `omission_requested` marker already
 * routes "please leave my salary out" to a person who can write the letter by
 * hand — but a marker only fires on an ask, and an employee cannot ask about a
 * row they were never told was there. Naming the rows before the click is what
 * makes that marker reachable in practice.
 * @param {object} args
 * @param {string} args.destinationCountry  ISO alpha-2 code
 * @param {string} [args.destinationName]
 * @param {string} [args.startDate]
 * @param {string} [args.endDate]
 * @param {number|null} [args.durationDays]
 * @returns {string} plain text
 */
export function renderInformationalAnswer({ destinationCountry, destinationName, startDate, endDate, durationDays }) {
  const destination = destinationName || countryName(destinationCountry);
  const window = startDate && endDate ? `${startDate} to ${endDate}` : null;
  const durationLine = durationDays ? ` (${durationDays} days)` : "";

  const body = `Thank you for your inquiry about business travel to ${destination}${window ? `, ${window}` : ""}${durationLine}.

Based on the details of your request, here is a summary:
  - Destination: ${destination}
  ${window ? `  - Travel period: ${window}` : ""}
  - Duration: ${durationDays ? `${durationDays} days` : "not stated"}

Short-term business travel of this kind requires no additional action on the
Remote platform. Entry requirements for the destination country vary and are
set by its authorities — please confirm current visa and entry rules before
you travel.

If you need a formal travel letter for this trip (for a visa appointment or a
port-of-entry check), you can ask for one without describing the trip again —
accept the travel-letter offer on this request and the destination and dates
above are carried over exactly as they are.

Every check that letter needs has already passed on this request, so it is
written and issued to you straight away. The offer lists exactly what the letter
will state before you accept it, and if you need it to say anything else — a
named addressee, a passport number, who bears the costs, particular wording,
another language, or a row left out — say so in the request and a Travel &
Mobility Support specialist writes it by hand instead.`;

  return withDisclaimer(body, "travel");
}
