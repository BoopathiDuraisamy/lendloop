"use client";

import { api } from "@convex/_generated/api";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import type { FunctionArgs, FunctionReference, FunctionReturnType } from "convex/server";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

/**
 * Tracks whether the signed-in user's Convex session is ready (JWT accepted and
 * the user row upserted). The dashboard layout always renders its `children`
 * (so Next.js can prerender/validate every page); pages instead hold their
 * queries until the session is ready via `useSessionQuery`.
 */
type Status = "loading" | "unauthenticated" | "error" | "ready";

const SessionContext = createContext<Status>("loading");

export function DashboardSession({ children }: { children: ReactNode }) {
  const { isLoading, isAuthenticated } = useConvexAuth();
  const store = useMutation(api.users.store);
  const [stored, setStored] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!isAuthenticated) return;
    let cancelled = false;
    store()
      .then(() => !cancelled && setStored(true))
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, store]);

  const status: Status = failed
    ? "error"
    : isLoading
      ? "loading"
      : !isAuthenticated
        ? "unauthenticated"
        : stored
          ? "ready"
          : "loading";

  return <SessionContext.Provider value={status}>{children}</SessionContext.Provider>;
}

export function useSessionStatus() {
  return useContext(SessionContext);
}

/** `useQuery` that waits (returns undefined) until the dashboard session is ready. */
export function useSessionQuery<Q extends FunctionReference<"query">>(
  query: Q,
  ...args: FunctionArgs<Q> extends Record<string, never> ? [args?: FunctionArgs<Q>] : [args: FunctionArgs<Q>]
): FunctionReturnType<Q> | undefined {
  const ready = useSessionStatus() === "ready";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return useQuery(query as any, ready ? (args[0] ?? {}) : "skip");
}
