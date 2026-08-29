// ---------------------------------------------------------------------------
// findings.js  —  the QA findings register
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
// A brute-force run produces numbers; an adversarial review produces judgement.
// Both are evidence, and both are worthless if they live in a chat log. This is
// the durable record: every defect found during the end-to-end QA pass, what it
// actually does, how it was proven, and whether it is fixed.
//
// STATUS is deliberately honest. "open" findings are listed as prominently as
// fixed ones, because a register that only shows resolved items is marketing,
// not QA — and the whole architecture here is built on the claim that this
// project reports its own state accurately.
//
// Each entry was REPRODUCED with a runnable probe before being recorded. None
// are speculative; anything that was attacked and held is in HELD_UP, which
// matters just as much — knowing which controls survived a real attempt is the
// evidence that the surviving ones are load-bearing.
// ---------------------------------------------------------------------------

/** @typedef {"CRITICAL"|"HIGH"|"MEDIUM"|"LOW"} Severity */
/** @typedef {"fixed"|"open"} Status */

export const FINDINGS = [
  // ---- Fixed in this pass -------------------------------------------------
  {
    id: 'F-01', severity: 'CRITICAL', status: 'fixed', useCase: 'UC-06',
    area: 'Four-eyes control',
    title: 'One person could fill both halves of dual approval',
    detail:
      'dualApprovalPolicy.js checked that each ROLE slot was unfilled but never compared the two approvers. ' +
      'One identity approved as customer_admin and then as payroll_specialist, and the real payroll PATCH fired ' +
      'with a single human behind it — a salary cut from 68,000 to 1 EUR in the reproduction.',
    proof: 'Two sequential approvals with the same approver string executed the amendment.',
    fix: 'Added a segregation-of-duties check using the new shared/approverIdentity.js.',
  },
  {
    id: 'F-02', severity: 'CRITICAL', status: 'fixed', useCase: 'UC-09',
    area: 'Four-eyes control',
    title: 'Four-eyes defeated by capitalisation and whitespace',
    detail:
      'multiApprovalPolicy.js compared approver identities with ===, so "Bob Smith", "bob smith" and "BOB SMITH" ' +
      'counted as three separate people and filled all three slots on a real payment.',
    proof: 'Three approvals from one human executed a disbursement.',
    fix:
      'Identity comparison now canonicalises (NFKC, trim, collapse whitespace, lowercase, fold cross-script ' +
      'confusables) before comparing, and isFullyApproved() counts DISTINCT HUMANS rather than filled slots.',
  },
  {
    id: 'F-03', severity: 'CRITICAL', status: 'fixed', useCase: 'UC-09',
    area: 'Four-eyes control',
    title: 'A null approval requirement read as "satisfied"',
    detail:
      'isFullyApproved() evaluated `filledCount >= approvalSlotsRequired`. With a null requirement JavaScript ' +
      'coerces to `1 >= 0`, which is true — so any row whose slot count was unset executed a payment on ONE approval.',
    proof: 'A row with approvalSlotsRequired: null executed after a single approve.',
    fix: 'A non-integer requirement now falls back to the floor of two instead of to zero.',
  },
  {
    id: 'F-04', severity: 'HIGH', status: 'fixed', useCase: 'UC-01/03/05/07/08',
    area: 'Robustness',
    title: 'Non-string ticket text crashed the request before any audit row existed',
    detail:
      'Eight classifiers and parsers opened with `(text || "").toLowerCase()`, which rescues null and "" but passes ' +
      'a number, object or array straight through to a method that does not exist on them. The request died with an ' +
      'unhandled TypeError, so it vanished with no record it had ever arrived.',
    proof: 'The simulator hit this on 89 of 10,000 interactions across four use cases — its most common crash.',
    fix: 'New shared/text.js asLowerText() coerces safely; all eight call sites now use it.',
  },
  {
    id: 'F-05', severity: 'HIGH', status: 'fixed', useCase: 'UC-09',
    area: 'Robustness',
    title: 'Malformed amounts crashed the money path before auditing',
    detail:
      'fromRemoteInteger() was called unconditionally, throwing on undefined, null, NaN, Infinity or a numeric ' +
      'STRING. On the one use case that moves real money the request was lost with no decision and no audit row.',
    proof: 'Every malformed-amount input crashed; 127 of 10,000 simulated interactions.',
    fix:
      'The amount is validated before any money math. Anything that is not an integer escalates with reason ' +
      '"unparseable_amount" and a durable audit row. The numeric string is deliberately NOT coerced — silently ' +
      'accepting "500000" is how a 100x scaling error gets in.',
  },
  {
    id: 'F-06', severity: 'HIGH', status: 'fixed', useCase: 'UC-09',
    area: 'Robustness',
    title: 'An unresolvable employment id crashed the payload builder',
    detail: 'prepareIncentivePayload() read employment.id without checking for null, crashing on any employment the API does not resolve.',
    proof: '27 of 10,000 simulated interactions, using a deleted or mistyped employment id.',
    fix: 'Both copies of the builder now return null, which callers treat as "cannot execute".',
  },
  {
    id: 'F-07', severity: 'MEDIUM', status: 'fixed', useCase: 'UC-05',
    area: 'Correctness',
    title: 'Valid ISO timestamps rejected; invalid calendar dates silently rolled over',
    detail:
      'The notice calculator accepted only bare YYYY-MM-DD, so "2026-09-15T00:00:00.000Z" threw. Worse, Date.UTC ' +
      'silently turns 2026-02-29 into 2026-03-01, which would produce a confident, wrong statutory notice period.',
    proof: 'Simulated resignation tickets crashed on ISO timestamps.',
    fix:
      'The date part is taken from a full timestamp (time deliberately discarded — notice is counted in whole days), ' +
      'and every parse is round-tripped to catch rollovers. Unparseable dates escalate rather than crash.',
  },

  // ---- Open: found and proven, not yet fixed ------------------------------
  {
    id: 'F-08', severity: 'CRITICAL', status: 'fixed', useCase: 'UC-02',
    area: 'Authentication',
    title: 'The expense write path has no authentication at all',
    detail:
      'POST /api/expenses takes the caller\'s identity from the request body (`session: body.session ?? null`). ' +
      'Anyone who can reach the port can approve any expense as anyone — the exact inversion of prime directive #3, ' +
      '"identity comes from an authenticated signal, never a claim".',
    proof: 'An unauthenticated curl approved a $500,000 claim and fired the real PATCH.',
    fix: 'Authenticates BEFORE reading the body, reusing the existing RS256 verifier; body.session is never read. Defaults to requiring a signed identity.',
  },
  {
    id: 'F-09', severity: 'CRITICAL', status: 'fixed', useCase: 'UC-06/UC-09',
    area: 'Concurrency',
    title: 'Concurrent approvals double-execute real writes',
    detail:
      'There is no lock between the "are we fully approved?" check and the Remote write. Two or three approvals ' +
      'arriving together all pass the check and all execute.',
    proof: '3 parallel approvals produced 3 createIncentive calls — $15,000 disbursed for a $5,000 adjustment. UC-06 double-PATCHed payroll the same way.',
    fix: 'Compare-and-set claim (pending -> executing) before the write; losers get execution_already_claimed. Proven by a Promise.all test that was red without it.',
  },
  {
    id: 'F-10', severity: 'HIGH', status: 'fixed', useCase: 'UC-09',
    area: 'Money',
    title: 'Free-text amounts can be parsed 4,000x wrong',
    detail:
      'The LLM seam is wired to remote.askJson / remote.isLlmConfigured, which do not exist on RemoteClient, so every ' +
      'free-text adjustment silently falls back to a regex that takes the FIRST number in the text.',
    proof: '"Q3 2024 relocation top-up of $12,500.00" parsed the 3 in "Q3" — $3.00 posted instead of $12,500.00.',
    fix: 'The regex amount-extraction fallback is DELETED. Unconfigured or invalid parses refuse and escalate as amount_not_extracted rather than guessing a payment figure.',
  },
  {
    id: 'F-11', severity: 'HIGH', status: 'fixed', useCase: 'UC-02',
    area: 'Money',
    title: 'Already-declined and already-paid expenses are re-approved',
    detail: 'None of the 12 gates reads expense.status, so an expense a human already declined is overturned by the automation, and a paid one is approved again.',
    proof: 'declined, approved, paid and cancelled expenses all auto-approved with a real write.',
    fix: 'New hard-stop gate: anything not pending is blocked. A whitelist, so an unknown status blocks too.',
  },
  {
    id: 'F-12', severity: 'HIGH', status: 'fixed', useCase: 'UC-02',
    area: 'Money',
    title: 'The spend-cap gate fails open for unknown categories',
    detail: 'getPolicyCap() returns null for any category missing from a 5-entry table, and the gate reads null as "no cap to enforce".',
    proof: 'A $999,999.99 claim in an uncapped category auto-approved.',
    fix: 'getPolicyCap() uses a Map over a null-prototype table, and an unknown cap now routes to human review instead of reading as no cap.',
  },
  {
    id: 'F-13', severity: 'HIGH', status: 'fixed', useCase: 'UC-04',
    area: 'Compliance',
    title: 'Lowercase country codes bypass every hard block',
    detail: 'riskMatrix.js compares against uppercase sets, so "us" or "ca" walks past the work-permit block that "US" and "CA" correctly enforce.',
    proof: 'destination "us" reached ready_for_approval and a real PATCH; "US" was blocked.',
    fix: "New shared normalizeCountryCode(), applied once at the top of classifyRisk(); travel history is normalised on both sides. Same fix applied to UC-03's sanctions gate.",
  },
  {
    id: 'F-14', severity: 'HIGH', status: 'fixed', useCase: 'UC-04',
    area: 'Compliance',
    title: 'Unknown destinations default to low risk instead of escalating',
    detail: 'Any country the matrix does not know falls through to low risk — the opposite of the spec\'s escalate-by-default rule.',
    proof: 'ZZ, TH, RU, IR, KP all reached ready_for_approval at risk "low".',
    fix: 'Anything outside the curated scope escalates as destination_out_of_scope. The n8n parity scenario that encoded the defect was corrected too.',
  },
  {
    id: 'F-15', severity: 'HIGH', status: 'fixed', useCase: 'UC-06',
    area: 'Validation',
    title: 'The per-country schema gate fails open on a 404',
    detail: 'restClient returns {required: []} when the schema endpoint 404s, so schema validation passes vacuously — against invariant #2, "never assume a static field set".',
    proof: 'DE, GB, PL and CH all 404 on the mock; amendments passed with zero flags.',
    fix: 'getCountrySchema() returns null on a 404 and the gate escalates. A schema that genuinely requires no fields still validates — the two cases are now distinguishable.',
  },
  {
    id: 'F-16', severity: 'HIGH', status: 'fixed', useCase: 'Platform',
    area: 'Availability',
    title: 'An oversized request body crashes the whole process',
    detail: 'The 64 KB cap rejects the promise but never destroys the stream, so the buffer grows to V8\'s string limit and the process exits.',
    proof: 'One unauthenticated request killed both the review API and the UC-06 API; ports went to ECONNREFUSED.',
    fix: 'One shared readJsonBody() replaces 11 private copies; at the cap it drops the buffer, detaches listeners and destroys the socket. A repo scan test asserts no private copy returns.',
  },
  {
    id: 'F-17', severity: 'HIGH', status: 'fixed', useCase: 'UC-01',
    area: 'Routing',
    title: 'The over-scope disclosure gate is a no-op on the LLM path',
    detail:
      'The validator accepts a classification with no requestedFields, and the live n8n prompt never asks for that ' +
      'field, so the gate that should route salary requests to a human never fires in production.',
    proof: 'A ticket explicitly asking for salary auto-resolved with zero flags, in both the Node app and the deployed n8n Code node.',
    fix: 'The n8n prompt now asks for requestedFields, both validators require it, and BOTH gate copies fail closed on absence. Verified through the real Code-node bodies in node:vm.',
  },
  {
    id: 'F-18', severity: 'HIGH', status: 'fixed', useCase: 'UC-09',
    area: 'Money',
    title: 'The payment write is retried 3x with no idempotency key',
    detail: 'The one money-moving POST is auto-retried on 5xx with a byte-identical body and no Idempotency-Key header.',
    proof: 'A stub returning 504, 504, 200 received three identical payment bodies; the caller saw one success.',
    fix: 'One Idempotency-Key per logical write, reused across retries, on all five write methods. uc09 passes the adjustment id, uc06 the amendment id.',
  },
  {
    id: 'F-19', severity: 'HIGH', status: 'fixed', useCase: 'UC-03',
    area: 'Routing',
    title: 'No confidence gate exists',
    detail: 'classification.confidence is produced and validated, then never read by any gate, despite the spec requiring low confidence to route to a human.',
    proof: 'A classification with confidence 0.05 auto-resolved.',
    fix: "UC-03 gained the confidence gate its spec required, placed before intent routing. UC-01's existing gate, which failed open on undefined/NaN, now fails closed — in both copies.",
  },
  {
    id: 'F-20', severity: 'HIGH', status: 'fixed', useCase: 'Platform',
    area: 'Authorization',
    title: 'Approval identity is an unauthenticated string in the body',
    detail: 'UC-04/05/06/09 approval endpoints take the approver from the POST body with no signed-identity option available at all.',
    proof: 'A work authorization was executed and attributed to "nobody@evil.test".',
    fix: "shared/approverAuth.js resolveApprover() consults ONLY the verified RS256 claim in strict mode -- header and body are not read at all, so a valid signature can never be paired with a spoofed display name -- and there is no silent downgrade: no token or no verifier is a 401. The part that took a second pass was the DEFAULT. It was opt-in via ZAF_REQUIRE_SIGNED_IDENTITY, so an unconfigured deployment still trusted the body, and the secure path existing is not the same as the secure path running. signedIdentityRequired() now keys off whether a durable store is attached: a real Supabase pool means a decision outlives the process and names a human, so signed identity is required; a seeded in-memory demo keeps the header posture so a fresh clone still runs. Both overrides stay explicit, and REQUIRE beats ALLOW when someone sets both. test/approverAuth.test.js pins the defaults specifically, since the defect was never in the mechanism. REMAINING, and a deployment step rather than a code one: no ZAF verifier is provisioned yet, so a persistent deployment refuses every approve/deny (signed_identity_not_configured) until one is -- deliberately the loud failure, since a refused approval is recoverable in a minute and an approval attributed to an attacker-supplied string is not.",
  },
  {
    id: 'F-21', severity: 'HIGH', status: 'fixed', useCase: 'Platform',
    area: 'Authorization',
    title: 'Prototype-chain property names are accepted as review actions',
    detail: 'REVIEW_ACTIONS[action] resolves through the prototype chain and the action comes from the raw URL segment.',
    proof: 'POST /api/review/ticket/123/constructor returned 200 and wrote a null status, leaving the case permanently unactionable.',
    fix: 'REVIEW_ACTIONS is a Map. A repo audit found and fixed the same pattern in remoteui/roles.js, remoteui/server.js, portal/personas.js and uc03/letter.js.',
  },
  {
    id: 'F-22', severity: 'MEDIUM', status: 'fixed', useCase: 'UC-08',
    area: 'Correctness',
    title: 'Overlapping presence periods are double-counted',
    detail: 'Each period is counted in full, so the 183-day figure a tax specialist relies on can be roughly double the real one.',
    proof: 'Two overlapping periods produced 366 days in a 366-day window.',
    fix: 'Days are the UNION of calendar day-indices, so overlaps count once. Country codes are trimmed and upper-cased; unparseable input returns NOT_EVALUATED naming the offending field.',
  },
  {
    id: 'F-23', severity: 'MEDIUM', status: 'fixed', useCase: 'UC-02',
    area: 'Money',
    title: 'No amount sanity validation on the expense path',
    detail: 'Negative, zero, null, boolean and unscaled amounts all pass the gates and reach the real write.',
    proof: '-500000, 0, null, true and 100.5 all auto-approved.',
    fix: 'An amount sanity gate runs before any math or cap comparison: safe positive integer, x100 scaled, finite.',
  },
  {
    id: 'F-24', severity: 'MEDIUM', status: 'open', useCase: 'UC-01/UC-02',
    area: 'Idempotency',
    title: 'No idempotency guard on externalRef or expenseId',
    detail:
      'The same request processed twice produces two decisions and two customer-facing actions. Confirmed live on the ' +
      'real Zendesk path: ticket #5 wrote two audit rows 30 microseconds apart and posted a duplicate letter.',
    proof: 'Two identical expense submissions issued two real approval writes.',
    fix: "FIXED on both execution paths. UC-02 no-ops a repeat submission and derives its dedupe fingerprint server-side. Every Node path claims the ref before the case row, the audit row and any Zendesk action. Both, plus ALL NINE n8n graphs, share ONE ledger: workflow_claims, keyed (use_case, external_ref). Two ledgers would not have helped -- each execution path would read the other's refs as unclaimed -- and the guarantee is the PRIMARY KEY rather than application code, because a check-then-insert in a Code node has exactly the race that caused the bug. Keyed by use case as well as ref because one ticket may legitimately reach two use cases (UC-03 routes on to UC-04), and keying on the ref alone would silently drop the second. A request arriving with NO external ref is claimed under 'unreferenced:<execution id>' rather than dropped -- both key columns are NOT NULL, so the bare expression inserted null, failed the key, took the error output and vanished at the duplicate NoOp: a green run that wrote nothing. Proven end to end on UC-01, UC-04, UC-05 and UC-07 (each delivered twice under one ref, exactly one claim row, one record row and one audit row, the redelivery stopping silently); UC-02/03/06/08/09 each recorded a real claim row without downstream verification, so they are half-proven."
  },
  {
    id: 'F-25', severity: 'MEDIUM', status: 'fixed', useCase: 'UC-01',
    area: 'Ordering',
    title: 'The customer-facing action can fire without a durable audit row',
    detail:
      'UC-01\'s audit write is fire-and-forget and its failure is swallowed, yet the very next step posts the letter ' +
      'publicly and solves the ticket — the opposite of the ordering this project documents as its own lesson.',
    proof: 'With a failing audit backend, the letter was still posted and the ticket solved.',
    fix: 'STEP 7 is now a durable audit write, before the letter render and before Zendesk. A failing audit backend refuses the customer-facing action instead of orphaning it.',
  },
  {
    id: 'F-26', severity: 'MEDIUM', status: 'fixed', useCase: 'UC-06',
    area: 'Correctness',
    title: 'Payroll cutoff is timezone-dependent and fails open on a bad date',
    detail: 'A zone-less cutoff timestamp is parsed in the server\'s local time, and an unparseable one yields NaN, which reads as "not passed".',
    proof: 'The same amendment flipped between blocked and approvable across UTC, US Pacific and Tokyo.',
    fix: "Zone-less cutoffs are pinned to UTC (tests set process.env.TZ across four zones); an unreadable cutoff escalates instead of NaN reading as 'not passed'.",
  },
  {
    id: 'F-27', severity: 'HIGH', status: 'fixed', useCase: 'UC-03/UC-05/UC-06/UC-09',
    area: 'Correctness',
    title: 'Alpha-3 country codes compared against alpha-2 values, so whole gates were dead',
    detail:
      "Remote's API returns the alpha-3 form in `code` and the alpha-2 form in `alpha_2_code`; `country_code` does not " +
      'exist on it at all. Both the country list and normalizeEmployment() fell back to `code`, placing three-letter ' +
      'values into fields only ever compared against two-letter ones. Every such comparison was silently false. This ' +
      'survived because the mock served an invented flat `country_code` and a `{data:{countries}}` envelope the real ' +
      'API never emits, so the fixtures agreed with the code rather than with reality.',
    proof:
      'UC-03 could never auto_resolve in production: execution 4259 showed supportedCountries: [] after a SUCCESSFUL ' +
      '224-row fetch, and a Spain trip escalated as unsupported_destination. CORRECTION, verified live and recorded ' +
      'because the overstatement was published first: UC-09 was ALSO reported as broken — its approval floor rises to ' +
      'three for DE/FR/IT and the field was said to hold "DEU" — but driving a real German employment through the ' +
      'UNFIXED production graph (execution 4345) returned 3 slots. The old chain tried `country_code` first, which ' +
      'does not exist on a real employment, so `alpha_2_code` ("DE") already won. On UC-09 the defect was LATENT, ' +
      'not live: it fires only where `alpha_2_code` is absent, or where a flat alpha-3 `country_code` reaches the ' +
      'record — which this API does emit on sibling objects (billing_address_details.country_code is "CAN") and which ' +
      'the Sandbox stand-in injects. Real, worth fixing, but the money control was firing.',
    fix:
      'Every candidate is shape-checked (/^[A-Z]{2}$/) before acceptance, so a three-letter value can never be placed ' +
      'in a two-letter field; an unusable code becomes null, which every consuming gate treats as fail-closed. The mock ' +
      'now serves the real shape, including non-EOR rows so that "in the list" and "eor_onboarding: true" stop being ' +
      'observationally identical offline. Pinned by POSITIVE tests — Spain resolves, UC-09 fires its third approver — ' +
      "because every fail-closed assertion passed before the fix too, which is precisely why a dead gate was invisible.",
  },
];

/** Controls that were attacked and held. Evidence that the survivors are real. */
export const HELD_UP = [
  'UC-07 and UC-08 expose no write route: every POST/PUT/PATCH/DELETE on every enumerated path returns 404 no_such_route.',
  'UC-07 and UC-08 return escalate for every input, including empty text, 20k-character text, prompt injection, and a classifier forced to answer auto_resolve.',
  'Both high-tier stores expose only create and read methods — zero mutation methods exist.',
  'The UC-01 letter escapes every untrusted value: no script, svg or img payload survived into the rendered HTML.',
  'No salary or compensation figure ever reached the letter, across 10,000 simulated interactions and targeted probes.',
  'The letter fetches nothing external — no webfont, no image, no stylesheet.',
  'Terminated, suspended, null and case-variant employment statuses all escalate and never issue a letter.',
  'Case, whitespace and Cyrillic-homoglyph variants of an employment id all fail the UC-01 identity match.',
  'Math.max(2, ...) held against risk scores of 0 and -99 and against injected slot counts of 1.',
  'Approve-twice, approve-after-deny and approve-after-execute are all refused.',
  'Escalated cases have no review path, and high-tier cases are refused on tier grounds even with an approvable decision.',
  'The freshness re-check genuinely blocks execution for an employee terminated between approval and execution.',
  'No prototype pollution via JSON bodies; no reflected XSS; no path traversal on any file-serving demo server.',
  'No catastrophic backtracking in any classifier or parser regex.',
];

export function summarize(findings = FINDINGS) {
  const by = (pred) => findings.filter(pred).length;
  return {
    total: findings.length,
    fixed: by((f) => f.status === 'fixed'),
    open: by((f) => f.status === 'open'),
    critical: by((f) => f.severity === 'CRITICAL'),
    criticalOpen: by((f) => f.severity === 'CRITICAL' && f.status === 'open'),
    high: by((f) => f.severity === 'HIGH'),
    medium: by((f) => f.severity === 'MEDIUM'),
    low: by((f) => f.severity === 'LOW'),
  };
}
