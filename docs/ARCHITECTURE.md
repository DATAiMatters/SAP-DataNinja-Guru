# Architecture

This document describes the SAP Knowledge Base as it exists today. For where it's going, see [`HANDOFF.md`](../HANDOFF.md). For the multi-agent extraction pipeline specifically, see [`AGENTS.md`](AGENTS.md).

## Three layers, three concerns

The system separates three things that are usually conflated in knowledge tools:

| Layer                | Lives in            | Changes when                  | Validated by                |
|----------------------|---------------------|-------------------------------|-----------------------------|
| Curated knowledge    | `/domains/*.yaml`   | A maintainer commits a change | `schema.json` + CI scripts  |
| Social activity      | SQLite (planned)    | A user votes / comments       | App-level constraints       |
| Pipeline artifacts   | `/generated/`       | A propose / extract job runs  | Schema, then human review   |

The split is deliberate. Conflating them is the failure mode of every "wiki for technical knowledge" — eventually nobody trusts the content because it can change without review.

## The curated layer

```
/clusters.yaml             Cluster registry (visual grouping). Append-only writes preserve comments.
/schema.json               JSON Schema (draft 2020-12). Locked at format_version 0.2.
/domains/*.yaml            One file per SAP domain. Each contains:
                             domain (id, name, sap_module, description)
                             tables (id, cluster, fields, key_fields, …)
                             relationships (simple + polymorphic)
                             annotations (gotchas, sql_examples, s4_changes, notes)
/sources/                  Backing PDFs for curated content (committed; copyright permitting)
/scripts/
  validate.sh              Shell wrapper for CI
  validate_yaml.py         JSON Schema validation
  check_cluster_refs.py    Every cluster: must resolve to clusters.yaml
  generate_mermaid.py      Renders a domain to a static Mermaid diagram
  extract.py               PDF/URL → text (used by propose_domain.py)
  propose_domain.py        Multi-agent pipeline: PDF → draft YAML
```

CI runs `validate.sh` on every push. A broken schema reference, a dangling cluster id, or a typo in `format_version` fails the build.

## The viewer (`/web/`)

Next.js 15 App Router. The choice is deliberate:

- **Server Components for static YAML content.** The viewer doesn't need a separate API for reads; the YAML is just imported and rendered server-side.
- **File-based routing maps to domain ids.** `/domains/[id]` and `/domains/[id]/[tableId]` are zero-glue URLs.
- **Single process.** One `npm run dev` brings up viewer, API, and admin together.

Layout:

```
/web/
├── /app/                  Routes (App Router)
│   ├── /domains/          Browse, search, ERD
│   ├── /curate/           Annotation inbox (Phase 4)
│   ├── /ingest/           Propose-domain UI (upload, log, draft, apply)
│   ├── /jobs/             Run history (Phase 4)
│   └── /api/              Server actions: drafts/save, drafts/apply, ingest, …
├── /lib/
│   ├── yaml.ts            Loads /domains/*.yaml at boot, validates, caches
│   ├── drafts.ts          Reads/writes /generated/drafts/, validates, applies to /domains/
│   ├── jobs.ts            Disk-backed job records (meta.json + log.ndjson)
│   └── schema-types.ts    Generated TypeScript types from schema.json
├── /components/           UI building blocks
│   ├── DraftViewer.tsx    Inline YAML editor + apply button
│   ├── JobLogViewer.tsx   Live log streaming via SSE
│   └── EditableText.tsx   Click-to-edit field for admin inline edits
└── /auth.ts               NextAuth: email magic link
```

### Data flow: read

1. Server Component imports `getDomain(id)` from `lib/yaml.ts`.
2. `getDomain` returns from cache or reads `domains/<id>.yaml`, validates against `schema.json`, parses, caches.
3. Component renders.

The YAML is parsed once per server-process lifetime (cache is invalidated by `applyDraft`).

### Data flow: write (admin inline edit)

1. User clicks an `<EditableText>` field, types, blurs.
2. Client `POST /api/domains/[id]` with the path + new value.
3. Server: auth check (admin email allowlist), path allowlist (load-bearing fields like `domain.id` are excluded), `setIn` over a YAML AST, `writeFile`.
4. `invalidateDomainCache()` so the next read picks up the change.

`yaml` (the library) is used in AST mode so comments and ordering survive the round trip — see [`DECISIONS.md`](DECISIONS.md) for why.

### Data flow: propose-domain (multi-agent)

1. User uploads a PDF at `/ingest`.
2. API spawns `python scripts/propose_domain.py` as a subprocess; job record persists to `generated/jobs/<id>/`.
3. Live log streams to the client via SSE.
4. Pipeline: extractor LLM → cluster registrar → reviewer LLM → repair LLM (if gaps).
5. Final draft written to `generated/drafts/<id>-<timestamp>.yaml`.
6. UI renders the draft inline. User can edit and re-validate (server re-reads on `router.refresh()`).
7. **Apply** writes the draft to `domains/<id>.yaml` after a final validation. Cache is invalidated.

See [`AGENTS.md`](AGENTS.md) for the agent details.

## The job system

Long-running LLM jobs (PDF ingest, propose-domain) run as **detached** subprocesses whose stdio is redirected to disk files instead of parent pipes. The parent (Next.js dev server) can be restarted, HMR'd, or killed without disturbing the subprocess.

```
/generated/jobs/<jobId>/
├── meta.json              Status, type, source, timestamps, token usage,
│                          subprocess pid, tailer byte offsets
├── log.ndjson             Formatted log (one JSON line per stdout/stderr line),
│                          consumed by the SSE stream and the read-back UI
├── stdout.log             Raw subprocess stdout — written directly by the OS,
│                          survives parent death
├── stderr.log             Same for stderr
├── exit.code              Sentinel: shell wrapper writes the python exit code
│                          here after the script returns
└── source/                Uploaded PDF (so the run is reproducible later)
```

### Why this shape

Earlier iterations used `child_process.spawn` with default pipe-based stdio and `detached: false`. Two failure modes followed:

1. **HMR-during-job:** when `lib/jobs.ts` (the file holding `runPython`) was edited mid-run, Next.js sometimes did a full server restart. The Node parent died and SIGTERM'd its children. A 4-minute Anthropic call vanished.
2. **Pipe-close-on-parent-exit:** even with `detached: true`, the subprocess wrote stdio to pipes owned by the parent. When the parent exited, those pipes closed, and the next subprocess write raised EPIPE.

The current architecture solves both:

```
┌────────────────────┐
│  Node parent       │  ← can die / restart freely
│  (Next.js)         │
│  ┌──────────────┐  │
│  │ tailer       │──┼──┐  setInterval(400ms) reads new bytes,
│  │              │  │  │  splits lines, calls append() →
│  └──────────────┘  │  │  log.ndjson + SSE subscribers
└────────────────────┘  │
        spawn sh -c     │
        detached: true  │
        unref()         │
                        ▼
        ┌─────────────────────────────────┐
        │  generated/jobs/<id>/            │
        │  ├── stdout.log ◄─── child writes here directly
        │  ├── stderr.log ◄── (file fds, not parent pipes)
        │  └── exit.code   ◄── sh writes after python returns
        └─────────────────────────────────┘
                        ▲
        ┌───────────────┼─────────┐
        │ sh -c "python3 …;       │
        │       echo $? > exit.code" │  ← own process group;
        │                         │     survives parent death
        └─────────────────────────┘
```

### Hydration and recovery

On every `lib/jobs.ts` import (i.e. each parent start), `hydrateFromDisk` walks `generated/jobs/`. Non-terminal jobs branch three ways:

1. **PID alive (`process.kill(pid, 0)` succeeds):** the subprocess outlived the parent. Resume the file tailer from the persisted byte offset; status stays `running`. A `parent restarted; resuming log tail of pid N` system line is appended so the user sees what happened.
2. **PID dead, `exit.code` present:** the subprocess completed while the parent was down. Drain the final batch of output, read `exit.code`, finalize status accurately (`done` if 0, `error` otherwise).
3. **No PID (legacy job from before detached spawning):** mark errored with a "process restarted before completion" note. Fall-through case for old data.

### What's still in scope

The `DELETE /api/jobs/[jobId]` endpoint and the bulk `POST /api/jobs/clear-errored` let signed-in users prune the index when failed runs accumulate. Active jobs (`pending` or `running`) are protected — the API returns 409 and the UI button is disabled, since deleting their disk record would orphan a running subprocess we couldn't track. To delete a stuck active job, restart the dev server first; the orphan reaper will mark it errored, then it's deletable.

### What's still NOT in scope

- **A real worker queue** (BullMQ, pg-boss, etc.). Subprocesses survive parent death now, so the "lost run" failure mode is gone. Multi-instance hosting is when a queue earns its keep, and we don't have multi-instance hosting.
- **Cancellation of running jobs.** The PID is on the Job record so the wiring exists; we just haven't built the UI button. `process.kill(pid, 'SIGTERM')` to the persisted pid would do it.
- **Cross-restart cancellation.** Same as above but harder to reason about — the PID may have been recycled by the OS. Add a process-start-time fingerprint if/when this matters.

## Tech stack

| Concern                | Choice                                | Why                                                                                                                    |
|------------------------|---------------------------------------|------------------------------------------------------------------------------------------------------------------------|
| Frontend framework     | Next.js 15 (App Router)               | RSC for static YAML, file-based routing for domain ids, single-process dev                                              |
| Static ERD render      | Mermaid CLI (via `generate_mermaid.py`)| Markdown-embeddable, same source YAML, no JS at read time                                                              |
| Interactive ERD        | React Flow (planned)                   | Drag-to-position, subflow grouping, click-through                                                                      |
| Backend                | Next.js API routes                     | Single process, no separate service                                                                                    |
| DB (social layer)      | SQLite via `better-sqlite3`            | Single file, easy backup, fine for read-heavy. Postgres swap is one Drizzle config change                              |
| ORM                    | Drizzle                                | Typed, lightweight, no runtime overhead                                                                                |
| Search                 | MiniSearch (client-side)               | YAML corpus is small (<1MB at 20 domains). In-browser fuzzy search is instant and needs no server                      |
| YAML read              | `yaml` (eemeli/yaml, AST mode)         | Round-trip safe with comments. Required for round-trip writes                                                          |
| Auth                   | NextAuth + email magic link            | No password hell. Admin gate is an email allowlist                                                                     |
| LLM                    | Anthropic Claude (Opus default)        | Whole-domain extraction is high-stakes and rare; quality > cost. Model overridable via `ANTHROPIC_MODEL_PROPOSE`        |
| Job runner             | Subprocess + disk-backed records       | Survives HMR; replace with a real worker queue (BullMQ / pg-boss) if scale demands                                     |

## Observability

Token usage is tracked per LLM call. Each script emits `usage: input=N output=N model=X` to stdout; `lib/jobs.ts` parses and aggregates. The viewer's job log shows live elapsed time and accumulated token count. Cost-in-dollars is a follow-up — counts and model are captured, just no rate table yet.

A `/jobs` page lists all runs (active, completed, errored) with sort, filter, and a download link to the source PDF. This is what the user uses when something looks like it "went nowhere" mid-run — there's always a record.

## What's deliberately NOT in scope

- **A persistent worker queue.** Subprocesses are fine for dev and a single deployment. If multi-instance hosting becomes a thing, swap to BullMQ.
- **Real-time collaboration.** Inline edits are last-write-wins. If two admins edit the same field at once, one wins; the file is git-tracked so recovery is grep-and-revert.
- **A general-purpose ERP knowledge tool.** This is SAP-specific by design. Conventions like KSSK polymorphism are baked in. Forks for other ERPs are encouraged but expected to diverge.
