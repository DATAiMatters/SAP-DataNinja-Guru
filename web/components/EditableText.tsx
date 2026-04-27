"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

interface Props {
  domainId: string;
  path: (string | number)[];
  value: string;
  isAdmin: boolean;
  multiline?: boolean;
  placeholder?: string;
  className?: string;
  // Element to wrap the rendered display value. Defaults to "span".
  // Use "p" for paragraph-level fields, etc. The editor itself is always
  // an input/textarea regardless.
  as?: "span" | "p" | "h1" | "h2" | "h3" | "div";
}

export default function EditableText({
  domainId,
  path,
  value,
  isAdmin,
  multiline = false,
  placeholder = "—",
  className,
  as = "span",
}: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [current, setCurrent] = useState(value);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
  const router = useRouter();

  useEffect(() => {
    setCurrent(value);
    setDraft(value);
  }, [value]);

  useEffect(() => {
    if (editing && ref.current) {
      ref.current.focus();
      ref.current.select?.();
    }
  }, [editing]);

  if (!isAdmin) {
    if (!current) return null;
    const Tag = as;
    return <Tag className={className}>{current}</Tag>;
  }

  const cancel = () => {
    setDraft(current);
    setEditing(false);
    setError(null);
  };

  const save = async () => {
    if (draft === current) {
      setEditing(false);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/domains/${domainId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ path, value: draft }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        value?: string;
        error?: string;
      };
      if (!res.ok || !data.ok) {
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      setCurrent(data.value ?? draft);
      setEditing(false);
      // Refresh server components so siblings reading the same YAML pick
      // up the new value.
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      cancel();
      return;
    }
    if (e.key === "Enter" && !multiline) {
      e.preventDefault();
      void save();
    }
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && multiline) {
      e.preventDefault();
      void save();
    }
  };

  if (editing) {
    return (
      <span className="editable editable-active">
        {multiline ? (
          <textarea
            ref={ref as React.RefObject<HTMLTextAreaElement>}
            className="editable-textarea"
            value={draft}
            disabled={busy}
            rows={Math.max(3, Math.min(12, draft.split("\n").length + 1))}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
          />
        ) : (
          <input
            ref={ref as React.RefObject<HTMLInputElement>}
            className="editable-input"
            value={draft}
            disabled={busy}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
          />
        )}
        <span className="editable-actions">
          <button
            type="button"
            onClick={save}
            disabled={busy}
            className="editable-save"
            title={multiline ? "Save (⌘↩)" : "Save (↩)"}
          >
            {busy ? "…" : "Save"}
          </button>
          <button
            type="button"
            onClick={cancel}
            disabled={busy}
            className="editable-cancel"
            title="Cancel (Esc)"
          >
            Cancel
          </button>
        </span>
        {error && <span className="editable-error">{error}</span>}
      </span>
    );
  }

  const Tag = as;
  const displayClass = `editable ${className ?? ""}`.trim();
  const isEmpty = !current;
  return (
    <Tag
      className={`${displayClass} ${isEmpty ? "editable-empty" : ""}`.trim()}
      onClick={() => setEditing(true)}
      title="Click to edit"
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          setEditing(true);
        }
      }}
    >
      {isEmpty ? <span className="muted">{placeholder}</span> : current}
      <span className="editable-pencil" aria-hidden>
        ✎
      </span>
    </Tag>
  );
}
