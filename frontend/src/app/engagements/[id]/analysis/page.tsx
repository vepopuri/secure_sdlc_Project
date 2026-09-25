"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Circle, Cpu, Loader2, Play, RotateCcw, Sparkles } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";

import { ErrorNote, SectionTitle, Spinner } from "@/components/ui";
import { api, jsonBody } from "@/lib/api";
import { formatDateTime, useCanWrite, useEngagement, useFrameworks } from "@/lib/hooks";
import type { Run } from "@/lib/types";

type DomainState = { id: string; name: string; status: "pending" | "running" | "done" | "error"; error?: string };
type Progress = { frameworkKey: string; runId: string; domains: DomainState[] };

export default function AnalysisPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const canWrite = useCanWrite();
  const eng = useEngagement(id);
  const frameworks = useFrameworks();
  const analyzer = useQuery({
    queryKey: ["analyzer"],
    queryFn: () => api<{ analyzer: "claude" | "heuristic"; model: string | null }>("/api/analyzer"),
  });
  const runs = useQuery({ queryKey: ["runs", id], queryFn: () => api<Run[]>(`/api/engagements/${id}/analysis/runs`) });
  const [selected, setSelected] = useState<string[] | null>(null);
  const [progress, setProgress] = useState<Progress[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const engFrameworks = eng.data?.frameworks.map((f) => f.framework_key) ?? [];
  const chosen = selected ?? engFrameworks.slice(0, 1);
  const fwName = (key: string) => frameworks.data?.find((f) => f.key === key)?.name ?? key;

  function setDomain(runId: string, domainId: string, patch: Partial<DomainState>) {
    setProgress((ps) =>
      ps.map((p) =>
        p.runId === runId ? { ...p, domains: p.domains.map((d) => (d.id === domainId ? { ...d, ...patch } : d)) } : p,
      ),
    );
  }

  async function runDomains(runId: string, domains: DomainState[]) {
    // One request per domain keeps every call within serverless time limits.
    for (const d of domains) {
      if (d.status === "done") continue;
      setDomain(runId, d.id, { status: "running", error: undefined });
      try {
        await api(`/api/engagements/${id}/analysis/runs/${runId}/domains/${encodeURIComponent(d.id)}`, {
          method: "POST",
        });
        setDomain(runId, d.id, { status: "done" });
      } catch (e) {
        setDomain(runId, d.id, { status: "error", error: (e as Error).message });
      }
      qc.invalidateQueries({ queryKey: ["results", id] });
    }
  }

  async function start() {
    setBusy(true);
    setError(null);
    try {
      const created: Progress[] = [];
      for (const key of chosen) {
        const run = await api<Run>(`/api/engagements/${id}/analysis/runs`, {
          method: "POST",
          ...jsonBody({ framework_key: key }),
        });
        created.push({
          frameworkKey: key,
          runId: run.id,
          domains: (run.domains ?? []).map((d) => ({ id: d.id, name: d.name, status: "pending" })),
        });
      }
      setProgress(created);
      for (const p of created) await runDomains(p.runId, p.domains);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
      qc.invalidateQueries({ queryKey: ["runs", id] });
      qc.invalidateQueries({ queryKey: ["engagement", id] });
      qc.invalidateQueries({ queryKey: ["results", id] });
    }
  }

  async function retry(p: Progress) {
    setBusy(true);
    await runDomains(p.runId, p.domains);
    setBusy(false);
    qc.invalidateQueries({ queryKey: ["runs", id] });
  }

  const finished = progress.length > 0 && !busy && progress.every((p) => p.domains.every((d) => d.status === "done"));

  if (!eng.data) return <Spinner />;
  return (
    <div className="space-y-12">
      <section>
        <SectionTitle
          title="Analysis"
          subtitle="Score each framework domain from the evidence. Assessor overrides are never overwritten."
        />
        <div className="card p-6">
          <div className="flex items-start gap-3 rounded-2xl bg-canvas p-4">
            {analyzer.data?.analyzer === "claude" ? (
              <Sparkles className="mt-0.5 h-5 w-5 text-brand-6" aria-hidden />
            ) : (
              <Cpu className="mt-0.5 h-5 w-5 text-brand-6" aria-hidden />
            )}
            <div className="text-sm">
              <p className="font-medium text-ink" data-testid="analyzer-name">
                {analyzer.data?.analyzer === "claude"
                  ? `Claude API · ${analyzer.data.model}`
                  : analyzer.data
                    ? "Keyword heuristic (free fallback)"
                    : "..."}
              </p>
              <p className="mt-0.5 text-muted">
                {analyzer.data?.analyzer === "claude"
                  ? "Evidence is sent once per framework domain in a prompt-cached block and treated as untrusted data. Every citation is verified word for word."
                  : "No ANTHROPIC_API_KEY is configured on the API, so scores come from keyword matching. Configure the key for a full assessment."}
              </p>
            </div>
          </div>

          <h3 className="mt-6 text-[15px] font-semibold text-ink">Frameworks to analyse</h3>
          <p className="mt-0.5 text-sm text-muted">Frameworks you do not analyse are projected from these results.</p>
          <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Frameworks to analyse">
            {engFrameworks.map((key) => {
              const on = chosen.includes(key);
              return (
                <button
                  key={key}
                  type="button"
                  aria-pressed={on}
                  disabled={busy || !canWrite}
                  onClick={() => setSelected(on ? chosen.filter((k) => k !== key) : [...chosen, key])}
                  className={`rounded-full border px-4 py-1.5 text-[13px] font-medium transition ${
                    on ? "border-brand-7 bg-brand-7 text-white" : "border-line bg-white text-fg hover:border-fg"
                  }`}
                >
                  {fwName(key)}
                </button>
              );
            })}
          </div>

          {canWrite && (
            <div className="mt-6 flex flex-wrap items-center gap-3">
              <button type="button" className="pill-brand px-6" disabled={busy || chosen.length === 0} onClick={start}
                data-testid="run-analysis">
                {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Play className="h-4 w-4" aria-hidden />}
                {busy ? "Analysing..." : "Run analysis"}
              </button>
              {eng.data.document_count + eng.data.interview_count === 0 && (
                <span className="text-sm text-muted">
                  Add evidence first on the <Link href={`/engagements/${id}/evidence`} className="text-brand-7 underline">Evidence</Link> tab.
                </span>
              )}
            </div>
          )}
          <div className="mt-4">
            <ErrorNote error={error} />
          </div>

          {progress.map((p) => {
            const done = p.domains.filter((d) => d.status === "done").length;
            const failed = p.domains.some((d) => d.status === "error");
            return (
              <div key={p.runId} className="mt-6">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium text-ink">{fwName(p.frameworkKey)}</span>
                  <span className="text-muted">
                    {done} / {p.domains.length} domains
                  </span>
                </div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-black/5" role="progressbar"
                  aria-valuemin={0} aria-valuemax={p.domains.length} aria-valuenow={done}>
                  <div className="h-full rounded-full bg-brand transition-all" style={{ width: `${(done / p.domains.length) * 100}%` }} />
                </div>
                <ul className="mt-3 grid gap-1.5 sm:grid-cols-2">
                  {p.domains.map((d) => (
                    <li key={d.id} className="flex items-center gap-2 text-[13px]">
                      {d.status === "done" && <CheckCircle2 className="h-4 w-4 text-brand-6" aria-hidden />}
                      {d.status === "running" && <Loader2 className="h-4 w-4 animate-spin text-brand-6" aria-hidden />}
                      {d.status === "pending" && <Circle className="h-4 w-4 text-line" aria-hidden />}
                      {d.status === "error" && <AlertTriangle className="h-4 w-4 text-danger" aria-hidden />}
                      <span className={d.status === "error" ? "text-danger" : "text-fg"}>
                        {d.name}
                        {d.error && ` - ${d.error}`}
                      </span>
                    </li>
                  ))}
                </ul>
                {failed && !busy && (
                  <button type="button" className="pill-secondary mt-3" onClick={() => retry(p)}>
                    <RotateCcw className="h-4 w-4" aria-hidden /> Retry failed domains
                  </button>
                )}
              </div>
            );
          })}
          {finished && (
            <p className="mt-6 text-sm text-brand-7" role="status" data-testid="analysis-complete">
              Analysis complete.{" "}
              <Link href={`/engagements/${id}/results`} className="font-medium underline">
                View results
              </Link>
            </p>
          )}
        </div>
      </section>

      <section>
        <SectionTitle title="Run history" />
        {runs.isLoading && <Spinner />}
        {runs.data?.length === 0 && <p className="text-sm text-muted">No runs yet.</p>}
        {!!runs.data?.length && (
          <div className="card overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-5 py-3 font-medium">Started</th>
                  <th className="px-5 py-3 font-medium">Framework</th>
                  <th className="px-5 py-3 font-medium">Analyzer</th>
                  <th className="px-5 py-3 font-medium">Domains</th>
                  <th className="px-5 py-3 font-medium">Status</th>
                  <th className="px-5 py-3 font-medium">Tokens (cached)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line/70">
                {runs.data.map((r) => (
                  <tr key={r.id}>
                    <td className="px-5 py-3">{formatDateTime(r.created_at)}</td>
                    <td className="px-5 py-3">{fwName(r.framework_key)}</td>
                    <td className="px-5 py-3">{r.analyzer === "claude" ? `Claude (${r.model})` : "Heuristic"}</td>
                    <td className="px-5 py-3">
                      {r.domains_done.length}/{r.domains_total}
                    </td>
                    <td className="px-5 py-3 capitalize">{r.error ? `${r.status} (last error: ${r.error})` : r.status}</td>
                    <td className="px-5 py-3 text-muted">
                      {r.usage.input_tokens
                        ? `${(r.usage.input_tokens + (r.usage.cache_read_input_tokens ?? 0)).toLocaleString()} (${(r.usage.cache_read_input_tokens ?? 0).toLocaleString()})`
                        : "-"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
