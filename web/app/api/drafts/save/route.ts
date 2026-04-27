import "server-only";
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getJob } from "@/lib/jobs";
import { writeDraft } from "@/lib/drafts";

export const runtime = "nodejs";

interface Body {
  jobId?: unknown;
  yaml?: unknown;
}

// Hand-edit a propose-domain draft. Mirrors /api/drafts/apply: signed-in
// only (drafts aren't public, but they're pre-apply state — no admin gate
// needed since nothing has hit /domains/ yet). Path safety is enforced by
// writeDraft → assertInsideDrafts.
export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "sign in required" }, { status: 401 });
  }
  const body = (await request.json().catch(() => ({}))) as Body;
  if (typeof body.jobId !== "string") {
    return NextResponse.json({ error: "jobId required" }, { status: 400 });
  }
  if (typeof body.yaml !== "string") {
    return NextResponse.json({ error: "yaml string required" }, { status: 400 });
  }
  // Cap the body so a runaway client can't write a 500MB "draft" — schema
  // documents in this repo top out around 100KB.
  if (body.yaml.length > 1_000_000) {
    return NextResponse.json({ error: "draft too large" }, { status: 413 });
  }
  const job = getJob(body.jobId);
  if (!job) {
    return NextResponse.json({ error: "job not found" }, { status: 404 });
  }
  if (job.type !== "propose-domain" || !job.draftPath) {
    return NextResponse.json(
      { error: "job has no draft to edit" },
      { status: 400 },
    );
  }
  try {
    await writeDraft(job.draftPath, body.yaml);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 400 },
    );
  }
}
