// ---------------------------------------------------------------------------
// uc03LetterScope.test.js  —  the standard letter, and the one it is not
// ---------------------------------------------------------------------------
// THE POSITIVE TEST IS FIRST, AND IT IS THE POINT
//
// The change under test refuses to draft a letter when the template cannot say
// what was asked. A gate like that has exactly one interesting failure mode,
// and this repository has a name for it: if `standard` becomes unreachable,
// "structurally cannot succeed" and "appropriately cautious" look identical
// from outside, and every negative test in this file would still pass. So the
// first two tests drive a plain letter request end to end — through the gates,
// through the drafting, through a real specialist signature — and assert the
// rendered bytes.
//
// The second half is the split: seven kinds of ask the template cannot carry,
// each one landing on `escalate / letter_scope_exceeded` with NO document
// written, plus the fail-closed properties that stop a model talking its way
// out of the human path.
//
// Hermetic: the real Remote mock server on a registered test port, the real
// workflow, the real gates, the rule-based classifier, in-memory stores.
// ---------------------------------------------------------------------------

import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

import { startMockServer } from "../src/remote/mockServer.js";
import { RemoteClient } from "../src/remote/restClient.js";
import { AuditLogger } from "../src/shared/audit.js";
import { CaseStore } from "../src/shared/caseStore.js";
import { handleTravelInquiry, submitTravelLetterSignoff } from "../src/uc03/workflow.js";
import { classifyTravelInquiryRuleBased } from "../src/uc03/classifier.js";
import {
  assessLetterScope,
  detectNonStandardAsks,
  missingTemplateInputs,
  summariseLetterScope,
  NON_STANDARD_ASKS,
  TEMPLATE_ASSERTIONS,
  LETTER_SCOPE_EXCEEDED,
} from "../src/uc03/letterScope.js";
import { evaluate, GATE_SEQUENCE, describeDecisionFacts, DEFAULT_CONFIDENCE_THRESHOLD } from "../src/uc03/policyEngine.js";
import { renderTravelLetterHtml } from "../src/uc03/letter.js";
import { evaluateLetterSignoffAction } from "../src/uc03/signoffPolicy.js";

const TEST_PORT = 4117; // test band — registered in src/shared/ports.js's TEST_PORTS

const EMPLOYEE = "emp_active_001";
const SESSION = { authenticatedEmploymentId: EMPLOYEE };
const SPECIALIST = "travel.specialist@remote.test";

/** The plain ask. Nothing beyond "confirm I work here and I am travelling". */
const STANDARD_REQUEST =
  "I need a travel support letter for my visa application for a conference in Germany from 2026-09-20 to 2026-09-26.";

let remoteServer;
let remote;
let audit;
let caseStore;

before(async () => {
  remoteServer = await startMockServer(TEST_PORT);
  remote = new RemoteClient({ baseUrl: `http://localhost:${TEST_PORT}` });
});

after(() => remoteServer?.close());

beforeEach(() => {
  audit = new AuditLogger();
  caseStore = new CaseStore();
});

/** A real request through the real workflow — never a hand-built case row. */
const ask = (text, overrides = {}) =>
  handleTravelInquiry(
    { text, employmentId: EMPLOYEE, session: SESSION, ...overrides },
    { remote, audit, caseStore, classify: classifyTravelInquiryRuleBased }
  );

const docsFor = (id) => caseStore.documents.filter((d) => d.caseId === id);
const reviewRowFor = (id) => caseStore.reviewQueue.find((r) => r.caseId === id) ?? null;
const uc03Audit = () => audit.forUseCase("UC-03");

// ---------------------------------------------------------------------------
// 1. THE STANDARD LETTER — the outcome that must remain reachable
// ---------------------------------------------------------------------------

// THE HEADLINE ASSERTIONS HERE MOVED, AND THE MOVE IS THE PRODUCT CHANGE. This
// test was "a plain letter request is STANDARD, drafts, and reaches the one
// signature", and every clause was true when it was written. A standard letter
// for a traveller every gate has qualified is now WRITTEN AND ISSUED by the
// gate, with nobody in the path (docs/use-cases/UC-03.md §23). What has not
// moved is why this test leads the file: an over-broad marker would make
// `standard` unreachable, and every negative test below would still pass while
// no letter was ever produced for anyone.
test("POSITIVE: a plain letter request is STANDARD, and is ISSUED with no signature", async () => {
  const result = await ask(STANDARD_REQUEST, { source: "portal", externalRef: "scope-1" });

  assert.equal(result.decision, "auto_resolve");
  assert.equal(result.reason, "standard_letter_issued");
  assert.equal(result.letterScope.standard, true, "nothing outside the template was asked for");
  assert.deepEqual(result.letterScope.findings, []);

  // THE POSITIVE STATEMENT IS RECORDED, not merely the absence of a negative.
  // A record that only ever reports faults teaches its reader that silence
  // means nothing was checked.
  assert.ok(
    result.letterScope.checked.includes("non_standard_asks_scan"),
    "the case says which checks ran, so a clean one is visible"
  );
  assert.ok(result.letterScope.checked.includes("template_completeness"));
  assert.ok(result.letterScope.checked.includes("confidence_floor"));

  assert.ok(result.letterHtml, "a standard request produces a letter");
  assert.equal(docsFor(result.caseId)[0].type, "travel_support_letter");
  assert.equal(caseStore.reviewQueue.length, 0, "nobody is waiting on this — there is nothing left to decide");

  // …and the audit row carries the positive verdict too.
  const row = uc03Audit().at(-1);
  assert.equal(row.details.letterScope.standard, true);
  assert.equal(row.details.letterDrafted, true);
  // THIS ASSERTION IS INVERTED FROM WHAT IT WAS, AND THE OLD TEXT IS KEPT: it
  // read `letterIssued, false, "drafted is not issued — the signature is still
  // the only issue path"`. The signature is no longer the only issue path, so
  // the row that had only ever been able to say `false` on this function now
  // says `true` — and it says it off the deciding RUNG, never off the presence
  // of a document, because a draft is also a document.
  assert.equal(row.details.letterIssued, true);
  assert.equal(
    row.details.letterContentHash,
    createHash("sha256").update(result.letterHtml).digest("hex"),
    "the hash on the audit row names the exact bytes that went out"
  );

  // WHAT STOOD IN FOR A SIGNER. An artifact with no accountable origin is worse
  // than one waiting for a signature, so the row records the gates that
  // authorised it and the scope verdict beside the hash.
  assert.equal(row.details.autoIssue.issuedWithoutSignature, true);
  assert.equal(row.details.autoIssue.letterScope.standard, true);
  assert.ok(
    row.details.autoIssue.gatesPassed.length >= 11,
    "every rung above the issuing one is named, not summarised as 'all gates passed'"
  );
  assert.equal(row.details.autoIssue.letterContentHash, row.details.letterContentHash);
});

test("POSITIVE: the drafted letter's real contents — every row, and the rows it deliberately omits", async () => {
  const result = await ask(STANDARD_REQUEST, { source: "portal", externalRef: "scope-contents" });
  const letter = result.letterHtml;

  // What it asserts, each answering an evidential head the Visa Code Handbook
  // names (UC-03.md §18): employment status, professional standing, means.
  assert.match(letter, /Amara Okafor/, "employee name");
  assert.match(letter, /Senior Engineer/, "job title");
  assert.match(letter, />active</, "employment status");
  assert.match(letter, /Full-time/, "contract type");
  assert.match(letter, /2022-03-01/, "employment start date");
  assert.match(letter, /Germany \(DE\)/, "destination");
  assert.match(letter, /2026-09-20 to 2026-09-26/, "travel window");
  assert.match(letter, /50,000\.00|50000\.00/, "base compensation, ×100-descaled");
  assert.match(letter, /not a work\s+authorization/, "the mandatory boundary statement");

  // The two rows this change added, both from values the system actually holds.
  assert.match(letter, /Our reference: scope-contents/, "the reference the requester already has");
  assert.match(letter, /Employer registered in/, "the employing entity's jurisdiction");

  // AND WHAT IT MUST NOT CONTAIN. Every one of these is a field Remote's own
  // TravelLetterRequest collects and this system does not hold. A template that
  // invented any of them would be worse than one that omits them.
  assert.doesNotMatch(letter, /passport/i, "no passport number — no record holds one");
  assert.doesNotMatch(letter, /date of birth/i, "no date of birth — no record holds one");
  assert.doesNotMatch(letter, /consulate|embassy/i, "no addressee — none was collected");
  assert.doesNotMatch(letter, /responsible for|bears the cost/i, "no cost responsibility — that is the employer's answer");
});

// ---------------------------------------------------------------------------
// 2. THE NON-STANDARD ASKS — one per marker, each refusing without a document
// ---------------------------------------------------------------------------

const NON_STANDARD_REQUESTS = [
  {
    code: "addressee_specified",
    text:
      "I need a travel support letter for a conference in Germany from 2026-09-20 to 2026-09-26. " +
      "Please have it addressed to the German Consulate General in Lagos.",
  },
  {
    code: "identity_document_requested",
    text:
      "I need a travel support letter for a conference in Germany from 2026-09-20 to 2026-09-26. " +
      "It has to carry my passport number.",
  },
  {
    code: "cost_responsibility_requested",
    text:
      "I need a travel support letter for a conference in Germany from 2026-09-20 to 2026-09-26. " +
      "The consulate wants confirmation that the company covers all costs.",
  },
  {
    code: "accommodation_address_requested",
    text:
      "I need a travel support letter for a conference in Germany from 2026-09-20 to 2026-09-26, " +
      "including the hotel address where I will be staying.",
  },
  {
    code: "wording_specified",
    text:
      "I need a travel support letter for a conference in Germany from 2026-09-20 to 2026-09-26. " +
      "It must state that I remain employed throughout.",
  },
  {
    code: "omission_requested",
    text:
      "I need a travel support letter for a conference in Germany from 2026-09-20 to 2026-09-26, " +
      "but please leave out my salary.",
  },
  {
    code: "language_or_legalisation_requested",
    text:
      "I need a travel support letter for a conference in Germany from 2026-09-20 to 2026-09-26, " +
      "notarised please.",
  },
];

for (const { code, text } of NON_STANDARD_REQUESTS) {
  test(`a request for ${code.replace(/_/g, " ")} escalates and drafts NOTHING`, async () => {
    const result = await ask(text, { source: "portal", externalRef: `scope-${code}` });

    assert.equal(result.decision, "escalate");
    assert.equal(result.reason, LETTER_SCOPE_EXCEEDED);
    assert.equal(result.letterScope.standard, false);
    assert.ok(
      result.letterScope.findings.some((f) => f.code === code),
      `the finding names the ask (${code}); got ${result.letterScope.findings.map((f) => f.code).join(", ")}`
    );

    // THE DOCUMENT THAT MUST NOT EXIST. Refusing to ISSUE a bad document still
    // leaves the bad document written, which is why the refusal is in the
    // drafting and not only in the sign-off gate.
    assert.equal(result.letterHtml, undefined, "no letter is drafted");
    assert.deepEqual(docsFor(result.caseId), [], "and none is stored");

    // It is still a human's job, and the queue entry says which job.
    const queued = reviewRowFor(result.caseId);
    assert.ok(queued, "an escalated letter request is still queued for a person");
    assert.match(queued.notes, /NO LETTER WAS DRAFTED/);
    assert.match(queued.notes, /written by a person/);
  });
}

test("the trip is not what was refused — the gate ladder puts this AFTER every trip gate", async () => {
  const result = await ask(NON_STANDARD_REQUESTS[0].text, { externalRef: "scope-ladder" });
  const ladder = result.decidedBy;

  assert.equal(ladder.gate, "letter_within_template");
  const durationRung = GATE_SEQUENCE.find((r) => r.reason === "duration_over_cap");
  const destinationRung = GATE_SEQUENCE.find((r) => r.reason === "destination_jurisdiction_excluded");
  assert.ok(
    ladder.position > durationRung.position && ladder.position > destinationRung.position,
    "every gate about the trip itself passed before this one refused"
  );

  const facts = result.decisionFacts;
  assert.equal(facts.reason, LETTER_SCOPE_EXCEEDED);
  assert.ok(
    facts.facts.some((f) => f.label === "What this is NOT" && /a refusal of the trip/i.test(f.value)),
    "the reviewer is told explicitly that the trip is fine"
  );
  // Each finding carries its own provenance, so "Remote collects this field and
  // we do not" is distinguishable from "a model thought it saw something".
  // The provenance is stated in words rather than in the code the check is
  // declared by — `request_text` is how `letterScope.js` names it and how the
  // finding stores it; a travel specialist reading the case is shown "request
  // text".
  assert.ok(facts.facts.some((f) => /found by: request text/.test(String(f.note ?? ""))));
});

// ---------------------------------------------------------------------------
// 3. FAIL-CLOSED: a model may route INTO the human path, never out of it
// ---------------------------------------------------------------------------

test("STRUCTURAL: no input to this module means 'standard' — the verdict is only ever the absence of findings", () => {
  // The safety property stated as a property. `standard` is computed, and the
  // only thing that produces it is an empty findings array; there is no field
  // anywhere a caller (or a model) can set to assert it.
  const source = readFileSync(new URL("../src/uc03/letterScope.js", import.meta.url), "utf8").replace(
    /\/\*[\s\S]*?\*\/|(^|[^:])\/\/.*$/gm,
    "$1"
  );
  assert.match(source, /standard:\s*findings\.length === 0/, "the verdict is derived from the findings and nothing else");
  assert.equal(
    (source.match(/standard:/g) ?? []).length,
    1,
    "there is exactly one place `standard` is produced, so there is one thing to audit"
  );
  // And nothing here reads a caller-supplied verdict of any name.
  for (const forbidden of [/classification\.\s*isStandard/, /classification\.\s*standard/, /\.letterIsStandard/]) {
    assert.doesNotMatch(source, forbidden, "no caller-supplied 'this is standard' signal is ever read");
  }
});

test("a low-confidence classification can NEVER be assessed standard, whoever calls the function", () => {
  const scope = assessLetterScope({
    requestText: STANDARD_REQUEST,
    employment: { full_name: "A", job_title: "B", status: "active", contract_type: "full_time", start_date: "2020-01-01" },
    classification: {
      destinationCountry: "DE",
      startDate: "2026-09-20",
      endDate: "2026-09-26",
      formalLetterRequested: true,
      confidence: 0.05,
    },
  });
  assert.equal(scope.standard, false);
  assert.ok(scope.findings.some((f) => f.code === "classification_not_trusted"));
  // The floor is imported, never restated.
  assert.ok(scope.findings.find((f) => f.code === "classification_not_trusted").detail.includes(String(DEFAULT_CONFIDENCE_THRESHOLD)));
});

test("a classification with no usable confidence at all is not standard either", () => {
  for (const confidence of [undefined, null, NaN, "0.9"]) {
    const scope = assessLetterScope({
      requestText: STANDARD_REQUEST,
      employment: { full_name: "A", job_title: "B", status: "active", contract_type: "full_time", start_date: "2020-01-01" },
      classification: { destinationCountry: "DE", startDate: "2026-09-20", endDate: "2026-09-26", confidence },
    });
    assert.equal(scope.standard, false, `confidence ${String(confidence)} must not clear the floor`);
  }
});

test("an unreadable request is not standard — 'we saw nothing' and 'we had nothing to look at' are different", () => {
  for (const requestText of [null, undefined, "", "   ", 42, {}]) {
    const scope = assessLetterScope({
      requestText,
      employment: { full_name: "A", job_title: "B", status: "active", contract_type: "full_time", start_date: "2020-01-01" },
      classification: { destinationCountry: "DE", startDate: "2026-09-20", endDate: "2026-09-26", confidence: 0.9 },
    });
    assert.equal(scope.standard, false, `requestText ${JSON.stringify(requestText)} must fail closed`);
    assert.ok(scope.findings.some((f) => f.code === "request_text_unavailable"));
  }
});

test("a model list that cannot be parsed is a FINDING, never an ignored value", () => {
  const base = {
    requestText: STANDARD_REQUEST,
    employment: { full_name: "A", job_title: "B", status: "active", contract_type: "full_time", start_date: "2020-01-01" },
  };
  for (const letterSpecialRequests of ["addressed to the consulate", 7, { ask: "x" }, ["ok", 3]]) {
    const scope = assessLetterScope({
      ...base,
      classification: { destinationCountry: "DE", startDate: "2026-09-20", endDate: "2026-09-26", confidence: 0.9, letterSpecialRequests },
    });
    assert.equal(scope.standard, false, `${JSON.stringify(letterSpecialRequests)} must fail closed`);
    assert.ok(scope.findings.some((f) => f.code === "model_reading_unusable"));
  }
});

test("the model's list can only ADD — an empty or absent one never clears a deterministic finding", () => {
  const employment = { full_name: "A", job_title: "B", status: "active", contract_type: "full_time", start_date: "2020-01-01" };
  const classification = {
    destinationCountry: "DE",
    startDate: "2026-09-20",
    endDate: "2026-09-26",
    confidence: 0.9,
    // The model saw nothing unusual. The text says otherwise, and the text wins
    // — a union cannot shrink.
    letterSpecialRequests: [],
  };
  const scope = assessLetterScope({
    requestText: "Travel letter please, addressed to the Italian Consulate.",
    employment,
    classification,
  });
  assert.equal(scope.standard, false);
  assert.ok(scope.findings.some((f) => f.code === "addressee_specified"));
});

test("a model finding the patterns missed still routes into the human path, tagged as a reading", () => {
  const employment = { full_name: "A", job_title: "B", status: "active", contract_type: "full_time", start_date: "2020-01-01" };
  const scope = assessLetterScope({
    requestText: "Travel letter for the Berlin trip in September please.",
    employment,
    classification: {
      destinationCountry: "DE",
      startDate: "2026-09-20",
      endDate: "2026-09-26",
      confidence: 0.9,
      letterSpecialRequests: ["they want it to name my line manager as the contact"],
    },
  });
  assert.equal(scope.standard, false);
  const finding = scope.findings.find((f) => f.code === "model_flagged_special_request");
  assert.ok(finding);
  assert.equal(finding.foundBy, "classifier");
  assert.match(finding.source, /recommendation, not a fact/, "a model's reading is never presented as established");
});

// ---------------------------------------------------------------------------
// 4. TEMPLATE COMPLETENESS — a row with no value is a hole, not a placeholder
// ---------------------------------------------------------------------------

test("a template row with no value behind it stops the letter rather than printing a dash", () => {
  const findings = missingTemplateInputs({
    employment: { full_name: "A", job_title: "  ", status: "active", contract_type: "full_time", start_date: "2020-01-01" },
    classification: { destinationCountry: "DE", startDate: "2026-09-20", endDate: null },
  });
  assert.deepEqual(
    findings.map((f) => f.code).sort(),
    ["missing_endDate", "missing_job_title"].sort()
  );
  assert.ok(findings.every((f) => f.foundBy === "template_completeness"));
});

test("every required TEMPLATE_ASSERTIONS row is one renderTravelLetterHtml actually reads", () => {
  // The completeness check would be theatre if it named fields the renderer
  // does not use. Read the renderer's own source rather than agreeing by hand.
  const renderer = readFileSync(new URL("../src/uc03/letter.js", import.meta.url), "utf8");
  for (const row of TEMPLATE_ASSERTIONS) {
    assert.match(renderer, new RegExp(`employment\\.${row.field}\\b`), `the template never reads employment.${row.field}`);
  }
});

// ---------------------------------------------------------------------------
// 5. THE MARKERS THEMSELVES — narrow in one direction only
// ---------------------------------------------------------------------------

test("mentioning a consulate, a visa or a trip's cost is NOT an ask — the patterns need a requesting construction", () => {
  // The expensive over-triggering failure: if every letter request is
  // non-standard, `standard` is unreachable and no negative test would notice.
  const innocent = [
    "I need a travel support letter for my visa appointment at the consulate next week.",
    "I have a visa application at the embassy on 2026-09-01 and need a letter.",
    "Conference in Germany, my flights are already booked.",
    "I need a travel letter — I am presenting at a conference and my manager has approved the trip.",
  ];
  for (const text of innocent) {
    assert.deepEqual(detectNonStandardAsks(text), [], `over-triggered on: ${text}`);
  }
});

test("every marker in the table is reachable from a real sentence", () => {
  // A marker no sentence can reach is a control that cannot fire — the dead
  // sanctions gate, one file over, exactly. Every code in the table must be
  // produced by at least one of the requests this file drives.
  const reached = new Set();
  for (const { text } of NON_STANDARD_REQUESTS) {
    for (const f of detectNonStandardAsks(text)) reached.add(f.code);
  }
  const unreachable = NON_STANDARD_ASKS.map((a) => a.code).filter((c) => !reached.has(c));
  assert.deepEqual(unreachable, [], "these markers are in the table and no test sentence reaches them");
});

test("every marker carries a source naming where the field is documented", () => {
  for (const ask of NON_STANDARD_ASKS) {
    assert.ok(ask.source && ask.source.length > 20, `${ask.code} has no usable source`);
    assert.ok(ask.cannot && ask.cannot.length > 40, `${ask.code} does not say what the template cannot carry`);
  }
});

// ---------------------------------------------------------------------------
// 6. THE SIGN-OFF STILL REFUSES IT — and says something a person can act on
// ---------------------------------------------------------------------------

test("a non-standard case cannot be signed off, and the refusal names what is owed instead", async () => {
  const result = await ask(NON_STANDARD_REQUESTS[0].text, { externalRef: "scope-signoff" });
  const caseRow = caseStore.cases.find((c) => c.id === result.caseId);

  const verdict = evaluateLetterSignoffAction({
    caseRow,
    reviewRow: reviewRowFor(result.caseId),
    approver: SPECIALIST,
    action: "signoff",
  });
  assert.equal(verdict.allowed, false);
  assert.equal(verdict.code, "no_signoff_path");
  assert.match(verdict.reason, /NO LETTER WAS DRAFTED/, "the gate's own means-sentence reaches the specialist");

  // And driving the real write route refuses too — the gate is not advisory.
  const refused = await submitTravelLetterSignoff(
    { caseId: result.caseId, action: "signoff", approver: SPECIALIST },
    { remote, audit, caseStore }
  );
  assert.equal(refused.ok, false);
  assert.equal(refused.code, "no_signoff_path");
  assert.equal(
    uc03Audit().filter((e) => e.details?.letterIssued === true).length,
    0,
    "nothing anywhere recorded a letter as issued"
  );
});

// ---------------------------------------------------------------------------
// 7. THE TWO COPIES OF THE MARKER TABLE
// ---------------------------------------------------------------------------

test("the n8n port's marker table is identical to this one, code for code and pattern for pattern", () => {
  // `evaluate()` exists twice (src + the n8n Code node), and so now does the
  // scan it consults. `test/n8nUc03Parity.test.js` compares OUTCOMES for its
  // scenarios; this compares the tables themselves, because a marker neither
  // scenario's text reaches would diverge in silence otherwise — which is
  // precisely how KNOWN_COUNTRIES came to differ between the same two files.
  const node = readFileSync(new URL("../workflows/nodes-uc03/travelRouterGates.js", import.meta.url), "utf8");
  const block = node.slice(node.indexOf("const NON_STANDARD_ASKS = ["), node.indexOf("const TEMPLATE_EMPLOYMENT_FIELDS"));

  for (const ask of NON_STANDARD_ASKS) {
    assert.ok(block.includes(`code: '${ask.code}'`), `the n8n port has no marker for ${ask.code}`);
    for (const pattern of ask.patterns) {
      assert.ok(
        block.includes(pattern.source),
        `the n8n port's ${ask.code} is missing the pattern ${pattern.source}`
      );
    }
  }

  const portedCodes = [...block.matchAll(/code: '([a-z_]+)'/g)].map((m) => m[1]);
  assert.deepEqual(
    portedCodes,
    NON_STANDARD_ASKS.map((a) => a.code),
    "the two tables must hold the same markers in the same order"
  );

  // The completeness fields, too — a row checked here and not there would let
  // the n8n graph draft a letter with a hole in it.
  for (const row of TEMPLATE_ASSERTIONS) {
    assert.ok(node.includes(`'${row.field}'`), `the n8n port does not check ${row.field} for completeness`);
  }
});

// ---------------------------------------------------------------------------
// 8. SMALL THINGS THAT WOULD OTHERWISE ROT
// ---------------------------------------------------------------------------

test("LETTER_SCOPE_EXCEEDED and the literal the gate returns are the same string", () => {
  // The gate returns the LITERAL so `test/gateLadder.test.js`'s source scraper
  // can see it; the constant is what `workflow.js` compares against. Both, so
  // they cannot drift.
  assert.equal(LETTER_SCOPE_EXCEEDED, "letter_scope_exceeded");
  assert.ok(GATE_SEQUENCE.some((r) => r.reason === LETTER_SCOPE_EXCEEDED));
});

test("summariseLetterScope says something useful in both directions", () => {
  assert.match(summariseLetterScope({ standard: true, findings: [] }), /Nothing outside the standard template/);
  const scope = assessLetterScope({
    requestText: "Letter please, addressed to the consulate.",
    employment: { full_name: "A", job_title: "B", status: "active", contract_type: "full_time", start_date: "2020-01-01" },
    classification: { destinationCountry: "DE", startDate: "2026-09-20", endDate: "2026-09-26", confidence: 0.9 },
  });
  assert.match(summariseLetterScope(scope), /A named addressee/);
});

test("describeDecisionFacts rebuilds the findings from a stored row, without the outcome object", () => {
  // The audit viewer and the sidebar rebuild a view from `cases` + `audit_log`;
  // the outcome object is long gone by then and the request text is on the row.
  const facts = describeDecisionFacts({
    reason: LETTER_SCOPE_EXCEEDED,
    requestText: NON_STANDARD_REQUESTS[1].text,
    employment: { id: EMPLOYEE, full_name: "A", job_title: "B", status: "active", contract_type: "full_time", start_date: "2020-01-01" },
    classification: { destinationCountry: "DE", startDate: "2026-09-20", endDate: "2026-09-26", confidence: 0.9 },
  });
  assert.ok(facts);
  assert.match(facts.sentence, /No letter was drafted/);
  assert.ok(facts.facts.some((f) => /passport/i.test(String(f.value))));
});

test("the letter renders no reference row at all when there is no reference — never a placeholder", () => {
  const html = renderTravelLetterHtml({
    employment: {
      full_name: "A",
      job_title: "B",
      status: "active",
      contract_type: "full_time",
      start_date: "2020-01-01",
    },
    legalEntity: { name: "Remote Nigeria EOR Ltd" },
    destinationCountry: "DE",
    startDate: "2026-09-20",
    endDate: "2026-09-26",
  });
  assert.doesNotMatch(html, /Our reference/);
  assert.doesNotMatch(html, /Employer registered in/, "no jurisdiction row when the entity carries no country");
});

// ---------------------------------------------------------------------------
// WHY SOMEONE WANTS A LETTER IS NOT A REQUEST ABOUT ITS CONTENTS
// ---------------------------------------------------------------------------
// A requester asked for "a travel letter for my visa application for a
// conference in Germany". The letter was correct, the trip qualified, and the
// classifier put "for my visa application" into letterSpecialRequests — so
// gate 11 read it as an ask the template cannot express and escalated. Every
// visa-letter request escalated, which is the one case the portal ships a
// quick-fill button for, and which the tier model says should auto-issue: a
// short business trip by a qualified employee, nobody signing.
//
// The document is byte-identical either way. "For my visa" explains WHY the
// letter is wanted; it does not ask the letter to SAY anything it would not
// already say. An addressee, a passport number, another language or a removed
// row do, and those must still be caught.
//
// This asserts the RULE is in the prompt, not the model's behaviour: the
// behaviour needs a network call, and this suite is hermetic (CLAUDE.md §6 —
// a real OPENAI_API_KEY in .env has made this suite spend money twice). The
// guard is against the rule being deleted, which is how it was missing.
import { readFileSync as readClassifierSource } from "node:fs";

test("the prompt separates a letter's PURPOSE from a request about its contents", () => {
  const src = readClassifierSource(new URL("../src/uc03/classifier.js", import.meta.url), "utf8");
  const prompt = src.slice(src.indexOf("const SYSTEM_PROMPT"), src.indexOf("Return strict JSON"));

  assert.match(prompt, /WHY someone wants a letter is NOT a special request/,
    "the purpose-vs-contents rule is gone; every visa-letter request will escalate again");
  for (const phrase of ["for my visa application", "for immigration", "for the border"]) {
    assert.ok(prompt.includes(phrase), `the prompt no longer names "${phrase}" as a purpose`);
  }
  // The rule must not swallow the requests that genuinely change the document.
  assert.match(prompt, /changes the letter's CONTENT, its ADDRESSEE, or its LANGUAGE/,
    "the prompt no longer says which asks DO count, so the rule could be read as 'never list anything'");
  assert.match(prompt, /addressed to the Spanish Consulate/,
    "the worked example of a real special request is gone");
});

// ---------------------------------------------------------------------------
// THE CONFIDENCE GATE COULD NOT FIRE ON THE RULE-BASED PATH
// ---------------------------------------------------------------------------
// `DEFAULT_CONFIDENCE_THRESHOLD` is 0.6 and the gate refuses on
// `confidence < threshold`. The rule scan scored a request it could read
// NOTHING out of at exactly 0.6, and 0.6 is not below 0.6 — so that gate has
// never once fired on this path. It read as a control and was arithmetic that
// could not fail.
//
// It never showed because the destination gate refused those requests a few
// rungs later under a different reason. That cover vanishes the moment a
// requester can state the destination on a form (docs/TRAVEL-LETTER-INPUTS.md
// §6): an unreadable request then reaches the gates carrying a perfectly good
// destination, and "Hello." plus a filled-in trip auto-resolves.
//
// The gate and its threshold are unchanged. Only the score for "I read
// nothing" moved below the floor, where the comparison can reject it.
test("a request the rule scan cannot read at all scores BELOW the floor", () => {
  for (const unreadable of ["Hello.", "xyzzy", "", "   ", "thanks!"]) {
    const c = classifyTravelInquiryRuleBased({ text: unreadable });
    assert.ok(
      c.confidence < DEFAULT_CONFIDENCE_THRESHOLD,
      `${JSON.stringify(unreadable)} scored ${c.confidence} against a ${DEFAULT_CONFIDENCE_THRESHOLD} floor — the gate cannot reject it`
    );
  }
});

test("a partly-read request still passes the floor, and is stopped by the gate that owns it", () => {
  // "Spain, no dates" IS a request we read. Refusing it for low confidence
  // would be false — the day-count gate is the one with something to say
  // about it, and it says `duration_unknown`. Widening the confidence gate to
  // swallow this case would have been the easy fix and the wrong one.
  const c = classifyTravelInquiryRuleBased({ text: "Can I go to Spain for a client meeting?" });
  assert.equal(c.destinationCountry, "ES");
  assert.equal(c.startDate, null);
  assert.ok(
    c.confidence >= DEFAULT_CONFIDENCE_THRESHOLD,
    `a read destination with no dates scored ${c.confidence} and would now be refused as unreadable`
  );
});

test("both facts read still scores highest, unchanged", () => {
  const c = classifyTravelInquiryRuleBased({
    text: "Conference in Germany from 2026-09-20 to 2026-09-26.",
  });
  assert.equal(c.confidence, 0.9);
});
