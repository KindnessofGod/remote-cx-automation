// ---------------------------------------------------------------------------
// thirdPartyLetter.test.js — E4-F17 (rca-0nm)
// ---------------------------------------------------------------------------
// Ticket #108: the letter issued on the third-party door path said "This
// letter is issued upon the employee's request…" when it was Northwind Mutual
// Bank who asked, with the employee's consent. Every employment fact in the
// document was correct — this was one sentence of provenance, in a formal
// document going to a lender.
//
// Fixed in TWO files, and both are pinned here — CLAUDE.md §6's "the gates
// exist twice" shape: test/n8nParity.test.js compares DECISIONS, not letter
// prose, so a one-sided edit to only src/uc01/letter.js would not have been
// caught by anything already in the suite.
// ---------------------------------------------------------------------------

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { renderLetterHtml } from "../src/uc01/letter.js";

const EMPLOYMENT = {
  id: "emp_1",
  full_name: "Chris Lee",
  job_title: "Data Scientist",
  status: "active",
  contract_type: "eor",
  start_date: "2023-06-26",
  probation: false,
  compensation_gross_amount: 25000,
};
const LEGAL_ENTITY = { name: "Remote US Inc.", address: "New York, NY" };

function renderN8n(employment, legalEntity, classification) {
  const body = readFileSync(new URL("../workflows/nodes/renderLetter.js", import.meta.url), "utf8");
  const sandbox = { $input: { first: () => ({ json: { employment, legalEntity, classification } }) }, console };
  vm.createContext(sandbox);
  return JSON.parse(JSON.stringify(vm.runInContext(`(function(){${body}})()`, sandbox)))[0].json.letterHtml;
}

test("letter.js: no requestingParty — the ORIGINAL sentence, unchanged", () => {
  const html = renderLetterHtml(EMPLOYMENT, LEGAL_ENTITY);
  assert.match(html, /This letter is issued upon the employee's request for employment verification purposes\./);
});

test("letter.js: a requestingParty renders the bank's name, never the employee's-request sentence", () => {
  const html = renderLetterHtml(EMPLOYMENT, LEGAL_ENTITY, { requestingParty: "Northwind Mutual Bank" });
  assert.match(
    html,
    /This letter is issued upon a request from <strong>Northwind Mutual Bank<\/strong>, with the employee's consent, for employment verification purposes\./
  );
  assert.ok(!html.includes("issued upon the employee's request"), "the old sentence must not also be present");
});

test("letter.js: an empty or whitespace-only requestingParty falls back to the employee's-request sentence, never a blank credit", () => {
  for (const bad of ["", "   ", null, undefined]) {
    const html = renderLetterHtml(EMPLOYMENT, LEGAL_ENTITY, { requestingParty: bad });
    assert.match(html, /issued upon the employee's request/, `requestingParty=${JSON.stringify(bad)} must fall back`);
  }
});

test("letter.js: the requestingParty name is HTML-escaped — it is a third party's own text, not ours", () => {
  const html = renderLetterHtml(EMPLOYMENT, LEGAL_ENTITY, { requestingParty: '<img src=x onerror="alert(1)">Evil Bank' });
  assert.ok(!html.includes("<img"), "an unescaped tag from a requestingParty string would inject markup into the letter");
  assert.match(html, /&lt;img/);
});

test("letter.js: naming the requester discloses NO compensation — the whitelist is unaffected", () => {
  const html = renderLetterHtml(EMPLOYMENT, LEGAL_ENTITY, { requestingParty: "Northwind Mutual Bank" });
  for (const forbidden of ["25000", "25,000", "salary", "Salary", "compensation"]) {
    assert.ok(!html.includes(forbidden), `a third-party-requested letter leaked ${forbidden}`);
  }
});

// --- parity with the n8n node -----------------------------------------------

test("E4-F17 parity: both renderers state the SAME provenance sentence with no requestingParty", () => {
  const node = renderLetterHtml(EMPLOYMENT, LEGAL_ENTITY);
  const n8n = renderN8n(EMPLOYMENT, LEGAL_ENTITY, {});
  assert.match(node, /issued upon the employee's request/);
  assert.match(n8n, /issued upon the employee's request/);
});

test("E4-F17 parity: both renderers name the SAME requesting party, the same way, when one is supplied", () => {
  const node = renderLetterHtml(EMPLOYMENT, LEGAL_ENTITY, { requestingParty: "Northwind Mutual Bank" });
  const n8n = renderN8n(EMPLOYMENT, LEGAL_ENTITY, { requestingParty: "Northwind Mutual Bank" });
  const SENTENCE =
    "This letter is issued upon a request from <strong>Northwind Mutual Bank</strong>, with the employee's consent, for employment verification purposes.";
  assert.ok(node.includes(SENTENCE), "letter.js is missing the exact sentence");
  assert.ok(n8n.includes(SENTENCE), "renderLetter.js (n8n) is missing the exact sentence — this is the finding's own reproduction: a one-sided edit that test/n8nParity.test.js's decision-only comparison would not catch");
});

test("E4-F17 parity: an absent classification object on the n8n side degrades to the default sentence, never throws", () => {
  // Every auto_resolve execution today calls this node with no `classification`
  // key on ctx at all — the node must not assume its shape.
  const html = renderN8n(EMPLOYMENT, LEGAL_ENTITY, undefined);
  assert.match(html, /issued upon the employee's request/);
});
