# SAP Knowledge Base

> Curated, machine-validated, human-readable knowledge about SAP table relationships — backed by a Next.js viewer and a multi-agent extraction pipeline that turns SAP documentation into structured YAML.

## What this is

SAP consultants spend their lives joining tables. The actual joins — `KSSK` to its classifiable target via `KLART`, `MAST` to `STKO` via `STLNR`, the `*NP*` gotcha when classifying compound-key objects — are scattered across PDFs, blogs, internal wikis, and people's heads. Every engagement re-discovers the same things.

This repo collects that knowledge in a format that:

1. **A human can read and edit** (YAML, locked schema, conventional layout).
2. **A machine can validate and render** (JSON Schema, CI checks, Next.js viewer).
3. **An LLM can extend** (multi-agent pipeline that ingests SAP source material — PDFs, ERWIN models, web docs — and proposes new domains for human review).

The combination is the point. YAML alone is just notes. A viewer alone is just a UI. The pipeline alone is just LLM exhaust. Together they're a knowledge base that compounds.

## Status

Active. Phase 1–3 (read-only browse, search, interactive ERD) shipped. Phase 4 (annotation inbox + admin editing + propose-domain pipeline) in progress. Phase 5 (broader source ingestion: DOCX, Confluence, OCR) is the next-phase roadmap — see [`docs/SKILLS.md`](docs/SKILLS.md).

## Repo layout

```
/                           Curated content (audited, version-controlled)
├── clusters.yaml           Cross-domain cluster registry
├── schema.json             JSON Schema for domains (draft 2020-12)
├── /domains/*.yaml         Per-domain knowledge
├── /sources/               Backing PDFs (curated)
└── /scripts/               Validators, extractors, renderers (Python)
/web/                       Next.js 15 App Router viewer + admin
/.claude/                   Claude Code skills + project config
/docs/                      Architecture, agents, decisions, skills roadmap
/generated/                 Build artifacts: drafts, job logs (gitignored)
```

## Quick start

```bash
# Validate the curated content against the schema
./scripts/validate.sh

# Run the viewer
cd web/
npm install
npm run dev          # http://localhost:3000

# Propose a new domain from a PDF (requires ANTHROPIC_API_KEY)
pip install -r scripts/requirements.txt
python scripts/propose_domain.py path/to/source.pdf \
  --domain-id pricing --domain-name "Pricing"
```

The proposed YAML is written to `generated/drafts/` and validated against the schema. Review it in the viewer at `http://localhost:3000/ingest/<job-id>`, edit inline if needed, then click **Apply** to promote it to `domains/`.

## Architecture at a glance

Three layers, three concerns:

```
┌─────────────────────────────────────────────────────────────┐
│  Curated YAML (source of truth — version-controlled)         │
│  /domains/*.yaml + clusters.yaml + schema.json               │
└─────────────────────────────────────────────────────────────┘
                          ▲                    │
                          │ apply              │ read
                          │                    ▼
┌──────────────────────┐  │  ┌──────────────────────────────┐
│  Multi-agent         │  │  │  Next.js viewer (web/)       │
│  extraction pipeline │──┘  │  ┌──────────────────────┐    │
│  (Python, scripts/)  │     │  │ Browse / search /    │    │
│  ┌────────────────┐  │     │  │ ERD / annotations /  │    │
│  │ Extractor LLM  │  │     │  │ admin inline edits   │    │
│  └────────────────┘  │     │  └──────────────────────┘    │
│  ┌────────────────┐  │     │  ┌──────────────────────┐    │
│  │ Cluster        │  │     │  │ Propose pipeline UI: │    │
│  │ registrar      │  │     │  │ upload → review →    │    │
│  └────────────────┘  │     │  │ edit → apply         │    │
│  ┌────────────────┐  │     │  └──────────────────────┘    │
│  │ Reviewer LLM   │  │     │                              │
│  └────────────────┘  │     │  Social layer (Phase 4):     │
│  ┌────────────────┐  │     │  votes, comments, annotations│
│  │ Repair LLM     │  │     │  in SQLite, separate from    │
│  └────────────────┘  │     │  the curated YAML.           │
└──────────────────────┘     └──────────────────────────────┘
```

Deeper docs:

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — layers, data flow, tech stack.
- [`docs/AGENTS.md`](docs/AGENTS.md) — how the extract → cluster → review → repair loop works, why two LLMs beat one.
- [`docs/SKILLS.md`](docs/SKILLS.md) — current skills under `.claude/skills/` and the next-phase roadmap.
- [`docs/DECISIONS.md`](docs/DECISIONS.md) — locked design rules and the rationale behind each.
- [`docs/EVALS.md`](docs/EVALS.md) — how `scripts/eval_extraction.py` scores candidate YAMLs against ground truth.

## Why YAML, not a database

The curated knowledge is the asset. It needs to be:

- **Diffable** — a pull request shows exactly what changed.
- **Reviewable** — code-review tooling already understands YAML.
- **Portable** — no migration, no proprietary export. Clone the repo, you have it all.
- **Human-editable** — a consultant can fix a typo without writing a query.
- **CI-validated** — the schema and the cluster reference checker run in pre-commit and CI.

User-generated data (votes, comments, edit history) does live in SQLite. That's the social layer — it changes by the second and doesn't belong in version control. The split is deliberate: see [`docs/DECISIONS.md`](docs/DECISIONS.md).

## Locked rules

The full list lives in [`docs/DECISIONS.md`](docs/DECISIONS.md), but the headline items:

1. **Don't change the YAML format without bumping `format_version`.** Schema is locked at v0.2.
2. **Don't store user data in YAML.** Curated knowledge vs. social layer is a hard line.
3. **Cluster references must resolve.** Every `cluster:` value in a domain YAML must exist in `clusters.yaml`. CI enforces this; the propose pipeline auto-registers new clusters before validation.
4. **Polymorphic relationships render as N edges.** `KSSK.OBJEK` resolves differently per `KLART` — render one edge per resolution target with the discriminator label, never collapse to a single edge.
5. **Round-trip safety matters.** When writing YAML programmatically, preserve comments. The propose pipeline uses append-only writes for `clusters.yaml` for exactly this reason.

## Contributing

This started as one consultant's knowledge dump. It scales when more consultants share theirs.

- **Found a wrong join or stale field name?** PR a one-line YAML fix.
- **Have a domain that's not here?** Either drop a PDF in `/sources/` and run `propose_domain.py`, or write the YAML by hand against `schema.json`.
- **Have an ERWIN export?** See [`.claude/skills/sap-erwin-import/SKILL.md`](.claude/skills/sap-erwin-import/SKILL.md). Deterministic conversion preserves exact relationships — preferred over PDF when available.
- **Spotted an annotation that should be promoted?** Use the annotation inbox at `/curate/inbox` (admin auth required).

The repo is meant to be forkable and extensible. The skills are reusable conventions; the pipeline is one Python script and one Next.js app; the schema is one JSON file. Take it apart and adapt it.

## License

Internal. See `LICENSE` (TBD).
