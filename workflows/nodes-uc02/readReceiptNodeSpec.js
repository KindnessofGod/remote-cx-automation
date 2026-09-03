// ---------------------------------------------------------------------------
// readReceiptNodeSpec.js — the "Read Receipt (API)" node's load-bearing config
// ---------------------------------------------------------------------------
// [E-1] on the Zendesk path is one HTTP node. It has no jsCode, so a body diff
// cannot see it at all — the same blind spot the switch and Supabase nodes
// needed structural checks for.
//
// THREE PROPERTIES, AND THE THIRD IS THE ONE THAT WILL BITE.
//
// 1. It calls OUR endpoint. Repointed anywhere else, the graph would send a
//    ticket id and a shared secret to a host nobody reviewed.
// 2. It sends `X-YOUR-WEBHOOK-TOKEN`, AND THE VALUE COMES FROM A CREDENTIAL.
//    Without it the endpoint answers 401, every read fails, and the symptom —
//    claims quietly not being checked against their receipts — is invisible
//    unless somebody opens an execution.
//
//    THIS CHECK USED TO ASK ONLY WHETHER THE HEADER WAS PRESENT, and that was
//    not enough. The node shipped carrying `X-YOUR-WEBHOOK-TOKEN:
//    ={{ $env.N8N_WEBHOOK_TOKEN }}`, which satisfies "the header is there"
//    perfectly while resolving to an EMPTY STRING: n8n blocks `$env` access
//    inside nodes by default (N8N_BLOCK_ENV_ACCESS_IN_NODE), and the variable
//    was never set on the n8n host either. Every call got 401.
//
//    It was invisible for a reason worth remembering: property 3 below means a
//    401 does not fail the node. The execution reported `success`, all 23
//    nodes green, and the error sat inside the node's OUTPUT where only
//    someone opening the execution would ever see it. The two properties are
//    individually right and jointly blinding, so the guard has to be the thing
//    that sees it.
//
//    A credential is required rather than merely preferred because an
//    expression can silently produce nothing while a missing credential
//    cannot: n8n refuses to run a node whose selected credential is absent.
//    The failure mode moves from "quietly unauthenticated forever" to "stops
//    immediately and says so".
// 3. `onError: continueRegularOutput`. THIS IS THE IMPORTANT ONE. Our API being
//    unreachable must never abort a UC-02 run: the gates read an unrecognised
//    response as "nobody tried" and decide exactly as they did before receipts
//    were read. Flip this to the default and an outage of the receipt reader
//    becomes an outage of UC-02 itself — every claim failing at a node that is
//    not on the money path at all.
// ---------------------------------------------------------------------------

/** The path our endpoint lives at. Host is deliberately not pinned — the
 *  deployment URL is configurable — but the path and its ownership are. */
export const READ_RECEIPT_PATH = "/uc02/api/receipts/read-from-ticket";
export const READ_RECEIPT_TOKEN_HEADER = "X-YOUR-WEBHOOK-TOKEN";

/**
 * The credential type the token must arrive by.
 *
 * `httpHeaderAuth` is n8n's generic "send this header" credential — the same
 * MECHANISM the inbound webhook node uses to verify the same secret, which is
 * the point: one secret, one credential, one rotation. A second credential
 * holding the same value would be a second thing to rotate, and a copy that
 * drifted from the original is exactly what silently broke every webhook
 * during the 2026-08-29 account migration.
 *
 * Deliberately NOT pinned to a credential ID. Ids differ between n8n
 * instances, and pinning one would make this file describe an installation
 * rather than a design. What must hold is that the value comes from a
 * credential at all.
 */
export const READ_RECEIPT_CREDENTIAL_TYPE = "httpHeaderAuth";

export function readReceiptNodeIssues(node) {
  const issues = [];
  const p = node?.parameters ?? {};

  if (String(p.method ?? "").toUpperCase() !== "POST") {
    issues.push(`method is ${JSON.stringify(p.method)}, expected POST`);
  }
  if (typeof p.url !== "string" || !p.url.includes(READ_RECEIPT_PATH)) {
    issues.push(
      `url is ${JSON.stringify(p.url)}, expected to end in ${READ_RECEIPT_PATH} — ` +
        "a repointed node sends a ticket id and a shared secret to an unreviewed host"
    );
  }

  // THE SECRET MUST COME FROM A CREDENTIAL — see property 2 in the header.
  // Checking only that the header NAME is present is what let a node that was
  // never authenticated pass this guard for a day.
  const cred = node?.credentials?.[READ_RECEIPT_CREDENTIAL_TYPE];
  const credAttached = Boolean(cred && cred.id);
  if (p.authentication !== "genericCredentialType" || p.genericAuthType !== READ_RECEIPT_CREDENTIAL_TYPE || !credAttached) {
    issues.push(
      `the ${READ_RECEIPT_TOKEN_HEADER} secret does not come from a ${READ_RECEIPT_CREDENTIAL_TYPE} ` +
        "credential (authentication=" + JSON.stringify(p.authentication) + ", genericAuthType=" +
        JSON.stringify(p.genericAuthType) + ", credential attached=" + credAttached + ") — " +
        "an expression can resolve to an empty string and still look configured, and a 401 here is " +
        "SILENT because onError keeps the run green"
    );
  }

  // And no hand-rolled copy of the header alongside it. A literal would put the
  // shared secret in the workflow JSON, which the n8n API returns in full to
  // anything holding a read key; an expression re-introduces the empty-value
  // failure the credential was chosen to remove. Either way the header the
  // credential sets is the one that should win, and two sources for one header
  // is a question nobody should have to answer at 2am.
  const headers = p.headerParameters?.parameter ?? [];
  const manual = Array.isArray(headers)
    ? headers.filter((h) => String(h?.name ?? "").toLowerCase() === READ_RECEIPT_TOKEN_HEADER.toLowerCase())
    : [];
  if (manual.length) {
    issues.push(
      `${READ_RECEIPT_TOKEN_HEADER} is ALSO set as a manual header (${JSON.stringify(manual[0]?.value)}) — ` +
        "the credential already sends it; a second source is either a secret in plain JSON or an " +
        "expression that can silently resolve to nothing"
    );
  }

  if (node?.onError !== "continueRegularOutput") {
    issues.push(
      `onError is ${JSON.stringify(node?.onError)}, expected "continueRegularOutput" — ` +
        "without it an outage of the receipt reader becomes an outage of UC-02 itself"
    );
  }

  return issues;
}
