"use client";

import { api } from "@convex/_generated/api";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { DashboardSession, useSessionQuery, useSessionStatus } from "@/components/DashboardSession";
import { TrustedBadge } from "@/components/ui";

const NAV = [
  { href: "/dashboard", label: "Browse tools" },
  { href: "/dashboard/listings", label: "My listings" },
  { href: "/dashboard/requests", label: "My requests" },
  { href: "/dashboard/incoming", label: "Incoming requests" },
];

/**
 * Always renders `children`, even before auth resolves, so every dashboard page
 * is part of the prerendered tree (instant navigation + Next.js validation).
 * Pages wait for the session via `useSessionQuery`; access is enforced in Convex.
 */
export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <DashboardSession>
      <DashboardNav />
      <SessionNotice />
      {children}
    </DashboardSession>
  );
}

function SessionNotice() {
  const status = useSessionStatus();
  if (status === "unauthenticated") {
    return (
      <div className="card mb-4 text-sm">
        Your session couldn&apos;t be verified by the backend. Check that the Clerk ↔ Convex integration is
        configured (see README), then refresh.
      </div>
    );
  }
  if (status === "error") {
    return <div className="card mb-4 text-sm text-red-700">Couldn&apos;t set up your account. Please refresh.</div>;
  }
  return null;
}

function DashboardNav() {
  const pathname = usePathname();
  const me = useSessionQuery(api.users.me);
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
