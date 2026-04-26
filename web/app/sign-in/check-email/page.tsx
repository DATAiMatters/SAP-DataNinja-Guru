export default function CheckEmailPage() {
  return (
    <div className="signin-card">
      <h1>Check your email</h1>
      <p>
        We sent you a magic link. Open it on this device to sign in.
      </p>
      <p className="muted">
        Running locally without a Resend key? The link is in the dev
        server console.
      </p>
    </div>
  );
}
