// ---------------------------------------------------------------------------
// n8nUc07TerminalZendeskNodes.test.js — UC-07's one terminal Zendesk node must
// interpolate the dossier's own framing, not a paraphrase that drops half of it
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
//
// A Zendesk "update ticket" node carries no `jsCode`, so `verify-deployed`'s
// body diff is structurally blind to it. `Escalate Relocation Ticket` wrote a
// hand-typed disclaimer onto a Tier-3 specialist's ticket, and that disclaimer
// was a PARAPHRASE of `dossier.framing` with its second half missing:
//
//   node:    "RESEARCH SUPPORT ONLY, not a decision to proceed."
//   dossier: "RESEARCH SUPPORT ONLY — not a relocation decision or a legal,
//             immigration, or tax determination. For review by a qualified
//             Mobility Legal specialist (Tier-3)."
//
// The half it dropped is the half that covers what the note then prints:
// the narrative's immigration, tax and permanent-establishment findings, and
// the dossier's `requiredActions` of IMMIGRATION_ASSESSMENT / PE_REVIEW /
// TAX_REVIEW.
//
// `test/n8nUc07Parity.test.js` cannot cover this. It deep-equals the whole
// DOSSIER against `buildDossier()`'s — including `framing` — and passes with
// flying colours while the ticket carries a different sentence, because the
// ticket's sentence is not in the dossier at all.
//
// This file holds two different things:
//   1. THE NODE PARAMETERS, against
//      `workflows/nodes-uc07/terminalZendeskNodesSpec.js` and against the LIVE
//      NODE AS CAPTURED, used as a NEGATIVE CONTROL.
//   2. THE RENDERED PROSE — `composeInternalNote()` executed on a real gates
//      run, because the spec's phrase list guards the EXPRESSION and cannot see
//      the output.
//
// HERMETIC. No network, no n8n key. The live node is a verbatim snapshot from
// `GET /api/v1/workflows/WORKFLOW_UC07_ID` on 2026-08-31 (`versionId ===
// activeVersionId === 3f8983a9-2aed-44f2-90c6-af773fc2e446`, 12 nodes,
// `active: true`).
// ---------------------------------------------------------------------------

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";
import {
  ESCALATE_NODE_NAME,
  TERMINAL_NODE_TYPE,
  TERMINAL_NODE_NAMES,
  TERMINAL_NODE_SPECS,
  ESCALATE_PARAMETERS,
  INTERNAL_NOTE_INTERPOLATION,
  DOSSIER_REF_LABEL,
  DOSSIER_REF_INTERPOLATION,
  ROUTING_NOTE_INTERPOLATION,
  INTERNAL_NOTE_EXPRESSION,
  TICKET_ID_EXPRESSION,
  ZENDESK_GROUP_EXPRESSION,
  ROUTING_TAG_EXPRESSION,
  QUEUE_TAG_EXPRESSION,
  ESCALATED_TAG,
  ESCALATE_STATUS,
  FORBIDDEN_PHRASES,
  FORBIDDEN_DECISION_VERBS,
  UC07_WORKFLOW_ID,
  findDecisionVerb,
  terminalZendeskNodeIssues,
  escalateNodeIssues,
} from "../workflows/nodes-uc07/terminalZendeskNodesSpec.js";
import { buildDossier } from "../src/uc07/dossierBuilder.js";
import { findHarnessVocabulary } from "../src/zendesk/ticketHygiene.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const NODES_DIR = join(__dirname, "..", "workflows", "nodes-uc07");
const GATES_PATH = join(NODES_DIR, "relocationGates.js");
const gatesSource = readFileSync(GATES_PATH, "utf8");

// ---------------------------------------------------------------------------
// The live node, verbatim. THE NEGATIVE CONTROL.
// ---------------------------------------------------------------------------

const LIVE_ESCALATE_BEFORE_FIX = {
  name: ESCALATE_NODE_NAME,
  type: "n8n-nodes-base.zendesk",
  parameters: {
    authentication: "oAuth2",
    operation: "update",
    id: "={{ $('Relocation Gates').item.json.externalRef }}",
    updateFields: {
      group: "={{ $('Assign Routing').item.json.zendeskGroupId }}",
      internalNote:
        "=AI research dossier {{ $('Create Dossier Record').item.json.id }} — {{ $('Relocation Gates').item.json.dossier.narrative }} RESEARCH SUPPORT ONLY, not a decision to proceed. For review by a qualified Remote Mobility Legal specialist. {{ $('Assign Routing').item.json.routingNote }}",
      status: "open",
      tags: [
        "uc07_escalated",
        "={{ $('Assign Routing').item.json.routing.queueTag }}",
        "={{ $('Assign Routing').item.json.routingTag }}",
      ],
    },
  },
};

const targetNode = (name) => ({
  name,
  type: TERMINAL_NODE_TYPE,
  parameters: JSON.parse(JSON.stringify(TERMINAL_NODE_SPECS[name].parameters)),
});

// ---------------------------------------------------------------------------
// Running the real gates body, and lifting the composer out of it
// ---------------------------------------------------------------------------

function runGates(ticket) {
  const sandbox = {
    $: (nodeName) => {
      if (nodeName === "Normalize Relocation Request") return { first: () => ({ json: ticket }) };
      throw new Error(`Unexpected $() lookup for "${nodeName}"`);
    },
  };
  const result = vm.runInNewContext(`(function () {\n${gatesSource}\n})()`, sandbox, { timeout: 5000 });
  // node:vm results are cross-realm; n8n round-trips between nodes too.
  return JSON.parse(JSON.stringify(result[0].json));
}

const ticketFor = (text, plan) => ({
  externalRef: "7001",
  source: "webhook",
  employmentId: "emp_reloc_001",
  text,
  plan,
});

const BLOCKING_RUN = () =>
  runGates(
    ticketFor("I want to permanently relocate from Portugal to the Netherlands next quarter, and I need visa support.", {
      destinationSupported: true,
      destinationEntityActive: true,
      sourceCountry: "PT",
      destinationCountry: "NL",
      annualGrossSalaryRemoteInteger: 6500000,
      currency: "EUR",
      sourcePtoDays: 15,
    })
  );

const CLEAN_RUN = () =>
  runGates(
    ticketFor("Permanent relocation from the United States to Canada, all paperwork already confirmed.", {
      destinationSupported: true,
      destinationEntityActive: true,
      sourceCountry: "US",
      destinationCountry: "CA",
      annualGrossSalaryRemoteInteger: 9000000,
      currency: "USD",
      sourcePtoDays: 0,
      destinationStartDate: "2026-11-01",
      sourceTerminationDate: "2026-10-31",
      sourceLastWorkingDay: "2026-10-31",
      creationDate: "2026-08-31",
      minimumOnboardingLeadTimeBusinessDays: 10,
      immigrationSupportRequired: false,
      rightToWorkConfirmed: true,
      employerPresenceInDestination: true,
      taxTreatyNexusConfirmed: true,
      ptoTransferAllowed: true,
      seniorityPreservable: true,
      originalHireDate: "2020-01-06",
      destinationContractActive: true,
      destinationStartDateConfirmed: true,
      sourceExitPlanValidated: true,
    })
  );

const RUNS = [
  ["a blocking relocation", BLOCKING_RUN],
  ["a clean relocation", CLEAN_RUN],
];

/**
 * The words THIS REPOSITORY authors for the ticket: the composed note with the
 * two verbatim quotations subtracted.
 *
 * The subtraction is deliberate and is not a loophole — see the spec's header.
 * `narrative` and `framing` are `src/uc07/dossierBuilder.js`'s own reviewed
 * sentences and they use the forbidden verbs precisely to NEGATE them ("That is
 * NOT an approval — this use case has no execution path, and a human decides";
 * "the plan cannot proceed as proposed"). A bare scan over the whole note would
 * fire on exactly the disclaimers the note exists to carry, and the only way to
 * satisfy it would be to drop them.
 */
function scaffolding(out) {
  assert.ok(out.internalNote.includes(out.dossier.narrative), "the note does not carry the narrative verbatim");
  assert.ok(out.internalNote.includes(out.dossier.framing), "the note does not carry the framing verbatim");
  return out.internalNote.split(out.dossier.narrative).join("").split(out.dossier.framing).join("");
}

// ---------------------------------------------------------------------------
// 1. The target passes
// ---------------------------------------------------------------------------

test("the target parameter block passes its own checker", () => {
  assert.deepEqual(escalateNodeIssues(targetNode(ESCALATE_NODE_NAME)), []);
  assert.deepEqual(terminalZendeskNodeIssues(targetNode(ESCALATE_NODE_NAME)), []);
});

test("a node with no spec is refused rather than passed", () => {
  // A checker pointed at a node it has no opinion about must NOT return [],
  // because [] is what `verify-deployed` reads as "checked and clean".
  const issues = terminalZendeskNodeIssues({ name: "Some Other Zendesk Node", parameters: {} });
  assert.ok(issues.length > 0);
  assert.match(issues[0], /no terminal-node spec/);
  assert.ok(terminalZendeskNodeIssues(undefined).length > 0);
});

test("the note is composed upstream and the two downstream values are appended here", () => {
  const note = ESCALATE_PARAMETERS.updateFields.internalNote;
  assert.equal(note, INTERNAL_NOTE_EXPRESSION);
  assert.ok(note.includes(INTERNAL_NOTE_INTERPOLATION));
  // Addressed BY NODE NAME, never off `$json` — at this node `$json` is
  // whatever `Assign Routing` emitted. The wrong form yields an EMPTY note on a
  // fully green execution.
  assert.ok(note.includes("$('Relocation Gates')"));
  assert.ok(!/\{\{\s*\$json\.internalNote/.test(note));
  // The dossier row id and the routing sentence are produced DOWNSTREAM of the
  // gates and therefore cannot be composed into `internalNote`.
  assert.ok(note.includes(DOSSIER_REF_INTERPOLATION));
  assert.ok(note.includes(DOSSIER_REF_LABEL));
  assert.ok(note.includes(ROUTING_NOTE_INTERPOLATION));
  // The routing sentence is the answer to the note's own closing question, so
  // it comes last.
  assert.ok(note.indexOf(INTERNAL_NOTE_INTERPOLATION) < note.indexOf(DOSSIER_REF_INTERPOLATION));
  assert.ok(note.indexOf(DOSSIER_REF_INTERPOLATION) < note.indexOf(ROUTING_NOTE_INTERPOLATION));
});

test("the unchanged fields really are unchanged", () => {
  assert.equal(ESCALATE_PARAMETERS.authentication, "oAuth2");
  assert.equal(ESCALATE_PARAMETERS.operation, "update");
  assert.equal(ESCALATE_PARAMETERS.id, TICKET_ID_EXPRESSION);
  assert.equal(ESCALATE_PARAMETERS.updateFields.group, ZENDESK_GROUP_EXPRESSION);
  assert.equal(ESCALATE_PARAMETERS.updateFields.status, ESCALATE_STATUS);
  assert.deepEqual(ESCALATE_PARAMETERS.updateFields.tags, [
    ESCALATED_TAG,
    QUEUE_TAG_EXPRESSION,
    ROUTING_TAG_EXPRESSION,
  ]);
});

test("nothing on this 🔴 graph replies to the requester", () => {
  assert.equal(ESCALATE_PARAMETERS.updateFields.publicReply, undefined);
  const n = targetNode(ESCALATE_NODE_NAME);
  n.parameters.updateFields.publicReply = "={{ $('Relocation Gates').item.json.dossier.narrative }}";
  const issues = terminalZendeskNodeIssues(n, ESCALATE_NODE_NAME);
  assert.ok(issues.some((i) => i.includes("publicReply")));
  assert.ok(issues.some((i) => i.includes("🔴") || i.includes("specialist in between")));
});

// ---------------------------------------------------------------------------
// 2. NEGATIVE CONTROL — the live node must be REJECTED, for the right reasons
// ---------------------------------------------------------------------------

test("NEGATIVE CONTROL: the node as deployed today is rejected, for all four defects", () => {
  const issues = escalateNodeIssues(LIVE_ESCALATE_BEFORE_FIX);
  assert.ok(issues.length >= 4, `expected several failures, got: ${JSON.stringify(issues)}`);
  assert.ok(
    issues.some((i) => i.includes("internalNote") && i.includes(INTERNAL_NOTE_INTERPOLATION)),
    "the hand-typed inline note must be flagged"
  );
  assert.ok(
    issues.some((i) => i.includes("not a decision to proceed")),
    "the paraphrase that drops half the framing must be flagged BY NAME"
  );
  assert.ok(
    issues.some((i) => i.includes("research support only")),
    "a retyped disclaimer literal must be flagged BY NAME — it has to arrive as the dossier's own framing field"
  );
  assert.ok(
    issues.some((i) => i.includes("ai research dossier")),
    "UC-07's graph has no LLM node at all; the AI label must be flagged BY NAME"
  );
  assert.ok(
    issues.some((i) => i.includes("decision verb")),
    "'proceed' on a 🔴 ticket must be flagged as such, not only as a phrase"
  );
  // Its tags, group, status and id were already right — the checker must not
  // manufacture failures on fields the deploy does not touch.
  assert.ok(!issues.some((i) => i.includes("updateFields.status")));
  assert.ok(!issues.some((i) => i.includes("updateFields.group")));
  assert.ok(!issues.some((i) => i.includes("updateFields.tags")));
  assert.ok(!issues.some((i) => i.includes("parameters.id")));
});

test("NEGATIVE CONTROL: the live note really does drop half the canonical sentence", () => {
  // The defect, measured rather than asserted. Both halves of `framing` against
  // the string that was on the ticket.
  const framing = buildDossier({
    relocationType: "permanent_relocation",
    sourceCountry: "PT",
    destinationCountry: "NL",
    parseSource: "rule_based_fallback",
    verdict: "REVIEW",
    feasible: false,
    flags: [],
    requiredActions: [],
    mot: {},
    coverage: {},
    alignment: {},
    transition: {},
    pto: {},
    seniority: {},
    uncertainty: 0,
    costEstimate: {},
    citations: [],
    narrative: "n",
  }).framing;
  const liveNote = LIVE_ESCALATE_BEFORE_FIX.parameters.updateFields.internalNote;
  assert.ok(framing.includes("not a relocation decision"));
  assert.ok(framing.includes("legal, immigration, or tax determination"));
  assert.ok(!liveNote.includes("legal, immigration, or tax determination"), "the live note DOES carry the dropped half");
  assert.ok(!liveNote.includes(framing), "the live note is not the canonical sentence");
});

// ---------------------------------------------------------------------------
// 3. Per-regression mutations — each one caught on its own
// ---------------------------------------------------------------------------

const mutate = (patch) => {
  const n = targetNode(ESCALATE_NODE_NAME);
  n.parameters.updateFields = { ...n.parameters.updateFields, ...patch };
  return terminalZendeskNodeIssues(n, ESCALATE_NODE_NAME);
};

test("the interpolation replaced by an inline sentence is caught", () => {
  const issues = mutate({ internalNote: "=Research dossier for a specialist. {{ $('Assign Routing').item.json.routingNote }}" });
  assert.ok(issues.some((i) => i.includes(INTERNAL_NOTE_INTERPOLATION)));
});

test("a forbidden phrase reintroduced ALONGSIDE a correct interpolation is still caught", () => {
  // The subtle regression: somebody keeps the interpolation and appends the old
  // disclaimer back "so it is definitely on the ticket". The note then carries
  // the canonical sentence AND a paraphrase of it, which is worse than either.
  const issues = mutate({
    internalNote: `${INTERNAL_NOTE_EXPRESSION}\n\nRESEARCH SUPPORT ONLY, not a decision to proceed.`,
  });
  assert.ok(!issues.some((i) => i.includes("expected to interpolate")), "the interpolation itself is present");
  assert.ok(issues.some((i) => i.includes("not a decision to proceed")));
  assert.ok(issues.some((i) => i.includes("research support only")));
  assert.ok(issues.some((i) => i.includes("decision verb")));
});

test("a decision verb ANYWHERE in updateFields is caught, including in a tag", () => {
  // The 2026-08-29 Zendesk migration's lesson: a field-by-field walk misses the
  // copy inside a string inside another field. The check reads the whole blob.
  assert.ok(mutate({ tags: [ESCALATED_TAG, ROUTING_TAG_EXPRESSION, "uc07_approved"] }).some((i) => i.includes("decision verb")));
  assert.ok(mutate({ status: "open", group: "={{ $json.approver }}" }).some((i) => i.includes("decision verb")));
});

test("findDecisionVerb catches the stems, and clears prose that has none", () => {
  // Proven able to fail before it is trusted to pass, in both directions.
  for (const [text, stem] of [
    ["awaiting approval", "approv"],
    ["the manager approves it", "approv"],
    ["not authorised", "authoris"],
    ["authorization pending", "authoriz"],
    ["may proceed", "proceed"],
    ["proceeding to the next stage", "proceed"],
    ["sign off here", "sign off"],
    ["a signed off dossier", "signed off"],
    ["awaiting sign-off", "sign-off"],
    ["give the go ahead", "go ahead"],
    ["a go-ahead", "go-ahead"],
    ["greenlight it", "greenlight"],
    ["a green light", "green light"],
  ]) {
    assert.equal(findDecisionVerb(text), stem, text);
  }
  assert.equal(findDecisionVerb("a compiled research dossier for a specialist to read"), null);
  assert.equal(findDecisionVerb(null), null);
  assert.equal(findDecisionVerb(""), null);
  assert.ok(FORBIDDEN_DECISION_VERBS.length >= 8);
});

test("the routing sentence or the dossier reference dropped is caught", () => {
  assert.ok(mutate({ internalNote: `=${INTERNAL_NOTE_INTERPOLATION}` }).some((i) => i.includes("routingNote")));
  assert.ok(mutate({ internalNote: `=${INTERNAL_NOTE_INTERPOLATION}` }).some((i) => i.includes(DOSSIER_REF_INTERPOLATION)));
  assert.ok(
    mutate({ internalNote: `=${INTERNAL_NOTE_INTERPOLATION}\n\n${ROUTING_NOTE_INTERPOLATION}` }).some((i) =>
      i.includes(DOSSIER_REF_INTERPOLATION)
    )
  );
});

test("each tag dropped is caught — except the queue tag, which another spec owns", () => {
  assert.ok(mutate({ tags: [ROUTING_TAG_EXPRESSION] }).some((i) => i.includes(ESCALATED_TAG)));
  assert.ok(mutate({ tags: [ESCALATED_TAG] }).some((i) => i.includes("routingTag")));
  assert.ok(mutate({ tags: undefined }).length > 0);
  assert.ok(mutate({ tags: "uc07_escalated" }).length > 0);
  // Two checkers asserting one field is how a fix in one lands as a failure in
  // the other. escalationQueueTagSpec.js owns rca-iih7 / D-14.
  assert.deepEqual(
    mutate({ tags: [ESCALATED_TAG, ROUTING_TAG_EXPRESSION] }),
    [],
    "this checker must have no opinion about the queue tag"
  );
});

test("an EXTRA tag is not a regression", () => {
  const withGuard = [...ESCALATE_PARAMETERS.updateFields.tags, "uc_processed"];
  assert.deepEqual(mutate({ tags: withGuard }), []);
});

test("the group, the status and the ticket id are each caught", () => {
  assert.ok(mutate({ group: undefined }).some((i) => i.includes("group")));
  assert.ok(mutate({ group: "={{ $json.zendeskGroupId }}" }).some((i) => i.includes("group")));
  assert.ok(mutate({ status: "pending" }).some((i) => i.includes("status")));
  assert.ok(mutate({ status: "solved" }).some((i) => i.includes("status")));
  const n = targetNode(ESCALATE_NODE_NAME);
  n.parameters.id = "={{ $json.externalRef }}";
  assert.ok(terminalZendeskNodeIssues(n, ESCALATE_NODE_NAME).some((i) => i.includes("parameters.id")));
});

// ---------------------------------------------------------------------------
// 4. The interpolation names a field the gates node really emits
// ---------------------------------------------------------------------------

test("`internalNote` is really emitted by the gates body, for a real run", () => {
  // THE FAILURE THIS CATCHES IS SILENT IN PRODUCTION. An n8n expression that
  // dereferences a field nothing produces renders as an EMPTY STRING on a fully
  // green execution.
  const field = INTERNAL_NOTE_INTERPOLATION.match(/item\.json\.(\w+)/)?.[1];
  assert.equal(field, "internalNote");
  for (const [label, run] of RUNS) {
    const out = run();
    assert.equal(typeof out[field], "string", label);
    assert.ok(out[field].length > 500, `the composed note is empty or a stub for ${label}`);
  }
});

test("`internalNote` is a TOP-LEVEL field and is NOT inside the dossier", () => {
  // `test/n8nUc07Parity.test.js` deep-equals the whole dossier against
  // buildDossier()'s output. A note field added inside it would break parity —
  // and, worse, would be persisted into `uc07_dossiers.dossier` and rendered by
  // the ZAF panel, which is not what it is for.
  const out = BLOCKING_RUN();
  assert.equal(typeof out.internalNote, "string");
  assert.equal("internalNote" in out.dossier, false);
});

// ---------------------------------------------------------------------------
// 5. THE DEFECT — the framing arrives whole, and it arrives as the dossier's own
// ---------------------------------------------------------------------------

test("the composed note carries dossier.framing VERBATIM, both halves", () => {
  for (const [label, run] of RUNS) {
    const out = run();
    assert.ok(out.internalNote.includes(out.dossier.framing), `${label}: the framing is not verbatim`);
    assert.ok(out.internalNote.includes("not a relocation decision"), label);
    assert.ok(
      out.internalNote.includes("legal, immigration, or tax determination"),
      `${label}: the half the live note dropped is still missing`
    );
    // And it is the same string src writes, not a second copy that happens to
    // match today.
    assert.equal(
      out.dossier.framing,
      "RESEARCH SUPPORT ONLY — not a relocation decision or a legal, immigration, or tax determination. For review by a qualified Mobility Legal specialist (Tier-3).",
      label
    );
  }
});

test("the framing appears EXACTLY ONCE — no paraphrase riding alongside it", () => {
  for (const [label, run] of RUNS) {
    const out = run();
    const count = out.internalNote.split(out.dossier.framing).length - 1;
    assert.equal(count, 1, `${label}: the framing appears ${count} times`);
    // "one expression, one copy of the sentence": the scaffolding must contain
    // no second disclaimer of its own.
    assert.ok(!/RESEARCH SUPPORT ONLY/i.test(scaffolding(out)), label);
  }
});

test("the note carries the narrative verbatim too, and adds the immigration/tax content the framing covers", () => {
  const out = BLOCKING_RUN();
  assert.ok(out.internalNote.includes(out.dossier.narrative));
  // The reason the dropped half mattered: the note prints exactly the content
  // that half disclaims.
  assert.ok(out.dossier.requiredActions.includes("IMMIGRATION_ASSESSMENT"));
  assert.ok(out.dossier.requiredActions.includes("TAX_REVIEW"));
  assert.ok(out.dossier.requiredActions.includes("PE_REVIEW"));
  for (const action of out.dossier.requiredActions) assert.ok(out.internalNote.includes(action), action);
});

// ---------------------------------------------------------------------------
// 6. 🔴 — no execution path, and nothing may imply one
// ---------------------------------------------------------------------------

test("the note this repository AUTHORS carries no approve/authorise/proceed verb", () => {
  // The whole point of the brief, and the guarantee UC-07's tier rests on.
  // Scanned over the scaffolding — see scaffolding()'s own comment for why the
  // two quoted blocks are subtracted and why that is not a loophole.
  for (const [label, run] of RUNS) {
    const found = findDecisionVerb(scaffolding(run()));
    assert.equal(found, null, `${label}: the composed note's own words contain ${JSON.stringify(found)}`);
  }
});

test("the raw verdict token is deliberately NOT printed", () => {
  // `dossier.verdict` is BLOCK / REVIEW / PROCEED, and "Gate verdict: PROCEED"
  // on a 🔴 ticket is a permission word three words from a specialist's eye.
  // Nothing is lost: VERDICT_WORDS renders all three in the narrative, with
  // their own caveats attached.
  const clean = CLEAN_RUN();
  assert.equal(clean.dossier.verdict, "PROCEED", "fixture drifted — this run is supposed to reach the PROCEED verdict");
  assert.ok(!/PROCEED/.test(scaffolding(clean)), "the scaffolding prints the verdict token");
  // …and the narrative, which is quoted verbatim, does carry it WITH its caveat.
  assert.match(clean.dossier.narrative, /That is NOT an approval/);
  assert.ok(clean.internalNote.includes(clean.dossier.narrative));
});

test("the note states there is no execution path, and says why by construction", () => {
  for (const [label, run] of RUNS) {
    const note = run().internalNote;
    assert.match(note, /no control anywhere in this system that can act on a UC-07 request/, label);
    assert.match(note, /no decision branch/, label);
    assert.match(note, /one write method and zero mutation methods/, label);
    assert.match(note, /no POST route/, label);
  }
});

test("the graph really has no decision branch and no LLM node — the note's claims are true", () => {
  // The note asserts two facts about this graph. Both are checked against the
  // body rather than trusted: an internal note claiming a guarantee that had
  // quietly lapsed would be the worst possible version of this change.
  assert.match(gatesSource, /const decision = 'escalate';/);
  assert.equal((gatesSource.match(/^const decision\b/gm) || []).length, 1, "a second decision assignment appeared");
  // No live LLM call can be made from a Code node, which is why the note says
  // no model wrote any of it — and why the faithfulness sentinel exists.
  assert.match(gatesSource, /verdict:\s*"not_evaluated"/);
  for (const [label, run] of RUNS) {
    const out = run();
    assert.equal(out.decision, "escalate", label);
    assert.equal(out.dossier.faithfulness.verdict, "not_evaluated", label);
  }
});

test("the note never calls the dossier AI-written, and names the real provenance", () => {
  for (const [label, run] of RUNS) {
    const out = run();
    assert.ok(!/\bAI\b/.test(out.internalNote), `${label}: the note still calls it AI`);
    assert.match(out.internalNote, /No model wrote any of it on this path/, label);
    assert.ok(out.internalNote.includes(out.dossier.parseSource), `${label}: the parse source is not named`);
    assert.match(out.internalNote, /a deterministic template/, label);
    assert.match(out.internalNote, /keyword match over a local reference corpus/, label);
  }
});

// ---------------------------------------------------------------------------
// 7. Ticket hygiene
// ---------------------------------------------------------------------------

test("neither the target expression nor the composed note carries harness vocabulary", () => {
  const uf = ESCALATE_PARAMETERS.updateFields;
  assert.equal(findHarnessVocabulary(uf.internalNote), null);
  for (const tag of uf.tags) assert.equal(findHarnessVocabulary(tag), null, tag);
  for (const [label, run] of RUNS) {
    const note = run().internalNote;
    assert.equal(findHarnessVocabulary(note), null, `${label}: ${note}`);
  }
});

test("the target expression trips none of its own forbidden phrases", () => {
  const blob = JSON.stringify(ESCALATE_PARAMETERS.updateFields).toLowerCase();
  for (const phrase of FORBIDDEN_PHRASES) assert.ok(!blob.includes(phrase.toLowerCase()), phrase);
  assert.equal(findDecisionVerb(blob), null);
});

// ---------------------------------------------------------------------------
// 8. The deploy note and the spec cannot disagree
// ---------------------------------------------------------------------------

test("the deploy note carries exactly what it tells the operator to paste", () => {
  const md = readFileSync(join(NODES_DIR, "DEPLOY-2026-08-31.md"), "utf8");
  assert.ok(md.includes(ESCALATE_NODE_NAME));
  assert.ok(md.includes(UC07_WORKFLOW_ID));
  assert.ok(md.includes(INTERNAL_NOTE_INTERPOLATION));
  assert.ok(md.includes(DOSSIER_REF_INTERPOLATION));
  assert.ok(md.includes(ROUTING_NOTE_INTERPOLATION));
  assert.ok(md.includes(ZENDESK_GROUP_EXPRESSION));
  assert.ok(md.includes(TICKET_ID_EXPRESSION));
  assert.ok(md.includes(ESCALATED_TAG));

  // The JSON block in the deploy note must BE the spec, not a retyping of it.
  const blocks = [...md.matchAll(/```json\n([\s\S]*?)```/g)].map((m) => JSON.parse(m[1]));
  assert.equal(blocks.length, 1, "expected exactly one paste-ready JSON block");
  assert.deepEqual(blocks[0], JSON.parse(JSON.stringify(ESCALATE_PARAMETERS.updateFields)));
});

// ---------------------------------------------------------------------------
// THE CROSS-SPEC PIN — two specs describe this node, and neither may silently
// revert the other
// ---------------------------------------------------------------------------
// `workflows/nodes/escalationQueueTagSpec.js` owns the QUEUE TAG across
// fourteen nodes on eight graphs; this file's spec owns the PROSE. Both carry a
// full `targetParameters` block for this node, because either could be used to
// deploy it — and that file's copy was captured BEFORE this change, so its
// `internalNote` is the pre-change paraphrase. Publishing it wholesale would
// revert this change. The tests below pin the agreement to the fields that must
// agree and the divergence to the one field that must not, so a drift anywhere
// else names itself.
const { ESCALATION_QUEUE_TAG_NODES } = await import("../workflows/nodes/escalationQueueTagSpec.js");

test("cross-spec: the TAGS agree exactly", () => {
  const other = ESCALATION_QUEUE_TAG_NODES.find(
    (e) => e.workflowId === UC07_WORKFLOW_ID && e.node === ESCALATE_NODE_NAME
  );
  assert.ok(other, `escalationQueueTagSpec.js has no row for "${ESCALATE_NODE_NAME}" — the queue-tag fix would miss it`);
  assert.deepEqual(
    JSON.parse(JSON.stringify(other.targetUpdateFields.tags)),
    JSON.parse(JSON.stringify(ESCALATE_PARAMETERS.updateFields.tags)),
    "the two specs disagree about this node's tags. Deploying from either would revert the other; fix both, in one change."
  );
  assert.ok(ESCALATE_PARAMETERS.updateFields.tags.includes(QUEUE_TAG_EXPRESSION));
});

test("cross-spec: everything but the note agrees, and the note differs KNOWINGLY", () => {
  const other = ESCALATION_QUEUE_TAG_NODES.find(
    (e) => e.workflowId === UC07_WORKFLOW_ID && e.node === ESCALATE_NODE_NAME
  );
  assert.equal(other.targetUpdateFields.group, ESCALATE_PARAMETERS.updateFields.group);
  assert.equal(other.targetUpdateFields.status, ESCALATE_PARAMETERS.updateFields.status);
  assert.equal(other.targetParameters.id, ESCALATE_PARAMETERS.id);
  // The one deliberate divergence. If it ever disappears the two specs have
  // been reconciled — good — and this assertion must be turned into an equality
  // then, rather than left asserting a difference that no longer exists.
  assert.notEqual(
    other.targetUpdateFields.internalNote,
    ESCALATE_PARAMETERS.updateFields.internalNote,
    "escalationQueueTagSpec.js now matches this spec's note. Reconciled — change this assertion to an equality."
  );
  assert.ok(
    !other.targetUpdateFields.internalNote.includes(INTERNAL_NOTE_INTERPOLATION),
    "escalationQueueTagSpec.js carries the PRE-CHANGE prose, as documented. Take its tags array only."
  );
});

test("cross-spec: UC-07 contributes ONE node to the queue-tag table, not two", () => {
  // Because there is no `Unrecognised *` node on this graph at all: every UC-07
  // run escalates, so there is no second terminal branch to be unrecognised on.
  const rows = ESCALATION_QUEUE_TAG_NODES.filter((e) => e.workflowId === UC07_WORKFLOW_ID);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].node, ESCALATE_NODE_NAME);
  assert.deepEqual(TERMINAL_NODE_NAMES, [ESCALATE_NODE_NAME]);
});
