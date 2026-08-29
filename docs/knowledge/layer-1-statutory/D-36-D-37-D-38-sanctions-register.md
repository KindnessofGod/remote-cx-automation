# D-36 / D-37 / D-38 · Three sanctions regimes, one register, and no vendored list

| | |
|---|---|
| **Catalogue id** | D-36 (US/OFAC), D-37 (EU), D-38 (Canada) — `docs/knowledge/DOWNLOAD-MANIFEST.md` §9 · L1-12 (`docs/KNOWLEDGE-SOURCES.md` §4) |
| **Source name** | (D-36) *Sanctions Programs and Country Information*, and the FAQ *Where is OFAC's Country List?* · (D-37) *EU Sanctions Map* regime register · (D-38) *Consolidated Canadian Autonomous Sanctions List* |
| **Publisher / authority** | (D-36) **U.S. Department of the Treasury, Office of Foreign Assets Control** · (D-37) **Council of the European Union / European Commission**, via the EU Sanctions Map · (D-38) **Global Affairs Canada** |
| **Exact URL** | <https://ofac.treasury.gov/sanctions-programs-and-country-information> · <https://ofac.treasury.gov/faqs/topic/1546> · <https://www.sanctionsmap.eu/> and its public regime endpoint <https://www.sanctionsmap.eu/api/v1/regime> · <https://www.international.gc.ca/world-monde/international_relations-relations_internationales/sanctions/consolidated-consolide.aspx?lang=eng> |
| **Retrieved** | **2026-08-19**, by `curl`. HTTP 200 for all. The Sanctions Map's HTML root is a 978-byte JavaScript shell (*"EU Sanctions Map / Please wait"*); its **public JSON API** at `/api/v1/regime` returned 399,898 bytes of regime records and is what was read. |
| **SHA-256 of the retrieved bytes** | **Not recorded, and deliberately so.** A checksum's only use is verifying a stored copy, and no copy is stored — see below. |
| **Source `updatedAt`** | GAC's consolidated list prints **"Date modified: 2026-08-19"** — the day of retrieval, i.e. it moves daily. OFAC's index and the Sanctions Map print no version. |
| **Licence / basis for inclusion** | All three licences are clean — US federal is public domain, EU material is reusable, GAC is Crown copyright under canada.ca terms. **Bytes are still not committed.** The licence is not the constraint here; see the rule below. |
| **Evidence tag** | `[CONFIRMED — regime register, retrieved 2026-08-19]` |

## The rule, restated because the licences make breaking it tempting

`docs/KNOWLEDGE-SOURCES.md` §11 names *"silently falling back to a cached
sanctions list"* as one of the seven things it would be dishonest to ship, and
*"the one most likely to acquire a helpful fallback by accident."* A checked-in
copy in `docs/` **is** such a fallback: it sits in the repository looking
authoritative and goes stale on a schedule nobody controls. GAC's own page
proves the cadence — it stamped today's date on the day it was read.

**The right shape is a scheduled fetch with a fail-closed gate.** This file is
the citation register. It is not the control and must never become one.

## What each authority actually publishes

**D-36 — OFAC.** The programme index enumerates country-related programmes
including Afghanistan, Balkans, Belarus, Burma, Central African Republic, China
(military companies), Cuba, DRC, Ethiopia, Hong Kong, Iran, Iraq, Lebanon,
Libya, Mali, Nicaragua, North Korea, Russia (two separate programmes), Somalia,
South Sudan, Sudan and Darfur, Syria, Ukraine/Russia, Venezuela and Yemen —
alongside thematic programmes (counter-terrorism, counter-narcotics,
cyber-related, Global Magnitsky, non-proliferation) that are not country-shaped
at all.

And OFAC's own answer to the question this repository's ten-code list implicitly
claims to have answered, quoted verbatim:

> **The Office of Foreign Assets Control (OFAC) does not maintain a specific
> list of countries that U.S. persons cannot do business with.**
>
> Here's why: U.S. sanctions programs vary in scope. Some are broad-based and
> oriented geographically (e.g., Cuba, Iran). Others are "targeted" (e.g.,
> counter terrorism, counter narcotics) and focus on specific individuals and
> entities. …
>
> OFAC's Specially Designated Nationals and Blocked Persons List ("SDN List")
> has over 19,000 names connected with sanctions targets. … **Many individuals
> and entities often move internationally and end up in locations where they
> would be least expected. Accordingly, U.S. persons are prohibited from dealing
> with SDNs regardless of location** …

`src/uc03/policyEngine.js`'s header already says the ten-code
`SANCTIONED_OR_RESTRICTED` set is an *"illustrative demonstration subset — NOT
Remote's authoritative compliance list."* That honesty was an assertion. It is
now a **quotation from the authority the list is standing in for.**

**D-37 — the European Union.** The Sanctions Map's regime register returned
**55 restrictive-measure regimes**, of which **35 carry a country attachment**
and the rest are thematic (chemical weapons, cyber, human rights, terrorism).

Of this repository's ten codes, **nine appear** as EU country-attached regimes
and **one — `CU`, Cuba — does not.** The EU's Cuba-related entry in the register
runs the *other* way: the regime attached to `US` is *"Measures protecting
against the effects of the extra-territorial application of certain legislation
adopted by the US"* — the Blocking Statute.

**That last fact is the whole argument in one line.** A naive flattening of the
EU regime register into a destination blocklist would **block the United
States** — because a regime "concerning" a country can be a measure protecting
against that country's measures. The register is not a blocklist and cannot be
turned into one by projection. Two further entries make the same point more
quietly: `ME` (Montenegro) and `RS` (Serbia) appear attached to a legacy regime
*"prohibiting the satisfying of certain claims in relation to transactions that
have been prohibited by the UN Security Council Resolution"* — nothing a
traveller is affected by.

**The 35 codes are not reproduced here.** Reproducing them is exactly the cached
fallback the rule forbids, and this pass has just demonstrated that a projection
of them is wrong anyway.

**D-38 — Canada.** The consolidated list's own framing, quoted:

> The Consolidated Canadian Autonomous Sanctions List includes individuals and
> entities subject to specific sanctions regulations made under the **Special
> Economic Measures Act (SEMA)** and the **Justice for Victims of Corrupt
> Foreign Officials Act (JVCFOA)**.
>
> The inclusion of these names on this list is for administrative purposes only.
> **The consolidated list is not a regulation, and it does not have force of
> law.**

Its own regulation filter enumerates: Belarus, China, Extremist Settler
Violence, Guatemala, Haiti, Hamas Terrorist Attacks, Iran, JVCFOA, Moldova,
Myanmar (Burma), Nicaragua, Russia, South Sudan, Sudan, Sri Lanka, Syria,
Ukraine, Venezuela, Zimbabwe.

Note what is **absent** from Canada's autonomous list and present in this
repository's ten: **Cuba, North Korea, Afghanistan and Iraq.** (Canada's DPRK
measures sit under the *United Nations Act* rather than SEMA — a different
statute, which is itself the point.) And note what Canada has that the ten do
not: China, Guatemala, Haiti, Moldova, Nicaragua, Sri Lanka, Sudan, South Sudan,
Zimbabwe.

## The finding

Ten alpha-2 codes drive a hard `blocked` in `src/uc03/policyEngine.js` and, via
`RESTRICTED_JURISDICTIONS`, a first-position block in `src/uc04/riskMatrix.js`,
for employers governed by **three different legal regimes**, with no field
recording which regime any code came from. Having now read all three registers:
the ten-code set is **neither a superset nor a subset of any one of them**, and
the direction of the error differs by regime.

Written up as [`CONTRADICTIONS.md`](CONTRADICTIONS.md) **C-16**, together with
the structural point that OFAC states in its own words: real sanctions are
entity- and person-level, and a country screen is a first pass, not a control.

> **D-39 — the UN Security Council Consolidated List — was not retrieved.**
> `https://www.un.org/securitycouncil/content/un-sc-consolidated-list` redirects
> to `main.un.org`, which this container's egress policy refuses at the proxy
> `CONNECT` (`403`). `www.un.org` itself is reachable; the redirect target is
> not. See [`RETRIEVAL-BLOCKED.md`](RETRIEVAL-BLOCKED.md).
