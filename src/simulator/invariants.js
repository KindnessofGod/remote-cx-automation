// ---------------------------------------------------------------------------
// invariants.js  —  the properties that must hold for EVERY interaction
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
// A test asserts "this input produces that output". An invariant asserts
// "no input, ever, produces this output" — which is the only useful shape of
// claim for a system whose failure mode is financial or legal. These are the
// rules from CLAUDE.md §3 and docs/00-FOUNDATION.md §4, expressed as code that
// runs against every one of the simulator's interactions.
//
// Each invariant is a PURE function of (useCase, input, result, context) and
// returns null when satisfied, or a violation object when not. Purity matters:
// they are checked thousands of times per run, they must never themselves
// perform I/O, and a violation must be reproducible from its inputs alone.
//
// SEVERITY is not decoration. CRITICAL means "this would move money, leak data,
// or create legal exposure" — a single occurrence is a release blocker. HIGH
// means a real defect with a bounded blast radius. MEDIUM/LOW are correctness
// and hygiene issues worth fixing but not worth blocking on.
// ---------------------------------------------------------------------------

/** Risk tier per use case — the spine of the architecture (CLAUDE.md §3). */
export const TIER = {
  'UC-01': 'low',
  'UC-02': 'low',
  'UC-03': 'low',
  'UC-04': 'medium',
  'UC-05': 'medium',
  'UC-06': 'medium',
  'UC-07': 'high',
  'UC-08': 'high',
  'UC-09': 'high',
};

/** Decisions that mean "the system acted on the customer's behalf, unattended". */
const AUTO_DECISIONS = new Set(['auto_resolve', 'auto_approve', 'approved', 'executed', 'auto_execute']);

/** The two use cases that must have NO execution path in ANY form. */
const NO_EXECUTION_USE_CASES = new Set(['UC-07', 'UC-08']);

function violation(id, severity, message, detail) {
  return { id, severity, message, detail };
}

/**
 * Every invariant. Each receives the full interaction and returns null or a
 * violation. Order is presentation order in the dashboard, not significance —
 * significance is carried by `severity`.
 */
export const INVARIANTS = [
  // -- Tier invariants ------------------------------------------------------
  {
    id: 'HIGH_TIER_NEVER_EXECUTES',
    severity: 'CRITICAL',
    // The 🔴 rule is not "be careful"; it is "no execution path exists". UC-07
    // and UC-08 satisfy it structurally (their handlers take no `remote`
    // client), so any decision other than escalate means that structure was
    // circumvented — which is precisely the failure the tier exists to prevent.
    check: (uc, input, result) => {
      if (!NO_EXECUTION_USE_CASES.has(uc)) return null;
      if (result.decision !== 'escalate') {
        return violation('HIGH_TIER_NEVER_EXECUTES', 'CRITICAL',
          `${uc} produced decision "${result.decision}" — the high tier must always escalate`,
          { decision: result.decision });
      }
      return null;
    },
  },
  {
    id: 'HIGH_TIER_NO_WRITE_ARTIFACT',
    severity: 'CRITICAL',
    // Belt and braces for the above: even with the right decision string, a
    // result carrying evidence of a write (an id minted by a write endpoint,
    // an executed flag) would mean something wrote anyway.
    check: (uc, input, result) => {
      if (!NO_EXECUTION_USE_CASES.has(uc)) return null;
      const writeMarkers = ['incentiveId', 'executed', 'executionResult', 'writeResult', 'patched'];
      const found = writeMarkers.filter((k) => result[k] !== undefined && result[k] !== false);
      if (found.length) {
        return violation('HIGH_TIER_NO_WRITE_ARTIFACT', 'CRITICAL',
          `${uc} result carries write evidence: ${found.join(', ')}`, { found });
      }
      return null;
    },
  },
  {
    id: 'MEDIUM_TIER_NEVER_AUTO',
    severity: 'CRITICAL',
    // 🟡 means a human decides. An auto decision here is an unattended action
    // on a case the architecture says requires judgement.
    check: (uc, input, result) => {
      if (TIER[uc] !== 'medium') return null;
      if (AUTO_DECISIONS.has(result.decision)) {
        return violation('MEDIUM_TIER_NEVER_AUTO', 'CRITICAL',
          `${uc} auto-decided ("${result.decision}") — the medium tier requires human approval`,
          { decision: result.decision });
      }
      return null;
    },
  },
  {
    id: 'UC09_APPROVAL_FLOOR_OF_TWO',
    severity: 'CRITICAL',
    // UC-09.md is explicit: a risk score may raise the number of approvers
    // above two, never below. This is the four-eyes rule, and it is the single
    // control standing between this system and an unattended real payment.
    check: (uc, input, result) => {
      if (uc !== 'UC-09') return null;
      const slots = result.approvalSlotsRequired;
      if (slots === undefined || slots === null) return null; // refused before scoring
      // A refused or escalated case never reaches an approval flow, so it
      // legitimately reports zero slots — the floor governs cases that CAN
      // proceed to execution, which is exactly where four-eyes must bite.
      if (!/approval/i.test(String(result.decision))) return null;
      if (!Number.isInteger(slots) || slots < 2) {
        return violation('UC09_APPROVAL_FLOOR_OF_TWO', 'CRITICAL',
          `UC-09 required ${slots} approvals — the floor is 2, unconditionally`,
          { approvalSlotsRequired: slots });
      }
      return null;
    },
  },

  // -- Identity -------------------------------------------------------------
  {
    id: 'IDENTITY_FAILS_CLOSED',
    severity: 'CRITICAL',
    // Identity must come from an authenticated signal and fail closed. If the
    // session is missing, empty, or names someone else, no unattended action
    // may follow. Lookalikes (case, padding, homoglyph) count as "someone
    // else" — accepting them is how impersonation gets in.
    check: (uc, input, result, ctx) => {
      if (!AUTO_DECISIONS.has(result.decision)) return null;
      if (!ctx.identityRelevant) return null;
      const claimed = input?.session?.authenticatedEmploymentId;
      const target = input?.employmentId;
      const exactMatch = typeof claimed === 'string' && typeof target === 'string' && claimed === target;
      if (!exactMatch) {
        return violation('IDENTITY_FAILS_CLOSED', 'CRITICAL',
          `${uc} auto-decided without an exact authenticated identity match`,
          { claimed: safe(claimed), target: safe(target), decision: result.decision });
      }
      return null;
    },
  },
  {
    id: 'INACTIVE_EMPLOYEE_NEVER_AUTO',
    severity: 'CRITICAL',
    // A terminated or otherwise non-active employee must never receive an
    // automated confirmation of employment, or an automated payment.
    check: (uc, input, result, ctx) => {
      if (!AUTO_DECISIONS.has(result.decision)) return null;
      if (ctx.employmentStatus && ctx.employmentStatus !== 'active') {
        return violation('INACTIVE_EMPLOYEE_NEVER_AUTO', 'CRITICAL',
          `${uc} auto-decided for an employee with status "${ctx.employmentStatus}"`,
          { status: ctx.employmentStatus, decision: result.decision });
      }
      return null;
    },
  },

  // -- Data disclosure ------------------------------------------------------
  {
    id: 'LETTER_NEVER_DISCLOSES_PAY',
    severity: 'CRITICAL',
    // The standard verification letter is a customer-facing legal-ish document
    // sent onward to landlords, banks and immigration officers. Pay is out of
    // scope for it no matter what the request asked for.
    check: (uc, input, result) => {
      const html = result.letterHtml;
      if (typeof html !== 'string') return null;
      const hit = /salary|compensation|gross[_ ]?amount|annual pay|remuneration/i.exec(html);
      if (hit) {
        return violation('LETTER_NEVER_DISCLOSES_PAY', 'CRITICAL',
          `${uc} letter contains pay-related text "${hit[0]}"`, { match: hit[0] });
      }
      return null;
    },
  },
  {
    id: 'LETTER_ESCAPES_UNTRUSTED_VALUES',
    severity: 'HIGH',
    // The letter is posted to Zendesk as html_body, so it renders in a support
    // agent's authenticated browser session. An unescaped employee name is
    // stored XSS against that agent, not a cosmetic issue.
    check: (uc, input, result) => {
      const html = result.letterHtml;
      if (typeof html !== 'string') return null;
      const dangerous = /<script|onerror\s*=|onload\s*=|javascript:/i.exec(html);
      if (dangerous) {
        return violation('LETTER_ESCAPES_UNTRUSTED_VALUES', 'HIGH',
          `${uc} letter contains unescaped active content "${dangerous[0]}"`, { match: dangerous[0] });
      }
      return null;
    },
  },
  {
    id: 'LETTER_FETCHES_NOTHING_EXTERNAL',
    severity: 'HIGH',
    // Any external reference makes every reader of the document call a third
    // party on open, disclosing that a named person is reading an employment
    // verification letter. This shipped once as a webfont @import.
    check: (uc, input, result) => {
      const html = result.letterHtml;
      if (typeof html !== 'string') return null;
      const ext = /@import|https?:\/\/|src\s*=\s*["']?\/\//i.exec(html);
      if (ext) {
        return violation('LETTER_FETCHES_NOTHING_EXTERNAL', 'HIGH',
          `${uc} letter references an external resource "${ext[0]}"`, { match: ext[0] });
      }
      return null;
    },
  },

  // -- Money ----------------------------------------------------------------
  {
    id: 'MONEY_IS_ALWAYS_FINITE',
    severity: 'CRITICAL',
    // NaN or Infinity reaching a payload means a real payment instruction built
    // from a broken number. It must be rejected upstream, never propagated.
    check: (uc, input, result) => {
      const bad = findNonFiniteMoney(result);
      if (bad) {
        return violation('MONEY_IS_ALWAYS_FINITE', 'CRITICAL',
          `${uc} produced a non-finite money value at ${bad.path} (${String(bad.value)})`, bad);
      }
      return null;
    },
  },
  {
    id: 'MONEY_IS_NEVER_NEGATIVE_IN_PAYLOAD',
    severity: 'HIGH',
    check: (uc, input, result) => {
      const bad = findNegativeMoney(result);
      if (bad) {
        return violation('MONEY_IS_NEVER_NEGATIVE_IN_PAYLOAD', 'HIGH',
          `${uc} produced a negative money value at ${bad.path} (${bad.value})`, bad);
      }
      return null;
    },
  },

  // -- Shape / observability ------------------------------------------------
  {
    id: 'DECISION_IS_A_KNOWN_STRING',
    severity: 'HIGH',
    // An undefined or unexpected decision string is how a case silently falls
    // out of every downstream branch and is never actioned by anyone.
    check: (uc, input, result) => {
      const d = result.decision;
      if (typeof d !== 'string' || d.length === 0) {
        return violation('DECISION_IS_A_KNOWN_STRING', 'HIGH',
          `${uc} produced a non-string decision (${String(d)})`, { decision: safe(d) });
      }
      return null;
    },
  },
  {
    id: 'CLASSIFICATION_DECLARES_ITS_SOURCE',
    severity: 'MEDIUM',
    // Invariant 8: every LLM-with-fallback result states which path answered.
    // Without it, no metric can distinguish "the model is working" from "the
    // model has been failing silently for a week".
    check: (uc, input, result) => {
      const c = result.classification;
      if (!c || typeof c !== 'object') return null;
      if (!c.source) {
        return violation('CLASSIFICATION_DECLARES_ITS_SOURCE', 'MEDIUM',
          `${uc} classification has no source tag`, { classification: safe(c) });
      }
      return null;
    },
  },
  {
    id: 'NEVER_THROWS_UNHANDLED',
    severity: 'HIGH',
    // A handler that throws on hostile input is a handler that, in production,
    // drops a customer request on the floor with no audit trail.
    check: (uc, input, result, ctx) => {
      if (!ctx.threw) return null;
      return violation('NEVER_THROWS_UNHANDLED', 'HIGH',
        `${uc} threw on adversarial input: ${ctx.error}`, { error: ctx.error });
    },
  },
];

// --- helpers ---------------------------------------------------------------

const MONEY_KEY = /amount|salary|total|net|gross|pay|price|cost|value/i;

function walk(obj, fn, path = '', depth = 0, seen = new Set()) {
  if (depth > 6 || obj === null || typeof obj !== 'object') return null;
  if (seen.has(obj)) return null;
  seen.add(obj);
  for (const [k, v] of Object.entries(obj)) {
    const p = path ? `${path}.${k}` : k;
    const hit = fn(k, v, p);
    if (hit) return hit;
    const nested = walk(v, fn, p, depth + 1, seen);
    if (nested) return nested;
  }
  return null;
}

function findNonFiniteMoney(result) {
  return walk(result, (k, v, path) => {
    if (!MONEY_KEY.test(k)) return null;
    if (typeof v === 'number' && !Number.isFinite(v)) return { path, value: v };
    return null;
  });
}

function findNegativeMoney(result) {
  return walk(result, (k, v, path) => {
    if (!MONEY_KEY.test(k)) return null;
    // A negative *delta* is legitimate (a salary decrease, a deduction); a
    // negative absolute amount in a payload is not. Only flag the latter.
    if (/delta|change|difference|adjustmentAmount/i.test(k)) return null;
    if (typeof v === 'number' && Number.isFinite(v) && v < 0) return { path, value: v };
    return null;
  });
}

function safe(v) {
  try {
    if (typeof v === 'string') return v.length > 120 ? `${v.slice(0, 120)}…` : v;
    return JSON.parse(JSON.stringify(v));
  } catch {
    return String(v);
  }
}

/**
 * Run every invariant against one interaction.
 * @returns {Array<object>} violations (empty when the interaction is clean)
 */
export function checkAll(useCase, input, result, ctx = {}) {
  const out = [];
  for (const inv of INVARIANTS) {
    // When a handler threw there IS no result, so every result-shaped invariant
    // would fire on the same underlying event and drown the real signal. The
    // throw is the finding; report it once, via NEVER_THROWS_UNHANDLED.
    if (ctx.threw && inv.id !== 'NEVER_THROWS_UNHANDLED') continue;
    let v = null;
    try {
      v = inv.check(useCase, input, result || {}, ctx);
    } catch (err) {
      // An invariant that throws is itself a defect, and silently swallowing it
      // would let the simulator report a clean run it never actually verified.
      v = violation(inv.id, 'HIGH', `invariant ${inv.id} threw: ${err.message}`, { error: err.message });
    }
    if (v) out.push(v);
  }
  return out;
}
