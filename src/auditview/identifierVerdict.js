// ---------------------------------------------------------------------------
// identifierVerdict.js  —  what an EMPTY lookup actually means
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
// On 2026-08-19 a request was submitted through the portal, decided, and
// recorded. The portal reported a reference and told the requester, in bold,
// that it was "the id that ties every record of this request together; quote
// it to have this request traced." They quoted it here. They got nothing.
//
// The decision existed. It carried a different reference — the originating
// ticket id — because the request had been handed on from UC-03 and the writer
// recorded the reference of the run it continued. The lookup was keyed on
// `externalRef`, so it could not reach it.
//
// What the page showed was an empty result, and an empty result reads as
// "the decision was never recorded". That is the OPPOSITE conclusion from the
// truth, and the page presented it silently. Nothing about the phrasing said
// which of these two the reader was looking at:
//
//     A. no record exists for this id
//     B. this is not an id this viewer can search by
//
// and there is a third, which is the honest one more often than either:
//
//     C. we cannot tell which of A and B this is
//
// THIS MODULE'S ONE JOB is to never return A when the truth might be B or C.
// It is the same discipline the gate ladder draws between `not_reached` and
// `passed`, and src/uc04/decisionFacts.js between `unknown` and `cleared`: a
// check that never ran cleared nothing, and a place that was never searched
// found nothing.
//
// IT IS A JUDGEMENT, SO IT IS SERVER-SIDE — the same division of labour
// traceVerdict.js and refVerdict.js follow. The page renders `headline`,
// `detail`, `notes` and `nextSteps` verbatim and decides nothing.
//
// IT NEVER INVENTS A RECORD. There is no branch here that produces a
// plausible-looking empty shell, a nearest-in-time guess, or a "probably this
// one". When the tables hold nothing, the answer is that they hold nothing —
// said in a way that also says what that does and does not prove.
// ---------------------------------------------------------------------------

/**
 * @param {object} lookup  the shape readStore.lookupIdentifier() returns
 * @returns {{code: string, tone: "ok"|"warn"|"neutral", headline: string,
 *   detail: string, notes: string[], nextSteps: string[], searchedCount: number}}
 */
export function identifierVerdict(lookup) {
  const {
    value = "",
    shape = { code: "unknown", label: "an identifier", meaning: "" },
    searched = [],
    matches = [],
    decisions = [],
    traces = [],
    claims = [],
    alerts = [],
    unregistered = [],
    exhaustiveScanRan = false,
    rowCap = 0,
  } = lookup ?? {};

  const searchedCount = searched.length;
  const total = decisions.length + traces.length + claims.length + alerts.length;

  if (value === "") {
    return {
      code: "empty",
      tone: "neutral",
      headline: "Type an id to trace.",
      detail:
        "Any id this request carries will do — the reference the portal reported, a Zendesk ticket id, the " +
        "record id from a use case's own view, an employment id, an audit row's id, or an n8n execution id. " +
        "You do not have to know which kind you are holding.",
      notes: [],
      nextSteps: [],
      searchedCount,
    };
  }

  if (total > 0) {
    const where = matches.map((m) => m.label).join("; ");
    const parts = [];
    if (decisions.length) parts.push(`${decisions.length} audit_log row${plural(decisions.length)}`);
    if (claims.length) parts.push(`${claims.length} exactly-once claim${plural(claims.length)}`);
    if (traces.length) parts.push(`${traces.length} trace attempt${plural(traces.length)}`);
    if (alerts.length) parts.push(`${alerts.length} ops alert${plural(alerts.length)}`);

    const notes = [];
    // A cap that BIT is a fact about the answer, and a reader who is not told
    // will read a truncated list as the whole of it.
    if (
      decisions.length >= rowCap ||
      traces.length >= rowCap ||
      claims.length >= rowCap ||
      alerts.length >= rowCap
    ) {
      notes.push(
        `At least one table returned the full page of ${rowCap} rows, so this list may be incomplete. ` +
          "Narrow the search, or use the feed's filters."
      );
    }
    // An id that matches only on the employment id is NOT this request — it is
    // every request that employee ever made. Saying so is the difference
    // between a trace and a coincidence.
    const onlyEmployment =
      matches.length > 0 && matches.every((m) => m.target.endsWith(".employmentId"));
    if (onlyEmployment) {
      notes.push(
        "Every match here is on the EMPLOYMENT id, which identifies a person rather than a request — so this " +
          "is that employee's history, not one request's. To narrow it to a single request, use the reference " +
          "or the record id shown on the row you want."
      );
    }

    return {
      code: "found",
      tone: "ok",
      headline: `Found: ${parts.join(", ")}.`,
      detail:
        `"${value}" was matched as ${where}. Every row below names the field it matched on, because a row can ` +
        "match because it IS this request or merely because it shares an identifier with it, and only the " +
        "field tells you which.",
      notes,
      nextSteps: [],
      searchedCount,
    };
  }

  // ---- nothing matched the registry -----------------------------------------

  if (unregistered.length) {
    // The value IS in the trail — under a key nothing had thought to search.
    // This is a defect in this viewer's registry, and saying so is both more
    // useful and more honest than reporting the request as missing.
    const where = unregistered.map((u) => `${u.table}.details.${u.key} (${u.rows} row${plural(u.rows)})`).join(", ");
    // The wording stops short of "this is your request". The scan matched a
    // VALUE, and a value can be an id or it can be a reason slug, a decision
    // word or a country code that happens to equal what was typed. Naming the
    // key and the row count lets the reader make that call; asserting it for
    // them would be inventing a record, which is the one thing this surface
    // must never do.
    return {
      code: "found_under_unregistered_key",
      tone: "warn",
      headline: "This value IS in the trail — but under a key this viewer does not index as an identifier.",
      detail:
        `The ordinary lookup found nothing, so every key of every details object was scanned as well. "${value}" ` +
        `appears at ${where}. Whether that is this request's id or a value that merely reads like one is ` +
        "visible from the key name and the row count — a single row under a key ending in Id is almost " +
        "certainly the former; seventy under `decision` is certainly not.",
      notes: [
        "Reported rather than quietly folded into the results: a gap in what this page knows how to search is " +
          "worth someone's attention, and hiding it would let the next reader hit the same wall.",
      ],
      nextSteps: [
        `Filter the feed on "${value}" — the free-text filter matches the actor, the reference, the reason and ` +
          "the record id as substrings, so it may reach the row from here.",
        "If that key really does carry an identifier, flag it to engineering — this viewer can be taught to " +
          "search that field directly, so the next lookup finds it without a manual filter.",
      ],
      searchedCount,
    };
  }

  const notes = [
    `Searched ${searchedCount} identifier field${plural(searchedCount)} across all four observability tables ` +
      "(audit_log, audit_trace, workflow_claims, ops_alerts)" +
      (exhaustiveScanRan
        ? ", then scanned every other key of every details object as well. Nothing holds this value."
        : "."),
    "Matches are EXACT. This is an identifier lookup, not a search — the feed's free-text filter is the " +
      "substring tool, and it is one tab away.",
  ];

  return {
    code: "not_found",
    tone: "neutral",
    headline: `Nothing in the audit trail carries "${value}".`,
    detail: notFoundDetail(shape),
    notes,
    nextSteps: nextStepsFor(shape),
    searchedCount,
  };
}

/**
 * THE SENTENCE THAT MUST NOT OVERCLAIM. Every branch says what not-found does
 * prove and what it does not, and the shape only changes how specific that can
 * honestly be — never whether the caveat is there.
 */
function notFoundDetail(shape) {
  switch (shape.code) {
    case "portal_reference":
      return (
        "This is a portal submission reference, and that IS a kind this viewer searches — it is what " +
        "externalRef carries in audit_log and what workflow_claims is keyed on. So the likely readings are " +
        "narrow, and neither of them is 'your request was not processed': either the run recorded a DIFFERENT " +
        "reference on its rows (a request handed on from one use case to another records the originating " +
        "request's reference — a UC-03 travel request continuing into UC-04 does exactly this), or the string " +
        "differs from the one that was issued. A decided request whose rows do not repeat its reference is a " +
        "gap in the writer, not evidence that nothing happened."
      );
    case "uuid":
      return (
        "This is a UUID. Every id this system generates is one, but only some of them reach these four " +
        "tables: an audit row's id, a trace row's id and its parent, an ops alert's id, and whichever record " +
        "ids a writer copied into details. A record id that no audit row ever carried lives only in its own " +
        "use case's table, which this viewer does not read — so not finding it here is not evidence the " +
        "record does not exist."
      );
    case "ticket_number":
      return (
        "This is a bare number, so it is most likely a Zendesk ticket id (n8n execution ids look the same, " +
        "and both were searched). A ticket becomes findable here by a run recording it as an external " +
        "reference — so a ticket that never reached a workflow, or reached one that failed before its first " +
        "durable write, leaves nothing in these tables. That is a different thing from the ticket not existing."
      );
    default:
      return (
        "This viewer CANNOT TELL whether this is an identifier it can search by. It is not a UUID, not a " +
        "portal reference and not a bare number — and external references are free-form strings, so it may " +
        "well be a perfectly valid one. It was tried against every field regardless. What that means is that " +
        "this result rules out the places listed below and nothing else: it is not evidence that the request " +
        "was never recorded."
      );
  }
}

function nextStepsFor(shape) {
  const common = [
    "Search the feed's free-text filter for a fragment of it — that is a substring match over the actor, the " +
      "reference, the reason and the record id, and it can reach a row an exact lookup cannot.",
    "If you have any OTHER id from the same request — the employment id, the record id a use case's own view " +
      "shows, the Zendesk ticket id — paste that instead. This box takes any of them.",
  ];
  switch (shape.code) {
    case "portal_reference":
      return [
        "Check the reference against the one the portal reported, character for character.",
        "If this request continued another one (a travel request routed on to work authorization), trace the " +
          "ORIGINAL request's reference or ticket id — the continuation's rows carry that one.",
        ...common,
      ];
    case "uuid":
      return [
        "If this is a record id from a use case's own view, open that use case's API for the record itself; " +
          "this viewer only sees record ids that a writer copied into an audit row.",
        ...common,
      ];
    default:
      return common;
  }
}

function plural(n) {
  return n === 1 ? "" : "s";
}
