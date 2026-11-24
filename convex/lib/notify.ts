import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

export type RequestEvent = "requested" | "approved" | "declined" | "cancelled" | "returned";

/**
 * Record an outbound notification and schedule delivery to n8n.
 *
 * Runs inside the same transaction as the status change, so the notification
 * is queued if and only if the change commits (transactional outbox). Each
 * (loan, event) pair happens at most once, which gives a natural idempotency key
 * that n8n also receives as `eventId`.
 */
export async function enqueueNotification(ctx: MutationCtx, loanId: Id<"loans">, event: RequestEvent) {
  const idempotencyKey = `notify:${loanId}:${event}`;
  const existing = await ctx.db
    .query("automationEvents")
    .withIndex("by_key", (q) => q.eq("idempotencyKey", idempotencyKey))
    .unique();
  if (existing) return existing._id;

  const eventDocId = await ctx.db.insert("automationEvents", {
    loanId,
    kind: "request_notification",
    status: "pending",
    idempotencyKey,
    attempts: 0,
    detail: `Queued "${event}" notification`,
    updatedAt: Date.now(),
  });
  await ctx.scheduler.runAfter(0, internal.n8n.deliverRequestEvent, { eventDocId, event, attempt: 1 });
  return eventDocId;
}
