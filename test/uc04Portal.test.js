// ---------------------------------------------------------------------------
// uc04Portal.test.js — the UC-04 intake form's own vocabulary must be the
//                      policy engine's vocabulary
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
// The portal's UC-04 form asks for the five structured factors as dropdowns,
// and `src/uc04/policyEngine.js` validates two of them against fixed sets
// (`VALID_VISA_TYPES`, `VALID_JOB_DUTIES`). Nothing connected the two, so they
// drifted, and the drift was invisible from every direction that was being
// looked at:
//
//   * `digital_nomad`  — the engine's member is `digital_nomad_visa`
//   * `none`           — not a visa type the engine has at all
//   * `management`     — the engine's category is `executive`
//
// Each of those returned `blocked / factors_invalid`. That reads on screen as
// a POLICY refusal — the system judging the request and saying no — when it
// was the form and the engine disagreeing about a spelling. Three of the
// form's five visa options and two of its five duty options were dead.
//
// The structural half is worse than the spelling half:
//
//   * `work_permit` was not offered, and riskMatrix.js hard-blocks the US and
//     Canada for every other visa type. So NO US or Canadian workation could
//     ever be approved from this page. Every attempt came back `blocked`, and
//     a gate that only ever refuses is indistinguishable from a gate being
//     appropriately cautious — this repo's most expensive recurring lesson.
//   * `executive` and `legal` were not offered, and they are the two duty
//     categories that raise the matrix's permanent-establishment flag. The
//     matrix's headline risk rule could not be reached from the intake surface
//     at all, while "Management" — the option a user would pick for exactly
//     that traveller — was rejected as malformed input.
//
// Every quick-fill scenario used one of the working combinations, which is why
// the suite stayed green. So this file asserts BOTH directions:
//   1. every option the form offers is a value the engine accepts, and
//   2. the options that must reach a non-refusing outcome actually do —
//      driven through the REAL evaluate(), never a restatement of it.
// ---------------------------------------------------------------------------

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { evaluate, VALID_VISA_TYPES, VALID_JOB_DUTIES } from "../src/uc04/policyEngine.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const HTML = readFileSync(join(__dirname, "..", "src", "portal", "assets", "index.html"), "utf8");

/**
 * The `value=""` attributes of one `<select id="...">` in the portal page.
 * Read out of the real file rather than restated here — a local copy of the
 * list would share whatever mistake the page has and compare equal, which is
 * the failure mode this whole file exists to remove.
 */
function optionValues(selectId) {
  const open = HTML.indexOf(`<select id="${selectId}"`);
  assert.notEqual(open, -1, `no <select id="${selectId}"> in the portal page`);
  const close = HTML.indexOf("</select>", open);
  assert.notEqual(close, -1, `unclosed <select id="${selectId}">`);
  const block = HTML.slice(open, close);
  return [...block.matchAll(/<option value="([^"]*)"/g)].map((m) => m[1]);
}

const employment = {
  id: "emp_active_001",
  status: "active",
  company_id: "co_amend_01",
  custom_fields: { workation_permission: true },
};

const factorsFor = (over = {}) => ({
  homeCountry: "DE",
  nationality: "DE",
  destination: { country: "ES" },
  startDate: "2026-09-01",
  endDate: "2026-09-14",
  visaType: "schengen_short_stay",
  jobDuties: "engineering",
  hasContractSigningAuthority: false,
  ...over,
});

const decide = (over) =>
  evaluate({ identityVerified: true, employment, factors: factorsFor(over), now: "2026-08-15" });

// ---------------------------------------------------------------------------
// 1. Vocabulary: the form may not offer a value the engine refuses.
// ---------------------------------------------------------------------------

test("every visa option the UC-04 form offers is a value policyEngine.js accepts", () => {
  const offered = optionValues("uc04-visaType");
  // The empty first option is the "not stated" placeholder. It is deliberately
  // NOT a member: an unstated visa IS an incomplete request and the engine
  // refusing it is correct. Every other option must be real.
  assert.equal(offered[0], "", "the first option should be the 'not stated' placeholder");
  const real = offered.slice(1);
  assert.ok(real.length > 0, "the form offers no visa types at all");
  for (const value of real) {
    assert.ok(
      VALID_VISA_TYPES.has(value),
      `the form offers visaType="${value}", which policyEngine.js refuses as invalid_visa_type`
    );
  }
});

test("every duties option the UC-04 form offers is a value policyEngine.js accepts", () => {
  const offered = optionValues("uc04-jobDuties");
  assert.equal(offered[0], "", "the first option should be the 'not stated' placeholder");
  for (const value of offered.slice(1)) {
    assert.ok(
      VALID_JOB_DUTIES.has(value),
      `the form offers jobDuties="${value}", which policyEngine.js refuses as invalid_job_duties`
    );
  }
});

// ---------------------------------------------------------------------------
// 2. Reachability: the outcomes that matter must be reachable FROM THE FORM.
//    A vocabulary check alone would pass on a form offering one safe option.
// ---------------------------------------------------------------------------

test("POSITIVE — the form can state a visa that gets a US workation approved", () => {
  const offered = optionValues("uc04-visaType").filter(Boolean);
  const approved = offered.filter(
    (visaType) => decide({ destination: { country: "US" }, visaType }).decision === "ready_for_approval"
  );
  assert.deepEqual(
    approved,
    ["work_permit"],
    "riskMatrix.js hard-blocks the US for every visa but work_permit, so the form must offer work_permit — " +
      "without it every US workation filed here is blocked and the gate can never be seen to pass"
  );
});

test("POSITIVE — the form can state a visa that gets a Canadian workation approved", () => {
  const offered = optionValues("uc04-visaType").filter(Boolean);
  const approved = offered.filter(
    (visaType) => decide({ destination: { country: "CA" }, visaType }).decision === "ready_for_approval"
  );
  assert.deepEqual(approved, ["work_permit"], "same hard block as the US, same requirement on the form");
});

test("POSITIVE — the form can state a duty that raises the matrix's permanent-establishment flag", () => {
  const offered = optionValues("uc04-jobDuties").filter(Boolean);
  const peRaising = offered.filter((jobDuties) => decide({ jobDuties }).flags.includes("pe_risk_dape"));
  // sales, legal and executive all raise it in riskMatrix.js. The form must
  // offer at least the executive one — it is the highest-exposure traveller
  // UC-04 exists to catch, and the option that used to stand in its place
  // ("management") was refused as malformed input instead.
  assert.ok(
    peRaising.includes("executive"),
    `the form cannot state an executive traveller; PE-raising options it does offer: ${JSON.stringify(peRaising)}`
  );
  assert.ok(peRaising.length >= 2, "more than one duty category should be able to raise PE risk");
});

test("POSITIVE — the form can state a visa that reaches the visitor-visa hard block", () => {
  // The matrix's most-cited block ("a tourist visa forbids active work") was
  // unreachable: neither tourist_visa nor esta_usa was offered.
  const offered = optionValues("uc04-visaType").filter(Boolean);
  const blocked = offered.filter(
    (visaType) => decide({ visaType }).reason === "visitor_visa_active_work_forbidden"
  );
  assert.ok(
    blocked.length >= 1,
    "no option on the form can express a visitor visa, so the matrix's visitor-visa rule cannot be demonstrated"
  );
});

test("POSITIVE — the form can state the digital-nomad visa the matrix has DNV rules for", () => {
  const offered = optionValues("uc04-visaType");
  assert.ok(
    offered.includes("digital_nomad_visa"),
    "the form offered `digital_nomad` (rejected) instead of `digital_nomad_visa` (the engine's member)"
  );
  // PT is in riskMatrix.js's DNV_COUNTRIES, so a DNV there skips the Schengen
  // 90/180 branch entirely and must reach the approval route.
  const out = decide({ destination: { country: "PT" }, visaType: "digital_nomad_visa" });
  assert.equal(out.decision, "ready_for_approval");
  assert.equal(out.reason, "all_gates_passed");
});
