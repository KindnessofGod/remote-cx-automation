// ---------------------------------------------------------------------------
// approverAuth.test.js  —  who a service is willing to believe, and when
// ---------------------------------------------------------------------------
// Finding F-20 stayed open for a while in a shape worth remembering: the
// mechanism for verified approver identity was BUILT, tested, and wired into
// all four approval APIs — and still had no effect anywhere, because it was
// off unless someone set an environment variable. "The secure path exists" is
// not the same claim as "the secure path is what runs."
//
// So these tests are about the DEFAULT, not the mechanism. The mechanism's own
// behaviour (RS256 verification, no silent downgrade) is covered by
// zafAuth.test.js and each server's suite.
// ---------------------------------------------------------------------------

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  resolveApprover,
  signedIdentityRequired,
  extractSignedToken,
  APPROVER_HEADER,
} from "../src/shared/approverAuth.js";

test("F-20: with a durable store attached and nothing configured, signed identity is REQUIRED", () => {
  assert.equal(
    signedIdentityRequired({}, { persistent: true }),
    true,
    "an unconfigured deployment must not fall back to trusting the request body"
  );
});

test("F-20: a seeded in-memory demo keeps the header posture, so a fresh clone still runs", () => {
  assert.equal(signedIdentityRequired({}, { persistent: false }), false);
});

test("F-20: the strict default is what an embedder inherits when it says nothing at all", () => {
  // A caller that passes no options is not describing a demo — it is a service
  // embedding these handlers, and it gets the strict posture.
  assert.equal(signedIdentityRequired({}), true);
});

test("F-20: both overrides are explicit, and the strict one wins when both are set", () => {
  assert.equal(signedIdentityRequired({ ZAF_ALLOW_UNSIGNED_IDENTITY: "true" }, { persistent: true }), false,
    "weakening a deployment takes a deliberate, greppable opt-out");
  assert.equal(signedIdentityRequired({ ZAF_REQUIRE_SIGNED_IDENTITY: "true" }, { persistent: false }), true,
    "a demo may opt IN to strictness");
  assert.equal(
    signedIdentityRequired(
      { ZAF_REQUIRE_SIGNED_IDENTITY: "true", ZAF_ALLOW_UNSIGNED_IDENTITY: "true" },
      { persistent: false }
    ),
    true,
    "contradictory configuration must resolve toward the safer reading, never the weaker one"
  );
});

test("F-20: only the literal string \"true\" weakens it — no truthiness, no near-misses", () => {
  for (const value of ["1", "yes", "TRUE", "True", " true", ""]) {
    assert.equal(
      signedIdentityRequired({ ZAF_ALLOW_UNSIGNED_IDENTITY: value }, { persistent: true }),
      true,
      `ZAF_ALLOW_UNSIGNED_IDENTITY=${JSON.stringify(value)} must not disable signed identity`
    );
  }
});

test("F-20: in strict mode a spoofed header and body are not read at all", () => {
  // The original defect: a curl with {"approver":"nobody@evil.test"} executed a
  // real work-authorization write and put that string in the audit log as the
  // authorizing human. In strict mode with no token, the request is refused
  // rather than attributed to anyone.
  const req = { headers: { [APPROVER_HEADER]: "nobody@evil.test" } };
  const verdict = resolveApprover({
    req,
    body: { approver: "also-nobody@evil.test" },
    requireSignedIdentity: true,
  });

  assert.equal(verdict.ok, false);
  assert.equal(verdict.status, 401);
  assert.equal(verdict.code, "signed_identity_required");
  assert.equal(verdict.approver, undefined, "a refused request must not carry an identity forward");
});

test("F-20: a valid signature can never be paired with a spoofed display name", () => {
  // Precedence matters here more than it looks: if the header were consulted
  // alongside the token, an attacker with any valid token could act under
  // someone else's name and the audit log would name the wrong human.
  const req = { headers: { [APPROVER_HEADER]: "nobody@evil.test", "x-zaf-token": "tok" } };
  const zafVerifier = { verify: () => ({ ok: true, approver: "real.specialist@remote.com" }) };

  const verdict = resolveApprover({
    req,
    body: { approver: "nobody@evil.test" },
    requireSignedIdentity: true,
    zafVerifier,
  });

  assert.equal(verdict.ok, true);
  assert.equal(verdict.approver, "real.specialist@remote.com");
  assert.equal(verdict.verified, true);
});

test("F-20: an unverified resolution is always labelled unverified", () => {
  // The demo posture is allowed to exist; what it is not allowed to do is look
  // like the verified one downstream.
  const verdict = resolveApprover({
    req: { headers: { [APPROVER_HEADER]: "demo.agent@example.com" } },
    requireSignedIdentity: false,
  });
  assert.equal(verdict.ok, true);
  assert.equal(verdict.approver, "demo.agent@example.com");
  assert.equal(verdict.verified, false, "nothing that came from a header may claim to be verified");
});

// ---------------------------------------------------------------------------
// WHERE THE TOKEN IS READ FROM — the half that made the whole mechanism inert.
// ---------------------------------------------------------------------------
// The sidebar is a client-side ZAF app: it signs through client.request()'s
// `jwt` block and forwards the result as `Authorization: Bearer {{jwt.token}}`,
// which is the shape Zendesk's own docs use. A server that only read
// X-ZAF-Token would 401 every real approval while every unit test of the
// verifier passed. Both headers are accepted; X-ZAF-Token stays because it is
// unambiguous and is what a hand-rolled integration would reach for.
// ---------------------------------------------------------------------------

test("the signed token is read from `Authorization: Bearer`, which is what the sidebar sends", () => {
  const verdict = resolveApprover({
    req: { headers: { authorization: "Bearer signed.jwt.value" } },
    requireSignedIdentity: true,
    zafVerifier: {
      verify: (token) => {
        assert.equal(token, "signed.jwt.value", "the bearer value must arrive without its scheme");
        return { ok: true, approver: "real.specialist@remote.com" };
      },
    },
  });
  assert.equal(verdict.ok, true);
  assert.equal(verdict.approver, "real.specialist@remote.com");
  assert.equal(verdict.verified, true);
});

test("the scheme is matched case-insensitively, as HTTP requires", () => {
  const verdict = resolveApprover({
    req: { headers: { authorization: "bearer tok" } },
    requireSignedIdentity: true,
    zafVerifier: { verify: () => ({ ok: true, approver: "a@b.test" }) },
  });
  assert.equal(verdict.ok, true);
});

test("X-ZAF-Token wins over Authorization when both are present", () => {
  const seen = [];
  const verdict = resolveApprover({
    req: { headers: { "x-zaf-token": "explicit", authorization: "Bearer other" } },
    requireSignedIdentity: true,
    zafVerifier: {
      verify: (token) => {
        seen.push(token);
        return { ok: true, approver: "a@b.test" };
      },
    },
  });
  assert.equal(verdict.ok, true);
  assert.deepEqual(seen, ["explicit"], "only the unambiguous header is consulted when it is present");
});

test("a non-Bearer Authorization header is NOT fed to the JWT verifier", () => {
  // Basic is somebody else's auth scheme. Handing its base64 blob to a token
  // verifier would be a category error, and the refusal must be the same
  // "no token was supplied" one rather than an obscure parse failure.
  let called = false;
  const verdict = resolveApprover({
    req: { headers: { authorization: "Basic YWdlbnQ6cGFzcw==" } },
    requireSignedIdentity: true,
    zafVerifier: { verify: () => ((called = true), { ok: true, approver: "nobody@evil.test" }) },
  });
  assert.equal(called, false);
  assert.equal(verdict.ok, false);
  assert.equal(verdict.code, "signed_identity_required");
});

test("a 401 for a missing token names the missing VERIFIER too, when that is also true", () => {
  // TWO FACTS, TWO DIFFERENT AFTERNOONS OF WORK.
  //
  // "you sent no token" is fixed by re-uploading the ZAF bundle. "this service
  // has no verifier" is fixed by setting ZAF_SHARED_SECRET on the server. The
  // no-token branch runs first (deliberately — the CODE has to stay
  // `signed_identity_required` so §3.51's sender-side diagnosis keeps working),
  // and it was throwing away the second fact, which it holds right there in
  // `zafVerifier`.
  const noTokenNoVerifier = resolveApprover({
    req: { headers: {} },
    requireSignedIdentity: true,
    zafVerifier: null,
  });
  assert.equal(noTokenNoVerifier.code, "signed_identity_required", "the slug must not change");
  assert.match(noTokenNoVerifier.reason, /no verifier configured/);
  assert.match(noTokenNoVerifier.reason, /ZAF_SHARED_SECRET/);

  // And it must NOT be said when it is not true — a verifier IS configured
  // here, so the only problem is the missing token and saying anything else
  // would send the reader to change a setting that is already right.
  const noTokenButVerifier = resolveApprover({
    req: { headers: {} },
    requireSignedIdentity: true,
    zafVerifier: { verify: () => ({ ok: true, approver: "someone" }) },
  });
  assert.equal(noTokenButVerifier.code, "signed_identity_required");
  assert.doesNotMatch(noTokenButVerifier.reason, /no verifier configured/);
});

test("extractSignedToken is the one place that answers 'where is the token'", () => {
  assert.equal(extractSignedToken({ "x-zaf-token": " tok " }), "tok");
  assert.equal(extractSignedToken({ authorization: "Bearer  tok" }), "tok");
  assert.equal(extractSignedToken({ authorization: "Bearer" }), null);
  assert.equal(extractSignedToken({ authorization: "Bearer a b" }), null, "a token has no spaces in it");
  assert.equal(extractSignedToken({}), null);
  assert.equal(extractSignedToken(), null);
});
