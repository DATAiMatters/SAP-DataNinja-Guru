# Claude Code Handoff — SAP Knowledge Base App

## TL;DR for Claude Code

You're building an internal-Syniti web app that lets consultants browse curated SAP table relationship knowledge (joins, SQL, gotchas, S/4 migration changes), search across it, render ERDs interactively, and contribute via votes/comments/annotations. The curated knowledge lives in YAML files in this repo. The social layer (votes, comments) lives in a database. Augmentation pipelines ingest other PDFs/docs and produce more YAML or annotation references.

The format is locked at v0.2. The schema is in `schema.json`. The seed domain is `domains/classification.yaml`. Don't change the YAML format unless you have a damn good reason and bump `format_version` accordingly.

## What's already done (don't redo)

- `clusters.yaml` — cluster registry, source of truth for visual grouping.
- `domains/classification.yaml` — fully populated seed domain (21 entities, polymorphic relationships, gotchas, working SQL).
- `schema.json` — JSON Schema, draft 2020-12.
- `FORMAT_SPEC.md` — conventions doc, locked.
- `generate_mermaid.py` — proof-of-concept generator (rebuild as a proper module).

## Tech stack (proposed — push back with reasons if you disagree)

| Concern             | Choice                          | Why                                                                  |
|---------------------|---------------------------------|----------------------------------------------------------------------|
| Frontend framework  | **Next.js 15 (App Router)**     | RSC for static YAML content, file-based routing maps to domain IDs   |
| ERD viewer          | **React Flow**                  | Interactive, supports grouping (subflows), drag-to-position          |
| Static ERD render   | **Mermaid CLI**                 | For markdown embeds, README, Confluence — same source YAML           |
| Backend             | **Next.js API routes**          | One process, no separate service                                     |
| DB (social layer)   | **SQLite via `better-sqlite3`** | Single file, easy backup, fine for read-heavy. Switch to Postgres only if scaling demands |
| ORM                 | **Drizzle**                     | Typed, lightweight, no runtime overhead                              |
| Search              | **MiniSearch (client-side)**    | YAML corpus is small (<1MB even at 20 domains). Index in-browser, instant fuzzy match. No server search needed. |
| YAML read (runtime) | **`js-yaml`**                   | Browser/Node, fast                                                   |
| YAML write (offline)| **`ruamel.yaml` (Python)**      | Round-trip safe with comments. App writes via subprocess or service. |
| Auth                | **NextAuth + email magic link** | Simple, no password hell. Swap for SSO later if Syniti requires.     |

If Pedro wants Vercel-deployed (he has Vercel MCP connected), this all works on Vercel except SQLite — swap to Vercel Postgres for that case. Code path stays identical via Drizzle.

## Phased build

### Phase 1 — Read-only browse (MVP, ship first)

**Goal:** consultants can land on the app, navigate to a domain, see the entity list, click an entity, see its relationships and SQL examples. No login. No edits.

Tickets:
1. Repo scaffold — Next.js + Drizzle + SQLite. Pre-commit yamllint + ajv validation.
2. YAML loader module (`lib/yaml.ts`) — reads all `domains/*.yaml`, validates against schema at boot, throws on invalid.
3. Domain index page — list all domains with entity counts.
4. Domain detail page — `/domains/[id]` — list of entities grouped by cluster (color-coded).
5. Entity detail page — `/domains/[id]/[tableId]` — fields, key fields, gotchas, s4_changes, notes, all relationships (incoming + outgoing) with SQL examples expandable.
6. Static Mermaid render per domain — `/domains/[id]/diagram` — pre-rendered SVG embedded.
7. Cluster reference validator — script that fails CI if any `cluster:` doesn't resolve to `clusters.yaml`.

**Acceptance criteria:**
- Browse classification.yaml end to end.
- Diagram renders the clustered flowchart from the proof of concept.
- All gotchas surface prominently (red border or icon).
- Polymorphic relationships render their resolution map in a table.

### Phase 2 — Search

8. MiniSearch index built at build time over: entity IDs, names, descriptions, field names, gotcha text, SQL examples.
9. Global search bar (cmd-K). Results show: domain → entity → matched field/gotcha snippet.
10. Per-domain search.

### Phase 3 — Interactive ERD

11. React Flow renderer for full domain ERD. Reads `cluster` for grouping (subflows), reads `layout` for node positions (fall back to dagre auto-layout if absent).
12. Drag-to-rearrange. Save positions back to YAML via API → server-side `ruamel.yaml` round-trip writer (preserves comments).
13. Click-through from node to entity detail page.
14. Filter chips: by cluster, by class type (for classification specifically), by "show only direct joins / show INOB resolution / show class hierarchy".

### Phase 4 — Social layer (votes + comments)

DB schema (Drizzle / SQLite):

```ts
users        (id, email, name, created_at)
votes        (id, user_id, target_type, target_id, value, created_at)  -- target: entity:KLAH or relationship:ksml_to_cabn or annotation:<uuid>
comments     (id, user_id, target_type, target_id, body_md, created_at, parent_id)
annotations  (id, user_id, target_type, target_id, kind, body_md, created_at, status)  -- kind: gotcha, sql_example, s4_change, note
```

Note `target_id` semantics — a stable string like `domain:classification/table:KSSK` or `domain:classification/relationship:ksml_to_cabn`. Generate from YAML, never store object references.

Tickets:
15. Auth (NextAuth, email magic link, Drizzle adapter).
16. Vote up/down on tables, relationships, gotchas, SQL examples.
17. Comment threads on the same. Markdown body. No nesting beyond one level.
18. User-submitted annotations (gotchas, alternate SQL, S/4 changes). Status: `proposed` / `accepted` / `rejected`. Accepted annotations get merged into the YAML by a maintainer via a "promote to YAML" action — generates a PR in git.
19. Activity feed per domain.

### Phase 5 — Augmentation pipeline

20. `/sources/` watch folder. New PDFs trigger an extraction pipeline.
21. Extraction script (Python, runs offline or via API): given a PDF, an LLM call extracts candidate annotations linked to known entity IDs. Output: a draft YAML patch + source registration.
22. Maintainer review UI — accept/reject extracted candidates, edit before commit.
23. Web URL ingestion — same flow, paste URL.

This phase can be deferred. Phase 1-3 + 4 are the actual product.

## Specific things you (Claude Code) need to know

### Polymorphic relationships are the trickiest part of the renderer

`kssk_objek_polymorphism` in classification.yaml has `type: polymorphic` and an `object_resolution[]` array. Render it as **N edges** (one per resolution entry), each labeled with the discriminator (`klart=022 (via INOB)`), each terminating at the resolution `target_table`. Mermaid generator already does this correctly — see `generate_mermaid.py`.

### Cluster colors come from `clusters.yaml`, not hard-coded

Don't repeat the color values in every renderer. Read `clusters.yaml` once, build a lookup, apply.

### Don't store user data in YAML files

Tempting shortcut, future pain. Votes, comments, user-submitted annotations all stay in the DB. The YAML files are the curated, audited, version-controlled source. Promotion from DB to YAML is a deliberate maintainer action.

### Watch out for round-trip safety

If users drag-rearrange a diagram and you save positions back to YAML by serializing the in-memory object with `js-yaml`, you'll **lose all comments**. Use a Python sidecar service with `ruamel.yaml` for writes, or use `yaml-ast-parser` if you want to stay in Node. Test round-trip preservation on day one — it's a category of bug that's painful to retrofit.

### CI must run

- `yamllint domains/*.yaml clusters.yaml`
- `ajv validate -s schema.json -d "domains/*.yaml"`
- Cluster reference checker (Python or Node, your call)
- Optionally: render every domain to Mermaid and fail if rendering errors

### What "good" looks like at end of Phase 1

A consultant lands on `/domains/classification`, sees a clean cluster-grouped index, clicks `KSSK`, sees:
- Description
- Fields (with key field marked)
- All 3 incoming + 3 outgoing relationships
- The polymorphic resolution table with klart codes and target tables
- 3 SQL examples, expandable
- The `*NP*` gotcha at the top in red

Total time to wire this up given the YAML already exists: half a day to a day. Don't overbuild Phase 1. Get it deployed, get Pedro's reaction, iterate.

## Open questions for Pedro (don't block on these — pick a default and note it)

- Auth provider — NextAuth email magic link OK, or does Syniti require SSO?
- Deployment target — Vercel? Internal Syniti? Both? Affects DB choice.
- Multi-tenancy — single instance for all of Syniti, or per-engagement instances? Affects DB schema (engagement_id everywhere) and `sources/` partitioning.
- Comment moderation — open posting, or require maintainer approval?

## Pedro context (what he cares about)

- **Direct, sardonic, technically precise.** No marketing language. No emoji unless he uses them first.
- **Pragmatic over flashy.** Working over polished. Anti-AI-hype. Build the unglamorous middle 80% well.
- **He's the user AND the maintainer.** He'll have opinions about everything. Welcome them.
- **Speed matters.** "I want this to get done quickly" was an early-prompt instruction. Phase 1 deployable ASAP > all phases planned perfectly.

Good luck. The schema is locked, the seed data is real, the polymorphism is documented. Go build.
