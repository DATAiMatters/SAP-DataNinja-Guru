import "server-only";
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { and, desc, eq } from "drizzle-orm";
import { db } from "./db";
import {
  annotations,
  users,
  type AnnotationKind,
  type AnnotationStatus,
  type TargetType,
} from "./db/schema";
import { invalidateDomainCache } from "./yaml";
import {
  insertAnnotation,
  type ListAnnotationKind,
} from "./yaml-write-annotation";

const REPO_ROOT = resolve(process.cwd(), "..");
const DOMAINS_DIR = join(REPO_ROOT, "domains");

export interface AnnotationView {
  id: string;
  userId: string;
  userEmail: string;
  userName: string | null;
  kind: AnnotationKind;
  bodyMd: string;
  severity: string | null;
  title: string | null;
  status: AnnotationStatus;
  createdAt: Date;
}

export async function getAnnotationsFor(
  targetId: string,
): Promise<AnnotationView[]> {
  const rows = await db
    .select({
      id: annotations.id,
      userId: annotations.userId,
      userEmail: users.email,
      userName: users.name,
      kind: annotations.kind,
      bodyMd: annotations.bodyMd,
      severity: annotations.severity,
      title: annotations.title,
      status: annotations.status,
      createdAt: annotations.createdAt,
    })
    .from(annotations)
    .innerJoin(users, eq(annotations.userId, users.id))
    .where(eq(annotations.targetId, targetId))
    .orderBy(desc(annotations.createdAt));
  return rows;
}

export async function createAnnotation(opts: {
  userId: string;
  targetType: TargetType;
  targetId: string;
  kind: AnnotationKind;
  bodyMd: string;
  severity?: string;
  title?: string;
}): Promise<{ id: string }> {
  const trimmed = opts.bodyMd.trim();
  if (!trimmed) throw new Error("body required");
  if (trimmed.length > 8000) throw new Error("body too long (8000 char max)");
  if (
    opts.severity &&
    !["low", "medium", "high"].includes(opts.severity)
  ) {
    throw new Error("severity must be low|medium|high");
  }
  const inserted = await db
    .insert(annotations)
    .values({
      userId: opts.userId,
      targetType: opts.targetType,
      targetId: opts.targetId,
      kind: opts.kind,
      bodyMd: trimmed,
      severity: opts.severity ?? null,
      title: opts.title ?? null,
    })
    .returning({ id: annotations.id });
  return inserted[0];
}

export async function updateAnnotationStatus(
  id: string,
  status: AnnotationStatus,
): Promise<boolean> {
  const result = await db
    .update(annotations)
    .set({ status })
    .where(eq(annotations.id, id))
    .returning({ id: annotations.id });
  return result.length > 0;
}

export async function deleteAnnotation(
  id: string,
  userId: string,
): Promise<boolean> {
  const result = await db
    .delete(annotations)
    .where(and(eq(annotations.id, id), eq(annotations.userId, userId)))
    .returning({ id: annotations.id });
  return result.length > 0;
}

/**
 * Promote an accepted annotation into the curated YAML.
 * Writes the annotation as a list item in the appropriate table block,
 * marks the annotation as "promoted", and invalidates the domain cache.
 *
 * Does NOT git commit / push / open PR — leaves that to the maintainer
 * so the curator-tier human approval is preserved.
 */
export async function promoteAnnotationToYaml(
  annotationId: string,
): Promise<{ targetId: string; tableId: string; domainId: string }> {
  const rows = await db
    .select()
    .from(annotations)
    .where(eq(annotations.id, annotationId))
    .limit(1);
  if (rows.length === 0) throw new Error("annotation not found");
  const a = rows[0];
  if (a.status !== "accepted") {
    throw new Error(
      `annotation must be 'accepted' before promote (current: ${a.status})`,
    );
  }
  if (a.targetType !== "table") {
    throw new Error(
      `promote currently supports table-level annotations only (target_type=${a.targetType})`,
    );
  }
  if (!isListKind(a.kind)) {
    throw new Error(`promote currently supports gotcha/s4_change/note (got ${a.kind})`);
  }
  const { domainId, tableId } = parseTableTargetId(a.targetId);
  const filePath = join(DOMAINS_DIR, `${domainId}.yaml`);
  const before = readFileSync(filePath, "utf-8");
  const after = insertAnnotation(before, tableId, {
    kind: a.kind,
    text: a.bodyMd,
    severity: (a.severity as "low" | "medium" | "high" | null) ?? undefined,
  });
  writeFileSync(filePath, after, "utf-8");
  invalidateDomainCache();
  await db
    .update(annotations)
    .set({ status: "promoted" })
    .where(eq(annotations.id, annotationId));
  return { targetId: a.targetId, tableId, domainId };
}

function isListKind(kind: AnnotationKind): kind is ListAnnotationKind {
  return kind === "gotcha" || kind === "s4_change" || kind === "note";
}

function parseTableTargetId(targetId: string): {
  domainId: string;
  tableId: string;
} {
  // Format: "domain:<id>/table:<tableId>"
  const m = targetId.match(/^domain:([^/]+)\/table:(.+)$/);
  if (!m) throw new Error(`unrecognized targetId format: ${targetId}`);
  return { domainId: m[1], tableId: m[2] };
}
