"use client";

import type { LoanStatus } from "@convex/lib/validators";
import { useEffect, useState, type ReactNode } from "react";
import { STATUS_LABELS, timeAgo } from "@/lib/format";

export function TrustedBadge({ className = "" }: { className?: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 ${className}`}
      title="Marked as a Trusted Lender by an admin"
    >
      ★ Trusted Lender
    </span>
  );
}

const STATUS_STYLES: Record<LoanStatus, string> = {
  pending: "bg-sky-100 text-sky-800",
  approved: "bg-emerald-100 text-emerald-800",
  declined: "bg-stone-200 text-stone-700",
  cancelled: "bg-stone-200 text-stone-700",
  returned: "bg-violet-100 text-violet-800",
};

export function StatusBadge({ status, overdue }: { status: LoanStatus; overdue?: boolean }) {
  if (overdue) {
    return <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800">Overdue</span>;
  }
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[status]}`}>
      {STATUS_LABELS[status]}
    </span>
  );
}

export function AvailabilityBadge({ status, availableFrom }: { status: "available" | "on_loan"; availableFrom?: string }) {
  return status === "available" ? (
    <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800">Available</span>
  ) : (
    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
      On loan{availableFrom ? ` until ${availableFrom}` : ""}
    </span>
  );
}

type Activity = { kind: string; status: string; detail?: string; at: number };

const DOT: Record<string, string> = {
  sent: "bg-emerald-500",
  pending: "bg-sky-400",
  failed: "bg-red-500",
  skipped: "bg-stone-300",
};

/** Bonus: recent automation activity on a loan, e.g. "Overdue reminder sent · 2 days ago". */
export function ActivityList({ items }: { items: Activity[] }) {
  const now = useNow();
  if (items.length === 0) return null;
  return (
    <ul className="mt-3 space-y-1 border-t border-stone-100 pt-3">
      {items.map((a, i) => (
        <li key={i} className="flex items-center gap-2 text-xs text-stone-500">
          <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${DOT[a.status] ?? "bg-stone-300"}`} />
          <span className="truncate">{a.detail ?? a.kind}</span>
          <span className="shrink-0 text-stone-400">· {timeAgo(a.at, now)}</span>
        </li>
      ))}
    </ul>
  );
}

function useNow(intervalMs = 30_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <div className="card py-10 text-center text-sm text-stone-500">{children}</div>;
}

export function PageTitle({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <div className="mb-4 flex items-end justify-between gap-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="text-sm text-stone-500">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function ErrorText({ message }: { message: string | null }) {
  if (!message) return null;
  return <p className="text-sm text-red-700">{message}</p>;
}
