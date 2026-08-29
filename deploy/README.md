# deploy/

Deployable copies and deployment configuration. Everything here targets a
free tier and holds no secret — credentials are set in the hosting provider's
own environment, never in this repository.

| Directory | What it deploys | Live at |
|---|---|---|
| [`cx-apis/`](cx-apis/README.md) | all nine review/approval APIs (`src/review/`, `src/uc02…uc09/`) behind one Vercel function, so the ZAF sidebar works without a laptop running | not yet deployed — see its README |
| [`remote-bridge/`](remote-bridge/README.md) | `src/remotebridge/` — the read-only Remote Sandbox stand-in | `your-sandbox-standin.vercel.app` |

The two are separate Vercel projects. `remote-bridge/` is a self-contained
copy of its source; `cx-apis/` deploys from the repository root instead, so
the nine policy engines exist exactly once — see the header comment in
`../api/index.js` for why that distinction was made deliberately.
