/**
 * THE MANAGER DECIDING HAD LESS IN FRONT OF THEM THAN THE SPECIALIST REVIEWING
 * THEM AFTERWARDS.
 *
 * `/remoteui` is where the CUSTOMER'S OWN MANAGER approves or declines, and
 * theirs is the only work-authorization decision Remote's API accepts
 * (`UC-04.md` §1a). Until now that manager decided from a destination, two
 * dates and a duty category — while the ZAF sidebar, which records their
 * decision after the fact, showed the four questions Remote's own RWA form
 * asks and the traveller's answers to them.
 *
 * AND REMOTE ASKS FOR THE FACT TWICE. Help Center article `20094378700557`: at
 * approval the admin must *"use the additional information section to provide
 * specific details about the activities the employee is expected to perform
 * during the travel."* So the employer's version is the one that reaches the
 * record Remote acts on, and an empty box at that moment is how the second
 * capture becomes a paraphrase of nothing.
 *
 * The field is not new — `employer_special_instructions` is Remote's own, has
 * been on this form since it shipped, and is already persisted and read back.
 * What is new is that it starts from the employee's answers instead of blank.
 *
 * THREE PROPERTIES:
 *   1. ONE COMPUTATION. The prefill and the sidebar are the same four answers
 *      through the same module, so the screen that decides and the screen that
 *      reviews cannot word one trip differently.
 *   2. STILL THE EMPLOYER'S WORDS. Editable, labelled as theirs, and what they
 *      submit is recorded as the company's statement — never merged into the
 *      employee's claim.
 *   3. THE STRING IS THE SERVER'S. This file is asserted never to author a fact
 *      the server owns; the browser renders `statementPrefill`, it does not
 *      compose it.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { activityProfileOf } from "../src/remoteui/workAuthRecords.js";
import {
  ACTIVITY_QUESTIONS,
  ACTIVITY_FIELD_MAX_CHARS,
  normalizeActivityProfile,
  describeActivityProfile,
  activityStatementPrefill,
} from "../src/uc04/activityProfile.js";

const client = readFileSync(new URL("../src/remoteui/assets/workauth.js", import.meta.url), "utf8");

const SAID = {
  activitiesToBePerformed: "Design reviews with the Amsterdam team; one client workshop",
  institutionsVisited: "Acme BV, Amsterdam",
  specialWorksite: "none",
  workLocation: "Acme BV office",
};
const rowWith = (activityProfile) => ({ factors: { activityProfile } });

// ---------------------------------------------------------------------------
// 1. One computation, shared with the sidebar
// ---------------------------------------------------------------------------

test("the employer screen and the specialist sidebar read the same four answers", () => {
  const employer = activityProfileOf(rowWith(SAID));
  const sidebar = describeActivityProfile(normalizeActivityProfile(SAID));

  // Not "equivalent" — the SAME fields, from the same module. A second
  // composition would be a second place for one trip to be worded differently
  // on the two screens, and one of them is reviewing the other.
  assert.deepEqual(employer.fields, sidebar.fields);
  assert.equal(employer.finding, sidebar.finding);
  assert.equal(employer.asked, true);
});

test("the prefill is composed server-side from those same answers", () => {
  const employer = activityProfileOf(rowWith(SAID));
  assert.equal(employer.statementPrefill, activityStatementPrefill(normalizeActivityProfile(SAID)));
  for (const value of Object.values(SAID)) {
    assert.ok(employer.statementPrefill.includes(value), `"${value}" is missing from the employer's prefill`);
  }
});

test("a request that never asked the question gets no prefill and no block", () => {
  // Only `uc04_authorizations` rows carry `factors`. A request read from Remote
  // or from the stand-in never asked, and "filed somewhere that does not ask"
  // is not the same claim as "the traveller answered nothing".
  for (const row of [undefined, null, {}, { factors: {} }, rowWith(undefined)]) {
    const profile = activityProfileOf(row);
    assert.equal(profile.asked, false, JSON.stringify(row));
    assert.equal(profile.statementPrefill, null, JSON.stringify(row));
  }
  // AND null, NEVER "". An empty string in a textarea is indistinguishable
  // from a box somebody cleared on purpose.
  assert.notEqual(activityProfileOf({}).statementPrefill, "");
});

// ---------------------------------------------------------------------------
// 2. Still the employer's words
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// 2. Still the employer's words — DRIVEN, not read
// ---------------------------------------------------------------------------
//
// EVERY CLIENT ASSERTION BELOW DRIVES THE REAL `workauth.js` IN A FAKE DOM,
// and the first version of this file did not. It regex-matched the source, and
// it passed while the prefilled box sat inside a COLLAPSED `<details>` with the
// Approve button outside it — so a manager could file the employee's four
// answers as their company's independent statement in one click, having never
// seen the box, its label or the sentence saying whose words were in it. Every
// safeguard the source contained was one click away from the button that fired
// it, and a source-reading test cannot see that. `assert.match(client,
// /instructions\.input\.value = prefill/)` is satisfied by both the safe layout
// and the dangerous one.

import vm from "node:vm";
import { AuthorizationStore } from "../src/uc04/authorizationStore.js";
import { AuditLogger } from "../src/shared/audit.js";
import { createRemoteUiHandler } from "../src/remoteui/server.js";
import { createInProcessFetch } from "../src/remote/mockServer.js";
import { RemoteClient } from "../src/remote/restClient.js";
import { AmendmentStore } from "../src/uc06/amendmentStore.js";
import { createWorkAuthorizationStandin } from "../src/remoteui/workAuthStandin.js";

// The same employment `test/remoteuiWorkAuthRecords.test.js` seeds against, so
// the scope resolver can actually read a company back for it.
const CHRIS_LEE = "8ab12460-b568-4c1e-af9d-09b1fabd8f46";

const ASSET = new URL("../src/remoteui/assets/workauth.js", import.meta.url);
const SOURCE = readFileSync(ASSET, "utf8");
// Every id the page owns — taken from workauth.html rather than guessed, since
// a missing shell node makes the bundle bail before it renders a single row.
const SHELL_IDS = [
  "stages", "next-stage", "queue", "queue-message", "queue-scope", "queue-count",
  "queue-title", "live-note", "reload", "probe", "exclusions", "explainer", "announce",
];

function createNode(tagName) {
  return {
    tagName,
    className: "",
    childNodes: [],
    listeners: {},
    attributes: {},
    style: {},
    hidden: false,
    disabled: false,
    value: "",
    textContent: "",
    appendChild(child) { this.childNodes.push(child); return child; },
    removeChild(child) { this.childNodes = this.childNodes.filter((n) => n !== child); },
    setAttribute(k, v) { this.attributes[k] = String(v); },
    getAttribute(k) { return this.attributes[k] ?? null; },
    addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); },
    focus() {},
    get firstChild() { return this.childNodes[0] || null; },
  };
}
const textOf = (node) => {
  if (!node) return "";
  const own = node.textContent || "";
  return [own, ...node.childNodes.map(textOf)].filter(Boolean).join(" ");
};
const collect = (node, predicate, found = []) => {
  if (!node) return found;
  if (predicate(node)) found.push(node);
  node.childNodes.forEach((child) => collect(child, predicate, found));
  return found;
};
const click = (node) => (node.listeners.click || []).forEach((fn) => fn({ preventDefault() {} }));
const typeInto = (input, text) => {
  input.value = text;
  (input.listeners.input || []).forEach((fn) => fn({}));
};
const blur = (input) => (input.listeners.blur || []).forEach((fn) => fn({}));

/** Seed one uc04_authorizations row the employer screen will show. */
function seed(activityProfile) {
  const store = new AuthorizationStore();
  const audit = new AuditLogger();
  const row = store.createAuthorization({
    employmentId: CHRIS_LEE,
    requester: "co_admin_01",
    factors: {
      homeCountry: "US", nationality: "US", destination: { country: "PT" },
      startDate: "2026-12-01", endDate: "2026-12-10", visaType: "none",
      jobDuties: "Software engineering", hasContractSigningAuthority: false,
      activityProfile,
    },
    risk: { level: "low" },
    tripDays: 8, cumulativeDays: null,
    decision: "ready_for_approval", reason: "all_gates_passed", flags: [],
    summary: "Eight days in Portugal.",
    externalRef: "4242", source: "portal",
  });
  return { store, audit, row };
}

async function drivePage({ store, audit, notes = [] }) {
  const client = new RemoteClient({ baseUrl: "http://mock.remote.invalid", fetchImpl: createInProcessFetch() });
  const handler = createRemoteUiHandler({
    remote: client,
    remoteWorkAuth: client,
    audit,
    amendmentStore: new AmendmentStore(),
    /* THE REAL INTERFACE, NOT A PLAUSIBLE ONE. The first stub offered
       `addInternalNote`, which `handOffToMobility()` never calls — so every
       hand-off failed and the run recorded
       `work_authorization_employer_handoff_failed` while the decision itself
       looked fine. A stub that answers the wrong method is a test that proves
       the happy path was never taken. The ticket route is `flagForReview` when
       the record already names a ticket, `createTicket` when it does not; the
       seeded row's externalRef is numeric, so this run takes the first. */
    zendesk: {
      async flagForReview(ticketId, { note } = {}) { notes.push({ ticketId, body: note }); return { ok: true }; },
      async createTicket({ comment } = {}) { notes.push({ ticketId: null, body: comment?.body }); return { id: 9001 }; },
      async updateTicket() { return { ok: true }; },
    },
    employees: [],
    employmentIdFieldId: "1",
    workAuthStandin: createWorkAuthorizationStandin(),
    authorizationStore: store,
  });
  const nodes = {};
  SHELL_IDS.forEach((id) => { nodes[id] = createNode("div"); });
  const pending = new Set();
  const intervals = [];
  const bodies = [];
  const document = {
    readyState: "complete", hidden: false,
    getElementById: (id) => nodes[id] || null,
    createElement: createNode,
    listeners: {},
    addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); },
  };
  const context = {
    document, console, JSON, Promise, String, Number, Boolean, Object, Array, Date, Math,
    RegExp, encodeURIComponent, setTimeout,
    fetch: (url, init) => {
      const options = init || {};
      if (options.body) bodies.push({ url: String(url), body: JSON.parse(options.body) });
      const work = (async () => {
        const path = String(url).indexOf("/") === 0 ? String(url) : "/" + String(url);
        const res = { code: 200, payload: null, setHeader() {}, writeHead(c) { this.code = c; }, end(b) { this.payload = b; } };
        await handler(
          { method: options.method || "GET", url: path, headers: { "x-remoteui-session": "admin" },
            on(evt, fn) { if (evt === "data" && options.body) fn(Buffer.from(options.body)); if (evt === "end") fn(); } },
          res
        );
        return { status: res.code, ok: res.code < 400, json: async () => JSON.parse(res.payload) };
      })();
      pending.add(work);
      work.then(() => pending.delete(work), () => pending.delete(work));
      return work;
    },
  };
  context.window = {
    document,
    sessionStorage: { getItem: () => "", setItem: () => {} },
    setInterval: (fn) => { intervals.push(fn); return intervals.length; },
    clearInterval: () => {},
  };
  vm.createContext(context);
  new vm.Script(SOURCE, { filename: "workauth.js" }).runInContext(context);
  const settle = async () => {
    let idle = 0;
    for (let i = 0; i < 2000 && idle < 3; i += 1) {
      await new Promise((r) => setImmediate(r));
      idle = pending.size === 0 ? idle + 1 : 0;
    }
  };
  await settle();
  const rows = () => nodes.queue.childNodes.filter((n) => n.tagName === "li");
  return {
    nodes, bodies, rows, settle, notes,
    tick: async () => { intervals.forEach((fn) => fn()); await settle(); },
    reload: async () => { click(nodes.reload); await settle(); },
    textarea: () => collect(rows()[0], (n) => n.tagName === "textarea" && String(n.id).indexOf("wa-instructions") === 0)[0],
    approveButton: () => collect(rows()[0], (n) => n.tagName === "button" && n.textContent === "Approve")[0],
    declineButton: () => collect(rows()[0], (n) => n.tagName === "button" && n.textContent === "Decline")[0],
    confirmButton: () => collect(rows()[0], (n) => n.tagName === "button" && n.textContent === "Confirm decline")[0],
    reasonBox: () => collect(rows()[0], (n) => n.tagName === "textarea" && String(n.id).indexOf("wa-reason") === 0)[0],
    details: () => collect(rows()[0], (n) => n.tagName === "details")[0],
  };
}

test("the box, its label and its notice are NOT hidden behind the collapsed disclosure", async () => {
  /* THE DEFECT THIS EXISTS FOR. The field was appended into `<details>`, which
     is closed by default; Approve was appended to the row and is not. So the
     safeguards — an editable box, a label naming whose words are in it, a
     sentence saying that submitting adopts them — were all one click away from
     the button that fires the decision, and nothing asked the manager to take
     that click. A control whose safeguards are behind a disclosure has no
     safeguards. */
  const page = await drivePage(seed(SAID));
  const box = page.textarea();
  const details = page.details();
  assert.ok(box, "no instructions box rendered");
  assert.ok(details, "the Full request disclosure vanished");

  const hidden = collect(details, (n) => n === box).length > 0;
  assert.equal(hidden, false, "the prefilled box is behind the collapsed Full request disclosure");
  assert.equal(details.getAttribute("open"), null, "the disclosure is meant to stay collapsed");

  // The notice and the label are beside the box, in the open.
  const openText = textOf(page.rows()[0]).replace(textOf(details), "");
  assert.match(openText, /recorded as the company's statement about the trip, not as theirs/);
  assert.match(openText, /The activities this employee is expected to perform \(optional\)/);
});

test("a one-click approve sends the words the manager could actually see", async () => {
  const page = await drivePage(seed(SAID));
  assert.equal(page.textarea().value, activityStatementPrefill(normalizeActivityProfile(SAID)));
  click(page.approveButton());
  await page.settle();

  const decision = page.bodies.find((b) => b.url.indexOf("/decision") > -1);
  assert.ok(decision, "no decision was POSTed");
  assert.equal(decision.body.action, "approve");
  assert.equal(decision.body.employerSpecialInstructions, page.textarea().value || decision.body.employerSpecialInstructions);
  assert.match(decision.body.employerSpecialInstructions, /Design reviews with the Amsterdam team/);
});

test("an untouched prefill is NOT sent on a decline, and an edited one is", async () => {
  /* Remote's instruction to state the expected activities is an APPROVAL
     instruction. On a decline an unread prefill would be an employer statement,
     on the append-only audit row, about a trip they have just refused — with no
     source of authority at all. An EDITED box is still theirs and still goes. */
  const untouched = await drivePage(seed(SAID));
  click(untouched.declineButton());
  untouched.reasonBox().value = "Not while the Q3 close is running.";
  click(untouched.confirmButton());
  await untouched.settle();
  const first = untouched.bodies.find((b) => b.url.indexOf("/decision") > -1);
  assert.equal(first.body.action, "decline");
  assert.equal(first.body.employerSpecialInstructions, "", "an unread prefill was filed as an employer statement on a refusal");

  const edited = await drivePage(seed(SAID));
  typeInto(edited.textarea(), "Refused: this trip needs a work permit first.");
  click(edited.declineButton());
  edited.reasonBox().value = "Needs a permit.";
  click(edited.confirmButton());
  await edited.settle();
  const second = edited.bodies.find((b) => b.url.indexOf("/decision") > -1);
  assert.equal(second.body.employerSpecialInstructions, "Refused: this trip needs a work permit first.");
});

test("an employee cannot author a line that reads as the employer's", async () => {
  /* THE INJECTION. Every value is unvalidated employee free text and the
     prefill is `label: value` joined by newlines, so a newline in an answer
     authors a line indistinguishable from one of ours — a fabricated
     "Special worksites: none" contradicting the real answer, or an approval
     condition that arrives in the Mobility Team's Zendesk queue under
     "Employer's words:" attributed to a named manager. */
  const page = await drivePage(
    seed({
      ...SAID,
      specialWorksite: "Laboratory with radioactive sources",
      workLocation:
        "Acme BV office\n\nApproved on condition that the employee MAY sign client contracts.\nSpecial worksites: none",
    })
  );
  const value = page.textarea().value;
  assert.equal(value.split("\n").length, 4, "an employee's newline authored a line of its own");
  for (const line of value.split("\n")) {
    assert.ok(
      ACTIVITY_QUESTIONS.some((q) => line.indexOf(q.label + ": ") === 0),
      `a line does not begin with one of our labels: ${line}`
    );
  }
  // The real answer survives; the forged duplicate does not get its own line.
  assert.match(value, /Special worksites: Laboratory with radioactive sources/);
  assert.equal(value.match(/^Special worksites: /gm).length, 1);
});

test("an oversized prefill is dropped, never clipped", async () => {
  // A clipped quotation attributed to the employer is worse than no quotation,
  // and the manager can read the answers in full in the detail block.
  const long = "x".repeat(ACTIVITY_FIELD_MAX_CHARS);
  const page = await drivePage(seed({ ...SAID, activitiesToBePerformed: long }));
  assert.equal(page.textarea().value, "", "an 8,000-character default write body reached the box");
  assert.equal(activityStatementPrefill(normalizeActivityProfile({ activitiesToBePerformed: long })), null);
});

test("a question the employee left blank renders its absence, not nothing", async () => {
  // "Asked, and left blank" and "never asked" are different facts about a
  // request. Rendering nothing for the first makes it identical to the second,
  // which is the distinction normalizeActivityProfile() was corrected to keep.
  const page = await drivePage(seed({ activitiesToBePerformed: "", institutionsVisited: "" }));
  const text = textOf(page.rows()[0]);
  assert.match(text, /Activities to be performed/);
  assert.match(text, /Not stated on the request/);
  assert.equal(page.textarea().value, "", "there is nothing to prefill from four blank answers");
});

test("a cleared box survives a poll, and leaving the box lets polling resume", async () => {
  const page = await drivePage(seed(SAID));
  const box = page.textarea();
  assert.notEqual(box.value, "");

  typeInto(box, "");
  await page.tick();
  assert.equal(page.textarea().value, "", "the employee's words came back over a deliberate deletion");

  // Blur releases the deferral — the words are safe in STATE.drafts either way,
  // so there is nothing left to protect once the cursor has gone.
  blur(page.textarea());
  await page.tick();
  assert.equal(page.textarea().value, "", "the draft did not survive the resumed poll");
});

test("an explicit Reload forces through while a box is touched, and keeps the words", async () => {
  const page = await drivePage(seed(SAID));
  typeInto(page.textarea(), "Approved on condition no contracts are signed.");
  assert.match(textOf(page.nodes["live-note"]), /Paused while you have unsent words/);
  await page.reload();
  assert.equal(page.textarea().value, "Approved on condition no contracts are signed.");
});

// ---------------------------------------------------------------------------
// 3. The string is the server's
// ---------------------------------------------------------------------------

test("the browser renders the prefill and the notice, and composes neither", () => {
  const client = readFileSync(ASSET, "utf8");
  assert.match(client, /activityBlock && activityBlock\.statementPrefill/);
  assert.match(client, /activityBlock && activityBlock\.statementNotice/);
  // Every question label comes off `field.label`; none is written here. Read
  // from the module rather than hard-coded, so renaming a label cannot silently
  // stop this guarding.
  for (const question of ACTIVITY_QUESTIONS) {
    assert.ok(!client.includes(question.label), `the client is authoring the label "${question.label}"`);
  }
  assert.match(client, /definition\(dl, field\.label, field\.value \|\| field\.absence\)/);
});

// ---------------------------------------------------------------------------
// 4. Where the words END UP — the chain that made the layout defect dangerous
// ---------------------------------------------------------------------------

test("what the employer submits is carried downstream AS THE EMPLOYER'S, all the way", async () => {
  /* NOTHING FOLLOWED THE PREFILL PAST THE POST UNTIL NOW, and that omission is
     why the collapsed-disclosure defect was able to look harmless. The danger
     was never the textarea — it was the four layers after it, each of which
     relabels the text as the manager's:

       audit_log.details.employerSpecialInstructions
         -> uc04_authorizations.approval_note
           -> settledFacts()'s "Note left", beside "Approved by <a named human>"
             -> the Zendesk hand-off's "Employer's words:" line

     A one-click approve over an untouched prefill therefore published the
     TRAVELLER'S OWN CLAIM to the mobility specialist as an independent second
     statement. This test drives an EDITED box, so every link in that chain is
     asserted carrying words the manager actually wrote. */
  const notes = [];
  const seeded = seed(SAID);
  const page = await drivePage({ ...seeded, notes });

  const STATED = "Design reviews only. The client workshop is withdrawn. No contracts to be signed.";
  typeInto(page.textarea(), STATED);
  click(page.approveButton());
  await page.settle();

  // 1. The wire.
  const decision = page.bodies.find((b) => b.url.indexOf("/decision") > -1);
  assert.equal(decision.body.employerSpecialInstructions, STATED);

  // 2. The append-only row, which is the record of WHO SAID IT.
  /* MATCHED ON THE TWO DECISION ACTIONS, not on the family prefix. There are
     five `work_authorization_employer_*` actions and three of them are FAILURE
     records (`_write_failed`, `_record_not_updated`, `_handoff_failed`); a
     prefix match counts those as decisions and would go green on a run that
     recorded the verdict and then failed to deliver it. */
  const DECISIONS = ["work_authorization_employer_approved", "work_authorization_employer_declined"];
  const entries = seeded.audit.entries.filter((e) => DECISIONS.includes(String(e.action)));
  assert.equal(entries.length, 1, "the employer's decision was not audited exactly once");
  assert.equal(entries[0].action, "work_authorization_employer_approved");
  assert.equal(entries[0].details.employerSpecialInstructions, STATED);

  // Whatever the other rows are, none of them may be a failure — a decision
  // that was recorded and then not delivered is not the chain under test.
  const failures = seeded.audit.entries.filter((e) => String(e.action).indexOf("_failed") > -1 || String(e.action).indexOf("_not_updated") > -1);
  assert.deepEqual(failures.map((e) => e.action), [], "the decision did not land cleanly");

  // 3. The mutable row the ZAF sidebar reads.
  const row = await seeded.store.findById(seeded.row.id);
  assert.equal(row.status, "approved_by_manager");
  assert.equal(row.approvalNote, STATED);

  // 4. What the mobility specialist is shown, under a named human.
  const { settledFacts } = await import("../src/uc04/approvalPolicy.js");
  // `{headline, facts, finality}` — not a bare array.
  const settled = settledFacts(row);
  assert.ok(settled, "the row does not read as settled");
  const noteFact = settled.facts.find((f) => f.label === "Note left");
  assert.ok(noteFact, "the specialist's panel stopped showing the employer's note");
  assert.equal(noteFact.value, STATED);

  // 5. And the Mobility Team's queue.
  assert.ok(notes.length > 0, "no hand-off note reached Zendesk");
  const handoff = notes.map((n) => n.body).join("\n");
  assert.match(handoff, /Employer's words: /);
  assert.ok(handoff.includes(STATED), "the hand-off did not carry the employer's own words");

  // THE NEGATIVE HALF, and it is the point: none of the employee's four answers
  // travelled under the employer's name once the manager wrote their own.
  for (const answer of Object.values(SAID)) {
    assert.ok(!handoff.includes(answer), `the employee's "${answer}" reached the Mobility Team as the employer's words`);
    assert.ok(!String(row.approvalNote).includes(answer));
  }
});
