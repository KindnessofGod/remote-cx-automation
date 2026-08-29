// ---------------------------------------------------------------------------
// subject.js  —  Resolve a scenario's REAL subject values, live, never hardcoded
// ---------------------------------------------------------------------------
// The VC-13 absence assertion only means something if the probe strings are
// the actual values the live Sandbox carries for THIS employment id, not a
// fixture that happens to agree with the code (docs/WHY-THIS-SHAPE.md §8).
// ---------------------------------------------------------------------------

/**
 * @param {import("../remote/restClient.js").RemoteClient} remote
 * @param {string|null} employmentId
 * @returns {Promise<{fullName: string, jobTitle: string, countryCode: string}|null>}
 */
export async function resolveSubject(remote, employmentId) {
  if (!employmentId) return null;
  try {
    const employment = await remote.getEmployment(employmentId);
    if (!employment) return null;
    return {
      fullName: employment.full_name ?? null,
      jobTitle: employment.job_title ?? null,
      countryCode: employment.country_code ?? null,
    };
  } catch {
    return null;
  }
}
