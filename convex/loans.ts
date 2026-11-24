import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query, type QueryCtx } from "./_generated/server";
import {
  badRequest,
  forbidden,
  getActiveTool,
  getLoanOrThrow,
  requireAdmin,
  requireUser,
} from "./lib/auth";
import { daysBetween, isValidDate, rangesOverlap, todayUtc } from "./lib/dates";
import { enqueueNotification } from "./lib/notify";
import { LIMITS, loanStatusValidator } from "./lib/validators";

const MAX_LIST = 200;

async function approvedLoansFor(ctx: QueryCtx, toolId: Id<"tools">) {
  return await ctx.db
    .query("loans")
    .withIndex("by_tool_status", (q) => q.eq("toolId", toolId).eq("status", "approved"))
    .collect();
}

async function recentActivity(ctx: QueryCtx, loanId: Id<"loans">) {
  const events = await ctx.db
    .query("automationEvents")
    .withIndex("by_loan", (q) => q.eq("loanId", loanId))
    .order("desc")
    .take(5);
  return events.map((e) => ({
    kind: e.kind,
    status: e.status,
    detail: e.detail,
    at: e.updatedAt,
  }));
}

/** Shape a loan for a given viewer; only the counterpart's display name is exposed. */
async function present(ctx: QueryCtx, loan: Doc<"loans">, viewer: "owner" | "borrower" | "admin") {
  const today = todayUtc();
  const [owner, borrower] = await Promise.all([ctx.db.get(loan.ownerId), ctx.db.get(loan.borrowerId)]);
  return {
    _id: loan._id,
    _creationTime: loan._creationTime,
    toolId: loan.toolId,
    toolName: loan.toolName,
    startDate: loan.startDate,
    endDate: loan.endDate,
    message: loan.message,
    status: loan.status,
    overdue: loan.status === "approved" && loan.endDate < today,
    reminderCount: loan.reminderCount,
    lastReminderAt: loan.lastReminderAt,
    returnedAt: loan.returnedAt,
    ownerName: viewer !== "owner" ? (owner?.name ?? "Neighbor") : undefined,
    ownerTrusted: owner?.trustedLender ?? false,
    borrowerName: viewer !== "borrower" ? (borrower?.name ?? "Neighbor") : undefined,
    activity: await recentActivity(ctx, loan._id),
  };
}

// ---------------------------------------------------------------- queries

export const myRequests = query({
  args: {},
  handler: async (ctx) => {
    const me = await requireUser(ctx);
    const loans = await ctx.db
      .query("loans")
      .withIndex("by_borrower", (q) => q.eq("borrowerId", me._id))
      .order("desc")
      .take(MAX_LIST);
    return await Promise.all(loans.map((l) => present(ctx, l, "borrower")));
  },
});

export const incoming = query({
  args: {},
  handler: async (ctx) => {
    const me = await requireUser(ctx);
    const loans = await ctx.db
      .query("loans")
      .withIndex("by_owner", (q) => q.eq("ownerId", me._id))
      .order("desc")
      .take(MAX_LIST);
    return await Promise.all(loans.map((l) => present(ctx, l, "owner")));
  },
});

export const listAll = query({
  args: { status: v.optional(loanStatusValidator) },
  handler: async (ctx, { status }) => {
    await requireAdmin(ctx);
    const loans = await ctx.db.query("loans").order("desc").take(MAX_LIST);
    const filtered = status ? loans.filter((l) => l.status === status) : loans;
    return await Promise.all(filtered.map((l) => present(ctx, l, "admin")));
  },
});

// -------------------------------------------------------------- mutations

export const request = mutation({
  args: {
    toolId: v.id("tools"),
    startDate: v.string(),
    endDate: v.string(),
    message: v.optional(v.string()),
  },
  handler: async (ctx, { toolId, startDate, endDate, message }) => {
    const me = await requireUser(ctx);
    const tool = await getActiveTool(ctx, toolId);
    if (tool.ownerId === me._id) throw badRequest("You can't borrow your own tool.");

    if (!isValidDate(startDate) || !isValidDate(endDate)) throw badRequest("Dates must be YYYY-MM-DD.");
    if (startDate < todayUtc()) throw badRequest("Start date can't be in the past.");
    if (endDate < startDate) throw badRequest("End date must be on or after the start date.");
    if (daysBetween(startDate, endDate) + 1 > LIMITS.maxLoanDays) {
      throw badRequest(`Loans can be at most ${LIMITS.maxLoanDays} days.`);
    }
    const note = message?.trim();
    if (note && note.length > LIMITS.messageMax) {
      throw badRequest(`Message must be at most ${LIMITS.messageMax} characters.`);
    }

    const approved = await approvedLoansFor(ctx, toolId);
    if (approved.some((l) => rangesOverlap(startDate, endDate, l.startDate, l.endDate))) {
      throw badRequest("The tool is already booked for some of those dates.");
    }
    const mine = await ctx.db
      .query("loans")
      .withIndex("by_tool_status", (q) => q.eq("toolId", toolId).eq("status", "pending"))
      .collect();
    if (mine.some((l) => l.borrowerId === me._id)) {
      throw badRequest("You already have a pending request for this tool.");
    }

    const loanId = await ctx.db.insert("loans", {
      toolId,
      toolName: tool.name,
      ownerId: tool.ownerId,
      borrowerId: me._id,
      startDate,
      endDate,
      message: note || undefined,
      status: "pending",
      reminderCount: 0,
    });
    await enqueueNotification(ctx, loanId, "requested");
    return loanId;
  },
});

/** Owner approves or declines a pending request on their own tool. */
export const decide = mutation({
  args: { loanId: v.id("loans"), decision: v.union(v.literal("approved"), v.literal("declined")) },
  handler: async (ctx, { loanId, decision }) => {
    const me = await requireUser(ctx);
    const loan = await getLoanOrThrow(ctx, loanId);
    if (loan.ownerId !== me._id) throw forbidden();
    if (loan.status !== "pending") throw badRequest(`This request is already ${loan.status}.`);

    const now = Date.now();
    if (decision === "approved") {
      await getActiveTool(ctx, loan.toolId); // tool must still be listed
      const approved = await approvedLoansFor(ctx, loan.toolId);
      if (approved.some((l) => rangesOverlap(loan.startDate, loan.endDate, l.startDate, l.endDate))) {
        throw badRequest("Those dates overlap a loan you've already approved.");
      }
      await ctx.db.patch(loanId, { status: "approved", decidedAt: now });
      await enqueueNotification(ctx, loanId, "approved");

      // Auto-decline other pending requests that now conflict.
      const pending = await ctx.db
        .query("loans")
        .withIndex("by_tool_status", (q) => q.eq("toolId", loan.toolId).eq("status", "pending"))
        .collect();
      for (const other of pending) {
        if (rangesOverlap(loan.startDate, loan.endDate, other.startDate, other.endDate)) {
          await ctx.db.patch(other._id, { status: "declined", decidedAt: now });
          await enqueueNotification(ctx, other._id, "declined");
        }
      }
    } else {
      await ctx.db.patch(loanId, { status: "declined", decidedAt: now });
      await enqueueNotification(ctx, loanId, "declined");
    }
  },
});

/** Borrower withdraws their own pending request. */
export const cancel = mutation({
  args: { loanId: v.id("loans") },
  handler: async (ctx, { loanId }) => {
    const me = await requireUser(ctx);
    const loan = await getLoanOrThrow(ctx, loanId);
    if (loan.borrowerId !== me._id) throw forbidden();
    if (loan.status !== "pending") throw badRequest("Only pending requests can be cancelled.");
    await ctx.db.patch(loanId, { status: "cancelled", decidedAt: Date.now() });
    await enqueueNotification(ctx, loanId, "cancelled");
  },
});

/** Lender confirms the tool is back. (Only the lender can attest to this.) */
export const markReturned = mutation({
  args: { loanId: v.id("loans") },
  handler: async (ctx, { loanId }) => {
    const me = await requireUser(ctx);
    const loan = await getLoanOrThrow(ctx, loanId);
    if (loan.ownerId !== me._id) throw forbidden();
    if (loan.status !== "approved") throw badRequest("Only active loans can be marked returned.");
    await ctx.db.patch(loanId, { status: "returned", returnedAt: Date.now() });
    await enqueueNotification(ctx, loanId, "returned");
  },
});
