# Webhook authentication — the nine production n8n endpoints

**Status: CLOSED 2026-08-27.** All nine production webhooks require a shared
secret header. Before this date every one of them executed for anybody who
knew the URL, and eight of the nine handed the caller an employment record on
the way out.

This document is the record of what was open, what was done, how it was
proved, and the three traps that cost time. It is written for the reader who
finds a `403` from one of these endpoints in six months and needs to know
whether that is the system working or the system broken.

---

## 1. What was actually exposed

Two separate defects sharing one entry point.

**F-4a — the disclosure.** Eight of the nine webhook nodes ran with
`responseMode: "lastNode"`, which tells n8n to hand the *last executed node's
output* back over the HTTP connection. On these graphs that output carries the
full employment record — `full_name`, `email`, `job_title`, `start_date`,
`legal_entity_id` — plus the internal `openaiBody`. It was returned regardless
of what the policy gates decided. Captured live on UC-01 on 2026-08-22
(`qa/evidence/UC-01/2026-08-22-uc01-e2e/shared/webhook-unauth-probe2.json`)
and fixed on UC-01 alone at the time; the other eight were never touched.

**F-4b — no authentication.** Every webhook node had
`authentication: "none"`, and every Zendesk webhook record had
`authentication: NONE`. Any POST to a known path executed the real graph:
`workflow_claims`, `cases` and `audit_log` writes, and on an auto-resolve
branch a **public comment posted to a Zendesk ticket of the caller's
choosing**.

### Why "nobody knows the URL" was never a control

The address has two halves and neither was secret.

- **The host** is in public Certificate Transparency logs. Every Let's Encrypt
  certificate is published there by policy — it is how browsers detect forged
  certificates, and there is no opt-out. Verified 2026-08-27 against a public
  CT API with no credentials:

  ```
  $ curl "https://api.certspotter.com/v1/issuances?domain=your-host.example..."
  n8n.your-host.example | C=US, O=Let's Encrypt, CN=YE1 | not_before 2026-07-30
  ```

  `scripts/build-public-tree.sh` rewrites the host to `n8n.your-host.example`
  in the published repo. That is good hygiene and it is **not** a security
  control: it cannot remove a name from a log that already has it.

- **The path slugs** (`uc-01-verification`, `uc-02-expense`, …) are in the
  public repository.

There is also no gate in front of n8n. A POST to a nonexistent path returns
`404` ("webhook not registered"), not `401`/`403` — so the reverse proxy
forwards everything and n8n itself is the only thing deciding.

**Severity, stated honestly.** These point at a Remote *Sandbox* and a demo
Zendesk account. No real customer data was reachable. The damage was to
`audit_log`: the table every honesty claim in `README.md` rests on. A stranger
able to write rows into it is what turns "every decision is recorded" from a
guarantee into a hope.

---

## 2. What is in place now

One secret, ten places.

| Where | What |
|---|---|
| 9 × Zendesk webhook records | `authentication.type = api_key`, `add_position = header`, `data.name = X-YOUR-WEBHOOK-TOKEN` |
| 1 × n8n credential | `httpHeaderAuth` id `CRED_WEBHOOK_HEADER_AUTH`, named `n8n Secure Zendesk Comm` |
| 9 × n8n webhook nodes | `authentication: "headerAuth"`, that one credential selected |

Plus, on all nine nodes, `responseMode: "onReceived"` with
`options.responseData = '{"status":"received"}'` — reply on arrival, before a
single node runs, with a fixed literal that no code branch can influence.

The secret itself is 32 crypto-random bytes as 64 hex characters. It lives in
the n8n credential store and in nine Zendesk webhook records, and in neither
place can it be read back.

### One secret, not nine

Nine separate secrets would sound safer and would not be. All nine endpoints
live on the same n8n instance and are fed by the same Zendesk account, so
anything exposing one exposes the rest — no real isolation, nine things to
track, and nine chances to typo one and take a use case offline without
noticing. Rotation means updating ten places; that is the cost, and it is the
right trade.

### Ordering — the part that will bite whoever rotates this

**Zendesk gets the header first, n8n starts checking second.** Always.

n8n ignores a header it is not configured to check, so step one changes
nothing observable. By the time n8n starts enforcing, every delivery already
carries the credential and **not one request fails**.

Do it the other way and Zendesk's deliveries start returning `403`. That
matters more here than it sounds: a Zendesk webhook that fails **circuit-breaks
and cannot be repaired**. Correcting its endpoint does not revive it — the
invocation log stays frozen on the dead record while the trigger fires
normally, which looks exactly like a broken trigger condition and is not one.
The only fix is to create a new webhook and repoint the trigger. Nine times.

---

## 3. How to verify it, and what a real proof looks like

`npm run verify-webhook-auth` runs the whole sweep. It exits **2** when it
cannot reach n8n, never 0 — a check that cannot run must never be mistaken for
a check that passed.

What it asserts, per graph:

1. the node has `authentication: "headerAuth"` and a credential attached
2. `responseMode` resolves to `onReceived` and the fixed body is set
3. an **unauthenticated POST returns `403` and creates no execution**

(3) is the load-bearing one. (1) and (2) read configuration; only (3) observes
the running system refuse.

Measured 2026-08-27, all nine:

```
UC-01 … UC-09   403  "Authorization data is wrong!"
```

and the positive direction on UC-09, driven by a **real Zendesk ticket**
(tag `uc09_test` + employment field `3537d9ee-…`):

```
Zendesk invocation   16:58:10Z   success   HTTP 200
n8n execution 9279   16:58:10    success
```

Both directions matter. A `403` sweep alone proves the door is shut; it does
not prove the key still opens it, and a lock nobody can pass is an outage.

---

## 4. Three traps, each of which cost real time

### 4.1 Zendesk's webhook test CANNOT validate authentication

`POST /api/v2/webhooks/test` builds a **synthetic webhook that carries no
credentials**, so it reports every correctly-secured webhook as broken. It
returned `403 "Authorization data is wrong!"` against a UC-09 configuration
that a real Zendesk delivery accepted minutes later.

Proved rather than assumed, by aiming a test at an echo service with an
explicitly declared `api_key` and reading what arrived:

```
User-Agent                 Zendesk Webhook          <- Zendesk really delivered
X-Zendesk-Account-Id       26788169
X-Zendesk-Webhook-Id       test_webhook:fake_webhook:…   <- note this
X-YOUR-WEBHOOK-TOKEN        (absent)
Content-Length             0                        <- the body was dropped too
```

The header was declared in the same call and still not sent. **Only a real
delivery proves a secured webhook works.**

### 4.2 n8n PRUNES a parameter equal to the node default — absent means default

The Webhook node's default `responseMode` **is** `onReceived`, which is also
the value this project wants. So a node configured through the n8n **editor**
saves with no `responseMode` key at all:

```
raw keys = ['httpMethod', 'options', 'path']
```

A strict `p.responseMode !== "onReceived"` therefore calls a *correct* node
defective — and `webhookResponseParamIssues()` did exactly that, on all nine at
once, with a message naming the F-4 disclosure as reopened while it was shut.
Fixed in `workflows/nodes/webhookResponseSpec.js` by reading through
`RESPONSE_MODE_NODE_DEFAULT`, with the negative controls the fix needs: an
explicit `lastNode` must still fail, and so must a third mode, or
"absent means default" has quietly become "accept anything".

It stayed hidden because every one of these nodes had only ever been written by
an API `PUT`, which stores values verbatim and prunes nothing. **The first hand
edit in the editor changed the stored shape on all nine simultaneously.** Any
check that diffs a UI-edited node against an API-written baseline shares this
hazard.

### 4.3 The credential dropdown offers OUTBOUND credentials for an INBOUND door

Selecting `Authentication → Header Auth` lists every `httpHeaderAuth`
credential on the instance, including **`Remote Sandbox- Christina`**
(`CRED_REMOTE_SANDBOX`) — the Remote API token, used by 15 nodes across seven
graphs to call Remote. It is the same *type* and the opposite *direction*.

It was selected and saved to production UC-01 on 2026-08-27. Consequences had
it stayed: every caller would have had to present the Remote API token, so a
payroll-capable credential would have been pasted into nine Zendesk config
screens readable by any Zendesk admin; and rotating that token would have
broken all nine webhooks and all 15 outbound calls at once.

Caught by reading the live graph back, reverted within minutes. **No delivery
occurred during the window** — the last real one was 2026-08-25T03:19:07Z,
`success` — so nothing failed and the webhook did not circuit-break. That was
luck, not design.

**Rule: an inbound door never reuses an outbound credential.** They are
different directions and different blast radii, and the UI will not tell you
which is which.

---

## 5. Rotating the secret

1. Generate: `openssl rand -hex 32` (on Windows PowerShell:
   `$b=[byte[]]::new(32); [Security.Cryptography.RNGCryptoServiceProvider]::new().GetBytes($b); ($b|%{$_.ToString('x2')}) -join ''`)
2. Update **all nine Zendesk** webhook records first — Admin Center → Apps and
   integrations → Webhooks → each → Authentication → API key.
3. Update the **one n8n credential** (`n8n Secure Zendesk Comm`). All nine
   nodes reference it by id, so they need no individual change.
4. `npm run verify-webhook-auth`.
5. Drive one **real** ticket end to end. Step 4 cannot prove the key still
   opens the door; only this can.

Between steps 2 and 3 both secrets are briefly valid from n8n's point of view —
n8n checks one value, and it is the old one until you change it. That window is
why step 2 comes first: it fails closed on the *old* secret rather than on
nothing.

---

## 6. What is still open

- **Zendesk signs every delivery** — `X-Zendesk-Webhook-Signature`, an HMAC
  with a per-request timestamp, present on every request including the tests
  above. It is strictly stronger than a shared secret: per-request, and it
  cannot be replayed. n8n cannot verify it natively; it needs a Code node doing
  the HMAC before the gates. The shared header is the pragmatic control, not
  the best available one.
- **`/__cx/health` on the Vercel deployment is ungated** and reports which
  integrations are configured.
- ~~**No rate limiting** on the third-party consent door (`/thirdparty`).~~
  **CLOSED 2026-08-29 — struck, not deleted, because this entry understated a
  control that now exists and a reader auditing the door's safety would have
  concluded it was weaker than it is.** `src/thirdparty/rateLimit.js` is wired
  into `src/thirdparty/server.js` and consulted BEFORE any lookup, alongside the
  shape validations. Two buckets: **20 per address per hour** (a speed bump —
  addresses rotate, and a tight limit's first victim is whoever is demonstrating
  the system) and **250 globally per day**, which is the number that actually
  bounds the bill. It **fails closed** — a counter that cannot be read refuses
  with 503 rather than allowing, on the same reasoning `readPosture()` uses for
  approver identity. It cannot become the VC-33 side channel, structurally: it
  is keyed only on the caller and has no access to what the lookup found.
  Verified against the deployment, not the source — `GET /__cx/health` on
  2026-08-29 reports `thirdPartyDoor.rateLimit`:
  `{perAddressPerHour: 20, globalPerDay: 250, store: "postgres", effective:
  true, failsClosed: true}`. `store: "postgres"` is the load-bearing word: a
  per-invocation in-memory counter on a serverless function bounds nothing.
