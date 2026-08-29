# Data sent to the LLM: confidential-data handling, not a PII problem

Status: accepted

`src/uc06/changeParser.js`'s `draftSummary()` sends real salary change
amounts to OpenAI. An earlier pass through this project framed that as "PII
exposure" — incorrect, and corrected here: the prompt payload
(`src/uc06/changeParser.js:87`) carries no name or employment ID, so it
isn't PII in the regulatory sense. The more precise framing is confidential
financial data reaching a subprocessor, and the question that actually
matters is what that subprocessor does with it. Verified live against
`developers.openai.com/api/docs/guides/your-data`: API data is not used for
model training by default, is retained up to 30 days for abuse monitoring
unless legally required otherwise, and Zero Data Retention is available for
approved enterprise customers. That default policy is the compensating
control already in place — no new infrastructure needed for the structured
`changes` object.

The one real, narrower gap: `reasonText` and any other free-text field
feeding an LLM prompt is not guaranteed to stay clean of a name, unlike the
controlled structured fields around it — a targeted guard on free-text
inputs specifically, not a general PII-detection subsystem.

Full resolution: `docs/use-cases/UC-06.md` (corrected note), GitHub issue #21.
