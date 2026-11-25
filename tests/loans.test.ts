import { afterEach, describe, expect, test, vi } from "vitest";
import { api } from "../convex/_generated/api";
import { code, day, makeLoan, makeTool, makeUser, setup } from "./helpers";

afterEach(() => vi.useRealTimers());

describe("requesting a tool", () => {
  test("creates a pending loan and queues exactly one 'requested' notification", async () => {
    const t = setup();
    const alice = await makeUser(t, "alice");
    const bob = await makeUser(t, "bob");
    const toolId = await makeTool(t, alice.id);

    const loanId = await bob.as.mutation(api.loans.request, { toolId, startDate: day(1), endDate: day(3) });
    const loan = await t.run((ctx) => ctx.db.get(loanId));
    expect(loan).toMatchObject({ status: "pending", ownerId: alice.id, borrowerId: bob.id });

    const events = await t.run((ctx) => ctx.db.query("automationEvents").collect());
    expect(events.map((e) => e.idempotencyKey)).toEqual([`notify:${loanId}:requested`]);
  });

  test("rejects invalid requests", async () => {
    const t = setup();
    const alice = await makeUser(t, "alice");
    const bob = await makeUser(t, "bob");
    const toolId = await makeTool(t, alice.id);
    const req = (startDate: string, endDate: string) =>
      bob.as.mutation(api.loans.request, { toolId, startDate, endDate });

    await expect(alice.as.mutation(api.loans.request, { toolId, startDate: day(1), endDate: day(2) })).rejects.toMatchObject(
      code("BAD_REQUEST"),
    ); // own tool
    await expect(req(day(-1), day(2))).rejects.toMatchObject(code("BAD_REQUEST")); // starts in the past
    await expect(req(day(5), day(2))).rejects.toMatchObject(code("BAD_REQUEST")); // ends before start
    await expect(req(day(1), day(40))).rejects.toMatchObject(code("BAD_REQUEST")); // > 30 days
    await expect(req("2030-02-30", day(2))).rejects.toMatchObject(code("BAD_REQUEST")); // not a real date

    await req(day(1), day(2));
    await expect(req(day(5), day(6))).rejects.toMatchObject(code("BAD_REQUEST")); // second pending request
  });

  test("can't request dates that overlap an approved booking", async () => {
    const t = setup();
    const alice = await makeUser(t, "alice");
    const bob = await makeUser(t, "bob");
    const carol = await makeUser(t, "carol");
    const toolId = await makeTool(t, alice.id);
    await makeLoan(t, toolId, alice.id, carol.id, 2, 5, "approved");

    await expect(bob.as.mutation(api.loans.request, { toolId, startDate: day(4), endDate: day(6) })).rejects.toMatchObject(
      code("BAD_REQUEST"),
    );
    await expect(bob.as.mutation(api.loans.request, { toolId, startDate: day(6), endDate: day(7) })).resolves.toBeDefined();
  });
});

describe("lender decisions", () => {
  test("approving auto-declines overlapping pending requests only", async () => {
    const t = setup();
    const alice = await makeUser(t, "alice");
    const bob = await makeUser(t, "bob");
    const carol = await makeUser(t, "carol");
    const dan = await makeUser(t, "dan");
    const toolId = await makeTool(t, alice.id);
    const bobs = await makeLoan(t, toolId, alice.id, bob.id, 1, 3, "pending");
    const overlapping = await makeLoan(t, toolId, alice.id, carol.id, 3, 4, "pending");
    const later = await makeLoan(t, toolId, alice.id, dan.id, 10, 11, "pending");

    await alice.as.mutation(api.loans.decide, { loanId: bobs, decision: "approved" });

    const status = async (id: typeof bobs) => (await t.run((ctx) => ctx.db.get(id)))?.status;
    expect(await status(bobs)).toBe("approved");
    expect(await status(overlapping)).toBe("declined");
    expect(await status(later)).toBe("pending");

    const keys = (await t.run((ctx) => ctx.db.query("automationEvents").collect())).map((e) => e.idempotencyKey).sort();
    expect(keys).toEqual([`notify:${bobs}:approved`, `notify:${overlapping}:declined`].sort());
  });

  test("a request can only be decided once", async () => {
    const t = setup();
    const alice = await makeUser(t, "alice");
    const bob = await makeUser(t, "bob");
    const toolId = await makeTool(t, alice.id);
    const loanId = await makeLoan(t, toolId, alice.id, bob.id, 1, 2, "pending");

    await alice.as.mutation(api.loans.decide, { loanId, decision: "declined" });
    await expect(alice.as.mutation(api.loans.decide, { loanId, decision: "approved" })).rejects.toMatchObject(
      code("BAD_REQUEST"),
    );
  });

  test("only active loans can be marked returned", async () => {
    const t = setup();
    const alice = await makeUser(t, "alice");
    const bob = await makeUser(t, "bob");
    const toolId = await makeTool(t, alice.id);
    const pending = await makeLoan(t, toolId, alice.id, bob.id, 1, 2, "pending");
    const active = await makeLoan(t, toolId, alice.id, bob.id, -3, -1, "approved");

    await expect(alice.as.mutation(api.loans.markReturned, { loanId: pending })).rejects.toMatchObject(code("BAD_REQUEST"));
    await alice.as.mutation(api.loans.markReturned, { loanId: active });
    const loan = await t.run((ctx) => ctx.db.get(active));
    expect(loan?.status).toBe("returned");
    expect(loan?.returnedAt).toBeDefined();
  });
});

describe("listings with loans", () => {
  test("owners can't delete a tool that is out on loan", async () => {
    const t = setup();
    const alice = await makeUser(t, "alice");
    const bob = await makeUser(t, "bob");
    const toolId = await makeTool(t, alice.id);
    await makeLoan(t, toolId, alice.id, bob.id, -1, 2, "approved");

    await expect(alice.as.mutation(api.tools.remove, { toolId })).rejects.toMatchObject(code("BAD_REQUEST"));
  });

  test("availability shows 'on loan' while an approved loan covers today", async () => {
    const t = setup();
    const alice = await makeUser(t, "alice");
    const bob = await makeUser(t, "bob");
    const toolId = await makeTool(t, alice.id);
    await makeLoan(t, toolId, alice.id, bob.id, -1, 2, "approved");
    await makeLoan(t, toolId, alice.id, bob.id, 10, 12, "approved");

    const [tool] = await bob.as.query(api.tools.list, {});
    expect(tool.availability).toMatchObject({
      status: "on_loan",
      availableFrom: day(2),
      bookings: [{ startDate: day(10), endDate: day(12) }],
    });
  });
});
