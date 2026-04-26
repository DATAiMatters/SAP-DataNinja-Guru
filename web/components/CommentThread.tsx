"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { CommentView } from "@/lib/comments";

interface Props {
  targetType: string;
  targetId: string;
  comments: CommentView[];
  signedIn: boolean;
  currentUserId?: string | null;
}

export default function CommentThread({
  targetType,
  targetId,
  comments,
  signedIn,
  currentUserId,
}: Props) {
  return (
    <div className="comments">
      {comments.length === 0 && (
        <p className="muted">No comments yet.</p>
      )}
      <ul className="comment-list">
        {comments.map((c) => (
          <CommentItem
            key={c.id}
            comment={c}
            targetType={targetType}
            targetId={targetId}
            signedIn={signedIn}
            currentUserId={currentUserId}
            depth={0}
          />
        ))}
      </ul>
      {signedIn ? (
        <CommentForm
          targetType={targetType}
          targetId={targetId}
          parentId={null}
          placeholder="Add a comment (markdown supported)…"
        />
      ) : (
        <SignInPrompt action="comment" />
      )}
    </div>
  );
}

function CommentItem({
  comment,
  targetType,
  targetId,
  signedIn,
  currentUserId,
  depth,
}: {
  comment: CommentView;
  targetType: string;
  targetId: string;
  signedIn: boolean;
  currentUserId?: string | null;
  depth: 0 | 1;
}) {
  const [showReply, setShowReply] = useState(false);
  const [busy, startTransition] = useTransition();
  const router = useRouter();
  const own = currentUserId === comment.userId;

  const onDelete = () => {
    if (!confirm("Delete this comment?")) return;
    startTransition(async () => {
      const res = await fetch(
        `/api/comments?id=${encodeURIComponent(comment.id)}`,
        { method: "DELETE" },
      );
      if (res.ok) router.refresh();
    });
  };

  return (
    <li className="comment-item">
      <div className="comment-meta">
        <strong>{comment.userName ?? comment.userEmail}</strong>{" "}
        <span className="muted">
          · {new Date(comment.createdAt).toLocaleString()}
        </span>
      </div>
      <div
        className="comment-body"
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: comment.bodyHtml }}
      />
      <div className="comment-actions">
        {depth === 0 && signedIn && (
          <button
            type="button"
            className="link-button"
            onClick={() => setShowReply((v) => !v)}
          >
            {showReply ? "Cancel" : "Reply"}
          </button>
        )}
        {own && (
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
      {showReply && (
        <CommentForm
          targetType={targetType}
          targetId={targetId}
          parentId={comment.id}
          placeholder="Write a reply…"
          onSubmitted={() => setShowReply(false)}
          autoFocus
        />
      )}
      {comment.replies.length > 0 && (
        <ul className="comment-list comment-replies">
          {comment.replies.map((r) => (
            <CommentItem
              key={r.id}
              comment={r}
              targetType={targetType}
              targetId={targetId}
              signedIn={signedIn}
              currentUserId={currentUserId}
              depth={1}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

function CommentForm({
  targetType,
  targetId,
  parentId,
  placeholder,
  autoFocus,
  onSubmitted,
}: {
  targetType: string;
  targetId: string;
  parentId: string | null;
  placeholder: string;
  autoFocus?: boolean;
  onSubmitted?: () => void;
}) {
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!body.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/comments", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          targetType,
          targetId,
          bodyMd: body,
          parentId,
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      setBody("");
      onSubmitted?.();
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="comment-form">
      <textarea
        className="comment-textarea"
        rows={3}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder={placeholder}
        autoFocus={autoFocus}
        disabled={busy}
      />
      {error && <p className="signin-error">{error}</p>}
      <div className="comment-form-actions">
        <button type="submit" disabled={busy || !body.trim()}>
          {busy ? "Posting…" : "Post"}
        </button>
      </div>
    </form>
  );
}

function SignInPrompt({ action }: { action: string }) {
  return (
    <p className="muted">
      <a
        href={`/sign-in?callbackUrl=${encodeURIComponent(typeof window === "undefined" ? "/" : window.location.pathname)}`}
      >
        Sign in
      </a>{" "}
      to {action}.
    </p>
  );
}
