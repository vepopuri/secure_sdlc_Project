"use client";

import { Check } from "lucide-react";
import { useState, type FormEvent } from "react";

import { useFrameworks } from "@/lib/hooks";
import type { Engagement, EngagementStatus } from "@/lib/types";

import { Segmented } from "./ui";

export interface EngagementFormValues {
  client_name: string;
  app_name: string;
  business_unit: string;
  scope: string;
  status: EngagementStatus;
  frameworks: { key: string; target: number }[];
}

const STATUSES: { value: EngagementStatus; label: string }[] = [
  { value: "draft", label: "Draft" },
  { value: "in_progress", label: "In progress" },
  { value: "review", label: "Review" },
  { value: "final", label: "Final" },
];

export default function EngagementForm({
  initial,
  submitLabel,
  onSubmit,
  busy,
  readOnly = false,
}: {
  initial?: Engagement;
  submitLabel: string;
  onSubmit: (v: EngagementFormValues) => void;
  busy?: boolean;
  readOnly?: boolean;
}) {
  const frameworks = useFrameworks();
  const [v, setV] = useState<EngagementFormValues>(() => ({
    client_name: initial?.client_name ?? "",
    app_name: initial?.app_name ?? "",
    business_unit: initial?.business_unit ?? "",
    scope: initial?.scope ?? "",
    status: initial?.status ?? "draft",
    frameworks: initial?.frameworks.map((f) => ({ key: f.framework_key, target: f.target_level })) ?? [],
  }));
  const [error, setError] = useState<string | null>(null);

  const selected = (key: string) => v.frameworks.find((f) => f.key === key);
  const toggle = (key: string, defaultTarget: number) =>
    setV((s) => ({
      ...s,
      frameworks: selected(key) ? s.frameworks.filter((f) => f.key !== key) : [...s.frameworks, { key, target: defaultTarget }],
    }));

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!v.frameworks.length) {
      setError("Select at least one framework.");
      return;
    }
    setError(null);
    onSubmit(v);
  }

  return (
    <form onSubmit={submit} className="space-y-8">
      <fieldset disabled={readOnly || busy} className="card grid gap-5 p-6 sm:grid-cols-2">
        <legend className="sr-only">Engagement details</legend>
        <div>
          <label className="label" htmlFor="client_name">Client name</label>
          <input id="client_name" className="input" required maxLength={200} value={v.client_name}
            onChange={(e) => setV({ ...v, client_name: e.target.value })} />
        </div>
        <div>
          <label className="label" htmlFor="app_name">Application</label>
          <input id="app_name" className="input" required maxLength={200} value={v.app_name}
            onChange={(e) => setV({ ...v, app_name: e.target.value })} />
        </div>
        <div>
          <label className="label" htmlFor="business_unit">Business unit (optional)</label>
          <input id="business_unit" className="input" maxLength={200} value={v.business_unit}
            onChange={(e) => setV({ ...v, business_unit: e.target.value })} />
        </div>
        <div>
          <span className="label">Status</span>
          <Segmented label="Status" options={STATUSES} value={v.status} disabled={readOnly || busy}
            onChange={(status) => setV({ ...v, status })} />
        </div>
        <div className="sm:col-span-2">
          <label className="label" htmlFor="scope">Scope</label>
          <textarea id="scope" className="input min-h-28" maxLength={10000} value={v.scope}
            placeholder="Systems, teams and SDLC phases in scope"
            onChange={(e) => setV({ ...v, scope: e.target.value })} />
        </div>
      </fieldset>

      <div>
        <h2 className="text-xl font-semibold text-ink">Frameworks</h2>
        <p className="mt-1 text-[15px] text-muted">
          Pick one or more. Analyse any of them; the others are projected through the shared capability taxonomy.
        </p>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {frameworks.data?.map((fw) => {
            const sel = selected(fw.key);
            return (
              <div key={fw.key} className={`card p-5 transition ${sel ? "ring-2 ring-brand-6" : ""}`}>
                <button type="button" disabled={readOnly || busy} onClick={() => toggle(fw.key, fw.scale.default_target ?? fw.scale.max)}
                  aria-pressed={Boolean(sel)} data-testid={`fw-${fw.key}`}
                  className="flex w-full items-start justify-between gap-3 text-left disabled:cursor-not-allowed">
                  <span>
                    <span className="block text-[15px] font-semibold text-ink">{fw.name}</span>
                    <span className="mt-0.5 block text-[13px] text-muted">
                      {fw.version} · {fw.domain_count} domains · {fw.practice_count} practices
                    </span>
                  </span>
                  <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border ${
                    sel ? "border-brand-7 bg-brand-7 text-white" : "border-line"}`}>
                    {sel && <Check className="h-4 w-4" aria-hidden />}
                  </span>
                </button>
                {sel && (
                  <label className="mt-4 flex items-center gap-3 text-[13px] text-muted">
                    Target level
                    <input type="range" min={fw.scale.min} max={fw.scale.max} step={fw.scale.step}
                      value={sel.target} disabled={readOnly || busy}
                      onChange={(e) => setV((s) => ({ ...s, frameworks: s.frameworks.map((f) =>
                        f.key === fw.key ? { ...f, target: Number(e.target.value) } : f) }))}
                      className="flex-1 accent-[#046A38]" aria-label={`${fw.short_name} target level`} />
                    <span className="w-10 text-right font-medium text-ink">{sel.target}</span>
                  </label>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      {!readOnly && (
        <button type="submit" className="pill-brand px-7 py-2.5" disabled={busy}>
          {busy ? "Saving..." : submitLabel}
        </button>
      )}
    </form>
  );
}
