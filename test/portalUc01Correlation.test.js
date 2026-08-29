// ---------------------------------------------------------------------------
// portalUc01Correlation.test.js  —  rca-geoc / R7-28
// ---------------------------------------------------------------------------
// RECORD_CORRELATION_FIELD (src/portal/server.js) had no `uc01` entry, so a
// UC-01 `portal_reference_relinked` row carried its record id only under the
// unindexed `recordId` key. src/auditview/readStore.js's `correlationOf()` —
// the function the drill-down panel's `correlation.field` actually comes from
// (src/auditview/server.js's `GET /api/decisions/:id`) — walks a fixed list of
// KNOWN keys (`CORRELATION_FIELDS`) and never looks at `recordId`, so it always
// answered `{field: null, key: null}` for a UC-01 relink row, and
// src/auditview/assets/app.js:1149 rendered "This row carries no shared record
// id in its details" — even though the caseId sat one line above it in the
// same details object, unindexed.
//
// This asserts the OUTPUT the panel actually reads (`correlationOf(details)`),
// not merely that the map now has a `uc01` key — a guard that only reads back
// the constant it just set proves nothing.
// ---------------------------------------------------------------------------

import { test } from "node:test";
import assert from "node:assert/strict";

import { AuditLogger } from "../src/shared/audit.js";
import { recordTicketRelink } from "../src/portal/server.js";
import { correlationOf } from "../src/auditview/readStore.js";

const UC01_TYPE = { useCase: "UC-01", tier: "low" };

test("rca-geoc: a UC-01 relink row correlates by caseId, so the drill-down panel finds its siblings", async () => {
  const audit = new AuditLogger();
  const caseId = "65c6bd10-0000-4000-8000-000000000001";

  const entry = await recordTicketRelink({
    audit,
    type: UC01_TYPE,
    typeId: "uc01",
    submittedRef: "uc01-20260823000000-abcde",
    ticketId: "9001",
    recordId: caseId,
    persona: { session: { authenticatedEmploymentId: "emp-1" } },
  });

  assert.ok(entry, "recordTicketRelink must actually write a row");
  assert.equal(entry.details.caseId, caseId, "the row carries its record id under the same key UC-01's own decision rows use");

  // THE OBSERVABLE CONSEQUENCE: correlationOf() is what
  // GET /api/decisions/:id hands the panel as `correlation`, and what
  // app.js:1149 branches on ("no shared record id" fires only when
  // correlation.field is falsy). Before this fix this returned
  // {field: null, key: null} for every UC-01 relink row, no matter what
  // recordId it carried.
  const correlation = correlationOf(entry.details);
  assert.equal(correlation.field, "caseId", "the panel must stop reporting 'no shared record id' for a UC-01 relink");
  assert.equal(correlation.key, caseId);
});

test("rca-geoc: UC-03 keeps correlating by caseId too — the fix must not have narrowed an existing entry", async () => {
  const audit = new AuditLogger();
  const caseId = "5e346d7c-6aab-4cfd-9b08-99a59941297b";

  const entry = await recordTicketRelink({
    audit,
    type: { useCase: "UC-03", tier: "low" },
    typeId: "uc03",
    submittedRef: "uc03-20260823000000-fghij",
    ticketId: "117",
    recordId: caseId,
    persona: { session: { authenticatedEmploymentId: "emp-2" } },
  });

  assert.equal(entry.details.caseId, caseId);
  assert.equal(correlationOf(entry.details).field, "caseId");
});
