# D-44 · Canada (Québec) — the resigning employee's notice, Code civil du Québec arts. 2091–2092 · **RETRIEVED 2026-09-02**

> **This is the document that breaks the Canadian row**, and it was not on the
> retrieval plan. It was fetched because the plan said *"federal and at least
> Ontario"*, and Ontario alone cannot support a national negative — the moment
> one province was read, reading a second civil-law one became the cheapest way
> to test the claim rather than confirm it.

| | |
|---|---|
| **Catalogue id** | D-44 (`docs/knowledge/DOWNLOAD-MANIFEST.md`) — added by the 2026-09-02 employee-notice pass |
| **Source name** | **Code civil du Québec, RLRQ c. CCQ-1991**, **Livre cinquième, Titre deuxième, Chapitre septième — *Du contrat de travail***, **articles 2091 and 2092** |
| **Publisher / authority** | **Éditeur officiel du Québec**, Légis Québec (`legisquebec.gouv.qc.ca`). The document carries the statement **« Ce document a valeur officielle. »** — *this document has official status* — which is a stronger currency claim than any other source in this corpus makes about itself. |
| **Exact URL** | <https://www.legisquebec.gouv.qc.ca/fr/document/lc/CCQ-1991> (French) · <https://www.legisquebec.gouv.qc.ca/fr/document/lc/CCQ-1991?langCont=en> (the English version, which the `/en/…` path 307-redirects to) |
| **Retrieved** | **2026-09-02**, by `curl`. HTTP 200, **5,771,814 bytes** (fr) and **6,001,381 bytes** (en) — the whole Code is served as one document; there is no per-article endpoint. |
| **SHA-256 of the retrieved bytes** | `acdfe689027d01e5c5c03478d0a1e208d492d9b63f71711465fd943e62a31969` (fr) · `bd4d154988c23e6a469923710b08286307ec8604879556b32af25a6af2138f97` (en) |
| **Source `updatedAt`** | The page prints **« À jour au 7 avril 2026 »** — up to date as at 7 April 2026. Both articles carry their own provenance line: `1991, c. 64, a. 2091 ; I.N. 2014-05-01`. |
| **Licence / basis for inclusion** | Class **(c)** — **quote and cite, no bytes**, and for two independent reasons. Légis Québec states only `© Gouvernement du Québec` and publishes no reuse-terms page this pass could read (`/fr/AvisJuridique` returns the site's *« Page Introuvable »*); and at **5.8 MB / 6.0 MB for the whole Code** a mirror would be 99.99 % material this corpus has no business holding. Byte counts and checksums above make the decision reversible. |
| **Evidence tag** | `[CONFIRMED — statute, retrieved 2026-09-02]` |

## The two articles, in both official languages

> **2091.** Chacune des parties à un contrat à durée indéterminée peut y mettre
> fin en donnant à l'autre un **délai de congé**.
>
> Le délai de congé doit être **raisonnable** et tenir compte, notamment, de la
> **nature de l'emploi**, des **circonstances particulières** dans lesquelles il
> s'exerce et de la **durée de la prestation de travail**.
>
> *1991, c. 64, a. 2091 ; I.N. 2014-05-01.*

> **2091.** **Either party** to a contract for an indeterminate term **may
> terminate it by giving notice of termination to the other party**.
>
> The notice of termination shall be given in **reasonable time**, taking into
> account, in particular, the **nature of the employment**, the **specific
> circumstances** in which it is carried on and the **duration of the period of
> work**.

> **2092.** Le salarié **ne peut renoncer** au droit qu'il a d'obtenir une
> indemnité en réparation du préjudice qu'il subit, lorsque le délai de congé est
> insuffisant ou que la résiliation est faite de manière abusive.
>
> **2092.** The employee **may not renounce** his right to obtain an indemnity
> for any injury he suffers where insufficient notice of termination is given or
> where the manner of resiliation is abusive.

Both languages are official under the *Charte de la langue française*; both are
quoted because the operative words differ in emphasis and neither is a
translation of the other.

## What this settles for `src/uc05/noticePeriodTable.js`

`NOTICE_PERIOD_TABLE.CA` reads `basis: "customary"` with the citation
*"Common-law customary notice (no statutory employee minimum; varies by
province)."* Against art. 2091, **every clause of that string is wrong for
Québec**:

| The row says | Québec |
|---|---|
| *common-law* | Québec is a **civil-law** jurisdiction. Employment termination is governed by the Civil Code, not by the common law of reasonable notice. |
| *customary* | Art. 2091 is **enacted law**. The obligation is statutory in the only sense that matters here — it is written down, in force, and it binds. |
| *no statutory employee minimum* | Art. 2091 binds **chacune des parties**. The resigning employee owes a *délai de congé*. |
| the brackets `0 / 7 / 14` days | The Code states **no number**. It states a **standard** — reasonable time, on three named factors — and art. 2092 makes the employee's remedy for insufficient notice **non-renounceable**, which is what stops the standard being negotiated away. |

**The `0 / 7 / 14` figures are worse than wrong here; they are wrong in the one
way the Code specifically forecloses.** `14` for a three-year employee is a
number, and art. 2091's whole content is that the answer is *not* a number
independent of the nature of the employment and its circumstances. A system that
prints `14 days` for a Québec resignation is not approximating the law — it is
answering a question the law declines to answer in that form. Recorded as
[`CONTRADICTIONS.md`](CONTRADICTIONS.md) **C-35**.

**This is also why C-30's decision is the right one and this document
strengthens rather than complicates it.** `qa/contracts/UC-05-acceptance.md` §18
Step 5 change `[N-7]` already decided to replace CA's invented brackets with
`no_statutory_notice_period`. That outcome escalates and tells the reader *the
notice owed comes from the contract, which this system does not hold*. For
Québec the sentence needs one word changed — *from the Civil Code's
reasonableness standard, applied to this person's circumstances* — but the
**behaviour is identical and already correct**: refuse to compute, escalate to a
human. A refusal is the right answer to a reasonableness test; a number never is.

## What is still open

- **The interaction with the *Loi sur les normes du travail* (RLRQ c. N-1.1)**
  was not retrieved. LNT s. 82 imposes an *avis de cessation d'emploi* on the
  **employer**; whether and how it interacts with CCQ 2091 on the employee's side
  is a question of Québec law, not of retrieval, and is deliberately left open
  rather than guessed.
- **Ten more provinces and territories.** This pass read Ontario (D-05) and
  Québec. Two provinces, two opposite answers, is the strongest available
  evidence that *"varies by province"* cannot be resolved into one national
  bracket set — and the weakest possible basis for choosing which of the two to
  encode.
