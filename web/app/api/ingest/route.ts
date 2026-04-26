import "server-only";
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { listDomainIds } from "@/lib/content";
import { startUploadJob, startUrlJob } from "@/lib/jobs";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "sign in required" }, { status: 401 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "invalid form data" }, { status: 400 });
  }

  const domainId = form.get("domainId");
  if (typeof domainId !== "string" || !domainId) {
    return NextResponse.json({ error: "domainId required" }, { status: 400 });
  }
  if (!listDomainIds().includes(domainId)) {
    return NextResponse.json({ error: `unknown domain: ${domainId}` }, { status: 400 });
  }

  const url = form.get("url");
  const file = form.get("file");

  try {
    if (file && file instanceof File && file.size > 0) {
      if (!file.name.toLowerCase().endsWith(".pdf")) {
        return NextResponse.json(
          { error: "only PDF uploads are supported" },
          { status: 400 },
        );
      }
      const bytes = await file.arrayBuffer();
      const job = await startUploadJob({
        domainId,
        file: { filename: file.name, bytes },
      });
      return NextResponse.json({ jobId: job.id });
    }
    if (typeof url === "string" && url) {
      if (!/^https?:\/\//i.test(url)) {
        return NextResponse.json(
          { error: "url must start with http(s)://" },
          { status: 400 },
        );
      }
      const job = startUrlJob({ domainId, url });
      return NextResponse.json({ jobId: job.id });
    }
    return NextResponse.json(
      { error: "provide a PDF file or a URL" },
      { status: 400 },
    );
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
