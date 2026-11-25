import type { Id } from "./_generated/dataModel";
import { internalMutation, type MutationCtx } from "./_generated/server";
import { todayUtc } from "./lib/dates";
import { enqueueNotification } from "./lib/notify";
import type { Category, Condition } from "./lib/validators";

const addDays = (iso: string, n: number) =>
  new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

type ToolSeed = [name: string, category: Category, condition: Condition, description: string];

const TOOLS: Record<"alice" | "bob" | "chen", ToolSeed[]> = {
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
};

/** Listings for signed-in users: each real account gets a different set (no duplicates on the board). */
const YOUR_TOOLS: ToolSeed[][] = [
  [
    ["Mitre saw", "power_tools", "good", "10 inch, great for trim and skirting."],
    ["Wheelbarrow", "garden", "fair", "Pneumatic tyre, a bit rusty."],
    ["Step ladder", "ladders", "good", "5 steps, aluminium."],
  ],
  [
    ["Tile cutter", "power_tools", "good", "Wet cutter, 600mm rail."],
    ["Leaf blower", "garden", "new", "Cordless, battery included."],
    ["Fondue set", "kitchen", "good", "Six forks, burner gel not included."],
  ],
  [
    ["Jigsaw", "power_tools", "fair", "Comes with wood and metal blades."],
    ["Hammock", "camping", "good", "Straps included, fits most trees."],
    ["Steam mop", "cleaning", "good", "Two spare pads."],
  ],
];

/**
 * What each signed-in account borrows from the demo neighbors. Each account uses
 * different demo tools so approved loans never overlap on the same tool.
 */
const YOUR_BORROWING = [
  { upcoming: ["chen", "Circular saw"], pending: ["bob", "Camping stove"], overdue: ["alice", "Pressure washer"], returned: ["chen", "Pasta machine"] },
  { upcoming: ["bob", "Hedge trimmer"], pending: ["chen", "Carpet cleaner"], overdue: ["alice", "Socket wrench set"], returned: ["bob", "Stand mixer"] },
] as const;

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

    // Include the real signed-in user(s), if any: own listings with incoming requests,
    // plus requests they made. Each account gets distinct tools and dates.
    const realUsers = (await ctx.db.query("users").collect())
      .filter((u) => !u.tokenIdentifier.startsWith("seed|"))
      .slice(0, YOUR_TOOLS.length);
    const neighbors = { alice: { id: alice, tools: a }, bob: { id: bob, tools: b }, chen: { id: chen, tools: c } };

    for (const [i, me] of realUsers.entries()) {
      const set = YOUR_TOOLS[i];
      const mine = await addTools(ctx, me._id, set);
      const [first, second, third] = set.map(([name]) => name);
      // Incoming: two pending requests on your tools, one active loan (on loan now).
      await loan(mine[first], first, me._id, bob, 2, 4, "pending", "Need it for a weekend project.");
      await loan(mine[second], second, me._id, chen, 1, 1, "pending", "Just for a day, I'll bring it right back.");
      await loan(mine[third], third, me._id, alice, -3, 3, "approved");

      // Your requests: approved upcoming, pending, overdue, and a returned one.
      const plan = YOUR_BORROWING[i];
      if (!plan) continue;
      const borrow = async (
        [who, tool]: readonly ["alice" | "bob" | "chen", string],
        start: number,
        end: number,
        status: "approved" | "pending" | "returned",
        msg?: string,
      ) => {
        const n = neighbors[who];
        await loan(n.tools[tool], tool, n.id, me._id, start, end, status, msg);
      };
      await borrow(plan.upcoming, 4, 6, "approved");
      await borrow(plan.pending, 10, 12, "pending", "Family weekend away.");
      await borrow(plan.overdue, -6, -1, "approved"); // overdue
      await borrow(plan.returned, -30, -28, "returned");
    }

    return `Seeded 3 demo neighbors, 12 tools and 5 loans${
      realUsers.length ? `, plus 3 tools and up to 7 loans for each of ${realUsers.length} signed-in user(s)` : ""
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
