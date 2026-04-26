import "server-only";
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getJob } from "@/lib/jobs";
import { applyDraft } from "@/lib/drafts";

export const runtime = "nodejs";

interface Body {
  jobId?: unknown;
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "sign in required" }, { status: 401 });
  }
  const body = (await request.json().catch(() => ({}))) as Body;
  if (typeof body.jobId !== "string") {
    return NextResponse.json({ error: "jobId required" }, { status: 400 });
  }
  const job = getJob(body.jobId);
  if (!job) {
    return NextResponse.json({ error: "job not found" }, { status: 404 });
  }
  if (job.type !== "propose-domain" || !job.draftPath) {
    return NextResponse.json(
      { error: "job has no draft to apply" },
      { status: 400 },
    );
  }
  try {
    const result = await applyDraft(job.draftPath, job.domainId);
    return NextResponse.json({
      ok: true,
      domainId: job.domainId,
      targetPath: result.targetRelPath,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 400 },
    );
  }
}
