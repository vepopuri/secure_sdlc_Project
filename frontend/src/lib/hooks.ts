"use client";

import { useQuery } from "@tanstack/react-query";

import { api } from "./api";
import type { Engagement, FrameworkSummary, Me } from "./types";

export function useMe() {
  return useQuery({ queryKey: ["me"], queryFn: () => api<Me>("/api/me"), staleTime: 60_000 });
}

export function useCanWrite() {
  const me = useMe();
  return me.data ? me.data.role !== "viewer" : false;
}

export function useFrameworks() {
  return useQuery({
    queryKey: ["frameworks"],
    queryFn: () => api<FrameworkSummary[]>("/api/frameworks"),
    staleTime: 10 * 60_000,
  });
}

export function useEngagement(id: string) {
  return useQuery({ queryKey: ["engagement", id], queryFn: () => api<Engagement>(`/api/engagements/${id}`) });
}

export const STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  in_progress: "In progress",
  review: "Review",
  final: "Final",
};

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "-";
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}
