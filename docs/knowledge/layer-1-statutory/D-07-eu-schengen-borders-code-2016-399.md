# D-07 · Schengen Borders Code — the 90/180 rule, at its source

| | |
|---|---|
| **Catalogue id** | D-07 (`docs/knowledge/DOWNLOAD-MANIFEST.md`) · L1-05 (`docs/KNOWLEDGE-SOURCES.md` §4) |
| **Source name** | Regulation (EU) 2016/399 on a Union Code on the rules governing the movement of persons across borders (Schengen Borders Code) — **consolidated text `02016R0399 — EN — 12.10.2025 — 006.001`** |
| **Publisher / authority** | European Parliament and Council of the European Union, via the Publications Office (EUR-Lex) |
| **Exact URL** | <https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:02016R0399-20251012> (reached from the ELI base <https://eur-lex.europa.eu/eli/reg/2016/399/oj/eng>, which lists 2025-10-12 as the newest consolidation) |
| **Retrieved** | **2026-08-19**, by `curl` through this container's egress proxy. HTTP 200, **5,553,887 bytes**. |
| **SHA-256 of the retrieved bytes** | `5cc89ddb30ba3a0004473eeb995f0f3c52f8966f960ed0c43c6943d793817c4d` — **see the note below before relying on this** |
| **Source `updatedAt`** | Consolidation date **12.10.2025**, revision **006.001**, as printed by EUR-Lex in the document's own first two lines. |
| **Licence / basis for inclusion** | EUR-Lex reuse. Verified live against EUR-Lex's own legal notice (<https://eur-lex.europa.eu/content/legal-notice/legal-notice.html>, retrieved 2026-08-19): *"The Commission's document reuse policy is based on Decision 2011/833/EU. Unless otherwise specified, you can re-use the legal documents published in EUR-Lex for commercial or non-commercial purposes."* The same notice adds a refinement the manifest did not have: *"The copyright for the editorial content of this website, the summaries of EU legislation and **the consolidated texts** … is licensed under the Creative Commons Attribution 4.0 International licence"* — so a consolidated version carries an attribution-and-indicate-changes condition that the original OJ text does not. Attribution given here; no changes made to any quoted passage. |
| **Evidence tag** | `[CONFIRMED — statute, retrieved 2026-08-19]` |

> **Why no bytes in `sources/`.** This is not a licence decision — the licence
> permits a full copy. The retrieved page is **5.5 MB** (the PDF rendering is
> 5.8 MB), which is larger than everything else in this corpus put together,
> for a document whose operative content for this repository is one article.
> The checksum above is recorded so the decision is reversible, but **treat it
> as weak evidence**: EUR-Lex renders these pages dynamically and a re-fetch
> may differ byte-for-byte while being the same consolidation. The
> consolidation identifier `006.001` is the stable version signal; the hash is
> not.

## Article 6(1) — the operative text, quoted verbatim

> **Article 6 — Entry conditions for third-country nationals**
>
> 1. For intended stays on the territory of the Member States of a duration of
> no more than **90 days in any 180-day period, which entails considering the
> 180-day period preceding each day of stay**, the entry conditions for
> third-country nationals shall be the following:
>
> (a) they are in possession of a valid travel document entitling the holder to
> cross the border satisfying the following criteria: (i) its validity shall
> extend at least three months after the intended date of departure from the
> territory of the Member States. In a justified case of emergency, this
> obligation may be waived; (ii) it shall have been issued within the previous
> 10 years;
>
> (b) they are in possession of a valid visa, if required pursuant to Council
> Regulation (EC) No 539/2001, except where they hold a valid residence permit
> or a valid long-stay visa;
>
> (c) they justify the purpose and conditions of the intended stay, and they
> have sufficient means of subsistence …
>
> (d) they are not persons for whom an alert has been issued in the SIS for the
> purposes of refusing entry;
>
> (e) they are not considered to be a threat to public policy, internal
> security, public health or the international relations of any of the Member
> States …
>
> (f) they provide biometric data, if required …
>
> **1a.** The period of 90 days in any 180-day period referred to in paragraph 1
> of this Article shall be calculated **as a single period for the Member States
> operating the EES** on the basis of Regulation (EU) 2017/2226. That period
> shall be calculated **separately for each of the Member States which do not
> operate the EES**.
>
> **2.** For the purposes of implementing paragraph 1, **the date of entry shall
> be considered as the first day of stay** on the territory of the Member States
> and **the date of exit shall be considered as the last day of stay** on the
> territory of the Member States. **Periods of stay authorised under a residence
> permit or a long-stay visa shall not be taken into account** in the
> calculation of the duration of stay on the territory of the Member States.

## What this settles, and what it does not

**Settles.** The two numbers `SCHENGEN_LIMIT_DAYS = 90` and
`SCHENGEN_WINDOW_DAYS = 180` in `src/uc04/decisionFacts.js` are correct as
numbers, and now have a named instrument, an article, a consolidation date and
a licence. The code comment saying *"statutory, not invented"* is true; this
file is the citation it lacked.

**Does not settle, and now contradicts.** Three things in the text are not in
the code, and one of them changes the arithmetic. They are written up in
[`CONTRADICTIONS.md`](CONTRADICTIONS.md) items **C-1**, **C-2** and **C-3**
rather than here, because this file is a source record and that file is the
list of things for someone else to act on.

**A note on the internal cross-reference.** Article 6(1)(b) still cites
*Council Regulation (EC) No 539/2001*, which was codified and replaced by
Regulation (EU) 2018/1806 (D-09). The consolidated Schengen Borders Code has
not been updated to point at the successor; Regulation 2018/1806's own Annex IV
correlation table is what joins them. Anyone tracing the visa requirement from
the Borders Code alone will land on a repealed instrument.
