// ---------------------------------------------------------------------------
// portalUc03CountryNames.test.js  —  one country, one vocabulary, and a
// published code that stays a code
// ---------------------------------------------------------------------------
// WHAT THIS IS PROTECTING
//
// src/shared/countryNames.js draws one line and this file is UC-03's half of
// it: **codes decide, names are read**. Three things had drifted across it on
// the portal's travel form, and each is pinned below in the direction it broke.
//
//   1. A UC-03 ESCALATION NAMED NO PLACE. `subjectCountryOf()` used to recover
//      UC-03's destination from `letterOffer.carries.destinationCountry` and
//      from the continuation prefill — exact, and between them covering only
//      the answered trip and the routed one. An escalation produces neither, so
//      an archived employee's trip to Spain was summarised as a travel question
//      about nowhere. The adapter now publishes `subjectCountry` like the other
//      three that have a country, and the fallback is gone.
//
//   2. THE PUBLISHED FIELD IS A CODE. It travels in a payload, which is exactly
//      where a name must never be: "a name in a stored field is the alpha-3
//      defect one alphabet over", and it cost this repository an 80-day stay
//      when "Netherlands" reached a comparison only two-letter codes can win.
//      The name is looked up once, at the point of rendering, in
//      ./plainAnswer.js. So the assertion is deliberately two-sided — the
//      SUMMARY must never contain the code, and the FIELD must never contain
//      the name.
//
//   3. THE DETAILS TABLE PRINTED `ES` under a sentence that said "Spain". Two
//      renderings of one fact, in two vocabularies, a few hundred pixels apart
//      — and `details` is also what buildTicketNote() writes into the Zendesk
//      note, so the specialist read the code too.
//
// WHY IT DRIVES THE HANDLER RATHER THAN CALLING THE HELPERS. Every one of these
// was invisible to a unit test of `countryLabel()`, which was correct
// throughout: the defect was always a call site that did not exist. So each
// assertion below is made over a real POST through the real workflow, on the
// four quick-fills the page itself offers.
//
// HERMETIC: the LLM seams are faked with the repo-standard
// `(args) => realFn(args, {isConfigured: () => false})` idiom and the mock
// Remote is dispatched in-process, so this file binds no port.
// ---------------------------------------------------------------------------

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { createPortalHandler } from "../src/portal/server.js";
import { createInProcessFetch } from "../src/remote/mockServer.js";
import { RemoteClient } from "../src/remote/restClient.js";
import { AuditLogger } from "../src/shared/audit.js";
import { buildPortalStores } from "../src/portal/wiring.js";
import { countryName, nameableCountryCodes } from "../src/shared/countryNames.js";
import { classifyTravelInquiryRuleBased } from "../src/uc03/classifier.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER = join(__dirname, "..", "src", "portal", "server.js");

function portal() {
  const remote = new RemoteClient({ baseUrl: "http://mock.remote.invalid", fetchImpl: createInProcessFetch() });
  return createPortalHandler({
    remote,
    audit: new AuditLogger(),
    stores: buildPortalStores(),
    llm: { classifyTravel: classifyTravelInquiryRuleBased },
  });
}

/** The same in-process driver every other server suite in this repo uses. */
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
        let parsed = null;
        try {
          parsed = payload ? JSON.parse(String(payload)) : null;
        } catch {
          parsed = null;
        }
        resolve({ status: this.statusCode, body: parsed });
      },
    };
    handler(req, res).catch(reject);
  });
}

// ---------------------------------------------------------------------------
// THE FOUR OUTCOMES, ONE SCENARIO EACH
// ---------------------------------------------------------------------------
// The texts are the portal's own quick-fills (SCENARIOS.uc03 in
// src/portal/assets/app.js) and the personas are theirs too — `chris` is
// active, `thomas` is archived, which is what makes the fourth one an
// escalation at gate 2. They are restated here rather than lifted out of the
// asset because THIS file's subject is the four DECISION SHAPES, and a scenario
// list that changed should not quietly change which shapes are covered: the
// assertions below check the decision each one reached, so a rewritten
// quick-fill fails here loudly instead of silently testing three of four.

const SCENARIOS = [
  {
    id: "answered",
    persona: "chris",
    text: "I'm travelling to Spain for a client meeting from September 14 to October 2, 2026. Can you confirm business travel is fine?",
    decision: "auto_resolve",
    code: "ES",
    name: "Spain",
  },
  {
    id: "routed",
    persona: "chris",
    text: "I'd like to work remotely from Portugal for a month while on holiday — can I do my normal job from there?",
    decision: "route_to_uc04",
    code: "PT",
    name: "Portugal",
  },
  {
    // THIS SCENARIO'S DECISION MOVED, and it moved because the standard travel
    // letter is now written and issued by the gate rather than drafted for a
    // signature (docs/use-cases/UC-03.md §23). It is kept in this list because
    // this file's subject is which SHAPES carry a country name, and a letter
    // request is still its own shape — it simply reaches `auto_resolve` by a
    // different rung from the informational answer above it.
    id: "letter-requested",
    persona: "chris",
    text: "I need a travel letter for my visa application for a conference in Germany from September 20 to September 26, 2026.",
    decision: "auto_resolve",
    code: "DE",
    name: "Germany",
  },
  {
    // THE ONE THIS CHANGE EXISTS FOR. Decided at `employment_status` — gate 2
    // of 13, which has not looked at a destination and never will — so nothing
    // downstream of the gates carries the country, and before this change the
    // summary named no place at all.
    id: "escalated",
    persona: "thomas",
    text: "I'm travelling to Spain for a client meeting from September 14 to October 2, 2026.",
    decision: "escalate",
    code: "ES",
    name: "Spain",
  },
];

let DRIVEN = null;
async function drive() {
  if (DRIVEN) return DRIVEN;
  const handler = portal();
  const out = [];
  for (const s of SCENARIOS) {
    const res = await call(handler, {
      path: "/api/requests/uc03",
      body: { persona: s.persona, text: s.text, externalRef: `uc03-names-${s.id}` },
    });
    assert.equal(res.body?.ok, true, `${s.id} was refused at intake: ${res.body?.reason}`);
    assert.equal(res.body.decision, s.decision, `${s.id} no longer reaches ${s.decision}`);
    out.push({ ...s, payload: res.body });
  }
  DRIVEN = out;
  return out;
}

const rowNamed = (payload, label) => (payload.details ?? []).find((d) => d.label === label);
const summaryOf = (payload) => [payload.plainAnswer?.lead, payload.plainAnswer?.next].filter(Boolean).join(" ");

// ---------------------------------------------------------------------------
// 1. EVERY UC-03 OUTCOME PUBLISHES ITS DESTINATION, INCLUDING THE ESCALATION
// ---------------------------------------------------------------------------

test("every UC-03 outcome publishes the destination the gates compared", async () => {
  for (const r of await drive()) {
    assert.equal(
      r.payload.subjectCountry,
      r.code,
      `the ${r.id} outcome does not publish its destination — the summary can only name a place it is given`
    );
  }
});

test("an escalation names its country, which is the outcome that named none", async () => {
  const escalated = (await drive()).find((r) => r.id === "escalated");
  const summary = summaryOf(escalated.payload);

  assert.equal(escalated.payload.plainAnswer.shape, "escalated");
  assert.match(summary, /Spain/, `the escalation still names no place: ${summary}`);

  // AND IT NAMES IT AS THE SUBJECT, NEVER AS THE CAUSE. This escalation is
  // `employee_not_active`: Spain has nothing to do with why it stopped, and a
  // sentence implying otherwise would be a jurisdiction finding invented above
  // the real reason — the defect the `refused` wording already carries a
  // paragraph about in ./plainAnswer.js.
  assert.ok(
    !/Spain (is|was|cannot|could not)/.test(summary),
    `the summary makes a claim about the destination that the decision did not: ${summary}`
  );
  assert.ok(!/^No\b|^Yes\b/.test(escalated.payload.plainAnswer.lead), "an escalation is neither a yes nor a no");
});

// ---------------------------------------------------------------------------
// 2. THE FIELD IS A CODE AND THE SENTENCE IS A NAME — BOTH DIRECTIONS
// ---------------------------------------------------------------------------
// The one that would be easy to "fix" the wrong way. `subjectCountry` is
// published in a payload; a name there is the alpha-3 defect one alphabet over.

test("the published subject country is a code, and the summary that renders it is not", async () => {
  const codes = new Set(nameableCountryCodes());
  for (const r of await drive()) {
    const subject = r.payload.subjectCountry;
    assert.ok(codes.has(subject), `subjectCountry "${subject}" is not an ISO alpha-2 code (${r.id})`);
    assert.notEqual(subject, countryName(subject), `subjectCountry carries the NAME on ${r.id}`);

    const summary = summaryOf(r.payload);
    assert.ok(
      !new RegExp(`\\b${subject}\\b`).test(summary),
      `the ${r.id} summary prints the code ${subject}: ${summary}`
    );
  }
});

// ---------------------------------------------------------------------------
// 3. THE TABLE UNDER THE SENTENCE SPEAKS THE SAME VOCABULARY
// ---------------------------------------------------------------------------

test("the destination row prints the country's name, not its code", async () => {
  for (const r of await drive()) {
    const row = rowNamed(r.payload, "Destination read from the request");
    assert.ok(row, `the destination row has gone from the ${r.id} panel`);
    assert.equal(row.value, r.name, `the ${r.id} panel still prints a code under a sentence that says ${r.name}`);
  }
});

test("the routed requester reads a country name, and the event itself keeps its codes", async () => {
  const routed = (await drive()).find((r) => r.id === "routed");

  // THE HAND-OFF ROW IS THE SPECIALIST'S NOW. `Handoff to UC-04:
  // CROSS_BORDER_WORK_REQUESTED — United States → Portugal, ..., employment
  // 8ab12460-…` is an event-type constant and a raw employment id: what the
  // mobility specialist opening the ticket reads instead of an event name with
  // no event, and machinery to the traveller. Its country NAMING still matters
  // — a specialist should not decode ISO either — and is asserted against the
  // real created ticket in test/portalRequesterFacts.test.js.
  assert.equal(rowNamed(routed.payload, "Handoff to UC-04"), undefined, "the hand-off payload is on the requester's panel");

  // WHAT THE REQUESTER READS INSTEAD still names the country in words, which is
  // the claim this file exists to make. The plain answer says it in a sentence,
  // and the continuation offer — the control they can act on — says it again.
  assert.match(routed.payload.plainAnswer.lead, /Portugal/, "the answer does not name where they said they would work from");
  assert.ok(!/\bPT\b/.test(routed.payload.plainAnswer.lead), "the answer prints the code");

  // THE PAYLOAD IS UNTOUCHED. The prefill the continuation form is built from
  // carries the CODE — it is typed into a picker whose options are codes, and a
  // name there would be refused by the very gate it is meant to feed.
  const prefill = (routed.payload.continuation?.prefill ?? []).find((p) => p.field === "uc04-destinationCountry");
  assert.ok(prefill, "the continuation no longer prefills a destination");
  assert.equal(prefill.value, "PT", "the continuation prefill must carry the code the gates compare");
});

test("the letter offer keeps its code and gains a name beside it, never instead of it", async () => {
  const answered = (await drive()).find((r) => r.id === "answered");
  const carries = answered.payload.letterOffer?.carries;
  assert.ok(carries, "the answered trip no longer carries a letter offer");
  // A reference somebody reads out to a consulate: the code is the thing they
  // may have to quote, so it stays, and the name joins it.
  assert.equal(carries.destinationCountry, "ES");
  assert.equal(carries.destinationName, "Spain");
});

// ---------------------------------------------------------------------------
// 4. THE NAMES COME FROM THE ONE MODULE THAT HOLDS THEM
// ---------------------------------------------------------------------------
// src/portal/server.js used to carry its own three-line lookup over
// PORTAL_COUNTRIES, written before src/shared/countryNames.js existed. Two
// copies of one map is this repository's most expensive recurring defect: not
// wrong on the day the second is written, wrong the day the first is corrected.
// A structural check, because a behavioural one cannot tell two identical maps
// apart — which is the whole problem.

test("the portal server holds no country-name lookup of its own", () => {
  const source = readFileSync(SERVER, "utf8");
  assert.match(source, /from "\.\.\/shared\/countryNames\.js"/, "the shared naming module is not imported");
  assert.ok(
    !/function countryName\s*\(/.test(source),
    "src/portal/server.js has grown its own countryName() again — there must be one map, and it is src/shared/countryNames.js"
  );
  assert.ok(
    !/PORTAL_COUNTRIES\.find\s*\(/.test(source),
    "a second country-name lookup over PORTAL_COUNTRIES has come back"
  );
});

// ---------------------------------------------------------------------------
// 5. NOTHING THAT DECIDES CHANGED
// ---------------------------------------------------------------------------
// The line the whole change is written against. Every transform above happens
// at the point of rendering; the record, the flags and the reason are the same
// strings they were, and the audit row is built from the classification rather
// than from anything on this page.

test("naming a country changes no decision, reason or flag", async () => {
  for (const r of await drive()) {
    assert.equal(r.payload.decision, r.decision);
    // The reason is a slug and stays one — it is compared, tagged and routed on.
    assert.ok(
      /^[a-z0-9_]+$/.test(r.payload.reason ?? ""),
      `${r.id}'s reason is no longer a machine token: ${r.payload.reason}`
    );
    for (const flag of r.payload.flags ?? []) {
      assert.ok(/^[a-z0-9_]+$/.test(String(flag)), `${r.id} carries a flag that has been prettified: ${flag}`);
    }
  }
});
