"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { UserPlus, X } from "lucide-react";
import { useState, type FormEvent } from "react";

import { ErrorNote, SectionTitle, Spinner } from "@/components/ui";
import { api, jsonBody } from "@/lib/api";
import { useMe } from "@/lib/hooks";
import type { Role } from "@/lib/types";

interface Members {
  members: { id: string; email: string; name: string | null; role: Role }[];
  invitations: { id: string; email: string; role: Role }[];
}

const ROLES: { value: Role; label: string; text: string }[] = [
  { value: "admin", label: "Admin", text: "Manage members, delete engagements, plus everything assessors can do." },
  { value: "assessor", label: "Assessor", text: "Create engagements, upload evidence, run analyses, override scores." },
  { value: "viewer", label: "Viewer", text: "Read-only access to engagements, results and reports." },
];

export default function SettingsPage() {
  const qc = useQueryClient();
  const me = useMe();
  const isAdmin = me.data?.role === "admin";
  const members = useQuery({ queryKey: ["members"], queryFn: () => api<Members>("/api/org/members") });
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("assessor");
  const refresh = () => qc.invalidateQueries({ queryKey: ["members"] });

  const invite = useMutation({
    mutationFn: () => api("/api/org/invitations", { method: "POST", ...jsonBody({ email, role }) }),
    onSuccess: () => {
      setEmail("");
      refresh();
    },
  });
  const changeRole = useMutation({
    mutationFn: (v: { id: string; role: Role }) =>
      api(`/api/org/members/${v.id}`, { method: "PATCH", ...jsonBody({ role: v.role }) }),
    onSuccess: refresh,
  });
  const revoke = useMutation({
    mutationFn: (iid: string) => api(`/api/org/invitations/${iid}`, { method: "DELETE" }),
    onSuccess: refresh,
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    invite.mutate();
  }

  return (
    <main className="mx-auto max-w-[1080px] px-5 pb-24 pt-14">
      <p className="eyebrow">Settings</p>
      <h1 className="mt-2 text-5xl font-semibold tracking-tight text-ink">{me.data?.organization.name ?? "Organization"}.</h1>
      <p className="mt-3 text-muted">
        Signed in as {me.data?.email} · <span className="capitalize">{me.data?.role}</span>
      </p>

      <section className="mt-12">
        <SectionTitle title="Members" subtitle="Data is isolated per organization; members only see their organization's engagements." />
        {members.isLoading && <Spinner />}
        <ErrorNote error={members.error || changeRole.error || revoke.error} />
        <ul className="card divide-y divide-line/70">
          {members.data?.members.map((m) => (
            <li key={m.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5">
              <span>
                <span className="block text-[15px] text-ink">{m.name ?? m.email}</span>
                <span className="text-xs text-muted">{m.email}</span>
              </span>
              {isAdmin ? (
                <select className="input w-auto py-1.5 text-sm" value={m.role} aria-label={`Role for ${m.email}`}
                  onChange={(e) => changeRole.mutate({ id: m.id, role: e.target.value as Role })}>
                  {ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                </select>
              ) : (
                <span className="text-sm capitalize text-muted">{m.role}</span>
              )}
            </li>
          ))}
          {members.data?.invitations.map((i) => (
            <li key={i.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5">
              <span>
                <span className="block text-[15px] text-ink">{i.email}</span>
                <span className="text-xs text-muted">Invited as {i.role} · joins on first sign-in</span>
              </span>
              {isAdmin && (
                <button type="button" className="pill-ghost px-3" aria-label={`Revoke ${i.email}`} onClick={() => revoke.mutate(i.id)}>
                  <X className="h-4 w-4" aria-hidden />
                </button>
              )}
            </li>
          ))}
        </ul>
      </section>

      {isAdmin && (
        <section className="mt-12">
          <SectionTitle title="Invite a member" />
          <form onSubmit={submit} className="card flex flex-wrap items-end gap-3 p-6">
            <div className="min-w-64 flex-1">
              <label htmlFor="invite-email" className="label">E-mail</label>
              <input id="invite-email" type="email" required className="input" value={email}
                onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div>
              <label htmlFor="invite-role" className="label">Role</label>
              <select id="invite-role" className="input" value={role} onChange={(e) => setRole(e.target.value as Role)}>
                {ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select>
            </div>
            <button type="submit" className="pill-brand" disabled={invite.isPending}>
              <UserPlus className="h-4 w-4" aria-hidden /> Invite
            </button>
          </form>
          <div className="mt-3"><ErrorNote error={invite.error} /></div>
        </section>
      )}

      <section className="mt-12 grid gap-4 md:grid-cols-3">
        {ROLES.map((r) => (
          <div key={r.value} className="card p-5">
            <p className="text-[15px] font-semibold text-ink">{r.label}</p>
            <p className="mt-1 text-sm text-muted">{r.text}</p>
          </div>
        ))}
      </section>
    </main>
  );
}
