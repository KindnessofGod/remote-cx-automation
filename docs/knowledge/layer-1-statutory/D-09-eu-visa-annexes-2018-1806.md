# D-09 · Visa requirement and exemption — Regulation (EU) 2018/1806, Annexes I and II

| | |
|---|---|
| **Catalogue id** | D-09 (`docs/knowledge/DOWNLOAD-MANIFEST.md`) · L1-06 (`docs/KNOWLEDGE-SOURCES.md` §4) |
| **Source name** | Regulation (EU) 2018/1806 listing the third countries whose nationals must be in possession of visas when crossing the external borders and those whose nationals are exempt from that requirement — **consolidated text `02018R1806 — EN — 30.12.2025 — 009.001`** |
| **Publisher / authority** | European Parliament and Council of the European Union, via the Publications Office (EUR-Lex) |
| **Exact URL** | <https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:02018R1806-20251230> (consolidation date chosen from the list on <https://eur-lex.europa.eu/eli/reg/2018/1806/oj/eng>; 2025-12-30 was the newest as at retrieval) |
| **Retrieved** | **2026-08-19**, by `curl` through this container's egress proxy. HTTP 200, **139945 bytes**, stored verbatim at [`sources/D-09-eu-visa-annexes-2018-1806.html`](sources/D-09-eu-visa-annexes-2018-1806.html). |
| **SHA-256 of the retrieved bytes** | `858fe787b00576287645c6a86fda7fa7c2b8c3ed860963873e4b6cacba24d39a` |
| **Source `updatedAt`** | Consolidation date **30.12.2025**, revision **009.001**. |
| **Licence / basis for inclusion** | EUR-Lex reuse under Commission Decision **2011/833/EU**, verified live against EUR-Lex's own legal notice on 2026-08-19; the consolidated text additionally carries **CC BY 4.0** for the editorial layer, so this file attributes the source and states that no quoted passage has been altered. Bytes committed. |
| **Evidence tag** | `[CONFIRMED — statute, retrieved 2026-08-19]` |

## The two operative articles

> **Article 3(1).** Nationals of third countries listed in **Annex I** shall be
> required to be in possession of a visa when crossing the external borders of
> the Member States.
>
> **Article 4(1).** Nationals of third countries listed in **Annex II** shall be
> exempt from the requirement set out in Article 3(1) **for stays of no more
> than 90 days in any 180-day period**.

And the provision that matters most to a workation, quoted in full:

> **Article 6(3).** A Member State may provide for **exceptions from the
> exemption** from the visa requirement provided for in Article 4 as regards
> **persons carrying out a paid activity during their stay**.

## The four demo countries, located in the annexes

Read directly from the retrieved consolidated text:

| Nationality | Annex | Consequence for a short stay in NL or PT |
|---|---|---|
| **Canada** | **Annex II** (visa-exempt) | No Schengen visa needed for ≤ 90/180 — *subject to Article 6(3)* |
| **United States** | **Annex II** (visa-exempt) | Same |
| Netherlands, Portugal | *neither* — they are Member States, not third countries | The annexes do not apply to them |

Annex II's own heading states the limit rather than leaving it to the Borders
Code: *"LIST OF THIRD COUNTRIES WHOSE NATIONALS ARE EXEMPT FROM THE REQUIREMENT
TO BE IN POSSESSION OF A VISA WHEN CROSSING THE EXTERNAL BORDERS OF THE MEMBER
STATES **FOR STAYS OF NO MORE THAN 90 DAYS IN ANY 180-DAY PERIOD**"*.

**The annexes are not reproduced here in full.** They are ~100 and ~60 entries
and they change — Annex I gained Vanuatu by amendment ▼M6 and Annex II lost an
entry in the same amendment, both visible as change markers in the retrieved
bytes. The committed file is the list; this sidecar is the citation. Anything
that needs the membership set should read
[`sources/D-09-eu-visa-annexes-2018-1806.html`](sources/D-09-eu-visa-annexes-2018-1806.html)
and record the consolidation date it read.

## Why this document was fetched first among the EU set

`docs/KNOWLEDGE-SOURCES.md` L1-06 records these annexes as **absent from the
repository entirely**, and that absence is what lets UC-04's Schengen block run
on a **self-declared `visaType`**. With Canada and the United States both in
the demo set and both in Annex II, the gap is directly reachable. What the text
adds beyond "CA and US are visa-exempt" is Article 6(3) — see
[`CONTRADICTIONS.md`](CONTRADICTIONS.md) **C-4**, which is the finding, not
this file.
