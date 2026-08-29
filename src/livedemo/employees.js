// ---------------------------------------------------------------------------
// employees.js  —  Real Remote Sandbox employees this demo can submit as
// ---------------------------------------------------------------------------
// The live demo page needs a real Sandbox employment id + the exact email on
// that record (identity verification in the n8n workflow fails closed unless
// the Zendesk ticket's requester email matches the employment's email
// exactly). There's no API available to this list to auto-discover these —
// each one was confirmed by hand against the real Sandbox account.
//
// To add another: open the employee in the Sandbox dashboard
// (https://employ.remote-sandbox.com/dashboard/people/...), copy the UUID
// from the page URL (NOT the short display code shown in the app, e.g.
// "DG4KTE" — that's a display id, not the API id) and the email shown on
// their profile.
// ---------------------------------------------------------------------------

// NOTE ON STALENESS — read before trusting any entry here. The Sandbox account
// behind this project was re-provisioned at some point before 2026-08-15: the
// previously-recorded employment `fde4007b-6257-4504-9467-8d61b5785488`
// ("Alexandre Tremblay") now returns 404 "Employment not found", and the whole
// account's email domain changed from `howe-dickens-and-conn-dq6kjb.example.com`
// to `rempel-paucek-4c3wac.example.com`. Nothing warns you: the demo just fails
// the identity gate, which looks like a logic bug and isn't. If a demo starts
// failing for no reason, re-list `GET /v1/employments` and refresh this file
// before debugging anything else — or just run `npm run verify-live-uc01`,
// which checks exactly that first and names the failure correctly.
//
// BOTH ENTRIES BELOW WERE RE-VERIFIED LIVE ON 2026-08-19 against
// `GET /v1/employments/{id}` on https://gateway.remote-sandbox.com — id,
// status, contract type AND the email string, character for character. The
// email is the part that rots silently, so it is the part that is checked.
//
// THE ONE THING THAT IS NOT SAFE TO ASSUME — the Zendesk side.
// `createTicket({requester:{name,email}})` matches an existing Zendesk user by
// EMAIL, so submitting through this page always produces a requester whose
// address matches the Remote record. But the `your-subdomain` account still holds a
// hand-made end-user "Alexandre Tremblay" (Zendesk user `6154475522463`) whose
// address is the PRE-RESEED one, `owner+contractor-contractor_of_record-can-19@
// howe-dickens-and-conn-dq6kjb.example.com`. A ticket raised BY HAND from that
// user against employment `3537d9ee-…` fails the identity gate closed
// (`requester_employment_mismatch` → `escalate`) and no letter is ever sent —
// correct behaviour, and indistinguishable on screen from the automation being
// broken. Verified live 2026-08-19 by running the n8n gates body against the
// live payload with each address in turn. Alex Morgan's Zendesk user
// (`6154473648671`) already carries the CURRENT address, so he is the safe
// pick for a hand-driven demo.
export const KNOWN_EMPLOYEES = [
  {
    id: "2f7f8210-91fc-47db-803c-77a1cc625781",
    // REMOTE'S OWN "Employee ID" — the six-character code Remote shows the
    // employee in their profile under Job and Pay, exposed by the API as
    // `short_id`. Verified live 2026-08-28: GET /v1/employments?short_id=CZKYVH
    // returns exactly this employment. It is what a bank or landlord is
    // realistically given; the UUID above is what the API keys on.
    shortId: "CZKYVH",
    name: "Alex Morgan",
    email: "owner+employee-eor-usa-10001@rempel-paucek-4c3wac.example.com",
    note: "EOR employee (USA), status active, job title 'Content Writer Wizard' — re-confirmed live against Remote Sandbox 2026-08-19. Their existing Zendesk end-user carries this same address, so a hand-made ticket works too.",
  },
  {
    id: "3537d9ee-2017-4a53-952e-9d3b042aeab5",
    // The record's own `full_name`, not a description of it: this string
    // becomes the Zendesk requester's name, and "Contractor
    // (contractor_of_record, CAN)" is not a person a demo viewer believes in.
    name: "Alexandre Tremblay",
    email: "owner+contractor-contractor_of_record-can-19@rempel-paucek-4c3wac.example.com",
    note: "Contractor (contractor_of_record, CAN), status active, job title 'Financial Manager' — re-confirmed live against Remote Sandbox 2026-08-19. Same person as the dead `fde4007b-…` id from this repo's history, under a new id. NB the pre-reseed Zendesk end-user of the same name carries the OLD address — see the note above.",
  },
];
