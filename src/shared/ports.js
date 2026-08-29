// ---------------------------------------------------------------------------
// ports.js  —  Every localhost port this repo binds, in one registry
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
// This is a scar, and the third time the same bug bit.
//
// Nine use-case APIs, five demo UIs and a dashboard all run at once during a
// demo — `npm run dashboard` explicitly tells you to start all nine. Each of
// those processes binds TWO ports: its own HTTP API, and a mock Remote server
// it seeds from. That second port is easy to forget, because nothing in the
// docs or the UI ever mentions it.
//
// So each file picked its own seed port and carried a comment claiming it was
// "distinct from every other mock-server port already in use". Every one of
// those comments was true about the OTHER MOCK ports and silently false about
// the API ports:
//
//   uc02's seed mock  4051  ==  UC-03's API port      → UC-03 dies
//   uc03's seed mock  4052  ==  UC-04's API port      → UC-04 dies
//   uc04's seed mock  4028  ==  uc05's seed mock      → UC-05 dies
//   uc06's seed mock  4022  ==  chatdemo's mock       → chatdemo dies
//
// Whichever process lost the race crashed with EADDRINUSE, so the failure set
// depended on start order and looked nondeterministic. Following the
// dashboard's own instructions killed two of its nine sections.
//
// test/audit.test.js:272 records the same class of bug in the test suite
// (4016 colliding with zendesk.test.js under parallel execution). A comment
// asserting uniqueness cannot be checked by anything. A registry can:
// test/ports.test.js asserts every value below is unique, so the next
// collision fails CI instead of failing a demo.
//
// RULE: never write a port literal into a server file. Add it here and import
// it. Values are the defaults only — every CLI still accepts `--port`.
//
// SECOND RULE, added after the same bug turned up one layer down: a port a
// TEST binds is an allocation too. Those stay as literals in their own files
// (see TEST_PORTS below for why) but they must be declared here, and
// test/ports.test.js scans the suite and compares. Until they were, six ports
// were shared between two-to-four test files each and one — 4062, in
// test/audit.test.js — appeared in no registry at all.
// ---------------------------------------------------------------------------

/**
 * Every port bound by a long-lived process in this repo.
 *
 * Bands are deliberate, so a new entry has an obvious home:
 *   401x  standalone mocks you run yourself (`npm run mock`, `zendesk-mock`)
 *   402x  use-case APIs (first allocations, kept for stable doc/URL references)
 *   403x–404x  demo UIs a human opens in a browser
 *   405x  use-case APIs (second block) + the unified dashboard
 *   407x–408x  RESERVED for seed/companion mocks — never a public surface
 *
 * API ports are unchanged from their original values on purpose: they appear
 * in README.md, docs/DEMO-SCRIPT.md, the ZAF manifest defaults and the
 * dashboard's client-side fetches. Only the internal mock ports moved.
 */
export const PORTS = Object.freeze({
  // --- standalone mocks (started by hand) ---------------------------------
  REMOTE_MOCK: 4010, // npm run mock
  ZENDESK_MOCK: 4014, // npm run zendesk-mock

  // --- one-shot demo scripts ----------------------------------------------
  DEMO_MOCK: 4012, // src/uc01/demo.js
  SCENARIOS_MOCK: 4013, // src/uc01/scenarios.js

  // --- use-case APIs (public surfaces; do not renumber) --------------------
  UC01_REVIEW_API: 4020,
  UC06_API: 4021,
  UC08_API: 4023,
  UC02_API: 4050,
  UC03_API: 4051,
  UC04_API: 4052,
  UC05_API: 4053,
  UC07_API: 4054,
  UC09_API: 4055,

  // --- viewers and demo UIs ------------------------------------------------
  PLAYGROUND: 4030,
  LIVEDEMO: 4040,
  REMOTEUI: 4041,
  CHATDEMO: 4046, // NOT 4045 — Chrome blocks it, see BROWSER_BLOCKED_PORTS
  AUDIT_VIEW: 4044, // npm run audit-ui — the execution & audit trail viewer
  APPROVAL_QUEUE: 4047, // npm run queue-ui — the read-only approval queue:
  // everything awaiting a human across the nine, and everything nobody can reach
  PORTAL: 4042, // the request portal — one intake surface, seven request types
  THIRD_PARTY_DOOR: 4048, // npm run thirdparty — L-12: the deliberately
  // unauthenticated free-text compose box a bank/landlord/vendor uses to ask
  // about someone else's employment, and the employee's own consent surface
  OUTBOX: 4049, // npm run outbox — src/outbox: every public reply this system
  // has posted, and WHO IT WENT TO. Auto-resolved verification letters are
  // addressed to the persona's Remote Sandbox email, which lives on
  // `.example.com` — an RFC 2606 RESERVED domain, so nothing sent there arrives
  // anywhere. The happy path's customer-facing half had never once been read by
  // a human; every check in this project looks at the TICKET and none looked at
  // the INBOX. The owner noticed from the outside: the only mail this system had
  // ever delivered was third-party refusals, because those were the only
  // messages addressed to a real person.
  REMOTE_BRIDGE: 4043, // src/remotebridge — the Remote Sandbox stand-in. A public
  // surface, not a seed mock: n8n and the app point at it INSTEAD of
  // gateway.remote-sandbox.com, and it proxies reads through to the real thing.
  DASHBOARD: 4060,
  NEGOTIATION_VIEW: 4061, // scripts/orchestration/negotiation-view.mjs — the
  // read-only live view of the Builder <-> Validator negotiation. Orchestration
  // rather than product, but it binds a real socket on the same host, which is
  // the only thing this registry cares about.

  // --- seed / companion mocks (internal; never linked to) ------------------
  // Each UC API seeds itself through a mock Remote server that stays up for
  // the life of the process. These are the ports that used to collide.
  UC01_SEED_MOCK: 4070,
  UC02_SEED_MOCK: 4071,
  UC03_SEED_MOCK: 4072,
  UC04_SEED_MOCK: 4073,
  UC05_SEED_MOCK: 4074,
  UC06_SEED_MOCK: 4075,
  UC09_SEED_MOCK: 4078,
  // (UC-07 and UC-08 read nothing from Remote, so they start no mock.)

  PLAYGROUND_REMOTE_MOCK: 4079,
  CHATDEMO_REMOTE_MOCK: 4080,
  REMOTEUI_REMOTE_MOCK: 4081,
  REMOTEUI_ZENDESK_MOCK: 4082,
  PDF_DEMO_MOCK: 4083,
  METRICS_SEED_MOCK: 4084,
  PORTAL_REMOTE_MOCK: 4085,
  SIMULATOR_MOCK: 4086, // src/simulator/run.js — the brute-force simulation's Remote mock
  // The portal raises a Zendesk ticket for any decision that needs a human
  // (src/portal/ticketing.js). With no Zendesk credentials configured it talks
  // to the local mock instead of a real account, exactly as the Remote UI
  // stand-in does — hence a second companion mock, and hence a registry entry
  // rather than a literal in cli.js.
  PORTAL_ZENDESK_MOCK: 4087,
  THIRD_PARTY_DOOR_REMOTE_MOCK: 4088, // src/thirdparty/cli.js — L-12
});

/**
 * The seed/companion-mock band. Every internal mock belongs inside it.
 *
 * This band is also reserved AGAINST the test suite. `node --test` runs files
 * in parallel and its ports are scattered from 4011 to 4092 — one of them
 * (4016) already collided with a demo mock and produced a real EADDRINUSE
 * flake (test/audit.test.js:272). Keeping every seed mock inside one band that
 * no test touches means `npm test` and a running demo can never fight over a
 * socket. test/ports.test.js scans the test files and enforces it.
 */
export const SEED_MOCK_BAND = Object.freeze({ min: 4070, max: 4089 });

/**
 * The band `node --test` binds into.
 *
 * Test files used to reach for whatever port looked free, and several landed
 * on live API ports — 4021 (UC-06), 4023 (UC-08), 4053 (UC-05), 4054 (UC-07).
 * The consequence was small but constant: `npm test` failed outright while a
 * demo was running, which is exactly when someone is most likely to run it.
 * Every one of those files also carried a comment calling its port "dedicated
 * to this suite" or "test-only" — true of the other TESTS, and never checked
 * against the servers.
 *
 * WIDENED from 4090-4099 to 4090-4149. Ten slots for thirty test files is why
 * files that could not fit reached below the band instead, and why six ports
 * ended up shared. Nothing else in this repo binds 4100-4149.
 *
 * Tests are not required to import from here (a port is part of a test's own
 * setup, and threading a registry through every file would cost more than it
 * buys). Enforcement runs the other way: TEST_PORTS below declares what each
 * file binds, and test/ports.test.js scans the files and compares.
 */
export const TEST_BAND = Object.freeze({ min: 4090, max: 4149 });

/**
 * Every port the TEST SUITE binds — by file, because the file is the owner.
 *
 * WHY THIS EXISTS, AND WHY THE REGISTRY ABOVE WAS NOT ENOUGH
 *
 * PORTS covers servers. Nothing covered the tests, and the tests bind 37
 * sockets across 30 files. The gap was not theoretical:
 *
 *   - `test/audit.test.js` binds 4062, which appeared in no registry at all. A
 *     scratch server on it cancelled all 12 of that file's tests. The failure
 *     does not say "port": the `before()` hook's listen() promise never
 *     settles, and `node --test` reports *"Promise resolution is still pending
 *     but the event loop has already resolved"* against every test in the file.
 *   - Six ports were shared by two-to-four files each. Reproduced, not
 *     inferred: running `uc03Server`, `portalTicket`, `lowTierExceptionData`
 *     and `remoteCountries` together — all four on 4094 — cancels 21 of their
 *     67 tests. The full suite passed anyway, because the scheduler happened
 *     not to overlap them. That is the same nondeterminism the seed-mock
 *     collisions had, one layer down.
 *   - `restClientRetry.test.js`'s connection-refused test pointed at 4091,
 *     which `uc02Categories.test.js` BINDS. A dead port is a claim on a socket
 *     exactly as a listen() is, so it is registered here too, marked
 *     RESERVED-UNBOUND — that assertion is proved by a refusal, and a live
 *     server on the far end proves nothing.
 *
 * Values are literals in the test files rather than imports from here, keeping
 * a test's setup readable in one place. That is only safe because
 * test/ports.test.js scans every test file and asserts the scan and this table
 * agree IN BOTH DIRECTIONS — an unregistered port fails, and so does a
 * registration nothing binds, which is what stops the scanner going quietly
 * blind (its comment-stripper ate `http://` once already, and a detector that
 * finds nothing agrees with everything).
 */
export const TEST_PORTS = Object.freeze({
  "approverEntitlement.test.js": [4113],
  "audit.test.js": [4062],
  "chatdemo.test.js": [4019],
  "dashboard.test.js": [4127],
  "employeeSubject.test.js": [4121],
  "employeeSubjectAcrossUseCases.test.js": [4123],
  "escalationRouting.test.js": [4108, 4109],
  "lowTierExceptionData.test.js": [4106],
  "pdfRender.test.js": [4033],
  "playground.test.js": [4017],
  "portal.test.js": [4097],
  "portalReferenceTrace.test.js": [4110],
  "portalStatus.test.js": [4104],
  "portalTicket.test.js": [4105],
  "portalInterstitial.test.js": [4118],
  "portalUc03Continuation.test.js": [4098],
  "portalUc03ContinuationForm.test.js": [4111],
  "portalUc03LetterOffer.test.js": [4116],
  "portalUc03LetterHandoff.test.js": [4120],
  "portalUc04TravelScenarios.test.js": [4119],
  "remoteCountries.test.js": [4107],
  "requesterSubject.test.js": [4122],
  "thirdPartyDoor.test.js": [4125],
  "uc01VcAudit.test.js": [4126],
  "uc01ConsentAging.test.js": [4128],
  "remoteui.test.js": [4024, 4025],
  // 4149 is RESERVED-UNBOUND — see the header above.
  "restClientRetry.test.js": [4090, 4092, 4149],
  "review.test.js": [4022, 4096],
  "uc01.test.js": [4011],
  "uc01AuditDeliverable.test.js": [4101],
  "uc01OutOfScopeTrace.test.js": [4124],
  "uc01OutOfScopeIdempotency.test.js": [4129],
  "uc02.test.js": [4059],
  "uc02Categories.test.js": [4091],
  "uc02Review.test.js": [4103],
  "uc02Server.test.js": [4029],
  "uc03.test.js": [4093, 4099],
  "uc03LetterOffer.test.js": [4115],
  "uc03LetterScope.test.js": [4117],
  "uc03Server.test.js": [4094],
  "uc03Signoff.test.js": [4114],
  "uc04.test.js": [4065],
  "uc04Server.test.js": [4067],
  "uc04TravelHistory.test.js": [4112],
  "uc05.test.js": [4063],
  "uc05NoticeCountries.test.js": [4100],
  "uc05Server.test.js": [4066],
  "uc06.test.js": [4018],
  "uc06CountrySchemaAxis.test.js": [4068],
  "uc06Server.test.js": [4095],
  "uc06SlackNotifier.test.js": [4064],
  "zendesk.test.js": [4015, 4016],
  "zendeskTicketHygiene.test.js": [4130, 4131, 4132, 4133],
  "zendeskCustomFieldHeal.test.js": [4134, 4135, 4136],
});

/**
 * Ports browsers refuse to open, whatever is listening on them.
 *
 * The chat demo shipped on 4045 and Chrome would not load it — `ERR_UNSAFE_PORT`,
 * before a single byte was requested. 4045 is `lockd` on Chromium's blocked
 * list, and a blocked port fails in the worst possible way for a demo: the
 * server starts, logs its URL, answers `curl` with a 200, and the browser
 * still shows an error page. Nothing in the server logs is wrong, so the
 * natural conclusion is that the app is broken.
 *
 * Only the entries inside this repo's plausible range are listed; the full
 * list is longer and mostly far away (1719/1720/1723, 2049, 5060/5061, 6000,
 * 6665-6669, 10080 and friends). test/ports.test.js asserts no registered
 * port is one of these.
 */
export const BROWSER_BLOCKED_PORTS = Object.freeze([3659, 4045, 5060, 5061, 6000]);
