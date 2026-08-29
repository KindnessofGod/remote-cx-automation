// ---------------------------------------------------------------------------
// money.js  —  Money middleware (the "×100 scaling" rule)
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
// Remote's API represents every monetary amount as an INTEGER equal to the
// amount in the currency's base unit multiplied by 100. This avoids floating-
// point rounding errors when money crosses international systems.
//
//   $50,000.00  ->  5000000   (the API wants this)
//   5000000     ->  $50,000.00 (what a human/LLM should see)
//
// If you forget this conversion, you can overpay or underpay someone by 100x.
// That is why it lives in ONE place that every use case reuses, instead of
// being re-typed (and mis-typed) in each workflow.
// ---------------------------------------------------------------------------

/**
 * Convert a human decimal amount (e.g. 50000.00) into Remote's integer form.
 * Use this right BEFORE sending money to the Remote REST API.
 * @param {number} humanAmount  e.g. 50000.00
 * @returns {number} integer scaled by 100, e.g. 5000000
 */
export function toRemoteInteger(humanAmount) {
  if (typeof humanAmount !== "number" || Number.isNaN(humanAmount)) {
    throw new TypeError(`toRemoteInteger expected a number, got ${humanAmount}`);
  }
  // Math.round guards against tiny float errors like 50000.005 -> 5000000.4999
  return Math.round(humanAmount * 100);
}

/**
 * Convert Remote's integer form back into a human decimal amount.
 * Use this right AFTER reading money from Remote, before showing it to a
 * person or handing it to an LLM.
 * @param {number} remoteInteger  e.g. 5000000
 * @returns {number} human amount, e.g. 50000
 */
export function fromRemoteInteger(remoteInteger) {
  if (!Number.isInteger(remoteInteger)) {
    throw new TypeError(`fromRemoteInteger expected an integer, got ${remoteInteger}`);
  }
  return remoteInteger / 100;
}

/**
 * Format a Remote integer amount as a display string with its currency.
 * @param {number} remoteInteger e.g. 5000000
 * @param {string} currency e.g. "USD"
 * @returns {string} e.g. "50,000.00 USD"
 */
export function formatMoney(remoteInteger, currency = "USD") {
  const human = fromRemoteInteger(remoteInteger);
  return `${human.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
}

/**
 * Read a monetary amount as it ARRIVES FROM THE REMOTE API and place it on the
 * integer-minor-units axis every other function in this file works in — or
 * return null when it cannot be placed there.
 *
 * WHY THIS EXISTS, AND WHY IT IS HERE RATHER THAN AT THE CALL SITE
 * `GET /v1/payroll-runs` documents `total_payroll_cost` as `integer` and
 * returns it as a QUOTED STRING: `"total_payroll_cost": "15103469"`
 * [CONFIRMED live 2026-08-19 against gateway.remote-sandbox.com, same token,
 * same container; the reference page's schema says `"type": "integer"`]. Both
 * halves of that sentence matter. A consumer that trusts the documented type
 * hands the string straight to `fromRemoteInteger()`, which refuses it with a
 * TypeError — correctly, because `Number.isInteger("15103469")` is false and a
 * silent coercion is exactly how a money bug is built. And a consumer that
 * "fixes" the refusal locally writes `Number(x)` or `parseInt(x)` next to its
 * own arithmetic, which is the second copy of the ×100 convention this file
 * exists to prevent.
 *
 * So the parse lives here, once, and the REST client applies it at the
 * boundary (`src/remote/restClient.js`, `normalizePayrollRun()`): nothing
 * downstream of that client ever sees a money value whose type depends on
 * which endpoint answered.
 *
 * STRICT ON PURPOSE — the accepted forms are an integer `number` and a string
 * of digits with an optional sign, nothing else:
 *   - `"1.5"`, `1.5`      -> null. A fractional minor unit is not a thing
 *                            Remote sends, and rounding one is inventing a
 *                            figure. `Number("1.5")` would have accepted it.
 *   - `""`, `" "`, `null` -> null. `Number("")` is 0, which is the single most
 *                            dangerous coercion in JavaScript for money: an
 *                            empty field becomes a confident zero cost.
 *   - `"1e3"`, `"0x10"`   -> null. `Number()` accepts both; neither is a form
 *                            this API sends, so accepting them means guessing.
 *   - beyond 2^53-1       -> null rather than a silently rounded float.
 * NULL IS NEVER ZERO. Callers must treat it as "this amount was not readable",
 * the same way every other reader in this repo treats null as "not confirmed" —
 * a missing number gets investigated, a wrong one gets acted on.
 *
 * @param {unknown} value the raw field as the API sent it
 * @returns {number|null} integer minor units (×100), or null when unreadable
 */
export function parseRemoteMinorUnits(value) {
  if (typeof value === "number") {
    return Number.isSafeInteger(value) ? value : null;
  }
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!/^-?\d+$/.test(trimmed)) return null;
  const parsed = Number(trimmed);
  return Number.isSafeInteger(parsed) ? parsed : null;
}
