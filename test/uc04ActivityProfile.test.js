/**
 * W-2 — WHAT THE PERSON WILL ACTUALLY BE DOING THERE.
 *
 * The panel told a mobility specialist that the traveller's work is one of
 * seven dropdown categories and nothing else. Remote's own Mobility Team
 * publishes what it assesses — "Nature of intended activities" is one of the
 * five items — and Remote's own RWA form asks for three things this system
 * never collected (Help Center article 37802834593805, retrieved 2026-08-18):
 * "Activities to be performed", "Institutions or organizations visiting",
 * "Special worksites (e.g., laboratories, manufacturing sites, etc.)".
 *
 * THE ONE PROPERTY THAT COULD DO HARM, AND IT IS ENFORCED RATHER THAN
 * INTENDED: none of this reaches a gate. It is unverified free text typed by
 * the requester, and prime directive 1's sibling applies — a human's prose may
 * inform a specialist and may never decide. A rule keyed on the word
 * "laboratory" appearing in a sentence is a rule anybody can pass by rephrasing
 * and an honest requester can fail by being specific; worse, a system that
 * scored these fields would start rewarding the phrasing that scores well,
 * which destroys the only thing they are for.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  ACTIVITY_QUESTIONS,
  ACTIVITY_FIELD_MAX_CHARS,
  normalizeActivityProfile,
  describeActivityProfile,
  activityStatementPrefill,
} from "../src/uc04/activityProfile.js";
import { describeDecisionBasis } from "../src/uc04/decisionFacts.js";
import { classifyRisk } from "../src/uc04/riskMatrix.js";
import { evaluate } from "../src/uc04/policyEngine.js";

const repoFile = (rel) => readFileSync(new URL("../" + rel, import.meta.url), "utf8");

const SAID = {
  activitiesToBePerformed: "Design reviews with the Madrid team and one client workshop",
  institutionsVisited: "Acme Iberia SL",
  specialWorksite: "none",
  workLocation: "The client's office in Madrid",
};

function factors(over = {}) {
  return {
    homeCountry: "US",
    nationality: "US",
    destination: { country: "NL" },
    startDate: "2026-12-01",
    endDate: "2026-12-10",
    visaType: "schengen_short_stay",
    jobDuties: "engineering",
    hasContractSigningAuthority: false,
    priorTravel: [],
    ...over,
  };
}

function basisWith(activityProfile) {
  const f = factors({ activityProfile });
  const risk = classifyRisk({
    sourceCountry: "US",
    homeCountry: "US",
    nationality: "US",
    destinationCountry: "NL",
    startDate: f.startDate,
    endDate: f.endDate,
    visaType: f.visaType,
    jobDuties: f.jobDuties,
    hasContractSigningAuthority: false,
    travelHistory: [],
    now: "2026-09-01T00:00:00Z",
  });
  return describeDecisionBasis({
    authorizationRow: { factors: f, risk, flags: (risk.flags ?? []).map((x) => x.code ?? x), tripDays: 10 },
  });
}

// ---------------------------------------------------------------------------
// The questions are Remote's, in Remote's words
// ---------------------------------------------------------------------------

test("the questions are the ones Remote's own form asks", () => {
  const labels = ACTIVITY_QUESTIONS.map((q) => q.label);
  assert.match(labels[0], /Activities to be performed/);
  assert.match(labels[1], /Institutions or organizations/);
  assert.match(labels[2], /Special worksites/);
  // The fourth is `work_location` on Remote's own request object, which is why
  // the panel can read it back off a linked request when one exists.
  assert.match(labels[3], /Where you will be working/);
  // Each absence sentence is different: "nobody asked" and "asked and blank"
  // must never render as the same string.
  assert.equal(new Set(ACTIVITY_QUESTIONS.map((q) => q.absence)).size, ACTIVITY_QUESTIONS.length);
});

test("the hint tells the requester what to write, not what doctrine it feeds", () => {
  // Somebody filling in a form does not know what a permanent establishment is
  // and must not have to — the rule the signing-authority checkbox already
  // follows. A hint naming the tax concept asks the reader to be an expert
  // before they can answer honestly.
  for (const question of ACTIVITY_QUESTIONS) {
    assert.ok(question.hint && question.hint.length > 10, `${question.key} has no usable hint`);
    assert.doesNotMatch(question.hint, /permanent establishment|dependent agent|PE risk/i);
  }
});

// ---------------------------------------------------------------------------
// Asked-and-blank is not the same as never-asked
// ---------------------------------------------------------------------------

test("nothing supplied is null, and null is a different fact from four blanks", () => {
  assert.equal(normalizeActivityProfile(undefined), null);
  assert.equal(normalizeActivityProfile(null), null);
  assert.equal(normalizeActivityProfile("a string"), null);
  // An object with none of our keys is indistinguishable from not asking.
  assert.equal(normalizeActivityProfile({ somethingElse: "x" }), null);

  /* ASKED AND LEFT BLANK IS NOT NEVER-ASKED — corrected after driving it. This
     asserted that all-blank normalises to null "because it is the same
     information as not asking". It is not, and this module's own header says
     so: a requester who submitted the form with every box empty was reported to
     the specialist as "filed through a surface that does not ask the question",
     which is false in the reassuring direction — it excuses the silence instead
     of showing it. Whitespace-only input collapsed the same way. */
  const askedAndBlank = normalizeActivityProfile({ activitiesToBePerformed: "   ", institutionsVisited: "" });
  assert.notEqual(askedAndBlank, null, "a form submitted with every box empty is reported as never asked");
  assert.deepEqual(askedAndBlank, {
    activitiesToBePerformed: null,
    institutionsVisited: null,
    specialWorksite: null,
    workLocation: null,
  });
  assert.equal(describeActivityProfile(askedAndBlank).asked, true);
  assert.match(
    describeActivityProfile(askedAndBlank).fields[0].absence,
    /Not stated on the request/,
    "a blank answer is being excused as a question nobody asked"
  );
  // And there is still nothing to prefill an employer's box with.
  assert.equal(activityStatementPrefill(askedAndBlank), null);
  // One answer is enough to make it a stated profile.
  assert.deepEqual(normalizeActivityProfile({ specialWorksite: "none" }), {
    activitiesToBePerformed: null,
    institutionsVisited: null,
    specialWorksite: "none",
    workLocation: null,
  });
});

test("the panel says which silence it is", () => {
  const notAsked = describeActivityProfile(normalizeActivityProfile(null));
  const askedPartly = describeActivityProfile(normalizeActivityProfile({ specialWorksite: "none" }));

  assert.equal(notAsked.asked, false);
  assert.match(notAsked.finding, /carries no account of the intended activities/);
  for (const field of notAsked.fields) {
    assert.equal(field.value, null);
    assert.match(field.absence, /does not ask the question/);
  }

  assert.equal(askedPartly.asked, true);
  const worksites = askedPartly.fields.find((f) => f.key === "worksites");
  const activities = askedPartly.fields.find((f) => f.key === "activities");
  assert.equal(worksites.value, "none");
  assert.equal(activities.value, null);
  // "unanswered, not answered no" — the distinction that matters on a field
  // where "none" is a real answer.
  assert.match(activities.absence, /Not stated on the request/);
});

test("free text is bounded before anything reads it", () => {
  const long = "x".repeat(ACTIVITY_FIELD_MAX_CHARS + 500);
  const profile = normalizeActivityProfile({ activitiesToBePerformed: long });
  assert.equal(profile.activitiesToBePerformed.length, ACTIVITY_FIELD_MAX_CHARS);
});

// ---------------------------------------------------------------------------
// THE GUARANTEE: it never decides anything
// ---------------------------------------------------------------------------

test("no gate, matrix, approval policy or parser imports the activity profile", () => {
  for (const file of ["policyEngine.js", "riskMatrix.js", "approvalPolicy.js", "requestParser.js", "intakeExtractor.js"]) {
    const source = repoFile(`src/uc04/${file}`);
    assert.ok(
      !source.includes("activityProfile") && !source.includes("ACTIVITY_QUESTIONS"),
      `src/uc04/${file} reaches for the activity profile — unverified free text must not decide`
    );
  }
});

test("the same request decides identically with and without an activity profile", () => {
  // The behavioural half of the guard above. Structure says nobody imports it;
  // this says nobody reached it another way.
  const employment = { id: "e", status: "active", company_id: "c", custom_fields: { workation_permission: true } };
  const decide = (activityProfile) =>
    evaluate({
      identityVerified: true,
      employment,
      factors: factors({ activityProfile }),
      now: "2026-09-01T00:00:00Z",
      travelHistory: [],
    });

  const without = decide(undefined);
  const alarming = decide({
    activitiesToBePerformed: "Negotiating and signing a distribution contract in a biosafety level 3 laboratory",
    institutionsVisited: "A government ministry",
    specialWorksite: "Manufacturing site",
  });
  assert.equal(alarming.decision, without.decision);
  assert.equal(alarming.reason, without.reason);
  assert.deepEqual(alarming.flags, without.flags);
});

test("the profile carries no state, tone or score for a renderer to draw", () => {
  // A verdict-shaped key here would invite a chip on the panel, and a chip is a
  // judgement nothing made.
  const described = describeActivityProfile(normalizeActivityProfile(SAID));
  assert.deepEqual(Object.keys(described).sort(), ["asked", "fields", "finding"]);
  for (const field of described.fields) {
    assert.deepEqual(Object.keys(field).sort(), ["absence", "key", "label", "value"]);
  }
});

// ---------------------------------------------------------------------------
// The prefill — one composition, so the two surfaces cannot drift
// ---------------------------------------------------------------------------

test("the employer's prefill is the employee's four answers, and nothing else", () => {
  const prefill = activityStatementPrefill(normalizeActivityProfile(SAID));
  // Every answer, under the label the specialist's panel uses for it, so the
  // manager's box and the sidebar cannot say different things about one trip.
  for (const question of ACTIVITY_QUESTIONS) {
    assert.ok(prefill.includes(question.label), `${question.key} is missing from the prefill`);
  }
  for (const value of Object.values(SAID)) {
    assert.ok(prefill.includes(value), `"${value}" is missing from the prefill`);
  }
  // NOTHING IS INVENTED. The prefill is a composition of what was said and
  // carries no sentence of its own — a manager reading it must not find a claim
  // nobody made sitting in a box they are about to sign.
  const composed = ACTIVITY_QUESTIONS.map((q) => `${q.label}: ${SAID[q.field]}`).join("\n");
  assert.equal(prefill, composed);
});

test("an unanswered question leaves no line, and no profile leaves no prefill", () => {
  // A LABEL WITH NOTHING AFTER IT IS WORSE THAN AN ABSENT LINE. It reads as an
  // answered question whose answer is empty, in a box the employer is about to
  // adopt as their own statement.
  const partial = activityStatementPrefill(normalizeActivityProfile({ specialWorksite: "none" }));
  assert.equal(partial, "Special worksites: none");
  assert.ok(!partial.includes("Activities to be performed"));

  // AND AN EMPTY PREFILL IS null, NEVER "". An empty string in a textarea is
  // indistinguishable from a field somebody cleared on purpose.
  assert.equal(activityStatementPrefill(null), null);
  assert.equal(activityStatementPrefill(normalizeActivityProfile({ activitiesToBePerformed: "  " })), null);
});

test("the prefill and the panel are the same four answers from one module", () => {
  // The owner's requirement stated exactly: the employer's field carries what
  // the specialist's panel shows. Both read the SAME normalised profile through
  // the SAME question list, so there is no second spelling of "what the
  // employee said" for one of them to get wrong.
  const profile = normalizeActivityProfile(SAID);
  const panel = describeActivityProfile(profile);
  const prefill = activityStatementPrefill(profile);
  for (const field of panel.fields) {
    if (field.value) assert.ok(prefill.includes(field.value), `${field.key} differs between the panel and the prefill`);
  }
});

// ---------------------------------------------------------------------------
// It reaches the panel
// ---------------------------------------------------------------------------

test("what the requester wrote is published on the basis, verbatim", () => {
  const profile = basisWith(SAID).activityProfile;
  assert.equal(profile.asked, true);
  const byKey = Object.fromEntries(profile.fields.map((f) => [f.key, f.value]));
  assert.equal(byKey.activities, SAID.activitiesToBePerformed);
  assert.equal(byKey.institutions, SAID.institutionsVisited);
  assert.equal(byKey.worksites, SAID.specialWorksite);
  assert.equal(byKey.workLocation, SAID.workLocation);
  assert.match(profile.finding, /read by nobody but you/);
});

test("a row with no profile still publishes the block, saying it was not asked", () => {
  const profile = basisWith(undefined).activityProfile;
  assert.equal(profile.asked, false);
  assert.equal(profile.fields.length, ACTIVITY_QUESTIONS.length);
});

test("the portal asks all four questions and the panel renders all four", () => {
  const html = repoFile("src/portal/assets/index.html");
  for (const id of ["uc04-activities", "uc04-institutions", "uc04-worksites", "uc04-workLocation"]) {
    assert.match(html, new RegExp(`id="${id}"`), `the portal does not ask ${id}`);
  }
  // Bounded in the browser as well as on the server — the server is the one
  // that counts, but a field that silently truncates on submit is a field the
  // requester thinks they answered.
  assert.equal((html.match(/maxlength="2000"/g) || []).length >= 4, true);

  const app = repoFile("src/portal/assets/app.js");
  assert.match(app, /activityProfile: \{/);

  const main = repoFile("zaf-app/assets/main.js");
  assert.match(main, /function renderActivityProfile\(view\)/);
  // NO STATE MARK. The server publishes no state because nothing judged it, and
  // a chip drawn here would be this bundle inventing an assessment.
  const block = main.slice(main.indexOf("function renderActivityProfile("), main.indexOf("function renderEmployee("));
  assert.ok(!/renderStateMark|factState|tone-/.test(block), "the panel is drawing a verdict nothing reached");
});
