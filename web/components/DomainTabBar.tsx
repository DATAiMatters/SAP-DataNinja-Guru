import Link from "next/link";

type Tab = "overview" | "erd" | "diagram" | "activity";

interface Props {
  domainId: string;
  active: Tab;
}

/**
 * Sub-tab strip shown beneath the domain title on every domain sub-route.
 * Keeps tab order + labels consistent so the user always knows where they
 * are. The "Overview" tab links back to the domain index.
 */
export default function DomainTabBar({ domainId, active }: Props) {
  return (
    <nav className="tabs" aria-label="Domain views">
      <Tab href={`/domains/${domainId}`} active={active === "overview"}>
        Overview
      </Tab>
      <Tab href={`/domains/${domainId}/erd`} active={active === "erd"}>
        Interactive ERD
      </Tab>
      <Tab href={`/domains/${domainId}/diagram`} active={active === "diagram"}>
        Diagram
      </Tab>
      <Tab href={`/domains/${domainId}/activity`} active={active === "activity"}>
        Activity
      </Tab>
    </nav>
  );
}

function Tab({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  if (active) return <span className="tab active">{children}</span>;
  return (
    <Link href={href} className="tab">
      {children}
    </Link>
  );
}
