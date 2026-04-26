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
    // Positions are returned in cluster-relative coordinates: explicit layout
    // values are used as-is; auto-layout values are pre-offset to land inside
    // the cluster padding/label area. This keeps "what user dragged to" ===
    // "what gets saved" === "what loads back".
    const positions = layoutCluster(tables, domain);

    let maxX = 0;
    let maxY = 0;
    for (const t of tables) {
      const p = positions.get(t.id)!;
      maxX = Math.max(maxX, p.x + NODE_W);
      maxY = Math.max(maxY, p.y + NODE_H);
    }
    const clusterW = maxX + CLUSTER_PADDING;
    const clusterH = maxY + CLUSTER_PADDING;

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
        position: { x: p.x, y: p.y },
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

  // Pass 1: explicit layout — used verbatim. This is what `node.position`
  // looks like after a drag, so saving + reloading round-trips cleanly.
  for (const t of tables) {
    if (t.layout?.x != null && t.layout?.y != null) {
      out.set(t.id, { x: t.layout.x, y: t.layout.y });
    }
  }

  const needsAuto = tables.filter((t) => !out.has(t.id));
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

  // Pass 2: auto-layout — offset dagre's coordinate space so the leftmost
  // node lands at (CLUSTER_PADDING, CLUSTER_PADDING + CLUSTER_LABEL_HEIGHT).
  // After this offset, positions are in the same cluster-relative space as
  // explicit ones above, which is what React Flow consumes.
  let dminX = Infinity;
  let dminY = Infinity;
  for (const t of needsAuto) {
    const p = g.node(t.id);
    if (p) {
      dminX = Math.min(dminX, p.x - NODE_W / 2);
      dminY = Math.min(dminY, p.y - NODE_H / 2);
    }
  }
  if (!Number.isFinite(dminX)) dminX = 0;
  if (!Number.isFinite(dminY)) dminY = 0;

  for (const t of needsAuto) {
    const p = g.node(t.id);
    out.set(t.id, {
      x: (p?.x ?? 0) - NODE_W / 2 - dminX + CLUSTER_PADDING,
      y:
        (p?.y ?? 0) -
        NODE_H / 2 -
        dminY +
        CLUSTER_PADDING +
        CLUSTER_LABEL_HEIGHT,
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
