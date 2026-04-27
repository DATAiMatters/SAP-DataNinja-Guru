import "server-only";
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { deleteErroredJobs } from "@/lib/jobs";

export const runtime = "nodejs";

// POST /api/jobs/clear-errored — bulk-delete every job in `error` status.
// Convenience for the /jobs page; failures accumulate during iteration
// and the user shouldn't have to click N delete buttons. Active and
// completed jobs are untouched.
export async function POST() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "sign in required" }, { status: 401 });
  }
  const { deleted } = deleteErroredJobs();
  return NextResponse.json({ ok: true, deleted });
}
