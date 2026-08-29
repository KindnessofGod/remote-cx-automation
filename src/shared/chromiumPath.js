// ---------------------------------------------------------------------------
// chromiumPath.js — where Playwright's Chromium actually is, on THIS machine.
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
// Both PDF entry points used to hardcode `/opt/pw-browsers/chromium` as their
// default. That path exists in the dev container this project was built in and
// nowhere else, so `npm run pdf-demo` failed for every other reader with:
//
//   Failed to launch chromium because executable doesn't exist at
//   /opt/pw-browsers/chromium
//
// The trap is that `npx playwright install chromium` does NOT fix it. Passing
// `executablePath` explicitly overrides Playwright's own resolver, so a
// correctly installed browser was ignored in favour of a path that was not
// there. The reader had to discover `PW_CHROMIUM_PATH`, which appeared in no
// README, no setup guide and no .env.example.
//
// Returning `undefined` is the fix: Playwright then uses whatever it installed.
// ---------------------------------------------------------------------------
import { existsSync } from "node:fs";

const CONTAINER_CHROMIUM = "/opt/pw-browsers/chromium";

/**
 * @returns {string|undefined} an explicit executable path, or `undefined` to
 *   let Playwright resolve its own bundled browser.
 */
export function resolveChromiumPath() {
  if (process.env.PW_CHROMIUM_PATH) return process.env.PW_CHROMIUM_PATH;
  if (existsSync(CONTAINER_CHROMIUM)) return CONTAINER_CHROMIUM;
  return undefined;
}
