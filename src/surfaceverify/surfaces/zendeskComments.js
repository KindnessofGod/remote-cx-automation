// ---------------------------------------------------------------------------
// zendeskComments.js  —  Two REST-observable surfaces: the customer-facing
// public reply, and the specialist-facing internal note
// ---------------------------------------------------------------------------
// Rule 2: "Surfaces whose text is authored server-side... are read over REST
// — that is the SAME text the human reads, byte for byte, not an adjacent
// layer." A Zendesk ticket's comments ARE that text; there is no adjacent
// rendering layer between `comments[].html_body`/`plain_body` and what an
// agent or a customer sees in Zendesk's own UI.
// ---------------------------------------------------------------------------

/**
 * @param {import("../../zendesk/restClient.js").ZendeskClient} zendesk
 */
export function makeZendeskSurfaces(zendesk) {
  async function commentsFor(scenario) {
    const ref = scenario.decision.zendeskTicketId ?? scenario.decision.externalRef;
    if (!ref) return null;
    const id = Number(ref);
    if (!Number.isInteger(id)) return null; // not a Zendesk-ticket-sourced decision
    return zendesk.getTicketComments(id);
  }

  return {
    zendeskPublicReply: {
      id: "zendeskPublicReply",
      contract: "the rendered HTML letter, or nothing when no letter was issued",
      audience: "the customer (or, on the third-party path, whoever the ticket's requester is)",
      async textFor(scenario) {
        const comments = await commentsFor(scenario);
        if (!comments) return null;
        const publicOnes = comments.filter((c) => c.public);
        if (publicOnes.length === 0) return null;
        // Newest public comment — the letter, if one was posted.
        return publicOnes[publicOnes.length - 1].html_body ?? publicOnes[publicOnes.length - 1].body ?? null;
      },
    },

    zendeskInternalNote: {
      id: "zendeskInternalNote",
      contract: "the specialist-facing hand-off note",
      audience: "the specialist/agent who owns the ticket",
      async textFor(scenario) {
        const comments = await commentsFor(scenario);
        if (!comments) return null;
        const notes = comments.filter((c) => !c.public);
        if (notes.length === 0) return null;
        return notes[notes.length - 1].plain_body ?? notes[notes.length - 1].body ?? null;
      },
    },

    // Not human-readable prose, but the same surface interface: `textFor`
    // returns a string (JSON-encoded) or null, so the fact x surface x
    // scenario loop treats it identically to every other surface. Facts that
    // care about tags/group (F-6, F-13) JSON.parse it themselves.
    zendeskTicketMeta: {
      id: "zendeskTicketMeta",
      contract: "the ticket's tags and assigned group, as JSON",
      audience: "the routing/queueing system, not a person directly",
      async textFor(scenario) {
        const ref = scenario.decision.zendeskTicketId ?? scenario.decision.externalRef;
        if (!ref) return null;
        const id = Number(ref);
        if (!Number.isInteger(id)) return null;
        const ticket = await zendesk.getTicket(id);
        if (!ticket) return null;
        return JSON.stringify({ tags: ticket.tags ?? [], groupId: ticket.group_id ?? null, status: ticket.status ?? null });
      },
    },
  };
}
