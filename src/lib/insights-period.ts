import {
  daysBetweenAdminDates,
  parseAdminDateSelection,
  shiftAdminDate,
} from "./admin-date-filter.ts";

/**
 * The period every `/api/admin/insights/*` route reads (PRD A37, REQ-198).
 *
 * Parsing is `admin-date-filter.ts`'s, so the Analitik menu takes the same
 * `date_filter` / `date_start` / `date_end` parameters as the order list and
 * the dashboard. What is added here is only what A37 requires on top:
 *
 * - A period is required. `all` (and an absent filter, which reads as `all`)
 *   is refused rather than turned into an unbounded scan.
 * - At most 90 days, for a preset as much as a custom range (`180d` is a
 *   preset the order list offers; it is refused here, not truncated).
 *
 * The day is the Jakarta day, with the dashboard's own `'+7 hours'`
 * expression. `created_at` is an ISO string, so the range is first narrowed
 * with a plain `created_at >= ? AND created_at < ?` the index can serve,
 * widened by a day on each side so a row in any timestamp spelling is still
 * reached; the exact `date(created_at, '+7 hours') BETWEEN ? AND ?` then
 * decides membership. That keeps the dashboard's definition of a day while
 * letting `idx_orders_created_at` (and `idx_orders_source_slug_created`) bound
 * the read.
 */
export const INSIGHTS_MAX_RANGE_DAYS = 90;
export const INSIGHTS_TIMEZONE = "Asia/Jakarta";

export type InsightsPeriod = {
  start: string;
  end: string;
  /** Inclusive day count. */
  days: number;
};

export type InsightsPeriodResolution =
  | { ok: true; period: InsightsPeriod }
  | { ok: false; reason: string };

export function resolveInsightsPeriod(
  searchParams: URLSearchParams,
  now = new Date(),
): InsightsPeriodResolution {
  const { resolution } = parseAdminDateSelection(searchParams, {
    maxCustomRangeDays: INSIGHTS_MAX_RANGE_DAYS,
    now,
  });
  if (!resolution.ok) return { ok: false, reason: resolution.reason };
  if (!resolution.start || !resolution.end) {
    return {
      ok: false,
      reason: `Periode wajib dipilih, maksimal ${INSIGHTS_MAX_RANGE_DAYS} hari.`,
    };
  }
  const days = daysBetweenAdminDates(resolution.start, resolution.end) + 1;
  if (days > INSIGHTS_MAX_RANGE_DAYS) {
    return {
      ok: false,
      reason: `Rentang tanggal maksimal ${INSIGHTS_MAX_RANGE_DAYS} hari.`,
    };
  }
  return { ok: true, period: { start: resolution.start, end: resolution.end, days } };
}

/** The period of the same length that ends the day before `period` starts. */
export function previousInsightsPeriod(period: InsightsPeriod): InsightsPeriod {
  const end = shiftAdminDate(period.start, -1);
  return { start: shiftAdminDate(end, -(period.days - 1)), end, days: period.days };
}

/** The Jakarta day of a row, exactly as the dashboard groups it. */
export const jakartaDaySql = (alias = "") => `date(${alias}created_at, '+7 hours')`;

/**
 * The period predicate and its four bound values. `alias` is a table prefix
 * such as `o.` for a joined query.
 */
export function periodClause(period: InsightsPeriod, alias = "") {
  return {
    sql: `${alias}created_at >= ? AND ${alias}created_at < ? AND ${jakartaDaySql(alias)} BETWEEN ? AND ?`,
    params: [
      shiftAdminDate(period.start, -1),
      shiftAdminDate(period.end, 1),
      period.start,
      period.end,
    ],
  };
}

/** Every day of the period, in order. */
export function periodDays(period: InsightsPeriod): string[] {
  return Array.from({ length: period.days }, (_, index) => shiftAdminDate(period.start, index));
}

/**
 * One entry per day of the period; a day with no row is `empty()`, never
 * missing, so a chart's axis is continuous.
 */
export function zeroFillDays<Row extends { date: string }, Out>(
  period: InsightsPeriod,
  rows: readonly Row[],
  shape: (date: string, row: Row | undefined) => Out,
): Out[] {
  const byDate = new Map(rows.map((row) => [row.date, row]));
  return periodDays(period).map((date) => shape(date, byDate.get(date)));
}
