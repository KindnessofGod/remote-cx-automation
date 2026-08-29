# D-01 · Netherlands — notice periods, BW Boek 7 art. 672

| | |
|---|---|
| **Catalogue id** | D-01 (`docs/knowledge/DOWNLOAD-MANIFEST.md`) · L1-09 (`docs/KNOWLEDGE-SOURCES.md` §4) |
| **Source name** | Burgerlijk Wetboek Boek 7, Titel 10, Afdeling 9, **artikel 672** (`BWBR0005290`) |
| **Publisher / authority** | Ministerie van Justitie en Veiligheid, via **Overheid.nl / wetten.overheid.nl** |
| **Exact URL** | <https://wetten.overheid.nl/BWBR0005290/2026-01-01/0/Boek7/Titeldeel10/Afdeling9/Artikel672/afdrukken> — the per-article printable form. **The date segment is a version selector**; `2026-01-01` was chosen as the consolidation in force at retrieval. `2026-08-19` in that position returns **HTTP 404**, which is a version-not-published error and not a dead link. |
| **Retrieved** | **2026-08-19**, by `curl`. HTTP 200, 20,336 bytes for the per-article page (the whole Boek 7 consolidation at `https://wetten.overheid.nl/BWBR0005290/2025-01-01/` was also fetched, HTTP 200, 755,868 bytes, and the article text is identical in both). |
| **SHA-256 of the retrieved bytes** | `1332b7bbe284c681151622b5afed05c71e9f58a915462e9e98e5b304ea9c4f3f` — re-fetched 2026-08-19, **20336 bytes**, byte count identical to the first pass. Committed at [`sources/D-01-nl-notice-bw-7-672.html`](sources/D-01-nl-notice-bw-7-672.html). |
| **Source `updatedAt`** | The page prints *"Geraadpleegd op 19-08-2026"* (consulted on) and the requested consolidation date `2026-01-01`. wetten.overheid.nl carries a standing banner warning that recent amendments may not yet be reflected in the consolidated text — quoted: *"Er is een groot aantal regelingen gewijzigd. Mogelijk zijn deze wijzigingen nog niet doorgevoerd in de geconsolideerde tekst en ziet u nog een oude versie."* |
| **Licence / basis for inclusion** | **CC0 1.0 — bytes committed.** The licence question the previous pass had to leave open is now **closed**, and not by the site-terms page it expected. `www.overheid.nl` is reachable and its `/copyright` path answers **HTTP 410**, while `/over-deze-site/informatie-hergebruiken` turns out to be about the SRU **API**, not copyright — so overheid.nl publishes no reuse-terms page at all any more. The answer is in the national open-data register instead: `data.overheid.nl`'s entry for the **Basis Wetten Bestand** — the dataset behind `wetten.overheid.nl` — names **KOOP** (Kennis- en exploitatiecentrum Officiële Overheidspublicaties, the body that runs the site) as publisher and states `license_id: "http://creativecommons.org/publicdomain/zero/1.0/deed.nl"`, `license_title: "CC-0 (1.0)"`, dataset modified 2025-10-03. Read live 2026-08-19 via <https://data.overheid.nl/data/api/3/action/package_show?id=basis-wetten-bestand> and <https://data.overheid.nl/dataset/basis-wetten-bestand>. That is on top of *Auteurswet* art. 11, which already excluded the statutory text itself from copyright. |
| **Evidence tag** | `[CONFIRMED — statute, retrieved 2026-08-19]` for the text · `[SILENT]` for the site's reuse terms |

## Article 7:672, the limbs that matter, quoted in Dutch

> **1** Opzegging geschiedt **tegen het einde van de maand**, tenzij bij
> schriftelijke overeenkomst of door het gebruik een andere dag daarvoor is
> aangewezen.
>
> **2** De door **de werkgever** in acht te nemen termijn van opzegging bedraagt
> bij een arbeidsovereenkomst die op de dag van opzegging: a. korter dan vijf
> jaar heeft geduurd: **één maand**; b. vijf jaar of langer, maar korter dan
> tien jaar: **twee maanden**; c. tien jaar of langer, maar korter dan vijftien
> jaar: **drie maanden**; d. vijftien jaar of langer: **vier maanden**.
>
> **4** De door **de werknemer** in acht te nemen termijn van opzegging bedraagt
> **één maand**.
>
> **8** Van de termijn, bedoeld in lid 4, kan **schriftelijk worden afgeweken**.
> De termijn van opzegging voor de werknemer mag bij verlenging **niet langer
> zijn dan zes maanden** en voor de werkgever niet korter dan het dubbele van
> die voor de werknemer.

*Working translation, offered as a reading aid and **not** as a source: notice
takes effect at the end of the month unless otherwise agreed in writing (1); the
**employer's** notice is 1/2/3/4 months by tenure bands of <5 / 5–10 / 10–15 /
15+ years (2); the **employee's** notice is **one month**, flat, regardless of
tenure (4); the employee's period may be extended in writing to at most six
months, and if it is, the employer's must be at least double it (8).*

## What this settles for `src/uc05/`

`NOTICE_PERIOD_TABLE` covers `GB IE DE PL IN PH MX CA PT` — **the Netherlands is
absent**, so `getNoticeRule("NL")` returns `null` and every Dutch resignation
escalates as `unsupported_country`. That behaviour is correct and it is also a
demo country that cannot be decided.

Three things the article supplies that the table's *shape* would otherwise get
wrong, and they are the reason this document mattered more than its one number:

1. **The employee's obligation is not tenure-banded at all.** It is a flat one
   month. The tenure brackets in art. 672 are the **employer's**. A row written
   from "the first numbers in the article" would model the wrong party — which
   is precisely what the manifest warned about.
2. **`anchorRule: "month_end"` finally has a referent.** The type union in
   `noticePeriodTable.js` already contains `month_end` and nothing uses it.
   Art. 672(1) is what it was for.
3. **The flat month is a default, not a floor.** Lid 8 lets a written contract
   extend it up to six months, with a coupling rule on the employer's side. A
   table that reports "NL: 30 days" as a fact rather than as a statutory default
   would be wrong for any employee whose contract says otherwise.

Recorded as [`CONTRADICTIONS.md`](CONTRADICTIONS.md) **C-14**. **No `src/`
change is made by this pass.**

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
