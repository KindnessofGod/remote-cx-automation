// ---------------------------------------------------------------------------
// zafVerifierFromEnv.test.js — which verifier an environment describes
// ---------------------------------------------------------------------------
// The bug this guards against is not a wrong signature check; it is a
// deployment that builds the WRONG KIND of verifier and then looks fine. The
// sidebar signs HS256 (client-side ZAF app); the RS256 path beside it belongs
// to a server-side app this repo does not ship. A deployment that built the
// RS256 verifier would refuse every real approval with `unsupported_algorithm`
// — which reads like a bug in the app rather than a configuration mistake.
//
// Hermetic: no network, no process.env mutation (the env is injected).
// ---------------------------------------------------------------------------

import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, createHmac } from "node:crypto";

import { buildZafVerifierFromEnv, normalizePemFromEnv } from "../src/shared/zafVerifierFromEnv.js";

const { publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});

const b64url = (input) => Buffer.from(typeof input === "string" ? input : JSON.stringify(input)).toString("base64url");

function signHs256(claims, secret) {
  const head = b64url({ alg: "HS256", typ: "JWT" });
  const payload = b64url(claims);
  const sig = createHmac("sha256", secret).update(`${head}.${payload}`).digest("base64url");
  return `${head}.${payload}.${sig}`;
}

/** These functions log their choice on purpose; the test just doesn't print it. */
async function quietly(fn) {
  const log = console.log;
  const error = console.error;
  const lines = [];
  console.log = (...a) => lines.push(a.join(" "));
  console.error = (...a) => lines.push(a.join(" "));
  try {
    return { value: await fn(), lines };
  } finally {
    console.log = log;
    console.error = error;
  }
}

test("ZAF_SHARED_SECRET builds an HS256 verifier that accepts a real ZAF-shaped token", async () => {
  const { value: verifier } = await quietly(() =>
    buildZafVerifierFromEnv("test", { ZAF_SHARED_SECRET: "shared-secret-value" })
  );
  assert.ok(verifier, "a shared secret must produce a verifier");
  assert.equal(verifier.algorithm, "HS256");

  const nowSec = Math.floor(Date.now() / 1000);
  const verdict = verifier.verify(
    signHs256({ email: "specialist@remote.example", iat: nowSec - 5, exp: nowSec + 55 }, "shared-secret-value")
  );
  assert.equal(verdict.ok, true);
  assert.equal(verdict.approver, "specialist@remote.example");
});

test("a shared secret that is only whitespace is not a secret", async () => {
  const { value } = await quietly(() => buildZafVerifierFromEnv("test", { ZAF_SHARED_SECRET: "   " }));
  assert.equal(value, null);
});

test("ZAF_APP_PUBLIC_KEY_PEM alone still builds the RS256 verifier (a server-side app)", async () => {
  const { value: verifier } = await quietly(() =>
    buildZafVerifierFromEnv("test", { ZAF_APP_PUBLIC_KEY_PEM: publicKey })
  );
  assert.ok(verifier);
  assert.equal(verifier.algorithm, "RS256");
});

test("configuring BOTH mechanisms builds nothing, and says which two variables collided", async () => {
  // Fail-closed: a null verifier means every approve/deny is refused with
  // signed_identity_not_configured, which is recoverable in a minute. Silently
  // picking one would leave the operator believing the other is in force.
  const { value, lines } = await quietly(() =>
    buildZafVerifierFromEnv("test", { ZAF_SHARED_SECRET: "s", ZAF_APP_PUBLIC_KEY_PEM: publicKey })
  );
  assert.equal(value, null);
  const said = lines.join("\n");
  assert.match(said, /ZAF_SHARED_SECRET/);
  assert.match(said, /ZAF_APP_PUBLIC_KEY_PEM/);
});

test("ZAF_SHARED_SECRET alongside ZAF_APP_ID is the same collision — the live-fetch path is still RS256", async () => {
  const { value, lines } = await quietly(() =>
    buildZafVerifierFromEnv("test", { ZAF_SHARED_SECRET: "s", ZAF_APP_ID: "12345" })
  );
  assert.equal(value, null, "must not fall through to a live public-key fetch");
  assert.match(lines.join("\n"), /ZAF_APP_ID/);
});

test("nothing configured returns null rather than throwing", async () => {
  const { value } = await quietly(() => buildZafVerifierFromEnv("test", {}));
  assert.equal(value, null);
});

test("normalizePemFromEnv still expands a literal \\n PEM, and leaves a real one alone", () => {
  assert.equal(normalizePemFromEnv("a\\nb"), "a\nb");
  assert.equal(normalizePemFromEnv("a\nb"), "a\nb");
  assert.equal(normalizePemFromEnv(""), null);
});
