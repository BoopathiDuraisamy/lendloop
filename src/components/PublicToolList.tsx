"use client";

import { api } from "@convex/_generated/api";
import { useQuery } from "convex/react";
import { CATEGORY_EMOJI, CATEGORY_LABELS } from "@/lib/format";

export function PublicToolList() {
  const tools = useQuery(api.tools.listPublic);

  if (tools === undefined) return <p className="text-sm text-stone-500">Loading tools…</p>;
  if (tools.length === 0) {
    return <div className="card text-sm text-stone-500">No tools listed yet. Be the first to lend one!</div>;
  }

  return (
    <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {tools.map((t) => (
        <li key={t._id} className="card flex items-center gap-3">
          <span className="text-2xl" aria-hidden>
            {CATEGORY_EMOJI[t.category]}
          </span>
          <div>
            <p className="font-medium">{t.name}</p>
            <p className="text-xs text-stone-500">{CATEGORY_LABELS[t.category]}</p>
          </div>
        </li>
      ))}
    </ul>
  );
}
