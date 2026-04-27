---
name: SAP ERWIN import
description: Use when converting SAP data models exported from ERwin Data Modeler (.erwin, .xml, .ddl, .csv exports) into the curated YAML format under /domains/. Triggers on requests like "import this ERWIN model", "convert this .erwin file to YAML", "parse this ERWIN export". Recommends the deterministic-first path so structure is preserved exactly without LLM-extraction risk.
---

# SAP ERWIN import

## When this skill applies

Use this skill when the source material is an ERWIN data model — either a native ERWIN file (`.erwin`, `.dm`, `.ddm`) or one of ERWIN's exports (XML, DDL, CSV, "Bridge" format).

ERWIN models contain **fully structured** data: tables, columns, primary keys, foreign keys, cardinality, and relationship lines are all explicit. This is fundamentally different from PDF extraction (where we infer structure from a visual diagram). When ERWIN is available, **use it instead of the PDF** — deterministic conversion preserves exact relationships, no LLM hallucination, no missed joins.

## ERWIN file formats — what to expect

ERWIN exposes several export formats. Listed in order of preference for our use case:

### 1. CSV exports (preferred)

ERWIN can export Tables, Columns, and Relationships as separate CSVs from Tools → Reports or via the Report Designer. Three files typically:

- `tables.csv` — `table_name`, `description`, optional logical name
- `columns.csv` — `table_name`, `column_name`, `data_type`, `is_key` (Y/N), `is_nullable`, `description`
- `relationships.csv` — `parent_table`, `parent_columns`, `child_table`, `child_columns`, `cardinality` (1:1, 1:M, M:N), `relationship_name`, `description`

This is the most reliable source. Conversion is essentially a CSV-to-YAML transform with no model interpretation. Map each row to the corresponding YAML field, infer cluster grouping from naming conventions (or ask the user), and write the domain file.

### 2. ERWIN XML export (`.xml`)

ERWIN's "XML Export" is proprietary but well-documented. Structure is roughly:

```
<Model>
  <Entities>
    <Entity Name="MAST">
      <Attributes>
        <Attribute Name="MATNR" KeyMember="true" />
        ...
      </Attributes>
    </Entity>
  </Entities>
  <Relationships>
    <Relationship ParentEntity="MAST" ChildEntity="STKO" Cardinality="OneToMany">
      <ParentKeyAttribute>STLNR</ParentKeyAttribute>
      <ChildKeyAttribute>STLNR</ChildKeyAttribute>
    </Relationship>
  </Relationships>
</Model>
```

Parse with `xml.etree.ElementTree`. Map entities → tables, attributes → fields, KeyMember → key_fields, relationships → relationships. Polymorphism is rarely modeled in ERWIN as polymorphism — it's usually represented as multiple separate FK relationships from a single table. Detect this pattern and collapse to `type: polymorphic` per the SAP ERD skill's polymorphism table.

### 3. DDL SQL export (`.sql`)

ERWIN can emit `CREATE TABLE` + `ALTER TABLE … ADD CONSTRAINT FOREIGN KEY` statements. Useful as a fallback if the user can't get CSV/XML out. Parse with a SQL parser (`sqlparse` for cheap-and-cheerful, or `sqlglot` if you need cross-dialect handling).

### 4. Native ERWIN files (`.erwin`, `.dm`, `.ddm`)

Binary formats, not portable. **Don't try to parse these directly.** Ask the user to export to CSV, XML, or DDL from ERWIN itself (File → Export). All ERWIN versions support at least DDL export.

### 5. ERWIN "Bridge" / "M-Files"

XMI-style XML. Rare in SAP-shop usage; if encountered, treat like format #2.

## Recommended path

When the user mentions an ERWIN file:

1. **Ask which format they have.** If native (.erwin/.dm/.ddm), ask them to export from ERWIN to CSV (best) or XML.
2. **Once you have a structured export**, write a deterministic Python parser. **Do not** route ERWIN data through `propose_domain.py`'s LLM pipeline — that's for unstructured sources only. ERWIN is structured; an LLM would only add risk.
3. **Use an LLM only for descriptions.** ERWIN's `description` fields are often empty or terse SAP transaction codes. Optionally use a single LLM call to enrich `description:` text on tables and relationships, with the structured data as the source of truth — but never let the LLM change ids, keys, or relationship topology.

## Suggested implementation: `scripts/import_erwin.py`

When the user is ready to wire this in, create `scripts/import_erwin.py` with this rough shape:

```python
#!/usr/bin/env python3
"""Import an ERWIN export into a /domains/<id>.yaml draft."""

def import_csv(tables_csv, columns_csv, relationships_csv,
               domain_id, domain_name, sap_module) -> dict:
    """Pure-Python CSV → domain dict. No LLM."""
    ...

def import_xml(xml_path, ...) -> dict:
    """ERWIN XML → domain dict. Uses xml.etree.ElementTree."""
    ...

def import_ddl(sql_path, ...) -> dict:
    """DDL CREATE/ALTER → domain dict. Uses sqlparse."""
    ...

def main():
    # arg dispatch on file extension
    ...
```

Output the same YAML shape as `propose_domain.py` so the same review/apply pipeline handles ERWIN-imported drafts (validation, cluster registration, the inline editor in DraftViewer, etc.).

## Polymorphism in ERWIN sources

ERWIN typically models SAP polymorphism as **N separate FK relationships** from `KSSK` to each classifiable target. The importer should detect this:

1. Group all FK relationships by source table.
2. If one source table has FKs to many target tables, all using the same join column (`KSSK.OBJEK`), it's a polymorphic pattern.
3. Convert to `type: polymorphic` with one `object_resolution` entry per detected target.

The discriminator column (`KLART` for KSSK, `OBJECTCLAS` for CDPOS) is typically *not* in the FK definition — it's a sibling column. Detect by checking the source SAP ERD skill's polymorphism table for the table's known discriminator.

## What this skill does NOT do

- **Re-engineer ERWIN from scratch.** If the user has only the proprietary native file, ask them to export. Don't write a `.erwin` parser.
- **LLM-extract from an ERWIN PDF render.** If the user has a printed-from-ERWIN PDF, route to `sap-erd-extraction` instead — the structure is gone once it's a PDF.
- **Mix ERWIN and PDF sources in one extraction pass.** Pick one source of truth. ERWIN + LLM-prose-enrichment is fine; ERWIN + PDF-extracted-overlay is asking for inconsistency.

## Open questions for the user

If the user mentions ERWIN, useful clarifying questions:

1. What format do you have available? (CSV / XML / DDL / native)
2. Is the model curated against current SAP versions, or vintage? (S/4HANA vs ECC matters for some tables)
3. Are the description fields populated, or do they need LLM enrichment?
4. Does the model include cluster / subject area groupings? (ERWIN has "Subject Areas" — they map directly to our `cluster:` field.)
