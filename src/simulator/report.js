// ---------------------------------------------------------------------------
// report.js  —  renders the QA dashboard
// ---------------------------------------------------------------------------
// Self-contained HTML: no external fonts, scripts or stylesheets, so it opens
// from disk and renders identically offline — the same rule the customer letter
// follows, for the same reason.
//
// DESIGN NOTE — severity is never carried by colour alone. Every severity is
// spelled out in text next to its swatch, so the dashboard is readable in
// greyscale, by a colour-blind reader, and by anyone printing it.
// ---------------------------------------------------------------------------

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FINDINGS, HELD_UP, summarize } from './findings.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Inline the shared design system so the file stands alone. */
function sharedCss() {
  try {
    return readFileSync(join(__dirname, '..', 'shared', 'ui', 'remote-ui.css'), 'utf8');
  } catch {
    return '';
  }
}

const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const SEVERITY_ORDER = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };

export function renderReport({ simulation, findings = FINDINGS } = {}) {
  const s = summarize(findings);
  const sorted = [...findings].sort(
    (a, b) =>
      (a.status === 'open' ? 0 : 1) - (b.status === 'open' ? 0 : 1) ||
      SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]
  );

  const sim = simulation || { meta: {}, perUseCase: [], violations: [] };
  const totalRuns = (sim.perUseCase || []).reduce((a, b) => a + b.runs, 0);
  const totalThrew = (sim.perUseCase || []).reduce((a, b) => a + b.threw, 0);
  const totalViol = (sim.violations || []).reduce((a, b) => a + b.count, 0);

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>QA — Remote CX Automation</title>
<style>
${sharedCss()}
body { background: var(--r-bg, #fff); color: var(--r-text, #111827); font-family: var(--r-font, Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif); margin: 0; line-height: 1.55; }
.wrap { max-width: 1080px; margin: 0 auto; padding: 40px 20px 80px; }
h1 { font-size: 28px; margin: 0 0 6px; letter-spacing: -0.02em; }
h2 { font-size: 18px; margin: 40px 0 12px; letter-spacing: -0.01em; }
.lede { color: var(--r-text-muted, #6b7280); margin: 0 0 28px; max-width: 70ch; }
.tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; }
.tile { border: 1px solid var(--r-border, #e5e7eb); border-radius: 10px; padding: 14px 16px; min-width: 0; background: var(--r-surface, #fff); }
.tile .n { font-size: 26px; font-weight: 650; letter-spacing: -0.02em; }
.tile .k { font-size: 12px; color: var(--r-text-muted, #6b7280); text-transform: uppercase; letter-spacing: .05em; }
table { width: 100%; border-collapse: collapse; font-size: 14px; }
.scroll { overflow-x: auto; border: 1px solid var(--r-border, #e5e7eb); border-radius: 10px; }
th, td { text-align: left; padding: 10px 12px; border-bottom: 1px solid var(--r-border, #e5e7eb); vertical-align: top; }
th { font-size: 12px; text-transform: uppercase; letter-spacing: .05em; color: var(--r-text-muted, #6b7280); background: var(--r-surface-alt, #f9fafb); }
tr:last-child td { border-bottom: 0; }
.sev { display: inline-flex; align-items: center; gap: 6px; font-weight: 600; font-size: 12px; white-space: nowrap; }
.dot { width: 9px; height: 9px; border-radius: 50%; flex: none; }
.CRITICAL .dot { background: #b3261e; } .HIGH .dot { background: #b45309; }
.MEDIUM .dot { background: #1f5eff; } .LOW .dot { background: #6b7280; }
.status { font-size: 12px; font-weight: 600; padding: 2px 8px; border-radius: 999px; border: 1px solid var(--r-border, #e5e7eb); white-space: nowrap; }
.fixed { color: #14632e; border-color: #14632e55; }
.open { color: #b3261e; border-color: #b3261e55; }
.detail { color: var(--r-text-muted, #6b7280); font-size: 13px; margin-top: 4px; }
.proof { font-size: 12px; margin-top: 6px; padding-left: 10px; border-left: 2px solid var(--r-border, #e5e7eb); color: var(--r-text-muted, #6b7280); }
ul.held { margin: 0; padding-left: 18px; color: var(--r-text-muted, #6b7280); font-size: 14px; }
ul.held li { margin-bottom: 6px; }
.note { font-size: 13px; color: var(--r-text-muted, #6b7280); border-left: 3px solid var(--r-brand, #1f5eff); padding: 8px 0 8px 12px; margin: 16px 0; }
code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12.5px; }
:root { color-scheme: light dark; }
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) body { background: #0f1115; color: #e6e8eb; }
  :root:not([data-theme="light"]) .tile, :root:not([data-theme="light"]) .scroll { border-color: #2a2f3a; background: #151922; }
  :root:not([data-theme="light"]) th { background: #1b2029; color: #9aa3b2; }
  :root:not([data-theme="light"]) td { border-color: #2a2f3a; }
  :root:not([data-theme="light"]) .lede, :root:not([data-theme="light"]) .detail,
  :root:not([data-theme="light"]) .proof, :root:not([data-theme="light"]) ul.held { color: #9aa3b2; }
}
</style>
</head>
<body>
<div class="wrap">
  <h1>Quality assurance report</h1>
  <p class="lede">An adversarial end-to-end pass over all nine use cases: a brute-force simulation against the real
  decision logic, plus a hostile review of each risk tier and an authorized penetration test of every HTTP surface.
  Open findings are listed first and as prominently as fixed ones.</p>

  <h2>Findings</h2>
  <div class="tiles">
    <div class="tile"><div class="n">${s.total}</div><div class="k">Total findings</div></div>
    <div class="tile"><div class="n">${s.fixed}</div><div class="k">Fixed</div></div>
    <div class="tile"><div class="n">${s.open}</div><div class="k">Open</div></div>
    <div class="tile"><div class="n">${s.critical}</div><div class="k">Critical</div></div>
    <div class="tile"><div class="n">${s.high}</div><div class="k">High</div></div>
  </div>

  <div class="note"><strong>What the two run counts mean.</strong> The simulation below runs
  <strong>${totalRuns.toLocaleString()}</strong> interactions directly against the real handler functions — hermetic,
  no network, ${((sim.meta.durationMs || 0) / 1000).toFixed(1)}s total. It never calls n8n. Execution counts in the n8n
  dashboard are separate: real workflow runs against live OpenAI, Remote and Zendesk. Neither number substitutes for
  the other.</div>

  <h2>Brute-force simulation</h2>
  <p class="lede">${totalRuns.toLocaleString()} adversarial interactions across all nine use cases — hostile strings,
  homoglyph identities, non-finite money, invalid calendar dates, prototype keys and malformed shapes — with every
  architectural invariant checked after each one. Seed <code>${esc(sim.meta.seed)}</code> reproduces this run exactly.</p>
  <div class="scroll"><table>
    <thead><tr><th>Use case</th><th>Tier</th><th>Runs</th><th>Crashes</th><th>Invariant violations</th><th>Avg latency</th></tr></thead>
    <tbody>
    ${(sim.perUseCase || []).map((b) => `<tr>
      <td><strong>${esc(b.useCase)}</strong></td>
      <td>${esc(b.tier)}</td>
      <td>${b.runs.toLocaleString()}</td>
      <td>${b.threw}</td>
      <td>${b.violations}</td>
      <td>${b.avgLatencyMs} ms</td>
    </tr>`).join('\n')}
    </tbody>
    <tfoot><tr><th>Total</th><th></th><th>${totalRuns.toLocaleString()}</th><th>${totalThrew}</th><th>${totalViol}</th><th></th></tr></tfoot>
  </table></div>

  <h2>Findings register</h2>
  <div class="scroll"><table>
    <thead><tr><th>ID</th><th>Severity</th><th>Status</th><th>Use case</th><th>Finding</th></tr></thead>
    <tbody>
    ${sorted.map((f) => `<tr>
      <td><code>${esc(f.id)}</code></td>
      <td><span class="sev ${esc(f.severity)}"><span class="dot"></span>${esc(f.severity)}</span></td>
      <td><span class="status ${esc(f.status)}">${esc(f.status)}</span></td>
      <td>${esc(f.useCase)}</td>
      <td>
        <strong>${esc(f.title)}</strong>
        <div class="detail">${esc(f.detail)}</div>
        <div class="proof"><strong>Proven by:</strong> ${esc(f.proof)}<br /><strong>${f.status === 'fixed' ? 'Fix' : 'Fix needed'}:</strong> ${esc(f.fix)}</div>
      </td>
    </tr>`).join('\n')}
    </tbody>
  </table></div>

  <h2>Controls that were attacked and held</h2>
  <p class="lede">Knowing which controls survived a real attempt is evidence that the surviving ones are load-bearing.</p>
  <ul class="held">${HELD_UP.map((h) => `<li>${esc(h)}</li>`).join('\n')}</ul>
</div>
</body>
</html>`;
}
