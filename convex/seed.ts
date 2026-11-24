import { internalMutation } from "./_generated/server";
import { todayUtc } from "./lib/dates";
import { enqueueNotification } from "./lib/notify";

const addDays = (iso: string, n: number) =>
  new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/**
 * Dev-only demo data (internal: callable from the CLI/dashboard, not clients):
 *   npx convex run seed:demo
 * Creates two demo neighbors, a few tools, a pending request and one overdue loan
 * so both n8n workflows have something to do.
 */
export const demo = internalMutation({
  args: {},
  handler: async (ctx) => {
    if (await ctx.db.query("tools").first()) return "Already seeded (tools exist).";

    const alice = await ctx.db.insert("users", {
      tokenIdentifier: "seed|alice",
      name: "Alice (demo)",
      email: "alice@example.com",
      role: "user",
      trustedLender: true,
    });
    const bob = await ctx.db.insert("users", {
      tokenIdentifier: "seed|bob",
      name: "Bob (demo)",
      email: "bob@example.com",
      role: "user",
      trustedLender: false,
    });

    const drill = await ctx.db.insert("tools", {
      ownerId: alice,
      name: "Cordless drill",
      category: "power_tools",
      condition: "good",
      description: "18V with two batteries and a bit set.",
    });
    const tent = await ctx.db.insert("tools", {
      ownerId: alice,
      name: "4-person tent",
      category: "camping",
      condition: "fair",
      description: "Easy setup, one small patch on the fly.",
    });
    await ctx.db.insert("tools", {
      ownerId: bob,
      name: "Hedge trimmer",
      category: "garden",
      condition: "new",
      description: "Electric, 50cm blade.",
    });
    await ctx.db.insert("tools", {
      ownerId: bob,
      name: "Stand mixer",
      category: "kitchen",
      condition: "good",
      description: "",
    });

    const today = todayUtc();
    await ctx.db.insert("loans", {
      toolId: drill,
      toolName: "Cordless drill",
      ownerId: alice,
      borrowerId: bob,
      startDate: addDays(today, -7),
      endDate: addDays(today, -2),
      status: "approved",
      decidedAt: Date.now(),
      reminderCount: 0,
    });
    const pending = await ctx.db.insert("loans", {
      toolId: tent,
      toolName: "4-person tent",
      ownerId: alice,
      borrowerId: bob,
      startDate: addDays(today, 3),
      endDate: addDays(today, 5),
      message: "Weekend trip to the lake!",
      status: "pending",
      reminderCount: 0,
    });
    await enqueueNotification(ctx, pending, "requested");
    return "Seeded demo users, tools, one pending request and one overdue loan.";
  },
});
