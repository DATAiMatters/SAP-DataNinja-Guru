import "server-only";
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { promoteAnnotationToYaml } from "@/lib/annotations";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "sign in required" }, { status: 401 });
  }
  const { id } = await params;
  try {
    const result = await promoteAnnotationToYaml(id);
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 400 },
    );
  }
}
