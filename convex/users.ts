import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import { getCurrentUser, requireAdmin } from "./lib/auth";

function adminEmails(): Set<string> {
  return new Set(
    (process.env.ADMIN_EMAILS ?? "")
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  );
}

/**
 * Upsert the signed-in user from the verified JWT identity. Name/email come
 * from the token, never from client arguments. Admin role is granted only via
 * the ADMIN_EMAILS deployment env var or the internal `setRole` mutation.
 */
export const store = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");

    const email = identity.email?.toLowerCase();
    const name = identity.name ?? identity.givenName ?? email?.split("@")[0] ?? "Neighbor";
    const shouldBeAdmin = email !== undefined && identity.emailVerified !== false && adminEmails().has(email);

    const existing = await getCurrentUser(ctx);
    if (existing) {
      const patch: Partial<typeof existing> = {};
      if (existing.name !== name) patch.name = name;
      if (existing.email !== email) patch.email = email;
      if (shouldBeAdmin && existing.role !== "admin") patch.role = "admin";
      if (Object.keys(patch).length) await ctx.db.patch(existing._id, patch);
      return existing._id;
    }
    return await ctx.db.insert("users", {
      tokenIdentifier: identity.tokenIdentifier,
      name,
      email,
      role: shouldBeAdmin ? "admin" : "user",
      trustedLender: false,
    });
  },
});

export const me = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (!user) return null;
    return {
      _id: user._id,
      name: user.name,
      role: user.role,
      trustedLender: user.trustedLender,
    };
  },
});

/** Admin: list members (minimal fields) for the Trusted Lender toggle. */
export const listForAdmin = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const users = await ctx.db.query("users").take(500);
    return users.map((u) => ({
      _id: u._id,
      name: u.name,
      email: u.email,
      role: u.role,
      trustedLender: u.trustedLender,
    }));
  },
});

export const setTrustedLender = mutation({
  args: { userId: v.id("users"), trusted: v.boolean() },
  handler: async (ctx, { userId, trusted }) => {
    await requireAdmin(ctx);
    const target = await ctx.db.get(userId);
    if (!target) throw new Error("User not found");
    await ctx.db.patch(userId, { trustedLender: trusted });
  },
});

/** CLI-only (not callable from clients): `npx convex run users:setRole '{"email":"a@b.c","role":"admin"}'` */
export const setRole = internalMutation({
  args: { email: v.string(), role: v.union(v.literal("admin"), v.literal("user")) },
  handler: async (ctx, { email, role }) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", email.toLowerCase()))
      .unique();
    if (!user) throw new Error(`No user with email ${email}. Sign in once first.`);
    await ctx.db.patch(user._id, { role });
    return user._id;
  },
});
