import type { Metadata } from "next";
import Link from "next/link";
import { Inter, JetBrains_Mono } from "next/font/google";
import CommandK from "@/components/CommandK";
import SessionMenu from "@/components/SessionMenu";
import { auth } from "@/auth";
import { isAdmin } from "@/lib/admin";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-sans",
});
const mono = JetBrains_Mono({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-mono",
});

export const metadata: Metadata = {
  title: "SAP Knowledge Base",
  description: "Curated SAP table relationships, joins, and migration notes",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Auth check at layout level so the admin-only nav (e.g. Settings)
  // doesn't render for non-admin sessions. The settings page itself
  // also gates access — this is just to avoid showing a link that
  // 403s. "Protect later" is honored by living in the env-based admin
  // allowlist; swap for a DB-backed check when the user table arrives.
  const session = await auth();
  const adminOnline = isAdmin(session);

  return (
    <html lang="en" className={`${inter.variable} ${mono.variable}`}>
      <body className="app-shell">
        <aside className="app-sidebar">
          <Link href="/" className="nav-brand">
            <span className="nav-brand-mark">SK</span>
            <span className="nav-brand-text">
              <span className="nav-brand-title">SAP Knowledge</span>
              <span className="nav-brand-sub">Base</span>
            </span>
          </Link>

          <nav className="nav-sections">
            <div className="nav-section">
              <div className="nav-section-label">Browse</div>
              <Link href="/" className="nav-link">
                <span className="nav-link-icon" aria-hidden>◇</span>
                Domains
              </Link>
            </div>
            <div className="nav-section">
              <div className="nav-section-label">Curate</div>
              <Link href="/inbox" className="nav-link">
                <span className="nav-link-icon" aria-hidden>▤</span>
                Inbox
              </Link>
              <Link href="/ingest" className="nav-link">
                <span className="nav-link-icon" aria-hidden>↑</span>
                Ingest
              </Link>
              <Link href="/jobs" className="nav-link">
                <span className="nav-link-icon" aria-hidden>⏱</span>
                Runs
              </Link>
              <Link href="/evals" className="nav-link">
                <span className="nav-link-icon" aria-hidden>📊</span>
                Evals
              </Link>
            </div>
            {adminOnline && (
              <div className="nav-section">
                <div className="nav-section-label">Admin</div>
                <Link href="/settings" className="nav-link">
                  <span className="nav-link-icon" aria-hidden>⚙</span>
                  Settings
                </Link>
              </div>
            )}
          </nav>

          <div className="nav-footer">
            <SessionMenu />
          </div>
        </aside>

        <div className="app-main">
          <header className="app-topbar">
            <div className="app-topbar-spacer" />
            <CommandK />
          </header>
          <main className="app-content">{children}</main>
        </div>
      </body>
    </html>
  );
}
