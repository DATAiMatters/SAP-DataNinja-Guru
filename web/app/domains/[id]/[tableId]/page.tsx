import Link from "next/link";
import { notFound } from "next/navigation";
import {
  getDomain,
  getEntity,
  getRelationshipsFor,
  type RelatedEdge,
} from "@/lib/content";
import { getClusterColor, getClusterName } from "@/lib/clusters";
import {
  isPolymorphic,
  type Annotation,
  type RelationshipPolymorphic,
  type RelationshipSimple,
  type Table,
} from "@/lib/schema-types";
import { auth } from "@/auth";
import { getVoteSummary } from "@/lib/votes";
import { getCommentsFor } from "@/lib/comments";
import { getAnnotationsFor } from "@/lib/annotations";
import { targetId } from "@/lib/target-id";
import VoteButtons from "@/components/VoteButtons";
import CommentThread from "@/components/CommentThread";
import AnnotationsSection from "@/components/AnnotationsSection";

export default async function EntityPage({
  params,
}: {
  params: Promise<{ id: string; tableId: string }>;
}) {
  const { id, tableId } = await params;
  const found = getEntity(id, tableId);
  if (!found) notFound();
  const { domain, table } = found;
  const edges = getRelationshipsFor(domain, tableId);

  const session = await auth();
  const tableTargetId = targetId(id, "table", tableId);
  const [voteSummary, commentList, annotationList] = await Promise.all([
    getVoteSummary(tableTargetId, session?.user?.id),
    getCommentsFor(tableTargetId),
    getAnnotationsFor(tableTargetId),
  ]);

  const outgoingSimple = edges.filter(
    (e) => e.direction === "outgoing" && !isPolymorphic(e.relationship),
  ) as Array<RelatedEdge & { relationship: RelationshipSimple }>;
  const incoming = edges.filter((e) => e.direction === "incoming");
  // Polymorphic relationships originating *from* this table (deduped):
  const polymorphicOut = Array.from(
    new Map(
      edges
        .filter(
          (e) =>
            e.direction === "outgoing" && isPolymorphic(e.relationship),
        )
        .map((e) => [e.relationship.id, e.relationship as RelationshipPolymorphic]),
    ).values(),
  );

  return (
    <div>
      <p className="muted">
        <Link href="/">Domains</Link> ›{" "}
        <Link href={`/domains/${id}`}>{domain.domain.name}</Link> › {table.id}
      </p>

      <h1 className="entity-title">
        <span>
          <code className="entity-id-large">{table.id}</code> {table.name}
        </span>
        <VoteButtons
          targetType="table"
          targetId={tableTargetId}
          initialScore={voteSummary.score}
          initialUserValue={voteSummary.userValue}
          signedIn={!!session?.user}
        />
      </h1>
      <p className="muted">
        <span
          className="cluster-swatch"
          style={{ background: getClusterColor(table.cluster) }}
          aria-hidden="true"
        />{" "}
        {getClusterName(table.cluster)}
        {table.text_table && (
          <>
            {" · "}text table:{" "}
            <Link href={`/domains/${id}/${table.text_table}`}>
              <code>{table.text_table}</code>
            </Link>
          </>
        )}
      </p>

      <Gotchas annotations={table.gotchas} />

      {table.description && (
        <Section title="Description">
          <Prose text={table.description} />
        </Section>
      )}

      {table.fields && table.fields.length > 0 && (
        <Section title="Fields">
          <Fields table={table} />
        </Section>
      )}

      {table.notes && (
        <Section title="Notes">
          <Prose text={table.notes} />
        </Section>
      )}

      {table.s4_changes && table.s4_changes.length > 0 && (
        <Section title="S/4HANA changes">
          <S4Changes annotations={table.s4_changes} />
        </Section>
      )}

      {polymorphicOut.length > 0 && (
        <Section title="Polymorphic resolution">
          {polymorphicOut.map((rel) => (
            <PolymorphicBlock key={rel.id} rel={rel} domainId={id} />
          ))}
        </Section>
      )}

      {outgoingSimple.length > 0 && (
        <Section title={`Outgoing relationships (${outgoingSimple.length})`}>
          <ul className="rel-list">
            {outgoingSimple.map((e) => (
              <SimpleRelRow
                key={e.relationship.id}
                rel={e.relationship}
                domainId={id}
                arrow="→"
                otherTable={e.otherTable}
              />
            ))}
          </ul>
        </Section>
      )}

      {incoming.length > 0 && (
        <Section title={`Incoming relationships (${incoming.length})`}>
          <ul className="rel-list">
            {incoming.map((e, i) =>
              isPolymorphic(e.relationship) ? (
                <PolyIncomingRow
                  key={`${e.relationship.id}-${i}`}
                  rel={e.relationship}
                  thisTable={tableId}
                  domainId={id}
                />
              ) : (
                <SimpleRelRow
                  key={e.relationship.id}
                  rel={e.relationship}
                  domainId={id}
                  arrow="←"
                  otherTable={e.otherTable}
                />
              ),
            )}
          </ul>
        </Section>
      )}

      <Section
        title={`Proposed annotations (${annotationList.length})`}
      >
        <AnnotationsSection
          targetType="table"
          targetId={tableTargetId}
          annotations={annotationList}
          signedIn={!!session?.user}
          currentUserId={session?.user?.id ?? null}
        />
      </Section>

      <Section title={`Discussion (${countAll(commentList)})`}>
        <CommentThread
          targetType="table"
          targetId={tableTargetId}
          comments={commentList}
          signedIn={!!session?.user}
          currentUserId={session?.user?.id ?? null}
        />
      </Section>
    </div>
  );
}

function countAll(items: { replies: { id: string }[] }[]): number {
  return items.reduce((s, c) => s + 1 + c.replies.length, 0);
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="entity-section">
      <h2>{title}</h2>
      {children}
    </section>
  );
}

function Prose({ text }: { text: string }) {
  return <p className="prose">{text}</p>;
}

function Gotchas({ annotations }: { annotations?: Annotation[] }) {
  if (!annotations || annotations.length === 0) return null;
  return (
    <div className="gotcha-banner" role="alert">
      <h2 className="gotcha-banner-title">
        ⚠ {annotations.length} gotcha{annotations.length === 1 ? "" : "s"}
      </h2>
      <ul>
        {annotations.map((g, i) => (
          <li key={i}>
            {g.severity && (
              <span className={`severity severity-${g.severity}`}>
                {g.severity}
              </span>
            )}{" "}
            {g.text}
            {g.source && <span className="muted"> — {g.source}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

function S4Changes({ annotations }: { annotations: Annotation[] }) {
  return (
    <ul className="s4-list">
      {annotations.map((a, i) => (
        <li key={i}>
          {a.severity && (
            <span className={`severity severity-${a.severity}`}>
              {a.severity}
            </span>
          )}{" "}
          {a.text}
          {a.source && <span className="muted"> — {a.source}</span>}
        </li>
      ))}
    </ul>
  );
}

function Fields({ table }: { table: Table }) {
  const keys = new Set(table.key_fields ?? []);
  return (
    <table className="fields-table">
      <thead>
        <tr>
          <th>Field</th>
          <th>Description</th>
          <th>Data element</th>
          <th>Length</th>
        </tr>
      </thead>
      <tbody>
        {table.fields!.map((f) => (
          <tr key={f.name}>
            <td>
              <code>{f.name}</code>
              {keys.has(f.name) && <span className="key-marker">PK</span>}
            </td>
            <td>{f.description ?? ""}</td>
            <td>{f.data_element ? <code>{f.data_element}</code> : ""}</td>
            <td>{f.length ?? ""}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function PolymorphicBlock({
  rel,
  domainId,
}: {
  rel: RelationshipPolymorphic;
  domainId: string;
}) {
  return (
    <div className="poly-block">
      <p>
        <strong>{rel.id}</strong>
        {rel.description && <> — {rel.description}</>}
      </p>
      <p className="muted">
        Discriminator fields:{" "}
        {rel.from.fields.map((f, i) => (
          <span key={f}>
            {i > 0 && ", "}
            <code>{f}</code>
          </span>
        ))}
      </p>
      <table className="poly-table">
        <thead>
          <tr>
            <th>KLART</th>
            <th>Target table</th>
            <th>OBJEK format</th>
            <th>via INOB</th>
            <th>Notes</th>
          </tr>
        </thead>
        <tbody>
          {rel.object_resolution.map((res, i) => (
            <tr key={i}>
              <td><code>{res.klart ?? "—"}</code></td>
              <td>
                <Link href={`/domains/${domainId}/${res.target_table}`}>
                  <code>{res.target_table}</code>
                </Link>
              </td>
              <td>{res.objek_format ? <code>{res.objek_format}</code> : ""}</td>
              <td>{res.via_inob ? "yes" : "no"}</td>
              <td>{res.notes ?? ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {rel.sql_examples?.map((ex, i) => (
        <details key={i} className="sql-block">
          <summary>SQL: {ex.title}</summary>
          <pre><code>{ex.body}</code></pre>
        </details>
      ))}
    </div>
  );
}

function SimpleRelRow({
  rel,
  domainId,
  arrow,
  otherTable,
}: {
  rel: RelationshipSimple;
  domainId: string;
  arrow: string;
  otherTable: string;
}) {
  const cardinality = rel.cardinality ?? "many_to_one";
  const fieldStr = rel.from.fields.join(" + ");
  return (
    <li className="rel-row">
      <div className="rel-summary">
        <code>{rel.id}</code> {arrow}{" "}
        <Link href={`/domains/${domainId}/${otherTable}`}>
          <code>{otherTable}</code>
        </Link>{" "}
        <span className="pill">{cardinality}</span>
        {rel.optional && <span className="pill">optional</span>}{" "}
        on <code>{fieldStr}</code>
      </div>
      {rel.description && <p className="muted">{rel.description}</p>}
      {rel.conditions && (
        <p className="muted">
          when{" "}
          {Object.entries(rel.conditions).map(([k, v]) => (
            <code key={k}>
              {k}={String(v)}
            </code>
          ))}
        </p>
      )}
      {rel.sql_example && (
        <details className="sql-block">
          <summary>SQL example</summary>
          <pre><code>{rel.sql_example}</code></pre>
        </details>
      )}
    </li>
  );
}

function PolyIncomingRow({
  rel,
  thisTable,
  domainId,
}: {
  rel: RelationshipPolymorphic;
  thisTable: string;
  domainId: string;
}) {
  const matches = rel.object_resolution.filter(
    (r) => r.target_table === thisTable,
  );
  return (
    <li className="rel-row">
      <div className="rel-summary">
        <code>{rel.id}</code> ←{" "}
        <Link href={`/domains/${domainId}/${rel.from.table}`}>
          <code>{rel.from.table}</code>
        </Link>{" "}
        <span className="pill">polymorphic</span>
      </div>
      <p className="muted">
        Resolves here when{" "}
        {matches
          .map((m) => `KLART=${m.klart}${m.via_inob ? " (via INOB)" : ""}`)
          .join(", ")}
      </p>
    </li>
  );
}
