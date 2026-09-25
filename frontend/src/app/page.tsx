"use client";

import { useQuery } from "@tanstack/react-query";
import { ChevronRight, FileText, FolderOpen, MessagesSquare, Plus } from "lucide-react";
import Link from "next/link";

import { EmptyState, ErrorNote, Spinner, StatusBadge } from "@/components/ui";
import { api } from "@/lib/api";
import { formatDate, useCanWrite, useFrameworks } from "@/lib/hooks";
import type { Engagement } from "@/lib/types";

export default function Dashboard() {
  const canWrite = useCanWrite();
  const frameworks = useFrameworks();
  const q = useQuery({ queryKey: ["engagements"], queryFn: () => api<Engagement[]>("/api/engagements") });
  const fwName = (key: string) => frameworks.data?.find((f) => f.key === key)?.short_name ?? key;

  return (
    <main className="mx-auto max-w-[1080px] px-5 pb-24 pt-14">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">Your portfolio</p>
          <h1 className="mt-2 text-5xl font-semibold tracking-tight text-ink">Engagements.</h1>
        </div>
        {canWrite && (
          <Link href="/engagements/new" className="pill-brand">
            <Plus className="h-4 w-4" aria-hidden /> New engagement
          </Link>
        )}
      </div>

      <div className="mt-10">
        {q.isLoading && <Spinner />}
        <ErrorNote error={q.error} />
        {q.data?.length === 0 && (
          <EmptyState icon={<FolderOpen className="h-10 w-10" strokeWidth={1.25} />} title="No engagements yet">
            Create an engagement to start collecting evidence for a client application.
          </EmptyState>
        )}
        <ul className="grid gap-4 md:grid-cols-2">
          {q.data?.map((e) => (
            <li key={e.id}>
              <Link
                href={`/engagements/${e.id}`}
                className="card group block p-6 transition hover:-translate-y-0.5 hover:shadow-lg"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[13px] text-muted">{e.client_name}</p>
                    <h2 className="mt-0.5 text-xl font-semibold text-ink">{e.app_name}</h2>
                  </div>
                  <StatusBadge status={e.status} />
                </div>
                <div className="mt-4 flex flex-wrap gap-1.5">
                  {e.frameworks.map((f) => (
                    <span key={f.framework_key} className="rounded-full bg-canvas px-2.5 py-0.5 text-xs text-fg">
                      {fwName(f.framework_key)}
                    </span>
                  ))}
                </div>
                <div className="mt-5 flex items-center justify-between text-[13px] text-muted">
                  <span className="flex items-center gap-4">
                    <span className="flex items-center gap-1.5">
                      <FileText className="h-4 w-4 text-brand-6" strokeWidth={1.75} aria-hidden />
                      {e.document_count} documents
                    </span>
                    <span className="flex items-center gap-1.5">
                      <MessagesSquare className="h-4 w-4 text-brand-6" strokeWidth={1.75} aria-hidden />
                      {e.interview_count} interviews
                    </span>
                  </span>
                  <span className="flex items-center gap-1">
                    Updated {formatDate(e.updated_at)}
                    <ChevronRight className="h-4 w-4 transition group-hover:translate-x-0.5" aria-hidden />
                  </span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </main>
  );
}
