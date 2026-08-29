// ---------------------------------------------------------------------------
// countryNames.test.js — names are read, codes decide, and neither crosses over
// ---------------------------------------------------------------------------
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { countryName, countryLabel, countryNameAndCode, nameableCountryCodes } from "../src/shared/countryNames.js";
import { PORTAL_COUNTRIES } from "../src/portal/countries.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("a code becomes the country's name, however it was written", () => {
  assert.equal(countryName("PT"), "Portugal");
  assert.equal(countryName("nl"), "Netherlands");
  assert.equal(countryName(" es "), "Spain");
  assert.equal(countryName("CA"), "Canada");
});

test("an unnameable code is null, not a guess and not the code", () => {
  // NULL RATHER THAN THE CODE is the whole reason countryLabel() exists
  // separately: a caller that prints the code has DECIDED the reader can cope
  // with one. Folding that decision in here would make an unnameable country
  // indistinguishable from a named one at every call site simultaneously.
  assert.equal(countryName("ZZ"), null);
  assert.equal(countryName("Portugal"), null, "a name is not a code and is not round-tripped");
  assert.equal(countryName(""), null);
  assert.equal(countryName(null), null);
});

test("countryLabel falls back to the code, never to an invented name", () => {
  assert.equal(countryLabel("PT"), "Portugal");
  assert.equal(countryLabel("pt"), "Portugal", "however the code was written");
  assert.equal(countryLabel("ZZ"), "ZZ", "a code we cannot name is still worth quoting");
  assert.equal(countryLabel(""), "not stated");
  assert.equal(countryLabel(null, "none given"), "none given");
});

test("a value that is not code-shaped comes back exactly as it was given", () => {
  // THE DEFECT THIS PINS was in the first version of this module, found by the
  // agent wiring it into the sidebar: `normalizeCountryCode()` upper-cases
  // whatever it receives, so countryLabel("Portugal") answered "PORTUGAL" — a
  // country's name shouted back — and countryLabel("PRT") answered "PRT" as
  // though it were a rendered value. Both look deliberate; neither is.
  //
  // It matters because not every caller holds a code: some server fields carry
  // a name already, some carry prose, and a display helper is where those meet.
  // A fallback that returns something PLAUSIBLE rather than refusing is the
  // shape this repo keeps paying for.
  assert.equal(countryLabel("Portugal"), "Portugal", "not PORTUGAL");
  assert.equal(countryLabel("netherlands"), "netherlands", "case is the caller's, not ours");
  assert.equal(countryLabel("PRT"), "PRT", "an alpha-3 stays visibly an alpha-3");
  assert.equal(countryLabel("US dollars"), "US dollars", "prose is not a country");
  assert.equal(countryLabel("  Spain  "), "Spain", "trimmed, and otherwise untouched");

  // And the pair form must never pair a name with itself.
  assert.equal(countryNameAndCode("Portugal"), "Portugal", "not Portugal (PORTUGAL)");
  assert.equal(countryNameAndCode("PRT"), "PRT");
});

test("countryNameAndCode is for the line somebody may quote elsewhere", () => {
  assert.equal(countryNameAndCode("PT"), "Portugal (PT)");
  assert.equal(countryNameAndCode("ZZ"), "ZZ", "no empty parentheses");
  assert.equal(countryNameAndCode(""), "not stated");
});

test("the names are DERIVED from the picker's list, not a second copy of it", () => {
  // Two hand-maintained country lists drift, and the drift is invisible until a
  // picker offers a country a renderer cannot name. This asserts the two can
  // never disagree, because one is built from the other.
  assert.equal(nameableCountryCodes().length, PORTAL_COUNTRIES.length);
  for (const { code, name } of PORTAL_COUNTRIES) {
    assert.equal(countryName(code), name, `${code} is offerable but not nameable`);
  }
});

test("every demo country is nameable", () => {
  for (const code of ["NL", "PT", "CA", "US"]) {
    assert.ok(countryName(code), `${code} has no name`);
  }
});

test("this module holds no country list of its own, and decides nothing", () => {
  // WHAT THIS IS GUARDING, stated precisely — an earlier version of this test
  // banned "===" outright and duly failed the moment a `typeof` guard was
  // added. A type check is not a country comparison, and a test that cannot
  // tell them apart teaches its reader to weaken it rather than obey it.
  //
  // The two real risks are: a SECOND country list drifting from the generated
  // one, and this module growing a verdict. Both are checked directly.
  const source = readFileSync(path.join(ROOT, "src/shared/countryNames.js"), "utf8");
  const code = source.replace(/^\s*(\/\/.*|\*.*|\/\*.*)$/gm, "");

  // 1. No literal country data. Every name comes from PORTAL_COUNTRIES, which
  //    is generated; a name typed here would be a rival source that nothing
  //    regenerates.
  for (const name of ["Portugal", "Netherlands", "Canada", "Spain", "Germany"]) {
    assert.ok(!code.includes(`"${name}"`), `a country name is typed into the module: ${name}`);
  }
  assert.ok(!/\[\s*"[A-Z]{2}"\s*,/.test(code), "a code list is typed into the module");

  // 2. Nothing here answers true/false. Every export returns a string or null,
  //    so no call site can read a rendering helper as a verdict about a
  //    country — which is how a display value reaches a gate.
  assert.ok(!/\breturn (true|false)\b/.test(code), "an export returns a boolean");

  for (const value of ["PT", "ZZ", "Portugal", "", null, undefined, 42]) {
    for (const fn of [countryName, countryLabel, countryNameAndCode]) {
      const out = fn(value);
      assert.ok(out === null || typeof out === "string", `${fn.name}(${JSON.stringify(value)}) returned ${typeof out}`);
    }
  }
});

test("the gates still compare codes, and no gate imports this module", () => {
  // The division stated in the module header, enforced rather than described.
  const gateDirs = ["src/uc01", "src/uc02", "src/uc03", "src/uc04", "src/uc05", "src/uc06", "src/uc07", "src/uc08", "src/uc09"];
  const offenders = [];
  for (const dir of gateDirs) {
    for (const entry of readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".js")) continue;
      if (!/policyEngine|riskMatrix|Gates|Calculator|Table/i.test(entry.name)) continue;
      const text = readFileSync(path.join(ROOT, dir, entry.name), "utf8");
      if (text.includes("countryNames.js")) offenders.push(`${dir}/${entry.name}`);
    }
  }
  assert.deepEqual(offenders, [], "a deciding module imported the display-name map");
});
