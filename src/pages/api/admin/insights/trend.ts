import type { APIRoute } from 'astro';
import { jsonError } from '../../../../lib/api.ts';
import { answerInsights, trendSeries } from '../../../../lib/insights.ts';

export const prerender = false;

/** Daily orders, leads and revenue, plus the previous period's total (PRD A37, REQ-200). */
export const GET: APIRoute = ({ locals, url }) => {
  if (url.searchParams.get('source') && url.searchParams.get('product_id')) {
    return jsonError('Pilih satu: halaman sumber atau produk.', 400);
  }
  return answerInsights({ locals, url }, 'admin-insights-trend', (database, period, filter) =>
    trendSeries(database, period, filter),
  );
};
