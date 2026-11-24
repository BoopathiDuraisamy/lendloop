import { ClerkProvider } from "@clerk/nextjs";
import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Suspense } from "react";
import { ConvexClientProvider } from "@/components/ConvexClientProvider";
import { SiteHeader } from "@/components/SiteHeader";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "LendLoop — Borrow what you need. Lend what you don't.",
  description: "A neighborhood tool-lending board.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col font-sans">
        {/*
          ClerkProvider reads request cookies (auth state), which is request-time
          data. With `cacheComponents`, that must sit inside <Suspense> so Next can
          prerender a static shell (the fallback) and stream the rest.
        */}
        <Suspense fallback={<ShellFallback />}>
          <ClerkProvider>
            <ConvexClientProvider>
              <SiteHeader />
              <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">{children}</main>
              <Footer />
            </ConvexClientProvider>
          </ClerkProvider>
        </Suspense>
      </body>
    </html>
  );
}

function Footer() {
  return (
    <footer className="py-6 text-center text-xs text-stone-400">
      LendLoop · a fictional neighborhood lending board
    </footer>
  );
}

/** Static shell shown while auth-dependent UI streams in. */
function ShellFallback() {
  return (
    <>
      <header className="border-b border-stone-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center px-4 py-3 font-semibold tracking-tight">
          <span className="mr-2 grid h-7 w-7 place-items-center rounded-full bg-emerald-700 text-sm text-white">↻</span>
          LendLoop
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 text-sm text-stone-500">Loading…</main>
      <Footer />
    </>
  );
}
