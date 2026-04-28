#!/usr/bin/env python3
"""Score a candidate domain YAML against a ground-truth YAML.

Pure-Python structural eval — no LLM-as-judge yet. Compares two YAMLs
on six axes and emits a JSON scorecard + markdown summary:

  schema_validity      Does the candidate pass schema.json?
  entities             % of ground-truth tables present (matched by id)
  relationships        % of ground-truth relationships present (matched
                       by (from_table, to_table) topology — IDs differ
                       across runs)
  polymorphism         % of ground-truth polymorphic relationships
                       detected as type:polymorphic, AND % of
                       resolution targets matched within them
  field_names          For each matched entity: % of ground-truth field
                       physical names present in candidate (case-
                       sensitive — "MATNR" != "matnr")
  clusters             % of candidate tables that have a non-empty
                       cluster reference

Each component scores 0.0–1.0; an overall weighted score (0–100)
combines them. Schema invalidity makes the overall score 0.

Usage:
    eval_extraction.py --candidate <generated.yaml> \\
                       --truth     <domains/foo.yaml> \\
                       [--output   <generated/evals/run.json>] \\
                       [--quiet] \\
                       [--config   "extractor=opus reviewer=ollama:8b"]

The --config string is recorded in the JSON scorecard but doesn't
affect scoring — it's metadata so you can compare runs across
routing configs later.

Cost: zero. The script never calls an LLM. Run after every propose
to track quality regressions cheaply.
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SCHEMA_PATH = ROOT / "schema.json"
EVALS_DIR = ROOT / "generated" / "evals"


# ---------------------------------------------------------------------
# Loaders
# ---------------------------------------------------------------------

def load_yaml(path: Path) -> dict:
    try:
        import yaml
    except ImportError:
        sys.exit("missing dep: pyyaml. install: pip install -r scripts/requirements.txt")
    text = path.read_text()
    return yaml.safe_load(text) or {}


# ---------------------------------------------------------------------
# Score components — each returns a dict including a 'score' field in
# [0.0, 1.0]. The overall score is a weighted combination.
# ---------------------------------------------------------------------

def score_schema_validity(candidate_path: Path) -> dict:
    """Run the same schema validation the rest of the pipeline uses.
    Schema invalidity is fatal — it shorts the overall score to 0
    because everything downstream of the schema can't be trusted."""
    try:
        from jsonschema import Draft202012Validator
    except ImportError:
        return {"valid": False, "errors": ["missing jsonschema dep"], "score": 0.0}
    schema = json.loads(SCHEMA_PATH.read_text())
    validator = Draft202012Validator(schema)
    candidate = load_yaml(candidate_path)
    errors = [
        f"{'/'.join(str(p) for p in e.absolute_path) or '<root>'}: {e.message}"
        for e in validator.iter_errors(candidate)
    ]
    return {
        "valid": len(errors) == 0,
        "error_count": len(errors),
        # Truncate so the JSON scorecard doesn't grow huge on bad runs.
        "errors": errors[:20],
        "score": 1.0 if not errors else 0.0,
    }


def score_entities(candidate: dict, truth: dict) -> dict:
    cand_ids = {t.get("id") for t in candidate.get("tables", []) if t.get("id")}
    truth_ids = {t.get("id") for t in truth.get("tables", []) if t.get("id")}
    matched = cand_ids & truth_ids
    return {
        "candidate_count": len(cand_ids),
        "truth_count": len(truth_ids),
        "matched_count": len(matched),
        "matched": sorted(matched),
        "missed": sorted(truth_ids - cand_ids),
        "extra": sorted(cand_ids - truth_ids),
        "score": (len(matched) / len(truth_ids)) if truth_ids else 1.0,
    }


def _relationship_topology(rels: list | None) -> set[tuple[str, str]]:
    """Build a set of (from_table, to_table) pairs. Used to compare
    relationships by their endpoints rather than by id (LLMs and
    curators name relationship ids inconsistently — topology is the
    invariant we actually care about)."""
    out: set[tuple[str, str]] = set()
    for r in rels or []:
        if not isinstance(r, dict):
            continue
        # Polymorphic relationships have a single 'from' but N
        # 'object_resolution' targets — record one edge per target so
        # they show up correctly in the topology comparison.
        if r.get("type") == "polymorphic":
            from_t = ((r.get("from") or {}) if isinstance(r.get("from"), dict) else {}).get("table")
            for res in r.get("object_resolution", []) or []:
                target = (res or {}).get("target_table") if isinstance(res, dict) else None
                if from_t and target:
                    out.add((from_t, target))
            continue
        from_t = ((r.get("from") or {}) if isinstance(r.get("from"), dict) else {}).get("table")
        to_t = ((r.get("to") or {}) if isinstance(r.get("to"), dict) else {}).get("table")
        if from_t and to_t:
            out.add((from_t, to_t))
    return out


def score_relationships(candidate: dict, truth: dict) -> dict:
    cand_rels = _relationship_topology(candidate.get("relationships", []))
    truth_rels = _relationship_topology(truth.get("relationships", []))
    matched = cand_rels & truth_rels
    return {
        "candidate_count": len(cand_rels),
        "truth_count": len(truth_rels),
        "matched_count": len(matched),
        "matched": [list(p) for p in sorted(matched)],
        "missed": [list(p) for p in sorted(truth_rels - cand_rels)],
        "extra": [list(p) for p in sorted(cand_rels - truth_rels)],
        "score": (len(matched) / len(truth_rels)) if truth_rels else 1.0,
    }


def score_polymorphism(candidate: dict, truth: dict) -> dict:
    """Two sub-scores combined:

    polymorphism_present_score — for each polymorphic relationship in
        truth, did the candidate produce a `type: polymorphic`
        relationship from the same source table? (We match by source
        table since the relationship id varies across runs.)

    target_coverage_score — for the polymorphic relationships that
        DID get detected, what fraction of `object_resolution` targets
        are present in the candidate?
    """
    def by_from(rels: list | None) -> dict[str, dict]:
        out: dict[str, dict] = {}
        for r in rels or []:
            if not isinstance(r, dict) or r.get("type") != "polymorphic":
                continue
            from_t = ((r.get("from") or {}) if isinstance(r.get("from"), dict) else {}).get("table")
            if from_t:
                out[from_t] = r
        return out

    truth_by_from = by_from(truth.get("relationships", []))
    cand_by_from = by_from(candidate.get("relationships", []))

    detail = []
    matched_count = 0
    target_total = 0
    target_matched = 0

    for from_t, truth_rel in truth_by_from.items():
        truth_targets = {
            (res or {}).get("target_table")
            for res in (truth_rel.get("object_resolution") or [])
            if isinstance(res, dict) and res.get("target_table")
        }
        target_total += len(truth_targets)
        cand_rel = cand_by_from.get(from_t)
        if cand_rel:
            matched_count += 1
            cand_targets = {
                (res or {}).get("target_table")
                for res in (cand_rel.get("object_resolution") or [])
                if isinstance(res, dict) and res.get("target_table")
            }
            matched_targets = truth_targets & cand_targets
            target_matched += len(matched_targets)
            detail.append({
                "from_table": from_t,
                "polymorphism_detected": True,
                "truth_targets": sorted(t for t in truth_targets if t),
                "candidate_targets": sorted(t for t in cand_targets if t),
                "matched_target_count": len(matched_targets),
            })
        else:
            detail.append({
                "from_table": from_t,
                "polymorphism_detected": False,
                "truth_targets": sorted(t for t in truth_targets if t),
            })

    return {
        "truth_polymorphic_count": len(truth_by_from),
        "candidate_polymorphic_count": len(cand_by_from),
        "polymorphism_present_score": (matched_count / len(truth_by_from)) if truth_by_from else 1.0,
        "target_coverage_score": (target_matched / target_total) if target_total else 1.0,
        "detail": detail,
    }


def score_field_names(candidate: dict, truth: dict) -> dict:
    """For each entity that exists in BOTH candidate and truth, score
    the candidate's field-name coverage of the truth's fields. Match
    is exact + case-sensitive — SAP physical names are uppercase by
    convention; "MATNR" and "matnr" are different things."""
    cand_tables = {t.get("id"): t for t in candidate.get("tables", []) if t.get("id")}
    truth_tables = {t.get("id"): t for t in truth.get("tables", []) if t.get("id")}

    per_entity = []
    total_truth_fields = 0
    total_matched_fields = 0

    for tid in sorted(cand_tables.keys() & truth_tables.keys()):
        cand_fields = {
            (f or {}).get("name")
            for f in (cand_tables[tid].get("fields") or [])
            if isinstance(f, dict) and f.get("name")
        }
        truth_fields = {
            (f or {}).get("name")
            for f in (truth_tables[tid].get("fields") or [])
            if isinstance(f, dict) and f.get("name")
        }
        if not truth_fields:
            continue
        matched = cand_fields & truth_fields
        per_entity.append({
            "id": tid,
            "candidate_count": len(cand_fields),
            "truth_count": len(truth_fields),
            "matched_count": len(matched),
            "missed": sorted(truth_fields - cand_fields),
            "score": len(matched) / len(truth_fields),
        })
        total_truth_fields += len(truth_fields)
        total_matched_fields += len(matched)

    return {
        "per_entity": per_entity,
        "total_truth_fields": total_truth_fields,
        "total_matched_fields": total_matched_fields,
        "score": (total_matched_fields / total_truth_fields) if total_truth_fields else 1.0,
    }


def score_clusters(candidate: dict) -> dict:
    """Each table should have a cluster reference. We don't compare to
    truth (clusters are visual grouping; the LLM picks valid ones from
    clusters.yaml or proposes new ones). Just check coverage."""
    tables = candidate.get("tables", []) or []
    with_cluster = sum(1 for t in tables if isinstance(t, dict) and t.get("cluster"))
    return {
        "with_cluster": with_cluster,
        "total": len(tables),
        "score": (with_cluster / len(tables)) if tables else 1.0,
    }


# ---------------------------------------------------------------------
# Aggregation + output
# ---------------------------------------------------------------------

# Component weights for the overall score. Sum to 100 by convention so
# the output reads naturally as "X out of 100." Entities and
# relationships are weighted highest because they're the structural
# bones of the model; polymorphism is weighted high because it's a
# locked rule and a known LLM weakness; field-names + clusters are
# nice-to-haves that depend on entities being right first.
WEIGHTS = {
    "entities": 25,
    "relationships": 25,
    "polymorphism_present": 15,
    "polymorphism_targets": 15,
    "field_names": 15,
    "clusters": 5,
}


def compute_overall_score(scorecard: dict) -> float:
    if not scorecard["schema_validity"]["valid"]:
        # Hard fail on schema invalidity — the rest doesn't mean
        # anything if the document doesn't conform.
        return 0.0
    components = {
        "entities": scorecard["entities"]["score"],
        "relationships": scorecard["relationships"]["score"],
        "polymorphism_present": scorecard["polymorphism"]["polymorphism_present_score"],
        "polymorphism_targets": scorecard["polymorphism"]["target_coverage_score"],
        "field_names": scorecard["field_names"]["score"],
        "clusters": scorecard["clusters"]["score"],
    }
    total = sum(WEIGHTS[k] * components[k] for k in WEIGHTS)
    return round(total, 1)


def emit_markdown(sc: dict) -> str:
    lines: list[str] = []
    lines.append(f"# Eval: {sc['domain_id']}")
    lines.append("")
    lines.append(f"**Overall: {sc['overall_score']:.1f} / 100**")
    if sc.get("config"):
        lines.append(f"  config: `{sc['config']}`")
    lines.append("")
    lines.append(f"- candidate: `{sc['candidate_path']}`")
    lines.append(f"- truth:     `{sc['truth_path']}`")
    lines.append(f"- run at:    {sc['timestamp']}")
    lines.append("")

    sv = sc["schema_validity"]
    lines.append("## Schema validity")
    if sv["valid"]:
        lines.append("✓ valid")
    else:
        lines.append(f"✗ {sv['error_count']} error(s):")
        for e in sv["errors"][:5]:
            lines.append(f"  - {e}")
    lines.append("")

    e = sc["entities"]
    lines.append(f"## Entities — {e['matched_count']}/{e['truth_count']} ({int(e['score']*100)}%)")
    if e["missed"]:
        lines.append(f"  missed: {', '.join(e['missed'])}")
    if e["extra"]:
        lines.append(f"  extra:  {', '.join(e['extra'])}")
    lines.append("")

    r = sc["relationships"]
    lines.append(f"## Relationships — {r['matched_count']}/{r['truth_count']} ({int(r['score']*100)}%) by topology")
    if r["missed"]:
        lines.append("  missed:")
        for from_t, to_t in r["missed"][:10]:
            lines.append(f"    - {from_t} → {to_t}")
        if len(r["missed"]) > 10:
            lines.append(f"    - ... and {len(r['missed']) - 10} more")
    lines.append("")

    p = sc["polymorphism"]
    lines.append("## Polymorphism")
    lines.append(
        f"  detected: {p['candidate_polymorphic_count']}/{p['truth_polymorphic_count']} "
        f"({int(p['polymorphism_present_score']*100)}%)"
    )
    lines.append(f"  target coverage: {int(p['target_coverage_score']*100)}%")
    for d in p.get("detail", []):
        if not d.get("polymorphism_detected"):
            lines.append(
                f"  ✗ MISSED: {d['from_table']} should be polymorphic "
                f"to {', '.join(d['truth_targets'])}"
            )
    lines.append("")

    f = sc["field_names"]
    lines.append(f"## Field names — {int(f['score']*100)}% coverage")
    # Show worst three entities so the curator sees where the gaps are.
    worst = sorted(f["per_entity"], key=lambda x: x["score"])[:3]
    for ent in worst:
        if ent["score"] < 1.0:
            lines.append(
                f"  - {ent['id']}: {ent['matched_count']}/{ent['truth_count']} "
                f"missed: {', '.join(ent['missed'])}"
            )
    lines.append("")

    c = sc["clusters"]
    lines.append(f"## Clusters — {c['with_cluster']}/{c['total']} ({int(c['score']*100)}%)")
    return "\n".join(lines)


def main() -> None:
    ap = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    ap.add_argument("--candidate", required=True, type=Path,
                    help="YAML to evaluate (e.g. generated/drafts/foo.yaml or domains/foo.yaml)")
    ap.add_argument("--truth", required=True, type=Path,
                    help="Ground-truth YAML (typically domains/<id>.yaml)")
    ap.add_argument("--output", type=Path,
                    help="Where to write the JSON scorecard (default: generated/evals/<id>-<ts>.json)")
    ap.add_argument("--quiet", action="store_true", help="Skip the markdown summary")
    ap.add_argument("--config",
                    help="Free-form description of the routing config used for this run "
                         "(metadata only — recorded in the scorecard for later comparison)")
    args = ap.parse_args()

    if not args.candidate.exists():
        sys.exit(f"candidate not found: {args.candidate}")
    if not args.truth.exists():
        sys.exit(f"truth not found: {args.truth}")

    candidate = load_yaml(args.candidate)
    truth = load_yaml(args.truth)
    domain_id = (truth.get("domain") or {}).get("id", "unknown")

    scorecard = {
        "domain_id": domain_id,
        "candidate_path": str(args.candidate.relative_to(ROOT) if args.candidate.is_absolute() else args.candidate),
        "truth_path": str(args.truth.relative_to(ROOT) if args.truth.is_absolute() else args.truth),
        "timestamp": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "config": args.config or "",
        "schema_validity": score_schema_validity(args.candidate),
        "entities": score_entities(candidate, truth),
        "relationships": score_relationships(candidate, truth),
        "polymorphism": score_polymorphism(candidate, truth),
        "field_names": score_field_names(candidate, truth),
        "clusters": score_clusters(candidate),
    }
    scorecard["overall_score"] = compute_overall_score(scorecard)
    scorecard["weights"] = dict(WEIGHTS)

    # Persist the JSON scorecard either to the user-provided path or to
    # a default under generated/evals/. Default file name embeds the
    # domain id and a sortable timestamp so multiple runs don't clobber.
    if args.output is None:
        EVALS_DIR.mkdir(parents=True, exist_ok=True)
        ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S")
        args.output = EVALS_DIR / f"{domain_id}-{ts}.json"
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(scorecard, indent=2) + "\n")

    if not args.quiet:
        print(emit_markdown(scorecard))
        print()
        print(f"  scorecard: {args.output.relative_to(ROOT) if args.output.is_absolute() else args.output}")


if __name__ == "__main__":
    main()
