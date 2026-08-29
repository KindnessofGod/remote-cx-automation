// ---------------------------------------------------------------------------
// employees.js  —  Demo employees the Remote UI stand-in can submit for
// ---------------------------------------------------------------------------
// These are MOCK identities, matching the fixtures in src/remote/mockServer.js.
// All of them sit under the mock company `co_amend_01`, which is also the
// company on every session in server.js's DEMO_SESSIONS — so identity
// verification passes for them and correctly fails closed for anyone else.
//
// Deliberately NOT the real Sandbox contacts from src/livedemo/employees.js:
// UC-06's Remote reads are mock-only in this build (docs/use-cases/UC-06.md
// §15), so the current contract values this page prefills come from the mock
// server, and a real Sandbox UUID would 404 against it.
//
// ---------------------------------------------------------------------------
// WHY THE ROSTER IS DUTCH NOW, AND WHY THAT IS NOT COSMETIC
// ---------------------------------------------------------------------------
// This list used to be three NIGERIAN employments (emp_active_001,
// emp_active_003, emp_terminated_002). Every one of them made UC-06
// structurally incapable of succeeding, and nothing said so.
//
// UC-06 validates against the CONTRACT-AMENDMENT form
// (`GET /v1/contract-amendments/schema`), not `employment_basic_information`
// — see src/uc06/policyEngine.js's header for the three independent reasons.
// Live, that endpoint answers **500 for NGA and for USA** and there is no
// amendment form for either country; src/remote/fixtures/
// contractAmendmentSchemas.js reproduces that faithfully
// (`CONTRACT_AMENDMENT_SCHEMA_ERRORS = { NGA: 500, USA: 500 }`) and carries
// real forms only for NLD, DEU, GBR, POL and CHE.
//
// So when UC-06 was repointed at the amendment form, this roster was left
// behind, and the consequence was total: EVERY amendment anyone could submit
// from this page escalated `country_schema_unavailable` at a gate two steps
// ahead of the one the scenario claimed to demonstrate. The "After cutoff"
// scenario never reached the cutoff engine. The "Before cutoff" scenario —
// the ordinary dual-approval path, the whole point of the use case — could
// not reach `dual_approval_required` under any input. Production agrees:
// across 28 `audit_log` rows UC-06 has never once recorded its own success
// outcome.
//
// That is the exact failure shape this project keeps paying for: a use case
// that CANNOT succeed and one that is being appropriately cautious look
// identical from outside, and only a positive case tells them apart. The
// roster below is that positive case, made reachable.
//
// The two Nigerian records are KEPT, on purpose, and labelled for what they
// actually demonstrate. Deleting them would hide a real and permanent
// property of the live API behind a roster that only ever shows the happy
// path — and "some countries have no amendment form at all" is a fact a
// reviewer of this system should see, not one it should paper over.
// ---------------------------------------------------------------------------

export const REMOTE_UI_EMPLOYEES = [
  {
    id: "emp_nl_amend_001",
    name: "Jan Willem Bakker",
    email: "jan.bakker@acme.test",
    companyId: "co_amend_01",
    note: "Netherlands, full-time, active — the ordinary path. Reaches dual approval when the cutoff has not locked.",
  },
  {
    id: "emp_nl_amend_003",
    name: "Sanne de Groot",
    email: "sanne.degroot@acme.test",
    companyId: "co_amend_01",
    note: "Netherlands, full-time, active — a second amendable record, kept apart from Jan's so a run that mutates one cannot corrupt the other's fixture.",
  },
  {
    id: "emp_nl_parttime_006",
    name: "Anna van Vliet",
    email: "anna.vanvliet@acme.test",
    companyId: "co_amend_01",
    note: "Netherlands, PART-TIME, active — the amendment form's part_time branch demands default_weekly_hours and part_time_salary_confirmation, which no record supplies, so this one escalates schema_invalid naming exactly those.",
  },
  {
    id: "emp_terminated_002",
    name: "Kofi Mensah",
    email: "kofi@acme.test",
    companyId: "co_amend_01",
    note: "Nigeria, TERMINATED — the employment-active gate escalates any amendment for them, ahead of every later gate.",
  },
  {
    id: "emp_active_001",
    name: "Amara Okafor",
    email: "amara@acme.test",
    companyId: "co_amend_01",
    note: "Nigeria, active — but Remote publishes NO contract-amendment form for NGA (the endpoint 500s), so no amendment for this employee can ever be validated. Kept to show that refusal honestly rather than hide it.",
  },
];

/**
 * Countries for which Remote publishes no contract-amendment form at all, so
 * an amendment can never be schema-validated for an employee based there.
 *
 * This is NOT a policy this page enforces — src/uc06/policyEngine.js still runs
 * every gate in order and still refuses on its own terms. It exists so the page
 * can EXPLAIN a refusal it already received, and so a reviewer reading the
 * roster can tell "this environment is broken" apart from "this country has no
 * form", which `country_schema_unavailable` alone cannot distinguish.
 *
 * [CONFIRMED live 2026-08-18 against gateway.remote-sandbox.com — see
 * src/remote/restClient.js's getContractAmendmentSchema() header and
 * src/remote/fixtures/contractAmendmentSchemas.js's
 * CONTRACT_AMENDMENT_SCHEMA_ERRORS, which mirrors it.]
 */
export const NO_AMENDMENT_FORM_EMPLOYMENTS = Object.freeze({
  emp_active_001: "Nigeria",
  emp_terminated_002: "Nigeria",
});
