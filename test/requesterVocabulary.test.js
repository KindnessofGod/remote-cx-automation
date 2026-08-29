// ---------------------------------------------------------------------------
// requesterVocabulary.test.js  —  this system's words, outside src/portal/
// ---------------------------------------------------------------------------
// WHAT THIS GUARDS, AND WHY IT IS NOT test/portalRequesterFacts.test.js
//
// `docs/UI-AUDIENCES.md` is the standing rule: each surface carries what ITS
// reader needs, and a fact earns its place by answering one of that reader's
// questions — being true is not the qualification. The portal enforces it at
// its own boundary and cannot enforce it any further out, because several of
// the sentences it publishes are composed one directory over and passed through
// whole: a policy engine's plain-words `means`, a cap comparison, a dossier's
// account of what it could not source. `portalRequesterFacts.test.js` says so
// itself, and carried a KNOWN_LEAKS list naming those sentences and their
// owners precisely because it could not reach them.
//
// This file is the other end of that list. It holds four modules to the rule
// where the sentences are actually WRITTEN, so a leak is caught at composition
// rather than three surfaces later:
//
//   src/uc05/policyEngine.js   the gate ladder's `means` — the "What happened"
//                              row an employee reads about their own notice
//   src/uc02/workflow.js       the cap comparison a claimant reads when their
//                              expense is refused for exceeding a cap
//   src/uc07/decisionSources.js  what a Mobility Legal specialist is told about
//                              the findings this system could NOT source
//   src/shared/requesterSubject.js  who filed a request and about whom
//
// THE READERS ARE NOT THE SAME PERSON, AND THE RULE IS NOT "PLAIN ENGLISH".
// A Mobility Legal specialist can use an ISO country code, an OECD article
// number and a Remote category key; none of the four can open a path in this
// checkout, and none of them has ever seen this repository's own index for its
// own use cases. So what the rules below catch is THIS SYSTEM TALKING ABOUT
// ITSELF — file paths, module names, our use-case numbering, the spellings our
// identifiers use — and not vocabulary that happens to be technical.
//
// IT IS NOT A DELETION RULE, AND SECTION 3 IS THE HALF THAT MAKES IT SAFE.
// Every statement of a LIMIT, an ABSENCE or a PROVENANCE is the most valuable
// content on these surfaces (docs/UI-AUDIENCES.md §5), and an over-zealous
// reading of "remove what the reader cannot act on" would take exactly those.
// On a 🔴 dossier a specialist acting on false completeness is the failure the
// whole system exists to prevent. So section 3 pins the candour, by property,
// and section 4 pins that what came off a sentence is still on the structured
// field beside it — routed, never deleted.
//
// NON-VACUITY IS PROVED IN THE FILE (section 2). Every rule is run over the
// REAL string it was written for — quoted from the commit before the fix, not
// invented to trip a regex — and required to catch it. A rule that stops
// catching its own reason for existing fails here and names itself, instead of
// passing section 1 silently forever.
//
// HERMETIC: the mock Remote is dispatched in-process, the one LLM seam is
// forced down its unconfigured branch with the repo-standard
// `(args) => realFn(args, {isConfigured: () => false})` idiom, and no socket is
// bound — so this file needs no entry in TEST_PORTS.
// ---------------------------------------------------------------------------

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { GATE_SEQUENCE, describeGateLadder } from "../src/uc05/policyEngine.js";
import { handleExpenseSubmission } from "../src/uc02/workflow.js";
import { classifyExpenseRuleBased } from "../src/uc02/expenseClassifier.js";
import { ExpenseStore } from "../src/uc02/expenseStore.js";
import { UNCITED_FINDINGS, NATIONALITY_NOT_HELD, uncitedFinding } from "../src/uc07/decisionSources.js";
import { describeRequesterParties } from "../src/shared/requesterSubject.js";
import { RemoteClient } from "../src/remote/restClient.js";
import { createInProcessFetch } from "../src/remote/mockServer.js";
import { AuditLogger } from "../src/shared/audit.js";
// round-6 D-06/D-15/D-23 — three more places a sentence is actually WRITTEN,
// added to this file for the reason its header gives for the first four: a
// leak caught here is caught at composition, not three surfaces later.
import { describeDecisionFacts } from "../src/uc01/policyEngine.js";
import {
  reasonLabel,
  trackingHint,
  ticketHandoffAlreadyHandled,
  ticketHandoffNotNeeded,
  ticketHandoffNoZendeskConfigured,
  ticketHandoffAssigned,
  ticketHandoffUnassigned,
  ticketHandoffCreationFailed,
  ticketHandoffNoRequestType,
} from "../src/portal/requestStatus.js";
import { identifierVerdict } from "../src/auditview/identifierVerdict.js";
// rca-ee04 — the eighth place, and the one the stand-in below used to cover
// for: src/shared/groupAssignment.js's no-owning-team `skippedReason`, which
// src/portal/server.js now composes THROUGH rather than reimplementing.
import { resolveGroupAssignment } from "../src/shared/groupAssignment.js";
// round-6 S2 (D-07/D-08) — the sixth and seventh places a requester-facing
// sentence is actually WRITTEN: UC-03's gate ladder (shared with the other
// four GATE_SEQUENCE use cases below), and the seven ticket-hand-off notes
// above, which used to be composed inline in src/portal/server.js and
// reachable by nothing in this file at all. See section 6.
import { GATE_SEQUENCE as UC03_GATE_SEQUENCE, describeGateLadder as describeUc03GateLadder } from "../src/uc03/policyEngine.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const read = (relative) => readFileSync(join(__dirname, "..", relative), "utf8");

// ---------------------------------------------------------------------------
// THE VOCABULARY THAT IS THIS SYSTEM TALKING ABOUT ITSELF
// ---------------------------------------------------------------------------
// Each rule names the sentence it exists for. A rule is added when a real
// string tripped it for a reason — never to tidy a spelling — and section 2
// requires that string to still trip it.

const RULES = [
  {
    // "…the case carries what that statute says about a short notice
    // (src/uc05/decisionSources.js)", on the screen of somebody who has just
    // handed in their notice.
    name: "a path into this repository",
    test: /\b(?:src|docs|test|tests|workflows|scripts|zaf-app|deploy)\/[A-Za-z0-9_.-]/,
  },
  {
    // The same defect without the directory in front of it. A module name is a
    // thing only somebody with this checkout can open.
    name: "a source-file name",
    test: /\b[A-Za-z0-9_-]+\.(?:js|mjs|cjs|ts|md|json|sql|yml|yaml)\b/,
  },
  {
    // "UC-05 has no write path to Remote at all." This repository's own index
    // for its own use cases: it appears in the roadmap, the build log and nine
    // directory names, and nowhere any of these four readers has ever been.
    name: "a use-case index",
    // CASE-INSENSITIVE, and it did not used to be. This codebase writes its
    // own use-case numbering lowercase in prose ("no uc03 request type…") as
    // often as it writes it the way the roadmap does ("UC-03"), and a rule
    // that only caught the capitalised spelling let the lowercase one straight
    // through — see WAS_LEAKING below for the real sentence that proved it.
    test: /\bUC-?0\d\b/i,
  },
  {
    // `work_meals_and_entertainment.external_meals_and_entertainment` in the
    // middle of a claimant's refusal, and `NATIONALITY_NOT_HELD` in a
    // specialist's. Two or more words run together in a spelling nobody says
    // out loud.
    name: "a snake_case or SCREAMING_SNAKE identifier",
    test: /\b[a-z0-9]+(?:_[a-z0-9]+)+\b|\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/,
  },
  {
    // "…the case carries what that statute says (decisionSources)". The same
    // thing again in the spelling our functions and fields use.
    name: "a camelCase identifier",
    test: /\b[a-z]+[A-Z][A-Za-z]*\b/,
  },
  {
    // "Signing off a report reading `null`", "the request's own
    // `transferAllowed` input". Backticks around a token are this codebase
    // quoting its own source at a reader who cannot open it.
    name: "a backticked identifier",
    test: /`[^`]+`/,
  },
  {
    // "Filed by admin_jane about employment 3537d9ee-2017-4a53-952e-…". A
    // record id is a REAL and useful handle — it is what somebody quotes into
    // Remote — but inside a sentence it is unreadable, so it belongs on its own
    // labelled field. See section 5.
    name: "a bare record id inside a sentence",
    test: /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i,
  },
  {
    // round-6 D-15: "...nobody by this reference exists at all (VC-33)." VC-33
    // is an id into qa/contracts/UC-01-acceptance.md — this project's OWN
    // acceptance-criterion numbering, not something a caseworker with no
    // repository has ever seen. "Invariant 14" is the same shape one register
    // over (CLAUDE.md §3's numbered prime directives).
    name: "an acceptance-criterion or invariant citation",
    test: /\bVC-\d+\b|\binvariant\s+\d+\b/i,
  },
];

/**
 * A money figure with nothing saying what money it is.
 *
 * Kept OUT of `RULES` and applied only where a sentence is known to be about
 * money, because a bare decimal is ordinary in prose that is not ("23 days",
 * "0.9 confidence") and a rule that fires on those would be turned off. Where
 * it does apply it is the money rule this repository already runs on: a wrong
 * figure gets acted on, a missing one gets investigated — and a reader shown
 * `2618.18` supplies a currency from context and may supply the wrong one.
 */
const UNDENOMINATED_AMOUNT = /(?<![A-Z]{3}\s)\b\d[\d,]*\.\d{2}\b(?!\s*(?:[A-Z]{3}\b|%|[€$£]))/;

/** The rules a piece of text trips, as their names. */
function tripped(text, rules = RULES) {
  return rules.filter((rule) => rule.test.test(String(text ?? ""))).map((rule) => rule.name);
}

/**
 * ROUND-6 S2 (D-07/D-08) — THE SECOND QUESTION RULES DELIBERATELY DOES NOT ASK.
 *
 * Every rule in RULES above answers "is this system talking about itself?" —
 * a question with the SAME right answer wherever a sentence appears: a path,
 * a `snake_case` identifier and this project's own `UC-0N` numbering are
 * meaningless to every reader this file guards, so banning them everywhere is
 * safe. D-07 and D-08 failed a different question, and it does NOT have the
 * same answer everywhere: "the employee" is exactly correct on the
 * specialist's screen (src/uc03/policyEngine.js's `means` field reaches BOTH
 * the specialist's ticket and the employee's own result page unchanged — see
 * the comment on that gate array — and "naming nobody" is how D-07's second
 * site was fixed there, not a pronoun swap) and wrong only on the one screen
 * where the reader IS "the employee".
 *
 * So this array is applied to ONE enumerated, narrow surface below — never to
 * RULES, never globally — the complete set of composers this repository has
 * verified reach nobody but the person who filed the request:
 * `trackingHint()` and the seven `ticketHandoff*()` functions
 * (src/portal/requestStatus.js). src/portal/server.js's raiseTicketIfNeeded()
 * and handOffLetterRequest() route every one of these onto
 * `payload.ticketNote`, rendered verbatim by src/portal/assets/app.js with no
 * filter — and buildTicketNote() is a SEPARATE function, composing a
 * SEPARATE string, for the specialist's Zendesk note; nothing here is shared
 * with it. Running this array over a GATE_SEQUENCE `means` field or any other
 * string a specialist also reads would be exactly the global blocklist this
 * bead's own instructions forbid — this array's safety comes entirely from
 * being scoped to a surface with only one possible reader, not from the
 * patterns themselves being universally safe to ban.
 */
const SUBJECT_OWN_SCREEN_RULES = [
  {
    // D-07's first site, verbatim: "...is where THEIR answer will appear...
    // nothing else will notify YOU" — third person and second person about
    // the same reader in one sentence. On a surface with exactly one possible
    // reader, there is no legitimate "their/them/they" left to protect.
    name: "a third-person pronoun about the reader, on their own screen",
    test: /\b(their|them|they)\b/i,
  },
  {
    // D-07's second site: "...which country THE EMPLOYEE is travelling
    // to..." Scoped the same way — this exact phrase is CORRECT and untouched
    // on src/uc03/policyEngine.js's shared `means` field, which this array is
    // never run over.
    name: "a third-person role name for the reader, on their own screen",
    test: /\bthe (employee|requester|traveller|traveler|claimant|filer)\b/i,
  },
  {
    // D-08, verbatim: "The ZAF sidebar finds this record by that ticket id."
    // No path, no identifier, no snake_case — RULES cannot see this at all.
    // It is a staff tool's name, given as an instruction to a reader who has
    // never seen a ZAF sidebar and cannot open one.
    name: "an internal tool named as if the reader can open it",
    test: /\b(ZAF sidebar|the ZAF app|the audit log|the review queue|the queue viewer)\b/i,
  },
];

// ---------------------------------------------------------------------------
// 1. THE GUARD
// ---------------------------------------------------------------------------

test("UC-05's gate ladder explains an outcome without naming this system's parts", () => {
  // Driven through describeGateLadder() rather than read off GATE_SEQUENCE, so
  // this is the array the API and the portal actually publish.
  const offences = [];
  let checked = 0;
  for (const rung of GATE_SEQUENCE) {
    for (const row of describeGateLadder(rung.reason)) {
      checked += 1;
      for (const name of tripped(row.means)) {
        offences.push(`${row.reason}'s means carries ${name}: ${String(row.means).slice(0, 180)}`);
      }
    }
  }
  assert.ok(checked >= GATE_SEQUENCE.length, "the ladder is not being reached");
  assert.deepEqual(offences, [], `\n  ${[...new Set(offences)].join("\n  ")}`);
});

// round-6 S2 — UC-03's own gate ladder never had a test at all. The mayor's
// dispatch note on this bead measured the gap precisely: "src/uc03/
// policyEngine.js appears nowhere" in this file's imports, even though four
// sibling GATE_SEQUENCE modules (UC-05 above, UC-02/UC-04/UC-09 via their own
// files) were already covered. Same shape as the UC-05 test above, for the
// module D-07's second site actually lives in.
test("UC-03's gate ladder explains an outcome without naming this system's parts", () => {
  const offences = [];
  let checked = 0;
  for (const rung of UC03_GATE_SEQUENCE) {
    for (const row of describeUc03GateLadder(rung.reason)) {
      checked += 1;
      for (const name of tripped(row.means)) {
        offences.push(`${row.reason}'s means carries ${name}: ${String(row.means).slice(0, 180)}`);
      }
    }
  }
  assert.ok(checked >= UC03_GATE_SEQUENCE.length, "the ladder is not being reached");
  assert.deepEqual(offences, [], `\n  ${[...new Set(offences)].join("\n  ")}`);
});

test("UC-07 tells a specialist what it could not source without naming a file", () => {
  const offences = [];
  const scan = (where, entry) => {
    if (!entry) return;
    for (const [field, text] of [
      ["label", entry.label],
      ["why", entry.why],
    ]) {
      for (const name of tripped(text)) {
        offences.push(`${where}.${field} carries ${name}: ${String(text).slice(0, 180)}`);
      }
    }
  };

  // Every recorded absence, by its own key.
  for (const key of Object.keys(UNCITED_FINDINGS)) scan(key, uncitedFinding(key));

  // And the two COMPUTED absences, which are the ones a real route wanders into:
  // a destination this corpus holds no immigration instrument for, and a route
  // pair it holds no residence or social-security instrument for. BR→JP is
  // chosen because it is in neither set, so both sentences are really produced —
  // and each is asserted non-null, because uncitedFinding() answers null for a
  // finding it HAS sourced and a silent null would make this sweep vacuous.
  for (const key of [
    "UC07_RIGHT_TO_WORK_MISSING",
    "UC07_IMMIGRATION_REQUIRED",
    "UC07_SALARY_BELOW_VISA_MINIMUM",
    "tax_residency_change",
    "UC07_TAX_RESIDENCY_REVIEW_REQUIRED",
    "social_security_on_permanent_move",
  ]) {
    const computed = uncitedFinding(key, { sourceCountry: "BR", destinationCountry: "JP" });
    assert.ok(computed, `${key} produced no absence for an unsourced route — this sweep is not reaching it`);
    scan(key, computed);
  }

  // The nationality statement is published as an `uncited[].why` too —
  // src/uc07/dossierView.js hands it over under exactly that key — so it is held
  // to exactly the same rule as the entries above.
  scan("the nationality statement", { label: null, why: NATIONALITY_NOT_HELD.statement });

  assert.deepEqual(offences, [], `\n  ${offences.join("\n  ")}`);
});

test("UC-02's cap comparison is a money comparison, not a category key", async () => {
  const { capComparison } = await overCapSubmission();
  assert.ok(capComparison, "the over-cap fixture no longer produces a cap comparison");
  assert.deepEqual(
    tripped(capComparison.sentence),
    [],
    `the claimant's own refusal speaks this system's language: ${capComparison.sentence}`
  );
});

test("requesterSubject's sentences carry no path, no file and no use-case index", () => {
  // The four shapes it can produce, driven rather than described: an
  // authenticated filer who IS the subject, one who is not, the literal
  // 'unauthenticated' marker, and a row with the field missing altogether.
  const cases = [
    { filerId: "3537d9ee-2017-4a53-952e-3d3b042aeab5", subjectEmploymentId: "3537d9ee-2017-4a53-952e-3d3b042aeab5", identityVerified: true },
    { filerId: "admin_jane", subjectEmploymentId: "3537d9ee-2017-4a53-952e-3d3b042aeab5", identityVerified: true },
    { filerId: "unauthenticated", subjectEmploymentId: "e1", identityVerified: false },
    { filerId: null, subjectEmploymentId: null, identityVerified: false },
  ];
  const offences = [];
  for (const args of cases) {
    const parties = describeRequesterParties({ ...args, source: "zendesk", externalRef: "51" });
    // THE MODULE'S OWN WORDS, NOT THE VALUES IT WAS HANDED. An actor id really
    // is spelled `admin_jane` and an employment id really is a UUID; both are
    // DATA off the stored row, and refusing them here would be refusing the
    // record rather than the vocabulary. So every value this call was given is
    // masked out first, and what is left is the sentence this file wrote.
    const mask = (text) =>
      [args.filerId, args.subjectEmploymentId, "zendesk", "51"]
        .filter(Boolean)
        .reduce((acc, value) => acc.split(String(value)).join("…"), String(text ?? ""));
    for (const [block, value] of Object.entries(parties)) {
      for (const name of tripped(mask(value.finding))) {
        offences.push(`${block}.finding carries ${name}: ${value.finding}`);
      }
    }
  }
  assert.deepEqual(offences, [], `\n  ${offences.join("\n  ")}`);
});

// ---------------------------------------------------------------------------
// round-6 D-15 — UC-01's decisionFacts bundle, read by the ZAF sidebar and
// stamped into every note built from it (src/uc01/workflow.js's
// formatFactsForNote()). A caseworker with no repository access was shown
// "...nobody by this reference exists at all (VC-33)." — VC-33 is a row in
// this project's OWN acceptance contract, not a fact about the case.
//
// SCOPED TO THE ONE RULE D-15 WAS ABOUT, deliberately, not the full RULES
// sweep the tests above run. Several of these facts already, and correctly,
// carry an internal reason CODE alongside a sentence explaining what it means
// (`third_party_with_consent means a granted, complete consent record was
// present…`) — the same accepted shape UC-02's "the slug still travels"
// convention uses elsewhere, and not what D-15 was filed against. Running the
// full snake_case sweep here would fail on that established, explained
// pattern rather than on the defect: a caseworker being pointed at this
// project's OWN acceptance-criterion numbering.
// ---------------------------------------------------------------------------
test("UC-01's decisionFacts explain a refusal without citing this contract's own criterion ids", () => {
  const CRITERION_RULE = RULES.filter((r) => r.name === "an acceptance-criterion or invariant citation");
  const offences = [];
  const scenarios = [
    { reason: "consent_refused", classification: { requestingParty: "First Bank", purpose: "mortgage check" }, identity: { consentRecordId: "cr-1" } },
    { reason: "awaiting_employee_consent", classification: { requestingParty: "First Bank", purpose: "mortgage check" }, identity: { consentRecordId: "cr-2" } },
    { reason: "third_party_request", classification: { requesterType: "third_party", source: "llm" }, identity: { reason: "third_party_with_consent", consentRecordId: "cr-3" } },
  ];
  for (const { reason, classification, identity } of scenarios) {
    const bundle = describeDecisionFacts({ reason, classification, identity });
    assert.ok(bundle, `describeDecisionFacts() produced nothing for ${reason} — this sweep is not reaching it`);
    for (const name of tripped(bundle.sentence, CRITERION_RULE)) {
      offences.push(`${reason}.sentence carries ${name}: ${bundle.sentence}`);
    }
    for (const f of bundle.facts) {
      for (const field of ["label", "value", "note"]) {
        for (const name of tripped(f[field], CRITERION_RULE)) {
          offences.push(`${reason}.facts[${f.label}].${field} carries ${name}: ${f[field]}`);
        }
      }
    }
  }
  assert.deepEqual(offences, [], `\n  ${offences.join("\n  ")}`);
});

// ---------------------------------------------------------------------------
// round-6 D-06 — src/portal/requestStatus.js's reasonLabel(), which every
// requester-facing sentence and the "My requests" Reason column now read
// instead of a store's raw gate reason (`over_policy_cap`, `destination_
// unknown`, `self_service_all_gates_passed`, …).
// ---------------------------------------------------------------------------
test("requestStatus.js's reasonLabel() never returns this system's own gate vocabulary", () => {
  // A representative sweep across all nine use cases' reason vocabularies —
  // not exhaustive, but wide enough that a label built by simple string
  // surgery (e.g. `.replace('_', ' ')` on only the first underscore) would be
  // caught, and wide enough to include a code this table was NOT told a
  // phrase for, so the mechanical fallback is exercised too.
  const reasons = [
    "over_policy_cap", "expense_employment_mismatch", "destination_unknown",
    "self_service_all_gates_passed", "letter_scope_exceeded", "low_confidence",
    "sanctioned_region", "identity_not_verified", "no_statutory_notice_period",
    "cutoff_lock_passed", "high_risk_adjustment_needs_triple_approval",
    "a_future_reason_this_table_has_never_seen",
  ];
  const offences = [];
  for (const reason of reasons) {
    const label = reasonLabel(reason);
    assert.ok(label, `reasonLabel(${reason}) returned nothing`);
    for (const name of tripped(label)) {
      offences.push(`reasonLabel(${reason}) carries ${name}: ${label}`);
    }
  }
  assert.deepEqual(offences, [], `\n  ${offences.join("\n  ")}`);
});

// ---------------------------------------------------------------------------
// round-6 D-23 — src/auditview/identifierVerdict.js, rendered to an
// operations reviewer with no repository. Its remediation for a value found
// under an unregistered key used to read "adding it to AUDIT_LOG_DETAIL_KEYS
// / AUDIT_TRACE_DETAIL_KEYS in src/auditview/identifiers.js …".
// ---------------------------------------------------------------------------
test("identifierVerdict()'s remediation never tells its reader to go and edit source", () => {
  const verdict = identifierVerdict({
    value: "some-value-42",
    shape: { code: "unknown", label: "an identifier", meaning: "" },
    searched: ["a", "b", "c"],
    matches: [],
    decisions: [],
    traces: [],
    claims: [],
    alerts: [],
    unregistered: [{ table: "audit_log", key: "someOtherField", rows: 3 }],
    exhaustiveScanRan: true,
    rowCap: 50,
  });
  assert.equal(verdict.code, "found_under_unregistered_key", "this fixture is not reaching the branch D-23 was found on");
  // Scoped to `nextSteps` — D-23's own surface — and not `headline`/`detail`,
  // which legitimately name this tool's own observability tables
  // (`audit_log`, `workflow_claims`, …) to the ops reader who has to know
  // them to use it; that is domain vocabulary this reader needs, not a leak,
  // and asserting against it here would make this test fail on the tool
  // doing its job rather than on the defect it exists to catch.
  const offences = [];
  for (const step of verdict.nextSteps) {
    for (const name of tripped(step)) {
      offences.push(`nextSteps carries ${name}: ${step}`);
    }
  }
  assert.deepEqual(offences, [], `\n  ${offences.join("\n  ")}`);
});

// ---------------------------------------------------------------------------
// 2. THE PROOF THAT SECTION 1 IS NOT VACUOUS
// ---------------------------------------------------------------------------
// A guard that passes because it can no longer see anything is worse than no
// guard: it reports clean forever and nobody re-reads it. Every string below is
// the REAL sentence the named module published before this change — taken from
// the commit, not written to order — and the rule it exists for must still
// catch it.

const WAS_LEAKING = [
  {
    was: "src/uc05/policyEngine.js · statutory_discrepancy",
    text: "the case carries what that statute says about a short notice (src/uc05/decisionSources.js). This is not an arithmetic error",
    rule: "a path into this repository",
  },
  {
    was: "src/uc05/policyEngine.js · statutory_discrepancy",
    text: "the case carries what that statute says about a short notice (src/uc05/decisionSources.js).",
    rule: "a source-file name",
  },
  {
    was: "src/uc05/policyEngine.js · all_gates_passed",
    text: "signing off records the report, it does not execute a termination — UC-05 has no write path to Remote at all.",
    rule: "a use-case index",
  },
  {
    was: "src/uc05/policyEngine.js · pto_balance_unusable",
    text: "Signing off a report reading `null` would invite exactly the reading the money rules exist to prevent",
    rule: "a backticked identifier",
  },
  {
    was: "src/uc05/policyEngine.js · the escalation-team fallback",
    text: "The team that owns UC-05 escalations (none is defined in src/shared/escalationRouting.js, which is itself the finding)",
    rule: "a path into this repository",
  },
  {
    was: "src/uc02/workflow.js · the cap comparison",
    text: "880.00 USD claimed against a 300.00 USD cap for work_meals_and_entertainment.external_meals_and_entertainment — over by 580.00 USD (193.3% over).",
    rule: "a snake_case or SCREAMING_SNAKE identifier",
  },
  {
    was: "src/uc07/decisionSources.js · UC07_PE_RISK_REVIEW_REQUIRED",
    text: "docs/knowledge/layer-1-statutory/L1-01-L1-11-oecd-citation-register.md is a register of article numbers",
    rule: "a path into this repository",
  },
  {
    was: "src/uc07/decisionSources.js · UC07_PTO_TRANSFER_NOT_ALLOWED",
    text: "The liquidation decision here rests on the request's own `transferAllowed` input, not on a read of any law.",
    rule: "a backticked identifier",
  },
  {
    was: "src/uc07/decisionSources.js · nationality_not_held",
    text: "See NATIONALITY_NOT_HELD, which is stated on every dossier carrying an immigration citation.",
    rule: "a snake_case or SCREAMING_SNAKE identifier",
  },
  {
    was: "src/portal/server.js · the UC-07 PTO line",
    text: "LIQUIDATE (18 days liquidated; cashout 2618.18)",
    rule: null, // money, checked below rather than by RULES
  },
  {
    // round-6 D-15, verbatim from src/uc01/workflow.js before this pass.
    was: "src/uc01/workflow.js · the third-party hand-off note's action line",
    text: "the requester on this ticket is the door itself, never the third party who actually asked (VC-33), so nothing is sent to them automatically.",
    rule: "an acceptance-criterion or invariant citation",
  },
  {
    // round-6 D-15, verbatim from src/uc01/workflow.js before this pass.
    was: "src/uc01/workflow.js · the third-party hand-off note",
    text: "The requesting party is never shown this ticket or anything about it (VC-33) — they were sent one fixed acknowledgement regardless of what this decided.",
    rule: "an acceptance-criterion or invariant citation",
  },
  {
    // round-6 D-15, verbatim from src/uc01/policyEngine.js:599 before this pass.
    was: "src/uc01/policyEngine.js · consent_refused",
    text: "Invariant 14 forbids telling a third party WHY a disclosure did not proceed — the same generic reply is sent whether the employee declined, has not yet answered, or nobody by this reference exists at all (VC-33).",
    rule: "an acceptance-criterion or invariant citation",
  },
  {
    // round-6 D-06, the raw gate reason the portal's "My requests" Reason
    // column and several of requestStatus.js's own sentences printed before
    // reasonLabel() existed — any of the ~85 reason codes this project's nine
    // policy engines return would do; this is the one D-06 was filed against.
    was: "src/portal/server.js · myRequestView()'s raw reason field",
    text: "self_service_all_gates_passed",
    rule: "a snake_case or SCREAMING_SNAKE identifier",
  },
  {
    // round-6 D-23, verbatim from src/auditview/identifierVerdict.js before
    // this pass.
    was: "src/auditview/identifierVerdict.js · found_under_unregistered_key",
    text: "If that key really does carry an identifier, adding it to AUDIT_LOG_DETAIL_KEYS / AUDIT_TRACE_DETAIL_KEYS in src/auditview/identifiers.js makes the next lookup find it directly.",
    rule: "a path into this repository",
  },
  {
    // round-6 S2 — the live rule bug the mayor's dispatch note measured on
    // this bead: the use-case-index rule was case-SENSITIVE, so this exact
    // string (src/portal/server.js's handOffLetterRequest(), before this
    // pass) shipped a lowercase "uc03" to a requester and passed every run.
    // This codebase writes its own use-case numbering lowercase in prose as
    // often as it writes "UC-03" the way the roadmap does — kept here,
    // frozen, so the `i` flag added to that rule keeps having to catch its
    // own reason for existing.
    was: "src/portal/server.js · handOffLetterRequest()'s no-request-type fallback, before the `i` flag",
    text: "No Zendesk ticket: the portal has no uc03 request type to raise one against. The letter decision is recorded and audited.",
    rule: "a use-case index",
  },
  {
    // rca-ee04, verbatim from src/shared/groupAssignment.js's no-owning-team
    // `skippedReason` before this pass — reachable only through
    // src/portal/server.js's own divergent second copy of the same sentence,
    // which is the branch this pass removed by having the portal call
    // resolveGroupAssignment() instead of reimplementing it.
    was: "src/shared/groupAssignment.js · resolveGroupAssignment()'s no-owning-team skippedReason",
    text: "No owning team is defined for UC-04 in src/shared/escalationRouting.js, so this ticket was not assigned to one.",
    rule: "a path into this repository",
  },
  {
    // rca-3yfp (the Mayor's Part B) — verbatim from
    // src/shared/groupAssignment.js's resolveGroupAssignment()'s
    // group-NOT-FOUND `skippedReason`, before THIS pass. rca-ee04 split the
    // no-owning-team branch above and named this branch as the separate,
    // still-deferred leak; test/requesterVocabulary.test.js's own big sweep
    // (section 6) covered it with a clean stand-in rather than the real
    // function for exactly that reason. The routing tags are internal
    // vocabulary (`queue_*`/`escalation_*`), not something a requester who
    // filed a request would recognise.
    was: "src/shared/groupAssignment.js · resolveGroupAssignment()'s group-not-found skippedReason",
    text: 'The Zendesk group "Finance Ops" does not exist in this account, so this ticket was tagged queue_finance_ops, escalation_finance_ops but NOT assigned.',
    rule: "a snake_case or SCREAMING_SNAKE identifier",
  },
];

test("the rules really do catch the sentences they were written for", () => {
  for (const row of WAS_LEAKING) {
    if (!row.rule) continue;
    const names = tripped(row.text);
    assert.ok(
      names.includes(row.rule),
      `the "${row.rule}" rule no longer catches ${row.was} — it caught ${names.length ? names.join(", ") : "nothing"}`
    );
  }
});

test("the money rule catches a settlement figure with no currency, and leaves a denominated one alone", () => {
  // The defect it exists for, verbatim off a UC-07 dossier panel.
  assert.match("LIQUIDATE (18 days liquidated; cashout 2618.18)", UNDENOMINATED_AMOUNT);
  assert.match("TRANSFER (0 days liquidated; cashout 0.00)", UNDENOMINATED_AMOUNT);
  // And what a denominated figure looks like, so the rule cannot be satisfied
  // by deleting the number.
  assert.doesNotMatch("LIQUIDATE (18 days liquidated; cashout 2618.18 EUR)", UNDENOMINATED_AMOUNT);
  assert.doesNotMatch("880.00 USD claimed against a 300.00 USD cap", UNDENOMINATED_AMOUNT);
  assert.doesNotMatch("cashout not derivable — missing daily rate", UNDENOMINATED_AMOUNT);
});

test("and the rules do NOT catch the facts these readers need", () => {
  // The other half of non-vacuity: a rule set that flagged everything would
  // pass the test above and be useless. Every string here is real, and each is
  // a LIMIT, an ABSENCE, a PROVENANCE or a named team — the four classes
  // docs/UI-AUDIENCES.md §5 exempts from the deletion test entirely.
  const KEEP = [
    "This country sets NO statutory minimum notice on a resigning employee — that is a sourced finding about the law, not a gap in our table.",
    "This system does not hold contracts and has not read one.",
    "Local HR & Legal has to decide how the shortfall is handled.",
    "Nothing has been filed with Remote on anyone's behalf: signing off records the report — it does not end the employment.",
    "No source, and the reason is a LICENCE rather than an oversight. The material that governs this is the OECD's Model Tax Convention art. 5 and its Commentary, together with BEPS Action 7.",
    "That is not a finding that the destination has no requirements — it is a statement that this system has never looked, so nothing here can be read as a clearance.",
    "880.00 USD claimed against a 300.00 USD cap for External meals and entertainment — over by 580.00 USD (193.3% over).",
    "RESEARCH SUPPORT ONLY — not a relocation decision or a legal, immigration, or tax determination. For review by a qualified Mobility Legal specialist (Tier-3).",
    "NOT verified. This is a failure to confirm, not a finding that the filer is unauthorised.",
  ];
  for (const value of KEEP) {
    assert.deepEqual(tripped(value), [], `a fact its reader needs would be refused: ${value}`);
  }
});

// ---------------------------------------------------------------------------
// 3. WHAT MUST SURVIVE — the limits, the absences and the provenance
// ---------------------------------------------------------------------------
// Tidying is the cheapest way to delete something load-bearing, and each
// assertion below names a way a reader could be left worse off than before the
// rewrite. Where candour and brevity compete, candour stays.

test("UC-05 still states its two absences, and still names the team", () => {
  const means = (reason) => describeGateLadder(reason).find((r) => r.reason === reason).means;

  // "No rule on file" and "no statutory minimum" are different findings and the
  // ladder used to report them identically.
  assert.match(means("unsupported_country"), /gap in our own table/);
  assert.match(means("no_statutory_notice_period"), /sourced finding about the law/);
  assert.match(means("no_statutory_notice_period"), /does not hold contracts and has not read one/);

  // The shortfall rung keeps the provenance limit that the file path used to
  // sit inside: the statute is carried for SOME countries, not all.
  assert.match(means("statutory_discrepancy"), /where a source for that country's own notice statute has been read/);
  assert.match(means("statutory_discrepancy"), /Local HR & Legal/, "the routed team came off the sentence");

  // And the success rung still says nothing was filed on anybody's behalf.
  assert.match(means("all_gates_passed"), /Nothing has been filed with Remote/);
  assert.match(means("all_gates_passed"), /HR Ops/);
});

test("UC-07 still says WHY each unsourced finding is unsourced", () => {
  const why = (key, scope) => uncitedFinding(key, scope).why;

  // The licence refusal — the sharpest thing in this file, and the one a
  // rewrite would most easily flatten into "no source available".
  assert.match(why("UC07_PE_RISK_REVIEW_REQUIRED"), /LICENCE/);
  assert.match(why("UC07_PE_RISK_REVIEW_REQUIRED"), /never copied/);
  assert.match(why("UC07_PE_RISK_REVIEW_REQUIRED"), /has NOT read|were not retrieved/);
  assert.match(why("UC07_PE_RISK_REVIEW_REQUIRED"), /least sourced finding this dossier produces/);
  // WHICH register, and published by whom — the substance the file path was
  // standing in for.
  assert.match(why("UC07_PE_RISK_REVIEW_REQUIRED"), /OECD/);
  assert.match(why("UC07_PE_RISK_REVIEW_REQUIRED"), /article NUMBERS/);

  // The strongest gate in the dossier still admits it rests on no authority.
  assert.match(why("UC07_SOURCE_OFFBOARDING_NOT_AUTHORIZED"), /not from any authority/);
  assert.match(why("UC07_SOURCE_OFFBOARDING_NOT_AUTHORIZED"), /strongest thing in the dossier/);

  // An unsourced destination is never a clearance.
  const destination = why("UC07_IMMIGRATION_REQUIRED", { destinationCountry: "JP" });
  assert.match(destination, /not a finding that the destination has no requirements/);
  assert.match(destination, /nothing here can be read as a clearance/);

  // And the nationality limit is stated in full, not summarised away.
  assert.match(NATIONALITY_NOT_HELD.statement, /NEVER as a statement about this person's route/);
  assert.match(NATIONALITY_NOT_HELD.statement, /no such field anywhere in it/);
});

// ---------------------------------------------------------------------------
// 4. ROUTED, NOT DELETED
// ---------------------------------------------------------------------------
// The half that makes section 1 safe to enforce anywhere. Remote's category key
// is the string Finance Ops types to open the claim, so it has to keep
// travelling — off the sentence and onto the structured field beside it, the
// same split src/portal/server.js's specialistDetail() makes one layer out.

test("UC-02: the category key leaves the sentence and stays on the record", async () => {
  const { capComparison, expected } = await overCapSubmission();

  assert.equal(
    capComparison.categoryId,
    expected.categoryId,
    "the category key was deleted rather than routed — Finance Ops cannot open the claim"
  );
  assert.ok(
    !capComparison.sentence.includes(expected.categoryId),
    `the key is still in the claimant's sentence: ${capComparison.sentence}`
  );
  // The category is still NAMED, by the title Remote publishes for it — the
  // claimant is told which cap they hit, they are just not told it in an enum.
  assert.ok(capComparison.categoryTitle, "the sentence no longer says which category the cap belongs to");
  assert.ok(capComparison.sentence.includes(capComparison.categoryTitle));

  // AND THE FIGURES THAT ARE THEIRS STAY. A cap refusal without the amount, the
  // cap and the overage is the thing a tester had to ask about (C-27).
  for (const figure of [capComparison.amount, capComparison.cap, capComparison.overage]) {
    assert.ok(figure, "a cap refusal lost one of its three figures");
    assert.ok(capComparison.sentence.includes(figure));
  }
});

test("UC-02: the title is READ from Remote's category row, never spelled out of the code", () => {
  // The one way this fix could go wrong is by turning
  // `external_meals_and_entertainment` into "External meals and entertainment"
  // with a string transform — inventing a name Remote does not use, which a
  // claimant would then quote at Finance Ops and nobody would find. So the
  // source is checked for the shape of that mistake.
  const source = read("src/uc02/workflow.js")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");
  assert.match(source, /findSelectableCategory\(list, code\)/, "the title is no longer looked up on the real row");
  assert.ok(
    !/categoryId\s*\.\s*replace|code\s*\.\s*replace|\.split\("_"\)/.test(source),
    "the category name is being derived from the code rather than read off Remote's row"
  );
});

// ---------------------------------------------------------------------------
// 5. THE ONE ID THAT IS ALLOWED TO EXIST, AND WHERE
// ---------------------------------------------------------------------------
// `describeRequesterParties()` is handed two ids and no name — it is pure, it
// takes no client, and the display name lives on a SIBLING call
// (src/shared/employeeSubject.js) made by each API handler. So the id in
// `actingFor.finding` is not something this module can replace with a person
// today, and the rule that matters meanwhile is the one below: an id may be a
// labelled field, and every finding must still be readable without it.

test("an id is on a labelled field, and the sentences read without one", () => {
  const parties = describeRequesterParties({
    filerId: "admin_jane",
    subjectEmploymentId: "3537d9ee-2017-4a53-952e-3d3b042aeab5",
    identityVerified: true,
    source: "portal",
    externalRef: "2004",
  });

  // The filer's id is a FIELD, which is where a renderer labels it.
  assert.equal(parties.filedBy.id, "admin_jane");
  // The comparison this module exists to make is still stated in words: whether
  // the person who filed is the person it is about.
  assert.equal(parties.actingFor.state, "on_behalf_of_the_subject");
  assert.match(parties.actingFor.finding, /acting on someone else's record/);
  // And what "verified" proved — the sentence this whole module was written for
  // — is unchanged and carries no id at all.
  assert.match(parties.identity.finding, /authorisation to act/);
  assert.deepEqual(tripped(parties.identity.finding), []);
});

// ---------------------------------------------------------------------------
// 6. THE SECOND QUESTION — ADDRESS AND AUDIENCE, ON THE SUBJECT'S OWN SCREEN
// ---------------------------------------------------------------------------
// round-6 S2 — D-07/D-08. SUBJECT_OWN_SCREEN_RULES (defined above, beside
// RULES) is run over the complete enumerated surface it is safe for: the
// eight sentence-composers this repository has verified reach nobody but the
// person who filed the request. Every one is now a real export
// (src/portal/requestStatus.js) rather than a string composed inline where no
// guard could reach it — the reach gap the mayor's dispatch note measured
// directly ("D-07 and D-08 contain no identifier at all... RULES cannot see
// this family, and it is not because somebody forgot an import").

test("trackingHint() and the seven ticket hand-off notes never speak about their own reader in the third person, or point them at a tool only a specialist can open", async () => {
  // rca-ee04 — THE REAL FUNCTION, NOT A STAND-IN, for the no-owning-team
  // branch. `src/portal/server.js` used to compose this sentence a second
  // time by hand, and that second copy is what drifted and printed
  // `src/shared/escalationRouting.js` plus this project's own `UC-04` onto a
  // requester's result panel after the shared module's had already been
  // fixed. The portal now calls `resolveGroupAssignment()` for every branch,
  // so its real output — not a clean fixture — is what this sweep checks.
  const noOwningTeam = await resolveGroupAssignment({ handoff: null, zendesk: null, useCase: "UC-04" });

  // rca-3yfp — THE REAL FUNCTION for the group-NOT-FOUND branch too, which
  // rca-ee04 named as a separate, still-deferred leak and this bead closes.
  // A `zendesk` whose `listGroups()` answers successfully with a list that
  // does not contain the handed-off group name is what actually drives this
  // branch — a lookup that THREW (missing scope, network) is the OTHER
  // branch, and does not carry the tag list at all. Every production caller's
  // ZendeskClient requests only `tickets:read tickets:write` (never
  // `groups:read`), so a live 200 with a non-matching group list needs the
  // account's groups to have genuinely drifted from `escalationRouting.js`'s
  // names — reachable, but not the everyday path; the synced-id cache in
  // src/shared/escalationGroupIds.js is what the everyday scope-403 path
  // falls back to instead, and this branch is not exercised by it.
  const groupNotFound = await resolveGroupAssignment({
    handoff: { group: "Finance Ops", tags: ["queue_finance_ops", "escalation_finance_ops"], escalated: true },
    zendesk: { listGroups: async () => [] },
    useCase: "UC-02",
  });

  const subjectOwnScreenStrings = [
    // trackingHint() — its three reachable branches: waiting on a person,
    // finished on submission, and the 🔴 no-execution-path pointer.
    trackingHint({ decision: "human_review", executionPath: "sync", recordId: "r1", recordLabel: "expense" }).sentence,
    trackingHint({ decision: "auto_resolve", executionPath: "sync", recordId: "r1", recordLabel: "expense" }).sentence,
    trackingHint({ decision: "human_review", executionPath: "none", recordId: "r1", recordLabel: "dossier" }).sentence,
    // The seven raiseTicketIfNeeded()/handOffLetterRequest() notes.
    ticketHandoffAlreadyHandled(),
    ticketHandoffNotNeeded({ ticketable: true }),
    ticketHandoffNotNeeded({ ticketable: false }),
    ticketHandoffNoZendeskConfigured(),
    ticketHandoffAssigned({ ticketId: "2000", group: "Mobility Specialists", priority: "normal", dueAt: null }),
    ticketHandoffAssigned({ ticketId: "2001", group: "Finance Ops", priority: "urgent", dueAt: "2026-09-01" }),
    // THE NO-OWNING-TEAM BRANCH, rca-ee04's fix, driven for real above.
    ticketHandoffUnassigned({ ticketId: "2002", skippedReason: noOwningTeam.skippedReason }),
    // THE GROUP-NOT-FOUND BRANCH, rca-3yfp's fix, driven for real above too —
    // the stand-in that used to sit here is gone. Its being gone IS the proof
    // this leak closed: a stand-in surviving next to a "fixed" claim is
    // exactly how the earlier round of this same defect (rca-ee04's own
    // no-owning-team branch) stayed covered by a fixture instead of the
    // function for as long as it did.
    ticketHandoffUnassigned({ ticketId: "2003", skippedReason: groupNotFound.skippedReason }),
    ticketHandoffCreationFailed(),
    ticketHandoffNoRequestType(),
  ];
  assert.ok(subjectOwnScreenStrings.every(Boolean), "one of the composers returned nothing — this sweep is not reaching it");

  const offences = [];
  for (const text of subjectOwnScreenStrings) {
    for (const name of [...tripped(text), ...tripped(text, SUBJECT_OWN_SCREEN_RULES)]) {
      offences.push(`carries ${name}: ${text}`);
    }
  }
  assert.deepEqual(offences, [], `\n  ${offences.join("\n  ")}`);
});

/**
 * THE RED-THEN-GREEN PROOF, same shape as WAS_LEAKING (section 2) but for
 * SUBJECT_OWN_SCREEN_RULES, which WAS_LEAKING's own driver test does not run.
 * Each `text` is the REAL sentence a named function published before this
 * pass, quoted from the commit. Per the bead's own instruction, one of these
 * (`ticketHandoffCreationFailed`) is a site the persona did NOT file — D-08 as
 * filed was only src/portal/server.js:1908 — proving the new check catches a
 * sixth instance, not only the one a tester happened to land on.
 */
const WAS_LEAKING_SUBJECT_OWN_SCREEN = [
  {
    was: "src/portal/requestStatus.js · trackingHint()'s awaiting-a-person sentence (D-07, first site)",
    text: "“My requests” is where their answer will appear — this page will not update by itself, and nothing else will notify you.",
    rule: "a third-person pronoun about the reader, on their own screen",
  },
  {
    was: "src/portal/server.js:1908 · raiseTicketIfNeeded()'s assigned note (D-08, as filed)",
    text: "Raised Zendesk ticket #2000 and assigned it to Mobility Specialists (priority normal). The ZAF sidebar finds this record by that ticket id.",
    rule: "an internal tool named as if the reader can open it",
  },
  {
    // NOT the string the persona filed — src/portal/server.js:1945, one of
    // the six the mayor's dispatch note named and warned a seventh-round
    // persona would find if only :1908 were fixed.
    was: "src/portal/server.js:1945 · raiseTicketIfNeeded()'s creation-failed note (not D-08 itself)",
    text: "This decision needs a human, but the Zendesk ticket could not be created. The decision and its audit row ARE recorded — only the hand-off failed, and the failure is itself in the audit log.",
    rule: "an internal tool named as if the reader can open it",
  },
];

test("the subject-own-screen rules really do catch the sentences they were written for", () => {
  for (const row of WAS_LEAKING_SUBJECT_OWN_SCREEN) {
    const names = tripped(row.text, SUBJECT_OWN_SCREEN_RULES);
    assert.ok(
      names.includes(row.rule),
      `the "${row.rule}" rule no longer catches ${row.was} — it caught ${names.length ? names.join(", ") : "nothing"}`
    );
  }
});

test("and SUBJECT_OWN_SCREEN_RULES does not ban the facts and the teams this reader needs", () => {
  // The other half of non-vacuity, same reason section 2's equivalent test
  // exists: a rule set that flagged every sentence on this surface would pass
  // the test above and be useless. "Mobility Specialists" and "Finance Ops"
  // are TEAM NAMES, not a reference to the reader, and must survive.
  const KEEP = [
    ticketHandoffAssigned({ ticketId: "2000", group: "Mobility Specialists", priority: "normal", dueAt: null }),
    "Your travel support letter is saved. Open “My requests” to read it again at any time — it is the same record a specialist works from.",
    "This is already final. Open “My requests” to see it, and anything else you have filed, in one place.",
  ];
  for (const value of KEEP) {
    assert.deepEqual(
      tripped(value, SUBJECT_OWN_SCREEN_RULES),
      [],
      `a fact this reader needs would be refused: ${value}`
    );
  }
});

// ---------------------------------------------------------------------------
// The one real submission this file drives.
// ---------------------------------------------------------------------------

/**
 * The over-cap fixture, through the REAL workflow. In-process fetch, so no
 * socket is bound; the classifier seam runs the real rule-based branch, so
 * production's own fallback is what gets proven and no LLM call is made.
 */
async function overCapSubmission() {
  const remote = new RemoteClient({
    baseUrl: "http://mock.remote.invalid",
    fetchImpl: createInProcessFetch(),
  });
  const expense = await remote.getExpense("exp_sandbox_over_cap_402");
  const employmentId = expense.employment?.id ?? expense.employment_id;

  const result = await handleExpenseSubmission(
    {
      expenseId: "exp_sandbox_over_cap_402",
      employmentId,
      session: { authenticatedEmploymentId: employmentId },
      externalRef: "requester-vocabulary-uc02",
    },
    {
      remote,
      audit: new AuditLogger(),
      expenseStore: new ExpenseStore(),
      classify: (args) => classifyExpenseRuleBased(args),
    }
  );

  assert.equal(result.reason, "over_policy_cap", `the fixture no longer refuses on the cap: ${result.reason}`);
  // The key the classifier really resolved, read back rather than hard-coded,
  // so this cannot pass against a category that has since been renamed.
  return { capComparison: result.capComparison, expected: { categoryId: result.capComparison.categoryId } };
}
