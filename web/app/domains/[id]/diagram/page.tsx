import Link from "next/link";
import { notFound } from "next/navigation";
import { getDomain, listDomainIds } from "@/lib/content";
import { loadClusters } from "@/lib/yaml";
import { generateMermaidFlowchart } from "@/lib/mermaid";
import MermaidDiagram from "@/components/MermaidDiagram";

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
      <p className="muted">
        <Link href="/">Domains</Link> ›{" "}
        <Link href={`/domains/${id}`}>{domain.domain.name}</Link> › Diagram
      </p>
      <h1>{domain.domain.name} — Diagram</h1>
      <p className="muted">
        Click any node to navigate via the entity list. Drag to scroll on
        mobile.
      </p>
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
