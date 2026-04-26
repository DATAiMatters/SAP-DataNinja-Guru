import { signIn } from "@/auth";

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string; error?: string }>;
}) {
  const { callbackUrl, error } = await searchParams;

  return (
    <div className="signin-card">
      <h1>Sign in</h1>
      <p className="muted">
        Enter your email and we&apos;ll send a magic link.
      </p>
      {error && (
        <p className="signin-error">
          Sign-in failed ({error}). Try again.
        </p>
      )}
      <form
        action={async (formData) => {
          "use server";
          await signIn("email", {
            email: String(formData.get("email") ?? ""),
            redirectTo: callbackUrl ?? "/",
          });
        }}
        className="signin-form"
      >
        <input
          type="email"
          name="email"
          required
          placeholder="you@example.com"
          autoComplete="email"
          autoFocus
        />
        <button type="submit">Send magic link</button>
      </form>
    </div>
  );
}
