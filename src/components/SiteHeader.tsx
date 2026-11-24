import { Show, SignInButton, UserButton } from "@clerk/nextjs";
import Link from "next/link";

export function SiteHeader() {
  return (
    <header className="border-b border-stone-200 bg-white">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
        <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
          <span className="grid h-7 w-7 place-items-center rounded-full bg-emerald-700 text-sm text-white">
            ↻
          </span>
          LendLoop
        </Link>
        <div className="flex items-center gap-3">
          <Show when="signed-in">
            <Link href="/dashboard" className="text-sm font-medium text-stone-700 hover:text-stone-900">
              Dashboard
            </Link>
            <UserButton />
          </Show>
          <Show when="signed-out">
            <SignInButton mode="modal" forceRedirectUrl="/dashboard">
              <button className="btn-primary">Sign in</button>
            </SignInButton>
          </Show>
        </div>
      </div>
    </header>
  );
}
