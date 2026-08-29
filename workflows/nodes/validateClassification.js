// ---------------------------------------------------------------------------
// validateClassification.js — body of the "Validate Classification" Code node
// ---------------------------------------------------------------------------
// Mirrors src/uc01/classifier.js. This node exists so unvalidated model output
// can never reach a decision: the response is checked against a strict shape
// and falls back to the rule-based classifier on ANY failure — missing key,
// network error, bad JSON, wrong enum, out-of-range confidence.
//
// The upstream HTTP node is set to continue on error precisely so this
// fallback can run rather than the execution dying when OpenAI is unreachable.
// ---------------------------------------------------------------------------

const ticket = $('Normalize Ticket').first().json;

const OVER_SCOPE_PATTERNS = [
  { field: 'salary', re: /\b(salary|compensation|pay|remuneration|income)\b/ },
  { field: 'manager_name', re: /\b(manager|supervisor|direct report|reporting to)\b/ },
  { field: 'phone_number', re: /\b(phone|mobile|contact number)\b/ },
  { field: 'home_address', re: /\b(home address|residential address|personal address)\b/ },
  { field: 'ssn', re: /\b(ssn|social security|national insurance|tax id|identifier)\b/ },
  { field: 'performance', re: /\b(performance|disciplinary|conduct|evaluation)\b/ },
  { field: 'job_duties', re: /\b(job duties|responsibilities|roles)\b/ },
  { field: 'end_date', re: /\b(end date|termination date|last day)\b/ },
  { field: 'working_hours', re: /\b(working hours|schedule|shift)\b/ },
];

function detectRequestedFields(text) {
  const t = (text || '').toLowerCase();
  const found = [];
  for (const { field, re } of OVER_SCOPE_PATTERNS) {
    if (re.test(t)) found.push(field);
  }
  return found;
}

function ruleBased(text, hasAttachment) {
  const t = (text || '').toLowerCase();
  const hasExternalUrl = /https?:\/\//.test(text || '');
  const thirdParty = /(this is|we are|on behalf of)/.test(t) && !/my (bank|lender)/.test(t);
  const inScope = /\b(employment|verification|verify|letter|proof of employment|job|contract|work|position|bank|mortgage|lender|loan|form|landlord|visa|tenancy|housing)\b/.test(t);
  if (!inScope) {
    return {
      intent: 'out_of_scope',
      hasExternalUrl,
      requesterType: thirdParty ? 'third_party' : 'self',
      confidence: 0.95,
      requestedFields: [],
      source: 'rule_based_fallback',
    };
  }
  const nonStandard = hasAttachment || hasExternalUrl || /form|complete this|fill out/.test(t);
  return {
    intent: nonStandard ? 'non_standard' : 'standard_letter',
    hasExternalUrl,
    requesterType: thirdParty ? 'third_party' : 'self',
    confidence: nonStandard ? 0.6 : 0.95,
    requestedFields: detectRequestedFields(text),
    source: 'rule_based_fallback',
  };
}

// requestedFields is REQUIRED. Accepting `undefined` here is what made the
// over-scope disclosure gate a no-op on the live LLM path: the model omitted
// the key, this validator waved it through, and gates.js read the absence as
// "nothing extra was asked for". An omission is now an invalid shape, so the
// rule-based fallback below (which detects the fields deterministically from
// the ticket text) answers instead. Mirrors isValidClassification() in
// src/uc01/classifier.js.
function isValid(c) {
  return c
    && ['standard_letter', 'non_standard', 'out_of_scope'].includes(c.intent)
    && typeof c.hasExternalUrl === 'boolean'
    && ['self', 'third_party'].includes(c.requesterType)
    && typeof c.confidence === 'number'
    && Number.isFinite(c.confidence)
    && c.confidence >= 0 && c.confidence <= 1
    && Array.isArray(c.requestedFields)
    && c.requestedFields.every(f => typeof f === 'string');
}

let classification;
try {
  const raw = $input.first().json?.choices?.[0]?.message?.content;
  const parsed = JSON.parse(raw);
  classification = isValid(parsed) ? { ...parsed, source: 'llm' } : ruleBased(ticket.text, ticket.hasAttachment);
} catch (e) {
  classification = ruleBased(ticket.text, ticket.hasAttachment);
}

// hasAttachment always comes from ticket metadata (ground truth), never from
// the model's own read of the text — we already know this factually.
classification.hasAttachment = ticket.hasAttachment;

return [{ json: { ...ticket, classification } }];
