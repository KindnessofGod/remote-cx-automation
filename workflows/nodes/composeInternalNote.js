// ---------------------------------------------------------------------------
// composeInternalNote.js — body of the "Compose Internal Note" n8n Code node
// ---------------------------------------------------------------------------
// F-7 (rca-1rx, evaluator finding on live ticket #80): the `human_review`
// internal note on the DEPLOYED graph was three fields and a raw slug —
// `AI summary — decision: human_review (over_scope_request). Flags:
// over_scope_disclosure_requested. No letter was issued. Assigned to HR Ops
// (Zendesk group 6168404929823), tagged queue_hr_ops.` — no name, no status,
// no country, no figures, no verbs, and `over_scope_request` printed bare.
// Acceptance §13's Zendesk-internal-note row requires all of it: who this is
// about (name, status, country) · what happened in the deciding gate's own
// words · the figures compared · the owning team · where the decision is
// actioned and with what verbs.
//
// THE COPY IS NOT INVENTED HERE. `src/uc01/policyEngine.js`'s GATE_SEQUENCE
// (the `means` sentence per reason) and `describeDecisionFacts()` (the figures
// a gate compared) are ported VERBATIM below — same reasoning
// `workflows/nodes/gates.js` and `workflows/nodes/assignRouting.js` already
// give for porting rather than reimplementing: an n8n Code node has no module
// resolution, so the source of truth is copied and held against the original
// by test/n8nInternalNoteParity.test.js (a node:vm sandbox comparison, same
// discipline as test/n8nParity.test.js). The action-clarity sentence is
// copied verbatim from `zaf-app/assets/panels.js`'s UC-01 `approveHint()` —
// the sidebar's own words for what clicking Approve does — rather than a new
// sentence invented for this node.
//
// WHY THIS SITS BETWEEN "Assign Routing" AND "Route by Decision": every
// decision passes through Assign Routing regardless of branch, so a note
// composed here is available to `human_review` (which uses it) without a
// second node on that one branch only, and it costs nothing on the branches
// that ignore it (`internalNote` is just another field on an object nothing
// else reads).
//
// PURE, AND IT DECIDES NOTHING — same contract as `describeDecidingGate()`
// and `describeDecisionFacts()` in the file it is ported from. It reads a
// decision already made and it cannot change what was decided.
// ---------------------------------------------------------------------------

const ctx = $json && typeof $json === "object" ? $json : {};
const employment = ctx.employment && typeof ctx.employment === "object" ? ctx.employment : {};
const classification = ctx.classification && typeof ctx.classification === "object" ? ctx.classification : {};
const identity = ctx.identity ?? null;
const reason = typeof ctx.reason === "string" ? ctx.reason : null;
// The n8n port of src/uc01/disclosureFields.js's DISCLOSURE_REASONS — the
// reasons on which approving discloses beyond the standard letter. Held in step
// by test/uc01Disclosure.test.js, which reads this list out of this file rather
// than trusting it. A Code node cannot import, and this note goes to a durable
// ticket comment that must not promise "never salary" over an Approve that
// discloses one.
const DISCLOSURE_REASONS = ["over_scope_request"];
const flags = Array.isArray(ctx.flags) ? ctx.flags : [];
const CONFIDENCE_THRESHOLD = 0.85;

// --- src/shared/decisionFacts.js, ported verbatim ---------------------------
function fact(label, value, note) {
  if (value === null || value === undefined || value === "") {
    return unknownFact(
      label,
      note ?? "This figure was not available on this run, and is not defaulted to a value that would read as a measurement."
    );
  }
  return Object.assign({ label: label, value: String(value), known: true }, note ? { note: note } : {});
}
function unknownFact(label, note) {
  return { label: label, value: null, known: false, note: note ?? "Not available." };
}
function decisionFactsBundle(reasonSlug, sentence, entries) {
  return { reason: reasonSlug, sentence: sentence, facts: entries.filter(Boolean) };
}
function formatFactsForNote(bundle) {
  if (!bundle) return "";
  const rows = bundle.facts.map((f) =>
    f.known
      ? f.label + ": " + f.value + (f.note ? " (" + f.note + ")" : "")
      : f.label + ": NOT AVAILABLE" + (f.note ? " — " + f.note : "")
  );
  return " " + bundle.sentence + (rows.length ? " [" + rows.join(" | ") + "]" : "");
}

// --- src/uc01/policyEngine.js's GATE_SEQUENCE, ported verbatim -------------
const GATE_SEQUENCE = [
  {
    position: 1,
    reason: "engagement_not_eor_contractor",
    gate: "engagement_eligibility",
    means:
      "This person is engaged as an independent contractor, so Remote is not their legal employer and cannot attest that it employs them. That is not a formatting limit — a letter saying otherwise is a false statement about a legal relationship. A contract or invoice history is the document that answers what they actually need.",
  },
  {
    position: 1,
    reason: "engagement_not_eor_direct",
    gate: "engagement_eligibility",
    means:
      "This employment is administered by Remote but the client company is the legal employer — a direct, HRIS or Global Payroll arrangement. Their own employer issues this letter; Remote cannot issue it on their behalf.",
  },
  {
    position: 1,
    reason: "engagement_onboarding_incomplete",
    gate: "engagement_eligibility",
    means:
      "Onboarding is not finished, so the employment relationship this letter would attest to does not exist yet. The facts a verification letter states are not established until it does.",
  },
  {
    position: 1,
    reason: "engagement_offboarding",
    gate: "engagement_eligibility",
    means:
      "This employment is winding down — notice is being served or an offboarding is in progress. Lifecycle Support owns it, never an automation: there may be an active severance or a dispute, and a letter issued today would be stale on arrival.",
  },
  {
    position: 1,
    reason: "eor_status_unknown",
    gate: "engagement_eligibility",
    means:
      "The record does not say what kind of engagement this is, or says something this system does not recognise. It refuses rather than assuming: an engagement we cannot read is not one we may attest to. This is a RECORD problem before it is a request problem, and it is fixed by looking at the employment rather than by re-asking the requester.",
  },
  {
    position: 2,
    reason: "identity_not_verified",
    gate: "identity",
    means:
      "We could not confirm who is asking, so nothing about this employment was disclosed and no letter was produced. This is a failure to VERIFY — it is not a finding that the requester is an impostor.",
  },
  {
    position: 2,
    reason: "awaiting_employee_consent",
    gate: "identity",
    means:
      "An outside party asked about this employment and the employee has not (yet) answered whether they may be told anything. Nothing was disclosed and nothing was decided — this is not a refusal. It stays open until the employee grants or declines; see the consent request's own age before assuming it needs a nudge.",
  },
  {
    position: 2,
    reason: "consent_refused",
    gate: "identity",
    means:
      "An outside party asked about this employment, and the employee declined to consent to the disclosure. Nothing was told to the third party beyond a generic refusal — not the reason, and not that a person even exists at this reference. Nothing further should be volunteered on this ticket.",
  },
  {
    position: 3,
    reason: "employee_not_active",
    gate: "employment_status",
    means:
      "The employment is not active, so a letter stating current employment as fact cannot be issued automatically. A letter about a past employment is a different document, and a person writes it.",
  },
  {
    position: 4,
    reason: "third_party_request",
    gate: "third_party_disclosure",
    means:
      "An outside party — typically a bank or a landlord — is asking for this employee's details. Consent is on record, which is why this reached a human rather than being refused outright, but a disclosure to somebody other than the employee is never zero-touch.",
  },
  {
    position: 5,
    reason: "out_of_scope",
    gate: "in_scope",
    means:
      "This ticket is not an employment-verification request, so UC-01 declined it and recorded nothing. No case was created and no queue holds it — the requester was told plainly that this channel handles verification letters.",
  },
  {
    position: 6,
    reason: "artifact_present",
    gate: "no_artifacts",
    means:
      "The request carries something a person has to read — an attached form to complete, or a link to an external portal to submit through. The standard letter is not what is being asked for, whatever the wording says.",
  },
  {
    position: 7,
    reason: "non_standard_request",
    gate: "standard_letter",
    means:
      "The request was understood, and it is not for the standard letter. Something about it needs wording, a format or a statement the standard template does not produce.",
  },
  {
    position: 8,
    reason: "over_scope_undetermined",
    gate: "over_scope_disclosure",
    means:
      "The classifier did not answer which fields were being asked for, so whether anything outside the standard letter was requested is UNKNOWN — not answered 'no'. A person reads the request, because the field this gate protects is compensation.",
  },
  {
    position: 9,
    reason: "over_scope_request",
    gate: "over_scope_disclosure",
    means:
      "The requester asked for at least one detail the standard letter never states — compensation being the one this gate exists for. Nothing was quietly redacted and sent anyway: a person decides what may be disclosed and issues the letter themselves.",
  },
  {
    position: 10,
    reason: "confidence_unknown",
    gate: "classification_confidence",
    means:
      "The classifier returned no usable confidence figure, so there is no basis for trusting its reading of the request. Every gate above this one acted on that reading, so a person confirms it before a letter goes out.",
  },
  {
    position: 11,
    reason: "low_confidence",
    gate: "classification_confidence",
    means:
      "The classifier was not confident enough about what was being asked. A person confirms the request before a letter stating facts about a named employee goes to a bank or a landlord.",
  },
  {
    position: 12,
    reason: "incomplete_employment_record",
    gate: "record_complete",
    means:
      "The employment record is missing a fact the letter prints as a statement of truth. Rendering it anyway would put a blank row in a document going to a bank, a landlord or an immigration officer, and that cannot be withdrawn once sent — whereas a person can simply fill the gap.",
  },
  {
    position: 13,
    reason: "all_gates_passed",
    gate: "outcome",
    means:
      "Every check passed, so the standard letter was issued and the ticket resolved with no person involved. The letter states employment and never compensation — that is a property of the template, not of this decision.",
  },
  {
    position: 13,
    reason: "self_service_available",
    gate: "outcome",
    means:
      "Every check passed, and this requester is signed in to Remote — where this exact letter is available from the Requests tab in seconds. They were pointed at it rather than issued a second parallel copy of a document Remote already produces. Nothing was refused: had they reached us any other way, the letter would have been issued.",
  },
];

function describeDecidingGate(reasonSlug) {
  const row = GATE_SEQUENCE.find((r) => r.reason === reasonSlug);
  if (!row) return null;
  const total = new Set(GATE_SEQUENCE.map((r) => r.position)).size;
  return Object.assign({}, row, { total: total });
}

// --- src/uc01/policyEngine.js's IDENTITY_SENTENCE / artifactSentence /
//     boolWord / describeDecisionFacts, ported verbatim ---------------------
const IDENTITY_SENTENCE = {
  no_employment_record:
    "Remote returned no employment record for the id on this ticket, so there was nothing to verify the requester against. This is a record problem before it is an identity one.",
  session_employment_mismatch:
    "The requester is signed in, but as a DIFFERENT employee from the one this letter would be about. That is an access attempt on somebody else's record, not a verification gap.",
  third_party_missing_consent:
    "The request arrived with no authenticated session at all — a plain email or an anonymous form — so an outside party asked for this employee's details, no consent record was found, and nothing was disclosed. Step-up verification is needed before anything can be.",
  third_party_other_employee_missing_consent:
    "The requester is signed in, but as a DIFFERENT employee from the one this letter would be about, and no consent record was found. That is an access attempt on somebody else's record, not a verification gap — worth a look at who is signed in, not just at what was asked for.",
  unauthenticated_requires_stepup:
    "The request arrived with no authenticated session at all — a plain email or an anonymous form — so the requester's identity rests on a claim. Step-up verification is needed before anything is disclosed.",
};

function artifactSentence(c) {
  if (c.hasAttachment && c.hasExternalUrl)
    return "The ticket carries both an attached form and a link to an external portal, so the standard letter is not what is being asked for.";
  if (c.hasAttachment) return "The ticket carries an attached form to be completed, which the standard letter cannot satisfy.";
  if (c.hasExternalUrl) return "The ticket carries a link to an external portal the letter would have to be submitted through.";
  return "An artifact was flagged on this request, but which one was not recorded on the decision.";
}

function boolWord(v) {
  return v === true ? "yes" : v === false ? "no" : null;
}

const STANDARD_LETTER_FIELDS = ["full_name", "start_date", "contract_type", "probation", "status", "legal_entity"];
const REQUIRED_LETTER_FIELDS = ["full_name", "start_date", "contract_type"];

function describeDecisionFacts(args) {
  const reasonSlug = args.reason;
  const emp = args.employment;
  const c = args.classification ?? {};
  const ident = args.identity;
  const threshold = args.confidenceThreshold ?? CONFIDENCE_THRESHOLD;

  switch (reasonSlug) {
    case "identity_not_verified":
      return decisionFactsBundle(
        reasonSlug,
        IDENTITY_SENTENCE[ident?.reason] ??
          "The identity check did not pass, and the signal it failed on was not recorded on this decision.",
        [
          fact(
            "Identity signal used",
            ident?.method,
            "session = an authenticated login; consent = a recorded third-party consent; none = neither was present"
          ),
          fact("What was missing", ident?.reason),
          fact("Requester type as read", c.requesterType),
          emp && emp.id
            ? fact("Employment record read", "yes")
            : unknownFact(
                "Employment record read",
                "Remote returned no record for this employment id, so there was nothing to check an identity against. Confirm the id resolves before treating this as an identity problem."
              ),
        ]
      );

    case "employee_not_active":
      return decisionFactsBundle(
        reasonSlug,
        'The employment record\'s status is "' + (emp?.status ?? "not recorded") + '", and the standard letter is only issued for an active employment.',
        [
          fact("Status on the record", emp?.status),
          fact("Employment id", emp?.id),
          fact("Contract type", emp?.contract_type),
        ]
      );

    case "third_party_request":
      return decisionFactsBundle(
        reasonSlug,
        "An outside party asked for this employee's details with consent on record, so a person decides what may be disclosed and to whom.",
        [
          fact("Requester type as read", c.requesterType),
          fact(
            "Consent signal",
            ident?.reason,
            "third_party_with_consent means a granted, complete consent record was present — the identity gate above would have refused or held otherwise"
          ),
          fact(
            "Consent record",
            ident?.consentRecordId,
            "The consent_records row this disclosure is being decided against — open it to see who granted it, to whom and for what purpose."
          ),
          fact("Which reader produced the classification", c.source),
        ]
      );

    case "awaiting_employee_consent":
      return decisionFactsBundle(
        reasonSlug,
        ident?.reason === "awaiting_employee_consent_other_employee_signed_in"
          ? "The requester is signed in, but as a DIFFERENT employee from the one this request is about. That is an access attempt on somebody else's record, not an outside party's ask — the employee on record has not yet answered whether the signed-in requester may be told anything, and nothing has been disclosed or decided."
          : "An outside party asked about this employment and the employee has not yet answered whether they may be told anything. Nothing has been disclosed and nothing has been decided.",
        [
          fact("Requesting party", c.requestingParty, "Who is asking — from the third-party door, never from a claim in a ticket body."),
          fact("Purpose stated", c.purpose),
          fact("Consent record", ident?.consentRecordId, "The pending row waiting on the employee's answer, if one was created."),
          ident?.reason === "awaiting_employee_consent_other_employee_signed_in"
            ? fact(
                "Worth a second look",
                "yes",
                "The requester is signed in, but as a DIFFERENT employee from the one this request is about — that is an access attempt on somebody else's record, not an ordinary third-party ask, even though the outward regime (waiting on consent) is identical."
              )
            : null,
        ]
      );

    case "consent_refused":
      return decisionFactsBundle(
        reasonSlug,
        "An outside party asked about this employment, and the employee declined to consent to the disclosure.",
        [
          fact("Requesting party", c.requestingParty),
          fact("Purpose stated", c.purpose),
          fact("Consent record", ident?.consentRecordId, "The consent_records row carrying the employee's decision."),
          unknownFact(
            "What the third party was told",
            "Deliberately not the reason. Invariant 14 forbids telling a third party WHY a disclosure did not proceed — the same generic reply is sent whether the employee declined, has not yet answered, or nobody by this reference exists at all (VC-33)."
          ),
        ]
      );

    case "artifact_present":
      return decisionFactsBundle(reasonSlug, artifactSentence(c), [
        fact("Attachment on the ticket", boolWord(c.hasAttachment)),
        fact("External portal link in the text", boolWord(c.hasExternalUrl)),
        fact("Intent as read", c.intent),
        unknownFact(
          "The attachment or link itself",
          "Not carried on the decision. This system records THAT an artifact is present, never its contents — open the Zendesk ticket to read it."
        ),
      ]);

    case "non_standard_request":
      return decisionFactsBundle(
        reasonSlug,
        'The request was read as "' + (c.intent ?? "not recorded") + '", which is not the standard verification letter.',
        [
          fact("Intent as read", c.intent),
          fact(
            "Which reader produced it",
            c.source,
            "llm = the model answered; rule_based_fallback = the model was unreachable or returned an invalid shape and the deterministic rules answered instead"
          ),
          fact("Confidence in that reading", c.confidence),
        ]
      );

    case "over_scope_undetermined":
      return decisionFactsBundle(
        reasonSlug,
        "The classifier did not report which fields were requested, so whether anything over-scope was asked for is unknown rather than answered no.",
        [
          unknownFact(
            "Fields the requester asked for",
            "The classifier returned no usable list. This is NOT an empty list — an empty list would mean nothing extra was asked for, and this means the question went unanswered. Read the ticket."
          ),
          fact("Which reader produced the classification", c.source),
          fact("What the standard letter may state", STANDARD_LETTER_FIELDS.join(", ")),
        ]
      );

    case "over_scope_request": {
      const requested = Array.isArray(c.requestedFields) ? c.requestedFields.filter((f) => typeof f === "string") : [];
      const overScope = requested.filter((f) => !STANDARD_LETTER_FIELDS.includes(f));
      return decisionFactsBundle(
        reasonSlug,
        "The requester asked for " +
          overScope.length +
          " field" +
          (overScope.length === 1 ? "" : "s") +
          " the standard letter never states: " +
          overScope.join(", ") +
          ".",
        [
          fact("Asked for beyond the standard letter", overScope.join(", ")),
          fact("Everything the requester asked for", requested.join(", ")),
          fact("What the standard letter may state", STANDARD_LETTER_FIELDS.join(", ")),
          // Kept byte-identical to src/uc01/policyEngine.js's over_scope_request
          // case; see that file's comment for why.
          //
          // UPDATED 2026-08-28, and the old sentence had to go rather than
          // merely being improved: it ended "Approving here still only issues
          // the standard letter, with no salary figure", which stopped being
          // true the moment an approval began issuing Remote's customized
          // letter (owner decision; src/uc01/disclosureFields.js). A false
          // reassurance in a durable ticket comment is worse than no sentence.
          //
          // THIS NODE IS WHY THE VALUES ARE OPT-IN OVER THERE. Everything
          // built here lands in a Zendesk internal note — durable, and
          // readable by every agent on the account — so `describeDecisionFacts`
          // defaults `includeDisclosureValues` to false and only the reviewer's
          // own route asks for it. There is deliberately no way to switch it on
          // from here: an n8n Code node has no reviewer, no entitlement check
          // and no audience.
          unknownFact(
            "The values of those fields",
            "Not carried here. This bundle is also written into the ticket's internal note, which is durable and readable by every agent on the account, so a compensation figure must not travel in it. The value is shown on the reviewer's own screen, to the one person being asked to authorise its release, and nowhere else."
          ),
        ]
      );
    }

    case "confidence_unknown":
      return decisionFactsBundle(
        reasonSlug,
        "The classifier returned no usable confidence figure, so nothing could be compared against the " + threshold + " threshold.",
        [
          unknownFact(
            "Confidence reported",
            "Absent, or not a number. This is not a low score — a low score would be a figure below " + threshold + ", and this is no figure at all."
          ),
          fact("Threshold it would have been compared against", threshold),
          fact("Which reader produced the classification", c.source),
          fact("Intent it reported anyway", c.intent),
        ]
      );

    case "low_confidence":
      return decisionFactsBundle(
        reasonSlug,
        "The classifier reported " + c.confidence + " against a " + threshold + " threshold, so a person confirms the reading before a letter is issued.",
        [
          fact("Confidence reported", c.confidence),
          fact("Threshold", threshold),
          fact(
            "Which reader produced it",
            c.source,
            "llm = the model answered; rule_based_fallback = the rules answered because the model was unreachable or returned an invalid shape"
          ),
          fact("Intent as read", c.intent),
        ]
      );

    case "incomplete_employment_record": {
      const missing = REQUIRED_LETTER_FIELDS.filter((f) => emp?.[f] == null || String(emp[f]).trim() === "");
      const present = REQUIRED_LETTER_FIELDS.filter((f) => !missing.includes(f));
      return decisionFactsBundle(
        reasonSlug,
        "The employment record is missing " +
          missing.length +
          " field" +
          (missing.length === 1 ? "" : "s") +
          " the letter prints as fact: " +
          missing.join(", ") +
          ".",
        [
          fact("Missing from the record", missing.join(", ")),
          fact("Every field the letter must print", REQUIRED_LETTER_FIELDS.join(", ")),
          fact("Employment id to correct", emp?.id),
          present.length
            ? fact("Fields the record does carry", present.join(", "))
            : unknownFact(
                "Fields the record does carry",
                "None of the three. Confirm the id resolves to the employee you expect before editing anything — a record this empty is more often the wrong record than an incomplete one."
              ),
        ]
      );
    }

    default:
      return null;
  }
}

const decidedBy = reason ? describeDecidingGate(reason) : null;
const facts = reason
  ? describeDecisionFacts({ reason: reason, employment: employment, classification: classification, identity: identity, confidenceThreshold: CONFIDENCE_THRESHOLD })
  : null;

// --- WHO THIS IS ABOUT (name, status, country) — §13's first requirement ---
//
// E4-F14 (rca-0nm) — WITHHELD ON `identity_not_verified`, same scoping as
// `e188ce8`'s fix to GET /api/review/ticket/:id in src/review/server.js
// (`view.case?.reason !== "identity_not_verified"`). That fix stopped the ZAF
// sidebar and the signed API body from disclosing this employment's facts
// when the case's own verdict is that we could not establish who is asking —
// but this node was wired to the `escalate` branch two hours later
// (`85dfcb8`) and its subjectLine had no such guard, so the same facts kept
// reaching a human through the Zendesk internal note instead. The project
// already ruled on this (building `e188ce8`): withholding wins on
// `identity_not_verified`. Guarded HERE, inside the composer, rather than at
// the call site — `Flag for Specialist Review` shares this same composer, and
// a second copy of the guard at a second call site is exactly how these two
// surfaces diverged in the first place.
//
// Everything else about the note — the plain-words gate meaning, the flags,
// and the "Identity signal used / What was missing" facts — stays. Those are
// safe to show and are what makes the note actionable; only the subject's
// name/title/status/contract/country are withheld.
//
// R7-08 (rca-mygl) — `awaiting_employee_consent` joined the withhold list.
// The facts bundle below (case "awaiting_employee_consent") tells the reader
// "Nothing has been disclosed and nothing has been decided" while this line,
// unguarded, printed the subject's full_name/job_title/status/contract_type/
// country_code in the very same note — the contradiction #109 showed live.
// `identity_not_verified` and `awaiting_employee_consent` are different
// findings (one is a failed check, the other is an unanswered one) so they
// get different withheld-subject text, not a shared generic sentence.
const WITHHOLD_SUBJECT_REASONS = ["identity_not_verified", "awaiting_employee_consent"];
const WITHHOLD_SUBJECT_CLAUSE = {
  identity_not_verified: "identity could not be verified for this request",
  awaiting_employee_consent: "the employee has not yet answered whether they may be told anything",
};
const subjectLine = WITHHOLD_SUBJECT_REASONS.includes(reason)
  ? "Regarding this employment — subject details withheld: " +
    (WITHHOLD_SUBJECT_CLAUSE[reason] || "nothing about who this is regarding is disclosed here") +
    ", so nothing about who this is regarding is disclosed here."
  : "Regarding " +
    (employment.full_name || "an employee not named on this record") +
    (employment.job_title ? " (" + employment.job_title + ")" : "") +
    " — status: " +
    (employment.status || "not recorded") +
    ", contract: " +
    (employment.contract_type || "not recorded") +
    ", country: " +
    (employment.country_code || "not recorded") +
    ".";

// --- WHERE THE DECISION IS ACTIONED, WITH WHAT VERBS -----------------------
// E5-F19 (rca-3fm) — this composer feeds BOTH `Flag for Specialist Review`
// (decision `human_review`) and `Escalate Ticket` (decision `escalate`), but
// the sentence below was written for the first and applied to both, with no
// guard — the same shape as E4-F14's subjectLine bug 19 lines above, and
// fixed the same way: gate on the fact rather than deleting the sentence.
// `src/review/reviewPolicy.js`'s `evaluateCaseActionability()` is the single
// source of truth for which decision the sidebar renders approve/decline
// buttons for (gate 1, `ACTIONABLE_DECISION = "human_review"`) — `escalate`
// is refused there with `no_review_path` before a control could ever exist.
// So an escalate note told the specialist to open the sidebar and press
// Approve, and the sidebar for that same case renders zero buttons and zero
// textareas ("Escalated cases are worked by a specialist, not closed from
// the sidebar" — reviewPolicy.js's own refusal reason, quoted verbatim below
// for the escalate branch so the two surfaces say the same thing rather than
// two different ones). The `human_review` sentence is unchanged, and is
// copied verbatim from zaf-app/assets/panels.js's UC-01 approveHint() — the
// sidebar's own words for what clicking Approve does — plus one factual
// sentence about decline (§14: "one approve, one decline, a required
// reason"). Not new copy: the approve sentence already exists in this
// repository and is quoted, not paraphrased.
const ACTIONABLE_DECISIONS = ["human_review"];
const actionLine = ACTIONABLE_DECISIONS.includes(ctx.decision)
  ? "Open this ticket's ZAF sidebar to decide. Approving issues " +
    (DISCLOSURE_REASONS.includes(reason) ? "a CUSTOMIZED" : "the standard") +
    " verification letter and solves the ticket. " +
    (DISCLOSURE_REASONS.includes(reason)
      ? "That letter states the over-scope fields named above, read from the employee's Remote record — the values are shown on the sidebar, to the person being asked to authorise them, and deliberately not in this note. "
      : "The letter discloses only the standard fields — never salary. ") +
    "Declining records a required reason and leaves this ticket open."
  : "Escalated cases are worked by a specialist, not closed from the sidebar — the ZAF sidebar renders no approve/decline " +
    "control here. Work this ticket directly using the facts above, then update or resolve it by hand once it is resolved.";

const note =
  subjectLine +
  "\n\nAI summary — decision: " +
  (ctx.decision ?? "unknown") +
  " (" +
  (reason ?? "unknown") +
  "). Flags: " +
  (flags.length ? flags.join(", ") : "none") +
  "." +
  (decidedBy ? " Decided at gate " + decidedBy.position + " of " + decidedBy.total + " (" + decidedBy.gate + "): " + decidedBy.means : "") +
  formatFactsForNote(facts) +
  "\n\nRouting — " +
  (typeof ctx.routingNote === "string" && ctx.routingNote ? ctx.routingNote : "no routing information available") +
  "\n\n" +
  actionLine;

return [
  {
    json: Object.assign({}, ctx, { internalNote: note }),
    pairedItem: { item: 0 },
  },
];

