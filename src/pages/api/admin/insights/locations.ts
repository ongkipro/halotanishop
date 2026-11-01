import type { APIRoute } from 'astro';
import { answerInsights, locationRanking } from '../../../../lib/insights.ts';

export const prerender = false;

/**
 * Provinces, one province's cities with `?province=`, and one city's districts
 * with `&city=` (PRD A37, REQ-202).
 * The province value is compared in `src/lib/insights.ts`; it never reaches SQL,
 * and it is not truncated: a raw key must equal the stored text it came from.
 */
export const GET: APIRoute = ({ locals, url }) =>
  answerInsights({ locals, url }, 'admin-insights-locations', (database, period, filter) =>
    locationRanking(database, period, {
      province: (url.searchParams.get('province') || '').trim() || null,
      // A city key may be empty: `(kosong)` is a city whose orders still count.
      city: url.searchParams.has('city') ? url.searchParams.get('city') : null,
      filter,
    }),
  );
