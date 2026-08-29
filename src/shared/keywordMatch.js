// ---------------------------------------------------------------------------
// keywordMatch.js  —  the keyword half of the substring defect
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
// The two curated-corpus retrievers (uc07/mobilityRetriever.js and
// uc08/treatyRetriever.js) select citations with:
//
//     entry.keywords.filter((kw) => lower.includes(kw))
//
// and then PUBLISH the matched keyword to the reviewer in `matchedOn` — the
// honesty mechanism that says "this citation is here because your text said
// X". Substring matching makes that statement false in the most confusing
// possible way:
//
//   - "mot" (Minimum Onboarding Time) is inside "reMOTe" — the name of the
//     platform this entire system runs on, present in a large share of real
//     tickets. Every one of them was cited MOT guidance, "matched on: mot".
//   - "a1" (the A1 social-security certificate) is inside "A123" and any other
//     identifier, so a payslip question was cited totalization guidance.
//   - "pe" (permanent establishment) is inside "PEople", "PErmit", "PEnsion",
//     "PEriod" — in the n8n copy of the mobility corpus.
//
// Same defect as countryMentions.js closes for country names, one field over.
// A citation a specialist did not ask for is cheaper than a wrong jurisdiction,
// but it is still a fabricated reason attached to a real document.
//
// WHAT THE RULE IS, AND WHAT IT DELIBERATELY KEEPS
// A keyword must start at a word boundary and must not run into a digit.
// Trailing LETTERS are still allowed, because several corpus keywords are
// deliberate stems: "immigrat" is written to catch immigration/immigrate,
// "liquidat" to catch liquidate/liquidation, "portab" portable/portability.
// Requiring a closing boundary would silently kill all of those — trading a
// false-positive problem for a false-negative one, which in a retrieval layer
// is the harder failure to notice.
// ---------------------------------------------------------------------------

import { asLowerText } from "./text.js";

function escapeRegExp(literal) {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Which of `keywords` genuinely occur in `text`.
 * @param {unknown} text
 * @param {string[]} keywords
 * @returns {string[]} the matching keywords, in the corpus's own order
 */
export function matchKeywords(text, keywords) {
  const lower = asLowerText(text);
  return (keywords ?? []).filter((kw) => {
    const key = String(kw).toLowerCase().trim();
    if (!key) return false;
    return new RegExp(`(?<![a-z0-9])${escapeRegExp(key)}(?![0-9])`).test(lower);
  });
}
