# Mapping the code to n8n

Each use case's core logic is written as plain, tested code first, then
rebuilt visually as an n8n workflow once the logic is understood — the code
is the reference for what each node should do, not the other way round.

## What's actually built

**UC-01, UC-06, and UC-08 have real n8n graphs.** `workflows/README.md` is
the authoritative, node-by-node account of all three — exact node names, the
order they run in, and the reasoning behind anything non-obvious (why
`Carry Context Forward` exists, why the audit node had to move ahead of the
Zendesk nodes, why UC-08's graph deliberately has no Switch/IF node
anywhere). This file used to duplicate that account for UC-01 with an early
plan — it named the LLM node "Claude" (the real build uses OpenAI) and
didn't reflect the actual graph at all. Read `workflows/README.md` for what
UC-01/06/08 really look like; nothing here repeats it.

## The general shape, for UC-02, 03, 04, 05, 07, 09 (no n8n graph yet)

Every use case follows the same skeleton once you're ready to build its
graph — the same one `workflows/README.md` shows already built out for
01/06/08:

**trigger → (LLM classify/extract, if the use case has one) → fetch →
deterministic checks → route (auto / HITL / escalate) → audit.**

Two things vary by tier, not by use case:

- 🟡/🔴 tiers add a human-approval node (the ZAF sidebar, or — per
  `00-FOUNDATION.md` §2 — a ticket the automation authors itself, for the
  use cases whose trigger is a Remote-native webhook rather than an inbound
  ticket) between the checks and any write.
- Money use cases (02, 06, 09) add `money.js`'s ×100 scaling and
  `schemaValidator.js`'s per-country check before any write node, matching
  `00-FOUNDATION.md` §4 invariants 1 and 2.

## Practical tips, still true regardless of use case

- Keep the deterministic gates in a single **Code** node so the logic stays
  in one place, matching the source file it was ported from.
- Put any LLM call in its own node and validate its JSON output in the next
  node — never let unvalidated LLM output flow into a decision. This is
  exactly what `workflows/nodes/validateClassification.js` does for UC-01.
- **Code node bodies must be real `.js` files** (`workflows/nodes*/*.js`),
  never template literals in the workflow builder — see
  `workflows/README.md`'s "Why Code node bodies live in `nodes/*.js`" for the
  bug this caused the first time (an escaped regex silently became a regex
  literal followed by a line comment, and every ticket routed to human
  review with nothing crashing to reveal it).
- Write a parity test (`test/n8nParity.test.js`, `test/n8nUc06Parity.test.js`,
  `test/n8nUc08Parity.test.js` are the pattern) that runs the real node body
  in a `node:vm` sandbox and asserts it matches the plain-code function it
  was ported from. The safety-critical logic exists in two places
  (the source file and the node); the test is what keeps them from drifting
  apart silently.
- When moving from the mock to Remote Sandbox, only the base URL/credentials
  on the HTTP nodes change — nothing about the graph shape does.
