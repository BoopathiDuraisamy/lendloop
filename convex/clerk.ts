import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";

type ClerkEmail = { id: string; email_address: string; verification?: { status?: string } | null };
type ClerkUser = {
  first_name: string | null;
  last_name: string | null;
  username: string | null;
  primary_email_address_id: string | null;
  email_addresses: ClerkEmail[];
};

/**
 * Pull the user's display name and primary email from Clerk's Backend API.
 *
 * The default Clerk session token only carries the user id (`sub`), so name and
 * email are fetched server-to-server with CLERK_SECRET_KEY. This works the same
 * for Google, GitHub, or email/password sign-ups, and the "verified" flag comes
 * from Clerk, not from the client.
 */
export const syncProfile = internalAction({
  args: { userId: v.id("users"), clerkUserId: v.string() },
  handler: async (ctx, { userId, clerkUserId }) => {
    const secret = process.env.CLERK_SECRET_KEY;
    if (!secret) {
      console.warn("[clerk] CLERK_SECRET_KEY not set on the Convex deployment; can't sync profile");
      return;
    }
    if (!/^user_[A-Za-z0-9]+$/.test(clerkUserId)) return; // only real Clerk ids

    const res = await fetch(`https://api.clerk.com/v1/users/${clerkUserId}`, {
      headers: { authorization: `Bearer ${secret}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      console.error(`[clerk] profile fetch failed: ${res.status}`);
      return;
    }
    const u = (await res.json()) as ClerkUser;

    const primary =
      u.email_addresses.find((e) => e.id === u.primary_email_address_id) ?? u.email_addresses[0];
    const email = primary?.email_address?.toLowerCase();
    const emailVerified = primary?.verification?.status === "verified";
    const fullName = [u.first_name, u.last_name].filter(Boolean).join(" ").trim();
    const name = fullName || u.username || email?.split("@")[0] || "Neighbor";

    await ctx.runMutation(internal.users.applyProfile, { userId, name, email, emailVerified });
  },
});
