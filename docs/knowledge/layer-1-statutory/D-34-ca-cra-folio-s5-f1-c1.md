# D-34 · Canada — the administrative view of residence, CRA Folio S5-F1-C1

| | |
|---|---|
| **Catalogue id** | D-34 (`docs/knowledge/DOWNLOAD-MANIFEST.md`) |
| **Source name** | Income Tax Folio **S5-F1-C1**, *Determining an Individual's Residence Status* |
| **Publisher / authority** | **Canada Revenue Agency** |
| **Exact URL** | <https://www.canada.ca/en/revenue-agency/services/tax/technical-information/income-tax/income-tax-folios-index/series-5-international-residency/folio-1-residency/income-tax-folio-s5-f1-c1-determining-individual-s-residence-status.html> |
| **Retrieved** | **2026-08-19**, by `curl` with the full browser header set. HTTP 200. |
| **SHA-256 of the retrieved bytes** | Not recorded — nothing committed; canada.ca terms, as in D-21. |
| **Source `updatedAt`** | The page prints **"Date modified: 2026-01-20"**. |
| **Licence / basis for inclusion** | **Cite and extract only — no bytes.** canada.ca terms of use, read live 2026-08-19. |
| **Evidence tag** | `[CONFIRMED — administrative guidance, retrieved 2026-08-19]` · and see the force-of-law note below |

> **A CRA folio does not have the force of law.** It is the agency's stated
> administrative view. Anything drawn from it is `[INFERRED]` as to legal effect
> even where the retrieval is `[CONFIRMED]`. The statute is D-33.

## Corpus, deliberately — and this is the file that proves the rule

This document exists in the catalogue as the Canadian instance of the trap
`docs/KNOWLEDGE-SOURCES.md` §1 names as the most tempting in the whole domain:
**a residence analysis that looks like a grid and is a facts-and-circumstances
judgement.**

Read what it actually says, quoted:

> **1.8** To determine residence status, **all of the relevant facts in each
> case must be considered**, including residential ties with Canada and length
> of time, object, intention and continuity with respect to stays in Canada and
> abroad.
>
> **1.10** The most important factor … is whether the individual **maintains
> residential ties** with Canada while abroad. While the residence status of an
> individual **can only be determined on a case by case basis** after taking
> into consideration all of the relevant facts, generally, unless an individual
> severs all significant residential ties with Canada upon leaving Canada, the
> individual will continue to be a factual resident of Canada …
>
> **1.14** Generally, **secondary residential ties must be looked at
> collectively** in order to evaluate the significance of any one such tie. For
> this reason, **it would be unusual for a single secondary residential tie …
> to be sufficient on its own** …

The folio then enumerates significant ties, secondary ties and "other" ties.
That enumeration is exactly what a lookup table would be built out of — and
¶1.14 is the sentence explaining why building one produces a confident,
well-formed, wrong answer. A weighted tie-counter would be the most
plausible-looking thing this repository could ship and one of the least
defensible.

**The structural rule in [`../README.md`](../README.md) applies unchanged and is
greppable:** *no `policyEngine.js` may import from a retriever, and no citation
id may ever appear in a conditional.* This document must reach a dossier a human
reads and go nowhere else.
