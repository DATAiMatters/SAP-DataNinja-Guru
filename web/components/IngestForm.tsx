"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

type Mode = "file" | "url";

export default function IngestForm({ domains }: { domains: string[] }) {
  const [mode, setMode] = useState<Mode>("file");
  const [domainId, setDomainId] = useState(domains[0] ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const fd = new FormData();
    fd.append("domainId", domainId);
    if (mode === "file") {
      if (!file) {
        setError("pick a PDF first");
        setBusy(false);
        return;
      }
      fd.append("file", file);
    } else {
      if (!url.trim()) {
        setError("paste a URL first");
        setBusy(false);
        return;
      }
      fd.append("url", url.trim());
    }
    try {
      const res = await fetch("/api/ingest", { method: "POST", body: fd });
      const data = (await res.json().catch(() => ({}))) as {
        jobId?: string;
        error?: string;
      };
      if (!res.ok || !data.jobId) {
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      router.push(`/ingest/${data.jobId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="ingest-form">
      <label className="ingest-field">
        <span>Domain</span>
        <select
          value={domainId}
          onChange={(e) => setDomainId(e.target.value)}
          required
        >
          {domains.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
      </label>

      <fieldset className="ingest-mode">
        <legend>Source</legend>
        <label>
          <input
            type="radio"
            name="mode"
            checked={mode === "file"}
            onChange={() => setMode("file")}
          />{" "}
          PDF upload
        </label>
        <label>
          <input
            type="radio"
            name="mode"
            checked={mode === "url"}
            onChange={() => setMode("url")}
          />{" "}
          Web URL
        </label>
      </fieldset>

      {mode === "file" ? (
        <label className="ingest-field">
          <span>PDF file</span>
          <input
            type="file"
            accept="application/pdf,.pdf"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            required
          />
        </label>
      ) : (
        <label className="ingest-field">
          <span>URL</span>
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://help.sap.com/..."
            required
          />
        </label>
      )}

      {error && <p className="signin-error">{error}</p>}

      <div className="ingest-actions">
        <button type="submit" disabled={busy}>
          {busy ? "Starting…" : "Run extraction"}
        </button>
      </div>
    </form>
  );
}
