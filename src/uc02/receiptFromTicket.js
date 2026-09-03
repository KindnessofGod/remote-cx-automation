// ---------------------------------------------------------------------------
// receiptFromTicket.js — get the receipt off a Zendesk ticket and read it
// ---------------------------------------------------------------------------
// WHY THIS LIVES HERE AND NOT IN AN n8n CODE NODE
//
// The obvious way to do [E-1] on the Zendesk path is four new n8n nodes: fetch
// the comments, download the attachment, call OpenAI, validate the answer. That
// works, and it puts a THIRD copy of the extraction schema in a Code node —
// after src/uc02/receiptExtraction.js and the validation it already owns.
//
// This repository has paid for duplicated logic repeatedly (the gates exist
// twice and need a parity test to stay honest), and it accepts that cost only
// where n8n genuinely cannot call the real thing. Here it can: the graph makes
// one authenticated HTTP request to our own API, which already holds the
// Zendesk credentials and the tested extractor. One node, one schema, and n8n
// stays a router rather than becoming a second implementation.
//
// ---------------------------------------------------------------------------
// WHY THE WEBHOOK CANNOT JUST SEND THE FILE
//
// The nine intake triggers build their payload from a JSON template, and
// UC-02's has `"attachments":[]` — a hard-coded empty array. That is not an
// oversight anybody can fix in the template: Zendesk's placeholder set has no
// way to emit a JSON array of attachment URLs, and the ones that render a list
// are not JSON-safe. So the ticket id is the only handle, and the attachments
// have to be fetched. Recorded here because the empty array looks like a bug
// and is not one.
//
// ---------------------------------------------------------------------------
// WHAT IT REFUSES TO DO
//
// It reads ONE receipt — the first readable attachment — and says so. It does
// not merge several documents into a total, because a claim evidenced by four
// photos is a claim a person should look at, and silently summing them is
// exactly the kind of helpfulness that decides something.
// ---------------------------------------------------------------------------

import { extractReceipt, isReadableReceipt } from "./receiptExtraction.js";

/**
 * The first attachment on a ticket that we could actually read.
 *
 * Comments are searched NEWEST FIRST: when an employee is asked for a better
 * photo and sends one, the newest is the one they mean. Oldest-first would keep
 * reading the blurry original forever and look like the re-upload was ignored.
 *
 * @param {Array} comments  as returned by ZendeskClient#getTicketComments
 * @returns {{url:string, contentType:string, fileName:string}|null}
 */
export function findReadableAttachment(comments) {
  const ordered = Array.isArray(comments) ? [...comments].reverse() : [];
  for (const comment of ordered) {
    const attachments = Array.isArray(comment?.attachments) ? comment.attachments : [];
    for (const a of attachments) {
      const contentType = a?.content_type ?? a?.contentType ?? "";
      const url = a?.content_url ?? a?.contentUrl ?? "";
      if (url && isReadableReceipt(contentType)) {
        return { url, contentType: String(contentType).toLowerCase(), fileName: a?.file_name ?? a?.fileName ?? "receipt" };
      }
    }
  }
  return null;
}

/**
 * Fetch the receipt attached to a ticket and read it.
 *
 * Every dependency is injected. `download` is separate from `zendesk` because a
 * Zendesk attachment's `content_url` is fetched directly rather than through
 * the API client, and a test must be able to stub the bytes without standing up
 * an HTTP server.
 *
 * @returns {Promise<{extracted:object|null, source:string, reason:string, attachment:object|null}>}
 *
 * EVERY FAILURE IS A `human_review`, NEVER AN APPROVAL. The reasons are kept
 * distinct because they send a person somewhere different: no ticket, no
 * attachment, an attachment we cannot read, or a download that failed.
 */
export async function readReceiptFromTicket({ ticketId }, { zendesk, download, readReceipt } = {}) {
  const unread = (reason, attachment = null) => ({ extracted: null, source: "not_attempted", reason, attachment });

  if (!zendesk) return unread("zendesk_not_configured");
  if (ticketId === null || ticketId === undefined || ticketId === "") return unread("no_ticket_supplied");

  let comments;
  try {
    comments = await zendesk.getTicketComments(ticketId);
  } catch {
    return unread("ticket_unreadable");
  }

  const attachment = findReadableAttachment(comments);
  // NOT an error, and deliberately its own reason: most expense tickets have no
  // receipt attached to the TICKET because the receipt lives on the Remote
  // expense record. Gate 8b treats a `no_receipt_attached` reading the same as
  // no reading at all, so this must never look like a failure.
  if (!attachment) return unread("no_receipt_attached");

  let dataBase64;
  try {
    dataBase64 = await download(attachment.url);
  } catch {
    return unread("receipt_unreadable", attachment);
  }
  if (!dataBase64) return unread("receipt_unreadable", attachment);

  const reading = await extractReceipt(
    { mimeType: attachment.contentType, fileName: attachment.fileName, dataBase64 },
    { readReceipt }
  );
  return { ...reading, attachment };
}
