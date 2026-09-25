import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** Public runtime flags for the browser (no secrets). */
export async function GET() {
  return NextResponse.json({ blobEnabled: Boolean(process.env.BLOB_READ_WRITE_TOKEN) });
}
