import "server-only";
import { createReadStream, statSync } from "node:fs";
import { Readable } from "node:stream";
import { auth } from "@/auth";
import { getJob } from "@/lib/jobs";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ jobId: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return new Response("sign in required", { status: 401 });
  }
  const { jobId } = await params;
  const job = getJob(jobId);
  if (!job || !job.sourceFile) {
    return new Response("source not available", { status: 404 });
  }
  let size: number;
  try {
    size = statSync(job.sourceFile).size;
  } catch {
    return new Response("source file missing on disk", { status: 410 });
  }
  const filename = job.sourceFilename ?? "source.pdf";
  const stream = Readable.toWeb(
    createReadStream(job.sourceFile),
  ) as ReadableStream<Uint8Array>;
  return new Response(stream, {
    headers: {
      "content-type": "application/pdf",
      "content-length": String(size),
      "content-disposition": `inline; filename="${filename}"`,
      "cache-control": "private, max-age=0",
    },
  });
}
