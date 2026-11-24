import { httpRouter } from "convex/server";
import { internal } from "./_generated/api";
import { httpAction, type ActionCtx } from "./_generated/server";
import { SIGNATURE_HEADER, TIMESTAMP_HEADER, verify } from "./lib/hmac";

/**
 * Endpoints called by n8n. Every request must carry a valid HMAC signature
 * (see lib/hmac.ts). Bodies are size-capped and schema-checked before touching
 * the database; write-backs are idempotent so n8n retries are safe.
 */

const MAX_BODY_BYTES = 16 * 1024;

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

type Handler = (ctx: ActionCtx, payload: Record<string, unknown>) => Promise<Response>;

function signed(handler: Handler) {
  return httpAction(async (ctx, request) => {
    const secret = process.env.N8N_WEBHOOK_SECRET;
    if (!secret) return json(503, { error: "integration not configured" });

    const raw = await request.text();
    if (raw.length > MAX_BODY_BYTES) return json(413, { error: "payload too large" });

    let payload: string;
    try {
      const envelope = JSON.parse(raw) as { payload?: unknown };
      if (typeof envelope.payload !== "string") throw new Error();
      payload = envelope.payload;
    } catch {
      return json(400, { error: "expected {\"payload\": \"<json string>\"}" });
    }

    const check = await verify(
      secret,
      payload,
      request.headers.get(TIMESTAMP_HEADER),
      request.headers.get(SIGNATURE_HEADER),
    );
    if (!check.ok) {
      console.warn(`[n8n] rejected ${new URL(request.url).pathname}: ${check.reason}`);
      return json(401, { error: "invalid signature" }); // don't leak which check failed
    }

    let data: unknown;
    try {
      data = JSON.parse(payload);
    } catch {
      return json(400, { error: "payload is not JSON" });
    }
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      return json(400, { error: "payload must be an object" });
    }
    return handler(ctx, data as Record<string, unknown>);
  });
}

const str = (v: unknown, max = 200) => (typeof v === "string" && v.length > 0 && v.length <= max ? v : undefined);
const optStr = (v: unknown, max = 300) => (typeof v === "string" ? v.slice(0, max) : undefined);
const outcome = (v: unknown) => (v === "sent" || v === "failed" ? v : undefined);

const http = httpRouter();

http.route({
  path: "/n8n/overdue-loans",
  method: "POST",
  handler: signed(async (ctx) => {
    const result = await ctx.runQuery(internal.automation.overdueLoans, {});
    return json(200, result);
  }),
});

http.route({
  path: "/n8n/reminder-status",
  method: "POST",
  handler: signed(async (ctx, p) => {
    const loanId = str(p.loanId, 64);
    const reminderKey = str(p.reminderKey, 120);
    const status = outcome(p.status);
    if (!loanId || !reminderKey || !status) return json(400, { error: "loanId, reminderKey, status required" });
    const res = await ctx.runMutation(internal.automation.recordReminder, {
      loanId,
      reminderKey,
      status,
      channel: optStr(p.channel, 40),
      detail: optStr(p.detail),
    });
    return json(res.ok ? 200 : 404, res);
  }),
});

http.route({
  path: "/n8n/notification-status",
  method: "POST",
  handler: signed(async (ctx, p) => {
    const eventId = str(p.eventId, 120);
    const status = outcome(p.status);
    if (!eventId || !status) return json(400, { error: "eventId, status required" });
    const res = await ctx.runMutation(internal.automation.confirmNotification, {
      eventId,
      status,
      channel: optStr(p.channel, 40),
      detail: optStr(p.detail),
    });
    return json(res.ok ? 200 : 404, res);
  }),
});

http.route({
  path: "/n8n/workflow-error",
  method: "POST",
  handler: signed(async (ctx, p) => {
    const executionId = str(p.executionId, 64);
    const workflowName = str(p.workflowName, 120);
    const message = str(p.message, 1000);
    if (!executionId || !workflowName || !message) {
      return json(400, { error: "executionId, workflowName, message required" });
    }
    const res = await ctx.runMutation(internal.automation.recordWorkflowError, {
      executionId,
      workflowName,
      message,
      nodeName: optStr(p.nodeName, 120),
      loanId: str(p.loanId, 64),
    });
    return json(200, res);
  }),
});

export default http;
