// ---------------------------------------------------------------------------
// seed.js  —  Generate a realistic case history with no database and no keys
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
// The dashboard is only meaningful with enough volume to show a distribution,
// but anyone reviewing this repo should be able to run `npm run metrics`
// immediately, with no Supabase and no API key.
//
// The important choice: this does NOT fabricate rows. Every case below is
// produced by running a real ticket through the real workflow — the real
// classifier, the real identity check, the real policy gates — against the
// mock Remote server. So the percentages on the dashboard are genuine outputs
// of the decision logic, not numbers typed into a fixture. If someone changes
// a gate in policyEngine.js, this dashboard moves. A hand-written fixture
// would not, and would quietly start lying.
//
// Specialist approve/reject decisions ARE simulated — there is no human here
// to press the button. That is the one synthetic input, and it is labelled as
// such wherever it surfaces.
// ---------------------------------------------------------------------------

import { startMockServer } from "../remote/mockServer.js";
import { RemoteClient } from "../remote/restClient.js";
import { AuditLogger } from "../shared/audit.js";
import { CaseStore } from "../shared/caseStore.js";
import { handleVerificationTicket } from "../uc01/workflow.js";
import { classifyRequestRuleBased } from "../uc01/classifier.js";
import { PORTS } from "../shared/ports.js";

/**
 * Deterministic PRNG (mulberry32) so a seeded run is byte-identical every
 * time. A dashboard whose numbers drift between runs for no reason is not
 * something you can screenshot, diff, or reason about.
 */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const sessionFor = (id) => ({ authenticatedEmploymentId: id });

/**
 * G-3/L-8/VC-30: the (requestingParty, purpose) pair the `third_party_with_
 * consent` archetype's requests are scoped to, and which `seedGrantedConsent()`
 * below writes a GRANTED, COMPLETE `consent_records` row for before the loop
 * runs. A boolean can no longer stand in for this — the archetype's requests
 * have to find a real, readable artifact (VC-07's own requirement) for every
 * one of their runs to reach `human_review`/`third_party_request` rather than
 * `awaiting_employee_consent`.
 */
const GRANTED_CONSENT_SEED = Object.freeze({
  employmentId: "emp_active_001",
  requestingParty: "First Bank",
  purpose: "Mortgage application",
});

/**
 * Writes the one granted consent artifact every `third_party_with_consent`
 * archetype run needs to find. A throwaway `cases` row carries it, because
 * `consent_records.case_id` is NOT NULL — the same "the case must exist
 * first" rule L-9 states for the live path, satisfied here by a row that
 * exists purely to be the FK target for a seeded fixture, never read for
 * anything else.
 */
function seedGrantedConsent(caseStore) {
  const seedCase = caseStore.createCase({
    useCase: "UC-01",
    employmentId: GRANTED_CONSENT_SEED.employmentId,
    decision: "awaiting_employee_consent",
    status: "awaiting_consent",
  });
  caseStore.createConsentRecord({
    caseId: seedCase.id,
    consentType: "third_party_verification",
    status: "granted",
    source: "metrics_seed",
    requestingParty: GRANTED_CONSENT_SEED.requestingParty,
    purpose: GRANTED_CONSENT_SEED.purpose,
    grantedByEmploymentId: GRANTED_CONSENT_SEED.employmentId,
    grantedBySignal: "metrics_seed",
    grantedAt: new Date().toISOString(),
  });
  // NOT A REAL TICKET'S OUTCOME — see the file header's "this does NOT
  // fabricate rows" invariant. `findConsentArtifact()`'s in-memory lookup
  // joins through `caseStore.cases`, so the row has to exist there for the
  // WHOLE run (every `third_party_with_consent` archetype tick re-reads it);
  // its id is returned so the caller can exclude it from the aggregate the
  // dashboard actually renders, once the run is over and nothing will look
  // it up again.
  return seedCase.id;
}

/**
 * Ticket archetypes with rough real-world weights. Verification requests skew
 * heavily toward the simple standard case; the exceptions are the long tail
 * that generates the human workload the dashboard is meant to expose.
 */
const ARCHETYPES = [
  {
    weight: 55,
    name: "standard",
    build: (i) => ({
      text: "Please send me a standard employment verification letter.",
      session: sessionFor("emp_active_001"),
      employmentId: "emp_active_001",
      externalRef: `seed_${i}`,
    }),
  },
  {
    weight: 14,
    name: "bank_form_attachment",
    build: (i) => ({
      text: "My bank sent this form, please complete it.",
      session: sessionFor("emp_active_001"),
      employmentId: "emp_active_001",
      hasAttachment: true,
      externalRef: `seed_${i}`,
    }),
  },
  {
    weight: 11,
    name: "external_portal_url",
    build: (i) => ({
      text: "Here is the link to my lender's portal: https://verify.example.com/xyz",
      session: sessionFor("emp_active_001"),
      employmentId: "emp_active_001",
      externalRef: `seed_${i}`,
    }),
  },
  {
    weight: 9,
    name: "third_party_awaiting_consent",
    build: (i) => ({
      text: "This is First Bank, we need to verify employment directly.",
      session: null,
      employmentId: "emp_active_001",
      // A DIFFERENT party+purpose from the "with consent" archetype below —
      // if the two shared a key, this archetype's runs would find the OTHER
      // archetype's granted row (see GRANTED_CONSENT_SEED below) and no run
      // would ever demonstrate the pending state at all.
      requestingParty: "Second Bank",
      purpose: "Employment reference — unanswered",
      externalRef: `seed_${i}`,
    }),
  },
  {
    weight: 6,
    name: "third_party_with_consent",
    build: (i) => ({
      text: "This is First Bank, please verify employment on behalf of the employee.",
      session: null,
      employmentId: "emp_active_001",
      // G-3/L-8 replaced the old `consentOnRecord: true` boolean with a real
      // lookup against `consent_records` — see GRANTED_CONSENT_SEED below,
      // written into the shared caseStore once before this loop runs, for
      // exactly this (employmentId, requestingParty, purpose) triple.
      requestingParty: GRANTED_CONSENT_SEED.requestingParty,
      purpose: GRANTED_CONSENT_SEED.purpose,
      externalRef: `seed_${i}`,
    }),
  },
  {
    weight: 5,
    name: "terminated_employee",
    build: (i) => ({
      text: "I need a standard employment letter.",
      session: sessionFor("emp_terminated_002"),
      employmentId: "emp_terminated_002",
      externalRef: `seed_${i}`,
    }),
  },
];

function pickArchetype(random) {
  const total = ARCHETYPES.reduce((sum, a) => sum + a.weight, 0);
  let roll = random() * total;
  for (const a of ARCHETYPES) {
    roll -= a.weight;
    if (roll <= 0) return a;
  }
  return ARCHETYPES[0];
}

/**
 * Run `count` synthetic tickets through the real UC-01 workflow.
 *
 * @param {object} [opts]
 * @param {number} [opts.count]       how many tickets to run
 * @param {number} [opts.seed]        PRNG seed
 * @param {number} [opts.acceptRate]  simulated probability a specialist agrees
 *                                    with the AI recommendation
 * @param {number} [opts.port]        mock server port (registry-allocated; see
 *                                    src/shared/ports.js)
 * @returns {Promise<{cases:object[], reviewQueue:object[], traces:object[]}>}
 */
export async function seedCaseHistory({
  count = 120,
  seed = 42,
  acceptRate = 0.78,
  port = PORTS.METRICS_SEED_MOCK,
} = {}) {
  const random = rng(seed);
  const server = await startMockServer(port);
  const remote = new RemoteClient({ baseUrl: `http://localhost:${port}` });

  // One shared in-memory store: we want an aggregate history, not per-case
  // isolation the way scenarios.js needs.
  const audit = new AuditLogger();
  const caseStore = new CaseStore();
  const consentSeedCaseId = seedGrantedConsent(caseStore);

  try {
    for (let i = 0; i < count; i++) {
      const archetype = pickArchetype(random);
      await handleVerificationTicket(archetype.build(i), {
        remote,
        audit,
        caseStore,
        classify: classifyRequestRuleBased,
      });
    }
  } finally {
    server.close();
  }

  applySimulatedSpecialistDecisions(caseStore, random, acceptRate);
  applySyntheticHandlingTimes(caseStore, random);

  // The trace half of the audit log, as AuditLogger recorded it. With the
  // rule-based classifier there are no LLM attempts, so this is usually
  // empty — but the wiring is real: a configured LLM path feeds the
  // duplicate-call check without any change here.
  const traces = audit.entries.filter((e) => e.call);

  // EXCLUDE THE CONSENT SEED CASE. It never went through a real ticket — it
  // exists only as the FK target `consent_records` requires — so the
  // dashboard's "not fabricated" invariant holds it out of both arrays,
  // now that nothing will look it up again.
  const cases = caseStore.cases.filter((c) => c.id !== consentSeedCaseId);
  const reviewQueue = caseStore.reviewQueue.filter((r) => r.caseId !== consentSeedCaseId);
  return { cases, reviewQueue, traces };
}

/**
 * Stand in for specialists working the review queue. THIS IS THE SYNTHETIC
 * PART — with no human present there is no real accept/reject signal, so the
 * accept-rate metric is exercised rather than measured. A slice is left
 * `pending` because a real queue always has work still in it.
 */
function applySimulatedSpecialistDecisions(caseStore, random, acceptRate) {
  for (const entry of caseStore.reviewQueue) {
    if (random() < 0.15) continue; // still queued
    entry.status = random() < acceptRate ? "approved" : "rejected";
    entry.assignee = "specialist_sim";
    entry.updatedAt = new Date().toISOString();
  }
}

/**
 * Give resolved cases a plausible spread of handling times. In-memory rows are
 * all created within milliseconds of each other, so median handling time would
 * otherwise read as ~0 and say nothing. Auto-resolved cases are near-instant;
 * anything a human touched takes far longer — which is exactly the contrast
 * the metric exists to show.
 */
function applySyntheticHandlingTimes(caseStore, random) {
  for (const c of caseStore.cases) {
    if (c.status !== "resolved" && c.status !== "closed") continue;
    const seconds = c.decision === "auto_resolve" ? 2 + random() * 6 : 3600 + random() * 14400;
    c.updatedAt = new Date(new Date(c.createdAt).getTime() + seconds * 1000).toISOString();
  }
}
