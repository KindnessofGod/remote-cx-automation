import { asLowerText } from "../shared/text.js";
import { matchKeywords } from "../shared/keywordMatch.js";
// ---------------------------------------------------------------------------
// mobilityRetriever.js  —  Global-mobility citation retrieval, honestly labeled
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
// docs/use-cases/UC-07.md §3 lists a "Global mobility knowledge base" /
// "Mobility RAG index" [PROPOSED] as the source a relocation dossier cross-
// references, with citations, before a specialist decides anything (§5). This
// file is that retriever, built with exactly the same honesty discipline as
// uc08/treatyRetriever.js (issue #29):
//
//   - a small, hand-curated corpus of general global-mobility principles
//     derived from the UC-07 Build Pack's own verified rules (transition
//     safety, month-end alignment, MOT, immigration, PE risk, PTO portability)
//   - embedding-similarity retrieval over that corpus when both an `embed`
//     function and stored vectors exist (pgvector table provisioned by a human
//     per docs/SETUP-CHECKLIST.md — this module only ever READS it)
//   - honest keyword fallback otherwise, with every citation stating exactly
//     which keyword matched it
//   - `matchedOn` never quotes a raw similarity percentage — a retrieval signal
//     is not a precision claim (the same rule UC-08 pins by test)
//
// The corpus is NOT an authoritative source of law; it is background context
// for a Mobility Legal specialist. Citations are background for a human, never
// a decision input — this use case's only decision is "escalate, always".
// ---------------------------------------------------------------------------

export const MOBILITY_CORPUS = [
  {
    id: "mobility-transition-safety",
    title: "Country transfer — destination ready, THEN source exit",
    summary:
      "Creating the destination employment record does not make it safe to terminate the source employment. Source offboarding is authorized only once the destination contract is active, right-to-work is confirmed, the destination start date is confirmed, and the source exit plan is validated.",
    keywords: ["offboard", "terminate", "termination", "source exit", "transition", "safe to"],
  },
  {
    id: "mobility-month-end-alignment",
    title: "Month-end alignment and duplicate management fees",
    summary:
      "To avoid paying two monthly EOR management fees in a single calendar month, the source termination date should be the last calendar day of a month and the destination start date the first day of the following month. Overlapping active employment records in the same month trigger a duplicate fee.",
    keywords: ["month", "month-end", "month end", "duplicate", "management fee", "overlap", "aligned", "alignment"],
  },
  {
    id: "mobility-immigration-guidance",
    title: "Immigration status vs. employment status are separate concepts",
    summary:
      "Visa approval is not employment activation, and destination employment creation is not authorization to work. Immigration status, right-to-work status, and employment status must each be verified independently before the employee works in the destination.",
    keywords: ["visa", "immigrat", "right to work", "work authorization", "work permit", "work authorization"],
  },
  {
    id: "mobility-pto-portability",
    title: "PTO portability between source and destination contracts",
    summary:
      "Accrued PTO balances transfer between contracts only where source and destination local law explicitly permits cross-entity vacation-balance transfer. In all other jurisdictions the accrued balance is liquidated and paid out in the source employment's final settlement.",
    keywords: ["pto", "vacation", "holiday", "leave", "cashout", "liquidat", "portab", "transfer of pto"],
  },
  {
    id: "mobility-pe-risk",
    title: "Working in a country can create client permanent-establishment exposure",
    summary:
      "An employee habitually working in a country where the client has no established presence can create corporate permanent-establishment (PE) exposure for the client. Where such exposure is possible, flag PE_REVIEW_REQUIRED rather than concluding whether a PE exists — that is a professional tax determination.",
    keywords: ["permanent establishment", "pe risk", "pe exposure", "corporate presence", "nexus", "tax"],
  },
  {
    id: "mobility-minimum-onboarding-time",
    title: "Minimum Onboarding Time (MOT) — destination country lead time",
    summary:
      "Every destination country enforces a minimum onboarding time (MOT): the required lead time, usually in business days, between the destination employment profile being created and the employee's official start date. The start date must clear the country's MOT or the employment request is rejected.",
    keywords: ["mot", "minimum onboarding", "lead time", "start date", "onboarding", "too early"],
  },
];

/**
 * Minimum cosine similarity for an embedding match. Deliberately a floor, not
 * a precision claim — `matchedOn` says the rank and threshold in plain
 * language rather than quoting a similarity figure (mirrors UC-08's
 * EMBEDDING_MATCH_THRESHOLD discipline).
 */
export const EMBEDDING_MATCH_THRESHOLD = 0.3;

/**
 * Cosine similarity between two embedding vectors. Pure and deterministic.
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

/** The original retrieval mechanism, kept as the safe unconfigured default. */
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

/** Coerce a pgvector `vector` column value (a "[0.1,0.2,...]" string) back into number[]. */
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
 * degrade-to-keyword ladder as audit.js's optional pgPool and UC-08's retriever:
 *   - embed + stored vectors configured -> embedding similarity
 *   - either missing                       -> keyword fallback
 */
export class MobilityRetriever {
  /**
   * @param {object} [opts]
   * @param {Function} [opts.embed]       `(text) => number[]|Promise<number[]>`
   * @param {import("pg").Pool|null} [opts.pgPool]  when set, stored vectors are read from
   *   the `uc07_mobility_citation_vectors` table instead of the corpus arg
   * @param {Array<object>} [opts.corpus]
   * @param {number} [opts.threshold]
   */
  constructor({ embed = null, pgPool = null, corpus = MOBILITY_CORPUS, threshold = EMBEDDING_MATCH_THRESHOLD } = {}) {
    this.embed = embed;
    this.pgPool = pgPool;
    this.corpus = corpus;
    this.threshold = threshold;
  }

  /**
   * @param {string} text
   * @returns {Promise<Array<{id: string, title: string, summary: string, matchedOn: string[]}>>}
   */
  async retrieveMobilityGuidance(text) {
    if (!this.embed) return retrieveByKeywords(text, this.corpus);

    const queryVector = await this.embed(text);
    const stored = await this.#storedVectors();
    if (stored.length === 0) return retrieveByKeywords(text, this.corpus);

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
        `select citation_id as id, title, summary, embedding from uc07_mobility_citation_vectors`
      );
      return result.rows
        .map((row) => ({ id: row.id, title: row.title, summary: row.summary, embedding: coerceVector(row.embedding) }))
        .filter((row) => row.embedding !== null);
    }
    return [];
  }
}

let defaultRetriever = new MobilityRetriever();

/**
 * The default, unconfigured retriever — keyword fallback until both an embed
 * function and stored vectors exist.
 * @param {string} text
 * @returns {Promise<Array<{id: string, title: string, summary: string, matchedOn: string[]}>>}
 */
export async function retrieveMobilityGuidance(text) {
  return defaultRetriever.retrieveMobilityGuidance(text);
}

/**
 * Point the module-level retrieveMobilityGuidance() at a real deployment's
 * retriever (pgPool + embed). Returns the new default for convenience.
 * @param {object} opts  same options as MobilityRetriever's constructor
 * @returns {MobilityRetriever}
 */
export function configureMobilityRetriever(opts) {
  defaultRetriever = new MobilityRetriever(opts);
  return defaultRetriever;
}
