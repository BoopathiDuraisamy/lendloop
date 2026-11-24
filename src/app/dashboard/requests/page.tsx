"use client";

import { api } from "@convex/_generated/api";
import { useMutation } from "convex/react";
import { useSessionQuery } from "@/components/DashboardSession";
import Link from "next/link";
import { ActionButton, LoanCard } from "@/components/LoanCard";
import { EmptyState, PageTitle } from "@/components/ui";

export default function MyRequestsPage() {
  const loans = useSessionQuery(api.loans.myRequests);
  const cancel = useMutation(api.loans.cancel);

  return (
    <div>
      <PageTitle title="My requests" subtitle="Things you've asked to borrow." />
      {loans === undefined ? (
        <p className="text-sm text-stone-500">Loading…</p>
      ) : loans.length === 0 ? (
        <EmptyState>
          No requests yet.{" "}
          <Link href="/dashboard" className="font-medium text-emerald-700 underline">
            Browse tools
          </Link>
        </EmptyState>
      ) : (
        <ul className="space-y-3">
          {loans.map((loan) => (
            <LoanCard
              key={loan._id}
              loan={loan}
              actions={
                loan.status === "pending" ? (
                  <ActionButton onClick={() => cancel({ loanId: loan._id })}>Cancel request</ActionButton>
                ) : loan.overdue ? (
                  <p className="text-sm text-red-700">This loan is overdue. Please return it to the lender.</p>
                ) : null
              }
            />
          ))}
        </ul>
      )}
    </div>
  );
}
