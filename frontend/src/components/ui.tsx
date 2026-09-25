"use client";

import { Loader2 } from "lucide-react";
import type { ReactNode } from "react";

import { STATUS_LABEL } from "@/lib/hooks";

export function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    draft: "bg-black/5 text-fg",
    in_progress: "bg-brand-50 text-brand-7",
    review: "bg-amber-50 text-amber-800",
    final: "bg-brand-7 text-white",
  };
  return (
    <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${styles[status] ?? styles.draft}`}>
      {STATUS_LABEL[status] ?? status}
    </span>
  );
}

export function Spinner({ label = "Loading" }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 py-10 text-sm text-muted" role="status">
      <Loader2 className="h-4 w-4 animate-spin text-brand-6" aria-hidden />
      {label}...
    </div>
  );
}

export function ErrorNote({ error }: { error: unknown }) {
  if (!error) return null;
  return (
    <p role="alert" className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-danger">
      {error instanceof Error ? error.message : String(error)}
    </p>
  );
}

export function EmptyState({ icon, title, children }: { icon: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="card flex flex-col items-center px-6 py-14 text-center">
      <div className="text-brand-6">{icon}</div>
      <h3 className="mt-4 text-lg font-semibold text-ink">{title}</h3>
      {children && <div className="mt-2 max-w-md text-[15px] text-muted">{children}</div>}
    </div>
  );
}

export function SectionTitle({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight text-ink">{title}</h2>
        {subtitle && <p className="mt-1 text-[15px] text-muted">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
  disabled,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex flex-wrap gap-1 rounded-full bg-black/5 p-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          disabled={disabled}
          onClick={() => onChange(o.value)}
          className={`rounded-full px-4 py-1.5 text-[13px] font-medium transition ${
            value === o.value ? "bg-white text-ink shadow-sm" : "text-muted hover:text-ink"
          } disabled:cursor-not-allowed`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
