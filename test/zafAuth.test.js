// ---------------------------------------------------------------------------
// zafAuth.test.js — RS256 verification of a ZAF-signed identity token.
// Hermetic: an RSA keypair is generated once in-process (node:crypto), used to
// sign fixture tokens exactly the way Zendesk's real mechanism does per
// zafAuth.js's own header comment (RS256, three-part compact JWT). No network
// call is ever made — fetchZafAppPublicKey is exercised separately with an
// injected fake fetch, never the real global fetch.
// ---------------------------------------------------------------------------

import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, createSign, createHmac } from "node:crypto";

import { verifyZafToken, createZafVerifier, fetchZafAppPublicKey } from "../src/review/zafAuth.js";

const { publicKey, privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});

// A second, unrelated keypair — stands in for "an attacker's key" or "the
// wrong app's key," to prove verification is against THE CONFIGURED key,
// not just any well-formed signature.
const { publicKey: otherPublicKey, privateKey: otherPrivateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});

function b64url(input) {
  return Buffer.from(typeof input === "string" ? input : JSON.stringify(input)).toString("base64url");
}

/** Build and sign a compact JWT exactly as verifyZafToken expects to parse one. */
function signToken(claims, { key = privateKey, alg = "RS256", header = {} } = {}) {
  const headerB64 = b64url({ alg, typ: "JWT", ...header });
  const payloadB64 = b64url(claims);
  const signingInput = `${headerB64}.${payloadB64}`;
  const signer = createSign("RSA-SHA256");
  signer.update(signingInput);
  signer.end();
  const signatureB64 = signer.sign(key).toString("base64url");
  return `${signingInput}.${signatureB64}`;
}

const NOW = 1_700_000_000;
const fixedNow = () => NOW;

function validClaims(overrides = {}) {
  return {
    iss: "zendesk-app",
    aud: "review-api",
    email: "specialist@remote.example",
    iat: NOW - 10,
    exp: NOW + 300,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// A validly-signed request is accepted and its approver identity extracted.
// ---------------------------------------------------------------------------

test("verifyZafToken: a validly-signed token is accepted and its approver extracted", () => {
  const token = signToken(validClaims());
  const result = verifyZafToken(token, { publicKeyPem: publicKey, now: fixedNow });

  assert.equal(result.ok, true);
  assert.equal(result.approver, "specialist@remote.example");
  assert.equal(result.claims.iss, "zendesk-app");
});

test("verifyZafToken: issuer and audience are checked when configured", () => {
  const token = signToken(validClaims());

  const ok = verifyZafToken(token, {
    publicKeyPem: publicKey,
    issuer: "zendesk-app",
    audience: "review-api",
    now: fixedNow,
  });
  assert.equal(ok.ok, true);

  const wrongIssuer = verifyZafToken(token, { publicKeyPem: publicKey, issuer: "someone-else", now: fixedNow });
  assert.equal(wrongIssuer.ok, false);
  assert.equal(wrongIssuer.code, "issuer_mismatch");

  const wrongAudience = verifyZafToken(token, { publicKeyPem: publicKey, audience: "someone-else", now: fixedNow });
  assert.equal(wrongAudience.ok, false);
  assert.equal(wrongAudience.code, "audience_mismatch");
});

test("verifyZafToken: falls through the configured claim-path order to find an identity", () => {
  const token = signToken(validClaims({ email: undefined, sub: "agent-42@remote.example" }));
  const result = verifyZafToken(token, { publicKeyPem: publicKey, now: fixedNow });
  assert.equal(result.ok, true);
  assert.equal(result.approver, "agent-42@remote.example");
});

// ---------------------------------------------------------------------------
// A missing signature (no token at all) is rejected.
// ---------------------------------------------------------------------------

test("verifyZafToken: a missing token is rejected", () => {
  for (const missing of [null, undefined, ""]) {
    const result = verifyZafToken(missing, { publicKeyPem: publicKey, now: fixedNow });
    assert.equal(result.ok, false);
    assert.equal(result.code, "token_missing");
  }
  // Not empty, but still not a real token — rejected on a different, still-closed
  // code (it fails the three-part JWT shape check), never treated as valid.
  const whitespaceOnly = verifyZafToken("   ", { publicKeyPem: publicKey, now: fixedNow });
  assert.equal(whitespaceOnly.ok, false);
});

test("verifyZafToken: fails closed rather than skipping the check when unconfigured", () => {
  const token = signToken(validClaims());
  const result = verifyZafToken(token, { now: fixedNow }); // no publicKeyPem
  assert.equal(result.ok, false);
  assert.equal(result.code, "verifier_not_configured");
});

// ---------------------------------------------------------------------------
// A tampered/invalid signature is rejected — several distinct ways to tamper.
// ---------------------------------------------------------------------------

test("verifyZafToken: a token signed by the wrong key is rejected", () => {
  const token = signToken(validClaims(), { key: otherPrivateKey });
  const result = verifyZafToken(token, { publicKeyPem: publicKey, now: fixedNow });
  assert.equal(result.ok, false);
  assert.equal(result.code, "invalid_signature");
  // Prove the fixture itself is valid against the OTHER key, so this is really
  // testing "wrong key rejected," not "the fixture is broken."
  assert.equal(verifyZafToken(token, { publicKeyPem: otherPublicKey, now: fixedNow }).ok, true);
});

test("verifyZafToken: a payload edited after signing is rejected", () => {
  const token = signToken(validClaims());
  const [header, payload, signature] = token.split(".");
  const tamperedPayload = b64url({ ...validClaims(), email: "attacker@evil.example" });
  const tampered = `${header}.${tamperedPayload}.${signature}`;

  const result = verifyZafToken(tampered, { publicKeyPem: publicKey, now: fixedNow });
  assert.equal(result.ok, false);
  assert.equal(result.code, "invalid_signature");
});

test("verifyZafToken: a corrupted signature segment is rejected, not thrown", () => {
  const token = signToken(validClaims());
  const [header, payload] = token.split(".");
  const corrupted = `${header}.${payload}.not-a-real-signature`;

  const result = verifyZafToken(corrupted, { publicKeyPem: publicKey, now: fixedNow });
  assert.equal(result.ok, false);
  assert.equal(result.code, "invalid_signature");
});

test("verifyZafToken: malformed token shapes are rejected without throwing", () => {
  const notThreeParts = verifyZafToken("only.two", { publicKeyPem: publicKey, now: fixedNow });
  assert.equal(notThreeParts.code, "token_malformed");

  const notJson = `${b64url("not-json")}.${b64url("also-not-json")}.sig`;
  const badJson = verifyZafToken(notJson, { publicKeyPem: publicKey, now: fixedNow });
  assert.equal(badJson.code, "token_malformed");
});

// ---------------------------------------------------------------------------
// Algorithm downgrade — the classic JWT attack. Must be rejected BEFORE any
// signature check even runs, per the module's own header comment.
// ---------------------------------------------------------------------------

test("verifyZafToken: alg 'none' is rejected outright, never treated as an unsigned-but-ok token", () => {
  const headerB64 = b64url({ alg: "none", typ: "JWT" });
  const payloadB64 = b64url(validClaims());
  const noneToken = `${headerB64}.${payloadB64}.`;

  const result = verifyZafToken(noneToken, { publicKeyPem: publicKey, now: fixedNow });
  assert.equal(result.ok, false);
  assert.equal(result.code, "unsupported_algorithm");
});

test("verifyZafToken: a non-RS256 algorithm is rejected even with a well-formed signature", () => {
  const token = signToken(validClaims(), { header: { alg: "HS256" } });
  const result = verifyZafToken(token, { publicKeyPem: publicKey, now: fixedNow });
  assert.equal(result.ok, false);
  assert.equal(result.code, "unsupported_algorithm");
});

// ---------------------------------------------------------------------------
// Expiry / not-before.
// ---------------------------------------------------------------------------

test("verifyZafToken: an expired token is rejected", () => {
  const token = signToken(validClaims({ exp: NOW - 3600 }));
  const result = verifyZafToken(token, { publicKeyPem: publicKey, now: fixedNow });
  assert.equal(result.ok, false);
  assert.equal(result.code, "token_expired");
});

test("verifyZafToken: a not-yet-valid token is rejected", () => {
  const token = signToken(validClaims({ nbf: NOW + 3600 }));
  const result = verifyZafToken(token, { publicKeyPem: publicKey, now: fixedNow });
  assert.equal(result.ok, false);
  assert.equal(result.code, "token_not_yet_valid");
});

test("verifyZafToken: small clock skew within tolerance is accepted", () => {
  const token = signToken(validClaims({ exp: NOW - 5 })); // "expired" 5s ago
  const result = verifyZafToken(token, { publicKeyPem: publicKey, now: fixedNow, clockToleranceSec: 30 });
  assert.equal(result.ok, true);
});

// ---------------------------------------------------------------------------
// No identity claim present at all.
// ---------------------------------------------------------------------------

test("verifyZafToken: a validly-signed token with no recognizable identity claim is rejected", () => {
  const token = signToken({ iss: "zendesk-app", iat: NOW - 10, exp: NOW + 300 });
  const result = verifyZafToken(token, { publicKeyPem: publicKey, now: fixedNow });
  assert.equal(result.ok, false);
  assert.equal(result.code, "identity_claim_missing");
});

// ---------------------------------------------------------------------------
// createZafVerifier — the thing server.js actually holds onto.
// ---------------------------------------------------------------------------

test("createZafVerifier: .verify(token) behaves identically to calling verifyZafToken directly", () => {
  const verifier = createZafVerifier({ publicKeyPem: publicKey, now: fixedNow });
  const token = signToken(validClaims());
  const result = verifier.verify(token);
  assert.equal(result.ok, true);
  assert.equal(result.approver, "specialist@remote.example");

  const bad = verifier.verify("garbage");
  assert.equal(bad.ok, false);
});

// ---------------------------------------------------------------------------
// fetchZafAppPublicKey — the one real-network function in this module. Only
// ever driven here with an injected fake fetch; the global fetch is never
// touched, keeping this test (and `npm test`) fully hermetic.
// ---------------------------------------------------------------------------

test("fetchZafAppPublicKey: builds the documented URL and Basic-auth header, and returns the PEM body", async () => {
  let capturedUrl, capturedHeaders;
  const fakeFetch = async (url, options) => {
    capturedUrl = url;
    capturedHeaders = options.headers;
    return { ok: true, text: async () => publicKey };
  };

  const pem = await fetchZafAppPublicKey({
    subdomain: "your-subdomain",
    appId: "12345",
    email: "agent@example.com",
    apiToken: "test-token",
    fetchImpl: fakeFetch,
  });

  assert.equal(pem, publicKey);
  assert.equal(capturedUrl, "https://your-subdomain.zendesk.com/api/v2/apps/12345/public_key.pem");
  const expectedAuth = "Basic " + Buffer.from("agent@example.com/token:test-token").toString("base64");
  assert.equal(capturedHeaders.Authorization, expectedAuth);
});

test("fetchZafAppPublicKey: a non-ok response is surfaced as an error, not a silent empty key", async () => {
  const fakeFetch = async () => ({ ok: false, status: 404, text: async () => "" });
  await assert.rejects(
    fetchZafAppPublicKey({ subdomain: "x", appId: "1", email: "a@b.com", apiToken: "t", fetchImpl: fakeFetch }),
    /404/
  );
});

// ---------------------------------------------------------------------------
// HS256 — the mechanism zaf-app/ ACTUALLY uses.
// ---------------------------------------------------------------------------
// zaf-app/ is a client-side app: a static bundle Zendesk hosts. It signs each
// approve/deny through client.request()'s `jwt` block, and ZAF signs those
// HS256 only. Everything above this line verifies the OTHER mechanism (RS256,
// a server-side app's Zendesk-signed request) — which is real, and was the only
// one this module supported, and could never accept a single token the shipped
// sidebar sends. These tests exist so that can't silently be true again.
// ---------------------------------------------------------------------------

const SHARED_SECRET = "s3cret-shared-with-the-zaf-secure-setting";
const OTHER_SECRET = "a-different-secret-entirely";

/** Sign a compact JWT the way ZAF does: HMAC-SHA256 over header.payload. */
function signHs256(claims, { secret = SHARED_SECRET, alg = "HS256", header = {} } = {}) {
  const headerB64 = b64url({ alg, typ: "JWT", ...header });
  const payloadB64 = b64url(claims);
  const signingInput = `${headerB64}.${payloadB64}`;
  const signature = createHmac("sha256", secret).update(signingInput).digest("base64url");
  return `${signingInput}.${signature}`;
}

test("HS256: a token signed with the configured shared secret is accepted", () => {
  const result = verifyZafToken(signHs256(validClaims()), { sharedSecret: SHARED_SECRET, now: fixedNow });
  assert.equal(result.ok, true);
  assert.equal(result.approver, "specialist@remote.example");
  assert.equal(result.algorithm, "HS256");
});

test("HS256: a token signed with the WRONG secret is rejected", () => {
  const token = signHs256(validClaims(), { secret: OTHER_SECRET });
  const result = verifyZafToken(token, { sharedSecret: SHARED_SECRET, now: fixedNow });
  assert.equal(result.ok, false);
  assert.equal(result.code, "invalid_signature");
  // Prove the fixture is a genuinely valid token against its own secret, so
  // this is "wrong secret rejected", not "the fixture is broken".
  assert.equal(verifyZafToken(token, { sharedSecret: OTHER_SECRET, now: fixedNow }).ok, true);
});

test("HS256: a payload edited after signing is rejected", () => {
  const token = signHs256(validClaims());
  const [h, , s] = token.split(".");
  const forged = [h, b64url(validClaims({ email: "attacker@evil.test" })), s].join(".");
  const result = verifyZafToken(forged, { sharedSecret: SHARED_SECRET, now: fixedNow });
  assert.equal(result.ok, false);
  assert.equal(result.code, "invalid_signature");
});

test("HS256: a truncated signature is rejected, not thrown", () => {
  // timingSafeEqual THROWS on a length mismatch rather than returning false, so
  // the length has to be compared first — otherwise a one-character truncation
  // is a 500 instead of a 401.
  const token = signHs256(validClaims());
  const [h, p, s] = token.split(".");
  const result = verifyZafToken([h, p, s.slice(0, 10)].join("."), { sharedSecret: SHARED_SECRET, now: fixedNow });
  assert.equal(result.ok, false);
  assert.equal(result.code, "invalid_signature");
});

test("HS256: alg 'none' is rejected outright", () => {
  const headerB64 = b64url({ alg: "none", typ: "JWT" });
  const token = `${headerB64}.${b64url(validClaims())}.`;
  const result = verifyZafToken(token, { sharedSecret: SHARED_SECRET, now: fixedNow });
  assert.equal(result.ok, false);
  assert.equal(result.code, "unsupported_algorithm");
});

test("HS256: an expired token is rejected", () => {
  const token = signHs256(validClaims({ exp: NOW - 3600 }));
  const result = verifyZafToken(token, { sharedSecret: SHARED_SECRET, now: fixedNow });
  assert.equal(result.ok, false);
  assert.equal(result.code, "token_expired");
});

test("HS256: a token issued in the future is rejected", () => {
  const token = signHs256(validClaims({ iat: NOW + 3600, exp: NOW + 7200 }));
  const result = verifyZafToken(token, { sharedSecret: SHARED_SECRET, now: fixedNow });
  assert.equal(result.ok, false);
  assert.equal(result.code, "token_issued_in_future");
});

test("HS256: a validly-signed token with no resolvable identity claim fails CLOSED", () => {
  // The claims are supplied by app JavaScript, so a signature says nothing about
  // whether an identity is present. A token that verifies but names nobody must
  // refuse rather than fall through to a header or an empty approver.
  const token = signHs256({ iat: NOW - 10, exp: NOW + 300, ticket: "12345" });
  const result = verifyZafToken(token, { sharedSecret: SHARED_SECRET, now: fixedNow });
  assert.equal(result.ok, false);
  assert.equal(result.code, "identity_claim_missing");
  assert.equal(result.approver, undefined);
});

// ---------------------------------------------------------------------------
// THE ALGORITHM COMES FROM CONFIGURATION, NEVER FROM THE TOKEN.
// This is the classic JWT confusion attack: a verifier that reads header.alg
// and then picks a key can be handed an HS256 token signed with the RSA PUBLIC
// key — public data — and will accept it. Each verifier here is bound to one
// algorithm by which secret it was given, so there is no input that steers it.
// ---------------------------------------------------------------------------

test("an RS256 token is rejected by an HS256-configured verifier", () => {
  const token = signToken(validClaims()); // genuinely valid RS256
  const result = verifyZafToken(token, { sharedSecret: SHARED_SECRET, now: fixedNow });
  assert.equal(result.ok, false);
  assert.equal(result.code, "unsupported_algorithm");
  assert.equal(verifyZafToken(token, { publicKeyPem: publicKey, now: fixedNow }).ok, true);
});

test("an HS256 token is rejected by an RS256-configured verifier", () => {
  const token = signHs256(validClaims()); // genuinely valid HS256
  const result = verifyZafToken(token, { publicKeyPem: publicKey, now: fixedNow });
  assert.equal(result.ok, false);
  assert.equal(result.code, "unsupported_algorithm");
  assert.equal(verifyZafToken(token, { sharedSecret: SHARED_SECRET, now: fixedNow }).ok, true);
});

test("the algorithm-confusion attack: an HS256 token signed with the RSA PUBLIC key is refused", () => {
  // The attack in full: the public key is not a secret, so anyone can HMAC with
  // it. A verifier that trusted header.alg would treat this as validly signed.
  const token = signHs256(validClaims({ email: "attacker@evil.test" }), { secret: publicKey });
  const result = verifyZafToken(token, { publicKeyPem: publicKey, now: fixedNow });
  assert.equal(result.ok, false);
  assert.equal(result.code, "unsupported_algorithm");
});

test("configuring BOTH a public key and a shared secret is refused, not silently resolved", () => {
  // They belong to different Zendesk app types. Both present means nobody knows
  // which app this deployment serves, and picking one would leave the operator
  // believing the other is what is enforcing their approvals.
  const result = verifyZafToken(signHs256(validClaims()), {
    publicKeyPem: publicKey,
    sharedSecret: SHARED_SECRET,
    now: fixedNow,
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, "ambiguous_verifier_configuration");

  const rsaToken = signToken(validClaims());
  assert.equal(
    verifyZafToken(rsaToken, { publicKeyPem: publicKey, sharedSecret: SHARED_SECRET, now: fixedNow }).code,
    "ambiguous_verifier_configuration",
    "neither algorithm may be reachable from an ambiguous configuration"
  );
});

test("createZafVerifier reports which algorithm it is bound to, without a request in hand", () => {
  assert.equal(createZafVerifier({ sharedSecret: SHARED_SECRET }).algorithm, "HS256");
  assert.equal(createZafVerifier({ publicKeyPem: publicKey }).algorithm, "RS256");
  assert.equal(createZafVerifier({}).algorithm, null);
  assert.equal(createZafVerifier({ publicKeyPem: publicKey, sharedSecret: SHARED_SECRET }).algorithm, null);
});

test("createZafVerifier(HS256): .verify() accepts a real ZAF-shaped token end to end", () => {
  const verifier = createZafVerifier({ sharedSecret: SHARED_SECRET, now: fixedNow });
  // The exact claim shape zaf-app/assets/main.js puts in its `jwt.claims`.
  const token = signHs256({
    email: "specialist@remote.example",
    name: "A Specialist",
    zafUserId: "42",
    iat: NOW - 5,
    exp: NOW + 55,
  });
  const result = verifier.verify(token);
  assert.equal(result.ok, true);
  assert.equal(result.approver, "specialist@remote.example");
});
