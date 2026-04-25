# SAP Knowledge Base — Format Specification v0.2

## What this is

A YAML-based knowledge format for SAP table relationships, joins, and the operational details consultants actually need (gotchas, S/4 migration changes, working SQL). Designed to be:

- **Human-readable and human-editable** — markdown-ish prose, comments survive round-trips.
- **App-readable and app-writable** — round-trip preserved with `ruamel.yaml` (Python) or `js-yaml` with comment preservation.
- **Git-friendly** — small textual diffs, mergeable.
- **Toolable** — JSON Schema validation in CI, deterministic Mermaid generation, search indexing.

The social layer (votes, comments, user attribution, edit history) lives in the app database and **never** touches these files.

## Repository layout

```
/
├── clusters.yaml            # Cross-domain cluster registry
├── schema.json              # JSON Schema for domain YAML
├── FORMAT_SPEC.md           # This document
├── /domains/
│   ├── classification.yaml
│   ├── material-master.yaml
│   ├── fi-co.yaml
│   └── ...
├── /sources/                # Backing PDFs, screenshots, etc.
│   └── *.pdf
└── /generated/              # Build artifacts (don't edit)
    ├── *.mmd
    └── *.svg
```

## Top-level structure

Every domain YAML has these top-level keys:

| Key                  | Required | Purpose                                          |
|----------------------|----------|--------------------------------------------------|
| `domain`             | yes      | Domain metadata (id, name, module, description)  |
| `sources`            | no       | Backing documents that annotations cite          |
| `tables`             | yes      | Entities                                         |
| `relationships`      | yes      | Joins                                            |
| `extraction_queries` | no       | Bread-and-butter SQL for ECC → staging           |
| `cross_references`   | no       | Pointers to other domains via shared tables      |

## Conventions

### IDs

- **Table IDs**: SAP technical name in caps (`KLAH`, `MARA`, `KSSK`). Consultants think in SAP names. Logical names go in the `name` field.
- **Relationship IDs**: snake_case, descriptive (`ksml_to_cabn`, `kssk_objek_polymorphism`).
- **Source IDs**: prefixed `src_` (`src_classification_v1b_2014`). Stable; never re-used.
- **Cluster IDs**: snake_case. Domain-specific clusters prefixed with domain ID.

### Cluster requirement

Every table has a `cluster:` field. Renderers use it for visual grouping. The value must resolve to an id in `/clusters.yaml`. CI validation will fail on dangling references.

### Layout (optional)

```yaml
layout:
  x: 850
  y: 400
  width: 200
  height: 100
```

Sparse by design. Populated by the app when users drag-arrange. Mermaid renderer ignores it; React Flow renderer respects it (and falls back to dagre auto-layout when absent).

### Annotations

Three structured annotation arrays at the table level (any may be omitted):

```yaml
gotchas:
  - text: "OBJEK has *NP* prefix for AUFK — extract scripts often strip it."
    severity: high
    source: src_classification_v1b_2014

s4_changes:
  - text: "Vendor classification migrates to Business Partner in S/4HANA."
    severity: high
```

`notes:` (free-form prose, multi-line) is for general context that doesn't fit the structured forms.

### Relationships — simple

```yaml
- id: ksml_to_klah
  description: ...
  from: {table: KSML, fields: [CLINT]}
  to:   {table: KLAH, fields: [CLINT]}
  cardinality: many_to_one    # one_to_one, one_to_many, many_to_one, many_to_many
  optional: false             # default false
  sql_example: |
    SELECT ...
```

Cardinalities map to Mermaid crows-foot symbols. `optional: true` flips the "one" side from `||` to `|o`.

### Relationships — polymorphic

The classification ERD has the canonical case: `KSSK.OBJEK` means different things depending on `KLART`. Encode it explicitly:

```yaml
- id: kssk_objek_polymorphism
  type: polymorphic
  from: {table: KSSK, fields: [OBJEK, KLART, MAFID]}
  object_resolution:
    - {klart: '001', target_table: MARA, objek_format: "MATNR",          via_inob: false}
    - {klart: '022', target_table: MCH1, objek_format: "MATNR || CHARG", via_inob: true}
    ...
  sql_examples:
    - title: ...
      body:  |
        SELECT ...
```

Renderers expand polymorphic relationships into one edge per resolution target, labeled with the discriminator (`klart=022 (via INOB)`).

### Conditional relationships

For relationships that only apply when a discriminator field has a specific value (e.g., KSSK→KLAH for class hierarchies, MAFID='K'):

```yaml
- id: kssk_class_hierarchy
  from: {table: KSSK, fields: [OBJEK]}
  to:   {table: KLAH, fields: [CLINT]}
  cardinality: many_to_one
  conditions: {field: MAFID, equals: 'K'}
```

## Editing rules

1. **Use `ruamel.yaml`** (Python) or `js-yaml` with comment preservation for programmatic edits. Round-trip stability matters; comments must survive.
2. **Preserve indent style** (2 spaces). Lint with `yamllint`.
3. **Run schema validation in CI** before merge.
4. **Don't write the social layer here.** Votes, comments, user IDs, edit timestamps live in the app DB. These files are the curated single source of truth.
5. **Sources are append-only.** Never re-use a source ID after deletion; treat them like immutable references.

## Validation

```bash
# Validate one domain
ajv validate -s schema.json -d domains/classification.yaml

# Validate all domains
for f in domains/*.yaml; do
  ajv validate -s schema.json -d "$f" || exit 1
done

# Cluster reference check (ensure no dangling clusters)
python scripts/check_cluster_refs.py
```

## Versioning

- `format_version` is implicit in this spec. Bump on breaking changes.
- v0.1 → v0.2: added `cluster` (required), `layout` (optional), structured `gotchas`/`s4_changes`, `sources` block, source references on annotations.
