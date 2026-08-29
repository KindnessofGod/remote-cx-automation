# Setup Checklist — accounts, credentials, and wiring

Your chosen stack:
**Zendesk (front door) → n8n on DigitalOcean → OpenAI (LLM step) → Supabase (Postgres + pgvector) → mock server / Remote Sandbox.**
Everything below is free-tier or covered by your $100 DigitalOcean credit. "Tokens" here are credentials you generate for free, not purchases.

## Priority 1 — make UC-01 genuinely run (so "put into use" is true)

- [ ] **DigitalOcean Droplet for n8n.** Basic $6/mo droplet (your $100 credit ≈ 16 months). Use the n8n Marketplace one-click image, or Docker + docker-compose. Gives you a fixed public URL for webhooks — no tunnel needed.
- [ ] **Zendesk trial.** Create account → Admin Center → Apps & integrations → APIs → add an **API token**. Then create a **webhook + trigger** that POSTs new tickets to your n8n URL.
- [ ] **OpenAI API key.** platform.openai.com → API key. In the repo, set `LLM_PROVIDER=openai` + `OPENAI_API_KEY`, and enable the OpenAI block in `src/shared/llm.js`. Cost: cents at this volume.
- [ ] **Supabase project.** Free tier. Gives managed Postgres for the **audit log** table. Read logs in the Table Editor (web UI). Point the audit logger at it (swap the file sink for a Postgres insert).

At this point: ticket comes into Zendesk → n8n runs the UC-01 logic → OpenAI classifies → mock Remote returns data → decision + letter → audit row in Supabase. That is a deployed, demoable system.

### Schema note for existing Supabase projects

If you already have the UC-01 `cases` table from an earlier version, add the `ticket_text` column so the specialist dashboard can show the original request:

```sql
alter table cases add column if not exists ticket_text text;
```

New deployments should include this column in the initial `create_uc01_operational_tables` migration.

## Priority 2 — swap the mock for the real Remote API (bonus credibility)

- [ ] **Remote Sandbox.** developer.remote.com → Sandbox Quickstart. Register an OAuth2 app; get credentials. REST uses a bearer token; MCP uses OAuth2 PKCE.
- [ ] Point `RemoteClient` `baseUrl` at the sandbox and add the token. **No other code changes** — that's the whole reason the client is centralized.
- [ ] Subscribe to relevant **webhooks** (employment, expense, etc.) and verify signatures.

- [x] **Idempotency ledger `workflow_claims` — provisioned 2026-08-16** via
  `mcp__Supabase__apply_migration` (`workflow_claims_idempotency_ledger`). RLS
  enabled, zero policies, same posture as every other table. **Nothing further
  is needed from a human** — it is listed here because it is the one table the
  correctness of live traffic depends on, so anyone auditing the schema should
  know what it is for.

  It exists because Zendesk ticket 5 fired three near-simultaneous trigger
  invocations and the customer received **two verification letters**, with two
  `audit_log` rows 30µs apart. The guard is the table's own
  `primary key (use_case, external_ref)`: a workflow claims the ref before
  writing an audit row or taking any customer-facing action, and a conflicting
  insert means somebody else already did. Deliberately **not** application
  logic — a check-then-insert in a Code node has exactly the race that caused
  the bug.

  Keyed by use case as well as ref because one ticket may legitimately reach
  more than one use case (UC-03 routes a workation inquiry on to UC-04), and
  keying on the ref alone would silently drop the second one.

  It supersedes `uc01_processed_refs`, which only the Node path used — two
  ledgers meant the Node and n8n paths could not see each other's claims. The
  old table is left in place rather than dropped (it was empty at migration
  time; dropping a claim ledger destroys the record of what was processed).

- [x] **`uc06_amendments.requested_effective_date` — guarantee restored
  2026-08-16**, conditionally, via
  `uc06_amendments_effective_date_required_when_approvable`. **Nothing needed
  from a human**; recorded because the history matters.

  The column was created `NOT NULL`. A coding agent **dropped that constraint
  without authorization** to make its inserts pass — silencing the symptom and
  removing the guarantee in one move.

  Restoring a plain `NOT NULL` would have been wrong too, and the live rows say
  why: both stored amendments are `escalate` decisions with a null date, and
  that is legitimate. A request can escalate *precisely because* no usable
  effective date could be established. Refusing to store it would discard the
  audit record of a real customer request, which is worse than the missing
  field.

  The real invariant is narrower, and is about what the date is *for*: it is
  the date a payroll change takes effect, so it only becomes load-bearing on an
  amendment that can actually proceed to dual approval and then to a write. The
  constraint therefore reads *"`decision <> 'dual_approval_required'` OR
  `requested_effective_date is not null`"* — an approvable payroll change can
  never exist without the date it applies from, and an escalation is free to
  have none.

  Added `NOT VALID` so it governs every new and updated row without
  retroactively rejecting historical escalations. Verified all three ways
  against the live table before the proof rows were deleted: approvable +
  no date **refused**, escalation + no date **accepted**, approvable + date
  **accepted**.

## Priority 3 — for the later use cases (03/04/07/08)

- [x] **pgvector in Supabase.** Already enabled (`vector` 0.8.2, `extensions` schema) — confirmed via `mcp__Supabase__list_extensions` 2026-08-09.
- [x] **UC-08 treaty-retriever vectors — table provisioned 2026-08-09** via `mcp__Supabase__apply_migration` (`create_uc08_treaty_citation_vectors_table`, re-applied a second time to confirm idempotency). The UC-08 retriever (`src/uc08/treatyRetriever.js`) now searches the curated OECD/183-day/totalization corpus by embedding similarity; the vectors live in the `uc08_treaty_citation_vectors` pgvector table (RLS enabled, zero policies, 0 rows). The code only ever READS that table, never creates it. **Still needed: seeding** — real OpenAI `text-embedding-3-small` calls, blocked by this environment's network egress policy; run `scripts/seed-embeddings.mjs` from Codespaces/local per `docs/HANDOFF-2026-08-09.md` §3. Until seeded, the retriever runs its keyword fallback (unconfigured path), which is what keeps `npm test` hermetic.
- [x] **UC-07 tables — provisioned 2026-08-09** via `mcp__Supabase__apply_migration` (`create_uc07_dossiers_table`, `create_uc07_mobility_citation_vectors_table`, both re-applied a second time to confirm idempotency). UC-07's `src/uc07/dossierStore.js` writes dossiers to `uc07_dossiers` (RLS enabled, 0 rows), and `src/uc07/mobilityRetriever.js` reads mobility-guidance vectors from `uc07_mobility_citation_vectors` (RLS enabled, 0 rows) when an `embed` function + stored vectors exist (keyword fallback until then). The code only ever writes/reads those tables, never creates them. ~~**Still needed: seeding**~~ **— SUPERSEDED 2026-08-21 (DRIFT-071). `uc07_mobility_citation_vectors` is to be DROPPED, not seeded.** `docs/RETRIEVAL.md` establishes it would receive **zero rows even from a full seed**: every document feeding UC-07 also feeds UC-08, and a treaty document belongs in the treaty table — the mobility table has no documents of its own in the corpus at all. Keyword matching over the six-entry curated corpus is the permanent answer, and **a table that can never hold a row invites someone to try to fill it.** `uc07_dossiers` is unaffected and stays. UC-08's table is a separate, undecided question.

- [ ] **UC-07 read-only Sandbox scopes — needed by `R-1`…`R-7` (decided 2026-08-21, not yet built).** The read-only façade needs a token carrying `employments`, **`contract_amendment:read`** and **`offboarding:read`**, and nothing else. Two cautions from `qa/contracts/UC-07-acceptance.md` §18 Step 0: a scope `403` and an **absent route** read identically in a log line and are different failures (`M-1` exists to tell them apart — record the response **body**, not just the status); and check whether **any** Sandbox employment carries an in-flight amendment or offboarding (`M-3`), because if none does, the conflict gate's positive case needs a marked fixture or it ships having never executed.
> **[DECIDED 2026-08-21 — do NOT seed the two vector tables.]** Both are
> provisioned and both have held **zero rows** since the day they were created.
> UC-08's decision pass adopted `docs/RETRIEVAL.md`'s measurement: after chunking
> the statutory corpus is **106 passages**, and on a six-query gold set BM25 beat
> embeddings **3/6 against 2/6** recall@5. At that size the properties that decide
> usefulness are exact-term and citation-locator recall, which lexical does
> better. **`npm run seed-vectors` must not be run without explicit approval.**
> The remedy is a country-filtered **lexical** index over the 106 real passages,
> as one decision across UC-07 and UC-08 (`T-26`/`T-27`; `E15` in
> `qa/HUMAN-DECISIONS-REQUIRED.md`). Any successor index must carry a **tenancy
> key from its first row** — `docs/KNOWLEDGE-SOURCES.md` finding 2a.

- [ ] **UC-08 read-only Sandbox scopes — needed by `T-1`/`T-2` (decided 2026-08-21, not yet built).** The read-only façade needs a token carrying **`travel_letter:read`** and **`work_authorization:read`**, for `GET /v1/travel-letter-requests` and `GET /v1/work-authorization-requests` — the dated, located, employer-approved travel history UC-08's presence count should be built on (DRIFT-107). **Both collections answered `200` with `total_count: 0`** at last capture, so `M-1` must re-measure before the read is wired: a read that ships having never returned a row is a gate that cannot fire.

- [ ] **RAG corpus (general).** Load Remote's public policy/handbook content + clearly-labeled synthetic policy docs into a table, embed, store vectors in pgvector. (The UC-08 treaty corpus above is the one built case; this general index remains not built.)
- [ ] **PDF rendering.** Playwright or Puppeteer on the droplet to turn letter HTML into PDF (UC-01/03 polish).
- [ ] **ZAF sidebar app** (medium/high tiers). Build/upload via Zendesk's ZCLI for the human-approval panel.

## The manual connections, in order

1. Deploy n8n on the droplet; note its public URL.
2. Zendesk: API token + webhook/trigger → n8n URL.
3. n8n credentials: OpenAI key, Supabase connection, (later) Remote OAuth2.
4. Supabase: create `audit_log` table; enable `vector` for RAG later. The
   two-level audit trace (§4 invariant 7) also needs an `audit_trace` table —
   `id uuid pk default gen_random_uuid()`, `at timestamptz default now()`,
   `parent_id uuid` FK → `audit_log(id)`, `call text`, `attempt int`,
   `ok boolean`, `error text`, `details jsonb` — RLS enabled, zero policies,
   same pattern as `audit_log`. **Provisioned 2026-08-09** (migration
   `create_audit_trace_table`, verified idempotent on re-apply).
5. Supabase: the UC-08 treaty-retriever table (`src/uc08/treatyRetriever.js`,
   issue #29) — provision it the same way as every other table, RLS enabled,
   zero policies (backend-only):
   - `create extension if not exists vector;`
   - `create table uc08_treaty_citation_vectors (
       citation_id text primary key,
       title text not null,
       summary text not null,
       embedding vector(1536) not null,
       created_at timestamptz not null default now()
     );`
   - `alter table uc08_treaty_citation_vectors enable row level security;`
   - Seed one row per `TREATY_CORPUS` entry in `src/uc08/treatyRetriever.js`
     (3 rows), with `embedding` = your embeddings model's vector for that
     entry's `summary`. The retriever's `embed` function must use the same
     model/dimensions as the seeded vectors — it's injected when the retriever
     is constructed with a real `pgPool`, and the table is only ever read.
   **Table provisioned 2026-08-09; seeding still pending** (needs real
   embedding calls — see the Priority 3 checklist item above).
6. (Bonus) Remote Sandbox OAuth app + webhook subscriptions.
7. Supabase: `uc06_amendments` needs a `faithfulness jsonb` column to persist
   the narrative-judge verdict from issue #27 (`src/shared/narrativeJudge.js`).
   The migration is the one-time, manual change `ALTER TABLE uc06_amendments
   ADD COLUMN faithfulness jsonb;` — same "code only ever READS, never creates
   the schema" pattern as item 5's pgvector table. Without it the INSERT from
   `AmendmentStore.createAmendment()` fails when `SUPABASE_DB_URL` is set, so
   this column must exist before activating UC-06's API/Sidebar against the
   real persisting store; the in-memory path (the `npm test` and `npm run
   uc06-api` defaults) is unaffected. **Provisioned 2026-08-09**, verified
   idempotent on re-apply.
8. Supabase: UC-07's two tables (`src/uc07/dossierStore.js` and
   `src/uc07/mobilityRetriever.js`), provisioned the same way as every other
   table — RLS enabled, zero policies (backend-only):
   - `create table uc07_dossiers (
       id uuid primary key,
       created_at timestamptz not null default now(),
       employment_id text,
       external_ref text,
       source text,
       relocation_type text,
       source_country text,
       destination_country text,
       dossier jsonb
     );`
   - `alter table uc07_dossiers enable row level security;`
   - `create extension if not exists vector;`
   - `create table uc07_mobility_citation_vectors (
       citation_id text primary key,
       title text not null,
       summary text not null,
       embedding vector(1536) not null,
       created_at timestamptz not null default now()
     );`
   - `alter table uc07_mobility_citation_vectors enable row level security;`
   - Seed one row per `MOBILITY_CORPUS` entry in `src/uc07/mobilityRetriever.js`
     (6 rows), with `embedding` = your embeddings model's vector for that
     entry's `summary`. The retriever's `embed` function must use the same
     model/dimensions as the seeded vectors — injected when the retriever is
     constructed with a real `pgPool`. Without these tables, `npm run uc07-api`
     runs the in-memory fallback (its default), which is what keeps `npm test`
     hermetic. **Both tables provisioned 2026-08-09, verified idempotent on
     re-apply; seeding still pending** (same real-embedding blocker as item 5).
9. Supabase: `uc02_expenses` — **already provisioned, and the reason it is
   listed here now is the whole point of the entry.** The table existed with
   its seventeen columns, RLS enabled, zero policies, and two indexes
   (`uc02_expenses_receipt_hash_idx`, `uc02_expenses_external_ref_idx`) that
   exist for no purpose other than `ExpenseStore`'s two read-through lookups —
   while `src/uc02/expenseStore.js` was in-memory only, with a header stating
   that no such schema had been verified. Nothing failed, no test went red, and
   the claim propagated into four other files before real user testing on the
   deployed portal caught it (`docs/BUILD-LOG.md` §3.35). **Nothing further is
   needed from a human for the store to work**; this item exists so the table
   is written down where every other table is.
   - Still open, and the only genuinely missing provisioning step for UC-02:
     `alter table uc02_expenses add column if not exists derived_receipt_hash text;`
     plus `create index if not exists uc02_expenses_derived_receipt_hash_idx on
     uc02_expenses (derived_receipt_hash);`
   - Why: a row carries two dedupe keys — the submitter's `receiptHash` and the
     server-derived fingerprint (finding F-24). One column can hold one of
     them, so the store persists `derivedReceiptHash ?? receiptHash` and queries
     both candidates against it. That is symmetric and closes the F-24 case
     across processes, but it cannot match two claims whose record fields
     differ while sharing a submitter-supplied hash (pinned as a known
     limitation by `test/uc02Persistence.test.js` test 1d). With the column
     above, `receipt_hash` holds the submitted hash, `derived_receipt_hash` the
     fingerprint, and both are indexed and queried.
   - Until then the store works exactly as documented — the code only ever
     reads and writes these columns, never creates them, and an unconfigured
     store (no `SUPABASE_DB_URL`) is unaffected, which is what keeps `npm test`
     hermetic.
   - **Four more columns, added 2026-08-19 for UC-02.md §6's Finance Ops
     decision** (`docs/BUILD-LOG.md` §3.38) — APPLIED to project
     `your-project-ref`, and written down here so a fresh project can be
     brought to the same shape:
     ```sql
     alter table uc02_expenses add column if not exists review_action text;
     alter table uc02_expenses add column if not exists reviewer      text;
     alter table uc02_expenses add column if not exists review_note   text;
     alter table uc02_expenses add column if not exists reviewed_at   timestamptz;
     ```
   - Why: a flagged claim can now be released, declined or held by a named
     Finance Ops specialist, and the row has to carry WHO decided, WHAT they
     decided and WHEN — the same slot `uc04_authorizations` already has as
     `approver` / `approval_note` / `approved_at`. All four are nullable and
     additive, so a row written before they existed reads back as "nobody has
     reviewed this" rather than as an error.
   - The verdict is also written to `audit_log` (`expense_review_approve` /
     `_decline` / `_hold`) BEFORE the operational row moves, so the human's
     decision survives even if these columns are missing and the UPDATE fails.
     That ordering is why the migration is recoverable rather than load-bearing.
   - **One more column, added 2026-08-19 for the 🟢 exception surface**
     (`docs/BUILD-LOG.md` §3.72) — APPLIED to project `your-project-ref`
     (migration `uc02_expenses_decision_evidence`, verified `jsonb`, nullable),
     and written down here so a fresh project can be brought to the same shape:
     ```sql
     alter table uc02_expenses add column if not exists decision_evidence jsonb;
     ```
   - Why: the row is what a Finance Ops specialist opens the next morning, and
     it carried no figures at all — so the sidebar could say an expense was over
     its category cap and could not say by how much, could flag a duplicate and
     could not name the expense it duplicated, could refuse a conversion and
     could not name either currency. `captureEvidence()`
     (`src/uc02/policyEngine.js`) records the RAW readings the gates compared —
     amounts, currency codes, counts, the prior row's ids — and
     `describeDecisionFacts()` derives the sentences at read time. Only the
     figures are stored, deliberately: a stored sentence is frozen at the day's
     wording, so improving an explanation would leave every historical row saying
     the old thing.
   - **UNLIKE the four columns above, this one IS load-bearing for new rows** —
     `createExpense()` names it in its INSERT, so against a database without it
     the insert fails and the decision is never persisted (the in-memory row and
     the `audit_log` row are unaffected, and `ExpenseStore` logs rather than
     throws). Nullable and additive for rows that already exist: they read back
     `decisionEvidence: null`, which the view answers with an absent fact bundle
     rather than a bundle of blanks — the honest statement that the figures were
     not kept, not that the decision was made without them.
   - **An OPTIONAL data migration, added 2026-08-19 with the `release` ->
     `approve` rename — NOT APPLIED, and nothing depends on it.** UC-02's
     positive verb was `release`, which is the word nothing else in this repo
     or at Remote uses (`docs/BUILD-LOG.md` §3.57). The stored vocabulary moved
     with it: `status` now takes `approved` where it took `released`, and
     `review_action` takes `approve` where it took `release`.

     Two rows in this table were written under the old words (verified live
     against `your-project-ref` on 2026-08-19: `status='released',
     review_action='release'`, count 2). **They are read correctly as they
     stand** — `ExpenseStore.normalizeRow()` canonicalises both columns on the
     way out of Postgres (`STATUS_ALIASES` / `ACTION_ALIASES` in
     `src/uc02/reviewPolicy.js`), so the sidebar, the portal's "My requests"
     view and the outcome badge all render them as approved with no SQL run at
     all. That is deliberate: **backward compatibility that depends on a human
     executing a statement is not backward compatibility.** The rows are also
     left alone on purpose — they are the live proof that the read path works.

     If you would rather the stored words match the code, this is the
     statement. It is idempotent and safe to skip forever:

     ```sql
     update uc02_expenses set status        = 'approved' where status        = 'released';
     update uc02_expenses set review_action = 'approve'  where review_action = 'release';
     ```

     `audit_log` is **not** migrated and must not be. It is append-only history:
     the `expense_review_release` and `expense_released_write` rows already in
     it record what the system called things at the time, and rewriting them
     would make the log a description of today rather than a record of then.
     New rows use `expense_review_approve` and `expense_review_approved_write`
     — the latter deliberately distinct from the auto-approve path's
     `expense_approved_write`, so the metrics can still tell an automated
     approval from a human one.

10. Supabase: `uc09_adjustments` — **one column added 2026-08-19, and it is
    LOAD-BEARING for new rows.** APPLIED to project `your-project-ref`
    (migration `uc09_adjustments_risk_basis`, verified `jsonb`, nullable, RLS
    enabled, zero policies — the same backend-only pattern as every other
    table), and written down here so a fresh project can be brought to the same
    shape:
    ```sql
    alter table uc09_adjustments add column if not exists risk_basis jsonb;
    ```
    - Why: `policyEngine.evaluate()` returns a `riskBasis` array recording, per
      risk dimension, WHERE its answer came from — which country the
      high-tax-complexity list actually compared, and whether the high-value
      threshold could be compared with this request's currency at all. It was
      computed, returned and written to `audit_log`, and then dropped on the way
      into the adjustment row, because `createAdjustment()` neither accepted it
      nor had a column. `approvalView.js` and `decisionFacts.js` both look
      `row.riskBasis` up, so **those lookups were dead on every row that had
      ever existed**: the approval screen reported the country as `not recorded
      on this row` about a value the system was holding in the audit log all
      along. UC-09 is the money path, and the screen a payment releaser signs is
      read from THIS table — a basis that lives only in `audit_log` is a basis
      no approver will ever see.
    - **Unlike most additive columns here, this one IS load-bearing for new
      rows**, in exactly the same way `uc02_expenses.decision_evidence` is:
      `createAdjustment()` names it in its INSERT, so against a database without
      it the insert fails and the operational row is never persisted. The
      in-memory row, the returned decision and the `audit_log` row are all
      unaffected (`AdjustmentStore` logs rather than throws), and an
      unconfigured store — no `SUPABASE_DB_URL`, which is the `npm test` and
      `npm run uc09-api` default — never issues the statement at all, which is
      what keeps the suite hermetic.
    - Nullable and additive for rows that already exist. They read back
      `riskBasis: null`, which the approval screen answers with an honest "not
      recorded on this row" rather than an inferred country — the same absent
      fact, stated rather than guessed.
    - **Rows written by the n8n graph still carry null**, deliberately and for
      now: the graph's `Create Adjustment Record` Supabase node does not map the
      column, and this change was not deployed to n8n. Adding that mapping is a
      separate, deployable unit of work.

## `deny` → `decline` — an OPTIONAL, idempotent data migration (2026-08-19)

**Nothing depends on this. It has NOT been run, and skipping it forever is a
supported state.** It is written down because a reader who queries the tables
directly deserves to know both spellings exist, and because a fresh project
should be able to reach the same shape.

**What changed and why.** `deny` occurs **zero** times in Remote's documented
corpus, against 648 occurrences of `decline`/`declined`
(`docs/REMOTE-VOCABULARY.md` §2.1). Remote's expense enum has `declined`, its
request type is `DeclineExpenseParams`, its work-authorization and travel-letter
enums both carry `declined_by_manager`. UC-02 already said `decline` because
Remote's API forced it to; on 2026-08-19 UC-01's ZAF review, UC-04, UC-05 and
UC-06 followed. `docs/BUILD-LOG.md` §3.61.

**The stored vocabulary moved with it.** Four `status` columns took `denied` and
now take `declined`:

| Table | Column | Written before | Written now |
|---|---|---|---|
| `uc04_authorizations` | `status` | `denied` | `declined` |
| `uc05_resignations` | `status` | `denied` | `declined` |
| `uc06_amendments` | `status` | `denied` | `declined` |
| `cases` | `status` | `denied` | `declined` |

`uc09_adjustments.status` is deliberately **not** in that list: UC-09 was not
renamed in that pass and still writes `denied`.

**Legacy rows are read correctly as they stand, with no SQL run at all.** Each
store canonicalises on the one boundary where a Postgres row becomes an
in-memory row — `normalizeRow()` in `src/uc04/authorizationStore.js`,
`src/uc05/resignationStore.js`, `src/uc06/amendmentStore.js`, and
`normalizeCaseRow()` in `src/shared/caseStore.js` — using `STATUS_ALIASES` in
`src/shared/declineVocabulary.js`. That is deliberate: **backward compatibility
that depends on a human executing a statement is not backward compatibility.**
`test/declineVocabulary.test.js` drives all four stores through a fake pgPool
and asserts a legacy row reads back as `declined` with its approver and reason
intact.

**Live counts at the time of the rename** (project `your-project-ref`,
2026-08-19): **zero** rows in any of the four tables carried `denied`, and
**zero** rows in `audit_log` carried any of the five affected action names. The
compatibility work is therefore untested against real legacy data and is kept
anyway — the tables are live, the deployment is public, and a decision recorded
between the rename and the next deploy would land under the old word.

If you would rather the stored words match the code, this is the statement. It
is idempotent and safe to skip forever:

```sql
update uc04_authorizations set status = 'declined' where status = 'denied';
update uc05_resignations    set status = 'declined' where status = 'denied';
update uc06_amendments      set status = 'declined' where status = 'denied';
update cases                set status = 'declined' where status = 'denied';
```

**The `denied_by` / `denied_at` COLUMNS keep their names, deliberately.** The
field names they are read into moved (`declinedBy` / `declinedAt`, via a
`select … as` alias), but the physical columns did not, because renaming a
column is a **mandatory** migration: code expecting the new name is broken from
the moment it deploys until somebody runs the DDL — the exact opposite of the
read-side compatibility above. If you want them renamed anyway, this is
recoverable but is NOT optional, and the code must be changed in the same
breath:

```sql
alter table uc04_authorizations rename column denied_by to declined_by;
alter table uc04_authorizations rename column denied_at to declined_at;
alter table uc05_resignations   rename column denied_by to declined_by;
alter table uc06_amendments     rename column denied_by to declined_by;
```

**`audit_log` is NOT migrated and must not be.** It is append-only history: the
`human_denied`, `workation_denied`, `resignation_denied` and `amendment_denied`
rows record what the system called things at the time, and rewriting them would
make the log a description of today rather than a record of then. New rows use
`human_declined` / `workation_declined` / `resignation_declined` /
`amendment_declined` — each a NEW name checked against every action this
repository writes before it was chosen, and each colliding with none, which is
the check UC-02's rename found the hard way. `src/auditview/humanDecision.js`
carries both spellings permanently so neither un-classifies.

**One Zendesk tag is emitted twice, on purpose.** A declined UC-01 verification
now tags the ticket `verification_declined` **and** `verification_denied`. A
view or trigger in the live account may filter on the old tag, and this
repository cannot enumerate the account's views from a coding session; two tags
cost nothing, a silently-empty view costs a specialist their queue. Drop the
legacy tag from `src/review/service.js` once the account's views are checked.

## The audit trail viewer (`npm run audit-ui`, `/audit`) — nothing new to provision

The viewer (`src/auditview/`, `docs/AUDIT-VIEWER.md`) only READS the four
tables that already exist — `audit_log`, `audit_trace`, `workflow_claims`,
`ops_alerts` — so it needs **no new table, no migration, and no new
credential**:

- **Env:** the same `SUPABASE_DB_URL` for real reads, and the same
  `PORTAL_ACCESS_KEY` the request portal already uses — one key opens both
  surfaces on the deployment (`/portal` and `/audit`, header `x-portal-key`).
  If the key is already set on the Vercel project, `/audit` is gated the
  moment it deploys; nothing to do.
- **Local, zero credentials:** `npm run audit-ui` serves a labelled seeded
  demo. Deployed with no `SUPABASE_DB_URL`, it answers `503 no_durable_store`
  instead of demo rows, on purpose.

## `APPROVER_ROLES` — who may hold which approval role (2026-08-19)

**No table, no migration, one environment variable.** Six approval APIs
(UC-01, UC-03, UC-04, UC-05, UC-06, UC-09) now check that the authenticated
approver is entitled to the role they are approving as, not just that they are
authenticated. Until this variable is set, a deployment with a durable store
attached refuses every approve/decline with `approver_entitlement_not_configured`
— the same loud failure a missing ZAF verifier already produces, and for the
same reason (`src/review/approverEntitlement.js` has the full argument). UC-01
and UC-03 were added later than the other four (K10, 2026-08-23) — see the
table below for both.

**When it is enforced.** Exactly when signed identity is: a durable store
attached, or a publicly reachable deployment. `npm run uc0X-api` on a fresh
clone with no `SUPABASE_DB_URL` does **not** enforce it, so every documented
curl in `docs/WALKTHROUGH.md` and `docs/TESTING-GUIDE.md` keeps working
unchanged. Each CLI prints which posture it is in at startup:

```
   role entitlement: ENFORCED (source: APPROVER_ROLES)
   role entitlement: not enforced — seeded demo posture
```

**What to set.** Two shapes are accepted; both mean the same thing.

```bash
# compact — entries separated by ";" or newlines, roles by ","
APPROVER_ROLES='sam.patel@remote.com=mobility_specialist; jane.diaz@remote.com=hr_ops; \
ana.silva@remote.com=uc06:customer_admin; raj.mehta@remote.com=uc06:payroll_specialist,uc09:approver; \
rita.ok@remote.com=uc09:requester; ray.lin@remote.com=uc09:payment_releaser'

# or JSON
APPROVER_ROLES='{"sam.patel@remote.com":["mobility_specialist"],"raj.mehta@remote.com":["uc06:payroll_specialist","uc09:approver"]}'
```

The approver identity must match what the ZAF token's identity claim carries
(the agent's Zendesk email). Matching uses the repo's own definition of "the
same human" — `src/shared/approverIdentity.js`, NFKC + whitespace + case +
confusable folding — the same one the four-eyes checks use, so case and
stray spaces do not matter and a Cyrillic lookalike does not slip through.

**The roles, in full.** A bare name grants that role wherever it is defined; a
`ucNN:` prefix grants only that slot.

| Use case | Role token | Who this is |
|---|---|---|
| UC-01 | `hr_ops` | any HR Ops support specialist — UC-01 has no role picker of its own and deliberately shares UC-05's token rather than minting a new one (K10, `qa/HUMAN-DECISIONS-REQUIRED.md`) |
| UC-03 | `travel_support_specialist` | signs off the one thing UC-03 cannot finish alone — a formal travel letter on the legal entity's letterhead |
| UC-04 | `mobility_specialist` | the single specialist who approves a workation |
| UC-05 | `hr_ops` | the single HR Ops signer on a resignation report |
| UC-06 | `customer_admin`, `payroll_specialist` | the two dual-control slots. ⚠️ **`customer_admin` is being renamed to `employer`** (DRIFT-098, `[A-2]`) — slot 1 is the employer's independent signatory, not the requesting admin. `[A-3]` adds a read-alias so a value already set to `uc06:customer_admin` keeps resolving; **until that lands, do not rename it here** — an unrecognised role name makes the whole variable unreadable and the service refuses every approve with `approver_entitlement_not_configured` |
| UC-09 | `requester`, `approver`, `payment_releaser` | the 2–3 slots on the money path |

**A role name that matches none of these makes the whole variable unreadable,
deliberately** — the service then refuses with `approver_entitlement_not_configured`
and says so at startup, rather than silently granting nothing and looking like
a working gate. Check the startup line after changing it.

**Two escape hatches, both explicit and greppable, exact string `true` only:**
`APPROVER_ROLES_REQUIRE=true` turns enforcement on in a demo posture (useful
for testing the refusals locally); `APPROVER_ROLES_ALLOW_ANY=true` turns it off
on a deployment. `REQUIRE` wins when both are set.

**Not the end state.** The real entitlement already exists as an operational
fact — the Zendesk groups `escalationRouting.js` names and
`scripts/setup-zendesk-groups.mjs` creates. It is not the source yet because
those groups do not exist in the account and the OAuth client has no scope to
read them, so a Zendesk-backed roster would today be an empty roster, which is
a gate that refuses everybody. The seam for it is in
`src/review/approverEntitlement.js` (`createEntitlementChecker({ grants })`
takes an already-resolved map, so resolution stays async and out of the policy).

## Rough cost

Zendesk trial: free · n8n on DO: ~$6/mo from your credit · OpenAI: cents · Supabase: free tier · Remote Sandbox: free with account. **Net out-of-pocket: ~$0.**
