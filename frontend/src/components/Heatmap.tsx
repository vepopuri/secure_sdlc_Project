"use client";

import { HEAT_LEGEND, NOT_ASSESSED, heat } from "@/lib/colors";
import type { Results } from "@/lib/types";

export default function Heatmap({ results, onSelect }: { results: Results; onSelect: (practiceId: string) => void }) {
  const { min, max } = results.framework.scale;
  const byId = new Map(results.practices.map((p) => [p.id, p]));
  return (
    <div data-testid="heatmap">
      <div className="space-y-3">
        {results.domains.map((d) => (
          <div key={d.id} className="grid gap-2 sm:grid-cols-[180px_1fr] sm:items-start">
            <div className="pt-2 text-[13px] font-medium text-ink">{d.name}</div>
            <div className="flex flex-wrap gap-1.5">
              {d.practice_ids.map((pid) => {
                const p = byId.get(pid);
                if (!p) return null;
                const c = heat(p.score, min, max);
                const label = `${p.id} ${p.name}: ${p.score === null ? "not assessed" : p.score.toFixed(1)}${
                  p.status === "projected" ? " (projected)" : p.status === "overridden" ? " (override)" : ""
                }`;
                return (
                  <button
                    key={pid}
                    type="button"
                    title={label}
                    aria-label={label}
                    onClick={() => onSelect(pid)}
                    style={{ backgroundColor: c.bg, color: c.fg }}
                    className={`flex h-14 w-[92px] flex-col items-start justify-between rounded-xl px-2.5 py-1.5 text-left transition hover:ring-2 hover:ring-ink/60 ${
                      p.status === "projected" ? "outline-2 -outline-offset-4 outline-dashed outline-white/70" : ""
                    }`}
                  >
                    <span className="max-w-full truncate text-[11px] font-medium opacity-90">{p.id}</span>
                    <span className="text-[15px] font-semibold tabular-nums">
                      {p.score === null ? "–" : p.score.toFixed(1)}
                      {p.status === "overridden" && <span className="ml-1 text-[10px] font-medium">edited</span>}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted">
        <span className="flex items-center gap-1">
          {min}
          {HEAT_LEGEND.map((s) => (
            <span key={s.at} className="h-3 w-6 first:rounded-l-full last:rounded-r-full" style={{ backgroundColor: s.bg }} />
          ))}
          {max}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-3 w-4 rounded" style={{ backgroundColor: NOT_ASSESSED.bg }} /> not assessed
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-3 w-4 rounded border border-dashed border-muted" /> projected
        </span>
      </div>
    </div>
  );
}
