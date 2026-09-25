"use client";

/**
 * Browser client for the FastAPI backend. Bearer tokens are minted by /api/token (Next.js,
 * session-protected) and cached in memory until shortly before they expire.
 */

export const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000").replace(/\/$/, "");

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

let cached: { token: string; expiresAt: number } | null = null;
let inflight: Promise<string> | null = null;

async function fetchToken(): Promise<string> {
  const res = await fetch("/api/token", { cache: "no-store" });
  if (res.status === 401) {
    // Outside React: a full page load is intended so the proxy re-checks the session.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.href = "/signin";
    throw new ApiError(401, "Your session has expired. Please sign in again.");
  }
  if (!res.ok) throw new ApiError(res.status, "Could not obtain an API token");
  const body = (await res.json()) as { token: string; expiresAt: number };
  cached = body;
  return body.token;
}

export async function getToken(force = false): Promise<string> {
  if (!force && cached && cached.expiresAt - Date.now() > 60_000) return cached.token;
  inflight ??= fetchToken().finally(() => {
    inflight = null;
  });
  return inflight;
}

function detailOf(body: unknown, fallback: string): string {
  if (body && typeof body === "object" && "detail" in body) {
    const d = (body as { detail: unknown }).detail;
    if (typeof d === "string") return d;
    if (Array.isArray(d)) {
      return d
        .map((e) => (e && typeof e === "object" && "msg" in e ? String((e as { msg: unknown }).msg) : String(e)))
        .join("; ");
    }
  }
  return fallback;
}

export async function apiRaw(path: string, init: RequestInit = {}, retry = true): Promise<Response> {
  const token = await getToken();
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  if (init.body && !(init.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, { ...init, headers, cache: "no-store" });
  } catch {
    throw new ApiError(0, `Cannot reach the API at ${API_URL}. Check NEXT_PUBLIC_API_URL and CORS_ORIGINS.`);
  }
  if (res.status === 401 && retry) {
    await getToken(true);
    return apiRaw(path, init, false);
  }
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new ApiError(res.status, detailOf(body, `Request failed (${res.status})`));
  }
  return res;
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await apiRaw(path, init);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const jsonBody = (data: unknown): RequestInit => ({ body: JSON.stringify(data) });

/** Download a binary response and hand it to the browser as a file. */
export async function download(path: string, fallbackName: string): Promise<void> {
  const res = await apiRaw(path);
  const blob = await res.blob();
  const cd = res.headers.get("Content-Disposition") ?? "";
  const match = /filename="([^"]+)"/.exec(cd);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = match?.[1] ?? fallbackName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
