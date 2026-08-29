-- ---------------------------------------------------------------------------
-- 0003 — cases gains a manual-send outcome record   (D-12, rca-kfg2)
-- ---------------------------------------------------------------------------
-- STATUS: **APPLIED** to the Supabase Sandbox (project your-project-ref)
-- on 2026-08-22, and VERIFIED BY READING THE SCHEMA BACK -- not by trusting
-- the apply call's success flag. information_schema.columns reports all four
-- new nullable columns on `cases` (manual_send_status text,
-- manual_send_at timestamptz, manual_send_by text, manual_send_note text).
-- Nothing was dropped, renamed or redefined.
--
-- WHY THIS EXISTS
-- A third-party-door disclosure that is approved in the ZAF sidebar issues a
-- letter INSIDE Zendesk only — the requesting party never sees this ticket
-- (VC-33), so the internal note instructs the specialist to send the letter
-- to the return address themselves. Every route to actually do that from
-- inside Zendesk was tried and found absent (D-12's own evidence: no Side
-- Conversation create control, no relevant Ticket Actions entry, and CC would
-- expose this internal ticket to the outsider, which the note forbids two
-- sentences earlier). The specialist correctly refused to fake a send.
--
-- The gap this migration closes is not the missing sender — building one
-- would mean this system firing an unattended email at an outside party,
-- which is exactly the kind of execution a 🟢 use case with a human
-- disclosure gate should not silently grow. The gap is that NEITHER outcome
-- of the manual step was recordable: not "sent, out of band, by X at Y", and
-- not "could not be sent, because Z". A required step with no way to record
-- whether it happened is invisible exactly the way an unowned decision is.
--
-- WHY ON `cases`, NOT A NEW TABLE
-- Same reasoning as 0002's return_address/aged_notice_sent_at: this is a
-- COMMUNICATION MARKER about a case Zendesk already tracks, not a new kind of
-- durable record with its own lifecycle, so it does not warrant a table of
-- its own. One case, at most one manual-send outcome — a case sent once and
-- correctly is not later "sent" a second time by a different agent.
--
-- WHY NULLABLE, AND WHY status IS AN ENUM-SHAPED TEXT RATHER THAN A BOOLEAN
-- Applies only to UC-01 third-party-door cases that were approved — the
-- overwhelming majority of rows across all nine use cases leave every column
-- here null forever, which is the correct reading (no manual send was ever
-- owed). A boolean cannot distinguish "sent" from "could not be sent" from
-- "not yet actioned" without a second column and an implicit rule tying the
-- two together; a status column names the third state explicitly and needs
-- no such rule.
-- ---------------------------------------------------------------------------

begin;

alter table public.cases
  add column if not exists manual_send_status text
    check (manual_send_status is null or manual_send_status in ('sent', 'could_not_send'));

alter table public.cases
  add column if not exists manual_send_at timestamptz;

alter table public.cases
  add column if not exists manual_send_by text;

alter table public.cases
  add column if not exists manual_send_note text;

comment on column public.cases.manual_send_status is
  'D-12: the outcome of the manual, out-of-band send a third-party-door disclosure''s internal note instructs a specialist to perform. ''sent'' or ''could_not_send'' -- never inferred, only recorded by the specialist who acted. Null until recorded, and null forever on every case that never required a manual send.';
comment on column public.cases.manual_send_at is
  'D-12: when the outcome above was recorded -- a communication marker, matching aged_notice_sent_at''s own comment: never a state transition, and `status` is untouched by it in either direction.';
comment on column public.cases.manual_send_by is
  'D-12: the approver identity (signed ZAF claim, or the trusted header in unsigned/demo mode -- same resolution as an approve/decline) who recorded the outcome.';
comment on column public.cases.manual_send_note is
  'D-12: required when manual_send_status is ''could_not_send'' (the reason), optional otherwise (e.g. a delivery reference) -- see submitManualSendRecord() in src/review/service.js.';

commit;

-- ---------------------------------------------------------------------------
-- ROLLBACK:
--
--   begin;
--   alter table public.cases
--     drop column if exists manual_send_note,
--     drop column if exists manual_send_by,
--     drop column if exists manual_send_at,
--     drop column if exists manual_send_status;
--   commit;
--
-- The rollback drops the record of whether an outward disclosure was ever
-- actually sent. Safe only before any third-party-door case has recorded one.
-- ---------------------------------------------------------------------------
