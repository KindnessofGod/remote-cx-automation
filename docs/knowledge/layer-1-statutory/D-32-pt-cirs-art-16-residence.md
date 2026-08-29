# D-32 · Portugal — fiscal residence, CIRS art. 16.º · **RETRIEVED 2026-08-19**

| | |
|---|---|
| **Catalogue id** | D-32 (`docs/knowledge/DOWNLOAD-MANIFEST.md`) |
| **Source name** | *Código do Imposto sobre o Rendimento das Pessoas Singulares* (CIRS), **artigo 16.º — Residência**, in the tax authority's own consolidated presentation of the code |
| **Publisher / authority** | **Autoridade Tributária e Aduaneira (AT)**, Portal das Finanças |
| **Exact URL** | <https://info.portaldasfinancas.gov.pt/pt/informacao_fiscal/codigos_tributarios/cirs_rep/Pages/irs16.aspx> |
| **Retrieved** | **2026-08-19**, by `curl` with a full browser header set. HTTP 200, **71,604 bytes** of HTML. |
| **SHA-256 of the retrieved bytes** | `a06b333ef079eb42a41ad0cdd480fa73eebd303e68bfd33622b21fe7350131dd` |
| **Source `updatedAt`** | **The page prints no date.** Its own in-line notes date the current wording of individual paragraphs: ¶¶ 8–12 are marked *"(Revogado.) (Revogação dada pela Lei n.º 82/2023, de 29 de dezembro)"*, and the page carries the transitional provision of art. 236.º of that law. So the text is **no earlier than 2024-01-01** and its currency beyond that is unestablished. |
| **Licence / basis for inclusion** | Class **(c)** — quote and cite, **no bytes.** The statutory text is outside copyright; **no reuse terms were located on `info.portaldasfinancas.gov.pt`**, and `KNOWLEDGE-SOURCES.md` L1-07's rule applies — *"many national portals carry restrictive terms or no stated terms at all. Check per country; do not assume."* |
| **Evidence tag** | `[CONFIRMED — statute via the administering authority's consolidation, retrieved 2026-08-19]` |

> **Why not DRE.** The original instrument is Decreto-Lei n.º 442-A/88 and art.
> 16.º has been rewritten repeatedly since — most recently by Lei n.º 82/2023.
> The 1988 gazette PDF **is** now reachable
> (`https://files.diariodarepublica.pt/gratuitos/1s/1988/11/27701.pdf`, HTTP 200)
> and was deliberately **not** used: a 1988 text presented as the residence rule
> would be worse than the blank it replaced. The AT is the authority that
> administers the tax and publishes the consolidation, and it is the right source
> for a consolidated read. This is the same judgement, rotated, as the one that
> refuses `raw.githubusercontent.com`.

## Article 16.º, ¶¶ 1–5 — the operative provisions, quoted

> **1** — São residentes em território português as pessoas que, no ano a que
> respeitam os rendimentos:
> **a)** Hajam nele permanecido **mais de 183 dias, seguidos ou interpolados, em
> qualquer período de 12 meses com início ou fim no ano em causa**;
> **b)** Tendo permanecido **por menos tempo**, aí disponham, num qualquer dia do
> período referido na alínea anterior, de **habitação em condições que façam
> supor intenção atual de a manter e ocupar como residência habitual**;
> **c)** Em 31 de dezembro, sejam tripulantes de navios ou aeronaves […];
> **d)** Desempenhem no estrangeiro funções ou comissões de carácter público, ao
> serviço do Estado Português.
>
> **2** — Para efeitos do disposto no número anterior, considera-se como **dia de
> presença** em território português **qualquer dia, completo ou parcial, que
> inclua dormida no mesmo**.
>
> **3** — As pessoas que preencham as condições previstas nas alíneas *a)* ou
> *b)* do n.º 1 tornam-se residentes **desde o primeiro dia do período de
> permanência** em território português, salvo quando tenham aí sido residentes
> em qualquer dia do ano anterior, caso em que se consideram residentes **desde o
> primeiro dia do ano** […]
>
> **4** — A perda da qualidade de residente ocorre a partir do **último dia de
> permanência** […]
>
> **5** — A residência fiscal é aferida **em relação a cada sujeito passivo do
> agregado**.

Paragraphs 14–16 add a whole-year rule in the year of departure where the person
both spent more than 183 days in Portugal that year **and** afterwards earned
income that would have been taxable had they stayed, subject to a
comparable-taxation carve-out in ¶15.

## What this closes, and what it opens

Portugal was **the last of the four demo countries whose domestic residence test
was unknown to this corpus** ([`CONTRADICTIONS.md`](CONTRADICTIONS.md) **C-12**
listed it as *"Unknown to this corpus"*). It is now known, and it is a fourth
distinct shape rather than a match for any of the other three:

- **There is a 183-day line**, so unlike the Netherlands the number is not
  fictitious — but its window is *"any 12-month period beginning or ending in
  the year concerned"*, which is anchored on the **tax year**, not on a trip.
  `RESIDENCY_WINDOW_DAYS = 365` counted back from a trip start is a different
  computation that can be wrong in either direction.
- **A day is counted only if it includes an overnight stay** (¶2), and it is
  counted whether complete or partial. `computePresenceDays()` counts date
  ranges. A same-day trip in and out is zero days in Portugal and one day to the
  code; conversely a partial arrival day with a night in Portugal is a **whole**
  day.
- **¶1(b) makes residence reachable with fewer days and no count at all** — a
  dwelling held in conditions suggesting an intent to keep it as a habitual
  residence. So "N days of headroom below 183" is not a safe statement even
  where the 183 line exists. It is the *Dutch* problem (**C-12**) hiding inside
  a country that does have a threshold.
- **¶3 back-dates residence to the first day of the stay**, and to 1 January if
  the person was resident on any day of the previous year. Canada's s. 250(1)(a)
  also back-dates, to 1 January of the taxation year — **two retroactivity rules
  with different anchors**, and the repo has neither.
- **¶5 assesses residence per taxpayer, not per household** — worth recording
  because a dossier that reasons about "the family" would be reasoning about the
  wrong unit.

Recorded as **C-12** (rewritten to a complete four-country table) and **C-21**
(the day-counting convention).

**No threshold from this document is proposed for `src/`.**
`src/uc08/jurisdictionKnowledge.js` asserts that `183`, `365` and `180` appear
nowhere in its register, and this entry is a reason that assertion is right: the
number 183 appears in three of the four demo countries' domestic tests and means
something different in each.
