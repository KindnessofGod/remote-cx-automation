# D-02 · Portugal — employee notice on resignation, Código do Trabalho art. 400.º · **RETRIEVED 2026-08-19**

| | |
|---|---|
| **Catalogue id** | D-02 (`docs/knowledge/DOWNLOAD-MANIFEST.md`) |
| **Source name** | **Lei n.º 7/2009, de 12 de fevereiro** — *Aprova a revisão do Código do Trabalho*, **artigo 400.º** (*Denúncia com aviso prévio*) and **artigo 401.º** (*Denúncia sem aviso prévio*), at pp. 998–999 of **Diário da República n.º 30/2009, 1.ª série**. Current wording of art. 400.º(6) and art. 401.º(2) from **Lei n.º 13/2023, de 3 de abril**, **Diário da República n.º 66/2023, 1.ª série**. |
| **Publisher / authority** | Assembleia da República, published by **Diário da República Eletrónico** (INCM) |
| **Exact URL** | <https://files.diariodarepublica.pt/gratuitos/1s/2009/02/03000.pdf> (Lei 7/2009) · <https://files.diariodarepublica.pt/gratuitos/1s/2023/04/06600.pdf> (Lei 13/2023) |
| **Retrieved** | **2026-08-19**, by `curl` with a full browser header set. HTTP 200 for both: **973,659 bytes** / 116 pages, and **8,761,518 bytes** / 98 pages. |
| **SHA-256 of the retrieved bytes** | `3101272ae4b54bff247f7fc5854fe5a48f4732e5434e8fd9b6e6caa4c06cd859` (2009) · `05b4b7189f78e362a524ba89473039a270761b5c042d16b3f2adbf87b6adf84f` (2023) |
| **Source `updatedAt`** | Lei 7/2009 published **2009-02-12**. Lei 13/2023 published **2023-04-03**, in force **2023-05-01** (art. 35.º: *"entra em vigor no primeiro dia do mês seguinte ao da sua publicação"*). **Not a consolidation** — see "What is still open". |
| **Licence / basis for inclusion** | Class **(c)** — quote and cite, **no bytes**. Statutory text outside copyright under the *Código do Direito de Autor*; the DRE edition and database carry INCM's terms, whose terms page is unreadable here (JavaScript-only site). |
| **Evidence tag** | `[CONFIRMED — statute, retrieved 2026-08-19]` |

## Article 400.º, quoted in full (Lei 7/2009 text, ¶¶ 1–5 unchanged by Lei 13/2023)

> **SUBSECÇÃO II — Denúncia de contrato de trabalho pelo trabalhador**
>
> **Artigo 400.º · Denúncia com aviso prévio**
>
> **1** — O trabalhador pode denunciar o contrato independentemente de justa
> causa, mediante comunicação ao empregador, por escrito, com a antecedência
> mínima de **30 ou 60 dias**, conforme tenha, respectivamente, **até dois anos
> ou mais de dois anos** de antiguidade.
>
> **2** — O instrumento de regulamentação colectiva de trabalho e o contrato de
> trabalho podem **aumentar o prazo de aviso prévio até seis meses**,
> relativamente a trabalhador que ocupe cargo de administração ou direcção, ou
> com funções de representação ou de responsabilidade.
>
> **3** — No caso de contrato de trabalho **a termo**, a denúncia pode ser feita
> com a antecedência mínima de **30 ou 15 dias**, consoante a duração do
> contrato seja de pelo menos seis meses ou inferior.
>
> **4** — No caso de contrato a termo incerto, para efeito do prazo de aviso
> prévio a que se refere o número anterior, atende-se à duração do contrato já
> decorrida.
>
> **5** — É aplicável à denúncia o disposto no n.º 4 do artigo 395.º

And, inserted by Lei n.º 13/2023 (the rest of the article being carried forward
unchanged, which the amending law signals by printing `1 — [...]` through
`5 — [...]`):

> **6** — O trabalhador a quem tenha sido reconhecido o **estatuto de vítima de
> violência doméstica**, nos termos de legislação específica, fica **dispensado
> do cumprimento do aviso prévio** previsto nos números anteriores.

**Article 401.º**, the sanction for not giving notice, likewise unchanged in
substance and given a new second paragraph by Lei 13/2023:

> **Artigo 401.º · Denúncia sem aviso prévio**
>
> O trabalhador que não cumpra, total ou parcialmente, o prazo de aviso prévio
> estabelecido no artigo anterior deve pagar ao empregador uma **indemnização de
> valor igual à retribuição base e diuturnidades correspondentes ao período em
> falta** […]
>
> **2** — O disposto no número anterior não é aplicável ao trabalhador a quem
> tenha sido reconhecido o estatuto de vítima de violência doméstica […]

## What this settles about `NOTICE_PERIOD_TABLE.PT`

The row's only provenance today is the string `sourceCitation: "Código do
Trabalho art. 400 (30 / 60 days by tenure; probation reduced)"` — no URL, no
version, no retrieved-on date. Against the text:

| Question the manifest raised | Answer from art. 400.º |
|---|---|
| Are the periods 30 and 60 days? | **Yes.** ¶1, verbatim. |
| Is the bracket boundary `tenureMaxMonths: 23`? | **No.** ¶1 splits on *"até dois anos ou mais de dois anos"* — **up to two years** inclusive versus more than two. At exactly 24 months the statute gives **30** days and the table gives **60**. See **C-18**. |
| Is `unit: "calendar"` right? | **The article does not say.** It says *"dias"*. Nothing in the provision settles calendar versus working days, so the field remains an assumption — a smaller one than before, and still one. |

And three dimensions the table has no field for at all:

1. **¶2 — a contractual extension to six months** for administration, direction,
   representation or responsibility roles. The Dutch article has the mirror-image
   provision (**C-14**), so this is now a pattern rather than a one-off: in both
   demo countries the employee's statutory notice is a **default that a contract
   may lengthen**, and the table models it as a fixed entitlement.
2. **¶3 — fixed-term contracts get their own ladder** (30 or 15 days on a
   six-month duration split). `NOTICE_PERIOD_TABLE` has one ladder per country
   and no contract-type dimension.
3. **¶6 — a statutory waiver.** A worker recognised as a victim of domestic
   violence owes **no notice at all** and, under art. 401.º(2), **no indemnity**
   for not giving it. This is recorded and deliberately **not** proposed for
   encoding: the trigger is a legal status recognised under separate
   legislation, and a support automation that tried to determine it would be
   doing something much worse than escalating. See **C-19**.

## What is still open

**This is the enacting text plus one amending law, not a consolidation.** The
Código do Trabalho has been amended repeatedly since 2009. Two amending laws
were read in full for this entry — **Lei n.º 93/2019** (the fourteenth
amendment) and **Lei n.º 13/2023** — because they are the two largest labour
reforms of the period and both were checked against their own
*"Alteração ao Código do Trabalho"* article listings:

- Lei 93/2019 art. 2.º amends arts. 35, 40, 42, 43, 44, 46, 53, 65, 94, **114**,
  144, 249, 255. **Art. 400 is not in that list.**
- Lei 13/2023 art. 2.º amends a long list that **does** include **400.º**,
  **401.º**, **111.º**, **112.º** and **114.º** — which is why both are quoted
  above rather than the 2009 text alone.

**Amendments other than those two were not checked**, and the sidecar says so
instead of implying a consolidation was read. DRE's consolidated view is the one
artifact that would answer it in a single read, and it is still JavaScript-only.
