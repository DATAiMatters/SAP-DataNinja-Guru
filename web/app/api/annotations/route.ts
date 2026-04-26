import "server-only";
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { createAnnotation } from "@/lib/annotations";
import type { AnnotationKind, TargetType } from "@/lib/db/schema";

const ALLOWED_TARGET: TargetType[] = [
  "table",
  "relationship",
  "gotcha",
  "sql_example",
  "annotation",
];

const ALLOWED_KIND: AnnotationKind[] = [
  "gotcha",
  "sql_example",
  "s4_change",
  "note",
];

interface Body {
  targetType?: unknown;
  targetId?: unknown;
  kind?: unknown;
  bodyMd?: unknown;
  severity?: unknown;
  title?: unknown;
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "sign in required" }, { status: 401 });
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  if (
    typeof body.targetType !== "string" ||
    typeof body.targetId !== "string" ||
    typeof body.kind !== "string" ||
    typeof body.bodyMd !== "string"
  ) {
    return NextResponse.json(
      { error: "targetType, targetId, kind, bodyMd required" },
      { status: 400 },
    );
  }
  if (!ALLOWED_TARGET.includes(body.targetType as TargetType)) {
    return NextResponse.json({ error: "invalid targetType" }, { status: 400 });
  }
  if (!ALLOWED_KIND.includes(body.kind as AnnotationKind)) {
    return NextResponse.json({ error: "invalid kind" }, { status: 400 });
  }

  try {
    const result = await createAnnotation({
      userId: session.user.id,
      targetType: body.targetType as TargetType,
      targetId: body.targetId,
      kind: body.kind as AnnotationKind,
      bodyMd: body.bodyMd,
      severity:
        typeof body.severity === "string" ? body.severity : undefined,
      title: typeof body.title === "string" ? body.title : undefined,
    });
    return NextResponse.json({ ok: true, id: result.id });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 400 },
    );
  }
}
