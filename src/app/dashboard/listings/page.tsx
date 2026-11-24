"use client";

import { api } from "@convex/_generated/api";
import type { Category, Condition } from "@convex/lib/validators";
import type { FunctionReturnType } from "convex/server";
import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { AvailabilityBadge, EmptyState, ErrorText, PageTitle } from "@/components/ui";
import {
  CATEGORIES,
  CATEGORY_EMOJI,
  CATEGORY_LABELS,
  CONDITION_LABELS,
  CONDITIONS,
  errorMessage,
  formatDate,
} from "@/lib/format";

type FormValues = { name: string; category: Category; condition: Condition; description: string };
const EMPTY: FormValues = { name: "", category: "power_tools", condition: "good", description: "" };

export default function ListingsPage() {
  const listings = useQuery(api.tools.myListings);
  const create = useMutation(api.tools.create);
  const [adding, setAdding] = useState(false);

  return (
    <div>
      <PageTitle
        title="My listings"
        subtitle="Tools you're happy to lend."
        action={
          !adding && (
            <button className="btn-primary" onClick={() => setAdding(true)}>
              + List a tool
            </button>
          )
        }
      />

      {adding && (
        <div className="card mb-4">
          <ToolForm
            initial={EMPTY}
            submitLabel="List tool"
            onSubmit={async (values) => {
              await create(values);
              setAdding(false);
            }}
            onCancel={() => setAdding(false)}
          />
        </div>
      )}

      {listings === undefined ? (
        <p className="text-sm text-stone-500">Loading…</p>
      ) : listings.length === 0 ? (
        !adding && <EmptyState>You haven&apos;t listed anything yet.</EmptyState>
      ) : (
        <ul className="space-y-3">
          {listings.map((t) => (
            <ListingRow key={t._id} tool={t} />
          ))}
        </ul>
      )}
    </div>
  );
}

type Listing = FunctionReturnType<typeof api.tools.myListings>[number];

function ListingRow({ tool }: { tool: Listing }) {
  const update = useMutation(api.tools.update);
  const remove = useMutation(api.tools.remove);
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (editing) {
    return (
      <li className="card">
        <ToolForm
          initial={tool}
          submitLabel="Save changes"
          onSubmit={async (values) => {
            await update({ toolId: tool._id, ...values });
            setEditing(false);
          }}
          onCancel={() => setEditing(false)}
        />
      </li>
    );
  }

  return (
    <li className="card">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs text-stone-500">
            {CATEGORY_EMOJI[tool.category]} {CATEGORY_LABELS[tool.category]} · {CONDITION_LABELS[tool.condition]}
          </p>
          <h3 className="font-semibold">{tool.name}</h3>
          {tool.description && <p className="mt-1 text-sm text-stone-600">{tool.description}</p>}
        </div>
        <AvailabilityBadge
          status={tool.availability.status}
          availableFrom={tool.availability.availableFrom && formatDate(tool.availability.availableFrom)}
        />
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button className="btn-secondary" onClick={() => setEditing(true)}>
          Edit
        </button>
        {confirming ? (
          <>
            <span className="text-sm text-stone-600">Delete this listing? Pending requests will be cancelled.</span>
            <button
              className="btn-danger"
              onClick={async () => {
                setError(null);
                try {
                  await remove({ toolId: tool._id });
                } catch (err) {
                  setError(errorMessage(err));
                  setConfirming(false);
                }
              }}
            >
              Yes, delete
            </button>
            <button className="btn-secondary" onClick={() => setConfirming(false)}>
              Keep
            </button>
          </>
        ) : (
          <button className="btn-danger" onClick={() => setConfirming(true)}>
            Delete
          </button>
        )}
      </div>
      <div className="mt-2">
        <ErrorText message={error} />
      </div>
    </li>
  );
}

function ToolForm({
  initial,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial: FormValues;
  submitLabel: string;
  onSubmit: (values: FormValues) => Promise<void>;
  onCancel: () => void;
}) {
  const [values, setValues] = useState<FormValues>({
    name: initial.name,
    category: initial.category,
    condition: initial.condition,
    description: initial.description,
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof FormValues>(k: K, v: FormValues[K]) => setValues((s) => ({ ...s, [k]: v }));

  return (
    <form
      className="space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          await onSubmit(values);
        } catch (err) {
          setError(errorMessage(err));
        } finally {
          setBusy(false);
        }
      }}
    >
      <label className="block">
        <span className="label">Name</span>
        <input
          className="input"
          required
          maxLength={80}
          placeholder="e.g. Cordless drill"
          value={values.name}
          onChange={(e) => set("name", e.target.value)}
        />
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label>
          <span className="label">Category</span>
          <select className="input" value={values.category} onChange={(e) => set("category", e.target.value as Category)}>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABELS[c]}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="label">Condition</span>
          <select
            className="input"
            value={values.condition}
            onChange={(e) => set("condition", e.target.value as Condition)}
          >
            {CONDITIONS.map((c) => (
              <option key={c} value={c}>
                {CONDITION_LABELS[c]}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="block">
        <span className="label">Short description</span>
        <textarea
          className="input"
          rows={2}
          maxLength={500}
          placeholder="Includes two batteries and a charger."
          value={values.description}
          onChange={(e) => set("description", e.target.value)}
        />
      </label>
      <ErrorText message={error} />
      <div className="flex gap-2">
        <button type="submit" className="btn-primary" disabled={busy}>
          {busy ? "Saving…" : submitLabel}
        </button>
        <button type="button" className="btn-secondary" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
