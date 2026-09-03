// ---------------------------------------------------------------------------
// graphReachability.mjs — does one n8n node still lead to another?
// ---------------------------------------------------------------------------
// WHY THIS EXISTS, AND IT IS A BUG THIS REPO SHIPPED
//
// `deploy-routing-nodes.mjs` splices "Assign Routing" into one named edge,
// upstream → downstream, and then set the routing node's own output with:
//
//     wf.connections[NODE_NAME] = { main: [[{ node: downName, ... }]] };
//
// unconditionally. That is correct the first time and destructive every time
// after, because it assumes nothing was ever inserted BELOW the routing node.
//
// On 2026-08-29 something had been: UC-01's live chain was
// `Assign Routing → Compose Internal Note → Route by Decision`. Re-running the
// deployer rewrote it to `Assign Routing → Route by Decision`, leaving
// "Compose Internal Note" with no inbound edge at all — a node that silently
// never runs. The damage is invisible in every obvious place: the deploy
// reported "✔ wiring ok", the workflow stayed active and published, and
// executions kept succeeding. What was lost is the gate-by-gate reasoning in
// the escalation ticket's internal note — the exact content F-11 exists to
// protect, defeated not by editing the note but by unplugging its author.
//
// So the splice must be able to ask "does my output ALREADY lead to the node I
// was going to point it at?" and leave a longer path alone when it does.
// ---------------------------------------------------------------------------

/**
 * Can `target` be reached from `from` by following main connections?
 *
 * @param {object} connections  an n8n workflow's `connections` map
 * @param {string} from         node name to start at
 * @param {string} target       node name to look for
 * @param {number} [maxDepth]   guard against a cycle in a malformed graph
 * @returns {boolean} true when a path exists (`from === target` counts)
 */
export function reaches(connections, from, target, maxDepth = 50) {
  if (from === target) return true;
  const seen = new Set();
  const queue = [[from, 0]];
  while (queue.length) {
    const [name, depth] = queue.shift();
    if (depth > maxDepth || seen.has(name)) continue;
    seen.add(name);
    const groups = connections?.[name]?.main ?? [];
    for (const group of groups) {
      for (const c of group ?? []) {
        if (!c || !c.node) continue;
        if (c.node === target) return true;
        queue.push([c.node, depth + 1]);
      }
    }
  }
  return false;
}

/**
 * What the routing node's output should become.
 *
 * Returns `null` when the existing wiring already reaches `downName`, meaning
 * the caller must NOT touch it — that is the whole point. Returns the fresh
 * single-edge connection object otherwise.
 *
 * @param {object} connections  the workflow's `connections` map
 * @param {string} nodeName     the spliced node, e.g. "Assign Routing"
 * @param {string} downName     the node the splice must ultimately feed
 */
export function outputForSplicedNode(connections, nodeName, downName) {
  const existing = connections?.[nodeName];
  const hasEdge = (existing?.main ?? []).some((g) => (g ?? []).some((c) => c && c.node));
  if (hasEdge && reaches(connections, nodeName, downName)) return null;
  return { main: [[{ node: downName, type: "main", index: 0 }]] };
}
