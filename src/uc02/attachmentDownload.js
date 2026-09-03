// ---------------------------------------------------------------------------
// attachmentDownload.js — fetch a Zendesk attachment, and refuse a login page
// ---------------------------------------------------------------------------
// [E-1]. This began life as a six-line closure inside deploy/cx-apis/deps.js,
// which is deployment glue that no test reaches. It is here instead because
// what it got wrong could only ever have been caught by a test, and there was
// nowhere to put one.
//
// ---------------------------------------------------------------------------
// WHAT IT GOT WRONG, AND WHY THE ARGUMENT FOR IT WAS PERSUASIVE
//
// The original carried this comment, in earnest:
//
//     NO AUTH HEADER, and that is not an oversight. A Zendesk `content_url`
//     already carries its own access token in the path — it is the URL Zendesk
//     itself hands to a browser — so adding Authorization would send our
//     credentials to a URL that does not need them.
//
// The premise is true and the conclusion does not follow. A Zendesk account can
// be configured to REQUIRE AGENT SIGN-IN FOR ATTACHMENTS, and `your-subdomainhelp`
// is. On such an account the tokenised URL does not serve the file to an
// anonymous caller.
//
// It does not 401 either. THAT is the part worth remembering:
//
//     unauthenticated -> HTTP 200, text/html, 57KB  (a sign-in page)
//     authenticated   -> HTTP 200, application/pdf, 20508 bytes
//
// Both are 200. `if (!res.ok) throw` cannot tell them apart, so the sign-in
// page was handed to the extractor as if it were the receipt, and a paid
// vision call was spent reading it. Measured on live ticket 22, n8n execution
// 10155: the model came back `total: null, confidence: 0` with the note
// "Document appears to be a sign-in page for your-subdomain".
//
// The model refusing to invent a total is the system's last line working, and
// it is the ONLY reason this surfaced as a null instead of a wrong number.
// A guard that depends on a model choosing to be honest is not a guard.
//
// ---------------------------------------------------------------------------
// SO THERE ARE TWO FIXES HERE AND THE SECOND IS THE LOAD-BEARING ONE
//
// 1. Send Authorization — but ONLY to the one host we configured. The original
//    comment's real concern (do not hand our credentials to whatever host a
//    URL happens to name) was correct and is now enforced rather than achieved
//    by sending no credentials at all. An off-host URL is refused outright
//    rather than fetched anonymously, because a `content_url` pointing
//    somewhere unexpected is a reason to stop, not a reason to try harder.
//
// 2. Refuse an HTML response. This is what actually catches the failure, and
//    it keeps catching it if the credential later expires, loses a scope, or
//    the account changes this setting again. Fix 1 without fix 2 would work
//    today and fail silently the next time authentication breaks — which is
//    the exact shape of the thing being fixed.
// ---------------------------------------------------------------------------

/**
 * A receipt is a page or a photo. Without a ceiling, one attached 200MB file
 * turns a webhook into an out-of-memory crash of the whole function.
 */
export const MAX_RECEIPT_BYTES = 12 * 1024 * 1024;

/**
 * Content types that are never a receipt and always a symptom.
 *
 * HTML is the sign-in page. XML covers the S3-style `<Error><Code>
 * AccessDenied` body, which is likewise served with a success-shaped response
 * by some storage backends.
 */
const NEVER_A_RECEIPT = [/^text\/html/i, /^application\/xhtml/i, /^text\/xml/i, /^application\/xml/i];

/** Sniff the first bytes, because a content-type header is a claim. */
function looksLikeHtml(buf) {
  const head = buf.subarray(0, 512).toString("latin1").trimStart().toLowerCase();
  return head.startsWith("<!doctype html") || head.startsWith("<html") || head.startsWith("<?xml");
}

/**
 * Build the downloader UC-02's receipt reader calls.
 *
 * @param {object} deps
 * @param {() => Promise<string>} deps.authorization  yields the header value.
 *   A FUNCTION, not a string, so the client's own token cache and refresh are
 *   reused — minting a token per attachment would be both wasteful and a
 *   second place for auth to be configured.
 * @param {string} deps.subdomain  the ONE Zendesk account whose attachments
 *   this may authenticate to.
 * @param {typeof fetch} [deps.fetchImpl]  injected so this is testable without
 *   a network, per the standing rule about every new call site getting its own
 *   seam on day one rather than after a slow test surfaces the gap.
 */
export function createZendeskAttachmentDownloader({ authorization, subdomain, fetchImpl = fetch } = {}) {
  const expectedHost = subdomain ? `${subdomain}.zendesk.com` : null;

  return async function downloadAttachment(url) {
    let host;
    try {
      host = new URL(url).host;
    } catch {
      throw new Error("attachment url is not a url");
    }

    // FAIL CLOSED ON AN UNEXPECTED HOST. Not "fetch it without credentials" —
    // a content_url that is not on our account is a reason to stop.
    if (!expectedHost || host.toLowerCase() !== expectedHost.toLowerCase()) {
      throw new Error(`attachment host ${host} is not the configured Zendesk account`);
    }

    const headers = {};
    if (authorization) {
      const value = await authorization();
      if (value) headers.Authorization = value;
    }

    // `redirect: "follow"` is safe with a header attached: fetch strips
    // Authorization on a CROSS-ORIGIN redirect by specification, so a redirect
    // to a CDN cannot carry our credentials off the account.
    const res = await fetchImpl(url, { redirect: "follow", headers });
    if (!res.ok) throw new Error(`attachment download failed: ${res.status}`);

    const contentType = String(res.headers.get("content-type") ?? "");
    if (NEVER_A_RECEIPT.some((re) => re.test(contentType))) {
      // The whole point of this module. See the header.
      throw new Error(
        `attachment came back as ${contentType.split(";")[0]} — that is a sign-in or error page, not a receipt. ` +
          "The download was not authenticated, or the credential no longer has access."
      );
    }

    const declared = Number(res.headers.get("content-length") ?? 0);
    if (declared > MAX_RECEIPT_BYTES) throw new Error("attachment too large");

    const buf = Buffer.from(await res.arrayBuffer());
    // Checked AGAIN after reading: content-length is a claim and may be absent.
    if (buf.byteLength > MAX_RECEIPT_BYTES) throw new Error("attachment too large");
    if (!buf.byteLength) throw new Error("attachment was empty");

    // And sniff, because a sign-in page served as application/octet-stream
    // would pass the header check above.
    if (looksLikeHtml(buf)) {
      throw new Error(
        "attachment body is HTML — that is a sign-in or error page, not a receipt, whatever its content-type says"
      );
    }

    return buf.toString("base64");
  };
}
