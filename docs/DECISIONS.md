# Design decisions

This document records the load-bearing decisions in the SAP Knowledge Base — the ones that, if reversed, would silently break things or require migrating committed content. Each decision lists the rule, the rationale, and what we'd do differently if we were starting today.

The header rules (1–5) are also enforced in `CLAUDE.md` and CI — they're locked, not aspirational.

---

## 1. The YAML format is locked at v0.2

**Rule:** Don't change the schema (`schema.json`) without bumping `format_version` in every domain file simultaneously.

**Why:** Domain files are committed knowledge. A breaking schema change without a version bump means every file is silently invalid until rewritten. A version bump is a deliberate migration event with a known cost.

**What "breaking" means here:** removing a required field, renaming a field, changing the type of a field, restructuring the relationship blocks. Adding optional fields is non-breaking and can ship without a version bump.

**Migration path if we ever need v0.3:** Write a script that reads v0.2 files and emits v0.3 files. Run on every domain. Bump `format_version` in the schema and in each file in the same commit. Update the viewer to handle both versions during the rollout window.

**Today's lesson:** would still do this. The YAML format is the long-lived artifact; the viewer and pipeline are replaceable.

---

## 2. Curated knowledge and user data live in different stores

**Rule:** YAML for curated content. SQLite for votes, comments, edit history, annotations. Never mix.

**Why:** The two have fundamentally different lifecycles:

- Curated content changes via pull request. It's reviewed. It's diff-able. Nobody can change `domains/classification.yaml` without leaving a record visible in `git log`.
- User data changes by the second. It needs queryable state, indexes, atomic writes. Putting it in YAML would either flood git with non-content commits or lose the audit trail.

**The tempting shortcut:** "Just add a `votes:` block to each table in the YAML and call it done." Resist. Within a month you'd have either (a) thousands of YAML commits no human cares about, or (b) a YAML file the app silently rewrites without going through review. Both are bad.

**The promotion path:** A user-submitted annotation lives in SQLite as `status: proposed`. A maintainer reviews it. If accepted, a "promote to YAML" action generates a PR that adds the annotation to the relevant domain file. The PR goes through review. After merge, the SQLite record's status flips to `promoted` and points at the YAML location.

**Today's lesson:** would still do this. The split is the single most important structural decision in the repo.

---

## 3. Cluster references must resolve

**Rule:** Every `cluster:` value in a domain YAML must exist in `clusters.yaml`. CI enforces this via `scripts/check_cluster_refs.py`.

**Why:** Clusters are the visual grouping for ERDs. A typo in a cluster id silently breaks rendering — the orphan table appears in its own group instead of the intended cluster. By the time someone notices, the typo has been copied into 5 other domains.

**The propose-pipeline wrinkle:** the LLM extractor sometimes invents clusters that follow the convention (`pp_bom`, `bom_recipes_resources`) but aren't yet registered. Failing the validator on these would block every propose run. Instead, `register_proposed_clusters` in `scripts/propose_domain.py` auto-registers any new clusters before the validator runs. The locked rule still holds at the moment of apply — the clusters exist because we just registered them.

**Why append-only writes to `clusters.yaml`:** see decision #5.

**Today's lesson:** would still do this. The auto-registration is the right escape valve; without it the validator and the LLM are pulling in opposite directions.

---

## 4. Polymorphic relationships render as N edges

**Rule:** When one column resolves to different target tables based on a discriminator (KSSK.OBJEK by KLART, CDPOS.TABKEY by OBJECTCLAS, JCDS.OBJNR by prefix), model as `type: polymorphic` with `object_resolution[]` — and render as N edges, one per resolution target, each labeled with the discriminator value.

**Why:** A naive renderer collapses all the polymorphism into a single edge with a generic label like "OBJEK → various." That edge is useless to a consultant. They need to know: "if `KLART = '022'`, the target is `MARA` via INOB; if `KLART = '001'`, the target is `KLAH` directly." That's a different join, different SQL, different gotchas.

**The mistake to avoid:** modeling polymorphism as a single relationship in the YAML. The schema *allows* this (`from`/`to` are valid for any relationship), but the result is that the renderer can't reconstruct the resolution map. Use `type: polymorphic` always when the source data is polymorphic.

**Today's lesson:** would still do this. Polymorphism is a load-bearing concept in SAP; if you compromise here you compromise everywhere downstream.

---

## 5. Round-trip safety on writes

**Rule:** When writing YAML programmatically, preserve comments and ordering. Never re-emit a hand-curated YAML file from a generic serializer.

**Why:** `clusters.yaml`, `domains/*.yaml`, and the schema file all have hand-written comments — section dividers, inline explanations, "TODO: remove when X" notes. A naive `yaml.safe_dump(data)` round trip strips every comment. The diff after a single auto-write is hundreds of lines of unrelated formatting changes that obscure the actual content change.

**Two approaches that work:**

- **AST-based round-trip** (used by the viewer's admin inline edit). The `yaml` library (eemeli/yaml) parses to an AST; `setIn(["domain", "description"], "new text")` modifies one node; serializing back preserves everything else. Tested before shipping admin edits.
- **Append-only writes** (used by `register_proposed_clusters` for `clusters.yaml`). New cluster entries are appended to the end of the file as plain text. The existing content above is byte-for-byte unchanged. No round-trip risk because there's no parse-then-emit cycle.

**The mistake to avoid:** using pyyaml `safe_load` + `safe_dump` to "update" a hand-curated YAML file. It's tempting because the API is one-line. The diff will look terrible and the curator will hate you.

**Today's lesson:** would still do this. The two-strategy split (AST for inline edits, append-only for additive registrations) is a clean separation that handles every case we've hit.

---

## 6. SAP-specific by design

**Rule:** Don't generalize for "any ERP." The schema, the polymorphism table, the cluster naming conventions are SAP-specific.

**Why:** "Generic ERP knowledge base" is a tar pit. The polymorphism patterns in SAP (KSSK/INOB, classification compounds, change docs via OBJECTCLAS) don't match Oracle EBS or Workday or NetSuite. Forcing a generic abstraction either (a) loses SAP-specific structure or (b) bolts on enough escape hatches that the abstraction stops paying for itself.

**Forks for other ERPs are encouraged.** A team adapting this for Oracle EBS should fork, swap the polymorphism table in `sap-erd-extraction`, rewrite the cluster registry for Oracle's conventions, and keep the rest. The architecture doesn't change; the conventions do.

**Today's lesson:** would still do this. Resisting premature generalization is one of the things that lets this repo stay small and useful.

---

## 7. Multi-agent over single-agent for extraction

**Rule:** The propose-domain pipeline uses a separate reviewer agent with a different prompt. Single-LLM extract-then-validate caught shape errors but missed substance errors (missing tables, missing relationships, mis-modeled polymorphism).

**Why:** A model in author mode misses things a model in auditor mode catches. The roles are different prompts, not different models — same Opus instance, two prompts, two passes. See [`AGENTS.md`](AGENTS.md) for the full architecture.

**Cost contract:** clean run is 2 LLM calls; worst case is 7. Each call emits `usage: input=N output=N model=X` for aggregation.

**The temptation:** "Just give the extractor a better prompt." Tried it. Better prompts shift the omissions, they don't eliminate them. The reviewer pass catches what the extractor's biases consistently miss, regardless of prompt tuning.

**Today's lesson:** would still do this. Cap the reviewer at one pass per propose so it can't loop on edge cases. Document which agents exist and what each owns (done; see [`AGENTS.md`](AGENTS.md)).

---

## 8. 32K output token budget on extract and repair

**Rule:** Extractor and repair LLM calls use `max_tokens=32000` (Opus's full output budget). Reviewer uses 4K (output is just a gap list).

**Why:** SAP domains vary wildly in size. The classification domain has 21 tables. BOM/Recipes/Routing/Engineering has 21+ tables with relationships and polymorphism. A single `max_tokens` value sized for the median means the long-tail domains truncate, miss `relationships:`, and require a full re-run. Output cost is dominated by token count regardless of budget — paying for one complete pass beats paying for a partial pass plus a resume.

**Why not chunked / windowed extraction?** Two reasons. First, the SAP domains we know about all fit in 32K. Second, chunking would require splitting the source text and merging the outputs, which introduces a whole new class of bug (relationships across chunks) that doesn't pay for itself until we hit a domain that genuinely doesn't fit.

**Streaming is required at this budget.** The Anthropic SDK refuses any non-streaming `messages.create` call whose estimated runtime exceeds 10 minutes — at 32K Opus output, that includes most full-domain extractions. Both `call_llm` and `call_llm_fix` use `client.messages.stream(...)` as a context manager and call `stream.get_final_message()` for the same `Message` shape the rest of the pipeline expects. The reviewer (4K budget) stays non-streaming.

**Today's lesson:** would still do this. The "size for the worst case" decision was made after two domains hit truncation; we didn't pick 32K out of caution.

---

## 9. Append-only `clusters.yaml` registration over re-emit

**Rule:** When `register_proposed_clusters` adds new cluster entries, it appends text to the end of the file. It does not parse and re-emit.

**Why:** `clusters.yaml` is hand-curated with section dividers, comments explaining the naming convention, and a top-of-file rationale. A pyyaml round-trip strips all of it. Append-only writes preserve every byte above the new entries.

**Trade-off:** the appended entries don't get sorted into the existing sections (cross-domain vs domain-specific). The auto-comment marks them as auto-registered with a date so a curator can sort them later if it matters. So far it hasn't.

**Today's lesson:** would still do this. The trade-off is real but tiny; the alternative (re-emit) is unbearable for review-driven workflows.

---

## 10. Subprocesses for long-running jobs, not a worker queue

**Rule:** Propose-domain runs as a detached subprocess with disk-backed state in `generated/jobs/<jobId>/`. No BullMQ, no pg-boss, no Redis.

**Why:** Anthropic calls take 30s–4min. Next.js HMR was wiping in-memory job state during dev, leaving 4-minute Anthropic spends untraceable. The fix that landed: persist `meta.json` and `log.ndjson` to disk, scan on module load, mark non-terminal orphans as errored.

**Why not a real queue?** A queue solves multi-instance hosting. We don't have multi-instance hosting. Adding a queue now means provisioning Redis (or Postgres NOTIFY, or whatever) for a problem we don't have.

**When to switch:** when we deploy to two or more nodes that share the curated content, or when we want time-of-day scheduling for ingestion. Not before. The interface (`lib/jobs.ts`) is small enough that swapping the storage layer is a one-day job.

**Today's lesson:** would still do this. "Subprocess + disk-backed records" is the simplest thing that survives HMR and supports observability.

---

## 11. Email-magic-link auth, with admin as an email allowlist

**Rule:** NextAuth handles sign-in. Admin privileges (inline edits, apply drafts) are a static email allowlist in env config.

**Why:** The repo doesn't have a multi-tenant audience yet. Two-or-three trusted admins is the deployment model. SSO and role hierarchies can be added if Capgemini-internal hosting requires; the auth interface (`lib/auth.ts`) is one file.

**Why not "any signed-in user can edit"?** The whole point of curated content is that not everyone can edit. Inline edits write directly to disk; the admin gate is what keeps that contract.

**Today's lesson:** would still do this. The bigger investment when this scales is going to be in the annotation review workflow (Phase 4), not in the auth system.

---

## 12. Detached subprocesses with file-based stdio + exit-code sentinel

**Rule:** Long-running LLM jobs (propose-domain, ingest) spawn as `sh -c "python3 …; echo $? > exit.code"` with `detached: true`, stdio redirected to `stdout.log`/`stderr.log` files (not parent pipes), and `child.unref()`. A poll-based file tailer in the parent reads new bytes from those files and feeds them through the existing `append()` → SSE pipeline.

**Why:** Previously the subprocess was spawned with default pipe-based stdio and `detached: false`. Two failure modes:

1. **HMR-during-job.** Editing `lib/jobs.ts` (or, more rarely, anything that triggered a Next.js full restart) killed the Node parent, which SIGTERM'd its children. A 4-minute Anthropic call vanished, taking ~6K tokens of spend with it. The user hit this multiple times in dev.
2. **Pipe-close-on-parent-exit.** Even if we'd just added `detached: true`, the parent's stdio pipes were still owned by the parent. When the parent exited, those pipes closed; the next subprocess write raised EPIPE; the child crashed.

The current architecture solves both: the OS holds the file descriptors for `stdout.log`/`stderr.log`, the subprocess is in its own process group (so SIGTERM doesn't propagate from the dying parent), and `unref()` lets the parent exit independently. The shell wrapper is what makes recovery possible — without `exit.code` the parent would never know if a subprocess that finished while we were down succeeded or failed.

**Why a file tailer instead of `child.stdout`?** Because once the parent dies, `child.stdout` is gone — there's no event listener anymore, the child object is collected, the in-memory log stops growing. The tailer reads from the on-disk `stdout.log` so a *new* parent (after restart) can resume tailing exactly where the old parent left off, using a persisted byte offset in `meta.json`. No lost lines, no duplicates.

**Why `setInterval` not `fs.watch`?** Cross-platform reliability. `fs.watch` has well-documented edge cases on macOS (especially with networked file systems) and Windows. A 400ms poll is invisible cost-wise for a multi-minute job and fails predictably.

**Trade-off / mistake to avoid:** It's tempting to "just" put the heavy work behind a queue (BullMQ, pg-boss). Don't, yet — that's solving multi-instance hosting, not the dev-HMR problem. The detached-subprocess + file-tailer pattern is the smaller, more durable answer for a single-deployment internal tool.

The other tempting mistake: piping subprocess stdio to *both* the parent (for live SSE) and a file (for survival). Node's `stdio` config doesn't naturally support tee'ing without an intermediate process; trying to fake it produces buggy state. Stick to file-only stdio + tailer.

**What this enables:**
- Editing files in `web/` no longer kills in-flight LLM runs.
- The PID is on the Job record, which is exactly the hook needed to add a "Cancel run" button later (`process.kill(pid, 'SIGTERM')`).
- A future "view raw stdio" UI is trivial — the files are right there.

**Today's lesson:** would still do this. The fix took maybe 200 lines of TypeScript across `lib/jobs.ts` and zero changes to the Python scripts. Compared to introducing a queue dependency, this is the right size of solution for the problem.

---

## 13. Per-role model routing (Anthropic + OpenAI-compatible)

**Rule:** Each agent role in the multi-agent pipeline (extractor, reviewer, repair, annotation extractor, vision) is independently routable to either an Anthropic model or any OpenAI-compatible endpoint (Ollama, LM Studio, Together, Fireworks, vLLM, HuggingFace Inference Endpoints). Routing is configured via `MODEL_<ROLE>` env vars or the admin Settings UI; defaults preserve the previous Anthropic-only behavior.

**Why:** Two pressures pushed us off single-provider:

1. **Cost.** Opus 4.7 at 32K output runs ~$2.30 per extractor call. The reviewer and annotation extractor are well within the capability of 8B–32B local models running free on Ollama, but the original code hard-coded the Anthropic SDK at three call sites.
2. **Capability fit per role.** The extractor needs maximum capability (high-stakes structured output of an entire domain). The reviewer is a structured comparison task ("does YAML match source?") that doesn't need Opus-tier. Forcing them onto the same model wastes cost on the reviewer and risks under-capability on the extractor.

**The abstraction:** `scripts/llm_clients.py` exposes one `LLMClient` interface with `complete(system, user, max_tokens)` and `complete_with_image(...)`. Two implementations: `AnthropicLLMClient` and `OpenAICompatLLMClient`. A spec parser (`anthropic:<model>`, `ollama:<model>`, `openai:<model>@<base_url>`) lets the operator pick a backend per role without code changes.

**Why URI-style specs over separate env vars per provider/host/key:** Three env vars per role × five roles = 15 vars to set. One spec string per role = 5 vars. The URI shape is denser to set, easier to copy-paste between machines, and the parser fails loud on malformed strings.

**Why a small SAP_KNOWN_PKS lookup in the ERWIN parser is fine but not here:** Earlier (ticket 36 ERWIN POC) I encoded SAP-specific knowledge in a Python dict. That's OK for a domain-specific extractor. The model-routing abstraction is the opposite — it should be entirely domain-neutral so this code can be lifted into other ERP forks.

**Trade-off / mistake to avoid:** The OpenAI SDK is a hefty dep just to call an OpenAI-compatible endpoint, but writing that HTTP client by hand would mean re-implementing streaming SSE, usage parsing, vision content blocks. We let the dep land. If the dep weight ever matters, the alternative is `requests` + a hand-rolled SSE iterator — feasible but tedious.

**What this enables:**
- The reviewer pass on Llama 3.1 8B (Ollama, M4 Pro 24GB) costs $0/run vs ~$0.60/run on Opus.
- A/B testing different extractor models is one settings change away.
- Sensitive content can be processed entirely on local hardware via Ollama (no Anthropic API call).
- Future roles (e.g., a structured-output validator) plug in via the same `client_for_role(...)` call.

**Today's lesson:** would still do this. The cost of the abstraction is tiny — one new file (`llm_clients.py`), three call sites refactored. The optionality unlocked is large.

---

## 14. Vision PDF extraction (opt-in)

**Rule:** When `VISION_PDF_ENABLED=1` (set by the admin Settings UI's "Use vision model when extracting from PDFs" toggle), the propose-domain and ingest pipelines render each PDF page as PNG and send it to the model routed to `MODEL_VISION` instead of using `pypdf` text extraction. Off by default.

**Why:** SAP ERDs are spatial. Boxes, arrows, crow's feet, KLART value labels — all of those carry information that `pypdf`'s text extraction collapses into prose. The LLM downstream then has to infer relationships from prose ordering, which is unreliable. Tested with `domains/classification.yaml`-class PDFs: text-only extraction misses ~15% of relationships and most cardinality. Vision-based extraction recovers them because the model sees the actual diagram.

**Why opt-in:** Higher cost per page. ~3K tokens of image input per page on Anthropic. A 30-page PDF runs $1–3 in vision input alone. Worth it for diagram-heavy ERDs; wasted for prose-heavy reference docs (where `pypdf` is fine and free).

**Why a structured-text prompt and not "describe this image":** The vision pass produces ENTITY/REL/POLY blocks of plain text. The downstream extractor (the same `call_llm` from `propose_domain.py`) reads that plain text exactly the same way it reads `pypdf` output — same prompt, same schema, same retry loop. The vision model's job is to translate diagram structure into structured text the extractor already knows how to handle. Avoids changing the rest of the pipeline.

**Trade-off / mistake to avoid:** It's tempting to use the vision model end-to-end (one call: PDF page → final YAML chunk). Resist. The current pipeline has battle-tested cluster registration, schema validation, reviewer pass, and repair loops. Cutting all of that in favor of one big vision call would lose those guardrails. Vision is just a better text-extraction front-end; the agent loop downstream is what makes the output trustworthy.

**Local vision options on M4 Pro 24GB:** Qwen 2 VL 7B (`ollama:qwen2-vl:7b`) and LLaVA 13B both fit comfortably. The bigger 70B+ vision models (Qwen 2.5 VL 72B, Llama 3.2 90B Vision) need 64GB+. Anthropic Opus with vision is the quality reference if local doesn't cut it.

**Today's lesson:** would still do this. The implementation is small (one new helper in `extract.py`, one new method on each `LLMClient` subclass) and the quality lift on diagram-heavy sources is substantial.

---

## How to add a decision here

When you make a load-bearing decision — one that, if reversed, would silently break things or require migration — append a section. Keep the format:

1. **Rule** — one sentence.
2. **Why** — the actual reason, not a sanitized version. If the reason is "we tried X and it didn't work," say that.
3. **Trade-off / mistake to avoid** — what's tempting but wrong.
4. **Today's lesson** — would you still do this if starting fresh? If no, document the migration path.

Decisions that are "obviously correct" don't need an entry. Decisions that someone will be tempted to reverse a year from now do.
