"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileText, Loader2, MessagesSquare, Search, ShieldCheck, Trash2, Upload } from "lucide-react";
import { useParams } from "next/navigation";
import { useRef, useState, type DragEvent, type FormEvent } from "react";

import { EmptyState, ErrorNote, SectionTitle, Spinner } from "@/components/ui";
import { api, jsonBody } from "@/lib/api";
import { formatBytes, formatDate, useCanWrite } from "@/lib/hooks";
import type { DocumentDetail, DocumentItem, SearchHit } from "@/lib/types";
import {
  ALLOWED_EXTENSIONS,
  MAX_BLOB_UPLOAD_BYTES,
  MAX_DIRECT_UPLOAD_BYTES,
  MAX_DIRECT_UPLOAD_MB,
  isAllowedFile,
} from "@/lib/uploads";

type UploadState = { name: string; status: "uploading" | "done" | "error"; message?: string };

async function uploadOne(engagementId: string, file: File, blobEnabled: boolean): Promise<void> {
  if (!isAllowedFile(file.name)) throw new Error("File type not allowed");
  if (file.size <= MAX_DIRECT_UPLOAD_BYTES) {
    const form = new FormData();
    form.append("file", file);
    await api(`/api/engagements/${engagementId}/documents`, { method: "POST", body: form });
    return;
  }
  if (!blobEnabled) throw new Error(`Files over ${MAX_DIRECT_UPLOAD_MB} MB need Vercel Blob (set BLOB_READ_WRITE_TOKEN)`);
  if (file.size > MAX_BLOB_UPLOAD_BYTES) throw new Error("File exceeds the 50 MB limit");
  const { upload } = await import("@vercel/blob/client");
  const blob = await upload(`evidence/${file.name}`, file, {
    access: "public",
    handleUploadUrl: "/api/blob/upload",
    multipart: file.size > 8 * 1024 * 1024,
  });
  try {
    await api(`/api/engagements/${engagementId}/documents/from-blob`, {
      method: "POST",
      ...jsonBody({ url: blob.url, filename: file.name }),
    });
  } finally {
    await fetch("/api/blob/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: blob.url }),
    }).catch(() => undefined);
  }
}

function Highlight({ text }: { text: string }) {
  const parts = text.split(/(<<.*?>>)/g);
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith("<<") && p.endsWith(">>") ? (
          <mark key={i} className="rounded bg-brand-100 px-0.5 text-ink">
            {p.slice(2, -2)}
          </mark>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </>
  );
}

export default function EvidencePage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const canWrite = useCanWrite();
  const fileInput = useRef<HTMLInputElement>(null);
  const [uploads, setUploads] = useState<UploadState[]>([]);
  const [dragging, setDragging] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [submittedQuery, setSubmittedQuery] = useState("");
  const [interview, setInterview] = useState({ title: "", interviewee_role: "", interview_date: "", notes: "" });

  const config = useQuery({
    queryKey: ["config"],
    queryFn: () => fetch("/api/config").then((r) => r.json() as Promise<{ blobEnabled: boolean }>),
    staleTime: Infinity,
  });
  const docs = useQuery({
    queryKey: ["documents", id],
    queryFn: () => api<DocumentItem[]>(`/api/engagements/${id}/documents`),
  });
  const detail = useQuery({
    queryKey: ["document", id, open],
    queryFn: () => api<DocumentDetail>(`/api/engagements/${id}/documents/${open}`),
    enabled: Boolean(open),
  });
  const search = useQuery({
    queryKey: ["search", id, submittedQuery],
    queryFn: () => api<SearchHit[]>(`/api/engagements/${id}/search?q=${encodeURIComponent(submittedQuery)}`),
    enabled: submittedQuery.length > 0,
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["documents", id] });
    qc.invalidateQueries({ queryKey: ["engagement", id] });
    qc.invalidateQueries({ queryKey: ["engagements"] });
  };

  const addInterview = useMutation({
    mutationFn: () =>
      api(`/api/engagements/${id}/interviews`, {
        method: "POST",
        ...jsonBody({ ...interview, interview_date: interview.interview_date || null }),
      }),
    onSuccess: () => {
      setInterview({ title: "", interviewee_role: "", interview_date: "", notes: "" });
      refresh();
    },
  });
  const remove = useMutation({
    mutationFn: (docId: string) => api(`/api/engagements/${id}/documents/${docId}`, { method: "DELETE" }),
    onSuccess: refresh,
  });

  async function handleFiles(files: FileList | File[]) {
    const list = Array.from(files);
    setUploads((u) => [...list.map((f) => ({ name: f.name, status: "uploading" as const })), ...u]);
    for (const file of list) {
      try {
        await uploadOne(id, file, Boolean(config.data?.blobEnabled));
        setUploads((u) => u.map((x) => (x.name === file.name && x.status === "uploading" ? { ...x, status: "done" } : x)));
      } catch (e) {
        setUploads((u) =>
          u.map((x) =>
            x.name === file.name && x.status === "uploading"
              ? { ...x, status: "error", message: (e as Error).message }
              : x,
          ),
        );
      }
      refresh();
    }
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDragging(false);
    if (canWrite && e.dataTransfer.files.length) void handleFiles(e.dataTransfer.files);
  }

  function submitInterview(e: FormEvent) {
    e.preventDefault();
    addInterview.mutate();
  }

  return (
    <div className="space-y-12">
      <section>
        <SectionTitle title="Evidence" subtitle="Client documentation and interview notes used to score the frameworks." />
        {canWrite && (
          <div className="grid gap-4 lg:grid-cols-2">
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
              className={`card flex flex-col items-center justify-center border-2 border-dashed px-6 py-10 text-center transition ${
                dragging ? "border-brand-6 bg-brand-50" : "border-transparent"
              }`}
            >
              <Upload className="h-9 w-9 text-brand-6" strokeWidth={1.5} aria-hidden />
              <h3 className="mt-3 text-lg font-semibold text-ink">Upload documents</h3>
              <p className="mt-1 text-sm text-muted">
                {ALLOWED_EXTENSIONS.filter((e) => e !== ".markdown" && e !== ".yml").map((e) => e.slice(1).toUpperCase()).join(" · ")}
              </p>
              <p className="mt-1 text-xs text-muted">
                Up to {MAX_DIRECT_UPLOAD_MB} MB directly{config.data?.blobEnabled ? ", up to 50 MB through Vercel Blob" : ""}.
              </p>
              <input
                ref={fileInput}
                type="file"
                multiple
                className="sr-only"
                accept={ALLOWED_EXTENSIONS.join(",")}
                data-testid="file-input"
                onChange={(e) => {
                  if (e.target.files) void handleFiles(e.target.files);
                  e.target.value = "";
                }}
              />
              <button type="button" className="pill-primary mt-5" onClick={() => fileInput.current?.click()}>
                Choose files
              </button>
              {uploads.length > 0 && (
                <ul className="mt-5 w-full space-y-1 text-left text-sm">
                  {uploads.slice(0, 6).map((u, i) => (
                    <li key={`${u.name}-${i}`} className="flex items-center justify-between gap-2 rounded-xl bg-canvas px-3 py-2">
                      <span className="truncate">{u.name}</span>
                      <span className={u.status === "error" ? "text-danger" : u.status === "done" ? "text-brand-7" : "text-muted"}>
                        {u.status === "uploading" ? (
                          <Loader2 className="h-4 w-4 animate-spin" aria-label="Uploading" />
                        ) : u.status === "done" ? (
                          "Added"
                        ) : (
                          u.message
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <form onSubmit={submitInterview} className="card space-y-4 p-6" aria-label="Add interview notes">
              <div className="flex items-center gap-2">
                <MessagesSquare className="h-5 w-5 text-brand-6" strokeWidth={1.75} aria-hidden />
                <h3 className="text-lg font-semibold text-ink">Interview notes</h3>
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="sm:col-span-3">
                  <label className="label" htmlFor="iv-title">Title</label>
                  <input id="iv-title" className="input" required maxLength={300} value={interview.title}
                    onChange={(e) => setInterview({ ...interview, title: e.target.value })} />
                </div>
                <div className="sm:col-span-2">
                  <label className="label" htmlFor="iv-role">Interviewee role</label>
                  <input id="iv-role" className="input" maxLength={200} placeholder="e.g. Lead developer"
                    value={interview.interviewee_role}
                    onChange={(e) => setInterview({ ...interview, interviewee_role: e.target.value })} />
                </div>
                <div>
                  <label className="label" htmlFor="iv-date">Date</label>
                  <input id="iv-date" type="date" className="input" value={interview.interview_date}
                    onChange={(e) => setInterview({ ...interview, interview_date: e.target.value })} />
                </div>
              </div>
              <div>
                <label className="label" htmlFor="iv-notes">Notes (Markdown supported)</label>
                <textarea id="iv-notes" className="input min-h-40 font-mono text-[13px]" required value={interview.notes}
                  placeholder={"## Build pipeline\nSAST runs on every pull request..."}
                  onChange={(e) => setInterview({ ...interview, notes: e.target.value })} />
              </div>
              <p className="flex items-center gap-1.5 text-xs text-muted">
                <ShieldCheck className="h-4 w-4 text-brand-6" aria-hidden /> E-mail addresses and phone numbers are
                redacted automatically.
              </p>
              <ErrorNote error={addInterview.error} />
              <button type="submit" className="pill-brand" disabled={addInterview.isPending}>
                {addInterview.isPending ? "Saving..." : "Save interview"}
              </button>
            </form>
          </div>
        )}
      </section>

      <section>
        <SectionTitle title="Library" subtitle="Parsed into heading-aware chunks for search and citation." />
        {docs.isLoading && <Spinner />}
        <ErrorNote error={docs.error || remove.error} />
        {docs.data?.length === 0 && (
          <EmptyState icon={<FileText className="h-10 w-10" strokeWidth={1.25} />} title="No evidence yet">
            Upload documents or add interview notes to get started.
          </EmptyState>
        )}
        {!!docs.data?.length && (
          <ul className="card divide-y divide-line/70" data-testid="document-list">
            {docs.data.map((d) => (
              <li key={d.id} className="px-5 py-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <button type="button" className="flex min-w-0 items-center gap-3 text-left"
                    onClick={() => setOpen(open === d.id ? null : d.id)} aria-expanded={open === d.id}>
                    {d.kind === "interview" ? (
                      <MessagesSquare className="h-5 w-5 shrink-0 text-brand-6" strokeWidth={1.75} aria-hidden />
                    ) : (
                      <FileText className="h-5 w-5 shrink-0 text-brand-6" strokeWidth={1.75} aria-hidden />
                    )}
                    <span className="min-w-0">
                      <span className="block truncate text-[15px] font-medium text-ink">{d.title}</span>
                      <span className="block text-xs text-muted">
                        {d.kind === "interview"
                          ? `Interview${d.interviewee_role ? ` · ${d.interviewee_role}` : ""} · ${formatDate(d.interview_date ?? d.created_at)}`
                          : `${d.filename} · ${formatBytes(d.size_bytes)} · ${formatDate(d.created_at)}`}
                        {` · ${d.chunk_count} chunks`}
                        {d.redactions > 0 && ` · ${d.redactions} redacted`}
                      </span>
                    </span>
                  </button>
                  {canWrite && (
                    <button type="button" className="pill-ghost px-3 text-danger hover:bg-red-50" aria-label={`Delete ${d.title}`}
                      onClick={() => window.confirm(`Delete ${d.title}?`) && remove.mutate(d.id)}>
                      <Trash2 className="h-4 w-4" aria-hidden />
                    </button>
                  )}
                </div>
                {open === d.id && (
                  <div className="mt-4 max-h-96 overflow-auto rounded-2xl bg-canvas p-4 text-[13px] leading-relaxed">
                    {detail.isLoading && <Spinner />}
                    {detail.data?.chunks.map((c) => (
                      <div key={c.id} className="mb-4">
                        {c.heading && <p className="mb-1 text-xs font-semibold text-brand-7">{c.heading}</p>}
                        <p className="whitespace-pre-wrap text-fg">{c.text}</p>
                      </div>
                    ))}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <SectionTitle title="Search" subtitle="Full-text search across every chunk in this engagement." />
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setSubmittedQuery(query.trim());
          }}
          className="flex gap-2"
          role="search"
        >
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-4 top-3 h-4 w-4 text-muted" aria-hidden />
            <input className="input pl-10" value={query} onChange={(e) => setQuery(e.target.value)}
              placeholder="e.g. threat modeling" aria-label="Search evidence" maxLength={200} />
          </div>
          <button type="submit" className="pill-primary">Search</button>
        </form>
        <ErrorNote error={search.error} />
        {search.data && (
          <ul className="mt-4 space-y-2">
            {search.data.length === 0 && <li className="text-sm text-muted">No matches.</li>}
            {search.data.map((h) => (
              <li key={h.chunk_id} className="card p-4">
                <p className="text-xs text-muted">
                  {h.document_title}
                  {h.heading && ` · ${h.heading}`}
                </p>
                <p className="mt-1 text-sm text-fg">
                  <Highlight text={h.snippet} />
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
