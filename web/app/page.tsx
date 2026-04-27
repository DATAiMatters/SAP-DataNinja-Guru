import Link from "next/link";
import { getDomainSummaries } from "@/lib/content";

export default function HomePage() {
  const domains = getDomainSummaries();

  const totalEntities = domains.reduce((s, d) => s + d.entityCount, 0);
  const totalRels = domains.reduce((s, d) => s + d.relationshipCount, 0);
  const modules = new Set(
    domains.map((d) => d.sap_module).filter(Boolean) as string[],
  );

  return (
    <div>
      <div className="page-header">
        <h1>Domains</h1>
        <p className="muted" style={{ margin: 0, maxWidth: 720 }}>
          Curated SAP table relationships, joins, and migration notes.
          Each domain is a versioned YAML file authored against a JSON-Schema
          spec; this site renders them as browsable models with ERDs,
          annotations, and discussion.
        </p>
      </div>

      {domains.length > 0 && (
        <div className="stat-bar" aria-label="Knowledge base totals">
          <div className="stat-bar-item">
            <span className="stat-num">{domains.length}</span>
            <span className="stat-label">
              Domain{domains.length === 1 ? "" : "s"}
            </span>
          </div>
          <div className="stat-bar-item">
            <span className="stat-num">{totalEntities}</span>
            <span className="stat-label">Entities</span>
          </div>
          <div className="stat-bar-item">
            <span className="stat-num">{totalRels}</span>
            <span className="stat-label">Relationships</span>
          </div>
          <div className="stat-bar-item">
            <span className="stat-num">{modules.size}</span>
            <span className="stat-label">SAP modules</span>
          </div>
        </div>
      )}

      {domains.length === 0 ? (
        <div className="card card-padded" style={{ marginTop: "1.5rem" }}>
          <p style={{ margin: 0 }}>
            No domain YAML files in <code>/domains/</code>. Use{" "}
            <Link href="/ingest">Ingest</Link> to propose your first one.
          </p>
        </div>
      ) : (
        <ul className="domain-list">
          {domains.map((d) => (
            <li key={d.id} className="domain-card">
              <div className="domain-meta">
                {d.sap_module && (
                  <span className="chip chip-mono chip-info">
                    {d.sap_module}
                  </span>
                )}
                <span className="muted">
                  {d.entityCount} entit{d.entityCount === 1 ? "y" : "ies"} ·{" "}
                  {d.relationshipCount} relationship
                  {d.relationshipCount === 1 ? "" : "s"}
                </span>
              </div>
              <h2>
                <Link href={`/domains/${d.id}`}>{d.name}</Link>
              </h2>
              {d.description && (
                <p className="domain-card-desc">{d.description}</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
