// ---------------------------------------------------------------------------
// render.js  —  generic HTML -> PDF rendering (Playwright/Chromium)
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
// docs/SETUP-CHECKLIST.md names PDF rendering as shared "UC-01/03 polish": the
// generated letter (src/uc01/letter.js) is HTML, and a real letter a client
// can download/print should be a PDF. This module is deliberately generic —
// `renderPdfFromHtml(html) -> Buffer` — not UC-01-specific, so it can be
// reused wherever else this repo needs HTML rendered to PDF later (UC-03 was
// considered and rejected: it's a thin router with no letter of its own, so
// there is nothing UC-03-specific to wire here — see workflow.js's own
// header comment on the injection seam for the honest scope note).
//
// SAME "OPTIONAL INTEGRATION, SAFE DEFAULT" SHAPE AS EVERYTHING ELSE IN
// src/shared/ (audit.js's optional pgPool, narrativeJudge.js's optional LLM):
// this module launches a real, heavyweight browser process. Nothing in
// src/uc01/ calls it by default — see workflow.js's `renderPdf` seam, which
// defaults to undefined so production behavior (return letterHtml only) is
// unchanged unless a caller explicitly asks for a PDF. `npm test` never
// imports this file from a hermetic test for the same reason `npm test`
// never calls the real OpenAI client — see test/pdfRender.test.js's header.
//
// A browser launch is NOT cheap or fully hermetic (real subprocess, real
// disk/IPC, meaningfully slower than the rest of this suite's sub-5-second
// baseline) — so this file's own real-Chromium path is only exercised
// on-demand via `npm run pdf-demo` / src/pdf/cli.js, never from `npm test`.
// ---------------------------------------------------------------------------

import { chromium } from "playwright";

/**
 * Render arbitrary HTML to a PDF buffer using headless Chromium.
 *
 * Generic on purpose: takes HTML in, returns PDF bytes out. No knowledge of
 * UC-01's letter shape, or any other caller's document shape, lives here.
 *
 * @param {string} html                    a complete HTML document
 * @param {object} [options]
 * @param {string} [options.executablePath] override Chromium binary path —
 *   this container pre-installs Chromium at a fixed, version-matched
 *   location (`PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`) that Playwright's
 *   default browser resolution already finds; only pass this to point at a
 *   different binary (e.g. if the installed `playwright` package version
 *   drifts from the pre-installed browser build).
 * @param {object} [options.pdf]           passed through to Playwright's
 *   `page.pdf()` — e.g. `{format: "A4", printBackground: true}`. Defaults
 *   below are chosen for a printed letter: US Letter, backgrounds on (the
 *   letter's letterhead border/shadow are CSS backgrounds).
 * @returns {Promise<Buffer>} the rendered PDF's bytes
 */
export async function renderPdfFromHtml(html, options = {}) {
  if (typeof html !== "string" || html.length === 0) {
    throw new Error("renderPdfFromHtml: html must be a non-empty string");
  }

  const launchOptions = {};
  if (options.executablePath) launchOptions.executablePath = options.executablePath;

  const browser = await chromium.launch(launchOptions);
  try {
    const page = await browser.newPage();
    // "load" (not "networkidle") is deliberate: the letter's only external
    // reference is a Google Fonts @import, which this container's restricted
    // network egress may not reach at all — the letter must still render
    // (with a system font fallback) rather than hang or fail waiting on a
    // request that may never resolve.
    await page.setContent(html, { waitUntil: "load" });
    const pdfBuffer = await page.pdf({
      format: "Letter",
      printBackground: true,
      margin: { top: "0.4in", bottom: "0.4in", left: "0.4in", right: "0.4in" },
      ...options.pdf,
    });
    return pdfBuffer;
  } finally {
    await browser.close();
  }
}
