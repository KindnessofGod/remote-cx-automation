# UC-01 live path — what is verified, and what is not

> **UPDATED 2026-08-23 20:52Z — §2's last three rows are no longer UNKNOWN.**
> The n8n half of the chain is now verified end to end on the real account
> (`6ff5b28`, ticket **#125**), and the deployed graph has been read back off
> the live API (`WORKFLOW_UC01_ID`, 38 nodes). **The whole file below this line
> still reads as it did on 2026-08-19** apart from those three rows and §2's
> verdict — the narrative in §3 onward describes the 08-19 session and has not
> been re-run, so treat its *reasons* as historical while its *findings* stand.
> This banner exists because the three UNKNOWN rows sat here for four days after
> one of their stated reasons had stopped being true, and a reader who trusted
> them would have concluded the opposite of the truth.

**Written 2026-08-19.** Every claim below was checked in this session against
the real service named, from the coding container. Nothing here is carried over
from an earlier note. Where a link could not be checked, it says so and says
why — because the point of this file is that nobody films a claim that has not
been re-tested since the Sandbox was reseeded.

Re-run the machine-checkable half at any time:

```bash
NODE_USE_ENV_PROXY=1 npm run verify-live-uc01     # read-only, writes nothing
```

---

## 1. Why this file exists

UC-01's chain — real Zendesk ticket → trigger → webhook → n8n → OpenAI classify
→ Remote read → decision → public letter → ticket solved → real `audit_log` row
— was green on 2026-08-15 (ticket #6, solved five seconds after the customer
comment). It is the intended opening shot of the demo video.

That run used employment **`fde4007b-6257-4504-9467-8d61b5785488`**, and the
Remote Sandbox has since been **reseeded**. That id is gone. Every "known good
employee" payload in this repo's history pointed at it. So the whole chain was
of *unknown* status — not broken, not working, unknown — and a demo recorded
against an unknown chain is a demo that can fail on camera.

---

## 2. Verdict

**As of 2026-08-19: the Node half of the chain is verified working, end to end,
against live services. The n8n half is unverified from here and remains
unknown.**

**As of 2026-08-23: the n8n half is verified too, and the chain is green end to
end.** Real ticket **#125** on the real account, requester email taken from the
persona's *live* Sandbox record so the identity gate had something true to
match; nothing pinned, no manual n8n run, no direct webhook `POST`:

```
20:24:27  ticket created
20:24:37  audit_log 675de436 written — source "zendesk", all_gates_passed
20:24:39  letter posted publicly, rendered HTML
20:24:41  solved, tagged uc01_auto_resolved
          plus 1 workflow_claims row, 0 ops_alerts
```

The audit row **precedes** the customer-facing reply by two seconds, which is
the ordering the architecture exists to guarantee and the first live evidence of
it on this chain since the reseed. No salary in the letter, checked on the
**rendered comment** rather than on the node's success flag. Evidence:
`qa/evidence/UC-01/2026-08-23-uc01-zendesk-live/README.md`.

**One thing that run found which this file could not have predicted:** a
*third-party* integration (Ultimate.ai, trigger `6151614032671` at position 3)
posts "a member of the support team will get back to you within the next 48
hours" publicly, one second after UC-01 has already solved the ticket. The chain
is correct; the ticket still ends up carrying a contradictory reply. Ruled and
queued — `qa/HUMAN-DECISIONS-REQUIRED.md` §K5, bead `rca-wrui`.

| Link | Status | How it was checked |
|---|---|---|
| Demo employment ids are alive | ✅ **Verified** | `GET /v1/employments/{id}` on `gateway.remote-sandbox.com`, both ids `200` + `active` |
| `fde4007b-…` is dead | ✅ **Confirmed dead** | `GET /v1/employments/fde4007b-…` → `404 {"message":"Employment not found"}` |
| Real OpenAI classification | ✅ **Verified** | live `handleVerificationTicket()` run, `classification.source: "llm"` (not the rule-based fallback) |
| Real Remote employment read | ✅ **Verified** | same run, live Sandbox record, no mock, no fixture |
| Identity gate | ✅ **Verified both directions** | passes on a matching signal; refuses a stale address with `requester_employment_mismatch` |
| Decision — positive path | ✅ **Verified** | `auto_resolve` / `all_gates_passed`, zero flags |
| Decision — refusal path | ✅ **Verified** | salary asked → `human_review` / `over_scope_request` |
| Letter renders, zero salary | ✅ **Verified against live figures** | the live records carry `25000` and `10399748`; neither appears in the rendered letter, nor does any salary word |
| n8n gates *logic* vs live payload | ✅ **Verified (repo source only)** | `workflows/nodes/gates.js` run in a `vm` against the live Remote payload |
| Zendesk trigger + webhook exist and are active | ✅ **Verified** | read-only Zendesk API |
| **Deployed n8n graph** | ✅ **Verified** | read back off the live graph 2026-08-23 20:19Z: `WORKFLOW_UC01_ID`, 38 nodes, `versionId === activeVersionId === 0d4694e3-…`. The old reason on this row — *"the n8n MCP connector is not authorised in this session"* — was **wrong**, and it stood for four days: the connector answers, and `rca-wn30` republished this graph through it at 19:55Z |
| **Zendesk ticket → trigger → webhook → n8n, live** | ✅ **Verified** | driven end to end on the real account, `6ff5b28`: ticket **#125**, nothing pinned, no manual n8n run, no direct webhook `POST` |
| **n8n → real `audit_log` row** | ✅ **Verified** | same run: `audit_log` **`675de436`**, `source: "zendesk"`, `all_gates_passed`, written **20:24:37** — two seconds *before* the public reply at 20:24:39 |

---

## 3. What was verified, in detail

### 3.1 The ids

`fde4007b-6257-4504-9467-8d61b5785488` → **`404`**. Dead, confirmed, not a
credential or host problem: the same token in the same shell resolves other ids
`200` in the same second.

Live and `active`, re-verified by id this session:

| Id | Name | Type | Country | Email on record |
|---|---|---|---|---|
| `3537d9ee-2017-4a53-952e-9d3b042aeab5` | Alexandre Tremblay | contractor | CA | `owner+contractor-contractor_of_record-can-19@rempel-paucek-4c3wac.example.com` |
| `2f7f8210-91fc-47db-803c-77a1cc625781` | Alex Morgan | employee (EOR) | US | `owner+employee-eor-usa-10001@rempel-paucek-4c3wac.example.com` |
| `09b65526-643b-4956-959b-916e6429bd23` | Anna Müller | employee (EOR) | DE | `owner+employee-eor-deu-4@rempel-paucek-4c3wac.example.com` |
| `d73cff71-ced7-4bcf-b764-b9899abc6340` | Emma Thompson | employee (EOR) | GB | `owner+employee-eor-gbr-13@rempel-paucek-4c3wac.example.com` |

`3537d9ee-…` is the same person as the dead id, which is why it is the demo
default: the narrative recorded in `docs/DEMO-SCRIPT.md` does not change.

### 3.2 The workflow, live

Two scenarios per employee, deliberately. A system that refuses everything and a
system that works are indistinguishable from refusals alone — that is the
methodological lesson §5 of `CLAUDE.md` paid for three times. So the standard
request is a **positive** test that must succeed:

```
Alex Morgan / standard request:      auto_resolve  all_gates_passed        flags=[]                             source=llm  letter=3788 chars
Alex Morgan / salary asked:          human_review  over_scope_request      flags=[over_scope_disclosure_requested]  source=llm  letter=none
Alexandre Tremblay / standard:       auto_resolve  all_gates_passed        flags=[]                             source=llm  letter=3805 chars
Alexandre Tremblay / salary asked:   human_review  over_scope_request      flags=[over_scope_disclosure_requested]  source=llm  letter=none
```

`source=llm` is the load-bearing token: the classification came from a real
OpenAI call, not the rule-based fallback that would answer identically if the
key were dead.

### 3.3 No salary in the letter

Asserted against the figures the **live** record carries, not against a fixture
that happens to have none. Alexandre's record carries
`contract_details.payment_terms.compensation_gross_amount: 25000`; Alex Morgan's
carries `contract_details.annual_gross_salary: 10399748`. Neither number appears
anywhere in the rendered letter, and neither does the word *salary*,
*compensation*, or *gross*.

### 3.4 The n8n gates body against the live payload

`workflows/nodes/gates.js` — the body of the "Identity + Policy Gates" Code node
— run in a `node:vm` against the raw live `GET /v1/employments/{id}` response and
a Zendesk-shaped requester email:

```
requester email matches the record:       auto_resolve  all_gates_passed    identity=true  (requester_matches_employment)
requester email is the pre-reseed address: escalate     identity_not_verified identity=false (requester_employment_mismatch)
```

So the n8n-side logic still parses the reseeded record shape correctly, still
finds the email where Remote now puts it, and still fails closed on a stale
address. **Scope limit, stated plainly: this is the body in this repo, not the
body n8n is serving.** It does not prove the deployed graph matches.

### 3.5 The Zendesk side, read-only

| Resource | State |
|---|---|
| Trigger `9990000000004` "UC-01 verification v2" | `active: true`, three-condition tag guard intact (`uc01_test` + employment field present + none of the outcome tags), firing webhook `01ZENDESKWEBHOOKIDPLACEHLD` |
| Webhook `01ZENDESKWEBHOOKIDPLACEHLD` | `active`, endpoint `…/webhook/uc-01-verification?src=zendesk` |
| Custom field `9990000000001` "Remote Employment ID" | exists, `type: text`, `active: true` |
| Last webhook invocation | **`200 success`, 2026-08-16 19:56 UTC** — six successes and one older `terminated` in the retained history |

Nothing has driven UC-01 through Zendesk since 2026-08-16, i.e. **not once since
the reseed**. That is the whole reason this file exists.

---

## 4. Two findings that will bite the demo

### 4.1 The evidence tickets are gone

`GET /api/v2/tickets/3|4|5|6.json` all return **`RecordNotFound`**. Tickets #2
through #18 no longer exist on `your-subdomain`; the account holds #1 and then #19
onward. **Ticket #6 — the green-chain proof cited in `CLAUDE.md` §4 and the one
the demo script points at — cannot be shown.** A fresh ticket has to be created
and re-proven before filming, and this is not something to discover with a
camera running.

### 4.2 A hand-made ticket from the existing "Alexandre Tremblay" user fails closed

The Zendesk account still holds end-user **`6154475522463` "Alexandre Tremblay"**
whose address is the **pre-reseed** one:
`owner+contractor-contractor_of_record-can-19@howe-dickens-and-conn-dq6kjb.example.com`.
The live Remote record for `3537d9ee-…` carries the `rempel-paucek-4c3wac`
address. A ticket raised **by hand** from that user therefore escalates with
`identity_not_verified` / `requester_employment_mismatch` and posts no letter —
which is the gate working exactly as designed, and looks on screen precisely
like the automation being broken.

Two ways past it, both fine:

- Drive the demo through `npm run livedemo`. It passes
  `requester: {name, email}` from `src/livedemo/employees.js`, and Zendesk
  matches a requester by **email**, so the ticket is raised under the current
  address whatever that stale user is called.
- Or use **Alex Morgan**: Zendesk user `6154473648671` already carries the
  current address, so a hand-made ticket from him works.

Fixing the stale user's email in Zendesk would also work and is a one-field
edit, but it is a write to a live account and was deliberately not made here.

---

## 5. What could NOT be verified, and why

1. **The deployed n8n graph `WORKFLOW_UC01_ID`.** The n8n MCP connector is not
   authorised in this session, so the live graph could not be read, diffed or
   driven. Nothing was worked around: no REST `PUT`, no webhook POST, no
   deploy. **Whether `activeVersionId === versionId`, and whether the deployed
   Code node bodies still match this repo, is unknown.** That comparison is the
   only thing that answers "is this live?" (`CLAUDE.md` §6) and it has to be
   done from a session that has the connector.
2. **The end-to-end Zendesk→n8n drive.** Not attempted — it means creating a
   real ticket on a live account with nine active automations attached, and the
   brief was to prefer read-only verification. Everything needed to do it is
   confirmed present (trigger active, webhook active, field present, employment
   live, requester email resolvable); nobody has pressed the button.
3. **The real `audit_log` write from n8n.** Follows from (2). Supabase Postgres
   is unreachable from this container anyway — `pg` opens a raw TCP socket and
   an HTTP CONNECT proxy cannot relay it — so even a successful drive would have
   to be confirmed with the Supabase MCP, not `psql`.
4. **Ultimate.ai's contradictory auto-reply.** Its trigger
   (`6151614032671`) and webhook are still active on the account. Untouched and
   unverified; `CLAUDE.md` §4 records it posting "a member of the support team
   will get back to you within the next 48 hours" *after* the automation had
   already solved the ticket. Still a poor demo surface until that trigger is
   scoped away from `uc01_test`.

---

## 6. Would a fresh clone have broken? No.

Checked rather than assumed. Every UUID hard-coded in `src/` and `scripts/` in
an employment-shaped position was resolved against the live Sandbox this
session. The only `404`s are `src/remote/mockServer.js` fixtures and
`src/auditview/demoSeed.js` placeholders (`22222222-…`), which are *meant* to be
fake and are never sent to the real API. Every id that does reach Remote —
`src/livedemo/employees.js`, `src/portal/personas.js`,
`scripts/demo-countries-matrix.mjs`, `scripts/seed-uc02-demo-expenses.mjs`,
`src/remotebridge/enrichment.js` — resolves `200`.

`fde4007b-…` survives in the tree only as **documentation that it is dead**
(`CLAUDE.md`, `docs/BUILD-LOG.md`, `docs/E2E-TEST-PLAN.md`,
`docs/CORRECTIONS-LOG.md`, `docs/PRODUCTION-READINESS.md`, `workflows/README.md`,
and a comment in `scripts/demo-countries-matrix.mjs`), plus two hermetic test
fixtures. One of those fixtures — `test/livedemo.test.js` — was updated to the
live id this session, not because the test needed it (it never touches the
network) but because a reader copying an id out of a file to debug something
live should not get a corpse. The other,
`test/normalizeEmployment.test.js`, belongs to `src/remote/` and was left alone.

So the dead id had already been purged from every runnable path before this
session started. What had *not* been done was proving the chain still works with
the replacements — which is §3.

---

## 7. Before filming

1. Run `NODE_USE_ENV_PROXY=1 npm run verify-live-uc01`. It must end
   `ALL CHECKS PASSED`. If it does not, it names which link died.
2. From a session with the n8n connector: confirm
   `activeVersionId === versionId` on `WORKFLOW_UC01_ID` and diff the deployed
   Code node bodies against `workflows/nodes/`.
3. Create ONE real ticket — via `npm run livedemo`, not by hand — and confirm
   all four of: the decision, the rendered letter (check the **rendered
   comment**, not the node's success flag — `publicReply` silently escapes HTML,
   `CLAUDE.md` §4), the ticket reaching `solved`, and a real `audit_log` row.
4. Only then update `CLAUDE.md` §4's ticket-#6 evidence to point at the new
   ticket. The current citation points at a ticket that no longer exists.
