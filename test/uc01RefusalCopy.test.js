// ---------------------------------------------------------------------------
// uc01RefusalCopy.test.js — L-6: a gate slug must never reach a person
// ---------------------------------------------------------------------------
// §14 of the acceptance contract: *"A refusal must be actionable. An ineligible
// requester is told what they CAN get, in one sentence, in their own words —
// not that a gate refused."*
//
// The structural test below is the load-bearing one. Reviewing copy by eye
// catches today's slug and not tomorrow's: the failure mode is a NEW reason
// added to GATE_SEQUENCE with no copy written for it, which then reaches a
// requester as `engagement_not_eor_contractor` — and nothing anywhere would
// have noticed, because the string is true, correctly spelled and produced by
// working code. Since G-1 this is the highest-volume message UC-01 sends.
// ---------------------------------------------------------------------------

import { test } from "node:test";
import assert from "node:assert/strict";
import { refusalCopyFor, refusalReplyFor, REASONS_WITH_COPY } from "../src/uc01/refusalCopy.js";
import { GATE_SEQUENCE } from "../src/uc01/policyEngine.js";

/** Reasons that END the conversation with the requester rather than handing it
 *  to a person. Exactly these must carry copy — no more, no fewer. */
const TERMINAL_REASONS = [
  "engagement_not_eor_contractor",
  "engagement_not_eor_direct",
  "engagement_onboarding_incomplete",
  "engagement_offboarding",
  "eor_status_unknown",
  "self_service_available",
  // G-3 / VC-33. Terminal for the THIRD PARTY on this channel either way —
  // nothing further happens to them here whether the employee has not yet
  // answered or has declined. See refusalCopy.js's own comment for why these
  // two reasons deliberately carry the identical copy object.
  "awaiting_employee_consent",
  "consent_refused",
];

test("STRUCTURAL: no gate slug appears in any customer-facing string", () => {
  const slugs = [...new Set(GATE_SEQUENCE.map((r) => r.reason))];
  for (const reason of REASONS_WITH_COPY) {
    const text = refusalReplyFor(reason);
    for (const slug of slugs) {
      assert.ok(!text.includes(slug), `copy for ${reason} leaks the slug "${slug}"`);
    }
    // A belt-and-braces check that catches a slug this repository has not
    // invented yet: requester-facing prose has no snake_case in it at all.
    assert.ok(
      !/\b[a-z]+(_[a-z]+){1,}\b/.test(text),
      `copy for ${reason} contains a snake_case token, which is how a slug arrives`
    );
  }
});

test("every terminal reason has copy, and nothing else does", () => {
  // Both directions. Missing copy sends a slug to a person; SPARE copy is a
  // template quietly answering a case a specialist was supposed to write to,
  // which is the worse of the two and much harder to notice.
  assert.deepEqual([...REASONS_WITH_COPY].sort(), [...TERMINAL_REASONS].sort());
  for (const row of GATE_SEQUENCE) {
    const hasCopy = REASONS_WITH_COPY.includes(row.reason);
    assert.equal(hasCopy, TERMINAL_REASONS.includes(row.reason), `copy presence wrong for ${row.reason}`);
  }
});

test("a reason a human answers returns null — never an empty string, never a default", () => {
  // The caller must be able to tell "a person writes this" from "we have
  // nothing to say". An empty string is indistinguishable from a template that
  // failed to render, and would be posted to the customer as a blank reply.
  for (const reason of ["low_confidence", "over_scope_request", "third_party_request", "identity_not_verified"]) {
    assert.equal(refusalCopyFor(reason), null, reason);
    assert.equal(refusalReplyFor(reason), null, reason);
  }
  assert.equal(refusalCopyFor("a_reason_that_does_not_exist"), null);
});

test("every message answers BOTH of the reader's two questions", () => {
  // docs/UI-AUDIENCES.md's rule: a fact earns its place by answering one of
  // THIS reader's questions. A refused requester has exactly two — *can I get
  // this?* and *then what do I do?* — and a message answering only the first is
  // the one this repository already shipped.
  for (const reason of REASONS_WITH_COPY) {
    const copy = refusalCopyFor(reason);
    assert.ok(copy.message.length > 40, `${reason}: no answer to "can I get this?"`);
    assert.ok(copy.whatYouCanGet.length > 40, `${reason}: no answer to "then what do I do?"`);
    assert.notEqual(copy.message, copy.whatYouCanGet);
  }
});

test("a refusal discloses NOTHING about the employment record", () => {
  // G-1 runs AHEAD of identity, so these messages are sent before the system
  // knows whether it is even talking to the right person. Nothing in them may
  // reveal anything about the record beyond the fact that a request was
  // refused — not a name, not a status, not a date, not an id.
  for (const reason of REASONS_WITH_COPY) {
    const text = refusalReplyFor(reason);
    assert.ok(!/\bemp_[a-z0-9_]+/i.test(text), `${reason} leaks an employment id shape`);
    assert.ok(!/\b\d{4}-\d{2}-\d{2}\b/.test(text), `${reason} leaks a date`);
    assert.ok(!/salary|compensation|\$|€|£/i.test(text), `${reason} mentions money`);
  }
});

test("the contractor message says what Remote IS, not only what it is not", () => {
  // The specific sentence §14 names, and the highest-volume message the use
  // case sends. Pinned by content because "we cannot help you" satisfies every
  // structural check above and is exactly the failure this gate must not have.
  const text = refusalReplyFor("engagement_not_eor_contractor");
  assert.match(text, /not your legal employer/i);
  assert.match(text, /contract|invoice/i);
});

test("the deflection reads as good news and names where to go", () => {
  const text = refusalReplyFor("self_service_available");
  assert.match(text, /Requests tab/);
  // It must NOT read as a refusal: nothing was refused, and a requester who
  // reads it as one will reply asking why, which costs the exchange the
  // deflection was meant to save.
  assert.ok(!/(cannot|can't|unable to) issue/i.test(text));
});
