import "server-only";
import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "./db";
import { comments, users, type TargetType } from "./db/schema";
import { renderMarkdown } from "./markdown";

export interface CommentView {
  id: string;
  userId: string;
  userEmail: string;
  userName: string | null;
  bodyMd: string;
  bodyHtml: string;
  createdAt: Date;
  parentId: string | null;
  // For top-level comments only — populated by buildThreads.
  replies: CommentView[];
}

export async function getCommentsFor(targetId: string): Promise<CommentView[]> {
  const rows = await db
    .select({
      id: comments.id,
      userId: comments.userId,
      userEmail: users.email,
      userName: users.name,
      bodyMd: comments.bodyMd,
      createdAt: comments.createdAt,
      parentId: comments.parentId,
    })
    .from(comments)
    .innerJoin(users, eq(comments.userId, users.id))
    .where(eq(comments.targetId, targetId))
    .orderBy(comments.createdAt);

  const items: CommentView[] = rows.map((r) => ({
    ...r,
    bodyHtml: renderMarkdown(r.bodyMd),
    replies: [],
  }));

  // Two-pass: collect replies under their parents, top-level comments returned.
  const byId = new Map<string, CommentView>();
  for (const c of items) byId.set(c.id, c);
  const top: CommentView[] = [];
  for (const c of items) {
    if (c.parentId && byId.has(c.parentId)) {
      byId.get(c.parentId)!.replies.push(c);
    } else {
      top.push(c);
    }
  }
  return top;
}

export async function createComment(opts: {
  userId: string;
  targetType: TargetType;
  targetId: string;
  bodyMd: string;
  parentId?: string | null;
}): Promise<{ id: string }> {
  const trimmed = opts.bodyMd.trim();
  if (!trimmed) throw new Error("body required");
  if (trimmed.length > 8000) throw new Error("body too long (8000 char max)");

  // If parentId is provided, enforce single-level nesting: the parent must
  // itself be a top-level comment (no parent).
  if (opts.parentId) {
    const parent = await db
      .select({ parentId: comments.parentId })
      .from(comments)
      .where(eq(comments.id, opts.parentId))
      .limit(1);
    if (parent.length === 0) throw new Error("parent comment not found");
    if (parent[0].parentId !== null) {
      throw new Error("only one level of nesting allowed");
    }
  }

  const inserted = await db
    .insert(comments)
    .values({
      userId: opts.userId,
      targetType: opts.targetType,
      targetId: opts.targetId,
      bodyMd: trimmed,
      parentId: opts.parentId ?? null,
    })
    .returning({ id: comments.id });
  return inserted[0];
}

export async function deleteComment(
  id: string,
  userId: string,
): Promise<boolean> {
  const result = await db
    .delete(comments)
    .where(and(eq(comments.id, id), eq(comments.userId, userId)))
    .returning({ id: comments.id });
  return result.length > 0;
}
