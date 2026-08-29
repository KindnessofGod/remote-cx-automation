// ---------------------------------------------------------------------------
// contractTypes.test.js — one label map, and the value that proved there were three
// ---------------------------------------------------------------------------
// The defect these tests exist for: a UC-06 panel rendered
// **"Contract type: global_payroll"** — a raw Remote API slug shown to a
// specialist, because `CONTRACT_LABELS` was defined three times (uc01/letter.js,
// shared/employeeSubject.js, uc03/letter.js) and not one of the three copies had
// an entry for the value the LIVE API actually returns.
//
// So there are two kinds of test here, and both matter:
//   * BEHAVIOURAL — an encountered value renders a label, not its slug.
//   * STRUCTURAL  — the three call sites hold no private copy of the map. A
//     behavioural test alone would pass again the moment somebody re-adds a
//     local map "just for this one file", which is exactly how three copies
//     came to exist.
// ---------------------------------------------------------------------------

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  contractTypeName,
  contractTypeLabel,
  labelledContractTypes,
  CONTRACT_TYPE_NOT_DETERMINED,
} from "../src/shared/contractTypes.js";
import { renderLetterHtml } from "../src/uc01/letter.js";
import { renderTravelLetterHtml } from "../src/uc03/letter.js";
import { describeEmployee } from "../src/shared/employeeSubject.js";

const src = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

/** Comments stripped, so a rule cannot be satisfied by a sentence ABOUT the rule
 *  — the same discipline test/uc08.test.js's structural checks use. */
function stripComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

// ---------------------------------------------------------------------------
// The values the system can actually encounter
// ---------------------------------------------------------------------------

test("every contract type the live API returns has a label, including the one that leaked", () => {
  // `normalizeEmployment()` writes `raw.employment_model || raw.type || "unknown"`.
  // These are the values observed in live captures and live probes — see the
  // GROUNDING block in src/shared/contractTypes.js for the provenance of each.
  assert.equal(contractTypeName("contractor"), "Contractor");
  assert.equal(contractTypeName("eor"), "Employer of Record (EOR) employee");
  assert.equal(contractTypeName("employee"), "Employee");

  // THE REPORTED BUG. Before this module existed, all three copies of the label
  // map answered `undefined` here and every caller fell back to the raw slug.
  assert.equal(contractTypeName("global_payroll"), "Global Payroll employee");
  assert.equal(contractTypeName("global_payroll_employee"), "Global Payroll employee");
});

test("the two work_schedule values that reach contract_type through the mock still label", () => {
  // full_time/part_time are `work_schedule` consts, not engagement models, but
  // the flat mock fixtures put them in `contract_type` and every UC-01/UC-03
  // test renders one. Dropping them would reintroduce the bug for the mock.
  assert.equal(contractTypeName("full_time"), "Full-time");
  assert.equal(contractTypeName("part_time"), "Part-time");
});

test("the 'unknown' sentinel is an absence, never a contract type", () => {
  // normalizeEmployment() writes it when Remote offered neither field. Rendering
  // it as a contract type would make it look like one.
  assert.equal(CONTRACT_TYPE_NOT_DETERMINED, "unknown");
  assert.equal(contractTypeName("unknown"), null);
  assert.equal(contractTypeLabel("unknown"), "not recorded");
  assert.equal(contractTypeLabel("unknown", "not stated on the record"), "not stated on the record");
});

test("an absent value prints the caller's absence text, never an empty row", () => {
  assert.equal(contractTypeLabel(undefined), "not recorded");
  assert.equal(contractTypeLabel(null), "not recorded");
  assert.equal(contractTypeLabel("   "), "not recorded");
  assert.equal(contractTypeLabel(42), "not recorded");
});

test("an unrecognised code survives AND is marked as unrecognised", () => {
  // The raw value survives so it can be grepped or quoted; the marker is what
  // stops a reader taking a slug for a curated answer. This is a deliberate
  // departure from countryLabel(), which prints an unnameable ISO code bare —
  // an ISO code is a public standard, a vendor enum slug is not.
  assert.equal(contractTypeLabel("some_new_model"), "some_new_model (unrecognised code)");
  assert.match(contractTypeLabel("some_new_model"), /some_new_model/);
  assert.match(contractTypeLabel("some_new_model"), /unrecognised/);
});

test("lookup is prototype-safe — a Map, not an object literal", () => {
  // uc03/letter.js's countryName() needed a hand-written own-property guard for
  // exactly this (F-21); a Map is right by construction.
  assert.equal(contractTypeName("constructor"), null);
  assert.equal(contractTypeName("__proto__"), null);
  assert.equal(contractTypeName("toString"), null);
  assert.match(contractTypeLabel("constructor"), /unrecognised code/);
});

test("labelledContractTypes() lists the codes and nothing else", () => {
  const codes = labelledContractTypes();
  assert.ok(codes.includes("global_payroll"), "the leaked value must be in the set");
  assert.ok(!codes.includes("unknown"), "the sentinel is not a contract type");
  assert.deepEqual([...new Set(codes)], codes, "no duplicate codes");
});

// ---------------------------------------------------------------------------
// The three former copies now read from one source
// ---------------------------------------------------------------------------

const CALL_SITES = ["../src/uc01/letter.js", "../src/shared/employeeSubject.js", "../src/uc03/letter.js"];

test("no call site keeps a private contract-label map", () => {
  for (const rel of CALL_SITES) {
    const code = stripComments(src(rel));
    assert.doesNotMatch(
      code,
      /CONTRACT_LABELS\s*=/,
      `${rel} still declares its own CONTRACT_LABELS — three copies of this map is the defect, not the fix`
    );
  }
});

test("all three call sites import the shared module", () => {
  for (const rel of CALL_SITES) {
    const code = stripComments(src(rel));
    assert.match(
      code,
      /from\s+"[^"]*contractTypes\.js"/,
      `${rel} does not import src/shared/contractTypes.js`
    );
  }
});

// ---------------------------------------------------------------------------
// End to end, through the three renderers
// ---------------------------------------------------------------------------

const EMPLOYMENT = {
  full_name: "Jan Willem Bakker",
  job_title: "Senior Software Engineer",
  status: "active",
  start_date: "2023-10-01",
  country_code: "NL",
  contract_type: "global_payroll",
  email: "jan.bakker@acme.test",
  compensation_gross_amount: 8000000,
  compensation_currency: "EUR",
};

test("UC-01's letter names the engagement rather than printing the slug", () => {
  const html = renderLetterHtml(EMPLOYMENT, { name: "Acme NL B.V.", address: "Amsterdam" });
  assert.match(html, /Global Payroll employee/);
  assert.doesNotMatch(html, />\s*global_payroll\s*</, "the raw slug must not reach the letter");
});

test("UC-03's travel letter names the engagement rather than printing the slug", () => {
  const html = renderTravelLetterHtml({
    employment: EMPLOYMENT,
    legalEntity: { name: "Acme NL B.V.", address: "Amsterdam" },
    destinationCountry: "PT",
    purpose: "business meetings",
  });
  assert.match(html, /Global Payroll employee/);
  assert.doesNotMatch(html, />\s*global_payroll\s*</, "the raw slug must not reach the letter");
});

test("the ZAF sidebar's employee block names the engagement rather than printing the slug", async () => {
  const subject = await describeEmployee({
    remote: { getEmployment: async () => EMPLOYMENT },
    employmentId: "emp_nl_amend_001",
    fields: ["full_name", "contract_type"],
  });
  const row = subject.fields.find((f) => f.key === "contract_type");
  assert.equal(row.value, "Global Payroll employee", "this is the panel that showed 'global_payroll'");
  assert.equal(row.absence, null);
});

test("the sidebar still reports the 'unknown' sentinel as an absence with its own prose", async () => {
  // A stated limit must survive the tidy-up: this row said WHY it is empty, and
  // that sentence is more useful than any label.
  const subject = await describeEmployee({
    remote: { getEmployment: async () => ({ ...EMPLOYMENT, contract_type: "unknown" }) },
    employmentId: "emp_nl_amend_001",
    fields: ["contract_type"],
  });
  const row = subject.fields.find((f) => f.key === "contract_type");
  assert.equal(row.value, null);
  assert.match(row.absence, /normalizer records 'unknown'/);
});
