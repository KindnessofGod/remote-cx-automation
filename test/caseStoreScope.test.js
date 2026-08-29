// ---------------------------------------------------------------------------
// caseStoreScope.test.js — one ticket id is not a unique key
// ---------------------------------------------------------------------------
// `cases` is a SHARED table: UC-01 and UC-03 both write rows to it. So looking
// a case up by external_ref alone matches across use cases, and whichever row
// happens to be newest wins.
//
// Found live, in the Zendesk sidebar: ticket 11 carried a UC-01 employment-
// verification case, and UC-03's /api/cases/by-ticket/11 returned it — the
// travel/workation panel presenting a verification case as its own. The user
// spotted it because the subject line ("salary amendment") had nothing to do
// with either.
//
// The project had already reasoned this out one table over and got it right:
// workflow_claims is keyed (use_case, external_ref) explicitly "because one
// ticket may legitimately reach two use cases (UC-03 routes on to UC-04)". The
// argument was written down and not applied here.
// ---------------------------------------------------------------------------

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { CaseStore } from "../src/shared/caseStore.js";

/** Two cases, two use cases, ONE ticket id — the shape that caused the bug. */
function storeWithBothUseCases() {
  const store = new CaseStore();
  store.createCase({
    useCase: "UC-01", source: "zendesk", externalRef: "11",
    employmentId: "emp-1", requester: "a@b.test",
    classification: {}, decision: "human_review", reason: "artifact_present",
    flags: [], status: "pending_review",
  });
  store.createCase({
    useCase: "UC-03", source: "zendesk", externalRef: "11",
    employmentId: "emp-1", requester: "a@b.test",
    classification: {}, decision: "escalate", reason: "destination_unsupported",
    flags: [], status: "escalated",
  });
  return store;
}

test("a ticket id alone matches across use cases — which is why the filter exists", async () => {
  const store = storeWithBothUseCases();
  const unscoped = await store.findByExternalRef("11");
  // Newest wins, so the UC-03 row shadows the UC-01 one. Either answer is
  // wrong for a caller that wanted the other.
  assert.equal(unscoped.useCase, "UC-03");
});

test("scoping by use case returns each caller its OWN case for the same ticket", async () => {
  const store = storeWithBothUseCases();
  assert.equal((await store.findByExternalRef("11", "UC-01")).useCase, "UC-01");
  assert.equal((await store.findByExternalRef("11", "UC-03")).useCase, "UC-03");
});

test("a scoped lookup finds nothing rather than someone else's case", async () => {
  const store = new CaseStore();
  store.createCase({
    useCase: "UC-01", source: "zendesk", externalRef: "11",
    employmentId: "emp-1", requester: "a@b.test",
    classification: {}, decision: "human_review", reason: "artifact_present",
    flags: [], status: "pending_review",
  });
  // UC-03 has no case for this ticket. The honest answer is null — NOT the
  // UC-01 row, which is exactly what shipped.
  assert.equal(await store.findByExternalRef("11", "UC-03"), null);
});

// An optional guard nobody passes is not a guard. These pin the call sites,
// because that is where the defect actually lived — the store was only ever
// answering the question it was asked.
test("UC-03's by-ticket route scopes its lookup", () => {
  const src = readFileSync(new URL("../src/uc03/server.js", import.meta.url), "utf8");
  assert.match(src, /findByExternalRef\(parts\[3\],\s*"UC-03"\)/);
});

test("the UC-01 review store scopes its case lookup", () => {
  const src = readFileSync(new URL("../src/review/store.js", import.meta.url), "utf8");
  assert.match(src, /and use_case = \$2/, "findCaseByExternalRef does not filter by use_case");
});
