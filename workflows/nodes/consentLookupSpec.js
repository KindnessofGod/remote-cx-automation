// ---------------------------------------------------------------------------
// consentLookupSpec.js — the single versioned source of truth for the
// "Lookup Consent Records" Supabase node on UC-01's live graph
// (WORKFLOW_UC01_ID)
// ---------------------------------------------------------------------------
// WHY THIS EXISTS (rca-wn30 / R7-18 / D-11, authorised by
// qa/HUMAN-DECISIONS-REQUIRED.md §K4)
//
// 22 of 100 live feed rows carried `identity_awaiting_employee_consent` and
// NONE carried a `consentRecordId`, while the row's own prose told the
// reviewer to "see the consent request's own age before assuming it needs a
// nudge". `workflows/nodes/gates.js` emits
// `consentRecordId: consentRecord ? consentRecord.id : null`, and an
// enumeration of all 37 live nodes found NO Supabase node reading
// `consent_records` anywhere and nothing at all between "Fetch Employment
// (Remote)" and "Identity + Policy Gates". So `ctx.consentRecord` was always
// undefined on the live path and the field was always null — the blocker
// CLAUDE.md §4 names as L-15/L-20/L-21, measured.
//
// K4 declined the cheap branch (stop printing the un-followable prose) and
// authorised ONE production graph-SHAPE change: this node, on this graph.
// It is not a licence to edit the graph generally and it authorises no other
// node, which is why BOTH of gates.js's reads (the scoped deciding artifact
// and the unscoped pending pointer) are served from this one node's rows.
//
// WHY IT SITS WHERE IT SITS
//   Fetch Employment (Remote) -> Lookup Consent Records -> Identity + Policy Gates
// After the employment fetch, because a lookup that runs before it would have
// to be re-ordered again the day anything wants to scope by a fact on the
// record. Before the gates, because the gates are the only consumer, and
// because "before Identity + Policy Gates" is the literal scope of the
// authorisation. gates.js therefore reads the employment response by NAME
// (`$('Fetch Employment (Remote)').first()`) rather than off `$input`, which
// this node now occupies — see readEmploymentResponse() there.
//
// WHY A RAW POSTGREST FILTER STRING AND NOT THE MANUAL CONDITION BUILDER
// `consent_records` carries NO employment id of its own. Its only link to an
// employment is `case_id` -> `cases.employment_id` (migrations/0001's own
// header: "employment ids are Remote's, this database does not hold that
// table"), so the lookup is a JOIN, and the manual builder can only express
// column-on-this-table conditions. PostgREST expresses the join as an
// embedded resource — `cases!inner(employment_id)` plus
// `cases.employment_id=eq.…` — which needs the string filter. The FK it
// resolves through is `consent_records_case_id_fkey`, verified live on
// project your-project-ref.
//
// WHY THE EMPLOYMENT ID IS SCRUBBED IN THE EXPRESSION
// The id reaches this node from a Zendesk custom field, i.e. from something a
// human typed. A PostgREST filter value is not parameterised — a comma or a
// parenthesis in it re-shapes the query rather than failing it. The
// expression strips everything outside `[A-Za-z0-9_-]`, which every real
// employment id (a UUID) survives untouched and every injection attempt does
// not. A scrubbed-to-nothing id matches no row, which lands on the pending
// default: the safe direction.
//
// WHY alwaysOutputData AND onError MATTER MORE THAN THE FILTER DOES
// A Supabase getAll that matches nothing emits ZERO items, and a node with
// zero items ends the branch — "Identity + Policy Gates" would never run and
// UC-01 would answer nothing at all for every ticket whose employee has no
// consent row, which is nearly all of them. `alwaysOutputData: true` makes it
// emit one empty item instead. `onError: "continueRegularOutput"` does the
// same job for an unreachable Supabase. gates.js drops both shapes (neither
// carries an `id`) and treats them as "no rows" — pending, never a
// disclosure. These two flags are load-bearing, and the checker below asserts
// them for that reason.
//
// SAME "no jsCode" SHAPE AS ITS SIBLINGS ("Persist Document", "Append Audit
// Log", "Update Audit Log With Letter", "Route by Decision", the webhook
// trigger) — scripts/verify-deployed-nodes.mjs's jsCode-diffing MAPPINGS is
// structurally blind to a Supabase node, so this file plus the
// STRUCTURAL_MAPPINGS row that reads it (scripts/lib/deployedNodeMappings.mjs)
// and test/n8nConsentLookupParity.test.js are the guard — shipped WITH the
// node, not as a follow-up bead.
// ---------------------------------------------------------------------------

export const NODE_NAME = "Lookup Consent Records";
export const NODE_TYPE = "n8n-nodes-base.supabase";
export const TABLE_ID = "consent_records";
export const RESOURCE = "row";
export const OPERATION = "getAll";

/** Immediately upstream on the live graph. */
export const UPSTREAM_NODE = "Fetch Employment (Remote)";

/**
 * Immediately downstream — the node this whole change exists to feed. Nothing
 * else may be spliced between the two: a Code node in between would replace
 * `$input` again, and gates.js reads the rows by name, so the only thing that
 * would break is silent (rows unreachable -> every consentRecordId null
 * again, exactly R7-18 returning).
 */
export const DOWNSTREAM_NODE = "Identity + Policy Gates";

/** The columns caseStore.js's CONSENT_SELECT_COLUMNS reads, plus the join. */
export const SELECT_COLUMNS = [
  "id",
  "created_at",
  "case_id",
  "consent_type",
  "status",
  "source",
  "evidence_reference",
  "requesting_party",
  "purpose",
  "granted_by_employment_id",
  "granted_by_signal",
  "granted_at",
  "cases!inner(employment_id)",
].join(",");

/**
 * The expression that scrubs the employment id before it becomes part of a
 * PostgREST filter. Read from "Validate Classification" by name rather than
 * off `$json`, because `$json` here is the employment fetch's response and
 * carries no `employmentId` at all.
 */
export const EMPLOYMENT_ID_EXPRESSION =
  "String($('Validate Classification').first().json.employmentId || '').replace(/[^A-Za-z0-9_-]/g, '')";

/**
 * Oldest first — L-19's rule ("the longest-waiting request is what the
 * employee sees first"), which is also what makes gates.js's
 * `oldestPendingConsentRequest()` a single forward scan rather than a sort.
 */
export const ORDER_BY = "created_at.asc";

export const FILTER_TYPE = "string";
export const FILTER_STRING =
  `=select=${SELECT_COLUMNS}` +
  `&cases.employment_id=eq.{{ ${EMPLOYMENT_ID_EXPRESSION} }}` +
  `&order=${ORDER_BY}`;

/**
 * A read, so a cap rather than a page loop: an employee with more consent
 * rows than this has a bigger problem than pagination, and `returnAll` would
 * make one Zendesk ticket issue an unbounded number of PostgREST requests.
 */
export const RETURN_ALL = false;
export const LIMIT = 50;

/**
 * The n8n Supabase node's OWN defaults for the three parameters above whose
 * wanted value happens to EQUAL the default. That coincidence is a trap — the
 * same one webhookResponseSpec.js's RESPONSE_MODE_NODE_DEFAULT documents
 * (f5336c3), and it cost a false "3 drifted nodes" reading on 2026-08-28.
 *
 * n8n PRUNES any parameter equal to the node default before saving, so a node
 * saved THROUGH THE EDITOR stores no `resource`, `returnAll` or `limit` key at
 * all, even though scripts/deploy-uc01-consent-lookup.mjs wrote all three
 * explicitly via an API PUT (which prunes nothing). Live on
 * WORKFLOW_UC01_ID as of 2026-08-28 this node's parameter keys are exactly
 * `["operation","tableId","filterType","filterString"]` — the two NON-default
 * values (`operation: "getAll"`, `filterType: "string"`) survived, the three
 * default-valued ones did not. Defaults pruned, non-defaults retained: the
 * editor's signature, not a misconfiguration.
 *
 * Values confirmed against n8n's own source on 2026-08-28 (the Supabase node
 * is unversioned; typeVersion 1 is the only version):
 *   - Supabase.node.ts     `resource`  default 'row'
 *   - RowDescription.ts    `returnAll` default false
 *   - RowDescription.ts    `limit`     default 50
 * And behaviourally: execution 9592 (unpinned) ran this exact pruned node and
 * it returned 3 `consent_records` rows — a row:getAll that resolved `resource`
 * from the default and executed normally.
 *
 * So: ABSENT MEANS DEFAULT, never "unset". Read through these constants.
 */
export const RESOURCE_NODE_DEFAULT = "row";
export const RETURN_ALL_NODE_DEFAULT = false;
export const LIMIT_NODE_DEFAULT = 50;

/**
 * Node-type-specific check for `structuralNodeIssues()`
 * (scripts/lib/structuralNodeChecks.mjs). Modelled on
 * `updateAuditLogWithLetterParamIssues` (workflows/nodes/updateAuditLogWithLetterSpec.js).
 *
 * @param {object} node the live "Lookup Consent Records" node
 * @returns {string[]} issue descriptions; empty means the node matches
 */
export function consentLookupParamIssues(node) {
  const issues = [];
  const p = node?.parameters ?? {};
  if (p.tableId !== TABLE_ID) issues.push(`tableId is ${JSON.stringify(p.tableId)}, expected ${JSON.stringify(TABLE_ID)}`);
  // `?? *_NODE_DEFAULT` on the three parameters n8n prunes — see those
  // constants. An absent key is a default-valued parameter the editor dropped,
  // NOT an unset one. `??` fills only `undefined`/`null`, so an explicitly
  // wrong value (resource off "row", returnAll true, limit 1000) still fails.
  const resource = p.resource ?? RESOURCE_NODE_DEFAULT;
  if (resource !== RESOURCE) {
    issues.push(
      `resource is ${JSON.stringify(p.resource)} (effectively ${JSON.stringify(resource)}), ` +
        `expected ${JSON.stringify(RESOURCE)}`
    );
  }
  // NOT read through a default: "getAll" is not the Supabase node's default
  // operation ("create" is), so an absent key here really would be a rebuild
  // into a node that WRITES a consent row. Strict on purpose.
  if (p.operation !== OPERATION) issues.push(`operation is ${JSON.stringify(p.operation)}, expected ${JSON.stringify(OPERATION)}`);
  if (p.filterType !== FILTER_TYPE) issues.push(`filterType is ${JSON.stringify(p.filterType)}, expected ${JSON.stringify(FILTER_TYPE)}`);
  if (p.filterString !== FILTER_STRING) {
    issues.push(`filterString is ${JSON.stringify(p.filterString)}, expected ${JSON.stringify(FILTER_STRING)}`);
  }
  const returnAll = p.returnAll ?? RETURN_ALL_NODE_DEFAULT;
  if (returnAll !== RETURN_ALL) {
    issues.push(
      `returnAll is ${JSON.stringify(p.returnAll)} (effectively ${JSON.stringify(returnAll)}), ` +
        `expected ${JSON.stringify(RETURN_ALL)}`
    );
  }
  const limit = p.limit ?? LIMIT_NODE_DEFAULT;
  if (limit !== LIMIT) {
    issues.push(
      `limit is ${JSON.stringify(p.limit)} (effectively ${JSON.stringify(limit)}), ` +
        `expected ${JSON.stringify(LIMIT)}`
    );
  }

  // The two flags that keep a miss from becoming an outage. See the header:
  // without `alwaysOutputData` a zero-row lookup ends the branch and the gates
  // never run; without `continueRegularOutput` an unreachable Supabase does
  // the same. Checked here because both are node-level fields rather than
  // parameters, and both are invisible to every other guard in this repo.
  if (node?.alwaysOutputData !== true) {
    issues.push(
      `alwaysOutputData is ${JSON.stringify(node?.alwaysOutputData)}, expected true — ` +
        `without it a zero-row lookup emits no items and "${DOWNSTREAM_NODE}" never runs`
    );
  }
  if (node?.onError !== "continueRegularOutput") {
    issues.push(
      `onError is ${JSON.stringify(node?.onError)}, expected "continueRegularOutput" — ` +
        `without it an unreachable Supabase stops the whole decision`
    );
  }

  return issues;
}
