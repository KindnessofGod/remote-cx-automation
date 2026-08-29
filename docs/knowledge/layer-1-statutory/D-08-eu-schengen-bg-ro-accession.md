# D-08 · Bulgaria and Romania — the two Council decisions that date the Schengen set

| | |
|---|---|
| **Catalogue id** | D-08 (`docs/knowledge/DOWNLOAD-MANIFEST.md`) · L1-05 (`docs/KNOWLEDGE-SOURCES.md` §4) |
| **Source name** | (1) Council Decision (EU) **2024/210** of 30 December 2023 *on the full application of the provisions of the Schengen acquis in the Republic of Bulgaria and Romania*. (2) Council Decision (EU) **2024/3212** of 12 December 2024 *setting the date for the lifting of checks on persons at internal land borders with and between the Republic of Bulgaria and Romania*. |
| **Publisher / authority** | Council of the European Union, via the Publications Office (EUR-Lex) |
| **Exact URL** | <https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32024D0210> and <https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32024D3212> |
| **Retrieved** | **2026-08-19**, by `curl`. HTTP 200 for both — **55201 bytes** and **17447 bytes**, stored at [`sources/D-08-eu-schengen-bg-ro-decision-2024-210.html`](sources/D-08-eu-schengen-bg-ro-decision-2024-210.html) and [`sources/D-08-eu-schengen-bg-ro-decision-2024-3212.html`](sources/D-08-eu-schengen-bg-ro-decision-2024-3212.html). |
| **SHA-256 of the retrieved bytes** | 2024/210: `5b9663fa075f06a9adf9d5906e9c73b1e53e12ee816f191526c1095722a91755` · 2024/3212: `6f151a61dd60299de848fc76c4b5b8f2908bac322b42469390f9b6b0bebfbb7a` |
| **Source `updatedAt`** | Published in the Official Journal **4.1.2024** (2024/210) and **23.12.2024** (2024/3212). Neither has been amended; these are the acts, not consolidations. |
| **Licence / basis for inclusion** | EUR-Lex reuse, Commission Decision 2011/833/EU, verified live 2026-08-19. These are OJ acts rather than consolidated texts, so the CC BY 4.0 editorial layer does not arise. Bytes committed. |
| **Evidence tag** | `[CONFIRMED — statute, retrieved 2026-08-19]` |

> **The manifest's guessed identifier was wrong and is now corrected.**
> `DOWNLOAD-MANIFEST.md` §6 offered `.../eli/dec/2024/3206/oj/eng` as a
> candidate for the land-border decision, flagged as unconfirmed. Fetched:
> **CELEX 32024D3206 is a Council Implementing Decision authorising Latvia to
> derogate from the VAT Directive.** Nothing to do with Schengen. The correct
> instrument is **2024/3212**, found through EUR-Lex's own search rather than by
> pattern. This is exactly the "plausible deep link" failure the manifest was
> written to avoid, caught by fetching.

## The two operative sentences

> **Decision (EU) 2024/210, Article 1.** From **31 March 2024**, checks on
> persons at internal **air and sea** borders with and between Bulgaria and
> Romania shall be lifted …

> **Decision (EU) 2024/3212, Article 1.** From **1 January 2025**, checks on
> persons at internal **land** borders with and between Bulgaria and Romania
> shall be lifted.

## What this settles — and it settles more than it was fetched for

Article 1 of Decision 2024/210 **enumerates the states the acquis then applies
between**: Bulgaria and Romania, plus Belgium, Czechia, Denmark, Germany,
Estonia, Greece, Spain, France, Croatia, Italy, Latvia, Lithuania, Luxembourg,
Hungary, Malta, the Netherlands, Austria, Poland, Portugal, Slovenia, Slovakia,
Finland and Sweden, "as well as Iceland, the Principality of Liechtenstein, the
Kingdom of Norway and the Swiss Confederation."

That is **25 EU Member States plus 4 associated states = 29** — and
`SCHENGEN` in `src/uc04/riskMatrix.js` holds **29 codes**. The set the
repository already had is **consistent with the Council's own enumeration**, and
now has the *as of when* that `docs/KNOWLEDGE-SOURCES.md` L1-05 said it needed:
**air and sea from 2024-03-31, land from 2025-01-01**. Cyprus and Ireland are
correctly absent.

This is a **confirmation**, not a contradiction, and it is recorded as one in
[`CONTRADICTIONS.md`](CONTRADICTIONS.md) **K-1** — a corpus that only ever
reports faults teaches a reader to distrust everything equally.
