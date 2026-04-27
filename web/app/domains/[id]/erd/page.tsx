import Link from "next/link";
import { notFound } from "next/navigation";
import { getDomain, listDomainIds } from "@/lib/content";
import { loadClusters } from "@/lib/yaml";
import { buildErdGraph } from "@/lib/erd-layout";
import InteractiveErd from "@/components/InteractiveErd";
import DomainTabBar from "@/components/DomainTabBar";

export function generateStaticParams() {
  return listDomainIds().map((id) => ({ id }));
}

export default async function ErdPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const domain = getDomain(id);
  if (!domain) notFound();
  const { nodes, edges } = buildErdGraph(domain, loadClusters().clusters);

  return (
    <div>
      <div className="page-header">
        <nav className="breadcrumb" aria-label="Breadcrumb">
          <Link href="/">Domains</Link>
          <span className="breadcrumb-sep">›</span>
          <Link href={`/domains/${id}`}>{domain.domain.name}</Link>
          <span className="breadcrumb-sep">›</span>
          <span>Interactive ERD</span>
        </nav>
        <div className="page-title-row">
          <h1>{domain.domain.name}</h1>
        </div>
        <p className="muted" style={{ margin: 0 }}>
          Click a node to open its detail page. Cmd/Ctrl-click for new tab.
          Drag to rearrange — positions save back to YAML.
        </p>
      </div>
      <DomainTabBar domainId={id} active="erd" />
      <InteractiveErd domainId={id} nodes={nodes} edges={edges} />
    </div>
  );
}
