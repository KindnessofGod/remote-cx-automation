// ---------------------------------------------------------------------------
// cli.js  —  `npm run dashboard`
// ---------------------------------------------------------------------------
// Starts the unified dashboard at http://localhost:4060 — one page, nine
// sections (one per use case), each polling its own real list endpoint:
//
//   UC-01  http://localhost:4020/api/review/tickets   (npm run review-api)
//   UC-02  http://localhost:4050/api/expenses          (npm run uc02-api)
//   UC-03  http://localhost:4051/api/cases             (npm run uc03-api)
//   UC-04  http://localhost:4052/api/authorizations    (npm run uc04-api)
//   UC-05  http://localhost:4053/api/resignations       (npm run uc05-api)
//   UC-06  http://localhost:4021/api/amendments          (npm run uc06-api)
//   UC-07  http://localhost:4054/api/dossiers             (npm run uc07-api)
//   UC-08  http://localhost:4023/api/dossiers               (npm run uc08-api)
//   UC-09  http://localhost:4055/api/adjustments             (npm run uc09-api)
//
// This process does NOT start those nine servers or seed any data — it is
// purely the viewer. Start whichever of the nine APIs above you want to see
// (each seeds its own demo rows on boot), then run this. A section whose API
// isn't running shows a clear "could not reach" message rather than a blank
// or fabricated row — same "reads that feed a dashboard throw / never guess"
// discipline as src/metrics/compute.js.
// ---------------------------------------------------------------------------

import { startDashboardServer } from "./server.js";
import { PORTS } from "../shared/ports.js";

async function main() {
  const argv = process.argv.slice(2);
  const portIndex = argv.indexOf("--port");
  const port = portIndex !== -1 && argv[portIndex + 1] ? Number(argv[portIndex + 1]) : PORTS.DASHBOARD;

  const server = await startDashboardServer(port);

  console.log(`▶ Unified dashboard: http://localhost:${port}`);
  console.log("  Start any/all of these first to see real data in each section:");
  console.log("    npm run review-api   (UC-01, :4020)     npm run uc06-api  (UC-06, :4021)");
  console.log("    npm run uc08-api     (UC-08, :4023)     npm run uc02-api  (UC-02, :4050)");
  console.log("    npm run uc03-api     (UC-03, :4051)     npm run uc04-api  (UC-04, :4052)");
  console.log("    npm run uc05-api     (UC-05, :4053)     npm run uc07-api  (UC-07, :4054)");
  console.log("    npm run uc09-api     (UC-09, :4055)");
  console.log("  This page fetches those ports directly from the browser (each already sends");
  console.log("  CORS *) — it starts and seeds nothing itself.");

  const shutdown = () => {
    server.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
