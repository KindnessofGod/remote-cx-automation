# D-16 · Canada — working without a work permit, IRPR ss. 186 and 187

| | |
|---|---|
| **Catalogue id** | D-16 (`docs/knowledge/DOWNLOAD-MANIFEST.md`) · L1-07 (`docs/KNOWLEDGE-SOURCES.md` §4) |
| **Source name** | Immigration and Refugee Protection Regulations, SOR/2002-227, **sections 186 and 187** |
| **Publisher / authority** | **Department of Justice Canada**, Justice Laws Website |
| **Exact URL** | <https://laws-lois.justice.gc.ca/eng/regulations/sor-2002-227/section-186.html> and <https://laws-lois.justice.gc.ca/eng/regulations/sor-2002-227/section-187.html> |
| **Retrieved** | **2026-08-19**, by `curl`. HTTP 200 for both — **63615 bytes** and **55864 bytes** as stored. Saved at [`sources/D-16-ca-irpr-s186.html`](sources/D-16-ca-irpr-s186.html) and [`sources/D-16-ca-irpr-s187.html`](sources/D-16-ca-irpr-s187.html). |
| **SHA-256 of the retrieved bytes** | s.186: `edd0b7bdc62a51f45e17826153d8d33132da00e021a65c42b69b38d1e3fff579` · s.187: `ffada739591a5e783bfbb0a38c9a01005f110d52924275be92a706cb67cc7631` |
| **Source `updatedAt`** | **"Regulations are current to 2026-06-17 and last amended on 2026-06-12."** |
| **Licence / basis for inclusion** | **Reproduction of Federal Law Order, SI/97-5.** Bytes committed. IRCC's own operational guidance page is a canada.ca page and is **not** vendored — see the note below. |
| **Evidence tag** | `[CONFIRMED — regulation, retrieved 2026-08-19]` |

> **Disclaimer required by SI/97-5.** Reproduction of a Government of Canada
> enactment. **Not the official version.**

## The two provisions

> **186** A foreign national may work in Canada **without a work permit** (a) as
> a **business visitor** to Canada within the meaning of section 187; …
>
> *(paragraphs (b) through (w) then list some two dozen further categories —
> foreign representatives, performing artists, athletes, news correspondents,
> guest speakers, clergy, examiners, expert witnesses, crew, emergency service
> providers, and others. The list is in the committed bytes.)*

> **187 (1)** For the purposes of paragraph 186(a), a **business visitor** to
> Canada is a foreign national who is described in subsection (2) or who seeks to
> engage in international business activities in Canada **without directly
> entering the Canadian labour market**.
>
> **(3)** For the purpose of subsection (1), a foreign national seeks to engage
> in international business activities in Canada without directly entering the
> Canadian labour market **only if** (a) **the primary source of remuneration
> for the business activities is outside Canada**; and (b) **the principal place
> of business and actual place of accrual of profits remain predominately
> outside Canada**.

## What this settles, and what it contradicts

`src/uc04/riskMatrix.js` carries
`if (destinationCountry === "CA" && visaType !== VISA_TYPES.work_permit)` →
`ca_requires_work_permit`, a hard **`blocked`**. With Canada in the demo set
that rule fires on every NL→CA, PT→CA and US→CA scenario.

Section 186 is the regulation the rule needs to be checked against, and
s. 187(3) is the closest thing in Canadian law to a **test a workation could
actually be measured by** — two conditions, both about where the money comes
from and where the business is, neither of which the code asks. Whether a
particular remote-work trip meets it is a judgement, not a lookup; that is why
this belongs in the corpus and not in a conditional. The finding is
[`CONTRADICTIONS.md`](CONTRADICTIONS.md) **C-5**.

> **IRCC's guidance page was not retrieved.** The manifest's URL
> (`.../work-canada/work-without-permit.html`) is dead: the closest live path,
> `https://www.canada.ca/en/immigration-refugees-citizenship/services/work-canada/permit/temporary/work-without-work-permit.html`,
> returned **HTTP 404** on 2026-08-19. `www.canada.ca` itself is reachable, so
> this is a moved page rather than a blocked host. The regulation above is the
> authority in any case; the guidance would only have been context.
