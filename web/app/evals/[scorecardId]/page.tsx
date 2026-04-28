import Link from "next/link";
import { notFound } from "next/navigation";
import { auth } from "@/auth";
import {
  diffScorecards,
  listScorecards,
  readScorecard,
  type Scorecard,
} from "@/lib/evals";

export const dynamic = "force-dynamic";

// Single-scorecard detail view. Mirrors the structure of the markdown
// emit in eval_extraction.py but with linkable entity/relationship
// IDs and a side-by-side diff against the previous run on the same
// domain.
export default async function ScorecardDetailPage({
  params,
}: {
  params: Promise<{ scorecardId: string }>;
}) {
  const session = await auth();
  if (!session?.user) {
    return (
      <div>
        <PageHeader scorecardId="—" />
        <div className="card card-padded" style={{ maxWidth: 480 }}>
          <p style={{ margin: 0 }}>
            <Link href="/sign-in?callbackUrl=/evals">Sign in</Link> to view
            eval scorecards.
          </p>
        </div>
      </div>
    );
  }

  const { scorecardId } = await params;
  const card = readScorecard(scorecardId);
  if (!card) notFound();

  // Find the previous run on the same domain so we can show deltas.
  // listScorecards returns newest-first; previous = the next one in
  // order with the same domain that has an older timestamp.
  const allCards = listScorecards();
  const sameDomain = allCards.filter((c) => c.domain_id === card.domain_id);
  const ourIndex = sameDomain.findIndex((c) => c.id === card.id);
  const previous =
    ourIndex >= 0 && ourIndex < sameDomain.length - 1
      ? sameDomain[ourIndex + 1]
      : null;
  const diff = previous ? diffScorecards(previous, card) : null;

  return (
    <div>
      <PageHeader scorecardId={card.id} domainId={card.domain_id} />

      <section className="entity-section">
        <div className="evals-detail-header">
          <ScoreBadge value={card.overall_score} size="large" />
          {diff && (
            <DiffBadge value={diff.overall} label={`vs ${previous!.id}`} />
          )}
        </div>
        <dl className="evals-meta">
          <dt>Domain</dt>
          <dd>
            <Link href={`/domains/${card.domain_id}`}>
              <code>{card.domain_id}</code>
            </Link>
          </dd>
          <dt>Run at</dt>
          <dd>{new Date(card.timestamp).toLocaleString()}</dd>
          <dt>Config</dt>
          <dd>{card.config || <span className="muted">(no config string set)</span>}</dd>
          <dt>Candidate</dt>
          <dd><code>{card.candidate_path}</code></dd>
          <dt>Truth</dt>
          <dd><code>{card.truth_path}</code></dd>
        </dl>
      </section>

      <section className="entity-section">
        <h2>Schema validity</h2>
        {card.schema_validity.valid ? (
          <p>✓ Valid against <code>schema.json</code>.</p>
        ) : (
          <>
            <p className="evals-fail">
              ✗ {card.schema_validity.error_count} schema error(s) — overall
              score is forced to 0.
            </p>
            <pre className="evals-errors">
              <code>{card.schema_validity.errors.join("\n")}</code>
            </pre>
          </>
        )}
      </section>

      <Axis
        title="Entities"
        score={card.entities.score}
        delta={diff?.axes.entities}
        body={
          <>
            <p>
              <strong>{card.entities.matched_count}</strong> of{" "}
              <strong>{card.entities.truth_count}</strong> ground-truth tables
              present.
              {card.entities.extra.length > 0 && (
                <> {card.entities.extra.length} extra in candidate.</>
              )}
            </p>
            {card.entities.missed.length > 0 && (
              <DetailList label="Missed" items={card.entities.missed.map((id) => ({
                key: id,
                href: `/domains/${card.domain_id}/${id}`,
                label: id,
              }))} />
            )}
            {card.entities.extra.length > 0 && (
              <DetailList label="Extra (in candidate but not truth)" items={card.entities.extra.map((id) => ({
                key: id,
                label: id,
              }))} />
            )}
          </>
        }
      />

      <Axis
        title="Relationships (by topology)"
        score={card.relationships.score}
        delta={diff?.axes.relationships}
        body={
          <>
            <p>
              <strong>{card.relationships.matched_count}</strong> of{" "}
              <strong>{card.relationships.truth_count}</strong> ground-truth
              relationships present, matched by{" "}
              <code>(from_table, to_table)</code> topology. Polymorphic
              relationships expand to N edges before comparison.
            </p>
            {card.relationships.missed.length > 0 && (
              <DetailList
                label={`Missed (${card.relationships.missed.length})`}
                items={card.relationships.missed.map(([from, to]) => ({
                  key: `${from}->${to}`,
                  label: `${from} → ${to}`,
                }))}
                limit={20}
              />
            )}
          </>
        }
      />

      <Axis
        title="Polymorphism"
        score={card.polymorphism.polymorphism_present_score}
        delta={diff?.axes.polymorphism_present}
        body={
          <>
            <p>
              Detected:{" "}
              <strong>{card.polymorphism.candidate_polymorphic_count}</strong>{" "}
              of <strong>{card.polymorphism.truth_polymorphic_count}</strong>.
              Resolution-target coverage:{" "}
              <strong>
                {Math.round(card.polymorphism.target_coverage_score * 100)}%
              </strong>
              .
            </p>
            <ul className="evals-poly-list">
              {card.polymorphism.detail.map((d) => (
                <li key={d.from_table}>
                  <code>{d.from_table}</code>:{" "}
                  {d.polymorphism_detected ? (
                    <span className="evals-ok">
                      detected · targets matched{" "}
                      {d.matched_target_count ?? 0} / {d.truth_targets.length}{" "}
                      ({d.truth_targets.join(", ")})
                    </span>
                  ) : (
                    <span className="evals-fail">
                      MISSED · should be polymorphic to{" "}
                      {d.truth_targets.join(", ")}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </>
        }
      />

      <Axis
        title="Field names"
        score={card.field_names.score}
        delta={diff?.axes.field_names}
        body={
          <>
            <p>
              <strong>{card.field_names.total_matched_fields}</strong> of{" "}
              <strong>{card.field_names.total_truth_fields}</strong> ground-truth
              physical names present (case-sensitive). Per entity:
            </p>
            <table className="evals-field-table">
              <thead>
                <tr>
                  <th>Entity</th>
                  <th>Matched</th>
                  <th>Missed</th>
                </tr>
              </thead>
              <tbody>
                {card.field_names.per_entity
                  .slice()
                  .sort((a, b) => a.score - b.score)
                  .map((e) => (
                    <tr key={e.id}>
                      <td>
                        <Link href={`/domains/${card.domain_id}/${e.id}`}>
                          <code>{e.id}</code>
                        </Link>
                      </td>
                      <td>
                        {e.matched_count} / {e.truth_count}
                      </td>
                      <td className="muted">
                        {e.missed.length > 0 ? e.missed.join(", ") : "—"}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </>
        }
      />

      <Axis
        title="Clusters"
        score={card.clusters.score}
        delta={diff?.axes.clusters}
        body={
          <p>
            <strong>{card.clusters.with_cluster}</strong> of{" "}
            <strong>{card.clusters.total}</strong> candidate tables have a{" "}
            <code>cluster:</code> reference set.
          </p>
        }
      />
    </div>
  );
}

function PageHeader({
  scorecardId,
  domainId,
}: {
  scorecardId: string;
  domainId?: string;
}) {
  return (
    <div className="page-header">
      <nav className="breadcrumb" aria-label="Breadcrumb">
        <span>Curate</span>
        <span className="breadcrumb-sep">›</span>
        <Link href="/evals">Evals</Link>
        {domainId && (
          <>
            <span className="breadcrumb-sep">›</span>
            <span>{domainId}</span>
          </>
        )}
      </nav>
      <h1>
        <code style={{ fontSize: "1.1rem" }}>{scorecardId}</code>
      </h1>
    </div>
  );
}

function ScoreBadge({
  value,
  size = "normal",
}: {
  value: number;
  size?: "normal" | "large";
}) {
  const tier =
    value >= 90 ? "good" : value >= 70 ? "ok" : value >= 40 ? "weak" : "bad";
  return (
    <span
      className={`evals-score evals-score-${tier} evals-score-${size}`}
    >
      {value.toFixed(1)} / 100
    </span>
  );
}

function DiffBadge({ value, label }: { value: number; label: string }) {
  const cls = value > 0 ? "up" : value < 0 ? "down" : "zero";
  return (
    <span className={`evals-diff evals-diff-${cls}`} title={label}>
      {value > 0 ? "▲ " : value < 0 ? "▼ " : "• "}
      {Math.abs(value).toFixed(1)}
    </span>
  );
}

function Axis({
  title,
  score,
  delta,
  body,
}: {
  title: string;
  score: number;
  delta?: number;
  body: React.ReactNode;
}) {
  return (
    <section className="entity-section">
      <div className="evals-axis-header">
        <h2 style={{ margin: 0 }}>{title}</h2>
        <ScoreBadge value={score * 100} />
        {delta != null && Math.abs(delta) > 0.001 && (
          <DiffBadge value={delta * 100} label="vs previous run" />
        )}
      </div>
      {body}
    </section>
  );
}

function DetailList({
  label,
  items,
  limit,
}: {
  label: string;
  items: { key: string; label: string; href?: string }[];
  limit?: number;
}) {
  const shown = limit ? items.slice(0, limit) : items;
  const hidden = limit ? items.length - shown.length : 0;
  return (
    <div className="evals-list">
      <strong>{label}:</strong>{" "}
      {shown.map((item, i) => (
        <span key={item.key}>
          {i > 0 && ", "}
          {item.href ? (
            <Link href={item.href}>
              <code>{item.label}</code>
            </Link>
          ) : (
            <code>{item.label}</code>
          )}
        </span>
      ))}
      {hidden > 0 && (
        <span className="muted"> · and {hidden} more</span>
      )}
    </div>
  );
}
