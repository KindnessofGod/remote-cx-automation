// ---------------------------------------------------------------------------
// zafNoDeveloperArtifacts.test.js — the sidebar is a customer-facing surface
// ---------------------------------------------------------------------------
// WHY THIS EXISTS. The project owner opened the panel to show it to an audience
// and found repository internals in the middle of customer-facing prose: source
// file paths, `docs/knowledge/...md` citations, internal register ids (C-8,
// K-4), role slugs (`uc04:mobility_specialist`), refusal codes
// (`approver_not_entitled`), decision slugs (`all_gates_passed`) and raw UUIDs
// where a person's name belongs.
//
// THE RULE ALREADY EXISTED AND THIS SURFACE WAS MISSED. On 2026-08-29 the
// public surfaces — /portal, /audit, /queue — were stripped of exactly this
// class of leak ("internal issue ids and src/ paths", CLAUDE.md §4). The ZAF
// sidebar is served by Zendesk out of zaf-app/, not by that deployment, so it
// was not in that pass. This test extends the same rule to it.
//
// WHY IT ASSERTS ON THE RENDERED PAGE AND NOT ON THE PAYLOAD. The API may
// legitimately publish a `path` — it is how a reviewer with repo access finds
// the document. What must not happen is that string reaching a screen. So this
// renders the REAL main.js/panels.js into the fake DOM and reads the text that
// came out, which is the only place the question can honestly be asked.
//
// A CITATION IS NOT WEAKENED BY LOSING ITS FILE PATH. What makes it checkable
// is the publisher, the instrument, the article locator and the retrieval
// standing — "Regulation (EU) 2016/399, art. 6(1), [CONFIRMED — statute,
// retrieved 2026-08-19]" — every one of which still renders. The repo path only
// ever told a reader where OUR COPY lives, which is not a fact about the law.
// ---------------------------------------------------------------------------

import { test } from "node:test";
import assert from "node:assert/strict";

import { AuditLogger } from "../src/shared/audit.js";
import { AuthorizationStore } from "../src/uc04/authorizationStore.js";
import { RemoteClient } from "../src/remote/restClient.js";
import { createInProcessFetch } from "../src/remote/mockServer.js";
import { handleWorkationRequest, submitWorkationApproval } from "../src/uc04/workflow.js";
import { draftSummary } from "../src/uc04/requestParser.js";
import { createUc04Handler } from "../src/uc04/server.js";
import { renderSidebar, callHandler } from "./fixtures/zafSidebar.js";
import { renderPanel, USE_CASES } from "./fixtures/nineSidebarPanels.js";

const offline = { isConfigured: () => false };
const fakeDraftSummary = (a) => draftSummary(a, offline);
const fakeJudge = async () => ({ verdict: "not_evaluated", reason: null });

function world() {
  return {
    audit: new AuditLogger(),
    authorizationStore: new AuthorizationStore(),
    remote: new RemoteClient({ baseUrl: "http://mock.remote.invalid", fetchImpl: createInProcessFetch() }),
  };
}

/** A case that has passed every gate and been approved by the employer — the
 *  richest UC-04 panel there is, and the one the owner was looking at. */
async function approvedCase(w, externalRef) {
  const created = await handleWorkationRequest(
    {
      employmentId: "emp_active_001",
      session: { companyId: "co_amend_01", authenticatedAdminId: "admin_jane" },
      factors: {
        homeCountry: "DE", nationality: "DE", destination: { country: "ES" },
        startDate: "2026-09-01", endDate: "2026-09-14", visaType: "schengen_short_stay",
        jobDuties: "engineering", hasContractSigningAuthority: false,
      },
      now: "2026-08-15",
      externalRef,
    },
    { ...w, draftSummary: fakeDraftSummary, judge: fakeJudge }
  );
  await submitWorkationApproval(
    { authorizationId: created.authorizationId, action: "approve", approver: "manager@company.test", note: "Fine by me." },
    { ...w, entitlement: null }
  );
  return created;
}

async function panelText(externalRef = "9701") {
  const w = world();
  const handler = createUc04Handler(w);
  await approvedCase(w, externalRef);
  const base = "http://uc04.test";
  const screen = await renderSidebar({
    settings: { apiBaseUrl: "", uc04ApiBaseUrl: base },
    ticketId: externalRef,
    respond: async (url) =>
      String(url).indexOf(base) === 0
        ? await callHandler(handler, { method: "GET", path: String(url).slice(base.length) })
        : { status: 404, body: { found: false } },
  });
  return screen.text;
}

// Each pattern is something a reader outside this repository cannot act on and
// should never have been shown. The label is what a failure will print.
const FORBIDDEN = [
  [/\bsrc\/[a-z0-9]+\//i, "a source-tree path"],
  [/\bdocs\/[a-z0-9]/i, "a docs/ path"],
  [/[A-Za-z0-9._-]+\.(?:js|mjs|md|json)\b/, "a repository filename"],
  [/\bCONTRADICTIONS\b/, "the name of an internal register"],
  [/\buc0\d:[a-z_]+/, "an internal role slug"],
  [/\ball_gates_passed\b|\bapprover_not_entitled\b|\bapprover_entitlement_not_configured\b/, "an internal code"],
  [/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/, "a raw UUID"],
];

/* ALL NINE, OPENED FOR REAL — and the two leaks this found are the argument for
   it (2026-08-31). The first version of this file rendered UC-04 only, because
   UC-04 was the panel that had been reported. Asked to open the other eight,
   it found two more that nothing else could have:

     · UC-01 printed `uc01:hr_ops` in the middle of a sentence about who
       decides. Not caught by the prose check, which reads decisionSources /
       decisionFacts — this string is composed in panels.js.
     · UC-08 cited the Dutch residence article and rendered a passage naming
       `src/uc04/riskMatrix.js` and `src/uc04/decisionFacts.js` — our own source
       files, quoted to a customer as though they were part of Netherlands tax
       law. Not caught by anything, because the string lives in a GENERATED
       corpus built from a retrieved document nobody would think to scan for
       source paths.

   The lesson is the one this repository keeps paying for: a check that covers
   the case somebody happened to seed reports clean on everything it never
   looked at. */
for (const useCase of USE_CASES) {
  test(`no developer artifact reaches the rendered ${useCase} sidebar`, async () => {
    const text = await renderPanel(useCase);
    const found = [];
    for (const [re, label] of FORBIDDEN) {
      const global = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
      let m;
      while ((m = global.exec(text)) !== null) {
        const at = Math.max(0, m.index - 90);
        found.push(`${label}: ${JSON.stringify(m[0])}\n      …${text.slice(at, m.index + m[0].length + 60)}…`);
      }
    }
    assert.deepEqual(
      found,
      [],
      `${useCase}'s sidebar is showing repository internals to a customer:\n   ${found.join("\n   ")}`
    );
  });
}

test("...and the citations are still checkable without their file paths", async () => {
  const text = await panelText("9702");
  // What makes a citation verifiable is the instrument, the locator, the
  // publisher and the retrieval standing. If stripping the path had taken any
  // of those with it, the panel would be quieter AND less honest.
  assert.match(text, /Regulation \(EU\) 2016\/399/, "the instrument itself must still be named");
  assert.match(text, /Article 6\(1\)/, "the article locator must survive");
  assert.match(text, /CONFIRMED — statute, retrieved 2026-08-19/, "the retrieval standing must survive");
  // And the caveats still say what they dispute, without their register ids.
  assert.match(text, /residence permit or long-stay visa/, "a caveat's substance must survive losing its id");
});

// ---------------------------------------------------------------------------
// THREE COPIES OF ONE RULE, HELD EQUAL. `shortRef` exists in main.js, in
// panels.js and as `shortReference()` in src/shared/publicReference.js. Three
// copies of four lines is a deliberate trade: the two browser files are
// separate <script> tags with no module system between them, and the server
// composes some of this prose itself. What is NOT acceptable is the three
// drifting, which is the failure test/n8nParity.test.js exists to prevent for
// the gates — so the same discipline is applied here.
// ---------------------------------------------------------------------------
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { shortReference } from "../src/shared/publicReference.js";

/** Lift a named function out of a browser file and run it for real. */
function liftShortRef(file) {
  const src = readFileSync(new URL(`../zaf-app/assets/${file}`, import.meta.url), "utf8");
  const m = /var UUID_RE = [^\n]+\n\s*function shortRef\(value\) \{[\s\S]*?\n\s*\}/.exec(src);
  assert.ok(m, `could not lift shortRef out of ${file} — this check is now blind, which is worse than a failure`);
  const ctx = { String };
  vm.createContext(ctx);
  vm.runInContext(`${m[0]}\nglobalThis.__f = shortRef;`, ctx);
  return ctx.__f;
}

test("main.js, panels.js and the server shorten identifiers identically", () => {
  const impls = { "main.js": liftShortRef("main.js"), "panels.js": liftShortRef("panels.js"), server: shortReference };
  const cases = [
    ["45cca190-3627-41f7-ac07-e5dfc432d47b", "45cca190"],
    ["EMP_ACTIVE_001", "EMP_ACTIVE_001"],           // not a UUID — untouched
    ["manager@company.test", "manager@company.test"], // already readable
    ["9501", "9501"],                                 // a ticket number
    ["", ""],
    // A prefix is a PREFIX, so the short form must still be findable by search
    // against the full id — a hash would not be.
    ["cc229f02-e55b-4343-8a73-cd2d497ae1a7", "cc229f02"],
  ];
  for (const [input, expected] of cases) {
    for (const [name, fn] of Object.entries(impls)) {
      assert.equal(fn(input), expected, `${name} disagreed on ${JSON.stringify(input)}`);
    }
  }
  // Absent values must not become the string "null"/"undefined" anywhere.
  for (const [name, fn] of Object.entries(impls)) {
    assert.equal(fn(null), "", `${name} rendered null`);
    assert.equal(fn(undefined), "", `${name} rendered undefined`);
  }
});

// ---------------------------------------------------------------------------
// EVERY PANEL, NOT JUST THE ONE THAT WAS REPORTED.
//
// The render check above proves UC-04 is clean, because that is the panel a
// reader opened and objected to. It cannot prove the other eight: rendering
// them needs nine seeded stores and nine handlers, and a test that covers only
// what somebody happened to seed is how the leak survived in the first place.
//
// So the id rule is asserted STRUCTURALLY, over the panel definitions
// themselves. Every use case's rows() printed a bare `employmentId` and
// `requester`; UC-04's were fixed when it was reported and the other eight were
// not, which is exactly the gap the project owner asked about.
// ---------------------------------------------------------------------------
test("no panel renders a bare record identifier", () => {
  const panels = readFileSync(new URL("../zaf-app/assets/panels.js", import.meta.url), "utf8");
  // An id-shaped field printed straight into a row, with nothing shortening it.
  const bare = panels.match(
    /value: show\(\s*\w+\.(?:employmentId|requester|expenseId|amendmentId|dossierId|adjustmentId|resignationId|authorizationId|caseId)\s*\)/g
  );
  assert.deepEqual(
    bare ?? [],
    [],
    "a panel prints a raw record id where a reader expects something they can use — wrap it in shortRef()"
  );
  // And the transform is actually reached: a guard that passes because the
  // rows were deleted would be worse than the leak.
  assert.ok(
    (panels.match(/show\(shortRef\(/g) || []).length >= 15,
    "the id rows have gone missing rather than been shortened"
  );
});
