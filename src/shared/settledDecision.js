// ---------------------------------------------------------------------------
// settledDecision.js  —  Describing a decision that has already been taken,
//                        from the row rather than from a list of possibilities
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
// A specialist opened a settled UC-02 claim in the ZAF sidebar and the whole
// DECISION card read:
//
//     "This claim has already been released or declined."
//
// Every word true, and it answers none of the questions the reader has. WHICH
// of the two decides whether the employee is owed money. WHO decides who to ask
// about it. WHEN decides whether it is still live. The NOTE is the actual
// content of the decision. And whether the REMOTE WRITE landed decides whether
// the thing exists or only the record of it does. All five were already on the
// row and all five were discarded in favour of a sentence enumerating
// possibilities the row does not have to guess between.
//
// src/uc02/reviewPolicy.js's describeSettled()/describeNoReviewPath() fixed
// that for UC-02. The identical sentence was still sitting in four other
// approval policies, each with the identical facts on its own row:
//
//   src/uc04/approvalPolicy.js       "already been approved or declined"
//   src/uc05/signoffPolicy.js        "already been signed off or declined"
//   src/uc06/dualApprovalPolicy.js   "already been executed or declined"
//   src/uc09/multiApprovalPolicy.js  "already been executed or denied"
//
// This file holds the CLAUSES those sentences are built from, not the sentences
// themselves. The four use cases genuinely differ — different verbs, different
// column names, different things that may or may not have reached Remote — so
// one function returning one sentence for all of them would either lie about a
// verb or take so many parameters that it was a template in disguise. What they
// share is the shape of each clause and, more importantly, the RULES those
// clauses encode:
//
//   * a human saying yes and Remote accepting the write are DIFFERENT FACTS,
//     and conflating them is how "approved" comes to mean two things;
//   * a decline with no reason recorded is called out, because a decline is
//     supposed to carry one and silence is not the same as none;
//   * an absent value degrades to saying nothing, never to a confident guess.
//
// Encoding those once means a fifth approval policy inherits them instead of
// re-deriving them, which is the whole reason UC-02's version was not simply
// copied four times.
//
// THE GENERIC STRING STAYS. Each REFUSALS map keeps its "X or Y" sentence as
// the fallback for a row that genuinely cannot say which outcome it got. An
// honest "we cannot say" beats a confident guess — it should just be rare, and
// each use case's tests pin that it is.
// ---------------------------------------------------------------------------

/**
 * A moment, written the way a person writes one: "19 Aug 2026 at 22:25 UTC".
 *
 * WHY THIS IS NOT COSMETIC. The project owner read a settled decision that
 * opened "Already APPROVED by b.person@gmail.com on Wed Aug 19 2026 22:25:07
 * GMT+0000 (Coordinated Universal Time)" — forty characters of timestamp, half
 * of them a timezone name nobody asked for, in the first line of the first
 * thing a reader sees. That string is what JavaScript prints when a `Date`
 * object is concatenated, and a `Date` object is exactly what `pg` returns for
 * a `timestamptz` column, so every settled decision read back out of Postgres
 * carried it while every one read out of memory carried a clean ISO string. The
 * two surfaces disagreed and only the live one was ugly.
 *
 * ACCEPTS EITHER, AND INVENTS NEITHER. A `Date`, an ISO string, or anything
 * else: whatever cannot be parsed is returned trimmed and unaltered, because a
 * timestamp this function cannot read is still a fact the reader may need, and
 * guessing at one would be worse than printing it raw.
 *
 * UTC IS STATED, NOT ASSUMED AWAY. Every timestamp this system records is UTC,
 * and a time with no zone on it is a time a reader has to guess about.
 *
 * @param {string|Date|null|undefined} when
 * @returns {string} the formatted moment, or ""
 */
export function humanTime(when) {
  if (when === null || when === undefined) return "";
  const raw = when instanceof Date ? when : String(when).trim();
  if (raw === "") return "";
  const ms = when instanceof Date ? when.getTime() : Date.parse(raw);
  if (!Number.isFinite(ms)) return String(raw).trim();
  const d = new Date(ms);
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const pad = (n) => String(n).padStart(2, "0");
  return (
    `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()} ` +
    `at ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`
  );
}

/**
 * " by Dana on 19 Aug 2026 at 05:02 UTC", " on 19 Aug 2026 at 05:02 UTC",
 * or "".
 *
 * Attribution and timing are separate facts and either can be missing, so
 * every combination has to read as a sentence. Never invents a name for an
 * unattributed decision — an unsigned action is itself worth seeing.
 *
 * @param {string|null|undefined} who
 * @param {string|Date|null|undefined} when  ISO timestamp, or a `pg` Date
 * @returns {string} leading-space clause, or ""
 */
export function attribution(who, when) {
  const name = String(who ?? "").trim();
  const at = humanTime(when);
  if (name && at) return ` by ${name} on ${at}`;
  if (name) return ` by ${name}`;
  if (at) return ` on ${at}`;
  return "";
}

/**
 * A value dropped into the middle of a sentence, without the full stop it may
 * already be carrying.
 *
 * THE DOUBLED FULL STOP WAS REAL AND IT WAS READ. "…nothing here fabricates an
 * id.. The approval is real…" reached the project owner, because the clause was
 * built as `${detail}.` and the detail — a durable field, written once into the
 * row and read back for the rest of that row's life — already ended in one.
 * Trimming at the JOIN rather than at the source is deliberate: rows written
 * before this fix still hold the old text, and a fix that only corrects new
 * writes leaves every existing decision reading exactly as it did.
 *
 * @param {unknown} value
 * @returns {string}
 */
export function unpunctuated(value) {
  return String(value ?? "")
    .trim()
    .replace(/[.;,]+$/, "");
}

/**
 * The note the decider left, or the fact that they left none.
 *
 * `expected: true` is for actions that are SUPPOSED to carry a reason — a
 * denial, a decline. Silence there is a finding, not a blank, and saying so is
 * what stops "no reason given" from reading as "no reason needed".
 *
 * @param {string|null|undefined} note
 * @param {object} [opts]
 * @param {string} [opts.label]     how to introduce a note that exists
 * @param {boolean} [opts.expected] whether its absence is worth reporting
 * @param {string} [opts.missing]   what to say when it is absent and expected
 * @returns {string} leading-space clause, or ""
 */
export function noteClause(note, { label = "Note left", expected = false, missing = "" } = {}) {
  const text = String(note ?? "").trim();
  if (text) return ` ${label}: “${text}”.`;
  if (expected) return ` ${missing || "No reason was recorded, which this action is supposed to carry."}`;
  return "";
}

/**
 * WHETHER THE WRITE ACTUALLY LANDED — the load-bearing clause.
 *
 * A human approving and the downstream system accepting are different facts,
 * and the result field is written only after the call returns. With no result
 * recorded this says so outright rather than letting the approval stand in for
 * the outcome, because the question a reader actually has is whether the thing
 * exists.
 *
 * @param {unknown} remoteResult   the row's recorded result of the write
 * @param {object} opts
 * @param {string} opts.landed     what to say when a result IS recorded
 * @param {string} opts.artifact   the noun whose existence is in doubt
 * @returns {string} leading-space clause
 */
export function remoteWriteClause(remoteResult, { landed, artifact }) {
  if (remoteResult) return ` ${landed}`;
  return (
    ` No Remote write is recorded against it, so the approval may not have reached Remote — check the` +
    ` audit trail before assuming ${artifact} exists.`
  );
}

/**
 * The gate a request stopped at, in plain words, for a "this never reached a
 * human decision" refusal.
 *
 * Takes the use case's own bound `describeDecidingGate` (src/shared/gateLadder.js)
 * rather than a sequence, so the caller keeps its single-argument call shape and
 * this file never learns any use case's gate order. A reason with no row yields
 * "" — describeDecidingGate() returns null in that case on purpose, and a
 * fabricated gate position would read like a real one.
 *
 * @param {(reason: string) => ({position:number, gate:string, means:string}|null)} describeDecidingGate
 * @param {string} reason
 * @returns {{at: string, means: string}}  `at` is " at gate 4 (Ownership)" or ""
 */
export function gateClause(describeDecidingGate, reason) {
  const row = describeDecidingGate ? describeDecidingGate(reason) : null;
  if (!row || row.position === null || row.position === undefined) return { at: "", means: "" };
  return { at: ` at gate ${row.position} (${row.gate})`, means: row.means ? ` ${row.means}` : "" };
}
