# D-04 · Canada — federal labour standards, and the negative they are used for

| | |
|---|---|
| **Catalogue id** | D-04 (`docs/knowledge/DOWNLOAD-MANIFEST.md`) · L1-09 (`docs/KNOWLEDGE-SOURCES.md` §4) |
| **Source name** | Canada Labour Code, R.S.C. 1985, c. L-2, **section 230** (Part III, Division X — Individual Terminations of Employment) |
| **Publisher / authority** | **Department of Justice Canada**, Justice Laws Website |
| **Exact URL** | <https://laws-lois.justice.gc.ca/eng/acts/L-2/section-230.html> |
| **Retrieved** | **2026-08-19**, by `curl`. HTTP 200, **47523 bytes** as stored (decoded entity body). Saved at [`sources/D-04-ca-canada-labour-code-s230.html`](sources/D-04-ca-canada-labour-code-s230.html). |
| **SHA-256 of the retrieved bytes** | `89ad09ca567d126fec5c9e72ac0d03364ae0b4eb66b7efef39a2eb382a0e0d40` |
| **Source `updatedAt`** | The page prints its own currency line: **"Act current to 2026-06-17 and last amended on 2025-12-12."** That is the version row this corpus needs — it distinguishes *when the consolidation was taken* from *when the law last moved*. |
| **Licence / basis for inclusion** | **Reproduction of Federal Law Order, SI/97-5**, read live at <https://laws-lois.justice.gc.ca/eng/regulations/SI-97-5/page-1.html> (retrieved 2026-08-19, page's own "Date modified: 2026-08-06") and quoted in full below. Bytes committed with the required disclaimer. |
| **Evidence tag** | `[CONFIRMED — statute, retrieved 2026-08-19]` |

> **Disclaimer required by SI/97-5.** This is a reproduction of a Government of
> Canada enactment. **It is not the official version.** The official version is
> published by the Department of Justice at the URL above.

**The licence itself, quoted verbatim, because the manifest listed it as
unverified:**

> Anyone may, without charge or request for permission, reproduce enactments and
> consolidations of enactments of the Government of Canada, and decisions and
> reasons for decisions of federally-constituted courts and administrative
> tribunals, provided due diligence is exercised in ensuring the accuracy of the
> materials reproduced and the reproduction is not represented as an official
> version.

Note that SI/97-5 draws **no commercial/non-commercial distinction**, unlike the
canada.ca terms of use (read live, see D-21). That difference is why the
Canadian *statutes and regulations* in this corpus carry their bytes and the
Canadian *agency pages* do not.

## Section 230, on who owes notice to whom

> **230 (1)** An employer who terminates the employment of an employee must give
> the employee (a) notice in writing of the employer's intention to terminate
> their employment … at least the applicable number of weeks set out in
> subsection (1.1) before that date; (b) wages in lieu of notice …; or (c) any
> combination …
>
> **(1.1)** The applicable number of weeks … is (a) **two weeks**, if the
> employee has completed at least **three consecutive months** …; (b) **three
> weeks** … three consecutive years; (c) **four weeks** … four years; (d) **five
> weeks** … five years; (e) **six weeks** … six years; (f) **seven weeks** …
> seven years; and (g) **eight weeks**, if the employee has completed at least
> **eight consecutive years** of continuous employment with the employer.

## What this settles, and how strongly

`NOTICE_PERIOD_TABLE.CA` is the only row in `src/uc05/noticePeriodTable.js`
with `basis: "customary"`, and its citation asserts *"Common-law customary
notice (no statutory employee minimum; varies by province)."* That is a negative,
and the manifest correctly called it the hardest thing here to source.

**Every obligation in s. 230 runs from the employer.** There is no employee-side
counterpart in the section. That supports the negative by scope in the same way
WARN does for the United States (D-06) — and it supports it **only for
federally regulated industries**, which is the further limit the code's own
comment gestures at and does not bound. Sourcing "no minimum in Canada" needs a
provincial statute too; the intended one, Ontario's ESA 2000 (D-05), **could not
be retrieved** — see [`RETRIEVAL-BLOCKED.md`](RETRIEVAL-BLOCKED.md).

So: the federal half is now `[CONFIRMED]` and the provincial half is still
unevidenced. A CA row written today would be **half-sourced**, and
[`CONTRADICTIONS.md`](CONTRADICTIONS.md) **C-13** says so in those words rather
than letting one statute stand in for a country.
