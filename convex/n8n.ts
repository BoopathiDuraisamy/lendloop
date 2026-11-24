import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";
import { sign, SIGNATURE_HEADER, TIMESTAMP_HEADER } from "./lib/hmac";

const MAX_ATTEMPTS = 5;
const REQUEST_TIMEOUT_MS = 10_000;

const eventValidator = v.union(
  v.literal("requested"),
  v.literal("approved"),
  v.literal("declined"),
  v.literal("cancelled"),
  v.literal("returned"),
);

/**
 * Deliver one request-status event to the n8n webhook.
 * Retries with exponential backoff (5s, 10s, 20s, 40s) on network errors,
 * 5xx and 429. Permanent failures are recorded and visible in the app.
 */
export const deliverRequestEvent = internalAction({
  args: { eventDocId: v.id("automationEvents"), event: eventValidator, attempt: v.number() },
  handler: async (ctx, { eventDocId, event, attempt }) => {
    const url = process.env.N8N_REQUEST_WEBHOOK_URL;
    const secret = process.env.N8N_WEBHOOK_SECRET;
    if (!url || !secret) {
      await ctx.runMutation(internal.automation.recordOutbound, {
        eventDocId,
        status: "skipped",
        attempts: attempt,
        detail: "n8n is not configured (N8N_REQUEST_WEBHOOK_URL / N8N_WEBHOOK_SECRET)",
      });
      return;
    }

    const payloadObj = await ctx.runQuery(internal.automation.notificationPayload, { eventDocId, event });
    if (!payloadObj) return; // loan vanished or event already finalized

    const payload = JSON.stringify(payloadObj);
    const { timestamp, signature } = await sign(secret, payload);

    let failure: string | null = null;
    let retryable = true;
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [TIMESTAMP_HEADER]: timestamp,
          [SIGNATURE_HEADER]: signature,
          "x-lendloop-event-id": payloadObj.eventId,
        },
        body: JSON.stringify({ payload }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!res.ok) {
        failure = `n8n responded ${res.status}`;
        retryable = res.status >= 500 || res.status === 429;
      }
    } catch (err) {
      failure = `network error: ${err instanceof Error ? err.message : String(err)}`;
    }

    if (!failure) {
      await ctx.runMutation(internal.automation.recordOutbound, {
        eventDocId,
        status: "pending",
        attempts: attempt,
        detail: "Accepted by n8n, awaiting delivery confirmation",
      });
      return;
    }

    const willRetry = retryable && attempt < MAX_ATTEMPTS;
    await ctx.runMutation(internal.automation.recordOutbound, {
      eventDocId,
      status: willRetry ? "pending" : "failed",
      attempts: attempt,
      detail: willRetry ? `Attempt ${attempt} failed (${failure}); retrying` : `Delivery failed: ${failure}`,
    });
    if (willRetry) {
      const delayMs = 5_000 * 2 ** (attempt - 1);
      await ctx.scheduler.runAfter(delayMs, internal.n8n.deliverRequestEvent, {
        eventDocId,
        event,
        attempt: attempt + 1,
      });
    } else {
      console.error(`[n8n] notification ${eventDocId} permanently failed: ${failure}`);
    }
  },
});
