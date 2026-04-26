#!/usr/bin/env python3
"""Propose a brand-new domain YAML from a source PDF or URL.

Different from extract.py: that one finds annotations (gotchas, S/4
changes, notes) for entities in an *existing* domain. This script extracts
the whole domain model — entities, fields, relationships, clusters — when
no domain YAML exists yet (e.g., an SAP Pricing.PDF arrives and you want
a /domains/pricing.yaml proposed).

Usage:
    propose_domain.py <pdf>   --domain-id <id> --domain-name "<name>" [--sap-module <code>]
    propose_domain.py --url <https://...> --domain-id <id> --domain-name "<name>"

Writes a draft to /generated/drafts/<domain-id>-<ts>.yaml and validates
it against schema.json. Draft is kept either way; review + edit before
applying.
"""
import argparse
import json
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CLUSTERS_YAML = ROOT / "clusters.yaml"
DRAFTS_DIR = ROOT / "generated" / "drafts"
MAX_TEXT_CHARS = 80_000

# Reuse the source extractors from extract.py.
sys.path.insert(0, str(Path(__file__).resolve().parent))
from extract import extract_pdf_text, extract_url_text  # noqa: E402


def load_clusters_summary() -> str:
    try:
        import yaml
    except ImportError:
        sys.exit("missing dep: pyyaml. install: pip install -r scripts/requirements.txt")
    doc = yaml.safe_load(CLUSTERS_YAML.read_text())
    lines = []
    for c in doc.get("clusters", []):
        desc = (c.get("description") or "").strip().split("\n")[0]
        lines.append(f"- {c['id']}: {c.get('name', '')} — {desc}")
    return "\n".join(lines)


def call_llm(
    domain_id: str,
    domain_name: str,
    sap_module: str | None,
    source_name: str,
    source_text: str,
    clusters_summary: str,
) -> str:
    try:
        from anthropic import Anthropic
    except ImportError:
        sys.exit("missing dep: anthropic. install: pip install -r scripts/requirements.txt")
    if not os.environ.get("ANTHROPIC_API_KEY"):
        sys.exit("ANTHROPIC_API_KEY not set in env")

    truncated = source_text[:MAX_TEXT_CHARS]
    truncation_note = (
        f"\n\n[NOTE: source truncated from {len(source_text)} → {MAX_TEXT_CHARS} chars]"
        if len(source_text) > MAX_TEXT_CHARS
        else ""
    )

    system_prompt = """You extract structured SAP table relationship models \
from documentation into a curated YAML format.

Output ONLY a single YAML document, no preamble, no explanation, no \
markdown code fence. Match this exact shape:

domain:
  id: <kebab-case>
  name: <human-readable>
  sap_module: <best-guess SAP module code, e.g., MM, SD, FI, CO, PP>
  description: |
    2-3 sentences explaining what this domain is and why a consultant cares.

tables:
  - id: <SAP technical name in CAPS, e.g., KSSK, MARA, EKKO>
    name: <human description>
    cluster: <one of the cluster ids from the user message>
    description: <one paragraph>
    key_fields: [<FIELD>, ...]
    fields:
      - {name: <FIELD>, description: "<description>"}

relationships:
  - id: <snake_case>
    description: <one sentence>
    from: {table: <ID>, fields: [<FIELD>, ...]}
    to:   {table: <ID>, fields: [<FIELD>, ...]}
    cardinality: many_to_one | one_to_many | one_to_one | many_to_many
    optional: false
    sql_example: |
      SELECT ...

For polymorphic relationships (one column resolves to different tables \
based on a discriminator), use:

  - id: <snake_case>
    type: polymorphic
    description: <one sentence>
    from: {table: <ID>, fields: [<discriminator field(s)>]}
    object_resolution:
      - {klart: '<discriminator value>', target_table: <ID>, objek_format: "<format>", via_inob: false}

Rules:
- SAP table IDs in CAPS.
- Cluster ids: prefer existing ones from the user message. If none fit,
  invent one prefixed with the domain id (e.g., pricing_conditions for
  domain id "pricing"). Never pick a cluster outside the user list AND
  without the domain prefix.
- cardinality is required on simple relationships.
- Use concrete field names from the source — don't fabricate them.
- Description text should be operationally useful for consultants
  (joins they'll write, gotchas they'll hit, conditions to remember).
- Return ONLY the YAML body. No JSON, no fences, no commentary.
"""

    user_prompt = f"""Domain id (suggested): {domain_id}
Domain name (suggested): {domain_name}
SAP module: {sap_module or '(unknown — best guess from source)'}

Existing cluster ids you can use (prefer these if appropriate):
{clusters_summary}

Source: {source_name}

Source text:
{truncated}{truncation_note}
"""

    client = Anthropic()
    response = client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=8000,
        system=system_prompt,
        messages=[{"role": "user", "content": user_prompt}],
    )
    raw = response.content[0].text.strip()
    if raw.startswith("```"):
        raw = re.sub(r"^```(?:yaml)?\s*", "", raw)
        raw = re.sub(r"\s*```\s*$", "", raw)
    return raw


def write_draft(domain_id: str, yaml_text: str) -> Path:
    DRAFTS_DIR.mkdir(parents=True, exist_ok=True)
    ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S")
    path = DRAFTS_DIR / f"{domain_id}-{ts}.yaml"
    path.write_text(yaml_text)
    return path


def validate_draft(path: Path) -> tuple[bool, str]:
    """Returns (is_valid, error_string)."""
    try:
        import yaml as pyyaml
        from jsonschema import Draft202012Validator
    except ImportError:
        return False, "missing pyyaml/jsonschema for validation"
    schema = json.loads((ROOT / "schema.json").read_text())
    validator = Draft202012Validator(schema)
    try:
        data = pyyaml.safe_load(path.read_text())
    except Exception as e:
        return False, f"YAML parse error: {e}"
    errors = list(validator.iter_errors(data))
    if errors:
        msgs = [
            f"  {'/'.join(str(p) for p in e.absolute_path) or '<root>'}: {e.message}"
            for e in errors[:10]
        ]
        return False, "schema validation failed:\n" + "\n".join(msgs)
    return True, ""


def main() -> None:
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    ap.add_argument("source", nargs="?", help="Path to a PDF (omit with --url)")
    ap.add_argument("--url", help="Fetch and extract from a web URL")
    ap.add_argument("--domain-id", required=True, help="Suggested domain id (kebab-case)")
    ap.add_argument("--domain-name", required=True, help="Human-readable domain name")
    ap.add_argument("--sap-module", help="SAP module code (MM/SD/FI/etc.)")
    args = ap.parse_args()

    if args.url:
        title, text = extract_url_text(args.url)
        source_name = f"{title} ({args.url})"
    elif args.source:
        path = Path(args.source)
        if not path.exists() or path.suffix.lower() != ".pdf":
            sys.exit(f"not a PDF: {path}")
        text = extract_pdf_text(path)
        source_name = path.name
    else:
        ap.error("provide a PDF path or --url")

    print(f"  text length: {len(text)} chars")
    if not text.strip():
        sys.exit("source is empty")

    clusters_summary = load_clusters_summary()
    print(f"  using {clusters_summary.count(chr(10)) + 1} existing cluster ids as context")
    print(f"  calling Claude (sonnet 4.6)…")
    yaml_text = call_llm(
        args.domain_id,
        args.domain_name,
        args.sap_module,
        source_name,
        text,
        clusters_summary,
    )
    draft_path = write_draft(args.domain_id, yaml_text)
    rel = draft_path.relative_to(ROOT)
    print(f"  ✓ draft written to {rel}")

    valid, errors = validate_draft(draft_path)
    if valid:
        print(f"  ✓ draft validates against schema.json")
    else:
        print(f"  ⚠ draft does NOT validate:\n{errors}")
        print(f"    (kept the draft anyway — review and edit before applying)")


if __name__ == "__main__":
    main()
