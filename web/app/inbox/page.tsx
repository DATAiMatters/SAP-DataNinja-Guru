import Link from "next/link";
import { auth } from "@/auth";
import { getInboxAnnotations, getInboxCounts } from "@/lib/inbox";
import type { AnnotationStatus } from "@/lib/db/schema";
import InboxRow from "@/components/InboxRow";

export const dynamic = "force-dynamic";

const TABS: { key: AnnotationStatus | "all"; label: string }[] = [
  { key: "proposed", label: "Proposed" },
  { key: "accepted", label: "Accepted" },
  { key: "promoted", label: "Promoted" },
  { key: "rejected", label: "Rejected" },
  { key: "all", label: "All" },
];

export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const sp = await searchParams;
  const filter = (sp.status ?? "proposed") as AnnotationStatus | "all";
  const [items, counts, session] = await Promise.all([
    getInboxAnnotations(filter === "all" ? undefined : filter),
    getInboxCounts(),
    auth(),
  ]);

  const totalCount = Object.values(counts).reduce((s, n) => s + n, 0);

  return (
    <div>
      <div className="page-header">
        <nav className="breadcrumb" aria-label="Breadcrumb">
          <span>Curate</span>
          <span className="breadcrumb-sep">›</span>
          <span>Inbox</span>
        </nav>
        <div className="page-title-row">
          <h1>Annotation inbox</h1>
        </div>
        <p className="muted" style={{ margin: 0, maxWidth: 720 }}>
          Review and act on annotations across all domains. Inline accept,
          reject, or promote to YAML.
        </p>
      </div>

      <div className="stat-bar" aria-label="Inbox totals">
        <div className="stat-bar-item">
          <span className="stat-num" style={{ color: "var(--warning)" }}>{counts.proposed}</span>
          <span className="stat-label">Proposed</span>
        </div>
        <div className="stat-bar-item">
          <span className="stat-num" style={{ color: "var(--success)" }}>{counts.accepted}</span>
          <span className="stat-label">Accepted</span>
        </div>
        <div className="stat-bar-item">
          <span className="stat-num" style={{ color: "var(--accent)" }}>{counts.promoted}</span>
          <span className="stat-label">Promoted</span>
        </div>
        <div className="stat-bar-item">
          <span className="stat-num" style={{ color: "var(--muted)" }}>{counts.rejected}</span>
          <span className="stat-label">Rejected</span>
        </div>
        <div className="stat-bar-item">
          <span className="stat-num">{totalCount}</span>
          <span className="stat-label">Total</span>
        </div>
      </div>

      <div className="inbox-tabs">
        {TABS.map((tab) => {
          const count =
            tab.key === "all"
              ? Object.values(counts).reduce((s, n) => s + n, 0)
              : counts[tab.key];
          const active = filter === tab.key;
          return (
            <Link
              key={tab.key}
              href={`/inbox?status=${tab.key}`}
              className={`inbox-tab${active ? " active" : ""}`}
            >
              {tab.label} <span className="muted">({count})</span>
            </Link>
          );
        })}
      </div>

      {!session?.user && (
        <p className="signin-error">
          <Link href="/sign-in?callbackUrl=/inbox">Sign in</Link> to act on
          annotations. You can still view them.
        </p>
      )}

      {items.length === 0 ? (
        <p className="muted">No annotations matching this filter.</p>
      ) : (
        <ul className="annotation-list">
          {items.map((a) => (
            <InboxRow
              key={a.id}
              annotation={a}
              signedIn={!!session?.user}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
