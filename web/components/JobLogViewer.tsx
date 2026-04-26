"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";

interface JobLogLine {
  ts: number;
  text: string;
  stream: "stdout" | "stderr" | "system";
}

type Status = "pending" | "running" | "done" | "error";

interface Props {
  jobId: string;
  initialStatus: Status;
}

export default function JobLogViewer({ jobId, initialStatus }: Props) {
  const [lines, setLines] = useState<JobLogLine[]>([]);
  const [status, setStatus] = useState<Status>(initialStatus);
  const [exitCode, setExitCode] = useState<number | null>(null);
  const logRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    if (status === "done" || status === "error") {
      // Already terminal — still subscribe once to fetch any backlog.
    }
    const es = new EventSource(`/api/ingest/${jobId}/stream`);

    es.onmessage = (event) => {
      try {
        const line = JSON.parse(event.data) as JobLogLine;
        setLines((prev) => [...prev, line]);
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
    });
    es.onerror = () => {
      // EventSource auto-reconnects on transient errors. We only force-close
      // on terminal status (handled above).
    };
    return () => es.close();
  }, [jobId, status]);

  // Auto-scroll the log to the bottom as lines arrive.
  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [lines.length]);

  return (
    <div className="job-viewer">
      <div className={`job-status job-status-${status}`}>
        {status === "running" && "● running…"}
        {status === "pending" && "○ pending"}
        {status === "done" && "✓ done"}
        {status === "error" && (
          <>⚠ error{exitCode != null && ` (exit ${exitCode})`}</>
        )}
      </div>
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
      {status === "done" && (
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
          <code>pip install -r scripts/requirements.txt</code>.
        </p>
      )}
    </div>
  );
}
