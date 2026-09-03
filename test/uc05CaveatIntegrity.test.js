// ---------------------------------------------------------------------------
// uc05CaveatIntegrity.test.js — a caveat id with no entry can never reach a screen
// ---------------------------------------------------------------------------
// 2026-09-02: FINDING_SOURCES referenced C-31 (GB), C-32 (IE) and C-33 (PL),
// added by that morning's statute pass, and CAVEAT_LIBRARY had no entry for
// any of them. sourcesForFinding() mapped each id to `undefined`, the API
// published `caveats: [null]`, and the sidebar dereferenced the null
// (`caveat.weight`) and stopped rendering before the Sign off button on every
// UK and Polish resignation — while `actionable: true`. Found by an agent
// driving the real bundle. Both halves are pinned: the library is complete,
// and the resolver never publishes a null even if it is not.
// ---------------------------------------------------------------------------

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { CAVEAT_LIBRARY, FINDING_SOURCES, sourcesForFinding } from "../src/uc05/decisionSources.js";

test("every caveat id any country references has a library entry", () => {
  const missing = [];
  for (const [finding, { byCountry }] of Object.entries(FINDING_SOURCES)) {
    for (const [country, entry] of Object.entries(byCountry)) {
      for (const id of entry.caveats ?? []) {
        if (!CAVEAT_LIBRARY[id]) missing.push(`${finding}.${country} → ${id}`);
      }
    }
  }
  assert.deepEqual(missing, [], "referenced but never defined — the sidebar crashes on the null this produces");
});

test("GB, IE and PL each resolve their own caveat, and no country publishes a null", () => {
  for (const [country, id] of [["GB", "C-31"], ["IE", "C-32"], ["PL", "C-33"]]) {
    const src = sourcesForFinding("statutory_notice_rule", country);
    assert.ok(src, `${country} is sourced`);
    assert.ok(src.caveats.every(Boolean), `${country} publishes a null caveat`);
    assert.ok(src.caveats.some((c) => c.id === id), `${country} lost ${id}`);
    for (const c of src.caveats) assert.ok(["disputed", "unsupported", "incomplete"].includes(c.weight), `${c.id} has weight ${c.weight}`);
  }
});

test("the resolver drops an unresolved id rather than publishing a hole", () => {
  const src = readFileSync(new URL("../src/uc05/decisionSources.js", import.meta.url), "utf8");
  assert.match(src, /\.map\(\(id\) => CAVEAT_LIBRARY\[id\]\)\.filter\(Boolean\)/);
});

test("the sidebar skips a null caveat instead of dying on it", () => {
  const main = readFileSync(new URL("../zaf-app/assets/main.js", import.meta.url), "utf8");
  assert.match(main, /\(group\.caveats \|\| \[\]\)\.filter\(Boolean\)\.forEach/);
});
