# Dual control (segregation of duties) for UC-06's non-automatable path and all of UC-09

Status: accepted

"Dual control" is standard internal-controls/audit terminology (also called
the four-eyes principle) for requiring two independent people to jointly
authorize a sensitive action, so no single actor — compromised, careless, or
malicious — can unilaterally cause harm. UC-06 applies it to the subset
Remote's own `automatable` pre-check has already flagged as needing review
(Customer Admin approves, then a Remote Payroll specialist approves,
independently); UC-09 applies it unconditionally, with a third identity
requirement (requester ≠ approver ≠ payment releaser) since real money moves.
Neither is sourced from the raw UC-06/UC-09 research docs — this project
added it deliberately, and says so explicitly in both specs rather than
presenting it as a Remote-derived requirement.

**Why it's the right control here, not just a plausible one:** Remote's own
`automatable` engine, which already handles the straightforward amendments
instantly, has no dual-approval step visible in its documented behavior —
this project's dual control is a genuine addition on top of Remote's own
automation, not a duplication of it, specifically for the harder cases that
already require human judgment today.

**The segregation clause this ADR never stated, added 2026-08-21.** "Two
independent people" was the whole justification above and was never written as a
*rule*, so the code did not implement one: **the requester may not fill either
approval slot.** UC-01 holds this (`self_approval`, `src/review/reviewPolicy.js`).
~~and UC-09 holds it in its strongest form (requester ≠ approver ≠
payment_releaser, `src/uc09/multiApprovalPolicy.js`)~~ — **struck 2026-08-21:
that sentence was false, and this is the document in which it did the most
damage. See the box below.** **UC-06 did not, and
exempted itself in a code comment** — `src/uc06/dualApprovalPolicy.js:13–29`,
*"the admin here IS expected to be one of the two approvers"* — which is a
scoping decision made in the file that implements the control rather than in this
document, where a reader auditing the control would look for it. `requester` is
captured and persisted and compared to nothing. DRIFT-098; `[A-1]`.

**UC-09 did not hold the clause either, and this document said it did
(2026-08-21).** The sentence struck above was added by UC-06's decision pass, on
the same day, in the act of fixing UC-06 — and it asserted the *strongest*
available form of the rule about **the one use case in the nine that moves real
money**, citing the file a reader would open to confirm it.

`src/uc09/multiApprovalPolicy.js:105–121` builds its comparison set from the three
approval **slots** — `requesterApproval`, `approverApproval`,
`paymentReleaserApproval` — and compares each to the incoming approver.
`adjustmentRow.requester`, the column recording **who filed the request**, is in
neither that set nor `isFullyApproved()`'s. So the control that existed was *"two
different signatories"*; the control this document promised was *"two different
signatories, neither of whom asked for the payment"*. They differ by exactly the
self-approval case the fraud-control list names first. That is DRIFT-050, open
since the first reconciliation pass; what DRIFT-110 adds is that an auditor
reading this ADR would have been told there was nothing to find.

**Decided 2026-08-21, reading (A):** the filer may fill the **`requester` slot and
no other**. Signing `approver` or `payment_releaser` is refused under its own
name — not `same_person_cannot_fill_multiple_roles`, which is about two slots and
would send a reader to the loop that is already correct. The floor stays at two
distinct signatures, so the minimum is two humans on any payment and three above
the floor.

**Reading (B) was live and was not taken**, and it is this document's own literal
wording: *"the requester may not fill **either** approval slot"*, applied to
UC-09's three slots as `[A-2]` applied it to UC-06's two, would make slot 1 an
independent employer signatory and the minimum three humans. (A) was chosen
because `00-FOUNDATION.md` §5 names three **parties** — `requester ≠ approver ≠
payment releaser` — and a party who signs nothing is not party to the control;
because the sidebar already tells the reader that this slot decides *"that the
adjustment is the one they asked for"*, which is an attestation only the filer can
make; and because it leaves the floor's cost where every other document puts it.
**So this clause reads differently for a two-slot control and a three-slot one**,
and that is now stated here rather than left for the next reader to resolve.

**The transferable lesson, and the reason this box is long.** A pass that fixes
one instance of a defect naturally reaches for the other instances as examples —
and states their condition **from memory rather than from the file**. UC-06's pass
verified UC-06 exhaustively and took UC-09 on trust *because UC-09 looked
stricter*. A correction can propagate a false claim, and a false claim inside a
correction is the hardest kind to catch: everything around it was just checked.
`docs/WHY-THIS-SHAPE.md` §18.

Full resolution: `qa/contracts/UC-09-acceptance.md` §0.6, §0.7, §17 (DRIFT-050's
disposition) and §17b (DRIFT-110); build items `[P-1]` and `[P-2]`, with `[P-2]`'s
documentation half landing **ahead of** `[P-1]` because a gap plus a written
assurance that there is no gap is worse than the gap.

**Slot 1 is the employer's signature, not the requesting admin's approval
(2026-08-21).** The two signatories sit on two sides of the relationship — the
employer's signing representative, and Remote's payroll specialist — which is why
this control is cross-organisational four-eyes rather than an internal review
step. Remote's own status machine already names the first
(`awaiting_employer_signature` / `employer_signed_at`), and
`src/remoteui/roles.js:24` already models that person as *"the company
representative, distinct from the admin USER who operates the console."* Note the
vocabulary trap this ADR inherited: **"customer admin" is employer-side** —
"customer" means *Remote's* customer — so the cross-organisational split survives
the rename; what changes is whether the employer side is represented by the
requester or by an independent signatory. `[A-2]`, with `[A-3]` carrying the
migration so live `APPROVER_ROLES` values keep resolving.

**The scoping in the paragraph above is not yet true of the code (2026-08-21).**
This ADR scopes UC-06's dual control to *"the subset Remote's own `automatable`
pre-check has already flagged as needing review"*. **Nothing calls that
pre-check** — `RemoteClient.checkContractAmendmentAutomatable()` exists and has no
call site, so every amendment, including ones Remote's own engine would apply
instantly, consumes two human approvals. That makes the control read as a
*duplication* of Remote's automation rather than a complement to it, which is the
opposite of the argument made above. Decided 2026-08-21: wire it (DRIFT-027
remedy (a), `[A-9]`). Until then, this ADR describes a scoping that does not
exist, and says so here rather than letting a reader assume otherwise.

Full resolution: `docs/use-cases/UC-06.md` §8, `docs/use-cases/UC-09.md` §8,
`qa/contracts/UC-06-acceptance.md` §17 (DRIFT-027, DRIFT-098) and §18, and
`qa/contracts/UC-09-acceptance.md` §17/§17b and §18 for UC-09's half.
