// ---------------------------------------------------------------------------
// citationCorpusFreshness.test.js — the committed corpus still matches the docs
// ---------------------------------------------------------------------------
// src/knowledge/citationCorpus.js is GENERATED from
// docs/knowledge/layer-1-statutory/, and the n8n Code node body carries a second
// generated copy for the parity test. Generation buys portability — a Vercel
// function and an n8n Code node cannot walk a docs tree — and the price is
// drift: a corpus that quotes a document as it was, beside a document that has
// since changed.
//
// That failure is silent and it is the worst kind here, because the citation
// still carries a publisher, a URL, a retrieval date and a SHA-256 — every
// signal a specialist uses to decide a quote is trustworthy — while quoting text
// the document no longer contains.
//
// So this regenerates in memory and compares. It reads the same documents the
// generator reads; it does not restate them.
// ---------------------------------------------------------------------------

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { buildCorpusRows, renderN8nFragment, N8N_NODE, BEGIN, END } from "../scripts/build-citation-corpus.mjs";
import { CITATION_PASSAGES } from "../src/knowledge/citationCorpus.js";

test("the committed corpus matches docs/knowledge — regenerate with `npm run build-citation-corpus`", () => {
  const { rows, unmapped } = buildCorpusRows();
  assert.deepEqual(
    unmapped,
    [],
    `these documents feed a retriever but have no jurisdiction entry: ${unmapped.join(", ")}`
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(CITATION_PASSAGES)),
    rows,
    "src/knowledge/citationCorpus.js is stale — run `npm run build-citation-corpus`"
  );
});

test("the n8n node body carries the same corpus, byte for byte", () => {
  // The parity test executes this body in a vm and compares citation ids against
  // the real function. A drifted copy would fail there too, but late and with a
  // confusing message; this fails at the cause and names the command that fixes
  // it.
  const body = readFileSync(N8N_NODE, "utf8");
  const start = body.indexOf(BEGIN);
  const stop = body.indexOf(END, start);
  assert.ok(start !== -1 && stop !== -1, "the generated markers are missing from the n8n node body");
  const committed = body.slice(start, stop + END.length);
  assert.equal(
    committed,
    renderN8nFragment(buildCorpusRows().rows),
    "the n8n node's generated block is stale — run `npm run build-citation-corpus`"
  );
});

test("nothing inside the generated markers was hand-edited into the surrounding code", () => {
  // A generated block is an invitation to edit just this once. The marker pair
  // must appear exactly once, or a later regeneration silently deletes whatever
  // was put between a stray pair.
  const body = readFileSync(N8N_NODE, "utf8");
  assert.equal(body.split(BEGIN).length - 1, 1, "the BEGIN marker must appear exactly once");
  assert.equal(body.split(END).length - 1, 1, "the END marker must appear exactly once");
});
