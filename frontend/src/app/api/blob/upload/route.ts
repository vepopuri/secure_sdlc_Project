import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { ALLOWED_CONTENT_TYPES, MAX_BLOB_UPLOAD_BYTES, isAllowedFile } from "@/lib/uploads";

/**
 * Issues short-lived client tokens so the browser can upload files larger than the 4.5 MB
 * serverless body limit straight to Vercel Blob. The API then fetches the file from the
 * (allow-listed) Blob host, parses it, and the browser deletes the blob.
 */
export async function POST(request: Request) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return NextResponse.json({ detail: "Vercel Blob is not configured" }, { status: 501 });
  }
  const body = (await request.json()) as HandleUploadBody;
  try {
    const json = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname) => {
        const session = await auth();
        if (!session?.user?.email) throw new Error("Not signed in");
        if (!isAllowedFile(pathname)) throw new Error("File type not allowed");
        return {
          allowedContentTypes: ALLOWED_CONTENT_TYPES,
          maximumSizeInBytes: MAX_BLOB_UPLOAD_BYTES,
          addRandomSuffix: true,
          tokenPayload: JSON.stringify({ email: session.user.email }),
        };
      },
      onUploadCompleted: async () => {
        // Ingestion is triggered by the browser calling the API with the blob URL.
      },
    });
    return NextResponse.json(json);
  } catch (error) {
    return NextResponse.json({ detail: (error as Error).message }, { status: 400 });
  }
}
