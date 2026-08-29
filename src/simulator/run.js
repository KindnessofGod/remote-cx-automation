// ---------------------------------------------------------------------------
// run.js  —  drives N adversarial interactions through all nine use cases
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
// This runs the REAL handlers — the same `handleVerificationTicket`,
// `handleAdjustmentRequest` and so on that n8n and the HTTP APIs call — against
// generated hostile input, and checks every invariant in invariants.js after
// each one. Nothing is stubbed except the outward-facing I/O seams (the LLM,
// which must never be called from an offline run, and the Remote API, which is
// the project's own mock server).
//
// That distinction is the whole value: if this file stubbed the policy engines
// it would be testing its own fixtures. It stubs only what crosses the network,
// so a change to a gate moves these numbers.
// ---------------------------------------------------------------------------

import { startMockServer } from '../remote/mockServer.js';
import { RemoteClient } from '../remote/restClient.js';
import { AuditLogger } from '../shared/audit.js';
import { CaseStore } from '../shared/caseStore.js';
import { judgeNarrative } from '../shared/narrativeJudge.js';
import { PORTS } from '../shared/ports.js';

import { handleVerificationTicket } from '../uc01/workflow.js';
import { classifyRequestRuleBased } from '../uc01/classifier.js';
import { handleExpenseSubmission } from '../uc02/workflow.js';
import { classifyExpenseRuleBased } from '../uc02/expenseClassifier.js';
import { ExpenseStore } from '../uc02/expenseStore.js';
import { handleTravelInquiry } from '../uc03/workflow.js';
import { classifyTravelInquiryRuleBased } from '../uc03/classifier.js';
import { handleWorkationRequest } from '../uc04/workflow.js';
import { AuthorizationStore } from '../uc04/authorizationStore.js';
import { handleResignationRequest } from '../uc05/workflow.js';
import { ResignationStore } from '../uc05/resignationStore.js';
import { handleAmendmentRequest } from '../uc06/workflow.js';
import { AmendmentStore } from '../uc06/amendmentStore.js';
import { handleRelocationReview } from '../uc07/workflow.js';
import { DossierStore as Uc07DossierStore } from '../uc07/dossierStore.js';
import { parseRelocationRuleBased } from '../uc07/relocationParser.js';
import { handleTaxInquiry } from '../uc08/workflow.js';
import { DossierStore as Uc08DossierStore } from '../uc08/dossierStore.js';
import { parseInquiryRuleBased } from '../uc08/inquiryParser.js';
import { handleAdjustmentRequest } from '../uc09/workflow.js';
import { AdjustmentStore } from '../uc09/adjustmentStore.js';

import { checkAll, TIER } from './invariants.js';
import {
  makeRng, pick, chance, someText, someAmount, someSession, someEmploymentId,
  someDate, someApprover, CURRENCIES, COUNTRIES, HOSTILE_STRINGS,
} from './generators.js';

// Forcing the real judge into its own unconfigured branch keeps the genuine
// fallback wording instead of a hand-written stub, and guarantees no network
// call — the established idiom in this repo's tests.
const fakeJudge = (args) => judgeNarrative(args, { isConfigured: () => false });
const fakeDraftSummary = async ({ changes } = {}) => ({
  summary: 'Simulated deterministic summary.',
  source: 'rule_based_fallback',
  changes,
});
const fakeDraftNarrative = async () => ({
  narrative: 'Simulated deterministic narrative.',
  source: 'rule_based_fallback',
});
const fakeExtract = () => ({ proposedEndDate: null, source: 'rule_based_fallback' });
const fakeParseAdjustment = async () => ({
  type: 'bonus', amount: 5000, currency: 'USD', amountTaxType: 'gross', description: 'simulated', source: 'rule_based_fallback',
});

/**
 * The mock Remote server does not implement every endpoint every use case
 * touches. Rather than stub the whole client (which would stop this exercising
 * real request/response shaping), wrap the real client and fill only the gaps.
 */
function makeRemote(baseUrl) {
  const real = new RemoteClient({ baseUrl });
  const fallbacks = {
    getCountrySchema: async () => ({ required: ['employment_id', 'type', 'amount', 'currency'] }),
    createIncentive: async (payload) => ({ success: true, incentiveId: 'sim_inc_1', ...payload }),
    // No `createWorkAuthorization` fallback, because there is no such endpoint
    // and no such client method: `POST /v1/work-authorization-requests` does not
    // exist on Remote's API (docs/REMOTE-VOCABULARY.md §13.1). A stub here would
    // be this simulator quietly restoring the very call the codebase removed.
    // The mock DOES implement the reads and the PATCH, so UC-04 needs no gap
    // filled on this resource at all.
    patchEmploymentBasicInformation: async (id, payload) => ({ success: true, id, ...payload }),
  };
  return new Proxy(real, {
    get(target, prop) {
      const v = target[prop];
      if (typeof v === 'function') return v.bind(target);
      if (v !== undefined) return v;
      return fallbacks[prop];
    },
  });
}

/** Build one adversarial input per use case. */
function buildInput(uc, rng) {
  const employmentId = someEmploymentId(rng);
  const session = someSession(rng, employmentId);
  switch (uc) {
    case 'UC-01':
      return { text: someText(rng, 'uc01'), session, employmentId, externalRef: `sim-${Math.floor(rng() * 1e6)}` };
    case 'UC-02':
      return {
        expenseId: chance(rng, 0.7) ? 'exp_auto_101' : pick(rng, ['exp_nope', '', null, '../../etc']),
        employmentId, session,
        amount: someAmount(rng),
        currency: pick(rng, CURRENCIES),
      };
    case 'UC-03':
      return { text: someText(rng, 'uc03'), session, employmentId };
    case 'UC-04':
      return {
        employmentId, session,
        factors: {
          homeCountry: pick(rng, COUNTRIES),
          nationality: pick(rng, COUNTRIES),
          destination: { country: pick(rng, COUNTRIES) },
          startDate: someDate(rng),
          endDate: someDate(rng),
          visaType: chance(rng, 0.6) ? 'schengen_short_stay' : pick(rng, [null, '', 'made_up', 123]),
          jobDuties: chance(rng, 0.6) ? 'engineering' : pick(rng, [null, '', 'ceo', {}]),
          hasContractSigningAuthority: chance(rng, 0.5),
        },
      };
    case 'UC-05':
      return {
        session, employmentId,
        proposedEndDate: someDate(rng),
        reason: someText(rng, 'uc01'),
        now: '2026-08-15',
      };
    case 'UC-06':
      return {
        employmentId, session,
        changes: { salary: { oldAmount: someAmount(rng), newAmount: someAmount(rng), currency: pick(rng, CURRENCIES) } },
        requestedEffectiveDate: someDate(rng),
        now: '2026-08-15',
      };
    case 'UC-07':
      return { text: someText(rng, 'uc07'), employmentId, externalRef: `sim-${Math.floor(rng() * 1e6)}`, source: 'simulator' };
    case 'UC-08':
      return { text: someText(rng, 'uc08'), employmentId, externalRef: `sim-${Math.floor(rng() * 1e6)}` };
    case 'UC-09':
      return {
        employmentId, session,
        requester: someApprover(rng, 'requester@example.com'),
        adjustmentRequest: {
          type: pick(rng, ['bonus', 'correction', '', null]),
          amount: someAmount(rng),
          currency: pick(rng, CURRENCIES),
          description: someText(rng, 'uc01'),
        },
      };
    default:
      throw new Error(`unknown use case ${uc}`);
  }
}

/** Invoke the real handler for one use case. */
async function invoke(uc, input, remote) {
  const audit = new AuditLogger();
  const common = { remote, audit };
  switch (uc) {
    case 'UC-01':
      return handleVerificationTicket(input, { ...common, caseStore: new CaseStore(), classify: classifyRequestRuleBased });
    case 'UC-02':
      return handleExpenseSubmission(input, { ...common, expenseStore: new ExpenseStore(), classify: classifyExpenseRuleBased });
    case 'UC-03':
      return handleTravelInquiry(input, { ...common, caseStore: new CaseStore(), classify: classifyTravelInquiryRuleBased });
    case 'UC-04':
      return handleWorkationRequest(input, { ...common, authorizationStore: new AuthorizationStore(), draftSummary: fakeDraftSummary, judge: fakeJudge });
    case 'UC-05':
      return handleResignationRequest(input, { ...common, resignationStore: new ResignationStore(), extract: fakeExtract });
    case 'UC-06':
      return handleAmendmentRequest(input, {
        ...common, amendmentStore: new AmendmentStore(),
        draftSummary: fakeDraftSummary, judge: fakeJudge, slack: async () => ({ sent: false }),
      });
    case 'UC-07':
      return handleRelocationReview(input, {
        audit, dossierStore: new Uc07DossierStore(), classify: parseRelocationRuleBased,
        draftNarrative: fakeDraftNarrative, judge: fakeJudge,
      });
    case 'UC-08':
      return handleTaxInquiry(input, {
        audit, dossierStore: new Uc08DossierStore(), classify: parseInquiryRuleBased,
        draftNarrative: fakeDraftNarrative, judge: fakeJudge,
      });
    case 'UC-09':
      return handleAdjustmentRequest(input, {
        ...common, adjustmentStore: new AdjustmentStore(),
        parseAdjustment: fakeParseAdjustment, judge: fakeJudge,
      });
    default:
      throw new Error(`unknown use case ${uc}`);
  }
}

const USE_CASES = ['UC-01', 'UC-02', 'UC-03', 'UC-04', 'UC-05', 'UC-06', 'UC-07', 'UC-08', 'UC-09'];

/**
 * Run the simulation.
 * @param {object} opts
 * @param {number} opts.count      total interactions across all use cases
 * @param {number} opts.seed       PRNG seed — the same seed reproduces the run
 * @param {(p:object)=>void} [opts.onProgress]
 * @returns {Promise<object>} the full report
 */
export async function simulate({ count = 10000, seed = 20260815, onProgress } = {}) {
  const port = PORTS.SIMULATOR_MOCK;
  const server = await startMockServer(port);
  const remote = makeRemote(`http://localhost:${port}`);
  const rng = makeRng(seed);

  const started = Date.now();
  const perUseCase = {};
  for (const uc of USE_CASES) {
    perUseCase[uc] = { useCase: uc, tier: TIER[uc], runs: 0, threw: 0, decisions: {}, violations: 0, latencyTotal: 0 };
  }
  const violationsById = new Map();
  const samples = []; // bounded sample of violating interactions, for the dashboard

  try {
    for (let i = 0; i < count; i += 1) {
      const uc = USE_CASES[i % USE_CASES.length];
      const input = buildInput(uc, rng);
      const bucket = perUseCase[uc];
      bucket.runs += 1;

      let result = null;
      let threw = false;
      let error = null;
      const t0 = Date.now();
      try {
        result = await invoke(uc, input, remote);
      } catch (err) {
        threw = true;
        error = err && err.message ? err.message : String(err);
        bucket.threw += 1;
      }
      bucket.latencyTotal += Date.now() - t0;

      const decision = threw ? '(threw)' : (result && result.decision) || '(none)';
      bucket.decisions[decision] = (bucket.decisions[decision] || 0) + 1;

      const ctx = {
        threw,
        error,
        identityRelevant: ['UC-01', 'UC-02', 'UC-03'].includes(uc),
        employmentStatus: employmentStatusOf(input.employmentId),
      };
      const violations = checkAll(uc, input, result, ctx);
      if (violations.length) {
        bucket.violations += violations.length;
        for (const v of violations) {
          const prev = violationsById.get(v.id) || { ...v, count: 0, useCases: {} };
          prev.count += 1;
          prev.useCases[uc] = (prev.useCases[uc] || 0) + 1;
          violationsById.set(v.id, prev);
          if (samples.length < 120) {
            samples.push({ index: i, seed, useCase: uc, id: v.id, severity: v.severity, message: v.message, input: compact(input), detail: v.detail });
          }
        }
      }

      if (onProgress && i > 0 && i % 500 === 0) onProgress({ done: i, total: count });
    }
  } finally {
    server.close();
  }

  return {
    meta: {
      count, seed,
      startedAt: new Date(started).toISOString(),
      durationMs: Date.now() - started,
      node: process.version,
    },
    perUseCase: Object.values(perUseCase).map((b) => ({
      ...b,
      avgLatencyMs: b.runs ? +(b.latencyTotal / b.runs).toFixed(2) : 0,
    })),
    violations: [...violationsById.values()].sort(
      (a, b) => severityRank(b.severity) - severityRank(a.severity) || b.count - a.count
    ),
    samples,
  };
}

/** The mock's fixture statuses — used only to judge invariants, never to decide. */
function employmentStatusOf(id) {
  if (id === 'emp_terminated_002') return 'terminated';
  if (typeof id === 'string' && id.startsWith('emp_')) return 'active';
  return null;
}

function severityRank(s) {
  return { CRITICAL: 3, HIGH: 2, MEDIUM: 1, LOW: 0 }[s] ?? 0;
}

function compact(obj) {
  try {
    const s = JSON.stringify(obj, (k, v) => (typeof v === 'string' && v.length > 80 ? `${v.slice(0, 80)}…` : v));
    return s.length > 600 ? `${s.slice(0, 600)}…` : s;
  } catch {
    return String(obj);
  }
}
