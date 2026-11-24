"use client";

import { api } from "@convex/_generated/api";
import { useMutation } from "convex/react";
import { useSessionQuery } from "@/components/DashboardSession";
import { ActionButton, LoanCard } from "@/components/LoanCard";
import { EmptyState, PageTitle } from "@/components/ui";

export default function IncomingPage() {
  const loans = useSessionQuery(api.loans.incoming);
  const decide = useMutation(api.loans.decide);
  const markReturned = useMutation(api.loans.markReturned);

  const pending = loans?.filter((l) => l.status === "pending") ?? [];
  const active = loans?.filter((l) => l.status === "approved") ?? [];
  const past = loans?.filter((l) => !["pending", "approved"].includes(l.status)) ?? [];

  if (loans === undefined) return <p className="text-sm text-stone-500">Loading…</p>;

  return (
    <div className="space-y-8">
      <PageTitle title="Incoming requests" subtitle="Requests to borrow your tools." />
      {loans.length === 0 && <EmptyState>No one has asked to borrow your tools yet.</EmptyState>}

      {pending.length > 0 && (
        <Section title={`Awaiting your decision (${pending.length})`}>
          {pending.map((loan) => (
            <LoanCard
              key={loan._id}
              loan={loan}
              actions={
                <>
                  <ActionButton className="btn-primary" onClick={() => decide({ loanId: loan._id, decision: "approved" })}>
                    Approve
                  </ActionButton>
                  <ActionButton onClick={() => decide({ loanId: loan._id, decision: "declined" })}>Decline</ActionButton>
                </>
              }
            />
          ))}
        </Section>
      )}

      {active.length > 0 && (
        <Section title="Out on loan">
          {active.map((loan) => (
            <LoanCard
              key={loan._id}
              loan={loan}
              actions={
                <ActionButton className="btn-primary" onClick={() => markReturned({ loanId: loan._id })}>
                  Mark as returned
                </ActionButton>
              }
            />
          ))}
        </Section>
      )}

      {past.length > 0 && (
        <Section title="History">
          {past.map((loan) => (
            <LoanCard key={loan._id} loan={loan} />
          ))}
        </Section>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-3 text-sm font-semibold tracking-wide text-stone-500 uppercase">{title}</h2>
      <ul className="space-y-3">{children}</ul>
    </section>
  );
}
