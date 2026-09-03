// ---------------------------------------------------------------------------
// statutoryRetrieval.js — the one place UC-07 and UC-08 reach the real corpus
// ---------------------------------------------------------------------------
// Both 🔴 use cases produce a DOSSIER, and a dossier is its citations. Before
// this module they cited a hand-written paraphrase corpus in their own source
// files and could not reach docs/knowledge/ at all. This is the shared leg;
// each retriever keeps its own class, its own degrade ladder and its own
// `matchedOn` vocabulary, because those differ and should.
//
// WHAT A CITATION FROM HERE PROMISES, AND WHAT IT DOES NOT.
//
//   IT PROMISES provenance. Every field below is copied from a document that
//   was retrieved from its own publishing authority on a recorded date, with
//   the source bytes' SHA-256 beside it. `authority` distinguishes a treaty in
//   force from an agency's reading of one.
//
//   IT DOES NOT PROMISE that the passage answers the question. BM25 ranks
//   wording. `matchedOn` therefore states the TERMS that scored and never a
//   similarity figure — docs/RETRIEVAL.md measured this class of index at 1/6
//   strict on its own gold set, and a number beside that would imply a
//   precision nobody measured. The dossier stays a compilation for a human,
//   which is the whole 🔴 contract.
// ---------------------------------------------------------------------------

import { CITATION_PASSAGES } from "./citationCorpus.js";
import { LexicalIndex, countriesNamed } from "./lexicalIndex.js";

/** Built once at module load. Construction walks the corpus; per-request would too. */
const INDEX = new LexicalIndex(CITATION_PASSAGES);

/** How much of a passage to carry as the citation's `summary`. */
const SUMMARY_CHARS = 480;

/**
 * A passage's text, collapsed for display beside a decision.
 *
 * The heading is stripped when the chunker prefixed it (it is already in the
 * title) and block-quote markers are dropped, because the quoted statutory
 * limb is the point and `> ` in a sidebar is noise. Truncation is marked with
 * an ellipsis so nobody reads a cut passage as a complete provision.
 */
function summarize(passage) {
  const heading = passage.heading ? String(passage.heading) : "";
  let body = String(passage.text ?? "");
  if (heading && body.startsWith(heading)) body = body.slice(heading.length);
  body = body.replace(/^\s*>\s?/gm, "").replace(/\s+/g, " ").trim();
  if (body.length <= SUMMARY_CHARS) return body;
  return `${body.slice(0, SUMMARY_CHARS).replace(/\s+\S*$/, "")} …`;
}

/** The title a specialist sees: the document, then the limb inside it. */
function citationTitle(passage) {
  const title = passage.title ? String(passage.title) : passage.documentId;
  const heading = passage.heading ? String(passage.heading).trim() : "";
  if (!heading || title.includes(heading)) return title;
  return `${title} — ${heading}`;
}

/**
 * Search the retrieved statutory corpus.
 *
 * @param {string} text  the inquiry, in the words the requester used
 * @param {object} opts
 * @param {"UC-07"|"UC-08"} opts.feed
 * @param {number} [opts.limit]
 * @param {string[]} [opts.countries]  override the countries read out of `text`
 * @returns {Array<object>} citations, most authoritative first
 */
export function retrieveStatutoryCitations(text, { feed, limit = 3, countries = null } = {}) {
  // AN EXPLICIT LIST WINS OVER RE-READING THE TEXT, and empty is not the same
  // as absent. A caller that KNOWS the jurisdictions — UC-08's parser extracts
  // them, and the request carries a target country — is a better source than
  // this module re-deriving them from raw prose: a dual-residency question can
  // name one country in the text while the second is on the employment record,
  // and the pair filter then cannot engage. `null` means "read the text".
  const wanted = Array.isArray(countries) ? countries : countriesNamed(text ?? "");
  const hits = INDEX.search(text ?? "", { feed, countries: wanted, limit });
  return hits.map(({ passage, matchedOn }) => ({
    id: passage.id,
    title: citationTitle(passage),
    summary: summarize(passage),
    // `matchedOn` keeps the shape every existing consumer already reads: a list
    // of strings. describeRetrievalMode() in treatyRetriever.js tests the FIRST
    // entry against /^embedding similarity/, so the leading string here must
    // stay distinguishable from that and from a bare keyword — it says which
    // index answered, in words.
    matchedOn: [
      `statutory corpus (lexical) — matched on ${matchedOn.slice(0, 6).map((t) => `"${t}"`).join(", ")}`,
    ],
    // Additive provenance. Nothing above depends on these; a viewer that does
    // not know about them renders exactly as before.
    documentId: passage.documentId,
    publisher: passage.publisher,
    sourceUrl: passage.sourceUrl,
    retrievedOn: passage.retrievedOn,
    sourceSha256: passage.sourceSha256,
    countries: passage.countries,
    authority: passage.authority,
    instrument: passage.authority === "instrument",
  }));
}

/** Countries a question named — re-exported so callers need one import. */
export { countriesNamed };

/** The corpus, for tests and for a health endpoint that reports what is loaded. */
export function corpusStats() {
  const docs = new Set(CITATION_PASSAGES.map((p) => p.documentId));
  return {
    passages: CITATION_PASSAGES.length,
    documents: docs.size,
    byFeed: {
      "UC-07": CITATION_PASSAGES.filter((p) => p.feeds.includes("UC-07")).length,
      "UC-08": CITATION_PASSAGES.filter((p) => p.feeds.includes("UC-08")).length,
    },
  };
}
