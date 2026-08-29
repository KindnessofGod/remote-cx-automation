// ---------------------------------------------------------------------------
// zafVerifierFromEnv.js  —  Building the signed-identity verifier from config
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
// This logic lived inside src/review/cli.js, which was fine while exactly one
// service could verify a signed identity. Finding F-20 gave the same
// capability to uc04/uc05/uc06/uc09, and five copies of "how do I find the ZAF
// public key" is five things to keep in step — so it moved here, beside
// approverAuth.js, which is the other half of the same mechanism.
//
// Never throws. A null return means "no verifier could be configured", and
// every server already fails CLOSED on a null verifier when signed identity is
// required (401 signed_identity_not_configured). Finding a key is this
// module's job; guaranteeing one exists is not.
//
// ---------------------------------------------------------------------------
// TWO MECHANISMS, AND WHICH ONE A DEPLOYMENT ACTUALLY NEEDS
// ---------------------------------------------------------------------------
// src/review/zafAuth.js's header has the full account. In one line each:
//
//   ZAF_SHARED_SECRET       HS256. What zaf-app/ — a CLIENT-SIDE app, a static
//                           bundle Zendesk hosts — signs with, via the `jwt`
//                           block of client.request(). THIS IS THE ONE THIS
//                           REPO'S SIDEBAR USES. The same value goes into the
//                           app's secure setting `cxSharedSecret`, which is
//                           where it is stored on Zendesk's side; it never
//                           reaches the browser.
//   ZAF_APP_PUBLIC_KEY_PEM  RS256. For a SERVER-SIDE app, where Zendesk signs
//                           a request it makes to us. This repo ships no such
//                           app today.
//   ZAF_APP_ID              the same RS256 key, fetched live instead of pasted.
//
// PRECEDENCE: THERE ISN'T ONE, ON PURPOSE.
// The obvious design is "HS256 wins, since that's the app we ship." It is
// rejected, because the failure it produces is silent and misleading: an
// operator who pasted a PEM would see every approve/deny work and reasonably
// believe the PEM is what is enforcing them, when it is inert. The reverse
// ordering is worse still — it would enforce a mechanism the sidebar cannot
// satisfy, so every real approval 401s with `unsupported_algorithm`, which
// reads like a bug in the app rather than a configuration mistake.
//
// So both-configured returns null with a loud, specific error line naming both
// variables. The cost is that a deployment in that state refuses every
// approve/deny — recoverable in a minute by unsetting one variable, and it is
// the same posture this file already takes for "no key at all", which the
// project chose deliberately over degrading to trusting a header.
// (zafAuth.js refuses the same combination one layer down, so even a verifier
// built by hand with both cannot resolve the ambiguity by accident.)
// ---------------------------------------------------------------------------

import { createZafVerifier, fetchZafAppPublicKey } from "../review/zafAuth.js";
import { config } from "./config.js";

/**
 * Support the common "PEM crammed onto one .env line with literal \n" shape.
 * dotenv itself expands `\n` inside DOUBLE-quoted values to real newlines, so
 * a correctly double-quoted PEM already works with no help — this is only a
 * safety net for a value pasted unquoted or single-quoted, where dotenv
 * leaves the literal two-character sequence `\n` in place.
 */
export function normalizePemFromEnv(raw) {
  if (!raw) return null;
  return raw.includes("\\n") ? raw.replace(/\\n/g, "\n") : raw;
}

/**
 * Build whichever verifier this environment describes, or null.
 *
 * @param {string} [label]  service name, for the startup log line
 * @param {NodeJS.ProcessEnv} [env]  injectable so the choice is testable without
 *   mutating process.env — the precedence rule above is the whole point of this
 *   function, and a rule that can only be exercised by editing the real
 *   environment is a rule nothing tests.
 * @returns {Promise<{verify: Function, algorithm: string|null}|null>}
 */
export async function buildZafVerifierFromEnv(label = "API", env = process.env) {
  const issuer = env.ZAF_JWT_ISSUER || undefined;
  const audience = env.ZAF_JWT_AUDIENCE || undefined;

  const sharedSecret = (env.ZAF_SHARED_SECRET || "").trim() || null;
  const staticPem = normalizePemFromEnv(env.ZAF_APP_PUBLIC_KEY_PEM);
  const appId = env.ZAF_APP_ID;

  if (sharedSecret && (staticPem || appId)) {
    console.error(
      `⚠ [${label}] ZAF verifier NOT built: ZAF_SHARED_SECRET (HS256, client-side app) is set ` +
        `alongside ${staticPem ? "ZAF_APP_PUBLIC_KEY_PEM" : "ZAF_APP_ID"} (RS256, server-side app). ` +
        `These belong to different app types — unset whichever one this deployment does not serve. ` +
        `Until then every approve/deny is refused (401 signed_identity_not_configured).`
    );
    return null;
  }

  if (sharedSecret) {
    // The mechanism zaf-app/ actually uses. No network call, and no way for
    // the secret to reach a browser: Zendesk holds it as a secure setting and
    // signs on the app's behalf.
    console.log(`▶ [${label}] ZAF signed-identity verifier: HS256, shared secret from ZAF_SHARED_SECRET`);
    return createZafVerifier({ sharedSecret, issuer, audience });
  }

  if (staticPem) {
    console.log(`▶ [${label}] ZAF signed-identity verifier: RS256, public key from ZAF_APP_PUBLIC_KEY_PEM`);
    return createZafVerifier({ publicKeyPem: staticPem, issuer, audience });
  }

  // The same RS256 key, fetched live rather than pasted. Basic auth means this
  // only works on accounts still using the legacy Zendesk email/API-token pair
  // — the OAuth client_credentials path has no such pair to send.
  if (appId && config.zendesk.subdomain && config.zendesk.email && config.zendesk.apiToken) {
    try {
      const publicKeyPem = await fetchZafAppPublicKey({
        subdomain: config.zendesk.subdomain,
        appId,
        email: config.zendesk.email,
        apiToken: config.zendesk.apiToken,
      });
      console.log(`▶ [${label}] ZAF signed-identity verifier: RS256, public key fetched live for app ${appId}`);
      return createZafVerifier({ publicKeyPem, issuer, audience });
    } catch (err) {
      console.error(`⚠ [${label}] Failed to fetch ZAF app public key for app ${appId}: ${err.message}`);
      return null;
    }
  }

  return null;
}
