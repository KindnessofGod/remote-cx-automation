-- ---------------------------------------------------------------------------
-- 0004 — a ceiling on the unauthenticated third-party door
-- ---------------------------------------------------------------------------
-- STATUS: **NOT APPLIED BY HAND.** Unlike 0001-0003, this table is created by
-- the application on first use (src/thirdparty/rateLimit.js,
-- createPgRateLimitStore) rather than by running this file.
--
-- That is a deliberate departure and the reason matters: no coding session in
-- this project has ever been able to reach Supabase over raw TCP (CLAUDE.md
-- §6 — `pg` opens a socket, an HTTP CONNECT proxy cannot relay it, and the
-- direct host resolves IPv6-only from this container). So a deploy that
-- assumed this migration had been applied would fail closed on EVERY request
-- until a human ran it, converting a cost control into an outage on a live
-- demonstration. `CREATE TABLE IF NOT EXISTS` is idempotent and the
-- connection's `postgres` role owns the schema, so first use provisions it.
--
-- This file is therefore the RECORD of the shape, and is safe to run: it is
-- byte-compatible with what the application creates.
--
-- WHY THIS EXISTS
-- src/thirdparty/ is unauthenticated by design (VC-33: a bank enquiring about
-- an employment must not need an account). Before this, "no account" also
-- meant no ceiling: every submission made a real, billed OpenAI call, wrote
-- durable rows, and could raise a real Zendesk ticket — so the running cost of
-- the door was unbounded and payable by anyone who found the URL. It was found
-- while preparing to point a public audience at it.
--
-- WHY IT IS A COUNTER AND NOT A LOG
-- Nothing here identifies a request, a subject, or an outcome. Two keys and an
-- integer. A rate limiter that recorded WHAT was asked would become a record
-- of who enquired about whom — on a door whose entire purpose is to refuse
-- that question to the caller. `bucket_key` holds an address or the literal
-- 'global', never anything about the person being asked about.
--
-- WHY THE PRIMARY KEY IS THE GUARANTEE
-- The increment is a single `INSERT ... ON CONFLICT ... DO UPDATE SET
-- hits = hits + 1 RETURNING hits`. A check-then-update would let two
-- concurrent submissions both read 7 under a limit of 8 and both proceed —
-- the same race that gave ticket #5 two audit_log rows 30µs apart and cost
-- this project a duplicate letter to a customer (CLAUDE.md §4, workflow_claims).
-- The uniqueness is enforced by the database or it is not enforced.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS third_party_rate_limit (
  bucket_key   text        NOT NULL,
  window_start timestamptz NOT NULL,
  hits         integer     NOT NULL DEFAULT 0,
  PRIMARY KEY (bucket_key, window_start)
);

-- ---------------------------------------------------------------------------
-- ADDED 2026-09-02. Supabase's linter flagged this table as the ONE table in
-- the project with row-level security disabled (`rls_disabled_in_public`), and
-- the reason it was the only one is the paragraph at the top of this file: the
-- other tables came from migrations that were applied by hand, this one is
-- created by the application. So the fix had to live in the CREATION PATH —
-- src/thirdparty/rateLimit.js runs exactly these two statements after the
-- CREATE — or production would be closed and a fresh environment born open.
--
-- THE REVOKE IS NOT BELT-AND-BRACES. Row-level security governs SELECT,
-- INSERT, UPDATE and DELETE. It does NOT govern TRUNCATE, which is controlled
-- by table privilege alone — and Supabase's default grants on the public
-- schema gave `anon` every privilege on this table, TRUNCATE included. Enabling
-- RLS on its own therefore stops the read of the address list and STILL leaves
-- anyone holding the publicly-distributable anon key able to wipe the counters,
-- which is the single action that defeats the ceiling outright.
--
-- Zero policies is the intended end state, exactly as for the other tables:
-- RLS on with no policy denies `anon` and `authenticated` everything, while the
-- owning `postgres` role the application connects as bypasses it.
-- ---------------------------------------------------------------------------

ALTER TABLE third_party_rate_limit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON third_party_rate_limit FROM anon, authenticated;

-- Old windows are dead weight the moment they roll; nothing reads them and no
-- decision is ever revisited against them. Deliberately NOT a scheduled job:
-- this project has no job runner, and a cleanup that silently stops running is
-- worse than one a human runs occasionally. Safe to run at any time.
--
--   DELETE FROM third_party_rate_limit WHERE window_start < now() - interval '7 days';
