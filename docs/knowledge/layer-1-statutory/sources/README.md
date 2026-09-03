# `sources/` — retrieved bytes, and only where the licence permits

This directory holds the **raw retrieved files** for Layer-1 statutory
documents: the HTML or PDF exactly as the authority served it.

**It is no longer empty.** Three retrieval passes on 2026-08-19 took the corpus
to **35 of 39** catalogued documents; **23 files are committed here**, being the
subset whose licence permits a copy *and* for which a copy is the honest thing to
keep. The work order for the remaining four is
[`../RETRIEVAL-BLOCKED.md`](../RETRIEVAL-BLOCKED.md) §6.

**Six files were added by the third pass, and two of them are a new kind.** The
three `D-14-*` / `D-15-*` `.txt` files are **human transcriptions of rendered web
pages**, made in a browser by the repository owner because `www.cbp.gov`,
`www.uscis.gov` and `travel.state.gov` refuse this container's address and always
did — the allowlist opening did not change them, which is the proof they were
never our network's problem. They are one degree weaker than a direct fetch and
their sidecars say so in the retrieval row **and** in the evidence tag. They are
**not** the mirror problem in a new costume: the chain is *authority → the
repository owner's browser → this file*, and every link in it is named.

## What is here

| File(s) | Doc | Licence basis |
|---|---|---|
| `D-04-ca-canada-labour-code-s230.html` · `D-16-ca-irpr-s186.html` · `D-16-ca-irpr-s187.html` · `D-33-ca-ita-s250-deemed-resident.html` | D-04, D-16, D-33 | **SI/97-5**, Reproduction of Federal Law Order — read live and quoted in full in [`../D-04-ca-canada-labour-code-part-iii.md`](../D-04-ca-canada-labour-code-part-iii.md). **Not the official version**, as SI/97-5 requires each sidecar to state. |
| `D-06-us-dol-warn.html` · `D-06-us-dol-plant-closings.html` · `D-20-us-ssa-*.html` · `D-27/28/29-us-*-tax-convention.pdf` · `D-35-us-substantial-presence-test.html` | D-06, D-20, D-27, D-28, D-29, D-35 | **US federal government work — public domain.** No conditions. |
| `D-08-eu-schengen-bg-ro-decision-2024-210.html` · `D-08-…-2024-3212.html` · `D-09-eu-visa-annexes-2018-1806.html` · `D-17-eu-reg-883-2004.html` · `D-18-eu-reg-987-2009.html` | D-08, D-09, D-17, D-18 | **EUR-Lex reuse under Commission Decision 2011/833/EU**, read live 2026-08-19. Note the refinement found on that page: **consolidated texts additionally carry CC BY 4.0** for their editorial layer, so the sidecars attribute the source and state that no quoted passage was altered. |
| `D-19-eu-practical-guide-applicable-legislation.pdf` | D-19 | **CC BY 4.0.** The PDF carries no notice of its own; the Commission's legal notice (<https://commission.europa.eu/legal-notice_en>, read live 2026-08-19) licenses undated EU-owned content on its sites under CC BY 4.0, on top of Decision 2011/833/EU. Attributed in the sidecar; no quoted passage altered. |
| `D-01-nl-notice-bw-7-672.html` · `D-31-nl-awr-art-4-residence.html` | D-01, D-31 | **CC0 1.0.** `www.overheid.nl/copyright` answers **410 Gone** — the site no longer publishes reuse terms — but KOOP, which runs `wetten.overheid.nl`, publishes the **Basis Wetten Bestand** in the national open-data register under CC0 (`data.overheid.nl/dataset/basis-wetten-bestand`, modified 2025-10-03). On top of *Auteurswet* art. 11. |
| `D-41-uk-era-1996-s86.html` | D-41 | **Open Government Licence v3.0**, stated in the page's own footer and confirmed live at `nationalarchives.gov.uk/doc/open-government-licence/version/3/` (HTTP 200, 2026-09-02). © Crown and database right. |
| `D-42-ie-minimum-notice-1973-s4.html` · `…-s6.html` · `…-revised.html` | D-42 | **OIREACHTAS (OPEN DATA) PSI LICENCE**, which *"incorporates the Creative Commons Attribution 4.0 International License"* — read live at `irishstatutebook.ie/eli/open-data.html`, 2026-09-02. Both the *as enacted* sections and the Law Reform Commission's *Revised Act* are here, because the point of the document is that they are word-for-word identical on ss. 4 and 6. |
| `D-05-ca-on-esa-2000.json` | D-05 | **King's Printer for Ontario's policy on copyright in legal materials**, read live at `ontario.ca/page/copyright-information`, 2026-09-02, and quoted in full in the sidecar. Reproduction permitted without permission or charge, on two conditions the sidecar meets: accurate reproduction with `© King's Printer for Ontario, 2000`, and a statement that **this is not an official version**. ⚠ **This file is JSON, not HTML** — it is what the authority served: `www.ontario.ca/laws/api/v2/legislation/en/doc-search/statute/00e41`, whose `content` field carries the Act's own markup. The human-readable page at the same id is a JavaScript shell and is not what was fetched. |
| `D-14-us-state-visa-waiver-program.txt` · `D-14-us-cbp-esta-faq.txt` · `D-15-us-uscis-b1-business-visitor.txt` | D-14, D-15 | **US federal government work — public domain.** ⚠ **Browser transcriptions, not fetched bytes** — see the note above and the retrieval rows in [`../D-14-us-vwp-esta.md`](../D-14-us-vwp-esta.md) and [`../D-15-us-b1-business-visitor.md`](../D-15-us-b1-business-visitor.md). Navigation chrome included, deliberately unedited. |

> **Five files were added by the fourth pass (2026-09-02).** Three licences that
> had never been read are now read and quoted — the UK's OGL v3.0, the Oireachtas
> Open Data PSI Licence, and the King's Printer for Ontario's legal-materials
> policy, which is the **third distinct Canadian licence** in this corpus and
> differs from both SI/97-5 (D-04) and the canada.ca terms (D-21).

## What is deliberately *not* here, and why — three different reasons

1. **Licence.** ~~Dutch (D-01, D-24, D-31)~~ **D-24** and Portuguese (D-02,
   D-03, D-10, D-11, D-32) material was retrieved and **no bytes are
   committed.** **The Dutch statutes moved out of this list in the third pass**
   — the Basis Wetten Bestand is CC0 (above), so D-01 and D-31 bytes are now
   here; D-24 stays, because it is a *treaty* from `verdragenbank.overheid.nl`
   and the BWB dataset entry does not cover it. For the Portuguese gazette the
   statutory text is outside copyright but the **DRE edition and database** carry
   INCM's terms, whose terms page is unreadable (the site is JavaScript-only), so
   the articles are quoted and the 13 MB / 8.7 MB / 973 KB issues are not
   mirrored — byte counts and checksums are in the sidecars, so the decision is
   reversible. For `vistos.mne.gov.pt` and `info.portaldasfinancas.gov.pt` no
   reuse terms are stated at all. canada.ca
   agency pages (D-21, D-22, D-23, D-25, D-34) permit **non-commercial**
   reproduction only, on terms read live at
   <https://www.canada.ca/en/transparency/terms.html> — a public career-facing
   repository is not clearly non-commercial. Note this is **narrower than
   SI/97-5**, which governs the Canadian *statutes* above and draws no such
   distinction; two Canadian licences, two answers.
2. **Size.** D-07 (Schengen Borders Code consolidated, 5.5 MB) and IRS
   Publication 519 (2.1 MB) are both freely committable and are not committed.
   **D-43 (Kodeks pracy, consolidated text, 2.0 MB) joins them on 2026-09-02**,
   and its licence is the cleanest in the corpus — Polish copyright law states
   outright that normative acts are not an object of copyright (*ustawa o prawie
   autorskim* art. 4, itself retrieved to check). It is left out on size alone,
   for consistency with Pub. 519, and the sidecar carries the byte count and
   SHA-256 so the decision is reversible. **D-44 (Code civil du Québec, 5.8 MB
   fr / 6.0 MB en) is out for size *and* licence**: Légis Québec publishes no
   readable reuse-terms page, and the whole Code would be 99.99 % material this
   corpus has no business holding. **D-45 (BMAS *Arbeitsrecht*, 2.0 MB)** is out
   on its own terms — the publication asks to be quoted with publisher, title and
   edition date, which is class (c).
   Their sidecars record the byte count and SHA-256 so the decision is
   reversible, and quote the operative text in full.
3. **Because a copy would be a lie waiting to happen.** The sanctions lists
   (D-36, D-37, D-38) have entirely clean licences and are **still** not here.
   **D-39, the UN Consolidated List, is not here for that reason *and* a second,
   independent one** — the UN's copyright page says *"All rights reserved"*, so
   its manifest class (b) was wrong and is corrected to (c). The list also moved
   **the day before** it was read, which is the staleness argument arriving with
   a date on it.
   `docs/KNOWLEDGE-SOURCES.md` §11 names a cached sanctions list as the
   "helpful fallback" most likely to be acquired by accident, and Global Affairs
   Canada's page stamped **today's date** on the day it was read. The register
   at [`../D-36-D-37-D-38-sanctions-register.md`](../D-36-D-37-D-38-sanctions-register.md)
   is the right artifact; a scheduled fetch with a fail-closed gate is the right
   control.

## The two rules for anything added here

**1. A raw file never travels alone.** A PDF cannot carry a provenance header,
so every file here has a sibling `../D-NN-*.md` carrying the header format used
by every file under `docs/knowledge/` — authority, exact URL, retrieval date,
byte count, SHA-256, the source's own version or last-updated, licence basis,
evidence tag.

```bash
wc -c        docs/knowledge/layer-1-statutory/sources/D-NN-<slug>.pdf
shasum -a 256 docs/knowledge/layer-1-statutory/sources/D-NN-<slug>.pdf
```

> **A note on what the checksums cover.** Several of these were fetched with
> content-encoding negotiation, so the stored file is the **decoded entity
> body**, not the compressed transfer. The checksums are of the files as
> committed — which is the only thing anyone can re-verify — and the sidecars
> say so where it applies. A byte count that matches `curl`'s `size_download`
> for a compressed transfer would have been the wrong number quoted
> confidently.

**2. Bytes land here only for licence classes (a) and (b)** in
[`../../DOWNLOAD-MANIFEST.md`](../../DOWNLOAD-MANIFEST.md) §3, and only where
the specific instrument has been **read**, not assumed. For classes **(c)**
cite-and-link and **(d)** paraphrase-only, **the sidecar exists alone and says
why**.

**And the rule that outranks both:** a mirror is not the authority. Only bytes
served by the publishing authority itself belong here.
