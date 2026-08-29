# D-35 · United States — the substantial presence test

| | |
|---|---|
| **Catalogue id** | D-35 (`docs/knowledge/DOWNLOAD-MANIFEST.md`) · L1-08-adjacent (`docs/KNOWLEDGE-SOURCES.md` §4) |
| **Source name** | *Substantial Presence Test* — IRS International Taxpayers guidance |
| **Publisher / authority** | **Internal Revenue Service** |
| **Exact URL** | <https://www.irs.gov/individuals/international-taxpayers/substantial-presence-test> |
| **Retrieved** | **2026-08-19**, by `curl`. HTTP 200, **106699 bytes** as stored (transfer was content-encoded; the stored bytes are the decoded entity body). Saved at [`sources/D-35-us-substantial-presence-test.html`](sources/D-35-us-substantial-presence-test.html). |
| **SHA-256 of the retrieved bytes** | `8d7a5d5d977e2f5353d3335bbd869b8fc4ca8980089ca40de3458fe8d727e8d4` |
| **Source `updatedAt`** | **"Page Last Reviewed or Updated: 14-Mar-2026"**, printed by the IRS on the page itself. |
| **Licence / basis for inclusion** | **US federal government work — public domain.** Bytes committed. |
| **Evidence tag** | `[CONFIRMED — agency publication, retrieved 2026-08-19]` |

> **Publication 519 was retrieved and is deliberately not committed.**
> <https://www.irs.gov/pub/irs-pdf/p519.pdf> returned HTTP 200,
> **2,080,184 bytes**, SHA-256
> `c220ed64473d9f26b09784e45d5c4e05b052caace1263278bb6dc2060796ed85`. It is
> public domain and could be committed; it is not, on the same
> repository-weight grounds as D-07, and because the page above states the test
> operatively while Pub. 519 is a 2 MB general guide. The checksum is recorded
> so the decision is reversible.

## The test, quoted verbatim

> You will be considered a United States resident for tax purposes if you meet
> the substantial presence test **for the calendar year**. To meet this test,
> you must be physically present in the United States (U.S.) on at least:
>
> - **31 days during the current year**, and
> - **183 days during the 3-year period** that includes the current year and the
>   2 years immediately before that, counting:
>   - All the days you were present in the current year, and
>   - **1/3** of the days you were present in the first year before the current
>     year, and
>   - **1/6** of the days you were present in the second year before the current
>     year.
>
> **Example:** You were physically present in the U.S. on 120 days in each of
> the years 2023, 2024 and 2025. To determine if you meet the substantial
> presence test for 2025, count the full 120 days of presence in 2025, 40 days
> in 2024 (1/3 of 120), and 20 days in 2023 (1/6 of 120). Since the total for
> the 3-year period is 180 days, you are not considered a resident under the
> substantial presence test for 2025.

And the exclusions, which are not a footnote — quoted:

> Do not count the following as days of presence in the U.S. for the substantial
> presence test: Days you **commute to work in the U.S. from a residence in
> Canada or Mexico** if you regularly commute from Canada or Mexico. Days you
> are in the U.S. for **less than 24 hours**, when you are in transit between two
> places outside the United States. Days you are in the U.S. as a **crew member
> of a foreign vessel**. Days you are **unable to leave the U.S. because of a
> medical condition** that develops while you are in the United States. Days you
> are an **exempt individual**.

Plus a relief the code has no concept of:

> **Closer connection exception to the substantial presence test.** Even if you
> met the substantial presence test you can still be treated as a nonresident of
> the United States for U.S. tax purposes if you qualify for one of the
> following exceptions …

## What this settles

The United States is the fourth and last of the demo countries whose residence
test the repository's single `RESIDENCY_LIMIT_DAYS = 183` over
`RESIDENCY_WINDOW_DAYS = 365` stands in for. The four are now all sourced —
D-31 (NL), D-32 (PT, **not retrieved**), D-33 (CA) and this — and the
comparison is the single largest finding of this pass. It is
[`CONTRADICTIONS.md`](CONTRADICTIONS.md) **C-12**.

Note the discipline the code already gets right and must not lose:
`computePresenceDays()` returns `NOT_EVALUATED` with `days: null` rather than
a fabricated zero. The fix this document enables is the same discipline applied
to the **threshold** rather than the count — a 183 that is right for Canada and
wrong for the other three is a well-formed number rendered beside a citation.
