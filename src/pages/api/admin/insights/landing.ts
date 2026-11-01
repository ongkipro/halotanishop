import type { APIRoute } from 'astro';
import { answerInsights, landingRanking } from '../../../../lib/insights.ts';

export const prerender = false;

/** Per-source ranking with channel split and lead follow-up (PRD A37, REQ-199/203/205). */
export const GET: APIRoute = ({ locals, url }) =>
  answerInsights({ locals, url }, 'admin-insights-landing', (database, period) =>
    landingRanking(database, period),
  );
