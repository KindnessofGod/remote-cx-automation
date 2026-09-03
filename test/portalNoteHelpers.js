// ---------------------------------------------------------------------------
// portalNoteHelpers.js — read what the SPECIALIST is told, in a hermetic test
// ---------------------------------------------------------------------------
// Not a test file (no `.test.js`), so `node --test` does not run it.
//
// Since [N-14] (qa/contracts/UC-05-acceptance.md §11) the statutory notice, the
// rule, the tenure, the comparison and the payout no longer appear on the
// resigning employee's result page: they are `specialistDetail` rows, which
// forRequester() strips from the response and buildTicketNote() prints into the
// internal note HR Ops opens. A test that wants to assert the WORDING of those
// lines therefore has to read them where their reader does — off the note — and
// a hermetic run has no Zendesk, so this fake records the note instead. Same
// shape as portalTicket.test.js's double.
// ---------------------------------------------------------------------------

/** A Zendesk double that records what it was asked to create and to update. */
export function fakeZendesk() {
  let next = 900;
  const created = [];
  const updated = [];
  return {
    created,
    updated,
    async createTicket(payload) {
      next += 1;
      created.push(payload);
      return { id: next };
    },
    async updateTicket(id, patch) {
      updated.push({ id, patch });
      return { ticket: { id } };
    },
  };
}

export function unescapeHtml(s) {
  return String(s ?? "")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

/** `{ label: value }` for every fact-table row in a note's HTML. */
export function noteRows(html) {
  const rows = {};
  for (const m of String(html ?? "").matchAll(/<tr><th[^>]*>(.*?)<\/th><td[^>]*>(.*?)<\/td><\/tr>/gs)) {
    rows[unescapeHtml(m[1])] = unescapeHtml(m[2]);
  }
  return rows;
}

/** The rows of the most recently created ticket's internal note. */
export function lastNoteRows(zendesk) {
  const ticket = zendesk.created[zendesk.created.length - 1];
  return noteRows(ticket?.comment?.html_body ?? "");
}

/** The most recent PUBLIC reply posted to a ticket, or null. */
export function lastPublicReply(zendesk) {
  const pub = [...zendesk.updated].reverse().find((u) => u.patch?.comment?.public === true);
  return pub ? String(pub.patch.comment.body) : null;
}
