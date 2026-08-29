// ---------------------------------------------------------------------------
// browser.js  —  The two surfaces that genuinely need a browser
// ---------------------------------------------------------------------------
// Rule 2: "Client-rendered surfaces (ZAF sidebar, /audit feed) need a
// browser." Two are built here:
//
//   zafSidebarBody      — the signed JSON the ZAF app proxy hands the sidebar.
//                          Captured over the wire during a real agent session
//                          (storageState.json), NOT scraped from the rendered
//                          DOM, because the JSON body is exactly what the
//                          sidebar renders and reading it directly is more
//                          robust than chasing selectors across a bundle
//                          version bump (round 4's cells[7] lesson).
//   thirdPartyDoorForm   — F-1: whether the public, unauthenticated
//                          third-party page's form actually submits and shows
//                          the fixed acknowledgement (VC-33), not just whether
//                          the page loads.
//
// Both share ONE Chromium instance across the whole run (launched lazily,
// closed by the caller) — launching per-call is what made round 4's scripts
// each take double-digit seconds.
// ---------------------------------------------------------------------------

import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

import { SurfaceUnreachableError } from "../target.js";

let _browserPromise = null;
async function sharedBrowser() {
  if (!_browserPromise) {
    const { chromium } = require("playwright");
    _browserPromise = chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  }
  return _browserPromise;
}

export async function closeSharedBrowser() {
  if (_browserPromise) {
    const b = await _browserPromise;
    await b.close();
    _browserPromise = null;
  }
}

/**
 * @param {object} opts
 * @param {string} opts.subdomain          Zendesk subdomain, e.g. "your-subdomain"
 * @param {string} opts.storageStatePath   a fresh agent session (cookies), NOT committed anywhere
 */
export function makeZafSidebarSurface({ subdomain, storageStatePath }) {
  return {
    id: "zafSidebarBody",
    contract: "the signed JSON body the ZAF app proxy returns for GET /api/review/ticket/:id — byte-identical to what the sidebar panel renders",
    audience: "the specialist/agent viewing the ticket in Zendesk",
    /** @param {{decision: {zendeskTicketId?: string, externalRef: string}}} scenario */
    async textFor(scenario) {
      const ticketId = scenario.decision.zendeskTicketId ?? scenario.decision.externalRef;
      if (!ticketId || !Number.isInteger(Number(ticketId))) return null;

      const browser = await sharedBrowser();
      let ctx;
      try {
        ctx = await browser.newContext({ storageState: storageStatePath, viewport: { width: 1600, height: 1300 } });
      } catch (err) {
        throw new SurfaceUnreachableError(
          `could not open a Zendesk agent browser context from ${storageStatePath}: ${err.message}. ` +
            "A fresh agent session (not a recovery code) is required — see the bead's reconnaissance.",
          { code: "zendesk_session_unavailable" }
        );
      }
      try {
        const page = await ctx.newPage();
        let captured = null;
        const onResponse = async (r) => {
          if (/zendesk_apps_proxy/.test(r.url()) && r.url().includes(`review%2Fticket%2F${ticketId}`)) {
            try {
              captured = await r.text();
            } catch {
              /* response body already consumed/closed — next matching response may still land */
            }
          }
        };
        page.on("response", onResponse);
        await page.goto(`https://${subdomain}.zendesk.com/agent/tickets/${ticketId}`, {
          waitUntil: "domcontentloaded",
          timeout: 90_000,
        });
        try {
          await page.locator('[data-test-id="omnipanel-selector-item-apps"]').first().click({ timeout: 20_000 });
        } catch {
          /* the apps panel may already be open/pinned — a missed click is not fatal, the proxy call still fires */
        }
        for (let i = 0; i < 24 && !captured; i++) {
          await page.waitForTimeout(2500);
        }
        page.off("response", onResponse);
        if (!captured) {
          throw new SurfaceUnreachableError(
            `no zendesk_apps_proxy response for ticket ${ticketId} was observed within the wait window — ` +
              "the ZAF app may not be installed/enabled on this account, or the sidebar panel never opened.",
            { code: "zaf_proxy_body_not_captured" }
          );
        }
        return captured;
      } finally {
        await ctx.close();
      }
    },
  };
}

/**
 * F-1: is the third-party door's FORM actually operable — not just "does the
 * page load". Fills every required field and submits; the fixed behaviour
 * (VC-33) is that #result-message always shows THIRD_PARTY_ACK_MESSAGE
 * regardless of what was typed.
 */
export function makeThirdPartyDoorSurface({ baseUrl }) {
  return {
    id: "thirdPartyDoorForm",
    contract: "the unauthenticated third-party intake form's post-submit acknowledgement",
    audience: "a bank/landlord/vendor with no Remote account",
    // Not scenario-shaped (the door has no employmentId to key on) — called
    // once by the runner outside the fact x surface x scenario loop, and its
    // result is asserted against the known VC-33 constant rather than a
    // per-scenario fact.
    async submitOnce() {
      const browser = await sharedBrowser();
      const ctx = await browser.newContext({ viewport: { width: 1400, height: 1100 } });
      try {
        const page = await ctx.newPage();
        await page.goto(`${baseUrl}/thirdparty`, { waitUntil: "domcontentloaded", timeout: 60_000 });
        await page.locator("#requestingParty").fill("verify-surfaces runner");
        await page.locator("#purpose").fill("automated surface verification — no real employment implicated");
        await page.locator("#employmentReference").fill(`verify-surfaces-${Date.now()}`);
        await page
          .locator("#message")
          .fill("Automated check from npm run verify-surfaces. Not a real disclosure request.");
        await page.locator("#returnAddress").fill("verify-surfaces@example.invalid");
        await page.locator("#submit-btn").click();
        await page.locator("#result").waitFor({ state: "visible", timeout: 20_000 });
        const message = (await page.locator("#result-message").innerText()).trim();
        return { submitted: true, message };
      } catch (err) {
        return { submitted: false, error: err.message };
      } finally {
        await ctx.close();
      }
    },
  };
}
