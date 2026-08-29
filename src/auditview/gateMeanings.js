// ---------------------------------------------------------------------------
// gateMeanings.js  —  Turning a stored `reason` slug into the plain words the
//                     policy engine that produced it already holds
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
// Seven policy engines now publish a `GATE_SEQUENCE` beside their own gates —
// one row per reason, carrying the gate's position in the real evaluation
// order and a `means` sentence saying what that reason IS to a person
// (src/shared/gateLadder.js's header has the full derivation). Every surface
// that decides something reaches it through the use case's own
// `describeDecidingGate(reason)`.
//
// This viewer could not. It reads `audit_log` rows, not policy-engine results,
// so it had no use case in hand to ask — and printed `over_policy_cap`,
// `no_matching_notice_bracket`, `sanctioned_region` as bare slugs on every one
// of the nine. That is the worst place in the whole system for a message less
// specific than what the code already holds: this is the surface a person opens
// WHEN SOMETHING HAS ALREADY GONE WRONG, often not the person who wrote the
// gate, often at an hour when nobody can be asked.
//
// The missing piece is a `useCase -> describeDecidingGate` registry. It lives
// here, in the viewer, and NOT in src/shared: a map from a use-case STRING to a
// module is a fact about who is reading, not about the gates, and putting it in
// shared/ would make every policy engine importable from every other one for no
// reason.
//
// WHAT IS IMPORTED, AND WHAT IS DELIBERATELY NOT.
// Only `policyEngine.js` from each of the five, and every one of those is pure:
// their whole transitive import set is gateLadder, countryCodes, money,
// upstreamFailure, schemaValidator, riskMatrix, policyCaps,
// noticePeriodTable/Calculator and ptoPayout. No REST client, no store, no
// audit logger — so this registry cannot bring a write path into a viewer whose
// read-only-ness is structural. `test/auditview.test.js` walks the import graph
// and asserts exactly that, because "I checked once" is not a guarantee.
//
// THE FOUR RULES THAT MAKE THIS CORRECT RATHER THAN MERELY WIRED
//   1. A use case with NO GATE_SEQUENCE (UC-07, UC-08 — the no-execution-path
//      dossier builds, whose single outcome is `escalate`) renders exactly as
//      it did before: no entry here, no prose, no placeholder. A sentence
//      invented for a ladder that does not exist would be worse than the slug.
//      UC-01 and UC-06 used to sit in this same sentence — this file's own
//      claim that neither published a ladder — and both had, by the time
//      anyone checked (rca-nr4i / D-20): src/uc01/policyEngine.js's
//      GATE_SEQUENCE existed and was simply never registered below, so every
//      UC-01 row in `/audit` rendered a bare slug regardless of which door the
//      decision came through. A stale comment describing a registry is not
//      itself a bug; a stale registry — every UC-01/UC-06 reason resolving to
//      null forever, whether or not a ladder existed to answer it — was.
//   2. An UNRECOGNISED reason renders exactly as before. Both ladder shapes
//      already answer honestly — UC-03/04/05/09's bound helper returns null,
//      UC-02's returns a row whose `means` is "" and whose note says which gate
//      cannot be stated — and neither answer is papered over.
//   3. THE SLUG SURVIVES BESIDE THE PROSE. It is the exact string in
//      `audit_log`, in the metrics exception ranking and in the n8n Code-node
//      ports; it is what a person greps and what the feed's filter matches.
//      Prose that REPLACED it would make the page readable and the system
//      harder to trace, which is a bad trade on an audit surface.
//   4. Nothing here decides anything. It describes a decision already made and
//      already stored, exactly as gateLadder.js's own functions do.
// ---------------------------------------------------------------------------

import {
  describeDecidingGate as uc01Ticket,
  describeSelfServiceDecidingGate as uc01SelfService,
} from "../uc01/policyEngine.js";
import { describeDecidingGate as uc02 } from "../uc02/policyEngine.js";
import { describeDecidingGate as uc03 } from "../uc03/policyEngine.js";
import { describeDecidingGate as uc04 } from "../uc04/policyEngine.js";
import { describeDecidingGate as uc05 } from "../uc05/policyEngine.js";
import { describeDecidingGate as uc06 } from "../uc06/policyEngine.js";
import { describeDecidingGate as uc09 } from "../uc09/policyEngine.js";

/**
 * UC-01 alone has TWO doors, each with its own reason vocabulary and its own
 * ladder length (src/uc01/policyEngine.js's GATE_SEQUENCE for the
 * ticket-driven path, SELF_SERVICE_GATE_SEQUENCE for L-14's self-service
 * click) — see that file's own comment on why they are not one merged
 * sequence. The two reason vocabularies do not collide (self-service's two
 * unique reasons are `not_your_employment` and
 * `self_service_all_gates_passed`; every other reason it can produce is a
 * REUSE of a ticket-ladder rung, via that file's `reuseRung()`), so trying the
 * ticket ladder first and falling back to the self-service one answers either
 * door correctly with no caller needing to say which one a given row came
 * through.
 */
function uc01(reason) {
  return uc01Ticket(reason) ?? uc01SelfService(reason);
}

/**
 * The registry. A use case absent from this map has no ladder to consult —
 * which is a real answer, not a gap to fill.
 *
 * UC-07/UC-08 are the no-execution-path dossier builds whose single outcome is
 * `escalate` and therefore render as they always have.
 *
 * @type {Record<string, (reason: string) => object|null>}
 */
const LADDERS = Object.freeze({
  "UC-01": uc01,
  "UC-02": uc02,
  "UC-03": uc03,
  "UC-04": uc04,
  "UC-05": uc05,
  "UC-06": uc06,
  "UC-09": uc09,
});

/** Which use cases publish a ladder — exported so a doc or test can state it. */
export const USE_CASES_WITH_LADDERS = Object.freeze(Object.keys(LADDERS));

// ---------------------------------------------------------------------------
// R7-37 (rca-x0i6) — a `means` sentence states a gate's finding as fact
// ("Remote is the legal employer, the employment is active"), and that is
// true of the RECORD the gate actually read. On a portal-sourced row that
// record is the portal's mock fixture, never a live Remote read (§ traceVerdict
// .js's own disclosure, and the request portal's header: its Remote reads are
// dispatched to fixtures on purpose, so a public page never touches a real
// account). The portal is not going to start reading live for this — see
// CLAUDE.md's substitution ladder, rung 3, and the portal's own "on purpose"
// header — so the honest fix is the other option the finding names: say so in
// the sentence the gate already prints, rather than let it read as a claim
// about Remote.
//
// Attached HERE rather than upstream in each policy engine's GATE_SEQUENCE
// because `means` is written once and read by every submission channel — a
// ticket-driven UC-01 row and a portal UC-01 row cite the identical rung. The
// channel is a fact about THIS ROW, not about the gate, so it is folded in at
// the one place that already knows which row is being described.
const FIXTURE_SOURCE_CAVEAT =
  "This request came through the request portal, so the facts above were checked against its mock fixture record, not a live read of Remote.";

/**
 * What this decision's reason MEANS, in the words its own policy engine holds.
 *
 * Returns null whenever anything is unknown — no ladder for the use case, no
 * reason on the row, no rung for that reason, or a rung whose `means` is empty.
 * The caller then renders the bare slug, which is exactly what it rendered
 * before any of this existed.
 *
 * TWO LADDER SHAPES, NORMALISED HERE. UC-03/04/05/09 bind
 * src/shared/gateLadder.js and return `{position, reason, gate, checks, means,
 * total}` or null. UC-02 predates that helper and returns its own object with
 * `ladderLength` instead of `total`, and — for an unrecognised reason — a row
 * with `position: null` and `means: ""` rather than null. Both are honest; they
 * are just not the same shape, so the empty-`means` case is checked explicitly
 * rather than trusted to be null.
 *
 * @param {string|null|undefined} useCase  e.g. "UC-05"
 * @param {string|null|undefined} reason   the slug stored on the audit row
 * @param {{source?: string|null}} [context]  `details.source` off the same row —
 *   `"portal"` appends the fixture caveat above; anything else (including
 *   absent) leaves `means` exactly as the policy engine wrote it.
 * @returns {{means: string, gate: string|null, position: number|null,
 *   total: number|null}|null}
 */
export function gateMeaning(useCase, reason, context = {}) {
  const describe = LADDERS[String(useCase ?? "")];
  if (!describe || typeof reason !== "string" || reason === "") return null;

  let row;
  try {
    row = describe(reason);
  } catch {
    // A ladder that throws is a bug in that use case, not a reason to fail a
    // read of the audit trail. Degrade to the slug, same as an unknown reason.
    return null;
  }
  if (!row) return null;

  let means = typeof row.means === "string" ? row.means.trim() : "";
  if (!means) return null;

  if (context?.source === "portal") {
    means = `${means} ${FIXTURE_SOURCE_CAVEAT}`;
  }

  const position = Number.isFinite(row.position) ? row.position : null;
  const totalRaw = Number.isFinite(row.total) ? row.total : row.ladderLength;
  return {
    means,
    gate: typeof row.gate === "string" && row.gate && row.gate !== "unknown" ? row.gate : null,
    position,
    total: Number.isFinite(totalRaw) ? totalRaw : null,
  };
}
