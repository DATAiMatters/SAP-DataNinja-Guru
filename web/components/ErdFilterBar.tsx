"use client";
import { type Dispatch, type SetStateAction } from "react";

export interface EdgeFilters {
  simple: boolean;
  polymorphicDirect: boolean;
  polymorphicViaInob: boolean;
}

export const DEFAULT_EDGE_FILTERS: EdgeFilters = {
  simple: true,
  polymorphicDirect: true,
  polymorphicViaInob: true,
};

interface ClusterOption {
  id: string;
  name: string;
  color: string;
}

interface Props {
  clusters: ClusterOption[];
  hiddenClusters: Set<string>;
  setHiddenClusters: Dispatch<SetStateAction<Set<string>>>;
  edgeFilters: EdgeFilters;
  setEdgeFilters: Dispatch<SetStateAction<EdgeFilters>>;
  klarts: string[];
  hiddenKlarts: Set<string>;
  setHiddenKlarts: Dispatch<SetStateAction<Set<string>>>;
}

export default function ErdFilterBar({
  clusters,
  hiddenClusters,
  setHiddenClusters,
  edgeFilters,
  setEdgeFilters,
  klarts,
  hiddenKlarts,
  setHiddenKlarts,
}: Props) {
  const toggleCluster = (id: string) => {
    setHiddenClusters((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const toggleKlart = (k: string) => {
    setHiddenKlarts((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  };
  const toggleEdge = (key: keyof EdgeFilters) => {
    setEdgeFilters((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  return (
    <div className="erd-filter-bar">
      <div className="erd-filter-group">
        <span className="erd-filter-label">Clusters</span>
        {clusters.map((c) => {
          const off = hiddenClusters.has(c.id);
          return (
            <button
              key={c.id}
              type="button"
              className={`erd-chip${off ? " erd-chip-off" : ""}`}
              onClick={() => toggleCluster(c.id)}
              style={
                off
                  ? undefined
                  : { background: c.color, borderColor: "#888" }
              }
            >
              {c.name}
            </button>
          );
        })}
      </div>

      <div className="erd-filter-group">
        <span className="erd-filter-label">Edges</span>
        <button
          type="button"
          className={`erd-chip${!edgeFilters.simple ? " erd-chip-off" : ""}`}
          onClick={() => toggleEdge("simple")}
        >
          Direct joins
        </button>
        <button
          type="button"
          className={`erd-chip${!edgeFilters.polymorphicDirect ? " erd-chip-off" : ""}`}
          onClick={() => toggleEdge("polymorphicDirect")}
        >
          Polymorphic (direct)
        </button>
        <button
          type="button"
          className={`erd-chip${!edgeFilters.polymorphicViaInob ? " erd-chip-off" : ""}`}
          onClick={() => toggleEdge("polymorphicViaInob")}
        >
          Polymorphic (via INOB)
        </button>
      </div>

      {klarts.length > 0 && (
        <div className="erd-filter-group">
          <span className="erd-filter-label">KLART</span>
          {klarts.map((k) => {
            const off = hiddenKlarts.has(k);
            return (
              <button
                key={k}
                type="button"
                className={`erd-chip erd-chip-mono${off ? " erd-chip-off" : ""}`}
                onClick={() => toggleKlart(k)}
              >
                {k}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
