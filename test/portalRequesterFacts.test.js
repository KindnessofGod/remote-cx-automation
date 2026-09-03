// ---------------------------------------------------------------------------
// portalRequesterFacts.test.js  —  who each fact on a result is FOR
// ---------------------------------------------------------------------------
// THE STANDING INSTRUCTION THIS FILE ENFORCES
//
// The project owner, three times, about three different screens: "Stop
// littering info all over the UI that is useless to my user. I already told you
// exactly: design all my UI as if you were the employee, for employee-facing
// UI; admin, for admin-facing UI; or specialist. The info that you need should
// be on there, why the ones you don't need should be?"
//
// The portal's reader is the person who filed the request — about their own
// trip, expense, resignation or relocation. They are not a support agent and
// not an engineer, and they have exactly four questions:
//
//   1. What happened to my request?
//   2. Do I need to do anything?
//   3. If somebody else must act, who, and roughly when?
//   4. If something was produced for me, how do I get it?
//
// A row answering none of the four is litter on their page however true it is.
//
// WHY THIS IS A STRUCTURAL GUARD AND NOT A LIST OF ROWS
//
// The individual rows will keep changing — nine use cases, seven of them on
// this page, each with its own facts, each of which gets rewritten as somebody
// learns something. A test naming the rows would have to be rewritten with
// them, and would say nothing about the row added next week. The RULE does not
// change: an employee has no use for an internal slug, a field name, a file
// path, a gate coordinate, a model, or a decision identifier. So this file
// drives every quick-fill on all seven forms and asserts that no
// requester-facing fact carries that vocabulary — whatever the row is called.
//
// AND IT IS NOT A DELETION RULE. `details` is rendered in TWO places from one
// array: this panel, and the body of the Zendesk internal note a specialist
// opens. Several of the rows an employee has no use for are the SUBSTANCE of
// that hand-off — which gate decided and where it sits in the order, what read
// the request and how sure it was, the provenance of a cited list, the drafted
// summary the specialist is being asked to check. src/portal/server.js
// publishes those through specialistDetail(); forRequester() drops them at the
// response boundary, AFTER the ticket has been built. Section 3 drives a real
// hand-off and reads them back out of the created ticket, so "routed" is proved
// rather than asserted.
//
// NON-VACUITY IS PROVED IN THE FILE, NOT IN A COMMIT MESSAGE. Section 2 runs
// the SAME vocabulary rules over the rows that were routed away, and requires
// that they trip them. A rule set that no longer catches "Decided by gate 12 of
// 16 — Policy cap" is a rule set that has stopped working, and it would then
// fail here instead of quietly passing section 1 forever.
//
// HERMETIC: the mock Remote is dispatched in-process, every LLM seam is faked
// with the repo-standard `(args) => realFn(args, {isConfigured: () => false})`
// idiom, and Zendesk is a capture object. No socket is bound.
// ---------------------------------------------------------------------------

import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { createPortalHandler } from "../src/portal/server.js";
import { createInProcessFetch } from "../src/remote/mockServer.js";
import { RemoteClient } from "../src/remote/restClient.js";
import { AuditLogger } from "../src/shared/audit.js";
import { buildPortalStores } from "../src/portal/wiring.js";

import { classifyTravelInquiryRuleBased } from "../src/uc03/classifier.js";
import { classifyExpenseRuleBased } from "../src/uc02/expenseClassifier.js";
import { parseRelocationRuleBased } from "../src/uc07/relocationParser.js";
import { parseInquiryRuleBased } from "../src/uc08/inquiryParser.js";
import { draftSummary } from "../src/uc04/requestParser.js";
import { extractFromLetter } from "../src/uc05/letterExtractor.js";
import { judgeNarrative } from "../src/shared/narrativeJudge.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP = readFileSync(join(__dirname, "..", "src", "portal", "assets", "app.js"), "utf8");

const unconfigured = { isConfigured: () => false };
const LLM = {
  classifyExpense: classifyExpenseRuleBased,
  classifyTravel: classifyTravelInquiryRuleBased,
  parseRelocation: parseRelocationRuleBased,
  parseInquiry: parseInquiryRuleBased,
  draftSummary: (args) => draftSummary(args, unconfigured),
  extract: (args) => extractFromLetter(args, unconfigured),
  judge: (args) => judgeNarrative(args, unconfigured),
};

// ---------------------------------------------------------------------------
// THE VOCABULARY AN EMPLOYEE HAS NO USE FOR
// ---------------------------------------------------------------------------
// Each rule names the READER-QUESTION it fails, because "this looks technical"
// is a taste and "this answers none of their four questions" is a test. A rule
// is added when a row trips it for a reason, never to tidy a spelling.

const MACHINERY = [
  {
    // "Decided by gate 12 of 16 — Policy cap, which checks that the converted
    // amount is within the category cap." A coordinate in an ordering this
    // repository owns, plus that gate's PASSING condition — which on a refusal
    // states the opposite of what happened unless the reader inverts it.
    name: "a gate coordinate or a gate's passing condition",
    test: /\bgate \d+ of \d+\b|which checks that|gate sequence/i,
  },
  {
    // What produced a reading, rather than what the reading was. The row the
    // owner pointed at by name: "An AI language model read your request in your
    // own words." True, unactionable, and the trip details are printed either
    // way. describeReader() keeps the one half they CAN act on.
    name: "model or infrastructure talk",
    test: /\b(LLM|language model|classifier|embedding|pgvector|webhook|n8n|Supabase|Postgres|endpoint|API)\b/i,
  },
  {
    // A path in a source tree. The gate ladder used to end its explanation with
    // "...is written up in docs/GATES.md", on the screen of somebody who had
    // just filed an expense.
    name: "a path into this repository",
    test: /\b(?:src|docs|test|workflows|scripts)\/[A-Za-z0-9_-]|\.(?:js|mjs|md|json)\b/,
  },
  {
    // "UC-04". This repository's own index: it appears in the roadmap, the
    // build log and nine directory names, and nowhere a person who filed a
    // request has ever been.
    name: "a use-case index",
    test: /\bUC-0\d\b/,
  },
  {
    // A bare identifier — `rule_based_fallback`, `structured_input`,
    // `not_evaluated`, `later_than_statutory`, `REQUIRES_LEGAL_REVIEW`,
    // `eorTransferFee`. Two or more words run together in a spelling nobody
    // says out loud. See KNOWN_LEAKS for the handful of rows whose prose is
    // composed one directory over and cannot be fixed from inside src/portal/.
    name: "a bare identifier",
    test: /\b[a-z0-9]+(?:_[a-z0-9]+)+\b|\b[A-Z0-9]+(?:_[A-Z0-9]+)+\b|\b[a-z]+[A-Z][a-zA-Z]*\b/,
  },
];

/**
 * THE LEAKS THAT COME FROM OUTSIDE THIS CHANGE'S FILES.
 *
 * Some requester-facing rows are prose composed by a use case for its own
 * reader and passed through whole — a policy engine's plain-words `means`, a
 * dossier's narrative, UC-03's informational answer, UC-02's cap comparison.
 * This change owns src/portal/, and rewriting somebody else's sentence from
 * here would put a second copy of it in this file, which is the recurring
 * defect this repository is most expensive at.
 *
 * SO THEY ARE NAMED RATHER THAN EXEMPTED, and each entry says who has to fix
 * it. The test below enforces the list in BOTH directions:
 *
 *   * a violation NOT on the list fails, which is the guard; and
 *   * an entry on the list that no longer fires ALSO fails, so a leak that gets
 *     fixed must be deleted from here rather than sitting as a silent
 *     permission for the next one. A list that only ever grows is a list that
 *     has stopped being read.
 *
 * Every one of these is a real sentence a requester is reading today. Two are
 * worth naming in full because they are not spelling:
 *
 *   * UC-03 tells a traveller "there is no UC-04 queue holding this request to
 *     go and look in" — our roadmap's index, in the sentence explaining their
 *     own outcome.
 *   * UC-05 tells a resigning employee whose notice is short that "the case
 *     carries what that statute says about a short notice
 *     (src/uc05/decisionSources.js)" — a path in a source tree, cited to
 *     somebody who has just handed in their notice.
 */
const KNOWN_LEAKS = [
  // EMPTY, AND THAT IS THE POINT — every entry that was here has been fixed at
  // its source rather than exempted here. What the list held, and who closed it:
  //
  //   "What happened" — a use-case index, a repository path, a bare identifier.
  //     src/uc05/policyEngine.js told a resigning employee their notice was
  //     short and ended the sentence "(src/uc05/decisionSources.js)", and said
  //     "UC-05 has no write path to Remote at all" on the page belonging to
  //     someone who wanted to know what happens to their resignation. Both are
  //     now stated as what is true for that reader — nothing has been filed on
  //     anyone's behalf — with the module name moved into the code comment,
  //     where the only person who can open it is already looking.
  //     src/uc03/policyEngine.js's routing prose was rewritten in the same pass.
  //
  //   "Cap comparison" — a bare identifier. src/uc02/workflow.js embedded
  //     Remote's raw category enum in the sentence telling a claimant their
  //     expense was over the cap. It now names the category by the title Remote
  //     publishes, and the enum travels on the structured field beside it,
  //     which is what Finance Ops opens the claim by.
  //
  //   "Informational answer" and "Narrative" — both were already dead when the
  //     list was audited, which is itself the finding below.
  //
  // KEEP THIS LIST EMPTY IF YOU CAN. An entry is a requester reading our
  // vocabulary today, and its owner field is a work order, not a licence. The
  // assertion below enforces both directions, so an entry that stops firing
  // fails until it is deleted.
];

const leakKey = (label, rule) => `${label} :: ${rule}`;
const KNOWN_LEAK_KEYS = new Set(KNOWN_LEAKS.map((leak) => leakKey(leak.label, leak.rule)));
const KNOWN_LEAK_LABELS = new Set(KNOWN_LEAKS.map((leak) => leak.label));

/** The rules a piece of text trips, as their names. */
function tripped(text, rules) {
  return rules.filter((rule) => rule.test.test(String(text ?? ""))).map((rule) => rule.name);
}

// ---------------------------------------------------------------------------
// THE PAGE'S OWN QUICK-FILLS, DRIVEN THROUGH THE REAL WORKFLOWS
// ---------------------------------------------------------------------------
// SCENARIOS and BUILDERS are lifted out of app.js rather than restated — the
// same technique test/portalResultDialog.test.js and test/portalPlainAnswer
// .test.js use, and for the same reason: a test that wrote its own bodies could
// never disagree with a scenario that had changed.

function liftBlock(opening) {
  const start = APP.indexOf(opening);
  const end = APP.indexOf("\n  };", start);
  assert.ok(start !== -1 && end > start, `${opening} has moved — re-point this test`);
  return APP.slice(start, end + 4);
}

function browserSandbox() {
  let refs = 0;
  const ctx = {
    SCENARIOS: null,
    BUILDERS: null,
    FIELDS: {},
    pendingContinuation: null,
    value: (id) => String(ctx.FIELDS[id] ?? "").trim(),
    orNull: (id) => String(ctx.FIELDS[id] ?? "").trim() || null,
    checked: (id) => ctx.FIELDS[id] === true,
    reference: (typeId) => `${typeId}-facts-${++refs}`,
    freshCopyOf: (expenseId) => expenseId,
  };
  vm.createContext(ctx);
  vm.runInContext(liftBlock("  var SCENARIOS = {").replace("var SCENARIOS =", "SCENARIOS ="), ctx);
  vm.runInContext(liftBlock("  var BUILDERS = {").replace("var BUILDERS =", "BUILDERS ="), ctx);
  return ctx;
}

function call(handler, { path, body }) {
  return new Promise((resolve, reject) => {
    const req = {
      method: "POST",
      url: path,
      headers: {},
      on(event, cb) {
        if (event === "data" && body) cb(Buffer.from(JSON.stringify(body)));
        if (event === "end") setImmediate(cb);
        return req;
      },
    };
    const res = {
      statusCode: 200,
      setHeader() {},
      end(payload) {
        resolve({ status: this.statusCode, body: payload ? JSON.parse(String(payload)) : null });
      },
    };
    handler(req, res).catch(reject);
  });
}

/** A Zendesk that records what it was asked to create. */
function capturingZendesk() {
  const created = [];
  return {
    created,
    async listGroups() {
      return [{ id: 77, name: "Mobility Specialists" }];
    },
    async createTicket(fields) {
      created.push(fields);
      return { id: 4242, ...fields };
    },
    async updateTicket(id, patch) {
      return { ticket: { id, ...patch } };
    },
    async addInternalNote() {},
    async addTags() {},
  };
}

function portal(zendesk = null) {
  const remote = new RemoteClient({ baseUrl: "http://mock.remote.invalid", fetchImpl: createInProcessFetch() });
  return createPortalHandler({ remote, audit: new AuditLogger(), stores: buildPortalStores(), llm: LLM, zendesk });
}

let DRIVEN = null;
async function driveEveryScenario() {
  // Memoised — forty-odd real workflow runs is the expensive part of this file.
  if (DRIVEN) return DRIVEN;
  const ctx = browserSandbox();
  const zendesk = capturingZendesk();
  const handler = portal(zendesk);
  const results = [];
  for (const [typeId, list] of Object.entries(ctx.SCENARIOS)) {
    for (const scenario of list) {
      ctx.FIELDS = scenario.fields || {};
      const body = vm.runInContext(`BUILDERS[${JSON.stringify(typeId)}](${JSON.stringify(scenario.persona ?? "")})`, ctx);
      const res = await call(handler, { path: `/api/requests/${typeId}`, body });
      results.push({ typeId, id: scenario.id, where: `${typeId}/${scenario.id}`, payload: res.body || {} });
    }
  }
  assert.ok(results.length >= 40, `only ${results.length} quick-fills were driven — a form has lost its scenarios`);
  DRIVEN = { results, tickets: zendesk.created };
  return DRIVEN;
}

const decided = (results) => results.filter((r) => r.payload.ok === true);

// ---------------------------------------------------------------------------
// 1. THE GUARD — no requester-facing fact speaks this system's language
// ---------------------------------------------------------------------------

test("no fact on a requester's result carries vocabulary an employee has no use for", async () => {
  const { results } = await driveEveryScenario();
  const offences = [];
  const stillLeaking = new Set();
  let checked = 0;

  for (const r of decided(results)) {
    for (const row of r.payload.details ?? []) {
      checked += 1;
      // THE LABEL TOO, not only the value. "Narrative faithfulness" and
      // "Classifier confidence in the CATEGORY" were both labels first.
      for (const where of [
        { text: row.label, part: "label" },
        { text: row.value, part: "value" },
      ]) {
        for (const name of tripped(where.text, MACHINERY)) {
          if (KNOWN_LEAK_KEYS.has(leakKey(row.label, name))) {
            stillLeaking.add(leakKey(row.label, name));
            continue;
          }
          offences.push(`${r.where} · "${row.label}" ${where.part} carries ${name}: ${String(where.text).slice(0, 160)}`);
        }
      }
    }
  }

  assert.ok(checked >= 100, `only ${checked} rows were examined — the sweep is not reaching the results`);
  assert.deepEqual(
    offences,
    [],
    `${offences.length} requester-facing fact(s) speak this system's language rather than the reader's:\n  ` +
      offences.join("\n  ")
  );

  // AND THE OTHER DIRECTION, WHICH THIS FILE PROMISED AND DID NOT DO.
  //
  // The header says an allowance "fails if it stops firing", so that a fixed
  // leak has to be deleted rather than left as a silent permission. That was
  // the whole argument for keeping a list instead of just widening the rules —
  // and it was never implemented: `stillLeaking` was collected here and never
  // asserted, so every entry was in fact a permanent exemption that no longer
  // had to earn its place.
  //
  // It cost exactly what the header predicted. A later pass closed four of the
  // six leaks in src/uc02/ and src/uc05/, and nothing failed, nothing
  // reported, and the entries sat on describing a state of the world that had
  // stopped being true. The other two had been dead even before that.
  //
  // Now an entry that no longer fires fails HERE, naming itself, so the only
  // way to keep the suite green is to delete it.
  const retired = [...KNOWN_LEAK_KEYS].filter((key) => !stillLeaking.has(key));
  assert.deepEqual(
    retired,
    [],
    `${retired.length} allowance(s) no longer describe anything — the leak is fixed and the permission outlived it. ` +
      `Delete them from KNOWN_LEAKS:\n  ` +
      retired.join("\n  ")
  );
});

test("the same rule holds for the two sentences every result opens with", async () => {
  // The plain answer is the one part of the page a requester is guaranteed to
  // read — it is the title of the dialog every result opens with. It is
  // composed in src/portal/plainAnswer.js from the decision CLASS, so it cannot
  // print a reason slug by construction; this pins that rather than trusting it.
  for (const r of decided((await driveEveryScenario()).results)) {
    const answer = r.payload.plainAnswer ?? {};
    for (const sentence of [answer.lead, answer.next, r.payload.readBy].filter(Boolean)) {
      assert.deepEqual(tripped(sentence, MACHINERY), [], `${r.where}'s opening sentence: ${sentence}`);
    }
  }
});

// ---------------------------------------------------------------------------
// 2. THE PROOF THAT SECTION 1 IS NOT VACUOUS
// ---------------------------------------------------------------------------
// A guard that passes because it can no longer see anything is worse than no
// guard: it reports "clean" forever and nobody re-reads it. So the rules are
// run over the rows that WERE routed away, and are required to catch them.
//
// The rows below are quoted as they were actually published before the split —
// each one is a real string this page printed to a requester — rather than
// invented to trip a regex. If a rule stops matching its own reason for
// existing, this fails and names it.

const ROUTED_AWAY = [
  // The row that prompted the whole instruction.
  { was: "Request read by", value: "an AI language model", rule: "model or infrastructure talk" },
  { was: "Decided by", value: "gate 12 of 16 — Policy cap, which checks that the converted amount is within the category cap", rule: "a gate coordinate or a gate's passing condition" },
  { was: "Category decided by", value: "rule_based_fallback", rule: "a bare identifier" },
  { was: "Date came from", value: "structured_input", rule: "a bare identifier" },
  { was: "Narrative faithfulness", value: "not_evaluated", rule: "a bare identifier" },
  { was: "Routed to", value: "uc04_work_authorization", rule: "a bare identifier" },
  { was: "Inquiry type", value: "dual_residency", rule: "a bare identifier" },
  { was: "Handoff to UC-04", value: "CROSS_BORDER_WORK_REQUESTED — United States → Portugal", rule: "a bare identifier" },
  { was: "the ladder's footnote", value: "written up in docs/GATES.md", rule: "a path into this repository" },
  { was: "the panel head", value: "UC-04 · Work authorization request", rule: "a use-case index" },
];

test("the rules really do catch the rows they were written for", () => {
  for (const row of ROUTED_AWAY) {
    const names = tripped(row.value, MACHINERY);
    assert.ok(
      names.includes(row.rule),
      `the "${row.rule}" rule no longer catches the row it exists for ("${row.was}": ${row.value}) — it caught ${names.length ? names.join(", ") : "nothing"}`
    );
  }
});

test("and they do NOT catch the facts a requester needs", () => {
  // The other half of non-vacuity: a rule set that flagged everything would
  // pass section 2 and be useless. These are real requester-facing values,
  // including the ones that MUST survive — a limit, an absence, a mandatory
  // disclaimer, a named team, a next action.
  const KEEP = [
    "The expense is ABOVE the spend cap for its category, so a person has to authorise it.",
    "0 day(s) over 0 prior trip(s) — no prior stays were stated and none were read from Remote, so this is a floor, not a count",
    "not determined — no statutory rule on file for this country",
    "2026-08-31 — 23 days earlier than the statutory notice period allows. That shortfall is what a person has to decide about.",
    "0.00 EUR — no leave balances are recorded for this employee",
    "RESEARCH SUPPORT ONLY — not a relocation decision or a legal, immigration, or tax determination. For review by a qualified Mobility Legal specialist (Tier-3).",
    "The formal travel letter for this trip has been written and issued. It is yours to open or save.",
    "Remote holds no pending work-authorization request for this employee, so this decision has no Remote counterpart. A request is raised by the employee in Remote's own Request Hub.",
    "Not reached — a hard block decided this request before the rolling-window count was taken. Not a finding that the traveller is within the line; nothing was counted against it.",
    "Please check the trip details below — some of them may have been read incorrectly.",
  ];
  for (const value of KEEP) {
    assert.deepEqual(tripped(value, MACHINERY), [], `a fact the requester needs would be refused: ${value}`);
  }
});

// ---------------------------------------------------------------------------
// 3. ROUTED, NOT DELETED — the specialist's ticket still carries all of it
// ---------------------------------------------------------------------------
// This is the half that makes section 1 safe to enforce. Every row taken off
// the panel is still published; forRequester() is applied at the response
// boundary, after raiseTicketIfNeeded() has composed the note, so the ticket a
// specialist opens is built from the full array.

/** One real hand-off, with the ticket it raised. */
async function handoff(typeId, body) {
  const zendesk = capturingZendesk();
  const res = await call(portal(zendesk), { path: `/api/requests/${typeId}`, body });
  assert.equal(res.body.ok, true, `${typeId} was refused: ${res.body.reason}`);
  assert.equal(res.body.ticketCreated, true, `${typeId} raised no ticket (${res.body.decision}) — this fixture needs one`);
  return { res, note: zendesk.created[0].comment.html_body };
}

const TRIP = {
  persona: "admin",
  employmentId: "09b65526-643b-4956-959b-916e6429bd23",
  homeCountry: "DE",
  nationality: "DE",
  destinationCountry: "ES",
  startDate: "2026-09-01",
  endDate: "2026-09-14",
  visaType: "schengen_short_stay",
  jobDuties: "engineering",
  hasContractSigningAuthority: false,
  reasonText: "Two weeks with the Madrid team.",
  now: "2026-08-15",
  externalRef: "facts-uc04-1",
};

test("UC-04: the rows taken off the panel are all in the specialist's ticket", async () => {
  const { res, note } = await handoff("uc04", TRIP);

  const onPanel = (res.body.details ?? []).map((d) => d.label);
  for (const routed of ["Decided by", "Risk level", "Drafted summary", "Narrative faithfulness", "Remote lookup outcome"]) {
    assert.ok(!onPanel.includes(routed), `"${routed}" is still on the requester's panel`);
  }
  // IN THE NOTE, AS ITS OWN LABELLED ROW. Not merely "the words appear
  // somewhere": buildTicketNote() renders these as a table, and a specialist
  // reads a labelled row.
  for (const routed of ["Decided by", "Risk level", "Drafted summary", "Narrative faithfulness"]) {
    assert.ok(note.includes(`>${routed}</th>`), `"${routed}" reached neither the panel nor the ticket — it was deleted`);
  }
  // And the gate coordinate itself is in there, not just its label.
  assert.match(note, /gate \d+ of \d+ — /, "the specialist lost the gate coordinate");

  // THE REASON SLUG travels too. Its argument was always that it is the string
  // in `audit_log`, in the metrics exception ranking and in the n8n ports — all
  // places a SPECIALIST looks — and it is still on the envelope and in the
  // note's own Reason row.
  assert.ok(res.body.reason, "the slug came off the envelope as well as off the panel");
  assert.ok(note.includes(res.body.reason), "the slug reaches neither the panel nor the ticket");
});

test("UC-03: the hand-off payload reaches the specialist, and names its countries", async () => {
  const { res, note } = await handoff("uc03", {
    persona: "chris",
    text: "I'd like to work remotely from Portugal for a month while on holiday — can I do my normal job from there?",
    externalRef: "facts-uc03-1",
  });

  const onPanel = (res.body.details ?? []).map((d) => d.label);
  for (const routed of ["Handoff to UC-04", "Request read by", "Confidence in that reading", "Routed to"]) {
    assert.ok(!onPanel.includes(routed), `"${routed}" is still on the requester's panel`);
    assert.ok(note.includes(`>${routed}</th>`), `"${routed}" reached neither the panel nor the ticket — it was deleted`);
  }

  // THE SPECIALIST IS NOT AN ENGINEER EITHER. Two properties that were asserted
  // on the panel before the split and have to keep holding one reader further
  // out: the hand-off names its countries rather than coding them, and what
  // read the request is said in words rather than in a source tag.
  assert.match(note, /Portugal/, "the hand-off row prints a destination code to the specialist");
  assert.ok(!/>Handoff to UC-04<\/th><td[^>]*>[^<]*\bPT\b/.test(note), "the hand-off row still prints PT");
  assert.ok(!/rule_based_fallback|\bLLM\b/.test(note), "our engineering vocabulary reached the specialist's note");
});

test("UC-02: the category key and the confidence reach Finance Ops, not the claimant", async () => {
  const { res, note } = await handoff("uc02", {
    persona: "chris",
    expenseId: "exp_sandbox_over_cap_402",
    externalRef: "facts-uc02-1",
  });

  const onPanel = (res.body.details ?? []).map((d) => d.label);
  for (const routed of ["Category", "Category decided by", "Classifier confidence in the CATEGORY", "Expense", "Risk tier recorded", "Decided by"]) {
    assert.ok(!onPanel.includes(routed), `"${routed}" is still on the claimant's panel`);
    assert.ok(note.includes(`>${routed}</th>`), `"${routed}" reached neither the panel nor the ticket — it was deleted`);
  }
  // AND THE FIGURES THAT ARE THEIRS STAY. A cap refusal without the amount, the
  // cap and the overage is the thing a tester had to ask about.
  assert.ok(onPanel.includes("Cap comparison"), "the claimant lost the numbers behind their own refusal");
  assert.ok(onPanel.includes("What happened"), "the claimant lost the plain-words reason");
});

// ---------------------------------------------------------------------------
// 4. WHAT MUST SURVIVE — the limits, the disclaimers, and who has it
// ---------------------------------------------------------------------------
// Tidying is the easiest way to remove something load-bearing, and every rule
// below names a way an employee could be left worse off than before. An
// employee acting on a false completeness is worse off than one reading an
// extra line, so where the two compete the line stays.

test("a stated LIMIT or ABSENCE is never tidied off the requester's panel", async () => {
  const { results, tickets } = await driveEveryScenario();
  const found = { floor: 0, noRule: 0, notCounted: 0, notReached: 0 };

  for (const r of decided(results)) {
    const text = JSON.stringify(r.payload.details ?? []);
    if (/this is a floor, not a count/.test(text)) found.floor += 1;
    if (/not counted|NOT COUNTED/.test(text)) found.notCounted += 1;
    if (/Not reached —/.test(text)) found.notReached += 1;
  }
  // [N-14] "no statutory rule on file for this country" is UC-05's Brazil limit,
  // and since 2026-09-02 it is the SPECIALIST's line, not the requester's: §11 of
  // the acceptance contract withholds the reason for an escalation from the
  // employee while Local HR & Legal is deciding it (the owner's ruling,
  // DRIFT-064). Not tidied off — routed. It is asserted on the note HR Ops
  // opens, which the same drive recorded, so a deletion still fails here.
  const notes = tickets.map((t) => t?.comment?.html_body ?? "").join("\n");
  if (/no statutory rule on file for this country/.test(notes)) found.noRule += 1;

  assert.ok(found.floor > 0, "a cumulative day count with no history behind it no longer says it is a floor");
  assert.ok(found.noRule > 0, "a country with no rule on file no longer says so — to anyone");
  assert.ok(found.notCounted > 0, "an uncounted presence figure no longer says it was not counted");
  assert.ok(found.notReached > 0, "a window that was never measured no longer says it was not reached");
});

test("the mandatory 🔴 framing reaches the requester, verbatim and unshortened", async () => {
  const { results } = await driveEveryScenario();
  const framings = decided(results)
    .filter((r) => r.typeId === "uc07" || r.typeId === "uc08")
    .map((r) => (r.payload.details ?? []).find((d) => d.label === "Framing"));

  assert.ok(framings.length >= 4, `only ${framings.length} dossiers were driven`);
  for (const row of framings) {
    assert.ok(row, "a dossier reached its reader with no framing line at all");
    assert.match(row.value, /^RESEARCH SUPPORT ONLY —/, `the framing was shortened: ${row.value}`);
    assert.match(row.value, /For review by a qualified/, `the framing lost who must review it: ${row.value}`);
  }
});

test("where a request went to a human, the team is named — and named by the routing table", async () => {
  const { results } = await driveEveryScenario();
  const { handoffFor } = await import("../src/shared/escalationRouting.js");
  let named = 0;

  for (const r of decided(results)) {
    const answer = r.payload.plainAnswer;
    // ONLY WHERE SOMEBODY ACTUALLY HAS IT. handoffFor() answers with a routine
    // owner for every decision, including an auto-approval nobody ever looked
    // at — and telling a requester whose expense was approved automatically
    // that "Finance Ops has it" would be the overstatement plainAnswer.js's
    // rule 2 exists to prevent. The three shapes below are where a person
    // genuinely is in the path.
    if (!["waiting", "escalated", "compiled"].includes(answer.shape)) continue;
    const group = handoffFor({ useCase: r.payload.useCase, decision: r.payload.decision })?.group ?? null;
    if (!group) continue;
    named += 1;
    // NEVER A HAND-TYPED NAME. `Local HR Legal` appeared in five places in
    // src/uc05/ for a team that existed nowhere; the sentence a requester reads
    // is composed from the routing table so that cannot happen here.
    assert.ok(
      answer.lead.includes(group) || (answer.next ?? "").includes(group),
      `${r.where} was handed to ${group} and the requester was not told who has it: ${answer.lead}`
    );
  }
  assert.ok(named >= 10, `only ${named} results were routed to a team — the sweep is not reaching them`);
});

test("a 🔴 dossier still says nobody approves it, here or anywhere", async () => {
  const { results } = await driveEveryScenario();
  const red = decided(results).filter((r) => r.typeId === "uc07" || r.typeId === "uc08");
  assert.ok(red.length >= 4);
  for (const r of red) {
    assert.match(
      r.payload.plainAnswer.next ?? "",
      /here or anywhere else in this system/,
      `${r.where} dropped the no-execution-path guarantee`
    );
  }
});

// ---------------------------------------------------------------------------
// 5. A COUNTRY AN EMPLOYEE READS IS A NAME
// ---------------------------------------------------------------------------
// Codes decide; names are read. `countryLabel()` is the one place that
// translates, and it passes a value that is not code-shaped through untouched —
// so a parser that ever answered "ESP" stays visibly wrong rather than being
// dressed up as a rendered name.
//
// SCOPED THE SAME WAY SECTION 1 IS. The rows whose prose comes from one
// directory over are named in KNOWN_LEAKS and skipped here for the same reason:
// UC-03's informational answer prints "Spain (ES)" and the dossier narratives
// name their jurisdictions, and neither sentence is this change's to rewrite.
//
// A TWO-LETTER TOKEN IS NOT AUTOMATICALLY A COUNTRY, which is what makes this
// worth writing carefully rather than as a shape match. "HR Ops" is the team
// that signs off a resignation and `HR` is also Croatia; `IT` is Italy and also
// a department. So a token counts only when it is not the first half of an
// initialism-plus-noun phrase, and it is looked up in the real registry rather
// than matched against a pattern.

test("no requester-facing fact prints a bare country code", async () => {
  const { results } = await driveEveryScenario();
  const { countryName } = await import("../src/shared/countryNames.js");
  const offences = [];

  for (const r of decided(results)) {
    for (const row of r.payload.details ?? []) {
      if (KNOWN_LEAK_LABELS.has(row.label)) continue;
      // A standalone two-letter upper-case token that names a country. Bounded
      // on both sides, so "US$" or a word inside SHOUTED prose is not a hit,
      // and checked against the real registry rather than a shape — "OR" and
      // "IT" are also words, and only the registry can tell them apart.
      const value = String(row.value);
      // A CODE PRESENTED AS THE COUNTRY, not any two-letter token that happens
      // to be one. The first version of this matched `\b[A-Z]{2}\b` anywhere
      // and then tried to subtract the exceptions, which is the wrong way
      // round: it read "Local HR & Legal" as Croatia, "the letter IS drafted"
      // as Iceland, and "HOLDS NO RESIDENCE TEST FOR ANY JURISDICTION IN PLAY"
      // as Norway and India. Six false positives to one real hit, and a guard
      // that cries wolf six times out of seven is one the next person turns
      // off.
      //
      // So it matches the FORMS a code actually appears in when it is standing
      // in for a name — parenthesised after one, either side of an arrow, or
      // the whole value — and nothing else. It is narrower on purpose: it will
      // miss a code smuggled into prose, and it will not be ignored.
      // ONE EXCLUSION, AND IT IS NARROW ENOUGH THAT IT CANNOT HIDE A REAL LEAK.
      // "Regulation (EC) No 883/2004" is the formal citation form of an EU legal
      // act, and EC is also Ecuador's ISO code — so when the dossier corpus
      // started citing real instruments (2026-08-30), this guard reported four
      // Ecuador leaks in citation titles that name no country at all.
      //
      // The exclusion is `(EC)` or `(EU)` FOLLOWED BY " No ", which is the
      // citation form and nothing else. "Ecuador (EC)" still fails. A bare
      // "(EC)" still fails. Only the instrument-naming form passes, and it
      // passes because it is not a country reference in the first place.
      const withoutActCitations = value.replace(/\((?:EC|EU)\)(?=\s+No\s)/g, "(—)");
      const presented = [
        ...(withoutActCitations.match(/\(([A-Z]{2})\)/g) ?? []).map((m) => m.slice(1, 3)),
        ...(withoutActCitations.match(/\b([A-Z]{2})\b(?=\s*(?:→|->))/g) ?? []),
        ...(withoutActCitations.match(/(?<=(?:→|->)\s*)\b([A-Z]{2})\b/g) ?? []),
        ...(/^[A-Z]{2}$/.test(value.trim()) ? [value.trim()] : []),
      ];
      for (const token of presented) {
        if (countryName(token)) {
          offences.push(`${r.where} · "${row.label}" prints ${token} (${countryName(token)}) in: ...${value.slice(Math.max(0, value.indexOf(token) - 70), value.indexOf(token) + 70)}...`);
        }
      }
    }
  }
  assert.deepEqual(offences, [], `a country code reached a requester:\n  ${offences.join("\n  ")}`);
});

test("the EU-act exclusion cannot hide a real country-code leak", () => {
  // NEGATIVE CONTROL for the one exclusion the guard above carries. An
  // exclusion added to silence a false positive is exactly the change that
  // quietly widens into a hole, so the boundary is asserted rather than
  // described: only `(EC)`/`(EU)` in the act-citation form is excused.
  const excuse = (value) => value.replace(/\((?:EC|EU)\)(?=\s+No\s)/g, "(—)");
  assert.equal(excuse("Regulation (EC) No 883/2004"), "Regulation (—) No 883/2004");
  // Everything a real leak looks like still survives the replacement.
  assert.equal(excuse("Ecuador (EC)"), "Ecuador (EC)");
  assert.equal(excuse("relocating to (EC) next year"), "relocating to (EC) next year");
  assert.equal(excuse("Spain (ES)"), "Spain (ES)");
  assert.equal(excuse("the Netherlands (NL) → Portugal (PT)"), "the Netherlands (NL) → Portugal (PT)");
});

// ---------------------------------------------------------------------------
// 6. THE OTHER TWO PANELS ON THIS PAGE, held to the same rule
// ---------------------------------------------------------------------------
// `details` is the big surface and it is not the only one. Two blocks in app.js
// build their own rows from the response rather than from `details`, so the
// sweep above cannot see them: the panel that appears after a traveller accepts
// the letter offer, and the letter dialog itself. Both were printing things
// nobody on this page can use.
//
// SOURCE-LEVEL, and that is a deliberate second-best. The sweep is behavioural
// because behaviour is what a reader gets; these two are checked against the
// file because lifting them into the DOM sandbox would mean lifting their
// fetch, their status element and their dialog with them, for two assertions.
// The trade is stated rather than hidden: a rename would slip past this, and a
// re-added row would not.

test("the letter-accept panel prints no record id and no decision string", () => {
  const app = readFileSync(join(__dirname, "..", "src", "portal", "assets", "app.js"), "utf8")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");

  // Two internal ids and a decision-plus-slug, on the panel a traveller sees
  // after asking for their letter. The server's own sentence directly above
  // them says the same thing in words, and the reference is the only string
  // this reader can quote anywhere.
  assert.ok(!/label: "This letter request"/.test(app), "the letter panel prints its own record id again");
  assert.ok(!/label: "Continues the answer"/.test(app), "the letter panel prints the answered case's id");
  assert.ok(
    !/body\.decision \+ " \/ " \+ body\.decisionReason/.test(app),
    "the letter panel prints the decision word and its slug"
  );

  // AND THE TWO ROWS THAT USED TO STAY HAVE GONE, which is a reversal of what
  // this test asserted and is worth stating rather than quietly editing.
  //
  // It required `label: "Letter drafted"` and `label: "Waiting on a specialist
  // signature"` to survive every sweep, on the argument that "do I have it
  // yet?" is exactly those two questions. Both rows were true. Both were the
  // defect anyway: they rendered "yes" and "no" directly beneath the server's
  // own sentence saying the letter had been written and issued with no
  // signature needed — the same fact three times, twice in the names
  // src/uc03/workflow.js records it under (`letterDrafted`, `awaitingSignoff`),
  // with the reader left to compose them into a meaning already stated above.
  //
  // "Do I have it yet?" is now answered by handing the document over instead of
  // by describing its state, which is the test directly below and the stronger
  // guarantee: a panel can print "Letter drafted — yes" forever without the
  // reader ever reaching the letter, and that is exactly what it did.
  assert.ok(!/label: "Letter drafted"/.test(app), "the letter-accept panel prints its own state words again");
  assert.ok(!/label: "Waiting on a specialist signature"/.test(app), "the letter-accept panel prints the signature flag again");

  // OUR QUEUE HYGIENE, OFF THE TRAVELLER'S PANEL. "No Zendesk ticket: this
  // decision needs no human, so raising one would be noise in a real queue" is
  // a true sentence about how we keep a support queue clean, printed to an
  // employee who has nothing to do with it. A ticket that EXISTS is a reference
  // they can quote and stays; a hand-off that FAILED is a limit on their own
  // request and stays. The absence of a ticket nobody needed is neither.
  assert.ok(!/"No Zendesk ticket"/.test(app), "the traveller is told again about a ticket we chose not to raise");
});

test("the letter dialog hands over the document, not its hash", () => {
  const app = readFileSync(join(__dirname, "..", "src", "portal", "assets", "app.js"), "utf8")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");

  // "sha256 3f2a…" under the reader's own name and job title. Checking it means
  // computing a digest over the document's exact bytes, which the person taking
  // this letter to a visa appointment is not going to do. The hash is still
  // recorded on the case and in `audit_log`, where whoever WOULD verify it
  // looks, and it is still on the response for a surface built for them.
  assert.ok(!/"sha256 " \+ payload\.contentHash/.test(app), "the letter dialog still prints its content hash");
  assert.match(app, /srcdoc.*payload\.content|payload\.content/, "the letter dialog no longer shows the letter");
});
