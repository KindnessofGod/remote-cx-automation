# Trigger is per-use-case: Remote-native webhook, or a Zendesk ticket — never one universal front door

Status: accepted

A request enters the system one of two ways, decided by whether a Remote
object already models it, not uniformly: a Remote-native webhook (02, 04,
05, 06, 09 — the employee/admin already acted inside Remote's own product),
or a Zendesk ticket (01, 03, 07, 08 — a genuine inquiry with no corresponding
Remote object). For the webhook-triggered use cases, identity verification,
deterministic gates, and fact-gathering run against the event *first*; only
then does the automation author the Zendesk ticket itself — pre-tagged,
pre-populated — to host the shared ZAF review surface. `00-FOUNDATION.md`
§2's original architecture diagram implied one universal Zendesk intake; it
was corrected to match what half the UC specs already said, rather than the
UC specs being rewritten to fit the diagram.

**Considered and rejected:** routing every webhook-triggered use case's
human-review step through a ticket-less HTTP API instead (already built for
UC-06/UC-08's standalone APIs), to avoid manufacturing a ticket for a request
that never came through support. Rejected because Zendesk/ZAF fluency is a
named, scored requirement — authoring tickets programmatically and driving
the shared sidebar off them demonstrates more of that fluency, not less.

Full resolution: `00-FOUNDATION.md` §2, GitHub issue #17.
