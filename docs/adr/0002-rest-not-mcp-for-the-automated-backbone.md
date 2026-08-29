# REST is the backbone for reads and writes; MCP is human-interactive only

Status: accepted

Remote's real MCP server exposes both reads and writes, so "MCP can't write"
is not why it's kept off the automated pipeline. The actual reason is the
auth model: MCP authenticates via OAuth2 PKCE through an interactive browser
sign-in, and its write tools act on the authenticated user's behalf — Remote's
own MCP docs state "whatever permissions you have in Remote, you have
through the CLI/API/MCP." That's user-delegated, session-bound, and
consent-driven by design — structurally the wrong shape for an unattended
service that must run without a human present, retry idempotently, and
attribute every action to a system actor in an audit log. REST (service
credentials, OpenAPI-validated, idempotent) is the backbone for every UC's
automated core; MCP is reserved for deliberate, human-in-the-loop
conversational lookups.

**Considered and rejected:** building a generic MCP proxy to satisfy the
named-tooling requirement regardless of fit. Rejected once Remote's own MCP
product was confirmed to have a Sandbox-compatible endpoint — demonstrating
real, direct use of Remote's actual MCP (for the use it's actually suited to)
is a stronger claim than forcing it into a role it was never built for.

Full resolution: `00-FOUNDATION.md` §2, GitHub issues #3 and #11.
