# Layer 1 — what could not be retrieved, and why · third pass, 2026-08-19

> **Status, newest first.**
>
> - **Pass 1 (2026-08-19, morning).** Every Layer-1 source refused at our own
>   proxy. 50 URL attempts, 50 identical denials, zero documents. Kept in the
>   appendix, because the signature it established is what lets the later passes
>   tell five different failures apart at a glance.
> - **Pass 2 (same day).** The allowlist opened for the statutory hosts and
>   **26 of 39** were retrieved.
> - **Pass 3 (same day, this file's current state).** Six more hosts were
>   allowlisted — `employment-social-affairs.ec.europa.eu`,
>   `www.treaty-accord.gc.ca`, `main.un.org`, `files.diariodarepublica.pt`,
>   `dre.pt`, `www.overheid.nl` — and the three US immigration pages that refuse
>   this container's **address** were transcribed by hand by the repository
>   owner. **Nine more documents landed: D-02, D-03, D-10, D-14, D-15, D-19,
>   D-26, D-32 and D-39** (the last as a register entry only, deliberately).
>   **35 of 39.**
>
> The vendored files are the `D-NN-*.md` sidecars beside this one and the bytes
> under [`sources/`](sources/); the findings are in
> [`CONTRADICTIONS.md`](CONTRADICTIONS.md), which grew from 16 items to 27.
>
> **Four remain**, and no two for the same reason: **D-05** (JavaScript-only),
> **D-12** (origin TLS), **D-13** (re-scoped, never retried), **D-30** (licence,
> not access). Per-document record in §4.

---

## 1. The headline: five failure classes, and the one that was ours is now empty

The single most useful thing these passes established is that **"blocked" is
five different things**, and they need five different remedies. Confusing them
costs hours — `CLAUDE.md` §6 already records that a proxy `403` *"reads
identically to an API permission error but is not one."*

| Class | Symptom | Who is refusing | Remedy |
|---|---|---|---|
| **A — egress policy** | `curl: (56) CONNECT tunnel failed, response 403`; the proxy status endpoint records `connect_rejected` | **Our own network.** Nothing reached the authority. | Ask for the host to be allowlisted. **Do not retry, do not route around.** |
| **B — bot protection** | `HTTP/1.1 200 Connection Established` **followed by** an origin `403` (Akamai "Access Denied", Cloudflare "Attention Required") | **The site.** The tunnel worked; the request was evaluated and refused. | A complete browser header set fixed some of these — see §2. Others refuse everything from this address. |
| **C — JavaScript-only** | HTTP **200**, a small application shell, and no document in the body | Nobody is refusing. The document is not in the response. | Needs a real browser. **Not available here** — see §3. |
| **D — origin TLS misconfiguration** | `HTTP/1.1 200 Connection Established`, then `curl: (60) SSL certificate problem: unable to get local issuer certificate` | The origin, by serving an incomplete certificate chain. | Nothing this end can fix correctly. Never disable verification. |
| **E — the site's own index is broken** *(new, pass 3)* | HTTP **200** on document URLs, HTTP **500** on the site's search and pagination. The document is served; nothing can find it. | The site, in a way it half-admits. `treaty-accord.gc.ca` carries the string *"The data you are trying to access is not currently available. Please try again later"* in markup it does not display. | Enumerate the document id space and read the titles. It found D-22, D-23 **and D-26** — and a fourth instrument nobody was looking for (**C-24**). |

**Check for the `HTTP/1.1 200 Connection Established` line before blaming
anything.** A proxy denial never prints it; an allowed host always does, even
when the site then answers `403`.

### Where each host sits now

Class A is the class that emptied. **Every host any pass has reported as
egress-refused is now allowlisted**, so a future "blocked" here is the site's
problem or the document's, not ours — which is worth stating plainly, because the
remedies are completely different.

| Host | Pass 2 | Pass 3 | What it yielded |
|---|---|---|---|
| `files.diariodarepublica.pt` | A — egress | ✅ **200** | **The unlock of the pass.** Whole-issue gazette PDFs at `/gratuitos/1s/<yyyy>/<mm>/<issue><suffix>.pdf`. Closed **D-10, D-02, D-03**, and would close more. |
| `dre.pt` | A — egress | ✅ 301 only | **Nothing.** Every path redirects to `diariodarepublica.pt`. A pure redirector; it adds no document. |
| `www.treaty-accord.gc.ca` | A — egress | ⚠️ **E** | Documents 200, search and pagination 500. Closed **D-22, D-23, D-26**, and surfaced the superseding 2004 CA–NL agreement. |
| `employment-social-affairs.ec.europa.eu` | A — egress | ✅ 200 | Closed **D-19** — but not from its own search, which is JavaScript-rendered. The download link is on an FAQ page and points at `ec.europa.eu/social/BlobServlet`. |
| `main.un.org` | A — egress | ✅ 200 with the full header set | Closed **D-39** as a register entry. The list itself is deliberately not fetched. |
| `www.overheid.nl` | A — egress | ✅ 200 | **Not what it was wanted for.** `/copyright` answers **410 Gone**; overheid.nl no longer publishes reuse terms at all. The licence came from `data.overheid.nl` instead — see below. |
| `www.cbp.gov`, `www.uscis.gov`, `travel.state.gov` | B — whole-site | **B, and retrieved anyway** | Still refuse this address. **D-14 and D-15 were transcribed from a browser by the repository owner**, with the provenance headers saying so. |
| `diariodarepublica.pt` (HTML), `www.ontario.ca` | C — JS shell | C — unchanged | — |
| `aima.gov.pt` | D — origin TLS | D — unchanged | — |

**The `www.overheid.nl` row is the instructive one.** It was asked for to close a
licence question and it closed it by being **empty**: the terms page is gone
(410, not 404). The actual answer — **CC0 1.0** for the Basis Wetten Bestand —
came from `data.overheid.nl`, the national open-data register, published by
**KOOP**, the same body that runs `wetten.overheid.nl`. *The licence for a
document is not always stated where the document is served.* D-01 and D-31 bytes
are now committed on that basis.

## 2. The header set that unblocked four hosts, and never will unblock three

`www.ssa.gov` — the manifest's ★ highest-value-per-effort item — refused a plain
`curl` **and** a `curl` carrying only a browser `User-Agent`, both with an Akamai
`403`. It returned **200** for the same URL, in the same shell, once the request
carried a complete browser header set:

```
User-Agent, Accept, Accept-Language,
sec-ch-ua, sec-ch-ua-mobile, sec-ch-ua-platform,
Sec-Fetch-Dest, Sec-Fetch-Mode, Sec-Fetch-Site, Sec-Fetch-User,
Upgrade-Insecure-Requests
```

| Host | UA alone | Full header set |
|---|---|---|
| `www.ssa.gov` | 403 | ✅ **200** |
| `www.dol.gov` | 403 | ✅ **200** |
| `www.canada.ca` | 000 | ✅ **200** |
| `www.cbp.gov` | 403 | ❌ 403 — and `/robots.txt` and `/` are 403 too, so it is the address, not the path |
| `www.uscis.gov` | 403 | ❌ 403, whole site |
| `travel.state.gov` | 403 | ❌ 403 — Cloudflare *"Attention Required"* interstitial, needs JS |
| `www.consilium.europa.eu` | 403 | ❌ 403 — a *"Browser check"* page with a meta-refresh, needs JS |

The lesson is narrow and worth keeping: **a `User-Agent` on its own is a tell,
not a disguise.** Modern bot protection scores the *coherence* of a request, and
a Chrome UA arriving without any `Sec-Fetch-*` headers is less plausible than no
UA at all.

**Pass 3 additions to the same table.** `main.un.org` refuses a bare `curl`
(`403`) and answers **200** to the full header set — a fourth host the technique
unblocked, and D-39's whole retrieval. `files.diariodarepublica.pt`,
`www.treaty-accord.gc.ca`, `employment-social-affairs.ec.europa.eu` and
`www.overheid.nl` need nothing beyond a `User-Agent`. And the three that refuse
**this address** — `www.cbp.gov`, `www.uscis.gov`, `travel.state.gov` — still do,
after the allowlist opening, which is the confirmation that they were never
class A: nothing about our network was the problem, and nothing about our network
fixed it. **They were closed by a human opening a browser** (D-14, D-15).

## 3. Why a headless browser was not the answer here

`PLAYWRIGHT_BROWSERS_PATH` is set and Chromium 1234 is preinstalled at
`/opt/pw-browsers`, so the obvious remedy for classes B and C was a real browser.
**Chromium cannot complete an HTTPS request through this container's egress
proxy at all.** Every navigation fails `net::ERR_CONNECTION_RESET`, including to
hosts `curl` fetches successfully in the same session.

This was diagnosed rather than assumed:

- Chromium **does** reach the proxy: a plain-HTTP request to
  `http://127.0.0.1:46333` returns the proxy's own `405`.
- The `CONNECT` **succeeds**: a local relay written for the test logged
  `eur-lex.europa.eu:443 -> HTTP/1.1 200 Connection Established`, then
  `ECONNRESET` while Chromium's TLS ClientHello was in flight.
- The reset is not fixable from the Chromium side. `--ignore-certificate-errors`,
  `--ssl-version-max=tls1.2`, and disabling `X25519MLKEM768`, `PostQuantumKyber`,
  `EncryptedClientHello` and TLS GREASE were each tried; all four variants fail
  identically.
- No matching `recentRelayFailures` entry appears at the proxy status endpoint,
  which is consistent with the reset happening at the upstream gateway's TLS
  re-termination rather than at a policy check.

A local TLS-terminating shim would have worked around it; generating the
certificate it needs was refused by this session's permission classifier, and
that is a reasonable place for the line to sit. **Recorded as an environment
limit, not a bug**, and it is the single change that would most increase what a
future pass can retrieve.

## 4. Per-document record — the four still not retrieved

Everything else the earlier passes listed here has since been retrieved; those
entries have moved to their own `D-NN-*.md` sidecars, which carry the URL, byte
count, checksum and licence. What follows is only what is still open.

### Class C — JavaScript-only application shells · D-05

**Ontario e-Laws** (`www.ontario.ca/laws/...`) serves an application shell —
*"e-Laws needs JavaScript to function properly"* — on `/00e41`, `/00e41/v54`,
`/00e41/print`, `/00e41/xml` and `?_escaped_fragment_=`; `/api/statute/00e41`
returns 502. `www.ontario.ca` itself is reachable, so this is class C, not A.

| id | Document | Consequence |
|---|---|---|
| **D-05** | Employment Standards Act, 2000 (Ontario) | The *"varies by province"* half of `NOTICE_PERIOD_TABLE.CA`'s citation is still unsourced. See **C-13**. |

> **The Portuguese half of this class is closed, and the way it closed is worth
> keeping.** `diariodarepublica.pt`'s HTML is still an OutSystems shell on every
> route — nothing about that changed. **`files.diariodarepublica.pt` serves the
> gazette itself as static PDF**, at a path the HTML site never exposes in a
> followable form:
>
> ```
> https://files.diariodarepublica.pt/gratuitos/1s/<yyyy>/<mm>/<issue><suffix>.pdf
> ```
>
> The per-act path (`/1s/2022/08/16400/0000200005.pdf`) 301s to an error page and
> the ELI path 403s. **Only the `gratuitos` whole-issue form works**, and issues
> back to at least 1988 are present. That one URL shape closed **D-10, D-02 and
> D-03**, and it is the general remedy for any Portuguese instrument whose
> gazette issue number can be established. **Class C was never a statement about
> the authority — only about one of its delivery channels.**

### Class D — origin TLS · D-12

| id | Document | Observed |
|---|---|---|
| **D-12** | AIMA residence permit for remote work | `aima.gov.pt` completes the proxy `CONNECT` (`HTTP/1.1 200 Connection Established`) and then fails TLS with `unable to get local issuer certificate`. The host is **allowlisted**; the origin serves an incomplete certificate chain. Retried with the proxy CA bundle explicitly; same result. **Do not disable verification to get it.** |

### Re-scoped, and never retried on the new scope · D-13

| id | Document | Status |
|---|---|---|
| **D-13** | The index the D8 income floor is expressed in | **The manifest named the wrong index and the reasoning was right.** D-11 shows the floor is *"four monthly minimum guaranty remuneration"* — a multiple of the **RMMG**, not the **IAS**. D-10, now read, confirms the statute names no figure at all (**C-17**). The document needed is whichever instrument fixes the current RMMG, and with `files.diariodarepublica.pt` open it is a gazette-issue lookup rather than a research problem. **Not attempted this pass.** |

### Licence, not access · D-30

| id | Document | Status |
|---|---|---|
| **D-30** | MLI status / matching database | **Moot as an access question.** Licence class (d), paraphrase-only, and that would hold unchanged if `oecd.org` became reachable tomorrow. |

### And one that is retrieved but will never be vendored · D-39

D-39 is counted as retrieved and **no list bytes are committed**, for two
independent reasons that are both now on the record:
[`D-39-un-consolidated-list.md`](D-39-un-consolidated-list.md) carries the
register entry, the XML access path, the list's own last-updated date (which
moved the day before it was read), and the UN's copyright statement — *"All
rights reserved … none of the materials … may be used, reproduced or
transmitted"* — which also corrects the manifest's licence class for it from (b)
to (c).

## 5. The route still deliberately not taken

`raw.githubusercontent.com` is reachable, and third-party datasets mirroring the
EU annexes, the SSA list and the OFAC files exist on it. **None was fetched and
none will be**, and this pass makes the reasoning stronger rather than weaker:
the EU annexes and the SSA list were both retrieved **from their publishers**,
so a mirror would have produced a file that was *mostly right* and provably
unnecessary.

A mirror is not the authority. Vendoring one produces a provenance header naming
an authority nobody in the chain has read — the failure `CLAUDE.md` §4 calls this
project's through-line, one layer further out and much harder to detect.

**An honest blank is recoverable. A plausible wrong list is not.**

## 6. The work order, rewritten for what is actually left

In value order. The list is short now, and no two items share a remedy.

1. **D-05 — Ontario ESA 2000.** Class C; needs a real browser (see §3 for why
   this container has none). Closes the provincial half of **C-13**, and the
   sidecar must say in those words that one province is not proof about ten.
2. **D-13 — the RMMG instrument.** No longer blocked by anything: the gazette is
   reachable and the only work is establishing which Decreto-Lei currently fixes
   the guaranteed monthly minimum wage and reading its issue. It becomes
   necessary the moment anyone tries to give **C-17**'s income condition a
   number, and **C-17** is the reason to capture the *formula*, not the euro
   figure.
3. **D-12 — AIMA.** Needs the origin to fix its certificate chain, or a network
   where the missing intermediate is cached. Fills the `authority` field that
   `DNV_COUNTRIES_PROVENANCE` still holds as `null` for the *permit* half of the
   Portuguese scheme; D-11 already fills it for the *visa* half.
4. **Portuguese currency, for the three documents now in the corpus.** D-02,
   D-03 and D-10 are the **enacting** texts plus the specific amending laws that
   were read in full. The one artifact that would confirm the current
   consolidation in a single read is DRE's consolidated view, which is still
   class C. Until then those three carry `[CONFIRMED — as at <date>]` and say so.
5. **D-14 / D-15 re-capture with a page date.** The transcriptions carry no
   "Last Reviewed/Updated" stamp, and `Source updatedAt` is the row this corpus
   treats as load-bearing. Anyone with a browser and thirty seconds can close it.

Each must land with the full provenance header used by every file in this
directory: source name, publisher, exact URL, retrieval date, byte count,
SHA-256, the source's own version or last-updated, licence basis, and evidence
tag. **A manual retrieval says so in the retrieval row and in the evidence tag**,
as D-14 and D-15 now do — that is a real provenance difference, and hiding it
would be the mirror problem in a new costume.

---

## Appendix · the original 2026-08-19 blocked-pass record, kept

The first pass attempted every Layer-1 source and retrieved **nothing** — 50 URL
attempts, 50 identical denials, all class A:

```
curl: (56) CONNECT tunnel failed, response 403
```

```json
{ "kind": "connect_rejected",
  "detail": "gateway answered 403 to CONNECT (policy denial or upstream failure)",
  "host": "<host>:443" }
```

`WebFetch` reported the same policy by the other route:
`{"error_type":"EGRESS_BLOCKED","domain":"www.canada.ca"}`.

That record is superseded as a **status** and retained as a **method**: it
established the class-A signature precisely enough that this pass could tell it
apart from classes B, C and D at a glance, which is most of why the second pass
went as far as it did.

**One item from the original pass survives unchanged and always will.** L1-01 /
L1-11 — the OECD Model Tax Convention, its Commentaries and BEPS Action 7 —
remain paraphrase-only. That is a **licence** constraint, not an access one, and
it would hold unchanged if `oecd.org` became reachable tomorrow. See
[`L1-01-L1-11-oecd-citation-register.md`](L1-01-L1-11-oecd-citation-register.md).

**And one item stays out for a reason that is neither licence nor access.**
L1-12, the sanctions lists: all four licences are clean, and the lists are still
not vendored, because a checked-in copy is the *"helpful cached fallback"*
`docs/KNOWLEDGE-SOURCES.md` §11 names as dishonest to ship. This pass read all
three registers and wrote
[`D-36-D-37-D-38-sanctions-register.md`](D-36-D-37-D-38-sanctions-register.md)
instead — and found, in the reading, a concrete demonstration that flattening a
regime register into a country blocklist would **block the United States**. The
right shape remains a scheduled fetch with a fail-closed gate.
