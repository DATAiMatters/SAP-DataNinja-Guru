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
        <h1>Ingest source document</h1>
        <p>
          <Link href="/sign-in?callbackUrl=/ingest">Sign in</Link> to ingest
          documents.
        </p>
      </div>
    );
  }

  return (
    <div>
      <h1>Ingest source document</h1>
      <p className="muted">
        Upload a PDF or paste a URL. The extraction pipeline runs server-side
        and proposes annotations into{" "}
        <Link href="/inbox">/inbox</Link> for review.
      </p>
      <IngestForm domains={domains} />
    </div>
  );
}
