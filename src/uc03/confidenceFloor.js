// ---------------------------------------------------------------------------
// confidenceFloor.js  —  one number, in one place, importable from both sides
// ---------------------------------------------------------------------------
// WHY THIS IS ITS OWN FILE AND NOT A LINE IN policyEngine.js
//
// `policyEngine.js` imports `letterScope.js` (the letter-scope gate) and
// `letterScope.js` needs this floor to re-apply the confidence check
// independently — see its §4 note on why a gate that opens a drafting path
// must not rest on an earlier gate having run. Importing it straight back out
// of `policyEngine.js` would make the two files a cycle. ESM would in fact
// tolerate this one (the value is only read at call time, as a default
// parameter), which is precisely the argument for not relying on it: a cycle
// that happens to work is a cycle that breaks the first time somebody reads
// the constant at module scope.
//
// `policyEngine.js` RE-EXPORTS it, so every existing importer
// (`src/portal/server.js`, `test/uc03.test.js`) is unchanged and there is
// still exactly one definition. The prose explaining WHY the number is 0.6
// stays with the gate that enforces it.
// ---------------------------------------------------------------------------

/**
 * Minimum classifier confidence required before UC-03's router will act on the
 * classified intent at all. See `policyEngine.js`'s re-export for the full
 * argument for 0.6 rather than UC-01's 0.85.
 */
export const DEFAULT_CONFIDENCE_THRESHOLD = 0.6;
