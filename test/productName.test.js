// ---------------------------------------------------------------------------
// productName.test.js  —  the system's name, read back off every surface
// ---------------------------------------------------------------------------
// WHY THIS SUITE EXISTS
// The name lives in a ZAF manifest, a translation file, three page titles, an
// aria-label and two documents. None of those can import a constant — JSON and
// static HTML import nothing — so "keep them in step" is exactly the kind of
// instruction that is not checkable and therefore not kept. This reads each
// literal back against src/shared/productName.js, which is the only way a file
// that cannot import an authority can still be made to agree with one.
//
// WHAT IT DELIBERATELY DOES NOT GUARD
// Every mention of Remote as the system this INTEGRATES WITH. Those are
// evidence — "no Remote write is recorded against it", "Remote publishes no
// endpoint for this stage" — and nearly all of them are disclaimers. See
// productName.js's header for the split. The negative test below is scoped to
// the system NAMING ITSELF after Remote, which is a claim of affiliation, and
// says nothing about naming Remote in a sentence.
// ---------------------------------------------------------------------------

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  PRODUCT_NAME,
  PRODUCT_LONG_NAME,
  ZAF_APP_NAME,
} from "../src/shared/productName.js";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const json = (p) => JSON.parse(read(p));

test("the ZAF app names itself with the one authority, in all three places", () => {
  // A manifest name, a translation and a document title, which Zendesk shows in
  // three different chrome positions. They have drifted from each other before
  // on this repo — an installed app is a static upload and does not track the
  // working tree (CLAUDE.md §6), so three spellings can all be live at once.
  assert.equal(json("zaf-app/manifest.json").name, ZAF_APP_NAME);
  assert.equal(json("zaf-app/translations/en.json").app.name, ZAF_APP_NAME);
  assert.match(read("zaf-app/assets/iframe.html"), new RegExp(`<title>${ZAF_APP_NAME}</title>`));
  assert.match(read("zaf-app/harness/iframe.harness.html"), new RegExp(`<title>${ZAF_APP_NAME}</title>`));
});

test("every page title and the screen-reader label carry the system's own name", () => {
  for (const path of [
    "src/thirdparty/assets/index.html",
    "src/simulator/report.js",
    "docs/case-study.html",
    "README.md",
    "zaf-app/assets/main.js",
  ]) {
    assert.ok(
      read(path).includes(PRODUCT_NAME),
      `${path} names the system something other than "${PRODUCT_NAME}"`
    );
  }
  assert.ok(read("zaf-app/manifest.json").includes(PRODUCT_LONG_NAME), "the manifest's author name drifted");
});

test("no surface a reader sees names this system after Remote", () => {
  /* THE ONE THING THE RENAME WAS FOR. Citing Remote is evidence and stays
     everywhere; being CALLED "Remote CX …" is a claim of affiliation, and it
     was the system's name in a Zendesk app installed in a live account, on a
     case-study page meant to be sent as a link, and on the public third-party
     door. A reader cannot tell an integration from an endorsement by reading a
     product name, so the name has to do that work by not making the claim.

     Scoped to the SURFACES, not to src/ generally: design comments discussing
     the old name are history and are allowed to say it. */
  for (const path of [
    "zaf-app/manifest.json",
    "zaf-app/translations/en.json",
    "zaf-app/assets/iframe.html",
    "zaf-app/harness/iframe.harness.html",
    "src/thirdparty/assets/index.html",
    "docs/case-study.html",
  ]) {
    assert.ok(
      !read(path).includes("Remote CX"),
      `${path} still calls the system "Remote CX …", which reads as a product Remote ships or endorses`
    );
  }
});

test("nothing a requester or approver reads calls the system Remote's", () => {
  // The two that were not titles: the approval queue names the sidebar it sends
  // a specialist to, and the employee-facing mobility-review notice named the
  // decider. Both are sentences a non-engineer reads, so both are the name
  // doing affiliation work rather than a citation doing evidence work.
  assert.ok(!read("src/approvalqueue/approvalRoutes.js").includes('"Zendesk — the Remote CX Review sidebar'));
  assert.ok(!read("src/uc04/mobilityReview.js").includes("Remote CX's decision"));
});

test("the citations that name Remote are untouched, and this suite proves it", () => {
  /* NEGATIVE CONTROL, and the reason it is here rather than assumed: the
     obvious way to answer "too many mentions of Remote" is a find-and-replace,
     which would silently delete the disclaimers that are the best evidence in
     the project. If this ever goes green while these are gone, the rename ate
     the honesty it was supposed to leave alone. */
  const notice = read("src/uc04/mobilityReview.js");
  assert.match(notice, /Remote publishes no endpoint for this stage/);
  assert.match(notice, /not sent to Remote and Remote's own systems will not show it/);
  assert.match(read("src/uc04/authorizationRecord.js"), /Remote publishes no endpoint for this stage/);
});
