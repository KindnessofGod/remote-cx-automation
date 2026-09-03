# D-05 · Canada (Ontario) — Employment Standards Act, 2000, Part XV · **RETRIEVED 2026-09-02 — the slot that had been blocked since 2026-08-19**

> **This document closes a `RETRIEVAL-BLOCKED.md` entry rather than opening a new
> catalogue number.** D-05 has been reserved for Ontario's ESA since the first
> Layer-1 pass and was recorded as `⛔ class C (JS)` — *"e-Laws is
> JavaScript-only"*. That was true of the page and never true of the data. See
> "How it was unblocked" below, because the method generalises.

| | |
|---|---|
| **Catalogue id** | D-05 (`docs/knowledge/DOWNLOAD-MANIFEST.md`) · previously listed in [`RETRIEVAL-BLOCKED.md`](RETRIEVAL-BLOCKED.md) §4 |
| **Source name** | **Employment Standards Act, 2000, S.O. 2000, c. 41**, **Part XV — Termination and Severance of Employment** (ss. 53.2–67), with s. 5 (*No contracting out*) read for scope |
| **Publisher / authority** | **King's Printer for Ontario**, e-Laws (`ontario.ca/laws`) |
| **Exact URL** | Human-readable: <https://www.ontario.ca/laws/statute/00e41>. **The bytes** came from the endpoint that page's own bundle calls: <https://www.ontario.ca/laws/api/v2/legislation/en/doc-search/statute/00e41>, with the currency date from <https://www.ontario.ca/laws/api/v2/legislation/en/currency-date>. |
| **Retrieved** | **2026-09-02**, by `curl`. HTTP 200, **851,430 bytes** of JSON whose `content` field is the Act's own HTML. Saved at [`sources/D-05-ca-on-esa-2000.json`](sources/D-05-ca-on-esa-2000.json). |
| **SHA-256 of the retrieved bytes** | `20e8c2e6b1a1c7a13554d2994258d164205a9c7792f800c266d26752579a7e1d` |
| **Source `updatedAt`** | The document states **`"Consolidation Period: From January 1, 2026 to the e-Laws currency date"`**, `dateFrom 2026-01-01`, `updatedAt 2026-04-08T20:34:36Z`. The currency endpoint returns **`August 28, 2026`** — 16 bytes, the whole answer. Both are recorded because they are different facts: one is when this version came into force, the other is how far e-Laws has been brought up to date. |
| **Licence / basis for inclusion** | **King's Printer's policy on copyright in legal materials**, read live at <https://www.ontario.ca/page/copyright-information> (2026-09-02, page's own *"Updated: September 29, 2022"*) and quoted in full below. Reproduction of statutes is permitted without permission or charge, subject to two conditions, **both of which this document meets**. **Bytes committed.** |
| **Evidence tag** | `[CONFIRMED — statute, retrieved 2026-09-02]` |

**The licence, quoted verbatim, because the manifest listed it as unread:**

> The King's Printer for Ontario holds copyright in Ontario statutes, regulations
> and judicial decisions. The King's Printer permits any person to reproduce the
> text and images contained in the statutes, regulations and judicial decisions
> **without seeking permission and without charge**. The legal materials must be
> reproduced accurately, and Crown copyright in the legal materials must be
> acknowledged in the following form: **© King's Printer for Ontario, 20__.** …
> The *Legislation Act, 2006* sets out which copies of Ontario statutes and
> regulations are official copies of the law. **Reproductions of statutes and
> regulations that are not official copies under that Act must state that they
> are not official versions.**

> **© King's Printer for Ontario, 2000.** **This is not an official version** of
> the *Employment Standards Act, 2000*. The official version is published by the
> King's Printer at the URL above.

Note this licence is **narrower than SI/97-5** (D-04, federal) in one respect —
it demands the non-official-version statement — and **broader than the canada.ca
terms of use** (D-21) in another: it draws **no commercial / non-commercial
distinction**. Three Canadian sources, three different licences, and this corpus
now holds all three.

## How it was unblocked, because the method generalises

`RETRIEVAL-BLOCKED.md` classified e-Laws as class C, *JavaScript-only*. Fetching
`https://www.ontario.ca/laws/statute/00e41` does return 54 KB of HTML that strips
to **415 characters**, all of it *"e-Laws needs JavaScript to function properly"*.
The classification described what happened and generalised it into a property of
the site.

What was actually true is that the **page** is a React app and the **data** is
a plain JSON endpoint the app fetches. Finding it took reading the app's own
bundle — `/laws/static/js/main.dbd400db.js` — for the base URL
(`https://www.ontario.ca/laws/api/v2/legislation`) and the path shape
(`/{lang}/doc-search/{type}/{id}`). No browser, no headless Chrome — the route
`RETRIEVAL-BLOCKED.md` §3 argues against, and correctly.

**The transferable lesson is the one this repository keeps paying for in other
costumes: a blocker that names one caller is not a blocker on the question.**
That is the same correction §7 item 6 of `CLAUDE.md` records for `pg` versus
`/queue`, arriving here from a different direction. The catalogue entry should
have read *"the HTML page is JS-only"*, which is a fact, rather than *"e-Laws is
JS-only"*, which is a conclusion.

## Part XV, and the only sentence in the Act that runs from an employee

Every notice obligation in Part XV is the employer's. The provisions, quoted:

> **54 · No termination without notice.** **No employer shall terminate** the
> employment of an employee who has been continuously employed for three months
> or more unless the employer, (a) has given to the employee written notice of
> termination in accordance with section 57 or 58 and the notice has expired; or
> (b) has complied with section 61.
>
> **57 · Employer notice period.** The notice of termination under section 54
> shall be given, (a) at least **one week** before the termination, if the
> employee's period of employment is less than one year; (b) … **two weeks** …
> one year or more and fewer than three years; (c) … **three weeks** … three
> years or more and fewer than four; (d) **four weeks** … (e) **five weeks** …
> (f) **six weeks** … (g) **seven weeks** … or (h) at least **eight weeks** …
> if the employee's period of employment is **eight years or more**.
>
> **58 · Notice, 50 or more employees.** Despite section 57, the employer shall
> give notice of termination in the prescribed manner and for the prescribed
> period if the employer terminates the employment of 50 or more employees at
> the employer's establishment in the same four-week period.

**A whole-Act search for an employee-side obligation returns nothing.** `resign`
appears seven times in the ESA; six are about *constructive* dismissal, where the
employee resigns in response to the employer. The seventh is the only place a
period of employee notice is named anywhere in the statute, and it is **not a
duty**:

> **63 (1)** An employer **severs** the employment of an employee if, … **(e)**
> the employer gives the employee notice of termination in accordance with
> section 57 or 58, **the employee gives the employer written notice at least two
> weeks before resigning** and the employee's notice of resignation is to take
> effect during the statutory notice period.
>
> **65 (3) · Where employee resigns.** If an employee's employment is severed
> under clause 63 (1) (e), the period between the day the employee's notice of
> resignation took effect and the day the employer's notice of termination would
> have taken effect **shall not be considered in calculating the amount of
> severance pay** to which the employee is entitled.

Read together: the two weeks in s. 63(1)(e) is a **condition an employee may
choose to satisfy in order to keep their severance entitlement** while leaving
early during an employer's notice period. Nothing sanctions an employee who does
not. It is the closest thing in the Act to an employee notice period and it is
the opposite of an obligation — which is exactly the sentence a keyword search
for *"two weeks"* would surface and misread.

## What this settles for `src/uc05/noticePeriodTable.js`

`NOTICE_PERIOD_TABLE.CA` is the table's only `basis: "customary"` row, with
brackets `0 / 7 / 14` days and the citation *"Common-law customary notice (no
statutory employee minimum; varies by province)."*

- **The provincial half of C-13 is now sourced — for one province.** Ontario's
  ESA imposes no notice obligation on a resigning employee. That is what the CA
  row asserts, and it is now evidenced rather than asserted, federally (D-04) and
  in Ontario.
- **And in the same pass it is contradicted, in Quebec.** CCQ art. 2091 (D-44)
  requires **either party** to give reasonable notice. So *"no statutory employee
  minimum; varies by province"* is **half confirmed and half refuted by the same
  pass** — and the refuting half is the one the code's `basis: "customary"` was
  meant to cover. See **C-35**.
- **s. 5 (*No contracting out*) does not cut the other way.** The ESA sets
  minimum standards for employers; it does not prohibit a contract from requiring
  notice from the employee. So the ESA's silence is genuinely silence, and what
  a resigning Ontario employee owes still comes from the contract — the same
  answer as the United States (**C-29**), reached from a fully retrieved statute
  rather than from an argument about WARN's scope.

## What is still open

- **Eight provinces and three territories.** *"Varies by province"* was always a
  claim about thirteen jurisdictions; this pass has read two. One of the two
  contradicts the row, which is the strongest possible argument against treating
  any single province as the Canadian answer.
- **O. Reg. 288/01 (*Termination and Severance of Employment*)**, which
  prescribes the s. 55 exclusions and s. 58's periods, was not retrieved.
