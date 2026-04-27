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
from __future__ import annotations

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

# Model selection. Whole-domain extraction is high-stakes and run rarely,
# so default to Opus. Overridable via env without code changes:
#   ANTHROPIC_MODEL_PROPOSE  – overrides this script only
#   ANTHROPIC_MODEL          – overrides every script (global A/B knob)
MODEL = (
    os.environ.get("ANTHROPIC_MODEL_PROPOSE")
    or os.environ.get("ANTHROPIC_MODEL")
    or "claude-opus-4-7"
)

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
  id: <use exactly the domain id provided in the user message — do not change case or punctuation>
  name: <human-readable; use the name provided in the user message>
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
  invent ones prefixed with a SHORT cluster prefix derived from the
  domain id or SAP module (e.g., for domain id "sap_bom_recipes_routing":
  prefer "bom_recipes_*" or "pp_*", NOT the full long domain id). Three
  to five short clusters per domain is typical.
- cardinality is REQUIRED on simple relationships (many_to_one, one_to_many,
  one_to_one, or many_to_many).
- relationships is REQUIRED and MUST be non-empty for any multi-table
  domain. SAP tables almost never stand alone — header/item, classification
  via KSSK, master/text via SPRAS, change docs via CDHDR/CDPOS, etc.
  If you find yourself omitting relationships to save space, STOP and
  trim table descriptions instead. Relationships are the point of this
  document; table lists are the means.
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
    # 32K = Opus's full output budget. Truncation cost us multiple full
    # re-runs (the LLM would write tables and never reach `relationships:`).
    # Output tokens are the dominant spend either way; letting the model
    # finish in one pass beats a partial pass plus a resume. Some SAP
    # domains have 30+ tables — sized for the worst case.
    #
    # Streaming is REQUIRED at this token budget: the SDK refuses any
    # non-streaming call estimated to exceed 10 minutes. `messages.stream`
    # is a context manager whose `get_final_message()` returns the same
    # Message shape `_finalize_llm_response` already handles.
    with client.messages.stream(
        model=MODEL,
        max_tokens=32000,
        system=system_prompt,
        messages=[{"role": "user", "content": user_prompt}],
    ) as stream:
        for _ in stream.text_stream:
            # Drain the stream so the connection stays alive on long runs.
            # We don't print live tokens — the resulting log would be a
            # firehose of fragmented chunks; we want one clean YAML block
            # in the log + one usage line.
            pass
        final = stream.get_final_message()
    return _finalize_llm_response(final)


def call_llm_review(source_text: str, proposed_yaml: str) -> list[str]:
    """Second-opinion pass: a reviewer agent reads the source AND the
    proposed YAML and lists concrete gaps the extractor missed.

    Schema validation only checks shape ("is `relationships` present?").
    This reviewer checks substance ("did you miss the STKO→STPO link?
    is MAST.STLNR's polymorphism flagged?"). Returns a list of gap
    strings; empty list = the reviewer thinks it's complete.

    The user's mandate: "PDF files should be 100% converted." A second
    LLM pass with a different prompt catches single-pass omissions far
    better than asking the same model to grade its own work.
    """
    try:
        from anthropic import Anthropic
    except ImportError:
        sys.exit("missing dep: anthropic. install: pip install -r scripts/requirements.txt")

    truncated = source_text[:MAX_TEXT_CHARS]

    system_prompt = """You audit extracted SAP domain YAML against the \
source documentation it was extracted from. Your job is to spot what the \
extractor missed or got wrong.

Check, in order:
1. COMPLETENESS — Are all tables mentioned in the source present in the
   YAML? List specific missing table ids (e.g., "STAS is in the source
   but missing from tables").
2. RELATIONSHIPS — For an SAP domain with N tables there are almost
   always N-1 or more relationships. Are all the joins from the source
   present? List specific missing relationships (e.g., "STKO->STPO
   header/item link missing").
3. POLYMORPHISM — Tables like KSSK, INOB, AUSP, CDPOS, JCDS link to
   different target tables based on a discriminator (KLART, OBJTYPE,
   TABNAME, etc.). These MUST use `type: polymorphic` with
   `object_resolution`. Flag any simple relationship that should be
   polymorphic.
4. KEY FIELDS — Each table's `key_fields` should match the SAP primary
   key from the source. Flag any tables with missing or wrong keys.
5. FIELD NAMES — Are field names exact SAP technical names (CAPS, no
   paraphrasing)? Flag any non-standard names.

Return ONLY a YAML list of gap strings, one per gap. No preamble, no
explanation, no markdown fence. If you find no gaps, return the literal
string `gaps: []`. Otherwise:

gaps:
  - "<concrete gap, e.g., 'tables: missing STAS (BOM item alternatives)'>"
  - "<another gap>"

Each gap must be SPECIFIC and ACTIONABLE — name the table, the field,
the relationship. Do not say "consider adding more detail"; say what to
add."""

    user_prompt = f"""Source documentation:
{truncated}

Proposed YAML extracted from the above:
{proposed_yaml}

List concrete gaps. Return YAML."""

    client = Anthropic()
    response = client.messages.create(
        model=MODEL,
        max_tokens=4000,
        system=system_prompt,
        messages=[{"role": "user", "content": user_prompt}],
    )
    raw = _finalize_llm_response(response)
    # Parse the reviewer's YAML list. Defensive: if the model returned
    # something weird, treat as no gaps rather than crashing the run.
    try:
        import yaml as pyyaml
        parsed = pyyaml.safe_load(raw) or {}
        gaps = parsed.get("gaps") if isinstance(parsed, dict) else None
        if not isinstance(gaps, list):
            return []
        return [str(g) for g in gaps if g]
    except Exception as e:
        print(f"  ⚠ reviewer output unparseable, ignoring: {e}")
        return []


def call_llm_fix(prev_yaml: str, error_messages: list[str]) -> str:
    """Re-prompt the model with the previous (invalid) draft + the errors
    and ask for a corrected version. Handles either YAML syntax (parse)
    errors or JSON schema validation errors. Used by the retry loop.
    """
    try:
        from anthropic import Anthropic
    except ImportError:
        sys.exit("missing dep: anthropic. install: pip install -r scripts/requirements.txt")

    system_prompt = """You correct YAML documents that failed validation. \
The errors may be YAML syntax errors (unmatched quotes, bad indentation, \
stray characters) or JSON schema errors (missing required fields, wrong \
types). Return ONLY the corrected YAML body — no preamble, no explanation, \
no markdown fence. Preserve every valid field; change only what's needed \
to make the listed errors go away. Do not invent new tables, relationships, \
or fields. If the input is unparseable, repair the syntax with the smallest \
edit that makes it parse — do not rewrite or summarize the document."""

    user_prompt = f"""The previous YAML draft did not validate. Apply the \
minimal changes needed to fix these errors and return the entire corrected \
document.

Validation errors:
{chr(10).join(f'- {m}' for m in error_messages)}

Previous YAML:
{prev_yaml}
"""

    client = Anthropic()
    # Repair pass re-emits the entire (corrected) draft, so it needs the
    # same headroom as the initial extraction — and the same streaming
    # contract for long runs. See call_llm for the rationale.
    with client.messages.stream(
        model=MODEL,
        max_tokens=32000,
        system=system_prompt,
        messages=[{"role": "user", "content": user_prompt}],
    ) as stream:
        for _ in stream.text_stream:
            pass
        final = stream.get_final_message()
    return _finalize_llm_response(final)


def _finalize_llm_response(response) -> str:
    """Print a machine-parsable usage line and strip any code fence the
    model added despite being told not to.
    """
    in_tok = getattr(response.usage, "input_tokens", 0)
    out_tok = getattr(response.usage, "output_tokens", 0)
    print(f"  usage: input={in_tok} output={out_tok} model={MODEL}", flush=True)
    raw = response.content[0].text.strip()
    if raw.startswith("```"):
        raw = re.sub(r"^```(?:yaml)?\s*", "", raw)
        raw = re.sub(r"\s*```\s*$", "", raw)
    return raw


def _strip_nulls(obj):
    # LLMs sometimes emit explicit `null` for fields they don't have data
    # for (e.g. `sql_example: null`). The schema accepts the field absent
    # but rejects null. Recursively drop None values before writing.
    if isinstance(obj, dict):
        return {k: _strip_nulls(v) for k, v in obj.items() if v is not None}
    if isinstance(obj, list):
        return [_strip_nulls(x) for x in obj]
    return obj


def _clean_and_serialize(
    yaml_text: str,
    stamp: dict | None = None,
) -> tuple[dict | None, str, str | None]:
    """Parse the LLM YAML output, strip explicit nulls, optionally stamp
    user-supplied domain fields over whatever the LLM emitted, and re-emit.
    Returns (data, serialized_yaml, parse_error). On parse failure returns
    (None, raw_text, error_message) so the caller can decide whether to
    ask the model for a syntax fix or give up.

    The stamp is what guarantees domain.id matches the URL slug at apply
    time — LLMs paraphrase ids (kebab vs snake, abbreviations, "improvements")
    and we don't want to relitigate that with the model on every run.
    """
    try:
        import yaml as pyyaml
    except ImportError:
        sys.exit("missing dep: pyyaml. install: pip install -r scripts/requirements.txt")
    try:
        data = _strip_nulls(pyyaml.safe_load(yaml_text))
        if isinstance(data, dict) and stamp:
            domain = data.setdefault("domain", {})
            for k, v in stamp.items():
                if v is not None:
                    domain[k] = v
        cleaned = pyyaml.safe_dump(data, sort_keys=False, allow_unicode=True)
        return data, cleaned, None
    except Exception as e:
        print(f"  ⚠ YAML parse failed: {e}")
        return None, yaml_text, str(e)


def _validate_data(data: dict) -> list[str]:
    """Return a list of human-readable schema error strings; empty list
    means valid.
    """
    try:
        from jsonschema import Draft202012Validator
    except ImportError:
        return ["missing jsonschema for validation"]
    schema = json.loads((ROOT / "schema.json").read_text())
    validator = Draft202012Validator(schema)
    return [
        f"{'/'.join(str(p) for p in e.absolute_path) or '<root>'}: {e.message}"
        for e in validator.iter_errors(data)
    ]


# Pastel palette mirroring the existing clusters.yaml entries. We pick
# round-robin by hash so two new clusters from the same propose run get
# different fills without us needing to read the existing palette.
_AUTO_CLUSTER_COLORS = [
    "#fff4e6", "#fff8e8", "#e8ffe8", "#d0f0d0", "#f5f0e0",
    "#e8f0ff", "#f0e8ff", "#ffe8f0", "#e0f5f0", "#f5e8e0",
]


def _auto_color(cluster_id: str) -> str:
    """Stable pastel pick from the palette so re-running with the same id
    yields the same color (no churn in clusters.yaml diffs)."""
    h = sum(ord(c) for c in cluster_id)
    return _AUTO_CLUSTER_COLORS[h % len(_AUTO_CLUSTER_COLORS)]


def _humanize_cluster_id(cluster_id: str) -> str:
    """`bom_recipes_routing` -> `Bom Recipes Routing`. Good enough for an
    auto-generated registry entry; curator can rename in clusters.yaml
    after the fact."""
    return " ".join(word.capitalize() for word in cluster_id.split("_"))


def register_proposed_clusters(data: dict) -> list[str]:
    """Append-only register any cluster ids referenced in `data` that
    aren't already in clusters.yaml. Returns the list of newly-registered
    ids (empty list = nothing to do).

    Append-only on purpose: the existing clusters.yaml is hand-curated
    with comments and section dividers; CLAUDE.md's round-trip rule says
    not to lose those. Re-emitting the whole file via pyyaml would strip
    every comment. Appending text after EOF leaves everything above
    untouched.
    """
    try:
        import yaml as pyyaml
    except ImportError:
        sys.exit("missing dep: pyyaml. install: pip install -r scripts/requirements.txt")

    existing = pyyaml.safe_load(CLUSTERS_YAML.read_text()) or {}
    known = {c["id"] for c in existing.get("clusters", []) if c.get("id")}

    referenced: set[str] = set()
    for t in data.get("tables") or []:
        cid = t.get("cluster") if isinstance(t, dict) else None
        if isinstance(cid, str):
            referenced.add(cid)

    missing = sorted(referenced - known)
    if not missing:
        return []

    # Build an append block that mirrors the existing entry shape so a
    # human reader can't tell which entries were auto-vs-hand-written.
    lines = ["", f"  # --- Auto-registered by propose_domain ({datetime.now(timezone.utc).strftime('%Y-%m-%d')}) ---"]
    for cid in missing:
        lines.append(f"  - id: {cid}")
        lines.append(f"    name: {_humanize_cluster_id(cid)}")
        lines.append(f'    color: "{_auto_color(cid)}"')
        lines.append("    description: |")
        lines.append(f"      Auto-registered cluster for domain proposal. Rename + describe")
        lines.append(f"      in clusters.yaml when curating.")
    block = "\n".join(lines) + "\n"

    with CLUSTERS_YAML.open("a", encoding="utf-8") as f:
        f.write(block)
    print(f"  ✓ registered {len(missing)} new cluster(s) in clusters.yaml: {', '.join(missing)}")
    return missing


def extract_with_retry(
    domain_id: str,
    domain_name: str,
    sap_module: str | None,
    source_name: str,
    source_text: str,
    clusters_summary: str,
    max_retries: int = 2,
) -> str:
    """Call Claude, validate, ask Claude to fix any errors, repeat. Returns
    the best YAML produced (valid if at all possible). Each LLM call emits
    its own `usage:` line so the surrounding tooling can sum cost.
    """
    yaml_text = call_llm(
        domain_id, domain_name, sap_module, source_name, source_text, clusters_summary,
    )
    stamp = {"id": domain_id, "name": domain_name, "sap_module": sap_module}
    # The reviewer pass is expensive (full source + full draft → LLM call),
    # so run it at most once per propose. If the reviewer finds gaps we
    # send them through the existing call_llm_fix repair pathway. Without
    # this cap a single bad PDF could spiral into N reviews + N fixes.
    review_used = False
    for attempt in range(1, max_retries + 2):  # initial + N retries
        data, cleaned, parse_error = _clean_and_serialize(yaml_text, stamp=stamp)
        # Two failure modes share one repair pathway: YAML syntax errors
        # (data is None) and JSON schema errors (data parses but doesn't
        # validate). Either way we hand the broken text + error messages
        # to call_llm_fix and let the model do the smallest fix it can.
        if data is None:
            if attempt > max_retries:
                print(f"  ⚠ attempt {attempt}: still unparseable YAML; giving up")
                print(f"      · {parse_error}")
                return cleaned
            print(f"  ⚠ attempt {attempt}: YAML syntax error; asking model to fix")
            print(f"      · {parse_error}")
            yaml_text = call_llm_fix(cleaned, [f"YAML syntax: {parse_error}"])
            continue
        # Auto-register any cluster ids the model invented before the TS-side
        # validator (web/lib/drafts.ts) flags them as unknown. The locked rule
        # "every cluster must exist in clusters.yaml" still holds at the
        # moment of apply — they exist because we just registered them.
        register_proposed_clusters(data)
        errors = _validate_data(data)
        if not errors:
            # Schema-valid means the SHAPE is right. Now ask a reviewer
            # agent whether the SUBSTANCE is right (did we miss tables /
            # relationships / polymorphism that's actually in the source?).
            # Run at most once per propose; gaps feed back into the same
            # call_llm_fix pathway as schema errors.
            if not review_used:
                review_used = True
                print(f"  ✓ attempt {attempt}: schema-valid; running reviewer pass")
                gaps = call_llm_review(source_text, cleaned)
                if gaps:
                    if attempt > max_retries:
                        print(f"  ⚠ reviewer found {len(gaps)} gap(s) but out of retries; shipping draft anyway")
                        for g in gaps[:5]:
                            print(f"      · {g}")
                        return cleaned
                    print(f"  ⚠ reviewer found {len(gaps)} gap(s); asking model to fix")
                    for g in gaps[:5]:
                        print(f"      · {g}")
                    yaml_text = call_llm_fix(cleaned, gaps)
                    continue
                print(f"  ✓ reviewer pass clean")
            return cleaned
        if attempt > max_retries:
            print(f"  ⚠ attempt {attempt}: still {len(errors)} error(s); giving up")
            for e in errors[:5]:
                print(f"      · {e}")
            return cleaned
        print(f"  ⚠ attempt {attempt}: {len(errors)} schema error(s); asking model to fix")
        for e in errors[:5]:
            print(f"      · {e}")
        yaml_text = call_llm_fix(cleaned, errors)
    return cleaned  # unreachable but keeps type-checkers happy


def write_draft(domain_id: str, yaml_text: str) -> Path:
    DRAFTS_DIR.mkdir(parents=True, exist_ok=True)
    ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S")
    path = DRAFTS_DIR / f"{domain_id}-{ts}.yaml"
    path.write_text(yaml_text)
    return path


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
    print(f"  calling Claude ({MODEL})…")
    yaml_text = extract_with_retry(
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


if __name__ == "__main__":
    main()
