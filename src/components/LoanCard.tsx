"use client";

import type { api } from "@convex/_generated/api";
import type { FunctionReturnType } from "convex/server";
import { useState, type ReactNode } from "react";
import { ActivityList, ErrorText, StatusBadge, TrustedBadge } from "@/components/ui";
import { errorMessage, formatDate } from "@/lib/format";

export type LoanView = FunctionReturnType<typeof api.loans.myRequests>[number];

export function LoanCard({ loan, actions }: { loan: LoanView; actions?: ReactNode }) {
  return (
    <li className="card">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold">{loan.toolName}</h3>
          <p className="text-sm text-stone-600">
            {formatDate(loan.startDate)} → {formatDate(loan.endDate)}
          </p>
          <p className="mt-1 text-xs text-stone-500">
            {loan.ownerName && (
              <>
                Lender: {loan.ownerName}
                {loan.ownerTrusted && <TrustedBadge className="ml-1" />}
              </>
            )}
            {loan.ownerName && loan.borrowerName && " · "}
            {loan.borrowerName && <>Borrower: {loan.borrowerName}</>}
          </p>
          {loan.message && <p className="mt-2 text-sm text-stone-600 italic">“{loan.message}”</p>}
        </div>
        <StatusBadge status={loan.status} overdue={loan.overdue} />
      </div>
      {actions && <div className="mt-3 flex flex-wrap items-center gap-2">{actions}</div>}
      <ActivityList items={loan.activity} />
    </li>
  );
}

/** Button that runs an async mutation and shows any server-side error inline. */
export function ActionButton({
  onClick,
  className = "btn-secondary",
  children,
}: {
  onClick: () => Promise<unknown>;
  className?: string;
  children: ReactNode;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <button
        className={className}
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            await onClick();
          } catch (err) {
            setError(errorMessage(err));
          } finally {
            setBusy(false);
          }
        }}
      >
        {children}
      </button>
      <ErrorText message={error} />
    </>
  );
}
