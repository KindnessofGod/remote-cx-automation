# L2-01 · Remote API reference — the operation index (`llms.txt`)

| | |
|---|---|
| **Catalogue id** | L2-01 (`docs/KNOWLEDGE-SOURCES.md` §5) |
| **Source name** | Remote API Documentation index, published as `llms.txt` |
| **Publisher / authority** | Remote Europe Holding, B.V. ("Remote") |
| **Exact URL** | <https://developer.remote.com/llms.txt> |
| **Retrieved** | **2026-08-19**, by `curl` from the build container. HTTP 200, 475 lines. |
| **SHA-256 of the retrieved bytes** | `72e7841f7745733f423ef5f6aca8e29348450edbcd97e8ef2c4fe950f1bf495f` |
| **Licence / basis for inclusion** | Remote's own public integrator documentation, served without authentication at an endpoint Remote publishes **specifically for machine consumption** (`llms.txt` is the AI-ingestion convention, and every page carries the line *"Fetch the complete documentation index at: https://developer.remote.com/llms.txt"*). This file reproduces **operation names and counts only** — not the index and not any page. See "What is reproduced here" below. |
| **Evidence tag** | `[CONFIRMED — live, 2026-08-19]` |

## What is reproduced here, and what deliberately is not

`KNOWLEDGE-SOURCES.md` L2-01 states the posture: *"Reproducing schema facts and
short quotations inside our own dossiers is within the evident purpose;
**wholesale republication is not ours to grant** — flag if it ever comes up."*

It has now come up, and the answer taken is: **no mirror.** This file records the
retrieval, the checksum, and the *diff* against what the repository already
holds. The document itself stays one `curl` away at the URL above.

`docs/REMOTE-API-INDEX.txt` is the repository's existing checked-in snapshot of
this same index. It is **not** replaced by this pass, and it is now measurably
stale — which is the point of the entry below.

## Finding: the operation inventory has moved since the checked-in snapshot

Comparing the `.md` operation URLs in `docs/REMOTE-API-INDEX.txt` (460 unique)
against the index fetched today (466 unique):

**Present today, absent from the checked-in snapshot — six new operations:**

```
/reference/delete_v1_pay-items_id.md
/reference/patch_v1_pay-items_id.md
/reference/get_v1_contractors_employments_employment_id_rates.md
/reference/post_v1_sandbox_contractors_employments_employment_id_rates.md
/reference/get_v1_direct-offboardings.md
/reference/get_v1_employments_bulk.md
```

**Present in the snapshot, absent today — one, and it is a move, not a removal:**

```
/public-page.md   →   /page/public-page.md
```

Two of the six touch use cases this repository has already built and are worth a
look by whoever owns them, though **neither is acted on in this pass**:

- `GET /v1/direct-offboardings` — UC-05 is an offboarding use case that currently
  has **no** Remote write or read endpoint of its own (`CLAUDE.md` §4: *"No real
  write endpoint exists (spec-confirmed), so the signed-off report is the durable
  artifact"*). That claim was true against the snapshot. It should be re-checked
  against this operation before it is repeated.
- `PATCH` / `DELETE /v1/pay-items/{id}` — UC-09 executes off-cycle money through
  `createIncentive()`. A mutable pay-item family is adjacent to that path.

**This is the L2-01 staleness monitor working, on its first real run.** The
catalogue's argument for it was that *"a change in the operation inventory is
exactly how the invented `POST /v1/work-authorization-requests` would have been
caught before it shipped."* One diff, run once, surfaced six real additions and
one silent URL move. Cost: one `curl` and one `comm`.

## How to re-run this check

```sh
curl -sS https://developer.remote.com/llms.txt \
  | grep -oE 'https://developer\.remote\.com/[a-z0-9_./-]+\.md' | sort -u > /tmp/new.txt
grep -oE 'https://developer\.remote\.com/[a-z0-9_./-]+\.md' docs/REMOTE-API-INDEX.txt \
  | sort -u > /tmp/old.txt
comm -3 /tmp/old.txt /tmp/new.txt
```

Empty output means the inventory is unchanged. Anything else is a compliance
event, not noise.

## Access note

`WebFetch` is egress-blocked for `developer.remote.com` in this container;
**`curl` reaches it.** Every page below the `/reference/` prefix has a `.md`
form. This is the only external authority in the whole catalogue that this
container can reach — see `../layer-1-statutory/RETRIEVAL-BLOCKED.md`.
