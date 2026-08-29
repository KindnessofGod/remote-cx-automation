// ---------------------------------------------------------------------------
// personas.js  —  The demo identities the portal believes are signed in
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
// CLAUDE.md prime directive #3: identity comes from an authenticated signal,
// never a claim. Every workflow behind this portal takes a `session` object and
// fails closed without one — UC-02/03/05 want `{authenticatedEmploymentId}`
// (the employee acting on their own record), UC-04/09 want
// `{companyId, authenticatedAdminId}` (a company admin acting on an employee's
// behalf). A request body that simply CONTAINED one of those objects would
// prove nothing: anyone could post `{companyId: "co_amend_01"}`.
//
// So the portal does what src/remoteui/roles.js does: the page picks a persona
// KEY, and the server looks that key up in the map below. A key that is not in
// the map is refused (401) rather than defaulted — the same fail-closed shape
// the identity gate itself has. Nothing in the request body can name a company,
// an admin id or an employment id that the session is built from.
//
// WHAT THIS IS NOT
// This is not authentication. It is a stand-in for the authenticated session a
// real Remote product surface would already hold, in exactly the way
// src/remoteui/ stands in for the amendment-request surface Remote has no
// public API for. The page says so in its own copy, out loud, above the forms.
//
// Every employment id below resolves to a fixture in the mock Remote server
// (src/remote/mockServer.js) — the portal never invents an employee, and every
// Remote read it makes is served in-process by that file.
//
// EVERY EMPLOYEE PERSONA CARRIES A REAL SANDBOX ID. All ten employees below
// (seven from 2026-08-18, three more from 2026-08-20) are keyed by employment
// ids that genuinely exist in the project owner's Remote Sandbox, so a tester
// recognises the people on the page and can cross-check each id against their
// own account. The RECORDS behind those ids are still the
// mock's, on purpose: a publicly reachable page must not read or write a real
// Remote account. mockServer.js's two mirroring blocks are the authority on
// which facts were captured live (name, id, country, type+status) and which are
// this repo's own (email, salary, start date, job title, entity, company) —
// read them before quoting any figure here as something the Sandbox returned.
//
// THE ROSTER WAS REBUILT ON 2026-08-18, at the project owner's request: the
// portal should offer only people who exist in his own Sandbox. Six mock-only
// personas used to sit here (`amara`, `priya`, `kofi`, `oliver`, `lena`,
// `katarzyna`), and a request naming one now fails closed through
// resolvePersona() exactly like any other unknown key.
//
// They were REPLACED rather than dropped, because each was carrying a
// demonstration worth keeping. `priya` -> `james` (expense ownership),
// `kofi` -> `thomas` (a non-active employment), `lena` -> `anna` (Germany's
// month-anchored notice), `oliver` -> `emma`, who was already here and already
// GB. `amara` was the generic happy path and needed no successor; `chris` is it.
//
// ONE REPLACEMENT IS NOT LIKE-FOR-LIKE. `katarzyna` was Poland, and the Sandbox
// contains no Polish employment at all, so `joao` is Portugal instead — chosen
// because PT is also in UC-05's table with a bracket long enough to clash with a
// short leaving date. The scenario that uses him says Portugal and states PT's
// own rule; it does not describe PL's rule over a PT record.
//
// The mock FIXTURES the old personas pointed at are untouched — the test suite
// and the nine ucNN CLIs still depend on emp_active_001, emp_terminated_002,
// emp_uk_001, emp_de_001, emp_pl_001 and emp_active_003. Only the picker
// changed. Two of those fixtures are still reachable from this page as the
// SUBJECT of an admin request (an employment id the admin types into the form);
// a subject is not a session, so that needs no persona.
//
// THREE MORE WERE ADDED ON 2026-08-20, AND THE REASON IS THE POINT OF THE FILE.
// Driven through the real workflows, the seven above produced ONE refusal
// between them and one person produced all of it — Thomas Weber is archived, so
// everything refuses him `employee_not_active`. Everyone else auto-issued the
// travel letter, cleared UC-04's permission gate and reached a UC-05 outcome.
// So a refusal could be demonstrated only by TYPING something unusual, never by
// BEING somebody, and the project owner asked for the opposite: *"for positive
// outcomes I can act as one particular employee, for negative ones I can act as
// another — just need to switch from the sidebar."*
//
// Each of the three carries exactly ONE record fact no other persona has, and
// each fact turns a specific gate the other way. Nothing about any gate changed
// to make this work; the records make gates that already existed reachable.
//
//   lars      673a1884-…  NL  a DIFFERENT company    -> UC-04/UC-09 refuse the
//                                                       Acme admin acting FOR
//                                                       him (identity_not_verified),
//                                                       while his own
//                                                       self-service still works
//   alexandre 3537d9ee-…  CA  no employing entity    -> UC-03's formal letter
//                                                       stops for a person
//                                                       (letterhead_unavailable)
//                                                       where Chris Lee's issues
//   amanda    e818418e-…  US  permission withheld    -> UC-04 blocks
//                                                       (employer_permission_not_granted)
//                                                       where Chris Lee clears
//
// EVERY ONE OF THOSE OUTCOMES IS PINNED BY TEST, by reason and not merely by
// "did not succeed" — test/personas.test.js drives each persona through the
// real handler, and one structural test there fails if a persona is ever added
// without a demonstrated outcome. A persona nobody can show doing anything is
// decorative, and a persona documented to refuse that quietly succeeds is worse
// than none at all, because the demo then teaches something false.
// ---------------------------------------------------------------------------

/**
 * @typedef {object} Persona
 * @property {string} id            the key the page sends
 * @property {string} name          display name
 * @property {"employee"|"company_admin"} kind
 * @property {string|null} employmentId  the record this persona IS (employees only)
 * @property {string} note          one line for the page: who this is, and why they exist
 * @property {object} session       the session object handed to the workflow — server-owned
 */

/** @type {Record<string, Persona>} */
export const PERSONAS = {
  // --- employees: self-service requests (UC-02, UC-03, UC-05) --------------
  // All three are keyed by employment ids that really exist in the project
  // owner's Remote Sandbox (confirmed live 2026-08-18). The READS are still the
  // mock's — src/remote/mockServer.js holds a fixture under each real id, and
  // its "MIRRORED SANDBOX RECORDS" block records exactly which four facts were
  // captured live (name, id, country, type+status) and which are this repo's own
  // (email, salary, start date, job title, entity, company).
  //
  // So nothing about the portal's safety changes: a publicly reachable page
  // still cannot read or write a real Remote account. What it buys is that a
  // tester sees a name and an id they recognise, and the id is the genuine one.
  // The note on each persona says so, and prints the id, because that is the one
  // string a tester needs to cross-check against their own Sandbox.
  chris: {
    id: "chris",
    name: "Chris Lee",
    kind: "employee",
    employmentId: "8ab12460-b568-4c1e-af9d-09b1fabd8f46",
    note:
      "Mirrors a real Remote Sandbox record — United States, employee, active. Employment id 8ab12460-b568-4c1e-af9d-09b1fabd8f46 is the genuine Sandbox id; the record behind it is this repo's mock, so nothing here touches a real account. Owns the two Sandbox expenses in the expense-claim picker.",
    session: { authenticatedEmploymentId: "8ab12460-b568-4c1e-af9d-09b1fabd8f46" },
  },
  emma: {
    id: "emma",
    name: "Emma Thompson",
    kind: "employee",
    employmentId: "d73cff71-ced7-4bcf-b764-b9899abc6340",
    note:
      "Mirrors a real Remote Sandbox record — United Kingdom, employee, active. Employment id d73cff71-ced7-4bcf-b764-b9899abc6340 is the genuine Sandbox id; the record behind it is this repo's mock. We hold the United Kingdom's statutory notice rules, and ~5.5 years' service puts her in the five-week bracket.",
    session: { authenticatedEmploymentId: "d73cff71-ced7-4bcf-b764-b9899abc6340" },
  },
  carlos: {
    id: "carlos",
    name: "Carlos Silva",
    kind: "employee",
    employmentId: "c2cd77da-d576-423f-b4f1-f9e40b313353",
    note:
      "Mirrors a real Remote Sandbox record — Brazil, CONTRACTOR, active. Employment id c2cd77da-d576-423f-b4f1-f9e40b313353 is the genuine Sandbox id; the record behind it is this repo's mock. We hold statutory notice rules for nine countries and Brazil is not one of them, so a resignation from him goes to a person instead of being answered here — the right outcome, not a gap.",
    session: { authenticatedEmploymentId: "c2cd77da-d576-423f-b4f1-f9e40b313353" },
  },

  // --- second mirroring pass: the four subjects the mock-only personas used to
  // supply. Same rule as above — real id, real name/country/type/status, every
  // other field this repo's fixture. See mockServer.js's "second mirroring pass"
  // block for what was and was not captured live.
  anna: {
    id: "anna",
    name: "Anna Müller",
    kind: "employee",
    employmentId: "09b65526-643b-4956-959b-916e6429bd23",
    note:
      "Mirrors a real Remote Sandbox record — Germany, employee, active. Employment id 09b65526-643b-4956-959b-916e6429bd23 is the genuine Sandbox id; the record behind it is this repo's mock. Germany's statutory notice is four weeks anchored to the 15th or the end of a month (BGB §622), which is the rule a leaving date has to land on rather than a bracket it has to clear.",
    session: { authenticatedEmploymentId: "09b65526-643b-4956-959b-916e6429bd23" },
  },
  thomas: {
    id: "thomas",
    name: "Thomas Weber",
    kind: "employee",
    employmentId: "9927057d-c8bc-4c71-940d-a5bc4ccf877e",
    note:
      "Mirrors a real Remote Sandbox record — Germany, employee, ARCHIVED. Employment id 9927057d-c8bc-4c71-940d-a5bc4ccf877e is the genuine Sandbox id, and 'archived' is genuinely its status rather than a status this repo chose. Every use case's status gate tests for 'active', so a request made as him is refused whatever it asks for.",
    session: { authenticatedEmploymentId: "9927057d-c8bc-4c71-940d-a5bc4ccf877e" },
  },
  james: {
    id: "james",
    name: "James Wilson",
    kind: "employee",
    employmentId: "7ec6a5e4-909d-47c1-a442-0688c5cc1f2b",
    note:
      "Mirrors a real Remote Sandbox record — United Kingdom, employee, active. Employment id 7ec6a5e4-909d-47c1-a442-0688c5cc1f2b is the genuine Sandbox id; the record behind it is this repo's mock. He owns the clean expense the ownership-mismatch scenario submits under someone else's session — filed by him it auto-approves, filed by anyone else it must be refused.",
    session: { authenticatedEmploymentId: "7ec6a5e4-909d-47c1-a442-0688c5cc1f2b" },
  },
  joao: {
    id: "joao",
    name: "João Silva",
    kind: "employee",
    employmentId: "378eee6b-c6db-4484-ba32-7283bd0e2de9",
    note:
      "Mirrors a real Remote Sandbox record — Portugal, employee, active. Employment id 378eee6b-c6db-4484-ba32-7283bd0e2de9 is the genuine Sandbox id; the record behind it is this repo's mock. Portugal owes 60 calendar days' notice past two years' service (Código do Trabalho art. 400), long enough that a short proposed leaving date clashes with it.",
    session: { authenticatedEmploymentId: "378eee6b-c6db-4484-ba32-7283bd0e2de9" },
  },

  // --- third mirroring pass, 2026-08-20: the people who carry a REFUSAL ------
  // Same rule as both blocks above — real Sandbox id, real name/country/type/
  // status, every other field this repo's fixture. See mockServer.js's "third
  // mirroring pass" block for the provenance of each id and for exactly which
  // one fact on each record is composed and why.
  //
  // THE NOTES BELOW ARE AN INTERFACE, not decoration. They are read by a person
  // choosing from a dropdown AND by whoever wires the page's quick-fills, so
  // each says in one sentence what the person is FOR, and names the use case
  // whose outcome they turn. Two of the three change an outcome only for a
  // request filed BY THE ADMIN (UC-04, UC-09), where the person is the SUBJECT
  // rather than the session — the notes say so, because "switch the persona"
  // and "switch the subject" are different gestures on this page.
  lars: {
    id: "lars",
    name: "Lars van der Berg",
    kind: "employee",
    employmentId: "673a1884-86fb-4101-83d3-b6c544d93bca",
    note:
      "Mirrors a real Remote Sandbox record — Netherlands, EOR employee, active. Employment id 673a1884-86fb-4101-83d3-b6c544d93bca is the genuine Sandbox id; the record behind it is this repo's mock. He is the one person NOT employed by Acme, so Jane Doe cannot file a workation or a payroll adjustment for him — those are refused as unverified identity, while everything he files himself works normally. Pick him as the SUBJECT of an admin request to see that boundary.",
    session: { authenticatedEmploymentId: "673a1884-86fb-4101-83d3-b6c544d93bca" },
  },
  alexandre: {
    id: "alexandre",
    name: "Alexandre Tremblay",
    kind: "employee",
    employmentId: "3537d9ee-2017-4a53-952e-9d3b042aeab5",
    note:
      "Mirrors a real Remote Sandbox record — Canada, CONTRACTOR, active. Employment id 3537d9ee-2017-4a53-952e-9d3b042aeab5 is the genuine Sandbox id; the record behind it is this repo's mock. His record names no employing entity, so there is no letterhead to write on: ask for a formal travel letter as him and it stops for a person to handle, where the same request as Chris Lee is written and issued on the spot.",
    session: { authenticatedEmploymentId: "3537d9ee-2017-4a53-952e-9d3b042aeab5" },
  },
  amanda: {
    id: "amanda",
    name: "Amanda J Walker",
    kind: "employee",
    employmentId: "e818418e-1db7-431d-a663-9f477addb8bd",
    note:
      "Mirrors a real Remote Sandbox record — United States, global-payroll employee, active. Employment id e818418e-1db7-431d-a663-9f477addb8bd is the genuine Sandbox id; the record behind it is this repo's mock. Her employer has not granted workation permission, so a workation request naming her is blocked outright — the same request naming Chris Lee is prepared for a specialist. Pick her as the SUBJECT of the admin's workation request.",
    session: { authenticatedEmploymentId: "e818418e-1db7-431d-a663-9f477addb8bd" },
  },

  // --- fourth mirroring pass, 2026-08-22: round-6 D-02 -----------------------
  // The round-6 employee persona was told its own employment reference is
  // `2f7f8210-91fc-47db-803c-77a1cc625781` ("it is on your own paperwork") and
  // the roster above had no such person — every letter obtainable through this
  // page named Chris Lee regardless of who the requester actually was
  // (qa/evidence/UC-01/2026-08-22-uc01-e2e-6/OPEN-DEFECTS.md D-02). This id is
  // not new to the repo: it is src/livedemo/employees.js's Alex Morgan, the
  // same person the real-ticket demo submits as. See mockServer.js's "fourth
  // mirroring pass" block for what is captured fact and what is this repo's
  // own.
  alex: {
    id: "alex",
    name: "Alex Morgan",
    kind: "employee",
    employmentId: "2f7f8210-91fc-47db-803c-77a1cc625781",
    note:
      "Mirrors a real Remote Sandbox record — United States, EOR employee, active. Employment id 2f7f8210-91fc-47db-803c-77a1cc625781 is the genuine Sandbox id, the same one the real-ticket demo submits as, so a letter requested as him names him — not whichever persona the picker happened to default to.",
    session: { authenticatedEmploymentId: "2f7f8210-91fc-47db-803c-77a1cc625781" },
  },

  // --- company admin: requests made ON BEHALF of an employee (UC-04, UC-09)
  // The admin's session carries the COMPANY, and the workflows compare it to
  // the employment's own company_id — an admin of another company is refused
  // by the real gate, not by anything here.
  admin: {
    id: "admin",
    name: "Jane Doe (company admin)",
    kind: "company_admin",
    employmentId: null,
    note: "Admin at Acme (co_amend_01) — files workation and payroll-adjustment requests for the company's own employees. Every employee above is at Acme EXCEPT Lars van der Berg, so this one admin can act for any of the others and is refused for him, which is the company boundary being shown rather than a fault; the admin also acts on employment ids typed into the form, which need not be anyone on this list.",
    session: { companyId: "co_amend_01", authenticatedAdminId: "admin_jane" },
  },
};

// Round-6 D-02 / round-7 R7-42: the picker offered no default, so the browser
// silently selected whichever persona happened to be listed first (Chris Lee,
// by insertion order above) and a first click without correction issued a
// letter naming the wrong person. The signed-in employee this portal is meant
// to demonstrate as is Alex Morgan — the same person src/livedemo/employees.js
// submits the real-ticket demo as — so that is the id the page must default
// to, named explicitly rather than left to fall out of object key order.
export const DEFAULT_PERSONA_ID = "alex";

/** The persona list the page renders, without exposing the session objects. */
export function listPersonas() {
  return Object.values(PERSONAS).map(({ id, name, kind, employmentId, note }) => ({
    id,
    name,
    kind,
    employmentId,
    note,
  }));
}

/**
 * Resolve a persona key to its server-owned session.
 * @returns {Persona|null} null for an unknown key — the caller must fail closed.
 */
export function resolvePersona(key) {
  // Own-property check (finding F-21's pattern): `key` is caller-supplied, and
  // `PERSONAS["constructor"]` would otherwise resolve through the prototype
  // chain to `Object` — a non-null "persona" the caller is documented to
  // treat as authenticated.
  if (typeof key !== "string" || !Object.hasOwn(PERSONAS, key)) return null;
  return PERSONAS[key] ?? null;
}
