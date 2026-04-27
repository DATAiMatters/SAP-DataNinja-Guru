---
name: SAP ERD extraction
description: Use when extracting SAP table relationship models from PDFs, screenshots, or web pages into the curated YAML format under /domains/. Triggers on requests like "propose a domain from this PDF", "extract the BOM tables", "build a YAML for this SAP module". Encodes SAP ERD reading conventions (KSSK/INOB polymorphism, T-suffix text tables, classification patterns) so the extraction is faithful and complete on the first pass.
---

# SAP ERD extraction

## When this skill applies

Use this skill whenever you're converting SAP documentation (PDF, web docs, screenshots, hand-written notes) into a `/domains/<id>.yaml` file. It's the reference for what to look for, what to ignore, and which patterns to recognize.

The Python pipeline at `scripts/propose_domain.py` embeds a condensed version of this in its system prompt. Keep this doc and that prompt in sync — when something here changes, the script's prompt needs to follow.

## What "an SAP ERD" actually is

SAP ERDs come in three visual flavors. All three express the same underlying structure but the cues differ:

1. **Boxes-and-lines diagrams** (most PDFs from SAP Press, blogs, internal docs). Tables are rectangles, lines are foreign-key relationships, key fields are typically bolded or marked with a key icon.
2. **Crow's foot ERWIN/UML diagrams** (engineering-grade documentation, ERWIN exports printed as PDF). Cardinality is shown by the line decoration: `1`, `*`, `0..1`, the crow's foot.
3. **Text-only table catalogs** (transaction `SE11`, blog posts that just describe tables in prose). No diagram — relationships are described in sentences like "MAST is the BOM header pointing to STKO via STLNR."

All three should produce the same YAML.

## The extraction algorithm

Work in this order. Don't shortcut — each pass catches things the previous one missed.

### Pass 1: Inventory tables

Walk the source and list every SAP table id you see. SAP table ids are 4–8 uppercase letters/digits (`MARA`, `EKKO`, `KSSK`, `T001W`). Don't extract table names like "Material Master" — those are the *human name*; the *id* is `MARA`.

For each table capture:
- **id** — the technical name in CAPS.
- **name** — human description (one short phrase).
- **key_fields** — the SAP primary key. SAP keys are *composite* far more often than single-column. Document tables (`MAKT`, `EINA`) often need a language key (`SPRAS`).
- **fields** — every column the source mentions. Field names in CAPS. Don't fabricate fields the source doesn't show.

### Pass 2: Cluster the tables

Group related tables visually. Pick **3–5 short cluster ids** per domain. Use existing cluster ids from `clusters.yaml` when they fit (`dictionary`, `text_tables`, `master_data_object`, `customizing`). Invent new ones with a SHORT prefix — the SAP module code, a 2-word abbreviation, NOT the full domain id.

Good: `pp_bom`, `pp_routing`, `bom_recipes_resources`, `pricing_conditions`
Bad: `sap_bom_recipes_routing_engineering_bom` (the long-domain-id antipattern)

### Pass 3: Identify relationships

This is the pass extractors most often skip — and the one that matters most. Schema marks `relationships:` as required, and a multi-table SAP domain almost always has N-1 or more.

For every relationship:
- **id** — short snake_case (`mast_to_stko`, `kssk_to_class`).
- **from / to** — `{table: <ID>, fields: [<FIELD>, ...]}`. Composite-key joins use multiple fields.
- **cardinality** — `many_to_one`, `one_to_many`, `one_to_one`, `many_to_many`. **Required.** Reading hint:
  - Header → item is always `one_to_many` (one MAST has many STPO).
  - Item → header is `many_to_one`.
  - Master → text is `one_to_many` (one MARA has rows in MAKT, one per language).
- **description** — what the join is operationally. "BOM header to BOM items via STLNR (the BOM technical number)."
- **sql_example** — concrete `SELECT … JOIN …` so a consultant can copy-paste.

### Pass 4: Spot polymorphism

This is where naive extractors fail. SAP has several tables where one column resolves to *different target tables* based on a discriminator. These MUST be modeled as `type: polymorphic` with `object_resolution`, not as a single relationship.

The patterns to recognize:

| Table | Discriminator | Target | Notes |
|-------|--------------|--------|-------|
| `KSSK` | `KLART` (class type) | classifiable object (`MARA`, `LFA1`, `EQUI`, `IFLOT`, ...) | `OBJEK` is the object key; format depends on KLART |
| `INOB` | `OBTAB` | compound-key target (`MCH1`, `CRHD`, `AUFK`) | INOB resolution is needed when the target has multi-field keys; INOB.CUOBJ is the synthetic single-field key |
| `AUSP` | `KLART` + `OBJEK` | same as KSSK | Stores the actual characteristic *values*; KSSK is just the class assignment |
| `CDPOS` | `OBJECTCLAS` | any change-tracked table | `TABKEY` is the concatenated row key in the target table |
| `JCDS` | `OBJNR` prefix (2 chars) | any object-status-tracked table (`AUFK`, `VBAK`, `EQUI`, ...) | OBJNR encoding: 2-char prefix + technical id of target |
| `STAS` | `STLTY` (BOM category) | `MAST`, `KDST`, `STKO`, ... | BOM alternatives across BOM types |

For polymorphism, render as N edges (one per resolution target) with discriminator labels. CLAUDE.md locks this rule.

### Pass 5: Self-check before stopping

Before declaring the extraction done, ask yourself:

1. **Does every table appear in at least one relationship?** If not, you missed a join.
2. **Are header/item pairs explicit?** SAP loves header/item: VBAK/VBAP, EKKO/EKPO, MAST/STPO, AUFK/AFPO.
3. **Did you check for text tables?** Tables suffixed with `T` (or sometimes `TT`) are text tables, keyed by `SPRAS`. Always model as `one_to_many` from the parent.
4. **Did you check for change docs?** If the domain has any changeable master data, the source usually mentions CDHDR/CDPOS — model the polymorphism.
5. **Does cardinality make business sense?** A pricing condition record can have many rates over time → `one_to_many` from KONH to KONP.

## Token budget warning

Big domains (BOM/Routing has 21+ tables) easily exceed 8K output tokens if you over-elaborate the table descriptions. Budget rule: **table descriptions are a means; relationships are the point**. A short table description and a thorough relationships section is far more useful than long table prose with no joins.

If you're approaching the token limit, trim table `description` and `notes` first. Never trim relationships.

## Common antipatterns

- **Inventing field names.** If the source shows `MATNR`, write `MATNR`. Don't paraphrase to `material_number`.
- **Skipping cardinality.** Required by schema; the validator will reject the draft.
- **Modeling polymorphism as a single edge.** `KSSK.OBJEK → various` is N edges, one per KLART. Locked rule from CLAUDE.md.
- **Long cluster prefixes.** Use `pp_*` not `sap_bom_recipes_routing_engineering_*`.
- **Stripping `relationships:` to fit token budget.** Don't. Trim descriptions instead.
- **Paraphrased domain ids.** `domain.id` MUST exactly match what the user requested (snake vs kebab matters; the script enforces this with a "stamp" pass).

## Inputs other than PDFs

- **ERWIN exports** — see the sibling `sap-erwin-import` skill. ERWIN is fully structured; deterministic conversion preserves exact relationships without LLM-extraction risk.
- **HTML / web docs** — same algorithm; the source is text rather than image-based.
- **Screenshots** — read the boxes carefully; do an explicit text-extraction pass before reasoning about structure.

## Reviewer pass

After extraction, a separate reviewer LLM pass (`call_llm_review` in `scripts/propose_domain.py`) audits the output against the source for completeness. The reviewer's checklist mirrors Pass 5 above — completeness, relationships, polymorphism, key fields, field names. Treat the reviewer's gap list as authoritative and fix the issues; don't argue with it.
