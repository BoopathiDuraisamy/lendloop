import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { categoryValidator, conditionValidator, loanStatusValidator } from "./lib/validators";

export default defineSchema({
  // One row per Clerk identity. Role lives here (server-side source of truth),
  // never in a client-supplied argument.
  users: defineTable({
    tokenIdentifier: v.string(),
    name: v.string(),
    email: v.optional(v.string()),
    role: v.union(v.literal("admin"), v.literal("user")),
    trustedLender: v.boolean(),
  })
    .index("by_token", ["tokenIdentifier"])
    .index("by_email", ["email"]),

  tools: defineTable({
    ownerId: v.id("users"),
    name: v.string(),
    category: categoryValidator,
    condition: conditionValidator,
    description: v.string(),
    // Soft delete keeps loan history intact for both parties and admins.
    removedAt: v.optional(v.number()),
    removedBy: v.optional(v.id("users")),
  })
    .index("by_owner", ["ownerId"])
    .index("by_removed", ["removedAt"]),

  loans: defineTable({
    toolId: v.id("tools"),
    toolName: v.string(), // snapshot so history survives listing edits/removal
    ownerId: v.id("users"),
    borrowerId: v.id("users"),
    startDate: v.string(), // YYYY-MM-DD
    endDate: v.string(), // YYYY-MM-DD, inclusive
    message: v.optional(v.string()),
    status: loanStatusValidator,
    decidedAt: v.optional(v.number()),
    returnedAt: v.optional(v.number()),
    lastReminderAt: v.optional(v.number()),
    reminderCount: v.number(),
  })
    .index("by_tool", ["toolId"])
    .index("by_tool_status", ["toolId", "status"])
    .index("by_owner", ["ownerId"])
    .index("by_borrower", ["borrowerId"])
    .index("by_status_end", ["status", "endDate"]),

  // Audit trail of every automation hop (outbound webhooks and n8n write-backs).
  // `idempotencyKey` is unique per logical event so retries never duplicate rows.
  automationEvents: defineTable({
    loanId: v.optional(v.id("loans")),
    kind: v.union(
      v.literal("request_notification"),
      v.literal("overdue_reminder"),
      v.literal("workflow_error"),
    ),
    status: v.union(
      v.literal("pending"),
      v.literal("sent"),
      v.literal("failed"),
      v.literal("skipped"),
    ),
    idempotencyKey: v.string(),
    attempts: v.number(),
    detail: v.optional(v.string()),
    updatedAt: v.number(),
  })
    .index("by_key", ["idempotencyKey"])
    .index("by_loan", ["loanId"])
    .index("by_status", ["status"]),
});
