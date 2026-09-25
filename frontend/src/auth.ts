import NextAuth, { type NextAuthConfig } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import GitHub from "next-auth/providers/github";
import Google from "next-auth/providers/google";

/**
 * The dev-only e-mail login lets you sign in locally (and in CI) without OAuth apps. It trusts
 * the typed e-mail address, so it is enabled only when ENABLE_DEV_LOGIN=true and never on any
 * Vercel deployment (production or preview), where it would allow impersonation.
 */
export const devLoginEnabled = process.env.ENABLE_DEV_LOGIN === "true" && !process.env.VERCEL;

export const oauthProviders = {
  github: Boolean(process.env.AUTH_GITHUB_ID && process.env.AUTH_GITHUB_SECRET),
  google: Boolean(process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET),
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const providers: NextAuthConfig["providers"] = [];
if (oauthProviders.github) providers.push(GitHub);
if (oauthProviders.google) providers.push(Google);
if (devLoginEnabled) {
  providers.push(
    Credentials({
      id: "dev-login",
      name: "Development e-mail login",
      credentials: { email: { label: "E-mail", type: "email" } },
      authorize(credentials) {
        const email = String(credentials?.email ?? "").trim().toLowerCase();
        if (!EMAIL_RE.test(email) || email.length > 320) return null;
        return { id: email, email, name: email.split("@")[0] };
      },
    }),
  );
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers,
  session: { strategy: "jwt", maxAge: 8 * 60 * 60 },
  pages: { signIn: "/signin", error: "/signin" },
  callbacks: {
    authorized({ auth: session }) {
      return Boolean(session?.user?.email);
    },
    signIn({ user }) {
      // Every account must have an e-mail address; the API keys users by e-mail.
      return Boolean(user?.email);
    },
  },
});
