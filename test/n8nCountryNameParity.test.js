// ---------------------------------------------------------------------------
// n8nCountryNameParity.test.js — the two ported country-name tables, guarded
// ---------------------------------------------------------------------------
// WHY THESE COPIES EXIST AT ALL, AND WHY THIS FILE IS THE PRICE OF THEM
//
// `src/shared/countryNames.js` is the ONE country-name source: derived from
// `src/portal/countries.js`, which comes from CLDR through Node's own ICU. Its
// header says why deriving rather than copying is the whole point — *"two
// hand-maintained country lists drift, and the drift is invisible until a picker
// offers a country a renderer cannot name."*
//
// The UC-07 and UC-08 n8n Code nodes have NO IMPORTS. Their narratives are what
// a Mobility Legal and a Tax Ops specialist read as the ticket's internal note,
// and CLAUDE.md's standing instruction is that those surfaces name countries
// rather than print codes. That left three options and only one of them is
// defensible:
//
//   * a bare `DE` on the specialist's screen — the thing being fixed;
//   * a PARTIAL hand-written list — worse than the bare code, because
//     `structuredPlan` carries any alpha-2 straight off the webhook, so some
//     countries would be named and the rest printed as codes with nothing
//     saying which was which;
//   * a COMPLETE generated table with a test that fails when it drifts.
//
// This is that test. It reads the table back out of each node file — the real
// deployed body, not a re-import of the shared module — and asserts it agrees
// with `countryNames.js` for every code that module can name. A regenerated
// CLDR list, a hand-edit, or a `sed` that catches one file and not the other all
// fail here rather than reaching a specialist.
//
// It also pins the ported `countryLabel()`'s three behaviours, because those are
// the ones the shared module's header says were paid for with a real defect:
// a value that is not code-shaped is returned untouched (never re-cased into
// "PORTUGAL"), an unnameable code falls back to the code, and an absent value
// yields the caller's `absent` string.
// ---------------------------------------------------------------------------

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

import { countryName, nameableCountryCodes } from "../src/shared/countryNames.js";

const PORTS = [
  { name: "workflows/nodes-uc07/relocationGates.js", rel: "../workflows/nodes-uc07/relocationGates.js" },
  { name: "workflows/nodes-uc08/buildDossier.js", rel: "../workflows/nodes-uc08/buildDossier.js" },
];

/**
 * Pull `const COUNTRY_NAMES = {…};` and the `countryLabel()` that reads it out of
 * a node body and evaluate JUST those, in a sandbox. The whole body cannot be
 * run here — it is an n8n Code node that expects `$input` and ends in a
 * `return` — and re-typing the table into this file would defeat the point of
 * the check entirely.
 */
function loadPortedNamer(rel) {
  const source = readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

  const tableStart = source.indexOf("const COUNTRY_NAMES = {");
  assert.notEqual(tableStart, -1, `${rel} has no COUNTRY_NAMES table — the port lost its country names`);
  const tableEnd = source.indexOf("\n};", tableStart);
  assert.notEqual(tableEnd, -1, `${rel}'s COUNTRY_NAMES table is not terminated`);
  const table = source.slice(tableStart, tableEnd + 3);

  const fnStart = source.indexOf("function countryLabel(", tableEnd);
  assert.notEqual(fnStart, -1, `${rel} has no ported countryLabel()`);
  const fnEnd = source.indexOf("\n}", fnStart);
  assert.notEqual(fnEnd, -1, `${rel}'s countryLabel() is not terminated`);
  const fn = source.slice(fnStart, fnEnd + 2);

  const context = vm.createContext({});
  vm.runInContext(`${table}\n${fn}\nglobalThis.__names = COUNTRY_NAMES; globalThis.__label = countryLabel;`, context);
  return { names: context.__names, label: context.__label };
}

for (const port of PORTS) {
  test(`${port.name}'s country table names every country src/shared/countryNames.js does, identically`, () => {
    const { names, label } = loadPortedNamer(port.rel);
    const codes = nameableCountryCodes();
    assert.ok(codes.length > 200, "sanity: the shared source should hold the full ISO list");

    const wrong = [];
    for (const code of codes) {
      const expected = countryName(code);
      // `label()` rather than `names[code]` so the whole path is exercised —
      // a table that is right and a lookup that is broken is still a specialist
      // reading a code.
      if (label(code) !== expected) wrong.push(`${code}: port says ${JSON.stringify(label(code))}, shared says ${JSON.stringify(expected)}`);
    }
    assert.deepEqual(wrong, [], `${port.name} has drifted from src/shared/countryNames.js`);

    // And no extra codes: a row the shared source does not have is a row nobody
    // can check, which is how a wrong name survives.
    const extra = Object.keys(names).filter((c) => !codes.includes(c));
    assert.deepEqual(extra, [], `${port.name} names codes the shared source does not`);
  });

  test(`${port.name}'s countryLabel() keeps the three behaviours the shared one paid for`, () => {
    const { label } = loadPortedNamer(port.rel);

    // 1. Not code-shaped -> returned as given. The shared header records the
    //    real defect: countryLabel("Portugal") once answered "PORTUGAL".
    assert.equal(label("Portugal"), "Portugal");
    assert.equal(label("PRT"), "PRT", "an alpha-3 stays visibly an alpha-3, never dressed up as a rendered value");
    assert.equal(label("  Portugal  "), "Portugal");

    // 2. A code-shaped value nothing can name -> the code, never a blank and
    //    never an invented name.
    assert.equal(label("ZZ"), "ZZ");

    // 3. Absent -> the caller's word for absent.
    assert.equal(label(""), "not stated");
    assert.equal(label(null), "not stated");
    assert.equal(label(undefined, "not given"), "not given");

    // And the ordinary case, in both cases used by the narratives.
    assert.equal(label("pt"), "Portugal");
    assert.equal(label("NL"), "Netherlands");
  });
}
