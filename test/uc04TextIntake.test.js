// ---------------------------------------------------------------------------
// uc04TextIntake.test.js  —  UC-04 entered from a message instead of a form
// ---------------------------------------------------------------------------
// WHAT THIS FILE IS FOR, AND WHY THE POSITIVE TEST IS THE POINT
//
// This repo's most expensive recurring defect is a path that structurally
// CANNOT succeed being indistinguishable from one appropriately refusing
// (docs/BUILD-LOG.md §3.30, CLAUDE.md §5's methodological lesson). A free-text
// front door is exactly the kind of thing that fails that way: every refusal
// test would pass against an extractor that returns null for everything.
//
// So the load-bearing test here is the EQUIVALENCE one — the same case
// expressed two ways, as a form submission and as prose plus answers, asserted
// to reach the same decision, reason, risk level, trip length and flags. It is
// the only test in this file that would fail if the extractor quietly stopped
// reading anything.
//
// The other two that matter are its mirror images:
//   · prose that omits the destination produces a NAMED gap, never a default;
//   · prose naming a sanctioned destination still reaches blocked /
//     sanctioned_region, and is never asked a clarifying question instead.
//
// HERMETIC. Every LLM seam is injected — `extract`, `draftSummary` and `judge`
// — so nothing here makes a real, retried OpenAI call because this
// devcontainer's .env happens to carry a (broken) OPENAI_API_KEY. That hazard
// has bitten this repo twice (issues #32 and #27); §4 invariant 10 exists
// because of it. The extractor's own LLM path is exercised with a fake
// `askJson` + `isConfigured`, never the real module.
// ---------------------------------------------------------------------------

import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { startMockServer, resetWorkAuthorizations } from "../src/remote/mockServer.js";
import { RemoteClient } from "../src/remote/restClient.js";
import { AuditLogger } from "../src/shared/audit.js";
import { AuthorizationStore } from "../src/uc04/authorizationStore.js";
import { handleWorkationRequest } from "../src/uc04/workflow.js";
import {
  handleWorkationTextRequest,
  buildClarificationQuestions,
  FROM_TEXT,
  FROM_ANSWER,
  FROM_RECORD,
  NOT_SOURCED,
} from "../src/uc04/textIntake.js";
import {
  extractWorkationFactors,
  extractWorkationFactorsRuleBased,
  parseExplicitDates,
  NEVER_EXTRACTED_FIELDS,
  EXTRACTABLE_DESTINATIONS,
} from "../src/uc04/intakeExtractor.js";
import { draftSummary } from "../src/uc04/requestParser.js";
import { UC04_REQUIRED_INPUTS } from "../src/uc03/uc04Intake.js";
import { VALID_VISA_TYPES, VALID_JOB_DUTIES } from "../src/uc04/policyEngine.js";
import { createUc04Handler } from "../src/uc04/server.js";

let server;
let remote;

before(async () => {
  // 4069 — free per the sweep across test/*.js's startMockServer ports.
  server = await startMockServer(4069);
  remote = new RemoteClient({ baseUrl: "http://localhost:4069" });
});
after(() => server && server.close());

let audit;
let authorizationStore;

beforeEach(() => {
  audit = new AuditLogger();
  authorizationStore = new AuthorizationStore();
  // An approve PATCHes the mock's request in place; without this a later test's
  // lookup finds no PENDING request and reports "no Remote counterpart", which
  // reads as the feature not working rather than as leaked state.
  resetWorkAuthorizations();
});

const session = { companyId: "co_amend_01", authenticatedAdminId: "admin_jane" };
const NOW = "2026-08-15";

// Runs the REAL functions forced into their unconfigured branch, rather than
// hand-duplicating their output — guarantees identical behaviour to
// production's own fallback, never a hand-maintained string that can drift.
const fakeDraftSummary = (args) => draftSummary(args, { isConfigured: () => false });
const fakeJudge = async () => ({ verdict: "not_evaluated", reason: null });
const fakeExtract = (args) => extractWorkationFactors(args, { isConfigured: () => false });

/** An LLM extractor whose model returns exactly `reply`, with no network. */
function llmExtract(reply) {
  return (args) =>
    extractWorkationFactors(args, {
      isConfigured: () => true,
      askJson: async () => reply,
      backoff: async () => {},
    });
}

function textSubmit(overrides = {}, depsOverrides = {}) {
  return handleWorkationTextRequest(
    {
      employmentId: "emp_active_001",
      session,
      travelHistory: [],
      now: NOW,
      ...overrides,
    },
    {
      remote,
      audit,
      authorizationStore,
      extract: fakeExtract,
      draftSummary: fakeDraftSummary,
      judge: fakeJudge,
      ...depsOverrides,
    }
  );
}

// ---------------------------------------------------------------------------
// 1. THE POSITIVE. Real prose in, the same decision a form submission reaches.
// ---------------------------------------------------------------------------

const PROSE =
  "Hi — I'm on the platform team and I'd like to work from Spain for a couple of weeks, " +
  "from 14 September 2026 until 27 September 2026. My family is out there. Is that OK?";

// The four things no message states, answered through the clarification's own
// pickers on the second turn. `homeCountry` is deliberately absent: it comes
// off the employment record, which is the authoritative source for it.
const ANSWERS = {
  nationality: "NG",
  visaType: "schengen_short_stay",
  jobDuties: "engineering",
  hasContractSigningAuthority: false,
};

test("1a. the first turn reads what it can and asks for exactly what it cannot", async () => {
  const turn1 = await textSubmit({ text: PROSE, externalRef: "text-eq-1" });

  assert.equal(turn1.status, "needs_clarification");
  assert.equal(turn1.decision, null, "a question is not a decision");

  // What it read — candidates, and only the three a message can carry.
  assert.deepEqual(
    turn1.readFromText.map((r) => `${r.field}=${r.value}`).sort(),
    ["destination.country=ES", "endDate=2026-09-27", "startDate=2026-09-14"]
  );

  // What it asked for — the four `src/uc03/uc04Intake.js` says nothing can
  // source, and NOT the three it just read.
  assert.deepEqual(turn1.outstanding.sort(), [
    "invalid_job_duties",
    "invalid_visa_type",
    "missing_nationality",
    "missing_signing_authority",
  ]);

  // The two closed enums come back with their allowed values, so the answering
  // surface renders a picker rather than a text box. That is what stops "Spain"
  // reaching a comparison against "ES" on the answer path.
  const visa = turn1.questions.find((q) => q.uc04Issue === "invalid_visa_type");
  assert.deepEqual(new Set(visa.allowedValues), VALID_VISA_TYPES);
  const duties = turn1.questions.find((q) => q.uc04Issue === "invalid_job_duties");
  assert.deepEqual(new Set(duties.allowedValues), VALID_JOB_DUTIES);
  const authority = turn1.questions.find((q) => q.uc04Issue === "missing_signing_authority");
  assert.deepEqual(authority.allowedValues, [true, false]);

  // NOTHING WAS DECIDED AND NOTHING WAS RECORDED AS A DECISION.
  assert.equal(authorizationStore.list().length, 0);
  const rows = audit.entries.filter((e) => e.useCase === "UC-04");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].action, "clarification_requested");
  assert.equal(rows[0].details.externalRef, "text-eq-1");
});

test("1b. EQUIVALENCE — the same case as prose+answers and as a form reaches the same decision", async () => {
  // --- the text path -------------------------------------------------------
  const viaText = await textSubmit({
    text: PROSE,
    supplied: ANSWERS,
    externalRef: "text-eq-2",
  });
  assert.equal(viaText.status, "decided");

  // --- the form path, with the identical factors ---------------------------
  // `homeCountry` is the employment record's own country, which is where the
  // text path sourced it from; every other value is what the requester answered
  // or what the extractor read.
  const viaForm = await handleWorkationRequest(
    {
      employmentId: "emp_active_001",
      session,
      factors: {
        homeCountry: "NG",
        nationality: "NG",
        destination: { country: "ES" },
        startDate: "2026-09-14",
        endDate: "2026-09-27",
        visaType: "schengen_short_stay",
        jobDuties: "engineering",
        hasContractSigningAuthority: false,
      },
      travelHistory: [],
      now: NOW,
      externalRef: "form-eq-2",
    },
    { remote, audit, authorizationStore, draftSummary: fakeDraftSummary, judge: fakeJudge }
  );

  // THE CLAIM THIS WHOLE FILE EXISTS TO MAKE.
  assert.equal(viaText.decision, viaForm.decision);
  assert.equal(viaText.reason, viaForm.reason);
  assert.equal(viaText.riskLevel, viaForm.riskLevel);
  assert.equal(viaText.tripDays, viaForm.tripDays);
  assert.deepEqual(viaText.flags, viaForm.flags);
  assert.deepEqual(viaText.factors, viaForm.factors ?? viaText.factors);

  // And it is a REAL outcome, not both paths failing identically — the whole
  // point of a positive test here (§3.30's failure shape).
  assert.equal(viaForm.decision, "ready_for_approval");
  assert.equal(viaForm.reason, "all_gates_passed");
  assert.equal(viaForm.tripDays, 14);
});

test("1c. an answer overrides a candidate; the record supplies the home country", async () => {
  const r = await textSubmit({
    text: PROSE,
    // The requester corrects the destination the extractor read.
    supplied: { ...ANSWERS, destinationCountry: "pt" },
    externalRef: "text-eq-3",
  });
  assert.equal(r.status, "decided");
  assert.equal(r.factors.destination.country, "PT", "normalised, and the answer wins over the reading");
  assert.equal(r.extraction.provenance["destination.country"].from, FROM_ANSWER);
  assert.equal(r.extraction.provenance.homeCountry.from, FROM_RECORD);
  assert.equal(r.extraction.provenance.homeCountry.value, "NG");
  assert.equal(r.extraction.provenance.startDate.from, FROM_TEXT);
});

// ---------------------------------------------------------------------------
// 2. THE REFUSAL. A missing destination is named, never defaulted.
// ---------------------------------------------------------------------------

test("2a. prose with no destination produces a named gap, not a country", async () => {
  const r = await textSubmit({
    text: "Hi, I'd like to work abroad for three weeks in October 2026. Can you sort that out?",
    externalRef: "text-gap-1",
  });

  assert.equal(r.status, "needs_clarification");
  assert.ok(r.outstanding.includes("missing_destination_country"));
  assert.equal(r.factors.destination.country, null, "no plausible default was invented");
  assert.equal(r.extraction.provenance["destination.country"].from, NOT_SOURCED);
  const asked = r.questions.find((q) => q.uc04Issue === "missing_destination_country");
  assert.equal(asked.answerField, "destinationCountry");
});

test("2b. a date whose year nobody wrote is not extracted", async () => {
  // Two years are named, so neither can be applied to the bare dates: the
  // single-stated-year rule is about scope, not about picking a candidate.
  const { startDate, endDate, yearless } = parseExplicitDates(
    "I went in 2025 and I'd like to go again — from 3 March until 20 March, before 2027."
  );
  assert.equal(startDate, null);
  assert.equal(endDate, null);
  assert.ok(yearless >= 2);

  // One year stated, and it applies.
  const one = parseExplicitDates("From September 14 to October 2, 2026.");
  assert.equal(one.startDate, "2026-09-14");
  assert.equal(one.endDate, "2026-10-02");

  // A date that is not a real day is refused outright.
  assert.equal(parseExplicitDates("2026-02-30 to 2026-03-01").startDate, "2026-03-01");
});

test("2c. a supplied country that is not an alpha-2 code is refused, never passed through", async () => {
  const r = await textSubmit({
    text: "I'd like to work abroad in October 2026.",
    supplied: { ...ANSWERS, destinationCountry: "Spain" },
    externalRef: "text-gap-2",
  });
  assert.equal(r.status, "needs_clarification");
  assert.ok(r.outstanding.includes("missing_destination_country"));
  assert.equal(r.factors.destination.country, null, '"Spain" must never reach a Set.has("ES")');
  assert.match(r.extraction.provenance["destination.country"].detail, /not an ISO two-letter country code/);
});

test("2d. an unanswered signing-authority question stays unanswered — absent is not false", async () => {
  const { hasContractSigningAuthority, ...withoutAuthority } = ANSWERS;
  const r = await textSubmit({ text: PROSE, supplied: withoutAuthority, externalRef: "text-gap-3" });
  assert.equal(r.status, "needs_clarification");
  assert.deepEqual(r.outstanding, ["missing_signing_authority"]);
  assert.equal(r.factors.hasContractSigningAuthority, null);
});

// ---------------------------------------------------------------------------
// 3. THE DANGEROUS ONE. A sanctioned destination read out of prose is blocked,
//    and is never turned into a clarifying question.
// ---------------------------------------------------------------------------

test("3a. prose naming a sanctioned destination reaches blocked / sanctioned_region", async () => {
  const r = await textSubmit({
    text: "I want to work from Iran from 1 October 2026 to 20 October 2026.",
    externalRef: "text-sanctioned-1",
  });

  assert.equal(r.status, "decided", "the sanctions gate decides; it is never deferred to a question");
  assert.equal(r.decision, "blocked");
  assert.equal(r.reason, "sanctioned_region");
  assert.ok(r.flags.includes("sanctioned_region"));
  assert.equal(r.questions, undefined);

  // `blocked` is the one decision workflow.js never resolves a Remote request
  // for — the request touches Remote's work-authorization resource not at all.
  assert.equal(r.workAuthorizationId, null);
  assert.equal(r.remoteRequest.linked, false);
});

test("3b. the same request through the FORM path blocks identically — the door changes nothing", async () => {
  const viaForm = await handleWorkationRequest(
    {
      employmentId: "emp_active_001",
      session,
      factors: {
        homeCountry: "NG",
        nationality: "NG",
        destination: { country: "IR" },
        startDate: "2026-10-01",
        endDate: "2026-10-20",
        visaType: "business_visa",
        jobDuties: "engineering",
        hasContractSigningAuthority: false,
      },
      now: NOW,
      externalRef: "form-sanctioned-1",
    },
    { remote, audit, authorizationStore, draftSummary: fakeDraftSummary, judge: fakeJudge }
  );
  assert.equal(viaForm.decision, "blocked");
  assert.equal(viaForm.reason, "sanctioned_region");
});

test("3c. every sanctioned destination is nameable in prose — the gate is reachable from this door", async () => {
  // The dictionary is imported from uc03/classifier.js precisely so this holds.
  // If a code were added to SANCTIONED_OR_RESTRICTED with no free-text name,
  // that module throws at load; this asserts the consequence here, where it
  // matters: a country nobody can name is a gate nobody can trip.
  const { SANCTIONED_OR_RESTRICTED } = await import("../src/uc03/policyEngine.js");
  for (const code of SANCTIONED_OR_RESTRICTED) {
    assert.ok(
      EXTRACTABLE_DESTINATIONS.has(code),
      `${code} is sanctioned but cannot be read out of free text, so a message naming it would escalate as "destination unknown" instead of blocking`
    );
  }
});

test("3d. identity and employment status still decide before completeness", async () => {
  const noSession = await textSubmit({ text: PROSE, session: null, externalRef: "text-id-1" });
  assert.equal(noSession.status, "decided");
  assert.equal(noSession.reason, "identity_not_verified");

  const terminated = await textSubmit({
    text: PROSE,
    employmentId: "emp_terminated_002",
    externalRef: "text-id-2",
  });
  assert.equal(terminated.status, "decided");
  assert.equal(terminated.reason, "employee_not_active");
});

// ---------------------------------------------------------------------------
// 4. GROUNDING. A value the model produced but the text does not contain is
//    rejected — the check is on the text, never a question to the model.
// ---------------------------------------------------------------------------

test("4a. a country the request never names is rejected, whatever the model says", async () => {
  const extract = llmExtract({
    destinationCountry: "FR",
    startDate: "2026-09-14",
    endDate: "2026-09-27",
    confidence: 0.95,
  });
  const r = await textSubmit({ text: PROSE, externalRef: "text-ground-1" }, { extract });

  assert.equal(r.status, "needs_clarification");
  assert.ok(r.outstanding.includes("missing_destination_country"));
  assert.equal(r.factors.destination.country, null, "France was never mentioned by anyone");
  assert.ok(r.rejected.some((x) => x.field === "destination.country" && /does not appear in the request/.test(x.why)));
});

test("4b. a date whose year is not in the request is rejected", async () => {
  const extract = llmExtract({
    destinationCountry: "ES",
    startDate: "2025-09-14", // the text says 2026
    endDate: "2026-09-27",
    confidence: 0.9,
  });
  const r = await textSubmit({ text: PROSE, externalRef: "text-ground-2" }, { extract });
  assert.equal(r.factors.startDate, null);
  assert.equal(r.factors.endDate, "2026-09-27");
  assert.ok(r.rejected.some((x) => x.field === "startDate"));
});

test("4c. a malformed model reply falls back to the rules, and says so", async () => {
  const extract = llmExtract({ destinationCountry: 42, confidence: "high" });
  const r = await textSubmit({ text: PROSE, supplied: ANSWERS, externalRef: "text-ground-3" }, { extract });
  assert.equal(r.extraction.source, "rule_based_fallback");
  // The fallback read the same three facts the prose actually states.
  assert.equal(r.factors.destination.country, "ES");
  assert.equal(r.decision, "ready_for_approval");
});

test("4d. every result is tagged with the path that produced it", async () => {
  const viaRules = await extractWorkationFactors({ text: PROSE }, { isConfigured: () => false });
  assert.equal(viaRules.source, "rule_based_fallback");

  const viaLlm = await extractWorkationFactors(
    { text: PROSE },
    {
      isConfigured: () => true,
      askJson: async () => ({ destinationCountry: "ES", startDate: "2026-09-14", endDate: "2026-09-27", confidence: 0.8 }),
      backoff: async () => {},
    }
  );
  assert.equal(viaLlm.source, "llm");
  assert.equal(viaLlm.candidates.destinationCountry, "ES");
});

test("4e. the LLM call is retried before the fallback runs", async () => {
  let attempts = 0;
  const r = await extractWorkationFactors(
    { text: PROSE },
    {
      isConfigured: () => true,
      backoff: async () => {},
      askJson: async () => {
        attempts += 1;
        if (attempts < 3) throw new Error("transient");
        return { destinationCountry: "ES", startDate: "2026-09-14", endDate: "2026-09-27", confidence: 0.7 };
      },
    }
  );
  assert.equal(attempts, 3);
  assert.equal(r.source, "llm");
});

// ---------------------------------------------------------------------------
// 5. STRUCTURE. What may never be extracted, pinned to the list that already
//    said so — not to a second copy written here.
// ---------------------------------------------------------------------------

test("5a. the never-extracted set is exactly what src/uc03/uc04Intake.js says nothing can source", () => {
  const cannotSource = UC04_REQUIRED_INPUTS.filter((i) => i.source === null).map((i) => i.uc04Issue).sort();
  const refused = NEVER_EXTRACTED_FIELDS.map((f) => f.uc04Issue).sort();
  assert.deepEqual(refused, cannotSource);
});

test("5b. the extractor's own output never carries the four refused fields", async () => {
  const r = await extractWorkationFactors(
    { text: "I am a Dutch national with a work permit, I'm an executive and I can sign contracts. Spain, 1 September 2026 to 5 September 2026." },
    { isConfigured: () => false }
  );
  // Every one of those four is stated in that sentence, in plain words, and
  // none of them may come out of this function.
  assert.deepEqual(Object.keys(r.candidates).sort(), ["destinationCountry", "endDate", "startDate"]);
});

test("5c. a clarification can only ask about an issue the policy engine raised", () => {
  assert.deepEqual(buildClarificationQuestions([]), []);
  // An unknown slug is reported by the caller as-is rather than guessed at.
  assert.deepEqual(buildClarificationQuestions(["some_future_issue"]), []);
  const asked = buildClarificationQuestions(["missing_nationality"]);
  assert.equal(asked.length, 1);
  assert.equal(asked[0].answerField, "nationality");
  assert.match(asked[0].whyNotRead, /not on the employment record/);
});

// ---------------------------------------------------------------------------
// 6. VISIBILITY. An extracted value must never be shown as though somebody
//    stated it — on the case, in the audit row, and in what a human reads.
// ---------------------------------------------------------------------------

test("6a. the summary a specialist reads names the factors that were read, not stated", async () => {
  const r = await textSubmit({ text: PROSE, supplied: ANSWERS, externalRef: "text-vis-1" });
  assert.match(r.summary, /NOT STATED ON A FORM/);
  assert.match(r.summary, /destination\.country/);
  assert.match(r.summary, /Confirm them before approving/);

  // And it is on the STORED row, which is what the sidebar and the API render.
  const row = await authorizationStore.findById(r.authorizationId);
  assert.equal(row.summary, r.summary);
});

test("6b. a form submission's summary is byte-identical to before — no caveat appears", async () => {
  const viaForm = await handleWorkationRequest(
    {
      employmentId: "emp_active_001",
      session,
      factors: {
        homeCountry: "NG",
        nationality: "NG",
        destination: { country: "ES" },
        startDate: "2026-09-14",
        endDate: "2026-09-27",
        visaType: "schengen_short_stay",
        jobDuties: "engineering",
        hasContractSigningAuthority: false,
      },
      now: NOW,
      externalRef: "form-vis-1",
    },
    { remote, audit, authorizationStore, draftSummary: fakeDraftSummary, judge: fakeJudge }
  );
  assert.doesNotMatch(viaForm.summary, /NOT STATED ON A FORM/);
  assert.equal(viaForm.extraction, null);
});

test("6c. the audit row carries the per-factor provenance", async () => {
  const r = await textSubmit({ text: PROSE, supplied: ANSWERS, externalRef: "text-vis-2" });
  const decisionRow = audit.entries.find((e) => e.details?.externalRef === "text-vis-2" && e.action === r.decision);
  assert.ok(decisionRow, "the decision was audited");
  assert.equal(decisionRow.details.extraction.source, "rule_based_fallback");
  assert.equal(decisionRow.details.extraction.provenance["destination.country"].from, FROM_TEXT);
  assert.equal(decisionRow.details.extraction.provenance.visaType.from, FROM_ANSWER);
});

// ---------------------------------------------------------------------------
// 7. THE API PATH. Extract-only, and deliberately no submit route.
// ---------------------------------------------------------------------------

test("7a. POST /api/intake/extract reads a request and decides nothing", async () => {
  const handler = createUc04Handler({ authorizationStore, audit, remote, extract: fakeExtract });
  const res = await call(handler, "POST", "/api/intake/extract", { text: PROSE });
  assert.equal(res.status, 200);
  assert.equal(res.body.decided, false);
  assert.equal(res.body.candidates.destinationCountry, "ES");
  assert.equal(res.body.neverExtracted.length, 4);
  assert.equal(authorizationStore.list().length, 0, "an extraction writes nothing");
});

test("7b. there is no submit route on this API, and that is the point", async () => {
  const handler = createUc04Handler({ authorizationStore, audit, remote, extract: fakeExtract });
  for (const path of ["/api/intake/submit", "/api/intake", "/api/requests/text"]) {
    const res = await call(handler, "POST", path, { text: PROSE, session });
    assert.equal(res.status, 404, `${path} must not exist — a session read from a body is a claim, not a signal`);
    assert.equal(res.body.code, "no_such_route");
  }
});

test("7c. an empty message is refused rather than extracted from", async () => {
  const handler = createUc04Handler({ authorizationStore, audit, remote, extract: fakeExtract });
  const res = await call(handler, "POST", "/api/intake/extract", { text: "   " });
  assert.equal(res.status, 400);
  assert.equal(res.body.code, "text_required");
});

/** Drive the handler without a socket — same idiom as test/uc04Server.test.js. */
async function call(handler, method, path, body) {
  const chunks = body === undefined ? [] : [Buffer.from(JSON.stringify(body))];
  const req = {
    method,
    url: path,
    headers: { "content-type": "application/json" },
    async *[Symbol.asyncIterator]() {
      for (const c of chunks) yield c;
    },
    on(event, cb) {
      if (event === "data") for (const c of chunks) cb(c);
      if (event === "end") cb();
      return this;
    },
  };
  let status = 0;
  let payload = "";
  const res = {
    statusCode: 200,
    setHeader() {},
    end(text) {
      status = this.statusCode;
      payload = text ?? "";
    },
  };
  await handler(req, res);
  return { status, body: payload ? JSON.parse(payload) : {} };
}

// ---------------------------------------------------------------------------
// 8. The rule-based reader on its own — the path every offline demo runs.
// ---------------------------------------------------------------------------

test("8a. 'from Spain to Germany' resolves the destination by its cue, not by position", () => {
  const r = extractWorkationFactorsRuleBased({
    text: "Travelling from Spain to Germany on 2 March 2026, back on 9 March 2026.",
  });
  assert.equal(r.destinationCountry, "DE");
  assert.equal(r.startDate, "2026-03-02");
  assert.equal(r.endDate, "2026-03-09");
});

test("8b. two countries with no cue resolve to nothing, not to a coin flip", () => {
  const r = extractWorkationFactorsRuleBased({
    text: "Spain and Portugal are both options for October 2026.",
  });
  assert.equal(r.destinationCountry, null);
});
