import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { mutation, query, type QueryCtx } from "./_generated/server";
import { badRequest, forbidden, getActiveTool, requireUser } from "./lib/auth";
import { todayUtc } from "./lib/dates";
import { enqueueNotification } from "./lib/notify";
import { categoryValidator, conditionValidator, LIMITS } from "./lib/validators";

const MAX_LIST = 300;

function cleanText(value: string, field: string, max: number, required = true) {
  const trimmed = value.trim();
  if (required && !trimmed) throw badRequest(`${field} is required.`);
  if (trimmed.length > max) throw badRequest(`${field} must be at most ${max} characters.`);
  return trimmed;
}

async function availability(ctx: QueryCtx, tool: Doc<"tools">) {
  const today = todayUtc();
  const approved = await ctx.db
    .query("loans")
    .withIndex("by_tool_status", (q) => q.eq("toolId", tool._id).eq("status", "approved"))
    .collect();
  const current = approved.find((l) => l.startDate <= today);
  const upcoming = approved
    .filter((l) => l.startDate > today)
    .sort((a, b) => a.startDate.localeCompare(b.startDate))
    .map((l) => ({ startDate: l.startDate, endDate: l.endDate }));
  return {
    status: current ? ("on_loan" as const) : ("available" as const),
    availableFrom: current ? current.endDate : undefined,
    bookings: upcoming,
  };
}

/**
 * PUBLIC (no auth): name + category only. No owner, description, or ids of people.
 */
export const listPublic = query({
  args: {},
  handler: async (ctx) => {
    const tools = await ctx.db
      .query("tools")
      .withIndex("by_removed", (q) => q.eq("removedAt", undefined))
      .order("desc")
      .take(MAX_LIST);
    return tools.map((t) => ({ _id: t._id, name: t.name, category: t.category }));
  },
});

/** Signed-in browse view with availability, filterable by category. */
export const list = query({
  args: { category: v.optional(categoryValidator) },
  handler: async (ctx, { category }) => {
    const me = await requireUser(ctx);
    const tools = await ctx.db
      .query("tools")
      .withIndex("by_removed", (q) => q.eq("removedAt", undefined))
      .order("desc")
      .take(MAX_LIST);
    const filtered = category ? tools.filter((t) => t.category === category) : tools;

    return await Promise.all(
      filtered.map(async (t) => {
        const owner = await ctx.db.get(t.ownerId);
        return {
          _id: t._id,
          name: t.name,
          category: t.category,
          condition: t.condition,
          description: t.description,
          isMine: t.ownerId === me._id,
          // Signed-in neighbors see a display name and trust badge, never contact details.
          ownerName: owner?.name ?? "Neighbor",
          ownerTrusted: owner?.trustedLender ?? false,
          availability: await availability(ctx, t),
        };
      }),
    );
  },
});

export const myListings = query({
  args: {},
  handler: async (ctx) => {
    const me = await requireUser(ctx);
    const tools = await ctx.db
      .query("tools")
      .withIndex("by_owner", (q) => q.eq("ownerId", me._id))
      .order("desc")
      .take(MAX_LIST);
    return await Promise.all(
      tools
        .filter((t) => t.removedAt === undefined)
        .map(async (t) => ({
          _id: t._id,
          name: t.name,
          category: t.category,
          condition: t.condition,
          description: t.description,
          availability: await availability(ctx, t),
        })),
    );
  },
});

const toolFields = {
  name: v.string(),
  category: categoryValidator,
  condition: conditionValidator,
  description: v.string(),
};

export const create = mutation({
  args: toolFields,
  handler: async (ctx, args) => {
    const me = await requireUser(ctx);
    return await ctx.db.insert("tools", {
      ownerId: me._id, // always the caller — never taken from args
      name: cleanText(args.name, "Name", LIMITS.nameMax),
      category: args.category,
      condition: args.condition,
      description: cleanText(args.description, "Description", LIMITS.descriptionMax, false),
    });
  },
});

export const update = mutation({
  args: { toolId: v.id("tools"), ...toolFields },
  handler: async (ctx, { toolId, ...args }) => {
    const me = await requireUser(ctx);
    const tool = await getActiveTool(ctx, toolId);
    if (tool.ownerId !== me._id) throw forbidden(); // admins remove, they don't edit others' listings
    await ctx.db.patch(toolId, {
      name: cleanText(args.name, "Name", LIMITS.nameMax),
      category: args.category,
      condition: args.condition,
      description: cleanText(args.description, "Description", LIMITS.descriptionMax, false),
    });
  },
});

/**
 * Owner deletes own listing, or admin removes any listing (moderation).
 * Pending requests are cancelled and borrowers notified. Owners cannot delete
 * while the tool is out on loan; admins can (the loan stays returnable).
 */
export const remove = mutation({
  args: { toolId: v.id("tools") },
  handler: async (ctx, { toolId }) => {
    const me = await requireUser(ctx);
    const tool = await getActiveTool(ctx, toolId);
    const isOwner = tool.ownerId === me._id;
    const isAdmin = me.role === "admin";
    if (!isOwner && !isAdmin) throw forbidden();

    const loans = await ctx.db
      .query("loans")
      .withIndex("by_tool", (q) => q.eq("toolId", toolId))
      .collect();
    if (!isAdmin && loans.some((l) => l.status === "approved")) {
      throw badRequest("This tool has an active or upcoming loan. Mark it returned or wait before deleting.");
    }

    await ctx.db.patch(toolId, { removedAt: Date.now(), removedBy: me._id });
    for (const loan of loans.filter((l) => l.status === "pending")) {
      await ctx.db.patch(loan._id, { status: "cancelled", decidedAt: Date.now() });
      await enqueueNotification(ctx, loan._id, "cancelled");
    }
  },
});
