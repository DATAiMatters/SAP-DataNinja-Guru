"use client";
import { useMemo } from "react";
import {
  Background,
  Controls,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  type Edge,
  type Node,
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

export default function InteractiveErd({
  nodes: initialNodes,
  edges: initialEdges,
}: {
  domainId: string;
  nodes: ErdNode[];
  edges: ErdEdge[];
}) {
  const nodes = useMemo(() => initialNodes as unknown as Node[], [initialNodes]);
  const edges = useMemo(() => initialEdges as unknown as Edge[], [initialEdges]);

  return (
    <div className="erd-container">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
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
