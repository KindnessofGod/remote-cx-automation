// ---------------------------------------------------------------------------
// config.js  —  Loads .env once and exposes it as one typed object
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
// Every place that needs a secret or an env-tunable value (the LLM key, the
// Remote base URL/token, the Supabase connection string) reads it from HERE,
// never from process.env directly. That keeps the "real vs mock" switch in one
// place: unset vars mean "use the mock / fall back to rule-based", set vars
// mean "use the real service" (see llm.js, restClient usage in liveVerify.js,
// audit.js's optional pgPool).
//
// Importing this module is always safe — if no .env file exists, dotenv is a
// no-op and every field below is just null/its default, which is exactly the
// state the test suite runs in (no real API calls).
// ---------------------------------------------------------------------------

import "dotenv/config";

// ---------------------------------------------------------------------------
// THE HERMETIC FLOOR — one gate, applied to every outbound credential.
// ---------------------------------------------------------------------------
// `npm test` must never reach a paid or third-party service. Injection is the
// rule and every call site still takes its own seam; this is the floor UNDER
// it, for the seam somebody forgets.
//
// It has now been forgotten twice, the same way both times. First the LLM: five
// portal test files injected seven of ten seams and the rest reached OpenAI.
// Then, after that was "fixed", the identical shape survived in `remoteClient()`
// — `npm test` sent the reader's own REMOTE_API_TOKEN to the Sandbox on three
// requests, each retried, and the suite stayed green because a 404 falls back to
// a template. Only the clock moved.
//
// So the floor moved here, to the one place every credential is read, rather
// than to each factory in turn. A test that genuinely wants a configured client
// constructs one explicitly with its own values — that path is untouched.
const UNDER_TEST = Boolean(process.env.NODE_TEST_CONTEXT);
const secret = (v) => (UNDER_TEST ? null : (v || null));

export const config = {
  remote: {
    // Sandbox host is https://gateway.remote-sandbox.com — see .env.example.
    baseUrl: process.env.REMOTE_BASE_URL || "http://localhost:4010",
    token: secret(process.env.REMOTE_API_TOKEN),
  },
  openai: {
    apiKey: secret(process.env.OPENAI_API_KEY),
    model: process.env.OPENAI_MODEL || "gpt-4o-mini",
  },
  supabase: {
    dbUrl: secret(process.env.SUPABASE_DB_URL),
  },
  slack: {
    // UC-06's urgent-payroll-cutoff alert (src/uc06/slackNotifier.js). Unset
    // keeps the notifier a true no-op — no network attempt, ever — which is
    // also the state `npm test` always runs in.
    // Same hermetic floor as isLlmConfigured(): a test process must not post
    // to a real webhook because the developer happens to have one exported.
    // The module-level default notifier is meant to be a no-op under test, and
    // a test asserting that was passing only because nobody had the variable
    // set. A test that wants a configured notifier constructs one with an
    // explicit url, which this does not touch.
    webhookUrl: secret(process.env.SLACK_WEBHOOK_URL),
  },
  zendesk: {
    subdomain: process.env.ZENDESK_SUBDOMAIN || null,
    // Legacy auth (API tokens) — Zendesk is phasing these out (new-token
    // creation reportedly blocked well ahead of the stated Oct 2026 cutoff on
    // at least this account; see BUILD-LOG.md). Kept working here in case a
    // given account still has it.
    email: secret(process.env.ZENDESK_EMAIL),
    apiToken: secret(process.env.ZENDESK_API_TOKEN),
    // Preferred auth — OAuth client_credentials grant, built for exactly this
    // (server-to-server, no interactive user). See ZendeskClient's header
    // comment for what's verified vs. still to confirm live.
    oauthClientId: secret(process.env.ZENDESK_OAUTH_CLIENT_ID),
    oauthClientSecret: secret(process.env.ZENDESK_OAUTH_CLIENT_SECRET),
    // The Zendesk custom-field id carrying the Remote employment id on a
    // verification-request ticket (see BUILD-LOG.md — Zendesk doesn't know
    // about Remote employment ids natively; a custom field bridges them,
    // matching the build case's §25 Phase 1 "Employee ID" ticket field).
    employmentIdFieldId: process.env.ZENDESK_EMPLOYMENT_ID_FIELD_ID || null,
    // Which real ticket `npm run live` exercises the write path against.
    // Defaults to "1" — every fresh Zendesk account has a sample ticket #1.
    liveTestTicketId: process.env.ZENDESK_LIVE_TEST_TICKET_ID || "1",
  },
};

/** True iff enough Zendesk config is present (either auth mode) to call the real API. */
export function isZendeskConfigured() {
  const z = config.zendesk;
  const hasToken = Boolean(z.subdomain && z.email && z.apiToken);
  const hasOAuth = Boolean(z.subdomain && z.oauthClientId && z.oauthClientSecret);
  return hasToken || hasOAuth;
}
