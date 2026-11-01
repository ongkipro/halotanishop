import type { APIRoute } from 'astro';
import { jsonError, jsonOk } from '../../../lib/api.ts';
import { getRuntimeEnv } from '../../../lib/env.ts';
import { collectOperationalHealth } from '../../../lib/operational-health.ts';

export const prerender = false;

/**
 * Operational health, collected live (`OBSERVABILITY.md` §4 item 4).
 *
 * Authentication is the middleware's, like every other `/api/admin/*` route.
 * Role access is the `ADMIN_API_ROUTES` table in `src/lib/auth.ts`, which lists
 * this route: owner and admin reach it, advertiser and customer_service get a
 * 403.
 *
 * A read and nothing else. It used to evaluate alerts as well, which wrote
 * alert state to KV and could fire the webhook on any dashboard view; the
 * hourly run in `src/worker.ts` is now the only place that evaluates them
 * (PRD A39, REQ-223). The admin icon reads `/api/admin/health/status`.
 *
 * Counts, ages and states only. No order or customer payloads leave here.
 */
export const GET: APIRoute = async ({ locals }) => {
  const database = getRuntimeEnv(locals)?.OMS_DB as D1Database | undefined;
  if (!database?.prepare) {
    return jsonError('Database belum tersedia.', 503);
  }

  try {
    const health = await collectOperationalHealth(database, locals);
    return jsonOk({ health });
  } catch (error) {
    console.error('admin-health-get', error);
    return jsonError('Gagal membaca status operasional.', 502);
  }
};
