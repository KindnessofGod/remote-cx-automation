# D-03 · Portugal — the probationary period and notice during it, CT arts. 111.º–114.º · **RETRIEVED 2026-08-19**

| | |
|---|---|
| **Catalogue id** | D-03 (`docs/knowledge/DOWNLOAD-MANIFEST.md`) |
| **Source name** | **Lei n.º 7/2009, de 12 de fevereiro** — Código do Trabalho, **Secção IV, *Período experimental***, arts. **111.º** (noção), **112.º** (duração), **113.º** (contagem) and **114.º** (*Denúncia do contrato durante o período experimental*), at pp. 950–951 of **Diário da República n.º 30/2009, 1.ª série**. Current wording of art. 114.º(3) from **Lei n.º 13/2023, de 3 de abril**, at p. 12 of **Diário da República n.º 66/2023, 1.ª série**. |
| **Publisher / authority** | Assembleia da República, published by **Diário da República Eletrónico** (INCM) |
| **Exact URL** | <https://files.diariodarepublica.pt/gratuitos/1s/2009/02/03000.pdf> · <https://files.diariodarepublica.pt/gratuitos/1s/2023/04/06600.pdf> · <https://files.diariodarepublica.pt/gratuitos/1s/2019/09/16900.pdf> (Lei 93/2019, read to check whether it touched these articles) |
| **Retrieved** | **2026-08-19**, by `curl` with a full browser header set. HTTP 200 for all three: 973,659 / 8,761,518 / 8,183,390 bytes. |
| **SHA-256 of the retrieved bytes** | `3101272ae4b54bff247f7fc5854fe5a48f4732e5434e8fd9b6e6caa4c06cd859` · `05b4b7189f78e362a524ba89473039a270761b5c042d16b3f2adbf87b6adf84f` · `3490b53b673a2ef4451841a0f128459e01d740b8f08ddbc6dc90e03dc83568cf` |
| **Source `updatedAt`** | 2009-02-12; art. 114.º(3) as amended 2023-04-03, in force **2023-05-01**. |
| **Licence / basis for inclusion** | Class **(c)** — quote and cite, **no bytes**. As D-02. |
| **Evidence tag** | `[CONFIRMED — statute, retrieved 2026-08-19]` |

## Article 114.º — and it answers the manifest's open question with a "yes"

The manifest asked whether the statute *"scales the notice with how much
probation has already elapsed"*, and said that if it does, **"the table's shape
is wrong, not just its number."** It does.

> **Artigo 114.º · Denúncia do contrato durante o período experimental**
>
> **1** — Durante o período experimental, salvo acordo escrito em contrário,
> **qualquer das partes pode denunciar o contrato sem aviso prévio** e invocação
> de justa causa, nem direito a indemnização.
>
> **2** — Tendo o período experimental durado **mais de 60 dias**, a denúncia do
> contrato **por parte do empregador** depende de aviso prévio de **sete dias**.
>
> **3** — Tendo o período experimental durado **mais de 120 dias**, a denúncia do
> contrato **por parte do empregador** depende de aviso prévio de **30 dias**.
> *(This paragraph as amended by Lei n.º 13/2023; the 2009 enacting text read
> **15 dias**.)*
>
> **4** — O não cumprimento, total ou parcial, do período de aviso prévio
> previsto nos n.os 2 e 3 determina o pagamento da retribuição correspondente ao
> aviso prévio em falta.

Lei 13/2023 additionally added ¶¶ 5–9 (reporting duties to the equality and
labour-inspection authorities, and an abuse-of-right limb); they bear on the
employer's process, not on any period.

## Two independent defects in `NOTICE_PERIOD_TABLE.PT.probation`

The field today reads `{ tenureMinMonths: 0, tenureMaxMonths: 5, noticeDays: 15 }`,
and `pickBracket()` lets a probation rule **replace** the regular bracket.

1. **It models the wrong party.** The **employee's** probation notice is
   **zero** — ¶1, either party, no notice, no indemnity — and the only notice in
   the article is the **employer's**. The 15 is the employer's figure. This is
   exactly the trap **C-14** found in the Netherlands (BW 7:672's tenure ladder
   is the employer's, the employee's is a flat month), now found a second time
   in a second country. **A table built from "the first number in the article"
   models the employer twice.**
2. **The number it borrowed is a repealed one.** 15 days was art. 114.º(3) as
   enacted in 2009; since **1 May 2023** that paragraph reads **30 days**. So the
   figure is simultaneously the wrong party's and three years out of date, and
   nothing downstream could notice either.

And the shape is wrong a third way: notice under this article is a **step
function of elapsed probation** (0 → 7 → 30 days at the 60- and 120-day marks),
not one flat number for the whole period.

Recorded as [`CONTRADICTIONS.md`](CONTRADICTIONS.md) **C-20**.

## Article 112.º — why `tenureMaxMonths: 5` has no counterpart in the statute

> **Artigo 112.º · Duração do período experimental**
>
> **1** — No contrato de trabalho por tempo indeterminado, o período
> experimental tem a seguinte duração:
> **a)** **90 dias** para a generalidade dos trabalhadores;
> **b)** **180 dias** para os trabalhadores que exerçam cargos de complexidade
> técnica, elevado grau de responsabilidade ou que pressuponham uma especial
> qualificação, bem como os que desempenhem funções de confiança;
> **c)** **240 dias** para trabalhador que exerça cargo de direcção ou quadro
> superior.
>
> **2** — No contrato de trabalho a termo […] **a)** 30 dias […] **b)** 15 dias
> […]

**Probation length in Portugal is a property of the role, not of the country.**
Three durations for permanent contracts and two more for fixed-term ones; the
table's single five-month window matches none of them. Art. 112.º(4)–(6) further
reduce or exclude probation depending on prior fixed-term work, temporary work,
service contracts or a positively-assessed traineeship for the same activity —
so the applicable probation window depends on the individual's history with that
employer, which the table has no input for.

Art. 113.º(2) adds a counting rule with the same character as the Portuguese tax
day-count (**D-32**): *"Não são considerados na contagem os dias de falta, ainda
que justificada, de licença, de dispensa ou de suspensão do contrato"* — days of
absence, leave, exemption or suspension **do not count** toward the probation
period. So even "how long has probation lasted" is not elapsed calendar time.

## What is still open

The same boundary as D-02: this is the enacting text plus the amendments in the
**two** later laws that were read in full. Both amend art. 114.º —
Lei 93/2019 art. 2.º lists it (adding what is now ¶5) and Lei 13/2023 art. 2.º
lists 111.º, 112.º and 114.º. **Amendments other than those two were not
checked**, because each is a separate gazette issue and DRE's consolidated view
remains JavaScript-only. Anything below the article level in arts. 111.º–112.º
should therefore be treated as `[CONFIRMED — as at 2023-05-01]`, not as current.

---

## Postscript — re-verified 2026-09-02, byte for byte

The 2026-09-02 employee-notice pass re-fetched the 2009 gazette issue and the
2023 amending law from the same URLs. **Both SHA-256 checksums match the header
row above exactly**, at identical byte counts. Art. 114.º was re-extracted from
the re-fetched 2009 issue and re-read.

> **1 — Durante o período experimental, salvo acordo escrito em contrário,
> qualquer das partes pode denunciar o contrato sem aviso prévio e invocação de
> justa causa, nem direito a indemnização.**
> **2** — Tendo o período experimental durado mais de 60 dias, a denúncia do
> contrato **por parte do empregador** depende de aviso prévio de sete dias.
> **3** — Tendo o período experimental durado mais de 120 dias, a denúncia do
> contrato **por parte do empregador** depende de aviso prévio de 15 dias.
> *(2009 enacting text; ¶3's figure raised to 30 dias by Lei 13/2023.)*

Confirmed unchanged: the **employee's** probation notice is **zero**; the seven-
and 15-day (now 30-day) figures are **the employer's**; and the shape is a step
function of elapsed probation, not one flat number. **C-20 stands in all three
of its parts.**

The 2026-09-02 pass also confirms the arithmetic that makes C-20 concrete rather
than abstract: `NOTICE_PERIOD_TABLE.PT.probation` is
`{ tenureMinMonths: 0, tenureMaxMonths: 5, noticeDays: 15 }` and
`pickBracket()` lets a probation rule **replace** the ordinary bracket — so a
Portuguese employee on probation is told they owe **15 days** where art. 114.º(1)
says they owe **none**, and the 15 is a figure that was the employer's when it
was written and has since been repealed even for the employer. Three errors
compounding into one number that nothing downstream can question.
