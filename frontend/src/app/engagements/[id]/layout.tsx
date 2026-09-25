"use client";

import Link from "next/link";
import { useParams, usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { StatusBadge } from "@/components/ui";
import { useEngagement } from "@/lib/hooks";

const TABS = [
  { href: "", label: "Overview" },
  { href: "/evidence", label: "Evidence" },
  { href: "/analysis", label: "Analysis" },
  { href: "/results", label: "Results" },
  { href: "/report", label: "Report" },
  { href: "/activity", label: "Activity" },
];

export default function EngagementLayout({ children }: { children: ReactNode }) {
  const { id } = useParams<{ id: string }>();
  const pathname = usePathname();
  const eng = useEngagement(id);
  const base = `/engagements/${id}`;

  return (
    <>
      <div className="sticky top-12 z-30 border-b border-black/5 bg-white/80 backdrop-blur-xl backdrop-saturate-150">
        <div className="mx-auto flex max-w-[1080px] flex-wrap items-center justify-between gap-x-6 gap-y-1 px-5 py-2">
          <div className="flex min-w-0 items-center gap-3">
            <span className="truncate text-[19px] font-semibold tracking-tight text-ink" data-testid="engagement-title">
              {eng.data ? eng.data.app_name : " "}
            </span>
            {eng.data && <span className="hidden truncate text-[13px] text-muted sm:inline">{eng.data.client_name}</span>}
            {eng.data && <StatusBadge status={eng.data.status} />}
          </div>
          <nav aria-label="Engagement" className="-mx-2 flex overflow-x-auto">
            {TABS.map((t) => {
              const href = base + t.href;
              const active = t.href === "" ? pathname === base : pathname.startsWith(href);
              return (
                <Link
                  key={t.label}
                  href={href}
                  aria-current={active ? "page" : undefined}
                  className={`whitespace-nowrap rounded-full px-3 py-1.5 text-[13px] transition ${
                    active ? "bg-ink text-white" : "text-fg hover:bg-black/5"
                  }`}
                >
                  {t.label}
                </Link>
              );
            })}
          </nav>
        </div>
      </div>
      <main className="mx-auto max-w-[1080px] px-5 pb-24 pt-10">
        {eng.error ? (
          <div className="card p-10 text-center">
            <h1 className="text-2xl font-semibold text-ink">Engagement not found</h1>
            <p className="mt-2 text-muted">It may have been deleted, or it belongs to another organization.</p>
            <Link href="/" className="pill-secondary mt-6">Back to engagements</Link>
          </div>
        ) : (
          children
        )}
      </main>
    </>
  );
}
