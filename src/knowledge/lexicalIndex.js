// ---------------------------------------------------------------------------
// lexicalIndex.js — BM25 over the retrieved statutory corpus, filtered by country
// ---------------------------------------------------------------------------
// WHY THIS EXISTS, AND WHAT IT REPLACES
//
// UC-07 and UC-08 are the two use cases whose entire deliverable is a DOSSIER
// for a specialist. Until this file, both searched a hand-written corpus in
// their own source: three sentences in UC-08 (`TREATY_CORPUS` — paraphrases of
// the OECD Model) and six in UC-07. Nine sentences, quoting no retrieved
// document. Meanwhile docs/knowledge/layer-1-statutory/ held 55 admitted
// passages from 14 documents, each retrieved from its own publishing authority
// with the source bytes' SHA-256 recorded.
//
// Measured before this change, on the four demo pairs:
//
//   US→PT  "...under the US Portugal tax treaty?"      -> NOTHING
//   NL→PT  "...under the Netherlands Portugal conv."   -> OECD Model Article 4
//   US→CA  "...under the US Canada tax convention?"    -> OECD Model Article 15
//   CA→NL  "...totalization agreement...?"             -> "Totalization — general principle"
//
// Three of four handed the specialist a MODEL where the governing instrument
// belongs, and the fourth handed back silence — while D-24, D-27/28/29 and
// D-21/22/23 sat in the repository. docs/RETRIEVAL.md measured the same thing
// from the other side: "Today's mechanism (3-passage keyword corpus) — cannot
// return any of the 106."
//
// WHY BM25 AND NOT EMBEDDINGS. Decided in docs/RETRIEVAL.md and adopted by
// UC-07's and UC-08's decision passes (T-26/T-27): at this corpus size the
// index type is a second-order question and "any index over the corpus beats"
// a corpus that cannot hold the answer. The two pgvector tables stay empty on
// purpose; `npm run seed-vectors` must not be run.
//
// THREE PROPERTIES THIS IS BUILT TO HOLD, each pinned by test:
//
//   1. AN INSTRUMENT ALWAYS OUTRANKS A MODEL. `authority` sorts before score,
//      so a real convention can never be displaced by the template it was
//      drafted from. CLAUDE.md §7 item 17 names the harm precisely: a model
//      offered where an instrument belongs "reads exactly like an answer".
//   2. THE COUNTRY FILTER NEVER MANUFACTURES SILENCE. A question naming no
//      recognised country searches everything. Filtering to nothing on a
//      parsing miss would turn a bad parse into an empty dossier — the exact
//      state this file was written to remove.
//   3. A MATCH SAYS WHY IT MATCHED. `matchedOn` carries the terms that scored,
//      never a similarity figure, because a number implies a precision this
//      does not have.
// ---------------------------------------------------------------------------

/** BM25 free parameters. Standard defaults; nothing here is tuned to a gold set. */
const K1 = 1.5;
const B = 0.75;

// ---------------------------------------------------------------------------
// THE RELEVANCE FLOOR — why a score threshold was NOT the answer
// ---------------------------------------------------------------------------
// BM25 will always rank SOMETHING. Without a floor, "Can I get a copy of my
// payslip?" cited Canada's social security agreement network, and "Please reset
// my password" cited a tax convention — because "get" and "please" occur in
// statutory prose. A dossier that cites an instrument for a payslip question is
// worse than one that cites nothing: the specialist has to read it to find out
// it is irrelevant, and the citation carries a real publisher and a real SHA-256
// while doing it.
//
// A SCORE threshold does not separate them. Measured on this corpus, over five
// realistic inquiries and five plainly unrelated ones: the best irrelevant hit
// scored 5.20 while a genuine "certificate of coverage" question scored 6.20 —
// overlapping ranges, so any cut loses one or admits the other.
//
// WHAT DOES separate them is HOW MANY distinct query terms matched:
//     relevant   -> 5, 4, 3, 3, 5
//     irrelevant -> 1, 2, 1, 1, 1
// An irrelevant question matches on one accidental common word. A real one
// overlaps the passage's actual subject vocabulary.
//
// So the floor is MIN_MATCHED_TERMS, with one deliberate escape hatch: a short
// but pointed query ("totalization Canada") can carry only two terms and still
// be exactly right, so two RARE terms also pass. Rarity is measured against this
// corpus, not asserted — a term in at most RARE_TERM_MAX_DF of passages.
//
// Both numbers are floors on this corpus and nothing else. They are asserted by
// test/statutoryRetrievalFloor.test.js against the same ten queries, so a corpus
// change that breaks the separation fails the suite instead of reaching a
// specialist.
// ---------------------------------------------------------------------------
const MIN_MATCHED_TERMS = 3;
const RARE_TERM_MAX_DF = 0.15;
const MIN_RARE_TERMS = 2;

/**
 * Terms too common in this corpus to discriminate. Deliberately SHORT — an
 * aggressive stop list is a second place for a relevant term to disappear, and
 * BM25's IDF already discounts a term that appears everywhere.
 */
const STOP = new Set([
  "the", "a", "an", "of", "to", "in", "and", "or", "is", "are", "be", "for",
  "on", "as", "by", "that", "this", "it", "with", "from", "at", "which", "we",
  "our", "i", "my", "they", "their", "you", "your", "if", "not", "no", "any",
  "was", "were", "has", "have", "had", "do", "does", "did", "can", "will",
]);

/** Split text into comparable terms. Keeps digits — "183" is a real query term. */
export function tokenize(text) {
  if (typeof text !== "string") return [];
  return text
    .toLowerCase()
    .replace(/[^a-z0-9À-ɏ]+/g, " ")
    .split(" ")
    .filter((t) => t.length > 1 && !STOP.has(t));
}

/**
 * Country NAMES, in the words a person actually uses.
 *
 * DERIVED FROM THE REAL REGISTRY, NOT HAND-LISTED, and the first version of
 * this file got that wrong in a way that was worse than the defect it replaced.
 * It knew four countries — the demo set — so a question about GERMANY AND SPAIN
 * named no country it recognised, which this file's property 2 turns into
 * "search everything". A Germany–Spain dual-residency question was therefore
 * answered with Canada's deemed-residence rule, Portugal's CIRS art. 16 and the
 * US substantial presence test: three real instruments, correctly quoted, about
 * three countries nobody asked about.
 *
 * That is a WORSE failure than the OECD Model paraphrase it replaced. A model is
 * at least not wrong about a jurisdiction. This was authoritative, specific, and
 * about the wrong place.
 *
 * So the vocabulary must cover countries we hold NOTHING for, precisely so the
 * filter can come back empty and the retriever can fall through to the labelled
 * model paraphrase — which is the honest answer for a pair with no instrument in
 * the corpus. Recognising a country and holding a document about it are two
 * different things, and only the first belongs here.
 *
 * BARE TWO-LETTER CODES ARE MATCHED ONLY IN UPPER CASE, and that is not
 * fussiness. Lower-cased, the ISO list is a minefield of ordinary English: `us`
 * is a pronoun, `it`, `in`, `no`, `is`, `at`, `be`, `or`, `me`, `so` and `am`
 * are all words and all country codes. The previous hand-written list carried
 * `us: "US"` and would have read "please tell us about the policy" as naming the
 * United States. Written as `US`, `NL`, `DE` it is a country; written as `us` it
 * is not, and the case is the signal.
 */
import { countryName, nameableCountryCodes } from "../shared/countryNames.js";

/** Demonyms and colloquial names the ISO registry does not carry. */
const COUNTRY_ALIASES = Object.freeze({
  dutch: "NL", holland: "NL", netherlands: "NL",
  portuguese: "PT",
  canadian: "CA",
  american: "US", usa: "US", "united states of america": "US",
  german: "DE", spanish: "ES", french: "FR", italian: "IT",
  british: "GB", uk: "GB", "united kingdom": "GB", england: "GB",
  irish: "IE", polish: "PL", indian: "IN", filipino: "PH", mexican: "MX",
  belgian: "BE", swedish: "SE", danish: "DK", norwegian: "NO", finnish: "FI",
  swiss: "CH", austrian: "AT", greek: "GR", brazilian: "BR", japanese: "JP",
});

/** name (lower case) -> ISO code, longest name first so "united states" beats "united". */
const NAME_TO_CODE = (() => {
  const map = new Map();
  for (const code of nameableCountryCodes()) {
    const name = countryName(code);
    if (name) map.set(String(name).toLowerCase(), code);
  }
  for (const [alias, code] of Object.entries(COUNTRY_ALIASES)) map.set(alias, code);
  return [...map.entries()].sort((a, b) => b[0].length - a[0].length);
})();

/**
 * The name->code table, for the n8n port only.
 *
 * An n8n Code node cannot import, so scripts/build-citation-corpus.mjs inlines
 * this table into the node bodies. Exported from here rather than rebuilt there
 * so both sides derive from the same registry and the same alias list — a second
 * copy assembled independently is a copy that drifts, and the parity test would
 * report it as a ranking difference rather than as what it is.
 */
export function NAME_TO_CODE_FOR_PORT() {
  return NAME_TO_CODE.map(([name, code]) => [name, code]);
}

/**
 * Which countries does this text name?
 *
 * Returns [] when it recognises none — which `search()` reads as "search
 * everything" rather than "find nothing", so a parsing miss can never silence
 * the retriever (property 2).
 */
export function countriesNamed(text) {
  if (typeof text !== "string") return [];
  const found = new Set();

  // 1. Names and demonyms, case-insensitively. Punctuation is flattened FIRST —
  //    matching " portugal " against "…in Portugal, dual residency…" fails on
  //    the comma, and keeping "." in the strip set to preserve "u.s." then broke
  //    "…to Portugal." on the full stop. Both were live bugs here. "u.s." is
  //    folded before the strip because stripping first turns it into "u s".
  const hay = ` ${text.toLowerCase().replace(/\bu\.s\.a?\.?/g, " usa ").replace(/[^a-z0-9]+/g, " ")} `;
  for (const [name, code] of NAME_TO_CODE) {
    if (hay.includes(` ${name} `)) found.add(code);
  }

  // 2. Bare codes, UPPER CASE ONLY, read from the untouched text.
  for (const token of text.match(/\b[A-Z]{2}\b/g) ?? []) {
    if (countryName(token)) found.add(token);
  }

  return [...found];
}

/**
 * Does this passage's document speak for the countries the question named?
 *
 * A BILATERAL INSTRUMENT NEEDS BOTH ITS PARTIES. Without this, the
 * Netherlands–Portugal convention answers a US→Portugal question — Portugal is
 * on both, the treaty is real, and it is not this pair's treaty. It reads as
 * authoritative, which makes it the same harm as citing a model where an
 * instrument belongs, one step subtler and harder to catch.
 *
 * `pairs` is explicit rather than derived because three sidecars carry more than
 * one instrument each: the three US conventions share one file and four country
 * codes, and nothing in {US, NL, PT, CA} says which codes go together.
 */
function servesCountries(passage, wanted) {
  if (Array.isArray(passage.pairs) && passage.pairs.length > 0 && wanted.length >= 2) {
    return passage.pairs.some((pair) => pair.every((c) => wanted.includes(c)));
  }
  return wanted.some((c) => (passage.countries ?? []).includes(c));
}

/**
 * A BM25 index over a fixed passage set. Built once and reused — construction
 * walks the whole corpus, and a retriever per request would do that per request.
 */
export class LexicalIndex {
  /** @param {ReadonlyArray<object>} passages */
  constructor(passages) {
    this.passages = passages ?? [];
    this.docTerms = this.passages.map((p) => tokenize(`${p.heading ?? ""} ${p.title ?? ""} ${p.text ?? ""}`));
    this.docLen = this.docTerms.map((t) => t.length);
    this.avgLen = this.docLen.length ? this.docLen.reduce((a, b) => a + b, 0) / this.docLen.length : 0;
    /** @type {Map<string, number>} term -> number of passages containing it */
    this.df = new Map();
    /** @type {Array<Map<string, number>>} */
    this.tf = this.docTerms.map((terms) => {
      const counts = new Map();
      for (const t of terms) counts.set(t, (counts.get(t) ?? 0) + 1);
      for (const t of counts.keys()) this.df.set(t, (this.df.get(t) ?? 0) + 1);
      return counts;
    });
    this.N = this.passages.length;
  }

  /** Does this match rest on real subject overlap, or on one accidental word? */
  #clearsFloor(matchedOn) {
    if (matchedOn.length >= MIN_MATCHED_TERMS) return true;
    const rare = matchedOn.filter((t) => (this.df.get(t) ?? 0) / (this.N || 1) <= RARE_TERM_MAX_DF);
    return rare.length >= MIN_RARE_TERMS;
  }

  #idf(term) {
    const n = this.df.get(term) ?? 0;
    // Standard BM25 IDF, floored at a small positive value so a term present in
    // every passage contributes nothing rather than a NEGATIVE score — an
    // unfloored IDF can rank a passage below one that matched no query term.
    return Math.max(1e-6, Math.log(1 + (this.N - n + 0.5) / (n + 0.5)));
  }

  /**
   * Score every admitted passage against a query.
   *
   * @param {string} query
   * @param {object} [opts]
   * @param {string} [opts.feed]        only passages routed to this use case
   * @param {string[]} [opts.countries] restrict to documents serving these
   * @param {number} [opts.limit]
   * @returns {Array<{passage: object, score: number, matchedOn: string[]}>}
   */
  search(query, { feed = null, countries = [], limit = 3 } = {}) {
    const terms = [...new Set(tokenize(query))];
    if (terms.length === 0) return [];
    const wanted = Array.isArray(countries) ? countries.map((c) => String(c).toUpperCase()) : [];
    const scored = [];
    for (let i = 0; i < this.passages.length; i += 1) {
      const p = this.passages[i];
      if (feed && !(p.feeds ?? []).includes(feed)) continue;
      // Property 2: an empty `wanted` admits everything.
      if (wanted.length > 0 && !servesCountries(p, wanted)) continue;
      let score = 0;
      const matchedOn = [];
      for (const t of terms) {
        const f = this.tf[i].get(t);
        if (!f) continue;
        const denom = f + K1 * (1 - B + (B * this.docLen[i]) / (this.avgLen || 1));
        score += this.#idf(t) * ((f * (K1 + 1)) / denom);
        matchedOn.push(t);
      }
      if (score > 0 && this.#clearsFloor(matchedOn)) scored.push({ passage: p, score, matchedOn });
    }
    // Property 1: authority first, score second. An instrument can never be
    // displaced by a model, whatever BM25 thinks of the wording. Note that
    // diversifyByDocument() below narrows how far this ordering survives into
    // the returned slice — its header says exactly how far.
    const rank = { instrument: 0, administrative: 1, model: 2 };
    scored.sort((a, b) => {
      const ra = rank[a.passage.authority] ?? 3;
      const rb = rank[b.passage.authority] ?? 3;
      if (ra !== rb) return ra - rb;
      if (b.score !== a.score) return b.score - a.score;
      return a.passage.id.localeCompare(b.passage.id);
    });
    return diversifyByDocument(scored, limit);
  }
}

/**
 * Spread the results across DOCUMENTS before taking a second passage from any
 * one of them.
 *
 * WHY. BM25 ranks passages, and the passages of a single document share its
 * vocabulary, so the top three for "US employee working from Canada" were three
 * chunks of the SAME sidecar — a dossier that cites one document three times and
 * calls it three citations. The specialist learns nothing from slots two and
 * three, and the Canadian domestic residence rule that should have been there
 * never appears.
 *
 * A second pass then backfills from the leftovers, so a query that genuinely
 * only matches one document still returns what it found rather than being
 * padded or truncated to one. Order within each pass is untouched — this
 * reorders, it never promotes a lower-scoring passage above a higher-scoring one
 * from the same document.
 *
 * ⚠ THIS OVERRIDES THE AUTHORITY ORDER, AND THE OVERRIDE IS BOUNDED. A second
 * passage from an already-seen document is pushed into the backfill pass, so it
 * can end up BELOW a first-seen administrative passage even though it is an
 * instrument. So the guarantee `search()` actually makes is narrower than
 * "authority is monotonic across the whole result":
 *
 *   - across the FIRST passage of each document, authority is monotonic;
 *   - a MODEL can still never appear beside an instrument, because models are
 *     not in this corpus at all — they live in TREATY_CORPUS and are only ever
 *     reached when this function returns nothing (see statutoryLeg()).
 *
 * The second bullet is the one that matters and it is unaffected. The first is
 * stated here because an earlier revision of the sort comment claimed the whole
 * result was authority-ordered, and it was not — a comment describing a
 * mechanism that is not doing the work, which this repository has paid for
 * before.
 */
export function diversifyByDocument(scored, limit) {
  const seen = new Set();
  const first = [];
  const rest = [];
  for (const hit of scored) {
    const doc = hit.passage.documentId;
    if (seen.has(doc)) rest.push(hit);
    else { seen.add(doc); first.push(hit); }
  }
  return [...first, ...rest].slice(0, limit);
}
