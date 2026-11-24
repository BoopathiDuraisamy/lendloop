import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { internalMutation, internalQuery, query } from "./_generated/server";
import { requireAdmin } from "./lib/auth";
import { daysBetween, todayUtc } from "./lib/dates";

const MAX_DETAIL = 300;
const clip = (s: string | undefined) => (s ? s.slice(0, MAX_DETAIL) : undefined);

// ------------------------------------------------ outbound (Convex -> n8n)

/**
 * Build the *minimal* payload n8n needs to notify one person: who to tell,
 * which tool, which dates, what happened. No ids of other users, no messages,
 * no descriptions.
 */
export const notificationPayload = internalQuery({
  args: {
    eventDocId: v.id("automationEvents"),
    event: v.union(
      v.literal("requested"),
      v.literal("approved"),
      v.literal("declined"),
      v.literal("cancelled"),
      v.literal("returned"),
    ),
  },
  handler: async (ctx, { eventDocId, event }) => {
    const ev = await ctx.db.get(eventDocId);
    if (!ev || !ev.loanId || ev.status === "sent") return null;
    const loan = await ctx.db.get(ev.loanId);
    if (!loan) return null;

    // Lender hears about new/cancelled requests; borrower hears about decisions/returns.
    const notifyLender = event === "requested" || event === "cancelled";
    const recipient = await ctx.db.get(notifyLender ? loan.ownerId : loan.borrowerId);
    if (!recipient) return null;

    const appUrl = process.env.APP_URL ?? "http://localhost:3000";
    return {
      eventId: ev.idempotencyKey,
      event,
      occurredAt: new Date().toISOString(),
      recipient: {
        role: notifyLender ? ("lender" as const) : ("borrower" as const),
        name: recipient.name,
        email: recipient.email ?? null,
      },
      loan: {
        toolName: loan.toolName,
        startDate: loan.startDate,
        endDate: loan.endDate,
        status: loan.status,
      },
      link: `${appUrl}/dashboard/${notifyLender ? "incoming" : "requests"}`,
    };
  },
});

export const recordOutbound = internalMutation({
  args: {
    eventDocId: v.id("automationEvents"),
    status: v.union(v.literal("pending"), v.literal("failed"), v.literal("skipped")),
    attempts: v.number(),
    detail: v.string(),
  },
  handler: async (ctx, { eventDocId, status, attempts, detail }) => {
    const ev = await ctx.db.get(eventDocId);
    if (!ev) return;
    // n8n's confirmation may land before this bookkeeping; never downgrade "sent".
    if (ev.status === "sent") {
      await ctx.db.patch(eventDocId, { attempts });
      return;
    }
    await ctx.db.patch(eventDocId, { status, attempts, detail: clip(detail), updatedAt: Date.now() });
  },
});

// ------------------------------------------------ inbound (n8n -> Convex)

type WriteBackResult = { ok: true; duplicate: boolean } | { ok: false; error: string };

/** n8n confirms a request notification was delivered (or not). Idempotent on eventId. */
export const confirmNotification = internalMutation({
  args: {
    eventId: v.string(),
    status: v.union(v.literal("sent"), v.literal("failed")),
    channel: v.optional(v.string()),
    detail: v.optional(v.string()),
  },
  handler: async (ctx, { eventId, status, channel, detail }): Promise<WriteBackResult> => {
    const ev = await ctx.db
      .query("automationEvents")
      .withIndex("by_key", (q) => q.eq("idempotencyKey", eventId))
      .unique();
    if (!ev || ev.kind !== "request_notification") return { ok: false, error: "unknown eventId" };
    if (ev.status === "sent") return { ok: true, duplicate: true }; // terminal
    if (ev.status === status && status === "failed") return { ok: true, duplicate: true };
    await ctx.db.patch(ev._id, {
      status,
      detail: clip(
        status === "sent" ? `Notification sent${channel ? ` via ${channel}` : ""}` : `Notification failed: ${detail ?? "unknown"}`,
      ),
      updatedAt: Date.now(),
    });
    return { ok: true, duplicate: false };
  },
});

/** Approved loans whose end date has passed and that haven't been reminded today. */
export const overdueLoans = internalQuery({
  args: {},
  handler: async (ctx) => {
    const today = todayUtc();
    const loans = await ctx.db
      .query("loans")
      .withIndex("by_status_end", (q) => q.eq("status", "approved").lt("endDate", today))
      .take(500);

    const result = [];
    for (const loan of loans) {
      const reminderKey = `overdue:${loan._id}:${today}`;
      const done = await ctx.db
        .query("automationEvents")
        .withIndex("by_key", (q) => q.eq("idempotencyKey", reminderKey))
        .unique();
      if (done?.status === "sent") continue;
      const borrower = await ctx.db.get(loan.borrowerId);
      if (!borrower) continue;
      result.push({
        loanId: loan._id,
        reminderKey,
        toolName: loan.toolName,
        endDate: loan.endDate,
        daysOverdue: daysBetween(loan.endDate, today),
        borrower: { name: borrower.name, email: borrower.email ?? null },
      });
    }
    return { asOf: today, loans: result };
  },
});

/**
 * n8n writes back the outcome of one overdue reminder. Idempotent on reminderKey
 * (one per loan per day): retries never double-count or create duplicate rows.
 */
export const recordReminder = internalMutation({
  args: {
    loanId: v.string(),
    reminderKey: v.string(),
    status: v.union(v.literal("sent"), v.literal("failed")),
    channel: v.optional(v.string()),
    detail: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<WriteBackResult> => {
    const loanId = ctx.db.normalizeId("loans", args.loanId);
    if (!loanId) return { ok: false, error: "unknown loanId" };
    if (!/^overdue:[^:]+:\d{4}-\d{2}-\d{2}$/.test(args.reminderKey) || !args.reminderKey.startsWith(`overdue:${loanId}:`)) {
      return { ok: false, error: "reminderKey does not match loanId" };
    }
    const loan = await ctx.db.get(loanId);
    if (!loan) return { ok: false, error: "unknown loanId" };

    const now = Date.now();
    const detail = clip(
      args.status === "sent"
        ? `Overdue reminder sent${args.channel ? ` via ${args.channel}` : ""}`
        : `Overdue reminder failed: ${args.detail ?? "unknown"}`,
    );
    const existing = await ctx.db
      .query("automationEvents")
      .withIndex("by_key", (q) => q.eq("idempotencyKey", args.reminderKey))
      .unique();

    if (existing) {
      if (existing.status === "sent" || existing.status === args.status) return { ok: true, duplicate: true };
      await ctx.db.patch(existing._id, {
        status: args.status,
        attempts: existing.attempts + 1,
        detail,
        updatedAt: now,
      });
    } else {
      await ctx.db.insert("automationEvents", {
        loanId,
        kind: "overdue_reminder",
        status: args.status,
        idempotencyKey: args.reminderKey,
        attempts: 1,
        detail,
        updatedAt: now,
      });
    }
    if (args.status === "sent") {
      await ctx.db.patch(loanId, { reminderCount: loan.reminderCount + 1, lastReminderAt: now });
    }
    return { ok: true, duplicate: false };
  },
});

/** n8n error workflow reports a failed execution so it is visible in the admin view. */
export const recordWorkflowError = internalMutation({
  args: {
    executionId: v.string(),
    workflowName: v.string(),
    nodeName: v.optional(v.string()),
    message: v.string(),
    loanId: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<WriteBackResult> => {
    const idempotencyKey = `n8n-error:${args.executionId}`;
    const existing = await ctx.db
      .query("automationEvents")
      .withIndex("by_key", (q) => q.eq("idempotencyKey", idempotencyKey))
      .unique();
    if (existing) return { ok: true, duplicate: true };
    const loanId: Id<"loans"> | null = args.loanId ? ctx.db.normalizeId("loans", args.loanId) : null;
    await ctx.db.insert("automationEvents", {
      loanId: loanId ?? undefined,
      kind: "workflow_error",
      status: "failed",
      idempotencyKey,
      attempts: 1,
      detail: clip(`${args.workflowName}${args.nodeName ? ` › ${args.nodeName}` : ""}: ${args.message}`),
      updatedAt: Date.now(),
    });
    return { ok: true, duplicate: false };
  },
});

// ------------------------------------------------ admin visibility

export const recentFailures = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const failed = await ctx.db
      .query("automationEvents")
      .withIndex("by_status", (q) => q.eq("status", "failed"))
      .order("desc")
      .take(50);
    return failed.map((e) => ({
      _id: e._id,
      kind: e.kind,
      detail: e.detail,
      attempts: e.attempts,
      at: e.updatedAt,
    }));
  },
});
