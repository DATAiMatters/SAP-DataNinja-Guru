import Link from "next/link";
import { notFound } from "next/navigation";
import { getDomain, listDomainIds, tablesByCluster } from "@/lib/content";
import { getClusterColor, getClusterName } from "@/lib/clusters";

export function generateStaticParams() {
  return listDomainIds().map((id) => ({ id }));
}

export default async function DomainPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const domain = getDomain(id);
  if (!domain) notFound();

  const groups = tablesByCluster(domain.tables);

  return (
    <div>
      <p className="muted">
        <Link href="/">← All domains</Link>
      </p>
      <h1>{domain.domain.name}</h1>
      <p className="muted">
        {domain.domain.sap_module && (
          <span className="pill">{domain.domain.sap_module}</span>
        )}
        {domain.tables.length} entit
        {domain.tables.length === 1 ? "y" : "ies"} ·{" "}
        {domain.relationships.length} relationship
        {domain.relationships.length === 1 ? "" : "s"} ·{" "}
        <Link href={`/domains/${id}/diagram`}>Diagram →</Link>
      </p>

      {domain.domain.description && <p>{domain.domain.description}</p>}

      {groups.map(({ clusterId, tables }) => (
        <section key={clusterId} className="cluster-section">
          <h2 className="cluster-heading">
            <span
              className="cluster-swatch"
              style={{ background: getClusterColor(clusterId) }}
              aria-hidden="true"
            />
            {getClusterName(clusterId)}
          </h2>
          <ul className="entity-grid">
            {tables.map((t) => (
              <li
                key={t.id}
                className="entity-card"
                style={{ background: getClusterColor(t.cluster) }}
              >
                <Link href={`/domains/${id}/${t.id}`} className="entity-link">
                  <code className="entity-id">{t.id}</code>
                  <span className="entity-name">{t.name}</span>
                </Link>
                {(t.gotchas?.length ?? 0) > 0 && (
                  <span
                    className="gotcha-flag"
                    title={`${t.gotchas!.length} gotcha(s)`}
                  >
                    ⚠ {t.gotchas!.length}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
