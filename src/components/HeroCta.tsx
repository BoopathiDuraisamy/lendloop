"use client";

import { SignInButton, useAuth } from "@clerk/nextjs";
import Link from "next/link";

const style = "btn bg-white px-4 py-2 text-emerald-800 hover:bg-emerald-50";

/** Sign-in / dashboard call to action. Auth is read client-side so the page shell stays static. */
export function HeroCta() {
  const { isLoaded, isSignedIn } = useAuth();
  if (!isLoaded) return <div className="h-10" />;
  return isSignedIn ? (
    <Link href="/dashboard" className={style}>
      Go to your dashboard →
    </Link>
  ) : (
    <SignInButton mode="modal" forceRedirectUrl="/dashboard">
      <button className={style}>Sign in to lend or borrow</button>
    </SignInButton>
  );
}
