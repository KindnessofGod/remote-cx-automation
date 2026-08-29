// ---------------------------------------------------------------------------
// uc06SlackNotifier.test.js  —  src/uc06/slackNotifier.js
// ---------------------------------------------------------------------------
// Covers the module in isolation (message shape, the true-no-op-when-
// unconfigured guarantee, never-throws-on-failure) plus the wiring into
// handleAmendmentRequest() — that it fires on the "urgent_cutoff" scenario
// and stays silent on every other one, without ever affecting the returned
// decision. Every fetchImpl here is a fake; no real Slack URL is ever called.
// ---------------------------------------------------------------------------

import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { startMockServer } from "../src/remote/mockServer.js";
import { RemoteClient } from "../src/remote/restClient.js";
import { AuditLogger } from "../src/shared/audit.js";
import { AmendmentStore } from "../src/uc06/amendmentStore.js";
import { handleAmendmentRequest } from "../src/uc06/workflow.js";
import { draftSummary } from "../src/uc06/changeParser.js";
import {
  SlackNotifier,
  buildUrgentCutoffMessage,
  notifyUrgentCutoff,
} from "../src/uc06/slackNotifier.js";

const fakeDraftSummary = (args) => draftSummary(args, { isConfigured: () => false });
const fakeJudge = async () => ({ verdict: "not_evaluated", reason: null });

// ---------------------------------------------------------------------------
// buildUrgentCutoffMessage() — pure, no network involved
// ---------------------------------------------------------------------------

test("buildUrgentCutoffMessage() includes amendment id, employment id, type, effective date, and cutoff detail", () => {
  const text = buildUrgentCutoffMessage({
    amendmentId: "am_123",
    employmentId: "emp_nl_amend_001",
    amendmentType: "HOURS_CHANGE",
    requestedEffectiveDate: "2026-07-15",
    cutoff: {
      cycle: { id: "cyc_july", cutoff_date: "2026-07-10", period_start: "2026-07-01", period_end: "2026-07-31" },
      hoursUntilCutoff: 24,
    },
  });
  assert.match(text, /am_123/);
  assert.match(text, /emp_nl_amend_001/);
  assert.match(text, /HOURS_CHANGE/);
  assert.match(text, /2026-07-15/);
  assert.match(text, /2026-07-10/);
  assert.match(text, /cyc_july/);
  assert.match(text, /24\.0h remaining/);
});

test("buildUrgentCutoffMessage() links the Zendesk ticket when both externalRef and a subdomain are known", () => {
  const text = buildUrgentCutoffMessage({
    amendmentId: "am_123",
    employmentId: "emp_nl_amend_001",
    externalRef: "3003",
    zendeskSubdomain: "your-subdomain",
  });
  assert.match(text, /https:\/\/your-subdomain\.zendesk\.com\/agent\/tickets\/3003/);
});

test("buildUrgentCutoffMessage() falls back to a bare ticket reference with no subdomain configured", () => {
  const text = buildUrgentCutoffMessage({ amendmentId: "am_123", employmentId: "emp_nl_amend_001", externalRef: "3003" });
  assert.match(text, /ticket 3003/);
  assert.doesNotMatch(text, /zendesk\.com/);
});

test("buildUrgentCutoffMessage() never fabricates a cutoff line when no cutoff detail is given", () => {
  const text = buildUrgentCutoffMessage({ amendmentId: "am_123", employmentId: "emp_nl_amend_001" });
  assert.doesNotMatch(text, /Payroll cutoff/);
});

// ---------------------------------------------------------------------------
// SlackNotifier — configured vs. unconfigured, and failure handling
// ---------------------------------------------------------------------------

test("unconfigured (no webhookUrl): notifyUrgentCutoff() is a true no-op — never calls fetchImpl", async () => {
  let called = false;
  const notifier = new SlackNotifier({ webhookUrl: null, fetchImpl: async () => { called = true; return { ok: true }; } });
  const result = await notifier.notifyUrgentCutoff({ amendmentId: "am_1", employmentId: "emp_1" });
  assert.equal(result.sent, false);
  assert.equal(result.reason, "not_configured");
  assert.equal(called, false);
});

test("configured: posts a JSON body with a text field to the webhook URL", async () => {
  let capturedUrl = null;
  let capturedBody = null;
  const notifier = new SlackNotifier({
    webhookUrl: "https://hooks.slack.test/services/FAKE",
    fetchImpl: async (url, opts) => {
      capturedUrl = url;
      capturedBody = JSON.parse(opts.body);
      return { ok: true, status: 200 };
    },
  });
  const result = await notifier.notifyUrgentCutoff({
    amendmentId: "am_1",
    employmentId: "emp_1",
    amendmentType: "SALARY_INCREASE",
    requestedEffectiveDate: "2026-07-15",
    cutoff: { cycle: { id: "cyc_july", cutoff_date: "2026-07-10" }, hoursUntilCutoff: 12.4 },
    externalRef: "3003",
  });
  assert.equal(result.sent, true);
  assert.equal(capturedUrl, "https://hooks.slack.test/services/FAKE");
  assert.equal(typeof capturedBody.text, "string");
  assert.match(capturedBody.text, /am_1/);
  assert.match(capturedBody.text, /12\.4h remaining/);
});

test("configured but the webhook call rejects (network failure): never throws, returns a failure result", async () => {
  const notifier = new SlackNotifier({
    webhookUrl: "https://hooks.slack.test/services/FAKE",
    fetchImpl: async () => {
      throw new Error("simulated network failure");
    },
  });
  const result = await notifier.notifyUrgentCutoff({ amendmentId: "am_1", employmentId: "emp_1" });
  assert.equal(result.sent, false);
  assert.equal(result.reason, "network_error");
  assert.match(result.error, /simulated network failure/);
});

test("configured but the webhook responds non-2xx: never throws, returns a failure result", async () => {
  const notifier = new SlackNotifier({
    webhookUrl: "https://hooks.slack.test/services/FAKE",
    fetchImpl: async () => ({ ok: false, status: 500 }),
  });
  const result = await notifier.notifyUrgentCutoff({ amendmentId: "am_1", employmentId: "emp_1" });
  assert.equal(result.sent, false);
  assert.equal(result.reason, "http_500");
});

test("the module-level default notifyUrgentCutoff() is unconfigured under `npm test` (no SLACK_WEBHOOK_URL) and is a true no-op", async () => {
  const result = await notifyUrgentCutoff({ amendmentId: "am_1", employmentId: "emp_1" });
  assert.equal(result.sent, false);
  assert.equal(result.reason, "not_configured");
});

// ---------------------------------------------------------------------------
// Wiring into handleAmendmentRequest() — fires exactly on urgent_cutoff,
// never affects the decision, and a throwing/rejecting `slack` dep never
// breaks the workflow.
// ---------------------------------------------------------------------------

let server;
let remote;
let audit;
let amendmentStore;

before(async () => {
  // 4064 — was 4019 (comment claimed "distinct from uc06.test.js's 4018", but
  // missed that chatdemo.test.js and uc05.test.js also used 4019, a genuine
  // 3-way collision under node --test's default parallel-file execution.
  server = await startMockServer(4064);
  remote = new RemoteClient({ baseUrl: "http://localhost:4064" });
});
after(() => server && server.close());

beforeEach(() => {
  audit = new AuditLogger();
  amendmentStore = new AmendmentStore();
});

const session = { companyId: "co_amend_01", authenticatedAdminId: "admin_jane" };

test("workflow: fires the Slack notifier with the amendment/employment/cutoff details on an urgent_cutoff amendment", async () => {
  const calls = [];
  const fakeSlack = async (args) => {
    calls.push(args);
    return { sent: true };
  };

  const r = await handleAmendmentRequest(
    {
      employmentId: "emp_nl_amend_001",
      session,
      changes: { weeklyHours: { oldValue: 40, newValue: 32 } },
      requestedEffectiveDate: "2026-07-15",
      now: "2026-07-09", // July cutoff is 2026-07-10 — 24h away, inside the urgent window
    },
    { remote, audit, amendmentStore, draftSummary: fakeDraftSummary, judge: fakeJudge, slack: fakeSlack }
  );

  assert.ok(r.flags.includes("urgent_cutoff"));
  // slack() is fired without being awaited by the workflow — give its
  // microtask a turn before asserting it actually ran.
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].amendmentId, r.amendmentId);
  assert.equal(calls[0].employmentId, "emp_nl_amend_001");
  assert.equal(calls[0].requestedEffectiveDate, "2026-07-15");
  assert.ok(calls[0].cutoff && calls[0].cutoff.cycle);
});

test("workflow: does NOT fire the Slack notifier for an ordinary (non-urgent) dual_approval_required amendment", async () => {
  const calls = [];
  const fakeSlack = async (args) => {
    calls.push(args);
    return { sent: true };
  };

  const r = await handleAmendmentRequest(
    {
      employmentId: "emp_nl_amend_001",
      session,
      changes: { salary: { oldAmount: 50000, newAmount: 60000, currency: "USD" } },
      requestedEffectiveDate: "2026-07-15",
      now: "2026-06-20", // well before the July cutoff
    },
    { remote, audit, amendmentStore, draftSummary: fakeDraftSummary, judge: fakeJudge, slack: fakeSlack }
  );

  assert.equal(r.decision, "dual_approval_required");
  assert.deepEqual(r.flags, []);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls.length, 0);
});

test("workflow: does NOT fire the Slack notifier for an escalated amendment (e.g. cutoff already passed)", async () => {
  const calls = [];
  const fakeSlack = async (args) => {
    calls.push(args);
    return { sent: true };
  };

  const r = await handleAmendmentRequest(
    {
      employmentId: "emp_nl_amend_001",
      session,
      changes: { jobTitle: { oldValue: "Senior Engineer", newValue: "Staff Engineer" } },
      requestedEffectiveDate: "2026-06-15",
      now: "2026-06-20", // the June cutoff has already passed
    },
    { remote, audit, amendmentStore, draftSummary: fakeDraftSummary, judge: fakeJudge, slack: fakeSlack }
  );

  assert.equal(r.decision, "escalate");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls.length, 0);
});

test("workflow: a `slack` dependency that rejects never breaks the workflow or changes the returned decision", async () => {
  const throwingSlack = async () => {
    throw new Error("simulated Slack failure injected by a test");
  };

  const r = await handleAmendmentRequest(
    {
      employmentId: "emp_nl_amend_001",
      session,
      changes: { weeklyHours: { oldValue: 40, newValue: 32 } },
      requestedEffectiveDate: "2026-07-15",
      now: "2026-07-09",
    },
    { remote, audit, amendmentStore, draftSummary: fakeDraftSummary, judge: fakeJudge, slack: throwingSlack }
  );

  assert.equal(r.decision, "dual_approval_required");
  assert.ok(r.flags.includes("urgent_cutoff"));
  assert.ok(r.amendmentId);
  // Give the rejected promise's .catch() a turn — an unhandled rejection here
  // would fail the test run, which is itself the proof nothing escaped.
  await new Promise((resolve) => setImmediate(resolve));
});

test("workflow: with no `slack` override at all, the real (env-unconfigured) default notifier still leaves the decision unaffected", async () => {
  const r = await handleAmendmentRequest(
    {
      employmentId: "emp_nl_amend_001",
      session,
      changes: { weeklyHours: { oldValue: 40, newValue: 32 } },
      requestedEffectiveDate: "2026-07-15",
      now: "2026-07-09",
    },
    { remote, audit, amendmentStore, draftSummary: fakeDraftSummary, judge: fakeJudge }
  );
  assert.equal(r.decision, "dual_approval_required");
  assert.ok(r.flags.includes("urgent_cutoff"));
});
