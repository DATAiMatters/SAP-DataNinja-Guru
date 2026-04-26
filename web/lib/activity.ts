import "server-only";
import { desc, like } from "drizzle-orm";
import { db } from "./db";
import {
  annotations,
  comments,
  users,
  votes,
  type AnnotationKind,
  type AnnotationStatus,
} from "./db/schema";
import { eq } from "drizzle-orm";

export type ActivityKind = "vote" | "comment" | "annotation";

interface Common {
  id: string;
  kind: ActivityKind;
  createdAt: Date;
  userEmail: string;
  userName: string | null;
  targetId: string;
  targetType: string;
}

export interface VoteActivity extends Common {
  kind: "vote";
  value: -1 | 1;
}

export interface CommentActivity extends Common {
  kind: "comment";
  bodyMd: string;
  parentId: string | null;
}

export interface AnnotationActivity extends Common {
  kind: "annotation";
  annotationKind: AnnotationKind;
  status: AnnotationStatus;
  bodyMd: string;
}

export type ActivityItem =
  | VoteActivity
  | CommentActivity
  | AnnotationActivity;

export async function getDomainActivity(
  domainId: string,
  limit = 50,
): Promise<ActivityItem[]> {
  const prefix = `domain:${domainId}/%`;

  const [voteRows, commentRows, annoRows] = await Promise.all([
    db
      .select({
        id: votes.id,
        userEmail: users.email,
        userName: users.name,
        targetType: votes.targetType,
        targetId: votes.targetId,
        value: votes.value,
        createdAt: votes.createdAt,
      })
      .from(votes)
      .innerJoin(users, eq(votes.userId, users.id))
      .where(like(votes.targetId, prefix))
      .orderBy(desc(votes.createdAt))
      .limit(limit),
    db
      .select({
        id: comments.id,
        userEmail: users.email,
        userName: users.name,
        targetType: comments.targetType,
        targetId: comments.targetId,
        bodyMd: comments.bodyMd,
        parentId: comments.parentId,
        createdAt: comments.createdAt,
      })
      .from(comments)
      .innerJoin(users, eq(comments.userId, users.id))
      .where(like(comments.targetId, prefix))
      .orderBy(desc(comments.createdAt))
      .limit(limit),
    db
      .select({
        id: annotations.id,
        userEmail: users.email,
        userName: users.name,
        targetType: annotations.targetType,
        targetId: annotations.targetId,
        annotationKind: annotations.kind,
        status: annotations.status,
        bodyMd: annotations.bodyMd,
        createdAt: annotations.createdAt,
      })
      .from(annotations)
      .innerJoin(users, eq(annotations.userId, users.id))
      .where(like(annotations.targetId, prefix))
      .orderBy(desc(annotations.createdAt))
      .limit(limit),
  ]);

  const items: ActivityItem[] = [
    ...voteRows.map(
      (r): VoteActivity => ({
        ...r,
        kind: "vote",
        value: r.value as -1 | 1,
      }),
    ),
    ...commentRows.map(
      (r): CommentActivity => ({
        ...r,
        kind: "comment",
      }),
    ),
    ...annoRows.map(
      (r): AnnotationActivity => ({
        ...r,
        kind: "annotation",
      }),
    ),
  ];

  items.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  return items.slice(0, limit);
}

export function parseTargetId(
  targetId: string,
): { domainId: string; kind: string; id: string } | null {
  const m = targetId.match(/^domain:([^/]+)\/([^:]+):(.+)$/);
  if (!m) return null;
  return { domainId: m[1], kind: m[2], id: m[3] };
}
