import "server-only";
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { cancelJob } from "@/lib/jobs";

export const runtime = "nodejs";

// POST /api/jobs/<jobId>/cancel — send SIGTERM to a running job.
//
// Auth model mirrors DELETE: signed-in only. Jobs aren't owner-scoped,
// so anyone with /jobs access can cancel anyone's run. Add ownership
// when the user model needs it.
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ jobId: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "sign in required" }, { status: 401 });
  }
  const { jobId } = await params;
  if (typeof jobId !== "string" || !jobId) {
    return NextResponse.json({ error: "jobId required" }, { status: 400 });
  }
  const result = cancelJob(jobId);
  if (!result.ok) {
    const status = result.error === "job not found" ? 404 : 400;
    return NextResponse.json({ error: result.error }, { status });
  }
  return NextResponse.json({ ok: true });
}
