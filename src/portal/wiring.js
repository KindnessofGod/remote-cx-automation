// ---------------------------------------------------------------------------
// wiring.js  —  What the portal is plugged into, in one place
// ---------------------------------------------------------------------------
// The portal now has TWO entry points: `npm run portal` (src/portal/cli.js) and
// the Vercel deployment (deploy/cx-apis/deps.js). Both need the same seven
// stores and the same LLM-seam decision, and the second was written by copying
// the first — which is the shape of every "the gates exist twice" defect this
// repo records (CLAUDE.md §6). One store constructed differently in the two
// places is a difference nothing would catch: the deployment would simply not
// persist something, and the only symptom is a row that is not there later.
//
// So the two entry points differ in exactly the things that genuinely differ —
// the transport to the mock Remote (a socket locally, an in-process dispatch in
// a function) and the access posture — and share everything else through here.
// ---------------------------------------------------------------------------

import { ExpenseStore } from "../uc02/expenseStore.js";
import { CaseStore } from "../shared/caseStore.js";
import { AuthorizationStore } from "../uc04/authorizationStore.js";
import { ResignationStore } from "../uc05/resignationStore.js";
import { DossierStore as RelocationDossierStore } from "../uc07/dossierStore.js";
import { DossierStore as TaxDossierStore } from "../uc08/dossierStore.js";
import { AdjustmentStore } from "../uc09/adjustmentStore.js";

import { isLlmConfigured, askAboutDocument } from "../shared/llm.js";
import { classifyExpenseRuleBased } from "../uc02/expenseClassifier.js";
import { classifyTravelInquiryRuleBased } from "../uc03/classifier.js";
import { parseRelocationRuleBased } from "../uc07/relocationParser.js";
import { parseInquiryRuleBased } from "../uc08/inquiryParser.js";
import { draftNarrative as draftRelocationNarrativeFn } from "../uc07/dossierBuilder.js";
import { draftNarrative as draftTaxNarrativeFn } from "../uc08/dossierBuilder.js";
import { parseAdjustmentRequest } from "../uc09/adjustmentParser.js";

/**
 * One store per use case the portal can submit to.
 *
 * Every one of them takes the pool and falls through to Postgres on a read it
 * cannot answer from memory — which is what makes them usable in a serverless
 * function, where "memory" lasts exactly one request.
 *
 * UC-02 used to be the exception here, on the stated grounds that no
 * `uc02_expenses` schema had been verified. The table existed the whole time
 * (see expenseStore.js's header), and the exception cost more than a missing
 * row: an expense submitted through the deployed portal was audited to
 * `audit_log` and then not retrievable by anyone, AND the §7 duplicate-receipt
 * gate could never fire, because its only evidence lived in a memory that
 * ended with the request. There is now no exception in this list.
 *
 * @param {object} [opts]
 * @param {import("pg").Pool|null} [opts.pgPool]
 */
export function buildPortalStores({ pgPool = null } = {}) {
  return {
    // G-3/L-13/L-14: the CaseStore backing UC-01's own portal surfaces — the
    // self-service letter (L-14) and the employee consent surface (L-13),
    // which reads and decides `consent_records` rows a third-party request
    // (through Zendesk or the third-party door) has written into the SAME
    // pooled table. With `pgPool` attached this is genuinely the same data
    // every UC-01 channel sees; without one (a bare `npm run portal`) it is
    // this process's own memory only, exactly the same local-dev limit every
    // other store here already has.
    uc01: new CaseStore({ pgPool }),
    uc02: new ExpenseStore({ pgPool }),
    uc03: new CaseStore({ pgPool }),
    uc04: new AuthorizationStore({ pgPool }),
    uc05: new ResignationStore({ pgPool }),
    uc07: new RelocationDossierStore({ pgPool }),
    uc08: new TaxDossierStore({ pgPool }),
    uc09: new AdjustmentStore({ pgPool }),
  };
}

/**
 * The LLM seams: `{}` when OpenAI is configured (so the real path runs), and
 * the rule-based functions passed EXPLICITLY when it is not.
 *
 * Explicit rather than relying on each workflow's own fallback, for the reason
 * uc03/cli.js records: a run with no key should be deterministic, not quietly
 * degraded through a retry-then-fallback path that costs three failed network
 * calls first.
 */
export function portalLlmDefaults() {
  // HERMETIC UNDER TEST, WHATEVER THE ENVIRONMENT HOLDS.
  //
  // `{}` hands the portal handler the REAL LLM functions. That is right in
  // production and wrong in a test process, and the difference was invisible:
  // five test files inject seven of this handler's ten seams, so the other
  // three reached api.openai.com whenever OPENAI_API_KEY happened to be set.
  // Every assertion still passed — the call fails, withRetry retries, the
  // rule-based fallback answers — so the only symptom was wall clock, 84s
  // becoming 237s, and 348 outbound connections nobody was counting.
  //
  // README's claim that "tests cannot reach a live LLM even if a real .env
  // exists" was therefore false, and README also tells a newcomer to create
  // that .env. Injection is still the rule (see CLAUDE.md §3); this is the
  // floor under it, for the seam somebody forgets next time.
  if (process.env.NODE_TEST_CONTEXT) {
    // Each of these already accepts an injectable `isConfigured`, and answers
    // deterministically from a template when it reports false. Forcing that is
    // better than letting the call fail and be caught: no socket, no three
    // retries, no 401 on stderr, and the same output the no-key path produces.
    const offline = { isConfigured: () => false };
    return {
      classifyExpense: classifyExpenseRuleBased,
      classifyTravel: classifyTravelInquiryRuleBased,
      parseRelocation: parseRelocationRuleBased,
      parseInquiry: parseInquiryRuleBased,
      draftRelocationNarrative: (facts, opts = {}) => draftRelocationNarrativeFn(facts, { ...opts, ...offline }),
      draftTaxNarrative: (facts, opts = {}) => draftTaxNarrativeFn(facts, { ...opts, ...offline }),
      parseAdjustment: (input, opts = {}) => parseAdjustmentRequest(input, { ...opts, ...offline }),
    };
  }
  return isLlmConfigured()
    ? {}
    : {
        classifyExpense: classifyExpenseRuleBased,
        classifyTravel: classifyTravelInquiryRuleBased,
        parseRelocation: parseRelocationRuleBased,
        parseInquiry: parseInquiryRuleBased,
      };
}

/**
 * The receipt transport, or null.
 *
 * Its own function rather than a key in portalLlmDefaults() because that
 * object's shape is "which of these seams should be STUBBED", and this seam's
 * default is the opposite: absent unless a key exists. It is also the one seam
 * that spends money on a document an unauthenticated-ish caller supplies, so
 * it should be readable in one place.
 *
 * NULL UNDER TEST, ALWAYS. Same floor as portalLlmDefaults() — a test that
 * forgets to stub must not reach api.openai.com because the developer happens
 * to have a real .env. Gate 8b reads an absent reading as "nobody tried", so
 * this returning null is behaviourally identical to the state before [E-1].
 */
export function portalReceiptReader() {
  if (process.env.NODE_TEST_CONTEXT) return null;
  return isLlmConfigured() ? askAboutDocument : null;
}
