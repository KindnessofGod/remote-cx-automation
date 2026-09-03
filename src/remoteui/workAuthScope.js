// ---------------------------------------------------------------------------
// workAuthScope.js  —  WHICH work-authorization requests may this admin decide?
// ---------------------------------------------------------------------------
// THE COMPANY BOUNDARY, AND WHY IT IS SHAPED LIKE THIS
//
// A `WorkAuthorizationRequest` carries NO employment reference on the wire.
// Remote's own list endpoint nevertheless documents an `employment_id` filter,
// which its server resolves internally (src/remote/mockServer.js keeps its
// index outside the record for exactly this reason). So there is no field on a
// returned request that says whose company it belongs to, and an UNFILTERED
// list cannot be company-scoped at all.
//
// That constraint is what makes the enforcement here sound rather than
// decorative. The set of requests an admin may see is built the only way it
// can be:
//
//   1. take the company from the SERVER-OWNED SESSION (src/remoteui/server.js's
//      DEMO_SESSIONS, resolved from a header key that is looked up, never
//      trusted — a POST that names its own company proves nothing);
//   2. read each candidate employment back from Remote and keep only those
//      whose `company_id` equals it;
//   3. ask Remote for the pending requests of those employments and no others.
//
// Nothing a caller sends reaches any of those three steps. There is no
// argument, query parameter or body field on this path through which a company
// id, an employment id or a role can be supplied — which is the difference
// between a boundary and a filter the caller can move.
//
// FAILS CLOSED, in the direction that costs a demo rather than a disclosure. An
// employment that cannot be read is EXCLUDED and named in `unreadable`; an
// unreadable scope is not an empty one, and it is certainly not a permissive
// one. `null === null` must never pass for a match — that exact defect passed
// for a verified identity in four n8n gates (CLAUDE.md §4).
//
// ONE READ PER CANDIDATE EMPLOYMENT is deliberate and is the cost of the
// paragraph above. It is cheap against the in-process mock this surface uses,
// and against a real Sandbox it is the only correct shape, because a single
// unfiltered list would hand back rows this surface cannot attribute to anyone.
// ---------------------------------------------------------------------------

import { PERSONAS } from "../portal/personas.js";
import { DECIDABLE_STATUS } from "./workAuthPolicy.js";
import {
  RECORD_ORIGIN,
  assessmentOf,
  bySubmittedAtDesc,
  decidedSlot,
  offSchemaFactorsOf,
  activityProfileOf,
  oneLineLabel,
  toWorkAuthorizationShape,
  whyNotForEmployer,
  measurementsOf,
} from "./workAuthRecords.js";

/**
 * The employments this surface will ask Remote about.
 *
 * Derived from the request portal's personas rather than restated, and the
 * derivation is the point: a second roster is a second thing to drift, and this
 * repository has already paid for one — src/approvalqueue/demoSeed.js kept its
 * own copy of nine Zendesk group ids, `npm run sync-groups` updated the
 * registry, and the queue's headline claim was then manufactured by a stale
 * constant (CLAUDE.md §4).
 *
 * Every id here is a REAL Remote Sandbox employment id (the personas' own
 * header records which four facts on each were captured live), so a reviewer
 * can cross-check one against their own account. The RECORD behind it is this
 * repo's mock whenever this surface is pointed at the mock, which is the same
 * promise the portal makes and for the same reason: a publicly reachable page
 * must not read or write a real Remote account.
 *
 * NOT `src/remoteui/employees.js`. That roster exists for UC-06's contract
 * amendment and is chosen for which countries publish an amendment FORM — a
 * property with nothing to do with work authorization, and one that leaves out
 * the person this boundary is demonstrated with.
 *
 * @returns {Array<{employmentId: string, name: string}>}
 */
export function workAuthorizationRoster() {
  return Object.values(PERSONAS)
    .filter((p) => p.kind === "employee" && p.employmentId)
    .map((p) => ({ employmentId: p.employmentId, name: p.name }));
}

/**
 * Resolve everything an admin session is allowed to act on.
 *
 * @param {object} args
 * @param {object|null} args.session  server-owned {role, companyId, ...}
 * @param {object} args.remote        the Remote client this surface reads in
 * @param {object} args.standin       createWorkAuthorizationStandin()'s store
 * @param {object|null} [args.authorizationStore]  UC-04's own store — the
 *   requests really filed on this system's intake surfaces. Optional so a caller
 *   that has none still gets the other two sources; its absence is REPORTED
 *   (`recordProbe.verdict === "unavailable"`) rather than rendering as an empty
 *   screen, because "nothing was filed" and "we never looked" are the two
 *   answers this whole surface exists to keep apart.
 * @param {Array<{employmentId: string, name: string}>} [args.roster]
 * @returns {Promise<{
 *   companyId: string|null,
 *   employments: Array<{employmentId: string, name: string, inCompany: boolean, observedCompanyId: string|null}>,
 *   requests: object[],
 *   allRequests: object[],
 *   recordIds: Set<string>,
 *   unreadable: string[],
 *   standinUnattributed: Array<{id: string, employmentId: string|null, observedCompanyId: string|null, reason: string}>,
 *   scopeVerdict: {state: string, detail: string},
 *   remoteProbe: {
 *     endpoint: string, employmentsQueried: number, rowsReturned: number,
 *     failures: Array<{employmentId: string, message: string}>,
 *     asked: boolean, verdict: "answered"|"nothing_to_ask"|"unavailable", detail: string
 *   }
 * }>}
 */
export async function resolveEmployerScope({
  session,
  remote,
  standin,
  authorizationStore = null,
  roster = workAuthorizationRoster(),
}) {
  const companyId = session?.companyId ?? null;
  if (!companyId) {
    return {
      companyId,
      employments: [],
      requests: [],
      allRequests: [],
      recordIds: new Set(),
      unreadable: [],
      standinUnattributed: [],
      recordsNotForEmployer: [],
      scopeVerdict: {
        state: "no_company_on_session",
        detail: "This session carries no company, so there is nothing it can be scoped to. Nothing was asked.",
      },
      remoteProbe: probeVerdict({ canList: false, queried: 0, rowsReturned: 0, failures: [] }),
      recordProbe: recordProbeVerdict({
        canList: typeof authorizationStore?.listForEmployments === "function",
        queried: 0,
        rowsReturned: 0,
        shown: 0,
        failure: null,
        displacedByRemote: [],
      }),
    };
  }

  const employments = [];
  const unreadable = [];

  for (const entry of roster) {
    let record = null;
    try {
      record = await remote.getEmployment(entry.employmentId);
    } catch (err) {
      // A throw is a 403/5xx/transport failure — the question was never
      // answered. Different from a 404, which IS an answer, and different again
      // from a record that answered with another company.
      unreadable.push(`${entry.name} (${entry.employmentId}): ${err.message}`);
      continue;
    }
    if (!record) {
      unreadable.push(`${entry.name} (${entry.employmentId}): Remote has no such employment.`);
      continue;
    }
    const observed = record.company_id ?? null;
    // Both sides present and equal. A null on either side is never a match.
    const inCompany = observed !== null && String(observed) === String(companyId);
    employments.push({ employmentId: entry.employmentId, name: entry.name, inCompany, observedCompanyId: observed });
  }

  const mine = employments.filter((e) => e.inCompany);
  const mineIds = new Set(mine.map((e) => e.employmentId));
  const observedBy = new Map(employments.map((e) => [e.employmentId, e.observedCompanyId]));
  // EVERY status, not just the decidable one — and the distinction is not
  // cosmetic. `requests` (below) is what the screen SHOWS and is pending-only,
  // because a settled request is not awaiting anybody. `all` is what the
  // COMPANY BOUNDARY is checked against, and it has to be wider: with a
  // pending-only membership set, quoting the id of your own company's
  // already-approved request answered `not_your_company` — a refusal that is
  // both wrong and misleading, since the true reason is that it has already
  // been decided. Two different facts must not collapse into one refusal code.
  const all = [];
  const failures = [];
  let rowsReturned = 0;

  // --- RUNG 2 FIRST, always, and its answer is reported rather than assumed.
  // The Sandbox holds zero work-authorization requests (verified live
  // 2026-08-30), so this loop is expected to return nothing there — but
  // "expected" is not "known", and a probe that is skipped because we predicted
  // its answer is how a Sandbox limitation gets recorded as a fact about
  // Remote's platform. This repository has done that three times and been wrong
  // twice (CLAUDE.md §3).
  const canList = typeof remote?.listWorkAuthorizations === "function";
  if (canList) {
    for (const employment of mine) {
      try {
        const rows = await remote.listWorkAuthorizations({ employmentId: employment.employmentId });
        rowsReturned += rows.length;
        for (const row of rows) {
          all.push(annotate(row, { origin: "remote_api", employment }));
        }
      } catch (err) {
        failures.push({ employmentId: employment.employmentId, message: String(err.message).slice(0, 200) });
      }
    }
  }

  // --- RUNG 3 SECOND, ADDITIVE ONLY, AND SCOPED BY THE EMPLOYMENTS RUNG 2
  // ALREADY ANSWERED FOR.
  //
  // The store is handed the employment ids whose records were read back and
  // found to be in this company. It holds no company id of its own and has no
  // way to acquire one, so it cannot widen this and cannot contradict it. That
  // is the fix for a real defect: the index used to carry its own `companyId`
  // and filter on it, so against a Remote whose employments sit in a different
  // company the SAME response said Chris Lee is not in this company (scope) and
  // that his request is this company's to decide (requests).
  const attributed = standin.listForEmployments(mineIds);
  for (const row of attributed) {
    const employmentId = standin.indexOf(row.id)?.employmentId ?? null;
    all.push(
      annotate(row, {
        origin: "standin",
        employment: {
          employmentId,
          name: mine.find((e) => e.employmentId === employmentId)?.name ?? row.user?.name ?? null,
          observedCompanyId: observedBy.get(employmentId) ?? null,
        },
      })
    );
  }

  // --- OUR OWN UC-04 RECORDS, THIRD, ADDITIVE ONLY, AND NEVER ON TOP OF A
  // REAL REMOTE ROW.
  //
  // THE DEFECT THIS CLOSES: a work-authorization request filed through /portal
  // or through the UC-03 -> UC-04 continuation wrote a durable
  // `uc04_authorizations` row, raised a Zendesk ticket, and NEVER APPEARED HERE
  // — because this function read two sources and the portal wrote to a third.
  // The customer's manager is the only person Remote's API lets decide a work
  // authorization (CLAUDE.md §3 directive 2, corrected 2026-08-30), and they
  // could not see the request that had just been filed.
  //
  // SCOPED THE SAME WAY AS EVERYTHING ABOVE, and it has to be: the store is
  // handed `mineIds` — the employments whose records were READ BACK FROM REMOTE
  // and found to be in this session's company — and holds no company id of its
  // own, so it cannot widen the boundary and cannot contradict it. There is no
  // argument, parameter or header through which a caller reaches this call.
  //
  // A REAL REMOTE ROW ALWAYS WINS. `seen` is seeded from what rungs 2 and 3
  // already pushed, so a record whose id collides with something Remote (or the
  // stand-in) returned is SKIPPED and named in the probe — never merged over,
  // never allowed to rewrite a status Remote asserted. That is the ladder's
  // "a real value always wins" applied to whole rows.
  const canListRecords = typeof authorizationStore?.listForEmployments === "function";
  const recordsNotForEmployer = [];
  const displacedByRemote = [];
  let recordRows = [];
  let recordFailure = null;
  let recordsShown = 0;
  if (canListRecords && mineIds.size) {
    try {
      recordRows = (await authorizationStore.listForEmployments(mineIds)) ?? [];
    } catch (err) {
      // A store that could not be read is NOT an empty store. Reported, never
      // rendered as "nothing has been filed".
      recordFailure = String(err.message).slice(0, 200);
    }
  }
  const seen = new Set(all.map((entry) => entry.id));
  for (const row of recordRows) {
    const shaped = toWorkAuthorizationShape(row);
    if (!shaped) {
      // Escalated, blocked or already executed — real rows that name no
      // employer decision. Excluded and SAID, with the reason.
      recordsNotForEmployer.push({
        id: row.id,
        employmentId: row.employmentId ?? null,
        storeStatus: row.status ?? null,
        reason: whyNotForEmployer(row.status),
      });
      continue;
    }
    if (seen.has(shaped.id)) {
      displacedByRemote.push(shaped.id);
      continue;
    }
    seen.add(shaped.id);
    const employmentId = row.employmentId ?? null;
    recordsShown += 1;
    all.push(
      annotate(shaped, {
        origin: RECORD_ORIGIN,
        employment: {
          employmentId,
          name: mine.find((e) => e.employmentId === employmentId)?.name ?? null,
          observedCompanyId: observedBy.get(employmentId) ?? null,
        },
        record: row,
      })
    );
  }

  // Left out, and SAID so rather than dropped. A filter whose exclusions are
  // invisible is how the contradiction above went unnoticed for a whole build.
  const attributedIds = new Set(attributed.map((r) => r.id));
  const standinUnattributed = standin
    .listAll()
    .filter((row) => !attributedIds.has(row.id))
    .map((row) => {
      const employmentId = standin.indexOf(row.id)?.employmentId ?? null;
      const observed = observedBy.has(employmentId) ? observedBy.get(employmentId) : undefined;
      return {
        id: row.id,
        employmentId,
        observedCompanyId: observed ?? null,
        reason:
          observed === undefined
            ? "the employment this request names could not be read back from Remote, so no company can be established for it"
            : observed === null
              ? "the employment record this request names carries no company id at all"
              : `the employment this request names is at ${observed}, not ${companyId}`,
      };
    });

  // NEWEST FIRST, ACROSS ALL THREE SOURCES. The owner's requirement was that a
  // request filed on the portal "reflect INSTANTLY on the employer screen", and
  // appearing at position nine of a fixture-ordered list is not that. Sorting
  // moves rows; it never removes one and never lets one source displace
  // another's identity — that is `seen` above, and the two are deliberately
  // different mechanisms.
  all.sort(bySubmittedAtDesc);

  return {
    companyId,
    employments,
    requests: all.filter((entry) => entry.request.status === DECIDABLE_STATUS),
    // Every request in the company, whatever its status. The decision route
    // resolves the record it is about from HERE and not from `requests`, so an
    // already-decided request of your own company is answered
    // `not_awaiting_manager` rather than `work_authorization_not_found`.
    allRequests: all,
    recordIds: new Set(all.map((r) => r.id)),
    unreadable,
    standinUnattributed,
    // "This session owns no employment here" is a REAL state and it renders
    // identically to "nothing is pending" unless something says which it is.
    // It is the state the whole surface lands in when it is pointed at a Remote
    // whose employments belong to another company — which is precisely what
    // happened, and the empty list read as a working boundary.
    scopeVerdict: scopeVerdict(companyId, employments, mine),
    remoteProbe: probeVerdict({ canList, queried: mine.length, rowsReturned, failures }),
    // Rows this system holds that name no employer decision, each with why.
    recordsNotForEmployer,
    recordProbe: recordProbeVerdict({
      canList: canListRecords,
      queried: mine.length,
      rowsReturned: recordRows.length,
      shown: recordsShown,
      failure: recordFailure,
      displacedByRemote,
    }),
  };
}

/**
 * WHAT THE UC-04 STORE ACTUALLY ESTABLISHED — reported in the same shape as
 * `remoteProbe`, and for the identical reason: an empty screen has at least four
 * causes and only one of them is "nobody has filed anything".
 *
 * The four this separates:
 *   - `unavailable`     no store was wired in at all, or reading it threw. The
 *                       screen is showing nothing and knows nothing.
 *   - `nothing_to_ask`  no employment was in scope to ask about — the absence of
 *                       a question, not a finding.
 *   - `answered`        the store was read and returned what it returned.
 *
 * `displacedByRemote` is reported even when empty, because it is the one number
 * that says whether our own records were allowed to sit on top of Remote's.
 */
function recordProbeVerdict({ canList, queried, rowsReturned, shown, failure, displacedByRemote }) {
  const base = {
    store: "uc04_authorizations",
    employmentsQueried: queried,
    rowsReturned,
    rowsShown: shown,
    displacedByRemote,
    failure,
  };
  if (!canList) {
    return {
      ...base,
      asked: false,
      verdict: "unavailable",
      detail:
        "No UC-04 record store is attached to this surface, so the requests filed on this system's own intake " +
        "surfaces were never looked for. Nothing here is evidence that none exist.",
    };
  }
  if (failure) {
    return {
      ...base,
      asked: true,
      verdict: "unavailable",
      detail: `The UC-04 record store could not be read (${failure}), so nothing is known about what it holds.`,
    };
  }
  if (queried === 0) {
    return {
      ...base,
      asked: false,
      verdict: "nothing_to_ask",
      detail:
        "The UC-04 record store was asked about NOBODY — no employment was in scope to ask about. This is not a " +
        "finding that nothing has been filed; it is the absence of a question.",
    };
  }
  return {
    ...base,
    asked: true,
    verdict: "answered",
    detail:
      `The UC-04 record store was asked about ${queried} employment(s) and returned ${rowsReturned} row(s), of ` +
      `which ${shown} name an employer decision` +
      (displacedByRemote.length
        ? `; ${displacedByRemote.length} were left out because Remote already returned a request with the same id, and a real Remote row is never displaced by ours.`
        : "."),
  };
}

/** Was there anybody to ask about, and if not, why not? */
function scopeVerdict(companyId, employments, mine) {
  if (mine.length) {
    return {
      state: "has_scope",
      detail: `${mine.length} of ${employments.length} candidate employment(s) are at ${companyId}.`,
    };
  }
  if (!employments.length) {
    return {
      state: "no_employment_readable",
      detail:
        "Not one candidate employment could be read back from Remote, so no company could be established for any " +
        "of them. This is a failure to look, not a finding.",
    };
  }
  const observed = [...new Set(employments.map((e) => e.observedCompanyId ?? "(none)"))];
  return {
    state: "no_employment_in_company",
    detail:
      `None of the ${employments.length} candidate employment(s) is at ${companyId} — they are at ` +
      `${observed.join(", ")}. Nothing below is evidence about what is pending: this session owns nobody in the ` +
      "Remote this page is pointed at. Point it at the Remote these sessions belong to, or set the console's " +
      "company to one that exists there.",
  };
}

/**
 * WHAT THE PROBE ACTUALLY ESTABLISHED — "asked and got nothing" and "asked
 * nothing" are different claims.
 *
 * `{employmentsQueried: 0, rowsReturned: 0, failures: []}` reads exactly like
 * "Remote holds none" and meant "we asked Remote about nobody". That is the
 * shape this repository's own rule about checks exists to forbid: a check that
 * cannot reach what it is checking must never be indistinguishable from a pass
 * (`verify-deployed` exits 2, never 0, for the same reason).
 */
function probeVerdict({ canList, queried, rowsReturned, failures }) {
  const base = {
    endpoint: "GET /v1/work-authorization-requests?employment_id=…",
    employmentsQueried: queried,
    rowsReturned,
    failures,
  };
  if (!canList) {
    return {
      ...base,
      asked: false,
      verdict: "unavailable",
      detail:
        "This Remote client cannot list work-authorization requests, so Remote was never asked. Nothing here is " +
        "evidence about what Remote holds.",
    };
  }
  if (queried === 0) {
    return {
      ...base,
      asked: false,
      verdict: "nothing_to_ask",
      detail:
        "Remote was asked about NOBODY — no employment was in scope to ask about. This is not a finding that " +
        "Remote holds no requests; it is the absence of a question.",
    };
  }
  if (failures.length === queried) {
    return {
      ...base,
      asked: true,
      verdict: "unavailable",
      detail: `All ${queried} call(s) to Remote failed, so nothing is known about what it holds.`,
    };
  }
  return {
    ...base,
    asked: true,
    verdict: "answered",
    detail:
      `Remote was asked about ${queried} employment(s) and returned ${rowsReturned} request(s)` +
      (failures.length ? `; ${failures.length} call(s) failed and are not counted as empty.` : "."),
  };
}

/**
 * Wrap a request with the two facts a reader needs and the record itself does
 * not carry: whose employment it is, and WHICH WORLD IT CAME FROM.
 *
 * THE REMOTE RECORD IS NESTED, NOT SPREAD. Spreading our annotations onto it
 * would put an `employment_id` on an object the real API has never returned
 * one on — the fixture-teaches-a-wrong-shape defect the whole UC-04 block in
 * src/remote/mockServer.js exists to stop repeating. `request` is exactly what
 * Remote sent (or, for a stand-in, exactly what a `_standin`-marked record
 * says it is); everything beside it is ours and is outside it.
 *
 * `origin` is the discriminator the write path keys off — not the shape of the
 * id, which is how the portal's expense release came to address a mock id
 * against the real gateway and 404 every time (src/shared/remoteWorld.js).
 */
function annotate(row, { origin, employment, record = null }) {
  const entry = {
    id: row.id,
    origin,
    employmentId: employment?.employmentId ?? null,
    employeeName: employment?.name ?? row.user?.name ?? null,
    // FROM THE EMPLOYMENT RECORD, for a stand-in exactly as for a real one.
    // This is the field a stand-in fixture used to assert for itself, and the
    // reason one payload could contradict itself about whose company a person
    // is in. There is now one authority for it and rung 2 is it.
    observedCompanyId: employment?.observedCompanyId ?? null,
    request: row,
  };

  // --- WHAT A DENSE ONE-LINE-PER-REQUEST LIST NEEDS, computed once, here.
  // Server-side for the same reason every other string on these pages is: the
  // page renders what it is given, and a label computed in the browser is a
  // second place for the same fact to be spelled differently. On EVERY origin,
  // not only ours — a list that renders three shapes three ways is three lists.
  entry.label = oneLineLabel(entry);
  // `decidable` is the SAME predicate `requests` is filtered on, so a control
  // the page enables and a request the server will accept cannot disagree.
  entry.decidable = row.status === DECIDABLE_STATUS;
  entry.submittedAt = row.submitted_at ?? null;
  // The outcome, once there is one — so a row that has just been decided reads
  // as decided without a second round trip.
  entry.outcome = row.status === DECIDABLE_STATUS ? null : row.status;

  if (!record) return entry;

  // --- OURS ONLY: what UC-04 already worked out about this trip, and the facts
  // Remote's schema has no field for. Outside `request` on purpose — see
  // ./workAuthRecords.js's header.
  entry.assessment = assessmentOf(record);
  entry.offSchemaFactors = offSchemaFactorsOf(record);
  // WHAT THEY SAID THEY WOULD BE DOING, and the prose the employer's own field
  // is prefilled with — one computation shared with the ZAF sidebar, so the
  // screen that decides and the screen that reviews cannot say different
  // things about one trip. See activityProfileOf().
  entry.activityProfile = activityProfileOf(record);
  // THE COUNTS THE DECISION TURNS ON. Same function the ZAF sidebar renders
  // from, same stored row — see measurementsOf() for the manager's report that
  // forced this, and for why nothing is re-derived here.
  entry.measurements = measurementsOf(record);
  entry.filedVia = record.source ?? null;
  entry.filedAt = record.createdAt ?? null;
  // The Zendesk ticket the intake raised for this request, when it raised one.
  // `external_ref` is repointed at the ticket id by the portal's `linkTicket()`,
  // so a numeric value here IS a ticket and anything else is the requester's own
  // reference — reported as it is rather than coerced into looking like a link.
  const ref = record.externalRef ? String(record.externalRef) : null;
  entry.externalRef = ref;
  entry.ticketId = ref && /^\d+$/.test(ref) ? ref : null;
  entry.decidedBy = decidedSlot(record);
  return entry;
}
