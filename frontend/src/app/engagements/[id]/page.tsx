"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";

import EngagementForm, { type EngagementFormValues } from "@/components/EngagementForm";
import { ErrorNote, SectionTitle, Spinner } from "@/components/ui";
import { api, jsonBody } from "@/lib/api";
import { useCanWrite, useEngagement, useMe } from "@/lib/hooks";
import type { Engagement } from "@/lib/types";

export default function OverviewPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const eng = useEngagement(id);
  const me = useMe();
  const canWrite = useCanWrite();
  const [saved, setSaved] = useState(false);

  const save = useMutation({
    mutationFn: (v: EngagementFormValues) =>
      api<Engagement>(`/api/engagements/${id}`, { method: "PATCH", ...jsonBody(v) }),
    onSuccess: (data) => {
      qc.setQueryData(["engagement", id], data);
      qc.invalidateQueries({ queryKey: ["engagements"] });
      qc.invalidateQueries({ queryKey: ["results", id] });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    },
  });
  const remove = useMutation({
    mutationFn: () => api(`/api/engagements/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["engagements"] });
      router.push("/");
    },
  });

  if (!eng.data) return <Spinner />;
  return (
    <div>
      <SectionTitle
        title="Overview"
        subtitle="Engagement details, status, frameworks and target maturity."
        action={saved ? <span className="text-sm text-brand-7" role="status">Saved</span> : undefined}
      />
      <ErrorNote error={save.error} />
      <EngagementForm
        key={eng.data.updated_at}
        initial={eng.data}
        submitLabel="Save changes"
        busy={save.isPending}
        readOnly={!canWrite}
        onSubmit={(v) => save.mutate(v)}
      />
      {me.data?.role === "admin" && (
        <div className="mt-16 border-t border-line pt-8">
          <h3 className="text-[15px] font-semibold text-ink">Delete engagement</h3>
          <p className="mt-1 text-sm text-muted">Removes evidence, scores and overrides. The audit log is kept.</p>
          <ErrorNote error={remove.error} />
          <button
            type="button"
            className="pill mt-4 border border-danger/30 text-danger hover:bg-red-50"
            onClick={() => {
              if (window.confirm(`Delete ${eng.data?.app_name}? This cannot be undone.`)) remove.mutate();
            }}
          >
            <Trash2 className="h-4 w-4" aria-hidden /> Delete
          </button>
        </div>
      )}
    </div>
  );
}
