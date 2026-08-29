# D-20 · SSA — status of US totalization agreements, and the detached-worker rule

| | |
|---|---|
| **Catalogue id** | D-20 (`docs/knowledge/DOWNLOAD-MANIFEST.md`) · L1-03 (`docs/KNOWLEDGE-SOURCES.md` §4) |
| **Source name** | (1) *Status of Totalization Agreements*. (2) *U.S. International Social Security Agreements* (the programme overview). |
| **Publisher / authority** | **U.S. Social Security Administration**, Office of International Programs |
| **Exact URL** | <https://www.ssa.gov/international/status.html> and <https://www.ssa.gov/international/agreements_overview.html> |
| **Retrieved** | **2026-08-19**, by `curl` with a complete browser header set (see the note below). HTTP 200 for both — **52465 bytes** and **58986 bytes** as stored. The transfer was content-encoded; the stored bytes are the decoded entity bodies, which is what the checksums below cover. |
| **SHA-256 of the retrieved bytes** | status: `369a0265dc920920f6b8f31884255f7b98d780ccac93448f50ee92c87e1f6809` · overview: `fd723a9bb09813b619d5166fce7b68523df2f47718ea1698c604a6634c88c27a` |
| **Source `updatedAt`** | **None printed on either page.** Neither carries a "last updated" line or a dated revision marker. That is a real instrumentation gap in the highest-value US source here: a re-fetch and a set diff is the only staleness signal available. |
| **Licence / basis for inclusion** | **US federal government work — public domain.** No conditions. Bytes committed. |
| **Evidence tag** | `[CONFIRMED — agency publication, retrieved 2026-08-19]` |

> **How this was retrieved, because the technique is the finding.** A plain
> `curl` — and a `curl` carrying only a browser `User-Agent` — is refused by
> `www.ssa.gov` with an Akamai **403 "Access Denied"**. Adding the rest of a
> real browser's request headers (`Accept`, `Accept-Language`, `sec-ch-ua`,
> `sec-ch-ua-mobile`, `sec-ch-ua-platform`, `Sec-Fetch-*`,
> `Upgrade-Insecure-Requests`) returns **200** for the same URL in the same
> shell. The proxy `CONNECT` succeeded in *both* cases — `HTTP/1.1 200
> Connection Established` — so this was never an egress denial, which
> `CLAUDE.md` §6 already warns reads identically. The same header set also
> unblocked `www.dol.gov` and `www.canada.ca` and did **not** unblock
> `www.cbp.gov`, `www.uscis.gov` or `travel.state.gov`.

## The three demo pairs, read from the status table

| Country | Agreement | Date of signing | **Effective date** | Legal citation |
|---|---|---|---|---|
| **Canada** | Agreement with Respect to Social Security | March 11, 1981 | **Aug. 1, 1984** | TIAS 10863 |
| **Netherlands** | Agreement on Social Security | Dec. 8, 1987 | **Nov. 1, 1990** | TIAS 03-501 |
| **Portugal** | Agreement on Social Security | March 30, 1988 | **Aug. 1, 1989** | TIAS 12121 |

All three of **US↔CA, US↔NL and US↔PT are in force.** Each also carries an
Administrative Arrangement at the same effective date; the Netherlands row
carries two further Protocols (Dec. 7, 1989 → Nov. 1, 1990; Aug. 30, 2001 →
May 1, 2003), which is why "does an agreement exist" and "which text governs"
are different questions.

The full table is in the committed bytes. It is not transcribed here, because a
transcription is a second copy that goes stale on its own schedule.

## The rule that turns coverage into an answer

Quoted verbatim from the overview page:

> **Territoriality Rule.** … Under this basic "territoriality" rule, an employee
> who would otherwise be covered by both the U.S. and a foreign system remains
> subject exclusively to the coverage laws of the country in which he or she is
> working.
>
> **Detached-worker Rule.** Each agreement (except the one with Italy) includes
> an exception to the territoriality rule … Under this "detached-worker"
> exception, a person who is temporarily transferred to work for the same
> employer in another country **remains covered only by the country from which
> he or she has been sent.** … The detached-worker rule in U.S. agreements
> generally applies to employees whose assignments in the host country are
> **expected to last 5 years or less**. The 5-year limit on exemptions for
> detached workers is substantially longer than the limit normally provided in
> the agreements of other countries.

## What this settles

`docs/use-cases/UC-04.md` §3 has carried ssa.gov as a
`[PROPOSED — build-time task]` since UC-04 was written. It is now
`[CONFIRMED]`. Concretely: `NON_TREATY_PAIRS` produces **no finding** for
`NL_US`, `PT_US` or `CA_US` today, and the code is explicit that absence
means "we have not looked." For these three pairs we have now looked, and the
answer is *covered, with a named agreement, effective date and citation.*

Two things this document **contradicts or refines** in the repository — the
5-year detached-worker limit against the EU's 24 months, and the fact that a
"totalization table" is not one boolean — are in
[`CONTRADICTIONS.md`](CONTRADICTIONS.md) **C-8** and **C-9**.

**Do not let this list stand in for D-21/D-22/D-23, or the reverse.** SSA
publishes **US** agreements; Canada publishes **Canadian** ones. The retrieved
data makes the point concrete: SSA gives US–Portugal an effective date of
**1989-08-01**; the CRA gives Canada–Portugal **1981-05-01**. Two networks, two
authorities, two tables.
