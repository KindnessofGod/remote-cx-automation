# D-43 · Poland — notice periods and how they end, Kodeks pracy arts. 30, 32, 34, 36 · **RETRIEVED 2026-09-02**

| | |
|---|---|
| **Catalogue id** | D-43 (`docs/knowledge/DOWNLOAD-MANIFEST.md`) — added by the 2026-09-02 employee-notice pass |
| **Source name** | **Ustawa z dnia 26 czerwca 1974 r. — Kodeks pracy**, in the consolidated text (*tekst jednolity*) announced by **Obwieszczenie Marszałka Sejmu RP z dnia 14 lutego 2025 r.**, **Dz.U. 2025 poz. 277**. Articles **30 § 2¹** (how a notice period ends), **32** (either party may give notice), **34** (probation-contract notice), **36** (notice periods by tenure). |
| **Publisher / authority** | **Sejm Rzeczypospolitej Polskiej**, via the official ELI API `api.sejm.gov.pl` — the same corpus served by ISAP. |
| **Exact URL** | <https://api.sejm.gov.pl/eli/acts/DU/2025/277/text.pdf> (the gazette PDF) · <https://api.sejm.gov.pl/eli/acts/DU/2025/277> (metadata) · <https://api.sejm.gov.pl/eli/acts/DU/1974/141> (the base act, from whose `Inf. o tekście jednolitym` list `DU/2025/277` was identified as the newest consolidation) |
| **Retrieved** | **2026-09-02**, by `curl`. HTTP 200, **2,089,207 bytes**, 2025 pages of gazette. **`isap.sejm.gov.pl` itself was tried first and is unusable from here** — it is behind an Imperva/Incapsula interstitial that returns HTTP 200 with a *"Pardon Our Interruption … your browser made us think you were a bot"* page instead of the document. The ELI API on `api.sejm.gov.pl` is the same publisher and answers cleanly; that substitution is stated rather than silent. |
| **SHA-256 of the retrieved bytes** | `d6ae73698d2c91cb501a8bc46229730c65cbc454071c9c8a9a7fa8fed2d46a00` |
| **Source `updatedAt`** | Consolidation announced **2025-02-14**, promulgated **2025-03-06**. **Currency was checked forward rather than assumed** — see the next section. |
| **Licence / basis for inclusion** | **No copyright subsists in the text.** *Ustawa z dnia 4 lutego 1994 r. o prawie autorskim i prawach pokrewnych*, **art. 4**, retrieved in the same pass from the same authority (consolidated text Dz.U. 2025 poz. 24, SHA-256 `1c2e9a082a66fad6e26bba1d4d01a22bd67871657416729cea62b4b9f71cff86`): *"**Nie stanowią przedmiotu prawa autorskiego:** 1) **akty normatywne lub ich urzędowe projekty**; 2) urzędowe dokumenty, materiały, znaki i symbole; …"* — normative acts are not an object of copyright. **No bytes committed anyway, on size**: 2.0 MB is larger than every file in `sources/` and sits in the same band as the 2.1 MB IRS publication that `sources/README.md` §2 declines. Byte count and checksum above make that reversible. |
| **Evidence tag** | `[CONFIRMED — statute, retrieved 2026-09-02]` |

## Currency: the consolidation is not the last word, and it was checked

`DU/1974/141` lists **140** amending acts. Seven of them take effect **after** the
2025-02-14 consolidation and were each downloaded and read for their
*"W ustawie … — Kodeks pracy … wprowadza się następujące zmiany"* article:
**Dz.U. 2026 poz. 473** (in force 2026-07-08), **2026 poz. 25** (2026-01-27),
**2025 poz. 807** (2025-12-24), **2025 poz. 1661** (2025-12-13), **2025 poz.
1423** (2026-01-01), **2024 poz. 1871** (2025-03-19), and **2026 poz. 1046**
(not yet in force — **2026-11-05**).

**None of them amends art. 30, 32, 34 or 36.** Three of the seven do contain the
string *"w art. 36"*, and all three are amending a **different statute** in the
same omnibus — the Państwowa Inspekcja Pracy Act, the social-insurance system
Act, and the Karta Nauczyciela. A grep for the article number alone would have
reported a change that is not there; the check that answers the question is which
Act the amending article opens with.

So the four articles below are current as at **2026-09-02**.

## The articles, quoted in Polish

> **Art. 30.** § 1. Umowa o pracę rozwiązuje się: … 2) przez oświadczenie jednej
> ze stron z zachowaniem okresu wypowiedzenia …
>
> **§ 2¹.** Okres wypowiedzenia umowy o pracę obejmujący **tydzień lub miesiąc
> albo ich wielokrotność** kończy się odpowiednio **w sobotę** lub **w ostatnim
> dniu miesiąca**.

> **Art. 32.** § 1. **Każda ze stron** może rozwiązać umowę o pracę za
> wypowiedzeniem.
> § 2. Rozwiązanie umowy o pracę następuje z upływem okresu wypowiedzenia.

> **Art. 34.** Okres wypowiedzenia umowy o pracę zawartej **na okres próbny**
> wynosi:
> 1) **3 dni robocze**, jeżeli okres próbny nie przekracza 2 tygodni;
> 2) **1 tydzień**, jeżeli okres próbny jest dłuższy niż 2 tygodnie;
> 3) **2 tygodnie**, jeżeli okres próbny wynosi 3 miesiące.

> **Art. 36.** § 1. Okres wypowiedzenia umowy o pracę zawartej na czas
> nieokreślony i umowy o pracę zawartej na czas określony jest uzależniony od
> **okresu zatrudnienia u danego pracodawcy** i wynosi:
> 1) **2 tygodnie**, jeżeli pracownik był zatrudniony **krócej niż 6 miesięcy**;
> 2) **1 miesiąc**, jeżeli pracownik był zatrudniony **co najmniej 6 miesięcy**;
> 3) **3 miesiące**, jeżeli pracownik był zatrudniony **co najmniej 3 lata**.
>
> **§ 1¹.** Do okresu zatrudnienia, o którym mowa w § 1, wlicza się pracownikowi
> okres zatrudnienia u poprzedniego pracodawcy, jeżeli zmiana pracodawcy
> nastąpiła na zasadach określonych w art. 23¹ …
>
> **§ 5.** Jeżeli pracownik jest zatrudniony na stanowisku związanym z
> odpowiedzialnością materialną za powierzone mienie, strony mogą ustalić w
> umowie o pracę, że w przypadku, o którym mowa w § 1 pkt 1, okres wypowiedzenia
> wynosi 1 miesiąc, a w przypadku, o którym mowa w § 1 pkt 2 — 3 miesiące.
>
> **§ 6.** Strony mogą po dokonaniu wypowiedzenia umowy o pracę przez jedną z
> nich ustalić **wcześniejszy termin rozwiązania umowy**; ustalenie takie nie
> zmienia trybu rozwiązania umowy o pracę.

*Working translation, offered as a reading aid and **not** as a source: a notice
period comprising a week or a month, or a multiple of either, ends respectively
**on a Saturday** or **on the last day of the month** (art. 30 § 2¹); **either
party** may terminate by notice (art. 32 § 1); a probation-contract notice is
**3 working days / 1 week / 2 weeks** depending on **how long the probation
period itself is** (art. 34); and the ordinary notice period depends on the
length of employment **with that employer** and is **2 weeks / 1 month / 3
months** below 6 months, from 6 months, and from 3 years (art. 36 § 1).*

## What this settles for `src/uc05/noticePeriodTable.js`

`NOTICE_PERIOD_TABLE.PL` today reads
`[{0–5 → 14 days}, {6–35 → 30 days}, {36+ → 90 days}]`, `probation: null`,
`anchorRule: "month_1st"`, citing *"Kodeks Pracy art. 36 §1 (tenure-bracketed,
1st-of-month anchor for monthly notices)"*, with a code comment asserting that
*"2-week notices end on a Saturday; 1- and 3-month notices start on the 1st of
the following month."*

**Poland is the one country in this pass that models the right party**, and that
is worth stating first because everything else here is a fault. Art. 36 § 1 is
not addressed to either side, and art. 32 § 1 makes the notice mutual in terms:
*każda ze stron*. The bracket boundaries are also right — `<6 months`,
`≥6 months`, `≥3 years` map exactly onto `0–5`, `6–35`, `36+` in whole months.
Recorded as a confirmation, [`CONTRADICTIONS.md`](CONTRADICTIONS.md) **K-5**.

Three things are wrong, and two of them move a date:

| | Table | Art. 30/34/36 |
|---|---|---|
| Where a monthly notice ends | `month_1st` — *"start on the 1st of the following month"* | **The last day of the month** (art. 30 § 2¹). The rule is about where the period **ends**, and the table points at the opposite end of the boundary. |
| Where a weekly notice ends | passed as a note on the return value | **Saturday** (art. 30 § 2¹) — the same sentence, the same statutory status as the monthly rule, and the only reason it is a note rather than a rule is that `anchorRule` has no value for it. |
| The unit | `30` and `90` **days** | **1 month** and **3 months**. `noticeMonths` exists on `NoticeBracket` for exactly this and is used only by the Netherlands. |
| Probation | `probation: null` | **Art. 34 exists**, and it is a step function of the length of the probation period — *not* of tenure — measured in **working days** for its first rung. |

Recorded as **C-33** (the anchor and the units) and **C-34** (the missing
probation rule).

**The units and the anchor are one defect, not two.** This is the identical
argument the Dutch row's `noticeMonths` note already makes and it lands harder
here, because Poland's anchor is stated in the *same subsection* as the weekly
one: 30 days added to a resignation filed on the 1st of a 31-day month, then
snapped to the end of that month, lands on the 31st of the **same** month — a
full month early. Adding one calendar month first, then taking its end, is what
art. 36 § 1 pkt 2 read with art. 30 § 2¹ produces.

## Two dimensions the table has no field for

1. **Art. 36 § 5 — a contractual extension for materially-responsible posts.**
   Where the employee is responsible for entrusted property, the parties may
   agree 1 month in place of 2 weeks and 3 months in place of 1 month. Same shape
   as BW 7:672(8) (**C-14**), CT art. 400.º(2) (**D-02**) and ERA 1996 s. 86(3)
   (**D-41**): the statutory period is a default, and this is now the fourth
   country in which the corpus has found that.
2. **Art. 36 § 1¹ — tenure carries across a transfer of undertaking** (art. 23¹).
   A Remote employment record's start date with the current employer is not
   necessarily the `okres zatrudnienia` art. 36 keys on.

## What is still open

- **Art. 302¹, in force 2026-01-01** (added by Dz.U. 2025 poz. 1423), counts
  periods of self-employment, mandate/agency contracts and cooperative membership
  into *"okres zatrudnienia"*. Art. 36 § 1 says *"okresu zatrudnienia **u danego
  pracodawcy**"* — with **that** employer — so on its face art. 302¹ does not
  reach it. **This is flagged and not decided**: it is a question about the
  interaction of two articles, it is nine months old, and answering it is legal
  interpretation rather than retrieval.
- **`unit: "calendar"` on the PL row is a table-wide assumption**, and art. 34
  pkt 1 contradicts it directly with *dni robocze* — working days.
