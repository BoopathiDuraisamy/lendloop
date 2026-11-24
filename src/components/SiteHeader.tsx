"use client";

import { SignInButton, UserButton, useAuth } from "@clerk/nextjs";
import Link from "next/link";

/**
 * Client component on purpose: auth state is read in the browser, so the
 * server-rendered shell stays static (no request cookies read at render time)
 * and every route can be prerendered and navigated to instantly.
 */
export function SiteHeader() {
  const { isLoaded, isSignedIn } = useAuth();

  return (
    <header className="border-b border-stone-200 bg-white">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
        <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
          <span className="grid h-7 w-7 place-items-center rounded-full bg-emerald-700 text-sm text-white">
            ↻
          </span>
          LendLoop
        </Link>
        <div className="flex h-8 items-center gap-3">
          {!isLoaded ? null : isSignedIn ? (
            <>
              <Link href="/dashboard" className="text-sm font-medium text-stone-700 hover:text-stone-900">
                Dashboard
              </Link>
              <UserButton />
            </>
          ) : (
            <SignInButton mode="modal" forceRedirectUrl="/dashboard">
              <button className="btn-primary">Sign in</button>
            </SignInButton>
          )}
        </div>
      </div>
    </header>
  );
}
