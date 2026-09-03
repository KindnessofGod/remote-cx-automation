# What the real documents say that this repository does not

> **This is the output of the 2026-08-19 Layer-1 retrieval passes that matters
> most.** Every item below is a place where a statutory or agency document that
> is now in this corpus **confirms, refines, or contradicts** a number, a set or
> a shape that `src/` currently carries on an assertion.
>
> **Updated 2026-08-19 (third pass): 16 items → 27, and 2 confirmations → 4.**
> The third pass opened six more hosts and added the three US immigration pages
> the repository owner transcribed by hand. C-1 through C-16 are unchanged except
> **C-8, C-9 and C-12**, each of which had to be rewritten because a document
> retrieved later contradicted or completed a document retrieved earlier — see
> **C-24** in particular, where a treaty text contradicts the administering
> agency's own published table.
>
> **No file under `src/`, `test/`, `workflows/`, `zaf-app/` or `scripts/` was
> changed by the pass that produced this list, and none should be changed on the
> strength of this file alone.** Changing a gate is a separate, reviewed unit of
> work with its own tests. `src/uc08/jurisdictionKnowledge.js` deliberately
> asserts that `183`, `365` and `180` appear nowhere in its register; that test
> must keep passing.
>
> **Updated 2026-09-02 (the employee-notice pass): 30 contradictions → 35, and
> 4 confirmations → 6.** This pass had one question — *what does the statute
> require of a **resigning employee**?* — and asked it of the five countries in
> `NOTICE_PERIOD_TABLE` whose statute this repository had never retrieved. New
> documents: **D-41** (UK), **D-42** (Ireland), **D-43** (Poland), **D-44**
> (Québec), **D-45** (Germany, agency-only), plus **D-05** (Ontario), which had
> been listed as unretrievable since 2026-08-19 and was not. Portugal's D-02 and
> D-03 were re-fetched and both re-hashed **byte-identical**; their postscripts
> record it.
>
> **The finding the pass exists for: the employer/employee inversion that C-14
> and C-20 each caught once is a pattern, and in the United Kingdom it has been
> computing wrong numbers all along (C-31).** A British employee with 43 months'
> service is told they owe 21 days against a statutory 7. Ireland made the
> identical citation error and got away with it because the wrong section happens
> to produce the right number (**C-32**) — which is the more frightening of the
> two, because nothing downstream can see it.
>
> **Germany is the one country this pass could not source from its own statute
> book**, and the reason is in [`RETRIEVAL-BLOCKED.md`](RETRIEVAL-BLOCKED.md).
> **K-6** is therefore agency-strength and says so; do not upgrade its tag.

> **Read the `C-` items as work orders and the `K-` items as reassurance.** A
> list that only ever reports faults teaches its reader to distrust everything
> equally, which is its own failure. Two things checked out exactly.

---

## Confirmations

### K-1 · The 29-code `SCHENGEN` set is right, and now dated

`SCHENGEN` in `src/uc04/riskMatrix.js` holds 29 codes and has never had a source
or an "as of when". Council Decision (EU) **2024/210**, Article 1 (D-08)
enumerates the states the acquis applies between as Bulgaria and Romania plus 23
named EU Member States plus Iceland, Liechtenstein, Norway and Switzerland — **25
+ 4 = 29**, with Cyprus and Ireland correctly absent. The set matches the
Council's own enumeration.

It now has the two dates it lacked: **air and sea borders from 2024-03-31**
(Decision 2024/210), **land borders from 2025-01-01** (Decision **2024/3212**).
`BG`, `HR` and `RO` are correct members.

### K-2 · The `90` and the `180` are the right numbers

Regulation (EU) 2016/399, Article 6(1) (D-07): *"no more than 90 days in any
180-day period."* `SCHENGEN_LIMIT_DAYS = 90` and `SCHENGEN_WINDOW_DAYS = 180` in
`src/uc04/decisionFacts.js` are correct as numbers, and the code comment
*"statutory, not invented"* is true. **How they are applied is C-1.**

### K-3 · The ESTA / visitor block is right about *work*, and the constant's comment is wrong about *business* · D-14, D-15 · UC-04

`src/uc04/riskMatrix.js`'s most-cited `blocked` rule now has the source its own
comment stood in for. Nothing on the CBP or State pages permits productive local
employment on ESTA, and CBP states the authorisation's limits itself: *"An
approved ESTA is not a visa"*, and *"Authorization via ESTA does not determine
whether a traveler is admissible."* The 90-day ceiling the matrix never mentions
is stated by both agencies. **The rule blocks something the authority really does
not permit** — which is worth saying plainly, because the rest of this file is
faults and the balance matters.

What is wrong is the *reason*, which is what gets printed to a customer: see
**C-26**.

### K-4 · Canada–Portugal's 24-month detachment maximum is confirmed by the agreement itself · D-23 · UC-04

The CRA's table said 24 months; art. VII(1) of the agreement says *"for a period
of up to 24 months"*. Two independent sources, same answer. Recording it because
its Netherlands neighbour did **not** check out (**C-24**), and a reader needs to
know that the pair was checked rather than assumed to fail together.

### K-5 · Poland's notice brackets model the right party, and their boundaries are exact · D-43 · UC-05

`NOTICE_PERIOD_TABLE.PL` splits at `<6 months`, `6–35 months`, `36+ months`.
Kodeks pracy **art. 36 § 1** splits at *"krócej niż 6 miesięcy"*, *"co najmniej
6 miesięcy"* and *"co najmniej 3 lata"* — the same three boundaries, and no
off-by-one of the **C-18** or **C-32** kind at either edge.

More importantly, **art. 36 § 1 is not addressed to a party at all**, and **art.
32 § 1** makes that explicit: *"**Każda ze stron** może rozwiązać umowę o pracę
za wypowiedzeniem"* — either party may terminate by notice. So Poland's periods
genuinely are the employee's as well as the employer's, and the row is not
carrying somebody else's obligation.

This is recorded because it is the counter-example that makes **C-31** a finding
rather than a mood. Four of the nine rows in this table were checked against
their statute in the 2026-09-02 pass; one modelled the wrong party outright, one
cited the wrong section, one had no source for the party question at all — and
Poland was simply correct. *(What Poland gets wrong is the unit and the anchor:
**C-33**, and the missing probation article: **C-34**.)*

### K-6 · Germany encodes the basic period and stops there — the one row that resisted the trap · D-45 · UC-05

`NOTICE_PERIOD_TABLE.DE` holds a **single flat bracket of 28 days** and a
two-week probation rule. BGB § 622 also contains a tenure-graduated ladder of
one to seven months, and **the German row does not encode it.**

Per the Bundesministerium für Arbeit und Soziales's own *Arbeitsrecht* (Stand
Januar 2025, D-45): the **Grundkündigungsfrist** of *"vier Wochen (28
Kalendertage)"* is what *"**Arbeitgeber sowie Arbeitnehmerinnen und
Arbeitnehmer**"* must observe, while the **verlängerte Kündigungsfristen** of
1–7 months are what *"**der Arbeitgeber**"* must observe. The 28, the 14-day
probation figure and the six-month probation ceiling are all corroborated.

Two qualifications, and both matter:

- **This is agency evidence, not statutory evidence.** `gesetze-im-internet.de`
  is unreachable from this container and BGB § 622's own text has not been read
  by this repository. The tag on D-45 is `[AGENCY]`, not `[CONFIRMED — statute]`,
  and this K-item inherits that. See [`RETRIEVAL-BLOCKED.md`](RETRIEVAL-BLOCKED.md).
- **`anchorRule: "month_15"` names half of a disjunction.** The ministry's text is
  *"zum 15. des Monats **oder** zum Ende eines Kalendermonats"*. Whether the
  calculator offers both permissible dates is a code question this pass did not
  open, and it is the one place the German row could be silently wrong by up to
  about two weeks.


---

## Contradictions and refinements

### C-1 · The 180-day window is per-day-of-stay, not per-trip · D-07 · UC-04

`src/uc04/riskMatrix.js:452` computes **one** trailing 180-day window anchored on
the trip start:

```js
const winStart = new Date(startMs - 180 * 24 * 60 * 60 * 1000)…
if (cum.days + tripDays > 90) { reasons.push("schengen_90_180_exceeded"); }
```

with the comment *"that's how Schengen authorities actually evaluate the rule."*
Article 6(1) says otherwise, in the same sentence as the numbers:

> no more than 90 days in any 180-day period, **which entails considering the
> 180-day period preceding each day of stay**

The rule is evaluated **for every day of the stay**, each against its own
trailing 180 days. A single window anchored at the start is a different
computation. It is not conservative in a fixed direction: for a long trip whose
later days push earlier days out of the window it can refuse a compliant stay;
for a trip that begins just after a large block of days ages out it can clear a
non-compliant one. The difference is largest for exactly the multi-week
workations UC-04 exists for.

### C-2 · Both endpoint days count, and permit days do not · D-07 · UC-04, UC-08

Article 6(2):

> the **date of entry** shall be considered as the **first day of stay** … and
> the **date of exit** … as the **last day of stay** … **Periods of stay
> authorised under a residence permit or a long-stay visa shall not be taken
> into account** in the calculation.

Two consequences. First, `computeCumulativeDays()` and `tripDays` need an
inclusive-both-ends convention; an off-by-one here is invisible and systematic.
Second — and this is the interesting half — **stay under a residence permit or
long-stay visa is excluded from the 90/180 count by the regulation itself.**
That is a principled basis for a Portugal-style carve-out that
`DNV_COUNTRIES` currently implements as an undocumented blanket skip: the
exclusion is real, but it attaches to *the traveller holding the permit*, not to
*the destination running a scheme*. See C-15.

### C-3 · The count is per-Member-State outside the EES · D-07 · UC-04

Article 6(1a): the 90 days are calculated *"as a single period for the Member
States operating the EES"* and *"separately for each of the Member States which
do not operate the EES."* `computeCumulativeDays()` is called with a single
`country` (the destination), so it already counts per-country — which is the
**non-EES** behaviour. Whichever is intended, the code does not say, and the
distinction is now dated and live rather than theoretical.

### C-4 · Visa-free is not work-free, and the regulation says so · D-09 · UC-04

`docs/KNOWLEDGE-SOURCES.md` L1-06 records the visa annexes as absent from the
repository, so the 90/180 gate takes the requester's **self-declared
`visaType`** as its evidence of entitlement. Now that Annexes I and II are in the
corpus, Canada and the United States are confirmed **Annex II** (visa-exempt for
≤ 90/180 in NL and PT) — which sounds like it validates the demo, and the very
next article withdraws the comfort:

> **Article 6(3).** A Member State may provide for **exceptions from the
> exemption** from the visa requirement … as regards **persons carrying out a
> paid activity during their stay**.

A workation is a person carrying out a paid activity during their stay. So Annex
II membership is necessary and **not sufficient**, and whether it holds for this
traveller is a **per-Member-State** question that no EU-level table answers. A
lookup built from Annex II alone would be more confident and no more correct
than the self-declared field it replaced.

### C-5 · Canada's work-permit block has a statutory test it never applies · D-16 · UC-04

`src/uc04/riskMatrix.js` blocks outright:

```js
if (destinationCountry === "CA" && visaType !== VISA_TYPES.work_permit)
  reasons.push("ca_requires_work_permit");
```

IRPR **s. 186** lists some two dozen categories of foreign national who **may
work in Canada without a work permit**, the first being a business visitor under
**s. 187**, whose test is:

> … **only if** (a) the primary source of remuneration for the business
> activities is **outside Canada**; and (b) the principal place of business and
> actual place of accrual of profits remain **predominately outside Canada**.

Both limbs are typically satisfied by a remote worker paid by a foreign
employer — which is not the same as saying such a trip qualifies, because
s. 187(1) also requires the person not to be "directly entering the Canadian
labour market", and that is a judgement. **The point is that the code asks
neither question.** A block that is wrong is invisible precisely because it
looks cautious.

### C-6 · The EU posting rule has a 24-month limit the code has no field for · D-17 · UC-04

Article 12(1) of Regulation 883/2004: home-state legislation continues *"provided
that the anticipated duration of such work **does not exceed 24 months** and that
he/she **is not sent to replace another posted person**."*

`a1_certificate_recommended` fires without reference to either condition. A
27-month assignment gets the same flag as a 3-week one, and the replacement
condition has no representation at all.

### C-7 · One flag stands in for two different articles · D-17, D-18 · UC-04, UC-08

Article 12 (posting) and Article 13 (activity in two or more Member States) lead
to **different competent states** by **different tests**. The code raises one
recommendation. Article 13's test — "substantial part" — is defined in
Regulation 987/2009 Article 14(8) as a *quantitatively substantial part …
without this necessarily being the major part*, with **25 %** named only as *"an
indicator"* in the framework of an overall assessment.

`docs/KNOWLEDGE-SOURCES.md` L1-04 already sorts this **SPLIT**: membership is a
TABLE, which article governs is CORPUS. The retrieved text is the evidence for
that call. **Do not encode 25 % as a threshold** — the regulation is explicit
that it is an indicator inside an overall assessment, and a gate that treats it
as a cut-off would be wrong in the confident direction.

### C-8 · Detached-worker limits differ by network, and by pair · D-20, D-21 · UC-04

Three different maxima are now in the corpus for the same concept:

| Network | Instrument | Maximum |
|---|---|---|
| EU | Reg. 883/2004 art. 12(1) | **24 months** |
| United States | SSA, all agreements except Italy | **5 years** |
| Canada → Netherlands | **Agreement of 2001-06-27, in force 2004-04-01** (CTS 2004/6), art. VI(2) | **60 months** |
| Canada → Netherlands | *superseded* agreement of 1987, in force 1990-10-01 (CTS 1990/14), art. VI(2) | 24 months |
| Canada → Portugal | Agreement of 1980-12-15, in force 1981-05-01 (CTS 1981/15), art. VII(1) | **24 months**, extendable only with **both** competent authorities' prior consent (art. VII(3)) |

The SSA states the contrast itself: *"The 5-year limit … is substantially longer
than the limit normally provided in the agreements of other countries."* There is
no single number, and the Canadian rows show the maximum varies **per pair
within one network**.

### C-9 · Four silent pairs now have answers, and they are not one boolean · D-20, D-21 · UC-04, UC-07, UC-08

`NL_CA`, `PT_CA`, `NL_US` and `PT_US` appear in neither `EU_EEA_FOR_A1` nor
`NON_TREATY_PAIRS`, so neither branch fires and the trip produces **no
social-security finding at all** — indistinguishable, to a specialist, from a
clearance.

All four are covered, by named agreements:

| Pair | Authority | Effective | Certificate |
|---|---|---|---|
| US–NL | SSA | 1990-11-01 (TIAS 03-501) | US CoC |
| US–PT | SSA | 1989-08-01 (TIAS 12121) | US CoC |
| US–CA | SSA / CRA | 1984-08-01 (TIAS 10863) | CPT56 |
| CA–NL | CRA | 1990-10-01 | **CPT63**, 60 months |
| CA–PT | CRA | 1981-05-01 | **CPT55**, 24 months |

Note US–PT (1989) and CA–PT (1981) are different agreements with different
dates. **"Portugal has a totalization agreement" is not a fact about Portugal.**

> **Third pass, 2026-08-19:** the CA–NL row above previously read *1990-10-01,
> 60 months*, taken from the CRA's table. Reading the agreements themselves
> showed those two figures come from **two different treaties**. See **C-24**.
Any table built from this needs `(pair, authority, effective date, certificate
form, max detachment)` — five columns, not a boolean.

> **ACTED ON, 2026-08-31 — this finding is now discharged for UC-04, and the
> way it was discharged is the part worth keeping.** The table the closing line
> above asks for did not have to be built: it already existed twice, one use
> case over each. `SOCIAL_SECURITY_COVERAGE` (`src/uc08/decisionSources.js`)
> holds all six pairs with a network, a certificate and a maximum initial
> detachment; `TAX_CONVENTION_BY_PAIR` (`src/uc07/decisionSources.js`) holds the
> bilateral tax convention for the same six. UC-04's treaty dimension now reads
> both — imported, not copied, for the reason `src/uc04/policyEngine.js` imports
> UC-03's `SANCTIONED_OR_RESTRICTED` — and reports `cleared` with those columns
> for a pair both answer for, `unknown` unchanged for a pair either one misses.
> So all four "silent pairs" now produce a social-security finding, and it is
> not a boolean: it is the five columns this entry demanded.
>
> **What this does NOT discharge, and the distinction is the whole of C-8 and
> C-24.** Reporting a maximum detachment is not agreeing on one. Both of those
> caveats still render under the covered finding, because both are about the
> column it now prints — there is still no single detachment maximum, and the
> CRA's Canada–Netherlands row still pairs one agreement's date with another
> agreement's limit. A caveat retires when the claim it disputes stops being
> made, never when the finding it sits under turns green. **K-4** renders beside
> them for the same reason in the opposite direction: Canada–Portugal was
> checked against the agreement text and held, and a page that prints only the
> failure teaches a reader that nothing on it was verified.
>
> The state was left frozen twice before this, both times deliberately and both
> times recorded (`decisionFacts.js`, §3.100 and 2026-08-31), because flipping
> it changes what a specialist is told and that is an owner's call rather than
> a maintenance one. It was made on 2026-08-31.

### C-10 · **Six** treaties, six different 183-day windows, none of them the code's · D-24, D-25, D-26, D-27, D-28, D-29 · UC-04, UC-08

> **Updated 2026-08-19 (third pass).** **D-26**, the Canada–Portugal convention,
> was the sixth and last pair and was unreachable until `treaty-accord.gc.ca`
> opened. All six demo pairs are now in the corpus.

`src/uc04/decisionFacts.js` renders **one** watch line: 183 days over a trailing
365 from the trip start. The five bilateral treaties now in the corpus each
define their own:

| Instrument | Article | Window |
|---|---|---|
| US–Netherlands | 16(2)(a) | 183 days **in the taxable year concerned** |
| US–Portugal | 16(2)(a) | 183 days in **any 12-month period commencing or ending in the taxable year** |
| US–Canada | XV(2)(b) | 183 days **in that calendar year** — *or* remuneration ≤ **$10,000** |
| Canada–Netherlands | 15(2)(a) | 183 days in any 12-month period commencing or ending in the **calendar** year |
| Netherlands–Portugal | 15(2)(a) | 183 days in any 12-month period commencing or ending in the **fiscal** year |
| **Canada–Portugal** | **15(2)(a)** | **183 days in any 12-month period commencing or ending in the *calendar* year** |

Six formulations, differing on the unit (taxable year / calendar year / fiscal
year) and on whether the 12-month period floats at all. **A trailing 365 days
from a trip start is none of them.** And
the US–Canada convention has an entirely separate money-based limb — a
$10,000 de minimis that is an *alternative* to the day count, not a rider on it.

### C-11 · The treaty 183-day test is one of three cumulative conditions · D-24, D-25, D-26, D-27, D-28, D-29 · UC-08

Every one of the six articles above reads *(a) … **and** (b) … **and** (c)*:

- (a) presence below the day threshold, **and**
- (b) remuneration paid by or on behalf of an employer **not resident** in the
  other State, **and**
- (c) remuneration **not borne by a permanent establishment** of the employer in
  the other State.

**For an Employer-of-Record arrangement, limbs (b) and (c) are the ones that
decide the case**, and they are the two the repository has no representation of.

> **CORRECTED 2026-09-01 — the sentence above is right for one destination and
> wrong for the other, and the difference is worth more than the finding.**
> Researched against the OECD Commentary on art. 15 and the German, Dutch,
> Danish and Swedish implementations (`docs/UC04-RESEARCH-FINDINGS.md` §12).
> The economic-employer apparatus is **textually conditioned on a recipient
> enterprise existing in the source state** — Commentary paras. 8, 8.7, 8.13 and
> 8.14, and every national rule names its own source-state recipient
> (`eine virksomhed her i landet`, `de opdrachtgever in het werkland`,
> `uppdragsgivare … verksamhet i Sverige`, BMF Rn. 151's *"ihr geleistete"*).
>
> So: where the destination **is** the client's own country, (b) and (c) do
> decide it, and several states then tax **from day one** with no day count to
> fall back on. Where the destination is a genuine **third** country — nobody
> there directs the work, receives its benefit or takes a recharge — **(b) and
> (c) hold structurally** (recharacterisation only ever swaps an employer
> resident in X for one resident in Y; neither is Z), and **(a) is the live
> treaty limb.**
>
> **C-11's core point survives untouched**: a day count answers one limb of a
> three-limb test, and a dossier rendering it as *the* answer is Test B's named
> failure. What changes is that "which limbs decide" must be **split by
> destination**, and that a system asserting (b) needs one further fact the
> employment record does not carry — whether the company has an entity in the
> destination.
>
> Two caveats that do NOT retire with this correction. Treaty exemption
> extinguishes liability, **never withholding or reporting** — Canada, Portugal
> and the US each impose a fail-closed documentary procedure that survives a
> perfect art. 15(2) exemption (§12b). And **US–Canada art. XV(2) is
> disjunctive**, not cumulative, so the three-limb framing above is the Model's
> and not that treaty's.
A dossier that reports "142 of 183 days — within the limit" has answered limb (a)
of a three-limb test and rendered it as the answer. That is a well-formed number
beside a citation, which is `docs/KNOWLEDGE-SOURCES.md` Test B's named failure.

### C-12 · One threshold, one window, **four** differently shaped residence tests · D-31, D-32, D-33, D-35 · UC-04, UC-08

> **Rewritten 2026-08-19 (third pass).** Portugal was the one cell this table
> could not fill; **D-32** filled it, from the Portuguese tax authority's own
> consolidated CIRS. All four demo countries are now known and no two agree.

`RESIDENCY_LIMIT_DAYS = 183` over `RESIDENCY_WINDOW_DAYS = 365`, applied to every
destination and rendered as *"183-day watch line — N of headroom."* Across the
four demo countries that single rule stands in for:

| Country | Domestic test | Shape |
|---|---|---|
| **Netherlands** (D-31) | AWR art. 4(1): *"Waar iemand woont … wordt naar de omstandigheden beoordeeld"* | **No day count exists at all.** There is no line, so there is no headroom. |
| **Portugal** (D-32) | CIRS art. 16(1)(a): *"mais de 183 dias, seguidos ou interpolados, em **qualquer período de 12 meses com início ou fim no ano em causa**"* — **or**, art. 16(1)(b), fewer days plus a dwelling *"em condições que façam supor intenção atual de a manter e ocupar como residência habitual"* | 183 — over a **12-month period anchored on the tax year**, *and* a second, **count-free** limb that can make a person resident **below** the threshold |
| **Canada** (D-33) | ITA s. 250(1)(a): *"sojourned in Canada in the year for a period of, or periods the total of which is, **183 days or more**"* | 183 — over a **taxation year**, and the consequence is deemed residence **throughout** that year, retroactive to 1 January |
| **United States** (D-35) | Substantial presence: **31 days** current year **and** 183 across **3 years**, counting current-year days in full, prior year at **1/3**, the year before at **1/6** | A **weighted three-year** computation, with named exclusions and a closer-connection exception |

Three of the four contain the number 183 and it means something different in each
one; the fourth contains no number at all. **Not one of them is a rolling 365
days counted back from a trip start.** Two of them back-date the consequence —
Canada to 1 January of the taxation year, Portugal (art. 16(3)) to **the first
day of the stay**, or to 1 January where the person was resident on any day of
the previous year — so in both, crossing the line rewrites the status of days
already lived, which "headroom remaining" cannot express.

**The fix this enables is not "add three more thresholds."** It is to apply to
the *threshold* the discipline `computePresenceDays()` already applies to the
*count*: it returns `NOT_EVALUATED` with `days: null` rather than a fabricated
zero, *"because a stated zero reads as 'well under the 183-day threshold', which
is a conclusion nobody computed."* A threshold that is right for one of four
countries is the same defect one layer up. `src/uc08/jurisdictionKnowledge.js`
asserts that `183`, `365` and `180` appear nowhere in its register; this entry is
the argument for keeping that test, not for deleting it.

### C-13 · The two strongest claims in the notice table are negatives, and only half of one is now sourced · D-04, D-06 · UC-05

`NOTICE_PERIOD_TABLE.CA` asserts, in a `sourceCitation` string, *"no statutory
employee minimum; varies by province."* A US row would need the same shape of
assertion and does not exist at all.

- **Canada, federal half — sourced.** Canada Labour Code s. 230 imposes notice
  entirely **on the employer**, on a 2-to-8-week tenure ladder. There is no
  employee-side counterpart in the section. This supports the negative **by
  scope**, for **federally regulated industries only**.
- **Canada, provincial half — still unsourced.** Ontario's ESA 2000 (D-05) could
  not be retrieved (e-Laws is JavaScript-only). *"Varies by province"* remains an
  assertion, and one province would not have proved a claim about ten anyway.
- **United States — sourced the same way, no further.** WARN requires 60 days'
  advance notice **from employers of 100+** on plant closings and mass layoffs
  affecting 50+. That delimits the federal field; it does not state the negative.
  State mini-WARN statutes and contractual notice are both untouched.

Both negatives are `[INFERRED — argument from scope]`, and the corpus files say
so in those words. **Nothing downstream can contradict either**, which is exactly
`docs/KNOWLEDGE-SOURCES.md` Test B.

Alongside them, the customary figures in the CA row (`0 / 7 / 14` days) remain
illustrative and unsourced — the file concedes this itself.

> **Decided 2026-08-21:** those figures are removed and CA takes the US shape.
> See C-30's decision note. **The two negatives themselves are unchanged and
> remain `[INFERRED — argument from scope]`** — that is the *correct* tag for
> both, not a weak one, and the UC-05 pass re-confirmed it rather than trying to
> upgrade it: a negative cannot be raised to `[CONFIRMED]` by retrieving one more
> document, which is what "argument from scope" means. What the pass changed is
> the **wording** of the US claim, narrowing it to *no federal statute imposes
> employee-side notice; state law was not surveyed; the contract governs*
> (`[N-8]`). Behaviour is unchanged in both countries' negatives.

### C-14 · The Netherlands notice row would model the wrong party · D-01 · UC-05

`NOTICE_PERIOD_TABLE` has **no NL row**, so `getNoticeRule("NL")` returns `null`
and every Dutch resignation escalates. Writing one from BW 7:672 has a trap the
retrieved text makes obvious and a summary would hide:

- The **tenure-banded** 1/2/3/4-month ladder in art. 672(**2**) is the
  **employer's** obligation.
- The **employee's** obligation, art. 672(**4**), is **one month, flat,
  regardless of tenure**.
- art. 672(**1**) anchors notice to **the end of the month** — which is what
  `anchorRule: "month_end"`, already present in the type union and used by
  nothing, was for.
- art. 672(**8**) makes the employee's month a **default, not a floor**: a
  written contract may extend it to at most six months, and if it does, the
  employer's must be at least double.

A row built from "the first numbers in the article" models the employer and
reports it as the employee's obligation.

### C-15 · Portugal's DNV exemption is two instruments with conditions, not a boolean · D-10, D-11 · UC-04

`DNV_COUNTRIES` contains `PT`, and membership **suppresses** the Schengen 90/180
check. `DNV_COUNTRIES_PROVENANCE` records `authority: null, version: null,
reviewedOn: null`, and the ZAF sidebar prints that on screen.

What the Portuguese consular authority actually publishes (D-11):

- **Two** remote-work instruments, not one: a **temporary stay visa** (*"less
  than a year"*) and a **residency visa** (*"two entries … valid for a period of
  4 months"*, then an AIMA residence permit).
- A condition on both: *"Proof of average monthly income for the last three
  months with a minimum value equivalent to **four monthly minimum guaranty
  remuneration**"*, plus a contract or employer declaration and proof of fiscal
  residence.
- Discretion retained: *"The consular post may request additional documents, at
  their discretion."*

So the suppression currently fires for an applicant who would not qualify, and
`authority` can now be filled (**MNE** for the visa, **AIMA** for the permit).
`version` still cannot: **none of the five ministry pages prints a date.**

**And the manifest's index guess was wrong in a way worth keeping.** D-13 was
scoped as "the Portaria fixing the **IAS**", on the sound reasoning that these
floors are usually expressed as a multiple of a statutory index. The ministry
expresses it as a multiple of the **RMMG** — the guaranteed monthly minimum wage
— not the IAS. The reasoning was right; the named index was wrong. That is what
fetching is for.

### C-16 · One country list, three regimes, and the register cannot be flattened · D-36, D-37, D-38 · UC-03, UC-04

`SANCTIONED_OR_RESTRICTED` is ten alpha-2 codes — `CU IR KP SY RU BY MM VE AF
IQ` — imported unchanged into `src/uc04/riskMatrix.js` as
`RESTRICTED_JURISDICTIONS`, driving a hard `blocked` for employers governed by
**EU** measures, **Canadian** SEMA/JVCFOA and **US** OFAC alike, with no field
recording which regime any code came from.

Having now read all three registers, the ten-code set is **neither a superset nor
a subset of any one of them**:

- **OFAC** runs country-related programmes well beyond the ten — Balkans, CAR,
  DRC, Ethiopia, Hong Kong, Lebanon, Libya, Mali, Nicaragua, Somalia, South
  Sudan, Sudan/Darfur, Ukraine/Russia, Yemen — plus thematic programmes that are
  not country-shaped at all.
- **Canada's** autonomous list has **no** Cuba, North Korea, Afghanistan or Iraq
  regulation, and **does** have China, Guatemala, Haiti, Moldova, Nicaragua, Sri
  Lanka, Sudan, South Sudan and Zimbabwe.
- **The EU** has no country regime for Cuba at all. What it has attached to
  Cuba's principal sanctioner is the **Blocking Statute** — a regime attached to
  `US`, *"protecting against the effects of the extra-territorial application of
  certain legislation adopted by the US."*

That last point is the load-bearing one. **A naive projection of the EU regime
register onto a destination blocklist blocks the United States**, because a
regime "concerning" a country can be a measure protecting *against* it. The
register is not a blocklist and does not become one by flattening.

And the structural limit, in the authority's own words (OFAC):

> **The Office of Foreign Assets Control (OFAC) does not maintain a specific list
> of countries that U.S. persons cannot do business with.** … Many individuals
> and entities often move internationally and end up in locations where they
> would be least expected. Accordingly, U.S. persons are prohibited from dealing
> with SDNs **regardless of location**.

`src/uc03/policyEngine.js`'s header already said the list is *"illustrative … NOT
Remote's authoritative compliance list."* That was an assertion; it is now a
quotation from the authority it stands in for. The right shape remains a
**scheduled fetch with a fail-closed gate**, not a file in this directory — which
is why D-36/37/38 are registers and no list bytes are committed.

---

## Third pass, 2026-08-19 — C-17 to C-27

### C-17 · Portugal's D8 has no threshold in the article that creates it · D-10, D-11 · UC-04

`DNV_COUNTRIES_PROVENANCE.needsForAVersionedTable` asks for *"the scheme's own
thresholds — income floor, insurance, maximum duration."* **Lei 23/2007
art. 61.º-B, now read in full, contains none of them.** It is one paragraph:
employees and independent professionals are granted a residence visa for remote
work for a person or entity domiciled outside Portugal, on demonstration of the
employment relationship or service provision. No money, no months, no insurance.

The conditions are real and they live in **three** other places: the general
residence-visa conditions of art. 52.º; a *portaria* on means of subsistence that
art. 52.º(1)(d) delegates to; and what the consular network actually demands
(D-11's *"four monthly minimum guaranty remuneration"*). So a `DNV_COUNTRIES`
row citing art. 61.º-B for an income figure would cite a provision that does not
contain one — the well-formed-number-beside-a-citation failure `KNOWLEDGE-SOURCES.md`
Test B names, in its most literal form.

**And the statute confirms there are two instruments, not one.** Art. 54.º(1)(i)
creates a **temporary-stay** visa for the same remote work, and art. 54.º(1)
caps it at *"período inferior a um ano"* — the only duration limit the statute
sets on either route. C-15 inferred the two-instrument structure from the
consular pages; it is now statutory.

### C-18 · The Portuguese notice bracket boundary is off by one, in the employee's disfavour · D-02 · UC-05

`NOTICE_PERIOD_TABLE.PT.brackets` splits at `tenureMaxMonths: 23` — 0–23 months
gets 30 days, 24+ gets 60. Art. 400.º(1) splits on *"até dois anos ou mais de
dois anos de antiguidade"*: **up to two years** inclusive versus more than two.

At **exactly 24 months** the statute gives 30 days and the table gives 60. One
month, one boundary, and it errs toward telling a resigning employee they owe
twice the notice they owe. It is also invisible: no fixture in this repository
tests a tenure of exactly two years, and the code and the fixture would agree if
one did.

Art. 400.º(1) also settles that the periods **are** 30 and 60 days, and leaves
`unit: "calendar"` unsettled — the article says *"dias"* and nothing more.

### C-19 · A statutory waiver the table cannot express, and should not try to · D-02 · UC-05

Art. 400.º(6), inserted by Lei n.º 13/2023: a worker recognised as a **victim of
domestic violence** *"fica dispensado do cumprimento do aviso prévio"*. Art.
401.º(2) exempts the same worker from the indemnity for not giving notice.

So for that worker UC-05's computed notice period and any derived deduction are
both wrong, and wrong in the direction of a demand on someone the legislature
went out of its way to protect.

**This is listed as a finding and explicitly not as a patch.** The trigger is a
status recognised under separate legislation; determining it is not a support
automation's job, and a system that tried would be doing something considerably
worse than escalating. The right shape is the one C-16 and C-7 already point at —
know that the case exists, and do not answer it. It belongs beside the 25 % in
**C-7** on the list of things that are *wrong to encode*.

### C-20 · Portugal's probation row models the wrong party, with a repealed number, in the wrong shape · D-03 · UC-05

`NOTICE_PERIOD_TABLE.PT.probation` reads
`{ tenureMinMonths: 0, tenureMaxMonths: 5, noticeDays: 15 }` and, via
`pickBracket()`, **replaces** the regular bracket. Código do Trabalho art. 114.º:

| ¶ | Rule |
|---|---|
| 1 | During probation, **either party may terminate with no notice**, no just cause, no indemnity |
| 2 | Probation lasted **> 60 days** → **the employer** must give **7 days** |
| 3 | Probation lasted **> 120 days** → **the employer** must give **30 days** (**15 days** in the 2009 enacting text; raised by Lei n.º 13/2023, in force 2023-05-01) |

Three independent defects in one field:

1. **Wrong party.** The employee owes **zero**. Every notice figure in the
   article is the employer's. This is **C-14**'s Dutch trap — art. 7:672's
   tenure ladder is the employer's, the employee's is a flat month — occurring a
   second time, in a second country, in a table built the same way. Once is a
   mistake; twice is the method.
2. **Repealed number.** 15 days was right until 2023-05-01 and has been wrong
   since. Nothing downstream could tell.
3. **Wrong shape.** The manifest asked whether the statute scales notice with
   elapsed probation and said that if it does, *"the table's shape is wrong, not
   just its number."* It does: 0 → 7 → 30 days at the 60- and 120-day marks.

And `tenureMaxMonths: 5` has no counterpart in the statute either. Art. 112.º
sets probation by **role** — 90 days generally, 180 for technical-complexity,
high-responsibility, specially-qualified or trust roles, 240 for directors, 30/15
for fixed-term — and arts. 112.º(4)–(6) shorten or exclude it based on the
individual's prior history with that employer. Probation length in Portugal is
not a property of Portugal.

### C-21 · Two Portuguese day-counting conventions, neither of which is "days between two dates" · D-32, D-03 · UC-04, UC-08, UC-05

- **CIRS art. 16(2):** *"considera-se como dia de presença em território
  português qualquer dia, **completo ou parcial, que inclua dormida** no
  mesmo."* A day counts **only if it includes an overnight stay**, and then it
  counts whole. A same-day visit is **zero**; a late arrival is **one**.
  `computePresenceDays()` measures date ranges, so it over-counts the first case
  and can under-count the second.
- **CT art. 113(2):** days of absence, leave, exemption or contract suspension
  **do not count** toward the probation period. So even "how long has probation
  lasted", which C-20's step function depends on, is not elapsed calendar time.

Compare **C-2**: the Schengen Borders Code counts the entry and exit days *both*
as days of stay. Three counting conventions, three instruments, one
`computePresenceDays()`.

### C-22 · A two-month gap rule between postings, which nothing in the code can see · D-19 · UC-04

The Practical Guide, applying Regulation 883/2004 art. 12:

> Once a worker has ended a period of posting, **no fresh period of posting for
> the same worker, the same undertakings and the same Member State can be
> authorized until at least two months have elapsed** from the date of expiry of
> the previous posting period.

`args.travelHistory` is summed into `computeCumulativeDays()`; **the interval
between periods is never examined**. Two three-week workations to the Netherlands
six weeks apart for the same employer is the exact pattern this rule addresses,
and the cumulative-days computation cannot represent the gap at all — its output
is a scalar.

The guide also states that suspension for holidays or illness does **not** extend
a posting (*"In case of sickness of 1 month a posting period which was initially
programmed to take 24 months cannot be extended to 25 months"*), and that going
past 24 months requires an **Article 16 agreement between the two States**, in
whose absence *"the legislation of the Member State where the person is actually
working will become applicable as soon as the posting period ended."* C-6 noted
the 24-month limit had no field; the consequence of breaching it is a change of
competent state by operation of law, not an escalation.

### C-23 · The EU assessment window is forward-looking, and there is a second percentage · D-19 · UC-04, UC-08

Two refinements to **C-7**, both from the guidance the administering institutions
actually apply:

1. **The window looks forward.** *"the assumed future situation in the following
   **12 calendar months** must also be taken into account"*, with past
   performance used only where planned patterns are unavailable. Every window in
   `src/uc04/` is trailing.
2. **There is a 5 % indicator as well as the 25 % one, and it points the other
   way.** Activities under *"5 % of the worker's regular working time and/or
   less than 5 % of his/her overall remuneration"* are indicative of **marginal
   activity**, which takes a person **out** of Article 13 entirely. The guide
   adds that activities *"performed from home"* can themselves indicate
   marginality.

Two indicative percentages doing opposite jobs inside one overall assessment is
the strongest available argument for C-7's conclusion: **do not encode either.**

### C-24 · The CRA's Netherlands row pairs one agreement's date with another agreement's limit · D-21, D-22 · UC-04, UC-08

The CRA publishes *"Netherlands · **October 1, 1990** · CPT63 · **60 months**"*.
Global Affairs Canada's treaty register holds **two** Canada–Netherlands social
security agreements:

| Instrument | In force | Posting maximum in its own art. VI(2) |
|---|---|---|
| CTS 1990/14 (signed 1987, amended 1989) | **1990-10-01** | *"does not exceed **twenty-four months**"* |
| CTS 2004/6 (signed Brantford 2001-06-27) | **2004-04-01** | *"does not exceed **sixty months**"* |

The 2004 agreement defines the 1987 one as *"the previous Agreement"* and carries
an express transition for people already posted under **its** art. VI(2). The
1989 Supplementary Agreement — read in full to check — amends art. X(3)(a) and
art. XIV(2)–(3) only, and does not touch art. VI.

**So the row's date belongs to the superseded treaty and its number to the one
that replaced it.** Both halves are real; the pairing is not.

The general lesson is the expensive one. This table is the administering
agency's own record, retrieved from the authority, not a mirror, and matching
D-21's licence and provenance discipline exactly — and one cell of it is wrong.
*"Get the identifier from a body that has a reason to maintain it"* remains a far
better rule than the alternatives and is not a guarantee. Only reading the
instrument caught it, which is the same finding as **C-9**'s and one level
deeper.

### C-25 · The UN's two-letter regime codes are not ISO 3166-1, and one of them is the United Kingdom · D-39 · UC-03, UC-04

The UN Consolidated List page publishes its permanent-reference-number scheme
under the column heading *"Two Digit Country Code"*. Among the codes: `IQ`, `CD`,
`SD`, `KP`, `IR`, `LY`, `YE`, `SS`, `HT`, `SO`, `CF`, plus `QD` and `TA` for
non-State entities — and **`GB` for the Guinea-Bissau regime (resolution 2048
(2012))**.

Every country field in this repository is ISO 3166-1 alpha-2, in which **`GB` is
the United Kingdom** (Guinea-Bissau is `GW`). A pipeline that ingested these
prefixes as country codes — the obvious reading, given the heading — would put
the United Kingdom in `RESTRICTED_JURISDICTIONS`.

This is **C-16**'s finding in an unrelated mechanism: there, projecting the EU
regime register onto a destination blocklist blocks the **United States**,
because the regime attached to `US` is the Blocking Statute, a measure protecting
*against* it; here it is a code-space collision. Different cause, same product —
a plausible, well-formed, confidently wrong country in a blocklist. **A register
of regimes is not a blocklist of destinations, and there is more than one way for
the conversion to go wrong.**

The set comparison itself is in
[`D-39-un-consolidated-list.md`](D-39-un-consolidated-list.md): three of the ten
codes in `SANCTIONED_OR_RESTRICTED` correspond to UN country regimes, nine UN
country regimes are absent from the ten, and `AF` — which is in the ten — is
classified by the UN as a **non-State entity** regime (`TA`, resolution 1988
(2011)), not an Afghanistan regime.

### C-26 · The US block is status-based; the authority's rule is activity- and payer-based · D-14, D-15 · UC-04

Two rules in `src/uc04/riskMatrix.js`:

```js
if (visaType === VISA_TYPES.esta_usa || visaType === VISA_TYPES.tourist_visa)
  reasons.push("visitor_visa_active_work_forbidden");     // line 411
…
if (destinationCountry === "US" && visaType !== VISA_TYPES.work_permit)
  reasons.push("us_requires_work_permit");                // line 470
```

The second blocks a US destination on **every** visa type except `work_permit` —
`business_visa` included. Against the sources:

- **State**, first listed VWP requirement: *"**Travel Purpose Must be Permitted
  on a Visitor (B) Visa**"*. The B class includes **B-1**.
- **USCIS**, on B-1: eligible for *"business activities of a commercial or
  professional nature … **including, but not limited to**"* consulting with
  business associates, negotiating a contract, attending a conference,
  short-term training. **The list is expressly non-exhaustive**, so it cannot be
  turned into a lookup in either direction.
- **USCIS**, naming the actual prohibition: certain B-1 activities are *"**not
  considered … to be prohibited local 'employment' or 'labor for hire' within
  the United States**"*, and the violation arises from *"working for another
  employer **in the United States**."*

So the operative line is **local employment / labor for hire**, discriminated by
activity and by who pays — the same test Canada draws in IRPR s. 187 (**C-5**:
*"primary source of remuneration … outside Canada"*). Two immigration
authorities, two continents, and neither draws the line where the code draws it.

Three consequences, and only the first is a straightforward fault:

1. **`business_visa` to the US is blocked outright**, though the B-1 *is* the
   business visa and the authority describes it as permitting business
   activities. A blocked request that should have been a business trip is a
   **false refusal**, and `CLAUDE.md` §6's lesson is that a block which is wrong
   is invisible because it looks cautious.
2. **The comment on `VISA_TYPES.esta_usa` — *"tourist, NOT work"* — describes a
   narrower permission than the authority grants.** ESTA carries what a visitor
   (B) visa carries, business included, capped at 90 days.
3. **None of this establishes that a workation qualifies.** USCIS's eligibility
   limbs — *"business of a legitimate nature"*, a *"specific limited period"*,
   an unabandoned residence abroad — are officer judgements. The finding is that
   the code asks none of them, **not** that the answer is yes. Changing the
   matrix's most-cited block is its own reviewed unit of work.

### C-27 · VWP eligibility depends on nationality *status*, travel history and dual nationality — none representable · D-14 · UC-04

`classifyRisk()` takes one `nationality` string. The Department of State's
requirements need three things it cannot carry:

1. **A status held under a nationality.** *"To be eligible to travel under the
   VWP, **British citizens must have the unrestricted right of permanent abode**
   in England, Scotland, Wales, Northern Ireland, the Channel Islands, and the
   Isle of Man."* `GB` alone is not an answer.
2. **Travel history to third countries.** Under the *Visa Waiver Program
   Improvement and Terrorist Travel Prevention Act of 2015*, VWP eligibility is
   lost by nationals of VWP countries who have *"traveled to or been present in"*
   DPRK, Iran, Iraq, Libya, Somalia, Sudan, Syria or Yemen on or after
   2011-03-01, or Cuba on or after 2021-01-12.
3. **Dual nationality** of Cuba, DPRK, Iran, Iraq, Sudan or Syria.

`args.travelHistory` exists but is consulted **only** by the Schengen cumulative
count. Rule (2) is a rule in which travel to *other* countries changes whether
entry to *this* one is permitted — a shape the matrix has no room for.

**And it produces a fifth differently-shaped country list.** `KP IR IQ LY SO SD
SY YE` + `CU` is not a set of destinations to block: it is a set of places whose
*past visitation* disqualifies a traveller from a visa-waiver programme run by a
country that is not among them. Flattened into `RESTRICTED_JURISDICTIONS` it
would be wrong in a sixth new way. The four earlier ones are in **C-16**, the
fifth in **C-25**.

Also unrepresented, and stated by both agencies: a VWP stay is capped at **90
days**, a short trip to Canada, Mexico or a nearby island **does not reset it**,
and the US branch of the matrix computes no duration at all because it terminates
at `us_requires_work_permit` first.

---

## Fourth pass, 2026-08-20 — C-28 to C-30 · the notice table's two demo-country gaps

### C-28 · The Dutch flat month is conditional, and the condition is unreadable from the record · D-01, D-40 · UC-05

`NOTICE_PERIOD_TABLE.NL` now exists (it did not when **C-14** was written) and
encodes art. 7:672(4)'s **one month, flat**, with art. 672(1)'s end-of-month
anchor. Both are correct **only for an employee whose volume of work is fixed**.

Art. 7:672(**5**), which C-14 did not reach, disapplies both:

> Indien de omvang van de arbeid niet is vastgelegd, bedraagt de door de
> werknemer in acht te nemen termijn van opzegging, **in afwijking van lid 4**,
> de termijn, bedoeld in artikel 628a, leden 2 en 4, of vier dagen […] **Lid 1
> is niet van toepassing.**

D-40 supplies the numbers it points at: art. 628a(2) is **four days**, and art.
628a(4) lets a collective agreement cut that to **no less than 24 hours**.

| Volume of work | Employee's notice | End-of-month anchor |
|---|---|---|
| Fixed | **One month** (672(4)) | **Yes** (672(1)) |
| Not fixed / on-call | **Four days**, or 24 hours under a CAO (672(5) → 628a(2),(4)) | **No** (672(5)) |

**And this is explicitly not proposed as a gate.** Art. 628a(9) defines the
on-call contract as one where the volume of work is *not fixed as a single number
of hours per period* — or, on a separate limb, where the employee has no right to
time-based pay for work not performed. **Nothing on the Remote employment record
answers either limb.** `contract_type` carries `full_time` / `part_time` /
`contractor`, which is a different question, and `work_hours_per_week` is not the
test — 628a(9)(b) reaches contracts with no hours figure in dispute at all.
Branching on `work_hours_per_week` would be a proxy this repository invented for
a statutory test, which is what **C-16**, **C-25** and **C-27** each name in
other use cases and what `CLAUDE.md` §7 records UC-03 having already paid for
live. It is carried as a caveat on every Dutch decision instead.

Under-serving notice by a factor of seven is not a rounding difference, and the
direction matters: an overstated notice period is the measure of a payment
somebody may be asked for — see art. 401.º's Portuguese analogue in **C-19**.

### C-29 · "No statutory minimum" and "no rule on file" were the same outcome, and only one of them is a statement about the law · D-04, D-06 · UC-05

Until this pass `getNoticeRule("US")` returned `null` and every American
resignation escalated as **`unsupported_country`** — a claim, written durably to
`uc05_resignations` and `audit_log` and ranked in the metrics exception table,
that the United States is outside Remote's coverage. That is false, and it is
the same false-by-collapse shape **C-13** describes from the sourcing side.

Three facts were sharing one outcome, and they go to different desks:

| | What it says | What a human has to do |
|---|---|---|
| `unsupported_country` | We hold no rule. The law may require anything. | Extend the table. |
| **`no_statutory_notice_period`** *(new)* | Sourced: no statutory minimum runs against the resigning employee. What is owed comes from the contract, **which this system does not hold**. | Read the contract. |
| `no_matching_notice_bracket` | We hold the country's rule; no bracket covers this tenure. | Extend the table's low end. |

The new outcome is carried by a third state on the calculator's result —
`statutoryMinimumExists` is `true` / `false` / `null`, where `null` is honest
ignorance and `false` is a sourced positive finding — rather than by a zero.
**A zero-day notice period would have been the worst of the three encodings**:
`0` is a quantity a reader can act on, and it says the employee owes nothing,
which is a claim about their contract that no source here supports.

**The evidence behind the `false` is weaker than the evidence behind any computed
date, and the design accounts for that rather than hiding it.** D-06 is an
argument from scope, tagged `[INFERRED]`: WARN delimits what US federal law
requires on separation — 60 days **from employers of 100+** on mass layoffs — and
does not state the employee-side negative. State mini-WARN statutes and
contractual notice are both untouched. This is why the outcome **escalates** and
does not reach `prepared_for_signoff`: the inferred negative is allowed to change
what the record *says*, and is not allowed to advance a case toward a human
signing off a figure. The argument is written up in `docs/use-cases/UC-05.md`
§7a.

### C-30 · Canada's row still emits three invented numbers, and now it is the odd one out · D-04 · UC-05

**Not fixed this pass, and named because the pass makes it conspicuous.**
`NOTICE_PERIOD_TABLE.CA` is `basis: "customary"` with brackets `0 / 7 / 14` days
that **C-13** already concedes are "illustrative and unsourced". Canada Labour
Code s. 230 (D-04) imposes notice **entirely on the employer**, exactly as WARN
does — so on the employee side Canada and the United States are, as far as this
corpus can see, the same fact.

After this pass the United States states that fact positively and refuses to
compute, while **Canada computes an invented number and can carry it to
`prepared_for_signoff`** — a fabricated figure on a sign-off form, which is
strictly worse than the `unsupported_country` collapse this pass just closed.

It is left alone deliberately, on two grounds, not one:

1. **The evidence is genuinely half-missing.** D-05 (Ontario ESA 2000) could not
   be retrieved — e-Laws is JavaScript-only, see `RETRIEVAL-BLOCKED.md` — so
   *"varies by province"* is still unsourced, and one province would not prove a
   claim about ten anyway. Moving CA to `no_statutory_notice_period` would assert
   a national negative on federal evidence alone.
2. **Deleting the invented brackets is a behaviour change in a live demo
   country**, and UC-05 demo scenarios were being built against this table in
   parallel with this pass.

The honest interim reading: **CA's numbers are the least-sourced figures in the
table, and they are the only ones that can reach a sign-off form.** Either
outcome — sourcing them, or replacing them with `no_statutory_notice_period` —
is a decision with an argument, and it belongs in its own unit of work.

> ✅ **DECIDED 2026-08-21 (UC-05's seventh decision pass) — replace them with
> `no_statutory_notice_period`.** That unit of work is
> `qa/contracts/UC-05-acceptance.md` §18 Step 5, change `[N-7]`. **Not yet
> built**; the CA row still emits `0 / 7 / 14` in the tree.
>
> **Both grounds above were re-examined, and neither survives.**
>
> 1. *"The evidence is genuinely half-missing."* True, and it is an argument for
>    **escalating**, not for computing. An unsourced number is a worse answer to
>    an unsourced question than a refusal is — and the refusal asserts no national
>    negative: `no_statutory_notice_period` says *we found no employee-side
>    statutory minimum and what is owed comes from the contract*, which is exactly
>    what the federal evidence supports and exactly what the missing provincial
>    evidence leaves open.
> 2. *"Deleting the brackets is a behaviour change in a live demo country."* **This
>    has expired.** It was written while CA was one of the few demo countries
>    producing a positive outcome. NL was added to the table on 2026-08-20 and
>    reaches `prepared_for_signoff`, so NL and PT carry the demo's positive path
>    and nothing is lost when Canada stops computing. `docs/DEMO-COUNTRIES.md` is
>    **regenerated in the same commit**, never hand-edited — its columns are
>    observed, and hand-correcting an observation destroys the only property that
>    makes the file worth keeping.
>
> **C-20 (PT probation) is explicitly NOT closed by this**, and was left alone on
> purpose: it is a second, independent instance and gets its own unit of work with
> its own tests, which is what this file's header asks for.

### C-31 · The United Kingdom row encodes the EMPLOYER's sliding scale and reports it as the employee's obligation · D-41 · UC-05

**This is the third instance of one defect and the first one that is already
computing wrong numbers in production.** C-14 caught it in the Netherlands before
a row existed; C-20 caught it in Portugal's probation field. Here it is live.

ERA 1996 **s. 86** has the two obligations in adjacent subsections:

- **s. 86(1)** — *"The notice required to be given by **an employer** …"* — one
  week if under two years, **one week for each year** from two to twelve years,
  twelve weeks from twelve years.
- **s. 86(2)** — *"The notice required to be given by **an employee** who has
  been continuously employed for one month or more … is **not less than one
  week**."* Flat. No tenure ladder at all beyond the one-month threshold that
  engages the section.

`NOTICE_PERIOD_TABLE.GB` carries subsection (1)'s shape:

| Tenure | Table says the employee owes | s. 86(2) says |
|---|---|---|
| 1–24 months | 7 days | **7 days** |
| 25–36 months | 14 days | **7 days** |
| **37–48 months** | **21 days** | **7 days** |
| 49–60 months | 28 days | **7 days** |
| 61–72 months | 35 days | **7 days** |
| 73–84 months | 42 days | **7 days** |
| 85–120 months | 56 days | **7 days** |
| 121+ months | **84 days** | **7 days** |

**A British employee with 43 months' service is told they owe 21 days against a
statutory 7 — three times the law, against the employee.** At twelve years it is
twelve times. Only the first bracket is right, and it is right by coincidence:
7 days is where both parties' obligations happen to start.

The citation string is `"Employment Rights Act 1996 §86 (sliding scale)"` — the
right Act, the right section, **no subsection**, and the parenthetical describes
subsection (1). A reviewer checking the citation finds a sliding scale in s. 86
and stops.

**Two independent reasons not to keep the ladder**, and the second is the one
that shows how little anyone has looked at these numbers: it is also **not a
faithful copy of s. 86(1)**. Subsection (1)(b) is one week per completed year
from two to twelve. The encoded ladder jumps `85–120 months → 56 days` and
`121+ → 84 days`, so a ten-year employee gets 8 weeks where the employer's own
scale says 10, and an eleven-year employee 12 weeks where it says 11. It is the
wrong party's obligation **and** a wrong transcription of it.

**The correction is a deletion, not a re-bracketing.** One bracket,
`{tenureMinMonths: 1, tenureMaxMonths: null, noticeDays: 7}`, and the citation
moved to `s. 86(2)`. What to do below one month's continuous employment is a
second decision: s. 86 does not engage there, which is *"we hold no statutory
rule for this tenure"* and not *"zero days"* — the distinction **C-29** already
built `statutoryMinimumExists` and `no_matching_notice_bracket` to carry.

One thing the corrected row still cannot express: **s. 86(3)** lets either party
waive notice or accept payment in lieu, so even one week is a default. Fourth
country in a row — see **C-32**'s closing note.

### C-32 · Ireland's row prints the right number under the wrong section, and its qualifying period is off by one · D-42 · UC-05

`NOTICE_PERIOD_TABLE.IE` cites **"Minimum Notice and Terms of Employment Act 1973
§4"** and returns 7 days. **§4 is the employer's obligation** — a 1/2/4/6/8-week
ladder by tenure. The employee's obligation is **§6**, *"Right of employer to
notice"*, and it is *"not less than one week's notice from an employee who has
been in his continuous employment for thirteen weeks or more"*.

**The two section headings read as though they had been swapped**, which is
exactly how a table gets built from the wrong one — and in Ireland's case the
wrong one produces the right answer at the low end, so nothing downstream ever
disagrees.

**This is the most instructive row in the 2026-09-02 pass precisely because it
is not broken.** The UK made this mistake and the numbers went wrong visibly
(**C-31**). Ireland made the same citation error and the output stayed correct,
so the only artefact is a string in `sourceCitation` that no test reads and no
run contradicts. Had the Irish §4 ladder been copied the way the UK's was, a
fifteen-year Irish employee would be told they owe **eight weeks** against a
statutory **one**. The same trap was open in both countries; it closed on one of
them by luck.

**And there is a real off-by-one.** Both §4 and §6 qualify on **thirteen weeks**
of continuous service — 91 days, ≈ 2.99 months. The table's brackets split on
whole months, `{0–2 → 0 days}` and `{3+ → 7 days}`, so an employee at exactly
thirteen weeks lands in the **first** bracket and is told they owe **nothing**.
It is the mirror of **C-18** (Portugal, off by one *against* the employee) with
the identical cause: **a threshold stated in weeks, re-expressed in months, and
rounded.** The fix needs the bracket to be expressed in weeks or the boundary
pushed down, not the number changed.

**A scope condition the table has no field for.** §3(1)(a) disapplies the whole
Act to an employee normally expected to work less than **eighteen hours** a week
(*twenty-one* as enacted, substituted 1984), and that limitation is in turn
restricted (20.12.2001) by the Protection of Employees (Part-Time Work) Act 2001
§8, which applies each relevant enactment to a part-time employee *"in the same
manner"*. The hours threshold therefore survives on the face of §3 and is
displaced in practice — and a part-time EOR engagement is exactly the case where
somebody would need to know which. No hours field exists on this row.

**Closing note on waiver, because this is now four for four.** ERA 1996 s. 86(3)
(UK), MNTEA 1973 §7 (Ireland), BW 7:672(8) (**C-14**, Netherlands) and CT art.
400.º(2) (**D-02**, Portugal) all make the employee's statutory notice a
**default the parties may displace**. In every country this corpus has read, the
table reports a displaceable default as a fixed entitlement. That is not a
per-country defect; it is a missing dimension.

### C-33 · Poland's anchor points at the wrong end of the month, and two of its three periods are months encoded as days · D-43 · UC-05

`NOTICE_PERIOD_TABLE.PL` sets `anchorRule: "month_1st"`, with a code comment
asserting *"1- and 3-month notices start on the 1st of the following month."*

Kodeks pracy **art. 30 § 2¹**, in one sentence, says the opposite and also
supplies the weekly rule:

> Okres wypowiedzenia umowy o pracę obejmujący **tydzień lub miesiąc albo ich
> wielokrotność** kończy się odpowiednio **w sobotę** lub **w ostatnim dniu
> miesiąca**.

A notice period comprising a week or a month, or a multiple of either, **ends**
respectively **on a Saturday** or **on the last day of the month**. The rule is
about where the period terminates; `month_1st` points at the opposite side of the
boundary. `month_end` already exists in the `anchorRule` union and is what the
Netherlands uses for the identical Dutch rule (**C-14**).

**The units are the same defect, not a second one.** Art. 36 § 1 says
**2 tygodnie / 1 miesiąc / 3 miesiące**; the table says **14 / 30 / 90 days**.
`NoticeBracket.noticeMonths` exists for exactly this and is used only by NL,
where the file's own note explains why 30 days is not one month: added to a
resignation filed on the 1st of a 31-day month and then snapped to that month's
end, 30 days lands on the 31st of the **same** month — a full month early. Poland
inherits that error and adds the anchor pointing the wrong way on top of it.

**The Saturday rule has nowhere to live.** It is in the same subsection, with the
same statutory force as the monthly rule, and the table currently passes it as a
note on the calculator's return value because `anchorRule` has no `week_saturday`
member. A rule carried as prose beside a computed date is a rule that is not
applied.

The brackets and the party are **right** — see **K-5**. This entry is about the
three quantities around them.

### C-34 · Poland has a statutory probation notice, in working days, keyed to the probation period rather than to tenure — and the row says `probation: null` · D-43 · UC-05

Kodeks pracy **art. 34**:

> Okres wypowiedzenia umowy o pracę zawartej na okres próbny wynosi:
> 1) **3 dni robocze**, jeżeli okres próbny nie przekracza 2 tygodni;
> 2) **1 tydzień**, jeżeli okres próbny jest dłuższy niż 2 tygodnie;
> 3) **2 tygodnie**, jeżeli okres próbny wynosi 3 miesiące.

`NOTICE_PERIOD_TABLE.PL.probation` is `null`. Per the file's own comment on the
NL row, `null` means *"we hold no separate probation rule"* and is explicitly
**not** an assertion that none exists — so the row is honest and incomplete
rather than wrong, and `pickBracket()` falls through to art. 36's ordinary
bracket, giving a Polish probationer **14 days** where art. 34 gives 3 working
days, 1 week or 2 weeks.

Three separate shape problems sit behind the missing number, and they are the
reason this is its own entry rather than a line in C-33:

1. **It is keyed to the wrong axis.** `NoticeBracket.probation` is bracketed on
   `tenureMinMonths`/`tenureMaxMonths`. Art. 34's rungs are keyed to **how long
   the probation period itself is** — a term of the contract — not to how much of
   it has elapsed and not to tenure. Portugal's art. 114.º is keyed to a third
   thing again, **elapsed** probation (**C-20**). Three countries, three axes,
   one field.
2. **It is a different contract type, not a modifier.** Art. 34 governs *umowa o
   pracę zawarta na okres próbny* — a probationary **contract** — whereas art. 36
   governs indefinite and fixed-term ones. The table has no contract-type
   dimension; **D-02** ¶3 recorded the same gap for Portugal's fixed-term ladder.
3. **`3 dni robocze` is working days** in a row declaring `unit: "calendar"`.

### C-35 · Canada's row is `basis: "customary"`, and in Québec the obligation is statutory, mutual, and deliberately not a number · D-05, D-44, D-04 · UC-05

`NOTICE_PERIOD_TABLE.CA` asserts *"Common-law customary notice (no statutory
employee minimum; varies by province)"* over brackets of `0 / 7 / 14` days. The
2026-09-02 pass read two provinces and **they answer in opposite directions**.

**Ontario confirms the row.** The ESA 2000 (D-05) was retrieved in full — the
first time, closing a `RETRIEVAL-BLOCKED.md` entry — and Part XV imposes notice
entirely on the employer, ss. 54/57/58. A whole-Act search finds exactly one
period of employee notice, **s. 63(1)(e)**, and it is a **condition an employee
may choose to satisfy to preserve severance pay** while leaving during the
employer's notice period, not a duty. Nothing sanctions an employee who ignores
it. Combined with the Canada Labour Code (**D-04**, s. 230, employer only), the
provincial half of **C-13** is sourced for one province.

**Québec refutes it.** Code civil du Québec **art. 2091**:

> **Chacune des parties** à un contrat à durée indéterminée peut y mettre fin en
> donnant à l'autre un **délai de congé**. Le délai de congé doit être
> **raisonnable** et tenir compte, notamment, de la nature de l'emploi, des
> circonstances particulières dans lesquelles il s'exerce et de la durée de la
> prestation de travail.

and **art. 2092** makes the employee's remedy for insufficient notice
**non-renounceable**. Every clause of the CA citation string fails here: Québec
is **civil law, not common law**; art. 2091 is **enacted, not customary**; it
binds **either party**, so there *is* an employee-side statutory obligation; and
it states **no number at all**.

**That last point is the sharpest, and it is why `0 / 7 / 14` is worse than
merely unsourced.** `14 days` for a three-year Québec employee is a quantity, and
the entire content of art. 2091 is that the answer is not a quantity independent
of the nature of the employment and its circumstances. Printing a number there
is not approximating the law — it is answering a question the law declines to
answer in that form, and art. 2092 exists to stop that answer being bargained
for.

**This does not reopen C-30's decision; it makes it firmer and widens its
reason.** `qa/contracts/UC-05-acceptance.md` §18 Step 5 change `[N-7]` already
decided to replace CA's brackets with `no_statutory_notice_period` — still
**not built**, the row still emits `0 / 7 / 14`. C-30 justified it as *the
evidence is half-missing, so refuse*. After this pass the justification is
stronger and different: **the evidence is no longer missing and it is
contradictory by province**, and one of the two provinces read has a statutory
employee obligation whose correct rendering is a refusal to compute.

The wording of the refusal needs one adjustment for Québec, and only one. For
the United States and Ontario, *"the notice owed comes from the contract, which
this system does not hold"* is exact. In Québec the notice owed comes from **the
Civil Code's reasonableness standard applied to this person's circumstances**,
which this system also does not hold and additionally must not estimate. Same
outcome, same escalation, different sentence.

**Still open: ten provinces and territories.** Two read, two opposite answers.
That is the strongest available evidence that *"varies by province"* cannot be
collapsed into one national bracket set, and the weakest possible basis for
choosing which of the two to encode.


---

## What this list is not

It is not a patch set, and several items above would be **wrong to encode**. C-7
names a 25 % figure the regulation calls an indicator inside an overall
assessment, and **C-23** adds a second percentage pointing the opposite way;
C-12's answer is *fewer* confident numbers, not more; C-16, **C-25** and
**C-27** all say the answer is a live fetch and a smaller claim, not a bigger
constant; **C-19** names a statutory waiver that a support automation must know
exists and must not try to determine; and **C-26** touches the matrix's
most-cited `blocked` rule, which is exactly the kind of change that needs its own
reviewed unit of work rather than a bulk edit from a research file. `src/uc08/jurisdictionKnowledge.js`
asserts that `183`, `365` and `180` appear nowhere in its register, and that test
is a feature of this design rather than an obstacle to improving it.

The one thing every item shares is the shape `CLAUDE.md` §4 names as this
project's through-line: **a number with no source and a number with the right
source produce identical green runs.** Everything above passed the full suite
before this pass and passes it after.
