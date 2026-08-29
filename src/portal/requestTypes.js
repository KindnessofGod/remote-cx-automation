// ---------------------------------------------------------------------------
// requestTypes.js  —  The seven request types the portal accepts, described once
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
// The portal is one page in front of seven different workflow functions, and
// three separate things need to agree about what each request type IS: the
// router (which `handle*` runs), the page (which tier badge and which
// "what the human controls" sentence to show), and the result panel (whether
// the outcome is an action, an approval queue, or a dossier that goes no
// further). Letting each of those three carry its own copy is exactly how the
// port registry's bug happened — three sincere comments, all checked against
// the wrong thing. So the description lives here once, the server sends it
// down with every response, and the browser renders what it is given.
//
// WHO `description` AND `humanControl` ARE WRITTEN FOR
// A person filling the form in, and nobody else. Both strings are rendered
// above the first input — `description` under the card title and on the home
// tile, `humanControl` in the callout beneath it — so they are the first two
// things anybody reads on this page. They used to be written for us: a
// deterministic origin→destination risk matrix, twelve gates, the ZAF sidebar,
// `Math.max(2, …)`, `handleRelocationReview()` taking no write-capable client.
// Every word of that is true and none of it belongs on a form. The rule the
// whole portal's copy now follows, from commit 112f1e5:
//
//   1. Needed to complete the form?           Keep it, in plain words.
//   2. The reason something is blank or odd?  Say it once, for the group.
//   3. Engineering rationale — architecture, endpoint paths, which internal
//      component decides, what a structural guarantee rests on?  It belongs in
//      a comment, in docs/, or in the audit record. NOT on the form.
//
// So each entry below carries a comment holding the rationale its copy used to
// print at the reader. The claims are unchanged; only their audience is.
//
// WHAT THIS FILE DELIBERATELY DOES NOT DO
// It holds no policy. `tier` here is a LABEL for the reader — the actual
// tier-selects-the-path behaviour lives in each use case's own policy engine
// and workflow (CLAUDE.md prime directive #2), and nothing in the portal ever
// reads `tier` to decide anything. `executionPath` is likewise descriptive:
// UC-07 and UC-08 have no execution path because their workflow functions take
// no write-capable client at all, not because this file says "none". If this
// file were deleted, every gate in the system would behave identically.
// ---------------------------------------------------------------------------

/**
 * @typedef {object} RequestType
 * @property {string} id            the portal's route segment, e.g. "uc02"
 * @property {string} icon          one decorative emoji, shared by the home tile and the card
 * @property {string} useCase       "UC-02"
 * @property {"low"|"medium"|"high"} tier   the use case's risk tier (a label; see header)
 * @property {string} label         short human name shown in the nav
 * @property {string} title         the card heading
 * @property {string} description   one or two plain sentences: what this request IS, for the person filing it
 * @property {"auto"|"single_approver"|"dual_approval"|"multi_role_approval"|"none"} executionPath
 * @property {string} humanControl  what happens after they send it, in one or two plain sentences
 * @property {string} recordLabel   what the workflow's stored record is called
 */

/** @type {RequestType[]} */
export const REQUEST_TYPES = [
  {
    id: "uc01",
    icon: "📋",
    useCase: "UC-01",
    tier: "low",
    label: "Employment verification letter",
    title: "Get your standard employment verification letter",
    // L-14. This is the destination the deflection message (refusalCopy.js's
    // `self_service_available`) has been promising since G-2 landed: "the
    // standard employment verification letter is available directly from
    // the Requests tab in your account, and it's issued in seconds." A
    // deliberately SEPARATE, simpler path from the ticket-driven one — see
    // src/uc01/selfServiceLetter.js's header for why it is not
    // handleVerificationTicket() run a second way.
    description:
      "Get a standard employment verification letter for yourself, issued right away — no need to raise a support ticket.",
    executionPath: "auto",
    humanControl:
      "This is issued immediately if your record is active and complete. If it isn't, raise it through the support channel instead.",
    recordLabel: "Employment verification letter",
  },
  {
    id: "uc02",
    icon: "🧾",
    useCase: "UC-02",
    tier: "low",
    label: "Expense & receipt validation",
    title: "Submit an expense for validation",
    // WHAT THE COPY NO LONGER SAYS, AND WHERE IT LIVES INSTEAD.
    // "Twelve deterministic gates check ownership, duplicates, itemisation,
    // arithmetic, currency conversion and the category spend cap." That ladder
    // is real, it is ordered, and it is documented where it can be checked —
    // docs/GATES.md, and `describeGateLadder()` in src/uc02/policyEngine.js,
    // which the RESULT panel renders in full after a decision, rung by rung.
    // Naming it above the form asked the reader to hold twelve unnamed things
    // in mind before typing a single character.
    description:
      "Claim back money you spent for work. Your receipt and the amount are checked against the company's rules automatically.",
    executionPath: "auto",
    humanControl:
      "A claim that passes every check is settled without anyone reading it. Only a claim that raises a flag goes to a person in Finance.",
    recordLabel: "Expense record",
  },
  {
    id: "uc03",
    icon: "✈️",
    useCase: "UC-03",
    tier: "low",
    label: "Travel letter",
    title: "Ask about travel, or request a support letter",
    // "This is a router, not a compliance engine" is the single most important
    // fact about this use case FOR US — it is why UC-03 owns no Schengen or
    // 183-day logic and hands anything real to UC-04 — and it means nothing to
    // somebody asking whether they can go to Madrid. It is stated where it is
    // load-bearing: docs/use-cases/UC-03.md, and the routing decision itself,
    // which the result panel names as `route_to_uc04` with its own reason.
    description:
      "Ask about a business trip or working abroad for a while, or ask for a letter confirming your job for a visa or a border check.",
    executionPath: "auto",
    humanControl:
      "A straightforward question is answered here and then. A formal letter is drafted for a specialist to sign off before it reaches you, and a trip that really needs permission to work moves to the work authorization form.",
    recordLabel: "Case",
  },
  {
    id: "uc04",
    icon: "🛂",
    useCase: "UC-04",
    tier: "medium",
    label: "Work authorization / workation",
    title: "Request permission to work from another country",
    // THE OFFENDER THE PROJECT OWNER SCREENSHOTTED. It read: "A deterministic
    // origin→destination risk matrix: permanent-establishment exposure,
    // Schengen and US/Canada hard blocks, cumulative day counts, and whether
    // the traveller can sign contracts abroad." Four internal nouns in one
    // sentence. Each is real and each is recorded where it can be verified:
    // the matrix and its hard blocks in src/uc04/policyEngine.js and
    // docs/use-cases/UC-04.md; the PE-risk inputs (signing authority, duties)
    // in the same engine, and named on the form beside the boxes that carry
    // them; the cumulative-day gate in the result panel's own decision facts.
    //
    // "One named mobility specialist, not dual approval, because UC-04 names a
    // single specialist" was an answer to a question only a reviewer of this
    // repo asks. The approval shape itself is `executionPath` above, which is
    // what the page actually renders from, and docs/APPROVAL-ROUTING.md is
    // where the routing is settled.
    description:
      "Ask to work from another country for a while — a workation, or a longer stay. Where you are going, how long for and what you do there decide the answer.",
    executionPath: "single_approver",
    humanControl:
      "A mobility specialist reads the request and approves or declines it. Nothing on this page grants permission by itself.",
    recordLabel: "Work authorization request",
  },
  {
    id: "uc05",
    icon: "📄",
    useCase: "UC-05",
    tier: "medium",
    label: "Resignation notice",
    title: "File a resignation and calculate notice",
    // "Statutory notice from a nine-country table", and "a proposed date
    // earlier than statute is a discrepancy, never a silent acceptance": the
    // table is src/uc05/noticeTable.js with its sources, the discrepancy is a
    // named flag the result panel prints with the two dates side by side. The
    // copy below says the useful half — that the dates are worked out for you
    // — and lets the result say what it found.
    //
    // "No confirmed Remote write endpoint exists for a termination, so the
    // portal never pretends one does" is a real and deliberate limit, kept in
    // docs/use-cases/UC-05.md §15 and in src/uc05/workflow.js, which takes no
    // termination-capable client. What the reader needs from it is one thing:
    // sending this form does not end anything. That is what is said.
    description:
      "Tell us you are leaving. Your notice period, your last working day and any untaken holiday you are owed are worked out from your contract and your country's rules.",
    executionPath: "single_approver",
    humanControl:
      "HR Ops checks the figures and signs them off, and that signed-off summary is the record. Sending this form does not end your employment on its own.",
    recordLabel: "Resignation record",
  },
  {
    id: "uc07",
    icon: "🌍",
    useCase: "UC-07",
    tier: "high",
    label: "Global mobility / relocation",
    title: "Open a permanent relocation review",
    // THE STRUCTURAL GUARANTEE, WHICH IS THE POINT OF THIS USE CASE AND IS NOT
    // A SENTENCE FOR A FORM. "handleRelocationReview() takes no Remote or
    // Zendesk client at all, so there is no write-capable dependency to
    // misuse" is proved, not asserted, by test/uc07.test.js's structural check
    // (source stripped of comments, then asserted never to reference either
    // REST client's write methods) and by the behavioural one beside it. It is
    // written up in docs/use-cases/UC-07.md and CLAUDE.md prime directive #2.
    // What a reader needs is the consequence: nothing here can be approved.
    description:
      "Move someone permanently to another country. Everything the move depends on — timing, salary against the visa minimum, holiday, seniority and cost — is gathered into one summary.",
    executionPath: "none",
    humanControl:
      "Nothing here can be approved, by anyone, on any screen — the summary is the whole outcome. A mobility legal specialist reads it and takes it from there.",
    recordLabel: "Dossier",
  },
  {
    id: "uc08",
    icon: "🧮",
    useCase: "UC-08",
    tier: "high",
    label: "Cross-border tax",
    title: "Ask a cross-border tax or social-security question",
    // Same structural guarantee as UC-07, and it was printed here in even more
    // detail: "handleTaxInquiry() has no write-capable parameter, its store has
    // one write method and zero mutations, and its API has no POST route in the
    // file at all." All three are asserted by test/uc08.test.js and
    // test/uc08Server.test.js, and none of them is a thing a person with a
    // residency question can check or use.
    //
    // "Presence days are counted deterministically and treaty passages are
    // retrieved and cited — the answer is never asserted" survives below in the
    // form the reader can act on: they get the count and the quotes, and a
    // person gives the answer.
    description:
      "Ask about tax or social security when you live or work across more than one country — where you count as resident, the 183-day rule, or which country you pay social security in.",
    executionPath: "none",
    humanControl:
      "You get a written summary: the days counted, and the wording of the treaties that apply, quoted rather than paraphrased. A tax specialist gives the answer — this page never does.",
    recordLabel: "Dossier",
  },
  {
    id: "uc09",
    icon: "💸",
    useCase: "UC-09",
    tier: "high",
    label: "Off-cycle payroll adjustment",
    title: "Request an off-cycle payroll adjustment",
    // "The floor is Math.max(2, …), so no risk score can ever lower it to one
    // pair of eyes" is the guarantee this use case exists to hold, and it is
    // held in src/uc09/multiApprovalPolicy.js with a test that drives the risk
    // score to its floor and asserts the requirement does not follow it down.
    // A person asking for a bonus to be paid needs the rule, not its
    // implementation: at least two people, three for a large amount.
    description:
      "Pay someone outside the normal payroll run — a bonus, commission, a relocation top-up or back pay.",
    executionPath: "multi_role_approval",
    humanControl:
      "At least two different people have to approve before any money moves, and a third has to release the payment for larger or higher-risk amounts. Nobody can approve their own request.",
    recordLabel: "Adjustment record",
  },
];

/** Lookup by the portal's route segment. Returns undefined for an unknown id. */
export function findRequestType(id) {
  return REQUEST_TYPES.find((t) => t.id === id);
}
