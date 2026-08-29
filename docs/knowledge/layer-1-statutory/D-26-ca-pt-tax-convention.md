# D-26 · Canada–Portugal income tax convention · **RETRIEVED 2026-08-19**

| | |
|---|---|
| **Catalogue id** | D-26 (`docs/knowledge/DOWNLOAD-MANIFEST.md`) |
| **Source name** | **E103231** — *Convention between the Government of Canada and the Government of the Portuguese Republic for the Avoidance of Double Taxation and the Prevention of Fiscal Evasion with respect to Taxes on Income*, **Canada Treaty Series 2001/27** |
| **Publisher / authority** | **Global Affairs Canada**, Canada Treaty Information (Treaty Law Division) |
| **Exact URL** | <https://www.treaty-accord.gc.ca/text-texte.aspx?lang=eng&id=103231> (register entry: `details.aspx?lang=eng&id=103231`) |
| **Retrieved** | **2026-08-19**, by `curl` with a full browser header set. HTTP 200, **72,814 bytes**. |
| **SHA-256 of the retrieved bytes** | `53a5c0625c815c5fb4f9c8d57d66f638a336ee4308c2451d3cb8d73a11a81af9` |
| **Source `updatedAt`** | Signed **Ottawa, 1999-06-14**; entered into force **2001-10-24**. The register prints no separate modification date for the text; the site's home page prints *"Date modified: 2019-03-01"*. |
| **Licence / basis for inclusion** | **Cite and extract only — no bytes.** Same canada.ca terms of use as D-21/D-22/D-23 (<https://www.canada.ca/en/transparency/terms.html>): non-commercial reproduction only, and a public career-facing repository is not clearly non-commercial. |
| **Evidence tag** | `[CONFIRMED — treaty text, retrieved 2026-08-19]` |

> **How it was found, and why the manifest could not.** The manifest's guess for
> this document was a **Finance Canada** page that has never existed — its own
> index points at Global Affairs. The previous pass confirmed the 1999-06-14
> signature date from Finance Canada's in-force index and could go no further
> because `www.treaty-accord.gc.ca` was egress-refused. It is now reachable; the
> register's **search and pagination both return HTTP 500**, so the document was
> located by enumerating `details.aspx?id=` across the register's id range. See
> [`D-21-D-22-D-23-ca-social-security-agreements.md`](D-21-D-22-D-23-ca-social-security-agreements.md)
> for that method and [`RETRIEVAL-BLOCKED.md`](RETRIEVAL-BLOCKED.md) §1 class **E**.

## Article 15(2) — the sixth formulation of the same test

> **2.** Notwithstanding the provisions of paragraph 1, remuneration derived by a
> resident of a Contracting State in respect of an employment exercised in the
> other Contracting State shall be taxable **only in the first-mentioned State
> if**:
>
> **(a)** the recipient is present in the other State for a period or periods not
> exceeding in the aggregate **183 days in any twelve month period commencing or
> ending in the calendar year concerned**, **and**
>
> **(b)** the remuneration is paid by, or on behalf of, an employer **who is not
> a resident** of the other State, **and**
>
> **(c)** the remuneration is **not borne by a permanent establishment** or a
> fixed base which the employer has in the other State.

This completes the pair matrix that **C-10** and **C-11** were built on. It is
the **sixth** window formulation among the six demo pairs, and it is a seventh
distinct thing from `src/uc04/decisionFacts.js`'s single trailing 365 days from a
trip start. Its three limbs are cumulative in the same way as the other five, so
**C-11** applies unchanged: limbs (b) and (c) are the ones that decide an
Employer-of-Record case, and the repository represents neither.
