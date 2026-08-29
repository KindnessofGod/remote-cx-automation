// ---------------------------------------------------------------------------
// countryMentions.test.js — the false-positive and wrong-slot defect class
// ---------------------------------------------------------------------------
// THE DEFECT THIS FILE EXISTS FOR, reproduced in production on Zendesk ticket
// 18 / n8n execution 4500 (UC-07, workflow WORKFLOW_UC07_ID):
//
//   "Employee asks about permanently relocating from Portugal to Germany"
//     → substring matching found  germany, fr (inside "from"), portugal,
//       ca (inside "relocating")  →  codes DE, FR, PT, CA
//     → the first two by DICTIONARY ORDER became the slots
//     → the dossier read "Source country: DE; Destination country: FR"
//
// Both countries wrong AND reversed, in a 🔴 research dossier a human reads to
// decide a permanent relocation. Every test below is either that trap or the
// positive case that proves the fix did not simply stop extracting.
// ---------------------------------------------------------------------------

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  compileCountryDictionary,
  findCountryMentions,
  distinctCountryCodes,
  resolveSourceAndDestination,
  resolveDestinationCountry,
} from "../src/shared/countryMentions.js";

const DICT = compileCountryDictionary({
  spain: "ES",
  netherlands: "NL",
  "the netherlands": "NL",
  germany: "DE",
  france: "FR",
  portugal: "PT",
  "united kingdom": "GB",
  uk: "GB",
  "united states": "US",
  usa: "US",
  brazil: "BR",
  canada: "CA",
  india: "IN",
  italy: "IT",
  norway: "NO",
  austria: "AT",
  belgium: "BE",
});

// ---------------------------------------------------------------------------
// 1. The exact live case
// ---------------------------------------------------------------------------

const TICKET_18 = "Employee asks about permanently relocating from Portugal to Germany";

test("1. ticket 18: no country is matched that nobody wrote", () => {
  const codes = distinctCountryCodes(findCountryMentions(TICKET_18, DICT));
  assert.deepEqual(codes, ["PT", "DE"], "only Portugal and Germany are named — France and Canada were substring ghosts");
});

test("1b. ticket 18: the slots come from the direction words, not dictionary order", () => {
  const r = resolveSourceAndDestination(TICKET_18, DICT);
  assert.equal(r.sourceCountry, "PT");
  assert.equal(r.destinationCountry, "DE");
  assert.equal(r.reason, "directional_cues");
});

// ---------------------------------------------------------------------------
// 2. The substring trap, one common English word at a time
// ---------------------------------------------------------------------------

test("2. two-letter codes hiding inside ordinary words are never matched", () => {
  // Each phrase names NO country, but each contains a live ISO alpha-2 code as
  // a substring: fr(from) ca(relocating) de(resident/under) pt(opt) br(brief)
  // in(in) it(it) no(no) at(at) be(be) us(us).
  const decoys = [
    "the request came from our team",
    "we are relocating the desk, not the person",
    "he is a resident of the building under the new rules",
    "please opt in to the brief, it is at no cost to us",
    "can you send us a brief note about the transfer?",
  ];
  for (const text of decoys) {
    assert.deepEqual(distinctCountryCodes(findCountryMentions(text, DICT)), [], `matched a country in: "${text}"`);
  }
});

test("2b. a country name embedded in a longer word is not a mention", () => {
  assert.deepEqual(distinctCountryCodes(findCountryMentions("the ukulele arrived", DICT)), []);
  assert.deepEqual(distinctCountryCodes(findCountryMentions("germanyish is not a country", DICT)), []);
});

test("2c. real word boundaries still match: punctuation, possessives, line ends", () => {
  assert.deepEqual(distinctCountryCodes(findCountryMentions("Move to Germany.", DICT)), ["DE"]);
  assert.deepEqual(distinctCountryCodes(findCountryMentions("Germany's rules apply", DICT)), ["DE"]);
  assert.deepEqual(distinctCountryCodes(findCountryMentions("(Spain)", DICT)), ["ES"]);
  assert.deepEqual(distinctCountryCodes(findCountryMentions("relocation: Portugal", DICT)), ["PT"]);
});

// ---------------------------------------------------------------------------
// 3. The dictionary itself cannot re-open the hole
// ---------------------------------------------------------------------------

test("3. compileCountryDictionary refuses bare two-letter keys", () => {
  assert.throws(() => compileCountryDictionary({ germany: "DE", de: "DE" }), /refusing the dictionary key "de"/);
  assert.throws(() => compileCountryDictionary({ italy: "IT", it: "IT" }), /refusing the dictionary key "it"/);
});

test("3b. an explicitly-allowed short form is accepted and matched as a whole word", () => {
  const compiled = compileCountryDictionary({ uk: "GB", "united kingdom": "GB" });
  assert.deepEqual(distinctCountryCodes(findCountryMentions("moving to the UK next year", compiled)), ["GB"]);
  assert.deepEqual(distinctCountryCodes(findCountryMentions("she plays the ukulele", compiled)), []);
});

test("3c. 'us' is not an allowed short form — it is a pronoun", () => {
  assert.throws(() => compileCountryDictionary({ us: "US" }), /refusing the dictionary key "us"/);
});

// ---------------------------------------------------------------------------
// 4. Direction: cues beat position, in both word orders
// ---------------------------------------------------------------------------

test("4. 'from X to Y' and 'to Y from X' produce the same route", () => {
  const a = resolveSourceAndDestination("Permanent move from Portugal to Germany in June.", DICT);
  const b = resolveSourceAndDestination("Permanent move to Germany from Portugal in June.", DICT);
  assert.deepEqual([a.sourceCountry, a.destinationCountry], ["PT", "DE"]);
  assert.deepEqual([b.sourceCountry, b.destinationCountry], ["PT", "DE"], "word order must not flip the route");
});

test("4b. 'to the Netherlands' — a multi-word name behind a cue still resolves", () => {
  const r = resolveSourceAndDestination(
    "We're permanently relocating our engineer from Spain to the Netherlands. We'll need visa support.",
    DICT
  );
  assert.deepEqual([r.sourceCountry, r.destinationCountry], ["ES", "NL"]);
});

test("4c. one cue plus one other country named: the other takes the opposite slot", () => {
  const r = resolveSourceAndDestination("She is employed in Portugal and wants to move to Germany.", DICT);
  assert.deepEqual([r.sourceCountry, r.destinationCountry], ["PT", "DE"]);
  assert.equal(r.reason, "destination_cued_single_other_country");
});

test("4d. a cued destination with no other country fills one slot only", () => {
  const r = resolveSourceAndDestination("Relocating permanently to Germany.", DICT);
  assert.equal(r.destinationCountry, "DE");
  assert.equal(r.sourceCountry, null, "an unstated source is null, never inferred");
});

test("4e. a later mention carries the cue when an earlier one does not", () => {
  const r = resolveSourceAndDestination("Germany came up in planning; we'd relocate her from Spain to Germany.", DICT);
  assert.deepEqual([r.sourceCountry, r.destinationCountry], ["ES", "DE"]);
});

// ---------------------------------------------------------------------------
// 5. Ambiguity resolves to null — the judgement this defect is really about
// ---------------------------------------------------------------------------

test("5. two countries and no direction word: both slots null, reason recorded", () => {
  const r = resolveSourceAndDestination("Relocation question about Portugal and Germany.", DICT);
  assert.equal(r.sourceCountry, null);
  assert.equal(r.destinationCountry, null);
  assert.equal(r.reason, "no_directional_cue");
  assert.deepEqual(r.mentionedCountries, ["PT", "DE"], "what WAS named is still reported, just not slotted");
});

test("5b. 'in' is not treated as a direction — it means both", () => {
  const r = resolveSourceAndDestination("She is in Portugal and the role is in Germany.", DICT);
  assert.equal(r.sourceCountry, null);
  assert.equal(r.destinationCountry, null);
});

test("5c. conflicting cues on one country resolve to null, not to that country", () => {
  const r = resolveSourceAndDestination("Transfer from Germany to Germany?", DICT);
  assert.equal(r.sourceCountry, null);
  assert.equal(r.destinationCountry, null);
  assert.equal(r.reason, "conflicting_directional_cues");
});

test("5d. no country named at all is its own reason, distinct from ambiguity", () => {
  const r = resolveSourceAndDestination("Can you explain the relocation policy?", DICT);
  assert.equal(r.reason, "no_country_named");
  assert.deepEqual(r.mentionedCountries, []);
});

test("5e. a cued destination with several other candidates refuses the source slot", () => {
  const r = resolveSourceAndDestination("Our Spain, Portugal and France teams — one person moves to Germany.", DICT);
  assert.equal(r.destinationCountry, "DE");
  assert.equal(r.sourceCountry, null);
  assert.equal(r.reason, "destination_cued_other_ambiguous");
});

// ---------------------------------------------------------------------------
// 6. UC-03's single-slot shape: "from X" means the destination there
// ---------------------------------------------------------------------------

test("6. 'work from Portugal' is a destination, not an origin", () => {
  const r = resolveDestinationCountry("I'd like to work remotely from Portugal for a month.", DICT);
  assert.equal(r.destinationCountry, "PT");
  assert.equal(r.reason, "single_country_named");
});

test("6b. 'travelling from Spain to Germany' takes the cued destination, not the first name", () => {
  const r = resolveDestinationCountry("I'm travelling from Spain to Germany for a client meeting.", DICT);
  assert.equal(r.destinationCountry, "DE", "dictionary order used to answer ES here");
});

test("6c. a date range's 'to' never becomes a destination", () => {
  const r = resolveDestinationCountry("Client meeting in Spain from 2026-09-14 to 2026-10-02.", DICT);
  assert.equal(r.destinationCountry, "ES");
});

test("6d. two countries with no destination cue is null, so the router escalates", () => {
  const r = resolveDestinationCountry("Meetings in Spain, then the Netherlands.", DICT);
  assert.equal(r.destinationCountry, null);
  assert.equal(r.reason, "multiple_countries_no_cue");
});

// ---------------------------------------------------------------------------
// 7. Hostile / non-string input never throws (asText discipline)
// ---------------------------------------------------------------------------

test("7. non-string text coerces instead of crashing", () => {
  for (const value of [null, undefined, 42, {}, [], true]) {
    assert.doesNotThrow(() => resolveSourceAndDestination(value, DICT));
    assert.equal(resolveSourceAndDestination(value, DICT).destinationCountry, null);
  }
});
