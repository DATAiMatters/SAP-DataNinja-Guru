import Link from "next/link";
import { auth } from "@/auth";
import { listDomainIds } from "@/lib/content";
import IngestForm from "@/components/IngestForm";

export const dynamic = "force-dynamic";

export default async function IngestPage() {
  const session = await auth();
  const domains = listDomainIds();

  if (!session?.user) {
    return (
      <div>
        <div className="page-header">
          <nav className="breadcrumb" aria-label="Breadcrumb">
            <span>Curate</span>
            <span className="breadcrumb-sep">›</span>
            <span>Ingest</span>
          </nav>
          <div className="page-title-row">
            <h1>Ingest source document</h1>
          </div>
        </div>
        <div className="card card-padded" style={{ maxWidth: 480 }}>
          <p style={{ margin: 0 }}>
            <Link href="/sign-in?callbackUrl=/ingest">Sign in</Link> to ingest
            documents.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="page-header">
        <nav className="breadcrumb" aria-label="Breadcrumb">
          <span>Curate</span>
          <span className="breadcrumb-sep">›</span>
          <span>Ingest</span>
        </nav>
        <div className="page-title-row">
          <h1>Ingest source document</h1>
        </div>
        <p className="muted" style={{ margin: 0, maxWidth: 720 }}>
          Upload a PDF or paste a URL. The extraction pipeline runs server-side
          and proposes annotations into{" "}
          <Link href="/inbox">/inbox</Link> for review. Choose
          &quot;Propose new domain&quot; to scaffold a brand-new domain YAML
          from a source document.
        </p>
      </div>
      <IngestForm domains={domains} />
    </div>
  );
}
