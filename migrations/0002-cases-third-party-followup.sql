-- ---------------------------------------------------------------------------
-- 0002 — cases gains a return address and an aged-notice marker   (G-4/F1)
-- ---------------------------------------------------------------------------
-- STATUS: **APPLIED** to the Supabase Sandbox (project your-project-ref)
-- on 2026-08-22 by gc.implementation-worker-1 (bead rca-hfq), and VERIFIED BY
-- READING THE SCHEMA BACK -- not by trusting the apply call's success flag.
-- After the apply, information_schema.columns reports both new nullable
-- columns on `cases` (return_address text, aged_notice_sent_at timestamptz),
-- and pg_indexes reports cases_third_party_pending_notice_idx. Nothing was
-- dropped, renamed or redefined.
--
-- WHY THIS EXISTS
-- The G-3 evaluator (bead rca-5ry) found that the third-party door
-- (src/thirdparty/) collects no way to contact the party who asked, while its
-- acknowledgement promises "you will hear from us" — a promise nothing in the
-- system could keep. Fixing that needs somewhere durable to put the address,
-- and a way to know a follow-up notice was already sent so a repeated sweep
-- does not resend it.
--
-- WHY ON `cases`, NOT `consent_records`
-- A `consent_records` row only exists for the branch that reaches
-- `awaiting_employee_consent` (a real, active, as-yet-unanswered employee).
-- It never exists at all for a request about someone who does not exist at
-- Remote, and per owner answer A5 / VC-32 Amendment 2, the later "we could
-- not obtain permission" message must be word-identical whether the request
-- was about a real unanswered employee, a real employee who declined, or
-- nobody at all -- so the mechanism that decides who gets that message
-- cannot key off a table that only ever exists for one of the three. `cases`
-- is written for EVERY third-party-door submission regardless of outcome
-- (see src/uc01/workflow.js STEP 6a, which returns before this only for
-- `out_of_scope` -- irrelevant to a third-party ask), so it is the row all
-- three cases share.
--
-- WHY NULLABLE
-- Both columns apply to a small subset of one use case's cases (UC-01,
-- source = 'third_party_door'). Every other row -- all eight other use
-- cases, and UC-01's own Zendesk/portal-sourced cases -- leaves both null
-- forever, which is the correct reading: no return address was ever
-- collected, so no follow-up notice is possible or owed.
-- ---------------------------------------------------------------------------

begin;

-- WHO TO TELL, once the window has passed. Collected at the door as a fifth,
-- identity-adjacent field (see src/thirdparty/server.js validation) -- never
-- read by any gate, and never used to widen what the door discloses at
-- submission time (the ack there stays the one fixed constant regardless of
-- what this column holds).
alter table public.cases
  add column if not exists return_address text;

-- WHETHER THE AGED NOTICE WAS ALREADY SENT. Distinct from `status`, which
-- this column must never influence and must never be influenced by: A5
-- forbids any state transition on elapsed time alone, and this is a record of
-- a COMMUNICATION, never a decision (VC-32 Amendment 2's own wording). Null
-- means "not yet sent" (or not applicable); once set it stops the sweep from
-- sending a second, identical notice to the same party.
alter table public.cases
  add column if not exists aged_notice_sent_at timestamptz;

comment on column public.cases.return_address is
  'G-4/F1: the third-party door''s fifth field -- how to reach the party who asked, once the consent-ageing window (L-19) has passed. Null for every case not sourced from the third-party door.';
comment on column public.cases.aged_notice_sent_at is
  'G-4/F1/VC-32 Amendment 2: when the word-identical "could not obtain permission" notice was recorded as sent. A communication marker, never a state transition -- `status` is untouched by it in either direction.';

-- The sweep's own query: unnotified, addressed, third-party-door cases,
-- oldest first. A partial index rather than a full one -- every other case in
-- this table (the overwhelming majority) has `return_address` null and would
-- never match this predicate.
create index if not exists cases_third_party_pending_notice_idx
  on public.cases (created_at)
  where source = 'third_party_door'
    and return_address is not null
    and aged_notice_sent_at is null;

commit;

-- ---------------------------------------------------------------------------
-- ROLLBACK:
--
--   begin;
--   drop index if exists public.cases_third_party_pending_notice_idx;
--   alter table public.cases
--     drop column if exists aged_notice_sent_at,
--     drop column if exists return_address;
--   commit;
--
-- The rollback drops the record of who was told and when. Safe only before
-- any third-party-door case has collected a return address; not a fix for a
-- change of mind afterward.
-- ---------------------------------------------------------------------------
