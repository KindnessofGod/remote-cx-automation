// ---------------------------------------------------------------------------
// graphReachability.test.js — a splice must not clobber a longer path
// ---------------------------------------------------------------------------
// The bug this exists for, in full, because it was invisible in every place
// somebody would look:
//
// `deploy-routing-nodes.mjs` set the spliced node's output unconditionally to
// the downstream node named in its splice pair. That is correct the first time
// and destructive every time after. On 2026-08-29 UC-01's live chain was
// `Assign Routing → Compose Internal Note → Route by Decision`; re-running the
// deployer rewrote it to go direct and left "Compose Internal Note" with NO
// inbound edge, so it silently never ran.
//
// Nothing reported it. The deploy printed "✔ wiring ok", the workflow stayed
// active and published, `verify-deployed` compared node BODIES and found none
// changed, and executions kept succeeding. The loss was the gate-by-gate
// reasoning in the escalation ticket's internal note — F-11's protected content
// defeated by unplugging its author rather than by editing the note.
//
// Only `verify-claim-nodes.mjs` saw it, reporting "orphaned (no inbound edge,
// never runs): Compose Internal Note" among other complaints, which is why a
// checker that reports structure and not just content earns its keep.
// ---------------------------------------------------------------------------

import { test } from "node:test";
import { strict as assert } from "node:assert";
import { reaches, outputForSplicedNode } from "../scripts/lib/graphReachability.mjs";

const edge = (node) => [{ node, type: "main", index: 0 }];

test("reaches() follows a chain", () => {
  const c = { A: { main: [edge("B")] }, B: { main: [edge("C")] } };
  assert.equal(reaches(c, "A", "C"), true);
  assert.equal(reaches(c, "A", "B"), true);
  assert.equal(reaches(c, "B", "A"), false, "connections are directed");
  assert.equal(reaches(c, "A", "Z"), false);
});

test("reaches() handles a fan-out and finds the target on any branch", () => {
  const c = { A: { main: [[...edge("B"), ...edge("X")]] }, X: { main: [edge("C")] } };
  assert.equal(reaches(c, "A", "C"), true);
});

test("reaches() terminates on a cycle rather than hanging", () => {
  const c = { A: { main: [edge("B")] }, B: { main: [edge("A")] } };
  assert.equal(reaches(c, "A", "Z"), false);
});

test("THE REGRESSION: an existing longer path is PRESERVED, not overwritten", () => {
  // Exactly UC-01's live shape on 2026-08-29.
  const c = {
    "Carry Context Forward": { main: [edge("Assign Routing")] },
    "Assign Routing": { main: [edge("Compose Internal Note")] },
    "Compose Internal Note": { main: [edge("Route by Decision")] },
  };
  assert.equal(
    outputForSplicedNode(c, "Assign Routing", "Route by Decision"),
    null,
    "the deployer would orphan Compose Internal Note again"
  );
});

test("a missing output IS set, so the first splice still works", () => {
  const c = { "Carry Context Forward": { main: [edge("Route by Decision")] } };
  assert.deepEqual(outputForSplicedNode(c, "Assign Routing", "Route by Decision"), {
    main: [edge("Route by Decision")],
  });
});

test("an output that leads SOMEWHERE ELSE is repaired, not preserved", () => {
  // Preserving must mean "already reaches the right place", never "has any
  // edge at all" — otherwise a genuinely mis-wired graph would be left broken.
  const c = {
    "Assign Routing": { main: [edge("Some Unrelated Node")] },
    "Some Unrelated Node": { main: [edge("A Dead End")] },
  };
  assert.deepEqual(outputForSplicedNode(c, "Assign Routing", "Route by Decision"), {
    main: [edge("Route by Decision")],
  });
});

test("an empty connection object is treated as absent", () => {
  for (const empty of [{ main: [] }, { main: [[]] }, {}]) {
    const c = { "Assign Routing": empty };
    assert.notEqual(
      outputForSplicedNode(c, "Assign Routing", "Route by Decision"),
      null,
      `${JSON.stringify(empty)} was mistaken for a live edge`
    );
  }
});

test("the direct edge is preserved too — it already reaches the target", () => {
  const c = { "Assign Routing": { main: [edge("Route by Decision")] } };
  assert.equal(outputForSplicedNode(c, "Assign Routing", "Route by Decision"), null);
});
