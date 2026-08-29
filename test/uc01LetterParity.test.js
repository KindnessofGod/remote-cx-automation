// ---------------------------------------------------------------------------
// uc01LetterParity.test.js — L-1 / L-16 / DRIFT-085
// ---------------------------------------------------------------------------
// The two letter renderers, fed ONE fixture, compared on their FACTS.
//
// WHY FACTS AND NOT BYTES. `src/uc01/letter.js` renders a styled page built for
// PDF; `workflows/nodes/renderLetter.js` renders a compact body posted as a
// Zendesk `html_body`. The markup legitimately differs, and demanding byte
// equality would force one of them to be wrong for its own medium. What may
// NEVER differ is what the document SAYS about a named person — which fields it
// states, which it omits, and what it says the employer is.
//
// WHAT THIS FOUND. Until L-16 the n8n node rendered four rows where letter.js
// renders seven: no Employer-of-Record row, no probation row, no job title, no
// "is employed by" sentence, and the raw `contract_type` code printed verbatim.
// That node IS the live path — every letter a real customer has received came
// from it — so the deployed graph was issuing the lesser document while the
// whole test suite exercised the fuller one, and nothing compared them.
// ---------------------------------------------------------------------------

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { renderLetterHtml } from "../src/uc01/letter.js";

const EMPLOYMENT = {
  id: "emp_1",
  full_name: "Amara Okafor",
  job_title: "Senior Engineer",
  status: "active",
  contract_type: "eor",
  start_date: "2022-03-01",
  probation: false,
  // Present on the record and forbidden in the document, on BOTH renderers.
  base_salary: 5000000,
  compensation_gross_amount: 25000,
  salary: 987654,
  currency: "USD",
};
const LEGAL_ENTITY = { name: "Remote Nigeria Ltd", address: "Lagos, Nigeria" };

function renderN8n(employment, legalEntity, extraCtx = {}) {
  const body = readFileSync(new URL("../workflows/nodes/renderLetter.js", import.meta.url), "utf8");
  const sandbox = { $input: { first: () => ({ json: { employment, legalEntity, ...extraCtx } }) }, console };
  vm.createContext(sandbox);
  // JSON round-trip: vm results are cross-realm, and it is what n8n itself does
  // between nodes (CLAUDE.md §6).
  return JSON.parse(JSON.stringify(vm.runInContext(`(function(){${body}})()`, sandbox)))[0].json.letterHtml;
}

/** The FACTS a letter states: its `<th>` labels and the text beside each. */
function facts(html) {
  const rows = [...html.matchAll(/<tr><th>(.*?)<\/th><td>(.*?)<\/td><\/tr>/g)];
  return Object.fromEntries(rows.map(([, label, value]) => [label, value.replace(/<[^>]+>/g, "").trim()]));
}

test("L-1: both renderers state the SAME SET of facts", () => {
  const a = facts(renderLetterHtml(EMPLOYMENT, LEGAL_ENTITY));
  const b = facts(renderN8n(EMPLOYMENT, LEGAL_ENTITY));
  assert.deepEqual(
    Object.keys(b).sort(),
    Object.keys(a).sort(),
    "the two letters state different fields about the same person"
  );
  assert.ok(Object.keys(a).length >= 7, "this test is vacuous if the letter states almost nothing");
});

test("L-1: both renderers state the SAME VALUES, including the contract-type LABEL", () => {
  const a = facts(renderLetterHtml(EMPLOYMENT, LEGAL_ENTITY));
  const b = facts(renderN8n(EMPLOYMENT, LEGAL_ENTITY));
  assert.deepEqual(b, a);
  // The specific defect: `eor` is a code, not something to put in front of a
  // bank. The n8n node printed it raw.
  assert.equal(a["Contract type"], "Employer of Record (EOR) employee");
});

test("L-1: an unrecognised contract code is PRINTED AND MARKED on both, never hidden", () => {
  const odd = { ...EMPLOYMENT, contract_type: "apprentice_scheme" };
  const a = facts(renderLetterHtml(odd, LEGAL_ENTITY));
  const b = facts(renderN8n(odd, LEGAL_ENTITY));
  assert.equal(b["Contract type"], a["Contract type"]);
  assert.match(a["Contract type"], /unrecognised code/);
});

test("L-1: the SAME ABSENCES — a missing job title removes the row on both, never blanks it", () => {
  // A blank row in a document that goes to an immigration officer reads as a
  // stated fact about a named person. Both renderers must drop the row.
  const noTitle = { ...EMPLOYMENT, job_title: null };
  const a = facts(renderLetterHtml(noTitle, LEGAL_ENTITY));
  const b = facts(renderN8n(noTitle, LEGAL_ENTITY));
  assert.ok(!("Job title" in a), "letter.js left a blank job-title row");
  assert.ok(!("Job title" in b), "the n8n node left a blank job-title row");
  assert.deepEqual(Object.keys(b).sort(), Object.keys(a).sort());
});

test("L-1: probation is stated on both — a probationary letter must not read like a confirmed one", () => {
  for (const probation of [true, false]) {
    const a = facts(renderLetterHtml({ ...EMPLOYMENT, probation }, LEGAL_ENTITY));
    const b = facts(renderN8n({ ...EMPLOYMENT, probation }, LEGAL_ENTITY));
    assert.equal(a["On probation"], probation ? "Yes" : "No");
    assert.equal(b["On probation"], a["On probation"]);
  }
});

test("L-1: both name the Employer of Record, and both say the person is employed by it", () => {
  const nodeHtml = renderLetterHtml(EMPLOYMENT, LEGAL_ENTITY);
  const n8nHtml = renderN8n(EMPLOYMENT, LEGAL_ENTITY);
  for (const html of [nodeHtml, n8nHtml]) {
    assert.match(html, /Remote Nigeria Ltd/);
    assert.match(html, /is employed by/);
  }
  assert.equal(facts(n8nHtml)["Employer of Record"], facts(nodeHtml)["Employer of Record"]);
});

test("NEITHER letter states compensation — the whitelist, on both paths", () => {
  // The invariant that survives every other change in this build. Asserted on
  // BOTH renderers, because the one that runs live is the one that was never
  // checked.
  for (const html of [renderLetterHtml(EMPLOYMENT, LEGAL_ENTITY), renderN8n(EMPLOYMENT, LEGAL_ENTITY)]) {
    for (const forbidden of ["5000000", "25000", "987654", "50,000", "USD", "salary", "Salary", "compensation"]) {
      assert.ok(!html.includes(forbidden), `a letter leaked ${forbidden}`);
    }
  }
});

test("the n8n letter fetches nothing from anywhere — it is a document, not a page", () => {
  // The check letter.js already carries, applied to its twin. This document is
  // opened by a landlord, a bank or an immigration officer; an external
  // reference would make each of them call a third party on open, handing over
  // their IP and the fact that they are reading a verification document about a
  // named person.
  const html = renderN8n(EMPLOYMENT, LEGAL_ENTITY);
  assert.ok(!/https?:\/\//.test(html), "the n8n letter carries an external URL");
  assert.ok(!/@import|<script|<link|<img/i.test(html));
});

test("rca-tlb2 (R7-20): both renderers print the reference the requester is told to quote, and both omit it the same way when absent", () => {
  const withRef = facts(renderLetterHtml(EMPLOYMENT, LEGAL_ENTITY, { reference: "abc-123" }));
  const n8nWithRef = facts(renderN8n(EMPLOYMENT, LEGAL_ENTITY, { externalRef: "abc-123" }));
  assert.equal(withRef["Reference"], "abc-123");
  assert.equal(n8nWithRef["Reference"], "abc-123");

  const withoutRef = facts(renderLetterHtml(EMPLOYMENT, LEGAL_ENTITY));
  const n8nWithoutRef = facts(renderN8n(EMPLOYMENT, LEGAL_ENTITY));
  assert.ok(!("Reference" in withoutRef), "letter.js printed a blank/absent reference as a row");
  assert.ok(!("Reference" in n8nWithoutRef), "the n8n node printed a blank/absent reference as a row");
});

test("the n8n renderer REFUSES to name an employer it was not given", () => {
  // The deployed graph has no legal-entity fetch node, so this is not a
  // hypothetical: rendering anyway would put an invented employer name into a
  // document that goes to a bank or an immigration officer — DRIFT-074's false
  // attestation, produced one layer down by a renderer instead of a gate.
  //
  // It throws, so the n8n run errors at a node a human reads. The decision's
  // audit row is already durable by then (written upstream, by design), so a
  // failure here costs the letter and never the record.
  assert.throws(() => renderN8n(EMPLOYMENT, {}), /Refusing to name an employer we did not read/);
  assert.throws(() => renderN8n(EMPLOYMENT, undefined), /Fetch Legal Entity/);
});
