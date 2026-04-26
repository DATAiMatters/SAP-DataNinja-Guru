import "server-only";
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  deleteAnnotation,
  updateAnnotationStatus,
} from "@/lib/annotations";
import type { AnnotationStatus } from "@/lib/db/schema";

const ALLOWED: AnnotationStatus[] = [
  "proposed",
  "accepted",
  "rejected",
  "promoted",
];

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "sign in required" }, { status: 401 });
  }
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as {
    status?: unknown;
  };
  if (
    typeof body.status !== "string" ||
    !ALLOWED.includes(body.status as AnnotationStatus)
  ) {
    return NextResponse.json(
      { error: `status must be one of ${ALLOWED.join(", ")}` },
      { status: 400 },
    );
  }
  const ok = await updateAnnotationStatus(id, body.status as AnnotationStatus);
  if (!ok) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "sign in required" }, { status: 401 });
  }
  const { id } = await params;
  const ok = await deleteAnnotation(id, session.user.id);
  if (!ok) {
    return NextResponse.json(
      { error: "not found or not yours" },
      { status: 404 },
    );
  }
  return NextResponse.json({ ok: true });
}
