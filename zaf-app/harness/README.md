# Driving the sidebar without a Zendesk login

`zaf-app/` is a static bundle Zendesk hosts inside an iframe. `CLAUDE.md`'s
standing advice for iterating on it is `zcli apps:server zaf-app` plus
`?zcli_apps=true` on a ticket URL — which needs an **agent browser session**,
i.e. somebody's Zendesk email and password. An API token does not buy one:
`/agent/tickets/<id>` redirects to a password form, and adding an OAuth bearer
header just reaches Zendesk's bot check (verified 2026-08-23).

So there was no way to test the sidebar's real rendering from a coding session,
and `test/zafApp.test.js` can only compile the assets — it never boots them.

This harness boots the **real, unmodified `assets/main.js`** outside Zendesk.

```bash
node src/review/cli.js &                       # the API the sidebar posts to
python3 -m http.server 4099 --directory .      # from the repo root
# then open:
#   http://127.0.0.1:4099/zaf-app/harness/iframe.harness.html?ticket=2001
```

## What it is, and what it is not

`zaf-client-stub.js` implements **only** what `main.js` actually calls —
`metadata()`, `get()`, `invoke()`, `request()` — and nothing else. It is a
harness, not a mock of Zendesk.

**It does not exercise ZAF's signed-identity path.** `request()` here strips the
`{{jwt.token}}` placeholder rather than substituting a real signed token, so the
bundle takes its own documented no-ZAF fallback. Signature verification must be
tested against the API directly (see
`qa/evidence/UC-01/2026-08-23-uc01-live-ground1/VC-33-AND-SPECIALIST.md`), and
the real ZAF SDK is removed from this page because outside an iframe its
`init()` returns null and it would overwrite the stub.

**A green run here is not a green run in Zendesk.** It proves the bundle's
rendering, its panel registry and its decision wiring — the things that were
previously unverifiable at all.

## What it proved on 2026-08-23

- The sidebar boots and renders a full case with **zero JavaScript errors**.
- Approve works end to end: `GET /api/review/ticket/2001` then
  `POST /api/review/ticket/2001/approve`, and the panel reports *"Approved —
  recorded in the audit log. The verification letter was issued and the ticket
  solved."*
- An **empty reason is refused and the refusal is SHOWN**: `.action-status`
  reads *"A reason for the decision is required and is recorded in the audit
  log."*, carries the `bad` class, and both buttons re-enable. This was briefly
  mis-reported as a silent failure by a probe that only read the first 500
  characters of the page — the status line is at the bottom of the section.
  **Read the element, not a prefix of the page.**
- An **escalated** case renders with **no Approve button at all**.
- The panel states its own entitlement posture out loud: *"Any support
  specialist can decide this one — UC-01 has no named approval role."*
