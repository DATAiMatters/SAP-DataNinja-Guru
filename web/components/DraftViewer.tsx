"use client";
import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

interface Props {
  jobId: string;
  draftYaml: string;
  validationErrors: string[];
  targetDomainId: string;
}

export default function DraftViewer({
  jobId,
  draftYaml,
  validationErrors,
  targetDomainId,
}: Props) {
  const [busy, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [applied, setApplied] = useState(false);
  const router = useRouter();

  const apply = () => {
    if (
      !confirm(
        `Write this draft to domains/${targetDomainId}.yaml? You can still edit it on disk afterward.`,
      )
    ) {
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        const res = await fetch("/api/drafts/apply", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ jobId }),
        });
        const data = (await res.json().catch(() => ({}))) as {
          ok?: boolean;
          error?: string;
        };
        if (!res.ok || !data.ok) {
          throw new Error(data.error ?? `HTTP ${res.status}`);
        }
        setApplied(true);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    });
  };

  const hasErrors = validationErrors.length > 0;

  return (
    <section className="entity-section">
      <h2>Proposed YAML draft</h2>

      {applied ? (
        <div className="signin-card" style={{ margin: 0, marginBottom: "1em" }}>
          <p>
            ✓ Written to <code>domains/{targetDomainId}.yaml</code>.
          </p>
          <p>
            <Link href={`/domains/${targetDomainId}`}>
              Open the new domain →
            </Link>
          </p>
        </div>
      ) : (
        <div className="draft-actions">
          <span
            className={`draft-status draft-status-${hasErrors ? "invalid" : "valid"}`}
          >
            {hasErrors
              ? `⚠ ${validationErrors.length} validation error${validationErrors.length === 1 ? "" : "s"}`
              : "✓ valid"}
          </span>
          <button
            type="button"
            onClick={apply}
            disabled={busy || hasErrors}
            className="draft-apply"
          >
            {busy
              ? "Applying…"
              : `Apply to domains/${targetDomainId}.yaml`}
          </button>
        </div>
      )}

      {error && <p className="signin-error">{error}</p>}

      {hasErrors && (
        <details className="sql-block" open>
          <summary>Validation errors</summary>
          <pre>
            <code>{validationErrors.join("\n")}</code>
          </pre>
        </details>
      )}

      <pre className="draft-yaml">
        <code>{draftYaml}</code>
      </pre>

      <p className="muted">
        The draft is stored at <code>generated/drafts/</code>. Edit it on
        disk if you want to tweak before applying — re-validation runs at
        apply time.
      </p>
    </section>
  );
}
