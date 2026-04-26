"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { AnnotationView } from "@/lib/annotations";
import type { AnnotationKind, AnnotationStatus } from "@/lib/db/schema";

interface Props {
  targetType: string;
  targetId: string;
  annotations: AnnotationView[];
  signedIn: boolean;
  currentUserId?: string | null;
}

const KIND_LABELS: Record<AnnotationKind, string> = {
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

export default function AnnotationsSection({
  targetType,
  targetId,
  annotations,
  signedIn,
  currentUserId,
}: Props) {
  const [showForm, setShowForm] = useState(false);

  return (
    <div className="annotations">
      {annotations.length === 0 && !showForm && (
        <p className="muted">No proposed annotations.</p>
      )}
      <ul className="annotation-list">
        {annotations.map((a) => (
          <AnnotationItem
            key={a.id}
            annotation={a}
            signedIn={signedIn}
            currentUserId={currentUserId}
          />
        ))}
      </ul>
      {signedIn ? (
        showForm ? (
          <AnnotationForm
            targetType={targetType}
            targetId={targetId}
            onCancel={() => setShowForm(false)}
            onSubmitted={() => setShowForm(false)}
          />
        ) : (
          <button
            type="button"
            className="annotation-propose-btn"
            onClick={() => setShowForm(true)}
          >
            + Propose annotation
          </button>
        )
      ) : (
        <p className="muted">
          <a
            href={`/sign-in?callbackUrl=${encodeURIComponent(typeof window === "undefined" ? "/" : window.location.pathname)}`}
          >
            Sign in
          </a>{" "}
          to propose an annotation.
        </p>
      )}
    </div>
  );
}

function AnnotationItem({
  annotation,
  signedIn,
  currentUserId,
}: {
  annotation: AnnotationView;
  signedIn: boolean;
  currentUserId?: string | null;
}) {
  const [busy, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const own = currentUserId === annotation.userId;

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
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        setError(data.error ?? `promote failed: ${res.status}`);
      }
    });
  };

  const onDelete = () => {
    if (!confirm("Delete this annotation?")) return;
    startTransition(async () => {
      const res = await fetch(`/api/annotations/${annotation.id}`, {
        method: "DELETE",
      });
      if (res.ok) router.refresh();
    });
  };

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
        <span className={`annotation-status annotation-status-${annotation.status}`}>
          {STATUS_LABELS[annotation.status] ?? annotation.status}
        </span>
        <span className="muted">
          · {annotation.userName ?? annotation.userEmail} ·{" "}
          {new Date(annotation.createdAt).toLocaleDateString()}
        </span>
      </div>
      <div className="annotation-body">{annotation.bodyMd}</div>
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
          {own && annotation.status !== "promoted" && (
            <button
              type="button"
              className="link-button danger"
              onClick={onDelete}
              disabled={busy}
            >
              Delete
            </button>
          )}
        </div>
      )}
    </li>
  );
}

function AnnotationForm({
  targetType,
  targetId,
  onSubmitted,
  onCancel,
}: {
  targetType: string;
  targetId: string;
  onSubmitted: () => void;
  onCancel: () => void;
}) {
  const [kind, setKind] = useState<AnnotationKind>("gotcha");
  const [body, setBody] = useState("");
  const [severity, setSeverity] = useState<"low" | "medium" | "high">("medium");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!body.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/annotations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          targetType,
          targetId,
          kind,
          bodyMd: body,
          severity:
            kind === "gotcha" || kind === "s4_change" ? severity : undefined,
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      setBody("");
      onSubmitted();
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="annotation-form">
      <div className="annotation-form-row">
        <label>
          Kind:&nbsp;
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as AnnotationKind)}
          >
            <option value="gotcha">Gotcha</option>
            <option value="s4_change">S/4 change</option>
            <option value="note">Note</option>
          </select>
        </label>
        {(kind === "gotcha" || kind === "s4_change") && (
          <label>
            Severity:&nbsp;
            <select
              value={severity}
              onChange={(e) =>
                setSeverity(e.target.value as "low" | "medium" | "high")
              }
            >
              <option value="low">low</option>
              <option value="medium">medium</option>
              <option value="high">high</option>
            </select>
          </label>
        )}
      </div>
      <textarea
        className="comment-textarea"
        rows={4}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Describe the gotcha / change / note. Plain text or markdown."
        disabled={busy}
        autoFocus
      />
      {error && <p className="signin-error">{error}</p>}
      <div className="annotation-form-actions">
        <button type="button" className="link-button" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" disabled={busy || !body.trim()}>
          {busy ? "Posting…" : "Submit"}
        </button>
      </div>
    </form>
  );
}
