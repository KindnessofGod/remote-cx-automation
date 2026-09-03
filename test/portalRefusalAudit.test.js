// ---------------------------------------------------------------------------
// portalRefusalAudit.test.js  —  the portal's identity refusals are recorded
// ---------------------------------------------------------------------------
// THE DEFECT THIS SUITE PINS
// An admin filed a UC-02 expense through the portal. The adapter refused it,
// correctly, with 403 `persona_cannot_claim` — and because that refusal returns
// BEFORE handleExpenseSubmission() is ever called, nothing was written: no
// `audit_log` row, nothing in the Execution & Audit Trail viewer's live feed.
// The page still showed the requester a request reference. That reference named
// nothing in any table, on any surface, ever.
//
// So the assertion that matters is not "the admin is refused" — that already
// worked, and testing only that is the failure mode CLAUDE.md §3.30 records: a
// control that refuses correctly and a control that records nothing look
// identical from outside. It is "the refusal LEFT A ROW, and the reference the
// requester was shown finds it".
//
// AND THE OTHER HALF, which is a real assertion and not a formality: an
// incomplete form must leave NO row. A live feed full of "you left a box blank"
// trains its reader to stop reading it, and the reader is the only reason the
// feed exists. src/portal/refusalAudit.js's header carries the full split.
//
// HERMETIC. No socket and no network: the mock Remote is reached through
// createInProcessFetch() and every LLM seam is the real function forced down
// its deterministic branch, per CLAUDE.md §6. Nothing here needs a workflow to
// run at all — every request under test is refused before one could.
// ---------------------------------------------------------------------------

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  isAuditableRefusal,
  buildRefusalAuditEvent,
  recordIntakeRefusal,
  INTAKE_REFUSAL_ACTION,
  AUDITED_REFUSAL_STATUSES,
} from "../src/portal/refusalAudit.js";
import { createPortalHandler } from "../src/portal/server.js";
import { createInProcessFetch } from "../src/remote/mockServer.js";
import { RemoteClient } from "../src/remote/restClient.js";
import { AuditLogger } from "../src/shared/audit.js";
import { buildPortalStores } from "../src/portal/wiring.js";
import { PERSONAS } from "../src/portal/personas.js";

import { classifyExpenseRuleBased } from "../src/uc02/expenseClassifier.js";
import { classifyTravelInquiryRuleBased } from "../src/uc03/classifier.js";
import { parseRelocationRuleBased } from "../src/uc07/relocationParser.js";
import { parseInquiryRuleBased } from "../src/uc08/inquiryParser.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_SRC = readFileSync(join(__dirname, "..", "src", "portal", "server.js"), "utf8");

const LLM = {
  classifyExpense: classifyExpenseRuleBased,
  classifyTravel: classifyTravelInquiryRuleBased,
  parseRelocation: parseRelocationRuleBased,
  parseInquiry: parseInquiryRuleBased,
};

/** A logger that records where the test can see it, and still records for real. */
function countingAudit() {
  const rows = [];
  const audit = new AuditLogger();
  const original = audit.log.bind(audit);
  audit.log = (entry) => {
    rows.push(entry);
    return original(entry);
  };
  audit.rows = rows;
  return audit;
}

function portal({ audit = countingAudit() } = {}) {
  const remote = new RemoteClient({ baseUrl: "http://mock.remote.invalid", fetchImpl: createInProcessFetch() });
  return {
    handler: createPortalHandler({ remote, audit, stores: buildPortalStores(), llm: LLM }),
    audit,
  };
}

/** Same in-process driver every other server suite in this repo uses. */
function call(handler, { method = "POST", path, body = null, headers = {} }) {
  return new Promise((resolve, reject) => {
    const req = {
      method,
      url: path,
      headers,
      on(event, cb) {
        if (event === "data" && body) cb(Buffer.from(JSON.stringify(body)));
        if (event === "end") setImmediate(cb);
        return req;
      },
    };
    const res = {
      statusCode: 200,
      headers: {},
      setHeader(k, v) {
        this.headers[k.toLowerCase()] = v;
      },
      end(payload) {
        resolve({ status: this.statusCode, body: payload ? JSON.parse(String(payload)) : null });
      },
    };
    handler(req, res).catch(reject);
  });
}

const submit = (handler, type, body) => call(handler, { path: `/api/requests/${type}`, body });

const refusals = (audit) => audit.rows.filter((r) => r.action === INTAKE_REFUSAL_ACTION);

// ---------------------------------------------------------------------------
// 1. The bug itself, end to end
// ---------------------------------------------------------------------------

test("THE DEFECT: an admin filing a UC-02 expense is refused AND recorded, under the reference the page showed", async () => {
  const { handler, audit } = portal();
  // The shape the page actually sends: a generated reference travels with every
  // submission, and it is the string the requester is left holding.
  const reference = "uc02-20260819104528-11aomw";

  const res = await submit(handler, "uc02", {
    persona: "admin",
    expenseId: "exp_sandbox_clean_401",
    externalRef: reference,
  });

  // The refusal is unchanged — this ticket added a record, it did not soften a
  // control.
  assert.equal(res.status, 403);
  assert.equal(res.body.code, "persona_cannot_claim");

  const rows = refusals(audit);
  assert.equal(rows.length, 1, "an identity refusal must leave exactly one audit row");
  const row = rows[0];

  assert.equal(row.useCase, "UC-02");
  assert.equal(row.riskTier, "low", "the tier travels with the row, as on every other decision");
  // THE WHOLE POINT: the reference the requester was shown finds the row.
  assert.equal(row.details.externalRef, reference);
  // The searchable slug sits in the same slot every decision row uses, because
  // src/auditview/readStore.js selects `details->>'reason'` by name.
  assert.equal(row.details.reason, "persona_cannot_claim");
  assert.equal(row.details.refusalMessage, res.body.reason);
  assert.equal(row.details.refusalStatus, 403);
  assert.equal(row.details.source, "portal");
  assert.equal(row.details.typeId, "uc02");
});

test("the action name says it was stopped at INTAKE, not by a gate", async () => {
  const { handler, audit } = portal();
  await submit(handler, "uc02", { persona: "admin", expenseId: "exp_sandbox_clean_401" });

  const row = refusals(audit)[0];
  // A reader scanning the feed sees WHERE it stopped without opening the row.
  assert.equal(row.action, "portal_intake_refused");
  // ...and a query can filter on it without parsing the name.
  assert.equal(row.details.stage, "intake");
  assert.equal(row.details.refusedBeforeGates, true);
  // It must not be mistakable for something a policy engine concluded.
  for (const gateVerdict of ["auto_approve", "auto_resolve", "human_review", "escalate", "blocked"]) {
    assert.notEqual(row.action, gateVerdict);
  }
});

test("a resolved persona is recorded as the identity the SERVER holds, not the key the body sent", async () => {
  const { handler, audit } = portal();
  await submit(handler, "uc02", { persona: "admin", expenseId: "exp_sandbox_clean_401" });

  const row = refusals(audit)[0];
  // The admin's session is server-owned (src/portal/personas.js); the actor is
  // the same value uc04/workflow.js:246 would have recorded for this caller.
  assert.equal(row.actor, PERSONAS.admin.session.authenticatedAdminId);
  assert.notEqual(row.actor, "admin", "the persona KEY is not an identity");
  assert.equal(row.details.claimedPersona, "admin");
  assert.equal(row.details.claimedPersonaResolved, true);
});

// ---------------------------------------------------------------------------
// 2. An unauthenticated request invents no actor
// ---------------------------------------------------------------------------

test("an unauthenticated request is recorded with NO actor — the claimed key never reaches the actor column", async () => {
  const { handler, audit } = portal();
  const res = await submit(handler, "uc02", {
    persona: "definitely-not-a-persona",
    expenseId: "exp_sandbox_clean_401",
    externalRef: "uc02-unauth-0001",
  });

  assert.equal(res.status, 401);
  assert.equal(res.body.code, "unauthenticated");

  const rows = refusals(audit);
  assert.equal(rows.length, 1, "a 401 is a judgement about a caller and is recorded");
  const row = rows[0];

  // The one assertion this test exists for. Anyone can post any string as
  // `persona`; putting it in `actor` would turn an unauthenticated request into
  // an attributed one — prime directive #3, in the audit log rather than at a
  // gate.
  assert.equal(row.actor, "unauthenticated");
  assert.notEqual(row.actor, "definitely-not-a-persona");
  // It is kept, but only where it is labelled as what it is.
  assert.equal(row.details.claimedPersona, "definitely-not-a-persona");
  assert.equal(row.details.claimedPersonaResolved, false);
  assert.equal(row.details.externalRef, "uc02-unauth-0001");
});

test("a non-string persona cannot smuggle an object into the row", async () => {
  const { handler, audit } = portal();
  const res = await submit(handler, "uc02", {
    persona: { authenticatedEmploymentId: "someone-elses-id" },
    expenseId: "exp_sandbox_clean_401",
    // Same trick one field over: a reference that is not a string.
    externalRef: { toString: "not-a-ref" },
  });

  assert.equal(res.status, 401);
  const row = refusals(audit)[0];
  assert.equal(row.actor, "unauthenticated");
  assert.equal(row.details.claimedPersona, null);
  assert.equal(row.details.externalRef, null);
  assert.ok(!JSON.stringify(row).includes("someone-elses-id"));
});

// ---------------------------------------------------------------------------
// 3. What must NOT be recorded
// ---------------------------------------------------------------------------

test("a missing field writes NOTHING — an incomplete form is not a judgement about a record", async () => {
  const { handler, audit } = portal();
  const res = await submit(handler, "uc02", { persona: "chris", externalRef: "uc02-blank-0001" });

  assert.equal(res.status, 400);
  assert.equal(res.body.code, "expense_required");
  assert.equal(
    audit.rows.length,
    0,
    "a blank field must not reach the audit log — see refusalAudit.js's split and why the feed's signal-to-noise is the reason"
  );
});

test("every 400 the intake route can return is a missing-field refusal, and none of them is audited", async () => {
  const { handler, audit } = portal();
  const blanks = [
    ["uc02", { persona: "chris" }, "expense_required"],
    ["uc03", { persona: "chris" }, "text_required"],
    ["uc04", { persona: "admin" }, "employment_required"],
    ["uc04", { persona: "admin", employmentId: "emp_active_001" }, "destination_required"],
    // UC-05 is deliberately absent: it has no 400 site at all. Both of its
    // intake paths are optional (a pasted letter OR a proposed end date), so an
    // empty submission is a decision its workflow makes rather than a form the
    // adapter can reject. Sending one here would run that workflow — and its
    // LLM extractor with it — which is how this list first reached the network.
    ["uc07", {}, "text_required"],
    ["uc08", {}, "text_required"],
    ["uc09", { persona: "admin" }, "employment_required"],
    ["uc09", { persona: "admin", employmentId: "emp_active_001" }, "request_text_required"],
  ];
  for (const [type, body, code] of blanks) {
    const res = await submit(handler, type, body);
    assert.equal(res.status, 400, `${type}/${code} must be a 400`);
    assert.equal(res.body.code, code);
  }
  assert.equal(audit.rows.length, 0, "not one of the nine wrote a row");
});

test("the shared-key gate stays out of this — it refuses before a use case is even known", () => {
  // Not a test of behaviour (test/portalAccess.test.js already pins that the
  // key gate writes nothing) but of where the recording was PUT: below the
  // route match, so there is always a request type to attribute a row to.
  // Placing it above would have forced a row with no use case and no tier.
  // Matched by REGEX, not by the exact call text. This asserted a literal
  // `checkPortalAccess(req, access)` and broke the day the gate gained a
  // brute-force ceiling and became `await checkPortalAccessThrottled(...)` —
  // reporting a failure about refusal-recorder ORDERING, which had not moved
  // and was not what changed. A structural test should pin the structure it
  // names; pinning the spelling as well makes it fire on edits it has no
  // opinion about, and a test that cries wolf gets its assertion deleted
  // rather than its matcher fixed.
  const gateAt = SERVER_SRC.search(/const verdict = (await )?checkPortalAccess\w*\(req, access/);
  const recordAt = SERVER_SRC.indexOf("recordIntakeRefusal({");
  assert.ok(gateAt > 0 && recordAt > 0);
  assert.ok(recordAt > gateAt, "the refusal recorder must sit below the access gate, not around it");
});

// ---------------------------------------------------------------------------
// 4. Every identity refusal site, not just UC-02's
// ---------------------------------------------------------------------------
// The recording is written ONCE, in the route, rather than at each of the ten
// refusal sites. This is the assertion that the once actually covers them all —
// otherwise "one place, not eighteen" is a claim about the code's shape rather
// than about its behaviour.

test("all five 403 persona refusals are recorded, each under its own use case and tier", async () => {
  const cases = [
    ["uc02", { persona: "admin", expenseId: "exp_sandbox_clean_401" }, "UC-02", "low", "persona_cannot_claim"],
    ["uc03", { persona: "admin", text: "Can I work from Spain for a fortnight?" }, "UC-03", "low", "persona_cannot_ask"],
    [
      // UC-04'S 403 CHANGED SHAPE ON 2026-08-30, and it is still a 403 about
      // identity — which is what this test is really asserting is recorded.
      // The refusal used to be "an employee may not file one of these at all",
      // which was the portal restating a defect in the identity gate (see
      // test/uc04SubmissionIdentity.test.js). An employee may now file about
      // their own trip; filing about SOMEBODY ELSE'S employment is the refusal
      // that survived, and it is the one worth auditing, because it is an
      // attempt to act on another person's record.
      "uc04",
      { persona: "chris", employmentId: "emp_active_001", destinationCountry: "ES" },
      "UC-04",
      "medium",
      "not_your_employment",
    ],
    ["uc05", { persona: "admin", text: "I am resigning on 30 September 2026." }, "UC-05", "medium", "persona_cannot_resign"],
    [
      "uc09",
      { persona: "chris", employmentId: "emp_active_001", requestText: "Please pay a $1,000 bonus." },
      "UC-09",
      "high",
      "persona_cannot_request",
    ],
  ];

  for (const [type, body, useCase, tier, code] of cases) {
    const { handler, audit } = portal();
    const ref = `${type}-403-ref`;
    const res = await submit(handler, type, { ...body, externalRef: ref });
    assert.equal(res.status, 403, `${type} must refuse this persona`);
    assert.equal(res.body.code, code);

    const rows = refusals(audit);
    assert.equal(rows.length, 1, `${type}'s refusal must leave one row`);
    assert.equal(rows[0].useCase, useCase);
    assert.equal(rows[0].riskTier, tier);
    assert.equal(rows[0].details.reason, code);
    assert.equal(rows[0].details.externalRef, ref);
  }
});

test("all five 401 sites are recorded — an unknown key is refused by every adapter that takes a persona", async () => {
  for (const type of ["uc02", "uc03", "uc04", "uc05", "uc09"]) {
    const { handler, audit } = portal();
    const res = await submit(handler, type, { persona: "nobody", text: "x", expenseId: "x", employmentId: "x" });
    assert.equal(res.status, 401, `${type} must fail closed on an unknown persona`);
    const rows = refusals(audit);
    assert.equal(rows.length, 1, `${type}'s 401 must leave one row`);
    assert.equal(rows[0].actor, "unauthenticated");
    assert.equal(rows[0].details.reason, "unauthenticated");
  }
});

// ---------------------------------------------------------------------------
// 5. The audit write may never break the refusal
// ---------------------------------------------------------------------------

test("a logger that throws does NOT swallow the refusal — and the swallow itself is not silent", async () => {
  const errors = [];
  const originalError = console.error;
  console.error = (msg) => errors.push(String(msg));
  try {
    const audit = new AuditLogger();
    audit.log = () => {
      throw new Error("audit sink unreachable");
    };
    const { handler } = portal({ audit });

    const res = await submit(handler, "uc02", { persona: "admin", expenseId: "exp_sandbox_clean_401" });

    // The caller still gets their answer. Turning a 403 into a 500 because a
    // logger was down would convert a working control into an outage.
    assert.equal(res.status, 403);
    assert.equal(res.body.code, "persona_cannot_claim");
  } finally {
    console.error = originalError;
  }

  // A dropped audit row is a hole in an append-only log, so it has to be
  // findable afterwards. Silence here would be the worse defect of the two.
  assert.equal(errors.length, 1);
  assert.match(errors[0], /failed to audit UC-02 intake refusal "persona_cannot_claim"/);
  assert.match(errors[0], /audit sink unreachable/);
});

test("an asynchronous logger failure is reported too, rather than becoming an unhandled rejection", async () => {
  const errors = [];
  const originalError = console.error;
  console.error = (msg) => errors.push(String(msg));
  try {
    const audit = new AuditLogger();
    audit.log = async () => {
      throw new Error("insert timed out");
    };
    const { handler } = portal({ audit });
    const res = await submit(handler, "uc02", { persona: "admin", expenseId: "exp_sandbox_clean_401" });
    assert.equal(res.status, 403);
    // Let the rejection settle before restoring the spy.
    await new Promise((resolve) => setImmediate(resolve));
  } finally {
    console.error = originalError;
  }
  assert.equal(errors.length, 1);
  assert.match(errors[0], /insert timed out/);
});

// ---------------------------------------------------------------------------
// 6. The rule, in isolation
// ---------------------------------------------------------------------------

test("the rule selects on the status, so a refusal added later lands on the right side by itself", () => {
  assert.deepEqual([...AUDITED_REFUSAL_STATUSES].sort(), [401, 403]);
  assert.equal(isAuditableRefusal({ ok: false, status: 401, code: "unauthenticated" }), true);
  assert.equal(isAuditableRefusal({ ok: false, status: 403, code: "persona_cannot_claim" }), true);
  assert.equal(isAuditableRefusal({ ok: false, status: 400, code: "expense_required" }), false);
  assert.equal(isAuditableRefusal({ ok: false, status: 404, code: "unknown_request_type" }), false);
  // A successful outcome is not a refusal, whatever else it carries.
  assert.equal(isAuditableRefusal({ ok: true, envelope: {} }), false);
  assert.equal(isAuditableRefusal(null), false);
});

test("buildRefusalAuditEvent is pure and returns null for anything it does not audit", () => {
  const type = { id: "uc02", useCase: "UC-02", tier: "low" };
  assert.equal(
    buildRefusalAuditEvent({ type, refusal: { ok: false, status: 400, code: "expense_required" }, body: {} }),
    null
  );
  const event = buildRefusalAuditEvent({
    type,
    refusal: { ok: false, status: 403, code: "persona_cannot_claim", reason: "…" },
    body: { externalRef: "r-1", persona: "admin" },
    persona: PERSONAS.admin,
  });
  // Exactly the keys src/shared/audit.js's log() documents — no parallel shape.
  assert.deepEqual(Object.keys(event).sort(), ["action", "actor", "details", "riskTier", "useCase"]);
});

test("a claimed persona key is bounded — it is diagnostic, and the body is caller-supplied", () => {
  const event = buildRefusalAuditEvent({
    type: { id: "uc02", useCase: "UC-02", tier: "low" },
    refusal: { ok: false, status: 401, code: "unauthenticated" },
    body: { persona: "z".repeat(5000) },
  });
  assert.equal(event.details.claimedPersona.length, 120);
});

test("recordIntakeRefusal writes nothing when there is no logger to write to", () => {
  const out = recordIntakeRefusal({
    audit: null,
    type: { id: "uc02", useCase: "UC-02", tier: "low" },
    refusal: { ok: false, status: 403, code: "persona_cannot_claim" },
    body: {},
    persona: PERSONAS.admin,
  });
  assert.equal(out, null);
});

// ---------------------------------------------------------------------------
// 7. Drift guard on the split
// ---------------------------------------------------------------------------

test("every refusal site in the intake route is classified, and the 400s are all missing-field checks", () => {
  const sites = [...SERVER_SRC.matchAll(/refusal\((\d{3}),\s*"([a-z0-9_]+)"/g)].map((m) => ({
    status: Number(m[1]),
    code: m[2],
  }));
  assert.ok(sites.length >= 13, "the intake route's refusal sites must be findable in the source");

  for (const site of sites) {
    assert.ok(
      [400, 401, 403].includes(site.status),
      `refusal "${site.code}" uses status ${site.status}, which refusalAudit.js's rule has never been asked about — decide which side it belongs on before shipping it`
    );
    assert.equal(
      isAuditableRefusal({ ok: false, ...site }),
      site.status !== 400,
      `"${site.code}" is classified against its own status`
    );
  }

  // The 400s are the reason the split is defensible: every one of them is a
  // blank field, not a judgement. A 400 that is NOT a missing-field check would
  // break that argument and should be re-read against refusalAudit.js's header
  // rather than silently inherit "not audited".
  for (const site of sites.filter((s) => s.status === 400)) {
    assert.match(
      site.code,
      /_required$/,
      `400 "${site.code}" is not a missing-field refusal — refusalAudit.js's split assumes every 400 here is one`
    );
  }
});

// ---------------------------------------------------------------------------
// The ORDERING, which is what makes the sentence in server.js true
// ---------------------------------------------------------------------------
// A decision is durable BEFORE the caller hears it. That is the ordering
// src/uc01/workflow.js's STEP 7/STEP 8 exists to guarantee, and a refusal is a
// decision, so it is bound by the same rule.
//
// This was fire-and-forget when it first landed, which passes every assertion
// above: on a long-lived process the promise settles a microtask later and the
// row is there by the time anything looks. On the DEPLOYMENT it is lossy — the
// platform may freeze the invocation the moment the response is written — so
// the refusals would go missing in production and nowhere else, which is the
// worst possible place for the difference to show up.
//
// A test that only checks "the row exists afterwards" cannot tell those two
// implementations apart. This one holds the logger open and asserts the
// response has NOT been sent, which fails against fire-and-forget and passes
// against the await.
// ---------------------------------------------------------------------------
test("the refusal row is durable BEFORE the caller is answered, not after", async () => {
  let release;
  const held = new Promise((resolve) => {
    release = resolve;
  });

  const audit = new AuditLogger();
  const logged = [];
  audit.log = (entry) => {
    logged.push(entry);
    // A logger that has accepted the row but not yet finished writing it —
    // which is every real logger, and the state the ordering is about.
    return held;
  };

  const remote = new RemoteClient({ baseUrl: "http://mock.remote.invalid", fetchImpl: createInProcessFetch() });
  const handler = createPortalHandler({ remote, audit, stores: buildPortalStores(), llm: LLM });

  let answered = false;
  const inFlight = call(handler, {
    path: "/api/requests/uc02",
    body: { persona: "admin", expenseId: "exp_sandbox_clean_401", externalRef: "uc02-ordering-proof" },
  }).then((res) => {
    answered = true;
    return res;
  });

  // Enough turns of the loop that a fire-and-forget implementation would have
  // answered several times over. `setImmediate` runs after promise microtasks,
  // so this is not a race the await could lose.
  for (let i = 0; i < 5; i += 1) await new Promise((r) => setImmediate(r));

  assert.equal(logged.length, 1, "the refusal must have been handed to the logger");
  assert.equal(answered, false, "the caller was answered before the refusal was durable");

  release(null);
  const res = await inFlight;
  assert.equal(res.status, 403, "and the refusal itself is unchanged");
});

// A logger that fails must not turn a 403 into a 500 — the await buys ordering,
// and it must not cost the control it is recording. The opposite failure of the
// one above, and the reason recordIntakeRefusal() returns the HANDLED promise
// rather than the original: awaiting a promise that still rejects would take
// the process down on exactly the failure the swallow exists to absorb.
test("a logger that rejects still leaves the caller with their 403", async () => {
  const audit = new AuditLogger();
  audit.log = () => Promise.reject(new Error("audit_log unreachable"));

  const remote = new RemoteClient({ baseUrl: "http://mock.remote.invalid", fetchImpl: createInProcessFetch() });
  const handler = createPortalHandler({ remote, audit, stores: buildPortalStores(), llm: LLM });

  const res = await call(handler, {
    path: "/api/requests/uc02",
    body: { persona: "admin", expenseId: "exp_sandbox_clean_401", externalRef: "uc02-logger-down" },
  });

  assert.equal(res.status, 403);
  assert.equal(res.body.code, "persona_cannot_claim");
});

// ---------------------------------------------------------------------------
// The hand-off failure row carries the reference too
// ---------------------------------------------------------------------------
// `portal_ticket_creation_failed` is written when the decision is durable and
// the Zendesk hand-off then failed — so the request needs a human and no human
// will ever see it. Measured live on 2026-08-19 it carried no `externalRef`, so
// the requester holding that reference could not find the row telling them
// their request had been dropped. Of every row this system writes, it is the
// one it is least acceptable to be unable to find.
// ---------------------------------------------------------------------------
test("the Zendesk hand-off failure row is findable by the reference the requester holds", async () => {
  const audit = countingAudit();
  const remote = new RemoteClient({ baseUrl: "http://mock.remote.invalid", fetchImpl: createInProcessFetch() });
  const handler = createPortalHandler({
    remote,
    audit,
    stores: buildPortalStores(),
    llm: LLM,
    // A Zendesk that refuses exactly the way the live one did — the reserved
    // TLD 422 that made every portal hand-off fail silently for the life of
    // the surface.
    zendesk: {
      createTicket: async () => {
        throw new Error("422 — requester email is not a valid address");
      },
    },
    employmentIdFieldId: "1",
  });

  const reference = "uc02-handoff-failure-proof";
  const res = await submit(handler, "uc02", {
    persona: "chris",
    expenseId: "exp_sandbox_over_cap_402",
    externalRef: reference,
  });

  // The decision survives the hand-off failure — that ordering is the whole
  // reason the audit row is written before Zendesk is called.
  assert.equal(res.status, 200);
  assert.equal(res.body.ticketCreated, false);

  const failures = audit.rows.filter((r) => r.action === "portal_ticket_creation_failed");
  assert.equal(failures.length, 1, "the dropped hand-off must be recorded");
  assert.equal(
    failures[0].details.externalRef,
    reference,
    "the row saying a request fell on the floor must be findable by that request's reference"
  );
  assert.equal(failures[0].details.source, "portal");
});
