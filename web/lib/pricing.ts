// Anthropic API rate table for cost-in-dollars display alongside token
// counts. Rates are per million tokens, current as of mid-2026 — keep
// these in sync with the Anthropic pricing page when you renew context.
//
// We do exact-match lookup first, then prefix-fall-through so a forward
// version (e.g. claude-opus-5) inherits the family's rate until we
// learn otherwise. Returns null for unknown models so the UI can
// render "—" instead of a misleadingly-confident $0.00.

export interface ModelRate {
  /** USD per million input tokens. */
  input: number;
  /** USD per million output tokens. */
  output: number;
}

const MODEL_RATES: Record<string, ModelRate> = {
  // Opus family — premium tier; what propose_domain.py uses.
  "claude-opus-4-7": { input: 15.0, output: 75.0 },
  "claude-opus-4-6": { input: 15.0, output: 75.0 },
  "claude-opus-4": { input: 15.0, output: 75.0 },

  // Sonnet — mid tier; balance of cost and capability.
  "claude-sonnet-4-7": { input: 3.0, output: 15.0 },
  "claude-sonnet-4-6": { input: 3.0, output: 15.0 },
  "claude-sonnet-4": { input: 3.0, output: 15.0 },

  // Haiku — cheapest tier; good for high-volume annotation work.
  "claude-haiku-4-7": { input: 0.8, output: 4.0 },
  "claude-haiku-4": { input: 0.8, output: 4.0 },
};

/**
 * Look up the per-million-token rate for a model. Falls back to
 * prefix matching on the model family before giving up — so a model
 * we haven't catalogued yet (e.g. claude-opus-5) still produces a
 * sensible estimate as long as Anthropic's family pricing holds.
 */
export function rateFor(model: string): ModelRate | null {
  if (MODEL_RATES[model]) return MODEL_RATES[model];
  if (model.startsWith("claude-opus")) return { input: 15.0, output: 75.0 };
  if (model.startsWith("claude-sonnet")) return { input: 3.0, output: 15.0 };
  if (model.startsWith("claude-haiku")) return { input: 0.8, output: 4.0 };
  return null;
}

/**
 * Compute the dollar cost of a job's token usage. Returns null when the
 * model is unknown (caller should render "—") so we never show a wrong
 * number with confidence.
 */
export function computeCost(usage: {
  inputTokens: number;
  outputTokens: number;
  model: string;
}): number | null {
  const rate = rateFor(usage.model);
  if (!rate) return null;
  return (
    (usage.inputTokens / 1_000_000) * rate.input +
    (usage.outputTokens / 1_000_000) * rate.output
  );
}

/**
 * Format a dollar amount for display. Sub-cent amounts get more
 * precision so a small job doesn't render as "$0.00" — that's the
 * misleading-confidence failure mode.
 */
export function formatCost(usd: number | null): string {
  if (usd == null) return "—";
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  if (usd < 1) return `$${usd.toFixed(3)}`;
  return `$${usd.toFixed(2)}`;
}
