import "server-only";

import { SignJWT } from "jose";

export const API_TOKEN_TTL_SECONDS = 15 * 60;
export const JWT_ISSUER = process.env.JWT_ISSUER ?? "ssdlc-frontend";
export const JWT_AUDIENCE = process.env.JWT_AUDIENCE ?? "ssdlc-api";

/** Mint the short-lived HS256 token the FastAPI backend verifies with the shared AUTH_SECRET. */
export async function mintApiToken(user: { email: string; name?: string | null }) {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET is not set");
  const now = Math.floor(Date.now() / 1000);
  const token = await new SignJWT({ email: user.email, name: user.name ?? undefined })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(user.email)
    .setIssuer(JWT_ISSUER)
    .setAudience(JWT_AUDIENCE)
    .setIssuedAt(now)
    .setExpirationTime(now + API_TOKEN_TTL_SECONDS)
    .sign(new TextEncoder().encode(secret));
  return { token, expiresAt: (now + API_TOKEN_TTL_SECONDS) * 1000 };
}
