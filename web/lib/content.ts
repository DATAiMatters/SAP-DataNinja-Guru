import { loadAllDomains } from "./yaml";
import {
  isPolymorphic,
  type DomainFile,
  type Relationship,
  type Table,
} from "./schema-types";

export interface DomainSummary {
  id: string;
  name: string;
  sap_module?: string;
  description?: string;
  entityCount: number;
  relationshipCount: number;
}

export function getDomainSummaries(): DomainSummary[] {
  return Array.from(loadAllDomains().values())
    .map((d) => ({
      id: d.domain.id,
      name: d.domain.name,
      sap_module: d.domain.sap_module,
      description: d.domain.description,
      entityCount: d.tables.length,
      relationshipCount: d.relationships.length,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function listDomainIds(): string[] {
  return Array.from(loadAllDomains().keys());
}

export function getDomain(domainId: string): DomainFile | undefined {
  return loadAllDomains().get(domainId);
}

export function getEntity(
  domainId: string,
  tableId: string,
): { domain: DomainFile; table: Table } | undefined {
  const domain = getDomain(domainId);
  if (!domain) return undefined;
  const table = domain.tables.find((t) => t.id === tableId);
  if (!table) return undefined;
  return { domain, table };
}

export interface RelatedEdge {
  relationship: Relationship;
  direction: "outgoing" | "incoming";
  // For polymorphic outgoing: the resolution target.
  // For polymorphic incoming: rel.from.table.
  // For simple: the other endpoint.
  otherTable: string;
}

export function getRelationshipsFor(
  domain: DomainFile,
  tableId: string,
): RelatedEdge[] {
  const edges: RelatedEdge[] = [];
  for (const rel of domain.relationships) {
    if (isPolymorphic(rel)) {
      if (rel.from.table === tableId) {
        for (const res of rel.object_resolution) {
          edges.push({
            relationship: rel,
            direction: "outgoing",
            otherTable: res.target_table,
          });
        }
      } else if (rel.object_resolution.some((r) => r.target_table === tableId)) {
        edges.push({
          relationship: rel,
          direction: "incoming",
          otherTable: rel.from.table,
        });
      }
    } else {
      if (rel.from.table === tableId) {
        edges.push({
          relationship: rel,
          direction: "outgoing",
          otherTable: rel.to.table,
        });
      } else if (rel.to.table === tableId) {
        edges.push({
          relationship: rel,
          direction: "incoming",
          otherTable: rel.from.table,
        });
      }
    }
  }
  return edges;
}

export function tablesByCluster(
  tables: Table[],
): Array<{ clusterId: string; tables: Table[] }> {
  const order: string[] = [];
  const map = new Map<string, Table[]>();
  for (const t of tables) {
    if (!map.has(t.cluster)) {
      order.push(t.cluster);
      map.set(t.cluster, []);
    }
    map.get(t.cluster)!.push(t);
  }
  return order.map((id) => ({ clusterId: id, tables: map.get(id)! }));
}
