# `docs/knowledge/` — the vendored source material

> The companion to **`docs/KNOWLEDGE-SOURCES.md`**, which is the catalogue: what
> every source is, how it sorts (table / corpus / out), and why. **This directory
> is what was actually retrieved.** Read the catalogue for the reasoning; read
> this for the evidence.
>
> **Every file here carries a provenance header** — source name, publisher,
> exact URL, retrieval date, SHA-256 of the retrieved bytes, licence and why it
> permits inclusion, and the catalogue id. A vendored file with no provenance
> header is worse than no file, because it looks authoritative and cannot be
> checked. If you add one, match the header.

**Retrieval passes: 2026-08-19, three of them.** Method: `curl` and `WebFetch`
from the build container, through this session's egress proxy — plus, for three
US immigration pages that refuse this container's **address**, a manual
transcription by the repository owner, marked as such in its own provenance.

The **first** pass retrieved Layer 2 and Layer 3 and was refused by every
Layer-1 authority. The **second**, after the container's egress allowlist was
opened for the statutory hosts, retrieved **26 of 39**. The **third**, after six
more hosts opened, took it to **35 of 39** — and **class A, our own network
refusing an authority, is now empty**. What each pass could and could not reach,
and the **five** distinct reasons a fetch fails here, are in
[`layer-1-statutory/RETRIEVAL-BLOCKED.md`](layer-1-statutory/RETRIEVAL-BLOCKED.md).

---

## What is here

### Layer 2 — Remote's own policy and data model · `layer-2-remote/`

All five retrieved live, HTTP 200, checksummed. `developer.remote.com` was the
**only external authority this container could reach** on the first pass; that
is no longer true — see the Layer-1 section below.

| File | Catalogue id | Status |
|---|---|---|
| [`L2-01-api-reference-index.md`](layer-2-remote/L2-01-api-reference-index.md) | L2-01 | ✅ Retrieved. Records a **live inventory diff**: six operations exist today that the checked-in `docs/REMOTE-API-INDEX.txt` snapshot does not list, plus one silent URL move. |
| [`L2-02-countries-registry.md`](layer-2-remote/L2-02-countries-registry.md) | L2-02 | ✅ Retrieved. The full `Country` schema, and the three things it settles — including that `code` is **alpha-3 and documented as the API's primary code**. |
| [`L2-03-public-holidays.md`](layer-2-remote/L2-03-public-holidays.md) | L2-03 / **L1-10** | ✅ Retrieved. The one Layer-1 need this pass closes, by preferring Remote's carrier over the national authority. |
| [`L2-04-country-form-schemas.md`](layer-2-remote/L2-04-country-form-schemas.md) | L2-04 | ✅ Retrieved. The complete supported-form list, and **Remote's own instruction not to cache the schemas** — quoted verbatim. |
| [`L2-05-payroll-runs-calendar.md`](layer-2-remote/L2-05-payroll-runs-calendar.md) | L2-05 | ✅ Retrieved. Full `status` and `type` enums; **`cutoff_date` is nullable and not required.** |

### Layer 3 — the per-tenant carriers Remote already provides · `layer-3-carriers/`

**Schemas only. 🔒 No customer data of any tenant appears anywhere in this
directory, and none may.**

| File | Catalogue id | Status |
|---|---|---|
| [`L3-02-custom-fields.md`](layer-3-carriers/L3-02-custom-fields.md) | L3-02 | ✅ Retrieved. Carries the sentence the tenancy finding rests on: custom fields are *"applied to employments **within a company**"*. |
| [`L3-04-leave-policies-and-timeoff.md`](layer-3-carriers/L3-04-leave-policies-and-timeoff.md) | L3-04 | ✅ Retrieved. Includes the field-by-field mapping UC-05's `ptoPayout.js` needs, and the **`type: "unlimited"`** trap. |
| [`L3-06-legal-entities.md`](layer-3-carriers/L3-06-legal-entities.md) | L3-06 | ✅ Retrieved. Flags an **armed, not-yet-fired alpha-3 trap** on a read no risk path has wired yet. |

### Layer 1 — country / statutory · `layer-1-statutory/`

**35 of 39 retrieved.** One sidecar per document (or per closely-bound group),
each carrying the full provenance header; retrieved bytes under
[`layer-1-statutory/sources/`](layer-1-statutory/sources/) **only where the
licence permits a copy and a copy is the honest thing to keep**.

| File | Catalogue ids | Status |
|---|---|---|
| [**`CONTRADICTIONS.md`**](layer-1-statutory/CONTRADICTIONS.md) | — | ⭐ **The output of the passes that matters most.** **Twenty-seven** places where a retrieved document contradicts, refines or confirms a number, a set or a shape that `src/` carries on an assertion, plus **four** confirmations marked as such. **Work orders, not patches** — several items would be wrong to encode. |
| [`RETRIEVAL-BLOCKED.md`](layer-1-statutory/RETRIEVAL-BLOCKED.md) | L1-02 … L1-13 | 🔄 **Rewritten twice.** Now: **five** failure classes and how to tell them apart, a per-host table of where each one sits, the header technique that unblocked four hosts and never will unblock three, why a headless browser is not available here, and the per-document record of the **four** still missing. |
| [`D-07-eu-schengen-borders-code-2016-399.md`](layer-1-statutory/D-07-eu-schengen-borders-code-2016-399.md) | D-07 / L1-05 | ✅ Schengen Borders Code art. 6, consolidated 2025-10-12. The 90/180 window is **per day of stay**, not per trip. |
| [`D-08-eu-schengen-bg-ro-accession.md`](layer-1-statutory/D-08-eu-schengen-bg-ro-accession.md) | D-08 / L1-05 | ✅ Both Council decisions. Dates the 29-code Schengen set — and **confirms it is right**. |
| [`D-09-eu-visa-annexes-2018-1806.md`](layer-1-statutory/D-09-eu-visa-annexes-2018-1806.md) | D-09 / L1-06 | ✅ Annexes I and II, in full. CA and US are Annex II — **and art. 6(3) lets a Member State carve out paid activity.** |
| [`D-17-eu-reg-883-2004.md`](layer-1-statutory/D-17-eu-reg-883-2004.md) · [`D-18-eu-reg-987-2009.md`](layer-1-statutory/D-18-eu-reg-987-2009.md) | D-17, D-18 / L1-04 | ✅ Arts. 11/12/13 and the implementing arts. 14/16/19. The A1's legal basis, the 24-month posting limit, and the 25 % *indicator* that must not become a threshold. |
| [`D-20-us-ssa-totalization-status.md`](layer-1-statutory/D-20-us-ssa-totalization-status.md) | D-20 / L1-03 | ✅ US↔NL, US↔PT, US↔CA **all in force**, with dates and citations. Closes `UC-04.md` §3's `[PROPOSED — build-time task]`. |
| [`D-21-D-22-D-23-ca-social-security-agreements.md`](layer-1-statutory/D-21-D-22-D-23-ca-social-security-agreements.md) | D-21, D-22, D-23 | ✅ CRA's own table **and** the agreement texts behind it. There are **two** Canada–Netherlands agreements, and the CRA's row pairs the superseded one's date with the current one's 60 months (**C-24**). Canada–Portugal's 24 months checks out (**K-4**). |
| [`D-24-nl-pt-tax-convention.md`](layer-1-statutory/D-24-nl-pt-tax-convention.md) · [`D-25-ca-nl-tax-convention.md`](layer-1-statutory/D-25-ca-nl-tax-convention.md) · [`D-26-ca-pt-tax-convention.md`](layer-1-statutory/D-26-ca-pt-tax-convention.md) · [`D-27-D-28-D-29-us-tax-conventions.md`](layer-1-statutory/D-27-D-28-D-29-us-tax-conventions.md) | D-24–D-29 / L1-02 | ✅ **All six** demo pairs, **six different 183-day windows**, none of them the code's — and the day count is one of **three cumulative conditions**. |
| [`D-01-nl-notice-bw-7-672.md`](layer-1-statutory/D-01-nl-notice-bw-7-672.md) · [`D-04-ca-canada-labour-code-part-iii.md`](layer-1-statutory/D-04-ca-canada-labour-code-part-iii.md) · [`D-06-us-warn-act-and-notice-absence.md`](layer-1-statutory/D-06-us-warn-act-and-notice-absence.md) | D-01, D-04, D-06 / L1-09 | ✅ UC-05's notice sources. NL's employee notice is **one flat month** — the tenure ladder is the *employer's*. CA and US both need a **negative**, sourced by argument from scope and tagged `[INFERRED]` for it. |
| [`D-31-nl-awr-art-4-residence.md`](layer-1-statutory/D-31-nl-awr-art-4-residence.md) · [`D-32-pt-cirs-art-16-residence.md`](layer-1-statutory/D-32-pt-cirs-art-16-residence.md) · [`D-33-ca-ita-s250-deemed-resident.md`](layer-1-statutory/D-33-ca-ita-s250-deemed-resident.md) · [`D-34-ca-cra-folio-s5-f1-c1.md`](layer-1-statutory/D-34-ca-cra-folio-s5-f1-c1.md) · [`D-35-us-substantial-presence-test.md`](layer-1-statutory/D-35-us-substantial-presence-test.md) | D-31, D-32, D-33, D-34, D-35 | ✅ **All four** residence tests, and they are **four different shapes**. NL has **no day count at all**; PT has a 183 line *and* a second, count-free limb, and counts only days that include an overnight stay. |
| [`D-10-pt-d8-lei-23-2007-art-61b.md`](layer-1-statutory/D-10-pt-d8-lei-23-2007-art-61b.md) · [`D-11-pt-d8-consular-requirements.md`](layer-1-statutory/D-11-pt-d8-consular-requirements.md) · [`D-14-us-vwp-esta.md`](layer-1-statutory/D-14-us-vwp-esta.md) · [`D-15-us-b1-business-visitor.md`](layer-1-statutory/D-15-us-b1-business-visitor.md) · [`D-16-ca-work-without-permit-irpr-186.md`](layer-1-statutory/D-16-ca-work-without-permit-irpr-186.md) | D-10, D-11, D-14, D-15, D-16 / L1-07 | ✅ The D8's **legal basis** is now read, from the gazette PDF: art. 61.º-B is **one paragraph with no threshold in it** (**C-17**), and the same law creates a *second*, temporary-stay route capped at under a year. Three immigration authorities — USCIS, CBP/State and IRCC — all draw the work line at **activity and payer**; `src/uc04/riskMatrix.js` draws it at the visa label (**C-26**). |
| [`D-02-pt-notice-ct-art-400.md`](layer-1-statutory/D-02-pt-notice-ct-art-400.md) · [`D-03-pt-probation-notice.md`](layer-1-statutory/D-03-pt-probation-notice.md) | D-02, D-03 / L1-09 | ✅ Portugal's notice articles, from the gazette. The 30/60 figures are right; the **bracket boundary is off by one** (**C-18**); the probation row models the **employer**, with a **repealed** number, in the **wrong shape** (**C-20**). |
| [`D-19-eu-practical-guide-applicable-legislation.md`](layer-1-statutory/D-19-eu-practical-guide-applicable-legislation.md) | D-19 / L1-04 | ✅ **Bytes, CC BY 4.0.** The Administrative Commission's guidance: a **two-month break** between postings (**C-22**), a **forward-looking 12-month** assessment window and a **second** indicative percentage at 5 % (**C-23**). Its own version is **December 2013** and the Commission still links it. |
| [`D-36-D-37-D-38-sanctions-register.md`](layer-1-statutory/D-36-D-37-D-38-sanctions-register.md) · [`D-39-un-consolidated-list.md`](layer-1-statutory/D-39-un-consolidated-list.md) | D-36–D-39 / L1-12 | ✅ **Register only — no list bytes, on purpose, and now for two independent reasons.** Four regimes read; the ten-code set matches none of them. Flattening the EU register would **block the United States**; ingesting the UN's reference-number prefixes would **block the United Kingdom**, because `GB` there is Guinea-Bissau (**C-16**, **C-25**). |
| [`L1-01-L1-11-oecd-citation-register.md`](layer-1-statutory/L1-01-L1-11-oecd-citation-register.md) | L1-01, L1-11 | 📝 **Paraphrase-only, permanently.** A citation register (article numbers, editions, what each governs). **No OECD text, now or ever** — a licence constraint, not an access one, and unchanged by the allowlist opening. |

---

## What is deliberately link-only, and why

| Source | Catalogue id | Reason |
|---|---|---|
| **`support.remote.com` help-centre articles** | L2-06 | ⚠ **Cite-and-link only.** Quote only the sentence being acted on, always with the URL. Do not mirror. See [`layer-2-remote/L2-06-support-help-centre.md`](layer-2-remote/L2-06-support-help-centre.md) — a citation register for the six articles that matter, with no bodies copied. Quoting a paragraph back to a Remote customer inside a Remote CX workflow is the evident intended use; mirroring the help centre into a store is a materially different act nobody has granted. It is also the **worst-instrumented** source in the catalogue — no version, no `updatedAt`, no machine staleness signal — so a link cannot go silently stale where a copy would. |
| **`developer.remote.com` pages** | L2-01 … L2-05, L3-02/04/06 | Retrieved, but reproduced as **schema facts and short attributed quotations only** — never the page. Wholesale republication is not ours to grant (`KNOWLEDGE-SOURCES.md` L2-01). The catalogue flagged this as a question to raise if it came up; it came up, and no-mirror is the answer taken. |
| **OECD Model, Commentaries, BEPS Action 7** | L1-01, L1-11 | ⚠ **Paraphrase only.** Copyrighted and sold as a publication. |
| **Remote's supported-country dataset (224 rows)** | L2-02 | Live-queryable, so a copy buys nothing and *"do not republish as a standalone dataset"* costs nothing to honour. |
| **Sanctions lists** | L1-12 | Licences are clean, but a checked-in copy is precisely the *"helpful cached fallback"* the catalogue names as dishonest to ship. The right shape is a scheduled fetch with a **fail-closed** gate, not a file here. |

## What is excluded entirely — not fetched, not vendored, not paraphrased

**Commercial databases: IBFD, Bloomberg Tax, Vialto, Big-4 country guides**
(`KNOWLEDGE-SOURCES.md` X-03). Their terms almost universally forbid
redistribution and machine ingestion. **Do not fetch. Do not scrape. Do not
embed.**

Likewise out of scope by kind, not by licence: individual tax advice (X-01),
immigration legal advice (X-02), Remote's unpublished internal compliance
criteria (X-04), case law (X-05), and any named individual's history beyond the
employment record (X-06).

## What could not be retrieved

**Four of the 39 Layer-1 documents, plus `support.remote.com`** — and no two for
the same reason. **D-05** (Ontario e-Laws, JavaScript-only), **D-12** (AIMA,
incomplete TLS chain), **D-13** (re-scoped and not retried), **D-30** (OECD,
a licence limit rather than an access one). Five failure classes, with five
different remedies, are set out in
[`layer-1-statutory/RETRIEVAL-BLOCKED.md`](layer-1-statutory/RETRIEVAL-BLOCKED.md)
§1: **egress policy** (ours, and now empty), **site bot protection** (theirs),
**JavaScript-only pages**, **origin TLS misconfiguration**, and — new — **the
site's own index is broken** while its documents serve fine.

A **working headless browser** would close D-05; Chromium is preinstalled here
and cannot complete an HTTPS request through this container's egress proxy,
diagnosed rather than assumed in §3 of that file. But the third pass is a caution
against treating that as the whole answer: the *other* JavaScript-only blockage,
Portugal's DRE, fell without a browser, because the same authority publishes the
same documents as static PDFs on a sibling host. **"Class C" describes a delivery
channel, not an authority.**

`support.remote.com` failed twice over, differently: `curl` reached Cloudflare
and got a 403 challenge page; `WebFetch` was refused at the egress proxy. Two
tools, two failures, neither a retrieval.

**A route that was available and deliberately refused, on both passes:**
third-party mirrors of the EU annexes, the SSA list and the OFAC files exist on
`raw.githubusercontent.com`, which *is* reachable. Vendoring one would put an
authority's name in a provenance header above bytes nobody in this chain read
from that authority. An honest blank is recoverable; a plausible wrong list is
not.

**The second pass settled the argument empirically.** The EU annexes and the SSA
list were both retrieved **from their publishers**, so a mirror would have
produced a file that was *mostly right* and demonstrably unnecessary — and
"mostly right" is the hardest kind of wrong to detect. Holding the line cost one
extra pass and nothing else.

---

## The one rule that governs anything added here

`KNOWLEDGE-SOURCES.md` §11: **a corpus that looks comprehensive and is not is
worse than a small one that says what it is.** Nine paraphrased general
principles under a heading like "Global Tax & Mobility Knowledge Base" would make
every individual element honest and the assembly dishonest.

And the structural rule, which is greppable and therefore checkable: **no
`policyEngine.js` may import from a retriever, and no citation id may ever appear
in a conditional.** Nothing in this directory is a decision input. Citations
enter a dossier, get rendered to a human, and go nowhere else.
