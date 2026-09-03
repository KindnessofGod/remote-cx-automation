// ---------------------------------------------------------------------------
// uc02AttachmentDownload.test.js — a 200 is not a document
// ---------------------------------------------------------------------------
// [E-1]. The defect these tests exist for was measured live, on Zendesk ticket
// 22 and n8n execution 10155, and the numbers are worth stating because the
// whole trap is that both responses are successes:
//
//     unauthenticated -> HTTP 200, text/html, 57346 bytes  (a sign-in page)
//     authenticated   -> HTTP 200, application/pdf, 20508 bytes
//
// The downloader checked `res.ok`, which is true of both, and handed the login
// page to the extractor as the receipt. A paid vision call was spent reading
// it. What surfaced the problem was the MODEL declining to invent a total —
// `total: null, confidence: 0, notes: "Document appears to be a sign-in page"`
// — and a guard that relies on a model choosing to be honest is not a guard.
//
// The old code lived as a closure in deploy/cx-apis/deps.js, which no test
// reaches. That is why it is in src/ now: the fix and the test are the same
// piece of work, and there was previously nowhere to put the second half.
// ---------------------------------------------------------------------------

import { test } from "node:test";
import { strict as assert } from "node:assert";
import { createZendeskAttachmentDownloader, MAX_RECEIPT_BYTES } from "../src/uc02/attachmentDownload.js";

const SUBDOMAIN = "your-subdomainhelp";
const URL_ON_ACCOUNT = `https://${SUBDOMAIN}.zendesk.com/attachments/token/abc123/?name=receipt.pdf`;

/** A fetch stand-in that records what it was asked and answers as told. */
function fakeFetch(response, seen = {}) {
  return async (url, init) => {
    seen.url = url;
    seen.headers = init?.headers ?? {};
    seen.redirect = init?.redirect;
    return response;
  };
}

function reply({ status = 200, contentType = "application/pdf", body = Buffer.from("%PDF-1.4\nhello") } = {}) {
  const headers = new Map([
    ["content-type", contentType],
    ["content-length", String(body.byteLength)],
  ]);
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (k) => headers.get(String(k).toLowerCase()) ?? null },
    arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength),
  };
}

function make(over = {}) {
  const seen = {};
  const dl = createZendeskAttachmentDownloader({
    authorization: async () => "Bearer test-token",
    subdomain: SUBDOMAIN,
    fetchImpl: fakeFetch(over.response ?? reply(), seen),
    ...(over.opts ?? {}),
  });
  return { dl, seen };
}

// --- the regression -------------------------------------------------------

test("an HTML body served with 200 is REFUSED, not read as a receipt", async () => {
  // The live failure, exactly. The old check was `if (!res.ok) throw`, and
  // res.ok is TRUE here.
  const { dl } = make({
    response: reply({ contentType: "text/html; charset=utf-8", body: Buffer.from("<!DOCTYPE html><html>sign in</html>") }),
  });
  await assert.rejects(dl(URL_ON_ACCOUNT), /sign-in or error page/);
});

test("HTML is caught even when the content-type LIES about it", async () => {
  // Belt and braces: a header is a claim. This is what keeps the guard working
  // if the account starts serving its login page as octet-stream.
  const { dl } = make({
    response: reply({ contentType: "application/octet-stream", body: Buffer.from("<!doctype html>\n<html><body>Sign in</body></html>") }),
  });
  await assert.rejects(dl(URL_ON_ACCOUNT), /body is HTML/);
});

test("an XML access-denied body is refused too", async () => {
  // The S3-style `<Error><Code>AccessDenied` shape, likewise served 200 by
  // some storage backends.
  const { dl } = make({
    response: reply({ contentType: "application/xml", body: Buffer.from("<Error><Code>AccessDenied</Code></Error>") }),
  });
  await assert.rejects(dl(URL_ON_ACCOUNT), /sign-in or error page/);
});

test("a real PDF passes and comes back as base64", async () => {
  const { dl } = make();
  const out = await dl(URL_ON_ACCOUNT);
  assert.equal(Buffer.from(out, "base64").toString("latin1").slice(0, 5), "%PDF-");
});

// --- authentication, and the limit on it ----------------------------------

test("the Authorization header IS sent to the configured account", async () => {
  const { dl, seen } = make();
  await dl(URL_ON_ACCOUNT);
  assert.equal(seen.headers.Authorization, "Bearer test-token");
});

test("an off-account host is REFUSED rather than fetched anonymously", async () => {
  // The original code's concern — do not hand credentials to whatever host a
  // URL names — was right. Its remedy (send no credentials ever) was not. A
  // content_url pointing somewhere unexpected is a reason to stop.
  const { dl, seen } = make();
  await assert.rejects(dl("https://evil.example/attachments/token/abc/?name=receipt.pdf"), /not the configured Zendesk account/);
  assert.equal(seen.url, undefined, "an off-account URL was fetched at all");
});

test("a lookalike host does not satisfy the check", async () => {
  const { dl } = make();
  for (const bad of [
    `https://${SUBDOMAIN}.zendesk.com.evil.example/x`,
    `https://evil.example/?${SUBDOMAIN}.zendesk.com`,
    `https://not${SUBDOMAIN}.zendesk.com/x`,
  ]) {
    await assert.rejects(dl(bad), /not the configured Zendesk account/, `accepted ${bad}`);
  }
});

test("with no subdomain configured, EVERY url is refused", async () => {
  // Fail closed. An unconfigured downloader must not become an open fetcher.
  const dl = createZendeskAttachmentDownloader({ authorization: async () => "Bearer t", subdomain: null, fetchImpl: fakeFetch(reply()) });
  await assert.rejects(dl(URL_ON_ACCOUNT), /not the configured Zendesk account/);
});

test("a malformed url is refused before any fetch", async () => {
  const { dl, seen } = make();
  await assert.rejects(dl("not a url"), /not a url/);
  assert.equal(seen.url, undefined);
});

// --- the bounds that were already right ------------------------------------

test("a non-2xx is still an error, and says which", async () => {
  const { dl } = make({ response: reply({ status: 404 }) });
  await assert.rejects(dl(URL_ON_ACCOUNT), /attachment download failed: 404/);
});

test("an oversized attachment is refused on the DECLARED length, before reading it", async () => {
  const body = Buffer.from("%PDF-1.4");
  const headers = new Map([["content-type", "application/pdf"], ["content-length", String(MAX_RECEIPT_BYTES + 1)]]);
  let read = false;
  const dl = createZendeskAttachmentDownloader({
    authorization: async () => "Bearer t",
    subdomain: SUBDOMAIN,
    fetchImpl: async () => ({
      ok: true, status: 200,
      headers: { get: (k) => headers.get(String(k).toLowerCase()) ?? null },
      arrayBuffer: async () => { read = true; return body.buffer; },
    }),
  });
  await assert.rejects(dl(URL_ON_ACCOUNT), /too large/);
  assert.equal(read, false, "the oversized body was read into memory anyway");
});

test("an oversized attachment is refused again AFTER reading, when no length was declared", async () => {
  // content-length is a claim and may be absent; the ceiling must not depend
  // on the sender being truthful.
  const big = Buffer.alloc(MAX_RECEIPT_BYTES + 10, 0x25);
  const headers = new Map([["content-type", "application/pdf"]]);
  const dl = createZendeskAttachmentDownloader({
    authorization: async () => "Bearer t",
    subdomain: SUBDOMAIN,
    fetchImpl: async () => ({
      ok: true, status: 200,
      headers: { get: (k) => headers.get(String(k).toLowerCase()) ?? null },
      arrayBuffer: async () => big.buffer.slice(big.byteOffset, big.byteOffset + big.byteLength),
    }),
  });
  await assert.rejects(dl(URL_ON_ACCOUNT), /too large/);
});

test("an empty body is an error, not an empty receipt", async () => {
  const { dl } = make({ response: reply({ body: Buffer.alloc(0) }) });
  await assert.rejects(dl(URL_ON_ACCOUNT), /empty/);
});

test("redirects are followed — a CDN hop is normal, and fetch strips auth cross-origin", async () => {
  const { dl, seen } = make();
  await dl(URL_ON_ACCOUNT);
  assert.equal(seen.redirect, "follow");
});

// ---------------------------------------------------------------------------
// The SCOPE the downloader's client runs on — a deployment-wiring property,
// checked here because it is the third silent 4xx this one path produced and
// nothing else looks at it.
//
// The attachment file path is not a ticket API endpoint. Measured live against
// `your-subdomainhelp` on 2026-08-29, one URL, one client, three scopes:
//
//     "tickets:read tickets:write" -> 403
//     "read"                       -> 200, %PDF-, 20508 bytes
//     "read write"                 -> 200, %PDF-, 20508 bytes
//
// So the routine scope every OTHER Zendesk call in this deployment uses cannot
// download an attachment at all, and the failure is a 403 that
// readReceiptFromTicket() correctly swallows into `receipt_unreadable` — an
// honest reason that names no cause, which is right for the response and
// useless for whoever has to fix it.
//
// `read` and not `read write` is the part to protect. This is the one
// credential in the deployment that fetches an unvalidated third-party
// document, and it cannot write to Zendesk. A later edit that "simplifies"
// this back to the shared client would silently re-grant write.
// ---------------------------------------------------------------------------
import { readFileSync } from "node:fs";

const DEPS = readFileSync(new URL("../deploy/cx-apis/deps.js", import.meta.url), "utf8");

test("the attachment downloader is built on a client scoped to read, not the shared one", () => {
  const start = DEPS.indexOf("function buildAttachmentDownloader()");
  assert.ok(start > 0, "buildAttachmentDownloader has been renamed or removed");
  const body = DEPS.slice(start, start + 2200);
  assert.match(body, /scope:\s*"read"/, "the downloader no longer requests the `read` scope — attachments will 403");
  assert.doesNotMatch(body, /scope:\s*"read write"/, "the downloader was widened to write; it only ever fetches a file");
  assert.doesNotMatch(
    body,
    /const zd = zendeskClient\(\)/,
    "the downloader is back on the shared client, whose tickets:* scope cannot fetch an attachment"
  );
});

test("it fails closed when Zendesk is unconfigured", () => {
  const start = DEPS.indexOf("function buildAttachmentDownloader()");
  const body = DEPS.slice(start, start + 400);
  assert.match(body, /if \(!isZendeskConfigured\(\)\) return null/, "an unconfigured deployment would build a downloader anyway");
});
