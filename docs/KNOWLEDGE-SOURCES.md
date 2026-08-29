# Knowledge sources — the catalogue

> **Retrieval pass completed 2026-08-19.** Every Layer-1 URL below was
> `[PROPOSED]` — recommended from domain knowledge, never fetched. Each has now
> been **attempted**, and each entry carries a dated **Retrieval** line saying
> what happened. What was retrieved and what we are entitled to hold is vendored
> under **[`docs/knowledge/`](knowledge/README.md)**, one provenance-stamped
> file per source.
>
> **⚠ THE HEADLINE BELOW IS SUPERSEDED. Read this first.** Later on
> **2026-08-19** the container's egress allowlist was opened for the statutory
> hosts and a **second Layer-1 pass** ran. **26 of the 39 documents catalogued in
> [`docs/knowledge/DOWNLOAD-MANIFEST.md`](knowledge/DOWNLOAD-MANIFEST.md) were
> retrieved**, from their publishing authorities, and are vendored under
> [`docs/knowledge/layer-1-statutory/`](knowledge/layer-1-statutory/). The
> 13 that were not are recorded with **four distinct failure classes** — egress
> policy, site bot protection, JavaScript-only pages, and one origin serving an
> incomplete TLS chain — in the rewritten
> [`RETRIEVAL-BLOCKED.md`](knowledge/layer-1-statutory/RETRIEVAL-BLOCKED.md).
>
> **The most valuable output of that pass is
> [`CONTRADICTIONS.md`](knowledge/layer-1-statutory/CONTRADICTIONS.md)** —
> sixteen places where a retrieved document contradicts, refines or confirms a
> number, a set or a shape that `src/` carries on an assertion. Two are
> confirmations. Several of the rest would be **wrong to encode**, and the file
> says which.
>
> ~~**The headline, stated plainly because it is the finding:** of the thirteen
> Layer-1 statutory sources, **none was retrievable**~~ — that was true of the
> first pass and is no longer true. Every authority host was refused by this
> session's organisation egress policy, an HTTP 403 answered to the proxy
> `CONNECT` before any request reached the authority; the allowlist has since
> changed. The **eight** Layer-2 and Layer-3-carrier sources on
> `developer.remote.com` were all retrieved, checksummed and vendored as
> extracts on the first pass and are unaffected. `support.remote.com` stays
> link-only **by licence**, and would have stayed link-only even had it been
> reachable — that half of the finding is unchanged by any allowlist.
>
> **Still true after both passes, and deliberately so: nothing has been seeded,
> embedded, or written to any store, and no file under `src/`, `test/`,
> `workflows/`, `zaf-app/` or `scripts/` was changed.** That includes the
> sixteen contradictions — a gate change is a separate, reviewed unit of work,
> and `src/uc08/jurisdictionKnowledge.js`'s assertion that `183`, `365` and
> `180` appear nowhere in its register must keep passing.
> §9's recommendation against seeding the vector tables is unchanged — and §9
> now has real corpus measurements behind it rather than estimates.

> **This is a specification to be approved, not a build.** Nothing here has
> been seeded, embedded, or written to any store. No file under `src/` was
> changed. The point is that the owner sees and approves the source list
> *before* anything is ingested.
>
> **The question it answers.** *"There are policies too risky to put into
> deterministic code — the number of days that triggers tax in one country
> differs from another. There are country policies, company policies and
> Remote.com policies to consider. What are all the documents required for all
> these use cases, and where would you get them from?"*
>
> **Evidence discipline** (`CLAUDE.md` §3 directive 4). Every claim carries a
> tag. `[CONFIRMED — schema]` = read in the OpenAPI JSON on a
> `developer.remote.com` page. `[CONFIRMED — repo]` = read in this repository's
> own code. `[CONFIRMED — live]` = queried against a running service today.
> `[CONFIRMED — support, via index snippet]` = Remote's words, surfaced through
> search indexing, **one notch weaker** because `support.remote.com` sits behind
> a Cloudflare interstitial this container cannot clear. `[PROPOSED]` = a source
> I am recommending, not one I have ingested. `[INFERRED]` = our reasoning,
> never an authority's. `[SILENT]` = the authority does not say.
>
> **Verified live 2026-08-19** in the course of writing this: `curl` reaches
> `developer.remote.com` (where `WebFetch` is blocked); both pgvector tables
> hold **zero rows** and carry **no provenance columns**; the country form-schema
> and holidays endpoints exist with the shapes described below.
>
> Read alongside `docs/00-FOUNDATION.md` §4 invariant 9 (the curated
> nine-country scope), `docs/research/CROSS-BORDER-FLOW.md` (what Remote
> actually does when cross-border work is requested), and
> `docs/research/COUNTRY-SUPPORT-SEMANTICS.md` (what `GET /v1/countries`
> membership does and does not mean).

---

## 1. The sorting rule — read this first

Everything below follows from one decision: **what goes in a versioned table,
what goes in a retrieval corpus, and what must not be in the product at all.**

The owner's proposed test was:

> *If being wrong about it would change a decision without anyone noticing, it
> belongs in a versioned table with provenance, not in a vector store.*

**I adopt it, and sharpen it into three tests applied in order.** The owner's
version names the *failure* condition; it needs a positive criterion in front of
it and a structural check behind it, or the sorting stays a matter of taste.

### Test A — the arity test (the positive criterion)

> **Does the question have exactly one right answer that a nameable authority
> publishes?**

Ask it as: *could two competent specialists, given the same facts and the same
authority, disagree about the answer?*

- **No, they could not** → it is a **fact**. Table.
  *Germany's statutory notice is four weeks under BGB §622.* *The Schengen
  short-stay allowance is 90 days in any 180.* *Canada is on the SSA
  totalization list.* *Portugal is a row of `GET /v1/countries`.*
- **Yes, they could** → it is **reasoning**. Corpus, or out of scope.
  *Is this person UK-resident?* *Does this trip create a permanent
  establishment?* *Does "attending a conference and signing the reseller
  contract" count as work?*

### Test B — the owner's test (the safety net)

> **If the answer were wrong, would anything downstream catch it?**

If nothing would — if a wrong value produces a well-formed answer that no gate,
no schema and no human contradicts — then it **must** be a table with provenance
and a version, *even when it feels like reasoning*. Wrong-and-silent is the
condition that forces versioning. It never licenses a vector store.

This is the test that does the real work, because this repository has already
paid for its failure mode repeatedly. `CLAUDE.md` §4: *"fixtures were written to
agree with the code, and the code with the fixtures, so neither was ever
compared to Remote. Every defect above passed the full suite."* A similarity
search returning the wrong passage is the same shape one layer up — plausible,
well-formed, uncontradicted.

### Test C — the reachability test (the structural check)

> **Can a gate read it?**

A corpus entry must be **structurally unreachable from any conditional**, not
merely discouraged from being read. This is the same discipline UC-08 already
applies to writes: `handleTaxInquiry()` takes no `remote` client at all, because
*"a policy check that merely refuses to call a write method is one bug away from
calling it; removing the parameter entirely removes the bug's precondition"*
[CONFIRMED — repo, `src/uc08/workflow.js`].

The corpus equivalent: **no `policyEngine.js` may import from a retriever, and no
citation id may ever appear in a conditional.** Citations enter
`dossier.citations`, get rendered to a human, and go nowhere else. That is
greppable and therefore testable — which is what makes this sorting checkable by
a reviewer rather than argued about.

### The rule in one line

> **A table is a fact with an authority and a version, read by a gate. A corpus
> is reasoning with a citation, read by a person. If it is wrong and nothing
> would notice, it is a table — whatever it looks like.**

### The trap this rule is built to catch

Some reasoning *looks* tabular. The UK Statutory Residence Test contains a
literal grid of ties against days. Encoding that grid is the single most
tempting and most dangerous move in this whole catalogue: the grid is only
reachable after the automatic overseas and automatic UK tests have both failed,
and each "tie" is itself a facts-and-circumstances question. A gate reading the
grid alone would return a confident, well-formed, wrong answer — Test B's exact
failure. `docs/use-cases/UC-04.md` §12 item 1 already states the conclusion:
*"ties-based test can't be reduced to a lookup."* [CONFIRMED — repo]

And the converse trap: some facts feel like judgement. Whether a totalization
agreement exists between the US and India feels like tax expertise. It is a
lookup against a list SSA publishes, and treating it as judgement is how you end
up with an LLM asserting coverage that does not exist.

---

## 2. The tenancy finding — the second decision everything follows from

**A company policy is per-tenant data, not shared knowledge. It cannot live in
one global corpus without leaking one customer's rules into another customer's
dossier.**

This is not hypothetical here. Two live checks, both run today:

**Finding 2a — the vector tables have no tenancy key.**
[CONFIRMED — live, 2026-08-19]

```
uc07_mobility_citation_vectors : citation_id, title, summary, embedding, created_at
uc08_treaty_citation_vectors   : citation_id, title, summary, embedding, created_at
```

No `company_id`. A company-policy passage stored in either table is retrievable
by every tenant, on every query, forever. There is no filter to add later that
was not designed in: retrieval ranks the whole table.

> **[UPDATED 2026-08-21 — the exposure is latent, and it is now decided that it
> stays latent.]** Both tables still hold **zero rows**, and UC-08's decision pass
> adopted `docs/RETRIEVAL.md`'s recommendation: **do not seed.** So no
> company-policy passage is in either table and none is going to be put there.
> **That does not close this finding** — it removes the trigger, not the design
> defect. Whatever replaces these tables (the decided remedy is a
> country-filtered lexical index over the statutory corpus) must carry a tenancy
> key **from its first row**, because the argument above is about a schema with no
> filter to add later, and it transfers unchanged to any successor. `T-26`.

**Finding 2b — the same tables have no provenance columns either.**
No `source_url`, no `authority`, no `jurisdiction`, no `version`, no
`retrieved_at`, no `licence`. **As currently designed, these tables cannot store
a citation that meets this document's own provenance bar.** That is a schema
question before it is a content question, and it is an independent reason not to
seed them today (§9).

**Finding 2c — the repo's one real company-policy table has no tenancy key
either.** `src/uc02/policyCaps.js` exports a single global `POLICY_CAPS` object —
eight category caps, honestly labelled `[PROPOSED]` mock numbers, keyed by
category code alone. [CONFIRMED — repo] Correct for a one-tenant demo.
Structurally wrong the moment there are two.

**Finding 2d — Remote's own API already gets this right, and we are not using
it.** `GET /v1/custom-fields` returns *"A custom field definition that can be
applied to employments **within a company**"* [CONFIRMED — schema, fetched
2026-08-19], with per-employment values at
`GET /v1/employments/{id}/custom-fields`. Company-scoped by construction. This is
the correct carrier for exactly the customer-policy switch UC-04 currently
invents (`employment.custom_fields.workation_permission`, a property the real
employment record does not have — `docs/research/CROSS-BORDER-FLOW.md` §7 D-1).

### What this implies for the design

1. **Three stores, not one.** A shared **statutory/Remote corpus** (global, one
   copy, citable, publishable). A shared **fact table set** (global, versioned,
   provenanced). A **per-tenant policy store** (keyed by `company_id`, deletable
   on customer exit, never embedded into anything shared).
2. **Tenant policy is a table, essentially always.** "Meals cap is $300",
   "workations over 21 days need VP sign-off", "only a company admin may request
   an amendment" — every one passes Test A with a single right answer whose
   authority is the customer themselves. There is very little customer policy
   that is genuinely *reasoning*, which means the retrieval store barely needs a
   tenancy story: **it needs a rule that tenant data never enters it.**
3. **Prefer Remote's own per-tenant carriers over a store of our own.** Custom
   fields (L3-02), leave policies (L3-04), legal entities (L3-06) and payroll
   calendars (L2-05) are already per-company, already authoritative, already
   live. Every one of those we read is a table we do not have to maintain, and a
   confidentiality obligation we do not have to take on.
4. **Distinguish the tenant-configurable ceiling from the product-fixed floor.**
   UC-09's `Math.max(2, ...)` four-eyes floor is *not* customer configuration
   and must never become it — a customer must not be able to switch dual control
   off. Customers may raise a threshold; they may not lower a control.
   [CONFIRMED — repo, `src/uc09/policyEngine.js`]
5. **Tenant policy must be attributable in output.** When a dossier says "over
   the cap", it must say *whose* cap and *as of when*. A shared corpus citation
   and a tenant policy citation must not render identically, or the reader
   cannot tell law from customer preference.

---

## 3. Summary table

Scan this; the detail is in §§4–6. **Sort**: `TABLE` = versioned deterministic
table with provenance · `CORPUS` = retrieval, human-read only · `OUT` = must not
be in the product. **Tier**: 0 = defensible portfolio minimum, 1 = small team,
2 = real content operation only (§10).

### Layer 1 — Country / statutory

| # | Source | Authority | Sort | UCs | Licence | Tier |
|---|---|---|---|---|---|---|
| L1-01 | OECD Model Tax Convention + Commentaries | OECD | CORPUS | 04 07 08 | ⚠ **Restricted — paraphrase only** | 0 (paraphrase) |
| L1-02 | Bilateral double-tax treaties (existence, in-force date, articles) | Contracting states | TABLE (existence) + CORPUS (text) | 04 07 08 | Mostly primary law — OK | 2 |
| L1-03 | US social-security totalization agreements | SSA | TABLE | 04 07 08 | US federal — public domain | 0 |
| L1-04 | EU Reg. 883/2004 + 987/2009, A1 certificate | EU / EUR-Lex | TABLE (membership) + CORPUS (which article) | 04 07 08 | EUR-Lex reuse (2011/833/EU) — OK | 1 |
| L1-05 | Schengen Borders Code 90/180 + area membership | EU Commission | TABLE | 03 04 07 | EU primary law — OK | 0 |
| L1-06 | Reg. (EU) 2018/1806 visa-requirement annexes | EU | TABLE — **currently absent** | 03 04 07 | EU primary law — OK | 0 |
| L1-07 | National immigration rules (work authorisation, DNV terms) | National authorities | TABLE (binary + thresholds) + CORPUS (visitor-activity boundaries) | 03 04 07 | ⚠ Varies per country — check each | 2 |
| L1-08 | UK Statutory Residence Test (FA 2013 Sch. 45) + HMRC RDR3 | HMRC | **CORPUS** — the worked example | 04 07 08 | Crown copyright, OGL v3.0 — OK | 1 |
| L1-09 | National statutory notice-period law, 9 countries | National legislatures | TABLE — **exists, unprovenanced** | 05 07 | Primary law; ⚠ check DE, IN | 0 |
| L1-10 | Public holiday calendars | National (served by Remote — L2-03) | TABLE | 05 06 07 | Facts — OK | 0 |
| L1-11 | Permanent establishment / dependent agent, BEPS Action 7 | OECD + national | **CORPUS, and never anything else** | 03 04 07 08 | ⚠ OECD — paraphrase only | 0 (paraphrase) |
| L1-12 | Sanctions lists (OFAC, EU, UK OFSI, UN) | Treasuries / UNSC | **TABLE, highest integrity bar** | 03 04 07 08 09 | Public domain / reusable — OK | 1 |
| L1-13 | ILO NATLEX and national labour portals | ILO | **Neither — a discovery index** | 05 06 07 | ILO terms | — |

### Layer 2 — Remote.com's own policy

| # | Source | Authority | Sort | UCs | Licence | Tier |
|---|---|---|---|---|---|---|
| L2-01 | `developer.remote.com` OpenAPI via `llms.txt` | Remote | TABLE (it *is* the contract) | all | Integrator docs; ⚠ no wholesale republication | 0 |
| L2-02 | `GET /v1/countries` — supported-country registry | Remote | TABLE, live | 03 04 07 08 09 | Remote's data, in-integration | 0 |
| L2-03 | `GET /v1/countries/{code}/holidays/{year}` | Remote | TABLE, live | 05 06 07 | Remote's data, in-integration | 1 |
| L2-04 | `GET /v1/countries/{code}/{form}` — per-country JSON schemas | Remote | **TABLE — the most important entry here** | 06 09 (01) | Remote's data, in-integration | 0 (already used) |
| L2-05 | `GET /v1/payroll-runs` — payroll calendar + cutoff instants | Remote | TABLE, live, per-tenant | 06 09 | Customer data via Remote | 0 (already used) |
| L2-06 | `support.remote.com` help-centre articles | Remote | **CORPUS — highest-value candidate** | 03 04 07 08 | ⚠ Cite-and-link; quote only the acted-on sentence | 0 (small) |
| L2-07 | Remote's internal `approved_by_remote` criteria | Remote, unpublished | **OUT — does not exist to us** | 03 04 07 08 | n/a | — |

### Layer 3 — Company / customer policy (**per-tenant, never shared**)

| # | Source | Authority | Sort | UCs | Licence | Tier |
|---|---|---|---|---|---|---|
| L3-01 | Expense policy: category caps, currency, receipt rules | The customer | TABLE, **per tenant** | 02 07 | 🔒 Customer confidential | 0 (reshape) |
| L3-02 | Travel / workation policy, approval routing | The customer (via `/v1/custom-fields`) | TABLE, **per tenant** | 03 04 | 🔒 Customer confidential | 1 |
| L3-03 | Amendment / payment authority matrix (roles) | The customer | TABLE, **per tenant** (floor stays product-fixed) | 06 09 | 🔒 Customer confidential | 1 |
| L3-04 | Leave / PTO policy and balances | The customer (via `/v1/leave-policies/*`) | TABLE, live, **per tenant** | 05 07 | 🔒 Customer confidential | 1 |
| L3-05 | Individual employment contract terms | The customer | **Neither — a per-employment document** | 05 06 07 | 🔒 Customer confidential | 1 |
| L3-06 | Legal-entity footprint (`/v1/companies/{id}/legal-entities`) | The customer (via Remote) | TABLE, live, **per tenant** | 04 07 08 | 🔒 Customer confidential | 1 |

### Out of scope — named so the boundary is explicit

| # | Item | Why it is excluded |
|---|---|---|
| X-01 | Individual tax advice ("will I be taxed?") | Regulated activity. UC-08 has no execution path by construction; the disclaimer says so. |
| X-02 | Immigration legal advice ("will my visa be approved?") | Regulated in most jurisdictions. |
| X-03 | Commercial databases (IBFD, Bloomberg Tax, Vialto, Big-4 country guides) | **Licensing.** These are what a real operation buys; their terms almost universally forbid redistribution and machine ingestion. Do not embed. Do not scrape. |
| X-04 | Remote's internal compliance determination criteria | Not published — `[SILENT]`. Escalate and name the decider; never predict Remote's verdict. |
| X-05 | Case law (US B-1 determinations, UK residence cases) | Reasoning a lawyer applies. A case retrieved by similarity would carry the most unearned authority of anything in this document. |
| X-06 | A named individual's history beyond the employment record | Data protection, not knowledge. |

---

## 4. Layer 1 — Country / statutory

Slow-moving, authoritative, mostly publishable as primary law. This is where the
"183 days here, 90 there" problem actually lives.

---

### L1-01 · OECD Model Tax Convention on Income and on Capital, and its Commentaries

- **Publisher / authority.** OECD.
- **URL.** <https://www.oecd.org/en/topics/policy-issues/tax-treaties.html>
- **What it answers.** Article 4's residence tie-breaker ladder (permanent home
  → centre of vital interests → habitual abode → nationality → mutual
  agreement); Article 5's permanent-establishment and dependent-agent
  definitions; Article 15's employment-income conditions, of which the 183-day
  presence test is one of three conjunctive limbs.
- **Used by.** UC-04, UC-07, UC-08.
- **Sort: CORPUS.** Test A: two competent specialists routinely disagree about
  where someone's centre of vital interests is — that is what the tie-breaker
  *ladder* is for. **But note the split carefully: the number 183 is a table
  entry; the test it sits inside is corpus.** Article 15 grants residence-state
  taxing rights only if *all three* of (≤183 days, employer not resident there,
  remuneration not borne by a PE there) hold. A system that reads "183" from a
  table and reports "under the threshold, no exposure" has answered one third of
  the question and hidden the other two. The three current `TREATY_CORPUS`
  entries are already written as the *conditions*, not the number
  [CONFIRMED — repo].
- **Cadence & staleness.** Model updated roughly every 3–5 years (2010, 2014,
  2017…); Commentaries more often. Version-stamp the edition on every passage;
  watch the OECD Model Tax Convention page. There is no machine feed.
- **Licensing. ⚠ RESTRICTED.** The full Model and Commentaries are copyrighted
  and sold as a publication. Short attributed quotation may fall within fair
  dealing; **bulk embedding of Commentary text is not safe to assume.**
  `[INFERRED]` — confirm with counsel before any ingestion. **The current repo
  posture is correct and should be kept: the three corpus entries are our own
  paraphrase of the principle, not OECD text.** Paraphrase also happens to be
  the better retrieval unit, because it is written in the vocabulary a support
  ticket uses.
- **Evidence tag.** `[CONFIRMED — repo]` for what the corpus currently contains;
  `[PROPOSED]` for the source binding; `[INFERRED]` for the licensing
  conclusion.
- **Retrieval, 2026-08-19. ⛔ NOT RETRIEVED — `www.oecd.org` refused by egress
  policy** (`curl` → `CONNECT tunnel failed, response 403`). **Immaterial to the
  handling**: paraphrase-only is a *licence* constraint, not an access one, and
  would hold unchanged if the site were reachable tomorrow. A citation register
  (article numbers, editions, what each governs, and the MLI wrinkle) is at
  `docs/knowledge/layer-1-statutory/L1-01-L1-11-oecd-citation-register.md`.
  **No OECD text is in this repository, now or ever.**

---

### L1-02 · Bilateral double-taxation treaties — the actual texts

- **Publisher / authority.** The two contracting states. Practical access:
  HMRC's collection <https://www.gov.uk/government/collections/tax-treaties>;
  IRS <https://www.irs.gov/businesses/international-businesses/united-states-income-tax-treaties-a-to-z>;
  each other state's ministry of finance.
- **What it answers.** Does a treaty exist between A and B; when did it enter
  into force; what does its Article 15 equivalent actually say; has the MLI
  modified it.
- **Used by.** UC-04, UC-07, UC-08.
- **Sort: SPLIT.**
  - **TABLE** — *existence, in-force date, article numbering, MLI-modified
    flag.* Test A: a binary with a named authority and a date. Test B: being
    wrong is silent and catastrophic — "a treaty covers you" when none exists
    produces a confident answer nothing contradicts. This is what UC-04's
    `NON_TREATY_PAIRS` is today: **seven hard-coded pair keys, no citation, no
    version, no retrieved-on date** [CONFIRMED — repo,
    `src/uc04/riskMatrix.js`]. The surrounding code is honest about the
    default (*"anything not in the set is treated as treaty unknown (medium) —
    honest, never a fabricated 'covered'"*), which is the right fail direction;
    the table itself is the unprovenanced part.
  - **CORPUS** — *what the article means for this fact pattern.*
  - **OUT** — *the determination itself.*
- **Cadence & staleness.** Several new or amended treaties per year globally.
  **The instructive wrinkle: the BEPS Multilateral Instrument modifies many
  existing treaties without changing their published text** — so a treaty's
  effect can change while every source document you monitor stays byte-identical.
  That is the cleanest argument in this catalogue for why a table needs a
  *version* and not just a *hash*. Detection: each state publishes an in-force
  list with dates; diff the list, not the text.
- **Licensing.** Government-published treaty texts are generally reproducible —
  UK Crown copyright under OGL, US federal public domain. Individual partner
  states vary; check before republishing a specific text.
- **Evidence tag.** `[CONFIRMED — repo]` for the current seven-pair table;
  `[PROPOSED]` for the sources.
- **Retrieval, 2026-08-19. ⛔ NOT RETRIEVED** — `www.irs.gov` and `www.gov.uk`
  both refused by egress policy (403 at proxy `CONNECT`). The seven-pair
  `NON_TREATY_PAIRS` table therefore stays uncited. Record:
  `docs/knowledge/layer-1-statutory/RETRIEVAL-BLOCKED.md`.
- **Second pass, 2026-08-19. ✅ PARTIALLY RETRIEVED — five bilateral treaties.**
  `www.irs.gov` is now reachable: the US–Netherlands, US–Portugal and US–Canada
  conventions were retrieved as PDFs and **committed in full** (public domain) at
  `docs/knowledge/layer-1-statutory/sources/D-27…D-29`. The Netherlands–Portugal
  convention (Verdragenbank/wetten.overheid.nl) and the Canada–Netherlands
  convention (Finance Canada) were retrieved and are **cite-and-quote only**.
  Canada–Portugal was not: Finance Canada points at `treaty-accord.gc.ca`, which
  is egress-refused. **The finding is that the five treaties use five different
  183-day windows and the day count is one of three cumulative conditions** —
  `CONTRADICTIONS.md` C-10 and C-11.

---

### L1-03 · US social-security totalization agreements

- **Publisher / authority.** US Social Security Administration.
- **URL.** <https://www.ssa.gov/international/agreements_overview.html>
- **What it answers.** Does the US have a totalization agreement with country X;
  what the certificate-of-coverage procedure is; the detached-worker duration
  limit.
- **Used by.** UC-04, UC-07, UC-08.
- **Sort: TABLE.** A closed enumerated list of about thirty countries with
  effective dates. Test A passes cleanly. It already drives real decisions:
  `00-FOUNDATION.md` §4 invariant 9 picks India, Philippines and Mexico
  precisely as the *"no coverage, treat conservatively"* cases and Canada as the
  contrast case [CONFIRMED — repo].
- **Cadence & staleness.** Rare — a handful of new agreements per decade. The
  SSA publishes the country list on one page; hash it monthly. A very low-cost
  monitor.
- **Licensing.** US federal government work — **public domain.** Free to
  reproduce, including the list itself.
- **Evidence tag.** `[PROPOSED]`. `docs/use-cases/UC-04.md` §3 already names
  ssa.gov as the intended build-time source for exactly this table, marked
  `[PROPOSED — build-time task]` [CONFIRMED — repo].
- **Retrieval, 2026-08-19. ⛔ NOT RETRIEVED — `www.ssa.gov` refused by egress
  policy**, both by `curl` (403 at proxy `CONNECT`) and by `WebFetch`
  (`EGRESS_BLOCKED`). **This is the most valuable unfetched item in the
  catalogue and the top of the work order**: public domain, one page, ~30 rows
  with effective dates, and it closes `UC-04.md` §3's own build-time task. A
  search-index summary of the page was available and was **deliberately not used
  as a source** — a country list assembled from search snippets is exactly the
  plausible-wrong-table this document exists to refuse. Record:
  `docs/knowledge/layer-1-statutory/RETRIEVAL-BLOCKED.md`.
- **Second pass, 2026-08-19. ✅ RETRIEVED.** `www.ssa.gov` answers **200** to a
  complete browser header set (it answers 403 to a bare `curl` and to a
  UA-only `curl` — see `RETRIEVAL-BLOCKED.md` §2). The status table and the
  agreements overview are committed at
  `docs/knowledge/layer-1-statutory/sources/D-20-*`. **US↔NL, US↔PT and US↔CA
  are all in force**, with signing dates, effective dates and TIAS citations;
  the detached-worker limit is **5 years**. Canada's separate network was
  retrieved too (CRA, D-21) and gives a **per-pair** maximum: 60 months for the
  Netherlands, 24 for Portugal. `UC-04.md` §3's `[PROPOSED — build-time task]`
  is closed.

---

### L1-04 · EU Regulations (EC) 883/2004 and 987/2009 — social-security coordination, and the A1

- **Publisher / authority.** European Union; EUR-Lex; the Administrative
  Commission for the Coordination of Social Security Systems.
- **URL.** <https://eur-lex.europa.eu/eli/reg/2004/883/oj> and
  <https://eur-lex.europa.eu/eli/reg/2009/987/oj>
- **What it answers.** Which member state's social-security legislation applies
  to a posted or multi-state worker; when an A1 portable document is the right
  instrument; the 24-month posting limit; how a "substantial activity" is
  assessed.
- **Used by.** UC-04, UC-07, UC-08.
- **Sort: SPLIT.**
  - **TABLE** — *membership of the coordination area.* This is
    `EU_EEA_FOR_A1` today: 31 codes, with an honest comment that Switzerland and
    the UK are covered by separate agreements rather than by the regulation's A1
    path [CONFIRMED — repo]. Test A: enumerable membership.
  - **CORPUS** — *which article governs this pattern.* Article 12 (posting) and
    Article 13 (pursuing activity in two or more states) lead to different
    answers, and the choice turns on a substantial-activity assessment that is
    explicitly facts-and-circumstances. Two specialists can and do disagree.
- **Cadence & staleness.** The regulations themselves are stable (2004/2009).
  What moves: membership, the UK's post-Brexit position under the TCA Protocol
  on Social Security Coordination, and the Administrative Commission's Decisions
  and *Practical Guide*. Detection: EUR-Lex consolidated texts carry a version
  date — poll it.
- **Licensing.** EUR-Lex content is reusable under Commission Decision
  2011/833/EU with attribution. **Safe to reproduce.** One of the cleanest
  licences here, which is a genuine argument for preferring EU-sourced framing
  where two sources say the same thing.
- **Evidence tag.** `[CONFIRMED — repo]` for the existing set; `[PROPOSED]` for
  the source binding.
- **Retrieval, 2026-08-19. ⛔ NOT RETRIEVED — `eur-lex.europa.eu` refused by
  egress policy**, both by `curl` and by `WebFetch`. The licence (EUR-Lex reuse
  under Commission Decision 2011/833/EU) would have permitted vendoring in full;
  access, not licence, is what blocked it. Record:
  `docs/knowledge/layer-1-statutory/RETRIEVAL-BLOCKED.md`.
- **Second pass, 2026-08-19. ✅ RETRIEVED.** `eur-lex.europa.eu` is now
  reachable. Both consolidated texts are committed at
  `docs/knowledge/layer-1-statutory/sources/D-17-*` and `D-18-*`. The A1's legal
  basis is **art. 19(2) of 987/2009** — an *attestation*, never called "A1" in
  either regulation. Art. 12(1) carries a **24-month** posting limit and a
  not-a-replacement condition; art. 14(8) of the implementing regulation names
  **25 %** as an *indicator inside an overall assessment*, which is exactly why
  this entry's **SPLIT** sorting was right and why 25 % must not become a
  threshold.

---

### L1-05 · Schengen Borders Code — the 90/180 short-stay rule and area membership

- **Publisher / authority.** European Commission / DG HOME. Regulation (EU)
  2016/399.
- **URL.** <https://eur-lex.europa.eu/eli/reg/2016/399/oj>; the Commission's own
  short-stay calculator at
  <https://ec.europa.eu/assets/home/visa-calculator/calculator.htm>
- **What it answers.** The 90-days-in-any-rolling-180 arithmetic; which states
  are in the area; and — the part most often lost — that the rule governs
  **presence**, not the right to **work**.
- **Used by.** UC-03, UC-04, UC-07.
- **Sort: TABLE.** Both the numbers and the membership set are enumerable facts
  behind a legal instrument, and a gate reads them directly:
  `schengen_90_180_exceeded` is a hard block in `riskMatrix.js`, computed over a
  trailing 180-day window anchored on the trip start [CONFIRMED — repo].
- **Cadence & staleness.** Membership changes occasionally and recently —
  Croatia 2023, Bulgaria and Romania in stages 2024–25. The repo's `SCHENGEN`
  set already includes BG, HR and RO; **it needs a dated source line saying as
  of when.** Recheck quarterly against the Commission's member list.
- **Licensing.** EU primary law, EUR-Lex reuse terms — **OK to reproduce.**
- **Gap this source exposes.** The gate conflates *"is in the Schengen area"*
  with *"this nationality may enter visa-free"*, which is nationality-dependent
  and not encoded anywhere. Today the substitute is the requester's
  self-declared `visaType`. A claimed `schengen_short_stay` from a nationality
  that needs a visa passes as low risk. The missing table is L1-06.
- **Evidence tag.** `[CONFIRMED — repo]` for the set and the gate; `[PROPOSED]`
  for the source binding; the gap is `[CONFIRMED — repo]` by reading the
  branch condition.
- **Retrieval, 2026-08-19. ⛔ NOT RETRIEVED** — `eur-lex.europa.eu`,
  `ec.europa.eu` and `home-affairs.ec.europa.eu` all refused by egress policy.
  The `SCHENGEN` set still has no dated source line. Record:
  `docs/knowledge/layer-1-statutory/RETRIEVAL-BLOCKED.md`.
- **Second pass, 2026-08-19. ✅ RETRIEVED.** Regulation (EU) 2016/399,
  consolidation **2025-10-12**, retrieved from EUR-Lex; Article 6 quoted in full
  at `docs/knowledge/layer-1-statutory/D-07-*`. The dated source line this entry
  asked for now exists: the two Council decisions (**2024/210** air/sea from
  2024-03-31, **2024/3212** land from 2025-01-01) are committed, and their
  Article 1 enumeration **confirms the repository's 29-code set is correct**.
  The contradiction is in the arithmetic, not the numbers: the 180-day window is
  evaluated **per day of stay**, not once per trip — `CONTRADICTIONS.md` C-1.

---

### L1-06 · Regulation (EU) 2018/1806 — visa-requirement and visa-exemption annexes

- **Publisher / authority.** European Union.
- **URL.** <https://eur-lex.europa.eu/eli/reg/2018/1806/oj>
- **What it answers.** Which third-country nationalities require a Schengen
  visa (Annex I) and which are exempt for short stays (Annex II).
- **Used by.** UC-03, UC-04, UC-07.
- **Sort: TABLE.** Two literal annexes — enumerated lists in a legal instrument.
  Test A could not pass more cleanly.
- **Status: ABSENT from the repo.** This is a named gap, not an oversight to
  discover later. Without it, the 90/180 gate applies a visa-free allowance to
  nationalities that may not have one, on the strength of a self-declared field.
- **Cadence & staleness.** Amended a few times per decade (visa liberalisation
  and suspension decisions). Poll the consolidated text's version date.
- **Licensing.** EU primary law — **OK to reproduce, including the annexes.**
- **Evidence tag.** `[PROPOSED]`.
- **Retrieval, 2026-08-19. ⛔ NOT RETRIEVED — `eur-lex.europa.eu` refused by
  egress policy**, both tools. **Second on the work order after L1-03**: two
  literal enumerated annexes, freely reproducible, closing a gap the catalogue
  names as absent rather than merely thin. Still absent. Record:
  `docs/knowledge/layer-1-statutory/RETRIEVAL-BLOCKED.md`.
- **Second pass, 2026-08-19. ✅ RETRIEVED — the named absent gap is closed.**
  Regulation (EU) 2018/1806, consolidation **2025-12-30**, **committed in full
  with both annexes** at
  `docs/knowledge/layer-1-statutory/sources/D-09-eu-visa-annexes-2018-1806.html`.
  Canada and the United States are both **Annex II**. And the text supplies
  something this entry did not anticipate: **art. 6(3)** lets a Member State
  except from the exemption *"persons carrying out a paid activity during their
  stay"* — so Annex II membership is necessary and **not sufficient** for a
  workation, and no EU-level table settles it. `CONTRADICTIONS.md` C-4.

---

### L1-07 · National immigration authorities — work authorisation and digital-nomad schemes

- **Publisher / authority.** Per destination. UK Home Office (Immigration
  Rules); US CBP / USCIS (B-1 permitted activities, ESTA conditions); Canada
  IRCC (business-visitor rules); Portugal AIMA (D8); Estonia PPA (DNV); Romania
  IGI (DNV); and 80-plus others.
- **URL.** Per country — e.g.
  <https://www.gov.uk/guidance/immigration-rules>,
  <https://www.cbp.gov/travel/international-visitors/visa-waiver-program>,
  <https://www.canada.ca/en/immigration-refugees-citizenship.html>.
- **What it answers.** May a person *work* on this status. What a digital-nomad
  visa requires (income floor, insurance, maximum duration). Where the
  business-visitor boundary sits.
- **Used by.** UC-03, UC-04, UC-07.
- **Sort: SPLIT.**
  - **TABLE** — *the binary "does this status permit remote work for a foreign
    employer", and DNV income/duration thresholds.* Test B is decisive: these
    feed three existing hard blocks —
    `visitor_visa_active_work_forbidden`, `us_requires_work_permit`,
    `ca_requires_work_permit` [CONFIRMED — repo]. A wrong binary here authorises
    illegal work and nothing downstream notices.
  - **CORPUS** — *the business-visitor activity boundary.* "Attending meetings"
    versus "performing productive work" is the canonical
    cannot-be-reduced-to-a-lookup question, and it is precisely where
    `docs/research/CROSS-BORDER-FLOW.md` §7 D-3 found our own classifier
    treating contract negotiation as passive.
- **Cadence & staleness. This is the fastest-moving layer in the catalogue —
  months, not years.** DNV schemes appear, change income thresholds annually,
  and are occasionally suspended. **There is no useful machine monitor across 90
  countries.** The honest control is a named owner per country and a review
  date, with an alert when the review date passes — which is a staffing answer,
  not an engineering one, and is why this entry is Tier 2.
- **Licensing. ⚠ Varies, materially.** UK gov.uk is OGL v3.0 (clean). US federal
  is public domain (clean). Many national portals carry restrictive terms or no
  stated terms at all. **Check per country; do not assume.**
- **Note on the current `DNV_COUNTRIES` set.** Five codes (EE, PT, RO, CR, MX),
  no citation, no thresholds, and it *suppresses* the Schengen check for those
  destinations [CONFIRMED — repo]. A suppression driven by an uncited list is
  Test B's failure mode with the sign flipped.
- **Evidence tag.** `[CONFIRMED — repo]` for the three hard blocks and the DNV
  set; `[PROPOSED]` for every source binding.
- **Retrieval, 2026-08-19. ⛔ NOT RETRIEVED** — `www.gov.uk`, `www.cbp.gov`,
  `www.uscis.gov` and `www.canada.ca` all refused by egress policy. Unchanged
  as a Tier-2 entry regardless: the constraint here was never retrieval but the
  standing per-country review obligation, which is a staffing answer. Record:
  `docs/knowledge/layer-1-statutory/RETRIEVAL-BLOCKED.md`.
- **Second pass, 2026-08-19. ◐ MIXED, and the split is instructive.**
  **Retrieved:** Portugal's consular D8 conditions from `vistos.mne.gov.pt`
  (income ≥ **4 × RMMG** averaged over three months — *not* the IAS this
  catalogue's manifest predicted — and **two distinct instruments**, a temporary
  stay visa and a residency visa); and Canada's **IRPR ss. 186/187**, whose
  s. 187(3) is a real two-limb test the code never applies.
  **Not retrieved:** `www.cbp.gov`, `www.uscis.gov` and `travel.state.gov` all
  refuse this address wholesale (Akamai/Cloudflare, not our proxy), so the US
  visitor-vs-work boundary — *"the matrix's most-cited blocked rule"* — is still
  sourced only by a code comment. Portugal's Lei 23/2007 is unread because DRE
  is a JavaScript application, though its identifiers are now confirmed from the
  ministry's own link list. This entry's **per-country, do-not-assume** warning
  about reuse terms held up exactly as written.

---

### L1-08 · UK Statutory Residence Test — Finance Act 2013 Schedule 45, and HMRC RDR3

- **Publisher / authority.** HM Revenue & Customs; UK Parliament.
- **URL.** <https://www.gov.uk/government/publications/rdr3-statutory-residence-test-srt>
  and <https://www.legislation.gov.uk/ukpga/2013/29/schedule/45>
- **What it answers.** Whether an individual is UK tax-resident for a tax year.
- **Sort: CORPUS — and this is the catalogue's reference example for the corpus
  side.** The test runs automatic overseas tests, then automatic UK tests, then
  a sufficient-ties test whose day threshold depends on how many of five ties
  apply — and each tie (family, accommodation, work, 90-day, country) is itself
  a facts question. `docs/use-cases/UC-04.md` §12 item 1 already names it:
  *"UK destination, no single threshold applies → routes to escalation
  (ties-based test can't be reduced to a lookup)"* [CONFIRMED — repo].
  `00-FOUNDATION.md` §4 invariant 9 chose the UK into the nine-country scope for
  exactly this property — *"proves the system escalates instead of guessing a
  number that doesn't exist"* [CONFIRMED — repo].
  **The trap, restated:** there *is* a ties-against-days grid, and encoding it
  would look like diligence. It is only reachable after two prior test batteries
  have both failed. Table-ifying it is the single most tempting Test-B failure
  available in this domain.
- **Used by.** UC-04, UC-07, UC-08.
- **Cadence & staleness.** Schedule 45 stable since 2013; RDR3 guidance updated
  roughly annually. gov.uk publishes a "last updated" date per page — poll it.
  A genuinely good staleness signal, and rare.
- **Licensing.** Crown copyright under the **Open Government Licence v3.0** —
  reproducible with attribution, including verbatim. **The cleanest licence in
  this catalogue**, which makes the UK a good first country for any corpus that
  wants real quoted text rather than paraphrase.
- **Evidence tag.** `[PROPOSED]` as a source; `[CONFIRMED — repo]` that the
  system already escalates rather than guessing here.
- **Retrieval, 2026-08-19. ⛔ NOT RETRIEVED** — `www.legislation.gov.uk` and
  `www.gov.uk` both refused by egress policy. **Third on the work order.** The
  loss here is the sharpest of the five: OGL v3.0 permits verbatim reproduction
  with attribution, so this is the one Layer-1 source that could have supplied
  *real quoted text* rather than paraphrase — which is exactly why the catalogue
  names the UK the right first country for a corpus. Record:
  `docs/knowledge/layer-1-statutory/RETRIEVAL-BLOCKED.md`.
- **Second pass, 2026-08-19. ⛔ STILL NOT RETRIEVED — and out of scope now.**
  `www.legislation.gov.uk` and `www.gov.uk` are not on the opened allowlist, and
  the second pass was scoped to the **NL/PT/CA/US** four-country manifest, in
  which the UK does not appear. The catalogue's judgement that the UK SRT is the
  reference example of a corpus entry that must **not** be table-ified is
  independently reinforced by what *was* retrieved: Canada's CRA folio S5-F1-C1
  (D-34) is the same shape and the same trap, and its ¶1.14 says so in the
  authority's own words.

---

### L1-09 · National statutory notice periods — the nine in-scope countries

- **Publisher / authority.** Each national legislature, via its official gazette:
  UK Employment Rights Act 1996 s.86 (legislation.gov.uk) · Ireland Minimum
  Notice and Terms of Employment Act 1973 s.4 (irishstatutebook.ie) · Germany
  BGB §622 (gesetze-im-internet.de) · Poland Kodeks pracy art. 36
  (isap.sejm.gov.pl) · India Industrial Employment (Standing Orders) Act plus
  state Shops & Establishments Acts · Philippines Labor Code (Official Gazette /
  DOLE) · Mexico Ley Federal del Trabajo art. 161 (diputados.gob.mx) · Canada —
  provincial employment standards **plus** common law, with no employee-side
  statutory minimum · Portugal Código do Trabalho art. 400 (dre.pt).
- **What it answers.** How many days' notice the **employee** owes the employer,
  by country and tenure bracket, and what anchor rule applies (Germany's
  15th/end-of-month; Poland's 1st-of-month for monthly notices).
- **Used by.** UC-05, UC-07.
- **Sort: TABLE — and it already is one, correctly.**
  `src/uc05/noticePeriodTable.js` is the pattern this whole document is arguing
  for: nine countries, tenure brackets, probation rules, anchor rules, a
  `basis` field that honestly marks Canada as `"customary"` rather than
  `"statutory"`, and a `sourceCitation` string per row [CONFIRMED — repo].
  **What it lacks is a URL, a retrieved-on date and a version per row**, so
  nobody can check a figure or tell when it went stale.
  Its header is worth preserving verbatim as the model of honest labelling:
  > *"EVERY FIGURE HERE IS A SIMPLIFICATION OF PUBLIC STATUTORY PROVISIONS.
  > Nothing in this file has been verified by a labour lawyer, and the numbers
  > should not be quoted to a customer."*
- **Cadence & staleness.** Labour codes change every few years per country, and
  sometimes abruptly — the Philippines renumbered its Labor Code articles;
  Poland amended in 2023. Detection: consolidated-text version dates on each
  national gazette, per row.
- **Licensing.** Primary legislation, reproducible in most of these
  jurisdictions. **⚠ Two to check before reproducing text: Germany's
  gesetze-im-internet carries its own reuse terms, and India's position varies
  by state portal.** The current table paraphrases rather than quotes, which
  sidesteps the question — keep it that way unless someone confirms otherwise.
- **The scope entry itself.** *"We cover nine of ninety-plus countries"* is a
  **catalogue entry, not a solved problem.** Everything outside the nine returns
  `unsupported_country` and escalates, which is the correct behaviour and is
  documented as such — but it means UC-05 answers roughly a tenth of the real
  question space, and the catalogue should say so in those words.
- **Evidence tag.** `[CONFIRMED — repo]` for the table and its own caveat;
  `[PROPOSED]` for each source URL binding.
- **Retrieval, 2026-08-19. ⛔ NOT RETRIEVED — none of the six national gazettes
  reachable.** `www.legislation.gov.uk`, `www.irishstatutebook.ie`,
  `www.gesetze-im-internet.de`, `isap.sejm.gov.pl`, `www.dre.pt` and
  `www.diputados.gob.mx` were each attempted and each refused by egress policy.
  So `noticePeriodTable.js` still has `sourceCitation` without `sourceUrl` or
  `retrievedOn` — Tier 0 item 1 remains open for this table. Record:
  `docs/knowledge/layer-1-statutory/RETRIEVAL-BLOCKED.md`.
- **Second pass, 2026-08-19. ◐ MIXED, three of the four demo countries.**
  **Retrieved:** BW Boek 7 art. 672 (NL), Canada Labour Code s. 230, and DOL's
  WARN pages (US). **Not retrieved:** both Portuguese Código do Trabalho
  articles (DRE is JavaScript-only) and Ontario's ESA 2000 (e-Laws likewise) —
  so `NOTICE_PERIOD_TABLE.PT`, the row whose numbers are actually computed,
  is **still unverified**. The catalogue's instruction to keep this table a
  paraphrase rather than a quotation stands. Two findings:
  NL's **employee** notice is a flat one month while the tenure ladder in the
  same article is the **employer's** (C-14), and the CA/US rows both rest on a
  **negative** that WARN and CLC s. 230 can support only by argument from scope
  (C-13).

---

### L1-10 · Public holiday calendars

- **Publisher / authority.** National, but **available live from Remote** —
  see L2-03. Prefer Remote's carrier; it removes the maintenance obligation
  entirely.
- **What it answers.** Which days are non-working, per country per year, with
  `observed_day` handling for holidays that shift.
- **Used by.** UC-05 (notice end dates and anchor rules), UC-06 (payroll cutoff
  arithmetic), UC-07 (minimum-onboarding-time business-day lead times).
- **Sort: TABLE.** Test A: an enumerated list with a publisher. Test B: a
  business-day count that silently includes a public holiday produces a date
  that is simply wrong and looks right.
- **Cadence & staleness.** Annual, plus occasional one-offs (state funerals,
  referenda). **Fetch per country per year; never cache across a year
  boundary** — the failure mode is an empty or short list that reads as "no
  holidays", not as an error. This is the same shape as the payroll-calendar
  staleness in L2-05.
- **Licensing.** Dates are facts. Served under Remote's API terms in-integration.
- **Evidence tag.** `[CONFIRMED — schema, fetched 2026-08-19]`:
  `GET /v1/countries/{country_code}/holidays/{year}`, `Holiday` schema with
  `day`, `name`, `note`, `observed_day`, optionally filterable by country
  subdivision.
- **Retrieval, 2026-08-19. ✅ RETRIEVED AND VENDORED** (via the L2-03 carrier —
  HTTP 200, 22,378 bytes, SHA-256 `eeb682ea…`), at
  `docs/knowledge/layer-2-remote/L2-03-public-holidays.md`. **The one Layer-1
  need this pass actually closes**, and it closes it by preferring the carrier
  over the authority — which is the catalogue's own recommendation working.
  Confirmed there: `observed_day` is **nullable**, so the correct read is
  `observed_day ?? day`.

---

### L1-11 · Permanent establishment and dependent-agent analysis; BEPS Action 7

- **Publisher / authority.** OECD (Model Art. 5 and Commentary, BEPS Action 7
  final report) plus national tax-authority guidance.
- **URL.** <https://www.oecd.org/en/topics/sub-issues/beps.html>
- **What it answers.** When an employee's presence or authority creates a
  taxable corporate presence for the employer or the client.
- **Used by.** UC-04, UC-07, UC-08; implicitly UC-03.
- **Sort: CORPUS, and it may never be anything else.** There is no threshold to
  encode. Test A fails at the first question: PE determination is exactly what
  competent specialists are paid to disagree about.
  **The repo already gets this right, in both places.** UC-07's corpus entry
  says *"flag PE_REVIEW_REQUIRED rather than concluding whether a PE exists —
  that is a professional tax determination"* [CONFIRMED — repo]. UC-04's matrix
  raises `pe_risk_dape` as a **flag that escalates**, never as a verdict
  [CONFIRMED — repo]. Preserve both.
  Note also that Remote itself collects `will_negotiate_or_sign_contracts` on
  the work-authorization object — the classic dependent-agent test — and
  **does not publish what it does with it** (`CROSS-BORDER-FLOW` §6,
  `[SILENT]`). We infer PE assessment; Remote has not said so.
- **Cadence & staleness.** Slow. BEPS Action 7 dates to 2015; the Art. 5
  Commentary rewrite to 2017. National guidance moves faster than the model.
- **Licensing. ⚠ OECD — same restriction as L1-01. Paraphrase; do not embed
  Commentary text.**
- **Evidence tag.** `[CONFIRMED — repo]` for the current handling;
  `[INFERRED]` for the licensing conclusion.
- **Retrieval, 2026-08-19. ⛔ NOT RETRIEVED — `www.oecd.org` refused by egress
  policy.** As with L1-01, **immaterial**: paraphrase-only is the licence
  posture whether or not the site is reachable. Citation register at
  `docs/knowledge/layer-1-statutory/L1-01-L1-11-oecd-citation-register.md`.

---

### L1-12 · Sanctions and restricted-jurisdiction lists

- **Publisher / authority.** US Treasury OFAC (SDN and programme lists); the EU
  consolidated financial-sanctions list; UK OFSI consolidated list; UN Security
  Council consolidated list.
- **URL.** <https://sanctionslist.ofac.treas.gov/> ·
  <https://www.gov.uk/government/publications/financial-sanctions-consolidated-list-of-targets> ·
  <https://www.un.org/securitycouncil/content/un-sc-consolidated-list>
- **What it answers.** May we transact with, or support work from, this
  jurisdiction or this party at all.
- **Used by.** UC-03, UC-04, UC-07, UC-08, UC-09.
- **Sort: TABLE, at the highest integrity bar in this document.** This is the
  one entry where a stale value is silent **and** legally consequential to the
  company rather than only to the employee. Test B is not close.
- **Current state, honestly.** `SANCTIONED_OR_RESTRICTED` in
  `src/uc03/policyEngine.js` holds ten alpha-2 codes and its own header says
  *"Illustrative demonstration subset — NOT Remote's authoritative compliance
  list, which this portfolio does not have access to (production would source
  this from the compliance team)"* [CONFIRMED — repo]. Two of the ten (AF, IQ)
  were added from Remote's own registry exclusions rather than invented, and
  documented as such — good practice worth keeping.
- **The structural limitation, which no amount of maintenance fixes.** A
  **country** list can never be the control; real sanctions are **entity- and
  person-level**. A country screen is a first pass that catches the obvious
  case. Saying so is the difference between a defensible demo control and a
  claim that would fail an audit.
- **Cadence & staleness. Changes with no notice, any day.** OFAC publishes
  machine-readable SDN files with a timestamp; the EU publishes an XML
  consolidated list. **Daily fetch is the only defensible cadence, and a fetch
  failure must fail the gate closed** — silently serving yesterday's cached list
  is the one fallback this repo's own conventions forbid, and the one most
  likely to be written by accident.
- **Licensing.** US Treasury — public domain. EU — reusable. UK OFSI — OGL. UN —
  reusable with attribution. **All clean.**
- **Evidence tag.** `[CONFIRMED — repo]` for the current list and its caveat;
  `[PROPOSED]` for the source bindings.
- **Retrieval, 2026-08-19. ⛔ NOT RETRIEVED** — `ofac.treasury.gov`,
  `sanctionslistservice.ofac.treas.gov`, `webgate.ec.europa.eu`, `www.gov.uk`
  and `www.un.org` all refused by egress policy. **And vendoring is the wrong
  instinct here even once access exists**: all four licences are clean, which
  makes a checked-in copy tempting — and a checked-in copy is precisely the
  *"helpful cached fallback"* §11 item 6 names as dishonest to ship, sitting in
  `docs/` looking authoritative. The right shape is a scheduled fetch with a
  **fail-closed** gate, not a file. Reasoning recorded at
  `docs/knowledge/layer-1-statutory/RETRIEVAL-BLOCKED.md`.
- **Second pass, 2026-08-19. ✅ ALL THREE READ — AND STILL NOT VENDORED.**
  OFAC, the EU Sanctions Map (via its public JSON API; the HTML root is a
  JavaScript shell) and Global Affairs Canada were all retrieved. **No list bytes
  are committed**, and this entry's own reasoning is why. Two things the reading
  produced. First, OFAC states the structural point in its own words: *"The
  Office of Foreign Assets Control (OFAC) does not maintain a specific list of
  countries that U.S. persons cannot do business with."* Second, and sharper: the
  EU register attaches a regime to **`US`** — the Blocking Statute — so a naive
  projection of it onto a destination blocklist would **block the United
  States**. The repository's ten-code set turns out to be neither a superset nor
  a subset of any of the three regimes. Register:
  `docs/knowledge/layer-1-statutory/D-36-D-37-D-38-sanctions-register.md`;
  finding: `CONTRADICTIONS.md` C-16.

---

### L1-13 · ILO NATLEX and national labour-law portals

- **Publisher / authority.** International Labour Organization.
- **URL.** <https://natlex.ilo.org/>
- **What it answers.** *Where* the primary text for country X lives.
- **Sort: NEITHER — a discovery index, catalogued so nobody mistakes it for an
  authority.** NATLEX records are often behind the current consolidated text.
  Use it to find the gazette; cite the gazette.
- **Evidence tag.** `[PROPOSED]`.
- **Retrieval, 2026-08-19. ⛔ NOT RETRIEVED — `natlex.ilo.org` refused by egress
  policy.** Nothing lost: there was never anything here to vendor. A discovery
  index is a tool for finding an authority, not an authority.

---

## 5. Layer 2 — Remote.com's own policy

Different in kind from Layer 1: this is the platform's own rules and its own
data model, and much of it is **live-queryable**, which means it needs no
curation at all. **A source we can query is worth several we would have to
maintain**, and the strongest single recommendation in this document is to
prefer them wherever they exist.

**Access note, carried forward from the previous research pass and re-verified
today:** `WebFetch` is egress-blocked for `developer.remote.com`; **`curl`
reaches it** (confirmed 2026-08-19 by fetching two reference pages).
`support.remote.com` sits behind a Cloudflare interstitial that **neither** tool
clears, so everything sourced from there is one notch weaker and tagged
accordingly.

---

### L2-01 · `developer.remote.com` — the OpenAPI reference, indexed by `llms.txt`

- **Publisher / authority.** Remote.
- **URL.** <https://developer.remote.com/llms.txt>; each page has a `.md` form
  at `https://developer.remote.com/reference/<page>.md`.
- **What it answers.** Every request and response shape; every status enum;
  every scope; and — decisively — **what has no endpoint at all.**
- **Used by.** All nine.
- **Sort: TABLE.** It *is* the deterministic contract. `docs/REMOTE-API-INDEX.txt`
  is already a checked-in snapshot of it, and `CLAUDE.md` §3 directive 4 already
  makes it mandatory: *"Do not invent request/response shapes."*
- **Cadence & staleness. The best-instrumented source in this catalogue.** Each
  page carries `updatedAt` front-matter — the holidays page read
  `2026-05-27T21:26:44.000Z` today. Diff `llms.txt` for the operation inventory
  plus each page's `updatedAt`. **A change in the operation inventory is exactly
  how the invented `POST /v1/work-authorization-requests` would have been caught
  before it shipped** (`CROSS-BORDER-FLOW` §5). That is not a hypothetical
  benefit; it is a bug this repository actually paid for.
- **Licensing.** Remote's own integrator documentation. Reproducing schema
  *facts* and short quotations inside our own dossiers is within the evident
  purpose; **wholesale republication is not ours to grant — flag if it ever
  comes up.**
- **Evidence tag.** `[CONFIRMED — live, 2026-08-19]`.
- **Retrieval, 2026-08-19. ✅ RETRIEVED AND VENDORED (extract, not mirror)** at
  `docs/knowledge/layer-2-remote/L2-01-api-reference-index.md`. HTTP 200, 475
  lines, SHA-256 `72e7841f…`.
  **The "flag if it ever comes up" above has now come up, and the answer taken
  is no-mirror**: the vendored file records the retrieval, the checksum and a
  diff, not the index. The document stays one `curl` away.
  **And the staleness monitor paid for itself on its first run.** Diffing
  today's `llms.txt` against the checked-in `docs/REMOTE-API-INDEX.txt` found
  **six operations present today and absent from the snapshot** —
  `delete_v1_pay-items_id`, `patch_v1_pay-items_id`,
  `get_v1_contractors_employments_employment_id_rates`,
  `post_v1_sandbox_contractors_employments_employment_id_rates`,
  **`get_v1_direct-offboardings`**, `get_v1_employments_bulk` — plus one silent
  URL move (`/public-page.md` → `/page/public-page.md`). Two matter:
  `get_v1_direct-offboardings` should be checked before UC-05's *"no real write
  endpoint exists"* claim is repeated, and the mutable `pay-items` pair sits
  adjacent to UC-09's money path. **Neither is acted on here** — this is a
  documents pass and `src/` was not touched.

---

### L2-02 · `GET /v1/countries` — Remote's supported-country registry

- **Publisher / authority.** Remote.
- **URL.** <https://developer.remote.com/reference/get_v1_countries.md>
- **What it answers.** Is this a country Remote transacts in; the `eor_onboarding`
  flag; contractor capability; the alpha-2/alpha-3 code pair.
- **Used by.** UC-03, UC-04, UC-07, UC-08, UC-09.
- **Sort: TABLE, live.** No curation at all — which makes it the model entry for
  what to prefer.
- **The semantic caveat, hard-won and worth restating.** Registry membership
  means *"the countries present in the list are the ones where creating a
  company is allowed"* [CONFIRMED — schema]. `eor_onboarding: true` means Remote
  can *employ* someone there (91 of 224 rows). **Neither is a travel predicate.**
  `docs/research/COUNTRY-SUPPORT-SEMANTICS.md` §5/§10 works this through, and
  `riskMatrix.js` carries a positive test that fails if anyone later "tightens"
  the jurisdiction screen to the EOR flag — which would block Martinique for a
  French employee and Montenegro for a German one [CONFIRMED — repo].
- **Cadence & staleness.** 224 rows; two captures on two days agreed exactly.
  Detection: row count plus set diff on each poll. Cheap and reliable.
- **Licensing.** Remote's data, used inside a Remote integration. Do not
  republish as a standalone dataset.
- **Evidence tag.** `[CONFIRMED — schema, fetched 2026-08-19]` for the shape;
  `[CONFIRMED — live]` for the 224 rows / 91 EOR counts.
- **Retrieval, 2026-08-19. ✅ RETRIEVED AND VENDORED (schema facts + short
  quotations, not the dataset)** at
  `docs/knowledge/layer-2-remote/L2-02-countries-registry.md`. HTTP 200, 28,455
  bytes, SHA-256 `81e97af3…`, page `updatedAt: 2026-05-27T21:26:44.000Z`.
  Two things the retrieved page settles that were previously inference:
  **(a)** `code`'s own field description reads *"The ISO 3166-1 alpha-3 country
  code (e.g., 'PRT'). **This is the primary code used across the Remote API**"*
  — which is why the alpha-3 trap keeps reappearing on every new read, not just
  the one UC-03 paid for; **(b)** `supported_json_schemas` rides on the country
  row itself, so **the L2-04 form key can be read rather than guessed** —
  directly relevant to the UC-06 wrong-form defect. Also confirmed: only
  `alpha_2_code`, `code` and `name` are required, so **`eor_onboarding` may be
  absent, and absent is not `false`.**

---

### L2-03 · `GET /v1/countries/{code}/holidays/{year}`

See **L1-10** for the substance. Catalogued in both layers deliberately: the
*authority* is national, the *carrier* is Remote, and preferring the carrier is
the recommendation.

`[CONFIRMED — schema, fetched 2026-08-19]`.

**Retrieval, 2026-08-19. ✅ RETRIEVED AND VENDORED** at
`docs/knowledge/layer-2-remote/L2-03-public-holidays.md` — HTTP 200, 22,378
bytes, SHA-256 `eeb682ea…`. Complete `Holiday` shape, and the confirmation that
`observed_day` and `note` are both **nullable** while only `name` and `day` are
required. **This entry is the catalogue's own recommendation demonstrated:** the
authority (national) was unreachable, the carrier (Remote) was not, and
preferring the carrier closed the need with no maintenance obligation taken on.

---

### L2-04 · `GET /v1/countries/{code}/{form}` — per-country JSON form schemas

- **Publisher / authority.** Remote.
- **URL.** <https://developer.remote.com/reference/get_v1_countries_country_code_form.md>
- **What it answers.** What a valid employment, contract or payroll record must
  contain **in this specific country**. The supported forms include
  `employment_basic_information`, `contract_details`,
  `contractor_contract_details`, `engagement_agreement_details`,
  `global_payroll_federal_taxes`, `global_payroll_state_taxes`,
  `administrative_details`, `bank_account_details` and about fifteen more
  [CONFIRMED — schema, the form list read live 2026-08-19]. There is also a
  `GET /v1/contract-amendments/schema` variant already used by
  `src/remote/restClient.js` [CONFIRMED — repo].
- **Used by.** UC-06 and UC-09 directly; UC-01 indirectly.
- **Sort: TABLE — and the most important single entry in this catalogue**,
  because it is the only knowledge source in the project that is *authoritative,
  per-country, versioned by its own publisher, and consumed by a write gate.*
  `src/shared/schemaValidator.js` validates against it before any write
  (`CLAUDE.md` §3, global invariant). Every other per-country rule in this repo
  is our curation; this one is Remote's.
- **The lesson attached to it.** `CLAUDE.md` §4 records that UC-06 validated
  against `employment_basic_information` — *"a form with no salary and no hours
  property at all"* — so a salary amendment could never validate. **An
  authoritative table can still be the wrong table.** A table needs the right
  *key* as well as the right source, and only a positive test ("this input MUST
  succeed") detects the difference.
- **Cadence & staleness.** Remote changes these as national requirements change.
  Detection: hash the schema per `(country, form)` and alert on change — **a
  schema change is a real compliance event**, not noise, and it is the highest
  signal-to-noise monitor available anywhere in this catalogue.
- **Licensing.** Remote's data, in-integration.
- **Evidence tag.** `[CONFIRMED — schema, fetched 2026-08-19]`.
- **Retrieval, 2026-08-19. ✅ RETRIEVED AND VENDORED (form list + Remote's own
  words, NOT the schemas)** at
  `docs/knowledge/layer-2-remote/L2-04-country-form-schemas.md`. Three pages,
  all HTTP 200: the country form page (28,302 b, `531b19c0…`), the
  contract-amendment schema page (52,917 b, `78ec2250…`) and the
  create-contract-amendment page (61,951 b, `ac36985a…`).
  **The per-country schemas themselves are deliberately not vendored, on
  Remote's own instruction**, quoted verbatim in the vendored file: *"the
  compliance requirements for each country are subject to change according to
  local laws… make sure you are **dynamically collecting or displaying the
  latest parameters for each country** by querying the 'Show form schema'
  endpoint."* Snapshotting a schema the publisher tells you not to snapshot is
  the exact failure this entry warns about one paragraph earlier.
  Also captured: the complete 24-name supported-form list, and Remote's caveat
  that only `address_details` and `company_basic_information` are reachable with
  `client_credentials` (everything else needs a company access token).

---

### L2-05 · `GET /v1/payroll-runs` and `/v1/company-payroll-runs` — the payroll calendar

- **Publisher / authority.** Remote (carrying per-company payroll configuration).
- **What it answers.** When this company's payroll cycle locks; which cycle an
  effective date falls into.
- **Used by.** UC-06, UC-09.
- **Sort: TABLE, live, per-tenant.** Never curated, never inferred. UC-06's whole
  risk lives in one question — *can this amendment still make the cycle?* — and
  the answer is a fact Remote publishes.
- **Cadence & staleness. This entry carries the best staleness lesson in the
  document.** `CLAUDE.md` §6 records that the Sandbox payroll calendar simply
  *stopped*: the last `period_end` is 2026-06-30 for SG/FR/CA/US and 2026-07-31
  for NL. So `evaluateCutoff()` finds no cycle covering any future date, and
  UC-06 escalates `noMatchingCycle` for **every** amendment anyone will ever
  submit — the gate working correctly, on a table that has run out.
  **A calendar table needs a "does it cover the date I am asking about?" check,
  not just a "did the fetch succeed?" check.** A successful fetch of an
  exhausted calendar is the exact shape of a silent failure Test B is built for.
- **Licensing.** Customer data served through Remote — treat as Layer 3
  confidential in any output.
- **Evidence tag.** `[CONFIRMED — repo]`, `[CONFIRMED — live]`, and now
  `[CONFIRMED — schema, fetched 2026-08-19]`.
- **Retrieval, 2026-08-19. ✅ RETRIEVED AND VENDORED (schema facts only — no
  customer payroll data, and none may ever appear)** at
  `docs/knowledge/layer-2-remote/L2-05-payroll-runs-calendar.md`. HTTP 200,
  55,871 bytes, SHA-256 `8956cc4a…`.
  **Two findings from the retrieved schema, neither previously recorded here:**
  **(a)** `cutoff_date` is typed `NullableDate` **and is absent from the
  required list** while `period_start`, `period_end`, `approval_date` and
  `expected_payout_date` are all present in it. UC-06's entire risk turns on
  that one field, and **a null cutoff is not "no cutoff" — unknown must
  escalate**, not pass. **(b)** The `type` enum names `one_off` — *"Ad-hoc
  off-cycle payment"* — and `expenses` — *"Dedicated expense reimbursement
  run"*, which are UC-09's and UC-02's paths by Remote's own name for them.
  Also confirmed: `/v1/company-payroll-runs` appears nowhere in today's
  `llms.txt` inventory, which is the durable version of the `CLAUDE.md` §4 note
  that its doc *title* had been read as its path.

---

### L2-06 · `support.remote.com` — the help-centre articles

- **Publisher / authority.** Remote.
- **URLs (the six that matter for these use cases).**
  - [Remote Work Authorization: what it is and how to request it](https://support.remote.com/hc/en-us/articles/37802834593805-Remote-Work-Authorization-What-it-is-and-How-to-request-it)
  - [Travel Support Letters: what they are and how to request one](https://support.remote.com/hc/en-us/articles/37802056865933-Travel-Support-Letters-What-are-they-and-How-to-request-one)
  - [What is the Requests section?](https://support.remote.com/hc/en-us/articles/6738702420877-What-is-the-Requests-section)
  - [How to request a Remote work authorization](https://support.remote.com/hc/en-us/articles/21960403649293-How-to-request-a-Remote-work-authorization)
  - [How to approve an employee's travel letter](https://support.remote.com/hc/en-us/articles/20094378700557-How-to-approve-an-employee-s-travel-letter)
  - [Maintaining legal status and avoiding risks as a foreign worker](https://support.remote.com/hc/en-us/articles/31134933870989-Maintaining-Legal-Status-and-Avoiding-Risks-as-a-Foreign-Worker)
- **What it answers.** The **process** facts no API states: that an RWA is
  required before working from any location outside the country of employment;
  that **only the employee can file one**; that a travel letter needs two weeks'
  notice; that the employer approves first and Remote second; that Remote's own
  review covers immigration/visa, tax, social security and local legal and
  reporting requirements.
- **Used by.** UC-03, UC-04, UC-07, UC-08.
- **Sort: CORPUS — and the highest-value corpus candidate in this catalogue.**
  Three reasons, in order. It is **Remote's own reasoning**, so it carries an
  authority nothing we write can. It is **directly quotable to the requester**,
  because it was written for them. And it converts UC-03's dead-end
  `route_to_uc04` — which today posts a private note and tells the employee
  nothing (`CROSS-BORDER-FLOW` §7 D-4) — into a completed self-service journey,
  which is the single highest-value change that research pass identified.
  It passes Test A as corpus: "what should I do next" has no single canonical
  answer independent of the situation. It passes Test C trivially: nothing
  gates on it.
- **Cadence & staleness. The worst-instrumented source here.** Unversioned,
  changes without notice, exposes no `updatedAt`. **There is no machine signal
  at all** — which is itself a strong argument for keeping this corpus *small*
  and human-reviewed, and for citing-and-linking rather than mirroring.
- **Evidence caveat.** Cloudflare blocks direct retrieval from this container
  for both `WebFetch` and `curl`. Everything sourced here is
  `[CONFIRMED — support, via index snippet]`: Remote's sentences, surfaced
  through search indexing, but not read in place. **Re-read in a browser before
  anything load-bearing depends on it.**
- **Licensing. ⚠ Needs a stated posture, and here is the one I recommend:
  cite-and-link, and quote only the sentence being acted on.** Quoting a
  paragraph of Remote's help centre back to a Remote customer inside a Remote CX
  workflow is the *evident intended use*. Mirroring the whole help centre into a
  vector store is a materially different act, and one nobody has granted.
  **This posture happens to be the right answer on honesty grounds too:** a
  citation that links to the live article cannot go silently stale in the way a
  mirrored copy can. The licensing constraint and the staleness constraint point
  the same way, which is a good sign the posture is right.
- **Evidence tag.** `[CONFIRMED — support, via index snippet]` — **unchanged,
  and it must stay unchanged.**
- **Retrieval, 2026-08-19. ⛔ NOT RETRIEVED, and 🔗 LINK-ONLY BY LICENCE
  REGARDLESS.** Attempted once with each tool, per the standing instruction not
  to burn a session on this host, and they failed *differently*: `curl` reached
  Cloudflare and got a **403 challenge page** (5,631 bytes of interstitial);
  `WebFetch` never got that far and returned **`EGRESS_BLOCKED`**. Two tools,
  two failure classes, neither a retrieval.
  **The cite-and-link posture recommended above is hereby adopted as the
  decision**, and a citation register for the six articles — URLs only, no
  bodies — now exists at
  `docs/knowledge/layer-2-remote/L2-06-support-help-centre.md`. Nothing from
  this source is vendored and nothing ever will be: quoting the acted-on
  sentence back to a Remote customer inside a Remote CX workflow is the evident
  intended use; mirroring the help centre is not.
  **Nothing load-bearing may rest on the substance recorded above until someone
  opens these articles in a browser.**

---

### L2-07 · Remote's internal compliance determination criteria

- **Sort: OUT OF SCOPE — it does not exist as a document we can have.**
- The developer docs say only that `declined_by_remote` means *"Remote declined
  the request after manager approval (e.g., compliance reasons)"*
  [CONFIRMED — schema]. **Permanent establishment is not named as an RWA review
  criterion in either the API docs or the support articles** — `[SILENT]`
  (`CROSS-BORDER-FLOW` §6). Also silent: any SLA for Remote's stage, whether the
  review is human or automated, whether a decline can be appealed.
- **The correct handling is what the repo already does:** escalate, name who
  decides, and never predict Remote's verdict. `approved_by_remote` is not a
  writable value in any schema, for any integrator — the enum has one member,
  `approved_by_manager` [CONFIRMED — schema]. **The boundary is enforced by
  Remote's JSON schema, not by our policy**, which is a better answer to "when
  do you not automate?" than any rule we could write.

---

## 6. Layer 3 — Company / customer policy

**Per-tenant data. See §2 for why this is the architecturally consequential
layer.** Every entry below is `🔒 customer confidential`: never in a shared
store, never in another tenant's dossier, deletable on customer exit.

---

### L3-01 · Per-customer expense policy

- **Authority.** The customer. No URL — it arrives as customer configuration.
- **What it answers.** Category spend caps, the currency they are denominated
  in, receipt thresholds, which categories are fileable, approval routing.
- **Used by.** UC-02; UC-07 for relocation spend.
- **Sort: TABLE, per tenant.** Test A: single right answer, authority is the
  customer. Test B: a wrong cap silently approves or silently refuses money.
- **Current state.** `src/uc02/policyCaps.js` — a global `POLICY_CAPS` object,
  eight rows, honestly `[PROPOSED]` mock numbers, keyed by category `code`
  (correctly, having been fixed from invented ids), **with no company key**
  [CONFIRMED — repo]. Two things it already gets right and must keep: the caps
  are integer ×100 to avoid float drift, and an unknown category returns `null`
  meaning **"cap UNKNOWN"** rather than "no cap", routing to a human. Its own
  header states the design: *"the live account offers far more categories than
  any hand-curated corpus will cover... That gap IS the design."*
- **Cadence & staleness.** Whenever the customer changes it. The detector is a
  version or `updated_at` on the customer's own configuration row — **not a
  poll**, because it is their record, not a published source.
- **Licensing.** 🔒 Customer confidential.
- **Evidence tag.** `[CONFIRMED — repo]`.

---

### L3-02 · Per-customer travel and workation policy

- **Authority.** The customer. **Carrier: `GET /v1/custom-fields` and
  `GET /v1/employments/{id}/custom-fields`.**
- **What it answers.** Which destinations are pre-approved; duration caps; who
  signs off; whether this employee has employer permission at all.
- **Used by.** UC-03, UC-04.
- **Sort: TABLE, per tenant.**
- **This is the honest home for a gate that currently has none.** UC-04's first
  hard gate reads `employment.custom_fields.workation_permission` — a property
  the real employment record does not have (grepped: zero occurrences on the
  employment show page's OpenAPI, `CROSS-BORDER-FLOW` §7 D-1). The deployed
  workaround synthesises the field in a stand-in proxy, which keeps the demo
  green and the modelling error invisible. **The real carrier exists and is
  already company-scoped:** custom fields are *"applied to employments within a
  company"* [CONFIRMED — schema, fetched 2026-08-19], defined per company with
  per-employment values.
  **And the naming matters as much as the plumbing:** if a customer wants a
  workation policy switch, it must be read as a **customer** policy and labelled
  as one — never presented as Remote's rule.
- **Licensing.** 🔒 Customer confidential.
- **Evidence tag.** `[CONFIRMED — schema, fetched 2026-08-19]` for the carrier;
  `[CONFIRMED — repo]` for the current defect.
- **Retrieval, 2026-08-19. ✅ RETRIEVED AND VENDORED (schema only — 🔒 no
  customer values, of any tenant, appear or may ever appear)** at
  `docs/knowledge/layer-3-carriers/L3-02-custom-fields.md`. Both pages HTTP 200
  (25,065 b `36cd44a6…` and 25,097 b `3d24dcd4…`), `updatedAt:
  2026-05-27T21:17:23.000Z`.
  The company-scoping sentence is confirmed verbatim, and the complete
  seven-property object is recorded — all seven **required**, including
  `visibility_scope` and `data_entry_access`, which are the fields that make
  this a governed carrier rather than a free-text bag.
  **One gap found and recorded rather than papered over:** the
  `EmploymentCustomField` object carries **no timestamp of any kind**, so the
  "version or `updated_at` on the customer's own configuration row" this entry
  proposes as the staleness detector **does not exist on the carrier**. That
  moves from `[PROPOSED]` to a known absence.

---

### L3-03 · Per-customer authority matrix — who may request, consent, approve, release

- **Authority.** The customer.
- **What it answers.** Which roles may request an amendment; who consents; who
  approves; who releases payment; what the customer's own threshold for a third
  signature is.
- **Used by.** UC-06, UC-09.
- **Sort: TABLE, per tenant — with one part explicitly excluded.**
  `src/remoteui/roles.js` already models a three-party matrix (company admin
  requests; employee consents to their own contract; employer consents on the
  company's behalf) and `src/uc09/multiApprovalPolicy.js` a three-role set with
  a floor of two [CONFIRMED — repo]. Both are currently one hard-coded matrix
  for all tenants.
- **The part that is NOT tenant data.** UC-09's `Math.max(2, ...)` floor is a
  **product invariant**, not customer configuration, and must never become
  configurable: a customer may raise a threshold, but must not be able to switch
  four-eyes off. **Tenant-configurable ceiling; product-fixed floor.** Worth
  stating as a general rule wherever tenant policy meets a control.
- **Licensing.** 🔒 Customer confidential.
- **Evidence tag.** `[CONFIRMED — repo]`.

---

### L3-04 · Per-customer leave and PTO policy, and balances

- **Authority.** The customer. **Carrier: Remote, per employment** —
  `GET /v1/leave-policies/details/{employment_id}`,
  `GET /v1/leave-policies/summary/{employment_id}`, `GET /v1/timeoff`
  [CONFIRMED — llms.txt].
- **What it answers.** Accrual rules, entitlements, current balances, and
  whether accrued leave is paid out on termination.
- **Used by.** UC-05, UC-07.
- **Sort: TABLE, live, per tenant — needing no curation and no new store.**
  What it needs is for UC-05 to **read** it. Today `ptoPayout.js` takes balances
  as structured input, with the honest note that *"in production this comes from
  the Time Off API"* [CONFIRMED — repo]. n8n execution 4975 delivered a
  plausible-looking balance carrying none of the four fields the function
  multiplies — finding F-28, which fixed the failure but not the source.
- **Licensing.** 🔒 Customer confidential.
- **Evidence tag.** `[CONFIRMED — schema, fetched 2026-08-19]` for the
  endpoints and their shapes (upgraded from `[CONFIRMED — llms.txt]`, which was
  an inventory listing rather than a read schema); `[CONFIRMED — repo]` for the
  current input path.
- **Retrieval, 2026-08-19. ✅ RETRIEVED AND VENDORED (schema only — 🔒 no
  balances, entitlements or leave records)** at
  `docs/knowledge/layer-3-carriers/L3-04-leave-policies-and-timeoff.md`. Three
  pages, all HTTP 200 (51,965 b `9c9c44ff…`, 40,100 b `067eb99b…`, 54,281 b
  `de888d52…`), `updatedAt: 2026-05-27T21:29:57.000Z`.
  **Three findings, all new to this catalogue:**
  **(a) `GET /v1/timeoff-balances/{employment_id}` is deprecated** — Remote's own
  page says *"Deprecated since February 2025 in favour of List Leave Policies
  Summary"*. Anything new must target `/v1/leave-policies/summary/…`.
  **(b) The field-by-field mapping UC-05 needs now exists**, recorded in the
  vendored file: `daysAccrued ← current_entitlement.days` (the field whose own
  description says "accrued"), `daysUsed ← taken.days`, `hoursPerDay ←
  working_hours_per_day`, and `balance.days` as the reported remainder the
  discrepancy check compares against. That converts finding **F-28** from
  "hardened the function" to "and here is the source to bind it to."
  **(c) A trap worth the whole retrieval: every balance field is either
  `{type:"limited", days, hours}` or `{type:"unlimited"}` — and the unlimited
  shape has no `days` property at all.** An unlimited PTO policy is not zero
  days accrued. Any mapping that coerces the absent field to `0` produces a
  **confident 0.00 payout on a real policy** — Test B exactly, and precisely the
  failure `ptoPayout.js` already refuses internally by declining absent numbers
  rather than defaulting them. The mapping must not undo that on the way in.
  Also confirmed: `taken` (all time off, past and future, pending or approved)
  and `used` (only approved, only past) are different questions, and on a
  resignation the difference is the answer.

---

### L3-05 · Individual employment contract terms

- **Authority.** The customer, per employment.
- **What it answers.** Contractual notice (which typically **overrides** the
  statutory floor); non-competes; garden leave; signing authority.
- **Used by.** UC-05, UC-06, UC-07.
- **Sort: NEITHER a shared table nor a shared corpus — a per-employment
  document.** The right architecture is already the one UC-05 implements:
  **statutory floor from the table (L1-09), contractual term from the employment
  record, and a discrepancy flag when they disagree.** The notice table's header
  says exactly this for Ireland: *"Contractual notice typically overrides (1–3
  months) — we still compute the statutory floor so a discrepancy against the
  contract can be flagged"* [CONFIRMED — repo]. **Do not put contract text into
  a retrieval store**: it is the single fastest route to one customer's terms
  surfacing in another's dossier.
- **Licensing.** 🔒 Customer confidential.
- **Evidence tag.** `[CONFIRMED — repo]`.

---

### L3-06 · Per-customer legal-entity footprint

- **Authority.** The customer, via Remote —
  `GET /v1/companies/{company_id}/legal-entities`, already implemented in
  `src/remote/restClient.js` [CONFIRMED — repo].
- **What it answers.** Where the customer already has a taxable presence.
- **Used by.** UC-04, UC-07, UC-08.
- **Sort: TABLE, live, per tenant.** Currently **unused by any risk path.**
- **Why it matters more than its size suggests.** This is the single fact that
  most changes a PE assessment: an employee working from a country where the
  client already has an established entity is a materially different question
  from one where they do not. Flagging `pe_risk_dape` without knowing which case
  applies produces noise a specialist has to resolve by hand, every time —
  which is the opposite of decision support.
- **Licensing.** 🔒 Customer confidential.
- **Evidence tag.** `[CONFIRMED — repo]` that the client method exists and is
  unwired; `[CONFIRMED — schema, fetched 2026-08-19]` for the response shape.
- **Retrieval, 2026-08-19. ✅ RETRIEVED AND VENDORED (schema only — 🔒 no
  customer's entity list)** at
  `docs/knowledge/layer-3-carriers/L3-06-legal-entities.md`. HTTP 200, 40,205
  bytes, SHA-256 `9031ab3b…`, `updatedAt: 2026-05-27T21:23:52.000Z`.
  **⚠ The retrieval found an armed, not-yet-fired instance of the alpha-3 trap.**
  `CompanyLegalEntity.country_code` is documented as *"ISO 3166-1 alpha-3
  country code (e.g., 'USA', 'GBR', 'DEU')"*, while every set that would consume
  this footprint — `SCHENGEN`, `EU_EEA_FOR_A1`, `RESTRICTED_JURISDICTIONS`,
  UC-04's origin→destination matrix — is **alpha-2**. It has not fired for one
  reason only: this read is still unwired. **The direction of failure is the bad
  one** — a silent code-space mismatch yields an *empty* footprint, which reads
  as "the customer has no entity there", the confident-and-wrong answer rather
  than a loud one. Recorded at the source, where whoever wires it will look.
  Also confirmed: the endpoint lists **active** entities only (so absence is not
  proof of never-present), and `country_code` is **not** in the required set.

---

## 7. Cross-reference by use case

For each: what it hard-codes today, what it admits it cannot answer, and which
catalogue entries it needs. **The admissions are where the knowledge need
actually is** — a use case that says "I escalate here because I do not know" has
already located the gap.

### UC-03 — Travel support letter / workation router (🟢)

- **Hard-codes today.** `SANCTIONED_OR_RESTRICTED` (10 codes, self-labelled
  illustrative); `DEFAULT_DURATION_CAP_DAYS = 30` (self-labelled illustrative);
  a classifier confidence floor.
- **Admits it cannot answer.** Explicitly and correctly: *"UC-03 does not own
  compliance reasoning, so it has no legal knowledge base to retrieve from —
  that lives in UC-04/07/08"*, and *"explicitly does not import `rag-retriever`"*
  [CONFIRMED — repo, `UC-03.md` §3/§13]. **This is the model of a use case that
  knows its own boundary**, and it should not acquire a corpus of its own.
- **Needs.** L1-12 (sanctions, properly sourced) · L2-02 (registry, already
  used) · **L2-06 — the one real addition**: Remote's own help-centre wording,
  so `route_to_uc04` becomes a public reply telling the employee what to file
  and where, instead of a private note the employee never sees.
- **The knowledge gap that is not a knowledge gap.** `UC-03.md` §1/§5 still
  promise auto-issue of letters that §7.1/§15 correctly say never happens
  (`CROSS-BORDER-FLOW` D-8). That is a documentation defect, not a missing
  source.

### UC-04 — Work authorization / workation (🟡)

- **Hard-codes today.** `SCHENGEN` (29 codes) · `EU_EEA_FOR_A1` (31) ·
  `DNV_COUNTRIES` (5, uncited) · `NON_TREATY_PAIRS` (7 pairs, uncited) ·
  `CURATED_SCOPE` (10) · `RESTRICTED_JURISDICTIONS` (imported from UC-03) ·
  the 90/180 and 183-day arithmetic · US/CA work-permit hard blocks.
- **Admits it cannot answer.** A great deal, and well: an unrecognised
  destination escalates rather than scoring low (finding F-14); there is
  deliberately **no 30-day hard cutoff**, because *"it is not a real statutory
  threshold... encoding a single fictional number into the matrix would be the
  opposite of deterministic"* [CONFIRMED — repo]; and `UC-04.md` §3 marks the
  totalization/treaty table `[PROPOSED — build-time task]`, to be *"sourced at
  build time directly from ssa.gov + the EU's own portable-document registry —
  **not** hardcoded from this research pass's secondary-sourced country list."*
  That instruction is already the right one and is simply not done yet.
- **Needs.** L1-03 · L1-04 · L1-05 · **L1-06 (absent — the visa-requirement
  annexes)** · L1-07 · L1-12 · L3-02 (the real home for `workation_permission`)
  · L3-06.
- **Corpus needs.** L1-08 (UK SRT) and L1-11 (PE) — as **decision support for
  the specialist who holds the only button the API can reach**, which is the
  `approved_by_manager` PATCH and nothing else.

### UC-05 — Resignation notice calculation (🟡)

- **Hard-codes today.** The nine-country `NOTICE_PERIOD_TABLE` — brackets,
  probation rules, anchor rules, `basis: statutory|customary`, and a
  `sourceCitation` string per row.
- **Admits it cannot answer.** Outstandingly well. Its header says the figures
  are simplifications, unverified by a labour lawyer, and should not be quoted
  to a customer; Canada is tagged `"customary"` rather than `"statutory"`
  because there is no employee-side statutory minimum; India is annotated as
  state-varying with contractual notice binding in practice; and every country
  outside the nine returns `unsupported_country` and escalates
  [CONFIRMED — repo]. `UC-05.md` §3 marks the table `[PROPOSED]` with *"the same
  anti-false-precision discipline as UC-04: where a specific country's rule
  can't be confirmed with high confidence, escalate rather than guess a
  formula."*
- **Needs.** L1-09 (URLs, dates and versions added to what already exists) ·
  L1-10 (holidays, for anchor-rule and working-day arithmetic) ·
  **L3-04 (read the leave policy rather than accept balances as input)** ·
  L3-05 (contractual override, already handled as a discrepancy flag).
- **The scope entry.** Nine of ninety-plus countries. That belongs in the
  catalogue as an entry, not as a footnote.

### UC-06 — Contract amendment / payroll cutoff (🟡, dual approval)

- **Hard-codes today.** Very little, and that is the point: `URGENT_WINDOW_HOURS
  = 48` and a carry-through field list. Everything jurisdiction-specific comes
  from **Remote, live** — the per-country form schema and the payroll calendar.
- **Admits it cannot answer.** `UC-06.md` §3 puts a legal RAG / compliance
  analyst agent **out of scope** deliberately: *"this repo's precedent is to
  build the lean, defensible core and say so honestly rather than half-build the
  larger vision"* [CONFIRMED — repo].
- **Needs.** L2-04 (already used — and the schema-key lesson: validating against
  a form with no salary property meant no salary amendment could ever validate)
  · L2-05 (already used — and the calendar-exhaustion staleness lesson) ·
  L1-10 · L3-03.
- **Why this is the healthiest use case in the catalogue.** Its knowledge comes
  almost entirely from live authoritative endpoints. **The correct answer to
  "what documents do we need?" is sometimes "none — query the source."**

### UC-07 — Global mobility / permanent relocation (🔴, no execution path)

- **Hard-codes today.** A six-entry `MOBILITY_CORPUS` (transition safety,
  month-end fee alignment, immigration-vs-employment separation, PTO
  portability, PE risk, minimum onboarding time); MOT business-day arithmetic;
  a `QUOTE_REQUIRED` marker wherever a cost component has no quote.
- **Admits it cannot answer.** Repeatedly and structurally. The corpus header
  states: *"The corpus is NOT an authoritative source of law; it is background
  context for a Mobility Legal specialist. Citations are background for a human,
  never a decision input — this use case's only decision is 'escalate,
  always.'"* [CONFIRMED — repo] **That sentence is Test C, written before this
  document existed**, and it is the standard the rest of the catalogue should
  meet. `UC-07.md` §15 is equally candid that the retriever is *"Real, but
  honestly NOT full vector RAG."*
- **Needs.** L1-07 · L1-11 · L1-04 · **L3-06 (entity footprint — the single
  highest-leverage unwired read for this use case)** · L3-04 · L2-06.

### UC-08 — Cross-border tax and social security (🔴, no execution path)

- **Hard-codes today.** A three-entry `TREATY_CORPUS` (OECD Art. 4 tie-breaker,
  Art. 15 employment income, totalization general principle); presence-day
  arithmetic; a mandatory disclaimer.
- **Admits it cannot answer.** The most thoroughly of any use case.
  `dossierBuilder.js` instructs that when presence days cannot be computed, the
  narrative must **not state any number, not even zero**, because *"a stated
  zero reads as 'well under the 183-day threshold', which is a conclusion nobody
  computed"* [CONFIRMED — repo]. `UC-08.md` §3 marks the six-track tax RAG index
  `[PROPOSED — roadmapped, not built]` and staleness handling likewise.
- **Needs.** L1-01 (paraphrase) · L1-02 (treaty existence as a **table**, text
  as corpus) · L1-03 · L1-04 · **L1-08 (the UK SRT — the corpus's reference
  entry)** · L1-11 · L3-06.
- **The structural guarantee to preserve.** `handleTaxInquiry()` takes an audit
  logger and nothing else — no `remote`, no `zendesk`, no parameter through
  which a write client could be passed. Nothing in this catalogue may add one.

### UC-09 — Off-cycle payroll / adjustment (🔴-framed, with execution)

- **Hard-codes today.** `INCENTIVE_TYPES`; `AMOUNT_TAX_TYPES`; a high-value
  threshold of `1000000` (integer ×100, i.e. $10,000); and
  **`highRiskCountries = ["DE", "FR", "IT"]`, commented in the source as
  `// Hypothetical high-tax-complexity countries`** [CONFIRMED — repo].
- **Admits it cannot answer.** The `Hypothetical` comment *is* the admission,
  and it is honest — but it sits inside a function that raises the required
  number of human approvers from two to three. **An invented list feeding a real
  control is the clearest single instance of Test B's failure mode in this
  repository:** if the list is wrong, an adjustment gets two signatures instead
  of three, the run succeeds, and nothing anywhere reports it. It fails *safe*
  in one direction only by luck of which countries were guessed.
- **Needs.** L2-04 (per-country payroll form schemas — already the right
  mechanism and the honest replacement for a guessed country list) · L2-05 ·
  L3-03 · L1-12.
- **The part that must not become tenant policy.** The `Math.max(2, ...)` floor.

---

## 8. What the catalogue says about the two retrievers that exist

Both `src/uc08/treatyRetriever.js` (3 passages) and
`src/uc07/mobilityRetriever.js` (6 passages) are correctly sorted as **corpus**
under Test A, correctly isolated under Test C, and honestly labelled. Nine
passages total.

Three observations that shape §9 and §10:

1. **Neither corpus carries provenance.** Each entry has `id`, `title`,
   `summary`, `keywords`. No `sourceUrl`, no `authority`, no `retrievedOn`, no
   `jurisdiction`. A reader cannot check a citation or tell how old it is. **The
   passages are paraphrase of general principles, which is why this has not yet
   caused harm** — there is no specific claim to verify. The moment a passage
   states a jurisdiction-specific rule, provenance stops being optional.
2. **The `matchedOn` honesty rule is the best thing in either file and must
   survive whatever happens next.** *"An embedding similarity score is a
   retrieval signal, not a precision figure — putting '92% similar' next to a
   passage would be the same unearned authority claim the keyword version
   refused to make."* [CONFIRMED — repo]
3. **The keyword path is actively maintained and the embedding path is not
   exercised.** The word-boundary fix documented at the top of
   `treatyRetriever.js` — where `"a1"` matched inside any `A123` identifier and
   `"183"` inside any longer number, then *told the reviewer that was the reason
   for the citation* — is a real bug found and fixed on the path that actually
   runs.

---

## 9. Is embedding-similarity retrieval justified at these sizes?

**No. Not at Tier 0, and arguably not at Tier 1 either. Keep the keyword
matcher. Do not seed either vector table.**

This is not a conservative default; it is the conclusion five separate lines of
evidence point at.

**1. Starting from nothing is not a hypothetical — it is the current, shipped,
working state.** Both `uc08_treaty_citation_vectors` and
`uc07_mobility_citation_vectors` hold **zero rows** [CONFIRMED — live,
2026-08-19]. Every production run of UC-07 and UC-08 has taken the keyword
fallback. So the question is not "should we regress to keywords" — it is
"should we start seeding", and the burden is on seeding.

**2. At n=3 and n=6, retrieval is not a search problem.** With six passages you
can put all six in front of the specialist, or all six in the drafting model's
context, and skip retrieval entirely. Embedding similarity over six items adds
an API call, a table, a threshold and a failure mode, and removes nothing. **The
honest name for "rank six things" is "show six things."**

**3. The threshold is unvalidated and, at this size, unvalidatable.**
`EMBEDDING_MATCH_THRESHOLD = 0.3` is a floor nobody tuned against a labelled
set, because no labelled set exists. With three corpus entries, precision and
recall are not measurable quantities. `CLAUDE.md` §1 puts *"define success
metrics, track them, and use them to decide what to iterate on and what to
stop"* first among the four things this project is graded on. **Shipping a
retrieval mechanism whose quality cannot be measured is the opposite of that** —
and *"stop"* is already a first-class verdict in this repo's metrics layer.

**4. The keyword path produces a *more* informative provenance string, by the
code's own honesty rule.** `matchedOn: ["183"]` tells a specialist exactly why
Article 15 is on their screen and lets them dismiss it in one glance.
`matchedOn: ["embedding similarity — ranked 1 of 2 passages, above the 0.3 match
threshold"]` tells them nothing they can check. The code refuses to print a raw
similarity number — **correctly** — which leaves the embedding path strictly
less explicable than the path it would replace. That is the retriever's own
discipline arguing against its own upgrade, and it should be listened to.

**5. The tables cannot currently store a citation that meets this document's
provenance bar.** No `source_url`, no `authority`, no `jurisdiction`, no
`version`, no `retrieved_at`, no `company_id` [CONFIRMED — live]. **Seeding them
today means seeding unattributed text.** That is a schema change before it is a
content decision, and it is an independent, sufficient reason to hold.

### The one thing embeddings would genuinely buy, and why it is cheaper elsewhere

Vocabulary mismatch is a real failure of keyword retrieval: *"I might have to
pay tax in two places"* contains none of `dual resident`, `tie-breaker`, or
`resident of both`, and would surface nothing. At this corpus size the fix is a
richer synonym list on the entry — which is already the mechanism (`keywords:
[]`) and is maintainable by hand for nine passages. At three hundred passages it
is not, and that is the real crossover.

### Where the crossover actually is — three conditions, all required

Embedding retrieval earns its place when **all three** hold:

- **(a) Scale.** The corpus exceeds roughly 100–200 passages, so no human can
  read it all and no curator can maintain synonym lists by hand.
- **(b) A labelled evaluation set.** Perhaps 50 real inquiries with the passages
  a specialist says *should* have surfaced, so the threshold is **tuned** rather
  than picked. Without this you cannot state whether the upgrade improved
  anything.
- **(c) Metadata filtering before ranking.** Each passage carries jurisdiction,
  authority and effective date, and retrieval **filters** on them before it
  ranks. A UK residence question must not surface a Mexican notice passage at
  rank 1 however similar the prose. **This is the condition most often skipped
  and the one that causes the worst failures**, because pure similarity has no
  concept of "wrong country" — and "wrong country, confidently ranked first" is
  exactly Test B.

**None of the three holds today, and (b) will not hold at Tier 1 either.**

### Recommendation

**Leave the embedding code exactly where it is: written, tested, unconfigured,
degrading to keywords.** It costs nothing to keep and it is genuinely good work.
Switching it on with nine passages and an untuned threshold would buy no
accuracy and spend real credibility — a reviewer who notices that the vector
store holds three paraphrased paragraphs and a 0.3 magic number will discount
everything around it, which is precisely the risk `CLAUDE.md` §3 directive 7
names.

**Say this in `UC-07.md` §15 and `UC-08.md` §3 as a decision, not as a gap.**
"We built vector retrieval, measured the corpus, and concluded keyword matching
is the honest choice until the corpus reaches a size where retrieval quality can
be measured" is a stronger portfolio statement than a seeded table would be. It
is also, directly, the *"as comfortable making the case against automating
something as building it"* criterion.

---

### 9b. Re-assessed after the 2026-08-19 retrieval pass — the answer holds, and the reason has changed

**When §9 was written, the corpus was small. Now that the real documents have
been sized rather than described, the finding is sharper than "small": the
corpus did not grow at all, and the reason it did not is structural rather than
circumstantial.**

**The measurement.** The retrieval pass added **zero** new corpus passages. The
corpus is still the same nine paraphrased entries — three in
`src/uc08/treatyRetriever.js`, six in `src/uc07/mobilityRetriever.js`. Every one
of the eight sources actually retrieved (all Layer 2 and Layer-3 carriers) sorts
as **TABLE** under Test A: `Country`, `Holiday`, `MinimalPayrollRun`,
`EmploymentCustomField`, `LeavePolicySummary`, `CompanyLegalEntity`, the form
list, the amendment schema. Not one is a passage a specialist would read. They
are field names, enums and nullability rules — facts with an authority and a
version, consumed by gates.

**The structural finding, which is the part worth keeping.**

> **The licence gradient runs *against* corpus material.** The sources we are
> entitled to hold in full are precisely the ones that sort as tables. The
> sources that sort as corpus are precisely the ones we may not mirror.

It holds across the whole catalogue without exception:

| Sorts as | Sources | May we hold the text? |
|---|---|---|
| **TABLE** | Remote's OpenAPI schemas · EU primary law (2016/399, 2018/1806, 883/2004) · SSA totalization list · sanctions lists | **Yes** — public domain, EUR-Lex reuse, OGL |
| **CORPUS** | OECD Model + Commentaries · BEPS Action 7 · `support.remote.com` reasoning · national immigration guidance | **No** — copyrighted, cite-and-link, or terms unstated |

The one clean exception is **L1-08, the UK SRT under OGL v3.0** — genuinely
corpus-shaped *and* verbatim-reproducible. It is the catalogue's own reference
corpus example, and it is the source this pass most regrets not reaching.

**What that does to the crossover.** §9 sets three required conditions and puts
(a) at roughly 100–200 passages. Against the real documents:

- **(a) Scale — further away than it looked, and possibly out of reach.** Take
  every corpus-sorted source in this catalogue, assume full egress, and honour
  every licence: paraphrases of OECD Articles 4/5/15 and BEPS 7 (~6–10),
  verbatim UK SRT and RDR3 under OGL (~15–30), EUR-Lex 883/2004 Articles 11–16
  (~10–20), Remote's six help-centre articles **as links, embeddable never**
  (0). That is a **ceiling around 30–60 passages** — which is exactly Tier 1's
  own estimate, and **below the crossover, not on the way to it.** The 100–200
  figure is reachable mainly by buying a commercial database, and X-03 excludes
  those precisely because their terms forbid machine ingestion. **So the
  crossover is not merely deferred; on the licensed sources available to this
  project it may never arrive.** §9 says "until the corpus reaches a size where
  retrieval quality can be measured", which reads as a matter of time. It is a
  matter of licensing. Worth saying in those words.
- **(b) A labelled evaluation set.** Unchanged and untouched by this pass. Still
  the binding constraint on calling any upgrade an upgrade.
- **(c) Metadata filtering before ranking.** **This is the one condition the
  pass moved, and it moved on the table side, not the corpus side.** Every
  vendored file now carries authority, exact URL, retrieval date, checksum,
  licence and catalogue id — the columns §2 finding 2b showed both pgvector
  tables lack. That is real progress toward (c) as a *discipline*, and it is
  progress that benefits the **table** store, whose provenance columns Tier 1
  should add whether or not embeddings are ever switched on. It does nothing for
  the nine corpus passages, which still carry no `sourceUrl`, `authority` or
  `retrievedOn` (§8 observation 1).

**Verdict: unchanged, and now on firmer ground. Do not seed either vector
table.** Both still hold zero rows, both still lack every provenance column, and
the corpus is still nine passages — which the honest name for ranking remains
*"show nine things."* The pass produced no evidence for seeding and one new
argument against it: a retrieval upgrade whose corpus ceiling is set by
copyright rather than by effort is not a roadmap item, it is a decision.

**The one thing that did change is what to do with the effort instead.** The
retrieved schemas surfaced four concrete defects and gaps — a nullable
`cutoff_date` that UC-06's whole risk turns on, a deprecated time-off endpoint,
an unlimited-PTO shape that would produce a confident 0.00 payout, and an armed
alpha-3 mismatch on the unwired legal-entity read. **Every one is a table
problem, and every one would have been invisible to any amount of retrieval
work.** That is the strongest argument in this document for the sorting rule it
opens with.

---

## 10. Staged recommendation

`CLAUDE.md` §1: the repository must be submittable after every change, and the
deadline is the dominant constraint. **A production version of this corpus is a
standing content operation with permanent maintenance obligations, and it cannot
be built here.** So the staging is by what is *defensible*, not by what is
*complete*.

### Tier 0 — the defensible portfolio minimum (do before submission)

Every item is a **label, a provenance field, or a shape change**. None is new
content, and none changes a decision.

1. **Add provenance to the tables that already exist.**
   `noticePeriodTable.js` gains `sourceUrl` and `retrievedOn` beside its
   existing `sourceCitation`. `SANCTIONED_OR_RESTRICTED`, `SCHENGEN`,
   `EU_EEA_FOR_A1`, `DNV_COUNTRIES`, `NON_TREATY_PAIRS`, `POLICY_CAPS` and
   UC-09's `highRiskCountries` each gain one line naming the authority and the
   date — **or an explicit `[PROPOSED] — illustrative, no authority` where none
   exists.** Roughly half already do this well; the value is making the other
   half match, so a reader can tell at a glance which numbers are sourced.
2. **Fix the two mislabelled ones.** UC-09's
   `highRiskCountries = ["DE","FR","IT"] // Hypothetical` feeds a real
   approval-count control (§7). Either bind it to a source or rename the flag so
   it cannot be read as a compliance determination. Same for `DNV_COUNTRIES`,
   which currently *suppresses* a Schengen check on an uncited basis.
3. **Key `POLICY_CAPS` by tenant, even with one tenant in it.** The same eight
   rows under a demo `company_id`. Zero behaviour change — and the tenancy
   finding stops being a paragraph and becomes a shape a reviewer can see.
4. **Add the two cheap, unambiguous, public-domain tables that close real
   gaps:** Reg. (EU) 2018/1806 Annex II (visa-exempt nationalities, L1-06) and
   the SSA totalization country list (L1-03). Both are enumerable, both are
   freely reproducible, and both feed gates that today rely on a self-declared
   field or a seven-pair guess.
5. **Do not seed either vector table.** Leave both at zero rows and record §9's
   reasoning in `UC-07.md` §15 and `UC-08.md` §3 as a decision.
6. **Publish this catalogue and link it from `README.md` and each `UC-0X.md`
   §3.** The catalogue *is* the Tier-0 deliverable. Stating precisely what the
   system does not know is the portfolio-grade move, and it is the artefact that
   makes every `[PROPOSED]` tag elsewhere in the repo legible.

### Tier 1 — what a small team could maintain (post-submission)

- **Bind every Layer-1 table to a machine-fetchable source with a scheduled
  diff.** Sanctions daily (and **failing closed** on a fetch failure);
  `GET /v1/countries` and each country form schema weekly with a hash alert;
  SSA totalization monthly; Schengen membership quarterly.
- **Add the provenance columns the stores lack** — `source_url`, `authority`,
  `jurisdiction`, `version`, `retrieved_at`, `licence` — to the *table* store,
  whether or not embeddings are ever switched on.
- **Move `SANCTIONED_OR_RESTRICTED` from `src/uc03/` to `src/shared/`**, which
  its own comment already asks for: *"a jurisdiction property is not a use-case
  property."*
- **Wire the per-tenant carriers that already exist and are unused:**
  `/v1/custom-fields` for workation permission (L3-02, replacing the invented
  field), `/v1/leave-policies/*` for PTO (L3-04), `/v1/companies/{id}/legal-entities`
  for PE context (L3-06).
- **Add a "does this table cover the question I am asking?" check** to the
  calendar-shaped tables — payroll runs and holidays — so an exhausted calendar
  reports as exhausted rather than as a correct refusal (L2-05).
- **Grow the corpus from 9 passages to perhaps 30–50**, all paraphrase or
  OGL/EUR-Lex-licensed text, each carrying jurisdiction, authority and
  retrieved-on. **Still keyword-matched** (§9).
- **Add Remote's own help-centre wording to the corpus (L2-06), cite-and-link
  only**, and use it to turn UC-03's `route_to_uc04` into a public reply. This
  is the highest customer-visible value per unit of effort in the whole
  catalogue.

### Tier 2 — only a real content operation can do this

Named so the boundary is explicit rather than implied.

- **Per-country immigration rules across 90-plus countries**, reviewed by local
  counsel and re-reviewed on a schedule. **This is not an engineering problem at
  all.** Cadence is months, the failure mode is silent, and the source is often
  a national portal in a language the maintainer does not read.
- **Bilateral treaty coverage across roughly 3,000 treaties**, plus the MLI
  overlay that changes a treaty's effect without changing its text.
- **Statutory notice, working-time and termination rules across the full
  footprint.** This catalogue covers nine countries; Remote serves ninety-plus.
- **A licensed commercial database** (IBFD, Bloomberg Tax, Vialto) with terms
  that permit machine use — **which most do not.** That is why this is a
  purchase-and-negotiation decision and not a scraping task (X-03).
- **A labelled evaluation set and a retrieval-quality metric**, without which
  the embedding upgrade cannot honestly be called an upgrade (§9 condition b).
- **An owner per country with a review date, and an alert when a review date
  passes.** **The maintenance obligation, not the content, is the real cost** —
  a corpus with no owner decays into a corpus that is confidently wrong, which
  is worse than no corpus at all.

---

## 11. What would be dishonest to ship

**A corpus that looks comprehensive and is not is worse than a small one that
says what it is.** Seven specific things to refuse:

1. **Nine paraphrased general principles under a heading like "Global Tax &
   Mobility Knowledge Base", with a similarity score beside each.** Every
   individual element would be honest; the assembly would not. The existing code
   already refuses this in as many words — *"building something that looked like
   semantic retrieval over three paragraphs would have claimed infrastructure
   this repo didn't have"* [CONFIRMED — repo] — and that refusal is the single
   most valuable thing to preserve through any expansion.
2. **A number with no authority rendered beside a number that has one.** UC-09's
   `["DE","FR","IT"]` deciding an approval count in the same dossier as Remote's
   own country form schema is exactly this. **Mixed-provenance output is worse
   than uniformly weak output**, because a reader calibrates their trust to the
   strongest-looking item on the page.
3. **A similarity score presented as a confidence figure.** Already refused in
   code. Keep it refused, in whatever form retrieval eventually takes.
4. **Company policy in a shared store.** Not merely dishonest — a
   data-protection incident, and the one failure in this document that would
   harm a party who never used the system. This is the tenancy finding's teeth.
5. **Describing a table as "maintained" or "kept current" when nothing detects
   staleness.** A table stamped `retrievedOn: 2026-08-19` with no monitor is
   honest. The same table described as current is not. **Prefer the date.**
6. **Silently falling back to a cached sanctions list when the fetch fails.**
   Every other unknown in this repository fails closed; this one must too, and
   it is the one most likely to acquire a helpful fallback by accident.
7. **Presenting a corpus citation as the reason for a decision.** Test C exists
   to make this structurally impossible rather than merely discouraged — no
   policy engine imports a retriever, and no citation id appears in a
   conditional. If that ever stops being true, the sorting in this document has
   been abandoned regardless of what the tables contain.

**And the meta-rule, which this repository has already paid for three times:** a
knowledge source that cannot make a decision succeed is indistinguishable from
one being appropriately cautious. `CLAUDE.md` §5: *"every fail-closed assertion
passed before the UC-03 fix too... Only a positive test — 'this input MUST
auto-resolve' — detects it."* **Any table added under this catalogue needs a
positive test**: an input that must resolve, not only inputs that must refuse.

---

## 12. Verification notes

**Run live while writing this, 2026-08-19:**

- `select count(*)` on `uc08_treaty_citation_vectors` → **0**; on
  `uc07_mobility_citation_vectors` → **0**.
- `information_schema.columns` for both tables → `citation_id, title, summary,
  embedding, created_at`. **No `company_id`, no `source_url`, no `authority`, no
  `version`, no `retrieved_at`, no `jurisdiction`.**
- `curl https://developer.remote.com/reference/get_v1_countries_country_code_holidays_year.md`
  → 200, `Holiday` schema with `day` / `name` / `note` / `observed_day`,
  `updatedAt: 2026-05-27T21:26:44.000Z`.
- `curl https://developer.remote.com/reference/get_v1_custom-fields.md` → 200,
  `EmploymentCustomField` described as *"applied to employments within a
  company"*, `updatedAt: 2026-05-27T21:17:23.000Z`.
- `docs/REMOTE-API-INDEX.txt` grepped for the country-scoped, leave-policy,
  time-off, custom-field, incentive and holiday operation families.

**Repository files read (read-only; none modified):**
`src/uc02/policyCaps.js`, `src/uc02/policyEngine.js` ·
`src/uc03/policyEngine.js` · `src/uc04/riskMatrix.js` ·
`src/uc05/noticePeriodTable.js`, `src/uc05/ptoPayout.js` ·
`src/uc06/cutoffEngine.js`, `src/uc06/policyEngine.js` ·
`src/uc07/mobilityRetriever.js`, `src/uc07/transitionGate.js`,
`src/uc07/costCalculator.js` ·
`src/uc08/treatyRetriever.js`, `src/uc08/dossierBuilder.js`,
`src/uc08/inquiryParser.js` ·
`src/uc09/policyEngine.js`, `src/uc09/multiApprovalPolicy.js` ·
`src/shared/disclaimer.js`, `src/shared/remoteWorld.js` ·
`src/remote/restClient.js` (endpoint inventory) ·
`docs/use-cases/UC-03.md` … `UC-09.md` · `docs/00-FOUNDATION.md` §4 ·
`docs/research/CROSS-BORDER-FLOW.md` (in full) · `docs/REMOTE-API-INDEX.txt`.

**Not verified, and flagged rather than assumed:**

- ~~**Every Layer-1 source URL is `[PROPOSED]`**~~ — **superseded 2026-08-19.**
  Every one was attempted. **None was retrievable**; each entry now carries a
  dated Retrieval line, and the per-source record with a prioritised work order
  is at
  [`docs/knowledge/layer-1-statutory/RETRIEVAL-BLOCKED.md`](knowledge/layer-1-statutory/RETRIEVAL-BLOCKED.md).
  The tags stay `[PROPOSED]` because **an attempted-and-blocked fetch is not a
  confirmation** — that is the whole point of keeping the distinction.
- **Every licensing conclusion for a non-Remote, non-EU, non-US-federal source
  is `[INFERRED]`.** The OECD restriction (L1-01, L1-11), the German and Indian
  gazette terms (L1-09), and the per-country immigration portals (L1-07) each
  need a real check. **Flagged rather than assumed, per the brief.** Unchanged
  by the retrieval pass: none of those sources was reachable, so no licence
  statement was read in place.
- **`support.remote.com` remains unreadable from this container** for both
  `WebFetch` and `curl` — re-confirmed 2026-08-19, and the two tools failed
  *differently* (Cloudflare 403 challenge page vs. `EGRESS_BLOCKED` at the
  proxy). Everything in L2-06 is `[CONFIRMED — support, via index snippet]` and
  must be re-read in a browser before anything load-bearing depends on it.

**Added by the retrieval pass, 2026-08-19:**

- **Retrieved live by `curl` and vendored as extracts** (HTTP 200 and SHA-256
  recorded per file in `docs/knowledge/`): `llms.txt`; `get_v1_countries`;
  `get_v1_countries_country_code_form`;
  `get_v1_countries_country_code_holidays_year`; `get_v1_payroll-runs`;
  `get_v1_custom-fields`; `get_v1_employments_employment_id_custom-fields`;
  `get_v1_leave-policies_summary_employment_id`;
  `get_v1_leave-policies_details_employment_id`;
  `get_v1_timeoff-balances_employment_id`;
  `get_v1_companies_company_id_legal-entities`;
  `get_v1_contract-amendments_schema`; `post_v1_contract-amendments`.
- **Hosts attempted and refused by egress policy** (403 at proxy `CONNECT`;
  recorded by the proxy as `connect_rejected`): `www.ssa.gov`,
  `eur-lex.europa.eu`, `ec.europa.eu`, `home-affairs.ec.europa.eu`,
  `webgate.ec.europa.eu`, `www.legislation.gov.uk`, `www.gov.uk`, `www.irs.gov`,
  `www.oecd.org`, `ofac.treasury.gov`, `sanctionslistservice.ofac.treas.gov`,
  `www.un.org`, `natlex.ilo.org`, `www.gesetze-im-internet.de`,
  `www.irishstatutebook.ie`, `www.dre.pt`, `isap.sejm.gov.pl`,
  `www.diputados.gob.mx`, `www.canada.ca`, `www.cbp.gov`, `www.uscis.gov`,
  `support.remote.com`, `en.wikipedia.org`.
- **A reachable route deliberately refused.** `raw.githubusercontent.com` **is**
  reachable, and third-party mirrors of the EU annexes, the SSA list and the
  OFAC files exist there. None was fetched. A mirror is not the authority, and a
  provenance header naming an authority above bytes nobody in this chain read
  from that authority is the same failure `CLAUDE.md` §4 calls this project's
  through-line: *"fixtures were written to agree with the code, and the code
  with the fixtures."* **An honest blank is recoverable; a plausible wrong list
  is not.**
