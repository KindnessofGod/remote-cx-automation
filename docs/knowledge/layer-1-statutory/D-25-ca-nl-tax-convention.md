# D-25 · Canada–Netherlands income tax convention

| | |
|---|---|
| **Catalogue id** | D-25 (`docs/knowledge/DOWNLOAD-MANIFEST.md`) · L1-02 (`docs/KNOWLEDGE-SOURCES.md` §4) |
| **Source name** | *The Canada-Netherlands Income Tax Convention, as signed on May 27, 1986 and amended by the Protocols signed on March 4, 1993 and August 25, 1997* — consolidated by the department |
| **Publisher / authority** | **Department of Finance Canada** |
| **Exact URL** | <https://www.canada.ca/en/department-finance/programs/tax-policy/tax-treaties/country/netherlands-convention-consolidated-1986-1993-1997.html>, reached from the in-force index at <https://www.canada.ca/en/department-finance/programs/tax-policy/tax-treaties/in-force.html> |
| **Retrieved** | **2026-08-19**, by `curl` with the full browser header set. HTTP 200 for both. |
| **SHA-256 of the retrieved bytes** | Not recorded — nothing committed; canada.ca terms, as in D-21. |
| **Source `updatedAt`** | The convention page prints **"Date modified: 2019-11-05"**. |
| **Licence / basis for inclusion** | **Cite and extract only — no bytes.** canada.ca terms of use, read live 2026-08-19 (quoted in D-21). |
| **Evidence tag** | `[CONFIRMED — treaty text, retrieved 2026-08-19]` |

> **The manifest's slug was right, and its warning about the shape was right
> too.** The URL embeds three years because the published text is a
> **consolidation across an original convention and two protocols** — the kind
> of instrument where "which version is in force" is a real question, which is
> why the provenance header's version row is not decorative. The index page
> states the composition in its own words, quoted above.

## Article 15(2) — quoted

> a) the recipient is present in the other State for a period or periods not
> exceeding in the aggregate **183 days in any twelve month period commencing or
> ending in the calendar year concerned**, and
>
> b) the remuneration is paid by, or on behalf of, an employer who is **not a
> resident of the other State**, and
>
> c) the remuneration is **not borne by a permanent establishment or a fixed
> base** which the employer has in the other State.

## What this settles

The CA↔NL pair moves from `unknown` in `src/uc04/decisionFacts.js` to a citable
instrument. Its 183-day window is measured over *twelve months commencing or
ending in the **calendar** year* — which is **not** the Netherlands–Portugal
convention's *fiscal year* phrasing (D-24), **not** the US–Netherlands
*taxable year* phrasing (D-27), and **not** the trailing 365 days the code uses.

> **Canada–Portugal (D-26) was not retrieved.** The Finance Canada index does
> **not** host that text: its Portugal entry reads *"The Convention between
> Canada and the Portuguese Republic, as signed on June 14, 1999 **(GAC web
> site)**"*, pointing at `treaty-accord.gc.ca`, which this container's egress
> policy refuses. The **signature date, 1999-06-14, is confirmed** from Finance
> Canada; the text is not. See [`RETRIEVAL-BLOCKED.md`](RETRIEVAL-BLOCKED.md).
