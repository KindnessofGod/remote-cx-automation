// ---------------------------------------------------------------------------
// contractTypes.js — the engagement type in words, for every surface a person reads
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
//
// A UC-06 panel rendered **"Contract type: global_payroll"** to a specialist. A
// raw API slug reached a human because the label map that was supposed to catch
// it had no entry for that value — and it had no entry because there were THREE
// copies of that map, none of which knew what the others held:
//
//   src/uc01/letter.js:12          full_time · part_time · employee · contractor
//   src/shared/employeeSubject.js  full_time · part_time · employee · contractor
//   src/uc03/letter.js:99          full_time · part_time · employee · contractor
//
// All three fell back the same way (`CONTRACT_LABELS[raw] || raw`), so all three
// leaked the same slugs, and a fix applied to one would have left the other two
// leaking. This is `src/shared/countryNames.js`'s argument one vocabulary over,
// and it is CLAUDE.md §6's standing rule: *a jurisdiction or vocabulary property
// is not a use-case property, and two copies of a table drift.* Three copies of
// a label map with identical contents is that defect caught before it diverged,
// which is the only cheap moment to catch it.
//
// WHERE THE VALUES COME FROM, AND WHY THE OLD MAPS MISSED THREE OF THEM
//
// `RemoteClient.normalizeEmployment()` (restClient.js:1744) builds the field:
//
//     contract_type: raw.employment_model || raw.type || "unknown"
//
// So `contract_type` is not one vocabulary — it is whichever of Remote's TWO
// fields answered first, plus a sentinel. The three old maps were written
// against neither: `full_time`/`part_time` are values of the contract-amendment
// form's `work_schedule` property, a different question entirely, and they only
// ever reach `contract_type` through this repo's own flat mock fixtures.
// Meanwhile every value the LIVE API actually returns — `eor`, `global_payroll`,
// `global_payroll_employee` — was absent from all three. Each entry below names
// its grounding; nothing here is a guess. See the report in `GROUNDING` comments.
//
// THE FALLBACK IS MARKED, AND THAT IS A DELIBERATE DEPARTURE FROM countryNames.js
//
// `countryLabel()` prints an unnameable country's bare code, and argues for it:
// an ISO code is a public standard the reader can look up or quote to a
// consulate. A contract-type slug is not. `global_payroll` is an internal enum
// value from one vendor's API; a reader shown it bare cannot tell whether they
// are looking at Remote's own word for something or at this system failing to
// have a word. That ambiguity is the whole of the reported bug — the underscore
// alone did not mark it, because the report was filed by a person who saw the
// underscore and still had to ask.
//
// So an unrecognised value is printed AND marked: `foo_bar (unrecognised code)`.
// The raw value survives, because it is the thing somebody can grep for or quote
// in a bug report — that half of countryNames.js's argument does carry over.
// What does not carry over is printing it as though it were an answer. This is
// the same rule `employeeSubject.js` already applied to the `"unknown"` sentinel
// in its own words: *"rendering it as a contract type would make it look like
// one."*
//
// NOTHING HERE IS EVER COMPARED. Same division countryNames.js enforces: codes
// decide, names are read. No gate, policy or store may read this module, and no
// label may be written into a record — a label in a stored field is the alpha-3
// defect one vocabulary over.
// ---------------------------------------------------------------------------

/**
 * The sentinel `normalizeEmployment()` writes when the API offered neither
 * `employment_model` nor `type`. It is a real value meaning "we could not tell",
 * NOT a contract type, and every surface has to treat it as an absence.
 */
export const CONTRACT_TYPE_NOT_DETERMINED = "unknown";

/**
 * code -> label. A Map, not an object literal, so a key like `"constructor"`
 * resolves to nothing rather than to a stringified native function — the same
 * hazard `uc03/letter.js`'s `countryName()` guards by hand (finding F-21).
 * `contract_type` originates in the Remote API rather than an LLM, so this is
 * belt-and-braces, but a Map costs nothing to be right by construction.
 *
 * GROUNDING, per entry — every one traced to a live capture or a live probe,
 * none invented:
 *
 *   contractor                `employment_model` AND `type` on the live
 *                             `GET /v1/employments/3537d9ee-…` capture
 *                             (test/fixtures/sandboxCapture.js, 2026-08-19;
 *                             test/fixtures/remoteEmployment.js, 2026-08-17).
 *   eor                       `employment_model` on the live DEU capture
 *                             (remoteEmployment.js — Anna Müller, `type:
 *                             "employee"`), and one of the two models named in
 *                             restClient.js's live schema probe table
 *                             ("NLD/DEU/GBR/FRA/CAN/SGP/PRT, eor +
 *                             global_payroll -> 200", 2026-08-18). "Employer of
 *                             Record" is Remote's own product name and this
 *                             repo's subject matter (CLAUDE.md §1).
 *   global_payroll            the other model in that same live probe table;
 *                             also `employment_model` on the mock records
 *                             modelled field-for-field on live
 *                             `GET /v1/employments/75b88008-…`
 *                             (mockServer.js:474/538/597). THIS IS THE VALUE
 *                             THE REPORTED BUG RENDERED RAW.
 *   global_payroll_employee   `type` on those same live-modelled records
 *                             (mockServer.js:473), i.e. what
 *                             `normalizeEmployment()` yields for a global-payroll
 *                             employment whose `employment_model` is absent.
 *                             Same engagement as `global_payroll`, reached
 *                             through the other field, so it gets the same
 *                             label rather than a second wording for one thing.
 *   employee                  `type` on the live DEU capture above. Broader
 *                             than `eor`: it says the person is an employee and
 *                             not which entity employs them, which is exactly
 *                             what the plain word says.
 *   full_time / part_time     NOT engagement models. These are the `oneOf`
 *                             consts of `work_schedule` on the live
 *                             contract-amendment forms
 *                             (src/remote/fixtures/contractAmendmentSchemas.js,
 *                             captured 2026-08-18). They reach `contract_type`
 *                             only through this repo's own flat mock fixtures
 *                             (`contract_type: "full_time"`, 14 records), which
 *                             `normalizeEmployment()` passes through untouched.
 *                             Kept because those fixtures are what every UC-01
 *                             and UC-03 test renders, so removing the labels
 *                             would reintroduce the bug for the mock.
 *                             `part_time` appears as a `contract_type` NOWHERE
 *                             in this repository — it is inherited from the
 *                             three old maps and retained only because
 *                             `full_time`'s presence makes its absence a trap
 *                             for the next fixture author.
 *
 * @type {Map<string, string>}
 */
const LABELS = new Map([
  ["contractor", "Contractor"],
  ["eor", "Employer of Record (EOR) employee"],
  ["global_payroll", "Global Payroll employee"],
  ["global_payroll_employee", "Global Payroll employee"],
  ["employee", "Employee"],
  ["full_time", "Full-time"],
  ["part_time", "Part-time"],
]);

/**
 * The curated label, or `null` when there is none to give.
 *
 * NULL RATHER THAN THE SLUG, for countryNames.js's reason: a caller that falls
 * back has decided what its reader can cope with, and that is a decision for the
 * surface. `contractTypeLabel()` below is the one that makes it. Returning the
 * slug silently from here would make an unrecognised value indistinguishable
 * from a labelled one at every call site at once — which is the bug this module
 * was written for.
 *
 * The `"unknown"` sentinel returns null too: it is an absence wearing a value's
 * clothes, and it is not a contract type.
 *
 * @param {unknown} raw
 * @returns {string|null}
 */
export function contractTypeName(raw) {
  if (typeof raw !== "string") return null;
  const key = raw.trim().toLowerCase();
  if (key === "" || key === CONTRACT_TYPE_NOT_DETERMINED) return null;
  return LABELS.get(key) ?? null;
}

/**
 * What a surface should print: the label when there is one, the raw value
 * VISIBLY MARKED when there is not, and `absent` when the record says nothing.
 *
 * @param {unknown} raw
 * @param {string} [absent]  what to print when there is no value, or when the
 *   value is the `"unknown"` sentinel — both mean "the record does not say".
 * @returns {string}
 */
export function contractTypeLabel(raw, absent = "not recorded") {
  if (typeof raw !== "string" || raw.trim() === "") return absent;
  const trimmed = raw.trim();
  if (trimmed.toLowerCase() === CONTRACT_TYPE_NOT_DETERMINED) return absent;
  const name = contractTypeName(trimmed);
  if (name) return name;
  // Printed AND marked — see the file header. The raw value survives so it can
  // be grepped, quoted in a bug report, or matched against Remote's own docs;
  // the marker is what stops a reader taking a slug for an answer.
  return `${trimmed} (unrecognised code)`;
}

/** Every code this module can label — for tests, and for anything that must not
 *  offer a value nothing can render. */
export function labelledContractTypes() {
  return [...LABELS.keys()];
}
