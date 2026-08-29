# Which role am I acting as? — the sidebar's answer, and the server shape it needs

**Status:** the labelling half is BUILT and shipped in `zaf-app/` (`main.js`'s
`renderApprovalRoles` / `attachRolePicker`, each panel's `approvalRoles(view)`).
The entitlement half is PART BUILT: **one** API sends `approvalRoles` — UC-03,
via `approvalRoles()` in `src/uc03/signoffPolicy.js`, `youHold` included — and
the other eight fall back to the panel's own descriptor, where the sidebar is
honest about not knowing. §4 said "no API sends it" for as long as that was
true; it stopped being true when the travel-letter sign-off landed.

---

## 1. The question, and why the tags could never answer it

A specialist looked at a live UC-04 escalation (Zendesk ticket #51, raised
through the request portal) and asked:

> "does the tag section show me which type of human approval that i am acting
> as?"

and then, more sharply:

> "you know i will be acting as multiple and different types and levels and
> roles of human approvers. So there needs to be a clear indication when i am
> playing a role. There needs to be a logical place to enter that role."

`uc04_specialist_approval` and `queue_mobility_specialists` are **routing**
metadata — `src/shared/escalationRouting.js` emits them so the ticket lands in
the right queue. They record where the ticket went. They say nothing about what
the person now reading it is being asked to *be*, and a Zendesk tag box is not
where anybody looks for that.

It got sharper the same day. Role entitlement landed (commit `2f3c722`,
`src/review/approverEntitlement.js`), so an approver can now be refused
`approver_not_entitled` **on click** — which is the worst available moment to
discover you were never the right person for this ticket.

## 1b. …and the question that came before it: *who is this about?*

The same specialist, on the same bundle, a day later:

> "In that Zendesk bar I never even saw any relevant info of the employee — not
> even name. That is bad."

The role card answers *what am I being asked to be*. It could not answer *who is
this about*, and neither could anything else on the page: every panel opened
with a 36-character employment id, because none of the nine by-ticket views
published a name.

Both halves now exist. `src/shared/employeeSubject.js` publishes the person —
re-read from Remote when the panel is opened, so the screen and the button that
re-reads the same record before it acts can no longer disagree — and
`main.js`'s `renderEmployee()` draws it as a **"Who this is about"** card
directly under the header, above the decision and above this document's Decision
card. On UC-04 it also draws `basis.requester`: who filed the request, whether
they were acting for the subject, and what that does not establish.

The ordering rule between the two is worth stating, because it is easy to get
backwards: on a 🔴 dossier the mandatory framing statement stays FIRST. The
framing says what the whole document is; the person is who it concerns; the role
card is who may act. A warning that qualifies everything cannot sit below any of
it (commit `9914403`, pinned by test).

---

## 2. What the sidebar does now

Inside the **DECISION** card, above the controls (and above the refusal
sentence, so it is visible on cases that cannot be decided here at all):

* **"Who decides this"** — one plain sentence about how many people must sign,
  then one block per role: its name, what that role decides, whether the slot is
  `RECORDED` or `OUTSTANDING`, who filled it, and the exact grant string
  (`uc04:mobility_specialist`) to quote when asking to be added to the roster.
* **"Still to sign: …"** on a multi-role case — named, never counted, because
  UC-06's own approval meter a few lines below already says "1 of 2 approvals
  recorded" and two "1 of 2"s meaning opposite things is worse than silence.
* **"Acting as"** — a `<select>` on UC-06 and UC-09, modelled on the request
  portal's "Signed in as" persona picker, defaulting to the first slot nobody
  has signed. It shows one role's form at a time.
* **The honest sentence**, while nothing answers entitlement: *"Whether you hold
  this role is checked by the API when you submit — this panel is not told, and
  does not decide it."*

### The picker grants nothing, structurally

It changes which form is on screen and nothing else. Each form still posts its
own fixed `role` — `customer_admin`'s block has always posted `customer_admin`
— so picking a role here is exactly as authoritative as scrolling to that block
was, which is to say not at all. *(UC-06's `customer_admin` block is being
renamed to `employer` — DRIFT-098, `[A-2]`; the labels change, the "grants
nothing" property does not.)* Identity comes from the signed ZAF token
(`src/shared/approverAuth.js`); entitlement comes from the roster
(`src/review/approverEntitlement.js`); a person who does not hold the role is
refused whatever the picker says. `test/zafApprovalRole.test.js` pins this by
reading the function's source and asserting it never reaches `view.post`,
`cxPost`, `approver`, `actionable` or `youHold` — its whole effect on the DOM is
a display class.

### What the browser must never do

Decide whether *this* agent holds a role. That is a judgement about a person
against a roster; it lives server-side. The bundle is downloadable by anyone
with an agent seat, so a roster in it would be both a disclosure and a second
copy of an access control — and the copy would be the wrong one, because it
cannot be updated without a re-upload.

## 3. The server shape the sidebar is already waiting for

Add to each `GET .../by-ticket/:externalRef` response (and the `/:id` sibling):

```jsonc
"approvalRoles": {
  // The card's own heading reads "Who decides this", and the role row below
  // names the specialist and what they decide. A summary carries only what
  // neither of those can — here, the ABSENCE of a second signature.
  "summary": "There is no second signature on this one.",
  "roles": [
    {
      "roleId": "uc04:mobility_specialist",   // exactly as APPROVER_ROLES spells it,
                                              // or null for a use case with no roster
      "label": "Mobility specialist",         // what a person calls it
      "decides": "whether this trip may go ahead as planned",
      "filledBy": null,                       // who has signed this slot
      "filledOn": null,                       // formatted for a human, server-side
      "filledAs": null,                       // "Approved" / "Declined" / "Signed off"
      "youHold": false                        // THE ONLY NEW FACT. true / false / null
    }
  ]
}
```

`main.js` already passes this through on all nine loaders and prefers it over
the panel's own descriptor, so the two halves can be built in either order —
which is the lesson from the signed-read path, where an API and a bundle each
waited for the other and neither worked.

**`youHold` is the only field the browser cannot produce.** Everything else is
already correct in the bundle. Resolve it as:

```js
const { entitlement } = resolveEntitlement(process.env, { persistent: Boolean(pgPool) });
const youHold = entitlement
  ? entitlement.check({ useCase: "UC-04", role: "mobility_specialist", approver: reader }) === null
  : null;   // null, NOT true — "not enforced here" is not "you hold this role"
```

Three rules for the server side, each of which the sidebar depends on:

1. **`null` when entitlement is not enforced** (the seeded demo posture). The
   sidebar then prints its honest "checked when you submit" sentence rather than
   a green tick nothing checked. `entitlement.check()` returning `null` means
   "nothing to say", and it can only ever refuse — see that module's property 2.
2. **`false` must be safe to show.** It renders as *"You do not hold this role,
   so a decision submitted under it will be refused."* — a statement about a
   refusal that will happen, which is exactly what the server already does on
   submit.
3. **The reader is the verified identity**, `resolveReader()` /
   `resolveApprover()` — never a header or a body claim, or `youHold` would be a
   claim about a claim.

### Posture, in one line each

| posture | entitlement | what the sidebar should show |
|---|---|---|
| seeded / in-memory demo | not enforced | role names + the picker, `youHold: null` — a demo affordance, labelled as one |
| durable store attached, or publicly reachable | enforced | role names + the picker + `youHold` on every slot, so the agent learns it from the screen and not from a 403 |

The discriminator is the same one `signedIdentityRequired()` and
`entitlementRequired()` already share (commit `39a7e33`). One rule, not three.

## 4. What is still open

* **Eight of the nine APIs still send no `approvalRoles`.** UC-03 sends it
  (`src/uc03/signoffPolicy.js`); the rest fall back to each panel's own
  descriptor, which is pinned against `USE_CASE_ROLES` by
  `test/zafApprovalRole.test.js` so the two vocabularies cannot drift.
* **Seven of the nine still send no `employee`.** UC-02, UC-03, UC-04, UC-05,
  UC-06 and UC-09 publish it (`describeEmployee()`); UC-01, UC-07 and UC-08 do
  not, so those three panels still open on an employment id. The loaders already
  pass the field through, so each gains the "Who this is about" card the moment
  its own API sends one — no sidebar change.
* **`basis.requester` exists on UC-04 alone.** It is the richest account of the
  parties anywhere in this repo — who filed it, for whom, what identity actually
  proved, and what none of it establishes — and eight panels have no equivalent.
* Zendesk group membership as the entitlement source (the right end state — the
  groups are already emitted by `src/shared/escalationRouting.js`) is blocked on
  the groups not existing in the account and the OAuth client having no scope
  for `GET /api/v2/groups`. `createEntitlementChecker({ grants })` already takes
  a resolved map, so that is a resolver, not a redesign.

## 5. Screenshots

* `docs/screenshots/zaf-sidebar-uc04-who-decides.png` — the whole UC-04 sidebar.
* `docs/screenshots/zaf-sidebar-uc04-decision-card.png` — the card on its own.
* `docs/screenshots/zaf-sidebar-uc06-roles-outstanding.png` — dual control, one
  slot signed, the picker open on the outstanding one.
* `docs/screenshots/zaf-sidebar-uc04-settled-decision.png` — a settled approval
  rendered as labelled rows rather than a run-on paragraph.
* `docs/screenshots/zaf-stakeholder-<case>-{before,after}[-dark].png` — all nine
  panels at 340px in both themes, before and after the 1.8.0 pass that added the
  "Who this is about" card. `uc04` and `uc04-approved` are the same case
  awaiting a signature and after one; `uc07`/`uc08` are the two 🔴 dossiers, with
  the framing statement still first.
