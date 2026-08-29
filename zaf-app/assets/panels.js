/* ---------------------------------------------------------------------------
 * panels.js  —  Per-use-case panels for the shared sidebar shell
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS
 * 00-FOUNDATION.md §6 lists `zaf-sidebar` as ONE shared component that "each
 * HITL UC registers a panel" with — not one app per use case. main.js owns
 * everything common to every case (the decision, the flags, the reason, the
 * approve/decline controls, the errors); this file owns only what differs. Adding
 * UC-06's dual-approval view later means adding a key here, not a second app,
 * a second manifest, and a second thing to install in Zendesk.
 *
 * A panel returns DATA, never HTML. main.js writes every value with
 * `textContent`, so a hostile ticket body or a malformed classification can
 * never inject markup into an agent's browser — the sidebar renders content
 * that originated in a support ticket, which is untrusted text by definition.
 * Returning strings of HTML here would quietly hand that guarantee away.
 *
 * A panel must not decide anything. Whether approve/decline is offered comes from
 * the API's `actionable` flag (src/review/reviewPolicy.js). A panel that
 * re-derived that rule in browser JavaScript would be a second copy of the
 * policy — the exact failure docs/BUILD-LOG.md records for the n8n gates.
 * ------------------------------------------------------------------------- */

(function () {
  "use strict";

  /** Render a value that may legitimately be absent, without printing "undefined". */
  function show(value, fallback) {
    if (value === null || value === undefined || value === "") return fallback || "—";
    return String(value);
  }

  /* A country the reader reads, from the code the record stores. See
     country.js: `country()` names a bare alpha-2 code and leaves everything
     else — a name the server already sent, prose, an absence — exactly as it
     arrived. `countryRef()` adds the code back in parentheses, and is used only
     where somebody may have to quote the reference into another system.

     NEITHER IS EVER READ BACK. These are display transforms at the point of
     rendering: the row's own value is untouched, and nothing this panel returns
     is compared, posted or stored. */
  function country(value, fallback) {
    if (value === null || value === undefined || value === "") return fallback || "—";
    return window.CXCountry ? window.CXCountry.text(value, fallback || "—") : String(value);
  }

  function countryRef(value, fallback) {
    if (value === null || value === undefined || value === "") return fallback || "—";
    return window.CXCountry ? window.CXCountry.nameAndCode(value, fallback || "—") : String(value);
  }

  /** A list of country codes as one readable phrase. */
  function countryList(values, fallback, decorate) {
    var list = values || [];
    if (!list.length) return fallback || "—";
    if (window.CXCountry) return window.CXCountry.join(list, fallback || "—", decorate);
    return list.join(", ");
  }

  function percent(value) {
    return typeof value === "number" ? Math.round(value * 100) + "%" : "—";
  }

  function date(value) {
    if (!value) return "—";
    var d = new Date(value);
    return isNaN(d.getTime()) ? String(value) : d.toLocaleString();
  }

  /** The first N characters of an id/hash, for a row a specialist can cross-check
      without printing the whole opaque string. Never the value used to look
      anything up programmatically — display only. */
  function shortRef(value, length) {
    if (!value) return "—";
    var s = String(value);
    return s.length > length ? s.slice(0, length) + "…" : s;
  }

  /**
   * Render a Remote ×100 money integer (src/shared/money.js) for display.
   * Anything that is not an integer renders as "—", never as a 0 that would
   * read as "free" — the same distinction UC-07's cost estimate draws between
   * a CALCULATED component and a QUOTE_REQUIRED one.
   */
  function money(remoteInteger, currency) {
    if (typeof remoteInteger !== "number" || Math.round(remoteInteger) !== remoteInteger) return "—";
    var human = remoteInteger / 100;
    return human.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " " + show(currency, "");
  }

  /* =========================================================================
     A STORED VALUE, IN THE READER'S WORDS
     =========================================================================
     The project owner, for the third time and about a third screen: *"All your
     Zendesk bars are made for the person building, not the person using it."*
     These rows were a large part of it. A mobility specialist read
     "Relocation type: permanent_transfer", a payroll specialist read
     "Type: retroactive_pay" three lines above a panel that says "retroactive
     pay", and a tax specialist read "Inquiry type: treaty_interpretation".
     Every one of them was the value the store keeps, printed at somebody who
     never chose that vocabulary and gains nothing from it.

     WHAT THIS DOES AND, MORE IMPORTANTLY, WHAT IT DOES NOT.
     It opens out underscores and lowercases a SCREAMING_SNAKE constant. It does
     NOT translate, expand, rank or interpret — `words()` cannot invent a
     meaning, because it only ever rearranges the characters it was given. That
     is deliberate: the server owns every vocabulary in this system
     (`src/uc09/decisionFacts.js` opens the same values out the same way for the
     basis panel), and a browser file that started MAPPING slugs to sentences
     would be a second copy of a vocabulary — the drift this repository has
     already paid for in country codes, in the n8n gate bodies, and in three
     copies of one contract-type map (commit 03df132).

     The one place a real map appears below is UC-07's feasibility verdict, and
     it carries its own note saying why a rearrangement is not enough there.

     NOTHING IS READ BACK. Like `country()` above, this is a transform at the
     point of rendering: the row's own value is untouched, and nothing this file
     returns is compared, posted or stored. */
  function words(value, fallback) {
    if (value === null || value === undefined || value === "") return fallback || "—";
    var text = String(value);
    /* Only a SLUG is rearranged. A value with spaces in it is already prose
       somebody wrote, and lowercasing it would be this file editing a sentence
       it did not write. */
    if (/\s/.test(text)) return text;
    if (/^[A-Z0-9_]+$/.test(text)) text = text.toLowerCase();
    return text.replace(/[_-]+/g, " ");
  }

  /* E5-F18 (rca-3fm) — one string, shared by the "Return address (third
     party)" row and approveHint()'s send instruction, so a case with no
     captured return address reads the same fact in both places instead of a
     bare em-dash in one and a sentence implying an address exists in the
     other. */
  /* WHAT "APPROVE" ACTUALLY DOES, and it stopped being one sentence on
     2026-08-28.

     It used to be true of every UC-01 case that approving issued the STANDARD
     letter and that the letter could never state a salary. The panel said so
     in those words. Then the owner decided that approving an over-scope
     request should issue Remote's OTHER document — the customized letter,
     which states the fields that were asked for (src/uc01/disclosureFields.js,
     docs/UC01-INTAKE-FIELDS.md §4).

     So the old sentence is now false on exactly one reason and true on every
     other, and a panel that keeps saying "never salary" above an Approve
     button that discloses one is worse than a panel that says nothing: it
     tells the specialist their click is safer than it is. These two helpers
     are the branch, kept here rather than inline so the third-party wording
     and the ordinary wording cannot drift apart — they were already two copies
     of the same promise, and two copies is how the promise gets updated in one
     place and left stale in the other. */
  /* KEPT IN STEP WITH src/uc01/disclosureFields.js's DISCLOSURE_REASONS BY
     TEST, not by hope — test/uc01Disclosure.test.js reads this list out of
     this file and compares it against the server's. A browser bundle cannot
     import from src/, and a second copy of a security-relevant list is exactly
     how the first version of this feature went wrong (the sidebar gated on one
     condition and the letter on none), so the copy is allowed to exist and is
     not allowed to drift. */
  var DISCLOSURE_REASONS = ["over_scope_request"];

  function isOverScope(c) {
    return !!c && DISCLOSURE_REASONS.indexOf(c.reason) !== -1;
  }

  function overScopeClause(c) {
    return isOverScope(c)
      ? " It will state the fields listed above, read from the employee's Remote record — nothing is typed by hand and " +
        "nothing the record does not carry is stated at all."
      : " The letter discloses only the standard fields — never salary.";
  }

  var THIRD_PARTY_NO_RETURN_ADDRESS = "No return address on file";

  /** "yes"/"no"/"—" for a tri-state flag, so an unknown never prints as false. */
  function yesNo(value) {
    if (value === true) return "Yes";
    if (value === false) return "No";
    return "—";
  }

  /* THE TWO PLACES A REARRANGEMENT IS NOT ENOUGH, each with the reason.

     A FEASIBILITY VERDICT. `BLOCK`, `REVIEW` and `PROCEED` are the gate's three
     words, and only one of them is self-explanatory to the person reading the
     dossier. PROCEED is the dangerous one: it means the deterministic gates
     found nothing wrong with the PLAN, and UC-07 has no execution path, so it
     is not — and cannot be — an approval. That is `describeVerdict()`'s own
     account in src/uc07/dossierView.js, restated here because this row is where
     a specialist first meets the word. Lowercasing "PROCEED" would leave the
     misreading exactly where it was.

     WHO READ THE REQUEST. `llm` and `rule_based_fallback` are 00-FOUNDATION.md
     §4's invariant 8 — which path answered — and a specialist weighing a parsed
     relocation needs it. Neither string survives being merely tidied. */
  var VERDICT_WORDS = {
    BLOCK: "Blocked as proposed",
    REVIEW: "Needs review before sign-off",
    PROCEED: "No blocking condition found — not an approval",
  };
  var PARSE_SOURCE_WORDS = {
    llm: "a language model read the request text",
    rule_based_fallback: "keyword rules, not a model — the model was unavailable or its answer was unusable",
  };

  /** Append a row only when it has something to say. Keeps sparse cases clean. */
  function push(rows, label, value) {
    rows.push({ label: label, value: value });
  }

  /* =========================================================================
     `approvalRoles(view)` — WHAT CAPACITY THE AGENT IS BEING ASKED TO ACT IN
     =========================================================================
     THE QUESTION THIS ANSWERS, ASKED BY A REAL SPECIALIST ON A REAL TICKET:
     "does the tag section show me which type of human approval I am acting
     as?" It does not. `uc04_specialist_approval` and
     `queue_mobility_specialists` are ROUTING metadata — they say where the
     ticket went, not what the person reading it is being asked to be — and
     Zendesk's tag box is nobody's idea of where to look for that. So the
     sidebar says it, in the Decision card, in words.

     IT MATTERS MORE SINCE ROLE ENTITLEMENT LANDED (src/review/
     approverEntitlement.js). An approver can now be refused
     `approver_not_entitled` ON CLICK, which is a poor way to learn you were
     never the right person for this ticket.

     WHAT THIS MAY AND MAY NOT SAY, AND THE LINE IS EXACT.
       · IT MAY name the role a slot is for. That is a property of the USE
         CASE, fixed in src/review/approverEntitlement.js's USE_CASE_ROLES, and
         it is already hard-coded in this file as the fieldset legends the
         controls render under. test/zafApprovalRole.test.js imports that
         module and asserts every `roleId` below against it, so the two cannot
         drift.
       · IT MAY report which slots are filled and by whom. Those are values
         read straight off the row the API returned — the same reading
         renderActions already does for the approval meter.
       · IT MAY NOT say whether the agent reading it holds the role. That is a
         judgement about a person against a roster, it lives server-side, and
         re-deriving it in the browser would be a second copy of the policy —
         the exact defect this file's header forbids. main.js prints an
         entitlement verdict ONLY when the API sends one (`youHold` on
         `view.approvalRoles`); today no API sends it, so the panel says
         plainly that the check happens on submit and that this screen was not
         told the answer.
       · IT MAY NOT gate a control. `view.actionable` remains the one question
         that decides whether anything is clickable, asked in exactly one place
         (main.js's renderActions). A 🔴 use case returns an empty `roles` list
         and stays exactly as unactionable as it was.

     SHAPE (also the shape an API should send as `approvalRoles`, so the server
     can take this over with no change to the browser):
       {
         summary: string,                 // one plain sentence, always safe to print
         roles: [{
           roleId:   string|null,         // "uc04:mobility_specialist" — the
                                          // entitlement grant, exactly as
                                          // APPROVER_ROLES spells it, or null
                                          // for a use case with no roster
           label:    string,              // what a person calls that role
           decides:  string,              // what THIS role is deciding
           filledBy: string|null,         // who has already signed this slot
           filledOn: string|null,         // when
           filledAs: string|null,         // "Approved" / "Declined" / "Signed off"
           youHold:  true|false|null      // SERVER ONLY. null = not answered.
         }]
       }
     ====================================================================== */

  window.CXPanels = {
    /**
     * UC-01 — Employment verification. The panel answers the question a
     * specialist actually has in front of them: what did the AI think this was,
     * how sure was it, and has a letter already gone out?
     */
    "UC-01": {
      title: "Employment verification",
      rows: function (view) {
        var c = view.case || {};
        var cls = c.classification || {};
        var letters = (view.documents || []).filter(function (d) {
          return d.type === "employment_verification_letter";
        });
        var rows = [
          { label: "Employee", value: show(c.employmentId) },
          { label: "Requester", value: show(c.requester) },
          { label: "Request type", value: words(cls.intent) },
          { label: "Asked by", value: words(cls.requesterType) },
          /* NOT "AI confidence". Confidence in WHAT was the question a reader
             had to answer for themselves, and the answer is not obvious: it is
             the classifier's confidence in its READING of the request, which is
             what gate 3 compares against the floor. UC-02's own row was renamed
             "Confidence in the CATEGORY" for exactly this reason, and
             src/uc03/policyEngine.js publishes the same fact as "Confidence in
             the reading of the request". One name, three panels. */
          { label: "Confidence in the reading of the request", value: percent(cls.confidence) },
          {
            label: "Letter issued",
            value: letters.length ? "Yes — " + letters.length + " on file" : "Not yet",
          },
          { label: "Opened", value: date(c.createdAt) },
        ];
        /* rca-0f5j (R7-02) — "Letter issued — Yes" was a bare assertion: no
           view, download or resend control stood beside it, so a specialist
           had no way to check the claim and one declined to act on a ticket
           for exactly this reason. There is no specialist-facing endpoint
           that serves a document's rendered content (src/review/store.js's
           findDocumentsByCaseId() strips `content` from every row it
           returns, deliberately — see its own header — so this app has
           never held the letter body to show), and inventing one here would
           both violate that boundary and be the exact "second backend" this
           file's header and the dispatch note warn against.
           What DOES already exist, and needs no new plumbing at all: for
           every case except a third-party-door disclosure (whose own
           "Outward disclosure" row below says plainly that nothing is
           auto-sent), `submitReviewDecision()` posts the rendered letter as
           THIS TICKET'S OWN PUBLIC REPLY before resolving it
           (src/review/service.js's `zendesk.resolveWithLetter()`), and the
           n8n auto-resolve path does the same. So the letter is not behind a
           control this panel could fetch — it is already in the transcript
           the specialist has open beside this sidebar. This row says so, and
           gives the id/hash `audit_log.details.letterDocumentId` /
           `letterContentHash` were written with, so the copy on screen can
           be checked against the record rather than only against itself. */
        if (letters.length && c.source !== "third_party_door") {
          var latestLetter = letters[letters.length - 1];
          rows.push({
            label: "Verify the letter",
            value:
              "Posted as this ticket's own public reply — open the conversation above to view, save or forward it again. " +
              "Most recent: " + date(latestLetter.createdAt) +
              ", doc " + shortRef(latestLetter.id, 8) +
              ", hash " + shortRef(latestLetter.contentHash, 10) + ".",
          });
        }
        /* E4-F16 (rca-0nm) — a third-party-door case's ticket requester is
           Remote's own door, never the bank or landlord who actually asked
           (VC-33), so "Letter issued" reading Yes does not mean the third
           party has been told anything. Two rows make that visible WITHOUT a
           click, not just inside the approve hint below — the finding's own
           point was that nothing said the manual step was outstanding until
           a reader went looking for it.

           E5-F18 (rca-3fm) — this row used to call show(c.returnAddress) with
           NO fallback, so an absent address rendered a bare "—" directly
           under "Outward disclosure: MANUAL SEND OUTSTANDING" — an
           instruction to post the letter with no destination and no
           explanation that none was captured. THIRD_PARTY_NO_RETURN_ADDRESS
           is shared with approveHint() below so the two surfaces say the
           same thing rather than one implying an address exists (see that
           function's own note). */
        if (c.source === "third_party_door") {
          rows.push({ label: "Return address (third party)", value: show(c.returnAddress, THIRD_PARTY_NO_RETURN_ADDRESS) });
          rows.push({
            label: "Outward disclosure",
            value: letters.length
              ? "MANUAL SEND OUTSTANDING — this system does not send it; nothing reaches the third party until a person does"
              : "Not sent — depends on this ticket's approval",
          });
          /* D-11 (rca-kfg2) — the decision note names a consent_records row by
             id ("Consent record: <id> — open it to see who granted it, to
             whom and for what purpose") and, before this, nothing in the app
             frame could resolve that id: not this panel (it never had the
             row), and not a Zendesk search (it finds only the ticket that
             printed the id). `view.consentRecord` is the SAME row, resolved
             server-side (src/review/server.js) by the identical employment id
             + requesting party + purpose lookup the original decision used —
             never re-derived here, which would be the exact policy
             duplication this file's header forbids. Absent (`null`) is
             distinct from not-yet-fetched (`undefined`): `null` means the
             server looked and found no matching row, which is itself
             something worth saying rather than rendering nothing. */
          if (view.consentRecord) {
            var cr = view.consentRecord;
            rows.push({ label: "Requesting party", value: show(cr.requestingParty) });
            rows.push({ label: "Purpose stated", value: show(cr.purpose) });
            rows.push({ label: "Consent status", value: words(cr.status) });
            rows.push({ label: "Consent granted/denied by", value: show(cr.grantedByEmploymentId, "Not yet decided") });
            rows.push({ label: "Consent decided", value: cr.grantedAt ? date(cr.grantedAt) : "Not yet decided" });
            rows.push({ label: "Consent requested", value: date(cr.createdAt) });
            /* D-28 (rca-87ee) — "asserted" means the requesting party said,
               through the third-party door's own evidence step, that they
               already hold the employee's written authorisation, and
               attached what they sent. It is NOT the employee's own consent
               (isConsentGranted() requires status === "granted" exactly —
               src/shared/consentArtifact.js) — this row is still shown as
               pending above unless/until the employee decides. Shown only
               when present so an ordinary pending/granted/denied row is
               unchanged. */
            if (cr.evidenceReference) {
              rows.push({ label: "Evidence the requester attached", value: show(cr.evidenceReference) });
            }
          } else if (view.consentRecord === null) {
            rows.push({ label: "Consent record", value: "No consent_records row found for this employment, requesting party and purpose" });
          }
        }
        return rows;
      },
      /**
       * Shown above the action buttons. This is the one line that tells the
       * specialist what clicking Approve will actually DO, which is the
       * difference between an informed approval and a reflex click.
       */
      approveHint: function (view) {
        var c = (view && view.case) || {};
        /* E4-F16 (rca-0nm) — ticket #108: the generic sentence below is true
           on a Zendesk-borne case, where the ticket's own requester receives
           the resolution. On a third-party-door case the ticket's requester
           is the door itself (VC-33 — the bank never sees this ticket), so
           the same sentence read as "solves the ticket" implying the bank has
           been answered, when nobody outside Remote had been told anything.
           This is copy, not plumbing, on purpose — see the finding for why an
           automatic send was rejected.

           E5-F18 (rca-3fm) — "send the letter to the return address on file"
           used to run unconditionally, phrased as if an address always
           exists (`show(c.returnAddress, "the return address on file")`
           reads exactly like a real value even when the fallback fired). On
           ticket #114 no return address had been captured at all, so the
           sentence told the specialist to post the letter to a destination
           that does not exist — under a rows table right above it that, until
           this same fix, said so with nothing but a bare em-dash. Now the
           sentence itself branches on whether an address is on file, and
           says plainly when it is not — the exact wording the "Return
           address (third party)" row shows, so a reader who reads one
           surface first is not contradicted by the other. */
        if (c.source === "third_party_door") {
          var hasReturnAddress = c.returnAddress !== null && c.returnAddress !== undefined && c.returnAddress !== "";
          var sendInstruction = hasReturnAddress
            ? "Once approved, send the letter to " + c.returnAddress + " yourself; until you do, they have been told " +
              "nothing beyond the door's fixed acknowledgement."
            : "Once approved: " + THIRD_PARTY_NO_RETURN_ADDRESS + " — locate one (this ticket's own comments are the " +
              "usual place) before the letter can be sent; until it is sent, the requester has been told nothing " +
              "beyond the door's fixed acknowledgement.";
          /* ONE SOURCE FOR WHICH LETTER, on this branch too. It used to
             hard-code "the standard verification letter" and then append a
             clause that could say the letter WILL state the requested fields —
             two sentences, opposite claims, one screen, on the surface where a
             third party is involved and the stakes are highest. */
          return (
            "Approving issues " + (isOverScope(c) ? "a customized" : "the standard") +
            " verification letter and solves this INTERNAL ticket — the requester on this " +
            "ticket is Remote's own third-party door, never the third party who asked, so nothing is sent to them " +
            "automatically. " +
            sendInstruction +
            overScopeClause(c)
          );
        }
        return (
          "Approving issues " + (isOverScope(c) ? "a customized" : "the standard") +
          " verification letter and solves the ticket." + overScopeClause(c)
        );
      },

      /* WHAT CAPACITY THE PERSON READING THIS IS BEING ASKED TO ACT IN.
         See the block comment above window.CXPanels for the whole reasoning and
         the shape. DATA ONLY — main.js draws it, and nothing here decides
         whether a control exists.

         K10 (qa/HUMAN-DECISIONS-REQUIRED.md, 2026-08-23; commit 59fa585)
         gave UC-01 a real roster row — USE_CASE_ROLES["UC-01"] in
         src/review/approverEntitlement.js now grants `hr_ops`, the same
         slot UC-05 uses, on purpose (see that file's own comment on why a
         UC-01-only token would refuse people an operator already rostered
         for UC-05). This used to say "UC-01 has no named approval role",
         which 59fa585 made false in both directions: a role now exists, and
         an unentitled specialist is refused rather than let through. The
         sentence has to change with the roster, or the sidebar tells an
         agent they are the right person for a ticket the API is about to
         403 them on — the exact "gate that refuses the right people"
         failure src/review/approverEntitlement.js's header exists to avoid,
         read backwards.

         UC-01 has no use-case-specific store (unlike UC-05/UC-06, which
         carry their own approval columns on the case row) — the shared
         `review_queue` row is where the decision and its actor land
         (src/review/service.js's `updateReviewQueueStatus()`), so this
         reads `view.review`, not `view.case`. */
      approvalRoles: function (view) {
        var review = (view && view.review) || {};
        var filledAs = review.status === "approved" ? "Approved" : review.status === "rejected" ? "Declined" : null;
        return {
          summary:
            "One HR Ops specialist decides this — the entitlement roster grants uc01:hr_ops, and a specialist " +
            "who isn't rostered for it is refused rather than let click through.",
          roles: [
            {
              roleId: "uc01:hr_ops",
              label: "HR Ops",
              decides: "whether to approve or decline this employment verification letter",
              filledBy: filledAs ? review.assignee || null : null,
              filledOn: filledAs && review.updatedAt ? date(review.updatedAt) : null,
              filledAs: filledAs,
            },
          ],
        };
      },
    },

    /**
     * UC-06 — Contract Amendment / Payroll Cutoff. Dual control: a Customer
     * Admin AND a Remote Payroll specialist must independently approve before
     * anything is written back to Remote. main.js's default single approve/
     * decline pair doesn't fit that — two role slots, possibly filled days
     * apart by different people — so this panel supplies its own
     * `renderActions`. main.js still owns the only question that matters
     * for whether ANY controls render at all: `view.actionable`. This panel
     * only decides what the controls look like once that gate has already
     * said yes.
     */
    "UC-06": {
      title: "Contract amendment",
      rows: function (view) {
        var a = view.case || {};
        return [
          { label: "Employee", value: show(a.employmentId) },
          { label: "Requester", value: show(a.requester) },
          { label: "Amendment type", value: words(a.amendmentType) },
          { label: "Requested effective date", value: show(a.requestedEffectiveDate) },
          { label: "Summary", value: show(a.summary) },
          /* THE TWO APPROVAL ROWS ARE GONE (2026-08-20), and this panel is
             where they were most obviously a duplicate: `approvalRoles()` below
             publishes the same two slots with the role's name, what that role
             decides, whether the slot is RECORDED or OUTSTANDING, who filled it
             and when — and main.js draws a meter above the forms counting them.
             "Admin approval: Pending" is a fourth statement of a fact three
             richer ones already carry. Nothing is hidden: both approvals are
             read from the same row the capacity card reads. */
          { label: "Opened", value: date(a.createdAt) },
        ];
      },
      approveHint: function () {
        return "Both a Customer Admin and a Remote Payroll specialist must approve before this amendment is applied.";
      },

      /* WHAT CAPACITY THE PERSON READING THIS IS BEING ASKED TO ACT IN.
         See the block comment above window.CXPanels for the whole reasoning and
         the shape. DATA ONLY — main.js draws it, and nothing here decides
         whether a control exists. */
      approvalRoles: function (view) {
        var a = view.case || {};
        return {
          /* WHAT THE ROWS BELOW DO NOT SAY, AND NOTHING ELSE (2026-08-20).
             "Two different people must both sign, in two different roles" is
             the tier rail's own sentence one card up, and "they are answering
             different questions" is what the two `decides` lines under this
             summary demonstrate by being different. What survives is the pair
             of facts a reader cannot get from either: the order is free, and
             the write happens on the SECOND signature rather than at the end
             of some later process. */
          summary: "Either can go first; the amendment is applied only once both slots are filled.",
          roles: [
            {
              roleId: "uc06:customer_admin",
              label: "Customer Admin",
              decides: "whether the contract change itself is right",
              filledBy: a.adminApproval ? a.adminApproval.approver : null,
              filledOn: a.adminApproval ? date(a.adminApproval.at) : null,
              filledAs: a.adminApproval ? "Approved" : null,
            },
            {
              roleId: "uc06:payroll_specialist",
              label: "Payroll Specialist",
              decides: "whether payroll can carry the change on the requested date",
              filledBy: a.payrollApproval ? a.payrollApproval.approver : null,
              filledOn: a.payrollApproval ? date(a.payrollApproval.at) : null,
              filledAs: a.payrollApproval ? "Approved" : null,
            },
          ],
        };
      },
      /**
       * @param {object} view   the normalized view — view.case is the raw
       *   amendment row, view.post(action, {role, approver, note}) submits.
       * @param {{el:Function, resize:Function, reload:Function}} ctx  DOM/
       *   reload helpers from main.js — no fetch/credentials live here either.
       */
      renderActions: function (view, ctx) {
        var el = ctx.el;
        var a = view.case || {};
        var container = el("div", "uc06-dual-approval");
        /* NO HINT PARAGRAPH (2026-08-20). approveHint() reads "Both a Customer
           Admin and a Remote Payroll specialist must approve before this
           amendment is applied", and by the time a reader reaches it the tier
           rail has said nothing is written until two named humans in different
           roles approve, the card above has named both roles and what each one
           decides, the meter below says how many of the two are recorded, and
           each fieldset's legend names the role its form is for. The sentence
           was the fifth statement of one fact. It is still the panel's answer
           to `approveHint`, which main.js prints for any panel that supplies no
           renderActions of its own — this one does. */

        // How far along the dual-control gate is, at the top where it is read
        // first. Both numbers come from the API's own row; nothing here decides
        // whether the amendment may proceed.
        var filled = (a.adminApproval ? 1 : 0) + (a.payrollApproval ? 1 : 0);
        container.appendChild(ctx.approvalMeter(filled, 2));

        /* A fieldset with a legend, not a div with an h3.

           Both role blocks contain a control labelled "Your name or email", so
           a screen-reader user tabbing through heard the same name twice with
           nothing to say which role they were filling — on a dual-control gate
           whose entire purpose is that two DIFFERENT people sign. A <legend> is
           announced as the group context for every control inside its
           <fieldset>, which is exactly this, and it does it without giving each
           field a bespoke aria-label that would then disagree with its own
           visible text (WCAG 2.5.3). */
        function roleBlock(role, label, slot) {
          /* THE ROLE IS IN THE CLASS, and the shell reads it back from there.
             main.js's "Acting as" picker has to be able to show one role's form
             at a time without knowing anything about how this panel lays its
             blocks out, and className is the one handle that the real DOM and
             this repo's two test doubles both support — a shell reaching for
             getAttribute would throw inside a double rather than in a browser.
             It changes nothing about what gets POSTed: each block still submits
             its own fixed `role`, and the server still decides whether this
             person may fill it. */
          var block = el("fieldset", "role-block role-slot-" + role);
          block.appendChild(el("legend", "h3", label));

          if (slot) {
            block.appendChild(el("p", "muted", "Approved by " + show(slot.approver) + (slot.note ? " — " + slot.note : "")));
            return block;
          }

          // Real <label for> on both fields, not a placeholder pretending to be
          // one — this is the box whose contents are written to audit_log as
          // the name of the human who authorised a payroll change.
          var approverField = ctx.labelledField("input", "approver-input", "Your name or email", {
            type: "text",
            placeholder: "e.g. you@remote.com",
            required: true,
          });
          block.appendChild(approverField.wrap);
          var approverInput = approverField.control;

          var noteField = ctx.labelledField("textarea", "note", "Note (optional)", {
            rows: 2,
            placeholder: "Recorded in the audit log",
          });
          block.appendChild(noteField.wrap);
          var note = noteField.control;

          // Short visible text, full accessible name. "Approve as Payroll
          // Specialist" wrapped to two cramped lines in a 320px sidebar, and
          // the role is already the block's own heading directly above — but a
          // screen reader tabbing between four identical "Approve" buttons
          // needs the role, so it goes in aria-label rather than in the label.
          var buttons = el("div", "buttons");
          var approve = el("button", "btn approve", "Approve");
          approve.type = "button";
          approve.setAttribute("aria-label", "Approve as " + label);
          // DECLINE, NOT DENY (2026-08-19). `deny` is not a word Remote uses
          // anywhere; `declined` is a member of four of its enums. The server
          // still accepts `deny`, so an older installed bundle keeps working —
          // this button posts the new verb the moment the bundle is re-uploaded.
          var decline = el("button", "btn decline", "Decline");
          decline.type = "button";
          decline.setAttribute("aria-label", "Decline as " + label);
          buttons.appendChild(approve);
          buttons.appendChild(decline);
          block.appendChild(buttons);

          // The verdict of an approve/decline — the one message in this sidebar
          // that reports a write to audit_log. It replaces its own text in place
          // with no focus change, so without a live region a screen-reader user
          // clicks Approve and is told nothing at all about whether it worked.
          var status = el("p", "action-status");
          status.setAttribute("role", "status");
          block.appendChild(status);

          function submit(action) {
            if (!approverInput.value || !approverInput.value.trim()) {
              status.className = "action-status bad";
              status.textContent = "Enter your name or email first.";
              approverInput.focus();
              return;
            }
            approve.disabled = true;
            decline.disabled = true;
            status.className = "action-status";
            status.textContent = "Recording " + action + "…";

            view
              .post(action, { role: role, approver: approverInput.value.trim(), note: note.value })
              .then(function (result) {
                if (result.ok) {
                  status.className = "action-status ok";
                  status.textContent =
                    result.code === "executed"
                      ? "Both approvals recorded — amendment applied."
                      : result.code === "approved_awaiting_second"
                        ? "Recorded. Waiting on the other role."
                        : "Recorded.";
                  setTimeout(ctx.reload, 900);
                } else {
                  status.className = "action-status bad";
                  status.textContent = result.reason || "Refused.";
                  approve.disabled = false;
                  decline.disabled = false;
                }
                ctx.resize();
              })
              .catch(function (err) {
                status.className = "action-status bad";
                status.textContent = "Could not reach the UC-06 API: " + err.message;
                approve.disabled = false;
                decline.disabled = false;
                ctx.resize();
              });
          }

          approve.addEventListener("click", function () {
            submit("approve");
          });
          decline.addEventListener("click", function () {
            submit("decline");
          });

          return block;
        }

        container.appendChild(roleBlock("customer_admin", "Customer Admin", a.adminApproval));
        container.appendChild(roleBlock("payroll_specialist", "Payroll Specialist", a.payrollApproval));
        return container;
      },
    },

    /**
     * UC-08 — Cross-Border Tax & Social Security. The 🔴 use case with no
     * execution path (src/uc08/workflow.js). There is deliberately no
     * `renderActions` here: view.actionable is always false for UC-08 (see
     * src/uc08/server.js), so main.js's own actionability gate always shows
     * the "not open to a decision here" message and never even asks this
     * panel what controls would look like. Same "escalation is visible, not
     * actionable" pattern UC-01 already applies to its own escalations —
     * here it's just true of every single case, not a subset.
     */
    "UC-08": {
      title: "Cross-border tax inquiry",
      /* THIS PANEL'S RECORD IS ITS ANALYSIS — read by main.js's
         hasDecisionAccount(). A 🔴 use case has no execution path, so the rows
         below are not a reference copy of something the page states elsewhere:
         they are the entire thing the escalation produced. Everywhere else the
         rows collapse into "The case record" once a findings section leads the
         page, and once these views began publishing a `basis` (their citation
         map, commit 553c4a9) that rule swept the verdict, every flag with its
         message, the cost estimate and the narrative one click down, under the
         reference material they were written from. A citation map is not an
         account; it is what an account was written from. DATA, NOT A DECISION:
         main.js reads this and still owns what renders. */
      recordIsTheAnalysis: true,
      rows: function (view) {
        var d = view.case || {};
        var dossier = d.dossier || {};
        var presence = d.presenceDays;
        return [
          { label: "Employee", value: show(d.employmentId) },
          { label: "Inquiry type", value: words(d.inquiryType) },
          /* NAME AND CODE, and this is the one row on this panel where the code
             earns its place. A tax specialist reading a cross-border dossier
             goes on to look the PAIR up — in a treaty index, in a totalization
             table, in a colleague's message — and those are keyed by code.
             Everywhere else on this page the parenthesis would be noise; here
             it is the reference. */
          {
            label: "Jurisdictions",
            value: countryList(d.jurisdictions, "—", "withCode"),
          },
          { label: "Presence days", value: presence ? presence.days + " day(s) across " + presence.periodsCounted + " period(s)" : "Not computed" },
          /* NOT "Citations" ANY MORE, BECAUSE THERE ARE NOW TWO LISTS AND THEY
             ARE NOT THE SAME LIST. `dossier.citations` is what the treaty
             RETRIEVER matched out of the curated corpus for this inquiry —
             titles, no locator, no quotation, no caveat. `basis.*.sources`,
             which this panel's findings now render properly through main.js's
             renderSources(), is the hand-curated map of which instrument each
             statement rests on, with its article, what it is cited for and the
             contradictions the corpus records against it. Labelling the weaker
             one "Citations" while the stronger one sits beside it under "The
             rules this is based on" would make a reader think they had seen the
             citations when they had seen the retrieval hits. The row stays
             because what the retriever matched is worth knowing — and it is no
             longer the only place a citation appears, which is the condition
             under which keeping it is defensible at all. */
          { label: "Reference corpus matched", value: (dossier.citations && dossier.citations.length) ? dossier.citations.map(function (c) { return c.title; }).join("; ") : "None matched" },
          { label: "Narrative", value: show(dossier.narrative) },
          { label: "Opened", value: date(d.createdAt) },
        ];
      },
      approveHint: function () {
        return "UC-08 has no execution path — there is nothing to approve. This dossier is research support for a Tax Ops specialist's own review.";
      },

      /* WHAT CAPACITY THE PERSON READING THIS IS BEING ASKED TO ACT IN.
         See the block comment above window.CXPanels for the whole reasoning and
         the shape. DATA ONLY — main.js draws it, and nothing here decides
         whether a control exists. */
      approvalRoles: function () {
        return {
          /* THE ANSWER, AND NOT THE PAGE AGAIN (2026-08-20). The tail said
             "UC-08 has no execution path at all", which is the tier rail's own
             sentence, and "the dossier is research support a Tax Ops specialist
             reads", which is the mandatory framing statement's — and that one
             is printed at the top of the page, verbatim, on purpose. The half
             that is only here is that this is not a permissions problem: no
             role would change it. */
          summary: "Nobody approves anything here, and no role would change that.",
          roles: [],
        };
      },
    },

    /**
     * UC-02 — Expense & Receipt Validation. A compliant claim auto-approves
     * inside the workflow itself; a FLAGGED one is actionable here, through
     * UC-02.md §6's Finance Ops decision (approve / decline / hold). See
     * `renderActions` below, and src/uc02/reviewPolicy.js for the policy that
     * `view.actionable` is the real verdict of.
     */
    "UC-02": {
      title: "Expense validation",
      rows: function (view) {
        var e = view.case || {};
        // WHICH GATE DECIDED comes from the SERVER (`view.decidedBy`, computed
        // by describeDecidingGate in src/uc02/policyEngine.js). This panel does
        // not re-derive gate order — it prints what it was told.
        //
        // It matters because of a real misreading: `expense_employment_mismatch`
        // printed beside "Confidence 90%" made the confidence look causal.
        // Ownership is gate 4, confidence is gate 13, first failure wins, so
        // that run never consulted the confidence at all. The figure stays
        // visible (hiding an input is its own dishonesty) and is labelled with
        // what it describes and whether anything read it.
        var gate = view.decidedBy || {};
        return [
          { label: "Employee", value: show(e.employmentId) },
          { label: "Expense", value: show(e.expenseId) },
          /* DECISION, REASON, DECIDED BY, FLAGS AND STATE ARE NOT ROWS ANY MORE
             (2026-08-20). 0f71708 made exactly this cut on UC-04 and did not
             finish the sweep; this is the rest of it. The outcome badge in the
             header is the decision, the WHY card is the reason in words with
             the audit slug beneath it, the collapsed provenance block is
             "Decided by gate 4 — Expense ownership" AND the flag codes, and
             the "Finance Ops" row two lines down is what a reviewer actually
             wants from `status` — whether anybody has acted on it. Every one
             of them was a second copy that could only ever agree or be wrong.
             `view.decidedBy` is still read for the confidence row below, which
             is the one thing on this card that no other part of the page can
             say: whether this run consulted that figure at all. */
          { label: "Category", value: show(e.categoryId) + (e.categorySource ? " (" + words(e.categorySource) + ")" : "") },
          {
            label: "Confidence in the CATEGORY",
            value:
              percent(e.confidence) +
              (gate.gate ? (gate.confidenceConsulted ? " — consulted" : " — not consulted by this run") : ""),
          },
          { label: "Opened", value: date(e.createdAt) },
          {
            label: "Finance Ops",
            value: e.reviewAction
              ? words(e.reviewAction) + " by " + show(e.reviewer) + " on " + date(e.reviewedAt)
              : "Not yet reviewed",
          },
          { label: "Reviewer note", value: show(e.reviewNote) },
        ];
      },
      approveHint: function () {
        return (
          "UC-02 is low tier: a compliant claim auto-approves with no human involved. " +
          "A FLAGGED one comes here — UC-02.md §6's Finance Ops decision. Approve approves " +
          "it at Remote, Decline declines it there and needs a reason (Remote requires one), " +
          "and Hold parks it without writing anything to Remote, so it can still be decided later."
        );
      },

      /* WHAT CAPACITY THE PERSON READING THIS IS BEING ASKED TO ACT IN.
         See the block comment above window.CXPanels for the whole reasoning and
         the shape. DATA ONLY — main.js draws it, and nothing here decides
         whether a control exists. */
      approvalRoles: function (view) {
        var e = view.case || {};
        return {
          // The row below names the reviewer and what they decide, under a
          // heading that asks who decides. What a row cannot say is that there
          // is no SECOND one — an absence is not visible as a missing row.
          summary: "There is no second signature and no dual control on this claim.",
          // NO `roleId`. UC-02 is not one of the four use cases with an
          // entitlement roster (src/review/approverEntitlement.js's
          // USE_CASE_ROLES), and printing an id that no roster defines would
          // invent a control that does not exist. Naming the function is honest;
          // naming a grant would not be.
          roles: [
            {
              roleId: null,
              label: "Finance Ops reviewer",
              decides: "whether this claim is reimbursed, declined, or parked",
              filledBy: e.reviewer || null,
              filledOn: e.reviewedAt ? date(e.reviewedAt) : null,
              filledAs: e.reviewAction || null,
            },
          ],
        };
      },
      /**
       * THIS PANEL USED TO SUPPLY NO ACTIONS, and said in its own approveHint
       * that there was "no approve/deny surface here". There is one now — see
       * src/uc02/reviewPolicy.js. A panel that denies the existence of a
       * control the API offers is worse than no panel: an agent reads it,
       * believes the exception is somebody else's problem, and the claim sits
       * flagged forever.
       *
       * THREE buttons, not two, which is why this uses the generalised helper's
       * `actions` list rather than its approve/deny default. `decline` names
       * the note as REQUIRED because Remote's DeclineExpenseParams makes
       * `reason` mandatory — the server refuses without it (400
       * `decline_reason_required`), and a button that reliably 400s is a bug
       * the user pays for.
       *
       * THE POSITIVE BUTTON SAID "RELEASE" UNTIL 2026-08-19 and now says
       * "Approve", because Remote records the result as `approved` and every
       * sibling panel here already says approve. The button posts `approve`;
       * the API still accepts `release` from a ZAF bundle that has not been
       * re-uploaded yet (src/uc02/reviewPolicy.js's ACTION_ALIASES), so the
       * two halves can be deployed in either order.
       *
       * The pair is approve/DECLINE because `decline` is Remote's own word —
       * its request type is `DeclineExpenseParams` and its status enum member
       * is `declined`. UC-02 was the ONLY panel saying it until 2026-08-19,
       * when UC-04, UC-05, UC-06 and UC-01's own review followed (`deny`
       * appears zero times in Remote's corpus). UC-09 is the one still saying
       * Deny, and that is a pending rename rather than a decision.
       */
      renderActions: function (view, ctx) {
        return renderSingleApproverActions(view, ctx, {
          role: "finance_ops",
          groupLabel: "Finance Ops decision",
          noteLabel: "Reason / note",
          actions: [
            { action: "approve", label: "Approve", className: "approve" },
            { action: "decline", label: "Decline", className: "decline", requiresNote: true },
            { action: "hold", label: "Hold", className: "" },
          ],
          codeMessages: {
            approved: "Approved — the claim was approved at Remote.",
            declined: "Declined at Remote, with your reason attached.",
            held: "Held — nothing was written to Remote; the claim can still be approved or declined.",
          },
        });
      },
    },

    /**
     * UC-03 — Travel Support Letter / Workation router. A thin router that
     * decides almost everything itself: auto-resolved, escalated, or handed
     * off to UC-04, none of which is decided from this panel.
     *
     * THE ONE EXCEPTION IS THE FORMAL TRAVEL LETTER, and it is now reachable.
     * `policyEngine.js`'s gate 11 stops a drafted letter until a specialist has
     * read and signed it — "that sign-off is the whole reason this stops here"
     * — and src/uc03/server.js grew the two routes for it. Until then this
     * panel's own comments said, correctly, that UC-03 had no write route at
     * all; they said it for a while after it stopped being true, which is why
     * `actionable` is now the SERVER's answer in main.js's loadUc03 rather than
     * a constant here.
     */
    "UC-03": {
      title: "Travel support / workation router",
      rows: function (view) {
        var c = view.case || {};
        var cls = c.classification || {};
        return [
          { label: "Employee", value: show(c.employmentId) },
          { label: "Requester", value: show(c.requester) },
          { label: "Intent", value: words(cls.intent) },
          { label: "Destination", value: country(cls.destinationCountry) },
          // Decision / Reason / Flags removed 2026-08-20 — see the UC-02 note.
          // The badge, the WHY card with its slug, and the provenance block
          // each say one of them, and say more than a row can.
          { label: "Opened", value: date(c.createdAt) },
        ];
      },
      /* Only reached when the server has already said the case is actionable,
         which for UC-03 means exactly one thing: a drafted travel letter is
         waiting for a signature. The hint says what signing DOES, because it is
         the only irreversible act this use case has — the letter goes out on
         the legal entity's letterhead to a consulate or a border officer. */
      approveHint: function () {
        return "Signing off issues the drafted letter on the employing entity's letterhead and posts it to the requester. Declining records why and issues nothing.";
      },

      /* THE ONLY CONTROL UC-03 HAS EVER HAD. The verbs are the API's own
         (`signoff` / `decline`, src/uc03/server.js) — "approve" is not one of
         them and the default pair in main.js would have posted it, so this
         panel supplies its own actions for the same reason UC-05's does.

         NOTHING HERE ACCEPTS THE LETTER OFFER. That is the traveller's act on
         their own session, and it has no control on this screen at all — see
         renderLetterOffer in main.js. */
      renderActions: function (view, ctx) {
        return renderSingleApproverActions(view, ctx, {
          role: "travel_support_specialist",
          approveAction: "signoff",
          approveLabel: "Sign off the letter",
          declineLabel: "Decline",
          groupLabel: "Travel & Mobility Support sign-off",
          noteLabel: "Note (required to decline)",
          codeMessages: {
            signed_off: "Signed off — the letter was issued and the ticket solved.",
            declined: "Declined and recorded. No letter was issued.",
          },
        });
      },

      /* WHAT CAPACITY THE PERSON READING THIS IS BEING ASKED TO ACT IN.
         See the block comment above window.CXPanels for the whole reasoning and
         the shape. DATA ONLY — main.js draws it, and nothing here decides
         whether a control exists. */
      approvalRoles: function () {
        /* UC-03 NAMES A ROLE AND MOSTLY OFFERS NO CONTROL, and both halves are
           deliberate. `view.actionable` is the server's answer (loadUc03), and
           for this use case it is true of exactly one thing: a drafted travel
           letter waiting on a signature. Every other UC-03 outcome — resolved,
           escalated, routed on to UC-04 — is refused BY NAME by
           src/uc03/signoffPolicy.js, so nothing else here is clickable.

           The role is named because the roster now defines one
           (USE_CASE_ROLES["UC-03"] in src/review/approverEntitlement.js): the
           formal travel letter is the single thing this router cannot finish
           alone, and Travel & Mobility Support is who signs it. A specialist
           reading an escalated UC-03 case asking "then who owns this?" gets an
           answer instead of "nobody approves anything here", which was true of
           this SCREEN and not true of the decision.

           test/zafApprovalRole.test.js asserts this `roleId` against that
           module in both directions, so the sidebar can neither invent a grant
           nor go quiet about one the roster can issue. On a case the server has
           not made actionable, main.js renders the slot as NOT OPEN HERE —
           naming the owner is a different claim from offering the form. */
        return {
          summary:
            "UC-03 decides where a request goes, and almost every outcome needs nobody. The one thing it cannot " +
            "finish alone is a formal travel letter, and Travel & Mobility Support signs that off here. A " +
            "request routed on to UC-04 is approved there, not on this screen.",
          roles: [
            {
              roleId: "uc03:travel_support_specialist",
              label: "Travel & Mobility Support",
              decides: "whether a drafted travel letter may be issued on the entity's letterhead",
              filledBy: null,
              filledOn: null,
              filledAs: null,
            },
          ],
        };
      },
    },

    /**
     * UC-04 — Work Authorization / Workation. Single-specialist approval
     * (not dual, per UC-04.md's own naming of one Mobility specialist) —
     * approve/decline recorded via src/uc04/server.js, POST body
     * {approver, note}. The negative verb is `decline` because Remote's own
     * work-authorization status enum reads `declined_by_manager`; the server
     * still accepts the legacy `deny` an un-refreshed bundle posts.
     */
    "UC-04": {
      title: "Work authorization / workation",
      rows: function (view) {
        var a = view.case || {};
        return [
          { label: "Employee", value: show(a.employmentId) },
          { label: "Requester", value: show(a.requester) },
          { label: "Trip days", value: show(a.tripDays) },
          // `cumulativeDays` IS AN OBJECT — {days, periodsCounted} — and this
          // row printed it through show(), so every UC-04 case in the sidebar
          // read "Cumulative days [object Object]". Two things now come out of
          // it, and the second one is the one that matters: 0 days across 0
          // prior trips is a FLOOR, not a count. Nobody read Remote for prior
          // travel; the request simply carried none, which is why UC-04.md §9
          // makes an empty history a reason to escalate rather than a clean
          // record. The basis card below states this at length; the row must at
          // least not contradict it by printing a bare "0".
          {
            label: "Cumulative days",
            value: !a.cumulativeDays
              ? "—"
              : a.cumulativeDays.periodsCounted
                ? show(a.cumulativeDays.days) + " day(s) across " + a.cumulativeDays.periodsCounted + " prior trip(s)"
                : "no prior trips were supplied with this request",
          },
          // DECISION, FLAGS AND RISK LEVEL ARE NOT ROWS ANY MORE (2026-08-19).
          // Each is rendered once, elsewhere, by something that says more about
          // it than a row can: the decision by the header's outcome badge, the
          // flag codes by the collapsed provenance block that also holds the
          // audit slug they belong with, and the risk classification by
          // `basis.riskLevel`, which carries the server's own sentence saying it
          // is a routing rollup and must not be read as the assessment. Keeping
          // a bare copy of each here put `a1_certificate_recommended` on the
          // page three times and the word "risk" on it four, which is what the
          // project owner read as the panel contradicting itself.
          { label: "Opened", value: date(a.createdAt) },
        ];
      },
      approveHint: function () {
        return "A single Mobility specialist approves or declines this request — no dual control, unlike UC-06.";
      },

      /* WHAT CAPACITY THE PERSON READING THIS IS BEING ASKED TO ACT IN.
         See the block comment above window.CXPanels for the whole reasoning and
         the shape. DATA ONLY — main.js draws it, and nothing here decides
         whether a control exists. */
      approvalRoles: function (view) {
        var a = view.case || {};
        return {
          // "One named mobility specialist decides this" is the heading plus
          // the row directly beneath it. The absence is the part no row states.
          summary: "There is no second signature on this one.",
          roles: [
            {
              roleId: "uc04:mobility_specialist",
              label: "Mobility specialist",
              decides: "whether this trip may go ahead as planned",
              filledBy: a.approver || a.declinedBy || null,
              filledOn: a.approvedAt || a.declinedAt ? date(a.approvedAt || a.declinedAt) : null,
              filledAs: a.approver ? "Approved" : a.declinedBy ? "Declined" : null,
            },
          ],
        };
      },
      renderActions: function (view, ctx) {
        return renderSingleApproverActions(view, ctx, {
          role: "mobility_specialist",
          approveAction: "approve",
          approveLabel: "Approve",
          declineLabel: "Decline",
          groupLabel: "Mobility specialist decision",
          codeMessages: {
            executed: "Approved — work authorization issued.",
            approved: "Approved — work authorization issued.",
            declined: "Declined and recorded. No work authorization was issued.",
          },
        });
      },
    },

    /**
     * UC-05 — Resignation Notice Calculation. Single HR Ops sign-off (not an
     * approval of a write — no Remote write endpoint exists for this use
     * case; signing off confirms the statutory report is correct). Actions
     * are named "signoff"/"decline", not "approve"/"decline" —
     * src/uc05/server.js's own routes. The POSITIVE verb stays `signoff`
     * deliberately (it signs off a report, not a payment); only the negative
     * one moved to Remote's `decline`, 2026-08-19.
     */
    "UC-05": {
      title: "Resignation notice calculation",
      rows: function (view) {
        var r = view.case || {};
        var notice = r.notice || {};
        var payout = r.payout || {};
        return [
          { label: "Employee", value: show(r.employmentId) },
          { label: "Requester", value: show(r.requester) },
          { label: "Statutory notice end", value: show(notice.noticeEndDate) },
          { label: "Discrepancy", value: show(notice.discrepancy) },
          // `payout.amount` NEVER EXISTED. reconcilePtoPayout() returns
          // `totalInRemoteInteger` (src/uc05/ptoPayout.js), so this row printed
          // "—" on every case that had a payout — a computed figure rendered as
          // an absence, on the screen where HR Ops signs the figure off. The
          // same ×100 helper as UC-09's amount: the total is already in Remote's
          // integer form and is only ever formatted here, never recomputed.
          { label: "PTO payout", value: money(payout.totalInRemoteInteger, payout.currency) },
          // Decision / Reason removed 2026-08-20 — see the UC-02 note.
          { label: "Opened", value: date(r.createdAt) },
        ];
      },
      approveHint: function () {
        return "HR Ops confirms the calculated notice period and payout are correct — there is no Remote write behind this, the signed-off report is the artifact.";
      },

      /* WHAT CAPACITY THE PERSON READING THIS IS BEING ASKED TO ACT IN.
         See the block comment above window.CXPanels for the whole reasoning and
         the shape. DATA ONLY — main.js draws it, and nothing here decides
         whether a control exists. */
      approvalRoles: function (view) {
        var r = view.case || {};
        return {
          /* THE ROW NAMES THE OWNER; THIS SAYS WHAT THE SIGNATURE DOES NOT DO.
             "One named HR Ops person owns this decision" was the heading and
             the row under it said again, and it was also the sentence that had
             to be carefully worded ("owns", not "signs off") so it stayed true
             on an escalated case where nobody can sign here. Removing it
             removes the problem rather than wording around it. What is left is
             a statement about our own behaviour: nothing reaches Remote either
             way, which is on no other line of this page. */
          summary: "Nothing is written to Remote either way — the signed-off report is the artifact.",
          roles: [
            {
              roleId: "uc05:hr_ops",
              label: "HR Ops",
              // NOT "the calculated notice period". A UC-05 case escalated at
              // gate 4 has no calculation at all — no notice end date was
              // produced and no payout was reconciled — and this line was
              // rendering directly above the server's own sentence saying so.
              // The role is the same whether or not a figure was produced; the
              // wording now is too.
              decides: "whether the notice period and payout this report states are correct",
              filledBy: r.signedOffBy || r.declinedBy || null,
              filledOn: r.signedOffAt ? date(r.signedOffAt) : null,
              filledAs: r.signedOffBy ? "Signed off" : r.declinedBy ? "Declined" : null,
            },
          ],
        };
      },
      renderActions: function (view, ctx) {
        return renderSingleApproverActions(view, ctx, {
          role: "hr_ops",
          approveAction: "signoff",
          approveLabel: "Sign off",
          declineLabel: "Decline",
          groupLabel: "HR Ops sign-off",
          codeMessages: {
            signed_off: "Signed off — report is final.",
            declined: "Declined and recorded. The report was not signed off.",
          },
        });
      },
    },

    /**
     * UC-07 — Global Mobility / Permanent Relocation. The second 🔴
     * no-execution-path use case, same shape as UC-08: no `renderActions`,
     * `view.actionable` is always false (src/uc07/server.js).
     *
     * WHY THIS PANEL IS LONG, AND WHY THAT IS THE POINT. A 🔴 escalation buys
     * exactly one thing: the specialist opens the ticket already holding the
     * analysis instead of reassembling it from four systems. This panel used to
     * render eight rows — employee, type, two countries, the verdict, citation
     * titles, the narrative, the date — and drop everything the dossier is
     * actually FOR: which gates flagged and how severely, the sequencing dates
     * that decide whether the employee has an employment gap, the transition-
     * safety verdict (the use case's headline rule), the PTO and seniority
     * outcomes, and every line of the cost estimate including the components
     * Remote has not yet quoted. A dossier that is compiled and then not shown
     * has cost the compile and bought nothing, and the specialist goes looking
     * elsewhere anyway — which is the same outcome as never having compiled it.
     *
     * Everything below is READ from the dossier the API returned. Nothing is
     * recomputed, re-scored or re-decided here — the money is already ×100
     * integers from src/shared/money.js and is only formatted; the flags,
     * severities and verdict are the server's. main.js still owns the only
     * question that gates controls at all (`view.actionable`), and this panel
     * supplies no `renderActions`, so UC-07 can never grow a button here.
     */
    "UC-07": {
      title: "Global mobility / permanent relocation",
      /* THIS PANEL'S RECORD IS ITS ANALYSIS — read by main.js's
         hasDecisionAccount(). A 🔴 use case has no execution path, so the rows
         below are not a reference copy of something the page states elsewhere:
         they are the entire thing the escalation produced. Everywhere else the
         rows collapse into "The case record" once a findings section leads the
         page, and once these views began publishing a `basis` (their citation
         map, commit 553c4a9) that rule swept the verdict, every flag with its
         message, the cost estimate and the narrative one click down, under the
         reference material they were written from. A citation map is not an
         account; it is what an account was written from. DATA, NOT A DECISION:
         main.js reads this and still owns what renders. */
      recordIsTheAnalysis: true,
      /* AND IT STATES ITS OWN FLAGS, which is a second, narrower claim read by
         main.js's renderWhy. The rows below render one line per flag carrying
         the severity, the code AND the message; the shell's own flag list
         carries the severity and the code and nothing else. Both were printing,
         so nine codes appeared twice on one page and the first copy — the one
         directly under the research disclaimer — was the useless one. UC-08
         declares nothing here on purpose: its rows carry no flag line at all,
         so the shell's list is its only statement, negative case included. */
      statesItsOwnFlags: true,
      rows: function (view) {
        var d = view.case || {};
        var dossier = d.dossier || {};
        var dates = dossier.dateChecks || {};
        var mot = dates.mot || {};
        var coverage = dates.coverage || {};
        var alignment = dates.alignment || {};
        var transition = dossier.transitionSafety || {};
        var pto = dossier.pto || {};
        var seniority = dossier.seniority || {};
        var cost = dossier.costEstimate || {};
        var flags = dossier.flags || [];
        var citations = dossier.citations || [];
        var rows = [];

        // -- the request ----------------------------------------------------
        push(rows, "Employee", show(d.employmentId));
        push(rows, "Relocation type", words(d.relocationType));
        // Read at a glance, so names alone — "Spain → Netherlands". The codes
        // are still what the dossier stores and what every citation below is
        // keyed by; this row is the one a specialist orients by.
        push(rows, "Route", country(d.sourceCountry) + " → " + country(d.destinationCountry));
        push(rows, "Request understood by", dossier.parseSource ? (PARSE_SOURCE_WORDS[dossier.parseSource] || words(dossier.parseSource)) : "—");

        // -- the verdict ----------------------------------------------------
        push(rows, "Feasibility verdict", dossier.verdict ? (VERDICT_WORDS[dossier.verdict] || words(dossier.verdict)) : "—");
        push(rows, "Feasible as proposed", yesNo(dossier.feasible));
        push(rows, "Uncertainty", percent(dossier.uncertainty));

        // -- every flag, with its severity and its full message. A flag code
        //    alone tells the specialist a gate fired; the message tells them
        //    what to do about it.
        if (flags.length) {
          flags.forEach(function (f) {
            /* THE MESSAGE, NOT THE CODE. Every flag raised by
               transitionGate.js already carries a written message; the code in
               front of it was the gate's identifier for its own use, and it was
               the first thing on the line. The code survives as the fallback,
               opened out, for a flag that carries no message. */
            push(rows, "Flag · " + show(f.severity, "?"), show(f.message, words(f.code)));
          });
        } else {
          push(rows, "Flags", "None — every deterministic gate passed");
        }
        if ((dossier.requiredActions || []).length) {
          push(
            rows,
            "Required actions",
            dossier.requiredActions.map(function (a) { return words(a); }).join(", ")
          );
        }

        // -- sequencing: the half of the dossier that decides whether a real
        //    person ends up without valid employment status for a fortnight.
        push(
          rows,
          "Transition safety",
          transition.sourceOffboardingAuthorized === true
            ? "Source offboarding authorized — destination confirmed ready"
            : transition.sourceOffboardingAuthorized === false
            ? "NOT authorized — awaiting: " +
              ((transition.missing || []).map(function (m) { return words(m); }).join("; ") || "confirmation")
            : "—"
        );
        push(
          rows,
          "Employment coverage",
          coverage.status
            ? words(coverage.status) +
              (coverage.gapDays ? " — " + coverage.gapDays + " day(s) uncovered" : "") +
              (coverage.overlapDays ? " — " + coverage.overlapDays + " day(s) overlapping" : "")
            : "—"
        );
        push(
          rows,
          "Month-end alignment",
          alignment.aligned === true
            ? "Aligned — no duplicate management fee"
            : alignment.aligned === false
            ? "Not aligned — duplicate management fee possible"
            : "—"
        );
        push(
          rows,
          "Minimum onboarding time",
          mot.code === "NOT_EVALUATED" || !mot.code
            ? "Not evaluated — dates or country lead time missing"
            : words(mot.code) +
              " (needs " + show(mot.requiredLeadTime) + " business days, plan allows " + show(mot.requestedLeadTime) + ")"
        );
        if (mot.earliestAllowedDate) {
          push(rows, "Earliest allowed start", show(mot.earliestAllowedDate));
        }

        // -- entitlements carried across the transfer ------------------------
        push(
          rows,
          "PTO",
          pto.decision
            ? words(pto.decision) +
              " — opening balance " + show(pto.destinationOpeningBalance, "0") +
              " day(s), " + show(pto.liquidatedDays, "0") + " liquidated"
            : "—"
        );
        push(rows, "Seniority", seniority.status ? words(seniority.status) + (seniority.seniorityDate ? " from " + seniority.seniorityDate : "") : "—");

        // -- the money. Every component is listed WITH its status, so a
        //    QUOTE_REQUIRED line is visible as a pending quote rather than
        //    absent — an omitted fee reads as a fee of zero.
        push(rows, "Cost estimate", words(cost.status));
        if (cost.status === "CALCULATED") {
          push(rows, "Annual gross salary", money(cost.annualGrossSalaryRemoteInteger, cost.currency));
          push(rows, "Monthly gross salary", money(cost.monthlyGrossSalaryRemoteInteger, cost.currency));
          push(rows, "EOR management fee", money(cost.monthlyFeeRemoteInteger, cost.currency) + " / month");
          push(rows, "Management fees over term", money(cost.lifetimeMonthlyFeesRemoteInteger, cost.currency) + " over " + show(cost.months) + " month(s)");
        } else if (cost.reason) {
          push(rows, "Estimate incomplete because", show(cost.reason));
        }
        (cost.components || []).forEach(function (c) {
          push(
            rows,
            "Cost · " + show(c.label),
            c.status === "CALCULATED"
              ? money(c.remoteInteger, c.currency)
              : c.status === "QUOTE_REQUIRED"
              ? "Quote required — not priced by this system"
              : c.status === "INPUT_REQUIRED"
              ? "Input required — salary not yet provided"
              : words(c.status)
          );
        });
        if (cost.knownTotalDisplay) {
          push(rows, "Known total (excludes pending quotes)", show(cost.knownTotalDisplay));
        }
        if ((cost.pendingQuotes || []).length) {
          /* BY THE LABEL THE ESTIMATE ALREADY GIVES THEM. `pendingQuotes` holds
             component KEYS ("monthlyManagementFee"); `components[]` in the same
             object carries a written label for every one of them, so this is a
             lookup rather than a second naming of the same fees. */
          var componentLabels = {};
          (cost.components || []).forEach(function (c) { if (c && c.key) componentLabels[c.key] = c.label; });
          push(
            rows,
            "Still to be quoted",
            cost.pendingQuotes
              .map(function (key) { return componentLabels[key] || words(key); })
              .join(", ")
          );
        }

        // -- the research the dossier cites, each with what matched it -------
        if (citations.length) {
          citations.forEach(function (c) {
            push(rows, "Guidance · " + show(c.title), show(c.summary) + " (matched on: " + (c.matchedOn || []).join(", ") + ")");
          });
        } else {
          push(rows, "Guidance", "None matched in the local reference corpus");
        }

        // -- the drafted prose, and how much to trust it --------------------
        push(rows, "Narrative", show(dossier.narrative));
        push(
          rows,
          "Narrative faithfulness check",
          dossier.faithfulness && dossier.faithfulness.verdict
            ? dossier.faithfulness.verdict === "not_evaluated"
              ? "Not evaluated (informational only — never gates anything)"
              : words(dossier.faithfulness.verdict) + (dossier.faithfulness.reason ? " — " + dossier.faithfulness.reason : "")
            : "—"
        );
        /* THE FRAMING STATEMENT IS NO LONGER A ROW HERE, and it has not been
           dropped — it moved up. `dossier.framing` is UC-07's mandatory
           disclaimer ("not a relocation decision or a legal, immigration, or
           tax determination"), and as row 34 of this record, labelled
           "Standing", it sat UNDER the drafted narrative it exists to qualify.
           The shell now renders it directly beneath the header, above every
           finding, on any panel whose view carries one (renderFraming,
           main.js). Printing it here as well would put the same sentence on
           the screen twice, which is the repetition this page was taken apart
           for — and the copy a reader would skim is the one that matters most.
           Removing the row is what makes the promotion honest rather than
           additive. */
        push(rows, "Opened", date(d.createdAt));
        return rows;
      },
      approveHint: function () {
        return "UC-07 has no execution path — there is nothing to approve. This dossier is research support for a Mobility Legal Tier-3 specialist's own review.";
      },

      /* WHAT CAPACITY THE PERSON READING THIS IS BEING ASKED TO ACT IN.
         See the block comment above window.CXPanels for the whole reasoning and
         the shape. DATA ONLY — main.js draws it, and nothing here decides
         whether a control exists. */
      approvalRoles: function () {
        return {
          // Same trim as UC-08's, for the same reason: the tail was the tier
          // rail's sentence and the framing statement's, both of which are
          // already on this page and one of which must never be moved.
          summary: "Nobody approves anything here, and no role would change that.",
          roles: [],
        };
      },
    },

    /**
     * UC-09 — Off-Cycle Payroll / Adjustment. The one 🔴-framed use case with
     * a real execution path, gated behind a floor-of-2 (up to 3 for
     * high-risk) multi-role approval: requester, approver, and — only when
     * approvalSlotsRequired is 3 — payment_releaser. Segregation of duties
     * is enforced server-side (src/uc09/multiApprovalPolicy.js); this panel
     * only presents the controls, never re-derives who may fill which role.
     */
    "UC-09": {
      title: "Off-cycle payroll adjustment",
      rows: function (view) {
        var a = view.case || {};
        var adj = a.adjustment || {};
        var employee = view.employee || {};
        return [
          /* THE PERSON, WHERE THE SERVER RESOLVED ONE. This row printed 36
             hexadecimal characters under the word "Employee" on the one screen
             in this system where money leaves an account. `view.employee` is
             already in this payload — src/uc09/server.js re-reads the record
             when the panel opens (src/shared/employeeSubject.js) — so the name
             costs no new dependency and no new call. Nothing here looks anybody
             up: a lookup in the browser would be a second Remote client holding
             no credentials, and the fallback when the read did not answer is the
             id, never a blank — an empty row reads as "there is nobody".

             AND THE ID KEEPS ITS OWN ROW, on purpose. main.js's renderSubject()
             deliberately does NOT print the id beside the name in the header and
             says why it can afford not to: "the id is still on the page — 'The
             case record' carries it verbatim, which is where somebody quoting it
             into Remote goes." These rows ARE that record. Replacing the id with
             the name would have taken it off the page altogether and quietly
             broken the reasoning of a file this one does not own. */
          { label: "Employee", value: show(employee.displayName || a.employmentId) },
          { label: "Employment ID", value: show(a.employmentId) },
          { label: "Requester", value: show(a.requester) },
          /* The kind of payment as the basis panel below says it, not as the
             store keeps it — the card read "retroactive_pay" inches above a
             panel reading "retroactive pay". src/uc09/decisionFacts.js opens
             the same value out the same way. */
          { label: "Type", value: words(adj.type) },
          // THE ×100 SCALE, APPLIED. This printed `show(adj.amount)` — the raw
          // Remote integer — so a $5,000.00 adjustment read "500000 USD" on the
          // summary card of the screen where a human approves a REAL payment
          // (UC-09 executes remote.createIncentive()). The basis panel a few
          // blocks below printed the same figure correctly formatted, so the
          // card and the account disagreed by 100×, in the direction that
          // approves far too much. money() is the one place this file scales,
          // and it renders "—" rather than a 0 for anything that is not an
          // integer — a payment card must never print a figure it invented.
          { label: "Amount", value: money(adj.amount, adj.currency) },
          /* SLOTS REQUIRED, DECISION AND FLAGS REMOVED (2026-08-20). The number
             of slots is said three better ways within one screen — the tier
             rail's floor sentence, the capacity card's one row per required
             role, and the approval meter drawn as filled and empty slots — and
             `approvalSlotsRequired` is also the field name rather than the
             thing. Decision is the outcome badge; the flag codes are in the
             provenance block beside the audit slug they belong with. This is
             the payment screen, so a bare number that agrees with three other
             numbers is worse here than anywhere: a reader who spots the fourth
             copy has to work out whether it is a fourth fact. */
          { label: "Opened", value: date(a.createdAt) },
        ];
      },
      approveHint: function () {
        return "At least two independent people (requester + approver, plus a payment releaser for high-risk cases) must approve before this executes — no risk score ever waives the floor.";
      },

      /* WHAT CAPACITY THE PERSON READING THIS IS BEING ASKED TO ACT IN.
         See the block comment above window.CXPanels for the whole reasoning and
         the shape. DATA ONLY — main.js draws it, and nothing here decides
         whether a control exists. */
      approvalRoles: function (view) {
        var a = view.case || {};
        // The number of slots is the SERVER's (`approvalSlotsRequired`), exactly
        // as renderActions already reads it. This lists the slots that are
        // actually required for THIS adjustment, so a two-slot case does not
        // show a payment-releaser row that nobody is waiting on.
        var required = a.approvalSlotsRequired || 2;
        var roles = [
          {
            roleId: "uc09:requester",
            label: "Requester",
            decides: "that the adjustment is the one they asked for",
            filledBy: a.requesterApproval ? a.requesterApproval.approver : null,
            filledOn: a.requesterApproval ? date(a.requesterApproval.at) : null,
            filledAs: a.requesterApproval ? "Approved" : null,
          },
          {
            roleId: "uc09:approver",
            label: "Approver",
            decides: "whether the payment should be made at all",
            filledBy: a.approverApproval ? a.approverApproval.approver : null,
            filledOn: a.approverApproval ? date(a.approverApproval.at) : null,
            filledAs: a.approverApproval ? "Approved" : null,
          },
        ];
        if (required >= 3) {
          roles.push({
            roleId: "uc09:payment_releaser",
            label: "Payment Releaser",
            decides: "whether the money is actually released",
            filledBy: a.paymentReleaserApproval ? a.paymentReleaserApproval.approver : null,
            filledOn: a.paymentReleaserApproval ? date(a.paymentReleaserApproval.at) : null,
            filledAs: a.paymentReleaserApproval ? "Approved" : null,
          });
        }
        return {
          /* THE TWO-SLOT SENTENCE IS THE TIER RAIL'S ("No money moves in this
             use case until at least two named humans in separate roles
             approve") followed by the floor. Only the floor is new, so only the
             floor stays — reworded to carry its own antecedent, since "that
             floor" pointed at the sentence that went.

             THE THREE-SLOT SENTENCE STAYS WHOLE, and the asymmetry is the
             point: the rail says "at least two", and that this particular
             adjustment needs THREE is a fact about the case that no other
             sentence on the page states. */
          summary:
            required >= 3
              ? "Three different people must sign, in three different roles, before any money moves."
              : "No risk score can lower the floor of two.",
          roles: roles,
        };
      },
      renderActions: function (view, ctx) {
        var el = ctx.el;
        var a = view.case || {};
        var container = el("div", "uc06-dual-approval");
        /* NO HINT PARAGRAPH (2026-08-20) — same reasoning as UC-06's. The rail
           says no money moves until at least two named humans in separate roles
           approve, the card above carries the floor, the meter below counts the
           slots and each legend names its role. approveHint() is still this
           panel's answer for main.js's default rendering; this panel supplies
           its own controls, so it never reaches that path. */

        // Segregation of duties, made legible. UC-09's floor is 2 and rises to
        // 3 for high-risk adjustments — a difference an approver previously had
        // to infer from how many role blocks happened to render. Both numbers
        // are the API's own; this only draws them.
        var required = a.approvalSlotsRequired || 2;
        var filled =
          (a.requesterApproval ? 1 : 0) + (a.approverApproval ? 1 : 0) + (a.paymentReleaserApproval ? 1 : 0);
        container.appendChild(ctx.approvalMeter(filled, required));

        /* A fieldset with a legend, not a div with an h3.

           Both role blocks contain a control labelled "Your name or email", so
           a screen-reader user tabbing through heard the same name twice with
           nothing to say which role they were filling — on a dual-control gate
           whose entire purpose is that two DIFFERENT people sign. A <legend> is
           announced as the group context for every control inside its
           <fieldset>, which is exactly this, and it does it without giving each
           field a bespoke aria-label that would then disagree with its own
           visible text (WCAG 2.5.3). */
        function roleBlock(role, label, slot) {
          // The role in the class — see the same note in UC-06's roleBlock.
          var block = el("fieldset", "role-block role-slot-" + role);
          block.appendChild(el("legend", "h3", label));

          if (slot) {
            block.appendChild(el("p", "muted", "Approved by " + show(slot.approver) + (slot.note ? " — " + slot.note : "")));
            return block;
          }

          // Real <label for> on both fields, not a placeholder pretending to be
          // one — this is the box whose contents are written to audit_log as
          // the name of the human who authorised a payroll change.
          var approverField = ctx.labelledField("input", "approver-input", "Your name or email", {
            type: "text",
            placeholder: "e.g. you@remote.com",
            required: true,
          });
          block.appendChild(approverField.wrap);
          var approverInput = approverField.control;

          var noteField = ctx.labelledField("textarea", "note", "Note (optional)", {
            rows: 2,
            placeholder: "Recorded in the audit log",
          });
          block.appendChild(noteField.wrap);
          var note = noteField.control;

          // Short visible text, full accessible name. "Approve as Payroll
          // Specialist" wrapped to two cramped lines in a 320px sidebar, and
          // the role is already the block's own heading directly above — but a
          // screen reader tabbing between four identical "Approve" buttons
          // needs the role, so it goes in aria-label rather than in the label.
          var buttons = el("div", "buttons");
          var approve = el("button", "btn approve", "Approve");
          approve.type = "button";
          approve.setAttribute("aria-label", "Approve as " + label);
          var deny = el("button", "btn deny", "Deny");
          deny.type = "button";
          deny.setAttribute("aria-label", "Deny as " + label);
          buttons.appendChild(approve);
          buttons.appendChild(deny);
          block.appendChild(buttons);

          // The verdict of an approve/deny — the one message in this sidebar that
          // reports a write to audit_log. It replaces its own text in place with no
          // focus change, so without a live region a screen-reader user clicks
          // Approve and is told nothing at all about whether it worked.
          var status = el("p", "action-status");
          status.setAttribute("role", "status");
          block.appendChild(status);

          function submit(action) {
            if (!approverInput.value || !approverInput.value.trim()) {
              status.className = "action-status bad";
              status.textContent = "Enter your name or email first.";
              approverInput.focus();
              return;
            }
            approve.disabled = true;
            deny.disabled = true;
            status.className = "action-status";
            status.textContent = "Recording " + action + "…";

            view
              .post(action, { role: role, approver: approverInput.value.trim(), note: note.value })
              .then(function (result) {
                if (result.ok) {
                  status.className = "action-status ok";
                  status.textContent =
                    result.code === "executed"
                      ? "Required approvals recorded — adjustment executed."
                      : "Recorded. Waiting on the remaining role(s).";
                  setTimeout(ctx.reload, 900);
                } else {
                  status.className = "action-status bad";
                  status.textContent = result.reason || "Refused.";
                  approve.disabled = false;
                  deny.disabled = false;
                }
                ctx.resize();
              })
              .catch(function (err) {
                status.className = "action-status bad";
                status.textContent = "Could not reach the UC-09 API: " + err.message;
                approve.disabled = false;
                deny.disabled = false;
                ctx.resize();
              });
          }

          approve.addEventListener("click", function () {
            submit("approve");
          });
          deny.addEventListener("click", function () {
            submit("deny");
          });

          return block;
        }

        container.appendChild(roleBlock("requester", "Requester", a.requesterApproval));
        container.appendChild(roleBlock("approver", "Approver", a.approverApproval));
        if ((a.approvalSlotsRequired || 2) >= 3) {
          container.appendChild(roleBlock("payment_releaser", "Payment Releaser", a.paymentReleaserApproval));
        }
        return container;
      },
    },
  };

  /**
   * Shared single-decision-maker action block for use cases with exactly one
   * approver (UC-04, UC-05, UC-02) — the non-dual, non-multi-role case UC-06's
   * own renderActions doesn't cover. Kept here rather than duplicated in each
   * panel so the DOM shape and error handling stay in one place.
   *
   * TWO SHAPES, ONE FUNCTION. It was originally a fixed approve/decline pair, and
   * UC-02's Finance Ops decision has THREE verbs (approve / decline / hold —
   * see src/uc02/reviewPolicy.js). Rather than fork the DOM and the error
   * handling, `opts.actions` may name any list of buttons; omitting it keeps
   * the original pair EXACTLY as it was, which is what leaves UC-04 and UC-05
   * untouched and their existing assertions passing unmodified.
   *
   * `requiresNote` on an action is a courtesy, not a control: the server
   * refuses a UC-02 decline with no reason (400 `decline_reason_required`)
   * whatever this file does. Checking here means the agent is told before the
   * round trip; it is NOT the policy, and this file must never become a second
   * place that policy lives.
   *
   * @param {object} view
   * @param {{el:Function, resize:Function, reload:Function}} ctx
   * @param {{approveAction?:string, approveLabel?:string, declineLabel?:string,
   *          actions?:Array<{action:string,label:string,className?:string,requiresNote?:boolean}>,
   *          groupLabel?:string, noteLabel?:string,
   *          codeMessages:Object<string,string>}} opts
   */
  function renderSingleApproverActions(view, ctx, opts) {
    var el = ctx.el;
    var container = el("div", "uc06-dual-approval");

    // `opts.role` is NOMINAL for these three — one slot, one approver, and the
    // request body carries no role at all. It is named anyway so the block
    // carries the same handle the multi-role ones do; the shell renders no
    // picker for a single slot, because there is no choice to make.
    var block = el("fieldset", "role-block" + (opts.role ? " role-slot-" + opts.role : ""));
    block.appendChild(el("legend", "h3", opts.groupLabel || opts.approveLabel));

    var approverField = ctx.labelledField("input", "approver-input", "Your name or email", {
      type: "text",
      placeholder: "e.g. you@remote.com",
      required: true,
    });
    block.appendChild(approverField.wrap);
    var approverInput = approverField.control;

    var noteField = ctx.labelledField("textarea", "note", opts.noteLabel || "Note (optional)", {
      rows: 2,
      placeholder: "Recorded in the audit log",
    });
    block.appendChild(noteField.wrap);
    var note = noteField.control;

    // The original two-button pair, expressed in the general form. A panel
    // that supplies no `actions` gets the same markup as before; only the verb
    // and the label moved (`deny` -> `decline`, 2026-08-19), and the server
    // accepts both so the two halves can be deployed in either order.
    var actions = opts.actions || [
      { action: opts.approveAction, label: opts.approveLabel, className: "approve" },
      { action: "decline", label: opts.declineLabel, className: "decline" },
    ];

    // The verdict of an action — the one message in this sidebar that reports a
    // write to audit_log. It replaces its own text in place with no focus
    // change, so without a live region a screen-reader user clicks a button and
    // is told nothing at all about whether it worked.
    //
    // DECLARED BEFORE THE BUTTONS, because their click handlers write to it.
    // `var` hoisting would make the other order work too, and that is exactly
    // the kind of "works for a reason you have to know" this file should not
    // rely on.
    var status = el("p", "action-status");
    status.setAttribute("role", "status");

    var buttons = el("div", "buttons");
    var controls = [];
    actions.forEach(function (spec) {
      var button = el("button", spec.className ? "btn " + spec.className : "btn", spec.label);
      button.type = "button";
      button.addEventListener("click", function () {
        if (spec.requiresNote && !(note.value && note.value.trim())) {
          status.className = "action-status bad";
          status.textContent = "A " + spec.label.toLowerCase() + " needs a reason — Remote requires one.";
          note.focus();
          ctx.resize();
          return;
        }
        submit(spec.action);
      });
      buttons.appendChild(button);
      controls.push(button);
    });
    block.appendChild(buttons);
    block.appendChild(status);

    function setDisabled(value) {
      controls.forEach(function (button) {
        button.disabled = value;
      });
    }

    function submit(action) {
      if (!approverInput.value || !approverInput.value.trim()) {
        status.className = "action-status bad";
        status.textContent = "Enter your name or email first.";
        approverInput.focus();
        return;
      }
      setDisabled(true);
      status.className = "action-status";
      status.textContent = "Recording " + action + "…";

      view
        .post(action, { approver: approverInput.value.trim(), note: note.value })
        .then(function (result) {
          if (result.ok) {
            status.className = "action-status ok";
            status.textContent = (opts.codeMessages && opts.codeMessages[result.code]) || "Recorded.";
            setTimeout(ctx.reload, 900);
          } else {
            status.className = "action-status bad";
            status.textContent = result.reason || "Refused.";
            setDisabled(false);
          }
          ctx.resize();
        })
        .catch(function (err) {
          status.className = "action-status bad";
          status.textContent = "Could not reach the API: " + err.message;
          setDisabled(false);
          ctx.resize();
        });
    }

    container.appendChild(block);
    return container;
  }

  /**
   * Fallback for a use case with no panel registered yet. It says so plainly
   * rather than rendering an empty box: eight of the nine use cases are
   * specified but not built, and a sidebar that looked complete for them would
   * be the kind of overstatement that makes a reviewer discount everything else.
   */
  window.CXDefaultPanel = {
    title: "Case detail",
    rows: function (view) {
      var c = view.case || {};
      return [
        { label: "Use case", value: show(c.useCase) },
        { label: "Employee", value: show(c.employmentId) },
        { label: "Requester", value: show(c.requester) },
        { label: "Opened", value: date(c.createdAt) },
        { label: "Panel", value: "No panel registered for " + show(c.useCase) + " yet" },
      ];
    },
    approveHint: function () {
      return "No use-case-specific panel is registered, so only the shared fields are shown.";
    },
    /* Says nothing rather than guessing. A use case with no panel has no known
       role vocabulary either, and inventing one here would be worse than the
       silence — an agent would read a role that no roster contains. */
    approvalRoles: function () {
      return {
        summary:
          "No panel is registered for this use case, so this sidebar cannot say which role its decision " +
          "belongs to. Check the use case's own spec before acting on it.",
        roles: [],
      };
    },
  };

  /** Look up the panel for a case, falling back to the generic one. */
  window.CXPanelFor = function (useCase) {
    return (window.CXPanels && window.CXPanels[useCase]) || window.CXDefaultPanel;
  };
})();
