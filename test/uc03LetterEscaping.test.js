// ---------------------------------------------------------------------------
// uc03LetterEscaping.test.js — the travel letter escapes what it interpolates
// ---------------------------------------------------------------------------
// WHAT THIS PINS, AND WHY IT IS WORTH PINNING BEFORE ANYTHING EXPLOITS IT.
// `src/uc03/letter.js` built its HTML by interpolating raw values for its whole
// life, while `src/uc01/letter.js` — the other renderer reading the same
// employment record — routed every value through an `escapeHtml()`. Today
// nothing reachable puts attacker-controlled text into the travel letter: every
// value arrives from a Remote read or from a country registry. So this is a
// PRECONDITION test, not a regression test for an exploit.
//
// It matters because of what the travel letter now is. The standard letter is
// ISSUED WITH NOBODY IN THE PATH — no specialist reads the document between the
// gates and the consulate — and `docs/TRAVEL-LETTER-INPUTS.md` §6.3/§7 proposes
// putting the employee's own words (a named embassy or consulate) onto it,
// naming this gap as the first of three preconditions. A letter that already
// escapes is a letter that free-text field can be added to; one that does not
// is a document where the first untrusted string is also the first bug.
//
// IT ASSERTS THE RENDERED BYTES, NOT THAT A HELPER WAS CALLED. A test that
// checks `escapeHtml` is imported passes for a template that forgets it on one
// row, which is exactly the row a future edit adds.
// ---------------------------------------------------------------------------

import { test } from "node:test";
import assert from "node:assert/strict";

import { renderTravelLetterHtml } from "../src/uc03/letter.js";

/** Every string a caller controls, carrying markup that must not survive. */
const HOSTILE = {
  employment: {
    full_name: 'Ada <script>alert("x")</script> Lovelace',
    job_title: 'Engineer & "Architect"',
    status: "active<img src=x onerror=alert(1)>",
    contract_type: "full_time",
    start_date: "2020-01-01",
  },
  legalEntity: {
    name: "Remote <b>NL</b> B.V. & Co",
    country_name: "Netherlands</td><td>injected",
  },
  destinationCountry: "DE",
  destinationName: "Germany<script>",
  startDate: "2026-09-20<script>",
  endDate: "2026-09-26",
  reference: 'T-1"><script>alert(1)</script>',
};

test("no interpolated value can open a tag in the travel letter", () => {
  const html = renderTravelLetterHtml(HOSTILE);

  // The document's OWN markup is the only markup. Every `<` a caller supplied
  // has to arrive as `&lt;`, so no caller-supplied substring may appear raw.
  for (const injected of [
    "<script>",
    "</script>",
    "<img src=x",
    "<b>NL</b>",
    "</td><td>injected",
  ]) {
    assert.ok(
      !html.includes(injected),
      `the letter rendered a caller-supplied "${injected}" as markup`
    );
  }

  // …and the text itself is not lost, only escaped: an escaper that dropped the
  // value would pass the assertions above while quietly emptying the letter.
  assert.ok(html.includes("Ada &lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; Lovelace"));
  assert.ok(html.includes("Engineer &amp; &quot;Architect&quot;"));
  assert.ok(html.includes("Remote &lt;b&gt;NL&lt;/b&gt; B.V. &amp; Co"));
  assert.ok(html.includes("Netherlands&lt;/td&gt;&lt;td&gt;injected"));
  assert.ok(html.includes("Germany&lt;script&gt;"));
  assert.ok(html.includes("T-1&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;"));
});

test("an ordinary record is unchanged by escaping", () => {
  // The regression risk of an escaper is that it mangles the 99% case. `&` in a
  // legal entity's name is common ("Rempel & Paucek"); it must render as the
  // entity's name, not as a literal `&amp;` visible to a consular officer.
  const html = renderTravelLetterHtml({
    employment: {
      full_name: "Alexandre Tremblay",
      job_title: "Financial Manager",
      status: "active",
      contract_type: "contractor",
      start_date: "2023-06-26",
    },
    legalEntity: { name: "Rempel-Paucek LLC", country_name: "Canada" },
    destinationCountry: "ES",
    startDate: "2026-09-14",
    endDate: "2026-10-02",
  });
  assert.ok(html.includes("Alexandre Tremblay"));
  assert.ok(html.includes("Financial Manager"));
  assert.ok(html.includes("Rempel-Paucek LLC"));
  assert.ok(html.includes("Spain (ES)"));
  assert.ok(html.includes("2026-09-14 to 2026-10-02"));
});

test("a missing job title renders the em dash, not the word null", () => {
  // escapeHtml(null) is "" by contract, so the `|| \"—\"` fallback has to be
  // applied to the VALUE and not to the escaped result — otherwise an absent
  // title becomes an empty cell and the fallback is dead code.
  const html = renderTravelLetterHtml({
    employment: {
      full_name: "Alex Morgan",
      job_title: null,
      status: "active",
      contract_type: "full_time",
      start_date: "2021-03-01",
    },
    legalEntity: { name: "Remote NL B.V.", country_name: "Netherlands" },
    destinationCountry: "PT",
  });
  assert.ok(html.includes("<td>—</td>"), "the em-dash fallback still renders");
  assert.ok(!html.includes("null"), "no JavaScript null leaks onto the document");
});

// The informational answer is PLAIN TEXT, not HTML, and must not be escaped:
// `renderInformationalAnswer()` is posted as a Zendesk comment body, where
// `&amp;` would be shown to the customer literally. That asymmetry is stated in
// `src/uc03/letter.js` beside both functions so nobody "fixes" the text one.
