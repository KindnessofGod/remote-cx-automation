// ---------------------------------------------------------------------------
// healthZendeskAccount.test.js — the health block must name the ACCOUNT
// ---------------------------------------------------------------------------
// `posture.zendeskConfigured` is a boolean, and a boolean cannot distinguish a
// correctly-configured deployment from one still pointed at a RETIRED Zendesk
// account. On 2026-08-29 the account moved `your-subdomain` -> `your-subdomainhelp`,
// and the only way to tell from outside which one the deployment was talking to
// was to read `portal.employmentIdField.id` and infer the account from it —
// using a field id as a proxy for an account identity.
//
// That is the same shape of mistake as honest-gaps item 21, where "the variable
// is set" was repeatedly mistaken for "the variable is right". A deployment
// should be able to say which account it is on.
//
// The two properties pinned here are the ones a future edit could quietly
// break: the subdomain is reported when Zendesk is configured, and it is NOT
// reported (null, never a stale leftover) when it is not. The second matters
// because reporting a subdomain from an unconfigured deployment would assert an
// integration that does not exist.
// ---------------------------------------------------------------------------

import { test } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const SRC = readFileSync(new URL("../deploy/cx-apis/deps.js", import.meta.url), "utf8");

test("the posture block reports the Zendesk subdomain, not merely a boolean", () => {
  assert.match(
    SRC,
    /zendeskSubdomain:/,
    "posture no longer names the Zendesk account — a boolean cannot tell a live account from a retired one"
  );
});

test("the subdomain is gated on Zendesk actually being configured", () => {
  // It must not report a subdomain that is sitting in the environment while no
  // usable credentials exist: that would claim an integration this deployment
  // does not have.
  const line = SRC.split("\n").find((l) => l.includes("zendeskSubdomain:"));
  assert.ok(line, "zendeskSubdomain line not found");
  assert.match(line, /isZendeskConfigured\(\)/, "the subdomain is reported without checking configuration");
  assert.match(line, /null/, "there is no null branch — an unconfigured deployment would name an account");
});

test("no CREDENTIAL is widened from a boolean to a value alongside it", () => {
  // The reason naming the subdomain is safe is that a subdomain is public: it
  // is in every ticket URL, the ZAF app's origin and every sidebar CORS header.
  // That argument does NOT extend to the client id, secret or token, so this
  // pins that they stay booleans.
  for (const forbidden of [
    /zendeskClientSecret:\s*config/,
    /zendeskClientId:\s*config/,
    /zendeskApiToken:\s*config/,
  ]) {
    assert.doesNotMatch(SRC, forbidden, "a Zendesk credential VALUE is now reported in the health block");
  }
});
