"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";

import EngagementForm, { type EngagementFormValues } from "@/components/EngagementForm";
import { ErrorNote } from "@/components/ui";
import { api, jsonBody } from "@/lib/api";
import type { Engagement } from "@/lib/types";

export default function NewEngagementPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const create = useMutation({
    mutationFn: (v: EngagementFormValues) =>
      api<Engagement>("/api/engagements", { method: "POST", ...jsonBody(v) }),
    onSuccess: (eng) => {
      qc.invalidateQueries({ queryKey: ["engagements"] });
      router.push(`/engagements/${eng.id}/evidence`);
    },
  });
  return (
    <main className="mx-auto max-w-[1080px] px-5 pb-24 pt-14">
      <p className="eyebrow">New engagement</p>
      <h1 className="mt-2 mb-8 text-5xl font-semibold tracking-tight text-ink">Set the scope.</h1>
      <ErrorNote error={create.error} />
      <EngagementForm submitLabel="Create engagement" busy={create.isPending} onSubmit={(v) => create.mutate(v)} />
    </main>
  );
}
