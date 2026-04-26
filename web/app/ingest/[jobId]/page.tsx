import Link from "next/link";
import { notFound } from "next/navigation";
import { getJob } from "@/lib/jobs";
import { readDraft, validateDraftText } from "@/lib/drafts";
import JobLogViewer from "@/components/JobLogViewer";
import DraftViewer from "@/components/DraftViewer";

export const dynamic = "force-dynamic";

export default async function JobPage({
  params,
}: {
  params: Promise<{ jobId: string }>;
}) {
  const { jobId } = await params;
  const job = getJob(jobId);
  if (!job) notFound();

  // For propose-domain jobs that finished, load + validate the draft so we
  // can render it inline with an Apply button.
  let draftYaml: string | null = null;
  let validationErrors: string[] = [];
  if (
    job.type === "propose-domain" &&
    job.status === "done" &&
    job.draftPath
  ) {
    try {
      draftYaml = await readDraft(job.draftPath);
      const v = validateDraftText(draftYaml);
      validationErrors = v.errors;
    } catch (e) {
      validationErrors = [e instanceof Error ? e.message : String(e)];
    }
  }

  return (
    <div>
      <p className="muted">
        <Link href="/ingest">← New ingest</Link>
      </p>
      <h1>
        {job.type === "propose-domain" ? "Propose domain" : "Extraction job"}
      </h1>
      <p className="muted">
        Source: <code>{shortSource(job.source)}</code> · Domain:{" "}
        <code>{job.domainId}</code> · Started{" "}
        {new Date(job.createdAt).toLocaleString()}
      </p>
      <JobLogViewer jobId={jobId} initialStatus={job.status} />

      {draftYaml !== null && (
        <DraftViewer
          jobId={jobId}
          draftYaml={draftYaml}
          validationErrors={validationErrors}
          targetDomainId={job.domainId}
        />
      )}
    </div>
  );
}

function shortSource(s: string): string {
  return s.replace(/^.*\/sources\//, "sources/");
}
