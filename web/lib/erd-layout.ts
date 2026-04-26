// Convert a domain into React Flow nodes + edges. Cluster groups are parent
// nodes; tables are children with parentId + extent: 'parent'. Tables with an
// explicit `layout` block use those coordinates; the rest fall back to dagre
// auto-layout per-cluster (LR direction).
import dagre from "@dagrejs/dagre";
import {
  isPolymorphic,
  type Cluster,
  type DomainFile,
  type Table,
} from "./schema-types";

export interface ErdNode {
  id: string;
  type: "entity" | "cluster";
  position: { x: number; y: number };
  data: {
    label: string;
    tableName?: string;
    entityId?: string;
    clusterId?: string;
    clusterColor?: string;
  };
  parentId?: string;
  extent?: "parent";
  width?: number;
  height?: number;
  style?: Record<string, string | number>;
  draggable?: boolean;
  selectable?: boolean;
}

export interface ErdEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
  data: {
    relationshipId: string;
    type: "simple" | "polymorphic";
    optional?: boolean;
    klart?: string;
    via_inob?: boolean;
    cardinality?: string;
    conditions?: Record<string, unknown>;
  };
  style?: Record<string, string | number>;
  labelStyle?: Record<string, string | number>;
}

const NODE_W = 180;
const NODE_H = 60;
const CLUSTER_PADDING = 24;
const CLUSTER_LABEL_HEIGHT = 28;
const CLUSTER_GAP_X = 80;

export function buildErdGraph(
  domain: DomainFile,
  clusterRegistry: Cluster[],
): { nodes: ErdNode[]; edges: ErdEdge[] } {
  const clusterLookup = new Map(clusterRegistry.map((c) => [c.id, c]));

  const order: string[] = [];
  const tablesByCluster = new Map<string, Table[]>();
  for (const t of domain.tables) {
    if (!tablesByCluster.has(t.cluster)) {
      order.push(t.cluster);
      tablesByCluster.set(t.cluster, []);
    }
    tablesByCluster.get(t.cluster)!.push(t);
  }

  const nodes: ErdNode[] = [];
  let cursorX = 0;

  for (const clusterId of order) {
    const cl = clusterLookup.get(clusterId);
    const tables = tablesByCluster.get(clusterId)!;
    const positions = layoutCluster(tables, domain);

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const t of tables) {
      const p = positions.get(t.id)!;
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x + NODE_W);
      maxY = Math.max(maxY, p.y + NODE_H);
    }
    const clusterW = maxX - minX + CLUSTER_PADDING * 2;
    const clusterH =
      maxY - minY + CLUSTER_PADDING * 2 + CLUSTER_LABEL_HEIGHT;

    nodes.push({
      id: `cluster:${clusterId}`,
      type: "cluster",
      position: { x: cursorX, y: 0 },
      data: {
        label: cl?.name ?? clusterId,
        clusterId,
        clusterColor: cl?.color ?? "#f5f5f5",
      },
      style: {
        width: clusterW,
        height: clusterH,
      },
      draggable: false,
      selectable: false,
    });

    for (const t of tables) {
      const p = positions.get(t.id)!;
      nodes.push({
        id: t.id,
        type: "entity",
        position: {
          x: p.x - minX + CLUSTER_PADDING,
          y: p.y - minY + CLUSTER_PADDING + CLUSTER_LABEL_HEIGHT,
        },
        data: {
          label: t.id,
          tableName: t.name,
          entityId: t.id,
          clusterId,
          clusterColor: cl?.color ?? "#f5f5f5",
        },
        parentId: `cluster:${clusterId}`,
        extent: "parent",
        width: NODE_W,
        height: NODE_H,
      });
    }

    cursorX += clusterW + CLUSTER_GAP_X;
  }

  const edges: ErdEdge[] = buildEdges(domain);
  return { nodes, edges };
}

function layoutCluster(
  tables: Table[],
  domain: DomainFile,
): Map<string, { x: number; y: number }> {
  const out = new Map<string, { x: number; y: number }>();
  const needsAuto: Table[] = [];

  for (const t of tables) {
    if (t.layout?.x != null && t.layout?.y != null) {
      out.set(t.id, { x: t.layout.x, y: t.layout.y });
    } else {
      needsAuto.push(t);
    }
  }

  if (needsAuto.length === 0) return out;

  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: "LR", nodesep: 30, ranksep: 60 });
  g.setDefaultEdgeLabel(() => ({}));
  for (const t of needsAuto) {
    g.setNode(t.id, { width: NODE_W, height: NODE_H });
  }
  const idsInThisCluster = new Set(needsAuto.map((t) => t.id));
  for (const rel of domain.relationships) {
    if (isPolymorphic(rel)) {
      for (const r of rel.object_resolution) {
        if (
          idsInThisCluster.has(rel.from.table) &&
          idsInThisCluster.has(r.target_table)
        ) {
          g.setEdge(rel.from.table, r.target_table);
        }
      }
    } else {
      if (
        idsInThisCluster.has(rel.from.table) &&
        idsInThisCluster.has(rel.to.table)
      ) {
        g.setEdge(rel.from.table, rel.to.table);
      }
    }
  }
  dagre.layout(g);

  for (const t of needsAuto) {
    const p = g.node(t.id);
    out.set(t.id, {
      x: (p?.x ?? 0) - NODE_W / 2,
      y: (p?.y ?? 0) - NODE_H / 2,
    });
  }
  return out;
}

function buildEdges(domain: DomainFile): ErdEdge[] {
  const edges: ErdEdge[] = [];
  for (const rel of domain.relationships) {
    if (isPolymorphic(rel)) {
      for (const r of rel.object_resolution) {
        const tag = r.via_inob ? "via INOB" : "direct";
        edges.push({
          id: `${rel.id}:${r.klart ?? r.target_table}`,
          source: rel.from.table,
          target: r.target_table,
          label: `klart=${r.klart ?? "?"} (${tag})`,
          data: {
            relationshipId: rel.id,
            type: "polymorphic",
            klart: r.klart,
            via_inob: r.via_inob,
          },
          style: { stroke: "#888", strokeDasharray: "4 4" },
          labelStyle: { fontSize: 10, fill: "#555" },
        });
      }
    } else {
      edges.push({
        id: rel.id,
        source: rel.from.table,
        target: rel.to.table,
        label: rel.from.fields.join("+"),
        data: {
          relationshipId: rel.id,
          type: "simple",
          optional: rel.optional,
          cardinality: rel.cardinality,
          conditions: rel.conditions,
        },
        style: rel.optional ? { strokeDasharray: "4 4" } : undefined,
        labelStyle: { fontSize: 10, fill: "#555" },
      });
    }
  }
  return edges;
}
