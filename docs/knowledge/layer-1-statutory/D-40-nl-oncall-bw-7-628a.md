# D-40 · Netherlands — the on-call carve-out from the employee's notice period, BW Boek 7 art. 628a

| | |
|---|---|
| **Catalogue id** | D-40 (`docs/knowledge/DOWNLOAD-MANIFEST.md`) — first entry added after the third retrieval pass closed at D-39 |
| **Source name** | Burgerlijk Wetboek Boek 7, Titel 10, **Afdeling 2 (Loon), artikel 628a** (`BWBR0005290`) — the article art. 7:672(5) refers the employee's notice period out to when the volume of work is not fixed |
| **Publisher / authority** | Ministerie van Justitie en Veiligheid, via **Overheid.nl / wetten.overheid.nl** (site operated by **KOOP**) |
| **Exact URL** | <https://wetten.overheid.nl/BWBR0005290/2026-01-01/0/Boek7/Titeldeel10/Afdeling2/Artikel628a/afdrukken> — the per-article printable form, same URL shape as D-01. **The date segment is a version selector.** |
| **Retrieved** | **2026-08-20**, by `curl` with a browser `User-Agent`. HTTP 200, **21,853 bytes**. Committed at [`sources/D-40-nl-oncall-bw-7-628a.html`](sources/D-40-nl-oncall-bw-7-628a.html). |
| **SHA-256 of the retrieved bytes** | `61aaf6c459e6569d2791a51fcd0c6671b73aef2a809b347b7d084051997829ad` |
| **Source `updatedAt`** | The page prints *"Geraadpleegd op 20-08-2026"* and the requested consolidation date `2026-01-01`. It carries the same standing wetten.overheid.nl banner D-01 quotes: *"Er is een groot aantal regelingen gewijzigd. Mogelijk zijn deze wijzigingen nog niet doorgevoerd in de geconsolideerde tekst…"* |
| **Licence / basis for inclusion** | **CC0 1.0 — bytes committed**, on exactly the basis D-01 established: KOOP's **Basis Wetten Bestand** entry in the Dutch national open-data register states `license_id: "http://creativecommons.org/publicdomain/zero/1.0/deed.nl"`. Same corpus, same publisher, same licence. Plus *Auteurswet* art. 11, which excludes statutory text from copyright. |
| **Evidence tag** | `[CONFIRMED — statute, retrieved 2026-08-20]` |

## Why this document was fetched at all

D-01 settled that a Dutch employee's notice is **one month, flat** (art. 7:672(4))
and that notice takes effect **at the end of the month** (art. 672(1)). Reading
the retrieved article in full — rather than the two limbs D-01 quoted — turns up
a **fifth paragraph that disapplies both of those rules** for a whole class of
employee, and refers the reader out to an article D-01 did not fetch:

> **5** Indien de omvang van de arbeid niet is vastgelegd, bedraagt de door de
> werknemer in acht te nemen termijn van opzegging, **in afwijking van lid 4**,
> de termijn, bedoeld in **artikel 628a, leden 2 en 4**, of **vier dagen**,
> indien het een functie betreft die is aangewezen op grond van artikel 628a,
> lid 11. **Lid 1 is niet van toepassing.**

Two things are being switched off at once, and each of them is a number this
repository would otherwise state as fact: the **one month** becomes something
else, and the **end-of-month anchor does not apply**. So D-40 is what says how
large the carve-out's numbers are.

## Article 628a, the limbs art. 672(5) points at, quoted in Dutch

> **2** Indien sprake is van een **oproepovereenkomst**, kan de werknemer door de
> werkgever niet verplicht worden aan de oproep om arbeid te verrichten gehoor te
> geven, indien de werkgever de tijdstippen waarop de arbeid moet worden verricht
> niet ten minste **vier dagen** van tevoren schriftelijk of elektronisch aan de
> werknemer bekendmaakt.
>
> **4** De termijn van vier dagen, bedoeld in de leden 2 en 3, kan bij
> **collectieve arbeidsovereenkomst** of bij regeling door of namens een daartoe
> bevoegd bestuursorgaan worden **verkort, mits de termijn niet korter is dan 24
> uur**.

And the article's own definition of the contract type the carve-out turns on:

> **9** Van een oproepovereenkomst als bedoeld in dit artikel is sprake indien:
> a. de omvang van de arbeid **niet is vastgelegd als één aantal uren per
> tijdseenheid** van: 1°. ten hoogste een maand; of 2°. ten hoogste een jaar en
> het recht op loon van de werknemer gelijkmatig is gespreid over die
> tijdseenheid; of b. de werknemer op grond van artikel 628, lid 5 of lid 7, of
> artikel 691, lid 7, geen recht heeft op het naar tijdruimte vastgestelde loon,
> indien hij de overeengekomen arbeid niet heeft verricht.

*Working translation, offered as a reading aid and **not** as a source: for an
on-call contract the employer must give at least **four days'** advance notice of
when work is to be performed (2); that four-day term may be **shortened by
collective agreement to no less than 24 hours** (4); and a contract is an
on-call contract when the volume of work is **not fixed as a single number of
hours per period** of at most a month, or of at most a year with pay spread
evenly, or where the employee has no right to time-based pay for work not
performed (9).*

## What this settles for `src/uc05/`

**The Dutch flat month is conditional, and the condition is a property of the
contract that this repository cannot read off the Remote employment record.**

Reading arts. 672(4), 672(5) and 628a together, a Dutch employee's notice is:

| The employment's volume of work | Employee's notice | End-of-month anchor |
|---|---|---|
| **Fixed** (one number of hours per period, art. 628a(9)) | **One month** — art. 672(4) | **Yes** — art. 672(1) |
| **Not fixed** / on-call | **Four days**, or as little as **24 hours** under a CAO — art. 672(5) → 628a(2), (4) | **No** — art. 672(5) final sentence |

One month against four days is not a rounding difference; it is a factor of
roughly seven, and it runs in the direction that matters. A system that reports
"one month" to an on-call worker overstates what they owe by nearly a month, and
art. 401.º's Portuguese analogue (D-02) is a reminder that an overstated notice
period is not harmless — it is the measure of a payment somebody may be asked
for.

**What is deliberately NOT proposed here is a gate.** `NOTICE_PERIOD_TABLE.NL`
encodes the fixed-hours month and cites this document beside it, and the
carve-out is carried as a caveat on every Dutch decision rather than as a branch,
for one reason: **nothing on the Remote employment record answers art. 628a(9).**
`contract_type` is `full_time` / `part_time` / `contractor` — a different
question entirely — and `work_hours_per_week` is not the test either, since
628a(9)(b) makes a contract on-call on a pay-entitlement ground with no hours
figure involved at all. Branching on `work_hours_per_week` would be a proxy this
repository invented for a statutory test, which is the exact failure
`CONTRADICTIONS.md` **C-16**, **C-25** and **C-27** each name in other use cases,
and which `CLAUDE.md` §7's UC-03 entry records as having already cost this
project a live defect once.

Recorded as [`CONTRADICTIONS.md`](CONTRADICTIONS.md) **C-28**, and cited on every
NL decision through `src/uc05/decisionSources.js`.

## What is still open

- **This is a consolidation view, not the enacting text plus its amendments.**
  wetten.overheid.nl serves the consolidated Boek 7 as at the requested date and
  warns on its own face that recent amendments may not yet be carried into it.
  That warning is quoted in the header row rather than paraphrased. Same standing
  as D-01, which is the same corpus at the same consolidation date.
- **The CAO layer is not readable from anywhere in this repository.** Art.
  628a(4) lets a collective agreement cut four days to 24 hours, and art. 672(8)
  lets a written contract lengthen the employee's month to as much as six. Both
  move the number this table reports, both live in documents Remote's API does
  not expose, and both are recorded as caveats rather than modelled.
