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

type EntityNodeData = {
  label: string;
  tableName?: string;
  clusterColor?: string;
};

type ClusterNodeData = {
  label: string;
  clusterColor?: string;
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
  const edges = useMemo(
    () => initialEdges as unknown as Edge[],
    [initialEdges],
  );
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const lastError = useRef<string | null>(null);
  const router = useRouter();

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
    <div className="erd-container">
      {saveStatus !== "idle" && (
        <div
          className={`erd-save-status erd-save-${saveStatus}`}
          title={saveStatus === "error" ? lastError.current ?? "" : undefined}
        >
          {saveStatus === "saving" && "Saving…"}
          {saveStatus === "saved" && "✓ Saved to YAML"}
          {saveStatus === "error" && "⚠ Save failed (see console)"}
        </div>
      )}
      <ReactFlow
        nodes={nodes}
        edges={edges}
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
  );
}
