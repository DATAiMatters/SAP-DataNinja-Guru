import "server-only";
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { createComment, deleteComment } from "@/lib/comments";
import type { TargetType } from "@/lib/db/schema";

const ALLOWED_TYPES: TargetType[] = [
  "table",
  "relationship",
  "gotcha",
  "sql_example",
  "annotation",
];

interface PostBody {
  targetType?: unknown;
  targetId?: unknown;
  bodyMd?: unknown;
  parentId?: unknown;
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "sign in required" }, { status: 401 });
  }

  let body: PostBody;
  try {
    body = (await request.json()) as PostBody;
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  if (
    typeof body.targetType !== "string" ||
    typeof body.targetId !== "string" ||
    typeof body.bodyMd !== "string"
  ) {
    return NextResponse.json(
      { error: "targetType, targetId, bodyMd required" },
      { status: 400 },
    );
  }
  if (!ALLOWED_TYPES.includes(body.targetType as TargetType)) {
    return NextResponse.json(
      { error: `targetType must be one of ${ALLOWED_TYPES.join(", ")}` },
      { status: 400 },
    );
  }
  if (body.parentId != null && typeof body.parentId !== "string") {
    return NextResponse.json({ error: "parentId must be a string" }, { status: 400 });
  }

  try {
    const result = await createComment({
      userId: session.user.id,
      targetType: body.targetType as TargetType,
      targetId: body.targetId,
      bodyMd: body.bodyMd,
      parentId: (body.parentId as string) ?? null,
    });
    return NextResponse.json({ ok: true, id: result.id });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 400 },
    );
  }
}

export async function DELETE(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "sign in required" }, { status: 401 });
  }
  const url = new URL(request.url);
  const id = url.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }
  const deleted = await deleteComment(id, session.user.id);
  if (!deleted) {
    return NextResponse.json(
      { error: "not found or not yours" },
      { status: 404 },
    );
  }
  return NextResponse.json({ ok: true });
}
