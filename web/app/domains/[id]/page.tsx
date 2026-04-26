import Link from "next/link";
import { notFound } from "next/navigation";
import { getDomain, listDomainIds, tablesByCluster } from "@/lib/content";
import { getClusterColor, getClusterName } from "@/lib/clusters";
import DomainEntityList, {
  type ClusterMeta,
} from "@/components/DomainEntityList";

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

  // Pre-compute the clusters used by this domain (in discovery order)
  // so the client filter component doesn't need to load clusters.yaml.
  const clusters: ClusterMeta[] = tablesByCluster(domain.tables).map(
    ({ clusterId }) => ({
      id: clusterId,
      name: getClusterName(clusterId),
      color: getClusterColor(clusterId),
    }),
  );

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
        <Link href={`/domains/${id}/erd`}>Interactive ERD →</Link>{" "}
        <Link href={`/domains/${id}/diagram`}>Diagram →</Link>
      </p>

      {domain.domain.description && <p>{domain.domain.description}</p>}

      <DomainEntityList
        domainId={id}
        entities={domain.tables}
        clusters={clusters}
      />
    </div>
  );
}
