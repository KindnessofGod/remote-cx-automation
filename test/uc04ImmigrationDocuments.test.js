// ---------------------------------------------------------------------------
// uc04ImmigrationDocuments.test.js
// ---------------------------------------------------------------------------
// WHAT IS BEING PINNED, AND WHY EACH CLAIM NEEDS A TEST
//
// UC-04's fourth dimension reported `Document read from Remote: none` as a
// HARD-CODED STRING, on a record the same request had already fetched, while
// `normalizeEmployment()` silently discarded the documented `files[]` array
// that holds the answer. It was found by the project owner asking whether an
// employee would have such a document at all — the answer being yes, in real
// life (Remote's Right-to-Work Checks) and in the API (the `File` schema's own
// `{type: "id", sub_type: "personal_id"}` example).
//
// The dangerous half of the fix is the half that must NOT happen: finding an
// identity document must never clear this dimension, because a right-to-work
// document establishes entitlement in the country of EMPLOYMENT and UC-04 asks
// about the DESTINATION. So the tests below are weighted towards proving the
// bound holds, not towards proving the read works.
//
// NEGATIVE CONTROL, run before committing: reverting src/uc04/identityDocuments
// .js, decisionFacts.js and restClient.js fails 11 of these 15.
// ---------------------------------------------------------------------------

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  summariseIdentityDocuments,
  IDENTITY_FILE_TYPES,
  DOCS_NOT_READ,
  DOCS_FIELD_ABSENT,
  DOCS_NONE_ON_FILE,
  DOCS_ON_FILE,
} from "../src/uc04/identityDocuments.js";
import { describeDecisionBasis } from "../src/uc04/decisionFacts.js";
import { normalizeEmployment } from "../src/remote/restClient.js";

const IDENTITY_FILE = {
  id: "standin-file-x-01",
  name: "id.pdf",
  type: "id",
  sub_type: "personal_id",
  inserted_at: "2024-03-04T10:00:00Z",
};
const CONTRACT_FILE = { id: "file-x-02", name: "contract.pdf", type: "contract", sub_type: null, inserted_at: "2021-01-01T00:00:00Z" };

/** A decided row shaped exactly as `uc04_authorizations` stores one. */
function row(overrides = {}) {
  return {
    employmentId: "emp-1",
    requester: "admin_jane",
    factors: {
      homeCountry: "US",
      nationality: "US",
      destination: { country: "NL" },
      startDate: "2026-10-01",
      endDate: "2026-10-14",
      visaType: "schengen_short_stay",
      jobDuties: "engineering",
      travelHistory: [],
    },
    risk: {
      riskLevel: "low",
      normalized: { homeCountry: "US", destinationCountry: "NL", nationality: "US" },
      cumulativeDays: null,
    },
    tripDays: 14,
    cumulativeDays: null,
    decision: "ready_for_approval",
    reason: "all_gates_passed",
    flags: [],
    ...overrides,
  };
}

function documentDimension(basis) {
  return basis.dimensions.find((d) => d.key === "immigration_document");
}

// ---------------------------------------------------------------------------
// The summariser's four states — the split that is the point of the file
// ---------------------------------------------------------------------------

test("summariser: no record read at all is its own state, never an absence of documents", () => {
  const summary = summariseIdentityDocuments(null);
  assert.equal(summary.state, DOCS_NOT_READ);
  assert.equal(summary.count, 0);
  assert.equal(summary.totalFiles, null, "totalFiles must be null, not 0 — nothing was counted");
});

test("summariser: a record with no `files` key is 'field absent', not 'none on file'", () => {
  // The mock's flat shape, a hand-built object, and any record read before the
  // normalizer carried the field all land here. Reporting them as "the employee
  // has no documents" is precisely the defect being fixed, one level down.
  const summary = summariseIdentityDocuments({ id: "emp-1", full_name: "Chris Lee" });
  assert.equal(summary.state, DOCS_FIELD_ABSENT);
  assert.equal(summary.totalFiles, null);
});

test("summariser: files present but none of type `id` is a real finding about the employee", () => {
  const summary = summariseIdentityDocuments({ files: [CONTRACT_FILE, { type: "expense" }] });
  assert.equal(summary.state, DOCS_NONE_ON_FILE);
  assert.equal(summary.count, 0);
  assert.equal(summary.totalFiles, 2, "the other files are counted — an empty record and a full one differ");
  assert.deepEqual(summary.otherTypes, ["contract", "expense"]);
});

test("summariser: an identity document is reported with kind and date, and marked when it is a stand-in", () => {
  const summary = summariseIdentityDocuments({ files: [IDENTITY_FILE, CONTRACT_FILE] });
  assert.equal(summary.state, DOCS_ON_FILE);
  assert.equal(summary.count, 1);
  assert.deepEqual(summary.kinds, ["personal_id"]);
  assert.equal(summary.mostRecent, "2024-03-04T10:00:00Z");
  assert.equal(summary.standin, true, "a `standin-` id must make the whole summary declare itself");
});

test("summariser: publishes presence only — no file name, url or body ever leaves it", () => {
  const summary = summariseIdentityDocuments({
    files: [{ ...IDENTITY_FILE, name: "chris-lee-passport-scan.pdf", url: "https://example.test/secret" }],
  });
  const serialised = JSON.stringify(summary);
  assert.ok(!serialised.includes("passport-scan"), "a file name must not reach a caller");
  assert.ok(!serialised.includes("example.test"), "a file url must not reach a caller");
  // The id is not published either — the marker is reduced to a boolean.
  assert.ok(!serialised.includes("standin-file"), "the raw id must not reach a caller; `standin` is the boolean");
});

test("summariser: `background_check` and `document_scan` are NOT identity documents", () => {
  // Both exist in the live Sandbox and neither proves identity: a background
  // check is a report ABOUT a person, a scan is untyped by definition. Folding
  // either in would manufacture the confirmation this dimension must not make.
  const summary = summariseIdentityDocuments({
    files: [{ type: "background_check" }, { type: "document_scan" }],
  });
  assert.equal(summary.state, DOCS_NONE_ON_FILE);
  assert.deepEqual(IDENTITY_FILE_TYPES, ["id"]);
});

// ---------------------------------------------------------------------------
// THE BOUND — the half of this change that must not work
// ---------------------------------------------------------------------------

test("an identity document on file does NOT clear the dimension", () => {
  // UC-04.md §5/§9 and Remote's own guidance both: a work authorization is
  // subject to the rules of BOTH countries, so a document proving right to work
  // in the country of employment settles nothing about the destination.
  const basis = describeDecisionBasis({
    authorizationRow: row(),
    employment: { id: "emp-1", country_code: "US", files: [IDENTITY_FILE] },
  });
  const dimension = documentDimension(basis);
  assert.equal(dimension.state, "unavailable");
  assert.notEqual(dimension.state, "cleared");
});

test("no value of the employment record can produce a cleared document dimension", () => {
  // Driven rather than argued: every state the summariser can return, through
  // the real function, asserting the same thing each time.
  const employments = [
    null,
    { id: "emp-1" },
    { id: "emp-1", files: [] },
    { id: "emp-1", files: [CONTRACT_FILE] },
    { id: "emp-1", files: [IDENTITY_FILE] },
    { id: "emp-1", files: [IDENTITY_FILE, { ...IDENTITY_FILE, id: "standin-file-x-03" }] },
  ];
  for (const employment of employments) {
    const dimension = documentDimension(describeDecisionBasis({ authorizationRow: row(), employment }));
    assert.ok(dimension.state !== "cleared", `state was ${dimension.state} for ${JSON.stringify(employment)}`);
  }
});

test("the finding states the bound in words a specialist reads, not only in a state string", () => {
  const basis = describeDecisionBasis({
    authorizationRow: row(),
    employment: { id: "emp-1", files: [IDENTITY_FILE] },
  });
  const finding = documentDimension(basis).finding;
  assert.match(finding, /country of employment/i);
  assert.match(finding, /destination/i);
  // The bound and the instruction, in the two halves of a two-sentence finding:
  // what the filed document covers, and what still has to be obtained.
  assert.match(finding, /covers the country of employment, not the destination/);
  assert.match(finding, /Obtain the destination's authorization before approving/);
  // AND IT MUST NOT ALSO CLAIM TO HAVE FOUND NOTHING. The closing clause on the
  // absent branches reads "reported as absent rather than assumed", which is a
  // flat contradiction one clause after reporting a document. Found by driving
  // both fixtures, not by reading the string.
  // A DOCUMENT ON FILE AND NO DOCUMENT ON FILE MUST NOT READ THE SAME. With one
  // filed, saying "holds no identity document" would contradict the row beneath
  // it; with none filed, that IS the finding. Both branches close on the same
  // instruction — obtain the destination's authorization — because that is true
  // either way, so the difference lives in the clause and this pins it there.
  assert.doesNotMatch(finding, /holds no identity document/);
  const absent = documentDimension(
    describeDecisionBasis({ authorizationRow: row(), employment: { id: "emp-1", files: [] } })
  ).finding;
  assert.match(absent, /Remote's record holds no identity document/);
  assert.notEqual(finding, absent);
});

test("no gate reads the document summary — it is a view fact and structurally cannot decide", () => {
  // Same guard decisionSources.js carries: a fact that cannot change an outcome
  // can be reported honestly without anyone re-auditing the gates.
  for (const file of ["policyEngine.js", "riskMatrix.js", "approvalPolicy.js", "requestParser.js"]) {
    const source = readFileSync(new URL(`../src/uc04/${file}`, import.meta.url), "utf8");
    assert.ok(
      !source.includes("identityDocuments"),
      `src/uc04/${file} must never import the document summariser — it would make a view fact a gate input`
    );
  }
});

// ---------------------------------------------------------------------------
// The three absence states reach the panel as three different sentences
// ---------------------------------------------------------------------------

test("'not read', 'field absent' and 'none on file' are three different sentences", () => {
  const findings = [null, { id: "emp-1" }, { id: "emp-1", files: [CONTRACT_FILE] }].map(
    (employment) => documentDimension(describeDecisionBasis({ authorizationRow: row(), employment })).finding
  );
  assert.equal(new Set(findings).size, 3, "collapsing any two of these is the defect that produced the hard-coded 'none'");
  // NOBODY LOOKED / NOTHING TO LOOK IN / NOTHING FILED — three different
  // answers, and reporting any of them as another is the defect that produced
  // the hard-coded "none". The finding collapsed to two sentences in W-5b, so
  // the distinction now rides on the clause inside the first one. It is still
  // three distinct strings, which is what this test is for.
  assert.match(findings[0], /no employment record was read/i);
  assert.match(findings[1], /no documents field, so nothing was searched/i);
  assert.match(findings[2], /holds no identity document/i);
});

test("a record with other files says so, so a failed read is distinguishable from an unfiled document", () => {
  const dimension = documentDimension(
    describeDecisionBasis({ authorizationRow: row(), employment: { id: "emp-1", files: [CONTRACT_FILE] } })
  );
  // THE ROW CARRIES THE FILES; THE CLAUSE CARRIES THE VERDICT. The finding used
  // to spend a whole sentence on "though it holds 1 file of other kinds — not
  // filed, rather than not read", directly above a row that already said
  // `none (1 file of other kinds: contract)`. Arguing it twice is what made the
  // finding unreadable (W-5b), so the row is asserted here and the clause is
  // asserted for being DIFFERENT from the not-read one — which is the property,
  // not the spelling.
  const evidence = dimension.evidence.find((e) => /Identity documents/.test(e.label));
  assert.match(evidence.value, /1 file of other kinds: contract/);
  assert.match(dimension.finding, /Remote's record holds no identity document/);
  const unread = documentDimension(
    describeDecisionBasis({ authorizationRow: row(), employment: null })
  ).finding;
  assert.doesNotMatch(unread, /holds no identity document/, "a record nobody read is being reported as a record with nothing filed");
});

test("the summary is published on the basis so a surface can mark a stand-in without parsing prose", () => {
  const basis = describeDecisionBasis({
    authorizationRow: row(),
    employment: { id: "emp-1", files: [IDENTITY_FILE] },
  });
  assert.equal(basis.identityDocuments.state, DOCS_ON_FILE);
  assert.equal(basis.identityDocuments.standin, true);
  const evidence = documentDimension(basis).evidence.find((e) => /Identity documents/.test(e.label));
  assert.match(evidence.value, /STAND-IN FIXTURE/, "a fabricated fact must never reach a reader unmarked");
});

// ---------------------------------------------------------------------------
// The normalizer — the field that was being thrown away
// ---------------------------------------------------------------------------

test("normalizeEmployment carries `files` through from the API's nested shape", () => {
  const normalized = normalizeEmployment({
    id: "emp-1",
    status: "active",
    employment_model: "employee",
    basic_information: { name: "Chris Lee", provisional_start_date: "2021-09-06" },
    files: [IDENTITY_FILE],
  });
  assert.deepEqual(normalized.files, [IDENTITY_FILE]);
  assert.equal(summariseIdentityDocuments(normalized).state, DOCS_ON_FILE);
});

test("normalizeEmployment keeps an absent `files` NULL rather than defaulting it to []", () => {
  // `?? []` here would erase the difference between "the record did not carry
  // the field" and "the record carried it and it was empty" before any caller
  // could see it — and the second is a finding about the employee while the
  // first is a gap in what was read.
  const normalized = normalizeEmployment({
    id: "emp-1",
    status: "active",
    employment_model: "employee",
    basic_information: { name: "Chris Lee", provisional_start_date: "2021-09-06" },
  });
  assert.equal(normalized.files, null);
  assert.equal(summariseIdentityDocuments(normalized).state, DOCS_FIELD_ABSENT);
});

// ---------------------------------------------------------------------------
// The demo records — pinned, because a fixture can be dropped silently
// ---------------------------------------------------------------------------

test("the record the UC-04 demo renders actually exercises the populated branch, and declares itself", async () => {
  // `npm run uc04-api` seeds all six demo cases against emp_active_001 and the
  // sidebar fixture is the same record, so this is the only place the on_file
  // branch is ever SEEN — the live Sandbox holds zero files of type `id`, so
  // nothing real reaches it. Without this assertion the fixture could be
  // dropped and the demo would quietly fall back to "not carried on the record
  // read" with the whole suite still green.
  const { EMPLOYMENTS } = await import("../src/remote/mockServer.js");
  const summary = summariseIdentityDocuments(EMPLOYMENTS.emp_active_001);
  assert.equal(summary.state, DOCS_ON_FILE);
  assert.equal(summary.standin, true, "a fabricated document must never reach a reader unmarked");
});

test("a second demo record shows the shape live Sandbox data actually has", async () => {
  // Every one of the 112 live employments looks like this: files present, none
  // of them an identity document. Both branches have to be reachable offline or
  // the distinction is untested where it is read.
  const { EMPLOYMENTS } = await import("../src/remote/mockServer.js");
  const emma = EMPLOYMENTS["d73cff71-ced7-4bcf-b764-b9899abc6340"];
  const summary = summariseIdentityDocuments(emma);
  assert.equal(summary.state, DOCS_NONE_ON_FILE);
  assert.ok(summary.totalFiles > 0, "a record with no files at all would demonstrate a different state");
});
