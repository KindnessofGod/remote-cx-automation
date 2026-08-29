# D-06 · United States — the evidence that no employee-side notice statute exists

| | |
|---|---|
| **Catalogue id** | D-06 (`docs/knowledge/DOWNLOAD-MANIFEST.md`) · L1-09 (`docs/KNOWLEDGE-SOURCES.md` §4) |
| **Source name** | (1) *Worker Adjustment and Retraining Notification Act (WARN)* — ETA programme page. (2) *Plant Closings and Layoffs* — DOL topic page. |
| **Publisher / authority** | **U.S. Department of Labor** (Employment and Training Administration; DOL general topics) |
| **Exact URL** | <https://www.dol.gov/agencies/eta/layoffs/warn> and <https://www.dol.gov/general/topic/termination/plantclosings> |
| **Retrieved** | **2026-08-19**, by `curl` with the full browser header set described in D-20. HTTP 200 for both — **73130 bytes** and **69193 bytes** as stored (decoded entity bodies). |
| **SHA-256 of the retrieved bytes** | warn: `1950ad6dc4c47c4c940d2227e902ffc74994fc6ba0843720286fba3a7b28f87d` · plantclosings: `f35b947ef2f7c1935ab74a4d88c5f1929baa27c12ea7588093bbe8f265051bc5` |
| **Source `updatedAt`** | **None printed on either page.** |
| **Licence / basis for inclusion** | **US federal government work — public domain.** Bytes committed. |
| **Evidence tag** | `[CONFIRMED — agency publication, retrieved 2026-08-19]` · the *negative* it is used for is `[INFERRED — argument from scope, see below]` |

## What WARN actually requires, quoted verbatim

> The Worker Adjustment and Retraining Notification Act (WARN) protects workers,
> their families, and communities by requiring **employers with 100 or more
> employees** (generally not counting those who have worked less than six months
> in the last 12 months and those who work an average of less than 20 hours a
> week) to provide **at least 60 calendar days advance written notice** of a
> plant closing and mass layoff **affecting 50 or more employees at a single
> site of employment**. WARN makes certain exceptions to the requirements when
> layoffs occur due to unforeseeable business circumstances, faltering
> companies, and natural disasters. … Regular federal, state, local, and
> federally-recognized Indian Tribal government entities that provide public
> services are not covered.

## The claim this is being used to support, and its exact strength

UC-05 has **no US row** — `getNoticeRule("US")` returns `null` and every
American resignation escalates as `unsupported_country`. Writing a US row
requires asserting a **negative**: that US federal law imposes no minimum notice
period on a *resigning employee*.

**WARN does not say that.** WARN is the clearest delimitation of what US federal
law *does* require on separation — advance notice **from employers**, at scale,
on plant closings and mass layoffs — and therefore of the shape of the field it
occupies. Using it for the negative is an **argument from scope**, and this file
says so rather than presenting a citation that appears to state the point
directly. Tagged `[INFERRED]` for that reason, deliberately, in a corpus where
everything else from the United States is `[CONFIRMED]`.

Two things this does **not** close, and a US row must not pretend otherwise:

1. **State law.** Neither page addresses state-level notice requirements, and
   several states operate their own "mini-WARN" statutes. A national
   `NOTICE_PERIOD_TABLE.US` row is a single row for a country whose employment
   law is substantially sub-federal — the same objection D-05 raises for Canada.
2. **Contract.** An at-will employment relationship can still carry a
   contractual notice term. Statutory silence is not contractual silence.

See [`CONTRADICTIONS.md`](CONTRADICTIONS.md) **C-13** for how this sits beside
the Canadian equivalent (D-04), which has the same shape and a stronger source.
