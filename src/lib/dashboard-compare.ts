import { daysBetweenAdminDates, formatJakartaDate, shiftAdminDate } from "./admin-date-filter.ts";

/**
 * What the dashboard compares a period with (Paduka, 2026-11-01):
 *
 * - `week`: the same weekdays one week earlier — a Friday against last
 *   Friday, since buying differs by weekday and Thursday is a biased base;
 * - `month`: the same dates one month earlier, clamped to that month's length
 *   (31 Oct → 30 Sep), for month-to-date;
 * - `previous`: the equally long period just before.
 *
 * Dates are Asia/Jakarta `YYYY-MM-DD`, as every admin period is.
 */
export const COMPARE_MODES = ["previous", "week", "month"] as const;
export type CompareMode = (typeof COMPARE_MODES)[number];

export const isCompareMode = (value: unknown): value is CompareMode =>
  typeof value === "string" && (COMPARE_MODES as readonly string[]).includes(value);

/** The default for a date preset: a single day → `week`, a calendar month → `month`, else `previous`. */
export function defaultCompareMode(filter: string): CompareMode {
  if (filter === "today" || filter === "yesterday") return "week";
  if (filter === "this_month" || filter === "last_month") return "month";
  return "previous";
}

function shiftMonth(date: string, months: number) {
  const [year, month, day] = date.split("-").map(Number);
  const target = new Date(Date.UTC(year, month - 1 + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return target.toISOString().slice(0, 10);
}

export function compareRange(start: string, end: string, mode: CompareMode) {
  if (mode === "week") return { start: shiftAdminDate(start, -7), end: shiftAdminDate(end, -7) };
  if (mode === "month") return { start: shiftMonth(start, -1), end: shiftMonth(end, -1) };
  const days = daysBetweenAdminDates(start, end) + 1;
  const previousEnd = shiftAdminDate(start, -1);
  return { start: shiftAdminDate(previousEnd, -(days - 1)), end: previousEnd };
}

/**
 * When the period runs to today it is still filling, so the comparison stops
 * at the same moment of its own day: the instant `now` minus the distance
 * between the two starts. Null when the period is already over.
 */
export function compareCutoff(start: string, end: string, compareStart: string, now = Date.now()) {
  if (end < formatJakartaDate(new Date(now))) return null;
  const offsetDays = daysBetweenAdminDates(compareStart, start);
  return new Date(now - offsetDays * 86_400_000).toISOString();
}
