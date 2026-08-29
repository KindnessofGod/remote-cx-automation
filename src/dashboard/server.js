// ---------------------------------------------------------------------------
// server.js  —  The unified dashboard's HTTP server
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
// Every use case (UC-01…09) already has its own real list endpoint
// (src/review/server.js's GET /api/review/tickets, src/uc02/server.js's
// GET /api/expenses, … src/uc09/server.js's GET /api/adjustments — see
// CLAUDE.md §5's dashboard entry). This is the one page that puts all nine
// side by side. It is deliberately NOT a backend that re-fetches and
// re-serves those endpoints: every one of the nine servers already sends
// `Access-Control-Allow-Origin: *` (see each server's OPTIONS handler), so
// the browser can call every port directly. Routing that data through this
// server first would just be a second hop that adds nothing and could drift
// out of sync with the real APIs. This server's only job is to serve the
// three static assets that make the polling happen in the browser.
//
// Same node:http, no-framework shape as playground/server.js and every
// other local server in this repo.
// ---------------------------------------------------------------------------

import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

const ASSETS = {
  "/": { file: "index.html", type: "text/html; charset=utf-8" },
  "/app.js": { file: "app.js", type: "application/javascript; charset=utf-8" },
  "/style.css": { file: "style.css", type: "text/css; charset=utf-8" },
  // The shared design system (src/shared/ui/remote-ui.css), served from every
  // browser surface at the same path so the six of them stay one product
  // rather than six. `dir` overrides the default assets/ lookup below.
  "/remote-ui.css": {
    file: "remote-ui.css",
    dir: join(__dirname, "..", "shared", "ui"),
    type: "text/css; charset=utf-8",
  },
};

/** Serves the dashboard's static assets. No API routes — see header comment. */
export function createDashboardHandler() {
  return function handle(req, res) {
    const url = new URL(req.url, "http://localhost");

    const asset = req.method === "GET" ? ASSETS[url.pathname] : null;
    if (asset) {
      const body = readFileSync(join(asset.dir ?? join(__dirname, "assets"), asset.file));
      res.statusCode = 200;
      res.setHeader("Content-Type", asset.type);
      return res.end(body);
    }

    res.statusCode = 404;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ ok: false, code: "no_such_route", path: url.pathname }));
  };
}

/** Start the dashboard on `port`. Returns the http.Server once listening. */
export function startDashboardServer(port = 4060) {
  const server = createServer(createDashboardHandler());
  return new Promise((resolve) => server.listen(port, () => resolve(server)));
}
