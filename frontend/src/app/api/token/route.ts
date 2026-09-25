import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { mintApiToken } from "@/lib/api-token";

export const dynamic = "force-dynamic";

/** Exchange the Auth.js session cookie for a 15-minute API bearer token. */
export async function GET() {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) {
    return NextResponse.json({ detail: "Not signed in" }, { status: 401 });
  }
  const { token, expiresAt } = await mintApiToken({ email, name: session.user?.name });
  return NextResponse.json(
    { token, expiresAt },
    { headers: { "Cache-Control": "no-store, private" } },
  );
}
