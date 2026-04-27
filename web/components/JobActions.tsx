"use client";
import { useTransition } from "react";
import { useRouter } from "next/navigation";

type JobStatus = "pending" | "running" | "done" | "error";

interface DeleteJobButtonProps {
  jobId: string;
  status: JobStatus;
  // Short label for the confirm dialog so the user knows what they're
  // about to delete (e.g. domain id + start time).
  label: string;
}

interface CancelJobButtonProps {
  jobId: string;
  status: JobStatus;
  // Short label for the confirm dialog (domain id + start time, etc).
  label: string;
}

/**
 * Cancel a running job by sending SIGTERM to its subprocess group.
 * Only renders for active (`pending`/`running`) jobs — for terminal
 * jobs there's nothing to cancel and the button would be pure noise.
 */
export function CancelJobButton({
  jobId,
  status,
  label,
}: CancelJobButtonProps) {
  const [busy, startTransition] = useTransition();
  const router = useRouter();

  if (status !== "pending" && status !== "running") return null;

  const onClick = () => {
    if (
      !confirm(
        `Cancel this run?\n\n${label}\n\nThe subprocess will be SIGTERM'd. Tokens already spent are not refundable.`,
      )
    ) {
      return;
    }
    startTransition(async () => {
      const res = await fetch(`/api/jobs/${jobId}/cancel`, { method: "POST" });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        alert(`Cancel failed: ${data.error ?? `HTTP ${res.status}`}`);
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
      className="job-cancel"
      title="Send SIGTERM to the subprocess"
    >
      {busy ? "Cancelling…" : "Cancel"}
    </button>
  );
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
