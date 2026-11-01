import type { APIRoute } from 'astro';
import { answerInsights, productRanking } from '../../../../lib/insights.ts';

export const prerender = false;

/** Units, revenue, variant split and return share per product (PRD A37, REQ-201). */
export const GET: APIRoute = ({ locals, url }) =>
  answerInsights({ locals, url }, 'admin-insights-products', (database, period, filter) =>
    productRanking(database, period, { filter }),
  );
