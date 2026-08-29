// ---------------------------------------------------------------------------
// citationVectorSeed.test.js — the chunker, the licence gate, and idempotency
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
//
// `scripts/seed-citation-vectors.mjs` is the pipe between docs/knowledge/ and
// the two pgvector tables, and it has deliberately never been run against
// Supabase. That makes its dry run the ONLY evidence about it, so the dry run
// has to be worth trusting: a chunker that silently produced one passage per
// document, or a licence gate that admitted class (d), would print a plausible
// number and nobody would know.
//
// Three things are pinned here, and each one is a claim docs/RETRIEVAL.md
// makes in public:
//
//   1. THE PASSAGE COUNT IS REAL. The recommendation in that document turns on
//      the corpus being ~100 passages rather than ~10,000 — at 100, BM25 over a
//      labelled corpus beats embedding similarity on recall AND on
//      explainability. If the chunker degenerated, the argument would still
//      read as sound and would be resting on a wrong number.
//
//   2. THE LICENCE GATE FAILS CLOSED. An unknown class, a missing class and
//      class (d) must all be refusals. The failure mode that matters is not a
//      refusal — it is an admission nobody noticed, because a chunk store IS a
//      mirror and the OECD Commentaries may never be mirrored.
//
//   3. A RE-RUN IS FREE AND SILENT. Idempotency is keyed on the content hash,
//      so `diffAgainstStored` is what makes the "$0.00 to re-run" claim true.
//
// HERMETIC BY CONSTRUCTION. Nothing here opens a socket. The script imports
// `pg` and `openai` DYNAMICALLY, inside the --commit branch, so importing the
// module cannot reach a network or a database — and that is asserted below
// rather than assumed, because it is exactly the kind of property a later edit
// breaks by moving one import to the top of the file.
// ---------------------------------------------------------------------------

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  MANIFEST_PATH,
  KNOWLEDGE_DIR,
  MAX_CHUNK_CHARS,
  EMBEDDING_MODELS,
  DEFAULT_MODEL,
  UC07_TABLE,
  UC08_TABLE,
  NON_LICENCE_EXCLUSIONS,
  REQUIRED_COLUMNS,
  admitDocument,
  buildPlan,
  chunkDocument,
  chunkMarkdown,
  contentHash,
  diffAgainstStored,
  estimateCost,
  estimateTokens,
  loadSidecars,
  parseLicenceIndex,
  parseSidecar,
  requiredDdl,
  routeTable,
  upsertSql,
} from "../scripts/seed-citation-vectors.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(__dirname, "..", "scripts", "seed-citation-vectors.mjs");

const SIDECAR_FIXTURE = `# D-99 · Testland — notice periods, TL Code art. 1

| | |
|---|---|
| **Catalogue id** | D-99 |
| **Source name** | Testland Employment Code, article 1 |
| **Publisher / authority** | Ministry of Testing, via testland.example |
| **Exact URL** | <https://testland.example/code/art-1> |
| **Retrieved** | **2026-08-19**, by \`curl\`. HTTP 200, 1,234 bytes. |
| **SHA-256 of the retrieved bytes** | \`${"a".repeat(64)}\` |
| **Licence / basis for inclusion** | Class (a). |

## Article 1, quoted

> The notice period is thirty days.

## What this settles for src/uc05/

The table says thirty and the article says thirty. ${"Padding sentence. ".repeat(60)}

A short tail.
`;

// ---------------------------------------------------------------------------
// Sidecar parsing
// ---------------------------------------------------------------------------

test("parseSidecar lifts provenance out of the table and leaves it out of the body", () => {
  const s = parseSidecar(SIDECAR_FIXTURE, "D-99-tl-notice.md");
  assert.deepEqual(s.documentIds, ["D-99"]);
  assert.equal(s.key, "D-99");
  assert.match(s.title, /Testland/);
  assert.equal(s.publisher, "Ministry of Testing, via testland.example");
  assert.equal(s.sourceUrl, "https://testland.example/code/art-1");
  assert.equal(s.retrievedOn, "2026-08-19");
  assert.equal(s.sourceSha256, "a".repeat(64));
  // The provenance table is metadata, not a passage: no inquiry is ever
  // semantically close to a SHA-256, and a digest rendered beside a statutory
  // quote reads as if it were part of the law.
  assert.ok(!s.body.includes("SHA-256"), "provenance table must not reach the chunked body");
  assert.ok(s.body.startsWith("## Article 1"), "body starts at the first section heading");
});

test("parseSidecar reads every id out of a grouped filename", () => {
  const s = parseSidecar(SIDECAR_FIXTURE, "D-21-D-22-D-23-ca-social-security-agreements.md");
  assert.deepEqual(s.documentIds, ["D-21", "D-22", "D-23"]);
  assert.equal(s.key, "D-21+D-22+D-23");
});

test("parseSidecar refuses a file with no catalogue id rather than inventing one", () => {
  assert.throws(() => parseSidecar(SIDECAR_FIXTURE, "notes.md"), /no D-NN id/);
});

// ---------------------------------------------------------------------------
// Chunking
// ---------------------------------------------------------------------------

test("chunkMarkdown anchors every passage to its heading", () => {
  const chunks = chunkMarkdown("## Alpha\n\nOne.\n\n## Beta\n\nTwo.\n");
  assert.deepEqual(chunks.map((c) => c.heading), ["Alpha", "Beta"]);
  // The heading is IN the text, not just beside it: the embedded string and
  // the displayed string must be the same string, or the index cannot be
  // checked by reading it.
  assert.ok(chunks[0].text.startsWith("Alpha\n\n"));
  assert.ok(chunks[0].text.includes("One."));
});

test("chunkMarkdown splits an over-long section at paragraph boundaries, never mid-sentence", () => {
  const para = "Sentence one is here. ".repeat(20).trim(); // ~440 chars
  const body = `## Long\n\n${[para, para, para, para].join("\n\n")}\n`;
  const chunks = chunkMarkdown(body);
  assert.ok(chunks.length > 1, "a 1,760-character section must split");
  for (const c of chunks) {
    assert.equal(c.heading, "Long");
    assert.ok(c.text.trimEnd().endsWith("."), `chunk ended mid-sentence: ${JSON.stringify(c.text.slice(-40))}`);
  }
  // Nothing is lost in the split.
  const rejoined = chunks.map((c) => c.text.replace(/^Long\n\n/, "")).join("\n\n");
  assert.equal(rejoined, [para, para, para, para].join("\n\n"));
});

test("chunkMarkdown never cuts a single quoted block, even one over the window", () => {
  // A quoted statutory limb is one paragraph. Half an article is the single
  // failure this corpus exists to prevent, so an over-long paragraph is
  // emitted whole rather than split.
  const limb = "> " + "Artikel 672 lid 2 tekst. ".repeat(80).trim();
  assert.ok(limb.length > MAX_CHUNK_CHARS);
  const chunks = chunkMarkdown(`## Quoted\n\n${limb}\n`);
  assert.equal(chunks.length, 1);
  assert.ok(chunks[0].text.includes(limb));
});

test("chunkMarkdown merges a runt tail back into its own section", () => {
  const para = "Filler sentence here. ".repeat(60).trim();
  const chunks = chunkMarkdown(`## S\n\n${para}\n\nTiny.\n`);
  assert.ok(chunks.every((c) => c.text.length >= 200 || chunks.length === 1));
  assert.ok(chunks[chunks.length - 1].text.includes("Tiny."));
});

test("chunking is deterministic — same bytes, same hashes", () => {
  const s = parseSidecar(SIDECAR_FIXTURE, "D-99-tl.md");
  const a = chunkDocument(s, { licenceClass: "(a)", feeds: ["UC-08"] });
  const b = chunkDocument(s, { licenceClass: "(a)", feeds: ["UC-08"] });
  assert.deepEqual(a.map((c) => c.contentHash), b.map((c) => c.contentHash));
  assert.equal(a[0].contentHash, contentHash(a[0].text));
});

test("citationId is <document>#<index>, so the tables' existing primary key enforces one row per chunk", () => {
  const s = parseSidecar(SIDECAR_FIXTURE, "D-99-tl.md");
  const rows = chunkDocument(s, { licenceClass: "(a)", feeds: ["UC-08"] });
  assert.equal(rows[0].citationId, "D-99#0000");
  assert.deepEqual(rows.map((r) => r.chunkIndex), rows.map((_, i) => i));
  assert.equal(new Set(rows.map((r) => r.citationId)).size, rows.length);
});

test("every chunk carries the provenance needed to trace it back to retrieved bytes", () => {
  const s = parseSidecar(SIDECAR_FIXTURE, "D-99-tl.md");
  for (const row of chunkDocument(s, { licenceClass: "(a)", feeds: ["UC-08"] })) {
    assert.equal(row.documentId, "D-99");
    assert.ok(row.title);
    assert.equal(row.publisher, "Ministry of Testing, via testland.example");
    assert.equal(row.sourceUrl, "https://testland.example/code/art-1");
    assert.equal(row.sourceSha256, "a".repeat(64));
    assert.equal(row.retrievedOn, "2026-08-19");
    assert.equal(row.licenceClass, "(a)");
  }
});

// ---------------------------------------------------------------------------
// Licence gate — every branch is a refusal except the three permitted classes
// ---------------------------------------------------------------------------

test("licence class (d) is refused — paraphrase only, now or ever", () => {
  const v = admitDocument({ documentIds: ["D-30"], licenceClasses: new Set(["d"]) });
  assert.equal(v.admitted, false);
  assert.match(v.reason, /never copied/);
});

test("a mixed document is refused if ANY of its classes is (d)", () => {
  const v = admitDocument({ documentIds: ["D-XX"], licenceClasses: new Set(["a", "d"]) });
  assert.equal(v.admitted, false);
});

test("an unclassified document fails closed", () => {
  const v = admitDocument({ documentIds: ["D-77"], licenceClasses: new Set() });
  assert.equal(v.admitted, false);
  assert.match(v.reason, /fails closed/);
});

test("an unrecognised class fails closed rather than defaulting to permitted", () => {
  const v = admitDocument({ documentIds: ["D-77"], licenceClasses: new Set(["z"]) });
  assert.equal(v.admitted, false);
  assert.match(v.reason, /fails closed/);
});

test("the sanctions registers are refused for a reason that is not their licence", () => {
  for (const id of Object.keys(NON_LICENCE_EXCLUSIONS)) {
    // D-36/37/38's licences are clean — public domain and EU reuse. They are
    // out anyway, because a vector index is a cache with fuzzy lookup and a
    // cached sanctions list is the "helpful fallback" that is dishonest to
    // ship. Passing class (a) here proves the licence is not what stops them.
    const v = admitDocument({ documentIds: [id], licenceClasses: new Set(["a"]) });
    assert.equal(v.admitted, false, `${id} must be excluded even on a clean licence`);
    assert.match(v.reason, /do-not-vendor/);
  }
});

test("classes (a), (b) and (c) admit the SIDECAR, and the reason says source bytes never are", () => {
  for (const cls of ["a", "b", "c"]) {
    const v = admitDocument({ documentIds: ["D-01"], licenceClasses: new Set([cls]) });
    assert.equal(v.admitted, true);
    assert.match(v.reason, /source bytes never chunked/);
  }
});

// ---------------------------------------------------------------------------
// The manifest is the authority on licence class, not this script
// ---------------------------------------------------------------------------

test("parseLicenceIndex reads §4's index and classes every retrieved sidecar", () => {
  const index = parseLicenceIndex(readFileSync(MANIFEST_PATH, "utf8"));
  assert.ok(index.size >= 35, `expected the full index, got ${index.size} rows`);
  assert.equal(index.get("D-30").licenceClass, "d");
  assert.equal(index.get("D-16").licenceClass, "b/c");
  assert.deepEqual(index.get("D-17").feeds, ["UC-04", "UC-07", "UC-08"]);

  // Every sidecar on disk must have a class. A document nobody classified
  // fails closed, so a missing row is a silent exclusion, and a silent
  // exclusion is how a corpus comes to look comprehensive and not be.
  for (const { filename } of loadSidecars()) {
    for (const id of filename.match(/D-\d{2}/g)) {
      assert.ok(index.has(id), `${id} (${filename}) has no licence class in DOWNLOAD-MANIFEST.md §4`);
    }
  }
});

// ---------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------

test("routeTable sends treaty documents to UC-08, mobility-only to UC-07, and the rest nowhere", () => {
  assert.equal(routeTable(["UC-08"]), UC08_TABLE);
  assert.equal(routeTable(["UC-07"]), UC07_TABLE);
  assert.equal(routeTable(["UC-04", "UC-07", "UC-08"]), UC08_TABLE);
  assert.equal(routeTable(["UC-04", "UC-05"]), null);
  assert.equal(routeTable([]), null);
});

// ---------------------------------------------------------------------------
// Idempotency
// ---------------------------------------------------------------------------

test("an unchanged corpus re-runs free: nothing to embed, nothing to write", () => {
  const planned = [
    { citationId: "D-01#0000", contentHash: "h0" },
    { citationId: "D-01#0001", contentHash: "h1" },
  ];
  const stored = [
    { citation_id: "D-01#0000", content_hash: "h0" },
    { citation_id: "D-01#0001", content_hash: "h1" },
  ];
  const d = diffAgainstStored(planned, stored);
  assert.equal(d.toWrite.length, 0);
  assert.equal(d.unchanged.length, 2);
  assert.equal(d.orphaned.length, 0);
});

test("only the chunks whose text changed are re-embedded", () => {
  const planned = [
    { citationId: "D-01#0000", contentHash: "h0" },
    { citationId: "D-01#0001", contentHash: "CHANGED" },
    { citationId: "D-01#0002", contentHash: "h2" },
  ];
  const stored = [
    { citation_id: "D-01#0000", content_hash: "h0" },
    { citation_id: "D-01#0001", content_hash: "h1" },
  ];
  const d = diffAgainstStored(planned, stored);
  assert.deepEqual(d.toWrite.map((r) => r.citationId), ["D-01#0001", "D-01#0002"]);
  assert.deepEqual(d.unchanged.map((r) => r.citationId), ["D-01#0000"]);
});

test("a row the plan no longer produces is REPORTED, never silently deleted", () => {
  // A document shrinking from 5 chunks to 3 leaves two rows behind. Deleting
  // them automatically would let a bad edit quietly drop citations a dossier
  // already showed a specialist; reporting them puts a human in front of it.
  const d = diffAgainstStored(
    [{ citationId: "D-01#0000", contentHash: "h0" }],
    [
      { citation_id: "D-01#0000", content_hash: "h0" },
      { citation_id: "D-01#0004", content_hash: "old" },
    ]
  );
  assert.deepEqual(d.orphaned, ["D-01#0004"]);
});

test("the upsert conflicts on the primary key and no-ops when the content hash is unchanged", () => {
  const sql = upsertSql(UC08_TABLE);
  assert.match(sql, /on conflict \(citation_id\) do update/);
  assert.match(sql, /where uc08_treaty_citation_vectors\.content_hash is distinct from excluded\.content_hash/);
});

// ---------------------------------------------------------------------------
// Cost
// ---------------------------------------------------------------------------

test("the token estimate takes the LARGER of two approximations, so a cost is never understated", () => {
  const text = "word ".repeat(400).trim(); // 1999 chars, 400 words
  const byChars = Math.ceil(text.length / 4);
  const byWords = Math.ceil(400 * 1.33);
  assert.equal(estimateTokens(text), Math.max(byChars, byWords));
  assert.ok(estimateTokens(text) >= byChars);
});

test("estimateCost uses the published rate and refuses a model it has no rate for", () => {
  const c = estimateCost(1_000_000, DEFAULT_MODEL);
  assert.equal(c.usd, EMBEDDING_MODELS[DEFAULT_MODEL].usdPerMillionTokens);
  assert.equal(c.dimensions, 1536);
  assert.throws(() => estimateCost(10, "text-embedding-nope"), /unknown embedding model/);
});

test("text-embedding-3-large is listed with its real 3072 dimensions, which both tables cannot hold", () => {
  // Recorded so the mismatch is visible in the rate card rather than
  // discovered at INSERT time against a vector(1536) column.
  assert.equal(EMBEDDING_MODELS["text-embedding-3-large"].dimensions, 3072);
});

// ---------------------------------------------------------------------------
// Schema — read, never created
// ---------------------------------------------------------------------------

test("requiredDdl is additive only: no create table, no drop, no truncate", () => {
  for (const table of [UC07_TABLE, UC08_TABLE]) {
    const stmts = requiredDdl(table);
    assert.ok(stmts.length >= REQUIRED_COLUMNS.length);
    for (const s of stmts) {
      assert.match(s, /^(alter table .* add column if not exists|create unique index if not exists)/);
      assert.doesNotMatch(s, /\b(drop|truncate|delete)\b/i);
    }
  }
});

test("the script never executes DDL — it prints it", () => {
  const src = readFileSync(SCRIPT, "utf8");
  // requiredDdl() builds the strings; nothing may hand them to a driver.
  assert.doesNotMatch(src, /query\s*\(\s*requiredDdl/);
  assert.doesNotMatch(src, /pool\.query\([`'"]\s*(alter|create|drop)/i);
});

// ---------------------------------------------------------------------------
// Hermeticity, and the dry-run default
// ---------------------------------------------------------------------------

test("pg and openai are imported dynamically, so importing this module opens nothing", () => {
  const src = readFileSync(SCRIPT, "utf8");
  const topLevel = src.split(/^async function main\(/m)[0];
  assert.doesNotMatch(topLevel, /^import .*\b(pg|openai)\b/m);
  assert.doesNotMatch(topLevel, /^import .*shared\/(db|llm)\.js/m);
  assert.match(src, /await import\("\.\.\/src\/shared\/db\.js"\)/);
});

test("the default run is a dry run: no --commit, no writes, exit 0", () => {
  const out = execFileSync(process.execPath, [SCRIPT], { encoding: "utf8" });
  assert.match(out, /DRY RUN\. Nothing was embedded, nothing was written\./);
  assert.match(out, /--commit would write\. It is NOT authorised/);
});

test("the real corpus produces a passage count in the low hundreds — the number the recommendation rests on", () => {
  const plan = buildPlan({
    manifestText: readFileSync(MANIFEST_PATH, "utf8"),
    sidecars: loadSidecars(KNOWLEDGE_DIR),
  });
  // docs/RETRIEVAL.md argues BM25 over ~100 labelled passages beats embedding
  // similarity here. If the chunker ever degenerated to one passage per file
  // (29) or exploded past a thousand, that argument would be resting on a
  // number that had quietly stopped being true.
  assert.ok(
    plan.totals.passagesTotal >= 60 && plan.totals.passagesTotal <= 400,
    `expected a low-hundreds corpus, got ${plan.totals.passagesTotal} passages`
  );
  assert.ok(plan.totals.documentsAdmitted >= 25);
  assert.equal(plan.totals.documentsExcluded, 2, "the two sanctions sidecars, and only those");
  assert.equal(
    plan.totals.passagesTotal,
    plan.totals.passagesSeedable + plan.totals.passagesUnroutable
  );
  // Every citation id in the whole plan is unique — the idempotency key holds
  // across documents, not just within one.
  assert.equal(new Set(plan.rows.map((r) => r.citationId)).size, plan.rows.length);
  // And the cost of embedding the lot once is a rounding error, which is the
  // point docs/RETRIEVAL.md makes: money is not what is being saved.
  assert.ok(plan.costIfAllRouted.usd < 0.05);
});

test("no admitted passage comes from layer-1-statutory/sources/ — a chunk store is a mirror", () => {
  const plan = buildPlan({
    manifestText: readFileSync(MANIFEST_PATH, "utf8"),
    sidecars: loadSidecars(KNOWLEDGE_DIR),
  });
  for (const row of plan.rows) {
    assert.doesNotMatch(row.text, /<!doctype html|<html|<script/i, `${row.citationId} looks like retrieved HTML`);
  }
  // loadSidecars only ever reads D-NN *.md at the top level; sources/ is a
  // subdirectory and readdir does not descend.
  assert.ok(loadSidecars(KNOWLEDGE_DIR).every((s) => s.filename.endsWith(".md")));
});
