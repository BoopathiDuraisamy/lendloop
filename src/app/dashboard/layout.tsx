"use client";

import { api } from "@convex/_generated/api";
import { Authenticated, AuthLoading, Unauthenticated, useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { TrustedBadge } from "@/components/ui";

const NAV = [
  { href: "/dashboard", label: "Browse tools" },
  { href: "/dashboard/listings", label: "My listings" },
  { href: "/dashboard/requests", label: "My requests" },
  { href: "/dashboard/incoming", label: "Incoming requests" },
];

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <AuthLoading>
        <p className="text-sm text-stone-500">Loading…</p>
      </AuthLoading>
      <Unauthenticated>
        <div className="card text-sm">
          Your session couldn&apos;t be verified by the backend. Check that the Clerk ↔ Convex integration is
          configured (see README), then refresh.
        </div>
      </Unauthenticated>
      <Authenticated>
        <EnsureUser>
          <DashboardNav />
          {children}
        </EnsureUser>
      </Authenticated>
    </>
  );
}

/** Upserts the Convex user row from the verified Clerk identity before rendering. */
function EnsureUser({ children }: { children: ReactNode }) {
  const store = useMutation(api.users.store);
  const me = useQuery(api.users.me);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    store().catch(() => setError("Couldn't set up your account. Please refresh."));
  }, [store]);

  if (error) return <div className="card text-sm text-red-700">{error}</div>;
  if (!me) return <p className="text-sm text-stone-500">Setting up your account…</p>;
  return <>{children}</>;
}

function DashboardNav() {
  const pathname = usePathname();
  const me = useQuery(api.users.me);
  const items = me?.role === "admin" ? [...NAV, { href: "/dashboard/admin", label: "Admin" }] : NAV;

  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <nav className="flex flex-wrap gap-1 rounded-xl bg-stone-200/60 p-1">
        {items.map((item) => {
          const active = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                active ? "bg-white text-stone-900 shadow-sm" : "text-stone-600 hover:text-stone-900"
              }`}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>
      {me && (
        <p className="text-sm text-stone-500">
          Hi, {me.name}
          {me.trustedLender && <TrustedBadge className="ml-2" />}
          {me.role === "admin" && (
            <span className="ml-2 rounded-full bg-stone-800 px-2 py-0.5 text-xs text-white">admin</span>
          )}
        </p>
      )}
    </div>
  );
}
