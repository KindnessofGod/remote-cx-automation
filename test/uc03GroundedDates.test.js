// ---------------------------------------------------------------------------
// uc03GroundedDates.test.js — a travel date the requester never wrote must not
//                              reach a letter or a form
// ---------------------------------------------------------------------------
// FOUND BY DRIVING THE PORTAL, 2026-08-30. A UC-03 request reading "Can I work
// from Spain for three weeks in September?" — no day, no year — came back with
// `startDate: 2023-09-01`, `endDate: 2023-09-30`. Three years in the past, from
// a model whose own prompt says "never invent dates".
//
// WHY IT MATTERS MORE THAN THE FORM FIELD IT WAS SPOTTED IN. `classification
// .startDate` reaches `renderTravelLetterHtml({ startDate })` and is printed as
// "Travel dates" on a travel support letter addressed to a destination
// authority — issued on `auto_resolve`, with no human signature, because UC-03
// is 🟢. It also seeds the UC-03 -> UC-04 continuation prefill, and therefore
// the Schengen 90-in-180 arithmetic that UC-04's own copy of this rule exists
// to protect.
//
// UC-04 had the rule already ("REFUSE a date whose year nobody wrote"), and its
// header argued UC-03 did not need it because "UC-03's dates feed a day count
// on a 🟢 router". That was true when written. It is not any more, so the rule
// moved to src/shared/statedDates.js and both use cases read the one copy.
// ---------------------------------------------------------------------------
import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyTravelInquiry, classifyTravelInquiryRuleBased, parseItineraryDates } from "../src/uc03/classifier.js";
import { isDateGroundedInText } from "../src/shared/statedDates.js";
import { renderTravelLetterHtml } from "../src/uc03/letter.js";

const llm = (over) => ({
  askJson: async () => ({
    intent: "work_authorization",
    destinationCountry: "ES",
    formalLetterRequested: false,
    confidence: 0.95,
    ...over,
  }),
  isConfigured: () => true,
  backoff: async () => {},
});

// ---------------------------------------------------------------------------
// 1. The predicate
// ---------------------------------------------------------------------------

test("a date is grounded only when its YEAR is written in the request", () => {
  assert.equal(isDateGroundedInText("three weeks in September 2026", "2026-09-01"), true);
  assert.equal(isDateGroundedInText("from 2026-09-01 to 2026-09-21", "2026-09-01"), true);

  // The observed failure, and the one a past-date check would also catch.
  assert.equal(isDateGroundedInText("three weeks in September", "2023-09-01"), false);
  // The one a past-date check would MISS, which is why the rule is about
  // provenance rather than direction.
  assert.equal(isDateGroundedInText("three weeks in September", "2027-09-01"), false);

  // Shape still matters: a well-formed-looking non-date is not grounded either.
  assert.equal(isDateGroundedInText("in 2026", "2026-02-30"), false);
  assert.equal(isDateGroundedInText("in 2026", "next Tuesday"), false);
  for (const bad of [null, undefined, "", 20260901]) {
    assert.equal(isDateGroundedInText("in 2026", bad), false);
  }
});

// ---------------------------------------------------------------------------
// 2. The LLM path — the one that actually produced 2023
// ---------------------------------------------------------------------------

test("THE OBSERVED CASE: an invented year is dropped and the reason is recorded", async () => {
  const r = await classifyTravelInquiry(
    { text: "Can I work from Spain for three weeks in September?" },
    llm({ startDate: "2023-09-01", endDate: "2023-09-30" })
  );

  assert.equal(r.startDate, null, "a year nobody wrote must not survive");
  assert.equal(r.endDate, null);
  assert.deepEqual(
    r.dateProblems.map((p) => [p.field, p.code, p.received]),
    [
      ["startDate", "date_year_not_stated", "2023-09-01"],
      ["endDate", "date_year_not_stated", "2023-09-30"],
    ]
  );

  // The rest of the reading is NOT thrown away — same principle the ISO check
  // already followed. A bad date is not a bad classification.
  assert.equal(r.intent, "work_authorization");
  assert.equal(r.destinationCountry, "ES");
  assert.equal(r.source, "llm");
});

test("a stated year is carried through untouched", async () => {
  const r = await classifyTravelInquiry(
    { text: "Working from Spain 1 September 2026 to 21 September 2026." },
    llm({ startDate: "2026-09-01", endDate: "2026-09-21" })
  );
  assert.equal(r.startDate, "2026-09-01");
  assert.equal(r.endDate, "2026-09-21");
  assert.equal("dateProblems" in r, false, "a grounded reading records no problem");
});

test("the model cannot smuggle a different year past a stated one", async () => {
  const r = await classifyTravelInquiry(
    { text: "Working from Spain in September 2026." },
    llm({ startDate: "2027-09-01", endDate: "2027-09-21" })
  );
  assert.equal(r.startDate, null, "2027 is not the year in the request");
  assert.equal(r.endDate, null);
});

// ---------------------------------------------------------------------------
// 3. The rule-based path assumed the CURRENT year, which is the same defect
// ---------------------------------------------------------------------------

test("the rule-based reader no longer emits a year it assumed", () => {
  const text = "Working from Portugal, September 14 to October 2.";

  // The helper still answers "what dates does this text mention" — unchanged,
  // still exported, still its own tests. What changed is that its answer is no
  // longer treated as something the requester stated.
  const parsed = parseItineraryDates(text);
  assert.ok(parsed.startDate, "the helper itself still reads the month-day form");
  assert.equal(parsed.startDate.slice(0, 4), String(new Date().getFullYear()));

  const r = classifyTravelInquiryRuleBased({ text });
  assert.equal(r.startDate, null, "an assumed year is still a year nobody wrote");
  assert.equal(r.endDate, null);
});

test("the rule-based reader keeps a date whose year IS written", () => {
  const r = classifyTravelInquiryRuleBased({ text: "Working from Portugal 2026-09-14 to 2026-10-02." });
  assert.equal(r.startDate, "2026-09-14");
  assert.equal(r.endDate, "2026-10-02");
});

// ---------------------------------------------------------------------------
// 4. The consequence that made this worth fixing
// ---------------------------------------------------------------------------

test("with no grounded dates the LETTER says 'to be confirmed', not a date nobody gave", () => {
  const employment = {
    full_name: "Chris Lee", job_title: "Staff Engineer", status: "active",
    contract_type: "employee", start_date: "2024-01-15", country_code: "US",
  };
  const entity = { name: "Remote US EOR Inc.", address: "1 Example Way" };

  const invented = renderTravelLetterHtml({
    employment, legalEntity: entity, destinationCountry: "ES",
    startDate: "2023-09-01", endDate: "2023-09-30",
  });
  assert.match(invented, /2023-09-01/, "control: the template does print whatever it is handed");

  // Which is exactly why the classifier must not hand it one.
  const grounded = renderTravelLetterHtml({
    employment, legalEntity: entity, destinationCountry: "ES",
    startDate: null, endDate: null,
  });
  assert.match(grounded, /to be confirmed/);
  assert.doesNotMatch(grounded, /2023/, "no date may appear on a letter when none was stated");
});
