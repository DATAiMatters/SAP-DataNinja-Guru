import Link from "next/link";
import { notFound } from "next/navigation";
import { getDomain, listDomainIds } from "@/lib/content";
import { loadClusters } from "@/lib/yaml";
import { generateMermaidFlowchart } from "@/lib/mermaid";
import MermaidDiagram from "@/components/MermaidDiagram";
import DomainTabBar from "@/components/DomainTabBar";

export function generateStaticParams() {
  return listDomainIds().map((id) => ({ id }));
}

export default async function DiagramPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const domain = getDomain(id);
  if (!domain) notFound();
  const source = generateMermaidFlowchart(domain, loadClusters().clusters);

  return (
    <div>
      <div className="page-header">
        <nav className="breadcrumb" aria-label="Breadcrumb">
          <Link href="/">Domains</Link>
          <span className="breadcrumb-sep">›</span>
          <Link href={`/domains/${id}`}>{domain.domain.name}</Link>
          <span className="breadcrumb-sep">›</span>
          <span>Diagram</span>
        </nav>
        <div className="page-title-row">
          <h1>{domain.domain.name}</h1>
        </div>
        <p className="muted" style={{ margin: 0 }}>
          Click any node to navigate via the entity list. Drag to scroll on
          mobile.
        </p>
      </div>
      <DomainTabBar domainId={id} active="diagram" />
      <MermaidDiagram source={source} id={id} />
      <details className="sql-block diagram-source">
        <summary>Mermaid source</summary>
        <pre>
          <code>{source}</code>
        </pre>
      </details>
    </div>
  );
}
