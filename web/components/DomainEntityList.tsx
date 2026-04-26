"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import type { Table } from "@/lib/schema-types";

export interface ClusterMeta {
  id: string;
  name: string;
  color: string;
}

interface Props {
  domainId: string;
  entities: Table[];
  // Pre-computed in cluster discovery order so the rendered groups stay stable.
  clusters: ClusterMeta[];
}

export default function DomainEntityList({
  domainId,
  entities,
  clusters,
}: Props) {
  const [q, setQ] = useState("");
  const term = q.trim().toLowerCase();

  const colorFor = useMemo(
    () => new Map(clusters.map((c) => [c.id, c.color])),
    [clusters],
  );

  const filtered = useMemo(() => {
    if (!term) return entities;
    return entities.filter((t) => matchesTerm(t, term));
  }, [term, entities]);

  const grouped = useMemo(() => {
    const map = new Map<string, Table[]>();
    for (const t of filtered) {
      if (!map.has(t.cluster)) map.set(t.cluster, []);
      map.get(t.cluster)!.push(t);
    }
    return clusters
      .filter((c) => map.has(c.id))
      .map((c) => ({ cluster: c, tables: map.get(c.id)! }));
  }, [filtered, clusters]);

  return (
    <>
      <div className="domain-filter-bar">
        <input
          type="search"
          className="domain-filter-input"
          placeholder={`Filter ${entities.length} entities — id, name, field, gotcha…`}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          autoComplete="off"
          spellCheck={false}
        />
        {term && (
          <span className="muted domain-filter-count">
            {filtered.length} of {entities.length}
          </span>
        )}
      </div>

      {grouped.length === 0 ? (
        <p className="muted">No entities match.</p>
      ) : (
        grouped.map(({ cluster, tables }) => (
          <section key={cluster.id} className="cluster-section">
            <h2 className="cluster-heading">
              <span
                className="cluster-swatch"
                style={{ background: cluster.color }}
                aria-hidden="true"
              />
              {cluster.name}
            </h2>
            <ul className="entity-grid">
              {tables.map((t) => (
                <li
                  key={t.id}
                  className="entity-card"
                  style={{ background: colorFor.get(t.cluster) ?? "#f5f5f5" }}
                >
                  <Link
                    href={`/domains/${domainId}/${t.id}`}
                    className="entity-link"
                  >
                    <code className="entity-id">{t.id}</code>
                    <span className="entity-name">{t.name}</span>
                  </Link>
                  {(t.gotchas?.length ?? 0) > 0 && (
                    <span
                      className="gotcha-flag"
                      title={`${t.gotchas!.length} gotcha(s)`}
                    >
                      ⚠ {t.gotchas!.length}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </>
  );
}

function matchesTerm(t: Table, term: string): boolean {
  if (t.id.toLowerCase().includes(term)) return true;
  if (t.name.toLowerCase().includes(term)) return true;
  if (t.cluster.toLowerCase().includes(term)) return true;
  if (t.description?.toLowerCase().includes(term)) return true;
  if (t.notes?.toLowerCase().includes(term)) return true;
  if (t.fields?.some((f) => f.name.toLowerCase().includes(term))) return true;
  if (t.fields?.some((f) => f.description?.toLowerCase().includes(term)))
    return true;
  if (t.gotchas?.some((g) => g.text.toLowerCase().includes(term))) return true;
  if (t.s4_changes?.some((g) => g.text.toLowerCase().includes(term)))
    return true;
  return false;
}
