// ---------------------------------------------------------------------------
// uc03GateProse.test.js — the sentence the requester reads is about THEM
// ---------------------------------------------------------------------------
// WHAT WENT WRONG, IN THE OWNER'S OWN WORDS
//
// An employee wrote, on the portal: "I'd like to work remotely from Portugal for
// a month while on holiday — can I do my normal job from there?" and the result
// panel answered them with the deciding gate's `means`:
//
//   "The employee intends to actually work while away, which is a
//    work-authorisation question rather than a travel one — so this use case
//    deliberately decided nothing else about it… Nothing was sent anywhere: no
//    work-authorisation case was created, and there is no UC-04 queue holding
//    this request to go and look in. What exists is the handoff event recorded
//    on this decision…"
//
// The owner: "the user asked a simple question… the answer should not be that
// thing."
//
// EVERY CLAUSE OF THAT WAS TRUE, WHICH IS WHY NOTHING CAUGHT IT. It had been
// written to correct an earlier sentence that WAS false ("it has been handed to
// the work-authorisation case (UC-04)"), and the correction was accurate, cited
// and careful — and every clause of it had US as its subject: this use case,
// this router, no UC-04 queue, the handoff event recorded on this decision. It
// is an account of our own pipeline delivered to somebody who asked whether they
// may work from Portugal. `docs/UI-AUDIENCES.md` names exactly this failure: *is
// it accurate, is it cited, does it overstate* passes all three, because
// accuracy was never the property being violated — relevance to the reader was,
// and nothing was checking it.
//
// WHY THIS TEST ASSERTS A SHAPE AND NOT A SENTENCE
//
// A test pinning the exact replacement wording would freeze a paragraph that
// should stay free to improve, and would say nothing about the NEXT rung
// somebody writes. What must not come back is the class: prose whose subject is
// what our machinery did or did not do internally. So the ban list is the thing
// with teeth, and the positive assertions below it check only that the three
// facts the reader actually needs survived whatever rewording happened.
//
// WHICH SURFACE THIS RULE APPLIES TO, AND WHICH IT DELIBERATELY DOES NOT
//
// `means` is published to the EMPLOYEE's own result page — src/portal/server.js's
// `gateNarration()` renders it as the reason paragraph and again as the "What
// happened" row — as well as into the specialist's Zendesk note. It is the one
// string on this ladder with a lay reader, so it is held to the rule.
//
// `checks` and `describeDecisionFacts()` are NOT, on purpose, and that is
// `docs/UI-AUDIENCES.md`'s routing test rather than an exemption: "useless to
// THIS reader, or to everyone?" The portal publishes `checks` only through
// `specialistDetail()`, and UC-03's decision facts reach a person exclusively
// through the Zendesk internal note and the ZAF sidebar. "No UC-04 case exists,
// nothing is in a UC-04 queue" is precisely what the specialist picking the
// ticket up needs, so it MOVED to those surfaces rather than being deleted —
// `describeUc04Intake()`'s literal `dispatched: false` / `uc04RecordCreated:
// false` and workflow.js's STEP 8 note both still say it. Nothing left the
// record; it stopped being said to the wrong person.
// ---------------------------------------------------------------------------

import { test } from "node:test";
import assert from "node:assert/strict";

import { GATE_SEQUENCE, describeDecidingGate } from "../src/uc03/policyEngine.js";
import { UC04_INPUTS_UC03_CANNOT_SOURCE, describeUc04Intake } from "../src/uc03/uc04Intake.js";
import { buildUc04HandoffEvent } from "../src/uc03/workflow.js";

/**
 * Ways of talking about our own machinery, each with the reason it is banned.
 *
 * Every one of these was in a UC-03 `means` string that a requester read, or is
 * the obvious next form of one that was.
 */
const MACHINERY = [
  { name: "a use-case index", test: /\buc-?\s?0\d\b/i, why: "an internal identifier for a pipeline the reader does not know exists" },
  { name: "'this use case' / 'this router'", test: /\bthis (use case|router|system|workflow|pipeline)\b/i, why: "the subject is us, not the reader's request" },
  { name: "'router'", test: /\brouter\b/i, why: "names a component; the reader asked about a trip" },
  { name: "internal queue talk", test: /\bqueue\b/i, why: "where work sits in our tooling is our bookkeeping, not an answer" },
  { name: "'handoff event'", test: /\bhand-?off\b/i, why: "an object in our audit row, described to somebody who cannot see it" },
  { name: "'gate' / 'rung'", test: /\b(gates?|rungs?)\b/i, why: "our word for our own ordering; the specialist gets the coordinates separately" },
  { name: "'flags'", test: /\bflags\b/i, why: "a field on our decision record" },
  { name: "an API or endpoint", test: /\b(api|endpoint|webhook|payload)\b/i, why: "our integration surface, told to an employee who did not ask" },
  { name: "a path into this repository", test: /\bsrc\/|\.js\b/i, why: "a source path on the screen of somebody asking about a trip" },
  { name: "a raw slug", test: /\b[a-z]+_[a-z_]+\b/, why: "our vocabulary; the plain-words sentence is what this string is FOR" },
  {
    name: "a negated internal record",
    test: /\bno (uc-?0\d|work[- ]authoris?z?ation) (case|record) (was|has been) created\b/i,
    why: "true, and a statement about our tables — 'nothing has been submitted for you' is the same fact told to its reader",
  },
];

test("no rung's requester-facing sentence describes this system's own machinery", () => {
  const offences = [];
  for (const rung of GATE_SEQUENCE) {
    for (const rule of MACHINERY) {
      if (rule.test.test(rung.means)) {
        offences.push(`${rung.reason}: ${rule.name} — ${rule.why}\n      ${rung.means.slice(0, 200)}`);
      }
    }
  }
  assert.deepEqual(
    offences,
    [],
    `${offences.length} sentence(s) a requester reads are about us rather than about their request:\n    ` +
      offences.join("\n    ")
  );
});

test("every rung still says something, and says it in the reader's words", () => {
  for (const rung of GATE_SEQUENCE) {
    // The guard has to be able to fail: a ban list is trivially satisfied by an
    // empty string, and this repository has shipped a gate that could not fire
    // more than once (CLAUDE.md §4).
    assert.ok(rung.means.length > 60, `${rung.reason}'s sentence is too short to have answered anything`);
    assert.ok(!rung.means.includes(rung.reason), `${rung.reason} restates its own slug`);
  }
});

// ---------------------------------------------------------------------------
// THE ROUTING RUNG, POSITIVELY — the three facts the employee actually needs
// ---------------------------------------------------------------------------
// Deleting the pipeline talk is half the correction. A sentence can be free of
// machinery and still leave somebody waiting for an answer that is never coming.

test("the routing sentence tells the employee nothing is in flight, what to do, and what it will ask for", () => {
  const means = describeDecidingGate("work_authorization_requested").means;

  // 1. NOTHING IS IN FLIGHT. An employee who believes a request has been
  //    submitted on their behalf waits for a decision nobody is making.
  assert.match(means, /[Nn]othing has been submitted/);
  assert.match(means, /nobody is reviewing/i);

  // 2. WHAT THE NEXT STEP IS, and that it is theirs to take.
  assert.match(means, /Request Hub/);
  assert.match(means, /raises? themselves|they raise/i);

  // 3. WHAT THAT WILL ASK THEM FOR, named rather than gestured at — sending
  //    somebody to a form without telling them what it wants is what produced
  //    the original question.
  for (const label of UC04_INPUTS_UC03_CANNOT_SOURCE) {
    assert.ok(means.includes(label), `the sentence does not name a required input: ${label}`);
  }

  // AND IT MUST NOT READ AS PERMISSION. This rung decides nothing about
  // eligibility — some destinations are refused outright at the next stage — so
  // the one thing worse than the old sentence would be a friendlier one that
  // implies a yes.
  // NOT A BAN ON THE WORD "allowed", AND THE ATTEMPT IS WORTH RECORDING. The
  // first version of this guard forbade /is allowed|permitted|authoris\w*/ and
  // failed on the sentence it was written to protect — "whether working from the
  // destination is ALLOWED is settled on that request" is the clause that says
  // we do not know, and "work-AUTHORIZATION request" is the name of the thing
  // the employee has to file. A word-level ban cannot tell an assertion of
  // permission from a statement that permission is undecided.
  //
  // So the guard is one unambiguous affirmative form, plus the POSITIVE
  // requirement below, which is what actually carries the safeguard: a sentence
  // that never says the question is still open reads as a yes however carefully
  // it avoids the vocabulary.
  assert.doesNotMatch(means, /\byou (can|may|are able to|are allowed to)\b/i);
  assert.match(means, /has not been settled|not been decided/i);
});

// ---------------------------------------------------------------------------
// THE COUNT — two surfaces, two correct numbers, so the static one states none
// ---------------------------------------------------------------------------

test("the routing sentence asserts no total, because the next page's total is run-specific", () => {
  const means = describeDecidingGate("work_authorization_requested").means;
  assert.doesNotMatch(
    means,
    /\b(three|3|four|4|five|5|six|6)\s+(things|inputs|details|items|fields)\b/i,
    "a static sentence cannot state a count the continuation page computes per request"
  );

  // WHY, DEMONSTRATED RATHER THAN ASSERTED. The four below are the inputs UC-03
  // can NEVER source. The portal's continuation page shows this run's own
  // still-missing list (`describeUc04Intake().missing`, via
  // src/portal/uc03Continuation.js), which is those four PLUS whatever this
  // particular request did not state. The owner's Portugal example states no
  // dates, so that list is five — and the sentence saying "four things" beside a
  // list of five is the kind of small false statement that costs trust.
  assert.equal(UC04_INPUTS_UC03_CANNOT_SOURCE.length, 4);
  const portugalWithNoDates = buildUc04HandoffEvent({
    employment: { id: "emp_active_001", country_code: "NG" },
    classification: { destinationCountry: "PT", startDate: null, endDate: null },
    externalRef: "9002",
  });
  assert.equal(
    describeUc04Intake(portugalWithNoDates).missing.length,
    5,
    "the continuation page's own count for the reported request"
  );
});
