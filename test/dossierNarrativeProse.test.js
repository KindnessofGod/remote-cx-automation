// ---------------------------------------------------------------------------
// dossierNarrativeProse.test.js — the 🔴 dossiers, read by the people who get them
// ---------------------------------------------------------------------------
// UC-07's narrative is the internal note a Mobility Legal Tier-3 specialist
// reads; UC-08's is the one a Tax Ops specialist reads. Neither is read by
// anybody who wrote this code, and both used to open with this system's own
// private vocabulary: `Request type: permanent_relocation.`,
// `Source country: DE.`, `Deterministic feasibility verdict: BLOCK.`,
// `Flags raised: UC07_MOT_VIOLATION, UC07_EMPLOYMENT_GAP.` and
// `Inquiry type: dual_residency. Jurisdictions mentioned: CA, NL.`
//
// Two rules are being pinned, and the second is the one that is easy to break
// while improving the first:
//
//   1. NO CODE OR SLUG REACHES A READER. Countries by name (CLAUDE.md's
//      standing instruction), types and verdicts in words, flags by the
//      `message` transitionGate.js already wrote for each of them.
//
//   2. EVERY STATED LIMIT SURVIVES. This repository deliberately tells its
//      readers what it does NOT know, and a friendlier sentence that quietly
//      drops "not identified" or turns a NOT_EVALUATED day count into a number
//      is a worse outcome than the slug. UC-08's NOT_EVALUATED branch is the
//      sharpest of these: it must never render as a number and never as 0,
//      because a stated zero reads as "well under the 183-day threshold" —
//      a conclusion nobody computed.
//
// The template path is exercised throughout (`isConfigured: () => false`),
// which is both the production fallback and the only path an n8n Code node has.
// ---------------------------------------------------------------------------

import { test } from "node:test";
import assert from "node:assert/strict";

import { draftNarrative as uc07DraftNarrative } from "../src/uc07/dossierBuilder.js";
import { draftNarrative as uc08DraftNarrative } from "../src/uc08/dossierBuilder.js";

const TEMPLATE_ONLY = { isConfigured: () => false };

const uc07 = (over = {}) =>
  uc07DraftNarrative(
    {
      relocationType: "permanent_relocation",
      sourceCountry: "DE",
      destinationCountry: "PT",
      verdict: "PROCEED",
      flags: [],
      citations: [],
      ...over,
    },
    TEMPLATE_ONLY
  );

const uc08 = (over = {}) =>
  uc08DraftNarrative(
    { inquiryType: "dual_residency", jurisdictions: ["CA", "NL"], presenceDays: null, citations: [], ...over },
    TEMPLATE_ONLY
  );

// ---------------------------------------------------------------------------
// UC-07 — the feasibility dossier
// ---------------------------------------------------------------------------

test("UC-07 names the countries instead of printing their codes", async () => {
  const { narrative } = await uc07();
  assert.match(narrative, /from Germany to Portugal/);
  assert.doesNotMatch(narrative, /Source country: DE/);
  assert.doesNotMatch(narrative, /Destination country: PT/);
  assert.doesNotMatch(narrative, /\bDE\b/);
  assert.doesNotMatch(narrative, /\bPT\b/, "PT is Portugal, and PT is also what a hurried reader takes for 'part-time'");
});

test("UC-07 gives the request type and the verdict words, not slugs", async () => {
  const { narrative } = await uc07({ relocationType: "temporary_workation", verdict: "BLOCK" });
  assert.match(narrative, /a temporary workation/);
  assert.doesNotMatch(narrative, /temporary_workation/);
  assert.match(narrative, /at least one blocking condition/);
  assert.doesNotMatch(narrative, /verdict: BLOCK/);
});

test("UC-07's PROCEED still says, in words, that it is not an approval", async () => {
  // The limit that matters most in a 🔴 use case with no execution path.
  // dossierView.js argues it at length; the narrative must not soften it.
  const { narrative } = await uc07({ verdict: "PROCEED" });
  assert.match(narrative, /NOT an approval/);
  assert.match(narrative, /no execution path/);
});

test("UC-07 gives each flag its meaning, and loses none of them", async () => {
  const flags = [
    { code: "UC07_MOT_VIOLATION", severity: "HIGH", message: "The proposed destination start date does not clear the country's minimum onboarding time." },
    { code: "UC07_EMPLOYMENT_GAP", severity: "HIGH", message: "The proposed timeline leaves an unauthorized employment gap." },
  ];
  const { narrative } = await uc07({ flags, verdict: "BLOCK" });
  assert.match(narrative, /minimum onboarding time/);
  assert.match(narrative, /unauthorized employment gap/);
  assert.match(narrative, /raised 2 point\(s\)/);
  assert.doesNotMatch(narrative, /UC07_/, "a sixteen-entry code taxonomy is not something a reader carries in their head");
});

test("UC-07 falls back to the code when a flag carries no message", async () => {
  // Not a state the gates produce today, and precisely why it must not blank.
  const { narrative } = await uc07({ flags: [{ code: "UC07_SOMETHING_NEW", severity: "LOW" }], verdict: "REVIEW" });
  assert.match(narrative, /UC07_SOMETHING_NEW/);
});

test("UC-07 says WHICH half of the route it could not identify", async () => {
  const neither = (await uc07({ sourceCountry: null, destinationCountry: null })).narrative;
  assert.match(neither, /Neither the country the employee is moving from nor the destination country was identified/);

  const noDestination = (await uc07({ destinationCountry: null })).narrative;
  assert.match(noDestination, /from Germany/);
  assert.match(noDestination, /destination country was not identified/);

  const noSource = (await uc07({ sourceCountry: null })).narrative;
  assert.match(noSource, /to Portugal/);
  assert.match(noSource, /moving from was not identified/);
});

test("UC-07 marks a request type and a verdict it has no wording for", async () => {
  const { narrative } = await uc07({ relocationType: "secondment", verdict: "MAYBE" });
  assert.match(narrative, /unrecognised request type \(secondment\)/);
  assert.match(narrative, /no wording for \(MAYBE\)/);
});

test("UC-07 keeps its research-not-a-decision framing", async () => {
  const { narrative } = await uc07();
  assert.match(narrative, /not a relocation decision or a legal determination/);
});

// ---------------------------------------------------------------------------
// UC-08 — the tax research dossier
// ---------------------------------------------------------------------------

test("UC-08 names the jurisdictions instead of listing their codes", async () => {
  const { narrative } = await uc08();
  assert.match(narrative, /Canada/);
  assert.match(narrative, /Netherlands/);
  assert.match(narrative, /This request names Canada, Netherlands\./);
  assert.doesNotMatch(narrative, /Jurisdictions mentioned: CA, NL/);
});

test("UC-08 gives the inquiry type words, not the classifier's slug", async () => {
  assert.match((await uc08({ inquiryType: "dual_residency" })).narrative, /a dual tax-residency question/);
  assert.match((await uc08({ inquiryType: "withholding" })).narrative, /a payroll-withholding question/);
  assert.match((await uc08({ inquiryType: "totalization" })).narrative, /certificate-of-coverage question/);
  assert.match((await uc08({ inquiryType: "other" })).narrative, /could not place in any of its categories/);
  // The SLUG must not survive, and neither must the form-dump prefix it sat
  // behind. `withholding` on its own is a real English word that legitimately
  // appears in the closing framing sentence ("not a residency, withholding, or
  // coverage determination"), so the check is on the slug forms and the prefix,
  // not on the bare word — a blunter assertion here would fail on the very
  // sentence this file exists to protect.
  for (const t of ["dual_residency", "withholding", "totalization", "other"]) {
    const { narrative } = await uc08({ inquiryType: t });
    assert.doesNotMatch(narrative, /Inquiry type:/);
    assert.doesNotMatch(narrative, /dual_residency|totalization/);
  }
});

test("UC-08 keeps the no-jurisdiction sentence WORD FOR WORD", async () => {
  // This is the sentence that stops a reader supplying a jurisdiction from
  // memory. A confident day count beside `jurisdictions: []` is an answer to a
  // different question printed in the same shape — that was a real dossier.
  const { narrative } = await uc08({ jurisdictions: [] });
  assert.match(narrative, /No specific jurisdiction was identified in the request text\./);
});

test("UC-08 still never renders a NOT_EVALUATED day count as a number — not even 0", async () => {
  const { narrative } = await uc08({
    jurisdictions: ["NL"],
    presenceCountry: "NL",
    presenceDays: { status: "NOT_EVALUATED", days: null, problems: ["row 2: endDate is unreadable"] },
  });
  assert.match(narrative, /could NOT be computed from the supplied records/);
  assert.match(narrative, /row 2: endDate is unreadable/);
  assert.match(narrative, /No day count is available for this inquiry/);
  assert.doesNotMatch(narrative, /distinct day\(s\)/);
  assert.doesNotMatch(narrative, /\b0 \b/, "a stated zero reads as 'well under 183 days', which nobody computed");
});

test("UC-08 still states what it does NOT know about the jurisdictions, beside the count", async () => {
  const { narrative } = await uc08({
    jurisdictions: ["NL"],
    presenceCountry: "NL",
    presenceDays: { days: 273, periodsCounted: 1 },
  });
  assert.match(narrative, /273 distinct day\(s\)/);
  assert.match(narrative, /HOLDS NO RESIDENCE TEST/);
  assert.match(narrative, /Citizenship-based taxation is NOT ASSESSED/);
});

test("UC-08 keeps its research-not-a-determination framing", async () => {
  const { narrative } = await uc08();
  assert.match(narrative, /not a residency, withholding, or coverage determination/);
});
