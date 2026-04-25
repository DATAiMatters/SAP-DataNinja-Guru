import { loadClusters } from "./yaml";
import type { Cluster } from "./schema-types";

let lookup: Map<string, Cluster> | null = null;

function ensure(): Map<string, Cluster> {
  if (lookup) return lookup;
  lookup = new Map(loadClusters().clusters.map((c) => [c.id, c]));
  return lookup;
}

export function getCluster(id: string): Cluster | undefined {
  return ensure().get(id);
}

export function getClusterColor(id: string): string {
  return ensure().get(id)?.color ?? "#f5f5f5";
}

export function getClusterName(id: string): string {
  return ensure().get(id)?.name ?? id;
}

// Approximation; renderers can compute a darker stroke from fill if needed.
export function getClusterStroke(_id: string): string {
  return "#888888";
}
