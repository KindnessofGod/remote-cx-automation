// ---------------------------------------------------------------------------
// zendeskTicketHygiene.test.js — rca-mk6n / finding N-2, widened by rca-1qju:
// a ticket subject OR TAG carrying harness vocabulary (a bead id, a
// criterion id, a testing-round phrase) must never reach the live Zendesk
// queue, because that queue is a surface no persona-isolation control can
// filter — the specialist persona is REQUIRED to read it. See
// src/zendesk/ticketHygiene.js and
// qa/orchestration/PERSONA-ISOLATION-REREVIEW-2-2026-08-23.md.
//
// Renamed from zendeskSubjectHygiene.test.js when the module widened from
// subject-only to subject+tags — the old name would itself have been a
// stale claim about what this file covers.
// ---------------------------------------------------------------------------

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  findHarnessVocabulary,
  findHarnessVocabularyInTags,
  assertNoHarnessVocabulary,
  assertNoHarnessVocabularyInTags,
  assertTicketBodyClean,
} from "../src/zendesk/ticketHygiene.js";
import { ZendeskClient } from "../src/zendesk/restClient.js";
import { startMockServer } from "../src/zendesk/mockServer.js";

// The exact subjects quoted in the finding's evidence (byte 299090 / 154705
// of the specialist's transcript) — every one must be caught.
const OBSERVED_LEAKY_SUBJECTS = [
  "#70  rca-1bk VC-11 live proof — out of scope (2)",
  "Employment verification letter request — need salary included (F-7 proof, rca-1rx)",
  "rca-947 proof — employment letter (F-11)",
  "rca-uim live proof — employment verification letter request",
  "Proof of employment for my bank — rca-j2d re-eval",
];

// The exact live leak rca-1qju found — ticket #72's tag, raw, hyphen-joined,
// never word-normalised. See ticketHygiene.js's method-warning comment: a
// prior sweep that ran `.replace(/[_-]/g," ")` before testing reported a
// false "0 tag leaks" for this exact string.
const OBSERVED_LEAKY_TAG = "rca-c73-vc-blocked-proof";

test("findHarnessVocabulary catches every subject observed in the N-2 finding", () => {
  for (const subject of OBSERVED_LEAKY_SUBJECTS) {
    assert.ok(findHarnessVocabulary(subject), `expected a hit for: ${subject}`);
  }
});

test("assertNoHarnessVocabulary throws on a leaky subject, naming the finding", () => {
  assert.throws(
    () => assertNoHarnessVocabulary("#70 rca-1bk VC-11 live proof — out of scope (2)"),
    /rca-mk6n|N-2/,
  );
});

test("assertNoHarnessVocabulary is silent on ordinary product subjects", () => {
  const cleanSubjects = [
    "Employment verification letter request",
    "Contract amendment request — Alexandre Tremblay",
    "UC-01 — third-party disclosure request awaiting specialist review",
    "Proof of employment for my bank",
    "Request permission to work from another country",
    "F-1 visa sponsorship question", // a real visa type — must not be mistaken for a finding id
  ];
  for (const subject of cleanSubjects) {
    assert.equal(findHarnessVocabulary(subject), null, `unexpected hit for: ${subject}`);
    assert.doesNotThrow(() => assertNoHarnessVocabulary(subject));
  }
});

test("findHarnessVocabulary is null-safe", () => {
  assert.equal(findHarnessVocabulary(""), null);
  assert.equal(findHarnessVocabulary(undefined), null);
  assert.equal(findHarnessVocabulary(null), null);
});

// --- tags (rca-1qju) --------------------------------------------------------

test("findHarnessVocabularyInTags catches the exact tag observed live on ticket #72", () => {
  const hit = findHarnessVocabularyInTags(["uc01_test", OBSERVED_LEAKY_TAG]);
  assert.ok(hit, "expected a hit on the leaky tag");
  assert.equal(hit.tag, OBSERVED_LEAKY_TAG);
  assert.equal(hit.term, "rca-c73");
});

test("findHarnessVocabulary catches a term however its separators are spelled — hyphen, underscore, or space", () => {
  // The matcher is separator-agnostic by design (see ticketHygiene.js's SEP/
  // B/EB) precisely because an earlier PRE-normalise-then-match approach was
  // a confident, wrong zero in one direction (spacing before testing missed
  // "rca-1bk-vc11-proof") and a raw-only approach is the mirror-image miss
  // (misses "vc_33_proof"). Every spelling of the same term must be one hit,
  // not a blind spot in either direction.
  const hyphenated = OBSERVED_LEAKY_TAG; // "rca-c73-vc-blocked-proof"
  const underscored = OBSERVED_LEAKY_TAG.replace(/-/g, "_");
  const spaced = OBSERVED_LEAKY_TAG.replace(/-/g, " ");
  for (const spelling of [hyphenated, underscored, spaced]) {
    assert.ok(findHarnessVocabulary(spelling), `expected a hit for: ${JSON.stringify(spelling)}`);
  }
});

test("findHarnessVocabularyInTags is null-safe and silent on ordinary tags", () => {
  assert.equal(findHarnessVocabularyInTags(undefined), null);
  assert.equal(findHarnessVocabularyInTags([]), null);
  assert.equal(
    findHarnessVocabularyInTags(["uc01_test", "queue_hr_ops", "escalation_verification_exception"]),
    null,
  );
});

test("assertNoHarnessVocabularyInTags throws on a leaky tag, naming the finding and the tag", () => {
  assert.throws(
    () => assertNoHarnessVocabularyInTags(["uc01_test", OBSERVED_LEAKY_TAG]),
    /rca-mk6n|N-2|rca-1qju/,
  );
});

test("assertTicketBodyClean checks subject, tags, AND additional_tags with one function", () => {
  assert.doesNotThrow(() => assertTicketBodyClean(null));
  assert.doesNotThrow(() => assertTicketBodyClean({ subject: "Employment verification letter request" }));
  assert.throws(() => assertTicketBodyClean({ subject: "rca-1bk VC-11 live proof" }));
  assert.throws(() => assertTicketBodyClean({ subject: "clean", tags: [OBSERVED_LEAKY_TAG] }));
  assert.throws(() => assertTicketBodyClean({ subject: "clean", additional_tags: [OBSERVED_LEAKY_TAG] }));
});

test("assertTicketBodyClean does NOT check remove_tags — naming a tag being removed must not be refused", () => {
  assert.doesNotThrow(() => assertTicketBodyClean({ subject: "clean", remove_tags: [OBSERVED_LEAKY_TAG] }));
});

// --- ZendeskClient — the actual write-time choke point ---------------------

test("ZendeskClient#createTicket refuses a harness-vocabulary subject before ever making the request", async () => {
  const server = await startMockServer(4130);
  try {
    const zendesk = new ZendeskClient({ baseUrl: "http://localhost:4130", email: "agent@example.com", apiToken: "test" });
    await assert.rejects(
      () => zendesk.createTicket({ subject: "rca-1bk VC-11 live proof", comment: { body: "x", public: true } }),
      /rca-mk6n|N-2/,
    );
  } finally {
    server.close();
  }
});

test("ZendeskClient#createTicket refuses a harness-vocabulary TAG before ever making the request", async () => {
  const server = await startMockServer(4132);
  try {
    const zendesk = new ZendeskClient({ baseUrl: "http://localhost:4132", email: "agent@example.com", apiToken: "test" });
    await assert.rejects(
      () =>
        zendesk.createTicket({
          subject: "Employment verification letter request",
          comment: { body: "x", public: true },
          tags: ["uc01_test", OBSERVED_LEAKY_TAG],
        }),
      /rca-mk6n|N-2|rca-1qju/,
    );
  } finally {
    server.close();
  }
});

test("ZendeskClient#updateTicket refuses a harness-vocabulary tag via flagForReview/additional_tags too", async () => {
  const server = await startMockServer(4133);
  try {
    const zendesk = new ZendeskClient({ baseUrl: "http://localhost:4133", email: "agent@example.com", apiToken: "test" });
    // flagForReview()'s additionalTags param writes Zendesk's additional_tags
    // field — a second write surface for tags, distinct from createTicket's
    // `tags` and updateTicket's `tags`. Must be guarded too.
    await assert.rejects(
      () =>
        zendesk.flagForReview(1, {
          note: "AI summary",
          additionalTags: [OBSERVED_LEAKY_TAG],
        }),
      /rca-mk6n|N-2|rca-1qju/,
    );
  } finally {
    server.close();
  }
});

test("ZendeskClient#createTicket still creates a ticket with a clean subject and clean tags", async () => {
  const server = await startMockServer(4131);
  try {
    const zendesk = new ZendeskClient({ baseUrl: "http://localhost:4131", email: "agent@example.com", apiToken: "test" });
    const ticket = await zendesk.createTicket({
      subject: "Employment verification letter request",
      comment: { body: "x", public: true },
      tags: ["uc01_test", "queue_hr_ops"],
    });
    assert.ok(ticket?.id);
  } finally {
    server.close();
  }
});
