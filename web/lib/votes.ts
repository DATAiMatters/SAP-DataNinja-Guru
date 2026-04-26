import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "./db";
import { votes, type TargetType } from "./db/schema";

export interface VoteSummary {
  score: number;
  userValue: -1 | 0 | 1;
}

export async function getVoteSummary(
  targetId: string,
  userId?: string,
): Promise<VoteSummary> {
  const rows = await db
    .select({ value: votes.value, userId: votes.userId })
    .from(votes)
    .where(eq(votes.targetId, targetId));
  const score = rows.reduce((s, v) => s + v.value, 0);
  const userValue = userId
    ? (rows.find((v) => v.userId === userId)?.value as -1 | 1 | undefined) ?? 0
    : 0;
  return { score, userValue };
}

export async function getVoteSummaries(
  targetIds: string[],
  userId?: string,
): Promise<Map<string, VoteSummary>> {
  if (targetIds.length === 0) return new Map();
  const rows = await db
    .select({
      targetId: votes.targetId,
      value: votes.value,
      userId: votes.userId,
    })
    .from(votes);
  const wanted = new Set(targetIds);
  const out = new Map<string, VoteSummary>();
  for (const id of targetIds) {
    out.set(id, { score: 0, userValue: 0 });
  }
  for (const r of rows) {
    if (!wanted.has(r.targetId)) continue;
    const s = out.get(r.targetId)!;
    s.score += r.value;
    if (userId && r.userId === userId) {
      s.userValue = r.value as -1 | 1;
    }
  }
  return out;
}

export async function castVote(
  userId: string,
  targetType: TargetType,
  targetId: string,
  value: -1 | 0 | 1,
): Promise<void> {
  // Always clear an existing vote first; insert new value if non-zero.
  // Simpler than UPSERT semantics, fine for low-volume table.
  await db
    .delete(votes)
    .where(and(eq(votes.userId, userId), eq(votes.targetId, targetId)));
  if (value !== 0) {
    await db.insert(votes).values({
      userId,
      targetType,
      targetId,
      value,
    });
  }
}
