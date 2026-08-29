// ---------------------------------------------------------------------------
// caseStore.js  —  Operational state + evidence records for a case
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
// audit_log is the immutable event trail (what happened, when, why) — see
// audit.js. It is deliberately append-only and never queried for "what's the
// current state of this request?". That's what THIS is for: the mutable,
// queryable operational record a specialist or a ZAF sidebar would actually
// read from —
//   - cases            one row per verification request, with a mutable `status`
//   - review_queue     a row per case that needs a human (human_review/escalate)
//   - documents        generated artifacts (the letter) tied to a case
//   - consent_records  durable evidence of a consent claim/grant tied to a case
//   - request_artifacts  an uploaded file or external URL detected on a request
//   - extracted_requirements  per-field data pulled from an artifact — see
//     createExtractedRequirement()'s own comment: nothing calls it yet
//
// Same pattern as AuditLogger (audit.js), deliberately: in-memory arrays
// always populated (so tests/demo never need a database), plus an optional
// pgPool that — when supplied — ALSO writes to Supabase in the background.
// Errors from the background write are caught and logged, never thrown into
// the caller. Call flush() to await any writes still in flight (used by the
// live-verification script before reading rows back).
// ---------------------------------------------------------------------------

import { randomUUID, createHash } from "node:crypto";
import { matchesOwner } from "./ownerScope.js";
import { canonicalDecisionStatus } from "./declineVocabulary.js";

export class CaseStore {
  /**
   * @param {object} [opts]
   * @param {import("pg").Pool|null} [opts.pgPool]  when set, also writes each
   *   row to the matching Supabase table in the background
   */
  constructor({ pgPool = null } = {}) {
    this.pgPool = pgPool;
    this.cases = [];
    this.reviewQueue = [];
    this.documents = [];
    this.consentRecords = [];
    this.requestArtifacts = [];
    this.extractedRequirements = [];
    this.pending = [];
    // caseId -> promise of that case's own `cases` row insert. Every child
    // table carries a `case_id` FK, so a child insert must not fire until the
    // parent case row has actually landed — the pool otherwise gives no
    // ordering guarantee between two "fire and forget" queries, and a child
    // insert can (and did, in testing) reach Postgres first and violate the
    // FK constraint.
    this.caseWrites = new Map();
  }

  #track(promise, label) {
    const guarded = promise.catch((err) => {
      console.error(`[caseStore] failed to write ${label} to Supabase: ${err.message}`);
    });
    this.pending.push(guarded);
  }

  /**
   * Fire a child-table insert only after its parent case's own insert has
   * landed (or been skipped, if pgPool is null — callers already check that).
   * If the parent write rejects, this insert is never attempted — see the
   * comment on `caseWrites` above for why that matters.
   */
  #insertChild(caseId, sql, params, label) {
    const parentWrite = this.caseWrites.get(caseId) ?? Promise.resolve();
    const insertPromise = parentWrite.then(() => this.pgPool.query(sql, params));
    this.#track(insertPromise, label);
  }

  /**
   * One row per verification request — the current-state record.
   * @param {object} args
   * @param {string} args.useCase        e.g. "UC-01"
   * @param {string} [args.source]       e.g. "zendesk"
   * @param {string} [args.externalRef]  the Zendesk ticket id
   * @param {string} args.employmentId
   * @param {string} [args.requester]    session employment id, or "unauthenticated"
   * @param {object} [args.classification]
   * @param {string} [args.ticketText]   the original request text the user sent
   * @param {string} args.decision       "auto_resolve" | "human_review" | "escalate"
   * @param {string} [args.reason]
   * @param {string[]} [args.flags]
   * @param {string} args.status         mutable lifecycle state (see workflow.js)
   * @param {string} [args.returnAddress]  G-4/F1: how to reach the party that
   *   filed this case, once L-19's ageing window passes — the third-party
   *   door's fifth field. Null for every non-third-party-door case; see
   *   migrations/0002-cases-third-party-followup.sql for why this lives on
   *   `cases` rather than on `consent_records`.
   * @returns {object} the created case row (with its generated id)
   */
  createCase({
    useCase,
    source = null,
    externalRef = null,
    employmentId,
    requester = null,
    classification = null,
    ticketText = null,
    decision,
    reason = null,
    flags = [],
    status,
    returnAddress = null,
  }) {
    const now = new Date().toISOString();
    const row = {
      id: randomUUID(),
      createdAt: now,
      updatedAt: now,
      useCase,
      source,
      externalRef,
      employmentId,
      requester,
      classification,
      ticketText,
      decision,
      reason,
      flags,
      status,
      returnAddress,
      agedNoticeSentAt: null,
    };
    this.cases.push(row);
    if (this.pgPool) {
      // Keep the RAW (unguarded) promise for children to chain on via
      // #insertChild() — it must still reject on failure so a child can
      // detect "the parent never landed" and skip its own insert rather
      // than attempting a doomed one. #track() below separately wraps a
      // caught copy for `pending`/flush() bookkeeping.
      const insertPromise = this.pgPool.query(
        `insert into cases
           (id, created_at, updated_at, use_case, source, external_ref, employment_id,
            requester, classification, ticket_text, decision, reason, flags, status,
            return_address)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12,$13::jsonb,$14,$15)`,
        [
          row.id,
          row.createdAt,
          row.updatedAt,
          row.useCase,
          row.source,
          row.externalRef,
          row.employmentId,
          row.requester,
          JSON.stringify(row.classification ?? {}),
          row.ticketText,
          row.decision,
          row.reason,
          JSON.stringify(row.flags ?? []),
          row.status,
          row.returnAddress,
        ]
      );
      this.caseWrites.set(row.id, insertPromise);
      this.#track(insertPromise, `case ${row.id}`);
    }
    return row;
  }

  /**
   * A row for a case that needs a human (human_review or escalate outcomes).
   * @param {object} args
   * @param {string} args.caseId
   * @param {string} [args.status]    "pending" | "approved" | "rejected"
   * @param {string} [args.assignee]
   * @param {string} [args.notes]
   * @returns {object} the created review_queue row
   */
  createReviewQueueEntry({ caseId, status = "pending", assignee = null, notes = null }) {
    const now = new Date().toISOString();
    const row = { id: randomUUID(), createdAt: now, updatedAt: now, caseId, status, assignee, notes };
    this.reviewQueue.push(row);
    if (this.pgPool) {
      this.#insertChild(
        caseId,
        `insert into review_queue (id, created_at, updated_at, case_id, status, assignee, notes)
         values ($1,$2,$3,$4,$5,$6,$7)`,
        [row.id, row.createdAt, row.updatedAt, row.caseId, row.status, row.assignee, row.notes],
        `review_queue entry ${row.id}`
      );
    }
    return row;
  }

  /**
   * A generated artifact (the verification letter) tied to a case.
   * @param {object} args
   * @param {string} args.caseId
   * @param {string} args.type     e.g. "employment_verification_letter"
   * @param {string} args.content  the HTML
   * @returns {object} the created document row (includes a sha256 contentHash)
   */
  createDocument({ caseId, type, content }) {
    const now = new Date().toISOString();
    const contentHash = createHash("sha256").update(content).digest("hex");
    const row = { id: randomUUID(), createdAt: now, caseId, type, content, contentHash };
    this.documents.push(row);
    if (this.pgPool) {
      this.#insertChild(
        caseId,
        `insert into documents (id, created_at, case_id, type, content, content_hash)
         values ($1,$2,$3,$4,$5,$6)`,
        [row.id, row.createdAt, row.caseId, row.type, row.content, row.contentHash],
        `document ${row.id}`
      );
    }
    return row;
  }

  /**
   * Durable evidence of a consent claim/grant tied to a case — e.g. a
   * third-party verification consent. Distinct from the ticket's now-retired
   * `consentOnRecord` boolean: this makes the claim queryable/auditable after
   * the fact, independent of the request that asserted it.
   *
   * L-7/L-8/VC-30: invariant 13's four facts are columns, not prose in
   * `evidenceReference` — `grantedByEmploymentId`/`grantedBySignal` (WHO,
   * and how that identity was proved — never a claim), `requestingParty`
   * (TO WHOM), `purpose` (FOR WHAT) and `grantedAt` (WHEN, distinct from
   * `createdAt`, which is when the REQUEST was recorded — null means
   * unanswered). All four are nullable: a row is created PENDING with none of
   * them set (a third party has asked and the employee has not answered), and
   * `updateConsentDecision()` below fills them in when the employee does.
   *
   * @param {object} args
   * @param {string} args.caseId
   * @param {string} args.consentType   e.g. "third_party_verification"
   * @param {string} args.status        "pending" | "granted" | "denied" | "asserted"
   *   (a CONSENT status — unrelated to the review verb that renamed to
   *   `declined` on 2026-08-19; a consent is denied by the person whose
   *   consent it is, which is not a reviewer declining a request)
   * @param {string} [args.source]      e.g. "ticket_text", "third_party_door"
   * @param {string} [args.evidenceReference]  link/reference to supporting evidence
   * @param {string} [args.requestingParty]  who is asking to be told (VC-30)
   * @param {string} [args.purpose]     what the disclosure is FOR (VC-30)
   * @param {string} [args.grantedByEmploymentId]  the employment id who
   *   granted/denied, once they have — null until then
   * @param {string} [args.grantedBySignal]  the authenticated signal that
   *   identity came from — never a claim
   * @param {string|null} [args.grantedAt]  ISO timestamp of the grant/denial
   *   decision, or null while pending
   * @returns {object} the created consent_records row
   */
  createConsentRecord({
    caseId,
    consentType,
    status,
    source = null,
    evidenceReference = null,
    requestingParty = null,
    purpose = null,
    grantedByEmploymentId = null,
    grantedBySignal = null,
    grantedAt = null,
  }) {
    const now = new Date().toISOString();
    const row = {
      id: randomUUID(),
      createdAt: now,
      caseId,
      consentType,
      status,
      source,
      evidenceReference,
      requestingParty,
      purpose,
      grantedByEmploymentId,
      grantedBySignal,
      grantedAt,
    };
    this.consentRecords.push(row);
    if (this.pgPool) {
      this.#insertChild(
        caseId,
        `insert into consent_records
           (id, created_at, case_id, consent_type, status, source, evidence_reference,
            requesting_party, purpose, granted_by_employment_id, granted_by_signal, granted_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [
          row.id,
          row.createdAt,
          row.caseId,
          row.consentType,
          row.status,
          row.source,
          row.evidenceReference,
          row.requestingParty,
          row.purpose,
          row.grantedByEmploymentId,
          row.grantedBySignal,
          row.grantedAt,
        ],
        `consent_record ${row.id}`
      );
    }
    return row;
  }

  /**
   * L-8: THE LOOKUP THAT REPLACES A BOOLEAN WITH AN ARTIFACT.
   *
   * Is there a `consent_records` row for THIS employment, THIS requesting
   * party, THIS purpose? Scoped by all three, deliberately — VC-30's own
   * failure/recovery line: "a standing 'yes to anyone, forever' cannot be
   * represented". A consent granted to one bank for one mortgage application
   * says nothing about a different bank, or the same bank for a different
   * purpose, so this never widens the match to "any consent this employee has
   * ever given".
   *
   * `consent_records` carries no `employment_id` column of its own — only
   * `case_id` (NOT NULL, FK to `cases.id`), so the join runs through `cases`,
   * exactly the shape L-9's own note states: "THE CASE MUST EXIST FIRST."
   * A person or purpose left null NEVER matches anything (an unscoped
   * question cannot have a scoped answer) — this is the same fail-closed
   * shape `listByOwner()` uses two methods up.
   *
   * Returns the MOST RECENT matching row, or `null` when none exists — `null`
   * is exactly what `src/shared/identity.js`'s pending state expects, and is
   * indistinguishable, on purpose, from "the employment does not exist at
   * all" (VC-33): no row can exist referencing a case that was never created.
   *
   * @param {object} args
   * @param {string} args.employmentId
   * @param {string|null} [args.requestingParty]
   * @param {string|null} [args.purpose]
   * @returns {Promise<object|null>}
   */
  async findConsentArtifact({ employmentId, requestingParty = null, purpose = null, enquiryReference = null }) {
    if (!employmentId || !requestingParty || !purpose) return null;

    // CONSENT IS PER-ENQUIRY, NOT A STANDING AUTHORISATION (owner decision
    // 2026-08-28, after a demo where the consent step silently never appeared).
    //
    // Without `enquiryReference` this matched ANY consent row for the same
    // (employee, party, purpose) — so a grant made once authorised that party
    // to ask again, for that purpose, indefinitely, and the employee was never
    // consulted a second time. Two problems with that, and the smaller one is
    // the demo. The larger: an employee who agreed that their bank could
    // confirm their job for one mortgage had, without being told, agreed to
    // every future request that bank ever phrases the same way.
    //
    // Scoped through the OWNING CASE's `classification.doorReference` rather
    // than a new column, because that is already the enquirer's own reference
    // and needs no migration. The SAME enquiry re-decided — the consent-grant
    // advance, and the door's reopen — carries the same doorReference and so
    // still matches its own consent. A genuinely new enquiry does not.
    //
    // Callers that pass nothing keep the old, broader behaviour: the aged-notice
    // sweep and the approval queue ask "has this person ever been asked about
    // by this party", which is a different question and still the right one
    // for them.
    const scoped = enquiryReference != null && String(enquiryReference).trim() !== "";
    const wantedRef = scoped ? String(enquiryReference).trim() : null;

    // THE SCOPING IS ASYMMETRIC, DELIBERATELY: a GRANT is narrow, a REFUSAL is
    // broad.
    //
    // A grant authorises only the enquiry it was given for — that is the whole
    // change. But a refusal keeps its old, wider reach: an employee who told a
    // party "no" is not asked again the next time that party phrases the same
    // request, and VC-08's "told no is blocked, never escalated" survives
    // unchanged. Scoping refusals per-enquiry would have handed any refused
    // party a way to re-ask indefinitely, one new reference at a time — turning
    // a protection into a formality. The permissive state is the one that
    // should be hard to accumulate.
    const broadCaseIds = new Set(
      this.cases.filter((c) => String(c.employmentId) === String(employmentId)).map((c) => c.id)
    );
    const partyMatches = this.consentRecords
      .filter(
        (r) =>
          broadCaseIds.has(r.caseId) &&
          matchesParty(r.requestingParty, requestingParty) &&
          matchesParty(r.purpose, purpose)
      )
      .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

    const refusal = partyMatches.filter((r) => r.status === "denied").pop();
    if (refusal) return refusal;

    const localMatches = scoped
      ? partyMatches.filter((r) => {
          const owner = this.cases.find((c) => c.id === r.caseId);
          return String(owner?.classification?.doorReference ?? "") === wantedRef;
        })
      : partyMatches;
    if (localMatches.length) return localMatches[localMatches.length - 1];
    if (!this.pgPool) return null;

    if (scoped) {
      const denied = await this.pgPool.query(
        `select ${CONSENT_SELECT_COLUMNS}
           from consent_records cr
           join cases c on c.id = cr.case_id
          where c.employment_id = $1
            and cr.requesting_party = $2
            and cr.purpose = $3
            and cr.status = 'denied'
          order by cr.created_at desc
          limit 1`,
        [String(employmentId), String(requestingParty), String(purpose)]
      );
      if (denied.rows[0]) return denied.rows[0];
    }

    const result = await this.pgPool.query(
      `select ${CONSENT_SELECT_COLUMNS}
         from consent_records cr
         join cases c on c.id = cr.case_id
        where c.employment_id = $1
          and cr.requesting_party = $2
          and cr.purpose = $3
          and ($4::text is null or c.classification->>'doorReference' = $4)
        order by cr.created_at desc
        limit 1`,
      [String(employmentId), String(requestingParty), String(purpose), wantedRef]
    );
    return result.rows[0] ?? null;
  }

  /**
   * L-13: one consent_records row by id, WITH the employment id it belongs to
   * — joined through `cases`, since `consent_records` carries no
   * `employment_id` column of its own (see `findConsentArtifact()`'s header).
   * This is the ownership check's one read: a caller compares the returned
   * `employmentId` against the acting session's own before allowing a grant
   * or denial, the same "read it back, then compare" shape
   * `src/remoteui/roles.js`'s `evaluateConsentAuthorization()` uses.
   *
   * @param {string} id
   * @returns {Promise<(object & {employmentId: string})|null>}
   */
  async findConsentRecordById(id) {
    if (!id) return null;
    const local = this.consentRecords.find((r) => r.id === id);
    if (local) {
      const caseRow = this.cases.find((c) => c.id === local.caseId);
      return caseRow ? { ...local, employmentId: caseRow.employmentId } : null;
    }
    if (!this.pgPool) return null;
    const result = await this.pgPool.query(
      `select ${CONSENT_SELECT_COLUMNS}, c.employment_id as "employmentId"
         from consent_records cr
         join cases c on c.id = cr.case_id
        where cr.id = $1`,
      [id]
    );
    return result.rows[0] ?? null;
  }

  /**
   * L-13/L-19: every PENDING consent request that names THIS employment —
   * the employee's own read of "who is asking to be told about me, and I
   * have not yet answered". Scoped by employment id alone (unlike
   * `findConsentArtifact()` above), because the employee consenting needs to
   * see every outstanding ask, not one specific party+purpose combination.
   *
   * "Pending" here means neither granted-and-complete nor denied — the same
   * safe default `src/shared/consentArtifact.js` applies on the disclosure
   * side, applied here to what the employee is shown to act on.
   *
   * @param {string} employmentId
   * @returns {Promise<object[]>} oldest first, so the longest-waiting request
   *   is what the employee sees first (L-19)
   */
  async findConsentRequestsForEmployee(employmentId) {
    if (!employmentId) return [];
    if (this.pgPool) {
      const result = await this.pgPool.query(
        `select ${CONSENT_SELECT_COLUMNS}
           from consent_records cr
           join cases c on c.id = cr.case_id
          where c.employment_id = $1
            and cr.status not in ('granted', 'denied')
          order by cr.created_at asc`,
        [String(employmentId)]
      );
      return result.rows;
    }
    const caseIds = new Set(
      this.cases.filter((c) => String(c.employmentId) === String(employmentId)).map((c) => c.id)
    );
    return this.consentRecords
      .filter((r) => caseIds.has(r.caseId) && r.status !== "granted" && r.status !== "denied")
      .slice()
      .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  }

  /**
   * L-13: the employee's own act — grant or deny a specific pending consent
   * request. Writes the three facts invariant 13 was missing before L-7
   * existed: WHO decided (`grantedByEmploymentId`/`grantedBySignal` — an
   * authenticated signal, never a claim, matching the shape prime directive
   * #3 requires everywhere else) and WHEN (`grantedAt`, only ever set here,
   * never on creation). A denial sets the same "who decided" pair (the
   * employee acted, whether the answer was yes or no) but leaves `grantedAt`
   * null — nothing was ever GRANTED, so the column that means exactly that
   * stays empty. `caseStore.js`'s caller (src/portal/) is responsible for
   * checking the requester is the named employee BEFORE calling this; this
   * method itself does not re-check ownership, matching
   * `updateReviewQueueStatus()`'s own division of labour one method up.
   *
   * @param {string} id             the consent_records row id
   * @param {object} args
   * @param {"granted"|"denied"|"asserted"} args.status  "asserted" is D-28
   *   (rca-87ee): the THIRD PARTY says they hold the employee's written
   *   authorisation — not the employee's own act, so it can never satisfy
   *   `isConsentGranted()` (status must be exactly "granted"); it stays
   *   `isConsentPending()`'s safe default, same as an unanswered row.
   * @param {string|null} args.grantedByEmploymentId  null for "asserted" —
   *   nobody employee-side has acted yet.
   * @param {string} args.grantedBySignal
   * @param {string|null} [args.evidenceReference]  D-28: what the third party
   *   attached (a description or link to the authorisation they hold).
   *   `undefined`/omitted leaves the column untouched (`coalesce` below), so
   *   the existing employee grant/deny call sites are unaffected; an explicit
   *   value overwrites it.
   * @returns {Promise<boolean>} true if a row was updated in either backing
   */
  async updateConsentDecision(id, { status, grantedByEmploymentId, grantedBySignal, evidenceReference }) {
    const now = new Date().toISOString();
    const grantedAt = status === "granted" ? now : null;
    let touched = false;

    const row = this.consentRecords.find((r) => r.id === id);
    if (row) {
      row.status = status;
      row.grantedByEmploymentId = grantedByEmploymentId;
      row.grantedBySignal = grantedBySignal;
      row.grantedAt = grantedAt;
      if (evidenceReference !== undefined) row.evidenceReference = evidenceReference;
      touched = true;
    }

    if (this.pgPool) {
      const result = await this.pgPool.query(
        `update consent_records
            set status = $2, granted_by_employment_id = $3, granted_by_signal = $4, granted_at = $5,
                evidence_reference = coalesce($6, evidence_reference)
          where id = $1`,
        [id, status, grantedByEmploymentId, grantedBySignal, grantedAt, evidenceReference ?? null]
      );
      if (result.rowCount > 0) touched = true;
    }

    return touched;
  }

  /**
   * An uploaded file or external URL detected on a request. `extractionStatus`
   * defaults to "pending" honestly — as of this writing nothing in the app
   * actually extracts content from an artifact (see docs/BUILD-LOG.md
   * roadmap: URL pipeline / file pipeline are not built yet). This records
   * THAT an artifact was detected, not what it contains.
   * @param {object} args
   * @param {string} args.caseId
   * @param {string} args.artifactType   e.g. "PDF" | "IMAGE" | "URL"
   * @param {string} [args.source]       e.g. "zendesk_attachment"
   * @param {string} [args.storageReference]
   * @param {string} [args.originalFilename]
   * @param {string} [args.url]
   * @param {string} [args.extractionStatus]  default "pending"
   * @returns {object} the created request_artifacts row
   */
  createRequestArtifact({
    caseId,
    artifactType,
    source = null,
    storageReference = null,
    originalFilename = null,
    url = null,
    extractionStatus = "pending",
  }) {
    const now = new Date().toISOString();
    const row = {
      id: randomUUID(),
      createdAt: now,
      caseId,
      artifactType,
      source,
      storageReference,
      originalFilename,
      url,
      extractionStatus,
    };
    this.requestArtifacts.push(row);
    if (this.pgPool) {
      this.#insertChild(
        caseId,
        `insert into request_artifacts
           (id, created_at, case_id, artifact_type, source, storage_reference, original_filename, url, extraction_status)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          row.id,
          row.createdAt,
          row.caseId,
          row.artifactType,
          row.source,
          row.storageReference,
          row.originalFilename,
          row.url,
          row.extractionStatus,
        ],
        `request_artifact ${row.id}`
      );
    }
    return row;
  }

  /**
   * A per-field requirement pulled from an artifact (form/URL). NOTHING IN
   * THE APP CALLS THIS YET — it requires the URL/file extraction pipeline
   * (docs/BUILD-LOG.md roadmap), which doesn't exist. Built now so the
   * schema and store method are ready the moment that pipeline lands,
   * without another migration.
   * @param {object} args
   * @param {string} args.caseId
   * @param {string} args.fieldName
   * @param {boolean} [args.requested]
   * @param {string} [args.sensitivityLevel]  e.g. "low" | "medium" | "high"
   * @param {string} [args.policyStatus]      e.g. "approved" | "blocked" | "pending_review"
   * @param {string} [args.source]            e.g. "form_upload" | "url_form"
   * @returns {object} the created extracted_requirements row
   */
  createExtractedRequirement({
    caseId,
    fieldName,
    requested = true,
    sensitivityLevel = null,
    policyStatus = null,
    source = null,
  }) {
    const now = new Date().toISOString();
    const row = { id: randomUUID(), createdAt: now, caseId, fieldName, requested, sensitivityLevel, policyStatus, source };
    this.extractedRequirements.push(row);
    if (this.pgPool) {
      this.#insertChild(
        caseId,
        `insert into extracted_requirements
           (id, created_at, case_id, field_name, requested, sensitivity_level, policy_status, source)
         values ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [row.id, row.createdAt, row.caseId, row.fieldName, row.requested, row.sensitivityLevel, row.policyStatus, row.source],
        `extracted_requirement ${row.id}`
      );
    }
    return row;
  }

  // -------------------------------------------------------------------------
  // LOOKUPS — the read half. Used by the UC-03 API (and any future panel):
  // the workflow that created a case and the server that serves it can run in
  // DIFFERENT PROCESSES, so these check local memory first and then Postgres
  // when a pool is configured — the same pattern as DossierStore.findBy*/.
  // -------------------------------------------------------------------------

  /**
   * @param {string} id
   * @returns {Promise<object|null>} the case row, with jsonb columns coerced
   */
  async findById(id) {
    const local = this.cases.find((c) => c.id === id);
    if (local) return local;
    if (!this.pgPool) return null;
    const result = await this.pgPool.query(`select ${CASE_SELECT_COLUMNS} from cases where id = $1`, [id]);
    return result.rows[0] ? normalizeCaseRow(result.rows[0]) : null;
  }

  /**
   * Attach a Zendesk ticket id as this case's externalRef — the by-ticket
   * lookup the ZAF sidebar uses to find it.
   *
   * UC-01 never needs this: its case is CREATED from a ticket, so the ref is
   * known before the row is. It exists for the trigger-source direction
   * (00-FOUNDATION.md §2), where a request arrives from a Remote-side surface,
   * the gates run, and only then is a ticket raised from the outcome — the
   * order src/remoteui/ established and src/portal/ now follows for UC-03.
   * Same method and same reasoning as uc04/authorizationStore.js's.
   *
   * @param {string} id
   * @param {string} externalRef
   */
  /**
   * THE ONE LOOKUP A THIRD PARTY'S OWN REFERENCE STILL RESOLVES THROUGH, after
   * `linkTicket()` below has replaced `external_ref` with the Zendesk ticket id.
   *
   * Two lookups, in order, because a third-party case changes reference exactly
   * once in its life and both sides of that moment must resolve:
   *   1. `external_ref` — while the request is still awaiting consent, this IS
   *      the door's reference; nothing has relinked yet.
   *   2. `classification->>'doorReference'` — persisted at case creation
   *      (uc01/workflow.js STEP 6a) precisely so the relink cannot orphan it.
   *
   * SCOPED TO THE DOOR. A caller holding a Zendesk ticket id must not reach a
   * case through this method — it exists to answer an UNAUTHENTICATED enquirer
   * holding a `randomUUID()` capability, and widening it to any external_ref
   * would turn a guessable integer into the same key. Hence the source check on
   * both paths, and hence `null` rather than a thrown error on every miss: the
   * caller's response must not distinguish "no such reference" from "nothing to
   * report yet" (VC-33).
   *
   * @param {string} reference the UUID the door minted and printed on the ack
   * @returns {Promise<object|null>}
   */
  async findByDoorReference(reference) {
    const ref = String(reference ?? "").trim();
    if (!ref) return null;

    const localMatch = this.cases
      .filter(
        (c) =>
          c.source === "third_party_door" &&
          (String(c.externalRef) === ref || String(c.classification?.doorReference ?? "") === ref)
      )
      .pop();
    if (localMatch) return localMatch;
    if (!this.pgPool) return null;

    const result = await this.pgPool.query(
      `select id, created_at as "createdAt", external_ref as "externalRef", use_case as "useCase",
              source, employment_id as "employmentId", requester, classification, decision, reason,
              flags, status
         from cases
        where source = 'third_party_door'
          and (external_ref = $1 or classification->>'doorReference' = $1)
        order by created_at desc
        limit 1`,
      [ref]
    );
    const row = result.rows[0];
    if (!row) return null;
    return { ...row, classification: coerceJson(row.classification, {}), flags: coerceJson(row.flags, []) };
  }

  /**
   * The letter itself, content included — the one read in this file that
   * returns a document body. Every other document reader (review/store.js)
   * deliberately omits `content`; this one exists to hand the document to the
   * party a specialist approved disclosing it to, so the body IS the answer.
   *
   * @param {string} caseId
   * @returns {Promise<{id:string,createdAt:string,type:string,content:string,contentHash:string}|null>}
   */
  async findLetterForCase(caseId) {
    const local = this.documents
      .filter((d) => d.caseId === caseId && d.type === "employment_verification_letter")
      .pop();
    if (local) return local;
    if (!this.pgPool) return null;

    const result = await this.pgPool.query(
      `select id, created_at as "createdAt", case_id as "caseId", type, content,
              content_hash as "contentHash"
         from documents
        where case_id = $1 and type = 'employment_verification_letter'
        order by created_at desc
        limit 1`,
      [caseId]
    );
    return result.rows[0] ?? null;
  }

  async linkTicket(id, externalRef) {
    const now = new Date().toISOString();
    const local = this.cases.find((c) => c.id === id);
    if (local) {
      local.externalRef = String(externalRef);
      local.updatedAt = now;
    }
    if (this.pgPool) {
      await this.pgPool.query(`update cases set external_ref = $2, updated_at = $3 where id = $1`, [
        id,
        String(externalRef),
        now,
      ]);
    }
    return this.findById(id);
  }

  /**
   * Newest case for a ticket — a ticket could in principle generate more than
   * one request over time, same "newest, not the only one" reasoning as the
   * UC-06/UC-08 stores.
   * @param {string} externalRef
   * @returns {Promise<object|null>}
   */
  async findByExternalRef(externalRef, useCase = null) {
    // SCOPE BY USE CASE. `cases` is shared — UC-01 and UC-03 both write to it —
    // so a ticket id alone is not a unique key. Without the filter, UC-03's
    // /api/cases/by-ticket/:ref returned a UC-01 employment-verification case
    // and its panel presented it as a travel/workation case: one ticket, one
    // row, the wrong use case reading it.
    //
    // This project already reasoned this out one table over and got it right:
    // `workflow_claims` is keyed (use_case, external_ref) precisely "because
    // one ticket may legitimately reach two use cases (UC-03 routes on to
    // UC-04)". The same argument applies here and had not been applied.
    //
    // Optional rather than required so no existing caller silently changes
    // behaviour — but every caller in this repo passes it, and a test pins
    // that, because an optional guard nobody uses is not a guard.
    const localMatches = this.cases.filter(
      (c) => String(c.externalRef) === String(externalRef) && (useCase === null || c.useCase === useCase)
    );
    if (localMatches.length) return localMatches[localMatches.length - 1];
    if (!this.pgPool) return null;
    const result = await this.pgPool.query(
      useCase === null
        ? `select ${CASE_SELECT_COLUMNS} from cases where external_ref = $1 order by created_at desc limit 1`
        : `select ${CASE_SELECT_COLUMNS} from cases where external_ref = $1 and use_case = $2 order by created_at desc limit 1`,
      useCase === null ? [String(externalRef)] : [String(externalRef), String(useCase)]
    );
    return result.rows[0] ? normalizeCaseRow(result.rows[0]) : null;
  }

  /**
   * All cases for one use case (e.g. "UC-03"), newest first — the source for
   * a per-use-case dashboard queue. When a pgPool is configured, Postgres is
   * treated as the authoritative list (the same "different processes" reason
   * findById/findByExternalRef check it): the workflow that created a case
   * and the dashboard reading it back can be separate processes, and the
   * in-memory array only ever holds what THIS process has created. Without a
   * pgPool, the in-memory array is the only copy there is.
   * @param {string} useCase
   * @returns {Promise<object[]>}
   */
  async listByUseCase(useCase) {
    if (this.pgPool) {
      const result = await this.pgPool.query(
        `select ${CASE_SELECT_COLUMNS} from cases where use_case = $1 order by created_at desc`,
        [useCase]
      );
      return result.rows.map(normalizeCaseRow);
    }
    return this.cases.filter((c) => c.useCase === useCase).slice().reverse();
  }

  /**
   * The cases ONE requester owns, newest first — the read behind the portal's
   * "My requests" (src/portal/server.js).
   *
   * `useCase` IS PART OF THE SCOPE, AND LEAVING IT OUT IS A REAL BUG, not a
   * loose end. `cases` is shared: UC-01 and UC-03 both write to it. Scope by
   * employment alone and an employee's UC-01 employment-verification case is
   * returned to the portal as one of their UC-03 travel requests, where
   * describeStatus("uc03", …) is handed a row whose status vocabulary belongs
   * to a different workflow — it reports `unknown`, which reads as "we lost
   * your request". This store already reasoned exactly this out one method
   * over (findByExternalRef's use-case scoping) and the same argument applies
   * here.
   *
   * @param {object} scope
   * @param {string|null} [scope.employmentId]
   * @param {string|null} [scope.requester]
   * @param {string|null} [scope.useCase]  e.g. "UC-03" — see above
   * @param {string|null} [scope.source]   e.g. "portal"
   * @param {number} [scope.limit]
   * @returns {Promise<object[]>}
   */
  async listByOwner({ employmentId = null, requester = null, useCase = null, source = null, limit = 50 } = {}) {
    // Fail closed: an unscoped call lists nobody's rows, never everybody's.
    if (!employmentId && !requester) return [];
    if (!this.pgPool) {
      return this.cases
        .filter((c) => (useCase === null || c.useCase === useCase) && matchesOwner(c, { employmentId, requester, source }))
        .slice()
        .reverse()
        .slice(0, limit);
    }
    await this.flush();
    const params = [];
    const conditions = [];
    for (const [column, value] of [
      ["employment_id", employmentId],
      ["requester", requester],
      ["use_case", useCase],
      ["source", source],
    ]) {
      if (!value) continue;
      params.push(String(value));
      conditions.push(`${column} = $${params.length}`);
    }
    params.push(limit);
    const result = await this.pgPool.query(
      `select ${CASE_SELECT_COLUMNS} from cases where ${conditions.join(" and ")} order by created_at desc limit $${params.length}`,
      params
    );
    return result.rows.map(normalizeCaseRow);
  }

  // -------------------------------------------------------------------------
  // MUTATIONS — the "current state changes" half of this store
  // -------------------------------------------------------------------------
  // Everything above CREATES a row and returns immediately, writing to Postgres
  // in the background with errors swallowed. The two methods below are async
  // and let failures throw, because their only caller is a human clicking
  // Approve/Deny in the ZAF sidebar and being told the outcome. Same reasoning
  // as AuditLogger.logDurable() — see that comment.
  //
  // Neither requires the row to be present in the in-memory arrays. The review
  // API normally runs as a SEPARATE PROCESS from the workflow that created the
  // case, so its CaseStore starts empty and Postgres is the only place the row
  // exists. They therefore update whichever of the two backings actually has
  // it, and only report "not found" when neither did.
  // -------------------------------------------------------------------------

  /**
   * Move a case to a new lifecycle status (e.g. "pending_review" → "resolved").
   * @param {string} caseId
   * @param {string} status
   * @returns {Promise<boolean>} true if a row was updated in either backing
   */
  async updateCaseStatus(caseId, status) {
    const now = new Date().toISOString();
    let touched = false;

    const row = this.cases.find((c) => c.id === caseId);
    if (row) {
      row.status = status;
      row.updatedAt = now;
      touched = true;
    }

    if (this.pgPool) {
      const result = await this.pgPool.query(
        `update cases set status = $2, updated_at = $3 where id = $1`,
        [caseId, status, now]
      );
      if (result.rowCount > 0) touched = true;
    }

    return touched;
  }

  /**
   * G-4/F1/VC-32 Amendment 2: record that the word-identical "could not
   * obtain permission" notice was sent for a third-party-door case, WITHOUT
   * touching `status` in either direction — A5 forbids any state transition
   * on elapsed time alone, and this is a communication marker, not a
   * decision. Idempotency for the sweep lives here: a case with this already
   * set is never notified twice (see src/thirdparty/agedNotice.js).
   * @param {string} caseId
   * @param {string} at  ISO timestamp
   * @returns {Promise<boolean>} true if a row was updated in either backing
   */
  async markAgedNoticeSent(caseId, at) {
    let touched = false;

    const row = this.cases.find((c) => c.id === caseId);
    if (row) {
      row.agedNoticeSentAt = at;
      touched = true;
    }

    if (this.pgPool) {
      const result = await this.pgPool.query(
        `update cases set aged_notice_sent_at = $2 where id = $1`,
        [caseId, at]
      );
      if (result.rowCount > 0) touched = true;
    }

    return touched;
  }

  /**
   * D-12 (rca-kfg2): record the outcome of the manual, out-of-band send a
   * third-party-door disclosure's internal note instructs a specialist to
   * perform, once approved — never a send this system performs itself (an
   * unattended email to an outside party is exactly the execution a 🟢 use
   * case with a human disclosure gate should not grow), only a durable answer
   * to "did it happen". Same "communication marker, not a state transition"
   * shape as `markAgedNoticeSent()` above: `status` is untouched in either
   * direction, and this can be recorded on a case regardless of what stage
   * of its own review lifecycle it is in.
   *
   * Idempotent by convention rather than by constraint: a case with
   * `manualSendStatus` already set can be recorded over (a specialist
   * correcting their own entry), but `src/review/service.js`'s
   * `submitManualSendRecord()` is the caller that decides whether to refuse
   * a second recording — this method itself does not gate that, matching
   * `updateCaseStatus()`/`updateReviewQueueStatus()`'s own division of labour
   * (mutation here, policy at the call site).
   *
   * @param {string} caseId
   * @param {object} args
   * @param {string} args.status  "sent" | "could_not_send"
   * @param {string} args.by      the approver identity recording this
   * @param {string|null} [args.note]  required by the caller when status is
   *   "could_not_send" — this method itself accepts either
   * @param {string} args.at      ISO timestamp
   * @returns {Promise<boolean>} true if a row was updated in either backing
   */
  async recordManualSend(caseId, { status, by, note = null, at }) {
    let touched = false;

    const row = this.cases.find((c) => c.id === caseId);
    if (row) {
      row.manualSendStatus = status;
      row.manualSendAt = at;
      row.manualSendBy = by;
      row.manualSendNote = note;
      touched = true;
    }

    if (this.pgPool) {
      const result = await this.pgPool.query(
        `update cases set manual_send_status = $2, manual_send_at = $3, manual_send_by = $4, manual_send_note = $5 where id = $1`,
        [caseId, status, at, by, note]
      );
      if (result.rowCount > 0) touched = true;
    }

    return touched;
  }

  /**
   * Record a specialist's verdict on a case's review_queue row. `status` is
   * "approved" | "rejected" — the exact vocabulary src/metrics/compute.js
   * counts to produce the HITL accept rate, so this is what turns that metric
   * from a definition into a measurement.
   * @param {string} caseId
   * @param {object} args
   * @param {string} args.status
   * @param {string|null} [args.assignee]  who decided it
   * @param {string|null} [args.notes]
   * @returns {Promise<boolean>} true if a row was updated in either backing
   */
  async updateReviewQueueStatus(caseId, { status, assignee = null, notes = null }) {
    const now = new Date().toISOString();
    let touched = false;

    const row = this.reviewQueue.find((r) => r.caseId === caseId);
    if (row) {
      row.status = status;
      row.assignee = assignee;
      row.notes = notes;
      row.updatedAt = now;
      touched = true;
    }

    if (this.pgPool) {
      const result = await this.pgPool.query(
        `update review_queue
            set status = $2, assignee = $3, notes = $4, updated_at = $5
          where case_id = $1`,
        [caseId, status, assignee, notes, now]
      );
      if (result.rowCount > 0) touched = true;
    }

    return touched;
  }

  /**
   * The `review_queue` status for one case, or `null` when no entry exists —
   * the same "no entry vs. an entry" distinction `src/approvalqueue/
   * awaiting.js`'s `queueStatus` parameter already reads, reused here rather
   * than re-derived (see src/thirdparty/agedNotice.js).
   * @param {string} caseId
   * @returns {Promise<string|null>}
   */
  async findReviewQueueStatus(caseId) {
    const local = this.reviewQueue.find((r) => r.caseId === caseId);
    if (local) return local.status;
    if (!this.pgPool) return null;
    const result = await this.pgPool.query(`select status from review_queue where case_id = $1`, [caseId]);
    return result.rows[0]?.status ?? null;
  }

  /** Await any DB writes still in flight — call before reading rows back. */
  async flush() {
    await Promise.allSettled(this.pending);
    this.pending = [];
  }

  /**
   * Claim exclusive ownership of an external reference (a Zendesk ticket id),
   * so exactly one caller may act on it.
   *
   * WHY THIS EXISTS - see src/uc01/workflow.js's call site. Real ticket #5 was
   * delivered three times within microseconds and the customer received two
   * verification letters. Application-level "check then write" cannot fix that:
   * both callers read "not yet processed" before either wrote. The claim is a
   * PRIMARY KEY insert, so Postgres itself decides the winner.
   *
   * Degrades safely. With no pgPool (tests, offline demos, the playground) an
   * in-memory Set gives the same semantics within one process, and a fresh
   * process starts clean - correct for a demo, and honestly weaker than the
   * database guarantee, which is why the real path passes a pool.
   *
   * SCOPED BY USE CASE, deliberately. The ledger's key is
   * (use_case, external_ref), not external_ref alone, because one Zendesk
   * ticket can legitimately reach more than one use case - UC-03 routes a
   * workation inquiry on to UC-04, and each must be free to claim it. Keying on
   * the ref alone would make the second use case look like a duplicate of the
   * first and silently drop it.
   *
   * @param {string} externalRef
   * @param {string} [decision]  recorded for operators diagnosing a duplicate
   * @param {string} [useCase]   which use case is claiming, e.g. "UC-01"
   * @returns {Promise<{claimed: boolean, existingCaseId?: string|null}>}
   */
  async claimExternalRef(externalRef, decision = null, useCase = "UC-01") {
    const ref = String(externalRef);
    const key = `${useCase}:${ref}`;
    if (!this._claimedRefs) this._claimedRefs = new Set();

    if (!this.pgPool) {
      if (this._claimedRefs.has(key)) return { claimed: false, existingCaseId: null };
      this._claimedRefs.add(key);
      return { claimed: true };
    }

    try {
      // ON CONFLICT DO NOTHING makes this one atomic statement: rowCount is 1
      // for the winner and 0 for every loser, with no read-then-write gap for
      // a concurrent caller to slip through.
      //
      // `workflow_claims` replaced `uc01_processed_refs` so that the Node path
      // and the n8n path share ONE ledger. While they had one each, the same
      // ticket processed by both still duplicated - each saw an unclaimed ref.
      const res = await this.pgPool.query(
        `insert into workflow_claims (use_case, external_ref, decision)
         values ($1, $2, $3)
         on conflict (use_case, external_ref) do nothing
         returning external_ref`,
        [useCase, ref, decision]
      );
      if (res.rowCount === 1) return { claimed: true };
      const existing = await this.pgPool.query(
        `select id from cases where external_ref = $1 limit 1`,
        [ref]
      );
      return { claimed: false, existingCaseId: (existing.rows[0] && existing.rows[0].id) || null };
    } catch (err) {
      // A claim failure must not silently become "claimed" without being seen.
      // Refusing would drop a real customer request whenever the ledger is
      // unavailable; proceeding risks a duplicate letter. Proceeding is the
      // lesser harm - a duplicate letter is embarrassing, a lost verification
      // request is not recoverable by the customer - but it is logged loudly
      // so the degraded condition is visible instead of silent.
      console.error(`[caseStore] idempotency claim failed for ${ref}, proceeding without it:`, err.message);
      return { claimed: true, degraded: true };
    }
  }

}

const CASE_SELECT_COLUMNS = `
  id,
  created_at        as "createdAt",
  updated_at        as "updatedAt",
  use_case          as "useCase",
  source,
  external_ref      as "externalRef",
  employment_id     as "employmentId",
  requester,
  classification,
  ticket_text       as "ticketText",
  decision,
  reason,
  flags,
  status,
  return_address     as "returnAddress",
  aged_notice_sent_at as "agedNoticeSentAt",
  manual_send_status as "manualSendStatus",
  manual_send_at     as "manualSendAt",
  manual_send_by     as "manualSendBy",
  manual_send_note   as "manualSendNote"`;

const CONSENT_SELECT_COLUMNS = `
  cr.id,
  cr.created_at                  as "createdAt",
  cr.case_id                     as "caseId",
  cr.consent_type                as "consentType",
  cr.status,
  cr.source,
  cr.evidence_reference          as "evidenceReference",
  cr.requesting_party            as "requestingParty",
  cr.purpose,
  cr.granted_by_employment_id    as "grantedByEmploymentId",
  cr.granted_by_signal           as "grantedBySignal",
  cr.granted_at                  as "grantedAt"`;

/**
 * Consent-party/purpose comparison: trimmed, case-insensitive equality. Both
 * sides absent (`null`/`null`) is NEVER a match — an unscoped question cannot
 * have a scoped answer, the same fail-closed shape `matches()` in
 * `src/remoteui/roles.js` uses for the identical reason.
 */
function matchesParty(a, b) {
  if (a === null || a === undefined || b === null || b === undefined) return false;
  return String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
}

/** Coerce jsonb columns some driver/column combinations hand back as a JSON string. */
function normalizeCaseRow(row) {
  return {
    ...row,
    // The one place a `cases` row from Postgres becomes an in-memory row, and
    // therefore the one place the pre-2026-08-19 `denied` status is
    // canonicalised to `declined` (src/shared/declineVocabulary.js). A
    // read-side alias rather than a data migration, so it holds whether or not
    // anyone ever runs the optional SQL in docs/SETUP-CHECKLIST.md. Any status
    // that is not the legacy spelling passes through untouched.
    status: canonicalDecisionStatus(row.status),
    classification: coerceJson(row.classification, null),
    flags: coerceJson(row.flags, []),
  };
}

function coerceJson(value, fallback) {
  if (value === null || value === undefined) return fallback;
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}
