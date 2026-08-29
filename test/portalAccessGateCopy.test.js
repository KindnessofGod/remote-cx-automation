// ---------------------------------------------------------------------------
// portalAccessGateCopy.test.js  —  the access gate reads like a message to a
// person using the page, not a message to whoever deployed it
// ---------------------------------------------------------------------------
// R7-43 / D-08 (qa/evidence/UC-01/2026-08-23-uc01-e2e-7/OPEN-DEFECTS.md): the
// portal's access gate stands between an employee and their letter, and the
// refusal an employee actually reads quoted the system's own implementation
// vocabulary back at them — "a durable store is attached", "this repo's real
// gates", "an audit row and a use-case record", "ask whoever deployed this".
// The posture reasoning in src/portal/access.js is sound; it just should not
// be printed at the reader.
//
// This guards the OBSERVABLE OUTPUT — the exact body checkPortalAccess()
// returns, which src/portal/server.js sends verbatim and src/portal/assets/
// app.js's showAccessGate() renders verbatim (payload.reason / payload.why /
// payload.howToFix, in the server's own words) — not the source text of the
// fix. A future edit that reintroduces the jargon under different code would
// still fail this.
//
// HERMETIC. checkPortalAccess() is a pure function; no network, no store.
// ---------------------------------------------------------------------------

import { test } from "node:test";
import assert from "node:assert/strict";

import { checkPortalAccess, portalAccessPosture, PORTAL_KEY_HEADER, PORTAL_KEY_ENV } from "../src/portal/access.js";

const KEY = "s3cret-portal-key-value";

/** Every phrase R7-43 quoted verbatim from the pre-fix employee-facing copy. */
const DEVELOPER_JARGON = [
  "durable store",
  "outlive the process",
  "this repo's real gates",
  "audit row and a use-case record",
  "audit_log",
  "ask whoever deployed this",
  "anonymous caller",
];

function allCopy(body) {
  return [body.reason, body.why, ...(body.howToFix || [])].join(" \n ");
}

function assertNoJargon(body, label) {
  const text = allCopy(body);
  for (const phrase of DEVELOPER_JARGON) {
    assert.ok(!text.includes(phrase), `${label}: still contains developer jargon "${phrase}" — text was: ${text}`);
  }
}

// ---------------------------------------------------------------------------
// portal_access_key_not_configured — an operator's deploy is missing the key,
// but the reader landing on this screen may be the employee it left exposed.
// ---------------------------------------------------------------------------

test("not-configured refusal: no developer jargon, and tells the reader who to contact", () => {
  const posture = portalAccessPosture({ VERCEL: "1" }, { persistent: false }); // no PORTAL_ACCESS_KEY set
  const verdict = checkPortalAccess({ headers: {} }, posture);

  assert.equal(verdict.status, 401);
  assert.equal(verdict.body.code, "portal_access_key_not_configured");
  assertNoJargon(verdict.body, "not-configured");

  // Still practically useful to whoever it reaches: names what to set, so an
  // employee can forward it to IT/HR verbatim and it still resolves the gap.
  assert.ok(verdict.body.howToFix.join(" ").includes(PORTAL_KEY_ENV));
  assert.match(verdict.body.howToFix.join(" "), /HR|IT/, "should point the reader at a human contact, not a config file");
  // Reassures the reader their own request wasn't the problem.
  assert.match(allCopy(verdict.body), /nothing is wrong/i);
});

// ---------------------------------------------------------------------------
// portal_access_key_required — the ordinary case: an employee opens the
// portal and has not entered the code yet. This is the screen R7-43 named.
// ---------------------------------------------------------------------------

test("key-required refusal: no developer jargon, no header/script instructions, just 'enter it' / 'ask'", () => {
  const posture = portalAccessPosture({ VERCEL: "1", [PORTAL_KEY_ENV]: KEY }, { persistent: false });
  const verdict = checkPortalAccess({ headers: {} }, posture);

  assert.equal(verdict.status, 401);
  assert.equal(verdict.body.code, "portal_access_key_required");
  assertNoJargon(verdict.body, "key-required");

  const text = allCopy(verdict.body);
  // No instruction assuming the reader is calling the API directly.
  assert.ok(!text.includes(PORTAL_KEY_HEADER), `should not mention the raw header name to an ordinary reader: ${text}`);
  assert.ok(!text.includes("script"), `should not read like developer/API instructions: ${text}`);
  // Practical, plain-language guidance still present.
  assert.match(text, /enter/i);
  assert.match(text, /HR|IT/, "should point a reader without a code at a human contact");
});

// ---------------------------------------------------------------------------
// portal_access_key_invalid — a wrong code was typed in.
// ---------------------------------------------------------------------------

test("invalid-key refusal: no developer jargon, plain explanation of why nothing leaks back", () => {
  const posture = portalAccessPosture({ VERCEL: "1", [PORTAL_KEY_ENV]: KEY }, { persistent: false });
  const verdict = checkPortalAccess({ headers: { [PORTAL_KEY_HEADER]: "not-the-key" } }, posture);

  assert.equal(verdict.status, 401);
  assert.equal(verdict.body.code, "portal_access_key_invalid");
  assertNoJargon(verdict.body, "invalid-key");
  assert.ok(!allCopy(verdict.body).includes(KEY), "the real key must never appear in the refusal");
});

// ---------------------------------------------------------------------------
// The positive path is unaffected by the copy rewrite.
// ---------------------------------------------------------------------------

test("the correct key still passes, unaffected by the copy change", () => {
  const posture = portalAccessPosture({ VERCEL: "1", [PORTAL_KEY_ENV]: KEY }, { persistent: false });
  const verdict = checkPortalAccess({ headers: { [PORTAL_KEY_HEADER]: KEY } }, posture);
  assert.deepEqual(verdict, { ok: true });
});
