// Port of /scripts/generate_mermaid.py to TypeScript so the diagram page can
// produce mermaid source as part of the RSC render. Behavior must match the
// Python generator (which is still the canonical CLI for batch /generated/ output).
import { isPolymorphic, type Cluster, type DomainFile, type Table } from "./schema-types";

export function generateMermaidFlowchart(
  domain: DomainFile,
  clusters: Cluster[],
): string {
  const lookup = new Map(clusters.map((c) => [c.id, c]));
  const order: string[] = [];
  const groups = new Map<string, Table[]>();

  for (const t of domain.tables) {
    if (!lookup.has(t.cluster)) {
      throw new Error(
        `Table ${t.id} references unknown cluster '${t.cluster}' (not in clusters.yaml)`,
      );
    }
    if (!groups.has(t.cluster)) {
      order.push(t.cluster);
      groups.set(t.cluster, []);
    }
    groups.get(t.cluster)!.push(t);
  }

  const lines: string[] = [
    "flowchart LR",
    `    %% Domain: ${domain.domain.name}`,
    `    %% Clusters: ${order.join(", ")}`,
    "",
  ];

  for (const id of order) {
    const c = lookup.get(id)!;
    const safe = id.replace(/-/g, "_");
    lines.push(`    subgraph ${safe}["${c.name}"]`);
    for (const t of groups.get(id)!) {
      const short = t.name.length > 28 ? t.name.slice(0, 26) + "…" : t.name;
      lines.push(`        ${t.id}["<b>${t.id}</b><br/>${short}"]`);
    }
    lines.push("    end", "");
  }

  for (const rel of domain.relationships) {
    if (isPolymorphic(rel)) {
      for (const res of rel.object_resolution) {
        const tag = res.via_inob ? "via INOB" : "direct";
        lines.push(
          `    ${rel.from.table} -.->|"klart=${res.klart} (${tag})"| ${res.target_table}`,
        );
      }
      continue;
    }
    const arrow = rel.optional ? "-.->" : "-->";
    const fields = rel.from.fields.join("+");
    lines.push(`    ${rel.from.table} ${arrow}|"${fields}"| ${rel.to.table}`);
  }

  lines.push("");
  for (const id of order) {
    const c = lookup.get(id)!;
    const safe = id.replace(/-/g, "_");
    lines.push(`    classDef ${safe}_style fill:${c.color},stroke:#666`);
    const ids = groups.get(id)!.map((t) => t.id).join(",");
    lines.push(`    class ${ids} ${safe}_style`);
  }

  return lines.join("\n");
}
