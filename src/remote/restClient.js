// ---------------------------------------------------------------------------
// restClient.js  —  The one place that talks to the Remote REST API
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
// Every read/write to Remote goes through this wrapper. Centralising it means:
//   - auth is handled once (here you'd attach the OAuth2 bearer token)
//   - the base URL is swappable (mock -> sandbox -> production) in ONE place
//   - retries, rate-limit handling and logging can be added once, for all UCs
//   - shape differences between the mock and the real API are absorbed HERE,
//     so policyEngine.js / letter.js never need to know which one answered
//     (see normalizeEmployment() below — verified against real Sandbox data,
//     not guessed; see the comment on it for exactly what was checked).
//
// It uses the built-in fetch (Node 18+). No libraries needed.
//
// RETRY — every call below goes through #fetchWithRetry(), which wraps the
// raw fetch in withRetry() (src/shared/retry.js, invariant 10): a network
// error (DNS, connection refused, timeout — fetch() itself throwing) or a
// transient HTTP status (429, 5xx — isRetryableStatus()) gets up to 3
// attempts with backoff before the caller's error propagates. A 404 or any
// other 4xx is NEVER retried — #fetchWithRetry returns the Response as-is on
// the first attempt for those, so getEmployment()'s existing "404 -> null"
// convention (relied on by src/uc01/workflow.js and others) and every other
// "not ok -> throw" call site are unchanged: they still see exactly one
// attempt and the exact same error text they always did. Retry only ever
// buys extra attempts for the failures worth retrying.
// ---------------------------------------------------------------------------

import { randomUUID } from "node:crypto";
import { withRetry, isRetryableStatus } from "../shared/retry.js";
import { normalizeCountryCode, isWellFormedCountryCode } from "../shared/countryCodes.js";
import { UPSTREAM_NOT_FOUND, UPSTREAM_UNREACHABLE } from "../shared/upstreamFailure.js";
import { mergeHolidayCalendars, holidayDates } from "./holidays.js";
import { parseRemoteMinorUnits } from "../shared/money.js";

/**
 * Place ONE `GET /v1/countries` row on the ISO 3166-1 **alpha-2** axis, or
 * return null.
 *
 * WHY THIS IS A NAMED, EXPORTED FUNCTION AND NOT AN INLINE `??` CHAIN
 * Finding F-27: `c.country_code ?? c.code` silently produced alpha-3 codes
 * from the live API and compared them against alpha-2 destinations, so UC-03's
 * supported-destination gate was false for every country on earth. The obvious
 * one-character repair — appending another `?? c.code` fallback — reproduces
 * exactly that bug one level down, and would be even harder to see the second
 * time. The axis has to be asserted, not hoped for.
 *
 * So every candidate below is checked against the alpha-2 SHAPE
 * (`isWellFormedCountryCode`, `/^[A-Z]{2}$/`) before it is accepted. `code` is
 * consulted last and passes only when it happens to already be two letters
 * (some shapes do put alpha-2 there); "ESP" fails the shape check and is
 * skipped, exactly as intended.
 *
 * A ROW WITH ONLY AN ALPHA-3 CODE IS DROPPED — a deliberate decision, not an
 * oversight. Converting alpha-3 to alpha-2 needs a 249-entry mapping table
 * this repo does not have and must not invent (prime directive #4: do not
 * invent shapes the API did not give us). The honest reading of "we hold a
 * code we cannot compare" is *we could not confirm this country is supported*,
 * and on a 🟢 use case that auto-replies to and solves real customer tickets,
 * unconfirmed must mean escalate. Dropping the row produces exactly that.
 * `test/remoteCountries.test.js` pins it.
 *
 * @param {unknown} row one element of the countries list, in any known shape
 * @returns {string|null} canonical uppercase alpha-2 code, or null
 */
export function countryRowToAlpha2(row) {
  if (!row || typeof row !== "object" || Array.isArray(row)) return null;
  const candidates = [
    row.alpha_2_code, //          live API: "ES"          <- the real field
    row.country?.alpha_2_code, // nested variant (as on employment records)
    row.country_code, //          mock server's flat row: "ES"
    row.code, //                  live API: "ESP" (alpha-3) — accepted ONLY if alpha-2 shaped
    row.country?.code,
  ];
  for (const candidate of candidates) {
    if (isWellFormedCountryCode(candidate)) return normalizeCountryCode(candidate);
  }
  return null;
}

/**
 * One payroll-calendar failure, in the vocabulary every other upstream failure
 * in this repo is recorded in (`src/shared/upstreamFailure.js`).
 *
 * ONLY A 404 IS `not_found`, and that mapping is the whole point rather than a
 * detail: a 403 says the token was refused and a 503 says the service was down,
 * and neither says anything about whether a payroll cycle covers a given date.
 * A client reporting them as "no calendar" would be answering on Remote's
 * behalf — which is exactly what UC-06's gate has been recording.
 *
 * `thrown` carries the original error so `listPayrollRuns()` can keep its
 * documented throwing contract while `listPayrollRunsResult()` reports instead.
 *
 * @param {number|null} status
 * @param {string} message
 * @param {Error} [thrown]
 */
function payrollFailure(status, message, thrown = undefined) {
  return upstreamCallFailure("payroll_runs", status, message, thrown);
}

/**
 * The same fact for any other named call. Extracted from payrollFailure()
 * unchanged rather than re-typed: the 404-is-the-only-`not_found` mapping is
 * the whole content of both, and a second copy of it is a second place for it
 * to drift.
 *
 * @param {string} call    the call name that appears in the audit row
 * @param {number|null} status
 * @param {string} message
 * @param {Error} [thrown]
 */
function upstreamCallFailure(call, status, message, thrown = undefined) {
  const failure = {
    call,
    status: Number.isInteger(status) ? status : null,
    kind: status === 404 ? UPSTREAM_NOT_FOUND : UPSTREAM_UNREACHABLE,
    message: String(message ?? "").slice(0, 200),
  };
  if (thrown) failure.thrown = thrown;
  return failure;
}

// PATH SEGMENTS ARE ENCODED, and this is a security control rather than tidiness.
// `/v1/employments/${id}` with an unencoded id lets a caller who controls that
// value walk out of the intended route: "aaaaaa/../../../v1/companies" resolves,
// before the request is sent, to /v1/companies — carrying THIS client's bearer
// token. The third-party door is unauthenticated by design (VC-33) and passes a
// public string here, so that caller was the internet. encodeURIComponent turns
// the traversal into a literal segment that 404s.
export class RemoteClient {
  /**
   * @param {object} opts
   * @param {string} opts.baseUrl e.g. "http://localhost:4010" (mock) or the sandbox URL
   * @param {string} [opts.token] OAuth2 bearer token (not needed for the mock)
   * @param {number} [opts.retries] retry attempts per call — test-only seam, defaults to withRetry()'s 3
   * @param {(attempt:number) => Promise<void>} [opts.backoff] test-only seam — inject a no-op to keep tests instant; defaults to withRetry()'s real backoff
   * @param {typeof fetch} [opts.fetchImpl] the transport, defaulting to the global
   *   fetch. The same injectable-transport idiom as src/review/zafAuth.js,
   *   src/uc06/slackNotifier.js and src/remotebridge/server.js. It exists for
   *   ONE production caller: the serverless request portal, which must reach
   *   the mock Remote fixtures (createInProcessFetch() in src/remote/mockServer.js)
   *   in a process that cannot open a socket. Everything about this class —
   *   retry, the idempotency key, normalizeEmployment() — stays on the code
   *   path either way, which is the point of injecting the transport rather
   *   than writing a second client.
   */
  constructor({ baseUrl, token = null, retries = undefined, backoff = undefined, fetchImpl = undefined }) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.token = token;
    // Wrapped rather than stored bare: the global fetch must not be invoked as
    // a method of this object.
    this.fetchImpl = fetchImpl ? (url, opts) => fetchImpl(url, opts) : (url, opts) => fetch(url, opts);
    this._retryOpts = {
      ...(retries !== undefined ? { retries } : {}),
      ...(backoff !== undefined ? { backoff } : {}),
    };
    // Lazily-populated country index — BOTH ISO directions plus names, from one
    // `GET /v1/countries`. See #countryIndex(). The field keeps its original
    // name because it is the same cache; what it holds got wider, not different.
    this._alpha3MapPromise = null;
  }

  /** Raw fetch, wrapped so a genuine network error (not an HTTP error response) is tagged retryable. */
  async #doFetch(url, opts) {
    try {
      return await this.fetchImpl(url, opts);
    } catch (networkErr) {
      throw Object.assign(new Error(`network error calling ${url}: ${networkErr.message}`), {
        retryable: true,
        cause: networkErr,
      });
    }
  }

  /**
   * Perform one HTTP call with retry-on-transient-failure. Returns the raw
   * Response for the caller to interpret (404/ok/json) — never throws for a
   * non-retryable HTTP status, since that's the caller's decision to make
   * (e.g. "404 means null"), not this method's.
   * @param {string} url
   * @param {object} fetchOpts
   * @param {string} errLabel  prefix for the error thrown if every attempt exhausts on a transient status
   */
  async #fetchWithRetry(url, fetchOpts, errLabel) {
    return withRetry(
      async () => {
        const res = await this.#doFetch(url, fetchOpts);
        if (isRetryableStatus(res.status)) {
          throw Object.assign(new Error(`${errLabel}: ${res.status}`), { retryable: true });
        }
        return res;
      },
      { shouldRetry: (err) => err.retryable === true, ...this._retryOpts }
    );
  }

  /**
   * Headers for a WRITE, including the idempotency key that makes #fetchWithRetry
   * safe on a non-idempotent verb (QA finding F-18, HIGH — money).
   *
   * THE BUG THIS CLOSES. #fetchWithRetry() retries a 5xx/429/timeout up to 3
   * times with a byte-identical body. On `POST /v1/recurring-incentives` —
   * the one call in this repo that moves real money — that means a gateway
   * that returns 504 *after* the payment was already created gets the same
   * disbursement posted again, and again. Reproduced with a stub answering
   * 504, 504, 200: three identical payment bodies were delivered and the
   * caller saw a single success. A retry is only safe on a verb the server
   * can recognise as a repeat, and nothing in the request said so.
   *
   * THE KEY IS PER LOGICAL WRITE, NOT PER ATTEMPT. It is computed once here,
   * before the first attempt, and lives on the same `fetchOpts` object every
   * retry reuses — so all three attempts carry the SAME key and the server
   * can collapse them. Callers that know a durable identity for the write
   * (uc09/workflow.js passes the adjustment row's id, uc06/workflow.js the
   * amendment's) should supply it: that extends the guarantee across process
   * restarts and manual re-submissions, not just across this call's retries.
   * The randomUUID() fallback deliberately does NOT hash the payload —
   * hashing would make two genuinely distinct but identical bonuses collide
   * into one payment, trading a double-pay bug for a missing-pay bug.
   *
   * @param {string|null} [idempotencyKey]
   */
  #writeHeaders(idempotencyKey = null) {
    return {
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
      "Idempotency-Key": String(idempotencyKey || randomUUID()),
    };
  }

  async #get(path) {
    const headers = { Accept: "application/json" };
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    const res = await this.#fetchWithRetry(`${this.baseUrl}${path}`, { headers }, `Remote API ${path} failed`);
    if (res.status === 404) return null; // caller decides what a missing record means
    // THE STATUS TRAVELS WITH THE ERROR. Without it the only record of what
    // Remote answered is a substring of a message, and a caller that wants to
    // tell "403, we were refused" from "503, it was down" has to parse English.
    // `listPayrollRunsResult()` is the first caller to need the distinction;
    // see `src/shared/upstreamFailure.js` for why the two are not the same fact.
    if (!res.ok) throw Object.assign(new Error(`Remote API ${path} failed: ${res.status}`), { status: res.status });
    const body = await res.json();
    return body.data ?? body;
  }

  /**
   * GET /v1/employments/:id — the employment record (source of truth).
   * The real Remote API nests a single resource under its own key
   * (`{data: {employment: {...}}}`); the mock server returns it flat
   * (`{data: {...}}`) for simplicity. Support both, then normalize to the
   * one flat shape the rest of UC-01 already knows how to use.
   */
  async getEmployment(id) {
    const result = await this.#get(`/v1/employments/${encodeURIComponent(id)}`);
    const raw = result?.employment ?? result;
    return normalizeEmployment(raw);
  }

  /**
   * GET /v1/employments?short_id=XXXXXX — resolve REMOTE'S OWN EMPLOYEE ID.
   *
   * WHAT THIS IS, AND WHY IT MATTERS MORE THAN IT LOOKS. Remote publishes an
   * "Employee ID" to every employee — *"a unique identifier assigned to each
   * employee on the Remote platform"*, found under Profile -> Job and Pay ->
   * Employment (support.remote.com article 20120956060941, fetched
   * 2026-08-28). It is NOT the API's UUID. It is a six-character code, and
   * the API exposes it as `short_id` on the employment record.
   *
   * That distinction is the whole point. The third-party door asks an
   * enquirer for "the employment reference the person gave you", and the
   * question nobody had answered was WHAT a bank could realistically hold. It
   * is not `2f7f8210-91fc-47db-803c-77a1cc625781` — no employee reads a UUID
   * down a phone. It is `CZKYVH`, which Remote shows them in their own
   * profile and which they can write on a form. Every canonical verification
   * document in the world pairs the subject's NAME with one further fact the
   * subject themself supplied; this is the fact Remote actually gives them.
   *
   * MEASURED LIVE, 2026-08-28, against gateway.remote-sandbox.com:
   *   GET /v1/employments/CZKYVH            -> 404 "Employment not found"
   *   GET /v1/employments?short_id=CZKYVH   -> 200, total_count 1
   * and across the whole account: 112 employments, 112 carrying a short_id,
   * 112 DISTINCT, every one matching /^[A-Z0-9]{6}$/. So the filter is exact
   * rather than a prefix search, and the code is unique enough to identify.
   *
   * RETURNS NULL RATHER THAN THROWING when nothing matches — the same shape
   * `getEmployment()` yields on a 404, so a caller cannot accidentally treat
   * "no such code" as an error distinguishable from "no such employment".
   * That symmetry is load-bearing at the third-party door, where the two must
   * be indistinguishable from outside (VC-33).
   *
   * @param {string} shortId Remote's six-character Employee ID
   * @returns {Promise<object|null>} the normalized employment, or null
   */
  async findEmploymentByShortId(shortId) {
    const code = String(shortId ?? "").trim().toUpperCase();
    // Shape-checked before it reaches the query string, for the same reason
    // the door shape-checks its reference: this value originates with an
    // unauthenticated stranger, and a permissive filter is a place to probe.
    if (!/^[A-Z0-9]{6}$/.test(code)) return null;
    const result = await this.#get(`/v1/employments?short_id=${encodeURIComponent(code)}`);
    const rows = result?.employments ?? [];
    // Exactly one, or nothing. Remote's short ids are unique across the
    // account (measured above), so more than one row means an assumption has
    // stopped holding and guessing which is right would be worse than
    // refusing — a wrong employment here attests to the wrong person.
    if (rows.length !== 1) return null;
    return normalizeEmployment(rows[0]);
  }

  /**
   * GET /v1/offboardings/employments/:id — every offboarding request filed
   * against ONE employment (scope `offboarding:read`).
   *
   * WHY THIS EXISTS (G-1, rca-bdz). An employment record's own `status` stays
   * `"active"` for the whole time an employee is serving notice — the
   * offboarding runs on a separate resource, and until this method existed
   * `src/uc01/engagementEligibility.js` had no way to see it: an employee
   * mid-offboarding whose record still read `active` passed G-1 and could
   * auto-resolve a letter attesting to a continuing employment that is
   * ending (DRIFT-074's false-attestation shape, reached through a gate that
   * cannot see the fact rather than a renderer that invents one).
   *
   * MEASURED LIVE, 2026-08-21, against `gateway.remote-sandbox.com` with a
   * real token: `GET /v1/offboardings/employments/3537d9ee-…` (a real,
   * currently-active Sandbox employment) answered `HTTP 200
   * {"total_count":0,…,"offboardings":[]}` — the route exists, the token is
   * accepted, and the filter is DISCRIMINATING rather than blanket-empty:
   * the company-wide `GET /v1/offboardings` is non-empty for the same
   * account. So an empty result here is a real, positive fact — "this
   * employment has none on file" — never an unknown. `[CONFIRMED — live]`.
   *
   * THE SAME "not_found vs unreachable" SHAPE `listPayrollRunsResult()` uses,
   * for the identical reason: "no offboarding on file" and "we could not ask"
   * are opposite facts that must not collapse into the same escalation
   * reason. NEVER THROWS for an HTTP failure — a throw here would propagate
   * through `src/uc01/workflow.js` above its audit write and lose the
   * decision entirely, the exact F-28 shape `listPayrollRunsResult()`'s own
   * header names. Only a genuine programming error (no HTTP status, not
   * tagged retryable) still raises.
   *
   * DOES NOT FILTER BY STATUS. Any record returned is treated as evidence of
   * an offboarding in progress — this method does not guess at which status
   * values Remote considers terminal, per prime directive #4 (verify shapes
   * against the real API; do not invent them). `engagementEligibility.js`
   * decides what a non-empty list MEANS; this method only reports what
   * Remote sent.
   *
   * @param {string} employmentId
   * @returns {Promise<{offboardings: object[]|null,
   *   error: {call:string, status:number|null, kind:string, message:string, thrown?:Error}|null}>}
   *   `offboardings: []` (not null) means Remote answered and this
   *   employment genuinely has none on file.
   */
  async listOffboardingsForEmployment(employmentId) {
    let data;
    try {
      data = await this.#get(`/v1/offboardings/employments/${encodeURIComponent(employmentId)}`);
    } catch (err) {
      // Only a failure the client can attribute is converted — see the
      // identical guard in listPayrollRunsResult() for why a genuine bug in
      // this file must still surface as a crash rather than a fail-closed
      // escalation.
      if (!Number.isInteger(err?.status) && err?.retryable !== true) throw err;
      return { offboardings: null, error: upstreamCallFailure("offboardings", err.status ?? null, err.message, err) };
    }
    if (!data) {
      return {
        offboardings: null,
        error: upstreamCallFailure("offboardings", 404, "Remote answered 404 for this employment's offboardings"),
      };
    }
    const list = data.offboardings;
    if (!Array.isArray(list)) {
      return {
        offboardings: null,
        error: upstreamCallFailure("offboardings", null, "the offboardings read answered a shape this endpoint does not send"),
      };
    }
    return { offboardings: list, error: null };
  }

  /**
   * The entity name (+ address, when available) for the letter.
   *
   * There is no `GET /v1/legal-entities/:id` on the real Remote API (confirmed
   * against developer.remote.com — no such singular get-by-id endpoint exists;
   * a 404 there is real, not a fluke). The real path is
   * `GET /v1/companies/:companyId/legal-entities`, which lists a company's
   * legal entities (id, name, country_code — no address field is exposed by
   * this endpoint). The mock server, for simplicity, DOES implement a direct
   * `/v1/legal-entities/:id` — so: when a companyId is available (always true
   * for a real, normalized employment record, via its `company_id` field),
   * list-and-find against the real endpoint; otherwise (the mock path) use
   * the direct lookup.
   * @param {string} id            legal entity id (employment.legal_entity_id)
   * @param {string|null} [companyId]  employment.company_id — required for the real API
   */
  async getLegalEntity(id, companyId = null) {
    if (companyId) {
      const list = await this.#get(`/v1/companies/${encodeURIComponent(companyId)}/legal-entities`);
      const match = list?.legal_entities?.find((e) => e.id === id);
      if (match) return this.#normalizeLegalEntity(match);
    }
    return this.#normalizeLegalEntity(await this.#get(`/v1/legal-entities/${encodeURIComponent(id)}`));
  }

  /**
   * Put a legal-entity row on the axis its field NAME already implies, and put
   * the axis it actually arrived on under a name that says so.
   *
   * THE DEFECT THIS CLOSES. `CompanyLegalEntity.country_code` is the ISO
   * ALPHA-3 form — Remote's own reference says so in the field's description
   * (*"ISO 3166-1 alpha-3 country code (e.g., 'USA', 'GBR', 'DEU')"*) and the
   * live Sandbox agrees: `USA`, `CAN`, `FRA`, `DEU`, `NLD` across all seven
   * entities of the demo company [CONFIRMED live 2026-08-19]. Meanwhile
   * `normalizeEmployment()` in this same file deliberately produces
   * `country_code` in ALPHA-2, because that is the axis every comparison set in
   * `src/` is written in — `RESTRICTED_JURISDICTIONS`, `SCHENGEN`,
   * `EU_EEA_FOR_A1`, UC-04's origin->destination matrix, UC-05's statutory
   * notice table, UC-09's high-tax list. Two fields, one name, two alphabets,
   * and nothing in either payload tells a reader which one they are holding.
   *
   * That is finding F-27 exactly, and F-27's cost is the argument for fixing
   * this before it has a consumer: `ALPHA2_SET.has(entity.country_code)` is
   * false forever, silently, and the resulting EMPTY footprint reads as *"this
   * customer operates nowhere restricted"* — a reassuring answer, produced by
   * a comparison that never had a chance of matching. A gate that cannot
   * succeed is indistinguishable from one refusing correctly, which is why the
   * conversion has to happen here, at the boundary, and not be left to a
   * caller who has no way of knowing it is needed.
   *
   * WHAT IT RETURNS. Every field Remote sends, unchanged, plus:
   *   - `country_code`        the ALPHA-2 form, or NULL. Never the alpha-3
   *                           string under this name.
   *   - `country_code_alpha3` the value as Remote sent it, under a name that
   *                           cannot be mistaken for the other axis. Kept
   *                           because it is the axis this API's own
   *                           country-scoped paths take, so a caller wanting
   *                           `/v1/countries/{code}/…` needs it and must not
   *                           have to convert back.
   *   - `country_name`        from the same registry read, when resolvable.
   *                           Free — the mapping fetch already carries it —
   *                           and it is what a human-facing surface actually
   *                           wants; UC-01's letter currently prints a raw
   *                           country code beside the employer's name.
   *
   * NULL, NEVER A GUESS. The conversion is read from `GET /v1/countries`
   * (both forms on every row) and cached; when that registry cannot be read,
   * or the code is not one Remote lists, `country_code` is null — the same
   * fail-closed choice `normalizeEmployment()` and `countryRowToAlpha2()` make,
   * for the same reason: a missing value gets investigated, a wrong one gets
   * acted on. `country_code_alpha3` still carries the original, so nothing is
   * lost, only correctly labelled.
   *
   * A row that already carries an alpha-2 `country_code` (the shape this
   * repo's mock server served before this pass) passes through unconverted —
   * `#resolveAlpha2()` returns a two-letter code as-is — so this is safe
   * against both shapes rather than assuming the live one.
   *
   * @param {object|null} raw
   * @returns {Promise<object|null>}
   */
  async #normalizeLegalEntity(raw) {
    if (!raw || typeof raw !== "object") return raw;
    const original = typeof raw.country_code === "string" ? raw.country_code.trim().toUpperCase() : null;
    const alpha2 = await this.#resolveAlpha2(raw.country_code);
    const names = alpha2 ? (await this.#countryIndex()).names : null;
    return {
      ...raw,
      country_code: alpha2,
      country_code_alpha3: original && /^[A-Z]{3}$/.test(original) ? original : null,
      country_name: raw.country_name ?? (alpha2 ? names?.get(alpha2) ?? null : null),
    };
  }

  /**
   * GET /v1/companies/:companyId/legal-entities — every legal entity the
   * CUSTOMER company has, normalised onto the alpha-2 axis every comparison in
   * `src/` is written in.
   *
   * WHOSE ENTITIES THESE ARE, because getting it backwards is the whole risk.
   * They are the CLIENT's, not Remote's. Remote's own employing entity is not
   * exposed by any endpoint this project has found — measured live: 40 Sandbox
   * employments, one company, six entities, and entity country matched
   * employment country on only 3 of 5 EOR records. So this answers "where does
   * the customer have a company", and nothing else. It is the input to the art.
   * 15(2)(b) question and it is not an answer to "who employs this person"
   * (`qa/HUMAN-DECISIONS-REQUIRED.md` K16).
   *
   * Returns `[]` when Remote answers with no entities, and THROWS when the read
   * fails — the caller has to be able to tell "this customer has none there"
   * from "we could not ask", and an empty array standing for both is the
   * failure mode F-27 already cost this file once.
   *
   * @param {string} companyId
   * @returns {Promise<object[]>}
   */
  async listLegalEntities(companyId) {
    const list = await this.#get(`/v1/companies/${encodeURIComponent(companyId)}/legal-entities`);
    const entities = Array.isArray(list?.legal_entities) ? list.legal_entities : [];
    return Promise.all(entities.map((entity) => this.#normalizeLegalEntity(entity)));
  }

  /**
   * GET /v1/employments — used only by the live-verification script to pick a
   * real employment id to test getEmployment() against, so a real run doesn't
   * require hand-supplying one. Not used by UC-01 itself (the mock server has
   * no list endpoint, and the workflow always fetches by a known id).
   * @param {object} [opts]
   * @param {number} [opts.pageSize]
   * @returns {Promise<{employments: object[], current_page: number, total_pages: number, total_count: number}>}
   */
  listEmployments({ pageSize = 1 } = {}) {
    return this.#get(`/v1/employments?page_size=${pageSize}`);
  }

  /**
   * GET /v1/leave-policies/summary/:employmentId — the Time Off API read
   * UC-05.md §7 has always promised and nothing has ever made.
   *
   * Remote marks `GET /v1/timeoff-balances/{id}` *"deprecated since February
   * 2025 in favour of List Leave Policies Summary"*, which is this path. Both
   * were read live 2026-08-19 and carry the same numbers; this one is the
   * supported name. Shape, envelope and the two arithmetic traps in it are
   * documented once, in `src/remote/leaveBalances.js` — read that before
   * touching either.
   *
   * RETURNS null ON A 404, never `[]`. The whole point of the read is to turn
   * "the requester typed 20" into "Remote says 13.75", and an unreadable
   * response reported as an empty list would turn it into "Remote says nothing
   * is owed" — a positive claim about someone's final settlement, manufactured
   * out of a failed fetch. Same convention as `getEmployment()`,
   * `listCountries()` and `listPayrollRuns()`; `src/uc05/workflow.js` records
   * the null as an upstream failure and escalates.
   *
   * @param {string} employmentId
   * @returns {Promise<object[]|null>} the raw policy rows, or null
   */
  async listLeavePolicySummary(employmentId) {
    const result = await this.#get(`/v1/leave-policies/summary/${encodeURIComponent(employmentId)}`);
    if (Array.isArray(result)) return result;
    // The live endpoint answers with the array directly under `data`. Anything
    // else is a shape this endpoint does not send, and an unrecognised envelope
    // is an unread balance, not an empty one.
    return null;
  }

  /**
   * GET /v1/countries — the supported-countries list (UC-03 §3).
   *
   * SHAPE, VERIFIED LIVE 2026-08-17 (not inferred — inferring it is what broke
   * this). `GET https://gateway.remote-sandbox.com/v1/countries` returns 224
   * rows as `{data: [...]}`, the array DIRECTLY under `data` (not
   * `data.countries`, which is only the mock's envelope), each row shaped:
   *
   *   {code: "ESP", name: "Spain", alpha_2_code: "ES", region, subregion,
   *    eor_onboarding, contractor_products_available, country_subdivisions,
   *    supported_json_schemas, ...}
   *
   * `#get()` already unwraps `data`, so `result` is the bare array.
   *
   * `result?.countries` is still tolerated below, but it is now a LEGACY
   * envelope that nothing emits: `src/remote/mockServer.js` served
   * `{data:{countries:[…]}}` until 2026-08-17 and now serves the live shape
   * above. It is retained only because an unrecognised envelope yields `[]`
   * here — i.e. "nothing confirmed supported", a fail-closed answer — and a
   * stale pinned n8n dataset failing closed silently is worse than being read.
   * Do NOT read it as documentation of a real Remote response. Which envelope
   * the mock actually serves is asserted directly, against the mock's raw HTTP
   * output, in `test/remoteShapeFidelity.test.js`.
   *
   * WHY THE ALPHA-2 NORMALISATION IS THE POINT OF THIS METHOD (finding F-27).
   * This used to map `c.country_code ?? c.code`. The live API sends neither as
   * an alpha-2 value — `country_code` does not exist and `code` is the ALPHA-3
   * form — so the returned list was 3-letter codes ("ALB", "ESP"), while its
   * only consumer, UC-03's supported-destination gate, probes it with 2-letter
   * destinations ("ES"). Every membership test was false, so UC-03 could never
   * auto_resolve in production: Spain, a fully supported EOR country,
   * escalated as `unsupported_destination` (n8n execution 4259 recorded
   * `supportedCountries: []` after a successful 224-row fetch). It stayed
   * invisible because the gate fails closed — a use case that structurally
   * cannot succeed is observationally identical to one being cautious.
   *
   * So `country_code` here is guaranteed to be a well-formed alpha-2 code or
   * the row is DROPPED. See countryRowToAlpha2() for why dropping, rather than
   * falling back to the alpha-3 value, is the fail-closed choice.
   *
   * @returns {Promise<Array<{country_code:string, name:string|null}>|null>}
   *   only rows placeable on the alpha-2 axis — or NULL when the registry could
   *   not be read at all (404 / an envelope this endpoint never sends). Callers
   *   must not treat that null as an empty registry; see the note in the body.
   */
  async listCountries() {
    const result = await this.#get(`/v1/countries`);
    const list = Array.isArray(result) ? result : result?.countries;
    // A FAILED READ IS NOT AN EMPTY REGISTRY — the same distinction
    // listPayrollRuns() below had to be rewritten to restore, one method over.
    // `#get()` answers null on a 404, so `null?.countries` is undefined and this
    // branch used to `return []`, flattening "Remote sent no countries" and "we
    // never read the registry" into one value.
    //
    // The conflation is louder here than it is for the payroll calendar,
    // because of what the only consumer does with it. UC-03's step-7 gate
    // escalates a destination missing from the set as
    // `destination_jurisdiction_excluded` — a claim ABOUT THAT DESTINATION's
    // jurisdiction. An unreadable registry makes the set empty, so EVERY
    // destination earns that reason, Spain included: a specialist then
    // investigates a country with nothing wrong with it while the real cause
    // goes unrecorded. That is finding F-25's shape exactly (a gate that cannot
    // succeed, indistinguishable from one refusing correctly), rebuilt out of
    // the failure path instead of the mapping.
    //
    // Null, not [], and not a throw: null is the convention getEmployment() and
    // listPayrollRuns() already use, `src/uc03/workflow.js` records it as an
    // upstream failure, and `upstreamVerdict()` turns it into an escalation —
    // so the behaviour stays fail-closed and only the RECORDED REASON changes.
    // An empty array keeps its literal meaning and stays reachable.
    if (!Array.isArray(list)) return null;
    const out = [];
    for (const c of list) {
      const code = countryRowToAlpha2(c);
      if (code) out.push({ country_code: code, name: c.name ?? c.country_name ?? null });
    }
    return out;
  }

  /**
   * ONE `GET /v1/countries/{alpha3}/holidays/{year}` call — national when no
   * subdivision is named, subdivision-additional days when one is.
   *
   * THIS IS THE LOW-LEVEL LEG AND MOST CALLERS WANT THE OTHER ONE. A single
   * call answers only half the question for any employee in a country with
   * subdivisions: the two lists are DISJOINT, not nested. See
   * `src/remote/holidays.js` for the live evidence and the resulting union
   * rule; `listHolidayCalendarResult()` below is what a business-day
   * calculation should call.
   *
   * THE PATH IS KEYED ON ALPHA-3, like every other country-scoped path on this
   * API and unlike every comparison set in `src/`. [CONFIRMED live 2026-08-19,
   * same token, same container: `/v1/countries/CAN/holidays/2026` -> 200 with
   * 5 rows, `/v1/countries/CA/holidays/2026` -> 404 `{"message":"Country not
   * found"}`.] The conversion is done here via the registry-derived map, for
   * the reason `getCountrySchema()` documents at length — the axis belongs to
   * the endpoint, not to the caller.
   *
   * NOTHING IS SENT UNTIL THE INPUTS RESOLVE. An unresolvable country or a
   * non-4-digit year returns an `unreachable` failure WITHOUT a request,
   * because the alternative is guessing a country code or a year, and a wrong
   * one produces a complete, plausible, wrong calendar.
   *
   * ONLY A 404 IS `not_found`. Remote answers 400 for a year it cannot parse
   * (`{"message":"Year is invalid"}`) and 400 for a subdivision it does not
   * recognise (`{"message":"Country Subdivision is invalid"}`) — both
   * [CONFIRMED live]. Those are authoritative about the REQUEST, not about the
   * calendar, so they are recorded as `unreachable`: nothing about which days
   * that employee has off is knowable from them. That mapping is
   * `src/shared/upstreamFailure.js`'s, unchanged, so the reason string ranks
   * in the metrics dashboard beside every other upstream failure.
   *
   * IT DOES NOT THROW FOR AN HTTP FAILURE, for the reason
   * `listPayrollRunsResult()` documents: a throw out of a read propagates above
   * the caller's audit write, so an outage loses the decision entirely. A
   * genuine programming error still surfaces.
   *
   * @param {{countryCode?: string, year?: number|string, subdivisionCode?: string|null}} args
   * @returns {Promise<{holidays: object[]|null, error: object|null}>}
   */
  async listHolidaysResult({ countryCode, year, subdivisionCode = null } = {}) {
    const yearText = String(year ?? "").trim();
    if (!/^\d{4}$/.test(yearText)) {
      return {
        holidays: null,
        error: upstreamCallFailure(
          "holidays",
          null,
          `no usable 4-digit year (${JSON.stringify(year ?? null)}), so the holiday calendar was never requested`
        ),
      };
    }
    const alpha3 = await this.#resolveAlpha3(countryCode);
    if (!alpha3) {
      return {
        holidays: null,
        error: upstreamCallFailure(
          "holidays",
          null,
          `no resolvable country code (${JSON.stringify(countryCode ?? null)}), so the holiday calendar was never requested`
        ),
      };
    }
    // A subdivision that is not a non-empty string is not a subdivision. It is
    // NOT silently dropped: a caller that meant to narrow to Ontario and passed
    // something unusable would otherwise receive the national list and read it
    // as Ontario's — which is precisely the wrong-and-looks-right failure.
    let query = "";
    if (subdivisionCode !== null && subdivisionCode !== undefined) {
      if (typeof subdivisionCode !== "string" || !subdivisionCode.trim()) {
        return {
          holidays: null,
          error: upstreamCallFailure(
            "holidays",
            null,
            `subdivision code is not a usable string (${JSON.stringify(subdivisionCode)}), so the holiday calendar was never requested`
          ),
        };
      }
      query = `?country_subdivision_code=${encodeURIComponent(subdivisionCode.trim())}`;
    }

    let data;
    try {
      data = await this.#get(`/v1/countries/${alpha3}/holidays/${yearText}${query}`);
    } catch (err) {
      if (!Number.isInteger(err?.status) && err?.retryable !== true) throw err;
      return { holidays: null, error: upstreamCallFailure("holidays", err.status ?? null, err.message, err) };
    }
    if (data === null) {
      return {
        holidays: null,
        error: upstreamCallFailure("holidays", 404, `Remote answered 404 for ${alpha3} ${yearText} holidays`),
      };
    }
    // The array sits DIRECTLY under `data` — there is no `holidays` key
    // [CONFIRMED live]. An unrecognised envelope is an unread calendar, not an
    // empty one; coercing it to [] is the `{payroll_runs: []}` mistake.
    if (!Array.isArray(data)) {
      return {
        holidays: null,
        error: upstreamCallFailure("holidays", null, "the holiday calendar answered a shape this endpoint does not send"),
      };
    }
    return { holidays: data, error: null };
  }

  /**
   * THE CALENDAR THAT ACTUALLY GOVERNS AN EMPLOYEE: the national list unioned
   * with the subdivision list, because a single call to either is wrong.
   *
   *   listHolidayCalendarResult({countryCode: "CA", year: 2026,
   *                              subdivisionCode: "CA-ON"})
   *     -> 9 holidays  (5 national + 4 Ontario-only, disjoint sets)
   *
   * `src/remote/holidays.js` carries the live evidence, the four other
   * countries it was checked against, the United States finding (federal only —
   * every state probed returns 200 with zero rows), and why `observed_day ??
   * day` is load-bearing rather than decorative (Ontario's Boxing Day 2026 is
   * observed on the 28th).
   *
   * AN EMPTY NATIONAL LIST IS A REPORTED FAILURE, NOT AN EMPTY CALENDAR. No
   * country has zero public holidays, so `[]` from the national leg means
   * Remote has not populated that year — `NLD/holidays/2027` answers exactly
   * that, 200 with `{"data":[]}`, four months out [CONFIRMED live]. Handing
   * that back as an empty list would let a business-day counter proceed with a
   * confident "no holidays", which is the `listPayrollRuns()` 404-coerced-to-[]
   * defect rebuilt out of a 200. `kind: "unreachable"` — the calendar could not
   * be read, and nothing about this employee's working days is knowable.
   *
   * AN EMPTY SUBDIVISION LIST IS A FACT AND IS KEPT. Remote answers **400** for
   * a subdivision it does not recognise (`CA-ZZ`, `Ontario` — both
   * [CONFIRMED live]), so a 200 with `[]` means the code IS recognised and
   * carries no extra days. That is what every US state returns. `counts` names
   * both legs so a caller can see which half was empty rather than inferring it.
   *
   * @param {{countryCode?: string, year?: number|string, subdivisionCode?: string|null}} args
   * @returns {Promise<{holidays: object[]|null, dates: string[]|null,
   *   counts: {national: number|null, subdivision: number|null}, error: object|null}>}
   */
  async listHolidayCalendarResult({ countryCode, year, subdivisionCode = null } = {}) {
    // THE SUBDIVISION IS VALIDATED BEFORE THE NATIONAL LEG IS EVEN FETCHED.
    // Checking it after would send one request for a call that cannot be
    // completed, and — worse — would leave a caller holding a national list it
    // is about to be told is not the answer. Refuse first, ask second.
    if (subdivisionCode !== null && subdivisionCode !== undefined && (typeof subdivisionCode !== "string" || !subdivisionCode.trim())) {
      return {
        holidays: null,
        dates: null,
        counts: { national: null, subdivision: null },
        error: upstreamCallFailure(
          "holidays",
          null,
          `subdivision code is not a usable string (${JSON.stringify(subdivisionCode)}), so the holiday calendar was never requested`
        ),
      };
    }
    const national = await this.listHolidaysResult({ countryCode, year });
    if (national.error) {
      return { holidays: null, dates: null, counts: { national: null, subdivision: null }, error: national.error };
    }
    if (national.holidays.length === 0) {
      return {
        holidays: null,
        dates: null,
        counts: { national: 0, subdivision: null },
        error: upstreamCallFailure(
          "holidays",
          null,
          `Remote returned an empty national holiday list for ${String(countryCode)} ${String(year)} — the year is not populated, which is not the same fact as "no holidays"`
        ),
      };
    }

    let subdivisionRows = null;
    if (subdivisionCode !== null && subdivisionCode !== undefined) {
      const sub = await this.listHolidaysResult({ countryCode, year, subdivisionCode });
      // A FAILED SUBDIVISION LEG FAILS THE WHOLE CALENDAR. Returning the
      // national list alone here would hand back exactly the plausible,
      // well-formed, wrong answer this method exists to prevent — and it would
      // be indistinguishable at the call site from a correct union.
      if (sub.error) {
        return { holidays: null, dates: null, counts: { national: national.holidays.length, subdivision: null }, error: sub.error };
      }
      subdivisionRows = sub.holidays;
    }

    const merged = mergeHolidayCalendars(national.holidays, subdivisionRows ?? []);
    return {
      holidays: merged,
      dates: holidayDates(merged),
      counts: { national: national.holidays.length, subdivision: subdivisionRows ? subdivisionRows.length : null },
      error: null,
    };
  }

  /**
   * The union calendar, or NULL when it could not be read — the same
   * null-means-not-confirmed convention `getEmployment()`, `listCountries()`
   * and `listPayrollRuns()` use, for callers that do not need to record WHY.
   * Never `[]` on a failure: see the sibling above.
   * @param {{countryCode?: string, year?: number|string, subdivisionCode?: string|null}} args
   * @returns {Promise<object[]|null>}
   */
  async listHolidays(args = {}) {
    const { holidays } = await this.listHolidayCalendarResult(args);
    return holidays;
  }

  /**
   * GET /v1/countries/:code/employment_basic_information — the dynamic
   * per-country JSON Schema (00-FOUNDATION.md §4 invariant #2). UC-06 must
   * validate any amendment payload against this before drafting it — never
   * assume a static field set. Shape returned: `{required: string[]}`,
   * matching what `schemaValidator.validateAgainstSchema()` expects.
   *
   * RETURNS null WHEN THE SCHEMA COULD NOT BE FETCHED — never `{required: []}`
   * (finding F-15). Those two values look alike and mean opposite things:
   * "this country genuinely requires no extra fields" is a schema, and
   * "we never got a schema" is the absence of one. Because
   * `validateAgainstSchema()` passes vacuously against an empty required
   * list, returning the empty-list stand-in on a 404 turned invariant #2
   * ("dynamic per-country schema validation before any write") into a
   * formality that always said yes — proven live: DE/GB/PL/CH all 404'd on
   * the mock and every amendment for them passed with zero flags. Callers
   * must treat null as "unknown" and escalate; see
   * src/uc06/policyEngine.js's schema gate.
   *
   * A response whose `required` is not an array is also null: an unusable
   * shape is not a schema either, and silently coercing it back to `[]` is
   * the same failure with an extra step.
   *
   * THIS ENDPOINT IS KEYED ON ALPHA-3, AND THAT IS THE SECOND HALF OF FINDING
   * F-27 — the half that stayed dead after the first half was fixed.
   * Remote's own reference for `GET /v1/countries/{country_code}/{form}` says
   * of the path parameter, verbatim: *"Country code according to ISO 3-digit
   * alphabetic codes"*, `"example": "PRT"`. Verified live 2026-08-17 against
   * gateway.remote-sandbox.com — `DEU`/`CAN`/`ESP`/`USA`/`NGA`/`GBR` all
   * answer 200, and `DE`/`CA`/`ES`/`US`/`NG`/`GB` all answer
   * `404 {"message":"Country not found"}`.
   *
   * Meanwhile `normalizeEmployment()` deliberately yields the ALPHA-2 code,
   * because that is the axis every *comparison* gate needs (UC-05's statutory
   * notice table, UC-09's high-tax list, UC-03's destinations). Both are
   * right; they are different axes for different purposes. So the conversion
   * belongs HERE, at the one place that knows which axis this endpoint
   * speaks — not at each call site, and not by widening
   * `normalizeEmployment()` into carrying a second code that every unrelated
   * consumer would then have to choose between.
   *
   * The mapping is NOT a hard-coded 249-entry table (prime directive #4 — this
   * repo refuses to invent one; UC-03 drops rows rather than convert). It is
   * read from `GET /v1/countries`, which returns BOTH forms per row — `code`
   * (alpha-3) and `alpha_2_code` — for all 224 rows, with no duplicate
   * alpha-2 keys (verified live). That is an authoritative mapping from the
   * API itself. It costs one extra fetch, cached for the life of the client
   * and shared by concurrent callers, against the alternative of inventing
   * data — which is not a trade this repo makes.
   *
   * FAILS CLOSED. A code that cannot be resolved to alpha-3 — unknown country,
   * malformed input, or an unreadable `/v1/countries` — returns null WITHOUT
   * calling the schema endpoint, because the only alternative is guessing a
   * country code, and a wrong one gets acted on while a missing one gets
   * investigated. Callers already read null as "unknown" and escalate
   * (`country_schema_unavailable`), so a resolver outage is recorded as
   * "we have no schema", which is exactly what is true.
   * @param {string} countryCode  ISO 3166-1 alpha-2 ("DE") or alpha-3 ("DEU")
   * @returns {Promise<{required: string[]}|null>}
   */
  async getCountrySchema(countryCode) {
    const alpha3 = await this.#resolveAlpha3(countryCode);
    if (!alpha3) return null; // unresolvable -> no schema, never a guessed code
    const result = await this.#get(`/v1/countries/${alpha3}/employment_basic_information`);
    if (!result || !Array.isArray(result.required)) return null;
    return result;
  }

  // -------------------------------------------------------------------------
  // CONTRACT AMENDMENTS — the form UC-06 actually needs, and the write that
  // can actually run against an ACTIVE employment.
  // -------------------------------------------------------------------------
  // WHY THESE EXIST AT ALL, AND WHY `employment_basic_information` IS NOT THE
  // FORM UC-06 SHOULD HAVE BEEN VALIDATING AGAINST. Three independent facts,
  // each verified live against gateway.remote-sandbox.com on 2026-08-18:
  //
  //  1. THE FORM CANNOT EXPRESS THE AMENDMENT. `GET
  //     /v1/countries/{ALPHA3}/employment_basic_information` declares exactly
  //     ten properties — has_seniority_date, name, job_title,
  //     provisional_start_date, tax_servicing_countries, tax_job_category,
  //     login_email, personal_email, seniority_date, work_email — with
  //     `additionalProperties: false`. There is NO salary property and NO
  //     hours property [CONFIRMED]. UC-06's headline case is a salary change.
  //  2. THE METHOD DOES NOT EXIST. `PATCH /v1/employments/{id}/basic-information`
  //     answers `404 "Not Found"` for every employment id and every status
  //     tried [CONFIRMED]. The documented verb is `PUT`, and its body is
  //     enveloped: `{}` -> `422 {"errors":{"basic_information":["Missing field"]}}`.
  //  3. THE STATUS SET EXCLUDES `active`. Remote's own reference for
  //     `PUT /v1/employments/{id}/basic-information` states verbatim:
  //     *"Supported employment statuses: `created`, `job_title_review`,
  //     `created_reserve_paid`, `created_awaiting_reserve`"* [CONFIRMED,
  //     developer.remote.com]. `active` is the ONLY status UC-06's own gate 2
  //     admits, so that write could never have succeeded for any employment
  //     its own gates let through. (The Sandbox validates the form before it
  //     checks status, so this one is confirmed from the reference rather than
  //     from a live refusal — confirming it live would require sending a
  //     COMPLETE valid payload to a live active employment, i.e. performing
  //     the very write in question. Tagged accordingly rather than overstated.)
  //
  // The right surface is the Contract Amendments family, and it works on
  // active employments — proven live, see checkContractAmendmentAutomatable()
  // below. `patchEmploymentBasicInformation()` is kept further down because
  // other use cases' TESTS use it to mutate the mock's fixtures, but it is no
  // longer UC-06's write and its header says so.

  /**
   * GET /v1/contract-amendments/schema — the country-specific JSON Schema for
   * a contract amendment to THIS employment. This is the form UC-06 validates
   * against; `getCountrySchema()` below answers a different question
   * (onboarding basic information) and is kept for callers that want it.
   *
   * QUERY PARAMETERS ARE [CONFIRMED] against Remote's own OpenAPI definition
   * for `get_v1_contract-amendments_schema`: `employment_id` (required),
   * `country_code` (required, *"Country code according to ISO 3-digit
   * alphabetic codes"*, example `CAN`), and optional `form`
   * (enum: `contract_amendment`) and `json_schema_version` (default `latest`).
   * `form` is sent explicitly because a default is a thing that can change.
   *
   * LIVE RESULTS, 2026-08-18, one call per (country, employment_model) pair
   * across all 81 active Sandbox employments:
   *   NLD/DEU/GBR/FRA/CAN/SGP/PRT, eor + global_payroll -> 200
   *   every `contractor`                                -> 404 "Not Found"
   *   USA (both models)                                 -> 500 (Sandbox-side)
   * Live NLD `required`: annual_gross_salary, effective_date, job_title,
   * role_description, contract_duration_type, work_schedule,
   * work_hours_per_week — plus `additionalProperties: false`, a `properties`
   * block of 25 fields, and an `allOf` of 15 if/then/else rules that the API
   * genuinely enforces (see effectiveSchema() in src/uc06/policyEngine.js).
   *
   * RETURNS null WHEN THE SCHEMA COULD NOT BE FETCHED — never `{required: []}`,
   * the same F-15 rule getCountrySchema() documents at length: an empty
   * required list validates literally any payload, so returning one on a 404
   * turns invariant #2 into a gate that always opens. A contractor's 404 and
   * a USA 500 both land here, and both must escalate rather than validate.
   *
   * @param {string} employmentId
   * @param {string} countryCode  alpha-2 ("NL") or alpha-3 ("NLD")
   * @returns {Promise<object|null>} the whole schema object, not just `required`
   */
  async getContractAmendmentSchema(employmentId, countryCode) {
    if (typeof employmentId !== "string" || employmentId.trim() === "") return null;
    const alpha3 = await this.#resolveAlpha3(countryCode);
    if (!alpha3) return null; // unresolvable -> no schema, never a guessed code
    const query = new URLSearchParams({
      employment_id: employmentId,
      country_code: alpha3,
      form: "contract_amendment",
    });
    // A 500 is not a 404: #get() throws on it, and a thrown schema fetch would
    // take down a decision that should instead be recorded as "no schema".
    // Live, USA answers 500 for every employment, so this is not hypothetical.
    let result;
    try {
      result = await this.#get(`/v1/contract-amendments/schema?${query}`);
    } catch {
      return null;
    }
    if (!result || !Array.isArray(result.required)) return null;
    return result;
  }

  /**
   * POST /v1/contract-amendments/automatable — a CHECK, not a write.
   *
   * Remote's reference: *"Check if a contract amendment request is automatable.
   * If the contract amendment request is automatable, then after submission, it
   * will instantly amend the employee's contract"* — i.e. it validates the
   * payload and reports whether submitting it would apply instantly. Nothing is
   * created. It is the only way to ask Remote "would this payload be accepted?"
   * without accepting the consequence of it being accepted, which is exactly
   * what a system that must not guess wants before a payroll-affecting write.
   *
   * Live 2026-08-18 on the active NL employment 75b88008-…, a payload sourced
   * entirely from that record's own fields answered
   * `200 {"data":{"automatable":false,"message":"By pressing 'Submit amendment
   * request' you will begin the contract adjustement process…"}}`, and the
   * same payload with one undeclared key added answered
   * `422 {"errors":{"base_salary":["is not accepted"]}}` — so
   * `additionalProperties: false` is enforced by the API, not merely declared.
   *
   * @param {{employmentId: string, amendmentContractId: string, contractAmendment: object}} args
   * @returns {Promise<{ok: boolean, status: number, body: object|null}>}
   *   Never throws on a 422: "this payload would be rejected, here is why" is
   *   an ANSWER, and the caller records it. Only a transport failure throws.
   */
  async checkContractAmendmentAutomatable({ employmentId, amendmentContractId, contractAmendment }) {
    const url = `${this.baseUrl}/v1/contract-amendments/automatable`;
    const res = await this.#fetchWithRetry(
      url,
      {
        method: "POST",
        headers: this.#writeHeaders(null),
        body: JSON.stringify({
          employment_id: employmentId,
          amendment_contract_id: amendmentContractId,
          contract_amendment: contractAmendment,
        }),
      },
      `Remote API POST /v1/contract-amendments/automatable failed`
    );
    let body = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    return { ok: res.ok, status: res.status, body: body?.data ?? body };
  }

  /**
   * POST /v1/contract-amendments — UC-06's ONE write, and only after both
   * approvals are in (see uc06/workflow.js).
   *
   * BODY SHAPE IS [CONFIRMED] against Remote's OpenAPI `CreateContractAmendmentParams`:
   * `{employment_id, amendment_contract_id, contract_amendment}`, all three
   * REQUIRED, `additionalProperties: false`. `contract_amendment` is the
   * country-specific object whose shape getContractAmendmentSchema() returns.
   *
   * `amendment_contract_id` is *"The contract ID of the contract that needs to
   * be amended"* and comes from the employment record's `active_contract_id`
   * [CONFIRMED live 2026-08-18 — the real value answers 200 through
   * /automatable, and a syntactically valid but unknown uuid answers
   * `404 {"message":"amended_contract_not_found"}`, so the field is genuinely
   * resolved server-side rather than echoed].
   *
   * The payload must already be schema-validated, type-coerced and money-scaled
   * by the caller — the same division of responsibility every other write here
   * has. This method does not re-check any of it.
   *
   * @param {{employmentId: string, amendmentContractId: string, contractAmendment: object}} args
   * @param {{idempotencyKey?: string|null}} [opts]
   */
  async createContractAmendment(
    { employmentId, amendmentContractId, contractAmendment },
    { idempotencyKey = null } = {}
  ) {
    const errLabel = `Remote API POST /v1/contract-amendments failed`;
    const res = await this.#fetchWithRetry(
      `${this.baseUrl}/v1/contract-amendments`,
      {
        method: "POST",
        headers: this.#writeHeaders(idempotencyKey),
        body: JSON.stringify({
          employment_id: employmentId,
          amendment_contract_id: amendmentContractId,
          contract_amendment: contractAmendment,
        }),
      },
      errLabel
    );
    if (!res.ok) {
      // The 422 body names the offending fields; losing it would leave a
      // failed payroll amendment with nothing to triage.
      let detail = "";
      try {
        detail = JSON.stringify(await res.json()).slice(0, 500);
      } catch {
        detail = "";
      }
      throw new Error(`${errLabel}: ${res.status}${detail ? ` ${detail}` : ""}`);
    }
    const body = await res.json();
    return body.data ?? body;
  }

  /**
   * Whatever axis the caller holds -> the ISO 3166-1 alpha-3 form this API's
   * country-scoped paths require, or null when that cannot be established.
   *
   * An already-alpha-3 code passes through unresolved: it needs no mapping,
   * and requiring a `/v1/countries` round-trip to confirm it would make a
   * countries-list outage break calls that would otherwise have worked.
   * A wrong alpha-3 simply 404s at the schema endpoint, which is already
   * handled as "no schema".
   * @param {unknown} countryCode
   * @returns {Promise<string|null>}
   */
  async #resolveAlpha3(countryCode) {
    if (typeof countryCode !== "string") return null;
    const code = countryCode.trim().toUpperCase();
    if (/^[A-Z]{3}$/.test(code)) return code;
    if (!/^[A-Z]{2}$/.test(code)) return null; // not a country code at all
    const map = await this.#alpha2ToAlpha3();
    return map.get(code) ?? null; // unknown country -> fail closed
  }

  /**
   * Whatever axis the caller holds -> the ISO 3166-1 alpha-2 form every
   * comparison SET in this repo is written in, or null.
   *
   * The mirror of #resolveAlpha3(), and it exists for one reason: this API
   * hands out BOTH axes under names that do not distinguish them.
   * `CompanyLegalEntity.country_code` is alpha-3 ("USA", "CAN", "NLD"
   * [CONFIRMED live 2026-08-19]) while `normalizeEmployment()` deliberately
   * produces alpha-2 under THE SAME FIELD NAME — two fields, one name, two
   * alphabets, and no way for a reader holding one to know which it is. That
   * is finding F-27's exact shape, and F-27 cost UC-03 its entire ability to
   * succeed in production for weeks.
   *
   * An already-alpha-2 code passes through unresolved, for the same reason an
   * alpha-3 does in the sibling method: it needs no mapping, and requiring a
   * `/v1/countries` round-trip to confirm it would make a registry outage break
   * calls that would otherwise have worked.
   *
   * FAILS CLOSED to null — never to the alpha-3 value it was handed. A code we
   * cannot place on the alpha-2 axis is a code no gate may compare, and every
   * consumer in this repo already reads null as "not confirmed".
   * @param {unknown} countryCode
   * @returns {Promise<string|null>}
   */
  async #resolveAlpha2(countryCode) {
    if (typeof countryCode !== "string") return null;
    const code = countryCode.trim().toUpperCase();
    if (/^[A-Z]{2}$/.test(code)) return code;
    if (!/^[A-Z]{3}$/.test(code)) return null; // not a country code at all
    const index = await this.#countryIndex();
    return index.alpha3ToAlpha2.get(code) ?? null; // unknown country -> fail closed
  }

  /**
   * The alpha-2 -> alpha-3 map from `GET /v1/countries`, fetched at most once
   * per client. The in-flight PROMISE is cached, not just the result, so
   * concurrent callers share one request rather than racing several.
   *
   * A failed or unreadable fetch yields an EMPTY map and is not cached, so the
   * next call retries: every lookup against it misses, which is the fail-closed
   * answer, while a transient outage does not poison the client for its
   * lifetime. Rows missing either code are skipped — a half-row cannot map.
   * @returns {Promise<Map<string,string>>}
   */
  async #alpha2ToAlpha3() {
    return (await this.#countryIndex()).alpha2ToAlpha3;
  }

  /**
   * BOTH directions of the ISO axis, plus each country's name, built from ONE
   * `GET /v1/countries` fetch — which returns `code` (alpha-3) and
   * `alpha_2_code` for all 224 rows, with no duplicate keys in either
   * direction (verified live). That is an authoritative mapping FROM THE API
   * ITSELF, which is why this repo can convert at all: prime directive #4
   * forbids inventing a 249-entry table, and there is no third option — a
   * caller holding the wrong axis and no mapping can only drop the value.
   *
   * One fetch serves both maps because the alpha-3-keyed paths
   * (`/v1/countries/{alpha3}/…`) and the alpha-2-keyed comparison sets are the
   * same registry read; two caches would double the traffic and could disagree.
   *
   * A failed or unreadable fetch yields EMPTY maps and is NOT cached, so the
   * next call retries: every lookup misses, which is the fail-closed answer,
   * while a transient outage does not poison the client for its lifetime. Rows
   * missing either code are skipped — a half-row cannot map.
   * @returns {Promise<{alpha2ToAlpha3: Map<string,string>, alpha3ToAlpha2: Map<string,string>, names: Map<string,string>}>}
   */
  #countryIndex() {
    if (this._alpha3MapPromise) return this._alpha3MapPromise;
    const promise = (async () => {
      let list = null;
      try {
        const result = await this.#get(`/v1/countries`);
        list = Array.isArray(result) ? result : result?.countries;
      } catch {
        list = null; // unreadable list -> empty maps -> every lookup fails closed
      }
      const alpha2ToAlpha3 = new Map();
      const alpha3ToAlpha2 = new Map();
      const names = new Map();
      if (Array.isArray(list)) {
        for (const row of list) {
          const alpha2 = typeof row?.alpha_2_code === "string" ? row.alpha_2_code.trim().toUpperCase() : null;
          const alpha3 = typeof row?.code === "string" ? row.code.trim().toUpperCase() : null;
          if (alpha2 && /^[A-Z]{2}$/.test(alpha2) && alpha3 && /^[A-Z]{3}$/.test(alpha3)) {
            alpha2ToAlpha3.set(alpha2, alpha3);
            alpha3ToAlpha2.set(alpha3, alpha2);
            if (typeof row?.name === "string") names.set(alpha2, row.name);
          }
        }
      }
      // Empty maps mean the fetch failed or answered an unusable shape.
      // Drop the cache so the next call retries instead of the client
      // answering "no such country" for everything for the rest of its life.
      if (alpha2ToAlpha3.size === 0) this._alpha3MapPromise = null;
      return { alpha2ToAlpha3, alpha3ToAlpha2, names };
    })();
    this._alpha3MapPromise = promise;
    return promise;
  }

  /**
   * GET /v1/payroll-runs — the payroll cycle calendar (period + cutoff dates)
   * UC-06's cutoff engine evaluates an amendment's effective date against.
   *
   * THE PATH USED TO BE `/v1/company-payroll-runs`, WHICH DOES NOT EXIST.
   * Remote's own index (docs/REMOTE-API-INDEX.txt) lists this operation as
   * *"List Company Payroll Runs — Lists all payroll runs for a company"*, and
   * its reference id is `get_v1_payroll-runs`. "Company Payroll Runs" is the
   * TITLE; `/v1/payroll-runs` is the path. A previous pass turned the title
   * into a path, and the mock server then implemented the invented path too —
   * so the fixture agreed with the code and neither agreed with Remote. That is
   * the same failure mode as UC-03's alpha-3 country list, one layer over: not
   * a wrong field this time, a wrong URL.
   *
   * It hid especially well because the wrong path 404s, and this client maps
   * 404 -> null, which the caller correctly records as an upstream failure and
   * escalates. So UC-06's payroll gate ESCALATED EVERY SINGLE TIME on the live
   * path, and looked exactly like a cautious gate doing its job. The previous
   * pass even verified the 404 live and wrote it down as a fact about Remote
   * ("404 on the real Sandbox for every company id, including valid ones")
   * rather than as a fact about the URL. Verified live 2026-08-18, same token,
   * same container: `/v1/company-payroll-runs` -> 404 `"Not Found"` (a bare
   * string, the router's 404, not an API record-not-found body), while
   * `/v1/payroll-runs` -> 200 with 17 real cycles.
   *
   * WHAT THE LIVE ENDPOINT ACTUALLY DOES, all [CONFIRMED] 2026-08-18:
   *   - Envelope is `{data: {total_count, current_page, total_pages,
   *     payroll_runs: [...]}}`. Row keys: id, status, type, country
   *     {code, name, alpha_2_code}, currency_code, period_start, period_end,
   *     cutoff_date, expected_payout_date, approval_date, total_payroll_cost.
   *     There is no `process_date` or `pay_date`, whatever cutoffEngine's
   *     JSDoc example says.
   *   - IT TAKES NO FILTERS. `company_id`, `country_code`, `country` and
   *     `status` each answer 422 `{"errors":{"<field>":["Unexpected field"]}}`.
   *     The company comes from the token's scope, which is why this method no
   *     longer accepts a company id: there was never a parameter to put it in.
   *   - `total_pages` IS WRONG. It reports 1 while `?page=2` returns 14 more
   *     rows. `total_count` reports 17 while a full walk yields 34 rows. So
   *     pagination terminates on an EMPTY PAGE, never on `total_pages` — a
   *     client that trusted it would silently see a partial calendar, and a
   *     missing cycle reads as "no cycle governs this date", which is a
   *     positive claim derived from a truncated read.
   *   - ROWS REPEAT. A full walk returns 34 rows for 17 distinct ids. Deduped
   *     by id here, because two copies of one cycle are a transport artifact,
   *     not two cycles.
   *
   * WHY A COUNTRY IS REQUIRED, AND WHY NO COUNTRY MEANS NULL. The calendar is
   * company-wide and multi-country — live it spans SG, FR, CA, NL and US — and
   * the periods OVERLAP across countries (49 overlapping pairs live). UC-06's
   * `evaluateCutoff()` picks the first cycle whose period contains the
   * effective date and reads its `cutoff_date`; handed the unfiltered calendar
   * it would happily hand a French employee Singapore's 6 April cutoff instead
   * of France's 20 April one. Repointing the path WITHOUT filtering would
   * therefore have converted a gate that always escalates into a gate that
   * sometimes decides payroll timing from the wrong country's lock — trading a
   * visible failure for a silent wrong answer, which is the trade this
   * codebase exists to refuse.
   *
   * The API will not filter, so the filter is here, client-side, on
   * `country.alpha_2_code` — the same axis `normalizeEmployment()` yields, so
   * no conversion table is invented to compare them (prime directive #4).
   * Without a usable alpha-2 code this method returns null rather than the
   * unfiltered calendar: "we cannot say which cycle governs this employee" is
   * the truth, and null is already the value every caller escalates on. That
   * keeps today's fail-closed behaviour exactly while making the success path
   * REACHABLE for a caller that names the country — which is the whole point,
   * since a gate that cannot succeed is indistinguishable from one refusing
   * correctly (UC-03's lesson, and this method's own).
   *
   * NOTE FOR THE CALLER: `src/uc06/workflow.js` still calls this positionally
   * with a company id. That call now lands on the no-country path and returns
   * null, i.e. it behaves exactly as it does today (escalate), rather than
   * silently gaining a wrong-country answer. Passing `{countryCode:
   * employment.country_code}` is what switches its payroll gate on.
   *
   * @param {{countryCode?: string|null}} [options] `countryCode` is ISO 3166-1
   *   alpha-2 ("FR"), matching `normalizeEmployment().country_code`.
   * @returns {Promise<{payroll_runs: object[]}|null>} null when the calendar
   *   could not be read, or when no usable country was named
   */
  async listPayrollRuns(options = {}) {
    const { payrollRuns, error } = await this.listPayrollRunsResult(options);
    // THE THROW IS PRESERVED HERE ON PURPOSE. This method's contract — null on
    // a 404 or an unusable country, throw on anything else — is what
    // `src/uc06/workflow.js` and the parity fixtures are written against, and
    // widening it silently is how two callers come to disagree about what a
    // failure means. Callers that need the DISTINCTION call
    // listPayrollRunsResult() below and get it without an exception.
    if (error && error.kind !== UPSTREAM_NOT_FOUND && error.thrown) throw error.thrown;
    return payrollRuns === null ? null : { payroll_runs: payrollRuns };
  }

  /**
   * The same read as `listPayrollRuns()`, answering the question that method
   * structurally cannot: WHY there is no calendar.
   *
   * "No payroll cycle covers this date" and "we could not ask" are opposite
   * facts that both arrive as an absence, and UC-06's cutoff gate escalates on
   * either — so until now the audit row said `noMatchingCycle` for a 403 as
   * readily as for a genuinely quiet calendar, and the Node path could not
   * report a payroll upstream failure at all (the gate that exists for it was
   * reachable only from n8n, whose HTTP node surfaces the status). Three
   * outcomes are now distinct, using `src/shared/upstreamFailure.js`'s
   * vocabulary so the reason string ranks in the metrics dashboard beside every
   * other upstream failure rather than as a UC-06 dialect:
   *
   *   - `{payrollRuns: [...], error: null}`   the calendar was read. An empty
   *     array means Remote genuinely returned no cycles for that country.
   *   - `{payrollRuns: null, error: {kind: "not_found", status: 404}}`
   *     Remote answered authoritatively about the calendar.
   *   - `{payrollRuns: null, error: {kind: "unreachable", status}}`   a 403, a
   *     5xx, a transport failure, an envelope this endpoint does not send, or
   *     no usable country to narrow by — in every one of which NOTHING about
   *     this employee's payroll timing is knowable.
   *
   * A COUNTRY WE CANNOT NAME IS `unreachable`, NOT `not_found`. The request was
   * never sent, so Remote said nothing about anything; reporting it as a 404
   * would be this client asserting an answer on Remote's behalf. It stays an
   * escalation either way — only the recorded reason changes, which is the only
   * thing this method is for.
   *
   * IT DOES NOT THROW FOR AN HTTP FAILURE. A throw out of the payroll read
   * propagates through `src/uc06/workflow.js` above its audit write, so a 503
   * loses the decision entirely — no record, no human told. That is finding
   * F-28's shape (`ptoPayout.js`'s header) one use case over, and returning the
   * failure instead of raising it is what closes it. A genuine programming
   * error is still raised: only errors carrying an HTTP `status`, and transport
   * errors the client itself tagged `retryable`, are converted.
   *
   * @param {{countryCode?: string|null}|string} [options]
   * @returns {Promise<{payrollRuns: object[]|null,
   *   error: {call:string, status:number|null, kind:string, message:string, thrown?:Error}|null}>}
   */
  async listPayrollRunsResult(options = {}) {
    // A bare string is the legacy positional company-id call. It is not a
    // country, and the API has no company parameter, so there is nothing to
    // honour — it falls through to the fail-closed null below.
    const requested = typeof options === "string" ? null : options?.countryCode;
    if (!isWellFormedCountryCode(requested)) {
      return {
        payrollRuns: null,
        error: {
          call: "payroll_runs",
          status: null,
          kind: UPSTREAM_UNREACHABLE,
          message:
            "no usable alpha-2 country code for this employment, so the company-wide payroll calendar was never requested",
        },
      };
    }
    const wanted = normalizeCountryCode(requested);

    const byId = new Map();
    // `page_size=100` in one request would very likely cover this calendar, but
    // "very likely" is how a truncated read becomes a confident wrong answer.
    // The loop stops on a genuinely empty page, which is the only signal this
    // endpoint gives that is not demonstrably wrong.
    const PAGE_SIZE = 100;
    const MAX_PAGES = 50; // a broken pager must not spin forever
    for (let page = 1; page <= MAX_PAGES; page += 1) {
      let data;
      try {
        data = await this.#get(`/v1/payroll-runs?page=${page}&page_size=${PAGE_SIZE}`);
      } catch (err) {
        // Only a failure the client can attribute is converted. A TypeError
        // from a bug in this file must still surface as a crash — swallowing it
        // would turn a defect into a permanently escalating gate, which is the
        // failure shape this whole method's history is made of.
        if (!Number.isInteger(err?.status) && err?.retryable !== true) throw err;
        return { payrollRuns: null, error: payrollFailure(err.status ?? null, err.message, err) };
      }
      // 404 -> null from #get.
      if (!data) return { payrollRuns: null, error: payrollFailure(404, "Remote answered 404 for the payroll calendar") };
      const batch = data.payroll_runs;
      // An unusable shape is not an empty calendar, for the same reason a failed
      // fetch is not: coercing it to [] would re-teach the conflation this
      // method was rewritten to remove.
      if (!Array.isArray(batch)) {
        return {
          payrollRuns: null,
          error: payrollFailure(null, "the payroll calendar answered a shape this endpoint does not send"),
        };
      }
      if (batch.length === 0) break;
      for (const run of batch) {
        if (!run) continue;
        // A row with no id cannot be deduped, so it is kept under a key that
        // collides with nothing. Dropping it would be the silent short read this
        // whole method exists to prevent — a lost cycle reads downstream as "no
        // cycle governs this date", which is a claim, not an absence.
        const key = run.id != null ? `id:${run.id}` : `anon:${page}:${byId.size}`;
        if (!byId.has(key)) byId.set(key, run);
      }
    }

    return {
      payrollRuns: [...byId.values()]
        .filter((run) => normalizeCountryCode(run?.country?.alpha_2_code) === wanted)
        .map(normalizePayrollRun),
      error: null,
    };
  }

  /**
   * PATCH /v1/employments/:id/basic-information — NO LONGER UC-06's WRITE, AND
   * NOT AN ENDPOINT REMOTE HAS. Kept only because several other use cases'
   * TESTS use it to mutate the mock server's employment fixtures (flipping a
   * status to `terminated` and back); `src/remote/mockServer.js` implements it
   * for exactly that purpose and says so.
   *
   * WHAT IS ACTUALLY TRUE OF THIS PATH, verified live 2026-08-18 against
   * gateway.remote-sandbox.com:
   *   PATCH /v1/employments/{id}/basic-information -> 404 "Not Found", on
   *     every status tried (active, created, created_reserve_paid). The verb
   *     does not exist. [CONFIRMED]
   *   PUT   /v1/employments/{id}/basic-information with `{}` ->
   *     422 {"errors":{"basic_information":["Missing field"]}} — so the real
   *     body is ENVELOPED as `{basic_information: {...}}`, which this method
   *     never sent. [CONFIRMED]
   *   Remote's reference for the PUT: *"Supported employment statuses:
   *     `created`, `job_title_review`, `created_reserve_paid`,
   *     `created_awaiting_reserve`"* — not `active`. [CONFIRMED, docs]
   *   The form it validates against (`employment_basic_information`) has no
   *     salary and no hours property at all. [CONFIRMED]
   *
   * So this call could never have applied a salary amendment to an active
   * employee, in three independent ways at once. UC-06 now writes through
   * `createContractAmendment()` above. Nothing in `src/` calls this any more.
   *
   * @param {string} id  employment id
   * @param {object} payload  fields to change (mock-server fixture mutation)
   */
  async patchEmploymentBasicInformation(id, payload, { idempotencyKey = null } = {}) {
    const errLabel = `Remote API PATCH /v1/employments/${id}/basic-information failed`;
    const res = await this.#fetchWithRetry(
      `${this.baseUrl}/v1/employments/${encodeURIComponent(id)}/basic-information`,
      {
        method: "PATCH",
        headers: this.#writeHeaders(idempotencyKey),
        body: JSON.stringify(payload),
      },
      errLabel
    );
    if (!res.ok) throw new Error(`${errLabel}: ${res.status}`);
    const body = await res.json();
    return body.data ?? body;
  }

  /**
   * UC-02 reads/write — see docs/verification/uc02-expense-endpoints.md for
   * what is verified against developer.remote.com. The expense RECORD shape
   * itself is [INFERRED] (the verification pass confirmed endpoints, not the
   * full object schema); all amounts are integers ×100.
   */

  /**
   * GET /v1/expenses/:id — one expense record. Returns null on 404 (the
   * caller's policy engine turns a missing record into an escalation, exactly
   * like getEmployment's null convention).
   *
   * THE SAME WRONG-NAMESPACE BUG AS THE CATEGORIES READ, found alongside it and
   * fixed here: this called `/v1/employee/expenses/:id`, which returns a bare
   * `"Not Found"` 404 for a company token on an expense id that provably
   * exists — while `/v1/expenses/:id` returns it. The sibling list endpoint
   * `/v1/employee/expenses` 403s outright with "invalid role for this
   * endpoint", which is the clearer tell that the whole `/v1/employee/`
   * namespace is employee-session-only. Verified live 2026-08-17:
   *
   *   GET /v1/employee/expenses            -> 403
   *   GET /v1/employee/expenses/242b8552-… -> 404 "Not Found"
   *   GET /v1/expenses/242b8552-…          -> 200 {"data":{"expense":{…}}}
   *   GET /v1/expenses?employment_id=…     -> 200 (220 records)
   *
   * A permanent 404 is worse than an error, because it is indistinguishable
   * from "this claim does not exist" — which is exactly how the gate recorded
   * it. Note the single-resource envelope nests under its own key
   * (`{data:{expense:…}}`), the same convention `getEmployment()` handles.
   *
   * RESOLVED 2026-08-17 — the remapping this comment used to warn about is
   * done. UC-02's gates now read the record's REAL fields (`amount`,
   * `currency:{code}`, `converted_amount`, `converted_currency:{code}`,
   * `tax_amount`, `converted_tax_amount`, `receipts[]`, `expense_date`,
   * `expense_category:{code}`) instead of the invented `total_amount` /
   * `category_id` / `lines` set. No normalization happens HERE, deliberately:
   * the client returns Remote's record verbatim and `src/uc02/policyEngine.js`
   * reads it as-is, so there is no second shape in the system for a fixture to
   * drift against. See that file's header for what replaced the line-sum gate.
   *
   * @param {string} id
   */
  async getExpense(id) {
    const result = await this.#get(`/v1/expenses/${encodeURIComponent(id)}`);
    return result?.expense ?? result;
  }

  /**
   * GET /v1/expenses/categories — the effective expense-category hierarchy.
   *
   * WHY NOT `/v1/employee/expense-categories`, WHICH THIS USED TO CALL.
   * That endpoint 403s with `{"message":"Forbidden, invalid role for this
   * endpoint"}`, and it was recorded here for a while as "the sandbox token
   * lacks the right role" — a credential problem needing new credentials. It is
   * not. It is the wrong endpoint, and no token this service can hold will ever
   * open it. Its own title is "List expense categories for the authenticated
   * EMPLOYEE"; its `security` block is `OAuth2Assertion` over an employee
   * session, and it returns the categories "applicable to the current employee"
   * under that employee's visibility rules. UC-02 is an unattended automation
   * acting as a system actor — it holds a company `CustomerAPIToken` and
   * structurally cannot hold an employee session (that is the whole reason
   * 00-FOUNDATION.md prefers REST over Remote's user-OAuth MCP). The
   * company-side equivalent is this endpoint, whose `security` block is exactly
   * `CustomerAPIToken`/`OAuth2AuthorizationCode`.
   *
   * Verified live 2026-08-17 against gateway.remote-sandbox.com:
   *   /v1/employee/expense-categories                  -> 403
   *   /v1/expenses/categories?employment_id=3537d9ee-… -> 200, 32 rows
   *   /v1/expenses/categories?country_code=ESP         -> 200, 32 rows
   *   /v1/expenses/categories?country_code=ES          -> 422 (alpha-2 refused)
   *   /v1/expenses/categories                          -> 422 (no discriminator)
   *
   * THE DISCRIMINATOR IS REQUIRED — "At least one of employment_id, expense_id,
   * or country_code must be provided." A call with none is a 422, so this method
   * refuses to make it rather than letting it fail at runtime: an upstream 422
   * would escalate a claim that had nothing wrong with it, blaming Remote for a
   * caller's omission.
   *
   * `employmentId` is preferred and `countryCode` is the fallback, for two
   * reasons. Accuracy: the employment filter applies the employee's real
   * country AND legal-entity visibility, which is precisely the list the gate
   * claims to be validating against, while a country filter is coarser.
   * Safety: `country_code` wants ISO 3166-1 **alpha-3** ("ESP"), and this repo
   * has already shipped one alpha-2/alpha-3 confusion to production (UC-03's
   * supported-countries gate), with `normalizeEmployment()` still carrying the
   * same latent fallback. UC-02 always has an employment id — it is a required
   * field of the submission and identity is verified against it — so the
   * fragile axis is the one we avoid depending on.
   *
   * Returns the flat array from the `{data:[…]}` envelope. Row shape and the
   * selectability rules are documented in src/uc02/expenseCategories.js.
   *
   * @param {object} opts
   * @param {string|null} [opts.employmentId] preferred discriminator
   * @param {string|null} [opts.countryCode]  fallback; ISO 3166-1 alpha-3
   * @param {boolean} [opts.includeParents]   include non-selectable parent nodes
   * @returns {Promise<object[]|null>} the category rows, or null on a 404
   */
  async getExpenseCategories({ employmentId = null, countryCode = null, includeParents = false } = {}) {
    const params = new URLSearchParams();
    if (typeof employmentId === "string" && employmentId) {
      params.set("employment_id", employmentId);
    } else if (typeof countryCode === "string" && countryCode) {
      const alpha3 = countryCode.toUpperCase();
      // Refused here rather than sent: `?country_code=ES` is a live 422
      // ({"errors":{"country_code":["is invalid"]}}), and a silently-wrong
      // country filter is worse than a loud refusal — it would return SOME
      // list, which the gate would then validate against in good faith.
      if (!/^[A-Z]{3}$/.test(alpha3)) {
        throw new Error(
          `getExpenseCategories: countryCode must be an ISO 3166-1 alpha-3 code (e.g. "ESP"); got "${countryCode}"`
        );
      }
      params.set("country_code", alpha3);
    } else {
      throw new Error(
        "getExpenseCategories: employmentId or countryCode is required — " +
          "GET /v1/expenses/categories answers 422 without a discriminator"
      );
    }
    if (includeParents) params.set("include_parents", "true");
    const result = await this.#get(`/v1/expenses/categories?${params}`);
    // The real envelope is {data:[…]}, which #get already unwraps to the array.
    // The `?.categories` arm is NOT a second supported shape — it is a tripwire
    // for a fixture or proxy still serving the invented {data:{categories:[…]}}
    // wrapper this method used to return.
    return Array.isArray(result) ? result : (result?.categories ?? null);
  }

  /**
   * GET /v1/expenses — list expenses. Not used by the decision workflow (UC-02
   * always fetches by id, like UC-01's employment read); used by the demo
   * portal's expense picker, and kept for tooling.
   *
   * Company-side, for the same reason as getExpense()/getExpenseCategories():
   * `/v1/employee/expenses` answers 403 "Forbidden, invalid role for this
   * endpoint" to this service's token, always. Verified live 2026-08-17 —
   * `/v1/expenses?page_size=2` -> 200, `/v1/expenses?employment_id=…` -> 200
   * (220 records).
   *
   * `employmentId` is optional here (unlike the categories endpoint, which
   * requires a discriminator) but is worth passing when known: the unfiltered
   * list spans every employment in the account.
   *
   * @param {object} [opts]
   * @param {number} [opts.pageSize]
   * @param {string|null} [opts.employmentId]
   */
  async listExpenses({ pageSize = 50, employmentId = null } = {}) {
    const params = new URLSearchParams({ page_size: String(pageSize) });
    if (typeof employmentId === "string" && employmentId) params.set("employment_id", employmentId);
    return this.#get(`/v1/expenses?${params}`);
  }

  /**
   * Approve/decline a PENDING expense by setting its status field. UC-02 calls
   * this ONLY on the auto-approve path, after every deterministic gate has
   * passed; UC-08's no-execution-path discipline (writes reachable from zero
   * call sites, tested) means this method has exactly one caller in the whole
   * codebase.
   *
   * THE BODY IS A CLOSED SET, and that is the whole VAT-safety story. The
   * OpenAPI `UpdateExpenseParams` is a `oneOf` over exactly two shapes:
   *   ApproveExpenseParams  {status: "approved"}                — status only
   *   DeclineExpenseParams  {status: "declined", reason: string} — reason REQUIRED
   * There is no VAT-recovery field, no amount field, and no way to write one —
   * so this automation structurally cannot assert VAT recovery or alter a
   * figure, which is why policyEngine.js no longer needs a VAT gate to promise
   * it won't.
   *
   * METHOD: the docs publish this as `PUT /v1/expenses/{id}` (operationId
   * `patch_v1_expenses_id` — the id says PATCH, the path item says PUT). Probed
   * live 2026-08-17 against a real pending expense with an invalid status
   * value: PUT and PATCH BOTH return `422 parameter_value_invalid`, i.e. both
   * reach body validation, while POST to the same path is a 404. PATCH is kept
   * because a partial status update is what this is semantically, and because
   * it is what the live n8n graph's Approve node already sends.
   *
   * RESPONSE: `ExpenseResponse` nests under its own key — `{data:{expense:…}}`,
   * the same convention as `GET /v1/expenses/:id`. Unwrapping only `data` (as
   * this did) hands the caller `{expense:{…}}`, so `result.status` reads
   * `undefined` and a successful approval looks like it returned nothing. The
   * mock's old fixture returned the flatter `{data:expense}`, which is exactly
   * why no test caught it.
   *
   * @param {string} id  expense id
   * @param {object} body  `{status: "approved"}` or `{status: "declined", reason}`
   */
  async patchExpenseStatus(id, body, { idempotencyKey = null } = {}) {
    const errLabel = `Remote API PATCH /v1/expenses/${id} failed`;
    const res = await this.#fetchWithRetry(
      `${this.baseUrl}/v1/expenses/${encodeURIComponent(id)}`,
      {
        method: "PATCH",
        headers: this.#writeHeaders(idempotencyKey),
        body: JSON.stringify(body),
      },
      errLabel
    );
    if (!res.ok) throw new Error(`${errLabel}: ${res.status}`);
    const result = await res.json();
    const data = result.data ?? result;
    return data?.expense ?? data;
  }

  // -------------------------------------------------------------------------
  // UC-04 — work-authorization requests
  // -------------------------------------------------------------------------
  // THERE IS NO `POST` ON THIS RESOURCE, AND THIS CLIENT USED TO HAVE ONE.
  // `createWorkAuthorization()` lived here until 2026-08-19, POSTing to
  // `/v1/work-authorization-requests` on every UC-04 `ready_for_approval` and
  // every `escalate`. The comment that justified it cited "UC-04.md §3 lists
  // the endpoints as [CONFIRMED]" — and UC-04.md §3 says the OPPOSITE, in those
  // words: *"**no `POST`**; the request is created inside Remote's own 'Request
  // Hub' UI, not the partner API."* The spec was right the whole time; a
  // comment misread it, the code followed the misread, and
  // `src/remote/mockServer.js` then implemented the endpoint so the suite
  // agreed with the code. Neither was ever compared to Remote. That is the
  // fixture-agrees-with-the-code failure CLAUDE.md §4 names as this project's
  // most expensive recurring defect, and this is one instance of it removed.
  //
  // The method is DELETED rather than left in place throwing, for the same
  // reason UC-08's handler takes no write-capable client at all: a method that
  // refuses is one edit away from being called again, while a method that does
  // not exist has no such edit.
  //
  // WHAT REMOTE ACTUALLY OFFERS `[CONFIRMED-LIVE 2026-08-19]`, transcribed from
  // developer.remote.com's own OpenAPI (`get_v1_work-authorization-requests.md`,
  // `patch_v1_work-authorization-requests_id-2.md`), fetched this session:
  //
  //   GET   /v1/work-authorization-requests        -> ListWorkAuthorizationRequestsResponse
  //   GET   /v1/work-authorization-requests/{id}   -> WorkAuthorizationRequestResponse
  //   PUT   /v1/work-authorization-requests/{id}   -> same
  //   PATCH /v1/work-authorization-requests/{id}   -> same
  //
  // and nothing else. Remote's live `llms.txt` carries 79 `post_…` pages, so it
  // documents creates where they exist; the absence here is a pattern, not a
  // gap. The schemas say WHY: a `WorkAuthorizationRequest` is *"submitted by an
  // employee"*, `pending` is *"Submitted and awaiting manager review"*, there is
  // a `work_authorization.requested` webhook, and the update body is a closed
  // `oneOf` over exactly two branches. The contract is CREATE-BY-EMPLOYEE,
  // DECIDE-BY-API.
  //
  // ENVELOPES — both nest under a named key, which is why the two readers below
  // unwrap explicitly rather than trusting `body.data`:
  //   show/patch: {"data": {"work_authorization_request": {…}}}
  //   list:       {"data": {"work_authorization_requests": [...], "total_count", …}}
  // Returning `body.data` alone hands the caller `{work_authorization_request:…}`,
  // so `result.status` reads `undefined` and a successful PATCH looks like it
  // returned nothing — the identical defect `patchExpenseStatus()` above already
  // paid for once.

  /**
   * GET /v1/work-authorization-requests/:id — the request an employee raised
   * in Remote's Request Hub. Returns null on 404, like getEmployment(), so the
   * caller decides what a missing record means.
   * @param {string} id
   * @returns {Promise<object|null>} a `WorkAuthorizationRequest`
   */
  async getWorkAuthorization(id) {
    const result = await this.#get(`/v1/work-authorization-requests/${encodeURIComponent(id)}`);
    if (!result) return null;
    return result.work_authorization_request ?? result;
  }

  /**
   * GET /v1/work-authorization-requests — the collection, filterable.
   *
   * This is how a request with no id in hand is RESOLVED rather than invented:
   * `employment_id` and `status` are documented query parameters on this
   * endpoint (transcribed from its own `parameters` list, not assumed — see
   * REMOTE-VOCABULARY §13.0(b) on why an undocumented filter that silently does
   * not filter is worse than one that errors).
   *
   * @param {object} [opts]
   * @param {string|null} [opts.employmentId]
   * @param {string|null} [opts.status]  one of the six `WorkAuthorizationRequest.status`
   *   members (`pending`, `cancelled`, `declined_by_manager`, `declined_by_remote`,
   *   `approved_by_manager`, `approved_by_remote`)
   * @returns {Promise<object[]>} the `work_authorization_requests` array, [] when absent
   */
  async listWorkAuthorizations({ employmentId = null, status = null } = {}) {
    const query = new URLSearchParams();
    if (employmentId) query.set("employment_id", String(employmentId));
    if (status) query.set("status", String(status));
    const suffix = query.toString() ? `?${query}` : "";
    const result = await this.#get(`/v1/work-authorization-requests${suffix}`);
    const rows = result?.work_authorization_requests;
    return Array.isArray(rows) ? rows : [];
  }

  /**
   * PATCH /v1/work-authorization-requests/:id — the ONE write UC-04 makes, and
   * only after the mobility specialist's decision has been recorded durably
   * (see uc04/workflow.js).
   *
   * The body must be one of Remote's two branches and nothing else.
   * `UpdateWorkAuthorizationRequestParams` is `additionalProperties: false`
   * over a `oneOf`, transcribed verbatim:
   *
   *   ApprovedWorkAuthozation  { status: "approved_by_manager",
   *                              employer_special_instructions?: string|null }
   *                            required: ["status"]
   *   DeclinedWorkAuthozation  { status: "declined_by_manager",
   *                              reason: string,
   *                              employer_special_instructions?: string|null }
   *                            required: ["status", "reason"]
   *
   * (Remote's own schema titles carry the typo "Authozation". Copied, not
   * corrected — it is their identifier, not our spelling.)
   *
   * `approved_by_remote` is NOT a value a caller may set. Remote glosses it
   * *"Fully approved by both the manager and Remote"* — it is Remote's own
   * compliance verdict, reachable only after a manager approval. This client
   * used to document and this repo used to send exactly that, recording
   * Remote's approval of a trip Remote had never seen. Likewise `approved_by`,
   * `approved_at` and `decision_reason`: all three are refused by the closed
   * schema, and the only companions Remote accepts are
   * `employer_special_instructions` and, on a decline, the required `reason`.
   *
   * Thin on purpose, exactly like `patchExpenseStatus()`: the caller owns the
   * policy decision and the body's shape; this method delivers it. The mock
   * server enforces the schema, so a wrong body fails a test rather than
   * passing one.
   *
   * @param {string} id
   * @param {{status: string, reason?: string, employer_special_instructions?: string|null}} payload
   */
  async patchWorkAuthorization(id, payload, { idempotencyKey = null } = {}) {
    const errLabel = `Remote API PATCH /v1/work-authorization-requests/${id} failed`;
    const res = await this.#fetchWithRetry(
      `${this.baseUrl}/v1/work-authorization-requests/${encodeURIComponent(id)}`,
      {
        method: "PATCH",
        headers: this.#writeHeaders(idempotencyKey),
        body: JSON.stringify(payload),
      },
      errLabel
    );
    if (!res.ok) throw new Error(`${errLabel}: ${res.status}`);
    const body = await res.json();
    const data = body.data ?? body;
    return data?.work_authorization_request ?? data;
  }

  /**
   * POST /v1/incentives — the write UC-09 makes for off-cycle adjustments, and
   * only after the required approvals are in (see uc09/workflow.js). Payload
   * must already be schema-validated and money-scaled by the caller; this
   * method does not re-check either.
   *
   * THIS PATH USED TO READ `/v1/recurring-incentives`, WHICH DOES NOT EXIST.
   * `[CONFIRMED-LIVE 2026-08-19]` against the Sandbox with this container's
   * token: `GET /v1/recurring-incentives` → **404 `"Not Found"`**;
   * `GET /v1/incentives` → **200**, 53 records; `GET /v1/incentives/recurring`
   * → **200**. So the one code path in this repo that POSTs money was aimed at
   * a URL Remote has never served. It was invisible because
   * `src/remote/mockServer.js` served the same invented path back — the fixture
   * agreeing with the code instead of with the API, which is this repo's most
   * expensive recurring failure (CLAUDE.md §4).
   *
   * ONE-TIME, NOT RECURRING, and that is a second decision, not a typo.
   * `[CONFIRMED]` Remote's own index: `POST /v1/incentives` is *"Create
   * Incentive"*, while `POST /v1/incentives/recurring` is *"Create a Recurring
   * Incentive, **that is, a monthly paid incentive**."* An off-cycle
   * adjustment is a single event by definition, so the recurring resource
   * would turn one approved adjustment into a standing monthly payment. The
   * two resources are not interchangeable even in their enums: the recurring
   * `type` list omits `signing_bonus` `[CONFIRMED]`.
   *
   * Remote answers **201** with `{data: {incentive: {...}}}` `[CONFIRMED]`
   * (`IncentiveResponse`), so the incentive itself is unwrapped here rather
   * than handing callers an `{incentive: …}` wrapper to remember. The two
   * fallbacks keep older/simpler shapes working.
   * @param {object} payload  schema-validated, money-scaled incentive to create
   */
  async createIncentive(payload, { idempotencyKey = null } = {}) {
    const errLabel = `Remote API POST /v1/incentives failed`;
    const res = await this.#fetchWithRetry(
      `${this.baseUrl}/v1/incentives`,
      {
        method: "POST",
        headers: this.#writeHeaders(idempotencyKey),
        body: JSON.stringify(payload),
      },
      errLabel
    );
    if (!res.ok) throw new Error(`${errLabel}: ${res.status}`);
    const body = await res.json();
    return body?.data?.incentive ?? body?.data ?? body;
  }
}

/**
 * Map the real Remote API's employment shape down to the same flat fields
 * the mock server already returns (id, email, full_name, status,
 * contract_type, start_date, probation, legal_entity_id) — verified against
 * a real Sandbox record, not invented:
 *   - the mock's exact flat shape is passed through untouched (detected by
 *     the presence of a string `contract_type` + `start_date`, which the real
 *     API never returns at the top level — see below).
 *   - the real API has no top-level `contract_type`/`start_date`/`probation`.
 *     `full_name`, `status`, `id`, `company_id` ARE top-level. Start date and
 *     display name are duplicated on an embedded `basic_information` object.
 *     There is no "full-time/part-time" concept for every employment type — we
 *     surface whatever `employment_model`/`type` the API gives rather than
 *     inventing an FT/PT value we can't verify for every engagement type.
 *
 *     CORRECTED 2026-08-28. This line used to give "a contractor has
 *     `employment_model: "contractor"`" as its example. THERE IS NO SUCH
 *     VALUE. Remote publishes two separate enums on the employment object and
 *     `contractor` is only in the first of them:
 *       type            : employee | contractor | direct_employee | global_payroll_employee
 *       employment_model: eor | global_payroll | peo        (nullable)
 *     So a contractor is identified by `type`, and its `employment_model` is
 *     most likely null. The CODE was already right — it reads
 *     `employment_model || type`, and the `|| type` arm is what has been
 *     carrying every contractor in this repo. Only the comment was wrong, and
 *     a wrong comment beside right code is the more expensive of the two:
 *     the next person to "simplify" that fallback would have deleted the arm
 *     that does the work, on this comment's authority.
 *   - "on probation" is derived from `probation_period_end_date` (null when
 *     not applicable, e.g. contractors) by checking it's set AND in the future.
 *   - the legal entity relationship is `engaged_by_legal_entity_id`.
 * @param {object|null} raw
 */
export function normalizeEmployment(raw) {
  if (!raw) return raw;

  if (typeof raw.contract_type === "string" && typeof raw.start_date === "string") {
    return raw; // already the mock's flat shape
  }

  const basicInfo = raw.basic_information ?? {};
  const probationEnd = raw.probation_period_end_date;

  return {
    id: raw.id,
    email: raw.work_email ?? raw.login_email ?? basicInfo.email ?? null,
    full_name: raw.full_name ?? basicInfo.name ?? null,
    status: raw.status,
    contract_type: raw.employment_model || raw.type || "unknown",
    start_date: basicInfo.provisional_start_date ?? raw.provisional_start_date ?? basicInfo.seniority_date ?? null,
    probation: Boolean(probationEnd) && new Date(probationEnd) > new Date(),
    // THE DATE ITSELF, NOT JUST THE BOOLEAN — and this line is load-bearing.
    //
    // Collapsing `probation_period_end_date` to a yes/no threw away the only
    // input UC-05's notice calculator needs, and UC-05 reads the date under the
    // name `probation_end_date` (policyEngine.js gate 4's computeNoticePeriod
    // call). Nothing produced that key, so `probationEndDate` was ALWAYS null,
    // `onProbation` was ALWAYS false, and every probation bracket in
    // noticePeriodTable.js — Germany 14 days, India 7, Philippines 15, Mexico
    // 15, Portugal 15 — was unreachable code for every real employment record.
    //
    // What that produced in production is a wrong number on an HR document, in
    // the direction that harms the employee: a Portuguese employee resigning
    // during probation was told they owed 30 or 60 days instead of 15, and
    // their entirely lawful leaving date was then escalated to Local HR Legal
    // as `earlier_than_statutory`.
    //
    // It survived because the fixtures agreed with the code. The only record in
    // the repo carrying `probation_end_date` is a mock fixture
    // (src/remote/mockServer.js's emp_de_probation_001), and the mock's flat
    // shape is passed through this function untouched — so the probation test
    // exercised a path no real record can reach. The n8n port reads
    // `probation_end_date ?? probation_period_end_date` and was right all along;
    // test/n8nUc05Parity.test.js hid the disagreement by feeding BOTH copies an
    // employment object built by the n8n normalizer, which supplies the field.
    // Parity proves two implementations match, never that either is right.
    //
    // [CONFIRMED] `probation_period_end_date` is a top-level field on
    // GET /v1/employments/{id}, read live from the Remote Sandbox 2026-08-19.
    probation_end_date: probationEnd ?? null,
    legal_entity_id: raw.engaged_by_legal_entity_id ?? raw.bill_to_legal_entity_id ?? null,
    company_id: raw.company_id ?? null,
    job_title: basicInfo.job_title ?? raw.job_title ?? null,
    // --- THE TWO BLOCKS THIS NORMALIZER USED TO THROW AWAY -----------------
    // Live, `GET /v1/employments/{id}` carries the amendment-relevant data in
    // two nested objects, and this function surfaced NEITHER — which is why
    // five fields a real country form requires "could not be sourced" and
    // UC-06 escalated `schema_invalid` on every live amendment:
    //
    //   basic_information : {name, manager, email, mobile_number, job_title,
    //                        login_email, provisional_start_date,
    //                        tax_servicing_countries, personal_email,
    //                        work_email, seniority_date, tax_job_category,
    //                        has_seniority_date}
    //   contract_details  : {annual_gross_salary, compensation_currency_code,
    //                        work_hours_per_week, work_schedule,
    //                        contract_duration_type, contract_end_date,
    //                        role_description, experience_level,
    //                        holiday_allowance, …}   (shape varies by country)
    //
    // [CONFIRMED 2026-08-18 on NL/DE/GB/FR/CA/SG/PT employments.]
    //
    // THEY ARE CARRIED AS THE BLOCKS REMOTE SENDS, NOT FLATTENED, and that is
    // deliberate. `contract_details` uses the SAME field names as the contract
    // amendment form does (`annual_gross_salary`, `work_hours_per_week`,
    // `role_description`, `work_schedule`, `contract_duration_type`,
    // `experience_level`, `compensation_currency_code` — all name-identical,
    // verified field by field against the live NLD/DEU/GBR/SGP/CAN/FRA/PRT
    // forms). So UC-06 can look a required field up under ITS OWN NAME instead
    // of this file inventing a mapping table — the schema names the field, and
    // nothing here has to agree with it in advance. Flattening would put this
    // file back in the business of choosing names, which is the exact habit
    // that produced {job_title, weekly_hours, base_salary, currency}.
    //
    // In particular NO flat `base_salary`/`currency`/`weekly_hours` alias is
    // introduced here — silently starting to print salaries on a customer-facing
    // letter is not a side effect a normalizer gets to have.
    //
    // THE HANDOFF ITEM THAT SENTENCE RECORDED IS NOW CLOSED, AND IT WAS CLOSED
    // AT THE RENDERER, NOT HERE. [2026-08-20] UC-03's travel letter printed
    // `employment.base_salary` when it was a number, so the row rendered against
    // the mock's flat fixtures and COULD NOT RENDER AGAINST A LIVE RECORD at
    // all: this function has never produced that key for one, and a test
    // asserting the row's presence passed for the project's whole life on a
    // fixture that does not match production (CLAUDE.md §4's recurring failure).
    // `src/uc03/letter.js`'s `readAnnualGrossSalary()` now reads
    // `contract_details.annual_gross_salary` + `compensation_currency_code`
    // straight off the block below — under Remote's own names, exactly as the
    // paragraph above intends — and states nothing when the record holds no
    // salary it can vouch for.
    //
    // THE SCALE, SETTLED, since the next reader of these fields will need it:
    // `annual_gross_salary` is ×100 MINOR UNITS. [CONFIRMED] Remote types the
    // same field on its cost calculator as *"The annual gross salary in the
    // region's local currency, in cents"* (developer.remote.com/reference/
    // post_v1_cost-calculator_estimation.md, HTTP 200, fetched 2026-08-20), and
    // the live contract-amendment captures agree — `src/remote/fixtures/
    // contractAmendmentSchemas.js` records 7199999 as *"one cent below the
    // CURRENT salary of the employment (7200000)"*.
    //
    // `contract_details.payment_terms.compensation_gross_amount` — the
    // CONTRACTOR's per-period rate, which the live capture in
    // `test/fixtures/sandboxCapture.js` carries as 25000 — is a DIFFERENT FACT
    // and its scale remains [UNKNOWN]: it appears in no public reference page,
    // living only inside the per-country `contractor_contract_details` form,
    // which needs a live token. Nothing in `src/` reads it, deliberately.
    basic_information: raw.basic_information ?? null,
    contract_details: raw.contract_details ?? null,
    // --- THE BLOCK UC-04's GATE READS, AND THIS FUNCTION USED TO DROP ------
    // `src/uc04/policyEngine.js` refuses a workation unless
    // `employment.custom_fields.workation_permission === true`. This
    // normalizer built its result from an allow-list and `custom_fields` was
    // not on it, so the key was absent from every record it produced — and
    // `!employment.custom_fields` is the FIRST half of that gate's test.
    // Result: `blocked / employer_permission_not_granted` for every workation
    // request the Node path ever evaluated against a real API response.
    //
    // It was invisible for the usual reason. The early return at the top of
    // this function hands the mock's FLAT shape back untouched, so the mock's
    // `custom_fields` survived and every offline test, the portal, the
    // playground and `npm run walkthrough` exercised a path the real API never
    // takes. Only the nested shape lost it, and only the nested shape is
    // production. Same fixture-agrees-with-the-code mechanism as F-27, and the
    // same one the `probation_end_date` note above records one field over.
    //
    // The cost was doubled by what it defeated. `GET /v1/employments/{id}` on
    // the real Sandbox has NO `custom_fields` key at all [CONFIRMED live
    // 2026-08-19 — the 50 top-level keys it returns do not include one], which
    // is exactly why `src/remotebridge/enrichment.js` injects the block and
    // names it in `X-Standin-Enriched`. That injection arrived intact and was
    // discarded one function later: driven live through
    // `your-sandbox-standin.vercel.app`, whose body carries
    // `custom_fields: {workation_permission: true}`, the gate still answered
    // `blocked / employer_permission_not_granted`.
    //
    // Carried as the block the API (or the stand-in) sends, for the same
    // reason `basic_information`/`contract_details` above are: this file does
    // not get to choose the names a gate looks a field up by. The n8n port
    // reads the raw HTTP body and never had this problem, so the two execution
    // paths disagreed about the same employment — which is what makes this a
    // parity defect and not only a missing field.
    custom_fields: raw.custom_fields ?? null,
    // --- THE DOCUMENTS REMOTE HOLDS, WHICH THIS NORMALIZER ALSO DROPPED -----
    // [CONFIRMED] `files` is a documented top-level array on
    // GET /v1/employments/{id}: *"Documents associated with this employment
    // (e.g., contracts, tax forms, identity documents)"*, whose `File` schema
    // example is `{name: "id.pdf", type: "id", sub_type: "personal_id"}`.
    //
    // WHY IT MATTERS THAT IT WAS DROPPED, rather than being one more unused
    // field. UC-04's fourth dimension is "Immigration authorization on file",
    // and its evidence row read `Document read from Remote: none` as a HARD-
    // CODED STRING — so the panel reported an absence it had never looked for,
    // on a record it had already fetched, which is the P9 half of C-27 (saying
    // more than was done) in the one dimension written to avoid it. Remote's
    // own help centre says the opposite of "there is nothing to look at":
    // *"Remote collects nationally recognized identification documents"*, and
    // for cross-border work *"the Mobility team reviews residence permits and
    // other relevant documentation"* (Right-to-Work Checks, art. 31105131499789,
    // retrieved 2026-08-31). So there is a real fact, with a real home, on a
    // record we already read, and we were discarding it before anyone asked.
    //
    // CARRIED RAW, AS THE ARRAY REMOTE SENDS, for the same reason
    // `basic_information` / `contract_details` / `custom_fields` above are: a
    // normalizer that renames `type`/`sub_type` puts itself back in the
    // business of choosing the names a reader looks a document up by.
    // `src/uc04/identityDocuments.js` is the one place that interprets it, and
    // it interprets PRESENCE only — no name, no number, no document body ever
    // leaves that summariser.
    //
    // WHAT THE SANDBOX ACTUALLY HOLDS, measured rather than assumed
    // (2026-08-31, all 112 employments, 333 files): `contract` 108,
    // `expense` 221, `document_scan` 2, `background_check` 2, and **zero of
    // type `id`** — every `sub_type` null. So on live Sandbox data this field
    // arrives populated and contains no identity document, and the honest
    // reading is "read, none of this kind", which is a different sentence from
    // both "not looked at" and "the employee has none". All three are distinct
    // states in the summariser, and rung 2 holding none of a thing is rung 2
    // being empty, never rung 1 answering (CLAUDE.md §3).
    //
    // AN ABSENT KEY IS NOT AN EMPTY ARRAY. `null` is preserved rather than
    // defaulted to `[]`, because "this record did not carry the field" and
    // "this record carried the field and it was empty" are the two states the
    // summariser must keep apart, and `?? []` here would erase one of them
    // before any caller could see it.
    files: Array.isArray(raw.files) ? raw.files : null,
    // `amendment_contract_id` for POST /v1/contract-amendments comes from here
    // [CONFIRMED live: the record's own value answers 200 through
    // /v1/contract-amendments/automatable, an unknown uuid answers 404
    // "amended_contract_not_found"].
    active_contract_id: raw.active_contract_id ?? null,
    // The five basic_information fields the n8n port already surfaced flat
    // (workflows/nodes-uc06/amendmentGates.js). Mirrored here so the two
    // normalizers stop diverging — that file called its own wider shape
    // "one-directional and documented … it disappears the moment
    // normalizeEmployment() carries the block through". This is that moment.
    has_seniority_date: basicInfo.has_seniority_date ?? raw.has_seniority_date ?? null,
    tax_servicing_countries: basicInfo.tax_servicing_countries ?? raw.tax_servicing_countries ?? null,
    tax_job_category: basicInfo.tax_job_category ?? raw.tax_job_category ?? null,
    login_email: basicInfo.login_email ?? raw.login_email ?? null,
    mobile_number: basicInfo.mobile_number ?? raw.mobile_number ?? null,
    // The real API nests country under `country.{code,alpha_2_code}` (3- and
    // 2-letter ISO forms respectively) with no top-level country_code at all.
    // Every consumer of employment.country_code compares it against 2-letter
    // values — UC-05's statutory notice table, UC-06's
    // `/v1/countries/{code}/employment_basic_information` lookup, UC-09's
    // `["DE","FR","IT"]` high-tax list, UC-03's `origin_country`.
    //
    // THIS LINE USED TO READ `alpha_2_code ?? country.code ?? …`, WHICH IS
    // FINDING F-27 ONE FIELD OVER. `country.code` is the ALPHA-3 form, so
    // whenever `alpha_2_code` was absent the chain placed "DEU"/"CAN" into a
    // field only ever probed with "DE"/"CA". Nothing crashes; every comparison
    // is simply false, forever, and the gates fail closed — which is
    // indistinguishable from working correctly, exactly as UC-03's dead
    // supported-countries gate was for the project's whole life.
    //
    // So the SHAPE is asserted rather than hoped for, the same way
    // countryRowToAlpha2() above does it, and for the same reason: appending
    // one more fallback is what reproduces the bug a level down. An alpha-3
    // value is not an alpha-2 value we can salvage — converting needs a
    // 249-entry table this repo does not have and must not invent (prime
    // directive #4) — so an unusable code becomes NULL, never a wrong string.
    //
    // Null is the right stand-in because every consumer already treats it as
    // "not confirmed": UC-05 escalates `unsupported_country`, UC-06's schema
    // fetch 404s and escalates `country_schema_unavailable`, UC-09 keeps its
    // floor of two approvers. A missing value gets investigated; a wrong one
    // gets acted on. `test/remoteShapeFidelity.test.js` pins all three.
    country_code: pickAlpha2([raw.country?.alpha_2_code, raw.country_code, raw.country?.code]),
  };
}

/**
 * Put one payroll-run row's money on the axis `src/shared/money.js` works in,
 * and leave every other field exactly as Remote sent it.
 *
 * THE DEFECT THIS CLOSES. `total_payroll_cost` is documented `"type":
 * "integer"` and returned as a QUOTED STRING — live, `"total_payroll_cost":
 * "15103469"` [CONFIRMED 2026-08-19 against gateway.remote-sandbox.com]. It
 * has no consumer in `src/` today, which is exactly why it is worth fixing
 * now: the first consumer will hand it to `fromRemoteInteger()`, get a
 * TypeError — that refusal is CORRECT and is the invariant working — and the
 * cheapest-looking repair at that call site is `Number(x)`, which is a second
 * copy of the ×100 convention living next to somebody's arithmetic. The
 * boundary is the only place the fix does not multiply.
 *
 * `total_payroll_cost` becomes an integer number of minor units, or NULL when
 * the value cannot be read as one (see `parseRemoteMinorUnits()` for why the
 * parse refuses `"1.5"`, `""` and `"1e3"` rather than coercing them). Null is
 * never zero, and a null here is already a shape this data carries honestly:
 * `src/remotebridge/payrollProjection.js` leaves projected cycles' cost null
 * because inventing money is the one thing forbidden outright.
 *
 * THE ORIGINAL IS KEPT under `total_payroll_cost_raw` — unparsed, exactly as
 * it arrived. Without it a null is unattributable: "Remote sent nothing" and
 * "Remote sent something this client could not read" are different bugs with
 * different owners, and the second one has to be reportable or the parse
 * becomes the same silent data loss it was written to prevent.
 *
 * @param {object} run one row of `GET /v1/payroll-runs`
 * @returns {object} the same row, money-normalised
 */
export function normalizePayrollRun(run) {
  if (!run || typeof run !== "object") return run;
  return {
    ...run,
    total_payroll_cost: parseRemoteMinorUnits(run.total_payroll_cost),
    total_payroll_cost_raw: run.total_payroll_cost ?? null,
  };
}

/**
 * First candidate that is genuinely alpha-2 SHAPED, canonicalised — or null.
 * `raw.country.code` is listed last and passes only if it happens to already be
 * two letters; "DEU" fails the shape check and is skipped, which is the point.
 * @param {unknown[]} candidates
 * @returns {string|null}
 */
function pickAlpha2(candidates) {
  for (const candidate of candidates) {
    if (isWellFormedCountryCode(candidate)) return normalizeCountryCode(candidate);
  }
  return null;
}
