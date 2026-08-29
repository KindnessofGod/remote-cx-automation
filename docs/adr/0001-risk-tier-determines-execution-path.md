# Risk tier determines execution path — "AI never executes unilaterally," not "AI never executes"

Status: accepted

Every ticket is assigned a risk tier (🟢/🟡/🔴), and the tier picks a
structurally different execution path rather than just gating the same path
with more checks: 🟢 validates then auto-executes; 🟡 prepares and
risk-scores, a human approves via one click; 🔴 either has **no execution
path at all** (07, 08 — the dossier-building functions take no write-capable
client as a parameter, so there's nothing to wire up later by accident) or
requires independent dual-human approval before every execution, at any
composite risk score (09). We initially framed 🔴 as "AI never executes" —
raw UC-09 source material specified a real bank-payout tier with **zero**
human sign-off for low-risk-scored cases, which the "no execution" framing
would have let through as an exception instead of catching as a
contradiction. The corrected rule separates "does it execute" from "does it
execute *unilaterally*" — money-movement automation with proper dual-approval
controls is real product value; the risk is in unilateral execution, not
execution per se.

**Considered and rejected:** a single composite risk score deciding whether
a human is involved at all. Rejected because a risk score can be trusted to
decide *how many* approvers above a floor, never *whether* the floor applies
— a "low risk" auto-payout is exactly the failure mode a hard floor of two
humans exists to catch.

Full resolution: `00-FOUNDATION.md` §5, GitHub issue #10.
