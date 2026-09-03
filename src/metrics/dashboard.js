// ---------------------------------------------------------------------------
// dashboard.js  —  Render the metrics report as one self-contained HTML file
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
// A metrics module nobody looks at is a log file. The audience for these
// numbers is CX leadership, not engineers, so the output is a page you can open
// with no server, no build step and no network — every style inline, no
// external fonts or scripts.
//
// Colours come from a validated categorical palette (see docs/METRICS.md).
// Three rules from that validation are load-bearing and must survive edits:
//   1. Decision colours are assigned by decision, in fixed order, never by rank
//      — so a filter that removes a use case never repaints the survivors.
//   2. Light-mode aqua sits below 3:1 against the surface, so every segment
//      carries a visible label and the page also ships a table view. Identity
//      is never colour alone.
//   3. Status colours (verdicts) are a separate reserved palette and always
//      appear with an icon and a word, never as colour on its own.
// ---------------------------------------------------------------------------

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { pct, costVerdict, LLM_PRICING_USD_PER_MILLION_TOKENS } from "./compute.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * The shared design system (src/shared/ui/remote-ui.css), inlined.
 *
 * Every other surface links `/remote-ui.css` from its own server. This one
 * cannot: `npm run metrics` writes a single file to demo/metrics.html meant to
 * be opened straight from disk, mailed, or attached, and a stylesheet link
 * would break the moment the file left this directory.
 *
 * Reading the shared sheet beats copying it. There is still exactly one
 * definition of the design system in the repo, so this page cannot drift from
 * the other five surfaces unless someone edits the file all six share — which
 * is the whole point of having one.
 */
const SHARED_CSS = readFileSync(join(__dirname, "..", "shared", "ui", "remote-ui.css"), "utf8");

/** Decision → fixed categorical slot. Order is the palette's, not the data's. */
const DECISION_COLORS = {
  auto_resolve: { light: "#2a78d6", dark: "#3987e5", label: "Auto-resolved" },
  human_review: { light: "#eb6834", dark: "#d95926", label: "Human review" },
  escalate: { light: "#1baf7a", dark: "#199e70", label: "Escalated" },
};

/**
 * Verdict → reserved status colour + icon + word. Never colour alone.
 *
 * The colours are now TOKEN REFERENCES, not literals, and that is a fix rather
 * than a tidy-up. The literals they replace were single fixed values used in
 * both themes, and three of them failed against a white surface in light mode:
 * `#fab219` (Iterate) at 1.84:1, `#ec835a` (Stop) at 2.64:1, `#898781`
 * (Insufficient data) at 3.41:1. "Stop" is the most consequential verdict this
 * dashboard can print, and its marker was the least visible thing on the page.
 *
 * Four of the five map onto shared tokens that already carry a validated
 * light AND dark value, so they follow the theme for free. Only `stop` needs a
 * pair of its own — it must stay distinct from `integrity_violation`'s red,
 * since both are failures and only the icon and word separate them otherwise.
 */
const VERDICT_STYLE = {
  healthy: { color: "var(--r-ok)", icon: "●", label: "Healthy" },
  iterate: { color: "var(--r-warn)", icon: "▲", label: "Iterate" },
  insufficient_data: { color: "var(--r-text-secondary)", icon: "○", label: "Insufficient data" },
  stop: { color: "var(--verdict-stop)", icon: "■", label: "Stop" },
  integrity_violation: { color: "var(--r-danger)", icon: "✕", label: "Integrity violation" },
};

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/** USD → a short display string. Sub-cent spend still needs to read as real money, not "$0". */
function humanUsd(usd) {
  if (usd === null || usd === undefined) return "—";
  if (usd === 0) return "$0.00";
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}

/** Milliseconds → a short human duration. */
function humanMs(ms) {
  if (ms === null || ms === undefined) return "—";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
  return `${(ms / 3_600_000).toFixed(1)}h`;
}

/** A hero stat tile. `tone` picks a status colour for the value, when relevant. */
/**
 * The LLM-spend tile, which is the one number on this page that could be read
 * as a fact when it is a floor.
 *
 * WHY THIS IS ITS OWN FUNCTION (2026-08-30, CLAUDE.md §7 item 22). `costVerdict()`
 * has distinguished three states since the day `computeLlmCost()` stopped
 * throwing on an unpriced model — and this tile consulted none of them. It
 * printed `humanUsd(totalUsd)` flat, so on production data, where every call
 * runs on `gpt-5-nano` and no rate exists for it, the screen said **$0.0000**
 * while the report it was rendering said `unpriced`. Two ways to be wrong in
 * the same pixel: a real spend shown as nothing, and "we did not price this"
 * shown as "this was free".
 *
 * `insufficient_data` gets an em dash rather than a zero for the same reason —
 * the seeded dashboard run drives the rule-based classifier on purpose and
 * legitimately makes no OpenAI call at all, and "$0.0000" is a measurement
 * claim that nobody made. A missing number gets investigated; a wrong one gets
 * acted on (§9's rule about reads that feed a dashboard).
 *
 * No rate is invented anywhere here. Money is the one thing the substitution
 * ladder forbids fabricating outright.
 */
function spendTile(costs) {
  const { verdict } = costVerdict(costs);

  if (verdict === "insufficient_data") {
    return statTile({
      label: "Estimated LLM spend",
      value: "—",
      sub: "no attempt recorded token usage — not a measurement of zero spend",
    });
  }

  const perCase =
    costs.perResolvedCase === null
      ? `${costs.callsPriced} priced call(s) — no resolved case yet`
      : `${humanUsd(costs.perResolvedCase)} per resolved case (${costs.callsPriced} priced call(s))`;

  if (verdict === "unpriced") {
    const models = costs.unpriced.models.map((m) => m.model).join(", ");
    return statTile({
      label: "Estimated LLM spend",
      // The "at least" is the whole point: the priced calls are real and the
      // unpriced ones are missing from this figure, so it can only be too low.
      value: `≥ ${humanUsd(costs.totalUsd)}`,
      sub: `FLOOR, not the bill — ${costs.unpriced.calls} call(s) on ${models} have no rate on record`,
    });
  }

  return statTile({ label: "Estimated LLM spend", value: humanUsd(costs.totalUsd), sub: perCase });
}

function statTile({ label, value, sub, tone = null }) {
  const color = tone ? `color:${tone};` : "";
  return `
    <div class="tile">
      <div class="tile-label">${esc(label)}</div>
      <div class="tile-value" style="${color}">${esc(value)}</div>
      <div class="tile-sub">${esc(sub ?? "")}</div>
    </div>`;
}

/**
 * Stacked horizontal bar of the decision mix, one row per use case.
 * Segments carry direct labels (the contrast relief rule) and a 2px surface
 * gap between fills so adjacent segments never blend.
 */
function decisionMixChart(byUseCase) {
  if (byUseCase.length === 0) return "";

  const rows = byUseCase
    .map((u) => {
      const segments = Object.entries(DECISION_COLORS)
        .map(([decision, style]) => {
          const count = u.counts[decision] ?? 0;
          if (count === 0) return "";
          const share = count / u.total;
          // Only label a segment wide enough to hold the text; the tooltip and
          // the table carry the rest.
          const inner = share > 0.12 ? `<span class="seg-label">${count}</span>` : "";
          return `<div class="seg" style="width:${(share * 100).toFixed(2)}%;--seg:var(--series-${decision});"
                       title="${esc(style.label)}: ${count} of ${u.total} (${pct(share)})">${inner}</div>`;
        })
        .join("");

      return `
        <div class="bar-row">
          <div class="bar-name">${esc(u.useCase)}<span class="tier tier-${u.tier}">${esc(u.tier)}</span></div>
          <div class="bar-track">${segments}</div>
          <div class="bar-total">${u.total}</div>
        </div>`;
    })
    .join("");

  const legend = Object.entries(DECISION_COLORS)
    .map(
      ([decision, style]) =>
        `<span class="legend-item"><i style="background:var(--series-${decision})"></i>${esc(style.label)}</span>`
    )
    .join("");

  return `
    <section class="card">
      <h2>Decision mix by use case</h2>
      <p class="hint">How each use case's volume divides between zero-touch, human review and escalation. Hover a segment for counts.</p>
      <div class="legend">${legend}</div>
      <div class="bars">${rows}</div>
    </section>`;
}

/**
 * Ranked exception reasons — a single-series magnitude comparison, so one hue
 * and no legend (the title names the series).
 */
function exceptionChart(reasons) {
  if (reasons.length === 0) {
    return `
    <section class="card">
      <h2>Why cases did not auto-resolve</h2>
      <p class="empty">No exceptions recorded — every case auto-resolved.</p>
    </section>`;
  }

  const max = Math.max(...reasons.map((r) => r.count));
  const rows = reasons
    .map(
      (r) => `
        <div class="bar-row">
          <div class="bar-name wide">${esc(r.reason)}</div>
          <div class="bar-track plain">
            <div class="seg solo" style="width:${((r.count / max) * 100).toFixed(2)}%"
                 title="${esc(r.reason)}: ${r.count} case(s), ${pct(r.share)} of exceptions"></div>
          </div>
          <div class="bar-total">${r.count}<span class="muted share">${pct(r.share)}</span></div>
        </div>`
    )
    .join("");

  return `
    <section class="card">
      <h2>Why cases did not auto-resolve</h2>
      <p class="hint">Ranked by volume. <strong>The top row is the next thing worth engineering</strong> — it is the largest single cause of human handling.</p>
      <div class="bars">${rows}</div>
    </section>`;
}

/** Per-use-case verdicts. This is also the table view the contrast rule requires. */
function verdictTable(byUseCase) {
  const rows = byUseCase
    .map((u) => {
      const v = VERDICT_STYLE[u.verdict] ?? VERDICT_STYLE.insufficient_data;
      return `
      <tr>
        <td><strong>${esc(u.useCase)}</strong></td>
        <td><span class="tier tier-${u.tier}">${esc(u.tier)}</span></td>
        <td class="num">${u.total}</td>
        <td class="num">${u.counts.auto_resolve}</td>
        <td class="num">${u.counts.human_review}</td>
        <td class="num">${u.counts.escalate}</td>
        <td class="num">${pct(u.autoRate)}</td>
        <td class="num">${u.review.acceptRate === null ? "—" : pct(u.review.acceptRate)}</td>
        <td class="num">${humanMs(u.medianHandlingMs)}</td>
        <td class="num">${humanUsd(u.cost.usd)}</td>
        <td class="num">${u.cost.perResolvedCase === null ? "—" : humanUsd(u.cost.perResolvedCase)}</td>
        <td>
          <span class="verdict" style="--v:${v.color}"><i>${v.icon}</i>${esc(v.label)}</span>
          <div class="rationale">${esc(u.rationale)}</div>
        </td>
      </tr>`;
    })
    .join("");

  return `
    <section class="card">
      <h2>Per use case — measurement and verdict</h2>
      <p class="hint">Verdicts are tier-aware. A high auto-resolution rate is the goal only for 🟢 low-tier use cases; for 🔴 high-tier ones any auto-resolution is an integrity violation, not a success.</p>
      <div class="scroll">
        <table>
          <thead>
            <tr>
              <th>Use case</th><th>Tier</th><th class="num">Cases</th>
              <th class="num">Auto</th><th class="num">Review</th><th class="num">Escalate</th>
              <th class="num">Auto rate</th><th class="num">Accept rate</th><th class="num">Median time</th>
              <th class="num">LLM cost</th><th class="num">Cost/resolved</th>
              <th>Verdict</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </section>`;
}

/**
 * The invariant panel. Silence here is the desired state, so say so
 * explicitly. It holds two zero-tolerance checks: the safety breaches (gates
 * bypassed) and the duplicate-call check (an audit trace fired the same call
 * twice outside the retry wrapper's own attempts).
 */
function integrityPanel(safetyBreaches, duplicateCalls) {
  if (safetyBreaches.length === 0 && duplicateCalls.length === 0) {
    return `
    <section class="card ok">
      <h2>Safety invariants</h2>
      <p><span class="verdict" style="--v:var(--r-ok)"><i>●</i>Holding</span></p>
      <p class="hint">No case auto-resolved while carrying escalation flags, no 🔴 high-tier case auto-resolved, and no audit trace shows the same call fired twice outside the retry wrapper's own attempts. These are the conditions the architecture exists to prevent; all are checked against every row on every run.</p>
    </section>`;
  }
  const total = safetyBreaches.length + duplicateCalls.length;
  const safetyItems = safetyBreaches
    .map((b) => `<li><code>${esc(b.caseId)}</code> — <strong>${esc(b.useCase)}</strong>: ${esc(b.detail)}</li>`)
    .join("");
  const dupItems = duplicateCalls
    .map((d) => `<li><code>${esc(d.call)}</code> — ${esc(d.detail)}</li>`)
    .join("");
  return `
    <section class="card bad">
      <h2>Safety invariants</h2>
      <p><span class="verdict" style="--v:var(--r-danger)"><i>✕</i>${total} invariant breach(es)</span></p>
      <p class="hint">Fix these before tuning any rate. An invariant breach is not a bad number; it means a gate was bypassed or a call was fired twice.</p>
      ${safetyItems ? `<ul class="breaches">${safetyItems}</ul>` : ""}
      ${dupItems ? `<ul class="breaches">${dupItems}</ul>` : ""}
    </section>`;
}

/**
 * The "never succeeded" panel. Deliberately NOT folded into the invariant
 * panel above, because it is a different kind of claim and conflating them
 * would blunt both. A breach says "something that must never happen, happened"
 * — act now. This says "something that should sometimes happen, never has" —
 * go and look. The first is a verdict, the second is a question, and a
 * dashboard that shouts both in the same voice trains the reader to ignore it.
 */
function neverSucceededPanel(findings) {
  if (findings.length === 0) {
    return `
    <section class="card ok">
      <h2>Reachability</h2>
      <p><span class="verdict" style="--v:var(--r-ok)"><i>\u25cf</i>Every use case has succeeded at least once</span></p>
      <p class="hint">A gate that structurally cannot reach its own success outcome looks exactly like one refusing correctly \u2014 same decision, same shape, same green suite. The only thing that separates them is a success actually happening, so this checks for one.</p>
    </section>`;
  }
  const items = findings
    .map(
      (f) =>
        `<li><strong>${esc(f.useCase)}</strong> (${esc(f.tier)} tier) \u2014 ${f.total} decision(s), not one of them a success. Most common reason: <code>${esc(f.topReason ?? "none recorded")}</code></li>`
    )
    .join("");
  return `
    <section class="card warn">
      <h2>Reachability</h2>
      <p><span class="verdict" style="--v:var(--r-warn)"><i>!</i>${findings.length} use case(s) have never succeeded</span></p>
      <p class="hint">Each one below has only ever refused. That may be honest \u2014 a run of genuinely hard cases looks identical \u2014 or it may be a gate that <em>cannot</em> succeed, which is this project's most expensive recurring defect and passes every test suite. The way to tell them apart is to construct an input that MUST succeed and watch what happens.</p>
      <ul class="breaches">${items}</ul>
    </section>`;
}

/**
 * Render the whole report to a standalone HTML document.
 * @param {object} report output of computeMetrics()
 * @returns {string} complete HTML
 */
export function renderDashboardHtml(report) {
  const { totals, byUseCase, exceptionReasons, breaches, duplicateCalls, neverSucceeded = [] } = report;

  const tiles = [
    statTile({ label: "Cases handled", value: String(totals.cases), sub: "across all use cases" }),
    statTile({
      label: "Auto-resolution rate",
      value: pct(totals.autoRate),
      sub: `${totals.autoResolved} resolved with no human touch`,
    }),
    statTile({
      label: "Safety invariant breaches",
      value: String(totals.integrityBreaches),
      sub: "must be zero",
      tone: totals.integrityBreaches === 0 ? "var(--r-ok)" : "var(--r-danger)",
    }),
    statTile({
      label: "Duplicate calls",
      value: String(totals.duplicateCalls),
      sub: "must be zero",
      tone: totals.duplicateCalls === 0 ? "var(--r-ok)" : "var(--r-danger)",
    }),
    statTile({
      label: "Median handling time",
      value: humanMs(totals.medianHandlingMs),
      // Only terminal cases count, so today this is effectively the zero-touch
      // path. Saying "creation to resolution" would imply it covers the queued
      // work too, and flatter the automation by excluding exactly the slow part.
      sub: "resolved cases only — queued work excluded",
    }),
    spendTile(report.costs),
  ].join("");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>CX Automation — Impact Metrics</title>
<style>
/* ---------------------------------------------------------------------------
   The shared design system, inlined verbatim — see SHARED_CSS above for why
   this page embeds it instead of linking it.
   --------------------------------------------------------------------------- */
${SHARED_CSS}
/* ---------------------------------------------------------------------------
   This page predates the design system and its CSS refers to its own token
   names throughout. Rather than rewrite several hundred lines of chart CSS —
   and risk changing the geometry of a validated visualisation while nominally
   doing a restyle — the old names are ALIASED onto the shared ones here.

   The aliases inherit light/dark automatically, because remote-ui.css already
   redefines every --r-* token under both prefers-color-scheme and an
   explicit data-theme attribute. That is why the three duplicated palette blocks this
   file used to carry are gone: there was nothing left in them that the shared
   sheet did not already say.

   The three SERIES colours are the exception worth stating explicitly. They
   are the validated categorical palette, and they are validated against the
   surface they sit on — so changing the surface means re-running the check,
   which was done for both modes against the new #ffffff / #16191f card
   surfaces. Light-mode aqua lands at 2.82:1, below the 3:1 line, which is
   exactly why every segment on this page carries a direct label and the page
   also ships a table view. That relief is not decoration; it is what makes
   the palette legal.
   --------------------------------------------------------------------------- */
  :root {
    --surface-1: var(--r-surface);
    --plane: var(--r-bg);
    --text-primary: var(--r-text);
    --text-secondary: var(--r-text-secondary);
    --muted: var(--r-text-muted);
    --grid: var(--r-border);
    --border: var(--r-border);
    --series-auto_resolve: var(--r-series-auto);
    --series-human_review: var(--r-series-human);
    --series-escalate: var(--r-series-escalate);
    /* The ranked exception bars are ONE series, so they take categorical slot 1
       — the same documented hue as --r-series-auto, and for the same reason
       the palette rule exists: every chart colour must be a value from the
       documented palette. This used to be var(--r-brand) (#1f5eff), which is
       the PRODUCT's button blue and is in no palette — a brighter, more
       saturated blue than any validated slot, and the loudest thing on a page
       whose whole argument is measured restraint. Slot 1 carries 4.42:1 light /
       4.84:1 dark against these card surfaces, comfortably over the 3:1 mark
       floor. It no longer collides with the chart above, either: since the
       decision badges moved to the state scale, blue is not "auto-resolved"
       anywhere on this page except inside that chart's own legend. */
    --seq: var(--r-series-auto);
    /* The one verdict colour with no shared token to borrow. Defined here on
       bare :root — complete with no theme set — and redefined under both dark
       guards below, exactly as remote-ui.css does it. 7.0:1 on white. */
    --verdict-stop: #8f4413;
  }
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) { --verdict-stop: #f0a06a; }
  }
  :root[data-theme="dark"] { --verdict-stop: #f0a06a; }
  * { box-sizing:border-box; }
  body {
    margin:0; padding:32px 20px 64px;
    background:var(--plane); color:var(--text-primary);
    /* --r-font, not a second font stack. This page declared its own
       system-ui stack and so rendered in a different typeface from every
       other surface — the one thing that makes six pages read as six
       products no matter how well the colours match. */
    font-family:var(--r-font); font-size:15px; line-height:1.55;
  }
  .wrap { max-width:1080px; margin:0 auto; }
  header { margin-bottom:28px; }
  h1 { font-size:26px; margin:0 0 6px; letter-spacing:-0.01em; }
  .sub { color:var(--text-secondary); margin:0; font-size:14px; }
  .card {
    background:var(--surface-1); border:1px solid var(--border);
    border-radius:var(--r-radius-lg); box-shadow:var(--r-shadow);
    padding:20px 22px; margin-bottom:20px;
  }
  .card.ok { border-left:3px solid var(--r-ok); }
  .card.bad { border-left:3px solid var(--r-danger); }
  h2 { font-size:16px; margin:0 0 4px; letter-spacing:-0.005em; }
  .hint { color:var(--text-secondary); font-size:13px; margin:0 0 16px; }
  .empty { color:var(--muted); font-size:14px; margin:8px 0 0; }
  /* Three across, so six tiles read as two balanced rows. An auto-fit track with
     a 180px floor packed five onto the first row and left the sixth stranded
     alone, which made the last metric look like an afterthought rather than one
     of six equals. Explicit columns collapse to 2 then 1 at the breakpoints. */
  .tiles { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:14px; margin-bottom:20px; }
  @media (max-width:860px) { .tiles { grid-template-columns:repeat(2,minmax(0,1fr)); } }
  .tile { background:var(--surface-1); border:1px solid var(--border); border-radius:var(--r-radius-lg); box-shadow:var(--r-shadow); padding:16px 18px; }
  .tile-label { font-size:12px; color:var(--text-secondary); text-transform:uppercase; letter-spacing:0.04em; }
  .tile-value { font-size:32px; font-weight:600; letter-spacing:-0.02em; margin:6px 0 2px; font-variant-numeric:tabular-nums; }
  .tile-sub { font-size:12px; color:var(--muted); }
  .legend { display:flex; flex-wrap:wrap; gap:16px; margin-bottom:14px; font-size:13px; color:var(--text-secondary); }
  .legend-item { display:inline-flex; align-items:center; gap:7px; }
  .legend-item i { width:11px; height:11px; border-radius:3px; display:inline-block; }
  .bars { display:flex; flex-direction:column; gap:9px; }
  .bar-row { display:grid; grid-template-columns:150px 1fr 90px; gap:12px; align-items:center; }
  .bar-name { font-size:13px; color:var(--text-secondary); display:flex; align-items:center; gap:7px; }
  .bar-name.wide { font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:12px; }
  .bar-track { display:flex; height:26px; border-radius:4px; overflow:hidden; background:var(--grid); }
  /* The ranked exception bars carry no in-bar label, so they do not need the
     26px the labelled stacked bar does. Thinner marks, per the mark spec — a
     column of four full-saturation 26px blocks read as the loudest element on a
     page whose argument is measured restraint. */
  .bar-track.plain { background:transparent; height:16px; }
  .seg {
    background:var(--seg); height:100%;
    display:flex; align-items:center; justify-content:center;
    /* 2px surface gap so adjacent fills never blend into one shape */
    box-shadow:2px 0 0 0 var(--surface-1) inset;
    transition:filter .12s;
  }
  .seg:first-child { box-shadow:none; border-radius:4px 0 0 4px; }
  .seg:last-child { border-radius:0 4px 4px 0; }
  .seg:hover { filter:brightness(1.08); }
  .seg.solo { background:var(--seq); border-radius:4px; box-shadow:none; min-width:3px; }
  /* Black, not white — and this is the load-bearing correction on this page.
     The comment above says light-mode aqua sits at 2.82:1 against the surface,
     and that every segment carrying a direct label is what makes that legal.
     But the label itself WAS white on that same aqua: 2.82:1, i.e. the relief
     for the contrast problem had the identical contrast problem. Black clears
     4.5:1 on all six fills (light 4.72 / 6.56 / 7.46, dark 5.77 / 5.41 / 6.17),
     so the count is actually readable in both themes. It is a fixed colour on
     purpose: it sits on the series fill, which does not change with the page
     surface, so a theme token here would be wrong in one mode. */
  .seg-label { font-size:11px; font-weight:700; color:#000; font-variant-numeric:tabular-nums; }
  .bar-total { font-size:13px; color:var(--text-secondary); text-align:right; font-variant-numeric:tabular-nums; }
  /* "30 57%" read as one broken number. The share is the secondary figure, so
     it goes on its own line under the count rather than beside it. */
  .bar-total .share { display:block; }
  .muted { color:var(--muted); font-size:12px; }
  /* The tier chip carried no tier colour at all — a bordered grey box whose
     only signal was the word inside it, on the one page where tier-awareness is
     the entire argument. It now carries the shared state-scale dot, so a tier
     looks the same here as in the sidebar and on the dashboard. The word stays;
     the dot is the redundant cue, never the carrier. */
  .tier {
    display:inline-flex; align-items:center; gap:5px;
    font-size:10px; text-transform:uppercase; letter-spacing:0.05em;
    padding:2px 7px; border-radius:var(--r-radius-sm);
    border:1px solid var(--border); color:var(--muted);
  }
  .tier::before { content:""; width:7px; height:7px; border-radius:50%; background:var(--r-neutral); }
  .tier-low::before { background:var(--r-dot-settled); }
  .tier-medium::before { background:var(--r-dot-waiting); }
  .tier-high::before { background:var(--r-dot-stopped); }
  .scroll { overflow-x:auto; }
  table { width:100%; border-collapse:collapse; font-size:13px; min-width:960px; }
  th, td { text-align:left; padding:9px 10px; border-bottom:1px solid var(--grid); vertical-align:top; }
  th { font-size:11px; text-transform:uppercase; letter-spacing:0.04em; color:var(--muted); font-weight:600; }
  td.num, th.num { text-align:right; font-variant-numeric:tabular-nums; }
  .verdict { display:inline-flex; align-items:center; gap:6px; font-weight:600; font-size:12px; color:var(--text-primary); white-space:nowrap; }
  .verdict i { color:var(--v); font-style:normal; font-size:13px; }
  .rationale { color:var(--text-secondary); font-size:12px; margin-top:4px; max-width:340px; }
  .breaches { margin:10px 0 0; padding-left:20px; font-size:13px; color:var(--text-secondary); }
  .breaches code { font-size:11px; }
  footer { color:var(--muted); font-size:12px; margin-top:28px; }
  /* This page had no breakpoint at all. The bar rows are a fixed 150px + 90px
     of furniture, so on a phone the actual TRACK — the only part carrying data
     — was squeezed to roughly 40px and every segment became an unreadable
     sliver. Stacking the name above its own full-width track keeps the chart
     legible at the width this report is most likely to be opened at, since it
     is meant to be mailed as a file. */
  @media (max-width:640px) {
    body { padding:22px 14px 48px; }
    .bar-row { grid-template-columns:1fr auto; gap:4px 10px; }
    .bar-name { grid-column:1; }
    .bar-total { grid-column:2; }
    .bar-track { grid-column:1 / -1; }
    .rationale { max-width:none; }
  }
</style>
</head>
<body>
<div class="wrap">
  <header>
    <h1>CX Automation — Impact Metrics</h1>
    <p class="sub">Generated ${esc(report.generatedAt)} · thresholds: auto-rate target ${pct(
      report.thresholds.minAutoRate
    )} (stop below ${pct(report.thresholds.stopAutoRate)}) · specialist acceptance target ${pct(
    report.thresholds.minAcceptRate
  )} (stop below ${pct(report.thresholds.stopAcceptRate)})</p>
  </header>

  <div class="tiles">${tiles}</div>

  ${integrityPanel(breaches, duplicateCalls)}
  ${neverSucceededPanel(neverSucceeded)}
  ${decisionMixChart(byUseCase)}
  ${exceptionChart(exceptionReasons)}
  ${verdictTable(byUseCase)}

  <footer>
    Computed from the <code>cases</code> and <code>review_queue</code> tables plus the
    <code>audit_trace</code> per-attempt trace (for the duplicate-call check AND the LLM cost model).
    LLM spend uses the documented gpt-4o-mini rate (${esc(
      LLM_PRICING_USD_PER_MILLION_TOKENS["gpt-4o-mini"].input
    )}/1M input, ${esc(LLM_PRICING_USD_PER_MILLION_TOKENS["gpt-4o-mini"].output)}/1M output tokens,
    checked ${esc(LLM_PRICING_USD_PER_MILLION_TOKENS["gpt-4o-mini"].checkedAt)}) — never invented.
    Metric definitions and the reasoning behind each threshold are in <code>docs/METRICS.md</code>.
  </footer>
</div>
</body>
</html>`;
}
