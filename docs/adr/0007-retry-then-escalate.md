# Transient API failures retry 3 times with backoff, then escalate to a human

Status: accepted (specified — not yet built, see `00-FOUNDATION.md` §4 invariant 10)

A failed Remote/Zendesk/LLM call is retried up to 3 attempts with backoff
before being treated as a permanent failure; on continued failure the case
routes to a human rather than erroring out mid-workflow or silently skipping
a step. This was already an acknowledged, unbuilt gap in `docs/BUILD-LOG.md`'s
roadmap ("small, self-contained") before it was promoted to a numbered,
concrete policy. The number (3 attempts) is tagged `[PROPOSED]` — a
reasonable default, not a Remote-specific finding. n8n's native per-node
"Retry On Fail" setting is the implementation mechanism for the n8n
workflows; the Node app's REST clients need the equivalent wrapped around
every call. This decision depends on ADR-0006: a retry that succeeds on the
second attempt should produce two trace entries, not a hidden one, so the
two mechanisms share the same plumbing rather than needing separate
tracking.

Full resolution: `00-FOUNDATION.md` §4 invariant 10, GitHub issue #19.
