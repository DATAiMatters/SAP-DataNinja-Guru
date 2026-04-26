import Link from "next/link";
import { notFound } from "next/navigation";
import { getDomain, listDomainIds } from "@/lib/content";
import {
  getDomainActivity,
  parseTargetId,
  type ActivityItem,
} from "@/lib/activity";

export function generateStaticParams() {
  return listDomainIds().map((id) => ({ id }));
}

export const dynamic = "force-dynamic";

export default async function ActivityPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const domain = getDomain(id);
  if (!domain) notFound();
  const items = await getDomainActivity(id, 100);

  return (
    <div>
      <p className="muted">
        <Link href="/">Domains</Link> ›{" "}
        <Link href={`/domains/${id}`}>{domain.domain.name}</Link> › Activity
      </p>
      <h1>{domain.domain.name} — Activity</h1>
      <p className="muted">
        Recent votes, comments, and annotations across this domain.
      </p>

      {items.length === 0 ? (
        <p className="muted">No activity yet.</p>
      ) : (
        <ul className="activity-list">
          {items.map((item) => (
            <ActivityRow key={`${item.kind}:${item.id}`} item={item} />
          ))}
        </ul>
      )}
    </div>
  );
}

function ActivityRow({ item }: { item: ActivityItem }) {
  const target = parseTargetId(item.targetId);
  const targetLink = target ? (
    <Link href={`/domains/${target.domainId}/${target.id}`}>
      <code>{target.id}</code>
    </Link>
  ) : (
    <code>{item.targetId}</code>
  );

  const who = item.userName ?? item.userEmail;
  const when = new Date(item.createdAt).toLocaleString();

  return (
    <li className={`activity-row activity-row-${item.kind}`}>
      <div className="activity-meta">
        <span className={`activity-badge activity-badge-${item.kind}`}>
          {labelFor(item)}
        </span>
        <span className="muted">
          <strong>{who}</strong> · {when}
        </span>
      </div>
      <div className="activity-body">
        {summary(item)} on {targetLink}
        {snippet(item) && (
          <div className="activity-snippet">{snippet(item)}</div>
        )}
      </div>
    </li>
  );
}

function labelFor(item: ActivityItem): string {
  switch (item.kind) {
    case "vote":
      return item.value > 0 ? "Upvote" : "Downvote";
    case "comment":
      return item.parentId ? "Reply" : "Comment";
    case "annotation":
      return `Annotation (${item.annotationKind}, ${item.status})`;
  }
}

function summary(item: ActivityItem): string {
  switch (item.kind) {
    case "vote":
      return item.value > 0 ? "Upvoted" : "Downvoted";
    case "comment":
      return item.parentId ? "Replied" : "Commented";
    case "annotation":
      return `Proposed ${item.annotationKind}`;
  }
}

function snippet(item: ActivityItem): string | null {
  switch (item.kind) {
    case "vote":
      return null;
    case "comment":
    case "annotation":
      return truncate(item.bodyMd, 200);
  }
}

function truncate(s: string, n: number): string {
  const clean = s.replace(/\s+/g, " ").trim();
  return clean.length <= n ? clean : clean.slice(0, n - 1) + "…";
}
