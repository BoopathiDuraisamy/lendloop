import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
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
 * Upsert the signed-in user, keyed by the verified JWT identity. Never takes
 * profile data from client arguments.
 *
 * Name/email: used from token claims when present; otherwise (Clerk's default
 * token only has the user id) they're fetched server-side from Clerk's Backend
 * API by `clerk.syncProfile`, which works for Google, GitHub and email sign-ups.
 *
 * Admin role is granted only for an email in ADMIN_EMAILS that is *verified*,
 * or via the CLI-only internal `setRole` mutation.
 */
export const store = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError({ code: "UNAUTHENTICATED", message: "Sign in required." });

    const tokenEmail = identity.email?.toLowerCase();
    const tokenName = identity.name ?? identity.givenName;
    const tokenAdmin = tokenEmail !== undefined && identity.emailVerified === true && adminEmails().has(tokenEmail);

    let userId = (await getCurrentUser(ctx))?._id;
    if (userId) {
      const existing = (await ctx.db.get(userId))!;
      const patch: Partial<typeof existing> = {};
      if (tokenName && existing.name !== tokenName) patch.name = tokenName;
      if (tokenEmail && existing.email !== tokenEmail) patch.email = tokenEmail;
      if (tokenAdmin && existing.role !== "admin") patch.role = "admin";
      if (Object.keys(patch).length) await ctx.db.patch(userId, patch);
    } else {
      userId = await ctx.db.insert("users", {
        tokenIdentifier: identity.tokenIdentifier,
        name: tokenName ?? tokenEmail?.split("@")[0] ?? "Neighbor",
        email: tokenEmail,
        role: tokenAdmin ? "admin" : "user",
        trustedLender: false,
      });
    }

    // Refresh name/email from Clerk (source of truth) in the background.
    await ctx.scheduler.runAfter(0, internal.clerk.syncProfile, { userId, clerkUserId: identity.subject });
    return userId;
  },
});

/** Called by clerk.syncProfile with data fetched server-side from Clerk. */
export const applyProfile = internalMutation({
  args: {
    userId: v.id("users"),
    name: v.string(),
    email: v.optional(v.string()),
    emailVerified: v.boolean(),
  },
  handler: async (ctx, { userId, name, email, emailVerified }) => {
    const user = await ctx.db.get(userId);
    if (!user) return;
    const patch: Partial<typeof user> = {};
    if (user.name !== name) patch.name = name.slice(0, 80);
    if (email && user.email !== email) patch.email = email;
    if (email && emailVerified && adminEmails().has(email) && user.role !== "admin") patch.role = "admin";
    if (Object.keys(patch).length) await ctx.db.patch(userId, patch);
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
    if (!target) throw new ConvexError({ code: "NOT_FOUND", message: "User not found." });
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
    if (!user) throw new ConvexError({ code: "NOT_FOUND", message: `No user with email ${email}. Sign in once first.` });
    await ctx.db.patch(user._id, { role });
    return user._id;
  },
});
