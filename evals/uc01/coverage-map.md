# UC-01 Evaluation Coverage Map

## Purpose

This document maps the existing UC-01 business acceptance contract and frozen
VC-01..VC-33 validation contract to repeatable evaluations.

It does NOT create a competing acceptance standard.

Source of truth:
- qa/contracts/UC-01-acceptance.md
- qa/handoffs/UC-01/0001-builder-to-validator.md

---

## Evaluation Layers

### Stage 1 — AI Interpretation

Questions:
- Is intent classified correctly?
- Is requester type interpreted correctly?
- Are external URLs detected?
- Are requested fields extracted correctly?
- Are dangerous / over-scope fields such as salary detected?
- How consistent is classification across repeated runs?
- Is model-reported confidence actually calibrated?

Important:
Model confidence is currently a signal to evaluate, not a trusted probability.

---

### Stage 2 — Deterministic Policy Safety

Questions:
- Does every policy gate produce the expected decision?
- Does the system fail closed when required information is missing?
- Can any request that requires human review accidentally auto-resolve?
- Do forbidden disclosures remain forbidden regardless of classifier output?
- Are identity, employment eligibility, consent and record-completeness gates enforced?

Primary safety metric:

Unsafe Auto-Route Rate =
cases that should require review but auto-resolved
/
all cases that should require review

Target: 0

---

### Stage 3 — Integration Correctness

Systems:
- Zendesk
- n8n
- Remote API / Sandbox
- Supabase
- document generation
- audit system

Questions:
- Is the right data passed between systems?
- Are writes correct?
- Are retries correct?
- Are duplicate requests idempotent?
- Are failures safely contained?

---

### Stage 4 — Full UI / E2E Journey

Personas:
- employee
- third party
- specialist / reviewer
- operations

Surfaces:
- Zendesk Agent Workspace
- ZAF sidebar
- customer-facing result
- Requests / self-service
- consent surfaces
- review / approval surfaces

---

### Stage 5 — Reliability and Failure Injection

Examples:
- OpenAI timeout
- malformed model response
- Remote API unavailable
- Remote record not found
- Supabase write failure
- Zendesk write failure
- document-generation failure
- retry exhaustion
- duplicate webhook
- partial execution
- stale state
- restart / recovery

For every injected failure prove:
1. unsafe outward action did not occur
2. failure is observable
3. audit evidence survives where required
4. recovery behavior is correct

---

### Stage 6 — Observability, Audit and Security

Questions:
- Can an operator start from a customer-facing identifier and find the failing boundary?
- Is the deciding policy gate visible?
- Are important external attempts and retries visible?
- Can Phoenix traces be correlated with durable audit evidence?
- Are human decisions visible?
- Are customer-facing writes visible?
- Can failures be diagnosed quickly?
- Is sensitive information excluded from telemetry where required?

Target diagnostic workflow:

ticket / request ID
→ case
→ workflow execution
→ trace
→ failing span / gate
→ probable cause
→ customer impact

---

## Contract Mapping

The next step is to map VC-01..VC-33 into the stages above.

No criterion is considered covered merely because a test exists.

For each VC we will record:

- Requirement
- Risk
- Evaluation layer
- Test method
- Expected result
- Evidence produced
- Current coverage
- Gap / action required