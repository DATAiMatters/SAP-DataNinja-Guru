import "server-only";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const REPO_ROOT = resolve(process.cwd(), "..");
const SETTINGS_PATH = join(REPO_ROOT, "generated", "settings.json");

/**
 * App-level settings that don't belong in the curated YAML or in env
 * vars (they're per-machine and toggleable via the admin UI).
 *
 * Persisted to generated/settings.json (gitignored). When jobs.ts spawns
 * the propose / extract subprocess, it reads these and projects them
 * onto the subprocess env (MODEL_EXTRACTOR, MODEL_REVIEWER, etc.) so
 * the Python scripts pick them up via llm_clients.client_for_role().
 */
export interface AppSettings {
  /** Model spec strings per role. Format documented in scripts/llm_clients.py:
   *  anthropic:<model>            — Anthropic API
   *  ollama:<model>               — local Ollama (localhost:11434 by default)
   *  openai:<model>@<base_url>    — any OpenAI-compatible endpoint
   *
   *  Empty string = use the script's built-in default.
   */
  modelExtractor: string;
  modelReviewer: string;
  modelRepair: string;
  modelExtract: string; // for scripts/extract.py annotation flow
  modelVision: string; // for ticket 38 vision PDF extraction

  /** When true, propose / ingest pipelines render PDF pages as images
   *  and send to a vision model instead of using pure text extraction.
   *  Big quality win for diagram-heavy SAP ERDs (the spatial structure
   *  is preserved). Costs more per page; off by default. */
  visionPdfEnabled: boolean;

  /** Override host for the `ollama:` shortcut. If unset, localhost:11434.
   *  Useful when Ollama runs on a different machine on the LAN. */
  ollamaHost: string;
}

export const DEFAULT_SETTINGS: AppSettings = {
  modelExtractor: "",
  modelReviewer: "",
  modelRepair: "",
  modelExtract: "",
  modelVision: "",
  visionPdfEnabled: false,
  ollamaHost: "",
};

function ensureDir(): void {
  try {
    mkdirSync(dirname(SETTINGS_PATH), { recursive: true });
  } catch {
    // permission errors etc. — readSettings handles missing file gracefully
  }
}

export function readSettings(): AppSettings {
  if (!existsSync(SETTINGS_PATH)) return { ...DEFAULT_SETTINGS };
  try {
    const raw = readFileSync(SETTINGS_PATH, "utf-8");
    const parsed = JSON.parse(raw) as Partial<AppSettings>;
    // Merge over defaults so a missing key in the file (e.g., new field
    // added in a later ticket) doesn't crash the read.
    return { ...DEFAULT_SETTINGS, ...parsed };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function writeSettings(settings: AppSettings): void {
  ensureDir();
  // Atomic-ish: write to a temp file then rename. JSON.stringify with
  // indent so the file is human-readable / hand-editable.
  const tmp = SETTINGS_PATH + ".tmp";
  writeFileSync(tmp, JSON.stringify(settings, null, 2) + "\n");
  // node:fs renameSync via writeFileSync chain not available; use the
  // sync API directly.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { renameSync } = require("node:fs") as typeof import("node:fs");
  renameSync(tmp, SETTINGS_PATH);
}

/**
 * Project the user's settings onto a child-process env so the Python
 * subprocess picks them up via os.environ.get(...). Only sets keys for
 * non-empty values so the defaults in llm_clients.DEFAULT_MODEL_SPEC
 * still win for any role the user hasn't customized.
 */
export function settingsToEnv(settings: AppSettings): Record<string, string> {
  const env: Record<string, string> = {};
  if (settings.modelExtractor) env.MODEL_EXTRACTOR = settings.modelExtractor;
  if (settings.modelReviewer) env.MODEL_REVIEWER = settings.modelReviewer;
  if (settings.modelRepair) env.MODEL_REPAIR = settings.modelRepair;
  if (settings.modelExtract) env.MODEL_EXTRACT = settings.modelExtract;
  if (settings.modelVision) env.MODEL_VISION = settings.modelVision;
  if (settings.ollamaHost) env.OLLAMA_HOST = settings.ollamaHost;
  if (settings.visionPdfEnabled) env.VISION_PDF_ENABLED = "1";
  return env;
}
