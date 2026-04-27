"use client";
import { useTransition } from "react";
import { useRouter } from "next/navigation";

interface DeleteJobButtonProps {
  jobId: string;
  status: "pending" | "running" | "done" | "error";
  // Short label for the confirm dialog so the user knows what they're
  // about to delete (e.g. domain id + start time).
  label: string;
}

/**
 * Per-row delete button on the /jobs index. Disabled while the job is
 * active (the API would refuse anyway, but disabling avoids the
 * round-trip and the misleading error toast). Confirms before firing —
 * deletion is irreversible (logs + uploaded source PDF go too).
 */
export function DeleteJobButton({
  jobId,
  status,
  label,
}: DeleteJobButtonProps) {
  const [busy, startTransition] = useTransition();
  const router = useRouter();

  const isActive = status === "pending" || status === "running";

  const onClick = () => {
    if (isActive) return;
    if (
      !confirm(
        `Delete this run?\n\n${label}\n\nThis removes the log, meta, and uploaded source. Cannot be undone.`,
      )
    ) {
      return;
    }
    startTransition(async () => {
      const res = await fetch(`/api/jobs/${jobId}`, { method: "DELETE" });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        alert(`Delete failed: ${data.error ?? `HTTP ${res.status}`}`);
        return;
      }
      router.refresh();
    });
  };

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy || isActive}
      className="job-delete"
      title={
        isActive
          ? "Wait for the run to finish before deleting"
          : "Delete this run"
      }
      aria-label={`Delete run ${label}`}
    >
      {busy ? "…" : "✕"}
    </button>
  );
}

interface ClearErroredButtonProps {
  count: number;
}

/**
 * Top-of-page "clear all errored" button. Hidden when there are no
 * errored jobs (count === 0) so it doesn't add visual noise to a clean
 * runs list.
 */
export function ClearErroredButton({ count }: ClearErroredButtonProps) {
  const [busy, startTransition] = useTransition();
  const router = useRouter();

  if (count === 0) return null;

  const onClick = () => {
    if (
      !confirm(
        `Delete ${count} errored run${count === 1 ? "" : "s"}? This cannot be undone.`,
      )
    ) {
      return;
    }
    startTransition(async () => {
      const res = await fetch("/api/jobs/clear-errored", { method: "POST" });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        alert(`Clear failed: ${data.error ?? `HTTP ${res.status}`}`);
        return;
      }
      router.refresh();
    });
  };

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className="draft-cancel"
      style={{ marginLeft: "auto" }}
    >
      {busy
        ? "Clearing…"
        : `Clear ${count} errored run${count === 1 ? "" : "s"}`}
    </button>
  );
}
