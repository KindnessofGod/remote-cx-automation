# D-21 / D-22 / D-23 · Canada's social security agreement network, and the NL and PT cells

| | |
|---|---|
| **Catalogue id** | D-21, D-22, D-23 (`docs/knowledge/DOWNLOAD-MANIFEST.md`) · L1-03-adjacent (`docs/KNOWLEDGE-SOURCES.md` §4) |
| **Source name** | *International social security agreements and the Canada Pension Plan*, and its sub-page *What is the purpose of international social security agreements?* — which carries the agreement table. Plus the two certificate-of-coverage form pages, **CPT63** (Netherlands) and **CPT55** (Portugal). |
| **Publisher / authority** | **Canada Revenue Agency** (CPP/EI Rulings) |
| **Exact URL** | <https://www.canada.ca/en/revenue-agency/services/tax/canada-pension-plan-cpp-employment-insurance-ei-rulings/international-social-security-agreements-canada-pension-plan.html> · <https://www.canada.ca/en/revenue-agency/services/tax/canada-pension-plan-cpp-employment-insurance-ei-rulings/international-social-security-agreements-canada-pension-plan/what-purpose-international-social-security-agreements.html> · <https://www.canada.ca/en/revenue-agency/services/forms-publications/forms/cpt63.html> · <https://www.canada.ca/en/revenue-agency/services/forms-publications/forms/cpt55.html> |
| **Retrieved** | **2026-08-19**, by `curl` with the full browser header set (a bare `curl` gets 000 from `www.canada.ca`). HTTP 200 for all four. |
| **SHA-256 of the retrieved bytes** | Not recorded — **nothing is committed**; see the licence row. |
| **Source `updatedAt`** | Agreement table page prints **"Date modified: 2024-07-23"**. Both CPT form pages print **"2023-12-04"**. |
| **Licence / basis for inclusion** | **Cite and extract only — no bytes.** canada.ca's terms of use were read live (<https://www.canada.ca/en/transparency/terms.html>, 2026-08-19): non-commercial reproduction is permitted with attribution, accuracy diligence and a statement that the reproduction is a copy of the version at the original URL; **"you may not reproduce materials on this site … for the purposes of commercial redistribution without prior written permission."** A public, career-facing portfolio repository is not clearly non-commercial, so the conservative reading applies. Note this is a **different and narrower licence** from SI/97-5, which governs the Canadian *statutes* in this corpus (D-04, D-16, D-33) and draws no commercial distinction. |
| **Evidence tag** | `[CONFIRMED — agency publication, retrieved 2026-08-19]` |

## The three rows that matter, extracted from the CRA's own table

The table has **61 country rows** and four columns: *Country · Effective date ·
Form number · Maximum period of initial detachment*. Only the rows this
repository's demo set reaches are extracted here; the rest stays at the URL.

| Country | Effective date | Certificate form | **Maximum period of initial detachment** |
|---|---|---|---|
| **Netherlands** | October 1, 1990 | **CPT63** | **60 months** |
| **Portugal** | May 1, 1981 | **CPT55** | **24 months** |
| **United States** | August 1, 1984 | **CPT56** | **60 months** |

The column heading is the finding. **The detachment maximum is a property of the
agreement, not a constant** — Canada–Netherlands allows 60 months and
Canada–Portugal 24, for the same employer sending the same person. Nothing in
`src/uc04/` has a field for this, and there is no default that would be right
for both.

## Why the CRA table and the SSA table are not interchangeable

The manifest warned about this; the retrieved data makes it concrete.

| Pair | Authority | Effective date |
|---|---|---|
| **US**–Portugal | SSA (D-20) | **1989-08-01** |
| **Canada**–Portugal | CRA (D-21) | **1981-05-01** |

Two separate bilateral networks, two publishing authorities, two tables, two
sets of dates and two certificate regimes. "Portugal has a totalization
agreement" is not a fact about Portugal; it is a fact about a **pair**.

## What this closes for `src/uc04/`

`docs/knowledge/DOWNLOAD-MANIFEST.md` §7 records that `NL_CA`, `PT_CA`, `NL_US`
and `PT_US` appear in **neither** `EU_EEA_FOR_A1` **nor** `NON_TREATY_PAIRS`, so
neither branch fires and those trips produce **no social-security finding of any
kind** — a silence that reads to a specialist as "nothing to consider."

For the two Canadian pairs, the answer is now: **covered**, by a named
agreement, with an effective date, a certificate form and a maximum initial
detachment. CPT63 and CPT55 are the exact Canadian analogues of the EU's A1
attestation (D-18 art. 19(2)) — and, as the table shows, they are **not
interchangeable with each other**.

Recorded as [`CONTRADICTIONS.md`](CONTRADICTIONS.md) **C-9**. **No `src/` change
is made by this pass.**

---

# D-22 and D-23 · the agreement **texts**, retrieved 2026-08-19

> **This supersedes the "What was not retrieved" note that closed the previous
> version of this file.** `www.treaty-accord.gc.ca` was added to the container's
> allowlist and the three instruments below were read from Global Affairs
> Canada's own treaty register. Everything above — the CRA administrative table —
> is unchanged and still accurate as a description of what the CRA publishes.
> **The point of this section is that the CRA's Netherlands row and the
> agreements do not agree.**

| | |
|---|---|
| **Catalogue id** | D-22 (Canada–Netherlands), D-23 (Canada–Portugal) |
| **Source name** | **E102196** *Agreement on Social Security Between Canada and the Kingdom of the Netherlands*, CTS **1990 No. 14** · **E102195** *Supplementary Agreement Amending* the same, CTS 1990 No. 14 · **E104279** *Agreement on Social Security Between the Government of Canada and the Government of the Kingdom of the Netherlands*, CTS **2004/6** · **E102185** *Agreement between Canada and Portugal with respect to Social Security*, CTS **1981/15** |
| **Publisher / authority** | **Global Affairs Canada**, Canada Treaty Information (Treaty Law Division) |
| **Exact URL** | <https://www.treaty-accord.gc.ca/text-texte.aspx?lang=eng&id=102196> · <https://www.treaty-accord.gc.ca/text-texte.aspx?lang=eng&id=102195> · <https://www.treaty-accord.gc.ca/text-texte.aspx?lang=eng&id=104279> · <https://www.treaty-accord.gc.ca/text-texte.aspx?lang=eng&id=102185> (details pages at `details.aspx?lang=eng&id=<same id>`) |
| **Retrieved** | **2026-08-19**, by `curl` with a full browser header set. HTTP 200 for all four: 41,352 / 13,696 / 54,164 / 43,844 bytes. |
| **SHA-256 of the retrieved bytes** | `b5bf116f60bc11a0447ac259947b097d8a56ccbfe3a3387e9eafd74c67c67f29` (102196) · `01d8d5d5a6a00ce8c47650363969cfeff948a33dc4314e1c3787b2c6bf4362ce` (102195) · `8ea8d1000d11106fe9f13d496ee63afce4b376b262c2bc1d86d35822a97236e0` (102185) · `65ff7ad317368c23ba9237b3dffb3713d7f40577b2f530ea4071ff9c0ca328e8` (104279) |
| **Source `updatedAt`** | Each register entry prints its own signature and entry-into-force dates, quoted below. The site's home page prints *"Date modified: 2019-03-01"*. |
| **Licence / basis for inclusion** | **Cite and extract only — no bytes.** `treaty-accord.gc.ca` links the same canada.ca terms of use as the CRA pages above (<https://www.canada.ca/en/transparency/terms.html>), which permit **non-commercial** reproduction only. Unchanged from the licence reasoning already recorded in this file. |
| **Evidence tag** | `[CONFIRMED — treaty text, retrieved 2026-08-19]` |

## The finding: there are **two** Canada–Netherlands agreements, and the CRA's row mixes them

| Instrument | Signed | In force | Posting maximum, in the text |
|---|---|---|---|
| **E102196** + **E102195** — the 1987 agreement as amended in 1989 | The Hague, 1987-02-26 (supplement: Ottawa, 1989-07-26) | **1990-10-01** | Article VI(2): *"provided that such assignment does not exceed **twenty-four months**"* |
| **E104279** — a new agreement | Brantford, **2001-06-27** | **2004-04-01** | Article VI(2): *"provided that such assignment does not exceed **sixty months**"* |

The 2004 agreement defines *"previous Agreement"* as the 1987 one *"as amended
by the Supplementary Agreement … signed at Ottawa on 26 July 1989"*, and carries
an express transition:

> In the application of this paragraph in regard to a person who, on the date of
> entry into force of this Agreement, is already on assignment in the territory
> of the other Party and subject to the legislation of the former Party by virtue
> of **Article VI(2) of the previous Agreement**, the reference to **sixty
> months** in sub-paragraph (a) shall be read to refer to the total period during
> which that person may remain subject only to the legislation of the former
> Party […] inclusive of the period already completed before the entry into force
> of this Agreement […]

The **Supplementary Agreement (E102195) does not touch Article VI at all** — it
replaces Article X(3)(a) and Article XIV(2) and (3), on Old Age Security payment
abroad and on pre-1957 Netherlands creditable periods. It was read in full to
establish that, because "an amending instrument exists" is not the same fact as
"the amending instrument changed this article."

**So the CRA's row — *"Netherlands · October 1, 1990 · CPT63 · 60 months"* —
pairs the entry-into-force date of the superseded 1987 agreement with the
detachment maximum of the 2004 one that replaced it.** Both halves are real
numbers; the row is not. Recorded as [`CONTRADICTIONS.md`](CONTRADICTIONS.md)
**C-24**.

## Canada–Portugal: the text agrees with the CRA, and adds the mechanism

There is exactly **one** Canada–Portugal social security agreement in the
register (E102185, CTS 1981/15, signed Toronto 1980-12-15, in force
**1981-05-01** — the CRA's date exactly). Its posting article:

> **Article VII**
>
> **1** — Where […] a worker […] who is subject to the legislation of a Party and
> employed by an employer having his place of business in the territory of that
> Party, is assigned by that employer to work in the territory of the other
> Party, the legislation of the first Party shall continue to apply to him in
> respect of that work relationship **for a period of up to 24 months**.
>
> **3** — **The prior consent of the competent authorities of both Parties**, or
> of the authorities whom they have delegated for that purpose, **is required for
> any extension** of the application of the legislation of the first Party […]
> **when the assignment extends beyond 24 months.**

That last paragraph is the Canadian analogue of the EU's Article 16 agreement
(**D-19**): the maximum is a ceiling with a named, bilateral way past it, not a
cliff. The repository has no representation of either.

## What this does to C-8 and C-9

The C-8 table read *"Canada → Netherlands: 60 months"* and *"Canada → Portugal:
24 months"* on the CRA's authority, and C-9 used that pair as its example of a
maximum varying **per pair within one network**. The conclusion survives and its
evidence is now stronger and differently shaped: the maximum varies per pair
**and per vintage of the agreement**, so a table keyed `(pair → months)` is still
under-specified. The honest key is
`(pair, instrument, in-force date → maximum, extension mechanism)`.

**And the general lesson is the one this corpus keeps paying for.** The CRA table
is the administering agency's own record, it was retrieved from the authority, it
was not a mirror, and it is still wrong in one cell. *"Get it from the body that
has a reason to maintain it"* is a much better rule than the alternatives and it
is not a guarantee. Only reading the instrument caught this.

## A retrieval note worth keeping: the register's search is down

`www.treaty-accord.gc.ca` is reachable and serves `index.aspx`, the first page of
`result-resultat.aspx` (50 of *"4425 Treaties found"*), `details.aspx?id=<n>` and
`text-texte.aspx?id=<n>`. **Every POST fails with an IIS `500`** — the search
form, and the *"Show More Treaties"* pagination button alike. The site says so
itself, in a message its own markup carries but does not display: *"The data you
are trying to access is not currently available. Please try again later."* So the
three instruments were located by enumerating `details.aspx?id=` over the id range
the register occupies (~101,000–105,845) and reading the titles.

**That enumeration is the reason the 2004 agreement was found at all.** A search
for "Canada Netherlands social security" would have returned the agreement the
CRA's date points at; walking the register returned all three, and the third is
the one that mattered. Filed under classification **E** in
[`RETRIEVAL-BLOCKED.md`](RETRIEVAL-BLOCKED.md) §1 — *the host answers, the
document is there, and the site's own index cannot reach it.*
