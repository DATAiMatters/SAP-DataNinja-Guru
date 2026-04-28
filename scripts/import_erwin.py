#!/usr/bin/env python3
"""ERWIN binary (.erwin) → domain YAML draft (PROOF OF CONCEPT).

The native ERWIN format is a proprietary binary ("GDM" — Generic Data
Model). This script does NOT fully reverse-engineer the record layout.
What it does:

  1. Extracts ASCII strings from the binary (analogous to `strings(1)`).
  2. Pattern-matches the recoverable structure:
       - Entities:       "Logical Name (PHYS / PHYS_TEXT)"      (no trailing dot)
       - FK references:  "Logical Name (PHYS / PHYS_TEXT)."     (trailing dot)
       - Attribute logical names + datatypes (CHAR(N), INTEGER, DATE...)
       - UUIDs as record boundaries
  3. Groups attributes by adjacency between entity boundaries.
  4. Emits a draft YAML close to the curated /domains/*.yaml shape.

What it does NOT do (and probably can't, from raw strings alone):

  - Resolve physical column names to attribute records reliably
    (the physical names live in a separate block keyed by UUID).
  - Compute relationship cardinality (1:M vs M:N) — that's encoded
    in the binary record graph, not the strings.
  - Identify primary-key columns.
  - Detect subject-area / cluster groupings.

For a production-grade ERWIN→YAML pipeline, the right move is to ask
the user to export from ERWIN to CSV (Tables / Columns / Relationships)
or XML — both are structured and deterministic to parse. This POC is
the proof that even the binary yields useful signal as a fallback.

Usage:
    python3 scripts/import_erwin.py path/to/model.erwin \\
        --domain-id <id> --domain-name "<name>" [--sap-module <code>]

Output:
    Prints YAML to stdout. Pipe to a file or to `propose_domain.py`'s
    apply pipeline manually.
"""
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path
from typing import Iterator


# Strings shorter than this are mostly binary noise / pointer values.
MIN_STRING_LEN = 4

# An entity name in ERWIN's logical model: "Class (KLAH / SWOR)" or
# "Functional Location (IFLOT)". We capture the leading logical name +
# the physical name list inside the parentheses.
ENTITY_RE = re.compile(
    r"^([A-Z][A-Za-z0-9 _\-/]+?)\s*\(([A-Z0-9_/ ]+)\)\s*$"
)

# FK reference text — same shape but ends with a literal period.
# ERWIN appends the period when the same string is used as a
# "<this attribute is a foreign key to...>" annotation.
FK_REF_RE = re.compile(
    r"^([A-Z][A-Za-z0-9 _\-/]+?)\s*\(([A-Z0-9_/ ]+)\)\s*\.\s*$"
)

# Domain reference: "Logical (Domain: NAME)." or similar. ERWIN models
# value-list domains (like SAP's ATFOR data-type lookup) differently
# from full entities, so they show up with this distinct shape and
# don't appear in our entity list. Track separately so the YAML can
# at least mention them as candidate tables for the curator to model
# explicitly.
DOMAIN_REF_RE = re.compile(
    r"^([A-Z][A-Za-z0-9 _\-/]+?)\s*\(Domain:\s*([A-Z0-9_]+)\)\s*\.?\s*$"
)

# Datatype declarations.
DATATYPE_RE = re.compile(
    r"^(?:CHAR|VARCHAR|VARCHAR2|NUMBER|INTEGER|INT|FLOAT|DATE|DATETIME|TIMESTAMP|BLOB|TEXT)"
    r"(?:\(\s*\d+(?:\s*,\s*\d+)?\s*\))?$",
    re.IGNORECASE,
)

# UUID record boundary: {HEX-HEX-HEX-HEX-HEX}
UUID_RE = re.compile(
    r"^\{[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}\}$"
)

# Timestamps from ERWIN: 2014-03-06 15:37:35
TIMESTAMP_RE = re.compile(r"^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$")

# Well-known SAP table primary keys. When the parser detects an FK from
# CHILD to PARENT, it uses this lookup to determine the FK column name on
# CHILD (which by convention matches PARENT's PK name). This is SAP-specific
# but the convention is rock-solid — SAP uses the same column name across
# tables when one references another's PK. Edit this table if a domain
# pulls in tables not listed here.
SAP_KNOWN_PKS: dict[str, list[str]] = {
    "DD02L": ["TABNAME"],
    "DD03L": ["TABNAME", "FIELDNAME"],
    "TCLA":  ["KLART"],
    "TCLG":  ["KLAGR"],
    "TCMG":  ["ATKLA"],
    "KLAH":  ["CLINT"],
    "CABN":  ["ATINN"],
    "MARA":  ["MATNR"],
    "MCH1":  ["MATNR", "CHARG"],
    "LFA1":  ["LIFNR"],
    "IFLOT": ["TPLNR"],
    "EQUI":  ["EQUNR"],
    "T001W": ["WERKS"],
    "AUFK":  ["AUFNR"],
    "CRHD":  ["OBJID"],
    "INOB":  ["CUOBJ"],
    "KSSK":  ["OBJEK", "MAFID", "KLART", "CLINT"],
    "AUSP":  ["OBJEK", "MAFID", "KLART", "ATINN", "ATZHL"],
}

# Lines that are clearly metadata / GUI noise — exclude from parsing.
NOISE_PREFIXES = (
    "Build ",
    "Application ",
    "Schema ",
    "Default ",
    "Logical",
    "%",
    "ANSI ",
    "Western",
    "Classic ",
    "ERwin",
    "Migrated foreign key",
)


def extract_strings(data: bytes, min_len: int = MIN_STRING_LEN) -> Iterator[str]:
    """Reimplementation of `strings(1)`: yield runs of printable ASCII
    of length >= min_len. We avoid a subprocess call so this is portable
    to any platform with Python.
    """
    current: list[int] = []
    for b in data:
        if 0x20 <= b < 0x7F:
            current.append(b)
            continue
        if len(current) >= min_len:
            yield bytes(current).decode("ascii", errors="replace")
        current = []
    if len(current) >= min_len:
        yield bytes(current).decode("ascii", errors="replace")


def is_noise(s: str) -> bool:
    if any(s.startswith(p) for p in NOISE_PREFIXES):
        return True
    # ERWIN uses lots of these tag-pointer strings like ",' @" — short
    # punctuation-heavy runs that aren't real content.
    if len(s) <= 5 and not s.isalnum():
        return True
    if TIMESTAMP_RE.match(s):
        return True
    if UUID_RE.match(s):
        return True
    return False


def physical_names(parens: str) -> list[str]:
    """Split the inside of '(KLAH / SWOR)' into ['KLAH', 'SWOR']."""
    return [p.strip() for p in parens.split("/") if p.strip()]


def parse_erwin(path: Path) -> dict:
    """Walk the strings dump and build a model description.

    The walker is a small state machine: it tracks the "current entity"
    (the most recent entity-name string) and accumulates attributes
    seen since then.
    """
    data = path.read_bytes()
    raw_strings = list(extract_strings(data))

    entities: dict[str, dict] = {}  # primary_phys_name -> entity dict
    fk_targets: list[dict] = []  # {from_entity, target_logical, target_phys}
    domain_refs: dict[str, str] = {}  # domain_id -> logical name (e.g. ATFOR -> "Characteristic Data Type")

    current_entity: str | None = None
    pending_attr_name: str | None = None

    for s in raw_strings:
        if is_noise(s):
            continue

        # CRITICAL ORDER NOTE: check datatype before entity/FK regexes.
        # `CHAR(10)` matches ENTITY_RE ("Logical (PHYS)") because the
        # regex is permissive about what's inside the parens. Without
        # this guard, every datatype gets stolen by the entity branch
        # and 0 attributes ever attach to their entities.
        if DATATYPE_RE.match(s) and current_entity and pending_attr_name:
            ent = entities[current_entity]
            ent["fields"].append({
                "logical_name": pending_attr_name,
                "datatype": s,
            })
            ent["_attr_logical_seen"].append(pending_attr_name)
            pending_attr_name = None
            continue

        # Domain reference — different shape, doesn't get FK-attributed.
        # Captures things like "Characteristic Data Type (Domain: ATFOR)."
        # which would otherwise be mis-read as an FK to a table named ATFOR.
        m = DOMAIN_REF_RE.match(s)
        if m:
            domain_refs[m.group(2).strip()] = m.group(1).strip()
            continue

        # FK reference (trailing period). Belongs to the previous attr
        # we saw, but in raw strings we don't always know which — record
        # against the current entity for now and reconcile later.
        m = FK_REF_RE.match(s)
        if m and current_entity:
            fk_targets.append({
                "from_entity": current_entity,
                "target_logical": m.group(1).strip(),
                "target_phys": physical_names(m.group(2)),
                "near_attr": pending_attr_name,
            })
            continue

        # Entity definition (no trailing period).
        m = ENTITY_RE.match(s)
        if m:
            logical = m.group(1).strip()
            phys = physical_names(m.group(2))
            primary = phys[0]
            # Reject numeric physical names — these are CHAR(30)-style
            # datatype references that slipped past DATATYPE_RE because
            # they happened to be preceded by a logical-name-shaped
            # word. Real SAP entity ids are alphabetic.
            if primary.isdigit() or not primary[0].isalpha():
                continue
            entities.setdefault(primary, {
                "id": primary,
                "name": logical,
                "text_table": phys[1] if len(phys) > 1 else None,
                "fields": [],
                "_attr_logical_seen": [],
            })
            current_entity = primary
            pending_attr_name = None
            continue

        # (Datatype handling moved above ENTITY_RE — see comment there.)

        # Otherwise: candidate attribute logical name. Heuristic — must
        # start with a letter, contain at least one space or be > 6
        # chars (filters short physical column names like KLART that
        # appear standalone in the binary too).
        if current_entity and s and s[0].isalpha():
            if " " in s or len(s) > 8:
                # Track the most recent name as a candidate.
                pending_attr_name = s

    # Cleanup: remove the bookkeeping field
    for ent in entities.values():
        ent.pop("_attr_logical_seen", None)

    # ---- Post-process: dedupe FKs + filter likely misattributions -----
    # Adjacency-based FK attribution is approximate; the binary doesn't
    # always present FK refs immediately after their source attribute.
    # Heuristic: if a "source" entity has < 2 confirmed attributes AND
    # accumulated > 1 FK ref, the later refs are probably misattributions
    # — flag them as low-confidence rather than dropping outright (the
    # curator may want to review).
    seen: set[tuple[str, str]] = set()
    fks_clean: list[dict] = []
    fk_count_per_source: dict[str, int] = {}
    for fk in fk_targets:
        target = fk["target_phys"][0] if fk["target_phys"] else None
        if not target:
            continue
        key = (fk["from_entity"], target)
        if key in seen:
            continue
        seen.add(key)
        src = fk["from_entity"]
        attr_count = len(entities.get(src, {}).get("fields", []))
        fk_count_per_source[src] = fk_count_per_source.get(src, 0) + 1
        # Flag low-confidence: source has very few attributes but is
        # accumulating many FKs (TCMG-style misattribution).
        fk["confidence"] = (
            "low"
            if attr_count <= 1 and fk_count_per_source[src] > 1
            else "high"
        )
        fks_clean.append(fk)

    # ---- FK column derivation (SAP convention) -----------------------
    # When CHILD has FK to PARENT, by SAP convention CHILD has a column
    # whose name matches PARENT's PK column(s). Add these as inferred
    # fields if not already present from the datatype-based extraction.
    for fk in fks_clean:
        if fk["confidence"] == "low":
            continue
        src = fk["from_entity"]
        target = fk["target_phys"][0] if fk["target_phys"] else None
        if not target or src not in entities:
            continue
        target_pks = SAP_KNOWN_PKS.get(target, [])
        if not target_pks:
            continue
        existing_field_names = {
            f.get("physical_name") for f in entities[src]["fields"]
        }
        for pk_col in target_pks:
            if pk_col in existing_field_names:
                continue
            entities[src]["fields"].append({
                "logical_name": None,
                "physical_name": pk_col,
                "datatype": None,
                "fk_to": target,
                "inferred": True,
            })
            existing_field_names.add(pk_col)

    return {
        "entities": entities,
        "fk_targets": fks_clean,
        "domain_refs": domain_refs,
    }


def emit_yaml(model: dict, domain_id: str, domain_name: str, sap_module: str | None) -> str:
    """Render the parsed model as a YAML draft compatible with the
    curated /domains/*.yaml shape. Best-effort: only the bits we can
    parse with confidence. Cluster, key_fields, and relationships are
    left as TODOs because we can't determine them reliably from raw
    strings.
    """
    lines: list[str] = []
    lines.append("# Generated by import_erwin.py — REVIEW BEFORE APPLY.")
    lines.append("# What's deterministic: entity ids + names + attribute logical names.")
    lines.append("# What's TODO: cluster assignments, key_fields, relationships, types.")
    lines.append("")
    lines.append("domain:")
    lines.append(f"  id: {domain_id}")
    lines.append(f'  name: "{domain_name}"')
    if sap_module:
        lines.append(f"  sap_module: {sap_module}")
    lines.append('  description: |')
    lines.append("    TODO: write domain-level description.")
    lines.append("")
    lines.append("tables:")
    for ent in model["entities"].values():
        lines.append(f"  - id: {ent['id']}")
        lines.append(f'    name: "{ent["name"]}"')
        lines.append("    cluster: TODO")
        if ent.get("text_table"):
            lines.append(f"    text_table: {ent['text_table']}")
        lines.append("    description: TODO")
        lines.append("    key_fields: [TODO]")
        if ent["fields"]:
            lines.append("    fields:")
            for f in ent["fields"]:
                logical = (f.get("logical_name") or "").replace('"', '\\"')
                phys = f.get("physical_name") or "TODO"
                dt = f.get("datatype") or "?"
                tag = ""
                if f.get("inferred"):
                    tag = f"  # inferred FK -> {f.get('fk_to')} (SAP convention)"
                lines.append(
                    f'      - {{name: {phys}, description: "{logical}", datatype: {dt}}}{tag}'
                )
        else:
            lines.append("    fields: []")
        lines.append("")

    if model["domain_refs"]:
        lines.append("# Domain references (ERWIN value lookups; curator decides if these become tables):")
        for did, logical in sorted(model["domain_refs"].items()):
            lines.append(f"#   {did}: {logical}")
        lines.append("")

    if model["fk_targets"]:
        lines.append("# FK references discovered:")
        for fk in model["fk_targets"]:
            target = fk["target_phys"][0] if fk["target_phys"] else "?"
            conf = fk.get("confidence", "high")
            mark = " [low-confidence; review]" if conf == "low" else ""
            lines.append(f"#   {fk['from_entity']} -> {target}  ({fk['target_logical']}){mark}")
    return "\n".join(lines) + "\n"


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("erwin_path", type=Path, help="Path to a .erwin binary file")
    ap.add_argument("--domain-id", required=True)
    ap.add_argument("--domain-name", required=True)
    ap.add_argument("--sap-module", default=None)
    ap.add_argument("--stats", action="store_true",
                    help="Print parser stats to stderr and skip YAML output.")
    args = ap.parse_args()

    if not args.erwin_path.exists():
        sys.exit(f"ERWIN file not found: {args.erwin_path}")

    model = parse_erwin(args.erwin_path)

    if args.stats:
        sys.stderr.write(f"entities: {len(model['entities'])}\n")
        sys.stderr.write(f"FK refs:  {len(model['fk_targets'])}\n")
        sys.stderr.write("entity ids: " + ", ".join(model["entities"].keys()) + "\n")
        return

    print(emit_yaml(model, args.domain_id, args.domain_name, args.sap_module))


if __name__ == "__main__":
    main()
