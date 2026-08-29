# JavaScript throughout, not Python — the ZAF/n8n-parity argument, not just "no build step"

Status: accepted

`00-FOUNDATION.md` §3 already records JS-over-TypeScript (no build step).
This records the more fundamental choice: JS over Python, the ecosystem with
richer LLM/RAG tooling. Two things force JavaScript into this project
regardless of backend preference — Zendesk's ZAF v2 sidebar apps are
JS/HTML/CSS by platform requirement, not choice, and this project's n8n Code
nodes are real `.js` files executed both inside n8n and inside a `node:vm`
sandbox in the parity tests (`test/n8nParity.test.js` and its UC-06/UC-08
siblings), which assert the n8n graph matches the plain-code function it was
ported from byte-for-byte in behavior. That technique only works cleanly
same-language — a Python backend would force either double-implementing
every gate in two languages or losing the ability to literally import and
run the same file the parity tests depend on. With JS already required in
two of the four layers, making the backend JS too means one language for
the whole system, not three.

**Considered and rejected:** Python, for its stronger RAG/ML tooling
(LangChain, LlamaIndex). Rejected because this project deliberately doesn't
do heavy custom RAG-framework orchestration (ADR-0003) — the actual RAG need
(UC-08's treaty retrieval, once built past keyword-matching) is embedding
generation + pgvector similarity search, which Node's OpenAI SDK and a
Postgres client handle directly without needing Python's ecosystem.

Full resolution: GitHub issue #22.
