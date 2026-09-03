/**
 * THE TREATY CONDITION NOTHING MEASURED — art. 15(2)(b), the reachable half.
 *
 * The 183-day row on every UC-04 case carries a caveat admitting its own
 * incompleteness: "The treaty day test is one of three cumulative conditions...
 * This system has no representation of (b) or (c), so a day count reported
 * alone has answered one third of the question."
 *
 * Limb (b) asks whether the employer is resident in the DESTINATION. Call the
 * employee's residence X, the customer's country Y and the destination Z. Where
 * Z is a genuine third country the limb holds however the arrangement is
 * structured — the finding docs/UC04-RESEARCH-FINDINGS.md §12a establishes
 * across Sweden, Germany and the Netherlands. Where **Z = Y**, it fails on day
 * one, and the exemption is gone before the day count is reached.
 *
 * That comparison needs no register, no treaty text and no judgement: two
 * country codes this system can already read.
 *
 * THREE PROPERTIES, AND EACH IS A WAY THIS COULD DO HARM IF IT WERE WRONG:
 *
 * 1. IT FAILS TO UNKNOWN, NEVER TO "NO". A read that did not happen rendering
 *    as "the customer has no entity there" is the reassuring answer produced by
 *    a comparison that never ran — finding F-27's exact shape one endpoint over,
 *    and the reason RemoteClient normalises alpha-3 in the first place.
 * 2. IT DECIDES NOTHING. Every tax finding in UC-04 is a work order for a
 *    specialist, never a refusal; the blocking set is immigration and data
 *    quality only.
 * 3. IT IS NOT A CLAIM ABOUT WHO EMPLOYS THE PERSON. These are the CLIENT's
 *    entities. Remote's own employing entity is exposed by no endpoint this
 *    project has found, and reading one of these as "the employer" is the
 *    defect recorded as K16 — currently shipping in three customer letters.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  readEmployerPresence,
  PRESENCE_NO_COMPANY,
  PRESENCE_NOT_LOOKED_UP,
  PRESENCE_UNAVAILABLE,
  PRESENCE_IN_DESTINATION,
  PRESENCE_ELSEWHERE,
} from "../src/uc04/employerPresence.js";

const repoFile = (rel) => readFileSync(new URL("../" + rel, import.meta.url), "utf8");
const remoteWith = (impl) => ({ listLegalEntities: impl });

const ENTITIES = [
  { id: "le_us", name: "Acme Inc", country_code: "US" },
  { id: "le_nl", name: "Acme BV", country_code: "NL" },
];

// ---------------------------------------------------------------------------
// Z = Y — the case the whole check exists for
// ---------------------------------------------------------------------------

test("an entity at the destination is reported, and the exemption is said to be unavailable", async () => {
  const presence = await readEmployerPresence({
    remote: remoteWith(async () => ENTITIES),
    companyId: "co_1",
    destinationCountry: "NL",
  });
  assert.equal(presence.state, PRESENCE_IN_DESTINATION);
  assert.deepEqual(presence.matched, [{ id: "le_nl", name: "Acme BV", country: "NL" }]);
  assert.match(presence.finding, /has a legal entity in Netherlands \(Acme BV\)/);
  assert.match(presence.finding, /economic-employer analysis can reach that conclusion/);
  assert.match(presence.finding, /cannot be assumed from the day count/);
  // AND IT STOPS SHORT OF THE CONCLUSION IT IS NOT ENTITLED TO. Losing the
  // treaty exemption is not the same as tax being payable — that turns on
  // domestic law this system does not model.
  assert.match(presence.finding, /It does not follow that tax is owed/);
});

test("no entity at the destination is one condition holding, not a clear trip", async () => {
  const presence = await readEmployerPresence({
    remote: remoteWith(async () => ENTITIES),
    companyId: "co_1",
    destinationCountry: "PT",
  });
  assert.equal(presence.state, PRESENCE_ELSEWHERE);
  assert.deepEqual(presence.entityCountries, ["US", "NL"]);
  assert.match(presence.finding, /no legal entity in Portugal/);
  assert.match(presence.finding, /not the trip being clear/);
});

test("Remote's alpha-3 country codes are compared on the same axis as the destination", async () => {
  // `CompanyLegalEntity.country_code` is ISO alpha-3 on the real API and the
  // destination is alpha-2. Comparing them raw is false forever, silently, and
  // renders as "no entity there" — the reassuring answer from a comparison that
  // never had a chance. RemoteClient normalises; this asserts the consumer does
  // not undo it by reading a raw row.
  const alpha3 = [{ id: "le_nl", name: "Acme BV", country_code: "NLD", country_code_alpha3: "NLD" }];
  const raw = await readEmployerPresence({
    remote: remoteWith(async () => alpha3),
    companyId: "co_1",
    destinationCountry: "NL",
  });
  // An un-normalised row must NOT silently answer "no". It answers what it can
  // see, and what it can see is not the destination — so the honest outcome is
  // that the country is not recognised rather than that there is no entity.
  assert.notEqual(raw.state, PRESENCE_IN_DESTINATION);
  assert.ok(!raw.entityCountries.includes("NLD"), "a three-letter code reached a two-letter comparison set");
  // AND IT IS REPORTED RATHER THAN DROPPED. An unplaceable row silently
  // vanishing into "none there" is the false reassurance this guard exists for.
  assert.match(raw.finding, /could not be placed in any country/);

  // The normalised shape RemoteClient actually produces resolves correctly.
  const normalised = await readEmployerPresence({
    remote: remoteWith(async () => [{ id: "le_nl", name: "Acme BV", country_code: "NL", country_code_alpha3: "NLD" }]),
    companyId: "co_1",
    destinationCountry: "NL",
  });
  assert.equal(normalised.state, PRESENCE_IN_DESTINATION);
});

// ---------------------------------------------------------------------------
// 1. It fails to unknown, never to "no"
// ---------------------------------------------------------------------------

test("a read that did not happen is never reported as an absence of entities", async () => {
  const cases = [
    [
      "the read failed",
      await readEmployerPresence({
        remote: remoteWith(async () => {
          const err = new Error("boom");
          err.status = 502;
          throw err;
        }),
        companyId: "co_1",
        destinationCountry: "NL",
      }),
      PRESENCE_UNAVAILABLE,
    ],
    ["no company on the record", await readEmployerPresence({ remote: remoteWith(async () => ENTITIES), companyId: null, destinationCountry: "NL" }), PRESENCE_NO_COMPANY],
    ["no client wired in", await readEmployerPresence({ remote: null, companyId: "co_1", destinationCountry: "NL" }), PRESENCE_NOT_LOOKED_UP],
    ["no destination readable", await readEmployerPresence({ remote: remoteWith(async () => ENTITIES), companyId: "co_1", destinationCountry: null }), PRESENCE_UNAVAILABLE],
  ];
  for (const [label, presence, expected] of cases) {
    assert.equal(presence.state, expected, label);
    assert.notEqual(presence.state, PRESENCE_ELSEWHERE, `${label} rendered as "they have none there"`);
    assert.deepEqual(presence.matched, [], label);
  }
  // The failure says what kind of failure it is, and refuses the reassuring
  // reading in its own words.
  const failed = cases[0][1];
  assert.match(failed.finding, /HTTP 502/);
  assert.match(failed.finding, /NOT a finding that they have no company at the destination/);
  assert.match(failed.finding, /unanswered rather than satisfied/);
  // And the two "unknown" branches do not share a sentence with each other.
  assert.equal(new Set(cases.map((c) => c[1].finding)).size, cases.length);
});

test("an empty entity list is an answer, and a failed read is not — they never share a state", async () => {
  const empty = await readEmployerPresence({
    remote: remoteWith(async () => []),
    companyId: "co_1",
    destinationCountry: "NL",
  });
  assert.equal(empty.state, PRESENCE_ELSEWHERE, "Remote answering 'none' is an answer");
  assert.deepEqual(empty.entityCountries, []);
  assert.doesNotMatch(empty.finding, /Remote lists 0/);
});

test("the read never throws", async () => {
  for (const impl of [
    async () => {
      throw new Error("network");
    },
    async () => null,
    async () => "not an array",
  ]) {
    const presence = await readEmployerPresence({ remote: remoteWith(impl), companyId: "co_1", destinationCountry: "NL" });
    assert.ok(presence.finding, "a branch returned no sentence");
  }
});

// ---------------------------------------------------------------------------
// 2 & 3. It decides nothing, and it is not a claim about the employer
// ---------------------------------------------------------------------------

test("no gate, matrix, approval policy or workflow reads the customer's entities", () => {
  for (const file of ["policyEngine.js", "riskMatrix.js", "approvalPolicy.js", "workflow.js", "requestParser.js"]) {
    const source = repoFile(`src/uc04/${file}`);
    assert.ok(
      !source.includes("employerPresence") && !source.includes("readEmployerPresence"),
      `src/uc04/${file} reaches for the customer's entities — a tax finding must not become a refusal`
    );
  }
});

test("nothing here calls a client entity the employer", async () => {
  // K16: three customer-facing letters currently name the CUSTOMER's legal
  // entity as the employer of an EOR employee. This module reads the same
  // objects and must not repeat it — the heading on the panel is about the
  // customer, and the finding never uses the word for the relationship.
  const presence = await readEmployerPresence({
    remote: remoteWith(async () => ENTITIES),
    companyId: "co_1",
    destinationCountry: "NL",
  });
  // The guard is against naming a CLIENT entity as THIS person's employer. The
  // finding may state the treaty's own condition — that is a rule, not a claim
  // about who employs anybody.
  assert.doesNotMatch(presence.finding, /\bemployed by\b|\bemployer of record\b|their employer\b/i);
  assert.match(presence.finding, /The customer has a legal entity/);

  const main = repoFile("zaf-app/assets/main.js");
  const block = main.slice(main.indexOf("function renderEmployerPresence("), main.indexOf("function renderEmployee("));
  assert.match(block, /"Where the customer has companies"/);
  assert.ok(!/Employed by|Employer of Record/.test(block), "the panel is naming a client entity as the employer");
  // Five states, all rendered — "we could not ask" must not look like "no".
  assert.match(block, /Unknown — see below\./);
});
