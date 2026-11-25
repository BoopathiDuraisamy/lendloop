import { afterEach, describe, expect, test, vi } from "vitest";
import { api } from "../convex/_generated/api";
import { code, makeLoan, makeTool, makeUser, setup } from "./helpers";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("public data minimization", () => {
  test("public tool list exposes only id, name and category", async () => {
    const t = setup();
    const alice = await makeUser(t, "alice");
    await makeTool(t, alice.id, "Ladder");

    const list = await t.query(api.tools.listPublic, {});
    expect(list).toHaveLength(1);
    expect(Object.keys(list[0]).sort()).toEqual(["_id", "category", "name"]);
  });

  test("signed-in views never include other users' emails", async () => {
    const t = setup();
    const alice = await makeUser(t, "alice");
    const bob = await makeUser(t, "bob");
    await makeTool(t, alice.id);

    const tools = await bob.as.query(api.tools.list, {});
    expect(JSON.stringify(tools)).not.toContain("alice@example.com");
    expect(tools[0].ownerName).toBe("alice");
  });
});

describe("authentication", () => {
  test("signed-out callers are rejected", async () => {
    const t = setup();
    await expect(t.query(api.tools.list, {})).rejects.toMatchObject(code("UNAUTHENTICATED"));
    await expect(t.query(api.loans.myRequests, {})).rejects.toMatchObject(code("UNAUTHENTICATED"));
  });
});

describe("ownership is enforced server-side", () => {
  test("users can't edit or delete someone else's listing", async () => {
    const t = setup();
    const alice = await makeUser(t, "alice");
    const bob = await makeUser(t, "bob");
    const toolId = await makeTool(t, alice.id);

    await expect(
      bob.as.mutation(api.tools.update, {
        toolId,
        name: "Mine now",
        category: "garden",
        condition: "new",
        description: "",
      }),
    ).rejects.toMatchObject(code("FORBIDDEN"));
    await expect(bob.as.mutation(api.tools.remove, { toolId })).rejects.toMatchObject(code("FORBIDDEN"));
  });

  test("only the lender can decide or mark returned; only the borrower can cancel", async () => {
    const t = setup();
    const alice = await makeUser(t, "alice");
    const bob = await makeUser(t, "bob");
    const carol = await makeUser(t, "carol");
    const toolId = await makeTool(t, alice.id);
    const pending = await makeLoan(t, toolId, alice.id, bob.id, 1, 2, "pending");
    const active = await makeLoan(t, toolId, alice.id, bob.id, -3, -1, "approved");

    await expect(bob.as.mutation(api.loans.decide, { loanId: pending, decision: "approved" })).rejects.toMatchObject(
      code("FORBIDDEN"),
    );
    await expect(carol.as.mutation(api.loans.cancel, { loanId: pending })).rejects.toMatchObject(code("FORBIDDEN"));
    await expect(bob.as.mutation(api.loans.markReturned, { loanId: active })).rejects.toMatchObject(code("FORBIDDEN"));
  });
});

describe("admin-only functions", () => {
  test("non-admins get FORBIDDEN; admins succeed", async () => {
    const t = setup();
    const admin = await makeUser(t, "admin", "admin");
    const bob = await makeUser(t, "bob");

    for (const call of [
      () => bob.as.query(api.loans.listAll, {}),
      () => bob.as.query(api.users.listForAdmin, {}),
      () => bob.as.query(api.automation.recentFailures, {}),
      () => bob.as.mutation(api.users.setTrustedLender, { userId: bob.id, trusted: true }),
    ]) {
      await expect(call()).rejects.toMatchObject(code("FORBIDDEN"));
    }
    await expect(admin.as.query(api.loans.listAll, {})).resolves.toEqual([]);
    await admin.as.mutation(api.users.setTrustedLender, { userId: bob.id, trusted: true });
    expect((await t.run((ctx) => ctx.db.get(bob.id)))?.trustedLender).toBe(true);
  });

  test("admins can remove any listing; pending requests are cancelled", async () => {
    const t = setup();
    const admin = await makeUser(t, "admin", "admin");
    const alice = await makeUser(t, "alice");
    const bob = await makeUser(t, "bob");
    const toolId = await makeTool(t, alice.id);
    const pending = await makeLoan(t, toolId, alice.id, bob.id, 1, 2, "pending");

    await admin.as.mutation(api.tools.remove, { toolId });
    expect((await t.run((ctx) => ctx.db.get(toolId)))?.removedAt).toBeDefined();
    expect((await t.run((ctx) => ctx.db.get(pending)))?.status).toBe("cancelled");
    expect(await t.query(api.tools.listPublic, {})).toEqual([]);
  });
});

describe("granting admin", () => {
  test("non-admins can't grant admin, not even to themselves", async () => {
    const t = setup();
    const bob = await makeUser(t, "bob");
    await expect(bob.as.mutation(api.users.setAdmin, { userId: bob.id, admin: true })).rejects.toMatchObject(
      code("FORBIDDEN"),
    );
  });

  test("admins can't change their own role, so at least one admin always remains", async () => {
    const t = setup();
    const admin = await makeUser(t, "admin", "admin");
    await expect(admin.as.mutation(api.users.setAdmin, { userId: admin.id, admin: false })).rejects.toMatchObject(
      code("BAD_REQUEST"),
    );
    expect((await t.run((ctx) => ctx.db.get(admin.id)))?.role).toBe("admin");
  });

  test("admins can promote and demote others, except allow-listed admins", async () => {
    vi.stubEnv("ADMIN_EMAILS", "pinned@example.com");
    const t = setup();
    const admin = await makeUser(t, "admin", "admin");
    const bob = await makeUser(t, "bob");
    const pinned = await makeUser(t, "pinned", "admin");

    await admin.as.mutation(api.users.setAdmin, { userId: bob.id, admin: true });
    expect((await t.run((ctx) => ctx.db.get(bob.id)))?.role).toBe("admin");
    await admin.as.mutation(api.users.setAdmin, { userId: bob.id, admin: false });
    expect((await t.run((ctx) => ctx.db.get(bob.id)))?.role).toBe("user");

    await expect(admin.as.mutation(api.users.setAdmin, { userId: pinned.id, admin: false })).rejects.toMatchObject(
      code("BAD_REQUEST"),
    );
    const members = await admin.as.query(api.users.listForAdmin, {});
    expect(members.find((m) => m._id === pinned.id)?.pinnedAdmin).toBe(true);
    expect(members.find((m) => m._id === admin.id)?.isMe).toBe(true);
  });
});
