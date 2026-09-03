import { asLowerText } from "../shared/text.js";
import { matchKeywords } from "../shared/keywordMatch.js";
// ⚠ THIS FUNCTION USED TO MATCH KEYWORDS WITH A PLAIN `lower.includes(kw)`
// SUBSTRING TEST, and then PUBLISHED the matched keyword to the reviewer in
// `matchedOn` — the honesty mechanism that says "this citation is here
// because your text said X". Substring matching made that statement false in
// a confusing way: "a1" (the A1 social-security certificate keyword) is a
// substring of any "A123"-shaped employee/ticket identifier, so a payslip
// question naming an id was cited totalization guidance, "matched on: a1".
// "183" is a substring of any longer number ("$183.50", ticket "#18345"), so
// an unrelated price or ticket reference was cited the 183-day article. Every
// keyword below now requires a WORD BOUNDARY on both sides — not surrounded
// by another letter or digit — while still allowing multi-word/hyphenated
// phrases ("short-term assignment", "resident of both") to match literally,
// since their internal punctuation already prevents the same false-positive
// class. Same defect shape as inquiryParser.js's country-name matching, one
// field over.
// ---------------------------------------------------------------------------
// treatyRetriever.js  —  Citation retrieval, honestly labeled
// ---------------------------------------------------------------------------
// WHY THE METHOD CHANGED BUT THE DISCIPLINE DIDN'T
// This file used to be keyword substring matching over a hand-curated corpus,
// and said so in this header. It is now embedding-similarity retrieval against
// the SAME curated corpus — the scope boundary issue #23 drew (no corpus
// expansion) stands — with each entry's vector stored in a pgvector table on
// the existing Supabase project. The schema is documented in
// docs/SETUP-CHECKLIST.md for a human to provision; this module never creates
// it, the same optional-pgPool pattern as audit.js and dossierStore.js.
//
// The citation-honesty discipline survives the upgrade verbatim: every
// citation must say exactly why it matched, and nothing in that statement may
// read as more precise than it is. An embedding similarity score is a
// retrieval signal, not a precision figure — putting "92% similar" next to a
// passage would be the same unearned authority claim the keyword version
// refused to make. So the replacement `matchedOn` states the similarity RANK
// and the THRESHOLD it cleared, in plain language, and never carries a raw
// similarity number.
//
// The degrade ladder is the repo's standard "optional integration degrades to
// a safe default" rule (audit.js's optional pgPool):
//   - embed function + stored vectors configured  -> embedding-similarity
//   - embed function but no stored vectors        -> keyword fallback
//   - no embed function at all                    -> keyword fallback
// That keeps the hermetic test suite AND the n8n "Build Dossier" Code node
// (workflows/nodes-uc08/buildDossier.js) in parity, because an n8n Code node
// has neither a pgPool nor an embedding client of its own — it runs the
// keyword path, which is the same path this function takes until both are
// configured. test/n8nUc08Parity.test.js still compares the two and they
// agree.
// ---------------------------------------------------------------------------

import { retrieveStatutoryCitations } from "../knowledge/statutoryRetrieval.js";

export const TREATY_CORPUS = [
  {
    id: "oecd-model-art-4",
    title: "OECD Model Tax Convention, Article 4 — Resident (tie-breaker rules)",
    summary:
      "Where an individual would otherwise be a resident of both Contracting States, tie-breaker tests apply in order: permanent home available, then centre of vital interests, then habitual abode, then nationality, then mutual agreement between the states.",
    keywords: ["dual resident", "dual residency", "tie-breaker", "tie breaker", "residency", "resident of both"],
  },
  {
    id: "oecd-model-art-15",
    title: "OECD Model Tax Convention, Article 15 — Income from Employment (the \"183-day rule\")",
    summary:
      "Employment remuneration may be taxed only in the state of residence if: the employee is present in the other state for 183 days or less in any 12-month period; the employer is not a resident of that other state; and the remuneration is not borne by a permanent establishment there.",
    keywords: ["183", "physical presence", "presence day", "withholding", "short-term assignment", "short term assignment"],
  },
  {
    id: "totalization-general",
    title: "Social Security Totalization Agreements — general principle",
    summary:
      "Totalization agreements generally assign social-security coverage to a single country at a time for a temporary assignment, and allow a certificate of coverage (e.g. an EU A1 certificate) to certify continued home-country coverage while working abroad.",
    keywords: ["totalization", "totalisation", "social security", "a1", "certificate of coverage"],
  },
];

/**
 * Minimum cosine similarity for an embedding match. Deliberately a floor, not
 * a precision claim: it only separates "closest passages" from "didn't match",
 * and `matchedOn` says that plainly instead of quoting a similarity figure.
 * Overridable per TreatyRetriever instance.
 */
export const EMBEDDING_MATCH_THRESHOLD = 0.3;

/**
 * Cosine similarity between two embedding vectors. Pure and deterministic —
 * the scoring step of retrieval, kept separate so tests can exercise it
 * directly with fixed vectors.
 * @param {number[]} a
 * @param {number[]} b
 * @returns {number} -1..1 (0 if either vector has zero magnitude)
 */
export function cosineSimilarity(a, b) {
  const n = Math.min(a.length, b.length);
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < n; i += 1) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * The ORIGINAL retrieval mechanism, over the three hand-written OECD Model
 * paraphrases in TREATY_CORPUS.
 *
 * DEMOTED 2026-08-30 FROM DEFAULT TO LAST RESORT, and the reason is the output
 * rather than the mechanism. Measured on the four demo country pairs, this leg
 * answered a US–Portugal treaty question with NOTHING, and Netherlands–Portugal
 * and US–Canada questions with the OECD MODEL — the template real conventions
 * are drafted from, offered where the instrument belongs, which as CLAUDE.md §7
 * item 17 puts it "reads exactly like an answer". All six conventions governing
 * the demo pairs were in docs/knowledge/ the whole time and no ranking function
 * could reach them, because a corpus of three cannot hold them.
 *
 * It is KEPT, not deleted: when the statutory index finds nothing, a labelled
 * model paraphrase is better than silence, and the OECD entries are
 * paraphrase-only BY LICENCE (L1-01-L1-11-oecd-citation-register.md exists so
 * nobody "improves" them by pasting the source in). What changed is that they
 * can no longer displace an instrument — see statutoryLeg() below.
 *
 * @param {string} text
 * @param {Array<{id:string,title:string,summary:string,keywords:string[]}>} corpus
 */
function retrieveByKeywords(text, corpus) {
  const lower = asLowerText(text);
  const matches = [];
  for (const entry of corpus) {
    // Word-boundary matching, not substring: `lower.includes("mot")` fired on
    // the word "reMOTe" and `includes("a1")` on any "A123" identifier, then
    // told the reviewer that was the reason for the citation. See keywordMatch.js.
    const matchedOn = matchKeywords(lower, entry.keywords || []);
    if (matchedOn.length > 0) {
      matches.push({ id: entry.id, title: entry.title, summary: entry.summary, matchedOn });
    }
  }
  return matches;
}

/**
 * The unconfigured default: the retrieved statutory corpus, then the model
 * paraphrases only if it found nothing.
 *
 * ORDER IS THE POINT. An instrument in force always precedes a model of one,
 * and a model is only ever reached when no instrument matched — so the failure
 * mode this replaces (a model returned ALONGSIDE, and indistinguishable from,
 * an instrument) cannot recur. A caller that passes its own `corpus` is opting
 * out of the statutory index entirely, which is what the tests that inject fake
 * embedded corpora rely on.
 */
function statutoryLeg(text, corpus, { usingDefaultCorpus, countries = null }) {
  if (!usingDefaultCorpus) return retrieveByKeywords(text, corpus);
  const statutory = retrieveStatutoryCitations(text, { feed: "UC-08", countries });
  if (statutory.length > 0) return statutory;
  return retrieveByKeywords(text, corpus).map((c) => ({
    ...c,
    // SAID OUT LOUD, because the whole defect was a model that read like an
    // instrument. A specialist seeing this knows no governing text matched.
    authority: "model",
    instrument: false,
    matchedOn: [
      ...c.matchedOn,
      "no passage in the retrieved statutory corpus matched this inquiry — this is a MODEL convention, not the instrument governing this country pair",
    ],
  }));
}

/**
 * Coerce a pgvector `vector` column value (which the pg driver hands back as
 * a `"[0.1,0.2,...]"` string) back into a number[]; pass arrays through.
 * @param {unknown} value
 * @returns {number[]|null}
 */
function coerceVector(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Embedding-similarity retrieval over the curated corpus, with the same
 * degrade-to-keyword ladder as audit.js's optional pgPool.
 *
 * Constructing one with real dependencies is the production wiring:
 *   new TreatyRetriever({ pgPool, embed })   // embed: (text) => number[]
 * and tests construct it with a fake embed function and corpus entries that
 * carry fake stored vectors, so the suite never makes a network call.
 */
export class TreatyRetriever {
  /**
   * @param {object} [opts]
   * @param {Function} [opts.embed]       `(text) => number[]|Promise<number[]>` — the query
   *   embedding function (e.g. an OpenAI embeddings call). Absent => keyword fallback.
   * @param {import("pg").Pool|null} [opts.pgPool]  when set, stored vectors are read from
   *   the `uc08_treaty_citation_vectors` table instead of the corpus arg
   * @param {Array<object>} [opts.corpus] the curated corpus; entries may carry an
   *   `embedding` number[] (the in-memory/fake "stored vectors" case)
   * @param {number} [opts.threshold]     cosine-similarity floor, default EMBEDDING_MATCH_THRESHOLD
   */
  constructor({ embed = null, pgPool = null, corpus = TREATY_CORPUS, threshold = EMBEDDING_MATCH_THRESHOLD } = {}) {
    this.embed = embed;
    this.pgPool = pgPool;
    this.corpus = corpus;
    // A caller that supplied its own corpus wants THAT corpus searched — the
    // hermetic tests inject fake embedded entries and would otherwise get the
    // real statutory index back, which is a silent test-double bypass.
    this.usingDefaultCorpus = corpus === TREATY_CORPUS;
    this.threshold = threshold;
  }

  /**
   * @param {string} text  the inquiry text (and/or a parsed inquiry-type label)
   * @returns {Promise<Array<{id: string, title: string, summary: string, matchedOn: string[]}>>}
   */
  async retrieveCitations(text, { countries = null } = {}) {
    const opts = { usingDefaultCorpus: this.usingDefaultCorpus, countries };
    if (!this.embed) return statutoryLeg(text, this.corpus, opts);

    const queryVector = await this.embed(text);
    const stored = await this.#storedVectors();
    if (stored.length === 0) return statutoryLeg(text, this.corpus, opts);

    const ranked = stored
      .map((entry) => ({ entry, similarity: cosineSimilarity(queryVector, entry.embedding) }))
      .filter(({ similarity }) => similarity >= this.threshold)
      .sort((a, b) => b.similarity - a.similarity);

    return ranked.map(({ entry }, i) => ({
      id: entry.id,
      title: entry.title,
      summary: entry.summary,
      matchedOn: [
        `embedding similarity — ranked ${i + 1} of ${ranked.length} passage(s), above the ${this.threshold} match threshold`,
      ],
    }));
  }

  /** Stored vectors: corpus entries carrying an embedding first, else the pgvector table. */
  async #storedVectors() {
    const embedded = this.corpus
      .filter((e) => Array.isArray(e.embedding) && e.embedding.length > 0)
      .map((e) => ({ id: e.id, title: e.title, summary: e.summary, embedding: e.embedding }));
    if (embedded.length > 0) return embedded;

    if (this.pgPool) {
      const result = await this.pgPool.query(
        `select citation_id as id, title, summary, embedding from uc08_treaty_citation_vectors`
      );
      return result.rows
        .map((row) => ({ id: row.id, title: row.title, summary: row.summary, embedding: coerceVector(row.embedding) }))
        .filter((row) => row.embedding !== null);
    }
    return [];
  }
}

/**
 * Which retrieval path produced these citations, read from the citations' own
 * stated basis rather than from a flag somebody has to remember to set.
 *
 * WHY A READER NEEDS THIS. The degrade ladder in this file's header is silent
 * by design — an unconfigured retriever returns citations that look exactly
 * like configured ones, which is the right behaviour for a fallback and the
 * wrong thing to hide from a specialist. `uc08_treaty_citation_vectors` has
 * held zero rows for the whole life of this deployment, so EVERY citation any
 * production run has ever shown was keyword-matched. A tax specialist weighing
 * "OECD Model Article 15 — the 183-day rule" against their own reading is
 * entitled to know whether it surfaced because the passage is semantically
 * close to the inquiry, or because the string "183" appeared in it.
 *
 * `matchedOn` already carries the answer — embedding matches state their rank
 * and threshold, keyword matches quote the literal keyword — so this reads it
 * back rather than plumbing a second, drift-prone signal through the workflow.
 *
 * @param {Array<{matchedOn?: string[]}>} citations
 * @returns {"embedding_similarity"|"keyword_fallback"|"none"}
 */
export function describeRetrievalMode(citations) {
  const list = Array.isArray(citations) ? citations : [];
  if (list.length === 0) return "none";
  const says = (re) => list.some((c) => (c?.matchedOn ?? []).some((m) => re.test(String(m))));
  if (says(/^embedding similarity/)) return "embedding_similarity";
  // Added 2026-08-30 with the statutory corpus. It is a THIRD mode and not a
  // relabelled keyword_fallback: the two answer from different bodies of text —
  // 55 passages of retrieved statute versus three OECD Model paraphrases — and a
  // specialist weighing a citation needs to know which. Collapsing them would
  // reintroduce, in the mode label, exactly the ambiguity the corpus change
  // removed from the citations themselves.
  if (says(/^statutory corpus \(lexical\)/)) return "statutory_lexical";
  return "keyword_fallback";
}

let defaultRetriever = new TreatyRetriever();

/**
 * The default, unconfigured retriever — keyword fallback until both an embed
 * function and stored vectors exist. Keep the same call signature as before:
 * text in, the same [{id, title, summary, matchedOn}] array out (async now,
 * because embedding similarity is inherently an I/O operation).
 * @param {string} text
 * @returns {Promise<Array<{id: string, title: string, summary: string, matchedOn: string[]}>>}
 */
export async function retrieveCitations(text, opts) {
  return defaultRetriever.retrieveCitations(text, opts);
}

/**
 * Point the module-level retrieveCitations() at a real deployment's retriever
 * (pgPool + embed). Returns the new default for convenience.
 * @param {object} opts  same options as TreatyRetriever's constructor
 * @returns {TreatyRetriever}
 */
export function configureTreatyRetriever(opts) {
  defaultRetriever = new TreatyRetriever(opts);
  return defaultRetriever;
}
