# D-15 · United States — B-1 temporary business visitor · **RETRIEVED BY HAND 2026-08-19**

| | |
|---|---|
| **Catalogue id** | D-15 (`docs/knowledge/DOWNLOAD-MANIFEST.md`) |
| **Source name** | *B-1 Temporary Business Visitor* |
| **Publisher / authority** | **U.S. Citizenship and Immigration Services** (USCIS), Department of Homeland Security |
| **Exact URL** | <https://www.uscis.gov/working-in-the-united-states/temporary-visitors-for-business/b-1-temporary-business-visitor> |
| **Retrieved** | **2026-08-19 — manually, by the repository owner, in a browser.** Not fetched programmatically: `www.uscis.gov` returns an Akamai `403 "Access Denied"` to this container for **every** path including `/`, and the complete browser header set that unblocked `ssa.gov`, `dol.gov`, `canada.ca` and `main.un.org` does not help. That is a refusal of the **address**, not of the request. The owner opened the page and copied the visible page text. |
| **Bytes as committed** | [`sources/D-15-us-uscis-b1-business-visitor.txt`](sources/D-15-us-uscis-b1-business-visitor.txt) — **12,328 bytes**. |
| **SHA-256 of the committed bytes** | `89fcb6b424e27a2984f2ff42492f5a9d937fe8f51309171c43a8fa788dd86ebc` |
| **Source `updatedAt`** | **Not captured.** The transcription does not include whatever "Last Reviewed/Updated" stamp the page may carry, and the page cannot be re-read from here to check. This is a real gap in the provenance and is left visible rather than filled in. |
| **Licence / basis for inclusion** | Class **(a)** — work of the U.S. federal government, public domain. Committed in full. |
| **Evidence tag** | `[CONFIRMED — agency publication, transcribed from a browser 2026-08-19]` |

> **Read this row before quoting anything below.** The committed file is a
> **text transcription of a rendered web page**, including its navigation chrome,
> made by a human — not a byte-for-byte capture of what the server sent. It is
> therefore one degree weaker than the 26 documents fetched directly, and the
> evidence tag says so. It is nonetheless categorically different from a
> **mirror**: the chain here is *authority → the repository owner's browser →
> this file*, with every link named. `RETRIEVAL-BLOCKED.md` §5's rule is that a
> provenance header must not *"name an authority nobody in the chain has read"*.
> Somebody in this chain read it, and the header says who.

## The passage that matters, and the two words in it

> You may be eligible for a B-1 visa if you will be participating in business
> activities of a commercial or professional nature in the United States,
> **including, but not limited to**:
>
> - Consulting with business associates
> - Traveling for a scientific, educational, professional or business
>   convention, or a conference on specific dates
> - Settling an estate
> - Negotiating a contract
> - Participating in short-term training
> - Transiting through the United States […]
> - Deadheading […]

**"including, but not limited to."** The list is expressly non-exhaustive, which
means it cannot be turned into a lookup in either direction: an activity's
absence from it proves nothing. `docs/KNOWLEDGE-SOURCES.md` L1-07 already sorts
the business-visitor boundary as **CORPUS, not TABLE**; this is the authority
saying so in its own words.

Eligibility, quoted in full because each limb is a condition the repository has
no input for:

> - The purpose of your trip is to enter the United States for **business of a
>   legitimate nature**
> - You plan to remain for a **specific limited period of time**
> - You have sufficient funds to cover the expenses of the trip and your stay
> - You have a **residence outside the United States that you have no intention
>   of abandoning**, as well as other binding ties that will ensure your return
>   abroad at the end of the visit
> - You are otherwise admissible

And the duration:

> **Initial Period of Stay:** 1 to 6 months; 6 months is the maximum.
> **Extension of Stay:** Up to 6 months; **maximum total amount of time permitted
> in B-1 status on any one trip is generally 1 year.**

## The provision that names what is actually prohibited

USCIS describes a category of B-1 holder — personal or domestic servants
accompanying certain nonimmigrants, and certain foreign-airline employees — and
in doing so states the test the whole classification turns on:

> Such activities are **not considered, for purposes of the B-1 classification,
> to be prohibited local "employment" or "labor for hire" within the United
> States** […] Note, however, that if such persons engage in activities outside
> their B-1 nonimmigrant status, **such as working for another employer in the
> United States**, they will be found to have violated their B-1 nonimmigrant
> status.

The prohibition is on **local employment / labor for hire within the United
States**, and the discriminator in USCIS's own example is *whose employer*. That
is the same shape as Canada's IRPR s. 187 test already recorded at **C-5**
(*"primary source of remuneration … outside Canada"*, *"principal place of
business and actual place of accrual of profits remain predominately outside
Canada"*) — **two immigration authorities, two continents, and both draw the line
at the payer and the activity rather than at the visa label.**

`src/uc04/riskMatrix.js` draws it at the visa label. See **C-26**.

## What is *not* settled by this document, and must not be inferred from it

A remote worker on a workation is being paid by a **foreign** employer for work
that is neither for a US employer nor sold into the US market — which is not the
same as saying a workation qualifies as B-1 business activity. Nothing on this
page says it does, and the eligibility limbs above (*"business of a legitimate
nature"*, a *"specific limited period"*, undiminished ties abroad) are
judgements a consular officer or a CBP officer makes. **The finding is that the
code asks none of these questions, not that the answer to them is yes.**
