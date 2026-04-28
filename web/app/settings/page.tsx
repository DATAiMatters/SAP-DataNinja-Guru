import Link from "next/link";
import { auth } from "@/auth";
import { isAdmin } from "@/lib/admin";
import { readSettings } from "@/lib/settings";
import SettingsForm from "@/components/SettingsForm";

export const dynamic = "force-dynamic";

// Admin-only settings page. Today gates on the email allowlist (lib/admin).
// "Protect later" per-machine pattern is honored by living under
// /generated/settings.json — the file is gitignored, so each deployment
// has its own routing config without leaking the operator's preferences
// into version control.
export default async function SettingsPage() {
  const session = await auth();

  if (!session?.user) {
    return (
      <div>
        <div className="page-header">
          <nav className="breadcrumb" aria-label="Breadcrumb">
            <span>Admin</span>
            <span className="breadcrumb-sep">›</span>
            <span>Settings</span>
          </nav>
          <h1>Settings</h1>
        </div>
        <div className="card card-padded" style={{ maxWidth: 480 }}>
          <p style={{ margin: 0 }}>
            <Link href="/sign-in?callbackUrl=/settings">Sign in</Link> to view
            settings.
          </p>
        </div>
      </div>
    );
  }

  if (!isAdmin(session)) {
    return (
      <div>
        <div className="page-header">
          <nav className="breadcrumb" aria-label="Breadcrumb">
            <span>Admin</span>
            <span className="breadcrumb-sep">›</span>
            <span>Settings</span>
          </nav>
          <h1>Settings</h1>
        </div>
        <div className="card card-padded" style={{ maxWidth: 480 }}>
          <p style={{ margin: 0 }}>
            Settings are admin-only. Sign in with an allowlisted account.
          </p>
        </div>
      </div>
    );
  }

  const settings = readSettings();

  return (
    <div>
      <div className="page-header">
        <nav className="breadcrumb" aria-label="Breadcrumb">
          <span>Admin</span>
          <span className="breadcrumb-sep">›</span>
          <span>Settings</span>
        </nav>
        <h1>Settings</h1>
        <p className="muted" style={{ margin: 0, maxWidth: 720 }}>
          Per-machine configuration for the multi-agent extraction pipeline.
          Routes each agent role to your choice of foundation model
          (Anthropic) or local model (Ollama on this box, or any
          OpenAI-compatible endpoint). Persisted to{" "}
          <code>generated/settings.json</code>.
        </p>
      </div>

      <SettingsForm initial={settings} />
    </div>
  );
}
