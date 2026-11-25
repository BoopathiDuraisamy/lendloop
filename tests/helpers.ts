import { convexTest } from "convex-test";
import { expect, vi } from "vitest";
import schema from "../convex/schema";
import { modules } from "../convex/test.setup";
import type { Id } from "../convex/_generated/dataModel";

/** Fixed "today" so date rules are deterministic: 2030-01-10 (UTC). */
export const TODAY = "2030-01-10";

export const day = (offset: number) =>
  new Date(Date.parse(`${TODAY}T00:00:00Z`) + offset * 86_400_000).toISOString().slice(0, 10);

/** Fresh in-memory backend with fake timers (scheduled n8n deliveries never run unless asked). */
export function setup() {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(`${TODAY}T12:00:00Z`));
  return convexTest(schema, modules);
}

export type T = ReturnType<typeof setup>;

/** Insert a user and return a client acting as them (identity keyed like Clerk's tokenIdentifier). */
export async function makeUser(t: T, key: string, role: "user" | "admin" = "user") {
  const tokenIdentifier = `test|${key}`;
  const id = await t.run((ctx) =>
    ctx.db.insert("users", { tokenIdentifier, name: key, email: `${key}@example.com`, role, trustedLender: false }),
  );
  return { id, as: t.withIdentity({ tokenIdentifier, subject: key, issuer: "test", name: key }) };
}

export async function makeTool(t: T, ownerId: Id<"users">, name = "Drill") {
  return t.run((ctx) =>
    ctx.db.insert("tools", { ownerId, name, category: "power_tools", condition: "good", description: "" }),
  );
}

export async function makeLoan(
  t: T,
  toolId: Id<"tools">,
  ownerId: Id<"users">,
  borrowerId: Id<"users">,
  start: number,
  end: number,
  status: "pending" | "approved" | "declined" | "cancelled" | "returned",
) {
  return t.run((ctx) =>
    ctx.db.insert("loans", {
      toolId,
      toolName: "Drill",
      ownerId,
      borrowerId,
      startDate: day(start),
      endDate: day(end),
      status,
      reminderCount: 0,
    }),
  );
}

/** Matcher for a ConvexError with a given code. */
export const code = (c: string) => ({ data: expect.objectContaining({ code: c }) });
