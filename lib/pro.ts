export const FREE_UPLOADS = 10;
export const PRO_UPLOADS = 150;
export const PRO_PRICE = "$3.99";

export type ProPlan = "monthly" | "annual";
export const PRO_PLANS: Record<ProPlan, { label: string; price: string; per: string; cta: string; badge?: string }> = {
  monthly: { label: "Monthly", price: PRO_PRICE, per: "month", cta: "$3.99 a month" },
  annual: { label: "Annual", price: "$39.99", per: "year", cta: "$39.99 a year", badge: "Save 16%" },
};
export const isProPlan = (value: unknown): value is ProPlan => value === "monthly" || value === "annual";

export type Allowance = {
  plan: "free" | "pro";
  limit: number;
  used: number;
  remaining: number;
  resetsAt: string;
};

export function readAllowance(value: unknown): Allowance | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Allowance;
  if (!["free", "pro"].includes(v.plan) || !Number.isSafeInteger(v.limit) || v.limit < 1 ||
      !Number.isSafeInteger(v.used) || v.used < 0 || !Number.isSafeInteger(v.remaining) ||
      v.remaining < 0 || v.remaining > v.limit || typeof v.resetsAt !== "string" ||
      !Number.isFinite(Date.parse(v.resetsAt))) return null;
  return v;
}

export function summaryUnavailable(text: string): string | null {
  const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const priceLines = lines.filter(line => /[$£€]\s*\d+(?:\.\d{2})?/.test(line) && line.split(/\s+/).length <= 18).length;
  const listLines = lines.filter(line => /^(?:[-•*]|\d+[.)])\s/.test(line)).length;
  const timedLines = lines.filter(line => /\b\d{1,2}:\d{2}\s*(?:am|pm)?\b/i.test(line) && line.split(/\s+/).length <= 18).length;
  if (/\b(?:menu|lunch specials|dinner specials|price list)\b/i.test(lines.slice(0, 2).join(" ")) || (priceLines >= 2 && priceLines >= lines.length / 2))
    return "Not needed for menus. Everything is already short.";
  if (listLines >= 3 && listLines >= lines.length / 2)
    return "Not needed for lists. Everything is already short.";
  if (/\b(?:schedule|timetable|agenda)\b/i.test(lines[0] ?? "") || (timedLines >= 3 && timedLines >= lines.length / 2))
    return "Not needed for schedules. Keep the full details together.";
  if (text.trim().split(/\s+/).filter(Boolean).length < 80)
    return "Not needed for short text. Everything is already short.";
  return null;
}
