# D-19 · EU — Practical Guide on the applicable legislation in the EU, the EEA and Switzerland · **RETRIEVED 2026-08-19**

| | |
|---|---|
| **Catalogue id** | D-19 (`docs/knowledge/DOWNLOAD-MANIFEST.md`) · L1-04-adjacent (`docs/KNOWLEDGE-SOURCES.md` §4) |
| **Source name** | *Practical guide on the applicable legislation in the European Union (EU), the European Economic Area (EEA) and in Switzerland* |
| **Publisher / authority** | Prepared and agreed by the **Administrative Commission for the Coordination of Social Security Systems**; published by the **European Commission**, DG Employment, Social Affairs and Inclusion |
| **Exact URL** | <https://ec.europa.eu/social/BlobServlet?docId=11366&langId=en> — the download link carried by the Commission's own *A-Z on social security coordination (FAQs)* pages under <https://employment-social-affairs.ec.europa.eu/policies-and-activities/moving-working-europe/network-legal-experts-moves/z-social-security-coordination-faqs/> |
| **Retrieved** | **2026-08-19**, by `curl` with a full browser header set. HTTP 200, **1,227,669 bytes**, `application/pdf`, 55 pages. |
| **SHA-256 of the retrieved bytes** | `ad237a4ce2e25c71e8c7e8718f806832df730f704fd6cf4f20efdce92d317f6a` |
| **Source `updatedAt`** | **December 2013**, printed in the running footer of every page (*"December 2013 N/53"*). PDF metadata: created 2014-03-21, modified 2016-01-19. **This is the version the Commission links today**, from a FAQ page it maintains — see the note below. |
| **Licence / basis for inclusion** | **Class (a) after reading the notice — bytes committed.** The manifest listed this as class (c) with the caveat *"an EU publication rather than primary law; publications can carry their own notice; verify."* Verified: **the PDF carries no copyright notice of its own**, and the Commission's legal notice — read live at <https://commission.europa.eu/legal-notice_en>, 2026-08-19 — states *"The Commission's reuse policy is implemented by the Commission Decision of 12 December 2011 on the reuse of Commission documents"* and *"Unless otherwise indicated (e.g. in individual copyright notices), content owned by the EU on this website is licensed under the **Creative Commons Attribution 4.0 International (CC BY 4.0)** licence."* Attribution as above; no quoted passage below is altered. Bytes at [`sources/D-19-eu-practical-guide-applicable-legislation.pdf`](sources/D-19-eu-practical-guide-applicable-legislation.pdf). |
| **Evidence tag** | `[CONFIRMED — agreed administrative guidance, retrieved 2026-08-19]` · **not** `[CONFIRMED — statute]`; see the disclaimer quoted below |

## What this document is, in its own words — and why the tag is weaker

> This practical guide was prepared and agreed by the Administrative Commission
> for the Coordination of Social Security Systems. This Guide is intended to
> provide a working instrument to assist institutions, employers and citizens in
> the area of determining which Member State's legislation should apply in given
> circumstances. **It does not reflect the official position of the European
> Commission.**

So it is agreed guidance from the Member States' own coordinating body, not law
and not a Commission position. Where it and Regulation 883/2004 (**D-17**) or
987/2009 (**D-18**) differ in emphasis, the regulations govern; this document's
value is that it says how the administering institutions read them.

**Its date is itself a finding.** The Commission's live FAQ, retrieved the same
day, links a guide last revised in **December 2013** — while its own social
security coordination hub currently advertises a *"Revision of EU social security
coordination rules"* factsheet dated **29 April 2026**. Anything taken from this
document is `[CONFIRMED — as at December 2013]`, and that limitation is the
`Source updatedAt` row doing exactly the job the manifest says it is for:
*"a checksum detects a re-publication; only a version date detects a re-reading."*

## The four passages that bear on what `src/uc04/` does

### 1 · The 24-month posting limit is a ceiling with one lawful way past it

> The Regulations provide that a posting period may not last any longer than 24
> months. However, **Article 16 of Regulation 883/2004 permits the competent
> authorities of two or more Member States to reach agreements providing for
> exceptions** […] if it is known that the anticipated duration of a posting for
> a worker will extend beyond 24 months, an Article 16 agreement **must** be
> reached […] If a request for an extension of the posting period beyond 24
> months is not submitted or if […] the States concerned do not make an
> agreement […] **the legislation of the Member State where the person is
> actually working will become applicable as soon as the posting period ended.**

`a1_certificate_recommended` fires with no reference to duration (**C-6**). The
guide adds the consequence of ignoring it, which is not "escalate" but a
**change in the competent state by operation of law** on the day the posting
ends.

### 2 · A two-month break before a fresh posting — a rule with no analogue in the code

> Once a worker has ended a period of posting, **no fresh period of posting for
> the same worker, the same undertakings and the same Member State can be
> authorized until at least two months have elapsed** from the date of expiry of
> the previous posting period.

Nothing in `src/uc04/` looks at the *gap between* trips. `travelHistory` is
summed into `computeCumulativeDays()`; the interval between periods is never
examined. A repeat workation to the same country for the same employer inside two
months is exactly the pattern this rule addresses and exactly what the
cumulative-days computation cannot see. New: **C-22**.

### 3 · Holidays and sickness do not extend a posting

> Suspension of work during the posting period, **whatever the reason (holidays,
> illness, training at the posting undertaking etc.) does not constitute a reason
> which would justify an extension** […] In case of sickness of 1 month a posting
> period which was initially programmed to take 24 months **cannot be extended to
> 25 months**.

### 4 · The 25 % figure, in context — and a 5 % one beside it

> A '**substantial part of the activity**' pursued in a Member State means that a
> quantitatively substantial part of all the activities of the worker is pursued
> there, **without this necessarily being the major part** […] If in the context
> of carrying out an **overall assessment** it emerges that at least **25 %** of
> the person's working time is carried out in the Member State of residence
> and/or at least 25 % of the person's remuneration is earned there **this shall
> be an indicator** […] **this is not an exhaustive list and other criteria may
> also be taken into account.**

> **Marginal activities** are activities that are permanent but insignificant in
> terms of time and economic return. **It is suggested that, as an indicator,
> activities accounting for less than 5 %** of the worker's regular working time
> and/or less than 5 % of his/her overall remuneration should be regarded as
> marginal activities. Also the nature of the activities, such as activities that
> are of a supporting nature, that lack independence, **that are performed from
> home** or in the service of the main activity, can be an indicator that they
> concern marginal activities.

> In addition to the above criteria […] **the assumed future situation in the
> following 12 calendar months must also be taken into account.** However, past
> performance is also a reliable measure of future behaviour […]

Three things follow, and only the first was already known:

- **C-7 stands and is strengthened.** 25 % is an indicator inside an overall
  assessment in the regulation *and* in the guidance that applies it. It remains
  **wrong to encode as a threshold**.
- A **second** percentage exists, at 5 %, for a different purpose (marginal
  activity, which takes a person *out* of Article 13 altogether). Two indicative
  percentages doing opposite jobs is precisely the situation in which encoding
  one number produces a confident wrong answer.
- The assessment window is **forward-looking, 12 calendar months**. Every window
  in `src/uc04/` is trailing. New: **C-23**.

## Not extracted, deliberately

The guide's Part II worked examples are extensive and specific to named Member
State pairs that are not in the NL/PT/CA/US demo set. They are in the committed
PDF; nothing here paraphrases them.
