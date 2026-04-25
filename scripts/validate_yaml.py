#!/usr/bin/env python3
"""Validate every domain YAML against schema.json (draft 2020-12)."""
import json
import sys
from pathlib import Path

try:
    import yaml
    from jsonschema import Draft202012Validator
except ImportError as e:
    sys.exit(f"missing dep: {e.name}. install: pip install pyyaml jsonschema")

ROOT = Path(__file__).resolve().parent.parent
schema = json.loads((ROOT / "schema.json").read_text())
validator = Draft202012Validator(schema)

domain_files = sorted((ROOT / "domains").glob("*.yaml"))
if not domain_files:
    sys.exit("no domain YAML files found in /domains/")

errors = 0
for f in domain_files:
    data = yaml.safe_load(f.read_text())
    for err in validator.iter_errors(data):
        path = "/".join(str(p) for p in err.absolute_path) or "<root>"
        print(f"{f.relative_to(ROOT)}: {path}: {err.message}")
        errors += 1

if errors:
    sys.exit(f"\n{errors} validation error(s)")

print(f"OK — {len(domain_files)} domain file(s) valid")
