// ---------------------------------------------------------------------------
// db.js  —  Lazy Postgres pool for the Supabase audit_log table
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
// One place to build the `pg` Pool from config, so AuditLogger and the live
// script share a single connection strategy. Returns null when SUPABASE_DB_URL
// isn't set — callers (AuditLogger) treat that as "stay in-memory only",
// which is what keeps `npm test` and `npm run demo` free of any DB dependency.
//
// Connects as the `postgres` role from the Supabase connection string, which
// owns the audit_log table and therefore bypasses its RLS (the table has RLS
// enabled with zero policies defined, so any other role would be denied all
// access — see .env.example).
// ---------------------------------------------------------------------------

import pg from "pg";
import { config } from "./config.js";

let pool = null;

/** Returns a shared pg.Pool, or null if SUPABASE_DB_URL isn't configured. */
export function getPgPool() {
  if (!config.supabase.dbUrl) return null;
  if (!pool) {
    pool = new pg.Pool({
      connectionString: config.supabase.dbUrl,
      ssl: { rejectUnauthorized: false }, // Supabase pooler cert chain
    });
  }
  return pool;
}

/** Close the shared pool (used by liveVerify.js so the process can exit). */
export async function closePgPool() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
