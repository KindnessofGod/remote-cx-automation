# Testing guide — how to click through everything that's built

Written 2026-08-03, same day as `docs/HANDOFF-2026-08-03.md`, in response to
the user wanting to actually exercise every use case end-to-end before
switching tools. **Read `docs/HANDOFF-2026-08-03.md` first if you haven't** —
this file assumes you already know what's built.

All of this runs **inside this GitHub Codespace** — nothing here requires a
local machine, except the two items called out explicitly in §4.

---

## 1. How Codespaces port forwarding works (read this first)

Every command below starts an HTTP server on a `localhost` port. Codespaces
auto-detects any port your process starts listening on and adds it to the
**Ports** tab (bottom panel, next to Terminal). From there you can:

- Click the 🌐 icon next to a port to open it in a browser tab, or
- Right-click → **Port Visibility** → **Public** if a page needs to fetch it
  from outside the Codespace (only the ZAF sidebar case, §3.4, needs this —
  everything else stays **Private**, which is the safer default and is
  already the default).

You do **not** need to SSH out or use a local machine for any of this. Run
each `npm run ...` command in its own terminal tab (Codespaces supports many
tabs) so the servers stay up while you click around.

---

## 2. UC-01 — the one with real demo surfaces (start here)

This is the only use case with dedicated interactive UIs beyond raw API
calls. Try them in this order:

| Command | Port | What it is |
|---|---|---|
| `npm run demo` | — | Non-interactive: narrates 3 tickets deciding, in the terminal. Fastest way to see the decision logic work. |
| `npm run scenarios` | — | Runs every UC-01 §12 spec scenario, one labelled block each. Good for seeing every branch (auto_resolve/human_review/escalate) at once. |
| `npm run playground` | 4030 | **Real UI.** Act as the client (submit a ticket, one-click fills for every §12 scenario) and, on the same page, switch hats and act as the specialist approving/denying. |
| `npm run chatdemo` | 4046 | **Real UI.** Same decision logic, presented as a chat — type a message, get the real `handleVerificationTicket()` result rendered as a reply. |
| `npm run review-api` | 4020 | Backend only (no page of its own) — seeds 4 real review-queue cases. Feeds the ZAF sidebar, §3.4 below. |
| `npm run livedemo` | 4040 | **Real UI, but touches the REAL Zendesk account.** Creates an actual ticket that the live n8n workflow (id `WORKFLOW_UC01_ID`, currently active) will try to process. **Only run this if you're deliberately testing the live path** — see §4.1, it's currently blocked on a trigger-condition fix that hasn't been re-verified. |

`playground` and `chatdemo` are the two to click through first — both are
100% offline (no credentials, no real Zendesk, no Supabase), so nothing you
do there can cost money or touch real data.

---

## 3. UC-06 and UC-08 — the other two "deep" use cases

Neither has a playground-style UI. Each has a real HTTP API (curl/Postman)
plus a ZAF sidebar panel (§3.4) plus, for UC-06 only, a page standing in for
where the request would really start (§3.3).

### 3.1 UC-06 (Contract Amendment, dual approval)

```bash
npm run uc06-api   # :4021, seeds 3 real amendments, prints their IDs + routes on startup
```

Copy an `amendmentId` from the startup log, then:

```bash
curl http://localhost:4021/api/amendments/<id>
curl -X POST http://localhost:4021/api/amendments/<id>/approve \
  -H "Content-Type: application/json" \
  -d '{"role":"customer_admin","approver":"you@example.com","note":"test"}'
curl -X POST http://localhost:4021/api/amendments/<id>/approve \
  -H "Content-Type: application/json" \
  -d '{"role":"payroll_specialist","approver":"you@example.com","note":"test"}'
```

It only executes once **both** roles have approved — try approving with just
one role and confirm it stays pending; that's the dual-control gate working.

### 3.2 UC-08 (Cross-Border Tax dossier, read-only, no execution path)

```bash
npm run uc08-api   # :4023, seeds 3 real dossiers, prints their IDs on startup
```

```bash
curl http://localhost:4023/api/dossiers/<id>
```

There is deliberately no POST route — try `curl -X POST .../api/dossiers/<id>`
and confirm you get a 404, not a 405. That absence is the point: this is the
🔴 use case that structurally cannot execute anything.

### 3.3 UC-06's "Remote UI" stand-in

```bash
npm run remoteui   # :4041 — real page in your browser
```

Remote's real product has no public API for "customer admin requests an
amendment," so this page stands in for that missing surface: pick a role tab
(employee / employer / company admin), submit or consent to a request, and
watch it run the real UC-06 gates and create a pre-tagged (mock) Zendesk
ticket. Good for seeing the *start* of the UC-06 flow, before it ever reaches
the dual-approval step in §3.1.

### 3.4 The ZAF sidebar (drives UC-01 + UC-06 + UC-08 from one shell)

This needs `zcli`, which is **not currently installed** in this Codespace.
If you want to see the real Zendesk agent-facing sidebar (not just curl):

```bash
npm install -g @zendesk/zcli   # one-time
cd zaf-app
zcli apps:server               # serves the app bundle locally
```

Then, in a **real Zendesk ticket** (the live account is `your-subdomain.zendesk.com`
per `CLAUDE.md` "Live resources"), append `?zcli_apps=true` to the ticket URL.
Zendesk will fetch the sidebar's assets from your Codespace's forwarded port
— which means that port needs to be set to **Public** in the Ports tab for
Zendesk's browser (running outside the Codespace) to reach it. Set it back to
Private when you're done; nothing sensitive is served there (it's just
static JS/HTML), but there's no reason to leave it open.

In the sidebar's settings (or `zcli`'s local params), set `apiBaseUrl` to
your forwarded `review-api` URL, and `uc06ApiBaseUrl`/`uc08ApiBaseUrl` to
your forwarded `uc06-api`/`uc08-api` URLs, to see all three panels live.

---

## 4. UC-02, 03, 04, 05, 07, 09 — API-only right now (the honest gap)

**These six do not have a playground/demo UI yet** — that's a real, flagged
gap (see `docs/HANDOFF-2026-08-03.md` §3d), not an oversight you're missing.
The only way to exercise them today is:

1. **curl/Postman against each API directly** — every one prints its own
   route list and seeded record IDs to the terminal on startup, so there's
   nothing to guess. Start each on its own port:

   | Use case | Command | Port |
   |---|---|---|
   | UC-02 Expense validation | `npm run uc02-api` | 4050 |
   | UC-03 Travel/workation router | `npm run uc03-api` | 4051 |
   | UC-04 Work authorization | `npm run uc04-api` | 4052 |
   | UC-05 Resignation notice | `npm run uc05-api` | 4053 |
   | UC-07 Global mobility dossier | `npm run uc07-api` | 4054 |
   | UC-09 Off-cycle payroll | `npm run uc09-api` | 4055 |

   Run one, read its startup log (it prints every route + every seeded ID),
   then `curl` a GET on a seeded ID. UC-04/05/09 also have POST
   approve/deny routes — the startup log shows the exact body shape for
   each (UC-09's is the interesting one: it needs 2 role approvals for a
   standard case, 3 for a high-risk one — the startup log tells you which
   the seeded example needs).

2. **The ZAF sidebar technically has panels wired for all six already**
   (`zaf-app/assets/panels.js`) and `manifest.json` has the optional base-URL
   parameters for each — but this combination has **never actually been
   tested** against a real ticket. If you go the zcli route in §3.4, this is
   worth trying and would close a real gap.

If you want a genuine one-click UI for these six (matching what UC-01 has),
that's a real build task, not something to fake — flag it as a next step
rather than treating curl as a UI substitute in the demo video.

### 4.1 What genuinely can't be done from this Codespace

- **`scripts/fix-zendesk-trigger-condition.mjs`** and confirming
  `npm run livedemo` flows all the way through the live n8n workflow — needs
  the real `ZENDESK_OAUTH_CLIENT_ID`/`SECRET`, which only exist in your
  local machine's `.env` today. Either run it on your local machine, or
  paste those two values into this Codespace's own `.env` (gitignored,
  same as local) if you'd rather stay here — your call, no functional
  difference either way.
- Anything requiring a **provisioned Supabase table** that hasn't been
  created yet (see `docs/SETUP-CHECKLIST.md`) will silently run in-memory
  instead — not broken, just not persisted. The startup log for each API
  says which mode it's in ("Source: Supabase Postgres..." vs "Source:
  seeded in-memory store...").

---

## 5. Quick sanity check before doing anything else

```bash
npm install     # if you haven't since a fresh clone
npm test        # should read: passing, hermetic, no network
```

If this doesn't pass cleanly, stop and fix that before trusting any of the
above — it's the one standing rule this whole project runs on.
