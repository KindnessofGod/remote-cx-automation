// ---------------------------------------------------------------------------
// productName.js  —  what this system is CALLED, in one place
// ---------------------------------------------------------------------------
// WHY THIS FILE EXISTS, in the project owner's words: *"there's so many mention
// of remote… I don't know if that's a good thing… or do you have to change the
// name of the system?"*
//
// THE ANSWER SPLITS IN TWO, AND ONLY ONE HALF IS A PROBLEM.
//
//   1. NAMING REMOTE AS THE THING THIS INTEGRATES WITH IS EVIDENCE, AND STAYS.
//      "Read from Remote just now", "no Remote write is recorded against it",
//      "Remote publishes no endpoint for this stage" — nearly every mention of
//      Remote in this system is a DISCLAIMER, a statement of what was not done
//      or what Remote has not seen. CLAUDE.md §1 picks Remote as the domain
//      precisely so every integration claim is checkable by a reader. Stripping
//      those would make the system less honest, not more polished. Nothing in
//      this file touches them.
//
//   2. BEING CALLED "Remote CX …" IS A CLAIM OF AFFILIATION, AND DOES NOT.
//      A product name is not a citation. "Remote CX Review", installed into a
//      Zendesk account as an app, reads as something Remote ships or endorses —
//      which is the one part with real trademark and optics exposure, and by
//      far the cheaper of the two to fix. This system is a third party that
//      integrates with Remote; the name should say that by not saying anything.
//
// WHY A CONSTANT RATHER THAN A SWEEP. The name is a product decision that is
// likely to change again, and it is currently spelled out in a ZAF manifest, an
// iframe title, two translation files and several page headings — none of which
// can import anything (JSON and static HTML). So this is the one authority and
// test/productName.test.js reads every one of those literals back against it,
// which is the only way a file that cannot import a constant can still be made
// to agree with one.
//
// CHANGING IT: edit PRODUCT_NAME here, run `npm test`, and the test names every
// literal that has drifted. Then re-upload the ZAF app — an installed app is a
// STATIC UPLOAD and does not track this repo (CLAUDE.md §6).
// ---------------------------------------------------------------------------

/**
 * The system's own name. A working name, deliberately plain: it describes what
 * the system does — check a request against ordered gates and either let it
 * through or hand it to a named human — and names no vendor.
 */
export const PRODUCT_NAME = "Gatehouse";

/** The name plus what it is, for a title bar or a case-study heading. */
export const PRODUCT_LONG_NAME = "Gatehouse CX Automation";

/**
 * The Zendesk app's own display name. Separate from the above because it names
 * the SURFACE rather than the system: an agent looking at their sidebar list is
 * choosing between panels, not between products.
 */
export const ZAF_APP_NAME = "Gatehouse CX Review";

/**
 * One sentence for anywhere the name alone would leave a reader guessing whose
 * system this is. It states the relationship in the direction that is true:
 * this integrates with Remote, and is not Remote's.
 */
export const PRODUCT_RELATIONSHIP =
  "An independent CX automation layer built against Remote's public API. Not a Remote product, and not endorsed by Remote.";
