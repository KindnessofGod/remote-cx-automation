// ---------------------------------------------------------------------------
// thirdPartyCollectBrowser.test.js — the enquirer's journey, in a real browser
// ---------------------------------------------------------------------------
// OWNER, 2026-08-28: "you want me to copy that random number? ... The moment the
// specialist clicks approve, on that page there should be something I can load."
//
// They were right. The reference is a `randomUUID()`; nobody transcribes one to
// collect a document. The browser that sent the request now remembers it, so
// coming back to the page is enough — the panel opens, the field is filled, and
// there is one button.
//
// THIS FILE EXISTS BECAUSE THE UNIT TESTS CANNOT SEE ANY OF THAT. Every other
// test in this repo POSTs JSON. `localStorage`, a `<details>` that opens itself,
// a prefilled input and an iframe that renders a document are browser
// behaviours, and the last defect of exactly this shape — a form field added to
// the HTML and to the quick-fills but never to the POST body — passed 4,330
// tests and was caught only by driving Chromium.
//
// OPT-IN, following test/pdfRender.test.js: `npm test` must stay hermetic and
// fast, and this launches a browser.
//   RUN_BROWSER_TESTS=1 node --test test/thirdPartyCollectBrowser.test.js
// ---------------------------------------------------------------------------

import { test } from "node:test";
import assert from "node:assert/strict";

const skip =
  process.env.RUN_BROWSER_TESTS === "1"
    ? false
    : "set RUN_BROWSER_TESTS=1 to drive the real browser journey (not run by default — see file header)";

test("the enquirer never types a reference: submit, come back, one click, letter", { skip }, async () => {
  const { chromium } = await import("playwright");
  const { startThirdPartyDoorServer } = await import("../src/thirdparty/server.js");
  const { CaseStore } = await import("../src/shared/caseStore.js");
  const { AuditLogger } = await import("../src/shared/audit.js");
  const { RemoteClient } = await import("../src/remote/restClient.js");
  const { createInProcessFetch } = await import("../src/remote/mockServer.js");
  const { classifyRequestRuleBased } = await import("../src/uc01/classifier.js");
  const { advanceOnConsentGrant } = await import("../src/uc01/consentAdvance.js");

  const caseStore = new CaseStore();
  const audit = new AuditLogger();
  const remote = new RemoteClient({ baseUrl: "http://mock.local", token: "t", fetchImpl: createInProcessFetch() });
  const zendesk = { createTicket: async () => ({ id: 900 }), flagForReview: async () => ({}), listGroups: async () => [] };
  const server = await startThirdPartyDoorServer(
    {
      remote,
      audit,
      caseStore,
      zendesk,
      classify: classifyRequestRuleBased,
      demoSubject: { employmentReference: "AO4T9X", subjectName: "Amara Okafor" },
    },
    0
  );
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch();

  try {
    const page = await browser.newPage();
    await page.goto(base);
    await page.click("text=Bank — mortgage");
    await page.click("#request-form button[type=submit]");
    await page.waitForSelector("#result-reference:not([hidden])", { timeout: 20000 });

    const shown = await page.textContent("#result-reference");
    const reference = shown.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/)[1];

    assert.notEqual(await page.getAttribute("#collect-panel", "open"), null, "the collect panel did not open itself");
    assert.equal(await page.inputValue("#collectReference"), reference, "the reference was not filled in for them");

    // The employee consents; the grant raises the hand-off; a specialist approves.
    const pending = caseStore.consentRecords.find((r) => r.status === "pending");
    await caseStore.updateConsentDecision(pending.id, {
      status: "granted",
      grantedByEmploymentId: "emp_active_001",
      grantedBySignal: "portal_persona_session",
    });
    await advanceOnConsentGrant({ caseStore, audit, remote, zendesk, consentRecordId: pending.id });
    const advanced = await caseStore.findByDoorReference(reference);
    assert.ok(advanced, "the advanced case is not reachable by the enquirer's reference");
    caseStore.createDocument({
      caseId: advanced.id,
      type: "employment_verification_letter",
      content: "<html><body><h1>Employment Verification Letter</h1></body></html>",
    });

    // THE JOURNEY THAT MATTERS: come back later, having kept nothing.
    await page.reload();
    assert.notEqual(await page.getAttribute("#collect-panel", "open"), null, "the panel forgot the request on reload");
    assert.equal(await page.inputValue("#collectReference"), reference, "the reference was not remembered across a reload");
    assert.equal(await page.getAttribute("#collect-known", "hidden"), null, "nothing told them it had been remembered");

    await page.click("#collect-submit-btn");
    await page.waitForSelector("#collect-letter:not([hidden])", { timeout: 20000 });
    assert.ok(await page.isVisible("iframe.tp-letter-frame"), "the letter did not render");
    assert.ok(await page.isVisible("a.tp-letter-download"), "there is no way to download it");

    // AND FORGETTING WORKS — a shared machine is why this control exists.
    await page.click("#collect-forget");
    assert.equal(await page.inputValue("#collectReference"), "", "'Forget this request' left the reference in place");
    await page.reload();
    assert.equal(await page.inputValue("#collectReference"), "", "a forgotten reference came back after a reload");
  } finally {
    await browser.close();
    server.close();
  }
});
