// ---------------------------------------------------------------------------
// disclaimer.js  —  Disclaimer injector
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
// Some responses (travel/workation guidance in UC-03, tax context in UC-08,
// mobility feasibility in UC-07) must never read as legal or tax *advice*. A
// mandatory disclaimer is appended to every such customer-facing message. Doing
// this in one shared place means no use case can "forget" it.
// ---------------------------------------------------------------------------

export const DISCLAIMERS = {
  travel:
    "This information is provided for general guidance only and does not constitute legal or immigration advice. Please confirm entry and work requirements with the relevant authorities.",
  tax:
    "This is general information only and not tax or legal advice. Your specific situation must be reviewed by a qualified tax specialist.",
  mobility:
    "This is a preliminary feasibility summary, not a decision or legal advice. A mobility specialist will review before any action is taken.",
};

/**
 * Append the appropriate disclaimer to a message.
 * @param {string} message
 * @param {keyof typeof DISCLAIMERS} kind
 * @returns {string}
 */
export function withDisclaimer(message, kind) {
  const disclaimer = DISCLAIMERS[kind];
  if (!disclaimer) throw new Error(`No disclaimer of kind "${kind}"`);
  return `${message}\n\n---\n${disclaimer}`;
}
