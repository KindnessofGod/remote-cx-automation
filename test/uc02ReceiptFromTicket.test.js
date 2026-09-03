// ---------------------------------------------------------------------------
// uc02ReceiptFromTicket.test.js — [E-1] on the Zendesk path
// ---------------------------------------------------------------------------
// The nine intake triggers build their webhook payload from a JSON template,
// and UC-02's contains `"attachments":[]` — a hard-coded empty array. That is
// not fixable in the template: Zendesk has no placeholder that emits a JSON
// array of attachment URLs. So the ticket id is the only handle and the
// attachments must be fetched.
//
// The rule these tests hold the module to: every failure is distinguishable,
// and the ORDINARY case — a ticket with no receipt attached, because the
// receipt lives on the Remote expense record — must never look like a failure.
// ---------------------------------------------------------------------------

import { test } from "node:test";
import { strict as assert } from "node:assert";
import { readReceiptFromTicket, findReadableAttachment } from "../src/uc02/receiptFromTicket.js";
import { RECEIPT_NOT_ATTEMPTED_REASONS } from "../src/uc02/policyEngine.js";

const pdf = (url, name = "receipt.pdf") => ({ content_type: "application/pdf", content_url: url, file_name: name });
const GOOD = { merchant: "Cafe", date: "2026-08-12", total: 6855, currency: "USD", confidence: 0.9, notes: "" };

function deps({ comments = [], bytes = "JVBERi0=", reading = GOOD } = {}) {
  return {
    zendesk: { getTicketComments: async () => comments },
    download: async () => bytes,
    readReceipt: async () => reading,
  };
}

test("the receipt is fetched off the ticket and read", async () => {
  const out = await readReceiptFromTicket({ ticketId: 14 }, deps({ comments: [{ attachments: [pdf("https://z/att/1")] }] }));
  assert.equal(out.source, "llm");
  assert.equal(out.extracted.total, 6855);
  assert.equal(out.attachment.url, "https://z/att/1");
});

test("the NEWEST readable attachment wins", async () => {
  // When an employee is asked for a clearer photo and sends one, the newest is
  // the one they mean. Oldest-first would keep reading the blurry original and
  // look like the re-upload was ignored.
  const out = await readReceiptFromTicket(
    { ticketId: 14 },
    deps({ comments: [{ attachments: [pdf("https://z/old")] }, { attachments: [pdf("https://z/new")] }] })
  );
  assert.equal(out.attachment.url, "https://z/new");
});

test("an unreadable FILE TYPE is skipped, and a readable one further back is found", async () => {
  const out = await readReceiptFromTicket(
    { ticketId: 14 },
    deps({
      comments: [
        { attachments: [pdf("https://z/ok")] },
        { attachments: [{ content_type: "application/zip", content_url: "https://z/zip" }] },
      ],
    })
  );
  assert.equal(out.attachment.url, "https://z/ok");
});

test("NO ATTACHMENT is the ordinary case and must not read as a failure", async () => {
  // Most expense tickets carry no receipt: the receipt lives on the Remote
  // expense record. If this refused, nearly every claim would go to a human.
  const out = await readReceiptFromTicket({ ticketId: 14 }, deps({ comments: [{ attachments: [] }] }));
  assert.equal(out.reason, "no_receipt_attached");
  assert.ok(
    RECEIPT_NOT_ATTEMPTED_REASONS.includes(out.reason),
    "gate 8b would refuse a ticket for the crime of having no attachment"
  );
});

test("every 'nobody tried' reason this module can return is exempt in the gate", async () => {
  // The two lists must not drift: a reason added here and not there becomes a
  // silent refusal, and the failure would look like the receipt was bad.
  const cases = [
    [{ ticketId: 14 }, { download: async () => "x", readReceipt: async () => GOOD }, "zendesk_not_configured"],
    [{ ticketId: "" }, deps(), "no_ticket_supplied"],
    [{ ticketId: 14 }, deps({ comments: [] }), "no_receipt_attached"],
  ];
  for (const [args, d, expected] of cases) {
    const out = await readReceiptFromTicket(args, d);
    assert.equal(out.reason, expected);
    assert.ok(RECEIPT_NOT_ATTEMPTED_REASONS.includes(expected), `${expected} is not exempt in policyEngine`);
  }
});

test("a failed ticket read and a failed download are DIFFERENT reasons", async () => {
  // One means Zendesk is unreachable, the other means the file is. A reviewer
  // chasing the wrong one wastes the trip.
  const badTicket = await readReceiptFromTicket(
    { ticketId: 14 },
    { zendesk: { getTicketComments: async () => { throw new Error("401"); } }, download: async () => "x", readReceipt: async () => GOOD }
  );
  assert.equal(badTicket.reason, "ticket_unreadable");

  const badDownload = await readReceiptFromTicket(
    { ticketId: 14 },
    { zendesk: { getTicketComments: async () => [{ attachments: [pdf("https://z/1")] }] }, download: async () => { throw new Error("timeout"); }, readReceipt: async () => GOOD }
  );
  assert.equal(badDownload.reason, "receipt_unreadable");
  assert.notEqual(badDownload.reason, badTicket.reason);
});

test("a download that fails REFUSES — it is not in the exempt list", () => {
  // The half that matters: a receipt we tried and failed to read must still
  // send the claim to a person.
  assert.equal(RECEIPT_NOT_ATTEMPTED_REASONS.includes("receipt_unreadable"), false);
  assert.equal(RECEIPT_NOT_ATTEMPTED_REASONS.includes("ticket_unreadable"), false);
});

test("findReadableAttachment tolerates junk without throwing", () => {
  for (const junk of [null, undefined, [], [null], [{ attachments: null }], [{ attachments: [{}] }]]) {
    assert.equal(findReadableAttachment(junk), null, `threw or matched on ${JSON.stringify(junk)}`);
  }
});

test("it reads ONE receipt and names which — it never merges several", async () => {
  const out = await readReceiptFromTicket(
    { ticketId: 14 },
    deps({ comments: [{ attachments: [pdf("https://z/a", "a.pdf"), pdf("https://z/b", "b.pdf")] }] })
  );
  assert.equal(typeof out.attachment.fileName, "string");
  assert.equal(out.extracted.total, 6855, "a merged total appeared");
});

// --- the route the n8n graph calls ------------------------------------------

import { createUc02Handler } from "../src/uc02/server.js";
import { createServer } from "node:http";

async function withServer(opts, fn) {
  const handler = createUc02Handler({ expenseStore: { list: () => [], get: () => null }, audit: { log: async () => {} }, remote: {}, ...opts });
  const server = createServer(handler);
  await new Promise((r) => server.listen(0, r));
  const port = server.address().port;
  try {
    return await fn(port);
  } finally {
    await new Promise((r) => server.close(r));
  }
}

const post = (port, body, headers = {}) =>
  fetch(`http://127.0.0.1:${port}/api/receipts/read-from-ticket`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });

test("ROUTE: unconfigured says so, and does not look like a bad token", async () => {
  await withServer({}, async (port) => {
    const res = await post(port, { ticketId: 1 });
    assert.equal(res.status, 503);
    assert.equal((await res.json()).code, "receipt_reader_not_configured");
  });
});

test("ROUTE: it is not open — a missing or wrong token is refused", async () => {
  // It reads a ticket and spends a paid vision call, so it must not be open.
  await withServer({ receiptTicketToken: "secret", zendesk: { getTicketComments: async () => [] } }, async (port) => {
    assert.equal((await post(port, { ticketId: 1 })).status, 401);
    assert.equal((await post(port, { ticketId: 1 }, { "X-YOUR-WEBHOOK-TOKEN": "wrong" })).status, 401);
  });
});

test("ROUTE: with the token it returns the transcription and no decision", async () => {
  await withServer(
    {
      receiptTicketToken: "secret",
      zendesk: { getTicketComments: async () => [{ attachments: [pdf("https://z/1")] }] },
      downloadAttachment: async () => "JVBERi0=",
      receiptReader: async () => GOOD,
    },
    async (port) => {
      const res = await post(port, { ticketId: 14 }, { "X-YOUR-WEBHOOK-TOKEN": "secret" });
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.extracted.total, 6855);
      assert.equal(body.attachment.fileName, "receipt.pdf");
      assert.equal(body.decision, undefined, "the read route returned a decision");
      assert.equal(body.reason, "receipt_read");
    }
  );
});
