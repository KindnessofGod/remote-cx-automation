# Audit at two levels: a decision summary, and per-step trace entries

Status: accepted (specified — not yet built, see `00-FOUNDATION.md` §4 invariant 7)

The existing audit design writes one durable summary row per completed
request. That traces every decision that finished successfully, but nothing
traces an attempt that failed partway through — if a classify() call or a
Remote fetch throws before the summary row is written, there is no record of
it at all. The design adds a second level: every LLM call and every
Remote/Zendesk call gets its own trace entry (attempted/succeeded/
failed/fell-back), written as it happens. This was found by auditing the
actual code against an external production-AI framework, not assumed from
the framework alone — and it surfaced a real regression: the n8n port of
UC-01's classifier already tags LLM-vs-fallback `source`, but the canonical
Node implementation it was copied from doesn't, which is backwards for a
reference implementation.

**Considered and rejected:** leaving the single summary row as sufficient,
on the reasoning that completed decisions are what an audit needs. Rejected
because a failed/abandoned attempt is exactly the case a real incident
investigation needs to reconstruct, and the single-row design structurally
cannot answer it.

Full resolution: `00-FOUNDATION.md` §4 invariants 7–8, GitHub issue #18.
