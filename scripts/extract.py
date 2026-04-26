#!/usr/bin/env python3
"""Extract candidate annotations from SAP source documents.

Usage:
    extract.py <path/to/file.pdf> --domain <id>
    extract.py --all-sources --domain <id>

Phase 5 ticket 20: PDF text extraction skeleton. LLM call lands in
ticket 21; URL ingestion in ticket 23.
"""
import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SOURCES_DIR = ROOT / "sources"
DOMAINS_DIR = ROOT / "domains"


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


def process_pdf(path: Path, domain: str, dry_run: bool) -> None:
    if not path.exists():
        sys.exit(f"file not found: {path}")
    if path.suffix.lower() != ".pdf":
        sys.exit(f"not a PDF: {path}")
    print(f"\n=== {path.relative_to(ROOT) if path.is_relative_to(ROOT) else path} ===")
    text = extract_pdf_text(path)
    print(f"  extracted {len(text)} chars from {path.name}")
    if dry_run:
        print(f"  (dry-run) first 500 chars:\n{text[:500]}")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("source", nargs="?", help="Path to a PDF (omit with --all-sources)")
    ap.add_argument("--all-sources", action="store_true",
                    help=f"Process every PDF in {SOURCES_DIR}")
    ap.add_argument("--domain", required=True,
                    help="Domain id (must exist as /domains/<id>.yaml)")
    ap.add_argument("--dry-run", action="store_true",
                    help="Don't insert into DB; print what would happen")
    args = ap.parse_args()

    domain_yaml = DOMAINS_DIR / f"{args.domain}.yaml"
    if not domain_yaml.exists():
        sys.exit(f"domain not found: {domain_yaml}")

    if args.all_sources:
        if not SOURCES_DIR.exists():
            sys.exit(f"no sources directory: {SOURCES_DIR}")
        pdfs = sorted(SOURCES_DIR.glob("*.pdf"))
        if not pdfs:
            print(f"no PDFs in {SOURCES_DIR}")
            return
        for pdf in pdfs:
            process_pdf(pdf, args.domain, args.dry_run)
    elif args.source:
        process_pdf(Path(args.source), args.domain, args.dry_run)
    else:
        ap.error("provide a path or --all-sources")


if __name__ == "__main__":
    main()
