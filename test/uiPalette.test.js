// ---------------------------------------------------------------------------
// uiPalette.test.js  —  The design system's colours, checked rather than trusted
// ---------------------------------------------------------------------------
// WHY THIS FILE EXISTS
// CLAUDE.md §9 says charts and dashboards must RUN the palette validator rather
// than eyeball colour accessibility. That rule was followed once, by hand, and
// then the result lived only in a comment — so the next person to nudge a token
// "a shade darker for balance" had nothing stopping them. This is the same move
// the repo already made for the n8n Code nodes and the browser assets: the
// duplication (a hex in CSS, a claim in a comment) is pinned by a test instead
// of hoped about.
//
// It checks the two DISTINCT colour jobs this repo has, with the right gate for
// each — which is the substance, not the arithmetic:
//
//   1. THE STATE SCALE (--r-dot-settled/waiting/stopped) is a *status* palette.
//      It answers "what state is this in?" for the risk tier, the decision badge
//      and the lifecycle status, and the WORD is always printed beside the dot.
//      Its gate is the 3:1 mark floor against every ground it actually lands on
//      — including the badge pill, which is darker than the card and is where
//      the previous values (#16a34a / #d97706) silently failed at 2.89 and 2.79.
//      It is deliberately NOT held to the categorical CVD gate: green vs red is
//      ~ΔE 5 under deuteranopia, which is exactly why it must never be used in a
//      chart, and is fine here because colour is a redundant second cue.
//
//   2. THE CATEGORICAL PALETTE (--r-series-auto/human/escalate) is a *series*
//      palette, used in exactly one place — the metrics page's decision-mix
//      chart — where adjacent fills touch and hue IS the separator. It is held
//      to the real thing: CVD ΔE >= 8 between adjacent slots.
//      It was called `--r-decision-*` until the name lured four surfaces into
//      painting decision BADGES with it — an aqua-green `escalate` beside an
//      orange `human_review`. Renaming it was half the fix; the other half is
//      the last test in this file, which now checks every surface that paints
//      a decision mark rather than the two that happened to be checked first.
//
// Keeping both in one file is deliberate: the bug this replaced was the two
// palettes being confused for each other.
// ---------------------------------------------------------------------------

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CSS = readFileSync(join(__dirname, "..", "src", "shared", "ui", "remote-ui.css"), "utf8");

// -- colour maths -------------------------------------------------------------
// WCAG 2.x relative luminance + contrast, and the OKLab distance the dataviz
// method uses for CVD separation (Euclidean in OKLab x100). Implemented here
// rather than imported so the suite stays dependency-free and hermetic.

const srgbToLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

function rgb(hex) {
  const h = hex.replace("#", "");
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
}

function contrast(a, b) {
  const lum = (hex) => {
    const [r, g, bl] = rgb(hex).map(srgbToLinear);
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

function oklab(hex) {
  const [r, g, b] = rgb(hex).map(srgbToLinear);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

const deltaE = (a, b) =>
  Math.hypot(...oklab(a).map((v, i) => (v - oklab(b)[i]) * 100));

/**
 * Machado–Oliveira–Fernandes 2009 at severity 1.0 — the simulation model the
 * dataviz method's thresholds are calibrated against, so it is part of the
 * standard rather than an implementation detail.
 */
const CVD = {
  protan: [0.152286, 1.052583, -0.204868, 0.114503, 0.786281, 0.099216, -0.003882, -0.048116, 1.051998],
  deutan: [0.367322, 0.860646, -0.227968, 0.280085, 0.672501, 0.047413, -0.01182, 0.04294, 0.968881],
};

function simulate(hex, kind) {
  const m = CVD[kind];
  const [r, g, b] = rgb(hex).map(srgbToLinear);
  const out = [
    m[0] * r + m[1] * g + m[2] * b,
    m[3] * r + m[4] * g + m[5] * b,
    m[6] * r + m[7] * g + m[8] * b,
  ].map((v) => {
    const c = Math.min(1, Math.max(0, v));
    const s = c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055;
    return Math.round(s * 255)
      .toString(16)
      .padStart(2, "0");
  });
  return "#" + out.join("");
}

/**
 * Pull a custom property's value out of a specific block of the stylesheet.
 * Reading the REAL file is the point: a test asserting hexes it hard-codes
 * would pass forever while the stylesheet drifted underneath it.
 */
function token(name, { dark = false } = {}) {
  // The dark values live in the `:root[data-theme="dark"]` block, which is the
  // last of the three blocks; the light ones in the bare `:root`.
  const scope = dark
    ? CSS.slice(CSS.indexOf(':root[data-theme="dark"]'))
    : CSS.slice(0, CSS.indexOf("@media (prefers-color-scheme: dark)"));
  const match = scope.match(new RegExp("--" + name + ":\\s*(#[0-9a-fA-F]{6})"));
  assert.ok(match, `--${name} not found as a literal hex in the ${dark ? "dark" : "light"} block`);
  return match[1].toLowerCase();
}

// Every ground a state dot actually lands on. The badge pill is the one that
// matters and the one that was missed: it is darker than the card, so a dot
// tuned against white can fail here while looking fine in a spot check.
const GROUNDS = {
  light: { "badge pill": "r-neutral-subtle", "surface-subtle": "r-surface-subtle", page: "r-bg", card: "r-surface" },
  dark: { "badge pill": "r-neutral-subtle", "surface-subtle": "r-surface-subtle", card: "r-surface", page: "r-bg" },
};

const STATE_ROLES = ["r-dot-settled", "r-dot-waiting", "r-dot-stopped"];

for (const mode of ["light", "dark"]) {
  const dark = mode === "dark";

  test(`the state scale clears the 3:1 mark floor on every ${mode} ground it lands on`, () => {
    for (const role of STATE_ROLES) {
      const hex = token(role, { dark });
      for (const [label, groundToken] of Object.entries(GROUNDS[mode])) {
        const ground = token(groundToken, { dark });
        const ratio = contrast(hex, ground);
        assert.ok(
          ratio >= 3,
          `--${role} (${hex}) is ${ratio.toFixed(2)}:1 on the ${label} (${ground}) in ${mode} mode — a mark needs 3:1. ` +
            `Pick the nearest step that passes on EVERY ground, not just the card.`
        );
      }
    }
  });

  test(`the categorical series palette clears the CVD separation gate in ${mode} mode`, () => {
    // Adjacent pairs: this palette is only ever used for the touching segments
    // of a stacked bar, so the adjacent pairlist is the right one.
    const slots = ["r-series-auto", "r-series-human", "r-series-escalate"].map((t) => token(t, { dark }));
    for (let i = 0; i < slots.length - 1; i += 1) {
      for (const kind of ["protan", "deutan"]) {
        const d = deltaE(simulate(slots[i], kind), simulate(slots[i + 1], kind));
        assert.ok(
          d >= 8,
          `${slots[i]} vs ${slots[i + 1]} is only ΔE ${d.toFixed(1)} under ${kind} in ${mode} mode ` +
            `(need >= 8). Hue is the ONLY separator between adjacent chart fills.`
        );
      }
      const normal = deltaE(slots[i], slots[i + 1]);
      assert.ok(normal >= 15, `${slots[i]} vs ${slots[i + 1]} is only ΔE ${normal.toFixed(1)} to normal vision`);
    }
  });
}

test("the state scale is NOT good enough to be a chart palette — which is why it is never used as one", () => {
  // This test asserts a LIMITATION on purpose. Green vs red collapses under
  // deuteranopia, so if someone ever reaches for these tokens to colour a chart
  // series, the reason that is wrong should be written down and checked rather
  // than remembered. If this ever starts passing the >= 8 gate, the comment in
  // remote-ui.css explaining the two-palette split has gone stale.
  const settled = token("r-dot-settled");
  const stopped = token("r-dot-stopped");
  const d = deltaE(simulate(settled, "deutan"), simulate(stopped, "deutan"));
  assert.ok(
    d < 8,
    `green/red now measure ΔE ${d.toFixed(1)} under deuteranopia. If that is real, remote-ui.css's ` +
      `explanation of why the state scale and the chart palette must stay separate needs revisiting.`
  );

  // And the mitigation that makes it legal anyway: every surface that paints a
  // state dot also prints the word. `content: ""` marks are decoration; the
  // label is a sibling. Pinned by the sidebar/dashboard tests that assert the
  // decision/status LABEL is rendered, not just the class.
  assert.ok(
    // Whitespace-insensitive: the sentence is inside a wrapped block comment.
    /word\s+is\s+always\s+rendered\s+beside\s+the\s+dot/.test(CSS),
    "remote-ui.css must keep stating the icon+label mitigation the state scale depends on"
  );
});

test("no browser surface paints a chart-series colour onto a state mark", () => {
  // The original defect, pinned so it cannot come back: a decision badge wearing
  // the chart-series palette put a green `escalate` beside a red `escalated` in
  // the same dashboard row. Decision badges are state; they take --r-dot-*.
  //
  // THE LIST IS THE POINT, AND IT USED TO BE TWO ENTRIES LONG. When this test
  // was written the sidebar and the unified dashboard were the two surfaces
  // that had just been fixed, so those were the two it checked — and the
  // portal, the playground and the Remote UI stand-in kept painting `escalate`
  // aqua-green for months afterwards with the suite green throughout. A guard
  // that names the surfaces it happens to know about is a guard against a
  // recurrence, not against the defect. `minRules` is per file because the
  // three added here carry fewer decision rules than the sidebar does, and a
  // shared floor would either be vacuous or fail on the smallest file.
  const surfaces = [
    ["zaf-app/assets/style.css", /^\.decision-[a-z_0-9]+\s*\{[^}]*\}/gm, 8],
    ["src/dashboard/assets/style.css", /^\.badge\.decision-[a-z_0-9]+::before\s*\{[^}]*\}/gm, 8],
    ["src/portal/assets/style.css", /^\.badge\.(?:decision|state)-[a-z_0-9]+[^{]*\{[^}]*\}/gm, 6],
    ["src/playground/assets/style.css", /^\.badge\.decision-[a-z_0-9]+::before\s*\{[^}]*\}/gm, 3],
    ["src/remoteui/assets/style.css", /^\.badge\.decision-[a-z_0-9]+\s*\{[^}]*\}/gm, 2],
  ];
  for (const [file, pattern, minRules] of surfaces) {
    const source = readFileSync(join(__dirname, "..", file), "utf8");
    const rules = source.match(pattern) || [];
    assert.ok(
      rules.length >= minRules,
      `${file}: expected at least ${minRules} decision rules to still be there, found ${rules.length}`
    );
    for (const rule of rules) {
      assert.ok(
        !/--r-series-|--r-decision-/.test(rule),
        `${file} paints a state mark with the categorical chart palette:\n  ${rule}\n` +
          `A decision in a table is state, not series identity — use --r-dot-settled/waiting/stopped.`
      );
    }
  }
});

test("the chart-series palette is the metrics chart's and no one else's", () => {
  // The rename that made the surfaces above fixable is only load-bearing while
  // the OLD name stays gone. A stylesheet that reintroduces `--r-decision-*`
  // reintroduces the lure — a token whose name says "decision" and whose value
  // is green for `escalate` — even if it points somewhere harmless today.
  const stylesheets = [
    "src/shared/ui/remote-ui.css",
    "zaf-app/assets/remote-ui.css",
    "zaf-app/assets/style.css",
    "src/dashboard/assets/style.css",
    "src/portal/assets/style.css",
    "src/playground/assets/style.css",
    "src/remoteui/assets/style.css",
    "src/auditview/assets/style.css",
  ];
  for (const file of stylesheets) {
    const source = readFileSync(join(__dirname, "..", file), "utf8");
    const declarations = source.replace(/\/\*[\s\S]*?\*\//g, "");
    assert.ok(
      !/--r-decision-/.test(declarations),
      `${file} still declares or reads --r-decision-*. That name is retired: it is the ` +
        `metrics chart's CATEGORICAL palette and is now --r-series-*, so nothing reads ` +
        `"decision" and paints a badge with it.`
    );
  }

  // And exactly one consumer, named. src/metrics/dashboard.js aliases the three
  // slots onto its own --series-* names; nothing else may read them.
  const dashboard = readFileSync(join(__dirname, "..", "src", "metrics", "dashboard.js"), "utf8");
  assert.match(dashboard, /--series-auto_resolve:\s*var\(--r-series-auto\)/);
  assert.match(dashboard, /--series-escalate:\s*var\(--r-series-escalate\)/);
});
