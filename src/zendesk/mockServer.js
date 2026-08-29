// ---------------------------------------------------------------------------
// mockServer.js  —  A fake Zendesk API for local development & testing
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
// Same reasoning as src/remote/mockServer.js: test the whole ZendeskClient
// round-trip (get/update/resolve/flag a ticket) without a real account. When
// real ZENDESK_* credentials are set, point ZendeskClient at the real
// subdomain instead — nothing else changes.
// ---------------------------------------------------------------------------

import { createServer } from "node:http";

export const TICKETS = {
  "1001": {
    id: 1001,
    subject: "Employment verification letter",
    description: "Please send me a standard employment verification letter.",
    status: "open",
    tags: [],
    custom_fields: [{ id: 360000000001, value: "emp_active_001" }],
    // THE REQUESTER, which this fixture did not carry until 2026-08-21.
    //
    // Every real Zendesk ticket has one — it is the account Zendesk itself
    // authenticated — and it is the ONLY identity signal a ticket carries, so
    // the live n8n path has always read it. Omitting it here meant the mock
    // could not exercise the identity derivation at all: `normalizeZendeskTicket`
    // returned a null session, which read as correct because the Node-side
    // normalizer hard-coded a null session anyway. Two wrongs agreeing.
    //
    // The address matches `emp_active_001`'s on the Remote mock deliberately —
    // that match IS the identity check, and a fixture where it cannot succeed
    // can only ever demonstrate the refusal (the dead-gate shape, four times
    // over in this repository's history).
    requester: { id: 500001, email: "amara@acme.test", name: "Amara Okafor" },
    comments: [],
  },
};

function findTicket(id) {
  return TICKETS[String(id)];
}

// Ticket ids for tickets the mock CREATES (POST /api/v2/tickets), kept apart
// from the seeded "1001" fixture so the two can never collide.
let nextTicketId = 2000;

// ---------------------------------------------------------------------------
// GROUPS — the teams an escalation is assigned to.
// ---------------------------------------------------------------------------
// DELIBERATELY EMPTY AT START, which is the interesting part. A real Zendesk
// account does not have "Mobility & Legal (Tier-2)" in it until somebody makes
// it, and the escalation path's most important behaviour is what it does when
// the group is MISSING: tag, note the intended team, and say assignment was
// skipped. A mock pre-seeded with every group would make that path unreachable
// and the fallback untestable — the failure mode this repo keeps recording,
// where the fixture agrees with the code and neither is compared to reality.
//
// scripts/setup-zendesk-groups.mjs creates them, here as against a real
// account, and a test can call the same endpoints to set up either state.
const GROUPS = new Map();
let nextGroupId = 5000;

/** Reset to the empty, nothing-provisioned state. Used by tests. */
export function resetGroups() {
  GROUPS.clear();
}

// Mirrors the shape ZendeskClient's #fetchOAuthToken() sends/expects — see
// that file's header comment for what's verified vs. assumed about the real
// endpoint. This mock lets the OAuth code path be exercised in tests even
// though the real shape isn't independently confirmed yet.
function handleOAuthToken(req, res) {
  let body = "";
  req.on("data", (chunk) => (body += chunk));
  req.on("end", () => {
    const parsed = JSON.parse(body || "{}");
    if (parsed.grant_type !== "client_credentials" || !parsed.client_id || !parsed.client_secret) {
      return send(res, 400, { error: "invalid_request" });
    }
    if (parsed.client_secret !== "mock_client_secret") {
      return send(res, 401, { error: "invalid_client" });
    }
    send(res, 200, { access_token: "mock_oauth_access_token", token_type: "bearer", expires_in: 1800 });
  });
}

function handle(req, res) {
  const url = new URL(req.url, "http://localhost");
  const parts = url.pathname.split("/").filter(Boolean); // e.g. ["api","v2","tickets","1001"]

  res.setHeader("Content-Type", "application/json");

  if (req.method === "POST" && parts[0] === "oauth" && parts[1] === "tokens") {
    return handleOAuthToken(req, res);
  }

  const isTicketPath = parts[0] === "api" && parts[1] === "v2" && parts[2] === "tickets" && parts[3];
  const isTicketCollection = parts[0] === "api" && parts[1] === "v2" && parts[2] === "tickets" && !parts[3];

  // Every ticket route requires SOME auth header — catches a client sending
  // neither Basic nor a real Bearer token, and (for the OAuth path
  // specifically) that the mock-issued token is the one actually sent back.
  if (isTicketPath || isTicketCollection) {
    const auth = req.headers["authorization"] ?? "";
    const validBasic = auth.startsWith("Basic ");
    const validBearer = auth === "Bearer mock_oauth_access_token";
    if (!validBasic && !validBearer) return send(res, 401, { error: "not_authenticated" });
  }

  // --- groups ---------------------------------------------------------------
  const isGroupCollection = parts[0] === "api" && parts[1] === "v2" && parts[2] === "groups" && parts.length === 3;

  if (req.method === "GET" && isGroupCollection) {
    return send(res, 200, { groups: [...GROUPS.values()] });
  }

  if (req.method === "POST" && isGroupCollection) {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      const name = (JSON.parse(body || "{}").group ?? {}).name;
      if (!name) return send(res, 422, { error: "RecordInvalid", description: "Name: cannot be blank" });
      // IDEMPOTENT BY NAME, like the real API's uniqueness constraint: the
      // setup script is meant to be safe to re-run, and a mock that happily
      // created a second "Finance Ops" would let a bug through that a real
      // account would reject.
      const existing = [...GROUPS.values()].find((g) => g.name === name);
      if (existing) return send(res, 422, { error: "RecordInvalid", description: "Name: has already been taken" });
      const group = { id: nextGroupId++, name, created_at: new Date().toISOString() };
      GROUPS.set(String(group.id), group);
      send(res, 201, { group });
    });
    return;
  }

  if (req.method === "POST" && isTicketCollection) {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      const fields = JSON.parse(body).ticket ?? {};
      const id = nextTicketId++;
      const ticket = {
        id,
        subject: fields.subject ?? "",
        // `body` OR `html_body`. A Zendesk comment carries one or the other,
        // and the portal's internal note is HTML — see buildTicketNote(). A
        // mock that only read `body` reported an empty description for every
        // ticket the portal raises, which is a fidelity gap that hides exactly
        // the field a reader checks first.
        description: (fields.comment && (fields.comment.body || fields.comment.html_body)) || "",
        status: "new",
        requester_id: 1,
        tags: fields.tags ?? [],
        custom_fields: fields.custom_fields ?? [],
        comments: fields.comment ? [fields.comment] : [],
        // ROUTING FIELDS, recorded rather than dropped. An escalation's whole
        // point is that it reaches a named team, and a mock that accepted
        // `group_id` and forgot it would let a test assert a ticket was
        // "created" while proving nothing about where it went — the same
        // fixture-agrees-with-the-code failure this repo keeps paying for.
        group_id: fields.group_id ?? null,
        priority: fields.priority ?? null,
        due_at: fields.due_at ?? null,
        external_id: fields.external_id ?? null,
      };
      TICKETS[String(id)] = ticket;
      send(res, 201, { ticket });
    });
    return;
  }

  if (req.method === "GET" && isTicketPath) {
    const ticket = findTicket(parts[3]);
    if (!ticket) return send(res, 404, { error: "RecordNotFound" });
    return send(res, 200, { ticket });
  }

  if (req.method === "PUT" && isTicketPath) {
    const ticket = findTicket(parts[3]);
    if (!ticket) return send(res, 404, { error: "RecordNotFound" });
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      const patch = JSON.parse(body).ticket ?? {};
      if (patch.status) ticket.status = patch.status;
      // rca-iih7 / D-30, corrected by rca-7txk. `tags` REPLACES the whole set;
      // `additional_tags` ADDS specific tags without touching the rest —
      // both confirmed live. `remove_tags` is deliberately NOT applied here:
      // verified live against a real ticket (#72), it is a no-op on the
      // single-ticket PUT (Zendesk documents it for the bulk `update_many`
      // endpoint only), and this mock previously implemented it as if it
      // worked — teaching every caller and every test the wrong shape while
      // production silently dropped the removal. restClient.js's
      // resolveWithLetter()/flagForReview() no longer send this field; they
      // resolve a removal by fetching the ticket's own current tags and
      // sending the filtered list back via `tags`, which this mock's `tags`
      // branch above already exercises correctly.
      if (patch.tags) ticket.tags = patch.tags;
      if (Array.isArray(patch.additional_tags)) {
        ticket.tags = [...new Set([...ticket.tags, ...patch.additional_tags])];
      }
      if (patch.comment) ticket.comments.push(patch.comment);
      send(res, 200, { ticket });
    });
    return;
  }

  send(res, 404, { error: "no_such_route", path: url.pathname });
}

function send(res, status, body) {
  res.statusCode = status;
  res.end(JSON.stringify(body));
}

export function startMockServer(port = 4014) {
  const server = createServer(handle);
  return new Promise((resolve) => {
    server.listen(port, () => resolve(server));
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  startMockServer().then(() => console.log("Mock Zendesk API listening on http://localhost:4014"));
}
