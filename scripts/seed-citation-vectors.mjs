#!/usr/bin/env node
// ---------------------------------------------------------------------------
// seed-citation-vectors.mjs — chunk, embed and upsert docs/knowledge/ into the
//                             two pgvector tables that have always been empty
// ---------------------------------------------------------------------------
// ⚠ THIS SCRIPT HAS NOT BEEN RUN AGAINST SUPABASE, AND MUST NOT BE UNTIL THE
// REPOSITORY OWNER SAYS SO. `--dry-run` is the default; writing takes an
// explicit `--commit`. Everything recorded about it in docs/RETRIEVAL.md was
// measured from the dry run, which touches no network and no database.
//
// WHY THIS EXISTS
//
// `docs/knowledge/layer-1-statutory/` holds 29 sidecar documents covering 35
// catalogue ids — publisher, exact URL, retrieval date and SHA-256 of the
// retrieved bytes on every one. `uc08_treaty_citation_vectors` and
// `uc07_mobility_citation_vectors` have held ZERO rows since they were
// provisioned on 2026-08-09. Nothing has ever connected the two, so every
// citation any production run has shown came from the keyword fallback over a
// nine-passage hand-written corpus (three in UC-08, six in UC-07) that quotes
// no retrieved document at all.
//
// This script is the missing pipe. It is deliberately also the ARGUMENT
// against using it at this corpus size — the dry run prints the passage count,
// and docs/RETRIEVAL.md reads that number back as the reason a BM25/keyword
// index over the same chunks is the better engineering choice today. A
// pipeline you have built and measured and chosen not to run is a stronger
// artifact than one you ran because it was available.
//
// THE THREE RULES THAT SHAPE WHAT IS IN THE INDEX
//
//   1. ONLY SIDECARS ARE CHUNKED. NEVER `sources/`.
//      A chunk store is a mirror: it holds the bytes, in order, and serves them
//      back on demand. `docs/knowledge/README.md` allows a copy of the
//      retrieved bytes ONLY where the licence permits one, and forbids
//      mirroring for classes (c) and (d) outright. Half the corpus is class (c)
//      and has no committed bytes at all. Rather than run a per-file licence
//      switch over `sources/` — one wrong row and the store is a mirror of
//      something nobody may mirror — the store is built from the SIDECARS,
//      which are this repository's own prose plus the short attributed
//      quotation every class already permits. That is a licence bar and an
//      engineering one at once: the sidecar says what the article SETTLES, in
//      the vocabulary a support ticket uses, where the raw HTML is 80%
//      navigation chrome from wetten.overheid.nl.
//
//   2. CLASS (d) IS EXCLUDED ENTIRELY — sidecar included.
//      OECD Model / Commentaries / BEPS and the MLI matching database are
//      paraphrase-only "now or ever" (DOWNLOAD-MANIFEST §3(d)). That holds
//      regardless of access, so the exclusion is unconditional here.
//
//   3. THE SANCTIONS REGISTERS ARE EXCLUDED, AND NOT FOR LICENCE REASONS.
//      D-36/37/38's licences are clean and D-39's is not, but all four are out
//      for the reason `docs/knowledge/README.md` gives: a checked-in copy of a
//      sanctions list is the "helpful cached fallback" that is dishonest to
//      ship, and CONTRADICTIONS C-16/C-25 show what a flattened one does —
//      the EU register blocks the United States and the UN's reference-number
//      prefixes block the United Kingdom, because `GB` there is Guinea-Bissau.
//      A vector index is a cache with fuzzy lookup. Same rule, harder.
//
// WHAT A STORED ROW CARRIES, AND WHY THE SCHEMA IS NOT READY
//
// Every row must be traceable back to retrieved bytes: `D-NN` id, title,
// publisher, source URL, retrieval date, and the SHA-256 from the sidecar. The
// two tables as provisioned carry five columns — citation_id, title, summary,
// embedding, created_at — and none of the provenance. This script NEVER
// creates or alters schema (the same rule as audit.js, dossierStore.js and
// every other table in this repo). It reads the live columns, prints the exact
// DDL a human must apply, and REFUSES to `--commit` until they exist. An
// untraceable citation in a tax dossier is worse than no citation.
//
// IDEMPOTENCY
//
// `citation_id` is `<document id>#<zero-padded chunk index>`, so the table's
// EXISTING primary key already adjudicates (document, chunk index) — the
// guarantee is the key, not the application code, exactly as workflow_claims
// taught. `content_hash` (SHA-256 of the chunk text) makes a re-run cheap and
// silent: unchanged chunks are skipped before they are embedded, so a second
// run of an unchanged corpus costs $0.00 and writes nothing.
//
// USAGE
//   npm run seed-vectors                  # dry run — the default, no network
//   node scripts/seed-citation-vectors.mjs --json
//   node scripts/seed-citation-vectors.mjs --commit    # NOT AUTHORISED YET
//
// EXIT CODES (matching the verify-* scripts' convention)
//   0  the plan was produced (dry run), or the upsert completed (--commit)
//   1  the plan is defective — a sidecar is unparseable, a document has no
//      licence class, or a --commit run found the schema unready
//   2  could not reach what it needs — knowledge directory, manifest, database
//      or embedding API. NEVER 0, so a skipped run can never read as a clean
//      one.
// ---------------------------------------------------------------------------

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(HERE, "..");
export const KNOWLEDGE_DIR = path.join(REPO_ROOT, "docs/knowledge/layer-1-statutory");
export const MANIFEST_PATH = path.join(REPO_ROOT, "docs/knowledge/DOWNLOAD-MANIFEST.md");

// ---------------------------------------------------------------------------
// Embedding models — published rates, and the date they were read
// ---------------------------------------------------------------------------
// The dimensions matter as much as the price: both tables are `vector(1536)`,
// so a model whose native output is 3072 wide cannot be seeded into them
// without a dimensionality argument the table has no way to record. Listed so
// the mismatch is visible rather than discovered at INSERT time.
export const EMBEDDING_MODELS = {
  "text-embedding-3-small": { dimensions: 1536, usdPerMillionTokens: 0.02 },
  "text-embedding-3-large": { dimensions: 3072, usdPerMillionTokens: 0.13 },
};
export const DEFAULT_MODEL = "text-embedding-3-small";
/** The published-rate reading these figures come from. Re-check before quoting. */
export const RATE_CARD_READ_ON = "2026-08-20 (OpenAI published embeddings pricing)";

// ---------------------------------------------------------------------------
// Licence policy — the pure predicate, kept separate so a test can drive it
// ---------------------------------------------------------------------------

/**
 * Catalogue ids excluded for a reason that is NOT their licence class. Keyed
 * by id so a grouped sidecar (D-36-D-37-D-38) is excluded by any member.
 */
export const NON_LICENCE_EXCLUSIONS = {
  "D-36": "sanctions register — do-not-vendor (docs/knowledge/README.md); a vector index is a cache with fuzzy lookup, and CONTRADICTIONS C-16/C-25 show a flattened list blocking the US and the UK",
  "D-37": "sanctions register — do-not-vendor (see D-36)",
  "D-38": "sanctions register — do-not-vendor (see D-36)",
  "D-39": "sanctions register — do-not-vendor, AND un.org is 'all rights reserved' (manifest class corrected to (c))",
};

/** Licence classes that permit a chunk of the SIDECAR into the store. */
export const CHUNKABLE_CLASSES = new Set(["a", "b", "c"]);

/**
 * Should this sidecar's text go into the vector store?
 * Pure: no I/O, no clock. `licenceClasses` is a Set of "a"|"b"|"c"|"d".
 * @param {{documentIds: string[], licenceClasses: Set<string>}} doc
 * @returns {{admitted: boolean, reason: string}}
 */
export function admitDocument({ documentIds, licenceClasses }) {
  for (const id of documentIds) {
    if (NON_LICENCE_EXCLUSIONS[id]) {
      return { admitted: false, reason: `${id}: ${NON_LICENCE_EXCLUSIONS[id]}` };
    }
  }
  if (licenceClasses.size === 0) {
    // Fails closed. A document with no class in the manifest is a document
    // nobody decided about, which is not the same as one decided to be free.
    return { admitted: false, reason: "no licence class found in DOWNLOAD-MANIFEST.md §4 — fails closed" };
  }
  for (const cls of licenceClasses) {
    if (cls === "d") {
      return { admitted: false, reason: "licence class (d) — paraphrase only, never copied, now or ever" };
    }
    if (!CHUNKABLE_CLASSES.has(cls)) {
      return { admitted: false, reason: `unrecognised licence class (${cls}) — fails closed` };
    }
  }
  return { admitted: true, reason: `licence class ${[...licenceClasses].sort().map((c) => `(${c})`).join("/")} — sidecar extract permitted; source bytes never chunked` };
}

// ---------------------------------------------------------------------------
// Manifest parsing — the licence class comes from the manifest, not from here
// ---------------------------------------------------------------------------

/**
 * Parse §4's index table: | id | Document | Country | Feeds | Licence class |
 * Priority | Result |. Deliberately reads the class out of the manifest rather
 * than restating it in this file — a local copy would drift, and the drift
 * would be invisible because both copies would agree with each other.
 * @param {string} manifestText
 * @returns {Map<string, {licenceClass: string, feeds: string[], priority: string, result: string}>}
 */
export function parseLicenceIndex(manifestText) {
  const index = new Map();
  const section = manifestText.split(/^## 4\. Index/m)[1] ?? "";
  const rowRe = /^\|\s*(D-\d{2})\s*\|([^|]*)\|([^|]*)\|([^|]*)\|([^|]*)\|([^|]*)\|([^|]*)\|/gm;
  for (const m of section.matchAll(rowRe)) {
    const [, id, , , feedsCell, classCell, priorityCell, resultCell] = m;
    // "(b) **CC0**", "(b)/(c)", "**(a)** — notice read", "**(c)** — corrected"
    const classes = [...classCell.matchAll(/\(([abcd])\)/g)].map((c) => c[1]);
    if (classes.length === 0) continue;
    index.set(id, {
      licenceClass: classes.join("/"),
      licenceClasses: new Set(classes),
      feeds: [...feedsCell.matchAll(/UC-\d{2}/g)].map((f) => f[0]),
      priority: priorityCell.replace(/\*/g, "").trim(),
      result: resultCell.replace(/\*/g, "").trim(),
    });
  }
  return index;
}

// ---------------------------------------------------------------------------
// Sidecar parsing
// ---------------------------------------------------------------------------

/** Strip markdown emphasis/links/backticks down to plain text for a metadata cell. */
function plain(cell) {
  return String(cell)
    .replace(/<([^>]+)>/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Read one sidecar's provenance table and body.
 *
 * The provenance table is parsed into METADATA and deliberately kept OUT of the
 * chunked text. Embedding a table of URLs, byte counts and SHA-256 digests
 * would put a passage in the index that no inquiry is ever semantically close
 * to, and would put a hash in front of a specialist as if it were law. Every
 * chunk carries the provenance as fields instead.
 *
 * @param {string} text  the sidecar's markdown
 * @param {string} filename  e.g. "D-21-D-22-D-23-ca-social-security-agreements.md"
 * @returns {{documentIds: string[], key: string, title: string, publisher: string,
 *            sourceUrl: string, retrievedOn: string, sourceSha256: string|null, body: string}}
 */
export function parseSidecar(text, filename) {
  const documentIds = [...filename.matchAll(/D-\d{2}/g)].map((m) => m[0]);
  if (documentIds.length === 0) throw new Error(`no D-NN id in filename: ${filename}`);

  const h1 = text.match(/^#\s+(.+)$/m);
  const title = h1 ? plain(h1[1]) : documentIds.join("+");

  const cell = (label) => {
    const re = new RegExp(`^\\|\\s*\\*\\*${label}[^*]*\\*\\*\\s*\\|([\\s\\S]*?)\\|\\s*$`, "m");
    const m = text.match(re);
    return m ? plain(m[1]) : "";
  };

  const publisher = cell("Publisher") || cell("Source name");
  const sourceUrlCell = cell("Exact URL") || cell("URLs") || cell("URL");
  const sourceUrl = (text.match(/<(https?:\/\/[^>]+)>/) ?? [])[1] ?? sourceUrlCell.split(/\s/)[0] ?? "";
  const retrievedCell = cell("Retrieved") || cell("Retrieval attempted");
  const retrievedOn = (retrievedCell.match(/\d{4}-\d{2}-\d{2}/) ?? [])[0] ?? "";
  const shaCell = cell("SHA-256 of the retrieved bytes") || cell("SHA-256");
  const sourceSha256 = (shaCell.match(/\b[0-9a-f]{64}\b/) ?? [])[0] ?? null;

  // Body = everything from the first `##` heading onward. The H1 and the
  // provenance table above it are metadata, not passages.
  const firstSection = text.search(/^##\s+/m);
  const body = firstSection === -1 ? "" : text.slice(firstSection);

  return {
    documentIds,
    key: documentIds.join("+"),
    title,
    publisher,
    sourceUrl,
    retrievedOn,
    sourceSha256,
    body,
  };
}

// ---------------------------------------------------------------------------
// Chunking
// ---------------------------------------------------------------------------

/**
 * Chunk sizes, in characters. A passage should be one idea a specialist could
 * read on its own: "the Portuguese bracket boundary is off by one at exactly 24
 * months" is a passage; half of it is not. `MAX` at ~1200 chars is roughly 300
 * tokens, the granularity these sidecars' own sections already sit at (85 `##`
 * sections across 29 files, ~190 words each). `MIN` merges a two-line tail back
 * into its predecessor rather than emitting a chunk too short to rank.
 */
export const MAX_CHUNK_CHARS = 1200;
export const MIN_CHUNK_CHARS = 240;

/**
 * Split markdown into heading-anchored passages.
 *
 * Sections are the natural unit here because the sidecars were WRITTEN in them
 * ("Article 7:672, the limbs that matter, quoted in Dutch" / "What this settles
 * for src/uc05/"). A fixed-window splitter would cut a quoted statutory limb in
 * half; the heading is also the only thing that makes a retrieved fragment
 * self-describing, which matters more here than in most corpora because a
 * fragment of tax law with no article number attached is an invitation to
 * misread it.
 *
 * Over-long sections split at paragraph boundaries, never mid-sentence. Each
 * chunk keeps its heading as a prefix so the embedded text and the displayed
 * text are the same string — an index whose text differs from what the reader
 * is shown cannot be checked by reading it.
 *
 * @param {string} body  markdown starting at a `##` heading
 * @param {{maxChars?: number, minChars?: number}} [opts]
 * @returns {Array<{heading: string, text: string}>}
 */
export function chunkMarkdown(body, { maxChars = MAX_CHUNK_CHARS, minChars = MIN_CHUNK_CHARS } = {}) {
  const sections = [];
  const lines = String(body).split("\n");
  let heading = "";
  let buffer = [];
  const flush = () => {
    const text = buffer.join("\n").trim();
    if (text) sections.push({ heading, text });
    buffer = [];
  };
  for (const line of lines) {
    const m = line.match(/^(#{2,6})\s+(.*)$/);
    if (m) {
      flush();
      heading = plain(m[2]);
      continue;
    }
    buffer.push(line);
  }
  flush();

  const chunks = [];
  for (const section of sections) {
    const prefix = section.heading ? `${section.heading}\n\n` : "";
    const paragraphs = section.text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
    let current = [];
    let currentLen = 0;
    const emit = () => {
      if (current.length === 0) return;
      chunks.push({ heading: section.heading, text: prefix + current.join("\n\n") });
      current = [];
      currentLen = 0;
    };
    for (const para of paragraphs) {
      // A paragraph longer than the window on its own is emitted whole rather
      // than cut: these are quoted statutory limbs, and a half-quoted article
      // is the one failure mode this corpus exists to prevent.
      if (currentLen > 0 && currentLen + para.length + 2 > maxChars) emit();
      current.push(para);
      currentLen += para.length + 2;
    }
    emit();
  }

  // Merge a runt tail back into its predecessor when they share a heading.
  const merged = [];
  for (const chunk of chunks) {
    const prev = merged[merged.length - 1];
    if (prev && prev.heading === chunk.heading && chunk.text.length < minChars) {
      prev.text = `${prev.text}\n\n${chunk.text.slice((chunk.heading ? chunk.heading.length + 2 : 0))}`.trim();
      continue;
    }
    merged.push({ ...chunk });
  }
  return merged;
}

/** SHA-256 of a chunk's exact text — the "has this changed?" key. */
export function contentHash(text) {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex");
}

/**
 * Turn one parsed sidecar into stored rows.
 * `citationId` is `<key>#<0000>`, so the tables' EXISTING `citation_id` primary
 * key already enforces one row per (document, chunk index).
 * @param {ReturnType<typeof parseSidecar>} sidecar
 * @param {{licenceClass: string, feeds: string[]}} manifestEntry
 * @param {object} [opts]
 */
export function chunkDocument(sidecar, manifestEntry, opts = {}) {
  return chunkMarkdown(sidecar.body, opts).map((chunk, i) => ({
    citationId: `${sidecar.key}#${String(i).padStart(4, "0")}`,
    documentId: sidecar.key,
    documentIds: sidecar.documentIds,
    chunkIndex: i,
    heading: chunk.heading,
    text: chunk.text,
    contentHash: contentHash(chunk.text),
    title: sidecar.title,
    publisher: sidecar.publisher,
    sourceUrl: sidecar.sourceUrl,
    retrievedOn: sidecar.retrievedOn,
    sourceSha256: sidecar.sourceSha256,
    licenceClass: manifestEntry.licenceClass,
    feeds: manifestEntry.feeds,
  }));
}

// ---------------------------------------------------------------------------
// Routing — which of the two tables, if either
// ---------------------------------------------------------------------------

export const UC08_TABLE = "uc08_treaty_citation_vectors";
export const UC07_TABLE = "uc07_mobility_citation_vectors";

/**
 * The manifest's own "Feeds" column decides the destination. A document may
 * feed several use cases; only UC-07 and UC-08 have a vector table, and UC-08
 * wins when both apply because a treaty document is a treaty document.
 *
 * `null` is the interesting answer and is reported, not swallowed: a large part
 * of this corpus feeds UC-03/UC-04/UC-05, which have NO vector table and
 * deliberately use hand-curated `decisionSources.js` maps instead. Seeding
 * cannot change that, and pretending otherwise by inventing a third table would
 * put statutory passages behind a similarity search on the 🟡 path a human
 * signs — the exact place docs/RETRIEVAL.md argues they must not be.
 * @param {string[]} feeds
 * @returns {string|null}
 */
export function routeTable(feeds) {
  const set = new Set(feeds ?? []);
  if (set.has("UC-08")) return UC08_TABLE;
  if (set.has("UC-07")) return UC07_TABLE;
  return null;
}

// ---------------------------------------------------------------------------
// Cost
// ---------------------------------------------------------------------------

/**
 * Token estimate without a tokenizer dependency. Two independent
 * approximations, and the LARGER is used, so a printed dollar figure is never
 * understated. Tagged [INFERRED] wherever it is quoted.
 * @param {string} text
 */
export function estimateTokens(text) {
  const s = String(text);
  const byChars = Math.ceil(s.length / 4);
  const byWords = Math.ceil((s.split(/\s+/).filter(Boolean).length || 0) * 1.33);
  return Math.max(byChars, byWords);
}

/**
 * @param {number} tokens
 * @param {string} model
 * @returns {{usd: number, model: string, usdPerMillionTokens: number, dimensions: number}}
 */
export function estimateCost(tokens, model = DEFAULT_MODEL) {
  const spec = EMBEDDING_MODELS[model];
  if (!spec) throw new Error(`unknown embedding model: ${model}`);
  return {
    model,
    usd: (tokens / 1_000_000) * spec.usdPerMillionTokens,
    usdPerMillionTokens: spec.usdPerMillionTokens,
    dimensions: spec.dimensions,
  };
}

// ---------------------------------------------------------------------------
// The plan — pure, so a test can build one from fixtures with no filesystem
// ---------------------------------------------------------------------------

/**
 * @param {{manifestText: string, sidecars: Array<{filename: string, text: string}>,
 *          model?: string, chunkOpts?: object}} input
 */
export function buildPlan({ manifestText, sidecars, model = DEFAULT_MODEL, chunkOpts = {} }) {
  const index = parseLicenceIndex(manifestText);
  const documents = [];
  const excluded = [];
  const unroutable = [];
  const rows = [];

  for (const { filename, text } of sidecars) {
    const sidecar = parseSidecar(text, filename);
    const classes = new Set();
    const feeds = new Set();
    let priority = "";
    for (const id of sidecar.documentIds) {
      const entry = index.get(id);
      if (!entry) continue;
      for (const c of entry.licenceClasses) classes.add(c);
      for (const f of entry.feeds) feeds.add(f);
      priority = priority || entry.priority;
    }
    const verdict = admitDocument({ documentIds: sidecar.documentIds, licenceClasses: classes });
    const manifestEntry = { licenceClass: [...classes].sort().map((c) => `(${c})`).join("/") || "—", feeds: [...feeds] };

    if (!verdict.admitted) {
      excluded.push({ file: filename, key: sidecar.key, ...manifestEntry, reason: verdict.reason });
      continue;
    }

    const chunks = chunkDocument(sidecar, manifestEntry, chunkOpts);
    const table = routeTable(manifestEntry.feeds);
    if (!table) {
      unroutable.push({ file: filename, key: sidecar.key, feeds: manifestEntry.feeds, chunks: chunks.length });
    }
    const tokens = chunks.reduce((sum, c) => sum + estimateTokens(c.text), 0);
    documents.push({
      file: filename,
      key: sidecar.key,
      title: sidecar.title,
      publisher: sidecar.publisher,
      sourceSha256: sidecar.sourceSha256,
      retrievedOn: sidecar.retrievedOn,
      licenceClass: manifestEntry.licenceClass,
      feeds: manifestEntry.feeds,
      priority,
      table,
      chunks: chunks.length,
      tokens,
      admitReason: verdict.reason,
    });
    for (const chunk of chunks) rows.push({ ...chunk, table });
  }

  const seedable = rows.filter((r) => r.table);
  const tokens = seedable.reduce((sum, r) => sum + estimateTokens(r.text), 0);
  const allTokens = rows.reduce((sum, r) => sum + estimateTokens(r.text), 0);
  // Byte-exact traceability is NOT universal, and saying so is the point. A
  // class (c) document permits a quotation and forbids a copy, so no bytes were
  // committed and there is no SHA-256 to carry — the chain ends at a publisher,
  // a URL and a retrieval date. That is weaker than a hash and it is not
  // nothing; a row that silently reported `null` as if it were a hash would be.
  const withHash = rows.filter((r) => r.sourceSha256);

  return {
    model,
    documents,
    excluded,
    unroutable,
    rows,
    totals: {
      documentsAdmitted: documents.length,
      documentsExcluded: excluded.length,
      passagesTotal: rows.length,
      passagesSeedable: seedable.length,
      passagesUnroutable: rows.length - seedable.length,
      tokensSeedable: tokens,
      tokensTotal: allTokens,
      passagesWithSourceHash: withHash.length,
      documentsWithoutSourceHash: documents.filter((d) => !d.sourceSha256).map((d) => d.key),
      byTable: {
        [UC08_TABLE]: seedable.filter((r) => r.table === UC08_TABLE).length,
        [UC07_TABLE]: seedable.filter((r) => r.table === UC07_TABLE).length,
      },
    },
    cost: estimateCost(tokens, model),
    costIfAllRouted: estimateCost(allTokens, model),
  };
}

// ---------------------------------------------------------------------------
// Schema — read, never create
// ---------------------------------------------------------------------------

/** Columns a row needs beyond the five each table already has. */
export const REQUIRED_COLUMNS = [
  ["document_id", "text"],
  ["chunk_index", "integer"],
  ["content_hash", "text"],
  ["publisher", "text"],
  ["source_url", "text"],
  ["source_sha256", "text"],
  ["retrieved_on", "date"],
  ["licence_class", "text"],
];

/** The exact DDL a human must apply. Printed; never executed by this script. */
export function requiredDdl(table) {
  const adds = REQUIRED_COLUMNS.map(([name, type]) => `alter table ${table} add column if not exists ${name} ${type};`);
  adds.push(`create unique index if not exists ${table}_doc_chunk_idx on ${table} (document_id, chunk_index);`);
  return adds;
}

/** The upsert. ON CONFLICT on the EXISTING primary key — the guarantee is the key. */
export function upsertSql(table) {
  return `insert into ${table}
  (citation_id, title, summary, embedding, document_id, chunk_index, content_hash,
   publisher, source_url, source_sha256, retrieved_on, licence_class)
values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
on conflict (citation_id) do update set
  title = excluded.title,
  summary = excluded.summary,
  embedding = excluded.embedding,
  document_id = excluded.document_id,
  chunk_index = excluded.chunk_index,
  content_hash = excluded.content_hash,
  publisher = excluded.publisher,
  source_url = excluded.source_url,
  source_sha256 = excluded.source_sha256,
  retrieved_on = excluded.retrieved_on,
  licence_class = excluded.licence_class
where ${table}.content_hash is distinct from excluded.content_hash`;
}

/**
 * Which planned rows actually need embedding + writing, given what is stored.
 * Pure, so idempotency is testable without a database.
 * @param {Array<{citationId: string, contentHash: string}>} planned
 * @param {Array<{citation_id: string, content_hash: string}>} stored
 */
export function diffAgainstStored(planned, stored) {
  const have = new Map((stored ?? []).map((r) => [r.citation_id, r.content_hash]));
  const toWrite = [];
  const unchanged = [];
  for (const row of planned) {
    if (have.get(row.citationId) === row.contentHash) unchanged.push(row);
    else toWrite.push(row);
  }
  const plannedIds = new Set(planned.map((r) => r.citationId));
  const orphaned = [...have.keys()].filter((id) => !plannedIds.has(id));
  return { toWrite, unchanged, orphaned };
}

// ---------------------------------------------------------------------------
// I/O — everything below this line touches the filesystem, network or database
// ---------------------------------------------------------------------------

function die(code, message) {
  console.error(`\n✖ ${message}`);
  process.exit(code);
}

export function loadSidecars(dir = KNOWLEDGE_DIR) {
  if (!fs.existsSync(dir)) die(2, `knowledge directory not found: ${dir}`);
  return fs
    .readdirSync(dir)
    .filter((f) => /^D-\d{2}.*\.md$/.test(f))
    .sort()
    .map((filename) => ({ filename, text: fs.readFileSync(path.join(dir, filename), "utf8") }));
}

function usd(n) {
  return n < 0.01 ? `$${n.toFixed(6)}` : `$${n.toFixed(4)}`;
}

function printPlan(plan) {
  const t = plan.totals;
  console.log("\n" + "=".repeat(78));
  console.log("  seed-citation-vectors — DRY RUN. Nothing was embedded, nothing was written.");
  console.log("=".repeat(78));

  console.log("\nPER-DOCUMENT CHUNK COUNTS\n");
  console.log("  " + "id".padEnd(16) + "cls".padEnd(8) + "chunks".padStart(7) + "tokens".padStart(9) + "  table");
  console.log("  " + "-".repeat(74));
  for (const d of plan.documents) {
    console.log(
      "  " +
        d.key.padEnd(16) +
        d.licenceClass.padEnd(8) +
        String(d.chunks).padStart(7) +
        String(d.tokens).padStart(9) +
        "  " +
        (d.table ?? "— no table for " + (d.feeds.join(",") || "?"))
    );
  }

  console.log("\nEXCLUDED — not chunked, and each for a stated reason\n");
  if (plan.excluded.length === 0) console.log("  (none)");
  for (const e of plan.excluded) {
    console.log(`  ${e.key.padEnd(16)} ${e.reason}`);
  }
  console.log("\n  Also excluded, categorically: every file under layer-1-statutory/sources/.");
  console.log("  A chunk store is a mirror; half this corpus is licence class (c), which");
  console.log("  permits a quotation and forbids a copy. The sidecars ARE the permitted");
  console.log("  quotation, already public in this repository.");

  if (plan.unroutable.length > 0) {
    console.log("\nADMITTED BUT UNROUTABLE — chunked, and there is nowhere to put them\n");
    for (const u of plan.unroutable) {
      console.log(`  ${u.key.padEnd(16)} feeds ${(u.feeds.join(", ") || "?").padEnd(18)} ${String(u.chunks).padStart(3)} passages`);
    }
    console.log("\n  Only UC-07 and UC-08 have a vector table. These documents feed UC-03/04/05,");
    console.log("  which cite through hand-curated decisionSources.js maps on a decision a human");
    console.log("  signs. That is a design choice, not a gap — see docs/RETRIEVAL.md §4.");
  }

  console.log("\nTOTALS\n");
  console.log(`  documents admitted ......... ${t.documentsAdmitted}`);
  console.log(`  documents excluded ......... ${t.documentsExcluded}`);
  console.log(`  PASSAGES (total) ........... ${t.passagesTotal}`);
  console.log(`  passages with a table ...... ${t.passagesSeedable}`);
  console.log(`    → ${UC08_TABLE} ${String(t.byTable[UC08_TABLE]).padStart(4)}`);
  console.log(`    → ${UC07_TABLE} ${String(t.byTable[UC07_TABLE]).padStart(4)}`);
  console.log(`  passages with no table ..... ${t.passagesUnroutable}`);
  console.log(`  passages with a source SHA . ${t.passagesWithSourceHash} of ${t.passagesTotal}`);
  if (t.documentsWithoutSourceHash.length > 0) {
    console.log(`      no hash: ${t.documentsWithoutSourceHash.join(", ")}`);
    console.log("      — cite-and-link documents whose licence forbids a copy, so no bytes");
    console.log("        were committed and no digest exists. Publisher + URL + retrieval");
    console.log("        date is the whole chain for these, and the row says so rather than");
    console.log("        reporting a null as if it were a hash.");
  }
  console.log(`  tokens, seedable ........... ${t.tokensSeedable.toLocaleString()}  [INFERRED — see estimateTokens()]`);
  console.log(`  tokens, all admitted ....... ${t.tokensTotal.toLocaleString()}  [INFERRED]`);
  console.log(
    `\n  COST to embed the seedable set once, ${plan.cost.model} @ ` +
      `$${plan.cost.usdPerMillionTokens}/1M tokens (${RATE_CARD_READ_ON}):`
  );
  console.log(`      ${usd(plan.cost.usd)}`);
  console.log(`  Cost if every admitted passage had a table: ${usd(plan.costIfAllRouted.usd)}`);
  console.log("\n  A re-run over an unchanged corpus costs $0.00 and writes nothing: content_hash");
  console.log("  is compared before anything is embedded.");

  console.log("\nSCHEMA — this script never creates or alters it. Apply by hand first:\n");
  for (const table of [UC08_TABLE, UC07_TABLE]) {
    for (const stmt of requiredDdl(table)) console.log(`  ${stmt}`);
    console.log("");
  }
  console.log("=".repeat(78));
  console.log("  --commit would write. It is NOT authorised: the repository owner has not");
  console.log("  approved seeding, and docs/RETRIEVAL.md recommends against it at this size.");
  console.log("=".repeat(78) + "\n");
}

async function main() {
  const argv = process.argv.slice(2);
  const commit = argv.includes("--commit");
  const asJson = argv.includes("--json");
  const model = (argv.find((a) => a.startsWith("--model="))?.split("=")[1]) ?? DEFAULT_MODEL;
  if (!EMBEDDING_MODELS[model]) die(1, `unknown --model=${model}. Known: ${Object.keys(EMBEDDING_MODELS).join(", ")}`);

  if (!fs.existsSync(MANIFEST_PATH)) die(2, `manifest not found: ${MANIFEST_PATH}`);
  const manifestText = fs.readFileSync(MANIFEST_PATH, "utf8");
  const sidecars = loadSidecars();
  if (sidecars.length === 0) die(2, `no D-NN sidecars found under ${KNOWLEDGE_DIR}`);

  let plan;
  try {
    plan = buildPlan({ manifestText, sidecars, model });
  } catch (err) {
    die(1, `plan is defective: ${err.message}`);
  }
  if (plan.documents.length === 0) die(1, "every document was excluded — refusing to report a plan of nothing");

  if (asJson) {
    const { rows, ...summary } = plan;
    console.log(JSON.stringify({ ...summary, sampleRow: rows[0] ?? null }, null, 2));
  } else {
    printPlan(plan);
  }

  if (!commit) return;

  // ---- from here on, --commit only. Nothing below has ever run. -----------
  console.error("\n--commit requested. Checking preconditions before writing anything.\n");

  const { getPgPool } = await import("../src/shared/db.js");
  const pool = getPgPool();
  if (!pool) die(2, "SUPABASE_DB_URL is not set — cannot reach the database. (Note: this container cannot open a raw TCP connection to Supabase at all; see CLAUDE.md §4.)");

  const dims = EMBEDDING_MODELS[model].dimensions;
  for (const table of [UC08_TABLE, UC07_TABLE]) {
    let cols;
    try {
      const res = await pool.query(
        "select column_name from information_schema.columns where table_schema='public' and table_name=$1",
        [table]
      );
      cols = new Set(res.rows.map((r) => r.column_name));
    } catch (err) {
      die(2, `cannot read ${table}'s schema: ${err.message}`);
    }
    if (cols.size === 0) die(2, `table ${table} does not exist`);
    const missing = REQUIRED_COLUMNS.filter(([name]) => !cols.has(name)).map(([name]) => name);
    if (missing.length > 0) {
      console.error(`  ${table} is missing: ${missing.join(", ")}`);
      console.error("  Apply the DDL printed above, then re-run. Refusing to write rows that");
      console.error("  cannot be traced back to retrieved bytes.");
      die(1, "schema not ready");
    }
  }
  if (dims !== 1536) die(1, `both tables are vector(1536); ${model} emits ${dims}`);

  const { isLlmConfigured } = await import("../src/shared/llm.js");
  if (!isLlmConfigured()) die(2, "OPENAI_API_KEY is not set — cannot embed");

  const OpenAI = (await import("openai")).default;
  const client = new OpenAI({
    ...(process.env.HTTPS_PROXY ? { fetch: (u, i) => globalThis.fetch(u, i) } : {}),
  });

  let written = 0;
  let skipped = 0;
  for (const table of [UC08_TABLE, UC07_TABLE]) {
    const planned = plan.rows.filter((r) => r.table === table);
    if (planned.length === 0) continue;
    const stored = await pool.query(`select citation_id, content_hash from ${table}`);
    const { toWrite, unchanged, orphaned } = diffAgainstStored(planned, stored.rows);
    skipped += unchanged.length;
    if (orphaned.length > 0) {
      console.error(`  ${table}: ${orphaned.length} stored row(s) no longer in the plan — left in place, not deleted. Review: ${orphaned.slice(0, 5).join(", ")}`);
    }
    const unhashed = toWrite.filter((r) => !r.sourceSha256).map((r) => r.documentId);
    if (unhashed.length > 0) {
      console.error(`  ${table}: ${unhashed.length} row(s) carry no source SHA-256 (${[...new Set(unhashed)].join(", ")}) — cite-and-link documents with no committed bytes. Writing them with a null digest, not a fabricated one.`);
    }
    for (const row of toWrite) {
      const res = await client.embeddings.create({ model, input: row.text });
      const vector = res.data[0].embedding;
      await pool.query(upsertSql(table), [
        row.citationId,
        `${row.title} — ${row.heading}`.slice(0, 500),
        row.text,
        JSON.stringify(vector),
        row.documentId,
        row.chunkIndex,
        row.contentHash,
        row.publisher,
        row.sourceUrl,
        row.sourceSha256,
        row.retrievedOn || null,
        row.licenceClass,
      ]);
      written += 1;
    }
  }
  console.error(`\n✔ ${written} row(s) written, ${skipped} unchanged and skipped.\n`);
  await pool.end();
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => die(2, `unhandled: ${err?.stack ?? err}`));
}
