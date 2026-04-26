"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

interface Props {
  targetType: string;
  targetId: string;
  initialScore: number;
  initialUserValue: -1 | 0 | 1;
  signedIn: boolean;
}

export default function VoteButtons({
  targetType,
  targetId,
  initialScore,
  initialUserValue,
  signedIn,
}: Props) {
  const [score, setScore] = useState(initialScore);
  const [userValue, setUserValue] = useState<-1 | 0 | 1>(initialUserValue);
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  const cast = async (clicked: -1 | 1) => {
    if (!signedIn) {
      const next = encodeURIComponent(window.location.pathname);
      router.push(`/sign-in?callbackUrl=${next}`);
      return;
    }
    if (busy) return;

    const newValue = userValue === clicked ? 0 : clicked;
    const delta = newValue - userValue;
    // Optimistic
    setScore((s) => s + delta);
    setUserValue(newValue);
    setBusy(true);
    try {
      const res = await fetch("/api/votes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ targetType, targetId, value: newValue }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as {
        score: number;
        userValue: -1 | 0 | 1;
      };
      setScore(data.score);
      setUserValue(data.userValue);
    } catch (e) {
      // Revert
      setScore((s) => s - delta);
      setUserValue(userValue);
      // eslint-disable-next-line no-console
      console.error("vote failed:", e);
    } finally {
      setBusy(false);
    }
  };

  const tooltip = signedIn ? "" : "Sign in to vote";

  return (
    <span className="vote-buttons" title={tooltip}>
      <button
        type="button"
        className={`vote-btn vote-up${userValue === 1 ? " active" : ""}`}
        onClick={() => cast(1)}
        disabled={busy}
        aria-label="Upvote"
      >
        ▲
      </button>
      <span className="vote-score" aria-label={`Score ${score}`}>
        {score}
      </span>
      <button
        type="button"
        className={`vote-btn vote-down${userValue === -1 ? " active" : ""}`}
        onClick={() => cast(-1)}
        disabled={busy}
        aria-label="Downvote"
      >
        ▼
      </button>
    </span>
  );
}
