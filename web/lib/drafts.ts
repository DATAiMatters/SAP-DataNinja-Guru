import "server-only";
import { readFile, writeFile, access } from "node:fs/promises";
import { constants } from "node:fs";
import { join, resolve } from "node:path";
import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";
import { parse as parseYaml } from "yaml";
import schema from "../../schema.json";
import { invalidateDomainCache, loadClusters } from "./yaml";
import type { DomainFile } from "./schema-types";

const REPO_ROOT = resolve(process.cwd(), "..");
const DOMAINS_DIR = join(REPO_ROOT, "domains");
const DRAFTS_DIR = resolve(REPO_ROOT, "generated", "drafts");

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const validate = ajv.compile<DomainFile>(schema);

function assertInsideDrafts(absPath: string): string {
  const resolved = resolve(absPath);
  if (resolved !== DRAFTS_DIR && !resolved.startsWith(DRAFTS_DIR + "/")) {
    throw new Error("draft path outside generated/drafts/");
  }
  return resolved;
}

export async function readDraft(absPath: string): Promise<string> {
  const safe = assertInsideDrafts(absPath);
  return await readFile(safe, "utf-8");
}

export interface ValidationResult {
  ok: boolean;
  parsed?: DomainFile;
  errors: string[];
}

export function validateDraftText(text: string): ValidationResult {
  const errors: string[] = [];
  let parsed: unknown;
  try {
    parsed = parseYaml(text);
  } catch (e) {
    return {
      ok: false,
      errors: [
        `YAML parse: ${e instanceof Error ? e.message : String(e)}`,
      ],
    };
  }
  if (!validate(parsed)) {
    for (const err of validate.errors ?? []) {
      errors.push(`${err.instancePath || "<root>"}: ${err.message}`);
    }
  }
  // Cluster reference check (same rule the CI script enforces).
  const known = new Set(loadClusters().clusters.map((c) => c.id));
  const data = parsed as DomainFile | undefined;
  for (const t of data?.tables ?? []) {
    if (t?.cluster && !known.has(t.cluster)) {
      errors.push(
        `tables/<id=${t.id}>/cluster: "${t.cluster}" not in clusters.yaml`,
      );
    }
  }
  return {
    ok: errors.length === 0,
    parsed: errors.length === 0 ? (parsed as DomainFile) : undefined,
    errors,
  };
}

export async function applyDraft(
  draftAbsPath: string,
  targetDomainId: string,
): Promise<{ targetRelPath: string }> {
  const text = await readDraft(draftAbsPath);
  const v = validateDraftText(text);
  if (!v.ok) {
    throw new Error("validation failed:\n" + v.errors.join("\n"));
  }
  if (v.parsed?.domain.id && v.parsed.domain.id !== targetDomainId) {
    // The proposed YAML's internal id should match the URL slug we'll save it
    // as. If not, refuse — a maintainer needs to reconcile.
    throw new Error(
      `domain.id in YAML ("${v.parsed.domain.id}") does not match target id ("${targetDomainId}"). Edit the draft to match.`,
    );
  }
  const targetPath = join(DOMAINS_DIR, `${targetDomainId}.yaml`);

  let exists = false;
  try {
    await access(targetPath, constants.F_OK);
    exists = true;
  } catch (e) {
    if (
      e instanceof Error &&
      (e as NodeJS.ErrnoException).code !== "ENOENT"
    ) {
      throw e;
    }
  }
  if (exists) {
    throw new Error(
      `target already exists: domains/${targetDomainId}.yaml`,
    );
  }

  await writeFile(targetPath, text, "utf-8");
  invalidateDomainCache();
  return { targetRelPath: `domains/${targetDomainId}.yaml` };
}
