# CLAUDE.md — Project Guidance

This repo holds the SAP Knowledge Base: a curated YAML knowledge format
plus a Next.js viewer (under `/web/`).

## Read first
- `FORMAT_SPEC.md` — YAML format conventions (locked at v0.2)
- `HANDOFF.md` — Roadmap, tech stack, phased build plan
- `schema.json` — JSON Schema for domain YAML (draft 2020-12)

## Layout
```
/                           Curated content (audited, version-controlled)
├── clusters.yaml           Cross-domain cluster registry
├── schema.json             JSON Schema for domains
├── /domains/*.yaml         Per-domain knowledge
├── /sources/               Backing PDFs (Phase 5 input)
└── /scripts/               Validators, generators
/web/                       Next.js 15 App Router viewer
├── /app/                   Routes
├── /lib/                   YAML loader, content API, types
└── /components/            UI building blocks
```

## Commands
```bash
# Validate domain YAML against schema (run from repo root)
./scripts/validate.sh

# Web app (run from /web/)
npm install
npm run dev          # http://localhost:3000
npm run build
npm run typecheck
npm run gen:types    # regen lib/types.ts from ../schema.json
```

## Locked rules
1. **Don't change the YAML format without bumping `format_version`.** The
   schema is locked at v0.2.
2. **Don't store user data in YAML.** Votes, comments, edit history live
   in the app DB (Phase 4+). YAML is the curated source of truth.
3. **Cluster references must resolve.** Every `cluster:` value in a
   domain YAML must exist in `clusters.yaml`. CI enforces this.
4. **Polymorphic relationships are special.** `KSSK.OBJEK` resolves
   differently per `KLART`. Render as N edges (one per resolution
   target) with discriminator labels — not as a single edge.
5. **Round-trip safety matters.** When writing YAML programmatically,
   preserve comments. Test before shipping a writer path.
