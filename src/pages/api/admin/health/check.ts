import type { APIRoute } from 'astro';
import { jsonError, jsonOk } from '../../../../lib/api.ts';
import { getRuntimeEnv } from '../../../../lib/env.ts';
import { refreshHealthSnapshot, statusIconState } from '../../../../lib/health-snapshot.ts';

export const prerender = false;

/**
 * **Periksa ulang** on `/admin/status` (PRD A39). Collects health and the setup
 * facts now, writes the snapshot and returns it. A POST because it writes, so
 * the middleware's same-origin check covers it. A snapshot younger than 15
 * seconds is returned as is. Sends no alert and writes no alert state
 * (REQ-223): the hourly run is the only place that evaluates alerts.
 */
export const POST: APIRoute = async ({ locals }) => {
  const database = getRuntimeEnv(locals)?.OMS_DB as D1Database | undefined;
  if (!database?.prepare) return jsonError('Database belum tersedia.', 503);
  try {
    const now = Date.now();
    const { snapshot, reused } = await refreshHealthSnapshot(database, locals, now);
    return jsonOk({ snapshot, reused, icon: statusIconState(snapshot, now) });
  } catch (error) {
    console.error('admin-health-check', error);
    return jsonError('Gagal memeriksa status operasional.', 502);
  }
};
