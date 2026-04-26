// Types and MiniSearch options shared between server (build-time index
// construction) and client (CommandK rehydrating via MiniSearch.loadJSON).
// Importing this from a client component must NOT pull in Node-only deps.
import type { Options } from "minisearch";

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
