// ---------------------------------------------------------------------------
// decisionProseIsCustomerFacing.test.js — the OTHER eight use cases
// ---------------------------------------------------------------------------
// test/zafNoDeveloperArtifacts.test.js renders the real ZAF sidebar and proves
// no repository artifact reaches the screen — for UC-04, the panel that was
// reported. The project owner's next question was the right one: "I hope when I
// check the other use cases, I will not see developer information again."
//
// Rendering all nine needs nine seeded stores and nine handlers. This checks
// the same class at its SOURCE instead, which is where every one of these leaks
// actually lived: `decisionSources.js` and `decisionFacts.js` are the modules
// that compose the prose those panels display, for every use case that has one.
//
// WHY IT IS A SOURCE CHECK AND THE UC-04 ONE IS A RENDER CHECK, and why both
// are needed. A render check proves what a reader sees but only for a case
// somebody seeded. A source check covers every use case and every branch,
// including prose that only appears for a country or an outcome no fixture
// happens to hit — and those are exactly the strings nobody re-reads.
//
// WHAT IS DELIBERATELY EXEMPT: `path` and `bytes`. They are repository
// locations published for a reviewer who HAS the repository, and since
// 2026-08-31 the panel does not render them (see the render check). Exempting
// them by NAME rather than by pattern is the point — a new field carrying a
// path is caught, because the exemption is a list of two keys and not a licence
// for paths in general.
// ---------------------------------------------------------------------------

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const MODULES = [
  "../src/uc04/decisionSources.js",
  "../src/uc04/decisionFacts.js",
  "../src/uc05/decisionSources.js",
  "../src/uc05/decisionFacts.js",
  "../src/uc06/decisionFacts.js",
  "../src/uc07/decisionSources.js",
  "../src/uc08/decisionSources.js",
  "../src/uc09/decisionFacts.js",
  "../src/shared/decisionFacts.js",
];

/** Fields that legitimately hold a repository location. Names, not patterns. */
const EXEMPT_KEYS = new Set(["path", "bytes"]);

const FORBIDDEN = [
  [/\bsrc\/uc0\d\//, "a source-tree path"],
  [/\bsrc\/shared\//, "a source-tree path"],
  [/\bdocs\/[a-z]/i, "a docs/ path"],
  [/\b[A-Za-z0-9._-]+\.(?:js|mjs)\b/, "a source filename"],
  [/\bUC-0\d\.md\b/, "a specification filename"],
  [/\bCONTRADICTIONS\.md\b/, "an internal register filename"],
  [/\buc0\d_[a-z_]+\b/, "a database table name"],
];

/** Every string in a value tree, with the key path it sits at. */
function strings(value, at, out, keyName) {
  if (typeof value === "string") {
    if (!EXEMPT_KEYS.has(keyName)) out.push([at, value]);
    return out;
  }
  if (Array.isArray(value)) value.forEach((v, i) => strings(v, `${at}[${i}]`, out, keyName));
  else if (value && typeof value === "object" && !(value instanceof RegExp)) {
    for (const [k, v] of Object.entries(value)) strings(v, at ? `${at}.${k}` : k, out, k);
  }
  return out;
}

for (const spec of MODULES) {
  test(`no developer artifact in the prose exported by ${spec.replace("../src/", "")}`, async () => {
    const mod = await import(spec);
    const found = [];
    for (const [name, exported] of Object.entries(mod)) {
      if (typeof exported === "function") continue; // a function body is not prose
      for (const [at, s] of strings(exported, name, [], null)) {
        for (const [re, label] of FORBIDDEN) {
          const m = re.exec(s);
          if (m) found.push(`${at}: ${label} ${JSON.stringify(m[0])}\n      …${s.slice(Math.max(0, m.index - 70), m.index + m[0].length + 50)}…`);
        }
      }
    }
    assert.deepEqual(
      found,
      [],
      `this prose renders on a customer-facing sidebar and names repository internals:\n   ${found.join("\n   ")}`
    );
  });
}

// ---------------------------------------------------------------------------
// AND THE SAME CHECK OVER THE SOURCE TEXT, because the first one is blind to
// more than half of this prose.
//
// The check above walks EXPORTED VALUES. Most of the sentences that reach a
// sidebar are not exported constants — they are composed inside a function, per
// country, per outcome, per gate. Run alone, the export walk passed eight of
// nine modules while `src/uc05/decisionFacts.js` still contained "Adding this
// country's statutory notice rule to src/uc05/noticePeriodTable.js" and
// `src/uc04/decisionFacts.js` still named `uc04_authorizations` — both inside
// functions, both destined for a screen. A guard that reports clean on prose it
// never looked at is worse than no guard, so this reads the file.
//
// COMMENTS ARE STRIPPED FIRST, and that distinction is the whole design. This
// repository explains itself in comments and MUST keep naming files, tables and
// findings there — that is where the reasoning lives and it is written for a
// maintainer. The rule is not "never write src/ in this file"; it is "never put
// it in a string a customer will read".
// ---------------------------------------------------------------------------

/** Everything a reader of the RENDERED page could see: no comments, no imports. */
function proseSource(spec) {
  const raw = readFileSync(new URL(spec, import.meta.url), "utf8");
  return raw
    // Import/re-export specifiers name .js files by definition and are not
    // prose. Stripped as whole STATEMENTS, because they span several lines — a
    // line filter left the middle of a multi-line import looking like a string
    // literal, and those false hits buried the real ones.
    .replace(/^[ \t]*(?:import|export)[\s\S]*?from[ \t]*["'][^"']+["'];?/gm, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ")   // block comments
    .replace(/^\s*\/\/.*$/gm, " ")        // whole-line comments
    .replace(/([^:])\/\/.*$/gm, "$1")      // trailing comments, sparing "http://"
    // JSDoc continuation lines. The block-comment strip above is non-greedy and
    // mispairs when a string literal in this file contains "/*", which left the
    // middle of two doc comments looking like prose.
    .replace(/^\s*\*.*$/gm, " ")
    .split("\n")
    // `path:`/`bytes:` are the two exempt fields, same as the export walk above
    // and for the same reason: published for a reviewer who HAS the repository,
    // and not rendered on any screen since 2026-08-31.
    .filter((line) => !/^\s*(path|bytes):/.test(line))
    // ...and the two module constants those fields are BUILT from. Exempt by
    // NAME, like the keys, so a third path constant is still caught.
    .filter((line) => !/^\s*const (KNOWLEDGE|CONTRADICTIONS) =/.test(line))
    .join("\n");
}

for (const spec of MODULES) {
  test(`no developer artifact in the composed prose of ${spec.replace("../src/", "")}`, () => {
    const src = proseSource(spec);
    const found = [];
    for (const [re, label] of FORBIDDEN) {
      const global = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
      let m;
      while ((m = global.exec(src)) !== null) {
        found.push(`${label} ${JSON.stringify(m[0])}\n      …${src.slice(Math.max(0, m.index - 80), m.index + m[0].length + 60).replace(/\s+/g, " ")}…`);
      }
    }
    assert.deepEqual(
      found,
      [],
      `this prose renders on a customer-facing sidebar and names repository internals:\n   ${found.join("\n   ")}`
    );
  });
}
