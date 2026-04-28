# Evals

`scripts/eval_extraction.py` scores a candidate domain YAML against a ground-truth YAML. Pure Python, no LLM call, runs free.

The eval is what turns the routing knobs (ticket 37) and vision toggle (ticket 38) from foot-guns into measurable knobs. "Should we move the reviewer to local Ollama?" stops being a vibes question and becomes a delta in score plus a delta in cost.

## Quick start

```bash
# Score an existing draft against a curated domain.
python3 scripts/eval_extraction.py \
    --candidate generated/drafts/sap_bom_routings_recipe-20260427T051652.yaml \
    --truth     domains/sap_bom_routings_recipe.yaml

# Score with a config-string label so you can compare runs later.
python3 scripts/eval_extraction.py \
    --candidate generated/drafts/foo.yaml \
    --truth     domains/foo.yaml \
    --config    "extractor=opus reviewer=ollama:llama3.1:8b vision=off"
```

Output goes to `generated/evals/<domain>-<timestamp>.json` plus a markdown summary on stdout. Both are gitignored — they're per-machine artifacts.

## Methodology

### The six axes

| Axis | Weight | What it measures |
|---|---|---|
| **Schema validity** | binary | Does the candidate pass `schema.json`? Failure = overall 0/100, no further scoring matters. |
| **Entities** | 25 | Fraction of ground-truth tables (matched by `id`) present in candidate. |
| **Relationships** | 25 | Fraction of ground-truth relationships present, matched by `(from_table, to_table)` topology. Polymorphic relationships are expanded into N edges before comparison. |
| **Polymorphism present** | 15 | Fraction of ground-truth polymorphic relationships that the candidate also marked `type: polymorphic`, matched by source table. |
| **Polymorphism targets** | 15 | Of the polymorphic relationships that DID get detected, fraction of `object_resolution.target_table` values that are present in candidate. |
| **Field names** | 15 | For each entity in BOTH candidate and truth: fraction of ground-truth field physical names present in candidate. Case-sensitive (SAP names are uppercase by convention). |
| **Clusters** | 5 | Fraction of candidate tables that have a non-empty `cluster:` reference. |

Component scores are floats in `[0.0, 1.0]`. The overall score is `Σ (weight × component)` rounded to one decimal.

### Why match relationships by topology, not by id

LLMs and curators name relationship ids inconsistently (`klah_to_tcla`, `klah_class_type`, `klah-class-type`). Matching by `(from_table, to_table)` is the invariant. The locked rule "polymorphic relationships render as N edges" carries through here too — a polymorphic relationship in either side is expanded into N topology edges before comparison so it doesn't artificially deflate the score.

### Why field-name match is case-sensitive

SAP physical column names are uppercase by convention (`MATNR`, `KSSK`, `OBJEK`). A candidate that emits `matnr` or `Matnr` is wrong — downstream SQL examples will break. The check enforces what the schema implicitly assumes.

### Why ground-truth field names are scored against, not field counts

A candidate could have lots of fields per entity but miss the ones that matter. Counting "what fraction of ground-truth physical names are recovered" tracks what we actually care about: are the keys, the FKs, and the documented columns there? Extra fields don't penalize the score.

## Demonstrated calibration

The eval was sanity-checked at three points:

1. **Self-eval** (`classification.yaml` vs itself): **100/100**.
2. **Cross-domain** (`sap_object_status` vs `classification`): **23.6/100**. Three accidental shared dictionary tables, zero relationships in common — score correctly low.
3. **Broken draft** (the truncated-relationships disaster from the BOM session): **0/100**. Schema invalidity short-circuits to zero. Without the short-circuit it would have been 37% entities + 0% relationships + 0% polymorphism — equally damning by a different path.

That third case is the one that mattered: the eval immediately surfaced the failure mode (schema invalid + missing relationships) that we previously diagnosed by hand. If the eval had been there, the user would have caught the regression before re-running.

## What an A/B comparison looks like

```bash
# Baseline: all-Anthropic.
MODEL_EXTRACTOR=anthropic:claude-opus-4-7 \
MODEL_REVIEWER=anthropic:claude-opus-4-7 \
  python3 scripts/propose_domain.py sources/foo.pdf \
    --domain-id foo --domain-name "Foo"
# (note the draft path it logs)
python3 scripts/eval_extraction.py \
    --candidate generated/drafts/foo-<ts>.yaml \
    --truth     domains/foo.yaml \
    --config    "all-opus" \
    --output    generated/evals/foo-allopus.json

# Variant: reviewer on local Ollama.
MODEL_EXTRACTOR=anthropic:claude-opus-4-7 \
MODEL_REVIEWER=ollama:llama3.1:8b \
  python3 scripts/propose_domain.py sources/foo.pdf \
    --domain-id foo --domain-name "Foo"
python3 scripts/eval_extraction.py \
    --candidate generated/drafts/foo-<ts2>.yaml \
    --truth     domains/foo.yaml \
    --config    "opus-extractor + local-reviewer" \
    --output    generated/evals/foo-localreviewer.json
```

Compare the two JSON files. If the score delta is smaller than the cost delta, switch.

## What's NOT in this eval

- **No LLM-as-judge.** Not yet. Structural metrics are 90% of the value at this stage. When the question becomes "is the description text more useful?" we'll add it. Until then, the cost and variance of LLM-judge isn't worth it.
- **No description-quality scoring.** Same reason.
- **No automatic regression gating in CI.** Running propose costs real money; we don't want every PR to spend $3+ on Anthropic. The eval is a manual tool for the operator. CI integration would gate on existing committed drafts (free) — that's a follow-up if/when we want it.
- **No multi-source aggregation.** Each eval scores ONE candidate against ONE truth. A "score me on every domain" wrapper is one shell loop away.

## Adding a new score axis

1. Write a `score_<thing>(candidate, truth) -> dict` function in `scripts/eval_extraction.py` that returns a dict with a `score` key in `[0.0, 1.0]`.
2. Add it to the scorecard assembly in `main()`.
3. Add a weight to `WEIGHTS` (and adjust the others if you want them to keep summing to 100).
4. Add a markdown block in `emit_markdown()` so the new score shows up in the summary.
5. Update this doc and `DECISIONS.md` #15.

The components are independent — adding one doesn't risk regressing the others. Pure additive growth.
