// ---------------------------------------------------------------------------
// uc01.test.js  —  The 7 UC-01 scenarios from docs/use-cases/UC-01.md §12
// ---------------------------------------------------------------------------
// These run the WHOLE workflow against the mock Remote server, so they prove
// the pieces work together, not just in isolation. Run with:  npm test
// ---------------------------------------------------------------------------

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { startMockServer, OFFBOARDINGS } from "../src/remote/mockServer.js";
import { RemoteClient } from "../src/remote/restClient.js";
import { AuditLogger } from "../src/shared/audit.js";
import { CaseStore } from "../src/shared/caseStore.js";
import { handleVerificationTicket } from "../src/uc01/workflow.js";
import { classifyRequest, classifyRequestRuleBased } from "../src/uc01/classifier.js";
import { evaluate } from "../src/uc01/policyEngine.js";
import { renderLetterHtml } from "../src/uc01/letter.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

let server;
let remote;

before(async () => {
  server = await startMockServer(4011); // test port
  remote = new RemoteClient({ baseUrl: "http://localhost:4011" });
});
after(() => server && server.close());

// Explicitly inject the rule-based classifier so these tests exercise the mock
// end to end regardless of whether OPENAI_API_KEY happens to be set in the
// environment they run in — never a real, billed OpenAI call from `npm test`.
function run(ticket, { caseStore = new CaseStore() } = {}) {
  return handleVerificationTicket(ticket, {
    remote,
    audit: new AuditLogger(),
    caseStore, // in-memory only by default — no pgPool passed in tests
    classify: classifyRequestRuleBased,
  });
}

// A logged-in employee: their session proves who they are, AND proves they are
// inside Remote — where the Requests tab already serves this letter in seconds.
// Since G-2 that is a DEFLECTION, not an issue. See the pair of tests below.
const sessionFor = (id) => ({ authenticatedEmploymentId: id });

// The other authenticated signal, and the one the live path actually carries:
// the requester Zendesk itself authenticated, matched against the email on the
// Remote record. It proves who is asking and does NOT prove they can reach
// Remote's self-service flow — they raised a ticket, which is evidence they did
// not use it. This is the population G-2 leaves on the auto-issue path.
const ticketRequesterFor = (email) => ({ authenticatedEmail: email });

test("1. logged-in employee, standard request -> DEFLECTED to Remote's own self-service", async () => {
  // G-2 / DRIFT-076. This test asserted `auto_resolve` until 2026-08-21 and the
  // change is the point, not a regression: Remote already issues this exact
  // letter from the Requests tab in seconds, and issuing a second parallel copy
  // duplicates a solved flow. The requester is signed in to Remote, so we know
  // they can reach it — which is the only condition under which "go and get it
  // yourself" is advice we can stand behind.
  const r = await run({
    text: "Please send me a standard employment verification letter.",
    session: sessionFor("emp_active_001"),
    employmentId: "emp_active_001",
  });
  assert.equal(r.decision, "deflected_to_self_service");
  assert.equal(r.reason, "self_service_available");
  // Nothing was refused, and the requester is told where to go in their own
  // words — never a slug.
  assert.match(r.requesterReply, /Requests tab/);
  assert.ok(!/self_service_available/.test(r.requesterReply));
  // No letter was rendered, so there is nothing to store: the deflection costs
  // the document as well as the reply.
  assert.equal(r.letterHtml, undefined);
});

test("1a. POSITIVE: auto-issue SURVIVES G-2 — a ticket requester still gets the letter", async () => {
  // VC-25, and the single most important assertion in the deflection work.
  // Deflecting EVERYBODY looks identical to deflecting correctly from outside,
  // and G-2's whole risk is that `auto_resolve` becomes unreachable in
  // production while every negative test stays green. This is the positive
  // test that detects it — three dead gates in this repository's history were
  // invisible to a fully green negative suite.
  const r = await run({
    text: "Please send me a standard employment verification letter.",
    session: ticketRequesterFor("amara@acme.test"),
    employmentId: "emp_active_001",
    // rca-fawf/K3: `auto_resolve` now REFUSES without a reference. A ticket
    // requester always has one in production (the ticket id), so supplying it
    // here is what makes this fixture a real ticket rather than a direct call.
    externalRef: "uc01-1a",
  });
  assert.equal(r.decision, "auto_resolve");
  assert.equal(r.reason, "all_gates_passed");
  assert.match(r.letterHtml, /Employment Verification Letter/);
  assert.match(r.letterHtml, /Amara Okafor/);
  // The weaker of the two authenticated signals answered, and it says so.
  assert.equal(r.identity.method, "requester_email");
  assert.equal(r.identity.reason, "requester_matches_employment");
});

test("rca-tlb2 (R7-20): the letter prints the SAME reference the ticket carries, so a landlord holding a forwarded copy has something to quote", async () => {
  const r = await run({
    text: "Please send me a standard employment verification letter.",
    session: ticketRequesterFor("amara@acme.test"),
    employmentId: "emp_active_001",
    externalRef: "42",
    source: "zendesk",
  });
  assert.equal(r.decision, "auto_resolve");
  assert.match(r.letterHtml, /<th>Reference<\/th><td>42<\/td>/);
});

test("1b. the letter fetches nothing from anywhere — it is a document, not a page", async () => {
  // The letter is posted to a real Zendesk ticket as html_body and rendered to
  // PDF, so it is opened by the employee and by whoever they forwarded it to —
  // a landlord, a bank, an immigration officer. Any external reference in it
  // would make each of those people call a third party on open, handing over
  // their IP and the fact that they are reading an employment verification
  // document about a named person.
  //
  // This shipped once: the template carried an @import of Google Fonts. It was
  // invisible in every test, because a webfont that fails to load just falls
  // back. Asserting the ABSENCE of external references is the only way to keep
  // it gone — the same reasoning as the field whitelist below, which pins what
  // the letter must never contain rather than trusting it not to.
  const r = await run({
    text: "Please send me a standard employment verification letter.",
    session: { authenticatedEmail: "amara@acme.test" }, // ticket requester: the auto-issue path (G-2 deflects a Remote session)
    employmentId: "emp_active_001",
    externalRef: "uc01-1b", // rca-fawf/K3 — an unreferenced auto_resolve is refused
  });

  const externalRefs = r.letterHtml.match(/https?:\/\/[^"')\s]+/g) ?? [];
  assert.deepEqual(externalRefs, [], "the letter must reference no external host");
  assert.ok(!/@import/i.test(r.letterHtml), "the letter must not @import a stylesheet");
  assert.ok(!/<script/i.test(r.letterHtml), "the letter must contain no script");
});

test("2. terminated employee -> escalate, NO letter", async () => {
  const r = await run({
    text: "I need a standard employment letter.",
    session: sessionFor("emp_terminated_002"),
    employmentId: "emp_terminated_002",
  });
  assert.equal(r.decision, "escalate");
  assert.equal(r.letterHtml, undefined);
  assert.ok(r.flags.includes("employment_status_terminated"));
});

test("3. uploaded bank form -> human review", async () => {
  const r = await run({
    text: "My bank sent this form, please complete it.",
    session: ticketRequesterFor("amara@acme.test"),
    employmentId: "emp_active_001",
    hasAttachment: true,
  });
  assert.equal(r.decision, "human_review");
});

test("4. external verification portal URL -> human review", async () => {
  const r = await run({
    text: "Here is the link to my lender's portal: https://verify.example.com/xyz",
    session: ticketRequesterFor("amara@acme.test"),
    employmentId: "emp_active_001",
  });
  assert.equal(r.decision, "human_review");
  assert.ok(r.flags.includes("external_url"));
});

test("5a. third party (no session), nobody has answered yet -> awaiting_employee_consent (VC-06, NOT a refusal)", async () => {
  // G-3. This asserted `escalate` until 2026-08-21, and the change is the
  // criterion working rather than a regression: nothing has been decided
  // about the employee's willingness because they have not been asked (or
  // have not answered), so `escalate` — which implies a specialist should go
  // and look at the record — was the wrong shape entirely. `awaiting_employee_
  // consent` is a PENDING state: no case is being reviewed, no letter is
  // withheld pending a human's judgement call, and nothing was disclosed.
  const r = await run({
    text: "This is First Bank, we need to verify employment directly.",
    session: null,
    employmentId: "emp_active_001",
  });
  assert.equal(r.decision, "awaiting_employee_consent");
  assert.equal(r.reason, "awaiting_employee_consent");
  assert.ok(r.flags.some((f) => f.startsWith("identity_")));
  // Not a refusal: no employment fact anywhere on the reply, and the same
  // generic acknowledgement VC-33 requires (see refusalCopy.js's shared
  // `AWAITING_OR_REFUSED_CONSENT` object).
  assert.match(r.requesterReply, /note of this request/i);
  assert.equal(r.letterHtml, undefined);
});

test("5b. third party, VC-07: a GRANTED consent artifact — proven by reading the row back, not by asserting a boolean", async () => {
  // VC-07: "the refusal path alone proves nothing. A boolean is not
  // evidence." So this drives the round trip for real: (1) the FIRST ask
  // reaches the pending state and durably creates a consent_records row
  // (L-9); (2) that row is read BACK from the store (not re-derived) and
  // granted, exactly as the employee consent surface (L-13) would; (3) the
  // SAME ask, repeated, now reaches `human_review`/`third_party_request` —
  // never zero-touch, even with consent (VC-07's own wording) — because the
  // lookup (L-8) now finds a GRANTED, COMPLETE artifact.
  const caseStore = new CaseStore();
  const ticket = {
    text: "This is First Bank, please verify employment on behalf of the employee.",
    session: null,
    employmentId: "emp_active_001",
    requestingParty: "First Bank",
    purpose: "Mortgage application",
    source: "third_party_door",
    externalRef: "tp-vc07-1",
  };

  const first = await run(ticket, { caseStore });
  assert.equal(first.decision, "awaiting_employee_consent");

  // READ THE ROW BACK. Not `caseStore.consentRecords[0]` blindly — the same
  // lookup a real caller (the employee consent surface) would use.
  const artifact = await caseStore.findConsentArtifact({
    employmentId: "emp_active_001",
    requestingParty: "First Bank",
    purpose: "Mortgage application",
  });
  assert.ok(artifact, "L-9 must have created a pending consent_records row for the first party+purpose ask");
  assert.equal(artifact.status, "pending");
  assert.equal(artifact.grantedAt, null);

  // GRANT IT, exactly as L-13's employee consent surface would.
  await caseStore.updateConsentDecision(artifact.id, {
    status: "granted",
    grantedByEmploymentId: "emp_active_001",
    grantedBySignal: "test_stub_session",
  });
  const granted = await caseStore.findConsentArtifact({
    employmentId: "emp_active_001",
    requestingParty: "First Bank",
    purpose: "Mortgage application",
  });
  assert.equal(granted.status, "granted");
  assert.ok(granted.grantedAt, "granting must set grantedAt — a row with granted_at null is still 'still waiting' (L-19)");
  assert.equal(granted.grantedByEmploymentId, "emp_active_001");

  // THE SAME ASK, REPEATED — and "the same ask" now has a precise meaning.
  //
  // Consent is PER-ENQUIRY (2026-08-28): a grant authorises the enquiry it was
  // given for, not every future request that party phrases the same way. So the
  // repeat carries the SAME `doorReference` — it is this enquiry being decided
  // again, which is exactly what the consent-grant advance
  // (src/uc01/consentAdvance.js) does — with a fresh `externalRef`, because the
  // first one is already claimed and re-running under it would be refused as a
  // redelivery and write nothing.
  //
  // A repeat with a NEW doorReference is a NEW enquiry and correctly returns to
  // `awaiting_employee_consent`; that is asserted just below.
  const second = await run(
    { ...ticket, externalRef: "tp-vc07-2", doorReference: "tp-vc07-1" },
    { caseStore }
  );
  assert.equal(second.decision, "human_review");
  assert.equal(second.reason, "third_party_request");
  assert.equal(second.identity.verified, true);
  assert.equal(second.identity.reason, "third_party_with_consent");
  assert.equal(second.identity.consentRecordId, artifact.id);

  // AND THE OTHER HALF OF THE RULE: a genuinely new enquiry from the same party
  // for the same purpose does NOT ride on that grant. Before this, one grant
  // authorised that bank to ask again indefinitely and the employee was never
  // consulted a second time.
  const freshEnquiry = await run(
    { ...ticket, externalRef: "tp-vc07-3", doorReference: "tp-vc07-3" },
    { caseStore }
  );
  assert.equal(
    freshEnquiry.decision,
    "awaiting_employee_consent",
    "a new enquiry rode on a consent granted for an earlier one"
  );
});

test("5c. third party, VC-08: a DENIED consent blocks, and the reply says nothing about why", async () => {
  const caseStore = new CaseStore();
  const ticket = {
    text: "This is Second Bank, we would like to verify employment.",
    session: null,
    employmentId: "emp_active_001",
    requestingParty: "Second Bank",
    purpose: "Landlord reference",
    source: "third_party_door",
    externalRef: "tp-vc08-1",
  };
  const first = await run(ticket, { caseStore });
  const artifact = await caseStore.findConsentArtifact({
    employmentId: "emp_active_001",
    requestingParty: "Second Bank",
    purpose: "Landlord reference",
  });
  assert.ok(artifact);
  await caseStore.updateConsentDecision(artifact.id, {
    status: "denied",
    grantedByEmploymentId: "emp_active_001",
    grantedBySignal: "test_stub_session",
  });

  const second = await run({ ...ticket, externalRef: "tp-vc08-2" }, { caseStore });
  assert.equal(second.decision, "blocked");
  assert.equal(second.reason, "consent_refused");
  assert.equal(second.identity.reason, "third_party_consent_denied");
  // VC-33: the exact same acknowledgement as the pending case above — the
  // third party is never told the employee said no, and never told why.
  assert.equal(second.requesterReply, first.requesterReply);
  assert.match(second.requesterReply, /note of this request/i);

  // The denial is recorded against the employee's own instruction — read
  // BACK from the row, never inferred.
  const decided = await caseStore.findConsentArtifact({
    employmentId: "emp_active_001",
    requestingParty: "Second Bank",
    purpose: "Landlord reference",
  });
  assert.equal(decided.status, "denied");
  assert.equal(decided.grantedByEmploymentId, "emp_active_001");
  assert.equal(decided.grantedAt, null, "nothing was ever granted, so grantedAt stays null on a denial");
});

test("6. logged-in user requesting SOMEONE ELSE's letter -> awaiting_employee_consent (session mismatch is a consent question, not a refusal)", async () => {
  const r = await run({
    text: "Standard employment letter please.",
    session: sessionFor("emp_active_001"), // logged in as Amara...
    employmentId: "emp_terminated_002",    // ...but asking about Kofi
  });
  // G-3 extends the L-11/VC-28 reconciliation one step further: a logged-in
  // person asking about somebody else IS a third party, and — since G-3 —
  // "nobody has answered yet" is a PENDING state for a third party exactly as
  // it is for an anonymous one, never `escalate`. The rule is not "you may
  // not"; it is "not unless the person whose data this is agrees", and that
  // person has not yet been asked.
  assert.equal(r.decision, "awaiting_employee_consent");
  assert.equal(r.reason, "awaiting_employee_consent");
  // The MORE SPECIFIC of the two pending reasons is what a reviewer would
  // still want to see internally — this collapsed session_employment_mismatch
  // into the consent regime, and losing the diagnosis with it would have been
  // the very trap `test/lowTierExceptionData.test.js`'s "the two failures
  // differ" exists to catch.
  assert.ok(r.flags.includes("identity_awaiting_employee_consent_other_employee_signed_in"), r.flags.join(","));
  // The diagnostic fact is carried on the derivation too, and reaches the audit
  // row from there.
  assert.equal(r.requesterType.requesterType, "third_party");
  assert.equal(r.requesterType.basis, "session_names_another_employment");
});

test("6b. unauthenticated self (email, no session) -> awaiting_employee_consent (needs step-up, not a refusal)", async () => {
  const r = await run({
    text: "Standard employment letter please.",
    session: null,
    employmentId: "emp_active_001",
  });
  // Same reconciliation as test 6, one step further under G-3. With no
  // authenticated signal at all, nothing has been proved about who is asking,
  // so the STRICTER regime applies — `self` is the permissive answer and is
  // never arrived at by default (L-10, VC-29) — and the strictER regime, under
  // G-3, is "pending", never a refusal with nobody having been asked anything.
  assert.equal(r.decision, "awaiting_employee_consent");
  assert.ok(r.flags.includes("identity_awaiting_employee_consent"), r.flags.join(","));
  assert.equal(r.requesterType.basis, "no_authenticated_signal");
});

test("VC-33: a third party asking about a person who does not exist gets the IDENTICAL reply", async () => {
  // (c) of VC-33's three cases. `emp_does_not_exist` 404s against the mock,
  // so `remote.getEmployment()` returns null — and the reply must still be
  // byte-identical to the pending/denied cases above, because a different
  // shape here would disclose that nobody by this reference exists.
  const caseStore = new CaseStore();
  const r = await run(
    {
      text: "This is Third Bank, please verify this person's employment.",
      session: null,
      employmentId: "emp_does_not_exist",
      requestingParty: "Third Bank",
      purpose: "Reference check",
      source: "third_party_door",
      externalRef: "tp-vc33-c",
    },
    { caseStore }
  );
  assert.equal(r.decision, "awaiting_employee_consent");
  assert.match(r.requesterReply, /note of this request/i);
  const pendingReply = await run(
    {
      text: "This is First Bank, we need to verify employment directly.",
      session: null,
      employmentId: "emp_active_001",
    },
    { caseStore: new CaseStore() }
  );
  assert.equal(r.requesterReply, pendingReply.requesterReply, "(a) and (c) must be word-identical");
});

test("7. letter never discloses salary (no over-disclosure)", async () => {
  const r = await run({
    text: "standard employment verification letter",
    session: ticketRequesterFor("amara@acme.test"),
    employmentId: "emp_active_001",
    externalRef: "uc01-7", // rca-fawf/K3 — an unreferenced auto_resolve is refused
  });
  assert.equal(r.decision, "auto_resolve");
  assert.doesNotMatch(r.letterHtml, /50,000|5000000|salary/i);
});

test("7b. request asking for salary -> human_review with over-scope flag", async () => {
  const r = await run({
    text: "Please send me a standard employment verification letter, and can you also confirm my salary on it?",
    session: ticketRequesterFor("amara@acme.test"),
    employmentId: "emp_active_001",
  });
  assert.equal(r.decision, "human_review");
  assert.equal(r.reason, "over_scope_request");
  assert.ok(r.flags.includes("over_scope_disclosure_requested"));
});

// --- operational state (cases / review_queue / documents) -----------------
// These construct their own CaseStore so the test can inspect its in-memory
// arrays directly, rather than going through the shared run() helper above.

test("8. auto_resolve creates a resolved case + a document, no review_queue entry", async () => {
  const caseStore = new CaseStore();
  const r = await handleVerificationTicket(
    {
      text: "Please send me a standard employment verification letter.",
      session: ticketRequesterFor("amara@acme.test"),
      employmentId: "emp_active_001",
      externalRef: "zendesk_123",
    },
    { remote, audit: new AuditLogger(), caseStore, classify: classifyRequestRuleBased }
  );

  assert.equal(caseStore.cases.length, 1);
  const caseRow = caseStore.cases[0];
  assert.equal(caseRow.id, r.caseId);
  assert.equal(caseRow.status, "resolved");
  assert.equal(caseRow.decision, "auto_resolve");
  assert.equal(caseRow.externalRef, "zendesk_123");
  assert.equal(caseRow.employmentId, "emp_active_001");

  assert.equal(caseStore.reviewQueue.length, 0);

  assert.equal(caseStore.documents.length, 1);
  assert.equal(caseStore.documents[0].caseId, caseRow.id);
  assert.equal(caseStore.documents[0].type, "employment_verification_letter");
  assert.equal(caseStore.documents[0].content, r.letterHtml);
  assert.match(caseStore.documents[0].contentHash, /^[0-9a-f]{64}$/); // sha256 hex
});

test("9. human_review creates a pending_review case + a review_queue entry, no document", async () => {
  const caseStore = new CaseStore();
  const r = await handleVerificationTicket(
    {
      text: "My bank sent this form, please complete it.",
      session: ticketRequesterFor("amara@acme.test"),
      employmentId: "emp_active_001",
      hasAttachment: true,
    },
    { remote, audit: new AuditLogger(), caseStore, classify: classifyRequestRuleBased }
  );

  assert.equal(r.decision, "human_review");
  assert.equal(caseStore.cases[0].status, "pending_review");
  assert.equal(caseStore.reviewQueue.length, 1);
  assert.equal(caseStore.reviewQueue[0].caseId, r.caseId);
  assert.equal(caseStore.reviewQueue[0].status, "pending");
  assert.equal(caseStore.documents.length, 0);
});

test("10. escalate creates an escalated case + a review_queue entry, no document", async () => {
  const caseStore = new CaseStore();
  const r = await handleVerificationTicket(
    {
      text: "I need a standard employment letter.",
      session: sessionFor("emp_terminated_002"),
      employmentId: "emp_terminated_002",
    },
    { remote, audit: new AuditLogger(), caseStore, classify: classifyRequestRuleBased }
  );

  assert.equal(r.decision, "escalate");
  assert.equal(caseStore.cases[0].status, "escalated");
  assert.equal(caseStore.reviewQueue.length, 1);
  assert.equal(caseStore.reviewQueue[0].caseId, r.caseId);
  assert.equal(caseStore.documents.length, 0);
});

// --- classifier source tagging ----------------------------------------------
// classifyRequest() must tag which path produced the classification, exactly
// like the n8n port (workflows/nodes/validateClassification.js). The llm.js
// seams are injected so these tests never depend on — or touch — a real
// OPENAI_API_KEY, keeping the suite hermetic in any environment.

test("11. classifyRequest tags source 'llm' when the LLM path succeeds", async () => {
  const c = await classifyRequest(
    { text: "Please send me a standard employment verification letter." },
    {
      isConfigured: () => true,
      askJson: async () => ({
        intent: "standard_letter",
        hasExternalUrl: false,
        requesterType: "self",
        confidence: 0.95,
        requestedFields: [], // REQUIRED — see test 17
      }),
    }
  );
  assert.equal(c.source, "llm");
  assert.equal(c.intent, "standard_letter");
  assert.equal(c.requesterType, "self");
  assert.equal(c.hasAttachment, false); // ground truth from input, not the model
});

test("12. classifyRequest tags source 'rule_based_fallback' when unconfigured, never calling the LLM", async () => {
  let asked = false;
  const c = await classifyRequest(
    { text: "Please send me a standard employment verification letter." },
    {
      isConfigured: () => false,
      askJson: async () => {
        asked = true;
        return {};
      },
    }
  );
  assert.equal(c.source, "rule_based_fallback");
  assert.equal(c.intent, "standard_letter");
  assert.equal(asked, false);
});

test("13. classifyRequest tags source 'rule_based_fallback' after retries are exhausted on any LLM failure", async () => {
  let attempts = 0;
  const c = await classifyRequest(
    { text: "Please send me a standard employment verification letter." },
    {
      isConfigured: () => true,
      askJson: async () => {
        attempts++;
        throw new Error("connection refused");
      },
      backoff: async () => {}, // no-op: don't wait on real backoff delays in tests
    }
  );
  assert.equal(c.source, "rule_based_fallback");
  assert.equal(c.intent, "standard_letter");
  assert.equal(attempts, 3, "retries 3 times (§4 invariant 10) before falling back");
});

test("14. classifyRequest tags source 'rule_based_fallback' after retries when the LLM response fails schema validation", async () => {
  let attempts = 0;
  const c = await classifyRequest(
    { text: "Please send me a standard employment verification letter." },
    {
      isConfigured: () => true,
      askJson: async () => {
        attempts++;
        return {
          intent: "not_a_real_intent", // fails isValidClassification()
          hasExternalUrl: false,
          requesterType: "self",
          confidence: 0.95,
        };
      },
      backoff: async () => {},
    }
  );
  assert.equal(c.source, "rule_based_fallback");
  assert.equal(c.intent, "standard_letter");
  assert.equal(attempts, 3, "an invalid shape retries too — it's as likely transient as a network error");
});

test("15. classifyRequestRuleBased's own shape is untagged (source added only at classifyRequest level)", () => {
  const c = classifyRequestRuleBased({ text: "standard employment verification letter" });
  assert.equal(c.source, undefined);
  assert.equal(c.intent, "standard_letter");
});

test("16. out-of-scope request is refused without creating a case", async () => {
  // TWO OF THIS TEST'S ASSERTIONS COULD NOT FAIL. `run()` builds its own
  // AuditLogger and CaseStore internally, so the two locals declared here were
  // never passed to anything — `caseStore.cases.length` and
  // `audit.entries.length` were being read off objects the workflow had never
  // seen, and would have read 0 whatever the workflow did. Now the stores under
  // test are the ones actually used.
  const audit = new AuditLogger();
  const caseStore = new CaseStore();
  const r = await handleVerificationTicket(
    {
      text: "What's the weather like today?",
      session: ticketRequesterFor("amara@acme.test"),
      employmentId: "emp_active_001",
    },
    { remote, audit, caseStore, classify: classifyRequestRuleBased }
  );
  assert.equal(r.decision, "out_of_scope");
  assert.ok(r.reply);
  assert.equal(r.caseId, null);
  assert.equal(caseStore.cases.length, 0);
  assert.equal(caseStore.reviewQueue.length, 0);
  assert.equal(caseStore.documents.length, 0);

  // NOT `audit.entries.length === 0` any more. Since L-18 this path writes
  // exactly one `audit_trace` row — a decision was reached and the out-of-scope
  // RATE has to be computable — and `entries` is the shared in-memory buffer for
  // both tables, so it now holds one. The invariant that matters is that no
  // `audit_log` row was written, which is asserted by its shape. The row's
  // actual persistence is proved against the destination file in
  // test/uc01OutOfScopeTrace.test.js, which is the assertion that counts:
  // `entries` would hold the entry even if nothing were ever written anywhere.
  const auditLogRows = audit.entries.filter((e) => e.useCase !== undefined || e.action !== undefined);
  assert.deepEqual(auditLogRows, [], "no audit_log row for an out-of-scope refusal");
  assert.equal(audit.entries.filter((e) => e.call === "uc01.out_of_scope").length, 1);
});

// ---------------------------------------------------------------------------
// F-17 — the over-scope disclosure gate must not be a no-op on the LLM path
// ---------------------------------------------------------------------------
// The gate exists to route "send a letter AND include my salary" to a human.
// It used to be unreachable in production: the validator accepted a
// classification with no `requestedFields` at all, and the live n8n prompt
// never asked the model for that field, so the policy engine read the absence
// as "nothing extra was asked for". Disclosure itself was still safe (the
// letter's field whitelist holds — test 1b), but the ROUTING never happened.

test("17. a classification with no requestedFields is an INVALID shape — the LLM path falls back rather than skipping the gate", async () => {
  let attempts = 0;
  const c = await classifyRequest(
    { text: "Please send a standard verification letter and include my salary." },
    {
      isConfigured: () => true,
      askJson: async () => {
        attempts++;
        // Exactly what the live prompt used to elicit: every other field
        // present, requestedFields simply absent.
        return { intent: "standard_letter", hasExternalUrl: false, requesterType: "self", confidence: 0.95 };
      },
      backoff: async () => {},
    }
  );
  assert.equal(attempts, 3, "a missing requestedFields is retried like any other invalid shape");
  assert.equal(c.source, "rule_based_fallback");
  // "compensation", not "salary", since Classifier V2.2: the frozen prompt
  // teaches the model `"Please include my salary." -> ["compensation"]` and the
  // 48-case golden dataset encodes that as its answer key, so renaming here
  // would invalidate a measured regression result. The GUARANTEE this test
  // exists for is unchanged and still asserted above — a missing
  // requestedFields is retried, then falls back, and the fallback detects the
  // field the model omitted rather than the gate being skipped. Only the name
  // of the field moved; policyEngine.js's FIELD_VOCABULARY translates it back
  // to the contract's "salary" at the boundary, which is what VC-09 checks.
  assert.deepEqual(c.requestedFields, ["compensation"], "the fallback detects deterministically what the model omitted");
});

test("18. the LLM's own requestedFields are honoured when it does answer the question", async () => {
  const c = await classifyRequest(
    { text: "Standard verification letter please." },
    {
      isConfigured: () => true,
      askJson: async () => ({
        intent: "standard_letter",
        hasExternalUrl: false,
        requesterType: "self",
        confidence: 0.95,
        requestedFields: ["manager_name"],
      }),
    }
  );
  assert.equal(c.source, "llm");
  assert.deepEqual(c.requestedFields, ["manager_name"]);
});

test("19. F-17 end to end: 'include my salary' routes to human_review, it does not auto-resolve", async () => {
  const r = await run({
    text: "Please send a standard verification letter and include my salary.",
    session: ticketRequesterFor("amara@acme.test"),
    employmentId: "emp_active_001",
  });
  assert.equal(r.decision, "human_review", "the finding's exact proof case");
  assert.equal(r.reason, "over_scope_request");
  assert.ok(r.flags.includes("over_scope_disclosure_requested"));
});

test("20. the over-scope gate FAILS CLOSED: an absent requestedFields is a human's call, never a silent 'nothing was asked for'", () => {
  const base = {
    // A COMPLETE record on purpose. This test's subject is the over-scope gate,
    // and its last case asserts the happy path still auto-resolves — so the
    // fixture has to satisfy the completeness gate (step 7) too, or it would
    // pass for the wrong reason.
    employment: {
      status: "active",
      full_name: "Alex Morgan",
      start_date: "2023-06-26",
      contract_type: "employee",
    },
    identity: { verified: true, reason: "requester_matches_employment" },
  };
  const absent = evaluate({
    ...base,
    classification: { intent: "standard_letter", requesterType: "self", confidence: 0.99 },
  });
  assert.equal(absent.decision, "human_review");
  assert.equal(absent.reason, "over_scope_undetermined");
  assert.deepEqual(absent.flags, ["requested_fields_unknown"]);

  // A non-array (a model returning a bare string) is the same refusal.
  const notAnArray = evaluate({
    ...base,
    classification: { intent: "standard_letter", requesterType: "self", confidence: 0.99, requestedFields: "salary" },
  });
  assert.equal(notAnArray.reason, "over_scope_undetermined");

  // And an explicit empty array — the model actually answering "none" — still
  // auto-resolves, so failing closed did not break the happy path.
  const answered = evaluate({
    ...base,
    classification: { intent: "standard_letter", requesterType: "self", confidence: 0.99, requestedFields: [] },
  });
  assert.equal(answered.decision, "auto_resolve");
});

// ---------------------------------------------------------------------------
// F-19 (UC-01 half) — the confidence gate must fail CLOSED
// ---------------------------------------------------------------------------
test("21. a missing or NaN confidence goes to a human — `undefined < 0.85` and `NaN < 0.85` are both false", () => {
  const base = {
    // `contract_type` is required of every fixture that drives evaluate()
    // directly since G-1 landed: engagement eligibility is gate 1 and an absent
    // engagement type is `eor_status_unknown` by design, because an engagement
    // we cannot read is not an EOR engagement we may attest to. Adding it here
    // does not weaken this test — the subject is the confidence gate, and this
    // is what it takes to reach it.
    employment: { status: "active", contract_type: "employee" },
    identity: { verified: true, reason: "requester_matches_employment" },
  };
  for (const confidence of [undefined, NaN, null, "0.99"]) {
    const r = evaluate({
      ...base,
      classification: { intent: "standard_letter", requesterType: "self", requestedFields: [], confidence },
    });
    assert.equal(r.decision, "human_review", `confidence ${String(confidence)} must never auto-resolve`);
    assert.equal(r.reason, "confidence_unknown");
    assert.deepEqual(r.flags, ["confidence_unknown"]);
  }
});

// ---------------------------------------------------------------------------
// The completeness gate — a letter may never print a blank where a fact goes
// ---------------------------------------------------------------------------
test("21b. a record missing any field the letter prints goes to a human, never out as a blank row", () => {
  const complete = {
    status: "active",
    full_name: "Alex Morgan",
    start_date: "2023-06-26",
    contract_type: "employee",
  };
  const classification = {
    intent: "standard_letter",
    requesterType: "self",
    confidence: 0.99,
    requestedFields: [],
  };
  const identity = { verified: true, reason: "requester_matches_employment" };

  // The control: a complete record still auto-resolves.
  assert.equal(evaluate({ employment: complete, classification, identity }).decision, "auto_resolve");

  // `contract_type` IS NO LONGER TESTED HERE, and its absence now refuses
  // EARLIER rather than not at all.
  //
  // Since G-1, `contract_type` is read by two gates: engagement eligibility
  // (gate 1) and this completeness gate (gate 12). An absent engagement type
  // therefore refuses at gate 1 as `blocked` / `eor_status_unknown` and never
  // reaches gate 12 — which is strictly better, because "we cannot tell what
  // kind of engagement this is" is a more precise thing to tell a specialist
  // than "a field the letter prints is missing". The assertion below pins that
  // routing, so if gate 1 ever stops catching it this test fails rather than
  // silently handing the case back to gate 12.
  {
    const r = evaluate({ employment: { ...complete, contract_type: null }, classification, identity });
    assert.equal(r.decision, "blocked");
    assert.equal(r.reason, "eor_status_unknown");
  }

  // Each required field, absent in every way a real API can express "absent".
  for (const field of ["full_name", "start_date"]) {
    for (const empty of [null, undefined, "", "   "]) {
      const r = evaluate({
        employment: { ...complete, [field]: empty },
        classification,
        identity,
      });
      assert.equal(
        r.decision,
        "human_review",
        `${field}=${JSON.stringify(empty)} must never auto-issue a letter`
      );
      assert.equal(r.reason, "incomplete_employment_record");
      assert.deepEqual(r.missingFields, [field]);
      assert.ok(r.flags.includes("incomplete_employment_record"));
    }
  }

  // job_title is NOT required — letter.js renders its row conditionally, so its
  // absence removes a row rather than leaving a blank one.
  assert.equal(
    evaluate({ employment: { ...complete, job_title: null }, classification, identity }).decision,
    "auto_resolve"
  );
});

test("21c. the blank a letter would have printed is exactly what the gate now refuses", () => {
  // Proves the defect is real rather than theoretical: render the letter from a
  // record with no start date and confirm the row comes out empty. The gate
  // above is what stops this reaching a customer.
  const html = renderLetterHtml(
    { full_name: "Alex Morgan", status: "active", contract_type: "employee", start_date: null },
    { name: "Rempel-Paucek LLC" }
  );
  assert.match(html, /<th>Start date<\/th><td><\/td>/, "escapeHtml(null) renders an empty cell");

  // And the same record is refused before it can ever be rendered.
  const r = evaluate({
    employment: { full_name: "Alex Morgan", status: "active", contract_type: "employee", start_date: null },
    classification: { intent: "standard_letter", requesterType: "self", confidence: 0.99, requestedFields: [] },
    identity: { verified: true, reason: "requester_matches_employment" },
  });
  assert.equal(r.decision, "human_review");
  assert.deepEqual(r.missingFields, ["start_date"]);
});

// ---------------------------------------------------------------------------
// F-25 — the durable audit row must exist BEFORE anything customer-facing
// ---------------------------------------------------------------------------
test("22. a failing audit backend refuses the customer-facing action instead of orphaning it", async () => {
  const caseStore = new CaseStore();
  const zendeskCalls = [];
  const brokenAudit = {
    entries: [],
    log() {},
    logTraceStep() {},
    async logDurable() {
      throw new Error("supabase unreachable");
    },
  };
  const zendesk = {
    async resolveWithLetter(ref, html) {
      zendeskCalls.push({ ref, html });
    },
    async flagForReview(ref, opts) {
      zendeskCalls.push({ ref, opts });
    },
  };

  await assert.rejects(
    handleVerificationTicket(
      {
        text: "Please send me a standard employment verification letter.",
        session: ticketRequesterFor("amara@acme.test"),
        employmentId: "emp_active_001",
        source: "zendesk",
        externalRef: "4242",
      },
      { remote, audit: brokenAudit, caseStore, zendesk, classify: classifyRequestRuleBased }
    ),
    /supabase unreachable/
  );

  assert.equal(zendeskCalls.length, 0, "no letter posted and no ticket solved without a durable audit row");
  assert.equal(caseStore.cases.length, 1, "the case row still exists for a specialist to work by hand");
});

test("23. the decision survives a letter-render failure — the record is written first, and the failure is audited too", async () => {
  const audit = new AuditLogger();
  const caseStore = new CaseStore();
  const zendeskCalls = [];
  // getLegalEntity() 404ing used to throw a raw TypeError BEFORE any case or
  // audit row existed, destroying the record of a decision already made.
  const brokenRemote = {
    getEmployment: (id) => remote.getEmployment(id),
    getLegalEntity: async () => {
      throw new TypeError("Cannot read properties of undefined (reading 'data')");
    },
  };

  await assert.rejects(
    handleVerificationTicket(
      {
        text: "Please send me a standard employment verification letter.",
        session: ticketRequesterFor("amara@acme.test"),
        employmentId: "emp_active_001",
        source: "zendesk",
        externalRef: "4243",
      },
      {
        remote: brokenRemote,
        audit,
        caseStore,
        zendesk: { async resolveWithLetter(...a) { zendeskCalls.push(a); } },
        classify: classifyRequestRuleBased,
      }
    ),
    /UC-01 letter rendering failed for case/
  );

  assert.equal(caseStore.cases.length, 1, "the decision's case row survives the render failure");
  const actions = audit.forUseCase("UC-01").map((e) => e.action);
  assert.deepEqual(actions, ["auto_resolve", "letter_render_failed"], "decision first, then the failure — both on the record");
  assert.equal(zendeskCalls.length, 0, "nothing customer-facing ran");

  // rca-5vdx / GROUND 1: no document was ever created (createDocument() is
  // never reached on this path — the render throws before it), so the
  // decision row must NOT claim a letter exists. Before this fix the row read
  // `letterIssued: true` here purely because the decision was `auto_resolve`.
  const decisionRow = audit.forUseCase("UC-01").find((e) => e.action === "auto_resolve");
  assert.equal(decisionRow.details.letterIssued, false, "no artifact behind it — the claim must not be made");
  assert.equal(decisionRow.details.letterDocumentId, null);
  assert.equal(decisionRow.details.letterContentHash, null);
  assert.equal(caseStore.documents.length, 0, "no documents row exists to corroborate a claim anyway");
});

test("24. the durable decision row is written before the Zendesk action, and says a letter was issued", async () => {
  const audit = new AuditLogger();
  const caseStore = new CaseStore();
  const order = [];
  const realLogDurable = audit.logDurable.bind(audit);
  audit.logDurable = async (e) => {
    order.push(`audit:${e.action}`);
    return realLogDurable(e);
  };

  await handleVerificationTicket(
    {
      text: "Please send me a standard employment verification letter.",
      session: ticketRequesterFor("amara@acme.test"),
      employmentId: "emp_active_001",
      source: "zendesk",
      externalRef: "4244",
    },
    {
      remote,
      audit,
      caseStore,
      zendesk: { async resolveWithLetter() { order.push("zendesk:resolveWithLetter"); } },
      classify: classifyRequestRuleBased,
    }
  );

  assert.deepEqual(order, ["audit:auto_resolve", "zendesk:resolveWithLetter"], "durable log strictly before the customer-facing write");
  assert.equal(audit.forUseCase("UC-01")[0].details.letterIssued, true);
});

test("24b. rca-5vdx / GROUND 1: letterIssued: true is corroborated — a real documents row, independently hashed, not a fixture echoed back", async () => {
  const audit = new AuditLogger();
  const caseStore = new CaseStore();
  let postedLetterHtml = null;

  await handleVerificationTicket(
    {
      text: "Please send me a standard employment verification letter.",
      session: ticketRequesterFor("amara@acme.test"),
      employmentId: "emp_active_001",
      source: "zendesk",
      externalRef: "4245",
    },
    {
      remote,
      audit,
      caseStore,
      zendesk: {
        async resolveWithLetter(_ref, html) {
          postedLetterHtml = html;
        },
      },
      classify: classifyRequestRuleBased,
    }
  );

  const decisionRow = audit.forUseCase("UC-01").find((e) => e.action === "auto_resolve");
  assert.equal(decisionRow.details.letterIssued, true);
  assert.ok(decisionRow.details.letterDocumentId, "a document id is named on the row");
  assert.ok(decisionRow.details.letterContentHash, "a content hash is named on the row");

  // The row's claim must be checkable against the STORE, not merely present.
  const documentRow = caseStore.documents.find((d) => d.id === decisionRow.details.letterDocumentId);
  assert.ok(documentRow, "the named document id resolves to a real documents row");
  assert.equal(documentRow.type, "employment_verification_letter");
  assert.equal(documentRow.caseId, decisionRow.details.caseId);

  // The hash on the audit row is computed INDEPENDENTLY here (sha256 of the
  // letter this test itself saw posted to Zendesk) rather than trusting the
  // same value the code under test also produced — a test that only compares
  // a value to itself proves nothing (this bead's own "do not verify by
  // injecting a hash and asserting the same hash comes back" instruction).
  const independentHash = createHash("sha256").update(postedLetterHtml).digest("hex");
  assert.equal(decisionRow.details.letterContentHash, independentHash);
  assert.equal(documentRow.contentHash, independentHash);
  assert.equal(documentRow.content, postedLetterHtml, "the stored artifact is the exact letter the customer received");
});

// ---------------------------------------------------------------------------
// F-24 — idempotency: a duplicated ticket must not produce a second letter
// ---------------------------------------------------------------------------
// Real Zendesk ticket #5 was delivered three times within microseconds and the
// customer received two verification letters plus two audit rows 30µs apart.
// Zendesk retries webhook deliveries, so duplicate delivery is ordinary.
test("25. F-24: the same ticket delivered twice issues exactly one letter", async () => {
  const caseStore = new CaseStore();
  const zendeskCalls = [];
  const zendesk = {
    resolveWithLetter: async (ref, html) => { zendeskCalls.push({ ref, html }); },
    flagForReview: async () => {},
    escalate: async () => {},
  };
  const ticket = {
    text: "Please send me a standard employment verification letter.",
    session: { authenticatedEmail: "amara@acme.test" }, // ticket requester: the auto-issue path (G-2 deflects a Remote session)
    employmentId: "emp_active_001",
    externalRef: "dup-ticket-1",
    source: "zendesk",
  };
  const deps = { remote, audit: new AuditLogger(), caseStore, zendesk, classify: classifyRequestRuleBased };

  const first = await handleVerificationTicket({ ...ticket }, deps);
  const second = await handleVerificationTicket({ ...ticket }, deps);

  assert.equal(first.decision, "auto_resolve");
  assert.equal(second.duplicate, true, "the second delivery must report itself as a duplicate");
  assert.equal(zendeskCalls.length, 1, "exactly one letter may reach the customer");
  assert.equal(caseStore.cases.length, 1, "exactly one case row");
});

test("26. F-24: concurrent deliveries of one ticket still issue exactly one letter", async () => {
  const caseStore = new CaseStore();
  const zendeskCalls = [];
  const zendesk = {
    resolveWithLetter: async (ref, html) => { zendeskCalls.push({ ref, html }); },
    flagForReview: async () => {},
    escalate: async () => {},
  };
  const ticket = {
    text: "Please send me a standard employment verification letter.",
    session: { authenticatedEmail: "amara@acme.test" }, // ticket requester: the auto-issue path (G-2 deflects a Remote session)
    employmentId: "emp_active_001",
    externalRef: "dup-ticket-concurrent",
    source: "zendesk",
  };
  const deps = { remote, audit: new AuditLogger(), caseStore, zendesk, classify: classifyRequestRuleBased };

  // This is the shape ticket #5 actually arrived in: three near-simultaneous
  // deliveries, not three sequential ones.
  const results = await Promise.all([
    handleVerificationTicket({ ...ticket }, deps),
    handleVerificationTicket({ ...ticket }, deps),
    handleVerificationTicket({ ...ticket }, deps),
  ]);

  assert.equal(zendeskCalls.length, 1, "exactly one letter despite three concurrent deliveries");
  assert.equal(results.filter((r) => r.duplicate).length, 2, "two of the three must report duplicate");
});

// ---------------------------------------------------------------------------
// The claim ledger is scoped BY USE CASE, not by ticket id alone
// ---------------------------------------------------------------------------
// The two tests above prove a ticket is claimed exactly once. This one proves
// the opposite direction, which is just as easy to get wrong and much quieter
// when you do: one Zendesk ticket may legitimately reach more than one use
// case. UC-03 explicitly routes a workation inquiry on to UC-04, and both must
// be free to claim the same ref.
//
// If the ledger were keyed on external_ref alone, the second use case would
// look like a duplicate of the first and be silently dropped — a real customer
// request lost with no error anywhere, which is strictly worse than the
// duplicate letter this whole mechanism exists to prevent.
test("27. F-24: one ticket may be claimed once per use case, not once globally", async () => {
  const caseStore = new CaseStore();

  const first = await caseStore.claimExternalRef("shared-ticket-1", "route_to_uc04", "UC-03");
  const secondUseCase = await caseStore.claimExternalRef("shared-ticket-1", "human_review", "UC-04");
  const repeatOfFirst = await caseStore.claimExternalRef("shared-ticket-1", "route_to_uc04", "UC-03");

  assert.equal(first.claimed, true, "the first use case claims it");
  assert.equal(secondUseCase.claimed, true, "a DIFFERENT use case may claim the same ticket");
  assert.equal(repeatOfFirst.claimed, false, "the SAME use case may not claim it twice");
});

// ---------------------------------------------------------------------------
// The salary guarantee, asserted against the RENDERED letter and driven from
// the record's own numbers rather than hard-coded literals.
// ---------------------------------------------------------------------------
// Test 7 above pins `/50,000|5000000|salary/i` — the values one fixture happens
// to carry. That catches today's leak and nothing else: change the fixture's
// salary, or add a row rendering a compensation field under a different name,
// and the assertion still passes while the letter discloses pay. The letter is
// posted to a real Zendesk ticket as `html_body` and rendered to PDF, so a leak
// here reaches a landlord, a bank, or an immigration officer.
//
// So this drives the real renderer with a record carrying compensation under
// EVERY name this codebase uses for it, and asserts none of those values
// survives into the rendered HTML.
test("7c. the rendered letter contains no value the record carries as compensation", () => {
  // Distinctive numbers, so a match cannot be a coincidence of formatting.
  const COMP = {
    base_salary: 8675309,
    annual_gross_salary: 8675309,
    compensation_gross_amount: 8675309,
    salary: 86753.09,
    currency: "XTS", // the ISO "reserved for testing" code
    compensation_currency_code: "XTS",
  };
  const html = renderLetterHtml(
    {
      full_name: "Alex Morgan",
      status: "active",
      contract_type: "employee",
      start_date: "2023-04-01",
      job_title: "Analyst",
      probation: false,
      ...COMP,
      contract_details: { ...COMP },
      basic_information: { ...COMP },
    },
    { name: "Rempel-Paucek LLC", address: "1 Example Way" }
  );

  // Every rendering of every compensation value, including the formats a
  // template might reasonably produce from them.
  const forbidden = ["8675309", "8,675,309", "86753.09", "86,753.09", "XTS", "€", "$"];
  for (const needle of forbidden) {
    assert.ok(
      !html.includes(needle),
      `the rendered letter leaked ${JSON.stringify(needle)} — a compensation value the record carried`
    );
  }

  // And the field NAMES must not appear either: a row labelled "Annual gross
  // salary" with an empty cell still tells the reader the letter is about pay.
  for (const label of ["salary", "compensation", "gross", "wage", "pay rate"]) {
    // The template carries one legitimate sentence saying financial details are
    // NOT disclosed; strip it before looking for the words.
    const body = html.replace(
      /Financial details and other confidential employment terms are not\s*disclosed in this letter\./g,
      ""
    );
    assert.ok(
      !new RegExp(label, "i").test(body),
      `the rendered letter mentions ${JSON.stringify(label)} outside its own non-disclosure sentence`
    );
  }

  // Positive half: it is still a real letter, so this is not passing by
  // rendering nothing at all.
  assert.match(html, /Alex Morgan/);
  assert.match(html, /Employment Verification Letter/);
  assert.match(html, /Rempel-Paucek LLC/);
});

test("7d. every row the letter renders comes from the employment record, and the compensation rows do not exist", () => {
  // A structural read of the template rather than of one output: the set of
  // `employment.<field>` references in letter.js IS the letter's disclosure
  // surface, and no compensation field may be in it. This catches a leak added
  // to a code path no fixture happens to exercise — a row behind a conditional
  // that today's records never satisfy, which a rendered-output test cannot
  // see.
  const source = readFileSync(join(__dirname, "..", "src", "uc01", "letter.js"), "utf8")
    .replace(/\/\/[^\n]*/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");
  const referenced = new Set(
    Array.from(source.matchAll(/employment\.([a-zA-Z_][a-zA-Z0-9_]*)/g), (m) => m[1])
  );
  const banned = [
    "base_salary",
    "annual_gross_salary",
    "compensation_gross_amount",
    "salary",
    "currency",
    "compensation_currency_code",
    "wage_type",
    "salary_rate",
    "holiday_allowance",
  ];
  for (const field of banned) {
    assert.ok(
      !referenced.has(field),
      `letter.js reads employment.${field} — the standard letter must never touch a compensation field`
    );
  }
  // Sanity: the check is looking at something. If this ever empties, the regex
  // has stopped matching and the assertions above became vacuous.
  assert.ok(referenced.size >= 5, `expected the template to read several record fields, saw ${referenced.size}`);
});

// ---------------------------------------------------------------------------
// rca-bdz: end to end — an employee serving notice whose status still reads
// "active" is no longer invisible to G-1
// ---------------------------------------------------------------------------
test("rca-bdz: a real offboarding on file escalates the whole ticket, even though the employment record's own status is still active", async () => {
  // emp_active_001's `status` is genuinely "active" — the whole point is that
  // G-1 can no longer trust that field alone.
  OFFBOARDINGS["emp_active_001"] = [{ id: "off_e2e_1", type: "resignation", status: "in_review" }];
  try {
    const r = await run({
      text: "Please send me a standard employment verification letter.",
      session: ticketRequesterFor("amara@acme.test"),
      employmentId: "emp_active_001",
    });
    assert.equal(r.decision, "escalate");
    assert.equal(r.reason, "engagement_offboarding");
    assert.ok(r.flags.includes("offboarding_record_found"));
    // No letter — nothing was rendered or stored for a genuinely ending
    // employment, exactly as the status-derived path already guarantees.
    assert.equal(r.letterHtml, undefined);
  } finally {
    delete OFFBOARDINGS["emp_active_001"];
  }
});
