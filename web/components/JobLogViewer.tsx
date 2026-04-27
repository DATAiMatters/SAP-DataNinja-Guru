"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { computeCost, formatCost } from "@/lib/pricing";

interface JobLogLine {
  ts: number;
  text: string;
  stream: "stdout" | "stderr" | "system";
}

type Status = "pending" | "running" | "done" | "error";
type JobType = "ingest-pdf" | "ingest-url" | "propose-domain";

interface Usage {
  inputTokens: number;
  outputTokens: number;
  model: string;
}

interface Props {
  jobId: string;
  jobType: JobType;
  initialStatus: Status;
  createdAt: number; // epoch ms
  initialUsage?: Usage;
  logRelPath: string; // path to disk log for "vanished" message
}

// Mirrors scripts/*.py emission: `usage: input=N output=N model=X`.
const USAGE_RE = /usage:\s+input=(\d+)\s+output=(\d+)\s+model=(\S+)/;

export default function JobLogViewer({
  jobId,
  jobType,
  initialStatus,
  createdAt,
  initialUsage,
  logRelPath,
}: Props) {
  const [lines, setLines] = useState<JobLogLine[]>([]);
  const [status, setStatus] = useState<Status>(initialStatus);
  const [exitCode, setExitCode] = useState<number | null>(null);
  const [usage, setUsage] = useState<Usage | undefined>(initialUsage);
  const [now, setNow] = useState<number>(() => Date.now());
  const [vanished, setVanished] = useState(false);
  const logRef = useRef<HTMLPreElement>(null);
  const router = useRouter();

  const isTerminal = status === "done" || status === "error";

  // Live elapsed-time ticker. Stops once the job reaches a terminal state.
  useEffect(() => {
    if (isTerminal) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [isTerminal]);

  useEffect(() => {
    const es = new EventSource(`/api/ingest/${jobId}/stream`);

    es.onmessage = (event) => {
      try {
        const line = JSON.parse(event.data) as JobLogLine;
        setLines((prev) => [...prev, line]);
        // Sniff usage live so the badge updates the moment Python prints it.
        const u = line.text.match(USAGE_RE);
        if (u) {
          const inT = parseInt(u[1], 10);
          const outT = parseInt(u[2], 10);
          setUsage((prev) => ({
            inputTokens: (prev?.inputTokens ?? 0) + inT,
            outputTokens: (prev?.outputTokens ?? 0) + outT,
            model: u[3],
          }));
        }
      } catch {
        // ignore malformed
      }
    };
    es.addEventListener("done", (event) => {
      try {
        const data = JSON.parse((event as MessageEvent).data) as {
          status: Status;
          exitCode?: number;
        };
        setStatus(data.status);
        setExitCode(data.exitCode ?? null);
      } catch {
        setStatus("done");
      }
      es.close();
      // The parent server component was rendered while status was running,
      // so it didn't read the draft file yet. Re-fetch it now so the
      // DraftViewer (or extraction-results section) renders without a
      // manual reload.
      router.refresh();
    });
    es.onerror = () => {
      // EventSource auto-reconnects on transient errors. If the connection
      // is permanently dead (CLOSED) and we never saw a 'done' event, the
      // job has vanished from disk too — surface that, don't spin silently.
      if (es.readyState === EventSource.CLOSED) {
        setVanished(true);
      }
    };
    return () => es.close();
  }, [jobId]);

  // Auto-scroll the log to the bottom as lines arrive.
  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [lines.length]);

  const elapsedMs = useMemo(() => {
    if (isTerminal && lines.length > 0) {
      // Use the last log timestamp as a proxy for completion time when the
      // server didn't push a separate completedAt to the client.
      const last = lines[lines.length - 1].ts;
      return Math.max(0, last - createdAt);
    }
    return Math.max(0, now - createdAt);
  }, [now, createdAt, isTerminal, lines]);

  return (
    <div className="job-viewer">
      <div className="job-statusbar">
        <span className={`job-status job-status-${status}`}>
          {status === "running" && "● running…"}
          {status === "pending" && "○ pending"}
          {status === "done" && "✓ done"}
          {status === "error" && (
            <>⚠ error{exitCode != null && ` (exit ${exitCode})`}</>
          )}
        </span>
        <span className="job-meter" title="Elapsed time since job start">
          ⏱ {formatElapsed(elapsedMs)}
        </span>
        {usage && (
          <span
            className="job-meter job-meter-tokens"
            title={`Anthropic API usage — model ${usage.model}`}
          >
            ⚡ {usage.inputTokens.toLocaleString()} in ·{" "}
            {usage.outputTokens.toLocaleString()} out
            <span className="muted"> · {usage.model}</span>
            <span
              className="job-meter-cost"
              title="Estimated dollar cost (Anthropic published rates)"
            >
              {" · "}
              {formatCost(computeCost(usage))}
            </span>
          </span>
        )}
      </div>

      {vanished && (
        <div className="job-vanished">
          ⚠ Live stream disconnected and the job is no longer reachable. The
          server may have restarted. Persistent log at{" "}
          <code>{logRelPath}</code>.
        </div>
      )}

      <pre ref={logRef} className="job-log">
        {lines.length === 0 ? (
          <span className="muted">waiting for output…</span>
        ) : (
          lines.map((l, i) => (
            <span
              key={i}
              className={`job-log-line job-log-${l.stream}`}
            >
              {l.text}
              {"\n"}
            </span>
          ))
        )}
      </pre>
      {status === "done" && jobType === "propose-domain" && (
        <p className="muted">
          ✓ Draft generated. Review and apply it below ↓
        </p>
      )}
      {status === "done" &&
        (jobType === "ingest-pdf" || jobType === "ingest-url") && (
          <p>
            <Link href="/inbox?status=proposed">
              Review proposed annotations →
            </Link>
          </p>
        )}
      {status === "error" && (
        <p className="muted">
          Check the log above for the failure reason. Common causes:{" "}
          <code>ANTHROPIC_API_KEY</code> not set, missing{" "}
          <code>pip install -r scripts/requirements.txt</code>. Persistent
          log at <code>{logRelPath}</code>.
        </p>
      )}
    </div>
  );
}

function formatElapsed(ms: number): string {
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  if (m === 0) return `${s}s`;
  return `${m}m ${String(s).padStart(2, "0")}s`;
}
