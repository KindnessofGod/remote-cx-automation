// ---------------------------------------------------------------------------
// app.js — the third-party door's browser page
// ---------------------------------------------------------------------------
// THIN ON PURPOSE, and thinner than every other browser asset in this repo:
// there is no outcome to render. The server (server.js) returns exactly one
// fixed acknowledgement string regardless of what it decided internally
// (VC-33 — see its header), so this page has no decision field to read and
// no branch to write. It reads the response's own message and prints it,
// verbatim, whatever the response was — the same discipline every other
// asset in this repo already follows (no innerHTML, no re-derived policy),
// applied to a page that structurally cannot re-derive anything because
// nothing about the outcome is sent to it.
//
// D-27 (rca-87ee) — `e.preventDefault()` used to fire UNCONDITIONALLY, before
// any check of the form's own native validity, so `type="email"`/`pattern`/
// `minlength` on the inputs below had ZERO effect: the browser's constraint
// validation ran, found the fields invalid, and this handler sent them to the
// server anyway. `form.reportValidity()` is now checked first — a malformed
// address or a too-short reference is shown to the enquirer immediately,
// never round-tripped to the server to find out.
//
// D-25 (rca-87ee) — the server now also returns a `reference` a submitter can
// quote later; rendered into its OWN element, never appended to
// `resultMessage`, so `src/surfaceverify/surfaces/browser.js`'s
// `#result-message` check (VC-33: that element always reads the fixed ack)
// stays true unchanged.
//
// D-26 — THE SUBMIT BUTTON USED TO GO SILENT FOR 8.3-13.1s WITH NO PROGRESS
// SIGNAL. `handleVerificationTicket()` runs a real LLM classification and a
// real Remote read before this door can answer, and that is correct — it is
// not a spinner standing in for nothing. But an enquirer watching a disabled
// button with no explanation has no way to tell "still working" from "hung",
// and in production twice assumed the latter, closed the tab, and resubmitted
// — creating a real duplicate enquiry each time (D-26). `PROGRESS_MESSAGE`
// below says what is happening and what leaving costs, in the SAME WORDS
// `src/portal/assets/app.js`'s shared `submit()` uses, because the bug and
// the fix are the same on both surfaces. The server-side join
// (`server.js`'s intake-key claim) is what actually makes a resubmit safe;
// this message is what stops the resubmit from feeling necessary.
// ---------------------------------------------------------------------------

const form = document.getElementById("request-form");
const resultBox = document.getElementById("result");
const resultMessage = document.getElementById("result-message");
const resultReference = document.getElementById("result-reference");
const submitBtn = document.getElementById("submit-btn");
const submitProgress = document.getElementById("submit-progress");

// D-26: kept byte-identical to src/portal/assets/app.js's own copy — see that
// file's comment on its `PROGRESS_MESSAGE`. No shared module: the two pages
// are served by two separate standalone servers with no common bundle.
const PROGRESS_MESSAGE =
  "Sending — this can take up to 15 seconds because we run the real checks now, not after you leave. Please don't close this tab, and avoid sending it again: leaving does not cancel the request, and it may already be underway.";

form.addEventListener("submit", async (e) => {
  e.preventDefault();

  if (!form.reportValidity()) {
    return; // the browser is already showing the enquirer what to fix
  }

  submitBtn.disabled = true;
  submitBtn.textContent = "Sending…";
  submitProgress.textContent = PROGRESS_MESSAGE;
  submitProgress.hidden = false;

  const body = {
    requestingParty: document.getElementById("requestingParty").value,
    actingOnBehalfOf: document.getElementById("actingOnBehalfOf").value,
    subjectName: document.getElementById("subjectName").value,
    subjectDateOfBirth: document.getElementById("subjectDateOfBirth").value,
    subjectClaimedStartDate: document.getElementById("subjectClaimedStartDate").value,
    purpose: document.getElementById("purpose").value,
    employmentReference: document.getElementById("employmentReference").value,
    message: document.getElementById("message").value,
    returnAddress: document.getElementById("returnAddress").value,
    consentEvidence: document.getElementById("consentEvidence").value,
  };

  try {
    const res = await fetch("api/requests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    resultMessage.textContent =
      data.message ?? (data.reason || "Something went wrong — please try again.");
    if (res.ok && data.reference) {
      // D-26: `duplicate` is a fact about THIS DOOR'S OWN submission history
      // (see server.js) — it never varies the fixed VC-33 ack above, only
      // this separate, own-element note, the same "own element, never
      // appended to #result-message" rule D-25's reference already follows.
      resultReference.textContent = data.duplicate
        ? `Your reference: ${data.reference} — this matches a request you already sent us a short while ago, so we're treating it as the same one rather than opening a second. Quote this reference if you write to us again.`
        : `Your reference: ${data.reference} — quote this if you write to us again about this request.`;
      resultReference.hidden = false;
      // REMEMBER IT FOR THEM (2026-08-28, owner: "you want me to copy that
      // random number?"). The reference is a `randomUUID()` — unreadable, and
      // nobody is going to transcribe one to collect a document. The browser
      // that sent the request keeps it, so coming back to this page is enough.
      rememberReference(data.reference);
      showCollectFor(data.reference);
    } else {
      resultReference.hidden = true;
    }
    resultBox.hidden = false;
    if (res.ok) {
      form.hidden = true;
    }
  } catch (err) {
    resultMessage.textContent = "Something went wrong sending this request. Please try again.";
    resultReference.hidden = true;
    resultBox.hidden = false;
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = "Send request";
    submitProgress.hidden = true;
  }
});

// R7-23 — a second, independent form: an enquirer who already has a
// reference and something to add (a deadline, a correction, a "did this
// reach anyone?") had no surface at all before this. Submitting it never
// touches the #result box above or the main form's own state.
// --- remembering the reference ---------------------------------------------
// The enquirer's reference is a capability, not a name: whoever holds it can
// collect an approved letter. Kept in this browser only, never sent anywhere it
// was not already sent, and clearable from the page — the same posture the
// portal takes with its access key. A shared machine is the reason "Forget this
// request" exists rather than being an afterthought.
var REFERENCE_KEY = "rcx.thirdparty.reference";

function rememberReference(reference) {
  try {
    window.localStorage.setItem(REFERENCE_KEY, reference);
  } catch {
    // Private browsing, or storage disabled. The manual field still works, so
    // this degrades to exactly the behaviour that existed before.
  }
}

function recallReference() {
  try {
    return window.localStorage.getItem(REFERENCE_KEY);
  } catch {
    return null;
  }
}

function forgetReference() {
  try {
    window.localStorage.removeItem(REFERENCE_KEY);
  } catch {
    /* nothing to do */
  }
}

/** Put the panel in front of them, filled in, ready for one click. */
function showCollectFor(reference) {
  var input = document.getElementById("collectReference");
  var panel = document.getElementById("collect-panel");
  if (!input || !panel) return;
  input.value = reference;
  panel.open = true;
  var known = document.getElementById("collect-known");
  if (known) known.hidden = false;
}

// --- collect an approved response ------------------------------------------
// Renders the letter into a sandboxed iframe rather than into the page. The
// letter is a full HTML document with its own <style>, and `innerHTML` is
// banned in this repo's browser bundles anyway (test/zafApp.test.js asserts
// it) — an iframe with `srcdoc` keeps the document's own styling intact while
// giving it no access to this page.
const collectForm = document.getElementById("collect-form");
const collectResult = document.getElementById("collect-result");
const collectLetter = document.getElementById("collect-letter");
const collectSubmitBtn = document.getElementById("collect-submit-btn");

collectForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!collectForm.reportValidity()) return;

  const reference = document.getElementById("collectReference").value.trim();
  collectSubmitBtn.disabled = true;
  collectSubmitBtn.textContent = "Checking…";
  collectLetter.hidden = true;
  collectLetter.replaceChildren();

  try {
    const res = await fetch(`api/requests/${encodeURIComponent(reference)}/letter`);
    const data = await res.json();

    if (data && data.ready && data.letterHtml) {
      collectResult.hidden = false;
      collectResult.textContent = data.issuedAt
        ? `Response issued ${new Date(data.issuedAt).toLocaleDateString()}.`
        : "Response ready.";

      const frame = document.createElement("iframe");
      frame.className = "tp-letter-frame";
      frame.setAttribute("sandbox", ""); // no scripts, no same-origin, no forms
      frame.setAttribute("title", "Employment verification letter");
      frame.srcdoc = data.letterHtml;
      collectLetter.appendChild(frame);

      const dl = document.createElement("a");
      dl.className = "r-btn r-btn-secondary tp-letter-download";
      dl.textContent = "Download letter";
      dl.setAttribute("download", `employment-verification-${reference}.html`);
      dl.href = URL.createObjectURL(new Blob([data.letterHtml], { type: "text/html" }));
      collectLetter.appendChild(dl);

      if (data.contentHash) {
        const hash = document.createElement("p");
        hash.className = "r-hint tp-letter-hash";
        hash.textContent = `Document reference ${reference} · SHA-256 ${data.contentHash}`;
        collectLetter.appendChild(hash);
      }
      collectLetter.hidden = false;
    } else {
      collectResult.hidden = false;
      collectResult.textContent = (data && data.message) || "Nothing to share about this request yet.";
    }
  } catch {
    collectResult.hidden = false;
    collectResult.textContent = "Something went wrong on our side. Please try again shortly.";
  } finally {
    collectSubmitBtn.disabled = false;
    collectSubmitBtn.textContent = "Check for a response";
  }
});

const followupForm = document.getElementById("followup-form");
const followupResult = document.getElementById("followup-result");
const followupSubmitBtn = document.getElementById("followup-submit-btn");

followupForm.addEventListener("submit", async (e) => {
  e.preventDefault();

  if (!followupForm.reportValidity()) {
    return;
  }

  const reference = document.getElementById("followupReference").value.trim();
  const message = document.getElementById("followupMessage").value.trim();

  followupSubmitBtn.disabled = true;
  followupSubmitBtn.textContent = "Sending…";

  try {
    const res = await fetch(`api/requests/${encodeURIComponent(reference)}/followup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message }),
    });
    const data = await res.json();
    followupResult.textContent = data.message ?? (data.reason || "Something went wrong — please try again.");
    followupResult.hidden = false;
    if (res.ok) {
      followupForm.reset();
    }
  } catch (err) {
    followupResult.textContent = "Something went wrong sending this. Please try again.";
    followupResult.hidden = false;
  } finally {
    followupSubmitBtn.disabled = false;
    followupSubmitBtn.textContent = "Send follow-up";
  }
});

// ---------------------------------------------------------------------------
// Quick-fills
// ---------------------------------------------------------------------------
// Asked for directly by the project owner, for the same reason the request
// portal has them: a demo should be clickable and readable aloud, not typed
// into seven boxes on camera.
//
// WHAT THE SET IS CHOSEN TO SHOW. Four different KINDS of enquirer — a bank on
// its own account, a landlord, an agency instructed by a client (R7-45's
// field), and someone who already holds a signed release (D-25's field). The
// point of having four is that all four get the IDENTICAL acknowledgement,
// which is the one behaviour this page exists to hold (VC-33, see server.js).
// A set of four that all looked the same would demonstrate nothing.
//
// THE REFERENCE IS DELIBERATELY AN EXAMPLE, not a real employment id. A public
// asset should not ship a lookup key, and it does not need to: this page
// answers a made-up reference and a real one with the same fixed sentence, so
// the example demonstrates the property honestly and a real run is one pasted
// field away. `#scenario-note` says exactly that.
//
// EVERY SCENARIO SETS EVERY FIELD IT CAN TOUCH, blank where deliberately
// empty — the portal's own convention, and load-bearing rather than tidy: a
// key left out would keep whatever the PREVIOUSLY clicked chip put there, so
// the reader would be looking at two scenarios blended into one.
const SCENARIOS = [
  {
    id: "bank-mortgage",
    label: "Bank — mortgage",
    note: "A lender asking on its own account, with no authorisation from the employee yet. This is the ordinary case, and the one where consent has to be sought before anything can be confirmed.",
    fields: {
      requestingParty: "First National Bank",
      purpose: "Mortgage application",
      employmentReference: "EXAMPLE-REF-0001",
      subjectName: "Jordan Ellis",
      subjectDateOfBirth: "1989-04-17",
      subjectClaimedStartDate: "2023-02-01",
      returnAddress: "mortgages@first-national.example.com",
      message:
        "We are assessing a mortgage application and need to confirm this person's current employment status and start date. Please confirm whether they are currently employed and since when. Our credit committee meets on the 12th.",
      actingOnBehalfOf: "",
      consentEvidence: "",
    },
  },
  {
    id: "landlord-tenancy",
    label: "Landlord — tenancy",
    note: "A private landlord referencing a prospective tenant. Same door, same answer — nothing about the enquirer changes what this page will tell them.",
    fields: {
      requestingParty: "Oakfield Property Management",
      purpose: "Tenancy reference",
      employmentReference: "EXAMPLE-REF-0002",
      subjectName: "Jordan Ellis",
      subjectDateOfBirth: "1989-04-17",
      subjectClaimedStartDate: "2023-02-01",
      returnAddress: "lettings@oakfield-property.example.com",
      message:
        "This person has applied to rent a flat from us and named this employer on their application. Please confirm they are currently employed and whether the engagement is ongoing. We hold the tenancy open until Friday.",
      actingOnBehalfOf: "",
      consentEvidence: "",
    },
  },
  {
    id: "agency-for-client",
    label: "Agency — acting for a client",
    note: "A screening firm instructed by somebody else. Before this field existed, agencies crammed the client's name into \"Who are you?\" with a hand-written annotation — so who is asking and who it is for were one string.",
    opens: true,
    fields: {
      requestingParty: "Meridian Screening Services",
      purpose: "Pre-employment background check",
      employmentReference: "EXAMPLE-REF-0003",
      subjectName: "Jordan Ellis",
      subjectDateOfBirth: "1989-04-17",
      subjectClaimedStartDate: "2023-02-01",
      returnAddress: "checks@meridian-screening.example.com",
      message:
        "We have been instructed to complete a standard background check and need this person's employment history with you confirmed — job title, and start and end dates if the engagement has ended.",
      actingOnBehalfOf: "Halloran Group (the hiring employer who instructed us)",
      consentEvidence: "",
    },
  },
  {
    id: "with-authorisation",
    label: "With written authorisation",
    note: "Someone who already holds a signed release. It is attached for a specialist to review — it is NOT taken as consent by this page, which cannot verify a document a stranger describes. The employee's own permission is still what decides this.",
    opens: true,
    fields: {
      requestingParty: "Aurora Credit Union",
      purpose: "Loan underwriting",
      employmentReference: "EXAMPLE-REF-0004",
      subjectName: "Jordan Ellis",
      subjectDateOfBirth: "1989-04-17",
      subjectClaimedStartDate: "2023-02-01",
      returnAddress: "underwriting@aurora-credit.example.com",
      message:
        "We need this person's employment and income confirmed to complete underwriting on a personal loan. We hold their signed authorisation, described below.",
      actingOnBehalfOf: "",
      consentEvidence:
        "Signed release dated 2026-08-20, executed by the employee in our branch and countersigned by our loan officer. Our reference AUR-REL-88214; we can provide the scanned original on request.",
    },
  },
];

// Repeated on every scenario's note rather than said once and forgotten: the
// server joins an identical {employment, requesting party, purpose} submitted
// within the intake window into the request already open (server.js's claim),
// which is correct behaviour and also the thing most likely to make a second
// take look broken.
const SCENARIO_CAVEAT =
  // NO DURATION STATED, DELIBERATELY. This used to say "within an hour", which
  // was the window's value at the time and is now wrong — it is configurable
  // (`THIRD_PARTY_INTAKE_WINDOW_MS`) and currently much shorter. A number
  // restated in browser copy is a second copy of a server fact, and this one
  // had already drifted. "In quick succession" is true at every setting.
  " Submitting the same scenario again in quick succession is joined to the first request rather than opening a second.";

// Filled in from GET /api/example on load. THE SERVER OWNS THIS, and it has
// to: the copy of this door you are reading runs against either the local mock
// or the live Sandbox, and a reference hardcoded here would resolve on exactly
// one of them. Because every outcome returns the identical acknowledgement,
// a quick-fill that had quietly stopped reaching a real record would look
// EXACTLY like one that still did — so the failure this avoids is a silent
// one. Until the fetch returns, and forever if the server has no demo subject
// configured, the chips fall back to the marked example values above, which
// are honest about being examples rather than pretending to be a person.
var demoSubject = null;

fetch("api/example")
  .then((res) => (res.ok ? res.json() : null))
  .then((data) => {
    if (data && data.demo && data.demo.employmentReference) demoSubject = data.demo;
  })
  .catch(function () {
    /* the fallback example values are already in place */
  });

const scenarioRow = document.getElementById("scenario-row");
const scenarioNote = document.getElementById("scenario-note");
const optionalDetails = document.getElementById("optional-details");

/**
 * Write one value and tell the page it changed.
 *
 * The `input`/`change` events are not decoration: a plain `.value =` is
 * invisible to any listener or native constraint-validation state that keys
 * off them, so a filled form could still report itself as untouched.
 */
function setFieldValue(id, value) {
  const el = document.getElementById(id);
  if (!el) return;
  el.value = value;
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

function applyScenario(scenario, button) {
  // The server's demo subject, when it has one, replaces BOTH the reference
  // and the name — so all four chips ask about the same real person from four
  // different kinds of enquirer, which is the comparison worth showing. The
  // scenario's own values stay as the fallback.
  const fields = demoSubject
    ? {
        ...scenario.fields,
        employmentReference: demoSubject.employmentReference,
        subjectName: demoSubject.subjectName ?? scenario.fields.subjectName,
      }
    : scenario.fields;

  for (const [id, value] of Object.entries(fields)) {
    setFieldValue(id, value);
  }

  // Never write into a box the reader cannot see. A scenario that fills either
  // optional field opens the disclosure holding them; one that deliberately
  // leaves both blank closes it again, so the fold always agrees with what is
  // actually in there.
  if (optionalDetails) optionalDetails.open = Boolean(scenario.opens);

  for (const other of scenarioRow.querySelectorAll("button")) {
    other.classList.toggle("is-chosen", other === button);
    other.setAttribute("aria-pressed", other === button ? "true" : "false");
  }

  const provenance = demoSubject
    ? ` The reference and name are a real demo record on the Remote account this page is pointed at, supplied by the server.`
    : ` The reference and name are marked examples — paste a real reference to run a real lookup. The reply is the same either way, which is the point.`;
  scenarioNote.textContent = `Filled: ${scenario.label}. ${scenario.note}${provenance}${SCENARIO_CAVEAT}`;
  scenarioNote.hidden = false;
}

for (const scenario of SCENARIOS) {
  const button = document.createElement("button");
  button.type = "button"; // never submits the form it sits above
  button.className = "r-btn r-btn-secondary";
  button.textContent = scenario.label;
  button.setAttribute("aria-pressed", "false");
  button.addEventListener("click", () => applyScenario(scenario, button));
  scenarioRow.appendChild(button);
}

// --- on load, pick up where they left off ------------------------------------
// The whole point of remembering it: come back to this page after the employee
// has consented and a specialist has approved, and the only action left is one
// click. No reference to find, nothing to paste.
(function restoreReference() {
  var saved = recallReference();
  if (saved) showCollectFor(saved);
  var forget = document.getElementById("collect-forget");
  if (forget) {
    forget.addEventListener("click", function (e) {
      e.preventDefault();
      forgetReference();
      var input = document.getElementById("collectReference");
      if (input) input.value = "";
      var known = document.getElementById("collect-known");
      if (known) known.hidden = true;
      collectLetter.hidden = true;
      collectLetter.replaceChildren();
      collectResult.hidden = true;
    });
  }
})();
