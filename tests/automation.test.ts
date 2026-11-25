import { afterEach, describe, expect, test, vi } from "vitest";
import { internal } from "../convex/_generated/api";
import { sign, verify } from "../convex/lib/hmac";
import { day, makeLoan, makeTool, makeUser, setup, type T } from "./helpers";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

async function overdueLoan(t: T) {
  const alice = await makeUser(t, "alice");
  const bob = await makeUser(t, "bob");
  const toolId = await makeTool(t, alice.id);
  const loanId = await makeLoan(t, toolId, alice.id, bob.id, -5, -2, "approved");
  return { loanId, reminderKey: `overdue:${loanId}:${day(0)}` };
}

describe("overdue reminder write-backs are idempotent", () => {
  test("a retried write-back is a no-op and counts the reminder once", async () => {
    const t = setup();
    const { loanId, reminderKey } = await overdueLoan(t);
    const args = { loanId, reminderKey, status: "sent" as const, channel: "email" };

    expect(await t.mutation(internal.automation.recordReminder, args)).toEqual({ ok: true, duplicate: false });
    expect(await t.mutation(internal.automation.recordReminder, args)).toEqual({ ok: true, duplicate: true });

    const events = await t.run((ctx) => ctx.db.query("automationEvents").collect());
    expect(events).toHaveLength(1);
    expect((await t.run((ctx) => ctx.db.get(loanId)))?.reminderCount).toBe(1);
  });

  test("extra channels are recorded on the same event without re-counting", async () => {
    const t = setup();
    const { loanId, reminderKey } = await overdueLoan(t);
    const base = { loanId, reminderKey };

    await t.mutation(internal.automation.recordReminder, { ...base, status: "failed", channel: "slack", detail: "not in workspace" });
    expect((await t.run((ctx) => ctx.db.get(loanId)))?.reminderCount).toBe(0); // nothing delivered yet

    await t.mutation(internal.automation.recordReminder, { ...base, status: "sent", channel: "email" });
    const [ev] = await t.run((ctx) => ctx.db.query("automationEvents").collect());
    expect(ev.status).toBe("sent");
    expect(ev.detail).toBe("Overdue reminder sent via email · slack failed: not in workspace");
    expect((await t.run((ctx) => ctx.db.get(loanId)))?.reminderCount).toBe(1);

    // A late failure can't downgrade a channel that already succeeded.
    expect(
      await t.mutation(internal.automation.recordReminder, { ...base, status: "failed", channel: "email", detail: "x" }),
    ).toEqual({ ok: true, duplicate: true });
  });

  test("a reminder key must belong to the loan", async () => {
    const t = setup();
    const { loanId } = await overdueLoan(t);
    const res = await t.mutation(internal.automation.recordReminder, {
      loanId,
      reminderKey: `overdue:someoneElse:${day(0)}`,
      status: "sent",
    });
    expect(res).toEqual({ ok: false, error: "reminderKey does not match loanId" });
  });

  test("loans already reminded today are left out of the overdue feed", async () => {
    const t = setup();
    const { loanId, reminderKey } = await overdueLoan(t);

    const before = await t.query(internal.automation.overdueLoans, {});
    expect(before.loans.map((l) => l.loanId)).toEqual([loanId]);
    expect(before.loans[0]).toMatchObject({ daysOverdue: 2, borrower: { name: "bob", email: "bob@example.com" } });

    await t.mutation(internal.automation.recordReminder, { loanId, reminderKey, status: "sent", channel: "email" });
    expect((await t.query(internal.automation.overdueLoans, {})).loans).toEqual([]);
  });
});

describe("notification write-backs", () => {
  test("per-channel results merge into one event; repeats are duplicates", async () => {
    const t = setup();
    const alice = await makeUser(t, "alice");
    const bob = await makeUser(t, "bob");
    const toolId = await makeTool(t, alice.id);
    const loanId = await makeLoan(t, toolId, alice.id, bob.id, 1, 2, "pending");
    const eventId = `notify:${loanId}:requested`;
    await t.run((ctx) =>
      ctx.db.insert("automationEvents", {
        loanId,
        kind: "request_notification",
        status: "pending",
        idempotencyKey: eventId,
        attempts: 1,
        updatedAt: Date.now(),
      }),
    );
    const confirm = (status: "sent" | "failed", channel: string, detail?: string) =>
      t.mutation(internal.automation.confirmNotification, { eventId, status, channel, detail });

    expect(await confirm("sent", "email")).toEqual({ ok: true, duplicate: false });
    expect(await confirm("failed", "discord", "boom")).toEqual({ ok: true, duplicate: false });
    expect(await confirm("sent", "email")).toEqual({ ok: true, duplicate: true });

    const [ev] = await t.run((ctx) => ctx.db.query("automationEvents").collect());
    expect(ev.status).toBe("sent");
    expect(ev.detail).toBe("Notification sent via email · discord failed: boom");
    expect(await t.mutation(internal.automation.confirmNotification, { eventId: "notify:nope", status: "sent" })).toEqual({
      ok: false,
      error: "unknown eventId",
    });
  });

  test("workflow error reports are recorded once per execution", async () => {
    const t = setup();
    const report = { executionId: "42", workflowName: "LendLoop – Request notifications", message: "boom" };
    expect(await t.mutation(internal.automation.recordWorkflowError, report)).toEqual({ ok: true, duplicate: false });
    expect(await t.mutation(internal.automation.recordWorkflowError, report)).toEqual({ ok: true, duplicate: true });
    expect(await t.run((ctx) => ctx.db.query("automationEvents").collect())).toHaveLength(1);
  });
});

describe("HMAC signing", () => {
  const SECRET = "test-secret";

  test("a signed payload verifies", async () => {
    const { timestamp, signature } = await sign(SECRET, '{"a":1}');
    expect(await verify(SECRET, '{"a":1}', timestamp, signature)).toEqual({ ok: true });
  });

  test("tampered payload, wrong secret, stale timestamp and missing headers are rejected", async () => {
    const { timestamp, signature } = await sign(SECRET, '{"a":1}');
    expect(await verify(SECRET, '{"a":2}', timestamp, signature)).toMatchObject({ ok: false });
    expect(await verify("other", '{"a":1}', timestamp, signature)).toMatchObject({ ok: false });
    expect(await verify(SECRET, '{"a":1}', null, signature)).toMatchObject({ ok: false });

    const old = await sign(SECRET, "{}", Math.floor(Date.now() / 1000) - 600);
    expect(await verify(SECRET, "{}", old.timestamp, old.signature)).toEqual({ ok: false, reason: "stale timestamp" });
  });
});

describe("signed HTTP endpoints for n8n", () => {
  const SECRET = "test-secret";

  async function call(t: T, path: string, obj: unknown, opts: { secret?: string; skew?: number } = {}) {
    const payload = JSON.stringify(obj);
    const { timestamp, signature } = await sign(
      opts.secret ?? SECRET,
      payload,
      Math.floor(Date.now() / 1000) + (opts.skew ?? 0),
    );
    return t.fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json", "x-lendloop-timestamp": timestamp, "x-lendloop-signature": signature },
      body: JSON.stringify({ payload }),
    });
  }

  test("only correctly signed, fresh requests are accepted", async () => {
    vi.stubEnv("N8N_WEBHOOK_SECRET", SECRET);
    const t = setup();
    await overdueLoan(t);

    const unsigned = await t.fetch("/n8n/overdue-loans", { method: "POST", body: JSON.stringify({ payload: "{}" }) });
    expect(unsigned.status).toBe(401);
    expect((await call(t, "/n8n/overdue-loans", {}, { secret: "wrong" })).status).toBe(401);
    expect((await call(t, "/n8n/overdue-loans", {}, { skew: -600 })).status).toBe(401);

    const ok = await call(t, "/n8n/overdue-loans", {});
    expect(ok.status).toBe(200);
    expect((await ok.json()).loans).toHaveLength(1);
  });

  test("signed reminder write-back over HTTP is idempotent", async () => {
    vi.stubEnv("N8N_WEBHOOK_SECRET", SECRET);
    const t = setup();
    const { loanId, reminderKey } = await overdueLoan(t);
    const body = { loanId, reminderKey, status: "sent", channel: "email" };

    expect(await (await call(t, "/n8n/reminder-status", body)).json()).toEqual({ ok: true, duplicate: false });
    expect(await (await call(t, "/n8n/reminder-status", body)).json()).toEqual({ ok: true, duplicate: true });
    expect((await call(t, "/n8n/reminder-status", { loanId })).status).toBe(400); // schema-checked
  });
});
