"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

interface AppSettings {
  modelExtractor: string;
  modelReviewer: string;
  modelRepair: string;
  modelExtract: string;
  modelVision: string;
  visionPdfEnabled: boolean;
  ollamaHost: string;
}

interface Props {
  initial: AppSettings;
}

const ROLE_DESCRIPTIONS: Record<keyof Omit<AppSettings, "visionPdfEnabled" | "ollamaHost">, string> = {
  modelExtractor:
    "Heavy-lift agent that turns source documentation into structured YAML. High stakes — Anthropic Opus is the default.",
  modelReviewer:
    "Second-opinion auditor. Compares extractor output against the source for completeness. Cheap to move local — even 8B models do this well.",
  modelRepair:
    "Targeted fix agent. Re-emits a corrected draft when validation or the reviewer surfaces gaps. Same headroom as the extractor.",
  modelExtract:
    "Annotation-finding agent for /ingest (gotchas, S/4 changes, notes). Lower stakes than full-domain extraction.",
  modelVision:
    "Vision-capable model used when 'Vision PDF extraction' is enabled below.",
};

const ROLE_PLACEHOLDERS: Record<keyof Omit<AppSettings, "visionPdfEnabled" | "ollamaHost">, string> = {
  modelExtractor: "anthropic:claude-opus-4-7",
  modelReviewer: "ollama:llama3.1:8b",
  modelRepair: "anthropic:claude-opus-4-7",
  modelExtract: "anthropic:claude-sonnet-4-6",
  modelVision: "anthropic:claude-opus-4-7",
};

const ROLE_LABELS: Record<keyof Omit<AppSettings, "visionPdfEnabled" | "ollamaHost">, string> = {
  modelExtractor: "Extractor (propose-domain)",
  modelReviewer: "Reviewer (propose-domain audit)",
  modelRepair: "Repair (propose-domain fix loop)",
  modelExtract: "Annotation extractor (/ingest)",
  modelVision: "Vision PDF reader",
};

export default function SettingsForm({ initial }: Props) {
  const [settings, setSettings] = useState<AppSettings>(initial);
  const [busy, startTransition] = useTransition();
  const [savedTick, setSavedTick] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const update = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    setSettings((s) => ({ ...s, [key]: value }));
    setSavedTick(false);
  };

  const onSave = () => {
    setError(null);
    startTransition(async () => {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(settings),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? `HTTP ${res.status}`);
        return;
      }
      setSavedTick(true);
      router.refresh();
      // Hide the "saved" tick after a couple seconds so it doesn't lock on.
      setTimeout(() => setSavedTick(false), 2500);
    });
  };

  const roleKeys = Object.keys(ROLE_LABELS) as (keyof typeof ROLE_LABELS)[];

  return (
    <div className="settings-form">
      <section className="entity-section">
        <h2>Model routing</h2>
        <p className="muted">
          Pick a model per agent role. Empty = use the script default
          (Anthropic Opus for extractor/reviewer/repair, Sonnet for the
          annotation extractor). Format:{" "}
          <code>anthropic:&lt;model&gt;</code>,{" "}
          <code>ollama:&lt;model&gt;</code>, or{" "}
          <code>openai:&lt;model&gt;@&lt;base_url&gt;</code>.
        </p>

        {roleKeys.map((key) => (
          <div key={key} className="settings-row">
            <label>
              <span className="settings-label">{ROLE_LABELS[key]}</span>
              <span className="muted settings-help">{ROLE_DESCRIPTIONS[key]}</span>
            </label>
            <input
              type="text"
              value={settings[key]}
              placeholder={ROLE_PLACEHOLDERS[key]}
              onChange={(e) => update(key, e.target.value)}
              spellCheck={false}
              autoComplete="off"
              className="settings-input"
            />
          </div>
        ))}

        <div className="settings-row">
          <label>
            <span className="settings-label">Ollama host</span>
            <span className="muted settings-help">
              Override for the <code>ollama:</code> shortcut. Empty = use
              localhost:11434 on this machine. Useful when Ollama runs on
              a separate box on the LAN.
            </span>
          </label>
          <input
            type="text"
            value={settings.ollamaHost}
            placeholder="http://localhost:11434"
            onChange={(e) => update("ollamaHost", e.target.value)}
            spellCheck={false}
            autoComplete="off"
            className="settings-input"
          />
        </div>
      </section>

      <section className="entity-section">
        <h2>Vision PDF extraction</h2>
        <p className="muted">
          When enabled, propose-domain renders each PDF page as an image
          and sends it to the vision model rather than relying on
          text-only extraction. Better for diagram-heavy SAP ERDs (the
          spatial structure of boxes-and-arrows is preserved). Higher
          per-page cost. Off by default.
        </p>
        <div className="settings-row">
          <label>
            <input
              type="checkbox"
              checked={settings.visionPdfEnabled}
              onChange={(e) => update("visionPdfEnabled", e.target.checked)}
            />{" "}
            Use vision model when extracting from PDFs
          </label>
        </div>
      </section>

      <div className="settings-actions">
        <button
          type="button"
          onClick={onSave}
          disabled={busy}
          className="draft-apply"
        >
          {busy ? "Saving…" : "Save settings"}
        </button>
        {savedTick && <span className="settings-saved">✓ saved</span>}
        {error && <span className="signin-error">{error}</span>}
      </div>
    </div>
  );
}
