# D-42 · Ireland — minimum notice, Minimum Notice and Terms of Employment Act 1973, ss. 4 and 6 · **RETRIEVED 2026-09-02**

| | |
|---|---|
| **Catalogue id** | D-42 (`docs/knowledge/DOWNLOAD-MANIFEST.md`) — added by the 2026-09-02 employee-notice pass |
| **Source name** | **Minimum Notice and Terms of Employment Act 1973 (No. 4 of 1973)**, **section 4** (*Minimum period of notice*), **section 6** (*Right of employer to notice*), with **section 3** (*Non-application of Act*) and **section 7** (*Right to waive notice*) read for scope. Retrieved in **both** forms: the *as enacted* text from the Irish Statute Book, and the **Revised Act** maintained by the Law Reform Commission. |
| **Publisher / authority** | *As enacted*: **Office of the Attorney General**, `irishstatutebook.ie`. *Revised*: **Law Reform Commission**, `revisedacts.lawreform.ie`. |
| **Exact URL** | <https://www.irishstatutebook.ie/eli/1973/act/4/section/4/enacted/en/html> · <https://www.irishstatutebook.ie/eli/1973/act/4/section/6/enacted/en/html> · <https://revisedacts.lawreform.ie/eli/1973/act/4/revised/en/html> |
| **Retrieved** | **2026-09-02**, by `curl` with a browser header set. HTTP 200 for all three: **31,521** / **28,487** / **135,519** bytes as stored (decoded entity bodies). Sections 2 and 3 were fetched in the same pass (28,112 and 31,681 bytes) and are quoted below but not committed — the Revised Act carries both. |
| **SHA-256 of the retrieved bytes** | `33917d2845507b701d54a27f16b0be30a942657c9ff3e9b37dd25505d0c06be8` (s. 4) · `3975ce5d49388139b6372c3340cea8c101d5b6f249d3df1addfa48c01520be54` (s. 6) · `ff3ae12151977637e4799f36e20a8e198b7472d8c77a8aa32f68631bf8f7ab4e` (Revised Act). Committed at [`sources/D-42-ie-minimum-notice-1973-s4.html`](sources/D-42-ie-minimum-notice-1973-s4.html), [`…-s6.html`](sources/D-42-ie-minimum-notice-1973-s6.html), [`…-revised.html`](sources/D-42-ie-minimum-notice-1973-revised.html). |
| **Source `updatedAt`** | Act of **9 May 1973**. The Revised Act prints its own currency line: **"REVISED — Updated to 14 October 2020."** **ss. 4 and 6 are word-for-word identical in the enacted and revised texts** — checked side by side, and the point of retrieving both. |
| **Licence / basis for inclusion** | **OIREACHTAS (OPEN DATA) PSI LICENCE**, read live at <https://www.irishstatutebook.ie/eli/open-data.html> (2026-09-02): *"Re-use of the data on this web site is subject to the OIREACHTAS (OPEN DATA) PSI LICENCE, which is a standard licence for the purposes of Directive (EU) 2019/1024 … This licence **incorporates the Creative Commons Attribution 4.0 International License** for the re-use of Public Sector Information."* Footer: *"© Government of Ireland. Oireachtas Copyright Material is reproduced with the permission of the Houses of the Oireachtas."* **Bytes committed**, attributed, unaltered. |
| **Evidence tag** | `[CONFIRMED — statute, retrieved 2026-09-02]` |

## The two sections, side by side — which is the whole point of this document

> **Section 4 · Minimum period of notice**
>
> **4.—(1)** **An employer** shall, in order to terminate the contract of
> employment of an employee who has been in his continuous service for a period
> of **thirteen weeks or more**, give to that employee a minimum period of notice
> calculated in accordance with the provisions of subsection (2) of this section.
>
> **(2)** The minimum notice to be given **by an employer** to terminate the
> contract of employment of his employee shall be—
> **(a)** if the employee has been in the continuous service of his employer for
> less than two years, **one week**,
> **(b)** … two years or more, but less than five years, **two weeks**,
> **(c)** … five years or more, but less than ten years, **four weeks**,
> **(d)** … ten years or more, but less than fifteen years, **six weeks**,
> **(e)** … fifteen years or more, **eight weeks**.
>
> **(3)** The provisions of the **First Schedule** to this Act shall apply for the
> purposes of ascertaining the period of service of an employee and whether that
> service has been continuous.
>
> **(5)** Any provision in a contract of employment … which provides for a period
> of notice which is **less** than the period specified in subsection (2) … shall
> have effect as if that contract provided for a period of notice in accordance
> with this section.

> **Section 6 · Right of employer to notice**
>
> **6.—** An employer shall, subject to the right of an employee to give
> counter-notice under section 10 of the Act of 1967 or to give notice of
> intention to claim redundancy payment in respect of lay-off or short-time under
> section 12 of that Act, be entitled to **not less than one week's notice from an
> employee who has been in his continuous employment for thirteen weeks or more**
> of that employee's intention to terminate his contract of employment.

And the waiver, which applies to both directions:

> **Section 7 · Right to waive notice**
>
> **7.—(1)** Nothing in this Act shall operate to prevent an employee or an
> employer from **waiving his right to notice on any occasion or from accepting
> payment in lieu of notice**.

## What this settles for `src/uc05/noticePeriodTable.js`

`NOTICE_PERIOD_TABLE.IE` today reads
`[{0–2 months → 0 days}, {3+ months → 7 days}]`, `probation: null`,
`anchorRule: "continuous"`, and cites
**"Minimum Notice and Terms of Employment Act 1973 §4"**.

**The number is right and the citation is wrong**, and that combination is worth
saying out loud because it is the one case in this pass where the defect cannot
be found by looking at the output:

| Question | Answer |
|---|---|
| Is the employee's obligation one week? | **Yes — s. 6.** The `7` is correct. |
| Does §4 say so? | **No.** §4 is titled *Minimum period of notice* and every obligation in it runs **from the employer**, on a 1/2/4/6/8-week ladder. §6 is titled *Right of employer to notice* and is the employee's obligation. **The two titles read as if they were swapped**, which is exactly how a table gets built from the wrong one. |
| Is the qualifying period three months? | **No — thirteen weeks**, in both sections. |
| Is the unit right? | The statute says *"one week"*. `7` calendar days is a faithful rendering **only if** weeks are counted as calendar weeks; the First Schedule governs the service computation, not the notice unit. |

**Ireland is the near-miss of this pass, and it is the most instructive row.** The
UK row (**C-31**) encodes the employer's ladder and computes visibly wrong
numbers. Ireland encodes the *right* number under the *wrong* citation, so every
test passes, every output is correct, and the only artefact of the error is a
string nobody diffs. Had the Irish employer's ladder been copied instead — as the
UK's was — a fifteen-year Irish employee would be told they owe eight weeks
against a statutory one. **The same mistake was available in both countries; it
was made in one of them.** Recorded as [`CONTRADICTIONS.md`](CONTRADICTIONS.md)
**C-32**.

### The boundary, which is a real off-by-one

Thirteen weeks is **91 days ≈ 2.99 months**. The table's brackets split at whole
months: `tenureMaxMonths: 2 → 0 days`, `tenureMinMonths: 3 → 7 days`. An employee
at exactly thirteen weeks' continuous service therefore falls in the **first**
bracket and is told they owe **nothing**, where s. 6 says one week. It errs in
the employee's favour rather than against them — the mirror image of **C-18**,
the Portuguese boundary that was off by one against the employee — and it is the
same defect: **a statutory threshold stated in weeks, re-expressed in months, and
rounded the wrong way.**

## Two scope conditions the table cannot express

1. **s. 3(1)(a) — the Act does not apply below eighteen hours a week.** The
   enacted text said *twenty-one hours*; the Revised Act shows it **substituted
   to "eighteen hours"** (30.11.1984, Protection of Employees (Employers'
   Insolvency) Act 1984 s. 13(a)), and then **restricted** (20.12.2001) by the
   Protection of Employees (Part-Time Work) Act 2001 s. 8, which applies each
   relevant enactment to a part-time employee *"in the same manner"* as to any
   other. So the hours threshold survives on the face of s. 3 and is displaced in
   practice by the 2001 Act. **A part-time EOR engagement is exactly the case
   where this matters**, and the table has no hours field. Recorded under
   **C-32**.
2. **s. 7 — waiver and payment in lieu**, as in the UK (**D-41**), the
   Netherlands (**C-14**) and Portugal (**D-02**). Four for four: in every
   country this corpus has now read, the employee's statutory notice is a
   **default the parties may displace**, and the table reports it as a fixed
   entitlement.

## What is still open

- **The First Schedule (computation of continuous service) was not retrieved.**
  Same gap as ERA 1996 ss. 210–219 in D-41 and CT art. 113.º(2) in D-03.
- **s. 6's cross-references to the Redundancy Payments Act 1967** (ss. 10 and 12)
  were not followed. They carve out counter-notice during a redundancy process —
  a situation in which an employee's notice is governed elsewhere entirely.
