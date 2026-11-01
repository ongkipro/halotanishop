import { resolveAdminDateSelection } from './admin-date-filter.ts';
import { INSIGHTS_MAX_RANGE_DAYS } from './insights-period.ts';
import { SOURCE_SLUG_NONE_FILTER } from './source-slug.ts';

export const INSIGHTS_REPORTS = {
  trend: { label: 'Ringkasan', path: '/admin/analytics', description: 'Bandingkan tren pesanan, lead, dan omset dengan periode sebelumnya.' },
  landing: { label: 'Landing page', path: '/admin/analytics/landing', description: 'Bandingkan sumber pesanan berdasarkan omset terkirim, bukan jumlah pesanan saja.' },
  products: { label: 'Produk', path: '/admin/analytics/products', description: 'Lihat unit terjual, omset produk, dan varian yang dipilih pembeli.' },
  locations: { label: 'Lokasi', path: '/admin/analytics/locations', description: 'Telusuri pesanan dan retur dari provinsi, kota, hingga kecamatan.' },
  times: { label: 'Waktu beli', path: '/admin/analytics/times', description: 'Lihat kapan pesanan dibuat dalam waktu Asia/Jakarta.' },
  utm: { label: 'UTM', path: '/admin/analytics/utm', description: 'Bandingkan kampanye dari tag UTM link iklan, lalu rinci per konten.' },
} as const;
/** The UTM report's row for orders that carry no source, medium or campaign tag (REQ-261). */
export const UTM_NONE_LABEL = '(tanpa UTM)';
export type InsightsReport = keyof typeof INSIGHTS_REPORTS;
export const INSIGHTS_CHANNEL_OPTIONS = [
  { value: '', label: 'Semua kanal' }, { value: 'meta', label: 'Meta' },
  { value: 'google', label: 'Google' }, { value: 'tiktok', label: 'TikTok' },
  { value: 'other_paid', label: 'Iklan lainnya' }, { value: 'organic', label: 'Organik' },
  { value: 'direct', label: 'Langsung' },
];
export const insightsMoney = (value: number) => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(value);
export const insightsNumber = (value: number) => new Intl.NumberFormat('id-ID', { maximumFractionDigits: 2 }).format(value);
export const insightsPercent = (value: number) => `${insightsNumber(value)}%`;

export function insightsInitialQuery(query: string) {
  const params = new URLSearchParams(query);
  if (!params.has('date_filter')) params.set('date_filter', 'this_month');
  return params.toString();
}

export function insightsPeriodLink(href: string, query: string) {
  const params = new URLSearchParams(query);
  const period = new URLSearchParams();
  for (const key of ['date_filter', 'date_start', 'date_end']) {
    if (params.has(key)) period.set(key, params.get(key)!);
  }
  return `${href}${period.size ? `?${period}` : ''}`;
}

export const isInsightsPath = (pathname: string) =>
  pathname === INSIGHTS_REPORTS.trend.path || pathname.startsWith(`${INSIGHTS_REPORTS.trend.path}/`);

/** `href` with the current page's period, when both are Analitik screens. */
export function withInsightsPeriod(href: string, currentPathname: string, currentQuery: string) {
  const target = new URL(href, 'https://local.test');
  return isInsightsPath(target.pathname) && isInsightsPath(currentPathname)
    ? insightsPeriodLink(target.pathname, currentQuery)
    : href;
}

export function insightsOrderLink(slug: string | null, query: string) {
  const url = new URL(insightsPeriodLink('/admin/orders', query), 'https://local.test');
  url.searchParams.set('source_slug', slug ?? SOURCE_SLUG_NONE_FILTER);
  // The report's default period is implicit in its URL; the order list's is
  // "Semua waktu", so the link names it (audit 2026-10-31 M4).
  if (!url.searchParams.has('date_filter')) url.searchParams.set('date_filter', 'this_month');
  return url.pathname + url.search;
}

export function insightsDateSelection(query: string) {
  const params = new URLSearchParams(query);
  const filter = params.get('date_filter') || 'this_month';
  const customRange = { start: params.get('date_start') || '', end: params.get('date_end') || '' };
  const resolved = resolveAdminDateSelection(filter, { customRange, maxCustomRangeDays: INSIGHTS_MAX_RANGE_DAYS });
  return { filter, start: resolved.ok ? resolved.start : customRange.start, end: resolved.ok ? resolved.end : customRange.end };
}

export function sortInsightRows<T extends object>(rows: readonly T[], key: keyof T, descending = true): T[] {
  return [...rows].sort((a, b) => {
    const left = a[key], right = b[key];
    const comparison = typeof left === 'number' && typeof right === 'number'
      ? left - right : String(left ?? '').localeCompare(String(right ?? ''), 'id');
    return descending ? -comparison : comparison;
  });
}
