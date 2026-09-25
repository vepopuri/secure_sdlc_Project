import Link from "next/link";
import { LogOut, Settings } from "lucide-react";

import { signOut } from "@/auth";

import Brand from "./Brand";

export default function NavBar({ email }: { email: string | null }) {
  return (
    <header className="sticky top-0 z-40 border-b border-black/5 bg-white/72 backdrop-blur-xl backdrop-saturate-150">
      <nav className="mx-auto flex h-12 max-w-[1080px] items-center justify-between px-5" aria-label="Main">
        <Link href="/" className="flex items-center" aria-label="Home">
          <Brand />
        </Link>
        {email && (
          <div className="flex items-center gap-1 text-[13px] text-fg">
            <Link href="/" className="rounded-full px-3 py-1.5 hover:bg-black/5">
              Engagements
            </Link>
            <Link
              href="/settings"
              className="flex items-center gap-1.5 rounded-full px-3 py-1.5 hover:bg-black/5"
              aria-label="Settings"
            >
              <Settings className="h-4 w-4 text-brand-6" strokeWidth={1.75} />
              <span className="hidden sm:inline">Settings</span>
            </Link>
            <span className="mx-2 hidden text-muted md:inline" data-testid="user-email">
              {email}
            </span>
            <form
              action={async () => {
                "use server";
                await signOut({ redirectTo: "/signin" });
              }}
            >
              <button
                type="submit"
                className="flex items-center gap-1.5 rounded-full px-3 py-1.5 hover:bg-black/5"
                aria-label="Sign out"
              >
                <LogOut className="h-4 w-4 text-brand-6" strokeWidth={1.75} />
                <span className="hidden sm:inline">Sign out</span>
              </button>
            </form>
          </div>
        )}
      </nav>
    </header>
  );
}
