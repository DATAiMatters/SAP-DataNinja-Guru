#!/usr/bin/env python3
"""Fail if any domain YAML references a cluster id missing from clusters.yaml."""
import sys
from pathlib import Path

try:
    import yaml
except ImportError:
    sys.exit("missing dep: yaml. install: pip install pyyaml")

ROOT = Path(__file__).resolve().parent.parent
clusters_doc = yaml.safe_load((ROOT / "clusters.yaml").read_text())
known = {c["id"] for c in clusters_doc.get("clusters", [])}

domain_files = sorted((ROOT / "domains").glob("*.yaml"))
if not domain_files:
    sys.exit("no domain YAML files found in /domains/")

errors = []
for f in domain_files:
    data = yaml.safe_load(f.read_text())
    for table in data.get("tables", []):
        cl = table.get("cluster")
        if not cl:
            errors.append(
                f"{f.relative_to(ROOT)}: table {table.get('id')}: missing cluster"
            )
        elif cl not in known:
            errors.append(
                f"{f.relative_to(ROOT)}: table {table.get('id')}: "
                f"cluster '{cl}' not in clusters.yaml"
            )

if errors:
    print("\n".join(errors))
    sys.exit(f"\n{len(errors)} cluster reference error(s)")

print(f"OK — all cluster refs in {len(domain_files)} domain file(s) resolve")
