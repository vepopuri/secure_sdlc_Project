"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, FileUp, LayoutTemplate, Loader2, Presentation, Trash2 } from "lucide-react";
import { useParams } from "next/navigation";
import { useRef, useState } from "react";

import { ErrorNote, SectionTitle, Spinner } from "@/components/ui";
import { api, download, jsonBody } from "@/lib/api";
import { formatBytes, formatDate, useCanWrite, useEngagement } from "@/lib/hooks";
import type { ReportSummary, Template } from "@/lib/types";
import { MAX_DIRECT_UPLOAD_BYTES } from "@/lib/uploads";

const TEXT_TOKENS = [
  "client_name", "app_name", "scope", "date", "executive_summary", "frameworks", "overall_maturity",
  "document_count", "interview_count",
];
const BLOCK_TOKENS = [
  ["{{chart:<framework>}}", "Radar chart, current vs target per domain"],
  ["{{table:scores:<framework>}}", "Practice score table"],
  ["{{table:gaps}}", "Key gaps across frameworks"],
  ["{{table:roadmap}}", "30/60/90-day roadmap"],
];

export default function ReportPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const canWrite = useCanWrite();
  const eng = useEngagement(id);
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);

  const summary = useQuery({
    queryKey: ["report-summary", id],
    queryFn: () => api<ReportSummary>(`/api/engagements/${id}/report/summary`),
  });
  const templates = useQuery({ queryKey: ["templates"], queryFn: () => api<Template[]>("/api/templates") });
  const config = useQuery({
    queryKey: ["config"],
    queryFn: () => fetch("/api/config").then((r) => r.json() as Promise<{ blobEnabled: boolean }>),
    staleTime: Infinity,
  });

  const removeTpl = useMutation({
    mutationFn: (tid: string) => api(`/api/templates/${tid}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["templates"] }),
  });

  async function run(key: string, fn: () => Promise<void>) {
    setBusy(key);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(null);
    }
  }

  const name = eng.data ? `${eng.data.client_name}-${eng.data.app_name}.pptx` : "report.pptx";

  async function uploadTemplate(file: File) {
    if (!file.name.toLowerCase().endsWith(".pptx")) throw new Error("Templates must be .pptx files");
    if (file.size <= MAX_DIRECT_UPLOAD_BYTES) {
      const form = new FormData();
      form.append("file", file);
      await api("/api/templates", { method: "POST", body: form });
    } else {
      if (!config.data?.blobEnabled) throw new Error("Templates over 4 MB need Vercel Blob");
      const { upload } = await import("@vercel/blob/client");
      const blob = await upload(`templates/${file.name}`, file, { access: "public", handleUploadUrl: "/api/blob/upload" });
      try {
        await api("/api/templates/from-blob", { method: "POST", ...jsonBody({ url: blob.url, filename: file.name }) });
      } finally {
        await fetch("/api/blob/delete", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: blob.url }),
        }).catch(() => undefined);
      }
    }
    await qc.invalidateQueries({ queryKey: ["templates"] });
  }

  return (
    <div className="space-y-12">
      <section>
        <SectionTitle title="Report" subtitle="Download the built-in deck, or fill your own PowerPoint template." />
        <ErrorNote error={error} />
        <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
          <div className="card flex flex-col justify-between bg-ink p-8 text-white">
            <div>
              <Presentation className="h-9 w-9 text-brand" strokeWidth={1.5} aria-hidden />
              <h3 className="mt-5 text-3xl font-semibold tracking-tight">
                Default deck<span className="text-brand">.</span>
              </h3>
              <p className="mt-2 max-w-md text-white/70">
                Title, executive summary, scope and method, per-framework charts and score tables, key gaps,
                30/60/90-day roadmap and evidence appendix.
              </p>
            </div>
            <button type="button" className="pill mt-8 self-start bg-brand px-6 py-2.5 text-ink hover:bg-white"
              data-testid="download-report" disabled={busy !== null}
              onClick={() => run("default", () => download(`/api/engagements/${id}/report`, name))}>
              {busy === "default" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Download className="h-4 w-4" aria-hidden />}
              Download PowerPoint
            </button>
          </div>
          <div className="card p-6">
            <h3 className="text-[17px] font-semibold text-ink">Executive summary</h3>
            {summary.isLoading && <Spinner />}
            <p className="mt-2 text-sm leading-relaxed text-fg" data-testid="executive-summary">
              {summary.data?.executive_summary}
            </p>
            <p className="mt-4 text-xs text-muted">{summary.data?.overall}</p>
          </div>
        </div>
      </section>

      <section>
        <SectionTitle
          title="Client templates"
          subtitle="Upload a .pptx containing tokens. Text tokens are replaced in place; a text box containing only a block token becomes a chart or table at the same position and size."
          action={
            <div className="flex gap-2">
              <button type="button" className="pill-secondary" disabled={busy !== null}
                onClick={() => run("sample", () => download("/api/templates/sample", "ssdlc-sample-template.pptx"))}>
                <LayoutTemplate className="h-4 w-4 text-brand-6" aria-hidden /> Sample template
              </button>
              {canWrite && (
                <>
                  <input ref={input} type="file" accept=".pptx" className="sr-only" data-testid="template-input"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      e.target.value = "";
                      if (f) void run("upload", () => uploadTemplate(f));
                    }} />
                  <button type="button" className="pill-primary" disabled={busy !== null} onClick={() => input.current?.click()}>
                    {busy === "upload" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <FileUp className="h-4 w-4" aria-hidden />}
                    Upload template
                  </button>
                </>
              )}
            </div>
          }
        />
        {templates.data?.length === 0 && <p className="text-sm text-muted">No templates uploaded yet.</p>}
        <ul className="grid gap-3 md:grid-cols-2">
          {templates.data?.map((t) => (
            <li key={t.id} className="card p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-[15px] font-medium text-ink">{t.name}</p>
                  <p className="text-xs text-muted">
                    {formatBytes(t.size_bytes)} · {formatDate(t.created_at)} · {t.tokens.length} tokens
                  </p>
                </div>
                {canWrite && (
                  <button type="button" className="pill-ghost px-3 text-danger hover:bg-red-50" aria-label={`Delete ${t.name}`}
                    onClick={() => window.confirm(`Delete template ${t.name}?`) && removeTpl.mutate(t.id)}>
                    <Trash2 className="h-4 w-4" aria-hidden />
                  </button>
                )}
              </div>
              <div className="mt-3 flex flex-wrap gap-1">
                {t.tokens.map((tok) => (
                  <code key={tok} className="rounded-md bg-canvas px-1.5 py-0.5 text-[11px] text-fg">{`{{${tok}}}`}</code>
                ))}
              </div>
              <button type="button" className="pill-brand mt-4" disabled={busy !== null}
                onClick={() => run(t.id, () => download(`/api/engagements/${id}/report?template_id=${t.id}`, name))}>
                {busy === t.id ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Download className="h-4 w-4" aria-hidden />}
                Fill and download
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        <div className="card p-6">
          <h3 className="text-[15px] font-semibold text-ink">Text tokens</h3>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {TEXT_TOKENS.map((t) => (
              <code key={t} className="rounded-md bg-canvas px-2 py-1 text-xs">{`{{${t}}}`}</code>
            ))}
          </div>
        </div>
        <div className="card p-6">
          <h3 className="text-[15px] font-semibold text-ink">Block tokens</h3>
          <ul className="mt-3 space-y-1.5 text-sm">
            {BLOCK_TOKENS.map(([t, d]) => (
              <li key={t}>
                <code className="rounded-md bg-canvas px-2 py-1 text-xs">{t}</code>
                <span className="ml-2 text-muted">{d}</span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-muted">
            &lt;framework&gt; accepts a key or name, e.g. samm, nist_ssdf, SSDF, asvs, nist_csf, bsimm, slsa, iso_27034.
          </p>
        </div>
      </section>

      {summary.data && summary.data.roadmap.length > 0 && (
        <section>
          <SectionTitle title="Roadmap preview" />
          <div className="grid gap-4 md:grid-cols-3">
            {[30, 60, 90].map((h, i) => (
              <div key={h} className="card overflow-hidden">
                <div className={`px-5 py-3 text-sm font-semibold text-white ${["bg-brand-6", "bg-brand-7", "bg-ink"][i]}`}>
                  Next {h} days
                </div>
                <ul className="space-y-2 p-5 text-sm">
                  {summary.data.roadmap.filter((r) => r.horizon === h).slice(0, 8).map((r) => (
                    <li key={r.text}>
                      <span className="text-fg">{r.text}</span>
                      <span className="block text-xs text-muted">{r.priority} · {r.practices.slice(0, 3).join(", ")}</span>
                    </li>
                  ))}
                  {summary.data.roadmap.filter((r) => r.horizon === h).length === 0 && (
                    <li className="text-muted">No actions.</li>
                  )}
                </ul>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
