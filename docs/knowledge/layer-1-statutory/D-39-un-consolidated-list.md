# D-39 · UN Security Council Consolidated List — the register entry, and no list bytes

| | |
|---|---|
| **Catalogue id** | D-39 (`docs/knowledge/DOWNLOAD-MANIFEST.md`) · L1-12-adjacent |
| **Source name** | *United Nations Security Council Consolidated List* |
| **Publisher / authority** | **United Nations Security Council**, Security Council Affairs Division (Subsidiary Organs Branch) |
| **Exact URL** | Landing page: <https://main.un.org/securitycouncil/en/content/un-sc-consolidated-list> — the documented `www.un.org` path 301-redirects here. **Machine-readable list**, as the page itself links it: <https://scsanctions.un.org/resources/xml/en/consolidated.xml> (alphabetical) and <https://scsanctions.un.org/resources/xml/en/name/consolidated.xml> (by permanent reference number); HTML at <https://scsanctions.un.org/consolidated>. |
| **Retrieved** | **2026-08-19**, by `curl` with a full browser header set. Landing page HTTP 200, **211,680 bytes**. A bare `curl` gets `403`; the header set that unblocked `ssa.gov` and `dol.gov` works here too. **The list itself was deliberately not fetched.** |
| **SHA-256 of the retrieved bytes** | `a5dd1bc09c31f9e3446c5a15667c3c5f61024fc0db6c7e97e50b3f8cc2cae51d` (the landing page) |
| **Source `updatedAt`** | The page states it: *"The Consolidated Sanctions List maintained on this website was **last updated on 18 August 2026** and supersedes all previous versions."* One day before this retrieval. |
| **Licence / basis for inclusion** | **Cite and link only — and the manifest's class was wrong.** D-39 was listed as class **(b)**, *"reusable with attribution"*. The UN's own copyright page, read live at <https://www.un.org/en/about-us/copyright> on 2026-08-19, says the opposite: *"Copyright © United Nations **All rights reserved**. **None of the materials provided on this web site may be used, reproduced or transmitted**, in whole or in part, in any form or by any means … except as provided for in the Terms and Conditions of Use of United Nations Web Sites, **without permission in writing from the publisher**."* Class **(c)**. |
| **Evidence tag** | `[CONFIRMED — register description, retrieved 2026-08-19]` |

## Why there are still no sanctions bytes in this repository, now for two reasons

The do-not-vendor rule for D-36/37/38 was a **staleness** judgement:
`docs/KNOWLEDGE-SOURCES.md` §11 names a checked-in sanctions list as the
"helpful cached fallback" that is dishonest to ship, and the right control is a
scheduled fetch with a fail-closed gate. That reasoning applies here unchanged
and is if anything sharper — the list moved **the day before** it was read.

D-39 now adds a **licence** reason on top of it. The two are independent, and
either one alone would be sufficient. Recording both is the point: a future pass
that talks itself out of one still hits the other.

## What the page says that changes how the register should be read

### 1 · It is a list of persons and entities. It is not a list of countries.

> The Consolidated List includes all individuals and entities subject to measures
> imposed by the Security Council. The inclusion of all names on one Consolidated
> List is to facilitate the implementation of the measures, and **neither implies
> that all names are listed under one regime, nor that the criteria for listing
> specific names are the same.**

Composition on the day it was read: **736 individuals** and **275 entities and
other groups**. Zero countries. This is the same structural point OFAC makes in
its own words in [`D-36-D-37-D-38-sanctions-register.md`](D-36-D-37-D-38-sanctions-register.md)
— *"OFAC does not maintain a specific list of countries that U.S. persons cannot
do business with"* — arriving from a second authority, and it is why **C-16**
says the register cannot be flattened into a destination blocklist.

### 2 · The regime codes are two-letter codes that are **not ISO 3166-1**, and one of them collides badly

The page publishes its own referencing system. Permanent reference numbers begin
with a two-letter code, `i` for individuals and `e` for entities:

| Code | Committee / regime |
|---|---|
| `QD` | 1267/1989 (ISIL/Al-Qaida) — **non-State entity** |
| `TA` | 1988 (2011) — **non-State entity** |
| `IQ` | 1518 (2003) · `CD` 1533 (2004) · `SD` 1591 (2005) · `KP` 1718 (2006) · `IR` 1737 (2006) · `LY` 1970 (2011) | |
| **`GB`** | **2048 (2012) — Guinea-Bissau** |
| `YE` | 2140 (2014) · `SS` 2206 (2015) · `HT` 2653 (2022) · `SO` 2713 (2023) · `CF` 2745 (2024) | |

**`GB` in the UN's scheme is Guinea-Bissau. In ISO 3166-1 alpha-2, and
everywhere in this repository, `GB` is the United Kingdom.** Every country field
in `src/` is alpha-2. A pipeline that ingested these reference-number prefixes as
country codes — the obvious thing to do, since the page's own column heading is
*"Two Digit Country Code"* — would produce a restricted-jurisdiction entry for
the **United Kingdom**.

That is C-16's finding in a second, independent costume. C-16 showed that
projecting the **EU** regime register onto a destination blocklist blocks the
**United States**, because the regime attached to `US` is the Blocking Statute —
a measure protecting *against* it. Here the mechanism is different (a code-space
collision rather than an inverted relation) and the failure is the same shape: a
plausible, well-formed, confidently wrong country in a blocklist. Recorded as
**C-25**.

### 3 · Set comparison with `SANCTIONED_OR_RESTRICTED`

The ten codes in `src/uc03/policyEngine.js`, imported into `src/uc04/riskMatrix.js`
as `RESTRICTED_JURISDICTIONS`, are `CU IR KP SY RU BY MM VE AF IQ`. Against the
UN's own regime set:

- **In the UN set and not in the ten:** CD (DR Congo), SD (Sudan), LY (Libya),
  Guinea-Bissau, YE (Yemen), SS (South Sudan), HT (Haiti), SO (Somalia),
  CF (Central African Republic).
- **In the ten and not a UN country regime:** CU, SY, RU, BY, MM, VE — and
  **AF**, whose sanctions committee (1988) the UN classifies as a **non-State
  entity** regime, not an Afghanistan regime.
- **In both:** IR, KP, IQ.

Three of ten. The ten-code set is now confirmed to be neither a superset nor a
subset of any of the **four** registers this corpus has read — OFAC, the EU,
Canada's autonomous list, and the UN. `src/uc03/policyEngine.js`'s own header
already calls the list *"illustrative … NOT Remote's authoritative compliance
list."* That statement is now supported by four authorities rather than asserted.

## The access method, which is the deliverable

Anything built on this should fetch, on a schedule, from:

```
https://scsanctions.un.org/resources/xml/en/consolidated.xml
```

and fail closed if the fetch fails or the payload's own version stamp has not
advanced as expected. The page names `sc-sanctionslists@un.org` as the contact
for questions about any UN sanctions list. **The list's bytes belong in that
pipeline's cache, not in this directory.**
