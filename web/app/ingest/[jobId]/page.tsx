import Link from "next/link";
import { notFound } from "next/navigation";
import { getJob } from "@/lib/jobs";
import JobLogViewer from "@/components/JobLogViewer";

export const dynamic = "force-dynamic";

export default async function JobPage({
  params,
}: {
  params: Promise<{ jobId: string }>;
}) {
  const { jobId } = await params;
  const job = getJob(jobId);
  if (!job) notFound();

  return (
    <div>
      <p className="muted">
        <Link href="/ingest">← New ingest</Link>
      </p>
      <h1>Extraction job</h1>
      <p className="muted">
        Source: <code>{shortSource(job.source)}</code> · Domain:{" "}
        <code>{job.domainId}</code> · Started{" "}
        {new Date(job.createdAt).toLocaleString()}
      </p>
      <JobLogViewer jobId={jobId} initialStatus={job.status} />
    </div>
  );
}

function shortSource(s: string): string {
  // For uploaded files, drop the leading repo path.
  return s.replace(/^.*\/sources\//, "sources/");
}
