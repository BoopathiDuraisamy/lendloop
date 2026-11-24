"use client";

import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { Category } from "@convex/lib/validators";
import type { FunctionReturnType } from "convex/server";
import { useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useState } from "react";
import { AvailabilityBadge, EmptyState, ErrorText, PageTitle, TrustedBadge } from "@/components/ui";
import {
  CATEGORIES,
  CATEGORY_EMOJI,
  CATEGORY_LABELS,
  CONDITION_LABELS,
  errorMessage,
  formatDate,
  todayIso,
} from "@/lib/format";

export default function BrowsePage() {
  const [category, setCategory] = useState<Category | undefined>(undefined);
  const tools = useQuery(api.tools.list, { category });

  return (
    <div>
      <PageTitle title="Browse tools" subtitle="Everything your neighbors are willing to lend." />

      <div className="mb-5 flex flex-wrap gap-2" role="group" aria-label="Filter by category">
        <Chip active={category === undefined} onClick={() => setCategory(undefined)}>
          All
        </Chip>
        {CATEGORIES.map((c) => (
          <Chip key={c} active={category === c} onClick={() => setCategory(c)}>
            {CATEGORY_EMOJI[c]} {CATEGORY_LABELS[c]}
          </Chip>
        ))}
      </div>

      {tools === undefined ? (
        <p className="text-sm text-stone-500">Loading…</p>
      ) : tools.length === 0 ? (
        <EmptyState>
          No tools in this category yet.{" "}
          <Link href="/dashboard/listings" className="font-medium text-emerald-700 underline">
            List one
          </Link>
          .
        </EmptyState>
      ) : (
        <ul className="grid gap-4 md:grid-cols-2">
          {tools.map((t) => (
            <ToolCard key={t._id} tool={t} />
          ))}
        </ul>
      )}
    </div>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-full border px-3 py-1 text-sm transition ${
        active
          ? "border-emerald-700 bg-emerald-700 text-white"
          : "border-stone-300 bg-white text-stone-700 hover:border-stone-400"
      }`}
    >
      {children}
    </button>
  );
}

type Tool = FunctionReturnType<typeof api.tools.list>[number];

function ToolCard({ tool }: { tool: Tool }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="card flex flex-col">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs text-stone-500">
            {CATEGORY_EMOJI[tool.category]} {CATEGORY_LABELS[tool.category]} · {CONDITION_LABELS[tool.condition]}
          </p>
          <h3 className="mt-0.5 font-semibold">{tool.name}</h3>
        </div>
        <AvailabilityBadge
          status={tool.availability.status}
          availableFrom={tool.availability.availableFrom && formatDate(tool.availability.availableFrom)}
        />
      </div>
      {tool.description && <p className="mt-2 text-sm text-stone-600">{tool.description}</p>}
      <p className="mt-3 text-xs text-stone-500">
        {tool.isMine ? (
          "Your listing"
        ) : (
          <>
            Lent by {tool.ownerName}
            {tool.ownerTrusted && <TrustedBadge className="ml-2" />}
          </>
        )}
      </p>
      {tool.availability.bookings.length > 0 && (
        <p className="mt-1 text-xs text-stone-500">
          Booked:{" "}
          {tool.availability.bookings.map((b) => `${formatDate(b.startDate)}–${formatDate(b.endDate)}`).join(", ")}
        </p>
      )}
      {!tool.isMine && (
        <div className="mt-4">
          {open ? (
            <RequestForm toolId={tool._id} onDone={() => setOpen(false)} />
          ) : (
            <button className="btn-primary" onClick={() => setOpen(true)}>
              Request to borrow
            </button>
          )}
        </div>
      )}
    </li>
  );
}

function RequestForm({ toolId, onDone }: { toolId: Id<"tools">; onDone: () => void }) {
  const request = useMutation(api.loans.request);
  const today = todayIso();
  const [startDate, setStart] = useState(today);
  const [endDate, setEnd] = useState(today);
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await request({ toolId, startDate, endDate, message: message || undefined });
      setDone(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <p className="text-sm text-emerald-800">
        Request sent! Track it under{" "}
        <Link href="/dashboard/requests" className="font-medium underline">
          My requests
        </Link>
        .
      </p>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-3 rounded-lg bg-stone-50 p-3">
      <div className="grid grid-cols-2 gap-3">
        <label>
          <span className="label">From</span>
          <input
            type="date"
            className="input"
            required
            min={today}
            value={startDate}
            onChange={(e) => {
              setStart(e.target.value);
              if (endDate < e.target.value) setEnd(e.target.value);
            }}
          />
        </label>
        <label>
          <span className="label">Until</span>
          <input
            type="date"
            className="input"
            required
            min={startDate}
            value={endDate}
            onChange={(e) => setEnd(e.target.value)}
          />
        </label>
      </div>
      <label className="block">
        <span className="label">Note to the lender (optional)</span>
        <input
          className="input"
          maxLength={300}
          placeholder="What's it for?"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
        />
      </label>
      <ErrorText message={error} />
      <div className="flex gap-2">
        <button type="submit" className="btn-primary" disabled={busy}>
          {busy ? "Sending…" : "Send request"}
        </button>
        <button type="button" className="btn-secondary" onClick={onDone}>
          Cancel
        </button>
      </div>
    </form>
  );
}
