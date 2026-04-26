"use client";
import { useCallback, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  applyNodeChanges,
  Background,
  Controls,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeChange,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { ErdEdge, ErdNode } from "@/lib/erd-layout";
import ErdFilterBar, {
  DEFAULT_EDGE_FILTERS,
  type EdgeFilters,
} from "./ErdFilterBar";

type EntityNodeData = {
  label: string;
  tableName?: string;
  clusterColor?: string;
  clusterId?: string;
};

type ClusterNodeData = {
  label: string;
  clusterColor?: string;
  clusterId?: string;
};

function EntityNode({ data }: NodeProps) {
  const d = data as EntityNodeData;
  return (
    <div
      className="erd-entity"
      style={{ background: d.clusterColor ?? "white" }}
    >
      <Handle
        type="target"
        position={Position.Left}
        className="erd-handle"
      />
      <div className="erd-entity-id">{d.label}</div>
      {d.tableName && (
        <div className="erd-entity-name" title={d.tableName}>
          {d.tableName}
        </div>
      )}
      <Handle
        type="source"
        position={Position.Right}
        className="erd-handle"
      />
    </div>
  );
}

function ClusterNode({ data }: NodeProps) {
  const d = data as ClusterNodeData;
  return (
    <div
      className="erd-cluster"
      style={{ background: d.clusterColor ?? "#f5f5f5" }}
    >
      <div className="erd-cluster-label">{d.label}</div>
    </div>
  );
}

const nodeTypes = { entity: EntityNode, cluster: ClusterNode };

type SaveStatus = "idle" | "saving" | "saved" | "error";

export default function InteractiveErd({
  domainId,
  nodes: initialNodes,
  edges: initialEdges,
}: {
  domainId: string;
  nodes: ErdNode[];
  edges: ErdEdge[];
}) {
  const [nodes, setNodes] = useState<Node[]>(
    () => initialNodes as unknown as Node[],
  );
  const baseEdges = useMemo(
    () => initialEdges as unknown as Edge[],
    [initialEdges],
  );
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const lastError = useRef<string | null>(null);
  const router = useRouter();

  // Filter state
  const clusters = useMemo(
    () =>
      initialNodes
        .filter((n) => n.type === "cluster")
        .map((n) => ({
          id: (n.data.clusterId as string) ?? n.id.replace(/^cluster:/, ""),
          name: n.data.label,
          color: (n.data.clusterColor as string) ?? "#f5f5f5",
        })),
    [initialNodes],
  );
  const klarts = useMemo(() => {
    const set = new Set<string>();
    for (const e of initialEdges) {
      if (e.data.type === "polymorphic" && e.data.klart) {
        set.add(e.data.klart);
      }
    }
    return Array.from(set).sort();
  }, [initialEdges]);

  const [hiddenClusters, setHiddenClusters] = useState<Set<string>>(
    () => new Set(),
  );
  const [hiddenKlarts, setHiddenKlarts] = useState<Set<string>>(
    () => new Set(),
  );
  const [edgeFilters, setEdgeFilters] = useState<EdgeFilters>(
    DEFAULT_EDGE_FILTERS,
  );

  const filteredNodes = useMemo(() => {
    return nodes.map((n) => {
      const d = n.data as EntityNodeData | ClusterNodeData;
      const cid = d.clusterId;
      const hidden = cid ? hiddenClusters.has(cid) : false;
      return { ...n, hidden };
    });
  }, [nodes, hiddenClusters]);

  const filteredEdges = useMemo(() => {
    const hiddenNodeIds = new Set(
      filteredNodes.filter((n) => n.hidden).map((n) => n.id),
    );
    return baseEdges.map((e) => {
      const data = e.data as ErdEdge["data"];
      let hidden = false;
      if (data.type === "simple" && !edgeFilters.simple) hidden = true;
      if (data.type === "polymorphic") {
        if (data.via_inob && !edgeFilters.polymorphicViaInob) hidden = true;
        if (!data.via_inob && !edgeFilters.polymorphicDirect) hidden = true;
        if (data.klart && hiddenKlarts.has(data.klart)) hidden = true;
      }
      if (hiddenNodeIds.has(e.source) || hiddenNodeIds.has(e.target)) {
        hidden = true;
      }
      return { ...e, hidden };
    });
  }, [baseEdges, edgeFilters, hiddenKlarts, filteredNodes]);

  const onNodesChange = useCallback((changes: NodeChange[]) => {
    setNodes((current) => applyNodeChanges(changes, current));
  }, []);

  const onNodeClick = useCallback(
    (event: React.MouseEvent, node: Node) => {
      if (node.type !== "entity") return;
      const href = `/domains/${encodeURIComponent(domainId)}/${encodeURIComponent(node.id)}`;
      if (event.metaKey || event.ctrlKey) {
        window.open(href, "_blank", "noopener,noreferrer");
      } else {
        router.push(href);
      }
    },
    [domainId, router],
  );

  const onNodeDragStop = useCallback(
    async (_event: React.MouseEvent, node: Node) => {
      if (node.type !== "entity") return;
      setSaveStatus("saving");
      try {
        const res = await fetch(
          `/api/domains/${encodeURIComponent(domainId)}/layout`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              tableId: node.id,
              x: Math.round(node.position.x),
              y: Math.round(node.position.y),
            }),
          },
        );
        if (!res.ok) {
          const text = await res.text();
          throw new Error(text || `HTTP ${res.status}`);
        }
        setSaveStatus("saved");
        setTimeout(() => {
          setSaveStatus((s) => (s === "saved" ? "idle" : s));
        }, 1500);
      } catch (e) {
        lastError.current = e instanceof Error ? e.message : String(e);
        setSaveStatus("error");
        // eslint-disable-next-line no-console
        console.error("layout save failed:", lastError.current);
      }
    },
    [domainId],
  );

  return (
    <div>
      <ErdFilterBar
        clusters={clusters}
        hiddenClusters={hiddenClusters}
        setHiddenClusters={setHiddenClusters}
        edgeFilters={edgeFilters}
        setEdgeFilters={setEdgeFilters}
        klarts={klarts}
        hiddenKlarts={hiddenKlarts}
        setHiddenKlarts={setHiddenKlarts}
      />
      <div className="erd-container">
        {saveStatus !== "idle" && (
          <div
            className={`erd-save-status erd-save-${saveStatus}`}
            title={
              saveStatus === "error" ? lastError.current ?? "" : undefined
            }
          >
            {saveStatus === "saving" && "Saving…"}
            {saveStatus === "saved" && "✓ Saved to YAML"}
            {saveStatus === "error" && "⚠ Save failed (see console)"}
          </div>
        )}
        <ReactFlow
          nodes={filteredNodes}
          edges={filteredEdges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onNodeDragStop={onNodeDragStop}
          onNodeClick={onNodeClick}
          fitView
          fitViewOptions={{ padding: 0.1 }}
          attributionPosition="bottom-right"
          minZoom={0.2}
          maxZoom={2}
        >
          <Background gap={16} />
          <Controls />
          <MiniMap pannable zoomable />
        </ReactFlow>
      </div>
    </div>
  );
}
