// ---------------------------------------------------------------------------
// structuralNodeChecks.mjs — checks for n8n nodes that carry NO jsCode
// ---------------------------------------------------------------------------
// WHY THIS IS ITS OWN FILE, SEPARATE FROM verify-deployed-nodes.mjs
//
// scripts/verify-deployed-nodes.mjs needs a live n8n API key to run at all
// (it exits 2 without one), so nothing in it can be exercised by `npm test`.
// The checking LOGIC below is pure — it takes a workflow/node object (the
// exact shape `GET /api/v1/workflows/:id` returns) and returns a list of
// issue strings — so it is factored out here and imported by BOTH:
//
//   1. scripts/verify-deployed-nodes.mjs, against the LIVE fetched graph.
//   2. test/n8nRouteByDecisionParity.test.js, against a snapshot of that same
//      live graph captured 2026-08-22 PLUS deliberately mutated copies of
//      it — proving this code actually detects drift, hermetically, with no
//      risk of touching the production graph that answers real Zendesk
//      tickets in order to prove it.
//
// GENERIC ON PURPOSE (rca-vqe)
//
// `Route by Decision` (a Switch node) is the first consumer, but it will not
// be the last: rca-uim (next in this UC-01 queue) adds a Supabase node with
// no jsCode either. Rather than hard-code "check switch rules",
// `structuralNodeIssues()` below checks only what every structural node
// shares — its EXISTENCE, its TYPE, and its POSITION IN THE CHAIN (which
// downstream node each of its outputs reaches, which upstream node feeds it)
// — and delegates anything node-type-specific (a switch's rule table, a
// Supabase node's target table/operation) to a `checkParams` function
// supplied per entry. `switchRuleIssues` below is that function for a Switch
// node; a future Supabase entry supplies its own and reuses everything else
// here unchanged.
// ---------------------------------------------------------------------------

/**
 * Everything true of a Switch node's rule table, checked against a spec of
 * the shape `workflows/nodes/routeByDecisionSpec.js` exports: an ordered
 * `RULES` array (`{ decision, target }`, array index === switch output
 * index) and a `FALLBACK` (`{ fallbackOutput, outputKey, target }`).
 *
 * Checks the parts of a rule that can drift independently, because each
 * produces a different live symptom: the compared VALUE (a live edit changes
 * what string a rule matches — a decision starts being caught by the wrong
 * rule, or by none), the comparison OPERATOR/left side (an edit that changes
 * `equals` to something else, or stops comparing `$json.decision` at all, is
 * not visible in the canvas at a glance), and the OUTPUT KEY (cosmetic, but a
 * collision between two rules' keys makes them indistinguishable in the n8n
 * UI). Which node an output actually CONNECTS to — the exact rca-c73 shape,
 * where a rule can compare the right value and still route nowhere useful —
 * is checked separately, by the caller, via `expectedOutputs` below.
 *
 * @param {object} node the live Switch node (`.parameters.rules.values`, `.parameters.options`)
 * @param {{RULES: Array<{decision:string,target:string}>, FALLBACK: {fallbackOutput:string,outputKey:string,target:string}}} spec
 * @returns {string[]} issue descriptions; empty means the rule table matches
 */
export function switchRuleIssues(node, spec) {
  const issues = [];
  const values = node?.parameters?.rules?.values ?? [];

  spec.RULES.forEach((rule, i) => {
    const v = values[i];
    if (!v) {
      issues.push(`rule ${i} ("${rule.decision}") is missing from the live switch`);
      return;
    }
    const cond = v.conditions?.conditions?.[0];
    if (cond?.leftValue !== "={{ $json.decision }}") {
      issues.push(
        `rule ${i} compares ${JSON.stringify(cond?.leftValue)}, expected "={{ $json.decision }}"`
      );
    }
    if (cond?.operator?.operation !== "equals") {
      issues.push(`rule ${i} uses operator ${JSON.stringify(cond?.operator?.operation)}, expected "equals"`);
    }
    if (cond?.rightValue !== rule.decision) {
      issues.push(`rule ${i} routes ${JSON.stringify(cond?.rightValue)}, expected "${rule.decision}"`);
    }
    if (v.outputKey !== rule.decision) {
      issues.push(`rule ${i} outputKey is ${JSON.stringify(v.outputKey)}, expected "${rule.decision}"`);
    }
  });

  if (values.length !== spec.RULES.length) {
    issues.push(`switch has ${values.length} rule(s), spec (RULES) has ${spec.RULES.length}`);
  }

  const opts = node?.parameters?.options ?? {};
  if (opts.fallbackOutput !== spec.FALLBACK.fallbackOutput) {
    issues.push(
      `fallbackOutput is ${JSON.stringify(opts.fallbackOutput)}, expected "${spec.FALLBACK.fallbackOutput}"`
    );
  }
  if (opts.renameFallbackOutput !== spec.FALLBACK.outputKey) {
    issues.push(
      `fallback output key is ${JSON.stringify(opts.renameFallbackOutput)}, expected "${spec.FALLBACK.outputKey}"`
    );
  }

  return issues;
}

/** Output index `i` of `workflow.connections[nodeName]` -> the node name it reaches, or null. */
function connectedTarget(workflow, nodeName, index) {
  const outputs = workflow?.connections?.[nodeName]?.main ?? [];
  return outputs[index]?.[0]?.node ?? null;
}

/**
 * Generic structural check: does the LIVE node named `entry.node` exist, is
 * it the expected n8n TYPE, does it satisfy `entry.checkParams` (if given —
 * the node-type-specific check, e.g. `switchRuleIssues`), and does its
 * position in the chain match `entry.expectedOutputs` (per-output-index
 * downstream node names) and `entry.expectedInputs` (upstream node names that
 * must connect to it)?
 *
 * Not switch-specific: `checkParams` / `expectedOutputs` / `expectedInputs`
 * are all optional. A future entry for a single-output node with no
 * type-specific params to check — nothing beyond existence, type and
 * position — supplies none of them and still gets a real check out of this
 * one function.
 *
 * @returns {string[]} issue descriptions; empty means the node matches.
 */
export function structuralNodeIssues(workflow, entry) {
  const node = (workflow?.nodes ?? []).find((n) => n.name === entry.node);
  if (!node) {
    return [`no node named "${entry.node}" — either it was renamed/removed in n8n, or this entry is stale`];
  }

  const issues = [];
  if (entry.type && node.type !== entry.type) {
    issues.push(`type is "${node.type}", expected "${entry.type}"`);
  }
  if (entry.checkParams) {
    issues.push(...entry.checkParams(node));
  }
  if (entry.expectedOutputs) {
    entry.expectedOutputs.forEach((target, i) => {
      const actual = connectedTarget(workflow, entry.node, i);
      if (actual !== target) {
        issues.push(`output ${i} connects to ${actual ? `"${actual}"` : "(nothing)"}, expected "${target}"`);
      }
      // rca-uim: `connectedTarget` reads only the FIRST wire on this output
      // (`outputs[i]?.[0]?.node`), so a live edit that fans one output out to
      // a SECOND node in addition to the expected one — e.g. "Render Letter"
      // repointed at both "Prepare Document" (correct) and
      // "Reply + Solve Ticket" (a bypass added back) — passed the check above
      // silently: the first wire still matched. A node whose single output is
      // meant to reach exactly one place downstream can develop a second,
      // unaudited path with nothing here noticing. Checked separately so the
      // message names the extra target(s), not just "wrong count".
      const wires = workflow?.connections?.[entry.node]?.main?.[i] ?? [];
      if (wires.length > 1) {
        const extras = wires.slice(1).map((w) => w.node);
        issues.push(`output ${i} also connects to ${extras.map((n) => `"${n}"`).join(", ")} (expected exactly one target: "${target}")`);
      }
    });
    const actualCount = workflow?.connections?.[entry.node]?.main?.length ?? 0;
    if (actualCount !== entry.expectedOutputs.length) {
      issues.push(`has ${actualCount} output(s) wired, expected ${entry.expectedOutputs.length}`);
    }
  }
  if (entry.expectedInputs) {
    for (const upstream of entry.expectedInputs) {
      const outs = workflow?.connections?.[upstream]?.main?.[0] ?? [];
      if (!outs.some((c) => c.node === entry.node)) {
        issues.push(`upstream node "${upstream}" does not connect to "${entry.node}"`);
      }
    }
  }
  return issues;
}
