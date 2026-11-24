import type { Id } from "./_generated/dataModel";
import { internalMutation, type MutationCtx } from "./_generated/server";
import { todayUtc } from "./lib/dates";
import { enqueueNotification } from "./lib/notify";
import type { Category, Condition } from "./lib/validators";

const addDays = (iso: string, n: number) =>
  new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

type ToolSeed = [name: string, category: Category, condition: Condition, description: string];

const TOOLS: Record<"alice" | "bob" | "chen" | "you", ToolSeed[]> = {
  alice: [
    ["Cordless drill", "power_tools", "good", "18V with two batteries and a bit set."],
    ["4-person tent", "camping", "fair", "Easy setup, one small patch on the fly."],
    ["Pressure washer", "cleaning", "good", "1800 PSI, includes patio cleaner attachment."],
    ["Socket wrench set", "hand_tools", "new", "Metric + imperial, 40 pieces."],
  ],
  bob: [
    ["Hedge trimmer", "garden", "new", "Electric, 50cm blade."],
    ["Stand mixer", "kitchen", "good", "5L bowl, dough hook and whisk."],
    ["Extension ladder", "ladders", "fair", "Extends to 6m. Needs two people to carry."],
    ["Camping stove", "camping", "good", "Two burners, bring your own gas canister."],
  ],
  chen: [
    ["Circular saw", "power_tools", "good", "7¼ inch blade, with guide rail."],
    ["Lawn mower", "garden", "worn", "Petrol, starts on the third pull."],
    ["Pasta machine", "kitchen", "new", "Hand-crank, three cutter widths."],
    ["Carpet cleaner", "cleaning", "good", "Bring your own detergent."],
  ],
  you: [
    ["Mitre saw", "power_tools", "good", "10 inch, great for trim and skirting."],
    ["Wheelbarrow", "garden", "fair", "Pneumatic tyre, a bit rusty."],
    ["Step ladder", "ladders", "good", "5 steps, aluminium."],
  ],
};

async function upsertDemoUser(ctx: MutationCtx, key: string, name: string, email: string, trusted: boolean) {
  const tokenIdentifier = `seed|${key}`;
  const existing = await ctx.db
    .query("users")
    .withIndex("by_token", (q) => q.eq("tokenIdentifier", tokenIdentifier))
    .unique();
  if (existing) return existing._id;
  return await ctx.db.insert("users", { tokenIdentifier, name, email, role: "user", trustedLender: trusted });
}

async function addTools(ctx: MutationCtx, ownerId: Id<"users">, seeds: ToolSeed[]) {
  const ids: Record<string, Id<"tools">> = {};
  for (const [name, category, condition, description] of seeds) {
    ids[name] = await ctx.db.insert("tools", { ownerId, name, category, condition, description });
  }
  return ids;
}

/**
 * Dev-only demo data (internal: CLI/dashboard only, not callable by clients):
 *   npx convex run seed:demo
 *
 * Creates three demo neighbors with tools and loans in every state. If a real
 * (signed-in) user exists, they get their own listings plus incoming requests,
 * an approved upcoming loan, and an overdue loan, so every page has data.
 */
export const demo = internalMutation({
  args: {},
  handler: async (ctx) => {
    const seeded = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", "seed|alice"))
      .unique();
    if (seeded) return "Already seeded. Run seed:reset first to start over.";

    const today = todayUtc();
    const alice = await upsertDemoUser(ctx, "alice", "Alice (demo)", "alice@example.com", true);
    const bob = await upsertDemoUser(ctx, "bob", "Bob (demo)", "bob@example.com", false);
    const chen = await upsertDemoUser(ctx, "chen", "Chen (demo)", "chen@example.com", false);

    const a = await addTools(ctx, alice, TOOLS.alice);
    const b = await addTools(ctx, bob, TOOLS.bob);
    const c = await addTools(ctx, chen, TOOLS.chen);

    const loan = async (
      toolId: Id<"tools">,
      toolName: string,
      ownerId: Id<"users">,
      borrowerId: Id<"users">,
      startOffset: number,
      endOffset: number,
      status: "pending" | "approved" | "declined" | "cancelled" | "returned",
      message?: string,
    ) => {
      const id = await ctx.db.insert("loans", {
        toolId,
        toolName,
        ownerId,
        borrowerId,
        startDate: addDays(today, startOffset),
        endDate: addDays(today, endOffset),
        message,
        status,
        decidedAt: status === "pending" ? undefined : Date.now(),
        returnedAt: status === "returned" ? Date.now() : undefined,
        reminderCount: 0,
      });
      if (status === "pending") await enqueueNotification(ctx, id, "requested");
      return id;
    };

    // Demo-to-demo loans (visible to admins under "All loans").
    await loan(a["Cordless drill"], "Cordless drill", alice, bob, -7, -2, "approved"); // overdue
    await loan(a["4-person tent"], "4-person tent", alice, bob, 3, 5, "pending", "Weekend trip to the lake!");
    await loan(b["Extension ladder"], "Extension ladder", bob, chen, -1, 2, "approved"); // on loan now
    await loan(c["Lawn mower"], "Lawn mower", chen, alice, -20, -15, "returned");
    await loan(b["Stand mixer"], "Stand mixer", bob, alice, 6, 7, "declined");

    // Include the real signed-in user(s), if any.
    const realUsers = (await ctx.db.query("users").collect()).filter((u) => !u.tokenIdentifier.startsWith("seed|"));
    for (const me of realUsers) {
      const mine = await addTools(ctx, me._id, TOOLS.you);
      // Incoming: two pending requests on your tools, one active loan (on loan now).
      await loan(mine["Mitre saw"], "Mitre saw", me._id, bob, 2, 4, "pending", "Putting up new skirting boards.");
      await loan(mine["Wheelbarrow"], "Wheelbarrow", me._id, chen, 1, 1, "pending", "Moving some gravel, just for a day.");
      await loan(mine["Step ladder"], "Step ladder", me._id, alice, -3, 3, "approved");
      // Your requests: approved upcoming, pending, overdue, and a returned one.
      await loan(c["Circular saw"], "Circular saw", chen, me._id, 4, 6, "approved");
      await loan(b["Camping stove"], "Camping stove", bob, me._id, 10, 12, "pending", "Family camping weekend.");
      await loan(a["Pressure washer"], "Pressure washer", alice, me._id, -6, -1, "approved"); // overdue
      await loan(c["Pasta machine"], "Pasta machine", chen, me._id, -30, -28, "returned");
    }

    return `Seeded 3 demo neighbors, 12 tools and 5 loans${
      realUsers.length ? `, plus 3 tools and 7 loans for ${realUsers.length} signed-in user(s)` : ""
    }.`;
  },
});

/** Remove all demo data (demo users, all tools, loans and automation events). Dev only. */
export const reset = internalMutation({
  args: {},
  handler: async (ctx) => {
    for (const table of ["automationEvents", "loans", "tools"] as const) {
      for (const doc of await ctx.db.query(table).collect()) await ctx.db.delete(doc._id);
    }
    for (const u of await ctx.db.query("users").collect()) {
      if (u.tokenIdentifier.startsWith("seed|")) await ctx.db.delete(u._id);
    }
    return "Cleared tools, loans, automation events and demo users (real users kept).";
  },
});
