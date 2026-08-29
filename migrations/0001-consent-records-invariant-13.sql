-- ---------------------------------------------------------------------------
-- 0001 — consent_records gains a column per fact of invariant 13   (L-7, VC-30)
-- ---------------------------------------------------------------------------
-- STATUS: **APPLIED** to the Supabase Sandbox (project your-project-ref)
-- on 2026-08-21T22:00Z by mayor, and VERIFIED BY READING THE SCHEMA BACK --
-- not by trusting the apply call's success flag.  After the apply,
-- information_schema.columns reports twelve columns: the original seven plus
-- granted_by_employment_id, granted_by_signal, requesting_party, purpose and
-- granted_at, all nullable.  pg_indexes reports both new partial indexes,
-- consent_records_disclosure_check_idx and consent_records_pending_age_idx.
-- Nothing was dropped, renamed or redefined.
--
-- HISTORY, kept because the reason matters more than the outcome.  This file
-- was written under a HARD STOP: the Builder was told to write the SQL and NOT
-- to run it, because a schema change is a WRITE against the live Sandbox and
-- the standing rule was that Sandbox writes needed an explicit go-ahead.  The
-- request was raised as bead rca-jby.  The owner answered on 2026-08-21 and
-- went further than the question asked, granting STANDING authority over
-- Supabase -- "nobody is supposed to be waiting on me for anything. they have
-- free reign in my supabase" -- recorded in
-- qa/orchestration/OPERATING-CONTRACT.md line 462 (commit 96547d4), whose text
-- names this bead and says "Apply it."
--
-- The Builder never applied it: the unblocking mail reached its inbox unread
-- while it was mid-run, and it finished the pass still under the hard stop and
-- correctly recorded VC-07 and invariant 13 as NAMED UNTESTED GAPS rather than
-- passing them silently.  That was the right call on the information it had.
-- The apply was done afterwards, once no Builder was running against the
-- schema.  VC-07 and invariant 13 are therefore no longer blocked on schema --
-- they are blocked only on L-8/L-9/L-12/L-13/L-19, which are not built.
--
-- WHY THIS EXISTS
-- `consent_records` today carries exactly seven columns, and the insert in
-- src/shared/caseStore.js writes exactly those seven:
--
--     id, created_at, case_id, consent_type, status, source, evidence_reference
--
-- Read live against project your-project-ref on 2026-08-21: the live table
-- matches that insert exactly.  Invariant 13 requires four facts about a
-- consent -- who granted it, to whom, for what purpose, and when -- and the
-- table answers ONE of them.  `created_at` is *when*; `consent_type` is a
-- category stand-in for *to what*; and there is **no column at all** for who
-- granted it or to whom it was granted.
--
-- WHY NOT PUT THEM IN `evidence_reference`
-- Because §7 of the acceptance contract requires consent to be **re-checked at
-- disclosure time** against a named requesting party and a purpose.  Prose
-- concatenated into a free-text column satisfies a *reading* of invariant 13
-- and defeats its purpose: a disclosure check would have to parse English to
-- decide whether this consent covers this requester.  A standing
-- "yes to anyone, forever" must be *unrepresentable*, not merely discouraged,
-- and that is a schema property.
--
-- WHY NULLABLE, AND WHY THE APPLICATION IS THE GATE
-- The four columns are added NULLABLE on purpose.  Existing rows predate the
-- facts and cannot be back-filled with anything true, and inventing a
-- granting party for a historical row would be fabricating exactly the fact
-- this migration exists to make trustworthy.  A NOT NULL column would force
-- that fabrication.  Instead the DISCLOSURE CHECK refuses a row missing any of
-- the four (VC-30's failure/recovery line), so an un-backfillable legacy row
-- can never clear a disclosure -- it fails closed, which is the correct
-- direction.  The partial index at the bottom makes that check a query.
-- ---------------------------------------------------------------------------

begin;

-- 1. WHO GRANTED IT.  The employment id of the person whose consent this is,
--    plus the authenticated signal that identity came from.  Two columns and
--    not one, because "who" and "how do we know" are different facts and
--    invariant 12 (identity comes from an authenticated signal, never a claim)
--    applies to a consent exactly as it applies to a request.  Text, not a FK:
--    employment ids are Remote's, this database does not hold that table, and
--    `cases.employment_id` is text for the same reason.
alter table public.consent_records
  add column if not exists granted_by_employment_id text,
  add column if not exists granted_by_signal       text;

-- 2. TO WHOM.  The named requesting party.  A consent with no named party is
--    the "yes to anyone, forever" that §7 forbids, and this column is what
--    makes that state visible rather than implied.
alter table public.consent_records
  add column if not exists requesting_party text;

-- 3. FOR WHAT PURPOSE.  Distinct from `consent_type`, which is a category of
--    consent ("third_party_verification").  The purpose is what the disclosure
--    is FOR ("mortgage application, Bank X") and is what a re-check at
--    disclosure time compares against.
alter table public.consent_records
  add column if not exists purpose text;

-- 4. WHEN IT WAS GRANTED.  Distinct from `created_at`, which is when the
--    REQUEST was recorded.  A consent requested on Monday and granted on
--    Thursday has two different timestamps and conflating them misdates the
--    grant.  Null until the employee actually answers -- which is also what
--    makes an unanswered request legible to the ageing verdict (L-19, VC-32):
--    granted_at IS NULL is exactly "still waiting".
alter table public.consent_records
  add column if not exists granted_at timestamptz;

comment on column public.consent_records.granted_by_employment_id is
  'Invariant 13: WHO granted. The employment id of the person consenting.';
comment on column public.consent_records.granted_by_signal is
  'Invariant 12/13: the authenticated signal that identity came from -- never a claim.';
comment on column public.consent_records.requesting_party is
  'Invariant 13: TO WHOM. A row with this null cannot clear a disclosure check.';
comment on column public.consent_records.purpose is
  'Invariant 13: FOR WHAT. Re-checked at disclosure time, per acceptance contract §7.';
comment on column public.consent_records.granted_at is
  'Invariant 13: WHEN GRANTED -- distinct from created_at, which is when it was REQUESTED. Null means unanswered.';

-- The disclosure check as an index rather than a convention.  A consent is
-- usable only when all four facts are present AND it is granted; anything else
-- is not a candidate for disclosure at all.  Deliberately NOT a unique index:
-- an employee may consent to two different parties, or to the same party for
-- two different purposes, and those are different consents.
create index if not exists consent_records_disclosure_check_idx
  on public.consent_records (granted_by_employment_id, requesting_party, purpose)
  where status = 'granted'
    and granted_by_employment_id is not null
    and requesting_party is not null
    and purpose is not null
    and granted_at is not null;

-- Ageing (L-19 / VC-32) reads this.  An unanswered request is one whose status
-- has NOT moved.  Nothing in this migration, and nothing in the application,
-- may transition a row on elapsed time alone -- owner answer A5: age and warn
-- everywhere, lapse nowhere.  This index makes the WARNING cheap; there is
-- deliberately no trigger, no scheduled job and no `expires_at` column, because
-- a column called `expires_at` is an invitation to write the sweeper that A5
-- forbids.
create index if not exists consent_records_pending_age_idx
  on public.consent_records (created_at)
  where status not in ('granted', 'denied');

commit;

-- ---------------------------------------------------------------------------
-- ROLLBACK (kept beside the migration rather than in a second file, because a
-- rollback nobody can find is not a rollback):
--
--   begin;
--   drop index if exists public.consent_records_pending_age_idx;
--   drop index if exists public.consent_records_disclosure_check_idx;
--   alter table public.consent_records
--     drop column if exists granted_at,
--     drop column if exists purpose,
--     drop column if exists requesting_party,
--     drop column if exists granted_by_signal,
--     drop column if exists granted_by_employment_id;
--   commit;
--
-- The rollback DROPS RECORDED CONSENT FACTS.  Running it destroys the evidence
-- that a named person permitted a named disclosure.  It is here for a failed
-- apply, not for a change of mind after rows exist.
-- ---------------------------------------------------------------------------
