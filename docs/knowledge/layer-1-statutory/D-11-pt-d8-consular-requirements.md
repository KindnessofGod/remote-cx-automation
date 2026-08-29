# D-11 · Portugal — the D8's actual conditions, as the consular network states them

| | |
|---|---|
| **Catalogue id** | D-11 (`docs/knowledge/DOWNLOAD-MANIFEST.md`) · L1-07 (`docs/KNOWLEDGE-SOURCES.md` §4) |
| **Source name** | *Type of Visa*, *Necessary Documentation — Residency*, *Necessary Documentation — Temporary Stay*, *Means of subsistence*, *National Legislation* — Portal das Comunidades / Visa portal of the Portuguese Ministry of Foreign Affairs |
| **Publisher / authority** | **Ministério dos Negócios Estrangeiros** (Portuguese Ministry of Foreign Affairs), consular network |
| **Exact URL** | <https://vistos.mne.gov.pt/en/national-visas/general-information/type-of-visa> · <https://vistos.mne.gov.pt/en/national-visas/necessary-documentation/residency> · <https://vistos.mne.gov.pt/en/national-visas/necessary-documentation/temporary-stay> · <https://vistos.mne.gov.pt/en/national-visas/necessary-documentation/means-of-subsistence> · <https://vistos.mne.gov.pt/en/national-visas/national-legislation> |
| **Retrieved** | **2026-08-19**, by `curl`. HTTP 200 for all five. The manifest's guessed deep link (`/en/national-visas/necessary-documents/residence-visa-for-remote-work`) does not exist; the site root was crawled instead, exactly as the manifest instructed. |
| **SHA-256 of the retrieved bytes** | Not recorded — **nothing is committed**; see the licence row. |
| **Source `updatedAt`** | **None printed on any of the five pages.** No version, no last-reviewed line, no dated revision marker. This is the worst-instrumented source in the Layer-1 set, and it is the one supplying thresholds — which is an argument for a link rather than a copy, not against it. |
| **Licence / basis for inclusion** | **Cite and link only — no bytes.** No reuse terms are stated anywhere on the site that this pass could find. `docs/KNOWLEDGE-SOURCES.md` L1-07: *"many national portals carry restrictive terms or no stated terms at all. Check per country; do not assume."* |
| **Evidence tag** | `[CONFIRMED — consular authority publication, retrieved 2026-08-19]` |

## What the ministry actually publishes about remote work

**There are two distinct instruments, not one.** Both are listed under "Remote
Work / Digital Nomad" and they are different products:

> **Temporary stay visa** for the exercise of a professional activity done
> remotely — "digital nomads"
>
> **Residency visa** for the exercise of a professional activity done remotely —
> "digital nomads"

And their durations differ, quoted from *Type of Visa*:

> **Temporary stay visas** allow entry and stay in Portugal for **less than a
> year**. Temporary stay visas are valid during the entire stay and allow for
> multiple entries.
>
> **Residency visas** allow **two entries and is valid for a period of 4
> months**. During that time, the holder of a residency visa is required to
> **apply for a residency permit with AIMA** — Agência para a Integração,
> Migrações e Asilo.

## The income condition — and it is not the index the manifest expected

Quoted from *Necessary Documentation — Temporary Stay*, and in materially the
same words from *Residency*:

> For the exercise of a professional activity done remotely - digital nomads
>
> In case of **subordinate work**, one of the following documents: Work
> contract; or, Promise of work contract; or, Declaration by employer confirming
> the labour link.
>
> In case of **independent professional activity**, one of the following
> documents: Society contract; or, Contract of services provision; or, Written
> proposal of services provision contract; or, Document attesting the services
> provided to one or more entities.
>
> **Proof of average monthly income for the last three months with a minimum
> value equivalent to four monthly minimum guaranty remuneration**;
>
> Document attesting his fiscal residence.

The residency page adds: *"For the purposes of proof of means of subsistence
must be considered the funds arising from a contract, a society contract, or, a
service provider contract."* And: *"The referred documents are the mandatory
initial documents to be submitted. The consular post may request additional
documents, at their discretion."*

> **This changes what D-13 is for.** The manifest reasoned that these schemes
> commonly express an income floor as a multiple of a **statutory index**, and
> listed a Portaria fixing the **IAS** (Indexante dos Apoios Sociais) as the
> document needed to keep the figure from going stale. The ministry states the
> floor as **four times the *retribuição mínima mensal garantida* (RMMG — the
> guaranteed monthly minimum wage)**, not the IAS. The manifest's *reasoning*
> was right and its *named index was wrong*; D-13 should be re-scoped to
> whichever instrument fixes the RMMG for the year in question. See
> [`RETRIEVAL-BLOCKED.md`](RETRIEVAL-BLOCKED.md) for D-13's status.

## What this gives `src/uc04/`

`DNV_COUNTRIES_PROVENANCE` exports a `needsForAVersionedTable` list. This
document supplies three of the four things on it for Portugal:

| What the provenance record asks for | What this document supplies |
|---|---|
| A named publishing authority | **Ministério dos Negócios Estrangeiros** (visa); **AIMA** (the residence permit the residency visa converts into) |
| A version or publication date | **Not available** — no date is printed anywhere. The retrieval date is the only anchor. |
| The scheme's own thresholds | **Income:** average monthly income over the last three months ≥ **4 × RMMG**. **Duration:** temporary stay < 1 year; residency visa valid 4 months, two entries, then an AIMA permit. **Evidence:** a contract or employer declaration, plus proof of fiscal residence. |
| A review date and a named owner | A staffing answer; not in any document. |

Membership of `DNV_COUNTRIES` currently **suppresses** the Schengen 90/180
check. This is the document that could turn that blanket exemption into a
condition the request is checked against — and it also shows why "Portugal runs
a DNV" is not a boolean: it is two visas with different durations, and neither
is automatic. Recorded as [`CONTRADICTIONS.md`](CONTRADICTIONS.md) **C-15**.
**No `src/` change is made by this pass.**
