// ---------------------------------------------------------------------------
// portalContinuationCompletions.test.js  —  finishing the form you were sent to
// ---------------------------------------------------------------------------
// THE REPORT, in the project owner's own words: *"if i am transferred from
// uc-03 to uc-04, some of my details are sent to, but clearly i do not know
// exactly what to put in the remaining empty fields to ensure a success or a
// failure, so this is where the 2nd prefill is. or have you solve this for a
// different employee apart from chris, and i just need to switch to him?"*
//
// The answer to the second half was NO, and that is the defect. A continuation
// carries five boxes and leaves five asking for things a travel request never
// states, and every UC-04 quick-fill on the page names Anna, Amanda or Lars as
// the traveller. So the only way to see what a valid answer looked like was to
// press a button that replaced the person the form was about — after which the
// server correctly refused the submission `continuation_subject_mismatch`.
// (test/portalScenarioSession.test.js pins the other half of that screen.)
//
// WHAT THE COMPLETIONS MUST NOT DO IS THE POINT OF THIS FILE. A completion
// writes ONLY into boxes the server listed as still needed. If it could ever
// write the traveller, the home country or the destination, it would be a
// quick-fill wearing a different label and would reproduce the very refusal it
// exists to prevent — so that is asserted first, and asserted as a property of
// the whole set rather than of the two that happen to exist today.
//
// WHY THE OUTCOME ASSERTIONS ARE POSITIVE. CLAUDE.md §5's standing lesson:
// "refusing correctly and being unable to succeed look identical from outside."
// One completion must reach the specialist's one-click approval and one must be
// stopped, and both are pinned by reason — a pair that quietly collapsed onto
// the same verdict would still pass a test that only checked "did not throw".
// ---------------------------------------------------------------------------

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";

import { buildCompletions, describeContinuation } from "../src/portal/uc03Continuation.js";
import { classifyRisk } from "../src/uc04/riskMatrix.js";

const here = dirname(fileURLToPath(import.meta.url));
const SOURCE = readFileSync(join(here, "..", "src", "portal", "assets", "app.js"), "utf8");

/** Every input a continuation can leave open, as the server names them. */
const ALL_NEEDED = [
  { input: "startDate / endDate" },
  { input: "nationality" },
  { input: "visaType" },
  { input: "jobDuties" },
  { input: "hasContractSigningAuthority" },
];

const HANDOFF = { origin_country: "US", destination_country: "PT" };

// --- 1. THE PROPERTY THAT MAKES A COMPLETION NOT A QUICK-FILL --------------

test("a completion never writes the traveller, the home country or the destination", () => {
  // The three fields whose replacement produced the reported 403. Asserted
  // against EVERY completion and every still-needed combination, not against
  // the two that exist today — the guarantee belongs to the function.
  const forbidden = ["uc04-employmentId", "uc04-homeCountry", "uc04-destinationCountry"];

  for (let mask = 1; mask < 1 << ALL_NEEDED.length; mask += 1) {
    const needed = ALL_NEEDED.filter((_, i) => mask & (1 << i));
    for (const completion of buildCompletions(HANDOFF, needed)) {
      for (const field of forbidden) {
        assert.equal(
          Object.prototype.hasOwnProperty.call(completion.fields, field),
          false,
          `${completion.id} writes ${field}. That replaces the person the continuation is about, and the server refuses the submission continuation_subject_mismatch.`
        );
      }
    }
  }
});

test("a completion writes only boxes the server said are still needed", () => {
  const needed = [{ input: "nationality" }, { input: "visaType" }];
  const allowed = new Set(["uc04-nationality", "uc04-visaType"]);

  for (const completion of buildCompletions(HANDOFF, needed)) {
    for (const field of Object.keys(completion.fields)) {
      assert.ok(allowed.has(field), `${completion.id} filled ${field}, which the routing already carried`);
    }
  }
});

test("nothing still needed means nothing to offer", () => {
  // A routing that carried everything is ready to submit. Offering to "fill the
  // rest" there would be offering to overwrite what it carried.
  assert.deepEqual(buildCompletions(HANDOFF, []), []);
});

test("a nationality is only suggested when there is a home country to suggest", () => {
  // NATIONALITY_IS_ASKED is the standing rule: the employment record does not
  // hold nationality, so nothing infers it. The completion offers the home
  // country into an editable box as a worked example — and when the routing
  // read no home country either, it offers nothing rather than a blank claim.
  const [routine] = buildCompletions({ destination_country: "PT" }, [{ input: "nationality" }]);
  assert.equal(Object.prototype.hasOwnProperty.call(routine.fields, "uc04-nationality"), false);

  const [withHome] = buildCompletions(HANDOFF, [{ input: "nationality" }]);
  assert.equal(withHome.fields["uc04-nationality"], "US");
});

// --- 2. THE VISA COMES FROM THE MATRIX, NOT FROM A GUESS -------------------

test("the suggested visa is the one the destination's own rule expects", () => {
  // US and Canada hard-block anything but a work permit (riskMatrix.js's
  // us_requires_work_permit / ca_requires_work_permit). A completion offering a
  // Schengen short stay for Toronto would be a button that can only ever be
  // blocked, which is the "gate with no positive example" shape this repo has
  // paid for three times.
  const visaFor = (dest) =>
    buildCompletions({ origin_country: "US", destination_country: dest }, [{ input: "visaType" }])[0].fields[
      "uc04-visaType"
    ];

  assert.equal(visaFor("US"), "work_permit");
  assert.equal(visaFor("CA"), "work_permit");
  assert.equal(visaFor("PT"), "digital_nomad_visa", "PT has a digital-nomad route and is exempt from the Schengen block for it");
  assert.equal(visaFor("ES"), "schengen_short_stay");
  assert.equal(visaFor("GB"), "business_visa", "the neutral option — it raises nothing by itself, so the duties decide");
});

// --- 3. THE TWO OUTCOMES, RUN THROUGH THE REAL MATRIX ----------------------

test("the two completions land on opposite sides of the specialist's desk", () => {
  const [routine, senior] = buildCompletions(HANDOFF, ALL_NEEDED);

  const run = (fields) =>
    classifyRisk({
      homeCountry: "US",
      destinationCountry: "PT",
      nationality: fields["uc04-nationality"],
      visaType: fields["uc04-visaType"],
      jobDuties: fields["uc04-jobDuties"],
      hasContractSigningAuthority: fields["uc04-hasContractSigningAuthority"] === true,
      startDate: fields["uc04-startDate"],
      endDate: fields["uc04-endDate"],
      travelHistory: [],
      now: fields["uc04-now"],
    });

  const clean = run(routine.fields);
  assert.notEqual(clean.riskLevel, "blocked", `the routine completion was blocked: ${clean.reasons.join(", ")}`);
  assert.deepEqual(clean.reasons, [], "the routine completion raised something — it is meant to be the approvable one");

  const risky = run(senior.fields);
  assert.equal(risky.riskLevel, "high", "an executive who can sign contracts abroad is the matrix's highest PE exposure");
});

test("the two differ in exactly the two values a traveller states about themselves", () => {
  // Not in the visa, not in the dates, not in the nationality — so the contrast
  // the reader sees is about the TRIP and never about the person. A pair that
  // also moved the visa would demonstrate two things at once and teach neither.
  const [routine, senior] = buildCompletions(HANDOFF, ALL_NEEDED);
  const differing = Object.keys(routine.fields).filter((k) => routine.fields[k] !== senior.fields[k]);
  assert.deepEqual(differing.sort(), ["uc04-hasContractSigningAuthority", "uc04-jobDuties"]);
});

// --- 4. THE PAYLOAD THE PAGE ACTUALLY RECEIVES ----------------------------

test("describeContinuation carries the completions, and an unavailable one carries none", () => {
  // The shape is identical either way so a caller cannot forget to check —
  // the same rule the rest of that payload already follows.
  const unavailable = describeContinuation({ handoffEvent: null, intake: null, caseRow: null });
  assert.deepEqual(unavailable.completions, []);

  const available = describeContinuation({
    handoffEvent: HANDOFF,
    intake: { missing: ALL_NEEDED.map((n) => ({ ...n, label: n.input, why: "…" })) },
    caseRow: { id: "case-1", externalRef: "9002" },
  });
  assert.equal(available.completions.length, 2);
});

// --- 5. THE BROWSER HALF: pressing one keeps the link -----------------------

/** One function's source, by name, up to the next named thing. */
function cut(name, until) {
  const start = SOURCE.indexOf(`function ${name}(`);
  const end = SOURCE.indexOf(until, start);
  assert.ok(start !== -1 && end > start, `${name}() has moved — re-point this test`);
  return SOURCE.slice(start, end);
}

/**
 * applyCompletion(), out of the shipped file, in a stub DOM.
 *
 * clearContinuation() is present AS A SPY rather than absent, so "it was never
 * called" is something this test observes rather than something it assumes from
 * the function not throwing.
 */
function pressCompletion(completion, { existing = {} } = {}) {
  const calls = { clearContinuation: 0, refreshGapMarks: 0 };
  const boxes = {};
  for (const [id, value] of Object.entries(existing)) boxes[id] = { value, type: "text" };

  const context = {
    byId: (id) => {
      if (!boxes[id]) boxes[id] = { value: "", type: id === "uc04-hasContractSigningAuthority" ? "checkbox" : "text", checked: false };
      return boxes[id];
    },
    setFieldValue: (node, raw) => {
      node.value = raw === null || raw === undefined ? "" : String(raw);
    },
    refreshGapMarks: () => {
      calls.refreshGapMarks += 1;
    },
    clearContinuation: () => {
      calls.clearContinuation += 1;
    },
  };
  vm.createContext(context);
  vm.runInContext(cut("applyCompletion", "\n  // "), context);
  vm.runInContext("applyCompletion(COMPLETION)", Object.assign(context, { COMPLETION: completion }));
  return { boxes, calls };
}

test("pressing a completion does not drop the continuation", () => {
  // The opposite rule from applyScenario(), and deliberately so: a quick-fill
  // states a whole other request, a completion answers the questions THIS
  // request left open. If this ever calls clearContinuation(), the two
  // decisions stop landing under one reference and the link the reader was sent
  // here by is silently gone.
  const [routine] = buildCompletions(HANDOFF, ALL_NEEDED);
  const { calls } = pressCompletion(routine);
  assert.equal(calls.clearContinuation, 0);
  assert.equal(calls.refreshGapMarks, 1, "the 'still needed' markers were never re-read, so filled boxes keep asking");
});

test("pressing a completion leaves the traveller the routing carried", () => {
  const [routine] = buildCompletions(HANDOFF, ALL_NEEDED);
  const { boxes } = pressCompletion(routine, {
    existing: {
      "uc04-employmentId": "8ab12460-b568-4c1e-af9d-09b1fabd8f46",
      "uc04-destinationCountry": "PT",
    },
  });

  assert.equal(boxes["uc04-employmentId"].value, "8ab12460-b568-4c1e-af9d-09b1fabd8f46");
  assert.equal(boxes["uc04-destinationCountry"].value, "PT");
  assert.equal(boxes["uc04-jobDuties"].value, "engineering", "the completion did not fill what it was for");
});

test("a boolean lands on the checkbox as a checkbox, not as the string 'false'", () => {
  // setFieldValue() would write "false" into `.value`, which a checkbox ignores
  // — so the box would stay unticked for the routine completion (right answer,
  // wrong reason) and ALSO stay unticked for the senior one (wrong answer,
  // silently), collapsing the one contrast the pair exists to show.
  const [routine, senior] = buildCompletions(HANDOFF, ALL_NEEDED);
  assert.equal(pressCompletion(routine).boxes["uc04-hasContractSigningAuthority"].checked, false);
  assert.equal(pressCompletion(senior).boxes["uc04-hasContractSigningAuthority"].checked, true);
});
