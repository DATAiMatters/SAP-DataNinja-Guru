import Link from "next/link";
import { auth } from "@/auth";
import { groupByDomain, listScorecards, type Scorecard } from "@/lib/evals";

export const dynamic = "force-dynamic";

// Index page for the eval scorecards. Signed-in only — the config
// strings can mention local Ollama hostnames and are mildly
// confidential. Scorecards persist to generated/evals/ from the
// scripts/eval_extraction.py CLI; this page just reads them.
export default async function EvalsIndexPage() {
  const session = await auth();
  if (!session?.user) {
    return (
      <div>
        <PageHeader />
        <div className="card card-padded" style={{ maxWidth: 480 }}>
          <p style={{ margin: 0 }}>
            <Link href="/sign-in?callbackUrl=/evals">Sign in</Link> to view
            extraction evals.
          </p>
        </div>
      </div>
    );
  }

  const cards = listScorecards();
  const byDomain = groupByDomain(cards);

  return (
    <div>
      <PageHeader />
      {cards.length === 0 ? (
        <div className="card card-padded" style={{ maxWidth: 720 }}>
          <p style={{ margin: 0 }}>
            No eval scorecards yet. Run{" "}
            <code>scripts/eval_extraction.py --candidate &lt;yaml&gt; --truth &lt;yaml&gt;</code>{" "}
            to produce one. Output goes to{" "}
            <code>generated/evals/</code>.
          </p>
          <p>
            See{" "}
            <Link href="https://github.com/DATAiMatters/SAP-DataNinja-Guru/blob/main/docs/EVALS.md">
              docs/EVALS.md
            </Link>{" "}
            for the methodology.
          </p>
        </div>
      ) : (
        <>
          {Array.from(byDomain.entries()).map(([domain, list]) => (
            <DomainSection key={domain} domain={domain} cards={list} />
          ))}
        </>
      )}
    </div>
  );
}

function PageHeader() {
  return (
    <div className="page-header">
      <nav className="breadcrumb" aria-label="Breadcrumb">
        <span>Curate</span>
        <span className="breadcrumb-sep">›</span>
        <span>Evals</span>
      </nav>
      <h1>Evals</h1>
      <p className="muted" style={{ margin: 0, maxWidth: 720 }}>
        Extraction quality scorecards. Each row is one run of{" "}
        <code>eval_extraction.py</code> against a curated{" "}
        <code>domains/*.yaml</code>. Use this to A/B compare routing
        configs, track regressions, and validate that local-model
        substitutions don&apos;t lose ground.
      </p>
    </div>
  );
}

function DomainSection({
  domain,
  cards,
}: {
  domain: string;
  cards: Scorecard[];
}) {
  // Most recent first; the rest become "earlier runs" we can diff against.
  const latest = cards[0];
  return (
    <section className="entity-section">
      <h2>
        <Link href={`/domains/${domain}`}>
          <code>{domain}</code>
        </Link>
        {" "}
        <span className="muted" style={{ fontWeight: "normal", fontSize: "0.9rem" }}>
          ({cards.length} run{cards.length === 1 ? "" : "s"})
        </span>
      </h2>
      <table className="evals-table">
        <thead>
          <tr>
            <th>Score</th>
            <th>When</th>
            <th>Config</th>
            <th>Schema</th>
            <th>Entities</th>
            <th>Rels</th>
            <th>Poly</th>
            <th>Fields</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {cards.map((c, i) => {
            // Compute delta vs the previous (older) run. Newer rows
            // have lower index; previous run is i+1. The bottom row
            // has no previous to compare against.
            const prev = cards[i + 1];
            const delta = prev ? c.overall_score - prev.overall_score : null;
            return (
              <tr key={c.id} className={c.id === latest.id ? "evals-row-latest" : ""}>
                <td>
                  <ScoreBadge value={c.overall_score} />
                  {delta != null && (
                    <span
                      className={
                        delta > 0
                          ? "evals-delta-up"
                          : delta < 0
                            ? "evals-delta-down"
                            : "evals-delta-zero"
                      }
                      title={`vs previous run (${formatScore(prev!.overall_score)})`}
                    >
                      {delta > 0 ? "▲" : delta < 0 ? "▼" : "•"}{" "}
                      {Math.abs(delta).toFixed(1)}
                    </span>
                  )}
                </td>
                <td className="muted" title={c.timestamp}>
                  {formatTimestamp(c.timestamp)}
                </td>
                <td className="evals-config">
                  {c.config || <span className="muted">—</span>}
                </td>
                <td>{c.schema_validity.valid ? "✓" : <span className="evals-fail">✗</span>}</td>
                <td>{pct(c.entities.score)}</td>
                <td>{pct(c.relationships.score)}</td>
                <td>
                  {pct(c.polymorphism.polymorphism_present_score)} /{" "}
                  {pct(c.polymorphism.target_coverage_score)}
                </td>
                <td>{pct(c.field_names.score)}</td>
                <td>
                  <Link href={`/evals/${c.id}`}>open →</Link>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

function ScoreBadge({ value }: { value: number }) {
  const tier =
    value >= 90 ? "good" : value >= 70 ? "ok" : value >= 40 ? "weak" : "bad";
  return <span className={`evals-score evals-score-${tier}`}>{value.toFixed(1)}</span>;
}

function pct(score: number): string {
  return `${Math.round(score * 100)}%`;
}

function formatScore(value: number): string {
  return value.toFixed(1);
}

function formatTimestamp(ts: string): string {
  // Trim seconds for table density. ISO format: 2026-04-28T02:45:58+00:00
  try {
    const d = new Date(ts);
    return d.toLocaleString();
  } catch {
    return ts;
  }
}
