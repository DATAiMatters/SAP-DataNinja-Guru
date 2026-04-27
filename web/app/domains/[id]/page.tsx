import Link from "next/link";
import { notFound } from "next/navigation";
import { auth } from "@/auth";
import { isAdmin } from "@/lib/admin";
import { getDomain, tablesByCluster } from "@/lib/content";
import { getClusterColor, getClusterName } from "@/lib/clusters";
import DomainEntityList, {
  type ClusterMeta,
} from "@/components/DomainEntityList";
import DomainTabBar from "@/components/DomainTabBar";
import EditableText from "@/components/EditableText";

// Admin edits write to YAML on disk; we can't pre-generate static params
// when the file may change per-request.
export const dynamic = "force-dynamic";

export default async function DomainPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const domain = getDomain(id);
  if (!domain) notFound();
  const session = await auth();
  const admin = isAdmin(session);

  // Pre-compute the clusters used by this domain (in discovery order)
  // so the client filter component doesn't need to load clusters.yaml.
  const clusterGroups = tablesByCluster(domain.tables);
  const clusters: ClusterMeta[] = clusterGroups.map(({ clusterId }) => ({
    id: clusterId,
    name: getClusterName(clusterId),
    color: getClusterColor(clusterId),
  }));

  const gotchaCount = domain.tables.reduce(
    (sum, t) => sum + (t.gotchas?.length ?? 0),
    0,
  );

  return (
    <div>
      <div className="page-header">
        <nav className="breadcrumb" aria-label="Breadcrumb">
          <Link href="/">Domains</Link>
          <span className="breadcrumb-sep">›</span>
          <span>{domain.domain.name}</span>
        </nav>
        <div className="page-title-row">
          <h1>
            <EditableText
              domainId={id}
              path={["domain", "name"]}
              value={domain.domain.name}
              isAdmin={admin}
              as="span"
              placeholder="(unnamed domain)"
            />
            {(domain.domain.sap_module || admin) && (
              <span
                className="chip chip-mono chip-info"
                style={{ marginLeft: "0.75rem", verticalAlign: "middle" }}
              >
                <EditableText
                  domainId={id}
                  path={["domain", "sap_module"]}
                  value={domain.domain.sap_module ?? ""}
                  isAdmin={admin}
                  as="span"
                  placeholder="MODULE"
                />
              </span>
            )}
          </h1>
        </div>
        <EditableText
          domainId={id}
          path={["domain", "description"]}
          value={domain.domain.description ?? ""}
          isAdmin={admin}
          as="p"
          multiline
          className="muted domain-description"
          placeholder="(no description — click to add)"
        />
      </div>

      <div className="stat-bar" aria-label="Domain summary">
        <div className="stat-bar-item">
          <span className="stat-num">{domain.tables.length}</span>
          <span className="stat-label">Entities</span>
        </div>
        <div className="stat-bar-item">
          <span className="stat-num">{domain.relationships.length}</span>
          <span className="stat-label">Relationships</span>
        </div>
        <div className="stat-bar-item">
          <span className="stat-num">{clusterGroups.length}</span>
          <span className="stat-label">
            Cluster{clusterGroups.length === 1 ? "" : "s"}
          </span>
        </div>
        {gotchaCount > 0 && (
          <div className="stat-bar-item">
            <span className="stat-num" style={{ color: "var(--danger)" }}>
              {gotchaCount}
            </span>
            <span className="stat-label">Gotchas</span>
          </div>
        )}
      </div>

      <DomainTabBar domainId={id} active="overview" />

      <DomainEntityList
        domainId={id}
        entities={domain.tables}
        clusters={clusters}
      />
    </div>
  );
}
