import Link from "next/link";
import { auth, signOut } from "@/auth";

export default async function SessionMenu() {
  const session = await auth();
  if (!session?.user) {
    return (
      <Link href="/sign-in" className="cmdk-trigger">
        Sign in
      </Link>
    );
  }
  return (
    <form
      action={async () => {
        "use server";
        await signOut({ redirectTo: "/" });
      }}
      className="session-menu"
    >
      <span className="session-email" title={session.user.email ?? ""}>
        {session.user.email}
      </span>
      <button type="submit" className="session-signout">
        Sign out
      </button>
    </form>
  );
}
