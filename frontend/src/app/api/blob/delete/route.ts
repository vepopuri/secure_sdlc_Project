import { del } from "@vercel/blob";
import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { isBlobUrl } from "@/lib/uploads";

/** Delete a temporary upload once the API has ingested it, so evidence does not linger in Blob. */
export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.email) return NextResponse.json({ detail: "Not signed in" }, { status: 401 });
  if (!process.env.BLOB_READ_WRITE_TOKEN) return NextResponse.json({ ok: true });
  const { url } = (await request.json().catch(() => ({}))) as { url?: string };
  if (!url || !isBlobUrl(url)) return NextResponse.json({ detail: "Invalid blob URL" }, { status: 400 });
  await del(url);
  return NextResponse.json({ ok: true });
}
