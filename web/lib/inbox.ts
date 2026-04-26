import "server-only";
import { desc, eq } from "drizzle-orm";
import { db } from "./db";
import { annotations, users, type AnnotationStatus } from "./db/schema";

export interface InboxAnnotation {
  id: string;
  userEmail: string;
  userName: string | null;
  targetType: string;
  targetId: string;
  kind: "gotcha" | "sql_example" | "s4_change" | "note";
  bodyMd: string;
  severity: string | null;
  title: string | null;
  status: AnnotationStatus;
  createdAt: Date;
}

export async function getInboxAnnotations(
  status?: AnnotationStatus,
): Promise<InboxAnnotation[]> {
  const query = db
    .select({
      id: annotations.id,
      userEmail: users.email,
      userName: users.name,
      targetType: annotations.targetType,
      targetId: annotations.targetId,
      kind: annotations.kind,
      bodyMd: annotations.bodyMd,
      severity: annotations.severity,
      title: annotations.title,
      status: annotations.status,
      createdAt: annotations.createdAt,
    })
    .from(annotations)
    .innerJoin(users, eq(annotations.userId, users.id))
    .orderBy(desc(annotations.createdAt))
    .limit(200);
  return status
    ? await query.where(eq(annotations.status, status))
    : await query;
}

export async function getInboxCounts(): Promise<
  Record<AnnotationStatus, number>
> {
  const rows = await db
    .select({
      status: annotations.status,
      // Drizzle 0.36 doesn't expose count() neatly across dialects without
      // sql tag — count manually below.
      id: annotations.id,
    })
    .from(annotations);
  const out: Record<AnnotationStatus, number> = {
    proposed: 0,
    accepted: 0,
    rejected: 0,
    promoted: 0,
  };
  for (const r of rows) {
    out[r.status as AnnotationStatus] =
      (out[r.status as AnnotationStatus] ?? 0) + 1;
  }
  return out;
}

export function parseTargetId(targetId: string): {
  domainId: string;
  kind: string;
  id: string;
} | null {
  const m = targetId.match(/^domain:([^/]+)\/([^:]+):(.+)$/);
  if (!m) return null;
  return { domainId: m[1], kind: m[2], id: m[3] };
}
