# Layer-1 download manifest — 39 documents, four countries · **35 now retrieved**

> **STATUS CHANGED AGAIN 2026-08-19 (third pass). Read this box before anything
> below it.** This file was written as a shopping list, on the finding that every
> statutory authority was refused by this container's egress policy — 50 URL
> attempts, 50 identical denials, zero successes. A second pass, after the
> allowlist opened, retrieved **26**. A third pass — six more hosts allowlisted,
> plus three US pages transcribed by hand by the repository owner — took it to
> **35 of 39**.
>
> - **Retrieved: 35.** Sidecars and committed bytes are under
>   [`layer-1-statutory/`](layer-1-statutory/). New in the third pass: **D-02,
>   D-03, D-10 ★, D-14, D-15, D-19, D-26, D-32, D-39**.
> - **Not retrieved: 4** — **D-05** (JavaScript-only), **D-12** (origin TLS),
>   **D-13** (re-scoped, never retried on the new scope), **D-30** (licence, not
>   access). Four documents, four different remedies, set out in
>   [`layer-1-statutory/RETRIEVAL-BLOCKED.md`](layer-1-statutory/RETRIEVAL-BLOCKED.md)
>   §4 and §6. **Class A — our own network refusing an authority — is now
>   empty.**
> - **The findings are the point**, and they are in
>   [`layer-1-statutory/CONTRADICTIONS.md`](layer-1-statutory/CONTRADICTIONS.md) —
>   now **27 items and 4 confirmations**, up from 16 and 2.
>
> **Updated 2026-09-02 — a fourth pass, on one question.** *What does the statute
> require of a **resigning employee**?*, asked of the `NOTICE_PERIOD_TABLE`
> countries whose statute had never been retrieved. **D-05 was retrieved and its
> "JavaScript-only" classification was the error, not the site**; **D-41, D-42,
> D-43, D-44** are new; **D-45 is a new blocked slot** — Germany's
> `gesetze-im-internet.de` does not answer a TCP connection from this container,
> so BGB § 622 is carried at agency strength only. **Retrieved: 40 of 44. Not
> retrieved: 4** — D-12, D-13, D-30 unchanged, plus **D-45's statute**.
> `CONTRADICTIONS.md` is now **35 contradictions and 6 confirmations**.
>
> **Three things the third pass changed that a reader of the old box would get
> wrong:**
>
> 1. **D-10 ★, the manifest's highest-value document, is retrieved.** Not from
>    the DRE HTML site, which is still a JavaScript shell on every route, but
>    from **`files.diariodarepublica.pt`**, which serves the gazette itself as a
>    static PDF at `/gratuitos/1s/<yyyy>/<mm>/<issue><suffix>.pdf`. The same URL
>    shape closed **D-02** and **D-03**. Art. 61.º-B turns out to be **one
>    paragraph containing no income floor, no duration and no insurance
>    requirement** — see **C-17**.
> 2. **A retrieved, authoritative, non-mirrored agency table was wrong in one
>    cell.** The CRA's Canada–Netherlands row pairs the entry-into-force date of
>    a **superseded** 1987 agreement with the 60-month detachment maximum of the
>    **2004** agreement that replaced it. Only reading the treaty texts caught it
>    (**C-24**). *Getting an identifier from a body with a reason to maintain it
>    is a much better rule than the alternatives and is not a guarantee.*
> 3. **Two licence classes in §3 below are wrong and are corrected in place.**
>    **D-39** was class (b) *"reusable with attribution"*; the UN's own copyright
>    page says *"All rights reserved"* — class (c). **D-19** was class (c)
>    pending a check; the Commission's legal notice puts undated content on its
>    sites under **CC BY 4.0** — bytes now committed. And the Dutch question the
>    second pass had to leave open is closed: the **Basis Wetten Bestand is
>    CC0 1.0** per KOOP's own open-data register entry, so **D-01 and D-31 bytes
>    are committed**.
>
> **Every URL below has now been called** — most of them twice — and each entry
> carries the observed result in place of the old *"URL NOT VERIFIED"* caveat.
> Three of the manifest's guessed identifiers turned out to be **wrong** (D-08's
> land-border decision, and both of D-10's Portuguese ids), one named the wrong
> statutory index (D-13's IAS, which is really the RMMG), and one could not have
> existed (D-26's Finance Canada slug). All are corrected in place. That
> distribution is the argument for fetching rather than corroborating.
>
> **The shopping-list framing below is kept, not rewritten.** Its per-entry
> *"what is wrong today without it"* analysis is still the reason each document
> matters — and for the nine retrieved in the third pass, the sidecars now say
> what the documents actually contain.
>
> **Scope: Netherlands (NL), Portugal (PT), Canada (CA), United States (US)**,
> and the pairs among them. That narrowing is a decision already taken, not a
> proposal. Every entry below is scoped to those four.
>
> **Read first:** [`KNOWLEDGE-SOURCES.md`](../KNOWLEDGE-SOURCES.md) (the
> catalogue — what each source is and how it sorts), [`README.md`](README.md)
> (what was actually retrieved), and
> [`layer-1-statutory/RETRIEVAL-BLOCKED.md`](layer-1-statutory/RETRIEVAL-BLOCKED.md)
> (the five failure classes, and the per-document record of the four).
>
> **This file changes no code.** Nothing under `src/`, `test/`, `workflows/`,
> `zaf-app/` or `scripts/` was touched by the pass that produced it.

---

## 1. HOW TO USE THIS

### Where the files go

```
docs/knowledge/layer-1-statutory/
├── D-01-nl-notice-bw-7-672.md          ← the provenance-stamped extract (ALWAYS)
├── D-02-pt-notice-ct-art-400.md
├── …
└── sources/
    ├── D-01-nl-notice-bw-7-672.html    ← the retrieved bytes (ONLY if the licence permits)
    ├── D-20-ssa-totalization-status.html
    └── …
```

**Two files per document, and the split is deliberate.**

1. **`D-NN-<slug>.md`** — always. A Markdown file carrying the provenance
   header below, plus whatever extract, quotation or citation register the
   licence permits. This is the file the repository actually reads.
2. **`sources/D-NN-<slug>.<ext>`** — only when the licence permits committing
   the bytes to a **public** repository. A PDF or an HTML page cannot carry a
   Markdown provenance header, which is why it never travels alone. If the
   licence is class **(c)** or **(d)** in §3, **do not commit the bytes at
   all** — the `.md` sidecar exists on its own and says why, exactly as
   [`L2-06-support-help-centre.md`](layer-2-remote/L2-06-support-help-centre.md)
   already does for `support.remote.com`.

### Naming convention

`D-NN-<jurisdiction>-<subject>-<instrument>` — lower-case, hyphens, no spaces,
no dates in the filename. The `D-NN` id is stable and is what the manifest,
the sidecar and any future code comment all cite. Dates live *inside* the
provenance header, because a document that is re-retrieved must keep its id
and change its retrieval line, not become a second file.

### The provenance header every vendored file needs

Copy this shape **exactly** from
[`layer-2-remote/L2-02-countries-registry.md`](layer-2-remote/L2-02-countries-registry.md).
A vendored file with no provenance header is worse than no file, because it
looks authoritative and cannot be checked.

```markdown
# D-NN · <short title>

| | |
|---|---|
| **Catalogue id** | D-NN (`docs/knowledge/DOWNLOAD-MANIFEST.md`) · L1-0N (`docs/KNOWLEDGE-SOURCES.md` §4) |
| **Source name** | <the document's own title, in its own language> |
| **Publisher / authority** | <the real name of the body that publishes it> |
| **Exact URL** | <https://…> |
| **Retrieved** | **YYYY-MM-DD**, by <method>. HTTP 200, N bytes. |
| **SHA-256 of the retrieved bytes** | `…` |
| **Source `updatedAt`** | <the consolidation / version / "last updated" date the authority itself prints on the document — NOT the date you downloaded it> |
| **Licence / basis for inclusion** | <the specific instrument, and what it permits: full copy / extract / cite-only> |
| **Evidence tag** | `[CONFIRMED — statute, retrieved YYYY-MM-DD]` |
```

Getting the byte count and checksum, on the machine that did the download:

```bash
wc -c  docs/knowledge/layer-1-statutory/sources/D-NN-<slug>.pdf
shasum -a 256 docs/knowledge/layer-1-statutory/sources/D-NN-<slug>.pdf
```

**The `Source updatedAt` row is the one most likely to be skipped and the one
that matters most.** `KNOWLEDGE-SOURCES.md` L1-02 records why: the BEPS
Multilateral Instrument modifies treaties *without changing their published
text*, so a document's effect can move while its bytes stay identical. A
checksum detects a re-publication; only a version date detects a re-reading.

### Two rules that are not negotiable

- **A mirror is not the authority.** `raw.githubusercontent.com` is reachable
  from here and hosts convincing copies of the EU annexes, the SSA list and the
  OFAC files. None was fetched and none will be. Vendoring one produces a file
  whose provenance header names an authority nobody in the chain has read —
  the exact failure `CLAUDE.md` §4 calls this project's through-line. An honest
  blank is recoverable; a plausible wrong list is not.
- **Do not paraphrase what you could not read.** Every entry below states what
  the document is *for* and what the code does *without* it. Not one states
  what the document *says*. Where a number appears in this manifest at all, it
  is a number already in this repository's own code, quoted as the thing
  needing a source — never as a sourced fact.

---

## 2. Verification status — every URL has now been called

**39 documents. 39 URLs called, most of them twice. 35 retrieved, 4 not.**

The first pass (2026-08-19, morning) attempted every URL here and got 50
identical `curl: (56) CONNECT tunnel failed, response 403` denials at the proxy
`CONNECT` — our own network refusing the authorities, before any request reached
them. That record is preserved in
[`layer-1-statutory/RETRIEVAL-BLOCKED.md`](layer-1-statutory/RETRIEVAL-BLOCKED.md)'s
appendix, because its signature is what let the second pass tell four different
failures apart at a glance.

The second pass (same day, after the allowlist opened) called every URL again,
and a third pass — six more hosts, plus three US pages transcribed in a browser
by the repository owner — called the remainder.
**Each entry below now carries its observed result** — status code, byte count
where retrieved, and the specific failure class where not. The old blanket
caveat is gone, because keeping it after checking would have been a fresh
inaccuracy of the same kind it was written to prevent.

### What "corroborated by search index" was worth, measured

The first pass marked some URLs *"shape corroborated by search index"*, and was
explicit that this was **weaker than a fetch and not a source for any fact**.
Now that every URL has been called, that judgement can be scored rather than
asserted:

| Outcome | Count | Examples |
|---|---|---|
| Corroborated **and** correct | most | D-04, D-05, D-14, D-15, D-20, D-25, D-27, D-31, D-33, D-34, D-35 all resolved to the right document |
| Uncorroborated guess that was **right** | 2 | D-29's pattern-derived IRS Canada slug; D-24's two Dutch identifiers |
| Guess that was **wrong** | 3 | D-08's land-border CELEX (`32024D3206` is a **Latvian VAT derogation**); D-10's consolidated Lei 23/2007 id; D-10's Lei 18/2022 id |
| A slug that **could not have existed** | 1 | D-26 — Finance Canada has no Portugal page; its index points at GAC |

Three wrong out of the ones that could be checked is a low rate and a
**non-zero** one, and the wrong ones were not flagged as riskier than the right
ones. The two D-10 ids were fixed not by searching harder but by reading **a
Portuguese government authority's own link list**, which is the general lesson:
when an identifier must be right, get it from a body that has a reason to
maintain it.

### The four failure classes, because they are not interchangeable

`CLAUDE.md` §6 already records that a proxy `403` *"reads identically to an API
permission error but is not one."* This pass added two more look-alikes.
Full detail in
[`RETRIEVAL-BLOCKED.md`](layer-1-statutory/RETRIEVAL-BLOCKED.md) §1; in short:

- **A — egress policy.** `CONNECT tunnel failed, response 403`. Ours. Report it.
- **B — site bot protection.** `HTTP/1.1 200 Connection Established` **then** an
  origin 403. Theirs. A complete browser header set fixed `ssa.gov`, `dol.gov`
  and `canada.ca`; it did not fix `cbp.gov`, `uscis.gov` or `travel.state.gov`.
- **C — JavaScript-only.** HTTP 200 and an application shell. Nobody is
  refusing; the document simply is not in the response. This is what blocks
  every Portuguese code and Ontario's ESA.
- **D — origin TLS.** Tunnel established, then
  `unable to get local issuer certificate`. `aima.gov.pt` serves an incomplete
  chain.

**Check for the `HTTP/1.1 200 Connection Established` line before blaming
anything.**

---
## 3. Licence classes — the table to read before choosing what to download

This is the grouping that decides whether a download is *usable* once you have
it. Two documents can be equally important and completely different in what you
may do with the bytes.

### (a) Public domain or explicitly reusable in full — commit the bytes

| id | Document | Basis |
|---|---|---|
| D-20 | SSA — Status of Totalization Agreements | **US federal government work — public domain.** No conditions. | ✅ **bytes** |
| D-27 | US–Netherlands income tax convention (IRS) | US federal — public domain | ✅ **bytes** |
| D-28 | US–Portugal income tax convention (IRS) | US federal — public domain | ✅ **bytes** |
| D-29 | US–Canada income tax convention (IRS) | US federal — public domain | ✅ **bytes** |
| D-35 | IRS substantial-presence test / Pub. 519 | US federal — public domain | ✅ **bytes** |
| D-36 | OFAC sanctions programs & country information | US federal — public domain (**but see the do-not-vendor rule in §9**) | ✅ register only |
| D-14 | US VWP / ESTA permitted activities (CBP, State) | US federal — public domain | ⛔ class B (site) |
| D-15 | USCIS B-1 temporary business visitor | US federal — public domain | ⛔ class B (site) |
| D-06 | WARN Act / DOL plant-closings guidance | US federal — public domain | ✅ **bytes** |
| D-07 | Schengen Borders Code, Reg. (EU) 2016/399 | EUR-Lex reuse, **Commission Decision 2011/833/EU**, attribution | ✅ text · no bytes (size) |
| D-08 | Council Decisions on BG/RO Schengen accession | EUR-Lex reuse, 2011/833/EU | ✅ **bytes** · id corrected |
| D-09 | Reg. (EU) 2018/1806, Annexes I and II | EUR-Lex reuse, 2011/833/EU | ✅ **bytes** |
| D-17 | Reg. (EC) 883/2004 | EUR-Lex reuse, 2011/833/EU | ✅ **bytes** |
| D-18 | Reg. (EC) 987/2009 | EUR-Lex reuse, 2011/833/EU | ✅ **bytes** |
| D-37 | EU consolidated financial-sanctions list | EU reuse (**see §9**) | ✅ register only (API) |

**The nine US rows are the only documents in this entire manifest the owner can
download AND commit verbatim to a public repository with no licence question to
resolve.** That is a real difference in what each download is worth, and it
should drive the order of an afternoon's work. It also means the three IRS
treaty texts (D-27/28/29) are the **only** treaty texts here that can be
committed in full — the Dutch, Portuguese and Canadian ones are not.

### (b) Reusable with attribution, but check the specific instrument first

| id | Document | Basis, and what to check |
|---|---|---|
| D-01, D-31, D-40 | NL — BW Boek 7 arts. 672 and 628a; AWR art. 4 | **Closed 2026-08-19, and not where expected.** `www.overheid.nl/copyright` answers **410 Gone** — the site publishes no reuse-terms page any more. The answer is in the national open-data register: KOOP's entry for the **Basis Wetten Bestand**, the dataset behind `wetten.overheid.nl`, states **CC0 1.0** (`data.overheid.nl/dataset/basis-wetten-bestand`, modified 2025-10-03). On top of *Auteurswet* art. 11. **Bytes committed.** |
| D-24 | NL–PT tax convention (Verdragenbank / wetten.overheid.nl) | Same basis as above, applied to a treaty text the Dutch state publishes. | ✅ text · ids confirmed |
| D-04, D-33, D-16b | CA federal statutes (Justice Laws) | **Reproduction of Federal Law Order (SI/97-5)** permits reproduction of federal statutes and regulations without permission, provided the reproduction is accurate and is **not represented as the official version**. That disclaimer must appear in the sidecar. |
| D-05 | Ontario ESA 2000 (e-Laws) | Ontario e-Laws carries its own copyright notice, separate from the Open Government Licence – Ontario. ⚠ **Read it before committing bytes**; extract-and-cite until confirmed. | ⛔ class C (JS) |
| D-38 | Consolidated Canadian Autonomous Sanctions List | Crown copyright, canada.ca terms (**see §9**). | ✅ register only |
| D-39 | UN Security Council Consolidated List | **Class (b) was wrong — this is class (c).** un.org's copyright page, read live 2026-08-19: *"Copyright © United Nations **All rights reserved**. None of the materials provided on this web site may be used, reproduced or transmitted … without permission in writing from the publisher."* Cite and link. | ✅ register only |

### (c) Cite and link only — do not commit the bytes

| id | Document | Why |
|---|---|---|
| D-02, D-03, D-10, D-13, D-32 | Portugal — DRE consolidated codes, Lei 23/2007, Portarias | The **statutory text** is outside copyright under the Portuguese Código do Direito de Autor, but the **DRE edition and database** carry their own terms of use held by INCM. Quote the article being acted on, cite the URL, **do not mirror the site**. ⚠ Verify DRE's terms page on retrieval. |
| D-11, D-12 | PT — MNE consular D8 pages; AIMA | **No stated reuse terms known to me.** `KNOWLEDGE-SOURCES.md` L1-07: *"many national portals carry restrictive terms or no stated terms at all. Check per country; do not assume."* Cite-and-link. |
| D-19 | EC Practical Guide on applicable legislation (A1) | **Verified, and it moves to class (a).** The PDF carries **no** copyright notice of its own, and the Commission's legal notice (<https://commission.europa.eu/legal-notice_en>, read live 2026-08-19) says its reuse policy is Decision 2011/833/EU and that *"unless otherwise indicated … content owned by the EU on this website is licensed under **CC BY 4.0**."* Attribution given. | ✅ **bytes** |
| D-21, D-22, D-23, D-25, D-26, D-34, D-16 | canada.ca and treaty-accord.gc.ca pages (CRA folios, Finance treaty texts, social-security agreements, IRCC) | canada.ca terms permit **non-commercial** reproduction with attribution and a not-official disclaimer; **commercial reproduction requires written permission**. A public, career-facing portfolio repository is a grey zone, not a clear non-commercial use. **Be conservative: extract and cite, do not vendor the page.** |

### (d) Paraphrase only, regardless of access — never copied, now or ever

| id | Document | Why |
|---|---|---|
| — | OECD Model Tax Convention and Commentaries | Copyrighted and sold as a publication. **Not a download target and never will be.** This is a *licence* constraint, not an access one: it would hold unchanged if `oecd.org` were reachable tomorrow. Existing register: [`L1-01-L1-11-oecd-citation-register.md`](layer-1-statutory/L1-01-L1-11-oecd-citation-register.md). |
| D-30 | MLI status / matching database (OECD-hosted) | The **fact** of which treaties the MLI modifies is a table with an authority. The OECD's *text and commentary around it* is not ours to copy. Take the status facts, cite the page, copy nothing. | ⛔ n/a — licence (d) |

---

## 4. Index — all 40, by priority

> **D-40 was added 2026-08-20**, after the three retrieval passes this section
> was written for had closed at D-39. It is the only row here that was not part
> of the original plan: it was fetched because reading D-01's *retrieved bytes*
> in full — rather than the two limbs D-01's sidecar quotes — turned up a fifth
> paragraph of BW art. 7:672 that refers the employee's notice period out to an
> article nobody had listed. **A document can generate a new requirement after
> it is retrieved**, and the index has to be able to grow for that reason and
> not only from the original survey.

**BLOCKING** = a demo scenario in the NL/PT/CA/US set is wrong, unciteable, or
silently suppressed without it. **SUPPORTING** = it makes an existing entry
defensible or dated, but no demo breaks.

**Result column, added 2026-08-19 after every URL was called.** ✅ = retrieved ·
◐ = partially retrieved (the administering agency's record, not the instrument's
own text) · ⛔ = not retrieved, with the failure class from §2. "**bytes**" means
the retrieved file is committed under
[`layer-1-statutory/sources/`](layer-1-statutory/sources/); "text · no bytes"
means the licence, or an unread site-terms page, permits a quotation and a
citation but not a copy; "register only" means the licence permits a copy and the
[`RETRIEVAL-BLOCKED.md`](layer-1-statutory/RETRIEVAL-BLOCKED.md) do-not-vendor
rule forbids one anyway.

| id | Document | Country / pair | Feeds | Licence class | Priority | **2026-08-19 result** |
|---|---|---|---|---|---|---|
| D-01 | BW Boek 7 art. 7:672 — employee notice | NL | UC-05 | (b) **CC0** | **BLOCKING** | ✅ **bytes** |
| D-02 | Código do Trabalho art. 400 — denúncia | PT | UC-05 | (c) | **BLOCKING** | ✅ text · gazette PDF |
| D-03 | Código do Trabalho — período experimental | PT | UC-05 | (c) | **BLOCKING** | ✅ text · gazette PDF |
| D-04 | Canada Labour Code, Part III | CA | UC-05 | (b) | **BLOCKING** | ✅ **bytes** |
| D-05 | Ontario Employment Standards Act, 2000 | CA | UC-05 | (b) | **BLOCKING** | ✅ **bytes** (2026-09-02) · ~~class C (JS)~~ — the page is a shell, the JSON endpoint is not |
| D-06 | WARN Act + DOL guidance | US | UC-05 | (a) | **BLOCKING** | ✅ **bytes** |
| D-07 | Schengen Borders Code, Reg. (EU) 2016/399 | NL, PT | UC-04, UC-03 | (a) | **BLOCKING** | ✅ text · no bytes (size) |
| D-08 | Council Decisions — BG/RO Schengen accession | EU set | UC-04 | (a) | SUPPORTING | ✅ **bytes** · id corrected |
| D-09 | Reg. (EU) 2018/1806, Annexes I & II | CA/US → NL/PT | UC-04 | (a) | **BLOCKING** | ✅ **bytes** |
| D-10 | Lei 23/2007 art. 61-B (D8), as amended by Lei 18/2022 | PT | UC-04 | (c) | **BLOCKING ★** | ✅ text · gazette PDF · ids confirmed |
| D-11 | MNE consular D8 requirements | PT | UC-04 | (c) | **BLOCKING** | ✅ text · no bytes |
| D-12 | AIMA remote-work residence permit | PT | UC-04 | (c) | SUPPORTING | ⛔ class D (TLS) |
| D-13 | ~~Portaria fixing the IAS value~~ → the instrument fixing the **RMMG** | PT | UC-04 | (c) | SUPPORTING | ⛔ re-scoped, not retried |
| D-14 | VWP / ESTA permitted activities | US | UC-04 | (a) | **BLOCKING** | ✅ **bytes** · by hand |
| D-15 | B-1 temporary business visitor | US | UC-04 | (a) | **BLOCKING** | ✅ **bytes** · by hand |
| D-16 | Work without a work permit / IRPR s. 186 | CA | UC-04 | (b)/(c) | **BLOCKING** | ✅ **bytes** (s.186 + s.187) |
| D-17 | Reg. (EC) 883/2004 | NL↔PT | UC-04, UC-07, UC-08 | (a) | **BLOCKING** | ✅ **bytes** |
| D-18 | Reg. (EC) 987/2009 | NL↔PT | UC-04, UC-08 | (a) | SUPPORTING | ✅ **bytes** |
| D-19 | EC Practical Guide on applicable legislation (A1) | NL↔PT | UC-04, UC-08 | **(a)** — notice read | SUPPORTING | ✅ **bytes** · CC BY 4.0 |
| D-20 | SSA — Status of Totalization Agreements | US↔NL, US↔PT, US↔CA | UC-04, UC-07, UC-08 | (a) | **BLOCKING ★** | ✅ **bytes** |
| D-21 | Canada's international social security agreements | CA↔* | UC-04, UC-08 | (c) | **BLOCKING** | ✅ text · no bytes |
| D-22 | Canada–Netherlands Agreement on Social Security (+ CPT63) | CA↔NL | UC-04, UC-08 | (c) | **BLOCKING** | ✅ text · **two** agreements · C-24 |
| D-23 | Canada–Portugal Agreement on Social Security (+ CPT55) | CA↔PT | UC-04, UC-08 | (c) | **BLOCKING** | ✅ text · confirms 24 months |
| D-24 | Netherlands–Portugal double-tax convention | NL–PT | UC-04, UC-08 | (b) | **BLOCKING** | ✅ text · ids confirmed |
| D-25 | Canada–Netherlands income tax convention | CA–NL | UC-04, UC-08 | (c) | **BLOCKING** | ✅ text · no bytes |
| D-26 | Canada–Portugal income tax convention | CA–PT | UC-04, UC-08 | (c) | **BLOCKING** | ✅ text · no bytes |
| D-27 | US–Netherlands income tax convention (IRS) | US–NL | UC-04, UC-08 | (a) | **BLOCKING** | ✅ **bytes** |
| D-28 | US–Portugal income tax convention (IRS) | US–PT | UC-04, UC-08 | (a) | **BLOCKING** | ✅ **bytes** |
| D-29 | US–Canada income tax convention (IRS) | US–CA | UC-04, UC-08 | (a) | **BLOCKING** | ✅ **bytes** |
| D-30 | MLI status / matching | all six pairs | UC-08 | (d) | SUPPORTING | ⛔ n/a — licence (d) |
| D-31 | AWR art. 4 — fiscale woonplaats | NL | UC-08 | (b) **CC0** | **BLOCKING** | ✅ **bytes** |
| D-32 | CIRS art. 16 — residência | PT | UC-08 | (c) | **BLOCKING** | ✅ text · via the AT |
| D-33 | Income Tax Act s. 250 — deemed resident | CA | UC-08 | (b) | **BLOCKING** | ✅ **bytes** |
| D-34 | CRA Folio S5-F1-C1 — residence status | CA | UC-08 | (c) | SUPPORTING | ✅ text · no bytes |
| D-35 | Substantial presence test / Pub. 519 | US | UC-08 | (a) | **BLOCKING** | ✅ **bytes** |
| D-36 | OFAC sanctions programs & country information | US regime | UC-03, UC-04 | (a) | **BLOCKING** | ✅ register only |
| D-37 | EU consolidated financial-sanctions list / Sanctions Map | EU regime | UC-03, UC-04 | (a) | **BLOCKING** | ✅ register only (API) |
| D-38 | Consolidated Canadian Autonomous Sanctions List | CA regime | UC-03, UC-04 | (b) | **BLOCKING** | ✅ register only |
| D-39 | UN Security Council Consolidated List | UN regime | UC-03, UC-04 | **(c)** — corrected | SUPPORTING | ✅ register only |
| D-40 | BW Boek 7 art. 628a — on-call carve-out from art. 672(5) | NL | UC-05 | (b) **CC0** | **BLOCKING** | ✅ **bytes** (2026-08-20) |
| D-41 | Employment Rights Act 1996 s. 86 — employer *and* employee notice | GB | UC-05 | (b) **OGL v3.0** | **BLOCKING ★** | ✅ **bytes** (2026-09-02) · **C-31** |
| D-42 | Minimum Notice and Terms of Employment Act 1973 ss. 4, 6 | IE | UC-05 | (b) **Oireachtas Open Data PSI / CC BY 4.0** | **BLOCKING** | ✅ **bytes** (2026-09-02) · enacted + revised · **C-32** |
| D-43 | Kodeks pracy arts. 30 § 2¹, 32, 34, 36 | PL | UC-05 | (b) — no copyright in normative acts, *pr. aut.* art. 4 | **BLOCKING** | ✅ text · gazette PDF · no bytes (2.0 MB) · **C-33**, **C-34**, **K-5** |
| D-44 | Code civil du Québec arts. 2091–2092 — *délai de congé* | CA (QC) | UC-05 | (c) | **BLOCKING ★** | ✅ text · no bytes (5.8 MB, terms unread) · **C-35** |
| D-45 | ~~BGB § 622~~ → BMAS *Arbeitsrecht* (agency substitute) | DE | UC-05 | (c) | **BLOCKING** | ⚠ **statute NOT retrieved** — `gesetze-im-internet.de` does not answer TCP. Agency text only, `[AGENCY]`. **K-6** |

**★ = fetch these two first.** D-10 is the highest-value single document in the
manifest (it is the only authority behind a control that *removes* a check).
D-20 is the highest value per unit of effort (public domain, one page, closes a
build-time task the repo has carried as `[PROPOSED]` since UC-04 was written).

---

## 5. Group A — employment termination and notice (UC-05)

> **The finding that frames this whole group: `NOTICE_PERIOD_TABLE` covers
> `GB IE DE PL IN PH MX CA PT`. Two of the four demo countries — the
> Netherlands and the United States — are not in it at all.** So an NL or US
> resignation does not produce a wrong number; it produces
> `unsupported_country` and escalates. That is the correct behaviour and it is
> also a demo that cannot run. `getNoticeRule()` returns `null` for both, as
> read 2026-08-19.

### D-01 · Netherlands — employee notice period

- **Authority.** Ministerie van Justitie en Veiligheid, via **Overheid.nl /
  wetten.overheid.nl**. Instrument: Burgerlijk Wetboek Boek 7, Titel 10,
  Afdeling 9, artikel 672 (`BWBR0005290`).
- **URL.** <https://wetten.overheid.nl/BWBR0005290/> — navigate to Boek 7 →
  Titel 10 → Afdeling 9 → Artikel 672. A per-article printable form of the
  shape
  `https://wetten.overheid.nl/BWBR0005290/<date>/0/Boek7/Titeldeel10/Afdeling9/Artikel672/afdrukken`
  was returned by a search index; **the date segment in it is a version
  selector and the indexed one is old — pick the current consolidation from the
  site, do not reuse a stale date.**
  **URL VERIFIED — called 2026-08-19, HTTP 200, 20,336 bytes.** Retrieved; the
  article text is in [`layer-1-statutory/D-01-nl-notice-bw-7-672.md`](layer-1-statutory/D-01-nl-notice-bw-7-672.md).
  The date segment IS a version selector, as suspected: `2026-08-19` in that
  position returns **404**, `2026-01-01` returns 200. The whole-Boek-7 page
  (`/BWBR0005290/2025-01-01/`) also returns 200, 755,868 bytes, with identical
  article text. **No bytes committed** — `www.overheid.nl`, which hosts the
  site's reuse-terms page, is egress-refused, so the site-terms half of licence
  class (b) is still unread and the manifest's own safe default applies.
- **Save as.** `docs/knowledge/layer-1-statutory/D-01-nl-notice-bw-7-672.md`
  (+ `sources/D-01-nl-notice-bw-7-672.html` if the terms permit).
- **Consumed by.** UC-05 → `src/uc05/noticePeriodTable.js`, a new
  `NOTICE_PERIOD_TABLE.NL` entry: `brackets`, `probation`, `anchorRule` and
  `basis`. Also UC-07 (offboarding lead times).
- **What is wrong today without it.** **There is no NL row.** A Dutch
  resignation reaches `getNoticeRule("NL") === null`, the policy engine returns
  `unsupported_country`, and the request escalates. Nothing is *wrong* — but the
  Netherlands is a demo country and UC-05 cannot decide a single Dutch case.
  Note also that art. 7:672 sets **different periods for the employer and the
  employee**, and this table models only the employee's obligation; whoever
  writes the row has to read the article for which limb applies rather than
  taking the first number they see. There is additionally an end-of-month
  anchor concept in Dutch practice that would map to `anchorRule` — the table
  already has `month_end` in its type union and nothing uses it.
- **Licence.** Class **(b)**. Dutch *Auteurswet* art. 11 excludes copyright
  from laws and official decrees published by or on behalf of public authority.
  Overheid.nl states its own reuse terms on the site. ⚠ **Read the terms page
  at retrieval; I could not.** Safe default until then: quote the article,
  cite the URL, do not commit the page.
- **Priority. BLOCKING.**

### D-40 · Netherlands — the on-call carve-out art. 672(5) points at

> **Added 2026-08-20, and it is the only entry in this manifest generated by
> another entry rather than by the original survey.** D-01 was retrieved, its
> bytes committed, and its sidecar quoted arts. 672(1), (2), (4) and (8) —
> everything anyone had thought to look for. Reading the *committed bytes* of
> the whole article turned up **lid 5**, which disapplies both of the limbs the
> NL row was about to be built on, and refers out to an article no list
> contained. Worth stating as a method note: **retrieving a document is not the
> same as having read it**, and the gap between the two is invisible from
> outside because both produce a green provenance header.

- **Authority.** Ministerie van Justitie en Veiligheid, via **Overheid.nl /
  wetten.overheid.nl** (operated by **KOOP**). Instrument: Burgerlijk Wetboek
  Boek 7, Titel 10, **Afdeling 2 (Loon), artikel 628a** (`BWBR0005290`).
- **URL.** <https://wetten.overheid.nl/BWBR0005290/2026-01-01/0/Boek7/Titeldeel10/Afdeling2/Artikel628a/afdrukken>
  **URL VERIFIED — called 2026-08-20, HTTP 200, 21,853 bytes**, SHA-256
  `61aaf6c459e6569d2791a51fcd0c6671b73aef2a809b347b7d084051997829ad`.
  Note the **Afdeling 2**, not Afdeling 9: art. 628a sits under *Loon*, and the
  Afdeling 9 path D-01 uses returns **HTTP 200 with a chrome-only page and no
  article in it** for this article number. A 200 that contains no document is
  the class-C signature from `RETRIEVAL-BLOCKED.md` §1 arriving from a wrong
  path rather than from a JavaScript shell — check the body for the article
  heading, never the status code alone.
- **Save as.** `docs/knowledge/layer-1-statutory/D-40-nl-oncall-bw-7-628a.md`
  (+ `sources/D-40-nl-oncall-bw-7-628a.html`). **Both committed.**
- **Consumed by.** UC-05 → `src/uc05/decisionSources.js`, as a caveat cited on
  every Dutch decision. **Deliberately not consumed by
  `src/uc05/noticePeriodTable.js` as a branch** — see below.
- **What it settles.** A Dutch employee's notice is one month (art. 672(4))
  **only where the volume of work is fixed**. Where it is not — an
  `oproepovereenkomst` as art. 628a(9) defines it — art. 672(5) makes the notice
  the term in art. 628a(2), which is **four days**, reducible by collective
  agreement under art. 628a(4) to **no less than 24 hours**, and it disapplies
  the end-of-month anchor entirely. One month against four days is a factor of
  roughly seven, in the direction that overstates what a resigning worker owes.
- **Why it is a caveat and not a gate.** Art. 628a(9) turns on whether the hours
  volume is fixed as a single number per period, or on a pay-entitlement limb
  with no hours figure at all. **Nothing on the Remote employment record answers
  either.** `contract_type` carries `full_time`/`part_time`/`contractor`, a
  different question; `work_hours_per_week` is not the statutory test and using
  it would be a proxy this repository invented — the failure `CONTRADICTIONS.md`
  C-16, C-25 and C-27 each name elsewhere. Recorded as **C-28**.
- **Licence.** Class **(b) — CC0 1.0.** Same corpus, same publisher and the same
  basis as D-01 and D-31: KOOP's **Basis Wetten Bestand** entry in the national
  open-data register states CC0 1.0, on top of *Auteurswet* art. 11. **Bytes
  committed.**
- **Priority. BLOCKING** — the NL row is a demo-country row, and it states a
  quantity this document is the only thing bounding.

### D-02 · Portugal — employee notice on resignation

- **Authority.** **Diário da República Eletrónico** (INCM), for Lei n.º 7/2009
  — Código do Trabalho, **artigo 400.º** (denúncia pelo trabalhador).
- **URL.** <https://diariodarepublica.pt/dr/legislacao-consolidada/lei/2009-34546475-46767375>
  (the consolidated art. 400 page). Parent consolidated code:
  <https://diariodarepublica.pt/dr/legislacao-consolidada/lei/2009-34546475>.
  **RETRIEVED 2026-08-19 (third pass) — but not from this URL.** Every DRE HTML
  route still returns a 2,346-byte JavaScript shell. **`files.diariodarepublica.pt`
  serves the gazette itself as static PDF**, and Lei 7/2009 is in
  <https://files.diariodarepublica.pt/gratuitos/1s/2009/02/03000.pdf> (HTTP 200,
  973,659 bytes, 116 pages), with the amending Lei n.º 13/2023 in
  `/gratuitos/1s/2023/04/06600.pdf`. **Result: the 30/60-day brackets are
  confirmed verbatim, and the `tenureMaxMonths: 23` boundary is WRONG** — art.
  400.º(1) splits on *"até dois anos ou mais de dois anos"*, so at exactly 24
  months the statute says 30 days and the table says 60 (**C-18**). Three further
  dimensions the table cannot express are in
  [`layer-1-statutory/D-02-pt-notice-ct-art-400.md`](layer-1-statutory/D-02-pt-notice-ct-art-400.md).
- **Save as.** `docs/knowledge/layer-1-statutory/D-02-pt-notice-ct-art-400.md`
  — **sidecar only, no bytes** (class (c)).
- **Consumed by.** UC-05 → `src/uc05/noticePeriodTable.js`,
  `NOTICE_PERIOD_TABLE.PT.brackets` — the two tenure brackets that today read
  `{0–23 months → 30 days}` and `{24+ months → 60 days}`.
- **What is wrong today without it.** **Two uncited numbers and a boundary
  nobody has checked.** The row's only provenance is the string
  `sourceCitation: "Código do Trabalho art. 400 (30 / 60 days by tenure;
  probation reduced)"` — a citation with **no URL, no version, and no
  retrieved-on date**, so a reviewer cannot check a figure and nobody can tell
  when it went stale. The file's own header says the quiet part out loud:
  *"EVERY FIGURE HERE IS A SIMPLIFICATION OF PUBLIC STATUTORY PROVISIONS.
  Nothing in this file has been verified by a labour lawyer, and the numbers
  should not be quoted to a customer."* Portugal is the demo country whose
  numbers actually get computed, so this is the row a reviewer is most likely
  to check first. Specifically unresolved and needing the text: whether the
  bracket boundary is tenure **below/at/above two years** as the code's
  `tenureMaxMonths: 23` assumes, and whether the periods are calendar days as
  `unit: "calendar"` assumes.
- **Licence.** Class **(c)** — cite and link. The statutory text itself falls
  outside copyright under the Portuguese Código do Direito de Autor, but the
  **DRE edition and database** carry INCM's own terms of use. Quote the article
  being relied on; do not mirror. ⚠ Verify DRE's terms page on retrieval.
- **Priority. BLOCKING.**

### D-03 · Portugal — probationary-period notice

- **Authority.** Diário da República Eletrónico — Código do Trabalho, the
  *período experimental* articles (the denúncia-during-probation provision;
  in the current consolidation this sits in the arts. 111–114 range).
- **URL.** <https://diariodarepublica.pt/dr/legislacao-consolidada/lei/2009-34546475>
  — **navigate from the consolidated code's own contents to the período
  experimental section. I am deliberately not guessing a per-article id**: the
  DRE per-article URLs are opaque numeric suffixes (art. 400 is
  `-46767375`, art. 90 is `-211442188`), they cannot be derived from the
  article number, and inventing one would produce exactly the plausible dead
  link this manifest exists to avoid.
  **RETRIEVED 2026-08-19 (third pass), via the same gazette PDF as D-02** — and
  deliberately guessing no per-article id turned out not to matter, because the
  gazette carries the whole code in article order. **The open question is
  answered, and the answer is the bad one the entry predicted:** art. 114.º
  scales notice with elapsed probation (0 → 7 → 30 days at the 60- and 120-day
  marks) **and every one of those figures is the employer's**; the employee owes
  **zero**. The table's 15 is also the *repealed* 2009 figure, raised to 30 by
  Lei n.º 13/2023. See **C-20** and
  [`layer-1-statutory/D-03-pt-probation-notice.md`](layer-1-statutory/D-03-pt-probation-notice.md).
- **Save as.** `docs/knowledge/layer-1-statutory/D-03-pt-probation-notice.md`
  — sidecar only.
- **Consumed by.** UC-05 → `NOTICE_PERIOD_TABLE.PT.probation`, which today
  reads `{ tenureMinMonths: 0, tenureMaxMonths: 5, noticeDays: 15 }`, and
  `pickBracket()`, where a probation rule **replaces** the regular bracket
  rather than adding to it.
- **What is wrong today without it.** A flat 15-day probation figure with no
  source. This is the entry where the manifest most clearly exists *because we
  do not know*: the code models probation notice as **one number for the whole
  probation period**, and it is an open question — answerable only by reading
  the article — whether the statute instead scales the notice with **how much
  probation has already elapsed**. If it does, the table's shape is wrong, not
  just its number, and no test in this repository would ever notice: the
  fixture and the code agree with each other and neither has been compared to
  Portugal. That is `CLAUDE.md` §4's named through-line, in a new place.
- **Licence.** Class **(c)** — as D-02.
- **Priority. BLOCKING.**

### D-04 · Canada — federal labour standards

- **Authority.** Department of Justice Canada, **Justice Laws Website**.
  Instrument: Canada Labour Code, R.S.C. 1985, c. L-2, **Part III**.
- **URL.** <https://laws-lois.justice.gc.ca/eng/acts/L-2/> — and the individual
  termination provision at
  <https://laws-lois.justice.gc.ca/eng/acts/L-2/section-230.html>.
  **URL VERIFIED — called 2026-08-19, HTTP 200, 47,523 bytes stored.**
  Retrieved, bytes committed at
  [`layer-1-statutory/sources/D-04-ca-canada-labour-code-s230.html`](layer-1-statutory/sources/D-04-ca-canada-labour-code-s230.html)
  under SI/97-5, whose text was **also retrieved and quoted in full**
  (<https://laws-lois.justice.gc.ca/eng/regulations/SI-97-5/page-1.html>, 200) —
  it turns out to draw no commercial/non-commercial distinction, unlike the
  canada.ca terms. Page prints its own currency line: *"Act current to 2026-06-17
  and last amended on 2025-12-12."*
- **Save as.** `docs/knowledge/layer-1-statutory/D-04-ca-canada-labour-code-part-iii.md`
  (+ `sources/…html` — class (b) permits it, with the disclaimer).
- **Consumed by.** UC-05 → `NOTICE_PERIOD_TABLE.CA`, specifically the
  `basis: "customary"` field and the claim carried in its `sourceCitation`
  string: *"Common-law customary notice (no statutory employee minimum; varies
  by province)"*.
- **What is wrong today without it.** **This is the entry where the claim needs
  a source more than the numbers do.** The CA row is the only row in the whole
  table with `basis: "customary"`, and it asserts a **negative**: that no
  statutory employee-side minimum exists. A negative is the hardest thing in
  this manifest to source and the easiest thing to assert — nothing downstream
  can contradict it, which is precisely `KNOWLEDGE-SOURCES.md`'s Test B. Today
  the assertion rests on a code comment. Alongside it sit invented customary
  figures (`0 / 7 / 14` days by tenure) that the file itself concedes are
  illustrative. **Sourcing the negative requires reading the statute for what
  it does *not* impose** — which is why this needs the Part III text and not a
  summary of it, and why it needs D-05 as well: federal labour standards cover
  only federally regulated industries, so "no federal minimum" is not the same
  claim as "no minimum in Canada."
- **Licence.** Class **(b)**. The **Reproduction of Federal Law Order
  (SI/97-5)** permits reproduction of federal statutes and regulations without
  permission, provided the reproduction is accurate and **not represented as the
  official version**. That disclaimer must appear in the sidecar.
- **Priority. BLOCKING.**

### D-05 · Canada — provincial employment standards (Ontario)

- **Authority.** Government of Ontario, **e-Laws**. Instrument: Employment
  Standards Act, 2000, S.O. 2000, c. 41.
- **URL.** <https://www.ontario.ca/laws/statute/00e41>
  **URL REACHED, DOCUMENT NOT RETRIEVED — called 2026-08-19, HTTP 200,
  JavaScript application shell** (*"e-Laws needs JavaScript to function
  properly"*). `www.ontario.ca` is reachable. `/00e41/v54`, `/00e41/print`,
  `/00e41/xml` and `?_escaped_fragment_=` all return the identical shell;
  `/api/statute/00e41` returns 502. The provincial half of the Canadian
  negative stays unsourced. **Unchanged in the third pass** — and note that the
  *other* class-C blockage, Portugal's DRE, fell to a static-PDF channel on a
  sibling host (`files.diariodarepublica.pt`). No equivalent has been found for
  e-Laws, but "class C" is a statement about a delivery channel, not about an
  authority, so it is worth a fresh look for one before assuming a browser is
  required.
- **Save as.** `docs/knowledge/layer-1-statutory/D-05-ca-on-employment-standards-act.md`.
- **Consumed by.** UC-05 → the same `NOTICE_PERIOD_TABLE.CA` row, and the
  `"varies by province"` half of its citation string.
- **What is wrong today without it.** The Canadian row is a **single national
  row for a country whose employment standards are provincial**, and the code
  says so in a comment while modelling it as one set of brackets. Ontario is
  the largest single jurisdiction and is the honest minimum evidence for the
  claim; **one province is not proof about ten, and the sidecar must say that
  in those words** rather than letting one statute stand in for the country.
  Without D-05 the demo's Canadian scenario rests on an assertion with neither
  a federal nor a provincial source behind it.
- **Licence.** Class **(b)**, with a caveat: Ontario e-Laws carries its own
  copyright notice, distinct from the Open Government Licence – Ontario.
  ⚠ **Read it before committing bytes.** Extract-and-cite until confirmed.
- **Priority. BLOCKING.**

### D-06 · United States — evidence that no employee notice statute exists

- **Authority.** U.S. Department of Labor, Employment and Training
  Administration. Instrument: Worker Adjustment and Retraining Notification
  (WARN) Act, 29 U.S.C. ch. 23, and DOL's compliance guidance.
- **URL.** <https://www.dol.gov/agencies/eta/layoffs/warn> and
  <https://www.dol.gov/general/topic/termination/plantclosings>
  **URLS VERIFIED — both called 2026-08-19, HTTP 200.** Retrieved and committed
  (73,130 and 69,193 bytes stored). `www.dol.gov` refuses a bare `curl` with a
  `403` and answers 200 to a complete browser header set — see
  `layer-1-statutory/RETRIEVAL-BLOCKED.md` §2. **Neither page prints a
  last-updated date.**
- **Save as.** `docs/knowledge/layer-1-statutory/D-06-us-warn-act-and-notice-absence.md`
  (+ `sources/…` — public domain, commit freely).
- **Consumed by.** UC-05 → a new `NOTICE_PERIOD_TABLE.US` row, which does not
  exist today.
- **What is wrong today without it.** The US is now the largest country in the
  demo Sandbox and **UC-05 has no US row at all** — `getNoticeRule("US")`
  returns `null` and every US resignation escalates as `unsupported_country`.
  The US is the second instance of the same hard problem as Canada (D-04):
  the claim to be sourced is an **absence**. WARN is the document that most
  clearly delimits what US federal law *does* require — advance notice from
  **employers** at scale, on plant closings and mass layoffs — and therefore
  what it does not require from a resigning employee. **Sourcing "no federal
  employee-notice statute" from WARN is an argument from scope, and the sidecar
  must present it as one**, not as a citation that says so directly. State-level
  variation is a further open question this document does not close.
- **Licence.** Class **(a)** — US federal government work, public domain.
  Commit in full.
- **Priority. BLOCKING.**

---

## 6. Group B — borders, immigration, and the right to work (UC-03, UC-04)

### D-07 · Schengen Borders Code — the 90/180 rule

- **Authority.** European Parliament and Council of the EU, via **EUR-Lex**.
  Instrument: Regulation (EU) 2016/399, art. 6(1) (entry conditions and the
  90-days-in-any-180 short-stay allowance).
- **URL.** <https://eur-lex.europa.eu/eli/reg/2016/399/oj/eng> — and take the
  **consolidated** version, whose ELI form is
  `https://eur-lex.europa.eu/eli/reg/2016/399/<yyyy-mm-dd>/eng`. **Use the site
  to pick the current consolidation date; do not reuse one from this file.**
  **URL VERIFIED — called 2026-08-19, HTTP 200.** The ELI base resolves and
  lists three consolidations, the newest **2025-10-12**; the consolidated text
  was taken via
  <https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:02016R0399-20251012>
  (200, 5,553,887 bytes). **Bytes not committed on size grounds, not licence
  grounds** — see [`layer-1-statutory/D-07-eu-schengen-borders-code-2016-399.md`](layer-1-statutory/D-07-eu-schengen-borders-code-2016-399.md),
  which quotes Article 6 in full. EUR-Lex's legal notice was also read live and
  adds a condition the manifest did not have: **consolidated texts carry CC BY
  4.0** for their editorial layer.
- **Save as.** `docs/knowledge/layer-1-statutory/D-07-eu-schengen-borders-code-2016-399.md`
  (+ `sources/…` — commit in full).
- **Consumed by.** UC-04 → `src/uc04/riskMatrix.js`: the `SCHENGEN` set
  (29 codes, incl. NL and PT) and the block that computes a trailing 180-day
  window from the trip start and raises `schengen_90_180_exceeded` /
  `schengen_overstay` past 90 days. Restated to the specialist by
  `src/uc04/decisionFacts.js` via `SCHENGEN_WINDOW_DAYS = 180` /
  `SCHENGEN_LIMIT_DAYS = 90`. UC-03's router reads the same predicate.
- **What is wrong today without it.** Two hard-coded numbers and a 29-country
  set, none of them dated. The code comment says *"statutory, not invented"* —
  which is true and is **not a citation**. `KNOWLEDGE-SOURCES.md` L1-05 names
  the exact gap: the set *"needs a dated source line saying as of when."*
  Today a specialist reading "within the 90/180 limit" cannot tell whether the
  system applied the current rule or a remembered one, and nothing in the repo
  would notice if the membership set drifted.
- **Licence.** Class **(a)** — EUR-Lex reuse under **Commission Decision
  2011/833/EU**, with attribution. Reproducible in full, commercially included.
  The cleanest licence available for any non-US document here.
- **Priority. BLOCKING.**

### D-08 · Bulgaria and Romania — full Schengen accession

- **Authority.** Council of the European Union, via EUR-Lex. Two instruments:
  the 2023 decision lifting air and sea internal border controls, and the
  December 2024 decision lifting land border controls from 1 January 2025.
- **URL.** Search EUR-Lex for the Council Decisions rather than a guessed ELI.
  The ELI shape is `https://eur-lex.europa.eu/eli/dec/<year>/<number>/oj/eng`;
  I attempted `.../eli/dec/2024/3206/oj/eng` and `.../eli/dec/2024/210/oj/eng`
  and reached neither, **and I have not confirmed either number is the right
  instrument.** The Council's own press page
  <https://www.consilium.europa.eu/en/press/press-releases/2024/12/12/schengen-council-decides-to-lift-land-border-controls-with-bulgaria-and-romania/>
  is a reliable route to the correct celex/ELI reference, but **a press release
  is not the instrument and must not be cited as one.**
  **URLS VERIFIED, AND ONE OF THE GUESSES WAS WRONG — called 2026-08-19.**
  `CELEX:32024D0210` returns 200 and **is** the air-and-sea decision.
  `CELEX:32024D3196` returns **404**. `CELEX:32024D3206` returns 200 and is a
  **Council Implementing Decision authorising Latvia to derogate from the VAT
  Directive** — nothing to do with Schengen. The land-border instrument is
  **Council Decision (EU) 2024/3212**, found through EUR-Lex's own search. Both
  correct decisions retrieved and committed. The Council press page was **not**
  needed and is in any case behind a JavaScript browser check.
- **Save as.** `docs/knowledge/layer-1-statutory/D-08-eu-schengen-bg-ro-accession.md`.
- **Consumed by.** UC-04 → the dated source line on the `SCHENGEN` set in
  `src/uc04/riskMatrix.js`.
- **What is wrong today without it.** `SCHENGEN` already contains `BG`, `HR`
  and `RO`. Those entries are **correct as far as anyone can tell and
  completely unsourced** — the set records membership without recording *as of
  when*, so it can only ever be checked by someone who already knows the
  answer. Marginal for the NL/PT/CA/US demo (no scenario turns on Bulgaria),
  which is why it is SUPPORTING; it matters because it is the cheapest way to
  give the set a version.
- **Licence.** Class **(a)** — EUR-Lex reuse, 2011/833/EU.
- **Priority. SUPPORTING.**

### D-09 · Visa requirement and exemption annexes

- **Authority.** European Parliament and Council, via EUR-Lex. Instrument:
  Regulation (EU) 2018/1806, **Annex I** (third countries whose nationals need
  a visa) and **Annex II** (those exempt for short stays).
- **URL.** <https://eur-lex.europa.eu/eli/reg/2018/1806/oj/eng> — take the
  consolidated version for the current annexes.
  **URL VERIFIED — called 2026-08-19, HTTP 200.** The ELI base lists eight
  consolidations, the newest **2025-12-30**; taken via
  <https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:02018R1806-20251230>
  (200, 139,945 bytes). Retrieved and **committed in full, annexes included**.
- **Save as.** `docs/knowledge/layer-1-statutory/D-09-eu-visa-annexes-2018-1806.md`
  (+ `sources/…` — commit in full, annexes included).
- **Consumed by.** UC-04 → **a table that does not exist yet.** The gate that
  needs it is the Schengen block in `src/uc04/riskMatrix.js`, which is
  conditioned on `nationality` being present but never on what that nationality
  entitles the traveller to.
- **What is wrong today without it.** The 90/180 gate **conflates "is in the
  Schengen area" with "this nationality may enter visa-free"**, and the only
  thing standing in for the second is the requester's **self-declared
  `visaType`**. A claimed `schengen_short_stay` from a nationality that in fact
  needs a visa passes as low risk. This is directly reachable in the new
  four-country demo: a Canadian or US national travelling to the Netherlands or
  Portugal is exactly the Annex II case the system currently takes on trust.
  `KNOWLEDGE-SOURCES.md` L1-06 lists this table as **absent from the repository
  entirely** — a named gap, not an oversight waiting to be discovered.
- **Licence.** Class **(a)** — EU primary law, EUR-Lex reuse, annexes included.
- **Priority. BLOCKING.**

### D-10 · ★ Portugal — the D8 digital-nomad visa

> **The single most valuable document in this manifest**, because it is the only
> authority behind a control that **removes** a check rather than adding one.

- **Authority.** Assembleia da República / Diário da República Eletrónico —
  **Lei n.º 23/2007** (regime de entrada, permanência, saída e afastamento de
  estrangeiros), the article establishing the residence visa for remote
  professional activity, inserted by **Lei n.º 18/2022**. Administering bodies:
  **AIMA** (Agência para a Integração, Migrações e Asilo — successor to SEF)
  and, for the visa itself, the **Ministério dos Negócios Estrangeiros**
  consular network.
- **URL.** The consolidated Lei 23/2007 on DRE, and the amending Lei 18/2022:
  <https://diariodarepublica.pt/dr/legislacao-consolidada/lei/2007-34444975>
  and <https://diariodarepublica.pt/dr/detalhe/lei/18-2022-186438444>.
  **RETRIEVED 2026-08-19 (third pass).** Both guessed ids were wrong and the
  corrected ones — from the MNE's own *National Legislation* link list —
  identified the instrument well enough to find its gazette issue: **Lei n.º
  18/2022 is at pp. 2–137 of Diário da República n.º 164/2022, 1.ª série**,
  served as
  <https://files.diariodarepublica.pt/gratuitos/1s/2022/08/16400.pdf> (HTTP 200,
  12,989,119 bytes, 145 pages). Art. 61.º-B is at p. 25 and again at p. 60 in
  the annexed republication. Every DRE **HTML** route is still a JavaScript
  shell. **The article is one paragraph and contains no income floor, no
  duration and no insurance requirement** — the conditions live in art. 52.º, a
  *portaria*, and consular practice (**C-17**). The same law also creates a
  **temporary-stay** remote-work visa at art. 54.º(1)(i), statutorily capped at
  *"período inferior a um ano"*. See
  [`layer-1-statutory/D-10-pt-d8-lei-23-2007-art-61b.md`](layer-1-statutory/D-10-pt-d8-lei-23-2007-art-61b.md).
- **Save as.** `docs/knowledge/layer-1-statutory/D-10-pt-d8-lei-23-2007-art-61b.md`
  — sidecar only.
- **Consumed by.** UC-04 → `DNV_COUNTRIES` in `src/uc04/riskMatrix.js`, of
  which `PT` is a member, and `DNV_COUNTRIES_PROVENANCE`, which is exported for
  the express purpose of printing the gap beside the decision.
- **What is wrong today without it.** **Membership of `DNV_COUNTRIES` does not
  add a check — it suppresses one.** The Schengen 90/180 block is skipped
  entirely when the destination is in that set, so a wrong entry does not make
  UC-04 more cautious, it makes it **silently less** cautious, and the resulting
  run looks exactly like a trip that was assessed and cleared. The set is five
  hand-written codes (`EE PT RO CR MX`). The repository already states, in
  code, what it has: `DNV_COUNTRIES_PROVENANCE` sets `authority: null`,
  `version: null`, `reviewedOn: null`, and describes its own basis as *"A
  curated five-entry list carried in src/uc04/riskMatrix.js. No publishing
  authority, no version, no review date, and no record of the income or duration
  thresholds each scheme actually imposes."*

  **This is not an abstract gap in the four-country demo — it is the demo.**
  Portugal is one of the four countries and the only one in `DNV_COUNTRIES`. A
  workation routed to Portugal *is* a demonstration of that suppression firing.
  The same table's own `needsForAVersionedTable` list names what a sourced
  version requires, and this document is the first three of the four: a named
  publishing authority (AIMA / the consular authority), a version or publication
  date for the scheme as read, and **the scheme's own thresholds — income floor,
  insurance, maximum duration — so that membership becomes a condition the
  request is checked against rather than a blanket exemption.** The fourth, a
  review date and a named owner, is a staffing answer this document cannot
  supply.

  **What this manifest does not do, deliberately:** it names no income figure,
  no duration and no insurance requirement, because nobody in this chain has
  read the instrument. The manifest exists *because* we do not know them.
- **Licence.** Class **(c)** — cite and link. Statutory text outside copyright;
  DRE's edition and database carry INCM's terms.
- **Priority. BLOCKING ★ — fetch first.**

### D-11 · Portugal — the D8's actual conditions, as the consular network states them

- **Authority.** Ministério dos Negócios Estrangeiros, **Portal das
  Comunidades / vistos.mne.gov.pt** — the visa application requirements page
  for the residence visa for remote work.
- **URL.** <https://vistos.mne.gov.pt/> — navigate to national visas →
  residence visas → the remote-work category. **I attempted a deep link
  (`/en/national-visas/necessary-documents/residence-visa-for-remote-work`) and
  could not reach it, and could not corroborate that path from any index.
  Do not trust it — start from the site root.**
  **RETRIEVED — called 2026-08-19, HTTP 200 for the site root and five inner
  pages.** The manifest's guessed deep link does not exist; starting from the
  root, as instructed, was correct. The pages read were *Type of Visa*,
  *Necessary Documentation — Residency*, *— Temporary Stay*, *Means of
  subsistence* and *National Legislation*. **This is the entry that produced the
  most new information in the whole pass** — see
  [`layer-1-statutory/D-11-pt-d8-consular-requirements.md`](layer-1-statutory/D-11-pt-d8-consular-requirements.md).
  Cite-and-link honoured; no bytes committed. **No page prints any date.**
- **Save as.** `docs/knowledge/layer-1-statutory/D-11-pt-d8-consular-requirements.md`
  — sidecar only.
- **Consumed by.** UC-04 → the same `DNV_COUNTRIES` suppression, and the
  thresholds `DNV_COUNTRIES_PROVENANCE.needsForAVersionedTable` asks for.
- **What is wrong today without it.** D-10 gives the legal basis; **this gives
  the numbers a gate could actually check.** Without it, "Portugal runs a DNV"
  remains a boolean with nothing behind it, and the request is never tested
  against the scheme's own conditions — so an applicant who would not qualify
  for a D8 still gets the D8-based exemption from the Schengen check. Note that
  the income floor for these schemes is commonly expressed as a **multiple of a
  statutory index rather than an absolute figure**, which is why D-13 is a
  separate document: an absolute number captured today goes stale on a schedule
  set by a different instrument.
- **Licence.** Class **(c)** — **no stated reuse terms known to me.**
  `KNOWLEDGE-SOURCES.md` L1-07: *"many national portals carry restrictive terms
  or no stated terms at all. Check per country; do not assume."* Cite and link;
  do not commit the page.
- **Priority. BLOCKING.**

### D-12 · Portugal — AIMA residence permit for remote work

- **Authority.** **AIMA, I.P.** (Agência para a Integração, Migrações e Asilo).
- **URL.** <https://aima.gov.pt/> — navigate to residence permits.
  **URL NOT RETRIEVED — a fourth failure class, and not the one expected.**
  Called 2026-08-19: the proxy `CONNECT` **succeeds** (`HTTP/1.1 200 Connection
  Established`), so the host is allowlisted, and TLS then fails with
  `curl: (60) SSL certificate problem: unable to get local issuer certificate`.
  `aima.gov.pt` serves an **incomplete certificate chain**. Not a policy denial,
  not a bot block. Retried with the proxy CA bundle explicitly; same result.
  **Verification was not disabled to get round it.**
- **Save as.** `docs/knowledge/layer-1-statutory/D-12-pt-aima-remote-work-permit.md`.
- **Consumed by.** UC-04 → the `authority` field that
  `DNV_COUNTRIES_PROVENANCE` currently holds as `null`.
- **What is wrong today without it.** The provenance record names *"Portugal
  AIMA (D8)"* as the authority it needs and holds `authority: null` because
  nobody has cited it. This is the document that fills that field and
  distinguishes the **visa** (a consular instrument, D-11) from the **residence
  permit** (an AIMA instrument) — a distinction the code does not currently
  make and which determines what a long workation actually converts into.
- **Licence.** Class **(c)** — no stated terms known. Cite and link.
- **Priority. SUPPORTING.**

### D-13 · Portugal — the statutory index the income floor is expressed in

- **Authority.** Governo de Portugal, via Diário da República — the Portaria
  fixing the value of the **IAS** (Indexante dos Apoios Sociais) for the
  current year.
- **URL.** Find the current year's Portaria through DRE's search for `IAS`
  / `indexante dos apoios sociais`. A search index returned
  <https://diariodarepublica.pt/dr/detalhe/portaria/480-a-2025-993056222> as a
  Portaria updating the IAS; **I could not open it and cannot confirm it is the
  operative one for the year you are reading this in — the whole point of this
  entry is that it is superseded annually.**
  **STILL NOT RETRIEVED, AND STILL RE-SCOPED — but no longer blocked by
  anything.** Third pass, 2026-08-19: `files.diariodarepublica.pt` serves the
  gazette as static PDF, so any Portuguese instrument whose issue number can be
  established is now a lookup. **This entry was not attempted**, because it is
  the lowest-value of the four outstanding and its scope needs settling first.
  D-10, now read, strengthens the case: **art. 61.º-B names no figure at all**
  (**C-17**), so the only numbers in play are the consular authority's. More
  usefully still: **D-11 shows the D8 income floor is not expressed in IAS at
  all.** The Portuguese consular authority states it as
  *"four monthly minimum guaranty remuneration"* — a multiple of the **RMMG**
  (guaranteed monthly minimum wage). The manifest's *reasoning* (capture the
  formula, not the euro figure) was right and its *named index was wrong*.
- **Save as.** `docs/knowledge/layer-1-statutory/D-13-pt-ias-portaria.md`.
- **Consumed by.** UC-04 → whatever income threshold a sourced `DNV_COUNTRIES`
  entry ends up carrying.
- **What is wrong today without it.** Nothing today, because there is no
  threshold at all. It becomes necessary the moment D-11's threshold is
  encoded: a floor expressed as "N × IAS" is stable across years while an
  absolute euro figure is not, and **capturing the euro figure instead of the
  formula is how a table acquires a number that silently becomes wrong every
  January.** `DNV_COUNTRIES_PROVENANCE` already names this failure mode — *"DNV
  schemes change income thresholds annually"* — as a reason the table needs a
  review date.
- **Licence.** Class **(c)** — as D-02.
- **Priority. SUPPORTING.**

### D-14 · United States — Visa Waiver Program and ESTA

> **The single US document with the most direct effect on a demo decision.**

- **Authority.** U.S. Customs and Border Protection, and the U.S. Department of
  State, Bureau of Consular Affairs.
- **URL.** <https://www.cbp.gov/travel/international-visitors/visa-waiver-program>
  and <https://travel.state.gov/content/travel/en/us-visas/tourism-visit/visa-waiver-program.html>
  **RETRIEVED 2026-08-19 (third pass) — BY HAND, by the repository owner.** Both
  sites still refuse this container's **address**: `www.cbp.gov` returns an
  Akamai `403` for the documented path, for `/`, and for `/robots.txt`;
  `travel.state.gov` returns a Cloudflare interstitial requiring JavaScript; the
  full browser header set does not help, and did not after the allowlist opening,
  which is the confirmation that nothing about our network was ever the problem.
  The owner opened both pages in a browser and copied the visible text. Bytes at
  `layer-1-statutory/sources/D-14-us-state-visa-waiver-program.txt` (12,720) and
  `…/D-14-us-cbp-esta-faq.txt` (16,297); provenance and evidence tag say
  *transcribed from a browser*, because that is a real difference.
  **Result: the block is confirmed as to work and over-broad as to business**
  (K-3, **C-26**), and VWP eligibility turns on nationality *status*, travel
  history and dual nationality, none of which the codebase can represent
  (**C-27**).
- **Save as.** `docs/knowledge/layer-1-statutory/D-14-us-vwp-esta.md`
  (+ `sources/…` — public domain, commit in full).
- **Consumed by.** UC-04 → `VISA_TYPES.esta_usa` in `src/uc04/riskMatrix.js`,
  whose inline description reads *"US ESTA / visa-waiver (tourist, NOT work)"*,
  and the rule that turns it into a hard block:
  `if (visaType === VISA_TYPES.esta_usa || visaType === VISA_TYPES.tourist_visa)`
  → `reasons.push("visitor_visa_active_work_forbidden")`. Also the paired
  `us_requires_work_permit` gate.
- **What is wrong today without it.** The file's own comment calls this **"the
  matrix's most-cited 'blocked' rule"** and says it is *"the difference between
  'the request needs more review' and 'the request is asking for something
  illegal as worded.'"* That is a very strong statement to a customer, and it is
  currently made on the authority of a code comment. It also fails in the
  direction people find hardest to argue with — a refusal looks responsible
  whether or not it is right, and `CLAUDE.md` §4 records what that costs:
  *"refusing correctly and being unable to succeed look identical from
  outside."* Two things this document has to settle that the code assumes:
  whether the visitor/work boundary is as bright as a single boolean makes it,
  and where ESTA's own duration limit sits relative to the matrix's silence on
  US trip length.
- **Licence.** Class **(a)** — US federal, public domain. Commit in full.
- **Priority. BLOCKING.**

### D-15 · United States — B-1 temporary business visitor

- **Authority.** U.S. Citizenship and Immigration Services.
- **URL.** <https://www.uscis.gov/working-in-the-united-states/temporary-visitors-for-business/b-1-temporary-business-visitor>
  **RETRIEVED 2026-08-19 (third pass) — BY HAND, by the repository owner.**
  `www.uscis.gov` still returns an Akamai `403` for the documented path and for
  `/`; whole-site refusal of this address. Bytes at
  `layer-1-statutory/sources/D-15-us-uscis-b1-business-visitor.txt` (12,328).
  **Result: the permitted-activity list is expressly *"including, but not limited
  to"*, and the prohibition USCIS actually names is *"local employment or labor
  for hire within the United States"* — activity- and payer-based, the same test
  Canada draws in IRPR s. 187 (C-5). `src/uc04/riskMatrix.js` blocks a US
  destination on every visa type except `work_permit`, `business_visa` included.
  See **C-26**.**
- **Save as.** `docs/knowledge/layer-1-statutory/D-15-us-b1-business-visitor.md`
  (+ `sources/…`).
- **Consumed by.** UC-04 → `VISA_TYPES.business_visa`, which is treated as
  *acceptable* by the Schengen branch and is **not** blocked by the visitor
  rule, and by UC-03's classification of what a trip is for.
- **What is wrong today without it.** The code draws a bright line between
  `tourist_visa` (blocked outright) and `business_visa` (permitted), and
  **nothing sources where that line sits.** This is the business-visitor
  activity boundary that `KNOWLEDGE-SOURCES.md` L1-07 sorts as **CORPUS, not
  TABLE** — *"attending meetings" versus "performing productive work" is the
  canonical cannot-be-reduced-to-a-lookup question* — and it is where
  `docs/research/CROSS-BORDER-FLOW.md` §7 D-3 already found this repository's
  own classifier treating contract negotiation as passive. So D-15 should be
  read as material for a **human-read citation**, not as a new boolean.
- **Licence.** Class **(a)** — US federal, public domain.
- **Priority. BLOCKING.**

### D-16 · Canada — working without a work permit

- **Authority.** Immigration, Refugees and Citizenship Canada, and the
  Department of Justice for the regulation itself. Instruments: Immigration and
  Refugee Protection Regulations, SOR/2002-227, **s. 186**, and IRCC's
  operational guidance.
- **URL.** <https://laws-lois.justice.gc.ca/eng/regulations/sor-2002-227/section-186.html>
  (the regulation) and
  <https://www.canada.ca/en/immigration-refugees-citizenship/services/work-canada/work-without-permit.html>
  (IRCC's guidance).
  **REGULATION VERIFIED, GUIDANCE PAGE IS A 404.** Called 2026-08-19:
  <https://laws-lois.justice.gc.ca/eng/regulations/sor-2002-227/section-186.html>
  returns 200 (63,615 bytes) and **s. 187 was fetched too** (200, 55,864 bytes)
  because s. 186(a) is meaningless without it — s. 187(3) is the actual
  business-visitor test. Both committed under SI/97-5. The IRCC guidance URL in
  this manifest is dead, and so is the nearest live path
  (`.../work-canada/permit/temporary/work-without-work-permit.html`, **404**);
  `www.canada.ca` is reachable, so it is a moved page, not a blocked host.
- **Save as.** `docs/knowledge/layer-1-statutory/D-16-ca-work-without-permit-irpr-186.md`
  (regulation bytes under class (b) with the SI/97-5 disclaimer; IRCC page
  cite-only under class (c)).
- **Consumed by.** UC-04 → the Canadian half of the paired work-permit gate in
  `src/uc04/riskMatrix.js`:
  `if (destinationCountry === "CA" && visaType !== VISA_TYPES.work_permit)` →
  `reasons.push("ca_requires_work_permit")`, a hard `blocked`.
- **What is wrong today without it.** **Every** workation to Canada is blocked
  unless the requester declared `work_permit` — including a trip that
  s. 186 might exempt. With Canada now a demo destination, that rule fires on
  every NL→CA, PT→CA and US→CA scenario, and the reason string a specialist
  reads is generated from an uncited assumption. The rule may well be right;
  the point is that nobody can currently check, and a block that is wrong is
  invisible precisely because it looks cautious.
- **Licence.** Regulation: class **(b)** (SI/97-5, accurate reproduction, not
  represented as official). IRCC guidance page: class **(c)** — canada.ca terms
  permit non-commercial reproduction with attribution; commercial reproduction
  needs written permission, and a public career-facing repository is not
  clearly non-commercial. Extract and cite.
- **Priority. BLOCKING.**

---

## 7. Group C — social security coordination

> **The structural point this group exists to fix, stated once.** The
> Netherlands and Portugal are both in `EU_EEA_FOR_A1`, so an NL↔PT trip raises
> `eu_eea_a1_path` / `a1_certificate_recommended`. **Canada and the United
> States are in neither `EU_EEA_FOR_A1` nor `NON_TREATY_PAIRS`** — and the
> pair keys `NL_CA`, `PT_CA`, `NL_US`, `PT_US` and their reverses appear in
> neither set. As read 2026-08-19, an NL→CA, PT→CA, NL→US or PT→US trip
> therefore produces **no social-security finding of any kind**: not a
> coverage flag, not a gap flag, nothing. That silence reads to a specialist as
> "nothing to consider" and actually means "never looked." Canada and the US
> each run their own bilateral totalization network, published by their own
> authorities, on a **different code path — not a missing row.**

### D-17 · EU — social-security coordination, and the A1

- **Authority.** European Parliament and Council, via EUR-Lex. Instrument:
  Regulation (EC) No 883/2004 — in particular the posting and multi-state
  activity articles (12 and 13) that decide which state's legislation applies.
- **URL.** <https://eur-lex.europa.eu/eli/reg/2004/883/oj/eng> — take the
  consolidated version.
  **URL VERIFIED — called 2026-08-19, HTTP 200.** The ELI base resolves; the
  newest consolidation offered is **2019-07-31**, taken via
  <https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:02004R0883-20190731>
  (200, 612,801 bytes). Retrieved and committed in full.
- **Save as.** `docs/knowledge/layer-1-statutory/D-17-eu-reg-883-2004.md`
  (+ `sources/…` — commit in full).
- **Consumed by.** UC-04 → the `EU_EEA_FOR_A1` set (31 codes, incl. NL and PT)
  and the branch raising `eu_eea_a1_path`. UC-08 → the corpus entry a dossier
  cites when an NL↔PT question arrives.
- **What is wrong today without it.** The membership set is uncited, and — more
  importantly — the code raises **one** flag (`a1_certificate_recommended`)
  where the regulation offers **two different answers**: art. 12 (posting) and
  art. 13 (activity in two or more states) lead to different outcomes, and the
  choice turns on a substantial-activity assessment that is explicitly
  facts-and-circumstances. `KNOWLEDGE-SOURCES.md` L1-04 sorts this **SPLIT**
  for exactly that reason: membership is a TABLE, *which article governs* is
  CORPUS. Today the system flattens both into one recommendation.
- **Licence.** Class **(a)** — EUR-Lex reuse, 2011/833/EU, attribution.
- **Priority. BLOCKING.**

### D-18 · EU — the implementing regulation

- **Authority.** European Parliament and Council, via EUR-Lex. Instrument:
  Regulation (EC) No 987/2009.
- **URL.** <https://eur-lex.europa.eu/eli/reg/2009/987/oj/eng>
  **URL VERIFIED — called 2026-08-19, HTTP 200.** Newest consolidation
  **2018-01-01**, taken via
  <https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:02009R0987-20180101>
  (200, 347,174 bytes). Retrieved and committed in full. Articles 14, 16 and 19
  are the ones a dossier needs.
- **Save as.** `docs/knowledge/layer-1-statutory/D-18-eu-reg-987-2009.md`
  (+ `sources/…`).
- **Consumed by.** UC-04 / UC-08 — the procedure by which an A1 is actually
  obtained, which is what a dossier has to tell a specialist to *do*.
- **What is wrong today without it.** The recommendation
  `a1_certificate_recommended` names an instrument and stops. Nothing tells the
  reader who issues it, on what evidence, or in what order relative to the
  trip — so the flag is a label rather than an action.
- **Licence.** Class **(a)** — EUR-Lex reuse, 2011/833/EU.
- **Priority. SUPPORTING.**

### D-19 · EU — the Practical Guide on the applicable legislation

- **Authority.** European Commission, DG Employment, Social Affairs and
  Inclusion, on behalf of the Administrative Commission for the Coordination of
  Social Security Systems.
- **URL.** Start from the Commission's social-security coordination pages,
  e.g. <https://ec.europa.eu/social/main.jsp?catId=868&langId=en>, and find the
  current edition of the *Practical guide on the applicable legislation in the
  EU, the EEA and Switzerland*. **The `catId` in that URL is a CMS parameter I
  could not confirm points where I think it does.**
  **RETRIEVED 2026-08-19 (third pass), and not from the site's own search.**
  `employment-social-affairs.ec.europa.eu` is now allowlisted and answers 200,
  but its publication search is JavaScript-rendered and returns nothing to
  `curl`. The download link is carried by the Commission's own *A-Z on social
  security coordination (FAQs)* pages and points at
  <https://ec.europa.eu/social/BlobServlet?docId=11366&langId=en> — HTTP 200,
  **1,227,669 bytes**, 55 pages. **Its own version is December 2013**, which the
  Commission still links today, and that is itself the finding the
  `Source updatedAt` row exists for.
- **Save as.** `docs/knowledge/layer-1-statutory/D-19-eu-practical-guide-applicable-legislation.md`.
- **Consumed by.** UC-08 → the corpus side of the art. 12 / art. 13 split.
- **What is wrong today without it.** Nothing breaks; the dossier is simply
  thinner than it should be on the one question the regulation itself does not
  answer mechanically.
- **Licence.** Class **(c)** — an EU *publication*, not primary law, and
  publications can carry their own notice. **Verify before assuming
  2011/833/EU applies**, which it may well.
- **Priority. SUPPORTING.**

### D-20 · ★ United States — the totalization agreement list

> **Highest value per unit of effort in the entire manifest.** Public domain,
> one page, roughly thirty rows with signing and effective dates, and it closes
> a build-time task this repository has carried as `[PROPOSED]` since UC-04 was
> written.

- **Authority.** **U.S. Social Security Administration**, Office of
  International Programs.
- **URL.** <https://www.ssa.gov/international/status.html> (the status table
  giving signing date, effective date and legal citation per agreement) and
  <https://www.ssa.gov/international/agreements_overview.html> (the overview,
  including the certificate-of-coverage procedure and the detached-worker
  duration limit).
  **URLS VERIFIED — both called 2026-08-19, HTTP 200.** Retrieved and committed.
  **The technique is worth recording:** a plain `curl` and a `curl` carrying only
  a browser `User-Agent` both get an Akamai `403`; a complete browser header set
  returns 200 for the same URL in the same shell. The proxy `CONNECT` succeeded
  in every case, so this was never an egress denial. **Neither page prints a
  last-updated date** — the one instrumentation gap in the highest-value US
  source here.
- **Save as.** `docs/knowledge/layer-1-statutory/D-20-us-ssa-totalization-status.md`
  (+ `sources/D-20-us-ssa-totalization-status.html` — public domain, commit the
  bytes and the table).
- **Consumed by.** UC-04 → a totalization table that **does not exist**, which
  is why `NL_US`, `PT_US` and `CA_US` produce no finding. UC-07 and UC-08 →
  the same coverage question in a dossier. Also
  `docs/00-FOUNDATION.md` §4 invariant 9, which picks its country scope
  partly on totalization coverage, and `docs/use-cases/UC-04.md` §3, which
  already names ssa.gov as the intended build-time source and tags it
  `[PROPOSED — build-time task]`.
- **What is wrong today without it.** The US is now the largest country in the
  demo Sandbox, and **no US social-security position is computed at all.** The
  nearest thing in the code is `NON_TREATY_PAIRS`, which holds `IN_US` and
  `PH_US` — a **known-gap list, not a coverage list**, and the code is explicit
  that *"absence means 'we have not looked' — it does NOT mean covered."* So the
  system today can say "we know there is no agreement" for two pairs and can
  say nothing whatsoever for every other US pair, including all three that the
  four-country demo actually exercises.
- **⚠ Do not let this list stand in for D-21/22/23, or the reverse.** The SSA
  publishes **US** agreements; Canada publishes **Canadian** agreements. They
  are separate authorities maintaining separate networks, and a pair that is
  covered in one is not thereby covered in the other. Two lists, two tables,
  two citations.
- **Licence.** Class **(a)** — US federal government work, **public domain**,
  no conditions. `RETRIEVAL-BLOCKED.md` already calls it *"the single cleanest
  vendorable item in the whole catalogue."*
- **Priority. BLOCKING ★ — fetch first.**

### D-21 · Canada — the list of countries with social security agreements

- **Authority.** Canada Revenue Agency (CPP/EI Rulings) and Employment and
  Social Development Canada; the treaty texts themselves sit on Global Affairs
  Canada's treaty list.
- **URL.** <https://www.canada.ca/en/revenue-agency/services/tax/canada-pension-plan-cpp-employment-insurance-ei-rulings/international-social-security-agreements-canada-pension-plan.html>
  **URL VERIFIED — called 2026-08-19, HTTP 200.** The agreement table is not on
  that page; it is on its sub-page
  <https://www.canada.ca/en/revenue-agency/services/tax/canada-pension-plan-cpp-employment-insurance-ei-rulings/international-social-security-agreements-canada-pension-plan/what-purpose-international-social-security-agreements.html>
  (200), which carries **61 country rows** with *Effective date*, *Form number*
  and — a column the manifest did not anticipate — **Maximum period of initial
  detachment**. Page prints "Date modified: 2024-07-23". Cite-and-extract
  honoured; canada.ca's terms of use were read live to confirm the class.
- **Save as.** `docs/knowledge/layer-1-statutory/D-21-ca-social-security-agreements-list.md`.
- **Consumed by.** UC-04 → the Canadian counterpart of the missing totalization
  table; UC-08 → the coverage statement in a dossier.
- **What is wrong today without it.** Same silence as D-20, on the Canadian
  side: NL→CA and PT→CA produce no social-security finding whatsoever.
- **Licence.** Class **(c)** — canada.ca terms. Extract and cite.
- **Priority. BLOCKING.**

### D-22 · Canada ↔ Netherlands — the agreement, and its certificate

- **Authority.** Global Affairs Canada (treaty text) and the Canada Revenue
  Agency (the certificate form). Instrument: Agreement on Social Security
  between Canada and the Kingdom of the Netherlands. The Canadian certificate
  of coverage form is **CPT63**.
- **URL.** <https://www.canada.ca/en/revenue-agency/services/forms-publications/forms/cpt63.html>
  for the form — whose own title names the agreement and the article it is
  issued under — and Canada's Treaty Information site (`treaty-accord.gc.ca`)
  for the text. **A search index returned two `treaty-accord.gc.ca/text-texte.aspx?id=…`
  results without making clear which is the Netherlands one; I am not guessing
  an id.** Search the treaty list by country instead.
  **RETRIEVED 2026-08-19 (third pass) — and the CRA row it stood in for is
  wrong.** `www.treaty-accord.gc.ca` is now allowlisted. Its **search and
  pagination both return HTTP 500**, so the register was walked by enumerating
  `details.aspx?id=`, which found **two** Canada–Netherlands social security
  agreements, not one: CTS **1990/14** (in force 1990-10-01, art. VI(2)
  *"twenty-four months"*) and CTS **2004/6** (signed Brantford 2001-06-27, in
  force **2004-04-01**, art. VI(2) *"sixty months"*), the second expressly
  superseding the first. **The CRA's row pairs the 1990 date with the 2004
  number.** The 1989 Supplementary Agreement was read in full and does not touch
  art. VI. See **C-24**.
- **Save as.** `docs/knowledge/layer-1-statutory/D-22-ca-nl-social-security-agreement.md`.
- **Consumed by.** UC-04 → the NL↔CA cell of the missing totalization table.
- **What is wrong today without it.** **This is the concrete case the group
  header describes.** A Dutch employee working temporarily from Canada gets
  `eu_eea_a1_path`? No — Canada is not in `EU_EEA_FOR_A1`, so that branch does
  not fire. Gets `non_treaty_pair`? No — `NL_CA` is not in `NON_TREATY_PAIRS`,
  so that branch does not fire either. The trip produces **no social-security
  output at all**, and the specialist sees an absence that is indistinguishable
  from a clearance. **CPT63 is the exact Canadian analogue of the A1** and is
  what the dossier should be naming.
- **Licence.** Class **(c)** — canada.ca / Crown copyright. Extract and cite.
- **Priority. BLOCKING.**

### D-23 · Canada ↔ Portugal — the agreement, and its certificate

- **Authority.** Global Affairs Canada and the Canada Revenue Agency.
  Instrument: Agreement on Social Security between Canada and Portugal.
  Certificate form: **CPT55**.
- **URL.** <https://www.canada.ca/en/revenue-agency/services/forms-publications/forms/cpt55.html>;
  treaty text via `treaty-accord.gc.ca`, found by country search rather than a
  guessed id.
  **RETRIEVED 2026-08-19 (third pass), and it checks out.** The register holds
  exactly one Canada–Portugal social security agreement (CTS **1981/15**, signed
  Toronto 1980-12-15, in force **1981-05-01** — the CRA's date exactly), whose
  art. VII(1) reads *"for a period of up to **24 months**"* and whose art.
  VII(3) requires **both** competent authorities' prior consent for any
  extension beyond it. Recorded as **K-4**, and worth recording precisely
  because its Netherlands neighbour did **not** check out (**C-24**).
- **Save as.** `docs/knowledge/layer-1-statutory/D-23-ca-pt-social-security-agreement.md`.
- **Consumed by.** UC-04 → the PT↔CA cell of the missing totalization table.
- **What is wrong today without it.** Identical to D-22, for the PT↔CA pair.
  Worth noting that the two forms are not interchangeable and their titles
  reference **different articles** of their respective agreements — which is
  itself the evidence that "totalization coverage" is not one boolean but a
  per-pair instrument with its own procedure.
- **Licence.** Class **(c)**.
- **Priority. BLOCKING.**

---

## 8. Groups D and E — tax treaties and residence tests

> **How the six pairs sit today.** `NON_TREATY_PAIRS` in
> `src/uc04/riskMatrix.js` is a **known-gap list**: membership means "we know
> there is no treaty", absence means "we have not looked." None of the six
> pairs among NL/PT/CA/US is a member, so none produces a flag, and
> `src/uc04/decisionFacts.js` correctly reports the pair as `unknown` rather
> than covered. **The code's fail direction is right and its knowledge is
> empty.** Every entry below moves one pair from `unknown` to a citable fact.

### D-24 · Netherlands – Portugal double-tax convention

- **Authority.** The two contracting states. Dutch publication:
  **Verdragenbank / wetten.overheid.nl** (Ministerie van Buitenlandse Zaken).
- **URL.** <https://verdragenbank.overheid.nl/nl/Verdrag/Details/009217> and
  the wetten.overheid.nl form <https://wetten.overheid.nl/BWBV0001423/>.
  **BOTH IDENTIFIERS VERIFIED AND BOTH ARE CORRECT — called 2026-08-19.**
  Verdragenbank `009217` (200; the `/nl/Verdrag/` form redirects to `/en/Treaty/`)
  and wetten `BWBV0001423` (200, redirects to the `2000-08-11` version) are both
  the NL–PT convention, and the Verdragenbank record names `0001423` as its own
  consolidated text, so the two are joined by the authority rather than by our
  assumption. Concluded 20-09-1999 at Oporto; in force 11-08-2000. No bytes
  committed (same open site-terms question as D-01).
- **Save as.** `docs/knowledge/layer-1-statutory/D-24-nl-pt-tax-convention.md`.
- **Consumed by.** UC-08 → the treaty citations a dossier renders; UC-04 → the
  `NL_PT` / `PT_NL` cell of a treaty-existence table.
- **What is wrong today without it.** UC-08's `TREATY_CORPUS` holds **three
  general entries** (an OECD Model art. 4 residence tie-breaker, an art. 15
  employment-income entry, and a general totalization principle), all of them
  this repository's own paraphrase of a *model*, not of any actual bilateral
  treaty. So a dossier about a Dutch employee in Portugal cites a **model
  convention principle** and never the instrument that actually governs the
  pair. That is honest — the corpus entries say what they are — and it is also
  the whole gap.
- **Licence.** Class **(b)** — Dutch state publication of a treaty text; see
  D-01's basis. Verify the site's terms.
- **Priority. BLOCKING.**

### D-25 · Canada – Netherlands income tax convention

- **Authority.** Department of Finance Canada.
- **URL.** <https://www.canada.ca/en/department-finance/programs/tax-policy/tax-treaties/country/netherlands-convention-consolidated-1986-1993-1997.html>
  — a consolidated text whose filename indicates the original convention plus
  two protocols. Index: <https://www.canada.ca/en/department-finance/programs/tax-policy/tax-treaties/in-force.html>.
  **URL VERIFIED — called 2026-08-19, HTTP 200**, and the index page confirms the
  composition in the department's own words: *"as signed on May 27, 1986 and
  amended by the Protocols signed on March 4, 1993 and August 25, 1997."* Page
  prints "Date modified: 2019-11-05". Cite-and-extract; no bytes.
- **Save as.** `docs/knowledge/layer-1-statutory/D-25-ca-nl-tax-convention.md`.
- **Consumed by.** UC-08 / UC-04 → the CA↔NL pair.
- **What is wrong today without it.** As D-24, for a pair the demo now
  exercises. **Note this convention is a consolidation across multiple
  protocols** — the kind of instrument where "which version is in force"
  is a real question, and the reason the provenance header's version row is not
  decorative.
- **Licence.** Class **(c)** — canada.ca terms; extract and cite. **The US
  version of this same treaty relationship (D-29) is public domain**, so if you
  need quotable treaty text about Canada, the IRS-published US–Canada
  convention is the one you may copy — not this one.
- **Priority. BLOCKING.**

### D-26 · Canada – Portugal income tax convention

- **Authority.** Department of Finance Canada.
- **URL.** Start from <https://www.canada.ca/en/department-finance/programs/tax-policy/tax-treaties/in-force.html>
  and follow the Portugal entry. **I could not corroborate a country-page slug
  for Portugal from any index and am not guessing one** — the Netherlands slug
  (D-25) embeds its protocol years, so the Portugal slug cannot be derived from
  it by pattern.
  **RETRIEVED 2026-08-19 (third pass).** The manifest's guessed Finance Canada
  slug could not have existed; its own index points at GAC, and GAC is now
  reachable. Located by the same id enumeration as D-22/D-23 (the register's
  search 500s): **E103231, CTS 2001/27**, signed Ottawa **1999-06-14** — the date
  the previous pass had confirmed — in force **2001-10-24**. HTTP 200,
  **72,814 bytes**. Art. 15(2)(a): **183 days in any twelve-month period
  commencing or ending in the *calendar* year concerned.** This is the sixth and
  last of the six demo pairs; **C-10** is now a complete six-row table and no two
  rows share a window.
- **Save as.** `docs/knowledge/layer-1-statutory/D-26-ca-pt-tax-convention.md`.
- **Consumed by.** UC-08 / UC-04 → the CA↔PT pair.
- **What is wrong today without it.** As D-24.
- **Licence.** Class **(c)**.
- **Priority. BLOCKING.**

### D-27 · United States – Netherlands income tax convention

- **Authority.** Internal Revenue Service (publishing the convention and its
  protocols and technical explanations); U.S. Department of the Treasury.
- **URL.** <https://www.irs.gov/businesses/international-businesses/netherlands-tax-treaty-documents>
  — the country page linking the PDF texts. Index:
  <https://www.irs.gov/businesses/international-businesses/united-states-income-tax-treaties-a-to-z>.
  **BOTH URLS VERIFIED — called 2026-08-19, HTTP 200.** The country page links
  the text at `/pub/irs-trty/nether.pdf`, retrieved (200, **160,636 bytes**, 74
  pages) and **committed in full**. Country page prints "Page Last Reviewed or
  Updated: 08-Aug-2026". Article 16 quoted in
  [`layer-1-statutory/D-27-D-28-D-29-us-tax-conventions.md`](layer-1-statutory/D-27-D-28-D-29-us-tax-conventions.md).
- **Save as.** `docs/knowledge/layer-1-statutory/D-27-us-nl-tax-convention.md`
  (+ `sources/D-27-us-nl-tax-convention.pdf` — **commit the text in full**).
- **Consumed by.** UC-08 → treaty citations; UC-04 → the US↔NL pair.
- **What is wrong today without it.** As D-24 — and with a difference that
  should change what you fetch first. **D-27, D-28 and D-29 are the only treaty
  texts anywhere in this manifest that can be committed to a public repository
  verbatim.** Every Dutch, Portuguese and Canadian instrument here is
  extract-and-cite at best. If the goal is a corpus containing *real quoted
  treaty language* rather than paraphrase, the three IRS documents are the only
  route to it.
- **⚠ Reading note.** These conventions are **based on the OECD Model** but are
  not it. Quoting the bilateral text is fine and free; quoting the **OECD Model
  or its Commentaries is not** (class (d)) — see §9. The distinction is easy to
  lose because the article numbering is nearly identical.
- **Licence.** Class **(a)** — US federal government work, public domain.
- **Priority. BLOCKING.**

### D-28 · United States – Portugal income tax convention

- **Authority.** Internal Revenue Service; U.S. Department of the Treasury.
- **URL.** <https://www.irs.gov/businesses/international-businesses/portugal-tax-treaty-documents>
  **URL VERIFIED — called 2026-08-19, HTTP 200.** Text at
  `/pub/irs-trty/portugal.pdf` retrieved (200, **73,855 bytes**, 29 pages) and
  committed in full. The PDF's own header states *"GENERAL EFFECTIVE DATE UNDER
  ARTICLE 30: 1 JANUARY 1996."*
- **Save as.** `docs/knowledge/layer-1-statutory/D-28-us-pt-tax-convention.md`
  (+ `sources/…pdf`, in full).
- **Consumed by.** UC-08 / UC-04 → the US↔PT pair.
- **What is wrong today without it.** As D-27.
- **Licence.** Class **(a)** — public domain.
- **Priority. BLOCKING.**

### D-29 · United States – Canada income tax convention

- **Authority.** Internal Revenue Service; U.S. Department of the Treasury.
- **URL.** Follow the Canada entry from
  <https://www.irs.gov/businesses/international-businesses/united-states-income-tax-treaties-a-to-z>.
  I attempted the pattern-derived
  `…/international-businesses/canada-tax-treaty-documents`; **it follows the
  same shape as the Netherlands and Portugal pages but I could not corroborate
  it independently and could not fetch it.**
  **URL VERIFIED — the pattern-derived guess was right.** Called 2026-08-19:
  `.../international-businesses/canada-tax-treaty-documents` returns 200 and is
  the Canada page. Text at `/pub/irs-trty/canada.pdf` retrieved (200, **170,101
  bytes**, 85 pages) and committed in full. Note Article XV(2) carries a
  **$10,000 de minimis alternative** to the day count that neither of the other
  two treaties has.
- **Save as.** `docs/knowledge/layer-1-statutory/D-29-us-ca-tax-convention.md`
  (+ `sources/…pdf`, in full).
- **Consumed by.** UC-08 / UC-04 → the US↔CA pair.
- **What is wrong today without it.** As D-27. This is also the pair with the
  most operational traffic in the demo Sandbox, so it is the one a reviewer is
  most likely to probe.
- **Licence.** Class **(a)** — public domain.
- **Priority. BLOCKING.**

### D-30 · Multilateral Instrument — which of the six pairs it modifies

- **Authority.** OECD, as depositary, publishing signatories, reservations and
  the matching database.
- **URL.** The OECD's BEPS / MLI pages. **I could not reach `oecd.org` and am
  not quoting a deep link I cannot check.** Canada also publishes its own MLI
  ratification notices on canada.ca, which is a usable secondary route to *its
  own* positions only.
  **NOT RETRIEVED, AND DELIBERATELY NOT PURSUED.** `www.oecd.org` is outside this
  container's allowlist. It would not have changed the handling: licence class
  **(d)**, paraphrase-only, is an access-independent constraint. Recording the
  status facts and citing the page remains the correct treatment.
- **Save as.** `docs/knowledge/layer-1-statutory/D-30-mli-status-register.md`
  — **a citation register, not a copy.**
- **Consumed by.** The `version` field of any treaty-existence table built from
  D-24…D-29.
- **What is wrong today without it.** Nothing yet, and it becomes the most
  subtle problem the moment the treaty table exists. `KNOWLEDGE-SOURCES.md`
  L1-02 states it precisely: **the MLI modifies many existing treaties without
  changing their published text**, so a treaty's effect can change while every
  document you monitor stays byte-identical. A checksum will not see it. That
  is the cleanest argument in the whole catalogue for why a table needs a
  *version* and not just a *hash*.
- **Licence.** Class **(d)** for anything OECD-authored: **record the status
  facts, cite the page, copy nothing.** The fact of which treaties are modified
  is a table with an authority; the OECD's text around it is not ours.
- **Priority. SUPPORTING.**

### D-31 · Netherlands — where a person is resident for tax

- **Authority.** Overheid.nl / wetten.overheid.nl. Instrument: Algemene wet
  inzake rijksbelastingen, **artikel 4** (`BWBR0002320`).
- **URL.** <https://wetten.overheid.nl/BWBR0002320/>
  **URL VERIFIED — called 2026-08-19, HTTP 200.** `BWBR0002320` redirects to the
  **2026-04-11** consolidation (172,101 bytes); the per-article print form
  `/BWBR0002320/2026-04-11/0/HoofdstukI/Artikel4/afdrukken` returns 200 (16,871
  bytes). **Article 4(1) is eleven words and contains no day count** — see
  [`layer-1-statutory/D-31-nl-awr-art-4-residence.md`](layer-1-statutory/D-31-nl-awr-art-4-residence.md).
  No bytes committed (open site-terms question, as D-01).
- **Save as.** `docs/knowledge/layer-1-statutory/D-31-nl-awr-art-4-residence.md`.
- **Consumed by.** UC-08 → `src/uc08/presenceCalculator.js` and the dossier
  narrative; UC-04 → `RESIDENCY_LIMIT_DAYS` in `src/uc04/decisionFacts.js`.
- **What is wrong today without it.** **This is the entry most likely to change
  someone's mind about the design.** `src/uc04/riskMatrix.js` and
  `src/uc04/decisionFacts.js` both apply a single `RESIDENCY_LIMIT_DAYS = 183`
  over a single `RESIDENCY_WINDOW_DAYS = 365` trailing window, to **every**
  destination, and render it to the specialist as *"183-day watch line — N of
  headroom."* The Dutch domestic residence rule is not of that shape at all:
  art. 4 directs that residence be judged **according to the circumstances**.
  So for the Netherlands the system prints a precise headroom figure against a
  threshold that, domestically, does not exist. It is not off by a few days;
  it is answering a different question. Sourcing this is what lets the dossier
  say so instead.
- **Licence.** Class **(b)** — as D-01.
- **Priority. BLOCKING.**

### D-32 · Portugal — tax residence

- **Authority.** Diário da República Eletrónico. Instrument: Código do IRS,
  **artigo 16.º**.
- **URL.** <https://diariodarepublica.pt/dr/legislacao-consolidada/lei/2014-70048167>
  — the consolidated CIRS; navigate to art. 16. As with D-03, **the per-article
  suffix is opaque and I am not guessing it.**
  **RETRIEVED 2026-08-19 (third pass), from the tax authority rather than the
  gazette.** DRE's HTML is still a JavaScript shell, and the 1988 gazette PDF is
  now reachable but was **deliberately not used** — art. 16.º has been rewritten
  repeatedly since, most recently by Lei n.º 82/2023, and a 1988 text presented
  as the residence rule would be worse than the blank it replaced. The
  **Autoridade Tributária e Aduaneira** publishes its own consolidated CIRS:
  <https://info.portaldasfinancas.gov.pt/pt/informacao_fiscal/codigos_tributarios/cirs_rep/Pages/irs16.aspx>,
  HTTP 200, **71,604 bytes**, with per-paragraph amendment notes. **Portugal was
  the last unknown of the four and is now known** — and it is a fourth distinct
  shape: a 183-day line over a tax-year-anchored 12-month period, a **second
  count-free limb** that can make a person resident *below* it, a day counted
  only if it *"inclua dormida"*, and residence back-dated to the first day of the
  stay. **C-12** is rewritten; **C-21** is new.
- **Save as.** `docs/knowledge/layer-1-statutory/D-32-pt-cirs-art-16-residence.md`
  — sidecar only.
- **Consumed by.** UC-08 → the presence window a dossier reports against;
  UC-04 → the same single 183/365 watch line.
- **What is wrong today without it.** The window is the problem, not the
  number. `computePresenceDays()` takes `windowStart` and `windowEnd` **from
  its caller** — correctly, since the calculator should not know jurisdictions
  — and **nothing in the system ties that window to any country's own rule.**
  UC-04 always passes a trailing 365 days from the trip start. Whether that is
  the right window for Portugal is precisely what art. 16 settles, and nobody
  has read it. A count taken over the wrong window is a well-formed number
  rendered beside a citation, which is `KNOWLEDGE-SOURCES.md` Test B's exact
  failure.
- **Licence.** Class **(c)** — as D-02.
- **Priority. BLOCKING.**

### D-33 · Canada — deemed residence by sojourn

- **Authority.** Department of Justice Canada, Justice Laws Website.
  Instrument: Income Tax Act, R.S.C. 1985, c. 1 (5th Supp.), **s. 250**.
- **URL.** <https://laws-lois.justice.gc.ca/eng/acts/I-3.3/section-250.html>
  **URL VERIFIED — called 2026-08-19, HTTP 200, 79,554 bytes stored.**
  Retrieved and committed under SI/97-5. Page prints *"Act current to 2026-06-17
  and last amended on 2026-04-01."* s. 250(1)(a) confirms Canada as the one demo
  country whose domestic law does carry a 183 — measured over a **taxation
  year**, with the consequence being deemed residence **throughout** it.
- **Save as.** `docs/knowledge/layer-1-statutory/D-33-ca-ita-s250-deemed-resident.md`
  (+ `sources/…` under class (b) with the SI/97-5 disclaimer).
- **Consumed by.** UC-08 → presence-day reporting; UC-04 → the 183/365 watch
  line, for CA destinations.
- **What is wrong today without it.** Canada is the one demo country where a
  183-day figure genuinely appears in domestic law — and the **window** the
  statute measures it over is a **taxation year**, not a rolling 365 days from
  a trip start. Those two windows give different answers for the same travel,
  and the difference is largest for exactly the split-year trips a workation
  produces. The code has one window for four countries.
- **Licence.** Class **(b)** — SI/97-5.
- **Priority. BLOCKING.**

### D-34 · Canada — the administrative view of residence

- **Authority.** Canada Revenue Agency. Instrument: Income Tax Folio
  **S5-F1-C1**, *Determining an Individual's Residence Status*.
- **URL.** <https://www.canada.ca/en/revenue-agency/services/tax/technical-information/income-tax/income-tax-folios-index/series-5-international-residency/folio-1-residency/income-tax-folio-s5-f1-c1-determining-individual-s-residence-status.html>
  **URL VERIFIED — called 2026-08-19, HTTP 200.** Page prints "Date modified:
  2026-01-20". Cite-and-extract; no bytes. Its ¶1.8/¶1.10/¶1.14 are quoted in
  [`layer-1-statutory/D-34-ca-cra-folio-s5-f1-c1.md`](layer-1-statutory/D-34-ca-cra-folio-s5-f1-c1.md)
  precisely because they are the sentences explaining why this must never be
  table-ified.
- **Save as.** `docs/knowledge/layer-1-statutory/D-34-ca-cra-folio-s5-f1-c1.md`.
- **Consumed by.** UC-08 → **corpus, deliberately**, not a table.
- **What is wrong today without it.** Nothing breaks. It is listed because it
  is the Canadian analogue of the trap `KNOWLEDGE-SOURCES.md` §1 names as the
  most tempting in the whole domain: a residence analysis that **looks** like a
  grid and is a facts-and-circumstances judgement. Encoding a residential-ties
  analysis into a lookup would produce a confident, well-formed, wrong answer.
  This document belongs in the human-read corpus and must never reach a
  conditional — the structural rule in
  [`README.md`](README.md) applies unchanged: *no `policyEngine.js` may import
  from a retriever, and no citation id may ever appear in a conditional.*
- **Licence.** Class **(c)** — canada.ca terms; also note the CRA's own
  positions do not have the force of law, which the sidecar should say.
- **Priority. SUPPORTING.**

### D-35 · United States — the substantial presence test

- **Authority.** Internal Revenue Service. Instruments: the substantial
  presence test as published by the IRS, and **Publication 519**, *U.S. Tax
  Guide for Aliens*.
- **URL.** <https://www.irs.gov/individuals/international-taxpayers/substantial-presence-test>
  and <https://www.irs.gov/pub/irs-pdf/p519.pdf>.
  **BOTH URLS VERIFIED — called 2026-08-19, HTTP 200.** The test page was
  retrieved and committed (106,699 bytes stored) and prints **"Page Last Reviewed
  or Updated: 14-Mar-2026"**. Publication 519 was also retrieved (200,
  **2,080,184 bytes**, SHA-256
  `c220ed64473d9f26b09784e45d5c4e05b052caace1263278bb6dc2060796ed85`) and is
  **not committed on size grounds**; the checksum is recorded so the decision is
  reversible.
- **Save as.** `docs/knowledge/layer-1-statutory/D-35-us-substantial-presence-test.md`
  (+ `sources/D-35-us-substantial-presence-test.pdf` — public domain, commit
  in full).
- **Consumed by.** UC-08 → `src/uc08/presenceCalculator.js`; UC-04 → the
  183/365 watch line, for US destinations.
- **What is wrong today without it.** **The US completes the argument the other
  three entries in this group are making.** The system applies one number
  (183) over one window (a trailing 365 days) to every destination. Across the
  four demo countries that single rule stands in for: a Canadian test measured
  over a taxation year (D-33); a Portuguese test measured over a 12-month period
  (D-32); a Dutch rule with no day count at all (D-31); and a US test that is
  **not a simple count over a single year** — Pub. 519 describes a weighted
  computation spanning **three** years. Four jurisdictions, four differently
  shaped tests, one hard-coded threshold and one window. Nothing downstream
  contradicts the result, because the result is a well-formed number.

  Note the honest thing the code already does and must not lose:
  `computePresenceDays()` returns `NOT_EVALUATED` with `days: null` rather than
  a fabricated zero when there are no records, precisely because *"a stated zero
  reads as 'well under the 183-day threshold', which is a conclusion nobody
  computed."* The fix this document enables is the same discipline applied to
  the **threshold** rather than the count.
- **Licence.** Class **(a)** — US federal, public domain. Commit in full.
- **Priority. BLOCKING.**

---

## 9. Group F — sanctions and restricted jurisdictions

> **The finding this group exists to make explicit, and it is now reachable in
> three legal regimes at once.** `SANCTIONED_OR_RESTRICTED` in
> `src/uc03/policyEngine.js` is a **single set of ten alpha-2 codes** —
> `CU IR KP SY RU BY MM VE AF IQ` — imported unchanged by
> `src/uc04/riskMatrix.js` as `RESTRICTED_JURISDICTIONS`, and driving a hard
> `blocked` / `sanctioned_region` in both. Its own header says what it is:
> *"Illustrative demonstration subset — NOT Remote's authoritative compliance
> list, which this portfolio does not have access to."*
>
> **With NL, PT, CA and US all in the demo, that one list now stands in for
> three genuinely different regimes at the same time.** An employer in the
> Netherlands or Portugal is bound by **EU** restrictive measures; one in
> Canada by **SEMA** and the **JVCFOA**; one in the US by **OFAC** programs.
> The three overlap substantially and are not identical, and the repository has
> no field distinguishing which regime a given code came from. A single list
> can therefore be right for none of the four employers in the demo, while
> looking authoritative to all of them.
>
> **And the structural limitation no amount of maintenance fixes:** a
> **country** list can never be the control. Real sanctions are **entity- and
> person-level**. A country screen is a first pass that catches the obvious
> case, and saying so is the difference between a defensible demo control and
> a claim that would fail an audit.
>
> **⚠ DO NOT VENDOR THESE FOUR.** Their licences are all clean, which is
> exactly what makes a checked-in copy tempting — and a checked-in copy is
> precisely the *"helpful cached fallback"* that `KNOWLEDGE-SOURCES.md` §11
> names as dishonest to ship, sitting in `docs/` looking authoritative while
> going stale on a schedule nobody controls. The right shape is a **scheduled
> fetch with a fail-closed gate**. Download them to **read and to write a dated
> citation register**; commit the register, not the list.

### D-36 · United States — OFAC

- **Authority.** U.S. Department of the Treasury, **Office of Foreign Assets
  Control**.
- **URL.** <https://ofac.treasury.gov/sanctions-programs-and-country-information>
  (the country/programme index) and <https://ofac.treasury.gov/sanctions-list-service>
  (the machine-readable list service).
  **URLS VERIFIED — called 2026-08-19, HTTP 200.** Retrieved and read; **no list
  bytes committed**, per the do-not-vendor rule below. The most valuable thing
  retrieved was not the programme index but OFAC's own FAQ
  (<https://ofac.treasury.gov/faqs/topic/1546>, 200): *"The Office of Foreign
  Assets Control (OFAC) does not maintain a specific list of countries that U.S.
  persons cannot do business with."*
- **Save as.** `docs/knowledge/layer-1-statutory/D-36-us-ofac-programs-register.md`
  — **register only, no list bytes.**
- **Consumed by.** UC-03 → `SANCTIONED_OR_RESTRICTED` and the
  `sanctioned_region` refusal; UC-04 → `RESTRICTED_JURISDICTIONS` and the
  first-position hard block.
- **What is wrong today without it.** Ten codes with no authority, no date and
  no regime attribution, driving a **block** on a real Remote write path.
  `CLAUDE.md` §4 records that this gate is newer than the rest of UC-04 and was
  added because a sanctioned destination was previously indistinguishable from
  an unevaluated one — a real defect, fixed with an unsourced list. **The fix
  was right and its input is still uncited.**
- **Licence.** Class **(a)** — US federal, public domain — **but see the
  do-not-vendor rule above.**
- **Priority. BLOCKING.**

### D-37 · European Union — restrictive measures

- **Authority.** Council of the European Union and the European Commission
  (DG FISMA), via the **EU Sanctions Map** and the consolidated list of persons,
  groups and entities subject to EU financial sanctions.
- **URL.** <https://www.sanctionsmap.eu/> and the consolidated-list dataset on
  <https://data.europa.eu/>. **A search index flagged one data.europa.eu
  dataset record as `[DEPRECATED]`, so start from the Commission's current
  publication route rather than a dataset permalink.**
  **RETRIEVED VIA THE SITE'S OWN JSON API — called 2026-08-19.**
  `https://www.sanctionsmap.eu/` returns 200 and a 978-byte JavaScript shell
  (*"EU Sanctions Map / Please wait"*); its public endpoint
  <https://www.sanctionsmap.eu/api/v1/regime> returns 200 and 399,898 bytes of
  regime records, which is what was read: **55 regimes, 35 with a country
  attachment.** Register written; **no list bytes committed.** The reading
  produced the sharpest finding in the sanctions group — a naive projection of
  that register onto a destination blocklist would block the **United States**,
  because the regime attached to `US` is the **Blocking Statute**.
- **Save as.** `docs/knowledge/layer-1-statutory/D-37-eu-restrictive-measures-register.md`
  — register only.
- **Consumed by.** The same single list, as it applies to the NL and PT
  employers in the demo.
- **What is wrong today without it.** The Dutch and Portuguese halves of the
  demo are governed by EU measures, and nothing in the repository references an
  EU instrument at all. Note also that the Sanctions Map carries **measure
  types that are not asset freezes** and so do not appear in the consolidated
  financial list — which is the concrete reason a single flattened country set
  cannot represent this regime, let alone three.
- **Licence.** Class **(a)** — EU reuse — **but do not vendor.**
- **Priority. BLOCKING.**

### D-38 · Canada — autonomous sanctions

- **Authority.** Global Affairs Canada. Instruments: Special Economic Measures
  Act (SEMA) regulations and the Justice for Victims of Corrupt Foreign
  Officials Act (JVCFOA); published as the **Consolidated Canadian Autonomous
  Sanctions List**.
- **URL.** <https://www.international.gc.ca/world-monde/international_relations-relations_internationales/sanctions/consolidated-consolide.aspx?lang=eng>
  **URL VERIFIED — called 2026-08-19, HTTP 200.** Register written; **no list
  bytes committed.** Page prints **"Date modified: 2026-08-19"** — the day of
  retrieval, which is the cadence evidence the do-not-vendor rule needs. Its own
  words: *"The consolidated list is not a regulation, and it does not have force
  of law."*
- **Save as.** `docs/knowledge/layer-1-statutory/D-38-ca-autonomous-sanctions-register.md`
  — register only.
- **Consumed by.** The same single list, as it applies to the Canadian half of
  the demo.
- **What is wrong today without it.** Canada's regime is statutorily distinct
  from both the EU's and OFAC's, and the repository's one list makes no
  distinction. The list is also published **per-country under separate
  regulations**, which is the natural shape for the regime attribution the code
  lacks.
- **Licence.** Class **(b)** — Crown copyright, canada.ca terms — **but do not
  vendor.**
- **Priority. BLOCKING.**

### D-39 · United Nations — the Security Council Consolidated List

- **Authority.** United Nations Security Council.
- **URL.** <https://www.un.org/securitycouncil/content/un-sc-consolidated-list>
  **RETRIEVED 2026-08-19 (third pass) — as a register entry, and no list bytes,
  now for two independent reasons.** `main.un.org` is allowlisted and answers
  **200** to the full browser header set (a bare `curl` gets 403). The page names
  the machine-readable access path
  (<https://scsanctions.un.org/resources/xml/en/consolidated.xml>), states the
  list was *"last updated on **18 August 2026**"* — the day before it was read —
  and gives its composition as 736 individuals and 275 entities and **zero
  countries**. The do-not-vendor rule already applied on staleness grounds; the
  UN's copyright page adds a licence ground, and **corrects this entry's class
  from (b) to (c)**. The regime codes are also **not ISO 3166-1** — `GB` is
  Guinea-Bissau. See **C-25**.
- **Save as.** `docs/knowledge/layer-1-statutory/D-39-un-consolidated-list.md`
  — register only.
- **Consumed by.** Context for D-36/37/38 — the measures all three regimes
  implement in common.
- **What is wrong today without it.** Nothing directly; it is the baseline that
  explains **why** the three regimes overlap as much as they do, which is worth
  a paragraph in whichever register the specialist reads.
- **Licence.** Class **(b)** — attribution; the UN asserts rights over its
  publications. ⚠ Verify un.org's terms. **Do not vendor** regardless.
- **Priority. SUPPORTING.**

---

## 10. Explicitly NOT on this list

Named so the boundary is visible rather than merely observed.

| Item | Why it is not here |
|---|---|
| **OECD Model Tax Convention and Commentaries; BEPS Action 7** | Class **(d)** — copyrighted and sold as a publication. **Paraphrase only, never copied, now or ever.** A licence constraint, not an access one: it would hold unchanged if `oecd.org` became reachable tomorrow. The existing register at [`L1-01-L1-11-oecd-citation-register.md`](layer-1-statutory/L1-01-L1-11-oecd-citation-register.md) is the correct and complete handling. UC-08's three `TREATY_CORPUS` entries are this repository's **own paraphrase** of the principles and must stay that way. |
| **Any mirror** — `raw.githubusercontent.com`, aggregator sites, law-firm reproductions, `wetten-overheid.nl` (note the hyphen — **not** the government's `wetten.overheid.nl`), `maxius.nl`, `wetboek-online.nl`, `statutes.ca`, `taxinterpretations.com` | **A mirror is not the authority.** Several of these were returned by the searches used to corroborate URL shapes and are deliberately not listed as targets. Vendoring one puts an authority's name in a provenance header above bytes nobody in this chain read from that authority. |
| **IBFD, Bloomberg Tax, Vialto, Big-4 country guides** | `KNOWLEDGE-SOURCES.md` X-03. Their terms almost universally forbid redistribution and machine ingestion. **Not fetched, not paraphrased, not listed as a download target.** One such vendor appeared in a search result during this work and was discarded. |
| **Case law** | `KNOWLEDGE-SOURCES.md` X-05. Reasoning a lawyer applies; a case retrieved by similarity would carry the most unearned authority of anything in the corpus. |
| **Remote's internal `approved_by_remote` compliance criteria** | X-04 — not published. `[SILENT]`. Escalate and name the decider; never predict Remote's verdict. |
| **Public holiday calendars** | Already closed by preferring Remote's carrier — see [`layer-2-remote/L2-03-public-holidays.md`](layer-2-remote/L2-03-public-holidays.md). No national source needed. |

---

## 11. What this manifest revealed about the code

> **Superseded in substance by
> [`layer-1-statutory/CONTRADICTIONS.md`](layer-1-statutory/CONTRADICTIONS.md),
> and kept because the two lists say different things.** The seven items below
> were derived from **reading this repository's own code** — they are what the
> manifest could see without any document at all. `CONTRADICTIONS.md` is what
> **the documents themselves** said once 26 of them had been retrieved, and it
> is longer, sharper and in several places different: item 2 below turns out to
> understate the problem (the Dutch test has no day count at all, and the US one
> spans three years with weights), and item 6 turns out to have a second half
> nobody predicted (Annex II membership does not cover paid activity —
> Reg. 2018/1806 art. 6(3)).
>
> Two of the seven are now **confirmed correct** rather than merely suspected —
> see `CONTRADICTIONS.md` **K-1** and **K-2**, where the 29-code Schengen set and
> the 90/180 numbers both check out against the Council's own enumeration and
> the Borders Code.

Written down here because these are findings, not download instructions, and
because **no file under `src/` was changed by this pass.** Each is reported for
someone else to act on.

1. **Two of the four demo countries have no notice-period row at all.**
   `NOTICE_PERIOD_TABLE` covers `GB IE DE PL IN PH MX CA PT`. **NL and US are
   absent**, so `getNoticeRule()` returns `null` and every Dutch or American
   resignation escalates as `unsupported_country`. Correct behaviour; unrunnable
   demo. (D-01, D-06.)
2. **One threshold, one window, four differently shaped residence tests.**
   `RESIDENCY_LIMIT_DAYS = 183` over `RESIDENCY_WINDOW_DAYS = 365` is applied to
   every destination and rendered as a precise headroom figure. Across the demo
   four this single rule stands in for a Canadian taxation-year test, a
   Portuguese 12-month test, a Dutch rule with no day count at all, and a US
   test computed across three years. (D-31, D-32, D-33, D-35.)
3. **The NL↔CA, PT↔CA, NL↔US and PT↔US social-security cases produce total
   silence.** Neither `EU_EEA_FOR_A1` nor `NON_TREATY_PAIRS` contains any of
   those pairs, so neither branch fires and no flag is raised. To a specialist
   that is indistinguishable from a clearance. The Canadian and US networks are
   a **different code path, not a missing row**. (D-20, D-21, D-22, D-23.)
4. **Portugal's membership of `DNV_COUNTRIES` removes a control**, on the
   authority of a five-entry list the code itself records as having no
   authority, no version and no review date — and the four-country demo routes
   workations to Portugal, which is precisely a demonstration of that
   suppression firing. (D-10, D-11.)
5. **One sanctions list, three legal regimes.** Ten alpha-2 codes drive a hard
   block for employers governed by EU measures, Canadian SEMA/JVCFOA and US
   OFAC alike, with no field recording which regime any code came from.
   (D-36, D-37, D-38.)
6. **The Schengen 90/180 gate takes the traveller's word for their own visa
   entitlement.** Reg. (EU) 2018/1806's annexes are absent from the repository
   entirely, so the only thing standing between a self-declared `visaType` and
   a low-risk verdict is the requester's own claim — reachable in this demo
   whenever a Canadian or US national travels to NL or PT. (D-09.)
7. **The strongest claims in the notice table are negatives, and negatives are
   the hardest thing here to source.** Canada's `basis: "customary"` row asserts
   that no statutory employee minimum exists; the US would need the same
   assertion. Nothing downstream can contradict either. (D-04, D-05, D-06.)

**And the methodological point, which is the same one `CLAUDE.md` §4 already
paid for:** every gap above passes the full test suite today, because the
fixtures agree with the code and neither has been compared to an authority.
A number with no source and a number with the right source produce identical
green runs. That is what this manifest is for.
