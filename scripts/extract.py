#!/usr/bin/env python3
"""Extract candidate annotations from SAP source documents.

Usage:
    extract.py <path/to/file.pdf> --domain <id> [--dry-run]
    extract.py --all-sources          --domain <id> [--dry-run]
    extract.py --url <https://...>    --domain <id> [--dry-run]

Phase 5 ticket 20: PDF text extraction
Phase 5 ticket 21: LLM call + DB insert (proposed annotations)
Phase 5 ticket 23: --url ingestion (HTML → text → same pipeline)
"""
import argparse
import json
import os
import re
import sqlite3
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SOURCES_DIR = ROOT / "sources"
DOMAINS_DIR = ROOT / "domains"
DB_PATH = ROOT / "web" / "data.db"

# Model selection. Annotation-finding runs more often per doc than whole-
# domain extraction, so default to Sonnet (balanced cost/quality).
# Overridable via env without code changes:
#   ANTHROPIC_MODEL_EXTRACT  – overrides this script only
#   ANTHROPIC_MODEL          – overrides every script (global A/B knob)
MODEL = (
    os.environ.get("ANTHROPIC_MODEL_EXTRACT")
    or os.environ.get("ANTHROPIC_MODEL")
    or "claude-sonnet-4-6"
)

# Stable id for the system extractor user. Created on first run.
EXTRACTOR_USER_ID = "00000000-0000-0000-0000-000000000000"
EXTRACTOR_USER_EMAIL = "extractor@local"
EXTRACTOR_USER_NAME = "Extraction pipeline"

ALLOWED_KINDS = {"gotcha", "s4_change", "note"}
ALLOWED_SEVERITIES = {"low", "medium", "high"}
MAX_TEXT_CHARS = 80_000


def load_domain(domain_id: str) -> dict:
    try:
        import yaml
    except ImportError:
        sys.exit("missing dep: pyyaml. install: pip install -r scripts/requirements.txt")
    path = DOMAINS_DIR / f"{domain_id}.yaml"
    if not path.exists():
        sys.exit(f"domain not found: {path}")
    return yaml.safe_load(path.read_text())


def extract_pdf_text(path: Path) -> str:
    try:
        from pypdf import PdfReader
    except ImportError:
        sys.exit("missing dep: pypdf. install: pip install -r scripts/requirements.txt")
    reader = PdfReader(str(path))
    chunks = []
    for i, page in enumerate(reader.pages):
        text = page.extract_text() or ""
        if text.strip():
            chunks.append(f"--- page {i + 1} ---\n{text}")
    return "\n\n".join(chunks)


def extract_url_text(url: str) -> tuple[str, str]:
    """Returns (page title, plain text) extracted from a URL."""
    try:
        import requests
        from bs4 import BeautifulSoup
    except ImportError:
        sys.exit(
            "missing dep: requests/beautifulsoup4. install: pip install -r scripts/requirements.txt"
        )
    resp = requests.get(
        url, timeout=30,
        headers={"User-Agent": "SAPKnowledgeBaseExtractor/1.0"},
    )
    resp.raise_for_status()
    soup = BeautifulSoup(resp.text, "html.parser")
    # Drop chrome that's never the meat of the page.
    for tag in soup(["script", "style", "nav", "footer", "header", "aside", "noscript"]):
        tag.decompose()
    title = (
        soup.title.string.strip()
        if soup.title and soup.title.string
        else url
    )
    text = soup.get_text(separator="\n")
    text = re.sub(r"[ \t]+\n", "\n", text)
    text = re.sub(r"\n{3,}", "\n\n", text).strip()
    return title, text


def call_llm(domain_doc: dict, source_name: str, source_text: str) -> list[dict]:
    try:
        from anthropic import Anthropic
    except ImportError:
        sys.exit("missing dep: anthropic. install: pip install -r scripts/requirements.txt")
    if not os.environ.get("ANTHROPIC_API_KEY"):
        sys.exit("ANTHROPIC_API_KEY not set in env")

    entities = "\n".join(
        f"- {t['id']}: {t.get('name', '')}" for t in domain_doc.get("tables", [])
    )
    truncated = source_text[:MAX_TEXT_CHARS]
    truncation_note = (
        f"\n\n[NOTE: source truncated from {len(source_text)} → {MAX_TEXT_CHARS} chars]"
        if len(source_text) > MAX_TEXT_CHARS
        else ""
    )

    system_prompt = """You extract structured operational knowledge from SAP \
documentation into a curated YAML format. The audience is consultants \
who need actionable details: gotchas (things that bite), S/4HANA migration \
changes, and useful notes.

Output ONLY a JSON array. No preamble, no explanation, no markdown fence. \
Each element must match this exact shape:

{
  "target_table": "<one of the entity IDs from the user message>",
  "kind": "gotcha" | "s4_change" | "note",
  "text": "<concise, actionable description, 1-3 sentences>",
  "severity": "low" | "medium" | "high"
}

Rules:
- Only emit items that clearly map to one of the listed entity IDs. Skip the rest.
- "severity" is required for gotcha and s4_change; omit for note.
- Prefer specific over vague. Concrete field names, table names, condition values.
- Don't invent entity IDs not in the list.
- If the source has nothing useful, output: []
"""

    user_prompt = f"""Domain entities:
{entities}

Source: {source_name}

Source text:
{truncated}{truncation_note}
"""

    client = Anthropic()
    response = client.messages.create(
        model=MODEL,
        max_tokens=4000,
        system=system_prompt,
        messages=[{"role": "user", "content": user_prompt}],
    )
    # Machine-parsable usage line — sniffed by web/lib/jobs.ts.
    in_tok = getattr(response.usage, "input_tokens", 0)
    out_tok = getattr(response.usage, "output_tokens", 0)
    print(f"  usage: input={in_tok} output={out_tok} model={MODEL}", flush=True)
    raw = response.content[0].text.strip()
    # Defensive: strip an outer code fence if Claude added one anyway.
    if raw.startswith("```"):
        raw = re.sub(r"^```(?:json)?\s*", "", raw)
        raw = re.sub(r"\s*```\s*$", "", raw)
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError as e:
        sys.exit(f"LLM did not return valid JSON: {e}\n--- raw ---\n{raw[:1000]}")
    if not isinstance(parsed, list):
        sys.exit(f"LLM JSON is not a list: {type(parsed).__name__}")
    return parsed


def validate_candidates(
    candidates: list[dict], domain_doc: dict
) -> list[dict]:
    known_ids = {t["id"] for t in domain_doc.get("tables", [])}
    valid = []
    for c in candidates:
        if not isinstance(c, dict):
            continue
        target = c.get("target_table")
        kind = c.get("kind")
        text = c.get("text")
        if not target or not kind or not text:
            continue
        if target not in known_ids:
            print(f"  · skip (unknown entity {target}): {str(text)[:60]}…")
            continue
        if kind not in ALLOWED_KINDS:
            print(f"  · skip (bad kind {kind}): {str(text)[:60]}…")
            continue
        sev = c.get("severity")
        if kind in ("gotcha", "s4_change") and sev not in ALLOWED_SEVERITIES:
            sev = "medium"  # default if missing/invalid
        valid.append(
            {
                "target_table": target,
                "kind": kind,
                "text": str(text).strip(),
                "severity": sev if kind != "note" else None,
            }
        )
    return valid


def insert_candidates(
    candidates: list[dict],
    domain_id: str,
    source_name: str,
) -> int:
    if not DB_PATH.exists():
        sys.exit(
            f"DB not found at {DB_PATH}. Run `cd web && npm run db:push` first."
        )
    conn = sqlite3.connect(str(DB_PATH))
    conn.execute("PRAGMA foreign_keys = ON")
    # Ensure the system extractor user exists.
    conn.execute(
        "INSERT OR IGNORE INTO user (id, email, name) VALUES (?, ?, ?)",
        (EXTRACTOR_USER_ID, EXTRACTOR_USER_EMAIL, EXTRACTOR_USER_NAME),
    )

    now_ms = int(datetime.now(timezone.utc).timestamp() * 1000)
    inserted = 0
    for c in candidates:
        target_id = f"domain:{domain_id}/table:{c['target_table']}"
        conn.execute(
            """INSERT INTO annotations
               (id, user_id, target_type, target_id, kind, body_md, severity, title, status, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                str(uuid.uuid4()),
                EXTRACTOR_USER_ID,
                "table",
                target_id,
                c["kind"],
                c["text"],
                c["severity"],
                f"Extracted from {source_name}",
                "proposed",
                now_ms,
            ),
        )
        inserted += 1
    conn.commit()
    conn.close()
    return inserted


def process_source(
    source_name: str,
    text: str,
    domain_id: str,
    dry_run: bool,
) -> None:
    domain_doc = load_domain(domain_id)
    print(f"\n=== {source_name} ===")
    print(f"  text length: {len(text)} chars")
    if not text.strip():
        print("  empty source — skipping")
        return
    candidates = call_llm(domain_doc, source_name, text)
    print(f"  LLM returned {len(candidates)} raw candidate(s)")
    valid = validate_candidates(candidates, domain_doc)
    print(f"  {len(valid)} valid after schema check")

    for c in valid:
        sev = f" [{c['severity']}]" if c["severity"] else ""
        print(f"    · {c['kind']}{sev} → {c['target_table']}: {c['text'][:80]}…")

    if dry_run:
        print(f"  (dry-run) skipping DB insert")
        return
    inserted = insert_candidates(valid, domain_id, source_name)
    print(f"  ✓ inserted {inserted} proposed annotations into DB")


def process_pdf(path: Path, domain_id: str, dry_run: bool) -> None:
    if not path.exists():
        sys.exit(f"file not found: {path}")
    if path.suffix.lower() != ".pdf":
        sys.exit(f"not a PDF: {path}")
    text = extract_pdf_text(path)
    process_source(path.name, text, domain_id, dry_run)


def process_url(url: str, domain_id: str, dry_run: bool) -> None:
    title, text = extract_url_text(url)
    process_source(f"{title} ({url})", text, domain_id, dry_run)


def main() -> None:
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    ap.add_argument("source", nargs="?", help="Path to a PDF (omit with --all-sources/--url)")
    ap.add_argument("--all-sources", action="store_true",
                    help=f"Process every PDF in {SOURCES_DIR.relative_to(ROOT)}")
    ap.add_argument("--url", help="Fetch and extract from a web URL (HTML → text)")
    ap.add_argument("--domain", required=True, help="Domain id (must exist as /domains/<id>.yaml)")
    ap.add_argument("--dry-run", action="store_true",
                    help="Don't insert into DB; print extracted candidates")
    args = ap.parse_args()

    if args.url:
        process_url(args.url, args.domain, args.dry_run)
        return
    if args.all_sources:
        if not SOURCES_DIR.exists():
            sys.exit(f"no sources directory: {SOURCES_DIR}")
        pdfs = sorted(SOURCES_DIR.glob("*.pdf"))
        if not pdfs:
            print(f"no PDFs in {SOURCES_DIR}")
            return
        for pdf in pdfs:
            process_pdf(pdf, args.domain, args.dry_run)
        return
    if args.source:
        process_pdf(Path(args.source), args.domain, args.dry_run)
        return
    ap.error("provide a path, --all-sources, or --url")


if __name__ == "__main__":
    main()
