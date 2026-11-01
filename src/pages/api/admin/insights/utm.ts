import type { APIRoute } from 'astro';
import { answerInsights, utmReport } from '../../../../lib/insights.ts';

export const prerender = false;

/** Orders, revenue, delivered, returned and closing per UTM campaign, split by content (PRD A45, REQ-261). */
export const GET: APIRoute = ({ locals, url }) =>
  answerInsights({ locals, url }, 'admin-insights-utm', (database, period, filter) =>
    utmReport(database, period, filter),
  );
