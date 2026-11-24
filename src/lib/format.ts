import type { Category, Condition, LoanStatus } from "@convex/lib/validators";

export { CATEGORIES, CONDITIONS } from "@convex/lib/validators";

export const CATEGORY_LABELS: Record<Category, string> = {
  power_tools: "Power tools",
  hand_tools: "Hand tools",
  garden: "Garden",
  kitchen: "Kitchen",
  camping: "Camping",
  cleaning: "Cleaning",
  ladders: "Ladders",
  other: "Other",
};

export const CATEGORY_EMOJI: Record<Category, string> = {
  power_tools: "🔌",
  hand_tools: "🔨",
  garden: "🌱",
  kitchen: "🍳",
  camping: "⛺",
  cleaning: "🧽",
  ladders: "🪜",
  other: "📦",
};

export const CONDITION_LABELS: Record<Condition, string> = {
  new: "Like new",
  good: "Good",
  fair: "Fair",
  worn: "Well-loved",
};

export const STATUS_LABELS: Record<LoanStatus, string> = {
  pending: "Pending",
  approved: "Approved",
  declined: "Declined",
  cancelled: "Cancelled",
  returned: "Returned",
};

export function formatDate(iso: string) {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

export function timeAgo(ms: number, now = Date.now()) {
  const diff = Math.round((ms - now) / 1000);
  const abs = Math.abs(diff);
  if (abs < 60) return rtf.format(diff, "second");
  if (abs < 3600) return rtf.format(Math.round(diff / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), "hour");
  return rtf.format(Math.round(diff / 86400), "day");
}

export function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

/** Pull a readable message out of a ConvexError or generic error. */
export function errorMessage(err: unknown): string {
  if (err && typeof err === "object" && "data" in err) {
    const data = (err as { data: unknown }).data;
    if (data && typeof data === "object" && "message" in data) return String((data as { message: unknown }).message);
    if (typeof data === "string") return data;
  }
  return "Something went wrong. Please try again.";
}
