# The live Zendesk account — one register

**Everything in the "Read live" tables below was read from the Zendesk API on
2026-08-30**, not copied from another file. That matters here more than in most
documents: this project has moved Zendesk account **twice** (`your-subdomain` →
`your-subdomain` 2026-08-15 → `your-subdomainhelp` 2026-08-29), every id is
account-scoped, and each move left correct-looking ids scattered through the
repo that now name nothing. If a number here disagrees with `CLAUDE.md`, re-read
it from the API before believing either.

> **Why this file exists at all.** `CLAUDE.md` had grown to 178 KB and its own
> §START HERE section documents what that costs — an agent spending its context
> on history before reading its task. Account configuration is exactly the kind
> of content that should be *fetched when needed* rather than loaded by every
> agent on every turn: it is long, it is a lookup table, and it is wrong the
> moment the account moves. §4's Live-resources list keeps a one-line pointer
> here instead of the detail.

Re-read the whole file from the account in one command:

```bash
node scripts/zendesk-account-report.mjs      # see §6 — not yet written
```

---

## 1. Account

| | |
|---|---|
| subdomain | **`your-subdomainhelp`** (`ZENDESK_SUBDOMAIN`) |
| the automation acts as | **Sammy Zen** `99900000000009` `<sammyzendesk@gmail.com>` — the OAuth client's owner |
| other admin | `99900000000009` `<kindnessagbo9@gmail.com>` |
| OAuth client | `remote-ikan` `99900000000009`, **confidential**, carries both n8n redirect URLs |
| ZAF app | `1288211`, manifest 1.10.10, enabled |

**`client_credentials` needs a CONFIDENTIAL client with Allowed scopes
populated.** A public client returns `unauthorized_client`; so does a
confidential client with a wrong secret — the two are indistinguishable, so that
error says nothing about the secret. `invalid_client` is the only response
meaning "no such client". Full four-way control in `CLAUDE.md` §6.

## 2. Custom field — read live 2026-08-30

| id | title | type |
|---|---|---|
| **`9990000000001`** | Remote Employment ID | text |

This is `ZENDESK_EMPLOYMENT_ID_FIELD_ID`, and it must be set on the Vercel
project too. **Zendesk discards an unknown field id silently and returns 200**,
so the only proof that it is right is raising one portal request and reading the
field back off the ticket — not reading the env var, and not `/__cx/health`.

## 3. Groups — read live 2026-08-30

| id | name |
|---|---|
| `99900000000009` | Finance Ops |
| `99900000000009` | HR Ops |
| `99900000000009` | Local HR & Legal |
| `99900000000009` | Mobility & Legal (Tier-2) |
| `99900000000009` | Mobility Legal (Tier-3) |
| `99900000000009` | Mobility Specialists |
| `99900000000009` | Payroll Ops |
| `99900000000009` | Support (Zendesk's default) |
| `99900000000009` | Tax Operations |
| `99900000000009` | Travel & Mobility Support |

`npm run sync-groups` writes these into `src/shared/escalationGroupIds.js`.
**Nothing may hold a second copy** — `src/approvalqueue/demoSeed.js` and
`test/approvalQueue.test.js` once did, kept the retired numbers through a
migration, and made the queue call every owning-team ticket `elsewhere`. Both
now read `ESCALATION_GROUP_IDS`.

**A group with no members cannot solve a ticket.** `assign_tickets_upon_solve`
assigns the solving user, who must be a member of the ticket's group, so an
empty group fails `422 RecordInvalid — Assignee: is required when solving a
ticket` — an error naming the assignee, not the membership. Both admins are
members of all ten (20 memberships).

## 4. Triggers — read live 2026-08-30, 18 on the account

| id | title |
|---|---|
| `99900000000009` | UC-01 verification v2 |
| `99900000000009` | UC-02 intake — `uc02_test` tickets only |
| `99900000000009` | UC-03 intake — `uc03_test` tickets only |
| `99900000000009` | UC-04 intake — `uc04_test` tickets only |
| `99900000000009` | UC-05 intake — `uc05_test` tickets only |
| `99900000000009` | UC-06 intake — `uc06_test` tickets only |
| `99900000000009` | UC-07 intake — `uc07_test` tickets only |
| `99900000000009` | UC-08 intake — `uc08_test` tickets only |
| `99900000000009` | UC-09 intake — `uc09_test` tickets only |
| **`38746828978973`** | **Assign automation tickets to Sammy Zen (demo visibility)** — §5 |

All nine intake triggers gate on a `uc0N_test` tag **and** the employment field
being present. A portal-raised ticket carries a plain `uc0N` tag, so it
deliberately drives no n8n workflow.

**A trigger holds the employment field id three times in three syntaxes** —
`custom_fields_<id>` in the condition, `"id":<id>` in the webhook payload, and
`{{ticket.ticket_field_<id>}}` inside a string inside that payload. A
field-by-field walk fixes the first and misses the other two, and the ticket
then arrives with no employment id while every layer reports 200.

**A wedged trigger cannot be repaired — recreate it.** A trigger can read back
perfectly (`active: true`, correct conditions, correct webhook) and never fire
again. Creating a new record with byte-identical conditions fixes it instantly.
Do not bisect conditions against a circuit-broken webhook: that proves nothing.

## 5. The auto-assign trigger `38746828978973` (2026-08-30)

**Live account config that exists in no other file in this repo**, which is why
it is written down: a future session would otherwise find every ticket owned by
one person with nothing to explain why.

| | |
|---|---|
| fires on | ticket **Create** only |
| and | `assignee_id` is empty |
| and | `current_tags` includes `portal_request` or any of `uc01`…`uc09` (and the `uc0N_test` spellings) |
| action | assignee → Sammy Zen `99900000000009` |

`group_id` is **not** in its actions, so routing is untouched — a Finance Ops
ticket still goes to Finance Ops and merely also carries a name. `update_type
is Create` means it cannot re-grab a ticket deliberately reassigned later.

**Proven, not assumed:** a matching ticket was created, the assignee read back
off the API, and the ticket deleted. The `201` from the create was not treated
as evidence.

### Why it exists

Zendesk's agent home (`/agent/home/tickets`, "Get Started → Your work →
Tickets") lists **only tickets assigned to the logged-in agent**. Group
membership does not put one there — measured 2026-08-30: the agent was a member
of all ten groups and the page still read **0**. The automation routes to a
group and leaves `assignee_id` null by design, so that page was empty *by
construction* and every new portal submission looked like a failure. 24
pre-existing unassigned tickets were bulk-assigned in the same pass.

### The trade it makes

**Every ticket now shows an owner on camera**, which reads as "someone is
handling this" rather than "this is sitting in a queue". The approval queue's
*"nobody can reach this"* analysis derives from **groups**, not assignees, so it
is unaffected — but a screen recording of the Zendesk queue now tells a slightly
softer story than the queue itself does. Deactivate in Admin Center → Business
rules → Triggers to get the original shape back.

### Views, for browsing without it

| url | shows |
|---|---|
| `agent/filters/99900000000009` | All unsolved tickets |
| `agent/filters/99900000000009` | Your unsolved tickets |
| `agent/filters/99900000000009` | Unassigned tickets |

## 6. What is NOT here

- **Webhooks and the shared secret** — `docs/WEBHOOK-AUTH.md`. Rotation order is
  **Zendesk first, n8n second**, and a Zendesk webhook that fails once
  circuit-breaks permanently.
- **Which links in the live chain are proven** — `docs/LIVE-PATH-STATUS.md`.
- **Ticket references from retired accounts** — `src/shared/zendeskAccounts.js`
  and `CLAUDE.md` §7 item 23. Ticket numbering restarts at 1 per account, so a
  stored bare integer can silently resolve to a real, unrelated ticket.
- **A `zendesk-account-report.mjs` script.** Referenced at the top of this file
  and **not yet written** — every table above was assembled by hand from API
  reads this session. Named rather than quietly omitted, because a register that
  cannot be regenerated is a register that will be stale and look current.
