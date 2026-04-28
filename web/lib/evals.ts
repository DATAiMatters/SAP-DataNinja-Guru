import "server-only";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

const REPO_ROOT = resolve(process.cwd(), "..");
const EVALS_DIR = join(REPO_ROOT, "generated", "evals");

/** Shape mirrors what scripts/eval_extraction.py writes to disk. */
export interface Scorecard {
  // The filename stem (e.g. "classification-20260428T024558") used as
  // the URL-safe id throughout the viewer.
  id: string;
  domain_id: string;
  candidate_path: string;
  truth_path: string;
  timestamp: string;
  config: string;
  overall_score: number;
  weights: Record<string, number>;

  schema_validity: {
    valid: boolean;
    error_count: number;
    errors: string[];
    score: number;
  };
  entities: {
    candidate_count: number;
    truth_count: number;
    matched_count: number;
    matched: string[];
    missed: string[];
    extra: string[];
    score: number;
  };
  relationships: {
    candidate_count: number;
    truth_count: number;
    matched_count: number;
    matched: [string, string][];
    missed: [string, string][];
    extra: [string, string][];
    score: number;
  };
  polymorphism: {
    truth_polymorphic_count: number;
    candidate_polymorphic_count: number;
    polymorphism_present_score: number;
    target_coverage_score: number;
    detail: Array<{
      from_table: string;
      polymorphism_detected: boolean;
      truth_targets: string[];
      candidate_targets?: string[];
      matched_target_count?: number;
    }>;
  };
  field_names: {
    per_entity: Array<{
      id: string;
      candidate_count: number;
      truth_count: number;
      matched_count: number;
      missed: string[];
      score: number;
    }>;
    total_truth_fields: number;
    total_matched_fields: number;
    score: number;
  };
  clusters: {
    with_cluster: number;
    total: number;
    score: number;
  };
}

/**
 * List every scorecard JSON in generated/evals/, parsed and sorted by
 * timestamp descending (most recent first). Returns [] if the dir
 * doesn't exist yet — typical on a fresh install before any propose
 * runs.
 */
export function listScorecards(): Scorecard[] {
  if (!existsSync(EVALS_DIR)) return [];
  let entries: string[];
  try {
    entries = readdirSync(EVALS_DIR);
  } catch {
    return [];
  }
  const cards: Scorecard[] = [];
  for (const f of entries) {
    if (!f.endsWith(".json")) continue;
    const id = f.slice(0, -".json".length);
    const card = readScorecard(id);
    if (card) cards.push(card);
  }
  return cards.sort((a, b) =>
    b.timestamp.localeCompare(a.timestamp),
  );
}

/**
 * Read one scorecard by id (filename stem). Returns null if the file
 * doesn't exist or fails to parse — the page handler turns null into
 * a 404, which is the right behavior for a stale link.
 */
export function readScorecard(id: string): Scorecard | null {
  // Path-traversal guard: the id flows from URL params, so refuse
  // anything containing path separators or parent refs.
  if (id.includes("/") || id.includes("..") || id.includes("\\")) {
    return null;
  }
  const path = join(EVALS_DIR, `${id}.json`);
  if (!existsSync(path)) return null;
  try {
    const raw = readFileSync(path, "utf-8");
    const parsed = JSON.parse(raw) as Omit<Scorecard, "id">;
    return { ...parsed, id };
  } catch {
    return null;
  }
}

/**
 * Group a flat scorecard list by domain_id, preserving the order
 * within each group (already date-desc from listScorecards). Useful
 * for the index page's "history per domain" rendering.
 */
export function groupByDomain(
  cards: Scorecard[],
): Map<string, Scorecard[]> {
  const out = new Map<string, Scorecard[]>();
  for (const c of cards) {
    const list = out.get(c.domain_id) ?? [];
    list.push(c);
    out.set(c.domain_id, list);
  }
  return out;
}

/**
 * Compute deltas between two scorecards on the same domain. Returns
 * `null` if the domain ids don't match — the comparison wouldn't make
 * sense across domains.
 */
export function diffScorecards(
  base: Scorecard,
  candidate: Scorecard,
): {
  overall: number;
  axes: Record<string, number>;
} | null {
  if (base.domain_id !== candidate.domain_id) return null;
  return {
    overall: candidate.overall_score - base.overall_score,
    axes: {
      entities: candidate.entities.score - base.entities.score,
      relationships:
        candidate.relationships.score - base.relationships.score,
      polymorphism_present:
        candidate.polymorphism.polymorphism_present_score -
        base.polymorphism.polymorphism_present_score,
      polymorphism_targets:
        candidate.polymorphism.target_coverage_score -
        base.polymorphism.target_coverage_score,
      field_names: candidate.field_names.score - base.field_names.score,
      clusters: candidate.clusters.score - base.clusters.score,
    },
  };
}
