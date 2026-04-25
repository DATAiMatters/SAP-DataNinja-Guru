import Link from "next/link";
import { getDomainSummaries } from "@/lib/content";

export default function HomePage() {
  const domains = getDomainSummaries();

  return (
    <div>
      <h1>Domains</h1>
      <p className="muted">
        Curated SAP table relationships, joins, and migration notes.
      </p>

      {domains.length === 0 ? (
        <p>No domain YAML files in /domains/.</p>
      ) : (
        <ul className="domain-list">
          {domains.map((d) => (
            <li key={d.id} className="domain-card">
              <h2>
                <Link href={`/domains/${d.id}`}>{d.name}</Link>
              </h2>
              <p className="domain-meta">
                {d.sap_module && <span className="pill">{d.sap_module}</span>}
                <span className="muted">
                  {d.entityCount} entit{d.entityCount === 1 ? "y" : "ies"} ·{" "}
                  {d.relationshipCount} relationship
                  {d.relationshipCount === 1 ? "" : "s"}
                </span>
              </p>
              {d.description && <p>{d.description}</p>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
