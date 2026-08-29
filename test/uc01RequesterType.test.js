// ---------------------------------------------------------------------------
// uc01RequesterType.test.js — VC-29 / L-10 / DRIFT-119
// ---------------------------------------------------------------------------
// `requesterType` selects the whole disclosure REGIME. Until L-10 the LLM
// decided it, which under G-3 is the model deciding whether a consent artifact
// is required at all — a use §9 does not permit and §10 explicitly makes
// deterministic.
//
// The regression assertion VC-29 asks for is the fourth test here: a classifier
// answer of `self` cannot place a non-matching requester on the self path, IN
// BOTH GATE COPIES. Testing only the shared function would prove nothing about
// the live path, which is where this decision actually gets made.
// ---------------------------------------------------------------------------

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { deriveRequesterType } from "../src/uc01/requesterType.js";
import { verifyRequester } from "../src/shared/identity.js";

const EMPLOYMENT = { id: "emp_1", email: "ada@example.com", status: "active", contract_type: "eor" };

test("a matching authenticated signal derives self — on EITHER signal", () => {
  // The positive case, first, and for both signal strengths. Without it, a
  // derivation that answered `third_party` to everything would pass every
  // assertion below: fail-closed and structurally-unable-to-succeed are
  // indistinguishable from outside.
  assert.equal(
    deriveRequesterType({ session: { authenticatedEmploymentId: "emp_1" }, employment: EMPLOYMENT, classifierRequesterType: "self" }).requesterType,
    "self"
  );
  assert.equal(
    deriveRequesterType({ session: { authenticatedEmail: "ADA@example.com " }, employment: EMPLOYMENT, classifierRequesterType: "self" }).requesterType,
    "self"
  );
});

test("VC-29: a classifier answer of `self` cannot put a non-matching requester on the self path", () => {
  // DRIFT-119's exact scenario: a stranger writing "I am confirming my own
  // employment", and a model agreeing with them.
  const r = deriveRequesterType({
    session: { authenticatedEmail: "stranger@elsewhere.test" },
    employment: EMPLOYMENT,
    classifierRequesterType: "self",
  });
  assert.equal(r.requesterType, "third_party");
  assert.equal(r.basis, "requester_email_does_not_match");
  // And the disagreement is RECORDED rather than discarded — a silent override
  // teaches nobody anything, and a model systematically wrong about this is a
  // fact worth having.
  assert.equal(r.classifierOpinion, "self");
  assert.equal(r.disagreesWithClassifier, true);
});

test("the classifier may TIGHTEN but never loosen", () => {
  // The asymmetry IS the control. A model may raise suspicion; it may not lower
  // a requirement.
  const tightened = deriveRequesterType({
    session: { authenticatedEmploymentId: "emp_1" },
    employment: EMPLOYMENT,
    classifierRequesterType: "third_party",
  });
  assert.equal(tightened.requesterType, "third_party", "self -> third_party must be honoured");

  const notLoosened = deriveRequesterType({
    session: null,
    employment: EMPLOYMENT,
    classifierRequesterType: "self",
  });
  assert.equal(notLoosened.requesterType, "third_party", "third_party -> self must be refused");
});

test("VC-29: an absent or unparseable classifier answer fails CLOSED to third party, never to self", () => {
  // Honoured literally, and it is stricter than it looks: a provably-self
  // requester reaches a human rather than a letter when the model's field is
  // unusable. That direction can cost a correct requester a wait; it cannot
  // cause a wrong disclosure. `self` is the permissive answer and is never
  // arrived at because something was missing.
  for (const answer of [undefined, null, "", "SELF", 1, {}, [], "unknown"]) {
    const r = deriveRequesterType({
      session: { authenticatedEmploymentId: "emp_1" },
      employment: EMPLOYMENT,
      classifierRequesterType: answer,
    });
    assert.equal(r.requesterType, "third_party", `classifier answer ${JSON.stringify(answer)}`);
    assert.equal(r.basis, "classifier_requester_type_unreadable");
  }
});

test("the unauthenticated third-party door is a third party by CHANNEL, whatever it claims", () => {
  const r = deriveRequesterType({
    session: null,
    employment: EMPLOYMENT,
    source: "third_party_door",
    classifierRequesterType: "self",
  });
  assert.equal(r.requesterType, "third_party");
  assert.equal(r.basis, "unauthenticated_channel");
});

test("an absent record and an unrecognised session shape both land on the stricter regime", () => {
  assert.equal(
    deriveRequesterType({ session: { authenticatedEmploymentId: "emp_1" }, employment: null, classifierRequesterType: "self" }).requesterType,
    "third_party"
  );
  assert.equal(
    deriveRequesterType({ session: { somethingElse: true }, employment: EMPLOYMENT, classifierRequesterType: "self" }).basis,
    "unrecognised_session_shape"
  );
  // A record with no email cannot be MATCHED against, which is neither evidence
  // of self nor of a third party — an absent comparison, landing on the
  // stricter side.
  assert.equal(
    deriveRequesterType({ session: { authenticatedEmail: "ada@example.com" }, employment: { id: "emp_1" }, classifierRequesterType: "self" }).basis,
    "no_email_on_employment_record"
  );
});

// ---------------------------------------------------------------------------
// rca-43z — run the n8n gates node from RAW inputs, not a pre-decided answer.
// ---------------------------------------------------------------------------
// Until this landed, the test below (and gates.js itself) fed the n8n copy an
// ALREADY-DERIVED requesterType — this file's own prior comment said so in as
// many words: "n8n copy, running the deployed body, fed the SAME derived
// type." That proves the two copies can be made to agree GIVEN an answer; it
// proves nothing about whether gates.js derives the SAME answer from the raw
// signal on its own, which is exactly the gap that let the live path decide
// third-party status from validateClassification.js's text heuristic
// (`/(this is|we are|on behalf of)/`, defaulting to `self`) while
// src/uc01/workflow.js derived deterministically from session + record. The
// same live ticket reached `escalate/identity_not_verified` in n8n and
// `awaiting_employee_consent` in Node — see rca-43z's own report for the
// live proof (ticket #109).
//
// `runGatesFromRawInputs()` below feeds gates.js exactly what production
// feeds it: a `session`, an `employmentId`, the raw Remote API response, and
// the CLASSIFIER's own (possibly wrong) opinion — never a pre-computed
// requesterType. gates.js must derive it internally now, and this file
// asserts that derivation lands on the same value, basis and disagreement
// flag as `deriveRequesterType()` computes independently on the Node side.
function runGatesFromRawInputs({ session, employmentRecord, classifierRequesterType, source }) {
  const body = readFileSync(new URL("../workflows/nodes/gates.js", import.meta.url), "utf8");
  const ctx = {
    // The RAW classifier answer — exactly what validateClassification.js's
    // text heuristic would have produced, never what deriveRequesterType()
    // would produce. If gates.js were still trusting this directly (the bug),
    // feeding "self" here would drive `self` straight through the gate that
    // decides the whole regime.
    classification: { requesterType: classifierRequesterType, intent: "standard_letter", requestedFields: [], confidence: 0.99 },
    session: session ?? null,
    consentRecord: null,
    employmentId: employmentRecord.id,
    source: source ?? "zendesk",
    // rca-fawf/K3: gates.js REFUSES an `auto_resolve` that carries no
    // externalRef (a decision nothing can trace, and nothing the idempotency
    // claim can key on). Production always supplies one — "Normalize Ticket"
    // sets it from the Zendesk ticket id — so a harness that omitted it would
    // be feeding gates.js something production never feeds it, and the one
    // agreement case that lands on `auto_resolve` would throw for a reason
    // that has nothing to do with requester-type derivation.
    externalRef: "requester-type-1",
  };
  const employmentResponse = { data: { employment: employmentRecord } };
  // rca-wn30: this mock used to be NAME-BLIND — `$: () => ctx` for every node
  // name — which was harmless only while gates.js looked up exactly one node.
  // It now reads the employment response by name too ("Lookup Consent Records"
  // sits between the fetch and the gates on the live graph and owns `$input`),
  // and a name-blind mock silently handed it `ctx`, producing an employment
  // with no email at all. Answering per NAME is what the real n8n accessor
  // does; anything else is the test agreeing with a world that does not exist.
  const sandbox = {
    $: (nodeName) => {
      if (nodeName === "Fetch Employment (Remote)") return { first: () => ({ json: employmentResponse }) };
      // "Lookup Consent Records" is deliberately NOT served here: this file is
      // about requester-type derivation, and gates.js degrades a missing
      // lookup to "no rows" — the safe pending default, which is exactly the
      // state these scenarios assume.
      if (nodeName === "Lookup Consent Records") throw new Error(`No node named "${nodeName}" was found`);
      return { first: () => ({ json: ctx }) };
    },
    $input: { first: () => ({ json: employmentResponse }) },
    console,
  };
  vm.createContext(sandbox);
  return JSON.parse(JSON.stringify(vm.runInContext(`(function(){${body}})()`, sandbox)))[0].json;
}

/** The raw Remote API shape gates.js's normalizeEmployment-equivalent reads. */
const rawEmployment = (over = {}) => ({
  id: "emp_1",
  status: "active",
  employment_model: "eor",
  basic_information: { name: "Ada", provisional_start_date: "2022-03-01", email: "ada@example.com" },
  ...over,
});

test("VC-28 + VC-29 together: BOTH gate copies DERIVE the SAME regime for the stranger the classifier vouched for (G-3, rca-43z)", () => {
  // DRIFT-119's exact scenario: a stranger's session does not match the
  // record, and the classifier nonetheless said "self". Both copies must
  // reach that answer by DERIVING it, not by being handed it.
  const session = { authenticatedEmail: "stranger@elsewhere.test" };

  // Node copy: derive, then verify, both from the raw signal.
  const derived = deriveRequesterType({ session, employment: EMPLOYMENT, classifierRequesterType: "self" });
  assert.equal(derived.requesterType, "third_party");
  const nodeIdentity = verifyRequester({
    session,
    employment: EMPLOYMENT,
    requesterType: derived.requesterType,
    consentRecord: null,
  });
  assert.equal(nodeIdentity.verified, false);
  assert.equal(nodeIdentity.pending, true);
  assert.equal(nodeIdentity.reason, "awaiting_employee_consent_other_employee_signed_in");

  // n8n copy: same raw signal, gates.js derives internally.
  const out = runGatesFromRawInputs({
    session,
    employmentRecord: rawEmployment(),
    classifierRequesterType: "self",
  });

  // The DERIVATION itself agrees, not just the eventual decision.
  assert.equal(out.requesterType.value, derived.requesterType);
  assert.equal(out.requesterType.basis, derived.basis);
  assert.equal(out.requesterType.classifierOpinion, derived.classifierOpinion);
  assert.equal(out.requesterType.disagreesWithClassifier, derived.disagreesWithClassifier);

  assert.equal(out.decision, "awaiting_employee_consent");
  assert.equal(out.reason, "awaiting_employee_consent");
  // Same slug on both paths — the reconciliation VC-28 requires.
  assert.ok(out.flags.includes("identity_awaiting_employee_consent_other_employee_signed_in"), out.flags.join(","));
});

test("rca-43z regression: ticket #109's exact shape — self-claim, non-matching authenticated email — n8n and Node now AGREE", () => {
  // The live measured divergence this bead exists to close: Chris asked for
  // HIS OWN letter, writing from his personal address while away from his
  // work laptop. The classifier read `requesterType: self` (no third-party
  // phrase in the text). Before this fix: n8n trusted that opinion directly
  // and reached `escalate/identity_not_verified` (gate 2 of 13, "Requester
  // type as read: self"); Node derived independently from the mismatched
  // authenticated email and reached `awaiting_employee_consent`. Both must
  // now derive the SAME regime from the SAME raw inputs.
  const session = { authenticatedEmail: "chris.personal@example.com" };
  const employment = { id: "emp_chris", email: "chris@company.example", status: "active", contract_type: "eor" };

  const derived = deriveRequesterType({ session, employment, classifierRequesterType: "self" });
  assert.equal(derived.requesterType, "third_party", "an authenticated email that does not match the record is never self, whatever the classifier read");

  const out = runGatesFromRawInputs({
    session,
    employmentRecord: rawEmployment({ id: "emp_chris", basic_information: { name: "Chris", provisional_start_date: "2022-03-01", email: "chris@company.example" } }),
    classifierRequesterType: "self",
  });
  assert.equal(out.requesterType.value, "third_party");
  assert.equal(out.decision, "awaiting_employee_consent", "n8n must no longer escalate a live ticket shaped exactly like #109");
  assert.notEqual(out.decision, "escalate", "the pre-fix live defect this bead reports");
});

// ---------------------------------------------------------------------------
// A small agreement matrix — the Node function and the n8n copy, run
// independently from IDENTICAL raw (session, employment, classifierOpinion)
// triples, must derive the same requesterType and basis every time. This is
// the structural regression guard: a future edit to ONE copy and not the
// other fails here even if nothing downstream happens to disagree.
// ---------------------------------------------------------------------------
const AGREEMENT_CASES = [
  { name: "matching Remote-shaped session (email) + self opinion → self", session: { authenticatedEmail: "ada@example.com" }, classifierRequesterType: "self" },
  { name: "no session at all + self opinion → third_party (fails closed)", session: null, classifierRequesterType: "self" },
  { name: "mismatched email + self opinion → third_party", session: { authenticatedEmail: "someone.else@example.com" }, classifierRequesterType: "self" },
  { name: "matching email + third_party opinion → third_party (classifier may tighten)", session: { authenticatedEmail: "ada@example.com" }, classifierRequesterType: "third_party" },
  { name: "matching email + unparseable opinion → third_party (fails closed)", session: { authenticatedEmail: "ada@example.com" }, classifierRequesterType: "unknown" },
];

for (const c of AGREEMENT_CASES) {
  test(`derivation agreement matrix: ${c.name}`, () => {
    const employment = { id: "emp_1", email: "ada@example.com", status: "active", contract_type: "eor" };
    const derived = deriveRequesterType({ session: c.session, employment, classifierRequesterType: c.classifierRequesterType });
    const out = runGatesFromRawInputs({
      session: c.session,
      employmentRecord: rawEmployment({ basic_information: { name: "Ada", provisional_start_date: "2022-03-01", email: "ada@example.com" } }),
      classifierRequesterType: c.classifierRequesterType,
    });
    assert.equal(out.requesterType.value, derived.requesterType, "requesterType.value disagrees");
    assert.equal(out.requesterType.basis, derived.basis, "basis disagrees");
    assert.equal(out.requesterType.disagreesWithClassifier, derived.disagreesWithClassifier, "disagreesWithClassifier disagrees");
  });
}
