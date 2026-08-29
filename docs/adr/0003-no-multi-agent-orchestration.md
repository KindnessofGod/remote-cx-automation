# One LLM call per use case, never multiple agents talking to each other

Status: accepted

Every use case makes at most one LLM call (classification, extraction, or
drafting already-decided facts into prose) and never chains multiple LLM
agents that reason about or hand off to each other. UC-06's and UC-08's raw
source research packs each proposed a much larger enterprise architecture —
UC-08 a 4-agent design, UC-06 a "legal RAG / compliance analyst agent" — and
neither was built. Deterministic code (the gates, the risk engine, the
schema/money validators) makes every decision; the LLM is never the thing
deciding, only the thing classifying or restating. A second AI agent judging
or negotiating with a first would put decision authority somewhere this
project's whole architecture exists to keep it out of.

**Considered and rejected:** the source packs' multi-agent designs, on two
grounds — (1) added orchestration complexity with no corresponding gain,
since a single deterministic gate already does the job a second agent would
be asked to double-check, and (2) a "compliance analyst" agent would mean an
LLM rendering legal/compliance judgment, which is a decision, not
interpretation — exactly what prime directive #1 forbids. Where Remote's own
systems already render that judgment (e.g., UC-06's `automatable` pre-check),
deferring to it is preferred over building a second, less authoritative
opinion alongside it.

Full resolution: `docs/use-cases/UC-06.md` §15, `docs/use-cases/UC-08.md` §3,
`docs/research/production-ai-playbook-sandipan-bhaumik.md` (independent
validation from an external production-AI framework).
