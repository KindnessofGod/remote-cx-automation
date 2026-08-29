// ---------------------------------------------------------------------------
// api/index.js  —  the ONLY reason anything Vercel-shaped sits at the repo root
// ---------------------------------------------------------------------------
// Vercel turns each file under a deployment's TOP-LEVEL `api/` directory into
// a serverless function. It does not look in nested `api/` directories, which
// is why deploy/remote-bridge/api/index.js is not a route of this deployment
// and why this file has to exist here rather than beside its own code.
//
// The deployment root is the REPOSITORY root, deliberately: the function
// imports src/review/server.js, src/uc02/server.js and so on directly, and
// Vercel only uploads files inside the root it is given. Deploying from
// deploy/cx-apis/ instead would mean either a second copy of src/ — nine
// duplicated policy engines, which is the exact hazard CLAUDE.md §6 records
// for the n8n Code nodes — or depending on a dashboard checkbox ("include
// files outside the Root Directory") that a first-time deployer has no reason
// to know about. One repo, one copy of the gates, zero settings to discover.
//
// Everything real lives in deploy/cx-apis/. This file is a re-export and
// should stay one.
// ---------------------------------------------------------------------------

export { default } from "../deploy/cx-apis/handler.js";
