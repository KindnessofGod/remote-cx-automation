# UC-04 Workation / Remote Work Authorization — Primary-Source Grounding

Research pass conducted 2026-08-02 against primary sources: developer.remote.com
(live API reference), remote.com's own blog and support.remote.com help center,
the OECD's own site and its November 2025 Model Tax Convention update, ssa.gov,
europa.eu ("Your Europe"), and the public blogs/help centers/glossaries of five
competitor EOR/PEO platforms (Deel, Oyster, Multiplier, Velocity Global/Pebl,
Papaya Global). Every claim below is tagged inline; a claim with no primary
source reachable by direct fetch is marked and the workaround used (search-engine
snippet extraction of the same URL) is stated explicitly rather than presented as
an independent fetch. Nothing here is invented or filled in from training
knowledge where a live source disagreed or was unreachable.

**A structural note on tooling before the findings**: `support.remote.com`,
`help.letsdeel.com`, and `ssa.gov` all returned `HTTP 403 Forbidden` to every
direct `WebFetch` attempt in this session (bot-blocking on their help-desk/
government hosting, not a content problem). Where this happened, the fallback
was to read the same URL's content as extracted and quoted by `WebSearch`
result summaries — the URL is still the primary source and is still cited, but
the retrieval path is search-engine text extraction rather than an independent
document fetch, and every such case is flagged with **[fetched via search
snippet, not direct WebFetch — 403]** so a reader can judge reliability
accordingly. Where two independent search queries returned the same specific
number from the same URL (e.g. Deel's day count), that is noted as
corroboration.

---

## 1. Remote.com's own public content on workations

### 1.1 The support.remote.com article — Remote Work Authorization

**URL:** `https://support.remote.com/hc/en-us/articles/37802834593805-Remote-Work-Authorization-What-it-is-and-How-to-request-it`
**[fetched via search snippet, not direct WebFetch — 403]**, confirmed
consistently across three separate search queries in this session.

Remote.com does publish a named product/process for this — it is called
**"Remote Work Authorization"**, and the article explicitly uses the word
"Workation" as a case falling under it. Per the extracted page text:

> "Remote work authorization refers to Remote's internal process to assess
> and confirm that an employee can perform their duties from a location other
> than the country or place specified in their employment contract, for a
> limited period of time." [CONFIRMED]

> "Remote Work Authorization is needed for working from a different country
> than your employment country, even for a short duration for a personal trip
> (a 'Workation'), extending a personal trip with remote work days before or
> after vacation or holiday time abroad, temporary relocation for personal
> reasons, or working from a second home or alternative residence abroad."
> [CONFIRMED]

**Process, as described on the page:**

> "As an EOR employee, initiate a remote work authorization request in the
> Request hub. Your request is first forwarded to your employer, who can
> provide approval and add comments." [CONFIRMED]

> "Submit your request at least 3–8 weeks before your intended departure to
> allow adequate time for assessment and compliance review." [CONFIRMED]
> — this is the one concrete numeric figure the article publishes, and it is a
> **lead-time requirement, not a stay-duration cap**. No maximum number of
> days an employee may spend on a workation is stated anywhere in the
> extracted text.

> "All employees are required to submit a Remote Work Authorisation request
> before working from any location outside their country of employment.
> Skipping this step can lead to serious immigration, tax, or legal
> compliance risks for both you and the company." [CONFIRMED]

**What gets reviewed**, per the article: "immigration and visa compliance, tax
and social security implications, and local legal & reporting requirements."
[CONFIRMED] Two-stage flow: employer/manager reviews first, then Remote's own
compliance team ("Mobility Team") does the substantive assessment.
[CONFIRMED]

### 1.2 The remote.com blog — "How to manage authorization for remote work"

**URL:** `https://remote.com/blog/remote-work/authorization-for-remote-work`
— fetched directly with WebFetch, succeeded.

This is Remote's own first-party blog, and it is more specific about *what
the Mobility Team actually checks* than the help-center article is. Quoted
directly from the fetched page:

> "Our mobility team conducts a thorough analysis, providing insights into
> relevant immigration and tax considerations." [CONFIRMED]

The five factors the article lists as part of that analysis:

> "We verify whether the employee's nationality permits visa-free travel"
> [CONFIRMED]

> "We assess any restrictions on the number of days an employee can be absent
> from their resident country" [CONFIRMED] — notable: this is a check on the
> employee's *home*-country absence rules, a dimension separate from
> destination-country tax residency, and one this project's earlier UC-04
> spec work had not surfaced.

> "past travel records stored on our platform" are examined [CONFIRMED] — i.e.
> Remote's own process already does **cumulative, multi-trip tracking**, not
> a single-request duration check. This directly supports treating "cumulative
> days in a rolling window" as its own gating dimension rather than folding it
> into a single trip's length.

> "We determine the necessity for specific types of visas based on the
> planned activities" [CONFIRMED]

> "We carefully analyze the job duties planned for the visit" [CONFIRMED] —
> Remote's own public description ties the review to *what the employee will
> actually do* on the trip, not only to how long they'll be gone. This is
> corroborating evidence (from the EOR itself, not just OECD commentary) for
> role/activity-sensitivity as a distinct gating dimension — see §2.

**No specific numerical day cap, safe-harbor threshold, or auto-approval
number is published anywhere in this article.** [CONFIRMED — absence checked
directly against the fetched text, not inferred from silence in a search
snippet.]

### 1.3 developer.remote.com — the actual API surface: Travel Letter Requests

Checked `docs/REMOTE-API-INDEX.txt` (already in this repo, Remote's official
`llms.txt`) plus three reference pages fetched directly. Remote's public
partner API does **not** expose an endpoint literally named "workation" or
"remote work authorization." The closest and only matching resource is
**Travel Letter Requests**:

```
GET   /v1/travel-letter-requests        List travel letter requests
GET   /v1/travel-letter-requests/{id}   Show a single travel letter request
PATCH /v1/travel-letter-requests/{id}   Updates a travel letter request
```
[CONFIRMED, from `developer.remote.com/reference/get_v1_travel-letter-requests.md`,
`get_v1_travel-letter-requests_id.md`, `patch_v1_travel-letter-requests_id.md`,
all fetched directly]

**No `POST` (create) endpoint for travel letter requests appears anywhere in
`docs/REMOTE-API-INDEX.txt`** [CONFIRMED — grepped directly]. Read alongside
§1.1's "initiate a remote work authorization request in the Request hub,"
this is structurally consistent: the request is created through Remote's own
product UI (the "Request hub"), not through the public partner API. A UC-04
automation built against the public API can **read** an existing request's
status and can **record the employer-side decision** via `PATCH`, but cannot
itself originate the request unless it operates inside Remote's own UI — a
constraint worth carrying into the automation design (§ Recommendation).

**Object fields** [CONFIRMED, from the fetched reference pages]:
`destination_country`, `travel_date_start` / `travel_date_end`,
`travel_reason` / `travel_reason_details`, `travel_document_number` (passport
number), `travel_address` (accommodation), `status` (`pending`, `cancelled`,
`declined_by_manager`, `declined_by_remote`, `approved_by_manager`,
`approved_by_remote`), `employer_approver`, `responsible_for_travel_cost` /
`_accommodation_cost` / `_meal_cost` (each `employee` or `employer`).

The `PATCH` endpoint's request schema only accepts two transitions from
`pending`: **`approved_by_manager`** or **`declined_by_manager`**
[CONFIRMED, from `patch_v1_travel-letter-requests_id.md`]. The reference text
itself states: *"a two-stage approval: first by the employer manager, then by
Remote."* [CONFIRMED, quoted directly from the fetched page] — the employer
side can only ever approve-forward or decline; it structurally cannot
approve-and-finalize on its own. **This maps directly onto this project's
prime directive that a 🟡/🔴-tier decision needs a human gate that the
automation cannot bypass** — Remote's own API is already built so a client
can only pass the decision along, not make it unilaterally.

One open nuance: the `travel_reason` enum's exact allowed values (e.g.
whether "workation" / "personal travel" is a selectable category distinct
from "business meeting, conference, client visit") were not directly visible
in the fetched reference text — the field is documented as a free-form
"category selected" without an enumerated value list in what was retrieved.
**[INFERRED]** that it covers workation-type requests, based on the
support-article prose using "Workation" as a described use case for the same
underlying Remote Work Authorization process, but not confirmed against the
literal enum values.

### 1.4 Terminology mismatch worth flagging

The literal word "workation" appears in Remote's own support-article prose
(§1.1) but not, as far as this pass found, as a formal product name on
remote.com's marketing pages or in the API's field/endpoint naming — the API
and the internal process are both named around "travel letter" /
"remote work authorization," with "workation" used descriptively for one
category of the same underlying request. **[CONFIRMED as a naming
observation]**, not a contradiction — just worth not over-fitting a UC-04
build to a literal "workation" string anywhere in Remote's real schema.

---

## 2. Permanent establishment (PE) risk for the employer

### 2.1 The two classic tests, from Remote's own explainer

**URL:** `https://remote.com/blog/eor-peo/what-is-permanent-establishment` —
fetched directly.

> "A fixed place of business establishment is the most traditional type of
> permanent establishment. This means having a tangible, fixed, physical
> business location, such as an office, factory, or workshop." [CONFIRMED]

> "a fixed address doesn't necessarily mean a physical address. Certain
> registrations can qualify as a fixed place of business, as can other
> business operations, even if the company doesn't have an office."
> [CONFIRMED]

> "In an agency permanent establishment, the business has a dependent agent,
> employee, or entity working for them in a country" — illustrated with "a
> sales agent in another country who handles tasks related to closing deals
> and signing contracts." [CONFIRMED]

### 2.2 Role sensitivity — the central finding for this section

Both Remote's own content and a competitor's (Papaya Global) independently
make the same point in the same terms: **PE risk from the dependent-agent
test is a function of *authority to bind the company in contracts*, not of
duration alone, and it depends heavily on what the traveling employee's job
actually is.**

Papaya Global, `https://www.papayaglobal.com/blog/9-global-mobility-tax-issues/`
— **[fetched via search snippet, not direct WebFetch — 403]**:

> decision-making authority triggering PE risk comes from "Salespeople who
> close deals and sign contracts," in addition to executives handling
> partnerships or investments. [CONFIRMED, per extracted text]

Multiplier, `https://www.usemultiplier.com/global-expansion/guide-to-permanent-establishment-old`
— **[fetched via search snippet, not direct WebFetch — 403]**:

> a dependent agent creates PE risk "When this individual frequently enters
> into contracts in the name of a company," with the determining factors
> being "the frequency with which the employee is there and the amount of
> negotiations occurring in the host country." [CONFIRMED, per extracted
> text]

Oyster's own glossary page, `https://www.oysterhr.com/glossary/workation`
— fetched directly, and this is the single most directly useful sentence
found in the entire research pass for this section:

> "the longer the stay and the more 'business-like' the activity (client
> meetings, revenue-generating work, managing local staff), the more your
> risk increases." [CONFIRMED, quoted directly]

This is an EOR **explicitly naming role/activity type as an independent risk
axis alongside duration**, in a customer-facing glossary entry, not a legal
treatise — i.e. the industry itself talks about this in exactly the two-axis
way (duration × activity type) that this document's Recommendation section
below argues for.

**Open nuance**: none of the sources fetched gave a crisp binary rule like
"sales role = always escalate, engineering role = never." All of them
describe it as a matter of degree ("increases risk," "more likely"), which
argues against building a hardcoded role allowlist/denylist and toward
treating role as a category that shifts a request into a lower-confidence
band requiring escalation — consistent with the "escalate on any dimension
we can't confirm with high confidence" design principle this document closes
with.

### 2.3 The OECD's own November 2025 update to Article 5 commentary

This is a live, recent, and directly load-bearing development for UC-04 that
predates any of this project's earlier UC-04 documentation — flagging it as
new information, not previously-known context being repeated.

**Attempted direct primary-source retrieval and it failed on the format, not
the search**: `WebFetch` was pointed at the OECD's own PDF,
`https://www.oecd.org/content/dam/oecd/en/publications/reports/2025/11/the-2025-update-to-the-oecd-model-tax-convention_c7031e1b/5798080f-en.pdf`
(confirmed to exist via search — title "The 2025 Update to the OECD Model
Tax Convention (EN)"), and separately at a hosted copy of the Article 5
Commentary. **Both returned raw, undecoded PDF stream data instead of
extractable text** — the tool explicitly refused to fabricate quotes from
binary content it could not parse, which is the correct behavior, but it
means **this document cannot cite the OECD's own commentary text verbatim**.
This is an honest gap, not a filled-in approximation.

What follows instead is triangulated across **three independent secondary
professional sources** (a law firm and two accounting-network alerts) that
each quote what they present as the Commentary's actual wording, cross-checked
against Remote.com's own blog (§2.3.1, which is primary for what *Remote*
says, though itself secondary in relaying OECD text). Tagged accordingly —
**none of this is [CONFIRMED] against OECD's own text; it is corroborated
secondary reporting.**

Ashurst Perkins Coie (law firm alert),
`https://www.ashurstperkinscoie.com/en/insights/remote-working-pes-new-oecd-guidance-offers-clearer-thresholds/`
— fetched directly:

> "the requisite continuity to give rise to a PE will not generally be met if
> the individual works from home or other non-business premises for less
> than 50% of their total working time during any rolling twelve month
> period." [secondary source quoting OECD Commentary — not independently
> verified against OECD's own text]

> Commercial reason exists when "The business would actively choose to have
> the individual physically present in their home jurisdiction for its
> activities and, if the home were unavailable for work purposes, would
> provide alternative premises there." [same caveat]

> Notably, for a self-employed principal: "a non resident consultant carrying
> on most of her consulting enterprise's activities from a foreign home
> office for an extended period would have a place of business there (and
> likely a fixed place PE...)." [same caveat] — i.e. the Commentary itself
> reportedly treats a founder/principal differently from a rank-and-file
> employee, echoing what Remote's own blog says in §2.3.1.

EY (Big 4 tax alert), fetched directly:

> "If an individual works from home for less than 50% of his or her total
> working time over 12 months, this is generally not considered a place of
> business." [same caveat — secondary, not OECD's own text]

> Not valid commercial reasons: "allowing an individual to work from home or
> another location solely for employee convenience, talent retention, cost
> savings related to office space, or providing financial support for a home
> office." [same caveat]

> Explicit limitation stated by EY itself: "several jurisdictions have
> expressed reservations about the new Commentary," and "relying solely on
> the new OECD Commentary is not recommended, since OECD member states may
> still apply deviating rules on a local basis." [CONFIRMED as EY's own
> caveat, which is itself a useful data point: even a Big 4 firm summarizing
> this update tells clients not to treat it as uniformly binding.]

#### 2.3.1 Remote.com's own blog restates the same 50% figure

`https://remote.com/blog/eor-peo/remote-work-permanent-establishment-risk` —
fetched directly. Remote.com itself, in its own words, publishes the same
number:

> "If an employee performs 50% or more of their work over any 12-month period
> from their home or regular remote-work location, the risk rises."
> [CONFIRMED, Remote's own words — though Remote is here relaying the OECD
> update, so treat the underlying number itself as secondary-sourced per
> §2.3, while treating "Remote.com publicly endorses/repeats this framework"
> as a first-party [CONFIRMED] fact in its own right.]

> "A PE is more likely to be created if the employee's physical presence in
> that country directly supports or advances the company's business, such
> as: Meeting clients or developing new markets." [CONFIRMED]

> "Remote work granted purely for talent retention or cost-saving reasons
> does not create a commercial reason." [CONFIRMED]

> For founder-led/small companies: an individual's home "is very likely to be
> viewed as the company's place of business, creating a PE by default."
> [CONFIRMED]

**This is a meaningful finding for the project overall**: Remote.com — the
company this portfolio is built against — has already, publicly, adopted the
OECD's rolling-12-month, 50%-of-working-time framing as its own explanatory
model for PE risk. A UC-04 design that talks about "cumulative days in a
rolling window" (as this document's Recommendation does) is directly aligned
with language Remote itself already uses publicly, not an invention of this
research pass.

**Important scoping caveat, stated plainly**: a *workation* is normally a
short, bounded trip (days to a few weeks), while the 50%-of-working-time
test is stated over a **rolling twelve-month period**. A single short
workation essentially never reaches 50% of a year on its own — the risk this
test actually flags is **repeated or extended workations to the same
destination accumulating toward that threshold across many trips**, which is
exactly why §1.2's finding that Remote's own Mobility Team already reviews
"past travel records" (cumulative history) matters more than any single
request's length.

---

## 3. Social security totalization / A1 certificates

### 3.1 A1 certificates (EU/EEA)

`https://europa.eu/youreurope/citizens/work/work-abroad/posted-workers/index_en.htm`
— the EU's own official citizen-facing "Your Europe" portal, fetched
directly.

> "Your employer must request a Portable Document A1 (PD A1 form) from the
> social security institution in your home country." [CONFIRMED]

> "As a posted worker, to continue to be covered by the social security
> system in your home country, your employer must request a Portable
> Document A1 from the social security institution in your home country and
> inform the host country's authorities." [CONFIRMED]

> Validity/duration: "If your posting lasts longer than 2 years, you can
> either: switch to the social security system of the country where you are
> posted or ask your employer to apply for the extension of the validity of
> your social security form posting period to remain covered in your home
> country." [CONFIRMED] — i.e. **the standard maximum posting duration
> covered by a single A1 is 24 months**, with an extension possible only by
> bilateral agreement between the two states' authorities, not unilaterally.

This is directly relevant to UC-04: a workation lasting weeks is nowhere near
the 24-month A1 ceiling, so for EU/EEA-to-EU/EEA workations, A1 coverage is
close to a non-issue in isolation — **but obtaining the certificate itself is
still a required administrative step** ("your employer must request"), so
even a short, low-risk-by-duration workation inside the EU/EEA still has a
process dependency the automation would need to either confirm exists or
flag as missing, not skip because the trip is short.

### 3.2 US totalization agreements

**URL:** `https://www.ssa.gov/international/agreements_overview.html` and
`https://www.ssa.gov/international/status.html` — **both returned
`403 Forbidden` on every direct `WebFetch` attempt in this session, including
retries and a plain `/international/` index fetch.** This is a genuine gap:
SSA.gov is unambiguously the correct primary source, and it could not be
independently fetched at all.

**[fetched via search snippet, not direct WebFetch — 403]**, corroborated
across two independent search queries:

> "The United States has bilateral Social Security agreements with 30
> countries" — Australia, Austria, Belgium, Brazil, Canada, Chile, Czech
> Republic, Denmark, Finland, France, Germany, Greece, Hungary, Iceland,
> Ireland, Italy, Japan, Luxembourg, Netherlands, Norway, Poland, Portugal,
> Slovak Republic, Slovenia, South Korea, Spain, Sweden, Switzerland, United
> Kingdom, and Uruguay. [INFERRED — this list is search-snippet-extracted
> text describing ssa.gov's own page, not a direct quote verified against the
> live page. Treat the count (30) and the general regional split ("23 in
> Europe, 4 in the Americas, 3 in Asia-Pacific," also only snippet-sourced)
> as likely correct but **not independently confirmed by this research pass**
> — a future session with working access to ssa.gov should re-verify the
> exact current list before this number is used as a hard fact anywhere in
> the UC-04 build.]

**Countries with no US totalization agreement** — India, China, Singapore,
the UAE, Mexico, and most of Southeast Asia and Latin America — appeared
consistently across several independent tax-advisory sites in search results
(americansabroad.org, greenbacktaxservices.com, onlinetaxman.com,
alliscpa.com, thecitizenshipdesk.com), **none of which are primary sources**;
they are all third-party tax-advisory commentary. **[INFERRED, not
CONFIRMED]** — flagged exactly as the task instructions require: this is a
claim found only in secondary sources and is being reported as such, not
presented as verified fact. It is directionally very likely correct (it
follows from ssa.gov's own list being closed/enumerated and these countries'
absence from it being widely and consistently reported), but this pass could
not independently verify it against ssa.gov.

**Implication for UC-04, stated carefully**: for a workation from a
US-employment-country employee to a non-agreement country (India, China,
Singapore, UAE, Mexico, most of Latin America/SE Asia per the above), there
is **no bilateral instrument comparable to the EU's A1 covering the
employee's US Social Security contributions against host-country social
tax** — the risk-management value of "does a totalization agreement/A1-style
instrument exist for this specific origin/destination pair" as a gating
question is real and not merely theoretical, but the specific country list
used to answer it in a shipped system should be re-sourced directly from
ssa.gov (or the EU's own portable-document registry for non-US cases) at
build time rather than hardcoded from this document's secondary-sourced
list.

---

## 4. Right-to-work / immigration legality — the separate, more binary gate

### 4.1 Remote.com's own content: right-to-work checks are a distinct process from tax review

`https://support.remote.com/hc/en-us/articles/31105131499789-Remote-s-Right-to-Work-Checks`
— **[fetched via search snippet, not direct WebFetch — 403]**. This article
is written primarily about *onboarding-time* right-to-work verification (does
this new hire have the legal right to work in their country of employment at
all), not workation-specific travel — worth being honest that it is adjacent
context rather than a direct hit on the workation use case:

> Remote conducts right-to-work checks "to verify employees' legal
> eligibility to work in their country of employment, ensuring full
> compliance with local immigration laws." [CONFIRMED per extracted text]

> "For employees working in a country other than their country of nationality
> or usual residence, the Mobility team reviews residence permits and other
> relevant documentation to confirm both legal stay and work authorization."
> [CONFIRMED per extracted text] — this sentence is the one that generalizes
> to travel/workation scenarios: legal stay and work authorization are
> checked as two separate things, matching the tourist-visa-vs-digital-nomad-
> visa distinction found across competitor sources below.

### 4.2 The tourist-visa gap, as described by Deel and Oyster

Deel, `https://www.deel.com/blog/work-remotely-abroad-without-making-tax-and-visa-mistakes/`
— fetched directly:

> "Most countries use a 183-day rule—if you spend more than 183 days in a
> calendar year, you become a tax resident." (tax side) vs. "Tourist visas
> typically don't allow remote work—even if you're working for a company in
> another country." (immigration side) [CONFIRMED, both quoted directly] —
> **Deel's own content states these as two separate rules**, which is direct
> primary-source support for treating tax residency and work-legality as
> independent gates rather than one combined "how many days" question.

> "Incidental remote work for a foreign employer or client may be tolerated
> where it is not the primary purpose of entry and does not involve engaging
> with the local labor market." [CONFIRMED, quoted directly] — Deel's own
> language for the gray zone, phrased cautiously ("may be tolerated"), not as
> a green light.

Oyster, `https://www.oysterhr.com/glossary/digital-nomad-visa` — fetched
directly:

> "A digital nomad visa is a visa that allows remote workers to live and work
> in a foreign country, as long as their employer or business is located
> outside of the host country." Typical duration: "6 months to 5 years."
> [CONFIRMED, quoted directly]

> In contrast, on a tourist visa, "tourists often work in gray legal
> territory." [CONFIRMED, quoted directly, Oyster's own wording]

### 4.3 Enforcement is inconsistent — an honest open nuance

Multiple secondary sources surfaced in search results (not independently
verified as primary, flagged as such) describe real-world enforcement of the
tourist-visa work prohibition as **inconsistent and country-dependent** —
i.e. the *legal* answer ("not permitted") and the *practical/enforcement*
answer ("rarely checked in some popular remote-work destinations") diverge.
**[INFERRED / secondary-sourced, explicitly not to be treated as guidance]**:
this is exactly the kind of nuance that argues for a support-automation
system treating "is this legally authorized" as a binary confirm/deny gate
based on documented authorization (a digital nomad visa, a valid work permit,
a treaty-based exemption) rather than trying to model enforcement risk or
country-specific tolerance — the automation should never reason "usually
nobody checks," only "is there a document that authorizes this."

---

## 5. What competitor EOR/PEO platforms publicly say

Summary table of what was actually found via primary-source pages (own blog/
help center/glossary), with direct-fetch success noted per company.

| Company | Domain(s) checked | Direct WebFetch access | What was found |
|---|---|---|---|
| Deel | deel.com, help.letsdeel.com | Blog: yes. Help center: **no, 403 on all attempts** | Only company found publishing an explicit **numeric internal policy cap**: see §5.1 |
| Oyster | oysterhr.com | Yes, all pages fetched directly | Strong qualitative framing (activity-based risk), no numeric cap found; note the "work from anywhere" content found is about Oyster's *own internal culture as an all-remote employer*, not necessarily a client-facing product limit — see caveat in §5.2 |
| Multiplier | usemultiplier.com | **No, 403 on the specific PE guide and visa-list pages** — content obtained via search snippet | PE risk guide and digital-nomad-visa guide exist and are substantive per snippets, but not independently verified word-for-word |
| Velocity Global | velocityglobal.com (redirects to hellopebl.com — company appears to have rebranded to "Pebl") | Yes, PE page fetched directly after following redirect | Standard PE definitions; **no workation-specific numeric policy found** |
| Papaya Global | papayaglobal.com | **No, 403 on all attempts** — content obtained via search snippet | PE-risk and global-mobility content exists per snippets; role-based dependent-agent framing (§2.2), no numeric duration cap found |

### 5.1 Deel — the one concrete published internal-policy number found in this entire research pass

**URL:** `https://help.letsdeel.com/hc/en-gb/articles/12339073407889-Work-From-Abroad-Policy-for-Deel-EOR-Employees`
**[fetched via search snippet, not direct WebFetch — 403]**, but corroborated
**word-for-word identically across two independent search queries** run
separately in this session, which is meaningfully stronger corroboration than
a single snippet:

> "All employees hired through a Deel Employer of Record may only work from
> abroad for up to 45 business days per calendar year." [CONFIRMED per
> extracted text, corroborated twice]

> "If you want to work from abroad for more than 45 business days (70
> calendar days), you may seek work authorization in your destination
> country and request that your employer hire you through Deel in that
> country." [CONFIRMED per extracted text, corroborated twice]

> "Working from abroad is defined as working from any location outside the
> country in which your contract with a Deel Employer of Record is based and
> settled." [CONFIRMED per extracted text]

> Below the cap: "If you work from abroad for 45 business days or less, your
> benefits, PTO and other entitlements will not be affected." [CONFIRMED per
> extracted text]

This is the clearest real-world example found of exactly what §6 below is
asking about: **a real EOR publishing a specific, conservative, internal
administrative threshold (45 business days / 70 calendar days per calendar
year) as company policy — explicitly not framed as a claim about when any
specific country's tax law actually triggers**, and with a defined escalation
path once exceeded (seek local work authorization and get hired through a
local Deel entity instead).

**Open nuance**: this document could not directly confirm this figure against
Deel's own page due to the 403 — it rests on two independent, identically-
worded search-engine extractions of the same URL, which is good but not the
same as an independent fetch. It should be treated as very likely accurate,
not as fully verified.

### 5.2 Oyster — qualitative framing, no number, and a scope caveat

Oyster's `work-from-anywhere` content (`oysterhr.com/glossary/work-from-anywhere`,
`oysterhr.com/how-it-works/work-from-anywhere-jobs`) reads largely as
marketing/culture copy about **Oyster's own hiring practices as an
all-remote company** ("Oyster is a borderless, HQ-less company where
employees can work from anywhere") rather than a specific compliance policy
offered to Oyster's *EOR clients'* employees. **[CONFIRMED as content found]**,
but flagged **[INFERRED]** that this is describing Oyster's internal culture
rather than a client-facing product feature — the two are easy to conflate
and this document is deliberately not doing so. The `workation` glossary
page (§2.2, §4.2), by contrast, reads as genuine client-facing compliance
guidance and is the more reliable source of the two for this project's
purposes.

### 5.3 Multiplier, Velocity Global/Pebl, Papaya Global

All three publish general PE-risk and/or digital-nomad-visa explainer content
(§2.2, §4). **None of the three was found, in this pass, to publish a
specific numeric internal duration threshold** the way Deel does — their
content stays at the level of "duration and activity both matter, consult
us," without committing to a number. This is itself a finding worth stating
plainly: **Deel appears to be the outlier in publishing a hard number; the
more common public posture among these EORs is to describe the risk
qualitatively and route the customer into a compliance conversation rather
than publish a self-service threshold.**

---

## 6. Industry practice on duration thresholds — direct answer to the question asked

Pulling together everything above into a direct answer:

**Only one primary source found in this pass publishes a specific, named,
numeric internal-policy duration threshold as an EOR's own stated policy for
its own EOR employees**: **Deel's 45 business days / 70 calendar days per
calendar year** (§5.1), explicitly framed as an internal administrative
policy with a defined escalation path (seek local authorization, get hired
through a local entity) rather than as a claim about the legal trigger point
in any specific country.

Remote.com's own published process (§1) deliberately does **not** publish a
duration cap at all — its public materials describe a case-by-case Mobility
Team review (nationality, home-country absence rules, travel history,
required visa type, and planned job duties) with only a *lead-time*
requirement (3–8 weeks before departure) stated numerically, not a *stay
duration* cap.

The other four competitors checked (Oyster, Multiplier, Velocity Global/Pebl,
Papaya Global) publish qualitative "duration and activity both matter, talk
to us" framing without committing to a specific number in any primary-source
page reached in this pass.

**Numbers that appeared in search results but are explicitly excluded from
this document as unreliable**: several generic HR/aggregator sites (not
tied to a named EOR's own policy) floated round numbers like "30 days" or
"90 days" as generic industry norms. These are **not attributed to any
specific company's own published policy** in what this pass found, only to
secondary aggregator commentary, and per this task's own instructions they
are excluded here rather than reported as fact. If a specific number like
"30 days" needs to be justified for UC-04, it should not be sourced to this
document.

---

## Recommendation for UC-04 automation design

Every claim in this section is [PROPOSED] — synthesis based on the six areas
above, not sourced fact in its own right.

**Do not build a single duration-threshold gate.** [PROPOSED] Nothing found
in this pass supports one universal cutoff, and several primary sources
actively argue against it: Remote's own process explicitly reviews per-case
factors instead of a day count (§1.2); the OECD's own 2025 framework is a
*percentage of a rolling twelve-month period* combined with a *separate*
commercial-reason/role test, not a flat day cap (§2.3); Deel is the one EOR
that does publish a flat number, and even Deel frames it as an
administrative convenience threshold with an escalation path, not a legal
safe harbor (§5.1); and Oyster's own words state plainly that duration and
"how business-like the activity is" are two separate multipliers on risk,
not one variable (§2.2). This project's own prior research already reached
the same conclusion before this pass began; this pass's job was to check
whether new evidence changed that, and it does not — it reinforces it, with
better sourcing.

**Proposed independent gating dimensions** — a request should need all of
these confirmed before any auto-decision path is even considered, and the
system should never try to collapse them into one score:

1. **Destination-country coverage status** — does a totalization/A1-style
   instrument or tax treaty exist between the employment country and the
   destination for this specific pair (§3)? This is a lookup against a
   maintained table (sourced at build time directly from ssa.gov and the
   EU's own portable-document framework, not from this document's
   secondary-sourced country list — see the open gap noted in §3.2), not
   something an LLM should infer or guess at from general knowledge.

2. **Role/activity PE-sensitivity category** — does the employee's role
   involve contract-signing authority, active sales/deal-closing, executive
   decision-making, or being the substantial majority of the business's
   activity (founder/sole-operator case, §2.3.1)? If yes to any, this
   dimension alone should be sufficient to force escalation regardless of
   trip length, per §2.2's consistent "activity type independently raises
   risk" finding across three sources. Roles without contract/negotiation
   authority (most engineering, support, and individual-contributor roles)
   sit in a lower-sensitivity band — but "lower" should still not mean
   "auto-approve," only "eligible to be evaluated against the other
   dimensions" — the OECD's own commercial-reason test in §2.3 doesn't
   exempt any role category outright, it just makes non-sales roles less
   likely to fail it.

3. **Cumulative days in a rolling window, not just this trip's length** —
   directly modeled on Remote's own confirmed practice of checking "past
   travel records" (§1.2) and the OECD's own rolling-twelve-month framing
   (§2.3). A short trip that looks trivial in isolation can be the request
   that pushes a rolling total over a meaningful threshold; the system needs
   the employee's trip history to this and other destinations, not just the
   current request's dates.

4. **Immigration/right-to-work legality, confirmed as a document, not
   inferred as a probability** — per §4, this is a *separate, more binary*
   gate from the tax/PE questions above: is there a specific visa, permit,
   or documented exemption that authorizes paid remote work from this
   location for this trip? Per §4.3, the system must never reason from
   enforcement patterns ("this destination doesn't usually check") — only
   from the presence or absence of a specific authorizing document, exactly
   the same "fails closed on any missing piece" identity-verification
   pattern this project's own prime directive #3 already applies elsewhere
   (UC-01's identity gate).

5. **Lead time** — the one number Remote's own process does publish (3–8
   weeks, §1.1) is an operational constraint on when the Mobility Team can
   realistically complete the other four checks, not a risk gate in itself.
   A request submitted inside that window is a signal the case needs
   expedited human handling, not that any of the above dimensions can be
   skipped.

**The gate, stated plainly**: if any one of dimensions 1–4 cannot be
confirmed with high confidence — the coverage table has no entry for this
country pair, the role classification is ambiguous, the travel history is
incomplete, or no specific authorizing document is on file — **the system
escalates to a human specialist rather than guessing**, exactly matching this
project's prime directive #1 (LLMs interpret, deterministic code decides,
and nothing ambiguous reaches a gate unvalidated). Given how much of §§2–4
above turned out to hinge on judgment calls even the primary sources
themselves hedge on (Remote's own "case-by-case" framing; EY's own warning
not to rely solely on the OECD Commentary; the enforcement-vs-legality gap
in §4.3), UC-04 reads, on this evidence, as a **weak candidate for any
🟢-tier auto-approval path at all** — even a workation request that clears
all four dimensions cleanly is still touching tax, immigration, and
corporate-tax-nexus consequences for the employer, which argues for treating
UC-04 at minimum as 🟡 (AI prepares + risk-scores, human approves) and quite
plausibly as 🔴 for any request that fails dimension 2 or 4 outright, rather
than as a use case where automation should ever resolve a request
unassisted. That tiering decision is this document's opinion, not something
this pass's sources state directly — flagged as [PROPOSED] for that reason,
consistent with the rest of this section.

---

## Sources

Fetched directly with WebFetch and used as primary evidence:

- `https://remote.com/blog/remote-work/authorization-for-remote-work` — Remote's own blog: the 5-factor Mobility Team review, no numeric duration cap, cumulative travel-history checking confirmed (§1.2)
- `https://developer.remote.com/reference/get_v1_travel-letter-requests.md` — Travel Letter Request API: endpoint, query params, response shape (§1.3)
- `https://developer.remote.com/reference/get_v1_travel-letter-requests_id.md` — full object schema for a single travel letter request (§1.3)
- `https://developer.remote.com/reference/patch_v1_travel-letter-requests_id.md` — update endpoint, two-stage approval confirmed, only two allowed transitions from `pending` (§1.3)
- `https://developer.remote.com/reference/travel_letterrequested.md` — webhook event description (§1.3)
- `https://developer.remote.com/docs` — Getting Started page checked for workation-adjacent content; none found (§1, ruled out)
- `https://europa.eu/youreurope/citizens/work/work-abroad/posted-workers/index_en.htm` — EU official portal: A1 certificate process and 24-month validity ceiling (§3.1)
- `https://remote.com/blog/eor-peo/what-is-permanent-establishment` — Remote's own PE explainer: fixed-place and dependent-agent tests (§2.1)
- `https://remote.com/blog/eor-peo/remote-work-permanent-establishment-risk` — Remote's own restatement of the OECD 50% rolling-12-month framework (§2.3.1)
- `https://www.ashurstperkinscoie.com/en/insights/remote-working-pes-new-oecd-guidance-offers-clearer-thresholds/` — law-firm secondary source quoting the OECD's November 2025 Article 5 Commentary update (§2.3)
- `https://www.ey.com/en_ch/technical/tax-alerts/oecd-2025-update-new-rules-on-permanent-establishment-for-remote-work` — Big 4 secondary source, same OECD update, includes EY's own caveat against relying solely on it (§2.3)
- `https://hellopebl.com/blog/what-is-permanent-establishment` — Velocity Global (rebranded "Pebl"): PE definitions, no workation-specific numeric policy (§5, §2.1)
- `https://www.oysterhr.com/glossary/workation` — Oyster's own glossary: activity-type-raises-risk framing, no numeric cap (§2.2, §6)
- `https://www.oysterhr.com/glossary/digital-nomad-visa` — Oyster's own glossary: digital nomad visa vs. tourist visa distinction (§4.2)
- `https://www.deel.com/blog/work-remotely-abroad-without-making-tax-and-visa-mistakes/` — Deel's own blog: explicit statement that tax-residency and work-legality are two separate rules (§4.2)
- `https://www.deel.com/blog/work-from-anywhere-how-to-create-a-compliant-policy/` — Deel's own blog: general WFA compliance guidance, UK 183-day example, no universal duration cap stated here (§5)

Fetched via `WebSearch` result-snippet extraction of a specific primary URL,
because direct `WebFetch` to that URL returned `403 Forbidden` in every
attempt this session — cited as that URL's content per the search engine's
own extraction, not as an independently verified fetch (see the note at the
top of this document):

- `https://support.remote.com/hc/en-us/articles/37802834593805-Remote-Work-Authorization-What-it-is-and-How-to-request-it` — "Workation" terminology, 3–8 week lead time, two-stage review (§1.1)
- `https://support.remote.com/hc/en-us/articles/31105131499789-Remote-s-Right-to-Work-Checks` — right-to-work checks as distinct from tax review (§4.1)
- `https://help.letsdeel.com/hc/en-gb/articles/12339073407889-Work-From-Abroad-Policy-for-Deel-EOR-Employees` — the 45-business-day / 70-calendar-day figure, corroborated across two independent search queries (§5.1)
- `https://www.papayaglobal.com/blog/9-global-mobility-tax-issues/` — sales/executive role PE-risk framing (§2.2)
- `https://www.usemultiplier.com/global-expansion/guide-to-permanent-establishment-old` — dependent-agent frequency/negotiation framing (§2.2)
- `https://www.ssa.gov/international/agreements_overview.html` — the "30 countries" figure and country list; **not independently confirmed, flagged in §3.2 as needing re-verification**

Checked and found **dead or inaccessible** — noted for the record so a future
pass doesn't retrace these steps:

- `https://support.remote.com/hc/en-us/articles/*` (all articles) — `403 Forbidden` to direct `WebFetch`, every attempt
- `https://help.letsdeel.com/hc/en-gb/articles/*` (all articles) — `403 Forbidden` to direct `WebFetch`, every attempt
- `https://www.ssa.gov/international/*` (every page tried: `/`, `/agreements_overview.html`, `/agreement_descriptions.html`, `/status.html`, `/totalization_agreements.html`) — `403 Forbidden` to direct `WebFetch`, every attempt
- `https://www.ssa.gov/oact/NOTES/pdf_notes/note164.pdf` — `403 Forbidden`
- `https://www.oecd.org/content/dam/oecd/en/publications/reports/2025/11/the-2025-update-to-the-oecd-model-tax-convention_c7031e1b/5798080f-en.pdf` — fetched (200) but returned undecoded PDF binary/font-stream data, not extractable text; not usable as a quotable source through this tool
- `https://tayros.bg/wp-content/uploads/2021/03/COMMENTARY-ON-ARTICLE-5-OF-THE-MODEL-TAX-CONVENTION.pdf` — same binary-PDF problem
- `https://www.un.org/esa/ffd/wp-content/uploads/2019/04/18STM_CRP8-Update-UN-Model-Double-Taxation_Permanent-Establishment.pdf` — same binary-PDF problem
- `https://www.usemultiplier.com/blog/39-countries-offering-remote-work-visas` — `403 Forbidden`
- `https://www.papayaglobal.com/blog/how-to-avoid-permanent-establishment-risk/` — `403 Forbidden`
- `https://www.papayaglobal.com` (site-wide) — every specific article URL tried returned `403`; only search-snippet-level content was obtainable
- `site:g-p.com` / `site:globalization-partners.com` — no G-P/Globalization Partners primary-source page with substantive workation or PE-specific content was surfaced by search in this pass; **no G-P claim appears anywhere in this document** because none could be sourced — this is an honest coverage gap, not an oversight
