import "server-only";
import type { Session } from "next-auth";

// Hard-coded admin allowlist for now. Once we have a real users table with
// a role column, swap this for a DB-backed check.
const ADMIN_EMAILS: ReadonlySet<string> = new Set([
  "pedro.cardoso@syniti.com",
  "pedro.a.cardoso@capgemini.com",
]);

export function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return ADMIN_EMAILS.has(email.trim().toLowerCase());
}

export function isAdmin(session: Session | null): boolean {
  return isAdminEmail(session?.user?.email);
}
