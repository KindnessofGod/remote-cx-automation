# `zaf-app/` — the Zendesk sidebar

A Zendesk Apps Framework **v2** ticket-sidebar app. It is the 🟡 human-in-the-loop
gate made clickable: for the ticket an agent is looking at, it shows what the
automation decided and why, and — only when the case is open to a decision —
offers **approve / deny**.

Every approve and every deny writes a row to `audit_log`. That is the point of
the whole thing: it is what turns the HITL accept-rate metric in
`docs/METRICS.md` from a definition into a measurement.

## Shape

```
zaf-app/
  manifest.json          ZAF v2 manifest — ticket_sidebar location, apiBaseUrl +
                         cxSharedSecret (secure) settings
  assets/iframe.html     the iframe Zendesk loads
  assets/main.js         the SHARED shell — decision, flags, reason, the gate
                         ladder, the decision basis, approve/decline
  assets/panels.js       PER-USE-CASE panels — all nine registered
  assets/style.css       palette shared with the metrics dashboard
  translations/en.json   required by ZAF
```

`main.js` + `panels.js` is the split `00-FOUNDATION.md` §6 asks for: one shared
`zaf-sidebar` shell that each HITL use case *registers a panel* with. Adding
UC-06's dual-approval view means adding a key to `window.CXPanels`, not building
a second app.

## The account of *why*, and the distinctions it must not flatten

Under the reason, the sidebar renders two things its APIs had been computing and
shipping all along while nothing displayed them:

- **`gateLadder`** — every rung of the real evaluation order, each marked
  `passed` / `decided` / `not_reached`, collapsed under the rung that decided.
  **`not_reached` is not `passed`**: a gate that never ran approved of nothing,
  and `docs/GATES.md` calls reading it as "fine" the single most common
  misreading of a decision panel. The ladder draws the two differently — a solid
  state rail against a dashed one — and says so in words as well.
- **`decisionFacts` / `basis`** — the figures the gate actually compared, and,
  where a figure is not held, an explicit unknown with what it would take to
  make it an answer. Each dimension carries a state, and **`cleared` is the only
  one that means fine.** `unknown` (the check ran, its data was absent),
  `unavailable` (the check does not exist yet), `not_assessed` (an earlier gate
  decided first) and `suppressed` (a limit was *excused*, which is a different
  fact from being within it) are all absences of a verdict, and they are
  absences of different things. They are drawn as a **hollow ring**, never a
  filled state dot, so an absence cannot be skim-read as a pass. A `suppressed`
  measurement additionally prints the provenance of whatever suppressed it — for
  a Portugal workation, that the Schengen 90/180 check was skipped on the
  authority of a five-entry hand-written list whose own record reads
  "[PROPOSED] — illustrative, no authority".

All of it is **rendered, never derived**: every word, state and figure is
computed server-side by pure describers (`src/shared/gateLadder.js`,
`src/shared/decisionFacts.js`, and each use case's own `decisionFacts.js`) that
decide nothing. The renderers live in the shell rather than in nine panels, and
none of them draws a control — 🔴 UC-07 and UC-08 get the richer dossier and
remain exactly as unactionable as before, because `view.actionable` is still the
only question that gates a button and it is still asked in one place.

Screenshots of each of these against real seeded cases are in
`docs/screenshots/`.

## Which role am I acting as?

A specialist looking at a live UC-04 escalation asked whether the ticket's tags
told them which kind of approver they were being asked to be. They do not:
`uc04_specialist_approval` and `queue_mobility_specialists` are **routing**
metadata — where the ticket went, not what the reader is — and a tag box is not
where anyone looks for that. It matters more since role entitlement landed
(`src/review/approverEntitlement.js`), because an approver can now be refused
`approver_not_entitled` *on click*.

So the DECISION card opens with **"Who decides this"**: one plain sentence about
how many people must sign, then one block per role — its name, what that role
decides, `RECORDED` or `OUTSTANDING`, who filled it, and the exact grant string
(`uc04:mobility_specialist`) to quote when asking for access. It renders in both
states, so a case nobody can decide here still says whose decision it is.

On UC-06 and UC-09 there is also an **"Acting as"** picker, shaped after the
request portal's "Signed in as" persona picker and defaulting to the first slot
nobody has signed. **It grants nothing and structurally cannot**: it shows one
role's form at a time, and each form still posts its own fixed `role`, exactly
as it did when both were on screen at once. Identity comes from the signed ZAF
token and entitlement from the roster; a person who does not hold the role is
refused whatever the picker says.

**Whether *this* agent holds a role is never computed here.** That is a
judgement about a person against a roster and it lives server-side. `main.js`
prints it only when an API sends `approvalRoles[].youHold`, and while nothing
does, the card says plainly that the check happens on submit. The shape a server
should send — and the one the loaders already pass through — is in
`docs/SIDEBAR-APPROVAL-ROLES.md`. Each panel's `approvalRoles(view)` descriptor
is pinned against `USE_CASE_ROLES` by `test/zafApprovalRole.test.js`, so the
names the sidebar prints and the grants an operator can issue cannot drift.

A **settled** decision renders as labelled rows, not prose: `settled`
(`{headline, facts, finality}`) goes straight into the same definition list the
Case card uses. Its string sibling joins those facts with newlines, which HTML
collapses — which is how a carefully-labelled account reached the screen as one
run-on sentence.

## Three rules the app follows

1. **No credentials.** A ZAF bundle is downloadable by anyone with an agent
   seat. Every secret stays in `src/review/server.js`.
2. **No decisions.** Whether the buttons appear comes from the API's
   `actionable` flag, which comes from `src/review/reviewPolicy.js`. The UI never
   re-derives that rule — `docs/BUILD-LOG.md` records what duplicated gates cost
   the n8n build, and this is the same mistake one language over.
3. **No `innerHTML`.** Every dynamic value is written with `textContent`. This
   screen renders content that came from a support ticket, which is untrusted
   text by definition.

## Running it

```bash
npm run review-api          # the backend, seeded with real cases, on :4020
```

Then, with the [ZCLI](https://developer.zendesk.com/documentation/apps/zcli/):

```bash
zcli apps:server zaf-app    # serve locally, then open a ticket with ?zcli_apps=true
zcli apps:package zaf-app   # build the uploadable zip
```

`npm run review-api` seeds four real cases through the actual workflow when
Supabase isn't configured — an actionable third-party request, an actionable
attachment request, an escalation (which must refuse to be actioned), and a
clean auto-resolve. Point `apiBaseUrl` at `http://localhost:4020` and the
sidebar is demonstrable with no credentials at all.

## Honest status

- **Signed requests are now built — reads as well as writes — and are used
  whenever the `signWrites` checkbox is ticked.**
  Every request goes through one helper (`cxRequest()` in `assets/main.js`,
  with `cxGet()`/`cxPost()` as thin verbs over it) which, in that posture,
  issues the call via ZAF's own `client.request()` with a `jwt` block — HS256,
  signed on Zendesk's servers from `{{setting.cxSharedSecret}}`, forwarded as
  `Authorization: Bearer {{jwt.token}}`. The server verifies it against
  `ZAF_SHARED_SECRET`: on a write it then uses **only** the verified claim as
  the approver, and on a read it simply refuses without one.
  Set both sides to the same value.
  - **Reads were the gap, and it was the serious half.** Until this pass the
    nine panel loaders each read with a bare `fetch()`, matching an API that
    checked signed identity on `POST` only — so every `GET` on the public
    deployment returned an employment id, the requester's real email address
    and the full decision record to anyone, over sequential integer ticket ids.
    Signing only writes protects who an approval is attributed to while
    publishing the thing being approved.
  - The setting keeps the key `signWrites` even though it now governs reads
    too: renaming a parameter on an installed ZAF app discards the value every
    admin already saved, and an unticked box means every request goes out
    unsigned. Its label and help text say "requests".
  - What that proves, stated exactly: the call came through a real installed
    instance of this app in an account holding the secret. It does **not**
    cryptographically prove which agent clicked — the claims are supplied by
    this app's own JavaScript. It closes the threat that matters (anyone with
    `curl` naming themselves the approver on a public URL); it is not per-agent
    attestation.
  - The earlier RS256 mechanism in `src/review/zafAuth.js` is kept but is for a
    **server-side app**, which this is not. Configuring both is refused rather
    than resolved.
- With `signWrites` unticked, the sidebar falls back to unsigned requests
  carrying the original `X-ZAF-Approver` header, which a **demo** server trusts
  and a deployed one refuses (401) — for a read as well as an approve. That is
  the local `npm run review-api` path, and it is also the only path that works
  against `localhost`, since a signed request is proxied by Zendesk's servers
  and they cannot reach your laptop. The failure direction is the safe one in
  both verbs: a misconfigured install loses the ability to see or approve a
  case, never the requirement to be authenticated to do either.
- The app IS installed and enabled in the live account — "Remote CX Review
  v1.01", app id `9990001`, verified against `GET /api/v2/apps/installations.json`
  on 2026-08-18. This README said the opposite for weeks after it stopped being
  true, which is worth remembering: verify an install claim against the account,
  not against a checklist. An installed ZAF app is a **static upload** — it does
  not track this repo, so a change to `assets/` reaches the account only after
  `zcli apps:update`.
