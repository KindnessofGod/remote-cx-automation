// ---------------------------------------------------------------------------
// facts.js  —  RULE 1: a fact is declared ONCE and asserted on EVERY surface
// ---------------------------------------------------------------------------
// "for (fact of facts) for (surface of ALL_SURFACES) for (scenario of
// scenarios) — E4-F14 exists because that loop was executed by a human and
// had one iteration."
//
// Each fact's `evaluate(surfaceId, text, scenario, subject)` is called for
// EVERY registered surface, not a hand-picked subset — a fact that only makes
// a claim about one or two surfaces still returns `"na"` for the rest, which
// is a COMPUTED verdict (this surface carried nothing this fact has an
// opinion about), never an omission. That is what runner.js's structural test
// pins: the loop calls every fact against every surface, and it is the fact
// itself — not the loop — that decides "na".
//
// `text === null` means "this surface produced nothing for this scenario"
// (e.g. no public reply on an escalate). What that MEANS is fact-specific:
// for a withholding fact, nothing shown is nothing disclosed (a pass); for a
// fact asserting a positive lead must render, nothing shown is exactly the
// C-16 failure shape (a fail). Getting this backwards is how a dead gate and
// a careful refusal become indistinguishable — so it is decided per fact,
// deliberately, never defaulted.
// ---------------------------------------------------------------------------

/**
 * @typedef {"pass"|"fail"|"na"} Verdict
 * @typedef {{verdict: Verdict, detail: string}} FactResult
 */

/**
 * E3-F12 / E4-F14 / F-12 — on `identity_not_verified`, the subject's real
 * employment facts (name, job title, status, contract type, country) must
 * not appear on ANY surface a support agent or an unauthenticated caller can
 * reach. The gate's own verdict is "we could not establish who the requester
 * is" — disclosing the subject's identity to answer that question would
 * defeat the gate.
 */
export const FACT_SUBJECT_WITHHELD_ON_IDENTITY_UNVERIFIED = {
  id: "subjectWithheldOnIdentityUnverified",
  description:
    "on identity_not_verified, no surface renders the subject's name, job title, or country — " +
    "the fact the gate itself refused to confirm",
  appliesToScenario: (scenario) => scenario.reason === "identity_not_verified",
  /**
   * @param {string} surfaceId
   * @param {string|null} text
   * @param {object} scenario
   * @param {{fullName: string, jobTitle: string, countryCode: string}|null} subject
   *   the REAL values for scenario.decision.employmentId, fetched live — never
   *   hardcoded, so this can never pass by the fixture happening to omit them.
   */
  evaluate(surfaceId, text, scenario, subject) {
    if (text === null) return { verdict: "pass", detail: "surface rendered nothing for this scenario — nothing to disclose" };
    if (!subject) {
      return {
        verdict: "na",
        detail: "could not resolve the subject's real values to check against (employment id unreadable)",
      };
    }
    const probes = [subject.fullName, subject.jobTitle].filter(Boolean);
    const leaked = probes.filter((p) => text.includes(p));
    if (leaked.length > 0) {
      return {
        verdict: "fail",
        detail: `disclosed ${JSON.stringify(leaked)} on a case whose own verdict is that the requester's identity was not established`,
      };
    }
    return { verdict: "pass", detail: "subject's name/job title do not appear" };
  },
};

/**
 * §16 items 1/2 and the positive-lead rule (C-16): a real `all_gates_passed`
 * decision MUST have produced a rendered HTML letter as the ticket's public
 * reply. `text === null` here is a FAILURE, not "nothing to check" — a
 * required success path with nothing rendered is exactly the shape where a
 * dead gate and a careful system look identical from outside.
 */
export const FACT_POSITIVE_LEAD_RENDERS_LETTER = {
  id: "positiveLeadRendersLetter",
  description: "a real all_gates_passed decision rendered its letter as HTML (not escaped source) on the public reply",
  // GAP 2 (rca-h7v): this is rule 3's whole purpose — the one fact that exists
  // to catch C-16's shape (a gate that can never succeed, indistinguishable
  // from one refusing correctly). It reaching zero scenarios must FAIL the
  // run, never sit as a silent "na" — see runner.js's analyzeFactCoverage().
  required: true,
  appliesToScenario: (scenario) => scenario.reason === "all_gates_passed",
  evaluate(surfaceId, text, scenario) {
    if (surfaceId !== "zendeskPublicReply") return { verdict: "na", detail: "this surface does not carry the letter" };
    if (text === null) {
      return {
        verdict: "fail",
        detail:
          "no public reply was found for an all_gates_passed decision — the auto-resolve path produced no " +
          "customer-visible letter, which is the same shape as a gate that can never succeed (C-16)",
      };
    }
    if (/&lt;(!doctype|html|div|p|table)/i.test(text) || /&amp;lt;/i.test(text)) {
      return {
        verdict: "fail",
        detail: "the letter appears as ESCAPED HTML SOURCE, not rendered markup — the publicReply-vs-html_body bug this project has shipped once already",
      };
    }
    // Zendesk re-wraps a posted html_body in its own `<div class="zd-comment">`
    // and strips the outer <!doctype>/<html>/<head>/<body> — verified live
    // against a real ticket 2026-08-22 (ticket 113's public reply is
    // `<div class="zd-comment">...<table>...`, no <html> tag anywhere, and
    // that is Zendesk's own normal behaviour, not a defect). So the signal
    // that this rendered as real markup (rather than escaped source) is
    // genuine tag structure — a <table> or <h1> — not the literal <html> tag.
    if (!/<(table|h1|strong)[ >]/i.test(text)) {
      return { verdict: "fail", detail: "the public reply does not contain the letter's expected structure (a table of fields, a heading) — it may not be a rendered letter at all" };
    }
    return { verdict: "pass", detail: "letter rendered as real HTML (verified against Zendesk's own re-wrapped markup, not a bare <html> check)" };
  },
};

/**
 * F-7 / F-11 regression guard: an escalate/human_review note must not be the
 * pre-fix bare-slug template — "AI summary — decision: X (Y). Flags: Z. ...
 * Assigned to HR Ops (Zendesk group NNNN)". A note that short and that shaped
 * carries no name, no status, no country, no plain-words gate meaning.
 */
export const FACT_INTERNAL_NOTE_NOT_BARE_SLUG = {
  id: "internalNoteNotBareSlug",
  description: "the internal note is not the pre-fix three-field-and-a-raw-slug template",
  appliesToScenario: (scenario) => scenario.decision.action === "escalate" || scenario.decision.action === "human_review",
  evaluate(surfaceId, text) {
    if (surfaceId !== "zendeskInternalNote") return { verdict: "na", detail: "not the note surface" };
    if (text === null) return { verdict: "fail", detail: "no internal note was found on an escalate/human_review ticket" };
    const bareSlugShape = /^AI summary\s*—?\s*(decision:|ESCALATED:)\s*[\w_]+\s*(\([\w_]+\))?\.\s*Flags:\s*[\w_, ]*\.?\s*(No letter was issued\.)?\s*Assigned to [\w &]+ \(Zendesk group \d+\)\.?\s*$/i;
    if (bareSlugShape.test(text.trim())) {
      return { verdict: "fail", detail: "note matches the pre-fix bare-slug template exactly, with no name/status/country/plain-words gate meaning" };
    }
    return { verdict: "pass", detail: "note carries more than the bare slug template" };
  },
};

/**
 * F-6: an auto-resolved ticket must carry BOTH `uc01_auto_resolved` and
 * `queue_hr_ops` (§13 / VC-01's exact tag set), not one alone.
 */
export const FACT_AUTO_RESOLVE_TAG_SET = {
  id: "autoResolveTagSet",
  description: "auto-resolved tickets carry both uc01_auto_resolved and queue_hr_ops",
  appliesToScenario: (scenario) => scenario.reason === "all_gates_passed",
  evaluate(surfaceId, text) {
    if (surfaceId !== "zendeskTicketMeta") return { verdict: "na", detail: "not the ticket-meta surface" };
    if (text === null) return { verdict: "fail", detail: "could not read the ticket's tags" };
    const meta = JSON.parse(text);
    const tags = new Set(meta.tags ?? []);
    const missing = ["uc01_auto_resolved", "queue_hr_ops"].filter((t) => !tags.has(t));
    if (missing.length > 0) {
      return { verdict: "fail", detail: `missing tag(s) ${JSON.stringify(missing)} — carries [${[...tags].join(", ")}]` };
    }
    return { verdict: "pass", detail: "both required tags present" };
  },
};

/** F-13: the blocked branch must still assign a group — must not fall through to default Support. */
export const FACT_BLOCKED_HAS_GROUP = {
  id: "blockedBranchHasGroup",
  description: "a blocked-branch ticket is assigned to a real group, not left in default Support",
  appliesToScenario: (scenario) => scenario.decision.action === "blocked",
  evaluate(surfaceId, text) {
    if (surfaceId !== "zendeskTicketMeta") return { verdict: "na", detail: "not the ticket-meta surface" };
    if (text === null) return { verdict: "fail", detail: "could not read the ticket's group" };
    const meta = JSON.parse(text);
    if (!meta.groupId) {
      return { verdict: "fail", detail: "no group_id on this ticket — it will sit in whatever the account's default group is" };
    }
    return { verdict: "pass", detail: `assigned to group ${meta.groupId}` };
  },
};

/**
 * E5-F19 (rca-3fm) — the THIRD instance of one pattern (F-1 round 2, F-12->F-14
 * round 4, this one round 5): a fix on one surface contradicting another.
 * `src/review/reviewPolicy.js`'s `evaluateCaseActionability()` refuses
 * `escalate` with `no_review_path` — the sidebar renders ZERO approve/decline
 * controls for it — but the internal note used to tell the specialist to
 * "Open this ticket's ZAF sidebar to decide. Approving issues..." regardless
 * of decision. Fixed in `37562f5`, guarded here on BOTH surfaces at once so a
 * future edit to either cannot silently reopen the gap between them — which is
 * exactly how this defect was created the first time (one surface fixed, its
 * sibling not).
 */
export const FACT_ESCALATE_NEVER_INSTRUCTS_APPROVE = {
  id: "escalateNeverInstructsApprove",
  description:
    "on escalate (no review path — the sidebar offers no approve/decline control), " +
    "neither the internal note nor the sidebar's own body claims otherwise",
  appliesToScenario: (scenario) => scenario.decision.action === "escalate",
  evaluate(surfaceId, text) {
    if (surfaceId === "zendeskInternalNote") {
      if (text === null) return { verdict: "fail", detail: "no internal note was found on an escalate ticket" };
      if (/approving issues|click approve|open this ticket'?s zaf sidebar to decide/i.test(text)) {
        return {
          verdict: "fail",
          detail: "the note instructs the specialist to approve/decline in the sidebar — the sidebar has no such control on escalate (E5-F19)",
        };
      }
      return { verdict: "pass", detail: "note does not instruct a nonexistent approve" };
    }
    if (surfaceId === "zafSidebarBody") {
      if (text === null) return { verdict: "fail", detail: "no sidebar body was captured for an escalate ticket — cannot confirm it agrees with the note" };
      if (/"actionable"\s*:\s*true/i.test(text)) {
        return { verdict: "fail", detail: "the signed sidebar body claims actionable:true on an escalate decision, which reviewPolicy.js refuses with no_review_path" };
      }
      if (!/"actionable"\s*:\s*false/i.test(text)) {
        return { verdict: "fail", detail: "the signed sidebar body carries no actionable:false field to confirm the sidebar agrees no control is offered" };
      }
      return { verdict: "pass", detail: "sidebar body agrees: actionable:false" };
    }
    return { verdict: "na", detail: "not a surface this fact has an opinion about" };
  },
};

export const ALL_FACTS = Object.freeze([
  FACT_SUBJECT_WITHHELD_ON_IDENTITY_UNVERIFIED,
  FACT_POSITIVE_LEAD_RENDERS_LETTER,
  FACT_INTERNAL_NOTE_NOT_BARE_SLUG,
  FACT_AUTO_RESOLVE_TAG_SET,
  FACT_BLOCKED_HAS_GROUP,
  FACT_ESCALATE_NEVER_INSTRUCTS_APPROVE,
]);

// ---------------------------------------------------------------------------
// THE POSITIVE LEAD, GENERALISED — 2026-08-23
// ---------------------------------------------------------------------------
// FACT_POSITIVE_LEAD_RENDERS_LETTER above is UC-01's, and it is UC-01-specific
// in three ways at once: it keys on `all_gates_passed`, it demands the
// CUSTOMER'S PUBLIC REPLY, and it looks for a letter's markup. Six of the nine
// registries sat at exit 2 because of it — not because those use cases fail,
// but because they do not produce a letter and were being asked for one.
//
// THE FACT IS RIGHT AND THE HARDCODING IS WRONG. Its purpose is C-16's guard:
// a use case that CANNOT SUCCEED and one that is REFUSING CORRECTLY are
// indistinguishable from outside, so something must assert that the success
// path actually produces its output. That argument holds for every use case.
// Only the output differs.
//
// What differs, measured per tier rather than assumed:
//   🟢 UC-01/03  success ends in a CUSTOMER-VISIBLE artifact — a rendered letter
//   🟢 UC-02     success ends in a WRITE to Remote; there is no letter
//   🟡 UC-04/05  success ends AT A HUMAN — `ready_for_approval`,
//                `prepared_for_signoff`. UC-05 has no write endpoint at all
//                (spec-confirmed), so the signed report IS the artifact
//   🔴 UC-07/08  success IS the escalation: a dossier reaching a specialist,
//                and no execution path may exist
//   🔴 UC-09     success is reaching the approval gate, never passing it
//
// So a registry declares its own artifact and this builds the fact around it.
// `required` stays true everywhere: an artifact that never appears must FAIL
// the run, which is the entire point and the thing a per-UC exemption would
// quietly destroy.
// ---------------------------------------------------------------------------

/**
 * Build a use case's positive-lead fact from its registry's `positiveArtifact`.
 * @param {object} reg a registry from src/surfaceverify/registries/
 */
export function makePositiveLeadFact(reg) {
  const art = reg.positiveArtifact;
  if (!art) {
    // NOT a silent skip. A registry with no declared artifact cannot answer the
    // one question this fact exists to ask, and saying "na" there would be the
    // exemption that destroys the guard.
    return {
      id: "positiveLeadProducesArtifact",
      description: `${reg.useCase} declares no positive artifact`,
      required: true,
      appliesToScenario: () => false,
      evaluate: () => ({ verdict: "na", detail: "no artifact declared" }),
      undeclared: true,
    };
  }

  return {
    id: "positiveLeadProducesArtifact",
    description: `${reg.useCase}: a real ${art.reason ?? art.action} decision produced ${art.what} on ${art.surface}`,
    required: true,
    // Matches the way discovery keyed it: scenarios.js labels an action-keyed
    // scenario with its action in `.reason`, so one comparison covers both and
    // the two cannot drift into disagreeing about what a scenario is.
    appliesToScenario: (scenario) =>
      scenario.reason === (art.reason ?? art.action) || scenario.decision?.action === art.action,
    evaluate(surfaceId, text) {
      if (surfaceId !== art.surface) {
        return { verdict: "na", detail: `${reg.useCase}'s artifact lands on ${art.surface}, not here` };
      }
      if (text === null) {
        return {
          verdict: "fail",
          detail:
            `the success path produced no ${art.what} on ${art.surface} — the same shape as a gate ` +
            `that can never succeed (C-16). For ${reg.useCase} this is what "it worked" means.`,
        };
      }
      // The escaped-source check is universal wherever markup is delivered:
      // this project shipped a letter to a real customer as literal
      // `&lt;!doctype html&gt;` once, on a run every status flag called green.
      if (art.markup && (/&lt;(!doctype|html|div|p|table)/i.test(text) || /&amp;lt;/i.test(text))) {
        return { verdict: "fail", detail: "delivered as ESCAPED HTML SOURCE, not rendered markup" };
      }
      if (art.mustMatch && !art.mustMatch.test(text)) {
        return {
          verdict: "fail",
          detail: `${art.surface} does not contain ${art.what}'s expected structure — it may not be the artifact at all`,
        };
      }
      return { verdict: "pass", detail: `${art.what} present on ${art.surface}` };
    },
  };
}
