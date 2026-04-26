// Server-only: builds the MiniSearch index from the YAML loader.
// Do NOT import this from a client component — use lib/search-shared.ts
// for types and options that the client also needs.
import "server-only";
import MiniSearch from "minisearch";
import { loadAllDomains } from "./yaml";
import { targetId } from "./target-id";
import { MINISEARCH_OPTIONS, type SearchDoc } from "./search-shared";

export type { SearchDoc };
export { MINISEARCH_OPTIONS };

export function buildSearchDocs(): SearchDoc[] {
  const docs: SearchDoc[] = [];
  for (const domain of loadAllDomains().values()) {
    for (const t of domain.tables) {
      docs.push({
        id: targetId(domain.domain.id, "table", t.id),
        domainId: domain.domain.id,
        domainName: domain.domain.name,
        tableId: t.id,
        tableName: t.name,
        cluster: t.cluster,
        href: `/domains/${domain.domain.id}/${t.id}`,
        name: t.name,
        description: t.description ?? "",
        fields: (t.fields ?? [])
          .map((f) => `${f.name} ${f.description ?? ""}`)
          .join("\n"),
        gotchas: (t.gotchas ?? []).map((g) => g.text).join("\n"),
        s4Changes: (t.s4_changes ?? []).map((g) => g.text).join("\n"),
        notes: t.notes ?? "",
        gotchaCount: t.gotchas?.length ?? 0,
      });
    }
  }
  return docs;
}

export function buildSearchIndex(): MiniSearch<SearchDoc> {
  const ms = new MiniSearch<SearchDoc>(MINISEARCH_OPTIONS);
  ms.addAll(buildSearchDocs());
  return ms;
}

export function serializeSearchIndex(): string {
  return JSON.stringify(buildSearchIndex().toJSON());
}
