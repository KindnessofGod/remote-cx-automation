# D-31 · Netherlands — where a person is resident for tax, AWR art. 4

| | |
|---|---|
| **Catalogue id** | D-31 (`docs/knowledge/DOWNLOAD-MANIFEST.md`) |
| **Source name** | Algemene wet inzake rijksbelastingen, **artikel 4** (`BWBR0002320`) |
| **Publisher / authority** | Ministerie van Financiën / Ministerie van Justitie en Veiligheid, via **Overheid.nl / wetten.overheid.nl** |
| **Exact URL** | <https://wetten.overheid.nl/BWBR0002320/2026-04-11/0/HoofdstukI/Artikel4/afdrukken> |
| **Retrieved** | **2026-08-19**, by `curl`. HTTP 200, 16,871 bytes for the per-article page. The whole AWR consolidation (`https://wetten.overheid.nl/BWBR0002320`, which redirects to the `2026-04-11` version) was also fetched, HTTP 200, 172,101 bytes; the article text is identical. |
| **SHA-256 of the retrieved bytes** | `f51eeeb0ce6e6d17d2eb514acaef05197073dadc111ad25beed8250ee317a257` — re-fetched 2026-08-19, **16871 bytes**, byte count identical to the first pass. Committed at [`sources/D-31-nl-awr-art-4-residence.html`](sources/D-31-nl-awr-art-4-residence.html). |
| **Source `updatedAt`** | Consolidation **2026-04-11**, which is the version wetten.overheid.nl redirects `BWBR0002320` to as at retrieval. Same standing "may not yet reflect recent amendments" banner as D-01. |
| **Licence / basis for inclusion** | **CC0 1.0 — bytes committed.** The licence question the previous pass had to leave open is now **closed**, and not by the site-terms page it expected. `www.overheid.nl` is reachable and its `/copyright` path answers **HTTP 410**, while `/over-deze-site/informatie-hergebruiken` turns out to be about the SRU **API**, not copyright — so overheid.nl publishes no reuse-terms page at all any more. The answer is in the national open-data register instead: `data.overheid.nl`'s entry for the **Basis Wetten Bestand** — the dataset behind `wetten.overheid.nl` — names **KOOP** (Kennis- en exploitatiecentrum Officiële Overheidspublicaties, the body that runs the site) as publisher and states `license_id: "http://creativecommons.org/publicdomain/zero/1.0/deed.nl"`, `license_title: "CC-0 (1.0)"`, dataset modified 2025-10-03. Read live 2026-08-19 via <https://data.overheid.nl/data/api/3/action/package_show?id=basis-wetten-bestand> and <https://data.overheid.nl/dataset/basis-wetten-bestand>. That is on top of *Auteurswet* art. 11, which already excluded the statutory text itself from copyright. |
| **Evidence tag** | `[CONFIRMED — statute, retrieved 2026-08-19]` |

## The provision, quoted in full

> **Artikel 4**
>
> **1** Waar iemand woont en waar een lichaam gevestigd is, wordt **naar de
> omstandigheden beoordeeld**.
>
> **2** Voor de toepassing van het eerste lid worden schepen en luchtvaartuigen
> welke in Nederland hun thuishaven hebben, ten opzichte van de bemanning als
> deel van Nederland beschouwd.

*Working translation, a reading aid and not a source: where a person resides is
**assessed according to the circumstances**.*

## Why this is the entry most likely to change someone's mind

`src/uc04/riskMatrix.js` and `src/uc04/decisionFacts.js` apply a single
`RESIDENCY_LIMIT_DAYS = 183` over a single `RESIDENCY_WINDOW_DAYS = 365`
trailing window to **every** destination, and render it to the specialist as
*"183-day watch line — N of headroom."*

**The Dutch domestic rule contains no day count at all.** Article 4(1) is eleven
words and they direct that residence be judged on the circumstances. There is no
threshold to be near, so there is no headroom to have. For a Dutch destination
the system currently prints a precise number of days remaining against a line
that does not exist — which is not an off-by-a-few-days error, it is an answer
to a different question, delivered in the format of an answer to this one.

That is the shape `docs/KNOWLEDGE-SOURCES.md` Test B names: a well-formed number
rendered beside a citation, which nothing downstream can contradict.

Recorded as [`CONTRADICTIONS.md`](CONTRADICTIONS.md) **C-12**, together with the
Canadian, Portuguese and US tests it is being flattened against. **No `src/`
change is made by this pass** — and the fix here is emphatically *not* "add an
NL threshold," because there isn't one.

## Postscript — the licence, resolved 2026-08-19

The header row above records the answer; this note records why it matters. The
previous pass wrote *"no bytes committed"* and gave the reason honestly: the
site's own reuse terms lived on a host our egress refused, so half the licence
basis was unread and the safe default applied. That was the right call on the
information available.

What the allowlist opening actually produced was **not** the missing terms page.
`https://www.overheid.nl/copyright` answers **HTTP 410 Gone** (with a body that
reads "404 Pagina niet gevonden"), and the surviving *Informatie hergebruiken*
page is about the SRU search API. Overheid.nl no longer publishes a copyright
statement. Had the search stopped there, the conservative default would still
have applied — for a **better** reason than before, but the same answer.

The answer came from a different authority publishing the same corpus: KOOP's own
entry for the **Basis Wetten Bestand** in the Dutch national open-data register,
which states **CC0 1.0**. Worth keeping as a method note: *the licence for a
document is not always stated where the document is served.*
