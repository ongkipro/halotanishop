import type { APIRoute } from 'astro';
import { answerInsights, orderTimes } from '../../../../lib/insights.ts';

export const prerender = false;

/** Orders by weekday × hour, Asia/Jakarta (PRD A37, REQ-204). */
export const GET: APIRoute = ({ locals, url }) =>
  answerInsights({ locals, url }, 'admin-insights-times', (database, period, filter) =>
    orderTimes(database, period, filter),
  );
