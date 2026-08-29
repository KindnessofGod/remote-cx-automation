#!/usr/bin/env node
// ---------------------------------------------------------------------------
// cli.js  —  npm run simulate
// ---------------------------------------------------------------------------
// Runs the brute-force simulation and writes the QA dashboard to
// demo/qa-report.html. Offline and free: no network, no API keys, no cost.
//
//   npm run simulate                 10,000 interactions, default seed
//   npm run simulate -- --count=500  a quick pass while iterating
//   npm run simulate -- --seed=42    a different input distribution
// ---------------------------------------------------------------------------

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { simulate } from './run.js';
import { renderReport } from './report.js';
import { FINDINGS, summarize } from './findings.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function arg(name, fallback) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? Number(hit.split('=')[1]) : fallback;
}

const count = arg('count', 10000);
const seed = arg('seed', 20260815);

console.log(`Simulating ${count.toLocaleString()} adversarial interactions across nine use cases (seed ${seed})…`);
const simulation = await simulate({
  count,
  seed,
  onProgress: ({ done, total }) => process.stdout.write(`\r  ${done}/${total}`),
});
process.stdout.write('\r');

const totalThrew = simulation.perUseCase.reduce((a, b) => a + b.threw, 0);
const totalViol = simulation.violations.reduce((a, b) => a + b.count, 0);

console.log(`\nCompleted in ${(simulation.meta.durationMs / 1000).toFixed(1)}s`);
for (const b of simulation.perUseCase) {
  const flag = b.threw || b.violations ? '  <-- ' : '';
  console.log(
    `  ${b.useCase}  ${b.tier.padEnd(7)} runs=${String(b.runs).padStart(5)}  crashes=${String(b.threw).padStart(4)}  violations=${String(b.violations).padStart(4)}${flag}`
  );
}
console.log(`\n  Crashes: ${totalThrew}    Invariant violations: ${totalViol}`);
if (simulation.violations.length) {
  console.log('\nVIOLATIONS');
  for (const v of simulation.violations) {
    console.log(`  ${v.severity.padEnd(8)} ${v.id} x${v.count}  ${JSON.stringify(v.useCases)}`);
  }
}

const s = summarize(FINDINGS);
console.log(`\nFindings register: ${s.total} total — ${s.fixed} fixed, ${s.open} open (${s.criticalOpen} critical open)`);

const outDir = join(__dirname, '..', '..', 'demo');
mkdirSync(outDir, { recursive: true });
const out = join(outDir, 'qa-report.html');
writeFileSync(out, renderReport({ simulation }), 'utf8');
console.log(`\nDashboard written to ${out}`);
