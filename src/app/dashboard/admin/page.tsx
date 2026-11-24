"use client";

import { api } from "@convex/_generated/api";
import type { LoanStatus } from "@convex/lib/validators";
import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { ActionButton, LoanCard } from "@/components/LoanCard";
import { EmptyState, PageTitle } from "@/components/ui";
import { CATEGORY_LABELS, STATUS_LABELS, timeAgo } from "@/lib/format";

/**
 * Admin console. The nav link is hidden for non-admins, but the real guard is
 * `requireAdmin` in each Convex function: non-admins get FORBIDDEN here.
 */
export default function AdminPage() {
  const me = useQuery(api.users.me);
  if (me === undefined) return <p className="text-sm text-stone-500">Loading…</p>;
  if (me?.role !== "admin") return <EmptyState>Admins only.</EmptyState>;

  return (
    <div className="space-y-10">
      <PageTitle title="Admin" subtitle="Moderate listings, review loans and recognize trusted lenders." />
      <AutomationFailures />
      <Listings />
      <Members />
      <AllLoans />
    </div>
  );
}

function AutomationFailures() {
  const failures = useQuery(api.automation.recentFailures);
  return (
    <section>
      <h2 className="mb-3 font-semibold">Automation failures</h2>
      {failures === undefined ? null : failures.length === 0 ? (
        <p className="text-sm text-stone-500">No failed automation runs. 🎉</p>
      ) : (
        <ul className="card divide-y divide-stone-100 p-0">
          {failures.map((f) => (
            <li key={f._id} className="flex items-center justify-between gap-3 px-4 py-2 text-sm">
              <span>
                <span className="mr-2 rounded bg-red-100 px-1.5 py-0.5 text-xs text-red-800">{f.kind}</span>
                {f.detail}
              </span>
              <span className="shrink-0 text-xs text-stone-400">{timeAgo(f.at)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Listings() {
  const tools = useQuery(api.tools.list, {});
  const remove = useMutation(api.tools.remove);
  return (
    <section>
      <h2 className="mb-3 font-semibold">All listings</h2>
      {tools === undefined ? null : tools.length === 0 ? (
        <p className="text-sm text-stone-500">No listings.</p>
      ) : (
        <ul className="card divide-y divide-stone-100 p-0">
          {tools.map((t) => (
            <li key={t._id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 text-sm">
              <span>
                <span className="font-medium">{t.name}</span>{" "}
                <span className="text-stone-500">
                  · {CATEGORY_LABELS[t.category]} · by {t.ownerName}
                </span>
              </span>
              <ActionButton className="btn-danger" onClick={() => remove({ toolId: t._id })}>
                Remove
              </ActionButton>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Members() {
  const users = useQuery(api.users.listForAdmin);
  const setTrusted = useMutation(api.users.setTrustedLender);
  return (
    <section>
      <h2 className="mb-3 font-semibold">Members</h2>
      {users === undefined ? null : (
        <ul className="card divide-y divide-stone-100 p-0">
          {users.map((u) => (
            <li key={u._id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 text-sm">
              <span>
                <span className="font-medium">{u.name}</span>{" "}
                <span className="text-stone-500">{u.email}</span>
                {u.role === "admin" && (
                  <span className="ml-2 rounded-full bg-stone-800 px-2 py-0.5 text-xs text-white">admin</span>
                )}
              </span>
              <ActionButton
                className={u.trustedLender ? "btn-secondary" : "btn-primary"}
                onClick={() => setTrusted({ userId: u._id, trusted: !u.trustedLender })}
              >
                {u.trustedLender ? "★ Remove Trusted Lender" : "Mark Trusted Lender"}
              </ActionButton>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

const STATUSES: LoanStatus[] = ["pending", "approved", "declined", "cancelled", "returned"];

function AllLoans() {
  const [status, setStatus] = useState<LoanStatus | undefined>(undefined);
  const loans = useQuery(api.loans.listAll, { status });
  return (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-semibold">All loans</h2>
        <select
          className="input w-auto"
          value={status ?? ""}
          onChange={(e) => setStatus((e.target.value || undefined) as LoanStatus | undefined)}
        >
          <option value="">All statuses</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABELS[s]}
            </option>
          ))}
        </select>
      </div>
      {loans === undefined ? null : loans.length === 0 ? (
        <p className="text-sm text-stone-500">No loans.</p>
      ) : (
        <ul className="space-y-3">
          {loans.map((loan) => (
            <LoanCard key={loan._id} loan={loan} />
          ))}
        </ul>
      )}
    </section>
  );
}
