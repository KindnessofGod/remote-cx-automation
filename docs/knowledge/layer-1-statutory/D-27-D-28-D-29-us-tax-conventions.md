# D-27 / D-28 / D-29 · The three US income tax conventions — the only quotable treaty texts here

| | |
|---|---|
| **Catalogue id** | D-27, D-28, D-29 (`docs/knowledge/DOWNLOAD-MANIFEST.md`) · L1-02 (`docs/KNOWLEDGE-SOURCES.md` §4) |
| **Source name** | US–Netherlands, US–Portugal and US–Canada income tax conventions, as published by the IRS |
| **Publisher / authority** | **Internal Revenue Service**, publishing texts of conventions concluded by the U.S. Department of the Treasury |
| **Exact URL** | Country pages: <https://www.irs.gov/businesses/international-businesses/netherlands-tax-treaty-documents> · <https://www.irs.gov/businesses/international-businesses/portugal-tax-treaty-documents> · <https://www.irs.gov/businesses/international-businesses/canada-tax-treaty-documents>. Texts: <https://www.irs.gov/pub/irs-trty/nether.pdf> · <https://www.irs.gov/pub/irs-trty/portugal.pdf> · <https://www.irs.gov/pub/irs-trty/canada.pdf> |
| **Retrieved** | **2026-08-19**, by `curl`. HTTP 200 for all six. PDFs stored at [`sources/D-27-us-nl-tax-convention.pdf`](sources/D-27-us-nl-tax-convention.pdf) (**160636 bytes**, 74 pages), [`sources/D-28-us-pt-tax-convention.pdf`](sources/D-28-us-pt-tax-convention.pdf) (**73855 bytes**, 29 pages), [`sources/D-29-us-ca-tax-convention.pdf`](sources/D-29-us-ca-tax-convention.pdf) (**170101 bytes**, 85 pages). |
| **SHA-256 of the retrieved bytes** | NL: `337c5b3ee9da65ddc5a2ee9fc988553f716b92f6898370bb0da8f602c99e75ad` · PT: `f93a952c435d9f9cc76e393a3cfbda541dbc1afa63d2d356ad1f21d4de952da8` · CA: `8f50627bf060c994628e995564a2084543784d48f9bf9971158512737aabede2` |
| **Source `updatedAt`** | The three IRS country pages each print **"Page Last Reviewed or Updated: 08-Aug-2026"**. The PDFs themselves carry only the conventions' own dates — see the per-treaty table below. |
| **Licence / basis for inclusion** | **US federal government work — public domain.** Bytes committed in full, which is what makes these three the only real quoted treaty language in this corpus. |
| **Evidence tag** | `[CONFIRMED — treaty text, retrieved 2026-08-19]` |

> **⚠ The manifest guessed the Canada slug and the guess was right.** `D-29`
> was recorded as a pattern-derived URL that could not be corroborated.
> `.../canada-tax-treaty-documents` returns 200 and is the Canada page.
> Recording this because the manifest's other pattern-derived guesses did *not*
> all survive contact (see D-08, D-10).

## The instruments, and which article carries employment income

| Pair | Instrument as published | Employment-income article |
|---|---|---|
| US–NL (D-27) | Convention … together with a Protocol, plus later protocols and technical explanations linked from the country page | **Article 16 — Dependent Personal Services** |
| US–PT (D-28) | Convention … together with a related Protocol. The PDF's own header: *"GENERAL EFFECTIVE DATE UNDER ARTICLE 30: 1 JANUARY 1996"* | **Article 16 — Dependent Personal Services** |
| US–CA (D-29) | Convention with respect to taxes on income and on capital, with protocols | **Article XV — Dependent Personal Services** |

## The 183-day condition, quoted from each text

> **Each convention is a `###` of its own, and that is a retrieval decision
> rather than a formatting one (2026-08-30).** These three quotes used to sit
> under this one heading as bold labels. The corpus chunker splits on headings
> and then on paragraph boundaries when a section runs long, so this section
> came out as two passages: the first led with the **Netherlands** text and the
> second opened with an unattributed `> …` — the `US–Portugal` label had fallen
> on the chunk boundary. A specialist reading a US/PT dossier in the ZAF sidebar
> was therefore shown the Netherlands convention, and the Portuguese one with no
> country on it. Not one word of quoted treaty text is changed by this edit; the
> SHA-256s above are of the retrieved PDFs and are unaffected.


### US–Netherlands, Article 16(2)

> … remuneration derived by a resident of one of the States in respect of an
> employment exercised in the other State shall be taxable only in the
> first-mentioned State if (a) the recipient is present in the other State for a
> period or periods not exceeding in the aggregate **183 days in the taxable
> year concerned**; (b) the remuneration is paid by, or on behalf of, an
> employer who is **not a resident of the other State**; and (c) the
> remuneration is **not borne by a permanent establishment or a fixed base**
> which the employer has in the other State.

### US–Portugal, Article 16(2)

> … (a) the recipient is present in the other State for a period or periods not
> exceeding in the aggregate **183 days in any 12-month period commencing or
> ending in the taxable year concerned**; and (b) … not a resident of the other
> State; and (c) … not borne by a permanent establishment or a fixed base …

### US–Canada, Article XV(2)

> … remuneration derived by a resident of a Contracting State in respect of an
> employment exercised **in a calendar year** in the other Contracting State
> shall be taxable only in the first-mentioned State if: (a) Such remuneration
> does **not exceed ten thousand dollars (0,000)** in the currency of that
> other State; **or** (b) The recipient is present in the other Contracting
> State for a period or periods not exceeding in the aggregate **183 days in
> that year** and the remuneration is not borne by an employer who is a resident
> of that other State or by a permanent establishment or a fixed base which the
> employer has in that other State.

## What this settles, and the two things it breaks

These are the first **actual bilateral treaty texts** in this repository.
`src/uc08/`'s `TREATY_CORPUS` holds three entries that are this project's own
paraphrase of a **model** convention; a dossier about a Dutch employee in the
United States has until now cited a model principle rather than the instrument
that governs the pair.

What the three texts break is more useful than what they confirm, and both
items are in [`CONTRADICTIONS.md`](CONTRADICTIONS.md):

- **C-10** — the three treaties use **three different 183-day windows**, none of
  which is the repository's trailing 365 days from the trip start.
- **C-11** — the treaty 183-day test is **one of three cumulative conditions**,
  and for an Employer-of-Record arrangement the other two are the ones that
  usually fail. A day count on its own does not answer the question the code
  renders it as answering.

> **⚠ Reading note carried forward from the manifest, and now confirmed by the
> texts.** These conventions are *based on* the OECD Model and their article
> numbering is nearly identical to it. Quoting the bilateral text is free;
> quoting the OECD Model or its Commentaries is not (licence class (d)). The
> quotations above are all from the IRS-published bilateral texts.
