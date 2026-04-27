import "server-only";
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { deleteJob } from "@/lib/jobs";

export const runtime = "nodejs";

// DELETE /api/jobs/<jobId> — remove a finished or errored job's record
// from disk + memory. Refuses active jobs (see deleteJob doc).
//
// Auth model: any signed-in user. Jobs aren't owner-scoped today; if you
// can see them at /jobs you can delete them, mirroring how a small admin
// instance works. Add ownership when the user model needs it.
export async function DELETE(
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
  const result = deleteJob(jobId);
  if (!result.ok) {
    // 404 for "not found", 409 for "active job" (semantically a conflict
    // with the running subprocess), 400 otherwise. Lets the client UI
    // distinguish "already gone" from "you waited too long, it's running."
    const status = result.error === "job not found"
      ? 404
      : result.error.startsWith("cannot delete an active job")
        ? 409
        : 400;
    return NextResponse.json({ error: result.error }, { status });
  }
  return NextResponse.json({ ok: true });
}
