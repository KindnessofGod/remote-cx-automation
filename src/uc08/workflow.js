// ---------------------------------------------------------------------------
// workflow.js  —  UC-08 end to end: inquiry -> dossier -> escalate. NOTHING ELSE.
// ---------------------------------------------------------------------------
// WHY THIS FILE LOOKS DIFFERENT FROM UC-01'S AND UC-06'S
// This is the 🔴 high-tier use case, and CLAUDE.md's prime directive #2 is
// explicit: "No execution path may exist — assert this with a test." UC-01
// and UC-06 take a `remote`/`zendesk` dependency because they eventually
// WRITE somewhere. This function takes NEITHER. There is no import of
// ZendeskClient or RemoteClient anywhere in this module, and no parameter
// through which one could be passed in. That is deliberate and is the
// strongest version of "no execution path": not a runtime check that might
// have a bug, but the absence of any write-capable object this code could
// ever call, even by accident. test/uc08.test.js asserts BOTH — the runtime
// behavior (decision is always "escalate") AND the static fact (grep the
// source for the absence of any write-shaped method name).
//
// Every fact in the returned dossier came from a pure, deterministic
// function (presenceCalculator.js) or a classifier whose output is validated
// before use (inquiryParser.js); citation retrieval (treatyRetriever.js) is
// deterministic over the query's embedding — the embedding itself comes from
// an embeddings model, so citations are background context for a human, never
// a decision input (this use case has exactly one decision: escalate, always).
// The one LLM-authored piece (dossierBuilder.draftNarrative) is display prose
// restating already-decided facts, never a source of new ones. See each file's
// own header.
//
// `dossierStore` (optional) does NOT weaken the no-execution-path guarantee:
// it's a plain record of what was already decided and audited, the same
// relationship AuditLogger has to this workflow. dossierStore.js itself has
// exactly one write method and zero mutation methods — there is nothing to
// call on it that could ever change a real record anywhere.
// ---------------------------------------------------------------------------

import { classifyRisk } from "../shared/riskEngine.js";
import { parseInquiry } from "./inquiryParser.js";
import { computePresenceDays } from "./presenceCalculator.js";
import { buildPresenceEvidence } from "./presenceEvidence.js";
import { retrieveCitations } from "./treatyRetriever.js";
import { draftNarrative, buildDossier } from "./dossierBuilder.js";
import { judgeNarrative } from "../shared/narrativeJudge.js";

import { claimExternalRef } from "../shared/workflowClaims.js";

/**
 * @param {object} ticket
 * @param {string} ticket.text                     the inquiry text
 * @param {string} [ticket.employmentId]
 * @param {string} [ticket.externalRef]
 * @param {string} [ticket.source]
 * @param {Array<{country:string,startDate:string,endDate:string}>} [ticket.presencePeriods]
 * @param {string} [ticket.targetCountry]           jurisdiction to evaluate presence-days against
 * @param {string} [ticket.windowStart]             "YYYY-MM-DD"
 * @param {string} [ticket.windowEnd]               "YYYY-MM-DD"
 * @param {object} deps
 * @param {import("../shared/audit.js").AuditLogger} deps.audit
 * @param {import("./dossierStore.js").DossierStore} [deps.dossierStore]  optional — persists the dossier for later lookup, never for execution
 * @param {Function} [deps.classify]  override for tests — defaults to the real parseInquiry()
 * @param {object} [deps.treatyRetriever]  optional — a configured TreatyRetriever (e.g. one
 *   with a real pgPool + embed); defaults to the module-level retrieveCitations(), which is
 *   keyword fallback until configured. Does not weaken the no-execution-path guarantee:
 *   like dossierStore, it only decides which passages are cited, never changes a record.
 * @param {typeof draftNarrative} [deps.draftNarrative]  override for tests — defaults
 *   to the real draftNarrative() so production is unaffected; injectable so a test
 *   that doesn't care about narrative content never makes a real, retried LLM
 *   call just because OPENAI_API_KEY happens to be set in its environment.
 * @param {typeof judgeNarrative} [deps.judge]  scoped faithfulness judge for the
 *   drafted dossier narrative. PURELY INFORMATIONAL: the verdict is attached
 *   to the dossier for a tax specialist to see and is NEVER read by any gate,
 *   route, or policy — UC-08's only decision stays "escalate, always"
 *   regardless of any verdict (see narrativeJudge.js's own header). Defaults
 *   to the real judgeNarrative() — same hermetic-test hazard as draftNarrative
 *   above, inject a fake in tests that don't care about it.
 * @returns {Promise<{decision:"escalate", dossier:object, presenceDays:object|null, dossierId:string|null}>}
 */
export async function handleTaxInquiry(
  ticket,
  {
    audit,
    dossierStore = null,
    classify = parseInquiry,
    treatyRetriever = null,
    draftNarrative: draftNarrativeFn = draftNarrative,
    judge = judgeNarrative,
  } = {}
) {
  const {
    text = "",
    employmentId = null,
    externalRef = null,
    source = null,
    presencePeriods = [],
    targetCountry = null,
    windowStart = null,
    windowEnd = null,
  } = ticket;

  const parsed = await classify({ text });

  const presenceDays =
    targetCountry && windowStart && windowEnd
      ? computePresenceDays({ presencePeriods, country: targetCountry, windowStart, windowEnd })
      : null;

  // WHAT THAT COUNT IS A COUNT OF. The calculator returns a number; this
  // returns the country, the window and every supplied record with either its
  // clipped contribution or the reason it was excluded. Without it the dossier
  // said "92 distinct day(s)" and stopped — a figure with no subject, no window
  // and no records behind it, printed next to a citation of the 183-day rule.
  // Built only when a count was actually taken: an evidence block for a count
  // that never happened would be an empty period list, which reads as "no
  // records were supplied" (a real and much stronger finding) rather than as
  // "nobody asked for a count".
  const presenceEvidence = presenceDays
    ? buildPresenceEvidence({ presencePeriods, country: targetCountry, windowStart, windowEnd })
    : null;

  const citations = await (treatyRetriever
    ? treatyRetriever.retrieveCitations([text, parsed.inquiryType].join(" "))
    : retrieveCitations([text, parsed.inquiryType].join(" ")));

  const { narrative } = await draftNarrativeFn(
    {
      inquiryType: parsed.inquiryType,
      jurisdictions: parsed.jurisdictions,
      presenceDays,
      // The count's own subject, carried through from the STRUCTURED request
      // rather than from the parsed text. On the CA→NL inquiry that started
      // this (docs/DEMO-COUNTRIES.md §6.7) the text parser recognised no
      // country at all, and this was still "NL" — which is why the dossier can
      // now say what the 273 days were 273 days OF.
      presenceCountry: targetCountry,
      citations,
    },
    { audit }
  );

  // Faithfulness of that drafted narrative to the structured facts it was
  // drafted from. Attached to the dossier for a tax specialist to see —
  // never consumed by any gate, never alters the always-escalate decision.
  // The judge returns {verdict: "not_evaluated"} when unconfigured (the
  // hermetic default `npm test` hits — no OPENAI_API_KEY), so absence is an
  // explicit state, never a fabricated positive OR negative verdict.
  const faithfulness = await judge({
    narrative,
    structuredInputs: {
      inquiryType: parsed.inquiryType,
      jurisdictions: parsed.jurisdictions,
      presenceDays,
      citations: citations.map((c) => ({ id: c.id, title: c.title })),
    },
  });

  const dossier = buildDossier({
    inquiryType: parsed.inquiryType,
    jurisdictions: parsed.jurisdictions,
    presenceDays,
    presenceEvidence,
    presenceCountry: targetCountry,
    citations,
    faithfulness,
    narrative,
  });

  const { tier } = classifyRisk("UC-08", []); // always "high" — no flag can lower it

  // The ONLY thing this workflow ever does with its outcome is log it,
  // optionally record it for later lookup, and return it. There is no
  // branch, anywhere in this file, that leads anywhere else — that is the
  // point of a 🔴 use case.
  // DELIVERY-LEVEL IDEMPOTENCY. This use case has NO execution path, so a
  // duplicate delivery cannot double-act on a customer — but it can write a
  // second audit row and a second dossier for one request, and the audit log is
  // the artifact this tier exists to produce. A clean record is the deliverable.
  const claim = await claimExternalRef({
    pgPool: dossierStore?.pgPool ?? null,
    useCase: "UC-08",
    externalRef,
    decision: "escalate",
  });
  if (!claim.claimed) {
    return { decision: "escalate", duplicate: true, duplicateOf: externalRef, dossierId: null };
  }

  audit.log({
    useCase: "UC-08",
    action: "escalate",
    actor: employmentId ?? "unauthenticated",
    riskTier: tier,
    details: {
      externalRef,
      source,
      inquiryType: parsed.inquiryType,
      jurisdictions: parsed.jurisdictions,
      // The audit row is the durable record of what the specialist was handed,
      // so the not-knowing travels into it too: `jurisdictions: []` alone is
      // indistinguishable, months later, from a request about nowhere.
      jurisdictionKnowledge: dossier.jurisdictionCoverage.state,
      presenceCountry: targetCountry,
      presenceDays,
      citationIds: citations.map((c) => c.id),
      disclaimerApplied: true,
    },
  });

  const dossierRow = dossierStore
    ? dossierStore.createDossier({
        employmentId,
        externalRef,
        source,
        inquiryType: parsed.inquiryType,
        jurisdictions: parsed.jurisdictions,
        presenceDays,
        dossier,
      })
    : null;

  return { decision: "escalate", dossier, presenceDays, dossierId: dossierRow?.id ?? null };
}
