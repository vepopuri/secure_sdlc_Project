"use client";

import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { BarChart3, Info } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";

import Heatmap from "@/components/Heatmap";
import MaturityRadar from "@/components/MaturityRadar";
import PracticeCard from "@/components/PracticeCard";
import { EmptyState, ErrorNote, SectionTitle, Spinner } from "@/components/ui";
import { api } from "@/lib/api";
import { useCanWrite, useEngagement, useFrameworks } from "@/lib/hooks";
import type { Results } from "@/lib/types";

export default function ResultsPage() {
  return (
    <Suspense fallback={<Spinner />}>
      <ResultsView />
    </Suspense>
  );
}

function ResultsView() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const search = useSearchParams();
  const eng = useEngagement(id);
  const frameworks = useFrameworks();
  const canWrite = useCanWrite();
  const [openId, setOpenId] = useState<string | null>(null);

  const engKeys = eng.data?.frameworks.map((f) => f.framework_key) ?? [];
  const otherKeys = (frameworks.data ?? []).map((f) => f.key).filter((k) => !engKeys.includes(k));
  const active = search.get("fw") ?? engKeys[0];

  const results = useQuery({
    queryKey: ["results", id, active],
    queryFn: () => api<Results>(`/api/engagements/${id}/results/${active}`),
    enabled: Boolean(active),
    placeholderData: keepPreviousData,
  });

  // Prefetch the other selected frameworks so toggling is instant.
  const qc = useQueryClient();
  const engKeyList = engKeys.join(",");
  useEffect(() => {
    for (const key of engKeyList.split(",").filter(Boolean)) {
      void qc.prefetchQuery({
        queryKey: ["results", id, key],
        queryFn: () => api<Results>(`/api/engagements/${id}/results/${key}`),
      });
    }
  }, [qc, id, engKeyList]);

  const selectFramework = (key: string) => {
    setOpenId(null);
    router.replace(`/engagements/${id}/results?fw=${key}`, { scroll: false });
  };
  const fw = (key: string) => frameworks.data?.find((f) => f.key === key);

  function selectPractice(pid: string) {
    setOpenId(pid);
    requestAnimationFrame(() =>
      document.getElementById(`practice-${pid}`)?.scrollIntoView({ behavior: "smooth", block: "start" }),
    );
  }

  if (!eng.data || !frameworks.data) return <Spinner />;
  const r = results.data;
  const counts = r
    ? {
        assessed: r.practices.filter((p) => p.status === "assessed").length,
        projected: r.practices.filter((p) => p.status === "projected").length,
        overridden: r.practices.filter((p) => p.status === "overridden").length,
      }
    : null;

  return (
    <div className="space-y-10">
      <SectionTitle title="Results" subtitle="Toggle between frameworks. Frameworks you did not analyse are projected." />

      <div className="space-y-3">
        <div role="tablist" aria-label="Framework" className="flex flex-wrap gap-2">
          {engKeys.map((key) => (
            <button key={key} type="button" role="tab" aria-selected={key === active} onClick={() => selectFramework(key)}
              data-testid={`toggle-${key}`}
              className={`rounded-full px-5 py-2 text-sm font-medium transition ${
                key === active ? "bg-ink text-white" : "bg-white text-fg shadow-sm hover:bg-black/5"
              }`}>
              {fw(key)?.short_name ?? key}
            </button>
          ))}
        </div>
        {otherKeys.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 text-[13px] text-muted">
            <span>Also view:</span>
            {otherKeys.map((key) => (
              <button key={key} type="button" onClick={() => selectFramework(key)} data-testid={`toggle-${key}`}
                className={`rounded-full px-3 py-1 transition ${key === active ? "bg-ink text-white" : "hover:bg-black/5"}`}>
                {fw(key)?.short_name ?? key}
              </button>
            ))}
          </div>
        )}
      </div>

      <ErrorNote error={results.error} />
      {results.isLoading && <Spinner />}
      {r && r.analyzed_frameworks.length === 0 && (
        <EmptyState icon={<BarChart3 className="h-10 w-10" strokeWidth={1.25} />} title="No analysis yet">
          Run an analysis on the{" "}
          <Link href={`/engagements/${id}/analysis`} className="text-brand-7 underline">Analysis</Link> tab to see scores.
        </EmptyState>
      )}

      {r && r.analyzed_frameworks.length > 0 && (
        <div className={`space-y-10 transition-opacity ${results.isFetching ? "opacity-70" : ""}`} data-testid="results">
          {r.is_projected && (
            <p className="flex items-start gap-2 rounded-2xl bg-white px-4 py-3 text-sm text-muted shadow-sm">
              <Info className="mt-0.5 h-4 w-4 shrink-0 text-brand-6" aria-hidden />
              Projected from {r.analyzed_frameworks.map((k) => fw(k)?.short_name ?? k).join(", ")} through the shared
              capability taxonomy. Run an analysis on {r.framework.short_name} for evidence-based scores.
            </p>
          )}

          <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
            <div className="card p-5">
              <p className="text-[13px] text-muted">Overall maturity</p>
              <p className="mt-1 text-4xl font-semibold tracking-tight text-ink" data-testid="overall-score">
                {r.overall === null ? "–" : r.overall.toFixed(1)}
                <span className="text-lg font-normal text-muted"> / {r.framework.scale.max}</span>
              </p>
            </div>
            <div className="card p-5">
              <p className="text-[13px] text-muted">Target</p>
              <p className="mt-1 text-4xl font-semibold tracking-tight text-ink">{r.target}</p>
            </div>
            <div className="card p-5">
              <p className="text-[13px] text-muted">Practices</p>
              <p className="mt-1 text-4xl font-semibold tracking-tight text-ink">{r.practices.length}</p>
              <p className="text-xs text-muted">
                {counts?.assessed} assessed · {counts?.projected} projected · {counts?.overridden} overridden
              </p>
            </div>
            <div className="card p-5">
              <p className="text-[13px] text-muted">Below target</p>
              <p className="mt-1 text-4xl font-semibold tracking-tight text-ink">
                {r.practices.filter((p) => p.score !== null && p.score < p.target).length}
              </p>
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
            <div className="card p-6">
              <h3 className="text-[17px] font-semibold text-ink">Current vs target by domain</h3>
              <MaturityRadar results={r} />
            </div>
            <div className="card p-6">
              <h3 className="text-[17px] font-semibold text-ink">Domain scores</h3>
              <table className="mt-4 w-full text-sm">
                <thead className="text-left text-xs uppercase tracking-wide text-muted">
                  <tr>
                    <th className="py-2 font-medium">Domain</th>
                    <th className="py-2 text-right font-medium">Current</th>
                    <th className="py-2 text-right font-medium">Target</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line/70">
                  {r.domains.map((d) => (
                    <tr key={d.id}>
                      <td className="py-2.5 text-fg">{d.name}</td>
                      <td className="py-2.5 text-right font-medium tabular-nums">{d.current?.toFixed(1) ?? "–"}</td>
                      <td className="py-2.5 text-right tabular-nums text-muted">{d.target}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card p-6">
            <h3 className="mb-5 text-[17px] font-semibold text-ink">Practice heatmap</h3>
            <Heatmap results={r} onSelect={selectPractice} />
          </div>

          <div>
            <h3 className="mb-4 text-xl font-semibold text-ink">Practices</h3>
            {r.domains.map((d) => (
              <div key={d.id} className="mb-8">
                <p className="eyebrow mb-3">{d.name}</p>
                <div className="space-y-2">
                  {r.practices
                    .filter((p) => p.domain_id === d.id)
                    .map((p) => (
                      <PracticeCard
                        key={`${r.framework.key}-${p.id}-${p.override?.at ?? ""}`}
                        practice={p}
                        scale={r.framework.scale}
                        engagementId={id}
                        frameworkKey={r.framework.key}
                        canWrite={canWrite}
                        open={openId === p.id}
                        onToggle={() => setOpenId(openId === p.id ? null : p.id)}
                      />
                    ))}
                </div>
              </div>
            ))}
          </div>
          {r.framework.license_note && <p className="text-xs text-muted">{r.framework.license_note}</p>}
        </div>
      )}
    </div>
  );
}
