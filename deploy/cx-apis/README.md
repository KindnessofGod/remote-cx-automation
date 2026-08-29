# Deploying the nine review/approval APIs to Vercel (free tier)

The ZAF sidebar runs **in the agent's browser, inside Zendesk**, and fetches
these APIs directly. So "the APIs are running" has to mean "running on the
public internet", not "running while your laptop is open". This directory is
what makes that true.

Everything below is written for someone who has not deployed anything before.
Follow it in order. Nothing here needs the ZAF app to exist yet — **step 6 is
the only part that waits on it**, and the deployment tells you so itself.

---

## 0. What you are deploying

One Vercel serverless function serving all nine APIs, each under its own path
prefix on one host:

| Prefix | Use case | Write routes? |
|---|---|---|
| `/uc01` | Employment verification (the review API) | yes — approve/deny |
| `/uc02` | Expense & receipt validation | yes — submit a claim |
| `/uc03` | Travel support / workation router | no |
| `/uc04` | Work authorization | yes — approve/deny |
| `/uc05` | Resignation notice | yes — sign off / deny |
| `/uc06` | Contract amendment (dual approval) | yes — approve/deny |
| `/uc07` | Global mobility dossiers | no (by design) |
| `/uc08` | Cross-border tax dossiers | no (by design) |
| `/uc09` | Off-cycle payroll adjustment | yes — multi-role approval |

Each use case's own routes hang off its prefix unchanged, e.g.

```
https://<your-deployment>.vercel.app/uc06/api/amendments/by-ticket/12345
```

Plus **the request portal** at `/portal` — not a tenth use case, but the intake
page the eight request types with no Remote event API are submitted from
(`src/portal/`). It is what makes `docs/E2E-TEST-PLAN.md` Phase 2 runnable by
someone with no Node and no clone.

| Prefix | What it is | Gated by |
|---|---|---|
| `/portal` | the request portal — one page, seven intake forms | a shared key, **not** the ZAF identity below — see §3a |

Plus three routes belonging to the deployment itself:

| Route | What it is for |
|---|---|
| `GET /` | index — what is mounted, and the current posture |
| `GET /__cx/health` | **the page to read when something looks wrong** |
| `GET /healthz` | a plain liveness check |

Why one function and not nine, why the prefixes, and why a store is rebuilt on
every request: see the header comments in `router.js` and `deps.js`. The short
version of the last one is that UC-07 and UC-08 both serve `/api/dossiers`, so
the prefix is load-bearing, not decoration.

---

## 1. Before you start

You need:

- a **GitHub account** with this repository pushed to it,
- a **Vercel account** (sign up at vercel.com with that GitHub account — the
  free "Hobby" plan is enough; note Hobby is for non-commercial use),
- your existing **`.env` values**. You will copy some of them into Vercel by
  hand. **Never commit `.env`** — it is gitignored and must stay that way.
  Vercel stores these values itself; nothing secret goes into the repo.

---

## 2. Create the project

> **Already done — the project exists.** `remote-cx-apis`
> (`prj_YOUR_VERCEL_PROJECT`), linked to this repository, Vercel
> Authentication off, production alias `remote-cx-apis.vercel.app`.
>
> **One setting still needs a human, and until it is changed the URL returns
> 404.** Vercel builds a project's *production branch*, which defaults to
> `main` — and `main` does not contain this deployment. The code lives on the
> working branch. Either:
>
> - **Project → Settings → Environments → Production → Branch Tracking** →
>   set it to the branch that actually holds the deployment; or
> - merge that branch into `main`, which is a decision about the default
>   branch rather than about this deployment, and should be taken on its own
>   terms.
>
> **MEASURED 2026-08-28 — the tracked branch is `orchestration/gascity-pilot`,
> and it is NOT the branch this file and `CLAUDE.md` §4 both named.** Pushing
> `claude/remote-cx-ai-automation-hphnkj` produces a **Preview** deployment
> that builds green and changes nothing about the live URL, which is the most
> misleading possible outcome: the push succeeds, the build succeeds, and
> production keeps serving the previous bundle. Read it off GitHub rather than
> off either document —
> `gh api repos/<owner>/<repo>/deployments` lists every deployment with an
> `environment` of `Production` or `Preview`, and
> `.../deployments/<id>/statuses` gives `success`/`failure`. That pair answers
> "did my push deploy?" without a Vercel token, which nothing here previously
> recorded a way to do. The Vercel project is attached to
> `remote-cx-automation-workspace`; the public `remote-cx-automation` repo has
> **zero** deployments and is not the build source, despite
> `remote-cx-beads`'s description saying it is watched by Vercel.
>
> **Two fields are easy to confuse, and only one of them is a branch.**
> *Root Directory* (Settings -> Build and Deployment) is a FOLDER PATH inside
> the repo, and for this project it must be **empty** -- the deployment root is
> the repository root, for the reason in `api/index.js`'s header. Putting a
> branch name there fails the build in about a second with *"The specified Root
> Directory ... does not exist"*. The branch is set somewhere else entirely:
> *Settings -> Environments -> Production -> Branch Tracking*. It is not on the
> Git settings page, despite being a Git setting; the `main` shown there is a
> blank Deploy Hook form, not the production branch.
>
> **Changing the setting does not rebuild what is already deployed.** The
> production alias keeps serving the last production build — still the 404 —
> until a new one replaces it. After saving, go to **Deployments**, find the
> newest build of the branch, and **Promote to Production** (or push one
> commit). Saving the setting and then re-checking the URL, seeing the same
> 404, and concluding the setting did not take is the trap under the trap.
>
> A 404 here is *not* a broken build. Check the deployment's commit SHA in the
> Vercel inspector against the branch you expect before debugging anything
> else — the build succeeding while serving nothing is exactly what a
> right-project/wrong-branch deploy looks like.
>
> **There is no `/api/health`.** The deployment's own routes are `/`,
> `/healthz`, `/__cx/health` and `/__cx/routes` (`META_ROUTES` in `router.js`);
> everything else is `/ucNN/...`. `/api/health` resolves to a use-case prefix
> named `api`, which does not exist, so it returns a genuine 404
> `no_such_use_case` **on a perfectly working deployment** -- indistinguishable
> at a glance from the wrong-branch 404 above. Check `/healthz` before
> concluding anything is broken; the two 404s have different bodies, and the
> body is the only thing that tells them apart.
>
> **The branch's own preview URL works throughout**, with no setting changed
> and nothing promoted, because Vercel builds every pushed branch as a preview:
> `remote-cx-apis-git-claude-r-f2b5dc-your-account-projects.vercel.app`.
> Preview URLs can sit behind Vercel Authentication even when production does
> not, so open it in a browser signed in to the Vercel account — a login wall
> is not a failed deploy either.
>
> Pushes to the linked branch build automatically once it is the production
> branch; no re-import is needed.

The steps below are the from-scratch path, kept for a fresh environment.

1. Go to <https://vercel.com/new>.
2. Pick this repository and click **Import**.
3. **Leave every build setting alone.** Framework Preset should say *Other*;
   Root Directory should stay at the repository root (`./`). The repo's
   `vercel.json` already sets the install command, and `api/index.js` at the
   root is the function.
   *Do not set Root Directory to `deploy/cx-apis` — the function imports
   `src/`, and Vercel only uploads what is inside the root you give it.*
4. Do **not** click Deploy yet. Open **Environment Variables** first (step 3).
   If you already deployed, that is fine: add the variables, then redeploy.

---

## 3. Environment variables

Add these in **Project → Settings → Environment Variables**, ticking
**Production** (and Preview, if you want preview URLs to work too).

### Required — without this, every read is empty

| Name | Value |
|---|---|
| `SUPABASE_DB_URL` | the **connection pooler** URI for the `remote-cx-automation` Supabase project |

Get it from the Supabase dashboard → your project → **Connect** →
**Transaction pooler**. It looks like:

```
postgresql://postgres.your-project-ref:YOUR-DB-PASSWORD@aws-0-your-region.pooler.supabase.com:6543/postgres
```

**Use the pooler URI, not the direct `db.<ref>.supabase.co:5432` one that is in
your local `.env`.** Every serverless instance opens its own connections, and
the direct-connection limit on the free tier is small enough that a handful of
concurrent sidebar loads exhausts it. The pooler exists for exactly this.
Copy the host and port from the dashboard rather than from this page — the
`aws-0`/`aws-1` part varies by project.

### Required for reads AND writes on a public deployment

| Name | Value | Where it comes from |
|---|---|---|
| `ZAF_SHARED_SECRET` | the HS256 secret the sidebar signs with | **step 6** — you choose it; the same value goes into the app's `cxSharedSecret` secure setting |

**Reads are gated too, and that is a fix rather than a tightening.** Until it
was, every `GET` here was unauthenticated, and each one returns an employment
id, the requester's real email address, the decision, its reason and its flags.
Ticket ids are sequential integers and there are nine prefixes, so an open read
was an enumerable export of the whole corpus rather than a single lookup. Reads
now honour the same `signedIdentityRequired` posture as writes — one flag, one
mechanism (`src/shared/approverAuth.js`), so the two cannot drift.

`/`, `/healthz`, `/__cx/health`, `/__cx/routes` and each `/ucNN/healthz` stay
open on purpose: they carry no customer data and they are how you diagnose a
deployment that is refusing everything else.

### Required only for approve / deny (step 6 territory)

| Name | Value | Where it comes from |
|---|---|---|
| `REMOTE_BASE_URL` | `https://gateway.remote-sandbox.com` | same as your local `.env` |
| `REMOTE_API_TOKEN` | your Remote Sandbox token | same as your local `.env` |
| `ZAF_APP_PUBLIC_KEY_PEM` | the ZAF app's public key | **step 6** — does not exist yet |

An approval re-reads the employment record before it executes ("is this still
true?"), which is why the Remote credentials belong to the write path and not
to reads. If they are missing, a write fails with a message that says exactly
that, instead of hanging.

### 3a. Required for the request portal at `/portal`

| Name | Value |
|---|---|
| `PORTAL_ACCESS_KEY` | one long random string. **You choose it** — nothing issues it. |

Generate one however you like (`openssl rand -hex 24` is fine) and give it to
whoever should be able to use the page. They paste it once; the browser keeps
it for that session only.

**Why the portal has its own key instead of the ZAF identity above.** The
sidebar runs *inside Zendesk*, so Zendesk can sign a token for it. The portal
deliberately does not — it stands in for Remote's own product surfaces, which
is the whole reason it exists — so there is nothing to sign a token with. A
shared key is the weakest credential that is still a credential, and it is
worth being precise about what it buys: it proves the caller holds the secret,
and nothing else. That closes the thing that actually matters here — a `POST`
to this page runs the real gates and writes an `audit_log` row and a use-case
record, so an anonymous caller on the open internet must not be able to make
one.

**Until you set it, `/portal` refuses every request** with
`portal_access_key_not_configured` and a body naming this variable. That is the
same fail-closed choice as the ZAF gate: a portal that refuses is fixed by one
environment variable; a public page that wrote rows for anonymous callers
cannot be un-written. The page itself still loads — it has no data in it, and
it is how you are told a key is needed.

`/__cx/health` reports the portal's posture under `portal`, so you can check
`accessKeyRequired` / `accessKeyConfigured` without making a request.
`accessKeyRequired: false` on this deployment is the thing to escalate.

Two optional overrides exist and neither is needed here:
`PORTAL_REQUIRE_ACCESS_KEY=true` forces the key on, and
`PORTAL_ALLOW_OPEN_ACCESS=true` relaxes it for a **local** run with a database
attached. The second one cannot open this deployment — the public-reachability
check is ORed on top and no environment variable removes it.

### Recommended

| Name | Value |
|---|---|
| `ZAF_ALLOWED_ORIGIN` | the sidebar's browser origin — **read it off `/__cx/health`**, see step 5 |

### Optional

| Name | Why |
|---|---|
| `ZENDESK_SUBDOMAIN`, `ZENDESK_OAUTH_CLIENT_ID`, `ZENDESK_OAUTH_CLIENT_SECRET` | lets UC-01 post the decision back onto the Zendesk ticket when a specialist approves. Without them the decision is still recorded and audited, just not posted. |
| `OPENAI_API_KEY` | needed by `POST /uc02/api/expenses` and by the request portal's own submissions, both of which run a full workflow. Nothing else here calls an LLM — classification happens in n8n. **Without it the portal is not broken**: each use case's rule-based path is passed explicitly, so a submission is deterministic rather than quietly degraded. The one visible difference is UC-09, whose amount extraction has no rule-based branch by design (an amount that will be paid is never guessed), so every off-cycle payment request correctly escalates with `amount_not_extracted`. |
| `ZAF_JWT_ISSUER`, `ZAF_JWT_AUDIENCE` | only if you deliberately set them on the token. |

### Deliberately NOT set

`ZAF_ALLOW_UNSIGNED_IDENTITY` and `ZAF_REQUIRE_SIGNED_IDENTITY`. Leave both
unset. The deployment works out its own posture from **two independent
triggers, either of which alone is enough**: a durable store is attached (the
decision outlives the process, so it must name a real human), or the deployment
is publicly reachable (`VERCEL` is set, so a name in a header is a claim anyone
can make). On Vercel the second one fires from the first deploy, *before*
`SUPABASE_DB_URL` exists — which is the point: the window where the URL is live
but the database is not yet attached is exactly when an unauthenticated
approve/deny would slip through. `/__cx/health` names whichever trigger is
actually firing. Setting
`ZAF_ALLOW_UNSIGNED_IDENTITY=true` would make every approve/deny work
immediately — by trusting a name in a header that anyone who can reach the URL
can set, on a public URL, writing that name into `audit_log` as the human who
authorised a payroll change. Do not do it.

---

## 4. Deploy

Click **Deploy**. It takes a minute or two. Then, **before testing anything
else**, check one setting that silently breaks browser access:

**Project → Settings → Deployment Protection.** If *Vercel Authentication* is
enabled for **Production**, turn it off. With it on, every request gets an HTML
login page instead of JSON — the sidebar shows "backing service unreachable"
and `curl` returns HTML, which looks like a broken deployment and is not one.

### Alternative: deploy from the command line

```bash
npx vercel@latest --prod          # first run walks you through linking the project
npx vercel@latest env add SUPABASE_DB_URL production
```

Same result. The GitHub import above is recommended because it redeploys
automatically on every push.

---

## 5. Verify it worked

Replace `<url>` with your deployment URL.

**a. Is it alive and what is its posture?**

```bash
curl -s https://<url>/__cx/health
```

Read the `reads`, `readsRequireSignedIdentity` and `writes` lines. Before
step 6 you should see:

- `readsRequireSignedIdentity: true`
- `reads: "REFUSED BY DESIGN — a signed ZAF identity is required on reads here..."`
- `writes: "REFUSED BY DESIGN — ... until ZAF_SHARED_SECRET is set."`

Both are the expected state until step 6, and both clear with the same one
variable. `readsRequireSignedIdentity: false` on a publicly reachable
deployment is the thing to escalate — it means case data is being served to
anyone who asks.

After step 6, `reads` reports whether there is anything to read:
`WORKING — Supabase is attached...`, or `NOT WORKING` if `SUPABASE_DB_URL` is
wrong or missing.

**b. Real data, from the real database.** These ticket references exist in the
Supabase project today (they were written by the live n8n workflows), so each
should return `found: true` — **once step 6 is done**. Before that they
return `401 signed_identity_not_configured`, which is correct, not a fault.

Each needs the signed token the sidebar sends. A hand-written `curl` has no way
to mint one (ZAF signs it on Zendesk's servers), so to check these by hand,
sign a short-lived HS256 JWT with `ZAF_SHARED_SECRET` carrying an `email`
claim and pass it as `-H "Authorization: Bearer <token>"`:

```bash
curl -s https://<url>/uc06/api/amendments/by-ticket/upstream-proof-uc06-live-p1
curl -s https://<url>/uc04/api/authorizations/by-ticket/standin-uc04-2
curl -s https://<url>/uc05/api/resignations/by-ticket/standin-uc05-ca-3
curl -s https://<url>/uc07/api/dossiers/by-ticket/trace-proof-uc07-anchor
curl -s https://<url>/uc08/api/dossiers/by-ticket/claim-proof-uc-08-inquiry-a
curl -s https://<url>/uc09/api/adjustments/by-ticket/upstream-proof-uc09-live-p1
curl -s https://<url>/uc01/api/review/ticket/live-verify-review-queue-check
```

If those return real rows, **persistence is confirmed end to end**: the
function keeps no memory between requests, so anything it returns came out of
Supabase.

**b2. The portal.** Open `https://<url>/portal` in a browser. The page loads,
then asks for the access key; paste `PORTAL_ACCESS_KEY`'s value and submit one
request per form (`docs/E2E-TEST-PLAN.md` Phase 2 is the script). Two things to
check on camera, because they are the plan's own checkpoints:

- **the positive one** — the Spain / 3-week travel request must reach
  `auto_resolve`. A surface that refuses everything looks identical to a
  working one from outside, so this is the assertion that matters most;
- **the 🔴 one** — the relocation and cross-border-tax forms must render a
  dossier with **no** approve/deny control anywhere. Not a disabled button; no
  control.

From a script rather than a browser:

```bash
curl -s https://<url>/portal/api/context -H "x-portal-key: <the key>"
```

Without the header the same call returns `401 portal_access_key_required` with
an explanation. That refusal is the gate working.

**One thing about the portal that is deliberate and looks like a bug.** Its
Remote reads are the **mock** fixtures, exactly as `npm run portal` says on
every start, even here. Its personas (`emp_active_001`, …) are mock records; a
real Sandbox has never heard of them, so pointing this at the Sandbox would
make every Remote-dependent form 404 and refuse — a page that cannot succeed —
and would have a public URL writing work-authorization records into a real
account. The **stores** are real: a submission's row lands in Supabase, which
is what the Phase 2 verification query reads.

**c. The write path refuses, clearly:**

```bash
curl -s -X POST https://<url>/uc06/api/amendments/any-id/approve \
  -H 'Content-Type: application/json' -d '{"role":"customer_admin"}'
```

You should get `401` with `"code": "signed_identity_not_configured"` and a
`howToFix` list. That is the gate doing its job, not a bug.

**d. Find the value for `ZAF_ALLOWED_ORIGIN`.** Once the sidebar is installed
(step 6), open a Zendesk ticket with the sidebar visible, open the browser's
devtools → Network, and look at any request it makes to your deployment — the
`Origin` request header is the value you want. Or simply read `yourOrigin` back
from `/__cx/health`, which echoes whatever origin called it. Put that value in
`ZAF_ALLOWED_ORIGIN` and redeploy. Until then it stays `*`, which works but is
wider than it needs to be.

---

## 6. What does not work until the ZAF app is installed

**Every approve, deny and sign-off.** They return `401
signed_identity_not_configured` with an explanation, on purpose. This is a
genuine chicken-and-egg — the key is created by installing the app — and the
right resolution is to install the app, not to weaken the gate.

Order of operations:

1. Package and upload the app:
   ```bash
   npx @zendesk/zcli apps:package zaf-app
   ```
   then Zendesk **Admin Center → Apps and integrations → Zendesk Support apps →
   Upload private app**.
2. Note the installed app's numeric **App ID** from its URL in Admin Center.
3. Fetch its public key (any admin credentials that can call the Zendesk API):
   ```bash
   curl -s -u '<email>/token:<api_token>' \
     https://<subdomain>.zendesk.com/api/v2/apps/<app_id>/public_key.pem
   ```
4. Paste the whole PEM — including the `-----BEGIN PUBLIC KEY-----` and
   `-----END PUBLIC KEY-----` lines — into Vercel as
   `ZAF_APP_PUBLIC_KEY_PEM`. Vercel's environment-variable box accepts real
   newlines, so paste it as-is.
5. Redeploy (Vercel → Deployments → ⋯ → Redeploy). Environment-variable
   changes only take effect on a new deployment.
6. Re-run `curl -s https://<url>/__cx/health`. `writes` should now say
   `WORKING`.

**One thing that still needs confirming against a live install**, and is not
faked here: which JWT claim carries the agent's identity. `src/review/zafAuth.js`
tries an ordered list (`email`, `sub`, `user.email`, …) and fails closed with
`identity_claim_missing` rather than guessing. If approvals come back with that
code after step 6, the claim name is the thing to check — see that file's
header comment.

---

## 7. Point the sidebar at the deployment

In Zendesk, **Admin Center → Apps and integrations → the installed app →
Change settings**, set:

| Setting | Value |
|---|---|
| `apiBaseUrl` | `https://<url>/uc01` |
| `uc02ApiBaseUrl` | `https://<url>/uc02` |
| `uc03ApiBaseUrl` | `https://<url>/uc03` |
| `uc04ApiBaseUrl` | `https://<url>/uc04` |
| `uc05ApiBaseUrl` | `https://<url>/uc05` |
| `uc06ApiBaseUrl` | `https://<url>/uc06` |
| `uc07ApiBaseUrl` | `https://<url>/uc07` |
| `uc08ApiBaseUrl` | `https://<url>/uc08` |
| `uc09ApiBaseUrl` | `https://<url>/uc09` |

No trailing slashes. Only `apiBaseUrl` is required; leave any of the others
blank to switch that use case off in the sidebar.

Nothing in `zaf-app/` had to change for this — the sidebar already takes nine
independent base URLs and appends each use case's own paths, which is why
per-use-case prefixes on one host were the right shape.

---

## 8. Known limits, stated plainly

- **The "list everything" routes do not work here** for UC-02, 04, 05, 06, 07,
  08 and 09. Those stores keep their list in process memory (honestly
  documented as such in each store), and a function has no process memory
  between requests. Rather than answer with a misleading empty array, this
  deployment answers `501 list_not_available_serverless` and names the routes
  that do work. The sidebar never calls them — it only ever uses
  `by-ticket`. UC-01's `/uc01/api/review/tickets` and UC-03's
  `/uc03/api/cases` **do** work: their stores read Postgres. (UC-03's will
  currently answer with an empty array, correctly — the `cases` table holds
  only UC-01 rows today.)
- **UC-02 has no Supabase-backed store at all** (`src/uc02/expenseStore.js` is
  in-memory only), so a claim submitted here is validated, audited to
  `audit_log`, and then not retrievable afterwards. The `uc02_expenses` table
  exists in the project but nothing writes to it yet.
- **Nothing is seeded.** The local `npm run ucNN-api` commands seed three
  demo records at startup; doing that on every cold start would insert
  duplicate rows into Supabase and bill an LLM call each time. So this
  deployment shows exactly what is in the database — which, today, is real
  rows written by the live n8n workflows.
- **The portal's own store boundary is unchanged here.** A submission writes to
  the same real Supabase tables the n8n workflows write to, but UC-02's expense
  store is in-memory in every mode (no `uc02_expenses` schema has been
  verified), so a UC-02 claim is validated and audited and then not
  retrievable. That is the same honest gap `src/portal/README.md` §5 records
  locally, not something this deployment introduces.
- **Cold starts.** The first request after a quiet period takes a second or
  two. This is normal for the free tier and is invisible in the sidebar apart
  from a brief loading state.
- **Free-tier limits.** Vercel Hobby is non-commercial use only, with a
  monthly execution allowance. This traffic (a few requests per opened ticket)
  is nowhere near it.

---

## 9. If something is wrong

| What you see | What it means |
|---|---|
| An HTML login page instead of JSON | Deployment Protection is on. Step 4. |
| `404` `no_such_use_case` | The path does not start with `/ucNN`. `GET /` lists the prefixes. |
| `found: false` on everything | `SUPABASE_DB_URL` missing or wrong. Check `/__cx/health`'s `reads` line. |
| `401 signed_identity_not_configured` | Expected until step 6 — on **reads as well as writes**. `ZAF_SHARED_SECRET` clears both. |
| `401 portal_access_key_not_configured` on `/portal` | `PORTAL_ACCESS_KEY` is not set on the project. §3a. Set it and redeploy — environment-variable changes only take effect on a new deployment. |
| `401 portal_access_key_required` on `/portal` | The request carried no `x-portal-key` header. The page sends one once you have unlocked it; a hand-written `curl` must add it. |
| `401 portal_access_key_invalid` on `/portal` | Wrong value — check for a copied trailing space, and that the deployment has been rebuilt since you last changed it. |
| The portal page loads but its script 404s | Something has reintroduced an absolute `/app.js` in `src/portal/assets/index.html`. Every asset there is addressed relatively and the server injects `<base href="/portal/">`; a test pins both. |
| `401 signed_identity_required` | The verifier is configured, but the request carried no token. The sidebar sends one; a hand-written `curl` does not. Accepted in `Authorization: Bearer <token>` or `X-ZAF-Token`. |
| The sidebar shows every panel as "unreachable" after enabling signing | The app's `signWrites` checkbox is unticked, so it is sending unsigned reads to an API that requires signed ones. Tick it (it governs reads too, despite the name). |
| `500` mentioning `remote_api_not_configured` | An approval tried to re-read the employment record and `REMOTE_API_TOKEN` is not set. Step 3. |
| The sidebar says "backing service unreachable" | Open the deployment URL in a browser tab. If that works, it is CORS — check `ZAF_ALLOWED_ORIGIN` against the `yourOrigin` value from `/__cx/health`. |

`vercel logs <url>` (or the Logs tab in the dashboard) shows anything the
function printed.

---

## Files

| File | What it is |
|---|---|
| `router.js` | pure routing: prefix → use case. No I/O, unit-tested. |
| `deps.js` | builds each use case's real handler with a per-request store set. |
| `handler.js` | the function: posture reporting, the explained refusal, body handling. |
| `../../api/index.js` | the file Vercel turns into the function — a re-export, and the only thing at the repo root besides `vercel.json`. |
| `../../vercel.json` | the rewrite that sends every path to the one function, and the `includeFiles` that ships `src/` (the portal serves real files off disk, which the build's automatic tracing would not otherwise pick up). |
| `../../src/portal/access.js` | the portal's shared-key gate: the rule, the check, and the refusals that explain themselves. |
| `../../test/deployRouter.test.js` | 26 hermetic tests: routing, CORS, the refusal, and the persistence-between-invocations proof. |
