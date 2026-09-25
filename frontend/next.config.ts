import type { NextConfig } from "next";

// Static security headers. The Content-Security-Policy (with a per-request nonce) is set in
// src/proxy.ts because it needs a fresh nonce per request.
const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
];

// Container build (see /Dockerfile): the API runs inside the same container and is reached
// through a same-origin rewrite, /backend/* -> INTERNAL_API_URL/*. Unset on Vercel.
const internalApiUrl = process.env.INTERNAL_API_URL?.replace(/\/$/, "");

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  output: process.env.NEXT_OUTPUT === "standalone" ? "standalone" : undefined,
  experimental: internalApiUrl
    ? {
        // Claude analysis of one framework domain can take minutes (default rewrite timeout: 30 s).
        proxyTimeout: 300_000,
        proxyClientMaxBodySize: "30mb",
      }
    : undefined,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  async rewrites() {
    return internalApiUrl ? [{ source: "/backend/:path*", destination: `${internalApiUrl}/:path*` }] : [];
  },
};

export default nextConfig;
