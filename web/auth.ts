import NextAuth from "next-auth";
import Resend from "next-auth/providers/resend";
import type { EmailConfig } from "next-auth/providers";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { db } from "@/lib/db";
import {
  accounts,
  sessions,
  users,
  verificationTokens,
} from "@/lib/db/schema";

const useResend = !!process.env.AUTH_RESEND_KEY;

// Dev fallback: when no Resend API key is set, log the magic link to the
// server console instead of trying to send email. Lets contributors run
// the app without an email provider.
const consoleEmail: EmailConfig = {
  id: "email",
  type: "email",
  name: "Magic link (dev console)",
  from: "noreply@local.dev",
  maxAge: 24 * 60 * 60,
  options: {},
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  server: {} as any,
  async sendVerificationRequest({ identifier, url }) {
    // eslint-disable-next-line no-console
    console.log(
      `\n────────────────────────────────────────────────────────\n` +
        `✉️   Magic link for ${identifier}\n` +
        `    ${url}\n` +
        `────────────────────────────────────────────────────────\n`,
    );
  },
};

export const { handlers, signIn, signOut, auth } = NextAuth({
  adapter: DrizzleAdapter(db, {
    usersTable: users,
    accountsTable: accounts,
    sessionsTable: sessions,
    verificationTokensTable: verificationTokens,
  }),
  providers: [
    useResend
      ? Resend({
          id: "email",
          apiKey: process.env.AUTH_RESEND_KEY!,
          from:
            process.env.AUTH_RESEND_FROM ?? "onboarding@resend.dev",
        })
      : consoleEmail,
  ],
  pages: {
    signIn: "/sign-in",
    verifyRequest: "/sign-in/check-email",
  },
  session: { strategy: "database" },
});
