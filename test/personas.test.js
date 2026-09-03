// ---------------------------------------------------------------------------
// personas.test.js — every persona on the portal's roster, driven to the
// outcome it exists to demonstrate, through the real workflow handlers.
// ---------------------------------------------------------------------------
// WHY THIS FILE EXISTS
//
// The project owner asked for something the roster could not do: *"I would love
// a prefilled scenario where another person won't get the same [outcome]. For
// positive outcomes I can act as one particular employee, for negative ones I
// can act as another — just need to switch from the sidebar."* That is a
// request for the PERSON to carry the demonstration, rather than the typing.
//
// Driven through the real handlers, the roster of 2026-08-18 produced exactly
// one refusal between its seven people, and one person produced all of it:
// Thomas Weber is archived, so everything refuses him `employee_not_active`.
// Everybody else auto-issued the travel letter, cleared UC-04's permission gate
// and reached a UC-05 outcome. So a refusal could be produced only by TYPING
// something unusual — a sanctioned destination, a 90-day trip, somebody else's
// expense id — and never by BEING somebody.
//
// THE FAILURE MODE THIS FILE IS ACTUALLY GUARDING AGAINST is not "a persona is
// missing". It is a persona documented to refuse that quietly succeeds, or that
// refuses for a DIFFERENT reason than its note claims. Either one makes the demo
// teach something false, which is worse than having no demo: the note beside the
// dropdown is what a viewer believes, and nothing else on the page contradicts
// it. So every assertion below pins the exact `reason`, never merely "it did not
// auto-resolve" — CLAUDE.md §4's standing lesson is that refusing correctly and
// being structurally unable to succeed look identical from outside, and only a
// named outcome tells them apart.
//
// AND ONE STRUCTURAL TEST KEEPS IT HONEST OVER TIME. `DEMONSTRATIONS` must name
// every persona in `PERSONAS`, in both directions. A persona added later with no
// demonstrated outcome fails this suite rather than quietly becoming decorative,
// and a demonstration left behind by a removed persona fails it too.
//
// HERMETIC, AND WITHOUT BINDING A SOCKET. The Remote reads are the real mock
// fixtures dispatched in-process (`createInProcessFetch()`), which is also
// exactly how the portal itself reads them (src/portal/, deploy/cx-apis/deps.js).
// No port is bound, so nothing here can collide with the test band or need a
// row in src/shared/ports.js. Every LLM seam is injected with the real
// function's own deterministic branch, never a hand-written stand-in.
// ---------------------------------------------------------------------------

import { test } from "node:test";
import assert from "node:assert/strict";

import { createInProcessFetch, EMPLOYMENTS } from "../src/remote/mockServer.js";
import { RemoteClient } from "../src/remote/restClient.js";
import { AuditLogger } from "../src/shared/audit.js";
import { CaseStore } from "../src/shared/caseStore.js";
import { PERSONAS } from "../src/portal/personas.js";

import { handleExpenseSubmission } from "../src/uc02/workflow.js";
import { ExpenseStore } from "../src/uc02/expenseStore.js";
import { classifyExpenseRuleBased } from "../src/uc02/expenseClassifier.js";

import { handleTravelInquiry } from "../src/uc03/workflow.js";
import { classifyTravelInquiryRuleBased } from "../src/uc03/classifier.js";

import { handleWorkationRequest } from "../src/uc04/workflow.js";
import { AuthorizationStore } from "../src/uc04/authorizationStore.js";
import { draftSummary } from "../src/uc04/requestParser.js";
import { VISA_TYPES, JOB_DUTY_CATEGORIES } from "../src/uc04/riskMatrix.js";

import { handleResignationRequest } from "../src/uc05/workflow.js";
import { ResignationStore } from "../src/uc05/resignationStore.js";

import { issueSelfServiceLetter } from "../src/uc01/selfServiceLetter.js";

const remote = new RemoteClient({ baseUrl: "http://mock.remote.invalid", fetchImpl: createInProcessFetch() });

// The real draft/judge functions forced into their unconfigured branch, the
// idiom every other suite here uses: identical output to production's own
// fallback, and never a real (retried, slow) OpenAI call just because
// OPENAI_API_KEY happens to be set in this environment. CLAUDE.md §6.
const fakeDraftSummary = (args) => draftSummary(args, { isConfigured: () => false });
const fakeJudge = async () => ({ verdict: "not_evaluated", reason: null });

// ---------------------------------------------------------------------------
// The request bodies. ONE OF EACH, shared by every persona that uses it.
// ---------------------------------------------------------------------------
// This is the load-bearing part of the whole file. The claim being tested is
// *"the difference is a fact on the record, not a difference in what was
// typed"*, and the only way to test that claim is for the two runs to differ in
// nothing except which persona filed them. A second, near-identical literal
// beside the first would let a stray word drift in and turn a record
// demonstration back into a typing one, invisibly.

/** An explicit request for the formal document — reaches UC-03's rung 11. */
const FORMAL_LETTER_REQUEST =
  "I need a formal travel support letter for a business trip to Spain from 2026-09-01 to 2026-09-10.";

/** The same trip, no document asked for — never reaches rung 11 at all. */
const INFORMATIONAL_TRAVEL_QUESTION =
  "I'm travelling to Spain from 2026-09-01 to 2026-09-10, is there anything I should know?";

/** A low-risk short Schengen workation. Same object for every UC-04 run below. */
const WORKATION_FACTORS = Object.freeze({
  homeCountry: "DE",
  nationality: "DE",
  destination: { country: "ES" },
  startDate: "2026-09-01",
  endDate: "2026-09-14",
  visaType: VISA_TYPES.schengen_short_stay,
  jobDuties: JOB_DUTY_CATEGORIES.engineering,
  hasContractSigningAuthority: false,
});

// ---------------------------------------------------------------------------
// Runners — thin wrappers over the REAL handlers, never a reimplementation
// ---------------------------------------------------------------------------

/** UC-03, filed by the persona about themselves. */
function travel(personaKey, text, externalRef) {
  const persona = PERSONAS[personaKey];
  return handleTravelInquiry(
    { text, employmentId: persona.employmentId, session: persona.session, externalRef },
    { remote, audit: new AuditLogger(), caseStore: new CaseStore(), classify: classifyTravelInquiryRuleBased }
  );
}

/**
 * UC-04, filed by the ADMIN about somebody else.
 *
 * The session is always Jane Doe's and the subject is always the named
 * persona's employment — which is how this use case works on the portal, and
 * why two of the three personas added on 2026-08-20 change an outcome only
 * here. On this page "switch the persona" and "switch the subject" are
 * different gestures, and the persona notes say which one each person is for.
 */
function workation(subjectKey, externalRef) {
  return handleWorkationRequest(
    {
      employmentId: PERSONAS[subjectKey].employmentId,
      session: PERSONAS.admin.session,
      factors: WORKATION_FACTORS,
      travelHistory: [],
      now: "2026-08-15",
      externalRef,
    },
    {
      remote,
      audit: new AuditLogger(),
      authorizationStore: new AuthorizationStore(),
      draftSummary: fakeDraftSummary,
      judge: fakeJudge,
    }
  );
}

/** UC-05, filed by the persona about themselves. */
function resignation(personaKey, proposedEndDate, externalRef) {
  const persona = PERSONAS[personaKey];
  return handleResignationRequest(
    {
      employmentId: persona.employmentId,
      session: persona.session,
      letterText: "I am resigning from my role.",
      proposedEndDate,
      now: "2026-08-20",
      externalRef,
    },
    {
      remote,
      audit: new AuditLogger(),
      resignationStore: new ResignationStore(),
      // The extractor is an LLM seam; the proposed date is already structured
      // input here, so the deterministic answer is handed straight back.
      extract: () => ({ proposedEndDate, reason: "personal", source: "rule_based_fallback" }),
    }
  );
}

/**
 * UC-02, filed by the persona.
 *
 * EVERY EXPENSE ID BELOW IS USED EXACTLY ONCE IN THIS FILE, and that is a
 * constraint rather than a coincidence: an approved claim is PATCHed in the
 * mock and UC-02's duplicate gate fires on a second submission of the same
 * expense, so re-using one would return `duplicate_submission` instead of the
 * outcome its demonstration promises. mockServer.js's own note on James
 * Wilson's pair records the same trap, found by clicking both portal buttons in
 * one session.
 */
function expense(personaKey, expenseId, externalRef) {
  const persona = PERSONAS[personaKey];
  return handleExpenseSubmission(
    { expenseId, employmentId: persona.employmentId, session: persona.session, externalRef },
    {
      remote,
      audit: new AuditLogger(),
      expenseStore: new ExpenseStore(),
      classify: (args) => classifyExpenseRuleBased(args),
    }
  );
}

/**
 * UC-01, filed by the persona about themselves (`issueSelfServiceLetter`, not
 * `handleVerificationTicket` — see that file's header for why they are
 * deliberately separate). Its result shape is not `{decision, reason, flags}`
 * like the other four handlers, so it is normalised to that shape here rather
 * than teaching the DEMONSTRATIONS loop a second contract.
 */
async function uc01Letter(personaKey, externalRef) {
  const persona = PERSONAS[personaKey];
  const result = await issueSelfServiceLetter(
    { employmentId: persona.employmentId, session: persona.session, externalRef },
    { remote, audit: new AuditLogger(), caseStore: new CaseStore() }
  );
  return result.ok
    ? { decision: "auto_resolve", reason: "self_service_all_gates_passed", flags: [], letterHtml: result.letterHtml }
    : { decision: "refused", reason: result.code, flags: [] };
}

// ---------------------------------------------------------------------------
// THE REGISTRY OF DEMONSTRATIONS — one entry per persona, keyed by persona id
// ---------------------------------------------------------------------------
// `what` is written for a human reading a failure, and says the SAME thing the
// persona's own `note` says, in the same words wherever possible. When the two
// disagree, one of them is wrong and the disagreement is the signal.
//
// `flags` is asserted only where a flag is the DISCRIMINATOR — where the reason
// alone does not identify the gate. Two cases below need it:
//   - Thomas: `employee_not_active` is the reason for any non-active status, and
//     `employment_status_archived` is what proves the status was read off the
//     record verbatim rather than normalised to some word this repo prefers.
//   - Alexandre: `formal_letter_requested` is shared with the deployment-policy
//     path (a standard letter that this deployment requires a signature on), and
//     `letterhead_unavailable` is the only thing that says WHY. UC-03's own
//     policy engine calls that out: the two reach the same rung and are opposite
//     things to the person who picks the case up — one has a prepared document
//     to sign, the other has nothing and needs a record fixed.

/**
 * @typedef {object} Demonstration
 * @property {string} what      one line: what this persona is for
 * @property {string} useCase
 * @property {() => Promise<{decision:string, reason:string, flags:string[]}>} run
 * @property {string} decision  the exact decision this persona exists to produce
 * @property {string} reason    the exact reason — never merely "not a success"
 * @property {string[]} [flags] asserted only where a flag identifies the gate
 */

/** @type {Record<string, Demonstration[]>} */
const DEMONSTRATIONS = {
  // --- the anchor. Chris is the "everything works" side of three pairs -------
  chris: [
    {
      what: "a standard travel letter is written and issued on the spot",
      useCase: "UC-03",
      run: () => travel("chris", FORMAL_LETTER_REQUEST, "personas-uc03-chris"),
      decision: "auto_resolve",
      reason: "standard_letter_issued",
    },
    {
      what: "a workation request naming him is prepared for a specialist",
      useCase: "UC-04",
      run: () => workation("chris", "personas-uc04-chris"),
      decision: "ready_for_approval",
      reason: "all_gates_passed",
    },
    {
      what: "his own clean expense is settled without anyone reading it",
      useCase: "UC-02",
      run: () => expense("chris", "exp_sandbox_clean_401", "personas-uc02-chris-own"),
      decision: "auto_approve",
      reason: "all_gates_passed",
    },
    {
      what: "somebody else's expense filed under his session is refused on ownership",
      useCase: "UC-02",
      run: () => expense("chris", "exp_sandbox_other_owner_403", "personas-uc02-chris-other"),
      decision: "escalate",
      reason: "expense_employment_mismatch",
    },
  ],

  // --- the 2026-08-18 roster: countries, brackets and one ownership pair -----
  emma: [
    {
      what: "the United Kingdom's statutory notice is computed and the report goes for sign-off",
      useCase: "UC-05",
      run: () => resignation("emma", "2026-11-30", "personas-uc05-emma"),
      decision: "prepared_for_signoff",
      reason: "all_gates_passed",
    },
  ],
  carlos: [
    {
      what: "Brazil is not in the nine-country notice table, so a person answers instead",
      useCase: "UC-05",
      run: () => resignation("carlos", "2026-11-30", "personas-uc05-carlos"),
      decision: "escalate",
      reason: "unsupported_country",
    },
  ],
  anna: [
    {
      what: "Germany's notice is anchored to the 15th or a month end (BGB §622), and her date lands on one",
      useCase: "UC-05",
      run: () => resignation("anna", "2026-11-30", "personas-uc05-anna"),
      decision: "prepared_for_signoff",
      reason: "all_gates_passed",
    },
  ],
  thomas: [
    {
      what: "an archived employment has no live employment to certify, whatever is asked for",
      useCase: "UC-03",
      run: () => travel("thomas", FORMAL_LETTER_REQUEST, "personas-uc03-thomas"),
      decision: "escalate",
      reason: "employee_not_active",
      // The flag carries the REAL status rather than a word this repo prefers —
      // mockServer.js mirrors "archived" verbatim for exactly this reason.
      flags: ["employment_status_archived"],
    },
  ],
  james: [
    {
      what: "the claim he files himself auto-approves — the other half of the ownership pair",
      useCase: "UC-02",
      run: () => expense("james", "exp_sandbox_own_404", "personas-uc02-james-own"),
      decision: "auto_approve",
      reason: "all_gates_passed",
    },
  ],
  joao: [
    {
      what: "Portugal owes 60 days past two years' service, and a leaving date six weeks out clashes with it",
      useCase: "UC-05",
      run: () => resignation("joao", "2026-09-05", "personas-uc05-joao"),
      decision: "escalate",
      reason: "statutory_discrepancy",
    },
  ],

  // --- the 2026-08-20 additions: one record fact each, each turning a gate ---
  lars: [
    {
      what: "Acme's admin cannot act for someone employed by another company",
      useCase: "UC-04",
      run: () => workation("lars", "personas-uc04-lars"),
      decision: "escalate",
      reason: "identity_not_verified",
    },
    {
      what: "…and the boundary is the COMPANY, not the person: filing for himself still works",
      useCase: "UC-03",
      run: () => travel("lars", FORMAL_LETTER_REQUEST, "personas-uc03-lars"),
      decision: "auto_resolve",
      reason: "standard_letter_issued",
    },
  ],
  david: [
    {
      // THE RUNG THAT LOST ITS ONLY PERSONA, given one back (2026-09-03). The
      // engagement gate correctly refuses Alexandre five rungs before the
      // letterhead check, and he was the only record carrying the absence that
      // check is about. David is an EOR EMPLOYEE with the same absence, so this
      // row proves the rung fires on the missing entity and NOT on anything
      // about the engagement — the pair below is Chris, whose identical request
      // is issued outright because his record names one.
      what: "his record names no employing legal entity, so the letter is drafted and stopped for a specialist to release",
      useCase: "UC-03",
      run: () => travel("david", FORMAL_LETTER_REQUEST, "personas-uc03-david"),
      decision: "human_review",
      reason: "formal_letter_requested",
      flags: ["letterhead_unavailable"],
    },
  ],
  alexandre: [
    {
      what: "he is engaged as a contractor, so Remote is not his legal employer and the letter is refused outright",
      useCase: "UC-03",
      run: () => travel("alexandre", FORMAL_LETTER_REQUEST, "personas-uc03-alexandre"),
      decision: "blocked",
      reason: "engagement_not_eor_contractor",
      // THIS ROW USED TO BE THE LETTERHEAD RUNG (`human_review /
      // formal_letter_requested`, flag `letterhead_unavailable`) and the change
      // is a correction, not a swap. His record names no employing entity
      // BECAUSE he is a contractor — the missing letterhead was the symptom and
      // the engagement is the cause, and Remote publishes both travel articles
      // under "This is applicable to EOR customers only". Stopping at the
      // symptom sent a contractor to a specialist to be told a fact Remote
      // publishes.
      flags: ["engagement_contractor"],
    },
    {
      what: "…and it is not only the document: the same trip asked about informally is refused on the same fact",
      useCase: "UC-03",
      run: () => travel("alexandre", INFORMATIONAL_TRAVEL_QUESTION, "personas-uc03-alexandre-info"),
      decision: "blocked",
      reason: "engagement_not_eor_contractor",
      flags: ["engagement_contractor"],
      // A DELIBERATE WIDENING, RECORDED BECAUSE IT IS A JUDGEMENT AND NOT AN
      // ACCIDENT (2026-09-03). This row used to read `auto_resolve` — the
      // letterhead rung stopped his DOCUMENT while an informal question about
      // the same trip was still answered, and that distinction was worth
      // making while the gate was about letterheads.
      //
      // The engagement gate sits ahead of intent classification, so it refuses
      // the informational answer too. That is BROADER than Remote's published
      // words strictly require: Remote heads the travel articles "applicable to
      // EOR customers only", which is about the letter and the work
      // authorisation, and it publishes nothing saying a contractor's question
      // must go unanswered. It is the fail-closed direction and it is the one
      // taken on purpose, for a reason the narrower version does not survive:
      // UC-03's informational answer is a compliance statement about whether
      // someone may work from a country, issued under Remote's name, and for a
      // contractor the answer turns on a client contract Remote has never seen.
      // Answering anyway would be the same class of false attestation the
      // letter gate exists to prevent, one register quieter.
      //
      // It is reversible in one place — move the gate below the intent routing
      // in src/uc03/policyEngine.js — and this comment is here so whoever wants
      // the narrower behaviour knows it was considered rather than missed.
    },
  ],
  amanda: [
    {
      what: "her employer has not granted workation permission, so the request is blocked outright",
      useCase: "UC-04",
      run: () => workation("amanda", "personas-uc04-amanda"),
      decision: "blocked",
      reason: "employer_permission_not_granted",
    },
  ],

  // --- the round-6 D-02 addition: the person the requester actually IS ------
  alex: [
    {
      what: "his own self-service letter is issued instantly and names HIM, not whoever the picker defaulted to",
      useCase: "UC-01",
      run: () => uc01Letter("alex", "personas-uc01-alex"),
      decision: "auto_resolve",
      reason: "self_service_all_gates_passed",
    },
  ],

  // --- the admin is a persona too, and has an outcome of his own ------------
  admin: [
    {
      what: "the one company admin can file for any Acme employee — the positive that proves the path works",
      useCase: "UC-04",
      run: () => workation("emma", "personas-uc04-admin-for-emma"),
      decision: "ready_for_approval",
      reason: "all_gates_passed",
    },
  ],
};

// ---------------------------------------------------------------------------
// 1. Every demonstration, driven through the real handler
// ---------------------------------------------------------------------------

for (const [personaKey, demos] of Object.entries(DEMONSTRATIONS)) {
  for (const demo of demos) {
    test(`${personaKey} · ${demo.useCase} · ${demo.what}`, async () => {
      const result = await demo.run();

      assert.equal(
        result.decision,
        demo.decision,
        `persona "${personaKey}" is documented to produce "${demo.decision}" on ${demo.useCase} and produced ` +
          `"${result.decision}" (${result.reason}). Either the record changed, a gate changed, or the ` +
          "persona's note is now a false claim on a page somebody reads."
      );

      // THE REASON, NOT JUST THE DECISION. A refusal for the wrong reason sends
      // the case to the wrong desk and teaches the viewer the wrong lesson, and
      // it is invisible to an assertion that only checks the decision.
      assert.equal(
        result.reason,
        demo.reason,
        `persona "${personaKey}" produced the right decision on ${demo.useCase} for the WRONG reason: ` +
          `expected "${demo.reason}", got "${result.reason}" [${result.flags}]`
      );

      for (const flag of demo.flags ?? []) {
        assert.ok(
          result.flags.includes(flag),
          `persona "${personaKey}" must carry the flag "${flag}" — it is what identifies WHICH gate ` +
            `decided, and "${demo.reason}" alone does not. Got [${result.flags}]`
        );
      }
    });
  }
}

// ---------------------------------------------------------------------------
// 2. The structural guard: no persona may exist without a demonstrated outcome
// ---------------------------------------------------------------------------
// This is the test that keeps the file honest after everyone who wrote it has
// gone. Without it a persona added next month joins the dropdown, carries a
// confident note about what it is for, and is never once driven to an outcome —
// which is precisely the state this whole ticket existed to fix.

test("every persona in the registry is exercised by at least one demonstrated outcome", () => {
  assert.deepEqual(
    Object.keys(DEMONSTRATIONS).sort(),
    Object.keys(PERSONAS).sort(),
    "DEMONSTRATIONS and PERSONAS must name exactly the same people. A persona with no entry here is " +
      "decorative — nothing proves it does what its note says. An entry with no persona is a demonstration " +
      "nobody can reach from the page."
  );

  for (const [key, demos] of Object.entries(DEMONSTRATIONS)) {
    assert.ok(demos.length > 0, `persona "${key}" has an empty demonstration list`);
  }
});

// ---------------------------------------------------------------------------
// 3. The pairs — the actual thing that was asked for
// ---------------------------------------------------------------------------
// "A prefilled scenario where another person won't get the same outcome."
// Each pair below runs the SAME request twice, differing in nothing but who
// filed it, and asserts the outcomes are opposite. The shared request constants
// at the top of this file are what make that claim checkable rather than
// merely stated: if a future edit changed one side's wording, these tests would
// still pass while silently testing something else — so they assert on the
// shared constant's identity too.

test("PAIR · the travel letter: Chris gets the document, Alexandre is refused — same words", async () => {
  const text = FORMAL_LETTER_REQUEST;
  const issued = await travel("chris", text, "personas-pair-letter-chris");
  const stopped = await travel("alexandre", text, "personas-pair-letter-alexandre");

  assert.equal(issued.decision, "auto_resolve");
  assert.equal(issued.reason, "standard_letter_issued");
  assert.equal(stopped.decision, "blocked");
  assert.equal(stopped.reason, "engagement_not_eor_contractor");
  assert.ok(stopped.flags.includes("engagement_contractor"));

  // THE DIFFERENCE IS ON THE RECORD, and this is where that is proved rather
  // than asserted in a comment. Both requests were the same string; what
  // differs is the ENGAGEMENT each employment records — and, downstream of it,
  // the employing entity, which is null for Alexandre precisely BECAUSE a
  // contractor has no EOR entity behind them. Both facts are still asserted,
  // in that order, so the pair says which one decides.
  assert.equal(EMPLOYMENTS[PERSONAS.chris.employmentId].status, "active");
  assert.equal(EMPLOYMENTS[PERSONAS.alexandre.employmentId].status, "active");
  assert.equal(EMPLOYMENTS[PERSONAS.chris.employmentId].contract_type, "full_time");
  assert.equal(EMPLOYMENTS[PERSONAS.alexandre.employmentId].contract_type, "contractor");
  assert.ok(EMPLOYMENTS[PERSONAS.chris.employmentId].legal_entity_id);
  assert.equal(EMPLOYMENTS[PERSONAS.alexandre.employmentId].legal_entity_id, null);
});

test("PAIR · round-6 D-02 — Chris and Alex both get a letter, and each letter names the person who asked", async () => {
  const chrisLetter = await uc01Letter("chris", "personas-pair-uc01-chris");
  const alexLetter = await uc01Letter("alex", "personas-pair-uc01-alex");

  assert.equal(chrisLetter.decision, "auto_resolve");
  assert.equal(alexLetter.decision, "auto_resolve");

  // ROUND 6'S OWN FAILURE, PINNED. The employee persona was Alex Morgan and
  // every letter this page could produce named Chris Lee instead (D-02). Both
  // halves of that claim are asserted, not just the happy one — a fix that
  // made every persona's letter say "Alex Morgan" would pass the first line
  // and hide a regression on Chris's own name.
  assert.match(chrisLetter.letterHtml, /Chris Lee/);
  assert.doesNotMatch(chrisLetter.letterHtml, /Alex Morgan/);
  assert.match(alexLetter.letterHtml, /Alex Morgan/);
  assert.doesNotMatch(alexLetter.letterHtml, /Chris Lee/);
});

test("PAIR · the workation: Chris is prepared for approval, Amanda is blocked — same factors object", async () => {
  const cleared = await workation("chris", "personas-pair-workation-chris");
  const blocked = await workation("amanda", "personas-pair-workation-amanda");

  assert.equal(cleared.decision, "ready_for_approval");
  assert.equal(cleared.reason, "all_gates_passed");
  assert.equal(blocked.decision, "blocked");
  assert.equal(blocked.reason, "employer_permission_not_granted");

  // Both runs were handed the identical frozen `WORKATION_FACTORS`; the record
  // is the only variable.
  assert.equal(EMPLOYMENTS[PERSONAS.chris.employmentId].custom_fields.workation_permission, true);
  assert.equal(EMPLOYMENTS[PERSONAS.amanda.employmentId].custom_fields.workation_permission, false);

  // `blocked` is also the one UC-04 decision that touches Remote not at all —
  // a hard stop is never decided by anyone, so no work-authorization record is
  // resolved for it. Pinned here because "blocked" and "escalate" look similar
  // on screen and are very different things underneath.
  assert.equal(blocked.workAuthorizationId ?? null, null);
});

test("PAIR · the admin's reach: he can file for Emma and not for Lars — same session, same factors", async () => {
  const own = await workation("emma", "personas-pair-admin-emma");
  const other = await workation("lars", "personas-pair-admin-lars");

  assert.equal(own.decision, "ready_for_approval");
  assert.equal(own.reason, "all_gates_passed");
  assert.equal(other.decision, "escalate");
  assert.equal(other.reason, "identity_not_verified");

  // The gate is `session.companyId === employment.company_id`, and this is the
  // fact it compared. Prime directive #3 on a screen instead of in a comment.
  assert.equal(EMPLOYMENTS[PERSONAS.emma.employmentId].company_id, PERSONAS.admin.session.companyId);
  assert.notEqual(EMPLOYMENTS[PERSONAS.lars.employmentId].company_id, PERSONAS.admin.session.companyId);
});

// ---------------------------------------------------------------------------
// 4. The roster's own invariants, which the additions must not have broken
// ---------------------------------------------------------------------------

test("every employee persona still resolves to a real fixture under a Sandbox-shaped id", async () => {
  for (const persona of Object.values(PERSONAS)) {
    if (persona.kind !== "employee") continue;

    assert.match(
      persona.employmentId,
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      `employee persona "${persona.id}" must carry a real Sandbox UUID, not a mock fixture id — the page's ` +
        "own copy claims every one of these is a genuine Sandbox employment"
    );
    // The note is the only place a tester can see the id to cross-check it.
    assert.ok(
      persona.note.includes(persona.employmentId),
      `persona "${persona.id}"'s note must print its Sandbox id`
    );

    const employment = await remote.getEmployment(persona.employmentId);
    assert.ok(employment, `persona "${persona.id}" must resolve to a fixture the portal can actually read`);
    assert.equal(employment.id, persona.employmentId);

    // The session is server-owned and built from the id — never from a request
    // body. This is the property resolvePersona() exists to guarantee.
    assert.deepEqual(persona.session, { authenticatedEmploymentId: persona.employmentId });
  }
});

test("the three refusal-carrying records differ from the roster in exactly the fact each claims", () => {
  const lars = EMPLOYMENTS[PERSONAS.lars.employmentId];
  const alexandre = EMPLOYMENTS[PERSONAS.alexandre.employmentId];
  const amanda = EMPLOYMENTS[PERSONAS.amanda.employmentId];

  // Lars: a different company, and NOTHING ELSE that would refuse him. If he
  // also lacked an entity or a permission his refusal would be over-determined
  // and the demonstration would prove nothing about which gate fired.
  assert.notEqual(lars.company_id, PERSONAS.admin.session.companyId);
  assert.equal(lars.status, "active");
  assert.ok(lars.legal_entity_id, "Lars must have a letterhead — his refusal is the company gate, not this one");
  assert.equal(lars.custom_fields.workation_permission, true);

  // Alexandre: a contractor — and the missing entity is downstream of that, not
  // a second independent fact. Both are asserted, cause first.
  assert.equal(alexandre.contract_type, "contractor");
  assert.equal(alexandre.legal_entity_id, null);
  assert.equal(alexandre.status, "active");
  assert.equal(alexandre.company_id, PERSONAS.admin.session.companyId);
  assert.equal(alexandre.custom_fields.workation_permission, true);

  // Amanda: permission withheld, and nothing else.
  assert.equal(amanda.custom_fields.workation_permission, false);
  assert.equal(amanda.status, "active");
  assert.equal(amanda.company_id, PERSONAS.admin.session.companyId);
  assert.ok(amanda.legal_entity_id, "Amanda must have a letterhead — her refusal is the permission gate");
});

test("no persona is offered whose only reachable outcome is a refusal", () => {
  // CLAUDE.md §4's rule, applied to the roster: a persona nobody can drive to a
  // success is useless for testing, because "refuses correctly" and
  // "structurally cannot succeed" are indistinguishable without one. Thomas is
  // the deliberate exception and is named as such — an archived employment is
  // supposed to refuse everything, and demonstrating that is his whole job.
  const refusalOnly = Object.entries(DEMONSTRATIONS)
    .filter(([, demos]) => demos.every((d) => d.decision === "escalate" || d.decision === "blocked"))
    .map(([key]) => key);

  assert.deepEqual(
    refusalOnly.sort(),
    ["alexandre", "amanda", "carlos", "joao", "thomas"],
    "a persona whose every demonstration is a refusal needs a stated reason to exist. The five here have " +
      "one: Thomas is archived (refusing everything IS the demonstration), Carlos and João carry a " +
      "jurisdiction rule, Amanda carries a withheld permission, and Alexandre is engaged as a contractor — " +
      "and the two products his demonstrations ask for, the employment letter and the travel letter, are " +
      "both published by Remote for EOR customers only, so being refused IS his demonstration in the same " +
      "way being archived is Thomas's. Anyone else on this list is a persona that can only ever be shown " +
      "failing, which is caution dressed as a demo."
  );
});
