// ---------------------------------------------------------------------------
// thirdPartyPublicExposure.test.js — what this door owes a PUBLIC audience
// ---------------------------------------------------------------------------
// Added 2026-08-28, when this deployment was about to be pointed at a video
// audience rather than at the person who built it.
//
// The door is unauthenticated BY DESIGN and that is not in question here:
// VC-33 requires that a bank enquiring needs no account, and that every
// submission gets the identical acknowledgement. Both are pinned elsewhere
// (test/thirdPartyDoor.test.js) and neither is what these tests are about.
//
// These pin two properties that only matter once STRANGERS arrive:
//
//   1. The page says it is a demonstration. It carries Remote's name and its
//      visual language, and it asks for a THIRD PARTY's full legal name and
//      date of birth. Without the banner a visitor could put a real person's
//      real details into a portfolio project's database — which prime
//      directive 5 ("no real customer data") exists to prevent.
//
//   2. Free text is bounded. `message` is the one field that reaches a real
//      OpenAI call on the deployment, the deployment pays per token, and there
//      is no rate limit in front of it. An unbounded field is an unbounded
//      bill payable by anyone who finds the URL.
//
// The banner is asserted to be STATIC — one occurrence, not selected by any
// branch — because a banner that varied with the outcome would be exactly the
// side channel VC-33 forbids.
// ---------------------------------------------------------------------------

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { CaseStore } from "../src/shared/caseStore.js";
import { startThirdPartyDoorServer } from "../src/thirdparty/server.js";
import { createInProcessFetch } from "../src/remote/mockServer.js";
import { RemoteClient } from "../src/remote/restClient.js";
import { AuditLogger } from "../src/shared/audit.js";
import { classifyRequestRuleBased } from "../src/uc01/classifier.js";

const HTML = readFileSync(new URL("../src/thirdparty/assets/index.html", import.meta.url), "utf8");

async function door() {
  const remote = new RemoteClient({ baseUrl: "http://mock.local", token: "t", fetchImpl: createInProcessFetch() });
  const server = await startThirdPartyDoorServer(
    {
      remote,
      audit: new AuditLogger(),
      caseStore: new CaseStore(),
      demoSubject: null,
      // Injected, not defaulted. The door's default `classify` is the real
      // OpenAI call, and one of the tests below submits a VALID request that
      // reaches it — so without this seam that test would make a live, billed
      // network call every run. CLAUDE.md §6 records this burning real credit
      // once already.
      classify: async (input) => classifyRequestRuleBased(input),
    },
    0
  );
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    server,
    submit: (body) =>
      fetch(`${base}/api/requests`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }).then(async (r) => ({ status: r.status, json: await r.json() })),
  };
}

const VALID = {
  requestingParty: "First National Bank",
  purpose: "Mortgage application",
  employmentReference: "AO4T9X",
  subjectName: "Amara Okafor",
  subjectDateOfBirth: "1988-04-12",
  returnAddress: "mortgages@first-national.example.com",
  message: "Please confirm this person's employment status and start date.",
};

test("the page tells a visitor it is a demonstration, not Remote", () => {
  assert.match(HTML, /Demonstration only\./, "the demo banner is gone — a stranger cannot tell this is a portfolio project");
  assert.match(HTML, /not operated by or\s+affiliated with Remote/, "the banner no longer disclaims affiliation");
  assert.match(HTML, /do not enter any real person's details/i, "the banner no longer warns against real personal data");
});

test("the banner is static — it cannot become a VC-33 side channel", () => {
  // One occurrence, in the markup, with no template hole in it. If a future
  // change made this depend on the decision, an enquirer could tell a real
  // employee from a person who does not exist by reading the page furniture.
  assert.equal((HTML.match(/Demonstration only\./g) || []).length, 1);
  const banner = HTML.slice(HTML.indexOf('<p class="tp-demo">'), HTML.indexOf("</p>", HTML.indexOf('<p class="tp-demo">')));
  assert.doesNotMatch(banner, /\$\{|<%|\{\{/, "the banner has become templated, so it can vary per request");
});

test("a Remote-branded public demo is not search-indexable", () => {
  assert.match(HTML, /<meta name="robots" content="noindex, nofollow"/);
});

test("an unbounded free-text field is refused before it can reach the model", async () => {
  const { server, submit } = await door();
  try {
    const { status, json } = await submit({ ...VALID, message: "a".repeat(4001) });
    assert.equal(status, 400);
    assert.equal(json.code, "message_too_long");
  } finally {
    server.close();
  }
});

test("the cap refuses on SHAPE, so it discloses nothing about who exists", async () => {
  // Same refusal for a reference the mock resolves and one it has never heard
  // of. If the cap were applied after the lookup, the difference between these
  // two responses would answer the question VC-33 exists to refuse.
  const { server, submit } = await door();
  try {
    const long = "a".repeat(4001);
    const real = await submit({ ...VALID, message: long });
    const absent = await submit({ ...VALID, employmentReference: "ZZ9Q9Z", message: long });
    assert.deepEqual(real, absent);
  } finally {
    server.close();
  }
});

test("a normal-length enquiry is untouched by the cap", async () => {
  const { server, submit } = await door();
  try {
    const { status } = await submit({ ...VALID, message: "b".repeat(3999) });
    assert.notEqual(status, 400, "the cap is refusing traffic it was not meant to");
  } finally {
    server.close();
  }
});
