// ---------------------------------------------------------------------------
// surfaceVerifyScenarios.test.js  —  discoverScenarios()'s ticket-join logic
// ---------------------------------------------------------------------------
// rca-whir: UC-02 (and every other portal-ticketed use case) creates its
// Zendesk ticket AFTER the decision is already durably audited
// (src/portal/ticketing.js's raiseTicketIfNeeded()), so the ticket id usually
// lands on a SEPARATE, later `portal_reference_relinked` row rather than on
// the decision row itself. `discoverScenarios()` must resolve that id WITHOUT
// letting the relink row stand in as the scenario's `decision` — doing so
// would silently replace the decision's real action (e.g. "human_review")
// with the relink event's own action name and stop every fact keyed on
// `.action` from ever being exercised (empirically confirmed against
// src/surfaceverify/facts.js's ALL_FACTS before this test was written).
//
// This is a hermetic unit test of the JOIN MECHANISM against a fake
// `fetchImpl` — not a violation of rule 3 ("scenarios are discovered, never
// fixtured"), which is about never inventing what counts as a real production
// decision. `fetchImpl` is already an injection seam scenarios.js exposes for
// exactly this kind of test.
// ---------------------------------------------------------------------------

import { test } from "node:test";
import assert from "node:assert/strict";

import { discoverScenarios } from "../src/surfaceverify/scenarios.js";

const BASE_URL = "https://fake-target.invalid";
const PORTAL_KEY = "test-key";

/**
 * @param {object[]} decisionRows  every row `/audit/api/decisions` should list
 * @param {Map<string, object>} byId  full decision bodies keyed by id, for
 *   `/audit/api/decisions/:id`
 */
function fakeFetch(decisionRows, byId) {
  return async (url) => {
    const u = new URL(String(url));
    const parts = u.pathname.split("/").filter(Boolean);
    if (parts.length === 4 && parts[0] === "audit" && parts[1] === "api" && parts[2] === "decisions") {
      const id = parts[3];
      const body = byId.get(id);
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify(body ?? { ok: false, code: "decision_not_found" }),
      };
    }
    if (parts.length === 3 && parts[0] === "audit" && parts[1] === "api" && parts[2] === "decisions") {
      return {
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({ ok: true, decisions: decisionRows, page: { hasMore: false, nextCursor: null } }),
      };
    }
    throw new Error(`fakeFetch: unexpected URL ${u}`);
  };
}

test("discoverScenarios() resolves a ticket id from a relink SIBLING without adopting its action", async () => {
  const decisionRow = {
    id: "decision-1",
    at: "2026-08-22T10:00:00.000Z",
    useCase: "UC-02",
    action: "human_review",
    reason: "over_policy_cap",
    externalRef: "uc02-20260822100000-abcde", // the portal's own pre-ticket reference — not numeric
  };
  const relinkRow = {
    id: "relink-1",
    at: "2026-08-22T10:00:05.000Z", // newer than the decision
    useCase: "UC-02",
    action: "portal_reference_relinked",
    reason: "over_policy_cap", // rca-whir: carries the decision's own reason
  };

  const decisionRows = [relinkRow, decisionRow]; // newest-first, as the real endpoint returns
  const byId = new Map([
    [
      "decision-1",
      {
        ok: true,
        decision: { ...decisionRow, details: { storeId: "store-1", reason: "over_policy_cap" } },
        siblings: [{ id: "relink-1", action: "portal_reference_relinked" }],
      },
    ],
    [
      "relink-1",
      {
        ok: true,
        decision: {
          ...relinkRow,
          details: { storeId: "store-1", reason: "over_policy_cap", ticketId: "5551", recordedRef: "5551" },
        },
        siblings: [],
      },
    ],
  ]);

  const { found, missingRequired } = await discoverScenarios({
    baseUrl: BASE_URL,
    portalKey: PORTAL_KEY,
    useCase: "UC-02",
    fetchImpl: fakeFetch(decisionRows, byId),
    requiredReasons: [{ reason: "over_policy_cap", label: "over cap", required: true, why: "test" }],
  });

  assert.equal(missingRequired.length, 0);
  assert.equal(found.length, 1);
  const [scenario] = found;
  // The DECISION stays the real decision row — its action must survive intact
  // so facts keyed on `.action` (internalNoteNotBareSlug, escalateNeverInstructsApprove)
  // still fire.
  assert.equal(scenario.decision.action, "human_review");
  assert.equal(scenario.decision.id, "decision-1");
  // The ticket id is resolved via the sibling, not by adopting its row.
  assert.equal(scenario.decision.zendeskTicketId, "5551");
});

test("discoverScenarios() never selects a ticket-relink row itself as the scenario's decision", async () => {
  const decisionRow = {
    id: "decision-2",
    at: "2026-08-22T10:00:00.000Z",
    useCase: "UC-02",
    action: "escalate",
    reason: "expense_employment_mismatch",
    externalRef: null,
  };
  const relinkRow = {
    id: "relink-2",
    at: "2026-08-22T10:00:05.000Z",
    useCase: "UC-02",
    action: "portal_reference_relinked",
    reason: "expense_employment_mismatch",
  };

  const decisionRows = [relinkRow, decisionRow];
  const byId = new Map([
    [
      "decision-2",
      {
        ok: true,
        decision: { ...decisionRow, details: { storeId: "store-2", reason: "expense_employment_mismatch" } },
        siblings: [{ id: "relink-2", action: "portal_reference_relinked" }],
      },
    ],
    [
      "relink-2",
      {
        ok: true,
        decision: {
          ...relinkRow,
          details: { storeId: "store-2", reason: "expense_employment_mismatch", ticketId: "5552" },
        },
        siblings: [],
      },
    ],
  ]);

  const { found } = await discoverScenarios({
    baseUrl: BASE_URL,
    portalKey: PORTAL_KEY,
    useCase: "UC-02",
    fetchImpl: fakeFetch(decisionRows, byId),
    requiredReasons: [{ reason: "expense_employment_mismatch", label: "mismatch", required: true, why: "test" }],
  });

  assert.equal(found.length, 1);
  assert.notEqual(found[0].decision.action, "portal_reference_relinked");
  assert.equal(found[0].decision.action, "escalate");
  assert.equal(found[0].decision.zendeskTicketId, "5552");
});

test("discoverScenarios() still resolves a ticket id carried directly on the decision row (UC-01 third-party shape) without a sibling lookup", async () => {
  const decisionRow = {
    id: "decision-3",
    at: "2026-08-22T10:00:00.000Z",
    useCase: "UC-01",
    action: "third_party_handoff_ticket_created",
    reason: "third_party_request",
    externalRef: "530b3977-fake-uuid",
  };
  const decisionRows = [decisionRow];
  const byId = new Map([
    [
      "decision-3",
      {
        ok: true,
        decision: { ...decisionRow, details: { caseId: "case-1", reason: "third_party_request", ticketId: "108" } },
        siblings: [],
      },
    ],
  ]);

  const { found } = await discoverScenarios({
    baseUrl: BASE_URL,
    portalKey: PORTAL_KEY,
    useCase: "UC-01",
    fetchImpl: fakeFetch(decisionRows, byId),
    requiredReasons: [{ reason: "third_party_request", label: "third party", required: true, why: "test" }],
  });

  assert.equal(found.length, 1);
  assert.equal(found[0].decision.zendeskTicketId, "108");
});
