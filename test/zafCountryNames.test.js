// ---------------------------------------------------------------------------
// zafCountryNames.test.js  —  the sidebar prints countries, not codes
// ---------------------------------------------------------------------------
// WHY THIS FILE EXISTS
//
// The project owner, on every surface at once: "instead of using country codes
// like PT you use the country's full name. You can use codes inside the code,
// not on the UI." src/shared/countryNames.js is the seam that answers it, and
// test/countryNames.test.js pins the seam. This file pins the OTHER half — that
// the ZAF sidebar actually calls it — and it has to exist separately for a
// reason this repo has paid for twice: `npm test` never imports a browser
// asset, so a panel that quietly went back to printing `PT` would ship into a
// live Zendesk account with nothing failing on this machine.
//
// THREE DISTINCT THINGS ARE ASSERTED, and they fail for different reasons.
//
//   1. THE COPY IS HONEST. A ZAF bundle is a static upload with no module
//      system and no server of ours in the path, so the map is carried in
//      zaf-app/assets/countryNames.js — a SECOND copy of a country list, which
//      is the shape of defect this repository records under "the gates exist
//      twice". Two country lists drift and the drift is invisible until a panel
//      renders a country it cannot name. So the copy is generated and this file
//      compares it, in both directions, against the module it was generated
//      from.
//
//   2. THE TRANSFORM IS SAFE IN BOTH DIRECTIONS. A bare code becomes a name; a
//      name the server already sent survives byte-for-byte; a code the list
//      cannot name survives as the code rather than as a blank. The load-
//      bearing negative case is the Norway hazard: "no" is two letters and IS
//      Norway's code, and UC-04's own evidence carries
//      `{label: "Contract-signing authority", value: "no"}`.
//
//   3. THE CASES A SPECIALIST ACTUALLY READS render names — driven through the
//      real workflows and the real API handlers, not from a fixture written to
//      agree with the panel, which is the failure mode CLAUDE.md §4 names.
// ---------------------------------------------------------------------------

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";

import { countryName, nameableCountryCodes } from "../src/shared/countryNames.js";

import { startMockServer } from "../src/remote/mockServer.js";
import { RemoteClient } from "../src/remote/restClient.js";
import { AuditLogger } from "../src/shared/audit.js";

import { CaseStore } from "../src/shared/caseStore.js";
import { handleTravelInquiry } from "../src/uc03/workflow.js";
import { createUc03Handler } from "../src/uc03/server.js";
import { classifyTravelInquiryRuleBased } from "../src/uc03/classifier.js";

import { AuthorizationStore } from "../src/uc04/authorizationStore.js";
import { handleWorkationRequest } from "../src/uc04/workflow.js";
import { createUc04Handler } from "../src/uc04/server.js";
import { draftSummary } from "../src/uc04/requestParser.js";

import { DossierStore as RelocationStore } from "../src/uc07/dossierStore.js";
import { handleRelocationReview } from "../src/uc07/workflow.js";
import { createUc07Handler } from "../src/uc07/server.js";
import { draftNarrative as draftRelocationNarrative } from "../src/uc07/dossierBuilder.js";
import { parseRelocationRuleBased } from "../src/uc07/relocationParser.js";

import { DossierStore } from "../src/uc08/dossierStore.js";
import { handleTaxInquiry } from "../src/uc08/workflow.js";
import { createUc08Handler } from "../src/uc08/server.js";
import { draftNarrative } from "../src/uc08/dossierBuilder.js";
import { parseInquiryRuleBased } from "../src/uc08/inquiryParser.js";

import { callHandler, renderSidebar, rowValue, servedBy, textOf } from "./fixtures/zafSidebar.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const ASSETS = join(ROOT, "zaf-app", "assets");
const read = (file) => readFileSync(join(ASSETS, file), "utf8");

/** country.js + its generated map, loaded the way iframe.html loads them. */
function loadCountry() {
  const context = { window: {}, Object: Object, String: String };
  vm.createContext(context);
  new vm.Script(read("countryNames.js"), { filename: "countryNames.js" }).runInContext(context);
  new vm.Script(read("country.js"), { filename: "country.js" }).runInContext(context);
  return context.window;
}

// ---------------------------------------------------------------------------
// 1. The bundled copy is generated, and it agrees with the module
// ---------------------------------------------------------------------------

test("the bundled country map is exactly src/shared/countryNames.js, both directions", () => {
  const { CXCountryNames } = loadCountry();
  const bundled = Object.keys(CXCountryNames);
  const source = nameableCountryCodes();

  assert.equal(
    bundled.length,
    source.length,
    "zaf-app/assets/countryNames.js has drifted from src/shared/countryNames.js — regenerate it with the recipe in its header"
  );
  // NOT just a count. A code swapped for another code keeps the count and is
  // exactly the drift this check is for.
  for (const code of source) {
    assert.equal(CXCountryNames[code], countryName(code), `${code} is named differently in the bundle`);
  }
  for (const code of bundled) {
    assert.ok(source.includes(code), `the bundle names ${code}, which the module does not know`);
  }
});

test("the generated map is data and nothing else", () => {
  // A generated file that grew logic is a file somebody will hand-edit, and the
  // next regeneration deletes their edit without saying so.
  const source = read("countryNames.js").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.ok(!/\bfunction\b|=>/.test(source), "countryNames.js holds logic — it must be data only");
  assert.ok(/window\.CXCountryNames = Object\.freeze\(/.test(source), "the map must be frozen");
});

// ---------------------------------------------------------------------------
// 2. The transform, in both directions
// ---------------------------------------------------------------------------

test("a code becomes the country's name, and a phrase of codes becomes a phrase of names", () => {
  const { CXCountry } = loadCountry();
  assert.equal(CXCountry.text("PT"), "Portugal");
  assert.equal(CXCountry.text("nl"), "Netherlands");
  assert.equal(CXCountry.text("DE → ES"), "Germany → Spain");
  assert.equal(CXCountry.text("ES–NL"), "Spain–Netherlands");
  assert.equal(CXCountry.text("NL, PT"), "Netherlands, Portugal");
  // A pair KEY, the shape src/uc07/dossierView.js builds routes with.
  assert.equal(CXCountry.text("PT|US"), "Portugal|United States");
});

test("a country the server already sent as a NAME survives byte-for-byte", () => {
  // THE FAILURE THIS FORBIDS. countryLabel() in src/shared uppercases whatever
  // it is given before looking it up, so a name handed to it round-trips as
  // "PORTUGAL" — and countryName() would answer null, which a careless caller
  // renders as "not stated". Both are wrong, and both are silent. The browser
  // helper touches nothing that is not exactly a two-letter token.
  const { CXCountry } = loadCountry();
  for (const already of [
    "Portugal",
    "Netherlands–Portugal double taxation convention",
    "not stated",
    "no gap on record; coverage unconfirmed",
  ]) {
    assert.equal(CXCountry.text(already), already);
  }
});

test("a code the list cannot name keeps its code, and an absence stays an absence", () => {
  const { CXCountry } = loadCountry();
  // XK (Kosovo) is user-assigned: the reader can still look it up or quote it,
  // which a blank or the word "unknown" cannot be.
  assert.equal(CXCountry.text("XK"), "XK");
  assert.equal(CXCountry.text(""), "not stated");
  assert.equal(CXCountry.text(null), "not stated");
  assert.equal(CXCountry.text(undefined, "—"), "—");
  assert.equal(CXCountry.name("XK"), null, "no name may ever be invented for an unnameable code");
});

test("the code survives beside the name only where somebody may quote it", () => {
  const { CXCountry } = loadCountry();
  assert.equal(CXCountry.nameAndCode("PT"), "Portugal (PT)");
  assert.equal(CXCountry.nameAndCode("XK"), "XK", "an unnameable code is not printed twice");
  assert.equal(CXCountry.join(["NL", "PT"], "—", "withCode"), "Netherlands (NL), Portugal (PT)");
  assert.equal(CXCountry.join([], "—"), "—");
});

test('"no" is not Norway — a two-letter value is never named outside a country field', () => {
  // THE HAZARD, BY NAME, and the reason the row rule is a list of labels rather
  // than a guess at the shape. UC-04's role dimension really does publish
  // {label: "Contract-signing authority", value: "no"} — and "no" IS Norway's
  // ISO code. A renderer that mapped every short value would print
  // "Contract-signing authority: Norway" on a mobility approval screen.
  const { CXCountry } = loadCountry();
  assert.equal(CXCountry.row("Contract-signing authority", "no"), "no");
  assert.equal(CXCountry.row("Job duties", "IT"), "IT");
  assert.equal(CXCountry.row("Recorded status", "known gap"), "known gap");
  // And the same value under a country label IS named.
  assert.equal(CXCountry.row("Destination", "PT"), "Portugal");
  assert.equal(CXCountry.row("Nationality → destination", "DE → ES"), "Germany → Spain");
});

test("every label the browser treats as a country is a label a server actually emits", () => {
  // A LIST OF SERVER STRINGS HELD IN THE BROWSER DRIFTS, and the drift is
  // silent in the safe direction (a renamed label simply renders its code
  // again, exactly as it did before this change). Silent is still wrong, so a
  // rename fails here instead.
  const { CXCountry } = loadCountry();
  const labels = Object.keys(CXCountry.countryValuedLabels);
  assert.ok(labels.length > 0, "the registry is empty — no evidence row would be named at all");

  const sources = [];
  for (const dir of readdirSync(join(ROOT, "src"), { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    for (const file of readdirSync(join(ROOT, "src", dir.name))) {
      if (file.endsWith(".js")) sources.push(readFileSync(join(ROOT, "src", dir.name, file), "utf8"));
    }
  }
  const haystack = sources.join("\n");
  // A LABEL MAY BE COMPOSED RATHER THAN TYPED. src/uc03/policyEngine.js builds
  // its itinerary rows as `${noun} as stated` / `${noun} as read`, choosing by
  // whether the traveller typed the value or a classifier read it out of their
  // prose — so neither finished label appears as a literal anywhere, and a
  // scan for the exact string reports both as unemitted.
  //
  // That is a real limit of scanning source rather than driving the code, and
  // it is stated instead of hidden: a composed label is accepted when its NOUN
  // and its provenance suffix both appear at the composition site. Narrow on
  // purpose — a wholly invented label still fails.
  const composed = (label) => {
    const m = /^(.+) as (stated|read)$/.exec(label);
    if (!m) return false;
    return haystack.includes(`\`\${noun} as ${m[2]}\``) && haystack.includes(JSON.stringify(m[1]));
  };
  for (const label of labels) {
    assert.ok(
      haystack.includes(JSON.stringify(label)) || haystack.includes(`"${label}"`) || composed(label),
      `no server emits the label ${JSON.stringify(label)} — it was renamed, and that row is printing a code again`
    );
  }
});

test("no server emits a country-valued row under a label the registry does not know", () => {
  // THE OTHER DIRECTION, and it is the one that produced the complaint. The
  // test above catches a label being RENAMED off the registry. This one catches
  // a label being ADDED to a server and never added here — which is exactly how
  // a row comes to print `DE` on a screen where every other country reads as a
  // name, silently, with the suite green.
  //
  // The project owner, on a live UC-03 case, pointing at one row: "Destination
  // as read — DE". Nothing failed. Nothing could: the registry is a list of
  // strings and the servers are the only place those strings are written, so
  // the two can only be compared by reading both.
  //
  // WHY THIS SCAN AND NOT A SHAPE GUESS. Because the shape guess is unsafe for
  // the reason the "no"/Norway test one block up demonstrates. So the scan is
  // over the SOURCE EXPRESSION beside each label: a row whose value is built
  // from a destination, a home country, a nationality, a jurisdiction or a
  // country pair is a country row, and its label belongs on the list.
  const { CXCountry } = loadCountry();
  const known = CXCountry.countryValuedLabels;

  // Rows whose value expression names one of these is a country row.
  const COUNTRY_VALUED = /(destination(?!_country_unsupported)|homeCountry|home_country|countryCode|country_code|nationality|jurisdictions?\b|countryPair|\bpair\b)/i;
  // …unless the row is about the country as a SUBJECT rather than a value:
  // "Which immigration route this employee actually needs" is prose whose
  // expression happens to mention a destination.
  const PROSE = /^[A-Z][^"]{0,200}[a-z]{3}\s+[a-z]{3}/;

  const offenders = [];
  for (const dir of readdirSync(join(ROOT, "src"), { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    for (const file of readdirSync(join(ROOT, "src", dir.name))) {
      if (!file.endsWith(".js")) continue;
      const src = readFileSync(join(ROOT, "src", dir.name, file), "utf8");
      // `{ label: "X", value: <expr> }` and `fact("X", <expr>` — the two row
      // shapes main.js renders through CXCountry.row().
      const patterns = [
        /\{\s*label:\s*"([^"]+)",\s*value:\s*([^,}\n]{0,120})/g,
        /\bfact\(\s*"([^"]+)",\s*([^,)\n]{0,120})/g,
      ];
      for (const re of patterns) {
        let m;
        while ((m = re.exec(src)) !== null) {
          const [, label, expr] = m;
          if (known[label]) continue;
          if (!COUNTRY_VALUED.test(expr)) continue;
          if (PROSE.test(expr.trim().replace(/^"/, ""))) continue;
          offenders.push(`${dir.name}/${file}: {label: ${JSON.stringify(label)}, value: ${expr.trim()}}`);
        }
      }
    }
  }

  assert.deepEqual(
    offenders,
    [],
    "these rows carry a country and their label is not in country.js's COUNTRY_VALUED_LABELS, so they will print a " +
      "two-letter code on a screen where every other country reads as a name:\n  " + offenders.join("\n  ")
  );
});

// ---------------------------------------------------------------------------
// 3. Nothing named is ever compared, posted or stored
// ---------------------------------------------------------------------------

test("a named country never reaches a request body", () => {
  // The whole division is "codes decide, names are read", and the browser is
  // the one place where a display transform sits inches from a POST. Asserted
  // structurally rather than argued: no line that names a country may also be
  // building a request.
  for (const file of ["main.js", "panels.js"]) {
    const lines = read(file).split("\n");
    lines.forEach((line, i) => {
      if (!/CXCountry|COUNTRY\./.test(line)) return;
      assert.ok(
        !/JSON\.stringify|body:|\.post\(|cxRequest\(/.test(line),
        `${file}:${i + 1} builds a request on a line that names a country — a name must never leave the browser`
      );
    });
  }
});

// ---------------------------------------------------------------------------
// 4. The cases a specialist actually reads
// ---------------------------------------------------------------------------

const fakeJudge = async () => ({ verdict: "not_evaluated", reason: null });

let mock;
let remote;
before(async () => {
  mock = await startMockServer(0);
  remote = new RemoteClient({ baseUrl: "http://localhost:" + mock.address().port });
});
after(() => mock && mock.close());

async function render(uc, setting, ticketId, view) {
  const base = "http://" + uc.toLowerCase() + ".countrynames.test";
  return renderSidebar({
    settings: { apiBaseUrl: "", [setting]: base },
    ticketId,
    respond: servedBy(base, view),
  });
}

test("UC-03 names the destination, and the letter offer carries the code a consulate wants", async () => {
  const caseStore = new CaseStore();
  await handleTravelInquiry(
    {
      externalRef: "77301",
      employmentId: "emp_active_001",
      session: { authenticatedEmploymentId: "emp_active_001" },
      text:
        "I'm travelling to Spain for a client meeting from September 14 to October 2, 2026. " +
        "Can you confirm business travel is fine?",
    },
    { remote, audit: new AuditLogger(), caseStore, classify: classifyTravelInquiryRuleBased }
  );
  const handler = createUc03Handler({ caseStore, audit: new AuditLogger(), remote });
  const answer = await callHandler(handler, { method: "GET", path: "/api/cases/by-ticket/77301" });
  assert.equal(answer.body.found, true);
  // If the record stopped carrying a CODE this test would be asserting nothing.
  assert.equal(answer.body.caseRow.classification.destinationCountry, "ES", "the stored value must stay a code");

  const { root, text } = await render("UC-03", "uc03ApiBaseUrl", 77301, answer.body);
  assert.equal(rowValue(root, "Destination"), "Spain", "the case row still prints a code");
  // The offer block is a reference somebody repeats to a consulate, so it is
  // the one place on this screen the code belongs beside the name.
  assert.ok(text.includes("Spain (ES)"), "the letter offer lost the reference form");
});

test("UC-04's trip line reads as two countries, not two abbreviations", async () => {
  const store = new AuthorizationStore();
  await handleWorkationRequest(
    {
      externalRef: "77401",
      employmentId: "emp_active_001",
      session: { companyId: "co_amend_01", authenticatedAdminId: "admin_jane" },
      factors: {
        homeCountry: "DE",
        nationality: "DE",
        destination: { country: "ES" },
        startDate: "2026-09-01",
        endDate: "2026-09-14",
        visaType: "schengen_short_stay",
        jobDuties: "engineering",
        hasContractSigningAuthority: false,
      },
      travelHistory: [{ country: "ES", startDate: "2026-04-01", endDate: "2026-07-15" }],
      now: "2026-08-15",
    },
    // BOTH LLM SEAMS INJECTED. A genuine but unreachable OPENAI_API_KEY in this
    // container's .env is enough to make an uninjected call real, slow and
    // failing — CLAUDE.md §6, and the reason a jump in the suite's duration is
    // itself a hermeticity check.
    {
      remote,
      audit: new AuditLogger(),
      authorizationStore: store,
      draftSummary: (args) => draftSummary(args, { isConfigured: () => false }),
      judge: fakeJudge,
    }
  );
  const handler = createUc04Handler({ authorizationStore: store, audit: new AuditLogger(), remote });
  const answer = await callHandler(handler, { method: "GET", path: "/api/authorizations/by-ticket/77401" });
  assert.equal(answer.body.found, true);
  assert.equal(answer.body.basis.trip.destination, "ES", "the decision facts must keep the code");

  const { text } = await render("UC-04", "uc04ApiBaseUrl", 77401, answer.body);
  assert.ok(text.includes("Germany → Spain"), "the trip route still prints codes");
  assert.ok(text.includes("Germany national"), "the nationality still prints a code");
  // The treaty dimension's own evidence row, named through the label registry.
  assert.ok(
    text.includes("Nationality → destination Germany → Spain"),
    "the nationality-pair evidence row still prints codes"
  );
});

test("both 🔴 dossiers name their jurisdictions, and keep the disclaimer above the analysis", async () => {
  // UC-07 — the route a mobility specialist orients by.
  const relocations = new RelocationStore();
  await handleRelocationReview(
    {
      text: "We're permanently relocating our engineer from Spain to the Netherlands.",
      employmentId: "emp_active_001",
      externalRef: "77701",
      source: "seed",
      plan: {
        destinationSupported: true,
        destinationEntityActive: true,
        annualGrossSalaryRemoteInteger: 6500000,
        currency: "EUR",
        months: 12,
        minimumVisaSalaryRemoteInteger: 5500000,
        creationDate: "2026-05-01",
        proposedStartDate: "2026-07-01",
        destinationStartDate: "2026-07-01",
        sourceTerminationDate: "2026-06-30",
        sourceLastWorkingDay: "2026-06-30",
        minimumOnboardingLeadTimeBusinessDays: 20,
        immigrationSupportRequired: false,
        immigrationConfirmed: true,
        rightToWorkConfirmed: true,
        destinationStartDateConfirmed: true,
        sourceExitPlanValidated: true,
        employerPresenceInDestination: true,
        taxTreatyNexusConfirmed: true,
        ptoTransferAllowed: true,
        sourcePtoDays: 12,
        seniorityPreservable: true,
      },
    },
    {
      audit: new AuditLogger(),
      dossierStore: relocations,
      classify: parseRelocationRuleBased,
      draftNarrative: (args) => draftRelocationNarrative(args, { isConfigured: () => false }),
      judge: fakeJudge,
    }
  );
  const uc07 = await callHandler(createUc07Handler({ dossierStore: relocations }), {
    method: "GET",
    path: "/api/dossiers/by-ticket/77701",
  });
  assert.equal(uc07.body.found, true);
  const seven = await render("UC-07", "uc07ApiBaseUrl", 77701, uc07.body);
  assert.equal(rowValue(seven.root, "Route"), "Spain → Netherlands", "the relocation route still prints codes");

  // UC-08 — the densest page of jurisdictions in the product.
  const dossiers = new DossierStore();
  await handleTaxInquiry(
    {
      externalRef: "77801",
      employmentId: "emp_active_001",
      source: "seed",
      text:
        "I have been splitting my time between the Netherlands and Portugal this year and I think I " +
        "may be a dual resident of both countries for tax purposes. Can you help?",
      now: "2026-08-20",
    },
    {
      audit: new AuditLogger(),
      dossierStore: dossiers,
      classify: parseInquiryRuleBased,
      draftNarrative: (args) => draftNarrative(args, { isConfigured: () => false }),
      judge: fakeJudge,
    }
  );
  const uc08 = await callHandler(createUc08Handler({ dossierStore: dossiers, audit: new AuditLogger() }), {
    method: "GET",
    path: "/api/dossiers/by-ticket/77801",
  });
  assert.equal(uc08.body.found, true);
  assert.deepEqual(uc08.body.dossierRow.jurisdictions, ["NL", "PT"], "the dossier must keep storing codes");
  const eight = await render("UC-08", "uc08ApiBaseUrl", 77801, uc08.body);
  assert.equal(
    rowValue(eight.root, "Jurisdictions"),
    "Netherlands (NL), Portugal (PT)",
    "the jurisdictions row is the one place both belong — a treaty index is keyed by the code"
  );

  // AND THE GUARANTEE THAT MUST SURVIVE ANY COSMETIC PASS: the 🔴 framing
  // statement, verbatim, ABOVE the analysis it qualifies. Renaming countries
  // touched neither, and this is where that is checked rather than assumed.
  for (const [label, screen, disclaimer, firstFinding] of [
    ["UC-07", seven, "RESEARCH SUPPORT ONLY — not a relocation decision or a legal, immigration, or tax determination.", "Route"],
    ["UC-08", eight, "RESEARCH SUPPORT ONLY — not a residency, withholding, or coverage determination.", "Jurisdictions"],
  ]) {
    const page = textOf(screen.root);
    assert.ok(page.includes(disclaimer), `${label} lost its framing statement`);
    assert.ok(
      page.indexOf(disclaimer) < page.indexOf(firstFinding),
      `${label}'s framing statement no longer sits above the analysis`
    );
  }
});
