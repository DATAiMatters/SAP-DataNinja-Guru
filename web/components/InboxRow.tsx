"use client";
import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { InboxAnnotation } from "@/lib/inbox";
import type { AnnotationStatus } from "@/lib/db/schema";

interface Props {
  annotation: InboxAnnotation;
  signedIn: boolean;
}

const KIND_LABELS: Record<string, string> = {
  gotcha: "Gotcha",
  s4_change: "S/4 change",
  note: "Note",
  sql_example: "SQL example",
};

const STATUS_LABELS: Record<AnnotationStatus, string> = {
  proposed: "Proposed",
  accepted: "Accepted",
  rejected: "Rejected",
  promoted: "Promoted to YAML",
};

export default function InboxRow({ annotation, signedIn }: Props) {
  const [busy, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const setStatus = (status: AnnotationStatus) => {
    setError(null);
    startTransition(async () => {
      const res = await fetch(`/api/annotations/${annotation.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (res.ok) router.refresh();
      else setError(`status update failed: ${res.status}`);
    });
  };

  const promote = () => {
    if (!confirm("Promote this annotation into the YAML on disk?")) return;
    setError(null);
    startTransition(async () => {
      const res = await fetch(
        `/api/annotations/${annotation.id}/promote`,
        { method: "POST" },
      );
      if (res.ok) router.refresh();
      else {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? `promote failed: ${res.status}`);
      }
    });
  };

  const target = parseTargetId(annotation.targetId);
  const targetLink = target ? (
    <Link href={`/domains/${target.domainId}/${target.id}`}>
      <code>{target.domainId}</code> / <code>{target.id}</code>
    </Link>
  ) : (
    <code>{annotation.targetId}</code>
  );

  return (
    <li className={`annotation-item annotation-${annotation.status}`}>
      <div className="annotation-meta">
        <span className={`annotation-kind annotation-kind-${annotation.kind}`}>
          {KIND_LABELS[annotation.kind] ?? annotation.kind}
        </span>
        {annotation.severity && (
          <span className={`severity severity-${annotation.severity}`}>
            {annotation.severity}
          </span>
        )}
        <span
          className={`annotation-status annotation-status-${annotation.status}`}
        >
          {STATUS_LABELS[annotation.status] ?? annotation.status}
        </span>
        <span className="muted">
          on {targetLink} ·{" "}
          {annotation.userName ?? annotation.userEmail} ·{" "}
          {new Date(annotation.createdAt).toLocaleString()}
        </span>
      </div>
      <div className="annotation-body">{annotation.bodyMd}</div>
      {annotation.title && (
        <div className="muted" style={{ fontSize: "0.85em" }}>
          {annotation.title}
        </div>
      )}
      {error && <p className="signin-error">{error}</p>}
      {signedIn && (
        <div className="annotation-actions">
          {annotation.status === "proposed" && (
            <>
              <button
                type="button"
                className="link-button"
                onClick={() => setStatus("accepted")}
                disabled={busy}
              >
                Accept
              </button>
              <button
                type="button"
                className="link-button"
                onClick={() => setStatus("rejected")}
                disabled={busy}
              >
                Reject
              </button>
            </>
          )}
          {annotation.status === "accepted" && (
            <button
              type="button"
              className="link-button"
              onClick={promote}
              disabled={busy}
            >
              Promote to YAML
            </button>
          )}
          {annotation.status === "rejected" && (
            <button
              type="button"
              className="link-button"
              onClick={() => setStatus("proposed")}
              disabled={busy}
            >
              Reopen
            </button>
          )}
        </div>
      )}
    </li>
  );
}

function parseTargetId(targetId: string) {
  const m = targetId.match(/^domain:([^/]+)\/([^:]+):(.+)$/);
  if (!m) return null;
  return { domainId: m[1], kind: m[2], id: m[3] };
}
