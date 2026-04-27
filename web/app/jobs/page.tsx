import Link from "next/link";
import { auth } from "@/auth";
import { listJobs } from "@/lib/jobs";
import {
  CancelJobButton,
  ClearErroredButton,
  DeleteJobButton,
} from "@/components/JobActions";
import { computeCost, formatCost } from "@/lib/pricing";

export const dynamic = "force-dynamic";

export default async function JobsIndexPage() {
  const session = await auth();
  if (!session?.user) {
    return (
      <div>
        <div className="page-header">
          <nav className="breadcrumb" aria-label="Breadcrumb">
            <span>Curate</span>
            <span className="breadcrumb-sep">›</span>
            <span>Runs</span>
          </nav>
          <div className="page-title-row">
            <h1>Runs</h1>
          </div>
        </div>
        <div className="card card-padded" style={{ maxWidth: 480 }}>
          <p style={{ margin: 0 }}>
            <Link href="/sign-in?callbackUrl=/jobs">Sign in</Link> to see ingestion runs.
          </p>
        </div>
      </div>
    );
  }
  const jobs = listJobs();
  const erroredCount = jobs.filter((j) => j.status === "error").length;

  return (
    <div>
      <div className="page-header">
        <nav className="breadcrumb" aria-label="Breadcrumb">
          <span>Curate</span>
          <span className="breadcrumb-sep">›</span>
          <span>Runs</span>
        </nav>
        <div
          className="page-title-row"
          style={{ display: "flex", alignItems: "center", gap: "1rem" }}
        >
          <h1 style={{ marginRight: "auto" }}>Runs</h1>
          <ClearErroredButton count={erroredCount} />
        </div>
        <p className="muted" style={{ margin: 0, maxWidth: 720 }}>
          Every ingestion / propose-domain run, persisted on disk under{" "}
          <code>generated/jobs/</code>. Click a row to see the log even after
          a server restart.
        </p>
      </div>

      {jobs.length === 0 ? (
        <div className="card card-padded" style={{ marginTop: "1.5rem" }}>
          <p style={{ margin: 0 }}>
            No runs yet. Start one from{" "}
            <Link href="/ingest">/ingest</Link>.
          </p>
        </div>
      ) : (
        <table className="jobs-table">
          <thead>
            <tr>
              <th>Status</th>
              <th>Type</th>
              <th>Domain</th>
              <th>Source</th>
              <th>Started</th>
              <th>Elapsed</th>
              <th>Tokens</th>
              <th>Cost</th>
              <th></th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {jobs.map((j) => {
              const end = j.completedAt?.getTime() ?? Date.now();
              const elapsedSec = Math.max(
                0,
                Math.floor((end - j.createdAt.getTime()) / 1000),
              );
              return (
                <tr key={j.id}>
                  <td>
                    <span className={`job-status job-status-${j.status}`}>
                      {j.status}
                    </span>
                  </td>
                  <td>
                    <code>{j.type}</code>
                  </td>
                  <td>
                    <code>{j.domainId}</code>
                  </td>
                  <td className="jobs-source" title={j.source}>
                    {shortSource(j.source)}
                    {j.sourceFile && (
                      <>
                        {" "}
                        <a
                          href={`/api/jobs/${j.id}/source`}
                          target="_blank"
                          rel="noopener"
                          title="Download original PDF"
                        >
                          📎
                        </a>
                      </>
                    )}
                  </td>
                  <td className="muted">
                    {j.createdAt.toLocaleString()}
                  </td>
                  <td className="muted">{formatElapsed(elapsedSec)}</td>
                  <td className="muted">
                    {j.usage
                      ? `${j.usage.inputTokens.toLocaleString()} / ${j.usage.outputTokens.toLocaleString()}`
                      : "—"}
                  </td>
                  <td
                    className="muted"
                    title={
                      j.usage
                        ? `${j.usage.model} @ rate(${j.usage.model})`
                        : undefined
                    }
                  >
                    {j.usage ? formatCost(computeCost(j.usage)) : "—"}
                  </td>
                  <td>
                    <Link href={`/ingest/${j.id}`}>open →</Link>
                  </td>
                  <td style={{ display: "flex", gap: "0.4rem", alignItems: "center" }}>
                    <CancelJobButton
                      jobId={j.id}
                      status={j.status}
                      label={`${j.type} · ${j.domainId} · ${j.createdAt.toLocaleString()}`}
                    />
                    <DeleteJobButton
                      jobId={j.id}
                      status={j.status}
                      label={`${j.type} · ${j.domainId} · ${j.createdAt.toLocaleString()}`}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

function shortSource(s: string): string {
  if (/^https?:\/\//i.test(s)) {
    try {
      const u = new URL(s);
      return u.hostname + u.pathname.slice(0, 40);
    } catch {
      return s.slice(0, 60);
    }
  }
  return s.replace(/^.*\/sources\//, "sources/");
}

function formatElapsed(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  if (m === 0) return `${s}s`;
  return `${m}m ${String(s).padStart(2, "0")}s`;
}
