# D-14 · United States — Visa Waiver Program and ESTA · **RETRIEVED BY HAND 2026-08-19**

| | |
|---|---|
| **Catalogue id** | D-14 (`docs/knowledge/DOWNLOAD-MANIFEST.md`) — *"the single US document with the most direct effect on a demo decision"* |
| **Source name** | *Visa Waiver Program* (Department of State) · *Frequently Asked Questions about the Visa Waiver Program (VWP) and the Electronic System for Travel Authorization (ESTA)* (CBP) |
| **Publisher / authority** | **U.S. Department of State**, Bureau of Consular Affairs · **U.S. Customs and Border Protection**, Department of Homeland Security |
| **Exact URL** | <https://travel.state.gov/content/travel/en/us-visas/tourism-visit/visa-waiver-program.html> · <https://www.cbp.gov/travel/international-visitors/visa-waiver-program> (and the linked ESTA FAQ, <https://www.cbp.gov/travel/international-visitors/esta/frequently-asked-questions-about-visa-waiver-program-vwp-and-electronic-system-travel>) |
| **Retrieved** | **2026-08-19 — manually, by the repository owner, in a browser.** `www.cbp.gov` returns an Akamai `403` to this container for the documented path, for `/`, **and for `/robots.txt`**; `travel.state.gov` returns a Cloudflare *"Attention Required"* interstitial requiring JavaScript. Both refuse the **address**, not the request, and the full browser header set does not help. |
| **Bytes as committed** | [`sources/D-14-us-state-visa-waiver-program.txt`](sources/D-14-us-state-visa-waiver-program.txt) — **12,720 bytes** · [`sources/D-14-us-cbp-esta-faq.txt`](sources/D-14-us-cbp-esta-faq.txt) — **16,297 bytes** |
| **SHA-256 of the committed bytes** | `44558bea66f0662b988d574cd409299660d0b26d3e3b0166a26db2116fb75a56` (State) · `97bb7f1e1ffe618dea2b20860b8af859e0875d6e3f204bc6c64717ccc832b464` (CBP) |
| **Source `updatedAt`** | **Not captured** — neither transcription carries a page date, and neither page can be re-read from here to check. Left visible rather than filled in. |
| **Licence / basis for inclusion** | Class **(a)** — works of the U.S. federal government, public domain. Committed in full. |
| **Evidence tag** | `[CONFIRMED — agency publication, transcribed from a browser 2026-08-19]` |

> **Same provenance caveat as D-15.** These are human transcriptions of rendered
> pages, navigation chrome included — one degree weaker than a direct fetch, and
> categorically different from a mirror, because every link in the chain
> (*authority → the repository owner's browser → this file*) is named.

## K-3 · The `esta_usa` block is **confirmed as to work, and over-broad as to business**

`src/uc04/riskMatrix.js` line 411 blocks on `esta_usa` **or** `tourist_visa` with
`visitor_visa_active_work_forbidden`, and the file's own comment calls this
*"the matrix's most-cited 'blocked' rule."* The constant's inline description
reads *"US ESTA / visa-waiver (**tourist, NOT work**)"*.

The confirmation first, because it is the larger half and a confirmation is worth
as much as a contradiction here. Nothing on either page permits productive local
employment on ESTA. CBP is explicit that the authorisation is not a visa and not
an admission:

> **An approved ESTA is not a visa.** It does not meet the legal or regulatory
> requirements to serve in lieu of a U.S. visa when a visa is required under U.S.
> law.

> Authorization via ESTA **does not determine whether a traveler is admissible**
> to the United States. U.S. Customs and Border Protection officers determine
> admissibility upon travelers' arrival.

And the 90-day ceiling the matrix is silent about is stated by both:

> The VWP enables … travel to the United States for tourism or business for stays
> of **90 days or less** without obtaining a visa. *(State and CBP, verbatim in
> both.)*

> if you intend to stay longer than 90 days, then you need to apply for a visa.

Now the half the comment gets wrong. The State Department's first listed
requirement for using the VWP is:

> **Travel Purpose Must be Permitted on a Visitor (B) Visa**

The **B** visa class includes **B-1**, and USCIS (**D-15**) says B-1 covers
consulting with business associates, negotiating a contract, attending a
conference and short-term training, *"including, but not limited to"*. So
**"tourist, NOT work"** describes a narrower permission than the authority
grants: ESTA carries whatever a visitor (B) visa carries, **business included**,
capped at 90 days and excluding local employment.

The rule blocks the right thing for the wrong reason, which matters because the
reason is what gets printed to a customer. Recorded as **C-26**.

## C-27 · VWP eligibility is a nationality-and-history question the codebase cannot represent

Three requirements from the State page, none of which has an input anywhere in
`src/uc04/`:

1. **Designated-country nationality.** *"You must be a citizen or national of the
   following countries"* — a named list, which the page footnotes:
   > **To be eligible to travel under the VWP, British citizens must have the
   > unrestricted right of permanent abode in England, Scotland, Wales, Northern
   > Ireland, the Channel Islands, and the Isle of Man.**

   So even at country granularity, `GB` is not a sufficient answer for the United
   Kingdom: eligibility turns on a **status held under that nationality**.
   `classifyRisk()` takes a single `nationality` string.

2. **Travel history disqualifies.** Under the *Visa Waiver Program Improvement
   and Terrorist Travel Prevention Act of 2015*, VWP eligibility is lost by
   nationals of VWP countries who have *"traveled to or been present in
   Democratic People's Republic of Korea, Iran, Iraq, Libya, Somalia, Sudan,
   Syria, or Yemen on or after March 1, 2011"*, or in **Cuba** on or after
   12 January 2021.

3. **Dual nationality disqualifies** — *"Nationals of VWP countries who are also
   nationals of Cuba, Democratic People's Republic of Korea, Iran, Iraq, Sudan,
   or Syria."*

`args.travelHistory` exists and is summed into `computeCumulativeDays()` for the
Schengen count only. **It is never consulted for anything else**, and (2) is a
rule about travel to *other* countries changing whether entry to *this* one is
permitted — a shape the risk matrix has no room for at all.

**And note what this does to the sanctions list, one more time.** The country set
in (2) — `KP IR IQ LY SO SD SY YE`, plus `CU` — is a **fifth** differently-shaped
country list in this corpus, and it is not a blocklist of destinations: it is a
list of places whose *past visitation* disqualifies a traveller from a
*visa-waiver programme run by a country that is not on it*. Flattening it into
`RESTRICTED_JURISDICTIONS` would be wrong in a new way. See **C-16** and
**C-25** for the previous four.

## One more thing the pages settle, which nothing in the repo tracks

> If you are admitted to the United States under the VWP, you may take a short
> trip to Canada, Mexico, or a nearby island and generally be readmitted … **for
> the remainder of the original 90 days** granted upon your initial arrival …
> Therefore, the length of time of your total stay, **including the short trip**,
> must be 90 days or less.

A US–Canada–US itinerary does not reset the US clock. The Schengen branch of the
matrix computes a cumulative window; the US branch computes nothing at all,
because the US path terminates at `us_requires_work_permit` before any duration
is examined.
