import { readFileSync, readdirSync } from "node:fs";
import { join, basename, extname, resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";
import type { DomainFile, ClusterRegistry } from "./schema-types";
import schema from "../../schema.json";

// Repo root sits one level above /web/. process.cwd() is /web/ when next
// dev/build/start runs from there.
const REPO_ROOT = resolve(process.cwd(), "..");
const DOMAINS_DIR = join(REPO_ROOT, "domains");
const CLUSTERS_PATH = join(REPO_ROOT, "clusters.yaml");

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const validate = ajv.compile<DomainFile>(schema);

let domainCache: Map<string, DomainFile> | null = null;
let clustersCache: ClusterRegistry | null = null;

function loadDomain(filePath: string): DomainFile {
  const raw = readFileSync(filePath, "utf-8");
  const data = parseYaml(raw) as unknown;
  if (!validate(data)) {
    const errors = (validate.errors ?? [])
      .map((e) => `  ${e.instancePath || "<root>"}: ${e.message}`)
      .join("\n");
    throw new Error(
      `Schema validation failed for ${basename(filePath)}:\n${errors}`,
    );
  }
  return data as DomainFile;
}

export function loadAllDomains(): Map<string, DomainFile> {
  if (domainCache) return domainCache;
  const files = readdirSync(DOMAINS_DIR).filter((f) => {
    const ext = extname(f);
    return ext === ".yaml" || ext === ".yml";
  });
  const map = new Map<string, DomainFile>();
  for (const f of files) {
    const domain = loadDomain(join(DOMAINS_DIR, f));
    if (map.has(domain.domain.id)) {
      throw new Error(`Duplicate domain id "${domain.domain.id}" in ${f}`);
    }
    map.set(domain.domain.id, domain);
  }
  domainCache = map;
  return map;
}

export function loadClusters(): ClusterRegistry {
  if (clustersCache) return clustersCache;
  const raw = readFileSync(CLUSTERS_PATH, "utf-8");
  clustersCache = parseYaml(raw) as ClusterRegistry;
  return clustersCache;
}

// Used by the layout-write API after mutating a domain YAML on disk so
// subsequent reads see fresh data.
export function invalidateDomainCache(): void {
  domainCache = null;
}
