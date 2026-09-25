"use client";

import { useQuery } from "@tanstack/react-query";
import { History } from "lucide-react";
import { useParams } from "next/navigation";

import { EmptyState, ErrorNote, SectionTitle, Spinner } from "@/components/ui";
import { api } from "@/lib/api";
import { formatDateTime } from "@/lib/hooks";
import type { AuditEntry } from "@/lib/types";

const LABELS: Record<string, string> = {
  "engagement.create": "Created the engagement",
  "engagement.update": "Updated engagement details",
  "engagement.status": "Changed status",
  "engagement.delete": "Deleted the engagement",
  "evidence.upload": "Uploaded a document",
  "evidence.interview.create": "Added interview notes",
  "evidence.interview.update": "Edited interview notes",
  "evidence.delete": "Deleted evidence",
  "analysis.start": "Started an analysis",
  "analysis.complete": "Completed an analysis",
  "score.override": "Overrode a score",
  "score.override.clear": "Removed a score override",
  "report.download": "Downloaded the report",
};

function describe(e: AuditEntry): string {
  const d = e.details as Record<string, unknown>;
  switch (e.action) {
    case "evidence.upload":
      return String(d.filename ?? "");
    case "evidence.interview.create":
    case "evidence.interview.update":
    case "evidence.delete":
      return String(d.title ?? "");
    case "analysis.start":
    case "analysis.complete":
      return `${d.framework} · ${d.analyzer}${d.model ? ` (${d.model})` : ""}`;
    case "score.override":
      return `${d.framework} ${d.practice}: ${d.machine_score ?? "–"} → ${d.score}. "${d.reason}"`;
    case "score.override.clear":
      return `${d.framework} ${d.practice}`;
    case "engagement.status": {
      const s = d.status as { from: string; to: string } | undefined;
      return s ? `${s.from} → ${s.to}` : "";
    }
    default:
      return "";
  }
}

export default function ActivityPage() {
  const { id } = useParams<{ id: string }>();
  const q = useQuery({
    queryKey: ["audit", id],
    queryFn: () => api<AuditEntry[]>(`/api/audit?engagement_id=${id}&limit=200`),
  });
  return (
    <div>
      <SectionTitle title="Activity" subtitle="Every change to this engagement is recorded in the audit log." />
      {q.isLoading && <Spinner />}
      <ErrorNote error={q.error} />
      {q.data?.length === 0 && <EmptyState icon={<History className="h-10 w-10" strokeWidth={1.25} />} title="No activity yet" />}
      {!!q.data?.length && (
        <ol className="card divide-y divide-line/70" data-testid="audit-log">
          {q.data.map((e) => (
            <li key={e.id} className="flex flex-wrap items-baseline justify-between gap-2 px-5 py-3.5 text-sm">
              <span className="min-w-0">
                <span className="font-medium text-ink">{LABELS[e.action] ?? e.action}</span>
                {describe(e) && <span className="ml-2 text-muted">{describe(e)}</span>}
              </span>
              <span className="text-xs text-muted">
                {e.user_email} · {formatDateTime(e.created_at)}
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
