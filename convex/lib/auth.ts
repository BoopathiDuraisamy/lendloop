import { ConvexError } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

/**
 * Authorization helpers. Every public query/mutation that touches private data
 * goes through one of these, so RBAC is enforced on the server regardless of UI.
 */

type Ctx = QueryCtx | MutationCtx;

export async function getCurrentUser(ctx: Ctx): Promise<Doc<"users"> | null> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return null;
  return await ctx.db
    .query("users")
    .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
    .unique();
}

export async function requireUser(ctx: Ctx): Promise<Doc<"users">> {
  const user = await getCurrentUser(ctx);
  if (!user) throw new ConvexError({ code: "UNAUTHENTICATED", message: "Sign in required." });
  return user;
}

export async function requireAdmin(ctx: Ctx): Promise<Doc<"users">> {
  const user = await requireUser(ctx);
  if (user.role !== "admin") throw forbidden();
  return user;
}

/** Returns an active (not removed) tool, or throws NOT_FOUND. */
export async function getActiveTool(ctx: Ctx, toolId: Id<"tools">): Promise<Doc<"tools">> {
  const tool = await ctx.db.get(toolId);
  if (!tool || tool.removedAt !== undefined) {
    throw new ConvexError({ code: "NOT_FOUND", message: "Tool not found." });
  }
  return tool;
}

export async function requireToolOwner(ctx: Ctx, toolId: Id<"tools">) {
  const user = await requireUser(ctx);
  const tool = await getActiveTool(ctx, toolId);
  if (tool.ownerId !== user._id) throw forbidden();
  return { user, tool };
}

export async function getLoanOrThrow(ctx: Ctx, loanId: Id<"loans">): Promise<Doc<"loans">> {
  const loan = await ctx.db.get(loanId);
  if (!loan) throw new ConvexError({ code: "NOT_FOUND", message: "Request not found." });
  return loan;
}

export function forbidden() {
  return new ConvexError({ code: "FORBIDDEN", message: "You are not allowed to do that." });
}

export function badRequest(message: string) {
  return new ConvexError({ code: "BAD_REQUEST", message });
}
