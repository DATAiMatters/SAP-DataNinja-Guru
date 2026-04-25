#!/usr/bin/env python3
"""
Generate Mermaid diagrams from a domain YAML, using cluster info from YAML
(not hardcoded). Validates schema-locked references along the way.

Usage:
    python generate_mermaid.py <domain.yaml> <clusters.yaml> [--out path]
"""
import yaml
import sys
import argparse
from pathlib import Path
from collections import defaultdict

CARDINALITY_TO_MERMAID = {
    "one_to_one":   "||--||",
    "one_to_many":  "||--o{",
    "many_to_one":  "}o--||",
    "many_to_many": "}o--o{",
}

def card_symbol(rel):
    base = CARDINALITY_TO_MERMAID.get(rel.get("cardinality", "many_to_one"), "}o--||")
    if rel.get("optional"):
        base = base.replace("||", "|o")
    return base

def gen_flowchart(domain_data, cluster_registry):
    """Flowchart with subgraph clustering. Reads clusters from registry."""
    cluster_lookup = {c["id"]: c for c in cluster_registry["clusters"]}

    # Group tables by cluster, preserving discovery order
    cluster_tables = defaultdict(list)
    cluster_order = []
    for table in domain_data["tables"]:
        cl = table.get("cluster")
        if not cl:
            raise ValueError(f"Table {table['id']} missing required 'cluster' field")
        if cl not in cluster_lookup:
            raise ValueError(f"Table {table['id']} references unknown cluster '{cl}' "
                             f"(not in clusters.yaml)")
        if cl not in cluster_tables:
            cluster_order.append(cl)
        cluster_tables[cl].append(table)

    lines = [
        "flowchart LR",
        f"    %% Domain: {domain_data['domain']['name']}",
        f"    %% Clusters: {', '.join(cluster_order)}",
        "",
    ]

    # Emit clusters
    for cl_id in cluster_order:
        cl = cluster_lookup[cl_id]
        cluster_safe = cl_id.replace("-", "_")
        lines.append(f'    subgraph {cluster_safe}["{cl["name"]}"]')
        for table in cluster_tables[cl_id]:
            short_name = table["name"]
            if len(short_name) > 28:
                short_name = short_name[:26] + "…"
            lines.append(f'        {table["id"]}["<b>{table["id"]}</b><br/>{short_name}"]')
        lines.append("    end")
        lines.append("")

    # Relationships
    for rel in domain_data.get("relationships", []):
        if rel.get("type") == "polymorphic":
            for res in rel["object_resolution"]:
                tag = "via INOB" if res.get("via_inob") else "direct"
                src = rel["from"]["table"]
                lines.append(f'    {src} -.->|"klart={res["klart"]} ({tag})"| {res["target_table"]}')
            continue
        from_t = rel["from"]["table"]
        to_t = rel["to"]["table"]
        arrow = "-.->" if rel.get("optional") else "-->"
        join_fields = "+".join(rel["from"]["fields"])
        lines.append(f'    {from_t} {arrow}|"{join_fields}"| {to_t}')

    # Styling — derive class names from cluster ids
    lines.append("")
    for cl_id in cluster_order:
        cl = cluster_lookup[cl_id]
        # Derive a stroke color (darker) — quick heuristic, real renderer can do this properly
        stroke = "#666"
        cluster_safe_class = cl_id.replace("-", "_")
        lines.append(f'    classDef {cluster_safe_class}_style fill:{cl["color"]},stroke:{stroke}')
        # Apply to all tables in the cluster
        ids = ",".join(t["id"] for t in cluster_tables[cl_id])
        lines.append(f'    class {ids} {cluster_safe_class}_style')

    return "\n".join(lines)

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("domain_yaml")
    ap.add_argument("clusters_yaml")
    ap.add_argument("--out", default=None)
    args = ap.parse_args()

    domain = yaml.safe_load(Path(args.domain_yaml).read_text())
    clusters = yaml.safe_load(Path(args.clusters_yaml).read_text())

    out = gen_flowchart(domain, clusters)

    if args.out:
        Path(args.out).write_text(out)
        print(f"Wrote {args.out}")
    else:
        print(out)

if __name__ == "__main__":
    main()
