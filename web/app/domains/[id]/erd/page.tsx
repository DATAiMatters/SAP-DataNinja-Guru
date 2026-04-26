import Link from "next/link";
import { notFound } from "next/navigation";
import { getDomain, listDomainIds } from "@/lib/content";
import { loadClusters } from "@/lib/yaml";
import { buildErdGraph } from "@/lib/erd-layout";
import InteractiveErd from "@/components/InteractiveErd";

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
      <p className="muted">
        <Link href="/">Domains</Link> ›{" "}
        <Link href={`/domains/${id}`}>{domain.domain.name}</Link> ›
        Interactive ERD
      </p>
      <h1>{domain.domain.name} — Interactive ERD</h1>
      <p className="muted">
        Pan + zoom + minimap. Static mermaid view:{" "}
        <Link href={`/domains/${id}/diagram`}>diagram</Link>.
      </p>
      <InteractiveErd domainId={id} nodes={nodes} edges={edges} />
    </div>
  );
}
