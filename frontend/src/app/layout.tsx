import type { Metadata } from "next";
import { headers } from "next/headers";
import type { ReactNode } from "react";

import { auth } from "@/auth";
import NavBar from "@/components/NavBar";

import "./globals.css";
import Providers from "./providers";

export const metadata: Metadata = {
  title: { default: "SSDLC Assessment", template: "%s | SSDLC Assessment" },
  description: "Secure software development lifecycle maturity assessments.",
  robots: { index: false, follow: false },
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  await headers(); // per-request rendering so the CSP nonce is applied to every script
  const session = await auth();
  return (
    <html lang="en">
      <body className="min-h-screen">
        <NavBar email={session?.user?.email ?? null} />
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
