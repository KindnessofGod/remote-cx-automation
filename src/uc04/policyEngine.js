// ---------------------------------------------------------------------------
// policyEngine.js  —  UC-04's deterministic gates
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
// Same role as src/uc01/policyEngine.js and src/uc06/policyEngine.js: this
// is the system's judgment, and it contains no AI. Ordered gates, first
// failure wins — "when in doubt, reduce automation" (the same principle every
// other use case's policy engine follows):
//
//   1. identity      — is the requester an authorized actor for this company?
//   2. employment    — is this employee still active? (no workation for exits)
//   3. sanctions     — is the requested destination sanctioned/restricted
//                      (imported from UC-03's SANCTIONED_OR_RESTRICTED, not
//                      copied — see the import below)? Checked BEFORE the
//                      employer-permission gate and the risk matrix, on
//                      purpose: it must not depend on the employer having
//                      (or lacking) blanket workation permission, or on the
//                      rest of the request being well-formed. A sanctioned
//                      destination was previously indistinguishable from an
//                      ordinary risk-matrix "escalate" — and workflow.js
//                      creates a real Remote work-authorization record for
//                      BOTH "ready_for_approval" and "escalate", so a
//                      sanctioned-destination request could reach a
//                      one-click specialist approve AND produce a real
//                      Remote write. "blocked" is the only decision
//                      workflow.js never creates that record for.
//   4. permission    — has the employer granted workation permission via the
//                      custom field? (the spec's "Employer permission (custom
//                      field) verification" gate, §7)
//   5. factors       — are the 5 structured factors a complete, well-formed
//                      request? (the same shape UC-06 demands for `changes`)
//   6. risk          — origin→destination risk-matrix classification; the
//                      matrix's "blocked" overrides any approval the human
//                      might offer (illegal visa × active work is illegal,
//                      not a "let's double-check" situation)
//
// The risk matrix returns its own level: "blocked" means the matrix itself
// found something the matrix is not allowed to overlook. "low" | "medium" |
// "high" are the soft levels — none of them block, but high escalates
// straight to Mobility Legal Tier-2 per UC-04.md §5 ("high-risk pair OR
// cumulative days > 30 → lock toggles → escalate Mobility Legal Tier-2").
// The "low" and "medium" levels are exactly the cases the HITL gate is
// designed for: dossier + drafted summary, specialist approves.
// ---------------------------------------------------------------------------

import { classifyRisk as classifyRiskMatrix } from "./riskMatrix.js";
// The one place country codes are placed on a single axis. riskMatrix.js
// already normalises everything it reads; the sanctions gate below did not,
// which is the whole of finding F-13's tail in this file.
import { normalizeCountryCode, normalizeCountrySet } from "../shared/countryCodes.js";
// Imported, not copied — a jurisdiction property (which countries are
// sanctioned/restricted) is cross-cutting, not per-use-case. UC-03's
// policyEngine.js is the one place that set is defined; UC-04 reuses it
// rather than maintaining a second list that can silently drift from the
// first. See UC-03's own comment on SANCTIONED_OR_RESTRICTED for why the
// list is illustrative, not Remote's authoritative compliance list.
import { SANCTIONED_OR_RESTRICTED } from "../uc03/policyEngine.js";
import { bindGateDescriptions } from "../shared/gateLadder.js";

/**
 * EXPORTED so the intake form can be checked AGAINST it rather than agreeing
 * with it by hand. src/portal/assets/index.html's UC-04 selects offered three
 * values this set does not contain — `digital_nomad` (this set says
 * `digital_nomad_visa`), `none`, and the empty default — so a third of the
 * form's own options returned `blocked / factors_invalid`, which reads as a
 * policy refusal and was a vocabulary mismatch. `work_permit` was missing from
 * the form entirely, and it is the only member that clears riskMatrix.js's US
 * and Canada hard blocks, so no US or Canadian workation could be approved
 * from that page at all. test/uc04Portal.test.js now reads the HTML and
 * compares.
 */
export const VALID_VISA_TYPES = new Set([
  "schengen_short_stay", "esta_usa", "digital_nomad_visa", "tourist_visa",
  "business_visa", "work_permit", "other",
]);

/** Exported for the same reason — the form offered `management`, which is not
 * a member; the traveller it describes is `executive`, the matrix's highest
 * permanent-establishment risk. */
export const VALID_JOB_DUTIES = new Set([
  "engineering", "support", "operations", "sales", "legal", "executive", "other",
]);

/**
 * @param {object} factors
 * @returns {string[]} any "missing_*" / "invalid_*" reasons; empty if all five
 *   factors are well-formed
 */
function factorValidationIssues(factors) {
  if (!factors || typeof factors !== "object") {
    return ["factors_missing"];
  }
  const issues = [];
  if (!factors.homeCountry || typeof factors.homeCountry !== "string") issues.push("missing_home_country");
  if (!factors.destination || typeof factors.destination !== "object" || !factors.destination.country) {
    issues.push("missing_destination_country");
  }
  if (!factors.nationality || typeof factors.nationality !== "string") issues.push("missing_nationality");
  if (!factors.startDate || !factors.endDate) issues.push("missing_dates");
  if (!factors.visaType || !VALID_VISA_TYPES.has(factors.visaType)) issues.push("invalid_visa_type");
  if (!factors.jobDuties || !VALID_JOB_DUTIES.has(factors.jobDuties)) issues.push("invalid_job_duties");
  if (typeof factors.hasContractSigningAuthority !== "boolean") issues.push("missing_signing_authority");
  return issues;
}

/**
 * The decision: who should see this, in what form, with what caveats?
 *
 * @param {object} args
 * @param {boolean} args.identityVerified
 *   requester is an authenticated actor for the employment's company.
 *   "Unauthenticated" is fine (UC-04 is hit by Remote's own webhook; the
 *   webhook itself is the authenticated signal — see 00-FOUNDATION.md §2's
 *   Remote-native-webhook path), but the session.companyId must match the
 *   employment's company_id, same as UC-06.
 * @param {object|null} args.employment
 *   normalized employment record. Must be active and carry a
 *   custom_fields.workation_permission boolean.
 * @param {object|null} args.factors
 *   the five structured factors — see the type below.
 * @param {string} [args.now]
 *   "YYYY-MM-DD" for the matrix's "start in the past" check. Defaults to
 *   real `new Date().toISOString()` when omitted (callers should pass an
 *   explicit value in tests for reproducibility).
 * @param {Array<{country:string, startDate:string, endDate:string}>} [args.travelHistory]
 * @param {Set<string>} [args.sanctionedRegions]
 *   destinations that are a hard `blocked` no matter what — checked BEFORE
 *   the employer-permission gate and the risk matrix, same "defense in
 *   depth, independent of every other gate" placement as UC-03's own
 *   sanctions check. Defaults to the imported `SANCTIONED_OR_RESTRICTED`;
 *   overridable so tests can exercise the gate without depending on the
 *   real list's exact contents.
 * @param {Set<string>|string[]} [args.restrictedJurisdictions]
 *   fed into the risk matrix's own jurisdiction-awareness (a distinct,
 *   later concern from the early sanctions block above — this is what the
 *   matrix's scoring sees, not a second copy of the same gate). Omit to use
 *   riskMatrix.js's RESTRICTED_JURISDICTIONS — the same underlying set
 *   `sanctionedRegions` defaults to, imported once from UC-03. Passing an
 *   EMPTY set disables the screen; that is a deliberate act, not a default.
 *
 * @returns {{
 *   decision: "ready_for_approval"|"escalate"|"blocked",
 *   reason: string,
 *   flags: string[],
 *   risk: object,
 *   factorIssues: string[]
 * }}
 */
export function evaluate({
  identityVerified,
  employment,
  factors,
  now,
  travelHistory = [],
  sanctionedRegions = SANCTIONED_OR_RESTRICTED,
  restrictedJurisdictions,
}) {
  if (!identityVerified) {
    return {
      decision: "escalate",
      reason: "identity_not_verified",
      flags: ["identity_not_verified"],
      risk: null,
      factorIssues: [],
    };
  }

  if (!employment || employment.status !== "active") {
    return {
      decision: "escalate",
      reason: "employee_not_active",
      flags: ["employee_not_active"],
      risk: null,
      factorIssues: [],
    };
  }

  // Sanctioned/restricted destination -> HARD block, checked independently
  // of (and BEFORE) the employer-permission gate and the risk matrix. Before
  // this check existed, a sanctioned destination fell through to the risk
  // matrix like any other pair — the matrix has no notion of sanctions, so
  // depending on the other four factors it could land on "ready_for_approval"
  // or "escalate", and workflow.js acted on BOTH of those decisions (it used to
  // call remote.createWorkAuthorization() for each; since 2026-08-19 it RESOLVES
  // the Remote request an employee already raised, because no create endpoint
  // exists — see workflow.js's header). Either way a sanctioned-destination
  // request reached Remote's work-authorization resource, and on
  // "ready_for_approval" reached a one-click specialist approve. "blocked" is
  // the one decision workflow.js touches Remote for not at all, so this must
  // resolve to "blocked", not "escalate" — an escalation is still routed toward
  // eventual approval machinery; a sanctioned destination must never be.
  // The destination is read directly off `factors` (not the risk matrix's
  // input) so this check runs even when other factors are still being
  // validated — a sanctioned destination should never depend on the rest of
  // the request being well-formed to be caught.
  //
  // BOTH SIDES OF THE COMPARISON ARE NORMALISED, and that is not tidiness.
  // `Set.has()` is case-sensitive, so `"ir"` matched nothing here and the gate
  // was simply skipped — the request carried on to the employer-permission
  // gate, the factors gate, and finally the risk matrix's own jurisdiction
  // screen, which DOES normalise and so blocked it. Same verdict, different
  // gate, and therefore a different recorded reason whenever anything in
  // between refused first: a lowercase `"ir"` on a record without workation
  // permission was filed as `employer_permission_not_granted`, and with a
  // malformed factor as `factors_invalid`. A specialist reading either one
  // would go looking for a permissions or data problem and never learn the
  // destination was sanctioned. This is finding F-13 exactly, in the one file
  // that had not had it applied — UC-03's own header says why: "a sanctions
  // control whose correctness depends on a different gate downstream is not a
  // control." Proven from the portal UI: `IR` and `ir`, identical in every
  // other field, took different paths through this function.
  const requestedDestination = normalizeCountryCode(factors?.destination?.country);
  if (requestedDestination && normalizeCountrySet(sanctionedRegions).has(requestedDestination)) {
    // WHY THE MATRIX STILL RUNS FOR A BLOCK THAT IS ALREADY DECIDED.
    // This gate returned `risk: null`, and that null is not free: `tripDays`,
    // `cumulativeDays` and `riskLevel` all come off `risk` in workflow.js, so
    // the durable `uc04_authorizations` row and the summary the specialist
    // reads said "an undetermined number of days" about a trip with two
    // perfectly readable dates. That is a manufactured ABSENCE, the mirror of
    // the manufactured zero F-32 removed — and it was visible from the portal:
    // `IR` (caught here, risk null) reported no trip length while `ir` (caught
    // by the matrix, before the normalisation above) reported 14 days, for the
    // same request.
    //
    // It is also what the two `test.todo()`s in test/n8nUc04Parity.test.js
    // described. The n8n port has no early sanctions gate at all — its
    // restricted screen lives inside the matrix — so it always produced the
    // full risk object and the complete flag set, and the two copies could not
    // be compared on either. Running the matrix here reconciles them without
    // giving up what the early placement buys: the DECISION is still made by
    // this gate, before employer permission and before factor validation, so a
    // sanctioned destination is still caught on a request the matrix could
    // never have been run on at all.
    //
    // Which is why the matrix is run only when the factors are well-formed
    // enough for it to mean anything. When they are not, `risk` stays null —
    // honest, because nothing computed it — and the single flag stands.
    const canScore = factorValidationIssues(factors).length === 0;
    const risk = canScore
      ? classifyRiskMatrix({
          homeCountry: factors.homeCountry,
          destinationCountry: factors.destination.country,
          nationality: factors.nationality,
          visaType: factors.visaType,
          jobDuties: factors.jobDuties,
          hasContractSigningAuthority: factors.hasContractSigningAuthority,
          startDate: factors.startDate,
          endDate: factors.endDate,
          now: now ?? new Date().toISOString(),
          travelHistory,
          restrictedJurisdictions,
        })
      : null;
    // `sanctioned_region` is prepended when the matrix did not raise it
    // itself. It normally does — its jurisdiction screen reads the same set —
    // but a caller may pass an empty `restrictedJurisdictions` to disable the
    // matrix's screen while leaving `sanctionedRegions` populated, and this
    // gate's whole claim is that it does not depend on that one.
    const flags =
      risk && risk.flags.includes("sanctioned_region")
        ? risk.flags
        : ["sanctioned_region", ...(risk?.flags ?? [])];
    return {
      decision: "blocked",
      reason: "sanctioned_region",
      flags,
      risk,
      factorIssues: [],
    };
  }

  if (!employment.custom_fields || employment.custom_fields.workation_permission !== true) {
    return {
      decision: "blocked",
      reason: "employer_permission_not_granted",
      flags: ["employer_permission_not_granted"],
      risk: null,
      factorIssues: [],
    };
  }

  const factorIssues = factorValidationIssues(factors);
  if (factorIssues.length > 0) {
    return {
      decision: "blocked",
      reason: "factors_invalid",
      flags: ["factors_invalid", ...factorIssues],
      risk: null,
      factorIssues,
    };
  }

  // Default `now` to a real timestamp; tests pass an explicit one.
  const effectiveNow = now ?? new Date().toISOString();

  const risk = classifyRiskMatrix({
    homeCountry: factors.homeCountry,
    destinationCountry: factors.destination.country,
    nationality: factors.nationality,
    visaType: factors.visaType,
    jobDuties: factors.jobDuties,
    hasContractSigningAuthority: factors.hasContractSigningAuthority,
    startDate: factors.startDate,
    endDate: factors.endDate,
    now: effectiveNow,
    travelHistory,
    // Undefined here means "use the matrix's own default set" — never an
    // empty set, which would disable the screen. Threaded through rather than
    // read from the matrix directly so a caller that has fetched Remote's
    // country registry can supply its actual exclusions; UC-04's workflow does
    // not fetch `GET /v1/countries` today (UC-03 does), and it deliberately
    // does not start here: adding a required network read to this path would
    // make every workation request fail closed on an unrelated registry
    // outage, to tighten a screen the static list already covers. The seam is
    // open for whoever decides that trade differently.
    restrictedJurisdictions,
  });

  // The matrix's "blocked" level is not a soft finding — the matrix has
  // identified something the specialist's approve is not allowed to paper
  // over. We return blocked; the workflow will not call submitApproval on
  // a blocked case (the store + approval policy refuse it server-side).
  if (risk.riskLevel === "blocked") {
    return {
      decision: "blocked",
      reason: risk.reasons[0] ?? "risk_matrix_blocked",
      flags: risk.flags,
      risk,
      factorIssues: [],
    };
  }

  if (risk.riskLevel === "high") {
    // The spec's "high-risk pair → escalate Mobility Legal Tier-2" rule. A
    // HITL gate exists for low/medium, but high is the case where AI may
    // not even prepare a 1-click path — dossier + escalation only.
    //
    // An unevaluated destination (UC-04.md §3's escalate-by-default, finding
    // F-14) reaches the same escalation, but says so in its own words: the
    // specialist reading "high_risk_pair" would go looking for a risk the
    // matrix found, when what actually happened is that the matrix has no
    // rules for this country at all. Different investigation, different
    // reason string.
    return {
      decision: "escalate",
      reason: risk.flags.includes("destination_out_of_scope")
        ? "destination_out_of_scope"
        : "high_risk_pair",
      flags: risk.flags,
      risk,
      factorIssues: [],
    };
  }

  // low or medium: the human approves. The matrix's soft flags travel
  // through so the specialist sees what to weigh (e.g. "tax_residency_watch"
  // on a 60-day DE→ES trip).
  return {
    decision: "ready_for_approval",
    reason: "all_gates_passed",
    flags: risk.flags,
    risk,
    factorIssues: [],
  };
}

// ---------------------------------------------------------------------------
// GATE_SEQUENCE  —  what each reason MEANS, and where in the order it sits
// ---------------------------------------------------------------------------
// Derived by reading evaluate() above top to bottom AND classifyRisk() in
// riskMatrix.js, because UC-04 is the one use case whose deciding reason is
// not always a literal in this file: gate 5 returns `risk.reasons[0]`, so the
// matrix's own push order IS this ladder's order for positions 5–12. Reading
// only evaluate() would have produced a four-rung ladder that silently loses
// every hard block the matrix makes — which is most of them.
//
// `checks` is the PASSING condition; `means` is what it is to a person when
// that reason is the one that decided. The raw slug stays visible beside the
// prose — it is the string in `audit_log`, in the metrics exception ranking
// and in the n8n port.
//
// NOTE the tiers this ladder crosses: positions 1–2 escalate, 3–12 BLOCK (no
// approval can override them), 13 escalates to Mobility Legal, and 14 is the
// only rung that opens a specialist approval. `means` distinguishes "a human
// must weigh this" from "this cannot be granted by anyone", because those look
// identical from a slug.
// ---------------------------------------------------------------------------
export const GATE_SEQUENCE = Object.freeze([
  {
    position: 1,
    reason: "identity_not_verified",
    gate: "identity",
    checks: "the requester is an authenticated actor for the company this employment belongs to",
    means:
      "We could not confirm the requester acts for the company that employs this person, so no workation assessment was made at all. This is a failure to VERIFY — it is not a finding that the requester is unauthorised.",
  },
  {
    position: 2,
    reason: "employee_not_active",
    gate: "employment_status",
    checks: "the employment record exists and is active",
    means:
      "The employment record is missing or not active, so there is no live employment for a workation to attach to. Nothing about the destination was looked at.",
  },
  {
    position: 3,
    reason: "sanctioned_region",
    gate: "sanctions",
    checks: "the destination is not on the sanctioned or restricted list",
    means:
      "The destination is on the sanctioned or restricted list. It is refused outright rather than passed to anybody: no specialist approval and no additional information from the employee can turn it into a yes, and no work-authorisation record is created at Remote. There is nothing here for the requester or the employer to correct — that is the finding, not an omission from it. It sits first, ahead of every other question, because none of them is worth asking about a destination nobody may travel to.",
  },
  {
    position: 4,
    reason: "employer_permission_not_granted",
    gate: "employer_permission",
    checks: "the employer has granted this employee workation permission on their Remote record",
    means:
      "The employer has not granted this employee workation permission on their Remote record. That is the employer's decision to make, not ours, so no destination risk was assessed — the employer has to set the permission first. Setting it makes the request assessable rather than approved: nothing about this destination or these dates has been looked at yet, so there is no favourable finding waiting behind the permission.",
  },
  {
    position: 5,
    reason: "factors_invalid",
    gate: "request_completeness",
    checks:
      "the request carries all the structured details needed to assess it: home country, destination, nationality, dates, visa type, job duties, and whether the employee can sign contracts",
    means:
      "The request is missing or malformed in at least one required detail, so it could not be risk-assessed at all. Each field that could not be read is recorded on the case, and named back to the requester using the label their own form puts on that box — a person told only that some of their details were unreadable cannot act, and one told which box can. This is a request to be completed, not one that was refused on its merits: no approval, no queue and no specialist stands between it and being assessed once those fields are filled in.",
  },
  {
    position: 6,
    reason: "same_country_workation",
    gate: "risk_matrix",
    checks: "the destination is a different country from the one the employee already works in",
    means:
      "The destination is the same country the employee already works from, so there is no workation to authorise. Almost always this means the form was filled in wrongly, and the correction is the destination field itself — nobody has to review or overturn this for a corrected request to be assessed.",
  },
  {
    position: 7,
    reason: "visitor_visa_active_work_forbidden",
    gate: "risk_matrix",
    checks: "the travel document allows working, not just visiting",
    means:
      "The trip would be taken on a visitor document — a US ESTA or a tourist visa — which forbids working while in the country, however short the stay. As worded the request asks for something the visa does not permit, so no approval can make it lawful. It has to be re-submitted on a document that allows work.",
  },
  {
    position: 8,
    reason: "invalid_date",
    gate: "risk_matrix",
    checks: "the start and end dates are both real dates",
    means:
      "At least one of the travel dates is not a real date, so nothing about the trip could be counted — not its length, not its Schengen usage. It needs re-submitting with usable dates.",
  },
  {
    position: 9,
    reason: "end_before_start",
    gate: "risk_matrix",
    checks: "the trip ends on or after the day it starts",
    means:
      "The end date falls before the start date, so the trip as described cannot happen. It needs re-submitting with the dates the right way round.",
  },
  {
    position: 10,
    reason: "travel_history_unreadable",
    gate: "risk_matrix",
    checks: "every prior stay the request states can actually be read as a country and a pair of dates",
    // WHICH STAY IS ON THE DECISION, NOT ON THE FLAGS. This rung used to end
    // "The flags name which stay", and they do not: riskMatrix.js pushes the
    // bare `travel_history_unreadable` flag and carries the offending row on
    // `risk.travelHistoryProblems`. A reader sent to a chip that holds only the
    // reason they already have goes looking and finds nothing, which is worse
    // than not being sent. The identifier stays in this comment rather than in
    // `means`, because `means` is printed to the requester as the "What
    // happened" paragraph and a property path is not their vocabulary.
    means:
      "At least one of the prior stays supplied with this request could not be read, so the day counts behind BOTH limits — the Schengen 90-in-180 allowance and the 183-day residency watch — could not be taken. It is refused rather than counted from the rows that happened to parse: a count missing a stay is not a smaller count, it is not a count. It needs re-submitting with the offending stay corrected or removed, and nobody has to approve that — this is not a refusal a person overturns, it is a request to be re-stated.",
  },
  {
    position: 11,
    reason: "start_in_past",
    gate: "risk_matrix",
    checks: "the trip starts on or after today",
    means:
      "The trip starts in the past. Work authorisation is not granted retroactively, so this either needs re-submitting with the real dates or handing to Mobility as a trip that has already happened.",
  },
  {
    position: 12,
    reason: "schengen_90_180_exceeded",
    gate: "risk_matrix",
    checks:
      "adding this trip keeps the employee within 90 days in the Schengen area across any rolling 180 days",
    means:
      "Counting the days this employee has already spent there, this trip would put them over the Schengen 90-days-in-180 limit. That limit is set by law, not by Remote, so no internal approval can grant it and there is nobody to escalate it to. What changes the answer is the trip: fewer days, or dates far enough out that the earlier stays have left the rolling window.",
  },
  {
    position: 13,
    reason: "us_requires_work_permit",
    gate: "risk_matrix",
    checks: "a trip to the United States is being taken on a work permit",
    means:
      "Working from the United States requires a work permit, and this request does not have one. The trip cannot be authorised on the document offered, by anybody here — it has to be re-submitted once a work permit is held, and that makes it assessable rather than approved.",
  },
  {
    position: 14,
    reason: "ca_requires_work_permit",
    gate: "risk_matrix",
    checks: "a trip to Canada is being taken on a work permit",
    means:
      "Working from Canada requires a work permit, and this request does not have one. The trip cannot be authorised on the document offered, by anybody here — it has to be re-submitted once a work permit is held, and that makes it assessable rather than approved.",
  },
  {
    position: 15,
    reason: "risk_matrix_blocked",
    gate: "risk_matrix",
    checks: "—",
    means:
      "A fallback that the risk matrix cannot actually produce today: it only ever reports 'blocked' with at least one named reason, and that named reason is used instead. Seeing this slug on a real case means the matrix blocked something without saying why, which is a bug worth reporting rather than a decision to explain to the requester.",
  },
  {
    position: 16,
    reason: "destination_out_of_scope",
    gate: "risk_level",
    checks: "the risk matrix has rules for this origin/destination pair at all",
    means:
      "The risk matrix has NO rules for this destination, so nothing was assessed and the request escalates by default. This is not a finding that the trip is risky — it is the absence of any finding, and it is a different investigation from a pair the matrix judged high-risk. Reading it as 'high risk' sends a specialist looking for a risk nobody found.",
  },
  {
    position: 17,
    reason: "high_risk_pair",
    gate: "risk_level",
    checks: "the assessed risk level is low or medium, not high",
    means:
      "The combination of this employee's role and this destination creates enough permanent-establishment or tax exposure that a Mobility Legal specialist must handle it directly. Deliberately no one-click approval is offered — this is not a refusal, it is a case that a specialist owns end to end.",
  },
  {
    position: 18,
    reason: "all_gates_passed",
    gate: "outcome",
    checks: "every gate above passed and the assessed risk is low or medium",
    means:
      "Every check passed, so a dossier was prepared for a mobility specialist to approve. The workation is NOT approved yet — a named human still has to approve it, and the risk flags on the case are what they are being asked to weigh.",
  },
]);

const descriptions = bindGateDescriptions(GATE_SEQUENCE);

/**
 * Which gate decided this outcome, and what that means in plain words.
 * Returns null for a reason with no row — see shared/gateLadder.js.
 * @param {string} reason  the slug evaluate() returned
 */
export const describeDecidingGate = descriptions.describeDecidingGate;

/**
 * The whole ordered ladder, each rung marked passed / decided / not_reached.
 * @param {string} reason  the slug evaluate() returned
 */
export const describeGateLadder = descriptions.describeGateLadder;
