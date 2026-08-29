# L1-01 and L1-11 · OECD Model Tax Convention, Commentaries, and BEPS Action 7
## **PARAPHRASE-ONLY. NO OECD TEXT MAY EVER BE COPIED INTO THIS REPOSITORY.**

> This is a **citation register**, not a document. It exists so that the
> paraphrases already in `src/uc08/treatyRetriever.js` and
> `src/uc07/mobilityRetriever.js` can be attributed to a precise article, and so
> that nobody later "improves" them by pasting in the source.

| | |
|---|---|
| **Catalogue ids** | L1-01 (Model + Commentaries), L1-11 (permanent establishment / BEPS Action 7) |
| **Publisher / authority** | Organisation for Economic Co-operation and Development (OECD), Paris |
| **URLs** | <https://www.oecd.org/en/topics/policy-issues/tax-treaties.html> (L1-01)<br><https://www.oecd.org/en/topics/sub-issues/beps.html> (L1-11) |
| **Retrieval attempted** | **2026-08-19.** `curl https://www.oecd.org/` → **CONNECT tunnel failed, HTTP 403** at the session's egress proxy. `www.oecd.org` is not on this container's egress allowlist. **Not retrieved.** |
| **Licence** | ⚠ **RESTRICTED — copyrighted, and sold as a publication.** Short attributed quotation may fall within fair dealing; **bulk embedding of Commentary text is not safe to assume.** |
| **Handling** | **Paraphrase plus precise citation. Never the text.** This holds *regardless of whether the source becomes reachable* — it is a licence constraint, not an access one. |
| **Evidence tag** | `[INFERRED]` for the licensing conclusion (`KNOWLEDGE-SOURCES.md` L1-01 flags it as needing counsel, and this pass does not change that). `[CONFIRMED — repo]` for what the corpus currently contains. **`[PROPOSED]` for the source binding — the documents were not read in this pass.** |

## Why this file contains no OECD text, and would contain none even if reachable

Two independent reasons, and either alone is sufficient:

1. **Licence.** The Model and its Commentaries are a copyrighted OECD
   publication. Nobody has granted this repository the right to reproduce or
   embed them.
2. **Retrieval quality.** `KNOWLEDGE-SOURCES.md` L1-01 makes the point that
   paraphrase *"also happens to be the better retrieval unit, because it is
   written in the vocabulary a support ticket uses."* An employee writes *"I
   might have to pay tax in two places"*, not *"resident of both Contracting
   States."*

**The repository's current posture is already correct and must be kept:** the
three `TREATY_CORPUS` entries are our own paraphrase of the principle, not OECD
text.

## The citation register

Cite these precisely. Each row names what the article governs in one line; the
substance below is `[PROPOSED]` in this pass — **written from the repository's
existing corpus entries and general domain knowledge, not from the source
document, which could not be retrieved.** Anyone making a load-bearing claim on
one of these must open the article first.

| Citation | Instrument | What it governs | Repo corpus entry |
|---|---|---|---|
| **Article 4** — Resident | OECD Model Tax Convention on Income and on Capital | The dual-residence tie-breaker **ladder**, applied in order: permanent home available → centre of vital interests → habitual abode → nationality → mutual agreement between the states. | `oecd-model-art-4` |
| **Article 5** — Permanent Establishment | OECD Model Tax Convention; Commentary substantially rewritten in the **2017** edition | When a fixed place of business, or a dependent agent habitually concluding contracts, creates a taxable corporate presence. | (UC-07 `mobility-pe-risk`) |
| **Article 15** — Income from Employment | OECD Model Tax Convention | The residence state keeps exclusive taxing rights only if **all three** conditions hold: ≤183 days' presence in any 12-month period, employer not resident in the other state, and remuneration not borne by a PE there. | `oecd-model-art-15` |
| **BEPS Action 7 final report (2015)** — *Preventing the Artificial Avoidance of Permanent Establishment Status* | OECD/G20 Base Erosion and Profit Shifting Project | The commissionnaire and dependent-agent changes that fed the 2017 Article 5 rewrite. | (UC-07 `mobility-pe-risk`) |
| **Multilateral Instrument (MLI, 2016)** | OECD | Modifies many bilateral treaties **without changing their published text** — see the warning below. | — (no entry; see L1-02) |

**Editions.** The Model has been updated roughly every 3–5 years (2010, 2014,
2017, …); the Commentaries move more often. **Version-stamp the edition on every
passage.** There is no machine feed and no `updatedAt` — watch the OECD tax
treaties page by hand.

## The split that must not be collapsed — 183 is a table entry, Article 15 is not

`KNOWLEDGE-SOURCES.md` L1-01 states it, and it is the single most important line
in this file:

> **The number 183 is a table entry; the test it sits inside is corpus.**
> A system that reads "183" from a table and reports "under the threshold, no
> exposure" has answered **one third** of the question and hidden the other two.

The existing `oecd-model-art-15` corpus entry is written as the *three
conditions*, not as the number. Keep it that way.

## L1-11 — permanent establishment: corpus, and it may never be anything else

There is **no threshold to encode**. PE determination is exactly what competent
specialists are paid to disagree about, so the catalogue's Test A fails at the
first question.

The repository already gets this right in both places, and both must be
preserved:

- UC-07's corpus entry instructs flagging `PE_REVIEW_REQUIRED` *"rather than
  concluding whether a PE exists — that is a professional tax determination"*.
- UC-04's risk matrix raises `pe_risk_dape` as a **flag that escalates**, never
  as a verdict.

Note also that Remote itself collects `will_negotiate_or_sign_contracts` on the
work-authorization object — the classic dependent-agent test — and **does not
publish what it does with it** (`docs/research/CROSS-BORDER-FLOW.md` §6,
`[SILENT]`). We infer PE assessment; **Remote has not said so**, and no output
may claim otherwise.

## The MLI wrinkle, recorded here because it is the cleanest argument for versioning

The BEPS Multilateral Instrument modifies many existing bilateral treaties
**without changing their published text**. So a treaty's *effect* can change
while every source document you monitor stays byte-identical.

That is why a table needs a **version**, not just a content hash. Detection is
the in-force list each state publishes — **diff the list, not the text.**
