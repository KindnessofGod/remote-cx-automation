# What kind of retrieval this system uses, and what it should use

> **The short answer, and it has three parts.** This repository runs **three
> different retrieval mechanisms**, not one. None of them is RAG in the sense
> the term is usually used, and **one of them is a dormant vector index that has
> never held a row**. Meanwhile the 29 statutory documents that were retrieved,
> checksummed and written up in `docs/knowledge/` are **in none of the three**.
>
> The recommendation below is **not to seed the vector tables**. It is argued
> from a number that was measured rather than assumed: chunked the way a
> retriever would actually chunk them, this corpus is **106 passages**. At 106
> passages the case for embedding similarity is weak and the case for a
> **filtered lexical index over the real documents** is strong — and the
> strongest argument against my own recommendation is also measured, and it is
> in §7.

| | |
|---|---|
| **Written** | 2026-08-20 |
| **Verified against** | the code, and the live Supabase project `your-project-ref` |
| **Measured with** | `npm run seed-vectors` (dry run — nothing embedded, nothing written) |
| **Evidence tags** | `[CONFIRMED]` = read from code, a live query, or a live run · `[INFERRED]` = argued from something confirmed · `[PROPOSED]` = a design choice, not yet built |

---

## 1. What is running today — three mechanisms, and one of them is off

### 1.1 UC-08 and UC-07 — a *hybrid* retriever, permanently on its fallback leg

`src/uc08/treatyRetriever.js` and `src/uc07/mobilityRetriever.js` are the same
class twice: an embedding-similarity search over a pgvector table, degrading to
literal keyword matching when either the embedding function or the stored
vectors are missing. The degrade ladder is in the file's own header:

```
embed function + stored vectors  ->  embedding similarity
embed function, no vectors       ->  keyword fallback
no embed function                ->  keyword fallback
```

**Both tables hold zero rows.** `[CONFIRMED — SQL against the live project,
2026-08-20]`

```sql
select 'uc08_treaty_citation_vectors' as t, count(*) from uc08_treaty_citation_vectors
union all select 'uc07_mobility_citation_vectors', count(*) from uc07_mobility_citation_vectors;
-- uc08_treaty_citation_vectors  | 0
-- uc07_mobility_citation_vectors | 0
```

> **DECIDED 2026-08-21 (ninth decision pass, DRIFT-071) — UC-07's half is
> settled: `uc07_mobility_citation_vectors` is DROPPED, not annotated.** This
> document's own finding is the reason — the table would receive **zero rows even
> from a full seed**, because every document that feeds UC-07 also feeds UC-08 and
> a treaty document belongs in the treaty table. **A table that can never hold a
> row invites someone to try to fill it**, and two agents have now had to be told
> not to. Keyword matching over the six-entry corpus stays, and every status line
> in `CLAUDE.md`, `README.md`, `docs/BUILD-LOG.md` and `UC-07.md` §15 describing
> it as embedding similarity is corrected — those were **true of the code and
> false of the running system**, which is what directive 7 exists to prevent.
>
> **Nothing is lost by dropping it.** `scripts/seed-citation-vectors.mjs` and this
> document remain the durable evidence that the pipeline was built, measured at
> **106 passages**, and deliberately not run. That is the story worth telling, and
> an empty table is not part of it.
>
> ~~**UC-08's half is NOT decided**~~ **→ DECIDED 2026-08-21, and it landed on the
> same recommendation from the same measurement.** UC-08's decision pass adopted
> this document in full: **do not seed**, correct the status rows, and replace the
> hand-written passages with a **country-filtered lexical index** over the 106
> real statutory passages — as **one decision** across both use cases, which is
> what `E15` asked for. `E15` is now fully answered; **DRIFT-046 is
> decided-by-recommendation, not closed** — the tables stay empty on purpose,
> which is a decision rather than an omission. `npm run seed-vectors` must not be
> run. Queued as UC-08 `T-26`/`T-27`; **nothing is built.**
>
> **What decided it in the end was not the status overclaim — it was the
> fallback's output.** The keyword leg can hand a specialist *"OECD Model
> Article 4 — Resident (tie-breaker rules)"* on a DE/ES question: the template
> the governing convention was drafted from, offered where the convention belongs.
> A retriever that returns nothing is recoverable; one that returns a model in
> place of an instrument is not, because it reads exactly like an answer.
>
> **BUILT 2026-08-30 — this document's recommendation is now the running system;
> `docs/BUILD-LOG.md` §3.95 has the write-up.** `src/knowledge/` holds a
> generated corpus of **57 admitted passages from 14 documents** (55 at §3.95; §3.98b split the three bundled US conventions into a passage each) and a
> country-filtered BM25 index, and UC-07 and UC-08 both search it. §1.1's table
> below is therefore a record of what the mechanism USED to return, not of what
> it returns today — its five queries were re-run after the change and three of
> the five that retrieved **0** now retrieve real instruments. The tables stay
> empty and `npm run seed-vectors` must still not be run; nothing in this
> document's argument against embeddings was overturned, it was acted on. What
> **Both n8n graphs were republished and proven the same day**: `Build Dossier`
> (`WORKFLOW_UC08_ID`, execution `10708`) and `Relocation Gates`
> (`WORKFLOW_UC07_ID`, execution `10710`), both `pinData: None`, both writing a
> real dossier row carrying real instruments with their publishers.

> **Still open: the timing** — before or after submission. `I3` in
> `qa/HUMAN-DECISIONS-REQUIRED.md`. If only one of the two ships first, it should
> be the status correction (`T-27`), because a reader who sees a model article
> cited as authority has been misled by the *output* and no status row corrects
> that at the moment they read it.

They were provisioned on 2026-08-09 and have been empty ever since, so **every
citation any production run has ever shown a specialist was keyword-matched.**
The code says so itself, in `describeRetrievalMode()`'s comment, and does not
hide it: a keyword citation states the literal keyword that matched it, an
embedding citation would state its rank and threshold. `[CONFIRMED]`

What is being searched is **not** the 29 documents. It is a hand-written corpus
in the source file: **three passages in UC-08** (`TREATY_CORPUS` — OECD Model
art. 4, art. 15, and totalization in general) and **six in UC-07**
(`MOBILITY_CORPUS`). Nine sentences, written from domain knowledge, quoting no
retrieved document. `[CONFIRMED]`

That is not sloppiness — the OECD entries are paraphrase-only *by licence*, and
`L1-01-L1-11-oecd-citation-register.md` exists specifically so nobody
"improves" them by pasting the source in. But it does bound what the mechanism
can possibly return. Driven live against the real function: `[CONFIRMED]`

| Query, in the vocabulary a ticket actually uses | Citations returned |
|---|---|
| "I have been working from Portugal for seven months this year, will I owe income tax there as well as at home?" | **0** |
| "am I still covered by my home country pension while abroad" | **0** |
| "which country taxes my salary if I split the year between two" | **0** |
| "Do I need a certificate of coverage for social security while on assignment?" | 1 |
| "I spent 183 days in Spain" | 1 |

Three of five realistic inquiries retrieve **nothing at all**. The first one is
the worst: seven months in Portugal is the 183-day question, asked the way a
person asks it, and the passage that answers it is in the corpus. The word
"183" is not.

**Read that failure carefully, because it is the whole argument.** It is not a
failure of keyword matching versus embeddings. It is a failure of a
**three-passage corpus**. No ranking function recovers a document that is not in
the index — and D-24 through D-35, which hold *six different 183-day windows*
from six real conventions, are not in the index.

### 1.2 UC-04 and UC-05 — a hand-curated map, and it is not retrieval at all

`src/uc04/decisionSources.js` holds **24 documents against 13 findings**, with
**11 findings explicitly recorded as uncited**. `src/uc05/decisionSources.js`
holds **2 documents against 4 findings**, with **6 uncited**, and sources
exactly **one** of its nine notice-table countries (Portugal). `[CONFIRMED]`

Their own `RETRIEVAL_METHOD` string is the honest description, and it is served
to the reviewer:

> "Hand-curated: each document below is listed against this finding … by someone
> who read it. **There is no search, no ranking and no similarity score**, so no
> figure of confidence is quoted. **A finding with no entry gets no citation
> rather than a nearest match.**"

The uncited counts are the part people skim past and they are the most valuable
thing in both files. Eleven UC-04 findings and six UC-05 findings say, on the
screen, *no document in this repository supports this check*. A retriever cannot
say that. A retriever always has a nearest neighbour.

### 1.3 `docs/knowledge/` — read, checksummed, and connected to nothing

**35 of 39 catalogue documents retrieved**, written up as **29 sidecar files**,
each carrying publisher, exact URL, retrieval date, SHA-256 of the retrieved
bytes and a licence basis; **3.4 MB of retrieved bytes across 23 files** under
`sources/`, committed only where the licence permits a copy. `[CONFIRMED]`

None of it is reachable from any of the three mechanisms above. `[CONFIRMED —
no import of `docs/knowledge/` exists in any retriever; the `decisionSources.js`
maps reference paths as strings for display]`

### 1.4 A fourth mechanism, in flight while this was written

**Recorded because it lands in the middle of this document's subject, and a
reader six weeks from now needs to know it was concurrent rather than
overlooked.** `[CONFIRMED — read from the working tree, 2026-08-20]`

`src/uc07/decisionSources.js` and `src/uc08/decisionSources.js` were created by
a parallel piece of work while this was being measured. They are the UC-04 /
UC-05 hand-curated map, extended to the 🔴 use cases: a **jurisdiction, or a
jurisdiction PAIR, resolving to the instrument that governs it, or to nothing**
— `SOURCED_PAIRS` covers the six demo pairs `CA|NL CA|PT CA|US NL|PT NL|US
PT|US`. Neither file is imported by anything yet.

Their own header draws the distinction this document turns on, in one sentence
better than mine: *"Canada–Portugal is not a near miss for Canada–Netherlands,
it is a different treaty with a different window and a different posting
maximum, and a similarity search that returned one for the other would be wrong
in a way nobody downstream could detect."*

**That is correct, and it narrows §5 rather than contradicting it.** A dossier
has two different retrieval jobs and they want different mechanisms:

- **"Which instrument governs CA→NL?"** is a **lookup on structured, already-
  authenticated data** — two country codes off the employment record. It must
  never be a search, and a map is the right answer. §4's argument applies here
  in full.
- **"Which passage answers what this person actually asked?"** is genuinely
  free text over 106 passages, and a map cannot answer it because nobody can
  enumerate the questions in advance. That is the half §5 step 2 is about, and
  it is unaffected.

If the two are ever collapsed into one mechanism, the collapse should go in the
direction of the map: an unanswerable question is better returned empty than
approximately.

**So the honest answer to "what kind of retrieval are we using?" is: a
nine-sentence keyword lookup on the 🔴 dossier path, a hand-written citation map
on the 🟡 path, an empty vector index in between, and — as of today — a fourth
map being built for the 🔴 path too. None of them is RAG, and none of them can
reach the 106 passages in §2.** `[CONFIRMED]`

---

## 2. The corpus, measured rather than estimated

Everything below comes from `npm run seed-vectors`, which chunks the corpus the
way a retriever would and prints the plan without embedding or writing anything.

| | |
|---|---|
| Sidecar files on disk | **29** (covering 35 catalogue ids; grouped files like `D-21-D-22-D-23` are one file) |
| Sidecar markdown | **163 KB**, ~23,700 words |
| Documents admitted to an index | **27** |
| Documents excluded | **2** (see §8) |
| **PASSAGES AFTER CHUNKING** | **106** |
| Passage length | min 223 chars · median 915 · p90 1,224 · max 2,239 |
| Passage length in tokens | min 56 · median 229 · max 560 `[INFERRED — no tokenizer dependency; see `estimateTokens()`]` |
| Total tokens, all admitted passages | **23,097** `[INFERRED]` |
| Cost to embed all of it, once, `text-embedding-3-small` @ $0.02/1M | **$0.000462** |
| Passages with a source SHA-256 | 22 of 27 documents (§8.3) |

**106.** Not tens, and not thousands. That single number does most of the work
below, so it is pinned by a test (`test/citationVectorSeed.test.js`) that fails
if the chunker ever degenerates to one passage per file or explodes past a
thousand — because the argument would still *read* as sound while resting on a
number that had quietly stopped being true.

### 2.1 The cost is not the argument, and pretending otherwise would be dishonest

Embedding this entire corpus costs **five hundredths of a cent**. Re-embedding
it every day for a year costs seventeen cents. **Nobody should choose an index
type here to save money.** Any argument in this document that leans on cost is
a bad argument, and there are none.

---

## 3. Is embedding similarity the right choice at this size?

### 3.1 What I measured

Three probes over the 106 real passages, against a **six-query gold set I wrote
myself**. `[CONFIRMED — the runs; the gold set is my judgement, not a
benchmark]` It is small, it is self-authored, and it is the weakest evidence in
this document. It is reported anyway because it is the only evidence there is,
and a hand-made probe stated as a hand-made probe beats an assertion.

| Ranker | P@1 | any gold document in top 3 |
|---|---|---|
| Today's mechanism (3-passage keyword corpus) | — | **cannot return any of the 106** |
| BM25 over the 106 passages | 1/6 | 3/6 |
| BM25 + title/heading field boosting | **2/6** | **4/6** |
| BM25 + field boosting + **country filter** | **3/6** | **4/6** |

The country filter is the biggest single improvement, and it costs nothing to
build: **the employment's country is already authenticated data on the Remote
record.** It is not something to be inferred from the query at all. Restricting
the candidate pool to documents whose jurisdiction matches took "how long can I
stay in the Schengen area on a Canadian passport" from returning the US WARN Act
at rank 1 to returning Schengen Borders Code art. 6(1) at rank 1. `[CONFIRMED]`

### 3.2 What the numbers say, and what they do not

**They do not say BM25 is good here. 3/6 P@1 is not good.** They say three
things, all of which point the same way:

1. **The gap between "what is indexed" and "what exists" dwarfs the gap between
   ranking functions.** Today's mechanism scores structurally zero on this set —
   not because keyword matching is bad, but because the documents are absent.
   Any index over the 106 beats it. The index type is a second-order question.

2. **Where the ranking fails, the cause is corpus shape, not similarity
   arithmetic.** A sidecar is 5–53 % quoted statutory text and the rest is this
   repository talking to itself — *"What this settles for `src/uc05/`"*,
   *"recorded as CONTRADICTIONS C-18"*. That vocabulary is dense, distinctive
   and completely irrelevant to an employee's question, and it is what a query
   for "notice period" is competing against. Embedding the same badly-shaped
   passage does not fix a badly-shaped passage. **Splitting the quoted limb
   from the commentary would help both rankers more than swapping one for the
   other.** `[INFERRED — from the failure cases, not separately measured]`

3. **At 106 passages, the properties that matter are not the ones embeddings
   optimise.** A vector index earns its keep at a scale where a human cannot
   hold the corpus in their head and where paraphrase gaps are the dominant loss
   mode. 106 passages across 29 documents is a corpus a specialist *can* hold in
   their head, and this repository has already written down, per document, which
   finding each one answers.

### 3.3 The property that decides it — explainability under a decision a human signs

This is the part specific to *this* system, and it is the reason I would give in
an interview.

A UC-08 dossier goes to a tax specialist who may have to defend a position to a
tax authority. Two citation footers:

> *"Cited because your message contains the phrase **dual resident**."*

> *"Cited because this passage ranked **1 of 4** above a 0.3 similarity floor."*

The first can be checked by reading. The specialist sees the trigger, sees the
passage, and can say *"that match is wrong, the phrase there means something
else"*. The second cannot be checked at all — the threshold is a floor somebody
chose, the ranking is over an index the reader cannot see, and the honest
`matchedOn` string the code already writes ("never an invented precision score")
is honest precisely *because* it refuses to tell you anything you could act on.

BM25 sits with the first. Every term contributing to a score is a word in the
query and a word in the passage, and both are on screen. `[INFERRED]`

**Verdict: at 106 passages, no. Embedding similarity is not the right choice
here today.** `[INFERRED — from §2's count, §3.1's probes and §3.3's argument]`

---

## 4. Where a citation is load-bearing, and where it is decoration

The single most important distinction in this document, and it is what stops
"add retrieval everywhere" from being the answer.

| | 🟡 UC-04 / UC-05 | 🔴 UC-07 / UC-08 |
|---|---|---|
| What the system produces | a **decision** a specialist approves or denies | a **dossier**, and nothing else — there is no execution path, asserted by test |
| What the citation does | sits **beside** a finding the gates already made | **is** the deliverable |
| Cost of a wrong-but-plausible citation | a human signs a decision partly on a source that does not say what it appears to | a specialist reads a passage that is merely *nearby* and starts from the wrong article |
| Cost of no citation | the finding stands unsupported, **and the screen says so** | the dossier is thinner |

**On the 🟡 path the hand-curated map is not a placeholder for retrieval. It is
better than retrieval, and it should stay.** `[INFERRED]` Three reasons, and the
third is the one that settles it:

1. It carries `locator` and `citedFor` — *which article*, and *why it was cited
   for this finding*. A ranker produces neither. It produces a document and a
   score.
2. It can return **nothing**. `UNCITED_FINDINGS` puts *"no document in this
   repository supports this check"* on the screen, eleven times in UC-04. A
   similarity search's floor is a tuning parameter; below it you get silence
   that looks like absence, above it you get a nearest match that looks like
   support. Neither is the honest statement.
3. **A nearest match beside a decision a human signs is worse than a blank.** A
   blank is visibly a blank. A plausible citation under a gate the reviewer is
   about to approve borrows the authority of the gate.

**On the 🔴 path the calculus inverts.** The dossier *is* the output; there is no
gate for a bad citation to borrow authority from, and the specialist's whole job
is to read the sources and disagree with them. Breadth is worth more than
precision there, and it is exactly there that the corpus is nine hand-written
sentences.

**That inversion is the recommendation.** The system currently has curated
precision where it needs breadth, and an empty index where curation was already
done.

---

## 5. Recommendation

**Do not seed the vector tables.** Four steps instead, in this order.
`[PROPOSED]`

1. **Leave `src/uc04/decisionSources.js` and `src/uc05/decisionSources.js`
   exactly as they are.** No retriever on a 🟡 decision path. §4. The same
   applies to the UC-07/UC-08 maps landing in §1.4, for the jurisdiction-pair
   lookup they do — that is structured data, not a query.
2. **Replace UC-07's and UC-08's nine hand-written passages with a lexical index
   over the 106 real ones**, country-filtered first (the country is
   authenticated data, not a guess), BM25 within the filtered pool, title and
   heading boosted. Measured at P@1 3/6 versus a current mechanism that
   structurally returns zero of them. Keep the existing `matchedOn` honesty
   contract; a BM25 hit can state the matched terms, which is *more* checkable
   than what the keyword path says today.
3. **Reshape the passages before touching the ranker.** Split each sidecar's
   quoted statutory limb from this repository's commentary about it, and index
   them as separate passages with the commentary as metadata. §3.2 item 2 —
   this is the highest-value change and it is independent of index type.
4. **Keep `scripts/seed-citation-vectors.mjs` unrun, and keep it in the
   repository.** It is the evidence for step 1: a pipeline that was built,
   measured and deliberately not run.

**One thing to fix regardless of any of this**, found while measuring:
`uc07_mobility_citation_vectors` would receive **zero rows even from a full
seed**. Every document that feeds UC-07 (D-17, D-20) also feeds UC-08, and a
treaty document belongs in the treaty table. The mobility table is not
under-seeded; it has no documents of its own in the corpus at all. `[CONFIRMED —
`routeTable()` over the manifest's own Feeds column]`

---

## 6. What this recommendation is *not*

It is not "retrieval is overrated" and it is not "we don't need RAG". The system
**needs better retrieval than it has**, urgently — three of five realistic
inquiries return no citation at all today, on the use case whose only output is
citations. The claim is narrower and it is about ordering:

> **Indexing the documents you already have beats improving the ranker over
> documents you do not.**

---

## 7. The single strongest argument against me

**Six of the 29 sidecars carry their operative statutory text in Dutch or
Portuguese** — D-01, D-02, D-03, D-10, D-31, D-32 — and the demo surface is
NL · PT · CA · US, so **half the demo jurisdictions are non-English**.
`[CONFIRMED — counted]`

A lexical index cannot bridge that. It is not a tuning problem; there is no term
overlap between *"how much notice do I have to give to resign"* and *"De door de
werknemer in acht te nemen termijn van opzegging bedraagt één maand"*. A
multilingual embedding model can, and that is precisely the loss mode embeddings
exist for.

**This is not hypothetical — it is the measured failure.** The one query in §3.1
that country filtering did *not* fix is exactly this one: with the pool
restricted to the Netherlands, D-01 still loses, because its English prose is
about `src/uc05/` and its law is in Dutch.

So the honest form of the recommendation is: **lexical first, and a hybrid the
day cross-language retrieval is needed — which is a real need in this corpus
today, not a future one.** The reason it does not flip the recommendation *yet*
is step 3 of §5: D-01's sidecar carries an English working translation of every
Dutch limb it quotes, and indexing that translation as its own passage closes
the gap for the six known documents at a fraction of the cost and none of the
opacity. That works because there are six. It stops working somewhere around
sixty. `[INFERRED]`

---

## 8. Licence — what may not go into an index, and why

A vector store is a **mirror**: it holds the bytes, in order, and serves them
back on request. Every rule in `docs/knowledge/README.md` about mirroring
therefore applies to it, harder — a fuzzy lookup over a cached copy is still a
cached copy.

### 8.1 The categorical exclusion — `layer-1-statutory/sources/`

**No file under `sources/` is chunked. 23 files, 3.4 MB, all of it.**
`[CONFIRMED — `loadSidecars()` reads only top-level `D-NN*.md`; asserted by
test]`

Two independent reasons, either sufficient:

- **Licence.** Roughly half the corpus is class **(c)** — *"quote the article
  being acted on, cite the URL, do not mirror the site"* — and no bytes were
  committed for those at all. A per-file switch over `sources/` is one wrong row
  away from mirroring something nobody may mirror.
- **Retrieval quality.** `D-01`'s retrieved bytes are 20 KB of
  `wetten.overheid.nl` HTML, most of it navigation chrome. The sidecar is the
  article plus what it settles, written in the vocabulary a support ticket uses.
  The better licence answer and the better retrieval unit are the same file.

**What *is* indexed is the sidecar** — this repository's own prose plus the short
attributed quotation every licence class already permits, already published in a
public repository. Quoted material is 5–53 % of a sidecar (median ~32 %), one
article at a time. `[CONFIRMED — measured per file]` `[INFERRED — that this
constitutes the permitted quotation rather than a mirror]`

### 8.2 The named exclusions

| Excluded | Class | Why |
|---|---|---|
| **OECD Model Tax Convention, Commentaries, BEPS Action 7** | **(d)** | Paraphrase only, **never copied, now or ever**. A licence constraint, not an access one. Nothing OECD-authored is chunked, and `L1-01-L1-11-oecd-citation-register.md` — which holds no OECD text by design — stays a register. |
| **D-30** MLI status / matching database | **(d)** | Same. Not retrieved, and would be excluded if it were. |
| **D-36 / D-37 / D-38** OFAC, EU consolidated list, Canadian autonomous list | (a)/(b) — **clean** | **Excluded despite a clean licence.** `docs/knowledge/README.md`: a checked-in copy of a sanctions list is the *"helpful cached fallback"* that is dishonest to ship. `CONTRADICTIONS` **C-16/C-25** show what a flattened list does — the EU register **blocks the United States** and the UN's reference-number prefixes **block the United Kingdom**, because `GB` there is Guinea-Bissau. A vector index is a cache with fuzzy lookup. |
| **D-39** UN Consolidated List | **(c)** — corrected | Same do-not-vendor rule, **and** un.org is *"All rights reserved … none of the materials … may be used, reproduced or transmitted"*. |
| **IBFD, Bloomberg Tax, Vialto, Big-4 country guides** | — | Out entirely (`KNOWLEDGE-SOURCES.md` X-03). **Not fetched, not paraphrased, not cited, not embedded.** Nothing from them is in `docs/knowledge/`, so nothing from them can reach an index. |
| **`support.remote.com`** | — | **Cite-and-link only.** No body is held anywhere in the repository, so there is nothing to chunk. Quoting a paragraph back to a Remote customer is the evident intended use; mirroring the help centre into a searchable store is a materially different act nobody has granted. |
| **`developer.remote.com` pages** | — | Held as schema facts and short attributed quotations, never the page. Layer 2/3 are outside this index's scope in any case. |

The gate is enforced in code and it **fails closed**: a document with no licence
class in `DOWNLOAD-MANIFEST.md` §4 is refused, and so is a class the code does
not recognise. The class is read **out of the manifest at runtime**, never
restated in the script — a local copy would drift, and the drift would be
invisible because both copies would agree with each other. `[CONFIRMED —
`admitDocument()`, six tests]`

### 8.3 One honest gap in traceability

Every stored row carries the `D-NN` id, title, publisher, source URL, retrieval
date and the SHA-256 from the sidecar. **Five documents have no SHA-256** —
D-11, D-21/22/23, D-24, D-25, D-34 — because their licence forbids a copy, so no
bytes were committed and no digest exists. For those the chain ends at
publisher + URL + retrieval date. That is weaker than a hash and it is not
nothing; a row reporting `null` **as if it were a hash** would be. The dry run
names them; `--commit` warns before writing them. `[CONFIRMED]`

---

## 9. The pipeline, built and deliberately not run

`scripts/seed-citation-vectors.mjs` · `npm run seed-vectors`

**It has never been run against Supabase and is not authorised to be.** The
repository owner has not approved seeding, and §5 recommends against it. What
exists is the measurement.

- **`--dry-run` is the default.** Writing takes an explicit `--commit`.
- **Idempotent by primary key, not by application logic.** `citation_id` is
  `<document>#<zero-padded chunk index>`, so the tables' existing PK adjudicates
  one row per (document, chunk) — the same lesson `workflow_claims` paid for.
  `content_hash` is compared *before* embedding, so a re-run over an unchanged
  corpus costs **$0.00** and writes nothing. A row the plan no longer produces
  is **reported, never silently deleted**.
- **It never creates or alters schema.** Both tables carry five columns and none
  of the provenance; the script reads the live columns, prints the exact DDL a
  human must apply, and **refuses `--commit` until it exists**. An untraceable
  citation in a tax dossier is worse than no citation.
- **Exits 2, never 0, when it cannot reach what it needs** — knowledge
  directory, manifest, database or embedding API — matching the `verify-*`
  scripts, so a skipped run can never be misread as a clean one.
- **Hermetic:** `pg` and `openai` are imported dynamically inside the `--commit`
  branch, so importing the module opens nothing. Asserted by test, because that
  is exactly the property a later edit breaks by hoisting one import.

**Dry-run output, 2026-08-20:**

```
  documents admitted ......... 27
  documents excluded ......... 2
  PASSAGES (total) ........... 106
  passages with a table ...... 55
    → uc08_treaty_citation_vectors   55
    → uc07_mobility_citation_vectors    0
  passages with no table ..... 51
  tokens, all admitted ....... 23,097
  COST to embed the seedable set once, text-embedding-3-small @ $0.02/1M:
      $0.000228
```

**51 of the 106 passages have nowhere to go**, and that is the finding, not a
bug. They come from D-01…D-16 — Portuguese and Dutch notice statutes, the
Schengen Borders Code, the visa annexes, the D8, VWP/ESTA, B-1, IRPR s. 186 —
which feed **UC-03, UC-04 and UC-05**, the use cases that have no vector table
and deliberately cite through hand-curated maps instead. Inventing a third table
for them would put statutory passages behind a similarity search on the 🟡 path
a human signs, which §4 argues is the one place they must not be.

---

## 10. Summary for someone with thirty seconds

- **What we use now:** a nine-sentence keyword lookup (UC-07/UC-08), a
  hand-curated citation map (UC-04/UC-05), an empty pgvector index, and a fourth
  map landing for UC-07/UC-08 as this was written (§1.4). Not RAG.
- **The corpus:** 29 retrieved, checksummed statutory documents → **106
  passages**, indexed nowhere.
- **The recommendation:** don't seed the vectors. Index the 106 lexically,
  filtered by the country already on the employment record, and reshape the
  passages first. Leave the 🟡 hand-curated maps alone — they can say *"no
  source exists for this"*, and a ranker never can.
- **The strongest counter:** six documents' operative text is Dutch or
  Portuguese, half the demo jurisdictions are non-English, and no lexical index
  bridges that. Mitigated today by indexing the English working translations the
  sidecars already carry; that mitigation does not scale past a few dozen
  documents.
- **The cost of being wrong about all of this:** $0.000462.
