// ---------------------------------------------------------------------------
// slackNotifier.js  —  Best-effort Slack alert for urgent payroll-cutoff amendments
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
// UC-06's cutoff gate (cutoffEngine.js) already flags an amendment
// `urgent_cutoff` when it's still inside the cutoff window but only barely
// (<= 48h — see URGENT_WINDOW_HOURS there). That flag sits on the amendment
// row and in the ZAF sidebar, but nothing pushes it toward a human who isn't
// already looking at the queue. This module is that push: a Slack message so
// a payroll specialist sees it before the cycle closes, not after.
//
// SAME OPTIONAL-DEPENDENCY PATTERN AS treatyRetriever.js's {pgPool, embed} /
// audit.js's optional pgPool: a `SlackNotifier` takes its webhook URL through
// its constructor; unconfigured (`webhookUrl` unset — SLACK_WEBHOOK_URL not
// in .env) it is a TRUE no-op, never even attempting a network call. That is
// what keeps `npm test` hermetic without a single injected fake needed on the
// unconfigured path, and matches this repo's "optional integrations degrade
// to safe defaults" convention (CLAUDE.md §9) exactly.
//
// WHY IT NEVER THROWS. This is a notification about a decision that has
// ALREADY been made and ALREADY been durably recorded (workflow.js calls this
// only after amendmentStore.createAmendment() and audit.log() have both run —
// see workflow.js's own comment on that ordering, mirroring the n8n
// audit-before-Zendesk-action fix documented in CLAUDE.md). A Slack outage or
// a bad webhook URL must never make the amendment decision itself fail or
// even appear to be delayed — "background writes swallow errors" (CLAUDE.md
// §9). notifyUrgentCutoff() therefore catches everything internally
// (network errors, non-2xx responses, a missing/invalid webhook URL) and
// returns a small `{sent, reason}` result instead of throwing or rejecting.
// Callers on the decision path fire it and do not await/inspect the result;
// tests can await it to assert on `sent`/`reason` directly.
//
// WHAT'S IN THE MESSAGE. Only fields that actually exist on the amendment
// record this module is handed (see amendmentStore.js's SELECT_COLUMNS and
// workflow.js's `result` shape) — amendment id, employment id, amendment
// type, the requested effective date, and the cutoff detail that made this
// urgent in the first place (cycle id, cutoff date, hours remaining, all from
// cutoffEngine.js's evaluateCutoff() return shape). When an externalRef
// (Zendesk ticket id) and a configured Zendesk subdomain are both available,
// the message includes a direct link to the ticket — the same "give the
// recipient something they could act on" reasoning UC-01's letter/ZAF sidebar
// already follow. Nothing is invented: no field this module doesn't actually
// have is fabricated into the message.
// ---------------------------------------------------------------------------

import { config } from "../shared/config.js";

/**
 * Build the Slack message text for one urgent-cutoff amendment. Pure and
 * exported separately so a test can assert on its exact shape without any
 * network layer involved.
 * @param {object} args
 * @param {string} args.amendmentId
 * @param {string} args.employmentId
 * @param {string|null} [args.amendmentType]
 * @param {string|null} [args.requestedEffectiveDate]
 * @param {object|null} [args.cutoff]  evaluateCutoff()'s return shape — cycle/hoursUntilCutoff
 * @param {string|null} [args.externalRef]  Zendesk ticket id, if the amendment has one
 * @param {string|null} [args.zendeskSubdomain]  for building a ticket link; null => no link
 * @returns {string}
 */
export function buildUrgentCutoffMessage({
  amendmentId,
  employmentId,
  amendmentType = null,
  requestedEffectiveDate = null,
  cutoff = null,
  externalRef = null,
  zendeskSubdomain = null,
} = {}) {
  const cycle = cutoff?.cycle ?? null;
  const hours = typeof cutoff?.hoursUntilCutoff === "number" ? cutoff.hoursUntilCutoff.toFixed(1) : null;

  const lines = [
    `:rotating_light: *UC-06 urgent payroll cutoff* — an amendment is still awaiting dual approval and its payroll cycle closes soon.`,
    `*Amendment:* \`${amendmentId}\`${amendmentType ? ` (${amendmentType})` : ""}`,
    `*Employment:* \`${employmentId}\``,
  ];
  if (requestedEffectiveDate) lines.push(`*Requested effective date:* ${requestedEffectiveDate}`);
  if (cycle?.cutoff_date) {
    lines.push(`*Payroll cutoff:* ${cycle.cutoff_date}${cycle.id ? ` (cycle \`${cycle.id}\`)` : ""}${hours !== null ? ` — ~${hours}h remaining` : ""}`);
  } else if (hours !== null) {
    lines.push(`*Payroll cutoff:* ~${hours}h remaining`);
  }
  if (externalRef) {
    const link = zendeskSubdomain
      ? `https://${zendeskSubdomain}.zendesk.com/agent/tickets/${externalRef}`
      : `ticket ${externalRef}`;
    lines.push(`*Ticket:* ${link}`);
  }
  return lines.join("\n");
}

export class SlackNotifier {
  /**
   * @param {object} [opts]
   * @param {string|null} [opts.webhookUrl]  Slack incoming-webhook URL. Absent =>
   *   every notify call is a true no-op (no network attempt at all).
   * @param {string|null} [opts.zendeskSubdomain]  for linking to the amendment's
   *   Zendesk ticket in the message, when both it and externalRef are present.
   * @param {typeof fetch} [opts.fetchImpl]  injectable for tests — defaults to
   *   the real global fetch. Never called at all when unconfigured.
   */
  constructor({ webhookUrl = null, zendeskSubdomain = null, fetchImpl = fetch } = {}) {
    this.webhookUrl = webhookUrl || null;
    this.zendeskSubdomain = zendeskSubdomain || null;
    this.fetchImpl = fetchImpl;
  }

  get isConfigured() {
    return Boolean(this.webhookUrl);
  }

  /**
   * Post the urgent-cutoff alert. NEVER throws and NEVER rejects — see the
   * file header for why. Fire-and-forget on the real decision path; tests may
   * await it directly to inspect the result.
   * @param {object} args  same shape as buildUrgentCutoffMessage()
   * @returns {Promise<{sent: boolean, reason?: string, error?: string}>}
   */
  async notifyUrgentCutoff(args = {}) {
    if (!this.isConfigured) {
      return { sent: false, reason: "not_configured" };
    }
    let text;
    try {
      text = buildUrgentCutoffMessage({ ...args, zendeskSubdomain: this.zendeskSubdomain });
    } catch (err) {
      // A malformed args shape must not escalate into a thrown error either —
      // this is still a best-effort side channel, not part of the decision.
      console.error(`[uc06] failed to build Slack urgent-cutoff message: ${err.message}`);
      return { sent: false, reason: "build_error", error: err.message };
    }
    try {
      const res = await this.fetchImpl(this.webhookUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (!res.ok) {
        console.error(`[uc06] Slack webhook responded ${res.status} for amendment ${args.amendmentId}`);
        return { sent: false, reason: `http_${res.status}` };
      }
      return { sent: true };
    } catch (err) {
      console.error(`[uc06] Slack urgent-cutoff notification failed for amendment ${args.amendmentId}: ${err.message}`);
      return { sent: false, reason: "network_error", error: err.message };
    }
  }
}

// Module-level default, wired from config.js exactly like treatyRetriever.js's
// defaultRetriever — unconfigured (SLACK_WEBHOOK_URL unset) until a deployment
// sets the env var, which is also the state `npm test` always runs in.
let defaultNotifier = new SlackNotifier({
  webhookUrl: config.slack.webhookUrl,
  zendeskSubdomain: config.zendesk.subdomain,
});

/**
 * The default, env-configured notifier. Same call signature the class
 * method takes; workflow.js's `slack` dependency defaults to this so
 * production needs no extra wiring beyond setting SLACK_WEBHOOK_URL, while
 * tests can still override the `slack` dependency with their own fake.
 * @param {object} args  see buildUrgentCutoffMessage()
 * @returns {Promise<{sent: boolean, reason?: string, error?: string}>}
 */
export async function notifyUrgentCutoff(args) {
  return defaultNotifier.notifyUrgentCutoff(args);
}

/**
 * Point the module-level notifyUrgentCutoff() at a differently-configured
 * notifier (e.g. a test's fetchImpl, or a deployment wiring a webhook without
 * restarting from a fresh env). Returns the new default for convenience.
 * @param {object} opts  same options as SlackNotifier's constructor
 * @returns {SlackNotifier}
 */
export function configureSlackNotifier(opts) {
  defaultNotifier = new SlackNotifier(opts);
  return defaultNotifier;
}
