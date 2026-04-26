import MiniSearch, { type Options } from "minisearch";
import { loadAllDomains } from "./yaml";
import { targetId } from "./target-id";

export interface SearchDoc {
  id: string;             // canonical target id (Phase 4 stable key)
  domainId: string;
  domainName: string;
  tableId: string;
  tableName: string;
  cluster: string;
  href: string;
  // Indexed text fields
  name: string;
  description: string;
  fields: string;
  gotchas: string;
  s4Changes: string;
  notes: string;
  // For snippet rendering
  gotchaCount: number;
}

// Shared between the server (build-time index construction) and the client
// (MiniSearch.loadJSON). Must stay in lockstep.
export const MINISEARCH_OPTIONS: Options<SearchDoc> = {
  fields: [
    "tableId",
    "name",
    "description",
    "fields",
    "gotchas",
    "s4Changes",
    "notes",
  ],
  storeFields: [
    "domainId",
    "domainName",
    "tableId",
    "tableName",
    "cluster",
    "href",
    "name",
    "gotchas",
    "gotchaCount",
  ],
  searchOptions: {
    boost: { tableId: 4, name: 2, gotchas: 1.5 },
    prefix: true,
    fuzzy: 0.2,
  },
};

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
