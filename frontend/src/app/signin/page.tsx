import { AuthError } from "next-auth";
import { redirect } from "next/navigation";
import { FileSearch, Presentation, Radar, ShieldCheck } from "lucide-react";

import { devLoginEnabled, oauthProviders, signIn } from "@/auth";

export const metadata = { title: "Sign in" };

function safeCallback(url: string | undefined): string {
  return url && url.startsWith("/") && !url.startsWith("//") ? url : "/";
}

const FEATURES = [
  { icon: FileSearch, title: "Evidence in", text: "Documents and interview notes, parsed, redacted and searchable." },
  { icon: ShieldCheck, title: "Seven frameworks", text: "NIST CSF 2.0, SAMM, SSDF, BSIMM, ASVS, SLSA, ISO/IEC 27034." },
  { icon: Radar, title: "Scored with care", text: "Claude cites every score. Assessors keep the final word." },
  { icon: Presentation, title: "Report out", text: "A client-ready PowerPoint, or your own template, in one click." },
];

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string; error?: string }>;
}) {
  const { callbackUrl, error } = await searchParams;
  const redirectTo = safeCallback(callbackUrl);
  const noProviders = !oauthProviders.github && !oauthProviders.google && !devLoginEnabled;

  async function oauth(formData: FormData) {
    "use server";
    const provider = String(formData.get("provider"));
    await signIn(provider, { redirectTo });
  }

  async function devLogin(formData: FormData) {
    "use server";
    try {
      await signIn("dev-login", { email: String(formData.get("email") ?? ""), redirectTo });
    } catch (e) {
      if (e instanceof AuthError) redirect(`/signin?error=CredentialsSignin`);
      throw e;
    }
  }

  return (
    <main>
      <section className="bg-white">
        <div className="mx-auto max-w-[980px] px-5 pb-20 pt-24 text-center">
          <p className="eyebrow">Secure SDLC maturity assessment</p>
          <h1 className="mt-4 text-5xl font-semibold leading-[1.05] tracking-tight text-ink sm:text-7xl">
            Secure software.
            <br />
            <span className="text-brand-7">Measured.</span>
          </h1>
          <p className="mx-auto mt-6 max-w-[620px] text-xl leading-relaxed text-muted sm:text-2xl">
            Turn client documentation and interviews into framework scores, a prioritised roadmap and a
            board-ready report.
          </p>

          {error && (
            <p role="alert" className="mx-auto mt-8 max-w-md rounded-2xl bg-red-50 px-4 py-3 text-sm text-danger">
              {error === "CredentialsSignin" ? "Enter a valid e-mail address." : "Sign-in failed. Please try again."}
            </p>
          )}

          <div className="mx-auto mt-10 flex max-w-md flex-col items-center gap-3">
            {oauthProviders.github && (
              <form action={oauth} className="w-full">
                <input type="hidden" name="provider" value="github" />
                <button type="submit" className="pill-primary w-full py-3 text-[15px]">
                  Continue with GitHub
                </button>
              </form>
            )}
            {oauthProviders.google && (
              <form action={oauth} className="w-full">
                <input type="hidden" name="provider" value="google" />
                <button type="submit" className="pill-secondary w-full py-3 text-[15px]">
                  Continue with Google
                </button>
              </form>
            )}
            {devLoginEnabled && (
              <form action={devLogin} className="mt-4 w-full rounded-[var(--radius-card)] bg-canvas p-5 text-left">
                <label htmlFor="email" className="label">
                  Development login (local testing only)
                </label>
                <div className="flex gap-2">
                  <input
                    id="email"
                    name="email"
                    type="email"
                    required
                    placeholder="you@example.com"
                    className="input"
                    autoComplete="email"
                  />
                  <button type="submit" className="pill-brand shrink-0">
                    Sign in
                  </button>
                </div>
              </form>
            )}
            {noProviders && (
              <p className="rounded-2xl bg-canvas px-4 py-3 text-sm text-muted">
                No sign-in method is configured. Set AUTH_GITHUB_ID/SECRET or AUTH_GOOGLE_ID/SECRET, or
                ENABLE_DEV_LOGIN=true for local development.
              </p>
            )}
          </div>
        </div>
      </section>
      <section className="mx-auto grid max-w-[1080px] gap-4 px-5 py-16 sm:grid-cols-2 lg:grid-cols-4">
        {FEATURES.map(({ icon: Icon, title, text }) => (
          <div key={title} className="card p-6">
            <Icon className="h-7 w-7 text-brand-6" strokeWidth={1.5} aria-hidden />
            <h2 className="mt-4 text-[17px] font-semibold text-ink">{title}</h2>
            <p className="mt-1.5 text-[15px] leading-relaxed text-muted">{text}</p>
          </div>
        ))}
      </section>
    </main>
  );
}
