// ---------------------------------------------------------------------------
// classifier.js — UC-01 request understanding (THE LLM SEAM)
// ---------------------------------------------------------------------------
//
// Classifier V2.2 — Remote-aligned request interpretation.
//
// BUSINESS TAXONOMY
// -----------------
//
//   standard_letter
//   customized_letter
//   third_party_verification
//   out_of_scope
//
// The classifier answers:
//
//   "What employment-verification workflow is being requested?"
//
// requesterType answers a different question:
//
//   "Who sent this ticket?"
//
// ARCHITECTURE
// ------------
//
// LLM:
//   - intent
//   - requesterType
//   - requestedFields
//   - confidence
//
// Deterministic code:
//   - hasAttachment  <- trusted ticket metadata
//   - hasExternalUrl <- text parsing
//
// Everything after classification remains deterministic.
//
// ---------------------------------------------------------------------------

import {
  askJson,
  isLlmConfigured,
  extractUsage,
} from "../shared/llm.js";

import {
  withRetry,
} from "../shared/retry.js";

import {
  asLowerText,
} from "../shared/text.js";

// ---------------------------------------------------------------------------
// Classification contract
// ---------------------------------------------------------------------------

/**
 * @typedef {object} Classification
 *
 * @property {
 *   "standard_letter" |
 *   "customized_letter" |
 *   "third_party_verification" |
 *   "out_of_scope"
 * } intent
 *
 * @property {boolean} hasAttachment
 * @property {boolean} hasExternalUrl
 * @property {"self"|"third_party"} requesterType
 * @property {number} confidence
 * @property {string[]} requestedFields
 */

const VALID_INTENTS =
  new Set([
    "standard_letter",
    "customized_letter",
    "third_party_verification",
    "out_of_scope",
  ]);

const VALID_REQUESTER_TYPES =
  new Set([
    "self",
    "third_party",
  ]);

// ---------------------------------------------------------------------------
// Canonical EXTRA-field vocabulary
// ---------------------------------------------------------------------------
//
// These represent information beyond Remote's documented standard employment
// letter template.
//
// IMPORTANT:
//
// `end_date` / `termination_date` is deliberately NOT here.
//
// Remote's documented standard template can include termination information
// and termination date where applicable.
//
// `phone_number` means the EMPLOYEE/APPLICANT'S personal phone number.
// It does NOT mean Remote/entity contact information.
// ---------------------------------------------------------------------------

const ALLOWED_REQUESTED_FIELDS =
  new Set([
    "compensation",
    "manager_name",
    "phone_number",
    "home_address",
    "ssn",
    "performance",
    "job_duties",
    "working_hours",
    "job_title",
  ]);

// ---------------------------------------------------------------------------
// LLM response validation
// ---------------------------------------------------------------------------

function isValidClassification(
  obj
) {
  return (
    obj &&
    VALID_INTENTS.has(
      obj.intent
    ) &&
    VALID_REQUESTER_TYPES.has(
      obj.requesterType
    ) &&
    typeof obj.confidence ===
      "number" &&
    Number.isFinite(
      obj.confidence
    ) &&
    obj.confidence >= 0 &&
    obj.confidence <= 1 &&
    Array.isArray(
      obj.requestedFields
    ) &&
    obj.requestedFields.every(
      (field) =>
        typeof field ===
          "string" &&
        ALLOWED_REQUESTED_FIELDS.has(
          field
        )
    )
  );
}

// ---------------------------------------------------------------------------
// Classifier V2.2 prompt
// ---------------------------------------------------------------------------

export const SYSTEM_PROMPT = `
You classify inbound employment-verification requests for an Employer-of-Record platform.

Your job is REQUEST INTERPRETATION only.

Do NOT:
- approve a request;
- decide whether an employee is eligible;
- decide whether information may legally be disclosed;
- invent employee facts.

Return ONLY strict JSON with exactly these fields:

{
  "intent":
    "standard_letter"
    | "customized_letter"
    | "third_party_verification"
    | "out_of_scope",

  "requesterType":
    "self"
    | "third_party",

  "confidence": number between 0 and 1,

  "requestedFields": [
    "field_name"
  ]
}

==================================================
1. INTENT DECISION ORDER
==================================================

Apply these rules in order.

RULE 1 — OUT OF SCOPE

If the request is not about employment verification or an employment letter:

-> out_of_scope


RULE 2 — DIRECT THIRD-PARTY VERIFICATION

If the requested fulfillment requires Remote to verify or communicate DIRECTLY with an outside organisation/person:

-> third_party_verification


RULE 3 — CUSTOMIZED LETTER

Otherwise, if the request requires:

- information beyond Remote's standard employment-letter template;
- special wording beyond the standard template;
- Remote completing or signing a specific verification form;

then:

-> customized_letter


RULE 4 — STANDARD LETTER

Otherwise:

-> standard_letter


IMPORTANT:

Do not classify based merely on words such as:

bank
lender
landlord
embassy

Ask what Remote is actually being asked to DO.

==================================================
2. DOCUMENTED STANDARD LETTER INFORMATION
==================================================

Remote's standard employment-letter template can contain documented standard information such as:

- employee full name;
- employment start date;
- whether the contract is fixed-term or indefinite;
- applicable full-time / part-time information;
- applicable probation information;
- applicable notice / termination information;
- termination date where applicable;
- who may be contacted for more information;
- the relevant local Remote entity name/address.

These are STANDARD-template details.

If the requester asks only for standard-template information:

-> standard_letter

The wording used to request those fields does NOT by itself make the request customized.

For example, these verbs do NOT automatically mean customization:

- include
- show
- state
- confirm
- make sure the letter includes
- indicate
- whether

Examples:

"Please provide an employment letter showing my full name, start date and contract type."

-> standard_letter
-> requestedFields = []

"Please make sure the letter includes my start date and whether my contract is fixed-term or indefinite."

-> standard_letter
-> requestedFields = []

"Please state whether my contract is fixed-term or indefinite."

-> standard_letter
-> requestedFields = []

"I only need the normal employment confirmation with the local Remote entity details and who can be contacted for more information."

-> standard_letter
-> requestedFields = []

IMPORTANT:

Do NOT put standard-template information into requestedFields.

==================================================
3. STANDARD LETTER
==================================================

Use "standard_letter" when the employee wants an ordinary employment / proof-of-employment letter and nothing outside the standard workflow is required.

Examples:

"Please send me a normal proof-of-employment letter."

"I need proof of employment for my mortgage application."

"I need the standard employment letter for a visa."

"My bank needs proof of employment, but I will download the standard letter myself and send it to them."

The fact that a bank, lender, landlord, embassy or other organisation will RECEIVE the employee's letter does not make the workflow third-party verification.

==================================================
4. CUSTOMIZED LETTER
==================================================

Use "customized_letter" when Remote must prepare something beyond the documented standard template and there is no requirement for direct Remote-to-third-party verification.

This includes:

- additional non-standard information;
- special wording;
- a specific employment-verification form Remote must complete;
- a form Remote must sign;
- a third party's form forwarded by the employee for Remote to complete.

Examples:

"Please include my salary."

-> customized_letter
-> requestedFields = ["compensation"]

"Please add my manager's name."

-> customized_letter
-> requestedFields = ["manager_name"]

"I need the letter to show my home address and my personal phone number."

-> customized_letter
-> requestedFields = ["home_address", "phone_number"]

"Please include my job title as an explicit field."

-> customized_letter
-> requestedFields = ["job_title"]

"The embassy requires specific wording that is not in the normal template."

-> customized_letter

"My landlord sent me a form for Remote to fill out and sign."

-> customized_letter

"My bank gave me their verification form. Can Remote fill it in?"

-> customized_letter


IMPORTANT STANDARD + CUSTOM RULE:

If a request contains standard information AND at least one non-standard field:

-> customized_letter

Example:

"Please include my start date, contract type, and current salary."

Start date is standard.
Contract type is standard.
Salary is extra.

Therefore:

intent = customized_letter
requestedFields = ["compensation"]

==================================================
5. FORM VS THIRD-PARTY VERIFICATION
==================================================

A form coming from a bank, lender, landlord or other third party does NOT automatically make the request third_party_verification.

Employee forwards form to Remote for completion:

"My landlord sent me a form for Remote to fill out."

-> customized_letter
-> requesterType = self


Employee forwards bank form:

"My bank sent me its employment form for Remote to complete."

-> customized_letter
-> requesterType = self


Direct outside-party verification:

"This is First Bank. We need to verify the applicant's employment directly with Remote."

-> third_party_verification
-> requesterType = third_party


Employee says bank must verify directly:

"My bank says they need to verify my employment directly with Remote."

-> third_party_verification
-> requesterType = self


If the outside organisation itself contacts Remote and attaches its form as part of the direct verification request:

"This is a lender. We attached our verification form and need Remote to complete the verification directly for our applicant."

-> third_party_verification
-> requesterType = third_party

The attachment remains a separate operational/risk signal.

==================================================
6. THIRD-PARTY VERIFICATION
==================================================

Use "third_party_verification" when Remote must verify or communicate DIRECTLY with an outside organisation/person.

Strong signals include:

- verify directly with Remote
- contact Remote directly
- confirmation directly from Remote
- verify directly with us
- telephone verification
- callback for verification
- outside organisation itself contacting Remote

Examples:

"My lender wants telephone employment verification from Remote and needs a callback."

-> third_party_verification
-> requesterType = self

"This is the applicant's landlord. Please confirm directly whether they are employed by Remote."

-> third_party_verification
-> requesterType = third_party

"This is the applicant's bank. Please verify their employment start date directly with us."

-> third_party_verification
-> requesterType = third_party
-> requestedFields = []

Start date remains standard information.
The direct outside-party workflow determines the intent.


THIRD-PARTY + EXTRA INFORMATION

If direct third-party verification also requests non-standard information:

keep:

intent = third_party_verification

and record the extra information.

Example:

"This is First Bank. Please verify the applicant's employment and current salary directly with us."

-> intent = third_party_verification
-> requesterType = third_party
-> requestedFields = ["compensation"]

==================================================
7. REQUESTER TYPE
==================================================

requesterType describes WHO SENT THE TICKET.

It is independent from intent.

Use:

requesterType = third_party

ONLY when the sender identifies themselves as someone other than the employee.

Examples:

"This is First Bank..."

"We are the employee's mortgage lender..."

"This is the applicant's landlord..."

-> third_party


Use:

requesterType = self

when the employee is the sender, even if they mention another organisation.

Examples:

"My bank needs proof of employment."

"My bank needs to verify me directly with Remote."

"My landlord gave me a form."

"My lender wants telephone verification."

-> self

Do NOT make requesterType third_party merely because the words bank, lender, landlord or third party appear in the message.

==================================================
8. REQUESTED FIELDS
==================================================

requestedFields contains ONLY explicitly requested information beyond Remote's documented standard employment-letter template.

Use ONLY these canonical values:

compensation
manager_name
phone_number
home_address
ssn
performance
job_duties
working_hours
job_title


COMPENSATION

salary
pay
current pay
compensation
wages
income
remuneration

=> "compensation"


MANAGER

manager's name
manager
supervisor

=> "manager_name"


EMPLOYEE PERSONAL PHONE

personal phone
my phone number
my mobile number
employee phone number
applicant's phone number
employee's telephone number

=> "phone_number"

IMPORTANT:

Remote/entity/company contact information is NOT "phone_number".

Examples:

"Please include my personal phone number."

-> requestedFields = ["phone_number"]

"Please include the normal Remote contact information."

-> requestedFields = []


HOME ADDRESS

home address
residential address
personal address

=> "home_address"


SSN / PERSONAL IDENTIFIER

SSN
social security number
national insurance number
tax identifier

=> "ssn"


PERFORMANCE

performance
disciplinary information
conduct
evaluation

=> "performance"


JOB DUTIES

job duties
responsibilities

=> "job_duties"


WORKING HOURS

working hours
work schedule
shift

=> "working_hours"


JOB TITLE

job title
position title

=> "job_title"


STANDARD INFORMATION MUST NOT BE ADDED TO requestedFields.

Examples:

start date
fixed-term / indefinite contract type
standard termination information where applicable
termination date where applicable
Remote entity/contact details

do NOT become requestedFields.

If no extra information is requested:

requestedFields = []

==================================================
9. OUT OF SCOPE
==================================================

Use "out_of_scope" only when the request is not about employment verification / employment letters.

Examples:

- password/login support;
- expense reimbursement;
- payslips;
- payment methods;
- background-check status;
- right-to-work checks;
- offer-letter creation;
- unrelated questions.

Do NOT mark something out_of_scope merely because it contains:

- a form;
- an attachment;
- a bank;
- a lender;
- a landlord;
- special employment information;
- unusual wording;
- direct verification.

==================================================
10. CONFIDENCE
==================================================

confidence means:

"How confident are you that the ENTIRE semantic classification is correct?"

Consider:

- intent;
- requesterType;
- requestedFields.

It is NOT:

- eligibility confidence;
- disclosure approval confidence;
- policy confidence.

Use lower confidence only when the semantic interpretation is genuinely ambiguous.

==================================================
11. FINAL REQUIREMENTS
==================================================

Return strict JSON only.

No prose.
No markdown.
No explanation.
`.trim();

// ---------------------------------------------------------------------------
// Deterministic URL detection
// ---------------------------------------------------------------------------

function detectExternalUrl(
  text
) {
  return /https?:\/\/|www\./i.test(
    String(
      text || ""
    )
  );
}

// ---------------------------------------------------------------------------
// Deterministic requested-field detection for fallback
// ---------------------------------------------------------------------------

const EXTRA_FIELD_PATTERNS = [
  {
    field:
      "compensation",

    patterns: [
      /\bsalary\b/,
      /\bcompensation\b/,
      /\bcurrent pay\b/,
      /\bpay\b/,
      /\bwages?\b/,
      /\bremuneration\b/,
      /\bincome\b/,
    ],
  },

  {
    field:
      "manager_name",

    patterns: [
      /\bmanager(?:'s)? name\b/,
      /\bmanager\b/,
      /\bsupervisor\b/,
      /\breporting to\b/,
    ],
  },

  // IMPORTANT:
  //
  // Only PERSONAL / EMPLOYEE phone details count as extra.
  //
  // We deliberately do NOT use generic:
  //
  //   /\bphone\b/
  //   /\btelephone\b/
  //   /\bcontact number\b/
  //
  // because Remote/entity contact information can be standard.
  {
    field:
      "phone_number",

    patterns: [
      /\bpersonal phone\b/,
      /\bpersonal telephone\b/,
      /\bmy phone number\b/,
      /\bmy mobile number\b/,
      /\bmy telephone number\b/,
      /\bemployee(?:'s)? phone number\b/,
      /\bemployee(?:'s)? mobile number\b/,
      /\bemployee(?:'s)? telephone number\b/,
      /\bapplicant(?:'s)? phone number\b/,
      /\bapplicant(?:'s)? mobile number\b/,
      /\bapplicant(?:'s)? telephone number\b/,
    ],
  },

  {
    field:
      "home_address",

    patterns: [
      /\bhome address\b/,
      /\bresidential address\b/,
      /\bpersonal address\b/,
    ],
  },

  {
    field:
      "ssn",

    patterns: [
      /\bssn\b/,
      /\bsocial security(?: number)?\b/,
      /\bnational insurance(?: number)?\b/,
      /\btax id\b/,
      /\btax identifier\b/,
    ],
  },

  {
    field:
      "performance",

    patterns: [
      /\bperformance\b/,
      /\bdisciplinary\b/,
      /\bconduct\b/,
      /\bevaluation\b/,
    ],
  },

  {
    field:
      "job_duties",

    patterns: [
      /\bjob duties\b/,
      /\bresponsibilities\b/,
    ],
  },

  {
    field:
      "working_hours",

    patterns: [
      /\bworking hours\b/,
      /\bwork schedule\b/,
      /\bshift\b/,
    ],
  },

  {
    field:
      "job_title",

    patterns: [
      /\bjob title\b/,
      /\bposition title\b/,
    ],
  },
];

function detectRequestedFields(
  lower
) {
  const found =
    new Set();

  for (
    const {
      field,
      patterns,
    } of EXTRA_FIELD_PATTERNS
  ) {
    if (
      patterns.some(
        (pattern) =>
          pattern.test(
            lower
          )
      )
    ) {
      found.add(
        field
      );
    }
  }

  return Array.from(
    found
  );
}

// ---------------------------------------------------------------------------
// Deterministic requester-type detection for fallback
// ---------------------------------------------------------------------------

function detectRequesterType(
  lower
) {
  const explicitThirdPartyPatterns =
    [
      /\bthis is\b[^.]*\b(bank|lender|mortgage company|landlord|financial institution|verification company)\b/,

      /\bwe are\b[^.]*\b(bank|lender|mortgage company|landlord|financial institution|verification company)\b/,

      /\bwe represent\b/,

      /\bon behalf of the (employee|applicant)\b/,
    ];

  return explicitThirdPartyPatterns.some(
    (pattern) =>
      pattern.test(
        lower
      )
  )
    ? "third_party"
    : "self";
}

// ---------------------------------------------------------------------------
// Rule-based fallback classifier
// ---------------------------------------------------------------------------

export function classifyRequestRuleBased({
  text,
  hasAttachment = false,
}) {
  const lower =
    asLowerText(
      text
    );

  const hasExternalUrl =
    detectExternalUrl(
      text
    );

  const requesterType =
    detectRequesterType(
      lower
    );

  const requestedFields =
    detectRequestedFields(
      lower
    );

  // -------------------------------------------------------------------------
  // Employment-verification scope
  // -------------------------------------------------------------------------
  //
  // Avoid treating the mere presence of:
  //
  //   bank
  //   landlord
  //   loan
  //   mortgage
  //
  // as employment verification.
  // -------------------------------------------------------------------------

  const looksInScope =
    /\bemployment\b/.test(
      lower
    ) ||
    /\bproof of employment\b/.test(
      lower
    ) ||
    /\bemployment letter\b/.test(
      lower
    ) ||
    /\bemployment verification\b/.test(
      lower
    ) ||
    /\bverification letter\b/.test(
      lower
    ) ||
    /\bverify (?:my|their|the|this|an|applicant'?s?) employment\b/.test(
      lower
    );

  // AN ARTIFACT WE HAVE NOT READ CANNOT BE RULED OUT OF SCOPE ON THE TEXT
  // ALONE. V2.2 deliberately narrowed looksInScope so that the bare word
  // "bank" or "landlord" no longer implies employment verification — that
  // narrowing is correct and is kept. But it ran BEFORE the attachment and
  // external-URL signals, so "My bank sent this form, please complete it."
  // with a real attachment was answered out_of_scope: a decision about a
  // document nobody had opened, taken from the covering sentence.
  //
  // An attachment or a link is a thing a human must look at. Its contents are
  // unknown to this function by construction, so the honest answer is "a
  // person decides", never "not our problem". Fails closed, consistent with
  // every other gate in UC-01.
  if (
    !looksInScope &&
    !hasAttachment &&
    !hasExternalUrl
  ) {
    return {
      intent:
        "out_of_scope",

      hasAttachment,

      hasExternalUrl,

      requesterType,

      confidence:
        0.9,

      requestedFields:
        [],
    };
  }

  // -------------------------------------------------------------------------
  // Direct third-party verification
  // -------------------------------------------------------------------------

  const directVerificationPatterns =
    [
      /\bverify\b[^.]*\bdirectly\b/,

      /\bverification\b[^.]*\bdirectly\b/,

      /\bconfirm\b[^.]*\bdirectly\b/,

      /\bcontact remote directly\b/,

      /\bcontact you directly\b/,

      /\bdirectly with remote\b/,

      /\bdirectly from remote\b/,

      /\bconfirmation directly from remote\b/,

      /\btelephone employment verification\b/,

      /\btelephone verification\b/,

      /\bcall(?: us)? back\b[^.]*\bverif/,

      /\bverify\b[^.]*\bwith us\b/,
    ];

  const explicitDirectVerification =
    directVerificationPatterns.some(
      (pattern) =>
        pattern.test(
          lower
        )
    );

  const directThirdPartySenderRequest =
    requesterType ===
      "third_party" &&
    /\bverify|verification|confirm\b/.test(
      lower
    );

  if (
    explicitDirectVerification ||
    directThirdPartySenderRequest
  ) {
    return {
      intent:
        "third_party_verification",

      hasAttachment,

      hasExternalUrl,

      requesterType,

      confidence:
        0.85,

      requestedFields,
    };
  }

  // -------------------------------------------------------------------------
  // Customized employment-letter/form workflow
  // -------------------------------------------------------------------------

  const customLanguage =
    [
      "custom",
      "customized",
      "customised",
      "specific wording",
      "special wording",
      "additional information",
      "additional details",
      "own form",
      "their form",
      "its own form",
      "verification form",
      "form to complete",
      "form to fill",
      "form for remote to",
      "fill out",
      "fill in",
      "complete the form",
      "sign the form",
      "fill out and sign",
    ].some(
      (hint) =>
        lower.includes(
          hint
        )
    );

  if (
    requestedFields.length >
      0 ||
    customLanguage
  ) {
    return {
      intent:
        "customized_letter",

      hasAttachment,

      hasExternalUrl,

      requesterType,

      confidence:
        0.85,

      requestedFields,
    };
  }

  // -------------------------------------------------------------------------
  // Attachment itself does NOT determine semantic intent.
  //
  // Artifact handling belongs downstream in deterministic policy.
  // -------------------------------------------------------------------------

  return {
    intent:
      "standard_letter",

    hasAttachment,

    hasExternalUrl,

    requesterType,

    confidence:
      0.9,

    requestedFields:
      [],
  };
}

// ---------------------------------------------------------------------------
// Main classifier
// ---------------------------------------------------------------------------

export async function classifyRequest(
  {
    text,
    hasAttachment = false,
  },

  {
    askJson:
      ask = askJson,

    isConfigured:
      isConfigured =
        isLlmConfigured,

    audit =
      null,

    backoff =
      undefined,
  } = {}
) {
  // Objective signal — not an LLM prediction.
  const hasExternalUrl =
    detectExternalUrl(
      text
    );

  // -------------------------------------------------------------------------
  // No configured LLM -> deterministic fallback
  // -------------------------------------------------------------------------

  if (
    !isConfigured()
  ) {
    return {
      ...classifyRequestRuleBased({
        text,
        hasAttachment,
      }),

      source:
        "rule_based_fallback",
    };
  }

  try {
    const userPrompt =
      `Ticket text:\n"""${text || ""}"""`;

    let lastUsage =
      null;

    const result =
      await withRetry(
        async () => {
          const response =
            await ask(
              SYSTEM_PROMPT,
              userPrompt
            );

          lastUsage =
            extractUsage(
              response
            );

          if (
            !isValidClassification(
              response
            )
          ) {
            throw new Error(
              `LLM returned an invalid classification shape: ${JSON.stringify(response)}`
            );
          }

          return response;
        },

        {
          ...(backoff
            ? {
                backoff,
              }
            : {}),

          onAttempt: ({
            attempt,
            ok,
            error,
          }) =>
            audit?.logTraceStep({
              call:
                "classify.askJson",

              attempt,

              ok,

              error,

              details:
                lastUsage
                  ? {
                      usage:
                        lastUsage,

                      useCase:
                        "UC-01",
                    }
                  : null,
            }),
        }
      );

    // -----------------------------------------------------------------------
    // Final classification combines semantic interpretation with objective
    // ticket facts.
    // -----------------------------------------------------------------------

    return {
      intent:
        result.intent,

      hasAttachment,

      hasExternalUrl,

      requesterType:
        result.requesterType,

      confidence:
        result.confidence,

      requestedFields:
        result.requestedFields,

      source:
        "llm",
    };
  } catch (
    error
  ) {
    console.error(
      `[classifier] LLM classification failed after retries, falling back to rules: ${error.message}`
    );

    return {
      ...classifyRequestRuleBased({
        text,
        hasAttachment,
      }),

      source:
        "rule_based_fallback",
    };
  }
}