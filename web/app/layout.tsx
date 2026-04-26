import type { Metadata } from "next";
import Link from "next/link";
import CommandK from "@/components/CommandK";
import "./globals.css";

export const metadata: Metadata = {
  title: "SAP Knowledge Base",
  description: "Curated SAP table relationships, joins, and migration notes",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <header className="site-header">
          <Link href="/" className="site-title">SAP Knowledge Base</Link>
          <CommandK />
        </header>
        <main className="site-main">{children}</main>
      </body>
    </html>
  );
}
