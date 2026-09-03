# D-45 · Germany — BGB § 622. **THE STATUTE COULD NOT BE RETRIEVED.** What is here is the responsible federal ministry's own statement of it · **2026-09-02**

> ## Read this box before quoting anything below it
>
> **`gesetze-im-internet.de` — the Federal Ministry of Justice's official
> consolidated federal-law portal, and the only place BGB § 622's current wording
> is published by an authority — is unreachable from this container.** Every
> other country in this pass was retrieved from its own statute book. Germany was
> not, and nothing below is the statutory text.
>
> What *is* below is **Bundesministerium für Arbeit und Soziales**, *Arbeitsrecht*
> (Best.-Nr. A 711), Stand Januar 2025 — the responsible federal ministry
> describing the periods § 622 imposes and **who each of them binds**. That is
> the same class of source as the US DOL pages behind **D-06**: an agency
> statement, useful, citable, and **one degree weaker than the statute**. It is
> tagged accordingly and must not be re-tagged upward by anyone who reads this
> later.
>
> The failure is recorded in [`RETRIEVAL-BLOCKED.md`](RETRIEVAL-BLOCKED.md) with
> everything that was tried.

| | |
|---|---|
| **Catalogue id** | D-45 (`docs/knowledge/DOWNLOAD-MANIFEST.md`) — added by the 2026-09-02 employee-notice pass. **The statutory slot is unfilled**; this is the agency substitute and the catalogue row says so. |
| **Source name** | **Bundesministerium für Arbeit und Soziales**, *Arbeitsrecht*, Best.-Nr. **A 711**, **Stand: Januar 2025**, 101 pp. — the section headed *Gesetzliche Kündigungsfristen* at pp. 79–80. |
| **Publisher / authority** | **Bundesministerium für Arbeit und Soziales** (Referat Information, Monitoring, Bürgerservice), Wilhelmstraße 49, 10117 Berlin — the federal ministry responsible for German labour law. |
| **Exact URL** | <https://www.bmas.de/SharedDocs/Downloads/DE/Publikationen/a711-arbeitsrecht.pdf?__blob=publicationFile&v=8>, linked from <https://www.bmas.de/DE/Arbeit/Arbeitsrecht/Arbeitnehmerrechte/Kuendigungsschutz/kuendigungsschutz-art.html> |
| **Retrieved** | **2026-09-02**, by `curl` following redirects. HTTP 200, **1,983,253 bytes**, `application/pdf`. |
| **SHA-256 of the retrieved bytes** | `75972fe9653bfff53a24807f72ea0d35a452e6aad7b51d679f77ad7777a4bca1` |
| **Source `updatedAt`** | Imprint: **Stand: Januar 2025**. PDF `CreationDate 2025-04-11`, `ModDate 2025-04-28`. |
| **Licence / basis for inclusion** | Class **(c)** — **quote and cite, no bytes**, on the publication's own terms, quoted verbatim from its imprint: *« Wenn Sie aus dieser Publikation zitieren wollen, dann bitte mit genauer Angabe des Herausgebers, des Titels und des Stands der Veröffentlichung. »* — quote with exact statement of publisher, title and edition date. All three are in the rows above. |
| **Evidence tag** | **`[AGENCY — federal ministry publication, retrieved 2026-09-02; the statute itself was NOT retrieved]`**. Deliberately **not** `[CONFIRMED — statute]`. |

## What the ministry says, quoted in German

> **Gesetzliche Kündigungsfristen**
>
> Für Arbeiter und Angestellte gelten einheitliche gesetzliche Kündigungsfristen.
> Die **Grundkündigungsfrist**, die **Arbeitgeber sowie Arbeitnehmerinnen und
> Arbeitnehmer** einzuhalten haben, beträgt **vier Wochen (28 Kalendertage) zum
> 15. des Monats oder zum Ende eines Kalendermonats**.
>
> Ausnahmen:
> • Wenn ein Arbeitnehmer zur **vorübergehenden Aushilfe** eingestellt ist, kann
>   für die ersten drei Monate einzelvertraglich eine kürzere Kündigungsfrist
>   vereinbart werden.
> • In Betrieben, in denen in der Regel **nicht mehr als 20 Arbeitnehmer**
>   beschäftigt sind, kann durch Einzelvertrag eine vierwöchige
>   Grundkündigungsfrist **ohne festen Kündigungstermin** vereinbart werden. […]
> • Die Kündigungsfrist während einer **vereinbarten Probezeit**, längstens für
>   die Dauer von **sechs Monaten**, beträgt **zwei Wochen**.
>
> Je nach Dauer des bestehenden Beschäftigungsverhältnisses hat **der
> Arbeitgeber** bei einer Kündigung längere Kündigungsfristen als die
> Grundkündigungsfrist (**verlängerte Kündigungsfristen**) einzuhalten.
> Die verlängerten Kündigungsfristen betragen nach
> • 2-jähriger Betriebszugehörigkeit – 1 Monat zum Ende eines Kalendermonats,
> • 5-jähriger – 2 Monate, • 8-jähriger – 3 Monate, • 10-jähriger – 4 Monate,
> • 12-jähriger – 5 Monate, • 15-jähriger – 6 Monate, • 20-jähriger – 7 Monate
> zum Ende eines Kalendermonats.
>
> In Tarifverträgen können alle Kündigungsfristen verlängert oder verkürzt
> werden. **Es ist nicht zulässig, in Tarif- und Arbeitsverträgen für
> Arbeitnehmer längere Kündigungsfristen als für Arbeitgeber festzuschreiben.**

*Working translation, offered as a reading aid: the **basic** notice period,
which **employers and employees alike** must observe, is **four weeks (28
calendar days) to the 15th of the month or to the end of a calendar month**;
during an **agreed** probationary period, at most six months long, it is **two
weeks**; and the **extended**, tenure-graduated periods of 1–7 months are the
ones **the employer** must observe. Collective agreements may lengthen or shorten
any of them, but **may not impose a longer period on the employee than on the
employer**.*

## What this means for `NOTICE_PERIOD_TABLE.DE` — and it is the good news of this pass

`NOTICE_PERIOD_TABLE.DE` today reads a single flat bracket
`{0–∞ → 28 days}`, `probation: {0–6 months → 14 days}`, `anchorRule:
"month_15"`, citing *"BGB §622 (4 weeks, 15th/end of month; 2 weeks during
probation)"*.

**Germany is the row that got the employer/employee split right.** The ministry's
own text separates the two obligations in as many words: the Grundkündigungsfrist
is what *"Arbeitgeber sowie Arbeitnehmerinnen und Arbeitnehmer"* must observe;
the verlängerte Kündigungsfristen are what *"der Arbeitgeber"* must observe. The
table encodes the first and **does not** encode the second — the exact discipline
the United Kingdom row (**C-31**) fails, the Netherlands row was saved from
(**C-14**) and Portugal's probation row fails (**C-20**).

The `28` and the `14` are corroborated. So is the probation ceiling of six
months. Recorded as a confirmation, [`CONTRADICTIONS.md`](CONTRADICTIONS.md)
**K-6**, and **at agency strength, not statutory strength** — that qualification
is in the K-item too.

Three things the ministry states that the table has no field for:

1. **The anchor is a disjunction: the 15th of the month *or* the end of a
   calendar month.** `anchorRule: "month_15"` names one of the two. Whether the
   calculator picks the earlier of the two permissible dates is a code question
   this pass did not open, and it is the one place where the German row could be
   silently wrong by up to about two weeks.
2. **In establishments of ≤ 20 employees the anchor may be contracted away
   entirely** — a four-week period *ohne festen Kündigungstermin*. Headcount is
   not a field on a Remote employment record.
3. **Probation must have been *agreed*** (*vereinbarte Probezeit*). The table
   treats probation as a boolean from the employment record, which is the right
   shape, but the underlying fact is contractual.

## What is still open, and it is the whole statute

- **BGB § 622's own text has not been read by this repository.** Everything above
  is the ministry's account of it. In particular, the paragraph numbering
  (§ 622(1) basic period, § 622(2) graduated periods, § 622(3) probation,
  § 622(6) the no-longer-for-the-employee rule) is **not** evidenced here — the
  brochure cites no paragraph numbers at all. **Do not write subsection numbers
  into `sourceCitation` on the strength of this document.**
- The row's current citation string, *"BGB §622"*, is therefore accurate at the
  article level and unevidenced at the subsection level, which is the honest
  place for it to stay until the statute is retrieved.
