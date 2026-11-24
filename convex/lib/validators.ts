import { v, type Infer } from "convex/values";

export const CATEGORIES = [
  "power_tools",
  "hand_tools",
  "garden",
  "kitchen",
  "camping",
  "cleaning",
  "ladders",
  "other",
] as const;

export const CONDITIONS = ["new", "good", "fair", "worn"] as const;

export const categoryValidator = v.union(...CATEGORIES.map((c) => v.literal(c)));
export const conditionValidator = v.union(...CONDITIONS.map((c) => v.literal(c)));

export const loanStatusValidator = v.union(
  v.literal("pending"),
  v.literal("approved"), // active loan
  v.literal("declined"),
  v.literal("cancelled"),
  v.literal("returned"),
);

export type Category = Infer<typeof categoryValidator>;
export type Condition = Infer<typeof conditionValidator>;
export type LoanStatus = Infer<typeof loanStatusValidator>;

export const LIMITS = {
  nameMax: 80,
  descriptionMax: 500,
  messageMax: 300,
  maxLoanDays: 30,
} as const;
