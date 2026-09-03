// ---------------------------------------------------------------------------
// approvalRoutes.js  —  Where each use case's human decision can actually be made
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
//
// The question this whole surface was built to answer is not "what is waiting?"
// but "what is waiting somewhere nobody can act on it?". Answering the second
// needs one fact per use case that lives nowhere else today: whether an
// approval control exists at all, and — when it does not — WHICH KIND of
// absence that is.
//
// THE ONE DISTINCTION THIS FILE EXISTS TO PROTECT
//
//   "none_by_design"  Nothing may approve this, ever. UC-07 and UC-08 are the
//                     🔴 reference builds: their stores have one write method
//                     and zero mutations, their servers have no POST route in
//                     the file, and a test asserts both. An approve button here
//                     would be a defect, not a feature.
//
//   "none_missing"    Something MUST approve this and nothing can. The code
//                     looks identical to `none_by_design`'s; the meaning is the
//                     opposite. **No use case is in this state today, and that
//                     is a result rather than a reason to delete the state.**
//                     UC-03 held it: a formal travel letter drafted, stored and
//                     queued, with no POST route anywhere to sign it. This
//                     view is what measured that, and the surface was built —
//                     `src/uc03/signoffPolicy.js`, `POST
//                     /uc03/api/cases/:id/signoff|decline`, one signature for
//                     the one UC-03 outcome that needs one (UC-03.md §15.2).
//                     The state stays because the NEXT use case to draft an
//                     artifact nobody can release must land in it rather than
//                     in `none_by_design`, and an empty state is exactly what
//                     a queue that has done its job looks like.
//
// Both render as "no approve button". Collapsing them into one row would hide
// exactly the thing this view exists to surface, so they are two states with
// two different words and the page prints the word it is given.
//
// EVERY ROW IS A FACT ABOUT THE CODE, checked by reading it rather than by
// remembering it. `hasPostRoute` below was verified per server on 2026-08-19:
//   src/review/server.js:132   POST /api/review/ticket/:ref/:action
//   src/uc02/server.js:269     POST /api/expenses/:id/:action
//   src/uc03/server.js:152     POST /api/cases/:id/signoff|decline  (added 2026-08-20)
//   src/uc04/server.js:134     POST /api/authorizations/:id/:action
//   src/uc05/server.js:144     POST /api/resignations/:id/:action
//   src/uc06/server.js:138     POST /api/amendments/:id/:action
//   src/uc07/server.js         (none)
//   src/uc08/server.js         (none)
//   src/uc09/server.js:138     POST /api/adjustments/:id/:action
// test/approvalQueue.test.js re-checks every claim against the real sources, in
// both directions — a POST route added to UC-07 or UC-08 fails a test here, and
// so does a row claiming a control whose server has no POST route. That is how
// UC-03's row came to be corrected rather than quietly left wrong.
//
// AND IT IS NOW READ BY THE HAND-OFF ITSELF, not only by this dashboard.
// ./handoffDirections.js turns a row into the three sentences a receiving human
// needs — where to act, what the verbs are, what they cannot do here — so the
// Zendesk note and this page are built from the same row and cannot disagree.
// That is why `verbs` is on the row: it was the one fact a hand-off needed that
// lived only inside each use case's policy module.
//
// PURE DATA AND ONE LOOKUP. Nothing here reads a record, decides anything, or
// takes a client. It answers "what does this use case's approval surface look
// like", never "may this person approve" — that question belongs to each use
// case's own policy engine and is not duplicated here. This surface reports on
// approvals; it must never become a second place to make one.
// ---------------------------------------------------------------------------

/**
 * @typedef {object} ApprovalRoute
 * @property {string} useCase
 * @property {"low"|"medium"|"high"} tier
 * @property {"exists"|"none_by_design"|"none_missing"} control
 * @property {string|null} surface   where a human clicks, in plain words
 * @property {string|null} endpoint  the route that records the decision
 * @property {boolean} hasPostRoute  does the use case's server have one at all
 * @property {{key:string,label:string}[]} roles  named slots, [] when the code
 *   names no role (an approver identity, and nothing about entitlement)
 * @property {number|null} slotsRequired  the FLOOR, where the code enforces one
 * @property {string[]} verbs  the action tokens that use case's own policy
 *   module accepts, cited on the row. [] when there is no control. Data rather
 *   than an assumed approve/decline pair, because three rows are not that pair:
 *   UC-02 also holds, UC-05 and UC-03 SIGN OFF, and UC-09 DENIES. A hand-off
 *   note that offered the wrong word would send a specialist looking for a
 *   button that is not on their screen
 * @property {string} note  why the control is what it is, for the page to print
 */

/** @type {Record<string, ApprovalRoute>} */
export const APPROVAL_ROUTES = Object.freeze({
  "UC-01": {
    useCase: "UC-01",
    tier: "low",
    control: "exists",
    surface: "Zendesk — the Gatehouse CX Review sidebar, UC-01 panel",
    endpoint: "POST /uc01/api/review/ticket/:ticket/:action",
    // src/review/reviewPolicy.js:72 REVIEW_ACTIONS. `deny` is still ROUTED as a legacy spelling for the installed ZAF bundle; the canonical verb is the one printed.
    verbs: ["approve", "decline"],
    hasPostRoute: true,
    roles: [],
    slotsRequired: 1,
    note: "One reviewer approves or declines. The code names no role — it records who decided, not what they were entitled to decide.",
  },
  "UC-02": {
    useCase: "UC-02",
    tier: "low",
    control: "exists",
    surface: "Zendesk — the Gatehouse CX Review sidebar, UC-02 panel",
    endpoint: "POST /uc02/api/expenses/:id/:action",
    // src/uc02/reviewPolicy.js:87 ACTIONS. `release` is the legacy spelling of `approve`, normalised before anything reads it.
    verbs: ["approve", "decline", "hold"],
    hasPostRoute: true,
    roles: [],
    slotsRequired: 1,
    note: "Approve, decline or hold — the only three-button panel. A decline must carry a note, because Remote's own API requires a reason.",
  },
  "UC-03": {
    useCase: "UC-03",
    tier: "low",
    // WAS `none_missing`, AND THIS ROW IS THIS VIEW'S OWN RESULT. The queue
    // measured UC-03 as the one use case where something had to be signed and
    // nothing could sign it; the surface was then built for exactly that one
    // outcome. Note what did NOT happen: the four `route_to_uc04` rows this
    // view counted as stuck got no button, because a handoff is not an
    // approval — see `note` below and UC-03.md §15.2.
    control: "exists",
    surface: "Zendesk — the Gatehouse CX Review sidebar, UC-03 panel",
    endpoint: "POST /uc03/api/cases/:id/signoff|decline",
    // src/uc03/signoffPolicy.js:40 ACTIONS. NOT approve/decline — what is recorded is the release of a drafted letter.
    verbs: ["signoff", "decline"],
    hasPostRoute: true,
    roles: [{ key: "travel_support_specialist", label: "Travel & Mobility Support specialist" }],
    slotsRequired: 1,
    note:
      "One signature, for one outcome: a drafted formal travel letter, released by Travel & Mobility Support. " +
      "Every other UC-03 outcome is refused there by name — a route_to_uc04 handoff needs an outreach (the " +
      "employee files in Remote's Request Hub), an escalation is worked on its own ticket, and an auto-resolved " +
      "inquiry has no artifact at all.",
  },
  // UC-04 IS THE ONE ROW WHERE ONE SURFACE IS NOT THE WHOLE ANSWER (2026-08-31).
  // Three parties decide (UC-04.md §1a) and TWO of them have a control here:
  //
  //   stage 2  the CUSTOMER'S OWN MANAGER approves or declines, in the
  //            Remote-product stand-in. This is the only work-authorization
  //            decision Remote's API accepts, and it is not a Remote CX act at
  //            all — no agent in Zendesk can make it, and this file used to say
  //            a mobility specialist did.
  //   stage 3  REMOTE'S MOBILITY TEAM records its own review, in the sidebar,
  //            on a request the employer has ALREADY approved.
  //
  // WHY THE ROW STILL NAMES STAGE 3 IN `surface`/`endpoint`/`verbs`. This queue
  // and ./handoffDirections.js exist to tell a REMOTE human where their work is
  // done, and stage 3 is the only part of UC-04 that is theirs. Naming the
  // employer's screen in those fields would send a Zendesk agent to a control
  // they cannot reach.
  //
  // AND THE HOLE THAT LEAVES, NAMED RATHER THAN SMOOTHED OVER: this registry is
  // one row per use case, so an item waiting at `pending_specialist_approval`
  // (stage 2, the employer's) and one waiting at `approved_by_manager` (stage 3,
  // Remote's) resolve to the SAME row and therefore the same directions. A
  // stage-2 item is genuinely waiting on somebody outside Zendesk, and the note
  // below is currently the only thing that says so. Making the route
  // status-dependent is the real fix and it is a shape change to this file's
  // key, which is why it is written down here instead of half-done.
  "UC-04": {
    useCase: "UC-04",
    tier: "medium",
    control: "exists",
    surface: "Zendesk — the Gatehouse CX Review sidebar, UC-04 panel",
    endpoint: "POST /uc04/api/authorizations/:id/mobility-review",
    // src/uc04/mobilityReview.js. The verbs are `clear`/`decline` and NOT
    // `approve`: the employer already used that word on this same record at
    // stage 2, and one record carrying two people's "approved" is how a reader
    // comes to believe one of them settled the other.
    verbs: ["clear", "decline"],
    hasPostRoute: true,
    roles: [{ key: "mobility_specialist", label: "Mobility specialist" }],
    slotsRequired: 1,
    stages: [
      {
        stage: 2,
        actor: "The customer's own manager",
        surface: "The Remote product stand-in — /remoteui/work-authorizations",
        endpoint: "POST /remoteui/api/work-authorizations/:id/decision",
        verbs: ["approve", "decline"],
        writesToRemote: true,
      },
      {
        stage: 3,
        actor: "Remote's Mobility Team",
        surface: "Zendesk — the Gatehouse CX Review sidebar, UC-04 panel",
        endpoint: "POST /uc04/api/authorizations/:id/mobility-review",
        verbs: ["clear", "decline"],
        // The whole reason stage 3 is recorded rather than transmitted: Remote
        // publishes NO endpoint that sets `approved_by_remote`.
        writesToRemote: false,
      },
    ],
    note:
      "TWO surfaces, not one. The employer's approval belongs to the customer's own manager and is made in Remote's own product (/remoteui/work-authorizations) — no Zendesk agent can make it, and a request still waiting for it is waiting outside this queue's reach. Remote's Mobility Team then records its own review here, on a request the employer has already approved; that review is recorded in this system and is NOT sent to Remote, because Remote publishes no endpoint for it.",
  },
  "UC-05": {
    useCase: "UC-05",
    tier: "medium",
    control: "exists",
    surface: "Zendesk — the Gatehouse CX Review sidebar, UC-05 panel",
    endpoint: "POST /uc05/api/resignations/:id/:action",
    // src/uc05/signoffPolicy.js:40 ACTIONS. A sign-off, not an approval: the signed report IS the artifact.
    verbs: ["signoff", "decline"],
    hasPostRoute: true,
    roles: [{ key: "hr_ops", label: "HR Ops" }],
    slotsRequired: 1,
    note: "One HR Ops sign-off. Remote has no resignation write endpoint, so the signed-off report is the artifact — the sign-off is the outcome, not a step before one.",
  },
  "UC-06": {
    useCase: "UC-06",
    tier: "medium",
    control: "exists",
    surface: "Zendesk — the Gatehouse CX Review sidebar, UC-06 panel (two role blocks)",
    endpoint: "POST /uc06/api/amendments/:id/:action",
    // src/uc06/dualApprovalPolicy.js:47 ACTIONS, per role slot.
    verbs: ["approve", "decline"],
    hasPostRoute: true,
    roles: [
      { key: "customer_admin", label: "Employer's signatory" },
      { key: "payroll_specialist", label: "Remote payroll specialist" },
    ],
    slotsRequired: 2,
    note: "Two named slots, two different people. One identity cannot fill both — the same-person check folds case, whitespace and confusable characters before comparing.",
  },
  "UC-07": {
    useCase: "UC-07",
    tier: "high",
    control: "none_by_design",
    surface: null,
    endpoint: null,
    verbs: [],
    hasPostRoute: false,
    roles: [],
    slotsRequired: null,
    note: "Nothing may approve a permanent-relocation dossier here, and that is the design. It is compiled and handed to Mobility Legal (Tier-3), who decide outside this system.",
  },
  "UC-08": {
    useCase: "UC-08",
    tier: "high",
    control: "none_by_design",
    surface: null,
    endpoint: null,
    verbs: [],
    hasPostRoute: false,
    roles: [],
    slotsRequired: null,
    note: "Nothing may approve a cross-border tax dossier here, and that is the design. It is compiled and handed to Tax Operations, who decide outside this system.",
  },
  "UC-09": {
    useCase: "UC-09",
    tier: "high",
    control: "exists",
    surface: "Zendesk — the Gatehouse CX Review sidebar, UC-09 panel (2–3 role blocks)",
    endpoint: "POST /uc09/api/adjustments/:id/:action",
    // src/uc09/multiApprovalPolicy.js:94. `deny`, not `decline` — the one row that spells the refusal differently, and a note offering the wrong word sends a specialist hunting for a button that is not there.
    verbs: ["approve", "deny"],
    hasPostRoute: true,
    roles: [
      { key: "requester", label: "Requester" },
      { key: "approver", label: "Approver" },
      { key: "payment_releaser", label: "Payment releaser" },
    ],
    slotsRequired: 2,
    note: "Two signatures minimum, three when the risk score asks for one, all from different people. The floor of two cannot be lowered by any risk score.",
  },
});

/** The route for a use case, or null. Null rather than a default — a guessed
 *  approval surface is the one guess this file must never make. */
export function approvalRouteFor(useCase) {
  return APPROVAL_ROUTES[useCase] ?? null;
}

/**
 * Is a missing approval control the SAFE kind or the BROKEN kind?
 *
 * Returned as a word rather than a boolean so no caller can accidentally test
 * `!hasControl` and treat UC-07 and UC-03 as the same state.
 *
 * @param {string} useCase
 * @returns {"exists"|"none_by_design"|"none_missing"|"unknown"}
 */
export function controlStateFor(useCase) {
  return APPROVAL_ROUTES[useCase]?.control ?? "unknown";
}
