import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { SessionProvider } from "@/components/auth/SessionProvider";
import { ToastProvider } from "@/components/atoms/ToastProvider";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

// Request-time rendering allows Next to attach the proxy's unique script nonce.
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: "AI Docs — Lightweight Collaboration",
  description:
    "A fast, collaborative document editor with file import, sharing, and version history.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <ToastProvider><SessionProvider>{children}</SessionProvider></ToastProvider>
      </body>
    </html>
  );
}
