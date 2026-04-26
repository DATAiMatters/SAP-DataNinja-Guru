"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

type SourceMode = "file" | "url";
type IngestMode = "ingest" | "propose-domain";

export default function IngestForm({ domains }: { domains: string[] }) {
  const [ingestMode, setIngestMode] = useState<IngestMode>("ingest");
  const [sourceMode, setSourceMode] = useState<SourceMode>("file");
  const [domainId, setDomainId] = useState(domains[0] ?? "");
  const [newDomainId, setNewDomainId] = useState("");
  const [newDomainName, setNewDomainName] = useState("");
  const [sapModule, setSapModule] = useState("");
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
    fd.append("mode", ingestMode);

    if (ingestMode === "ingest") {
      fd.append("domainId", domainId);
    } else {
      if (!/^[a-z0-9_-]+$/.test(newDomainId)) {
        setError("domain id must be kebab/snake-case [a-z0-9_-]");
        setBusy(false);
        return;
      }
      if (domains.includes(newDomainId)) {
        setError(`domain "${newDomainId}" already exists`);
        setBusy(false);
        return;
      }
      if (!newDomainName.trim()) {
        setError("domain name required");
        setBusy(false);
        return;
      }
      fd.append("domainId", newDomainId);
      fd.append("domainName", newDomainName.trim());
      if (sapModule.trim()) fd.append("sapModule", sapModule.trim());
    }

    if (sourceMode === "file") {
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
      <fieldset className="ingest-mode">
        <legend>Mode</legend>
        <label>
          <input
            type="radio"
            name="ingestMode"
            checked={ingestMode === "ingest"}
            onChange={() => setIngestMode("ingest")}
          />{" "}
          Ingest into existing domain
          <span className="muted"> — annotations</span>
        </label>
        <label>
          <input
            type="radio"
            name="ingestMode"
            checked={ingestMode === "propose-domain"}
            onChange={() => setIngestMode("propose-domain")}
          />{" "}
          Propose a new domain
          <span className="muted"> — full YAML draft</span>
        </label>
      </fieldset>

      {ingestMode === "ingest" ? (
        <label className="ingest-field">
          <span>Target domain</span>
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
      ) : (
        <>
          <label className="ingest-field">
            <span>New domain id (kebab/snake-case)</span>
            <input
              type="text"
              value={newDomainId}
              onChange={(e) => setNewDomainId(e.target.value.toLowerCase())}
              placeholder="pricing"
              pattern="[a-z0-9_-]+"
              required
            />
          </label>
          <label className="ingest-field">
            <span>Human-readable name</span>
            <input
              type="text"
              value={newDomainName}
              onChange={(e) => setNewDomainName(e.target.value)}
              placeholder="SAP Pricing & Conditions"
              required
            />
          </label>
          <label className="ingest-field">
            <span>
              SAP module <span className="muted">(optional, e.g. SD)</span>
            </span>
            <input
              type="text"
              value={sapModule}
              onChange={(e) => setSapModule(e.target.value.toUpperCase())}
              placeholder="SD"
              maxLength={6}
            />
          </label>
        </>
      )}

      <fieldset className="ingest-mode">
        <legend>Source</legend>
        <label>
          <input
            type="radio"
            name="sourceMode"
            checked={sourceMode === "file"}
            onChange={() => setSourceMode("file")}
          />{" "}
          PDF upload
        </label>
        <label>
          <input
            type="radio"
            name="sourceMode"
            checked={sourceMode === "url"}
            onChange={() => setSourceMode("url")}
          />{" "}
          Web URL
        </label>
      </fieldset>

      {sourceMode === "file" ? (
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
          {busy
            ? "Starting…"
            : ingestMode === "ingest"
              ? "Run extraction"
              : "Propose domain"}
        </button>
      </div>
    </form>
  );
}
