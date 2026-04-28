# Agents

The **propose-domain** pipeline is multi-agent by design. A single LLM extracting whole SAP domains from PDFs misses things — relationships, polymorphism, fields. A single LLM grading its own work misses the same things, because the same biases that caused the omission cause it to miss the omission. A second agent with a different role and prompt catches what the first one missed.

This document describes the agents in `scripts/propose_domain.py`, why each exists, and how to add new ones.

## The pipeline

```
   PDF / URL
       │
       ▼
┌─────────────────┐
│  Extract text   │  ← extract.py (PyMuPDF for PDFs, BeautifulSoup for URLs)
└─────────────────┘
       │
       ▼
┌─────────────────┐
│  Extractor LLM  │  ← Agent 1: turns source text into draft YAML
└─────────────────┘
       │
       ▼
┌─────────────────┐
│  Domain stamp   │  ← Forces domain.id to match what the user submitted
└─────────────────┘  (LLMs paraphrase ids; we don't relitigate)
       │
       ▼
┌─────────────────┐
│  Strip nulls    │  ← LLMs sometimes emit `field: null`; schema rejects null
└─────────────────┘  but accepts absent
       │
       ▼
┌─────────────────┐
│  YAML parse     │
└─────────────────┘
       │           ┌──────── parse error ────────┐
       │           ▼                             │
       │   ┌─────────────────┐                   │
       │   │  Repair LLM     │ ── retry ─────────┘
       │   │  (syntax fix)   │   (max 2 retries)
       │   └─────────────────┘
       ▼
┌─────────────────┐
│  Cluster        │  ← Auto-register any new cluster ids in clusters.yaml
│  registrar      │     (append-only; preserves comments)
└─────────────────┘
       │
       ▼
┌─────────────────┐
│  Schema         │
│  validation     │
└─────────────────┘
       │           ┌──────── schema error ───────┐
       │           ▼                             │
       │   ┌─────────────────┐                   │
       │   │  Repair LLM     │ ── retry ─────────┘
       │   │  (schema fix)   │
       │   └─────────────────┘
       ▼
┌─────────────────┐
│  Reviewer LLM   │  ← Agent 2: audits draft against source for completeness
└─────────────────┘
       │           ┌──────── gaps found ─────────┐
       │           ▼                             │
       │   ┌─────────────────┐                   │
       │   │  Repair LLM     │ ── once ──────────┘
       │   │  (gap fix)      │   (reviewer runs once max)
       │   └─────────────────┘
       ▼
┌─────────────────┐
│  Write draft    │  → /generated/drafts/<domain-id>-<timestamp>.yaml
└─────────────────┘
```

## Why two LLMs

A single-LLM pipeline (extract → validate → repair → done) catches **shape** errors — missing required fields, wrong types, unmatched quotes. The schema validator does this for free.

A single-LLM pipeline does NOT catch **substance** errors:
- "You extracted 21 tables but the source mentions 25."
- "STKO points to STPO via STLNR, but you didn't model that join."
- "CDPOS should be polymorphic with `OBJECTCLAS` as the discriminator; you modeled it as a simple FK."
- "MAST.STLNR is the BOM technical key; you flagged STLAN as the key instead."

These are completeness errors. The schema accepts them. Only an agent that reads both the source AND the proposed YAML — with a different prompt and a different role — catches them.

The reviewer's checklist mirrors the manual self-check from [`.claude/skills/sap-erd-extraction/SKILL.md`](../.claude/skills/sap-erd-extraction/SKILL.md):

1. **Completeness** — every table in the source present in the YAML.
2. **Relationships** — every join in the source modeled (header/item, classification, text tables, change docs).
3. **Polymorphism** — discriminator-resolved relationships use `type: polymorphic`, never collapsed to a single FK.
4. **Key fields** — match the SAP primary key.
5. **Field names** — exact SAP technical names in CAPS, not paraphrased.

The reviewer returns a YAML `gaps:` list. Each gap is concrete and actionable ("`tables: missing STAS (BOM item alternatives)`", not "consider adding more detail"). Gaps feed into the same `call_llm_fix` repair pathway as schema errors.

## Per-role model routing (ticket 37)

Each agent role can be backed by a different model and provider, configured via env vars or the admin Settings UI:

| Role | Env var | Default | Typical override |
|---|---|---|---|
| Extractor | `MODEL_EXTRACTOR` | `anthropic:claude-opus-4-7` | `openai:meta-llama/Llama-3.3-70B-Instruct@https://api.together.xyz/v1` |
| Reviewer | `MODEL_REVIEWER` | `anthropic:claude-opus-4-7` | `ollama:llama3.1:8b` (free, runs on local Mac) |
| Repair | `MODEL_REPAIR` | `anthropic:claude-opus-4-7` | same as extractor usually |
| Annotation extractor (`extract.py`) | `MODEL_EXTRACT` | `anthropic:claude-sonnet-4-6` | `ollama:qwen2.5:14b` |
| Vision PDF reader | `MODEL_VISION` | `anthropic:claude-opus-4-7` | `ollama:qwen2-vl:7b` |

The abstraction lives in `scripts/llm_clients.py`. Roles are domain-neutral: adding a new agent (say, a polymorphism specialist) is `client_for_role("POLY")` plus a `MODEL_POLY` env var. No code changes needed in the routing layer.

**Why this matters operationally:** the reviewer is the cheapest pass to move local. Same prompt that costs $0.60 on Opus runs free on a Mac mini Ollama. With multi-pass reviewer becoming free, you can afford to run two or three specialized reviewer passes per propose without thinking about cost.

## Vision PDF extraction (ticket 38)

When the operator toggles "Use vision model when extracting from PDFs" in the Settings UI, the pipeline renders each PDF page as a 2x-DPI PNG and sends it to the role routed to `MODEL_VISION` instead of using `pypdf` text extraction. Vision sees the diagram; text extraction sees only prose.

The vision pass produces structured plain text:

```
ENTITY: KLAH (Class)
  pk: CLINT
  columns: CLINT (PK), KLART (FK), KLAGR (FK), CLASS
REL: KLAH -> TCLA  (cardinality: M:1)
  from_columns: KLART
  to_columns:   KLART
POLY: KSSK.OBJEK discriminator=KLART
```

That structured text is then fed to the regular extractor — same prompt, same downstream pipeline. Vision is a better front-end; the agent loop is unchanged. See `docs/DECISIONS.md` #14 for rationale.

## Cost and latency

The pipeline is bounded:

| Step                | Calls (typical) | Calls (worst case) |
|---------------------|-----------------|--------------------|
| Initial extract     | 1               | 1                  |
| Repair (syntax)     | 0               | 2                  |
| Repair (schema)     | 0               | 2                  |
| Reviewer            | 1               | 1                  |
| Repair (gaps)       | 0               | 1                  |
| **Total**           | **2**           | **7**              |

A clean run is 2 calls. A messy run with all retries exhausted is 7. Default model is Opus (high stakes, infrequent runs); reviewer runs once per propose to cap cost.

Each LLM call emits a `usage: input=N output=N model=X` line that the job runner aggregates. The viewer shows running cost (token counts; dollar pricing is a follow-up).

## Agent responsibilities

### Agent 1: Extractor (`call_llm`)

- **Role:** Convert source text to schema-compliant YAML.
- **System prompt:** Documents the YAML shape, naming conventions, polymorphism patterns, and the rule "relationships are the point; table lists are the means." Keep this aligned with `.claude/skills/sap-erd-extraction/SKILL.md`.
- **Output budget:** 32K tokens (Opus full output budget). Set high enough that no SAP domain we know of forces a truncated response.
- **Failure modes:**
  - Truncated output → caught by repair loop.
  - Invented cluster ids → handled by cluster registrar.
  - Paraphrased domain id → handled by domain stamp.
  - Missing relationships → caught by reviewer.

### Agent 2: Cluster registrar (`register_proposed_clusters`)

Not an LLM — a deterministic Python pass. Runs after parse, before schema validation.

- **Role:** Reconcile invented cluster ids with the canonical registry.
- **How:** Diff the YAML's referenced clusters against `clusters.yaml`. For each unknown id, append a stub entry (id, auto-generated name, stable pastel color, placeholder description) to `clusters.yaml`.
- **Why append-only?** Re-emitting `clusters.yaml` via pyyaml strips comments and section dividers. The append preserves all hand-curated structure above; the curator can edit the appended entry later.
- **Why not constrain the LLM to existing clusters only?** Tested; produces worse output. The model overloads existing clusters or skips clustering entirely. Allowing invention + auto-registration is the cleaner contract.

### Agent 3: Reviewer (`call_llm_review`)

- **Role:** Audit the extractor's output against the source for completeness.
- **System prompt:** Different from the extractor's. Frames the role as auditor, not author. Explicit checklist (completeness → relationships → polymorphism → keys → field names). Output format is a YAML `gaps:` list, not a corrected document.
- **Why a separate prompt?** Same model can flip between author and auditor modes when prompted to. The prompts are *role definitions*; the model is the same.
- **Output budget:** 4K tokens (gap lists are short; reviewers should be terse).
- **Run cap:** Once per propose. A reviewer + repair loop without a cap can spiral on edge-case PDFs.

### Agent 4: Repair (`call_llm_fix`)

- **Role:** Take a broken YAML draft + a list of errors and emit a corrected version.
- **System prompt:** Focused on minimal edits. "Apply the smallest changes needed to fix these errors. Preserve every valid field. Do not invent new tables, relationships, or fields. If the input is unparseable, repair the syntax with the smallest edit that makes it parse — do not rewrite or summarize the document."
- **Handles:** YAML syntax errors, JSON schema errors, reviewer gap lists. Same prompt for all three; the error messages disambiguate.
- **Output budget:** 32K (re-emits the entire corrected draft; needs the same headroom as the extractor).
- **Run cap:** Two retries on syntax/schema failures; one repair on reviewer gaps.

## Adding a new agent

When does a new agent earn its place in the pipeline? When you can articulate:

1. **A failure mode the existing agents miss.** Be specific. "Sometimes the descriptions are bad" doesn't qualify; "the extractor consistently misses MOFF foreign keys when the source uses crow's foot notation" does.
2. **A different role.** If your new agent's prompt looks like the extractor's prompt, it's not a new agent — it's a parameter tweak.
3. **A bounded cost contribution.** Run cap, output budget, retry policy. Loops without caps are how you get six-digit Anthropic bills.

The pattern to follow:

```python
def call_llm_<role>(...) -> <result>:
    """Docstring states the role and what gap it fills."""
    system_prompt = """You [role]. [Specific rules and output format.]"""
    user_prompt = f"""[Inputs]"""
    response = client.messages.create(
        model=MODEL,
        max_tokens=<sized to expected output>,
        system=system_prompt,
        messages=[{"role": "user", "content": user_prompt}],
    )
    return _finalize_llm_response(response)
```

Wire it into `extract_with_retry` at the appropriate point in the pipeline. Cap retries. Test with the broken-draft fixtures in `generated/drafts/`.

## Agents we've considered and rejected

- **A second extractor that re-runs the source through a different model.** Rejected: doubles cost without addressing the substance problem. The reviewer is cheaper and more targeted.
- **A "hallucination detector" that cross-references field names against a SAP table dictionary.** Rejected for now: would require shipping a SAP DD lookup. Reviewer + the "field names exact in CAPS" rule covers the high-value cases. Reconsider when we have a structured SAP DD reference.
- **A "consultant simulator" that asks 'would I want to use this?' and rewrites descriptions.** Rejected: scope creep. Description quality is a curator concern, not an extraction concern.

## Future agents

These are documented as roadmap items, not implementation TODOs. Build when there's evidence the existing pipeline is missing them.

- **DOCX extractor.** Same role as the PDF extractor; different input parser. Wire as `extract_docx_text` → existing pipeline.
- **Confluence DOC extractor.** Confluence's `.doc` export is MIME/HTML, not binary Word. Parser is different from DOCX.
- **OCR fallback for scanned PDFs.** When `extract_pdf_text` returns empty/garbage, fall back to OCR (tesseract or Anthropic vision). Add as a pre-extractor pass, not a separate agent.
- **Screenshot extractor.** Image input → vision model → text → existing pipeline.
- **Mermaid generator (interactive).** Already exists as a static script (`scripts/generate_mermaid.py`); a future agent could regenerate on apply or expose live editing.

See [`SKILLS.md`](SKILLS.md) for the corresponding skill roadmap.
