#!/usr/bin/env node
// ---------------------------------------------------------------------------
// build-citation-corpus.mjs — turn docs/knowledge/ into a committed data module
// ---------------------------------------------------------------------------
// WHY A GENERATED MODULE AND NOT A DIRECTORY WALK AT RUN TIME
//
// The retriever runs in three places that do not share a filesystem: this repo's
// Node process, a Vercel serverless function, and (as a ported body) an n8n Code
// node. A `readdir` of docs/knowledge works in exactly one of the three. A
// committed data module works in all three and is the only shape that keeps the
// n8n parity test comparing like with like.
//
// The cost of generating is drift — a corpus that no longer matches the
// documents it claims to quote. `test/citationCorpusFreshness.test.js`
// regenerates in memory and compares, so drift fails the suite rather than
// reaching a specialist.
//
// Run: npm run build-citation-corpus
// ---------------------------------------------------------------------------

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildPlan, loadSidecars, MANIFEST_PATH, REPO_ROOT } from "./seed-citation-vectors.mjs";
import { DOCUMENT_JURISDICTIONS } from "../src/knowledge/documentCountries.js";
import { NAME_TO_CODE_FOR_PORT } from "../src/knowledge/lexicalIndex.js";

const OUT = path.join(REPO_ROOT, "src/knowledge/citationCorpus.js");

/** Which retrievers get a bundled corpus. UC-04/UC-05 use a curated map instead. */
const FEEDS = ["UC-07", "UC-08"];

/** The country-name table, at module scope — the identifier inside renderN8nFragment's
 *  template literal is a different thing entirely (it is source text being emitted). */
const NAME_TO_CODE_TABLE = NAME_TO_CODE_FOR_PORT();

/**
 * A BILATERAL PASSAGE THAT NAMES ITS OWN PAIR SERVES ONLY THAT PAIR.
 *
 * WHY (2026-08-30). `documentCountries.js` maps jurisdictions per DOCUMENT,
 * which is the right granularity for almost everything in the corpus. It is the
 * wrong granularity for a bundle: D-27+D-28+D-29 is three separate conventions
 * in one file, so every one of its passages was eligible on any of US/NL, US/PT
 * and US/CA — and the operative clause of a treaty never names its parties
 * ("remuneration derived by a resident of one of the States…"), so lexical
 * scoring cannot tell them apart either. A US/PT question could therefore be
 * answered with the article of the US–Netherlands convention, which is the
 * wrong-jurisdiction failure this whole retrieval leg was built to remove,
 * surviving one level further down.
 *
 * The rule is narrow on purpose: it fires ONLY when a passage's heading names
 * both countries of a pair the document already declares. It can only ever
 * NARROW a passage's reach — it never adds a jurisdiction the document did not
 * claim — so a heading this fails to parse leaves the passage exactly as
 * before, eligible for the whole document's set. That is the fail-safe
 * direction: the cost of a miss is the status quo, and the cost of a false
 * match would be hiding a convention from the pair it governs.
 */
function pairNamedInHeading(heading, pairs, nameToCode) {
  if (!heading || !Array.isArray(pairs) || pairs.length < 2) return null;
  const hay = ` ${String(heading).toLowerCase().replace(/[^a-z0-9]+/g, " ")} `;
  const names = (code) =>
    [code.toLowerCase()].concat(nameToCode.filter(([, c]) => c === code).map(([n]) => n));
  const names_ = (code) => names(code).some((n) => hay.includes(` ${n} `));
  const matched = pairs.filter((pair) => pair.every((code) => names_(code)));
  // Exactly one pair, or the heading is ambiguous and we leave it alone.
  return matched.length === 1 ? matched[0] : null;
}

export function buildCorpusRows() {
  const plan = buildPlan({ manifestText: readFileSync(MANIFEST_PATH, "utf8"), sidecars: loadSidecars() });
  const rows = [];
  const unmapped = new Set();
  for (const r of plan.rows) {
    const feeds = (r.feeds ?? []).filter((f) => FEEDS.includes(f));
    if (feeds.length === 0) continue;
    const j = DOCUMENT_JURISDICTIONS[r.documentId];
    if (!j) { unmapped.add(r.documentId); continue; }
    // See pairNamedInHeading(): narrows a bundled bilateral passage to the one
    // pair its own heading names. Null for every other passage in the corpus.
    const named = pairNamedInHeading(r.heading, j.pairs, NAME_TO_CODE_TABLE);
    rows.push({
      id: r.citationId,
      documentId: r.documentId,
      feeds,
      heading: r.heading ?? null,
      text: r.text,
      // The sidecar H1 sometimes carries a trailing "· RETRIEVED <date>" — useful
      // in the document, noise in a citation on a specialist's screen. The
      // retrieval date is kept as its own field, so nothing is lost by trimming.
      title: r.title ? String(r.title).replace(/\s*·\s*RETRIEVED\b.*$/i, "").trim() : null,
      publisher: r.publisher ?? null,
      sourceUrl: r.sourceUrl ?? null,
      retrievedOn: r.retrievedOn ?? null,
      sourceSha256: r.sourceSha256 ?? null,
      licenceClass: r.licenceClass ?? null,
      countries: named ?? j.countries,
      // Carried into the generated module so the index needs no second import
      // and stays portable to an n8n Code node, which cannot import anything.
      pairs: named ? [named] : (j.pairs ?? null),
      scope: j.scope,
      authority: j.authority,
    });
  }
  return { rows, unmapped: [...unmapped].sort() };
}

export function renderModule({ rows, unmapped }) {
  const header = `// GENERATED FILE — DO NOT EDIT BY HAND.
//
// Produced by scripts/build-citation-corpus.mjs from docs/knowledge/layer-1-statutory/.
// Every passage below is an extract from a SIDECAR that was retrieved from its own
// publishing authority, with the source bytes' SHA-256 recorded beside it. No source
// PDF is ever chunked into this file — the licence gate in the generator forbids it.
//
// Regenerate with: npm run build-citation-corpus
// Drift is caught by: test/citationCorpusFreshness.test.js
//
// Passages: ${rows.length} · documents: ${new Set(rows.map((r) => r.documentId)).size}
${unmapped.length ? `// UNMAPPED (excluded — add to src/knowledge/documentCountries.js): ${unmapped.join(", ")}\n` : ""}
/**
 * @typedef {object} CitationPassage
 * @property {string} id            "<document id>#<zero-padded chunk index>"
 * @property {string} documentId
 * @property {string[]} feeds       which retrievers may return it
 * @property {string|null} heading
 * @property {string} text
 * @property {string|null} title
 * @property {string|null} publisher
 * @property {string|null} sourceUrl
 * @property {string|null} retrievedOn
 * @property {string|null} sourceSha256
 * @property {string|null} licenceClass
 * @property {string[]} countries
 * @property {string} scope
 * @property {string} authority
 */

/** @type {ReadonlyArray<CitationPassage>} */
export const CITATION_PASSAGES = Object.freeze(`;
  return `${header}${JSON.stringify(rows, null, 2)});\n`;
}


// ---------------------------------------------------------------------------
// THE n8n PORT
// ---------------------------------------------------------------------------
// workflows/nodes-uc08/buildDossier.js runs the same retrieval inside an n8n
// Code node, which cannot import anything — so the corpus and the ranking have
// to be INLINE. test/n8nUc08Parity.test.js executes that body in a vm and
// asserts the citation ids match the real function's, so a hand-maintained
// second copy would be caught late and by a confusing failure.
//
// It is therefore GENERATED between markers, from the same rows and the same
// constants as src/. `npm run build-citation-corpus` rewrites both, so the two
// cannot drift by hand. `npm run verify-deployed` still byte-diffs the result
// against the live graph.
// ---------------------------------------------------------------------------

export const N8N_NODE = path.join(REPO_ROOT, "workflows/nodes-uc08/buildDossier.js");
export const N8N_NODE_UC07 = path.join(REPO_ROOT, "workflows/nodes-uc07/relocationGates.js");
export const BEGIN = "// ---- BEGIN GENERATED: statutory corpus · scripts/build-citation-corpus.mjs ----";
export const END = "// ---- END GENERATED ----";

export function renderN8nFragment(rows, feed = "UC-08") {
  // ALL ROWS ARE EMBEDDED, NOT JUST THIS FEED'S, and the feed is applied at
  // QUERY time — which is what src/ does. Embedding only the feed's own
  // passages looks like an obvious saving and silently breaks parity: BM25's
  // IDF and average document length are computed over whatever is in the index,
  // so a 6-passage index and a 55-passage index score the same query
  // differently and cross the relevance floor at different points. UC-07's
  // parity test caught it; UC-08's would not have, because it compares citation
  // ids on scenarios where the difference happened not to change them.
  const uc08 = rows.map((r) => ({
    id: r.id, documentId: r.documentId, heading: r.heading, text: r.text,
    title: r.title, countries: r.countries, pairs: r.pairs, authority: r.authority, feeds: r.feeds,
    // PROVENANCE TRAVELS. UC-07's parity test compares the whole dossier, not
    // just citation ids, and it caught these four being dropped from the n8n
    // copy to save bytes — which would have meant the n8n path showing a
    // specialist a quote with no publisher, no URL, no retrieval date and no
    // hash, while the Node path showed all four. The saving was about 4KB and
    // the cost was the only reason to trust a citation.
    publisher: r.publisher, sourceUrl: r.sourceUrl,
    retrievedOn: r.retrievedOn, sourceSha256: r.sourceSha256,
  }));
  return `${BEGIN}
// Generated — do not edit inside these markers. Mirrors src/knowledge/citationCorpus.js
// and the ranking in src/knowledge/lexicalIndex.js. ${uc08.length} passages,
// filtered at query time to ${feed} — the index statistics must span the whole
// corpus or BM25 scores diverge from src/.
const CITATION_PASSAGES = ${JSON.stringify(uc08)};
const CITATION_FEED = ${JSON.stringify(feed)};
const STOP_TERMS = new Set(['the','a','an','of','to','in','and','or','is','are','be','for','on','as','by','that','this','it','with','from','at','which','we','our','i','my','they','their','you','your','if','not','no','any','was','were','has','have','had','do','does','did','can','will']);
const BM25_K1 = 1.5, BM25_B = 0.75;
const MIN_MATCHED_TERMS = 3, RARE_TERM_MAX_DF = 0.15, MIN_RARE_TERMS = 2;
// Generated from src/shared/countryNames.js + the alias table in
// src/knowledge/lexicalIndex.js, longest name first. It must cover countries
// this corpus holds NOTHING for — that is what lets the filter come back empty
// and fall through to the labelled model paraphrase, instead of answering a
// Germany-Spain question with Canada's residence rule.
const NAME_TO_CODE = ${JSON.stringify(NAME_TO_CODE_FOR_PORT())};
const NAMEABLE_CODES = new Set(NAME_TO_CODE.map((e) => e[1]));
function lxTokenize(text) {
  if (typeof text !== 'string') return [];
  return text.toLowerCase().replace(/[^a-z0-9\\u00C0-\\u024F]+/g, ' ').split(' ').filter((t) => t.length > 1 && !STOP_TERMS.has(t));
}
function lxCountriesNamed(text) {
  if (typeof text !== 'string') return [];
  const found = new Set();
  const hay = ' ' + text.toLowerCase().replace(/\\bu\\.s\\.a?\\.?/g, ' usa ').replace(/[^a-z0-9]+/g, ' ') + ' ';
  for (let i = 0; i < NAME_TO_CODE.length; i += 1) {
    if (hay.indexOf(' ' + NAME_TO_CODE[i][0] + ' ') !== -1) found.add(NAME_TO_CODE[i][1]);
  }
  // Bare codes UPPER CASE ONLY — lower-cased, 'us' is a pronoun and 'it', 'in',
  // 'no', 'is', 'at', 'be', 'or' are all words as well as country codes.
  const upper = text.match(/\\b[A-Z]{2}\\b/g) || [];
  for (let i = 0; i < upper.length; i += 1) {
    if (NAMEABLE_CODES.has(upper[i])) found.add(upper[i]);
  }
  return Array.from(found);
}
function lxServes(p, wanted) {
  if (Array.isArray(p.pairs) && p.pairs.length > 0 && wanted.length >= 2) {
    return p.pairs.some((pair) => pair.every((c) => wanted.indexOf(c) !== -1));
  }
  return wanted.some((c) => (p.countries || []).indexOf(c) !== -1);
}
const LX_DOCS = CITATION_PASSAGES.map((p) => lxTokenize((p.heading || '') + ' ' + (p.title || '') + ' ' + (p.text || '')));
const LX_LEN = LX_DOCS.map((t) => t.length);
const LX_AVG = LX_LEN.length ? LX_LEN.reduce((a, b) => a + b, 0) / LX_LEN.length : 0;
const LX_DF = new Map();
const LX_TF = LX_DOCS.map((terms) => {
  const counts = new Map();
  for (const t of terms) counts.set(t, (counts.get(t) || 0) + 1);
  for (const t of counts.keys()) LX_DF.set(t, (LX_DF.get(t) || 0) + 1);
  return counts;
});
const LX_N = CITATION_PASSAGES.length;
function lxIdf(term) {
  const n = LX_DF.get(term) || 0;
  return Math.max(1e-6, Math.log(1 + (LX_N - n + 0.5) / (n + 0.5)));
}
function lxClearsFloor(matchedOn) {
  if (matchedOn.length >= MIN_MATCHED_TERMS) return true;
  return matchedOn.filter((t) => (LX_DF.get(t) || 0) / (LX_N || 1) <= RARE_TERM_MAX_DF).length >= MIN_RARE_TERMS;
}
function lxSummarize(p) {
  const heading = p.heading ? String(p.heading) : '';
  let body = String(p.text || '');
  if (heading && body.indexOf(heading) === 0) body = body.slice(heading.length);
  body = body.replace(/^\\s*>\\s?/gm, '').replace(/\\s+/g, ' ').trim();
  if (body.length <= 480) return body;
  return body.slice(0, 480).replace(/\\s+\\S*$/, '') + ' \\u2026';
}
function lxTitle(p) {
  const title = p.title ? String(p.title) : p.documentId;
  const heading = p.heading ? String(p.heading).trim() : '';
  if (!heading || title.indexOf(heading) !== -1) return title;
  return title + ' \\u2014 ' + heading;
}
function retrieveStatutoryCitations(text, limit, countries) {
  const terms = Array.from(new Set(lxTokenize(text || '')));
  if (terms.length === 0) return [];
  // An explicit list wins; null means "read the text".
  const wanted = Array.isArray(countries) ? countries : lxCountriesNamed(text || '');
  const scored = [];
  for (let i = 0; i < CITATION_PASSAGES.length; i += 1) {
    const p = CITATION_PASSAGES[i];
    if ((p.feeds || []).indexOf(CITATION_FEED) === -1) continue;
    if (wanted.length > 0 && !lxServes(p, wanted)) continue;
    let score = 0;
    const matchedOn = [];
    for (const t of terms) {
      const f = LX_TF[i].get(t);
      if (!f) continue;
      score += lxIdf(t) * ((f * (BM25_K1 + 1)) / (f + BM25_K1 * (1 - BM25_B + (BM25_B * LX_LEN[i]) / (LX_AVG || 1))));
      matchedOn.push(t);
    }
    if (score > 0 && lxClearsFloor(matchedOn)) scored.push({ passage: p, score: score, matchedOn: matchedOn });
  }
  const rank = { instrument: 0, administrative: 1, model: 2 };
  scored.sort((a, b) => {
    const ra = rank[a.passage.authority] === undefined ? 3 : rank[a.passage.authority];
    const rb = rank[b.passage.authority] === undefined ? 3 : rank[b.passage.authority];
    if (ra !== rb) return ra - rb;
    if (b.score !== a.score) return b.score - a.score;
    return a.passage.id.localeCompare(b.passage.id);
  });
  const seen = new Set(), first = [], rest = [];
  for (const hit of scored) {
    if (seen.has(hit.passage.documentId)) rest.push(hit);
    else { seen.add(hit.passage.documentId); first.push(hit); }
  }
  return first.concat(rest).slice(0, limit === undefined ? 3 : limit).map((h) => ({
    id: h.passage.id,
    title: lxTitle(h.passage),
    summary: lxSummarize(h.passage),
    matchedOn: ['statutory corpus (lexical) — matched on ' + h.matchedOn.slice(0, 6).map((t) => '"' + t + '"').join(', ')],
    documentId: h.passage.documentId,
    publisher: h.passage.publisher,
    sourceUrl: h.passage.sourceUrl,
    retrievedOn: h.passage.retrievedOn,
    sourceSha256: h.passage.sourceSha256,
    countries: h.passage.countries,
    authority: h.passage.authority,
    instrument: h.passage.authority === 'instrument',
  }));
}
${END}`;
}

export function patchN8nNode(rows, file = N8N_NODE, feed = "UC-08") {
  const body = readFileSync(file, "utf8");
  const fragment = renderN8nFragment(rows, feed);
  const start = body.indexOf(BEGIN);
  if (start === -1) throw new Error(`marker not found in ${file} — insert ${BEGIN} / ${END}`);
  const stop = body.indexOf(END, start);
  if (stop === -1) throw new Error(`closing marker not found in ${file}`);
  const next = body.slice(0, start) + fragment + body.slice(stop + END.length);
  writeFileSync(file, next);
  return next.length;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const built = buildCorpusRows();
  writeFileSync(OUT, renderModule(built));
  console.log(`wrote ${OUT}`);
  console.log(`  passages: ${built.rows.length}`);
  console.log(`  documents: ${new Set(built.rows.map((r) => r.documentId)).size}`);
  for (const f of FEEDS) console.log(`  ${f}: ${built.rows.filter((r) => r.feeds.includes(f)).length}`);
  if (built.unmapped.length) console.log(`  ⚠ unmapped documents skipped: ${built.unmapped.join(", ")}`);
  console.log(`  patched ${N8N_NODE} (${patchN8nNode(built.rows)} bytes)`);
  console.log(`  patched ${N8N_NODE_UC07} (${patchN8nNode(built.rows, N8N_NODE_UC07, "UC-07")} bytes)`);
}
