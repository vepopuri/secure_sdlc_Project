"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, Lightbulb, PencilLine, Quote, TriangleAlert } from "lucide-react";
import { useState, type FormEvent } from "react";

import { api, jsonBody } from "@/lib/api";
import { heat } from "@/lib/colors";
import type { PracticeResult, Scale } from "@/lib/types";

import { ErrorNote } from "./ui";

const STATUS_TEXT: Record<string, string> = {
  assessed: "Assessed",
  projected: "Projected",
  overridden: "Override",
  not_assessed: "Not assessed",
};

export default function PracticeCard({
  practice: p,
  scale,
  engagementId,
  frameworkKey,
  canWrite,
  open,
  onToggle,
}: {
  practice: PracticeResult;
  scale: Scale;
  engagementId: string;
  frameworkKey: string;
  canWrite: boolean;
  open: boolean;
  onToggle: () => void;
}) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [score, setScore] = useState<number>(p.override?.score ?? p.score ?? scale.min);
  const [reason, setReason] = useState(p.override?.reason ?? "");
  const url = `/api/engagements/${engagementId}/overrides/${frameworkKey}/${encodeURIComponent(p.id)}`;
  const done = () => {
    setEditing(false);
    qc.invalidateQueries({ queryKey: ["results", engagementId] });
  };
  const save = useMutation({ mutationFn: () => api(url, { method: "PUT", ...jsonBody({ score, reason }) }), onSuccess: done });
  const clear = useMutation({ mutationFn: () => api(url, { method: "DELETE" }), onSuccess: done });
  const c = heat(p.score, scale.min, scale.max);

  function submit(e: FormEvent) {
    e.preventDefault();
    save.mutate();
  }

  return (
    <article id={`practice-${p.id}`} className="card scroll-mt-32 overflow-hidden" data-testid={`practice-${p.id}`}>
      <button type="button" onClick={onToggle} aria-expanded={open}
        className="flex w-full items-center gap-4 px-5 py-4 text-left hover:bg-black/[0.02]">
        <span style={{ backgroundColor: c.bg, color: c.fg }}
          className="flex h-11 w-14 shrink-0 items-center justify-center rounded-xl text-[15px] font-semibold tabular-nums">
          {p.score === null ? "–" : p.score.toFixed(1)}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15px] font-medium text-ink">
            <span className="text-muted">{p.id}</span> {p.name}
          </span>
          <span className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-muted">
            <span className={p.status === "overridden" ? "font-medium text-brand-7" : ""}>{STATUS_TEXT[p.status]}</span>
            <span>Target {p.target}</span>
            {p.status !== "not_assessed" && <span>Confidence {Math.round(p.confidence * 100)}%</span>}
            {p.citations.length > 0 && <span>{p.citations.length} citations</span>}
          </span>
        </span>
        <ChevronDown className={`h-5 w-5 shrink-0 text-muted transition ${open ? "rotate-180" : ""}`} aria-hidden />
      </button>

      {open && (
        <div className="space-y-6 border-t border-line/70 px-5 py-5 text-sm">
          <p className="text-muted">{p.description}</p>
          {p.override && (
            <div className="rounded-2xl bg-brand-50 p-4">
              <p className="font-medium text-brand-7">
                Assessor override: {p.override.score} (analyzer: {p.machine_score ?? "n/a"})
              </p>
              <p className="mt-1 text-fg">{p.override.reason}</p>
              <p className="mt-1 text-xs text-muted">{p.override.by}</p>
            </div>
          )}
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wide text-muted">Rationale</h4>
            <p className="mt-1.5 leading-relaxed text-fg">{p.rationale}</p>
          </div>
          {p.citations.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wide text-muted">Evidence</h4>
              <ul className="mt-2 space-y-2">
                {p.citations.map((ct, i) => (
                  <li key={i} className="flex gap-2 rounded-xl bg-canvas p-3">
                    <Quote className="mt-0.5 h-4 w-4 shrink-0 text-brand-6" aria-hidden />
                    <span>
                      <span className="text-fg">&ldquo;{ct.quote}&rdquo;</span>
                      <span className="mt-0.5 block text-xs text-muted">
                        {ct.document_title}
                        {ct.heading && ` · ${ct.heading}`}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="grid gap-6 md:grid-cols-2">
            {p.gaps.length > 0 && (
              <div>
                <h4 className="text-xs font-semibold uppercase tracking-wide text-muted">Gaps</h4>
                <ul className="mt-2 space-y-1.5">
                  {p.gaps.map((g, i) => (
                    <li key={i} className="flex gap-2 text-fg">
                      <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-warn" aria-hidden />
                      {g}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {p.recommendations.length > 0 && (
              <div>
                <h4 className="text-xs font-semibold uppercase tracking-wide text-muted">Recommendations</h4>
                <ul className="mt-2 space-y-1.5">
                  {p.recommendations.map((r, i) => (
                    <li key={i} className="flex gap-2 text-fg">
                      <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-brand-6" aria-hidden />
                      <span>
                        {r.text}
                        <span className="ml-1.5 whitespace-nowrap text-xs text-muted">
                          {r.priority} · {r.horizon} days
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
          {Object.keys(p.levels).length > 0 && (
            <details className="rounded-xl bg-canvas p-3">
              <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-muted">Level criteria</summary>
              <ul className="mt-2 space-y-1">
                {Object.entries(p.levels).map(([lvl, text]) => (
                  <li key={lvl}>
                    <span className="font-medium">Level {lvl}:</span> {text}
                  </li>
                ))}
              </ul>
            </details>
          )}

          {canWrite && !editing && (
            <button type="button" className="pill-secondary" onClick={() => setEditing(true)} data-testid="override-button">
              <PencilLine className="h-4 w-4 text-brand-6" aria-hidden /> {p.override ? "Edit override" : "Override score"}
            </button>
          )}
          {canWrite && editing && (
            <form onSubmit={submit} className="space-y-3 rounded-2xl border border-line p-4" aria-label="Override score">
              <div className="flex flex-wrap items-center gap-3">
                <label htmlFor={`score-${p.id}`} className="text-[13px] font-medium text-muted">Score</label>
                <input id={`score-${p.id}`} type="number" className="input w-28" min={scale.min} max={scale.max}
                  step={scale.step} value={score} required onChange={(e) => setScore(Number(e.target.value))} />
                <span className="text-xs text-muted">
                  {scale.min}–{scale.max}
                  {scale.labels[String(Math.round(score))] && ` · ${scale.labels[String(Math.round(score))]}`}
                </span>
              </div>
              <div>
                <label htmlFor={`reason-${p.id}`} className="label">Reason (required, recorded in the audit log)</label>
                <textarea id={`reason-${p.id}`} className="input min-h-20" required minLength={3} maxLength={4000}
                  value={reason} onChange={(e) => setReason(e.target.value)} />
              </div>
              <ErrorNote error={save.error || clear.error} />
              <div className="flex flex-wrap gap-2">
                <button type="submit" className="pill-brand" disabled={save.isPending}>Save override</button>
                <button type="button" className="pill-secondary" onClick={() => setEditing(false)}>Cancel</button>
                {p.override && (
                  <button type="button" className="pill-ghost text-danger hover:bg-red-50" onClick={() => clear.mutate()}>
                    Remove override
                  </button>
                )}
              </div>
            </form>
          )}
        </div>
      )}
    </article>
  );
}
