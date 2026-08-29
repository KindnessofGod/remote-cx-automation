// ---------------------------------------------------------------------------
// handoffDirections.js  —  Telling the receiver WHERE to act, WHAT the verbs
//                          are, and WHAT THEY CANNOT DO HERE
// ---------------------------------------------------------------------------
// THE GAP THIS CLOSES (docs/ESCALATION-DESTINATIONS.md §5, §7 item 3)
//
// A real hand-off note, read off ticket #51 in the live account, is a good
// note: it carries the decision, the deciding gate, the figures, and two
// explicit statements of what was NOT established. It never names a screen, an
// endpoint, or a verb. The specialist who opens it is told a person has to
// decide and is not told where a person decides, or with which buttons, or —
// the case that actually costs an afternoon — that for this use case there is
// no such screen at all.
//
// Every one of those facts already exists, correct, in ./approvalRoutes.js. It
// was read by exactly one internal dashboard and by nothing a receiving human
// ever opens. This module turns that row into three sentences.
//
// ---------------------------------------------------------------------------
// ONE SOURCE, NOT NINE
// ---------------------------------------------------------------------------
// Nothing here is written per use case. `surface`, `endpoint`, `roles`,
// `slotsRequired`, `verbs` and `control` come off the row; the team name comes
// off src/shared/escalationRouting.js. A use case that changes its approval
// surface changes one row and every note follows. Nine copies of a sentence is
// how the routing table drifted into contradicting itself in the first place
// (docs/ESCALATION-DESTINATIONS.md §2), and a note builder is exactly the kind
// of place a tenth copy gets written.
//
// ---------------------------------------------------------------------------
// IT READS A VERDICT. IT NEVER FORMS ONE.
// ---------------------------------------------------------------------------
// Whether a particular case is open to a decision right now is decided
// server-side and already on the wire as `{actionable, actionableReason}` —
// src/review/service.js:80, src/uc04/server.js:108, src/uc06/server.js:108 and
// six more. This module takes that pair and prints it. There is no branch here
// that inspects a status column, a decision string, a role, or an approver, and
// there must never be one: a note that computed its own second opinion about
// actionability would be a rival policy engine wearing prose, and the first
// time the two disagreed the ticket would say one thing while the panel did
// another. Absent verdict => this module says the panel is the authority and
// that this note did not check, which is true.
//
// ---------------------------------------------------------------------------
// THE FOUR STATES, AND WHY THEY MUST NOT READ ALIKE
// ---------------------------------------------------------------------------
//   exists + open      A surface, and it is open. Name it, name the verbs.
//   exists + closed    A surface, and it is shut for this case. Naming the
//                      buttons here would send somebody to a panel that
//                      refuses them; naming NOTHING would read like the
//                      no-surface case. So: the surface IS named, the verbs
//                      are withheld, and the server's own reason is quoted.
//   none_by_design     🔴. No approve verb exists and none may. The receiver
//                      must be told plainly, up front, because "no buttons"
//                      discovered by hunting for them reads as a broken page.
//   none_missing       A surface that OUGHT to exist and does not. The
//                      architecture is not working here; it is short a screen.
//
// The last two are the pair this whole file exists to keep apart. They render
// as the same absence of buttons and they are opposite facts: one is the
// 🔴 guarantee holding, the other is a hole. ./approvalRoutes.js keeps them as
// two words for that reason; collapsing them in the prose would undo it one
// layer up, where nobody would think to look.
//
// PURE. No I/O, no client, no clock. Strings in, strings out.
// ---------------------------------------------------------------------------

import { approvalRouteFor } from "./approvalRoutes.js";
import { escalationTeamFor } from "../shared/escalationRouting.js";

/**
 * The human word for each action token a server accepts. ONE map rather than a
 * word per row: the tokens are already on the row, and a per-row phrase would
 * be the tenth copy this file exists to avoid.
 *
 * `signoff` earns its own entry, and it is the reason `verbs` is data rather
 * than an assumed approve/decline pair. UC-05 signs a calculation off; UC-09
 * denies rather than declines. "Approve or deny" is not the option set on
 * either of them, and a note that said so would be telling a specialist to
 * press a button that is not on their screen.
 */
const VERB_WORDS = Object.freeze({
  approve: "approve",
  decline: "decline",
  deny: "deny",
  hold: "hold",
  signoff: "sign off",
});

/** "approve", "approve or decline", "approve, decline or hold". */
function verbList(verbs) {
  const words = verbs.map((v) => VERB_WORDS[v] ?? v);
  if (words.length === 0) return "";
  if (words.length === 1) return words[0];
  return `${words.slice(0, -1).join(", ")} or ${words[words.length - 1]}`;
}

/** "Customer admin and Payroll specialist". */
function roleList(roles) {
  const labels = roles.map((r) => r.label);
  if (labels.length === 0) return "";
  if (labels.length === 1) return labels[0];
  return `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
}

/**
 * @typedef {object} HandoffDirections
 * @property {string} useCase
 * @property {"exists"|"none_by_design"|"none_missing"|"unknown"} control
 * @property {boolean|null} open  the SERVER's verdict, echoed. null = not supplied
 * @property {string} where    sentence 1 — the named surface, or the absence
 * @property {string} options  sentence 2 — the verbs actually available
 * @property {string} limits   sentence 3 — what this surface will not do
 * @property {string|null} endpoint  the route that records the decision
 * @property {string[]} verbs  the action tokens the server accepts
 * @property {string[]} lines  the three sentences, in order
 * @property {string} text     the three sentences as plain text
 * @property {string} html     the three sentences as an HTML fragment
 */

/**
 * Three sentences telling one receiving human what to do with this ticket.
 *
 * @param {object} args
 * @param {string} args.useCase   "UC-01" … "UC-09"
 * @param {boolean|null} [args.actionable]  the server's own verdict, verbatim.
 *   Omit when the caller does not have one — omitted is NOT the same as false,
 *   and this module says which it was rather than guessing.
 * @param {string|null} [args.actionableReason]  the server's own sentence
 * @returns {HandoffDirections}
 */
export function handoffDirections({ useCase, actionable = null, actionableReason = null }) {
  return directionsForRoute({
    useCase,
    route: approvalRouteFor(useCase),
    team: escalationTeamFor(useCase),
    actionable,
    actionableReason,
  });
}

/**
 * The renderer, taking the row rather than looking it up.
 *
 * SEPARATE FROM handoffDirections() FOR ONE REASON, and it is the reason
 * ./approvalRoutes.js kept `none_missing` after UC-03 left it: **no use case is
 * in that state today.** A renderer reachable only through a use-case id would
 * make that branch untestable the moment the table empties it, and an
 * untestable branch is one refactor away from reading like its opposite —
 * which for these two states is the exact confusion the whole distinction
 * exists to prevent. Passing the row in keeps every state exercisable from a
 * test whether or not anything currently occupies it.
 *
 * @param {object} args
 * @param {string} args.useCase
 * @param {import("./approvalRoutes.js").ApprovalRoute|null} args.route
 * @param {string|null} [args.team]  the owning/receiving team, from
 *   src/shared/escalationRouting.js. Never composed here.
 * @param {boolean|null} [args.actionable]
 * @param {string|null} [args.actionableReason]
 * @returns {HandoffDirections}
 */
export function directionsForRoute({
  useCase,
  route,
  team = null,
  actionable = null,
  actionableReason = null,
}) {
  // A use case with no row. Fail visible, in the shape docs/APPROVAL-QUEUE.md
  // and awaiting.js already use: an unrecognised thing is "cannot tell", never
  // a quiet default. A guessed surface is the one guess a hand-off must never
  // make — it would send a real person to a real screen that does not decide
  // this.
  if (!route) {
    return assemble({
      useCase,
      control: "unknown",
      open: null,
      endpoint: null,
      verbs: [],
      where:
        `Where to act: not answerable from here. ${useCase} has no row in ` +
        "src/approvalqueue/approvalRoutes.js, so this system cannot say whether an approval surface " +
        "exists for it, let alone name one.",
      options:
        "Your options: unknown. No verb list is being offered rather than a plausible one: " +
        "an invented approve button is worse than an admitted gap.",
      limits:
        "What you cannot do here: rely on this note for the hand-off. Treat the routing as unproven " +
        "and find the owning team before acting.",
    });
  }

  const { control, surface, endpoint, roles, slotsRequired, note, verbs = [] } = route;
  const owner = team ?? "the owning team named on this ticket";

  if (control === "none_by_design") {
    return assemble({
      useCase,
      control,
      open: false,
      endpoint: null,
      verbs: [],
      where:
        "Where to act: nowhere in this system, and that is the design. This is a high-risk (\u{1F534}) " +
        `dossier: it was compiled for ${owner} to act on in their own process, and it is on this ` +
        "ticket so that it reaches them.",
      options:
        "Your options: there is no approve verb and no decline verb — not missing, not permitted. " +
        `${note}`,
      limits:
        "What you cannot do here: approve, execute or dispose of this from the sidebar, " +
        "the approval queue, or any endpoint. This use case's server has no POST route at all and a " +
        "test asserts it never gains one, so there is nothing to look for and nothing to request. " +
        "Read the dossier, decide outside this system, and record what you did where your team " +
        "records it.",
    });
  }

  if (control === "none_missing") {
    return assemble({
      useCase,
      control,
      open: false,
      endpoint: null,
      verbs: [],
      where:
        `Where to act: nowhere yet, and that is a gap rather than a rule. ${owner} owns this ticket ` +
        "and this system currently gives them no screen to record a decision on.",
      options: `Your options: none, and none exist to be found anywhere else. ${note}`,
      limits:
        "What you cannot do here: complete this request from any surface this system " +
        "provides. This is NOT the deliberate refusal that protects a high-risk path: something is " +
        "supposed to be able to sign this off and nothing can. Until that surface exists, say so on " +
        "the ticket rather than closing it — a closed ticket would record a decision nobody made.",
    });
  }

  // control === "exists".
  const surfaceSentence =
    `Where to act: ${surface}. Open this ticket in Zendesk and the panel is on it; ` +
    `the decision is recorded by ${endpoint}.`;

  if (actionable === false) {
    return assemble({
      useCase,
      control,
      open: false,
      endpoint,
      verbs,
      where: surfaceSentence,
      // The verbs are deliberately NOT listed. The panel exists and is shut for
      // this case; printing its buttons would send somebody to press one and be
      // refused, which is how a correct refusal gets read as a broken screen.
      options:
        "Your options: none on this case right now. The panel is there and its controls are closed " +
        "for this record.",
      limits:
        "What you cannot do here: record a decision on it. " +
        (actionableReason
          ? `The reason recorded with that verdict: "${actionableReason}"`
          : "No reason was supplied with that verdict, which is itself worth reporting.") +
        " The verdict was made server-side and is not this note's opinion: the endpoint will refuse " +
        "the decision, not merely hide the button.",
    });
  }

  const multiSlot = (slotsRequired ?? 1) > 1;

  // WHO fills the verb. Three shapes, and the third is the one that would be
  // wrong if it were guessed: UC-09 names three roles behind a floor of TWO, so
  // "three signatures" and "the three roles sign" are both false. The floor is
  // the number; the roles are the pool it is drawn from.
  const roleWho =
    roles.length === 0
      ? "Any reviewer who can reach the panel records it."
      : multiSlot
        ? `At least ${slotsRequired} signatures are required, each from a different person, drawn ` +
          `from ${roleList(roles)}.`
        : `The named slot is ${roleList(roles)}; one person fills it, once.`;

  // WHAT THIS SURFACE WILL NOT DO. Three real limits, none of them invented:
  // a slot you cannot fill twice, a decision no other screen records, and — on
  // the two rows that name no role — the fact that nothing checks whether the
  // person clicking was entitled to.
  const outstanding = multiSlot ? (slotsRequired ?? 2) - 1 : 0;
  const boundary = multiSlot
    ? "finish this alone — your signature fills one slot, and the remaining " +
      `${outstanding} must come from ${outstanding === 1 ? "a different person" : "different people"}.`
    : roles.length === 0
      ? "rely on this screen to check that you are the right person to decide it. " +
        `${useCase} names no role, so the system records who decided, not what they were entitled ` +
        "to decide."
      : `record it anywhere else — no other panel, queue or endpoint in this system decides ` +
        `${useCase}.`;

  return assemble({
    useCase,
    control,
    open: actionable === true ? true : null,
    endpoint,
    verbs,
    where: surfaceSentence,
    options: verbs.length
      ? `Your options: ${verbList(verbs)} — those words and no others, because they are the tokens ` +
        `the endpoint accepts. ${roleWho}`
      : "Your options: the panel exists but this row lists no verbs, which is a defect in " +
        `src/approvalqueue/approvalRoutes.js rather than a fact about ${useCase}. ${roleWho}`,
    limits:
      `What you cannot do here: ${boundary} Also true of this one: ${note} ` +
      (actionable === true
        ? "The API has already confirmed this case is open to a decision."
        : "Whether THIS case is still open to a decision is the panel's answer, not this note's — " +
          "this note was written at hand-off and has not re-checked it."),
  });
}

/**
 * The same three sentences as an HTML fragment, for the one surface in this
 * repo that composes markup: an internal Zendesk note.
 *
 * `public: false` IS THE CALLER'S JOB AND IT IS THE DANGEROUS ONE. This
 * function returns a fragment and never a comment object, deliberately — every
 * caller must pass it into a comment whose `public: false` they set themselves,
 * where their own test can see it. CLAUDE.md §4 records what the other shape
 * costs: an n8n `publicReply` posted a rendered document straight to a customer
 * on a run that reported success everywhere. Nothing composed here is fit for a
 * customer to read; it names endpoints, internal roles and internal gaps.
 *
 * @param {Parameters<typeof handoffDirections>[0]} args
 * @returns {string}
 */
export function handoffDirectionsHtml(args) {
  return handoffDirections(args).html;
}

/** Every interpolated value is escaped; notes carry text people typed. */
function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Bold the leading "Where to act:" label, so the three sentences scan as three
 * at a glance rather than as a paragraph. The FIRST ": " is the label
 * separator; later ones (the quoted API reason carries one) stay in the body.
 */
function asHtml(line) {
  const split = line.indexOf(": ");
  if (split === -1) return `<p>${esc(line)}</p>`;
  const body = line.slice(split + 2);
  return (
    `<p><strong>${esc(line.slice(0, split))}.</strong> ` +
    `${esc(body.charAt(0).toUpperCase() + body.slice(1))}</p>`
  );
}

function assemble({ useCase, control, open, endpoint, verbs, where, options, limits }) {
  const lines = [where, options, limits];
  return Object.freeze({
    useCase,
    control,
    open,
    where,
    options,
    limits,
    endpoint: endpoint ?? null,
    verbs: Object.freeze([...verbs]),
    lines: Object.freeze(lines),
    text: lines.join("\n"),
    html: ["<h3>What to do with this</h3>", ...lines.map(asHtml)].join("\n"),
  });
}
