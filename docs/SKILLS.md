# Skills

Skills are reusable, scoped instructions for an LLM. They live under [`.claude/skills/`](../.claude/skills/) and follow the [Claude Code skill convention](https://docs.claude.com/en/docs/claude-code/skills): a directory containing a `SKILL.md` with YAML frontmatter (name + description) and the body of the skill.

Each skill should be self-contained: read it cold and you know when to invoke it, what conventions it encodes, and what the expected output is. Skills are **conventions**, not code — they shape how an LLM thinks about a problem, not what the LLM is allowed to do.

## Why skills here

The propose-domain pipeline encodes SAP-specific conventions (KSSK polymorphism, T-suffix text tables, cluster naming) that initially lived inside `scripts/propose_domain.py`'s system prompt. That worked but was opaque — to read the conventions you had to read Python.

Pulling the conventions into skills gave us:

1. **Reviewable knowledge.** A pull request can change a skill in isolation. Reviewers see exactly what convention changed.
2. **Reusable knowledge.** The same convention applies whether the LLM is running in `propose_domain.py`, in a Claude Code session via `/loop`, or in a colleague's fork.
3. **Forkable knowledge.** A team adapting this for, say, Oracle EBS can fork the skill, swap the polymorphism table, and reuse the rest.

## Current skills

### [`sap-erd-extraction`](../.claude/skills/sap-erd-extraction/SKILL.md)

Used when extracting SAP table relationship models from PDFs, screenshots, or web docs into the curated YAML format.

Encodes:
- The 5-pass extraction algorithm (inventory → cluster → relationships → polymorphism → self-check).
- The polymorphism table: which SAP tables (KSSK, INOB, AUSP, CDPOS, JCDS, STAS) use which discriminators (KLART, OBTAB, OBJECTCLAS, OBJNR prefix, STLTY) to resolve to which target families.
- Cluster naming conventions: short prefixes (`pp_*`, `bom_recipes_*`), not long-domain-id monsters.
- Token budget guidance: trim descriptions before relationships, never the other way around.
- Common antipatterns: inventing field names, skipping cardinality, modeling polymorphism as a single edge.

Used by `scripts/propose_domain.py`'s extractor and reviewer prompts. When this skill changes, the script's prompts need a corresponding update.

### [`sap-erwin-import`](../.claude/skills/sap-erwin-import/SKILL.md)

Used when converting ERWIN data models into the curated YAML. ERWIN is structured; the skill recommends deterministic conversion (no LLM in the structural extraction loop) and documents the four ERWIN export formats (CSV preferred, then XML, then DDL, never the binary `.erwin`).

Includes guidance for detecting SAP polymorphism inside ERWIN exports (typically modeled as N separate FKs that need to be collapsed to `type: polymorphic`).

`scripts/import_erwin.py` is documented in the skill but not yet implemented — wait for a real ERWIN file before scaffolding the parser.

## Next-phase skills (roadmap)

These are documented commitments, not implementation TODOs. Build when there's a concrete need.

The pattern in every case is the same: a new input format → a new skill that captures the parsing conventions → a new (small) Python module that does the format-specific bit → wire into the existing propose pipeline.

| Skill                          | Status      | Notes                                                                                                                       |
|--------------------------------|-------------|-----------------------------------------------------------------------------------------------------------------------------|
| `pdf-to-markdown`              | Partial     | `extract.py` does PDF text extraction (PyMuPDF). Gap: OCR fallback for scanned PDFs. Promote to a skill when OCR lands.     |
| `pdf-to-markdown-ocr`          | Roadmap     | Tesseract or Anthropic vision when text extraction returns empty/garbage. Triggers automatically; user shouldn't pick.      |
| `docx-to-markdown`             | Roadmap     | Word XML → markdown. Preserve hyperlinks, convert embedded diagrams to Mermaid where possible, extract images to assets.    |
| `confluence-doc-to-markdown`   | Roadmap     | Confluence's `.doc` export is MIME/HTML, not binary Word. Different parser from DOCX; common output (markdown).             |
| `screenshot-to-markdown`       | Roadmap     | Image → vision model → text → existing pipeline. Useful for ERDs that only exist as images in slide decks.                  |
| `markdown-to-pdf`              | Roadmap     | Renders Mermaid + LaTeX correctly. Outputs documents consultants can share with clients. pandoc + mermaid-cli is one path.  |
| `markdown-to-docx`             | Roadmap     | Same destination, different format. pandoc handles this; the skill captures style/template conventions.                     |
| `mermaid-diagrams`             | Partial     | `scripts/generate_mermaid.py` renders static SVGs from a domain YAML. Gap: live re-generation on apply, embed in viewer.    |

### Why "skill" not "script"

Some of these (mermaid generation, PDF text extraction) are already partly implemented as Python scripts. Why frame the future work as skills?

A script is a fixed transformation. A skill is a contract about how an LLM should approach a problem. Most of the future work has both:

- A **deterministic** part — parse the file format, extract the structure. That's a script.
- A **judgement** part — decide what's relevant, choose names, infer relationships from prose, write descriptions a consultant will actually read. That's an LLM, and the skill is what keeps it grounded.

The propose-domain pipeline is the template: PDF text extraction is deterministic (`extract.py`), domain extraction is LLM-driven and skill-shaped (`sap-erd-extraction`). New input formats follow the same split.

### How to add a skill

1. **Create the directory.** `.claude/skills/<skill-name>/SKILL.md`.
2. **Frontmatter.** `name`, `description`. The description is critical — it's what the model uses to decide whether to invoke the skill. Include trigger phrases.
3. **Body.** Self-contained. When to use, when not to use, the conventions that matter, the antipatterns to avoid, what the output should look like.
4. **Wire it in.** If the skill is invoked from the propose pipeline, reference it in the relevant prompt. If it's invoked manually in a Claude Code session, `description` is enough.
5. **Test.** Run the skill end-to-end on a real input. Skills that haven't been exercised against real data are aspirations, not skills.

## Multi-skill orchestration

When multiple skills are in play, the agent that invokes them is responsible for the workflow. There's no central orchestrator yet — and there shouldn't be one until there's evidence we need it. The propose-domain pipeline is the orchestration: extract.py picks the right text extractor, propose_domain.py picks the right system prompt (which in turn references the right skill).

If the pipeline grows beyond two or three input formats and three or four agents, revisit. Until then: keep skills small, keep the script-glue minimal, and let the pipeline shape the orchestration.

## Skill review

Skills should be reviewed quarterly or when the underlying conventions change (e.g., S/4HANA introduces new tables and the polymorphism table shifts). Reviews check:

- **Does the skill still match reality?** SAP changes; skills should follow.
- **Is the description still triggering correctly?** Skills that fire too often or never fire need description tuning.
- **Are the antipatterns still antipatterns?** Sometimes what we called a smell becomes idiomatic.

The default reviewer is the maintainer of the script that invokes the skill. For SAP skills, that's whoever owns `propose_domain.py`.
