/** Upload allow-list shared by the browser and the Blob token route. Mirrors the API. */
export const ALLOWED_EXTENSIONS = [
  ".pdf", ".docx", ".pptx", ".xlsx", ".md", ".markdown", ".txt", ".csv", ".eml", ".yaml", ".yml", ".json",
] as const;

export const ALLOWED_CONTENT_TYPES = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/markdown",
  "text/x-markdown",
  "text/plain",
  "text/csv",
  "message/rfc822",
  "application/yaml",
  "application/x-yaml",
  "text/yaml",
  "application/json",
  "application/octet-stream",
];

export const MAX_DIRECT_UPLOAD_BYTES = 4 * 1024 * 1024;
export const MAX_BLOB_UPLOAD_BYTES = 50 * 1024 * 1024;

export function extensionOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i).toLowerCase() : "";
}

export function isAllowedFile(name: string): boolean {
  return (ALLOWED_EXTENSIONS as readonly string[]).includes(extensionOf(name));
}

export function isBlobUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && u.hostname.endsWith(".public.blob.vercel-storage.com");
  } catch {
    return false;
  }
}
