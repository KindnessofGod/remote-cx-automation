#!/usr/bin/env node
// ---------------------------------------------------------------------------
// cli.js  —  npm run remotebridge
// ---------------------------------------------------------------------------
// Starts the Remote Sandbox stand-in. Point n8n's Remote base URL at this
// instead of gateway.remote-sandbox.com to get demo-complete employment
// records, with every synthesized field named in the response.
// ---------------------------------------------------------------------------

import "dotenv/config";
import { createBridge } from "./server.js";
import { PORTS } from "../shared/ports.js";
import { STANDIN_PROFILES } from "./enrichment.js";

const port = Number(process.env.REMOTE_BRIDGE_PORT) || PORTS.REMOTE_BRIDGE;
const upstream = process.env.REMOTE_BASE_URL || "https://gateway.remote-sandbox.com";
const token = process.env.REMOTE_API_TOKEN || null;

createBridge({ upstream, token }).listen(port, () => {
  console.log(`Remote Sandbox stand-in listening on http://localhost:${port}`);
  console.log(`  upstream : ${upstream}`);
  console.log(`  auth     : ${token ? "using REMOTE_API_TOKEN" : "passing the caller's Authorization header through"}`);
  console.log(`  profiles : ${Object.keys(STANDIN_PROFILES).length} employment(s) have demo-completeness data`);
  console.log("");
  console.log("  It proxies READS to the real Sandbox and fills ONLY fields the Sandbox left empty.");
  console.log("  Every filled field is named in X-Standin-Enriched and in the response's _standin block.");
  console.log("  Writes are refused (405) — a stand-in must never fake a state change.");
});
