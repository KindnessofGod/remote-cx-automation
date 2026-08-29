# L2-06 · `support.remote.com` — the help-centre articles · **LINK-ONLY, BY LICENCE**

> **Nothing from this source is vendored, and nothing from it ever will be.**
> This file is a citation register, not a copy. That is a licensing decision
> first and a staleness decision second, and the two point the same way.

| | |
|---|---|
| **Catalogue id** | L2-06 (`docs/KNOWLEDGE-SOURCES.md` §5) |
| **Source name** | Remote Help Center articles |
| **Publisher / authority** | Remote Europe Holding, B.V. |
| **Retrieval attempted** | **2026-08-19.** `curl` → **HTTP 403** (Cloudflare interstitial, 5,631-byte challenge page). `WebFetch` → **`EGRESS_BLOCKED`**, `support.remote.com` refused by the session's egress policy. **Two tools, two different failures, neither retrieved.** |
| **Licence / posture** | ⚠ **Cite-and-link only. Quote only the sentence actually being acted on, always with the URL.** Do not mirror the page. Do not embed it. |
| **Evidence tag** | `[CONFIRMED — support, via index snippet]` for the substance recorded in `KNOWLEDGE-SOURCES.md` L2-06 — **Remote's sentences surfaced through search indexing, not read in place.** One notch weaker than every other Layer-2 entry, and it must stay tagged that way. |

## Why cite-and-link is the right posture, not merely the cautious one

The catalogue's reasoning, which this pass adopts unchanged:

> Quoting a paragraph of Remote's help centre back to a Remote customer inside a
> Remote CX workflow is the **evident intended use**. Mirroring the whole help
> centre into a vector store is a materially different act, and one nobody has
> granted.
>
> This posture happens to be the right answer on honesty grounds too: **a
> citation that links to the live article cannot go silently stale in the way a
> mirrored copy can.**

That second sentence is the load-bearing one here. This is the
**worst-instrumented source in the catalogue** — unversioned, changes without
notice, exposes no `updatedAt`, and there is **no machine staleness signal at
all**. A mirrored copy would be a snapshot with no way to know it had drifted.
A link cannot drift; it can only 404, which is loud.

## The six articles that matter for these use cases

Cite these by URL. Do not copy their bodies into this repository or into any
store.

| # | Article | Used by |
|---|---|---|
| 1 | [Remote Work Authorization: What it is and How to request it](https://support.remote.com/hc/en-us/articles/37802834593805-Remote-Work-Authorization-What-it-is-and-How-to-request-it) | UC-03, UC-04 |
| 2 | [Travel Support Letters: What are they and How to request one](https://support.remote.com/hc/en-us/articles/37802056865933-Travel-Support-Letters-What-are-they-and-How-to-request-one) | UC-03 |
| 3 | [What is the Requests section?](https://support.remote.com/hc/en-us/articles/6738702420877-What-is-the-Requests-section) | UC-03, UC-04 |
| 4 | [How to request a Remote work authorization](https://support.remote.com/hc/en-us/articles/21960403649293-How-to-request-a-Remote-work-authorization) | UC-04 |
| 5 | [How to approve an employee's travel letter](https://support.remote.com/hc/en-us/articles/20094378700557-How-to-approve-an-employee-s-travel-letter) | UC-03 |
| 6 | [Maintaining Legal Status and Avoiding Risks as a Foreign Worker](https://support.remote.com/hc/en-us/articles/31134933870989-Maintaining-Legal-Status-and-Avoiding-Risks-as-a-Foreign-Worker) | UC-04, UC-07, UC-08 |

## What these articles are believed to state — and the honesty caveat on it

`KNOWLEDGE-SOURCES.md` L2-06 records the following as the **process facts no API
states**: that a Remote Work Authorization is required before working from any
location outside the country of employment; that **only the employee can file
one**; that a travel letter needs two weeks' notice; that the employer approves
first and Remote second; and that Remote's own review covers immigration/visa,
tax, social security, and local legal and reporting requirements.

**None of that was verified in place by this pass.** It is
`[CONFIRMED — support, via index snippet]` and no stronger. Before any of it
becomes load-bearing — before a public reply quotes it to a customer — **open the
article in a browser and re-read it.** The URLs above are what that check needs.

## The value this source would unlock, restated so it is not lost

The catalogue names this the **highest-value corpus candidate** in the whole
document, for one concrete reason: it converts UC-03's dead-end `route_to_uc04`
— which today posts a private note and tells the employee nothing
(`docs/research/CROSS-BORDER-FLOW.md` §7 D-4) — into a completed self-service
journey. The change is a **public reply carrying a link and one quoted sentence**,
which is exactly what the cite-and-link posture permits. It does not require
vendoring anything.
